"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const romPath = path.join(root, "Pokemon - Emerald Version (USA, Europe).gba");
const biosPath = path.join(root, "vendor", "gbajs", "resources", "bios.bin");
const scripts = [
  "util.js", "core.js", "arm.js", "thumb.js", "mmu.js", "io.js", "audio.js",
  "video.js", "video/proxy.js", "video/software.js", "irq.js", "keypad.js",
  "sio.js", "savedata.js", "gpio.js", "gba.js"
];

assert.ok(fs.existsSync(romPath), "ROM de teste não encontrada na raiz do projeto");
assert.equal(fs.statSync(romPath).size, 16 * 1024 * 1024, "tamanho inesperado da ROM");

let lastFrame = null;
let frameCount = 0;
const context2d = {
  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  },
  putImageData(frame) {
    lastFrame = frame;
    frameCount++;
  }
};

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
const gba = new sandbox.GameBoyAdvance();
gba.setCanvasDirect({ getContext: () => context2d });
gba.setBios(toArrayBuffer(fs.readFileSync(biosPath)), false);
gba.logLevel = gba.LOG_ERROR;

const rom = fs.readFileSync(romPath);
assert.equal(gba.setRom(toArrayBuffer(rom)), true, "o núcleo rejeitou a ROM");
assert.equal(gba.mmu.cart.title, "POKEMON EMER", "título do cartucho incorreto");
assert.equal(gba.mmu.cart.code, "BPEE", "código do cartucho incorreto");
assert.equal(gba.mmu.cart.saveType, "FLASH1M_V", "tipo de save incorreto");

for (let frame = 0; frame < 360; frame++) gba.advanceFrame();
assert.ok(lastFrame, "nenhum quadro foi enviado ao canvas");
assert.ok(frameCount >= 350, `apenas ${frameCount} quadros foram desenhados`);

const colors = new Set();
for (let index = 0; index < lastFrame.data.length; index += 64) {
  colors.add(`${lastFrame.data[index]},${lastFrame.data[index + 1]},${lastFrame.data[index + 2]},${lastFrame.data[index + 3]}`);
}
assert.ok(colors.size >= 16, `a imagem parece vazia/preta: somente ${colors.size} cores amostradas`);

const frozen = gba.freeze();
assert.ok(frozen.video.renderPath.palette instanceof ArrayBuffer, "palette não foi serializada como ArrayBuffer");
assert.ok(frozen.video.renderPath.vram instanceof ArrayBuffer, "VRAM não foi serializada como ArrayBuffer");
assert.ok(frozen.video.renderPath.oam instanceof ArrayBuffer, "OAM não foi serializada como ArrayBuffer");
gba.defrost(frozen);
gba.advanceFrame();
assert.ok(frameCount >= 351, "a execução não continuou depois de restaurar o estado");

const audio = gba.audio;
audio.buffers = [new Float32Array(4), new Float32Array(4)];
audio.sampleMask = 3;
audio.samplePointer = 0;
audio.masterVolume = 1;
audio.soundRatio = 1;
audio.enabledLeft = 1;
audio.enabledRight = 1;
audio.squareChannels[0].playing = true;
audio.squareChannels[0].sample = 1;
audio.squareChannels[1].playing = false;
audio.playingChannel3 = false;
audio.playingChannel4 = false;
audio.enableChannelA = false;
audio.enableChannelB = false;
audio.channelMuted = [false, false, false, false, false, false];
audio.sample();
assert.notEqual(audio.buffers[0][0], 0, "canal ativo não produziu amostra");
audio.samplePointer = 0;
audio.buffers[0][0] = 0;
audio.channelMuted[0] = true;
audio.sample();
assert.equal(audio.buffers[0][0], 0, "mute individual não silenciou o canal");

console.log(`PASS: Pokémon Emerald (${gba.mmu.cart.code}), ${frameCount} quadros, ${colors.size} cores, save ${gba.mmu.cart.saveType}`);
