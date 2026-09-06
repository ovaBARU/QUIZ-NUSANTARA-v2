const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
app.set("trust proxy", 1);

app.use(express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});
app.get("/health", (req, res) => {
  res.json({ ok: true, app: "QUIZ NUSANTARA" });
});

const rooms = new Map();

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

function makeQuestions(subject) {
  let arr;
  if (subject === "GAME CAMPURAN") {
    arr = Object.entries(subjects).flatMap(([s, qs]) => qs.map(x => ({ ...x, subject: s })));
  } else {
    arr = (subjects[subject] || subjects["Matematika"]).map(x => ({ ...x, subject }));
  }
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
  socket.on("createRoom", ({ className, subject, teacherName, quizId }) => {
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
        return saved ? cleanQuizQuestions(saved.questions) : makeQuestions(subject);
      })(),
      teams: new Map(),
      sockets: new Map(),
      questionStartedAt: null
    };
    rooms.set(code, room);
    room.sockets.set(socket.id, { role: "teacher", name: room.teacherName });
    socket.join(code);
    socket.emit("created", { code });
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

  socket.on("startGame", ({ code }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;
    const p = room.sockets.get(socket.id);
    if (!p || !["teacher", "player"].includes(p.role)) return;
    if (room.teams.size < 1) return socket.emit("errorMsg", "Belum ada siswa/tim yang bergabung.");

    room.status = "playing";
    room.qIndex = 0;
    room.questionStartedAt = Date.now();
    for (const t of room.teams.values()) { t.score = 0; t.answers = {}; }
    emitRoom(room);
    emitAdmin(room);
    io.to(room.code).emit("questionStarted", { qIndex: 0, total: room.questions.length, startedAt: room.questionStartedAt });
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

  // Persistent bank kuis: ADMIN can save, load, and delete quizzes.
  socket.on("saveQuiz", ({ code, name, description, questions }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const p = room && room.sockets.get(socket.id);
    if (!room || !p || p.role !== "teacher") return;
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
    if (!room || !p || p.role !== "teacher") return;
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

const PORT = Number(process.env.PORT) || 3000;
(async () => {
  quizBank = await loadQuizBank();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`QUIZ NUSANTARA v2.8 running on 0.0.0.0:${PORT} | storage=${storageMode}`);
  });
})().catch(err => { console.error("Startup failed:", err); process.exit(1); });
