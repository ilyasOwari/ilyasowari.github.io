// Delegated tooltips: any element with data-tip shows it after a short delay.
import { h } from './dom.js';
let tipEl, timer, cur;
export function initTooltips() {
  tipEl = h('div', { class: 'tip', hidden: true });
  document.body.append(tipEl);
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t === cur) return;
    hide(); cur = t;
    if (!t) return;
    timer = setTimeout(() => show(t), 450);
  });
  document.addEventListener('pointerdown', hide, true);
  window.addEventListener('blur', hide);
}
function show(t) {
  tipEl.textContent = t.dataset.tip;
  tipEl.hidden = false;
  const r = t.getBoundingClientRect(), tr = tipEl.getBoundingClientRect();
  let x = r.left + r.width / 2 - tr.width / 2, y = r.bottom + 6;
  x = Math.max(6, Math.min(innerWidth - tr.width - 6, x));
  if (y + tr.height > innerHeight - 4) y = r.top - tr.height - 6;
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
function hide() { clearTimeout(timer); if (tipEl) tipEl.hidden = true; cur = null; }
