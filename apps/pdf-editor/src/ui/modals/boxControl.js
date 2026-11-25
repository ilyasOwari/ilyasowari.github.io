// "Çerçeve" control: border colour / thickness, shape, background fill and
// opacity of a text box. Edits a box spec in place and reports changes.
// box = { shape: 'sharp'|'round'|'oval', bc, bw, bo, fc, fo, to }
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { swatchRow } from '../common/colorPick.js';

export const emptyBox = () => ({ shape: 'round', bc: null, bw: 1.5, bo: 0.3, fc: null, fo: 0.3, to: 1 });
export const boxActive = (b) => !!(b && (b.bc || b.fc));

export function boxControl({ box, onChange, onOpen, textOpacity = false }) {
  const B = box;
  const changed = () => { btn.classList.toggle('on', boxActive(B)); onChange && onChange(B); };
  const range = (key, min, max, step, testid, fmt) => {
    const out = h('span', { class: 'bx-val' });
    const inp = h('input', { type: 'range', min, max, step, value: B[key], 'data-testid': testid, oninput: () => { B[key] = +inp.value; out.textContent = fmt(B[key]); changed(); } });
    out.textContent = fmt(B[key]);
    return { el: h('div', { class: 'bx-range' }, inp, out), sync: () => { inp.value = B[key]; out.textContent = fmt(B[key]); } };
  };
  const transpRange = (key, testid) => {
    const toTransp = (op) => Math.max(0, Math.min(100, Math.round((1 - (op ?? 0.3)) * 100)));
    const out = h('span', { class: 'bx-val' });
    const inp = h('input', {
      type: 'range', min: 0, max: 100, step: 5, value: toTransp(B[key]), 'data-testid': testid,
      oninput: () => { const tp = +inp.value; B[key] = Math.round(100 - tp) / 100; out.textContent = tp + '%'; changed(); },
    });
    out.textContent = toTransp(B[key]) + '%';
    return { el: h('div', { class: 'bx-range' }, inp, out), sync: () => { const tp = toTransp(B[key]); inp.value = tp; out.textContent = tp + '%'; } };
  };
  const pct = (v) => Math.round(v * 100) + '%';
  const shapes = h('div', { class: 'bx-seg' }, ...['sharp', 'round'].map((s) => h('button', { type: 'button', class: 'bx-shape' + (B.shape === s ? ' on' : ''), 'data-testid': 'bx-shape-' + s, 'data-shape': s, onclick: (e) => { B.shape = s; shapes.querySelectorAll('.bx-shape').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); changed(); } }, h('span', { class: 'bx-ico bx-ico-' + s }), t('bxShape_' + s))));
  const row = (label, ...c) => h('div', { class: 'bx-row' }, h('span', { class: 'bx-lab' }, label), h('div', { class: 'bx-ctl' }, ...c));
  const rBw = range('bw', 0.5, 6, 0.5, 'bx-bw', (v) => v + ' pt');
  const rFo = transpRange('fo', 'bx-fo');
  const rBo = transpRange('bo', 'bx-bo');
  const rTo = textOpacity ? range('to', 0.1, 1, 0.05, 'bx-to', pct) : null;
  const swBc = swatchRow({ testid: 'bx-bc', none: t('bxNone'), current: B.bc, onPick: (c) => { B.bc = c; changed(); } });
  const swFc = swatchRow({ testid: 'bx-fc', none: t('bxNone'), current: B.fc, onPick: (c) => { B.fc = c; changed(); } });
  const pop = h('div', { class: 'bx-pop', hidden: true, 'data-testid': 'bx-pop' },
    row(t('bxFill'), swFc),
    row(t('bxFillOp'), rFo.el),
    row(t('bxBorder'), swBc),
    row(t('bxBorderOp'), rBo.el),
    row(t('bxWidth'), rBw.el),
    rTo ? row(t('bxTextOp'), rTo.el) : null,
    row(t('bxShape'), shapes));
  const labelHtml = t('bxTitle');
  const btn = h('button', { type: 'button', class: 'rt-btn rt-box' + (boxActive(B) ? ' on' : ''), 'data-testid': 'rt-box', 'data-tip': t('bxTitle'), 'aria-label': t('bxTitle'), onpointerdown: (e) => e.preventDefault(), onclick: () => toggle() }, h('span', { class: 'bx-btn-lab', html: labelHtml }));
  const wrap = h('div', { class: 'bx-wrap' }, btn);
  const syncUi = () => {
    btn.classList.toggle('on', boxActive(B));
    rBw.sync(); rFo.sync(); rBo.sync(); if (rTo) rTo.sync();
    shapes.querySelectorAll('.bx-shape').forEach((x) => x.classList.toggle('on', x.dataset.shape === (B.shape || 'round')));
    swBc.querySelectorAll('.rt-sw').forEach((s) => s.classList.toggle('on', s.classList.contains('rt-sw-none') ? !B.bc : s.dataset.color === B.bc));
    swFc.querySelectorAll('.rt-sw').forEach((s) => s.classList.toggle('on', s.classList.contains('rt-sw-none') ? !B.fc : s.dataset.color === B.fc));
  };
  // the panel floats above the dialog (attached to the page), so a scrolling toolbar never clips or shifts it
  const place = () => {
    const r = btn.getBoundingClientRect(), w = Math.min(372, window.innerWidth - 16);
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    pop.style.top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - pop.offsetHeight - 8)) + 'px';
  };
  const toggle = () => {
    if (!pop.hidden) { pop.hidden = true; return; }
    if (onOpen) { const init = onOpen(B); if (init) { Object.assign(B, emptyBox(), init); syncUi(); } }
    if (pop.parentNode !== document.body) document.body.appendChild(pop);
    pop.hidden = false; place();
  };
  const outside = (e) => { if (!wrap.contains(e.target) && !pop.contains(e.target)) pop.hidden = true; };
  const onResize = () => { if (!pop.hidden) place(); };
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', onResize);
  return { el: wrap, box: B, setBox: (v) => { Object.assign(B, emptyBox(), v || {}); syncUi(); }, destroy: () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', onResize); pop.remove(); } };
}
