// Block editing and inserting commands of the App (mixed into App.prototype).
import { t } from '../i18n/i18n.js';
import { putImage, imgSrc, imageStore, collectImageIds } from '../core/imageStore.js';
import { toast } from '../ui/common/toast.js';
import { showLoading, hideLoading } from '../ui/common/modal.js';
import { askNextPageSpace } from '../ui/modals/simpleModals.js';
import { pushDown, commitMulti } from '../core/pageOps.js';
import { cascadeDown } from '../core/magnetFlow.js';
import { showToolHint } from '../ui/common/toolHint.js';
import { normalizeInsertedForEdit, clearPreparedInserted, buildVirtualInsertCtx } from '../core/insertedBlocks.js';
import { findBlock, newId, collides, closeGap, compactBand, blockRect } from '../model/blockOps.js';
import { getManifest } from '../engines/text/fontMatch.js';
import { fontChoices } from '../engines/text/richStyle.js';
import { decomposeBlocks, applyObjects } from '../core/areaObjects.js';
import { openAreaEditor } from '../ui/modals/areaEditor.js';
import { openInsertTablePopover, openInsertTableModal, buildInsertedTableBlock, QUICK_GRAY_CUSTOM } from '../ui/modals/insertTableModal.js';
import { boxActive } from '../ui/modals/boxControl.js';
import { setBlockBox } from '../model/textBox.js';
import { convertDocumentToWordFonts, isDocumentWordFonts, isPageWordFonts } from '../engines/text/wordFonts.js';
import { composeRegion } from '../ui/workspace/compose.js';
import { renderPartPreview } from '../engines/render/preview.js';
import { partNeedsPreview, partDestRect, fallbackSrcIndex } from '../model/blockState.js';
import { coverBands } from '../engines/export/coverOps.js';
import { buildDocx } from '../engines/export/docxExport.js';

export const editCommands = {
  // ---------- editing ----------
  async editBlock(page, id, point) {
    return this.editArea(page, [id], { point });
  },

  // ---------- Word-like area editor ----------
  async editArea(page, ids, opts = {}) {
    try { await normalizeInsertedForEdit(this.session, page, ids, this.controller.s.avail); } catch (e) { console.warn(e); }
    let ctx;
    try { ctx = decomposeBlocks(this.session, page, ids); } catch (e) { clearPreparedInserted(page, ids); console.error(e); toast(t('errGeneric'), { error: true }); return; }
    clearPreparedInserted(page, ids);
    if (ctx.error) { toast(t(ctx.error === 'mixed' ? 'aeMixed' : 'notEditable')); return; }
    let fonts = null, man = null;
    try { man = await getManifest(); fonts = ctx.an ? await fontChoices(ctx.an, this.controller.s.avail) : null; } catch (e) { console.warn(e); }
    const orig = ids.map((id) => findBlock(page, id)).filter(Boolean);
    const box = orig.length === 1 ? (orig[0].box || (orig[0].inserted && orig[0].inserted.box) || null) : null;
    const colOffsets = orig.length === 1 && Array.isArray(orig[0]._colOffsets) ? orig[0]._colOffsets.slice() : null;
    const anyFree = orig.some((b) => b.free);
    const lettering = opts.lettering ?? (ctx.objects.some((o) => o.type === 'deco' || o.type === 'photo') && ctx.objects.every((o) => !(o.addedText || (o.keepG && o.keepG.length))));
    this.hideFloating();
    this.areaEditor = openAreaEditor({
      app: this, ctx, fonts, man, lettering: !!lettering, point: opts.point || null, box, colOffsets,
      onApply: async (objs, extra = {}) => {
        if (extra.dirty === false) { this.floating.show(); return true; }
        let res = null;
        const mag = this.session.magnet !== false && !anyFree;
        let didShrink = false;
        const fn = (p) => {
          res = applyObjects(p, ctx, objs);
          const nb = res && res.id ? findBlock(p, res.id) : null;
          if (nb && extra.box !== undefined) setBlockBox(nb, boxActive(extra.box) ? { ...extra.box } : null);
          if (nb && Array.isArray(extra.colOffsets)) nb._colOffsets = extra.colOffsets.slice();
          if (mag) {
            if (!nb) {
              didShrink = true;
              compactBand(p, ctx.R);
              closeGap(p, ctx.R, ctx.R.h, ctx.R.y);
            } else {
              const nr = blockRect(nb);
              const shrunk = (ctx.R.y + ctx.R.h) - (nr.y + nr.h);
              // a rebuilt block is measured tight, the segmented original
              // carries 1.2pt padding (segment PAD): that is not a shrink, and
              // closing it would move every block below on a no-op Uygula
              if (shrunk > 2.2) {
                didShrink = true;
                const area = { x: Math.min(ctx.R.x, nr.x), y: ctx.R.y, w: Math.max(ctx.R.x + ctx.R.w, nr.x + nr.w) - Math.min(ctx.R.x, nr.x), h: ctx.R.h };
                closeGap(p, area, shrunk, nr.y + nr.h);
              }
            }
          }
          return true;
        };
        if (mag) this.controller.flowCommit(page, 'layout', fn, { cascade: () => didShrink });
        else this.controller.commit(page, 'layout', fn);
        if (res && res.how === 'pushed') toast(t('aePushed'));
        else if (res && res.how === 'shrunk') toast(t('aeShrunk'));
        if (res && res.id) this.select(page, [res.id]); else this.select(page, []);
        this.floating.show();
        return true;
      },
    });
  },

  // ---------- insert ----------
  async _openInsertTextEditor(page, pt, { useFlow = true, preset = null, boxAt = null } = {}) {
    this.session.ensurePage(page);
    const ctx = buildVirtualInsertCtx(this.session, page, pt, preset);
    let man = null, fonts = null;
    try {
      man = await getManifest();
      fonts = ctx.an
        ? await fontChoices(ctx.an, this.controller.s.avail)
        : { orig: [], lib: [...new Set(man.map((m) => m.family))].map((f) => ({ id: 'lib:' + f, name: f.replace(/([a-z])([A-Z])/g, '$1 $2'), family: f })) };
    } catch (e) { console.warn(e); }
    this.hideFloating();
    this.areaEditor = openAreaEditor({
      app: this, ctx, fonts, man, point: pt, box: null, colOffsets: null,
      onApply: async (objs, extra = {}) => {
        const hasContent = objs.some((o) => !o.deleted && (
          o.type !== 'text'
          || (o.edit && o.edit.clusters && o.edit.clusters.some((c) => (c.paras || []).some((p) => (p.text || '').trim())))
        ));
        if (!hasContent && !boxActive(extra.box)) { this.floating.show(); return true; }
        const nb = applyObjects(page, ctx, objs);
        if (!nb || !nb.parts) { this.floating.show(); return true; }
        if (extra.box !== undefined && boxActive(extra.box)) setBlockBox(nb, { ...extra.box });
        if (Array.isArray(extra.colOffsets)) nb._colOffsets = extra.colOffsets.slice();
        const placeAt = boxAt
          ? { x: boxAt.x + Math.max(0, (boxAt.w - nb.bw) / 2), y: boxAt.y + Math.max(0, (boxAt.h - nb.bh) / 2) }
          : pt;
        this.placeInsertedBlock(page, nb, placeAt, { useFlow, exact: !!boxAt });
        this.floating.show();
        return true;
      },
    });
  },
  async insertText(existing = null, preset = null) {
    if (existing) {
      const pg = this.selPage() || this.currentPage();
      if (pg && findBlock(pg, existing.id)) return this.editArea(pg, [existing.id]);
    }
    if (preset && preset.at) {
      const pg = preset.page || this.currentPage();
      if (!pg) return;
      await this._openInsertTextEditor(pg, { x: preset.at.x, y: preset.at.y }, { useFlow: false, preset, boxAt: preset.at });
      return;
    }
    this.resolveInsertTarget((page, pt, { useFlow }) => this._openInsertTextEditor(page, pt, { useFlow, preset }));
  },
  controllerCollides(p, b) { return collides(p, b, { x: b.x, y: b.y, s: b.s }); },
  insertImageFile(f, opts = {}) {
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => {
        const refPage = this.workspace.pageAtCenter() || this.currentPage();
        if (!refPage) return;
        const maxW = refPage.w * 0.4, maxH = refPage.h * 0.3;
        const k = Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight, 1);
        const block = { id: newId('b'), kind: 'inserted', x: 0, y: 0, s: 1, bw: im.naturalWidth * k, bh: im.naturalHeight * k, parts: [], inserted: { type: 'image', imgId: putImage(rd.result) }, free: true };
        this.resolveInsertTarget((page, pt, { useFlow, exact }) => {
          this.placeInsertedBlock(page, block, pt, { useFlow, exact });
        }, opts);
      };
      im.onerror = () => toast(t('errGeneric'), { error: true });
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
  },
  insertTableMenu(anchor) {
    openInsertTablePopover(anchor, {
      onQuickPick: (cols, rows) => this.insertTable({ cols, rows, pattern: 'sade', color: 'ozel', custom: QUICK_GRAY_CUSTOM }),
      onOpenModal: () => this.insertTableModal(),
    });
  },
  insertTableModal() {
    openInsertTableModal({
      onConfirm: (spec) => this.insertTable(spec),
    });
  },
  insertTable({ cols = 5, rows = 2, pattern = 'ust', color = 'mavi', custom = null } = {}) {
    this.resolveInsertTarget((page, pt, { useFlow, exact }) => {
      const block = buildInsertedTableBlock(this.session, page, { cols, rows, pattern, color, custom });
      if (!block) return;
      this.placeInsertedBlock(page, block, pt, { useFlow, exact });
    });
  },
  resolveInsertTarget(cb, { instant = false } = {}) {
    const cp = this.ctxPoint && this.ctxPoint.forInsert && Date.now() - (this.ctxPoint.at || 0) < 120000 ? this.ctxPoint : null;
    if (cp) {
      this.ctxPoint = null;
      cb(cp.page, cp.pt, { useFlow: this.session.insertFlow !== false, exact: true });
      return;
    }
    if (instant) {
      const pg = this.workspace.pageAtCenter() || this.currentPage();
      if (pg) cb(pg, null, { useFlow: false, exact: true });
      return;
    }
    const selPage = this.selPage();
    const sel = this.selBlocks();
    if (selPage && sel.length) {
      const rects = sel.map((b) => blockRect(b));
      const minX = Math.min(...rects.map((r) => r.x));
      const maxBottom = Math.max(...rects.map((r) => r.y + r.h));
      cb(selPage, { x: minX, y: maxBottom + 10 }, { useFlow: this.session.insertFlow !== false, exact: false });
      return;
    }
    this.pendingInsert = (page, pt) => {
      const useFlow = this.session.insertFlow !== false;
      cb(page, pt, { useFlow, exact: !useFlow });
    };
    this.setTool('insertSpot');
    showToolHint(t('insertGuideHint'));
  },
  completePendingInsert(page, pt) {
    const fn = this.pendingInsert;
    this.pendingInsert = null;
    this.setTool('select');
    if (fn && page) fn(page, pt);
  },
  placeInsertedBlock(page, block, pt, { useFlow = true, exact = false } = {}) {
    this.ctxPoint = null;
    this.session.ensurePage(page);
    if (!useFlow) {
      block.free = true;
      const pref = pt || this.workspace.visibleCenterOf(page, block.bw, block.bh);
      const id = this.controller.insertNear(page, block, pref, !!(pt ? exact || true : true));
      if (!id) { toast(t('insertHere')); return; }
      const b = findBlock(page, id);
      if (b && b.s < 0.999) toast(t('insertShrunk'));
      this.freshBlocks = new Set([id]);
      this.select(page, [id]);
      this.workspace.reveal(page);
      requestAnimationFrame(() => { const v = this.workspace.view(page.id); if (v) v.refreshSelection(); });
      return;
    }
    delete block.free;
    const bw = block.bw * (block.s || 1), bh = block.bh * (block.s || 1);
    const pw = page.w || 595, ph = page.h || 842;
    const basePt = pt || this.workspace.visibleCenterOf(page, bw, bh);
    const x = Math.max(18, Math.min(pw - bw - 18, basePt.x));
    let placeY = Math.max(16, basePt.y);
    const aboveOverlap = page.blocks.filter((o) => {
      if (o.free) return false;
      const r = blockRect(o);
      return r.y < placeY - 0.5 && r.y + r.h > placeY - 4 && r.x < x + bw && r.x + r.w > x;
    });
    if (aboveOverlap.length) {
      placeY = Math.max(placeY, ...aboveOverlap.map((o) => blockRect(o).y + blockRect(o).h + 10));
    }
    block.x = x; block.y = placeY;
    const id = commitMulti(this.controller, 'insert', () => {
      this.session.ensurePage(page);
      const hit = page.blocks.some((o) => {
        if (o.free) return false;
        const r = blockRect(o);
        return r.y >= placeY - 0.5 && r.y < placeY + bh + 10 && r.x < x + bw && r.x + r.w > x;
      });
      if (hit) pushDown(this.session, page, placeY - 0.5, bh + 10, new Set([block.id]));
      for (let k = 0; k < 8 && collides(page, block, { x: block.x, y: block.y, s: block.s || 1 }); k++) {
        const blocker = page.blocks.find((o) => !o.free && blockRect(o).y < block.y + bh && blockRect(o).y + blockRect(o).h > block.y && blockRect(o).x < x + bw && blockRect(o).x + blockRect(o).w > x);
        if (!blocker) break;
        block.y = blockRect(blocker).y + blockRect(blocker).h + 8;
      }
      page.blocks.push(block);
      if (hit || block.y + bh > ph - 20) cascadeDown(this.session, page);
      return block.id;
    });
    if (!id) { toast(t('insertHere')); return; }
    this.freshBlocks = new Set([id]);
    const targetPg = this.session.pages.find((pg) => (pg.blocks || []).some((b) => b.id === id)) || page;
    this.select(targetPg, [id]);
    this.workspace.reveal(targetPg);
    this.workspace.scrollToBlock(targetPg, findBlock(targetPg, id));
    requestAnimationFrame(() => { const v = this.workspace.view(targetPg.id); if (v) v.refreshSelection(); });
  },
  async cropInsertedImage(page, b) {
    const s = b.s || 1;
    const R = { x: b.x, y: b.y, w: b.bw * s, h: b.bh * s };
    const imgObj = {
      id: 'ins0', type: 'img',
      img: { dataUrl: imgSrc(b.inserted), anchor: 0, wrap: false, width: 1 },
      x: R.x, y: R.y, w: R.w, h: R.h, keep: [], keepG: [],
    };
    this.hideFloating();
    this.areaEditor = openAreaEditor({
      app: this, ctx: { R, objects: [imgObj], page, an: null, ids: [b.id] }, fonts: null, man: null, cropOnOpen: true,
      onApply: async (objs) => {
        const out = objs.find((o) => !o.deleted && o.type === 'img');
        if (!out) {
          this.controller.commit(page, 'delete', (p) => { p.blocks = p.blocks.filter((x) => x.id !== b.id); return true; });
          this.select(page, []);
          return true;
        }
        this.controller.commit(page, 'crop', (p) => {
          const blk = findBlock(p, b.id); if (!blk || !blk.inserted) return false;
          blk.x = out.x; blk.y = out.y; blk.s = 1; blk.bw = out.w; blk.bh = out.h;
          blk.inserted = { ...blk.inserted, imgId: putImage(out.img.dataUrl) }; delete blk.inserted.dataUrl;
          return true;
        });
        this.select(page, [b.id]);
        this.floating.show();
        return true;
      },
    });
  },
  // new content goes to the center of what the user sees (the visible part of
  // the workspace, mapped to the page under it); only an insert chosen from
  // the right-click menu goes to the clicked point
  insertBlock(block) {
    const cp = this.ctxPoint && this.ctxPoint.forInsert && Date.now() - (this.ctxPoint.at || 0) < 120000 ? this.ctxPoint : null;
    const page = cp ? cp.page : (this.workspace.pageAtCenter() || this.currentPage());
    this.session.ensurePage(page);
    let pref = null, exact = false;
    if (cp && cp.page === page) { pref = cp.pt; exact = true; }
    if (!pref) {
      pref = this.workspace.visibleCenterOf(page, block.bw, block.bh);
      exact = true;
    }
    this.ctxPoint = null;
    const id = this.controller.insertNear(page, block, pref, exact);
    if (!id) { toast(t('insertHere')); return; }
    const b = findBlock(page, id);
    if (b && b.s < 0.999) toast(t('insertShrunk'));
    // the glow stays until the user moves the new block once (screen only)
    this.freshBlocks = new Set([id]);
    this.select(page, [id]);
    this.workspace.reveal(page);
    this.workspace.scrollToBlock(page, findBlock(page, id));
    requestAnimationFrame(() => { const v = this.workspace.view(page.id); if (v) v.refreshSelection(); });
  },
  async moveToPage(page, ids, dir) {
    if (!page || !ids.length) return;
    let res = this.controller.moveAdjacent(page, ids, dir, 'auto');
    if (!res.ok) {
      if (res.reason === 'noSpacePrev') { toast(t('noSpacePrev')); return; }
      if (res.reason === 'askNext') {
        const choice = this.session.lockPage ? 'shift' : await askNextPageSpace();
        if (!choice) return;
        res = this.controller.moveAdjacent(page, ids, 1, choice);
      }
    }
    if (res && res.ok && res.page) {
      const np = res.page;
      setTimeout(() => { this.goToPage(np.id); this.select(np, ids); }, 60);
    }
  },
  moveToNextPage() {
    const page = this.selPage(); const ids = [...this.session.selection.ids];
    return this.moveToPage(page, ids, 1);
  },
  copySelection() {
    const page = this.selPage();
    const sel = this.selBlocks();
    if (!page || !sel.length) return false;
    const ids = collectImageIds([{ blocks: sel }]);
    // pictures travel with the copy (a newly opened document has its own store)
    this.copiedBlocks = { pageId: page.id, srcIndex: page.srcIndex, blocks: JSON.parse(JSON.stringify(sel)), images: imageStore().entries(ids) };
    return true;
  },
  pasteSelection() {
    if (!this.copiedBlocks || !this.copiedBlocks.blocks.length) return false;
    const page = this.currentPage();
    this.session.ensurePage(page);
    const pastedIds = [];
    for (const [id, url] of this.copiedBlocks.images || []) if (!imageStore().has(id)) imageStore().map.set(id, url);
    for (const orig of this.copiedBlocks.blocks) {
      const b = JSON.parse(JSON.stringify(orig));
      b.id = newId('b');
      if (Array.isArray(b.parts)) b.parts.forEach((p) => { p.id = newId('p'); });
      if ((b.from === undefined || b.from === null) && !b.inserted && Array.isArray(b.parts) && b.parts.some((p) => p.src) && this.copiedBlocks.srcIndex !== null && this.copiedBlocks.srcIndex !== undefined) {
        b.from = this.copiedBlocks.srcIndex;
      }
      const pref = { x: (orig.x || 40) + 12, y: (orig.y || 40) + 12 };
      const id = this.controller.insertNear(page, b, pref, false);
      if (id) pastedIds.push(id);
    }
    if (!pastedIds.length) { toast(t('insertHere')); return false; }
    this.select(page, pastedIds);
    this.workspace.reveal(page);
    this.workspace.scrollToBlock(page, findBlock(page, pastedIds[0]));
    return true;
  },
  fontFamilyFor(file) {
    const fam = 'PF_' + file.replace(/\W/g, '_');
    if (!this.fontFaces.has(file)) {
      const ff = new FontFace(fam, `url(assets/fonts/${file})`);
      this.fontFaces.set(file, ff);
      ff.load().then((f) => { document.fonts.add(f); for (const v of this.workspace.views.values()) { for (const r of v.blockEls.values()) r.key = null; v.rendered = null; v.render(); } }).catch(() => {});
    }
    return fam;
  },
  wordFontsState() {
    const s = this.session;
    return {
      enabled: !!(s && s.pages && s.pages.length),
      active: isDocumentWordFonts(s),
    };
  },
  async applyWordFonts() {
    const s = this.session;
    if (!s) return;
    const { changed, usedFiles } = await convertDocumentToWordFonts(s, this.controller);
    for (const f of usedFiles) this.fontFamilyFor(f);
    for (const v of this.workspace?.views?.values() || []) {
      v.rendered = null;
      if (v.visible) v.render(true);
    }
    if (changed) toast(t('wordFontsDone'));
    this.ribbon.update();
  },
  async saveDocx() {
    const s = this.session;
    if (!s) return;
    const pageHasText = (pg) => (pg.blocks || []).some((b) => {
      if (b.inserted) return b.inserted.type === 'text';
      return (b.parts || []).some((p) => p.src && !p.decor && p.editable !== false
        && p.kind !== 'image' && p.kind !== 'graphic' && p.kind !== 'insimg'
        && p.obj !== 'deco' && p.obj !== 'bg' && p.obj !== 'photo'
        && !(p.addedText && (!p.edit || !(p.edit.runs && p.edit.runs.length))));
    });
    let needWordWarn = false;
    for (const pg of s.pages || []) {
      s.ensurePage(pg);
      if (pageHasText(pg) && !isPageWordFonts(pg)) { needWordWarn = true; break; }
    }
    if (needWordWarn) toast(t('wordFontsWarn'), { ms: 4500 });

    const base = (s.name || 'PDF').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '_');
    const outName = `${base}.docx`;
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    let handle = null;
    if (typeof window !== 'undefined' && window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: outName, types: [{ description: 'Word (.docx)', accept: { [mime]: ['.docx'] } }] });
      } catch (e) { if (e && e.name === 'AbortError') return; handle = null; }
    }
    this.busy = true;
    showLoading(t('saving'));
    try {
      await Promise.allSettled([...(this.pending || [])]);
      const extractPartImage = async (pg, b, p, rect) => {
        if (typeof document === 'undefined') return null;
        try {
          const view = this.workspace && this.workspace.view(pg.id);
          if (view && view.base && view.base.width) {
            return composeRegion(view, rect, 2.5).toDataURL('image/png');
          }
          const si = fallbackSrcIndex(s, pg);
          const srcPg = si !== null && si !== undefined ? { ...pg, srcIndex: si } : null;
          if (srcPg && this.rasters && rect.w > 0 && rect.h > 0) {
            const sc = 2.5;
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(rect.w * sc));
            c.height = Math.max(1, Math.round(rect.h * sc));
            const g = c.getContext('2d');
            g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
            const fullCv = await this.rasters.get(srcPg, sc, !!pg.whiteBg);
            const partsToDraw = b.parts.some(Boolean) ? b.parts : [p];
            for (const q of partsToDraw) {
              if (!q || !q.src) continue;
              const d = partDestRect(b, q);
              if (d.x > rect.x + rect.w || d.y > rect.y + rect.h || d.x + d.w < rect.x || d.y + d.h < rect.y) continue;
              if (partNeedsPreview(q, b)) {
                const pv = document.createElement('canvas');
                await renderPartPreview(s, s.analysis(si), pg, q, sc, pv, { transparent: true });
                g.drawImage(pv, (d.x - rect.x) * sc, (d.y - rect.y) * sc, d.w * sc, d.h * sc);
              } else {
                const ox = Math.max(0, rect.x - d.x), oy = Math.max(0, rect.y - d.y);
                const w = Math.min(d.x + d.w, rect.x + rect.w) - Math.max(rect.x, d.x);
                const hh = Math.min(d.y + d.h, rect.y + rect.h) - Math.max(rect.y, d.y);
                const ks = q.src.w / Math.max(0.1, d.w);
                if (w > 0 && hh > 0) g.drawImage(fullCv, (q.src.x + ox * ks) * sc, (q.src.y + oy * ks) * sc, w * ks * sc, hh * ks * sc, (Math.max(rect.x, d.x) - rect.x) * sc, (Math.max(rect.y, d.y) - rect.y) * sc, w * sc, hh * sc);
              }
            }
            for (const er of pg.erase || []) {
              if (er.x > rect.x + rect.w || er.y > rect.y + rect.h || er.x + er.w < rect.x || er.y + er.h < rect.y) continue;
              if (er.fill) { for (const cb of coverBands(er)) { g.fillStyle = `rgb(${cb.c.join(',')})`; g.fillRect((cb.x - rect.x) * sc, (cb.y - rect.y) * sc, cb.w * sc, cb.h * sc); } }
              else { g.fillStyle = '#fff'; g.fillRect((er.x - rect.x) * sc, (er.y - rect.y) * sc, er.w * sc, er.h * sc); }
            }
            return c.toDataURL('image/png');
          }
        } catch (err) { console.warn('docx img', err); }
        return null;
      };
      const bytes = await buildDocx(s, { extractPartImage });
      if (handle) {
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
        toast(t('savedAs') + handle.name);
      } else {
        this.download(new Blob([bytes], { type: mime }), outName);
        toast(t('savedAs') + outName);
      }
    } catch (e) {
      console.error(e);
      toast(t('errSave') + (e.message || e), { error: true });
    } finally {
      this.busy = false;
      hideLoading();
    }
  },
};
