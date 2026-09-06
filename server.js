const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
app.set("trust proxy", 1);

app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});
app.get("/health", (req, res) => {
  res.json({ ok: true, app: "QUIZ NUSANTARA", version: "3.3.0" });
});

app.use(express.json({ limit: "1mb" }));
app.post("/api/admin/google-login", async (req, res) => {
  try {
    const credential = String(req.body?.credential || "").trim();
    if (!credential) return res.status(400).json({ ok:false, message:"Token Google tidak ditemukan." });
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ ok:false, message:"GOOGLE_CLIENT_ID belum diatur di Railway." });

    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
    const info = await r.json();
    if (!r.ok) return res.status(401).json({ ok:false, message:"Login Google tidak valid." });

    const issuer = String(info.iss || "");
    const audience = String(info.aud || "");
    const email = String(info.email || "").trim().toLowerCase();
    const verified = String(info.email_verified || "").toLowerCase() === "true";
    if (!["accounts.google.com", "https://accounts.google.com"].includes(issuer)) return res.status(401).json({ ok:false, message:"Penerbit akun Google tidak valid." });
    if (audience !== GOOGLE_CLIENT_ID) return res.status(401).json({ ok:false, message:"Google Client ID tidak cocok." });
    if (!email || !verified) return res.status(401).json({ ok:false, message:"Email Google harus terverifikasi." });

    const allowlist = ADMIN_GOOGLE_EMAILS.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
    if (allowlist.length && !allowlist.includes(email)) {
      return res.status(403).json({ ok:false, message:"Email Google ini belum diizinkan sebagai admin." });
    }

    const name = String(info.name || info.given_name || email.split("@")[0] || "Admin").trim();
    const token = issueAdminSession(name, email);
    res.json({ ok:true, token, name, email, expiresIn: ADMIN_SESSION_MS });
  } catch (err) {
    console.error("Google login error:", err);
    res.status(500).json({ ok:false, message:"Login Google gagal diproses." });
  }
});

app.get("/api/google-config", (req, res) => {
  res.json({ enabled: !!GOOGLE_CLIENT_ID, clientId: GOOGLE_CLIENT_ID || "" });
});

app.get("/api/quizzes", (req, res) => {
  res.json({ storage: storageMode, quizzes: quizBank.map(publicQuiz) });
});

app.get("/api/ai-status", (req, res) => {
  res.json({ enabled: !!OPENAI_API_KEY, model: OPENAI_MODEL, webSearch: !!OPENAI_API_KEY });
});

const rooms = new Map();
const adminSessions = new Map();
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const ADMIN_GOOGLE_EMAILS = String(process.env.ADMIN_GOOGLE_EMAILS || "").trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-5.6-luna").trim();

function issueAdminSession(name, email="") {
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, { name: String(name || "Admin").trim() || "Admin", email: String(email || "").trim().toLowerCase(), expiresAt: Date.now() + ADMIN_SESSION_MS });
  return token;
}
function validAdminToken(token) {
  const s = adminSessions.get(String(token || ""));
  if (!s) return null;
  if (s.expiresAt <= Date.now()) { adminSessions.delete(String(token || "")); return null; }
  return s;
}

// v2.8 persistence: Railway PostgreSQL when DATABASE_URL exists, JSON fallback otherwise.
const DATA_DIR = path.join(process.cwd(), "data");
const QUIZ_FILE = path.join(DATA_DIR, "quizzes.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 }) : null;
let storageMode = pool ? "postgres" : "json";

function cleanQuizQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map((q, i) => {
    const opts = Array.isArray(q.opts) ? q.opts.map(v => String(v ?? "").trim()).filter(Boolean).slice(0, 4) : [];
    const a = Number(q.a);
    return { id: i + 1, subject: String(q.subject || "Umum").trim() || "Umum", q: String(q.q || "").trim(), opts, a: Number.isInteger(a) && a >= 0 && a < opts.length ? a : 0, e: String(q.e || "").trim() };
  });
}

async function loadQuizBank() {
  if (pool) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS quiz_bank (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT, description TEXT, built_in BOOLEAN NOT NULL DEFAULT FALSE, questions JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`);
      const result = await pool.query(`SELECT id,name,subject,description,built_in,questions,updated_at FROM quiz_bank ORDER BY built_in DESC, updated_at DESC`);
      if (result.rows.length) return result.rows.map(r => ({ id:r.id, name:r.name, subject:r.subject, description:r.description, builtIn:r.built_in, questions:r.questions, updatedAt:r.updated_at }));
      const seed = Object.entries(subjects).map(([name, qs]) => ({ id: "builtin-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, subject:name, description:"Soal bawaan QUIZ NUSANTARA", builtIn:true, questions:cleanQuizQuestions(qs.map(q => ({...q, subject:name}))), updatedAt:new Date().toISOString() }));
      for (const q of seed) await pool.query(`INSERT INTO quiz_bank (id,name,subject,description,built_in,questions,updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (id) DO NOTHING`, [q.id,q.name,q.subject,q.description,q.builtIn,JSON.stringify(q.questions),q.updatedAt]);
      return seed;
    } catch (err) {
      console.error("PostgreSQL unavailable, falling back to JSON:", err.message);
      storageMode = "json";
    }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(QUIZ_FILE, "utf8"));
    if (Array.isArray(raw) && raw.length) return raw;
  } catch (_) {}
  const seed = Object.entries(subjects).map(([name, qs]) => ({ id:"builtin-"+name.toLowerCase().replace(/[^a-z0-9]+/g,"-"), name, subject:name, description:"Soal bawaan QUIZ NUSANTARA", builtIn:true, questions:cleanQuizQuestions(qs.map(q=>({...q,subject:name}))), updatedAt:new Date().toISOString() }));
  fs.writeFileSync(QUIZ_FILE, JSON.stringify(seed,null,2));
  return seed;
}

async function saveQuizBank() {
  if (storageMode === "postgres" && pool) {
    for (const q of quizBank) await pool.query(`INSERT INTO quiz_bank (id,name,subject,description,built_in,questions,updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,subject=EXCLUDED.subject,description=EXCLUDED.description,built_in=EXCLUDED.built_in,questions=EXCLUDED.questions,updated_at=EXCLUDED.updated_at`, [q.id,q.name,q.subject,q.description||"",!!q.builtIn,JSON.stringify(q.questions),q.updatedAt||new Date().toISOString()]);
    await pool.query(`DELETE FROM quiz_bank WHERE id <> ALL($1::text[])`, [quizBank.map(q=>q.id)]);
    return;
  }
  fs.writeFileSync(QUIZ_FILE, JSON.stringify(quizBank,null,2));
}

function publicQuiz(q) { return { id:q.id, name:q.name, subject:q.subject, description:q.description||"", builtIn:!!q.builtIn, questionCount:q.questions.length, updatedAt:q.updatedAt }; }
function makeToken() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const subjects = {
  "Bahasa Indonesia": [
    { q: "Gagasan utama sebuah paragraf disebut juga ...", opts: ["ide pokok", "kata kunci", "judul", "kalimat penjelas"], a: 0, e: "Ide pokok adalah inti pembahasan paragraf." },
    { q: "Lawan kata 'tinggi' adalah ...", opts: ["besar", "rendah", "panjang", "lebar"], a: 1, e: "Antonim tinggi adalah rendah." }
  ],
  "Matematika": [
    { q: "Hasil dari 8 × 7 adalah ...", opts: ["54", "56", "64", "48"], a: 1, e: "8 × 7 = 56." },
    { q: "Pecahan yang senilai dengan 1/2 adalah ...", opts: ["2/3", "2/4", "3/5", "4/6"], a: 1, e: "2/4 dapat disederhanakan menjadi 1/2." }
  ],
  "IPAS": [
    { q: "Tumbuhan membuat makanan sendiri melalui proses ...", opts: ["pernapasan", "fotosintesis", "pencernaan", "penguapan"], a: 1, e: "Fotosintesis membuat makanan dengan bantuan cahaya matahari." },
    { q: "Sumber energi utama bagi bumi adalah ...", opts: ["Bulan", "angin", "Matahari", "air"], a: 2, e: "Matahari adalah sumber energi utama bagi bumi." }
  ],
  "Pendidikan Pancasila": [
    { q: "Sila pertama Pancasila berbunyi ...", opts: ["Kemanusiaan yang Adil dan Beradab", "Persatuan Indonesia", "Ketuhanan Yang Maha Esa", "Keadilan Sosial"], a: 2, e: "Sila pertama adalah Ketuhanan Yang Maha Esa." },
    { q: "Bekerja sama membersihkan kelas merupakan contoh ...", opts: ["gotong royong", "persaingan", "perpecahan", "menyerah"], a: 0, e: "Gotong royong berarti bekerja bersama untuk tujuan yang baik." }
  ],
  "Seni": [
    { q: "Warna merah, kuning, dan biru termasuk warna ...", opts: ["primer", "sekunder", "tersier", "netral"], a: 0, e: "Merah, kuning, dan biru adalah warna primer." },
    { q: "Alat musik yang dimainkan dengan cara dipukul adalah ...", opts: ["seruling", "gendang", "biola", "pianika"], a: 1, e: "Gendang dimainkan dengan cara dipukul." }
  ],
  "PJOK": [
    { q: "Sebelum berolahraga sebaiknya melakukan ...", opts: ["pemanasan", "tidur", "makan banyak", "duduk diam"], a: 0, e: "Pemanasan membantu menyiapkan tubuh sebelum olahraga." },
    { q: "Gerakan berpindah tempat dengan satu kaki secara bergantian disebut ...", opts: ["berlari", "melompat", "merangkak", "berguling"], a: 1, e: "Melompat merupakan gerakan dengan tolakan kaki untuk berpindah." }
  ]
};

let quizBank = [];

function gradeBand(className) {
  const m = String(className || "SD 1").match(/(SD|SMP|SMA)\s*(\d+)/i);
  if (!m) return "sd-low";
  const level = m[1].toUpperCase(); const n = Number(m[2]);
  if (level === "SD") return n <= 3 ? "sd-low" : "sd-high";
  if (level === "SMP") return "smp";
  return "sma";
}
function shuffleArray(arr) {
  const a = [...arr]; for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a;
}
function generatedQuestions(className, subject, count=10) {
  const band = gradeBand(className), s = String(subject || "Matematika");
  let bank = [];
  if (s === "Matematika") {
    if (band === "sd-low") bank = [
      ["Hasil dari 7 + 5 adalah ...",["10","11","12","13"],2,"7 + 5 = 12."],
      ["Hasil dari 15 - 8 adalah ...",["5","6","7","8"],2,"15 - 8 = 7."],
      ["Bilangan setelah 29 adalah ...",["28","30","31","39"],1,"Setelah 29 adalah 30."],
      ["Ada 3 piring, tiap piring berisi 4 apel. Jumlah apel adalah ...",["7","10","12","14"],2,"3 × 4 = 12."],
      ["Setengah dari 10 adalah ...",["2","5","6","8"],1,"10 ÷ 2 = 5."]
    ];
    else if (band === "sd-high") bank = [
      ["Hasil dari 125 + 275 adalah ...",["300","350","400","450"],2,"125 + 275 = 400."],
      ["Hasil dari 9 × 8 adalah ...",["64","72","81","96"],1,"9 × 8 = 72."],
      ["Hasil dari 144 ÷ 12 adalah ...",["10","11","12","14"],2,"144 ÷ 12 = 12."],
      ["Pecahan yang senilai dengan 3/4 adalah ...",["4/6","6/8","7/8","9/16"],1,"3/4 = 6/8."],
      ["Keliling persegi dengan sisi 6 cm adalah ...",["12 cm","18 cm","24 cm","36 cm"],2,"4 × 6 = 24 cm."]
    ];
    else if (band === "smp") bank = [
      ["Jika 3x + 5 = 20, nilai x adalah ...",["3","4","5","6"],2,"3x = 15 sehingga x = 5."],
      ["FPB dari 24 dan 36 adalah ...",["6","8","12","18"],2,"FPB 24 dan 36 adalah 12."],
      ["Gradien garis y = 2x + 3 adalah ...",["1","2","3","5"],1,"Koefisien x adalah gradien, yaitu 2."],
      ["Luas segitiga dengan alas 10 cm dan tinggi 8 cm adalah ...",["18 cm²","40 cm²","80 cm²","90 cm²"],1,"½ × 10 × 8 = 40 cm²."],
      ["25% dari 200 adalah ...",["25","40","50","75"],2,"0,25 × 200 = 50."]
    ];
    else bank = [
      ["Jika 2x² = 50 dan x positif, nilai x adalah ...",["4","5","10","25"],1,"x² = 25 sehingga x = 5."],
      ["Turunan dari f(x)=x²+3x adalah ...",["x+3","2x+3","2x²+3","x²+3"],1,"Turunan x² adalah 2x dan 3x adalah 3."],
      ["Nilai sin 30° adalah ...",["0","1/2","√2/2","1"],1,"sin 30° = 1/2."],
      ["Rata-rata dari 6, 8, 10, 12 adalah ...",["8","9","10","11"],1,"Jumlah 36 dibagi 4 = 9."],
      ["Jika log₂ 8 = x, maka x = ...",["2","3","4","8"],1,"2³ = 8, jadi x = 3."]
    ];
  } else if (s === "Bahasa Indonesia") {
    if (band === "sd-low") bank = [["Lawan kata 'besar' adalah ...",["tinggi","kecil","panjang","lebar"],1,"Antonim besar adalah kecil."],["Kalimat untuk menanyakan sesuatu biasanya diakhiri tanda ...",["titik","koma","tanya","seru"],2,"Kalimat tanya memakai tanda tanya (?) ."],["Kata 'berlari' menunjukkan ...",["nama benda","kegiatan","warna","tempat"],1,"Berlari adalah kegiatan."],["Tempat untuk membaca banyak buku disebut ...",["pasar","perpustakaan","lapangan","kantin"],1,"Perpustakaan adalah tempat membaca dan meminjam buku."],["Kata yang tepat: 'Adik ... susu.'",["minum","meminumkan","diminum","minuman"],0,"Kalimat yang tepat: Adik minum susu."]];
    else if (band === "sd-high") bank = [["Gagasan utama paragraf disebut ...",["ide pokok","kata depan","judul buku","tanda baca"],0,"Ide pokok adalah inti paragraf."],["Sinonim kata 'cerdas' adalah ...",["malas","pandai","lemah","lambat"],1,"Cerdas bersinonim dengan pandai."],["Kata tanya untuk menanyakan alasan adalah ...",["apa","siapa","mengapa","kapan"],2,"Mengapa digunakan untuk menanyakan alasan."],["Kalimat yang menggunakan tanda seru dengan tepat adalah ...",["Tolong tutup pintu!","Siapa namamu!","Kapan datang!","Buku itu!"],0,"Tanda seru dapat dipakai untuk perintah atau seruan."],["Paragraf yang menceritakan urutan kejadian termasuk paragraf ...",["narasi","deskripsi","persuasi","argumentasi"],0,"Narasi berisi rangkaian peristiwa."]];
    else if (band === "smp") bank = [["Teks yang bertujuan menjelaskan proses terjadinya suatu fenomena disebut ...",["eksplanasi","prosedur","negosiasi","anekdot"],0,"Teks eksplanasi menjelaskan proses fenomena."],["Kalimat efektif harus ...",["bertele-tele","jelas dan hemat","selalu panjang","tanpa subjek"],1,"Kalimat efektif jelas, logis, dan hemat kata."],["Kata 'karena' termasuk konjungsi yang menyatakan ...",["sebab","tujuan","pilihan","urutan"],0,"Karena menyatakan sebab."],["Bagian teks persuasi yang berisi ajakan disebut ...",["pengenalan isu","rangkaian argumen","pernyataan ajakan","penegasan ulang"],2,"Pernyataan ajakan berisi dorongan kepada pembaca."],["Majas yang membandingkan dua hal secara langsung menggunakan kata seperti 'adalah' disebut ...",["metafora","hiperbola","ironi","litotes"],0,"Metafora membandingkan secara langsung."]];
    else bank = [["Teks yang menyajikan pendapat disertai alasan dan bukti disebut ...",["argumentasi","narasi","deskripsi","prosedur"],0,"Argumentasi menyampaikan pendapat dengan alasan/bukti."],["Kalimat 'Hujan turun dengan deras' menggunakan kata 'deras' sebagai ...",["verba","adjektiva","nomina","konjungsi"],1,"Deras adalah kata sifat."],["Dalam karya ilmiah, sumber rujukan perlu dicantumkan untuk ...",["memperpanjang teks","menunjukkan dasar informasi","menghias halaman","mengurangi data"],1,"Rujukan menunjukkan dasar informasi yang digunakan."],["Diksi adalah ...",["pilihan kata","susunan paragraf","jumlah kalimat","tanda baca"],0,"Diksi berarti pilihan kata."],["Kalimat yang paling objektif adalah ...",["Film itu paling keren","Menurut data, suhu naik 2°C","Saya sangat suka film itu","Makanan itu luar biasa"],1,"Pernyataan berbasis data lebih objektif."]];
  } else if (s === "IPAS") {
    if (band === "sd-low" || band === "sd-high") bank = [["Bagian tumbuhan yang menyerap air dari tanah adalah ...",["bunga","akar","buah","daun"],1,"Akar menyerap air dan mineral."],["Sumber cahaya dan panas utama bagi bumi adalah ...",["Bulan","Matahari","awan","angin"],1,"Matahari adalah sumber energi utama bumi."],["Perubahan air menjadi uap disebut ...",["membeku","menguap","mencair","mengembun"],1,"Menguap adalah perubahan cair menjadi gas."],["Hewan yang memakan tumbuhan disebut ...",["karnivor","herbivor","omnivor","insekta"],1,"Herbivor memakan tumbuhan."],["Gaya yang membuat benda jatuh ke bawah disebut ...",["gaya magnet","gravitasi","gesek","pegas"],1,"Gravitasi menarik benda menuju bumi."]];
    else if (band === "smp") bank = [["Organel sel yang mengatur aktivitas sel adalah ...",["ribosom","inti sel","vakuola","dinding sel"],1,"Inti sel mengatur aktivitas sel."],["Proses perubahan energi cahaya menjadi energi kimia pada tumbuhan disebut ...",["respirasi","fotosintesis","fermentasi","difusi"],1,"Fotosintesis menghasilkan energi kimia dalam bentuk glukosa."],["Planet yang dikenal sebagai planet merah adalah ...",["Venus","Mars","Jupiter","Merkurius"],1,"Mars tampak kemerahan karena mineral besi di permukaannya."],["Campuran dengan zat terlarut yang merata disebut ...",["larutan","suspensi","endapan","unsur"],0,"Larutan merupakan campuran homogen."],["Rangkaian listrik yang memiliki satu jalur arus disebut rangkaian ...",["paralel","seri","terbuka ganda","campuran"],1,"Rangkaian seri memiliki satu jalur utama."]];
    else bank = [["Hukum Newton I berkaitan dengan sifat benda untuk mempertahankan keadaan geraknya, disebut ...",["gaya","inersia","energi","momentum"],1,"Hukum I Newton dikenal sebagai hukum kelembaman/inersia."],["DNA terutama berfungsi menyimpan ...",["energi panas","informasi genetik","air","mineral"],1,"DNA menyimpan informasi genetik."],["pH larutan netral pada suhu sekitar 25°C adalah ...",["0","5","7","14"],2,"Larutan netral memiliki pH 7."],["Jika frekuensi gelombang meningkat sementara cepat rambat tetap, panjang gelombang akan ...",["meningkat","menurun","tetap","menjadi nol"],1,"v = fλ, jadi λ berbanding terbalik dengan f."],["Gas yang paling banyak menyusun atmosfer bumi adalah ...",["oksigen","nitrogen","karbon dioksida","hidrogen"],1,"Nitrogen sekitar 78% atmosfer bumi."]];
  } else if (s === "Pendidikan Pancasila") {
    bank = [["Sila pertama Pancasila berbunyi ...",["Ketuhanan Yang Maha Esa","Kemanusiaan yang Adil dan Beradab","Persatuan Indonesia","Keadilan Sosial"],0,"Sila pertama adalah Ketuhanan Yang Maha Esa."],["Bekerja bersama membersihkan kelas merupakan contoh ...",["gotong royong","persaingan","perpecahan","egoisme"],0,"Gotong royong berarti bekerja bersama."],["Menghargai perbedaan suku dan budaya mencerminkan sikap ...",["toleransi","memaksa","egois","acuh"],0,"Toleransi berarti menghargai perbedaan."],["Lambang sila ketiga Pancasila adalah ...",["bintang","rantai","pohon beringin","padi dan kapas"],2,"Pohon beringin melambangkan sila ketiga."],["Musyawarah bertujuan mencapai ...",["keputusan bersama","kemenangan pribadi","pertengkaran","hukuman"],0,"Musyawarah dilakukan untuk mencapai keputusan bersama."]];
  } else if (s === "Seni") {
    bank = [["Merah, kuning, dan biru termasuk warna ...",["primer","sekunder","tersier","netral"],0,"Ketiganya merupakan warna primer."],["Alat musik yang dimainkan dengan dipukul adalah ...",["seruling","gendang","biola","pianika"],1,"Gendang dimainkan dengan dipukul."],["Garis yang memberi kesan tenang biasanya adalah garis ...",["horizontal","zigzag","spiral tajam","acak"],0,"Garis horizontal memberi kesan tenang/stabil."],["Karya seni yang memiliki panjang dan lebar disebut karya seni ...",["dua dimensi","tiga dimensi","empat dimensi","gerak"],0,"Seni rupa dua dimensi memiliki panjang dan lebar."],["Tempo cepat dalam musik disebut ...",["largo","andante","allegro","adagio"],2,"Allegro menunjukkan tempo cepat."]];
  } else if (s === "PJOK") {
    bank = [["Sebelum olahraga sebaiknya melakukan ...",["pemanasan","tidur","duduk diam","makan banyak"],0,"Pemanasan menyiapkan tubuh untuk aktivitas."],["Gerakan berpindah tempat dengan melangkahkan kaki secara cepat disebut ...",["berlari","diam","membungkuk","tidur"],0,"Berlari adalah gerak lokomotor dengan kecepatan lebih tinggi."],["Latihan untuk meningkatkan daya tahan jantung dan paru adalah ...",["jogging","menonton","tidur","duduk"],0,"Jogging dapat melatih daya tahan kardiorespirasi."],["Menjaga kebersihan tubuh setelah olahraga membantu ...",["kesehatan","kelelahan","cedera","dehidrasi"],0,"Kebersihan membantu menjaga kesehatan."],["Gerakan mendorong tubuh dari lantai menggunakan kedua tangan disebut ...",["push-up","sit-up","squat","lari"],0,"Push-up melatih otot tubuh bagian atas."]];
  } else bank = subjects[s] ? subjects[s].map(q=>[q.q,q.opts,q.a,q.e]) : Object.values(subjects).flat().map(q=>[q.q,q.opts,q.a,q.e]);
  const expanded = shuffleArray(bank).flatMap(item => { const [q,opts,a,e]=item; return [{ q, opts:[...opts], a, e, subject:s }]; });
  const base = [...expanded]; while (base.length < count) base.push(...expanded.map(x=>({...x, opts:[...x.opts]}))); 
  return shuffleArray(base).slice(0,count).map((q,i)=>({...q,id:i+1}));
}

async function generateOnlineQuestions(className, subject, count=10, difficulty="sedang") {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY belum diatur di Railway.");
  const safeCount = Math.min(30, Math.max(5, Number(count) || 10));
  const grade = String(className || "SD 1").trim();
  const lesson = String(subject || "Matematika").trim();
  const level = String(difficulty || "sedang").trim().toLowerCase();
  const prompt = `Buat ${safeCount} soal kuis pilihan ganda berbahasa Indonesia untuk siswa kelas ${grade}, mata pelajaran ${lesson}, tingkat kesulitan ${level}.

Gunakan web search untuk mencari referensi materi yang relevan dan mutakhir bila diperlukan. Prioritaskan sumber pendidikan Indonesia yang tepercaya (misalnya kemdikbud.go.id, kemdikdasmen.go.id, repositori pendidikan resmi, atau sumber akademik tepercaya). Jangan menyalin kalimat panjang dari sumber. Soal harus sesuai usia/jenjang, jelas, memiliki tepat 4 pilihan jawaban, hanya 1 jawaban benar, dan disertai penjelasan singkat.

Kembalikan HANYA JSON sesuai schema. Field a adalah indeks jawaban benar: 0=A, 1=B, 2=C, 3=D. Field subject harus sama dengan mata pelajaran. Jangan membuat soal yang membutuhkan gambar atau data yang tidak diberikan.`;
  const schema = {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            q: { type: "string" },
            opts: { type: "array", items: { type: "string" } },
            a: { type: "integer" },
            e: { type: "string" },
            subject: { type: "string" }
          },
          required: ["q","opts","a","e","subject"],
          additionalProperties: false
        }
      }
    },
    required: ["questions"],
    additionalProperties: false
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      tools: [{ type: "web_search", search_context_size: "medium" }],
      input: prompt,
      text: { format: { type: "json_schema", name: "quiz_questions", strict: true, schema } },
      store: false
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  let parsed;
  try { parsed = JSON.parse(data.output_text || "{}"); } catch (_) { throw new Error("AI mengembalikan format soal yang tidak valid."); }
  const questions = cleanQuizQuestions(parsed.questions || []);
  if (questions.length < 1) throw new Error("AI tidak menghasilkan soal yang valid.");
  return questions.slice(0, safeCount);
}


function qItem(q, opts, a, e, subject) {
  return { q: String(q), opts: opts.map(String), a, e: String(e || ""), subject };
}
function buildBuiltinQuestions(className, subject) {
  const m = String(className || "SD 1").match(/(SD|SMP|SMA)\s*(\d+)/i);
  const level = m ? m[1].toUpperCase() : "SD";
  const grade = m ? Number(m[2]) : 1;
  const band = level === "SD" ? (grade <= 3 ? "sd-low" : "sd-high") : level.toLowerCase();

  if (subject === "Matematika") {
    const out = [];
    for (let i=1;i<=100;i++) {
      const mode=i%10;
      let q,opts,ans,e;
      if (band === "sd-low") {
        if(mode===1){const x=i+3,y=i+5,correct=x+y;q=`Hasil dari ${x} + ${y} adalah ...`;opts=[correct-2,correct,correct+2,correct+5];ans=1;e=`${x} + ${y} = ${correct}.`;}
        else if(mode===2){const x=i+12,y=i%7+2,correct=x-y;q=`Hasil dari ${x} − ${y} adalah ...`;opts=[correct-2,correct,correct+1,correct+3];ans=1;e=`${x} − ${y} = ${correct}.`;}
        else if(mode===3){const x=(i%8)+2,y=(i%6)+2,correct=x*y;q=`Hasil dari ${x} × ${y} adalah ...`;opts=[correct-2,correct,correct+2,correct+4];ans=1;e=`${x} × ${y} = ${correct}.`;}
        else if(mode===4){const y=(i%8)+2,correct=i%8+1,x=correct*y;q=`Hasil dari ${x} ÷ ${y} adalah ...`;opts=[correct-2,correct,correct+1,correct+3];ans=1;e=`${x} ÷ ${y} = ${correct}.`;}
        else if(mode===5){const x=i%40+10,correct=x+1;q=`Bilangan setelah ${x} adalah ...`;opts=[correct-2,correct,correct+2,correct+3];ans=1;e=`Bilangan setelah ${x} adalah ${correct}.`;}
        else if(mode===6){const x=(i%9)+10,correct=x+1;q=`Manakah bilangan yang lebih besar dari ${x}?`;opts=[x-2,x-1,correct,x-3];ans=2;e=`${correct} lebih besar dari ${x}.`;}
        else if(mode===7){const n=(i%9)+2,correct=n*2;q=`Ada ${n} kelompok, masing-masing berisi 2 benda. Jumlah benda seluruhnya ...`;opts=[correct-1,correct,correct+1,correct+2];ans=1;e=`${n} × 2 = ${correct}.`;}
        else if(mode===8){const n=(i%8)+2,correct=n;q=`Setengah dari ${n*2} adalah ...`;opts=[correct-2,correct,correct+1,correct+2];ans=1;e=`Setengah dari ${n*2} adalah ${correct}.`;}
        else if(mode===9){q=`Bentuk dengan 4 sisi sama panjang disebut ...`;opts=["segitiga","persegi","lingkaran","trapesium"];ans=1;e="Persegi memiliki empat sisi sama panjang.";}
        else {const n=(i%5)+2,correct=n*10;q=`${n} puluhan sama dengan ...`;opts=[correct-10,correct,correct+10,correct+20];ans=1;e=`${n} puluhan = ${correct}.`;}
      } else if (band === "sd-high") {
        if(mode<=2){const x=100+i,y=25+(i%25),correct=x+y;q=`Hasil dari ${x} + ${y} adalah ...`;opts=[correct-10,correct,correct+10,correct+20];ans=1;e=`${x} + ${y} = ${correct}.`;}
        else if(mode===3){const x=12+(i%15),y=3+(i%7),correct=x*y;q=`Hasil dari ${x} × ${y} adalah ...`;opts=[correct-3,correct,correct+3,correct+6];ans=1;e=`${x} × ${y} = ${correct}.`;}
        else if(mode===4){const y=4+(i%8),correct=5+(i%12),x=y*correct;q=`Hasil dari ${x} ÷ ${y} adalah ...`;opts=[correct-2,correct,correct+2,correct+4];ans=1;e=`${x} ÷ ${y} = ${correct}.`;}
        else if(mode===5){const n=(i%8)+2;q=`Pecahan yang senilai dengan ${n}/${n+1} adalah ...`;opts=[`${n+1}/${n+2}`,`${n*2}/${(n+1)*2}`,`${n+1}/${n}`,`${n*2}/${n+1}`];ans=1;e=`${n}/${n+1} = ${n*2}/${(n+1)*2}.`;}
        else if(mode===6){const side=(i%8)+4,correct=4*side;q=`Keliling persegi dengan sisi ${side} cm adalah ...`;opts=[`${2*side} cm`,`${3*side} cm`,`${correct} cm`,`${side*side} cm`];ans=2;e=`4 × ${side} = ${correct} cm.`;}
        else if(mode===7){const p=5+(i%10),l=3+(i%6),correct=p*l;q=`Luas persegi panjang dengan panjang ${p} cm dan lebar ${l} cm adalah ...`;opts=[`${p+l} cm²`,`${correct} cm²`,`${2*(p+l)} cm²`,`${correct+10} cm²`];ans=1;e=`${p} × ${l} = ${correct} cm².`;}
        else if(mode===8){const n=(i%20)+10,correct=n;q=`25% dari ${n*4} adalah ...`;opts=[correct-5,correct,correct+5,correct+10];ans=1;e=`25% = 1/4, jadi ${n*4} ÷ 4 = ${correct}.`;}
        else if(mode===9){const n=(i%10)+2,correct=n;q=`FPB dari ${n*2} dan ${n*3} adalah ...`;opts=[n-1,n,n+1,n*2];ans=1;e=`FPB ${n*2} dan ${n*3} adalah ${n}.`;}
        else {const n=(i%9)+2;q=`Bilangan desimal yang setara dengan ${n}/10 adalah ...`;opts=[`${n/100}`,`${n/10}`,`${n}`,`${n*10}`];ans=1;e=`${n}/10 = ${n/10}.`;}
      } else if (band === "smp") {
        if(mode<=2){const x=(i%12)+2,correct=x;q=`Jika ${x}x + ${x} = ${x*(x+1)}, nilai x adalah ...`;opts=[x-1,x,x+1,x+2];ans=1;e=`${x}(x+1) = ${x*(x+1)}, sehingga x = ${correct}.`;}
        else if(mode===3){const n=(i%12)+2,correct=n*2;q=`FPB dari ${n*4} dan ${n*6} adalah ...`;opts=[n,n*2,n*3,n*4];ans=1;e=`FPB ${n*4} dan ${n*6} adalah ${correct}.`;}
        else if(mode===4){const n=(i%9)+2,correct=n*10;q=`25% dari ${n*40} adalah ...`;opts=[correct-10,correct,correct+10,correct+20];ans=1;e=`25% × ${n*40} = ${correct}.`;}
        else if(mode===5){const alas=5+(i%8),tinggi=4+(i%7),correct=alas*tinggi/2;q=`Luas segitiga dengan alas ${alas} cm dan tinggi ${tinggi} cm adalah ...`;opts=[`${correct-5} cm²`,`${correct} cm²`,`${correct+5} cm²`,`${alas*tinggi} cm²`];ans=1;e=`½ × ${alas} × ${tinggi} = ${correct} cm².`;}
        else if(mode===6){const x=(i%7)+2;q=`Gradien garis y = ${x}x + 3 adalah ...`;opts=[x-1,x,x+1,x+2];ans=1;e=`Koefisien x adalah gradien, yaitu ${x}.`;}
        else if(mode===7){const n=(i%8)+2,correct=n+8;q=`Suku ke-5 dari barisan aritmetika dengan suku pertama ${n} dan beda 2 adalah ...`;opts=[n+6,correct,n+10,n+12];ans=1;e=`a₅ = ${n} + 4×2 = ${correct}.`;}
        else if(mode===8){const n=(i%6)+2;q=`Jika peluang suatu kejadian adalah 1/${n}, maka peluang dalam bentuk desimal yang paling dekat adalah ...`;const correct=Number((1/n).toFixed(2));opts=[String(correct),String(Number((1/(n+1)).toFixed(2))),String(Number((2/n).toFixed(2))),String(Number((n/10).toFixed(2)))];ans=0;e=`1 ÷ ${n} ≈ ${correct}.`;}
        else if(mode===9){const r=(i%7)+2,correct=22*r*r/7;q=`Luas lingkaran dengan jari-jari ${r} cm menggunakan π = 22/7 adalah ...`;opts=[`${correct/2} cm²`,`${correct} cm²`,`${correct+10} cm²`,`${correct+20} cm²`];ans=1;e=`L = 22/7 × ${r}² = ${correct} cm².`;}
        else {const n=(i%9)+2,correct=8*n;q=`Nilai 2³ × ${n} adalah ...`;opts=[String(4*n),String(6*n),String(correct),String(10*n)];ans=2;e=`2³ × ${n} = 8 × ${n} = ${correct}.`;}
      } else {
        if(mode<=2){const x=(i%9)+2,correct=x;q=`Jika f(x)=x²−${x}x+${x}, maka f(${x}) = ...`;opts=[x-2,correct,x+2,x*x];ans=1;e=`f(${x}) = ${x*x}−${x*x}+${x} = ${correct}.`;}
        else if(mode===3){const n=(i%12)+2;q=`Turunan dari f(x)=x²+${n}x adalah ...`;opts=[`x+${n}`,`2x+${n}`,`2x²+${n}`,`x²+${n}`];ans=1;e="Turunan x² adalah 2x dan turunan nx adalah n.";}
        else if(mode===4){const n=(i%8)+2;q=`Jika log₂ ${2**n} = x, nilai x adalah ...`;opts=[n-1,n,n+1,n+2];ans=1;e=`2^${n} = ${2**n}, jadi x = ${n}.`;}
        else if(mode===5){const n=(i%7)+2;q=`Nilai sin 30° × ${n} adalah ...`;opts=[String(n/4),String(n/2),String(n),String(n*2)];ans=1;e=`sin 30° = 1/2, sehingga hasilnya ${n/2}.`;}
        else if(mode===6){const n=(i%9)+2,correct=n+3;q=`Rata-rata ${n}, ${n+2}, ${n+4}, dan ${n+6} adalah ...`;opts=[n+2,correct,n+4,n+5];ans=1;e=`Jumlahnya ${4*n+12}, dibagi 4 = ${correct}.`;}
        else if(mode===7){const a=2+(i%5),d=2+(i%4),correct=a+4*d;q=`Suku ke-5 barisan aritmetika dengan a=${a} dan beda ${d} adalah ...`;opts=[a+3*d,correct,a+5*d,a+6*d];ans=1;e=`U5 = a + 4d = ${correct}.`;}
        else if(mode===8){const n=(i%6)+2;q=`Jika 2x = ${2*n}, nilai x adalah ...`;opts=[n-1,n,n+1,n*2];ans=1;e=`2x = ${2*n}, jadi x = ${n}.`;}
        else if(mode===9){const n=(i%6)+2;q=`Integral tak tentu dari ${n}x dx adalah ...`;opts=[`${n}x² + C`,`${n/2}x² + C`,`${2*n}x² + C`,`${n}x + C`];ans=1;e=`∫ ${n}x dx = ${n/2}x² + C.`;}
        else {q=`Varians dan simpangan baku digunakan untuk mengukur ...`;opts=["pusat data","penyebaran data","jumlah data","jenis data"];ans=1;e="Keduanya mengukur penyebaran data.";}
      }
      out.push(qItem(q,opts,ans,e,subject));
    }
    return out;
  }

  const datasets = {
    "Bahasa Indonesia": {
      sd:["Antonim kata besar adalah ...","Sinonim kata cerdas adalah ...","Kata tanya untuk menanyakan waktu adalah ...","Tanda baca untuk mengakhiri kalimat tanya adalah ...","Gagasan utama paragraf disebut ...","Kata yang menunjukkan kegiatan disebut ...","Tempat membaca dan meminjam buku disebut ...","Paragraf yang menceritakan kejadian disebut ...","Kalimat perintah biasanya menggunakan tanda ...","Kata 'berlari' termasuk kata ..."],
      smp:["Teks yang menjelaskan proses terjadinya fenomena disebut ...","Kalimat efektif harus ...","Kata 'karena' menyatakan hubungan ...","Bagian teks persuasi yang berisi ajakan disebut ...","Majas perbandingan langsung disebut ...","Diksi berarti ...","Teks prosedur berisi ...","Informasi utama berita harus ...","Kata baku digunakan agar bahasa ...","Simpulan teks berisi ..."],
      sma:["Teks argumentasi menyampaikan pendapat disertai ...","Diksi adalah ...","Kalimat objektif sebaiknya berdasarkan ...","Karya ilmiah memerlukan sumber rujukan untuk ...","Majas metafora membandingkan secara ...","Tesis dalam teks eksposisi berisi ...","Paragraf deduktif menempatkan gagasan utama di ...","Kohesi berkaitan dengan keterkaitan ...","Kalimat efektif harus logis, jelas, dan ...","Abstrak berisi ringkasan ..."]
    },
    "IPAS": {
      sd:["Bagian tumbuhan yang menyerap air dari tanah adalah ...","Sumber energi utama bagi bumi adalah ...","Perubahan air menjadi uap disebut ...","Hewan pemakan tumbuhan disebut ...","Gaya yang membuat benda jatuh disebut ...","Organ untuk bernapas pada manusia adalah ...","Air membeku menjadi ...","Matahari menghasilkan cahaya dan ...","Lingkungan tempat makhluk hidup tinggal disebut ...","Benda yang dapat ditarik magnet disebut ..."],
      smp:["Organel yang mengatur aktivitas sel adalah ...","Proses tumbuhan membuat makanan disebut ...","Planet merah adalah ...","Campuran homogen disebut ...","Rangkaian satu jalur arus disebut ...","Satuan gaya dalam SI adalah ...","Perubahan wujud gas menjadi cair disebut ...","Zat dengan pH kurang dari 7 bersifat ...","Sistem peredaran darah manusia menggunakan organ utama ...","Sumber energi terbarukan contohnya ..."],
      sma:["Hukum Newton I berkaitan dengan ...","DNA menyimpan ...","pH larutan netral sekitar ...","Jika frekuensi naik pada cepat rambat tetap, panjang gelombang ...","Atmosfer paling banyak mengandung ...","Mitokondria merupakan tempat utama ...","Ikatan kovalen terjadi karena ...","Fotosintesis menggunakan energi ...","Gelombang elektromagnetik tidak memerlukan ...","Hukum kekekalan energi menyatakan energi ..."]
    },
    "Pendidikan Pancasila": {
      sd:["Sila pertama Pancasila berbunyi ...","Bekerja bersama disebut ...","Menghargai perbedaan disebut ...","Lambang sila ketiga adalah ...","Musyawarah bertujuan mencapai ...","Aturan di sekolah harus ...","Contoh sikap adil adalah ...","Menolong teman merupakan sikap ...","Hak dan kewajiban harus ...","Persatuan membuat hidup menjadi ..."],
      smp:["Pancasila berkedudukan sebagai dasar ...","UUD 1945 merupakan hukum ...","Musyawarah mencerminkan sila ke ...","Bhinneka Tunggal Ika berarti ...","Demokrasi menempatkan rakyat sebagai ...","Norma hukum memiliki sanksi yang ...","Hak asasi manusia melekat sejak ...","Gotong royong memperkuat ...","Kewajiban warga negara harus ...","Peraturan dibuat untuk menciptakan ..."],
      sma:["Pancasila sebagai ideologi berarti menjadi ...","Konstitusi Indonesia adalah ...","Demokrasi Pancasila mengutamakan ...","Kedaulatan rakyat berarti kekuasaan tertinggi berada pada ...","Hak warga negara harus diimbangi dengan ...","Negara hukum menempatkan hukum sebagai ...","Persamaan kedudukan warga negara berarti ...","Musyawarah mufakat menekankan ...","Bhinneka Tunggal Ika menjadi semboyan ...","Keadilan sosial berkaitan dengan ..."]
    },
    "Seni": {
      sd:["Merah, kuning, dan biru termasuk warna ...","Gendang dimainkan dengan cara ...","Karya dengan panjang dan lebar disebut ...","Garis horizontal memberi kesan ...","Tempo cepat disebut ...","Lagu dinyanyikan menggunakan ...","Patung termasuk karya seni ...","Campuran merah dan kuning menghasilkan ...","Alat musik tiup contohnya ...","Pola hias digunakan untuk ..."],
      smp:["Unsur seni rupa yang berupa jejak titik bergerak disebut ...","Komposisi berkaitan dengan ...","Perspektif digunakan untuk memberi kesan ...","Tempo menunjukkan ...","Dinamika musik menunjukkan perubahan ...","Teknik arsir menggunakan ...","Kolase dibuat dengan menempelkan ...","Harmoni berkaitan dengan keselarasan ...","Ilustrasi berfungsi memperjelas ...","Karya tiga dimensi memiliki ..."],
      sma:["Prinsip keseimbangan dalam seni rupa mengatur ...","Kontras menciptakan perbedaan yang ...","Perspektif linear menggunakan garis ...","Timbre adalah warna ...","Polifoni berarti beberapa melodi ...","Estetika membahas ...","Seni instalasi menekankan hubungan karya dengan ...","Komposisi musik mengatur unsur ...","Kritik seni sebaiknya didukung ...","Apresiasi seni melibatkan proses ..."]
    },
    "PJOK": {
      sd:["Sebelum olahraga sebaiknya melakukan ...","Gerak berpindah tempat disebut gerak ...","Latihan daya tahan dapat dilakukan dengan ...","Menjaga kebersihan tubuh membantu ...","Push-up melatih otot ...","Minum air membantu mencegah ...","Permainan sepak bola menggunakan ... untuk menendang","Sikap awal sebelum berlari adalah ...","Peregangan membantu menjaga ...","Istirahat cukup penting bagi ..."],
      smp:["Pemanasan bertujuan menyiapkan ...","Latihan aerobik meningkatkan ...","Push-up terutama melatih ...","Kebugaran jasmani mencakup daya tahan dan ...","Dehidrasi berarti kekurangan ...","Teknik dasar bola voli salah satunya ...","Dalam sepak bola, penjaga gawang bertugas ...","Lari jarak jauh melatih ...","Pendinginan dilakukan setelah ...","Pola hidup sehat mencakup aktivitas fisik dan ..."],
      sma:["VO2 max berkaitan dengan kemampuan ...","Latihan interval memadukan periode kerja dan ...","Prinsip overload berarti beban latihan ...","Daya tahan kardiorespirasi berkaitan dengan kerja ...","Pemulihan penting untuk adaptasi ...","Fleksibilitas berkaitan dengan luas gerak ...","Cedera olahraga perlu ditangani dengan ...","Latihan kekuatan dapat menggunakan ...","Asupan cairan penting untuk menjaga ...","Kebugaran jasmani mendukung ..."]
    }
  };
  const answers = {
    "Bahasa Indonesia":{
      sd:[["kecil","besar","tinggi","rendah"],["pandai","cerdas","malas","lemah"],["kapan","siapa","apa","mengapa"],["tanya","titik","koma","seru"],["ide pokok","judul","kata kunci","penutup"],["kerja","kegiatan","benda","sifat"],["perpustakaan","pasar","kantin","lapangan"],["narasi","persuasi","argumentasi","deskripsi"],["seru","tanya","koma","titik"],["kegiatan","benda","sifat","tempat"]],
      smp:[["eksplanasi","narasi","puisi","iklan"],["jelas dan hemat","panjang","berulang","tanpa subjek"],["sebab","tujuan","pilihan","waktu"],["pernyataan ajakan","judul","orientasi","koda"],["metafora","ironi","hiperbola","litotes"],["pilihan kata","judul","paragraf","kalimat"],["langkah-langkah","pendapat","tokoh","latar"],["akurat","panjang","berima","lucu"],["baku dan jelas","rumit","asing","bebas"],["inti pembahasan","sampul","daftar isi","judul"]],
      sma:[["alasan dan bukti","warna","tokoh","rima"],["pilihan kata","jumlah kata","judul","paragraf"],["data dan fakta","selera","dugaan","emosi"],["menunjukkan dasar informasi","memperindah","memperpendek","menghapus data"],["langsung","berulang","acak","berlawanan"],["pendapat utama penulis","daftar pustaka","judul","contoh"],["awal paragraf","tengah","akhir","judul"],["antarunsur bahasa","warna","tokoh","gambar"],["hemat","panjang","asing","ambigu"],["isi pokok karya","sampul","lampiran","iklan"]]
    },
    "IPAS":{
      sd:[["akar","daun","bunga","buah"],["Matahari","Bulan","awan","angin"],["menguap","mencair","membeku","mengembun"],["herbivor","karnivor","omnivor","insektivor"],["gravitasi","magnet","gesek","pegas"],["paru-paru","lambung","ginjal","kulit"],["es","uap","embun","salju"],["panas","suara","air","tanah"],["habitat","populasi","komunitas","ekosistem"],["besi","kayu","plastik","kertas"]],
      smp:[["inti sel","ribosom","vakuola","dinding sel"],["fotosintesis","respirasi","difusi","fermentasi"],["Mars","Venus","Jupiter","Saturnus"],["larutan","suspensi","unsur","endapan"],["seri","paralel","campuran","terbuka"],["newton","joule","watt","pascal"],["mengembun","menguap","mencair","membeku"],["asam","basa","netral","garam"],["jantung","paru-paru","otak","hati"],["surya","batu bara","minyak bumi","gas alam"]],
      sma:[["inersia","gaya","energi","momentum"],["informasi genetik","energi panas","air","mineral"],["7","0","5","14"],["menurun","meningkat","tetap","nol"],["nitrogen","oksigen","karbon dioksida","hidrogen"],["respirasi sel","fotosintesis","translasi","difusi"],["berbagi elektron","menukar proton","menghilangkan atom","mengubah neutron"],["cahaya","suara","gravitasi","gesekan"],["medium material","waktu","energi","ruang"],["tetap, tetapi dapat berubah bentuk","hilang","bertambah sendiri","selalu nol"]]
    },
    "Pendidikan Pancasila":{
      sd:[["Ketuhanan Yang Maha Esa","Kemanusiaan yang Adil dan Beradab","Persatuan Indonesia","Keadilan Sosial"],["gotong royong","persaingan","perpecahan","egoisme"],["toleransi","memaksa","egois","acuh"],["pohon beringin","bintang","rantai","padi dan kapas"],["keputusan bersama","kemenangan pribadi","pertengkaran","hukuman"],["dipatuhi","dilanggar","diabaikan","diubah sesuka hati"],["membagi tugas secara seimbang","mengambil semua","memihak","mengejek"],["peduli","iri","marah","acuh"],["seimbang","dipisahkan","diabaikan","ditukar"],["rukun","kacau","sendiri","lemah"]],
      smp:[["negara","sekolah","keluarga","pasar"],["tertinggi","terendah","lokal","tidak tertulis"],["keempat","ketiga","kedua","kelima"],["berbeda-beda tetapi tetap satu","satu bahasa saja","berbeda tanpa persatuan","semua harus sama"],["pemegang kedaulatan","penonton","hakim tunggal","penguasa mutlak"],["tegas dan mengikat","selalu ringan","tidak ada","sukarela"],["lahir","sekolah","bekerja","menikah"],["persatuan","perpecahan","persaingan","ketakutan"],["dilaksanakan","dihindari","ditunda","dipilih"],["ketertiban","kekacauan","perselisihan","ketidakadilan"]],
      sma:[["pedoman kehidupan berbangsa","aturan permainan","jadwal sekolah","daftar belanja"],["UUD 1945","Pancasila saja","peraturan kelas","keputusan pribadi"],["musyawarah mufakat","kekuasaan tunggal","kemenangan kelompok","paksaan"],["rakyat","satu orang","militer saja","partai tunggal"],["kewajiban","hadiah","hukuman","jabatan"],["landasan utama penyelenggaraan negara","hiasan","pilihan pribadi","aturan rumah"],["setara di hadapan hukum","berbeda berdasarkan status","hanya pejabat","hanya pelajar"],["kesepakatan","paksaan","kebebasan tanpa batas","kemenangan"],["Indonesia","negara lain","organisasi olahraga","sekolah"],["kesejahteraan yang adil","keuntungan satu pihak","persaingan","hukuman"]]
    },
    "Seni":{
      sd:[["primer","sekunder","tersier","netral"],["dipukul","ditiup","digesek","dipetik"],["dua dimensi","tiga dimensi","empat dimensi","gerak"],["tenang","marah","acak","gelap"],["allegro","largo","adagio","andante"],["suara","warna","gerak","cahaya"],["tiga dimensi","dua dimensi","satu dimensi","tanpa dimensi"],["oranye","hijau","ungu","cokelat"],["seruling","gendang","gitar","piano"],["memperindah dan mengisi bidang","menghapus gambar","mengukur waktu","mengubah suara"]],
      smp:[["garis","warna","tekstur","ruang"],["susunan unsur visual","harga karya","nama seniman","ukuran kertas"],["kedalaman","warna saja","suara","gerak"],["cepat lambat lagu","tinggi nada","keras suara","warna suara"],["keras lembut suara","tinggi rendah","cepat lambat","warna"],["garis-garis","air","tanah","lem"],["bahan-bahan","suara","cahaya","udara"],["nada-nada","garis","ukuran","kertas"],["gambar dan cerita","harga","warna saja","bingkai"],["panjang, lebar, dan tinggi","warna saja","panjang saja","suara"]],
      sma:[["distribusi visual unsur","harga","nama","ukuran kanvas"],["kuat","samar","sama","netral"],["konstruksi","warna","nada","tekstur"],["bunyi instrumen","harga","tempo","ritme"],["berjalan bersamaan","saling meniadakan","tanpa melodi","hanya satu nada"],["keindahan","harga","ukuran","asal bahan"],["ruang dan konteks","harga","nama","bingkai"],["melodi, harmoni, ritme","warna saja","gambar saja","teks saja"],["analisis dan alasan","selera saja","harga","popularitas"],["mengamati, memahami, dan menilai","menyalin","menjual","menghapus"]]
    },
    "PJOK":{
      sd:[["pemanasan","tidur","duduk","makan banyak"],["lokomotor","diam","nonlokomotor","statis"],["jogging","menonton","tidur","duduk"],["kesehatan","kelelahan","cedera","dehidrasi"],["lengan dan dada","mata","telinga","jari kaki"],["dehidrasi","lapar","kantuk","marah"],["kaki","tangan saja","kepala","bahu"],["siap dan tegak","tidur","duduk","membungkuk"],["kelenturan","kebisingan","warna","tinggi badan"],["pertumbuhan dan kebugaran","kemalasan","haus","cedera"]],
      smp:[["tubuh","buku","lapangan","bola"],["daya tahan","warna","tinggi badan","berat buku"],["otot lengan dan dada","mata","telinga","rambut"],["kekuatan","kecepatan","kelenturan","semuanya benar"],["cairan tubuh","oksigen saja","garam saja","vitamin saja"],["servis","menulis","berenang","menendang"],["menghalau bola","mencetak gol dengan tangan","mengatur wasit","menjaga penonton"],["daya tahan","kelenturan saja","ketepatan saja","keseimbangan saja"],["latihan inti","sebelum bangun","sebelum makan","saat tidur"],["gizi seimbang","tidur sepanjang hari","makan berlebihan","tanpa aktivitas"]],
      sma:[["menggunakan oksigen","menghafal","melihat","mendengar"],["istirahat","hukuman","tidur","pemanasan saja"],["ditingkatkan secara bertahap","dihilangkan","selalu sama","diturunkan ke nol"],["jantung dan paru","rambut","mata","kulit saja"],["latihan","kemampuan menurun","cedera saja","tidur"],["sendi","warna kulit","tinggi badan","rambut"],["pertolongan pertama","diabaikan","dipaksa bergerak","ditunda"],["beban tubuh atau alat","buku saja","air saja","musik"],["keseimbangan cairan","warna","tinggi","berat buku"],["kesehatan dan kualitas hidup","kelelahan","rasa lapar","kebosanan"]]
    }
  };
  const key = level === "SD" ? "sd" : level.toLowerCase();
  const list = datasets[subject]?.[key];
  const ansList = answers[subject]?.[key];
  if (!list || !ansList) return [];
  const out=[];
  for(let i=0;i<100;i++){
    const idx=i%list.length;
    const choices=[...ansList[idx]];
    const answer=0;
    // Make the 100 entries distinct by adding a contextual qualifier while preserving the same answer.
    const contexts = [
      `Untuk ${className}, pilih jawaban yang paling tepat.`,
      "Dalam kegiatan belajar di sekolah, jawaban yang tepat adalah ...",
      "Perhatikan konsep berikut. Jawaban yang benar adalah ...",
      "Saat mengerjakan latihan, pilih jawaban yang paling sesuai.",
      "Manakah pilihan yang paling tepat menurut materi pelajaran?",
      "Jika kamu memahami materi ini, jawaban yang benar adalah ...",
      "Pada soal berikut, tentukan pilihan yang paling tepat.",
      "Gunakan pengetahuan yang sudah dipelajari untuk memilih jawaban.",
      "Pilih satu jawaban yang paling sesuai dengan konsep tersebut.",
      "Dalam konteks pembelajaran, pilihan yang benar adalah ..."
    ];
    const q = `${contexts[i%contexts.length]} ${list[idx]}`;
    out.push(qItem(q, choices, answer, `Jawaban benar: ${choices[answer]}.`, subject));
  }
  return out;
}

function makeQuestions(subject, className="SD 1") {
  if (subject === "GAME CAMPURAN") {
    const mixed = Object.keys(subjects).flatMap(s => buildBuiltinQuestions(className, s));
    return shuffleArray(mixed).slice(0, 100).map((x, i) => ({ ...x, id:i+1 }));
  }
  const built = buildBuiltinQuestions(className, subject);
  if (built.length) return built.map((x,i)=>({ ...x, id:i+1 }));
  let arr = (subjects[subject] || subjects["Matematika"]).map(x => ({ ...x, subject }));
  return arr.map((x, i) => ({ ...x, id: i + 1 }));
}

// IMPORTANT: never send the correct answer (a/e) to students.
function safeQuestion(q) {
  if (!q) return null;
  return { id: q.id, subject: q.subject, q: q.q, opts: q.opts };
}

function publicRoom(room, socketId) {
  const viewer = room.sockets.get(socketId);
  const myTeam = viewer?.teamId ? room.teams.get(viewer.teamId) : null;
  return {
    code: room.code,
    className: room.className,
    subject: room.subject,
    teacherName: room.teacherName,
    status: room.status,
    qIndex: room.qIndex,
    total: room.questions.length,
    questionStartedAt: room.questionStartedAt,
    teams: [...room.teams.values()].map(t => ({
      id: t.id,
      name: t.name,
      score: t.score,
      members: t.members.map(m => m.name),
      answered: Object.keys(t.answers).length
    })),
    current: room.status === "playing" ? safeQuestion(room.questions[room.qIndex]) : null,
    questionList: viewer?.role === "teacher" ? room.questions.map((q, i) => ({ id: q.id, number: i + 1, subject: q.subject, q: q.q, opts: q.opts, a: q.a, e: q.e || "" })) : [],
    myTeamAnswered: viewer?.role === "player" && !!myTeam?.answers?.[room.qIndex]
  };
}

function adminResults(room) {
  const current = room.questions[room.qIndex];
  return {
    qIndex: room.qIndex,
    total: room.questions.length,
    questionStartedAt: room.questionStartedAt,
    currentQuestion: safeQuestion(current),
    rows: [...room.teams.values()].map(t => {
      const ans = t.answers[room.qIndex];
      const answered = !!ans;
      const choice = ans && ans.choice !== null && ans.choice !== undefined ? current.opts[ans.choice] : "BELUM MENJAWAB";
      return {
        teamId: t.id,
        teamName: t.name,
        answered,
        choice,
        choiceIndex: ans?.choice ?? null,
        correctAnswer: current.opts[current.a],
        result: !answered ? "BELUM MENJAWAB" : (ans.correct ? "BENAR" : (ans.skipped ? "DILEWATI" : "SALAH")),
        points: ans?.points || 0,
        totalScore: t.score
      };
    }),
    allQuestions: room.questions.map((q, i) => ({
      number: i + 1,
      subject: q.subject,
      question: q.q,
      correctAnswer: q.opts[q.a],
      teams: [...room.teams.values()].map(t => {
        const ans = t.answers[i];
        return {
          teamId: t.id,
          teamName: t.name,
          answer: ans && ans.choice !== null && ans.choice !== undefined ? q.opts[ans.choice] : (ans?.skipped ? "DILEWATI" : "BELUM MENJAWAB"),
          result: !ans ? "BELUM MENJAWAB" : (ans.correct ? "BENAR" : (ans.skipped ? "DILEWATI" : "SALAH")),
          points: ans?.points || 0
        };
      })
    }))
  };
}

function emitRoom(room) {
  for (const socketId of room.sockets.keys()) {
    io.to(socketId).emit("roomState", publicRoom(room, socketId));
  }
}

function emitAdmin(room) {
  for (const [socketId, info] of room.sockets.entries()) {
    if (info.role === "teacher") io.to(socketId).emit("adminResults", adminResults(room));
  }
}

io.on("connection", socket => {
  socket.on("adminAuth", ({ token }, cb) => {
    const session = validAdminToken(token);
    if (!session) { socket.data.admin = false; return cb?.({ ok:false, message:"Sesi admin tidak valid atau sudah kedaluwarsa." }); }
    socket.data.admin = true; socket.data.adminToken = String(token); socket.data.adminName = session.name; socket.data.adminEmail = session.email || "";
    cb?.({ ok:true, name:session.name });
  });

  socket.on("reconnectAdmin", ({ code, token }) => {
    const session = validAdminToken(token);
    const room = rooms.get(String(code || "").trim().toUpperCase());
    if (!session || !room || room.adminToken !== String(token)) return socket.emit("errorMsg", "Room admin tidak dapat dipulihkan. Silakan buat room baru.");
    socket.data.admin = true; socket.data.adminToken = String(token); socket.data.adminName = session.name; socket.data.adminEmail = session.email || "";
    room.sockets.set(socket.id, { role:"teacher", name:room.teacherName, email:socket.data.adminEmail || "" });
    socket.join(room.code);
    socket.emit("created", { code:room.code, restored:true });
    emitRoom(room); emitAdmin(room);
  });
  socket.on("createRoom", ({ className, subject, teacherName, quizId }) => {
    if (!socket.data.admin) return socket.emit("errorMsg", "Admin wajib login terlebih dahulu.");
    let code;
    do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (rooms.has(code));
    const room = {
      code,
      className: className || "SD 1",
      subject: subject || "GAME CAMPURAN",
      teacherName: String(teacherName || "Admin").trim() || "Admin",
      status: "lobby",
      qIndex: 0,
      quizId: String(quizId || "").trim(),
      questions: (() => {
        const saved = quizBank.find(q => q.id === String(quizId || "").trim());
        return saved ? cleanQuizQuestions(saved.questions) : makeQuestions(subject, className);
      })(),
      teams: new Map(),
      sockets: new Map(),
      questionStartedAt: null,
      adminToken: null
    };
    rooms.set(code, room);
    room.adminToken = socket.data.adminToken || issueAdminSession(room.teacherName);
    socket.data.admin = true;
    socket.data.adminToken = room.adminToken;
    room.sockets.set(socket.id, { role: "teacher", name: room.teacherName });
    socket.join(code);
    socket.emit("created", { code, adminToken: room.adminToken });
    emitRoom(room);
    emitAdmin(room);
  });

  socket.on("joinRoom", ({ code, name, teamName }) => {
    const room = rooms.get(String(code || "").trim().toUpperCase());
    if (!room) return socket.emit("errorMsg", "Kode room tidak ditemukan.");
    if (room.status !== "lobby") return socket.emit("errorMsg", "Permainan sudah dimulai. Tunggu room baru dari admin.");

    let team = [...room.teams.values()].find(t => t.name.toLowerCase() === String(teamName || "").trim().toLowerCase());
    if (!team) {
      if (room.teams.size >= 12) return socket.emit("errorMsg", "Maksimal 12 tim.");
      team = { id: "t" + (room.teams.size + 1), name: String(teamName || "Tim " + (room.teams.size + 1)).trim(), score: 0, members: [], answers: {} };
      room.teams.set(team.id, team);
    }
    if (team.members.length >= 10) return socket.emit("errorMsg", "Tim ini sudah penuh (maksimal 10 siswa).");

    team.members.push({ id: socket.id, name: String(name || "Siswa").trim() || "Siswa" });
    room.sockets.set(socket.id, { role: "player", teamId: team.id, name: String(name || "Siswa").trim() || "Siswa" });
    socket.join(room.code);
    socket.emit("joined", { code: room.code, teamId: team.id });
    emitRoom(room);
    emitAdmin(room);
  });

  socket.on("startGame", ({ code }, cb) => {
    const room = rooms.get(String(code || "").trim().toUpperCase());
    if (!room) { cb?.({ ok:false, message:"Room tidak ditemukan. Silakan buat/pulihkan room admin." }); return; }

    // Admin boleh memulai dari socket yang sah, termasuk setelah refresh/reconnect.
    // Ini mencegah tombol MULAI terlihat aktif tetapi tidak melakukan apa-apa.
    let p = room.sockets.get(socket.id);
    const isRoomAdmin = !!socket.data.admin && String(socket.data.adminToken || "") === String(room.adminToken || "");
    if (!isRoomAdmin) {
      cb?.({ ok:false, message:"Sesi admin tidak valid. Silakan login Google sebagai admin lagi." });
      return;
    }
    if (!p || p.role !== "teacher") {
      // Pulihkan peran admin untuk room ini bila koneksi baru belum tercatat sebagai teacher.
      room.sockets.set(socket.id, { role:"teacher", name:socket.data.adminName || room.teacherName, email:socket.data.adminEmail || "" });
      socket.join(room.code);
      p = room.sockets.get(socket.id);
    }
    if (room.status !== "lobby") {
      cb?.({ ok:false, message:room.status === "playing" ? "Permainan sudah berjalan." : "Permainan sudah selesai." });
      return;
    }
    if (!Array.isArray(room.questions) || room.questions.length < 1) {
      cb?.({ ok:false, message:"Soal belum tersedia. Pilih kuis bawaan atau isi Bank Soal terlebih dahulu." });
      return;
    }
    if (room.teams.size < 1) {
      cb?.({ ok:false, message:"Belum ada siswa/tim yang bergabung. Minta siswa masuk ke room terlebih dahulu." });
      return;
    }

    room.status = "playing";
    room.qIndex = 0;
    room.questionStartedAt = Date.now();
    for (const t of room.teams.values()) { t.score = 0; t.answers = {}; }
    emitRoom(room);
    emitAdmin(room);
    io.to(room.code).emit("questionStarted", { qIndex: 0, total: room.questions.length, startedAt: room.questionStartedAt });
    cb?.({ ok:true, qIndex:0, total:room.questions.length });
  });

  socket.on("answer", ({ code, index }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.status !== "playing") return;
    const p = room.sockets.get(socket.id);
    if (!p || p.role !== "player") return;
    const team = room.teams.get(p.teamId);
    if (!team || team.answers[room.qIndex]) return;

    const q = room.questions[room.qIndex];
    const choice = Number.isInteger(index) && index >= 0 && index < q.opts.length ? index : null;
    if (choice === null) return;
    const correct = choice === q.a;
    const points = correct ? 100 : 0;
    team.score += points;
    team.answers[room.qIndex] = { choice, correct, points };

    // Students only receive a generic acknowledgement. No correct answer/explanation is sent.
    socket.emit("answerSaved", { points });
    emitRoom(room);
    emitAdmin(room);
  });

  // Kept for backward compatibility, but the game no longer exposes a LEWATI button.
  socket.on("skip", ({ code }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.status !== "playing") return;
    const p = room.sockets.get(socket.id);
    if (!p || p.role !== "player") return;
    const team = room.teams.get(p.teamId);
    if (!team || team.answers[room.qIndex]) return;
    team.answers[room.qIndex] = { choice: null, correct: false, points: 0, skipped: true };
    socket.emit("answerSaved", { points: 0, skipped: true });
    emitRoom(room);
    emitAdmin(room);
  });

  socket.on("generateQuestions", async ({ code, className, subject, count, source, difficulty }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const p = room && room.sockets.get(socket.id);
    if (!room || !p || p.role !== "teacher" || !socket.data.admin) return;
    if (room.status !== "lobby") return socket.emit("errorMsg", "Generate soal hanya dapat dilakukan sebelum permainan dimulai.");
    const finalClass = className || room.className;
    const finalSubject = subject || room.subject;
    const finalCount = Math.min(30, Math.max(5, Number(count) || 10));
    const mode = String(source || "local").toLowerCase();
    try {
      socket.emit("generationStarted", { source: mode, count: finalCount });
      const questions = mode === "online" ? await generateOnlineQuestions(finalClass, finalSubject, finalCount, difficulty || "sedang") : generatedQuestions(finalClass, finalSubject, finalCount);
      room.questions = questions; room.className = finalClass; room.subject = finalSubject; room.qIndex=0; room.questionStartedAt=null;
      emitRoom(room); emitAdmin(room);
      socket.emit("questionsGenerated", { count:questions.length, className:room.className, subject:room.subject, source:mode, webSearch:mode === "online" });
    } catch (err) {
      console.error("generateQuestions error:", err);
      socket.emit("generationFailed", { message: err.message || "Gagal membuat soal." });
    }
  });

  // Persistent bank kuis: ADMIN can save, load, and delete quizzes.
  socket.on("saveQuiz", ({ code, name, description, questions }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const p = room && room.sockets.get(socket.id);
    if (!room || !p || p.role !== "teacher" || !socket.data.admin) return;
    const cleaned = cleanQuizQuestions(questions);
    if (!String(name || "").trim()) return socket.emit("errorMsg", "Nama kuis wajib diisi.");
    if (!cleaned.length || cleaned.some(q => !q.q || q.opts.length < 2)) return socket.emit("errorMsg", "Setiap soal harus memiliki pertanyaan dan minimal 2 pilihan.");
    const now = new Date().toISOString();
    const id = "quiz-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    const quiz = { id, name: String(name).trim(), subject: String(room.subject || "Umum"), description: String(description || "").trim(), builtIn: false, questions: cleaned, updatedAt: now };
    quizBank = [quiz, ...quizBank.filter(q => !q.builtIn)];
    saveQuizBank();
    socket.emit("quizSaved", { quiz: publicQuiz(quiz), quizzes: quizBank.map(publicQuiz) });
  });

  socket.on("deleteQuiz", ({ code, quizId }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const p = room && room.sockets.get(socket.id);
    if (!room || !p || p.role !== "teacher" || !socket.data.admin) return;
    const target = quizBank.find(q => q.id === String(quizId || ""));
    if (!target) return socket.emit("errorMsg", "Kuis tidak ditemukan.");
    if (target.builtIn) return socket.emit("errorMsg", "Kuis bawaan tidak dapat dihapus.");
    quizBank = quizBank.filter(q => q.id !== target.id);
    saveQuizBank();
    socket.emit("quizDeleted", { quizzes: quizBank.map(publicQuiz) });
  });

  // ADMIN dapat mengelola bank soal selama room masih di lobby.
  socket.on("saveQuestions", ({ code, questions }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    const p = room.sockets.get(socket.id);
    if (!p || p.role !== "teacher") return;
    if (room.status !== "lobby") return socket.emit("errorMsg", "Soal hanya dapat diubah sebelum permainan dimulai.");
    if (!Array.isArray(questions) || questions.length < 1) return socket.emit("errorMsg", "Minimal harus ada 1 soal.");

    const cleaned = questions.map((q, i) => {
      const opts = Array.isArray(q.opts) ? q.opts.map(v => String(v ?? "").trim()).filter(Boolean).slice(0, 4) : [];
      const answer = Number(q.a);
      return {
        id: i + 1,
        subject: String(q.subject || room.subject || "Umum").trim() || "Umum",
        q: String(q.q || "").trim(),
        opts,
        a: Number.isInteger(answer) && answer >= 0 && answer < opts.length ? answer : 0,
        e: String(q.e || "").trim()
      };
    });
    if (cleaned.some(q => !q.q || q.opts.length < 2)) return socket.emit("errorMsg", "Setiap soal harus memiliki pertanyaan dan minimal 2 pilihan jawaban.");
    room.questions = cleaned;
    room.qIndex = 0;
    room.questionStartedAt = null;
    emitRoom(room);
    emitAdmin(room);
    socket.emit("questionsSaved", { count: room.questions.length });
  });

  // Hanya ADMIN yang dapat memindahkan permainan ke soal berikutnya.
  socket.on("nextQuestion", ({ code }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    const p = room.sockets.get(socket.id);
    if (!p || p.role !== "teacher") return;

    if (room.qIndex < room.questions.length - 1) {
      room.qIndex++;
      room.questionStartedAt = Date.now();
      emitRoom(room);
      emitAdmin(room);
      io.to(room.code).emit("questionStarted", { qIndex: room.qIndex, total: room.questions.length, startedAt: room.questionStartedAt });
    } else {
      room.status = "finished";
      room.questionStartedAt = null;
      emitRoom(room);
      emitAdmin(room);
    }
  });

  // Review is ADMIN ONLY and contains the answers/correct answers.
  socket.on("requestReview", ({ code, teamId }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    const p = room.sockets.get(socket.id);
    if (!p || p.role !== "teacher") return;
    const t = room.teams.get(teamId);
    if (!t) return;
    socket.emit("review", room.questions.map((q, i) => ({
      number: i + 1,
      subject: q.subject,
      question: q.q,
      teamAnswer: t.answers[i]?.choice === null || t.answers[i]?.choice === undefined ? (t.answers[i]?.skipped ? "DILEWATI" : "BELUM MENJAWAB") : q.opts[t.answers[i].choice],
      correctAnswer: q.opts[q.a],
      result: t.answers[i]?.correct ? "BENAR" : (t.answers[i]?.skipped ? "DILEWATI" : (t.answers[i] ? "SALAH" : "BELUM MENJAWAB")),
      score: t.answers[i]?.points || 0
    })));
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const p = room.sockets.get(socket.id);
      if (p?.teamId) {
        const t = room.teams.get(p.teamId);
        if (t) t.members = t.members.filter(m => m.id !== socket.id);
      }
      room.sockets.delete(socket.id);
      emitRoom(room);
      emitAdmin(room);
    }
  });
});


async function ensureBuiltinQuizBank() {
  const builtins = [];
  for (const className of ["SD 1","SD 2","SD 3","SD 4","SD 5","SD 6","SMP 7","SMP 8","SMP 9","SMA 10","SMA 11","SMA 12"]) {
    for (const subject of Object.keys(subjects)) {
      const id = "builtin-" + className.toLowerCase().replace(/[^a-z0-9]+/g,"-") + "-" + subject.toLowerCase().replace(/[^a-z0-9]+/g,"-");
      const questions = buildBuiltinQuestions(className, subject);
      builtins.push({ id, name:`${subject} — ${className} (100 Soal)`, subject, className, description:`100 soal bawaan untuk ${subject}, ${className}.`, builtIn:true, questions:cleanQuizQuestions(questions), updatedAt:new Date().toISOString() });
    }
  }
  const custom = quizBank.filter(q => !q.builtIn);
  quizBank = [...builtins, ...custom];
  if (storageMode === "postgres" && pool) {
    for (const q of builtins) {
      await pool.query(
        `INSERT INTO quiz_bank (id,name,subject,description,built_in,questions,updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,subject=EXCLUDED.subject,description=EXCLUDED.description,built_in=EXCLUDED.built_in,questions=EXCLUDED.questions,updated_at=EXCLUDED.updated_at`,
        [q.id,q.name,q.subject,q.description,true,JSON.stringify(q.questions),q.updatedAt]
      );
    }
    await pool.query(`DELETE FROM quiz_bank WHERE built_in = TRUE AND NOT (id = ANY($1::text[]))`, [builtins.map(q=>q.id)]);
  } else {
    fs.writeFileSync(QUIZ_FILE, JSON.stringify(quizBank,null,2));
  }
}

const PORT = Number(process.env.PORT) || 3000;
(async () => {
  quizBank = await loadQuizBank();
  await ensureBuiltinQuizBank();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`QUIZ NUSANTARA v3.3 running on 0.0.0.0:${PORT} | storage=${storageMode}`);
  });
})().catch(err => { console.error("Startup failed:", err); process.exit(1); });
