// "Sayfa numaralandırma" dialog: on/off, position, first number, skip page 1.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { openModal } from '../common/modal.js';

export function openPageNumbers(app, cfg0, onDone) {
  const c = { ...cfg0 };
  const on = h('input', { type: 'checkbox', 'data-testid': 'pn-on' }); on.checked = !!c.on;
  const pos = h('select', { 'data-testid': 'pn-pos' }, ...['bc', 'bl', 'br', 'tc', 'tl', 'tr'].map((p) => h('option', { value: p }, t('pnPos_' + p))));
  pos.value = c.pos;
  const start = h('input', { type: 'number', min: 0, max: 9999, value: c.start, 'data-testid': 'pn-start', style: { width: '90px' } });
  const skip = h('input', { type: 'checkbox', 'data-testid': 'pn-skip' }); skip.checked = !!c.skipFirst;
  const body = h('div', { class: 'modal-body', style: { width: '380px' } },
    h('label', { class: 'switch' }, on, t('pnOn')),
    h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', {}, t('pnPos')), pos),
    h('div', { class: 'field' }, h('label', {}, t('pnStart')), start),
    h('label', { class: 'switch', style: { marginTop: '6px' } }, skip, t('pnSkip')));
  const ok = h('button', { class: 'btn primary', 'data-testid': 'pn-ok' }, t('ok'));
  const foot = h('div', { class: 'modal-foot' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: () => m.close(null) }, t('cancel')), ok);
  const m = openModal({ title: t('pageNums'), body, foot });
  ok.onclick = () => {
    const raw = Number(start.value);
    const stNum = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 1;
    m.close(true);
    onDone({ ...c, on: on.checked, pos: pos.value, start: stNum, skipFirst: skip.checked });
  };
  return m;
}
