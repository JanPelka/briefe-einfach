import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import OpenAI from "openai";

dotenv.config();

/* ---------------- Paths / Static ---------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------------- CJS modules in ESM (robust) ---------------- */
const require = createRequire(import.meta.url);
const pdfParseMod = require("pdf-parse");
const pdfParse = pdfParseMod?.default ?? pdfParseMod;

const PDFKitMod = require("pdfkit");
const PDFDocument = PDFKitMod?.default ?? PDFKitMod;

/* ---- DOCX ---- */
const docx = require("docx");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
} = docx;

/* ---------------- Checks ---------------- */
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY fehlt. Lege eine .env im selben Ordner wie server.js an.");
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3000);

/* ---------------- App ---------------- */
const app = express();
app.use(cors());
app.use(express.json({ limit: "6mb" }));
app.use(express.static(__dirname));

/* ---------------- Upload (Memory) ---------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------- Helpers ---------------- */
function safe(v) {
  return String(v || "").trim();
}
function normalizeText(v) {
  return safe(v).replace(/\r\n/g, "\n");
}
function pdfSafeText(v) {
  const s = normalizeText(v);
  return s.replace(/[^\x09\x0A\x0D\x20-\x7EäöüÄÖÜß€§]/g, " ");
}
function splitAddressSmart(s) {
  const t = pdfSafeText(s);
  if (!t) return [];
  let parts = t.split("\n").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 8);
  parts = t.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 8);
  const m = t.match(/^(.*?)(\d{5}\s+.*)$/);
  if (m) return [m[1].trim(), m[2].trim()].filter(Boolean);
  return [t];
}
function stripPrefix(label, v) {
  let s = pdfSafeText(v);
  const low = s.toLowerCase();
  const lab = String(label).toLowerCase();
  if (low.startsWith(lab)) {
    s = s.slice(label.length).trim();
    s = s.replace(/^[:\-]\s*/i, "");
  }
  return s.trim();
}
function isAddressyLine(line) {
  const l = (line || "").toLowerCase().trim();
  if (!l) return false;
  if (/\b\d{5}\b/.test(l)) return true;
  if (/\bstr\.?\b/.test(l)) return true;
  if (l.includes("straße") || l.includes("weg") || l.includes("platz") || l.includes("allee") || l.includes("gasse")) return true;
  return false;
}
function isAnredeLine(line) {
  const l = (line || "").toLowerCase().trim();
  return (
    l.startsWith("sehr geehrte") ||
    l.startsWith("sehr geehrter") ||
    l.startsWith("hallo") ||
    l.startsWith("guten tag")
  );
}

/* ✅ entfernt doppelte Kopfzeilen aus dem Body */
function cleanBodyForLetter(meta, body) {
  let raw = pdfSafeText(body || "");
  if (!raw) return "";
  raw = raw.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();

  const senderName = pdfSafeText(meta.senderName || "");
  const senderAddr = pdfSafeText(meta.senderAddr || "");
  const recipient = pdfSafeText(meta.recipient || "");
  const place = pdfSafeText(meta.place || "");
  const dateStr = pdfSafeText(meta.dateStr || "");
  const dateLine = [place, dateStr].filter(Boolean).join(", ");

  const banExact = new Set(
    [senderName, senderAddr, recipient, dateStr, dateLine]
      .map((x) => (x || "").trim().toLowerCase())
      .filter(Boolean)
  );

  let lines = raw.split("\n").map((l) => l.trim());

  // Betreff/Aktenzeichen überall raus
  lines = lines.filter((l) => {
    const low = (l || "").toLowerCase().trim();
    if (!low) return true;
    if (low.startsWith("betreff:")) return false;
    if (low.startsWith("aktenzeichen:")) return false;
    return true;
  });

  // Grußformel + alles danach raus
  const joinedTmp = lines.join("\n");
  const idx = joinedTmp.toLowerCase().indexOf("mit freundlichen grüßen");
  if (idx >= 0) lines = joinedTmp.slice(0, idx).split("\n").map((l) => l.trim());

  // Anrede im Body raus
  lines = lines.filter((l) => !isAnredeLine(l));

  // Kopfblock am Anfang abschneiden
  const cleaned = [];
  let stillInHeaderJunk = true;
  let nonJunkSeen = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] || "";
    const low = l.toLowerCase().trim();

    if (!l) {
      if (!stillInHeaderJunk) cleaned.push("");
      continue;
    }

    if (stillInHeaderJunk) {
      if (banExact.has(low)) continue;
      if (recipient && low.includes(recipient.toLowerCase())) continue;
      if (dateStr && low.includes(dateStr.toLowerCase())) {
        if (!place || low.includes(place.toLowerCase())) continue;
      }
      if (isAddressyLine(l)) continue;
      if (senderName && low === senderName.toLowerCase()) continue;

      nonJunkSeen++;
      cleaned.push(l);
      if (nonJunkSeen >= 2) stillInHeaderJunk = false;
    } else {
      cleaned.push(l);
    }
  }

  let out = cleaned.join("\n");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/* ---------------- Meta normalize ---------------- */
function buildMeta(metaIn) {
  const senderName = pdfSafeText(metaIn?.senderName);
  const senderAddr = pdfSafeText(metaIn?.senderAddr);
  const recipient = pdfSafeText(metaIn?.recipient);
  const place = pdfSafeText(metaIn?.place);
  const dateStr = pdfSafeText(metaIn?.dateStr);

  let subject = pdfSafeText(metaIn?.subject);
  subject = stripPrefix("Betreff", subject);
  subject = stripPrefix("Betreff:", subject);

  let ref = pdfSafeText(metaIn?.ref);
  ref = stripPrefix("Aktenzeichen", ref);
  ref = stripPrefix("Aktenzeichen:", ref);

  return { senderName, senderAddr, recipient, place, dateStr, subject, ref };
}

/* ---------------- OpenAI prompts ---------------- */
function buildExplainPrompt(extra = "") {
  return [
    "Du bist ein Assistent für Behördenbriefe und offizielle Schreiben.",
    "Erkläre in sehr einfachem Deutsch, kurz und strukturiert.",
    "",
    "Struktur:",
    "1) Worum geht’s?",
    "2) Was wird von mir verlangt?",
    "3) Fristen / wichtige Daten",
    "4) Was passiert, wenn ich nichts mache?",
    "5) Was soll ich als Nächstes tun? (konkrete Schritte)",
    "",
    "Wenn etwas unklar ist: sag das ehrlich und stelle 2-4 gezielte Rückfragen.",
    extra ? ("\nExtra:\n" + extra) : "",
  ].join("\n");
}

async function explainFromText(text) {
  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: buildExplainPrompt() },
      { role: "user", content: [{ type: "input_text", text }] },
    ],
  });
  return resp.output_text || "";
}

async function explainFromImageBase64(base64, mime) {
  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: buildExplainPrompt("Das ist ein Foto/Screenshot. Lies den Inhalt und erkläre ihn.") },
      { role: "user", content: [{ type: "input_image", image_url: `data:${mime};base64,${base64}` }] },
    ],
  });
  return resp.output_text || "";
}

/* ---------------- API: Explain Text ---------------- */
app.post("/api/explain-text", async (req, res) => {
  try {
    const text = safe(req.body?.text);
    if (text.length < 15) return res.status(400).json({ ok: false, error: "Text zu kurz" });
    const out = await explainFromText(text);
    return res.json({ ok: true, text: out });
  } catch (e) {
    console.error("❌ /api/explain-text:", e);
    return res.status(500).json({ ok: false, error: "Serverfehler", details: String(e) });
  }
});

/* ---------------- API: Explain File ---------------- */
app.post("/api/explain-file", upload.single("file"), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ ok: false, error: "Keine Datei" });

    const mime = String(f.mimetype || "");
    const name = String(f.originalname || "").toLowerCase();

    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const parsed = await pdfParse(f.buffer);
      const text = safe(parsed?.text);
      if (!text) {
        return res.json({
          ok: true,
          text: "Ich konnte aus dem PDF keinen lesbaren Text extrahieren. Bitte lade ein klareres PDF oder kopiere den Text in die Text-Eingabe.",
        });
      }
      const out = await explainFromText(text);
      return res.json({ ok: true, text: out });
    }

    if (mime.startsWith("image/")) {
      const base64 = f.buffer.toString("base64");
      const out = await explainFromImageBase64(base64, mime);
      return res.json({ ok: true, text: out });
    }

    return res.status(400).json({ ok: false, error: "Dateityp nicht unterstützt", details: mime });
  } catch (e) {
    console.error("❌ /api/explain-file:", e);
    return res.status(500).json({ ok: false, error: "Serverfehler", details: String(e) });
  }
});

/* ---------------- PDF Layout ---------------- */
function drawFooter(doc) {
  const y = doc.page.height - doc.page.margins.bottom + 18;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font("Helvetica").fontSize(9).fillColor("#666");
  doc.text(`Seite ${doc.page.pageNumber}`, doc.page.margins.left, y, {
    width: w,
    align: "right",
    lineBreak: false,
  });
  doc.fillColor("#000");
}

function writeDinLetter(doc, meta, bodyText, withSignature) {
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;

  const fontBody = "Helvetica";
  const fontBold = "Helvetica-Bold";

  // Absender
  doc.font(fontBody).fontSize(10).fillColor("#000");
  const senderLines = [
    ...splitAddressSmart(meta.senderName),
    ...splitAddressSmart(meta.senderAddr),
  ].filter(Boolean);

  let y = top;
  senderLines.forEach((l) => {
    doc.text(l, left, y, { width: contentW, align: "left" });
    y += 12;
  });

  y += 26;

  // Empfänger links
  doc.font(fontBody).fontSize(11);
  const recLines = splitAddressSmart(meta.recipient || "Empfänger (bitte eintragen)");
  const recY = y;
  recLines.forEach((l) => {
    doc.text(l, left, y, { width: contentW * 0.62, align: "left" });
    y += 14;
  });

  // Ort/Datum rechts
  const dateLine = [meta.place, meta.dateStr].filter(Boolean).join(", ");
  if (dateLine) doc.text(dateLine, left, recY, { width: contentW, align: "right" });

  // Abstand bis Aktenzeichen/Betreff (Betreff runter)
  y = Math.max(y, recY + 70);
  y += 10;

  // Aktenzeichen
  if (meta.ref) {
    doc.font(fontBold).fontSize(11);
    doc.text(`Aktenzeichen: ${meta.ref}`, left, y, { width: contentW, align: "left" });
    y += 22;
  } else {
    y += 6;
  }

  // ✅ EXTRA ABSTAND (2 Leerzeilen) zwischen Aktenzeichen -> Betreff
  y += 22;

  // Betreff
  const subj = meta.subject ? meta.subject : "Antwort";
  doc.font(fontBold).fontSize(11);
  doc.text(`Betreff: ${subj}`, left, y, { width: contentW, align: "left" });
  y += 20;

  // ✅ EXTRA ABSTAND (2 Leerzeilen) zwischen Betreff -> Anrede
  y += 22;

  // Anrede
  doc.font(fontBody).fontSize(11);
  doc.text("Sehr geehrte Damen und Herren,", left, y, { width: contentW, align: "left" });
  y += 22;

  // Body bereinigt
  const cleaned = cleanBodyForLetter(meta, bodyText);
  doc.font(fontBody).fontSize(11);
  doc.text(cleaned, left, y, { width: contentW, align: "left", lineGap: 3 });

  // Gruß + Name
  if (withSignature) {
    doc.moveDown(1.2);
    doc.text("Mit freundlichen Grüßen");
    doc.moveDown(2.0);
    if (meta.senderName) doc.text(meta.senderName);
  }

  drawFooter(doc);
}

async function makePdfBuffer({ title, meta, bodyText, withSignature }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 56, bottom: 56, left: 56, right: 56 },
        info: { Title: title || "Export", Author: "Briefe einfach erklärt" },
      });

      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      writeDinLetter(doc, meta, pdfSafeText(bodyText), withSignature);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/* ---------------- DOCX (Word) ---------------- */
function para(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text: text || "", ...opts })],
  });
}

function paraBlank() {
  return new Paragraph({ text: "" });
}

function buildDocx(meta, bodyText, withSignature, title) {
  const dateLine = [meta.place, meta.dateStr].filter(Boolean).join(", ");
  const body = cleanBodyForLetter(meta, bodyText);

  const senderLines = [
    ...splitAddressSmart(meta.senderName),
    ...splitAddressSmart(meta.senderAddr),
  ].filter(Boolean);

  const recLines = splitAddressSmart(meta.recipient || "Empfänger (bitte eintragen)");
  const subj = meta.subject ? meta.subject : (title || "Antwort");

  const children = [];

  // Absenderblock
  senderLines.forEach((l) => children.push(para(l)));
  children.push(paraBlank(), paraBlank());

  // Empfängerblock
  recLines.forEach((l) => children.push(para(l)));
  children.push(paraBlank());

  // Datum rechts (Word: "rechts" per Alignment)
  if (dateLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun(dateLine)],
      })
    );
  }

  // Abstand wie PDF
  children.push(paraBlank(), paraBlank());

  // Aktenzeichen
  if (meta.ref) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Aktenzeichen: ${meta.ref}`, bold: true }),
        ],
      })
    );
  }

  // ✅ 2 Leerzeilen
  children.push(paraBlank(), paraBlank());

  // Betreff
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `Betreff: ${subj}`, bold: true }),
      ],
    })
  );

  // ✅ 2 Leerzeilen
  children.push(paraBlank(), paraBlank());

  // Anrede
  children.push(para("Sehr geehrte Damen und Herren,"));
  children.push(paraBlank());

  // Body (Absätze)
  body.split("\n").forEach((line) => {
    if (line.trim() === "") children.push(paraBlank());
    else children.push(para(line));
  });

  // Gruß
  if (withSignature) {
    children.push(paraBlank());
    children.push(para("Mit freundlichen Grüßen"));
    children.push(paraBlank(), paraBlank());
    if (meta.senderName) children.push(para(meta.senderName));
  }

  return new Document({
    sections: [{ properties: {}, children }],
  });
}

async function makeDocxBuffer({ title, meta, bodyText, withSignature }) {
  const doc = buildDocx(meta, bodyText, withSignature, title);
  return await Packer.toBuffer(doc);
}

/* ---------------- PDF Endpoints ---------------- */
app.post("/api/result-pdf", async (req, res) => {
  try {
    const text = safe(req.body?.text);
    if (!text) return res.status(400).json({ ok: false, error: "Kein Text" });

    const meta = buildMeta(req.body?.meta || {});
    const buf = await makePdfBuffer({
      title: "Erklärung",
      meta: { ...meta, subject: meta.subject || "Erklärung" },
      bodyText: text,
      withSignature: false,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="erklaerung.pdf"`);
    return res.send(buf);
  } catch (e) {
    console.error("❌ /api/result-pdf:", e);
    return res.status(500).json({ ok: false, error: "Serverfehler", details: String(e) });
  }
});

app.post("/api/reply-pdf", async (req, res) => {
  try {
    const text = safe(req.body?.text);
    if (!text) return res.status(400).json({ ok: false, error: "Kein Text" });

    const meta = buildMeta(req.body?.meta || {});
    const buf = await makePdfBuffer({
      title: "Antwort",
      meta: { ...meta, subject: meta.subject || "Antwort" },
      bodyText: text,
      withSignature: true,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="antwort.pdf"`);
    return res.send(buf);
  } catch (e) {
    console.error("❌ /api/reply-pdf:", e);
    return res.status(500).json({ ok: false, error: "Serverfehler", details: String(e) });
  }
});

/* ---------------- DOCX Endpoints ---------------- */
app.post("/api/result-docx", async (req, res) => {
  try {
    const text = safe(req.body?.text);
    if (!text) return res.status(400).json({ ok: false, error: "Kein Text" });

    const meta = buildMeta(req.body?.meta || {});
    const buf = await makeDocxBuffer({
      title: "Erklärung",
      meta: { ...meta, subject: meta.subject || "Erklärung" },
      bodyText: text,
      withSignature: false,
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="erklaerung.docx"`);
    return res.send(buf);
  } catch (e) {
    console.error("❌ /api/result-docx:", e);
    return res.status(500).json({ ok: false, error: "Serverfehler", details: String(e) });
  }
});

app.post("/api/reply-docx", async (req, res) => {
  try {
    const text = safe(req.body?.text);
    if (!text) return res.status(400).json({ ok: false, error: "Kein Text" });

    const meta = buildMeta(req.body?.meta || {});
    const buf = await makeDocxBuffer({
      title: "Antwort",
      meta: { ...meta, subject: meta.subject || "Antwort" },
      bodyText: text,
      withSignature: true,
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="antwort.docx"`);
    return res.send(buf);
  } catch (e) {
    console.error("❌ /api/reply-docx:", e);
    return res.status(500).json({ ok: false, error: "Serverfehler", details: String(e) });
  }
});

/* ---------------- Health ---------------- */
app.get("/api/health", (req, res) => res.json({ ok: true }));

/* ---------------- Start ---------------- */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf http://localhost:${PORT}`);
});
