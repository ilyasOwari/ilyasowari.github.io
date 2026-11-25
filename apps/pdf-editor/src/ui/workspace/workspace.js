// Continuous vertical scroll of all pages, lazy rendering, zoom.
import { h, clear } from '../common/dom.js';
import { PageView } from './pageView.js';
import { attachInteractions } from './interactions.js';

export class Workspace {
  constructor(el, app) {
    this.el = el; this.app = app; this.views = new Map();
    this.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const v = this.views.get(en.target.dataset.pageId);
        if (v) v.setVisible(en.isIntersecting);
      }
    }, { root: el, rootMargin: '900px 0px' });
    el.addEventListener('scroll', () => { this.app.bus.emit('scroll'); }, { passive: true });
    // browser zoom / moving to another screen changes the pixel ratio: the
    // pages were rasterised for the old one and would stay stretched (blurry)
    const effDpr = () => Math.min((window.devicePixelRatio || 1) * (window.visualViewport ? Math.max(1, window.visualViewport.scale || 1) : 1), 3);
    let dprT = 0, lastDpr = effDpr();
    const onDpr = () => {
      clearTimeout(dprT);
      dprT = setTimeout(() => {
        const d = effDpr();
        if (Math.abs(d - lastDpr) < 0.02) return;
        lastDpr = d;
        for (const v of this.views.values()) if (v.visible) v.render();
      }, 150);
    };
    const watchDpr = () => {
      if (!window.matchMedia) return;
      window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => { onDpr(); watchDpr(); }, { once: true });
    };
    window.addEventListener('resize', onDpr);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onDpr);
    watchDpr();
  }
  build() {
    for (const v of this.views.values()) { this.io.unobserve(v.el); v.destroy(); }
    this.io.disconnect();
    clear(this.el);
    this.views.clear();
    this.pagesEl = h('div', { class: 'pages' });
    this.el.append(this.pagesEl);
    this.sync();
  }
  sync() {
    const pages = this.app.session.pages;
    const keep = new Map();
    pages.forEach((p, i) => {
      let v = this.views.get(p.id);
      if (!v) { v = new PageView(this.app, p); attachInteractions(v, this.app); this.io.observe(v.el); }
      v.page = p;
      v.layout(i);
      keep.set(p.id, v);
      this.pagesEl.append(v.el); // re-append keeps order
    });
    for (const [id, v] of this.views) if (!keep.has(id)) { this.io.unobserve(v.el); v.destroy(); }
    this.views = keep;
  }
  view(pageId) { return this.views.get(pageId); }
  relayout() {
    let i = 0;
    for (const v of this.views.values()) { v.layout(i++); v.rendered = null; }
    for (const v of this.views.values()) if (v.visible) v.render();
  }
  setZoom(z, anchor) {
    z = Math.max(0.25, Math.min(4, z));
    const el = this.el;
    const ax = anchor ? anchor.x : el.clientWidth / 2, ay = anchor ? anchor.y : el.clientHeight / 2;
    const fx = (el.scrollLeft + ax) / Math.max(1, el.scrollWidth), fy = (el.scrollTop + ay) / Math.max(1, el.scrollHeight);
    this.app.zoom = z;
    this.relayout();
    el.scrollLeft = fx * el.scrollWidth - ax;
    el.scrollTop = fy * el.scrollHeight - ay;
    this.app.bus.emit('zoom');
  }
  fitWidth(cap = 3) {
    const pages = this.app.session.pages;
    const maxW = Math.max(...pages.map((p) => p.w));
    const avail = this.el.clientWidth - 80 - 16;
    this.setZoom(Math.max(0.25, Math.min(cap, avail / maxW)));
  }
  // top-left of the visible part of a page (page coordinates)
  visibleTopOf(page) {
    const v = this.views.get(page.id); if (!v) return null;
    const r = v.el.getBoundingClientRect(), w = this.el.getBoundingClientRect();
    const y = Math.max(0, (w.top - r.top) / this.app.zoom) + 30;
    return { x: 40, y: Math.min(y, page.h - 60) };
  }
  visibleCenterOf(page, bw = 0, bh = 0) {
    const v = this.views.get(page.id); if (!v) return { x: Math.max(8, (page.w - bw) / 2), y: Math.max(8, (page.h - bh) / 2) };
    const r = v.el.getBoundingClientRect(), w = this.el.getBoundingClientRect(), z = this.app.zoom;
    const cx = (w.left + w.width / 2 - r.left) / z - bw / 2;
    const cy = (w.top + w.height / 2 - r.top) / z - bh / 2;
    return { x: Math.max(8, Math.min(page.w - bw - 8, cx)), y: Math.max(8, Math.min(page.h - bh - 8, cy)) };
  }
  // page under the middle of the visible workspace (null when it falls in a gap)
  pageAtCenter() {
    const w = this.el.getBoundingClientRect(), cx = w.left + w.width / 2, cy = w.top + w.height / 2;
    for (const v of this.views.values()) {
      const b = v.el.getBoundingClientRect();
      if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) return v.page;
    }
    return null;
  }
  currentPageId() {
    const r = this.el.getBoundingClientRect();
    let best = null, ba = -1;
    for (const v of this.views.values()) {
      const b = v.el.getBoundingClientRect();
      const a = Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top));
      if (a > ba) { ba = a; best = v.page.id; }
    }
    return best;
  }
  scrollToPage(id, smooth = false) {
    const v = this.views.get(id); if (!v) return;
    this.el.scrollTo({ top: v.el.offsetTop - 24, behavior: smooth ? 'smooth' : 'auto' });
  }
  reveal(page) {
    const v = this.views.get(page.id); if (!v) return;
    const r = this.el.getBoundingClientRect(), b = v.el.getBoundingClientRect();
    if (b.bottom < r.top || b.top > r.bottom) this.scrollToPage(page.id);
  }
  scrollToBlock(page, block) {
    const v = this.views.get(page.id); if (!v || !block) return;
    const z = this.app.zoom;
    const top = v.el.offsetTop + block.y * z;
    const bh = (block.bh || 40) * (block.s || 1) * z;
    const viewTop = this.el.scrollTop, viewBot = viewTop + this.el.clientHeight;
    if (top < viewTop + 24 || top + bh > viewBot - 24) {
      this.el.scrollTo({ top: Math.max(0, top - (this.el.clientHeight - bh) / 2), behavior: 'smooth' });
    }
  }
}
