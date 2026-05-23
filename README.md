# PinTok Downloader

PinTok Downloader adalah web downloader/analyzer modern untuk TikTok dan Pinterest dengan pendekatan legal-safe.

Project ini dibuat untuk membantu pengguna menganalisis link publik dan menyimpan hanya konten yang:

- pengguna miliki sendiri
- bebas izin
- atau memang punya izin untuk disimpan

Aplikasi ini tidak dibuat untuk:

- bypass DRM
- mengambil konten private
- mengambil konten login-only
- bypass paywall
- menghapus watermark
- bypass proteksi platform
- mengambil konten berhak cipta tanpa izin

## Tech Stack

Frontend:

- HTML
- CSS
- Vanilla JavaScript

Backend:

- Node.js
- Express.js

Security:

- Helmet
- CORS
- Rate limit
- Safe URL validation
- SSRF protection
- Allowed domain fetch only

## Struktur Folder

```txt
PinTok-Downloader/
├── api/
│   └── index.js
├── package.json
├── server.js
├── vercel.json
├── env.example
├── README.md
├── services/
│   ├── tiktok.js
│   ├── pinterest.js
│   └── urlValidator.js
└── public/
    ├── index.html
    ├── style.css
    ├── app.js
    └── assets/
        ├── logo.svg
        └── icon.svg
