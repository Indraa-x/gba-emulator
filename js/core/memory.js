(function (GBA) {
  "use strict";

  const rotateRight = (value, shift) => ((value >>> shift) | (value << (32 - shift))) >>> 0;

  class Memory {
    constructor(io) {
      this.io = io;
      this.bios = new Uint8Array(0x4000);
      this.ewram = new Uint8Array(0x40000);
      this.iwram = new Uint8Array(0x8000);
      this.palette = new Uint8Array(0x400);
      this.vram = new Uint8Array(0x18000);
      this.oam = new Uint8Array(0x400);
      this.rom = new Uint8Array(0);
      this.save = new Uint8Array(0x10000);
      this.saveType = "SRAM";
      this.biosLoaded = false;
      this.openBus = 0;
      this.dirtySave = false;
    }

    reset(clearSave) {
      this.ewram.fill(0);
      this.iwram.fill(0);
      this.palette.fill(0);
      this.vram.fill(0);
      this.oam.fill(0);
      if (clearSave) this.save.fill(0xff);
      this.openBus = 0;
    }

    loadROM(buffer) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      if (!bytes.length || bytes.length > 0x2000000) throw new Error("ROM inválida ou maior que 32 MB.");
      this.rom = new Uint8Array(bytes);
      this.detectSaveType();
    }

    loadBIOS(buffer) {
      const bytes = new Uint8Array(buffer);
      if (bytes.length !== 0x4000) throw new Error("A BIOS deve ter exatamente 16 KB.");
      this.bios.set(bytes);
      this.biosLoaded = true;
    }

    detectSaveType() {
      let text = "";
      for (let i = 0; i < this.rom.length - 12; i += 4) {
        const c = this.rom[i];
        if (c === 69 || c === 83 || c === 70) {
          text = String.fromCharCode(...this.rom.subarray(i, Math.min(i + 16, this.rom.length)));
          if (text.includes("FLASH1M_V")) {
            this.saveType = "FLASH1M";
            this.save = new Uint8Array(0x20000);
            this.save.fill(0xff);
            return;
          }
          if (text.includes("FLASH") || text.includes("SRAM")) {
            this.saveType = text.includes("FLASH") ? "FLASH" : "SRAM";
            this.save = new Uint8Array(0x10000);
            this.save.fill(0xff);
            return;
          }
          if (text.includes("EEPROM")) {
            this.saveType = "EEPROM";
            this.save = new Uint8Array(0x2000);
            this.save.fill(0xff);
            return;
          }
        }
      }
      this.saveType = "SRAM";
      this.save = new Uint8Array(0x10000);
      this.save.fill(0xff);
    }

    vramAddress(address) {
      let offset = address & 0x1ffff;
      if (offset >= 0x18000) offset -= 0x8000;
      return offset;
    }

    read8(address) {
      address >>>= 0;
      const region = address >>> 24;
      let value;
      switch (region) {
        case 0x00:
          value = address < 0x4000 ? this.bios[address] : this.openBus & 0xff;
          break;
        case 0x02:
          value = this.ewram[address & 0x3ffff];
          break;
        case 0x03:
          value = this.iwram[address & 0x7fff];
          break;
        case 0x04:
          value = this.io.read8(address & 0x3ff);
          break;
        case 0x05:
          value = this.palette[address & 0x3ff];
          break;
        case 0x06:
          value = this.vram[this.vramAddress(address)];
          break;
        case 0x07:
          value = this.oam[address & 0x3ff];
          break;
        case 0x08:
        case 0x09:
        case 0x0a:
        case 0x0b:
        case 0x0c:
        case 0x0d:
          value = this.rom[(address - 0x08000000) & 0x01ffffff];
          if (value === undefined) value = (address >>> 1) & 0xff;
          break;
        case 0x0e:
        case 0x0f:
          value = this.save[address % this.save.length];
          break;
        default:
          value = this.openBus & 0xff;
      }
      this.openBus = (this.openBus & 0xffffff00) | value;
      return value;
    }

    read16(address) {
      const aligned = address & ~1;
      const value = this.read8(aligned) | (this.read8(aligned + 1) << 8);
      return address & 1 ? ((value >>> 8) | (value << 8)) & 0xffff : value;
    }

    read32(address) {
      const aligned = address & ~3;
      const value = (this.read8(aligned) | (this.read8(aligned + 1) << 8) | (this.read8(aligned + 2) << 16) | (this.read8(aligned + 3) << 24)) >>> 0;
      this.openBus = value;
      return address & 3 ? rotateRight(value, (address & 3) * 8) : value;
    }

    readSigned8(address) {
      return (this.read8(address) << 24) >> 24;
    }

    readSigned16(address) {
      if (address & 1) return this.readSigned8(address);
      return (this.read16(address) << 16) >> 16;
    }

    write8(address, value) {
      address >>>= 0;
      value &= 0xff;
      switch (address >>> 24) {
        case 0x02:
          this.ewram[address & 0x3ffff] = value;
          break;
        case 0x03:
          this.iwram[address & 0x7fff] = value;
          break;
        case 0x04:
          this.io.write8(address & 0x3ff, value);
          break;
        case 0x05: {
          const p = address & 0x3fe;
          this.palette[p] = value;
          this.palette[p + 1] = value;
          break;
        }
        case 0x06: {
          const p = this.vramAddress(address & ~1);
          this.vram[p] = value;
          this.vram[p + 1] = value;
          break;
        }
        case 0x07:
          break;
        case 0x0e:
        case 0x0f:
          this.save[address % this.save.length] = value;
          this.dirtySave = true;
          break;
      }
    }

    write16(address, value) {
      address &= ~1;
      value &= 0xffff;
      const region = address >>> 24;
      if (region === 0x04) {
        this.io.write16(address & 0x3ff, value);
        return;
      }
      if (region === 0x05) {
        const p = address & 0x3fe;
        this.palette[p] = value & 0xff;
        this.palette[p + 1] = value >>> 8;
        return;
      }
      if (region === 0x06) {
        const p = this.vramAddress(address);
        this.vram[p] = value & 0xff;
        this.vram[p + 1] = value >>> 8;
        return;
      }
      if (region === 0x07) {
        const p = address & 0x3fe;
        this.oam[p] = value & 0xff;
        this.oam[p + 1] = value >>> 8;
        return;
      }
      this.write8(address, value);
      this.write8(address + 1, value >>> 8);
    }

    write32(address, value) {
      address &= ~3;
      value >>>= 0;
      if ((address >>> 24) === 0x04) {
        this.io.write32(address & 0x3ff, value);
        return;
      }
      this.write16(address, value & 0xffff);
      this.write16(address + 2, value >>> 16);
    }

    serialize() {
      return {
        ewram: Array.from(this.ewram),
        iwram: Array.from(this.iwram),
        palette: Array.from(this.palette),
        vram: Array.from(this.vram),
        oam: Array.from(this.oam),
        save: Array.from(this.save),
        saveType: this.saveType
      };
    }

    deserialize(state) {
      this.ewram.set(state.ewram);
      this.iwram.set(state.iwram);
      this.palette.set(state.palette);
      this.vram.set(state.vram);
      this.oam.set(state.oam);
      if (state.save && state.save.length !== this.save.length) this.save = new Uint8Array(state.save.length);
      if (state.save) this.save.set(state.save);
      this.saveType = state.saveType || this.saveType;
    }
  }

  GBA.Memory = Memory;
})(window.GBA = window.GBA || {});
