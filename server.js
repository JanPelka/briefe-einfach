// server.js  (ESM)
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- IMPORTANT for Railway / HTTPS Proxy ---
app.set("trust proxy", 1); // Railway proxy

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Session (fix for "loggedIn:false") ---
const isProd = process.env.NODE_ENV === "production";
const cookieSecure =
  (process.env.COOKIE_SECURE || "").toLowerCase() === "true" || isProd;

app.use(
  session({
    name: "be_sid",
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    proxy: true, // IMPORTANT behind proxy
    cookie: {
      httpOnly: true,
      secure: cookieSecure,       // must be true on https
      sameSite: "lax",            // works with Stripe redirect + same domain
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
  })
);

// ---- STATIC (dein Frontend) ----
app.use(express.static(path.join(__dirname, "public")));

// ---- AUTH ENDPOINTS (MVP) ----
// Wenn du schon Login/Register hast, kann das bleiben – aber das hier sorgt sicher dafür,
// dass Session wirklich gesetzt wird.

const users = new Map(); // email -> { password }  (MVP: in-memory)

app.post("/auth/register", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: "missing_fields" });
  if (users.has(email)) return res.status(409).json({ ok: false, error: "exists" });

  users.set(email, { password });
  req.session.user = { email };
  return res.json({ ok: true, loggedIn: true });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const u = users.get(email);

  if (!u || u.password !== password) {
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }

  req.session.user = { email };
  return res.json({ ok: true, loggedIn: true });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("be_sid");
    res.json({ ok: true });
  });
});

app.get("/auth/me", (req, res) => {
  const loggedIn = !!(req.session && req.session.user);
  res.json({ ok: true, loggedIn, user: loggedIn ? req.session.user : null });
});

// Health
app.get("/health", (_req, res) => res.json({ ok: true, status: "healthy" }));

// fallback -> index.html (Single Page)
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on", port));
