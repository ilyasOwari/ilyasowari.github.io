// Live table layout (syncColTable) and structural operations: hold-repeat, swap columns/rows, insert/delete column and row.
// Part of aeTable.js: runs inside setupAeTable(); `T` is the shared table state built there.
import { setupTableStruct } from './aeTableStruct.js';
import { buildTableStyleProps } from '../../../core/tableStyle.js';
import { computeTableHorizontalLayout } from '../../../core/tableLayout.js';

export function setupTableOps(T) {
  const {
    an, anchorCenterUiX, applyLiveEditorTheme, belowTableObjs, cellRows,
    colSecs, colSlots, commitSnap, flushTextSync, initialTableLeftUi, initialTableTopUi,
    initialTotalTableHUi, initialTotalTableWUi, innerTableDecos, mainGrid,
    maxAllowedTableWUi, maxPageUiX, minPageUiX, objs, origPalette,
    place, render, rowSlots, savedColOffsets, scaleOf,
    sideTapeDecos, sideTapeGfx, syncCellWidths, touchedTextObjs,
  } = T;
  T.colOffsets = Array.from({ length: T.colCount }, (_, c) => Number(savedColOffsets && savedColOffsets[c]) || 0);
  T.rowMinH = Array.from({ length: cellRows.length }, () => null);
  syncCellWidths();
  const tableSc = mainGrid ? scaleOf(mainGrid) : (T.tableSc || (colSecs[0] ? scaleOf(colSecs[0].o) : 1));
  const baseScaleOf = (o) => o._tblBaseSc ?? tableSc;
  for (const s of colSecs) {
    const curSc = scaleOf(s.o);
    const wasAutoFit = !!(s.o.cell && s.o.cell.autoFit) || (!!T.existingSpec && curSc < tableSc - 0.005);
    const baseSc = wasAutoFit ? tableSc : curSc;
    s.o._tblBaseSc = baseSc;
    if (wasAutoFit) {
      if (s.o.cell) s.o.cell.autoFit = true;
      const natH = s.o.dh * baseSc;
      if (natH > s.o.h + 0.1 && !(s.o.cell && s.o.cell.vAlign)) {
        const unshiftedY = s.o.y - (natH - s.o.h) * 0.5;
        s.o._rowTargetY = unshiftedY;
        if (s.o._base) s.o._base.y = unshiftedY;
      }
      if (curSc > 0.01 && baseSc > curSc + 1e-4) {
        const ratioUp = baseSc / curSc;
        if (s.o._tblW0 != null) s.o._tblW0 *= ratioUp;
        if (s.o._inkW != null) s.o._inkW *= ratioUp;
      }
    }
    if (s.model && s.model.area) s._lastLayoutRight = s.model.area.right;
    if (s.model && (s.model.paras || []).some((p) => p.align) && s.o.edit && Array.isArray(s.o.edit.runs) && s.o.edit.runs.length) {
      const lineExt = new Map();
      for (const r of s.o.edit.runs) {
        const ky = Math.round((r.y || 0) * 2);
        const cur = lineExt.get(ky) || [Infinity, -Infinity];
        lineExt.set(ky, [Math.min(cur[0], r.x), Math.max(cur[1], r.x + (r.w || 0))]);
      }
      const inkSpanSrc = Math.max(1, ...[...lineExt.values()].map(([l, r]) => r - l));
      s.o._inkW = Math.min(s.o.dw * baseSc, inkSpanSrc * baseSc);
    }
  }
  T.nextRowId = 0;
  let initRowY = initialTableTopUi;
  for (let r = 0; r < cellRows.length; r++) {
    cellRows[r]._rowId = 'r' + (T.nextRowId++);
    const sh = rowSlots[r] ? rowSlots[r].slotHUi : 0;
    for (const s of colSecs) {
      if (s.rowEl === cellRows[r]) s.o._offsetInRowUi = (s.o._rowTargetY ?? s.o._base.y) - initRowY;
    }
    initRowY += sh;
  }
  const prevGridMoved = !!(mainGrid && mainGrid.edit && mainGrid.edit.tableSpec && mainGrid.edit.tableSpec.gridMoved);
  T.structureEdited = !!(mainGrid && mainGrid.edit && mainGrid.edit.tableSpec && mainGrid.edit.tableSpec.structureEdited);
  T.tapeTrimmed = !!(mainGrid && mainGrid.edit && mainGrid.edit.tableSpec && mainGrid.edit.tableSpec.tapeTrimmed);
  T.tableLeftUi = initialTableLeftUi;
  T.tableTotalWUi = initialTotalTableWUi;
  const initColWUi = colSlots.map((sl) => sl.slotWUi), initRowHUi = rowSlots.map((sl) => sl.slotHUi);
  const markStructureEdited = () => {
    T.structureEdited = true;
    for (const tObj of sideTapeDecos) {
      delete tObj._hiddenByTableStyle;
      if (!tObj.deleted) { tObj.deleted = true; place(tObj); }
    }
    if (mainGrid && sideTapeGfx.size && Array.isArray(mainGrid.keep)) {
      mainGrid.keep = mainGrid.keep.filter((gi) => !sideTapeGfx.has(gi));
    }
    if (!T.tapeTrimmed && T.bodyBoxSrc && mainGrid && colSlots.length >= 2) {
      const leftOverUi = Math.max(0, (T.bodyBoxSrc.x0 - mainGrid.src.x) * tableSc);
      const rightOverUi = Math.max(0, (mainGrid.src.x + mainGrid.src.w - T.bodyBoxSrc.x1) * tableSc);
      if (leftOverUi > 2 * tableSc && leftOverUi < colSlots[0].slotWUi * 0.45) {
        T.tableLeftUi += leftOverUi;
        colSlots[0].slotWUi -= leftOverUi;
        T.tableTotalWUi -= leftOverUi;
        for (const s of colSecs) {
          if (s.model.cell.col === 0 && !s.o.deleted) {
            s.o._offsetInSlotUi = Math.max(2 * tableSc, (s.o._offsetInSlotUi ?? 3.5 * tableSc) - leftOverUi);
          }
        }
      }
      if (rightOverUi > 2 * tableSc && rightOverUi < colSlots[colSlots.length - 1].slotWUi * 0.45) {
        colSlots[colSlots.length - 1].slotWUi -= rightOverUi;
        T.tableTotalWUi -= rightOverUi;
      }
      T.tapeTrimmed = true;
    }
  };
  const placeCellVaY = (s, topUi, effH, sc0) => {
    const va = (s.o.cell && s.o.cell.vAlign) || (s.model && s.model.cell && s.model.cell.vAlign) || null;
    if (va !== 'top' && va !== 'middle' && va !== 'bottom') return false;
    const freeH = Math.max(0, effH - s.o.h), vPad = Math.min(2.5 * sc0, freeH * 0.5);
    s.o.y = va === 'top' ? topUi + vPad : (va === 'middle' ? topUi + freeH * 0.5 : topUi + effH - s.o.h - vPad);
    return true;
  };

  T.syncColTable = () => {
    const refO = colSecs[0] && colSecs[0].o;
    if (!refO) return;
    const sc0 = tableSc;

    let curTableTopUi = initialTableTopUi;
    for (const ab of T.aboveTableObjs || []) {
      if (ab.deleted) continue;
      const wantTop = ab.y + ab.h + (ab._origGapToTable ?? 6);
      if (wantTop > curTableTopUi) curTableTopUi = wantTop;
    }
    const tableShiftY = curTableTopUi - initialTableTopUi;

    // 1. SATIR YÜKSEKLİKLERİ VE DİKEY POZİSYONLAR (Gerçek metin yüksekliğine kilitli)
    let accRowShiftY = 0, curRowTopUi = curTableTopUi;
    const rowEffHUi = new Array(cellRows.length).fill(0);
    const rowContentHUi = new Array(cellRows.length).fill(0);
    const rowTopUi = new Array(cellRows.length).fill(0);
    for (let r = 0; r < cellRows.length; r++) {
      rowTopUi[r] = curRowTopUi;
      const rs = colSecs.filter((s) => s.rowEl === cellRows[r] && !s.o.deleted);
      const rSlot = rowSlots[r];
      const baseSlotH = rSlot ? rSlot.slotHUi : 12 * sc0;
      let extraH = 0;
      for (const s of rs) {
        const baseSc = baseScaleOf(s.o);
        const cellGrow = Math.max(0, (s.o.dh - s.o._base.dh) * baseSc);
        if (cellGrow > extraH) extraH = cellGrow;
        if (s.o.dh > s.o._base.dh + 0.5) {
          const topPad = Math.max(2 * sc0, Math.min(5 * sc0, s.o._offsetInRowUi != null ? Math.max(0, s.o._offsetInRowUi) : 2.5 * sc0));
          const needSlotH = s.o.dh * baseSc + topPad + 2.5 * sc0;
          if (needSlotH - baseSlotH > extraH) extraH = needSlotH - baseSlotH;
        }
      }
      const contentH = baseSlotH + extraH;
      rowContentHUi[r] = contentH;
      const effH = Math.max(contentH, T.rowMinH[r] != null ? T.rowMinH[r] : 0);
      rowEffHUi[r] = effH;
      for (const s of rs) {
        if (!placeCellVaY(s, curRowTopUi, effH, sc0)) s.o.y = (s.o._rowTargetY ?? s.o._base.y) + tableShiftY + accRowShiftY;
        s.o._unscaledY = s.o.y;
        s.y = s.o.y;
        place(s.o);
      }
      const extraManualH = Math.max(0, effH - contentH);
      if (extraManualH > 0.5) {
        if (cellRows[r]._natDomH == null) cellRows[r]._natDomH = cellRows[r].getBoundingClientRect().height;
        cellRows[r].style.minHeight = Math.round(cellRows[r]._natDomH + extraManualH * 1.25) + 'px';
      } else if (cellRows[r].style.minHeight) {
        cellRows[r].style.minHeight = '';
      }
      curRowTopUi += effH;
      accRowShiftY += (effH - baseSlotH);
    }
    T.rowEffHUi = rowEffHUi;
    T.rowContentHUi = rowContentHUi;

    // 2. SÜTUN GENİŞLİKLERİ VE METİN ALANI (`area.right`)
    const colEffWUi = new Array(T.colCount).fill(0);
    for (let c = 0; c < T.colCount; c++) {
      const cs = colSecs.filter((s) => s.model.cell.col === c && !s.o.deleted);
      const baseSlotWUi = colSlots[c] ? colSlots[c].slotWUi : 48 * sc0;
      const userWidthDeltaUi = (T.colOffsets[c] || 0) * sc0;
      const targetSlotWUi = Math.max(24 * sc0, baseSlotWUi + userWidthDeltaUi);
      const usableColWPT = Math.max(14, (targetSlotWUi / sc0) - 5);

      for (const s of cs) {
        if (s.model && s.model.area) {
          const aLeft = s.model._origAreaLeft ?? s.model.area.left;
          const origSpan = s.model._origAreaSpan ?? (s.model.area.right - aLeft);
          const newSpan = Math.max(origSpan + (T.colOffsets[c] || 0), usableColWPT);
          s.model.area.right = aLeft + newSpan;
          if (s.model.cellRight != null) s.model.cellRight = aLeft + newSpan + 2;
          s.maxGrowX = Math.max(s.maxGrowX || 0, newSpan);
          if (s.o.addedText) s.o.baseW = Math.max(24, newSpan);
        }
      }

      let textNeedWUi = 0;
      for (const s of cs) {
        const isHAligned = !!(s.ed && s.ed.hasAlign && s.ed.hasAlign());
        const padInSlot = isHAligned ? Math.min(3.5 * sc0, baseSlotWUi * 0.12) : (s.o._offsetInSlotUi ?? (3.5 * sc0));
        // right padding: never ask for more than the original artwork had,
        // otherwise a no-op Uygula widens tight columns (and the table)
        const natW = s.o.dw * baseScaleOf(s.o), w0 = s.o._tblW0 ?? natW;
        const rightPad = Math.min(3.5 * sc0, Math.max(0, baseSlotWUi - padInSlot - w0));
        let needed = padInSlot + (s.o._inkW ?? natW) + rightPad;
        // a cell that did not grow already fits its original column (its
        // object may span the whole cell, e.g. a header with a fill): a no-op
        // Uygula must not widen the table
        if (!isHAligned && natW <= w0 + 0.5) needed = Math.min(needed, baseSlotWUi);
        if (needed > textNeedWUi) textNeedWUi = needed;
      }
      colEffWUi[c] = (T.colOffsets[c] || 0) < 0 ? Math.max(24 * sc0, targetSlotWUi) : Math.max(24 * sc0, targetSlotWUi, textNeedWUi);
    }

    // 3. YÖNLÜ YATAY GENİŞLEME (ortalı -> iki yana eşit; sola yakın -> sağa; sağa yakın -> sola)
    let rawTotalWUi = colEffWUi.reduce((a, b) => a + b, 0);
    const anyManualWiden = T.colOffsets.some((v) => v > 0);
    let hLay = computeTableHorizontalLayout({
      initLeft: T.tableLeftUi,
      initW: T.tableTotalWUi,
      rawTotalW: rawTotalWUi,
      expandMode: T.expandMode || 'center',
      minPageX: minPageUiX,
      maxPageX: maxPageUiX,
      manualWiden: anyManualWiden,
      pageW: T.pageW || 595,
    });
    const tableHitMaxW = !!hLay.clamped;
    if (tableHitMaxW && rawTotalWUi > hLay.maxTotalW + 0.5) {
      const shrinkFactor = hLay.maxTotalW / rawTotalWUi;
      for (let c = 0; c < T.colCount; c++) {
        colEffWUi[c] = Math.max(18 * sc0, colEffWUi[c] * shrinkFactor);
      }
      rawTotalWUi = colEffWUi.reduce((a, b) => a + b, 0);
      if (rawTotalWUi > hLay.maxTotalW + 0.5) {
        const renorm = hLay.maxTotalW / rawTotalWUi;
        for (let c = 0; c < T.colCount; c++) colEffWUi[c] *= renorm;
        rawTotalWUi = colEffWUi.reduce((a, b) => a + b, 0);
      }
      hLay = computeTableHorizontalLayout({
        initLeft: T.tableLeftUi,
        initW: T.tableTotalWUi,
        rawTotalW: rawTotalWUi,
        expandMode: T.expandMode || 'center',
        minPageX: minPageUiX,
        maxPageX: maxPageUiX,
        manualWiden: anyManualWiden,
        pageW: T.pageW || 595,
      });
    }
    let startTableUiX = hLay.startX;

    const gridMoved = prevGridMoved
      || !!T.structureEdited
      || colEffWUi.length !== initColWUi.length
      || rowEffHUi.length !== initRowHUi.length
      || colEffWUi.some((w, i) => Math.abs(w - initColWUi[i]) > 1.0)
      || rowEffHUi.some((h, i) => Math.abs(h - initRowHUi[i]) > 1.0);

    const colEdgeUiX = new Array(T.colCount + 1).fill(0);
    colEdgeUiX[0] = startTableUiX;
    const cellPlans = [];
    let uniformTableFit = 1;
    for (let c = 0; c < T.colCount; c++) {
      colEdgeUiX[c + 1] = colEdgeUiX[c] + colEffWUi[c];
      const slotLeftUi = colEdgeUiX[c];
      const origSlotWUi = colSlots[c] ? colSlots[c].slotWUi : colEffWUi[c];
      const colNarrowed = colEffWUi[c] < origSlotWUi - 0.5;
      const rightGuard = Math.min(2.5 * sc0, colEffWUi[c] * 0.08);
      const colPlans = [];
      let colCapPad = Infinity;
      for (const s of colSecs) {
        if (s.model.cell.col !== c || s.o.deleted) continue;
        const baseSc = baseScaleOf(s.o), natW = s.o.dw * baseSc, natH = s.o.dh * baseSc;
        const hasHAlign = !!(s.ed && s.ed.hasAlign && s.ed.hasAlign()), wasEdited = !!(s.o.addedText || s.o.edit);
        let padInSlot;
        if (hasHAlign && s.model && s.model.area && s.o._origPart) {
          const hPadPt = Math.min(3.5, (colEffWUi[c] / baseSc) * 0.12);
          const innerWPt = Math.max(12, (colEffWUi[c] / baseSc) - 2 * hPadPt), baseSrcX = s.o._origPart.src.x;
          s.model.area.left = baseSrcX + 1; s.model.area.right = baseSrcX + 1 + innerWPt;
          if (s.model.cellRight != null) s.model.cellRight = baseSrcX + 1 + innerWPt + 2;
          s.o._cellInnerW = innerWPt + 1;
          if (s.o.addedText) s.o.baseW = Math.max(24, innerWPt);
          padInSlot = Math.max(0, hPadPt - 1) * baseSc;
        } else {
          if (s.model && s.model.area) {
            if (s.model._origAreaLeft != null) s.model.area.left = s.model._origAreaLeft;
            if (colNarrowed || s.o.addedText) {
              const innerPt = Math.max(12, (colEffWUi[c] / baseSc) - 4);
              s.model.area.right = s.model.area.left + innerPt;
              if (s.model.cellRight != null) s.model.cellRight = s.model.area.left + innerPt + 2;
              s.o._cellInnerW = innerPt;
              if (s.o.addedText) s.o.baseW = Math.max(24, innerPt);
            } else if (s.o._cellInnerW != null) {
              delete s.o._cellInnerW;
            }
          }
          if (colNarrowed) {
            const ratio = origSlotWUi > 0 ? Math.min(1, colEffWUi[c] / origSlotWUi) : 1;
            padInSlot = Math.min(colEffWUi[c] * 0.2, (s.o._offsetInSlotUi ?? (3.5 * sc0)) * ratio);
          } else {
            padInSlot = s.o._offsetInSlotUi != null ? Math.min(colEffWUi[c] * 0.35, s.o._offsetInSlotUi) : 3.5 * sc0;
          }
        }
        const visW = (s.o.keep && s.o.keep.length) ? Math.max(natW, s.o._inkW ?? 0) : (s.o._inkW ?? natW);
        const wasAutoFit = !!(s.o.cell && s.o.cell.autoFit);
        const allowFit = colNarrowed || wasEdited || wasAutoFit || tableHitMaxW;
        if (!hasHAlign && allowFit && padInSlot + visW + rightGuard > colEffWUi[c]) {
          const minPad = Math.min(rightGuard, colEffWUi[c] * 0.06);
          if (padInSlot > minPad) {
            const reduced = Math.max(minPad, Math.min(padInSlot, (colEffWUi[c] - visW) * 0.5));
            if (reduced < colCapPad) colCapPad = reduced;
          }
        }
        colPlans.push({ s, hasHAlign, slotLeftUi, padInSlot, natW, natH, visW, wasAutoFit, allowFit });
      }
      for (const item of colPlans) {
        if (!item.hasHAlign && colCapPad < Infinity) item.padInSlot = Math.min(item.padInSlot, colCapPad);
        const availW = Math.max(8 * sc0, colEffWUi[c] - item.padInSlot - rightGuard);
        const needFit = item.allowFit && item.visW > availW + 0.5;
        const cellFit = needFit ? Math.max(0.35, Math.min(1, availW / item.visW)) : 1;
        if (tableHitMaxW && cellFit < uniformTableFit) uniformTableFit = Math.max(0.45, cellFit);
        cellPlans.push({ ...item, cellFit });
      }
    }
    for (const { s, slotLeftUi, padInSlot, natW, natH, wasAutoFit, cellFit } of cellPlans) {
      const fit = tableHitMaxW ? Math.min(uniformTableFit, cellFit) : cellFit;
      s.o.x = slotLeftUi + padInSlot;
      const setAutoFit = (cell) => { if (!cell) return; if (fit < 0.999) cell.autoFit = true; else delete cell.autoFit; };
      setAutoFit(s.o.cell); setAutoFit(s.model && s.model.cell); setAutoFit(s.o._origPart && s.o._origPart.cell);
      s.o.w = natW * fit; s.o.h = natH * fit;
      if (fit < 0.999 || wasAutoFit || (s.o.cell && s.o.cell.vAlign)) {
        const r = cellRows.indexOf(s.rowEl);
        if (!(r >= 0 && placeCellVaY(s, rowTopUi[r], rowEffHUi[r], sc0))) {
          s.o.y = (s.o._unscaledY ?? s.o.y) + (natH - s.o.h) * 0.5;
        }
        s.y = s.o.y;
      }
      place(s.o);
    }

    // 4. VEKTÖR TABLO KOORDİNATLARINI (`xs` ve `ys`) HESAPLA VE ÇİZDİR
    if (mainGrid && !mainGrid.deleted) {
      const scU = scaleOf(mainGrid);
      mainGrid.x = startTableUiX;
      mainGrid.y = curTableTopUi;

      const xs = [mainGrid.src.x];
      for (let c = 0; c < T.colCount; c++) {
        xs.push(xs[xs.length - 1] + colEffWUi[c] / scU);
      }
      const ys = [mainGrid.src.y];
      for (let r = 0; r < cellRows.length; r++) {
        ys.push(ys[ys.length - 1] + rowEffHUi[r] / scU);
      }
      const totalW = xs[xs.length - 1] - xs[0];
      const totalH = ys[ys.length - 1] - ys[0];
      const styleProps = buildTableStyleProps(T.tablePattern, T.tableColor, origPalette, T.tableCustom);

      const dropSideTapes = !!(T.structureEdited || T.tableColor !== 'orijinal' || T.tablePattern);
      if (dropSideTapes) {
        if (sideTapeGfx.size && Array.isArray(mainGrid.keep)) {
          mainGrid.keep = mainGrid.keep.filter((gi) => !sideTapeGfx.has(gi));
        }
        for (const tObj of sideTapeDecos) {
          if (T.structureEdited) delete tObj._hiddenByTableStyle;
          if (!tObj.deleted) {
            if (!T.structureEdited) tObj._hiddenByTableStyle = true;
            tObj.deleted = true;
            place(tObj);
          }
        }
      } else {
        if (sideTapeGfx.size) {
          mainGrid.keep = [...new Set([...(mainGrid.keep || []), ...sideTapeGfx])].sort((a, b) => a - b);
        }
        for (const tObj of sideTapeDecos) {
          if (tObj._hiddenByTableStyle) {
            delete tObj._hiddenByTableStyle;
            tObj.deleted = false;
            place(tObj);
          }
        }
      }
      mainGrid.edit = {
        ...(mainGrid.edit || {}),
        removeGlyphs: [],
        runs: [],
        deltaX: totalW - mainGrid.src.w,
        delta: totalH - mainGrid.src.h,
        tableSpec: {
          xs,
          ys,
          gridMoved,
          structureEdited: !!T.structureEdited,
          tapeTrimmed: !!T.tapeTrimmed,
          ...styleProps,
        },
      };
      mainGrid.dw = Math.max(4, totalW);
      mainGrid.dh = Math.max(4, totalH);
      mainGrid.w = mainGrid.dw * scU;
      mainGrid.h = mainGrid.dh * scU;
      place(mainGrid);
      render(mainGrid);

      const gridShiftUiX = startTableUiX - initialTableLeftUi;
      const rightEdgeDeltaUi = (startTableUiX + rawTotalWUi) - (initialTableLeftUi + initialTotalTableWUi);
      for (const tObj of sideTapeDecos) {
        if (tObj.deleted) continue;
        if (tObj._isSideDeco === 'right') {
          tObj.x = Math.max(0, (tObj._baseXOnOpen ?? tObj._base.x) + rightEdgeDeltaUi);
        } else {
          tObj.x = Math.max(0, (tObj._baseXOnOpen ?? tObj._base.x) + gridShiftUiX);
        }
        tObj.y = (tObj._baseYOnOpen ?? tObj._base.y) + tableShiftY;
        place(tObj);
      }

      if (Math.abs(tableShiftY) > 0.3 || innerTableDecos.some((d) => !d.deleted && d._baseYOnOpen != null && Math.abs(d.y - d._baseYOnOpen) > 0.3)) {
        for (const d of innerTableDecos) {
          if (d.deleted) continue;
          d.y = (d._baseYOnOpen ?? d._base.y) + tableShiftY;
          place(d);
        }
      }

      const sessionDyUi = (totalH * scU) - initialTotalTableHUi;
      const totalBottomShiftUi = tableShiftY + Math.max(0, sessionDyUi);
      for (const x of belowTableObjs) {
        if (x.deleted) continue;
        x.y = (x._baseYOnOpen ?? x._base.y) + Math.max(0, totalBottomShiftUi);
        place(x);
      }

      const tableBotUiNow = curTableTopUi + totalH * scU;
      for (const ou of T.outerDialogueObjs || []) {
        if (ou.deleted || !ou._base) continue;
        if (!(ou._origEnclosesTable || tableBotUiNow > ou._base.y + ou._base.h)) continue;
        const needBot = tableBotUiNow + (ou._origPadBelowTable ?? 8);
        if (needBot <= ou.y + ou.h + 0.5) continue;
        const needDeltaUi = needBot - (ou._base.y + ou._base.h);
        if (ou.type === 'bg') {
          const nw = ou.nine ? ou.nine.w : ou.src.w;
          const s0 = ou.w / nw;
          ou.h = ou._base.h + needDeltaUi;
          ou.nine = { w: nw, h: ou.h / s0 };
        } else {
          const sOu = scaleOf(ou);
          const cutSrc = Math.max(ou.src.y + 8, Math.min(ou.src.y + ou.src.h - 6, ou.src.y + (curTableTopUi - ou.y) / sOu - 2));
          ou.h = ou._base.h + needDeltaUi;
          ou.edit = { removeGlyphs: [], runs: [], ...(ou.edit || {}), oldBottom: (ou.edit && ou.edit.oldBottom) || cutSrc, delta: needDeltaUi / sOu, stripH: 4 };
          ou.dh = ou.src.h + ou.edit.delta;
        }
        place(ou); render(ou);
      }
    }
    applyLiveEditorTheme();
    for (const s of colSecs) if (!s.o.deleted && s.ed && s.ed.applyWall) s.ed.applyWall();
  };

  const bindHoldRepeat = (btn, fn, onStop) => {
    let holdT = null, holdI = null, handled = false, active = false;
    const stop = () => {
      if (holdT) { clearTimeout(holdT); holdT = null; }
      if (holdI) { clearInterval(holdI); holdI = null; }
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('pointercancel', stop, true);
      window.removeEventListener('blur', stop, true);
      if (active) { active = false; if (onStop) onStop(); }
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || btn.disabled) return;
      e.preventDefault();
      stop();
      handled = true;
      active = true;
      window.addEventListener('pointerup', stop, true);
      window.addEventListener('pointercancel', stop, true);
      window.addEventListener('blur', stop, true);
      fn();
      holdT = setTimeout(() => {
        holdI = setInterval(() => {
          if (btn.disabled || !btn.isConnected) stop();
          else fn();
        }, 55);
      }, 300);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('blur', stop);
    btn.addEventListener('click', (e) => {
      if (handled) { handled = false; e.preventDefault(); return; }
      if (!btn.disabled) { fn(); if (onStop) onStop(); }
    });
  }; T.bindHoldRepeat = bindHoldRepeat;

  setupTableStruct(T, { tableSc, baseScaleOf, markStructureEdited });
}
