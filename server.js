// server.js
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Startseite
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// API-Endpunkt
app.post("/erklaeren", (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Kein Text übergeben" });
  }

  const explanation =
    "📄 Einfache Erklärung (MVP):\n\n" +
    text.substring(0, 500) +
    (text.length > 500 ? " ..." : "");

  res.json({ explanation });
});

// Server starten
app.listen(PORT, () => {
  console.log("✅ Server läuft auf Port", PORT);
});
