const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

// ===== Basics =====
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Static Frontend
app.use(express.static(path.join(__dirname, "public")));

// ===== Health =====
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, status: "healthy" });
});

// Root -> index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== Config endpoint for frontend (no secrets) =====
app.get("/config", (req, res) => {
  const paymentsEnabled = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
  res.json({
    ok: true,
    paymentsEnabled
  });
});

// ===== MVP Explain endpoint =====
app.post("/erklaeren", (req, res) => {
  try {
    const text = (req.body && req.body.text ? String(req.body.text) : "").trim();

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: "Bitte zuerst einen Text eingeben."
      });
    }

    // Simple MVP explanation
    const cleaned = text.replace(/\s+/g, " ").trim();
    const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
    const short = cleaned.length > 600 ? cleaned.slice(0, 600) + " ..." : cleaned;

    const explanation =
      "Das ist eine einfache Erklärung:\n\n" +
      "• Worum geht es? " +
      (firstSentence.length > 160 ? firstSentence.slice(0, 160) + " ..." : firstSentence) +
      "\n" +
      "• Was sollst du tun? Prüfe: Frist? Antwort nötig? Unterlagen einreichen?\n" +
      "• Kurzfassung: " +
      short +
      "\n\n" +
      "Hinweis: Das ist aktuell ein MVP (noch ohne echte KI).";

    return res.status(200).json({
      ok: true,
      explanation
    });
  } catch (err) {
    console.error("Fehler /erklaeren:", err);
    return res.status(500).json({
      ok: false,
      error: "Unbekannter Fehler im Server."
    });
  }
});

// ===== Payments (Stripe Checkout) =====
// Will NOT crash if you haven't set keys yet.
// It returns a clean error instead.
app.post("/create-checkout-session", async (req, res) => {
  try {
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;

    if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
      return res.status(501).json({
        ok: false,
        error: "Bezahlung ist noch nicht konfiguriert (Stripe Keys fehlen)."
      });
    }

    const stripe = require("stripe")(STRIPE_SECRET_KEY);

    const origin =
      (req.headers["x-forwarded-proto"] ? req.headers["x-forwarded-proto"] + "://" : "https://") +
      req.headers.host;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/?paid=1`,
      cancel_url: `${origin}/?paid=0`,
      allow_promotion_codes: true
    });

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("Fehler /create-checkout-session:", err);
    return res.status(500).json({
      ok: false,
      error: "Checkout konnte nicht erstellt werden."
    });
  }
});

// Fallback 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found" });
});

app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
