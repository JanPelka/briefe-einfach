"use strict";

const path = require("path");
const express = require("express");

const app = express();

// Railway/Heroku-style: Port MUSS aus ENV kommen
const PORT = process.env.PORT || 8080;

// Body parsing
app.use(express.json({ limit: "1mb" }));

// Static files aus /public
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Healthcheck für Railway
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Root: index.html ausliefern
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ===============================
//  ERKLÄREN ENDPOINT
// ===============================
app.post("/erklaeren", async (req, res) => {
  try {
    const text = (req.body?.text || "").toString().trim();
    if (!text) {
      return res.status(400).json({ error: "Kein Text übergeben." });
    }

    // Wenn OPENAI_API_KEY gesetzt ist, nutzen wir OpenAI. Sonst MVP fallback.
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      // MVP-Fallback (läuft immer)
      const erklaerung =
        "Das ist eine einfache Erklärung:\n\n" +
        "- Der Brief/Text enthält wichtige Informationen.\n" +
        "- Prüfe, ob Fristen oder Aufgaben drin stehen.\n" +
        "- Wenn du unsicher bist: markiere die wichtigsten Stellen und frage nach.\n\n" +
        "Kurz gesagt: Bitte lies den Text genau und reagiere ggf. rechtzeitig.";

      return res.json({ erklaerung });
    }

    // OpenAI Call (Node 18+ hat fetch eingebaut)
    const prompt =
      "Erkläre den folgenden Behörden-/Brieftext in sehr einfachem Deutsch.\n" +
      "Regeln:\n" +
      "- Bulletpoints\n" +
      "- Was bedeutet das?\n" +
      "- Was muss ich jetzt tun?\n" +
      "- Welche Fristen/Termine?\n" +
      "- Welche Unterlagen?\n" +
      "- Max. 12 Zeilen\n\n" +
      "TEXT:\n" +
      text;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: "Du bist ein Assistent für leicht verständliche Behördenerklärungen." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return res.status(502).json({
        error: "OpenAI Fehler",
        details: errText.slice(0, 500)
      });
    }

    const data = await openaiRes.json();
    const erklaerung =
      data?.choices?.[0]?.message?.content?.trim() || "Keine Erklärung erhalten.";

    return res.json({ erklaerung });

  } catch (e) {
    return res.status(500).json({
      error: "Serverfehler",
      details: String(e?.message || e)
    });
  }
});

// Start
app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
