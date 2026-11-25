// Left "Özellikler" panel in the Düzenle modal (table mode only): table style (pattern + color) & shared alignment targets.
// Part of aeTable.js: runs inside setupAeTable(); `T` is the shared table state built there.
import { h } from '../../common/dom.js';
import { t } from '../../../i18n/i18n.js';
import { TABLE_COLOR_ORDER, cellFill, paletteFor, rgbToHex, hexToRgb } from '../../../core/tableStyle.js';

const COLOR_LABEL_KEYS = {
  orijinal: 'tblColorOriginal',
  renksiz: 'tblColorNone',
  mavi: 'tblColorBlue',
  yesil: 'tblColorGreen',
  kirmizi: 'tblColorRed',
  mor: 'tblColorPurple',
  sari: 'tblColorYellow',
  tirtikli: 'tblColorScallop',
  ozel: 'tblColorCustom',
};

export function setupTableProps(T) {
  const { cellRows, colSecs, commitSnap, flushTextSync, origPalette, render, touchedTextObjs } = T;

  for (const s of colSecs) {
    const va = (s.o.cell && s.o.cell.vAlign) || (s.model && s.model.cell && s.model.cell.vAlign) || null;
    if (va && s.ed && s.ed.el) s.ed.el.dataset.valign = va;
  }

  const getTargetSecs = () => {
    const cur = T.selectedHandle;
    if (cur && cur.kind === 'col') {
      return colSecs.filter((s) => !s.o.deleted && !s.cellDeleted && s.model?.cell?.col === cur.index);
    }
    if (cur && cur.kind === 'row') {
      const row = cellRows[cur.index];
      return row ? colSecs.filter((s) => !s.o.deleted && !s.cellDeleted && s.rowEl === row) : [];
    }
    const mrs = T.getMultiRanges ? T.getMultiRanges() : [];
    if (mrs && mrs.length) {
      const edSet = new Set(mrs.map((r) => r.ed));
      const multiSecs = colSecs.filter((s) => !s.o.deleted && !s.cellDeleted && edSet.has(s.ed));
      if (multiSecs.length) return multiSecs;
    }
    const sel = typeof getSelection === 'function' ? getSelection() : null;
    if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
      const anc = sel.getRangeAt(0).commonAncestorContainer;
      const liveSec = colSecs.find((s) => !s.o.deleted && !s.cellDeleted && s.ed && s.ed.paper && s.ed.paper.contains(anc));
      if (liveSec) return [liveSec];
    }
    return colSecs.filter((s) => !s.o.deleted && !s.cellDeleted);
  };

  const patBtns = new Map();
  const swatches = new Map();
  let customBox = null;
  const customRows = {};

  const syncStyleUi = () => {
    for (const [pKey, btn] of patBtns) btn.classList.toggle('on', pKey === T.tablePattern);
    for (const [cKey, sw] of swatches) {
      sw.btn.classList.toggle('on', cKey === T.tableColor);
      const previewPat = cKey === 'orijinal' ? T.tablePattern : (T.tablePattern || 'ust');
      const pal = paletteFor(cKey, origPalette, T.tableCustom, previewPat);
      const hasInner = pal.innerH || pal.innerV;
      const isDashed = pal.borderStyle === 'scalloped' || pal.borderStyle === 'dashed';
      const bCol = (pal.outerBorder && pal.borderWidth > 0) ? pal.cizgi : (cKey === 'sari' ? pal.cizgi : [203, 213, 225]);
      sw.preview.style.borderColor = `rgb(${bCol.join(',')})`;
      sw.preview.style.borderStyle = isDashed ? 'dashed' : 'solid';
      sw.preview.style.borderWidth = isDashed ? '1.5px' : '1px';
      sw.preview.style.borderRadius = pal.radius ? '5px' : '3px';
      sw.preview.style.backgroundColor = cKey === 'sari' ? `rgb(${pal.soluk.join(',')})` : '#fff';
      const lineCss = hasInner ? `1px solid rgb(${pal.cizgi.join(',')})` : '0';
      for (let idx = 0; idx < sw.cells.length; idx++) {
        const r = Math.floor(idx / 3), c = idx % 3;
        const fill = cellFill(previewPat, cKey, r, c, origPalette, T.tableCustom) || [255, 255, 255];
        const cellEl = sw.cells[idx];
        cellEl.style.backgroundColor = `rgb(${fill.join(',')})`;
        cellEl.style.borderRight = (c < 2 && pal.innerV && !pal.noVertLines) ? lineCss : '0';
        cellEl.style.borderBottom = (r < 2 && pal.innerH) ? lineCss : '0';
      }
    }
    if (customBox) {
      const isOzel = T.tableColor === 'ozel';
      customBox.hidden = !isOzel;
      if (isOzel) {
        if (customRows.koyu) {
          customRows.koyu.row.hidden = T.tablePattern === 'sade';
          customRows.koyu.lab.textContent = T.tablePattern === 'ustSol' ? t('tblCustomHeaderLeft') : (T.tablePattern === 'sol' ? t('tblCustomLeft') : t('tblCustomHeader'));
        }
        for (const k of ['koyu', 'ilk', 'ikinci']) {
          const row = customRows[k];
          if (!row || !T.tableCustom) continue;
          const hex = rgbToHex(T.tableCustom[k]);
          if (row.inp.value !== hex) row.inp.value = hex;
        }
      }
    }
  };

  const syncPropsUi = () => {
    syncStyleUi();
  };

  const applyHAlign = (align) => {
    const targets = getTargetSecs();
    if (!targets.length) return;
    commitSnap();
    for (const s of targets) {
      s.ed.setAlign(align, { silent: true });
      touchedTextObjs.add(s.o);
    }
    T.syncColTable();
    syncPropsUi();
    flushTextSync({ renderPreview: true }).then(() => commitSnap());
  };

  const applyVAlign = (va) => {
    const targets = getTargetSecs();
    if (!targets.length) return;
    commitSnap();
    for (const s of targets) {
      if (s.o.cell) s.o.cell.vAlign = va;
      if (s.model && s.model.cell) s.model.cell.vAlign = va;
      if (s.o._origPart && s.o._origPart.cell) s.o._origPart.cell.vAlign = va;
      if (s.ed && s.ed.el) s.ed.el.dataset.valign = va;
    }
    T.syncColTable();
    syncPropsUi();
    commitSnap();
  };

  const scrollPropsBottom = () => {
    const go = () => {
      if (typeof panel.scrollTo === 'function') panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' });
      else panel.scrollTop = panel.scrollHeight;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    else go();
  };

  const applyPattern = (pKey) => {
    commitSnap();
    T.tablePattern = (T.tableColor === 'orijinal' && T.tablePattern === pKey) ? null : pKey;
    T.syncColTable();
    syncPropsUi();
    if (T.tableColor === 'ozel' && T.tablePattern && T.tablePattern !== 'sade') scrollPropsBottom();
    commitSnap();
  };

  const applyColor = (cKey) => {
    commitSnap();
    T.tableColor = cKey;
    if (cKey === 'orijinal') T.tablePattern = null;
    else if (!T.tablePattern) T.tablePattern = 'ust';
    T.syncColTable();
    syncPropsUi();
    if (cKey === 'ozel') scrollPropsBottom();
    commitSnap();
  };

  const mkPatBtn = (pKey, labelKey, cls) => {
    const label = t(labelKey);
    const btn = h('button', {
      type: 'button',
      class: 'ae-pat-btn' + (cls ? ' ' + cls : ''),
      'data-testid': `te-tbl-pat-${pKey}`,
      onpointerdown: (e) => e.preventDefault(),
      onclick: (e) => { e.stopPropagation(); applyPattern(pKey); },
    }, label);
    patBtns.set(pKey, btn);
    return btn;
  };

  const mkSwatchBtn = (cKey) => {
    const label = t(COLOR_LABEL_KEYS[cKey] || cKey);
    const cells = [];
    for (let i = 0; i < 9; i++) cells.push(h('span', { class: 'ae-swatch-cell' }));
    const preview = h('span', { class: 'ae-swatch-preview' }, ...cells);
    const btn = h('button', {
      type: 'button',
      class: 'ae-swatch-btn',
      'data-testid': `te-tbl-color-${cKey}`,
      title: label,
      'aria-label': label,
      onpointerdown: (e) => e.preventDefault(),
      onclick: (e) => { e.stopPropagation(); applyColor(cKey); },
    }, preview, h('span', { class: 'ae-swatch-lab' }, label));
    swatches.set(cKey, { btn, preview, cells });
    return btn;
  };

  // A− / A+: every table cell one point smaller / bigger (only this table's
  // text; mixed sizes keep their difference). One undo step; the sizes are
  // normal character sizes, so the preview and the export follow them.
  const stepTableFont = (dir) => {
    const secs = colSecs.filter((s) => !s.o.deleted && !s.cellDeleted && s.ed && s.ed.paper && s.ed.paper.isConnected);
    if (!secs.length) return;
    commitSnap();
    if (typeof getSelection === 'function') getSelection().removeAllRanges();
    let any = false;
    T.holdSnaps(true);
    try {
      for (const s of secs) {
        if (s.ed.applyStyle({ size: dir }, s.ed.wholeRange())) { any = true; touchedTextObjs.add(s.o); }
      }
    } finally { T.holdSnaps(false); }
    if (!any) return;
    T.syncColTable();
    flushTextSync({ renderPreview: true }).then(() => { T.syncColTable(); commitSnap(); });
  };
  const mkFontBtn = (dir, label, tipKey) => h('button', {
    type: 'button',
    class: 'ae-pat-btn ae-font-step',
    'data-testid': dir > 0 ? 'te-tbl-font-up' : 'te-tbl-font-down',
    title: t(tipKey),
    'aria-label': t(tipKey),
    onpointerdown: (e) => e.preventDefault(),
    onclick: (e) => { e.stopPropagation(); stepTableFont(dir); },
  }, label);

  const patGroup = h('div', { class: 'ae-pat-group' },
    h('div', { class: 'ae-pat-row' },
      mkPatBtn('sade', 'tblPatPlain'),
      mkPatBtn('ust', 'tblPatTop'),
    ),
    h('div', { class: 'ae-pat-row' },
      mkPatBtn('sol', 'tblPatLeft'),
      mkPatBtn('ustSol', 'tblPatTopLeft'),
    ),
  );
  const colorOrder = (T.mainGrid && T.mainGrid.addedTable) ? TABLE_COLOR_ORDER.filter((k) => k !== 'orijinal') : TABLE_COLOR_ORDER;
  const swatchGrid = h('div', { class: 'ae-swatch-grid' }, ...colorOrder.map(mkSwatchBtn));

  const mkCustomRow = (key, labelKey) => {
    const lab = h('span', { class: 'ae-custom-lab' }, t(labelKey));
    const inp = h('input', {
      type: 'color',
      class: 'ae-color-inp',
      'data-testid': `te-tbl-custom-${key}`,
      value: rgbToHex(T.tableCustom && T.tableCustom[key]),
    });
    inp.addEventListener('pointerdown', () => commitSnap());
    inp.addEventListener('focus', () => commitSnap());
    inp.addEventListener('input', () => {
      T.tableCustom[key] = hexToRgb(inp.value);
      T.syncColTable();
      syncStyleUi();
    });
    inp.addEventListener('change', () => {
      T.tableCustom[key] = hexToRgb(inp.value);
      T.syncColTable();
      syncStyleUi();
      commitSnap();
    });
    const row = h('label', { class: 'ae-custom-row' }, lab, inp);
    customRows[key] = { row, lab, inp };
    return row;
  };

  customBox = h('div', { class: 'ae-custom-colors', hidden: T.tableColor !== 'ozel' },
    mkCustomRow('koyu', 'tblCustomHeader'),
    mkCustomRow('ilk', 'tblCustomFirst'),
    mkCustomRow('ikinci', 'tblCustomSecond'),
  );

  const panel = h('aside', { class: 'ae-table-props', 'data-testid': 'ae-table-props' },
    h('div', { class: 'ae-props-title' }, t('tblPropsTitle')),
    h('div', { class: 'ae-props-sec' },
      h('div', { class: 'ae-props-label' }, t('tblStyleTitle')),
      h('div', { class: 'ae-prop-card ae-style-card' },
        h('div', { class: 'ae-props-sub' }, t('tblPattern')),
        patGroup,
        h('div', { class: 'ae-props-sub' }, t('tblColor')),
        swatchGrid,
        customBox,
      ),
    ),
    h('div', { class: 'ae-props-sec' },
      h('div', { class: 'ae-props-label' }, t('tblFontSize')),
      h('div', { class: 'ae-pat-row' }, mkFontBtn(-1, 'A−', 'tblFontSmaller'), mkFontBtn(+1, 'A+', 'tblFontBigger')),
    ),
  );

  const clearCellBox = (s) => {
    let changed = false;
    if (s.o.keep && s.o.keep.length) { s.o.keep = []; changed = true; }
    if (s.o.hasBorder) { s.o.hasBorder = false; changed = true; }
    if (s.o._origPart && s.o._origPart.keep && s.o._origPart.keep.length) {
      s.o._origPart.keep = [];
      changed = true;
    }
    if (changed && render && !s.o.deleted) render(s.o);
  };

  const isFullCellRange = (ed, r) => {
    const w = ed.wholeRange();
    return r.i0 <= 0 && r.s0 <= 0 && r.i1 >= w.i1 && r.e1 >= w.e1;
  };

  T.clearTableStyle = async ({ clearBlockBox, renderMultiRanges } = {}) => {
    const mrs = T.getMultiRanges ? T.getMultiRanges() : [];
    const cur = T.selectedHandle;
    const sel = typeof getSelection === 'function' ? getSelection() : null;
    const liveRange = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const liveSec = (liveRange && !liveRange.collapsed)
      ? colSecs.find((s) => !s.o.deleted && !s.cellDeleted && s.ed && s.ed.paper && s.ed.paper.contains(liveRange.commonAncestorContainer))
      : null;

    commitSnap();
    if (mrs && mrs.length) {
      for (const r of mrs) {
        if (!r.ed) continue;
        r.ed.applyStyle({ clear: true }, r);
        const sec = colSecs.find((s) => !s.o.deleted && !s.cellDeleted && s.ed === r.ed);
        if (sec) {
          if (r.cellRect || isFullCellRange(r.ed, r)) clearCellBox(sec);
          touchedTextObjs.add(sec.o);
        }
      }
      if (renderMultiRanges) renderMultiRanges();
    } else if (cur && (cur.kind === 'col' || cur.kind === 'row')) {
      const targets = cur.kind === 'col'
        ? colSecs.filter((s) => !s.o.deleted && !s.cellDeleted && s.model?.cell?.col === cur.index)
        : (cellRows[cur.index] ? colSecs.filter((s) => !s.o.deleted && !s.cellDeleted && s.rowEl === cellRows[cur.index]) : []);
      for (const s of targets) {
        if (s.ed) s.ed.applyStyle({ clear: true }, s.ed.wholeRange());
        clearCellBox(s);
        touchedTextObjs.add(s.o);
      }
    } else if (liveSec) {
      const b = liveSec.ed.getRangeBounds();
      liveSec.ed.applyStyle({ clear: true });
      if (b && isFullCellRange(liveSec.ed, b)) clearCellBox(liveSec);
      touchedTextObjs.add(liveSec.o);
    } else {
      for (const s of colSecs) {
        if (s.o.deleted || s.cellDeleted) continue;
        if (s.ed) s.ed.applyStyle({ clear: true }, s.ed.wholeRange());
        clearCellBox(s);
        touchedTextObjs.add(s.o);
      }
      T.tableColor = 'renksiz';
      T.tablePattern = 'sade';
      if (clearBlockBox) clearBlockBox();
    }
    T.syncColTable();
    syncPropsUi();
    await flushTextSync({ renderPreview: true });
    commitSnap();
  };

  T.propsEl = panel;
  T.syncPropsUi = syncPropsUi;
  T.applyHAlign = applyHAlign;
  T.applyVAlign = applyVAlign;
  T.getAlignState = () => {
    const targets = getTargetSecs();
    if (!targets.length) return { hAlign: null, vAlign: null };
    const hVals = targets.map((s) => {
      const a = s.ed && s.ed.getAlign ? s.ed.getAlign() : undefined;
      return a === undefined ? ((s.model && s.model.align) || 'left') : a;
    });
    const vVals = targets.map((s) => (s.o.cell && s.o.cell.vAlign) || (s.model && s.model.cell && s.model.cell.vAlign) || null);
    return {
      hAlign: hVals[0] != null && hVals.every((v) => v === hVals[0]) ? hVals[0] : null,
      vAlign: vVals[0] != null && vVals.every((v) => v === vVals[0]) ? vVals[0] : null,
    };
  };
  syncPropsUi();
}
