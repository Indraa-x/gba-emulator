(function (GBA) {
  "use strict";

  const PRESCALERS = [1, 64, 256, 1024];

  class Timers {
    constructor(io, interrupts, apu) {
      this.io = io;
      this.interrupts = interrupts;
      this.apu = apu;
      this.channels = Array.from({ length: 4 }, () => ({ reload: 0, counter: 0, control: 0, cycles: 0, enabled: false }));
    }

    reset() {
      for (const timer of this.channels) Object.assign(timer, { reload: 0, counter: 0, control: 0, cycles: 0, enabled: false });
    }

    onIOWrite(offset) {
      if (offset < 0x100 || offset > 0x10e) return;
      const index = (offset - 0x100) >> 2;
      const timer = this.channels[index];
      const base = 0x100 + index * 4;
      const control = this.io.read16(base + 2);
      const wasEnabled = timer.enabled;
      timer.reload = this.io.read16(base);
      timer.control = control;
      timer.enabled = Boolean(control & 0x80);
      if (timer.enabled && !wasEnabled) {
        timer.counter = timer.reload;
        timer.cycles = 0;
      }
    }

    tick(cycles) {
      let cascaded = false;
      for (let i = 0; i < 4; i++) {
        const timer = this.channels[i];
        if (!timer.enabled) {
          cascaded = false;
          continue;
        }
        let increments = 0;
        if (timer.control & 4) {
          increments = cascaded ? 1 : 0;
        } else {
          timer.cycles += cycles;
          const prescaler = PRESCALERS[timer.control & 3];
          increments = Math.floor(timer.cycles / prescaler);
          timer.cycles %= prescaler;
        }
        cascaded = false;
        while (increments-- > 0) {
          timer.counter++;
          if (timer.counter > 0xffff) {
            timer.counter = timer.reload;
            cascaded = true;
            if (timer.control & 0x40) this.interrupts.request(GBA.IRQ.TIMER0 << i);
            if (this.apu && (i === 0 || i === 1)) this.apu.timerOverflow(i);
          }
        }
        this.io.writeRaw16(0x100 + i * 4, timer.counter);
      }
    }

    serialize() {
      return this.channels.map((timer) => ({ ...timer }));
    }

    deserialize(state) {
      state.forEach((timer, index) => Object.assign(this.channels[index], timer));
    }
  }

  GBA.Timers = Timers;
})(window.GBA = window.GBA || {});
