// Ribbon "Hizalama" alignment state & handlers for Düzenle (applies to table handles, selections, or all visible text/cells when nothing is selected).

export function createAlignHandlers(st) {
  const {
    R, isUnit, objs, place, sections, syncSlotBox, commitSnap, flushTextSync,
  } = st;

  const visibleNonBadgeSecs = () => sections.filter((s) => !s.badge && !s.o.deleted && !s.cellDeleted && s.ed && !s.ed.el.hidden);

  const liveNonCollapsedSec = () => {
    const sel = typeof getSelection === 'function' ? getSelection() : null;
    if (!sel || !sel.rangeCount || sel.getRangeAt(0).collapsed) return null;
    const anc = sel.getRangeAt(0).commonAncestorContainer;
    return visibleNonBadgeSecs().find((s) => s.ed.paper && s.ed.paper.contains(anc)) || null;
  };

  const getCellVAlign = (s) => (s.o.cell && s.o.cell.vAlign)
    || (s.model && s.model.cell && s.model.cell.vAlign)
    || (s.o && s.o._vAlign)
    || (s.ed && s.ed.el && s.ed.el.dataset && s.ed.el.dataset.valign)
    || null;

  const setCellVAlign = (s, va) => {
    if (s.o.cell) s.o.cell.vAlign = va;
    if (s.model && s.model.cell) s.model.cell.vAlign = va;
    if (s.o._origPart && s.o._origPart.cell) s.o._origPart.cell.vAlign = va;
    if (s.ed && s.ed.el) s.ed.el.dataset.valign = va;
  };

  const applyNonTableVAlign = (sec, va, seenObjs) => {
    const targetObj = sec.o;
    if (!targetObj || targetObj.deleted) return;
    if (!seenObjs.has(targetObj)) {
      seenObjs.add(targetObj);
      const enc = objs.filter((u) => u !== targetObj && !u.deleted && isUnit(u)
        && targetObj.x + targetObj.w * 0.5 >= u.x - 2 && targetObj.x + targetObj.w * 0.5 <= u.x + u.w + 2
        && targetObj.y >= u.y - 4 && targetObj.y + targetObj.h <= u.y + u.h + 4)
        .sort((a, b) => (a.w * a.h) - (b.w * b.h))[0];
      const bTop = enc ? enc.y + 3 : R.y;
      const bBot = enc ? enc.y + enc.h - 3 : (R.y + R.h);
      if (bBot - bTop > targetObj.h + 0.5) {
        targetObj.y = va === 'top' ? bTop : (va === 'middle' ? bTop + (bBot - bTop - targetObj.h) * 0.5 : bBot - targetObj.h);
        place(targetObj);
      }
      targetObj._vAlign = va;
    }
    sections.filter((s) => s.o === targetObj).forEach((s) => { if (s.ed && s.ed.el) s.ed.el.dataset.valign = va; });
  };

  const applyVAlignToSecs = (secs, va) => {
    const seenObjs = new Set();
    for (const s of secs) {
      if (s.o.cell || (s.model && s.model.cell)) setCellVAlign(s, va);
      else applyNonTableVAlign(s, va, seenObjs);
    }
  };

  const getAlignState = () => {
    if (st.hasTable && st.getTableSelectedHandle && st.getTableSelectedHandle() && st.getAlignState) {
      return st.getAlignState();
    }
    const mr = st.multiRanges && st.multiRanges.length ? st.multiRanges : null;
    const live = !mr ? liveNonCollapsedSec() : null;
    const targetSecs = mr
      ? mr.map((r) => visibleNonBadgeSecs().find((s) => s.ed === r.ed)).filter(Boolean)
      : (live ? [live] : visibleNonBadgeSecs());
    if (!targetSecs.length) return { hAlign: null, vAlign: null };
    const hVals = targetSecs.map((s) => {
      const a = s.ed && s.ed.getAlign ? s.ed.getAlign() : undefined;
      return a === undefined ? ((s.model && s.model.align) || 'left') : a;
    });
    const vVals = targetSecs.map(getCellVAlign);
    return {
      hAlign: hVals[0] != null && hVals.every((v) => v === hVals[0]) ? hVals[0] : null,
      vAlign: vVals[0] != null && vVals.every((v) => v === vVals[0]) ? vVals[0] : null,
    };
  };

  const onAlign = ({ hAlign, vAlign }) => {
    if (st.hasTable && st.getTableSelectedHandle && st.getTableSelectedHandle()) {
      if (hAlign && st.applyHAlign) st.applyHAlign(hAlign);
      if (vAlign && st.applyVAlign) st.applyVAlign(vAlign);
      return;
    }
    const mr = st.multiRanges && st.multiRanges.length ? st.multiRanges : null;
    const live = !mr ? liveNonCollapsedSec() : null;
    let targetSecs;
    if (mr) {
      targetSecs = mr.map((r) => visibleNonBadgeSecs().find((s) => s.ed === r.ed)).filter(Boolean);
    } else if (live) {
      targetSecs = [live];
    } else {
      targetSecs = visibleNonBadgeSecs();
    }
    if (!targetSecs.length) return;

    commitSnap();
    if (hAlign) {
      if (mr) {
        for (const r of mr) {
          if (!r.ed) continue;
          r.ed.setAlign(hAlign, { silent: true, range: r });
          const sec = visibleNonBadgeSecs().find((s) => s.ed === r.ed);
          if (sec) st.touchedTextObjs.add(sec.o);
        }
        if (st.renderMultiRanges) st.renderMultiRanges();
      } else if (live) {
        const range = live.ed.getRangeBounds();
        live.ed.setAlign(hAlign, { silent: true, range });
        st.touchedTextObjs.add(live.o);
      } else {
        for (const s of targetSecs) {
          s.ed.setAlign(hAlign, { silent: true });
          st.touchedTextObjs.add(s.o);
        }
      }
    }
    if (vAlign) applyVAlignToSecs(targetSecs, vAlign);

    if (st.hasTable && targetSecs.some((s) => s.o.cell || (s.model && s.model.cell))) {
      st.syncColTable && st.syncColTable();
      st.onTableFocusChange && st.onTableFocusChange();
    }
    syncSlotBox();
    st.drawHandles && st.drawHandles();
    if (hAlign) flushTextSync({ renderPreview: true }).then(() => commitSnap());
    else commitSnap();
  };

  return { getAlignState, onAlign };
}
