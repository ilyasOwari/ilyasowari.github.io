// "Kırp" tool: a frame over one block; drag its sides / corners inward, then
// "Kırp" (or Enter) keeps only what is inside. Esc / "Vazgeç" cancels.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { icon } from '../../../assets/icons/icons.js';
import { blockRect, findBlock } from '../../model/blockOps.js';
import { blockInk, snapCut } from '../../core/cutSnap.js';

const HD = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export class CropTool {
  constructor(view, app) { this.view = view; this.app = app; this.st = null; }
  active() { return !!this.st; }
  start(id) {
    this.cancel();
    const b = findBlock(this.view.page, id);
    if (!b || b.inserted) return false;
    const R = blockRect(b);
    let ink = [];
    try { ink = blockInk(this.app.session, this.view.page, b, { textOnly: true }); } catch (e) { console.warn(e); }
    this.st = { id, R, r: { ...R }, ink };
    this.el = h('div', { class: 'crop-frame', 'data-testid': 'crop-frame' });
    this.shade = h('div', { class: 'crop-shade' });
    HD.forEach((hd) => { const k = h('div', { class: 'crop-h ' + hd, 'data-testid': 'crop-h-' + hd }); k.addEventListener('pointerdown', (e) => this.drag(e, hd)); this.el.append(k); });
    const ok = h('button', { class: 'btn primary', 'data-testid': 'crop-apply', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); this.apply(); }, html: icon('check', 'icon icon-sm') + `<span>${t('cropApply')}</span>` });
    const no = h('button', { class: 'btn', 'data-testid': 'crop-cancel', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); this.cancel(); } }, t('cancel'));
    this.bar = h('div', { class: 'crop-bar' }, ok, no);
    this.view.el.append(this.shade, this.el, this.bar);
    this.key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.cancel(); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.apply(); } };
    document.addEventListener('keydown', this.key, true);
    this.draw();
    return true;
  }
  draw() {
    const z = this.view.z, r = this.st.r, R = this.st.R;
    Object.assign(this.el.style, { left: r.x * z + 'px', top: r.y * z + 'px', width: r.w * z + 'px', height: r.h * z + 'px' });
    // dim what will be cut away (inside the block, outside the frame)
    Object.assign(this.shade.style, { left: R.x * z + 'px', top: R.y * z + 'px', width: R.w * z + 'px', height: R.h * z + 'px',
      clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${(r.x - R.x) * z}px ${(r.y - R.y) * z}px, ${(r.x - R.x) * z}px ${(r.y + r.h - R.y) * z}px, ${(r.x + r.w - R.x) * z}px ${(r.y + r.h - R.y) * z}px, ${(r.x + r.w - R.x) * z}px ${(r.y - R.y) * z}px, ${(r.x - R.x) * z}px ${(r.y - R.y) * z}px)` });
    Object.assign(this.bar.style, { left: r.x * z + 'px', top: (r.y + r.h) * z + 8 + 'px' });
  }
  drag(e, hd) {
    e.stopPropagation(); e.preventDefault();
    const z = this.view.z, R = this.st.R, r0 = { ...this.st.r };
    const x0 = e.clientX, y0 = e.clientY, min = 6;
    const tgt = e.target; tgt.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      let { x, y, w, h: hh } = r0;
      if (hd.includes('w')) { const nx = Math.min(Math.max(R.x, x + dx), x + w - min); w += x - nx; x = nx; }
      if (hd.includes('e')) w = Math.min(Math.max(min, w + dx), R.x + R.w - x);
      if (hd.includes('n')) { const ny = Math.min(Math.max(R.y, y + dy), y + hh - min); hh += y - ny; y = ny; }
      if (hd.includes('s')) hh = Math.min(Math.max(min, hh + dy), R.y + R.h - y);
      // pictures, logos, frames and boxes are cropped exactly where the edge is; only a
      // text line is never sliced: the edge jumps to the gap above / below it (Alt = free)
      if (!ev.altKey && this.st.ink.length) {
        const I = this.st.ink, lo = { x: R.x, y: R.y }, hi = { x: R.x + R.w, y: R.y + R.h };
        if (hd.includes('w')) { const nx = snapCut(I, 'v', x, y, y + hh, lo.x, x + w - min); if (nx !== null) { w += x - nx; x = nx; } }
        if (hd.includes('e')) { const ex = snapCut(I, 'v', x + w, y, y + hh, x + min, hi.x); if (ex !== null) w = ex - x; }
        if (hd.includes('n')) { const ny = snapCut(I, 'h', y, x, x + w, lo.y, y + hh - min); if (ny !== null) { hh += y - ny; y = ny; } }
        if (hd.includes('s')) { const ey = snapCut(I, 'h', y + hh, x, x + w, y + min, hi.y); if (ey !== null) hh = ey - y; }
        x = Math.max(R.x, x); y = Math.max(R.y, y); w = Math.min(w, R.x + R.w - x); hh = Math.min(hh, R.y + R.h - y);
      }
      this.st.r = { x, y, w, h: hh };
      this.draw();
    };
    const up = () => { tgt.removeEventListener('pointermove', move); tgt.removeEventListener('pointerup', up); };
    tgt.addEventListener('pointermove', move); tgt.addEventListener('pointerup', up);
  }
  apply() {
    if (!this.st) return;
    const { id, r, R } = this.st;
    const page = this.view.page;
    this.cancel();
    if (Math.abs(r.x - R.x) + Math.abs(r.y - R.y) + Math.abs(r.w - R.w) + Math.abs(r.h - R.h) < 0.5) return;
    const res = this.app.controller.crop(page, id, r);
    this.app.setTool('select');
    if (res && res !== 'deleted') this.app.select(page, [id]);
  }
  cancel() {
    if (!this.st) return;
    this.st = null;
    [this.el, this.shade, this.bar].forEach((x) => x && x.remove());
    document.removeEventListener('keydown', this.key, true);
  }
}
