// Text verification inside the block editor (layers 3 and 4).
// Layer 1 (lost Unicode, fixed in the font reader) and layer 2 (Braille is a
// picture) already ran when the page was read. Here, after the editor is
// open and idle, lines that may still be wrong are looked at:
//   3) vector-drawn letters: glyph-sized curves in a gap of a line, confirmed
//      with the page raster that is already rendered (no new rendering);
//   4) lines that are still flagged (a broken character the font reader could
//      not resolve, or a layer-3 gap) are read with OCR in the background.
//      Unresolved glyphs are first read one by one (once per font + code),
//      then the line. Only the flagged spots are corrected, never anything
//      else, and never a paragraph the user has already changed.
// Results are cached per area, so re-opening is free.
import { h } from '../../common/dom.js';
import { t } from '../../../i18n/i18n.js';
import { findInkGaps, rasterRegion } from '../../../engines/verify/inkCheck.js';
import { proposeLineFix } from '../../../engines/verify/lineFix.js';
import { isBadUni } from '../../../engines/pdf/glyphRecover.js';
import { readPara, rangesOf } from '../richText.js';

const cache = new WeakMap(); // analysis -> Map(key -> result)
const perArea = (an) => { let m = cache.get(an); if (!m) cache.set(an, (m = new Map())); return m; };
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 600 }) : setTimeout(fn, 60));
const LETTER = /^\p{L}$/u;
let ocrMod = null;
const ocr = () => (ocrMod || (ocrMod = import('../../../engines/ocr/ocr.js')));

function srcPageOf(app, an) {
  const s = app.session;
  return (s.pages || []).find((p) => p.srcIndex != null && s.analysis(p.srcIndex) === an) || null;
}
// the page raster that the workspace already drew for this source page
async function pageRaster(app, an) {
  const rc = app.rasters, pg = srcPageOf(app, an);
  if (!rc || !rc.map || !pg) return null;
  let best = null;
  for (const [k, p] of rc.map) {
    const [id, sc, white] = k.split('|');
    if (id !== pg.id || white !== '0') continue;
    if (!best || +sc > best.scale) best = { scale: +sc, p };
  }
  if (!best) return null;
  try { return { canvas: await best.p, scale: best.scale }; } catch (e) { return null; }
}

const linesBox = (ls, padL = 1, padR = 1) => {
  const sz = Math.max(...ls.map((l) => l.size || 10));
  return { x0: Math.min(...ls.map((l) => l.left)) - padL * sz, x1: Math.max(...ls.map((l) => l.right)) + padR * sz, y0: Math.min(...ls.map((l) => l.baseline)) - 1.2 * sz, y1: Math.max(...ls.map((l) => l.baseline)) + 0.4 * sz };
};

export function inkGapsFor(an, sec, raster) {
  const m = sec.model;
  const key = 'ink' + JSON.stringify([m.partSrc, m.text]);
  const per = perArea(an);
  if (per.has(key)) return per.get(key);
  let gaps = [];
  try {
    const region = raster ? rasterRegion(raster.canvas, raster.scale, linesBox(m.lines)) : null;
    gaps = region ? findInkGaps(m, an.atoms.gfx, region) : [];
  } catch (e) { console.warn(e); gaps = []; }
  per.set(key, gaps);
  return gaps;
}

// ---- layer 1c: one unresolved glyph, read alone ----
function glyphCanvas(u) {
  const em = u.em || 1000, S = 90 / em, pad = 30, gap = 0.08 * em;
  const parts = u.ref ? [u.ref.cs, u.cs, u.ref.cs] : [u.cs];
  const boxes = parts.map((cs) => { const xs = cs.flat().map((p) => p[0]); return { x0: Math.min(...xs), x1: Math.max(...xs) }; });
  const W = boxes.reduce((w, b) => w + (b.x1 - b.x0) + gap, -gap);
  const c = document.createElement('canvas');
  c.width = Math.ceil(W * S) + 2 * pad; c.height = Math.ceil(1.35 * em * S) + 2 * pad;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  let x = 0;
  parts.forEach((cs, i) => {
    g.setTransform(S, 0, 0, -S, pad + (x - boxes[i].x0) * S, pad + 1.0 * em * S);
    g.beginPath();
    for (const ct of cs) { ct.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }
    g.fill('nonzero');
    x += boxes[i].x1 - boxes[i].x0 + gap;
  });
  return c;
}
async function resolveGlyph(an, font, code) {
  font._ocrTried = font._ocrTried || new Map();
  if (font._ocrTried.has(code)) return font._ocrTried.get(code);
  const u = font.unresolved && font.unresolved.get(code);
  let ch = null;
  if (u && u.cs && u.cs.length) {
    try {
      const o = await ocr();
      if (u.ref) {
        // "n?n": the neighbours must be read back as themselves
        const r = await o.ocrLine(glyphCanvas(u));
        const txt = [...r.text.replace(/\s+/g, '')];
        if (r.confidence >= 60 && txt.length === 3 && txt[0] === u.ref.ch && txt[2] === u.ref.ch && LETTER.test(txt[1])) ch = txt[1];
      } else {
        const r = await o.ocrGlyph(glyphCanvas(u));
        const txt = r.text.trim();
        if (r.confidence >= 70 && LETTER.test(txt)) ch = txt;
      }
    } catch (e) { ch = null; }
  }
  font._ocrTried.set(code, ch);
  if (ch) {
    font.toUni.set(code, ch);
    if (!font.fromUni.has(ch)) font.fromUni.set(ch, code);
    if (font.recovered) font.recovered.set(code, { ch, how: 'ocr' });
    font.unresolved.delete(code);
    // every place this glyph is used on the page now reads correctly
    for (const l of an.seg.textAtoms) {
      let hit = false;
      for (const it of l.glyphs) if (it.g && it.g.font === font && it.g.code === code) { it.g.uni = ch; it.uni = ch; it.space = false; hit = true; }
      if (hit) l.text = l.glyphs.map((x) => x.uni).join('');
    }
  }
  return ch;
}

// ---- layer 4: one line image ----
async function lineImage(app, an, ls, raster) {
  const sz = Math.max(...ls.map((l) => l.size || 10));
  const box = linesBox(ls, 0.4, 0.8);
  const want = Math.max(1, Math.min(8, 42 / sz));
  if (raster && raster.scale >= want * 0.75) {
    const r = rasterRegion(raster.canvas, raster.scale, box);
    if (r) { const c = document.createElement('canvas'); c.width = r.width; c.height = r.height; c.getContext('2d').putImageData(new ImageData(r.data, r.width, r.height), 0, 0); return c; }
  }
  const pg = srcPageOf(app, an);
  if (!pg || !app.session.pdfjs) return null;
  const page = await app.session.pdfjs.getPage(pg.srcIndex + 1);
  const vp = page.getViewport({ scale: want, offsetX: -box.x0 * want, offsetY: -box.y0 * want });
  const c = document.createElement('canvas');
  c.width = Math.ceil((box.x1 - box.x0) * want); c.height = Math.ceil((box.y1 - box.y0) * want);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp, background: 'rgba(255,255,255,1)' }).promise;
  return c;
}

// edits for one section: [{ at, del, ins, kind, gfx? }]
async function verifySection(app, an, s, gaps, raster, alive) {
  const m = s.model, text = m.text;
  const bad = [];
  for (let i = 0; i < text.length; i++) if (isBadUni(text[i])) bad.push(i);
  if (!bad.length && !gaps.length) return [];
  // 1c) unresolved glyphs, once per font + code
  for (const i of bad) {
    const it = m.charGlyph[i];
    if (!alive()) return [];
    if (it && it.g && it.g.font && it.g.font.unresolved && it.g.font.unresolved.has(it.g.code)) await resolveGlyph(an, it.g.font, it.g.code);
  }
  const edits = [];
  const fixed = new Set();
  for (const i of bad) { const it = m.charGlyph[i]; if (it && it.uni && !isBadUni(it.uni)) { edits.push({ at: i, del: 1, ins: it.uni, kind: 'char' }); fixed.add(i); } }
  // 4) line OCR where something is still flagged
  const per = perArea(an);
  for (let li = 0; li < m.lines.length; li++) {
    const l = m.lines[li];
    const own = new Set(l.glyphs);
    let ls = Infinity, le = -1;
    m.charGlyph.forEach((g, i) => { if (g && own.has(g)) { ls = Math.min(ls, i); le = Math.max(le, i); } });
    if (le < 0) continue;
    le += 1;
    const lineBad = bad.filter((i) => i >= ls && i < le && !fixed.has(i));
    const lineGaps = gaps.filter((g) => g.line === li);
    if (!lineBad.length && !lineGaps.length) continue;
    if (!alive()) return [];
    const lineText = text.slice(ls, le);
    const key = 'ocr' + JSON.stringify([l.baseline, l.left, lineText]);
    let res = per.get(key);
    if (res === undefined) {
      res = null;
      try {
        const c = await lineImage(app, an, [l], raster);
        if (c) res = await (await ocr()).ocrLine(c);
      } catch (e) { console.warn('ocr', e); res = null; }
      per.set(key, res);
    }
    if (!res || res.confidence < 55) continue;
    const fix = proposeLineFix(lineText, res.text, { gaps: lineGaps.map((g) => ({ pos: g.pos - ls, bodyH: g.bodyH })) });
    if (!fix) continue;
    for (const e of fix.edits) {
      const ed = { ...e, at: e.at + ls };
      if (e.kind === 'gap') { const g = lineGaps.find((q) => q.pos - ls >= e.at && q.pos - ls <= e.at + e.del); if (g) ed.gfx = g.gfx; }
      else { const it = m.charGlyph[ed.at]; if (it) { it.uni = e.ins; it.space = false; } }
      edits.push(ed);
    }
  }
  return edits.sort((a, b) => a.at - b.at);
}

// position mapping for style ranges after replacing [at, at+del) by ins
function shiftRanges(st, edits) {
  if (!st || !st.length) return undefined;
  const map = (x, end) => {
    let d = 0;
    for (const e of edits) {
      const after = end ? x > e.at + e.del : x >= e.at + e.del;
      if (after) { d += e.ins.length - e.del; continue; }
      if (end ? x >= e.at : x > e.at) return e.at + d + e.ins.length; // inside / touching: the new text joins the range
      break;
    }
    return x + d;
  };
  const out = st.map((r) => ({ ...r, a: map(r.a, false), b: map(r.b, true) })).filter((r) => r.b > r.a);
  return out.length ? out : undefined;
}

function applyToSection(st, s, edits) {
  const m = s.model, ed = s.ed;
  if (!edits.length || !ed || s.o.deleted || s.cellDeleted) return 0;
  const paras = m.text.split('\n');
  const starts = []; paras.reduce((p, x) => { starts.push(p); return p + x.length + 1; }, 0);
  const kids = [...ed.paper.children];
  if (kids.length !== paras.length) return 0; // paragraphs were split/joined: the user edited
  let n = 0;
  const drops = [];
  paras.forEach((orig, pi) => {
    const mine = edits.filter((e) => e.at >= starts[pi] && e.at <= starts[pi] + orig.length).map((e) => ({ ...e, at: e.at - starts[pi] }));
    if (!mine.length) return;
    const cur = readPara(kids[pi]);
    if (cur.map((c) => c.ch).join('') !== orig) return; // never overwrite the user's own change
    let next = orig;
    for (const e of mine.slice().sort((a, b) => b.at - a.at)) next = next.slice(0, e.at) + e.ins + next.slice(e.at + e.del);
    const stCur = rangesOf(cur);
    const caretShift = (c) => mine.filter((e) => e.at < c).reduce((d, e) => d + e.ins.length - e.del, 0);
    if (ed.replacePara(pi, next, shiftRanges(stCur, mine), caretShift)) {
      n += mine.length;
      for (const e of mine) if (e.gfx) drops.push({ pi, orig, gfx: e.gfx });
    }
  });
  if (drops.length) {
    // the curves a repaired letter replaces are left out - unless the user
    // undoes the repair (then the paragraph reads like the original again)
    const own = m.extraDropGfx || [];
    Object.defineProperty(m, 'extraDropGfx', {
      configurable: true,
      get: () => {
        const ks = [...ed.paper.children];
        const live = drops.filter((d) => ks[d.pi] && readPara(ks[d.pi]).map((c) => c.ch).join('') !== d.orig);
        return [...own, ...new Set(live.flatMap((d) => d.gfx))];
      },
    });
  }
  if (n) st.touchedTextObjs.add(s.o);
  return n;
}

export function setupAeVerify(st) {
  const { app, an, sections, ready } = st;
  st.verify = { done: false, gaps: new Map(), fixes: 0, ocrLines: 0 };
  if (!an) return;
  const secs = sections.filter((s) => !s.badge && s.model && s.model.lines && s.model.lines.length && s.model.charGlyph);
  if (!secs.length) { st.verify.done = true; return; }
  const alive = () => !!(st.m && st.m.modal && st.m.modal.isConnected);
  ready.then(() => idle(async () => {
    const raster = await pageRaster(app, an);
    // layer 3
    for (const s of secs) {
      const g = inkGapsFor(an, s, raster);
      if (g.length) st.verify.gaps.set(s, g);
    }
    // layer 4 (only when something is still flagged)
    const work = secs.filter((s) => st.verify.gaps.has(s) || [...s.model.text].some((c) => isBadUni(c)));
    if (!work.length || !alive()) { st.verify.done = true; return; }
    const head = st.m.modal.querySelector('.modal-head');
    const badge = h('span', { class: 'ae-verify', 'data-testid': 'ae-verify' }, t('aeVerifying'));
    if (head) head.append(badge);
    let fixes = 0;
    try {
      for (const s of work) {
        const edits = await verifySection(app, an, s, st.verify.gaps.get(s) || [], raster, alive);
        if (!alive()) break;
        fixes += applyToSection(st, s, edits);
      }
    } catch (e) { console.warn('verify', e); }
    st.verify.fixes = fixes;
    if (fixes && alive()) {
      try { await st.flushTextSync({ renderPreview: true }); st.commitSnap(); } catch (e) { console.warn(e); }
      badge.textContent = t('aeVerified');
      badge.classList.add('ok');
      setTimeout(() => badge.remove(), 2600);
    } else badge.remove();
    st.verify.done = true;
  }));
}
