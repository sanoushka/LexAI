require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const pdfParse = require("pdf-parse");

const app = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// serve frontend
app.use(express.static("frontend"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// ─────────────────────────────────────────────
// FILE UPLOAD CONFIG
// ─────────────────────────────────────────────

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".txt"];

    const ext = path
      .extname(file.originalname)
      .toLowerCase();

    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only PDF and TXT files are allowed"
        )
      );
    }
  }
});

// ─────────────────────────────────────────────
// MEMORY STORE
// ─────────────────────────────────────────────

let storedText = "";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

async function extractTextFromPDF(filePath) {
  const buffer = fs.readFileSync(filePath);

  const data = await pdfParse(buffer);

  return data.text.trim();
}

function extractTextFromTXT(filePath) {
  return fs
    .readFileSync(filePath, "utf-8")
    .trim();
}

// simple summary fallback
function generateSummary(text) {
  return text.substring(0, 1200);
}

// ─────────────────────────────────────────────
// HEALTH ROUTE
// ─────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date()
  });
});

// ─────────────────────────────────────────────
// UPLOAD ROUTE
// ─────────────────────────────────────────────

app.post(
  "/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded"
        });
      }

      console.log(
        "📄 Processing:",
        req.file.originalname
      );

      const ext = path
        .extname(req.file.originalname)
        .toLowerCase();

      let text = "";

      // extract text
      if (ext === ".pdf") {
        text = await extractTextFromPDF(
          req.file.path
        );
      } else {
        text = extractTextFromTXT(
          req.file.path
        );
      }

      if (!text || text.length < 20) {
        return res.status(400).json({
          error:
            "Could not extract text from file"
        });
      }

      console.log(
        "✅ Extracted",
        text.length,
        "chars"
      );

      storedText = text;

      // ─────────────────────────────
      // SEND TO PYTHON RAG SERVICE
      // ─────────────────────────────

      try {
        await fetch(
          "http://127.0.0.1:8000/embed",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              text
            })
          }
        );

        console.log(
          "🧠 Embeddings generated"
        );
      } catch (err) {
        console.log(
          "⚠️ AI service offline"
        );
      }

      // summary
      const summary = generateSummary(text);

      // delete uploaded file
      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        summary,
        text: text.slice(0, 5000)
      });
    } catch (err) {
      console.error(
        "❌ Upload Error:"
      );
      console.error(err);

      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ─────────────────────────────────────────────
// ASK ROUTE (RAG)
// ─────────────────────────────────────────────

app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({
        error: "No question provided"
      });
    }

    console.log(
      "❓ Question:",
      question
    );

    // ask python service
    const response = await fetch(
      "http://127.0.0.1:8000/ask",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          question
        })
      }
    );

    const data = await response.json();

    console.log(
      "💬 Answer generated"
    );

    res.json({
      answer:
        data.answer ||
        "No answer found"
    });
  } catch (err) {
    console.error(
      "❌ Ask Error:"
    );
    console.error(err);

    res.status(500).json({
      error:
        "Failed to answer question"
    });
  }
});

// ─────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(
    "💥 Unhandled Error:"
  );
  console.error(err);

  res.status(500).json({
    error: err.message
  });
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(
    `🚀 LexAI backend running → http://localhost:${PORT}`
  );

  console.log(
    `📁 Serving frontend`
  );

  console.log(
    `🔑 HF key: ${
      process.env.HF_API_KEY
        ? "✅ loaded"
        : "❌ missing"
    }`
  );
});