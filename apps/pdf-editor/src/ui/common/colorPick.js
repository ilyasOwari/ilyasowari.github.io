// Preset colour swatches + a "more colours" swatch that opens the full colour chooser.
import { h } from './dom.js';
import { t } from '../../i18n/i18n.js';

export const PRESETS = [
  ['#1f1f1f', 'clBlack'], ['#d62828', 'clRed'], ['#f77f00', 'clOrange'], ['#e9b400', 'clYellow'],
  ['#2a9d3f', 'clGreen'], ['#1d4ed8', 'clBlue'], ['#7b2cbf', 'clPurple'], ['#e0457b', 'clPink'],
];
// The custom swatch: a rainbow chip over an invisible <input type=color>.
// beforeOpen() runs on press (e.g. to remember the text selection).
export function customSwatch({ onPick, beforeOpen, testid, value = '#3366cc' }) {
  const inp = h('input', { type: 'color', class: 'cp-input', 'data-testid': testid, value, 'aria-label': t('clCustom') });
  const chip = h('label', { class: 'rt-sw cp-custom', 'data-tip': t('clCustom') }, inp);
  chip.addEventListener('pointerdown', () => beforeOpen && beforeOpen());
  const fire = () => onPick(inp.value);
  inp.addEventListener('input', fire);
  inp.addEventListener('change', fire);
  return chip;
}
// a full swatch row: presets (+ optional "none") + custom
export function swatchRow({ onPick, none = null, testid = 'cp', current = null }) {
  const row = h('div', { class: 'rt-swatches cp-row' });
  const mark = (c) => row.querySelectorAll('.rt-sw').forEach((b) => b.classList.toggle('on', (b.dataset.color || null) === c));
  const pick = (c) => { mark(c); onPick(c); };
  for (const [c, k] of PRESETS) row.append(h('button', { type: 'button', class: 'rt-sw', 'data-testid': testid + '-sw', 'data-color': c, 'data-tip': t(k), 'aria-label': t(k), style: { background: c }, onclick: () => pick(c) }));
  if (none) row.append(h('button', { type: 'button', class: 'rt-sw rt-sw-none', 'data-testid': testid + '-none', 'data-tip': none, 'aria-label': none, onclick: () => pick(null) }));
  row.append(customSwatch({ onPick: (c) => pick(c), testid: testid + '-custom', value: current || '#3366cc' }));
  mark(current);
  return row;
}
