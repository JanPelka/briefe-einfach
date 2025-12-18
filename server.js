/* server.js - briefe-einfach (Railway-ready + Stripe Subscription) */
const express = require("express");
const cors = require("cors");
const path = require("path");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

const stripe = STRIPE_SECRET_KEY ? require("stripe")(STRIPE_SECRET_KEY) : null;

const app = express();

// Stripe webhook (raw body) - optional, aber vorbereitet
app.post("/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  try {
    if (!stripe) return res.status(500).send("Stripe not configured");
    if (!STRIPE_WEBHOOK_SECRET) return res.status(200).send("No webhook secret set");

    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log("✅ checkout.session.completed:", session.id);
      // TODO später: session.customer + subscription speichern (Pro freischalten)
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      console.log("✅ invoice.paid:", invoice.id);
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      console.log("⚠️ subscription canceled:", sub.id);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// JSON für Rest
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: true, credentials: true }));

// Static Frontend
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Demo-Erklärung
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
    console.error("❌ /erklaeren error:", err);
    return res.status(500).json({ error: "Unbekannter Fehler im Server." });
  }
});

/**
 * Stripe Subscription Checkout
 * POST /create-checkout-session
 * erstellt eine Subscription via Price-ID (STRIPE_PRICE_ID)
 */
app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({
        error: "Stripe nicht konfiguriert. Setze STRIPE_SECRET_KEY in Railway."
      });
    }
    if (!STRIPE_PRICE_ID) {
      return res.status(500).json({
        error: "STRIPE_PRICE_ID fehlt. Lege in Stripe einen wiederkehrenden Preis an und setze STRIPE_PRICE_ID."
      });
    }

    // Base URL (Railway)
    const proto =
      (req.headers["x-forwarded-proto"] || "").toString().split(",")[0] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${baseUrl}/?paid=1`,
      cancel_url: `${baseUrl}/?paid=0`
      // optional später:
      // customer_email: req.body?.email
      // allow_promotion_codes: true
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe error:", err);
    return res.status(500).json({ error: "Stripe Fehler: " + err.message });
  }
});

app.use((req, res) => {
  res.status(404).send("Not Found");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server läuft auf Port ${PORT}`));
