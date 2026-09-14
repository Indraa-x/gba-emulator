"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createAppServer, HOST } = require("../local-server.js");

const root = path.resolve(__dirname, "..");
const romFilename = "2006 FIFA World Cup - Germany 2006 (USA, Europe) (En,Fr,De,Es,It).gba";
const screenshotPath = path.join(__dirname, "fifa-browser.png");
const browserCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDevTools(profile, browser) {
  const activePort = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (browser.exitCode !== null) throw new Error(`o navegador encerrou com codigo ${browser.exitCode}`);
    if (fs.existsSync(activePort)) {
      const [port] = fs.readFileSync(activePort, "utf8").trim().split(/\r?\n/);
      if (port) return Number(port);
    }
    await delay(100);
  }
  throw new Error("o navegador nao abriu a porta de depuracao");
}

async function connectCDP(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const handler = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  return {
    call(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { socket.close(); }
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

async function main() {
  const browserPath = browserCandidates.find(fs.existsSync);
  assert.ok(browserPath, "Edge/Chrome nao encontrado");
  assert.ok(fs.existsSync(path.join(root, romFilename)), "ROM de FIFA 2006 ausente");

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "advance-fifa-"));
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const browser = spawn(browserPath, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: "ignore", windowsHide: true });
  const browserExited = new Promise((resolve) => browser.once("exit", resolve));
  let cdp;

  try {
    const debugPort = await waitForDevTools(profile, browser);
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about%3Ablank`, { method: "PUT" }).then((response) => response.json());
    cdp = await connectCDP(target.webSocketDebuggerUrl);
    await cdp.call("Runtime.enable");
    await cdp.call("Page.enable");
    await cdp.call("Page.navigate", { url: `http://${HOST}:${server.address().port}/` });

    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(cdp, "Boolean(window.gbaOne)")) break;
      if (attempt === 99) throw new Error("o emulador nao inicializou");
      await delay(100);
    }

    const romInfo = await evaluate(cdp, `(async () => {
      const emulator = window.gbaOne;
      const response = await fetch('/' + encodeURIComponent(${JSON.stringify(romFilename)}));
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const info = await emulator.loadROM(await response.arrayBuffer(), ${JSON.stringify(romFilename)}, false);
      const audio = emulator.core.audio;
      const originalPitchProcess = audio.audioProcessPitchPreserved;
      window.__fifaAudioProbe = { blocks: 0, invalid: 0, signal: 0, maxQueue: 0, lastQueue: 0 };
      audio.audioProcessPitchPreserved = function(left, right) {
        originalPitchProcess.call(this, left, right);
        const probe = window.__fifaAudioProbe;
        probe.blocks++;
        for (let index = 0; index < left.length; index++) {
          if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) probe.invalid++;
          if (Math.abs(left[index]) > .0001 || Math.abs(right[index]) > .0001) probe.signal++;
        }
        probe.lastQueue = Number(this.bufferedSamples) || 0;
        probe.maxQueue = Math.max(probe.maxQueue, probe.lastQueue);
      };
      emulator.start();
      return info;
    })()`);
    assert.equal(romInfo.code, "B6WE", "cabecalho inesperado para FIFA 2006");

    const screenPoint = await evaluate(cdp, `(() => {
      const rect = document.querySelector('#screen').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: screenPoint.x, y: screenPoint.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: screenPoint.x, y: screenPoint.y, button: "left", buttons: 0, clickCount: 1 });

    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(cdp, "Boolean(window.gbaOne.lastError)")) break;
      await delay(100);
    }

    const result = await evaluate(cdp, `(() => {
      const emulator = window.gbaOne;
      const pixels = document.querySelector('#screen').getContext('2d').getImageData(0, 0, 240, 160).data;
      const colors = new Set();
      for (let index = 0; index < pixels.length; index += 16) colors.add(pixels[index] + ',' + pixels[index + 1] + ',' + pixels[index + 2]);
      return {
        code: emulator.romInfo?.code,
        error: emulator.lastError?.message || '',
        paused: emulator.paused,
        fps: emulator.fps,
        colors: colors.size,
        framesPerTick: emulator.core.framesPerTick,
        cycles: emulator.core.cpu.cycles,
        audioContextState: emulator.core.audio.context?.state || 'unavailable',
        audioBufferSize: emulator.core.audio.bufferSize,
        audioPlaybackRate: emulator.core.audio.playbackRate,
        audioPreservePitch: emulator.core.audio.preservePitch,
        audioProbe: window.__fifaAudioProbe
      };
    })()`);
    const canvasPng = await evaluate(cdp, "document.querySelector('#screen').toDataURL('image/png').split(',')[1]");
    fs.writeFileSync(screenshotPath, Buffer.from(canvasPng, "base64"));
    console.log(`INFO: ${JSON.stringify({
        code: result.code,
        error: result.error,
        paused: result.paused,
        fps: result.fps,
        colors: result.colors,
        framesPerTick: result.framesPerTick,
        cycles: result.cycles,
        audioBlocks: result.audioProbe?.blocks,
        audioInvalid: result.audioProbe?.invalid,
        audioQueue: result.audioProbe?.lastQueue
    })}`);
    assert.equal(result.code, "B6WE");
    assert.equal(result.error, "", `FIFA 2006 falhou: ${result.error}`);
    assert.ok(result.colors >= 8, `FIFA 2006 nao renderizou imagem valida (${result.colors} cores)`);
    assert.equal(result.framesPerTick, 2, "a velocidade fixa de 2x nao esta ativa");
    assert.ok(result.cycles > 1000000, `FIFA 2006 nao avancou a CPU (${result.cycles} ciclos)`);
    assert.equal(result.audioContextState, "running", "Web Audio do FIFA permaneceu bloqueado");
    assert.equal(result.audioBufferSize, 1024, "FIFA ainda usa o buffer antigo de alta latencia");
    assert.equal(result.audioPlaybackRate === 2 && result.audioPreservePitch, true, "FIFA nao ativou a compressao temporal com tom natural");
    assert.ok(result.audioProbe?.blocks > 5, "processador de audio do FIFA nao recebeu blocos");
    assert.equal(result.audioProbe?.invalid, 0, "audio do FIFA produziu NaN ou infinito");
    assert.ok(result.audioProbe?.signal > 100, "audio do FIFA permaneceu em silencio");
    assert.ok(result.audioProbe?.maxQueue < 2500, `fila de audio do FIFA acumulou atraso (${result.audioProbe?.maxQueue} amostras)`);
    console.log(`PASS: FIFA 2006 iniciou sem instrucao ilegal e com audio valido; colors=${result.colors}; fps=${result.fps}; 2x ativo; screenshot=${path.relative(root, screenshotPath)}`);
  } finally {
    if (cdp) cdp.close();
    if (browser.exitCode === null) {
      browser.kill();
      await Promise.race([browserExited, delay(3000)]);
    }
    server.closeAllConnections?.();
    await Promise.race([new Promise((resolve) => server.close(resolve)), delay(1500)]);
    const resolvedProfile = path.resolve(profile);
    const tempRoot = path.resolve(os.tmpdir());
    if (resolvedProfile.startsWith(`${tempRoot}${path.sep}`)) {
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          fs.rmSync(resolvedProfile, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 9) console.warn(`WARN: perfil temporario nao removido: ${error.message}`);
          else await delay(200);
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
