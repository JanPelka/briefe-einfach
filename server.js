import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import Stripe from "stripe";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --------- Basics ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Railway/Proxy Fix: damit Secure-Cookies hinter Proxy funktionieren
app.set("trust proxy", true);

// --------- Session ----------
app.use(
  session({
    name: "sid",
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    proxy: true, // ✅ wichtig bei Railway
    cookie: {
      httpOnly: true,
      secure: "auto", // ✅ setzt secure Cookie nur wenn HTTPS erkannt
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 Tage
      path: "/", // ✅ wichtig
    },
  })
);

// --------- Stripe ----------
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// --------- Helpers ----------
function requireLogin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

// --------- Health ----------
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

// --------- Auth ----------
app.post("/auth/register", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: "Missing email/password" });

  // MVP: keine DB -> wir "registrieren" nicht wirklich, aber loggen direkt ein
  req.session.user = { email };

  // ✅ wichtig: Session aktiv speichern, damit Cookie rausgeht
  req.session.save((err) => {
    if (err) return res.status(500).json({ ok: false, error: "Session save failed" });
    return res.json({ ok: true, loggedIn: true, user: { email } });
  });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: "Missing email/password" });

  // MVP: keine DB/Prüfung -> Login = Session setzen
  req.session.user = { email };

  req.session.save((err) => {
    if (err) return res.status(500).json({ ok: false, error: "Session save failed" });
    return res.json({ ok: true, loggedIn: true, user: { email } });
  });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sid", { path: "/" });
    res.json({ ok: true });
  });
});

app.get("/auth/me", (req, res) => {
  const loggedIn = !!req.session?.user;
  res.json({
    ok: true,
    loggedIn,
    user: loggedIn ? req.session.user : null,
  });
});

// --------- Stripe Checkout (Abo) ----------
app.post("/stripe/create-checkout-session", requireLogin, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured" });
    if (!STRIPE_PRICE_ID) return res.status(500).json({ ok: false, error: "Missing STRIPE_PRICE_ID" });

    const baseUrl =
      req.headers["x-forwarded-proto"]
        ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}`
        : `${req.protocol}://${req.headers.host}`;

    const sessionObj = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancel`,
      client_reference_id: req.session.user.email,
    });

    res.json({ ok: true, url: sessionObj.url });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --------- Static Frontend ----------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --------- Listen ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
