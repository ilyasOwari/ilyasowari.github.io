// A small hint pill at the top of the workspace while a drawing tool is active.
import { h } from './dom.js';
let el = null;
export function showToolHint(text) {
  if (!el) el = h('div', { class: 'tool-hint', 'data-testid': 'tool-hint' });
  el.textContent = text;
  if (!el.parentNode) document.getElementById('app').append(el);
}
export function hideToolHint() { if (el) el.remove(); }
