/**
 * Taring Naga Lab — Google Apps Script Backend
 *
 * Deploy:
 *   1. Buka https://script.google.com → New Project
 *   2. Tempel kode ini, lalu Save (nama: TN Lab API)
 *   3. Klik Deploy → New deployment → type: Web app
 *      - Description: TN Lab API v1
 *      - Execute as: Me (akun pemilik sheet)
 *      - Who has access: Anyone with the link
 *   4. Salin URL "Web app". Tempel ke Settings → Sync di TN Lab.
 *   5. Buat Google Sheet baru, copy ID-nya (dari URL: docs.google.com/spreadsheets/d/{ID}/...),
 *      tempel ke konstanta SHEET_ID di bawah.
 *   6. Edit SHARED_SECRET menjadi string panjang acak, masukkan juga ke Settings → Sync.
 *
 * Webhook URL untuk taringnaga.id:
 *   {WEB_APP_URL}?action=webhook&secret={YOUR_SECRET}
 *   Method: POST  Body: JSON order { items:[...], customer, total, channel:'Web' }
 *
 * Sheet yang dipakai (auto-create kalau belum ada):
 *   beans, products, roastLogs, cuppings, orders, settings, incoming_orders, sync_log
 */

const SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';
const SHARED_SECRET = 'CHANGE_THIS_TO_A_LONG_RANDOM_STRING';

const ENTITIES = ['beans', 'products', 'roastLogs', 'cuppings', 'orders', 'settings'];

/* ===================== HTTP Endpoints ===================== */

function doPost(e) {
  return handle(e, 'POST');
}

function doGet(e) {
  return handle(e, 'GET');
}

function handle(e, method) {
  try {
    const body = method === 'POST' && e.postData ? JSON.parse(e.postData.contents || '{}') : {};
    const params = Object.assign({}, e.parameter || {}, body);
    const action = params.action;
    const secret = params.secret;

    // Allow CORS preflight effectively (Apps Script handles CORS internally for GET; POST text/plain works)
    if (action === 'health') return json({ ok: true, version: '1.0', time: new Date().toISOString() });

    // Webhook from website — uses secret in URL, doesn't require client login
    if (action === 'webhook') {
      if (secret !== SHARED_SECRET) return json({ error: 'unauthorized' }, 401);
      const order = body.order || (params.order ? JSON.parse(params.order) : null);
      if (!order) return json({ error: 'no order' }, 400);
      const saved = addIncomingOrder(order, params.source || 'taringnaga.id');
      return json({ ok: true, id: saved.id });
    }

    // All other actions require secret
    if (secret !== SHARED_SECRET) return json({ error: 'unauthorized' }, 401);

    switch (action) {
      case 'sync': return json(doSync(body.data || {}));
      case 'pull': return json(doPull());
      case 'incoming': return json({ orders: getNewIncomingOrders() });
      case 'mark_imported': return json(markImported(body.ids || []));
      case 'add_order': return json(addLocalOrder(body.order));
      case 'reset': return json(resetAll());
      default: return json({ error: 'unknown action: ' + action }, 400);
    }
  } catch (err) {
    return json({ error: String(err), stack: err.stack }, 500);
  }
}

/* ===================== Sync ===================== */

function doSync(localData) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const merged = {};

  for (const entity of ENTITIES) {
    const sheet = getOrCreateSheet(ss, entity);
    const existing = readEntity(sheet);
    const incoming = (localData[entity] || []);

    const map = {};
    for (const item of existing) map[item.id] = item;
    for (const item of incoming) {
      if (!item || !item.id) continue;
      const e = map[item.id];
      const incomingTs = +new Date(item.updatedAt || 0);
      const existingTs = e ? +new Date(e.updatedAt || 0) : 0;
      if (!e || incomingTs >= existingTs) {
        map[item.id] = item;
      }
    }
    const result = Object.values(map);
    writeEntity(sheet, result);
    merged[entity] = result;
  }

  logSync(localData);
  return { merged, syncedAt: new Date().toISOString() };
}

function doPull() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const out = {};
  for (const entity of ENTITIES) {
    const sheet = ss.getSheetByName(entity);
    out[entity] = sheet ? readEntity(sheet) : [];
  }
  return { data: out, syncedAt: new Date().toISOString() };
}

/* ===================== Webhook / Incoming Orders ===================== */

function addIncomingOrder(order, source) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateIncomingSheet(ss);
  const id = 'inc_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const createdAt = new Date().toISOString();
  // Normalize order
  const normalized = {
    items: order.items || [],
    customer: order.customer || 'Web Customer',
    total: order.total || (order.items || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0),
    channel: order.channel || 'Web',
    note: order.note || '',
    source: source,
  };
  sheet.appendRow([id, JSON.stringify(normalized), 'new', createdAt, '']);
  return { id, createdAt };
}

function getNewIncomingOrders() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('incoming_orders');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  return rows
    .filter(r => r[0] && r[2] === 'new')
    .map(r => ({ id: r[0], order: JSON.parse(r[1]), createdAt: r[3] }));
}

function markImported(ids) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('incoming_orders');
  if (!sheet) return { ok: true, count: 0 };
  const data = sheet.getDataRange().getValues();
  const importedAt = new Date().toISOString();
  let n = 0;
  for (let i = 1; i < data.length; i++) {
    if (ids.indexOf(data[i][0]) >= 0 && data[i][2] === 'new') {
      sheet.getRange(i + 1, 3).setValue('imported');
      sheet.getRange(i + 1, 5).setValue(importedAt);
      n++;
    }
  }
  return { ok: true, count: n };
}

function addLocalOrder(order) {
  // Direct add a POS order to orders sheet (alternative to bulk sync)
  if (!order || !order.id) return { error: 'no order' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, 'orders');
  const items = readEntity(sheet);
  items.push(order);
  writeEntity(sheet, items);
  return { ok: true };
}

/* ===================== Sheet helpers ===================== */

function getOrCreateSheet(ss, name) {
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange(1, 1, 1, 3).setValues([['id', 'data', 'updatedAt']]);
    s.setFrozenRows(1);
  } else if (s.getLastRow() === 0) {
    s.getRange(1, 1, 1, 3).setValues([['id', 'data', 'updatedAt']]);
    s.setFrozenRows(1);
  }
  return s;
}

function getOrCreateIncomingSheet(ss) {
  let s = ss.getSheetByName('incoming_orders');
  if (!s) {
    s = ss.insertSheet('incoming_orders');
    s.getRange(1, 1, 1, 5).setValues([['id', 'order_json', 'status', 'createdAt', 'importedAt']]);
    s.setFrozenRows(1);
  }
  return s;
}

function readEntity(sheet) {
  if (sheet.getLastRow() <= 1) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const out = [];
  for (const r of rows) {
    if (!r[0]) continue;
    try {
      const obj = JSON.parse(r[1]);
      out.push(obj);
    } catch (e) {}
  }
  return out;
}

function writeEntity(sheet, items) {
  // Clear then write (simple, robust)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).clearContent();
  }
  if (items.length === 0) return;
  const rows = items.map(it => [
    it.id,
    JSON.stringify(it),
    it.updatedAt || new Date().toISOString(),
  ]);
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
}

function logSync(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let s = ss.getSheetByName('sync_log');
    if (!s) {
      s = ss.insertSheet('sync_log');
      s.getRange(1, 1, 1, 3).setValues([['at', 'summary', 'meta']]);
      s.setFrozenRows(1);
    }
    const sum = ENTITIES.map(e => `${e}=${(data[e] || []).length}`).join(' ');
    s.appendRow([new Date().toISOString(), sum, '']);
    // Trim if > 500 rows
    if (s.getLastRow() > 500) {
      s.deleteRows(2, s.getLastRow() - 500);
    }
  } catch (e) {}
}

function resetAll() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  for (const name of ENTITIES.concat(['incoming_orders', 'sync_log'])) {
    const s = ss.getSheetByName(name);
    if (s) ss.deleteSheet(s);
  }
  return { ok: true };
}

/* ===================== Utils ===================== */

function json(obj, status) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
