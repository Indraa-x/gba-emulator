(function (GBA) {
  "use strict";

  class DMAController {
    constructor(memory, io, interrupts) {
      this.memory = memory;
      this.io = io;
      this.interrupts = interrupts;
      this.channels = Array.from({ length: 4 }, () => ({ source: 0, dest: 0, count: 0, control: 0, enabled: false, first: true }));
    }

    reset() {
      for (const channel of this.channels) Object.assign(channel, { source: 0, dest: 0, count: 0, control: 0, enabled: false, first: true });
    }

    onIOWrite(offset) {
      if (offset < 0x0b0 || offset > 0x0de) return;
      const index = Math.floor((offset - 0x0b0) / 12);
      if (index < 0 || index > 3) return;
      const base = 0x0b0 + index * 12;
      const channel = this.channels[index];
      const control = this.io.read16(base + 10);
      const enable = Boolean(control & 0x8000);
      if (enable && !channel.enabled) {
        channel.source = this.io.read32(base) & (index === 0 ? 0x07ffffff : 0x0fffffff);
        channel.dest = this.io.read32(base + 4) & (index === 3 ? 0x0fffffff : 0x07ffffff);
        channel.count = this.io.read16(base + 8) || (index === 3 ? 0x10000 : 0x4000);
        channel.first = true;
      }
      channel.control = control;
      channel.enabled = enable;
      if (enable && ((control >>> 12) & 3) === 0) this.execute(index);
    }

    trigger(timing) {
      for (let index = 0; index < 4; index++) {
        const channel = this.channels[index];
        if (channel.enabled && ((channel.control >>> 12) & 3) === timing) this.execute(index);
      }
    }

    execute(index) {
      const channel = this.channels[index];
      if (!channel.enabled) return 0;
      const word = Boolean(channel.control & 0x0400);
      const width = word ? 4 : 2;
      const destMode = (channel.control >>> 5) & 3;
      const sourceMode = (channel.control >>> 7) & 3;
      let source = channel.source;
      let dest = channel.dest;
      let count = channel.count;
      let cycles = 0;
      while (count-- > 0) {
        if (word) this.memory.write32(dest, this.memory.read32(source));
        else this.memory.write16(dest, this.memory.read16(source));
        source += sourceMode === 0 ? width : sourceMode === 1 ? -width : 0;
        dest += destMode === 0 || destMode === 3 ? width : destMode === 1 ? -width : 0;
        cycles += 2;
      }
      channel.source = source >>> 0;
      channel.dest = dest >>> 0;
      if (destMode === 3) channel.dest = this.io.read32(0x0b4 + index * 12);
      if (channel.control & 0x4000) this.interrupts.request(GBA.IRQ.DMA0 << index);
      if (!(channel.control & 0x0200)) {
        channel.enabled = false;
        channel.control &= ~0x8000;
        this.io.writeRaw16(0x0ba + index * 12, channel.control);
      }
      return cycles;
    }

    serialize() {
      return this.channels.map((channel) => ({ ...channel }));
    }

    deserialize(state) {
      state.forEach((channel, index) => Object.assign(this.channels[index], channel));
    }
  }

  GBA.DMAController = DMAController;
})(window.GBA = window.GBA || {});
