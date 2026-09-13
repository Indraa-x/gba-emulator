"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const scripts = [
  "util.js", "core.js", "arm.js", "thumb.js", "mmu.js", "io.js", "audio.js",
  "video.js", "video/proxy.js", "video/software.js", "irq.js", "keypad.js",
  "sio.js", "savedata.js", "gpio.js", "gba.js"
];

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  ArrayBuffer,
  DataView,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Math,
  Date,
  Blob,
  TextDecoder,
  localStorage: {},
  navigator: {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.atob = (value) => Buffer.from(value, "base64").toString("binary");
sandbox.btoa = (value) => Buffer.from(value, "binary").toString("base64");
vm.createContext(sandbox);

for (const relativePath of scripts) {
  const filename = path.join(root, "vendor", "gbajs", "js", relativePath);
  vm.runInContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
}

const toArrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

function branch(from, to) {
  const displacement = (to - (from + 8)) >> 2;
  return (0xea000000 | (displacement & 0x00ffffff)) >>> 0;
}

function makeMirroredExecutionROM(size, target, title) {
  const rom = Buffer.alloc(size);
  rom.writeUInt32LE(branch(0x08000000, target), 0);
  rom.write(title.slice(0, 12).padEnd(12, "\0"), 0xa0, "ascii");
  rom.write("TST0", 0xac, "ascii");
  rom[0xb2] = 0x96;
  rom.write("SRAM_V", 0xe4, "ascii");
  rom.writeUInt32LE(0xeafffffe, target & (size - 1));
  return rom;
}

function createCore() {
  const gba = new sandbox.GameBoyAdvance();
  const context2d = {
    createImageData(width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData() {}
  };
  gba.setCanvasDirect({ getContext: () => context2d });
  gba.setBios(toArrayBuffer(fs.readFileSync(path.join(root, "vendor", "gbajs", "resources", "bios.bin"))), false);
  return gba;
}

function runMirroredFetch(size, target) {
  const gba = createCore();
  const rom = makeMirroredExecutionROM(size, target, `TEST ${size >> 20}M`);
  assert.equal(gba.setRom(toArrayBuffer(rom)), true);
  gba.cpu.resetCPU(0x08000000);
  gba.cpu.step();
  assert.doesNotThrow(() => gba.cpu.step(), `falha ao executar espelho de ROM de ${size >> 20} MiB em 0x${target.toString(16)}`);
  assert.equal(gba.cpu.pageRegion, target >>> 24);
  return gba;
}

// Reproduz exatamente o antigo accessPage(...)[128]: cartuchos de 16 MiB
// que saltam para 0x09000080 devem enxergar o espelho em 0x08000080.
const sixteen = runMirroredFetch(16 * 1024 * 1024, 0x09000080);
assert.equal(sixteen.mmu.memory[0x09], sixteen.mmu.memory[0x08]);

// Cartuchos menores também espelham dentro da janela de 16 MiB sem estourar
// os limites do DataView.
runMirroredFetch(4 * 1024 * 1024, 0x08400080);
runMirroredFetch(8 * 1024 * 1024, 0x08800080);

// Trocar de um cartucho pequeno para um grande precisa reconstruir as duas
// metades e descartar páginas compiladas do jogo anterior.
const switched = createCore();
const small = makeMirroredExecutionROM(4 * 1024 * 1024, 0x08400080, "SMALL GAME");
const large = makeMirroredExecutionROM(32 * 1024 * 1024, 0x09000080, "LARGE GAME");
large.writeUInt32LE(0xeafffffe, 0x01000080);
assert.equal(switched.setRom(toArrayBuffer(small)), true);
const oldLow = switched.mmu.memory[0x08];
assert.equal(switched.setRom(toArrayBuffer(large)), true);
assert.notEqual(switched.mmu.memory[0x08], oldLow);
assert.notEqual(switched.mmu.memory[0x09], switched.mmu.memory[0x08]);
switched.cpu.resetCPU(0x08000000);
switched.cpu.step();
assert.doesNotThrow(() => switched.cpu.step());
assert.equal(switched.cpu.pageRegion, 0x09);

assert.equal(createCore().setRom(new ArrayBuffer(8)), false, "arquivos pequenos não devem causar RangeError");

// STMDB sp!, {r0-r2, lr}, usado pelo handler de IRQ do FIFA 2006, deve
// reservar a pilha antes de gravar e nunca tocar nos endereços acima do SP.
const blockTransfer = createCore();
blockTransfer.reset();
const blockCpu = blockTransfer.cpu;
blockCpu.gprs[blockCpu.SP] = 0x03007eb0;
blockCpu.gprs[0] = 0x11111111;
blockCpu.gprs[1] = 0x22222222;
blockCpu.gprs[2] = 0x33333333;
blockCpu.gprs[blockCpu.LR] = 0x44444444;
blockCpu.compileArm(0xe92d4007)();
assert.equal(blockCpu.gprs[blockCpu.SP] >>> 0, 0x03007ea0);
assert.equal(blockCpu.mmu.load32(0x03007ea0) >>> 0, 0x11111111);
assert.equal(blockCpu.mmu.load32(0x03007ea4) >>> 0, 0x22222222);
assert.equal(blockCpu.mmu.load32(0x03007ea8) >>> 0, 0x33333333);
assert.equal(blockCpu.mmu.load32(0x03007eac) >>> 0, 0x44444444);
assert.equal(blockCpu.mmu.load32(0x03007eb4) >>> 0, 0);

// Um timer em cascata só pode avançar quando o timer anterior transborda.
// Antes desta regressão, Timer 1 disparava uma IRQ a cada instrução enquanto
// nextEvent era zero, inundando e corrompendo a pilha do FIFA 2006.
const cascade = createCore();
cascade.reset();
cascade.irq.timerSetReload(0, 0xff00);
cascade.irq.timerSetReload(1, 0xffff);
cascade.irq.timerWriteControl(0, 0x0080);
cascade.irq.timerWriteControl(1, 0x00c4);
cascade.cpu.cycles = 1;
cascade.irq.nextEvent = 0;
cascade.irq.updateTimers();
assert.equal(cascade.irq.interruptFlags & cascade.irq.MASK_TIMER1, 0, "Timer 1 disparou sem o Timer 0 transbordar");
cascade.cpu.cycles = cascade.irq.timers[0].nextEvent;
cascade.irq.nextEvent = cascade.cpu.cycles;
cascade.irq.updateTimers();
assert.equal(cascade.irq.interruptFlags & cascade.irq.MASK_TIMER1, cascade.irq.MASK_TIMER1, "Timer 1 não recebeu o transbordo em cascata");

console.log("PASS: espelhos de ROM, STM de pilha, timers em cascata, troca de jogo e cabeçalho");
