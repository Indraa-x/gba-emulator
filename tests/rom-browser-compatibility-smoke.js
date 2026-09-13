"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createAppServer, HOST } = require("../local-server.js");

const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDevTools(profile, browser) {
  const activePort = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (browser.exitCode !== null) throw new Error(`o navegador encerrou com código ${browser.exitCode}`);
    if (fs.existsSync(activePort)) {
      const [port] = fs.readFileSync(activePort, "utf8").trim().split(/\r?\n/);
      if (port) return Number(port);
    }
    await delay(100);
  }
  throw new Error("o navegador não abriu a porta de depuração");
}

async function connectCDP(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const exceptions = [];
  let nextId = 1;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails.text);
    }
  });
  socket.addEventListener("close", () => {
    for (const handler of pending.values()) handler.reject(new Error("o navegador encerrou durante o teste"));
    pending.clear();
  });
  return {
    exceptions,
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
  const browserPath = edgeCandidates.find(fs.existsSync);
  assert.ok(browserPath, "Edge/Chrome não encontrado");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "advance-rom-compat-"));
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
    console.log("INFO: navegador iniciado");
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about%3Ablank`, { method: "PUT" }).then((response) => response.json());
    cdp = await connectCDP(target.webSocketDebuggerUrl);
    await cdp.call("Runtime.enable");
    await cdp.call("Page.enable");
    await cdp.call("Page.navigate", { url: `http://${HOST}:${server.address().port}/` });
    console.log("INFO: página aberta");

    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(cdp, "Boolean(window.advanceLab)")) break;
      if (attempt === 99) throw new Error("o emulador não inicializou");
      await delay(100);
    }
    console.log("INFO: interface pronta");

    const result = await evaluate(cdp, `(async () => {
      const emulator = window.advanceLab;
      const branch = (from, to) => (0xea000000 | (((to - (from + 8)) >> 2) & 0x00ffffff)) >>> 0;
      const makeROM = (size, target, title) => {
        const bytes = new Uint8Array(size);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, branch(0x08000000, target), true);
        view.setUint32(target & (size - 1), 0xeafffffe, true);
        new TextEncoder().encodeInto(title, bytes.subarray(0xa0, 0xac));
        new TextEncoder().encodeInto('TST0', bytes.subarray(0xac, 0xb0));
        bytes[0xb2] = 0x96;
        new TextEncoder().encodeInto('SRAM_V', bytes.subarray(0xe4, 0xea));
        return bytes.buffer;
      };
      const run = async (size, target, title) => {
        await emulator.loadROM(makeROM(size, target, title), title + '.gba', false);
        emulator.pause();
        emulator.core.cpu.resetCPU(0x08000000);
        emulator.core.cpu.step();
        emulator.core.cpu.step();
        return {
          title: emulator.romInfo.title,
          pageRegion: emulator.core.cpu.pageRegion,
          opcode: emulator.core.mmu.load32(target) >>> 0,
          lowEqualsHigh: emulator.core.mmu.memory[0x08] === emulator.core.mmu.memory[0x09],
          error: emulator.lastError?.message || ''
        };
      };
      const sixteen = await run(16 * 1024 * 1024, 0x09000080, 'SIXTEEN MB');
      document.documentElement.dataset.compatProgress = '16';
      const toastCount = document.querySelectorAll('.toast').length;
      emulator.core.log(-1, '> frame de stack de teste');
      return {
        sixteen,
        stackDidNotCreateToast: document.querySelectorAll('.toast').length === toastCount,
        status: document.querySelector('#appStatus')?.textContent
      };
    })()`);
    console.log("INFO: cartucho de compatibilidade executado");

    assert.deepEqual([result.sixteen.pageRegion, result.sixteen.opcode, result.sixteen.lowEqualsHigh, result.sixteen.error], [0x09, 0xeafffffe, true, ""]);
    assert.equal(result.stackDidNotCreateToast, true, "a stack foi dividida em vários avisos");
    assert.equal(cdp.exceptions.length, 0, `exceções no navegador: ${cdp.exceptions.join("; ")}`);
    console.log("PASS: navegador executou o espelho de 16 MiB em 0x09000080 e não duplicou avisos");
  } finally {
    if (cdp) cdp.close();
    if (browser.exitCode === null) {
      browser.kill();
      await Promise.race([browserExited, delay(3000)]);
    }
    server.closeAllConnections?.();
    await Promise.race([new Promise((resolve) => server.close(resolve)), delay(1500)]);
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(profile);
    if (resolvedProfile.startsWith(`${tempRoot}${path.sep}`)) {
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          fs.rmSync(resolvedProfile, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 9) console.warn(`WARN: perfil temporário não removido: ${error.message}`);
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
