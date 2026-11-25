// Interactive placement guide shown when the user picks where to insert
// new content on a page (line slot in flow mode, crosshair in free mode).
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { blockRect } from '../../model/blockOps.js';

export class InsertGuide {
  constructor(view, app) {
    this.view = view;
    this.app = app;
    this.layer = null;
    this.onMove = (e) => { if (this.on()) this.hover(e); else if (this.layer) this.destroy(); };
    this.onLeave = () => { if (this.layer) this.destroy(); };
    view.el.addEventListener('pointermove', this.onMove);
    view.el.addEventListener('pointerleave', this.onLeave);
  }
  destroy() {
    if (this.layer) { this.layer.remove(); this.layer = null; }
  }
  cancel() {
    this.destroy();
  }
  on() {
    return this.app.session && this.app.session.tool === 'insertSpot' && !!this.app.pendingInsert && !!this.view.page.blocks;
  }
  pt(e) {
    const r = this.view.el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.view.z, y: (e.clientY - r.top) / this.view.z };
  }
  slotsForPage() {
    const page = this.view.page;
    const pw = page.w || 595, ph = page.h || 842;
    const flow = (page.blocks || []).filter((b) => !b.free).map((b) => blockRect(b)).sort((a, b) => a.y - b.y);
    const minX = flow.length ? Math.max(24, Math.min(48, ...flow.map((r) => r.x))) : 36;
    const maxR = flow.length ? Math.min(pw - 24, Math.max(pw - 48, ...flow.map((r) => r.x + r.w))) : pw - 36;
    const span = { x: minX, w: Math.max(120, maxR - minX) };
    if (!flow.length) return [{ y: 40, ...span }];
    const slots = [];
    const first = flow[0];
    if (first.y > 24) slots.push({ y: Math.max(16, Math.min(first.y - 6, first.y / 2)), ...span });
    else slots.push({ y: Math.max(12, first.y - 4), ...span });
    for (let i = 0; i < flow.length - 1; i++) {
      const endA = flow[i].y + flow[i].h;
      const startB = flow[i + 1].y;
      const mid = startB >= endA ? (endA + startB) / 2 : endA + 4;
      slots.push({ y: Math.max(12, Math.min(ph - 20, mid)), ...span });
    }
    const lastEnd = Math.max(...flow.map((r) => r.y + r.h));
    slots.push({ y: Math.max(16, Math.min(ph - 20, lastEnd + 10)), ...span });
    return slots;
  }
  nearestSlot(pt) {
    const slots = this.slotsForPage();
    let best = slots[0], bestD = Infinity;
    for (const s of slots) {
      const d = Math.abs(s.y - pt.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }
  hover(e) {
    if (!this.layer) {
      this.layer = h('div', { class: 'ins-guide-layer' });
      this.view.el.append(this.layer);
    }
    this.layer.innerHTML = '';
    const pt = this.pt(e);
    const z = this.view.z;
    const inFlow = this.app.session.insertFlow !== false;
    if (inFlow) {
      const slot = this.nearestSlot(pt);
      const line = h('div', { class: 'ins-guide-line' });
      Object.assign(line.style, { left: (slot.x * z) + 'px', top: (slot.y * z) + 'px', width: (slot.w * z) + 'px' });
      const pill = h('span', { class: 'ins-guide-pill' }, '+ ' + t('insertPlaceHere'));
      line.append(pill);
      this.layer.append(line);
    } else {
      const free = h('div', { class: 'ins-guide-free' });
      const lx = Math.max(8, Math.min(this.view.page.w - 140, pt.x)) * z;
      const ly = Math.max(8, Math.min(this.view.page.h - 24, pt.y)) * z;
      Object.assign(free.style, { left: lx + 'px', top: ly + 'px' });
      free.textContent = '+ ' + t('insertPlaceFree');
      this.layer.append(free);
    }
  }
  down(e) {
    if (e.button !== 0 || !this.on()) return;
    e.preventDefault();
    e.stopPropagation();
    const p0 = this.pt(e);
    const inFlow = this.app.session.insertFlow !== false;
    const pt = inFlow ? { x: p0.x, y: this.nearestSlot(p0).y } : p0;
    this.destroy();
    this.app.completePendingInsert(this.view.page, pt);
  }
}
