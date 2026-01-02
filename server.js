import express from "express";
import session from "express-session";
import Stripe from "stripe";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

/**
 * ENV Variablen (Railway -> Variables):
 * - SESSION_SECRET=irgendein_langer_string
 * - STRIPE_SECRET_KEY=sk_test_...
 * - STRIPE_PRICE_ID=price_...
 * - STRIPE_WEBHOOK_SECRET=whsec_...   (optional für Webhook, aber empfohlen)
 * - PUBLIC_BASE_URL=https://briefe-einfach-production.up.railway.app
 * - NODE_ENV=production  (Railway setzt das meistens automatisch)
 */

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Stripe ----------
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

if (!STRIPE_SECRET_KEY) {
  console.error("❌ Missing env STRIPE_SECRET_KEY");
}
if (!STRIPE_PRICE_ID) {
  console.error("❌ Missing env STRIPE_PRICE_ID");
}

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ---------- Basic Middleware ----------
app.use(express.json());

// Railway/Reverse proxy: super wichtig für secure cookies
app.set("trust proxy", 1);

// Session Cookie settings
const isProd = process.env.NODE_ENV === "production";

app.use(
  session({
    name: "be.sid",
    secret: process.env.SESSION_SECRET || "DEV_SECRET_CHANGE_ME",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProd,      // in production true (https), lokal false
      sameSite: "lax",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 Tage
    },
  })
);

// ---------- Mini "DB" (in-memory) ----------
// Hinweis: Für MVP ok. Bei Railway Restart sind Daten weg.
// Später ersetzen wir das durch echte DB (Postgres).
const usersByEmail = new Map(); // email -> { id, email, passHash, pro, stripeCustomerId }
const usersById = new Map();    // id -> user

function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

function requireLogin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ ok: false, error: "Not logged in" });
  next();
}

function getUser(req) {
  const id = req.session?.userId;
  if (!id) return null;
  return usersById.get(id) || null;
}

// ---------- Static Frontend ----------
app.use(express.static(path.join(__dirname, "public")));

// ---------- Health ----------
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

// ---------- Auth ----------
app.post("/auth/register", (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: "Email + Passwort erforderlich" });

    const normalized = String(email).trim().toLowerCase();
    if (usersByEmail.has(normalized)) return res.status(409).json({ ok: false, error: "E-Mail existiert bereits" });

    const id = crypto.randomUUID();
    const user = {
      id,
      email: normalized,
      passHash: hashPassword(String(password)),
      pro: false,
      stripeCustomerId: null,
    };

    usersByEmail.set(normalized, user);
    usersById.set(id, user);

    req.session.userId = id;

    return res.json({ ok: true, user: { email: user.email, pro: user.pro } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/auth/login", (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: "Email + Passwort erforderlich" });

    const normalized = String(email).trim().toLowerCase();
    const user = usersByEmail.get(normalized);
    if (!user) return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });

    if (user.passHash !== hashPassword(String(password))) {
      return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });
    }

    req.session.userId = user.id;
    return res.json({ ok: true, user: { email: user.email, pro: user.pro } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/auth/me", (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ ok: false, error: "Not logged in" });
  return res.json({ ok: true, user: { email: user.email, pro: user.pro } });
});

// ---------- Stripe: Checkout Session (Abo) ----------
app.post("/billing/create-checkout-session", requireLogin, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured" });

    const user = getUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Not logged in" });

    // Stripe Customer anlegen (wenn noch nicht vorhanden)
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${PUBLIC_BASE_URL}/?success=1`,
      cancel_url: `${PUBLIC_BASE_URL}/?canceled=1`,
      // wichtig für webhook mapping
      metadata: { userId: user.id },
    });

    return res.json({ ok: true, url: session.url });
  } catch (e) {
    console.error("Checkout error:", e);
    return res.status(500).json({ ok: false, error: "Checkout error" });
  }
});

// ---------- Stripe: Billing Portal ----------
app.post("/billing/portal", requireLogin, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured" });

    const user = getUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Not logged in" });

    if (!user.stripeCustomerId) {
      return res.status(400).json({ ok: false, error: "Noch kein Stripe-Kunde (erst Abo starten)" });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${PUBLIC_BASE_URL}/`,
    });

    return res.json({ ok: true, url: portal.url });
  } catch (e) {
    console.error("Portal error:", e);
    return res.status(500).json({ ok: false, error: "Portal error" });
  }
});

// ---------- Stripe Webhook ----------
// ⚠️ Stripe braucht RAW body -> eigener express.raw middleware nur für diese Route
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe) return res.status(500).send("Stripe not configured");

      // Wenn du (noch) keinen Webhook Secret gesetzt hast, lassen wir es durchlaufen,
      // aber dann ist es unsicher. Empfehlung: STRIPE_WEBHOOK_SECRET setzen!
      let event = null;

      if (STRIPE_WEBHOOK_SECRET) {
        const sig = req.headers["stripe-signature"];
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
      } else {
        // Fallback (nur zum Testen, nicht für echte Prod)
        event = JSON.parse(req.body.toString("utf8"));
      }

      // Abo erfolgreich bezahlt -> User Pro
      if (event.type === "checkout.session.completed") {
        const sessionObj = event.data.object;
        const userId = sessionObj?.metadata?.userId;

        if (userId && usersById.has(userId)) {
          const u = usersById.get(userId);
          u.pro = true;
          console.log("✅ PRO aktiviert für:", u.email);
        } else {
          console.log("⚠️ userId nicht gefunden in webhook:", userId);
        }
      }

      // Falls Abo gekündigt/ausgelaufen: optional wieder pro=false setzen
      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object;
        const customerId = sub.customer;

        // user via customerId finden
        for (const u of usersById.values()) {
          if (u.stripeCustomerId === customerId) {
            u.pro = false;
            console.log("❌ PRO deaktiviert für:", u.email);
          }
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("Webhook error:", err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// ---------- Fallback to SPA ----------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
