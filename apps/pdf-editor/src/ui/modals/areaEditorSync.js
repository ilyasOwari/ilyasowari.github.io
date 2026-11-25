// Düzenle editor - undo/redo history (snapshots) and syncing text edits back to the stage objects (enclosure/sibling adjustment, text relayout).
// Part of areaEditor.js: runs inside openAreaEditor(); `T` is the shared editor state built there.
import { h } from '../common/dom.js';
import { applyTextEdit } from '../../engines/text/editSession.js';
import { emptyBox } from './boxControl.js';
import { clone, cloneParas } from './areaEditorShared.js';
import { syncOcrEnclosures, ocrPatchesOf } from './ae/aeOcr.js';

export function setupAreaSync(T) {
  const {
    an, app, boxCfg, computeMaxGrowLeft, computeMaxGrowX, computeMaxGrowY, guides, isUnit, objs, place,
    render, renderPlaceholderView, scaleOf, sections, st, stage, syncSlotBox,
  } = T;
  Object.assign(T, { commitSnap, scheduleTypeSnap, undo, redo, syncTextObj, flushTextSync, isDirty: () => history.length > 0 && snapSig(takeSnap()) !== snapSig(history[0]) });

  // ---------- history (Ctrl+Z / Ctrl+Y) ----------
  const history = [];
  let histIdx = -1;
  let restoring = false;
  T.typeTimer = 0;
  T.syncTimer = 0;

  function takeSnap() {
    return {
      order: objs.map((o) => o.id),
      objs: objs.map((o) => ({
        id: o.id, deleted: !!o.deleted, type: o.type, addedText: !!o.addedText, placeholder: !!o.placeholder,
        x: o.x, y: o.y, w: o.w, h: o.h, dw: o.dw, dh: o.dh,
        ocrShiftX: o._ocrShiftX || 0, ocrShiftY: o._ocrShiftY || 0,
        baseX: o._base ? o._base.x : undefined, baseY: o._base ? o._base.y : undefined,
        src: o.src ? { ...o.src } : null, full: o.full ? { ...o.full } : null, clip: o.clip ? { ...o.clip } : null,
        nine: o.nine ? { ...o.nine } : null, edit: o.edit ? clone(o.edit) : null,
        img: o.img ? { ...o.img } : null, keep: Array.isArray(o.keep) ? o.keep.slice() : null,
        keepG: Array.isArray(o.keepG) ? o.keepG.slice() : null, removedG: Array.isArray(o.removedG) ? o.removedG.slice() : null,
      })),
      sections: sections.map((s) => ({ oid: s.o.id, cid: s.model.clusterKey, cellDeleted: !!s.cellDeleted, paras: cloneParas(s.ed.value()) })),
      boxCfg: { ...boxCfg },
      insertSideMode: !!st.insertSideMode,
      table: st.captureTableSnap ? st.captureTableSnap() : null,
    };
  }
  const snapSig = (sn) => JSON.stringify(sn);
  function commitSnap() {
    clearTimeout(T.typeTimer); T.typeTimer = 0;
    // a change made to many texts at once (table A− / A+) is one undo step
    if (restoring || (T.st && T.st.snapHold)) return;
    const sn = takeSnap();
    const cur = history[histIdx];
    if (cur && snapSig(cur) === snapSig(sn)) return;
    history.splice(histIdx + 1);
    history.push(sn);
    histIdx = history.length - 1;
  }
  function scheduleTypeSnap() {
    if (restoring) return;
    clearTimeout(T.typeTimer);
    T.typeTimer = setTimeout(() => commitSnap(), 350);
  }
  function restoreSnap(sn) {
    restoring = true;
    clearTimeout(T.typeTimer); T.typeTimer = 0;
    clearTimeout(T.syncTimer); T.syncTimer = 0;
    try {
      const byId = new Map(objs.map((o) => [o.id, o]));
      const snapIds = new Set(sn.objs.map((os) => os.id));
      for (const o of objs) if (!snapIds.has(o.id)) { o.deleted = true; place(o); }
      const reordered = sn.order.map((id) => byId.get(id)).filter(Boolean);
      for (const o of objs) if (!reordered.includes(o)) reordered.push(o);
      objs.length = 0; objs.push(...reordered);
      objs.forEach((o) => stage.insertBefore(o.el, guides));
      for (const os of sn.objs) {
        const o = byId.get(os.id); if (!o) continue;
        const keepChanged = Array.isArray(os.keep) && JSON.stringify(o.keep) !== JSON.stringify(os.keep);
        if (keepChanged) o.keep = os.keep.slice(); // (dropped highlight / repaired-letter shapes come back)
        const keepGChanged = Array.isArray(os.keepG) && JSON.stringify(o.keepG) !== JSON.stringify(os.keepG);
        if (keepGChanged) o.keepG = os.keepG.slice();
        const rmGChanged = JSON.stringify(o.removedG || null) !== JSON.stringify(os.removedG || null);
        if (rmGChanged) o.removedG = os.removedG ? os.removedG.slice() : [];
        const clipChanged = JSON.stringify(o.clip || null) !== JSON.stringify(os.clip || null);
        if (clipChanged) o.clip = os.clip ? { ...os.clip } : null;
        const needRender = o.type !== 'img' && (keepChanged || keepGChanged || rmGChanged || clipChanged || o.w !== os.w || o.h !== os.h || JSON.stringify(o.edit) !== JSON.stringify(os.edit) || JSON.stringify(o.src) !== JSON.stringify(os.src) || JSON.stringify(o.nine) !== JSON.stringify(os.nine) || (o.type !== os.type));
        o.deleted = os.deleted; o.x = os.x; o.y = os.y; o.w = os.w; o.h = os.h; o.dw = os.dw; o.dh = os.dh;
        o._ocrShiftX = os.ocrShiftX || 0; o._ocrShiftY = os.ocrShiftY || 0;
        if (os.baseX != null && o._base) { o._base.x = os.baseX; o._base.y = os.baseY; }
        o.placeholder = !!os.placeholder;
        if (os.src) o.src = { ...os.src };
        if (os.full) o.full = { ...os.full };
        o.nine = os.nine ? { ...os.nine } : null;
        o.edit = os.edit ? clone(os.edit) : null;
        if (os.type === 'img' && (os.placeholder || (os.img && os.img.placeholder) || !(os.img && os.img.dataUrl))) {
          o.type = 'img';
          o.img = os.img ? { ...os.img } : { dataUrl: '', anchor: 0, wrap: false, width: 1 };
          o.el.dataset.type = 'img';
          o.el.className = 'ae-obj ae-img ae-placeholder' + (st.sel === o ? ' on' : '');
          renderPlaceholderView(o);
        } else if (os.type === 'img' && os.img) {
          o.type = 'img'; o.placeholder = false; o.img = { ...os.img }; o.el.dataset.type = 'img'; o.el.className = 'ae-obj ae-img' + (o.ocrPatch ? ' ae-ocr-patch' : '') + (st.sel === o ? ' on' : '');
          o.canvas = null; o.view.textContent = ''; o.view.append(h('img', { src: o.img.dataUrl, draggable: 'false' }));
        } else if (o.type !== os.type) {
          o.type = os.type; o.el.dataset.type = os.type; o.el.className = 'ae-obj ae-' + os.type + (o.ocr ? ' ae-ocr-text' : '') + (st.sel === o ? ' on' : '');
        }
        if (isUnit(o)) o._hasOcrEdit = !!(o.edit && (o.edit.deltaX || o.edit.delta || (o.edit.colCuts && o.edit.colCuts.length) || (o.edit.cuts && o.edit.cuts.length)));
        place(o);
        if (needRender && !o.deleted) render(o);
      }
      const secRecs = sn.sections || [];
      sections.forEach((s, i) => {
        const match = secRecs.find((x) => x.oid === s.o.id && (!x.cid || x.cid === s.model.clusterKey)) || secRecs[i];
        const ps = match && match.paras ? match.paras : (Array.isArray(match) ? match : null);
        if (!ps || (match && match.cellDeleted)) {
          s.cellDeleted = !!(match && match.cellDeleted);
          s.ed.setParas([{ text: '', marker: false }]);
          s.ed.el.hidden = true;
          s.lastSyncedParas = [{ text: '', marker: false }];
          if (s.rowEl) {
            const anyVis = [...s.rowEl.children].some((ch) => !ch.hidden);
            s.rowEl.hidden = !anyVis;
          }
          return;
        }
        s.cellDeleted = false;
        s.ed.el.hidden = false;
        s.ed.setParas(ps);
        s.lastSyncedParas = cloneParas(ps);
        const restoredSub = s.o.edit
          ? (Array.isArray(s.o.edit.clusters)
            ? s.o.edit.clusters.find((c) => c.clusterKey === s.model.clusterKey)
            : (s.o.edit.clusterKey === s.model.clusterKey ? s.o.edit : null))
          : null;
        if (restoredSub && Array.isArray(restoredSub.lineEndAt) && s.ed.applyLiveLayout) {
          s.ed.applyLiveLayout({
            lineEndAt: restoredSub.lineEndAt,
            k: restoredSub.k || 1,
            deltaX: restoredSub.deltaX || 0,
            deltaLeft: restoredSub.deltaLeft || 0,
            paras: ps,
          });
        } else if (s.ed.resetLiveLayout) {
          s.ed.resetLiveLayout();
        }
        if (s.rowEl) s.rowEl.hidden = !!s.o.deleted;
      });
      Object.assign(boxCfg, emptyBox(), sn.boxCfg || {});
      st.insertSideMode = !!sn.insertSideMode;
      st.bx && st.bx.setBox(boxCfg);
      if (sn.table && st.restoreTableSnap) st.restoreTableSnap(sn.table);
      if (st.sel && st.sel.deleted) st.sel = null;
      objs.forEach((x) => x.el.classList.toggle('on', x === st.sel));
      st.syncLayout(); syncSlotBox(); st.drawHandles(); st.syncButtons();
    } finally {
      restoring = false;
    }
  }
  function undo() {
    commitSnap();
    if (histIdx <= 0) return;
    restoreSnap(history[--histIdx]);
  }
  function redo() {
    clearTimeout(T.typeTimer); T.typeTimer = 0;
    if (histIdx >= history.length - 1) return;
    restoreSnap(history[++histIdx]);
  }

  // ---------- sync text changes back to stage / template ----------
  let pendingText = Promise.resolve();
  const touchedTextObjs = new Set(); T.touchedTextObjs = touchedTextObjs;
  const parasEqual = (a, b) => JSON.stringify((a || []).map((p) => [p.text, !!p.marker, p.st || [], p.align || '', p.cb || null])) === JSON.stringify((b || []).map((p) => [p.text, !!p.marker, p.st || [], p.align || '', p.cb || null]));

  function relayoutDeletedRowsInUnit(u) {
    if (!u || !u._base || u.deleted || u.type === 'bg') return false;
    const items = objs.filter((x) => x !== u && x._base && !isUnit(x) && !x.badge && !x.addedText
      && x._base.x + x._base.w / 2 >= u._base.x - 2 && x._base.x + x._base.w / 2 <= u._base.x + u._base.w + 2
      && x._base.y >= u._base.y - 2 && x._base.y + x._base.h <= u._base.y + u._base.h + 4);
    if (items.length < 2) return false;
    // group items into visual rows by their initial _base.y
    const sorted = items.slice().sort((a, b) => a._base.y - b._base.y);
    const vRows = [];
    for (const it of sorted) {
      let r = vRows.find((q) => Math.abs(q.y - it._base.y) < 4);
      if (!r) { r = { y: it._base.y, items: [] }; vRows.push(r); }
      r.items.push(it);
    }
    if (vRows.length < 2 || !vRows.some((r) => r.items.every((it) => it.deleted))) return false;
    const s0 = scaleOf(u);
    const uBase = u._base;
    const topPad = Math.max(2, Math.min(8, vRows[0].y - uBase.y - 1));
    const botPad = Math.max(2, Math.min(5, topPad));
    const bands = vRows.map((r, ri) => ({
      deleted: r.items.every((it) => it.deleted),
      y0: ri === 0 ? uBase.y + topPad : r.y + 1.5,
      y1: ri < vRows.length - 1 ? vRows[ri + 1].y + 1.5 : uBase.y + uBase.h - botPad,
      items: r.items,
    }));
    const cuts = [];
    let removedSum = 0;
    for (const bnd of bands) {
      if (bnd.deleted) {
        const y0s = u.src.y + (bnd.y0 - uBase.y) / s0;
        const y1s = u.src.y + (bnd.y1 - uBase.y) / s0;
        if (cuts.length && Math.abs(cuts[cuts.length - 1].y1 - y0s) < 0.8) cuts[cuts.length - 1].y1 = y1s;
        else cuts.push({ y0: y0s, y1: y1s });
        removedSum += (bnd.y1 - bnd.y0);
      } else {
        for (const it of bnd.items) {
          it.y = it._base.y - removedSum;
          place(it);
        }
      }
    }
    if (!cuts.length) {
      u.edit = uBase.edit ? clone(uBase.edit) : null;
      u.dh = uBase.dh; u.h = u.dh * s0;
    } else {
      const cutSrc = cuts.reduce((a, c) => a + (c.y1 - c.y0), 0);
      u.edit = { ...(uBase.edit ? clone(uBase.edit) : {}), removeGlyphs: [], runs: [], cuts, delta: -cutSrc };
      u.dh = Math.max(4, uBase.dh - cutSrc);
      u.h = u.dh * s0;
    }
    place(u); render(u);
    return true;
  }

  async function syncRowCard(card, { renderPreview = true } = {}) {
    if (!card || !card.rows || !card.rows.length) return;
    const baseScaleOf = (u) => u._base.w / (u._base.nine ? u._base.nine.w : u._base.dw);
    const curCardDxUi = Math.max(0, ...card.rows.map((r) => (r.text.deleted ? 0 : Math.max(0, ((r.text.edit && r.text.edit.deltaX) || 0) * scaleOf(r.text)))));
    const ddxUi = curCardDxUi - (card.baseCardDxUi || 0);
    const prevBot = card.panel && !card.panel.deleted
      ? (card.panel.y + card.panel.h)
      : Math.max(...[...card.memberSet].filter((x) => !x.deleted).map((x) => x.y + x.h));
    const renderQueue = [];
    let accDy = 0;
    for (const r of card.rows) {
      const t = r.text;
      if (!t.deleted) {
        t.y = t._base.y + accDy;
        place(t);
      }
      const dH = t.deleted ? 0 : (t.h - t._base.h);
      for (const bar of r.bars) {
        if (bar.deleted) continue;
        const scB = baseScaleOf(bar);
        const origWUi = bar._base.src.w * scB;
        const newW = Math.max(origWUi, bar._base.w + ddxUi);
        const newY = bar._base.y + accDy + dH;
        const resized = Math.abs(newW - bar.w) > 0.25;
        bar.y = newY;
        bar.w = newW;
        if (Math.abs(newW - origWUi) > 0.3) {
          bar.nine = { w: newW / scB, h: bar._base.src.h };
          bar.dw = bar.nine.w;
        } else {
          bar.nine = null;
          bar.dw = bar._base.src.w;
        }
        place(bar);
        if (renderPreview && resized) renderQueue.push(render(bar));
      }
      const origTextH = (t._origPart ? t._origPart.src.h : t._base.src.h) * scaleOf(t);
      const totalRowGrow = t.deleted ? 0 : Math.max(0, t.h - origTextH);
      for (const box of r.boxes) {
        if (box.deleted) continue;
        const scX = baseScaleOf(box);
        const origHUi = box._base.src.h * scX;
        box.x = box.sideEdge === 'right'
          ? Math.max(box._base.x - (card.baseCardDxUi || 0), box._base.x + ddxUi)
          : box._base.x;
        const boxGrow = totalRowGrow > 0.5 ? Math.min(totalRowGrow * 0.65, origHUi * 0.9, 18 * scX) : 0;
        const newH = origHUi + boxGrow;
        const baseBoxGrow = Math.max(0, box._base.h - origHUi);
        const curRowTop = t._base.y + accDy;
        const baseRelY = box._base.y - t._base.y - (t._base.h - origTextH - baseBoxGrow) * 0.35;
        box.y = curRowTop + baseRelY + (totalRowGrow - boxGrow) * 0.35;
        const resized = Math.abs(newH - box.h) > 0.25;
        box.h = newH;
        if (boxGrow > 0.3) {
          box.nine = { w: box._base.src.w, h: newH / scX };
          box.dh = box.nine.h;
        } else {
          box.nine = null;
          box.dh = box._base.src.h;
        }
        place(box);
        if (renderPreview && resized) renderQueue.push(render(box));
      }
      accDy += dH;
    }
    if (card.panel && !card.panel.deleted) {
      const u = card.panel;
      const scU = baseScaleOf(u);
      const origWUi = u._base.src.w * scU, origHUi = u._base.src.h * scU;
      const newW = Math.max(origWUi, u._base.w + ddxUi);
      const newH = Math.max(origHUi, u._base.h + accDy);
      const resized = Math.abs(newW - u.w) > 0.25 || Math.abs(newH - u.h) > 0.25;
      u.w = newW;
      u.h = newH;
      if (Math.abs(newW - origWUi) > 0.3 || Math.abs(newH - origHUi) > 0.3) {
        u.nine = { w: newW / scU, h: newH / scU };
        u.dw = u.nine.w;
        u.dh = u.nine.h;
      } else {
        u.nine = null;
        u.dw = u._base.src.w;
        u.dh = u._base.src.h;
      }
      place(u);
      if (renderPreview && resized) renderQueue.push(render(u));
    }
    const newBot = card.panel && !card.panel.deleted
      ? (card.panel.y + card.panel.h)
      : Math.max(...[...card.memberSet].filter((x) => !x.deleted).map((x) => x.y + x.h));
    if (Number.isFinite(prevBot) && Number.isFinite(newBot)) {
      const deltaBot = newBot - prevBot;
      if (Math.abs(deltaBot) > 0.5) {
        for (const x of objs) {
          if (x.deleted || x.ocr || x.ocrPatch || card.memberSet.has(x)) continue;
          if ((x.cell && x.cell.col != null) || (x.edit && x.edit.tableSpec)) continue;
          if (x.y >= prevBot - 4) { x.y += deltaBot; place(x); }
        }
      }
    }
    if (renderQueue.length) await Promise.all(renderQueue);
  }

  function adjustEnclosureAndSibs(o, prevY, prevH, prevBot) {
    if (o.cell && o.cell.col != null) return; // Tablo hücreleri tamamen syncColTable tarafından yönetilir
    const newBot = o.deleted ? prevY : o.y + o.h;
    const dH = (o.deleted ? 0 : o.h) - prevH;
    // Check if an enclosing template unit has multiple row items where one or more rows were deleted
    let handledByUnitRows = false;
    for (const u of objs) {
      if (u === o || u.deleted || !isUnit(u) || !u._base) continue;
      const b = o._base || o;
      const cxo = b.x + b.w / 2;
      if (cxo >= u._base.x - 2 && cxo <= u._base.x + u._base.w + 2 && b.y >= u._base.y - 4 && b.y + b.h <= u._base.y + u._base.h + 4) {
        if (relayoutDeletedRowsInUnit(u)) handledByUnitRows = true;
      }
    }
    if (handledByUnitRows || Math.abs(dH) <= 0.5) return;
    // Metin tara items lie over the picture: they never push the rest around
    if (o.ocr && !o._encBox) return;
    if (dH < -0.5) {
      if (o.cell) return;
      for (const x of objs) {
        if (x === o || x.deleted || x.ocr || x.ocrPatch) continue;
        if ((x.cell && x.cell.col != null) || (x.edit && x.edit.tableSpec)) continue;
        if (isUnit(x) && prevY >= x.y - 4 && prevBot <= x.y + x.h + 4) continue;
        const overlapX = Math.min(x.x + x.w, o.x + o.w) - Math.max(x.x, o.x) > 1;
        if (overlapX && x.y >= prevBot - 4) { x.y += dH; place(x); }
      }
      for (const u of objs) {
        if (u === o || u.deleted || !isUnit(u)) continue;
        const cxo = o.x + o.w / 2;
        if (cxo < u.x - 1 || cxo > u.x + u.w + 1 || prevY < u.y - 4 || prevBot > u.y + u.h + 4) continue;
        const sameRowInU = objs.filter((x) => x !== o && !x.deleted && !isUnit(x) && x.x + x.w / 2 >= u.x && x.x + x.w / 2 <= u.x + u.w && x.y >= u.y - 4 && (x._base ? x._base.y + x._base.h : x.y + x.h) <= (o._base ? o._base.y + o._base.h : prevBot) + 4);
        const otherMaxBot = sameRowInU.length ? Math.max(...sameRowInU.map((x) => x.y + x.h)) : -Infinity;
        const shrink = Math.min(0, Math.max(newBot, otherMaxBot) - prevBot);
        if (shrink >= -0.5) continue;
        if (u.type === 'bg') {
          const nw = u.nine ? u.nine.w : u.src.w;
          const s0 = u.w / nw;
          u.h = Math.max(12, u.h + shrink);
          u.nine = { w: nw, h: u.h / s0 };
        } else {
          const s0 = scaleOf(u);
          const cutSrc = (u.edit && u.edit.oldBottom) || Math.max(u.src.y + 6, Math.min(u.src.y + u.src.h - 2, u.src.y + (prevBot - u.y) / s0));
          const curDelta = (u.edit && u.edit.delta) || 0;
          const rawDelta = curDelta + shrink / s0;
          const newDelta = Math.max(-(cutSrc - u.src.y - 4), rawDelta);
          if (Math.abs(newDelta) < 0.01 && (!u.edit || !u.edit.deltaX)) {
            u.edit = null; u.dh = u.src.h; u.h = u.dh * s0;
          } else {
            u.edit = { removeGlyphs: [], runs: [], ...(u.edit || {}), oldBottom: cutSrc, delta: newDelta };
            u.dh = u.src.h + newDelta; u.h = u.dh * s0;
          }
        }
        place(u); render(u);
      }
    } else if (dH > 0.5) {
      const oRow = o.cell ? (o.cell.gridRow ?? o.cell.row) : null;
      const sameRow = objs.filter((x) => {
        if (x === o || x.deleted || isUnit(x)) return false;
        if (oRow != null && x.cell) {
          const xRow = x.cell.gridRow ?? x.cell.row;
          if (xRow != null) return xRow === oRow;
        }
        return x.type === 'text' && Math.abs(x.y - prevY) < 6;
      });
      const sameRowSet = new Set([o, ...sameRow]);
      const prevRowBot = Math.max(prevBot, ...sameRow.map((r) => r.y + r.h));
      const newRowBot = Math.max(prevRowBot, newBot);
      const rowGrow = newRowBot - prevRowBot;
      if (rowGrow > 0.5) {
        for (const x of objs) {
          if (x === o || x.deleted || x.ocr || x.ocrPatch || sameRowSet.has(x)) continue;
          if ((x.cell && x.cell.col != null) || (x.edit && x.edit.tableSpec)) continue;
          if (isUnit(x) && x.y <= prevY + 2 && x.y + x.h >= prevRowBot - 2) continue;
          if (x.y > prevY + 4) { x.y += rowGrow; place(x); }
        }
        for (const u of objs) {
          if (u === o || u.deleted || !isUnit(u)) continue;
          if (u.y <= prevY + 2 && u.y + u.h >= prevRowBot - 2 && o.x + o.w / 2 >= u.x && o.x + o.w / 2 <= u.x + u.w) {
            if (u.type === 'bg') {
              const nw = u.nine ? u.nine.w : u.src.w;
              const s0 = u.w / nw;
              u.h += rowGrow;
              u.nine = { w: nw, h: u.h / s0 };
            } else {
              const s0 = scaleOf(u);
              const prevUh = u.h;
              u.h += rowGrow;
              const dSrc = rowGrow / s0;
              const cutSrc = u.src.y + (prevRowBot - u.y - 0.5) / s0;
              const curDelta = (u.edit && u.edit.delta) || 0;
              u.edit = { removeGlyphs: [], runs: [], ...(u.edit || {}), oldBottom: (u.edit && u.edit.oldBottom) || Math.max(u.src.y + 3, Math.min(u.src.y + u.src.h - 1, cutSrc)), delta: curDelta + dSrc, stripH: Math.max(2, Math.min(6, prevH * 0.4 / s0)) };
              u.dh = u.src.h + u.edit.delta;
              if (prevUh <= 0) u.h = u.dh * s0;
            }
            place(u); render(u);
          }
        }
      }
    }
  }

  async function syncTextObj(o, { renderPreview = true } = {}) {
    if (!o || !o._base) return;
    const mySecs = sections.filter((s) => s.o === o);
    if (!mySecs.length) return;
    const prevY = o.y, prevH = o.deleted ? 0 : o.h, prevBot = prevY + prevH;
    const base = o._base;
    const origPart = o._origPart;
    const sc0 = o._tblBaseSc ?? (base.w / base.dw);
    if (o.addedText) {
      const emptyAdded = mySecs.every((s) => {
        const ps = s.ed.value();
        return !ps || ps.every((p) => !p.text.replace(/\u00a0/g, ' ').trim());
      });
      if (emptyAdded) {
        for (const s of mySecs) {
          s.lastSyncedParas = cloneParas(s.ed.value());
          if (s.ed && s.ed.resetLiveLayout) s.ed.resetLiveLayout();
        }
        o.deleted = mySecs.every((s) => !!s.cellDeleted);
        // Tablo hücresiyse boş olsa bile kaydedildiğinde kaybolmaması için boş edit objesi tut
        o.edit = (o.cell && o.cell.col != null)
          ? { clusters: [], removeGlyphs: [], runs: [], marks: [], dropGfx: [], dropBoxes: [], delta: 0, deltaX: 0, k: 1 }
          : null;
        o.dw = base.dw; o.dh = base.dh; o.w = o.dw * sc0; o.h = o.dh * sc0;
        o._inkW = 0;
        o.x = (o._colTargetX ?? base.x) + (o._ocrShiftX || 0);
        o.y = (o._rowTargetY ?? base.y) + (o._ocrShiftY || 0);
        if (o.ocr && o._encBox) await syncOcrEnclosures({ objs, isUnit, scaleOf, place, render, renderPreview });
        if (o.canvas && o.canvas.width) o.canvas.getContext('2d').clearRect(0, 0, o.canvas.width, o.canvas.height);
        place(o); st.drawHandles(); syncSlotBox();
        return;
      }
    }
    const subs = [];
    let anyChanged = false;
    let delta = 0, oldBottom = null, deltaX = 0, deltaLeft = 0, cutX = null, cutLeftX = null;
    for (const s of mySecs) {
      const paras = s.ed.value();
      s.lastSyncedParas = cloneParas(paras);
      const hasParaAlign = paras.some((p) => p.align);
      const widthMoved = (hasParaAlign || !!(o.addedText || s.model.prevEdit))
        && !(o.keep && o.keep.length)
        && s.model && s.model.area && s._lastLayoutRight != null
        && Math.abs(s._lastLayoutRight - s.model.area.right) > 1.0;
      const changed = !parasEqual(paras, s.model.paras) || widthMoved;
      if (!changed && !s.model.prevEdit && !o.addedText) {
        if (s.ed && s.ed.resetLiveLayout) s.ed.resetLiveLayout();
        continue;
      }
      anyChanged = true;
      if (!changed && s.model.prevEdit) {
        subs.push(s.model.prevEdit);
        if (s.ed && s.ed.applyLiveLayout) {
          s.ed.applyLiveLayout({
            lineEndAt: s.model.prevEdit.lineEndAt || [],
            k: s.model.prevEdit.k || 1,
            deltaX: s.model.prevEdit.deltaX || 0,
            deltaLeft: s.model.prevEdit.deltaLeft || 0,
            paras,
          });
        }
        if (s.model.prevEdit.delta && Math.abs(s.model.prevEdit.delta) > 0.01) { delta = s.model.prevEdit.delta; oldBottom = s.model.prevEdit.oldBottom; }
        if (s.model.prevEdit.deltaX && s.model.prevEdit.deltaX > deltaX) { deltaX = s.model.prevEdit.deltaX; cutX = s.model.prevEdit.cutX; }
        if (s.model.prevEdit.deltaLeft && s.model.prevEdit.deltaLeft > deltaLeft) { deltaLeft = s.model.prevEdit.deltaLeft; cutLeftX = s.model.prevEdit.cutLeftX; }
        continue;
      }
      const liveMaxX = computeMaxGrowX(o, s.model);
      const liveMaxLeft = computeMaxGrowLeft(o, s.model);
      const liveMaxY = computeMaxGrowY(o, s.model);
      const canGrowX = Number.isFinite(liveMaxX) ? (dx) => dx <= liveMaxX + 0.1 : () => true;
      const canGrowLeft = Number.isFinite(liveMaxLeft) ? (dl) => dl <= liveMaxLeft + 0.1 : () => false;
      const canGrow = Number.isFinite(liveMaxY) ? (dy) => dy <= liveMaxY + 0.1 : () => true;
      const res = await applyTextEdit({ an, part: origPart, model: s.model, paras, avail: app.controller.s.avail, canGrow, canGrowX, canGrowLeft });
      if (s.model && s.model.area) s._lastLayoutRight = s.model.area.right;
      const e = res.edit;
      if (s.ed && s.ed.applyLiveLayout) {
        s.ed.applyLiveLayout({
          lineEndAt: e.lineEndAt || [],
          k: e.k || 1,
          deltaX: e.deltaX || 0,
          deltaLeft: e.deltaLeft || 0,
          paras,
        });
      }
      subs.push(e);
      if (e.delta && Math.abs(e.delta) > 0.01) { delta = e.delta; oldBottom = e.oldBottom; }
      if (e.deltaX && e.deltaX > deltaX) { deltaX = e.deltaX; cutX = e.cutX; }
      if (e.deltaLeft && e.deltaLeft > deltaLeft) { deltaLeft = e.deltaLeft; cutLeftX = e.cutLeftX; }
    }
    if (!anyChanged && !base.edit) {
      o.deleted = false; o.edit = null;
      o.x = o._colTargetX ?? base.x;
      if (base.src) o.src = { ...base.src };
      o.dw = base.dw; o.dh = base.dh; o.w = o.dw * sc0; o.h = o.dh * sc0;
      place(o);
    } else {
      const allEmpty = subs.length >= mySecs.length && mySecs.every((s) => {
        const ps = s.ed.value();
        return !ps || ps.every((p) => !p.text.replace(/\u00a0/g, ' ').trim());
      });
      if (allEmpty && (!o.cell || mySecs.every((s) => s.cellDeleted))) {
        o.deleted = true; o.h = 0; place(o);
      } else {
        const runs = subs.flatMap((c) => c.runs || []);
        o.deleted = false;
        o.edit = {
          clusters: subs, removeGlyphs: subs.flatMap((c) => c.removeGlyphs || []), runs,
          marks: subs.flatMap((c) => c.marks || []), dropGfx: subs.flatMap((c) => c.dropGfx || []), dropBoxes: subs.flatMap((c) => c.dropBoxes || []),
          delta, oldBottom, deltaX, deltaLeft, cutX, cutLeftX, k: 1,
        };
        let dw = origPart.src.w + deltaX + deltaLeft;
        let dh = Math.max(4, origPart.src.h + delta);
        for (const mk of o.edit.marks) for (const mr of mk.rects || []) dh = Math.max(dh, mr.y + mr.h - origPart.src.y + 1.5);
        for (const r of runs) {
          const rSz = (r.m && (Math.abs(r.m[3]) || Math.hypot(r.m[0], r.m[1]))) || 10;
          dh = Math.max(dh, r.y + 0.3 * rSz - origPart.src.y + 1.5);
        }
        if (o.addedText && o.badge) {
          for (const r of runs) dw = Math.max(dw, r.x + (r.w || 0) - (origPart.src.x - deltaLeft) + 1);
        } else if (o.addedText) {
          const maxR = runs.length ? Math.max(...runs.map((r) => r.x + (r.w || 0) - (origPart.src.x - deltaLeft) + 4)) : (o.cell ? (o.baseW || origPart.src.w) : 40);
          dw = o.cell && !runs.length ? Math.max(24, (o.baseW || origPart.src.w) + deltaX) : Math.max(24, Math.min((o.baseW || origPart.src.w) + deltaX + deltaLeft, maxR));
          for (const mk of o.edit.marks) for (const mr of mk.rects || []) dw = Math.max(dw, mr.x + mr.w - (origPart.src.x - deltaLeft) + 2);
        } else {
          for (const r of runs) dw = Math.max(dw, r.x + (r.w || 0) - (origPart.src.x - deltaLeft) + 1);
          for (const mk of o.edit.marks) for (const mr of mk.rects || []) dw = Math.max(dw, mr.x + mr.w - (origPart.src.x - deltaLeft) + 2);
        }
        o.src.x = origPart.src.x - deltaLeft;
        o.src.w = origPart.src.w + deltaLeft;
        o.x = (o._colTargetX ?? base.x) - deltaLeft * sc0 + (o._ocrShiftX || 0);
        if (o.ocr) o.y = (o._rowTargetY ?? base.y) + (o._ocrShiftY || 0);
        o.dw = dw; o.dh = dh; o.w = o.dw * sc0; o.h = o.dh * sc0;
        // ink width (what the text really occupies), used by table columns: the
        // box width follows the wrap area and would otherwise widen the column
        const hasHAlign = mySecs.some((s) => s.ed.value().some((p) => p.align));
        let inkSpanSrc = origPart.src.w + deltaLeft;
        if (runs.length) {
          if (hasHAlign) {
            const lineExt = new Map();
            for (const r of runs) {
              const ky = Math.round((r.y || 0) * 2);
              const cur = lineExt.get(ky) || [Infinity, -Infinity];
              lineExt.set(ky, [Math.min(cur[0], r.x), Math.max(cur[1], r.x + (r.w || 0))]);
            }
            inkSpanSrc = Math.max(1, ...[...lineExt.values()].map(([l, r]) => r - l));
          } else {
            inkSpanSrc = Math.max(...runs.map((r) => r.x + (r.w || 0) - (origPart.src.x - deltaLeft)));
          }
        }
        o._inkW = Math.min(o.w, inkSpanSrc * sc0);
        if (o.addedText) { o.src.w = o.dw; o.full.w = o.dw; o.src.h = origPart.src.h; o.full.h = origPart.src.h; }
        place(o);
      }
    }
    if (o.badge && o._badgeBgObj && !o._badgeBgObj.deleted) {
      const bg = o._badgeBgObj, bgBase = bg._base || bg, scBg = scaleOf(bg);
      const origBgSrc = bgBase.src || bg.src;
      if (deltaLeft > 0.05) {
        bg.edit = { removeGlyphs: [], runs: [], deltaLeft, cutLeftX };
        bg.src = { ...origBgSrc, x: origBgSrc.x - deltaLeft, w: origBgSrc.w + deltaLeft };
        bg.dw = origBgSrc.w + deltaLeft;
        bg.w = bg.dw * scBg;
        bg.x = bgBase.x - deltaLeft * scBg;
      } else if (bg.edit && bg.edit.deltaLeft) {
        bg.edit = null;
        bg.src = { ...origBgSrc };
        bg.dw = bgBase.dw;
        bg.w = bg.dw * scBg;
        bg.x = bgBase.x;
      }
      place(bg);
      if (renderPreview) await render(bg);
    }
    if (o.ocr) {
      if (o.deleted) for (const p of ocrPatchesOf(o)) { p.deleted = true; place(p); }
      await syncOcrEnclosures({ objs, isUnit, scaleOf, place, render, renderPreview });
    } else if (o._rowCard) {
      await syncRowCard(o._rowCard, { renderPreview });
    } else {
      adjustEnclosureAndSibs(o, prevY, prevH, prevBot);
    }
    if (!o.ocr && !o._rowCard && o._encBox && !o._encBox.deleted && !(o.cell && o.cell.col != null)) {
      const u = o._encBox, ub = u._base || u, scU = scaleOf(u);
      const prevPull = u._pulledL || 0;
      const enclosed = objs.filter((t) => t === o || (t !== u && !t.deleted && !isUnit(t) && t.x >= u.x - 4 && t.x < u.x + u.w + 4 && t.y >= u.y - 4 && t.y + t.h <= u.y + u.h + 4));
      const maxTextR = enclosed.length ? Math.max(...enclosed.map((t) => t.x + t.w + prevPull)) : (o.x + o.w + prevPull);
      const needExpand = Math.max(0, maxTextR + 4 - (ub.x + ub.w));
      const growR = Math.min(needExpand, (o._encGrowR || 0) * sc0);
      const pullL = Math.max(0, Math.min(needExpand - growR, (o._encPullL || 0) * sc0));
      const dPull = pullL - prevPull;
      if (Math.abs(dPull) > 0.3) {
        u._pulledL = pullL;
        u.x = ub.x - pullL;
        for (const t of enclosed) { t.x -= dPull; place(t); }
      }
      if (growR > 0.3 || (u.edit && u.edit.deltaX)) {
        const dxU = growR / scU;
        if (dxU > 0.05) {
          u.edit = { ...(u.edit || {}), removeGlyphs: [], runs: [], deltaX: dxU, cutX: u.src.x + u.src.w * 0.5 };
          u.dw = u.src.w + dxU; u.w = u.dw * scU;
        } else if (u.edit) {
          delete u.edit.deltaX;
          u.dw = u.src.w; u.w = u.dw * scU;
          if (!u.edit.delta) u.edit = null;
        }
        place(u); render(u);
        for (const x of objs) {
          if (x === u || x.deleted || !x._base || isUnit(x)) continue;
          const xb = x._base;
          if (xb.x >= ub.x + ub.w - 16 && xb.x <= ub.x + ub.w + 24 && Math.min(xb.y + xb.h, ub.y + ub.h) - Math.max(xb.y, ub.y) > 2 && (x.type === 'img' || x.type === 'photo' || (xb.w < 40 && xb.h < 40))) {
            x.x = xb.x + growR;
            place(x);
          }
        }
      } else if (Math.abs(dPull) > 0.3) {
        place(u);
      }
    }
    // Sync dropped inline mark gfx out of sibling deco/bg objects so old highlights don't remain behind
    const droppedG = new Set(), droppedB = [];
    for (const t of objs) {
      if (t.deleted || t.type !== 'text' || !t.edit) continue;
      for (const gi of t.edit.dropGfx || []) droppedG.add(gi);
      for (const db of t.edit.dropBoxes || []) droppedB.push(db);
    }
    for (const d of objs) {
      if (d.type !== 'deco' && d.type !== 'bg' && d.type !== 'box') continue;
      if (!d._baseKeep) d._baseKeep = (d.keep || []).slice();
      if (!d._baseKeep.length) continue;
      const nextKeep = d._baseKeep.filter((gi) => {
        if (droppedG.has(gi)) return false;
        const gb = an && an.atoms && an.atoms.gfx && an.atoms.gfx[gi] && an.atoms.gfx[gi].b;
        if (gb && droppedB.some((db) => db.x0 - 1.5 <= gb.x0 && gb.x1 <= db.x1 + 1.5 && db.y0 - 1.5 <= gb.y0 && gb.y1 <= db.y1 + 1.5)) return false;
        return true;
      });
      if (nextKeep.length !== (d.keep || []).length) {
        d.keep = nextKeep;
        d.deleted = nextKeep.length === 0;
        place(d);
        if (renderPreview && !d.deleted) await render(d);
      }
    }
    st.drawHandles(); syncSlotBox();
    if (renderPreview && !o.deleted) await render(o);
  }

  function flushTextSync({ renderPreview = true } = {}) {
    const list = [...touchedTextObjs];
    touchedTextObjs.clear();
    for (const s of sections) {
      const widthMoved = s.model && s.model.area && s._lastLayoutRight != null
        && Math.abs(s._lastLayoutRight - s.model.area.right) > 1.0
        && !(s.o.keep && s.o.keep.length)
        && (s.o.addedText || s.model.prevEdit || (s.ed.hasAlign && s.ed.hasAlign()));
      if (!s.lastSyncedParas || !parasEqual(s.ed.value(), s.lastSyncedParas) || widthMoved) list.push(s.o);
    }
    const uniq = [...new Set(list)];
    for (const o of uniq) pendingText = pendingText.then(() => syncTextObj(o, { renderPreview })).catch((e) => console.error(e));
    pendingText = pendingText.then(() => { st.syncColTable(); }).catch((e) => console.error(e));
    return pendingText;
  }
}
