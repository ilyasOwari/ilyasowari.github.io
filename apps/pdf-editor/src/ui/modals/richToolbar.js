// Compact formatting bar of the text editor: bold / italic / underline, colour
// swatches, bigger / smaller, font picker. Works on the current selection.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { setFontCss } from './richText.js';
import { customSwatch } from '../common/colorPick.js';

export const SWATCHES = [
  ['#1f1f1f', 'clBlack'], ['#d62828', 'clRed'], ['#e9b400', 'clYellow'],
];
let facesDone = false;
export function registerLibraryFaces(man) {
  if (facesDone) return; facesDone = true;
  for (const m of man) {
    try { document.fonts.add(new FontFace(`PFL ${m.family}`, `url(assets/fonts/${m.file})`, { weight: String(m.weight || 400), style: m.italic ? 'italic' : 'normal' })); } catch (e) { /* ignore */ }
  }
}

export function richToolbar({ editors, fonts, man, lead = [], mid = [], afterSpacing = [], tail = [], defaultName = null, linkInTools = false, fontInTools = false, getMultiRanges = null, onMultiApplied = null, sizeField = false, onAlign = null, getAlignState = null, onCheckBox = null, getCheckBoxState = null, onCleanCheckBox = null, onSmartOrderCheckBox = null }) {
  if (man) registerLibraryFaces(man);
  const famOf = new Map();
  if (fonts) { for (const f of fonts.orig) famOf.set(f.id, f.family); for (const f of fonts.lib) famOf.set(f.id, f.family); }
  setFontCss((id) => (famOf.has(id) ? `"PFL ${famOf.get(id)}", sans-serif` : null));
  const nameOf = (id) => { const all = fonts ? fonts.orig.concat(fonts.lib) : []; const f = all.find((x) => x.id === id); return f ? f.name : (defaultName || t('rtFontDefault')); };
  const allVisibleNonBadgeEds = () => editors.filter((e) => {
    if (e.badge || !e.paper || !e.paper.isConnected) return false;
    const wrap = e.el || e.paper;
    return !wrap.hidden && !wrap.closest('[hidden]');
  });
  const allVisibleParas = () => allVisibleNonBadgeEds().flatMap((e) => [...e.paper.querySelectorAll(':scope > .te-para')]);
  const hasLiveSelIn = (ed) => {
    const s = getSelection();
    return !!(ed && s && s.rangeCount && !s.getRangeAt(0).collapsed && ed.paper && ed.paper.contains(s.anchorNode));
  };
  const current = () => { const s = getSelection(); return s.rangeCount ? editors.find((e) => e.paper.contains(s.anchorNode)) : null; };
  // the full colour chooser takes the focus: remember the text selection first
  let saved = null;
  const remember = () => {
    const s = getSelection();
    const ed = current();
    const collapsed = !(s && s.rangeCount && !s.getRangeAt(0).collapsed);
    saved = ed && s.rangeCount ? { ed, r: s.getRangeAt(0).cloneRange(), collapsed, sel: !collapsed ? ed.saveSelection() : null } : null;
  };
  const restore = () => { if (!saved) return; const s = getSelection(); s.removeAllRanges(); s.addRange(saved.r); };
  const run = (op) => {
    const mr = getMultiRanges ? getMultiRanges() : null;
    if (mr && mr.length) {
      // one decision for the whole multi-cell selection: all on -> off, otherwise on
      if (op.toggle || op.vpos) {
        const key = op.toggle || op.vpos;
        const states = mr.map((r) => (r.ed && r.ed.rangeAllOn ? r.ed.rangeAllOn(key, r) : null)).filter((v) => v !== null);
        op = { ...op, on: !(states.length && states.every(Boolean)) };
      }
      let ok = false;
      for (const r of mr) if (r.ed && r.ed.applyStyle(op, r)) ok = true;
      if (!ok) return;
      onMultiApplied && onMultiApplied();
      refresh();
      return;
    }
    const ed = current();
    if (ed && hasLiveSelIn(ed)) {
      if (!ed.applyStyle(op)) return;
      refresh();
      return;
    }
    const ts = targets();
    if (!ts.length) return;
    if (op.toggle || op.vpos) {
      const key = op.toggle || op.vpos;
      const states = ts.map((x) => (x.ed.rangeAllOn ? x.ed.rangeAllOn(key, x.range) : null)).filter((v) => v !== null);
      op = { ...op, on: !(states.length && states.every(Boolean)) };
    }
    let ok = false;
    ts.forEach((x, idx) => {
      if (x.ed.applyStyle(op, x.range, { batch: idx < ts.length - 1 })) ok = true;
    });
    if (!ok) return;
    refresh();
  };
  const clearAllStyle = (clearBlockBox) => {
    const ts = targets();
    if (!ts.length) return;
    const baseSizes = ts.map((x) => x.ed.baseSize).filter((v) => v > 0);
    const sameSz = baseSizes.length > 1 && Math.max(...baseSizes) - Math.min(...baseSizes) > 0.3
      ? baseSizes.slice().sort((a, b) => a - b)[baseSizes.length >> 1]
      : null;
    ts.forEach((x, idx) => {
      const batch = idx < ts.length - 1;
      x.ed.applyStyle({ clear: true }, x.range, { batch: batch || !!sameSz });
      if (sameSz) x.ed.applyStyle({ setSize: sameSz }, x.range, { batch });
    });
    if (clearBlockBox) clearBlockBox();
    if (getMultiRanges && getMultiRanges()?.length) onMultiApplied && onMultiApplied();
    refresh();
  };
  // Size and font also work without a selection: then the whole text the caret
  // was last in (the cell) gets them. The last editor / selection is remembered
  // because the size field takes the focus.
  let lastEd = null, lastRange = null;
  const trackSel = () => {
    const ed = current();
    if (!ed) return;
    lastEd = ed;
    const s = getSelection();
    lastRange = s.rangeCount && !s.getRangeAt(0).collapsed ? ed.saveSelection() : null;
  };
  const targets = () => {
    const mr = getMultiRanges ? getMultiRanges() : null;
    if (mr && mr.length) return mr.filter((r) => r.ed).map((r) => ({ ed: r.ed, range: r }));
    const ed = current();
    const s = getSelection();
    if (ed && s.rangeCount && !s.getRangeAt(0).collapsed) return [{ ed, range: null }];
    if (!ed && lastRange && lastEd && editors.includes(lastEd) && lastEd.paper.isConnected) {
      return [{ ed: lastEd, range: lastRange }];
    }
    const all = allVisibleNonBadgeEds();
    if (all.length) return all.map((e) => ({ ed: e, range: e.wholeRange() }));
    const visAny = editors.filter((e) => e.paper && e.paper.isConnected && !(e.el || e.paper).hidden && !(e.el || e.paper).closest('[hidden]'));
    return visAny.map((e) => ({ ed: e, range: e.wholeRange() }));
  };
  const runAll = (op) => {
    const ts = targets();
    let ok = false;
    ts.forEach((x, idx) => {
      if (x.ed.applyStyle(op, x.range, { batch: idx < ts.length - 1 })) ok = true;
    });
    if (!ok) return;
    if (getMultiRanges && getMultiRanges()?.length) onMultiApplied && onMultiApplied();
    refresh();
  };
  const keep = (e) => e.preventDefault();
  const bindHoldRepeat = (btn, fn) => {
    let holdT = null, holdI = null, handled = false;
    const stop = () => {
      if (holdT) { clearTimeout(holdT); holdT = null; }
      if (holdI) { clearInterval(holdI); holdI = null; }
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || btn.disabled) return;
      e.preventDefault();
      handled = true;
      fn();
      holdT = setTimeout(() => {
        holdI = setInterval(() => { if (btn.disabled) stop(); else fn(); }, 65);
      }, 300);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('blur', stop);
    btn.addEventListener('click', (e) => {
      if (handled) { handled = false; e.preventDefault(); return; }
      if (!btn.disabled) fn();
    });
  };
  const hasMulti = () => { const mr = getMultiRanges ? getMultiRanges() : null; return !!(mr && mr.length); };
  const tb = (key, label, tip, op) => h('button', { class: 'rt-btn rt-' + key, 'data-testid': 'rt-' + key, 'data-tip': tip, 'aria-label': tip, onpointerdown: keep, onclick: () => run(op) }, label);
  const bB = tb('b', 'B', t('rtBold'), { toggle: 'b' });
  const bI = tb('i', 'I', t('rtItalic'), { toggle: 'i' });
  const bU = tb('u', 'U', t('rtUnderline'), { toggle: 'u' });
  const sw = h('div', { class: 'rt-swatches' },
    h('button', { class: 'rt-sw rt-sw-none', 'data-testid': 'rt-color-none', 'data-tip': t('rtOrigColor'), 'aria-label': t('rtOrigColor'), onpointerdown: keep, onclick: () => run({ color: null }) }),
    ...SWATCHES.map(([c, k]) => h('button', { class: 'rt-sw', 'data-testid': 'rt-color', 'data-color': c, 'data-tip': t(k), 'aria-label': t(k), style: { background: c }, onpointerdown: keep, onclick: () => run({ color: c }) })),
    customSwatch({ testid: 'rt-color-custom', beforeOpen: remember, onPick: (c) => { restore(); run({ color: c }); remember(); } }));
  const bSup = h('button', { class: 'rt-btn rt-v', 'data-testid': 'rt-sup', 'data-tip': t('rtSup'), 'aria-label': t('rtSup'), onpointerdown: keep, onclick: () => run({ vpos: 'sup' }), html: 'x<sup>2</sup>' });
  const bSub = h('button', { class: 'rt-btn rt-v', 'data-testid': 'rt-sub', 'data-tip': t('rtSub'), 'aria-label': t('rtSub'), onpointerdown: keep, onclick: () => run({ vpos: 'sub' }), html: 'x<sub>2</sub>' });
  const minusSvg = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 8h9"/></svg>`;
  const plusSvg = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>`;
  const smaller = h('button', { class: 'rt-btn rt-size', 'data-testid': 'rt-smaller', 'data-tip': t('rtSmaller'), 'aria-label': t('rtSmaller'), html: minusSvg });
  const bigger = h('button', { class: 'rt-btn rt-size', 'data-testid': 'rt-bigger', 'data-tip': t('rtBigger'), 'aria-label': t('rtBigger'), html: plusSvg });
  bindHoldRepeat(smaller, () => runAll({ size: -1 }));
  bindHoldRepeat(bigger, () => runAll({ size: +1 }));
  const sizeInp = h('input', { type: 'number', class: 'rt-size-inp', 'data-testid': 'rt-size', min: 3, max: 200, step: 0.5, 'data-tip': t('rtSize'), 'aria-label': t('rtSize'), placeholder: '–' });
  // Enter and the later blur both report a change: apply each typed value once
  let sizeShown = '';
  const applySizeInp = () => {
    if (sizeInp.value === sizeShown) return;
    const v = parseFloat(String(sizeInp.value).replace(',', '.'));
    if (!(v >= 3 && v <= 200)) { sizeInp.value = sizeShown; return; }
    sizeShown = sizeInp.value;
    runAll({ setSize: Math.round(v * 2) / 2 });
  };
  sizeInp.addEventListener('pointerdown', () => trackSel());
  sizeInp.addEventListener('focus', () => { sizeShown = sizeInp.value; });
  sizeInp.addEventListener('change', applySizeInp);
  sizeInp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); applySizeInp(); }
    if (e.key === 'Escape') { e.preventDefault(); refresh(); sizeInp.blur(); }
  });
  const sizeWrap = h('label', { class: 'rt-size-wrap' }, sizeInp, h('span', { class: 'rt-size-unit' }, 'pt'));
  const fontLabel = h('span', { class: 'rt-font-name' }, defaultName || t('rtFontDefault'));
  const fontBtn = h('button', { class: 'rt-font', 'data-testid': 'rt-font', 'data-tip': t('rtFont'), onpointerdown: keep, onclick: () => toggleList() }, fontLabel, h('span', { class: 'rt-caret' }, '▾'));
  const list = h('div', { class: 'rt-font-list', hidden: true });
  const item = (f) => h('button', { class: 'rt-font-item', 'data-font': f.id, style: { fontFamily: `"PFL ${f.family}", sans-serif` }, onpointerdown: keep, onclick: () => { list.hidden = true; runAll({ font: f.id }); } }, f.name);
  if (fonts) {
    list.append(h('button', { class: 'rt-font-item rt-font-def', 'data-font': '', onpointerdown: keep, onclick: () => { list.hidden = true; runAll({ font: null }); } }, t('rtFontDefault')));
    if (fonts.orig.length) { list.append(h('div', { class: 'rt-font-head' }, t('rtFontOrig'))); fonts.orig.forEach((f) => list.append(item(f))); }
    list.append(h('div', { class: 'rt-font-head' }, t('rtFontLib'))); fonts.lib.forEach((f) => list.append(item(f)));
  }
  const fontWrap = h('div', { class: 'rt-font-wrap' }, fontBtn, list);
  const toggleList = () => { if (!targets().length) return; list.hidden = !list.hidden; };
  const linkIco = `<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 10.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M10.5 7.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1"/></svg>`;
  const linkBtn = h('button', { type: 'button', class: 'rt-btn rt-link', 'data-testid': 'rt-link', 'data-tip': t('rtLink'), 'aria-label': t('rtLink'), onpointerdown: keep, onclick: () => openLinkPop() }, h('span', { class: 'rt-link-ico', html: linkIco }), h('span', {}, t('rtLink')));
  const linkExisting = h('div', { class: 'rt-link-list' });
  const linkInText = h('input', { type: 'text', class: 'rt-link-inp', placeholder: t('rtLinkText'), 'data-testid': 'rt-link-text' });
  const linkInUrl = h('input', { type: 'url', class: 'rt-link-inp', placeholder: 'https://...', 'data-testid': 'rt-link-url' });
  const linkPop = h('div', { class: 'bx-pop rt-link-pop', hidden: true, 'data-testid': 'rt-link-pop' },
    h('div', { class: 'rt-link-sec' }, t('rtLinkExisting')),
    linkExisting,
    h('div', { class: 'rt-link-sep' }),
    h('div', { class: 'rt-link-sec' }, t('rtLinkNew')),
    h('div', { class: 'rt-link-row' },
      h('label', { class: 'rt-link-col' }, h('span', {}, t('rtLinkText')), linkInText),
      h('label', { class: 'rt-link-col' }, h('span', {}, t('rtLinkUrl')), linkInUrl)),
    h('div', { class: 'rt-link-acts' },
      h('button', { type: 'button', class: 'btn', 'data-testid': 'rt-link-rm', onclick: () => { linkPop.hidden = true; if (saved) { restore(); saved.ed.applyStyle({ link: null }); refresh(); } } }, t('rtLinkRemove')),
      h('div', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'rt-link-ok', onclick: () => {
        const tgt = (saved && saved.ed) || editors.find((e) => !e.badge) || editors[0];
        if (!tgt) return;
        linkPop.hidden = true;
        if (saved) restore(); else tgt.focusEnd && tgt.focusEnd();
        tgt.applyLinkEdit(linkInText.value, linkInUrl.value);
        refresh();
      } }, t('rtLinkApply'))));
  const renderLinkList = () => {
    linkExisting.textContent = '';
    const all = editors.flatMap((e) => (e.listLinks ? e.listLinks() : []));
    if (!all.length) { linkExisting.append(h('div', { class: 'rt-link-none' }, t('rtLinkEmpty'))); return; }
    for (const item of all) {
      const itTxt = h('input', { type: 'text', class: 'rt-link-inp', value: item.text });
      const itUrl = h('input', { type: 'url', class: 'rt-link-inp', value: item.link });
      const bSave = h('button', { type: 'button', class: 'btn', onclick: () => { item.ed.updateLinkAt(item.pi, item.a, item.b, itTxt.value, itUrl.value); renderLinkList(); refresh(); } }, t('rtLinkSave'));
      const bDel = h('button', { type: 'button', class: 'btn danger', onclick: () => { item.ed.updateLinkAt(item.pi, item.a, item.b, itTxt.value, ''); renderLinkList(); refresh(); } }, '×');
      linkExisting.append(h('div', { class: 'rt-link-item' }, itTxt, itUrl, bSave, bDel));
    }
  };
  const openLinkPop = (anchor = linkBtn) => {
    if (!linkPop.hidden) { linkPop.hidden = true; return; }
    if (cbPop && !cbPop.hidden) { cbPop.hidden = true; syncCbPop(); }
    const ed = current();
    if (ed) remember(); else saved = null;
    renderLinkList();
    const info = ed && ed.selectedInfo ? ed.selectedInfo() : null;
    linkInText.value = info ? info.text : '';
    linkInUrl.value = (info && info.link) || '';
    if (linkPop.parentNode !== document.body) {
      document.querySelectorAll('body > .rt-link-pop').forEach((n) => { if (n !== linkPop) n.remove(); });
      document.body.appendChild(linkPop);
    }
    linkPop.hidden = false;
    const r = anchor.getBoundingClientRect(), w = Math.min(520, window.innerWidth - 16);
    linkPop.style.width = w + 'px';
    linkPop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    linkPop.style.top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - linkPop.offsetHeight - 8)) + 'px';
  };
  const spacingBtn = h('button', { type: 'button', class: 'rt-btn rt-spacing', 'data-testid': 'rt-spacing', 'data-tip': t('rtSpacing'), 'aria-label': t('rtSpacing'), onpointerdown: keep, onclick: () => toggleSpacingPop() }, h('span', {}, t('rtSpacing')));
  let spDragCleanup = null;
  const setSpacingMode = (on) => {
    spacingBtn.classList.toggle('picking', !!on);
    const area = el.closest('.modal')?.querySelector('.te-area');
    if (!area) return;
    area.classList.toggle('te-spacing-mode', !!on);
    if (spDragCleanup) { spDragCleanup(); spDragCleanup = null; }
    if (!on) {
      area.querySelectorAll('.te-sp-hit').forEach((n) => n.classList.remove('te-sp-hit'));
      return;
    }
    const allParas = () => [...area.querySelectorAll('.te-para')];
    const paraNear = (node) => {
      const e = node && (node.nodeType === 1 ? node : node.parentElement);
      return e && (e.closest('.te-para') || e.closest('.te-paper')?.querySelector('.te-para') || e.closest('.te-row')?.querySelector('.te-para'));
    };
    // Preserve only an explicit multi-cell or non-collapsed browser text selection
    if (!area.querySelector('.te-para.te-sp-hit')) {
      const mr = getMultiRanges ? getMultiRanges() : null;
      if (mr && mr.length) {
        for (const r of mr) {
          const ps = r.ed && r.ed.paper ? [...r.ed.paper.querySelectorAll(':scope > .te-para')] : [];
          for (let i = r.i0; i <= r.i1; i++) ps[i]?.classList.add('te-sp-hit');
        }
      } else {
        const sel = getSelection();
        const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        if (r && !r.collapsed && area.contains(r.commonAncestorContainer)) {
          for (const p of allParas()) if (r.intersectsNode(p)) p.classList.add('te-sp-hit');
        }
      }
    }
    let startPara = null, multiDrag = false;
    const onDown = (e) => {
      if (e.button !== 0 || !area.classList.contains('te-spacing-mode')) return;
      startPara = paraNear(e.target);
      multiDrag = false;
      area.querySelectorAll('.te-sp-hit').forEach((n) => n.classList.remove('te-sp-hit'));
      const onMove = (ev) => {
        if (!startPara) return;
        const curP = paraNear(document.elementFromPoint(ev.clientX, ev.clientY));
        if (!curP) return;
        if (curP.closest('.te-paper, .te-badge') !== startPara.closest('.te-paper, .te-badge')) multiDrag = true;
        if (!multiDrag) return;
        getSelection()?.removeAllRanges();
        const ps = allParas();
        const i0 = ps.indexOf(startPara), i1 = ps.indexOf(curP);
        if (i0 < 0 || i1 < 0) return;
        const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
        ps.forEach((p, idx) => p.classList.toggle('te-sp-hit', idx >= lo && idx <= hi));
      };
      const onUp = () => {
        if (!multiDrag) {
          const ed = current();
          if (ed && ed.getRangeBounds) {
            const b = ed.getRangeBounds();
            if (b) for (let i = b.i0; i <= b.i1; i++) b.paras[i]?.classList.add('te-sp-hit');
          } else if (startPara) {
            startPara.classList.add('te-sp-hit');
          }
        }
        startPara = null;
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
    };
    area.addEventListener('pointerdown', onDown, true);
    spDragCleanup = () => area.removeEventListener('pointerdown', onDown, true);
  };
  const minSafeLs = () => {
    const area = el.closest('.modal')?.querySelector('.te-area');
    const hits = area ? [...area.querySelectorAll('.te-para.te-sp-hit')] : [];
    const ed0 = current();
    const targets = hits.length ? hits : (hasLiveSelIn(ed0) ? [...ed0.paper.querySelectorAll(':scope > .te-para')] : allVisibleParas());
    if (!targets.length) return -10;
    let minAllowed = -10;
    for (const p of targets) {
      const cs = getComputedStyle(p);
      const fs = parseFloat(cs.fontSize) || 12;
      const lh = parseFloat(cs.lineHeight) || fs * 1.2;
      const slack = Math.max(0, Math.floor(lh - fs * 0.88));
      minAllowed = Math.max(minAllowed, -slack);
    }
    return minAllowed;
  };
  const currentSpacingVal = () => {
    const area = el.closest('.modal')?.querySelector('.te-area');
    const hits = area ? [...area.querySelectorAll('.te-para.te-sp-hit')] : [];
    if (hits.length) {
      const vals = hits.map((p) => Number(p.dataset.ls) || 0);
      return vals.every((v) => v === vals[0]) ? vals[0] : 0;
    }
    const ed = current();
    if (ed && hasLiveSelIn(ed)) {
      const s = ed.selectionStyle() || {};
      return Number(s.ls) || 0;
    }
    const ps = allVisibleParas();
    if (ps.length) {
      const vals = ps.map((p) => Number(p.dataset.ls) || 0);
      if (vals.every((v) => v === vals[0])) return vals[0];
    }
    return 0;
  };
  const applySpacingVal = (raw) => {
    const minLs = minSafeLs();
    const v = Math.max(minLs, Math.min(30, Math.round(Number(raw) || 0)));
    const area = el.closest('.modal')?.querySelector('.te-area');
    const hits = area ? [...area.querySelectorAll('.te-para.te-sp-hit')] : [];
    const mr = getMultiRanges ? getMultiRanges() : null;
    let applied = false;
    if (hits.length) {
      for (const p of hits) {
        const ed = editors.find((e) => e.paper && e.paper.contains(p));
        if (ed && ed.applyLsToPara && ed.applyLsToPara(p, v)) applied = true;
      }
    } else if (mr && mr.length) {
      for (const r of mr) if (r.ed && r.ed.applyStyle({ ls: v }, r)) applied = true;
      if (applied && onMultiApplied) onMultiApplied();
    } else {
      const ed = current();
      if (ed && hasLiveSelIn(ed)) {
        applied = ed.applyStyle({ ls: v });
      } else if (saved && !saved.collapsed && saved.sel && saved.ed && !saved.ed.badge) {
        applied = saved.ed.applyStyle({ ls: v }, saved.sel);
      } else {
        for (const e of allVisibleNonBadgeEds()) {
          for (const p of e.paper.querySelectorAll(':scope > .te-para')) {
            if (e.applyLsToPara && e.applyLsToPara(p, v)) applied = true;
          }
        }
      }
    }
    if (!applied) return;
    refresh();
    syncSpacingPop(v);
  };
  const spDec = h('button', { type: 'button', class: 'rt-sp-step', 'data-testid': 'rt-sp-dec', 'aria-label': '-' }, '−');
  const spInput = h('input', {
    type: 'number', class: 'rt-sp-inp', min: '-10', max: '30', step: '1', value: '0', 'data-testid': 'rt-sp-input',
    oninput: () => {
      const n = Number(spInput.value);
      if (spInput.value !== '' && spInput.value !== '-' && Number.isFinite(n)) applySpacingVal(n);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applySpacingVal(spInput.value); spacingPop.hidden = true; setSpacingMode(false); }
      else if (e.key === 'Escape') { e.preventDefault(); spacingPop.hidden = true; setSpacingMode(false); }
    },
  });
  const spInc = h('button', { type: 'button', class: 'rt-sp-step', 'data-testid': 'rt-sp-inc', 'aria-label': '+' }, '+');
  bindHoldRepeat(spDec, () => applySpacingVal((Number(spInput.value) || 0) - 1));
  bindHoldRepeat(spInc, () => applySpacingVal((Number(spInput.value) || 0) + 1));
  const spacingPop = h('div', { class: 'bx-pop rt-sp-pop', hidden: true, 'data-testid': 'rt-sp-pop' }, spDec, spInput, spInc);
  const syncSpacingPop = (curVal) => {
    const minLs = minSafeLs();
    const v = Math.max(minLs, Math.min(30, Math.round(Number(curVal) || 0)));
    spInput.value = String(v);
    spDec.disabled = v <= minLs;
    spInc.disabled = v >= 30;
  };
  const toggleSpacingPop = () => {
    if (!spacingPop.hidden) { spacingPop.hidden = true; setSpacingMode(false); return; }
    if (cbPop && !cbPop.hidden) { cbPop.hidden = true; syncCbPop(); }
    const ed = current();
    if (ed) remember();
    else saved = null;
    syncSpacingPop(currentSpacingVal());
    if (spacingPop.parentNode !== document.body) {
      document.querySelectorAll('body > .rt-sp-pop').forEach((n) => { if (n !== spacingPop) n.remove(); });
      document.body.appendChild(spacingPop);
    }
    spacingPop.hidden = false;
    setSpacingMode(true);
    const r = spacingBtn.getBoundingClientRect();
    spacingPop.style.left = Math.max(8, Math.min(window.innerWidth - 96, r.left)) + 'px';
    spacingPop.style.top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - spacingPop.offsetHeight - 8)) + 'px';
  };
  const SVG_ALIGN = 'viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const ALIGN_ICONS = {
    left: `<svg ${SVG_ALIGN}><path d="M3 4.5h12M3 7.5h8M3 10.5h11M3 13.5h7"/></svg>`,
    center: `<svg ${SVG_ALIGN}><path d="M3 4.5h12M5 7.5h8M3.5 10.5h11M5.5 13.5h7"/></svg>`,
    right: `<svg ${SVG_ALIGN}><path d="M3 4.5h12M7 7.5h8M4 10.5h11M8 13.5h7"/></svg>`,
    justify: `<svg ${SVG_ALIGN}><path d="M3 4.5h12M3 7.5h12M3 10.5h12M3 13.5h12"/></svg>`,
    top: `<svg ${SVG_ALIGN}><path d="M3.5 3.5h11M9 6.5v8.5M6 9.5l3-3 3 3"/></svg>`,
    middle: `<svg ${SVG_ALIGN}><path d="M3.5 9h11M9 2.5v4.5M6.5 4.8L9 7.2l2.5-2.4M9 15.5V11M6.5 13.2L9 10.8l2.5 2.4"/></svg>`,
    bottom: `<svg ${SVG_ALIGN}><path d="M3.5 14.5h11M9 3v8.5M6 8.5l3 3 3-3"/></svg>`,
  };
  const alignBtn = h('button', { type: 'button', class: 'rt-btn rt-spacing rt-align', 'data-testid': 'rt-align', 'data-tip': t('rtAlign'), 'aria-label': t('rtAlign'), onpointerdown: keep, onclick: () => toggleAlignPop() }, h('span', {}, t('rtAlign')));
  const alignHBtns = new Map();
  const alignVBtns = new Map();
  const curAlignState = () => {
    if (getAlignState) return getAlignState() || { hAlign: null, vAlign: null };
    const mr = getMultiRanges ? getMultiRanges() : null;
    const ed = current();
    const eds = (mr && mr.length)
      ? mr.map((r) => r.ed).filter(Boolean)
      : (hasLiveSelIn(ed) ? [ed] : allVisibleNonBadgeEds());
    if (!eds.length) return { hAlign: null, vAlign: null };
    const hVals = eds.map((e) => {
      const ha = e.getAlign ? e.getAlign() : undefined;
      return ha === undefined ? ((e.model && e.model.align) || 'left') : ha;
    });
    const vVals = eds.map((e) => (e.el && e.el.dataset && e.el.dataset.valign) || null);
    return {
      hAlign: hVals[0] != null && hVals.every((v) => v === hVals[0]) ? hVals[0] : null,
      vAlign: vVals[0] != null && vVals.every((v) => v === vVals[0]) ? vVals[0] : null,
    };
  };
  const syncAlignPop = () => {
    const stA = curAlignState();
    for (const [k, btn] of alignHBtns) btn.classList.toggle('on', stA.hAlign === k);
    for (const [k, btn] of alignVBtns) btn.classList.toggle('on', stA.vAlign === k);
    alignBtn.classList.toggle('on', !alignPop.hidden || !!(stA.hAlign && stA.hAlign !== 'left') || !!stA.vAlign);
  };
  const applyAlignAction = (payload) => {
    if (onAlign) {
      onAlign(payload);
    } else {
      const mr = getMultiRanges ? getMultiRanges() : null;
      if (mr && mr.length) {
        if (payload.hAlign) {
          for (const r of mr) r.ed?.setAlign?.(payload.hAlign, { range: r });
          onMultiApplied && onMultiApplied();
        }
      } else {
        const ed = current();
        const hasLive = ed && hasLiveSelIn(ed);
        const hasSavedLive = !hasLive && saved && !saved.collapsed && saved.r && saved.ed && !saved.ed.badge;
        if (hasLive) {
          if (payload.hAlign) ed.setAlign?.(payload.hAlign, { range: ed.getRangeBounds() });
          if (payload.vAlign && ed.el) ed.el.dataset.valign = payload.vAlign;
        } else if (hasSavedLive) {
          restore();
          if (payload.hAlign) saved.ed.setAlign?.(payload.hAlign, { range: saved.ed.getRangeBounds() });
          if (payload.vAlign && saved.ed.el) saved.ed.el.dataset.valign = payload.vAlign;
        } else {
          for (const e of allVisibleNonBadgeEds()) {
            if (payload.hAlign) e.setAlign?.(payload.hAlign);
            if (payload.vAlign && e.el) e.el.dataset.valign = payload.vAlign;
          }
        }
      }
    }
    refresh();
    syncAlignPop();
  };
  const mkPopAlignBtn = (testid, tipKey, iconKey, map, payload) => {
    const label = t(tipKey);
    const btn = h('button', {
      type: 'button', class: 'ae-align-btn', 'data-testid': testid, title: label, 'aria-label': label,
      html: ALIGN_ICONS[iconKey], onpointerdown: keep, onclick: (e) => { e.stopPropagation(); applyAlignAction(payload); },
    });
    map.set(iconKey, btn);
    return btn;
  };
  const alignPop = h('div', { class: 'bx-pop rt-align-pop', hidden: true, 'data-testid': 'rt-align-pop' },
    h('div', { class: 'rt-align-title' }, t('tblTextAlign')),
    h('div', { class: 'ae-align-grid-4' },
      mkPopAlignBtn('rt-align-left', 'tblAlignLeft', 'left', alignHBtns, { hAlign: 'left' }),
      mkPopAlignBtn('rt-align-center', 'tblAlignCenter', 'center', alignHBtns, { hAlign: 'center' }),
      mkPopAlignBtn('rt-align-right', 'tblAlignRight', 'right', alignHBtns, { hAlign: 'right' }),
      mkPopAlignBtn('rt-align-justify', 'tblAlignJustify', 'justify', alignHBtns, { hAlign: 'justify' })),
    h('div', { class: 'ae-align-grid' },
      mkPopAlignBtn('rt-valign-top', 'tblValignTop', 'top', alignVBtns, { vAlign: 'top' }),
      mkPopAlignBtn('rt-valign-middle', 'tblValignMiddle', 'middle', alignVBtns, { vAlign: 'middle' }),
      mkPopAlignBtn('rt-valign-bottom', 'tblValignBottom', 'bottom', alignVBtns, { vAlign: 'bottom' })));
  const toggleAlignPop = () => {
    if (!alignPop.hidden) { alignPop.hidden = true; syncAlignPop(); return; }
    if (!spacingPop.hidden) { spacingPop.hidden = true; setSpacingMode(false); }
    if (!linkPop.hidden) linkPop.hidden = true;
    if (cbPop && !cbPop.hidden) { cbPop.hidden = true; syncCbPop(); }
    const ed = current();
    if (ed) remember();
    if (alignPop.parentNode !== document.body) {
      document.querySelectorAll('body > .rt-align-pop').forEach((n) => { if (n !== alignPop) n.remove(); });
      document.body.appendChild(alignPop);
    }
    alignPop.hidden = false;
    syncAlignPop();
    const r = alignBtn.getBoundingClientRect();
    alignPop.style.left = Math.max(8, Math.min(window.innerWidth - 184, r.left)) + 'px';
    alignPop.style.top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - alignPop.offsetHeight - 8)) + 'px';
  };
  let cbBtn = null, cbPop = null;
  let syncCbPop = () => {};
  if (onCheckBox) {
    const CB_ICONS = {
      square: `<svg viewBox="0 0 16 14" width="14" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="2" width="10" height="10" rx="1.8"/></svg>`,
      rect: `<svg viewBox="0 0 20 14" width="18" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="1.5" y="2" width="17" height="10" rx="1.8"/></svg>`,
      circle: `<svg viewBox="0 0 16 14" width="14" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="7" r="5"/></svg>`,
    };
    const CB_COLORS = ['#334155', '#111827', '#d62828', '#2563eb', '#16a34a'];
    const cbState = { shape: 'square', bc: '#334155', clearOther: true };
    cbBtn = h('button', { type: 'button', class: 'rt-btn rt-spacing rt-cb', 'data-testid': 'rt-cb', 'data-tip': t('cbTitle'), 'aria-label': t('cbTitle'), onpointerdown: keep, onclick: () => toggleCbPop() }, h('span', {}, t('cbBtn')));
    const posBtns = new Map();
    const shapeBtns = new Map();
    const bcSwatches = new Map();
    const clearOtherInp = h('input', { type: 'checkbox', checked: true, 'data-testid': 'rt-cb-clear-other' });
    clearOtherInp.addEventListener('change', () => { cbState.clearOther = !!clearOtherInp.checked; });
    const curCb = () => {
      const s0 = getCheckBoxState ? getCheckBoxState() : null;
      return { pos: s0 ? s0.pos : 'none', shape: (s0 && s0.shape) || cbState.shape, bc: (s0 && s0.bc) || cbState.bc, fromOrig: !!(s0 && s0.fromOrig) };
    };
    syncCbPop = () => {
      const stC = curCb();
      for (const [k, btn] of posBtns) btn.classList.toggle('on', stC.pos === k);
      for (const [k, btn] of shapeBtns) btn.classList.toggle('on', stC.shape === k);
      for (const [k, swBtn] of bcSwatches) swBtn.classList.toggle('on', stC.bc.toLowerCase() === k);
      cbBtn.classList.toggle('on', !cbPop.hidden || !!(stC.pos && stC.pos !== 'none' && !stC.fromOrig));
    };
    const fireCb = (patch) => {
      const cur = curCb();
      const pos = 'pos' in patch ? patch.pos : (cur.pos && cur.pos !== 'none' ? cur.pos : 'right');
      if ('shape' in patch) cbState.shape = patch.shape; else if (cur.shape) cbState.shape = cur.shape;
      if ('bc' in patch) cbState.bc = patch.bc; else if (cur.bc) cbState.bc = cur.bc;
      onCheckBox({ pos, shape: cbState.shape, bc: cbState.bc, clearOther: cbState.clearOther });
      refresh();
      syncCbPop();
    };
    const mkPosBtn = (k, labelKey) => {
      const b = h('button', { type: 'button', class: 'rt-cb-btn', 'data-testid': 'rt-cb-pos-' + k, onpointerdown: keep, onclick: (e) => { e.stopPropagation(); fireCb({ pos: k }); } }, t(labelKey));
      posBtns.set(k, b);
      return b;
    };
    const mkShapeBtn = (k, labelKey) => {
      const b = h('button', { type: 'button', class: 'rt-cb-btn', 'data-testid': 'rt-cb-shape-' + k, onpointerdown: keep, onclick: (e) => { e.stopPropagation(); fireCb({ shape: k }); } }, h('span', { html: CB_ICONS[k] }), h('span', {}, t(labelKey)));
      shapeBtns.set(k, b);
      return b;
    };
    const bcSwWrap = h('div', { class: 'rt-swatches' },
      ...CB_COLORS.map((c) => {
        const b = h('button', { type: 'button', class: 'rt-sw', 'data-testid': 'rt-cb-bc', 'data-color': c, style: { background: c }, onpointerdown: keep, onclick: (e) => { e.stopPropagation(); fireCb({ bc: c }); } });
        bcSwatches.set(c, b);
        return b;
      }),
      customSwatch({ testid: 'rt-cb-bc-custom', value: cbState.bc, onPick: (c) => fireCb({ bc: c }) }));
    cbPop = h('div', { class: 'bx-pop rt-cb-pop', hidden: true, 'data-testid': 'rt-cb-pop' },
      h('div', { class: 'rt-align-title' }, t('cbTitle')),
      h('div', { class: 'rt-cb-row' }, h('span', { class: 'rt-cb-lab' }, t('cbPos')), h('div', { class: 'rt-cb-seg' }, mkPosBtn('none', 'cbPosNone'), mkPosBtn('left', 'cbPosLeft'), mkPosBtn('right', 'cbPosRight'))),
      h('div', { class: 'rt-cb-row' }, h('span', { class: 'rt-cb-lab' }, t('cbShape')), h('div', { class: 'rt-cb-seg' }, mkShapeBtn('square', 'cbSquare'), mkShapeBtn('rect', 'cbRect'), mkShapeBtn('circle', 'cbCircle'))),
      h('div', { class: 'rt-cb-row' }, h('span', { class: 'rt-cb-lab' }, t('cbBorder')), bcSwWrap),
      h('label', { class: 'rt-cb-opt' }, clearOtherInp, h('span', {}, t('cbClearOther'))),
      h('div', { class: 'rt-link-sep' }),
      h('div', { class: 'rt-cb-clean-row' },
        h('button', { type: 'button', class: 'rt-cb-clean', 'data-testid': 'rt-cb-clean-before', title: t('cbCleanBeforeTip'), onpointerdown: keep, onclick: (e) => { e.stopPropagation(); onCleanCheckBox && onCleanCheckBox('before'); syncCbPop(); } }, t('cbCleanBefore')),
        h('button', { type: 'button', class: 'rt-cb-clean', 'data-testid': 'rt-cb-clean-after', title: t('cbCleanAfterTip'), onpointerdown: keep, onclick: (e) => { e.stopPropagation(); onCleanCheckBox && onCleanCheckBox('after'); syncCbPop(); } }, t('cbCleanAfter'))),
      ...(onSmartOrderCheckBox ? [
        h('div', { class: 'rt-link-sep' }),
        h('div', { class: 'rt-cb-row rt-cb-sort-row' },
          h('span', { class: 'rt-cb-lab rt-cb-sort-lab' }, t('smartOrder')),
          h('div', { class: 'ae-sort-pair rt-cb-sort-pair' },
            h('button', { type: 'button', class: 'ae-sort-pill num', 'data-testid': 'rt-cb-sort-num', onpointerdown: keep, onclick: (e) => { e.stopPropagation(); onSmartOrderCheckBox('num'); refresh(); syncCbPop(); } }, '1, 2, 3…'),
            h('button', { type: 'button', class: 'ae-sort-pill alpha', 'data-testid': 'rt-cb-sort-alpha', onpointerdown: keep, onclick: (e) => { e.stopPropagation(); onSmartOrderCheckBox('alpha'); refresh(); syncCbPop(); } }, 'a, b, c…'))),
      ] : []));
  }
  const toggleCbPop = () => {
    if (!cbPop) return;
    if (!cbPop.hidden) { cbPop.hidden = true; syncCbPop(); return; }
    if (!alignPop.hidden) { alignPop.hidden = true; syncAlignPop(); }
    if (!spacingPop.hidden) { spacingPop.hidden = true; setSpacingMode(false); }
    if (!linkPop.hidden) linkPop.hidden = true;
    if (cbPop.parentNode !== document.body) {
      document.querySelectorAll('body > .rt-cb-pop').forEach((n) => { if (n !== cbPop) n.remove(); });
      document.body.appendChild(cbPop);
    }
    cbPop.hidden = false;
    syncCbPop();
    const r = cbBtn.getBoundingClientRect();
    cbPop.style.left = Math.max(8, Math.min(window.innerWidth - 300, r.left)) + 'px';
    cbPop.style.top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - cbPop.offsetHeight - 8)) + 'px';
  };
  const onDocDown = (e) => {
    if (!fontWrap.contains(e.target)) list.hidden = true;
    if (!linkPop.hidden && !linkPop.contains(e.target) && !e.target.closest('[data-testid="rt-link"]')) linkPop.hidden = true;
    if (!alignPop.hidden && !alignPop.contains(e.target) && !alignBtn.contains(e.target)) { alignPop.hidden = true; syncAlignPop(); }
    if (cbPop && !cbPop.hidden && !cbPop.contains(e.target) && !cbBtn.contains(e.target)) { cbPop.hidden = true; syncCbPop(); }
    const area = el.closest('.modal')?.querySelector('.te-area');
    if (!spacingPop.hidden && !spacingPop.contains(e.target) && !spacingBtn.contains(e.target) && !(area && area.contains(e.target))) { spacingPop.hidden = true; setSpacingMode(false); }
  };
  document.addEventListener('pointerdown', onDocDown, true);
  const el = h('div', { class: 'rt-bar', 'data-testid': 'rt-bar' }, ...lead, h('div', { class: 'rt-group' }, bB, bI, bU, bSup, bSub), sw, ...mid, spacingBtn, alignBtn, ...(cbBtn ? [cbBtn] : []), ...afterSpacing, h('div', { class: 'rt-group' }, smaller, ...(sizeField ? [sizeWrap] : []), bigger), ...(fontInTools ? [] : [fontWrap]), ...(linkInTools ? [] : [linkBtn]), ...tail);
  function refresh() {
    const ed = current();
    const mr = !ed && getMultiRanges ? getMultiRanges() : null;
    const tsFallback = !ed && (!mr || !mr.length) ? targets() : [];
    const s = ed ? ed.selectionStyle() || {}
      : (mr && mr.length && mr[0].ed ? mr[0].ed.selectionStyle(mr[0]) || {}
        : ((tsFallback[0] && tsFallback[0].ed && tsFallback[0].ed.selectionStyle && tsFallback[0].ed.selectionStyle(tsFallback[0].range)) || {}));
    linkBtn.classList.toggle('on', !!(s && s.link));
    const curLs = currentSpacingVal();
    spacingBtn.classList.toggle('on', !!((s && Number(s.ls)) || (!hasLiveSelIn(ed) && curLs)));
    syncAlignPop();
    syncCbPop();
    if (!spacingPop.hidden && document.activeElement !== spInput) {
      syncSpacingPop(curLs);
    }
    bB.classList.toggle('on', !!s.b); bI.classList.toggle('on', !!s.i); bU.classList.toggle('on', !!s.u);
    bSup.classList.toggle('on', s.v === 'sup'); bSub.classList.toggle('on', s.v === 'sub');
    fontLabel.textContent = nameOf(s.f || null);
    if (sizeField && document.activeElement !== sizeInp) {
      // the selection's size; nothing selected: the whole text's size; blank when mixed
      const ts = targets();
      let v = null, mixed = false;
      for (const x of ts) {
        const z = x.ed.sizeOf ? x.ed.sizeOf(x.range) : null;
        if (z === null) { mixed = true; break; }
        if (v === null) v = z; else if (Math.abs(v - z) > 0.05) { mixed = true; break; }
      }
      sizeInp.value = !mixed && v !== null ? String(v) : '';
      sizeShown = sizeInp.value;
      // the font of the same text: one name, or blank-ish when mixed
      let f, fMixed = false;
      for (const x of ts) {
        const g = x.ed.fontOf ? x.ed.fontOf(x.range) : undefined;
        if (g === undefined) continue;
        if (g === null || (f !== undefined && f !== g)) { fMixed = true; break; }
        f = g;
      }
      if (fMixed) fontLabel.textContent = t('rtFontMixed');
      else if (f !== undefined) fontLabel.textContent = nameOf(f || null);
    }
  }
  const onSel = () => { trackSel(); refresh(); };
  document.addEventListener('selectionchange', onSel);
  return { el, fontEl: fontWrap, cbBtn, openLinkPop, clearAllStyle, destroy: () => {
    document.removeEventListener('selectionchange', onSel);
    document.removeEventListener('pointerdown', onDocDown, true);
    if (spDragCleanup) { try { spDragCleanup(); } catch { /* */ } }
    spacingPop.remove(); alignPop.remove(); linkPop.remove(); if (cbPop) cbPop.remove();
  } };
}
