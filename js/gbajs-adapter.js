(function (GBA) {
  "use strict";

  // BIOS livre compilada de vendor/gbajs/bios.S. Não contém código da Nintendo.
  const FREE_BIOS_BASE64 = "BgAA6v7//+oFAADq/v//6v7//+oAAKDhDAAA6v7//+oC86DjAABd4wHToAMg0E0CAEAt6QIAXuUEAFDjCQAACwUAUOMHAAALAEC96A7wsOEPUC3pAQOg4wDgj+IE8BDlD1C96ATwXuIQQC3pBNBN4rAQzeEBQ6DjAkyE4rAA1OGyAM3hsBDd4QEAgOGwAMThAUOg4x8AoOMA8CnhAACg4wEDxOXTAKDjAPAp4bgAVOGwEN3hABAR4AAQIRC4EEQR8///CgFDoOMCTITisgDd4bAAxOEE0I3iEIC96A==";
  const KEY_BITS = Object.freeze({ A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9 });
  const FAST_FORWARD_MULTIPLIER = 2;
  const NORMAL_SPEED_CODE_PREFIXES = Object.freeze(["BZM", "AA2"]);
  const NORMAL_SPEED_NAME_PATTERN = /\b(?:zelda|mario)\b/i;

  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  class GBAJSAdapter extends EventTarget {
    constructor(canvas) {
      super();
      if (typeof window.GameBoyAdvance !== "function") throw new Error("O núcleo GBA.js não foi carregado.");
      this.canvas = canvas;
      this.core = new window.GameBoyAdvance();
      this.core.setCanvasDirect(canvas);
      this.core.setBios(decodeBase64(FREE_BIOS_BASE64), false);
      this.core.logLevel = this.core.LOG_ERROR;
      this.core.setLogger((level, error) => {
        // GBA.js emits the exception once at LOG_ERROR and then emits every
        // stack frame with level -1.  Treat only the first entry as a UI
        // error so one failure can never cover the screen with many toasts.
        if (level === this.core.LOG_ERROR) this.handleCoreError(error);
        else if (level < 0 && window.console?.error) window.console.error(error);
      });
      this.core.reportFPS = (fps) => this.reportFPS(fps);
      this.database = new GBA.LocalDatabase();
      this.romLoaded = false;
      this.romInfo = null;
      this.romBuffer = null;
      this.fastForward = true;
      this.fastForwardMultiplier = FAST_FORWARD_MULTIPLIER;
      this.fps = 0;
      this.cheats = [];
      this.keyMask = 0;
      this.lastError = null;
      this.saveDirty = false;
      this.channelMuted = [false, false, false, false, false, false];
      this.core.audio.channelMuted = this.channelMuted;
      this.originalStoreSavedata = this.core.storeSavedata.bind(this.core);
      this.core.storeSavedata = () => {
        this.saveDirty = true;
        this.flushSave();
      };
      this.apu = {
        enabled: true,
        resume: () => this.resumeAudio(),
        setVolume: (value) => this.setVolume(value),
        setChannelMuted: (channel, muted) => this.setChannelMuted(channel, muted)
      };
      this.core.audio.masterEnable = true;
      this.configureAudioSpeed();
      this.memory = {};
      Object.defineProperties(this.memory, {
        dirtySave: {
          get: () => this.saveDirty || Boolean(this.core.mmu.saveNeedsFlush?.()),
          set: (value) => { this.saveDirty = Boolean(value); }
        },
        save: {
          get: () => this.getSaveBytes()
        },
        saveType: {
          get: () => this.core.mmu.cart?.saveType || "SRAM"
        }
      });
    }

    get paused() {
      return this.core.paused;
    }

    get running() {
      return this.romLoaded && !this.core.paused;
    }

    isNormalSpeedGame(info = this.romInfo) {
      if (!info) return false;
      const code = String(info.code || "").toUpperCase();
      const name = `${info.title || ""} ${info.filename || ""}`;
      return NORMAL_SPEED_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))
        || NORMAL_SPEED_NAME_PATTERN.test(name);
    }

    getSpeedMultiplier() {
      return this.isNormalSpeedGame() ? 1 : this.fastForwardMultiplier;
    }

    applyGameSpeed(resetAudio = false) {
      const speed = this.getSpeedMultiplier();
      this.fastForward = speed > 1;
      this.core.throttle = 16;
      this.core.framesPerTick = speed;
      this.configureAudioSpeed(resetAudio);
      return speed;
    }

    handleCoreError(error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.core.pause();
      this.dispatchEvent(new CustomEvent("error", { detail: this.lastError }));
    }

    hashROM(bytes) {
      let hash = 2166136261;
      const stride = Math.max(1, Math.floor(bytes.length / 262144));
      for (let i = 0; i < bytes.length; i += stride) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 16777619);
      }
      hash ^= bytes.length;
      return (hash >>> 0).toString(16).padStart(8, "0");
    }

    parseROM(bytes, filename) {
      const decoder = new TextDecoder("ascii");
      const clean = (start, length) => decoder.decode(bytes.slice(start, start + length)).replace(/[\0\ufffd]/g, "").trim();
      return {
        id: this.hashROM(bytes),
        title: clean(0xa0, 12) || filename.replace(/\.gba$/i, "") || "CARTUCHO SEM TÍTULO",
        code: clean(0xac, 4) || "----",
        maker: clean(0xb0, 2) || "--",
        filename,
        size: bytes.length,
        loadedAt: Date.now(),
        engine: "GBA.js"
      };
    }

    async loadROM(source, filename = "cartucho.gba", persist = true) {
      this.pause();
      if (this.romLoaded) await this.flushSave();
      const bytes = source instanceof Uint8Array ? new Uint8Array(source) : new Uint8Array(source);
      if (!bytes.length || bytes.length > 0x2000000) throw new Error("ROM inválida ou maior que 32 MB.");
      const rom = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      this.romInfo = this.parseROM(bytes, filename);
      this.romBuffer = rom.slice(0);
      this.lastError = null;
      if (!this.core.setRom(rom)) throw new Error("O cabeçalho do cartucho é inválido.");
      const speed = this.applyGameSpeed(true);
      this.romLoaded = true;
      this.keyMask = 0;
      this.core.keypad.currentDown = 0x03ff;
      const storedSave = await this.database.get("saves", this.romInfo.id).catch(() => null);
      if (storedSave?.data) {
        try {
          this.core.setSavedata(storedSave.data.slice(0));
        } catch (_) {
          // Saves antigos ou com tamanho incompatível não impedem o boot.
        }
      }
      if (persist) {
        await this.database.put("games", {
          ...this.romInfo,
          rom: this.romBuffer.slice(0),
          thumbnail: null
        }).catch(() => {});
      }
      this.dispatchEvent(new CustomEvent("romloaded", { detail: this.romInfo }));
      this.dispatchEvent(new CustomEvent("speedchange", { detail: speed }));
      this.start();
      return this.romInfo;
    }

    async loadStoredROM(id) {
      const game = await this.database.get("games", id);
      if (!game?.rom) throw new Error("O cartucho salvo não está mais disponível.");
      return this.loadROM(game.rom, game.filename, false);
    }

    reset() {
      if (!this.romBuffer) return;
      this.pause();
      const savedata = this.getSaveBytes().slice().buffer;
      if (!this.core.setRom(this.romBuffer.slice(0))) throw new Error("Não foi possível reiniciar o cartucho.");
      this.applyGameSpeed(true);
      if (savedata.byteLength) this.core.setSavedata(savedata);
      this.core.keypad.currentDown = 0x03ff;
      this.start();
      this.dispatchEvent(new Event("reset"));
    }

    start() {
      if (!this.romLoaded || !this.core.paused && this.core.queue) return;
      this.resumeAudio();
      this.applyGameSpeed();
      this.core.runStable();
      this.dispatchEvent(new Event("resume"));
    }

    pause() {
      if (this.core) this.core.pause();
      this.dispatchEvent(new Event("pause"));
    }

    stop() {
      this.pause();
      this.flushSave();
      this.dispatchEvent(new Event("stop"));
    }

    resumeAudio() {
      const audio = this.core.audio;
      const context = audio.context;
      this.apu.enabled = true;
      audio.masterEnable = !this.channelMuted.every(Boolean);
      this.configureAudioSpeed();
      if (context?.state === "suspended") return context.resume().catch(() => {});
      return Promise.resolve();
    }

    configureAudioSpeed(reset = false) {
      const audio = this.core.audio;
      if (!audio?.context || !audio.sampleRate) return;
      const outputRate = Number(audio.context.sampleRate) || 48000;
      const speed = this.getSpeedMultiplier();
      audio.resampleRatio = audio.sampleRate / outputRate;
      // Compress the 2x stream in short, overlapping grains.  This keeps the
      // original pitch without the audible hard cuts made by the former
      // lowLatencyAudio queue trimmer.
      audio.playbackRate = speed;
      audio.preservePitch = speed > 1;
      audio.keepOriginalTempo = speed > 1;
      audio.lowLatencyAudio = false;
      if (reset) audio.pitchState = null;
    }

    setVolume(value) {
      this.core.audio.masterVolume = Math.max(0, Math.min(1, Number(value) || 0));
    }

    setChannelMuted(channel, muted) {
      this.channelMuted[channel] = Boolean(muted);
      this.core.audio.masterEnable = !this.channelMuted.every(Boolean) && this.apu.enabled;
    }

    setFastForward() {
      this.apu.enabled = true;
      this.core.audio.masterEnable = !this.channelMuted.every(Boolean);
      const speed = this.applyGameSpeed();
      this.dispatchEvent(new CustomEvent("speedchange", { detail: speed }));
      return speed;
    }

    reportFPS(fps) {
      this.fps = Math.round(fps);
      this.applyCheats();
      this.dispatchEvent(new CustomEvent("fps", { detail: this.fps }));
    }

    pressKey(name) {
      const bit = KEY_BITS[name];
      if (bit === undefined) return;
      this.keyMask |= 1 << bit;
      this.core.keypad.currentDown = (~this.keyMask) & 0x03ff;
    }

    releaseKey(name) {
      const bit = KEY_BITS[name];
      if (bit === undefined) return;
      this.keyMask &= ~(1 << bit);
      this.core.keypad.currentDown = (~this.keyMask) & 0x03ff;
    }

    releaseAllKeys() {
      this.keyMask = 0;
      this.core.keypad.currentDown = 0x03ff;
    }

    addCheat(code) {
      const normalized = code.toUpperCase().replace(/[^0-9A-F]/g, "");
      if (normalized.length !== 12 && normalized.length !== 16) throw new Error("Use 12 ou 16 dígitos hexadecimais.");
      const address = parseInt(normalized.slice(0, 8), 16) >>> 0;
      const value = parseInt(normalized.slice(8), 16) >>> 0;
      const cheat = { code: normalized, address, value, size: normalized.length === 12 ? 2 : 4, enabled: true };
      this.cheats.push(cheat);
      return cheat;
    }

    removeCheat(index) {
      this.cheats.splice(index, 1);
    }

    applyCheats() {
      if (!this.romLoaded) return;
      for (const cheat of this.cheats) {
        if (!cheat.enabled) continue;
        if (cheat.size === 2) this.core.mmu.store16(cheat.address, cheat.value);
        else this.core.mmu.store32(cheat.address, cheat.value);
      }
    }

    captureState() {
      if (!this.romLoaded) throw new Error("Carregue um jogo primeiro.");
      return {
        version: 2,
        engine: "gbajs",
        romId: this.romInfo.id,
        timestamp: Date.now(),
        frost: this.core.freeze(),
        save: this.getSaveBytes().slice().buffer
      };
    }

    restoreState(state) {
      if (!state || state.version !== 2 || state.engine !== "gbajs") throw new Error("Estado incompatível com o núcleo atual.");
      if (!this.romInfo || state.romId !== this.romInfo.id) throw new Error("Este estado pertence a outro jogo.");
      // Input is UI-owned and is intentionally not part of the core snapshot.
      // Clear it on both sides of defrost so a held key can never leak from the
      // moment the state was saved (or from the menu used to restore it).
      this.releaseAllKeys();
      this.core.defrost(state.frost);
      this.releaseAllKeys();
      // Audio already queued belongs to the timeline from before the restore.
      // Drop it so loading a state cannot replay stale/corrupted fragments.
      const audio = this.core.audio;
      audio.outputPointer = audio.samplePointer;
      audio.bufferedSamples = 0;
      audio.pitchState = null;
      this.configureAudioSpeed(true);
      if (state.save?.byteLength) this.core.setSavedata(state.save.slice(0));
      this.core.video.drawCallback();
      this.dispatchEvent(new Event("staterestored"));
    }

    async saveState(slot) {
      const state = this.captureState();
      const id = `${this.romInfo.id}:${slot}`;
      await this.database.put("states", { id, romId: this.romInfo.id, slot, timestamp: state.timestamp, state });
      return state;
    }

    async loadState(slot) {
      if (!this.romInfo) throw new Error("Carregue um jogo primeiro.");
      const record = await this.database.get("states", `${this.romInfo.id}:${slot}`);
      if (!record) throw new Error("Este slot está vazio.");
      this.restoreState(record.state);
      return record;
    }

    async deleteState(slot) {
      if (this.romInfo) await this.database.delete("states", `${this.romInfo.id}:${slot}`);
    }

    async listStates() {
      if (!this.romInfo) return [];
      return (await this.database.getAll("states")).filter((state) => state.romId === this.romInfo.id && state.state?.version === 2);
    }

    getSaveBytes() {
      const save = this.core.mmu.save;
      if (!save?.buffer) return new Uint8Array(0);
      return new Uint8Array(save.buffer);
    }

    async flushSave() {
      if (!this.romInfo || !this.core.mmu.save?.buffer) return;
      if (!this.saveDirty && !this.core.mmu.saveNeedsFlush?.()) return;
      this.core.mmu.flushSave?.();
      const bytes = this.getSaveBytes();
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await this.database.put("saves", { id: this.romInfo.id, timestamp: Date.now(), type: this.memory.saveType, data }).catch(() => {});
      this.saveDirty = false;
    }

    importSave(buffer) {
      if (!this.romLoaded) throw new Error("Carregue um jogo antes de importar o save.");
      const bytes = new Uint8Array(buffer);
      if (![0x200, 0x2000, 0x8000, 0x10000, 0x20000].includes(bytes.length)) throw new Error("Tamanho de save não reconhecido.");
      this.core.setSavedata(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      this.saveDirty = true;
      this.flushSave();
    }

    exportSave() {
      if (!this.romLoaded || !this.core.mmu.save?.buffer) throw new Error("Nenhum save está disponível para este jogo.");
      return new Blob([this.getSaveBytes().slice()], { type: "application/octet-stream" });
    }

    screenshot() {
      return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
    }
  }

  GBA.KEY_BITS = KEY_BITS;
  GBA.Emulator = GBAJSAdapter;
})(window.GBA = window.GBA || {});
