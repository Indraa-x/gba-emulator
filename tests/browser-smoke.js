"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const screenshotPath = path.join(__dirname, "pokemon-browser.png");
const fullscreenScreenshotPath = path.join(__dirname, "pokemon-fullscreen-edges.png");
const realROMs = [
  { filename: "Pokemon - FireRed Version (USA).gba", code: "BPRE", speed: 2, titleScreenshot: "firered-title-browser.png", screenshot: "firered-menu-browser.png" },
  { filename: "Legend of Zelda, The - The Minish Cap (Europe) (En,Fr,De,Es,It).gba", code: "BZMP", speed: 1, titleScreenshot: "zelda-title-browser.png", screenshot: "zelda-menu-browser.png" },
  { filename: "Super Mario Advance 2 - Super Mario World (USA).gba", code: "AA2E", speed: 1, titleScreenshot: "mario-title-browser.png", screenshot: "mario-menu-browser.png" }
];
const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function mimeType(filename) {
  const extension = path.extname(filename).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".gba": "application/octet-stream",
    ".png": "image/png"
  })[extension] || "application/octet-stream";
}

function createServer() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filename = path.resolve(root, relative);
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    fs.stat(filename, (error, stats) => {
      if (error || !stats.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": mimeType(filename),
        "Content-Length": stats.size,
        "Cache-Control": "no-store"
      });
      fs.createReadStream(filename).pipe(response);
    });
  });
}

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
  throw new Error("o endpoint de depuração do navegador não iniciou");
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
    if (message.id) {
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails.text);
    }
  });
  return {
    exceptions,
    call(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "falha ao avaliar a página");
  return result.result.value;
}

async function trustedClick(cdp, selector) {
  const pointResult = await cdp.call("Runtime.evaluate", {
    expression: `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
    returnByValue: true
  });
  const point = pointResult.result.value;
  assert.ok(point, `elemento ausente para clique real: ${selector}`);
  await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
}

async function main() {
  const edge = edgeCandidates.find(fs.existsSync);
  assert.ok(edge, "Edge/Chrome não encontrado para o teste de navegador");
  assert.ok(fs.existsSync(path.join(root, "Pokemon - Emerald Version (USA, Europe).gba")), "ROM de teste ausente");

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gbaone-edge-"));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port: serverPort } = server.address();
  const browser = spawn(edge, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: "ignore", windowsHide: true });
  const browserExited = new Promise((resolve) => browser.once("exit", resolve));

  let cdp;
  try {
    const debugPort = await waitForDevTools(profile, browser);
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about%3Ablank`, { method: "PUT" }).then((response) => response.json());
    cdp = await connectCDP(target.webSocketDebuggerUrl);
    await cdp.call("Runtime.enable");
    await cdp.call("Page.enable");
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

    const romQuery = encodeURIComponent("Pokemon - Emerald Version (USA, Europe).gba");
    await cdp.call("Page.navigate", { url: `http://127.0.0.1:${serverPort}/?testRom=${romQuery}` });

    let status = "";
    let detail = "";
    for (let attempt = 0; attempt < 70; attempt++) {
      await delay(500);
      const result = await cdp.call("Runtime.evaluate", {
        expression: "JSON.stringify({status: document.documentElement.dataset.testStatus || '', detail: document.documentElement.dataset.testDetail || ''})",
        returnByValue: true
      });
      const value = JSON.parse(result.result.value || "{}");
      status = value.status;
      detail = value.detail;
      if (status === "pass" || status === "fail") break;
    }

    const screenPoint = await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        const rect = document.querySelector('#screen').getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
      returnByValue: true
    });
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: screenPoint.result.value.x, y: screenPoint.result.value.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: screenPoint.result.value.x, y: screenPoint.result.value.y, button: "left", buttons: 0, clickCount: 1 });
    await delay(150);
    const audioContextState = await cdp.call("Runtime.evaluate", {
      expression: "window.gbaOne.core.audio.context?.state || 'unavailable'",
      returnByValue: true
    });
    assert.equal(audioContextState.result.value, "running", "primeiro clique não desbloqueou o áudio no navegador");

    const featureResult = await cdp.call("Runtime.evaluate", {
      expression: `(async () => {
        const emulator = window.gbaOne;
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyX", bubbles: true }));
        const keyPressed = (emulator.core.keypad.currentDown & 1) === 0;
        document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyX", bubbles: true }));
        const keyReleased = (emulator.core.keypad.currentDown & 1) !== 0;
        await emulator.saveState(5);
        const stateSaved = (await emulator.listStates()).some((record) => record.slot === 5);
        await emulator.loadState(5);
        await emulator.deleteState(5);
        const stateDeleted = !(await emulator.listStates()).some((record) => record.slot === 5);
        const gameStored = Boolean(await emulator.database.get("games", emulator.romInfo.id));
        const audio = emulator.core.audio;
        let audioSignalSamples = 0;
        for (const channel of audio.buffers || []) {
          for (let index = 0; index < channel.length; index += 97) {
            if (Math.abs(channel[index]) > .0001) audioSignalSamples++;
          }
        }
        const audioReady = emulator.apu.enabled && audio.masterEnable && audio.enabled;
        const audioSynchronized = !audio.context || (
          Math.abs(audio.resampleRatio - (audio.sampleRate / audio.context.sampleRate)) < 1e-9
          && audio.playbackRate === 2
          && audio.preservePitch === true
          && audio.lowLatencyAudio === false
        );
        const saveView = new Uint8Array(emulator.core.mmu.save.buffer);
        saveView[17] = 0x5a;
        emulator.reset();
        const resetPreservedSave = new Uint8Array(emulator.core.mmu.save.buffer)[17] === 0x5a;
        emulator.setChannelMuted(0, true);
        const channelMute = emulator.core.audio.channelMuted[0] === true;
        emulator.setChannelMuted(0, false);
        const saveSize = emulator.exportSave().size;
        const screenshotSize = (await emulator.screenshot()).size;
        return { keyPressed, keyReleased, stateSaved, stateDeleted, gameStored, audioReady, audioSynchronized, audioSignalSamples, resetPreservedSave, channelMute, saveSize, screenshotSize };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const features = featureResult.result.value;

    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    assert.equal(cdp.exceptions.length, 0, `exceções JavaScript: ${cdp.exceptions.join("; ")}`);
    assert.equal(status, "pass", `teste da página falhou/expirou: ${status || "sem status"}; ${detail}`);
    assert.equal(features.keyPressed && features.keyReleased, true, "entrada de teclado não chegou ao núcleo");
    assert.equal(features.stateSaved && features.stateDeleted, true, "save state/IndexedDB falhou");
    assert.equal(features.gameStored, true, "ROM recente não foi persistida no IndexedDB");
    assert.equal(features.audioReady, true, "mixer de Pokémon Emerald permaneceu desativado");
    assert.equal(features.audioSynchronized, true, "áudio de Pokémon Emerald ficou fora de sincronia com 2×");
    assert.ok(features.audioSignalSamples > 0, "Pokémon Emerald não produziu amostras de áudio");
    assert.equal(features.resetPreservedSave, true, "reset apagou o save em memória");
    assert.equal(features.channelMute, true, "mute por canal não chegou ao mixer");
    assert.equal(features.saveSize, 0x20000, `save Flash esperado: 131072 bytes; recebido: ${features.saveSize}`);
    assert.ok(features.screenshotSize > 1000, "captura PNG do canvas ficou vazia");

    await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        window.__originalGetGamepadsDescriptor = Object.getOwnPropertyDescriptor(navigator, 'getGamepads') || null;
        const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
        window.__stateRestoreGamepad = {
          index: 0,
          id: 'State restore smoke gamepad',
          mapping: 'standard',
          connected: true,
          timestamp: performance.now(),
          buttons,
          axes: [0, 0, 0, 0]
        };
        Object.defineProperty(navigator, 'getGamepads', {
          configurable: true,
          value: () => [window.__stateRestoreGamepad]
        });
        return true;
      })()`,
      returnByValue: true
    });
    await delay(150);
    await cdp.call("Runtime.evaluate", {
      expression: "window.gbaOne.saveState(6)",
      awaitPromise: true,
      returnByValue: true
    });
    await trustedClick(cdp, "#quickMenuBtn");
    await delay(150);
    await trustedClick(cdp, '[data-quick="load"]');

    let restoredToGame = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await delay(100);
      const restoreResult = await cdp.call("Runtime.evaluate", {
        expression: "document.querySelector('#gameView').classList.contains('view--active') && !window.gbaOne.paused",
        returnByValue: true
      });
      restoredToGame = restoreResult.result.value;
      if (restoredToGame) break;
    }
    assert.equal(restoredToGame, true, "carregar estado pelo menu nao retornou ao jogo");

    const gamepadInputs = [
      { control: "A", button: 1, bit: 0 }, { control: "B", button: 0, bit: 1 },
      { control: "SELECT", button: 8, bit: 2 }, { control: "RIGHT", button: 15, bit: 4 },
      { control: "LEFT", button: 14, bit: 5 }, { control: "UP", button: 12, bit: 6 },
      { control: "DOWN", button: 13, bit: 7 }, { control: "R", button: 5, bit: 8 },
      { control: "L", button: 4, bit: 9 }
    ];
    assert.equal(await evaluate(cdp, "window.gbaOne.core.keypad.currentDown === 0x03ff"), true, "algum botão ficou preso depois de carregar o estado");
    for (const input of gamepadInputs) {
      await evaluate(cdp, `window.__stateRestoreGamepad.buttons[${input.button}].pressed = true; window.__stateRestoreGamepad.buttons[${input.button}].value = 1; true`);
      await delay(90);
      assert.equal(
        await evaluate(cdp, `(window.gbaOne.core.keypad.currentDown & (1 << ${input.bit})) === 0`),
        true,
        `${input.control}: controle não pressionou o botão dentro do jogo`
      );
      await evaluate(cdp, `window.__stateRestoreGamepad.buttons[${input.button}].pressed = false; window.__stateRestoreGamepad.buttons[${input.button}].value = 0; true`);
      await delay(90);
      assert.equal(
        await evaluate(cdp, `(window.gbaOne.core.keypad.currentDown & (1 << ${input.bit})) !== 0`),
        true,
        `${input.control}: controle não liberou o botão dentro do jogo`
      );
    }

    await evaluate(cdp, "window.__stateRestoreGamepad.buttons[9].pressed = true; window.__stateRestoreGamepad.buttons[9].value = 1; true");
    await delay(120);
    assert.equal(await evaluate(cdp, "document.querySelector('#quickMenu').classList.contains('view--active')"), true, "Start do controle não abriu o menu rápido");
    await evaluate(cdp, "window.__stateRestoreGamepad.buttons[9].pressed = false; window.__stateRestoreGamepad.buttons[9].value = 0; true");
    await delay(90);
    await evaluate(cdp, "window.__stateRestoreGamepad.buttons[0].pressed = true; window.__stateRestoreGamepad.buttons[0].value = 1; true");
    await delay(90);
    await evaluate(cdp, "window.__stateRestoreGamepad.buttons[0].pressed = false; window.__stateRestoreGamepad.buttons[0].value = 0; true");
    await delay(90);
    assert.equal(await evaluate(cdp, "document.querySelector('#gameView').classList.contains('view--active') && !window.gbaOne.paused"), true, "B do controle não retornou do menu ao jogo");
    await cdp.call("Runtime.evaluate", {
      expression: `(async () => {
        await window.gbaOne.deleteState(6);
        if (window.__originalGetGamepadsDescriptor) {
          Object.defineProperty(navigator, 'getGamepads', window.__originalGetGamepadsDescriptor);
        } else {
          delete navigator.getGamepads;
        }
        delete window.__stateRestoreGamepad;
        delete window.__originalGetGamepadsDescriptor;
        return true;
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    await delay(100);

    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await delay(150);
    await trustedClick(cdp, '[data-quick="fullscreen"]');
    for (let attempt = 0; attempt < 30; attempt++) {
      const fullscreenResult = await cdp.call("Runtime.evaluate", {
        expression: "Boolean(document.fullscreenElement)",
        returnByValue: true
      });
      if (fullscreenResult.result.value) break;
      if (attempt === 29) throw new Error("a ROM nao entrou em tela cheia");
      await delay(100);
    }
    await trustedClick(cdp, '[data-quick="resume"]');
    await delay(250);
    const fullscreenGameResult = await cdp.call("Runtime.evaluate", {
      expression: `(() => {
        const display = document.querySelector('#display');
        const displayStyle = getComputedStyle(display);
        const consoleRect = document.querySelector('#console').getBoundingClientRect();
        return {
          fullscreen: document.fullscreenElement?.id,
          focused: document.activeElement === display,
          viewport: { width: innerWidth, height: innerHeight },
          consoleRect: { left: consoleRect.left, top: consoleRect.top, right: consoleRect.right, bottom: consoleRect.bottom },
          border: [displayStyle.borderTopWidth, displayStyle.borderRightWidth, displayStyle.borderBottomWidth, displayStyle.borderLeftWidth],
          outlineStyle: displayStyle.outlineStyle,
          outlineWidth: displayStyle.outlineWidth,
          boxShadow: displayStyle.boxShadow
        };
      })()`,
      returnByValue: true
    });
    const fullscreenGame = fullscreenGameResult.result.value;
    assert.equal(fullscreenGame.fullscreen, "console", "a ROM abriu no elemento fullscreen incorreto");
    assert.equal(fullscreenGame.focused, true, "o display da ROM nao ficou focado ao retomar");
    assert.deepEqual(fullscreenGame.consoleRect, { left: 0, top: 0, right: fullscreenGame.viewport.width, bottom: fullscreenGame.viewport.height }, "a ROM nao cobriu toda a tela");
    assert.deepEqual(fullscreenGame.border, ["0px", "0px", "0px", "0px"], "o display da ROM manteve borda branca");
    assert.equal(fullscreenGame.outlineStyle === "none" || fullscreenGame.outlineWidth === "0px", true, "o display da ROM manteve contorno branco");
    assert.equal(fullscreenGame.boxShadow, "none", "o display da ROM manteve sombra nas bordas");
    const fullscreenScreenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    fs.writeFileSync(fullscreenScreenshotPath, Buffer.from(fullscreenScreenshot.data, "base64"));
    await cdp.call("Runtime.evaluate", { expression: "document.exitFullscreen()", awaitPromise: true, returnByValue: true });
    await delay(150);

    for (const game of realROMs) {
      assert.ok(fs.existsSync(path.join(root, game.filename)), `ROM de teste ausente: ${game.filename}`);
      const loadResult = await cdp.call("Runtime.evaluate", {
        expression: `(async () => {
          const filename = ${JSON.stringify(game.filename)};
          const response = await fetch('/' + encodeURIComponent(filename));
          if (!response.ok) throw new Error('HTTP ' + response.status + ' ao carregar ' + filename);
          await window.gbaOne.loadROM(await response.arrayBuffer(), filename, true);
          return { code: window.gbaOne.romInfo.code, id: window.gbaOne.romInfo.id };
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      assert.equal(loadResult.result.value.code, game.code, `cabeçalho incorreto ao abrir ${game.filename}`);
      game.id = loadResult.result.value.id;
      await delay(8000);
      const titleFrame = await cdp.call("Runtime.evaluate", {
        expression: `(() => {
          const canvas = document.querySelector('#screen');
          const pixels = canvas.getContext('2d').getImageData(0, 0, 240, 160).data;
          const colors = new Set();
          for (let index = 0; index < pixels.length; index += 16) colors.add(pixels[index] + ',' + pixels[index + 1] + ',' + pixels[index + 2]);
          return { colors: colors.size, png: canvas.toDataURL('image/png').split(',')[1] };
        })()`,
        returnByValue: true
      });
      fs.writeFileSync(path.join(__dirname, game.titleScreenshot), Buffer.from(titleFrame.result.value.png, "base64"));
      for (const control of ["START", "START", "A"]) {
        await cdp.call("Runtime.evaluate", {
          expression: `(async () => {
            window.gbaOne.pressKey('${control}');
            await new Promise((resolve) => setTimeout(resolve, 90));
            window.gbaOne.releaseKey('${control}');
            return true;
          })()`,
          awaitPromise: true,
          returnByValue: true
        });
        await delay(control === "A" ? 3000 : 1200);
      }
      const diagnostic = await cdp.call("Runtime.evaluate", {
        expression: `(() => {
          const emulator = window.gbaOne;
          const audio = emulator.core.audio;
          const pixels = document.querySelector('#screen').getContext('2d').getImageData(0, 0, 240, 160).data;
          const colors = new Set();
          for (let index = 0; index < pixels.length; index += 16) colors.add(pixels[index] + ',' + pixels[index + 1] + ',' + pixels[index + 2]);
          let signalSamples = 0;
          for (const channel of audio.buffers || []) {
            for (let index = 0; index < channel.length; index += 97) {
              if (Math.abs(channel[index]) > .0001) signalSamples++;
            }
          }
          return {
            code: emulator.romInfo?.code,
            error: emulator.lastError?.message || '',
            fps: emulator.fps,
            colors: colors.size,
            apuEnabled: emulator.apu.enabled,
            masterEnable: audio.masterEnable,
            audioRegisterEnabled: audio.enabled,
            signalSamples,
            resampleRatio: audio.resampleRatio,
            expectedRatio: audio.context ? audio.sampleRate / audio.context.sampleRate : 0,
            framesPerTick: emulator.core.framesPerTick,
            playbackRate: audio.playbackRate,
            preservePitch: audio.preservePitch,
            keepOriginalTempo: audio.keepOriginalTempo,
            lowLatencyAudio: audio.lowLatencyAudio,
            png: document.querySelector('#screen').toDataURL('image/png').split(',')[1]
          };
        })()`,
        returnByValue: true
      });
      const value = diagnostic.result.value;
      fs.writeFileSync(path.join(__dirname, game.screenshot), Buffer.from(value.png, "base64"));
      console.log(`INFO: ${game.code}; titleColors=${titleFrame.result.value.colors}; menuColors=${value.colors}; fps=${value.fps}; audioSamples=${value.signalSamples}`);
      assert.equal(value.code, game.code, `${game.code}: outra ROM substituiu o cartucho durante o teste`);
      assert.equal(value.error, "", `${game.code}: erro do núcleo: ${value.error}`);
      assert.ok(titleFrame.result.value.colors >= 8 && value.colors >= 4, `${game.code}: quadro sem variedade gráfica (título ${titleFrame.result.value.colors}; menu ${value.colors} cores)`);
      if (game.speed === 2) assert.ok(value.fps >= 100, `${game.code}: execução abaixo da velocidade fixa de 2× (${value.fps} FPS)`);
      else assert.ok(value.fps >= 45 && value.fps < 90, `${game.code}: velocidade normal de 1× fora da faixa (${value.fps} FPS)`);
      assert.equal(value.framesPerTick, game.speed, `${game.code}: multiplicador de quadros incorreto`);
      assert.equal(value.apuEnabled && value.masterEnable && value.audioRegisterEnabled, true, `${game.code}: áudio permaneceu desativado`);
      assert.ok(value.signalSamples > 0, `${game.code}: mixer não produziu amostras de áudio`);
      if (value.expectedRatio) assert.ok(Math.abs(value.resampleRatio - value.expectedRatio) < 1e-9, `${game.code}: taxa de áudio fora de sincronia`);
      assert.equal(value.playbackRate, game.speed, `${game.code}: áudio não acompanha a velocidade do jogo`);
      assert.equal(value.preservePitch, game.speed > 1, `${game.code}: preservação de tom incorreta`);
      assert.equal(value.keepOriginalTempo, game.speed > 1, `${game.code}: compressão temporal incorreta`);
      assert.equal(value.lowLatencyAudio, false, `${game.code}: cortador de fila antigo foi reativado`);
    }
    for (const game of realROMs) {
      const storedResult = await cdp.call("Runtime.evaluate", {
        expression: `(async () => {
          const emulator = window.gbaOne;
          await emulator.loadStoredROM(${JSON.stringify(game.id)});
          await new Promise((resolve) => setTimeout(resolve, 4500));
          const pixels = document.querySelector('#screen').getContext('2d').getImageData(0, 0, 240, 160).data;
          const colors = new Set();
          for (let index = 0; index < pixels.length; index += 16) colors.add(pixels[index] + ',' + pixels[index + 1] + ',' + pixels[index + 2]);
          return {
            code: emulator.romInfo?.code,
            colors: colors.size,
            error: emulator.lastError?.message || '',
            speed: emulator.core.framesPerTick,
            playbackRate: emulator.core.audio.playbackRate,
            audio: emulator.apu.enabled && emulator.core.audio.masterEnable && emulator.core.audio.enabled
          };
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      const stored = storedResult.result.value;
      assert.equal(stored.code, game.code, `${game.code}: a capa recente abriu a ROM errada`);
      assert.equal(stored.error, "", `${game.code}: falha ao reabrir pela capa: ${stored.error}`);
      assert.ok(stored.colors >= 4, `${game.code}: quadro ficou vazio ao reabrir pela capa (${stored.colors} cores)`);
      assert.equal(stored.speed, game.speed, `${game.code}: perdeu a velocidade fixa ao reabrir pela capa`);
      assert.equal(stored.playbackRate, game.speed, `${game.code}: áudio perdeu a velocidade correta ao reabrir pela capa`);
      assert.equal(stored.audio, true, `${game.code}: áudio foi perdido ao reabrir pela capa`);
    }
    assert.equal(cdp.exceptions.length, 0, `exceções JavaScript nas ROMs reais: ${cdp.exceptions.join("; ")}`);

    const compatibilityResult = await cdp.call("Runtime.evaluate", {
      expression: `(async () => {
        const emulator = window.gbaOne;
        const rom = new Uint8Array(16 * 1024 * 1024);
        const view = new DataView(rom.buffer);
        view.setUint32(0, 0xea40001e, true); // 0x08000000 -> 0x09000080
        view.setUint32(0x80, 0xeafffffe, true);
        new TextEncoder().encodeInto('MIRROR TEST', rom.subarray(0xa0, 0xac));
        new TextEncoder().encodeInto('TST0', rom.subarray(0xac, 0xb0));
        rom[0xb2] = 0x96;
        new TextEncoder().encodeInto('SRAM_V', rom.subarray(0xe4, 0xea));
        await emulator.loadROM(rom.buffer, 'mirror-test.gba', false);
        emulator.pause();
        emulator.core.cpu.resetCPU(0x08000000);
        emulator.core.cpu.step();
        emulator.core.cpu.step();
        const mirrored = emulator.core.cpu.pageRegion === 0x09 && emulator.core.mmu.memory[0x09] === emulator.core.mmu.memory[0x08];
        const toastCount = document.querySelectorAll('.toast').length;
        emulator.core.log(-1, '> stack frame de teste');
        const stackDidNotCreateToast = document.querySelectorAll('.toast').length === toastCount;
        return { mirrored, stackDidNotCreateToast, title: emulator.romInfo.title };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const compatibility = compatibilityResult.result.value;
    assert.equal(compatibility.mirrored, true, "o navegador não executou o espelho 0x09000080 do cartucho de 16 MiB");
    assert.equal(compatibility.stackDidNotCreateToast, true, "uma linha de stack ainda criou um toast separado");
    assert.equal(compatibility.title, "MIRROR TEST", "o segundo cartucho não substituiu o primeiro corretamente");
    assert.equal(cdp.exceptions.length, 0, `exceções JavaScript ao trocar de cartucho: ${cdp.exceptions.join("; ")}`);

    await cdp.call("Page.navigate", { url: pathToFileURL(path.join(root, "index.html")).href });
    await delay(2500);
    const fileResult = await cdp.call("Runtime.evaluate", {
      expression: "JSON.stringify({ ready: Boolean(window.gbaOne), status: document.getElementById('appStatus')?.textContent, canvas: document.getElementById('screen')?.width + 'x' + document.getElementById('screen')?.height })",
      returnByValue: true
    });
    const fileMode = JSON.parse(fileResult.result.value || "{}");
    assert.equal(fileMode.ready, true, "a página não inicializou via file://");
    assert.equal(fileMode.status, "PRONTO", "status inicial inesperado via file://");
    assert.equal(fileMode.canvas, "240x160", "canvas inválido via file://");
    assert.equal(cdp.exceptions.length, 0, `exceções JavaScript após file://: ${cdp.exceptions.join("; ")}`);
    console.log(`PASS: navegador real; ${detail}; troca de cartucho/espelho, teclado, estado, IndexedDB, save, PNG e file:// OK; screenshot=${path.relative(root, screenshotPath)}`);
  } finally {
    if (cdp) {
      try { await Promise.race([cdp.call("Browser.close"), delay(1500)]); } catch (_) {}
      cdp.close();
    }
    if (browser.exitCode === null) {
      await Promise.race([browserExited, delay(4000)]);
    }
    if (browser.exitCode === null) {
      browser.kill();
      await Promise.race([browserExited, delay(2000)]);
    }
    await new Promise((resolve) => server.close(resolve));
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) console.warn(`WARN: perfil temporário não pôde ser removido: ${error.message}`);
        else await delay(250);
      }
    }
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
