import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------------
   Fix für __dirname in ES Modules
-------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------
   Middleware
-------------------------------- */
app.use(express.json());
app.use(express.static(__dirname));

/* ------------------------------
   Health Check (Railway wichtig)
-------------------------------- */
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/* ------------------------------
   Hauptseite
-------------------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* ------------------------------
   Platzhalter API (später OpenAI)
-------------------------------- */
app.post("/api/erklaeren", async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Kein Text übergeben" });
  }

  // Platzhalter – hier kommt später OpenAI rein
  res.json({
    original: text,
    erklaert: "Hier kommt später die KI-Erklärung rein 🙂"
  });
});

/* ------------------------------
   Server starten
-------------------------------- */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
