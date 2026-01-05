// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieSession from "cookie-session";
import bcrypt from "bcryptjs";
import Stripe from "stripe";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ====== ENV ======
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_session_secret_change_me";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";

// Stripe init (nur wenn Key vorhanden)
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ====== Middleware ======
app.use(express.json({ limit: "1mb" }));

app.use(
  cookieSession({
    name: "session",
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: "lax",
    // Railway läuft über HTTPS (Proxy) → secure true ist ok
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 Tage
  })
);

// ====== Mini-User-Store (MVP) ======
// Für MVP reicht in-memory. Später DB.
const users = new Map(); // email -> { email, passwordHash, isPro }

// Helpers
function ok(res, obj) {
  res.json({ ok: true, ...obj });
}
function fail(res, status, message, extra = {}) {
  res.status(status).json({ ok: false, error: message, ...extra });
}
function requireLogin(req, res, next) {
  if (!req.session?.user?.email) return fail(res, 401, "Not logged in");
  return next();
}

// ====== Auth ======
app.post("/auth/register", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) return fail(res, 400, "E-Mail und Passwort erforderlich");
    if (password.length < 6) return fail(res, 400, "Passwort muss mind. 6 Zeichen haben");
    if (users.has(email)) return fail(res, 409, "User existiert bereits");

    const passwordHash = await bcrypt.hash(password, 10);
    users.set(email, { email, passwordHash, isPro: false });

    req.session.user = { email };
    return ok(res, { registered: true, loggedIn: true, user: { email } });
  } catch (e) {
    return fail(res, 500, "Register failed", { details: String(e) });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const u = users.get(email);

    if (!u) return fail(res, 401, "Login fehlgeschlagen");
    const valid = await bcrypt.compare(password, u.passwordHash);
    if (!valid) return fail(res, 401, "Login fehlgeschlagen");

    req.session.user = { email };
    return ok(res, { loggedIn: true, user: { email } });
  } catch (e) {
    return fail(res, 500, "Login failed", { details: String(e) });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session = null;
  return ok(res, { loggedOut: true, loggedIn: false });
});

app.get("/auth/me", (req, res) => {
  const email = req.session?.user?.email || null;
  if (!email) return ok(res, { loggedIn: false });

  const u = users.get(email);
  return ok(res, {
    loggedIn: true,
    user: { email },
    pro: !!u?.isPro,
  });
});

// ====== Stripe Checkout ======
app.post("/stripe/create-checkout-session", requireLogin, async (req, res) => {
  try {
    if (!stripe) return fail(res, 500, "Stripe ist nicht konfiguriert (STRIPE_SECRET_KEY fehlt)");
    if (!STRIPE_PRICE_ID) return fail(res, 500, "STRIPE_PRICE_ID fehlt");

    const email = req.session.user.email;

    // Herkunft für Redirects (Railway)
    const origin =
      req.headers.origin ||
      `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      customer_email: email,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      // Wir speichern die email, damit wir sie später im Webhook sauber zuordnen können
      metadata: { email },
      allow_promotion_codes: true,
    });

    return ok(res, { url: session.url });
  } catch (e) {
    return fail(res, 500, "Stripe Checkout Fehler", { details: String(e) });
  }
});

// Optional: Dummy-Pro-Freischaltung (nur zum Testen, später Webhook!)
app.post("/admin/dev-set-pro", requireLogin, (req, res) => {
  const email = req.session.user.email;
  const u = users.get(email);
  if (!u) return fail(res, 404, "User nicht gefunden");
  u.isPro = true;
  users.set(email, u);
  return ok(res, { pro: true });
});

// ====== Static Frontend ======
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback (falls du später Routen brauchst)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port:", PORT);
});
