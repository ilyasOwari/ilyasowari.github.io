// Custom right-click menu; closes on outside click, Esc or scroll.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { icon } from '../../../assets/icons/icons.js';

export class ContextMenu {
  constructor(app) {
    this.app = app; this.el = null;
    document.addEventListener('pointerdown', (e) => { if (this.el && !this.el.contains(e.target)) this.hide(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); });
    window.addEventListener('blur', () => this.hide());
  }
  show(x, y, items) {
    this.hide();
    const build = (list) => h('div', { class: 'ctx-list' }, list.map((it) => {
      if (it === '-') return h('div', { class: 'sep' });
      const row = h('div', { class: 'item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : ''), role: 'menuitem', 'data-cmd': it.cmd || '' });
      row.innerHTML = (it.icon ? icon(it.icon, 'icon icon-sm') : '<span style="width:16px"></span>') + `<span>${it.label}</span>`;
      if (it.sub) {
        row.insertAdjacentHTML('beforeend', icon('right', 'icon icon-sm sub-caret'));
        const sub = h('div', { class: 'submenu ctx' }, build(it.sub));
        row.append(sub);
      } else row.addEventListener('click', (e) => { e.stopPropagation(); this.hide(); this.app.cmd(it.cmd, { ...(it.args || {}), viaMenu: true }); });
      return row;
    }));
    this.el = h('div', { class: 'ctx', role: 'menu' }, build(items));
    document.body.append(this.el);
    const r = this.el.getBoundingClientRect();
    this.el.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
    this.el.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
  }
  hide() { if (this.el) { this.el.remove(); this.el = null; } }
}
export function blockMenuItems(app, page, hasBlock) {
  const sel = app.session.selection;
  const n = sel.pageId === page.id ? sel.ids.size : 0;
  const st = (c) => app.cmdState(c).enabled;
  if (!hasBlock || !n) {
    return [
      { label: t('ctxSelectAll'), icon: 'marquee', cmd: 'selectAll', args: { pageId: page.id } },
      { label: t('ctxPaste'), icon: 'text', cmd: 'insertText' },
      { label: t('insertImage'), icon: 'image', cmd: 'insertImage' },
      { label: t('insertTableEllipsis'), icon: 'table', cmd: 'insertTableModal' },
    ];
  }
  const selBlocks = app.selBlocks();
  const isInsertedObj = selBlocks.length === 1 && (!!selBlocks[0].inserted || !!(selBlocks[0].parts && selBlocks[0].parts.some((p) => p.addedTable)));
  const canCrop = selBlocks.length === 1 && (!selBlocks[0].inserted || selBlocks[0].inserted.type === 'image');
  return [
    st('makeFree') ? { label: t('ctxMakeFree'), icon: 'freeObj', cmd: 'makeFree' } : null,
    st('unfree') ? { label: t(isInsertedObj ? 'ctxIncludeLayout' : 'ctxUnfree'), icon: 'toLayout', cmd: 'unfree' } : null,
    { label: t('ctxNextPage'), icon: 'down', cmd: 'toNextPage', 'data-testid': 'ctx-nextpage' },
    '-',
    { label: t('alignCenter'), icon: 'alignCenter', cmd: 'alignCenter', disabled: !st('alignCenter') },
    { label: t('ctxCopy'), icon: 'copy', cmd: 'copy', disabled: !st('copy') },
    { label: t('crop'), icon: 'crop', cmd: 'ctxCrop', disabled: !canCrop },
    '-',
    { label: t('ctxBg'), icon: 'bgRemove', disabled: !st('bgMenu'), sub: [
      { label: t('whiteBg'), cmd: 'bg', args: { mode: 'white' } },
      { label: t('naturalBg'), cmd: 'bg', args: { mode: 'natural' } },
      { label: t('ctxBringBack'), cmd: 'bg', args: { mode: null } },
    ] },
  ].filter(Boolean);
}
