# RAVIXO — GitHub + Railway Ready

RAVIXO is a single-service Express + PostgreSQL social-media application.

## Railway

1. Upload the CONTENT of this folder to the root of a new GitHub repository. Do not put it inside another `RAVIXO/` subfolder.
2. In Railway, connect that GitHub repository as the RAVIXO service.
3. Add a PostgreSQL service to the same Railway project.
4. Ensure the RAVIXO service receives `DATABASE_URL` from PostgreSQL.
5. Add `JWT_SECRET` with a long random secret.
6. Set the service Start Command to `npm start` (or leave the included `railway.toml` in the repository).
7. Deploy. The app runs the database migration first, then starts Express.
8. Open `/health`; a healthy service returns JSON with `ok: true`.

## Important

Do not merge this project with an older repository that has a different `package.json`, `src/`, `database/`, `scripts/`, or a start command such as `npm run migrate` unless you intentionally merge them. The previous Railway error `npm error Missing script: "migrate"` means Railway was executing a `migrate` script that did not exist in the deployed package.json.

## Local

```bash
npm install
npm start
```

Environment variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — required secret for JWT signing
- `PORT` — optional; Railway provides it automatically

## Media

Uploaded media is stored under `uploads/`. Railway service storage can be ephemeral, so production deployments should eventually move media to object storage such as S3/R2/Supabase Storage.

### Private chat
The Messages menu now supports private one-to-one chat. The migration adds a `messages` table automatically, and the server exposes user search plus message send/read endpoints.

## Fitur terbaru
- Setiap akun dapat mengunggah dan mengganti foto profil dari Pengaturan.
- Foto profil tampil di header, sidebar, feed, daftar teman, pesan, dan profil.
- Menu Teman memiliki tab Teman, Mengikuti, Pengikut, dan Cari Pengguna.
- Akun yang saling mengikuti ditandai sebagai `👥 Teman`.
- Tersedia Album Foto dan Album Video, termasuk membuat album, membuka album, mengunggah media ke album, dan rename album.
- Video portrait tetap ditampilkan portrait di PC dengan `object-fit: contain` dan ukuran tinggi adaptif.

## Google Sign-In
RAVIXO now supports the official Google Identity Services button and One Tap. Add this Railway variable:
- `GOOGLE_CLIENT_ID` = OAuth 2.0 Web Client ID from Google Cloud.

In the Google Cloud OAuth client, add the exact RAVIXO Railway domain as an authorized JavaScript origin. Google Sign-In can automatically sign in existing Google accounts. For a brand-new RAVIXO account, Google does not provide the user's phone number to the site through standard Sign in with Google, so RAVIXO asks for the phone number once before creating the account. Private/friends/selected post interactions are also checked server-side, so clients cannot bypass post privacy by calling comment/like/share/view endpoints directly.
