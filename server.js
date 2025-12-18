/* server.js - briefe-einfach (Railway-ready) */
const express = require("express");
const cors = require("cors");
const path = require("path");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const stripe = STRIPE_SECRET_KEY ? require("stripe")(STRIPE_SECRET_KEY) : null;

const app = express();

// Für Stripe Webhooks braucht man RAW Body – wir definieren Webhook-Route VOR json()
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!stripe) return res.status(500).send("Stripe not configured");
      if (!webhookSecret) return res.status(200).send("No webhook secret set");

      const sig = req.headers["stripe-signature"];
      const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

      // Hier könntest du später “Pro freischalten” machen (DB etc.)
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        console.log("✅ Stripe checkout completed:", session.id);
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error("❌ Webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// Normaler JSON Parser für Rest
app.use(express.json({ limit: "1mb" }));

// CORS (bei gleicher Domain egal, aber hilft beim Debug)
app.use(
  cors({
    origin: true,
    credentials: true
  })
);

// Static Frontend
app.use(express.static(path.join(__dirname, "public")));

// Healthcheck (Railway)
app.get("/health", (req, res) => res.json({ ok: true }));

// Root (falls direkt auf /)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * API: /erklaeren
 * Erwartet: { text: "..." }
 * Gibt zurück: { result: "..." }
 */
app.post("/erklaeren", async (req, res) => {
  try {
    const text = (req.body?.text || "").toString().trim();
    if (!text) return res.status(400).json({ error: "Bitte Text eingeben." });

    // Minimal-Logik (Platzhalter). Später ersetzen wir das mit echter KI.
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
 * Stripe Checkout
 * POST /create-checkout-session
 * Body optional: { mode: "payment"|"subscription" }
 *
 * Aktuell: Einmalzahlung 5,00 € (ohne Price-ID, per price_data)
 */
app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({
        error:
          "Stripe ist nicht konfiguriert. Setze STRIPE_SECRET_KEY in Railway Variablen."
      });
    }

    // Domain automatisch aus Request bauen (Railway URL)
    const proto =
      (req.headers["x-forwarded-proto"] || "").toString().split(",")[0] ||
      "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Briefe-einfach Pro (Einmalzahlung)"
            },
            unit_amount: 500 // 5,00 €
          },
          quantity: 1
        }
      ],
      success_url: `${baseUrl}/?paid=1`,
      cancel_url: `${baseUrl}/?paid=0`
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe error:", err);
    return res.status(500).json({ error: "Stripe Fehler: " + err.message });
  }
});

// Fallback (wenn jemand auf nicht-existierende Seite geht)
app.use((req, res) => {
  res.status(404).send("Not Found");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
