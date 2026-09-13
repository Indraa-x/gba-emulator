(function (GBA) {
  "use strict";

  const IRQ = Object.freeze({
    VBLANK: 1 << 0,
    HBLANK: 1 << 1,
    VCOUNT: 1 << 2,
    TIMER0: 1 << 3,
    TIMER1: 1 << 4,
    TIMER2: 1 << 5,
    TIMER3: 1 << 6,
    SERIAL: 1 << 7,
    DMA0: 1 << 8,
    DMA1: 1 << 9,
    DMA2: 1 << 10,
    DMA3: 1 << 11,
    KEYPAD: 1 << 12,
    GAMEPAK: 1 << 13
  });

  class InterruptController {
    constructor() {
      this.reset();
    }

    reset() {
      this.ie = 0;
      this.if = 0;
      this.ime = 0;
      this.halted = false;
    }

    request(mask) {
      this.if = (this.if | mask) & 0x3fff;
      if (this.pending()) this.halted = false;
    }

    acknowledge(mask) {
      this.if &= ~mask;
    }

    pending() {
      return Boolean(this.ime & 1) && Boolean(this.ie & this.if);
    }

    serialize() {
      return { ie: this.ie, if: this.if, ime: this.ime, halted: this.halted };
    }

    deserialize(state) {
      this.ie = state.ie >>> 0;
      this.if = state.if >>> 0;
      this.ime = state.ime >>> 0;
      this.halted = Boolean(state.halted);
    }
  }

  GBA.IRQ = IRQ;
  GBA.InterruptController = InterruptController;
})(window.GBA = window.GBA || {});
