// Combined "Düzenle" editor: whole-block collective text editing at the bottom
// (using all formatting & word-background tools directly under the top bar),
// plus the visual object stage above whenever the block contains real photos/images.
// Supports unified Ctrl+Z / Ctrl+Y undo & redo across both text and objects.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { SectionEditor } from './sectionEditor.js';
import { emptyBox, boxActive } from './boxControl.js';
import { boxGeom } from '../../model/textBox.js';
import { boxCss } from '../workspace/boxCss.js';
import { setupAeTable } from './ae/aeTable.js';
import { setupAePhotoGrid } from './ae/aePhotoGrid.js';
import { setupAeTextNav } from './ae/aeTextNav.js';
import { setupAeStage } from './ae/aeStage.js';
import { setupAeToolbar } from './ae/aeToolbar.js';
import { setupAeVerify } from './ae/aeVerify.js';
import { restoreSuppressedOcrText, applySectionBoxStyle } from './ae/aeOcr.js';
import { setupAreaObjects } from './areaEditorObjects.js';
import { setupAreaSync } from './areaEditorSync.js';
import { clone, cloneParas } from './areaEditorShared.js';

export function openAreaEditor({ app, ctx, fonts, man, onApply, lettering = false, point = null, box = null, colOffsets: savedColOffsets = null, cropOnOpen = false }) {
  const T = {}; // shared editor state (see areaEditorObjects.js, areaEditorSync.js)
  Object.assign(T, {
    app, ctx, syncSlotBox,
  });
  const { R, an, page } = ctx;
  Object.assign(T, { R, an, page });
  const objs = ctx.objects; T.objs = objs;
  const session = app.session; T.session = session;
  const pad = 12;
  const extra = Math.max(12, Math.min(24, R.h * 0.08));
  const textObjs = objs.filter((o) => o.type === 'text' && !o.deleted);
  const hasBottomText = textObjs.length > 0;
  const badgeOnlyText = hasBottomText && textObjs.every((o) => o.badge);
  const isPhotoGridLikely = badgeOnlyText && objs.filter((o) => !o.deleted && (o.type === 'photo' || o.type === 'img') && o.w >= 16 && o.h >= 16).length >= 2;
  const side = false; T.side = side;
  const wideW = Math.min(window.innerWidth * 0.96, 1340);
  const sideTextW = 0; T.sideTextW = sideTextW;
  const availW = isPhotoGridLikely
    ? Math.max(300, Math.min(wideW - 390, 920))
    : Math.min(window.innerWidth * 0.94 - 64, 1080);
  const availH = isPhotoGridLikely
    ? Math.max(180, Math.min(Math.floor(window.innerHeight * 0.92) - 345, 470))
    : Math.max(180, Math.min(Math.floor(window.innerHeight * 0.90) - (hasBottomText ? 340 : 210), 460));
  const k = Math.min(availW / (R.w + 2 * pad), availH / (R.h + pad + extra), 3); T.k = k;
  const O = { x: R.x - pad, y: R.y - pad };
  const X = (x) => (x - O.x) * T.k, Y = (y) => (y - O.y) * T.k;
  Object.assign(T, { X, Y });
  const dpr = window.devicePixelRatio || 1; T.dpr = dpr;
  const stage = h('div', { class: 'ae-stage', 'data-testid': 'ae-stage', tabindex: '0' }); T.stage = stage;
  Object.assign(stage.style, { width: (R.w + 2 * pad) * T.k + 'px', height: (R.h + pad + extra) * T.k + 'px' });
  const slotBoxWrap = h('div', { class: 'ae-slot-box' });
  const slot = h('div', { class: 'ae-slot' });
  Object.assign(slot.style, { left: X(R.x) + 'px', top: Y(R.y) + 'px', width: R.w * T.k + 'px', height: R.h * T.k + 'px' });
  stage.append(slotBoxWrap, slot);
  const boxCfg = Object.assign(emptyBox(), box || {}); T.boxCfg = boxCfg;
  const isUnit = (o) => o.type === 'deco' || o.type === 'bg'; T.isUnit = isUnit;

  function contentBox() {
    const act = objs.filter((o) => !o.deleted);
    if (!act.length) return R;
    const x0 = Math.min(...act.map((o) => o.x)), y0 = Math.min(...act.map((o) => o.y));
    const x1 = Math.max(...act.map((o) => o.x + o.w)), y1 = Math.max(...act.map((o) => o.y + o.h));
    return { x: x0, y: y0, w: Math.max(12, x1 - x0), h: Math.max(12, y1 - y0) };
  }
  function syncSlotBox() {
    slotBoxWrap.textContent = '';
    if (!boxActive(boxCfg)) return;
    const g = boxGeom(contentBox(), boxCfg, 10);
    slotBoxWrap.append(boxCss({ ...g, x: g.x - O.x, y: g.y - O.y }, boxCfg, T.k, 1));
  }
  function rescaleStage(wPx, hPx) {
    if (!(wPx > 0 && hPx > 0)) return;
    const newK = Math.max(0.25, Math.min(wPx / (R.w + 2 * pad), hPx / (R.h + pad + extra), 3));
    if (Math.abs(newK - T.k) < 0.015) return;
    T.k = newK;
    st.k = newK;
    Object.assign(stage.style, { width: (R.w + 2 * pad) * newK + 'px', height: (R.h + pad + extra) * newK + 'px' });
    Object.assign(slot.style, { left: X(R.x) + 'px', top: Y(R.y) + 'px', width: R.w * newK + 'px', height: R.h * newK + 'px' });
    stage.dataset.map = JSON.stringify({ x: O.x, y: O.y, k: newK });
    for (const o of objs) {
      T.place(o);
      if (!o.deleted && o.type !== 'img') T.render(o);
    }
    syncSlotBox();
    st.drawHandles();
  }
  const guides = h('div', { class: 'ae-guides' }); T.guides = guides;
  const st = {
    sel: null, mode: null, multiSel: new Set(), panMode: null,
    focusedEd: null, lastEditTarget: null, wideModal: false, insertSideMode: false,
    colOffsets: [], syncColTable: () => {}, syncColUi: () => {},
    syncLayout: () => {}, syncButtons: () => {}, drawHandles: () => {}, rescaleStage,
  }; T.st = st;

  setupAreaObjects(T);
  setupAreaSync(T);
  // ---------- create SectionEditors & lay out .te-doc ----------
  const doc = h('div', { class: 'te-doc' });
  const textArea = h('div', { class: 'te-area ae-text-area', 'data-testid': 'ae-textbox' }, doc); T.textArea = textArea;
  textArea.addEventListener('pointerdown', (e) => e.stopPropagation());
  textArea.addEventListener('dblclick', (e) => e.stopPropagation());

  function deleteSectionCell(s) {
    T.commitSnap();
    s.cellDeleted = true;
    s.ed.setParas([{ text: '', marker: false }]);
    if (!(s.model && s.model.cell)) {
      s.ed.el.hidden = true;
      if (s.rowEl) {
        const anyVis = [...s.rowEl.children].some((ch) => !ch.hidden);
        s.rowEl.hidden = !anyVis;
      }
    }
    const patches = (s.o.ocrPatchObjs && s.o.ocrPatchObjs.length) ? s.o.ocrPatchObjs : (s.o.ocrPatchObj ? [s.o.ocrPatchObj] : []);
    for (const p of patches) { p.deleted = true; T.place(p); }
    restoreSuppressedOcrText(s.o, objs, { place: T.place, render: T.render });
    T.syncTextObj(s.o, { renderPreview: true }).then(() => T.commitSnap());
  }

  const hasVisualStageInit = objs.some((o) => !o.deleted && (o.type === 'photo' || o.type === 'img')) || lettering;
  const isSpeechBubbleSec = (s) => {
    if (!s || s.badge || (s.model && (s.model.cell || s.model.sharedPanel)) || (s.o && s.o._rowCard)) return false;
    const c = s.model && s.model.container;
    if (!c) return false;
    const ownBubbleGfx = !!(s.o && s.o.keep && s.o.keep.length > 0);
    const compactBubble = (c.y1 - c.y0) <= 150 && ((s.model.paras && s.model.paras.length) || 0) <= 2;
    return hasVisualStageInit && (ownBubbleGfx || compactBubble);
  };

  function makeSectionEditor(s) {
    const ed = new SectionEditor(s.model, {
      badge: s.badge,
      noLiveBreaks: isSpeechBubbleSec(s),
      onFocus: (e) => {
        st.focusedEd = e;
        if (!e.badge) st.lastEditTarget = e;
        objs.forEach((x) => x.el.classList.toggle('editing', x === s.o));
        if (st.onTableFocusChange) st.onTableFocusChange();
      },
      onChange: (e, reason) => {
        st.focusedEd = e; if (!e.badge) st.lastEditTarget = e;
        T.touchedTextObjs.add(s.o);
        if (reason === 'style' || reason === 'para') T.commitSnap();
        else if (reason !== 'style-batch') T.scheduleTypeSnap();
        const showStage = !!(st.shouldShowStage && st.shouldShowStage());
        clearTimeout(T.syncTimer);
        T.syncTimer = setTimeout(() => T.flushTextSync({ renderPreview: showStage }), 180);
      },
    });
    if (!s.badge) {
      const delBtn = h('button', {
        class: 'te-cell-del', 'data-testid': 'te-cell-del', type: 'button', title: t('del'),
        onpointerdown: (ev) => ev.preventDefault(),
        onclick: (ev) => { ev.stopPropagation(); deleteSectionCell(s); },
      }, '×');
      ed.el.prepend(delBtn);
    }
    return ed;
  }

  for (const s of T.sections) {
    s.ed = makeSectionEditor(s);
    s.lastSyncedParas = cloneParas(s.model.paras);
  }
  const singleLineNonBadge = (s) => !s.badge && s.model.lines.length <= 1 && s.model.paras.length <= 1;
  const rowSpan = (s) => {
    const ls = (s.model && s.model.lines) || [];
    if (!ls.length) return { top: s.y, bot: s.y + 12, left: s.x, right: s.x + 20 };
    return {
      top: Math.min(...ls.map((l) => (l.b ? l.b.y0 : s.y))),
      bot: Math.max(...ls.map((l) => (l.b ? l.b.y1 : s.y + (l.size || 10)))),
      left: Math.min(...ls.map((l) => l.left ?? s.x)),
      right: Math.max(...ls.map((l) => l.right ?? s.x + 20)),
    };
  };
  const sideBySideRow = (a, b) => {
    if (!a || !b || a.badge || b.badge) return false;
    const ra = rowSpan(a), rb = rowSpan(b);
    if (rb.left <= ra.right + 8 && ra.left <= rb.right + 8) return false;
    const cy = (rb.top + rb.bot) / 2;
    return cy >= ra.top - 6 && cy <= ra.bot + 6;
  };
  st.wideModal = false;
  for (let i = 0; i < T.sections.length; i++) {
    const s = T.sections[i];
    if (s.badge && T.sections[i + 1] && !T.sections[i + 1].badge && Math.abs(T.sections[i + 1].y - s.y) < 14) {
      const row = h('div', { class: 'te-row' }, T.sections[i].ed.el, T.sections[i + 1].ed.el);
      T.sections[i].rowEl = row; T.sections[i + 1].rowEl = row;
      doc.append(row);
      i++;
    } else if (s.badge && T.sections[i + 1] && T.sections[i + 1].badge && Math.abs(T.sections[i + 1].y - s.y) < 14) {
      const row = h('div', { class: 'te-row te-row-badges' });
      let j = i;
      while (j < T.sections.length && T.sections[j].badge && Math.abs(T.sections[j].y - s.y) < 14) {
        if (T.sections[j + 1] && !T.sections[j + 1].badge && Math.abs(T.sections[j + 1].y - T.sections[j].y) < 14) break;
        row.append(T.sections[j].ed.el);
        T.sections[j].rowEl = row;
        j++;
      }
      doc.append(row); i = j - 1;
    } else if (!s.badge && ((s.model && s.model.cell) || sideBySideRow(s, T.sections[i + 1]) || (singleLineNonBadge(s) && T.sections[i + 1] && singleLineNonBadge(T.sections[i + 1]) && Math.abs(T.sections[i + 1].y - s.y) < 8))) {
      const row = h('div', { class: 'te-row te-cells', 'data-testid': 'te-cells' });
      const isCell = !!(s.model && s.model.cell);
      let j = i;
      let rowCols = 0, rowMinW = 0;
      while (j < T.sections.length && !T.sections[j].badge) {
        if (j > i) {
          if (isCell) {
            const sc = s.model && s.model.cell, jc = T.sections[j].model && T.sections[j].model.cell;
            if (!jc) break;
            const rA = sc.gridRow ?? sc.row, rB = jc.gridRow ?? jc.row;
            if (rA != null && rB != null) { if (rA !== rB) break; }
            else if (Math.abs(T.sections[j].y - s.y) >= 10) break;
          } else if (!sideBySideRow(s, T.sections[j]) && !(singleLineNonBadge(T.sections[j]) && Math.abs(T.sections[j].y - s.y) < 8)) {
            break;
          }
        }
        T.sections[j].ed.el.classList.add('te-cell');
        const sm = T.sections[j].model;
        const colW = sm && sm.cell && sm.cell.colW ? Math.max(28, Math.round(sm.cell.colW)) : 0;
        T.sections[j].ed.el.style.flex = colW ? `${colW} 1 0` : '1 1 0';
        if (colW && sm && sm.text) {
          const maxWord = Math.max(0, ...sm.text.split(/\s+/).map((w) => w.length));
          const minCellPx = Math.min(130, Math.max(46, Math.ceil(maxWord * 7.5 + 32)));
          T.sections[j].ed.el.style.minWidth = `${minCellPx}px`;
          rowMinW += minCellPx;
        }
        if (T.sections[j].model && T.sections[j].model.cell) T.sections[j].ed.el.dataset.col = T.sections[j].model.cell.col;
        T.sections[j].rowEl = row;
        row.append(T.sections[j].ed.el);
        rowCols++;
        j++;
      }
      if (rowCols >= 3 || rowMinW > 720) st.wideModal = true;
      doc.append(row); i = j - 1;
    } else {
      const row = h('div', { class: 'te-row' + (s.badge ? ' te-row-badge' : '') }, s.ed.el);
      s.rowEl = row;
      doc.append(row);
    }
  }
  for (const s of T.sections) applySectionBoxStyle(s, an, T.scaleOf);

  const allEds = T.sections.map((s) => s.ed);
  const nonBadgeEds = allEds.filter((e) => !e.badge);

  Object.assign(st, {
    app, ctx, page: T.page, fonts, man, onApply, lettering, boxCfg, savedColOffsets,
    an, objs, sections: T.sections, allEds, nonBadgeEds, doc, textArea, stage, slot, guides,
    R, O, pad, extra, k: T.k, X, Y, badgeOnlyText, side, sideTextW, ready: T.ready, rescaleStage,
    isUnit, cropable: T.cropable, partOf: T.partOf, scaleOf: T.scaleOf, place: T.place, render: T.render, wireObjEl: T.wireObjEl, makeSectionEditor,
    cloneParas, deleteSectionCell, commitSnap: T.commitSnap, undo: T.undo, redo: T.redo, syncTextObj: T.syncTextObj, flushTextSync: T.flushTextSync, isDirty: T.isDirty,
    touchedTextObjs: T.touchedTextObjs, pageLimitRight: T.pageLimitRight, pageLimitLeft: T.pageLimitLeft, syncSlotBox, scheduleTypeSnap: T.scheduleTypeSnap,
    clearTimers: () => { clearTimeout(T.typeTimer); clearTimeout(T.syncTimer); },
  });
  setupAeTable(st);
  setupAePhotoGrid(st);
  setupAeTextNav(st);
  setupAeStage(st);
  setupAeToolbar(st);
  setupAeVerify(st);
  // (text verification - layers 3 and 4 - lives in ae/aeVerify.js)
  // Focus initial editor (all sections stay open and visible together!)
  // plain text (no table): shown about 4 pt bigger and centred. Display only:
  // the wrap wall scales with the font, so the PDF's line breaks are kept.
  // Display-only zoom & centering in Düzenle:
  // - Plain text (no table): ~4pt larger + centered as one shared-width column (so short & long rows share the same left edge!).
  // - Non-plain / table modals: ~3pt larger (via CSS .modal.ae .te-paper) and non-cell texts centered as one shared-width column.
  function zoomPlainText() {
    const hasCells = !!doc.querySelector('.te-cell');
    const plainSecs = T.sections.filter((s) => !s.badge && !(s.model && s.model.cell) && s.ed && !s.ed.noLiveBreaks && s.ed.paper && s.ed.paper.isConnected && s.ed.wallPx);
    if (!plainSecs.length) return;
    if (!hasCells) doc.classList.add('te-doc-plain');
    const ptBoost = hasCells ? 0 : 1.5; // .modal.ae .te-paper is already +3pt (17.5px); plain text gets ~+4pt total
    let maxW = 0;
    for (const s of plainSecs) {
      const ed = s.ed;
      const cs = getComputedStyle(ed.paper);
      const fs = parseFloat(cs.fontSize) || 17.5;
      const avail = ed.paper.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - 8;
      const w0 = ed.wallPx();
      ed._centerBlock = true;
      if (ptBoost > 0 && w0 > 0 && avail > 0) {
        const bs = Math.max(4, ed.baseSize || 11);
        const zoom = Math.min((bs + ptBoost) / bs, avail / w0);
        if (zoom > 1.03) { ed.paper.style.fontSize = (fs * zoom).toFixed(2) + 'px'; ed.fitToLines(); }
      }
      const wNow = ed.wallPx();
      if (wNow > maxW) maxW = wNow;
    }
    for (const s of plainSecs) {
      s.ed._sharedBlockW = maxW;
      s.ed.applyWall();
    }
  }
  requestAnimationFrame(() => {
    allEds.forEach((ed) => ed.fitToLines && ed.fitToLines());
    zoomPlainText();
    allEds.forEach((ed) => ed.placeMarks());
    if (T.sections.length) {
      let target = null;
      if (point) {
        let best = Infinity;
        for (const s of T.sections) {
          if (s.badge) continue;
          const b = s.o._base;
          const sc0 = b.w / b.dw;
          const x0 = b.x + (s.model.area.left - b.src.x) * sc0, x1 = b.x + (s.model.area.right - b.src.x) * sc0;
          const y0 = b.y + (s.model.area.top - b.src.y) * sc0, y1 = b.y + (s.model.area.bottom - b.src.y) * sc0;
          const d = Math.hypot(Math.max(x0 - point.x, 0, point.x - x1), Math.max(y0 - point.y, 0, point.y - y1));
          if (d < best) { best = d; target = s; }
        }
      }
      if (!target) {
        const mainSecs = T.sections.filter((s) => !s.badge).sort((a, b) => b.model.text.length - a.model.text.length);
        target = mainSecs[0] || T.sections[0];
      }
      if (target && target.ed) { st.focusedEd = target.ed; if (!target.ed.badge) st.lastEditTarget = target.ed; target.ed.focusEnd(); if (st.onTableFocusChange) st.onTableFocusChange(); }
    } else {
      stage.focus();
      if (cropOnOpen && objs[0] && objs[0].type === 'img' && objs[0].img?.dataUrl) {
        const o0 = objs[0];
        const im = new Image();
        im.onload = () => { st.applyCoverImageToObj(o0, o0.img.dataUrl, im); st.select(o0); st.mode = 'crop'; st.drawHandles(); st.syncButtons(); };
        im.src = o0.img.dataUrl;
      }
    }
  });
  return { modal: st.m, ready: T.ready, objects: objs, get k() { return T.k; }, O, verify: st.verify };
}
