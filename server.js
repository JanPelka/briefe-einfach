const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Body lesen
app.use(express.json());

// Absoluter Pfad (Railway-safe)
const PUBLIC_DIR = path.join(__dirname);

// Debug-Route (SEHR wichtig!)
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Startseite
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"), err => {
    if (err) {
      console.error("❌ index.html nicht gefunden:", err);
      res.status(500).send("index.html fehlt");
    }
  });
});

// API
app.post("/erklaeren", (req, res) => {
  const text = req.body?.text;

  if (!text) {
    return res.status(400).json({ error: "Kein Text übergeben" });
  }

  res.json({
    explanation: "📝 Einfache Erklärung (MVP):\n\n" + text.slice(0, 300)
  });
});

// WICHTIG: auf ALLEN Interfaces lauschen
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
