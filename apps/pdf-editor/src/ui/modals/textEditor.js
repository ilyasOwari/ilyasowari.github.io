// Word-like editor for a whole block: every text group (paragraphs, rows,
// badge numbers) in reading order, each written back to its own place.
// Closes only via İptal / Uygula.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { icon } from '../../../assets/icons/icons.js';
import { openModal } from '../common/modal.js';
import { SectionEditor } from './sectionEditor.js';
import { imageOptions } from './imageOptions.js';
import { richToolbar } from './richToolbar.js';
import { boxControl, emptyBox } from './boxControl.js';

export function openTextEditor({ sections, layout = null, onApply, fonts = null, man = null, box = null, insert = null, title = null }) {
  let focused = null;
  const eds = sections.map((s) => new SectionEditor(s.model, { badge: s.badge, onFocus: (e) => { focused = e; } }));
  const imgs = sections.map((s) => (s.images || []).map((x) => ({ ...x })));
  const doc = h('div', { class: 'te-doc' });
  // a badge sits in front of the text on its row
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.model && s.model.cell) {
      // table cells of one row sit side by side, one box per column
      const row = h('div', { class: 'te-row te-cells', 'data-testid': 'te-cells' });
      let j = i;
      while (j < sections.length && sections[j].model && sections[j].model.cell && sections[j].partId === s.partId && sections[j].model.cell.row === s.model.cell.row) {
        eds[j].el.classList.add('te-cell'); eds[j].el.style.flex = '1 1 0'; eds[j].el.dataset.col = sections[j].model.cell.col;
        row.append(eds[j].el); j++;
      }
      doc.append(row); i = j - 1; continue;
    }
    if (s.badge && sections[i + 1] && !sections[i + 1].badge && Math.abs(sections[i + 1].y - s.y) < 8) {
      doc.append(h('div', { class: 'te-row' }, eds[i].el, eds[i + 1].el)); i++;
    } else doc.append(h('div', { class: 'te-row' + (s.badge ? ' te-row-badge' : '') }, eds[i].el));
  }
  const textEds = eds.filter((e) => !e.badge);
  const target = () => (focused && !focused.badge ? focused : textEds[textEds.length - 1] || eds[0]);
  const figs = h('div', { class: 'te-figs' });
  const renderFigs = () => {
    figs.textContent = '';
    imgs.forEach((list, si) => list.forEach((im, i) => {
      figs.append(h('div', { class: 'te-fig' }, h('img', { src: im.dataUrl, style: { height: '44px', verticalAlign: 'middle' } }),
        h('span', { style: { margin: '0 8px', fontSize: '12px' } }, `${t('anchors')[im.anchor]}${im.wrap ? ' · ' + t('imgWrap') : ''}${im.caption ? ' · “' + im.caption + '”' : ''}`),
        h('button', { class: 'rb-icon', 'aria-label': t('del'), onclick: () => { list.splice(i, 1); renderFigs(); }, html: icon('close', 'icon icon-sm') })));
      void si;
    }));
  };
  renderFigs();
  const addImage = () => {
    const ed = target(); const si = eds.indexOf(ed);
    const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg' });
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => imageOptions(rd.result, (opt) => { imgs[si].push(opt); renderFigs(); });
      rd.readAsDataURL(f);
    };
    inp.click();
  };
  const keep = (e) => e.preventDefault();
  const lead = [
    h('button', { class: 'btn te-lead', 'data-testid': 'te-parastart', 'data-tip': t('paraHint'), onpointerdown: keep, onclick: () => target().splitAtCaret(), html: icon('paragraph', 'icon icon-sm') + `<span>${t('paraStart')}</span>` }),
    insert ? null : h('button', { class: 'btn te-lead', 'data-testid': 'te-addimg', onclick: addImage, html: icon('image', 'icon icon-sm') + `<span>${t('imgInText')}</span>` }),
    h('span', { class: 'rt-sep' }),
  ].filter(Boolean);
  const B = Object.assign(emptyBox(), box || {});
  const bx = boxControl({ box: B, textOpacity: !!insert });
  const tail = [h('span', { class: 'rt-sep' }), bx.el];
  // inserted text: base size of the whole box
  let sizeInp = null;
  if (insert) {
    sizeInp = h('input', { type: 'number', class: 'te-size', min: 6, max: 96, step: 1, value: insert.size || 14, 'data-testid': 'te-size', 'data-tip': t('textSize') });
    tail.unshift(h('label', { class: 'te-size-wrap' }, sizeInp, h('span', {}, 'pt')));
  }
  const rt = richToolbar({ editors: eds, fonts, man, lead, tail, defaultName: insert && insert.fontName });
  const tools = h('div', { class: 'te-tools' }, rt.el);
  const area = h('div', { class: 'te-area' }, layout ? layout.el : '', doc, figs);
  const body = h('div', { class: 'te-body' }, tools, area);
  const applyBtn = h('button', { class: 'btn primary', 'data-testid': 'te-apply', html: icon('check', 'icon icon-sm') + `<span>${t('apply')}</span>` });
  const foot = h('div', { class: 'modal-foot' }, h('div', { class: 'grow' }), h('button', { class: 'btn', 'data-testid': 'te-cancel', onclick: () => m.close(null) }, t('cancel')), applyBtn);
  const m = openModal({ title: title || t('editTitle'), body, foot, cls: insert ? 'te te-insert' : 'te', closeOnBackdrop: false, closeButton: false });
  const close0 = m.close.bind(m);
  m.close = (v) => { rt.destroy(); bx.destroy(); return close0(v); };
  applyBtn.onclick = async () => {
    const results = eds.map((e, i) => ({ paras: e.value(), imgs: imgs[i] }));
    applyBtn.disabled = true;
    try { const ok = await onApply(results, layout ? layout.changes() : [], { box: B, size: sizeInp ? Math.max(6, Math.min(96, +sizeInp.value || 14)) : null }); if (ok !== false) m.close(true); } finally { applyBtn.disabled = false; }
  };
  requestAnimationFrame(() => { eds.forEach((e) => { e.fitToLines && e.fitToLines(); e.placeMarks(); }); const main = textEds.slice().sort((a, b) => b.model.text.length - a.model.text.length)[0] || eds[0]; if (main) main.focusEnd(); });
  return m;
}
