# QUIZ NUSANTARA v3.0 — Railway Ready

Multiplayer quiz sekolah berbasis Node.js + Express + Socket.IO. Admin wajib login, siswa cukup masuk dengan kode room, dan admin memiliki generator soal otomatis.

## Fitur v3.0
- Admin wajib login dengan password sekolah.
- Room multiplayer real-time.
- Stopwatch per soal.
- Bank Soal dan Bank Kuis permanen.
- PostgreSQL Railway untuk penyimpanan bank kuis.
- Generator lokal: tetap berjalan tanpa API.
- **Generator Internet + AI:** AI membuat soal sesuai kelas dan mata pelajaran sambil menggunakan web search untuk mencari referensi pendidikan yang relevan.
- Pilihan kelas SD 1–6, SMP 7–9, SMA 10–12.
- Pilihan jumlah 5/10/20/30 soal.
- Pilihan tingkat mudah/sedang/sulit.
- Hasil generator masuk ke Bank Soal terlebih dahulu sehingga admin dapat memeriksa/mengedit sebelum permainan dimulai.
- API key AI hanya berada di server Railway, tidak dikirim ke browser.

## Deploy ke Railway

1. Upload/push seluruh isi folder ini ke GitHub.
2. Di Railway, deploy repository GitHub tersebut sebagai service Node.js.
3. Tambahkan PostgreSQL melalui `+ New` → `Database` → `PostgreSQL` bila ingin Bank Kuis persisten. Railway menyediakan `DATABASE_URL` untuk service database. Lihat dokumentasi Railway: https://docs.railway.com/databases/postgresql
4. Pada service aplikasi, buka **Variables** dan isi:

```env
ADMIN_PASSWORD=buat-password-admin-yang-kuat
OPENAI_API_KEY=sk-ISI_API_KEY_ANDA
OPENAI_MODEL=gpt-5.6-luna
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Jika nama service PostgreSQL Anda bukan `Postgres`, sesuaikan referensi variable dengan nama service tersebut.

Railway menyediakan variable antar-service dengan format `${{ServiceName.VARIABLE}}`. Jangan memasukkan API key ke file frontend atau GitHub. Dokumentasi Railway: https://docs.railway.com/variables

5. Deploy/redeploy.
6. Buka website → **Admin** → login.
7. Buat room → klik **✨ GENERATE SOAL OTOMATIS**.
8. Pilih **🌐 Internet + AI** untuk generator berbasis web.

## Tanpa OpenAI API key
Aplikasi tetap berjalan. Pilih sumber **Lokal** pada Generator Soal Otomatis. Fitur multiplayer, Bank Kuis, dan generator lokal tidak membutuhkan OpenAI API.

## Tentang generator Internet + AI
Mode Internet + AI memakai OpenAI Responses API dan web search dari server. API key harus disimpan sebagai environment variable Railway (`OPENAI_API_KEY`). API key tidak boleh ditaruh di JavaScript browser. OpenAI juga mendokumentasikan penggunaan Responses API dan built-in web search untuk aplikasi server-side.

## Catatan biaya
Mode Internet + AI menggunakan API berbayar sesuai akun/provider yang dipakai. Untuk menghindari biaya, gunakan mode Lokal.

## Health check
`GET /health` mengembalikan status aplikasi dan versi.

## Start lokal

```bash
npm install
npm start
```

Default port: `3000`.
