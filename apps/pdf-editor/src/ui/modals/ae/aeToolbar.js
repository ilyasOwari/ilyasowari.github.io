// Top toolbars (Row 1 actions, Row 2 rich text formatting), context menu, keyboard shortcuts & Apply
import { h } from '../../common/dom.js';
import { t } from '../../../i18n/i18n.js';
import { icon } from '../../../../assets/icons/icons.js';
import { openModal } from '../../common/modal.js';
import { toast } from '../../common/toast.js';
import { openAllModels } from '../../../engines/text/editSession.js';
import { richToolbar } from '../richToolbar.js';
import { boxControl, emptyBox, boxActive } from '../boxControl.js';
import { createAlignHandlers } from './aeAlign.js';
import { createCheckBoxHandlers } from './aeCheckBox.js';
import { bindOcrEnclosure, ocrPatchesOf, suppressUnderlyingOcrText, applySectionBoxStyle } from './aeOcr.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export function setupAeToolbar(st) {
  const {
    an, fonts, man, doc, textArea, stage, guides, R, O, pad,
    objs, sections, allEds, nonBadgeEds, boxCfg, lettering,
    isUnit, cropable, scaleOf, partOf, place, wireObjEl, makeSectionEditor,
    cloneParas, deleteSectionCell, commitSnap, undo, redo, flushTextSync,
    syncSlotBox, scheduleTypeSnap, clearTimers,
    del, toggleCrop, replacePhoto, zorder, select, enterPanMode, exitPanMode,
    applyCoverImageToObj, bakeCroppedImage, bakePlaceholderImage, fitInto,
    visibleEdsInOrder, renderMultiRanges, textTarget,
    ready, onApply,
  } = st;

  stage.dataset.map = JSON.stringify({ x: O.x, y: O.y, k: st.k }); // stage px <-> page pt (tests)
  const B = (key, ic, label, fn) => h('button', { class: 'btn', 'data-testid': 'ae-' + key, onclick: fn, html: icon(ic, 'icon icon-sm') + `<span>${label}</span>` });
  // a new item goes to the middle of what the user sees of the stage (mapped
  // to page coordinates), kept inside the area
  function viewCenterSpot(w, h) {
    // visible part of the stage = its rect cut by every clipping ancestor
    const a = stage.getBoundingClientRect();
    let x0 = a.left, x1 = a.right, y0 = a.top, y1 = a.bottom;
    for (let e = stage.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = e.getBoundingClientRect();
      x0 = Math.max(x0, r.left); x1 = Math.min(x1, r.right); y0 = Math.max(y0, r.top); y1 = Math.min(y1, r.bottom);
    }
    x0 = Math.max(x0, 0); y0 = Math.max(y0, 0); x1 = Math.min(x1, innerWidth); y1 = Math.min(y1, innerHeight);
    const cx = x1 > x0 ? (x0 + x1) / 2 : (a.left + a.right) / 2, cy = y1 > y0 ? (y0 + y1) / 2 : (a.top + a.bottom) / 2;
    const px = O.x + (cx - a.left) / st.k, py = O.y + (cy - a.top) / st.k;
    const clamp = (v0, lo, hi) => (hi < lo ? lo : Math.max(lo, Math.min(hi, v0)));
    return { x: clamp(px - w / 2, R.x, R.x + R.w - w), y: clamp(py - h / 2, R.y, R.y + R.h - h) };
  }
  const markFresh = (o) => { objs.forEach((z) => z.el && z.el.classList.remove('ae-fresh')); o.el.classList.add('ae-fresh'); };

  // the first added text opens the stage / text list and resizes the dialog:
  // let that layout settle first so the visible middle is measured right
  function addTextSection() {
    if (sections.length > 0 && !st.photoGridUi && !lettering) st.insertSideMode = true;
    if (!scrollWrap.hidden) {
      syncLayout();
      requestAnimationFrame(() => requestAnimationFrame(() => addTextNow()));
      return;
    }
    st.stageSoon = true; syncLayout();
    requestAnimationFrame(() => requestAnimationFrame(() => { addTextNow(); st.stageSoon = false; }));
  }
  // seed (Metin tara): { x, y, w, size, text, style } in page pt; placed as
  // given, filled with the recognized text, not focused
  function addTextNow(seed = null) {
    if (!seed) commitSnap();
    const tgtEd = textTarget();
    const refSec = (tgtEd && sections.find((s) => s.ed === tgtEd && !s.badge)) || sections.find((s) => !s.badge) || sections[0];
    const refG = (refSec && refSec.model && (refSec.model.origCharGlyph.find(Boolean) || refSec.model.refGlyph))
      || (an && an.seg && an.seg.glyphs && (an.seg.glyphs.find((g) => !g.space && g.g && g.g.font && g.g.hsize >= 9 && g.g.hsize <= 16) || an.seg.glyphs.find((g) => !g.space && g.g && g.g.font)))
      || null;
    const refObj = (refSec && !refSec.o.deleted && refSec.o) || objs.find((x) => !x.deleted && x.type === 'text' && !x.badge) || null;
    const sc0 = refObj ? scaleOf(refObj) : 1;
    const rawSz = (refG && refG.g && refG.g.hsize) || 11;
    const sz = seed ? Math.max(6, Math.min(144, seed.size / sc0)) : Math.max(9.5, Math.min(14, rawSz));
    const nLines = seed ? Math.max(1, seed.lineCount || (seed.lines ? seed.lines.length : 1)) : 1;
    const lineStep = seed ? ((seed.lineStep || seed.size * 1.25) / sc0) : sz * 1.25;
    const dh = Math.round((nLines - 1) * lineStep + sz * 1.4), h0 = dh * sc0;
    const initW = seed ? seed.w : Math.min(R.w - 16, Math.max(90, 150));
    const spot = seed ? { x: seed.x, y: seed.y } : viewCenterSpot(Math.min(initW, R.w), h0);
    const x = spot.x, y = spot.y;
    const availW = seed ? Math.max(16, initW) : Math.max(80, R.x + R.w - x - 6);
    const baseW = availW / sc0;
    const dw = Math.min(baseW, initW / sc0), w = dw * sc0;
    const src = { x: R.x + (x - R.x) / sc0, y: R.y + (y - R.y) / sc0, w: dw, h: dh };
    const o = {
      id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      type: 'text', addedText: true, refGlyphIdx: refG ? refG.idx : -1, fontSize: sz, baseW,
      ...(seed ? { ocr: true, ocrGroup: seed._groupId, ocrPatchFlat: !!seed.flat, ocrBgHex: seed.bgHex || undefined, origLines: nLines, lineStep } : {}),
      src: { ...src }, full: { ...src }, keep: [], keepG: [], edit: null, nine: null, k: sc0, dw, dh, x, y, w, h: h0,
    };
    o._base = { src: { ...o.src }, full: { ...o.full }, keepG: [], edit: null, dw, dh, w, h: h0, x, y };
    o._origPart = partOf(o);
    o.el = h('div', { class: 'ae-obj ae-text ae-added-text', 'data-testid': 'ae-obj', 'data-type': 'text', 'data-oid': o.id });
    o.view = h('div', { class: 'ae-view' });
    o.canvas = h('canvas'); o.view.append(o.canvas); o.el.append(o.view);
    wireObjEl(o);
    objs.push(o); stage.insertBefore(o.el, guides); place(o); if (!seed) markFresh(o);
    const model = openAllModels(an, o._origPart)[0];
    const sec = { o, model, badge: false, maxGrowX: 0, maxGrowY: Infinity, y: o.y, x: o.x };
    sec.ed = makeSectionEditor(sec);
    sec.lastSyncedParas = cloneParas(model.paras);
    const rowEl = h('div', { class: 'te-row' }, sec.ed.el);
    sec.rowEl = rowEl;
    doc.append(rowEl);
    sections.push(sec);
    allEds.push(sec.ed);
    nonBadgeEds.push(sec.ed);
    if (!body.contains(textArea)) body.append(textArea);
    if (seed) {
      const style = { ...seed.style, z: Math.round((seed.size / sc0) * 10) / 10 };
      const lsText = seed.lines && seed.lines.length ? seed.lines : seed.text.split('\n');
      sec.ed.setParas(lsText.map((txt) => ({ text: txt, marker: false, ...(txt.length ? { st: [{ a: 0, b: txt.length, s: { ...style } }] } : {}) })));
      st.touchedTextObjs.add(o);
      return o;
    }
    select(o);
    syncLayout();
    sec.ed.placeMarks();
    o.el.scrollIntoView({ block: 'nearest' });
    sec.ed.el.scrollIntoView({ block: 'nearest' });
    st.focusedEd = sec.ed; st.lastEditTarget = sec.ed;
    sec.ed.focusEnd();
    commitSnap();
  }
  // Metin tara: the recognized text as added text items; where the original
  // pixels were cleaned, a patch (picture of the cleaned background) lies
  // under the item - deleting the item removes its patch again
  async function addOcrSeeds(seeds) {
    let n = 0, firstSec = null;
    for (const sd of seeds) {
      const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      sd._groupId = gid;
      const patchList = sd.patches && sd.patches.length ? sd.patches : (sd.patch ? [sd.patch] : []);
      const patches = [];
      for (const sp of patchList) {
        const pid = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const pt = { id: pid, type: 'img', ocrPatch: true, ocrGroup: gid, img: { dataUrl: sp.dataUrl, anchor: 0, wrap: false, width: 1 }, x: sp.x, y: sp.y, w: sp.w, h: sp.h, keep: [], keepG: [] };
        pt._base = { x: pt.x, y: pt.y, w: pt.w, h: pt.h };
        pt.el = h('div', { class: 'ae-obj ae-img ae-ocr-patch', 'data-testid': 'ae-ocr-patch', 'data-type': 'img', 'data-oid': pid });
        pt.view = h('div', { class: 'ae-view' }, h('img', { src: sp.dataUrl, draggable: 'false' })); pt.el.append(pt.view);
        objs.push(pt); stage.insertBefore(pt.el, guides); place(pt); patches.push(pt);
      }
      const o = addTextNow(sd);
      for (const pt of patches) pt._ocrOwner = o;
      o.ocrPatchObj = patches[0] || null; o.ocrPatchObjs = patches;
      o.el.classList.add('ae-ocr-text');
      bindOcrEnclosure(o, objs, an, R, { isUnit, pageLimitRight: st.pageLimitRight, pageLimitLeft: st.pageLimitLeft, scaleOf });
      suppressUnderlyingOcrText(o, sd.orig, objs, an, { isUnit, scaleOf, place, render: st.render });
      const sec = sections.find((x) => x.o === o);
      if (sec) { if (!firstSec) firstSec = sec; applySectionBoxStyle(sec, an, scaleOf, sd.style && sd.style.c); }
      n++;
    }
    syncLayout();
    allEds.forEach((ed) => { ed.fitToLines && ed.fitToLines(); ed.placeMarks(); });
    await flushTextSync({ renderPreview: true });
    if (firstSec && firstSec.ed) {
      st.focusedEd = firstSec.ed; st.lastEditTarget = firstSec.ed;
      firstSec.ed.el.scrollIntoView({ block: 'nearest' }); firstSec.ed.focusEnd();
      objs.forEach((x) => x.el.classList.toggle('editing', x === firstSec.o));
    }
    commitSnap();
    return n;
  }
  st.addOcrSeeds = addOcrSeeds;

  // ---- Metin tara: draw a rectangle on the stage, read it, add the text ----
  // real (editable) text in the area, in page/stage coordinates: glyphs of
  // the PDF text lines (by each object's source rect) and our own text items
  function realTextRects() {
    const out = [];
    const atoms = (an && an.seg && an.seg.textAtoms) || [];
    for (const o of objs) {
      if (o.deleted) continue;
      if (o.addedText || o.ocr) { out.push({ x: o.x, y: o.y, w: o.w, h: o.h }); continue; }
      if (!o.src || !(o.src.w > 0) || o.type === 'img') continue;
      const sx = o.w / o.src.w, sy = o.h / o.src.h;
      for (const l of atoms) {
        if (l.decor) continue;
        for (const g of l.glyphs) {
          if (g.space || !g.uni || /^[\s\uFFFD]*$/.test(g.uni)) continue;
          const cx = (g.b.x0 + g.b.x1) / 2, cy = (g.b.y0 + g.b.y1) / 2;
          if (cx < o.src.x || cx > o.src.x + o.src.w || cy < o.src.y || cy > o.src.y + o.src.h) continue;
          out.push({ x: o.x + (g.b.x0 - o.src.x) * sx, y: o.y + (g.b.y0 - o.src.y) * sy, w: (g.b.x1 - g.b.x0) * sx, h: (g.b.y1 - g.b.y0) * sy });
        }
      }
    }
    return out;
  }
  let ocrBusy = false;
  (st.cleanups ||= []).push(() => exitOcrMode());
  function exitOcrMode() {
    if (!st.ocrMode) return;
    st.ocrMode = false; scrollWrap.classList.remove('ae-ocr-mode'); bOcr.classList.remove('on');
    if (st.ocrHintEl) { st.ocrHintEl.remove(); st.ocrHintEl = null; }
    window.removeEventListener('keydown', ocrKey, true);
    window.removeEventListener('pointerdown', ocrDown, true);
  }
  function ocrKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (st.ocrDrag) st.ocrDrag.cancel(); exitOcrMode(); } }
  function enterOcrMode() {
    if (ocrBusy) return;
    if (st.ocrMode) { exitOcrMode(); return; }
    if (st.panMode) exitPanMode();
    if (scrollWrap.hidden) scrollWrap.hidden = false;
    st.ocrMode = true; scrollWrap.classList.add('ae-ocr-mode'); bOcr.classList.add('on');
    st.ocrHintEl = h('div', { class: 'ae-ocr-hint', 'data-testid': 'ae-ocr-hint' }, t('ocrHint'));
    stage.append(st.ocrHintEl);
    window.addEventListener('keydown', ocrKey, true);
    window.addEventListener('pointerdown', ocrDown, true);
  }
  // the drag may start anywhere on the preview (also its margin around the page area)
  function ocrDown(e) {
    if (!st.ocrMode || e.button !== 0 || !scrollWrap.contains(e.target)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const sr = stage.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    const mq = h('div', { class: 'ae-marquee ae-ocr-marquee', 'data-testid': 'ae-ocr-marquee' }); stage.append(mq);
    let rect = null, done = false;
    const mv = (ev) => {
      const lx0 = Math.min(sx, ev.clientX) - sr.left, ly0 = Math.min(sy, ev.clientY) - sr.top, lw = Math.abs(ev.clientX - sx), lh = Math.abs(ev.clientY - sy);
      Object.assign(mq.style, { left: lx0 + 'px', top: ly0 + 'px', width: lw + 'px', height: lh + 'px' });
      rect = { x: O.x + lx0 / st.k, y: O.y + ly0 / st.k, w: lw / st.k, h: lh / st.k };
    };
    const end = (ok) => {
      if (done) return; done = true; st.ocrDrag = null;
      window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
      mq.remove();
      if (!ok || !rect || rect.w * st.k < 4 || rect.h * st.k < 4) return;
      // only inside the area
      const x0 = Math.max(rect.x, R.x), y0 = Math.max(rect.y, R.y), x1 = Math.min(rect.x + rect.w, R.x + R.w), y1 = Math.min(rect.y + rect.h, R.y + R.h);
      if (x1 - x0 < 2 || y1 - y0 < 2) return;
      exitOcrMode();
      runOcr({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    };
    const up = () => end(true);
    st.ocrDrag = { cancel: () => end(false) };
    window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  }
  async function runOcr(rect) {
    ocrBusy = true; bOcr.disabled = true;
    const close = toast(t('ocrBusy'), { ms: 0 });
    let res = null;
    try {
      // what this session already read is covered on the stage: not again
      const skip = objs.filter((o) => o.ocrPatch && !o.deleted).map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
      res = await st.app.ocrSeeds(st.ctx.page, rect, { skip, textRects: realTextRects() });
    } catch (e) {
      console.error(e); close(); toast(t('ocrFail'), { error: true });
      ocrBusy = false; bOcr.disabled = false; return;
    }
    close(); ocrBusy = false; bOcr.disabled = false;
    if (!res.seeds.length) { toast(t(res.onlyReal ? 'ocrOnlyReal' : 'ocrNone')); return; }
    commitSnap();
    await addOcrSeeds(res.seeds);
  }
  const bOcr = B('ocr', 'scanText', t('ocrScan'), enterOcrMode);
  bOcr.dataset.tip = t('tipOcr');
  const bAddText = B('addtext', 'text', t('insertText'), addTextSection);
  const bDel = B('del', 'trash', t('del'), del), bCrop = B('crop', 'erase', t('aeCrop'), toggleCrop), bRep = B('replace', 'image', t('replacePhoto'), replacePhoto);
  const bAddImg = B('addimg', 'image', t('insertImage'), () => {
    const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg', 'data-testid': 'ae-addfile' });
    inp.style.display = 'none'; document.body.append(inp);
    inp.onchange = () => {
      const f = inp.files[0]; inp.remove(); if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image(); im.onload = () => {
          if (st.sel && st.sel.placeholder) {
            const target = st.sel;
            applyCoverImageToObj(target, rd.result, im);
            bakeCroppedImage(target);
            select(target); syncLayout(); commitSnap();
            return;
          }
          const o = { id: 'o' + Date.now().toString(36), type: 'img', img: { dataUrl: rd.result, anchor: 0, wrap: false, width: 1 }, x: R.x, y: R.y, w: im.naturalWidth, h: im.naturalHeight, keep: [], keepG: [] };
          fitInto(o, { x: R.x + R.w * 0.3, y: R.y + R.h * 0.3, w: R.w * 0.4, h: R.h * 0.4 });
          { const c = viewCenterSpot(o.w, o.h); o.x = c.x; o.y = c.y; }
          o.el = h('div', { class: 'ae-obj ae-img', 'data-testid': 'ae-obj', 'data-type': 'img', 'data-oid': o.id });
          o.view = h('div', { class: 'ae-view' }, h('img', { src: rd.result, draggable: 'false' })); o.el.append(o.view);
          wireObjEl(o);
          if (sections.length > 0 && !st.photoGridUi && !lettering) st.insertSideMode = true;
          objs.push(o); stage.insertBefore(o.el, guides); place(o); markFresh(o); syncLayout();
          // the view may change when the side layout opens: center again once it settled
          const recenter = () => { if (o.deleted || o.el.classList.contains('dragging')) return; const c = viewCenterSpot(o.w, o.h); o.x = c.x; o.y = c.y; place(o); syncSlotBox(); };
          recenter(); select(o); syncSlotBox();
          requestAnimationFrame(() => requestAnimationFrame(() => { recenter(); commitSnap(); }));
        }; im.src = rd.result;
      };
      rd.readAsDataURL(f);
    };
    inp.click();
  });
  // z-order of the selected object (image, stamp, text) among the overlapping
  // objects of the area: icon-only, the label is the tooltip
  const BI = (key, ic, label, fn) => h('button', { class: 'btn ae-ico', 'data-testid': 'ae-' + key, 'data-tip': label, 'aria-label': label, onclick: fn, html: icon(ic, 'icon icon-sm') });
  const bFront = BI('front', 'up', t('aeFront'), () => zorder(1)), bBack = BI('back', 'down', t('aeBack'), () => zorder(-1));

  let bxWordTarget = null;
  function findSelectedWordEditor() {
    const ordered = [st.focusedEd, st.lastEditTarget, ...allEds].filter((e, idx, arr) => e && arr.indexOf(e) === idx);
    for (const ed of ordered) {
      const live = ed.saveSelection();
      if (live) return { ed, range: live };
    }
    if (st.focusedEd && st.focusedEd._savedSel) return { ed: st.focusedEd, range: st.focusedEd._savedSel };
    for (const ed of ordered) if (ed._savedSel) return { ed, range: ed._savedSel };
    return null;
  }
  function wordBgAt(ed, range) {
    const ps = ed.value();
    const p = ps[range.i0];
    if (!p || !p.st) return null;
    for (const r of p.st) if (range.s0 >= r.a && range.s0 < r.b && r.s && r.s.bg) return clone(r.s.bg);
    return null;
  }
  const isFullTextSelected = () => {
    const eds = visibleEdsInOrder();
    if (!eds.length) return false;
    const isEdFull = (ed, r) => {
      const paras = [...ed.paper.children];
      const last = Math.max(0, paras.length - 1);
      const lastLen = paras[last] ? paras[last].textContent.length : 0;
      return r.i0 === 0 && r.s0 === 0 && r.i1 === last && r.e1 >= lastLen;
    };
    if (st.multiRanges.length) {
      return eds.every((ed) => st.multiRanges.some((r) => r.ed === ed && isEdFull(ed, r)));
    }
    const selWord = findSelectedWordEditor();
    return !!(selWord && eds.length === 1 && isEdFull(selWord.ed, selWord.range));
  };
  const bx = boxControl({
    box: { ...boxCfg },
    onOpen: () => {
      if (isFullTextSelected()) {
        bxWordTarget = null;
        return { ...boxCfg };
      }
      if (st.multiRanges.length) {
        bxWordTarget = { multi: true };
        return wordBgAt(st.multiRanges[0].ed, st.multiRanges[0]) || emptyBox();
      }
      bxWordTarget = findSelectedWordEditor();
      if (bxWordTarget) return wordBgAt(bxWordTarget.ed, bxWordTarget.range) || emptyBox();
      return { ...boxCfg };
    },
    onChange: (B2) => {
      if (bxWordTarget && bxWordTarget.multi) {
        const bg = boxActive(B2) ? { shape: B2.shape, fc: B2.fc, fo: B2.fo ?? 1, bc: B2.bc, bw: B2.bw ?? 1.5, bo: B2.bo ?? 1 } : null;
        for (const r of st.multiRanges) r.ed.applyStyle({ bg }, r);
        renderMultiRanges();
      } else if (bxWordTarget) {
        const bg = boxActive(B2) ? { shape: B2.shape, fc: B2.fc, fo: B2.fo ?? 1, bc: B2.bc, bw: B2.bw ?? 1.5, bo: B2.bo ?? 1 } : null;
        bxWordTarget.ed.applyStyle({ bg }, bxWordTarget.range);
      } else {
        Object.assign(boxCfg, B2);
        syncSlotBox();
        scheduleTypeSnap();
      }
    },
  });

  const scrollWrap = h('div', { class: 'ae-scroll' }, stage);

  const hasPhotos = () => objs.some((o) => !o.deleted && (o.type === 'photo' || o.type === 'img'));
  const shouldShowStage = () => hasPhotos() || lettering || sections.length === 0 || objs.some((o) => !o.deleted && o.addedText && !o.cell && !o.badge);

  const keepDown = (e) => e.preventDefault();
  const clearBlockBox = () => {
    Object.assign(boxCfg, emptyBox());
    bx.setBox(boxCfg);
    syncSlotBox();
  };
  const clearStyleBtn = h('button', {
    type: 'button',
    class: 'rt-btn rt-spacing',
    'data-testid': 'te-clear-style',
    'data-tip': t('tblClearStyleTip'),
    'aria-label': t('tblClearStyle'),
    onpointerdown: keepDown,
    onclick: () => (st.hasTable && st.clearTableStyle ? st.clearTableStyle({ clearBlockBox, renderMultiRanges }) : rt.clearAllStyle(clearBlockBox)),
  }, h('span', {}, t('tblClearStyle')));
  const leadBtn = h('button', { class: 'btn te-lead', 'data-testid': 'te-parastart', 'data-tip': t('paraHint'), onpointerdown: keepDown, onclick: () => { const ed = textTarget(); if (ed) ed.splitAtCaret(); }, html: icon('paragraph', 'icon icon-sm') + `<span>${t('paraStart')}</span>` });
  const leadSep = h('span', { class: 'rt-sep' });
  st.renderMultiRanges = renderMultiRanges;
  const { getAlignState, onAlign } = createAlignHandlers(st);
  const { getCheckBoxState, onCheckBox, onCleanCheckBox, onSmartOrderCheckBox } = createCheckBoxHandlers(st);
  let rt = richToolbar({ editors: allEds, fonts, man, lead: [leadBtn, leadSep], mid: [bx.el], afterSpacing: [clearStyleBtn], linkInTools: true, fontInTools: true, getMultiRanges: () => st.multiRanges, onMultiApplied: renderMultiRanges, sizeField: true, onAlign, getAlignState, onCheckBox, getCheckBoxState, onCleanCheckBox, onSmartOrderCheckBox });
  const rtBarRow = h('div', { class: 'ae-rt-tools' }, rt.el);
  rtBarRow.addEventListener('pointerdown', (e) => e.stopPropagation());

  function syncButtons() {
    const s = st.sel && !st.sel.deleted ? st.sel : null;
    const hasAny = !!s || st.multiSel.size > 0;
    bDel.disabled = !hasAny; bFront.disabled = !s; bBack.disabled = !s;
    bCrop.disabled = !s || !cropable(s); bCrop.classList.toggle('on', st.mode === 'crop');
    bRep.disabled = !s || (s.type !== 'photo' && s.type !== 'img');
  }
  let layoutRaf = 0;
  function syncLayout() {
    const stVisible = shouldShowStage() || !!st.stageSoon;
    scrollWrap.hidden = !stVisible;
    textArea.hidden = sections.length === 0;
    rtBarRow.hidden = sections.length === 0;
    if (rt && rt.fontEl) rt.fontEl.hidden = sections.length === 0;
    leadBtn.hidden = nonBadgeEds.length === 0;
    leadSep.hidden = nonBadgeEds.length === 0;
    if (rt && rt.cbBtn) rt.cbBtn.hidden = nonBadgeEds.length === 0;
    const side = stVisible && !!st.insertSideMode && sections.length > 0 && !st.photoGridUi && !lettering;
    doc.style.width = '';
    textArea.style.flexBasis = '';
    if (modalElRef) {
      modalElRef.classList.toggle('ae-textonly', !stVisible);
      modalElRef.classList.toggle('ae-has-text', sections.length > 0);
      modalElRef.classList.toggle('ae-side', side);
      setWide(side || !!(st.wideModal || st.photoGridUi) || (stVisible && !side && (R.w + 2 * pad) * st.k > 940));
    }
    if (stVisible && !st.photoGridUi && st.rescaleStage) {
      if (layoutRaf) cancelAnimationFrame(layoutRaf);
      layoutRaf = requestAnimationFrame(() => {
        layoutRaf = 0;
        const sw = scrollWrap.clientWidth - 20;
        const sh = scrollWrap.clientHeight - 20;
        if (side && sw > 80 && sh > 80) {
          st.rescaleStage(sw, sh);
        } else if (!side && sw > 80) {
          const maxH = sections.length > 0 ? Math.min(Math.floor(window.innerHeight * 0.45), 440) : Math.max(200, sh);
          st.rescaleStage(sw, maxH);
        }
        allEds.forEach((ed) => { ed.fitToLines && ed.fitToLines(); ed.placeMarks(); });
      });
    }
    syncButtons();
  }

  const linkIcoSvg = `<svg viewBox="0 0 18 18" class="icon icon-sm" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 10.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M10.5 7.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1"/></svg>`;
  const bLink = h('button', { type: 'button', class: 'btn', 'data-testid': 'rt-link', 'data-tip': t('rtLink'), onpointerdown: keepDown, onclick: () => rt.openLinkPop(bLink), html: linkIcoSvg + `<span>${t('rtLink')}</span>` });
  const tools = h('div', { class: 'ae-tools' }, bAddText, bAddImg, bOcr, bLink, bDel, bCrop, bRep, h('div', { class: 'ae-zgroup' }, bFront, bBack), rt.fontEl);
  const stageSlot = st.photoGridUi
    ? h('div', { class: 'ae-grid-shell', 'data-testid': 'te-photo-bar' },
      h('div', { class: 'ae-grid-mid-row' }, st.photoGridUi.sideCol, st.photoGridUi.btnTplLeft, scrollWrap, st.photoGridUi.btnTplRight, h('div', { class: 'ae-grid-spacer' })),
      st.photoGridUi.btnTplBottom)
    : scrollWrap;
  if (st.photoGridUi) {
    stageSlot.addEventListener('wheel', (e) => {
      if (scrollWrap.contains(e.target)) return;
      if (scrollWrap.scrollHeight <= scrollWrap.clientHeight + 1) return;
      e.preventDefault();
      const mult = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? scrollWrap.clientHeight : 1);
      scrollWrap.scrollTop += e.deltaY * mult;
    }, { passive: false });
  }
  const split = h('div', { class: 'ae-split' }, stageSlot, textArea);
  const mainSlot = st.tablePropsEl ? h('div', { class: 'ae-table-layout' }, st.tablePropsEl, split) : split;
  const body = h('div', { class: 'ae-body' }, tools, rtBarRow, mainSlot);
  const applyBtn = h('button', { class: 'btn primary', 'data-testid': 'ae-apply', html: icon('check', 'icon icon-sm') + `<span>${t('apply')}</span>` });
  const foot = h('div', { class: 'modal-foot' }, h('span', { class: 'info' }, t('aeFitInfo')), h('div', { class: 'grow' }), h('button', { class: 'btn', 'data-testid': 'ae-cancel', onclick: () => m.close(null) }, t('cancel')), applyBtn);
  const m = openModal({ title: t('aeTitle'), body, foot, cls: 'ae', closeOnBackdrop: false, closeButton: false });
  const modalElRef = body.closest('.modal');
  function setWide(on) {
    if (!modalElRef) return;
    const hasProps = !!st.tablePropsEl;
    const wide = on || hasProps;
    modalElRef.classList.toggle('ae-wide', on);
    modalElRef.classList.toggle('ae-has-props', hasProps);
    const card = modalElRef.querySelector('.modal-box, .modal-card, .modal-dlg') || modalElRef;
    if (hasProps) {
      const isWideTbl = !!(on || (st.tableColCount && st.tableColCount >= 4));
      card.style.maxWidth = isWideTbl ? 'min(97vw, 1540px)' : 'min(96vw, 1180px)';
      card.style.width = isWideTbl ? 'min(97vw, 1540px)' : 'min(96vw, 1180px)';
    } else {
      card.style.maxWidth = wide ? 'min(96vw, 1340px)' : '';
      card.style.width = wide ? 'min(96vw, 1340px)' : '';
    }
  }
  setWide(!!(st.wideModal || st.photoGridUi));
  syncLayout();
  commitSnap();

  let copiedStageObj = null;
  let clipText = '';
  let aeCtxEl = null;
  const hideAeCtx = () => { if (aeCtxEl) { aeCtxEl.remove(); aeCtxEl = null; } };
  const onDocDownCtx = (e) => { if (aeCtxEl && !aeCtxEl.contains(e.target)) hideAeCtx(); };
  document.addEventListener('pointerdown', onDocDownCtx, true);

  const showAeCtx = (x, y, e) => {
    hideAeCtx();
    const sObj = getSelection();
    const savedRange = (sObj && sObj.rangeCount && textArea.contains(sObj.getRangeAt(0).commonAncestorContainer)) ? sObj.getRangeAt(0).cloneRange() : null;
    const targetEd = allEds.find((ed) => ed.paper.contains(e.target)) || st.focusedEd || st.lastEditTarget;
    const inStage = stage.contains(e.target);
    const inText = !inStage && !!(textArea.contains(e.target) || (savedRange && textArea.contains(savedRange.commonAncestorContainer)));
    const restoreRange = () => {
      if (!savedRange) return;
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(savedRange);
    };
    const hasTextSel = !!(savedRange && !savedRange.collapsed);
    const hitParas = [...doc.querySelectorAll('.te-para.te-sp-hit')];
    const hasStageSel = !inText && st.sel && !st.sel.deleted;
    const canAlignImg = hasStageSel && (st.sel.type === 'img' || (st.sel.type === 'photo' && st.sel.full && (st.sel.full.w > st.sel.src.w + 1 || st.sel.full.h > st.sel.src.h + 1)));
    const items = [
      ...(canAlignImg ? [
        { label: t('alignImage'), icon: 'image', act: () => enterPanMode(st.sel) },
        { sep: true },
      ] : []),
      { label: t('ctxCut'), icon: 'cut', act: () => {
        if (hasTextSel) {
          clipText = savedRange.toString();
          navigator.clipboard?.writeText?.(clipText).catch(() => {});
          restoreRange();
          document.execCommand('delete');
        } else if (hasStageSel) {
          if (st.sel.type === 'img' && st.sel.img) copiedStageObj = clone({ type: 'img', img: st.sel.img, w: st.sel.w, h: st.sel.h });
          else if (st.sel.type === 'photo' && st.sel.canvas && st.sel.canvas.width) copiedStageObj = { type: 'img', img: { dataUrl: st.sel.canvas.toDataURL('image/png'), anchor: 0, wrap: false, width: 1 }, w: st.sel.w, h: st.sel.h };
          del();
        }
      } },
      { label: t('ctxCopy'), icon: 'copy', act: () => {
        if (hasTextSel) {
          clipText = savedRange.toString();
          navigator.clipboard?.writeText?.(clipText).catch(() => {});
        } else if (hasStageSel) {
          if (st.sel.type === 'img' && st.sel.img) copiedStageObj = clone({ type: 'img', img: st.sel.img, w: st.sel.w, h: st.sel.h });
          else if (st.sel.type === 'photo' && st.sel.canvas && st.sel.canvas.width) copiedStageObj = { type: 'img', img: { dataUrl: st.sel.canvas.toDataURL('image/png'), anchor: 0, wrap: false, width: 1 }, w: st.sel.w, h: st.sel.h };
        }
      } },
      { label: t('ctxPasteAction'), icon: 'paste', act: async () => {
        if (inText && targetEd) {
          let txt = clipText;
          try { const cl = await navigator.clipboard?.readText?.(); if (cl) txt = cl; } catch {}
          if (!txt) return;
          targetEd.paper.focus();
          if (savedRange) restoreRange();
          document.execCommand('insertText', false, txt);
        } else if (!inText && copiedStageObj && copiedStageObj.type === 'img') {
          const o = {
            id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            type: 'img', img: { ...copiedStageObj.img },
            x: Math.min(R.x + R.w - 10, (st.sel ? st.sel.x : R.x) + 12),
            y: Math.min(R.y + R.h - 10, (st.sel ? st.sel.y : R.y) + 12),
            w: copiedStageObj.w, h: copiedStageObj.h, keep: [], keepG: [],
          };
          o.el = h('div', { class: 'ae-obj ae-img', 'data-testid': 'ae-obj', 'data-type': 'img', 'data-oid': o.id });
          o.view = h('div', { class: 'ae-view' }, h('img', { src: o.img.dataUrl, draggable: 'false' })); o.el.append(o.view);
          wireObjEl(o);
          if (sections.length > 0 && !st.photoGridUi && !lettering) st.insertSideMode = true;
          objs.push(o); stage.insertBefore(o.el, guides); place(o); markFresh(o); syncLayout();
          // the view may change when the side layout opens: center again once it settled
          const recenter = () => { if (o.deleted || o.el.classList.contains('dragging')) return; const c = viewCenterSpot(o.w, o.h); o.x = c.x; o.y = c.y; place(o); syncSlotBox(); };
          recenter(); select(o); syncSlotBox();
          requestAnimationFrame(() => requestAnimationFrame(() => { recenter(); commitSnap(); }));
        }
      } },
      { label: t('del'), icon: 'trash', danger: true, act: () => {
        if (inText) {
          if (hitParas.length) {
            const hitSecs = sections.filter((s) => hitParas.some((p) => s.ed.paper.contains(p)));
            doc.querySelectorAll('.te-row .te-para.te-sp-hit').forEach((p) => p.classList.remove('te-sp-hit'));
            hitSecs.forEach((s, idx) => {
              if (idx === hitSecs.length - 1 && hitSecs.length === sections.length) s.ed.setParas([{ text: '', marker: false }]);
              else deleteSectionCell(s);
            });
          } else if (hasTextSel) {
            restoreRange();
            document.execCommand('delete');
          }
        } else if (hasStageSel) {
          del();
        }
      } },
    ];
    aeCtxEl = h('div', { class: 'ctx', role: 'menu', 'data-testid': 'ae-ctx' },
      h('div', { class: 'ctx-list' }, items.map((it) => {
        if (it.sep) return h('div', { class: 'ae-ctx-sep' });
        const row = h('div', { class: 'item' + (it.danger ? ' danger' : ''), role: 'menuitem', onpointerdown: (ev) => ev.preventDefault() });
        row.innerHTML = (it.icon ? icon(it.icon, 'icon icon-sm') : '') + `<span>${it.label}</span>`;
        row.onclick = (ev) => { ev.stopPropagation(); hideAeCtx(); it.act(); };
        return row;
      })));
    document.body.append(aeCtxEl);
    const r = aeCtxEl.getBoundingClientRect();
    aeCtxEl.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
    aeCtxEl.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
  };
  const onModalCtxMenu = (e) => {
    const hitEl = e.target && e.target.closest && e.target.closest('.ae-obj[data-oid]');
    if (hitEl) {
      const hitObj = objs.find((x) => x.id === hitEl.dataset.oid && !x.deleted);
      if (hitObj && st.sel !== hitObj) select(hitObj);
    }
    e.preventDefault();
    e.stopPropagation();
    showAeCtx(e.clientX, e.clientY, e);
  };
  (modalElRef || body).addEventListener('contextmenu', onModalCtxMenu, true);

  const onKeyCapture = (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace' || e.code === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tg = e.target;
      const inEditable = tg && ((tg.closest && tg.closest('.te-paper, .te-badge')) || tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName));
      if (!inEditable && st.sel && !st.sel.deleted) {
        e.preventDefault(); e.stopPropagation();
        del();
        return;
      }
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = (e.key || '').toLowerCase();
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); return; }
    if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); redo(); return; }
    if (key === 'a' && !e.shiftKey) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const eds = visibleEdsInOrder();
      if (!eds.length) return;
      e.preventDefault(); e.stopPropagation();
      getSelection()?.removeAllRanges();
      st.multiRanges = eds.map((ed) => {
        const paras = [...ed.paper.children];
        const i1 = Math.max(0, paras.length - 1);
        const e1 = paras[i1] ? paras[i1].textContent.length : 0;
        return { ed, i0: 0, s0: 0, i1, e1 };
      });
      renderMultiRanges();
      return;
    }
    const inText = e.target && e.target.closest && e.target.closest('.te-paper, .te-badge');
    if (inText) return;
    if (key === 'c' && st.sel && !st.sel.deleted) {
      if (st.sel.type === 'img' && st.sel.img) copiedStageObj = clone({ type: 'img', img: st.sel.img, w: st.sel.w, h: st.sel.h });
      else if (st.sel.type === 'photo' && st.sel.canvas && st.sel.canvas.width) copiedStageObj = { type: 'img', img: { dataUrl: st.sel.canvas.toDataURL('image/png'), anchor: 0, wrap: false, width: 1 }, w: st.sel.w, h: st.sel.h };
      return;
    }
    if (key === 'v' && copiedStageObj && copiedStageObj.type === 'img') {
      e.preventDefault(); e.stopPropagation();
      const o = {
        id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        type: 'img', img: { ...copiedStageObj.img },
        x: Math.min(R.x + R.w - 10, (st.sel ? st.sel.x : R.x) + 12),
        y: Math.min(R.y + R.h - 10, (st.sel ? st.sel.y : R.y) + 12),
        w: copiedStageObj.w, h: copiedStageObj.h, keep: [], keepG: [],
      };
      o.el = h('div', { class: 'ae-obj ae-img', 'data-testid': 'ae-obj', 'data-type': 'img', 'data-oid': o.id });
      o.view = h('div', { class: 'ae-view' }, h('img', { src: o.img.dataUrl, draggable: 'false' })); o.el.append(o.view);
      wireObjEl(o);
      if (sections.length > 0 && !st.photoGridUi && !lettering) st.insertSideMode = true;
      objs.push(o); stage.insertBefore(o.el, guides); place(o); syncLayout(); select(o); syncSlotBox(); commitSnap();
    }
  };
  document.addEventListener('keydown', onKeyCapture, true);

  const close0 = m.close.bind(m);
  m.close = (v) => {
    clearTimers();
    if (layoutRaf) { cancelAnimationFrame(layoutRaf); layoutRaf = 0; }
    hideAeCtx();
    document.removeEventListener('pointerdown', onDocDownCtx, true);
    (modalElRef || body).removeEventListener('contextmenu', onModalCtxMenu, true);
    document.removeEventListener('keydown', onKeyCapture, true);
    if (rt) { rt.destroy(); rt = null; }
    bx.destroy();
    for (const f of st.cleanups || []) { try { f(); } catch (e) { console.warn(e); } }
    st.cleanups = [];
    return close0(v);
  };
  applyBtn.onclick = async () => {
    clearTimers();
    applyBtn.disabled = true;
    st.applying = true;
    try {
      if (st.panMode) exitPanMode();
      exitOcrMode();
      for (const o of objs) {
        if (o.deleted || o.type !== 'img') continue;
        if (o.placeholder) bakePlaceholderImage(o);
        else if (o._rawImg && o._crop) bakeCroppedImage(o);
      }
      await flushTextSync({ renderPreview: false });
      for (const o of objs) {
        if (!o.addedText || o.cell) continue;
        const mySecs = sections.filter((s) => s.o === o);
        const isEmpty = !mySecs.length || mySecs.every((s) => {
          const ps = s.ed.value();
          return !ps || ps.every((p) => !p.text.replace(/\u00a0/g, ' ').trim());
        });
        if (isEmpty) o.deleted = true;
      }
      for (const o of objs) if (o.deleted) for (const p of ocrPatchesOf(o)) p.deleted = true;
      await ready;
      const ok = await onApply(objs, { box: boxCfg, colOffsets: st.colOffsets.length ? st.colOffsets.slice() : undefined, dirty: st.isDirty ? st.isDirty() : true });
      if (ok !== false) m.close(true);
      else st.applying = false;
    } catch (e) { st.applying = false; throw e; } finally { applyBtn.disabled = false; }
  };

  Object.assign(st, { syncLayout, syncButtons, shouldShowStage, bx, m, body, applyBtn });
}
