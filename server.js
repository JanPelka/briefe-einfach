// server.js
import express from "express";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// für __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());
app.use(express.static(__dirname)); // index.html ausliefern

// Startseite
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// API: Erklärung
app.post("/erklaeren", async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: "Kein Text übergeben" });
  }

  try {
    // MVP: noch ohne OpenAI (damit Railway sicher läuft)
    const einfacheErklaerung =
      "🧾 Einfache Erklärung (MVP):\n\n" +
      text
        .replace(/\n+/g, " ")
        .slice(0, 500) +
      " ...";

    res.json({ explanation: einfacheErklaerung });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
