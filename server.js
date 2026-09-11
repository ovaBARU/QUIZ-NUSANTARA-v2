import express from 'express';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import {randomBytes} from 'crypto';
import {createServer} from 'http';
import {WebSocketServer, WebSocket} from 'ws';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||(process.env.NODE_ENV==='production'?null:'ravixo-development-only-secret');
if(!JWT_SECRET && process.env.NODE_ENV==='production') throw new Error('JWT_SECRET belum dikonfigurasi. Tambahkan secret kuat di Railway.');

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:false});
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));
const uploads=path.join(__dirname,'uploads'); fs.mkdirSync(uploads,{recursive:true});
const storage=multer.diskStorage({destination:uploads,filename:(r,f,cb)=>cb(null,`${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(f.originalname)}`)});
const upload=multer({storage,limits:{fileSize:100*1024*1024},fileFilter:(r,f,cb)=>cb(null,/^(image|video)\//.test(f.mimetype))});
app.use('/uploads',express.static(uploads));

async function init(){
  if(!process.env.DATABASE_URL){throw new Error('DATABASE_URL belum dikonfigurasi. Tambahkan PostgreSQL di Railway.');}
  const schema=fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
  await pool.query(schema);
}

function verifyToken(raw){try{return jwt.verify(raw,JWT_SECRET)}catch{return null}}
function auth(req,res,next){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Login diperlukan.'});const payload=verifyToken(h.slice(7));if(!payload)return res.status(401).json({error:'Sesi tidak valid atau sudah kedaluwarsa.'});req.user=payload;next()}
function optionalAuth(req,res,next){const h=req.headers.authorization||'';if(h.startsWith('Bearer ')){const payload=verifyToken(h.slice(7));if(payload)req.user=payload}next()}
function sign(u){return jwt.sign({id:String(u.id),email:u.email,username:u.username},JWT_SECRET,{expiresIn:'7d'});}
app.get('/health',(req,res)=>res.json({ok:true,service:'RAVIXO',time:new Date().toISOString()}));
app.get('/api/config',(req,res)=>res.json({google_client_id:process.env.GOOGLE_CLIENT_ID||''}));
async function verifyGoogleCredential(credential){
  if(!process.env.GOOGLE_CLIENT_ID)throw new Error('GOOGLE_CLIENT_ID belum dikonfigurasi di Railway.');
  const r=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(String(credential||'')));
  if(!r.ok)throw new Error('Token Google tidak valid.');
  const p=await r.json();
  if(p.aud!==process.env.GOOGLE_CLIENT_ID)throw new Error('Token Google bukan untuk aplikasi RAVIXO.');
  if(p.iss!=='https://accounts.google.com'&&p.iss!=='accounts.google.com')throw new Error('Penerbit token Google tidak valid.');
  if(!p.email||!(p.email_verified===true||p.email_verified==='true'))throw new Error('Email Google belum terverifikasi.');
  return p;
}
function googleUsername(email,name){
  const base=String(email||'').split('@')[0].toLowerCase().replace(/[^a-z0-9_]+/g,'').slice(0,20)||'ravixo';
  return base;
}
app.post('/api/auth/google',async(req,res)=>{try{
  const p=await verifyGoogleCredential(req.body.credential);
  const email=String(p.email).toLowerCase().trim();
  const existing=await pool.query('SELECT * FROM users WHERE lower(email)=$1',[email]);
  if(existing.rowCount){const u=existing.rows[0];return res.json({token:sign(u),user:{id:u.id,email:u.email,phone:u.phone,display_name:u.display_name,username:u.username}})}
  // Akun baru dari Google tetap wajib melengkapi nomor HP satu kali.
  const phone=String(req.body.phone||'').replace(/[^0-9+]/g,'');
  const displayName=String(req.body.display_name||p.name||email.split('@')[0]).trim().slice(0,100);
  let username=String(req.body.username||googleUsername(email,p.name)).trim().toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,30)||'ravixo';
  if(!phone){
    return res.status(409).json({
      needs_phone:true,email,display_name:displayName,username,
      error:'Masukkan nomor HP satu kali untuk menyelesaikan pendaftaran Google.'
    });
  }
  if(!/^\+?[0-9]{9,15}$/.test(phone)) return res.status(400).json({error:'Nomor HP tidak valid. Gunakan 9-15 digit, boleh diawali +.'});
  const takenPhone=await pool.query('SELECT 1 FROM users WHERE phone=$1',[phone]);
  if(takenPhone.rowCount) return res.status(409).json({error:'Nomor HP sudah digunakan.'});
  const taken=await pool.query('SELECT 1 FROM users WHERE lower(username)=$1',[username]);
  if(taken.rowCount){username=username.slice(0,24)+'_'+Math.random().toString(36).slice(2,7)}
  const passwordHash=await bcrypt.hash(randomBytes(32).toString('hex'),12);
  const r=await pool.query('INSERT INTO users(email,phone,password_hash,display_name,username) VALUES($1,$2,$3,$4,$5) RETURNING id,email,phone,display_name,username',[email,phone,passwordHash,displayName,username]);
  await pool.query('INSERT INTO creators(user_id) VALUES($1)',[r.rows[0].id]);
  return res.status(201).json({token:sign(r.rows[0]),user:r.rows[0]});
}catch(e){console.error(e);res.status(e.message.includes('GOOGLE_CLIENT_ID')?503:400).json({error:e.message||'Login Google gagal.'})}});
app.post('/api/auth/register',async(req,res)=>{try{const {email,phone,password,display_name,username}=req.body;const normalizedEmail=String(email||'').toLowerCase().trim();const normalizedPhone=String(phone||'').replace(/[^0-9+]/g,'');if(!normalizedEmail||!normalizedPhone||!display_name||!username||!password||password.length<8)return res.status(400).json({error:'Email, nomor HP, nama, username dan password minimal 8 karakter wajib diisi.'});if(!/^\+?[0-9]{9,15}$/.test(normalizedPhone))return res.status(400).json({error:'Nomor HP tidak valid. Gunakan 9-15 digit, boleh diawali +.'});const hash=await bcrypt.hash(password,12);const r=await pool.query('INSERT INTO users(email,phone,password_hash,display_name,username) VALUES($1,$2,$3,$4,$5) RETURNING id,email,phone,display_name,username',[normalizedEmail,normalizedPhone,hash,display_name.trim(),username.trim().toLowerCase()]);await pool.query('INSERT INTO creators(user_id) VALUES($1)',[r.rows[0].id]);res.status(201).json({token:sign(r.rows[0]),user:r.rows[0]});}catch(e){res.status(400).json({error:e.code==='23505'?(String(e.detail||'').toLowerCase().includes('phone')?'Nomor HP sudah digunakan.':'Email atau username sudah digunakan.'):'Gagal membuat akun.'});}});
app.post('/api/auth/login',async(req,res)=>{try{const {identifier,email,phone,password}=req.body;const value=String(identifier!=null?identifier:(email||phone)||'').trim();if(!value||!password)return res.status(400).json({error:'Email atau nomor HP dan password wajib diisi.'});const looksLikeEmail=value.includes('@');const normalizedEmail=value.toLowerCase();const normalizedPhone=value.replace(/[^0-9+]/g,'');const r=looksLikeEmail?await pool.query('SELECT * FROM users WHERE lower(email)=$1',[normalizedEmail]):await pool.query('SELECT * FROM users WHERE phone=$1',[normalizedPhone]);if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'Email/nomor HP atau password salah.'});const u=r.rows[0];res.json({token:sign(u),user:{id:u.id,email:u.email,phone:u.phone,display_name:u.display_name,username:u.username}});}catch(e){console.error(e);res.status(500).json({error:'Server gagal memproses login.'});}});
app.get('/api/me',auth,async(req,res)=>{const r=await pool.query('SELECT id,email,phone,display_name,username,bio,city,work,education,website,avatar_url,created_at FROM users WHERE id=$1',[req.user.id]);res.json({user:r.rows[0]});});
app.put('/api/me',auth,async(req,res)=>{try{const displayName=String(req.body.display_name||'').trim();const username=String(req.body.username||'').trim().toLowerCase();const bio=String(req.body.bio||'').trim();const city=String(req.body.city||'').trim();const work=String(req.body.work||'').trim();const education=String(req.body.education||'').trim();const website=String(req.body.website||'').trim();if(!displayName||!username)return res.status(400).json({error:'Nama tampilan dan username wajib diisi.'});if(displayName.length>100||username.length>30||bio.length>500||city.length>100||work.length>120||education.length>120||website.length>200)return res.status(400).json({error:'Data profil terlalu panjang.'});if(website&&!/^https?:\/\//i.test(website))return res.status(400).json({error:'Website harus diawali http:// atau https://.'});const r=await pool.query('UPDATE users SET display_name=$1,username=$2,bio=$3,city=$4,work=$5,education=$6,website=$7 WHERE id=$8 RETURNING id,email,display_name,username,bio,city,work,education,website,avatar_url,created_at',[displayName,username,bio||null,city||null,work||null,education||null,website||null,req.user.id]);res.json({user:r.rows[0]});}catch(e){res.status(400).json({error:e.code==='23505'?'Username sudah digunakan.':'Profil gagal diperbarui.'})}});
app.post('/api/me/avatar',auth,upload.single('avatar'),async(req,res)=>{try{if(!req.file||!req.file.mimetype.startsWith('image/'))return res.status(400).json({error:'Foto profil harus berupa gambar.'});const r=await pool.query('SELECT avatar_url FROM users WHERE id=$1',[req.user.id]);const old=r.rows[0]?.avatar_url;const url=`/uploads/${req.file.filename}`;await pool.query('UPDATE users SET avatar_url=$1 WHERE id=$2',[url,req.user.id]);
    await pool.query('INSERT INTO posts(user_id,caption,visibility,media_url,media_type) VALUES($1,$2,$3,$4,$5)',[req.user.id,'memperbarui foto profil','public',url,'image']);
    if(old&&old.startsWith('/uploads/')){const oldPath=path.join(uploads,path.basename(old));if(fs.existsSync(oldPath))fs.unlinkSync(oldPath)}res.json({avatar_url:url,posted:true})}catch(e){if(req.file){const fp=path.join(uploads,req.file.filename);if(fs.existsSync(fp))fs.unlinkSync(fp)}res.status(500).json({error:'Foto profil gagal diperbarui.'})}});
async function getPostForViewer(postId, viewerId){
  const r=await pool.query(`SELECT p.*,u.display_name,u.username,u.avatar_url
    FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=$1`,[postId]);
  if(!r.rowCount)return null;
  const p=r.rows[0];
  const viewer=viewerId?String(viewerId):null;
  if(String(p.user_id)===viewer || p.visibility==='public') return p;
  if(!viewer)return null;
  if(p.visibility==='private')return null;
  if(p.visibility==='selected'){
    const a=await pool.query('SELECT 1 FROM post_audience_users WHERE post_id=$1 AND user_id=$2',[p.id,viewer]);
    return a.rowCount?p:null;
  }
  if(p.visibility==='friends'){
    const f=await pool.query(`SELECT 1 FROM follows f JOIN follows g
      ON g.follower_id=f.following_id AND g.following_id=f.follower_id
      WHERE f.follower_id=$1 AND f.following_id=$2`,[viewer,p.user_id]);
    return f.rowCount?p:null;
  }
  return null;
}
app.get('/api/posts',optionalAuth,async(req,res)=>{try{const limit=Math.min(Number(req.query.limit)||20,50),q=String(req.query.q||'').trim(),viewerId=req.user?req.user.id:null;const r=await pool.query(`SELECT p.*,u.display_name,u.username,u.avatar_url,(SELECT count(*) FROM likes l WHERE l.post_id=p.id) likes_count,(SELECT count(*) FROM comments c WHERE c.post_id=p.id) comments_count,(SELECT count(*) FROM shares s WHERE s.post_id=p.id) shares_count,(SELECT count(*) FROM views v WHERE v.post_id=p.id) views_count,CASE WHEN $3::bigint IS NULL THEN false WHEN p.user_id=$3 THEN false ELSE EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$3 AND f.following_id=p.user_id) END AS is_following,CASE WHEN $3::bigint IS NULL THEN false WHEN p.user_id=$3 THEN false ELSE EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=p.user_id AND f.following_id=$3) END AS is_followed_by FROM posts p JOIN users u ON u.id=p.user_id WHERE (($3::bigint IS NOT NULL AND p.user_id=$3) OR p.visibility='public' OR ($3::bigint IS NOT NULL AND p.visibility='friends' AND EXISTS(SELECT 1 FROM follows f JOIN follows g ON g.follower_id=f.following_id AND g.following_id=f.follower_id WHERE f.follower_id=$3 AND f.following_id=p.user_id)) OR ($3::bigint IS NOT NULL AND p.visibility='selected' AND EXISTS(SELECT 1 FROM post_audience_users au WHERE au.post_id=p.id AND au.user_id=$3))) AND ($2='' OR p.caption ILIKE '%'||$2||'%' OR u.username ILIKE '%'||$2||'%') ORDER BY p.created_at DESC LIMIT $1`,[limit,q,viewerId]);res.json({posts:r.rows});}catch(e){console.error(e);res.status(500).json({error:'Feed gagal dimuat.'})}});
app.post('/api/posts',auth,async(req,res)=>{try{const caption=String(req.body.caption||'').trim(),visibility=String(req.body.visibility||'public');const media_url=req.body.media_url||null,media_type=req.body.media_type||null;const allowed=['public','private','friends','selected'];if(!caption&&!media_url)return res.status(400).json({error:'Postingan harus memiliki teks atau media.'});if(!allowed.includes(visibility))return res.status(400).json({error:'Pilihan privasi tidak valid.'});let ids=Array.isArray(req.body.audience_user_ids)?[...new Set(req.body.audience_user_ids.map(String).filter(x=>/^\d+$/.test(x)&&x!==String(req.user.id)))]:[];if(visibility==='selected'){if(!ids.length)return res.status(400).json({error:'Pilih minimal satu teman.'});const friends=await pool.query(`SELECT u.id FROM follows f JOIN follows g ON g.follower_id=f.following_id AND g.following_id=f.follower_id JOIN users u ON u.id=f.following_id WHERE f.follower_id=$1 AND u.id=ANY($2::bigint[])`,[req.user.id,ids]);ids=friends.rows.map(x=>String(x.id));if(!ids.length)return res.status(400).json({error:'Teman terpilih tidak valid.'})}else ids=[];const r=await pool.query('INSERT INTO posts(user_id,caption,visibility,media_url,media_type) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.id,caption,visibility,media_url,media_type]);if(ids.length)await pool.query('INSERT INTO post_audience_users(post_id,user_id) SELECT $1,unnest($2::bigint[]) ON CONFLICT DO NOTHING',[r.rows[0].id,ids]);res.status(201).json({post:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'Postingan gagal dibuat.'})}});
app.delete('/api/posts/:id',auth,async(req,res)=>{try{const r=await pool.query('SELECT media_url FROM posts WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Postingan tidak ditemukan atau bukan milikmu.'});const mediaUrl=r.rows[0].media_url;await pool.query('DELETE FROM posts WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(mediaUrl&&String(mediaUrl).startsWith('/uploads/')){const fp=path.join(uploads,path.basename(mediaUrl));if(fs.existsSync(fp))fs.unlinkSync(fp)}res.json({ok:true});}catch(e){console.error(e);res.status(500).json({error:'Postingan gagal dihapus.'})}});
app.post('/api/upload',auth,upload.single('media'),(req,res)=>{if(!req.file)return res.status(400).json({error:'File foto/video tidak valid.'});const type=req.file.mimetype.startsWith('video/')?'video':'image';res.status(201).json({url:`/uploads/${req.file.filename}`,media_type:type});});
app.post('/api/upload-multiple',auth,upload.array('media',10),(req,res)=>{try{const files=req.files||[];if(!files.length)return res.status(400).json({error:'Tidak ada file yang diunggah.'});const out=files.map(f=>({url:`/uploads/${f.filename}`,media_type:f.mimetype.startsWith('video/')?'video':'image'}));res.status(201).json({files:out});}catch(e){for(const f of (req.files||[])){const fp=path.join(uploads,f.filename);if(fs.existsSync(fp))fs.unlinkSync(fp)}res.status(500).json({error:'Upload beberapa media gagal.'})}});
app.post('/api/posts/:id/like',auth,async(req,res)=>{
  const post=await getPostForViewer(req.params.id,req.user.id);
  if(!post)return res.status(404).json({error:'Postingan tidak ditemukan atau tidak dapat diakses.'});
  await pool.query('INSERT INTO likes(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.id,req.params.id]);
  res.json({ok:true});
});
app.delete('/api/posts/:id/like',auth,async(req,res)=>{await pool.query('DELETE FROM likes WHERE user_id=$1 AND post_id=$2',[req.user.id,req.params.id]);res.json({ok:true});});
app.get('/api/posts/:id/comments',optionalAuth,async(req,res)=>{
  try{
    const post=await getPostForViewer(req.params.id,req.user?.id);
    if(!post)return res.status(404).json({error:'Postingan tidak ditemukan atau tidak dapat diakses.'});
    const r=await pool.query('SELECT c.*,u.display_name,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC',[req.params.id]);
    res.json({comments:r.rows});
  }catch(e){res.status(500).json({error:'Komentar gagal dimuat.'})}
});
app.post('/api/posts/:id/comments',auth,async(req,res)=>{
  const post=await getPostForViewer(req.params.id,req.user.id);
  if(!post)return res.status(404).json({error:'Postingan tidak ditemukan atau tidak dapat diakses.'});
  const body=String(req.body.body||'').trim();
  if(!body)return res.status(400).json({error:'Komentar kosong.'});
  if(body.length>2000)return res.status(400).json({error:'Komentar maksimal 2000 karakter.'});
  const r=await pool.query('INSERT INTO comments(user_id,post_id,body) VALUES($1,$2,$3) RETURNING *',[req.user.id,req.params.id,body]);
  res.status(201).json({comment:r.rows[0]});
});
app.post('/api/posts/:id/share',auth,async(req,res)=>{
  const post=await getPostForViewer(req.params.id,req.user.id);
  if(!post)return res.status(404).json({error:'Postingan tidak ditemukan atau tidak dapat diakses.'});
  const shareType=['internal','external'].includes(req.body.share_type)?req.body.share_type:'internal';
  await pool.query('INSERT INTO shares(user_id,post_id,share_type) VALUES($1,$2,$3)',[req.user.id,req.params.id,shareType]);
  res.json({ok:true});
});
app.post('/api/posts/:id/view',auth,async(req,res)=>{
  const post=await getPostForViewer(req.params.id,req.user.id);
  if(!post)return res.status(404).json({error:'Postingan tidak ditemukan atau tidak dapat diakses.'});
  await pool.query('INSERT INTO views(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.id,req.params.id]);
  res.json({ok:true});
});
app.get('/api/users/search',auth,async(req,res)=>{try{const q=String(req.query.q||'').trim();const r=await pool.query(`SELECT u.id,u.display_name,u.username,u.avatar_url,u.bio,u.city,u.work,u.education,u.website,(SELECT count(*) FROM posts p WHERE p.user_id=u.id) posts_count,(SELECT count(*) FROM follows f WHERE f.following_id=u.id) followers_count,(SELECT count(*) FROM follows f WHERE f.follower_id=u.id) following_count,EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=u.id) AS is_following,EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=u.id AND f.following_id=$1) AS is_followed_by FROM users u WHERE u.id<>$1 AND ($2='' OR u.display_name ILIKE '%'||$2||'%' OR u.username ILIKE '%'||$2||'%') ORDER BY u.username ASC LIMIT 50`,[req.user.id,q]);res.json({users:r.rows});}catch(e){res.status(500).json({error:'Pencarian pengguna gagal.'})}});
app.get('/api/users/:id',auth,async(req,res)=>{try{const r=await pool.query(`SELECT u.id,u.display_name,u.username,u.avatar_url,u.bio,u.city,u.work,u.education,u.website,(SELECT count(*) FROM posts p WHERE p.user_id=u.id) posts_count,(SELECT count(*) FROM follows f WHERE f.following_id=u.id) followers_count,(SELECT count(*) FROM follows f WHERE f.follower_id=u.id) following_count,EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=u.id) AS is_following,EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=u.id AND f.following_id=$1) AS is_followed_by FROM users u WHERE u.id=$2`,[req.user.id,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Pengguna tidak ditemukan.'});res.json({user:r.rows[0]})}catch(e){res.status(500).json({error:'Profil pengguna gagal dimuat.'})}});
app.post('/api/users/:id/follow',auth,async(req,res)=>{try{const target=String(req.params.id);if(target===String(req.user.id))return res.status(400).json({error:'Tidak dapat mengikuti diri sendiri.'});const u=await pool.query('SELECT id,username FROM users WHERE id=$1',[target]);if(!u.rowCount)return res.status(404).json({error:'Pengguna tidak ditemukan.'});await pool.query('INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.id,target]);await pool.query(`INSERT INTO notifications(user_id,type,message) SELECT $1,'follow',$2 WHERE NOT EXISTS(SELECT 1 FROM notifications WHERE user_id=$1 AND type='follow' AND message=$2 AND created_at > now()-interval '1 minute')`,[target,`@${req.user.username} mulai mengikuti Anda`]);res.json({ok:true,following:true})}catch(e){console.error(e);res.status(500).json({error:'Gagal mengikuti pengguna.'})}});
app.delete('/api/users/:id/follow',auth,async(req,res)=>{try{await pool.query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2',[req.user.id,req.params.id]);res.json({ok:true,following:false})}catch(e){res.status(500).json({error:'Gagal berhenti mengikuti pengguna.'})}});
app.get('/api/users/:id/posts',auth,async(req,res)=>{try{const r=await pool.query(`SELECT p.*,u.display_name,u.username,u.avatar_url,(SELECT count(*) FROM likes l WHERE l.post_id=p.id) likes_count,(SELECT count(*) FROM comments c WHERE c.post_id=p.id) comments_count,(SELECT count(*) FROM shares s WHERE s.post_id=p.id) shares_count,(SELECT count(*) FROM views v WHERE v.post_id=p.id) views_count,EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) liked FROM posts p JOIN users u ON u.id=p.user_id WHERE p.user_id=$2 AND (p.visibility='public' OR p.user_id=$1 OR (p.visibility='friends' AND EXISTS(SELECT 1 FROM follows f JOIN follows g ON g.follower_id=f.following_id AND g.following_id=f.follower_id WHERE f.follower_id=$1 AND f.following_id=p.user_id)) OR (p.visibility='selected' AND EXISTS(SELECT 1 FROM post_audience_users au WHERE au.post_id=p.id AND au.user_id=$1))) ORDER BY p.created_at DESC LIMIT 50`,[req.user.id,req.params.id]);res.json({posts:r.rows})}catch(e){res.status(500).json({error:'Postingan profil gagal dimuat.'})}});
app.get('/api/users/:id/friends',auth,async(req,res)=>{try{const r=await pool.query(`SELECT u.id,u.display_name,u.username,u.avatar_url FROM follows f JOIN follows g ON g.follower_id=f.following_id AND g.following_id=f.follower_id JOIN users u ON u.id=f.following_id WHERE f.follower_id=$1 ORDER BY GREATEST(f.created_at,g.created_at) DESC LIMIT 100`,[req.params.id]);res.json({users:r.rows})}catch(e){res.status(500).json({error:'Daftar teman gagal dimuat.'})}});
app.get('/api/users/:id/followers',auth,async(req,res)=>{try{const r=await pool.query(`SELECT u.id,u.display_name,u.username,u.avatar_url FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=$1 ORDER BY f.created_at DESC LIMIT 100`,[req.params.id]);res.json({users:r.rows})}catch(e){res.status(500).json({error:'Daftar pengikut gagal dimuat.'})}});
app.get('/api/users/:id/following',auth,async(req,res)=>{try{const r=await pool.query(`SELECT u.id,u.display_name,u.username,u.avatar_url FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=$1 ORDER BY f.created_at DESC LIMIT 100`,[req.params.id]);res.json({users:r.rows})}catch(e){res.status(500).json({error:'Daftar yang diikuti gagal dimuat.'})}});
app.get('/api/users/:id/albums',auth,async(req,res)=>{try{const type=String(req.query.type||'').trim();const r=await pool.query(`SELECT a.id,a.name,a.album_type,a.created_at,a.updated_at,(SELECT count(*) FROM posts p WHERE p.album_id=a.id AND p.media_url IS NOT NULL) media_count FROM albums a WHERE a.user_id=$1 AND ($2='' OR a.album_type=$2) ORDER BY a.updated_at DESC,a.created_at DESC LIMIT 100`,[req.params.id,type]);res.json({albums:r.rows})}catch(e){res.status(500).json({error:'Album profil gagal dimuat.'})}});
app.get('/api/users/:id/albums/:albumId/media',auth,async(req,res)=>{try{const r=await pool.query(`SELECT p.id,p.media_url,p.media_type,p.created_at FROM posts p JOIN albums a ON a.id=p.album_id WHERE a.id=$1 AND a.user_id=$2 AND p.media_url IS NOT NULL ORDER BY p.created_at DESC LIMIT 100`,[req.params.albumId,req.params.id]);res.json({media:r.rows})}catch(e){res.status(500).json({error:'Isi album profil gagal dimuat.'})}});
app.get('/api/messages/users',auth,async(req,res)=>{try{const q=String(req.query.q||'').trim();const r=await pool.query(`SELECT u.id,u.display_name,u.username,u.avatar_url,MAX(m.created_at) AS last_message_at FROM users u JOIN messages m ON ((m.sender_id=$1 AND m.receiver_id=u.id) OR (m.receiver_id=$1 AND m.sender_id=u.id)) WHERE u.id<>$1 AND ($2='' OR u.display_name ILIKE '%'||$2||'%' OR u.username ILIKE '%'||$2||'%') GROUP BY u.id,u.display_name,u.username,u.avatar_url ORDER BY last_message_at DESC LIMIT 50`,[req.user.id,q]);res.json({users:r.rows});}catch(e){res.status(500).json({error:'Daftar riwayat pesan gagal dimuat.'});}});
app.get('/api/messages/:userId',auth,async(req,res)=>{try{const other=String(req.params.userId);if(other===String(req.user.id))return res.status(400).json({error:'Tidak dapat membuka chat dengan diri sendiri.'});const u=await pool.query('SELECT id,display_name,username,avatar_url FROM users WHERE id=$1',[other]);if(!u.rowCount)return res.status(404).json({error:'Pengguna tidak ditemukan.'});const r=await pool.query(`SELECT m.id,m.sender_id,m.receiver_id,m.body,m.created_at,m.read_at,u.display_name AS sender_name,u.username AS sender_username FROM messages m JOIN users u ON u.id=m.sender_id WHERE (m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1) ORDER BY m.created_at ASC LIMIT 200`,[req.user.id,other]);await pool.query('UPDATE messages SET read_at=now() WHERE sender_id=$1 AND receiver_id=$2 AND read_at IS NULL',[other,req.user.id]);res.json({user:u.rows[0],messages:r.rows});}catch(e){res.status(500).json({error:'Pesan gagal dimuat.'});}});
app.post('/api/messages',auth,async(req,res)=>{try{const receiverId=String(req.body.receiver_id||'');const body=String(req.body.body||'').trim();if(!receiverId||!body)return res.status(400).json({error:'Penerima dan isi pesan wajib diisi.'});if(receiverId===String(req.user.id))return res.status(400).json({error:'Tidak dapat mengirim pesan ke diri sendiri.'});if(body.length>5000)return res.status(400).json({error:'Pesan maksimal 5000 karakter.'});const u=await pool.query('SELECT id,display_name,username,avatar_url FROM users WHERE id=$1',[receiverId]);if(!u.rowCount)return res.status(404).json({error:'Pengguna tidak ditemukan.'});const r=await pool.query('INSERT INTO messages(sender_id,receiver_id,body) VALUES($1,$2,$3) RETURNING id,sender_id,receiver_id,body,created_at,read_at',[req.user.id,receiverId,body]);await pool.query('INSERT INTO notifications(user_id,type,message) VALUES($1,$2,$3)',[receiverId,'message',`Pesan baru dari @${req.user.username}`]);res.status(201).json({message:r.rows[0],user:u.rows[0]});}catch(e){res.status(500).json({error:'Pesan gagal dikirim.'});}});
app.get('/api/notifications',auth,async(req,res)=>{try{const r=await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[req.user.id]);const unread=await pool.query('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL',[req.user.id]);res.json({notifications:r.rows,unread_count:unread.rows[0].count});}catch(e){res.status(500).json({error:'Notifikasi gagal dimuat.'});}});
app.post('/api/notifications/read',auth,async(req,res)=>{try{await pool.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL',[req.user.id]);res.json({ok:true});}catch(e){res.status(500).json({error:'Notifikasi gagal diperbarui.'});}});
app.get('/api/albums',auth,async(req,res)=>{try{const type=String(req.query.type||'').trim();const r=await pool.query(`SELECT a.id,a.name,a.album_type,a.created_at,a.updated_at,(SELECT count(*) FROM posts p WHERE p.album_id=a.id) media_count FROM albums a WHERE a.user_id=$1 AND ($2='' OR a.album_type=$2) ORDER BY a.updated_at DESC,a.created_at DESC`,[req.user.id,type]);res.json({albums:r.rows})}catch(e){res.status(500).json({error:'Album gagal dimuat.'})}});
app.post('/api/albums',auth,async(req,res)=>{try{const name=String(req.body.name||'').trim(),type=String(req.body.album_type||'').trim();if(!name||!['photo','video'].includes(type))return res.status(400).json({error:'Nama dan jenis album wajib diisi.'});if(name.length>80)return res.status(400).json({error:'Nama album maksimal 80 karakter.'});const r=await pool.query('INSERT INTO albums(user_id,name,album_type) VALUES($1,$2,$3) RETURNING *',[req.user.id,name,type]);res.status(201).json({album:r.rows[0]})}catch(e){res.status(500).json({error:'Album gagal dibuat.'})}});
app.put('/api/albums/:id',auth,async(req,res)=>{try{const name=String(req.body.name||'').trim();if(!name||name.length>80)return res.status(400).json({error:'Nama album wajib diisi dan maksimal 80 karakter.'});const r=await pool.query('UPDATE albums SET name=$1,updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING *',[name,req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Album tidak ditemukan.'});res.json({album:r.rows[0]})}catch(e){res.status(500).json({error:'Nama album gagal diubah.'})}});
app.delete('/api/albums/:id',auth,async(req,res)=>{try{const r=await pool.query('DELETE FROM albums WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Album tidak ditemukan.'});res.json({ok:true})}catch(e){res.status(500).json({error:'Album gagal dihapus.'})}});
app.get('/api/albums/:id/media',auth,async(req,res)=>{try{const r=await pool.query(`SELECT p.*,u.display_name,u.username,u.avatar_url,(SELECT count(*) FROM likes l WHERE l.post_id=p.id) likes_count,(SELECT count(*) FROM comments c WHERE c.post_id=p.id) comments_count,(SELECT count(*) FROM shares s WHERE s.post_id=p.id) shares_count,(SELECT count(*) FROM views v WHERE v.post_id=p.id) views_count,EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) liked FROM posts p JOIN users u ON u.id=p.user_id JOIN albums a ON a.id=p.album_id WHERE a.id=$2 AND a.user_id=$1 ORDER BY p.created_at DESC LIMIT 100`,[req.user.id,req.params.id]);res.json({posts:r.rows})}catch(e){res.status(500).json({error:'Isi album gagal dimuat.'})}});
app.post('/api/albums/:id/media',auth,upload.single('media'),async(req,res)=>{try{if(!req.file)return res.status(400).json({error:'Media tidak valid.'});const a=await pool.query('SELECT id,album_type FROM albums WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!a.rowCount){const fp=path.join(uploads,req.file.filename);if(fs.existsSync(fp))fs.unlinkSync(fp);return res.status(404).json({error:'Album tidak ditemukan.'})}const type=req.file.mimetype.startsWith('video/')?'video':'image';const expected=a.rows[0].album_type;if(type!==(expected==='photo'?'image':'video')){const fp=path.join(uploads,req.file.filename);if(fs.existsSync(fp))fs.unlinkSync(fp);return res.status(400).json({error:`Album ini khusus ${expected==='photo'?'foto':'video'}.`})}const url=`/uploads/${req.file.filename}`;const r=await pool.query('INSERT INTO posts(user_id,caption,visibility,media_url,media_type,album_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.user.id,'','public',url,type,a.rows[0].id]);await pool.query('UPDATE albums SET updated_at=now() WHERE id=$1',[req.params.id]);res.status(201).json({post:r.rows[0]})}catch(e){if(req.file){const fp=path.join(uploads,req.file.filename);if(fs.existsSync(fp))fs.unlinkSync(fp)}res.status(500).json({error:'Media album gagal diunggah.'})}});
app.post('/api/live',auth,async(req,res)=>{try{const existing=await pool.query("SELECT id,title FROM live_streams WHERE user_id=$1 AND status='live' ORDER BY created_at DESC LIMIT 1",[req.user.id]);if(existing.rowCount)return res.json({stream:existing.rows[0]});const title=String(req.body.title||'Siaran langsung RAVIXO').trim().slice(0,120)||'Siaran langsung RAVIXO';const r=await pool.query("INSERT INTO live_streams(user_id,title,status) VALUES($1,$2,'live') RETURNING id,title,status,created_at",[req.user.id,title]);res.status(201).json({stream:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'Live gagal dimulai.'})}});
app.get('/api/live/active/:userId',optionalAuth,async(req,res)=>{try{const r=await pool.query("SELECT l.id,l.title,l.created_at,l.user_id,u.display_name,u.username,u.avatar_url FROM live_streams l JOIN users u ON u.id=l.user_id WHERE l.user_id=$1 AND l.status='live' ORDER BY l.created_at DESC LIMIT 1",[req.params.userId]);res.json({stream:r.rows[0]||null})}catch(e){res.status(500).json({error:'Status live gagal dimuat.'})}});
app.post('/api/live/:id/end',auth,async(req,res)=>{try{const r=await pool.query("UPDATE live_streams SET status='ended',ended_at=now() WHERE id=$1 AND user_id=$2 AND status='live' RETURNING id",[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Siaran tidak ditemukan.'});res.json({ok:true})}catch(e){res.status(500).json({error:'Live gagal diakhiri.'})}});

app.get('/api/creator/dashboard',auth,async(req,res)=>{const r=await pool.query('SELECT * FROM creators WHERE user_id=$1',[req.user.id]);res.json({creator:r.rows[0]||null});});
app.post('/api/creator/payouts',auth,async(req,res)=>{const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Jumlah pencairan tidak valid.'});const client=await pool.connect();try{await client.query('BEGIN');const c=await client.query('SELECT balance FROM creators WHERE user_id=$1 FOR UPDATE',[req.user.id]);if(!c.rowCount||amount>Number(c.rows[0].balance)){await client.query('ROLLBACK');return res.status(400).json({error:'Saldo tidak mencukupi.'});}await client.query('UPDATE creators SET balance=balance-$1,pending_balance=pending_balance+$1 WHERE user_id=$2',[amount,req.user.id]);const p=await client.query('INSERT INTO payouts(user_id,amount) VALUES($1,$2) RETURNING *',[req.user.id,amount]);await client.query('COMMIT');res.status(201).json({payout:p.rows[0]});}catch(e){await client.query('ROLLBACK');res.status(500).json({error:'Pencairan gagal diproses.'});}finally{client.release();}});
app.get('/api/search',async(req,res)=>{req.url='/api/posts?limit=50&q='+encodeURIComponent(req.query.q||'');return app._router.handle(req,res,()=>{});});
app.use(express.static(__dirname));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
const server=createServer(app);
const wss=new WebSocketServer({server,path:'/live'});
const liveRooms=new Map();
wss.on('connection',(ws,req)=>{
  let room=null,role=null,user=null;
  try{const u=new URL(req.url,'http://localhost');user=verifyToken(u.searchParams.get('token')||'');}catch{}
  if(!user){ws.close(1008,'Login diperlukan');return;}
  ws.on('message',raw=>{try{const msg=JSON.parse(raw.toString());
    if(msg.type==='join'){room=String(msg.streamId||'');role=msg.role==='host'?'host':'viewer';if(!room){ws.close();return;}let set=liveRooms.get(room);if(!set){set=new Set();liveRooms.set(room,set);}set.add(ws);
      if(role==='host'){for(const peer of set){if(peer!==ws&&peer.readyState===WebSocket.OPEN)peer.send(JSON.stringify({type:'host-ready'}));}}
      else {for(const peer of set){if(peer!==ws&&peer._liveRole==='host'&&peer.readyState===WebSocket.OPEN)peer.send(JSON.stringify({type:'viewer-joined',viewerId:String(user.id)}));}}
      ws._liveRole=role;ws._liveUser=String(user.id);return;}
    if(!room)return;const set=liveRooms.get(room)||new Set();
    for(const peer of set){if(peer!==ws&&peer.readyState===WebSocket.OPEN){if(!msg.to||String(peer._liveUser)===String(msg.to)||msg.type==='broadcast')peer.send(JSON.stringify({...msg,from:String(user.id)}));}}
  }catch{}});
  ws.on('close',()=>{if(room){const set=liveRooms.get(room);set?.delete(ws);if(set&&set.size===0)liveRooms.delete(room);}});
});
init().then(()=>server.listen(PORT,()=>console.log(`RAVIXO running on ${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
