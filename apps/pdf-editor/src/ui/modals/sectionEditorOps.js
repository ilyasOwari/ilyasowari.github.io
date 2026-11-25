// Text formatting, spacing, alignment, checkbox, link, smart-order and value
// prototype methods for SectionEditor (keeps sectionEditor.js modular and concise).
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { paraMarkSvg } from '../../../assets/icons/icons.js';
import { readPara, renderPara, rangesOf, charsFrom, offsetIn, pointAt } from './richText.js';
import { breaksFromLineEnds, segmentsFromBreaks } from './lineBreaks.js';
import { cleanLeadingForCheckBox, cleanTrailingForCheckBox, stripLeadingListPrefix, smartOrderPrefix, cbSig } from '../../engines/text/checkBoxOps.js';

export function applyCbDataset(d, cb) {
  if (cb && cb.pos) {
    d.dataset.cb = JSON.stringify(cb);
    d.dataset.cbPos = cb.pos;
    d.dataset.cbShape = cb.shape || 'square';
    d.style.setProperty('--cb-bc', cb.bc || '#334155');
  } else {
    delete d.dataset.cb;
    delete d.dataset.cbPos;
    delete d.dataset.cbShape;
    d.style.removeProperty('--cb-bc');
  }
}

export function parseCbDataset(d) {
  if (!d || !d.dataset || !d.dataset.cb) return null;
  try {
    const p = JSON.parse(d.dataset.cb);
    return p && p.pos ? p : null;
  } catch {
    return null;
  }
}

export const cloneCh = (c) => ({ ch: c.ch, s: c.s ? JSON.parse(JSON.stringify(c.s)) : null });
export const paraLs = (chs) => { for (const c of chs) if (c.s && Number(c.s.ls)) return Number(c.s.ls); return 0; };

export const isLightHex = (hx) => {
  if (!hx || hx[0] !== '#' || hx.length < 7) return false;
  const r = parseInt(hx.slice(1, 3), 16), g = parseInt(hx.slice(3, 5), 16), b = parseInt(hx.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 205;
};

export const isColoredPdfFill = (fl) => {
  if (!fl || !fl.args) return false;
  let r = 0, g = 0, b = 0;
  if (fl.op === 'g' || fl.op === 'G') { r = g = b = fl.args[0] * 255; }
  else if (fl.op === 'rg' || fl.op === 'RG') { r = fl.args[0] * 255; g = fl.args[1] * 255; b = fl.args[2] * 255; }
  else if (fl.op === 'k' || fl.op === 'K') {
    const [c, m, y, k] = fl.args;
    r = (1 - c) * (1 - k) * 255; g = (1 - m) * (1 - k) * 255; b = (1 - y) * (1 - k) * 255;
  } else return false;
  return !(r < 60 && g < 60 && b < 60 && Math.max(r, g, b) - Math.min(r, g, b) < 22);
};

export function setCaret(node, offset) {
  const isPara = !!(node.classList && node.classList.contains('te-para'));
  let [n, o] = isPara ? pointAt(node, offset) : [node.firstChild && node.firstChild.nodeType === 3 ? node.firstChild : node, 0];
  if (isPara && n && n.nodeType === 3 && o === n.data.length && n.parentElement && n.parentElement.classList.contains('te-lb')) {
    [n, o] = pointAt(node, offset, true);
  }
  const r = document.createRange();
  if (n.nodeType === 3 || !isPara) {
    const tn = n.nodeType === 3 ? n : n;
    r.setStart(tn, n.nodeType === 3 ? Math.min(isPara ? o : offset, n.length) : 0);
  } else r.setStart(n, o);
  r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

export const sectionEditorOps = {
  // Size the invisible wrap wall of each paragraph to match the PDF page's
  // character width limit so typing wraps at the same word as in the PDF.
  fitToLines() {
    this.refreshLs();
    if (this.badge || !this.paper.isConnected) return;
    if (this.noLiveBreaks) { this._didInitialFit = true; this.applyWall(); return; }
    this._didInitialFit = true;
    this._lastPaperW = this.paper.clientWidth;
    const items = this.readAllParas();
    const csPaper = getComputedStyle(this.paper);
    const fs = parseFloat(csPaper.fontSize) || 13.5;
    const nom = fs / Math.max(4, this.baseSize || 11);
    const ratios = [];
    const mLines = (this.model && this.model.lines) || [];
    const initBreaks = breaksFromLineEnds(items, this._origLineEnds);
    let need = 0, li = 0;
    items.forEach(({ d, chars }, i) => {
      const segs = segmentsFromBreaks(chars, initBreaks[i]);
      const ind = parseFloat(getComputedStyle(d).textIndent) || 0;
      const prevMaxW = d.style.maxWidth;
      d.style.maxWidth = 'none';
      try {
        segs.forEach(([a, b], si) => {
          if (b <= a) { li++; return; }
          const w = this.measureSpanWidth(d, a, b);
          need = Math.max(need, w + (si === 0 ? ind : 0));
          const ml = mLines[li++];
          const wPdf = !this.model.prevEdit && ml ? (ml.right - ml.left) : 0;
          if (wPdf >= 20 && w >= 12) ratios.push(w / wPdf);
        });
      } finally {
        d.style.maxWidth = prevMaxW;
      }
    });
    if (ratios.length) {
      ratios.sort((a, b) => a - b);
      const med = ratios[ratios.length >> 1];
      this._pxPerPt = Math.max(nom * 0.65, Math.min(nom * 1.55, med));
    } else {
      this._pxPerPt = nom;
    }
    if (!this.model.prevEdit && !this.model.cell && need > 0) {
      this._minWallPx = Math.ceil(need + 3);
    }
    this.syncLineBreaks();
  },
  mkPara(text, indent, st, bs = null, align = null, breakSet = null, cb = null) { const d = h('div', { class: 'te-para' }); d.dataset.indent = indent ? '1' : '0'; if (bs > 0 && Math.abs(bs - this.baseSize) > 0.05) { d.dataset.bs = String(bs); d.style.setProperty('--bs', String(bs)); } if (align) { d.dataset.align = align; d.style.textAlign = align; } applyCbDataset(d, cb); const chs = charsFrom(text, st); renderPara(d, chs, breakSet); this.setLs(d, paraLs(chs)); return d; },
  normalize() {
    const paper = this.paper;
    for (const n of [...paper.childNodes]) {
      if (n.nodeType === 1 && n.classList.contains('te-para')) continue;
      if (n.nodeType === 1 && n.tagName === 'DIV') { n.className = 'te-para'; if (!n.dataset.indent) n.dataset.indent = this.newIndent ? '1' : '0'; continue; }
      if (n.nodeType === 3 && !n.textContent) { n.remove(); continue; }
      const d = this.mkPara('', this.newIndent); d.textContent = ''; paper.insertBefore(d, n); d.append(n);
    }
    if (!paper.firstChild) paper.append(this.mkPara('', false));
  },
  placeMarks() {
    if (this.badge) return;
    this.marks.textContent = '';
    [...this.paper.children].forEach((d, i) => {
      const hasIndent = d.dataset.indent === '1';
      const m = h('div', { class: 'te-mark-wrap', 'data-tip': (hasIndent || i > 0) ? t('paraHint') : '', html: paraMarkSvg() });
      m.style.left = (hasIndent ? d.offsetLeft : Math.max(2, d.offsetLeft - 24)) + 'px';
      m.style.top = (d.offsetTop + 2) + 'px';
      m.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (hasIndent) this.removeParaIndent(d);
        else if (i > 0) this.joinWithPrev(d);
      });
      this.marks.append(m);
    });
  },
  removeParaIndent(d) {
    if (!d || d.dataset.indent !== '1') return;
    this.clearLiveLayout();
    d.dataset.indent = '0';
    this.syncLineBreaks();
    this.placeMarks();
    this._onChange && this._onChange(this, 'para');
  },
  joinWithPrev(d) {
    const prev = d.previousElementSibling; if (!prev) return;
    this.clearLiveLayout();
    const a = readPara(prev), b = readPara(d);
    const at = a.map((c) => c.ch).join(''), bt = b.map((c) => c.ch).join('');
    const sep = at && bt && !/[\s-]$/.test(at) ? [{ ch: ' ', s: null }] : [];
    renderPara(prev, a.concat(sep, b));
    d.remove();
    setCaret(prev, a.length + sep.length);
    this.syncLineBreaks();
    this.placeMarks();
    this._onChange && this._onChange(this, 'para');
  },
  splitAtCaret() {
    if (this.badge) return;
    this.clearLiveLayout();
    const paper = this.paper;
    paper.focus();
    const s = getSelection();
    if (!s.rangeCount || !paper.contains(s.anchorNode)) return;
    const para = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('.te-para');
    if (!para) return;
    const r = s.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    const off = offsetIn(para, r.startContainer, r.startOffset);
    const chars = readPara(para);
    const a = chars.slice(0, off), b = chars.slice(off);
    while (a.length && a[a.length - 1].ch === ' ') a.pop();
    while (b.length && b[0].ch === ' ') b.shift();
    renderPara(para, a);
    const nd = this.mkPara('', this.newIndent, null, parseFloat(para.dataset.bs) || null, para.dataset.align || null, null, parseCbDataset(para));
    renderPara(nd, b);
    if (!b.length) {
      const prevSt = a.length && a[a.length - 1].s ? a[a.length - 1].s : null;
      const inh = {};
      if (prevSt) for (const k of ['b', 'i', 'u', 'c', 'k', 'f']) if (prevSt[k]) inh[k] = prevSt[k];
      if (Object.keys(inh).length) nd._pendingStyle = inh;
    }
    para.after(nd);
    setCaret(nd, 0);
    this.syncLineBreaks();
    this.placeMarks();
    this._onChange && this._onChange(this, 'para');
  },
  // op: {toggle:'b'|'i'|'u'} | {color:'#rrggbb'|null} | {size:+1|-1} | {font:id|null} | {bg:box|null}
  applyStyle(op, savedRange = null, { batch = false } = {}) {
    const sel = getSelection();
    const hasLive = sel.rangeCount && !sel.getRangeAt(0).collapsed && this.paper.contains(sel.getRangeAt(0).commonAncestorContainer);
    if (!hasLive && !savedRange) return false;
    this.normalize();
    const paras = [...this.paper.children];
    const paraOf = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; return el && el.closest('.te-para'); };
    let collapsedCaret = null;
    if (!hasLive && sel.rangeCount && sel.getRangeAt(0).collapsed && this.paper.contains(sel.anchorNode)) {
      const cp = paraOf(sel.anchorNode);
      const pi = cp ? paras.indexOf(cp) : -1;
      if (pi >= 0) collapsedCaret = { pi, off: offsetIn(cp, sel.anchorNode, sel.anchorOffset) };
    }
    let i0, i1, s0, e1;
    if (hasLive) {
      const r = sel.getRangeAt(0);
      const p0 = paraOf(r.startContainer), p1 = paraOf(r.endContainer);
      i0 = p0 ? paras.indexOf(p0) : 0; i1 = p1 ? paras.indexOf(p1) : paras.length - 1;
      s0 = p0 ? offsetIn(p0, r.startContainer, r.startOffset) : 0;
      e1 = p1 ? offsetIn(p1, r.endContainer, r.endOffset) : readPara(paras[i1]).length;
    } else {
      i0 = Math.max(0, Math.min(paras.length - 1, savedRange.i0));
      i1 = Math.max(i0, Math.min(paras.length - 1, savedRange.i1));
      s0 = savedRange.s0; e1 = savedRange.e1;
    }
    const isLs = 'ls' in op;
    const isClear = !!op.clear;
    const segs = [];
    for (let i = i0; i <= i1; i++) {
      const chars = readPara(paras[i]);
      segs.push({ d: paras[i], chars, a: isLs ? 0 : (i === i0 ? s0 : 0), b: isLs ? chars.length : (i === i1 ? Math.min(chars.length, e1) : chars.length) });
    }
    const sel1 = segs.flatMap((g) => g.chars.slice(g.a, g.b)).filter((c) => c.ch.trim());
    if (!sel1.length && !isLs && !isClear) return false;
    // on / off is what the editor shows: the character's own style. (The original
    // font's weight is already written into the styles when the editor opens, so
    // turning bold off really gives regular text - no hidden 'base' bold.)
    const isCharOn = (c, k) => !!(c.s && c.s[k]);
    let val;
    if (op.toggle) val = typeof op.on === 'boolean' ? op.on : !sel1.every((c) => isCharOn(c, op.toggle));
    if (op.vpos) val = typeof op.on === 'boolean' ? op.on : !sel1.every((c) => c.s && c.s.v === op.vpos);
    const hasColoredOrig = isClear && [
      this.model && this.model.refGlyph,
      ...((this.model && this.model.charGlyph) || []),
      ...((this.model && this.model.origCharGlyph) || []),
    ].some((gl) => gl && gl.g && isColoredPdfFill(gl.g.fill));
    for (const g of segs) {
      if (isClear) delete g.d._pendingStyle;
      for (let i = g.a; i < g.b; i++) {
        const c = g.chars[i];
        if (isClear) {
          c.s = hasColoredOrig ? { c: '#1f1f1f' } : null;
          continue;
        }
        const s2 = { ...(c.s || {}) };
        if (op.toggle) {
          if (val) s2[op.toggle] = 1;
          else delete s2[op.toggle];
        }
        if ('color' in op) { if (op.color) s2.c = op.color; else delete s2.c; }
        if (op.size || op.setSize) {
          // sizes are absolute (pt): − / + step the size each character has now by 1 pt
          const cur = this.charSize(c, g.d);
          const want = op.setSize ? Number(op.setSize) : cur + (op.size > 0 ? 1 : -1);
          s2.z = Math.min(200, Math.max(3, Math.round(want * 10) / 10));
          delete s2.k;
        }
        if (op.vpos) { if (val) s2.v = op.vpos; else delete s2.v; }
        if ('font' in op) { if (op.font) s2.f = op.font; else delete s2.f; }
        if ('bg' in op) { if (op.bg && (op.bg.fc || op.bg.bc)) s2.bg = { ...op.bg }; else delete s2.bg; }
        if ('link' in op) { if (op.link) s2.link = op.link; else delete s2.link; }
        if ('ls' in op) { if (op.ls !== 0 && op.ls != null) s2.ls = Number(op.ls); else delete s2.ls; }
        c.s = Object.keys(s2).length ? s2 : null;
      }
    }
    for (const g of segs) {
      renderPara(g.d, g.chars);
      this.setLs(g.d, paraLs(g.chars));
    }
    if (isClear) {
      const anyLight = [...this.paper.children].some((p) => readPara(p).some((c) => c.s && isLightHex(c.s.c)));
      if (!anyLight) this.paper.classList.remove('te-light-ink');
    }
    this.clearLiveLayout();
    if (!collapsedCaret) this._savedSel = { i0, s0, i1, e1 };
    if (hasLive) {
      // keep the same text selected
      const [sn, so] = pointAt(segs[0].d, segs[0].a, true);
      const [en, eo] = pointAt(segs[segs.length - 1].d, segs[segs.length - 1].b);
      const nr = document.createRange(); nr.setStart(sn, so); nr.setEnd(en, eo);
      sel.removeAllRanges(); sel.addRange(nr);
    }
    this.syncLineBreaks();
    if (collapsedCaret) {
      const pNow = this.paper.children[collapsedCaret.pi];
      if (pNow) setCaret(pNow, Math.min(readPara(pNow).length, collapsedCaret.off));
    }
    this.placeMarks();
    this._onChange && this._onChange(this, batch ? 'style-batch' : 'style');
    return true;
  },
  paraBase(d) { return (d && parseFloat(d.dataset.bs)) || this.baseSize; },
  // current size of one character in pt
  charSize(c, d) {
    const s = c && c.s;
    if (s && s.z > 0) return s.z;
    return Math.round(this.paraBase(d) * ((s && s.k) || 1) * 2) / 2;
  },
  // the bounds of everything in this text (used when nothing is selected)
  wholeRange() {
    this.normalize();
    const paras = [...this.paper.children];
    const last = Math.max(0, paras.length - 1);
    return { i0: 0, s0: 0, i1: last, e1: paras.length ? readPara(paras[last]).length : 0 };
  },
  // one size for all non-blank characters of the range (pt), null when mixed / empty
  // an explicit range wins over the live selection
  boundsOf(range) {
    if (!range || range.i0 == null) return this.getRangeBounds();
    this.normalize();
    const paras = [...this.paper.children];
    const i0 = Math.max(0, Math.min(paras.length - 1, range.i0));
    const i1 = Math.max(i0, Math.min(paras.length - 1, range.i1));
    return { paras, i0, s0: Math.max(0, range.s0), i1, e1: Math.max(0, range.e1) };
  },
  // one value of fn(char, para) for all non-blank characters of the range;
  // undefined: nothing there, null: mixed
  uniformOf(savedRange, fn) {
    const b = this.boundsOf(savedRange);
    if (!b) return undefined;
    let val, seen = false;
    for (let i = b.i0; i <= b.i1; i++) {
      const chs = readPara(b.paras[i]);
      const a = i === b.i0 ? b.s0 : 0, z = i === b.i1 ? Math.min(chs.length, b.e1) : chs.length;
      for (let q = a; q < z; q++) {
        if (!chs[q].ch.trim()) continue;
        const v = fn(chs[q], b.paras[i]);
        if (!seen) { val = v; seen = true; } else if (v !== val) return null;
      }
    }
    return seen ? val : undefined;
  },
  sizeOf(savedRange = null) {
    const v = this.uniformOf(savedRange, (c, d) => Math.round(this.charSize(c, d) * 10) / 10);
    return v == null ? null : v;
  },
  fontOf(savedRange = null) { return this.uniformOf(savedRange, (c) => (c.s && c.s.f) || ''); },
  // style shared by the whole selection (for the toolbar state)
  selectionStyle() {
    const sel = getSelection();
    if (!sel.rangeCount || !this.paper.contains(sel.anchorNode)) return null;
    const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const sp = el && el.closest('[data-rs]');
    let st = {};
    try { st = sp ? JSON.parse(sp.dataset.rs) : {}; } catch (e) { st = {}; }
    return st;
  },
  // every non-blank selected character has style key k on (null: nothing selected)
  rangeAllOn(k, savedRange = null) {
    const b = this.boundsOf(savedRange);
    if (!b) return null;
    let any = false;
    for (let i = b.i0; i <= b.i1; i++) {
      const chs = readPara(b.paras[i]);
      const a = i === b.i0 ? b.s0 : 0, z = i === b.i1 ? Math.min(chs.length, b.e1) : chs.length;
      for (let q = a; q < z; q++) {
        if (!chs[q].ch.trim()) continue;
        any = true;
        const s = chs[q].s;
        if (k === 'sup' || k === 'sub' ? !(s && s.v === k) : !(s && s[k])) return false;
      }
    }
    return any ? true : null;
  },
  selectedInfo() {
    const b = this.getRangeBounds();
    if (!b) return null;
    const { paras, i0, s0, i1, e1 } = b;
    let txt = '', link = '';
    for (let i = i0; i <= i1; i++) {
      const chs = readPara(paras[i]);
      const a = i === i0 ? s0 : 0, z = i === i1 ? Math.min(chs.length, e1) : chs.length;
      for (let k = a; k < z; k++) { txt += chs[k].ch; if (!link && chs[k].s && chs[k].s.link) link = chs[k].s.link; }
      if (i < i1) txt += '\n';
    }
    return { text: txt, link };
  },
  applyLinkEdit(newText, newUrl) {
    const url = (newUrl || '').trim();
    const txt = (newText || '').replace(/\r\n?/g, ' ').replace(/\n/g, ' ');
    const cur = this.selectedInfo();
    if (txt && (!cur || txt !== cur.text)) {
      const b = this.getRangeBounds();
      const chs = b ? readPara(b.paras[b.i0]) : [];
      const ref = b ? (chs[Math.max(0, b.s0)] || chs[Math.max(0, b.s0 - 1)]) : null;
      const s = { ...(ref && ref.s ? ref.s : {}) };
      if (url) s.link = url; else delete s.link;
      const st = Object.keys(s).length ? s : null;
      this.replaceSelectionWith([Array.from(txt).map((ch) => ({ ch, s: st ? { ...st } : null }))]);
      return true;
    }
    return this.applyStyle({ link: url || null });
  },
  listLinks() {
    this.normalize();
    const out = [];
    const paras = [...this.paper.children];
    paras.forEach((d, pi) => {
      const chs = readPara(d);
      let i = 0;
      while (i < chs.length) {
        const lk = chs[i].s && chs[i].s.link;
        if (!lk) { i++; continue; }
        let j = i + 1;
        while (j < chs.length && chs[j].s && chs[j].s.link === lk) j++;
        out.push({ ed: this, pi, a: i, b: j, text: chs.slice(i, j).map((c) => c.ch).join(''), link: lk });
        i = j;
      }
    });
    return out;
  },
  updateLinkAt(pi, a, b, newText, newUrl) {
    const paras = [...this.paper.children];
    const d = paras[pi];
    if (!d) return false;
    const chs = readPara(d);
    const url = (newUrl || '').trim();
    const txt = (newText || '').replace(/\r\n?/g, ' ').replace(/\n/g, ' ');
    const refS = (chs[a] && chs[a].s) ? { ...chs[a].s } : {};
    if (url) refS.link = url; else delete refS.link;
    const st = Object.keys(refS).length ? refS : null;
    const mid = txt ? Array.from(txt).map((ch) => ({ ch, s: st ? { ...st } : null })) : chs.slice(a, b).map((c) => ({ ch: c.ch, s: st ? { ...st } : null }));
    this.clearLiveLayout();
    renderPara(d, chs.slice(0, a).concat(mid, chs.slice(b)));
    this.syncLineBreaks();
    this.placeMarks();
    this._onChange && this._onChange(this, 'style');
    return true;
  },
  // 'Metin aralığı' preview: the layout adds ls pt after every line of the
  // paragraph (between its lines and before the next paragraph), so the editor
  // grows the line height by the same amount (pt -> px through the paragraph's
  // own size) and moves the first line back up by half of it
  setLs(d, v) {
    if (v) d.dataset.ls = String(v); else delete d.dataset.ls;
    this.lsCss(d);
  },
  lsCss(d) {
    d.style.lineHeight = ''; d.style.marginTop = ''; d.style.marginBottom = '';
    const v = Number(d.dataset.ls) || 0;
    if (!v || !d.isConnected) return;
    const cs = getComputedStyle(d);
    const fs = parseFloat(cs.fontSize) || 16;
    const bs = parseFloat(cs.getPropertyValue('--bs')) || this.baseSize || 12;
    let lh = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lh)) {
      const probe = h('span', { style: 'display:inline-block;line-height:normal;text-indent:0', 'aria-hidden': 'true', contenteditable: 'false' }, 'Hg');
      d.append(probe); lh = probe.getBoundingClientRect().height || fs * 1.25; probe.remove();
    }
    const extra = v * fs / bs;
    d.style.lineHeight = Math.max(fs * 0.9, lh + extra) + 'px';
    d.style.marginTop = (-extra / 2) + 'px';
    d.style.marginBottom = (2 + extra / 2) + 'px';
  },
  refreshLs() { if (this.paper) this.paper.querySelectorAll('.te-para[data-ls]').forEach((d) => this.lsCss(d)); },
  applyLsToPara(d, val) {
    if (!d || !this.paper.contains(d)) return false;
    this.clearLiveLayout();
    const chs = readPara(d);
    for (const c of chs) {
      const s2 = { ...(c.s || {}) };
      if (val !== 0) s2.ls = Number(val); else delete s2.ls;
      c.s = Object.keys(s2).length ? s2 : null;
    }
    renderPara(d, chs);
    this.setLs(d, Number(val) || 0);
    this.syncLineBreaks();
    this.placeMarks();
    this._onChange && this._onChange(this, 'style');
    return true;
  },
  setAlign(align, { silent = false, range = null } = {}) {
    if (this.badge) return;
    this.normalize();
    this.clearLiveLayout();
    const allParas = [...this.paper.children];
    const targets = (range && !range.collapsed && range.i0 != null && range.i1 != null)
      ? allParas.slice(range.i0, range.i1 + 1)
      : allParas;
    for (const d of targets) {
      if (align) { d.dataset.align = align; d.style.textAlign = align; }
      else { delete d.dataset.align; d.style.textAlign = ''; }
    }
    this.syncLineBreaks();
    this.placeMarks();
    if (!silent && this._onChange) this._onChange(this, 'style');
  },
  getAlign() {
    if (!this.paper) return undefined;
    const ps = [...this.paper.querySelectorAll(':scope > .te-para')];
    if (!ps.length) return undefined;
    const vals = ps.map((d) => d.dataset.align || '');
    if (vals.every((v) => !v)) return undefined;
    return vals.every((v) => v === vals[0]) ? vals[0] : null;
  },
  hasAlign() {
    return !!(this.paper && this.paper.querySelector(':scope > .te-para[data-align]'));
  },
  setCheckBox(cb, { silent = false, range = null } = {}) {
    if (this.badge) return;
    this.normalize();
    this.clearLiveLayout();
    const allParas = [...this.paper.children];
    const targets = (range && !range.collapsed && range.i0 != null && range.i1 != null)
      ? allParas.slice(range.i0, range.i1 + 1)
      : allParas;
    for (const d of targets) applyCbDataset(d, cb);
    this.syncLineBreaks();
    this.placeMarks();
    if (!silent && this._onChange) this._onChange(this, 'style');
  },
  getCheckBox() {
    if (!this.paper) return undefined;
    const ps = [...this.paper.querySelectorAll(':scope > .te-para')];
    if (!ps.length) return undefined;
    const vals = ps.map(parseCbDataset);
    const sigs = vals.map(cbSig);
    if (sigs.every((v) => !v)) return undefined;
    return sigs.every((v) => v === sigs[0]) ? vals[0] : null;
  },
  clearCheckBoxOnEdge(edge, { silent = false, range = null } = {}) {
    if (this.badge) return false;
    this.normalize();
    const allParas = [...this.paper.children];
    const targets = (range && !range.collapsed && range.i0 != null && range.i1 != null) ? allParas.slice(range.i0, range.i1 + 1) : allParas;
    let changed = false;
    for (const d of targets) {
      const cb = parseCbDataset(d);
      if (cb && cb.pos === edge) { applyCbDataset(d, null); changed = true; }
    }
    if (changed) {
      this.clearLiveLayout();
      this.syncLineBreaks();
      this.placeMarks();
      if (!silent && this._onChange) this._onChange(this, 'style');
    }
    return changed;
  },
  cleanParaEdges(side, { silent = false, range = null } = {}) {
    if (this.badge) return false;
    this.normalize();
    this.clearLiveLayout();
    const allParas = [...this.paper.children];
    const targets = (range && !range.collapsed && range.i0 != null && range.i1 != null)
      ? allParas.slice(range.i0, range.i1 + 1)
      : allParas;
    let changed = false;
    for (const d of targets) {
      const chars = readPara(d);
      const txt = chars.map((c) => c.ch).join('');
      const res = side === 'left' ? cleanLeadingForCheckBox(txt) : cleanTrailingForCheckBox(txt);
      if (res.removed > 0 && res.removed < chars.length) {
        const nextChars = side === 'left' ? chars.slice(res.removed) : chars.slice(0, chars.length - res.removed);
        renderPara(d, nextChars, null);
        changed = true;
      }
    }
    if (changed) {
      this.syncLineBreaks();
      this.placeMarks();
      if (!silent && this._onChange) this._onChange(this, 'style');
    }
    return changed;
  },
  smartOrderParas(kind, startIdx = 0, { silent = false, range = null, sep = '.' } = {}) {
    if (this.badge) return { changed: false, nextIdx: startIdx };
    this.normalize();
    this.clearLiveLayout();
    const allParas = [...this.paper.children];
    const targets = (range && !range.collapsed && range.i0 != null && range.i1 != null)
      ? allParas.slice(range.i0, range.i1 + 1)
      : allParas;
    let idx = startIdx;
    let changed = false;
    for (const d of targets) {
      const chars = readPara(d);
      const txt = chars.map((c) => c.ch).join('');
      if (!txt.trim()) continue;
      const stripped = stripLeadingListPrefix(txt);
      const restChars = chars.slice(stripped.removed);
      const ref0 = (chars[0] && chars[0].s) || (restChars[0] && restChars[0].s) || null;
      let refSt = null;
      if (ref0) {
        refSt = { ...ref0 };
        delete refSt.bg;
        delete refSt.link;
        if (!Object.keys(refSt).length) refSt = null;
      }
      const prefix = smartOrderPrefix(kind, idx, sep);
      const prefixChars = Array.from(prefix).map((ch) => ({ ch, s: refSt ? { ...refSt } : null }));
      renderPara(d, prefixChars.concat(restChars), null);
      idx++;
      changed = true;
    }
    if (changed) {
      this.syncLineBreaks();
      this.placeMarks();
      if (!silent && this._onChange) this._onChange(this, 'style');
    }
    return { changed, nextIdx: idx };
  },
  value() {
    if (this.badge) {
      this.normalize();
      const chars = [...this.paper.children].flatMap((d) => readPara(d)).map((c) => (c.ch === '\n' ? { ch: ' ', s: c.s } : c)).slice(0, 5);
      const p = { text: chars.map((c) => c.ch).join(''), marker: false };
      const st = rangesOf(chars); if (st.length) p.st = st;
      return [p];
    }
    this.normalize();
    const paras = [];
    [...this.paper.children].forEach((d) => {
      const chars = readPara(d);
      const lines = [[]];
      for (const c of chars) { if (c.ch === '\n') lines.push([]); else lines[lines.length - 1].push(c); }
      const cb = parseCbDataset(d);
      lines.forEach((ln, i) => {
        const p = { text: ln.map((c) => c.ch).join(''), marker: i === 0 ? d.dataset.indent === '1' : this.newIndent };
        if (d.dataset.align) p.align = d.dataset.align;
        if (cb) p.cb = cloneCh({ ch: '', s: cb }).s;
        const st = rangesOf(ln); if (st.length) p.st = st;
        paras.push(p);
      });
    });
    while (paras.length > 1 && !paras[paras.length - 1].text.trim()) paras.pop();
    return paras;
  },
  focusEnd() { const last = this.paper.lastElementChild; this.paper.focus(); setCaret(last, readPara(last).length); },
};
