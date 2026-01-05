import express from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ---------- Middleware ----------
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "briefe.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: "none",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

// ---------- Fake DB (MVP) ----------
const users = []; // { email, passwordHash }

// ---------- AUTH ----------
app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ ok: false, error: "Fehlende Daten" });

  if (users.find((u) => u.email === email))
    return res.status(400).json({ ok: false, error: "User existiert" });

  const passwordHash = await bcrypt.hash(password, 10);
  users.push({ email, passwordHash });

  res.json({ ok: true });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user)
    return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid)
    return res.status(401).json({ ok: false, error: "Login fehlgeschlagen" });

  req.session.user = { email };
  res.json({ ok: true });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("briefe.sid");
    res.json({ ok: true });
  });
});

app.get("/auth/me", (req, res) => {
  res.json({
    ok: true,
    loggedIn: !!req.session.user,
    user: req.session.user || null,
  });
});

// ---------- STRIPE ----------
app.post("/create-checkout-session", async (req, res) => {
  if (!req.session.user)
    return res.status(401).json({ ok: false, error: "Nicht eingeloggt" });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: "https://briefe-einfach-production.up.railway.app/",
    cancel_url: "https://briefe-einfach-production.up.railway.app/",
  });

  res.json({ url: session.url });
});

// ---------- Frontend ----------
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
