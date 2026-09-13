(function (GBA) {
  "use strict";

  const CPU_FREQUENCY = 16777216;
  const FRAME_RATE = 59.7275;
  const CYCLES_PER_FRAME = Math.round(CPU_FREQUENCY / FRAME_RATE);
  const KEY_BITS = Object.freeze({ A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9 });

  class LocalDatabase {
    constructor() {
      this.name = "advance-lab";
      this.version = 1;
      this.promise = null;
    }

    open() {
      if (this.promise) return this.promise;
      this.promise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.name, this.version);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("games")) db.createObjectStore("games", { keyPath: "id" });
          if (!db.objectStoreNames.contains("states")) db.createObjectStore("states", { keyPath: "id" });
          if (!db.objectStoreNames.contains("saves")) db.createObjectStore("saves", { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return this.promise;
    }

    async put(store, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(store, "readwrite").objectStore(store).put(value);
        request.onsuccess = () => resolve(value);
        request.onerror = () => reject(request.error);
      });
    }

    async get(store, id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(store, "readonly").objectStore(store).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    async getAll(store) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(store, "readonly").objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    }

    async delete(store, id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(store, "readwrite").objectStore(store).delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    async clear(store) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(store, "readwrite").objectStore(store).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }

  class Emulator extends EventTarget {
    constructor(canvas) {
      super();
      this.canvas = canvas;
      this.interrupts = new GBA.InterruptController();
      this.io = new GBA.IORegisters(this.interrupts);
      this.memory = new GBA.Memory(this.io);
      this.apu = new GBA.APU(this.io);
      this.timers = new GBA.Timers(this.io, this.interrupts, this.apu);
      this.dma = new GBA.DMAController(this.memory, this.io, this.interrupts);
      this.ppu = new GBA.PPU(this.memory, this.io, this.interrupts, this.dma, canvas);
      this.cpu = new GBA.ARM7TDMI(this.memory, this.interrupts);
      this.database = new LocalDatabase();
      this.io.connect("apu", this.apu);
      this.io.connect("timers", this.timers);
      this.io.connect("dma", this.dma);
      this.running = false;
      this.paused = true;
      this.fastForward = false;
      this.romLoaded = false;
      this.romInfo = null;
      this.keyMask = 0;
      this.cheats = [];
      this.animationFrame = 0;
      this.lastFrameTime = 0;
      this.fps = 0;
      this.framesThisSecond = 0;
      this.fpsClock = performance.now();
      this.autoSaveClock = performance.now();
      this.boundLoop = (time) => this.loop(time);
      this.ppu.reset();
      this.renderIdleScreen();
    }

    renderIdleScreen() {
      const context = this.canvas.getContext("2d");
      const gradient = context.createLinearGradient(0, 0, 240, 160);
      gradient.addColorStop(0, "#111923");
      gradient.addColorStop(1, "#080c12");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 240, 160);
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
        loadedAt: Date.now()
      };
    }

    async loadROM(source, filename = "cartucho.gba", persist = true) {
      const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
      this.pause();
      this.memory.loadROM(bytes);
      this.romInfo = this.parseROM(bytes, filename);
      this.reset();
      this.romLoaded = true;
      const storedSave = await this.database.get("saves", this.romInfo.id).catch(() => null);
      if (storedSave && storedSave.data) {
        const restored = new Uint8Array(storedSave.data);
        this.memory.save.set(restored.subarray(0, this.memory.save.length));
      }
      if (persist) {
        await this.database.put("games", {
          ...this.romInfo,
          rom: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          thumbnail: null
        }).catch(() => {});
      }
      this.dispatchEvent(new CustomEvent("romloaded", { detail: this.romInfo }));
      this.start();
      return this.romInfo;
    }

    async loadStoredROM(id) {
      const game = await this.database.get("games", id);
      if (!game || !game.rom) throw new Error("O cartucho salvo não está mais disponível.");
      return this.loadROM(game.rom, game.filename, false);
    }

    reset() {
      this.interrupts.reset();
      this.io.reset();
      this.memory.reset(false);
      this.apu.reset();
      this.timers.reset();
      this.dma.reset();
      this.ppu.reset();
      this.cpu.reset(false);
      this.io.setKeys(this.keyMask);
      this.dispatchEvent(new Event("reset"));
    }

    start() {
      if (!this.romLoaded) return;
      this.apu.resume();
      this.paused = false;
      if (!this.running) {
        this.running = true;
        this.lastFrameTime = performance.now();
        this.animationFrame = requestAnimationFrame(this.boundLoop);
      }
      this.dispatchEvent(new Event("resume"));
    }

    pause() {
      this.paused = true;
      this.dispatchEvent(new Event("pause"));
    }

    stop() {
      this.paused = true;
      this.running = false;
      cancelAnimationFrame(this.animationFrame);
      this.flushSave();
      this.dispatchEvent(new Event("stop"));
    }

    setFastForward(enabled) {
      this.fastForward = Boolean(enabled);
      this.apu.enabled = true;
      this.dispatchEvent(new CustomEvent("speedchange", { detail: this.fastForward ? 2 : 1 }));
    }

    loop(timestamp) {
      if (!this.running) return;
      if (!this.paused) {
        const frames = this.fastForward ? 2 : 1;
        for (let i = 0; i < frames; i++) this.runFrame();
        this.framesThisSecond++;
        if (timestamp - this.fpsClock >= 1000) {
          this.fps = Math.round(this.framesThisSecond * 1000 / (timestamp - this.fpsClock));
          this.framesThisSecond = 0;
          this.fpsClock = timestamp;
          this.dispatchEvent(new CustomEvent("fps", { detail: this.fps }));
        }
        if (timestamp - this.autoSaveClock > 3000 && this.memory.dirtySave) {
          this.flushSave();
          this.autoSaveClock = timestamp;
        }
      }
      this.lastFrameTime = timestamp;
      this.animationFrame = requestAnimationFrame(this.boundLoop);
    }

    runFrame() {
      let cycles = 0;
      let guard = 0;
      while (cycles < CYCLES_PER_FRAME && guard++ < 350000) {
        const used = this.cpu.step();
        this.timers.tick(used);
        this.ppu.tick(used);
        cycles += used;
      }
      this.applyCheats();
    }

    pressKey(name) {
      const bit = KEY_BITS[name];
      if (bit === undefined) return;
      this.keyMask |= 1 << bit;
      this.io.setKeys(this.keyMask);
    }

    releaseKey(name) {
      const bit = KEY_BITS[name];
      if (bit === undefined) return;
      this.keyMask &= ~(1 << bit);
      this.io.setKeys(this.keyMask);
    }

    releaseAllKeys() {
      this.keyMask = 0;
      this.io.setKeys(0);
    }

    addCheat(code) {
      const normalized = code.toUpperCase().replace(/[^0-9A-F]/g, "");
      if (normalized.length !== 12 && normalized.length !== 16) throw new Error("Use 12 ou 16 dígitos hexadecimais.");
      const addressLength = normalized.length === 12 ? 8 : 8;
      const address = parseInt(normalized.slice(0, addressLength), 16) >>> 0;
      const value = parseInt(normalized.slice(addressLength), 16) >>> 0;
      const size = normalized.length === 12 ? 2 : 4;
      this.cheats.push({ code: normalized, address, value, size, enabled: true });
      return this.cheats[this.cheats.length - 1];
    }

    removeCheat(index) {
      this.cheats.splice(index, 1);
    }

    applyCheats() {
      for (const cheat of this.cheats) {
        if (!cheat.enabled) continue;
        if (cheat.size === 2) this.memory.write16(cheat.address, cheat.value);
        else this.memory.write32(cheat.address, cheat.value);
      }
    }

    captureState() {
      if (!this.romLoaded) throw new Error("Carregue um jogo primeiro.");
      return {
        version: 1,
        romId: this.romInfo.id,
        timestamp: Date.now(),
        cpu: this.cpu.serialize(),
        memory: this.memory.serialize(),
        io: this.io.serialize(),
        interrupts: this.interrupts.serialize(),
        timers: this.timers.serialize(),
        dma: this.dma.serialize(),
        ppu: this.ppu.serialize(),
        apu: this.apu.serialize()
      };
    }

    restoreState(state) {
      if (!state || state.version !== 1) throw new Error("Estado incompatível.");
      if (!this.romInfo || state.romId !== this.romInfo.id) throw new Error("Este estado pertence a outro jogo.");
      this.memory.deserialize(state.memory);
      this.io.deserialize(state.io);
      this.interrupts.deserialize(state.interrupts);
      this.timers.deserialize(state.timers);
      this.dma.deserialize(state.dma);
      this.apu.deserialize(state.apu);
      this.cpu.deserialize(state.cpu);
      this.ppu.deserialize(state.ppu);
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
      if (!this.romInfo) return;
      await this.database.delete("states", `${this.romInfo.id}:${slot}`);
    }

    async listStates() {
      if (!this.romInfo) return [];
      return (await this.database.getAll("states")).filter((state) => state.romId === this.romInfo.id);
    }

    async flushSave() {
      if (!this.romInfo || !this.memory.dirtySave) return;
      const data = this.memory.save.buffer.slice(0);
      await this.database.put("saves", { id: this.romInfo.id, timestamp: Date.now(), type: this.memory.saveType, data }).catch(() => {});
      this.memory.dirtySave = false;
    }

    importSave(buffer) {
      if (!this.romLoaded) throw new Error("Carregue um jogo antes de importar o save.");
      const bytes = new Uint8Array(buffer);
      if (![0x200, 0x2000, 0x8000, 0x10000, 0x20000].includes(bytes.length)) throw new Error("Tamanho de save não reconhecido.");
      this.memory.save.fill(0xff);
      this.memory.save.set(bytes.subarray(0, this.memory.save.length));
      this.memory.dirtySave = true;
      this.flushSave();
    }

    exportSave() {
      if (!this.romLoaded) throw new Error("Carregue um jogo antes de exportar o save.");
      return new Blob([this.memory.save.slice()], { type: "application/octet-stream" });
    }

    screenshot() {
      return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
    }
  }

  GBA.CPU_FREQUENCY = CPU_FREQUENCY;
  GBA.FRAME_RATE = FRAME_RATE;
  GBA.KEY_BITS = KEY_BITS;
  GBA.LocalDatabase = LocalDatabase;
  GBA.Emulator = Emulator;
})(window.GBA = window.GBA || {});
