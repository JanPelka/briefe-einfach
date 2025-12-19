import express from "express";
import Stripe from "stripe";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { email } = req.body;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          price: "price_1Sff5DLOOd2rJKRyunevq58U",
          quantity: 1,
        },
      ],
      success_url: "https://briefe-einfach-production.up.railway.app/success.html",
      cancel_url: "https://briefe-einfach-production.up.railway.app/cancel.html",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
