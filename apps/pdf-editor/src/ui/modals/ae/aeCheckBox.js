// Ribbon "İşaret kutusu" controller: add/change square, rectangle, or circle checkboxes before/after rows with smart cleanup.
import { checkBoxGeom, cbSig } from '../../../engines/text/checkBoxOps.js';

export function createCheckBoxHandlers(st) {
  const {
    R, objs, page, place, scaleOf, sections, syncSlotBox, commitSnap, flushTextSync, pageLimitRight,
  } = st;

  const visibleNonBadgeSecs = () => sections.filter((s) => !s.badge && !s.o.deleted && !s.cellDeleted && s.ed && !s.ed.el.hidden);

  const liveNonCollapsedSec = () => {
    const sel = typeof getSelection === 'function' ? getSelection() : null;
    if (!sel || !sel.rangeCount || sel.getRangeAt(0).collapsed) return null;
    const anc = sel.getRangeAt(0).commonAncestorContainer;
    return visibleNonBadgeSecs().find((s) => s.ed.paper && s.ed.paper.contains(anc)) || null;
  };

  const targetSecs = () => {
    const mr = st.multiRanges && st.multiRanges.length ? st.multiRanges : null;
    if (mr) {
      return mr.map((r) => ({ sec: visibleNonBadgeSecs().find((s) => s.ed === r.ed), range: r })).filter((x) => x.sec);
    }
    const live = liveNonCollapsedSec();
    if (live) return [{ sec: live, range: live.ed.getRangeBounds() }];
    return visibleNonBadgeSecs().map((sec) => ({ sec, range: null }));
  };

  const sideBoxesForSecs = (secs) => {
    const out = new Set();
    for (const s of secs) {
      if (s.o && s.o._rowCard) {
        const row = s.o._rowCard.rows.find((r) => r.text === s.o);
        if (row) for (const b of row.boxes) out.add(b);
      } else if (s.o) {
        for (const u of objs) {
          if (u.type === 'deco' && u.rowRole === 'sideBox' && Math.min(u.y + u.h, s.o.y + s.o.h + 6) > Math.max(u.y, s.o.y - 6)) {
            out.add(u);
          }
        }
      }
    }
    return [...out];
  };

  const findEnclosingPanel = (tList) => {
    const rc = tList.map(({ sec }) => sec.o._rowCard && sec.o._rowCard.panel).find((p) => p && !p.deleted);
    if (rc) return rc;
    const tObjs = tList.map(({ sec }) => sec.o).filter((o) => o && !o.deleted);
    if (!tObjs.length) return null;
    const bs = tObjs.map((o) => o._base || o);
    const minX = Math.min(...bs.map((b) => b.x)), maxX = Math.max(...bs.map((b) => b.x + b.w));
    const minY = Math.min(...bs.map((b) => b.y)), maxY = Math.max(...bs.map((b) => b.y + b.h));
    const cands = objs.filter((u) => !u.deleted && (u.type === 'bg' || (u.type === 'deco' && !u.rowRole && u.w > 100 && u.h > 24))
      && u.x <= minX + 4 && u.x + u.w >= maxX - 4 && u.y <= minY + 6 && u.y + u.h >= maxY - 6)
      .sort((a, b) => (a.w * a.h) - (b.w * b.h));
    return cands[0] || null;
  };
  const getCheckBoxState = () => {
    const targets = targetSecs();
    if (!targets.length) return { pos: 'none', shape: 'square', bc: '#334155' };
    const vals = targets.map(({ sec }) => (sec.ed.getCheckBox ? sec.ed.getCheckBox() : undefined));
    const first = vals[0];
    if (first && typeof first === 'object' && vals.every((v) => v && typeof v === 'object' && cbSig(v) === cbSig(first))) {
      return { pos: first.pos, shape: first.shape || 'square', bc: first.bc || '#334155' };
    }
    if (vals.some((v) => v !== undefined)) {
      const any = vals.find((v) => v && typeof v === 'object');
      return { pos: null, shape: (any && any.shape) || 'square', bc: (any && any.bc) || '#334155' };
    }
    const orig = sideBoxesForSecs(targets.map((x) => x.sec)).filter((b) => !b.deleted);
    if (orig.length) {
      const edges = new Set(orig.map((b) => b.sideEdge).filter(Boolean));
      const pos = edges.size === 1 ? [...edges][0] : null;
      const avgRatio = orig.reduce((s, b) => s + b.w / Math.max(1, b.h), 0) / orig.length;
      return { pos, shape: avgRatio >= 1.35 ? 'rect' : 'square', bc: '#334155', fromOrig: true };
    }
    return { pos: 'none', shape: 'square', bc: '#334155' };
  };

  const onCheckBox = ({ pos, shape = 'square', bc = '#334155', clearOther = true }) => {
    const targets = targetSecs();
    if (!targets.length) return;
    commitSnap();
    const origBoxes = sideBoxesForSecs(targets.map((x) => x.sec));
    if (pos === 'none') {
      for (const { sec, range } of targets) {
        if (sec.ed.setCheckBox) sec.ed.setCheckBox(null, { silent: true, range });
        st.touchedTextObjs.add(sec.o);
      }
      for (const b of origBoxes) {
        if (!b.deleted) { b.deleted = true; place(b); }
      }
    } else {
      for (const b of origBoxes) {
        if (!b.deleted && (b.sideEdge === pos || clearOther)) {
          b.deleted = true;
          place(b);
        }
      }
      const rightOrig = origBoxes.filter((b) => b.sideEdge === 'right');
      const useSharedRight = pos === 'right' && (targets.length >= 2 || rightOrig.length > 0);
      let sharedUiX = null;
      if (useSharedRight) {
        const refSec = targets[0].sec;
        const avgFs = targets.reduce((s, { sec }) => s + (sec.ed.baseSize || 11), 0) / targets.length;
        const scRef = scaleOf(refSec.o);
        const boxWUi = checkBoxGeom({ pos, shape }, avgFs).w * scRef;
        const panel = findEnclosingPanel(targets);
        if (rightOrig.length) {
          sharedUiX = Math.min(...rightOrig.map((b) => (b._base ? b._base.x : b.x)));
          if (panel) sharedUiX = Math.min(sharedUiX, panel.x + panel.w - boxWUi - 5);
        } else {
          const maxTextRightUi = Math.max(...targets.map(({ sec }) => {
            const ob = sec.o._base || sec.o;
            const scS = scaleOf(sec.o);
            const textW = (sec.o._origPart && sec.o._origPart.src ? sec.o._origPart.src.w : (ob.src ? ob.src.w : ob.dw)) * scS;
            return ob.x + textW;
          }));
          const gapUi = 6 * scRef;
          if (panel) {
            const insidePanelX = panel.x + panel.w - boxWUi - 8;
            sharedUiX = maxTextRightUi + 4 <= insidePanelX ? insidePanelX : (maxTextRightUi + gapUi);
          } else {
            sharedUiX = maxTextRightUi + gapUi;
            const limR = Math.min(pageLimitRight(refSec.o), ((page && page.w) || (st.ctx && st.ctx.page && st.ctx.page.w) || R.x + R.w) - 24) - boxWUi;
            sharedUiX = Math.min(sharedUiX, Math.max(maxTextRightUi + 3, limR));
          }
        }
      }
      for (const { sec, range } of targets) {
        const scO = scaleOf(sec.o);
        const ob = sec.o._base || sec.o;
        const cb = { pos, shape, bc, fc: '#ffffff', bw: 1.1 };
        if (useSharedRight && sharedUiX != null) {
          cb.alignX = ob.src.x + (sharedUiX - ob.x) / scO;
        }
        if (sec.ed.setCheckBox) sec.ed.setCheckBox(cb, { silent: true, range });
        st.touchedTextObjs.add(sec.o);
      }
    }
    if (st.renderMultiRanges) st.renderMultiRanges();
    Promise.resolve(flushTextSync()).then(() => syncSlotBox());
  };

  const onCleanCheckBox = (side) => {
    const targets = targetSecs();
    if (!targets.length) return;
    commitSnap();
    const edge = side === 'before' ? 'left' : 'right';
    let anyChanged = false;
    for (const { sec, range } of targets) {
      const clearedCb = sec.ed.clearCheckBoxOnEdge ? sec.ed.clearCheckBoxOnEdge(edge, { silent: true, range }) : false;
      if (clearedCb | (sec.ed.cleanParaEdges && sec.ed.cleanParaEdges(edge, { silent: true, range }))) {
        st.touchedTextObjs.add(sec.o);
        anyChanged = true;
      }
    }
    const origBoxes = sideBoxesForSecs(targets.map((x) => x.sec));
    for (const b of origBoxes) {
      if (!b.deleted && b.sideEdge === edge) {
        b.deleted = true;
        place(b);
        anyChanged = true;
      }
    }
    if (!anyChanged) return;
    if (st.renderMultiRanges) st.renderMultiRanges();
    Promise.resolve(flushTextSync()).then(() => syncSlotBox());
  };

  const onSmartOrderCheckBox = (kind) => {
    const targets = targetSecs();
    if (!targets.length) return;
    commitSnap();
    let idx = 0;
    let anyChanged = false;
    for (const { sec, range } of targets) {
      if (sec.ed && sec.ed.smartOrderParas) {
        const res = sec.ed.smartOrderParas(kind, idx, { silent: true, range, sep: '.' });
        idx = res.nextIdx;
        if (res.changed) {
          st.touchedTextObjs.add(sec.o);
          anyChanged = true;
        }
      }
    }
    if (!anyChanged) return;
    if (st.renderMultiRanges) st.renderMultiRanges();
    Promise.resolve(flushTextSync()).then(() => syncSlotBox());
  };

  return { getCheckBoxState, onCheckBox, onCleanCheckBox, onSmartOrderCheckBox };
}
