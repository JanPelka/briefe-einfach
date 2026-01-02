const express = require("express");
const session = require("express-session");
const path = require("path");
const Stripe = require("stripe");

const app = express();

// ✅ Railway/Proxy: extrem wichtig, sonst werden Secure-Cookies nicht gesetzt
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Session
app.use(session({
  name: "sid",
  secret: process.env.SESSION_SECRET || "dev_secret_change_me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,          // Railway läuft über HTTPS
    sameSite: "lax",       // weil Frontend & Backend gleiche Domain
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

// ✅ Static Frontend
app.use(express.static(path.join(__dirname, "public")));

// ---- AUTH (Demo: sehr simpel) ----
// In echt: User DB + Hashing. Für MVP reicht erstmal:
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok:false, message:"Not logged in" });
  next();
}

app.post("/auth/register", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, message:"Email + Passwort erforderlich" });

  // MVP: wir “registrieren” direkt und loggen ein
  req.session.user = { email };
  return res.json({ ok:true, message:"Registriert & eingeloggt" });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, message:"Email + Passwort erforderlich" });

  // MVP: akzeptiert Login (später gegen DB prüfen)
  req.session.user = { email };
  return res.json({ ok:true, message:"Login ok" });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sid");
    res.json({ ok:true });
  });
});

app.get("/auth/me", (req, res) => {
  if (!req.session.user) return res.json({ ok:true, loggedIn:false });
  res.json({ ok:true, loggedIn:true, user: req.session.user });
});

// ---- STRIPE ----
app.post("/create-checkout-session", requireLogin, async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const priceId = process.env.STRIPE_PRICE_ID;

    if (!priceId) return res.status(500).json({ ok:false, message:"STRIPE_PRICE_ID fehlt" });

    const sessionStripe = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.protocol}://${req.get("host")}/?success=1`,
      cancel_url: `${req.protocol}://${req.get("host")}/?cancel=1`,
      customer_email: req.session.user.email
    });

    res.json({ url: sessionStripe.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Stripe Fehler", error: String(e.message || e) });
  }
});

// Health
app.get("/health", (req,res)=>res.json({ok:true,status:"healthy"}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
