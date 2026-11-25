// One page in the continuous scroll: base raster with vacated areas filled
// in the natural colour, and each block drawn as its own element.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { partNeedsPreview, partDestRect, isForeign, srcIndexOf, partTransparent } from '../../model/blockState.js';
import { renderPartPreview } from '../../engines/render/preview.js';
import { pageNaturalColor, rgbCss } from '../../engines/render/pixels.js';
import { coverBands } from '../../engines/export/coverOps.js';
import { paintInsertedText, insertedBoxDiv } from './insertedPaint.js';
import { boxCss } from './boxCss.js';
import { boxGeom, roomAround } from '../../model/textBox.js';
import { blockRect } from '../../model/blockOps.js';
import { pageNumberFor, pageNumberSpot } from '../../model/pageNumbers.js';
import { imgSrc } from '../../core/imageStore.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const previewCache = new Map();
const lastPreviewByPart = new WeakMap();
export function clearPreviews(pageId) { for (const k of [...previewCache.keys()]) if (k.startsWith(`["${pageId}"`)) previewCache.delete(k); }
function cachePreview(k, v) { previewCache.set(k, v); if (previewCache.size > 80) previewCache.delete(previewCache.keys().next().value); }

export class PageView {
  constructor(app, page) {
    this.app = app; this.page = page;
    this.base = h('canvas', { class: 'base' });
    this.orig = h('canvas', { class: 'orig' });
    this.blocksEl = h('div', { class: 'blocks' });
    this.label = h('div', { class: 'page-label' });
    this.loadingEl = h('div', { class: 'page-loading' }, t('loading'));
    this.el = h('div', { class: 'page', 'data-page-id': page.id }, this.label, this.base, this.blocksEl, this.orig, this.loadingEl);
    this.blockEls = new Map();
    this.visible = false;
    this.token = 0;
    this.rendered = null; // {scale, version}
  }
  // the page left the document (or a new document was opened)
  destroy() {
    this.token++;
    this.visible = false;
    if (this.scissors) this.scissors.destroy();
    if (this.insertGuide) this.insertGuide.destroy();
    if (this.crop) { try { this.crop.cancel(); } catch { /* */ } }
    this.el.remove();
  }
  get z() { return this.app.zoom; }
  // device pixels per pt: the real pixel ratio (browser zoom / HiDPI up to 3x),
  // limited so that one page raster stays within ~36 MP (about 144 MB)
  get scale() {
    const vv = window.visualViewport ? Math.max(1, window.visualViewport.scale || 1) : 1;
    const want = this.z * Math.min((window.devicePixelRatio || 1) * vv, 3);
    const cap = Math.sqrt(36e6 / Math.max(1, this.page.w * this.page.h));
    return Math.min(want, Math.max(this.z, cap));
  }
  layout(index) {
    this.el.style.width = this.page.w * this.z + 'px';
    this.el.style.height = this.page.h * this.z + 'px';
    if (index !== undefined) this.label.textContent = `${t('page')} ${index + 1}`;
    if (index !== undefined) this.index = index;
    this.drawPageNumber();
  }
  // page number overlay (same place / size as in the saved PDF)
  drawPageNumber() {
    const s = this.app.session, cfg = s && s.pageNums;
    const txt = pageNumberFor(s, this.index ?? s.pages.indexOf(this.page));
    if (!txt) { if (this.numEl) this.numEl.remove(); return; }
    if (!this.numEl) this.numEl = h('div', { class: 'page-num', 'data-testid': 'page-num' });
    if (this.numEl.parentNode !== this.el) this.el.append(this.numEl);
    const fam = this.app.fontFamilyFor('Carlito-Regular.ttf');
    const m = document.createElement('canvas').getContext('2d');
    m.font = `${cfg.size}px "${fam}"`;
    const w = m.measureText(txt).width;
    const p = pageNumberSpot(cfg, this.page, w), z = this.z;
    this.numEl.textContent = txt;
    Object.assign(this.numEl.style, { left: p.x * z + 'px', top: (p.y - cfg.size * 0.95) * z + 'px', fontSize: cfg.size * z + 'px', lineHeight: cfg.size * 1.2 * z + 'px', fontFamily: `"${fam}"` });
  }
  setVisible(v) {
    this.visible = v;
    if (v) this.render();
  }
  natural() {
    const p = this.page;
    if (p.srcIndex === null) return [255, 255, 255];
    // what the screen shows (sampled from the rendered page margins)
    if (p.natural) return p.natural;
    const an = this.app.session.analysis(p.srcIndex);
    if (an.bgFill && an.bgFill.rgb) return an.bgFill.rgb.map((v) => Math.round(v));
    return [255, 255, 255];
  }
  async render(force = false) {
    if (!this.visible) return;
    const page = this.page, s = this.app.session;
    const scale = this.scale;
    if (!force && this.rendered && this.rendered.scale === scale && this.rendered.version === page.version) return;
    const token = ++this.token;
    try {
      s.ensurePage(page);
      const orig = await this.app.rasters.get(page, scale, false);
      if (token !== this.token) return;
      if (!page.natural && page.srcIndex !== null) page.natural = pageNaturalColor(orig);
      const raster = page.whiteBg ? await this.app.rasters.get(page, scale, true) : orig;
      if (token !== this.token) return;
      this.drawBase(raster, scale);
      this.drawOrig(orig);
      this.syncBlocks(raster, scale, token);
      this.loadingEl.hidden = true;
      this.rendered = { scale, version: page.version };
      this.app.bus.emit('page:rendered', this);
    } catch (e) {
      console.error(e);
      this.loadingEl.hidden = false;
      this.loadingEl.textContent = t('errGeneric') + ': ' + (e.message || e);
    }
  }
  drawOrig(orig) {
    this.orig.width = orig.width; this.orig.height = orig.height;
    this.orig.getContext('2d').drawImage(orig, 0, 0);
  }
  holes() {
    const p = this.page, out = [];
    for (const b of p.blocks) {
      if (isForeign(b)) continue;
      for (const part of b.parts) if (part.src && !part.addedText && !part.addedTable) out.push({ ...part.src, mode: 'natural' });
    }
    if (p.srcIndex !== null && p.srcIndex !== undefined) {
      const an = this.app.session.analysis(p.srcIndex);
      for (const w of (an && an.widgets) || []) {
        out.push({ x: w.b.x0 + 1, y: w.b.y0 + 1, w: Math.max(1, w.b.x1 - w.b.x0 - 2), h: Math.max(1, w.b.y1 - w.b.y0 - 2), mode: 'natural' });
      }
    }
    for (const d of p.deleted) out.push({ ...d, mode: d.mode || 'natural' });
    for (const e of p.erase) out.push({ ...e });
    return out;
  }
  drawBase(raster, scale) {
    const c = this.base;
    c.width = raster.width; c.height = raster.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(raster, 0, 0);
    const nat = this.page.whiteBg ? 'rgb(255,255,255)' : rgbCss(this.natural());
    const holes = this.holes();
    for (const r of holes.filter((x) => !x.fill).concat(holes.filter((x) => x.fill))) {
      if (r.fill) {
        for (const q of coverBands(r)) { ctx.fillStyle = `rgb(${q.c.join(',')})`; const x0 = Math.floor(q.x * scale), y0 = Math.floor(q.y * scale); ctx.fillRect(x0, y0, Math.ceil((q.x + q.w) * scale) - x0, Math.ceil((q.y + q.h) * scale) - y0); }
        continue;
      }
      ctx.fillStyle = r.mode === 'white' ? '#fff' : nat;
      const x0 = Math.floor(r.x * scale), y0 = Math.floor(r.y * scale);
      ctx.fillRect(x0, y0, Math.ceil((r.x + r.w) * scale) - x0, Math.ceil((r.y + r.h) * scale) - y0);
    }
  }
  // ---- blocks ----
  syncBlocks(raster, scale, token) {
    const seen = new Set();
    const sel = this.app.session.selection;
    for (const b of this.page.blocks) {
      seen.add(b.id);
      let rec = this.blockEls.get(b.id);
      if (!rec) {
        const el = h('div', { class: 'block', 'data-block-id': b.id });
        HANDLES.forEach((hd) => el.append(h('div', { class: 'handle ' + hd, 'data-handle': hd })));
        rec = { el, key: null };
        this.blockEls.set(b.id, rec);
        this.blocksEl.append(el);
      }
      this.position(b, rec.el);
      const key = JSON.stringify([b.parts, b.s, b.bw, b.bh, b.inserted ? b.inserted : 0, scale, this.page.whiteBg, b.box || 0, !!b.free]);
      rec.el.classList.toggle('free', !!b.free);
      rec.el.classList.toggle('behind', !!b.behind);
      if (key !== rec.key) { rec.key = key; this.paintBlock(b, rec.el, raster, scale, token); }
      const isSel = sel.pageId === this.page.id && sel.ids.has(b.id);
      rec.el.classList.toggle('selected', isSel);
      rec.el.classList.toggle('single', isSel && sel.ids.size === 1);
      rec.el.classList.toggle('just-inserted', !!(this.app.freshBlocks && this.app.freshBlocks.has(b.id)));
    }
    for (const [id, rec] of this.blockEls) if (!seen.has(id)) { rec.el.remove(); this.blockEls.delete(id); }
  }
  position(b, el) {
    const z = this.z, s = b.s || 1;
    el.style.left = b.x * z + 'px'; el.style.top = b.y * z + 'px';
    el.style.width = b.bw * s * z + 'px'; el.style.height = b.bh * s * z + 'px';
    el.style.transform = '';
  }
  // forget everything drawn for this page (used by "reset page")
  purge() {
    clearPreviews(this.page.id);
    for (const rec of this.blockEls.values()) rec.el.remove();
    this.blockEls.clear();
    this.rendered = null;
    this.token++;
  }
  refreshSelection() {
    const sel = this.app.session.selection;
    for (const [id, rec] of this.blockEls) {
      const isSel = sel.pageId === this.page.id && sel.ids.has(id);
      rec.el.classList.toggle('selected', isSel);
      rec.el.classList.toggle('single', isSel && sel.ids.size === 1);
      rec.el.classList.toggle('just-inserted', !!(this.app.freshBlocks && this.app.freshBlocks.has(id)));
    }
  }
  paintBlock(b, el, raster, scale, token) {
    el.querySelectorAll('canvas,img,.box-deco').forEach((c) => c.remove());
    const z = this.z, bs = b.s || 1;
    if (b.inserted) { this.paintInserted(b, el, scale); return; }
    if (b.box) { const R = blockRect(b); const g = boxGeom(R, b.box, 10, roomAround(this.page, b)); el.insertBefore(boxCss({ ...g, x: g.x - R.x, y: g.y - R.y }, b.box, z), el.firstChild); }
    for (const part of b.parts) {
      const d = partDestRect(b, part);
      if (!part.src) {
        if (part.img) this.paintImagePart(b, part, d, el, scale);
        else if (part.inserted) this.paintInsertedPart(b, part, d, el, scale);
        continue;
      }
      const c = h('canvas');
      const ps = bs * (part.sc || 1);
      c.style.left = part.dx * bs * z + 'px'; c.style.top = part.dy * bs * z + 'px';
      c.style.width = d.w * z + 'px'; c.style.height = d.h * z + 'px';
      // crop from the raster (also used as placeholder for previews)
      const tp = partTransparent(part, b);
      const scaledUp = !isForeign(b) && !part.bgMode && ps > 1.015;
      const needsPrev = partNeedsPreview(part, b) || scaledUp;
      const pxs = scale * ps;
      const prevScale = scaledUp ? Math.min(pxs, Math.sqrt(16e6 / Math.max(1, part.dw * part.dh))) : pxs;
      const cwScale = scaledUp ? prevScale : pxs;
      c.width = Math.max(1, Math.round(part.dw * cwScale)); c.height = Math.max(1, Math.round(part.dh * cwScale));
      const ctx = c.getContext('2d');
      const sw = Math.min(part.src.w, part.dw), sh = Math.min(part.src.h, part.dh);
      const prevSnap = needsPrev ? lastPreviewByPart.get(part) : null;
      if (prevSnap && prevSnap.width) {
        ctx.drawImage(prevSnap, 0, 0, c.width, c.height);
      } else {
        if (!tp) {
          ctx.fillStyle = this.page.whiteBg ? '#fff' : rgbCss(this.natural());
          ctx.fillRect(0, 0, c.width, c.height);
        }
        if (!isForeign(b) && !tp && !part.bgMode) ctx.drawImage(raster, part.src.x * scale, part.src.y * scale, sw * scale, sh * scale, 0, 0, Math.round(sw * cwScale), Math.round(sh * cwScale));
      }
      // an untouched part is a copy of the page raster: copy whole device
      // pixels (integer source and target) instead of resampling it at the
      // fractional offset of its rectangle - that resampling blurred all
      // original text, while re-rendered (edited) text stayed sharp
      if (!needsPrev && !prevSnap && Math.abs(ps - 1) < 1e-9 && !tp && !isForeign(b) && !part.bgMode && part.dw <= part.src.w + 1e-6 && part.dh <= part.src.h + 1e-6) {
        const sx0 = Math.floor(part.src.x * scale), sy0 = Math.floor(part.src.y * scale);
        const sx1 = Math.min(raster.width, Math.ceil((part.src.x + part.dw) * scale)), sy1 = Math.min(raster.height, Math.ceil((part.src.y + part.dh) * scale));
        if (sx1 > sx0 && sy1 > sy0) {
          const Dx = Math.round(d.x * scale - (part.src.x * scale - sx0)), Dy = Math.round(d.y * scale - (part.src.y * scale - sy0));
          c.width = sx1 - sx0; c.height = sy1 - sy0;
          c.style.left = (Dx / scale - b.x) * z + 'px'; c.style.top = (Dy / scale - b.y) * z + 'px';
          c.style.width = c.width / scale * z + 'px'; c.style.height = c.height / scale * z + 'px';
          c.getContext('2d').drawImage(raster, sx0, sy0, c.width, c.height, 0, 0, c.width, c.height);
        }
      }
      el.insertBefore(c, el.querySelector('.handle')); // parts paint in model order (later on top)
      if (needsPrev) {
        const k = JSON.stringify([this.page.id, srcIndexOf(this.page, b), part, this.page.whiteBg, prevScale.toFixed(3), tp]);
        const cached = previewCache.get(k);
        const draw = (src) => { lastPreviewByPart.set(part, src); if (token !== this.token && !this.blockEls.has(b.id)) return; c.width = src.width; c.height = src.height; const g2 = c.getContext('2d'); g2.clearRect(0, 0, c.width, c.height); g2.drawImage(src, 0, 0); };
        if (cached && cached.width) draw(cached);
        else {
          const an = this.app.session.analysis(srcIndexOf(this.page, b));
          const pc = document.createElement('canvas');
          const job = renderPartPreview(this.app.session, an, this.page, part, prevScale, pc, { transparent: tp }).then(() => { cachePreview(k, pc); draw(pc); this.app.bus.emit('page:rendered', this); })
            .catch((e) => console.error('preview failed', e));
          this.app.pending.add(job); job.finally(() => this.app.pending.delete(job));
        }
      }
    }
  }
  paintImagePart(b, part, d, el, scale) {
    const z = this.z, bs = b.s || 1, ps = bs * (part.sc || 1);
    const c = h('canvas');
    c.style.left = part.dx * bs * z + 'px'; c.style.top = part.dy * bs * z + 'px';
    c.style.width = d.w * z + 'px'; c.style.height = d.h * z + 'px';
    const px = scale * ps;
    c.width = Math.max(1, Math.round(part.dw * px)); c.height = Math.max(1, Math.round(part.dh * px));
    el.insertBefore(c, el.querySelector('.handle'));
    const im = new Image();
    im.onload = () => {
      const ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0, part.img.iw * px, part.img.ih * px);
      if (part.img.caption) {
        ctx.fillStyle = 'rgb(64,69,82)';
        ctx.font = `italic ${part.img.capSize * px}px "${this.app.fontFamilyFor('Carlito-Italic.ttf')}"`;
        const tw = ctx.measureText(part.img.caption).width;
        ctx.fillText(part.img.caption, Math.max(0, (part.img.iw * px - tw) / 2), (part.img.ih + part.img.capSize * 1.05) * px);
      }
      this.app.bus.emit('page:rendered', this);
    };
    im.src = imgSrc(part.img);
  }
  paintInsertedPart(b, part, d, el, scale) {
    const z = this.z, s = (b.s || 1) * (part.sc || 1);
    const wrap = h('div', { style: { position: 'absolute', left: (d.x - b.x) * z + 'px', top: (d.y - b.y) * z + 'px', width: d.w * z + 'px', height: d.h * z + 'px', pointerEvents: 'none' } });
    const fakeB = { x: d.x, y: d.y, s, bw: part.dw, bh: part.dh, inserted: part.inserted };
    const c = h('canvas');
    c.style.left = '0px'; c.style.top = '0px'; c.style.width = d.w * z + 'px'; c.style.height = d.h * z + 'px';
    const px = scale * s;
    c.width = Math.max(1, Math.round(part.dw * px)); c.height = Math.max(1, Math.round(part.dh * px));
    const bx = insertedBoxDiv(fakeB, z);
    wrap.append(c);
    if (bx) wrap.insertBefore(bx, c);
    el.insertBefore(wrap, el.querySelector('.handle'));
    const job = paintInsertedText(this.app, fakeB, c, px).then(() => this.app.bus.emit('page:rendered', this)).catch((e) => console.error(e));
    this.app.pending.add(job); job.finally(() => this.app.pending.delete(job));
  }
  paintInserted(b, el, scale) {
    const z = this.z, s = b.s || 1, ins = b.inserted;
    if (ins.type === 'image') {
      const img = h('img', { src: imgSrc(ins), draggable: 'false', style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' } });
      el.insertBefore(img, el.firstChild);
      return;
    }
    const c = h('canvas');
    c.style.left = '0px'; c.style.top = '0px'; c.style.width = b.bw * s * z + 'px'; c.style.height = b.bh * s * z + 'px';
    const px = scale * s;
    c.width = Math.max(1, Math.round(b.bw * px)); c.height = Math.max(1, Math.round(b.bh * px));
    const bx = insertedBoxDiv(b, z);
    el.insertBefore(c, el.firstChild);
    if (bx) el.insertBefore(bx, el.firstChild);
    const job = paintInsertedText(this.app, b, c, px).then(() => this.app.bus.emit('page:rendered', this)).catch((e) => console.error(e));
    this.app.pending.add(job); job.finally(() => this.app.pending.delete(job));
  }
  // compose base + blocks into a small canvas for the sidebar thumbnail
  snapshot(target) {
    const ctx = target.getContext('2d');
    const k = target.width / (this.page.w);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, target.width, target.height);
    if (this.base.width) ctx.drawImage(this.base, 0, 0, target.width, target.height);
    for (const b of this.page.blocks) {
      const rec = this.blockEls.get(b.id); if (!rec) continue;
      const bs = b.s || 1;
      if (b.inserted) {
        const m = rec.el.querySelector('canvas,img');
        if (m) try { ctx.drawImage(m, b.x * k, b.y * k, b.bw * bs * k, b.bh * bs * k); } catch { /* not loaded */ }
        continue;
      }
      const z = this.z;
      for (const c of rec.el.querySelectorAll('canvas')) {
        try { ctx.drawImage(c, (b.x + parseFloat(c.style.left) / z) * k, (b.y + parseFloat(c.style.top) / z) * k, parseFloat(c.style.width) / z * k, parseFloat(c.style.height) / z * k); } catch { /* */ }
      }
    }
  }
}
