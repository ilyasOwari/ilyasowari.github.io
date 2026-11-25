// Modal dialogs. closeOnBackdrop=false for editors (close only via buttons).
import { h } from './dom.js';
import { icon } from '../../../assets/icons/icons.js';

export function openModal({ title, body, foot, cls = '', closeOnBackdrop = false, onClose, closeButton = true }) {
  const root = document.getElementById('overlay-root');
  const head = h('div', { class: 'modal-head' }, h('div', { class: 'grow' }, title));
  const modal = h('div', { class: 'modal ' + cls, role: 'dialog', 'aria-modal': 'true' }, head, body, foot);
  const back = h('div', { class: 'modal-back' }, modal);
  const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); if (onClose) onClose(v); };
  if (closeButton) head.append(h('button', { class: 'rb-icon', 'aria-label': 'close', onclick: () => close(null), html: icon('close') }));
  if (closeOnBackdrop) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
  const onKey = (e) => { if (e.key === 'Escape' && closeOnBackdrop) { e.stopPropagation(); close(null); } };
  document.addEventListener('keydown', onKey, true);
  root.append(back);
  return { modal, close, back };
}

let loadingEl;
export function showLoading(text) {
  if (!loadingEl) { loadingEl = h('div', { class: 'loading' }, h('div', { class: 'box' }, h('div', { class: 'spinner' }), h('span', { class: 'ltxt' }))); }
  loadingEl.querySelector('.ltxt').textContent = text;
  if (!loadingEl.isConnected) document.body.append(loadingEl);
}
export function hideLoading() { if (loadingEl) loadingEl.remove(); }
