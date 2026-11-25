// PDF Flow by Owari — application shell.
import { Session, OpenError } from './core/session.js';
import { Controller } from './core/controller.js';
import { EventBus } from './core/eventBus.js';
import { autosave } from './core/autosave.js';
import { t, onLang } from './i18n/i18n.js';
import { h } from './ui/common/dom.js';
import { toast } from './ui/common/toast.js';
import { initTooltips } from './ui/common/tooltip.js';
import { showLoading, hideLoading } from './ui/common/modal.js';
import { renderWelcome } from './ui/welcome.js';
import { Ribbon } from './ui/ribbon/ribbon.js';
import { Sidebar } from './ui/sidebar/sidebar.js';
import { Workspace } from './ui/workspace/workspace.js';
import { FloatingToolbar } from './ui/workspace/floatingToolbar.js';
import { ContextMenu, blockMenuItems } from './ui/workspace/contextMenu.js';
import { RasterCache } from './ui/workspace/rasterCache.js';
import { editCommands } from './app/editCommands.js';
import { ocrScan } from './app/ocrScan.js';
import { clearSourceForms } from './engines/render/preview.js';
import { askPassword, openSettings } from './ui/modals/simpleModals.js';
import { buildOutput } from './engines/export/exporter.js';
import { renderImages, makeZip, DPI as IMG_DPI } from './engines/export/imageExport.js';
import { findBlock, blockRect } from './model/blockOps.js';
import { fallbackSrcIndex } from './model/blockState.js';
import { planMove } from './model/clamp.js';
import { blockInk, snapCut } from './core/cutSnap.js';
import { edgeFill, inkColor } from './ui/workspace/compose.js';
import { defaultPageNums, detectOldPageNumbers, removeOldPageNumbers } from './model/pageNumbers.js';
import { askRemoveOldPageNums } from './ui/modals/simpleModals.js';
import { commitMulti } from './core/pageOps.js';
import { cascadeUp, cascadeUpAll } from './core/magnetFlow.js';
import { openPageNumbers } from './ui/modals/pageNumbersModal.js';
import { showToolHint, hideToolHint } from './ui/common/toolHint.js';
import { icon } from '../assets/icons/icons.js';
import { APP_VERSION } from './core/version.js';
import { useImageStore, dehydratePage } from './core/imageStore.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.bus = new EventBus();
    this.zoom = 1;
    this.pending = new Set();
    this.fontFaces = new Map();
    this.session = null;
    this.ribbon = new Ribbon($('ribbon'), this);
    this.workspace = new Workspace($('workspace'), this);
    this.sidebar = new Sidebar($('sidebar'), this);
    this.floating = new FloatingToolbar(this);
    this.contextMenu = new ContextMenu(this);
    this.wire();
  }

  wire() {
    initTooltips();
    $('file-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.openFile(f); });
    this.bus.on('page:changed', (page) => { const v = this.workspace.view(page.id); if (v) v.render(); this.afterChange(); });
    this.bus.on('pages:changed', () => { this.workspace.sync(); this.sidebar.sync(); this.afterChange(); });
    this.bus.on('selection', () => { this.refreshSelection(); });
    this.bus.on('history', () => this.ribbon.update());
    this.bus.on('reveal', (page) => this.workspace.reveal(page));
    this.bus.on('page:rendered', (view) => { this.sidebar.refresh(view); if (this.session.selection.pageId === view.page.id) this.floating.show(); });
    this.bus.on('zoom', () => { this.ribbon.update(); this.floating.show(); this.scheduleSave(2500); });
    this.bus.on('scroll', () => {
      this.floating.show();
      if (this.contextMenu && this.contextMenu.el && this.floating.isOutOfView(0.10)) this.hideContextMenu();
      clearTimeout(this.scrollT);
      this.scrollT = setTimeout(() => { this.sidebar.setActive(this.workspace.currentPageId()); this.ribbon.update(); this.updateStatus(); this.scheduleSave(2500); }, 80);
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('contextmenu', (e) => {
      if (!e.defaultPrevented) this.hideContextMenu();
      // text fields keep the browser menu (copy / paste)
      if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
    });
    document.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.session || $('welcome').hidden === false) return;
      if (document.getElementById('overlay-root').children.length) return;
      if (e.target.closest('.page, .ftb, .ctx, .it-pop, .modal-back, .sb-item, button, input, select, textarea, a, label, [role="menuitem"]')) return;
      this.hideContextMenu();
      if (this.session.tool === 'crop' || this.session.tool === 'insertSpot') this.setTool('select');
      if (this.session.selection.ids.size) this.select(null, []);
    });
    // tab hidden / browser closing: write the pending state right away
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flushSave(); });
    window.addEventListener('pagehide', () => this.flushSave());
    window.addEventListener('beforeunload', (e) => { if (this.session && this.session.dirty) { e.preventDefault(); e.returnValue = t('unsavedWarn'); return t('unsavedWarn'); } });
    // drop a new PDF onto the workspace
    const ws = $('workspace');
    ws.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    ws.addEventListener('drop', (e) => { const f = [...(e.dataTransfer?.files || [])][0]; if (f) { e.preventDefault(); if (/^image\//.test(f.type)) this.insertImageFile(f, { instant: true }); else this.confirmReplace() && this.openFile(f); } });
    $('workspace').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); const r = ws.getBoundingClientRect(); this.workspace.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX - r.left, y: e.clientY - r.top }); } }, { passive: false });
    document.addEventListener('paste', (e) => {
      if (!this.session || $('welcome').hidden === false || document.getElementById('overlay-root').children.length) return;
      const tg = e.target;
      if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
      const item = [...(e.clipboardData?.items || [])].find((it) => /^image\//.test(it.type));
      const f = item ? item.getAsFile() : [...(e.clipboardData?.files || [])].find((x) => /^image\//.test(x.type));
      if (f) { e.preventDefault(); this.insertImageFile(f, { instant: true }); }
    });
    onLang(() => this.relabel());
  }

  async start() {
    this.showWelcome(null);
    let saved = null;
    try {
      saved = autosave.enabled() ? await Promise.race([autosave.load(), new Promise((r) => setTimeout(() => r(null), 4000))]) : null;
    } catch (e) { console.warn('autosave load', e); saved = null; }
    // only offer a usable saved document
    if (saved && !(saved.bytes && saved.bytes.length)) saved = null;
    if (saved && !this.session) this.showWelcome(saved);
  }
  showWelcome(saved) {
    $('welcome').hidden = false;
    renderWelcome($('welcome'), { onFile: (f) => this.openFile(f), hasResume: !!saved, resumeName: saved ? saved.name + '.pdf' : '', onResume: () => this.resume(saved) });
  }
  relabel() {
    if (!this.session) { this.start(); return; }
    document.documentElement.lang = t('appName') && (localStorage.getItem('pdfflow.lang') || 'tr');
    this.ribbon.render(); this.sidebar.render(); if (this.floating) this.floating.destroy(); this.floating = new FloatingToolbar(this); this.workspace.relayout(); this.updateStatus();
  }

  // ---------- open ----------
  async openFile(file) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast(t('errNotPdf'), { error: true }); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.openBytes(bytes, file.name);
  }
  // restore = a saved last document (autosave.load()) being reopened
  async openBytes(bytes, name, restore = null) {
    showLoading(t('loading'));
    const timer = setTimeout(() => showLoading(t('preparing')), 1500);
    try {
      const s = await Session.open(bytes, name, (wrong) => { hideLoading(); return askPassword(wrong).then((v) => { showLoading(t('loading')); return v; }); });
      useImageStore(s.images);
      s.docId = (restore && restore.docId) || `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      let view = null;
      if (restore) {
        for (const [id, url] of restore.images || []) s.images.map.set(id, url);
        const n0 = s.pages.length;
        if (Array.isArray(restore.pages) && restore.pages.length && restore.pages.every((p) => p && (p.srcIndex === null || (p.srcIndex >= 0 && p.srcIndex < n0)))) {
          s.pages = restore.pages.map((p) => ({ ...p, version: 1 }));
          s.pages.forEach(dehydratePage); // v5.1 saves kept pictures inline
          s.dirty = restore.dirty !== false;
        }
        const st = restore.settings || {};
        if (st.pageNums) s.pageNums = { ...st.pageNums };
        s.oldPageNumsAsked = !!st.oldPageNumsAsked;
        if (st.magnet === false) s.magnet = false;
        s.lockPage = !!st.lockPage;
        if (st.insertFlow === false) s.insertFlow = false;
        view = { zoom: st.zoom || null, pageIndex: st.pageIndex ?? null };
      }
      if (this.session && this.session.pdfjs) try { this.session.pdfjs.destroy(); } catch { /* */ }
      this.session = s;
      this.controller = new Controller(s, this.bus);
      this.rasters = new RasterCache(s);
      this.fileHandle = null;
      this.showEditor(view);
      s.analyzeAllInBackground();
      // remember this document (a new one replaces the previously saved one)
      if (autosave.enabled() && (!restore || !restore.docId)) autosave.saveDoc(s, this.viewState()).catch((e) => console.warn('autosave', e));
    } catch (e) {
      if (e instanceof OpenError) console.warn('open failed:', e.code, e.detail || ''); else console.error(e);
      if (e instanceof OpenError && e.code === 'cancelled') return;
      const msg = e instanceof OpenError ? t(e.code) : t('errBroken');
      toast(msg + (e.detail && !(e instanceof OpenError && e.code === 'errNotPdf') ? ` (${String(e.detail).slice(0, 80)})` : ''), { error: true });
    } finally { clearTimeout(timer); hideLoading(); }
  }
  async resume(saved) {
    await this.openBytes(saved.bytes, saved.name + '.pdf', saved);
  }
  async mergeFiles(files, afterId = null) {
    if (!this.session || !files || !files.length) return;
    const pdfFiles = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfFiles.length) { toast(t('errNotPdf'), { error: true }); return; }
    const cur = this.currentPage();
    const anchorId = afterId || (cur && cur.id) || (this.session.pages[this.session.pages.length - 1]?.id);
    showLoading(t('loading'));
    const timer = setTimeout(() => showLoading(t('preparing')), 1500);
    this.busy = true;
    try {
      await Promise.allSettled([...this.pending, ...(this.rasters ? this.rasters.map.values() : [])]);
      const allAdded = [];
      for (const f of pdfFiles) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const added = await this.session.appendPdf(bytes, (wrong) => {
          hideLoading();
          return askPassword(wrong).then((v) => { showLoading(t('loading')); return v; });
        });
        allAdded.push(...added);
      }
      if (allAdded.length) {
        this.controller.insertPagesAfter(anchorId, allAdded);
        this.session.analyzeAllInBackground();
        if (autosave.enabled()) autosave.saveDoc(this.session, this.viewState()).catch((e) => console.warn('autosave', e));
        toast(t('pdfMerged').replace('{n}', String(allAdded.length)));
        setTimeout(() => this.goToPage(allAdded[0].id), 50);
      }
    } catch (e) {
      if (e instanceof OpenError && e.code === 'cancelled') return;
      const msg = e instanceof OpenError ? t(e.code) : t('errBroken');
      toast(msg + (e.detail && !(e instanceof OpenError && e.code === 'errNotPdf') ? ` (${String(e.detail).slice(0, 80)})` : ''), { error: true });
    } finally {
      this.busy = false;
      clearTimeout(timer);
      hideLoading();
    }
  }
  viewState() {
    const s = this.session; if (!s || !this.workspace.views.size) return { zoom: this.zoom, pageIndex: 0 };
    const id = this.workspace.currentPageId();
    return { zoom: this.zoom, pageIndex: Math.max(0, s.pages.findIndex((p) => p.id === id)) };
  }
  // write the editing state soon (debounced); settings, zoom and scrolling count too
  scheduleSave(delay = 1500) {
    if (!this.session || !autosave.enabled()) return;
    clearTimeout(this.asT);
    this.asPending = true;
    this.asT = setTimeout(() => this.flushSave(), delay);
  }
  flushSave() {
    clearTimeout(this.asT);
    if (!this.asPending || !this.session) return;
    this.asPending = false;
    autosave.save(this.session, this.viewState()).catch((e) => console.warn('autosave', e));
  }
  showEditor(view = null) {
    $('welcome').hidden = true;
    $('ribbon').hidden = false; $('sidebar').hidden = false; $('statusbar').hidden = false;
    this.ribbon.render();
    this.workspace.build();
    this.sidebar.render();
    this.setTool('select');
    requestAnimationFrame(() => {
      if (view && view.zoom) this.workspace.setZoom(view.zoom); else this.workspace.fitWidth(1.5);
      this.workspace.el.scrollTop = 0;
      const pg = view && view.pageIndex ? this.session.pages[view.pageIndex] : null;
      if (pg) this.workspace.scrollToPage(pg.id);
      this.updateStatus();
    });
    document.title = `${this.session.name} — ${t('appName')}`;
  }
  confirmReplace() { return !this.session || !this.session.dirty || confirm(t('newDoc')); }

  // ---------- selection / tools ----------
  select(page, ids) {
    this.session.selection = { pageId: page ? page.id : null, ids: new Set(ids) };
    this.refreshSelection();
  }
  refreshSelection() {
    for (const v of this.workspace.views.values()) v.refreshSelection();
    this.floating.show();
    this.ribbon.update();
    this.updateStatus();
  }
  setTool(tool) {
    const prev = this.session.tool;
    this.session.tool = tool;
    if (tool !== 'insertSpot') this.pendingInsert = null;
    const sel = this.session.selection;
    for (const v of this.workspace.views.values()) {
      if (v.scissors && tool !== 'split') v.scissors.cancel();
      if (v.crop && tool !== 'crop') v.crop.cancel();
      if (v.insertGuide && tool !== 'insertSpot') v.insertGuide.cancel();
      // Böl ve Ayır started with one block selected: the scissors stay in it
      if (v.scissors && tool === 'split' && prev !== 'split') v.scissors.focusId = sel.pageId === v.page.id && sel.ids.size === 1 ? [...sel.ids][0] : null;
    }
    for (const v of this.workspace.views.values()) {
      v.el.classList.toggle('tool-split', tool === 'split');
      v.el.classList.toggle('tool-erase', tool === 'erase');
      v.el.classList.toggle('tool-marquee', tool === 'marquee');
      v.el.classList.toggle('tool-cover', tool === 'cover' || tool === 'scanArea' || tool === 'restoreArea');
      v.el.classList.toggle('tool-crop', tool === 'crop');
      v.el.classList.toggle('tool-insertSpot', tool === 'insertSpot');
    }
    if (tool === 'cover') showToolHint(t(this.coverMode === 'letter' ? 'letterHint' : 'coverHint')); else if (tool === 'scanArea') showToolHint(t('scanAreaHint')); else if (tool === 'restoreArea') showToolHint(t('restoreAreaHint')); else if (tool === 'crop') showToolHint(t('cropHint')); else if (tool === 'insertSpot') showToolHint(t('insertGuideHint')); else hideToolHint();
    if (tool === 'crop' && sel.pageId && sel.ids.size === 1) { const v = this.workspace.view(sel.pageId); if (v && v.crop) v.crop.start([...sel.ids][0]); }
    this.floating.show();
    this.ribbon.update();
  }
  selPage() { const s = this.session.selection; return s.pageId ? this.session.pageById(s.pageId) : null; }
  selBlocks() { const p = this.selPage(); if (!p || !p.blocks) return []; return [...this.session.selection.ids].map((id) => findBlock(p, id)).filter(Boolean); }
  currentPage() { return this.session.pageById(this.workspace.currentPageId()) || this.selPage() || this.session.pages[0]; }
  canEdit(page, b) {
    if (b.inserted) return b.inserted.type === 'text' || b.inserted.type === 'image';
    return fallbackSrcIndex(this.session, page) !== null && b.parts.some((p) => p.src || p.kind === 'instext' || p.kind === 'insimg' || p.addedTable);
  }
  hideFloating() { this.floating.hide(); }
  showFloating() { this.floating.show(); }
  hideContextMenu() { this.contextMenu.hide(); }
  markMenuInsert(args) { if (this.ctxPoint) this.ctxPoint.forInsert = !!(args && args.viaMenu); }
  showContextMenu(x, y, page, pt, onBlock) { this.ctxPoint = { page, pt, at: Date.now() }; this.hideFloating(); this.contextMenu.show(x, y, blockMenuItems(this, page, onBlock)); }
  toastKey(k) { toast(t(k)); }
  goToPage(id) { this.workspace.scrollToPage(id); this.sidebar.setActive(id); this.ribbon.update(); }

  // ---------- commands ----------
  cmdState(cmd) {
    const s = this.session;
    if (!s) return { enabled: false };
    const sel = this.selBlocks();
    const page = this.selPage();
    switch (cmd) {
      case 'undo': return { enabled: s.history.canUndo() };
      case 'redo': return { enabled: s.history.canRedo() };
      case 'tool:select': case 'tool:marquee': case 'tool:split': case 'tool:erase': case 'tool:crop': case 'tool:cover': case 'tool:scanArea': case 'tool:restoreArea': case 'coverMenu': return { enabled: true, active: s.tool === (cmd === 'coverMenu' ? 'cover' : cmd.slice(5)) };
      case 'magnet': return { enabled: true, active: s.magnet !== false };
      case 'lockPage': return { enabled: true, active: !!s.lockPage };
      case 'insertFlow': return { enabled: true, active: s.insertFlow !== false };
      case 'pageNums': return { enabled: true, active: !!(s.pageNums && s.pageNums.on) };
      case 'toPrevPage': case 'toNextPageAdj': return { enabled: sel.length > 0 };
      case 'makeFree': return { enabled: sel.length === 1 && !sel[0].free };
      case 'unfree': return { enabled: sel.length === 1 && !!sel[0].free };
      case 'edit': case 'editText': return { enabled: sel.length >= 1 && sel.every((b) => this.canEdit(page, b)) };
      case 'delete': case 'toNextPage': return { enabled: sel.length > 0 };
      case 'merge': return { enabled: sel.length > 1 };
      case 'ungroup': return { enabled: sel.length === 1 && sel[0].parts.length > 1 };
      case 'bgMenu': return { enabled: sel.length > 0 && sel.some((b) => b.parts.some((p) => p.src)) };
      case 'alignCenter': case 'copy': return { enabled: sel.length > 0 };
      case 'scanPage': { const p = this.currentPage(); return { enabled: !!p && !!(this.workspace && this.workspace.view(p.id)) }; }
      case 'whiteAll': { const p = this.currentPage(); return { enabled: !!p && p.srcIndex !== null, active: !!(p && p.whiteBg) }; }
      case 'wordFonts': return this.wordFontsState();
      case 'resetPage': { const p = this.currentPage(); return { enabled: !!p && !!p.blocks }; }
      case 'save': case 'saveAs': return { enabled: true };
      default: return { enabled: true };
    }
  }
  async cmd(cmd, args = {}) {
    if (!this.session || this.busy) return;
    const C = this.controller;
    const page = this.selPage();
    const ids = [...this.session.selection.ids];
    try {
      switch (cmd) {
        case 'undo': C.undo(); break;
        case 'redo': C.redo(); break;
        case 'coverMenu': case 'tool:cover': this.coverMode = 'natural'; this.setTool(this.session.tool === 'cover' ? 'select' : 'cover'); break;
        case 'magnet': this.session.magnet = this.session.magnet === false; toast(t(this.session.magnet ? 'magnetOn' : 'magnetOff')); this.scheduleSave(); break;
        case 'lockPage': this.session.lockPage = !this.session.lockPage; toast(t(this.session.lockPage ? 'lockPageOn' : 'lockPageOff')); this.scheduleSave(); break;
        case 'insertFlow': this.session.insertFlow = this.session.insertFlow === false; toast(t(this.session.insertFlow ? 'insertFlowOn' : 'insertFlowOff')); this.scheduleSave(); break;
        case 'pageNums': openPageNumbers(this, this.session.pageNums || defaultPageNums(), async (cfg) => {
          const s = this.session;
          let matches = [], doDelete = false;
          if (cfg.on && !s.oldPageNumsAsked) {
            matches = detectOldPageNumbers(s);
            if (matches.length) doDelete = await askRemoveOldPageNums();
          }
          commitMulti(this.controller, 'pageNums', () => {
            s.pageNums = cfg;
            if (cfg.on && !s.oldPageNumsAsked) s.oldPageNumsAsked = true;
            if (doDelete && matches.length) {
              removeOldPageNumbers(s, matches);
              if (s.magnet !== false && s.lockPage && s.pages[0]) cascadeUpAll(s);
            }
            return true;
          });
          s.dirty = true;
          this.workspace.relayout();
          this.ribbon.update();
        }); break;
        case 'makeFree': { const b = this.selBlocks()[0]; if (!b) break; const pt = this.ctxPoint && Date.now() - this.ctxPoint.at < 60000 ? this.ctxPoint.pt : null; const id = C.makeFree(page, b.id, pt); if (id) this.select(page, [id]); break; }
        case 'unfree': { const b = this.selBlocks()[0]; if (b && !C.unfree(page, b.id)) toast(t('noSpace')); else if (b) this.select(page, [b.id]); break; }
        case 'toPrevPage': case 'toNextPageAdj': {
          await this.moveToPage(page, ids, cmd === 'toPrevPage' ? -1 : 1);
          break;
        }
        case 'tool:select': case 'tool:marquee': case 'tool:split': case 'tool:erase': case 'tool:crop': case 'tool:scanArea': case 'tool:restoreArea': {
          const tl = cmd.slice(5);
          this.setTool(this.session.tool === tl && tl !== 'select' ? 'select' : tl);
          break;
        }
        case 'ctxCrop': {
          const b = this.selBlocks()[0];
          if (!b || !page) break;
          if (b.inserted && b.inserted.type === 'image') this.cropInsertedImage(page, b);
          else this.setTool('crop');
          break;
        }
        case 'edit': case 'editText': if (page && ids.length) this.editArea(page, ids); break;
        case 'delete': if (page && ids.length) { C.remove(page, ids); this.select(page, []); } break;
        case 'merge': {
          if (ids.length < 2) { toast(t('needTwo')); break; }
          const id = C.merge(page, ids);
          if (id) this.select(page, [id]);
          break;
        }
        case 'ungroup': {
          const b = this.selBlocks()[0];
          if (!b || b.parts.length < 2) { toast(t('cannotUngroup')); break; }
          const out = C.ungroup(page, b.id);
          if (out) this.select(page, out);
          break;
        }
        case 'swap:up': case 'swap:down': case 'swap:left': case 'swap:right': {
          if (ids.length !== 1) break;
          const r = C.swap(page, ids[0], cmd.slice(5));
          if (r === 'blocked') toast(t('noSpace'));
          else if (r === 'swapped' || r === 'nudged') {
            requestAnimationFrame(() => {
              const wsEl = this.workspace.el, v = this.workspace.view(page.id);
              const bEl = v && v.blockEls && v.blockEls.get(ids[0]) && v.blockEls.get(ids[0]).el;
              if (!wsEl || !bEl) return;
              const vr = wsEl.getBoundingClientRect(), br = bEl.getBoundingClientRect();
              if (br.bottom <= vr.top) wsEl.scrollTo({ top: wsEl.scrollTop + (br.top - vr.top - 8), behavior: 'smooth' });
              else if (br.top >= vr.bottom) wsEl.scrollTo({ top: wsEl.scrollTop + (br.bottom - vr.bottom + 8), behavior: 'smooth' });
            });
          }
          break;
        }
        case 'bgMenu': this.bgMenu(args.anchor); break;
        case 'alignCenter': {
          if (!page || !ids.length) break;
          const selBlocks = (page.blocks || []).filter((b) => ids.includes(b.id));
          if (!selBlocks.length) break;
          const rects = selBlocks.map((b) => blockRect(b));
          const minX = Math.min(...rects.map((r) => r.x));
          const maxX = Math.max(...rects.map((r) => r.x + r.w));
          const dx = (page.w - (maxX - minX)) / 2 - minX;
          if (Math.abs(dx) >= 0.5) C.move(page, ids, dx, 0, planMove(page, ids, dx, 0));
          break;
        }
        case 'copy': if (this.copySelection()) toast(t('copied')); break;
        case 'scanPage': await this.scanPageDialog(); break;
        case 'bg': if (page && ids.length) { C.setBg(page, ids, args.mode); toast(t('bgDone')); } break;
        case 'whiteAll': { const p = this.currentPage(); C.setWhiteBg(p, !p.whiteBg); this.rasters.dropPage(p.id); toast(t('bgDone')); break; }
        case 'wordFonts': await this.applyWordFonts(); break;
        case 'resetPage': { const p = args.pageId ? this.session.pageById(args.pageId) : this.currentPage(); if (p && C.resetPage(p)) { if (this.session.selection.pageId === p.id) this.select(p, []); this.purgePage(p); toast(t('pageReset')); } break; }
        case 'blankPage': { const p = C.addBlankPage(args.after || this.currentPage().id); toast(t('blankAdded')); setTimeout(() => this.goToPage(p.id), 50); break; }
        case 'deletePage': if (args.pageId) C.deletePage(args.pageId); break;
        case 'deletePages': if (Array.isArray(args.pageIds)) C.deletePages(args.pageIds); break;
        case 'reorderPages': {
          if (Array.isArray(args.order) && C.reorderPages(args.order) && args.focusId) {
            this.sidebar.setActive(args.focusId);
          }
          break;
        }
        case 'mergePdf': {
          const targetAfterId = args.after || (this.currentPage() && this.currentPage().id);
          let inp = $('merge-pdf-input');
          if (!inp) {
            inp = h('input', { id: 'merge-pdf-input', type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true });
            document.body.append(inp);
          }
          inp.onchange = async () => {
            const fs = [...(inp.files || [])];
            inp.value = '';
            if (fs.length) await this.mergeFiles(fs, targetAfterId);
          };
          inp.click();
          break;
        }
        case 'selectAll': { const p = args.pageId ? this.session.pageById(args.pageId) : this.currentPage(); this.session.ensurePage(p); this.select(p, p.blocks.map((b) => b.id)); break; }
        // only an insert picked from the right-click menu goes to the clicked
        // point; the ribbon, keys and drops use the middle of the screen
        case 'insertText': this.markMenuInsert(args); this.insertText(); break;
        case 'toNextPage': await this.moveToPage(page, ids, 1); break;
        case 'insertImage': { this.markMenuInsert(args); const inp = $('image-input'); inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (f) this.insertImageFile(f); }; inp.click(); break; }
        case 'insertTableMenu': this.markMenuInsert(args); this.insertTableMenu(args.anchor); break;
        case 'insertTableModal': this.markMenuInsert(args); this.insertTableModal(); break;
        case 'zoomIn': this.workspace.setZoom(this.zoom * 1.15); break;
        case 'zoomOut': this.workspace.setZoom(this.zoom / 1.15); break;
        case 'fitWidth': this.workspace.fitWidth(); break;
        case 'open': if (this.confirmReplace()) $('file-input').click(); break;
        case 'settings': openSettings(this); break;
        case 'save': await this.save(false); break;
        case 'saveAs': if (args.anchor) this.saveAsMenu(args.anchor); else await this.save(true); break;
        case 'savePdfAs': await this.save(true); break;
        case 'saveImg': await this.saveImages(args.type === 'png' ? 'png' : 'jpg'); break;
        case 'saveDocx': await this.saveDocx(); break;
        default: break;
      }
    } catch (e) {
      console.error(e);
      toast(t('errGeneric') + ': ' + (e.message || e), { error: true });
    }
    this.ribbon.update();
  }
  bgMenu(anchor) {
    const r = anchor ? anchor.getBoundingClientRect() : { left: 200, bottom: 100 };
    this.contextMenu.show(r.left, r.bottom + 4, [
      { label: t('whiteBg'), icon: 'bgWhite', cmd: 'bg', args: { mode: 'white' } },
      { label: t('naturalBg'), icon: 'bgRemove', cmd: 'bg', args: { mode: 'natural' } },
      { label: t('ctxBringBack'), icon: 'reset', cmd: 'bg', args: { mode: null } },
    ]);
  }
  splitArea(page, rect) {
    // the drawn frame never slices a picture, QR code or text line
    try {
      const ink = page.blocks.filter((b) => { const r = blockRect(b); return !b.free && r.x < rect.x + rect.w && r.x + r.w > rect.x && r.y < rect.y + rect.h && r.y + r.h > rect.y; }).flatMap((b) => blockInk(this.session, page, b));
      if (ink.length) {
        let x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
        y0 = snapCut(ink, 'h', y0, x0, x1) ?? y0; y1 = snapCut(ink, 'h', y1, x0, x1) ?? y1;
        x0 = snapCut(ink, 'v', x0, y0, y1) ?? x0; x1 = snapCut(ink, 'v', x1, y0, y1) ?? x1;
        if (x1 - x0 > 4 && y1 - y0 > 4) rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
    } catch (e) { console.warn(e); }
    const res = this.controller.split(page, rect);
    if (!res || !res.ok) { toast(t(res && res.reason ? res.reason : 'nothingHere')); return; }
    this.select(page, res.newIds);
    this.setTool('select');
  }
  coverArea(page, rect) {
    const view = this.workspace.view(page.id);
    if (this.coverMode === 'letter') {
      // replace lettering drawn as a picture: fill its plain background, then type new text
      const fill = view ? edgeFill(view, rect) : null;
      if (!fill || fill.fit < 0.72) { toast(t('aeBusyBg')); return; }
      const color = inkColor(view, rect, fill);
      const { fit, ...f } = fill; void fit;
      this.controller.cover(page, rect, f);
      this.coverMode = 'natural'; this.setTool('select');
      this.insertText(null, { page, at: rect, size: Math.max(8, Math.min(48, Math.round(rect.h * 0.62))), color, bold: true });
      return;
    }
    const fill = !view ? { type: 'solid', c: [255, 255, 255] } : edgeFill(view, rect);
    delete fill.fit;
    this.controller.cover(page, rect, fill);
    // one-shot: back to the normal pointer after one area
    this.setTool('select');
    this.select(page, []);
  }
  startLetterReplace() { this.coverMode = 'letter'; this.setTool('cover'); }
  coverMenu() { this.coverMode = 'natural'; this.setTool(this.session.tool === 'cover' ? 'select' : 'cover'); }
  eraseArea(page, rect) {
    this.controller.erase(page, rect);
    this.setTool('select');
    this.select(page, []);
  }
  setBeforeAfter(on) { document.getElementById('app').classList.toggle('show-before', !!on); if (on) this.floating.hide(); else this.floating.show(); }

  // ---------- save ----------
  saveAsMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    this.contextMenu.show(Math.min(r.left, window.innerWidth - 230), r.bottom + 4, [
      { label: t('saveAsPdf'), icon: 'saveAs', cmd: 'savePdfAs', 'data-testid': 'save-pdf' },
      { label: t('saveAsJpg'), icon: 'image', cmd: 'saveImg', args: { type: 'jpg' }, 'data-testid': 'save-jpg' },
      { label: t('saveAsPng'), icon: 'image', cmd: 'saveImg', args: { type: 'png' }, 'data-testid': 'save-png' },
    ]);
  }
  download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  // pictures of the final result (exactly what "Kaydet" writes), 300 DPI;
  // one page -> one file, more pages -> a folder named after the PDF
  async saveImages(type) {
    const s = this.session;
    const base = (s.name || 'PDF').replace(/[\\/:*?"<>|]+/g, '_');
    const mime = type === 'png' ? 'image/png' : 'image/jpeg';
    const many = s.pages.length > 1;
    let dir = null, fileH = null;
    // ask for the place first (the browser only allows it right after the click)
    if (many && window.showDirectoryPicker) {
      try {
        const root = await window.showDirectoryPicker({ id: 'pdfflow-images', mode: 'readwrite' });
        dir = await root.getDirectoryHandle(base, { create: true });
      } catch (e) { if (e && e.name === 'AbortError') return; dir = null; }
    } else if (!many && window.showSaveFilePicker) {
      try { fileH = await window.showSaveFilePicker({ suggestedName: `${base}.${type}`, types: [{ description: type.toUpperCase(), accept: { [mime]: ['.' + type] } }] }); } catch (e) { if (e && e.name === 'AbortError') return; fileH = null; }
    }
    this.busy = true;
    showLoading(t('saving'));
    try {
      await Promise.allSettled([...this.pending]);
      const bytes = await buildOutput(s);
      const imgs = await renderImages(bytes, type, (i, n) => showLoading(`${t('saving')} ${i} / ${n}`));
      if (imgs.length === 1 && !dir) {
        const name = `${base}.${type}`;
        if (fileH) { const w = await fileH.createWritable(); await w.write(imgs[0].blob); await w.close(); toast(t('savedAs') + fileH.name); }
        else { this.download(imgs[0].blob, name); toast(t('savedAs') + name); }
      } else if (dir) {
        for (const f of imgs) { const fh = await dir.getFileHandle(f.name, { create: true }); const w = await fh.createWritable(); await w.write(f.blob); await w.close(); }
        toast(t('savedFolder').replace('{n}', imgs.length) + base);
      } else {
        const zip = await makeZip([{ name: base + '/', dir: true }, ...imgs.map((f) => ({ name: `${base}/${f.name}`, blob: f.blob }))]);
        this.download(zip, base + '.zip');
        toast(t('savedAs') + base + '.zip');
      }
      const capped = imgs.find((f) => f.dpi && f.dpi < IMG_DPI);
      if (capped) setTimeout(() => toast(t('imgCapped').replace('{dpi}', capped.dpi).replace('{w}', capped.w).replace('{h}', capped.h), { ms: 6000 }), 400);
    } catch (e) {
      console.error(e);
      toast(t('errSave') + (e.message || e), { error: true });
    } finally { this.busy = false; hideLoading(); }
  }
  async save(as) {
    const s = this.session;
    let handle = as ? null : this.fileHandle;
    if (as && window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: s.outName, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      } catch (e) { if (e && e.name === 'AbortError') return; handle = null; }
    }
    this.busy = true;
    showLoading(t('saving'));
    try {
      await Promise.allSettled([...this.pending]);
      const bytes = await buildOutput(s);
      if (handle) {
        const w = await handle.createWritable(); await w.write(bytes); await w.close();
        this.fileHandle = handle;
        toast(t('savedAs') + handle.name);
      } else {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = h('a', { href: url, download: s.outName });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        toast(t('savedAs') + s.outName);
      }
      s.dirty = false;
      this.lastOutput = bytes;
      this.scheduleSave();
    } catch (e) {
      console.error(e);
      toast(t('errSave') + (e.message || e), { error: true });
    } finally { this.busy = false; hideLoading(); }
  }

  // reset = exactly like a freshly opened page: drop every cached layer of it
  purgePage(p) {
    this.rasters.dropPage(p.id);
    if (p.srcIndex !== null) clearSourceForms(this.session.analysis(p.srcIndex));
    const v = this.workspace.view(p.id);
    if (v) { v.purge(); v.render(true); }
  }

  // ---------- misc ----------
  afterChange() {
    this.ribbon.update();
    this.floating.show();
    this.updateStatus();
    this.scheduleSave();
  }
  autosaveEnabled() { return autosave.enabled(); }
  setAutosave(v) { const was = autosave.enabled(); autosave.setEnabled(v); if (v && !was && this.session) autosave.saveDoc(this.session, this.viewState()).catch((e) => console.warn('autosave', e)); }
  updateStatus() {
    const s = this.session; if (!s) return;
    const sb = $('statusbar');
    const cur = this.workspace.currentPageId();
    const i = s.pages.findIndex((p) => p.id === cur);
    const page = s.pages[i];
    const nb = page && page.blocks ? page.blocks.length : 0;
    const ns = s.selection.pageId === cur ? s.selection.ids.size : 0;
    sb.innerHTML = '';
    sb.append(...[h('span', {}, `${t('statusPage')} ${i + 1} ${t('statusOf')} ${s.pages.length}`), h('span', {}, `${nb} ${t('statusBlocks')}`),
      ns ? h('span', {}, `${ns} ${t('statusSelected')}`) : null, h('span', { class: 'grow' }), h('span', {}, s.name + '.pdf'),
      s.dirty ? h('span', { style: { color: 'var(--warn)' }, title: t('unsavedWarn'), html: '●' }) : null].filter(Boolean));
  }
  onKey(e) {
    if (!this.session || $('welcome').hidden === false) return;
    if (document.getElementById('overlay-root').children.length) return;
    const tg = e.target;
    if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.cmd('undo'); return; }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.cmd('redo'); return; }
    if (mod && k === 's') { e.preventDefault(); this.cmd(e.shiftKey ? 'saveAs' : 'save'); return; }
    if (mod && k === 'c') { if (this.session.selection.ids.size) { e.preventDefault(); this.copySelection(); } return; }
    if (mod && k === 'v') { if (this.copiedBlocks && this.copiedBlocks.blocks.length) { e.preventDefault(); this.pasteSelection(); } return; }
    if (mod && k === 'a') { e.preventDefault(); this.cmd('selectAll'); return; }
    if (mod && (k === '+' || k === '=')) { e.preventDefault(); this.cmd('zoomIn'); return; }
    if (mod && k === '-') { e.preventDefault(); this.cmd('zoomOut'); return; }
    if (mod && k === '0') { e.preventDefault(); this.cmd('fitWidth'); return; }
    if (e.key === 'Delete' || e.key === 'Backspace' || e.code === 'Delete') { if (this.session.selection.ids.size) { e.preventDefault(); this.cmd('delete'); } return; }
    if (e.key === 'Escape') { this.contextMenu.hide(); if (this.session.tool !== 'select') this.setTool('select'); else this.select(null, []); return; }
    if (e.key === 'Enter' && this.session.selection.ids.size) { e.preventDefault(); this.cmd('edit'); return; }
    const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (arrows[e.key] && this.session.selection.ids.size) {
      e.preventDefault();
      const st = e.shiftKey ? 10 : 1;
      const page = this.selPage();
      if (!this.controller.nudge(page, [...this.session.selection.ids], arrows[e.key][0] * st, arrows[e.key][1] * st)) toast(t('noSpace'));
    }
  }
}

Object.assign(App.prototype, editCommands);
Object.assign(App.prototype, ocrScan);
void icon;
// small version tag in the window corner (added first, so it shows even if startup fails)
document.body.appendChild(h('div', { class: 'ver-tag', 'data-testid': 'ver-tag' }, `v${APP_VERSION}`));
try {
  const app = new App();
  window.pdfFlow = app; // handy for debugging/tests
  const started = app.start(); // the opening screen is drawn synchronously, before any await
  if (document.querySelector('#welcome .dropzone')) window.__pfReady = true;
  started.catch((e) => { console.error('start', e); if (!window.__pfReady && window.__pfFail) window.__pfFail(e); });
} catch (e) {
  console.error(e);
  if (window.__pfFail) window.__pfFail(e);
}
