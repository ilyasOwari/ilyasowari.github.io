// Ribbon quick-table popover (7x6 grid + gray-white plain preset), Insert Table modal (without Orijinal, right-side custom pickers), and inserted table block builder.
import { h } from '../common/dom.js';
import { openModal } from '../common/modal.js';
import { t } from '../../i18n/i18n.js';
import { icon } from '../../../assets/icons/icons.js';
import { newId } from '../../model/blockOps.js';
import { fallbackSrcIndex } from '../../model/blockState.js';
import { TABLE_COLOR_ORDER, buildTableStyleProps, cellFill, paletteFor, cloneCustom, rgbToHex, hexToRgb } from '../../core/tableStyle.js';

export const NEW_TABLE_COLORS = TABLE_COLOR_ORDER.filter((k) => k !== 'orijinal');
export const QUICK_GRAY_CUSTOM = { koyu: [203, 213, 225], ilk: [241, 245, 249], ikinci: [255, 255, 255] };

const COLOR_LABEL_KEYS = {
  renksiz: 'tblColorNone',
  mavi: 'tblColorBlue',
  yesil: 'tblColorGreen',
  kirmizi: 'tblColorRed',
  mor: 'tblColorPurple',
  sari: 'tblColorYellow',
  tirtikli: 'tblColorScallop',
  ozel: 'tblColorCustom',
};

let activePop = null;

export function openInsertTablePopover(anchor, { onQuickPick, onOpenModal }) {
  if (activePop) {
    const sameAnchor = activePop.anchor === anchor;
    activePop.close();
    if (sameAnchor) return;
  }

  const headLab = h('div', { class: 'it-quick-head' }, t('quickInsertTable'));
  const cells = [];
  const COLS = 7, ROWS = 6;
  const highlight = (hc, hr) => {
    for (const item of cells) item.el.classList.toggle('on', item.c <= hc && item.r <= hr);
    headLab.textContent = hc > 0 && hr > 0 ? `${t('quickInsertTable')} (${hc} × ${hr})` : t('quickInsertTable');
  };

  const grid = h('div', { class: 'it-quick-grid', onmouseleave: () => highlight(0, 0) });
  for (let r = 1; r <= ROWS; r++) {
    for (let c = 1; c <= COLS; c++) {
      const btn = h('button', {
        type: 'button',
        class: 'it-quick-cell',
        'data-testid': `it-cell-${c}-${r}`,
        'aria-label': `${c} × ${r}`,
        onmouseenter: () => highlight(c, r),
        onclick: (e) => {
          e.stopPropagation();
          close();
          if (onQuickPick) onQuickPick(Math.max(2, c), r);
        },
      });
      cells.push({ el: btn, c, r });
      grid.append(btn);
    }
  }

  const openBtn = h('button', {
    type: 'button',
    class: 'it-menu-btn',
    'data-testid': 'it-open-modal',
    html: icon('table', 'icon icon-sm') + `<span>${t('insertTableEllipsis')}</span>`,
    onclick: (e) => {
      e.stopPropagation();
      close();
      if (onOpenModal) onOpenModal();
    },
  });

  const pop = h('div', { class: 'it-pop', 'data-testid': 'it-pop' },
    openBtn,
    h('div', { class: 'it-pop-sep' }),
    headLab,
    grid,
  );
  pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.append(pop);

  const ar = anchor ? anchor.getBoundingClientRect() : { left: 160, bottom: 92 };
  const pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(ar.left, window.innerWidth - pr.width - 8)) + 'px';
  pop.style.top = Math.min(ar.bottom + 4, window.innerHeight - pr.height - 8) + 'px';

  const onDown = (e) => {
    if (!pop.contains(e.target) && (!anchor || !anchor.contains(e.target))) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  const onBlur = () => close();

  function close() {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    pop.remove();
    if (activePop && activePop.anchor === anchor) activePop = null;
  }

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  activePop = { anchor, close };
}

export function openInsertTableModal({ onConfirm } = {}) {
  let pattern = 'ust';
  let color = 'mavi';
  const custom = cloneCustom(null);

  const clampInt = (raw, min, max, fallback) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const colInp = h('input', { type: 'number', class: 'it-num-inp', min: '2', max: '15', value: '5', 'data-testid': 'it-col-input' });
  const rowInp = h('input', { type: 'number', class: 'it-num-inp', min: '1', max: '30', value: '2', 'data-testid': 'it-row-input' });

  const patBtns = new Map();
  const swatches = new Map();
  const customRows = {};
  let customSide = null;

  const syncUi = () => {
    for (const [pKey, btn] of patBtns) btn.classList.toggle('on', pKey === pattern);
    for (const [cKey, sw] of swatches) {
      sw.btn.classList.toggle('on', cKey === color);
      const pal = paletteFor(cKey, null, custom, pattern);
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
        const fill = cellFill(pattern, cKey, r, c, null, custom) || [255, 255, 255];
        const cellEl = sw.cells[idx];
        cellEl.style.backgroundColor = `rgb(${fill.join(',')})`;
        cellEl.style.borderRight = (c < 2 && pal.innerV && !pal.noVertLines) ? lineCss : '0';
        cellEl.style.borderBottom = (r < 2 && pal.innerH) ? lineCss : '0';
      }
    }
    if (customSide) {
      const isOzel = color === 'ozel';
      customSide.hidden = !isOzel;
      if (isOzel) {
        if (customRows.koyu) {
          customRows.koyu.row.hidden = pattern === 'sade';
          customRows.koyu.lab.textContent = pattern === 'ustSol' ? t('tblCustomHeaderLeft') : (pattern === 'sol' ? t('tblCustomLeft') : t('tblCustomHeader'));
        }
        for (const k of ['koyu', 'ilk', 'ikinci']) {
          const r = customRows[k];
          if (!r) continue;
          const hx = rgbToHex(custom[k]);
          if (r.inp.value !== hx) r.inp.value = hx;
        }
      }
    }
  };

  const mkPatBtn = (pKey, labelKey, cls) => {
    const btn = h('button', {
      type: 'button',
      class: 'ae-pat-btn' + (cls ? ' ' + cls : ''),
      'data-testid': `it-pat-${pKey}`,
      onclick: () => { pattern = pKey; syncUi(); },
    }, t(labelKey));
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
      'data-testid': `it-color-${cKey}`,
      title: label,
      'aria-label': label,
      onclick: () => { color = cKey; syncUi(); },
    }, preview, h('span', { class: 'ae-swatch-lab' }, label));
    swatches.set(cKey, { btn, preview, cells });
    return btn;
  };

  const mkCustomRow = (key, labelKey) => {
    const lab = h('span', { class: 'ae-custom-lab' }, t(labelKey));
    const inp = h('input', {
      type: 'color',
      class: 'ae-color-inp it-color-inp',
      'data-testid': `it-custom-${key}`,
      value: rgbToHex(custom[key]),
    });
    const onPick = () => { custom[key] = hexToRgb(inp.value); syncUi(); };
    inp.addEventListener('input', onPick);
    inp.addEventListener('change', onPick);
    const row = h('label', { class: 'ae-custom-row it-custom-row' }, lab, inp);
    customRows[key] = { row, lab, inp };
    return row;
  };

  customSide = h('div', { class: 'it-custom-side', hidden: true, 'data-testid': 'it-custom-side' },
    mkCustomRow('koyu', 'tblCustomHeader'),
    mkCustomRow('ilk', 'tblCustomFirst'),
    mkCustomRow('ikinci', 'tblCustomSecond'),
  );

  const swatchGrid = h('div', { class: 'it-swatch-grid' }, ...NEW_TABLE_COLORS.map(mkSwatchBtn), customSide);

  const body = h('div', { class: 'it-body' },
    h('div', { class: 'ae-props-sec' },
      h('div', { class: 'ae-props-label' }, t('tblSizeSection')),
      h('div', { class: 'ae-prop-card it-size-card' },
        h('label', { class: 'it-size-row' }, h('span', {}, t('tblColCountLabel')), colInp),
        h('label', { class: 'it-size-row' }, h('span', {}, t('tblRowCountLabel')), rowInp),
      ),
    ),
    h('div', { class: 'ae-props-sec' },
      h('div', { class: 'ae-props-label' }, t('tblStyleTitle')),
      h('div', { class: 'ae-prop-card ae-style-card' },
        h('div', { class: 'ae-props-sub' }, t('tblPattern')),
        h('div', { class: 'ae-pat-group' },
          h('div', { class: 'ae-pat-row' }, mkPatBtn('sade', 'tblPatPlain'), mkPatBtn('ust', 'tblPatTop')),
          h('div', { class: 'ae-pat-row' }, mkPatBtn('sol', 'tblPatLeft'), mkPatBtn('ustSol', 'tblPatTopLeft')),
        ),
        h('div', { class: 'ae-props-sub' }, t('tblColor')),
        swatchGrid,
      ),
    ),
  );

  const confirmBtn = h('button', { type: 'button', class: 'btn primary', 'data-testid': 'it-confirm' }, t('ok'));
  const cancelBtn = h('button', { type: 'button', class: 'btn', 'data-testid': 'it-cancel' }, t('cancel'));
  const foot = h('div', { class: 'modal-foot' }, h('div', { class: 'grow' }), confirmBtn, cancelBtn);
  const m = openModal({ title: t('insertTableTitle'), body, foot, cls: 'it-modal', closeOnBackdrop: true });

  const submit = () => {
    const spec = {
      cols: clampInt(colInp.value, 2, 15, 5),
      rows: clampInt(rowInp.value, 1, 30, 2),
      pattern,
      color,
      custom: color === 'ozel' ? cloneCustom(custom) : null,
    };
    m.close(spec);
    if (onConfirm) onConfirm(spec);
  };
  confirmBtn.onclick = submit;
  cancelBtn.onclick = () => m.close(null);
  colInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  rowInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  syncUi();
  setTimeout(() => colInp.focus(), 20);
}

export function buildInsertedTableBlock(session, page, { cols = 5, rows = 2, pattern = 'ust', color = 'mavi', custom = null } = {}) {
  const nCols = Math.max(2, Math.min(15, Math.round(Number(cols) || 5)));
  const nRows = Math.max(1, Math.min(30, Math.round(Number(rows) || 2)));
  const si = fallbackSrcIndex(session, page);
  const an = si !== null ? session.analysis(si) : null;

  const segGlyphs = (an && an.seg && an.seg.glyphs) || [];
  let refG = segGlyphs.find((g) => {
    if (!g || g.space || !g.g || !g.g.font) return false;
    const st = g.g.font.style;
    const isBold = !!(st && st.weight >= 600) || /bold|black|heavy/i.test(g.g.font.baseFont || '');
    if (isBold) return false;
    const fl = g.g.fill;
    const isColored = fl && fl.args && fl.args.length >= 3 && (Math.max(...fl.args) - Math.min(...fl.args) > 0.12 || Math.max(...fl.args) > 0.5);
    return !isColored && g.idx >= 0;
  }) || segGlyphs.find((g) => g && !g.space && g.g && g.g.font && !(g.g.font.style && g.g.font.style.weight >= 600));
  const plainRefGlyphIdx = refG ? refG.idx : -1;

  const fontSize = 10;
  const padX = 4.5;
  const tenCharTextW = Math.round(10 * fontSize * 0.52);
  const defaultSlotW = tenCharTextW + padX * 2;
  const maxTableW = Math.max(160, (page.w || 595) - 2 * 48.2);
  const colSlotW = Math.max(32, Math.min(defaultSlotW, Math.floor(maxTableW / nCols)));
  const cellInnerW = Math.max(18, colSlotW - padX * 2);
  const lineH = Math.round(fontSize * 1.32);
  const cellInnerH = lineH * 2;
  const rowSlotH = cellInnerH + 6;
  const totalW = colSlotW * nCols;
  const totalH = rowSlotH * nRows;
  const x0 = Math.max(24, Math.round(((page.w || 595) - totalW) / 2));
  const y0 = 72;

  const xs = Array.from({ length: nCols + 1 }, (_, c) => x0 + c * colSlotW);
  const ys = Array.from({ length: nRows + 1 }, (_, r) => y0 + r * rowSlotH);
  const origPalette = {
    headerBg: null, bodyBg: [255, 255, 255], altRowBg: null, borderColor: [203, 213, 225],
    borderWidth: 0.75, innerH: true, innerV: true, outerBorder: true,
    radius: 0, borderStyle: 'solid', noVertLines: false, headerAccent: null,
  };
  const styleProps = buildTableStyleProps(pattern, color, origPalette, custom);

  const gridPart = {
    id: newId('p'), kind: 'obj', obj: 'deco', addedTable: true,
    src: { x: x0, y: y0, w: totalW, h: totalH },
    full: { x: x0, y: y0, w: totalW, h: totalH },
    keep: [], keepG: [], editable: false,
    edit: {
      removeGlyphs: [], runs: [], delta: 0, deltaX: 0,
      tableSpec: { xs, ys, gridMoved: true, ...styleProps },
    },
    dw: totalW, dh: totalH, dx: 0, dy: 0, sc: 1,
  };

  const parts = [gridPart];
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const cx = x0 + c * colSlotW + padX;
      const cy = y0 + r * rowSlotH + 3;
      const src = { x: cx, y: cy, w: cellInnerW, h: cellInnerH };
      parts.push({
        id: newId('p'), kind: 'obj', obj: 'text', addedText: true,
        refGlyphIdx: plainRefGlyphIdx, fontSize, baseW: cellInnerW,
        src, full: { ...src }, keep: [], keepG: [], editable: true,
        edit: { clusters: [], removeGlyphs: [], runs: [], marks: [], dropGfx: [], dropBoxes: [], delta: 0, deltaX: 0, k: 1 },
        cell: { row: r, gridRow: r, col: c, colW: colSlotW },
        dw: cellInnerW, dh: cellInnerH, dx: cx - x0, dy: cy - y0, sc: 1,
      });
    }
  }

  return {
    id: newId('b'), kind: 'group', x: x0, y: y0, s: 1, bw: totalW, bh: totalH, parts,
    ...(page.srcIndex === null && si !== null ? { from: si } : {}),
  };
}
