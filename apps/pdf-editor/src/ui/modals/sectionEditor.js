// One editable text group inside the block editor: paragraphs with yellow
// start markers (click to join with the previous paragraph). Badge numbers
// get a small single-line chip instead.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { paraMarkSvg } from '../../../assets/icons/icons.js';
import { readPara, renderPara, rangesOf, charsFrom, offsetIn, pointAt } from './richText.js';
import { modelBaseSize } from '../../engines/text/layout.js';
import { parasLayoutSig, breaksFromLineEnds, computeActiveBreaks, segmentsFromBreaks } from './lineBreaks.js';
import { cleanLeadingForCheckBox, cleanTrailingForCheckBox } from '../../engines/text/checkBoxOps.js';
import { applyCbDataset, parseCbDataset, cloneCh, paraLs, isLightHex, setCaret, sectionEditorOps } from './sectionEditorOps.js';

export { setCaret };

let clipRich = null; // shared in-app rich text clipboard ({ text, paras })

export class SectionEditor {
  constructor(model, { badge = false, noLiveBreaks = false, onFocus, onChange } = {}) {
    this.model = model; this.badge = badge; this.noLiveBreaks = !badge && !!noLiveBreaks; this._onChange = onChange; this._savedSel = null;
    this._pxPerPt = 0; this._minWallPx = 0;
    this._baseParas = (model.paras || []).map((p) => p.text || '');
    this._baseStSigs = (model.paras || []).map((p) => JSON.stringify(rangesOf(charsFrom(p.text || '', p.st))));
    this._origLineEnds = Array.isArray(model.lineEndAt) ? model.lineEndAt.slice() : [];
    this._layoutK = (model.prevEdit && model.prevEdit.k > 0) ? model.prevEdit.k : 1;
    this._liveGrowW = ((model.prevEdit && model.prevEdit.deltaX) || 0) + ((model.prevEdit && model.prevEdit.deltaLeft) || 0);
    this._liveLineEnds = null;
    this._liveSig = null;
    this._lastLiveParas = null;
    this._lastLiveStSigs = null;
    this._lastLiveEnds = null;
    this._liveMaxLinePx = 0;
    this._composing = false;
    this._lastPaperW = 0;
    this._didInitialFit = false;
    this.newIndent = !!model.newParaIndent;
    // original text size (pt) of the whole text and of each paragraph: the size
    // field shows real sizes, an absolute size is displayed relative to these
    this.baseSize = Math.round(modelBaseSize(model) * 2) / 2;
    this._paraBs = paraBaseSizes(model, this.baseSize);
    const captureSel = () => {
      const s = getSelection();
      if (!s.rangeCount) return;
      const r = s.getRangeAt(0);
      if (!this.paper.contains(r.commonAncestorContainer)) return;
      if (r.collapsed) { this._savedSel = null; return; }
      this.saveSelection();
    };
    const onClipKey = (e) => {
      const k = (e.key || '').toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
      if (['b', 'i', 'u'].includes(k)) { e.preventDefault(); this.applyStyle({ toggle: k }); return true; }
      if (k === 'c') {
        const r = this.getSelectedRich();
        if (r) { clipRich = r; try { navigator.clipboard?.writeText(r.text).catch(() => {}); } catch {} }
        return false; // allow native copy as well
      }
      if (k === 'x') {
        const r = this.getSelectedRich();
        if (r) { clipRich = r; try { navigator.clipboard?.writeText(r.text).catch(() => {}); } catch {} e.preventDefault(); this.replaceSelectionWith([[]]); return true; }
      }
      if (k === 'v') {
        this._justPasted = false;
        setTimeout(async () => {
          if (this._justPasted) return;
          let txt = '';
          try { if (navigator.clipboard?.readText) txt = await navigator.clipboard.readText(); } catch {}
          if (!txt && clipRich) txt = clipRich.text;
          if (txt) this.insertPasted(txt, clipRich && clipRich.text === txt ? clipRich.paras : null);
        }, 35);
        return false; // allow native paste event if available
      }
      return false;
    };
    if (badge) {
      // the badge number / letter: one paragraph, formattable like the text
      this.paper = h('div', { class: 'te-badge', contenteditable: 'true', spellcheck: 'false', 'data-testid': 'te-badge' });
      const p0 = model.paras[0] || { text: '' };
      this.paper.append(this.mkPara(model.paras.map((p) => p.text).join(' '), false, model.paras.length === 1 ? p0.st : null));
      this.paper.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); return; }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
          const b = this.getRangeBounds();
          const total = b.paras.reduce((s, d) => s + readPara(d).length, 0);
          const selLen = b.i0 === b.i1 ? Math.max(0, b.e1 - b.s0) : 0;
          if (total - selLen >= 5) { e.preventDefault(); return; }
        }
        onClipKey(e);
      });
      this.paper.addEventListener('input', () => {
        this.normalize();
        const p0 = this.paper.firstElementChild;
        if (p0) {
          const ch = readPara(p0);
          if (ch.length > 5) { renderPara(p0, ch.slice(0, 5)); setCaret(p0, 5); }
        }
        this._onChange && this._onChange(this, 'input');
      });
      this.el = this.paper;
    } else {
      this.paper = h('div', { class: 'te-paper' + (model.lines.length <= 1 && model.paras.length <= 1 ? ' te-short' : '') + (this.noLiveBreaks ? ' te-single-flow' : ''), contenteditable: 'true', spellcheck: 'false', 'data-testid': 'te-paper' });
      this.marks = h('div', { class: 'te-marks' });
      this.el = h('div', { class: 'te-paper-wrap' + (this.noLiveBreaks ? ' te-single-flow' : '') }, this.marks, this.paper);
      this.paper.style.setProperty('--bs', String(this.baseSize));
      const initBreaks = this.noLiveBreaks ? [] : breaksFromLineEnds(model.paras || [], this._origLineEnds);
      model.paras.forEach((p, i) => this.paper.append(this.mkPara(p.text, p.marker, p.st, this._paraBs[i], p.align, initBreaks[i], p.cb)));
      if (!this.paper.firstChild) this.paper.append(this.mkPara('', false));
      this.paper.addEventListener('compositionstart', () => { this._composing = true; });
      this.paper.addEventListener('compositionend', () => { this._composing = false; this.syncLineBreaks(); this.placeMarks(); });
      this.paper.addEventListener('input', () => {
        this.normalize();
        this.clearLiveLayout();
        const s0 = getSelection();
        const curP = s0 && s0.rangeCount ? ((s0.anchorNode.nodeType === 1 ? s0.anchorNode : s0.anchorNode.parentElement)?.closest?.('.te-para')) : null;
        if (curP && curP._pendingStyle) {
          const st = curP._pendingStyle;
          delete curP._pendingStyle;
          const chs = readPara(curP);
          if (chs.length) {
            const off = s0.rangeCount ? offsetIn(curP, s0.anchorNode, s0.anchorOffset) : chs.length;
            for (const c of chs) if (!c.s) c.s = { ...st };
            renderPara(curP, chs);
            setCaret(curP, Math.min(off, chs.length));
          }
        }
        if (!this._composing) this.syncLineBreaks();
        this.placeMarks();
        this._onChange && this._onChange(this, 'input');
      });
      this.paper.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.splitAtCaret(); return; }
        if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const s = getSelection();
          if (s && s.rangeCount && s.getRangeAt(0).collapsed && this.paper.contains(s.anchorNode)) {
            const r = s.getRangeAt(0);
            const p = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement)?.closest?.('.te-para');
            if (p && p.dataset.indent === '1' && offsetIn(p, r.startContainer, r.startOffset) === 0) {
              e.preventDefault();
              this.removeParaIndent(p);
              return;
            }
          }
        }
        onClipKey(e);
      });
      new ResizeObserver(() => {
        if (this.paper.isConnected) {
          const curW = this.paper.clientWidth;
          if (!this._didInitialFit && curW > 20) this.fitToLines();
          else if (curW > 20 && Math.abs(curW - (this._lastPaperW || 0)) > 1) {
            this._lastPaperW = curW;
            this.syncLineBreaks();
          }
        }
        this.placeMarks();
      }).observe(this.paper);
    }
    const hasLightInk = (model.paras || []).some((p) => (p.st || []).some((r) => r.s && isLightHex(r.s.c)));
    if (hasLightInk) this.paper.classList.add('te-light-ink');
    this.paper.addEventListener('focus', () => onFocus && onFocus(this));
    this.paper.addEventListener('mouseup', captureSel);
    this.paper.addEventListener('keyup', captureSel);
    this.paper.addEventListener('copy', (e) => {
      const r = this.getSelectedRich();
      if (!r) return;
      clipRich = r;
      if (e.clipboardData) { e.clipboardData.setData('text/plain', r.text); e.preventDefault(); }
    });
    this.paper.addEventListener('cut', (e) => {
      const r = this.getSelectedRich();
      if (!r) return;
      clipRich = r;
      if (e.clipboardData) e.clipboardData.setData('text/plain', r.text);
      e.preventDefault();
      this.replaceSelectionWith([[]]);
    });
    this.paper.addEventListener('paste', (e) => {
      e.preventDefault();
      this._justPasted = true;
      setTimeout(() => { this._justPasted = false; }, 60);
      const raw = ((e.clipboardData && e.clipboardData.getData('text/plain')) || (clipRich && clipRich.text) || '').replace(/\r\n?/g, '\n');
      if (raw) this.insertPasted(raw, clipRich && clipRich.text === raw ? clipRich.paras : null);
    });
  }
  saveSelection() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (r.collapsed || !this.paper.contains(r.commonAncestorContainer)) return null;
    const b = this.getRangeBounds();
    if (!b || (b.i0 === b.i1 && b.s0 === b.e1)) return null;
    this._savedSel = { i0: b.i0, s0: b.s0, i1: b.i1, e1: b.e1 };
    return this._savedSel;
  }
  getRangeBounds(savedRange = null) {
    this.normalize();
    const paras = [...this.paper.children];
    const sel = getSelection();
    const hasSel = sel.rangeCount && this.paper.contains(sel.getRangeAt(0).commonAncestorContainer);
    if (hasSel) {
      const r = sel.getRangeAt(0);
      const paraOf = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; return el && el.closest('.te-para'); };
      const p0 = paraOf(r.startContainer), p1 = paraOf(r.endContainer);
      const i0 = p0 ? paras.indexOf(p0) : (r.startContainer === this.paper ? Math.min(paras.length - 1, r.startOffset) : 0);
      const i1 = p1 ? paras.indexOf(p1) : (r.endContainer === this.paper ? Math.max(0, Math.min(paras.length - 1, r.endOffset - 1)) : paras.length - 1);
      const s0 = p0 ? offsetIn(p0, r.startContainer, r.startOffset) : 0;
      const e1 = p1 ? offsetIn(p1, r.endContainer, r.endOffset) : readPara(paras[i1]).length;
      return { paras, i0, s0, i1: Math.max(i0, i1), e1, collapsed: r.collapsed };
    }
    const sv = savedRange || this._savedSel;
    if (sv) {
      const i0 = Math.max(0, Math.min(paras.length - 1, sv.i0));
      const i1 = Math.max(i0, Math.min(paras.length - 1, sv.i1));
      const s0 = Math.max(0, Math.min(readPara(paras[i0]).length, sv.s0));
      const e1 = Math.max(0, Math.min(readPara(paras[i1]).length, sv.e1));
      return { paras, i0, s0, i1, e1, collapsed: i0 === i1 && s0 === e1 };
    }
    const last = paras.length - 1;
    const len = readPara(paras[last]).length;
    return { paras, i0: last, s0: len, i1: last, e1: len, collapsed: true };
  }
  getSelectedRich() {
    const b = this.getRangeBounds();
    if (!b || b.collapsed) return null;
    const lines = [];
    for (let i = b.i0; i <= b.i1; i++) {
      const chars = readPara(b.paras[i]);
      const a = i === b.i0 ? b.s0 : 0;
      const z = i === b.i1 ? b.e1 : chars.length;
      lines.push(chars.slice(a, z).map(cloneCh));
    }
    const text = lines.map((ln) => ln.map((c) => c.ch).join('')).join('\n');
    if (!text) return null;
    return { text, paras: lines };
  }
  replaceSelectionWith(pastedLines) {
    const b = this.getRangeBounds();
    const { paras, i0, s0, i1, e1 } = b;
    this.clearLiveLayout();
    const before = readPara(paras[i0]).slice(0, s0);
    const after = readPara(paras[i1]).slice(e1);
    if (this.badge) {
      const flat = [];
      pastedLines.forEach((ln, idx) => {
        if (idx > 0 && flat.length) flat.push({ ch: ' ', s: null });
        for (const c of ln) flat.push(cloneCh(c));
      });
      const room = Math.max(0, 5 - before.length - after.length);
      const clipped = flat.slice(0, room);
      renderPara(paras[0], before.concat(clipped, after));
      this._savedSel = null;
      this.paper.focus();
      setCaret(paras[0], before.length + clipped.length);
      this._onChange && this._onChange(this, 'input');
      return;
    }
    if (pastedLines.length <= 1) {
      const line0 = (pastedLines[0] || []).map(cloneCh);
      renderPara(paras[i0], before.concat(line0, after));
      for (let k = i0 + 1; k <= i1; k++) paras[k].remove();
      this._savedSel = null;
      this.paper.focus();
      setCaret(paras[i0], before.length + line0.length);
      this.syncLineBreaks();
      this.placeMarks();
      this._onChange && this._onChange(this, 'input');
      return;
    }
    renderPara(paras[i0], before.concat(pastedLines[0].map(cloneCh)));
    for (let k = i0 + 1; k <= i1; k++) paras[k].remove();
    let prevNode = paras[i0];
    let lastNode = paras[i0];
    let lastOff = 0;
    for (let li = 1; li < pastedLines.length; li++) {
      const isLast = li === pastedLines.length - 1;
      const seg = pastedLines[li].map(cloneCh);
      const nd = this.mkPara('', this.newIndent, null, null, paras[i0].dataset.align || null);
      renderPara(nd, isLast ? seg.concat(after) : seg);
      prevNode.after(nd);
      prevNode = nd;
      lastNode = nd;
      lastOff = seg.length;
    }
    this._savedSel = null;
    this.paper.focus();
    setCaret(lastNode, lastOff);
    this.syncLineBreaks();
    this.placeMarks();
    this._onChange && this._onChange(this, 'input');
  }
  insertPasted(rawText, richParas = null) {
    const cleanText = String(rawText || '').replace(/\r\n?/g, '\n');
    if (richParas && richParas.map((ln) => ln.map((c) => c.ch).join('')).join('\n') === cleanText) {
      this.replaceSelectionWith(richParas.map((ln) => ln.map(cloneCh)));
      return;
    }
    const b = this.getRangeBounds();
    const curChars = readPara(b.paras[b.i0]);
    const refChar = curChars[Math.max(0, b.s0 - 1)] || curChars[b.s0] || null;
    const inh = refChar && refChar.s ? JSON.parse(JSON.stringify(refChar.s)) : null;
    const lines = cleanText.split('\n').map((ln) => Array.from(ln).map((ch) => ({ ch, s: inh ? { ...inh } : null })));
    this.replaceSelectionWith(lines);
  }
  caretEdge() {
    this.normalize();
    const sel = getSelection();
    if (!sel.rangeCount || !this.paper.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0);
    const paras = [...this.paper.children];
    const paraOf = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; return el && el.closest('.te-para'); };
    const p = paraOf(r.startContainer) || paras[0];
    const pi = Math.max(0, paras.indexOf(p));
    const off = offsetIn(p, r.startContainer, r.startOffset);
    const len = readPara(p).length;
    const rects = r.getClientRects();
    let cr = rects.length ? rects[0] : r.getBoundingClientRect();
    if (!cr || (cr.width === 0 && cr.height === 0)) cr = p.getBoundingClientRect();
    const pr0 = paras[0].getBoundingClientRect();
    const prLast = paras[paras.length - 1].getBoundingClientRect();
    return {
      collapsed: r.collapsed,
      atStart: pi === 0 && off === 0,
      atEnd: pi === paras.length - 1 && off === len,
      onFirstLine: pi === 0 && cr.top <= pr0.top + 8,
      onLastLine: pi === paras.length - 1 && cr.bottom >= prLast.bottom - 8,
      caretX: cr.left,
    };
  }
  focusAt(fromEnd, targetX = null, fromVertical = false) {
    this.paper.focus();
    this.normalize();
    const paras = [...this.paper.children];
    const p = fromEnd ? paras[paras.length - 1] : paras[0];
    if (!p) return;
    if (targetX != null && fromVertical && document.caretRangeFromPoint) {
      const pr = p.getBoundingClientRect();
      const x = Math.max(pr.left + 1, Math.min(pr.right - 1, targetX));
      const y = fromEnd ? pr.bottom - 5 : pr.top + 5;
      const cr = document.caretRangeFromPoint(x, y);
      if (cr && this.paper.contains(cr.startContainer)) {
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(cr);
        return;
      }
    }
    setCaret(p, fromEnd ? readPara(p).length : 0);
  }
  pointFromClient(clientX, clientY) {
    this.normalize();
    const paras = [...this.paper.children];
    if (document.caretRangeFromPoint) {
      const cr = document.caretRangeFromPoint(clientX, clientY);
      if (cr && this.paper.contains(cr.startContainer)) {
        const el = cr.startContainer.nodeType === 1 ? cr.startContainer : cr.startContainer.parentElement;
        const p = el && el.closest('.te-para');
        if (p && paras.includes(p)) return { pi: paras.indexOf(p), off: offsetIn(p, cr.startContainer, cr.startOffset) };
      }
    }
    let bestPi = 0, bestD = Infinity;
    paras.forEach((p, idx) => {
      const r = p.getBoundingClientRect();
      const dy = clientY < r.top ? r.top - clientY : (clientY > r.bottom ? clientY - r.bottom : 0);
      if (dy < bestD) { bestD = dy; bestPi = idx; }
    });
    const r = paras[bestPi].getBoundingClientRect();
    const len = readPara(paras[bestPi]).length;
    return { pi: bestPi, off: clientX > (r.left + r.right) / 2 ? len : 0 };
  }
  wordRangeAt(pi, off) {
    const paras = [...this.paper.children];
    const p = paras[pi];
    if (!p) return null;
    const chs = readPara(p);
    if (!chs.length) return { i0: pi, s0: 0, i1: pi, e1: 0 };
    let a = Math.min(off, chs.length - 1), b = a + 1;
    if (!/\s/.test(chs[a].ch)) {
      while (a > 0 && !/\s/.test(chs[a - 1].ch)) a--;
      while (b < chs.length && !/\s/.test(chs[b].ch)) b++;
    } else {
      a = 0; b = chs.length;
    }
    return { i0: pi, s0: a, i1: pi, e1: b };
  }
  clientRectsFor(rng) {
    const paras = [...this.paper.children];
    const p0 = paras[rng.i0], p1 = paras[rng.i1];
    if (!p0 || !p1) return [];
    const [sn, so] = pointAt(p0, rng.s0, true);
    const [en, eo] = pointAt(p1, rng.e1);
    const r = document.createRange();
    r.setStart(sn, so); r.setEnd(en, eo);
    return [...r.getClientRects()].filter((rc) => rc.width > 0.5 && rc.height > 0.5);
  }
  setParas(paras) {
    this._savedSel = null;
    this._lastLiveParas = null;
    this._lastLiveStSigs = null;
    this._lastLiveEnds = null;
    this.clearLiveLayout();
    this.paper.textContent = '';
    if (this.badge) {
      const p0 = (paras && paras[0]) || { text: '' };
      this.paper.append(this.mkPara(p0.text, false, p0.st));
    } else {
      const list = paras && paras.length ? paras : [{ text: '', marker: false }];
      const breaks = this.noLiveBreaks ? [] : computeActiveBreaks(this._baseParas, this._origLineEnds, this._baseStSigs, list);
      list.forEach((p, i) => this.paper.append(this.mkPara(p.text, p.marker, p.st, this._paraBs[i], p.align, breaks[i], p.cb)));
      if (!this.paper.firstChild) this.paper.append(this.mkPara('', false));
      this.refreshLs();
      this.syncLineBreaks();
      this.placeMarks();
    }
  }
  // replace one paragraph in place (text verification fixes); the caret, if
  // it is in that paragraph, stays at the same place
  replacePara(pi, text, st, caretShift = () => 0) {
    const d = this.paper.children[pi];
    if (!d) return false;
    this.clearLiveLayout();
    const sel = getSelection();
    let caret = null;
    if (sel.rangeCount && d.contains(sel.anchorNode)) caret = offsetIn(d, sel.anchorNode, sel.anchorOffset);
    const nd = this.mkPara(text, d.dataset.indent === '1', st, parseFloat(d.dataset.bs) || null, d.dataset.align || null, null, parseCbDataset(d));
    nd.style.marginBottom = d.style.marginBottom;
    d.replaceWith(nd);
    if (caret != null) setCaret(nd, Math.min(Array.from(text).length, caret + caretShift(caret)));
    this.syncLineBreaks();
    this.placeMarks();
    return true;
  }
  clearLiveLayout() {
    this._liveLineEnds = null;
    this._liveSig = null;
    this._liveMaxLinePx = 0;
  }
  resetLiveLayout() {
    if (this.badge) return;
    this._layoutK = (this.model && this.model.prevEdit && this.model.prevEdit.k > 0) ? this.model.prevEdit.k : 1;
    this._liveGrowW = ((this.model && this.model.prevEdit && this.model.prevEdit.deltaX) || 0) + ((this.model && this.model.prevEdit && this.model.prevEdit.deltaLeft) || 0);
    this._lastLiveParas = null;
    this._lastLiveStSigs = null;
    this._lastLiveEnds = null;
    this.clearLiveLayout();
    this.syncLineBreaks();
    this.placeMarks();
  }
  applyLiveLayout({ lineEndAt = [], k = 1, deltaX = 0, deltaLeft = 0, paras = null } = {}) {
    if (this.badge || this.noLiveBreaks || this._composing || !this.paper || !this.paper.isConnected) return;
    if (paras && parasLayoutSig(this.value()) !== parasLayoutSig(paras)) return;
    this._layoutK = (k > 0 && Number.isFinite(k)) ? k : 1;
    this._liveGrowW = Math.max(0, (deltaX || 0) + (deltaLeft || 0));
    this._liveLineEnds = Array.isArray(lineEndAt) ? lineEndAt.slice() : [];
    const snapParas = paras || this.value();
    this._liveSig = parasLayoutSig(snapParas);
    this._lastLiveParas = snapParas.map((p) => p.text || '');
    this._lastLiveStSigs = snapParas.map((p) => JSON.stringify(rangesOf(charsFrom(p.text || '', p.st))));
    this._lastLiveEnds = this._liveLineEnds.slice();
    this.syncLineBreaks();
    this.placeMarks();
  }
  wallPx() {
    if (this.badge || this.noLiveBreaks || !this.model || !this.model.area || !this.paper || !this.paper.isConnected) return 0;
    let areaW = Math.max(16, this.model.area.right - this.model.area.left);
    if (this.model.align === 'center' && this.model.container) {
      areaW = Math.max(areaW, (this.model.container.x1 - this.model.container.x0) - 4);
    }
    const fs = parseFloat(getComputedStyle(this.paper).fontSize) || 13.5;
    const pxPerPt = this._pxPerPt || (fs / Math.max(4, this.baseSize || 11));
    const kEff = Math.max(0.18, this._layoutK || 1);
    const growW = Math.max(0, this._liveGrowW || 0);
    let w = Math.ceil(((areaW + growW) / kEff) * pxPerPt + 2);
    if (this._minWallPx && !this.model.cell) w = Math.max(w, Math.ceil(this._minWallPx / kEff));
    if (this._liveMaxLinePx > 0) w = Math.max(w, this._liveMaxLinePx);
    if (this.paper.querySelector(':scope > .te-para[data-cb-pos="left"]')) w += 24;
    else if (this.paper.querySelector(':scope > .te-para[data-cb-pos="right"]')) w += 32;
    return w;
  }
  applyWall(onlyPara = null) {
    if (this.badge || !this.paper || !this.paper.isConnected) return;
    const w = Math.max(this.wallPx(), this._sharedBlockW || 0);
    const allParas = [...this.paper.querySelectorAll(':scope > .te-para')];
    const paras = onlyPara ? [onlyPara] : allParas;
    const allCentered = !this.model.cell && (this.model.align === 'center' || (allParas.length > 0 && allParas.every((p) => p.dataset.align === 'center')));
    for (const d of paras) {
      d.style.maxWidth = w > 0 ? w + 'px' : '';
      if (this._centerBlock || (allCentered && (d.dataset.align === 'center' || this.model.align === 'center'))) {
        d.style.marginLeft = 'auto';
        d.style.marginRight = 'auto';
      } else {
        d.style.marginLeft = '';
        d.style.marginRight = '';
      }
    }
  }
  paperInnerWidth() {
    if (!this.paper || !this.paper.isConnected) return Infinity;
    const cs = getComputedStyle(this.paper);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const w = this.paper.clientWidth - pad;
    return w > 20 ? w : Infinity;
  }
  measureSpanWidth(d, a, b) {
    if (b <= a) return 0;
    const rng = document.createRange();
    const p0 = pointAt(d, a, true), p1 = pointAt(d, b);
    rng.setStart(p0[0], p0[1]); rng.setEnd(p1[0], p1[1]);
    // the rects of a range repeat the styled spans inside it: take each visual line's extent once
    const ext = new Map();
    for (const q of rng.getClientRects()) {
      if (!q.width) continue;
      const key = Math.round(q.top + q.height / 2);
      const e = [...ext.keys()].find((t0) => Math.abs(t0 - key) < 3);
      const cur = ext.get(e ?? key) || [Infinity, -Infinity];
      ext.set(e ?? key, [Math.min(cur[0], q.left), Math.max(cur[1], q.right)]);
    }
    return [...ext.values()].reduce((m, [l, r]) => m + (r - l), 0);
  }
  measureSegsMaxWidth(d, chars, breakSet, includeTail = true) {
    const segs = segmentsFromBreaks(chars, breakSet);
    const count = includeTail ? segs.length : Math.max(0, segs.length - 1);
    if (!count) return 0;
    const ind = parseFloat(getComputedStyle(d).textIndent) || 0;
    const prevMaxW = d.style.maxWidth;
    d.style.maxWidth = 'none';
    let maxW = 0;
    try {
      for (let si = 0; si < count; si++) {
        const [a, b] = segs[si];
        if (b <= a) continue;
        const w = this.measureSpanWidth(d, a, b);
        maxW = Math.max(maxW, w + (si === 0 ? ind : 0));
      }
    } finally {
      d.style.maxWidth = prevMaxW;
    }
    return maxW;
  }
  readAllParas() {
    return [...this.paper.querySelectorAll(':scope > .te-para')].map((d) => {
      const chars = readPara(d);
      const st = rangesOf(chars);
      const cb = parseCbDataset(d);
      return {
        d, chars,
        text: chars.map((c) => c.ch).join(''),
        marker: d.dataset.indent === '1',
        align: d.dataset.align || '',
        ...(cb ? { cb } : {}),
        ...(st.length ? { st } : {}),
      };
    });
  }
  syncLineBreaks() {
    if (this.badge || !this.paper) return;
    if (this.noLiveBreaks) {
      for (const d of [...this.paper.querySelectorAll(':scope > .te-para')]) {
        if (d.querySelector('.te-lb')) renderPara(d, readPara(d), null);
      }
      this.applyWall();
      return;
    }
    const items = this.readAllParas();
    const sigNow = parasLayoutSig(items);
    const isLive = this._liveLineEnds !== null && this._liveSig === sigNow;
    const useLastLive = !isLive && this._lastLiveParas && this._lastLiveEnds !== null;
    const rawBreaks = isLive
      ? breaksFromLineEnds(items, this._liveLineEnds)
      : (useLastLive
        ? computeActiveBreaks(this._lastLiveParas, this._lastLiveEnds, this._lastLiveStSigs, items)
        : computeActiveBreaks(this._baseParas, this._origLineEnds, this._baseStSigs, items));

    let savedSel = null;
    const captureSelIfNeeded = () => {
      if (savedSel !== null) return;
      const sel = getSelection();
      if (!sel || !sel.rangeCount || !this.paper.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        savedSel = false;
        return;
      }
      const r = sel.getRangeAt(0);
      const p0 = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement)?.closest?.('.te-para');
      const p1 = (r.endContainer.nodeType === 1 ? r.endContainer : r.endContainer.parentElement)?.closest?.('.te-para');
      const ps = items.map((x) => x.d);
      const i0 = p0 ? ps.indexOf(p0) : 0;
      const i1 = p1 ? ps.indexOf(p1) : ps.length - 1;
      if (i0 < 0 || i1 < 0) { savedSel = false; return; }
      savedSel = {
        i0, i1, collapsed: r.collapsed,
        s0: offsetIn(ps[i0], r.startContainer, r.startOffset),
        e1: offsetIn(ps[i1], r.endContainer, r.endOffset),
      };
    };

    const touched = new Set();
    const innerW = this.paperInnerWidth();
    items.forEach((it, i) => {
      const bs = it.align === 'justify' ? null : (rawBreaks[i] && rawBreaks[i].size ? rawBreaks[i] : null);
      const wantKey = bs ? [...bs].sort((a, b) => a - b).join(',') : '';
      const dirtyLb = [...it.d.querySelectorAll('.te-lb')].some((sp) => sp.childNodes.length !== 1 || !sp.firstChild || sp.firstChild.nodeType !== 3 || Array.from(sp.textContent || '').length !== 1);
      if ((it.d.dataset.lbKey || '') !== wantKey || dirtyLb) {
        captureSelIfNeeded();
        renderPara(it.d, it.chars, bs);
        touched.add(i);
      }
    });

    let maxFitW = 0;
    if (this.paper.isConnected && Number.isFinite(innerW)) {
      items.forEach((it, i) => {
        const bs = rawBreaks[i] && rawBreaks[i].size ? rawBreaks[i] : null;
        if (bs) {
          const mw = this.measureSegsMaxWidth(it.d, it.chars, bs, isLive);
          if (mw > innerW - 1) {
            captureSelIfNeeded();
            renderPara(it.d, it.chars, null);
            touched.add(i);
          } else {
            maxFitW = Math.max(maxFitW, Math.ceil(mw + 4));
          }
        } else if (isLive && it.chars.length > 0 && (this._layoutK < 0.99 || this._liveGrowW > 0.5)) {
          const mw = this.measureSegsMaxWidth(it.d, it.chars, null, true);
          if (mw <= innerW - 1) maxFitW = Math.max(maxFitW, Math.ceil(mw + 4));
        }
      });
    }
    this._liveMaxLinePx = maxFitW;

    if (savedSel && touched.size) {
      let overlaps = false;
      for (const ti of touched) if (ti >= savedSel.i0 && ti <= savedSel.i1) { overlaps = true; break; }
      if (overlaps) {
        const p0 = items[savedSel.i0]?.d, p1 = items[savedSel.i1]?.d;
        if (p0 && p1) {
          if (savedSel.collapsed) {
            setCaret(p0, Math.min(items[savedSel.i0].chars.length, savedSel.s0));
          } else {
            const [sn, so] = pointAt(p0, Math.min(items[savedSel.i0].chars.length, savedSel.s0), true);
            const [en, eo] = pointAt(p1, Math.min(items[savedSel.i1].chars.length, savedSel.e1));
            const nr = document.createRange();
            nr.setStart(sn, so); nr.setEnd(en, eo);
            const sel = getSelection();
            sel.removeAllRanges(); sel.addRange(nr);
          }
        }
      }
    }
    this.applyWall();
  }
  focusEnd() { const last = this.paper.lastElementChild; this.paper.focus(); setCaret(last, readPara(last).length); }
}

Object.assign(SectionEditor.prototype, sectionEditorOps);

// median original glyph size of every paragraph of the model
function paraBaseSizes(model, fallback) {
  const out = [];
  const gs = model.charGlyph || [];
  let pos = 0;
  for (const p of model.paras || []) {
    const n = (p.text || '').length;
    const v = [];
    for (let j = pos; j < pos + n; j++) { const g = gs[j]; if (g && !g.space && g.g && (g.g.size || g.g.hsize)) v.push(g.g.size || g.g.hsize); }
    v.sort((a, b) => a - b);
    out.push(v.length ? Math.round(v[v.length >> 1] * 2) / 2 : fallback);
    pos += n + 1;
  }
  return out;
}
