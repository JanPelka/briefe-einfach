import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import Stripe from "stripe";

const app = express();
app.set("trust proxy", 1);

// ---------- ENV ----------
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Basic JSON ----------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------- Minimal cookie/session (no extra libs) ----------
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}
function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (typeof opts.maxAge === "number") parts.push(`Max-Age=${opts.maxAge}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax`);
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host;
  return `${proto}://${host}`;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
function randomId(prefix = "") {
  return prefix + crypto.randomBytes(16).toString("hex");
}

// ---------- In-memory stores (MVP) ----------
/**
 * usersByEmail: email -> { id, email, passHash, createdAt, isPro }
 * sessions: sid -> { userId, email, createdAt }
 *
 * Hinweis: In Produktion später DB (Postgres) verwenden,
 * weil In-Memory bei Redeploy verloren geht.
 */
const usersByEmail = new Map();
const sessions = new Map();

function authUser(req) {
  const cookies = parseCookies(req);
  const sid = cookies.sid || "";
  if (!sid) return null;
  const sess = sessions.get(sid);
  if (!sess) return null;
  const u = usersByEmail.get(sess.email);
  if (!u) return null;
  return { id: u.id, email: u.email, isPro: !!u.isPro };
}

function requireAuth(req, res, next) {
  const u = authUser(req);
  if (!u) return res.status(401).json({ ok: false, error: "Not logged in" });
  req.user = u;
  next();
}

function requirePro(req, res, next) {
  const u = authUser(req);
  if (!u) return res.status(401).json({ ok: false, error: "Not logged in" });
  if (!u.isPro) return res.status(402).json({ ok: false, error: "PRO erforderlich (Abo)" });
  req.user = u;
  next();
}

// ---------- Health ----------
app.get("/health", (req, res) => res.json({ ok: true, status: "healthy" }));

// ---------- Auth ----------
app.get("/auth/me", (req, res) => {
  const u = authUser(req);
  if (!u) return res.status(401).json({ ok: false, error: "Not logged in" });
  res.json({ ok: true, user: u });
});

app.post("/auth/register", (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanPass = String(password || "");

  if (!SESSION_SECRET) {
    return res.status(500).json({ ok: false, error: "Server config: SESSION_SECRET fehlt" });
  }
  if (!cleanEmail || !cleanPass) {
    return res.status(400).json({ ok: false, error: "Email und Passwort benötigt" });
  }
  if (cleanPass.length < 6) {
    return res.status(400).json({ ok: false, error: "Passwort min. 6 Zeichen" });
  }
  if (usersByEmail.has(cleanEmail)) {
    return res.status(409).json({ ok: false, error: "E-Mail existiert bereits" });
  }

  const user = {
    id: randomId("u_"),
    email: cleanEmail,
    passHash: sha256(SESSION_SECRET + "::" + cleanPass),
    createdAt: new Date().toISOString(),
    isPro: false
  };
  usersByEmail.set(cleanEmail, user);

  // Auto login
  const sid = randomId("s_");
  sessions.set(sid, { userId: user.id, email: user.email, createdAt: new Date().toISOString() });

  setCookie(res, "sid", sid, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  res.json({ ok: true, user: { id: user.id, email: user.email, isPro: false } });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanPass = String(password || "");

  if (!SESSION_SECRET) {
    return res.status(500).json({ ok: false, error: "Server config: SESSION_SECRET fehlt" });
  }
  if (!cleanEmail || !cleanPass) {
    return res.status(400).json({ ok: false, error: "Email und Passwort benötigt" });
  }

  const user = usersByEmail.get(cleanEmail);
  if (!user) return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });

  const passHash = sha256(SESSION_SECRET + "::" + cleanPass);
  if (passHash !== user.passHash) {
    return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });
  }

  const sid = randomId("s_");
  sessions.set(sid, { userId: user.id, email: user.email, createdAt: new Date().toISOString() });

  setCookie(res, "sid", sid, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  res.json({ ok: true, user: { id: user.id, email: user.email, isPro: !!user.isPro } });
});

app.post("/auth/logout", (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (sid) sessions.delete(sid);
  clearCookie(res, "sid");
  res.json({ ok: true });
});

// ---------- Entitlement (FREE/PRO) ----------
app.get("/api/entitlement", (req, res) => {
  const u = authUser(req);
  if (!u) return res.json({ ok: true, loggedIn: false, plan: "FREE" });
  res.json({ ok: true, loggedIn: true, plan: u.isPro ? "PRO" : "FREE", user: u });
});

// ---------- Stripe Checkout (Subscription) ----------
app.post("/stripe/create-checkout-session", requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ ok: false, error: "Stripe nicht konfiguriert (STRIPE_SECRET_KEY)" });
  if (!STRIPE_PRICE_ID) return res.status(500).json({ ok: false, error: "STRIPE_PRICE_ID fehlt" });

  try {
    const baseUrl = getBaseUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancel`,
      customer_email: req.user.email,
      client_reference_id: req.user.id,
      metadata: {
        userId: req.user.id,
        email: req.user.email
      }
    });

    res.json({ ok: true, url: session.url });
  } catch (e) {
    console.error("Stripe error:", e);
    res.status(500).json({ ok: false, error: e?.message || "Stripe error" });
  }
});

/**
 * OPTIONAL (später):
 * Webhook damit PRO automatisch gesetzt wird, wenn Zahlung durch ist.
 * Dafür brauchst du STRIPE_WEBHOOK_SECRET (whsec_...).
 *
 * Für MVP kannst du PRO auch manuell setzen (s.u. /admin/make-pro).
 */
app.post("/admin/make-pro", requireAuth, (req, res) => {
  // MVP-Notfall: macht den eingeloggten User pro (für Tests)
  const u = usersByEmail.get(req.user.email);
  u.isPro = true;
  usersByEmail.set(req.user.email, u);
  res.json({ ok: true, user: { id: u.id, email: u.email, isPro: true } });
});

// ---------- PRO Endpoints (Option B) ----------
app.post("/api/explain-text", requirePro, async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (text.length < 15) return res.status(400).json({ ok: false, error: "Text zu kurz" });

  // MVP: Hier später OpenAI anbinden. Für jetzt liefern wir sauberes Ergebnis zurück.
  // So ist die App "fertig" vom Ablauf her, ohne dass sie crasht.
  const result =
    "✅ Erklärung (PRO):\n\n" +
    "Ich habe deinen Text erhalten.\n" +
    "• Worum geht’s grob: (MVP Placeholder)\n" +
    "• Was du tun solltest: (MVP Placeholder)\n\n" +
    "Textlänge: " + text.length + " Zeichen.";

  res.json({ ok: true, text: result });
});

app.post("/api/generate-reply", requirePro, async (req, res) => {
  const base = String(req.body?.explanation || "").trim();
  const meta = req.body?.meta || {};

  const sender = String(meta.sender || "").trim();
  const recipient = String(meta.recipient || "").trim();
  const subject = String(meta.subject || "Antwort auf Ihr Schreiben").trim();
  const ref = String(meta.ref || "").trim();
  const place = String(meta.place || "").trim();
  const dateStr = String(meta.dateStr || new Date().toLocaleDateString("de-DE")).trim();

  const reply =
    `${sender ? sender + "\n\n" : ""}` +
    `${recipient ? recipient + "\n\n" : ""}` +
    `${[place, dateStr].filter(Boolean).join(", ")}\n\n` +
    `Betreff: ${subject}${ref ? " – " + ref : ""}\n\n` +
    `Sehr geehrte Damen und Herren,\n\n` +
    `vielen Dank für Ihr Schreiben.\n\n` +
    `Nach Prüfung teile ich Folgendes mit:\n` +
    `- (MVP Placeholder, basiert später auf Erklärung)\n\n` +
    `Bitte bestätigen Sie mir den Eingang dieses Schreibens.\n\n` +
    `Mit freundlichen Grüßen\n` +
    `${sender ? sender.split("\n")[0] : "(Name)"}`;

  res.json({ ok: true, text: reply, debug: { explanationChars: base.length } });
});

// ---------- Static Frontend ----------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
