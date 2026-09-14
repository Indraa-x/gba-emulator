(function () {
  "use strict";

  const DEFAULT_KEYS = Object.freeze({
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    A: "KeyX",
    B: "KeyZ",
    L: "KeyA",
    R: "KeyS",
    START: "Enter",
    SELECT: "ShiftLeft"
  });
  const GAMEPAD_BINDINGS = window.GBA.GamepadBindings;
  const LOCAL_ROM_FILENAME = "Pokemon - Emerald Version (USA, Europe).gba";
  const IS_GITHUB_PAGES = /\.github\.io$/i.test(window.location.hostname);
  const HIDDEN_GAME_CODES = new Set(["B6WE"]);
  const LOCAL_GAMES = Object.freeze([
    Object.freeze({ code: "BPEE", title: "Pokémon Emerald", filename: LOCAL_ROM_FILENAME, cover: "capas/PokemonEmeraldBox.jpg", customCover: true }),
    Object.freeze({ code: "BPRE", title: "Pokémon FireRed", filename: "Pokemon - FireRed Version (USA).gba", cover: "capas/firered.jpg", customCover: true }),
    Object.freeze({ code: "BZMP", title: "The Legend of Zelda: The Minish Cap", filename: "Legend of Zelda, The - The Minish Cap (Europe) (En,Fr,De,Es,It).gba", cover: "capas/The_Legend_of_Zelda_The_Minish_Cap_capa.png", customCover: true }),
    Object.freeze({ code: "AA2E", title: "Super Mario Advance 2: Super Mario World", filename: "Super Mario Advance 2 - Super Mario World (USA).gba", cover: "capas/MV5BMDY1ZmVkMmQtOWY0Ni00NjZlLTg5NjktYjZhY2YzNTZmYjljXkEyXkFqcGc@._V1_.jpg", customCover: true })
  ]);
  const GAME_COVERS = Object.freeze([
    Object.freeze({ codePrefix: "BPE", names: ["emerald"], src: "capas/PokemonEmeraldBox.jpg" }),
    Object.freeze({ codePrefix: "BPR", names: ["firered", "fire red"], src: "capas/firered.jpg" }),
    Object.freeze({ codePrefix: "BZM", names: ["minish cap"], src: "capas/The_Legend_of_Zelda_The_Minish_Cap_capa.png" }),
    Object.freeze({ codePrefix: "AA2", names: ["super mario advance 2", "super mario world"], src: "capas/MV5BMDY1ZmVkMmQtOWY0Ni00NjZlLTg5NjktYjZhY2YzNTZmYjljXkEyXkFqcGc@._V1_.jpg" })
  ]);

  const PROFILE_AVATARS = Object.freeze([
    Object.freeze({ id: "verdant-drake", name: "Broto esmeralda", src: "assets/avatars/verdant-drake.png?v=2" }),
    Object.freeze({ id: "ember-lynx", name: "Lince em brasa", src: "assets/avatars/ember-lynx.png?v=2" }),
    Object.freeze({ id: "storm-hare", name: "Lebre elétrica", src: "assets/avatars/storm-hare.png?v=2" }),
    Object.freeze({ id: "tide-turtle", name: "Tartaruga maré", src: "assets/avatars/tide-turtle.png?v=2" }),
    Object.freeze({ id: "moss-owl", name: "Coruja da mata", src: "assets/avatars/moss-owl.png?v=2" }),
    Object.freeze({ id: "leaf-spirit", name: "Espírito-folha", src: "assets/avatars/leaf-spirit.png?v=2" }),
    Object.freeze({ id: "fairy-lantern", name: "Luz feérica", src: "assets/avatars/fairy-lantern.png?v=2" }),
    Object.freeze({ id: "coral-mole", name: "Toupeira mecânica", src: "assets/avatars/coral-mole.png?v=2" }),
    Object.freeze({ id: "sprout-dino", name: "Dino-broto", src: "assets/avatars/sprout-dino.png?v=2" }),
    Object.freeze({ id: "sun-star", name: "Estrela solar", src: "assets/avatars/sun-star.png?v=2" })
  ]);

  const DEFAULT_PREFERENCES = Object.freeze({
    theme: "indigo",
    filter: "pixelated",
    brightness: 100,
    volume: 70,
    uiSounds: true,
    showFps: true,
    profileAvatar: "verdant-drake",
    keyMap: DEFAULT_KEYS,
    gamepadMap: GAMEPAD_BINDINGS.DEFAULT_BINDINGS,
    gamepadMapVersion: 2,
    gamepadId: "",
    mutedChannels: [false, false, false, false, false, false]
  });

  const CHANNEL_NAMES = ["Quadrada 1", "Quadrada 2", "Wave", "Ruído", "Direct A", "Direct B"];
  const CONTROL_NAMES = { UP: "Cima", DOWN: "Baixo", LEFT: "Esquerda", RIGHT: "Direita", A: "Botão A", B: "Botão B", L: "Ombro L", R: "Ombro R", START: "Start", SELECT: "Select" };

  const refs = {};
  let emulator;
  let preferences;
  let listeningControl = null;
  let listeningGamepadControl = null;
  let settingsWasRunning = false;
  let quickMenuOpen = false;
  let gamepadFrame = 0;
  let previousGamepadControls = new Map();
  let previousRawGamepadInputs = new Map();
  let selectedGamepadIndex = null;
  let gamepadSignature = "";
  let gamepadDetectionRequested = false;
  let previousMenuButton = false;
  let gamepadReadWarningShown = false;
  let gamepadPollWarningShown = false;
  let gamepadInputSuspended = false;
  let pendingLocalGame = null;
  const gamepadRepeatAt = new Map();
  let lastRomFile = null;
  let linkChannel = null;
  let uiAudioContext = null;
  const pointerOwners = new Map();

  function byId(id) {
    return document.getElementById(id);
  }

  function collectReferences() {
    const ids = [
      "bootScreen", "connectionDot", "appStatus", "screenshotBtn", "fullscreenBtn", "settingsBtn",
      "console", "powerLed", "display", "screen", "homeView", "gameView", "gameHud", "gameTitle",
      "fpsCounter", "quickMenuBtn", "quickMenu", "loadingOverlay", "loadingText", "dropZone", "romInput",
      "recentList", "settingsDialog", "keyMap", "resetKeysBtn", "filterSelect", "themeSelect",
      "brightnessRange", "brightnessValue", "fpsToggle", "volumeRange", "volumeValue", "channelToggles",
      "saveSlots",
      "gamepadCard", "gamepadStatusDot", "gamepadStatus", "gamepadDetail", "gamepadBadge", "bluetoothSettingsBtn",
      "detectGamepadBtn", "gamepadSelect", "gamepadMap", "resetGamepadBtn", "toastRegion", "systemClock",
      "selectedGameTitle", "selectedGameMeta", "uiSoundToggle", "profileAvatarButton", "profileAvatarImage",
      "profileDockButton", "profileDialog", "profilePreviewImage", "profileAvatarName", "avatarGrid",
      "quickVolumeRange", "quickVolumeValue", "quickSpeedValue",
      "quickFilterSelect", "quickUiSoundToggle"
    ];
    for (const id of ids) refs[id] = byId(id);
    refs.controlKeys = Array.from(document.querySelectorAll(".control-key"));
    refs.settingsTabs = Array.from(document.querySelectorAll(".settings-tab"));
    refs.settingsPanels = Array.from(document.querySelectorAll(".settings-panel"));
    refs.settingsPanelScroller = document.querySelector(".settings-panels");
    refs.quickActions = Array.from(document.querySelectorAll("[data-quick]"));
    refs.avatarOptions = Array.from(document.querySelectorAll(".avatar-option"));
  }

  function cloneDefaults() {
    return {
      ...DEFAULT_PREFERENCES,
      keyMap: { ...DEFAULT_KEYS },
      gamepadMap: GAMEPAD_BINDINGS.cloneDefaults(),
      mutedChannels: DEFAULT_PREFERENCES.mutedChannels.slice()
    };
  }

  function loadPreferences() {
    const defaults = cloneDefaults();
    try {
      const stored = JSON.parse(localStorage.getItem("advance-lab:preferences") || "null");
      if (!stored) return defaults;
      const gamepadMap = GAMEPAD_BINDINGS.sanitize(stored.gamepadMap);
      const legacyAB = !stored.gamepadMapVersion
        && gamepadMap.A.length === 1 && gamepadMap.A[0].type === "button" && gamepadMap.A[0].index === 0
        && gamepadMap.B.length === 1 && gamepadMap.B[0].type === "button" && gamepadMap.B[0].index === 1;
      if (legacyAB) {
        gamepadMap.A = GAMEPAD_BINDINGS.DEFAULT_BINDINGS.A.map((binding) => ({ ...binding }));
        gamepadMap.B = GAMEPAD_BINDINGS.DEFAULT_BINDINGS.B.map((binding) => ({ ...binding }));
      }
      const loaded = {
        ...defaults,
        ...stored,
        profileAvatar: PROFILE_AVATARS.some((avatar) => avatar.id === stored.profileAvatar) ? stored.profileAvatar : defaults.profileAvatar,
        keyMap: { ...DEFAULT_KEYS, ...(stored.keyMap || {}) },
        gamepadMap,
        gamepadMapVersion: 2,
        mutedChannels: Array.isArray(stored.mutedChannels) ? stored.mutedChannels.slice(0, 6) : defaults.mutedChannels
      };
      delete loaded.profileImage;
      return loaded;
    } catch (_) {
      return defaults;
    }
  }

  function savePreferences() {
    try {
      localStorage.setItem("advance-lab:preferences", JSON.stringify(preferences));
    } catch (_) {
      showToast("Não foi possível salvar as preferências.", true);
    }
  }

  function applyProfileAvatar() {
    const avatar = PROFILE_AVATARS.find((item) => item.id === preferences.profileAvatar) || PROFILE_AVATARS[0];
    preferences.profileAvatar = avatar.id;
    refs.profileAvatarImage.src = avatar.src;
    refs.profileAvatarImage.alt = `Avatar ${avatar.name}`;
    refs.profilePreviewImage.src = avatar.src;
    refs.profileAvatarName.textContent = avatar.name;
    refs.profileAvatarButton.setAttribute("aria-label", `Alterar avatar atual: ${avatar.name}`);
    for (const option of refs.avatarOptions) {
      const selected = option.dataset.avatarId === avatar.id;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-checked", String(selected));
      option.tabIndex = selected ? 0 : -1;
    }
  }

  function openProfileDialog() {
    if (refs.profileDialog.open) return;
    refs.profileDialog.showModal();
    window.setTimeout(() => {
      const selected = refs.avatarOptions.find((option) => option.classList.contains("is-selected")) || refs.avatarOptions[0];
      if (document.body.classList.contains("has-gamepad")) focusGamepadTarget(selected);
      else selected?.focus({ preventScroll: true });
    }, 0);
  }

  function bindProfile() {
    refs.profileAvatarButton.addEventListener("click", openProfileDialog);
    refs.profileDockButton.addEventListener("click", openProfileDialog);
    refs.avatarOptions.forEach((option) => option.addEventListener("click", () => {
      const avatar = PROFILE_AVATARS.find((item) => item.id === option.dataset.avatarId);
      if (!avatar || preferences.profileAvatar === avatar.id) return;
      preferences.profileAvatar = avatar.id;
      savePreferences();
      applyProfileAvatar();
      option.focus({ preventScroll: true });
      playUISound("confirm");
      showToast(`Avatar ${avatar.name} selecionado.`);
    }));
    refs.avatarGrid.addEventListener("keydown", (event) => {
      const direction = { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT" }[event.key];
      let next = null;
      if (event.key === "Home") next = refs.avatarOptions[0];
      else if (event.key === "End") next = refs.avatarOptions.at(-1);
      else if (direction) {
        const current = refs.avatarOptions.includes(document.activeElement) ? document.activeElement : refs.avatarOptions[0];
        const nextIndex = GAMEPAD_BINDINGS.findSpatialTarget(
          current.getBoundingClientRect(),
          refs.avatarOptions.map((option) => option.getBoundingClientRect()),
          direction
        );
        if (nextIndex >= 0) next = refs.avatarOptions[nextIndex];
      }
      if (!next) return;
      event.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      playUISound("move");
    });
    refs.profileDialog.addEventListener("click", (event) => {
      if (event.target === refs.profileDialog) refs.profileDialog.close();
    });
    refs.profileDialog.addEventListener("close", clearGamepadFocus);
  }

  function applyPreferences() {
    document.documentElement.dataset.theme = preferences.theme;
    refs.themeSelect.value = preferences.theme;
    refs.filterSelect.value = preferences.filter;
    refs.display.classList.toggle("filter-smooth", preferences.filter === "smooth");
    refs.display.classList.toggle("filter-lcd", preferences.filter === "lcd");
    document.documentElement.style.setProperty("--display-brightness", preferences.brightness / 100);
    refs.brightnessRange.value = preferences.brightness;
    refs.brightnessValue.textContent = `${preferences.brightness}%`;
    refs.fpsToggle.checked = preferences.showFps;
    refs.gameHud.classList.toggle("is-hidden", !preferences.showFps);
    refs.volumeRange.value = preferences.volume;
    refs.volumeValue.textContent = `${preferences.volume}%`;
    refs.uiSoundToggle.checked = preferences.uiSounds;
    applyProfileAvatar();
    emulator.apu.setVolume(preferences.volume / 100);
    preferences.mutedChannels.forEach((muted, index) => emulator.apu.setChannelMuted(index, muted));
    renderKeyMap();
    renderGamepadMap();
    updateGamepadDevices(getConnectedGamepads(), true);
    renderChannelToggles();
    syncQuickSettings();
  }

  function syncQuickSettings() {
    if (!preferences || !refs.quickVolumeRange) return;
    refs.quickVolumeRange.value = preferences.volume;
    refs.quickVolumeValue.textContent = `${preferences.volume}%`;
    refs.quickFilterSelect.value = preferences.filter;
    refs.quickUiSoundToggle.checked = preferences.uiSounds;
  }

  function setStatus(text, active) {
    refs.appStatus.textContent = text;
    refs.connectionDot.classList.toggle("is-on", Boolean(active));
    refs.powerLed.classList.toggle("is-on", Boolean(active));
  }

  function showToast(message, error = false, duration = 2600) {
    const toast = document.createElement("div");
    toast.className = `toast${error ? " is-error" : ""}`;
    toast.textContent = message;
    refs.toastRegion.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 240);
    }, duration);
  }

  function setLoading(active, message = "Lendo cartucho…") {
    refs.loadingText.textContent = message;
    refs.loadingOverlay.classList.toggle("is-active", active);
  }

  function showView(view) {
    refs.homeView.classList.toggle("view--active", view === "home");
    refs.gameView.classList.toggle("view--active", view === "game" || view === "quick");
    refs.quickMenu.classList.toggle("view--active", view === "quick");
  }

  function updateClock() {
    refs.systemClock.textContent = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date());
  }

  function playUISound(kind = "confirm") {
    if (!preferences?.uiSounds) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      if (!uiAudioContext) uiAudioContext = new AudioContextClass();
      if (uiAudioContext.state === "suspended") uiAudioContext.resume().catch(() => {});
      const patterns = {
        move: [[0, 620, 760, .045, .015, "sine"]],
        confirm: [[0, 780, 920, .065, .022, "sine"], [.045, 1040, 1180, .07, .016, "triangle"]],
        back: [[0, 520, 350, .09, .02, "sine"]],
        open: [[0, 560, 700, .08, .018, "sine"], [.055, 840, 980, .09, .014, "triangle"]],
        launch: [[0, 523, 590, .08, .022, "sine"], [.06, 659, 740, .09, .02, "sine"], [.13, 784, 940, .12, .018, "triangle"]]
      };
      const start = uiAudioContext.currentTime + .004;
      for (const [delay, from, to, duration, volume, type] of patterns[kind] || patterns.confirm) {
        const oscillator = uiAudioContext.createOscillator();
        const gain = uiAudioContext.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(from, start + delay);
        oscillator.frequency.exponentialRampToValueAtTime(to, start + delay + duration);
        gain.gain.setValueAtTime(.0001, start + delay);
        gain.gain.exponentialRampToValueAtTime(volume, start + delay + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, start + delay + duration);
        oscillator.connect(gain);
        gain.connect(uiAudioContext.destination);
        oscillator.start(start + delay);
        oscillator.stop(start + delay + duration + .015);
      }
    } catch (_) {
      // A interface continua funcionando se o navegador bloquear áudio antes da primeira interação.
    }
  }

  function soundForTarget(element) {
    if (element?.matches(".software-card, .recent-game")) return "launch";
    if (element?.matches(".close-button")) return "back";
    if (element?.matches("#settingsBtn, [data-open-settings], #profileAvatarButton, #profileDockButton")) return "open";
    return "confirm";
  }

  function friendlyKey(code) {
    const names = {
      ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
      Enter: "Enter", ShiftLeft: "Shift E", ShiftRight: "Shift D", Space: "Espaço",
      Backspace: "Backspace", Escape: "Esc"
    };
    if (names[code]) return names[code];
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code.replace(/(Left|Right)$/, " $1");
  }

  function renderKeyMap() {
    refs.keyMap.replaceChildren();
    for (const control of Object.keys(DEFAULT_KEYS)) {
      const row = document.createElement("div");
      row.className = "key-binding";
      const label = document.createElement("span");
      label.textContent = CONTROL_NAMES[control];
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.bind = control;
      button.textContent = friendlyKey(preferences.keyMap[control]);
      button.setAttribute("aria-label", `Remapear ${CONTROL_NAMES[control]}, atualmente ${button.textContent}`);
      if (listeningControl === control) {
        button.classList.add("is-listening");
        button.textContent = "…";
      }
      button.addEventListener("click", () => beginKeyListening(control));
      row.append(label, button);
      refs.keyMap.appendChild(row);
    }
  }

  function beginKeyListening(control) {
    listeningGamepadControl = null;
    listeningControl = control;
    renderKeyMap();
    renderGamepadMap();
    showToast(`Pressione uma tecla para ${CONTROL_NAMES[control]}.`);
  }

  function finishKeyListening(code) {
    if (!listeningControl) return false;
    for (const [control, assigned] of Object.entries(preferences.keyMap)) {
      if (assigned === code && control !== listeningControl) preferences.keyMap[control] = preferences.keyMap[listeningControl];
    }
    preferences.keyMap[listeningControl] = code;
    const changed = listeningControl;
    listeningControl = null;
    savePreferences();
    renderKeyMap();
    showToast(`${CONTROL_NAMES[changed]} agora usa ${friendlyKey(code)}.`);
    return true;
  }

  function renderGamepadMap() {
    refs.gamepadMap.replaceChildren();
    for (const control of GAMEPAD_BINDINGS.CONTROLS) {
      const row = document.createElement("div");
      row.className = "key-binding";
      const label = document.createElement("span");
      label.textContent = CONTROL_NAMES[control];
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.gamepadBind = control;
      button.textContent = GAMEPAD_BINDINGS.describeAll(preferences.gamepadMap[control]);
      button.setAttribute("aria-label", `Remapear ${CONTROL_NAMES[control]} no controle, atualmente ${button.textContent}`);
      if (listeningGamepadControl === control) {
        button.classList.add("is-listening");
        button.textContent = "Pressione…";
      }
      button.addEventListener("click", () => beginGamepadListening(control));
      row.append(label, button);
      refs.gamepadMap.appendChild(row);
    }
  }

  function beginGamepadListening(control) {
    const gamepad = getSelectedGamepad(getConnectedGamepads());
    if (!gamepad) {
      gamepadDetectionRequested = true;
      updateGamepadDevices([], true);
      showToast("Conecte o controle e pressione qualquer botão primeiro.", true, 3600);
      return;
    }
    listeningControl = null;
    listeningGamepadControl = control;
    previousRawGamepadInputs = GAMEPAD_BINDINGS.snapshot(gamepad);
    renderKeyMap();
    renderGamepadMap();
    showToast(`Pressione um botão ou mova o analógico para ${CONTROL_NAMES[control]}.`);
  }

  function finishGamepadListening(binding) {
    if (!listeningGamepadControl) return false;
    const changed = listeningGamepadControl;
    const oldBindings = preferences.gamepadMap[changed].map((item) => ({ ...item }));
    const newKey = GAMEPAD_BINDINGS.bindingKey(binding);
    for (const control of GAMEPAD_BINDINGS.CONTROLS) {
      if (control === changed) continue;
      if (preferences.gamepadMap[control].some((item) => GAMEPAD_BINDINGS.bindingKey(item) === newKey)) {
        preferences.gamepadMap[control] = oldBindings;
        break;
      }
    }
    preferences.gamepadMap[changed] = [{ ...binding }];
    listeningGamepadControl = null;
    savePreferences();
    renderGamepadMap();
    showToast(`${CONTROL_NAMES[changed]} agora usa ${GAMEPAD_BINDINGS.describe(binding)}.`);
    return true;
  }

  function renderChannelToggles() {
    refs.channelToggles.replaceChildren();
    CHANNEL_NAMES.forEach((name, index) => {
      const label = document.createElement("label");
      label.className = "channel-toggle";
      const text = document.createElement("span");
      text.textContent = name;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "switch";
      input.checked = !preferences.mutedChannels[index];
      input.setAttribute("aria-label", `Ativar canal ${name}`);
      input.addEventListener("change", () => {
        preferences.mutedChannels[index] = !input.checked;
        emulator.apu.setChannelMuted(index, !input.checked);
        savePreferences();
      });
      label.append(text, input);
      refs.channelToggles.appendChild(label);
    });
  }

  function getGameCover(game) {
    const code = String(game.code || "").toUpperCase();
    const searchableName = `${game.title || ""} ${game.filename || ""}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return GAME_COVERS.find((cover) => (
      code.startsWith(cover.codePrefix) || cover.names.some((name) => searchableName.includes(name))
    ));
  }

  function isHiddenGame(game) {
    const code = String(game.code || "").toUpperCase();
    const name = `${game.title || ""} ${game.filename || ""}`.toLowerCase();
    return HIDDEN_GAME_CODES.has(code)
      || ((name.includes("fifa") || name.includes("world cup")) && name.includes("2006"));
  }

  function createRecentThumbnail(game) {
    const image = document.createElement("img");
    image.alt = "";
    const customCover = getGameCover(game);
    if (customCover) {
      image.src = customCover.src;
      image.className = "game-cover game-cover--custom";
      image.dataset.coverSource = "custom";
      return image;
    }
    if (game.thumbnail) {
      image.src = game.thumbnail;
      image.className = "game-cover";
      return image;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 72;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    const hue = parseInt(game.id.slice(0, 3), 16) % 360;
    context.fillStyle = `hsl(${hue} 35% 16%)`;
    context.fillRect(0, 0, 72, 48);
    context.strokeStyle = `hsl(${hue} 70% 62%)`;
    context.lineWidth = 2;
    context.strokeRect(7, 7, 58, 34);
    context.fillStyle = `hsl(${hue} 75% 68%)`;
    context.font = "bold 17px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText((game.title || "?").charAt(0), 36, 25);
    return canvas;
  }

  async function renderRecentGames() {
    refs.recentList.replaceChildren();
    let games = [];
    try {
      games = await emulator.database.getAll("games");
    } catch (_) {
      games = [];
    }
    let firstLocalGame = null;
    for (const game of LOCAL_GAMES) {
      const storedLocalGame = games.find((stored) => stored.code === game.code && stored.rom);
      const localGame = document.createElement("button");
      localGame.type = "button";
      localGame.className = `software-card${game.code === "BPEE" ? " software-card--pokemon" : ""}`;
      localGame.dataset.gameCode = game.code;
      localGame.dataset.gameTitle = game.title;
      localGame.dataset.gameMeta = IS_GITHUB_PAGES && !storedLocalGame ? "Escolha sua ROM local" : "Game Boy Advance";
      localGame.setAttribute("aria-label", storedLocalGame ? `Iniciar ${game.title}` : `Selecionar ROM de ${game.title}`);
      const localCover = document.createElement("img");
      localCover.src = game.cover;
      localCover.addEventListener("error", () => {
        if (game.code === "BPEE") localCover.src = "tests/pokemon-cover.png";
      }, { once: true });
      localCover.alt = "";
      if (game.customCover) {
        localCover.className = "game-cover game-cover--custom";
        localCover.dataset.coverSource = "custom";
      }
      const localLabel = document.createElement("span");
      localLabel.className = "software-card__label";
      localLabel.textContent = game.title;
      localGame.append(localCover, localLabel);
      localGame.addEventListener("click", () => storedLocalGame ? loadRecentGame(storedLocalGame.id) : loadLocalGame(game));
      bindSoftwareCard(localGame);
      refs.recentList.appendChild(localGame);
      if (!firstLocalGame) firstLocalGame = localGame;
    }

    games.sort((a, b) => b.loadedAt - a.loadedAt);
    const localCodes = new Set(LOCAL_GAMES.map((game) => game.code));
    const recent = games.filter((game) => !localCodes.has(game.code) && !isHiddenGame(game));
    for (const game of recent) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "software-card recent-game";
      button.dataset.gameId = game.id;
      button.dataset.gameTitle = game.filename?.replace(/\.gba$/i, "") || game.title;
      button.dataset.gameMeta = "Game Boy Advance";
      button.setAttribute("aria-label", `Iniciar ${button.dataset.gameTitle}`);
      const thumbnail = createRecentThumbnail(game);
      const title = document.createElement("span");
      title.className = "software-card__label";
      title.textContent = button.dataset.gameTitle;
      button.append(thumbnail, title);
      button.addEventListener("click", () => loadRecentGame(game.id));
      bindSoftwareCard(button);
      refs.recentList.appendChild(button);
    }
    selectSoftwareCard(firstLocalGame);
  }

  function selectSoftwareCard(button) {
    document.querySelectorAll(".software-card.is-selected, .recent-game.is-selected").forEach((card) => card.classList.remove("is-selected"));
    if (!button?.matches(".software-card, .recent-game")) return;
    button.classList.add("is-selected");
    refs.selectedGameTitle.textContent = button.dataset.gameTitle || "Jogo";
    refs.selectedGameMeta.textContent = button.dataset.gameMeta || "Game Boy Advance";
  }

  function bindSoftwareCard(button) {
    button.addEventListener("focus", () => selectSoftwareCard(button));
    button.addEventListener("pointerenter", () => selectSoftwareCard(button));
  }

  function requestLocalROM(game) {
    pendingLocalGame = game;
    refs.romInput.value = "";
    showToast(`Selecione no seu dispositivo a ROM de ${game.title}. O arquivo ficará somente neste navegador.`, false, 6200);
    if (typeof refs.romInput.showPicker === "function") refs.romInput.showPicker();
    else refs.romInput.click();
  }

  async function loadLocalGame() {
    const game = arguments[0] || LOCAL_GAMES[0];
    if (IS_GITHUB_PAGES) {
      requestLocalROM(game);
      return;
    }
    setLoading(true, `Iniciando ${game.title}…`);
    try {
      const storedGames = await emulator.database.getAll("games").catch(() => []);
      const storedGame = storedGames.find((stored) => stored.code === game.code && stored.rom);
      if (storedGame) {
        await emulator.loadStoredROM(storedGame.id);
        return;
      }
      if (window.location.protocol === "file:") {
        throw new Error("Abra pelo arquivo Iniciar Advance Home.cmd para carregar o jogo diretamente.");
      }
      const romUrl = new URL(`./${encodeURIComponent(game.filename)}`, window.location.href);
      const response = await fetch(romUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const file = new File([await response.blob()], game.filename, { type: "application/octet-stream" });
      await loadROMFile(file);
    } catch (error) {
      const message = String(error?.message || "");
      showToast(message.startsWith("Abra pelo arquivo")
        ? message
        : `A ROM de ${game.title} não foi encontrada na pasta nem na biblioteca.`, true, 5200);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentGame(id) {
    setLoading(true, "Inserindo cartucho…");
    try {
      await emulator.loadStoredROM(id);
    } catch (error) {
      showToast(error.message || "Não foi possível abrir este cartucho.", true);
    } finally {
      setLoading(false);
    }
  }

  function validateROMFile(file) {
    if (!file) throw new Error("Nenhum arquivo selecionado.");
    if (!/\.gba$/i.test(file.name)) throw new Error("Selecione um arquivo com extensão .gba.");
    if (file.size === 0) throw new Error("O arquivo está vazio.");
    if (file.size > 32 * 1024 * 1024) throw new Error("A ROM ultrapassa o limite de 32 MB do GBA.");
  }

  async function loadROMFile(file) {
    try {
      validateROMFile(file);
      lastRomFile = file;
      setLoading(true, "Verificando cartucho…");
      const buffer = await file.arrayBuffer();
      const requestedGame = pendingLocalGame;
      pendingLocalGame = null;
      if (requestedGame) {
        const bytes = new Uint8Array(buffer);
        const code = String.fromCharCode(...bytes.subarray(0xac, 0xb0));
        if (code !== requestedGame.code) {
          throw new Error(`Esta ROM não corresponde a ${requestedGame.title}.`);
        }
      }
      const result = await emulator.loadROM(buffer, file.name, true);
      if (requestedGame) showToast(`${requestedGame.title} foi salvo somente neste navegador.`);
      return result;
    } catch (error) {
      showToast(error.message || "Falha ao carregar a ROM.", true, 3600);
      return null;
    } finally {
      setLoading(false);
      refs.romInput.value = "";
    }
  }

  async function updateGameThumbnail() {
    if (!emulator.romInfo) return;
    try {
      const game = await emulator.database.get("games", emulator.romInfo.id);
      if (!game) return;
      game.thumbnail = refs.screen.toDataURL("image/png");
      game.loadedAt = Date.now();
      await emulator.database.put("games", game);
      await renderRecentGames();
    } catch (_) {
      // A miniatura é opcional; falhas de quota não interrompem a emulação.
    }
  }

  function pressControl(control, source) {
    emulator.apu.resume();
    emulator.pressKey(control);
    document.querySelectorAll(`[data-key="${control}"]`).forEach((button) => button.classList.add("pressed"));
    if (navigator.vibrate && source === "pointer") navigator.vibrate(8);
    if (linkChannel) linkChannel.postMessage({ type: "key", control, pressed: true });
  }

  function releaseControl(control) {
    emulator.releaseKey(control);
    document.querySelectorAll(`[data-key="${control}"]`).forEach((button) => button.classList.remove("pressed"));
    if (linkChannel) linkChannel.postMessage({ type: "key", control, pressed: false });
  }

  function bindShellControls() {
    for (const button of refs.controlKeys) {
      const control = button.dataset.key;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        pointerOwners.set(event.pointerId, control);
        pressControl(control, "pointer");
      });
      const release = (event) => {
        const owned = pointerOwners.get(event.pointerId);
        if (!owned) return;
        pointerOwners.delete(event.pointerId);
        releaseControl(owned);
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
      button.addEventListener("contextmenu", (event) => event.preventDefault());
    }
  }

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
  }

  function controlForCode(code) {
    return Object.keys(preferences.keyMap).find((control) => preferences.keyMap[control] === code);
  }

  function onKeyDown(event) {
    emulator.apu.resume();
    clearGamepadFocus();
    if (listeningControl) {
      event.preventDefault();
      if (event.code === "Escape") {
        listeningControl = null;
        renderKeyMap();
      } else finishKeyListening(event.code);
      return;
    }
    if (!isTypingTarget(event.target) && gamepadNavigationMode()) {
      const navigationControl = {
        ArrowUp: "UP",
        ArrowDown: "DOWN",
        ArrowLeft: "LEFT",
        ArrowRight: "RIGHT",
        Enter: "A",
        Space: "A",
        Escape: "B",
        KeyQ: "L",
        KeyE: "R"
      }[event.code];
      if (navigationControl) {
        event.preventDefault();
        if (!event.repeat || ["UP", "DOWN", "LEFT", "RIGHT"].includes(navigationControl)) handleGamepadNavigation(navigationControl);
        return;
      }
    }
    if (event.code === "Escape" && !refs.settingsDialog.open) {
      event.preventDefault();
      if (emulator.romLoaded) {
        playUISound(quickMenuOpen ? "back" : "open");
        toggleQuickMenu();
      }
      return;
    }
    if (isTypingTarget(event.target) || refs.settingsDialog.open) return;
    const control = controlForCode(event.code);
    if (!control) return;
    event.preventDefault();
    if (!event.repeat) pressControl(control, "keyboard");
  }

  function onKeyUp(event) {
    if (isTypingTarget(event.target)) return;
    if (gamepadNavigationMode()) return;
    const control = controlForCode(event.code);
    if (!control) return;
    event.preventDefault();
    releaseControl(control);
  }

  function getConnectedGamepads() {
    if (typeof navigator.getGamepads !== "function") return [];
    try {
      const gamepads = Array.from(navigator.getGamepads() || []).filter((gamepad) => gamepad && gamepad.connected !== false);
      gamepadReadWarningShown = false;
      return gamepads;
    } catch (error) {
      if (!gamepadReadWarningShown) console.warn("Não foi possível ler o controle conectado.", error);
      gamepadReadWarningShown = true;
      return [];
    }
  }

  function cleanGamepadName(id) {
    return String(id || "Controle genérico")
      .replace(/\s*\(.*?(Vendor|Product):.*?\)\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim() || "Controle genérico";
  }

  function getSelectedGamepad(gamepads = getConnectedGamepads()) {
    let selected = gamepads.find((gamepad) => gamepad.index === selectedGamepadIndex);
    if (!selected && preferences?.gamepadId) selected = gamepads.find((gamepad) => gamepad.id === preferences.gamepadId);
    if (!selected) selected = gamepads[0] || null;
    selectedGamepadIndex = selected?.index ?? null;
    return selected;
  }

  function updateGamepadDevices(gamepads = getConnectedGamepads(), force = false) {
    if (typeof navigator.getGamepads !== "function") {
      refs.gamepadSelect.disabled = true;
      refs.detectGamepadBtn.disabled = true;
      refs.gamepadStatus.textContent = "Gamepad API indisponível";
      refs.gamepadDetail.textContent = "Abra o emulador em uma versão atual do Chrome, Edge ou Firefox.";
      refs.gamepadBadge.textContent = "INDISPONÍVEL";
      return;
    }
    const signature = gamepads.map((gamepad) => `${gamepad.index}:${gamepad.id}:${gamepad.mapping}`).join("|");
    const selected = getSelectedGamepad(gamepads);
    const selectedValue = refs.gamepadSelect.value === "" ? null : Number(refs.gamepadSelect.value);
    if (!force && signature === gamepadSignature && (selected?.index ?? null) === selectedValue) return;
    gamepadSignature = signature;
    refs.gamepadSelect.replaceChildren();

    if (!gamepads.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Nenhum";
      refs.gamepadSelect.appendChild(option);
      refs.gamepadSelect.disabled = true;
      refs.gamepadCard.classList.toggle("is-waiting", gamepadDetectionRequested);
      refs.gamepadCard.classList.remove("is-connected");
      refs.gamepadStatus.textContent = gamepadDetectionRequested ? "Aguardando controle…" : "Nenhum controle detectado";
      refs.gamepadDetail.textContent = gamepadDetectionRequested
        ? "Emparelhe no Bluetooth e pressione um botão no controle."
        : "Compatível com controles Bluetooth e USB reconhecidos pelo navegador.";
      refs.gamepadBadge.textContent = gamepadDetectionRequested ? "PROCURANDO" : "OFFLINE";
      refs.detectGamepadBtn.textContent = "Detectar controle";
      return;
    }

    for (const gamepad of gamepads) {
      const option = document.createElement("option");
      option.value = String(gamepad.index);
      option.textContent = cleanGamepadName(gamepad.id);
      option.selected = gamepad.index === selected.index;
      refs.gamepadSelect.appendChild(option);
    }
    refs.gamepadSelect.disabled = gamepads.length < 2;
    refs.gamepadCard.classList.remove("is-waiting");
    refs.gamepadCard.classList.add("is-connected");
    refs.gamepadStatus.textContent = cleanGamepadName(selected.id);
    refs.gamepadDetail.textContent = selected.mapping === "standard"
      ? "Layout padrão reconhecido. Você pode personalizar cada função abaixo."
      : `${selected.buttons.length} botões e ${selected.axes.length} eixos detectados. Faça o mapeamento abaixo.`;
    refs.gamepadBadge.textContent = "CONECTADO";
    refs.detectGamepadBtn.textContent = "Atualizar controles";
  }

  function releaseGamepadControls() {
    for (const [control, pressed] of previousGamepadControls) {
      if (pressed) releaseControl(control);
    }
    previousGamepadControls = new Map();
  }

  function resetInputStateAfterRestore() {
    emulator.releaseAllKeys();
    pointerOwners.clear();
    refs.controlKeys.forEach((button) => button.classList.remove("pressed"));
    gamepadRepeatAt.clear();

    // Adopt the controller's current physical state without forwarding it to
    // the game. This requires a release and a fresh press after loading and
    // prevents the A/Start used in the menu from becoming stuck in the ROM.
    const gamepad = getSelectedGamepad(getConnectedGamepads());
    const activeControls = new Map();
    for (const control of GAMEPAD_BINDINGS.CONTROLS) {
      const pressed = Boolean(gamepad && GAMEPAD_BINDINGS.controlIsActive(gamepad, preferences.gamepadMap[control]));
      activeControls.set(control, pressed);
    }
    previousGamepadControls = activeControls;
    previousRawGamepadInputs = GAMEPAD_BINDINGS.snapshot(gamepad);
    previousMenuButton = Boolean(activeControls.get("START"));
  }

  function gamepadNavigationMode() {
    return refs.settingsDialog.open || refs.profileDialog.open || quickMenuOpen || refs.homeView.classList.contains("view--active");
  }

  function isVisibleNavigationTarget(element) {
    if (!element || element.disabled || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  }

  function gamepadNavigationTargets() {
    const selector = "button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]):not([type='file']), [tabindex]:not([tabindex='-1'])";
    let candidates = [];
    if (refs.profileDialog.open) {
      candidates = Array.from(refs.profileDialog.querySelectorAll(selector));
    } else if (refs.settingsDialog.open) {
      candidates = Array.from(refs.settingsDialog.querySelectorAll(selector));
    } else if (quickMenuOpen) {
      candidates = Array.from(refs.quickMenu.querySelectorAll(selector));
    } else {
      candidates = Array.from(refs.homeView.querySelectorAll(selector));
    }
    return [...new Set(candidates)].filter(isVisibleNavigationTarget);
  }

  function clearGamepadFocus() {
    document.querySelectorAll(".gamepad-focus").forEach((element) => element.classList.remove("gamepad-focus"));
  }

  function revealNavigationTarget(element) {
    const strip = element.closest?.(".software-strip");
    if (!strip) {
      element.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
      return;
    }
    const target = element.getBoundingClientRect();
    const viewport = strip.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const focusSpace = (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0) + 2;
    let distance = 0;
    if (target.left < viewport.left + focusSpace) distance = target.left - viewport.left - focusSpace;
    else if (target.right > viewport.right - focusSpace) distance = target.right - viewport.right + focusSpace;
    // scrollLeft funciona também em navegadores/WebViews que não implementam
    // Element.scrollBy. Uma exceção aqui não pode derrubar o polling inteiro.
    if (distance) strip.scrollLeft = Math.max(0, strip.scrollLeft + distance);
    const page = document.scrollingElement;
    if (page) {
      page.scrollLeft = 0;
      page.scrollTop = 0;
    }
  }

  function focusGamepadTarget(element) {
    if (!element) return;
    const changed = document.activeElement !== element;
    clearGamepadFocus();
    element.classList.add("gamepad-focus");
    selectSoftwareCard(element);
    element.focus({ preventScroll: true });
    revealNavigationTarget(element);
    if (changed) playUISound("move");
  }

  function focusFirstGamepadTarget() {
    const targets = gamepadNavigationTargets();
    let preferred = targets[0];
    if (quickMenuOpen) preferred = refs.quickMenu.querySelector('[data-quick="resume"]');
    else if (refs.profileDialog.open) preferred = refs.avatarOptions.find((option) => option.classList.contains("is-selected"));
    else if (refs.settingsDialog.open) preferred = refs.settingsTabs.find((tab) => tab.classList.contains("is-active"));
    else if (refs.homeView.classList.contains("view--active")) preferred = refs.recentList.querySelector(".software-card") || refs.dropZone;
    focusGamepadTarget(targets.includes(preferred) ? preferred : targets[0]);
  }

  function adjustFocusedField(direction) {
    const active = document.activeElement;
    if (direction !== "LEFT" && direction !== "RIGHT") return false;
    const step = direction === "LEFT" ? -1 : 1;
    if (active instanceof HTMLSelectElement && active.options.length) {
      active.selectedIndex = (active.selectedIndex + step + active.options.length) % active.options.length;
      active.dispatchEvent(new Event("change", { bubbles: true }));
      playUISound("move");
      return true;
    }
    if (active instanceof HTMLInputElement && active.type === "range") {
      const increment = Number(active.step) || 1;
      const value = Math.max(Number(active.min), Math.min(Number(active.max), Number(active.value) + step * increment));
      active.value = String(value);
      active.dispatchEvent(new Event("input", { bubbles: true }));
      active.dispatchEvent(new Event("change", { bubbles: true }));
      playUISound("move");
      return true;
    }
    return false;
  }

  function moveGamepadFocus(direction) {
    if (adjustFocusedField(direction)) return;
    const targets = gamepadNavigationTargets();
    if (!targets.length) return;
    let current = targets.includes(document.activeElement) ? document.activeElement : null;
    if (!current) {
      current = targets.find((target) => target.classList.contains("is-selected")) || targets[0];
      focusGamepadTarget(current);
    }

    const nextIndex = GAMEPAD_BINDINGS.findSpatialTarget(
      current.getBoundingClientRect(),
      targets.map((target) => target.getBoundingClientRect()),
      direction
    );
    if (nextIndex >= 0) focusGamepadTarget(targets[nextIndex]);
  }

  function activateGamepadTarget() {
    const targets = gamepadNavigationTargets();
    const active = targets.includes(document.activeElement)
      ? document.activeElement
      : targets.find((target) => target.classList.contains("is-selected"));
    if (!active) {
      focusGamepadTarget(targets[0]);
      return;
    }
    if (active instanceof HTMLSelectElement) {
      active.selectedIndex = (active.selectedIndex + 1) % active.options.length;
      active.dispatchEvent(new Event("change", { bubbles: true }));
      playUISound("confirm");
      return;
    }
    playUISound(soundForTarget(active));
    active.click();
  }

  function navigateSettingsTab(step) {
    if (!refs.settingsDialog.open) return false;
    const current = refs.settingsTabs.findIndex((tab) => tab.classList.contains("is-active"));
    const next = (current + step + refs.settingsTabs.length) % refs.settingsTabs.length;
    selectSettingsTab(refs.settingsTabs[next].dataset.tab);
    focusGamepadTarget(refs.settingsTabs[next]);
    return true;
  }

  function handleGamepadNavigation(control) {
    if (["UP", "DOWN", "LEFT", "RIGHT"].includes(control)) {
      moveGamepadFocus(control);
      return;
    }
    if (control === "A" || control === "START") {
      activateGamepadTarget();
      return;
    }
    if (control === "B") {
      playUISound("back");
      if (refs.profileDialog.open) refs.profileDialog.close();
      else if (refs.settingsDialog.open) refs.settingsDialog.close();
      else if (quickMenuOpen) toggleQuickMenu(false);
      else clearGamepadFocus();
      return;
    }
    if (control === "L") navigateSettingsTab(-1);
    if (control === "R") navigateSettingsTab(1);
  }

  function processGamepadNavigation(activeControls) {
    const now = performance.now();
    for (const control of GAMEPAD_BINDINGS.CONTROLS) {
      const pressed = activeControls.get(control) || false;
      const wasPressed = previousGamepadControls.get(control) || false;
      const repeatable = ["UP", "DOWN", "LEFT", "RIGHT"].includes(control);
      if (pressed && !wasPressed) {
        handleGamepadNavigation(control);
        if (repeatable) gamepadRepeatAt.set(control, now + 360);
      } else if (pressed && repeatable && now >= (gamepadRepeatAt.get(control) || Infinity)) {
        handleGamepadNavigation(control);
        gamepadRepeatAt.set(control, now + 115);
      } else if (!pressed) {
        gamepadRepeatAt.delete(control);
      }
    }
  }

  function pollGamepads() {
    // Agenda o próximo quadro antes de processar a entrada. Assim, uma falha
    // isolada de foco/rolagem nunca desliga o controle até recarregar a página.
    gamepadFrame = requestAnimationFrame(pollGamepads);
    try {
      const gamepads = getConnectedGamepads();
      updateGamepadDevices(gamepads);
      const gamepad = getSelectedGamepad(gamepads);
      const rawInputs = GAMEPAD_BINDINGS.snapshot(gamepad);

      let capturedBinding = false;
      if (listeningGamepadControl && gamepad) {
        const binding = GAMEPAD_BINDINGS.firstNewInput(gamepad, previousRawGamepadInputs);
        if (binding) capturedBinding = finishGamepadListening(binding);
      }

      const activeControls = new Map();
      for (const control of GAMEPAD_BINDINGS.CONTROLS) {
        const pressed = Boolean(gamepad && GAMEPAD_BINDINGS.controlIsActive(gamepad, preferences.gamepadMap[control]));
        activeControls.set(control, pressed);
      }

      let navigationMode = gamepadNavigationMode();
      const menuButton = Boolean(activeControls.get("START"));
      if (!gamepadInputSuspended && !navigationMode && emulator.romLoaded && menuButton && !previousMenuButton) {
        emulator.releaseAllKeys();
        playUISound("open");
        toggleQuickMenu(true);
        navigationMode = true;
        window.setTimeout(focusFirstGamepadTarget, 0);
      }

      if (!gamepadInputSuspended && navigationMode) {
        if (!capturedBinding && !listeningGamepadControl) processGamepadNavigation(activeControls);
      } else if (!gamepadInputSuspended) {
        for (const control of GAMEPAD_BINDINGS.CONTROLS) {
          const pressed = activeControls.get(control) || false;
          const wasPressed = previousGamepadControls.get(control) || false;
          if (pressed && !wasPressed) pressControl(control, "gamepad");
          if (!pressed && wasPressed) releaseControl(control);
        }
      }

      previousGamepadControls = activeControls;
      previousRawGamepadInputs = rawInputs;
      previousMenuButton = menuButton;
      document.body.classList.toggle("has-gamepad", Boolean(gamepad));
      gamepadPollWarningShown = false;
    } catch (error) {
      if (!gamepadPollWarningShown) console.error("Falha temporária ao processar o controle; a leitura continuará.", error);
      gamepadPollWarningShown = true;
    }
  }

  function openSettings(tab) {
    if (refs.settingsDialog.open) return;
    settingsWasRunning = emulator.romLoaded && !emulator.paused;
    if (settingsWasRunning) emulator.pause();
    if (tab) selectSettingsTab(tab);
    refs.settingsDialog.showModal();
    if (document.body.classList.contains("has-gamepad")) window.setTimeout(focusFirstGamepadTarget, 0);
  }

  function closeSettings() {
    listeningControl = null;
    listeningGamepadControl = null;
    renderKeyMap();
    renderGamepadMap();
    clearGamepadFocus();
    if (settingsWasRunning && !quickMenuOpen) emulator.start();
    settingsWasRunning = false;
  }

  function selectSettingsTab(name) {
    let activeTab = null;
    refs.settingsTabs.forEach((tab) => {
      const selected = tab.dataset.tab === name;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) activeTab = tab;
    });
    refs.settingsPanels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === name));
    refs.settingsPanelScroller.scrollTop = 0;
    if (refs.settingsDialog.open && activeTab) {
      window.requestAnimationFrame(() => activeTab.scrollIntoView({ block: "nearest", inline: "nearest" }));
    }
    if (name === "controls") updateGamepadDevices(getConnectedGamepads(), true);
    if (name === "saves") renderSaveSlots();
  }

  function onTabKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const current = refs.settingsTabs.indexOf(event.currentTarget);
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = (current + direction + refs.settingsTabs.length) % refs.settingsTabs.length;
    refs.settingsTabs[next].focus();
    selectSettingsTab(refs.settingsTabs[next].dataset.tab);
  }

  async function renderSaveSlots() {
    refs.saveSlots.replaceChildren();
    let states = [];
    try {
      states = await emulator.listStates();
    } catch (_) {
      states = [];
    }
    for (let slot = 1; slot <= 5; slot++) {
      const record = states.find((state) => state.slot === slot);
      const row = document.createElement("div");
      row.className = "save-slot";
      const number = document.createElement("span");
      number.className = "save-slot__number";
      number.textContent = String(slot).padStart(2, "0");
      const copy = document.createElement("span");
      copy.className = "save-slot__copy";
      const title = document.createElement("strong");
      title.textContent = record ? "Estado salvo" : "Slot vazio";
      const date = document.createElement("small");
      date.textContent = record ? formatDate(record.timestamp) : "Pronto para usar";
      copy.append(title, date);
      const actions = document.createElement("span");
      actions.className = "save-slot__actions";
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.textContent = record ? "Substituir" : "Salvar";
      saveButton.disabled = !emulator.romLoaded;
      saveButton.addEventListener("click", () => saveSlot(slot));
      actions.appendChild(saveButton);
      if (record) {
        const loadButton = document.createElement("button");
        loadButton.type = "button";
        loadButton.textContent = "Abrir";
        loadButton.addEventListener("click", () => loadSlot(slot));
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "×";
        deleteButton.setAttribute("aria-label", `Excluir estado do slot ${slot}`);
        deleteButton.addEventListener("click", () => deleteSlot(slot));
        actions.append(loadButton, deleteButton);
      }
      row.append(number, copy, actions);
      refs.saveSlots.appendChild(row);
    }
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(timestamp));
  }

  async function saveSlot(slot) {
    if (!emulator.romLoaded) {
      showToast("Carregue um jogo primeiro.", true);
      return;
    }
    setLoading(true, `Salvando slot ${slot}…`);
    try {
      await emulator.saveState(slot);
      showToast(`Estado salvo no slot ${slot}.`);
      await renderSaveSlots();
    } catch (error) {
      showToast(error.message || "Falha ao salvar o estado.", true);
    } finally {
      setLoading(false);
    }
  }

  async function loadSlot(slot) {
    setLoading(true, `Abrindo slot ${slot}…`);
    try {
      await emulator.loadState(slot);
      quickMenuOpen = false;
      settingsWasRunning = false;
      if (refs.settingsDialog.open) refs.settingsDialog.close();
      clearGamepadFocus();
      showView("game");
      resetInputStateAfterRestore();
      emulator.start();
      refs.display.focus({ preventScroll: true });
      setStatus("EM EXECUÃ‡ÃƒO", true);
      showToast(`Estado ${slot} restaurado.`);
    } catch (error) {
      showToast(error.message || "Falha ao carregar o estado.", true);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSlot(slot) {
    try {
      await emulator.deleteState(slot);
      showToast(`Slot ${slot} apagado.`);
      await renderSaveSlots();
    } catch (_) {
      showToast("Não foi possível apagar o estado.", true);
    }
  }

  function toggleQuickMenu(force) {
    if (!emulator.romLoaded) return;
    const shouldOpen = force === undefined ? !quickMenuOpen : Boolean(force);
    quickMenuOpen = shouldOpen;
    if (shouldOpen) {
      emulator.pause();
      syncQuickSettings();
      showView("quick");
      window.setTimeout(() => {
        if (document.body.classList.contains("has-gamepad")) focusFirstGamepadTarget();
        else refs.quickActions[0]?.focus();
      }, 50);
      setStatus("PAUSADO", true);
    } else {
      clearGamepadFocus();
      showView("game");
      emulator.start();
      refs.display.focus();
      setStatus("EM EXECUÇÃO", true);
    }
  }

  async function handleQuickAction(action) {
    if (action === "resume") toggleQuickMenu(false);
    if (action === "save") await saveSlot(1);
    if (action === "load") await loadSlot(1);
    if (action === "fullscreen") await toggleFullscreen();
    if (action === "fast") {
      const speed = emulator.setFastForward();
      syncGameSpeed(speed);
      showToast(`A velocidade deste jogo é fixa em ${speed}×.`);
    }
    if (action === "home") returnHome();
  }

  function syncGameSpeed(speed = emulator.getSpeedMultiplier()) {
    const fixedSpeed = Number(speed) === 1 ? 1 : 2;
    refs.quickSpeedValue.textContent = `${fixedSpeed}×`;
    const button = refs.quickSpeedValue.closest("button");
    button?.setAttribute("aria-label", `Velocidade fixa em ${fixedSpeed}×`);
  }

  function returnHome() {
    emulator.pause();
    emulator.flushSave();
    quickMenuOpen = false;
    showView("home");
    setStatus("PRONTO", false);
    void renderRecentGames().finally(() => {
      if (document.body.classList.contains("has-gamepad")) focusFirstGamepadTarget();
    });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await refs.console.requestFullscreen({ navigationUI: "hide" });
    } catch (_) {
      showToast("Tela cheia não está disponível neste navegador.", true);
    }
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function captureScreenshot() {
    if (!emulator.romLoaded) {
      showToast("Carregue um jogo para capturar a tela.", true);
      return;
    }
    const blob = await emulator.screenshot();
    if (!blob) {
      showToast("A captura não pôde ser criada.", true);
      return;
    }
    const safeTitle = emulator.romInfo.title.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "") || "game";
    downloadBlob(blob, `${safeTitle}-${Date.now()}.png`);
    showToast("Captura salva em PNG.");
  }

  function setupLinkChannel() {
    if (!("BroadcastChannel" in window)) return;
    linkChannel = new BroadcastChannel("advance-lab-link");
    linkChannel.onmessage = (event) => {
      if (event.data?.type === "hello") linkChannel.postMessage({ type: "ready", game: emulator.romInfo?.id || null });
      if (event.data?.type === "ready" && event.data.game && event.data.game === emulator.romInfo?.id) {
        showToast("Outra aba com o mesmo cartucho foi detectada.");
      }
    };
    linkChannel.postMessage({ type: "hello" });
  }

  function bindROMInput() {
    bindSoftwareCard(refs.dropZone);
    refs.dropZone.addEventListener("click", () => {
      pendingLocalGame = null;
      refs.romInput.click();
    });
    refs.romInput.addEventListener("change", () => loadROMFile(refs.romInput.files[0]));
    const dragEnter = (event) => {
      event.preventDefault();
      refs.dropZone.classList.add("is-dragging");
    };
    const dragLeave = (event) => {
      event.preventDefault();
      if (!refs.dropZone.contains(event.relatedTarget)) refs.dropZone.classList.remove("is-dragging");
    };
    refs.dropZone.addEventListener("dragenter", dragEnter);
    refs.dropZone.addEventListener("dragover", dragEnter);
    refs.dropZone.addEventListener("dragleave", dragLeave);
    refs.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      refs.dropZone.classList.remove("is-dragging");
      pendingLocalGame = null;
      loadROMFile(event.dataTransfer.files[0]);
    });
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", (event) => {
      event.preventDefault();
      if (event.dataTransfer.files[0]) {
        pendingLocalGame = null;
        loadROMFile(event.dataTransfer.files[0]);
      }
    });
  }

  function bindSettings() {
    refs.settingsBtn.addEventListener("click", () => openSettings());
    document.querySelectorAll("[data-open-settings]").forEach((button) => {
      button.addEventListener("click", () => openSettings(button.dataset.openSettings));
    });
    refs.settingsDialog.addEventListener("close", closeSettings);
    refs.settingsDialog.addEventListener("click", (event) => {
      if (event.target === refs.settingsDialog) refs.settingsDialog.close();
    });
    refs.settingsTabs.forEach((tab) => {
      tab.addEventListener("click", () => selectSettingsTab(tab.dataset.tab));
      tab.addEventListener("keydown", onTabKeydown);
    });
    refs.resetKeysBtn.addEventListener("click", () => {
      preferences.keyMap = { ...DEFAULT_KEYS };
      savePreferences();
      renderKeyMap();
      showToast("Teclado restaurado.");
    });
    refs.resetGamepadBtn.addEventListener("click", () => {
      listeningGamepadControl = null;
      preferences.gamepadMap = GAMEPAD_BINDINGS.cloneDefaults();
      savePreferences();
      renderGamepadMap();
      showToast("Controle restaurado para o layout padrão.");
    });
    refs.detectGamepadBtn.addEventListener("click", () => {
      const gamepads = getConnectedGamepads();
      gamepadDetectionRequested = !gamepads.length;
      updateGamepadDevices(gamepads, true);
      if (gamepads.length) showToast(`${gamepads.length} controle${gamepads.length > 1 ? "s" : ""} detectado${gamepads.length > 1 ? "s" : ""}.`);
      else showToast("Emparelhe o controle no Bluetooth e pressione qualquer botão.", false, 4200);
    });
    refs.bluetoothSettingsBtn.addEventListener("click", () => {
      showToast("Abrindo as configurações Bluetooth do Windows…");
    });
    refs.gamepadSelect.addEventListener("change", () => {
      releaseGamepadControls();
      selectedGamepadIndex = Number(refs.gamepadSelect.value);
      previousRawGamepadInputs = new Map();
      const selected = getSelectedGamepad(getConnectedGamepads());
      preferences.gamepadId = selected?.id || "";
      savePreferences();
      updateGamepadDevices(getConnectedGamepads(), true);
      if (selected) showToast(`${cleanGamepadName(selected.id)} selecionado.`);
    });
    window.addEventListener("gamepadconnected", (event) => {
      gamepadDetectionRequested = false;
      if (selectedGamepadIndex === null) selectedGamepadIndex = event.gamepad.index;
      if (!preferences.gamepadId) preferences.gamepadId = event.gamepad.id;
      savePreferences();
      updateGamepadDevices(getConnectedGamepads(), true);
      showToast(`${cleanGamepadName(event.gamepad.id)} conectado.`);
    });
    window.addEventListener("gamepaddisconnected", (event) => {
      if (event.gamepad.index === selectedGamepadIndex) {
        releaseGamepadControls();
        selectedGamepadIndex = null;
        listeningGamepadControl = null;
        renderGamepadMap();
      }
      updateGamepadDevices(getConnectedGamepads(), true);
      showToast(`${cleanGamepadName(event.gamepad.id)} desconectado.`, true);
    });
    refs.filterSelect.addEventListener("change", () => {
      preferences.filter = refs.filterSelect.value;
      applyPreferences();
      savePreferences();
    });
    refs.themeSelect.addEventListener("change", () => {
      preferences.theme = refs.themeSelect.value;
      document.documentElement.dataset.theme = preferences.theme;
      savePreferences();
    });
    refs.brightnessRange.addEventListener("input", () => {
      preferences.brightness = Number(refs.brightnessRange.value);
      refs.brightnessValue.textContent = `${preferences.brightness}%`;
      document.documentElement.style.setProperty("--display-brightness", preferences.brightness / 100);
      syncQuickSettings();
    });
    refs.brightnessRange.addEventListener("change", savePreferences);
    refs.fpsToggle.addEventListener("change", () => {
      preferences.showFps = refs.fpsToggle.checked;
      refs.gameHud.classList.toggle("is-hidden", !preferences.showFps);
      syncQuickSettings();
      savePreferences();
    });
    refs.volumeRange.addEventListener("input", () => {
      preferences.volume = Number(refs.volumeRange.value);
      refs.volumeValue.textContent = `${preferences.volume}%`;
      emulator.apu.setVolume(preferences.volume / 100);
      syncQuickSettings();
    });
    refs.volumeRange.addEventListener("change", savePreferences);
    refs.uiSoundToggle.addEventListener("change", () => {
      preferences.uiSounds = refs.uiSoundToggle.checked;
      syncQuickSettings();
      savePreferences();
    });
    refs.quickVolumeRange.addEventListener("input", () => {
      refs.volumeRange.value = refs.quickVolumeRange.value;
      refs.volumeRange.dispatchEvent(new Event("input", { bubbles: true }));
    });
    refs.quickVolumeRange.addEventListener("change", savePreferences);
    refs.quickFilterSelect.addEventListener("change", () => {
      refs.filterSelect.value = refs.quickFilterSelect.value;
      refs.filterSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    refs.quickUiSoundToggle.addEventListener("change", () => {
      refs.uiSoundToggle.checked = refs.quickUiSoundToggle.checked;
      refs.uiSoundToggle.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function bindGlobalActions() {
    refs.fullscreenBtn.addEventListener("click", toggleFullscreen);
    refs.screenshotBtn.addEventListener("click", captureScreenshot);
    refs.quickMenuBtn.addEventListener("click", () => toggleQuickMenu(true));
    refs.quickActions.forEach((button) => button.addEventListener("click", () => handleQuickAction(button.dataset.quick)));
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("pointerdown", () => {
      emulator.apu.resume();
      clearGamepadFocus();
    }, true);
    document.addEventListener("pointerdown", (event) => {
      const target = event.target.closest?.("button, a[href]");
      if (target) playUISound(soundForTarget(target));
    }, true);
    document.querySelectorAll("[data-system-info]").forEach((button) => {
      button.addEventListener("click", () => showToast("Emulação local · nenhum dado é enviado para a internet."));
    });
    window.addEventListener("blur", () => {
      gamepadInputSuspended = true;
      emulator.releaseAllKeys();
      refs.controlKeys.forEach((button) => button.classList.remove("pressed"));
      pointerOwners.clear();
    });
    window.addEventListener("focus", () => {
      gamepadInputSuspended = false;
      resetInputStateAfterRestore();
    });
    window.addEventListener("beforeunload", () => {
      emulator.flushSave();
      if (linkChannel) linkChannel.close();
      cancelAnimationFrame(gamepadFrame);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && emulator.romLoaded && !emulator.paused) {
        emulator.pause();
        quickMenuOpen = true;
        showView("quick");
      }
    });
  }

  function bindEmulatorEvents() {
    emulator.addEventListener("romloaded", (event) => {
      refs.gameTitle.textContent = event.detail.title;
      syncGameSpeed();
      refs.screenshotBtn.disabled = false;
      showView("game");
      setStatus("EM EXECUÇÃO", true);
      quickMenuOpen = false;
      renderSaveSlots();
      // Jogos comerciais podem manter a tela preta durante a inicialização.
      window.setTimeout(updateGameThumbnail, 5000);
    });
    emulator.addEventListener("fps", (event) => {
      const speed = emulator.getSpeedMultiplier();
      refs.fpsCounter.textContent = `${event.detail} FPS${speed > 1 ? ` · ${speed}×` : ""}`;
    });
    emulator.addEventListener("pause", () => {
      if (emulator.romLoaded) setStatus("PAUSADO", true);
    });
    emulator.addEventListener("resume", () => setStatus("EM EXECUÇÃO", true));
    emulator.addEventListener("speedchange", (event) => {
      syncGameSpeed(event.detail);
      refs.fpsCounter.textContent = `${emulator.fps} FPS${event.detail > 1 ? ` · ${event.detail}×` : ""}`;
    });
    emulator.addEventListener("error", (event) => {
      const message = event.detail?.message || "O núcleo de emulação encontrou um erro.";
      setStatus("ERRO", false);
      showToast(message, true, 5200);
      if (document.documentElement.dataset.testStatus) {
        document.documentElement.dataset.testStatus = "fail";
        document.documentElement.dataset.testDetail = message;
      }
    });
  }

  async function runBrowserSmokeIfRequested() {
    const romPath = new URLSearchParams(window.location.search).get("testRom");
    if (!romPath) return;

    const root = document.documentElement;
    root.dataset.testStatus = "loading";
    root.dataset.testDetail = "Carregando ROM do teste";
    window.addEventListener("error", (event) => {
      root.dataset.testStatus = "fail";
      root.dataset.testDetail = event.message || "Erro JavaScript";
    });
    window.addEventListener("unhandledrejection", (event) => {
      root.dataset.testStatus = "fail";
      root.dataset.testDetail = String(event.reason?.message || event.reason || "Promise rejeitada");
    });

    try {
      const response = await fetch(new URL(romPath, window.location.href));
      if (!response.ok) throw new Error(`HTTP ${response.status} ao carregar a ROM de teste.`);
      const filename = romPath.split(/[\\/]/).pop() || "smoke-test.gba";
      const result = await loadROMFile(new File([await response.blob()], filename));
      if (!result) throw new Error("A interface recusou a ROM de teste.");

      root.dataset.testDetail = "Aguardando quadros renderizados";
      window.setTimeout(() => {
        if (root.dataset.testStatus === "fail") return;
        try {
          const context = refs.screen.getContext("2d", { willReadFrequently: true });
          const pixels = context.getImageData(0, 0, refs.screen.width, refs.screen.height).data;
          const colors = new Set();
          for (let index = 0; index < pixels.length; index += 64) {
            colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
            if (colors.size >= 16) break;
          }
          const correctCart = emulator.romInfo?.code === "BPEE";
          const passed = correctCart && colors.size >= 8 && !emulator.lastError;
          root.dataset.testStatus = passed ? "pass" : "fail";
          root.dataset.testDetail = `cart=${emulator.romInfo?.code || "?"}; colors=${colors.size}; fps=${emulator.fps || 0}`;
        } catch (error) {
          root.dataset.testStatus = "fail";
          root.dataset.testDetail = error.message;
        }
      }, 8000);
    } catch (error) {
      root.dataset.testStatus = "fail";
      root.dataset.testDetail = error.message;
    }
  }

  function hideBootScreen() {
    refs.bootScreen.classList.add("is-hidden");
    window.setTimeout(() => refs.bootScreen.remove(), 700);
  }

  function initialize() {
    collectReferences();
    emulator = new window.GBA.Emulator(refs.screen);
    window.advanceLab = emulator;
    preferences = loadPreferences();
    applyPreferences();
    bindROMInput();
    bindShellControls();
    bindSettings();
    bindProfile();
    bindGlobalActions();
    bindEmulatorEvents();
    setupLinkChannel();
    renderSaveSlots();
    void renderRecentGames();
    refs.screenshotBtn.disabled = true;
    setStatus("PRONTO", false);
    updateClock();
    window.setInterval(updateClock, 15000);
    gamepadFrame = requestAnimationFrame(pollGamepads);
    const bootDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 100 : 550;
    window.setTimeout(hideBootScreen, bootDelay);
    refs.bootScreen.addEventListener("click", hideBootScreen, { once: true });
    runBrowserSmokeIfRequested();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
