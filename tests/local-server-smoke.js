"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { createAppServer, HOST, LOCAL_ROM_FILENAME } = require("../local-server.js");

function request(port, pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: HOST, port, path: pathname, method }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function main() {
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });

  try {
    const port = server.address().port;
    const home = await request(port, "/");
    assert.equal(home.statusCode, 200, "a HOME não foi servida");
    assert.match(home.headers["content-type"] || "", /^text\/html/, "MIME da HOME incorreto");
    assert.match(home.body.toString("utf8"), /Advance Home/, "conteúdo da HOME incorreto");

    const rom = await request(port, `/${encodeURIComponent(LOCAL_ROM_FILENAME)}`, "HEAD");
    assert.equal(rom.statusCode, 200, "a ROM local não foi encontrada pelo servidor");
    assert.equal(rom.headers["content-type"], "application/octet-stream", "MIME da ROM incorreto");
    assert.ok(Number(rom.headers["content-length"]) > 0, "a ROM local está vazia");
    assert.equal(rom.body.length, 0, "HEAD não deve transferir o conteúdo da ROM");

    const jpgCover = await request(port, "/capas/firered.jpg", "HEAD");
    assert.equal(jpgCover.statusCode, 200, "capa JPG nao foi encontrada pelo servidor");
    assert.equal(jpgCover.headers["content-type"], "image/jpeg", "MIME da capa JPG incorreto");

    const pngCover = await request(port, "/capas/The_Legend_of_Zelda_The_Minish_Cap_capa.png", "HEAD");
    assert.equal(pngCover.statusCode, 200, "capa PNG nao foi encontrada pelo servidor");
    assert.equal(pngCover.headers["content-type"], "image/png", "MIME da capa PNG incorreto");

    const traversal = await request(port, "/..%2FREADME.md");
    assert.equal(traversal.statusCode, 403, "o servidor permitiu sair da pasta do projeto");
    console.log(`PASS: inicializador local serviu a HOME e encontrou a ROM (${rom.headers["content-length"]} bytes)`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
