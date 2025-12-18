'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// --- Config ---
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Für MVP: In-Memory User Store (später DB)
const users = new Map(); // email -> { id, email, passHash, createdAt }
let userSeq = 1;

// --- Middleware ---
app.use(express.json({ limit: '1mb' }));

// CORS: erlaubt Railway + Localhost + (notfalls) null-origin
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      undefined, // same-origin / server-side
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://briefe-einfach-production.up.railway.app',
      null // file:// -> origin = null (nur zum Debug, besser vermeiden)
    ];
    if (allowed.includes(origin)) return cb(null, true);
    return cb(null, true); // MVP: nicht hart blocken
  },
  credentials: true
}));

// Static Frontend
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'healthy' });
});

// MVP-Erklärung (Dummy – später OpenAI / KI)
app.post('/erklaeren', (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Bitte Text senden.' });

  res.json({
    kurz: 'Das ist eine einfache Erklärung:',
    erklaerung: [
      'Der Brief richtet sich an Sie.',
      'Es geht darum, den Inhalt verständlich zu erklären.',
      'Lesen Sie die Frist/Handlung und reagieren Sie rechtzeitig.'
    ].join('\n'),
    wasTun: 'Wenn eine Frist genannt ist: Datum notieren, Antwort vorbereiten, ggf. Rückfragen klären.'
  });
});

// --- Auth helpers ---
function signToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token ungültig/abgelaufen.' });
  }
}

// --- Auth routes ---
app.post('/auth/register', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = (req.body?.password || '').trim();

  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich.' });
  if (password.length < 6) return res.status(400).json({ error: 'Passwort muss mind. 6 Zeichen haben.' });
  if (users.has(email)) return res.status(409).json({ error: 'E-Mail ist schon registriert.' });

  const passHash = await bcrypt.hash(password, 10);
  const user = { id: String(userSeq++), email, passHash, createdAt: new Date().toISOString() };
  users.set(email, user);

  const token = signToken(user);
  res.json({ ok: true, token, user: { id: user.id, email: user.email } });
});

app.post('/auth/login', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = (req.body?.password || '').trim();

  const user = users.get(email);
  if (!user) return res.status(401).json({ error: 'Login fehlgeschlagen.' });

  const ok = await bcrypt.compare(password, user.passHash);
  if (!ok) return res.status(401).json({ error: 'Login fehlgeschlagen.' });

  const token = signToken(user);
  res.json({ ok: true, token, user: { id: user.id, email: user.email } });
});

app.get('/auth/me', authRequired, (req, res) => {
  res.json({ ok: true, user: { id: req.user.uid, email: req.user.email } });
});

// Fallback -> index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
