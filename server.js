// server.js (JWT statt Cookies) - Railway/Chrome/PWA stabil
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Stripe from "stripe";

// -------------------- Config --------------------
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const JWT_EXPIRES_IN = "30d";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// -------------------- In-Memory User DB (MVP) --------------------
// Später ersetzen wir das durch Postgres. Für jetzt reicht MVP.
const usersByEmail = new Map(); // email -> { id, email, passHash, pro, stripeCustomerId }
const usersById = new Map();    // id -> same

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function signToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, pro: !!user.pro },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ ok: false, error: "Not logged in" });

  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    const user = usersById.get(payload.uid);
    if (!user) return res.status(401).json({ ok: false, error: "User not found" });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

// -------------------- Stripe Webhook MUST be RAW --------------------
app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!stripe) return res.status(500).send("Stripe not configured");
    if (!STRIPE_WEBHOOK_SECRET) return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");

    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    // 1) Checkout completed -> mark PRO
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session?.metadata?.userId;
      if (userId && usersById.has(userId)) {
        const u = usersById.get(userId);
        u.pro = true;
        // Optional: refresh token on client by calling /auth/me
        console.log("✅ PRO activated for", u.email);
      }
    }

    // 2) Subscription deleted -> remove PRO
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const customerId = sub.customer;

      for (const u of usersById.values()) {
        if (u.stripeCustomerId === customerId) {
          u.pro = false;
          console.log("❌ PRO removed for", u.email);
        }
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || err}`);
  }
});

// -------------------- Normal JSON middleware AFTER webhook --------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------- Health --------------------
app.get("/health", (_req, res) => res.json({ ok: true, status: "healthy" }));

// -------------------- AUTH (JWT) --------------------
app.post("/auth/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || password.length < 4) {
      return res.status(400).json({ ok: false, error: "Email + Passwort (mind. 4 Zeichen) erforderlich" });
    }
    if (usersByEmail.has(email)) {
      return res.status(409).json({ ok: false, error: "E-Mail existiert bereits" });
    }

    const id = crypto.randomUUID();
    const passHash = await bcrypt.hash(password, 10);

    const user = { id, email, passHash, pro: false, stripeCustomerId: null };
    usersByEmail.set(email, user);
    usersById.set(id, user);

    const token = signToken(user);
    return res.json({ ok: true, token, user: { email: user.email, pro: user.pro } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    const user = usersByEmail.get(email);
    if (!user) return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });

    const ok = await bcrypt.compare(password, user.passHash);
    if (!ok) return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });

    const token = signToken(user);
    return res.json({ ok: true, token, user: { email: user.email, pro: user.pro } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/auth/me", authMiddleware, (req, res) => {
  const u = req.user;
  // Token-Refresh: wir geben optional auch einen frischen Token zurück (damit pro-Status aktuell ist)
  const freshToken = signToken(u);
  return res.json({ ok: true, user: { email: u.email, pro: !!u.pro }, token: freshToken });
});

// -------------------- Stripe Checkout (Abo) --------------------
app.post("/billing/create-checkout-session", authMiddleware, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured" });
    if (!STRIPE_PRICE_ID) return res.status(500).json({ ok: false, error: "Missing STRIPE_PRICE_ID" });

    const u = req.user;

    // Create customer if missing
    let customerId = u.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: u.email,
        metadata: { userId: u.id },
      });
      customerId = customer.id;
      u.stripeCustomerId = customerId;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl(req)}/?paid=1`,
      cancel_url: `${baseUrl(req)}/?cancel=1`,
      metadata: { userId: u.id },
    });

    return res.json({ ok: true, url: session.url });
  } catch (e) {
    console.error("Checkout error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Checkout error" });
  }
});

// -------------------- Static Frontend --------------------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// -------------------- Start --------------------
app.listen(PORT, () => console.log("✅ Server running on", PORT));
