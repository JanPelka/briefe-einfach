import express from "express";
import session from "express-session";
import cors from "cors";
import Stripe from "stripe";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Railway läuft hinter Proxy/HTTPS
app.set("trust proxy", 1);

// CORS: erlaubt Cookies
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// Session (Cookie muss SameSite=None + Secure haben, sonst wird’s geblockt)
app.use(
  session({
    name: "be.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.get("/health", (req, res) => res.json({ ok: true, status: "healthy" }));

app.post("/auth/register", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: "missing email" });

  req.session.user = { email, createdAt: Date.now() };

  req.session.save((err) => {
    if (err) return res.status(500).json({ ok: false, error: "session save failed" });
    res.json({ ok: true });
  });
});

app.post("/auth/login", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: "missing email" });

  req.session.user = { email, loggedInAt: Date.now() };

  req.session.save((err) => {
    if (err) return res.status(500).json({ ok: false, error: "session save failed" });
    res.json({ ok: true });
  });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("be.sid", { sameSite: "none", secure: true });
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

app.post("/create-checkout-session", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });

  try {
    const sessionObj = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: "https://briefe-einfach-production.up.railway.app?success=1",
      cancel_url: "https://briefe-einfach-production.up.railway.app?canceled=1",
    });

    res.json({ url: sessionObj.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Stripe error" });
  }
});

app.listen(PORT, () => console.log("Server running on", PORT));
