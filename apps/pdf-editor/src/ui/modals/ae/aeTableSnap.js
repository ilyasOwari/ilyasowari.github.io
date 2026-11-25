// Table snapshot capture and undo/redo restore helper for aeTable.js.
import { cloneCustom } from '../../../core/tableStyle.js';

export function setupTableSnap(T) {
  const {
    cellRows, colSecs, colSlots, reindexRowAndColMeta, rowSlots, syncCellWidths,
  } = T;
  T.captureTableSnap = () => ({
    colOffsets: T.colOffsets.slice(),
    rowMinH: T.rowMinH.slice(),
    colSlots: colSlots.map((sl) => ({ ...sl })),
    rowSlots: rowSlots.map((sl) => ({ ...sl })),
    tablePattern: T.tablePattern,
    tableColor: T.tableColor,
    tableCustom: T.tableCustom ? cloneCustom(T.tableCustom) : null,
    structureEdited: !!T.structureEdited,
    tapeTrimmed: !!T.tapeTrimmed,
    tableLeftUi: T.tableLeftUi,
    tableTotalWUi: T.tableTotalWUi,
    rowOrder: cellRows.map((r) => r._rowId),
    cellPos: colSecs.map((s) => ({ oid: s.o.id, col: s.model.cell.col, rowTargetY: s.o._rowTargetY, vAlign: (s.o.cell && s.o.cell.vAlign) || null, hasBorder: !!s.o.hasBorder })),
  });
  T.restoreTableSnap = (snap) => {
    if (!snap) return;
    if (snap.colOffsets) T.colOffsets.splice(0, T.colOffsets.length, ...snap.colOffsets);
    if (snap.rowMinH) T.rowMinH.splice(0, T.rowMinH.length, ...snap.rowMinH);
    if (snap.colSlots && snap.colSlots.length === colSlots.length) colSlots.splice(0, colSlots.length, ...snap.colSlots.map((sl) => ({ ...sl })));
    if (snap.rowSlots && snap.rowSlots.length === rowSlots.length) rowSlots.splice(0, rowSlots.length, ...snap.rowSlots.map((sl) => ({ ...sl })));
    if ('tablePattern' in snap) T.tablePattern = snap.tablePattern ?? null;
    if (snap.tableColor) T.tableColor = snap.tableColor;
    if (snap.tableCustom) T.tableCustom = cloneCustom(snap.tableCustom);
    if ('structureEdited' in snap) T.structureEdited = !!snap.structureEdited;
    if ('tapeTrimmed' in snap) T.tapeTrimmed = !!snap.tapeTrimmed;
    if (snap.tableLeftUi != null) T.tableLeftUi = snap.tableLeftUi;
    if (snap.tableTotalWUi != null) T.tableTotalWUi = snap.tableTotalWUi;
    if (snap.rowOrder && snap.rowOrder.length === cellRows.length && snap.rowOrder.every((id) => cellRows.some((r) => r._rowId === id))) {
      const byId = new Map(cellRows.map((r) => [r._rowId, r]));
      const ordered = snap.rowOrder.map((id) => byId.get(id));
      const anchor = cellRows[0]?.previousElementSibling || null;
      const parent = cellRows[0]?.parentNode;
      cellRows.splice(0, cellRows.length, ...ordered);
      if (parent) {
        let prev = anchor;
        for (const r of cellRows) {
          if (prev) prev.after(r); else parent.prepend(r);
          prev = r;
        }
      }
    }
    if (snap.cellPos) {
      const posByOid = new Map(snap.cellPos.map((p) => [p.oid, p]));
      for (const s of colSecs) {
        const p = posByOid.get(s.o.id);
        if (!p) continue;
        s.model.cell.col = p.col;
        if (s.o.cell) s.o.cell.col = p.col;
        if (s.o._origPart && s.o._origPart.cell) s.o._origPart.cell.col = p.col;
        s.ed.el.dataset.col = p.col;
        if (p.rowTargetY != null) s.o._rowTargetY = p.rowTargetY;
        const setVa = (cell) => { if (!cell) return; if (p.vAlign) cell.vAlign = p.vAlign; else delete cell.vAlign; };
        setVa(s.o.cell); setVa(s.model.cell); setVa(s.o._origPart && s.o._origPart.cell);
        if (p.vAlign) s.ed.el.dataset.valign = p.vAlign; else delete s.ed.el.dataset.valign;
        s.o.hasBorder = !!p.hasBorder;
        if (s.o._origPart && Array.isArray(s.o.keep)) s.o._origPart.keep = s.o.keep.slice();
      }
      for (const row of cellRows) {
        const cells = [...row.querySelectorAll('.te-cell[data-col]')];
        cells.sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
        for (const el of cells) row.append(el);
      }
    }
    cellRows.forEach((r, idx) => { if (T.rowMinH[idx] == null && r.style.minHeight) r.style.minHeight = ''; });
    reindexRowAndColMeta(); syncCellWidths(); T.syncColUi(); T.syncColTable();
    if (T.syncPropsUi) T.syncPropsUi();
  };
}
