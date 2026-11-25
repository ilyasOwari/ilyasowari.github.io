// Options dialog for an image placed inside a text block.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { openModal } from '../common/modal.js';

export function imageOptions(dataUrl, done) {
  let anchor = 0, wrapOn = true, width = 35;
  const grid = h('div', { class: 'anchor-grid' });
  const draw = () => { grid.textContent = ''; t('anchors').forEach((a, i) => grid.append(h('button', { class: i === anchor ? 'on' : '', onclick: () => { anchor = i; draw(); } }, a))); };
  draw();
  const wrapIn = h('input', { type: 'checkbox', checked: true, onchange: (e) => { wrapOn = e.target.checked; } });
  const cap = h('input', { type: 'text', placeholder: '' });
  const size = h('input', { type: 'range', min: '10', max: '100', value: '35', oninput: (e) => { width = +e.target.value; sv.textContent = width + '%'; } });
  const sv = h('span', {}, '35%');
  const body = h('div', { class: 'modal-body' },
    h('img', { src: dataUrl, style: { maxWidth: '260px', maxHeight: '140px', display: 'block', margin: '0 auto 8px' } }),
    h('div', { class: 'field' }, h('label', {}, t('imgAnchor')), grid),
    h('label', { class: 'switch' }, wrapIn, t('imgWrap')),
    h('div', { class: 'field' }, h('label', {}, t('imgSize')), h('div', {}, size, ' ', sv)),
    h('div', { class: 'field' }, h('label', {}, t('imgCaption')), cap));
  const ok = h('button', { class: 'btn primary' }, t('ok'));
  const foot = h('div', { class: 'modal-foot' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: () => m.close() }, t('cancel')), ok);
  const m = openModal({ title: t('imgInText'), body, foot, closeOnBackdrop: true });
  ok.onclick = () => { m.close(); const im = new Image(); im.onload = () => done({ dataUrl, anchor, wrap: wrapOn, width: width / 100, caption: cap.value.trim(), aspect: im.naturalHeight / Math.max(1, im.naturalWidth) }); im.src = dataUrl; };
}
