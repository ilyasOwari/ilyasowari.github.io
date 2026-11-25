// Table controls in the editor: grid plus buttons, row/column handles, options menu.
// Part of aeTable.js: runs inside setupAeTable(); `T` is the shared table state built there.
import { h } from '../../common/dom.js';
import { t } from '../../../i18n/i18n.js';
import { icon } from '../../../../assets/icons/icons.js';

const DOTS_3X3_SVG = '<svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor" aria-hidden="true">'
  + '<circle cx="3" cy="3" r="1.15"/><circle cx="7" cy="3" r="1.15"/><circle cx="11" cy="3" r="1.15"/>'
  + '<circle cx="3" cy="7" r="1.15"/><circle cx="7" cy="7" r="1.15"/><circle cx="11" cy="7" r="1.15"/>'
  + '<circle cx="3" cy="11" r="1.15"/><circle cx="7" cy="11" r="1.15"/><circle cx="11" cy="11" r="1.15"/>'
  + '</svg>';

export function setupTableChrome(T) {
  const {
    bindHoldRepeat, cellRows, deleteColumn, deleteRow, doc,
    insertColumnAt, insertRowAt, syncCellWidths,
  } = T;
  const gridPlusLayer = h('div', { class: 'te-grid-plus-layer', 'data-testid': 'te-grid-plus-layer' });
  doc.append(gridPlusLayer);
  doc.classList.add('te-has-handles');
  const handleLayer = h('div', { class: 'te-handle-layer', 'data-testid': 'te-handle-layer' });
  doc.append(handleLayer);
  T.selectedHandle = null;

  const applyHandleSelection = () => {
    doc.querySelectorAll('.te-cell.te-col-selected, .te-cell.te-row-selected').forEach((el) => {
      el.classList.remove('te-col-selected', 'te-row-selected');
    });
    handleLayer.querySelectorAll('.te-handle.selected').forEach((el) => el.classList.remove('selected'));
    const cur = T.selectedHandle;
    if (!cur) { if (T.syncPropsUi) T.syncPropsUi(); return; }
    if (cur.kind === 'col') {
      if (cur.index < 0 || cur.index >= T.colCount) { T.selectedHandle = null; if (T.syncPropsUi) T.syncPropsUi(); return; }
      for (const row of cellRows) {
        row.querySelector(`.te-cell[data-col="${cur.index}"]`)?.classList.add('te-col-selected');
      }
      handleLayer.querySelector(`.te-handle-col[data-col="${cur.index}"]`)?.classList.add('selected');
    } else if (cur.kind === 'row') {
      if (cur.index < 0 || cur.index >= cellRows.length) { T.selectedHandle = null; if (T.syncPropsUi) T.syncPropsUi(); return; }
      cellRows[cur.index].querySelectorAll('.te-cell').forEach((el) => el.classList.add('te-row-selected'));
      handleLayer.querySelector(`.te-handle-row[data-row="${cur.index}"]`)?.classList.add('selected');
    }
    if (T.syncPropsUi) T.syncPropsUi();
  };
  T.applyHandleSelection = applyHandleSelection;

  doc.addEventListener('pointerdown', (e) => {
    if (T.selectedHandle && !e.target.closest('.te-handle') && !(optMenuEl && optMenuEl.contains(e.target))) {
      closeOptionsMenu();
    }
  });

  let optMenuEl = null;
  let optMenuRefresh = null;
  const hideMenuPopupOnly = () => {
    if (optMenuEl) { optMenuEl.remove(); optMenuEl = null; }
    optMenuRefresh = null;
  };
  const closeOptionsMenu = () => {
    hideMenuPopupOnly();
    document.removeEventListener('pointerdown', onDocDownMenu, true);
    document.removeEventListener('keydown', onDocKeyMenu, true);
    if (T.selectedHandle) {
      T.selectedHandle = null;
      applyHandleSelection();
    }
  };
  function onDocDownMenu(e) {
    if (e.target.closest('.te-handle')) return;
    if (optMenuEl && optMenuEl.contains(e.target)) return;
    if (e.target.closest('.ae-table-props, [data-testid="te-clear-style"]')) { hideMenuPopupOnly(); return; }
    if (optMenuEl || T.selectedHandle) closeOptionsMenu();
  }
  function onDocKeyMenu(e) {
    if ((optMenuEl || T.selectedHandle) && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeOptionsMenu();
    }
  }
  if (T.onCleanup) T.onCleanup(closeOptionsMenu);

  const openOptionsMenu = (kind, index, anchorBtn) => {
    if (optMenuEl) { optMenuEl.remove(); optMenuEl = null; }
    optMenuRefresh = null;
    document.removeEventListener('pointerdown', onDocDownMenu, true);
    document.removeEventListener('keydown', onDocKeyMenu, true);

    T.selectedHandle = { kind, index };
    applyHandleSelection();

    const menuBtn = (testid, ico, label, cls, fn) => h('button', {
      type: 'button',
      class: 'te-opt-item' + (cls ? ' ' + cls : ''),
      'data-testid': testid,
      role: 'menuitem',
      onpointerdown: (e) => e.preventDefault(),
      onclick: (e) => { e.stopPropagation(); fn(); },
      html: `<span style="width:14px;text-align:center;flex:none">${ico}</span><span>${label}</span>`,
    });

    const items = [];
    if (kind === 'col') {
      const btnLeft = menuBtn('te-opt-move-left', '←', t('tblMoveLeft'), '', () => {
        const i = T.selectedHandle?.index;
        if (i == null || i <= 0) return;
        T.swapColumns(i, i - 1);
        T.selectedHandle = { kind: 'col', index: i - 1 };
        applyHandleSelection();
        optMenuRefresh && optMenuRefresh();
      });
      const btnRight = menuBtn('te-opt-move-right', '→', t('tblMoveRight'), '', () => {
        const i = T.selectedHandle?.index;
        if (i == null || i >= T.colCount - 1) return;
        T.swapColumns(i, i + 1);
        T.selectedHandle = { kind: 'col', index: i + 1 };
        applyHandleSelection();
        optMenuRefresh && optMenuRefresh();
      });
      const btnDel = menuBtn('te-opt-del', icon('trash', 'icon icon-xs'), t('del'), 'danger', () => {
        const i = T.selectedHandle?.index;
        closeOptionsMenu();
        if (i != null) deleteColumn(i);
      });
      const btnDec = h('button', { type: 'button', 'data-testid': 'te-opt-dec' }, '−');
      const btnInc = h('button', { type: 'button', 'data-testid': 'te-opt-inc' }, '+');
      bindHoldRepeat(btnDec, () => {
        if (!T.selectedHandle) return;
        T.stepColWidth(T.selectedHandle.index, -4);
        optMenuRefresh && optMenuRefresh();
      });
      bindHoldRepeat(btnInc, () => {
        if (!T.selectedHandle) return;
        T.stepColWidth(T.selectedHandle.index, +4);
        optMenuRefresh && optMenuRefresh();
      });
      const sizeRow = h('div', { class: 'te-opt-size' }, h('span', null, t('tblWidth')), h('div', { class: 'te-opt-step' }, btnDec, btnInc));
      const noteEl = h('div', { class: 'te-opt-note' }, t('tblColAffectsAll'));
      items.push(btnLeft, btnRight, btnDel, h('div', { class: 'te-opt-sep' }), sizeRow, noteEl);
      optMenuRefresh = () => {
        if (!T.selectedHandle) return;
        const i = T.selectedHandle.index;
        btnLeft.disabled = i <= 0;
        btnRight.disabled = i >= T.colCount - 1;
        btnDel.disabled = T.colCount <= 2;
      };
    } else {
      const btnUp = menuBtn('te-opt-move-up', '↑', t('tblMoveUp'), '', () => {
        const i = T.selectedHandle?.index;
        if (i == null || i <= 0) return;
        T.swapRows(i, i - 1);
        T.selectedHandle = { kind: 'row', index: i - 1 };
        applyHandleSelection();
        optMenuRefresh && optMenuRefresh();
      });
      const btnDown = menuBtn('te-opt-move-down', '↓', t('tblMoveDown'), '', () => {
        const i = T.selectedHandle?.index;
        if (i == null || i >= cellRows.length - 1) return;
        T.swapRows(i, i + 1);
        T.selectedHandle = { kind: 'row', index: i + 1 };
        applyHandleSelection();
        optMenuRefresh && optMenuRefresh();
      });
      const btnDel = menuBtn('te-opt-del', icon('trash', 'icon icon-xs'), t('del'), 'danger', () => {
        const i = T.selectedHandle?.index;
        closeOptionsMenu();
        if (i != null) deleteRow(i);
      });
      const btnDec = h('button', { type: 'button', 'data-testid': 'te-opt-dec' }, '−');
      const btnInc = h('button', { type: 'button', 'data-testid': 'te-opt-inc' }, '+');
      bindHoldRepeat(btnDec, () => {
        if (!T.selectedHandle) return;
        T.stepRowHeight(T.selectedHandle.index, -4);
        optMenuRefresh && optMenuRefresh();
      });
      bindHoldRepeat(btnInc, () => {
        if (!T.selectedHandle) return;
        T.stepRowHeight(T.selectedHandle.index, +4);
        optMenuRefresh && optMenuRefresh();
      });
      const sizeRow = h('div', { class: 'te-opt-size' }, h('span', null, t('tblHeight')), h('div', { class: 'te-opt-step' }, btnDec, btnInc));
      const noteEl = h('div', { class: 'te-opt-note' }, t('tblRowAffectsAll'));
      items.push(btnUp, btnDown, btnDel, h('div', { class: 'te-opt-sep' }), sizeRow, noteEl);
      optMenuRefresh = () => {
        if (!T.selectedHandle) return;
        const i = T.selectedHandle.index;
        btnUp.disabled = i <= 0;
        btnDown.disabled = i >= cellRows.length - 1;
        btnDel.disabled = cellRows.length <= 1;
        btnDec.disabled = !T.canShrinkRow(i);
      };
    }

    optMenuRefresh();
    optMenuEl = h('div', { class: 'te-opt-menu', 'data-testid': 'te-opt-menu', role: 'menu' }, ...items);
    document.body.append(optMenuEl);
    const ar = anchorBtn.getBoundingClientRect();
    const mr = optMenuEl.getBoundingClientRect();
    let left = kind === 'col' ? ar.left : ar.right + 6;
    let top = kind === 'col' ? ar.bottom + 6 : ar.top;
    left = Math.max(8, Math.min(window.innerWidth - mr.width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - mr.height - 8, top));
    optMenuEl.style.left = Math.round(left) + 'px';
    optMenuEl.style.top = Math.round(top) + 'px';

    document.addEventListener('pointerdown', onDocDownMenu, true);
    document.addEventListener('keydown', onDocKeyMenu, true);
  };

  const rebuildHandles = () => {
    handleLayer.textContent = '';
    const dr = doc.getBoundingClientRect();
    const r0 = cellRows[0], rLast = cellRows[cellRows.length - 1];
    if (!r0 || !rLast) return;
    const topY = r0.getBoundingClientRect().top - dr.top;
    const leftX = (r0.querySelector('.te-cell[data-col="0"]')?.getBoundingClientRect().left ?? dr.left) - dr.left;

    for (let c = 0; c < T.colCount; c++) {
      const cell = r0.querySelector(`.te-cell[data-col="${c}"]`);
      if (!cell) continue;
      const cr = cell.getBoundingClientRect();
      const colLeft = cr.left - dr.left;
      const colW = cr.width;
      const cls = 'te-handle te-handle-col' + (c === 0 ? ' first' : '') + (c === T.colCount - 1 ? ' last' : '');
      const btn = h('button', {
        type: 'button', class: cls, 'data-col': String(c), 'data-testid': `te-col-handle-${c}`,
        title: t('tblColOptions'), 'aria-label': t('tblColOptions'),
        style: { left: colLeft + 'px', top: (topY - 28) + 'px', width: Math.max(20, colW) + 'px', height: '24px' },
        html: DOTS_3X3_SVG,
        onpointerdown: (e) => e.preventDefault(),
        onclick: (e) => {
          e.stopPropagation();
          if (T.selectedHandle && T.selectedHandle.kind === 'col' && T.selectedHandle.index === c && optMenuEl) closeOptionsMenu();
          else openOptionsMenu('col', c, btn);
        },
      });
      handleLayer.append(btn);
    }

    for (let rIdx = 0; rIdx < cellRows.length; rIdx++) {
      const rr = cellRows[rIdx].getBoundingClientRect();
      const rowTop = rr.top - dr.top;
      const rowH = rr.height;
      const cls = 'te-handle te-handle-row' + (rIdx === 0 ? ' first' : '') + (rIdx === cellRows.length - 1 ? ' last' : '');
      const btn = h('button', {
        type: 'button', class: cls, 'data-row': String(rIdx), 'data-testid': `te-row-handle-${rIdx}`,
        title: t('tblRowOptions'), 'aria-label': t('tblRowOptions'),
        style: { left: (leftX - 30) + 'px', top: rowTop + 'px', width: '24px', height: Math.max(20, rowH) + 'px' },
        html: DOTS_3X3_SVG,
        onpointerdown: (e) => e.preventDefault(),
        onclick: (e) => {
          e.stopPropagation();
          if (T.selectedHandle && T.selectedHandle.kind === 'row' && T.selectedHandle.index === rIdx && optMenuEl) closeOptionsMenu();
          else openOptionsMenu('row', rIdx, btn);
        },
      });
      handleLayer.append(btn);
    }

    applyHandleSelection();
  };
  T.rebuildHandles = rebuildHandles;
  for (const row of cellRows) row.classList.add('te-tbl-row');

  T.syncColUi = () => {
    gridPlusLayer.textContent = '';
    const dr = doc.getBoundingClientRect();
    const r0 = cellRows[0], rLast = cellRows[cellRows.length - 1];
    if (!r0 || !rLast) return;
    const topY = r0.getBoundingClientRect().top - dr.top;
    const botY = rLast.getBoundingClientRect().bottom - dr.top;
    const firstCell = r0.querySelector('.te-cell[data-col="0"]');
    const lastCell = r0.querySelector(`.te-cell[data-col="${T.colCount - 1}"]`);
    const leftX = (firstCell?.getBoundingClientRect().left ?? dr.left) - dr.left;
    const rightX = (lastCell?.getBoundingClientRect().right ?? dr.right) - dr.left;

    gridPlusLayer.append(h('button', {
      type: 'button', class: 'te-col-plus', 'data-testid': 'te-col-plus-left', title: t('addColumn'),
      style: { left: leftX + 'px', top: topY + 'px', height: Math.max(20, botY - topY) + 'px' },
      onclick: () => insertColumnAt(-1),
    }));

    for (let c = 0; c < T.colCount - 1; c++) {
      const a = r0.querySelector(`.te-cell[data-col="${c}"]`), b = r0.querySelector(`.te-cell[data-col="${c + 1}"]`);
      if (!a || !b) continue;
      const midX = ((a.getBoundingClientRect().right + b.getBoundingClientRect().left) * 0.5) - dr.left;
      gridPlusLayer.append(h('button', {
        type: 'button', class: 'te-col-plus', 'data-testid': `te-col-plus-${c}`, title: t('addColumn'),
        style: { left: midX + 'px', top: topY + 'px', height: Math.max(20, botY - topY) + 'px' },
        onclick: () => insertColumnAt(c),
      }));
    }

    gridPlusLayer.append(h('button', {
      type: 'button', class: 'te-col-plus', 'data-testid': `te-col-plus-${T.colCount - 1}`, title: t('addColumn'),
      style: { left: rightX + 'px', top: topY + 'px', height: Math.max(20, botY - topY) + 'px' },
      onclick: () => insertColumnAt(T.colCount - 1),
    }));

    for (let rIdx = 0; rIdx < cellRows.length - 1; rIdx++) {
      const ra = cellRows[rIdx].getBoundingClientRect(), rb = cellRows[rIdx + 1].getBoundingClientRect();
      const midY = ((ra.bottom + rb.top) * 0.5) - dr.top;
      gridPlusLayer.append(h('button', {
        type: 'button', class: 'te-row-plus', 'data-testid': `te-row-plus-${rIdx}`, title: t('addTemplateMid'),
        style: { top: midY + 'px', left: leftX + 'px', width: Math.max(40, rightX - leftX) + 'px' },
        onclick: () => insertRowAt(rIdx),
      }));
    }

    gridPlusLayer.append(h('button', {
      type: 'button', class: 'te-row-plus', 'data-testid': `te-row-plus-${cellRows.length - 1}`, title: t('addTemplateMid'),
      style: { top: botY + 'px', left: leftX + 'px', width: Math.max(40, rightX - leftX) + 'px' },
      onclick: () => insertRowAt(cellRows.length - 1),
    }));
    rebuildHandles();
  };

  requestAnimationFrame(() => { syncCellWidths(); T.syncColUi(); T.syncColTable(); });
  new ResizeObserver(() => T.syncColUi()).observe(doc);
}
