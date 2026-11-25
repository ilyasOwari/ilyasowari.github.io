// Ctrl+Click / Ctrl+Drag multi-cell selection & Arrow-key navigation between cells and rows
import { h } from '../../common/dom.js';

export function setupAeTextNav(st) {
  const {
    doc, textArea, objs, sections, allEds, nonBadgeEds,
    commitSnap, syncTextObj, deleteSectionCell,
  } = st;

  const multiLayer = h('div', { class: 'te-multi-layer', 'data-testid': 'te-multi-layer' });
  textArea.append(multiLayer);
  st.multiRanges = [];

  const renderMultiRanges = () => {
    multiLayer.textContent = '';
    for (const el of doc.querySelectorAll('.te-cell.te-cell-multi')) el.classList.remove('te-cell-multi');
    if (!st.multiRanges.length) return;
    const ar = textArea.getBoundingClientRect();
    const sTop = textArea.scrollTop, sLeft = textArea.scrollLeft;
    for (const r of st.multiRanges) {
      if (r.cellRect) {
        const cellEl = r.ed.el?.closest?.('.te-cell') || r.ed.paper?.closest?.('.te-cell');
        if (cellEl) cellEl.classList.add('te-cell-multi');
        continue;
      }
      for (const rc of r.ed.clientRectsFor(r)) {
        multiLayer.append(h('div', {
          class: 'te-multi-rect',
          style: { left: (rc.left - ar.left + sLeft) + 'px', top: (rc.top - ar.top + sTop) + 'px', width: rc.width + 'px', height: rc.height + 'px' },
        }));
      }
    }
  };
  const visibleEdsInOrder = () => {
    const out = [];
    for (const row of [...doc.children]) {
      if (row.hidden) continue;
      for (const ed of allEds) {
        if (row.contains(ed.paper) && !ed.el.hidden) out.push(ed);
      }
    }
    return out;
  };
  const edNearClient = (cx, cy) => {
    const el = document.elementFromPoint(cx, cy);
    const direct = el && (allEds.find((ed) => ed.paper.contains(el)) || (() => {
      const cell = el.closest?.('.te-cell[data-col]');
      return cell ? allEds.find((ed) => !ed.el.hidden && (ed.paper.closest('.te-cell[data-col]') === cell || cell.contains(ed.paper))) : null;
    })());
    if (direct) return direct;
    let best = null, bd = Infinity;
    for (const ed of visibleEdsInOrder()) {
      const r = ed.paper.getBoundingClientRect();
      const dx = cx < r.left ? r.left - cx : (cx > r.right ? cx - r.right : 0);
      const dy = cy < r.top ? r.top - cy : (cy > r.bottom ? cy - r.bottom : 0);
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = ed; }
    }
    return best;
  };
  const tableRows = (edByCell) => [...doc.querySelectorAll('.te-row.te-cells')]
    .filter((r) => !r.hidden && [...r.querySelectorAll('.te-cell[data-col]')].filter((c) => !c.hidden && (!edByCell || edByCell.has(c))).length >= 2);
  const tableCellPos = (ed, eds) => {
    const cell = ed?.paper?.closest?.('.te-cell[data-col]');
    if (!cell || cell.hidden) return null;
    const rowEl = cell.closest('.te-row.te-cells');
    if (!rowEl || rowEl.hidden) return null;
    const edByCell = new Map();
    for (const e of eds) {
      const c = e?.paper?.closest?.('.te-cell[data-col]');
      if (c && !c.hidden) edByCell.set(c, e);
    }
    const rows = tableRows(edByCell);
    const ri = rows.indexOf(rowEl);
    if (ri < 0) return null;
    const cells = [...rowEl.querySelectorAll('.te-cell[data-col]')].filter((c) => !c.hidden && edByCell.has(c));
    const ci = cells.indexOf(cell);
    return ci >= 0 ? { rows, ri, ci, edByCell } : null;
  };
  const buildSpanRanges = (edA, ptA, edB, ptB, forceCellRect = false) => {
    const eds = visibleEdsInOrder();
    const posA = tableCellPos(edA, eds), posB = tableCellPos(edB, eds);
    if (posA && posB && (edA !== edB || forceCellRect)) {
      const r0 = Math.min(posA.ri, posB.ri), r1 = Math.max(posA.ri, posB.ri);
      const c0 = Math.min(posA.ci, posB.ci), c1 = Math.max(posA.ci, posB.ci);
      const out = [];
      for (let ri = r0; ri <= r1; ri++) {
        const cells = [...posA.rows[ri].querySelectorAll('.te-cell[data-col]')].filter((c) => !c.hidden && posA.edByCell.has(c));
        for (let ci = c0; ci <= c1 && ci < cells.length; ci++) {
          const ed = posA.edByCell.get(cells[ci]);
          if (ed) out.push({ ed, ...ed.wholeRange(), cellRect: true });
        }
      }
      return out;
    }
    const iA = eds.indexOf(edA), iB = eds.indexOf(edB);
    if (iA < 0 || iB < 0) return [];
    const forward = iA < iB || (iA === iB && (ptA.pi < ptB.pi || (ptA.pi === ptB.pi && ptA.off <= ptB.off)));
    const sEd = forward ? edA : edB, sPt = forward ? ptA : ptB;
    const eEd = forward ? edB : edA, ePt = forward ? ptB : ptA;
    const si = Math.min(iA, iB), ei = Math.max(iA, iB);
    const out = [];
    for (let idx = si; idx <= ei; idx++) {
      const ed = eds[idx];
      const paras = [...ed.paper.children];
      const i0 = idx === si ? sPt.pi : 0;
      const i1 = idx === ei ? ePt.pi : paras.length - 1;
      const s0 = idx === si ? sPt.off : 0;
      const e1 = idx === ei ? ePt.off : (paras[i1] ? paras[i1].textContent.length : 0);
      out.push({ ed, i0, s0, i1, e1 });
    }
    return out;
  };

  textArea.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || textArea.classList.contains('te-spacing-mode')) return;
    if (e.target.closest('.te-handle, .te-col-plus, .te-row-plus')) return;
    if (!(e.ctrlKey || e.metaKey)) {
      if (st.multiRanges.length) { st.multiRanges = []; renderMultiRanges(); st.onTableFocusChange?.(); }
      const edA = edNearClient(e.clientX, e.clientY);
      if (!edA) return;
      const ptA = edA.pointFromClient(e.clientX, e.clientY);
      let crossMode = false;
      const onMoveCross = (ev) => {
        const edB = edNearClient(ev.clientX, ev.clientY);
        if (!edB) return;
        if (!crossMode && edB !== edA) crossMode = true;
        if (!crossMode) return;
        getSelection()?.removeAllRanges();
        const ptB = edB.pointFromClient(ev.clientX, ev.clientY);
        st.multiRanges = buildSpanRanges(edA, ptA, edB, ptB, true);
        renderMultiRanges();
        st.onTableFocusChange?.();
      };
      const onUpCross = () => {
        window.removeEventListener('pointermove', onMoveCross, true);
        window.removeEventListener('pointerup', onUpCross, true);
        if (crossMode) {
          st.onTableFocusChange?.();
          document.dispatchEvent(new Event('selectionchange'));
        }
      };
      window.addEventListener('pointermove', onMoveCross, true);
      window.addEventListener('pointerup', onUpCross, true);
      return;
    }
    e.preventDefault();
    const edA = edNearClient(e.clientX, e.clientY);
    if (!edA) return;
    if (!st.multiRanges.length) {
      const s = getSelection();
      const curEd = s && s.rangeCount ? allEds.find((x) => x.paper.contains(s.anchorNode)) : null;
      if (curEd) {
        const b = curEd.getRangeBounds();
        if (b && !b.collapsed) st.multiRanges.push({ ed: curEd, i0: b.i0, s0: b.s0, i1: b.i1, e1: b.e1 });
      }
      s && s.removeAllRanges();
    }
    const ptA = edA.pointFromClient(e.clientX, e.clientY);
    const base = st.multiRanges.slice();
    const x0 = e.clientX, y0 = e.clientY;
    let dragged = false;
    const onMove = (ev) => {
      if (!dragged && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) dragged = true;
      if (!dragged) return;
      const edB = edNearClient(ev.clientX, ev.clientY);
      if (!edB) return;
      const ptB = edB.pointFromClient(ev.clientX, ev.clientY);
      st.multiRanges = base.concat(buildSpanRanges(edA, ptA, edB, ptB));
      renderMultiRanges();
      st.onTableFocusChange?.();
    };
    const onUp = () => {
      if (!dragged) {
        const wr = edA.wordRangeAt(ptA.pi, ptA.off);
        if (wr) { st.multiRanges = base.concat([{ ed: edA, ...wr }]); renderMultiRanges(); }
      }
      st.onTableFocusChange?.();
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  }, true);

  textArea.addEventListener('keydown', (e) => {
    if (e.altKey || e.shiftKey) return;
    const isCtrl = e.ctrlKey || e.metaKey;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const ed = allEds.find((x) => x.paper.contains(e.target) || x.paper === document.activeElement);
    if (!ed) return;
    const info = ed.caretEdge();
    if (!info || (!isCtrl && !info.collapsed)) return;
    const eds = visibleEdsInOrder();
    const idx = eds.indexOf(ed);
    if (idx < 0) return;
    const rowEl = ed.el.closest('.te-row');
    if (e.key === 'ArrowRight' && (isCtrl || info.atEnd)) {
      const next = eds[idx + 1];
      if (next) { e.preventDefault(); e.stopPropagation(); next.focusAt(false); }
      return;
    }
    if (e.key === 'ArrowLeft' && (isCtrl || info.atStart)) {
      const prev = eds[idx - 1];
      if (prev) { e.preventDefault(); e.stopPropagation(); prev.focusAt(!isCtrl); }
      return;
    }
    if ((e.key === 'ArrowDown' && (isCtrl || info.onLastLine)) || (e.key === 'ArrowUp' && (isCtrl || info.onFirstLine))) {
      const rows = [...doc.children].filter((r) => !r.hidden && eds.some((x) => r.contains(x.paper)));
      const ri = rows.indexOf(rowEl);
      const targetRow = rows[ri + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!targetRow) return;
      const rowEds = eds.filter((x) => targetRow.contains(x.paper));
      if (!rowEds.length) return;
      let best = rowEds[0], bd = Infinity;
      for (const cand of rowEds) {
        const cr = cand.paper.getBoundingClientRect();
        const dx = info.caretX < cr.left ? cr.left - info.caretX : (info.caretX > cr.right ? info.caretX - cr.right : 0);
        if (dx < bd) { bd = dx; best = cand; }
      }
      e.preventDefault();
      e.stopPropagation();
      best.focusAt(!isCtrl && e.key === 'ArrowUp', info.caretX, true);
    }
  }, true);

  const hasAnyPhotos = objs.some((o) => !o.deleted && (o.type === 'photo' || o.type === 'img'));
  const isCleanList = sections.length >= 2 && nonBadgeEds.length === sections.length
    && !hasAnyPhotos
    && !doc.querySelector('.te-cells, .te-row-badges')
    && !sections.some((s) => (s.model && (s.model.cell || s.model.cellRight)) || s.ed.paper.classList.contains('te-light-ink'));
  if (isCleanList) {
    textArea.classList.add('te-clean-list');
    let startRow = null, multiDrag = false;
    const clearHits = () => doc.querySelectorAll('.te-row .te-para.te-sp-hit').forEach((p) => p.classList.remove('te-sp-hit'));
    textArea.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || textArea.classList.contains('te-spacing-mode')) return;
      clearHits();
      startRow = e.target.closest('.te-row');
      multiDrag = false;
      if (!startRow) return;
      const rows = [...doc.children].filter((r) => !r.hidden);
      const i0 = rows.indexOf(startRow);
      const onMove = (ev) => {
        const curRow = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.te-row');
        if (!curRow || curRow === startRow && !multiDrag) return;
        multiDrag = true;
        getSelection()?.removeAllRanges();
        const i1 = rows.indexOf(curRow);
        if (i0 < 0 || i1 < 0) return;
        const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
        clearHits();
        for (let kk = lo; kk <= hi; kk++) rows[kk].querySelectorAll('.te-para').forEach((p) => p.classList.add('te-sp-hit'));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
    });
    const onSpKey = (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const hits = [...doc.querySelectorAll('.te-para.te-sp-hit')];
      if (!hits.length || textArea.classList.contains('te-spacing-mode')) return;
      e.preventDefault();
      e.stopPropagation();
      const hitSecs = sections.filter((s) => hits.some((p) => s.ed.paper.contains(p)));
      clearHits();
      hitSecs.forEach((s, idx) => {
        if (idx === hitSecs.length - 1 && hitSecs.length === sections.length) {
          s.ed.setParas([{ text: '', marker: false }]);
          syncTextObj(s.o, { renderPreview: true }).then(() => { commitSnap(); s.ed.focusEnd(); });
        } else {
          deleteSectionCell(s);
        }
      });
    };
    document.addEventListener('keydown', onSpKey, true);
    (st.cleanups ||= []).push(() => document.removeEventListener('keydown', onSpKey, true));
  }

  st.renderMultiRanges = renderMultiRanges;
  st.visibleEdsInOrder = visibleEdsInOrder;
  st.textTarget = () => (st.focusedEd && !st.focusedEd.badge ? st.focusedEd : (st.lastEditTarget || nonBadgeEds[0] || allEds[0]));
}
