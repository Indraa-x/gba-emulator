"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createAppServer, HOST } = require("../local-server.js");

const root = path.resolve(__dirname, "..");
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
  throw new Error("o endpoint de depuração do navegador não iniciou");
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

async function waitForHome(cdp) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await evaluate(cdp, `(() => {
      const image = document.querySelector('.software-card--pokemon img');
      return document.readyState === 'complete' && Boolean(image?.naturalWidth) && !document.querySelector('.boot-screen');
    })()`);
    if (ready) return;
    await delay(100);
  }
  throw new Error("a HOME não terminou de renderizar");
}

async function reloadAndWaitForHome(cdp) {
  const previousDocument = await evaluate(cdp, `window.__layoutDocumentId || ''`);
  await cdp.call("Page.reload");
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const state = await evaluate(cdp, `(() => ({
        id: window.__layoutDocumentId || '',
        ready: document.readyState === 'complete' && Boolean(document.querySelector('.software-card--pokemon img')?.naturalWidth) && !document.querySelector('.boot-screen')
      }))()`);
      if (state.id && state.id !== previousDocument && state.ready) return;
    } catch (_) {
      // A navegação pode trocar o contexto entre duas consultas do protocolo.
    }
    await delay(100);
  }
  throw new Error("a HOME recarregada não terminou de renderizar");
}

async function inspectHome(cdp) {
  return evaluate(cdp, `(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const card = document.querySelector('.software-card--pokemon');
    const strip = document.querySelector('.software-strip');
    const dock = document.querySelector('.system-dock');
    const footer = document.querySelector('.home-footer');
    const titleElement = document.querySelector('.selected-software-copy');
    const image = card.querySelector('img');
    const style = getComputedStyle(card);
    const dockRect = rect(dock);
    const dockButtons = [...dock.querySelectorAll('button')]
      .filter((button) => button.getClientRects().length && button.offsetWidth);
    const footerRects = [...footer.querySelectorAll('*')]
      .filter((element) => element.getClientRects().length && (element.offsetWidth || element.offsetHeight))
      .map(rect);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      dialogOpen: document.querySelector('#settingsDialog').open,
      profileCount: document.querySelectorAll('.profiles .profile-avatar').length,
      profileDockHasImage: Boolean(document.querySelector('#profileDockButton img')),
      card: rect(card),
      strip: rect(strip),
      dock: dockRect,
      selectedTitle: rect(titleElement),
      dockWidthRatio: dockRect.width / innerWidth,
      cardStartRatio: rect(card).left / innerWidth,
      dockIconColorCount: new Set(dockButtons.map((button) => getComputedStyle(button).getPropertyValue('--icon-color').trim()).filter(Boolean)).size,
      dockChildBounds: dockButtons.map((button) => ({ id: button.id || button.title, ...rect(button) })),
      dockCentered: Math.abs((dockRect.left + dockRect.right) / 2 - innerWidth / 2) <= 2,
      dockChildrenInside: dockButtons.every((button) => {
        const buttonRect = rect(button);
        return buttonRect.left >= dockRect.left - 1 && buttonRect.right <= dockRect.right + 1;
      }),
      footer: rect(footer),
      footerBounds: { left: Math.min(...footerRects.map((value) => value.left)), right: Math.max(...footerRects.map((value) => value.right)) },
      footerChildrenInside: footerRects.every((childRect) => childRect.left >= 1 && childRect.right <= innerWidth - 1),
      image: { source: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight },
      title: document.querySelector('#selectedGameTitle').textContent,
      libraryPosition: document.querySelector('#libraryPosition').textContent,
      outline: { width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) },
      selected: card.classList.contains('is-selected')
    };
  })()`);
}

function assertHomeLayout(layout, label) {
  assert.equal(layout.dialogOpen, false, `${label}: configurações abriram sozinhas`);
  assert.equal(layout.profileCount, 1, `${label}: existe mais de um avatar no canto superior esquerdo`);
  assert.equal(layout.profileDockHasImage, false, `${label}: a foto foi duplicada na barra inferior`);
  assert.equal(layout.selected, true, `${label}: a capa principal não iniciou selecionada`);
  assert.equal(layout.title, "Pokémon Emerald", `${label}: título selecionado incorreto`);
  assert.equal(layout.libraryPosition, "1 / 5", `${label}: indicador inicial do carrossel incorreto`);
  assert.equal(layout.image.source, "capas/PokemonEmeraldBox.jpg", `${label}: a nova capa do Emerald não foi usada`);
  assert.deepEqual([layout.image.width, layout.image.height], [316, 316], `${label}: dimensões da capa do Emerald inesperadas`);
  assert.ok(layout.documentSize.width <= layout.viewport.width, `${label}: página criou rolagem horizontal`);
  assert.ok(layout.documentSize.height <= layout.viewport.height, `${label}: página criou rolagem vertical`);
  const focusSpace = layout.outline.width + layout.outline.offset;
  assert.ok(Math.abs(layout.card.width - layout.card.height) <= 1, `${label}: capa deixou de ser quadrada`);
  assert.ok(layout.selectedTitle.top >= layout.dock.bottom, `${label}: nome do jogo não ficou abaixo da barra principal`);
  assert.ok(layout.card.left - layout.strip.left >= focusSpace, `${label}: foco foi cortado à esquerda`);
  assert.ok(layout.card.top - layout.strip.top >= focusSpace, `${label}: foco foi cortado no topo`);
  assert.equal(layout.dockChildrenInside, true, `${label}: botões vazaram para fora da barra inferior (${JSON.stringify(layout.dockChildBounds)})`);
  assert.equal(layout.dockCentered, true, `${label}: barra inferior ficou deslocada do centro (${layout.dock.left.toFixed(1)}–${layout.dock.right.toFixed(1)} em ${layout.viewport.width})`);
  if (layout.viewport.width > 760) {
    assert.ok(layout.dockWidthRatio >= .62 && layout.dockWidthRatio <= .7, `${label}: barra principal fora da proporção do Switch 2 (${layout.dockWidthRatio.toFixed(3)})`);
    assert.ok(layout.cardStartRatio >= .05 && layout.cardStartRatio <= .12, `${label}: capas fora da margem horizontal esperada (${layout.cardStartRatio.toFixed(3)})`);
    assert.ok(layout.dockIconColorCount >= 3 && layout.dockIconColorCount <= 4, `${label}: paleta do dock não está unificada (${layout.dockIconColorCount} cores)`);
  } else if (layout.viewport.height > layout.viewport.width) {
    const emptySpaceRatio = Math.max(0, layout.footer.top - layout.selectedTitle.bottom) / layout.viewport.height;
    assert.ok(emptySpaceRatio <= .15, `${label}: ainda existe espaço vazio excessivo sob o dock (${(emptySpaceRatio * 100).toFixed(1)}%)`);
  }
  assert.equal(layout.footerChildrenInside, true, `${label}: dicas inferiores foram cortadas (${layout.footerBounds.left.toFixed(1)}–${layout.footerBounds.right.toFixed(1)}; rodapé ${layout.footer.left.toFixed(1)}–${layout.footer.right.toFixed(1)})`);
}

async function testLongSelectedTitle(cdp) {
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1072, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, `(() => {
    const first = document.querySelector('.software-card--pokemon');
    first.focus({ preventScroll: true });
    for (let index = 0; index < 3; index++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
    }
    return true;
  })()`);
  await delay(450);
  const state = await evaluate(cdp, `(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    };
    const copy = document.querySelector('.selected-software-copy');
    const title = document.querySelector('#selectedGameTitle');
    const selected = document.querySelector('.software-card.is-selected');
    return {
      viewportWidth: innerWidth,
      scrollX,
      scrollY,
      copy: rect(copy),
      title: rect(title),
      text: title.textContent,
      position: document.querySelector('#libraryPosition').textContent,
      selectedCode: selected?.dataset.gameCode || ''
    };
  })()`);
  assert.equal(state.selectedCode, "AA2E", "navegação não alcançou a capa do Mario");
  assert.equal(state.text, "Super Mario Advance 2: Super Mario World", "título longo selecionado incorreto");
  assert.equal(state.position, "4 / 5", "indicador do carrossel não acompanhou a navegação");
  assert.equal(state.scrollX, 0, "navegar pelas capas deslocou a página horizontalmente");
  assert.equal(state.scrollY, 0, "navegar pelas capas deslocou a página verticalmente");
  assert.ok(state.copy.left >= 0 && state.copy.right <= state.viewportWidth, "contêiner do título longo saiu da tela");
  assert.ok(state.title.left >= state.copy.left && state.title.right <= state.copy.right + 1, "título longo vazou do contêiner");
  await capture(cdp, "home-mario-title-desktop.png");
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, `document.querySelector('.software-card--pokemon').focus({ preventScroll: true }); true`);
  await delay(100);
}

async function pressFakeGamepadButton(cdp, index) {
  await evaluate(cdp, `window.__gamepadSmoke.setButton(${index}, true); true`);
  await delay(110);
  await evaluate(cdp, `window.__gamepadSmoke.setButton(${index}, false); true`);
  await delay(110);
}

async function testGamepadRecovery(cdp) {
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 640, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, `(() => {
    window.__gamepadSmoke.connect();
    const first = document.querySelector('.software-card--pokemon');
    first.focus({ preventScroll: true });
    const strip = document.querySelector('.software-strip');
    Object.defineProperty(strip, 'scrollBy', { configurable: true, value: undefined });
    return true;
  })()`);
  await delay(180);
  assert.equal(await evaluate(cdp, `document.body.classList.contains('has-gamepad')`), true, "controle simulado não foi detectado");

  for (let step = 0; step < 4; step++) await pressFakeGamepadButton(cdp, 15);
  await evaluate(cdp, `delete document.querySelector('.software-strip').scrollBy; true`);
  const beforeRecovery = await evaluate(cdp, `document.activeElement?.id || document.activeElement?.dataset.gameCode || ''`);
  await pressFakeGamepadButton(cdp, 14);
  const afterRecovery = await evaluate(cdp, `document.activeElement?.id || document.activeElement?.dataset.gameCode || ''`);
  assert.equal(beforeRecovery, "dropZone", "direcional direito não alcançou Adicionar jogo");
  assert.equal(afterRecovery, "AA2E", "polling do controle parou após navegar pela lista");

  await evaluate(cdp, `document.querySelector('#profileAvatarButton').focus({ preventScroll: true }); true`);
  await pressFakeGamepadButton(cdp, 1);
  assert.equal(await evaluate(cdp, `document.querySelector('#profileDialog').open`), true, "botão A não abriu o perfil");
  await pressFakeGamepadButton(cdp, 0);
  assert.equal(await evaluate(cdp, `document.querySelector('#profileDialog').open`), false, "botão B não fechou o perfil");

  await evaluate(cdp, `window.__gamepadSmoke.disconnect(); document.querySelector('.software-card--pokemon').focus({ preventScroll: true }); true`);
  await delay(120);
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}

async function capture(cdp, filename) {
  const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(__dirname, filename), Buffer.from(screenshot.data, "base64"));
}

async function testCustomCovers(cdp) {
  const coverGames = [
    { code: "BPEE", src: "capas/PokemonEmeraldBox.jpg", size: [316, 316] },
    { code: "BPRE", src: "capas/firered.jpg", size: [735, 750] },
    { code: "BZMP", src: "capas/The_Legend_of_Zelda_The_Minish_Cap_capa.png", size: [454, 455] },
    { code: "AA2E", src: "capas/MV5BMDY1ZmVkMmQtOWY0Ni00NjZlLTg5NjktYjZhY2YzNTZmYjljXkEyXkFqcGc@._V1_.jpg", size: [1367, 1370] }
  ];
  for (let attempt = 0; attempt < 40; attempt++) {
    const ready = await evaluate(cdp, `${JSON.stringify(coverGames.map((game) => game.code))}.every((code) => document.querySelector('.software-card[data-game-code="' + code + '"] img')?.complete)`);
    if (ready) break;
    if (attempt === 39) throw new Error("as capas personalizadas nao terminaram de carregar");
    await delay(50);
  }
  const covers = await evaluate(cdp, `(() => ${JSON.stringify(coverGames)}.map((expected) => {
    const image = document.querySelector('.software-card[data-game-code="' + expected.code + '"] img');
    const card = image.closest('.software-card').getBoundingClientRect();
    return {
      code: expected.code,
      src: image.getAttribute('src'),
      natural: [image.naturalWidth, image.naturalHeight],
      objectFit: getComputedStyle(image).objectFit,
      cardRatio: card.width / card.height,
      custom: image.dataset.coverSource
    };
  }))()`);
  for (const expected of coverGames) {
    const actual = covers.find((cover) => cover.code === expected.code);
    assert.equal(actual.src, expected.src, `${expected.code}: arquivo de capa incorreto`);
    assert.deepEqual(actual.natural, expected.size, `${expected.code}: imagem nao carregou nas dimensoes originais`);
    assert.equal(actual.objectFit, "contain", `${expected.code}: proporcao da capa nao esta protegida`);
    assert.ok(Math.abs(actual.cardRatio - 1) < .01, `${expected.code}: cartao deixou de ser quadrado`);
    assert.equal(actual.custom, "custom", `${expected.code}: capa nao foi identificada como personalizada`);
  }
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector('.software-card[data-game-code="BPGE"]'))`), false, "LeafGreen ainda aparece na HOME");
  await capture(cdp, "home-covers-desktop.png");
}

async function testFallbackCover(cdp) {
  await evaluate(cdp, `(async () => {
    await window.advanceLab.database.put('games', {
      id: 'fallback-cover-smoke', code: 'TEST', title: 'Cartucho sem arte',
      filename: 'Cartucho sem arte.gba', loadedAt: Date.now(), thumbnail: null, rom: null
    });
    return true;
  })()`);
  await reloadAndWaitForHome(cdp);
  const fallback = await evaluate(cdp, `(() => {
    const card = document.querySelector('[data-game-id="fallback-cover-smoke"]');
    const cover = card?.querySelector('.game-cover--fallback');
    return {
      exists: Boolean(cover),
      hasCanvas: Boolean(card?.querySelector('canvas')),
      title: cover?.querySelector('span')?.textContent || '',
      icon: Boolean(cover?.querySelector('svg')),
      background: cover ? getComputedStyle(cover).backgroundImage : ''
    };
  })()`);
  assert.equal(fallback.exists && fallback.icon, true, "fallback de capa não foi renderizado");
  assert.equal(fallback.hasCanvas, false, "fallback ainda usa canvas");
  assert.equal(fallback.title, "Cartucho sem arte", "fallback não mostra o título do jogo");
  assert.match(fallback.background, /gradient/i, "fallback não acompanha os painéis da interface");
  await capture(cdp, "home-fallback-cover-desktop.png");
  await evaluate(cdp, `window.advanceLab.database.delete('games', 'fallback-cover-smoke')`);
  await reloadAndWaitForHome(cdp);
}

async function testLibraryEmptyState(cdp) {
  const state = await evaluate(cdp, `(() => {
    const content = document.querySelector('#softwareLibrary');
    const list = document.querySelector('#recentList');
    const add = document.querySelector('#dropZone');
    const hint = document.querySelector('#libraryEmptyHint');
    list.replaceChildren();
    content.classList.add('is-library-empty');
    hint.hidden = false;
    add.focus({ preventScroll: true });
    add.dispatchEvent(new FocusEvent('focus'));
    const stripRect = add.closest('.software-strip').getBoundingClientRect();
    const addRect = add.getBoundingClientRect();
    return {
      hint: hint.textContent.trim(),
      hintVisible: getComputedStyle(hint).display !== 'none',
      centered: Math.abs((addRect.left + addRect.right) / 2 - (stripRect.left + stripRect.right) / 2) <= 16,
      enlarged: addRect.width >= 208 && addRect.height >= 208,
      selectedTitle: document.querySelector('#selectedGameTitle').textContent,
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight
    };
  })()`);
  assert.equal(state.hint, "Arraste uma ROM .gba aqui ou clique para escolher um arquivo.", "texto do estado vazio incorreto");
  assert.equal(state.hintVisible && state.centered && state.enlarged, true, "estado vazio não centralizou e destacou Adicionar jogo");
  assert.equal(state.selectedTitle, "Adicionar jogo", "estado vazio não selecionou a ação principal");
  assert.equal(state.overflow, false, "estado vazio criou rolagem externa");
  await capture(cdp, "home-empty-library-desktop.png");
  await reloadAndWaitForHome(cdp);
}

  async function testLocalCoverLaunches(cdp) {
    await reloadAndWaitForHome(cdp);
    const expectedCovers = ["BPEE", "BPRE", "BZMP", "AA2E"];
    const expectedSpeeds = { BPEE: 2, BPRE: 2, BZMP: 1, AA2E: 1 };
    for (const expectedCode of ["BPEE", "BPRE", "BZMP", "AA2E"]) {
      const passes = expectedCode === "BPEE" ? 2 : 1;
      for (let pass = 0; pass < passes; pass++) {
      const coversReady = await evaluate(cdp, `${JSON.stringify(expectedCovers)}.every((code) => {
        const image = document.querySelector('.software-card[data-game-code="' + code + '"] img');
        return Boolean(image?.complete && image.naturalWidth && image.naturalHeight);
      })`);
        assert.equal(coversReady, true, "uma ou mais capas desapareceram da HOME");
        await evaluate(cdp, `document.querySelector('.software-card[data-game-code="${expectedCode}"]').click(); true`);
        let launchedState = null;
        for (let attempt = 0; attempt < 100; attempt++) {
          const state = await evaluate(cdp, `({
            code: window.advanceLab.romInfo?.code || '',
            error: window.advanceLab.lastError?.message || '',
            loading: document.querySelector('#loadingOverlay').classList.contains('is-active'),
            speed: window.advanceLab.core.framesPerTick,
            playbackRate: window.advanceLab.core.audio.playbackRate,
            preservePitch: window.advanceLab.core.audio.preservePitch
          })`);
          if (state.error) throw new Error(`a capa ${expectedCode} falhou ao abrir: ${state.error}`);
          if (state.code === expectedCode && !state.loading) {
            launchedState = state;
            break;
          }
          if (attempt === 99) throw new Error(`a capa ${expectedCode} nao abriu a ROM correspondente ou manteve o carregamento preso`);
          await delay(100);
        }
        assert.equal(launchedState.speed, expectedSpeeds[expectedCode], `${expectedCode}: velocidade incorreta ao abrir pela capa`);
        assert.equal(launchedState.playbackRate, expectedSpeeds[expectedCode], `${expectedCode}: áudio não acompanha a velocidade fixa`);
        assert.equal(launchedState.preservePitch, expectedSpeeds[expectedCode] > 1, `${expectedCode}: modo de áudio incorreto`);
        await evaluate(cdp, `window.advanceLab.pause(); true`);
      await reloadAndWaitForHome(cdp);
    }
  }
}

async function testHiddenFifa(cdp) {
  await evaluate(cdp, `(async () => {
    await window.advanceLab.database.put('games', {
      id: 'hidden-fifa-2006',
      code: 'B6WE',
      title: '2006 FIFA World Cup',
      filename: '2006 FIFA World Cup.gba',
      loadedAt: Date.now(),
      rom: new ArrayBuffer(192),
      thumbnail: null
    });
    return true;
  })()`);
  await reloadAndWaitForHome(cdp);
  const visible = await evaluate(cdp, `Boolean(document.querySelector('.recent-game[data-game-id="hidden-fifa-2006"]'))`);
  assert.equal(visible, false, "FIFA 2006 ainda aparece na HOME");
}

async function trustedClick(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(point, `elemento ausente para clique real: ${selector}`);
  await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
}

async function testFullscreenEdges(cdp) {
  await trustedClick(cdp, "#fullscreenBtn");
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate(cdp, "Boolean(document.fullscreenElement)")) break;
    if (attempt === 29) throw new Error("o elemento principal nao entrou em tela cheia");
    await delay(100);
  }
  const state = await evaluate(cdp, `(() => {
    const element = document.fullscreenElement;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      id: element.id,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
      boxShadow: style.boxShadow,
      background: style.backgroundColor
    };
  })()`);
  assert.equal(state.id, "console", "elemento incorreto entrou em tela cheia");
  assert.deepEqual(state.rect, { left: 0, top: 0, right: state.viewport.width, bottom: state.viewport.height }, "fullscreen nao cobriu toda a tela");
  assert.deepEqual(state.border, ["0px", "0px", "0px", "0px"], "fullscreen manteve uma borda");
  assert.deepEqual(state.margin, ["0px", "0px", "0px", "0px"], "fullscreen manteve margem externa");
  assert.equal(state.outlineStyle === "none" || state.outlineWidth === "0px", true, "fullscreen manteve contorno de foco");
  assert.equal(state.boxShadow, "none", "fullscreen manteve sombra nas bordas");
  assert.equal(state.background, "rgb(0, 0, 0)", "fundo do fullscreen nao e preto");

  await evaluate(cdp, `(() => {
    document.querySelector('#homeView').classList.remove('view--active');
    document.querySelector('#gameView').classList.add('view--active');
    document.querySelector('#display').focus();
    return true;
  })()`);
  await delay(100);
  const focusedDisplay = await evaluate(cdp, `(() => {
    const display = document.querySelector('#display');
    const style = getComputedStyle(display);
    const rect = display.getBoundingClientRect();
    return {
      focused: document.activeElement === display,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow
    };
  })()`);
  assert.equal(focusedDisplay.focused, true, "a tela do jogo nao recebeu foco durante o teste");
  assert.deepEqual(focusedDisplay.rect, { left: 0, top: 0, right: focusedDisplay.viewport.width, bottom: focusedDisplay.viewport.height }, "display focado nao cobriu o viewport");
  assert.deepEqual(focusedDisplay.border, ["0px", "0px", "0px", "0px"], "display focado manteve borda branca");
  assert.equal(focusedDisplay.outlineStyle === "none" || focusedDisplay.outlineWidth === "0px", true, "display focado manteve o contorno branco nativo");
  assert.equal(focusedDisplay.boxShadow, "none", "display focado manteve sombra nas bordas");
  await capture(cdp, "fullscreen-game-edges.png");
  await evaluate(cdp, `(() => {
    document.querySelector('#gameView').classList.remove('view--active');
    document.querySelector('#homeView').classList.add('view--active');
    return document.exitFullscreen();
  })()`);
  await delay(150);
  assert.equal(await evaluate(cdp, "document.fullscreenElement === null"), true, "nao foi possivel sair da tela cheia");
}

async function pulseGamepadButton(cdp, index) {
  await evaluate(cdp, `(() => {
    const button = window.__deleteTestGamepad.buttons[${index}];
    button.pressed = true;
    button.value = 1;
    return true;
  })()`);
  await delay(70);
  await evaluate(cdp, `(() => {
    const button = window.__deleteTestGamepad.buttons[${index}];
    button.pressed = false;
    button.value = 0;
    return true;
  })()`);
  await delay(70);
}

async function testDeleteMode(cdp) {
  const gameId = "delete-visual-test";
  const secondGameId = "delete-nav-second";
  const thirdGameId = "delete-nav-third";
  await evaluate(cdp, `(async () => {
    const now = Date.now();
    await window.advanceLab.database.put('games', {
      id: '${gameId}',
      code: 'TST1',
      title: 'Jogo para excluir',
      filename: 'Jogo para excluir.gba',
      loadedAt: now,
      rom: new ArrayBuffer(192),
      thumbnail: null
    });
    await window.advanceLab.database.put('saves', {
      id: '${gameId}',
      timestamp: Date.now(),
      type: 'SRAM',
      data: new ArrayBuffer(32)
    });
    await window.advanceLab.database.put('states', {
      id: '${gameId}:2',
      romId: '${gameId}',
      slot: 2,
      timestamp: Date.now(),
      state: {}
    });
    await window.advanceLab.database.put('games', {
      id: '${secondGameId}',
      code: 'TST2',
      title: 'Segundo jogo',
      filename: 'Segundo jogo.gba',
      loadedAt: now - 1000,
      rom: new ArrayBuffer(192),
      thumbnail: null
    });
    await window.advanceLab.database.put('games', {
      id: '${thirdGameId}',
      code: 'TST3',
      title: 'Terceiro jogo',
      filename: 'Terceiro jogo.gba',
      loadedAt: now - 2000,
      rom: new ArrayBuffer(192),
      thumbnail: null
    });
    return true;
  })()`);
  await reloadAndWaitForHome(cdp);

  for (let attempt = 0; attempt < 40; attempt++) {
    const libraryReady = await evaluate(cdp, `Boolean(document.querySelector('.recent-game[data-game-id="${gameId}"]'))`);
    if (libraryReady) break;
    if (attempt === 39) throw new Error("a biblioteca nao terminou de renderizar a ROM de teste");
    await delay(50);
  }

  const initial = await evaluate(cdp, `(() => ({
    hasCard: Boolean(document.querySelector('.recent-game[data-game-id="${gameId}"]')),
    trashVisible: !document.querySelector('#clearRecentBtn').hidden
  }))()`);
  assert.equal(initial.hasCard && initial.trashVisible, true, "ROM de teste nao apareceu com a lixeira");

  await evaluate(cdp, "document.querySelector('#clearRecentBtn').click(); true");
  await delay(250);
  const marked = await evaluate(cdp, `(() => {
    const card = document.querySelector('.recent-game[data-game-id="${gameId}"]');
    const pokemon = document.querySelector('.software-card--pokemon');
    const trash = document.querySelector('#clearRecentBtn');
    const temporary = document.createElement('span');
    temporary.style.color = getComputedStyle(document.documentElement).getPropertyValue('--danger');
    document.body.appendChild(temporary);
    const danger = getComputedStyle(temporary).color;
    temporary.remove();
    const cardStyle = getComputedStyle(card);
    return {
      deleteMode: document.querySelector('#homeView').classList.contains('is-delete-mode'),
      targetCount: document.querySelectorAll('.recent-game.is-delete-target').length,
      targetIsTestGame: card.classList.contains('is-delete-target'),
      pokemonIsTarget: pokemon.classList.contains('is-delete-target'),
      outlineColor: cardStyle.outlineColor,
      outlineWidth: parseFloat(cardStyle.outlineWidth),
      danger,
      marker: getComputedStyle(card, '::before').content,
      title: document.querySelector('#selectedGameTitle').textContent,
      meta: document.querySelector('#selectedGameMeta').textContent,
      ariaLabel: card.getAttribute('aria-label'),
      trashPressed: trash.getAttribute('aria-pressed'),
      trashIsRed: getComputedStyle(trash).backgroundImage.includes('255, 69, 88')
    };
  })()`);
  assert.equal(marked.deleteMode, true, "modo de exclusao nao foi ativado");
  assert.equal(marked.targetCount, 1, "mais de uma ROM foi marcada para exclusao");
  assert.equal(marked.targetIsTestGame, true, "ROM escolhida nao recebeu a marcacao de exclusao");
  assert.equal(marked.pokemonIsTarget, false, "ROM fixa foi marcada como removivel");
  assert.equal(marked.outlineColor, marked.danger, "ROM escolhida nao ficou vermelha");
  assert.ok(marked.outlineWidth > 0, "contorno vermelho da ROM nao ficou visivel");
  assert.match(marked.marker, /Excluir/, "selo vermelho Excluir nao apareceu na ROM");
  assert.equal(marked.title, "Jogo para excluir", "titulo da ROM marcada ficou incorreto");
  assert.equal(marked.meta, "Selecionado para excluir", "estado destrutivo nao foi explicado na interface");
  assert.equal(marked.ariaLabel, "Excluir Jogo para excluir", "rotulo acessivel nao informa a exclusao");
  assert.equal(marked.trashPressed, "true", "lixeira nao informou o estado ativo");
  assert.equal(marked.trashIsRed, true, "lixeira ativa ainda usa a cor principal da UI");

  await evaluate(cdp, `(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    window.__deleteTestGamepad = {
      index: 0,
      id: 'Controle generico de teste',
      mapping: 'standard',
      connected: true,
      timestamp: performance.now(),
      buttons,
      axes: [0, 0, 0, 0]
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [window.__deleteTestGamepad]
    });
    document.activeElement?.blur();
    return true;
  })()`);
  await delay(120);

  const deleteNavigation = [];
  for (const buttonIndex of [15, 15, 15, 14, 15]) {
    await pulseGamepadButton(cdp, buttonIndex);
    deleteNavigation.push(await evaluate(cdp, `document.querySelector('.recent-game.is-delete-target')?.dataset.gameId || ''`));
  }
  assert.deepEqual(deleteNavigation, [secondGameId, thirdGameId, gameId, thirdGameId, gameId], "D-pad do controle nao percorreu e retornou entre as ROMs removiveis");
  await capture(cdp, "delete-mode-desktop.png");

  await evaluate(cdp, "document.querySelector('#clearRecentBtn').focus(); true");
  await pulseGamepadButton(cdp, 1);
  await delay(100);
  const dialog = await evaluate(cdp, `(() => {
    const modal = document.querySelector('#deleteGameDialog');
    const confirm = document.querySelector('#deleteGameConfirmBtn');
    return {
      open: modal.open,
      name: document.querySelector('#deleteGameName').textContent,
      confirmIsRed: getComputedStyle(confirm).backgroundImage.includes('255, 69, 88'),
      cardStillRed: document.querySelector('.recent-game[data-game-id="${gameId}"]').classList.contains('is-delete-target')
    };
  })()`);
  assert.equal(dialog.open, true, "botao A nao abriu a confirmacao da ROM marcada quando o foco foi perdido");
  assert.equal(dialog.name, "Jogo para excluir", "confirmacao aponta para a ROM errada");
  assert.equal(dialog.confirmIsRed && dialog.cardStillRed, true, "confirmacao destrutiva perdeu a cor vermelha");
  await capture(cdp, "delete-confirm-desktop.png");

  await pulseGamepadButton(cdp, 0);
  const cancelled = await evaluate(cdp, `(() => ({
    dialogOpen: document.querySelector('#deleteGameDialog').open,
    deleteMode: document.querySelector('#homeView').classList.contains('is-delete-mode'),
    redTargets: document.querySelectorAll('.recent-game.is-delete-target').length,
    gameStillExists: Boolean(document.querySelector('.recent-game[data-game-id="${gameId}"]'))
  }))()`);
  assert.deepEqual(cancelled, { dialogOpen: false, deleteMode: false, redTargets: 0, gameStillExists: true }, "cancelar exclusao nao restaurou a HOME");

  await evaluate(cdp, "document.querySelector('#clearRecentBtn').click(); true");
  await delay(80);
  await pulseGamepadButton(cdp, 1);
  const controllerConfirmation = await evaluate(cdp, `(() => ({
    dialogOpen: document.querySelector('#deleteGameDialog').open,
    focusedId: document.activeElement?.id || ''
  }))()`);
  assert.deepEqual(controllerConfirmation, { dialogOpen: true, focusedId: "deleteGameConfirmBtn" }, "controle nao deixou Excluir ROM pronto para o botao A");
  await pulseGamepadButton(cdp, 1);
  for (let attempt = 0; attempt < 50; attempt++) {
    const deleted = await evaluate(cdp, `(async () => {
      const [stored, save, states] = await Promise.all([
        window.advanceLab.database.get('games', '${gameId}'),
        window.advanceLab.database.get('saves', '${gameId}'),
        window.advanceLab.database.getAll('states')
      ]);
      const orphanState = states.some((state) => state.romId === '${gameId}');
      return !stored && !save && !orphanState && !document.querySelector('.recent-game[data-game-id="${gameId}"]');
    })()`);
    if (deleted) break;
    if (attempt === 49) throw new Error("a ROM escolhida nao foi excluida");
    await delay(100);
  }
  const restored = await evaluate(cdp, `(() => ({
    dialogOpen: document.querySelector('#deleteGameDialog').open,
    deleteMode: document.querySelector('#homeView').classList.contains('is-delete-mode'),
    trashHidden: document.querySelector('#clearRecentBtn').hidden,
    pokemonExists: Boolean(document.querySelector('.software-card--pokemon')),
    otherGamesRemain: Boolean(document.querySelector('.recent-game[data-game-id="${secondGameId}"]')) && Boolean(document.querySelector('.recent-game[data-game-id="${thirdGameId}"]')),
    redTargets: document.querySelectorAll('.recent-game.is-delete-target').length
  }))()`);
  assert.deepEqual(restored, { dialogOpen: false, deleteMode: false, trashHidden: false, pokemonExists: true, otherGamesRemain: true, redTargets: 0 }, "HOME nao foi restaurada apos excluir somente a ROM escolhida");

  await evaluate(cdp, `(async () => {
    await window.advanceLab.database.deleteGame('${secondGameId}');
    await window.advanceLab.database.deleteGame('${thirdGameId}');
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });
    delete window.__deleteTestGamepad;
    return true;
  })()`);
  await reloadAndWaitForHome(cdp);
}

async function testAvatarPicker(cdp) {
  await evaluate(cdp, `document.querySelector('#profileAvatarButton').click(); true`);
  await delay(100);
  for (let attempt = 0; attempt < 50; attempt++) {
    const ready = await evaluate(cdp, `(() => {
      const images = [...document.querySelectorAll('.avatar-option img')];
      return images.length === 10 && images.every((image) => image.complete && image.naturalWidth === 384 && image.naturalHeight === 384);
    })()`);
    if (ready) break;
    if (attempt === 49) throw new Error("sprites do seletor de avatar não terminaram de carregar");
    await delay(100);
  }
  await evaluate(cdp, `(() => {
    const current = document.querySelector('.avatar-option.is-selected');
    current.focus();
    current.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return true;
  })()`);
  const keyboardTarget = await evaluate(cdp, `document.activeElement?.dataset.avatarId || ''`);
  assert.equal(keyboardTarget, "ember-lynx", "seta do teclado não navegou entre os avatares");
  await evaluate(cdp, `document.querySelector('[data-avatar-id="coral-mole"]').click(); true`);
  await delay(100);
  const state = await evaluate(cdp, `(() => {
    const dialog = document.querySelector('#profileDialog');
    const avatar = document.querySelector('#profileAvatarImage');
    const preview = document.querySelector('#profilePreviewImage');
    const source = avatar.getAttribute('src') || '';
    const stored = JSON.parse(localStorage.getItem('advance-lab:preferences') || '{}');
    const options = [...document.querySelectorAll('.avatar-option')];
    const selected = options.filter((option) => option.getAttribute('aria-checked') === 'true');
    const imageRects = options.map((option) => {
      const rect = option.querySelector('img').getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    return {
      open: dialog.open,
      optionCount: options.length,
      source,
      samePreview: source === preview.getAttribute('src'),
      storedAvatar: stored.profileAvatar,
      legacyImageExists: Object.hasOwn(stored, 'profileImage'),
      selectedCount: selected.length,
      selectedId: selected[0]?.dataset.avatarId || '',
      selectedName: document.querySelector('#profileAvatarName').textContent,
      squareImages: imageRects.every((rect) => Math.abs(rect.width - rect.height) < 1),
      noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth,
      avatarRadius: parseFloat(getComputedStyle(document.querySelector('#profileAvatarButton')).borderRadius),
      dialogRadius: parseFloat(getComputedStyle(dialog).borderRadius)
    };
  })()`);
  assert.equal(state.open && state.optionCount === 10, true, "seletor com 10 avatares não abriu");
  assert.equal(state.source, "assets/avatars/coral-mole.png?v=2", "avatar escolhido não apareceu no canto superior esquerdo");
  assert.equal(state.samePreview, true, "prévia e avatar principal ficaram diferentes");
  assert.equal(state.storedAvatar, "coral-mole", "avatar escolhido não foi persistido");
  assert.equal(state.legacyImageExists, false, "preferência antiga de upload ainda foi salva");
  assert.equal(state.selectedCount === 1 && state.selectedId === "coral-mole", true, "seleção única do avatar ficou inconsistente");
  assert.equal(state.selectedName, "Toupeira mecânica", "nome do avatar escolhido não foi atualizado");
  assert.equal(state.squareImages && state.noHorizontalOverflow, true, "grade de avatares deformou ou criou rolagem horizontal");
  assert.ok(state.avatarRadius >= 20 && state.dialogRadius >= 20, "perfil perdeu a estética arredondada");
  await capture(cdp, "profile-dialog-desktop.png");
  await evaluate(cdp, "document.querySelector('#profileDialog').close(); true");
  await delay(100);
  await capture(cdp, "home-profile-desktop.png");
  await reloadAndWaitForHome(cdp);
  const persisted = await evaluate(cdp, `(() => ({
    avatar: JSON.parse(localStorage.getItem('advance-lab:preferences') || '{}').profileAvatar,
    source: document.querySelector('#profileAvatarImage').getAttribute('src')
  }))()`);
  assert.deepEqual(persisted, { avatar: "coral-mole", source: "assets/avatars/coral-mole.png?v=2" }, "avatar não continuou selecionado após recarregar");
}

async function inspectSettings(cdp) {
  return evaluate(cdp, `(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const dialog = document.querySelector('#settingsDialog');
    const panelHost = document.querySelector('.settings-panels');
    const activePanel = document.querySelector('.settings-panel.is-active');
    const tabs = document.querySelector('.settings-tabs');
    const visibleControls = [...activePanel.querySelectorAll('button, input, select, a')]
      .filter((element) => element.getClientRects().length && (element.offsetWidth || element.offsetHeight));
    const dialogRect = rect(dialog);
    return {
      open: dialog.open,
      dialog: dialogRect,
      viewport: { width: innerWidth, height: innerHeight },
      panelFits: activePanel.scrollWidth <= panelHost.clientWidth + 1,
      controlsFit: visibleControls.every((element) => {
        const value = rect(element);
        return value.left >= dialogRect.left && value.right <= dialogRect.right;
      }),
      tabRadius: parseFloat(getComputedStyle(tabs).borderRadius),
      panelRadius: parseFloat(getComputedStyle(panelHost).borderRadius),
      panelShadow: getComputedStyle(panelHost).boxShadow,
      activeTabRadius: parseFloat(getComputedStyle(document.querySelector('.settings-tab.is-active')).borderRadius),
      activeTabBackground: getComputedStyle(document.querySelector('.settings-tab.is-active')).backgroundImage,
      inactiveTabBackground: getComputedStyle(document.querySelector('.settings-tab:not(.is-active)')).backgroundImage,
      activeTabColor: getComputedStyle(document.querySelector('.settings-tab.is-active')).color,
      inactiveTabColor: getComputedStyle(document.querySelector('.settings-tab:not(.is-active)')).color,
      activePanel: activePanel.id
    };
  })()`);
}

function assertSettingsLayout(settings, label, expectedPanel) {
  assert.equal(settings.open, true, `${label}: configurações não abriram`);
  assert.equal(settings.activePanel, expectedPanel, `${label}: aba incorreta`);
  assert.ok(settings.dialog.left >= 0 && settings.dialog.right <= settings.viewport.width, `${label}: configurações vazaram horizontalmente`);
  assert.ok(settings.dialog.top >= 0 && settings.dialog.bottom <= settings.viewport.height, `${label}: configurações vazaram verticalmente`);
  assert.equal(settings.panelFits, true, `${label}: painel criou rolagem horizontal`);
  assert.equal(settings.controlsFit, true, `${label}: controles foram cortados`);
  assert.ok(settings.tabRadius >= 20 && settings.activeTabRadius >= 20, `${label}: abas perderam o formato de cápsula`);
  assert.ok(settings.panelRadius >= 16, `${label}: painel perdeu os cantos arredondados`);
  assert.notEqual(settings.activeTabBackground, settings.inactiveTabBackground, `${label}: aba ativa não se diferencia das inativas`);
  assert.notEqual(settings.activeTabColor, settings.inactiveTabColor, `${label}: hierarquia de texto das abas desapareceu`);
  assert.notEqual(settings.panelShadow, "none", `${label}: área rolável perdeu o divisor visual`);
}

async function main() {
  const browserPath = edgeCandidates.find(fs.existsSync);
  assert.ok(browserPath, "Edge/Chrome não encontrado para o teste visual");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "advance-home-layout-"));
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const port = server.address().port;
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
    await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__layoutDocumentId = Date.now().toString(36) + Math.random().toString(36);
        const state = { connected: false };
        const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
        const gamepad = { index: 0, id: 'Generic Bluetooth regression pad', mapping: 'standard', connected: false, timestamp: 0, buttons, axes: [0, 0, 0, 0] };
        const dispatch = (type) => {
          const event = new Event(type);
          Object.defineProperty(event, 'gamepad', { value: gamepad });
          window.dispatchEvent(event);
        };
        window.__gamepadSmoke = {
          gamepad,
          connect() { state.connected = true; gamepad.connected = true; dispatch('gamepadconnected'); },
          disconnect() { state.connected = false; gamepad.connected = false; dispatch('gamepaddisconnected'); },
          setButton(index, pressed) {
            buttons[index].pressed = Boolean(pressed);
            buttons[index].value = pressed ? 1 : 0;
            gamepad.timestamp = performance.now();
          }
        };
        Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => state.connected ? [gamepad] : [] });
      })();`
    });

    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.call("Page.navigate", { url: `http://${HOST}:${port}/` });
    await waitForHome(cdp);
    const desktop = await inspectHome(cdp);
    assertHomeLayout(desktop, "desktop");
    await capture(cdp, "home-layout-desktop.png");
    await testLongSelectedTitle(cdp);
    await testGamepadRecovery(cdp);
    await testCustomCovers(cdp);
    await testFallbackCover(cdp);
    await testLibraryEmptyState(cdp);
    await testAvatarPicker(cdp);
    await testFullscreenEdges(cdp);

    await evaluate(cdp, `(() => {
      document.querySelector('#toastRegion').replaceChildren();
      document.querySelector('#homeView').classList.remove('view--active');
      document.querySelector('#quickMenu').classList.add('view--active');
      document.querySelector('.quick-panel').scrollTop = 0;
      return true;
    })()`);
    await delay(100);
    const desktopQuick = await evaluate(cdp, `(() => {
      const panel = document.querySelector('.quick-panel').getBoundingClientRect();
      return {
        inside: panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight,
        settingsVisible: Boolean(document.querySelector('.quick-game-settings')),
        controls: document.querySelectorAll('.quick-game-settings input, .quick-game-settings select').length
      };
    })()`);
    assert.deepEqual(desktopQuick, { inside: true, settingsVisible: true, controls: 3 }, "ajustes do jogo nao couberam no menu desktop");
    await capture(cdp, "quick-menu-desktop.png");
    await evaluate(cdp, `(() => {
      document.querySelector('#quickMenu').classList.remove('view--active');
      document.querySelector('#homeView').classList.add('view--active');
      return true;
    })()`);

    await evaluate(cdp, "document.querySelector('#settingsBtn').click(); true");
    await delay(150);
    for (const [tab, panel] of [["tabControls", "panelControls"], ["tabVideo", "panelVideo"], ["tabAudio", "panelAudio"], ["tabSaves", "panelSaves"]]) {
      await evaluate(cdp, `document.querySelector('#${tab}').click(); true`);
      await delay(50);
      assertSettingsLayout(await inspectSettings(cdp), `desktop/${tab}`, panel);
    }
    await evaluate(cdp, "document.querySelector('#tabControls').click(); document.querySelector('.settings-tabs').scrollLeft = 0; document.querySelector('.settings-panels').scrollTop = 0; true");
    await delay(250);
    await capture(cdp, "settings-layout-desktop.png");
    await evaluate(cdp, "document.querySelector('#settingsDialog').close(); true");

    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 620, deviceScaleFactor: 1, mobile: false });
    await delay(250);
    const landscape = await inspectHome(cdp);
    assertHomeLayout(landscape, "desktop 16:9");
    await capture(cdp, "home-layout-landscape.png");

    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(250);
    const mobile = await inspectHome(cdp);
    assertHomeLayout(mobile, "celular");
    await capture(cdp, "home-layout-mobile.png");

    await evaluate(cdp, "document.querySelector('[data-open-settings=\"saves\"]').click(); true");
    await delay(150);
    for (const [tab, panel] of [["tabControls", "panelControls"], ["tabVideo", "panelVideo"], ["tabAudio", "panelAudio"], ["tabSaves", "panelSaves"]]) {
      await evaluate(cdp, `document.querySelector('#${tab}').click(); true`);
      await delay(50);
      assertSettingsLayout(await inspectSettings(cdp), `celular/${tab}`, panel);
    }
    await evaluate(cdp, "document.querySelector('#tabSaves').click(); true");
    await delay(250);
    await capture(cdp, "settings-layout-mobile.png");

    await evaluate(cdp, `document.querySelector('#settingsDialog').close(); document.querySelector('#toastRegion').replaceChildren(); document.querySelector('#homeView').classList.remove('view--active'); document.querySelector('#quickMenu').classList.add('view--active'); document.querySelector('.quick-panel').scrollTop = 0; true`);
    await delay(100);
    const quick = await evaluate(cdp, `(() => {
      const panelElement = document.querySelector('.quick-panel');
      const panel = panelElement.getBoundingClientRect();
      const controls = [...document.querySelectorAll('.quick-grid button, .quick-game-settings input, .quick-game-settings select')];
      return {
        left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom,
        width: innerWidth, height: innerHeight,
        radius: parseFloat(getComputedStyle(panelElement).borderRadius),
        overflowY: getComputedStyle(panelElement).overflowY,
        settingCount: document.querySelectorAll('.quick-game-settings input, .quick-game-settings select').length,
        controlsFitHorizontally: controls.every((control) => {
          const value = control.getBoundingClientRect();
          return value.left >= panel.left && value.right <= panel.right;
        })
      };
    })()`);
    assert.ok(quick.left >= 0 && quick.right <= quick.width && quick.top >= 0 && quick.bottom <= quick.height, "menu rápido vazou da tela");
    assert.ok(quick.radius >= 20, "menu rápido perdeu os cantos arredondados");
    assert.equal(quick.overflowY, "auto", "menu rápido ampliado nao permite rolagem interna");
    assert.equal(quick.settingCount, 3, "ajustes de jogo incompletos no menu rápido");
    assert.equal(quick.controlsFitHorizontally, true, "controles do menu rápido foram cortados");

    await evaluate(cdp, `(() => {
      const update = (selector, value, events) => {
        const input = document.querySelector(selector);
        if (input.type === 'checkbox') input.checked = value;
        else input.value = value;
        for (const type of events) input.dispatchEvent(new Event(type, { bubbles: true }));
      };
      update('#quickVolumeRange', '43', ['input', 'change']);
      update('#quickFilterSelect', 'lcd', ['change']);
      update('#quickUiSoundToggle', false, ['change']);
      return true;
    })()`);
    const quickPreferences = await evaluate(cdp, `(() => {
      const stored = JSON.parse(localStorage.getItem('advance-lab:preferences') || '{}');
      return {
        volume: stored.volume,
        filter: stored.filter,
        uiSounds: stored.uiSounds,
        mainVolume: document.querySelector('#volumeRange').value,
        mainFilter: document.querySelector('#filterSelect').value,
        mainUiSounds: document.querySelector('#uiSoundToggle').checked,
        lcdApplied: document.querySelector('#display').classList.contains('filter-lcd')
      };
    })()`);
    assert.deepEqual(quickPreferences, {
      volume: 43, filter: "lcd", uiSounds: false,
      mainVolume: "43", mainFilter: "lcd", mainUiSounds: false,
      lcdApplied: true
    }, "ajustes do menu rápido nao foram aplicados e salvos");
    await capture(cdp, "quick-menu-mobile.png");
    await testHiddenFifa(cdp);
    await testLocalCoverLaunches(cdp);

    console.log("PASS: perfil local, HOME, menu rápido e quatro abas de configurações validados em desktop e celular");
  } finally {
    if (cdp) cdp.close();
    if (browser.exitCode === null) {
      browser.kill();
      await Promise.race([browserExited, delay(3000)]);
    }
    await new Promise((resolve) => server.close(resolve));
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(profile);
    if (resolvedProfile.startsWith(`${tempRoot}${path.sep}`)) {
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          fs.rmSync(resolvedProfile, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 9) console.warn(`WARN: perfil temporário não pôde ser removido: ${error.message}`);
          else await delay(250);
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
