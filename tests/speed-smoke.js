"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scheduled = [];
function Component() {}
function AudioComponent() { this.pause = () => {}; }
function KeypadComponent() { this.registerHandlers = () => {}; }

const sandbox = {
  console,
  Date,
  Math,
  clearTimeout: () => {},
  setTimeout(callback) {
    scheduled.push(callback);
    return scheduled.length;
  },
  ARMCore: Component,
  GameBoyAdvanceMMU: Component,
  GameBoyAdvanceInterruptHandler: Component,
  GameBoyAdvanceIO: Component,
  GameBoyAdvanceAudio: AudioComponent,
  GameBoyAdvanceVideo: Component,
  GameBoyAdvanceKeypad: KeypadComponent,
  GameBoyAdvanceSIO: Component,
  window: null
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "..", "vendor", "gbajs", "js", "gba.js"), "utf8"),
  sandbox
);

function framesInOneTick(multiplier) {
  scheduled.length = 0;
  const core = new sandbox.GameBoyAdvance();
  let frames = 0;
  core.advanceFrame = () => { frames++; };
  core.framesPerTick = multiplier;
  core.reportFPS = null;
  core.runStable();
  assert.equal(scheduled.length, 1, "loop não foi agendado");
  scheduled.shift()();
  core.pause();
  return frames;
}

assert.equal(framesInOneTick(1), 1, "velocidade normal não executou um quadro");
assert.equal(framesInOneTick(2), 2, "avanço rápido não executou exatamente dois quadros");
assert.equal(framesInOneTick(0), 1, "multiplicador inválido não voltou para 1×");

class FakeCore {
  constructor() {
    this.paused = true;
    this.queue = null;
    this.audio = { context: null, masterEnable: true, masterVolume: 1 };
    this.mmu = { saveNeedsFlush: () => false };
    this.keypad = { currentDown: 0x03ff };
    this.video = {};
  }
  setCanvasDirect() {}
  setBios() {}
  setLogger() {}
  storeSavedata() {}
  pause() { this.paused = true; this.queue = null; }
  runStable() { this.paused = false; this.queue = 1; }
}

const adapterSandbox = {
  console,
  ArrayBuffer,
  Blob,
  CustomEvent,
  Event,
  EventTarget,
  TextDecoder,
  Uint8Array,
  atob: (value) => Buffer.from(value, "base64").toString("binary"),
  window: {
    GameBoyAdvance: FakeCore,
    GBA: { LocalDatabase: class {} }
  }
};
vm.createContext(adapterSandbox);
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "..", "js", "gbajs-adapter.js"), "utf8"),
  adapterSandbox
);
const emulator = new adapterSandbox.window.GBA.Emulator({});
assert.equal(emulator.fastForward, true, "o emulador não iniciou em 2×");
assert.equal(emulator.fastForwardMultiplier, 2, "multiplicador padrão diferente de 2×");
assert.equal(emulator.apu.enabled, true, "áudio foi desativado na velocidade fixa");
assert.equal(emulator.core.audio.masterEnable, true, "mixer iniciou silenciado");
let resumeCalls = 0;
emulator.core.audio.context = {
  sampleRate: 48000,
  state: "suspended",
  resume() { resumeCalls++; return Promise.resolve(); }
};
emulator.core.audio.sampleRate = 32768;
emulator.romLoaded = true;
emulator.start();
assert.equal(emulator.core.framesPerTick, 2, "início da ROM não aplicou 2×");
assert.equal(resumeCalls, 1, "contexto de áudio bloqueado não foi retomado");
assert.equal(emulator.core.audio.resampleRatio, 32768 / 48000, "áudio não manteve a taxa original");
assert.equal(emulator.core.audio.playbackRate, 2, "fluxo de áudio não acompanha o jogo em 2×");
assert.equal(emulator.core.audio.preservePitch, true, "tom original não foi preservado");
assert.equal(emulator.core.audio.keepOriginalTempo, true, "compressão temporal não foi ativada");
assert.equal(emulator.core.audio.lowLatencyAudio, false, "cortador de blocos defeituoso ainda está ativo");
emulator.setFastForward(false);
assert.equal(emulator.fastForward, true, "foi possível desativar a velocidade fixa");
assert.equal(emulator.core.framesPerTick, 2, "a velocidade saiu de 2×");
assert.equal(emulator.apu.enabled, true, "alterar velocidade silenciou o jogo");

emulator.romInfo = { code: "BZMP", title: "ZELDA MC", filename: "The Minish Cap.gba" };
assert.equal(emulator.setFastForward(true), 1, "Zelda não foi limitado à velocidade normal");
assert.equal(emulator.fastForward, false, "Zelda ainda aparece como avanço rápido");
assert.equal(emulator.core.framesPerTick, 1, "Zelda ainda executa dois quadros por ciclo");
assert.equal(emulator.core.audio.playbackRate, 1, "áudio de Zelda ainda está acelerado");
assert.equal(emulator.core.audio.preservePitch, false, "Zelda ativou compressão temporal desnecessária");
assert.equal(emulator.core.audio.keepOriginalTempo, false, "Zelda manteve o processador de áudio de 2×");

emulator.romInfo = { code: "AA2E", title: "SUPER MARIO2", filename: "Super Mario Advance 2.gba" };
assert.equal(emulator.setFastForward(true), 1, "Mario não foi limitado à velocidade normal");
assert.equal(emulator.core.framesPerTick, 1, "Mario ainda executa dois quadros por ciclo");
assert.equal(emulator.core.audio.playbackRate, 1, "áudio de Mario ainda está acelerado");

emulator.romInfo = { code: "BPEE", title: "POKEMON EMER", filename: "Pokemon Emerald.gba" };
assert.equal(emulator.setFastForward(false), 2, "Pokémon deixou de usar a velocidade fixa em 2×");
assert.equal(emulator.fastForward, true, "Pokémon não voltou ao avanço rápido fixo");
assert.equal(emulator.core.framesPerTick, 2, "Pokémon não voltou a executar dois quadros por ciclo");
assert.equal(emulator.core.audio.playbackRate, 2, "áudio de Pokémon não acompanha os 2×");
assert.equal(emulator.core.audio.preservePitch, true, "tom original de Pokémon não foi preservado em 2×");

const audioSandbox = { window: {}, Math, Number, Float32Array };
vm.createContext(audioSandbox);
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "..", "vendor", "gbajs", "js", "audio.js"), "utf8"),
  audioSandbox
);
const delayedAudio = Object.create(audioSandbox.GameBoyAdvanceAudio.prototype);
delayedAudio.bufferSize = 1024;
delayedAudio.maxSamples = 16384;
delayedAudio.maxBufferedSamples = 1 << 23;
delayedAudio.sampleMask = delayedAudio.maxSamples - 1;
delayedAudio.buffers = [new Float32Array(delayedAudio.maxSamples), new Float32Array(delayedAudio.maxSamples)];
for (let index = 0; index < delayedAudio.maxSamples; index++) {
  const sample = Math.sin(index * Math.PI * 2 / 64) * .5;
  delayedAudio.buffers[0][index] = sample;
  delayedAudio.buffers[1][index] = sample;
}
delayedAudio.samplePointer = 12000;
delayedAudio.outputPointer = 0;
delayedAudio.bufferedSamples = 12000;
delayedAudio.resampleRatio = 32768 / 48000;
delayedAudio.playbackRate = 2;
delayedAudio.preservePitch = true;
delayedAudio.lowLatencyAudio = false;
delayedAudio.pitchState = null;
delayedAudio.masterEnable = true;
delayedAudio.backup = 0;
delayedAudio.totalSamples = 0;
const outputLeft = new Float32Array(1024);
const outputRight = new Float32Array(1024);
delayedAudio.audioProcess({
  outputBuffer: {
    getChannelData(channel) { return channel === 0 ? outputLeft : outputRight; }
  }
});
const zeroCrossings = outputLeft.reduce((count, sample, index) => (
  index > 0 && outputLeft[index - 1] <= 0 && sample > 0 ? count + 1 : count
), 0);
assert.ok(outputLeft.some((sample) => Math.abs(sample) > .01), "processador com tom original gerou silêncio");
assert.ok(zeroCrossings >= 8 && zeroCrossings <= 14, `tom saiu da faixa original (${zeroCrossings} ciclos)`);
assert.ok(delayedAudio.outputPointer > 7000, "áudio não recuperou uma fila atrasada");
assert.ok(delayedAudio.bufferedSamples < 900, "fila de áudio manteve atraso excessivo");

const emptyFifoAudio = Object.create(audioSandbox.GameBoyAdvanceAudio.prototype);
emptyFifoAudio.fifoA = [];
emptyFifoAudio.fifoB = [];
emptyFifoAudio.dmaA = 0;
emptyFifoAudio.dmaB = 1;
emptyFifoAudio.core = { irq: { dma: [{}, {}] }, mmu: { serviceDma() {} } };
emptyFifoAudio.sampleFifoA();
emptyFifoAudio.sampleFifoB();
assert.equal(emptyFifoAudio.fifoASample, 0, "FIFO A vazia gerou uma amostra inválida");
assert.equal(emptyFifoAudio.fifoBSample, 0, "FIFO B vazia gerou uma amostra inválida");

const growingAudio = Object.create(audioSandbox.GameBoyAdvanceAudio.prototype);
growingAudio.bufferSize = 4;
growingAudio.maxSamples = 16;
growingAudio.maxBufferedSamples = 64;
growingAudio.sampleMask = 15;
growingAudio.buffers = [new Float32Array(16), new Float32Array(16)];
for (let index = 0; index < 16; index++) growingAudio.buffers[0][index] = index;
growingAudio.outputPointer = 4.5;
growingAudio.samplePointer = 3;
growingAudio.bufferedSamples = 14;
growingAudio.growAudioBuffer();
assert.equal(growingAudio.maxSamples, 32, "fila de áudio não aumentou de tamanho");
assert.equal(growingAudio.outputPointer, .5, "posição fracionária do áudio foi perdida ao ampliar a fila");
assert.equal(growingAudio.buffers[0][0], 4, "áudio pendente não foi preservado ao ampliar a fila");

console.log("PASS: Pokémon permanece em 2×; Zelda e Mario ficam em 1× com áudio normal");
