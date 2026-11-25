// Structural table operations (swap columns/rows, insert/delete column/row, step width/height).
// Part of aeTableOps.js: runs inside setupTableOps(); `T` is the shared table state.
import { h } from '../../common/dom.js';
import { openAllModels } from '../../../engines/text/editSession.js';

export function setupTableStruct(T, { tableSc, baseScaleOf, markStructureEdited }) {
  const {
    allEds, an, cellRows, cloneParas, colSecs, colSlots, commitSnap, flushTextSync, guides,
    initialTableTopUi, innerTableDecos, makeSectionEditor, maxOrigColWidthSrc, nonBadgeEds,
    objs, partOf, place, plainFontSize, plainRefGlyphIdx, reindexRowAndColMeta, rowSlots,
    sections, stage, stripModelStyle, syncCellWidths, touchedTextObjs, wireCellKeyboardNav, wireObjEl,
  } = T;

  const swapColumns = (colA, colB) => {
    commitSnap();
    const tmpSlot = colSlots[colA];
    colSlots[colA] = colSlots[colB];
    colSlots[colB] = tmpSlot;
    const tmpOff = T.colOffsets[colA];
    T.colOffsets[colA] = T.colOffsets[colB];
    T.colOffsets[colB] = tmpOff;

    for (const s of colSecs) {
      if (s.model.cell.col === colA) s.model.cell.col = colB;
      else if (s.model.cell.col === colB) s.model.cell.col = colA;
      if (s.o.cell) s.o.cell.col = s.model.cell.col;
      if (s.o._origPart && s.o._origPart.cell) s.o._origPart.cell.col = s.model.cell.col;
      s.ed.el.dataset.col = s.model.cell.col;
      touchedTextObjs.add(s.o);
    }
    for (const row of cellRows) {
      const cells = [...row.querySelectorAll('.te-cell[data-col]')];
      cells.sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
      for (const el of cells) row.append(el);
    }
    reindexRowAndColMeta();
    syncCellWidths();
    T.syncColUi();
    T.syncColTable();
    flushTextSync();
    commitSnap();
  }; T.swapColumns = swapColumns;

  const swapRows = (rowA, rowB) => {
    if (rowA === rowB || rowA < 0 || rowB < 0 || rowA >= cellRows.length || rowB >= cellRows.length) return;
    commitSnap();
    const rowAEl = cellRows[rowA], rowBEl = cellRows[rowB];
    const ph = document.createComment('swap-row');
    rowAEl.before(ph);
    rowBEl.before(rowAEl);
    ph.replaceWith(rowBEl);
    [cellRows[rowA], cellRows[rowB]] = [cellRows[rowB], cellRows[rowA]];
    [rowSlots[rowA], rowSlots[rowB]] = [rowSlots[rowB], rowSlots[rowA]];
    [T.rowMinH[rowA], T.rowMinH[rowB]] = [T.rowMinH[rowB], T.rowMinH[rowA]];
    let curY = initialTableTopUi;
    for (let r = 0; r < cellRows.length; r++) {
      const sh = rowSlots[r] ? rowSlots[r].slotHUi : 16;
      for (const s of colSecs) {
        if (s.rowEl !== cellRows[r] || s.o.deleted) continue;
        const off = s.o._offsetInRowUi != null ? s.o._offsetInRowUi : 0;
        s.o._rowTargetY = curY + off;
        s.o.y = s.o._rowTargetY; s.y = s.o.y;
        place(s.o);
        touchedTextObjs.add(s.o);
      }
      curY += sh;
    }
    reindexRowAndColMeta();
    syncCellWidths();
    T.syncColUi();
    T.syncColTable();
    flushTextSync();
    commitSnap();
  }; T.swapRows = swapRows;

  const insertColumnAt = (afterColIdx) => {
    const refO = colSecs[0] && colSecs[0].o;
    if (!refO) return;
    commitSnap();
    markStructureEdited();
    const sc0 = tableSc;
    const targetColIdx = afterColIdx + 1;
    const padEachSide = Math.round(4.5 * sc0);
    const tenCharTextWUi = Math.round(10 * (plainFontSize || 10) * 0.52 * sc0);
    const tenCharSlotWUi = tenCharTextWUi + padEachSide * 2;
    const existingSlotWs = [];
    for (let c = 0; c < T.colCount; c++) {
      const baseW = colSlots[c] ? colSlots[c].slotWUi : tenCharSlotWUi;
      const effW = Math.max(24 * sc0, baseW + (T.colOffsets[c] || 0) * sc0);
      existingSlotWs.push(effW);
    }
    const narrowCols = existingSlotWs.filter((w) => w < tenCharSlotWUi - 0.5);
    const stepX = Math.round(narrowCols.length ? Math.min(...narrowCols) : tenCharSlotWUi);
    const insW = Math.max(Math.round(16 * sc0), stepX - padEachSide * 2);

    for (const s of colSecs) {
      if (s.model.cell.col >= targetColIdx) {
        s.model.cell.col++;
        if (s.o.cell) s.o.cell.col = s.model.cell.col;
        if (s.o._origPart && s.o._origPart.cell) s.o._origPart.cell.col = s.model.cell.col;
        s.ed.el.dataset.col = s.model.cell.col;
        touchedTextObjs.add(s.o);
      }
    }
    const splitUiX = T.tableLeftUi + colSlots.slice(0, targetColIdx).reduce((acc, sl) => acc + sl.slotWUi, 0);
    const newColX = splitUiX + padEachSide;

    for (let rIdx = 0; rIdx < cellRows.length; rIdx++) {
      const row = cellRows[rIdx];
      const refCol = afterColIdx >= 0 ? afterColIdx : 1;
      const tpl = colSecs.find((s) => s.rowEl === row && s.model.cell.col === refCol) || colSecs.find((s) => s.rowEl === row) || colSecs[0];
      const to = tpl.o;
      const scT = baseScaleOf(to);
      const rowTopSrc = tpl.model && tpl.model.area ? tpl.model.area.top - 1 : to.src.y;
      const rowTopUi = (to._rowTargetY ?? to.y) + (rowTopSrc - to.src.y) * scT;
      const dw = insW / scT;
      const dh = tpl.model && tpl.model.area ? Math.max(10, tpl.model.area.bottom - tpl.model.area.top + 2) : to.dh;
      const cellMeta = { col: targetColIdx, row: rIdx, gridRow: rIdx, colW: Math.round(insW / sc0) };
      const src = { x: to.src.x + (newColX - to._base.x) / scT, y: rowTopSrc, w: dw, h: dh };
      const o = {
        id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + 'm' + rIdx,
        type: 'text', addedText: true,
        refGlyphIdx: plainRefGlyphIdx,
        fontSize: plainFontSize,
        baseW: dw,
        maxColWidthSrc: maxOrigColWidthSrc,
        src: { ...src }, full: { ...src }, keep: [], keepG: [],
        edit: { clusters: [], removeGlyphs: [], runs: [], marks: [], dropGfx: [], dropBoxes: [], delta: 0, deltaX: 0, k: 1 },
        nine: null, k: scT, _tblBaseSc: scT,
        dw, dh, x: newColX, y: rowTopUi, w: insW, h: dh * scT,
        _colTargetX: newColX, _rowTargetY: rowTopUi,
        _offsetInSlotUi: padEachSide,
        cell: { ...cellMeta },
      };
      o._base = { src: { ...o.src }, full: { ...o.full }, keepG: [], edit: null, dw, dh, w: insW, h: o.h, x: newColX, y: rowTopUi };
      o._origPart = partOf(o);
      o.el = h('div', { class: 'ae-obj ae-text ae-added-text', 'data-testid': 'ae-obj', 'data-type': 'text', 'data-oid': o.id });
      o.view = h('div', { class: 'ae-view' }); o.canvas = h('canvas'); o.view.append(o.canvas); o.el.append(o.view);
      wireObjEl(o); objs.push(o); stage.insertBefore(o.el, guides); place(o);
      const model = openAllModels(an, o._origPart)[0];
      stripModelStyle(model);
      model.cell = { ...cellMeta };
      model._origAreaLeft = model.area.left;
      model._origAreaSpan = Math.max(16, model.area.right - model.area.left);
      const sec = { o, model, badge: false, maxGrowX: Math.max(0, maxOrigColWidthSrc - dw), maxGrowY: Infinity, y: rowTopUi, x: o.x, rowEl: row };
      sec.ed = makeSectionEditor(sec); sec.ed.el.classList.add('te-cell'); sec.ed.el.dataset.col = targetColIdx;
      wireCellKeyboardNav(sec);
      sec.lastSyncedParas = cloneParas(model.paras);
      const nextCellEl = row.querySelector(`.te-cell[data-col="${targetColIdx + 1}"]`);
      if (nextCellEl) row.insertBefore(sec.ed.el, nextCellEl); else row.append(sec.ed.el);
      sections.push(sec); colSecs.push(sec); allEds.push(sec.ed); nonBadgeEds.push(sec.ed);
      touchedTextObjs.add(o);
    }

    colSlots.splice(targetColIdx, 0, { baseWUi: insW, slotWUi: stepX });
    T.colOffsets.splice(targetColIdx, 0, 0);
    T.colCount++;
    reindexRowAndColMeta();
    syncCellWidths();
    T.syncColUi();
    T.syncColTable();
    flushTextSync();
  }; T.insertColumnAt = insertColumnAt;

  const insertRowAt = (afterRowIdx) => {
    const refRow = cellRows[afterRowIdx];
    if (!refRow) return;
    commitSnap();
    markStructureEdited();
    const refSecs = colSecs.filter((s) => s.rowEl === refRow).sort((a, b) => a.model.cell.col - b.model.cell.col);
    const prevRSlot = rowSlots[afterRowIdx];
    const sc0 = tableSc;
    const lineHUi = Math.round((plainFontSize || 10) * 1.32 * sc0);
    const vPadUi = Math.round(6 * sc0);
    const singleLineSlotHUi = Math.max(Math.round(14 * sc0), lineHUi + vPadUi);
    const rowSlotHUi = singleLineSlotHUi;
    const textBaseHUi = Math.max(Math.round(12 * sc0), lineHUi);
    const rowTop = (prevRSlot && rowSlots[0])
      ? initialTableTopUi + rowSlots.slice(0, afterRowIdx).reduce((acc, sl) => acc + sl.slotHUi, 0)
      : Math.min(...refSecs.map((s) => s.o._rowTargetY ?? s.o.y));
    const afterRowBotGap = prevRSlot ? prevRSlot.slotHUi : singleLineSlotHUi;

    for (let r = afterRowIdx + 1; r < cellRows.length; r++) {
      for (const s of colSecs.filter((x) => x.rowEl === cellRows[r])) {
        s.o._rowTargetY = (s.o._rowTargetY ?? s.o._base.y) + rowSlotHUi;
        s.o.y = s.o._rowTargetY; s.y = s.o.y; place(s.o);
        touchedTextObjs.add(s.o);
      }
    }
    const newRow = h('div', { class: 'te-row te-cells te-tbl-row', 'data-testid': 'te-cells' });
    newRow._rowId = 'r' + (T.nextRowId++);
    refRow.after(newRow);
    cellRows.splice(afterRowIdx + 1, 0, newRow);

    for (const tpl of refSecs) {
      const to = tpl.o, scT = baseScaleOf(to);
      const newYUi = rowTop + afterRowBotGap;
      const dh = textBaseHUi / scT;
      const cellMeta = { col: tpl.model.cell.col, row: afterRowIdx + 1, gridRow: afterRowIdx + 1, colW: tpl.model.cell.colW };
      const o = {
        id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + 'r' + tpl.model.cell.col,
        type: 'text', addedText: true,
        refGlyphIdx: plainRefGlyphIdx,
        fontSize: plainFontSize,
        baseW: to.dw,
        maxColWidthSrc: to.maxColWidthSrc || maxOrigColWidthSrc,
        src: { x: to.src.x, y: to.src.y + rowSlotHUi / scT, w: to.dw, h: dh },
        full: { x: to.src.x, y: to.src.y + rowSlotHUi / scT, w: to.dw, h: dh },
        keep: [], keepG: [],
        edit: { clusters: [], removeGlyphs: [], runs: [], marks: [], dropGfx: [], dropBoxes: [], delta: 0, deltaX: 0, k: 1 },
        nine: null, k: scT, _tblBaseSc: scT,
        dw: to.dw, dh, x: to.x, y: newYUi, w: to.dw * scT, h: textBaseHUi,
        _colTargetX: to._colTargetX ?? to._base.x, _rowTargetY: newYUi,
        _offsetInSlotUi: to._offsetInSlotUi, _offsetInRowUi: to._offsetInRowUi,
        cell: { ...cellMeta },
      };
      o._base = { src: { ...o.src }, full: { ...o.full }, keepG: [], edit: null, dw: o.dw, dh: o.dh, w: o.w, h: o.h, x: o.x, y: o.y };
      o._origPart = partOf(o);
      o.el = h('div', { class: 'ae-obj ae-text ae-added-text', 'data-testid': 'ae-obj', 'data-type': 'text', 'data-oid': o.id });
      o.view = h('div', { class: 'ae-view' }); o.canvas = h('canvas'); o.view.append(o.canvas); o.el.append(o.view);
      wireObjEl(o); objs.push(o); stage.insertBefore(o.el, guides); place(o);
      const model = openAllModels(an, o._origPart)[0];
      stripModelStyle(model);
      model.cell = { ...o.cell };
      model._origAreaLeft = model.area.left;
      model._origAreaSpan = Math.max(16, model.area.right - model.area.left);
      const sec = { o, model, badge: false, maxGrowX: tpl.maxGrowX, maxGrowY: Infinity, y: o.y, x: o.x, rowEl: newRow };
      sec.ed = makeSectionEditor(sec); sec.ed.el.classList.add('te-cell'); sec.ed.el.dataset.col = o.cell.col;
      wireCellKeyboardNav(sec);
      sec.lastSyncedParas = cloneParas(model.paras);
      newRow.append(sec.ed.el);
      sections.push(sec); colSecs.push(sec); allEds.push(sec.ed); nonBadgeEds.push(sec.ed);
      touchedTextObjs.add(o);
    }

    rowSlots.splice(afterRowIdx + 1, 0, { slotHUi: rowSlotHUi });
    T.rowMinH.splice(afterRowIdx + 1, 0, null);
    reindexRowAndColMeta();
    syncCellWidths();
    T.syncColUi();
    T.syncColTable();
    flushTextSync();
  }; T.insertRowAt = insertRowAt;

  const deleteColumn = (colIdx) => {
    if (T.colCount <= 2) return;
    commitSnap();
    markStructureEdited();
    const delSecs = colSecs.filter((x) => x.model.cell.col === colIdx);
    const slot = colSlots[colIdx];
    if (slot && slot.srcLeft != null && slot.srcRight != null) {
      for (const x of innerTableDecos) {
        if (x.deleted) continue;
        const cx = x.src.x + x.src.w * 0.5;
        if (cx >= slot.srcLeft - 1 && cx <= slot.srcRight + 1) { x.deleted = true; place(x); }
      }
    }
    colSlots.splice(colIdx, 1);
    T.colOffsets.splice(colIdx, 1);
    for (const s of delSecs) {
      s.cellDeleted = true; s.ed.setParas([{ text: '', marker: false }]); s.ed.el.remove();
      s.o.deleted = true; place(s.o);
    }
    for (let i = colSecs.length - 1; i >= 0; i--) {
      if (colSecs[i].model.cell.col === colIdx) colSecs.splice(i, 1);
      else if (colSecs[i].model.cell.col > colIdx) {
        colSecs[i].model.cell.col--;
        if (colSecs[i].o.cell) colSecs[i].o.cell.col = colSecs[i].model.cell.col;
        if (colSecs[i].o._origPart && colSecs[i].o._origPart.cell) colSecs[i].o._origPart.cell.col = colSecs[i].model.cell.col;
        colSecs[i].ed.el.dataset.col = colSecs[i].model.cell.col;
        touchedTextObjs.add(colSecs[i].o);
      }
    }
    T.colCount--;
    reindexRowAndColMeta();
    syncCellWidths();
    T.syncColUi();
    T.syncColTable();
    flushTextSync();
  }; T.deleteColumn = deleteColumn;

  const deleteRow = (rowIdx) => {
    if (cellRows.length <= 1) return;
    commitSnap();
    markStructureEdited();
    const row = cellRows[rowIdx];
    const rowSecs = colSecs.filter((x) => x.rowEl === row);
    const rSlot = rowSlots[rowIdx];
    const rowH = rSlot ? rSlot.slotHUi : 16;
    if (rSlot && rSlot.srcTop != null && rSlot.srcBot != null) {
      for (const x of innerTableDecos) {
        if (x.deleted) continue;
        const cy = x.src.y + x.src.h * 0.5;
        if (cy >= rSlot.srcTop - 1 && cy <= rSlot.srcBot + 1) { x.deleted = true; place(x); }
      }
    }
    rowSlots.splice(rowIdx, 1);
    T.rowMinH.splice(rowIdx, 1);
    for (const s of rowSecs) {
      s.cellDeleted = true; s.ed.setParas([{ text: '', marker: false }]);
      s.o.deleted = true; place(s.o);
    }
    for (let i = colSecs.length - 1; i >= 0; i--) if (colSecs[i].rowEl === row) colSecs.splice(i, 1);
    for (let r = rowIdx + 1; r < cellRows.length; r++) {
      for (const s of colSecs.filter((x) => x.rowEl === cellRows[r])) {
        s.o._rowTargetY = (s.o._rowTargetY ?? s.o._base.y) - rowH;
        s.o.y = s.o._rowTargetY; s.y = s.o.y; place(s.o);
        touchedTextObjs.add(s.o);
      }
    }
    row.remove();
    cellRows.splice(rowIdx, 1);
    reindexRowAndColMeta();
    T.syncColUi();
    T.syncColTable();
    flushTextSync();
  }; T.deleteRow = deleteRow;

  T.stepColWidth = (c, d) => {
    if (c < 0 || c >= T.colCount) return;
    T.colOffsets[c] = Math.max(-120, (T.colOffsets[c] || 0) + d);
    for (const s of colSecs) if (s.model.cell.col >= c) touchedTextObjs.add(s.o);
    syncCellWidths(); T.syncColUi(); T.syncColTable(); flushTextSync(); commitSnap();
  };
  T.canShrinkRow = (r) => r >= 0 && r < cellRows.length && T.rowMinH[r] != null && T.rowMinH[r] > ((T.rowContentHUi && T.rowContentHUi[r]) || 0) + 0.5;
  T.stepRowHeight = (r, d) => {
    if (r < 0 || r >= cellRows.length) return;
    const sc0 = tableSc;
    const contentH = (T.rowContentHUi && T.rowContentHUi[r]) || (rowSlots[r] ? rowSlots[r].slotHUi : 16 * sc0);
    const curH = (T.rowEffHUi && T.rowEffHUi[r]) || contentH;
    const step = d * sc0;
    if (step < 0 && curH <= contentH + 0.5) return;
    const nextH = curH + step;
    if (nextH <= contentH + 0.5) T.rowMinH[r] = null;
    else {
      if (cellRows[r]._natDomH == null) cellRows[r]._natDomH = cellRows[r].getBoundingClientRect().height;
      T.rowMinH[r] = nextH;
    }
    for (let rr = r; rr < cellRows.length; rr++) {
      for (const s of colSecs) if (s.rowEl === cellRows[rr]) touchedTextObjs.add(s.o);
    }
    T.syncColTable(); T.syncColUi(); flushTextSync(); commitSnap();
  };
}
