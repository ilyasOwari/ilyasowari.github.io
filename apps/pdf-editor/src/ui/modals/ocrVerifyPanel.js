// Docked side panel for reviewing suspect OCR words with Enter-Enter workflow:
// shows cropped original image next to editable text input + live page sync.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { icon } from '../../../assets/icons/icons.js';
import { findBlock } from '../../model/blockOps.js';
import { toast } from '../common/toast.js';

let activePanel = null;

export function closeOcrVerifyPanel() {
  if (activePanel) {
    activePanel.destroy();
    activePanel = null;
  }
}

export function openOcrVerifyPanel({ app, page, suspects, onApplyWord, onClose }) {
  closeOcrVerifyPanel();
  if (!suspects || !suspects.length) return null;

  const doneSet = new Set();
  const rowEls = [];
  let curIdx = 0;
  let minimized = false;

  const counterEl = h('span', { class: 'ocr-vp-count' }, `0 / ${suspects.length}`);
  const listEl = h('div', { class: 'ocr-vp-list' });
  const hintEl = h('div', { class: 'ocr-vp-hint' }, t('ocrVerifyHint'));
  const footEl = h('div', { class: 'ocr-vp-foot' });

  const updateCounter = () => { counterEl.textContent = `${doneSet.size} / ${suspects.length}`; };

  const setMinimized = (on) => {
    minimized = !!on;
    panel.classList.toggle('minimized', minimized);
    hintEl.hidden = minimized;
    listEl.hidden = minimized;
    footEl.hidden = minimized;
    closeBtn.hidden = minimized;
    expandBtn.hidden = !minimized;
    if (!minimized) requestAnimationFrame(() => focusRow(curIdx, true));
  };

  const focusRow = (idx, scrollRow = true) => {
    if (!rowEls.length) return;
    curIdx = Math.max(0, Math.min(rowEls.length - 1, idx));
    rowEls.forEach((r, i) => r.row.classList.toggle('active', i === curIdx));
    const rec = rowEls[curIdx];
    const blk = findBlock(page, rec.sus.blockId);
    if (blk) {
      app.select(page, [blk.id]);
      app.workspace.scrollToBlock(page, blk);
    }
    if (scrollRow) rec.row.scrollIntoView({ block: 'nearest' });
    rec.inp.focus();
    rec.inp.select();
  };

  const nextPending = (fromIdx) => {
    for (let i = fromIdx + 1; i < rowEls.length; i++) if (!doneSet.has(i)) return i;
    for (let i = 0; i < fromIdx; i++) if (!doneSet.has(i)) return i;
    return -1;
  };

  const commitRow = async (idx, value, advance = true) => {
    const rec = rowEls[idx];
    if (!rec) return;
    await onApplyWord(rec.sus, value);
    doneSet.add(idx);
    rec.row.classList.add('done');
    updateCounter();
    if (!advance) return;
    const nx = nextPending(idx);
    if (nx >= 0) focusRow(nx);
    else {
      toast(t('ocrVerifyDone'));
      setMinimized(true);
    }
  };

  suspects.forEach((sus, idx) => {
    const img = sus.cropDataUrl
      ? h('img', { class: 'ocr-vp-img', src: sus.cropDataUrl, alt: sus.text })
      : h('span', { class: 'ocr-vp-empty' }, sus.text);
    const conf = h('span', { class: 'ocr-vp-conf' }, `%${sus.conf}`);
    const inp = h('input', {
      type: 'text', class: 'ocr-vp-inp', value: sus.text,
      'aria-label': sus.text,
    });
    const delBtn = h('button', {
      type: 'button', class: 'ocr-vp-del', title: t('ocrVerifyDelWord'),
      onclick: (e) => {
        e.stopPropagation();
        inp.value = '';
        commitRow(idx, '', true);
      },
    }, '×');
    const row = h('div', {
      class: 'ocr-vp-row',
      onclick: () => focusRow(idx, false),
    },
    h('div', { class: 'ocr-vp-orig' }, img, conf),
    h('div', { class: 'ocr-vp-edit' }, inp, delBtn));

    inp.addEventListener('focus', () => {
      if (curIdx !== idx) focusRow(idx, false);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) focusRow(Math.max(0, idx - 1));
        else commitRow(idx, inp.value, true);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusRow(Math.min(rowEls.length - 1, idx + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusRow(Math.max(0, idx - 1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMinimized(true);
      }
    });

    rowEls.push({ sus, row, inp });
    listEl.append(row);
  });

  const acceptAllBtn = h('button', {
    type: 'button', class: 'btn primary ocr-vp-all',
    onclick: async () => {
      for (let i = 0; i < rowEls.length; i++) {
        await onApplyWord(rowEls[i].sus, rowEls[i].inp.value);
        doneSet.add(i);
        rowEls[i].row.classList.add('done');
      }
      updateCounter();
      toast(t('ocrVerifyDone'));
      setMinimized(true);
    },
  }, t('ocrVerifyAll'));

  const closeBtn = h('button', {
    type: 'button', class: 'ocr-vp-close', title: t('ocrVerifyMinimize'),
    html: icon('close', 'icon icon-sm'),
    onclick: (e) => { e.stopPropagation(); setMinimized(true); },
  });
  const expandBtn = h('button', {
    type: 'button', class: 'ocr-vp-expand', title: t('ocrVerifyExpand'), hidden: true,
    html: icon('freeObj', 'icon icon-sm'),
    onclick: (e) => { e.stopPropagation(); setMinimized(false); },
  });

  // logo / signature / unimportant detail: give the area back to the original
  const restoreBtn = h('button', {
    type: 'button', class: 'btn ocr-vp-restore', 'data-testid': 'ocr-restore-area',
    onclick: () => { setMinimized(true); app.setTool('restoreArea'); },
  }, t('ocrVerifyRestore'));
  footEl.append(acceptAllBtn, restoreBtn);
  const headEl = h('div', {
    class: 'ocr-vp-head',
    onclick: () => { if (minimized) setMinimized(false); },
  },
  h('div', { class: 'ocr-vp-title-wrap' }, h('strong', null, t('ocrVerifyTitle')), counterEl),
  closeBtn,
  expandBtn);

  const panel = h('aside', { class: 'ocr-vpanel', 'data-testid': 'ocr-verify-panel' },
    headEl,
    hintEl,
    listEl,
    footEl);

  document.body.append(panel);

  const api = {
    el: panel,
    destroy() {
      panel.remove();
      if (activePanel === api) activePanel = null;
      if (onClose) onClose();
    },
  };
  activePanel = api;
  requestAnimationFrame(() => focusRow(0, true));
  return api;
}
