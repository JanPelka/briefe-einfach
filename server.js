import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieSession from "cookie-session";
import bcrypt from "bcryptjs";
import Stripe from "stripe";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_SECRET = process.env.SESSION_SECRET || "dev_change_me";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ""; // optional (später)

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ===== In-Memory User Store (MVP) =====
// Wichtig: nach Neustart sind registrierte User weg. Für MVP ok.
const users = new Map(); // email -> { hash }

app.use(express.json({ limit: "2mb" }));
app.use(
  cookieSession({
    name: "session",
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: "lax",
    secure: true
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ===== Helpers =====
function requireLogin(req, res, next) {
  if (!req.session?.user?.email) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

// ===== Auth =====
app.post("/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) return res.json({ ok: false, error: "E-Mail & Passwort nötig" });
    if (users.has(email)) return res.json({ ok: false, error: "E-Mail existiert schon" });

    const hash = await bcrypt.hash(password, 10);
    users.set(email, { hash });

    req.session.user = { email };
    res.json({ ok: true, loggedIn: true, user: { email } });
  } catch (e) {
    res.json({ ok: false, error: "Register fehlgeschlagen" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const u = users.get(email);
    if (!u) return res.json({ ok: false, error: "Login fehlgeschlagen" });

    const ok = await bcrypt.compare(password, u.hash);
    if (!ok) return res.json({ ok: false, error: "Login fehlgeschlagen" });

    req.session.user = { email };
    res.json({ ok: true, loggedIn: true, user: { email } });
  } catch (e) {
    res.json({ ok: false, error: "Login fehlgeschlagen" });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true, loggedIn: false });
});

app.get("/auth/me", (req, res) => {
  const email = req.session?.user?.email || null;
  res.json({ ok: true, loggedIn: !!email, user: email ? { email } : null });
});

// ===== Stripe Checkout (MVP) =====
app.post("/billing/checkout", requireLogin, async (req, res) => {
  try {
    if (!stripe || !STRIPE_PRICE_ID) {
      return res.status(400).json({ ok: false, error: "Stripe nicht konfiguriert" });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/?paid=1`,
      cancel_url: `${origin}/?canceled=1`,
      customer_email: req.session.user.email
    });

    res.json({ ok: true, url: session.url });
  } catch (e) {
    res.status(400).json({ ok: false, error: "Checkout fehlgeschlagen" });
  }
});

// ===== KI Endpoints (Platzhalter erstmal) =====
app.post("/api/explain", requireLogin, async (req, res) => {
  const text = String(req.body.text || "");
  if (!text.trim()) return res.json({ ok: false, error: "Kein Text" });

  // MVP: ohne KI-Key liefern wir nur Dummy zurück (damit UI & Login stabil sind)
  if (!OPENAI_API_KEY) {
    return res.json({
      ok: true,
      result:
        "✅ Server läuft & Login funktioniert.\n\n(Als nächstes schalten wir die echte KI frei – dafür brauchst du OPENAI_API_KEY in Railway.)\n\nDein Text war:\n" +
        text.slice(0, 500)
    });
  }

  // Später bauen wir echte OpenAI-Calls sauber ein – erst wenn alles stabil ist.
  res.json({ ok: true, result: "OPENAI_API_KEY ist gesetzt – nächster Schritt: echte KI-Integration." });
});

app.post("/api/translate", requireLogin, async (req, res) => {
  const text = String(req.body.text || "");
  const target = String(req.body.target || "Deutsch");
  if (!text.trim()) return res.json({ ok: false, error: "Kein Text" });

  if (!OPENAI_API_KEY) {
    return res.json({
      ok: true,
      result: `✅ Übersetzen (Dummy): Ziel=${target}\n\n` + text
    });
  }

  res.json({ ok: true, result: "OPENAI_API_KEY ist gesetzt – nächster Schritt: echte Übersetzung." });
});

app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
