// server.js (Railway-stabil: ESM + Express + Cookie-Session + Static UI)

import express from "express";
import cookieSession from "cookie-session";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ===== ENV =====
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_session_secret_change_me";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";

// Stripe (optional)
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ===== Middleware =====
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1); // wichtig hinter Railway Proxy

app.use(
  cookieSession({
    name: "session",
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: "lax",
    secure: true, // Railway läuft über HTTPS => secure muss true sein
    maxAge: 7 * 24 * 60 * 60 * 1000
  })
);

// Static UI
app.use(express.static(path.join(__dirname, "public")));

// ===== Mini "DB" (in-memory) =====
// WICHTIG: Das ist fürs MVP. Bei Neustart sind Nutzer weg.
// Später ersetzen wir das sauber (SQLite / Postgres).
const users = new Map(); // email -> { email, passHash }

// Session helpers
function setUserSession(req, email) {
  req.session.user = { email };
}
function clearUserSession(req) {
  req.session = null;
}
function requireLogin(req, res, next) {
  if (!req.session?.user?.email) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

// ===== Health / Root =====
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/", (req, res) => {
  // index.html wird über express.static ausgeliefert,
  // aber falls irgendwas schief läuft:
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== AUTH =====
app.post("/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "E-Mail und Passwort erforderlich" });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: "Passwort mindestens 6 Zeichen" });
    }
    if (users.has(email)) {
      return res.status(409).json({ ok: false, error: "User existiert bereits" });
    }

    const passHash = await bcrypt.hash(password, 10);
    users.set(email, { email, passHash });

    setUserSession(req, email);
    return res.json({ ok: true, loggedIn: true, user: { email } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Register fehlgeschlagen" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const u = users.get(email);
    if (!u) return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });

    const ok = await bcrypt.compare(password, u.passHash);
    if (!ok) return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });

    setUserSession(req, email);
    return res.json({ ok: true, loggedIn: true, user: { email } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Login fehlgeschlagen" });
  }
});

app.post("/auth/logout", (req, res) => {
  clearUserSession(req);
  return res.json({ ok: true, loggedIn: false });
});

app.get("/auth/me", (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.json({ ok: true, loggedIn: false });
  return res.json({ ok: true, loggedIn: true, user: { email } });
});

// ===== APP: Erklären / Übersetzen =====
// MVP-Logik (ohne OpenAI): funktioniert immer, keine Keys nötig.
function explainText(text) {
  const t = text.trim();
  if (!t) return "Bitte einen Brieftext einfügen.";

  // super einfache „Behördenbrief“-Erklärung (MVP)
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const short = lines.slice(0, 10).join(" ");

  return [
    "✅ Kurze Erklärung (MVP):",
    "",
    "• Worum geht’s? -> Es handelt sich um ein Schreiben, das eine Reaktion/Prüfung verlangt.",
    "• Was solltest du tun? -> Frist/Anforderung prüfen, ggf. antworten oder Unterlagen nachreichen.",
    "• Wichtige Daten -> Suche nach Datum, Aktenzeichen, Frist, Forderung/Anforderung.",
    "",
    "📌 Auszug (erste Zeilen):",
    short.length > 400 ? short.slice(0, 400) + "…" : short,
    "",
    "Wenn du willst, bauen wir als Nächstes KI sauber ein (OpenAI-Key + echte Übersetzung/Erklärung)."
  ].join("\n");
}

function translateText(text, target = "de") {
  const t = text.trim();
  if (!t) return "Bitte Text zum Übersetzen einfügen.";

  // MVP: kein echtes Übersetzen, aber „funktioniert“ sichtbar
  // (damit UI/Buttons/Routes sauber laufen)
  return [
    `✅ Übersetzung (MVP) -> Ziel: ${target}`,
    "",
    "(Noch ohne KI – Technik läuft aber stabil.)",
    "",
    t
  ].join("\n");
}

app.post("/api/explain", requireLogin, (req, res) => {
  const text = String(req.body.text || "");
  const result = explainText(text);
  return res.json({ ok: true, result });
});

app.post("/api/translate", requireLogin, (req, res) => {
  const text = String(req.body.text || "");
  const target = String(req.body.target || "de");
  const result = translateText(text, target);
  return res.json({ ok: true, result });
});

// ===== Stripe Checkout (optional) =====
app.post("/api/stripe/create-checkout-session", requireLogin, async (req, res) => {
  try {
    if (!stripe || !STRIPE_PRICE_ID) {
      return res.status(501).json({
        ok: false,
        error: "Stripe ist noch nicht konfiguriert (STRIPE_SECRET_KEY/STRIPE_PRICE_ID fehlen)."
      });
    }

    const origin =
      req.headers.origin ||
      `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/?success=1`,
      cancel_url: `${origin}/?cancel=1`
    });

    return res.json({ ok: true, url: session.url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Stripe Checkout fehlgeschlagen" });
  }
});

// ===== Start =====
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server listening on", PORT);
});
