// Universal procedural vector table engine, bilateral 1.7cm margin expansion & live cell fill
import { setupTableGrid } from './aeTableGrid.js';
import { setupTableOps } from './aeTableOps.js';
import { setupTableSnap } from './aeTableSnap.js';
import { setupTableChrome } from './aeTableChrome.js';
import { setupTableProps } from './aeTableProps.js';

export function setupAeTable(st) {
  const T = {}; // shared table state (see aeTableGrid.js, aeTableOps.js, aeTableChrome.js, aeTableProps.js)
  const {
    an, ctx, doc, stage, guides, objs, sections, allEds, nonBadgeEds,
    savedColOffsets, scaleOf, isUnit, partOf,
    place, render, wireObjEl, makeSectionEditor, cloneParas,
    commitSnap, flushTextSync, touchedTextObjs,
  } = st;
  Object.assign(T, {
    an, ctx, doc, stage, guides, objs, sections, allEds, nonBadgeEds, savedColOffsets, scaleOf, isUnit,
    partOf, place, render, wireObjEl, makeSectionEditor, cloneParas, commitSnap, flushTextSync,
    touchedTextObjs,
    getActiveEd: () => st.focusedEd || st.lastEditTarget,
    getMultiRanges: () => st.multiRanges || [],
    holdSnaps: (on) => { st.snapHold = !!on; },
    onCleanup: (fn) => { (st.cleanups ||= []).push(fn); },
  });

  const cellRows = [...doc.querySelectorAll('.te-row.te-cells')].filter((r) => r.querySelectorAll('.te-cell[data-col]').length >= 2); T.cellRows = cellRows;
  T.colOffsets = [];
  T.syncColTable = () => {};
  T.syncColUi = () => {};

  if (cellRows.length) {
    const colSecs = sections.filter((s) => s.model && s.model.cell && s.model.cell.col != null && !s.o.deleted); T.colSecs = colSecs;
    T.colCount = colSecs.length ? Math.max(...colSecs.map((s) => s.model.cell.col)) + 1 : 0;
    if (T.colCount >= 2) {
      setupTableGrid(T);
      setupTableOps(T);
      setupTableSnap(T);
      setupTableChrome(T);
      setupTableProps(T);
    }
  }
  st.colOffsets = T.colOffsets;
  st.syncColTable = T.syncColTable;
  st.syncColUi = T.syncColUi;
  st.captureTableSnap = T.captureTableSnap;
  st.restoreTableSnap = T.restoreTableSnap;
  st.hasTable = !!(cellRows.length && T.colCount >= 2);
  st.tableColCount = T.colCount || 0;
  st.tablePropsEl = T.propsEl || null;
  st.onTableFocusChange = T.syncPropsUi || null;
  st.clearTableStyle = T.clearTableStyle || null;
  st.applyHAlign = T.applyHAlign || null;
  st.applyVAlign = T.applyVAlign || null;
  st.getAlignState = T.getAlignState || null;
  st.getTableSelectedHandle = () => T.selectedHandle || null;
}