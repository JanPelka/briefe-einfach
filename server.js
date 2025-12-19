import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import session from "express-session";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== ENV ======
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret_change_me";

// Optional, aber empfohlen:
const BASE_URL =
  process.env.BASE_URL ||
  (process.env.RAILWAY_STATIC_URL
    ? `https://${process.env.RAILWAY_STATIC_URL}`
    : "http://localhost:3000");

// ====== MIDDLEWARE ======
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: BASE_URL.startsWith("https://")
    }
  })
);

// Static Frontend
app.use(express.static(path.join(__dirname, "public")));

// ====== MINIMAL USER STORE (MVP) ======
// ⚠️ Für MVP ok. In Produktion später DB nutzen.
const users = new Map(); // email -> { email, passwordHash, isPro: boolean }

// ====== HELPERS ======
function requireAuth(req, res, next) {
  if (!req.session?.userEmail) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

function getCurrentUser(req) {
  const email = req.session?.userEmail;
  if (!email) return null;
  return users.get(email) || null;
}

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // Stripe initialisieren nur wenn Key existiert → verhindert Crash-Loop
  return new Stripe(key);
}

// ====== HEALTH ======
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

// ====== AUTH ======
app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Email & Passwort nötig" });
  }
  if (users.has(email)) {
    return res.status(409).json({ ok: false, error: "User existiert schon" });
  }
  const passwordHash = await bcrypt.hash(String(password), 10);
  users.set(email, { email, passwordHash, isPro: false });
  req.session.userEmail = email;
  res.json({ ok: true, email, isPro: false });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.get(email);
  if (!user) return res.status(401).json({ ok: false, error: "Login falsch" });

  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, error: "Login falsch" });

  req.session.userEmail = email;
  res.json({ ok: true, email, isPro: user.isPro });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/auth/me", (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.json({ ok: true, loggedIn: false });
  res.json({ ok: true, loggedIn: true, email: user.email, isPro: user.isPro });
});

// ====== STRIPE: Checkout Session (Subscription) ======
app.post("/stripe/create-checkout-session", requireAuth, async (req, res) => {
  const stripe = getStripeClient();
  if (!stripe) {
    return res.status(500).json({
      ok: false,
      error:
        "Stripe Secret Key fehlt (STRIPE_SECRET_KEY). Railway Variablen prüfen."
    });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return res.status(500).json({
      ok: false,
      error: "STRIPE_PRICE_ID fehlt. Railway Variablen prüfen."
    });
  }

  const user = getCurrentUser(req);
  const customerEmail = user.email;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: customerEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${BASE_URL}/?success=1`,
      cancel_url: `${BASE_URL}/?canceled=1`,
      // (optional) metadata:
      metadata: { userEmail: customerEmail }
    });

    return res.json({ ok: true, url: session.url });
  } catch (e) {
    console.error("Stripe checkout error:", e);
    return res.status(500).json({ ok: false, error: "Stripe Fehler" });
  }
});

// ====== WEBHOOK (optional, aber empfohlen) ======
// Damit du automatisch "isPro=true" setzt, sobald Zahlung durch ist.
// In Stripe Dashboard Webhook anlegen → Endpoint: https://DEIN-RAILWAY-URL/stripe/webhook
// Secret in STRIPE_WEBHOOK_SECRET speichern.
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const stripe = getStripeClient();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripe || !webhookSecret) {
      // Ohne Webhook Secret: nicht crashen, aber nicht verifizieren
      return res.status(400).send("Webhook not configured");
    }

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verify failed:", err?.message);
      return res.status(400).send("Bad signature");
    }

    try {
      // Du kannst hier später genauer prüfen, z.B. invoice.paid etc.
      if (event.type === "checkout.session.completed") {
        const sessionObj = event.data.object;
        const email = sessionObj.customer_email || sessionObj.metadata?.userEmail;
        if (email && users.has(email)) {
          const u = users.get(email);
          u.isPro = true;
          users.set(email, u);
          console.log("User upgraded to PRO:", email);
        }
      }

      res.json({ received: true });
    } catch (e) {
      console.error("Webhook handler error:", e);
      res.status(500).send("Webhook handler error");
    }
  }
);

// ====== Fallback: Frontend ======
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on ${BASE_URL} (port ${PORT})`);
});
