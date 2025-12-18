/* server.js - briefe-einfach (Login/User + Stripe Abo Checkout) */
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const session = require("express-session");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret_change_me";

const stripe = STRIPE_SECRET_KEY ? require("stripe")(STRIPE_SECRET_KEY) : null;

const app = express();

/* -------------------- Simple File DB -------------------- */
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}

function readUsers() {
  ensureDataFiles();
  const raw = fs.readFileSync(USERS_FILE, "utf-8");
  return JSON.parse(raw);
}

function writeUsers(db) {
  ensureDataFiles();
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2));
}

function sanitizeUser(u) {
  return { id: u.id, email: u.email, createdAt: u.createdAt, pro: !!u.pro };
}

function findUserByEmail(db, email) {
  return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

function uid() {
  return "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* -------------------- Middleware -------------------- */
app.set("trust proxy", 1); // wichtig auf Railway für cookies

app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(
  session({
    name: "be_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: true // Railway ist HTTPS -> muss true sein
    }
  })
);

// Static Frontend
app.use(express.static(path.join(__dirname, "public")));

/* -------------------- Health -------------------- */
app.get("/health", (req, res) => res.json({ ok: true }));

/* -------------------- Auth -------------------- */
app.post("/auth/register", async (req, res) => {
  try {
    const email = (req.body?.email || "").toString().trim();
    const password = (req.body?.password || "").toString();

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Bitte gültige E-Mail eingeben." });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen haben." });
    }

    const db = readUsers();
    if (findUserByEmail(db, email)) {
      return res.status(409).json({ error: "E-Mail ist schon registriert. Bitte einloggen." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: uid(),
      email,
      passwordHash,
      pro: false,
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    writeUsers(db);

    req.session.userId = user.id;

    return res.json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error("❌ /auth/register:", err);
    return res.status(500).json({ error: "Serverfehler beim Registrieren." });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = (req.body?.email || "").toString().trim();
    const password = (req.body?.password || "").toString();

    if (!email || !password) {
      return res.status(400).json({ error: "Bitte E-Mail und Passwort eingeben." });
    }

    const db = readUsers();
    const user = findUserByEmail(db, email);
    if (!user) return res.status(401).json({ error: "Login fehlgeschlagen." });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Login fehlgeschlagen." });

    req.session.userId = user.id;
    return res.json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error("❌ /auth/login:", err);
    return res.status(500).json({ error: "Serverfehler beim Login." });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("be_session");
    res.json({ ok: true });
  });
});

app.get("/auth/me", (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) return res.json({ user: null });

    const db = readUsers();
    const user = db.users.find((u) => u.id === userId);
    if (!user) return res.json({ user: null });

    return res.json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error("❌ /auth/me:", err);
    return res.status(500).json({ error: "Serverfehler." });
  }
});

/* -------------------- Demo-Erklärung -------------------- */
app.post("/erklaeren", async (req, res) => {
  try {
    const text = (req.body?.text || "").toString().trim();
    if (!text) return res.status(400).json({ error: "Bitte Text eingeben." });

    const kurzeSaetze = text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean)
      .slice(0, 6);

    const result =
      "Das ist eine einfache Erklärung:\n\n" +
      "- Der Brief ist ein offizielles Schreiben.\n" +
      "- Es geht darum, den Inhalt verständlich zu machen.\n" +
      "- Wichtig ist: Fristen prüfen und ggf. reagieren.\n\n" +
      "Kurz-Auszug aus deinem Text:\n" +
      kurzeSaetze.map((s) => `• ${s}`).join("\n");

    return res.json({ result });
  } catch (err) {
    console.error("❌ /erklaeren:", err);
    return res.status(500).json({ error: "Unbekannter Fehler im Server." });
  }
});

/* -------------------- Stripe Subscription Checkout -------------------- */
app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "Stripe nicht konfiguriert (STRIPE_SECRET_KEY fehlt)." });
    }
    if (!STRIPE_PRICE_ID) {
      return res.status(500).json({ error: "STRIPE_PRICE_ID fehlt (price_...)." });
    }

    // Login Pflicht (damit wir später freischalten können)
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ error: "Bitte zuerst einloggen." });

    const proto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const db = readUsers();
    const user = db.users.find((u) => u.id === userId);
    if (!user) return res.status(401).json({ error: "Session ungültig. Bitte neu einloggen." });

    const sessionStripe = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${baseUrl}/?paid=1`,
      cancel_url: `${baseUrl}/?paid=0`,
      customer_email: user.email,
      metadata: { userId: user.id }
    });

    return res.json({ url: sessionStripe.url });
  } catch (err) {
    console.error("❌ Stripe error:", err);
    return res.status(500).json({ error: "Stripe Fehler: " + err.message });
  }
});

/* -------------------- Stripe webhook (optional vorbereitet) -------------------- */
app.post("/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  try {
    if (!stripe) return res.status(500).send("Stripe not configured");
    if (!STRIPE_WEBHOOK_SECRET) return res.status(200).send("No webhook secret set");

    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    // Hier schalten wir später "pro" frei
    if (event.type === "checkout.session.completed") {
      const sessionObj = event.data.object;
      const userId = sessionObj?.metadata?.userId;

      if (userId) {
        const db = readUsers();
        const user = db.users.find((u) => u.id === userId);
        if (user) {
          user.pro = true; // Freischaltung
          writeUsers(db);
          console.log("✅ PRO freigeschaltet für:", user.email);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

/* -------------------- Root -------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res) => res.status(404).send("Not Found"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server läuft auf Port ${PORT}`));
