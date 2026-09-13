(function (GBA) {
  "use strict";

  class APU {
    constructor(io) {
      this.io = io;
      this.context = null;
      this.node = null;
      this.gain = null;
      this.sampleRate = 48000;
      this.phase = [0, 0, 0, 0];
      this.noiseLfsr = 0x7fff;
      this.fifoA = [];
      this.fifoB = [];
      this.sampleA = 0;
      this.sampleB = 0;
      this.volume = 0.7;
      this.muted = [false, false, false, false, false, false];
      this.enabled = true;
    }

    init() {
      if (this.context) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.sampleRate = this.context.sampleRate;
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.node = this.context.createScriptProcessor(1024, 0, 2);
      this.node.onaudioprocess = (event) => this.process(event);
      this.node.connect(this.gain);
      this.gain.connect(this.context.destination);
    }

    resume() {
      this.init();
      if (this.context && this.context.state === "suspended") this.context.resume();
    }

    reset() {
      this.phase.fill(0);
      this.noiseLfsr = 0x7fff;
      this.fifoA.length = 0;
      this.fifoB.length = 0;
      this.sampleA = 0;
      this.sampleB = 0;
    }

    setVolume(value) {
      this.volume = Math.max(0, Math.min(1, value));
      if (this.gain) this.gain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.015);
    }

    setChannelMuted(channel, muted) {
      this.muted[channel] = Boolean(muted);
    }

    onIOWrite(offset) {
      if (offset >= GBA.REG.FIFO_A && offset < GBA.REG.FIFO_A + 4) this.pushFifo(this.fifoA, this.io.read32(GBA.REG.FIFO_A));
      if (offset >= GBA.REG.FIFO_B && offset < GBA.REG.FIFO_B + 4) this.pushFifo(this.fifoB, this.io.read32(GBA.REG.FIFO_B));
      if (offset === GBA.REG.SOUNDCNT_X && !(this.io.read16(GBA.REG.SOUNDCNT_X) & 0x80)) this.reset();
    }

    pushFifo(fifo, word) {
      if (fifo.length > 28) return;
      for (let i = 0; i < 4; i++) fifo.push((word >>> (i * 8)) & 0xff);
    }

    timerOverflow(timer) {
      const control = this.io.read16(GBA.REG.SOUNDCNT_H);
      if (((control >>> 10) & 1) === timer && this.fifoA.length) this.sampleA = (this.fifoA.shift() << 24) >> 24;
      if (((control >>> 14) & 1) === timer && this.fifoB.length) this.sampleB = (this.fifoB.shift() << 24) >> 24;
    }

    square(channel, frequencyRegister, duty, enabled) {
      if (!enabled || this.muted[channel]) return 0;
      const frequency = 131072 / Math.max(1, 2048 - frequencyRegister);
      this.phase[channel] = (this.phase[channel] + frequency / this.sampleRate) % 1;
      const ratios = [0.125, 0.25, 0.5, 0.75];
      return this.phase[channel] < ratios[duty] ? 1 : -1;
    }

    waveSample(enabled) {
      if (!enabled || this.muted[2]) return 0;
      const frequencyReg = this.io.read16(GBA.REG.SOUND3CNT_X) & 0x7ff;
      const frequency = 2097152 / Math.max(1, 2048 - frequencyReg) / 32;
      this.phase[2] = (this.phase[2] + frequency / this.sampleRate) % 1;
      const position = Math.floor(this.phase[2] * 32) & 31;
      const packed = this.io.bytes[0x090 + (position >>> 1)];
      const sample = position & 1 ? packed & 15 : packed >>> 4;
      const volumeCode = (this.io.read16(GBA.REG.SOUND3CNT_H) >>> 13) & 3;
      const scale = [0, 1, 0.5, 0.25][volumeCode];
      return ((sample / 7.5) - 1) * scale;
    }

    noiseSample(enabled) {
      if (!enabled || this.muted[3]) return 0;
      const reg = this.io.read16(GBA.REG.SOUND4CNT_H);
      const ratio = reg & 7;
      const shift = (reg >>> 4) & 15;
      const divisor = ratio ? ratio * 16 : 8;
      const frequency = 524288 / divisor / (1 << (shift + 1));
      this.phase[3] += frequency / this.sampleRate;
      if (this.phase[3] >= 1) {
        this.phase[3] -= 1;
        const bit = (this.noiseLfsr ^ (this.noiseLfsr >>> 1)) & 1;
        this.noiseLfsr = (this.noiseLfsr >>> 1) | (bit << 14);
        if (reg & 8) this.noiseLfsr = (this.noiseLfsr & ~0x40) | (bit << 6);
      }
      return (this.noiseLfsr & 1) ? -1 : 1;
    }

    process(event) {
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      const master = this.io.read16(GBA.REG.SOUNDCNT_X) & 0x80;
      const route = this.io.read16(GBA.REG.SOUNDCNT_L);
      const direct = this.io.read16(GBA.REG.SOUNDCNT_H);
      for (let i = 0; i < left.length; i++) {
        if (!master || !this.enabled) {
          left[i] = right[i] = 0;
          continue;
        }
        const s1h = this.io.read16(GBA.REG.SOUND1CNT_H);
        const s2l = this.io.read16(GBA.REG.SOUND2CNT_L);
        const c1 = this.square(0, this.io.read16(GBA.REG.SOUND1CNT_X) & 0x7ff, (s1h >>> 6) & 3, s1h & 0xf000) * ((s1h >>> 12) & 15) / 15;
        const c2 = this.square(1, this.io.read16(GBA.REG.SOUND2CNT_H) & 0x7ff, (s2l >>> 6) & 3, s2l & 0xf000) * ((s2l >>> 12) & 15) / 15;
        const c3 = this.waveSample(this.io.read16(GBA.REG.SOUND3CNT_L) & 0x80);
        const c4 = this.noiseSample(this.io.read16(GBA.REG.SOUND4CNT_L) & 0xf000) * ((this.io.read16(GBA.REG.SOUND4CNT_L) >>> 12) & 15) / 15;
        const psg = [c1, c2, c3, c4];
        let l = 0;
        let r = 0;
        for (let c = 0; c < 4; c++) {
          if (route & (1 << (8 + c))) l += psg[c];
          if (route & (1 << (12 + c))) r += psg[c];
        }
        l *= ((route >>> 4) & 7) / 28;
        r *= (route & 7) / 28;
        if (!this.muted[4]) {
          if (direct & 0x0200) l += this.sampleA / 256;
          if (direct & 0x0100) r += this.sampleA / 256;
        }
        if (!this.muted[5]) {
          if (direct & 0x2000) l += this.sampleB / 256;
          if (direct & 0x1000) r += this.sampleB / 256;
        }
        left[i] = Math.max(-1, Math.min(1, l));
        right[i] = Math.max(-1, Math.min(1, r));
      }
    }

    serialize() {
      return { phase: this.phase.slice(), noiseLfsr: this.noiseLfsr, fifoA: this.fifoA.slice(), fifoB: this.fifoB.slice(), sampleA: this.sampleA, sampleB: this.sampleB };
    }

    deserialize(state) {
      this.phase = state.phase.slice();
      this.noiseLfsr = state.noiseLfsr;
      this.fifoA = state.fifoA.slice();
      this.fifoB = state.fifoB.slice();
      this.sampleA = state.sampleA;
      this.sampleB = state.sampleB;
    }
  }

  GBA.APU = APU;
})(window.GBA = window.GBA || {});
