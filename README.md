# QUIZ NUSANTARA v3.11

## v3.11 — Rekap Akhir, Tutup Room & Halaman Terima Kasih
- Pada halaman **HASIL AKHIR** admin tersedia tombol **⛔ TUTUP ROOM** agar guru dapat menutup room setelah rekap selesai.
- Setelah kuis selesai, siswa diarahkan ke halaman akhir **Kuis Tuntas! Hebat! 🌟** dengan pesan apresiasi dan tanpa menampilkan kunci jawaban.
- Tampilan siswa dipisahkan tegas dari Dashboard Admin.
- Mode sesi (`player` / `teacher`) disimpan terpisah agar refresh/tab siswa tidak menghidupkan kembali Dashboard Admin.
- Lobby siswa menampilkan **📚 Silahkan Menunggu** dan gambar `student-home.png`.
- Setelah selesai, siswa hanya melihat **🎉 Terima Kasih!** tanpa kunci jawaban/rekapan.
- Admin mendapatkan rekap semua soal, kunci, jawaban tiap kelompok, hasil, poin, dan nama siswa yang mengirim jawaban.
- Review per tim juga menampilkan siswa pengirim jawaban.
- Tetap kompatibel dengan Railway, Google Login, Socket.IO, dan generator AI Kurikulum Merdeka/Pembelajaran Mendalam dari v3.6.

# QUIZ NUSANTARA v3.6

Perbaikan utama: kontrol **MULAI PERMAINAN** admin dibuat lebih kuat setelah siswa bergabung. Server sekarang memberikan status/error yang jelas, memulihkan peran admin pada koneksi admin yang sah setelah refresh/reconnect, memvalidasi room, soal, dan peserta sebelum permainan dimulai, serta mengirim acknowledgement saat permainan berhasil dimulai.

Fitur v3.1/v3.2 tetap: login Google admin, bank 100 soal per mata pelajaran/per kelas, multiplayer Socket.IO, stopwatch, dashboard admin, bank soal, bank kuis, generator lokal/Internet+AI, dan sisi siswa tanpa dashboard admin.

## Railway Variables
- `GOOGLE_CLIENT_ID`
- `ADMIN_GOOGLE_EMAILS` (opsional untuk allowlist)
- `OPENAI_API_KEY` (opsional)
- `OPENAI_MODEL` (opsional, default `gpt-5.6-luna`)
- `DATABASE_URL` (opsional; gunakan PostgreSQL Railway untuk penyimpanan persisten)

`ADMIN_PASSWORD` tidak diperlukan lagi.

## Perbaikan MULAI PERMAINAN
1. Admin login dengan Google dan membuat room.
2. Siswa bergabung.
3. Admin klik **▶ MULAI PERMAINAN**.
4. Server memastikan token admin masih sah dan terhubung ke room yang benar.
5. Jika koneksi admin baru/reconnect belum tercatat sebagai teacher, peran admin dipulihkan otomatis.
6. Jika berhasil, semua client menerima soal pertama dan stopwatch dimulai.
7. Jika gagal, admin mendapat pesan penyebab yang jelas, bukan tombol yang diam.

# QUIZ NUSANTARA v3.1 — Railway Ready

Multiplayer quiz sekolah berbasis Node.js + Express + Socket.IO. Siswa masuk memakai kode room. Admin login **hanya menggunakan akun Google**, tanpa password.

## Fitur v3.1
- **Login Admin dengan Google** menggunakan Google Identity Services.
- Tidak lagi menggunakan `ADMIN_PASSWORD`.
- Opsional membatasi admin hanya ke email Google tertentu dengan `ADMIN_GOOGLE_EMAILS`.
- Room multiplayer real-time.
- Stopwatch per soal.
- Bank Soal dan Bank Kuis persisten.
- **100 soal bawaan untuk setiap mata pelajaran dan setiap kelas**:
  - SD 1–6
  - SMP 7–9
  - SMA 10–12
  - Bahasa Indonesia, Matematika, IPAS, Pendidikan Pancasila, Seni, PJOK
  - Total 72 paket bawaan × 100 soal = **7.200 soal**.
- Jawaban benar dan penjelasan disimpan di server/admin; siswa hanya menerima pertanyaan dan pilihan.
- PostgreSQL Railway untuk penyimpanan bank kuis.
- Generator lokal.
- Generator Internet + AI menggunakan OpenAI Responses API + web search.
- API key AI hanya berada di server Railway.

## Konfigurasi Railway

Pada service aplikasi, buka **Variables** dan isi:

```env
GOOGLE_CLIENT_ID=CLIENT_ID_DARI_GOOGLE_CLOUD
ADMIN_GOOGLE_EMAILS=guru@sekolah.sch.id
OPENAI_API_KEY=sk-ISI_API_KEY_ANDA
OPENAI_MODEL=gpt-5.6-luna
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

`ADMIN_GOOGLE_EMAILS` opsional. Jika diisi, hanya email yang tercantum yang boleh menjadi admin. Jika dikosongkan, setiap akun Google dengan email terverifikasi dapat login.

**`ADMIN_PASSWORD` tidak lagi digunakan.** Variabel lama tersebut boleh dihapus dari Railway.

## Membuat Google Client ID

1. Buka Google Cloud Console.
2. Buat/pilih project.
3. Aktifkan konfigurasi OAuth consent screen / Google Auth sesuai project.
4. Buat **OAuth 2.0 Client ID** dengan tipe **Web application**.
5. Pada **Authorized JavaScript origins**, tambahkan domain Railway aplikasi Anda, misalnya:
   `https://quiz-nusantara-v2-production.up.railway.app`
6. Salin **Client ID** (bukan Client Secret) ke `GOOGLE_CLIENT_ID`.
7. Jika hanya satu guru yang boleh login, masukkan email Google guru ke `ADMIN_GOOGLE_EMAILS`.

Login menggunakan Google diverifikasi server dengan token Google; aplikasi memeriksa issuer, audience/client ID, dan status email terverifikasi.

## PostgreSQL

Jika memakai PostgreSQL Railway, gunakan reference variable:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Sesuaikan `Postgres` dengan nama service database Anda.

Saat startup, aplikasi otomatis membuat/memperbarui 72 paket bank bawaan sehingga setiap kombinasi kelas + mata pelajaran memiliki 100 soal.

## Generator Internet + AI

Tambahkan:

```env
OPENAI_API_KEY=sk-ISI_API_KEY_ANDA
OPENAI_MODEL=gpt-5.6-luna
```

Jika tidak ingin menggunakan AI, aplikasi tetap berjalan menggunakan bank soal bawaan dan generator lokal.

## Deploy

1. Upload/push seluruh isi folder ke GitHub.
2. Railway akan melakukan deployment.
3. Tunggu deployment berhasil.
4. Isi Variables seperti di atas.
5. Redeploy bila Railway meminta.
6. Buka website → **Login sebagai Admin**.
7. Pilih kelas dan mata pelajaran.
8. Klik **Masuk dengan Google**.
9. Setelah login, room dibuat dan dapat dimainkan seperti versi sebelumnya.

## Keamanan

- Jangan memasukkan Google Client Secret atau OpenAI API key ke `index.html`.
- Jangan commit secret ke GitHub.
- Untuk sekolah, disarankan mengisi `ADMIN_GOOGLE_EMAILS` agar hanya akun guru yang diizinkan.

## Health check

`GET /health` mengembalikan status aplikasi dan versi.

## Start lokal

```bash
npm install
npm start
```

Default port: `3000`.


## v3.6 — Refresh, finish, student lobby, compact UI

- Memulihkan room Admin dan Siswa setelah refresh browser selama server masih hidup.
- Soal terakhir otomatis mengakhiri permainan setelah semua tim menjawab.
- Rekap lengkap jawaban tetap khusus Admin.
- Siswa mendapat layar terima kasih khusus setelah permainan selesai.
- Lobby siswa memiliki tampilan menunggu dan gambar siswi belajar.
- Home dan Live Control Admin dibuat lebih ringkas agar minim scroll.

## v3.4 — Fix multiplayer state
- Sesi Admin dipisahkan per-tab menggunakan `sessionStorage`, sehingga browser/tab siswa tidak mewarisi sesi Admin.
- `roomState` mengirim `viewerRole` agar server menjadi sumber kebenaran role.
- Event `questionStarted` membawa soal aman saat ini sehingga soal tetap tampil walaupun event diterima tidak berurutan.
- Saat permainan dimulai/berpindah soal, tampilan Admin dan Siswa dipaksa masuk ke layar game.


## v3.6 — Wizard Jenjang + Kurikulum Merdeka & Pembelajaran Mendalam
- Setelah login Google, admin memilih jenjang SD/SMP/SMA terlebih dahulu.
- Langkah berikutnya memilih kelas, mata pelajaran, tingkat kesulitan, dan jumlah soal.
- Mode Internet + AI menggunakan web search untuk memeriksa referensi pendidikan resmi sebelum menyusun soal.
- Prompt generator diarahkan pada Kurikulum Merdeka dan pendekatan Pembelajaran Mendalam: mindful, meaningful, joyful serta memahami–mengaplikasi–merefleksi.
- Pembelajaran Mendalam diperlakukan sebagai pendekatan pembelajaran, bukan nama kurikulum baru.
- Jika OPENAI_API_KEY tidak tersedia, aplikasi tetap membuat room dengan generator lokal sebagai fallback.


### v3.8
- Tombol LOGOUT Admin tidak menonaktifkan room; peserta tetap berada di room.
- Tombol TUTUP ROOM mengeluarkan seluruh peserta dan menghapus room aktif.
- Siswa otomatis kembali ke halaman awal ketika room ditutup.
- Admin dapat login kembali dengan akun Google yang sama untuk mengambil alih room yang masih aktif.
- Logo QUIZ NUSANTARA diperbarui dengan identitas visual Tut Wuri Handayani.


## v3.10
- Siswa kembali melihat pertanyaan dan 4 pilihan jawaban saat permainan dimulai.
- Siswa tidak memiliki tombol LOGOUT.
- Pada soal terakhir, tombol admin berubah menjadi SELESAI dan membuka rekapan akhir.
- Rekapan admin menampilkan semua soal, kunci, jawaban setiap tim, pengirim jawaban, serta status BENAR/SALAH/BELUM MENJAWAB.
