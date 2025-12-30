import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { nanoid } from "nanoid";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Connect to MongoDB
mongoose
  
  .connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/pastebin")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Paste Schema
const pasteSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  content: { type: String, required: true },
  expires_at: { type: Date, default: null },
  max_views: { type: Number, default: null },
  views: { type: Number, default: 0 },
});

const Paste = mongoose.model("Paste", pasteSchema);

// Health check - FIXED with proper DB ping
app.get("/api/healthz", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
});

// Create paste - FIXED with full validation + BASE_URL
app.post("/api/pastes", async (req, res) => {
  try {
    const { content, ttl_seconds, max_views } = req.body;

    // Validation - FIXED
    if (!content || content.trim() === "") {
      return res.status(400).json({ error: "Content is required and must be non-empty" });
    }

    if (ttl_seconds !== undefined && (!Number.isInteger(ttl_seconds) || ttl_seconds < 1)) {
      return res.status(400).json({ error: "ttl_seconds must be integer >= 1" });
    }

    if (max_views !== undefined && (!Number.isInteger(max_views) || max_views < 1)) {
      return res.status(400).json({ error: "max_views must be integer >= 1" });
    }

    const id = nanoid(8); // Shortened ID for cleaner URLs
    const expires = ttl_seconds ? Date.now() + ttl_seconds * 1000 : null;

    const paste = await Paste.create({
      id,
      content: content.trim(),
      max_views: max_views || null,
      expires_at: expires ? new Date(expires) : null,
    });

    // FIXED URL generation with BASE_URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:5001';
    res.status(201).json({ 
      id: paste.id, 
      url: `${baseUrl}/p/${paste.id}` 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get paste (JSON API)
app.get("/api/pastes/:id", async (req, res) => {
  try {
    const paste = await Paste.findOne({ id: req.params.id });
    if (!paste) return res.status(404).json({ error: "Paste not found" });

    const now =
      process.env.TEST_MODE === "1" && req.headers["x-test-now-ms"]
        ? Number(req.headers["x-test-now-ms"])
        : Date.now();

    // Check expiry
    if (paste.expires_at && now > paste.expires_at.getTime()) {
      await Paste.deleteOne({ id: req.params.id }); // Clean up expired
      return res.status(404).json({ error: "Paste expired" });
    }

    // Check view limit
    if (paste.max_views && paste.views >= paste.max_views) {
      return res.status(404).json({ error: "View limit exceeded" });
    }

    // Increment views
    paste.views += 1;
    await paste.save();

    res.status(200).json({
      content: paste.content,
      remaining_views: paste.max_views ? paste.max_views - paste.views : null,
      expires_at: paste.expires_at ? paste.expires_at.toISOString() : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get paste (HTML view)
app.get("/p/:id", async (req, res) => {
  try {
    const paste = await Paste.findOne({ id: req.params.id });
    if (!paste) return res.status(404).send("Paste not found");

    const now =
      process.env.TEST_MODE === "1" && req.headers["x-test-now-ms"]
        ? Number(req.headers["x-test-now-ms"])
        : Date.now();

    // Check expiry
    if (paste.expires_at && now > paste.expires_at.getTime()) {
      await Paste.deleteOne({ id: req.params.id });
      return res.status(404).send("Paste expired");
    }

    // Check view limit
    if (paste.max_views && paste.views >= paste.max_views) {
      return res.status(404).send("View limit exceeded");
    }

    // Increment views
    paste.views += 1;
    await paste.save();

    // Safe HTML rendering
    const safeContent = paste.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Paste #${paste.id}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 2rem;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container { 
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 2rem;
            max-width: 800px;
            width: 100%;
            box-shadow: 0 25px 50px rgba(0,0,0,0.15);
          }
          h1 { 
            color: #333;
            margin-bottom: 1rem;
            font-size: 1.5rem;
          }
          pre { 
            background: #1a1a1a;
            color: #f8f8f2;
            padding: 2rem;
            border-radius: 16px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 16px;
            line-height: 1.6;
            white-space: pre-wrap;
            overflow-x: auto;
            max-height: 70vh;
          }
          .info { 
            color: #666;
            font-size: 0.9rem;
            margin-top: 1rem;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Paste #${paste.id}</h1>
          <pre>${safeContent}</pre>
          <div class="info">
            ${paste.remaining_views !== null ? `Remaining views: ${paste.max_views - paste.views}` : ''}
            ${paste.expires_at ? `Expires: ${paste.expires_at.toLocaleString()}` : ''}
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
