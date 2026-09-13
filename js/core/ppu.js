(function (GBA) {
  "use strict";

  const WIDTH = 240;
  const HEIGHT = 160;
  const SCANLINE_CYCLES = 1232;

  const SHAPES = [
    [[8, 8], [16, 16], [32, 32], [64, 64]],
    [[16, 8], [32, 8], [32, 16], [64, 32]],
    [[8, 16], [8, 32], [16, 32], [32, 64]]
  ];

  class PPU {
    constructor(memory, io, interrupts, dma, canvas) {
      this.memory = memory;
      this.io = io;
      this.interrupts = interrupts;
      this.dma = dma;
      this.canvas = canvas;
      this.context = canvas.getContext("2d", { alpha: false, desynchronized: true });
      this.imageData = this.context.createImageData(WIDTH, HEIGHT);
      this.pixels = this.imageData.data;
      this.bgPriority = new Uint8Array(WIDTH * HEIGHT);
      this.scanline = 0;
      this.cycles = 0;
      this.frameReady = false;
      this.frameCount = 0;
    }

    reset() {
      this.scanline = 0;
      this.cycles = 0;
      this.frameReady = false;
      this.io.writeRaw16(GBA.REG.VCOUNT, 0);
      this.io.writeRaw16(GBA.REG.DISPSTAT, this.io.read16(GBA.REG.DISPSTAT) & ~7);
      this.clear(0x0000);
      this.present();
    }

    color555(value) {
      return [
        ((value & 0x1f) << 3) | ((value & 0x1f) >>> 2),
        (((value >>> 5) & 0x1f) << 3) | ((value >>> 7) & 7),
        (((value >>> 10) & 0x1f) << 3) | ((value >>> 12) & 7)
      ];
    }

    paletteColor(index, object) {
      const base = object ? 0x200 : 0;
      const offset = base + ((index & 0xff) << 1);
      return this.memory.palette[offset] | (this.memory.palette[offset + 1] << 8);
    }

    putPixel(x, y, color) {
      if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
      const [r, g, b] = this.color555(color);
      const offset = (y * WIDTH + x) * 4;
      this.pixels[offset] = r;
      this.pixels[offset + 1] = g;
      this.pixels[offset + 2] = b;
      this.pixels[offset + 3] = 255;
    }

    clear(color) {
      const [r, g, b] = this.color555(color);
      for (let i = 0; i < this.pixels.length; i += 4) {
        this.pixels[i] = r;
        this.pixels[i + 1] = g;
        this.pixels[i + 2] = b;
        this.pixels[i + 3] = 255;
      }
      this.bgPriority.fill(4);
    }

    renderFrame() {
      const displayControl = this.io.read16(GBA.REG.DISPCNT);
      const mode = displayControl & 7;
      this.clear(this.paletteColor(0, false));
      if (displayControl & 0x0080) {
        this.clear(0x7fff);
      } else {
        if (mode === 0) this.renderMode0(displayControl);
        else if (mode === 1) this.renderMode1(displayControl);
        else if (mode === 2) this.renderMode2(displayControl);
        else if (mode === 3) this.renderMode3();
        else if (mode === 4) this.renderMode4(displayControl);
        else if (mode === 5) this.renderMode5(displayControl);
        if (displayControl & 0x1000) this.renderSprites(displayControl);
      }
      this.present();
      this.frameReady = true;
      this.frameCount++;
    }

    renderMode0(displayControl) {
      const layers = [];
      for (let bg = 0; bg < 4; bg++) {
        if (displayControl & (0x0100 << bg)) layers.push({ bg, priority: this.io.read16(GBA.REG.BG0CNT + bg * 2) & 3 });
      }
      layers.sort((a, b) => b.priority - a.priority || b.bg - a.bg);
      for (const layer of layers) this.renderTextBackground(layer.bg, layer.priority);
    }

    renderMode1(displayControl) {
      if (displayControl & 0x0100) this.renderTextBackground(0, this.io.read16(GBA.REG.BG0CNT) & 3);
      if (displayControl & 0x0200) this.renderTextBackground(1, this.io.read16(GBA.REG.BG1CNT) & 3);
      if (displayControl & 0x0400) this.renderAffineBackground(2, this.io.read16(GBA.REG.BG2CNT) & 3);
    }

    renderMode2(displayControl) {
      if (displayControl & 0x0400) this.renderAffineBackground(2, this.io.read16(GBA.REG.BG2CNT) & 3);
      if (displayControl & 0x0800) this.renderAffineBackground(3, this.io.read16(GBA.REG.BG3CNT) & 3);
    }

    renderMode3() {
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const offset = (y * WIDTH + x) << 1;
          this.putPixel(x, y, this.memory.vram[offset] | (this.memory.vram[offset + 1] << 8));
          this.bgPriority[y * WIDTH + x] = 2;
        }
      }
    }

    renderMode4(displayControl) {
      const page = displayControl & 0x10 ? 0xa000 : 0;
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const index = this.memory.vram[page + y * WIDTH + x];
          this.putPixel(x, y, this.paletteColor(index, false));
          this.bgPriority[y * WIDTH + x] = 2;
        }
      }
    }

    renderMode5(displayControl) {
      const page = displayControl & 0x10 ? 0xa000 : 0;
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 160; x++) {
          const offset = page + ((y * 160 + x) << 1);
          this.putPixel(x, y, this.memory.vram[offset] | (this.memory.vram[offset + 1] << 8));
          this.bgPriority[y * WIDTH + x] = 2;
        }
      }
    }

    renderTextBackground(bg, priority) {
      const control = this.io.read16(GBA.REG.BG0CNT + bg * 2);
      const charBase = ((control >>> 2) & 3) * 0x4000;
      const color256 = Boolean(control & 0x80);
      const screenBase = ((control >>> 8) & 0x1f) * 0x800;
      const size = (control >>> 14) & 3;
      const mapWidth = size === 0 || size === 2 ? 256 : 512;
      const mapHeight = size === 0 || size === 1 ? 256 : 512;
      const hofs = this.io.read16(GBA.REG.BG0HOFS + bg * 4) & 0x1ff;
      const vofs = this.io.read16(GBA.REG.BG0VOFS + bg * 4) & 0x1ff;
      for (let sy = 0; sy < HEIGHT; sy++) {
        const py = (sy + vofs) % mapHeight;
        for (let sx = 0; sx < WIDTH; sx++) {
          const px = (sx + hofs) % mapWidth;
          const tileX = px >>> 3;
          const tileY = py >>> 3;
          let screenBlock = 0;
          if (mapWidth === 512 && tileX >= 32) screenBlock++;
          if (mapHeight === 512 && tileY >= 32) screenBlock += mapWidth === 512 ? 2 : 1;
          const mapOffset = screenBase + screenBlock * 0x800 + ((((tileY & 31) * 32) + (tileX & 31)) << 1);
          const entry = this.memory.vram[mapOffset] | (this.memory.vram[mapOffset + 1] << 8);
          const tile = entry & 0x3ff;
          let tx = px & 7;
          let ty = py & 7;
          if (entry & 0x0400) tx = 7 - tx;
          if (entry & 0x0800) ty = 7 - ty;
          let colorIndex;
          if (color256) {
            colorIndex = this.memory.vram[charBase + tile * 64 + ty * 8 + tx];
          } else {
            const packed = this.memory.vram[charBase + tile * 32 + ty * 4 + (tx >>> 1)];
            colorIndex = tx & 1 ? packed >>> 4 : packed & 0x0f;
            if (colorIndex) colorIndex += ((entry >>> 12) & 15) * 16;
          }
          if (colorIndex) {
            this.putPixel(sx, sy, this.paletteColor(colorIndex, false));
            this.bgPriority[sy * WIDTH + sx] = priority;
          }
        }
      }
    }

    renderAffineBackground(bg, priority) {
      const control = this.io.read16(GBA.REG.BG0CNT + bg * 2);
      const charBase = ((control >>> 2) & 3) * 0x4000;
      const screenBase = ((control >>> 8) & 0x1f) * 0x800;
      const wrap = Boolean(control & 0x2000);
      const size = 128 << ((control >>> 14) & 3);
      const regBase = bg === 2 ? GBA.REG.BG2PA : GBA.REG.BG3PA;
      const pa = (this.io.read16(regBase) << 16) >> 16;
      const pb = (this.io.read16(regBase + 2) << 16) >> 16;
      const pc = (this.io.read16(regBase + 4) << 16) >> 16;
      const pd = (this.io.read16(regBase + 6) << 16) >> 16;
      const refX = (this.io.read32(regBase + 8) << 4) >> 4;
      const refY = (this.io.read32(regBase + 12) << 4) >> 4;
      const tilesWide = size >>> 3;
      for (let y = 0; y < HEIGHT; y++) {
        let fx = refX + pb * y;
        let fy = refY + pd * y;
        for (let x = 0; x < WIDTH; x++, fx += pa, fy += pc) {
          let px = fx >> 8;
          let py = fy >> 8;
          if (wrap) {
            px = ((px % size) + size) % size;
            py = ((py % size) + size) % size;
          } else if (px < 0 || py < 0 || px >= size || py >= size) {
            continue;
          }
          const tile = this.memory.vram[screenBase + (py >>> 3) * tilesWide + (px >>> 3)];
          const colorIndex = this.memory.vram[charBase + tile * 64 + (py & 7) * 8 + (px & 7)];
          if (colorIndex) {
            this.putPixel(x, y, this.paletteColor(colorIndex, false));
            this.bgPriority[y * WIDTH + x] = priority;
          }
        }
      }
    }

    renderSprites(displayControl) {
      const oneDimensional = Boolean(displayControl & 0x40);
      for (let index = 127; index >= 0; index--) {
        const base = index * 8;
        const attr0 = this.memory.oam[base] | (this.memory.oam[base + 1] << 8);
        const attr1 = this.memory.oam[base + 2] | (this.memory.oam[base + 3] << 8);
        const attr2 = this.memory.oam[base + 4] | (this.memory.oam[base + 5] << 8);
        const affine = Boolean(attr0 & 0x0100);
        if (!affine && (attr0 & 0x0200)) continue;
        const shape = (attr0 >>> 14) & 3;
        if (shape === 3) continue;
        const sizeId = (attr1 >>> 14) & 3;
        const [width, height] = SHAPES[shape][sizeId];
        let originX = attr1 & 0x1ff;
        let originY = attr0 & 0xff;
        if (originX >= 256) originX -= 512;
        if (originY >= 160) originY -= 256;
        const color256 = Boolean(attr0 & 0x2000);
        const priority = (attr2 >>> 10) & 3;
        const palette = (attr2 >>> 12) & 15;
        const baseTile = (attr2 & 0x3ff) & (color256 ? ~1 : ~0);
        for (let py = 0; py < height; py++) {
          const sy = originY + py;
          if (sy < 0 || sy >= HEIGHT) continue;
          for (let px = 0; px < width; px++) {
            const sx = originX + px;
            if (sx < 0 || sx >= WIDTH || priority > this.bgPriority[sy * WIDTH + sx]) continue;
            let tx = px;
            let ty = py;
            if (!affine) {
              if (attr1 & 0x1000) tx = width - 1 - tx;
              if (attr1 & 0x2000) ty = height - 1 - ty;
            }
            const tileRow = ty >>> 3;
            const tileCol = tx >>> 3;
            const rowStride = oneDimensional ? width >>> 3 : 32;
            const tile = baseTile + tileRow * rowStride * (color256 ? 2 : 1) + tileCol * (color256 ? 2 : 1);
            const charOffset = 0x10000 + tile * 32;
            let colorIndex;
            if (color256) colorIndex = this.memory.vram[charOffset + (ty & 7) * 8 + (tx & 7)];
            else {
              const packed = this.memory.vram[charOffset + (ty & 7) * 4 + ((tx & 7) >>> 1)];
              colorIndex = tx & 1 ? packed >>> 4 : packed & 15;
              if (colorIndex) colorIndex += palette * 16;
            }
            if (colorIndex) this.putPixel(sx, sy, this.paletteColor(colorIndex, true));
          }
        }
      }
    }

    tick(cycles) {
      this.cycles += cycles;
      while (this.cycles >= SCANLINE_CYCLES) {
        this.cycles -= SCANLINE_CYCLES;
        this.interrupts.request((this.io.read16(GBA.REG.DISPSTAT) & 0x10) ? GBA.IRQ.HBLANK : 0);
        if (this.dma) this.dma.trigger(2);
        this.scanline++;
        if (this.scanline === 160) {
          let status = this.io.read16(GBA.REG.DISPSTAT) | 1;
          this.io.writeRaw16(GBA.REG.DISPSTAT, status);
          if (status & 8) this.interrupts.request(GBA.IRQ.VBLANK);
          if (this.dma) this.dma.trigger(1);
          this.renderFrame();
        }
        if (this.scanline >= 228) {
          this.scanline = 0;
          this.io.writeRaw16(GBA.REG.DISPSTAT, this.io.read16(GBA.REG.DISPSTAT) & ~1);
        }
        this.io.writeRaw16(GBA.REG.VCOUNT, this.scanline);
        const compare = this.io.read16(GBA.REG.DISPSTAT) >>> 8;
        let status = this.io.read16(GBA.REG.DISPSTAT);
        if (this.scanline === compare) {
          status |= 4;
          if (status & 0x20) this.interrupts.request(GBA.IRQ.VCOUNT);
        } else status &= ~4;
        this.io.writeRaw16(GBA.REG.DISPSTAT, status);
      }
    }

    present() {
      this.context.putImageData(this.imageData, 0, 0);
    }

    serialize() {
      return { scanline: this.scanline, cycles: this.cycles, frameCount: this.frameCount };
    }

    deserialize(state) {
      this.scanline = state.scanline;
      this.cycles = state.cycles;
      this.frameCount = state.frameCount || 0;
      this.renderFrame();
    }
  }

  GBA.PPU = PPU;
})(window.GBA = window.GBA || {});
