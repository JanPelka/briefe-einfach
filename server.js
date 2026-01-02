import express from "express";
import session from "express-session";
import cors from "cors";
import Stripe from "stripe";

const app = express();
const PORT = process.env.PORT || 3000;

/* =======================
   BASIC MIDDLEWARE
======================= */
app.use(express.json());

app.use(
  cors({
    origin: "https://briefe-einfach-production.up.railway.app",
    credentials: true,
  })
);

/* =======================
   SESSION (WICHTIG!)
======================= */
app.set("trust proxy", 1); // Railway / HTTPS

app.use(
  session({
    name: "briefe-session",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,          // HTTPS zwingend
      httpOnly: true,
      sameSite: "none",      // WICHTIG für Railway
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 Tage
    },
  })
);

/* =======================
   STRIPE
======================= */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* =======================
   HEALTH
======================= */
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

/* =======================
   AUTH
======================= */

// LOGIN (Demo)
app.post("/auth/login", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ ok: false });
  }

  req.session.user = {
    email,
    loggedInAt: Date.now(),
  };

  res.json({ ok: true });
});

// LOGOUT
app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("briefe-session");
    res.json({ ok: true });
  });
});

// CHECK LOGIN
app.get("/auth/me", (req, res) => {
  if (req.session.user) {
    return res.json({
      ok: true,
      loggedIn: true,
      user: req.session.user,
    });
  }

  res.json({ ok: true, loggedIn: false });
});

/* =======================
   STRIPE CHECKOUT
======================= */
app.post("/create-checkout-session", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url:
        "https://briefe-einfach-production.up.railway.app?success=1",
      cancel_url:
        "https://briefe-einfach-production.up.railway.app?canceled=1",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Stripe error" });
  }
});

/* =======================
   START
======================= */
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
