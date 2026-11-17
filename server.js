// Runs Dempo Learn on your own computer: http://localhost:5600
// On Vercel this file is NOT used — Vercel serves public/ and runs api/index.js instead.

const http = require("http");
const fs = require("fs");
const path = require("path");

// Load secret settings from .env.local (this file is never committed).
try { process.loadEnvFile(path.join(__dirname, ".env.local")); } catch { console.warn("No .env.local found — copy .env.example to .env.local and fill it in."); }

const handler = require("./lib/handler");
const PORT = process.env.PORT || 5600;
const PUBLIC_DIR = path.join(__dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname.startsWith("/api/")) return handler(req, res);
    const file = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : path.normalize(pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" });
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, () => console.log(`Dempo Learn running at http://localhost:${PORT}`));
