// Table grid bounds, divider/slot extraction, original palette detection, and expand mode classification.
// Part of aeTableGrid.js: runs inside setupTableGrid(); `T` is the shared table state.
import { cloneCustom, cellFill, migrateTableStyle } from '../../../core/tableStyle.js';
import { classifyTableExpandMode } from '../../../core/tableLayout.js';

export function setupTableSlots(T, { isTableStructureGfx, tableGridObjs, outerDialogueObjs, nonTableSecs }) {
  const { an, cellRows, colSecs, ctx, mainGrid, objs, scaleOf } = T;
  const existingSpec = mainGrid && mainGrid.edit && mainGrid.edit.tableSpec ? mainGrid.edit.tableSpec : null;

  const dedupCoords = (arr, tol = 1.8) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const out = [];
    for (const v of sorted) {
      if (!out.length || v - out[out.length - 1] > tol) out.push(v);
      else out[out.length - 1] = (out[out.length - 1] + v) * 0.5;
    }
    return out;
  };

  const rawVLines = [], rawHLines = [];
  let innerVSegCount = 0, innerHSegCount = 0, outerVSegCount = 0, outerHSegCount = 0, strokedCellRects = 0;
  if (existingSpec && Array.isArray(existingSpec.xs) && Array.isArray(existingSpec.ys)) {
    rawVLines.push(...existingSpec.xs);
    rawHLines.push(...existingSpec.ys);
    innerVSegCount = existingSpec.origPalette?.innerV ? 3 : 0;
    innerHSegCount = existingSpec.origPalette?.innerH ? 3 : 0;
    if (existingSpec.origPalette?.outerBorder) { outerVSegCount = 2; outerHSegCount = 2; }
  } else if (an && an.atoms && an.atoms.gfx && mainGrid && mainGrid.keep) {
    for (const gi of mainGrid.keep) {
      const g = an.atoms.gfx[gi];
      if (!isTableStructureGfx(g)) continue;
      const gw = g.b.x1 - g.b.x0, gh = g.b.y1 - g.b.y0;
      if (gw <= 3.8 && gh >= 10) {
        const mx = (g.b.x0 + g.b.x1) * 0.5;
        rawVLines.push(mx);
        if (mx > mainGrid.src.x + 6 && mx < mainGrid.src.x + mainGrid.src.w - 6) innerVSegCount++;
        else outerVSegCount++;
      }
      if (gh <= 3.8 && gw >= 14) {
        const my = (g.b.y0 + g.b.y1) * 0.5;
        rawHLines.push(my);
        if (my > mainGrid.src.y + 6 && my < mainGrid.src.y + mainGrid.src.h - 6) innerHSegCount++;
        else outerHSegCount++;
      }
      if (gw > 14 && gh > 14) {
        rawVLines.push(g.b.x0, g.b.x1);
        rawHLines.push(g.b.y0, g.b.y1);
        if (g.stroke) {
          if (gw < mainGrid.src.w * 0.85 && (g.b.x0 > mainGrid.src.x + 6 || g.b.x1 < mainGrid.src.x + mainGrid.src.w - 6)) {
            innerVSegCount++;
            strokedCellRects++;
          }
          if (gh < mainGrid.src.h * 0.85 && (g.b.y0 > mainGrid.src.y + 6 || g.b.y1 < mainGrid.src.y + mainGrid.src.h - 6)) {
            innerHSegCount++;
            strokedCellRects++;
          }
        }
      }
    }
  }
  const tableVLines = dedupCoords(rawVLines, 2.0);
  const tableHLines = dedupCoords(rawHLines, 2.0);

  const detectOrigColors = () => {
    if (existingSpec && existingSpec.origPalette) return existingSpec.origPalette;
    const innerH = innerHSegCount >= 1;
    const innerV = innerVSegCount >= 1;
    const hasRealGrid = innerH || innerV;
    let hasOuterStroke = (outerHSegCount >= 2 && outerVSegCount >= 2) || strokedCellRects >= 2;
    let headerBg = hasRealGrid ? [241, 245, 249] : null;
    let bodyBg = [255, 255, 255];
    let borderColor = [203, 213, 225];
    let borderWidth = hasRealGrid ? 0.75 : 0;
    let radius = 0;
    let borderStyle = 'solid';

    if (an && an.atoms && an.atoms.gfx && mainGrid && mainGrid.keep) {
      const r0Secs = colSecs.filter((s) => s.rowEl === cellRows[0]);
      const r0MinY = r0Secs.length ? Math.min(...r0Secs.map((s) => s.o.src.y)) - 8 : mainGrid.src.y;
      const r0MaxY = r0Secs.length ? Math.max(...r0Secs.map((s) => s.o.src.y + s.o.src.h)) + 8 : mainGrid.src.y + 35;

      for (const gi of mainGrid.keep) {
        const g = an.atoms.gfx[gi];
        if (!g || !g.b || !isTableStructureGfx(g)) continue;
        const gw = g.b.x1 - g.b.x0, gh = g.b.y1 - g.b.y0;
        const fRgb = g.rgb || g.item?.fillRgb;
        const sRgb = g.item?.strokeRgb;

        if ((gw <= 3.5 && gh >= 12) || (gh <= 3.5 && gw >= 14)) {
          const lc = (g.fill && fRgb) ? fRgb : sRgb;
          if (lc && lc.length === 3 && (lc[0] < 248 || lc[1] < 248 || lc[2] < 248)) {
            borderColor = lc.map((v) => Math.round(v));
          }
          if (g.item?.lw) borderWidth = Math.max(0.5, Math.min(2.0, g.item.lw));
        } else if (gw > 50 && gh > 22) {
          if (g.fill && fRgb && gh > (mainGrid.src.h * 0.45)) {
            bodyBg = fRgb.map((v) => Math.round(v));
            if (!hasRealGrid) {
              headerBg = [...bodyBg];
              if (!g.item?.isRect) radius = 6;
            }
          } else if (hasRealGrid && g.fill && fRgb && gh >= 12 && gh <= 65 && Math.abs(g.b.y0 - r0MinY) < 18 && g.b.y1 <= r0MaxY + 14) {
            headerBg = fRgb.map((v) => Math.round(v));
          }
          if (g.stroke && sRgb) {
            hasOuterStroke = true;
            borderColor = sRgb.map((v) => Math.round(v));
            borderWidth = Math.max(0.8, Math.min(2.2, g.item?.lw || 1.2));
            if (!hasRealGrid && g.item && !g.item.isRect && g.item.nSub > 4) {
              borderStyle = 'scalloped';
            }
          }
        }
      }
    }
    const effBorderWidth = (hasOuterStroke || innerH || innerV) ? Math.max(0.5, borderWidth || 0.75) : 0;
    return {
      headerBg, bodyBg, altRowBg: null, borderColor, borderWidth: effBorderWidth,
      innerH, innerV, outerBorder: hasOuterStroke, radius, borderStyle,
      noVertLines: !innerV, headerAccent: null,
    };
  };
  const origPalette = detectOrigColors(); T.origPalette = origPalette;

  const initStyle = migrateTableStyle(existingSpec);
  T.tablePattern = initStyle.pattern;
  T.tableColor = initStyle.color;
  T.tableCustom = cloneCustom(initStyle.custom);

  const applyLiveEditorTheme = () => {
    cellRows.forEach((row, rIdx) => {
      const cells = row.querySelectorAll('.te-cell');
      cells.forEach((cellEl, domIdx) => {
        const cIdx = cellEl.dataset.col != null ? Number(cellEl.dataset.col) : domIdx;
        const cFill = cellFill(T.tablePattern, T.tableColor, rIdx, cIdx, origPalette, T.tableCustom) || [255, 255, 255];
        const paper = cellEl.querySelector('.te-paper') || cellEl;
        paper.style.backgroundColor = `rgb(${cFill.join(',')})`;
      });
    });
  }; T.applyLiveEditorTheme = applyLiveEditorTheme;

  const hasXsSpec = !!(existingSpec && Array.isArray(existingSpec.xs) && existingSpec.xs.length >= 2);
  const hasYsSpec = !!(existingSpec && Array.isArray(existingSpec.ys) && existingSpec.ys.length >= 2);
  const tableMinSrcX = hasXsSpec ? existingSpec.xs[0] : (mainGrid ? mainGrid.src.x : Math.min(...colSecs.map((s) => s.o.src.x)) - 8);
  const tableMaxSrcX = hasXsSpec ? existingSpec.xs[existingSpec.xs.length - 1] : (mainGrid ? mainGrid.src.x + (mainGrid.dw ?? mainGrid.src.w) : Math.max(...colSecs.map((s) => s.o.src.x + s.o.src.w)) + 8);
  const tableMinSrcY = hasYsSpec ? existingSpec.ys[0] : (mainGrid ? mainGrid.src.y : Math.min(...colSecs.map((s) => s.o.src.y)) - 5);
  const tableMaxSrcY = hasYsSpec ? existingSpec.ys[existingSpec.ys.length - 1] : (mainGrid ? mainGrid.src.y + (mainGrid.dh ?? mainGrid.src.h) : Math.max(...colSecs.map((s) => s.o.src.y + s.o.src.h)) + 5);
  const tableUiBounds = mainGrid ? { x: mainGrid.x, y: mainGrid.y, w: mainGrid.w, h: mainGrid.h } : null;
  const scInit0 = mainGrid ? scaleOf(mainGrid) : Math.max(...colSecs.map((s) => scaleOf(s.o)));
  if (tableUiBounds) {
    for (const x of objs) {
      if (x.deleted || !x._base || x._isSideDeco || tableGridObjs.includes(x) || outerDialogueObjs.includes(x)) continue;
      if (x.type !== 'deco' && x.type !== 'box' && x.type !== 'photo') continue;
      if (x.w > 65 * scInit0 || x.h > 65 * scInit0 || x.w >= tableUiBounds.w * 0.3 || x.h >= tableUiBounds.h * 0.55) continue;
      if (x.y + x.h < tableUiBounds.y - 10 * scInit0 || x.y > tableUiBounds.y + tableUiBounds.h + 10 * scInit0) continue;
      const cx = x.x + x.w * 0.5;
      const nearLeft = Math.abs(cx - tableUiBounds.x) <= 26 * scInit0;
      const nearRight = Math.abs(cx - (tableUiBounds.x + tableUiBounds.w)) <= 26 * scInit0;
      if (nearLeft || nearRight) x._isSideDeco = nearRight && cx > tableUiBounds.x + tableUiBounds.w * 0.5 ? 'right' : 'left';
    }
  }
  const sideTapeDecos = objs.filter((x) => !x.deleted && x._isSideDeco); T.sideTapeDecos = sideTapeDecos;
  const innerTableDecos = tableUiBounds ? objs.filter((x) => !x.deleted && x._base && x.type !== 'text' && !x._isSideDeco && !tableGridObjs.includes(x) && !outerDialogueObjs.includes(x) &&
    x.x >= tableUiBounds.x - 6 && x.x + x.w <= tableUiBounds.x + tableUiBounds.w + 6 &&
    x.y >= tableUiBounds.y - 6 && x.y + x.h <= tableUiBounds.y + tableUiBounds.h + 6) : []; T.innerTableDecos = innerTableDecos;
  const belowTableObjs = tableUiBounds ? objs.filter((x) => !x.deleted && x._base && !x._isSideDeco && !tableGridObjs.includes(x) && !outerDialogueObjs.includes(x) && !innerTableDecos.includes(x) &&
    !(x.cell && x.cell.col != null) && x.y >= tableUiBounds.y + tableUiBounds.h - 4) : []; T.belowTableObjs = belowTableObjs;
  for (const x of belowTableObjs) { x._baseYOnOpen = x.y; }
  for (const tObj of sideTapeDecos) { tObj._baseXOnOpen = tObj.x; }

  const refO0 = colSecs.find((s) => !s.o.addedText)?.o || colSecs[0].o;
  const scInit = mainGrid ? scaleOf(mainGrid) : Math.max(...colSecs.map((s) => scaleOf(s.o)));
  T.tableSc = scInit;
  T.existingSpec = existingSpec;
  const gridMain = mainGrid || refO0;
  const srcToUiX = (sx) => gridMain._base.x + (sx - gridMain._base.src.x) * scInit;
  const srcToUiY = (sy) => gridMain._base.y + (sy - gridMain._base.src.y) * scInit;
  const uiToSrcX = (ux) => gridMain._base.src.x + (ux - gridMain._base.x) / scInit;
  const uiToSrcY = (uy) => gridMain._base.src.y + (uy - gridMain._base.y) / scInit;

  const colBoundsUi = [];
  for (let c = 0; c < T.colCount; c++) {
    const cs = colSecs.filter((s) => s.model.cell.col === c);
    const minL = cs.length ? Math.min(...cs.map((s) => s.o.x)) : srcToUiX(tableMinSrcX);
    const maxR = cs.length ? Math.max(...cs.map((s) => s.o.x + (s.o._tblW0 ?? s.o.w))) : srcToUiX(tableMaxSrcX);
    colBoundsUi.push({ left: minL, right: maxR });
  }
  const uiVLines = tableVLines.map(srcToUiX);
  const colDividersUi = [];
  let tableLeftUi0, tableRightUi0;
  if (existingSpec && Array.isArray(existingSpec.xs) && existingSpec.xs.length === T.colCount + 1) {
    const exactXsUi = existingSpec.xs.map(srcToUiX);
    tableLeftUi0 = exactXsUi[0];
    tableRightUi0 = exactXsUi[T.colCount];
    for (let c = 0; c < T.colCount - 1; c++) colDividersUi[c] = exactXsUi[c + 1];
  } else {
    for (let c = 0; c < T.colCount - 1; c++) {
      const rA = colBoundsUi[c].right, lB = colBoundsUi[c + 1].left;
      const defaultDiv = lB > rA + 4 * scInit ? Math.max((rA + lB) * 0.5, lB - 5 * scInit) : (rA + lB) * 0.5;
      let best = null, bestD = Infinity;
      for (const vx of uiVLines) {
        if (vx >= rA - 10 * scInit && vx <= lB + 10 * scInit) {
          const d = Math.abs(vx - defaultDiv);
          if (d < bestD) { bestD = d; best = vx; }
        }
      }
      colDividersUi[c] = best ?? defaultDiv;
    }
    const boxL = mainGrid ? srcToUiX(tableMinSrcX) : null, boxR = mainGrid ? srcToUiX(tableMaxSrcX) : null;
    tableLeftUi0 = (boxL != null && boxL <= colBoundsUi[0].left + 1 * scInit) ? boxL
      : (([...uiVLines].reverse().find((vx) => vx <= colBoundsUi[0].left + 6 * scInit)) ?? Math.min(srcToUiX(tableMinSrcX), colBoundsUi[0].left - 6 * scInit));
    tableRightUi0 = (boxR != null && boxR >= colBoundsUi[T.colCount - 1].right - 1 * scInit) ? boxR
      : ((uiVLines.find((vx) => vx >= colBoundsUi[T.colCount - 1].right - 6 * scInit)) ?? Math.max(srcToUiX(tableMaxSrcX), colBoundsUi[T.colCount - 1].right + 6 * scInit));
  }

  const colSlots = []; T.colSlots = colSlots;
  const colOrigLeft = [], colOrigRight = [];
  const minOff = existingSpec ? 1.5 * scInit : 2.5 * scInit;
  for (let c = 0; c < T.colCount; c++) {
    const leftUi = c === 0 ? tableLeftUi0 : colDividersUi[c - 1];
    const rightUi = c === T.colCount - 1 ? tableRightUi0 : colDividersUi[c];
    const slotW = Math.max(24 * scInit, rightUi - leftUi);
    colOrigLeft[c] = colBoundsUi[c].left;
    colOrigRight[c] = colBoundsUi[c].right;
    for (const s of colSecs.filter((x) => x.model.cell.col === c)) {
      const rawOff = s.o.x - leftUi;
      s.o._offsetInSlotUi = s.o.addedText ? Math.max(minOff, Math.min(slotW * 0.35, rawOff)) : Math.max(0, Math.min(slotW * 0.35, rawOff));
    }
    colSlots.push({
      baseWUi: slotW,
      slotWUi: slotW,
      srcLeft: uiToSrcX(leftUi),
      srcRight: uiToSrcX(rightUi),
    });
  }
  const maxOrigColWidthSrc = Math.max(60, ...colSlots.map((sl) => sl.slotWUi / scInit)); T.maxOrigColWidthSrc = maxOrigColWidthSrc;

  const rowBoundsUi = [];
  for (let r = 0; r < cellRows.length; r++) {
    const rs = colSecs.filter((s) => s.rowEl === cellRows[r]);
    const minT = rs.length ? Math.min(...rs.map((s) => s.o.y)) : srcToUiY(tableMinSrcY);
    const maxB = rs.length ? Math.max(...rs.map((s) => s.o.y + s.o.h)) : srcToUiY(tableMaxSrcY);
    rowBoundsUi.push({ top: minT, bottom: maxB });
  }
  const uiHLines = tableHLines.map(srcToUiY);
  const rowDividersUi = [];
  let tableTopUi0, tableBotUi0;
  if (existingSpec && Array.isArray(existingSpec.ys) && existingSpec.ys.length === cellRows.length + 1) {
    const exactYsUi = existingSpec.ys.map(srcToUiY);
    tableTopUi0 = exactYsUi[0];
    tableBotUi0 = exactYsUi[cellRows.length];
    for (let r = 0; r < cellRows.length - 1; r++) rowDividersUi[r] = exactYsUi[r + 1];
  } else {
    for (let r = 0; r < cellRows.length - 1; r++) {
      const bA = rowBoundsUi[r].bottom, tB = rowBoundsUi[r + 1].top;
      const mid = (bA + tB) * 0.5;
      let best = null, bestD = Infinity;
      for (const hy of uiHLines) {
        if (hy >= bA - 6 * scInit && hy <= tB + 6 * scInit) {
          const d = Math.abs(hy - mid);
          if (d < bestD) { bestD = d; best = hy; }
        }
      }
      rowDividersUi[r] = best ?? mid;
    }
    const padTopUi = Math.min(4 * scInit, Math.max(1.5 * scInit, (rowBoundsUi[0].bottom - rowBoundsUi[0].top) * 0.2));
    const boxT = mainGrid ? srcToUiY(tableMinSrcY) : null, boxB = mainGrid ? srcToUiY(tableMaxSrcY) : null;
    tableTopUi0 = (boxT != null && boxT <= rowBoundsUi[0].top + 1 * scInit) ? boxT
      : (([...uiHLines].reverse().find((hy) => hy <= rowBoundsUi[0].top + 3 * scInit && hy >= rowBoundsUi[0].top - 8 * scInit)) ?? (rowBoundsUi[0].top - padTopUi));
    tableBotUi0 = (boxB != null && boxB >= rowBoundsUi[cellRows.length - 1].bottom - 1 * scInit) ? boxB
      : ((uiHLines.find((hy) => hy >= rowBoundsUi[cellRows.length - 1].bottom - 3 * scInit && hy <= rowBoundsUi[cellRows.length - 1].bottom + 8 * scInit)) ?? (rowBoundsUi[cellRows.length - 1].bottom + padTopUi));
  }

  const rowSlots = []; T.rowSlots = rowSlots;
  for (let r = 0; r < cellRows.length; r++) {
    const topUi = r === 0 ? tableTopUi0 : rowDividersUi[r - 1];
    const botUi = r === cellRows.length - 1 ? tableBotUi0 : rowDividersUi[r];
    rowSlots.push({
      slotHUi: Math.max(8 * scInit, botUi - topUi),
      srcTop: uiToSrcY(topUi),
      srcBot: uiToSrcY(botUi),
    });
  }
  const initialTotalTableHUi = rowSlots.reduce((acc, sl) => acc + sl.slotHUi, 0); T.initialTotalTableHUi = initialTotalTableHUi;
  const initialTotalTableWUi = colSlots.reduce((acc, sl) => acc + sl.slotWUi, 0); T.initialTotalTableWUi = initialTotalTableWUi;
  const initialTableLeftUi = tableLeftUi0; T.initialTableLeftUi = initialTableLeftUi;
  const initialTableTopUi = tableTopUi0; T.initialTableTopUi = initialTableTopUi;

  const anchorCenterUiX = tableLeftUi0 + initialTotalTableWUi * 0.5; T.anchorCenterUiX = anchorCenterUiX;

  const aboveTableObjs = objs.filter((x) => !x.deleted && x._base && !x._isSideDeco
    && !tableGridObjs.includes(x) && !outerDialogueObjs.includes(x) && !innerTableDecos.includes(x)
    && !(x.cell && x.cell.col != null) && !colSecs.some((s) => s.o === x)
    && (x._base.y + x._base.h) <= initialTableTopUi + 12
    && Math.min(x._base.x + x._base.w, tableLeftUi0 + initialTotalTableWUi + 20) > Math.max(x._base.x, tableLeftUi0 - 20));
  for (const ab of aboveTableObjs) ab._origGapToTable = Math.max(4, initialTableTopUi - (ab._base.y + ab._base.h));
  T.aboveTableObjs = aboveTableObjs;
  T.outerDialogueObjs = outerDialogueObjs;
  for (const ou of outerDialogueObjs) {
    ou._origEnclosesTable = (ou._base.y + ou._base.h) >= (initialTableTopUi + initialTotalTableHUi - 16);
    ou._origPadBelowTable = Math.max(6, (ou._base.y + ou._base.h) - (initialTableTopUi + initialTotalTableHUi));
  }
  for (const x of innerTableDecos) x._baseYOnOpen = x.y;
  for (const tObj of sideTapeDecos) tObj._baseYOnOpen = tObj.y;

  const pageW = (ctx && ctx.page && ctx.page.w) || (an && an.geo && an.geo.width) || 595;
  T.pageW = pageW;
  const sideMarginPt = Math.min(52, Math.max(28, Math.round(pageW * 0.085)));
  const tblBeyondMargin = initialTableLeftUi < sideMarginPt - 1 || (initialTableLeftUi + initialTotalTableWUi) > pageW - sideMarginPt + 1;
  const minPageUiX = tblBeyondMargin ? 8 : sideMarginPt; T.minPageUiX = minPageUiX;
  const maxPageUiX = tblBeyondMargin ? (pageW - 8) : (pageW - sideMarginPt); T.maxPageUiX = maxPageUiX;
  const maxAllowedTableWUi = Math.max(160, maxPageUiX - minPageUiX); T.maxAllowedTableWUi = maxAllowedTableWUi;
  const spanOf = (list, get) => ({ l: Math.min(...list.map((x) => get(x).x)), r: Math.max(...list.map((x) => get(x).x + get(x).w)) });
  let refSpan;
  if (outerDialogueObjs.length) refSpan = spanOf(outerDialogueObjs, (o) => o._base);
  else if (aboveTableObjs.length) refSpan = spanOf(aboveTableObjs, (o) => o._base);
  else if (nonTableSecs.length) refSpan = spanOf(nonTableSecs, (s) => s.o._base);
  else refSpan = { l: minPageUiX, r: maxPageUiX };
  T.expandMode = classifyTableExpandMode({ initLeft: initialTableLeftUi, initW: initialTotalTableWUi, refL: refSpan.l, refR: refSpan.r });
}
