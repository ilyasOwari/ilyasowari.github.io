// "Böl ve Ayır" scissors: red dashed guides through the pointer inside a block.
// Click freezes the guides; "Buradan kes" cuts the whole line. Moving along a
// frozen line offers "Buraya kadar kes" (sets an end point), then moving to
// either side of that point offers the cross cut from there: an L-shaped
// carve that separates a corner piece. Esc cancels a pending cut.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { blockRect, findBlock } from '../../model/blockOps.js';
import { blockInk, snapCut } from '../../core/cutSnap.js';
import { Loupe } from './loupe.js';

const NEAR = 7; // px

export class Scissors {
  constructor(view, app) {
    this.view = view; this.app = app;
    this.layer = h('div', { class: 'sc-layer' });
    this.dyn = null; // hover-only elements (static ones stay clickable)
    this.state = null; // null | {b, R, P, axis?, E?}
    this.loupe = new Loupe(view);
    this.focusId = null; // block selected before the tool started: the cursor stays inside it
    view.el.addEventListener('pointermove', (e) => { if (this.on()) this.hover(e); });
    view.el.addEventListener('pointerleave', () => { if (this.on() && !this.state) this.clear(); this.loupe.hide(); });
    this.onKey = (e) => { if (e.key === 'Escape' && this.state) { e.stopPropagation(); this.cancel(); } };
    document.addEventListener('keydown', this.onKey, true);
  }
  destroy() {
    document.removeEventListener('keydown', this.onKey, true);
    try { this.cancel(); } catch { /* */ }
    try { this.loupe.hide(); } catch { /* */ }
  }
  on() { return this.app.session && this.app.session.tool === 'split' && this.view.page.blocks; }
  pt(e) {
    const r = this.view.el.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / this.view.z, y: (e.clientY - r.top) / this.view.z };
    // near the block that was selected when the tool started: stay inside it
    const fb = this.focusId && findBlock(this.view.page, this.focusId);
    if (fb) {
      const R = blockRect(fb), m = 16; // about one line around it
      if (p.x >= R.x - m && p.x <= R.x + R.w + m && p.y >= R.y - m && p.y <= R.y + R.h + m) {
        p.x = Math.min(Math.max(p.x, R.x), R.x + R.w); p.y = Math.min(Math.max(p.y, R.y), R.y + R.h); p.focus = fb;
      }
    }
    return p;
  }
  // cut lines through this point, moved off any object they would slice
  snapped(b, p) {
    const R = blockRect(b);
    const key = b.id + ':' + this.view.page.version;
    if (this.inkKey !== key) { this.inkKey = key; try { this.ink = blockInk(this.app.session, this.view.page, b); } catch (e) { this.ink = []; } }
    return { x: snapCut(this.ink, 'v', p.x, R.y, R.y + R.h, R.x, R.x + R.w), y: snapCut(this.ink, 'h', p.y, R.x, R.x + R.w, R.y, R.y + R.h) };
  }
  blockAt(p) {
    if (p.focus) return p.focus; return (this.view.page.blocks || []).slice().reverse().find((b) => { const r = blockRect(b); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }); }
  cancel() { this.state = null; this.sig = null; this.clear(); this.loupe.hide(); }
  clear() { this.layer.textContent = ''; this.layer.remove(); }
  ensure(keep = false) {
    if (this.layer.parentNode !== this.view.el) this.view.el.append(this.layer);
    if (!keep) { this.layer.textContent = ''; this.dyn = h('div', { class: 'sc-dyn' }); this.layer.append(this.dyn); }
    else this.dyn.textContent = '';
  }

  // ---- drawing helpers (page coords -> px) ----
  line(x0, y0, x1, y1, cls = '') {
    const z = this.view.z;
    const hz = Math.abs(y1 - y0) < 0.01;
    const el = h('div', { class: 'sc-line ' + (hz ? 'h ' : 'v ') + cls });
    Object.assign(el.style, hz ? { left: Math.min(x0, x1) * z + 'px', top: y0 * z + 'px', width: Math.abs(x1 - x0) * z + 'px' }
      : { left: x0 * z + 'px', top: Math.min(y0, y1) * z + 'px', height: Math.abs(y1 - y0) * z + 'px' });
    (this.target || this.layer).append(el);
  }
  label(x, y, text, onClick, testid, cls = '') {
    const z = this.view.z;
    const el = h('button', { class: 'sc-label' + (onClick ? ' act' : '') + (cls ? ' ' + cls : ''), 'data-testid': testid || '' }, text);
    el.style.left = x * z + 'px'; el.style.top = y * z + 'px';
    if (onClick) {
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
      el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    }
    (this.target || this.layer).append(el);
    return el;
  }
  // the two "Buradan kes" labels must never cover each other
  placeLabels(R, P, lh, lv) {
    const z = this.view.z;
    const hit = () => { const a = lh.getBoundingClientRect(), b = lv.getBoundingClientRect(); return a.left < b.right + 4 && b.left < a.right + 4 && a.top < b.bottom + 4 && b.top < a.bottom + 4; };
    if (!hit()) return;
    lv.style.top = Math.max(R.y * z, (R.y + R.h) * z - lv.offsetHeight - 2) + 'px'; // vertical label to the bottom end
    if (!hit()) return;
    lh.style.left = Math.max(R.x * z, (R.x + R.w) * z - lh.offsetWidth - 2) + 'px'; // horizontal label to the right end
    if (!hit()) return;
    lv.style.top = (R.y + 2) * z + 'px';
  }
  // over empty page: offer to leave the tool
  showExit(p) {
    this.sig = null;
    this.ensure();
    const z = this.view.z;
    const el = h('div', { class: 'sc-exit', 'data-testid': 'sc-exit' }, t('splitExit'));
    el.style.left = p.x * z + 14 + 'px'; el.style.top = p.y * z + 12 + 'px';
    this.layer.append(el);
  }
  dot(x, y) { const z = this.view.z; const d = h('div', { class: 'sc-dot' }); d.style.left = x * z + 'px'; d.style.top = y * z + 'px'; (this.target || this.layer).append(d); }

  // ---- interaction ----
  hover(e) {
    const p = this.pt(e);
    const st = this.state;
    if (!st) {
      const b = this.blockAt(p);
      if (!b) { this.showExit(p); this.loupe.hide(); return; }
      const R = blockRect(b);
      const q = this.snapped(b, p);
      this.sig = null;
      this.ensure();
      this.line(R.x, q.y, R.x + R.w, q.y); this.line(q.x, R.y, q.x, R.y + R.h);
      this.placeLabels(R, q, this.label(R.x + 2, q.y, t('cutHere'), null, '', 'h'), this.label(q.x, R.y + 2, t('cutHere'), null, '', 'v'));
      this.loupe.show(q, R);
      return;
    }
    this.drawState(p);
    this.loupe.show(st.E ? { x: st.axis === 'h' ? st.E.x : p.x, y: st.axis === 'h' ? p.y : st.E.y } : p, st.R);
  }
  // static part (frozen lines, clickable labels) is built once per state;
  // pointer moves only redraw the hover hints
  drawState(p) {
    const st = this.state, R = st.R, P = st.P, z = this.view.z;
    const sig = JSON.stringify([P, st.E || null, st.axis || null, z]);
    if (this.sig !== sig || this.layer.parentNode !== this.view.el) {
      this.sig = sig;
      this.ensure();
      this.target = null;
      if (!st.E) {
        this.line(R.x, P.y, R.x + R.w, P.y, 'frozen'); this.line(P.x, R.y, P.x, R.y + R.h, 'frozen');
        this.placeLabels(R, P, this.label(R.x + 2, P.y, t('cutHere'), () => this.cutFull('h'), 'sc-cut-h', 'h'), this.label(P.x, R.y + 2, t('cutHere'), () => this.cutFull('v'), 'sc-cut-v', 'v'));
      } else {
        const seg = this.segment();
        this.line(seg.x0, seg.y0, seg.x1, seg.y1, 'frozen');
        this.dot(st.E.x, st.E.y);
      }
      this.dsig = null;
    }
    this.target = this.dyn;
    try {
      if (!p) return;
      if (!st.E) {
        this.dyn.textContent = '';
        const nearH = Math.abs(p.y - P.y) * z < NEAR && Math.abs(p.x - P.x) * z > NEAR * 2 && p.x > R.x && p.x < R.x + R.w;
        const nearV = Math.abs(p.x - P.x) * z < NEAR && Math.abs(p.y - P.y) * z > NEAR * 2 && p.y > R.y && p.y < R.y + R.h;
        const q = this.snapped(st.b, p);
        if (nearH) { this.dot(q.x, P.y); this.label(q.x, P.y, t('cutUntil'), null, '', 'h').classList.add('until'); st.hoverE = { axis: 'h', x: q.x, y: P.y }; }
        else if (nearV) { this.dot(P.x, q.y); this.label(P.x, q.y, t('cutUntil'), null, '', 'v').classList.add('until'); st.hoverE = { axis: 'v', x: P.x, y: q.y }; }
        else st.hoverE = null;
        return;
      }
      const E = st.E;
      const dsig = st.axis === 'h' ? (p.y > E.y ? 'down' : 'up') : (p.x > E.x ? 'right' : 'left');
      if (this.dsig === dsig) return; // keep the clickable label in place
      this.dsig = dsig;
      this.dyn.textContent = '';
      if (st.axis === 'h') {
        const down = p.y > E.y;
        const y1 = down ? R.y + R.h : R.y;
        this.line(E.x, E.y, E.x, y1);
        this.label(E.x, (E.y + y1) / 2, t('cutHere'), () => this.carve(down ? 'down' : 'up'), 'sc-carve', 'v');
      } else {
        const right = p.x > E.x;
        const x1 = right ? R.x + R.w : R.x;
        this.line(E.x, E.y, x1, E.y);
        this.label((E.x + x1) / 2, E.y, t('cutHere'), () => this.carve(right ? 'right' : 'left'), 'sc-carve', 'h');
      }
    } finally { this.target = null; }
  }
  // the partial line: from the block edge on the start point's side to E
  segment() {
    const { R, P, E, axis } = this.state;
    if (axis === 'h') return P.x <= E.x ? { x0: R.x, x1: E.x, y0: E.y, y1: E.y } : { x0: E.x, x1: R.x + R.w, y0: E.y, y1: E.y };
    return P.y <= E.y ? { x0: E.x, x1: E.x, y0: R.y, y1: E.y } : { x0: E.x, x1: E.x, y0: E.y, y1: R.y + R.h };
  }
  down(e) {
    const p = this.pt(e);
    const st = this.state;
    if (st && !st.E && st.hoverE) { this.state = { ...st, axis: st.hoverE.axis, E: { x: st.hoverE.x, y: st.hoverE.y } }; this.drawState(p); return; }
    if (st && st.E) {
      // clicking on the pending cross cut works like its label
      const E = st.E, R = st.R;
      if (st.axis === 'h' && Math.abs(p.x - E.x) * this.view.z < NEAR) { this.carve(p.y > E.y ? 'down' : 'up'); return; }
      if (st.axis === 'v' && Math.abs(p.y - E.y) * this.view.z < NEAR) { this.carve(p.x > E.x ? 'right' : 'left'); return; }
      void R;
    }
    const b = this.blockAt(p);
    // a click on empty page leaves "Böl ve Ayır"
    if (!b) { this.cancel(); this.app.setTool('select'); return; }
    const q = this.snapped(b, p);
    this.state = { b, R: blockRect(b), P: { x: q.x, y: q.y } };
    this.drawState(null);
  }
  cutFull(axis) {
    const { R, P } = this.state;
    const rect = axis === 'h' ? { x: R.x - 1, y: P.y, w: R.w + 2, h: R.y + R.h - P.y + 1 } : { x: P.x, y: R.y - 1, w: R.x + R.w - P.x + 1, h: R.h + 2 };
    this.finish(rect);
  }
  carve(dir) {
    const { R } = this.state;
    const s = this.segment();
    let rect;
    if (dir === 'down') rect = { x: s.x0, y: s.y0, w: s.x1 - s.x0, h: R.y + R.h - s.y0 + 1 };
    else if (dir === 'up') rect = { x: s.x0, y: R.y - 1, w: s.x1 - s.x0, h: s.y0 - R.y + 1 };
    else if (dir === 'right') rect = { x: s.x0, y: s.y0, w: R.x + R.w - s.x0 + 1, h: s.y1 - s.y0 };
    else rect = { x: R.x - 1, y: s.y0, w: s.x0 - R.x + 1, h: s.y1 - s.y0 };
    // pieces at the block edge reach just past it
    if (rect.x <= R.x + 0.01) { rect.w += rect.x - (R.x - 1); rect.x = R.x - 1; }
    if (rect.x + rect.w >= R.x + R.w - 0.01) rect.w = R.x + R.w + 1 - rect.x;
    if (rect.y <= R.y + 0.01) { rect.h += rect.y - (R.y - 1); rect.y = R.y - 1; }
    if (rect.y + rect.h >= R.y + R.h - 0.01) rect.h = R.y + R.h + 1 - rect.y;
    this.finish(rect);
  }
  finish(rect) {
    const page = this.view.page;
    this.cancel();
    this.app.splitArea(page, rect);
  }
}
