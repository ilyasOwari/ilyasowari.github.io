// Left sidebar: "Sayfa 1, 2, 3" with thumbnails; add a blank page.
import { h, clear } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { icon } from '../../../assets/icons/icons.js';
import { renderPage } from '../../engines/render/pdfjs.js';

const TW = 100;
export class Sidebar {
  constructor(el, app) {
    this.el = el; this.app = app; this.items = new Map(); this.timers = new Map();
    this.selected = new Set(); this.anchorId = null;
  }
  render() {
    clear(this.el);
    this.list = h('div', { class: 'sb-list' });
    this.selAllBtn = h('button', {
      type: 'button', class: 'sb-sel-all', 'data-testid': 'sb-select-all',
      onclick: () => this.toggleSelectAll(),
    }, t('selectAllPages'));
    this.mergePdfBtn = h('button', {
      type: 'button', class: 'sb-sel-all sb-merge-pdf', 'data-testid': 'sb-merge-pdf',
      'data-tip': t('tipMergePdf'),
      onclick: () => this.app.cmd('mergePdf'),
    }, t('mergePdf'));
    this.bulkDelBtn = h('button', {
      type: 'button', class: 'sb-bulk-del', 'data-testid': 'sb-bulk-del', hidden: true,
      onclick: () => this.deleteSelected(),
      html: icon('trash', 'icon icon-xs') + `<span>${t('deletePages')}</span>`,
    });
    const actions = h('div', { class: 'sb-actions' }, this.selAllBtn, this.mergePdfBtn, this.bulkDelBtn);
    this.el.append(h('div', { class: 'sb-head' }, t('pages')), actions, this.list,
      h('button', { class: 'btn sb-add', 'data-tip': t('tipBlank'), onclick: () => this.app.cmd('blankPage'), html: icon('page', 'icon icon-sm') + `<span>${t('addBlank')}</span>` }));
    this.items.clear();
    this.sync();
  }
  toggleSelectAll() {
    const pages = this.app.session.pages;
    if (!pages.length) return;
    if (this.selected.size >= pages.length) {
      this.selected.clear();
      const cur = this.app.workspace.currentPageId();
      if (cur) { this.selected.add(cur); this.anchorId = cur; }
    } else {
      this.selected = new Set(pages.map((p) => p.id));
      this.anchorId = pages[0].id;
    }
    this.syncSelection();
  }
  deleteSelected() {
    const pages = this.app.session.pages;
    if (this.selected.size < 2 || this.selected.size >= pages.length) return;
    this.app.cmd('deletePages', { pageIds: [...this.selected] });
  }
  syncSelection() {
    const pages = this.app.session.pages;
    const valid = new Set(pages.map((p) => p.id));
    for (const id of [...this.selected]) if (!valid.has(id)) this.selected.delete(id);
    for (const [pid, it] of this.items) it.el.classList.toggle('selected', this.selected.has(pid));
    if (this.selAllBtn) this.selAllBtn.classList.toggle('on', pages.length > 0 && this.selected.size >= pages.length);
    if (this.bulkDelBtn) {
      const cnt = this.selected.size;
      this.bulkDelBtn.hidden = cnt < 2;
      this.bulkDelBtn.disabled = cnt >= pages.length;
      const sp = this.bulkDelBtn.querySelector('span');
      if (sp) sp.textContent = `${t('deletePages')} (${cnt})`;
    }
  }
  onItemClick(e, p) {
    if (this._justDragged) return;
    const pages = this.app.session.pages;
    if (e.shiftKey) {
      const anchor = this.anchorId || this.app.workspace.currentPageId() || (pages[0] && pages[0].id);
      const i0 = pages.findIndex((x) => x.id === anchor);
      const i1 = pages.findIndex((x) => x.id === p.id);
      if (i0 >= 0 && i1 >= 0) {
        const a = Math.min(i0, i1), b = Math.max(i0, i1);
        if (!(e.ctrlKey || e.metaKey)) this.selected.clear();
        for (let i = a; i <= b; i++) this.selected.add(pages[i].id);
      }
      this.syncSelection();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (!this.selected.size) {
        const cur = this.app.workspace.currentPageId();
        if (cur && cur !== p.id) this.selected.add(cur);
      }
      if (this.selected.has(p.id)) this.selected.delete(p.id);
      else this.selected.add(p.id);
      this.anchorId = p.id;
      this.syncSelection();
      return;
    }
    this.selected.clear();
    this.selected.add(p.id);
    this.anchorId = p.id;
    this.syncSelection();
    this.app.goToPage(p.id);
  }
  wireDrag(el, p) {
    el.addEventListener('dragstart', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const pages = this.app.session.pages;
      if (pages.length < 2) return;
      const startY = e.clientY;
      let dragging = false, dropLine = null, rawIdx = -1, movingIds = [], movingSet = null, raf = 0, lastY = startY;
      const stopScroll = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
      const tickScroll = () => {
        if (!dragging) return;
        const lr = this.list.getBoundingClientRect();
        let dy = 0;
        if (lastY < lr.top + 28) dy = -6;
        else if (lastY > lr.bottom - 28) dy = 6;
        if (dy) { this.list.scrollTop += dy; placeDrop(lastY); raf = requestAnimationFrame(tickScroll); }
        else raf = 0;
      };
      const placeDrop = (cy) => {
        const items = [...this.list.querySelectorAll('.sb-item')];
        rawIdx = items.length;
        for (let i = 0; i < items.length; i++) {
          const r = items[i].getBoundingClientRect();
          if (cy < (r.top + r.bottom) / 2) { rawIdx = i; break; }
        }
        if (dropLine) {
          if (rawIdx < items.length) this.list.insertBefore(dropLine, items[rawIdx]);
          else this.list.append(dropLine);
        }
      };
      const cleanup = () => {
        stopScroll();
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onCancel, true);
        window.removeEventListener('keydown', onKey, true);
        if (dropLine) dropLine.remove();
        if (this.list) this.list.classList.remove('sb-dragging');
        for (const id of movingIds) this.items.get(id)?.el.classList.remove('dragging');
        if (dragging) setTimeout(() => { this._justDragged = false; }, 0);
      };
      const onMove = (ev) => {
        lastY = ev.clientY;
        if (!dragging) {
          if (Math.abs(ev.clientY - startY) < 5) return;
          dragging = true;
          this._justDragged = true;
          const curPages = this.app.session.pages;
          movingIds = (this.selected.has(p.id) && this.selected.size > 1 && this.selected.size < curPages.length)
            ? curPages.filter((pg) => this.selected.has(pg.id)).map((pg) => pg.id)
            : [p.id];
          movingSet = new Set(movingIds);
          this.list.classList.add('sb-dragging');
          for (const id of movingIds) this.items.get(id)?.el.classList.add('dragging');
          dropLine = h('div', { class: 'sb-drop-line' });
        }
        placeDrop(ev.clientY);
        if (!raf) raf = requestAnimationFrame(tickScroll);
      };
      const onUp = () => {
        const didDrag = dragging && rawIdx >= 0;
        const idx = rawIdx, mSet = movingSet;
        cleanup();
        if (!didDrag || !mSet) return;
        const curPages = this.app.session.pages;
        let insPos = 0;
        for (let i = 0; i < idx && i < curPages.length; i++) {
          if (!mSet.has(curPages[i].id)) insPos++;
        }
        const rest = curPages.filter((pg) => !mSet.has(pg.id)).map((pg) => pg.id);
        const moving = curPages.filter((pg) => mSet.has(pg.id)).map((pg) => pg.id);
        const nextOrder = [...rest.slice(0, insPos), ...moving, ...rest.slice(insPos)];
        this.app.cmd('reorderPages', { order: nextOrder, focusId: p.id });
      };
      const onCancel = () => cleanup();
      const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); cleanup(); } };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
      window.addEventListener('keydown', onKey, true);
    });
  }
  sync() {
    const pages = this.app.session.pages;
    const keep = new Map();
    pages.forEach((p, i) => {
      let it = this.items.get(p.id);
      if (!it) {
        const c = h('canvas', { class: 'sb-thumb', width: TW * 2, height: Math.round((TW * 2 * p.h) / p.w) });
        const name = h('div', { class: 'sb-name' });
        const el = h('div', { class: 'sb-item', 'data-page-id': p.id, tabindex: '0', onclick: (e) => this.onItemClick(e, p) }, c, name);
        this.wireDrag(el, p);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.app.goToPage(p.id);
          else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.size >= 2) { e.preventDefault(); this.deleteSelected(); }
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (!this.selected.has(p.id)) {
            this.selected.clear(); this.selected.add(p.id); this.anchorId = p.id; this.syncSelection();
          }
          const multi = this.selected.size >= 2;
          this.app.contextMenu.show(e.clientX, e.clientY, [
            { label: t('addBlank'), icon: 'page', cmd: 'blankPage', args: { after: p.id } },
            { label: t('mergePdf'), icon: 'open', cmd: 'mergePdf', args: { after: p.id } },
            { label: t('resetPage'), icon: 'reset', cmd: 'resetPage', args: { pageId: p.id } },
            multi
              ? { label: `${t('deletePages')} (${this.selected.size})`, icon: 'trash', cmd: 'deletePages', args: { pageIds: [...this.selected] }, danger: true, disabled: this.selected.size >= this.app.session.pages.length }
              : { label: t('deletePage'), icon: 'trash', cmd: 'deletePage', args: { pageId: p.id }, danger: true, disabled: this.app.session.pages.length < 2 },
          ]);
        });
        it = { el, c, name, drawn: false };
        this.initialThumb(p, c).then(() => { it.drawn = true; });
      }
      it.name.textContent = `${t('page')} ${i + 1}`;
      keep.set(p.id, it);
      this.list.append(it.el);
    });
    for (const [id, it] of this.items) if (!keep.has(id)) it.el.remove();
    this.items = keep;
    this.setActive(this.app.workspace.currentPageId());
    this.syncSelection();
  }
  async initialThumb(p, c) {
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    if (p.srcIndex === null) return;
    try {
      const pg = await this.app.session.pdfjs.getPage(p.srcIndex + 1);
      const vp = pg.getViewport({ scale: 1 });
      const tmp = document.createElement('canvas');
      await renderPage(pg, c.width / vp.width, tmp);
      if (!(p.version > 0)) ctx.drawImage(tmp, 0, 0, c.width, c.height);
    } catch (e) { console.warn('thumb', e); }
  }
  // redraw from the page view (debounced)
  refresh(view) {
    const it = this.items.get(view.page.id); if (!it) return;
    clearTimeout(this.timers.get(view.page.id));
    this.timers.set(view.page.id, setTimeout(() => { if (view.page.version > 0 || view.page.srcIndex === null) view.snapshot(it.c); }, 250));
  }
  setActive(id) {
    for (const [pid, it] of this.items) it.el.classList.toggle('active', pid === id);
    const it = this.items.get(id);
    if (it) { const r = it.el.getBoundingClientRect(), lr = this.list.getBoundingClientRect(); if (r.top < lr.top || r.bottom > lr.bottom) it.el.scrollIntoView({ block: 'nearest' }); }
  }
}
