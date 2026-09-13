"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const romPath = path.join(root, "Pokemon - Emerald Version (USA, Europe).gba");
const biosPath = path.join(root, "vendor", "gbajs", "resources", "bios.bin");
const outputPath = path.join(__dirname, "pokemon-cover.png");
const scripts = [
  "util.js", "core.js", "arm.js", "thumb.js", "mmu.js", "io.js", "audio.js",
  "video.js", "video/proxy.js", "video/software.js", "irq.js", "keypad.js",
  "sio.js", "savedata.js", "gpio.js", "gba.js"
];

let frameImage = null;
const context2d = {
  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  },
  putImageData(image) {
    frameImage = image;
  }
};

const sandbox = {
  console, setTimeout, clearTimeout, ArrayBuffer, DataView, Uint8Array, Uint8ClampedArray,
  Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Math, Date,
  Blob, TextDecoder, localStorage: {}, navigator: {}
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePNG(image) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = image.width * 4;
  const scanlines = Buffer.alloc((stride + 1) * image.height);
  for (let row = 0; row < image.height; row++) {
    const outputOffset = row * (stride + 1);
    scanlines[outputOffset] = 0;
    Buffer.from(image.data.buffer, image.data.byteOffset + row * stride, stride).copy(scanlines, outputOffset + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const toArrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const gba = new sandbox.GameBoyAdvance();
gba.setCanvasDirect({ getContext: () => context2d });
gba.setBios(toArrayBuffer(fs.readFileSync(biosPath)), false);
gba.logLevel = gba.LOG_ERROR;
if (!gba.setRom(toArrayBuffer(fs.readFileSync(romPath)))) throw new Error("A ROM foi rejeitada pelo emulador.");
for (let frame = 0; frame < 1800; frame++) gba.advanceFrame();
if (!frameImage) throw new Error("Nenhum quadro foi renderizado.");
fs.writeFileSync(outputPath, encodePNG(frameImage));
console.log(`PASS: capa limpa criada em ${path.relative(root, outputPath)} (${frameImage.width}x${frameImage.height})`);
