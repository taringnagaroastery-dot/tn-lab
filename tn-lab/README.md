# Taring Naga Lab — Setup Guide

Operations Suite untuk Taring Naga Roastery. PWA installable, sync via Google Spreadsheet, webhook untuk web order, dan native thermal printer via Bluetooth.

## File Structure

```
tn-lab/
├── index.html              # App utama (React + Tailwind-free CSS + Chart.js via CDN)
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # Service worker (offline-first)
├── apps-script.gs          # Backend di Google Apps Script
├── icons/                  # PWA icons (PNG + SVG + ICO)
└── README.md               # File ini
```

## 1. Hosting

App ini static — bisa di-host di:

- **GitHub Pages** (gratis, paling mudah)
- **Vercel** / **Netlify** (gratis, auto-deploy)
- **Cloudflare Pages** (gratis, CDN super cepat)
- Server Apache/Nginx mana saja

**Wajib HTTPS** untuk PWA install + Web Bluetooth + Service Worker.

Untuk testing lokal:
```bash
cd D:\tn-lab
python -m http.server 8000
# Buka http://localhost:8000 (PWA install tidak aktif di localhost untuk iOS, tapi SW jalan)
```

Untuk testing PWA dengan HTTPS lokal, pakai `ngrok http 8000` atau `mkcert` + serve via HTTPS.

## 2. Install ke Home Screen

**Android (Chrome / Edge / Samsung Internet):**
1. Buka URL app di browser
2. Menu (⋮) → "Install app" atau "Add to Home Screen"
3. Icon TN Lab muncul di home screen

**iOS (Safari):**
1. Buka URL app di Safari (harus Safari, bukan Chrome)
2. Share button (kotak panah atas)
3. "Add to Home Screen"
4. Icon TN Lab muncul

**Desktop (Chrome / Edge):**
1. Klik icon install (⊕) di address bar
2. "Install Taring Naga Lab"
3. App jalan di window terpisah seperti aplikasi native

## 3. Sync via Google Spreadsheet (Database)

### Setup Backend (sekali saja)

1. Buka https://docs.google.com/spreadsheets/u/0/ → buat sheet baru
2. Rename: "TN Lab Database"
3. Copy ID dari URL: `docs.google.com/spreadsheets/d/`**INI_ID_NYA**`/edit`
4. Buka https://script.google.com → New Project
5. Hapus kode default, tempel isi `apps-script.gs`
6. Ganti dua konstanta di atas:
   ```js
   const SHEET_ID = 'PASTE_ID_DARI_LANGKAH_3';
   const SHARED_SECRET = 'ganti-jadi-string-acak-panjang-min-24-karakter';
   ```
7. Save (Ctrl+S) → kasih nama project "TN Lab API"
8. Deploy → New deployment
   - Type: **Web app**
   - Description: TN Lab API v1
   - Execute as: **Me** (`@gmail.com` Anda)
   - Who has access: **Anyone with the link**
   - Klik Deploy → Authorize (login Google) → izinkan akses sheet
9. Copy URL "Web app" (bentuknya `https://script.google.com/macros/s/AKfy.../exec`)

### Connect App ke Backend

1. Buka TN Lab → Settings → **N° 06 — Sync & Integrasi**
2. Tempel **Apps Script URL** ke field "Endpoint URL"
3. Tempel **Shared Secret** yang sama persis ke field "Secret"
4. Klik **Test Connection** → harus muncul "Connected · v1.0"
5. Klik **Sync Now** → seluruh data lokal terupload ke Sheet
6. Set **Auto-sync interval** (rekomendasi: 60 detik)

Sekarang data tersinkron antara device. Buka app di laptop, HP, tablet — semua melihat data yang sama.

### Webhook URL untuk taringnaga.id

URL yang dipakai website untuk push order:

```
{APPS_SCRIPT_URL}?action=webhook&secret={SECRET}
```

Method: **POST**, Content-Type: `application/json` atau `text/plain` (Apps Script terima keduanya).

**Contoh payload:**
```json
{
  "order": {
    "items": [
      { "name": "Kawi Fullwash 200g", "price": 60000, "qty": 1 },
      { "name": "Arjuna Wine 200g", "price": 67000, "qty": 2 }
    ],
    "customer": "Budi · +628123456789",
    "total": 194000,
    "channel": "Web",
    "note": "Alamat: Bandung, kirim siang"
  }
}
```

App akan auto-poll dan import ke POS sebagai order baru.

**Test via curl:**
```bash
curl -X POST "{APPS_SCRIPT_URL}?action=webhook&secret={SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"order":{"items":[{"name":"Test","price":50000,"qty":1}],"customer":"Test","total":50000,"channel":"Web"}}'
```

Di taringnaga.id (Vue/Next/PHP/apa pun), saat customer checkout, panggil endpoint ini. Bisa via fetch / axios:

```js
fetch('{APPS_SCRIPT_URL}?action=webhook&secret={SECRET}', {
  method: 'POST',
  body: JSON.stringify({ order: orderData }),
});
```

## 4. Thermal Printer (Bluetooth ESC/POS)

**Browser yang support Web Bluetooth:**
- ✅ Chrome / Edge / Opera (Desktop Win/Mac/Linux)
- ✅ Chrome / Samsung Internet (Android)
- ❌ Safari iOS (tidak support — fallback ke window.print)
- ❌ Firefox (tidak support — fallback)

### Setup Printer

1. Nyalakan printer Bluetooth (Bixolon, Eppos, Toomas, Xprinter, dll yang ESC/POS-compatible)
2. Pair di sistem operasi terlebih dulu (Settings → Bluetooth)
3. TN Lab → Settings → **N° 07 — Thermal Printer**
4. Klik **Connect Printer** → pilih perangkat dari pop-up browser
5. Klik **Test Print** untuk verifikasi
6. Browser akan ingat device — restart browser tidak perlu pair ulang (di session yang sama)

Saat checkout di POS, struk auto-print ke thermal printer. Kalau printer tidak terkoneksi, fallback ke `window.print()`.

### Brand printer yang teruji
- Bixolon SPP-R200 series, SPP-R310
- Eppos EP-58 / EP-80
- Xprinter XP-P810 / XP-P323B
- Generic 58mm / 80mm ESC/POS Bluetooth printer
- Toomas T58 series

Kalau printer Anda tidak nongol di list pairing, pastikan:
- Mode pairing aktif (LED biru kedip)
- Battery cukup
- Tidak sedang terhubung ke device lain

## 5. Backup / Offline

- Service worker cache app shell + CDN → app jalan **offline** (data tetap di localStorage)
- Saat online kembali, sync otomatis push perubahan offline
- Manual backup: Settings → Backup → Export JSON
- Restore: Settings → Backup → Import JSON

## 6. Multi-device + Team Use

- Semua device yang pakai **endpoint + secret** yang sama, terhubung ke spreadsheet yang sama
- Sync interval 60s berarti perubahan dari device lain muncul max ~60s kemudian
- Conflict resolution: **last-write-wins** berdasarkan `updatedAt` timestamp
- Untuk operasi konkuren yang sensitif (mis. stock decrement di 2 POS bersamaan): app menulis perubahan dengan timestamp, server merge, hasil akhir sesuai timestamp paling baru — disarankan satu kasir per shift

## 7. Sell to Other Roasters

Karena setiap roaster:
- Punya **Google account** sendiri → sheet sendiri → data terpisah & milik mereka
- Punya **secret** sendiri → tidak bocor ke sesama klien
- Bisa **rebrand** via Settings → Info Bisnis (nama, tagline, alamat)
- Bisa **white-label** dengan ganti `icons/` dan title di `index.html`

Anda bisa jual ini sebagai SaaS Indonesia tanpa biaya backend (Apps Script gratis up to 6 min execution & 90 min/day, cukup untuk roastery skala UMKM-menengah). Biaya hosting nol di GitHub Pages.

## Troubleshooting

**Sync error "unauthorized"**
- Secret di app dan di Apps Script berbeda → samakan persis

**Sync error "Unexpected token <"**
- URL salah → pastikan URL deployment, bukan URL editor script

**Bluetooth printer tidak muncul**
- Pastikan HTTPS (bukan HTTP) — Web Bluetooth wajib HTTPS
- Pakai Chrome/Edge, bukan Safari/Firefox

**PWA tidak bisa install di iOS**
- Wajib pakai Safari (bukan Chrome iOS — Apple batasan)
- Wajib HTTPS

**Order webhook tidak masuk**
- Check di sheet `incoming_orders` apakah ada row baru
- Status `new` = belum di-import; `imported` = sudah masuk ke POS
- Manual import: Settings → Sync → "Pull Webhook Orders"

---

> "Kopi yang baik punya gigi."
> — Taring Naga
