// Small toolbar above the selection: Düzenle, Sil, move up/down/left/right.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { icon } from '../../../assets/icons/icons.js';
import { findBlock, blockRect } from '../../model/blockOps.js';

export class FloatingToolbar {
  constructor(app) {
    this.app = app;
    this.anchor = null;
    const btn = (cmd, ic, label, cls = '', showLabel = true) => h('button', { class: cls, 'data-cmd': cmd, 'data-tip': label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); app.cmd(cmd); }, onpointerdown: (e) => e.stopPropagation(), html: icon(ic, 'icon icon-sm') + (showLabel ? `<span>${label}</span>` : '') });
    const pg = (cmd, label, arrow, after) => h('button', { class: 'ftb-page', 'data-cmd': cmd, 'data-testid': 'ftb-' + cmd, 'data-tip': label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); app.cmd(cmd); }, onpointerdown: (e) => e.stopPropagation(), html: after ? `<span>${label}</span><b>${arrow}</b>` : `<b>${arrow}</b><span>${label}</span>` });
    this.el = h('div', { class: 'ftb', hidden: true, 'data-testid': 'ftb' },
      h('div', { class: 'ftb-row' },
        btn('merge', 'merge', t('mergeBlocks')),
        btn('edit', 'edit', t('edit')), btn('delete', 'trash', t('del'), 'danger'), h('div', { class: 'sep' }),
        pg('toPrevPage', t('prevPage'), '←', false)),
      h('div', { class: 'ftb-row ftb-row2' },
        btn('swap:up', 'up', t('moveUp'), '', false), btn('swap:down', 'down', t('moveDown'), '', false),
        btn('swap:left', 'left', t('moveLeft'), '', false), btn('swap:right', 'right', t('moveRight'), '', false),
        h('div', { class: 'sep' }),
        pg('toNextPageAdj', t('nextPage'), '→', true)));
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('dblclick', (e) => e.stopPropagation());
    this.el.addEventListener('wheel', (e) => {
      const ws = app.workspace && app.workspace.el;
      if (!ws) return;
      e.preventDefault();
      if (e.ctrlKey) {
        const r = ws.getBoundingClientRect();
        app.workspace.setZoom(app.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX - r.left, y: e.clientY - r.top });
        return;
      }
      const mult = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? ws.clientHeight : 1);
      ws.scrollTop += e.deltaY * mult;
      ws.scrollLeft += e.deltaX * mult;
    }, { passive: false });
    this.onResize = () => { if (!this.el.hidden) this.show(); };
    window.addEventListener('resize', this.onResize);
  }
  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
  }
  setAnchor(pageId, pt) {
    this.anchor = (pageId && pt) ? { pageId, x: pt.x, y: pt.y } : null;
  }
  isOutOfView(ratio = 0.10) {
    const s = this.app.session, sel = s && s.selection;
    const wsEl = this.app.workspace && this.app.workspace.el;
    if (!s || !wsEl) return false;
    const sr = wsEl.getBoundingClientRect();
    const padY = sr.height * ratio, padX = sr.width * ratio;
    if (sel && sel.pageId && sel.ids.size) {
      const view = this.app.workspace.view(sel.pageId);
      const page = s.pageById(sel.pageId);
      if (!view || !page || !page.blocks) return false;
      const bs = [...sel.ids].map((id) => findBlock(page, id)).filter(Boolean);
      if (!bs.length) return false;
      const rs = bs.map(blockRect);
      const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
      const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
      const z = view.z, prc = view.el.getBoundingClientRect();
      const bx0 = prc.left + x0 * z, by0 = prc.top + y0 * z, bx1 = prc.left + x1 * z, by1 = prc.top + y1 * z;
      return by1 < sr.top - padY || by0 > sr.bottom + padY || bx1 < sr.left - padX || bx0 > sr.right + padX;
    }
    const cp = this.app.ctxPoint;
    if (cp && cp.page && cp.pt) {
      const view = this.app.workspace.view(cp.page.id);
      if (!view) return false;
      const prc = view.el.getBoundingClientRect(), z = view.z;
      const px = prc.left + cp.pt.x * z, py = prc.top + cp.pt.y * z;
      return py < sr.top - padY || py > sr.bottom + padY || px < sr.left - padX || px > sr.right + padX;
    }
    return false;
  }
  show() {
    if (this.suppressForCtx || (this.app.contextMenu && this.app.contextMenu.el)) return this.hide();
    const s = this.app.session, sel = s && s.selection;
    if (!sel || !sel.pageId || !sel.ids.size || s.tool !== 'select') return this.hide();
    const view = this.app.workspace.view(sel.pageId);
    const page = s.pageById(sel.pageId);
    if (!view || !page || !page.blocks) return this.hide();
    const bs = [...sel.ids].map((id) => findBlock(page, id)).filter(Boolean);
    if (!bs.length) return this.hide();
    const rs = bs.map(blockRect);
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
    const z = view.z;
    if (this.el.parentNode !== document.body) document.body.append(this.el);
    this.el.hidden = false;
    const multi = bs.length >= 2;
    this.el.querySelector('[data-cmd=merge]').hidden = !multi;
    const editBtn = this.el.querySelector('[data-cmd=edit]');
    const isInsImg = bs.length === 1 && bs[0].inserted && bs[0].inserted.type === 'image';
    editBtn.hidden = false;
    editBtn.innerHTML = icon(isInsImg ? 'erase' : 'edit', 'icon icon-sm') + `<span>${isInsImg ? t('aeCrop') : t('edit')}</span>`;
    editBtn.setAttribute('data-tip', isInsImg ? t('aeCrop') : t('edit'));
    editBtn.setAttribute('aria-label', isInsImg ? t('aeCrop') : t('edit'));
    this.el.querySelector('[data-cmd=toPrevPage]').hidden = multi;
    this.el.querySelector('.ftb-row .sep').hidden = multi;
    this.el.querySelector('.ftb-row2').hidden = multi;
    editBtn.disabled = !this.app.cmdState('edit').enabled;
    this.el.querySelectorAll('[data-cmd^=swap]').forEach((b) => { b.disabled = false; });
    const w = this.el.offsetWidth, hgt = this.el.offsetHeight;
    const sr = this.app.workspace.el.getBoundingClientRect();
    const prc = view.el.getBoundingClientRect();
    const box = { x0: prc.left + x0 * z, y0: prc.top + y0 * z, x1: prc.left + x1 * z, y1: prc.top + y1 * z };
    if (box.y1 < sr.top - sr.height * 0.10 || box.y0 > sr.bottom + sr.height * 0.10 || box.x1 < sr.left - sr.width * 0.10 || box.x0 > sr.right + sr.width * 0.10) {
      this.el.hidden = true;
      return;
    }
    const useAnchor = !!(this.anchor && this.anchor.pageId === sel.pageId
      && this.anchor.x >= x0 - 24 && this.anchor.x <= x1 + 24
      && this.anchor.y >= y0 - 24 && this.anchor.y <= y1 + 24);
    const minTop = Math.max(8, sr.top + 4);
    const maxBot = Math.min(innerHeight - hgt - 8, sr.bottom - hgt - 4);
    let left, top, pos;
    if (useAnchor) {
      const ax = prc.left + this.anchor.x * z;
      const ay = prc.top + this.anchor.y * z;
      left = Math.max(8, Math.min(innerWidth - w - 8, ax - 24));
      const belowY = ay + 12;
      const aboveY = ay - hgt - 10;
      if (belowY <= maxBot) { top = Math.max(minTop, belowY); pos = 'below'; }
      else if (aboveY >= minTop) { top = Math.min(maxBot, aboveY); pos = 'above'; }
      else { top = Math.max(minTop, Math.min(maxBot, belowY)); pos = 'below'; }
    } else {
      const cx = (box.x0 + box.x1) / 2;
      left = Math.max(8, Math.min(innerWidth - w - 8, cx - w / 2));
      const gap = 6;
      const belowY = box.y1 + gap;
      const aboveY = box.y0 - hgt - gap;
      if (belowY <= maxBot) { top = Math.max(minTop, belowY); pos = 'below'; }
      else if (aboveY >= minTop) { top = Math.min(maxBot, aboveY); pos = 'above'; }
      else { top = Math.max(minTop, Math.min(maxBot, box.y1 - hgt - gap)); pos = 'below'; }
    }
    const pad = 18;
    const corners = [
      [box.x0, box.y0],
      [box.x1, box.y0],
      [box.x0, box.y1],
      [box.x1, box.y1],
    ];
    const cornerOverlapArea = (lx, ty) => {
      let area = 0;
      for (const [cx, cy] of corners) {
        const ox = Math.max(0, Math.min(lx + w, cx + pad) - Math.max(lx, cx - pad));
        const oy = Math.max(0, Math.min(ty + hgt, cy + pad) - Math.max(ty, cy - pad));
        area += ox * oy;
      }
      return area;
    };
    if (cornerOverlapArea(left, top) > 0) {
      const clampX = (v) => Math.max(8, Math.min(innerWidth - w - 8, v));
      const clampY = (v) => Math.max(minTop, Math.min(maxBot, v));
      const midX = clampX((box.x0 + box.x1 - w) * 0.5);
      const midY = clampY((box.y0 + box.y1 - hgt) * 0.5);
      const cands = [
        [clampX(left), box.y1 + pad, 'below'],
        [midX, box.y1 + pad, 'below'],
        [clampX(left), box.y0 - hgt - pad, 'above'],
        [midX, box.y0 - hgt - pad, 'above'],
        [box.x1 - w - pad, top, pos],
        [box.x0 + pad, top, pos],
        [midX, top, pos],
        [box.x0 - w - pad, top, pos],
        [box.x1 + pad, top, pos],
        [clampX(left), midY, pos],
        [midX, midY, pos],
        [box.x0 - w - pad, midY, pos],
        [box.x1 + pad, midY, pos],
        [box.x0 - w - pad, clampY(box.y0 + pad), pos],
        [box.x1 + pad, clampY(box.y0 + pad), pos],
        [box.x0 - w - pad, clampY(box.y1 - hgt - pad), pos],
        [box.x1 + pad, clampY(box.y1 - hgt - pad), pos],
      ];
      let bestZero = null, bestZeroDist = Infinity;
      let bestMin = null, bestMinArea = Infinity, bestMinDist = Infinity;
      for (const [cx, cy, cPos] of cands) {
        if (cx < 8 - 0.5 || cx + w > innerWidth - 8 + 0.5 || cy < minTop - 0.5 || cy > maxBot + 0.5) continue;
        const area = cornerOverlapArea(cx, cy);
        const dist = Math.hypot(cx - left, cy - top);
        if (area === 0) {
          if (dist < bestZeroDist) { bestZeroDist = dist; bestZero = [cx, cy, cPos]; }
        } else if (area < bestMinArea - 1 || (Math.abs(area - bestMinArea) <= 1 && dist < bestMinDist)) {
          bestMinArea = area; bestMinDist = dist; bestMin = [cx, cy, cPos];
        }
      }
      const chosen = bestZero || bestMin;
      if (chosen) { [left, top, pos] = chosen; }
    }
    this.el.style.left = Math.round(left) + 'px';
    this.el.style.top = Math.round(top) + 'px';
    this.el.dataset.pos = pos;
  }
  hide() {
    this.el.hidden = true;
    if (!(this.app.session && this.app.session.selection && this.app.session.selection.ids.size)) this.anchor = null;
  }
}
