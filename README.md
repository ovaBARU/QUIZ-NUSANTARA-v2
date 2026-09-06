# QUIZ NUSANTARA v2.8 — Railway Ready

Multiplayer quiz sekolah tanpa login, siap dijalankan di Railway.

## Fitur v2.8
- Dashboard Admin profesional.
- Bank Soal dan Bank Kuis permanen.
- PostgreSQL otomatis dipakai jika Railway menyediakan `DATABASE_URL`.
- JSON fallback jika PostgreSQL tidak tersedia.
- Health check `/health`.
- Bind `0.0.0.0` dan port dari `process.env.PORT`.
- Socket.IO real-time untuk admin dan siswa.
- Stopwatch per soal, reset saat soal baru dimulai.
- Siswa tidak dapat memindahkan soal.
- Correct answer tidak dikirim ke siswa.

## Deploy Railway
1. Upload/push folder project ke GitHub atau deploy dari repository.
2. Di Railway, buat Service untuk project ini.
3. Pastikan `npm start` digunakan sebagai Start Command.
4. Untuk penyimpanan Bank Kuis yang benar-benar persisten, tambahkan PostgreSQL pada project Railway. Railway akan menyediakan `DATABASE_URL`.
5. Deploy. Health check menggunakan `/health`.

## Lokal
```bash
npm install
npm start
```
Buka `http://localhost:3000`.

## Catatan penyimpanan
- Dengan `DATABASE_URL`: Bank Kuis disimpan di PostgreSQL dan aman dari restart/redeploy container.
- Tanpa `DATABASE_URL`: aplikasi memakai `data/quizzes.json`. Pada Railway tanpa Volume, file lokal dapat hilang ketika instance diganti.
