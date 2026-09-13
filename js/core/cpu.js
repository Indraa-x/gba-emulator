(function (GBA) {
  "use strict";

  const N = 0x80000000;
  const Z = 0x40000000;
  const C = 0x20000000;
  const V = 0x10000000;
  const T = 0x20;
  const I = 0x80;

  const MODE = Object.freeze({ USER: 0x10, FIQ: 0x11, IRQ: 0x12, SVC: 0x13, ABT: 0x17, UND: 0x1b, SYS: 0x1f });

  class ARM7TDMI {
    constructor(memory, interrupts) {
      this.memory = memory;
      this.interrupts = interrupts;
      this.regs = new Uint32Array(16);
      this.cpsr = MODE.SVC | I;
      this.spsr = {};
      this.banked = {};
      this.thumbBLPrefix = 0;
      this.hleIRQState = null;
      this.cycles = 0;
      this.instructions = 0;
      this.hleIRQState = null;
      this.reset();
    }

    reset(useBIOS) {
      this.regs.fill(0);
      this.cpsr = MODE.SVC | I;
      this.regs[13] = 0x03007f00;
      this.regs[15] = useBIOS ? 0 : 0x08000000;
      this.spsr = { [MODE.FIQ]: 0, [MODE.IRQ]: 0, [MODE.SVC]: 0, [MODE.ABT]: 0, [MODE.UND]: 0 };
      this.banked = {};
      for (const mode of [MODE.USER, MODE.FIQ, MODE.IRQ, MODE.SVC, MODE.ABT, MODE.UND]) {
        this.banked[mode] = new Uint32Array(mode === MODE.FIQ ? 7 : 2);
      }
      this.banked[MODE.SVC][0] = this.regs[13];
      this.cycles = 0;
      this.instructions = 0;
    }

    get thumb() {
      return Boolean(this.cpsr & T);
    }

    get mode() {
      return this.cpsr & 0x1f;
    }

    readReg(index) {
      if (index !== 15) return this.regs[index] >>> 0;
      return (this.regs[15] + (this.thumb ? 2 : 4)) >>> 0;
    }

    writeReg(index, value) {
      value >>>= 0;
      if (index === 15) this.regs[15] = value & (this.thumb ? ~1 : ~3);
      else this.regs[index] = value;
    }

    switchMode(nextMode) {
      const current = this.mode;
      if (current === nextMode) return;
      const currentKey = current === MODE.SYS ? MODE.USER : current;
      const nextKey = nextMode === MODE.SYS ? MODE.USER : nextMode;
      if (current === MODE.FIQ) {
        for (let i = 0; i < 5; i++) this.banked[MODE.FIQ][i] = this.regs[8 + i];
      }
      if (currentKey !== MODE.FIQ && this.banked[currentKey]) {
        this.banked[currentKey][0] = this.regs[13];
        this.banked[currentKey][1] = this.regs[14];
      } else if (current === MODE.FIQ) {
        this.banked[MODE.FIQ][5] = this.regs[13];
        this.banked[MODE.FIQ][6] = this.regs[14];
      }
      if (nextMode === MODE.FIQ) {
        for (let i = 0; i < 5; i++) this.regs[8 + i] = this.banked[MODE.FIQ][i];
        this.regs[13] = this.banked[MODE.FIQ][5];
        this.regs[14] = this.banked[MODE.FIQ][6];
      } else if (this.banked[nextKey]) {
        this.regs[13] = this.banked[nextKey][0];
        this.regs[14] = this.banked[nextKey][1];
      }
      this.cpsr = (this.cpsr & ~0x1f) | nextMode;
    }

    enterIRQ() {
      const oldCpsr = this.cpsr;
      const resumeAddress = this.regs[15] >>> 0;
      const returnAddress = (this.regs[15] + (this.thumb ? 2 : 4)) >>> 0;
      if (!this.memory.biosLoaded) {
        this.hleIRQState = {
          cpsr: oldCpsr,
          pc: resumeAddress,
          saved: [this.regs[0], this.regs[1], this.regs[2], this.regs[3], this.regs[12], this.regs[14]]
        };
      }
      this.switchMode(MODE.IRQ);
      this.spsr[MODE.IRQ] = oldCpsr;
      this.cpsr = (this.cpsr & ~T) | I;
      if (this.memory.biosLoaded) {
        this.regs[14] = returnAddress;
        this.regs[15] = 0x00000018;
      } else {
        const handler = this.memory.read32(0x03007ffc);
        this.regs[14] = 0xfffffff1;
        this.cpsr = handler & 1 ? this.cpsr | T : this.cpsr & ~T;
        this.regs[15] = handler & (handler & 1 ? ~1 : ~3);
      }
      this.interrupts.halted = false;
    }

    finishHLEIRQ() {
      const state = this.hleIRQState;
      if (!state) return;
      this.switchMode(state.cpsr & 0x1f);
      this.cpsr = state.cpsr >>> 0;
      this.regs[0] = state.saved[0];
      this.regs[1] = state.saved[1];
      this.regs[2] = state.saved[2];
      this.regs[3] = state.saved[3];
      this.regs[12] = state.saved[4];
      this.regs[14] = state.saved[5];
      this.regs[15] = state.pc >>> 0;
      this.hleIRQState = null;
    }

    conditionPassed(condition) {
      const n = Boolean(this.cpsr & N);
      const z = Boolean(this.cpsr & Z);
      const c = Boolean(this.cpsr & C);
      const v = Boolean(this.cpsr & V);
      switch (condition) {
        case 0x0: return z;
        case 0x1: return !z;
        case 0x2: return c;
        case 0x3: return !c;
        case 0x4: return n;
        case 0x5: return !n;
        case 0x6: return v;
        case 0x7: return !v;
        case 0x8: return c && !z;
        case 0x9: return !c || z;
        case 0xa: return n === v;
        case 0xb: return n !== v;
        case 0xc: return !z && n === v;
        case 0xd: return z || n !== v;
        case 0xe: return true;
        default: return false;
      }
    }

    setNZ(value) {
      this.cpsr = (this.cpsr & ~(N | Z)) | (value & N) | (value === 0 ? Z : 0);
    }

    setAddFlags(a, b, result) {
      this.setNZ(result);
      const carry = (a >>> 0) + (b >>> 0) > 0xffffffff;
      const overflow = Boolean((~(a ^ b) & (a ^ result) & N) >>> 0);
      this.cpsr = (this.cpsr & ~(C | V)) | (carry ? C : 0) | (overflow ? V : 0);
    }

    setSubFlags(a, b, result) {
      this.setNZ(result);
      const carry = (a >>> 0) >= (b >>> 0);
      const overflow = Boolean(((a ^ b) & (a ^ result) & N) >>> 0);
      this.cpsr = (this.cpsr & ~(C | V)) | (carry ? C : 0) | (overflow ? V : 0);
    }

    shift(value, type, amount, immediate) {
      value >>>= 0;
      let result = value;
      let carry = Boolean(this.cpsr & C);
      if (type === 0) {
        if (amount > 0 && amount < 32) { carry = Boolean(value & (1 << (32 - amount))); result = value << amount; }
        else if (amount >= 32) { carry = amount === 32 && Boolean(value & 1); result = 0; }
      } else if (type === 1) {
        if (immediate && amount === 0) amount = 32;
        if (amount > 0 && amount < 32) { carry = Boolean(value & (1 << (amount - 1))); result = value >>> amount; }
        else if (amount >= 32) { carry = amount === 32 && Boolean(value & N); result = 0; }
      } else if (type === 2) {
        if (immediate && amount === 0) amount = 32;
        if (amount > 0 && amount < 32) { carry = Boolean(value & (1 << (amount - 1))); result = value >> amount; }
        else if (amount >= 32) { carry = Boolean(value & N); result = value & N ? 0xffffffff : 0; }
      } else {
        if (immediate && amount === 0) {
          const oldCarry = carry;
          carry = Boolean(value & 1);
          result = (value >>> 1) | (oldCarry ? N : 0);
        } else if (amount) {
          amount &= 31;
          if (!amount) carry = Boolean(value & N);
          else { carry = Boolean(value & (1 << (amount - 1))); result = (value >>> amount) | (value << (32 - amount)); }
        }
      }
      return { value: result >>> 0, carry };
    }

    armOperand2(instruction) {
      if (instruction & (1 << 25)) {
        const immediate = instruction & 0xff;
        const rotate = ((instruction >>> 8) & 15) * 2;
        const value = rotate ? ((immediate >>> rotate) | (immediate << (32 - rotate))) >>> 0 : immediate;
        return { value, carry: rotate ? Boolean(value & N) : Boolean(this.cpsr & C) };
      }
      const rm = instruction & 15;
      const type = (instruction >>> 5) & 3;
      if (instruction & 0x10) {
        const amount = this.regs[(instruction >>> 8) & 15] & 0xff;
        return this.shift(this.readReg(rm), type, amount, false);
      }
      return this.shift(this.readReg(rm), type, (instruction >>> 7) & 31, true);
    }

    step() {
      if (this.hleIRQState && (this.regs[15] >>> 0) === 0xfffffff0) {
        this.finishHLEIRQ();
        return 3;
      }
      if (this.interrupts.pending() && !(this.cpsr & I)) this.enterIRQ();
      if (this.interrupts.halted) return 1;
      let used;
      if (this.thumb) {
        const address = this.regs[15];
        const instruction = this.memory.read16(address);
        this.regs[15] = (address + 2) >>> 0;
        used = this.executeThumb(instruction);
      } else {
        const address = this.regs[15];
        const instruction = this.memory.read32(address);
        this.regs[15] = (address + 4) >>> 0;
        used = this.conditionPassed(instruction >>> 28) ? this.executeARM(instruction) : 1;
      }
      this.cycles += used;
      this.instructions++;
      return used;
    }

    executeARM(instruction) {
      if ((instruction & 0x0ffffff0) === 0x012fff10) {
        const target = this.regs[instruction & 15];
        this.cpsr = target & 1 ? this.cpsr | T : this.cpsr & ~T;
        this.regs[15] = target & (target & 1 ? ~1 : ~3);
        return 3;
      }
      if ((instruction & 0x0fbf0fff) === 0x010f0000) return this.armReadPSR(instruction);
      if ((instruction & 0x0db0f000) === 0x0120f000) return this.armWritePSR(instruction);
      if ((instruction & 0x0db0f000) === 0x0320f000) return this.armWritePSR(instruction);
      if ((instruction & 0x0fc000f0) === 0x00000090) return this.armMultiply(instruction);
      if ((instruction & 0x0e000090) === 0x00000090) return this.armHalfwordTransfer(instruction);
      if ((instruction & 0x0c000000) === 0x00000000) return this.armDataProcessing(instruction);
      if ((instruction & 0x0c000000) === 0x04000000) return this.armSingleTransfer(instruction);
      if ((instruction & 0x0e000000) === 0x08000000) return this.armBlockTransfer(instruction);
      if ((instruction & 0x0e000000) === 0x0a000000) return this.armBranch(instruction);
      if ((instruction & 0x0f000000) === 0x0f000000) return this.softwareInterrupt((instruction >>> 16) & 0xff);
      return 1;
    }

    armReadPSR(instruction) {
      const rd = (instruction >>> 12) & 15;
      const saved = Boolean(instruction & (1 << 22));
      this.writeReg(rd, saved && this.spsr[this.mode] !== undefined ? this.spsr[this.mode] : this.cpsr);
      return 1;
    }

    armWritePSR(instruction) {
      const saved = Boolean(instruction & (1 << 22));
      const fieldMask = (instruction >>> 16) & 15;
      let operand;
      if (instruction & (1 << 25)) {
        const immediate = instruction & 0xff;
        const rotate = ((instruction >>> 8) & 15) * 2;
        operand = rotate ? ((immediate >>> rotate) | (immediate << (32 - rotate))) >>> 0 : immediate;
      } else operand = this.regs[instruction & 15];
      let mask = 0;
      if (fieldMask & 1) mask |= 0x000000ff;
      if (fieldMask & 2) mask |= 0x0000ff00;
      if (fieldMask & 4) mask |= 0x00ff0000;
      if (fieldMask & 8) mask |= 0xff000000;
      if (saved && this.spsr[this.mode] !== undefined) {
        this.spsr[this.mode] = ((this.spsr[this.mode] & ~mask) | (operand & mask)) >>> 0;
      } else {
        const next = ((this.cpsr & ~mask) | (operand & mask)) >>> 0;
        if ((mask & 0xff) && (next & 0x1f) !== this.mode) this.switchMode(next & 0x1f);
        this.cpsr = ((this.cpsr & ~mask) | (operand & mask)) >>> 0;
      }
      return 1;
    }

    armDataProcessing(instruction) {
      const opcode = (instruction >>> 21) & 15;
      const setFlags = Boolean(instruction & (1 << 20));
      const rn = (instruction >>> 16) & 15;
      const rd = (instruction >>> 12) & 15;
      const a = this.readReg(rn);
      const shifted = this.armOperand2(instruction);
      const b = shifted.value;
      let result = 0;
      let write = true;
      switch (opcode) {
        case 0x0: result = a & b; break;
        case 0x1: result = a ^ b; break;
        case 0x2: result = (a - b) >>> 0; if (setFlags) this.setSubFlags(a, b, result); break;
        case 0x3: result = (b - a) >>> 0; if (setFlags) this.setSubFlags(b, a, result); break;
        case 0x4: result = (a + b) >>> 0; if (setFlags) this.setAddFlags(a, b, result); break;
        case 0x5: {
          const carry = this.cpsr & C ? 1 : 0;
          result = (a + b + carry) >>> 0;
          if (setFlags) this.setAddFlags(a, (b + carry) >>> 0, result);
          break;
        }
        case 0x6: {
          const borrow = this.cpsr & C ? 0 : 1;
          result = (a - b - borrow) >>> 0;
          if (setFlags) this.setSubFlags(a, (b + borrow) >>> 0, result);
          break;
        }
        case 0x7: {
          const borrow = this.cpsr & C ? 0 : 1;
          result = (b - a - borrow) >>> 0;
          if (setFlags) this.setSubFlags(b, (a + borrow) >>> 0, result);
          break;
        }
        case 0x8: result = a & b; write = false; break;
        case 0x9: result = a ^ b; write = false; break;
        case 0xa: result = (a - b) >>> 0; this.setSubFlags(a, b, result); write = false; break;
        case 0xb: result = (a + b) >>> 0; this.setAddFlags(a, b, result); write = false; break;
        case 0xc: result = a | b; break;
        case 0xd: result = b; break;
        case 0xe: result = a & ~b; break;
        case 0xf: result = ~b >>> 0; break;
      }
      if (setFlags && ![2, 3, 4, 5, 6, 7, 10, 11].includes(opcode)) {
        this.setNZ(result);
        this.cpsr = (this.cpsr & ~C) | (shifted.carry ? C : 0);
      }
      if (write) {
        if (rd === 15 && setFlags && this.spsr[this.mode] !== undefined) this.cpsr = this.spsr[this.mode];
        this.writeReg(rd, result);
      }
      return instruction & 0x10 ? 2 : 1;
    }

    armMultiply(instruction) {
      const accumulate = Boolean(instruction & (1 << 21));
      const setFlags = Boolean(instruction & (1 << 20));
      const rd = (instruction >>> 16) & 15;
      const rn = (instruction >>> 12) & 15;
      const rs = (instruction >>> 8) & 15;
      const rm = instruction & 15;
      let result = Math.imul(this.regs[rm], this.regs[rs]) >>> 0;
      if (accumulate) result = (result + this.regs[rn]) >>> 0;
      this.writeReg(rd, result);
      if (setFlags) this.setNZ(result);
      return accumulate ? 3 : 2;
    }

    armSingleTransfer(instruction) {
      const pre = Boolean(instruction & (1 << 24));
      const up = Boolean(instruction & (1 << 23));
      const byte = Boolean(instruction & (1 << 22));
      const writeback = Boolean(instruction & (1 << 21));
      const load = Boolean(instruction & (1 << 20));
      const rn = (instruction >>> 16) & 15;
      const rd = (instruction >>> 12) & 15;
      const base = this.readReg(rn);
      let offset;
      if (instruction & (1 << 25)) {
        const shifted = this.shift(this.regs[instruction & 15], (instruction >>> 5) & 3, (instruction >>> 7) & 31, true);
        offset = shifted.value;
      } else offset = instruction & 0xfff;
      const adjusted = up ? (base + offset) >>> 0 : (base - offset) >>> 0;
      const address = pre ? adjusted : base;
      if (load) this.writeReg(rd, byte ? this.memory.read8(address) : this.memory.read32(address));
      else {
        const value = rd === 15 ? (this.regs[15] + 4) >>> 0 : this.regs[rd];
        if (byte) this.memory.write8(address, value);
        else this.memory.write32(address, value);
      }
      if (!pre || writeback) this.writeReg(rn, adjusted);
      return load ? 3 : 2;
    }

    armHalfwordTransfer(instruction) {
      const pre = Boolean(instruction & (1 << 24));
      const up = Boolean(instruction & (1 << 23));
      const immediate = Boolean(instruction & (1 << 22));
      const writeback = Boolean(instruction & (1 << 21));
      const load = Boolean(instruction & (1 << 20));
      const rn = (instruction >>> 16) & 15;
      const rd = (instruction >>> 12) & 15;
      const type = (instruction >>> 5) & 3;
      const offset = immediate ? ((instruction >>> 4) & 0xf0) | (instruction & 15) : this.regs[instruction & 15];
      const base = this.readReg(rn);
      const adjusted = up ? (base + offset) >>> 0 : (base - offset) >>> 0;
      const address = pre ? adjusted : base;
      if (load) {
        let value;
        if (type === 1) value = this.memory.read16(address);
        else if (type === 2) value = this.memory.readSigned8(address);
        else value = this.memory.readSigned16(address);
        this.writeReg(rd, value);
      } else if (type === 1) this.memory.write16(address, this.regs[rd]);
      if (!pre || writeback) this.writeReg(rn, adjusted);
      return load ? 3 : 2;
    }

    armBlockTransfer(instruction) {
      const pre = Boolean(instruction & (1 << 24));
      const up = Boolean(instruction & (1 << 23));
      const writeback = Boolean(instruction & (1 << 21));
      const load = Boolean(instruction & (1 << 20));
      const rn = (instruction >>> 16) & 15;
      let list = instruction & 0xffff;
      if (!list) list = 1 << 15;
      const count = this.popCount(list);
      const base = this.regs[rn];
      let address = up ? base : (base - count * 4) >>> 0;
      if (up && pre) address += 4;
      if (!up && !pre) address += 4;
      for (let reg = 0; reg < 16; reg++) {
        if (!(list & (1 << reg))) continue;
        if (load) this.writeReg(reg, this.memory.read32(address));
        else this.memory.write32(address, reg === 15 ? this.regs[15] + 4 : this.regs[reg]);
        address += 4;
      }
      if (writeback) this.regs[rn] = up ? (base + count * 4) >>> 0 : (base - count * 4) >>> 0;
      return count + (load ? 2 : 1);
    }

    armBranch(instruction) {
      let offset = (instruction & 0x00ffffff) << 2;
      if (offset & 0x02000000) offset |= 0xfc000000;
      if (instruction & (1 << 24)) this.regs[14] = this.regs[15];
      this.regs[15] = (this.regs[15] + 4 + offset) >>> 0;
      return 3;
    }

    softwareInterrupt(id) {
      if (!this.memory.biosLoaded) return this.highLevelSWI(id & 0xff);
      const old = this.cpsr;
      const returnAddress = this.regs[15];
      this.switchMode(MODE.SVC);
      this.spsr[MODE.SVC] = old;
      this.regs[14] = returnAddress;
      this.cpsr = (this.cpsr & ~T) | I;
      this.regs[15] = 0x08;
      return 3;
    }

    highLevelSWI(id) {
      switch (id) {
        case 0x00:
          this.regs.fill(0);
          this.regs[13] = 0x03007f00;
          this.regs[15] = 0x08000000;
          return 3;
        case 0x01: {
          const flags = this.regs[0];
          if (flags & 1) this.memory.ewram.fill(0);
          if (flags & 2) this.memory.iwram.fill(0, 0, 0x7e00);
          if (flags & 4) this.memory.palette.fill(0);
          if (flags & 8) this.memory.vram.fill(0);
          if (flags & 16) this.memory.oam.fill(0);
          if (flags & 0x80) this.memory.io.reset();
          return 32;
        }
        case 0x02:
        case 0x03:
          this.interrupts.halted = true;
          return 1;
        case 0x04:
          this.interrupts.if &= ~this.regs[1];
          this.interrupts.halted = true;
          return 1;
        case 0x05:
          this.interrupts.if &= ~GBA.IRQ.VBLANK;
          this.interrupts.halted = true;
          return 1;
        case 0x06:
        case 0x07: {
          const numerator = (id === 0x06 ? this.regs[0] : this.regs[1]) | 0;
          const denominator = (id === 0x06 ? this.regs[1] : this.regs[0]) | 0;
          const quotient = denominator ? (numerator / denominator) | 0 : 0;
          this.regs[0] = quotient >>> 0;
          this.regs[1] = denominator ? (numerator % denominator) >>> 0 : numerator >>> 0;
          this.regs[3] = Math.abs(quotient) >>> 0;
          return 12;
        }
        case 0x08:
          this.regs[0] = Math.floor(Math.sqrt(this.regs[0])) >>> 0;
          return 8;
        case 0x0b:
          return this.hleCpuSet(false);
        case 0x0c:
          return this.hleCpuSet(true);
        case 0x11:
        case 0x12:
          return this.hleLz77();
        case 0x14:
        case 0x15:
          return this.hleRle();
        default:
          return 3;
      }
    }

    hleCpuSet(fast) {
      let source = this.regs[0] >>> 0;
      let dest = this.regs[1] >>> 0;
      const control = this.regs[2] >>> 0;
      const fill = Boolean(control & 0x01000000);
      const word = fast || Boolean(control & 0x04000000);
      let count = control & 0x001fffff;
      if (fast) count = (count + 7) & ~7;
      const width = word ? 4 : 2;
      const fillValue = word ? this.memory.read32(source) : this.memory.read16(source);
      for (let i = 0; i < count; i++) {
        const value = fill ? fillValue : word ? this.memory.read32(source) : this.memory.read16(source);
        if (word) this.memory.write32(dest, value); else this.memory.write16(dest, value);
        if (!fill) source += width;
        dest += width;
      }
      return Math.max(3, count * 2);
    }

    hleLz77() {
      let source = this.regs[0] >>> 0;
      let dest = this.regs[1] >>> 0;
      const header = this.memory.read32(source);
      let remaining = header >>> 8;
      source += 4;
      while (remaining > 0) {
        const flags = this.memory.read8(source++);
        for (let bit = 7; bit >= 0 && remaining > 0; bit--) {
          if (flags & (1 << bit)) {
            const pair = this.memory.read16(source);
            source += 2;
            const length = (pair >>> 4) + 3;
            const displacement = (pair & 0x0fff) + 1;
            for (let i = 0; i < length && remaining > 0; i++, remaining--) {
              this.memory.write8(dest, this.memory.read8(dest - displacement));
              dest++;
            }
          } else {
            this.memory.write8(dest++, this.memory.read8(source++));
            remaining--;
          }
        }
      }
      return 64;
    }

    hleRle() {
      let source = this.regs[0] >>> 0;
      let dest = this.regs[1] >>> 0;
      let remaining = this.memory.read32(source) >>> 8;
      source += 4;
      while (remaining > 0) {
        const control = this.memory.read8(source++);
        const compressed = Boolean(control & 0x80);
        let length = (control & 0x7f) + (compressed ? 3 : 1);
        const value = compressed ? this.memory.read8(source++) : 0;
        while (length-- > 0 && remaining-- > 0) this.memory.write8(dest++, compressed ? value : this.memory.read8(source++));
      }
      return 48;
    }

    executeThumb(op) {
      if ((op & 0xe000) === 0x0000) return this.thumbShiftAddSub(op);
      if ((op & 0xe000) === 0x2000) return this.thumbImmediate(op);
      if ((op & 0xfc00) === 0x4000) return this.thumbALU(op);
      if ((op & 0xfc00) === 0x4400) return this.thumbHigh(op);
      if ((op & 0xf800) === 0x4800) {
        this.regs[(op >>> 8) & 7] = this.memory.read32(((this.regs[15] + 2) & ~3) + ((op & 0xff) << 2));
        return 3;
      }
      if ((op & 0xf000) === 0x5000) return this.thumbRegisterTransfer(op);
      if ((op & 0xe000) === 0x6000) return this.thumbImmediateTransfer(op);
      if ((op & 0xf000) === 0x8000) return this.thumbHalfword(op);
      if ((op & 0xf000) === 0x9000) return this.thumbSPRelative(op);
      if ((op & 0xf000) === 0xa000) return this.thumbLoadAddress(op);
      if ((op & 0xff00) === 0xb000) return this.thumbAdjustSP(op);
      if ((op & 0xf600) === 0xb400) return this.thumbPushPop(op);
      if ((op & 0xf000) === 0xc000) return this.thumbMultiple(op);
      if ((op & 0xf000) === 0xd000) return this.thumbConditional(op);
      if ((op & 0xf800) === 0xe000) {
        let offset = (op & 0x7ff) << 1;
        if (offset & 0x800) offset |= 0xfffff000;
        this.regs[15] = (this.regs[15] + 2 + offset) >>> 0;
        return 3;
      }
      if ((op & 0xf800) === 0xf000) {
        let offset = (op & 0x7ff) << 12;
        if (offset & 0x400000) offset |= 0xff800000;
        this.thumbBLPrefix = (this.regs[15] + 2 + offset) >>> 0;
        return 1;
      }
      if ((op & 0xf800) === 0xf800) {
        const target = (this.thumbBLPrefix + ((op & 0x7ff) << 1)) >>> 0;
        // A primeira instrução depois do segundo halfword é o endereço de
        // retorno. Subtrair 2 fazia BX LR voltar ao próprio sufixo do BL,
        // prendendo jogos comerciais em um loop durante o boot.
        this.regs[14] = this.regs[15] | 1;
        this.regs[15] = target & ~1;
        return 3;
      }
      return 1;
    }

    thumbShiftAddSub(op) {
      const rd = op & 7;
      const rs = (op >>> 3) & 7;
      if ((op & 0x1800) !== 0x1800) {
        const shifted = this.shift(this.regs[rs], (op >>> 11) & 3, (op >>> 6) & 31, true);
        this.regs[rd] = shifted.value;
        this.setNZ(shifted.value);
        this.cpsr = (this.cpsr & ~C) | (shifted.carry ? C : 0);
      } else {
        const immediate = Boolean(op & 0x0400);
        const subtract = Boolean(op & 0x0200);
        const operand = immediate ? (op >>> 6) & 7 : this.regs[(op >>> 6) & 7];
        const a = this.regs[rs];
        const result = subtract ? (a - operand) >>> 0 : (a + operand) >>> 0;
        this.regs[rd] = result;
        if (subtract) this.setSubFlags(a, operand, result); else this.setAddFlags(a, operand, result);
      }
      return 1;
    }

    thumbImmediate(op) {
      const operation = (op >>> 11) & 3;
      const rd = (op >>> 8) & 7;
      const immediate = op & 0xff;
      const a = this.regs[rd];
      if (operation === 0) { this.regs[rd] = immediate; this.setNZ(immediate); }
      else if (operation === 1) this.setSubFlags(a, immediate, (a - immediate) >>> 0);
      else if (operation === 2) { const result = (a + immediate) >>> 0; this.regs[rd] = result; this.setAddFlags(a, immediate, result); }
      else { const result = (a - immediate) >>> 0; this.regs[rd] = result; this.setSubFlags(a, immediate, result); }
      return 1;
    }

    thumbALU(op) {
      const operation = (op >>> 6) & 15;
      const rs = (op >>> 3) & 7;
      const rd = op & 7;
      const a = this.regs[rd];
      const b = this.regs[rs];
      let result = a;
      let write = true;
      switch (operation) {
        case 0: result = a & b; break;
        case 1: result = a ^ b; break;
        case 2: { const s = this.shift(a, 0, b & 0xff, false); result = s.value; this.cpsr = (this.cpsr & ~C) | (s.carry ? C : 0); break; }
        case 3: { const s = this.shift(a, 1, b & 0xff, false); result = s.value; this.cpsr = (this.cpsr & ~C) | (s.carry ? C : 0); break; }
        case 4: { const s = this.shift(a, 2, b & 0xff, false); result = s.value; this.cpsr = (this.cpsr & ~C) | (s.carry ? C : 0); break; }
        case 5: { const carry = this.cpsr & C ? 1 : 0; result = (a + b + carry) >>> 0; this.setAddFlags(a, (b + carry) >>> 0, result); break; }
        case 6: { const borrow = this.cpsr & C ? 0 : 1; result = (a - b - borrow) >>> 0; this.setSubFlags(a, (b + borrow) >>> 0, result); break; }
        case 7: { const s = this.shift(a, 3, b & 0xff, false); result = s.value; this.cpsr = (this.cpsr & ~C) | (s.carry ? C : 0); break; }
        case 8: result = a & b; write = false; break;
        case 9: result = (-b) >>> 0; this.setSubFlags(0, b, result); break;
        case 10: result = (a - b) >>> 0; this.setSubFlags(a, b, result); write = false; break;
        case 11: result = (a + b) >>> 0; this.setAddFlags(a, b, result); write = false; break;
        case 12: result = a | b; break;
        case 13: result = Math.imul(a, b) >>> 0; break;
        case 14: result = a & ~b; break;
        case 15: result = ~b >>> 0; break;
      }
      if (![5, 6, 9, 10, 11].includes(operation)) this.setNZ(result);
      if (write) this.regs[rd] = result;
      return operation === 13 ? 2 : 1;
    }

    thumbHigh(op) {
      const operation = (op >>> 8) & 3;
      const rs = ((op >>> 3) & 7) | ((op >>> 3) & 8);
      const rd = (op & 7) | ((op >>> 4) & 8);
      if (operation === 3) {
        const target = this.regs[rs];
        this.cpsr = target & 1 ? this.cpsr | T : this.cpsr & ~T;
        this.regs[15] = target & (target & 1 ? ~1 : ~3);
        return 3;
      }
      const a = this.readReg(rd);
      const b = this.readReg(rs);
      if (operation === 0) this.writeReg(rd, (a + b) >>> 0);
      else if (operation === 1) this.setSubFlags(a, b, (a - b) >>> 0);
      else this.writeReg(rd, b);
      return rd === 15 ? 3 : 1;
    }

    thumbRegisterTransfer(op) {
      const ro = this.regs[(op >>> 6) & 7];
      const rb = this.regs[(op >>> 3) & 7];
      const rd = op & 7;
      const address = (rb + ro) >>> 0;
      if (op & 0x0200) {
        const type = (op >>> 10) & 3;
        if (type === 0) this.regs[rd] = this.memory.read16(address);
        else if (type === 1) this.regs[rd] = this.memory.readSigned8(address);
        else if (type === 2) this.regs[rd] = this.memory.readSigned16(address);
      } else {
        const load = Boolean(op & 0x0800);
        const byte = Boolean(op & 0x0400);
        if (load) this.regs[rd] = byte ? this.memory.read8(address) : this.memory.read32(address);
        else if (byte) this.memory.write8(address, this.regs[rd]); else this.memory.write32(address, this.regs[rd]);
      }
      return op & 0x0800 || op & 0x0200 ? 3 : 2;
    }

    thumbImmediateTransfer(op) {
      const byte = Boolean(op & 0x1000);
      const load = Boolean(op & 0x0800);
      const offset = ((op >>> 6) & 31) << (byte ? 0 : 2);
      const rb = (op >>> 3) & 7;
      const rd = op & 7;
      const address = (this.regs[rb] + offset) >>> 0;
      if (load) this.regs[rd] = byte ? this.memory.read8(address) : this.memory.read32(address);
      else if (byte) this.memory.write8(address, this.regs[rd]); else this.memory.write32(address, this.regs[rd]);
      return load ? 3 : 2;
    }

    thumbHalfword(op) {
      const load = Boolean(op & 0x0800);
      const address = (this.regs[(op >>> 3) & 7] + (((op >>> 6) & 31) << 1)) >>> 0;
      const rd = op & 7;
      if (load) this.regs[rd] = this.memory.read16(address); else this.memory.write16(address, this.regs[rd]);
      return load ? 3 : 2;
    }

    thumbSPRelative(op) {
      const load = Boolean(op & 0x0800);
      const rd = (op >>> 8) & 7;
      const address = (this.regs[13] + ((op & 0xff) << 2)) >>> 0;
      if (load) this.regs[rd] = this.memory.read32(address); else this.memory.write32(address, this.regs[rd]);
      return load ? 3 : 2;
    }

    thumbLoadAddress(op) {
      const rd = (op >>> 8) & 7;
      const base = op & 0x0800 ? this.regs[13] : ((this.regs[15] + 2) & ~3);
      this.regs[rd] = (base + ((op & 0xff) << 2)) >>> 0;
      return 1;
    }

    thumbAdjustSP(op) {
      const offset = (op & 0x7f) << 2;
      this.regs[13] = op & 0x80 ? (this.regs[13] - offset) >>> 0 : (this.regs[13] + offset) >>> 0;
      return 1;
    }

    thumbPushPop(op) {
      const load = Boolean(op & 0x0800);
      let list = op & 0xff;
      if (op & 0x0100) list |= load ? 1 << 15 : 1 << 14;
      const count = this.popCount(list);
      if (load) {
        let address = this.regs[13];
        for (let reg = 0; reg < 16; reg++) if (list & (1 << reg)) { this.writeReg(reg, this.memory.read32(address)); address += 4; }
        this.regs[13] = (this.regs[13] + count * 4) >>> 0;
      } else {
        this.regs[13] = (this.regs[13] - count * 4) >>> 0;
        let address = this.regs[13];
        for (let reg = 0; reg < 16; reg++) if (list & (1 << reg)) { this.memory.write32(address, this.regs[reg]); address += 4; }
      }
      return count + 1;
    }

    thumbMultiple(op) {
      const load = Boolean(op & 0x0800);
      const rb = (op >>> 8) & 7;
      let list = op & 0xff;
      if (!list) list = 1 << (load ? 15 : rb);
      let address = this.regs[rb];
      const count = this.popCount(list);
      for (let reg = 0; reg < 16; reg++) {
        if (!(list & (1 << reg))) continue;
        if (load) this.writeReg(reg, this.memory.read32(address)); else this.memory.write32(address, this.regs[reg]);
        address += 4;
      }
      this.regs[rb] = (this.regs[rb] + count * 4) >>> 0;
      return count + 1;
    }

    thumbConditional(op) {
      const condition = (op >>> 8) & 15;
      if (condition === 15) return this.softwareInterrupt(op & 0xff);
      if (condition === 14) return 1;
      let offset = (op & 0xff) << 1;
      if (offset & 0x100) offset |= 0xfffffe00;
      if (this.conditionPassed(condition)) {
        this.regs[15] = (this.regs[15] + 2 + offset) >>> 0;
        return 3;
      }
      return 1;
    }

    popCount(value) {
      value >>>= 0;
      let count = 0;
      while (value) { value &= value - 1; count++; }
      return count;
    }

    serialize() {
      const banked = {};
      for (const [mode, registers] of Object.entries(this.banked)) banked[mode] = Array.from(registers);
      return { regs: Array.from(this.regs), cpsr: this.cpsr, spsr: { ...this.spsr }, banked, thumbBLPrefix: this.thumbBLPrefix, cycles: this.cycles, instructions: this.instructions, hleIRQState: this.hleIRQState };
    }

    deserialize(state) {
      this.regs.set(state.regs);
      this.cpsr = state.cpsr >>> 0;
      this.spsr = { ...state.spsr };
      for (const [mode, registers] of Object.entries(state.banked)) this.banked[mode].set(registers);
      this.thumbBLPrefix = state.thumbBLPrefix;
      this.cycles = state.cycles;
      this.instructions = state.instructions;
      this.hleIRQState = state.hleIRQState || null;
    }
  }

  GBA.MODE = MODE;
  GBA.ARM7TDMI = ARM7TDMI;
})(window.GBA = window.GBA || {});
