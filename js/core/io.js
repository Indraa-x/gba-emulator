(function (GBA) {
  "use strict";

  const REG = Object.freeze({
    DISPCNT: 0x000,
    DISPSTAT: 0x004,
    VCOUNT: 0x006,
    BG0CNT: 0x008,
    BG1CNT: 0x00a,
    BG2CNT: 0x00c,
    BG3CNT: 0x00e,
    BG0HOFS: 0x010,
    BG0VOFS: 0x012,
    BG1HOFS: 0x014,
    BG1VOFS: 0x016,
    BG2HOFS: 0x018,
    BG2VOFS: 0x01a,
    BG3HOFS: 0x01c,
    BG3VOFS: 0x01e,
    BG2PA: 0x020,
    BG2PB: 0x022,
    BG2PC: 0x024,
    BG2PD: 0x026,
    BG2X: 0x028,
    BG2Y: 0x02c,
    BG3PA: 0x030,
    BG3PB: 0x032,
    BG3PC: 0x034,
    BG3PD: 0x036,
    BG3X: 0x038,
    BG3Y: 0x03c,
    WININ: 0x048,
    WINOUT: 0x04a,
    MOSAIC: 0x04c,
    BLDCNT: 0x050,
    BLDALPHA: 0x052,
    BLDY: 0x054,
    SOUND1CNT_L: 0x060,
    SOUND1CNT_H: 0x062,
    SOUND1CNT_X: 0x064,
    SOUND2CNT_L: 0x068,
    SOUND2CNT_H: 0x06c,
    SOUND3CNT_L: 0x070,
    SOUND3CNT_H: 0x072,
    SOUND3CNT_X: 0x074,
    SOUND4CNT_L: 0x078,
    SOUND4CNT_H: 0x07c,
    SOUNDCNT_L: 0x080,
    SOUNDCNT_H: 0x082,
    SOUNDCNT_X: 0x084,
    SOUNDBIAS: 0x088,
    FIFO_A: 0x0a0,
    FIFO_B: 0x0a4,
    DMA0SAD: 0x0b0,
    DMA0DAD: 0x0b4,
    DMA0CNT_L: 0x0b8,
    DMA0CNT_H: 0x0ba,
    TM0CNT_L: 0x100,
    TM0CNT_H: 0x102,
    SIODATA32: 0x120,
    KEYINPUT: 0x130,
    KEYCNT: 0x132,
    IE: 0x200,
    IF: 0x202,
    WAITCNT: 0x204,
    IME: 0x208,
    POSTFLG: 0x300,
    HALTCNT: 0x301
  });

  class IORegisters {
    constructor(interrupts) {
      this.interrupts = interrupts;
      this.bytes = new Uint8Array(0x400);
      this.handlers = {};
      this.reset();
    }

    reset() {
      this.bytes.fill(0);
      this.keyInput = 0x03ff;
      // O BIOS entrega o hardware ao cartucho com o LCD em forced blank.
      // Vários jogos (incluindo Pokémon Emerald) dependem disso para aplicar
      // DISPSTAT imediatamente antes do primeiro VBlank.
      this.writeRaw16(REG.DISPCNT, 0x0080);
      this.writeRaw16(REG.KEYINPUT, this.keyInput);
      this.writeRaw16(REG.SOUNDBIAS, 0x0200);
      this.writeRaw16(REG.BG2PA, 0x0100);
      this.writeRaw16(REG.BG2PD, 0x0100);
      this.writeRaw16(REG.BG3PA, 0x0100);
      this.writeRaw16(REG.BG3PD, 0x0100);
    }

    connect(name, handler) {
      this.handlers[name] = handler;
    }

    read8(offset) {
      offset &= 0x3ff;
      if (offset === REG.KEYINPUT || offset === REG.KEYINPUT + 1) {
        this.writeRaw16(REG.KEYINPUT, this.keyInput);
      }
      if (offset === REG.IE || offset === REG.IE + 1) this.writeRaw16(REG.IE, this.interrupts.ie);
      if (offset === REG.IF || offset === REG.IF + 1) this.writeRaw16(REG.IF, this.interrupts.if);
      if (offset === REG.IME || offset === REG.IME + 1) this.writeRaw16(REG.IME, this.interrupts.ime);
      return this.bytes[offset];
    }

    read16(offset) {
      offset &= 0x3fe;
      return this.read8(offset) | (this.read8(offset + 1) << 8);
    }

    read32(offset) {
      offset &= 0x3fc;
      return (this.read16(offset) | (this.read16(offset + 2) << 16)) >>> 0;
    }

    writeRaw8(offset, value) {
      this.bytes[offset & 0x3ff] = value & 0xff;
    }

    writeRaw16(offset, value) {
      offset &= 0x3fe;
      this.bytes[offset] = value & 0xff;
      this.bytes[offset + 1] = (value >>> 8) & 0xff;
    }

    writeRaw32(offset, value) {
      this.writeRaw16(offset, value);
      this.writeRaw16(offset + 2, value >>> 16);
    }

    write8(offset, value) {
      offset &= 0x3ff;
      value &= 0xff;
      if (offset === REG.KEYINPUT || offset === REG.KEYINPUT + 1) return;
      if (offset === REG.HALTCNT) {
        this.interrupts.halted = true;
        return;
      }
      this.writeRaw8(offset, value);
      this.dispatch(offset & ~1, 1);
    }

    write16(offset, value) {
      offset &= 0x3fe;
      value &= 0xffff;
      if (offset === REG.KEYINPUT) return;
      if (offset === REG.IE) {
        this.interrupts.ie = value & 0x3fff;
        this.writeRaw16(offset, this.interrupts.ie);
        return;
      }
      if (offset === REG.IF) {
        this.interrupts.acknowledge(value);
        this.writeRaw16(offset, this.interrupts.if);
        return;
      }
      if (offset === REG.IME) {
        this.interrupts.ime = value & 1;
        this.writeRaw16(offset, this.interrupts.ime);
        return;
      }
      this.writeRaw16(offset, value);
      this.dispatch(offset, 2);
    }

    write32(offset, value) {
      offset &= 0x3fc;
      if (offset === REG.FIFO_A || offset === REG.FIFO_B) {
        this.writeRaw32(offset, value);
        this.dispatch(offset, 4);
        return;
      }
      this.write16(offset, value & 0xffff);
      this.write16(offset + 2, value >>> 16);
    }

    dispatch(offset, size) {
      if (offset >= 0x060 && offset <= 0x0a7 && this.handlers.apu) this.handlers.apu.onIOWrite(offset, size);
      if (offset >= 0x0b0 && offset <= 0x0df && this.handlers.dma) this.handlers.dma.onIOWrite(offset, size);
      if (offset >= 0x100 && offset <= 0x10f && this.handlers.timers) this.handlers.timers.onIOWrite(offset, size);
      if (offset === REG.KEYCNT && this.handlers.keypad) this.handlers.keypad();
    }

    setKeys(mask) {
      this.keyInput = (~mask) & 0x03ff;
      this.writeRaw16(REG.KEYINPUT, this.keyInput);
      const keyControl = this.read16(REG.KEYCNT);
      if (keyControl & 0x4000) {
        const wanted = keyControl & 0x03ff;
        const pressed = (~this.keyInput) & 0x03ff;
        const match = keyControl & 0x8000 ? (pressed & wanted) === wanted : Boolean(pressed & wanted);
        if (match) this.interrupts.request(GBA.IRQ.KEYPAD);
      }
    }

    serialize() {
      return { bytes: Array.from(this.bytes), keyInput: this.keyInput };
    }

    deserialize(state) {
      this.bytes.set(state.bytes);
      this.keyInput = state.keyInput;
    }
  }

  GBA.REG = REG;
  GBA.IORegisters = IORegisters;
})(window.GBA = window.GBA || {});
