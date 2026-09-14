"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;
const ROOT = __dirname;
const LOCAL_ROM_FILENAME = "Pokemon - Emerald Version (USA, Europe).gba";

const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gba": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".sav": "application/octet-stream"
});

function sendText(response, statusCode, message) {
  const body = Buffer.from(message, "utf8");
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, `http://${HOST}`);
  const decoded = decodeURIComponent(url.pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (relative.includes("\0")) return null;
  const filename = path.resolve(ROOT, relative);
  if (filename !== ROOT && !filename.startsWith(`${ROOT}${path.sep}`)) return null;
  return filename;
}

function createAppServer() {
  return http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendText(response, 405, "Método não permitido.");
      return;
    }

    let filename;
    try {
      filename = resolveRequestPath(request.url || "/");
    } catch (_) {
      sendText(response, 400, "Endereço inválido.");
      return;
    }
    if (!filename) {
      sendText(response, 403, "Acesso negado.");
      return;
    }

    fs.stat(filename, (statError, stats) => {
      if (statError || !stats.isFile()) {
        sendText(response, 404, "Arquivo não encontrado.");
        return;
      }
      const headers = {
        "Content-Type": CONTENT_TYPES[path.extname(filename).toLowerCase()] || "application/octet-stream",
        "Content-Length": stats.size,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      };
      response.writeHead(200, headers);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const stream = fs.createReadStream(filename);
      stream.on("error", () => {
        if (!response.headersSent) sendText(response, 500, "Falha ao ler o arquivo.");
        else response.destroy();
      });
      stream.pipe(response);
    });
  });
}

if (require.main === module) {
  const legacyPortName = ["ADVANCE", "HOME", "PORT"].join("_");
  const port = Number.parseInt(process.env.GBAONE_PORT || process.env[legacyPortName] || "", 10) || DEFAULT_PORT;
  const server = createAppServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") process.exit(0);
    console.error(error.message);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    console.log(`GBAOne disponível em http://${HOST}:${port}/`);
    console.log("Mantenha esta janela aberta enquanto estiver jogando.");
  });
}

module.exports = { createAppServer, HOST, DEFAULT_PORT, LOCAL_ROM_FILENAME };
