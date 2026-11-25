// Single-row ribbon with grouped sections and small labels beneath.
import { h, clear } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { icon } from '../../../assets/icons/icons.js';
import { RIBBON } from './ribbonDefs.js';

export class Ribbon {
  constructor(el, app) { this.el = el; this.app = app; this.buttons = new Map(); }
  render() {
    clear(this.el); this.buttons.clear();
    this.el.append(h('div', { class: 'rb-brand', title: t('appName') }, h('img', { src: 'favicon.svg', alt: t('appName') })));
    for (const g of RIBBON) {
      if (g.kind === 'spacer') { this.el.append(h('div', { class: 'rb-spacer' })); continue; }
      const items = h('div', { class: 'rb-items' });
      for (const it of g.items) items.append(this.item(it));
      this.el.append(h('div', { class: 'rb-group ' + (g.cls || ''), 'data-group': g.id }, items, h('div', { class: 'rb-label' }, t(g.label))));
    }
    this.update();
    this.fit();
    if (!this.ro) { this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(this.el); }
    if (document.fonts) document.fonts.ready.then(() => this.fit());
  }
  // progressively compact the ribbon until it fits in one row
  fit() {
    const levels = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
    levels.forEach((c) => this.el.classList.remove(c));
    for (const c of levels) {
      if (this.el.scrollWidth <= this.el.clientWidth + 1) break;
      this.el.classList.add(c);
    }
  }
  item(it) {
    // every command is an icon with its label underneath (labels are never hidden)
    if (it.kind === 'stack') return h('div', { class: 'rb-pair' }, it.items.map((s) => this.button(s, 'rb-btn')));
    if (it.kind === 'zoom') {
      this.zval = h('button', { class: 'zval', 'data-tip': t('fitWidth'), onclick: () => this.app.cmd('fitWidth') }, '100%');
      return h('div', { class: 'rb-zoom' },
        this.button({ cmd: 'zoomOut', icon: 'zoomOut', tip: 'zoomOut' }, 'rb-icon'), this.zval,
        this.button({ cmd: 'zoomIn', icon: 'zoomIn', tip: 'zoomIn' }, 'rb-icon'),
        this.button({ cmd: 'fitWidth', icon: 'fitWidth', tip: 'tipFit' }, 'rb-icon'));
    }
    return this.button(it, 'rb-btn' + (it.primary ? ' primary' : ''));
  }
  button(it, cls) {
    const b = h('button', { class: cls, 'data-cmd': it.cmd, 'data-tip': t(it.tip || it.label), 'aria-label': t(it.label || it.tip) });
    b.innerHTML = `<i class="ic">${icon(it.icon)}</i>` + (it.label && cls !== 'rb-icon' ? `<span>${t(it.label)}</span>` : '') + (it.menu ? icon('caret', 'caret') : '');
    if (it.hold) {
      const on = (e) => { e.preventDefault(); this.app.setBeforeAfter(true); };
      const off = () => this.app.setBeforeAfter(false);
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
      b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') on(e); });
      b.addEventListener('keyup', off);
    } else b.addEventListener('click', (e) => this.app.cmd(it.cmd, { anchor: b, event: e }));
    this.buttons.set(it.cmd, b);
    return b;
  }
  update() {
    for (const [cmd, b] of this.buttons) {
      const st = this.app.cmdState(cmd);
      b.disabled = !st.enabled;
      b.classList.toggle('active', !!st.active);
    }
    if (this.zval) this.zval.textContent = Math.round(this.app.zoom * 100) + '%';
  }
}
