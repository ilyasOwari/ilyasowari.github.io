// Page rasters from pdf.js (original or with background removed), per scale.
import { renderPage } from '../../engines/render/pdfjs.js';
import { renderWhitePage } from '../../engines/render/preview.js';

export class RasterCache {
  constructor(session) { this.s = session; this.map = new Map(); this.order = []; this.limit = 8; }
  key(page, scale, white) { return `${page.id}|${scale.toFixed(3)}|${white ? 1 : 0}`; }
  get(page, scale, white = false) {
    const k = this.key(page, scale, white);
    if (this.map.has(k)) { this.touch(k); return this.map.get(k); }
    const p = this.make(page, scale, white).catch((e) => { this.map.delete(k); throw e; });
    this.map.set(k, p); this.touch(k);
    return p;
  }
  touch(k) {
    this.order = this.order.filter((x) => x !== k); this.order.push(k);
    while (this.order.length > this.limit) this.map.delete(this.order.shift());
    // also keep the total size in check (sharp rasters at high zoom are big):
    // about 120 MP, never dropping the two most recent ones
    let px = 0;
    for (const key of this.order) px += this.pixels(key);
    while (this.order.length > 2 && px > 120e6) { const old = this.order.shift(); px -= this.pixels(old); this.map.delete(old); }
  }
  pixels(key) {
    const [id, sc] = key.split('|');
    const p = this.s.pages.find((q) => q.id === id);
    return p ? p.w * p.h * (+sc) * (+sc) : 0;
  }
  async make(page, scale, white) {
    const c = document.createElement('canvas');
    if (page.srcIndex === null) {
      c.width = Math.round(page.w * scale); c.height = Math.round(page.h * scale);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      return c;
    }
    if (white) return renderWhitePage(this.s, this.s.analysis(page.srcIndex), scale, c);
    const pg = await this.s.pdfjs.getPage(page.srcIndex + 1);
    return renderPage(pg, scale, c);
  }
  dropPage(id) { for (const k of [...this.map.keys()]) if (k.startsWith(id + '|')) this.map.delete(k); this.order = this.order.filter((k) => !k.startsWith(id + '|')); }
}
