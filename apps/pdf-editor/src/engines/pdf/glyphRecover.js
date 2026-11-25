// Layer 1 of text verification: glyphs that are drawn (have ink) but whose
// Unicode value is missing or broken (empty, U+0000, control, U+FFFD, private
// use). Typical cause: a design tool's Turkish 'locl' feature swaps "i" for a
// separate "i.TRK" glyph that gets no ToUnicode entry (-> U+0000).
// Each font + code is resolved ONCE, synchronously, at the first time the
// interpreter meets it:
//   (a) a meaningful glyph name (name-keyed CFF / Differences),
//   (b) shape: the glyph's outline is rasterised and compared with the glyphs
//       of the same font whose Unicode IS known; failing that, it is split into
//       a base shape + marks above (dotless ı + dot -> i, u + two dots -> ü ...).
// Unresolved glyphs are kept in info.unresolved for the async OCR layer.
// Known-good mappings are never touched.
import { parseCFF } from './cffOutline.js';
import { glyphNameToUnicode } from './encodings.js';

export function isBadUni(u) {
  if (u == null || u === '') return true;
  for (const ch of u) {
    const c = ch.codePointAt(0);
    if (c < 32 || c === 0x7F || c === 0xFFFD || (c >= 0xE000 && c <= 0xF8FF) || (c >= 0xF0000)) return true;
  }
  return false;
}

// ---- rasteriser (nonzero winding, scanline) ----
const GRID = 44; // px per em
export function rasterize(contours, em, frame) {
  const s = GRID / em;
  const W = Math.ceil((frame.x1 - frame.x0) * s) + 1, H = Math.ceil((frame.y1 - frame.y0) * s) + 1;
  const bm = new Uint8Array(W * H);
  const edges = [];
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      if (a[1] === b[1]) continue;
      edges.push([(a[0] - frame.x0) * s, (frame.y1 - a[1]) * s, (b[0] - frame.x0) * s, (frame.y1 - b[1]) * s]);
    }
  }
  const xs = [];
  for (let row = 0; row < H; row++) {
    const y = row + 0.5;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push([x0 + (y - y0) * (x1 - x0) / (y1 - y0), y1 > y0 ? 1 : -1]);
    }
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    for (let i = 0; i < xs.length; i++) {
      const prev = wind; wind += xs[i][1];
      if (prev === 0 && wind !== 0) {
        let j = i + 1, w2 = wind;
        while (j < xs.length) { w2 += xs[j][1]; if (w2 === 0) break; j++; }
        const xa = Math.max(0, Math.round(xs[i][0])), xb = Math.min(W, Math.round(j < xs.length ? xs[j][0] : W));
        for (let x = xa; x < xb; x++) bm[row * W + x] = 1;
      }
    }
  }
  return { bm, W, H };
}

function iou(A, B, dx = 0, dy = 0) {
  let inter = 0, uni = 0;
  const { W, H } = A;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = A.bm[y * W + x];
    const bx = x + dx, by = y + dy;
    const b = bx >= 0 && by >= 0 && bx < W && by < H ? B.bm[by * W + bx] : 0;
    if (a || b) { uni++; if (a && b) inter++; }
  }
  return uni ? inter / uni : 0;
}
const bestIou = (A, B) => { let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, iou(A, B, dx, dy)); return m; };

const bboxOf = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; };
const ovl = (a, b, pad) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;

// contours -> connected components (by touching bounding boxes)
function components(contours, em) {
  const items = contours.map((c) => ({ c, b: bboxOf(c) }));
  const comps = [];
  for (const it of items) {
    const hit = comps.filter((k) => ovl(k.b, it.b, em * 0.004));
    const merged = { cs: [it.c], b: { ...it.b } };
    for (const k of hit) { merged.cs.push(...k.cs); merged.b = { x0: Math.min(merged.b.x0, k.b.x0), y0: Math.min(merged.b.y0, k.b.y0), x1: Math.max(merged.b.x1, k.b.x1), y1: Math.max(merged.b.y1, k.b.y1) }; comps.splice(comps.indexOf(k), 1); }
    comps.push(merged);
  }
  return comps;
}

const LOWER_X = 'xvwzunmroesac';
const DOTLESS = { 'ı': 'i', 'ȷ': 'j' };

// source: { em, outline(code) -> contours|null, name(code) -> string|null }
export function makeRecoverer(info, source) {
  const cache = new Map();
  let known = null, frame = null, xh = 0;
  const buildKnown = () => {
    known = [];
    const entries = [...info.toUni.entries()].filter(([, u]) => !isBadUni(u) && [...u].length === 1 && /\p{L}|\p{N}/u.test(u)).slice(0, 700);
    const em = source.em;
    frame = { x0: -0.15 * em, x1: 1.25 * em, y0: -0.35 * em, y1: 1.05 * em };
    for (const [code, ch] of entries) {
      let cs = null; try { cs = source.outline(code); } catch (e) { cs = null; }
      if (!cs || !cs.length) continue;
      known.push({ ch, code, cs, r: rasterize(cs, em, frame) });
    }
    const xg = known.find((k) => LOWER_X.includes(k.ch));
    if (xg) xh = bboxOf(xg.cs.flat()).y1;
    else xh = info.descriptor && info.descriptor.xHeight ? info.descriptor.xHeight * em / 1000 : 0.5 * em;
  };
  const matchShape = (cs, exclude) => {
    const R = rasterize(cs, source.em, frame);
    let best = null, second = null;
    for (const k of known) {
      if (exclude && exclude(k)) continue;
      const v = bestIou(R, k.r);
      if (!best || v > best.v) { if (best && best.ch !== k.ch) second = best; best = { ch: k.ch, v }; }
      else if (k.ch !== best.ch && (!second || v > second.v)) second = { ch: k.ch, v };
    }
    if (best && best.v >= 0.9 && (!second || best.v - second.v >= 0.04)) return best.ch;
    return null;
  };
  const resolve = (code) => {
    // (a) glyph name
    const nm = source.name ? source.name(code) : null;
    if (nm && !/^(\.notdef|cid\d+|g\d+|glyph\d+|index\d+)$/i.test(nm)) {
      const u = glyphNameToUnicode(nm);
      if (u && !isBadUni(u)) return { ch: u, how: 'name' };
    }
    let cs = null; try { cs = source.outline(code); } catch (e) { cs = null; }
    if (!cs || !cs.length) return null; // no ink: not a lost letter
    if (!known) buildKnown();
    if (!known.length || globalThis.__pfVerifyNoShape) return { unresolved: true, cs }; // (test switch: OCR-only)
    // (b1) whole-glyph match
    const whole = matchShape(cs);
    if (whole) return { ch: whole, how: 'shape' };
    // (b2) base + marks above the x-height
    const comps = components(cs, source.em);
    const marks = comps.filter((k) => k.b.y0 >= xh * 0.92 && (k.b.y1 - k.b.y0) < 0.3 * source.em);
    const base = comps.filter((k) => !marks.includes(k));
    if (marks.length && base.length && marks.length <= 2) {
      const baseCs = base.flatMap((k) => k.cs);
      let bch = matchShape(baseCs);
      // the font may lack a dotless ı / ȷ to compare with: a plain narrow stem
      // standing on the baseline up to the x-height (or down into the
      // descender) is one
      if (!bch && base.length === 1 && base[0].cs.length === 1) {
        const b0 = base[0].b, em = source.em;
        const narrow = b0.x1 - b0.x0 < 0.26 * em;
        const solid = (() => { const R = rasterize(baseCs, em, frame); let on = 0; for (const v of R.bm) on += v; const s = GRID / em; return on / Math.max(1, ((b0.x1 - b0.x0) * s) * ((b0.y1 - b0.y0) * s)) > 0.4; })();
        if (narrow && solid && Math.abs(b0.y1 - xh) < 0.12 * xh) {
          if (Math.abs(b0.y0) < 0.03 * em) bch = 'ı';
          else if (b0.y0 < -0.12 * em) bch = 'ȷ';
        }
      }
      if (bch) {
        const bb = bboxOf(baseCs.flat());
        const cx = (bb.x0 + bb.x1) / 2;
        const round = (k) => { const w = k.b.x1 - k.b.x0, h = k.b.y1 - k.b.y0; return w > 0 && h > 0 && w / h < 1.8 && h / w < 1.8 && w < 0.32 * source.em; };
        let mark = null;
        if (marks.length === 1 && round(marks[0]) && Math.abs((marks[0].b.x0 + marks[0].b.x1) / 2 - cx) < 0.25 * source.em) mark = '\u0307';
        else if (marks.length === 2 && marks.every(round) && Math.abs(((marks[0].b.x0 + marks[0].b.x1 + marks[1].b.x0 + marks[1].b.x1) / 4) - cx) < 0.25 * source.em) mark = '\u0308';
        if (mark) {
          if (mark === '\u0307' && DOTLESS[bch]) return { ch: DOTLESS[bch], how: 'compose' };
          const comp = (bch + mark).normalize('NFC');
          if ([...comp].length === 1) return { ch: comp, how: 'compose' };
        }
      }
    }
    return { unresolved: true, cs };
  };
  // (shared Map objects: the font record handed out by FontCache is a copy)
  info.recovered = info.recovered || new Map();
  info.unresolved = info.unresolved || new Map();
  return (code) => {
    if (cache.has(code)) return cache.get(code);
    let r = null;
    try { r = resolve(code); } catch (e) { r = null; }
    let ch = null;
    if (r && r.ch) {
      ch = r.ch;
      info.toUni.set(code, ch);
      if (!info.fromUni.has(ch)) info.fromUni.set(ch, code);
      info.recovered.set(code, { ch, how: r.how });
    } else if (r && r.unresolved) {
      // a known lowercase letter of the same font, drawn on both sides of the
      // glyph when it is read with OCR (gives OCR the x-height: "i" vs "İ")
      const ref = (known || []).find((k) => 'nouvxz'.includes(k.ch)) || (known || []).find((k) => /^[a-z]$/.test(k.ch)) || null;
      info.unresolved.set(code, { cs: r.cs, em: source.em, ref: ref ? { ch: ref.ch, cs: ref.cs } : null });
    }
    cache.set(code, ch);
    return ch;
  };
}

// glyph source for the font programs we can read
export function glyphSource(info, programBytes, fontkit, cidToGid) {
  if (info.programType === 'cff' && !info.isType3) {
    const cff = parseCFF(programBytes);
    if (info.isType0) {
      if (!info.identity) return null;
      return { em: 1000, outline: (code) => cff.outline(cff.gidForCID(code)), name: (code) => cff.glyphName(cff.gidForCID(code)) };
    }
    const nameOf = (code) => (info.diffs && info.diffs.get(code)) || null;
    return { em: 1000, outline: (code) => { const n = nameOf(code); return n ? cff.outline(cff.gidForName(n)) : null; }, name: nameOf };
  }
  if ((info.programType === 'truetype' || info.programType === 'opentype') && fontkit) {
    const fk = fontkit.create(programBytes);
    const em = fk.unitsPerEm || 1000;
    const gidOf = (code) => {
      if (info.isType0) return cidToGid ? (cidToGid(code) ?? code) : code;
      let g = null; try { g = fk.glyphForCodePoint(code); } catch (e) { g = null; }
      if (!g || !g.id) { try { g = fk.getGlyph(code); } catch (e) { g = null; } }
      return g ? g.id : -1;
    };
    const outline = (code) => {
      const gid = gidOf(code); if (gid <= 0) return null;
      const g = fk.getGlyph(gid); if (!g) return null;
      const cs = []; let cur = null, x = 0, y = 0;
      for (const c of g.path.commands) {
        const a = c.args;
        if (c.command === 'moveTo') { if (cur && cur.length > 1) cs.push(cur); cur = [[a[0], a[1]]]; x = a[0]; y = a[1]; }
        else if (c.command === 'lineTo') { (cur ||= [[x, y]]).push([a[0], a[1]]); x = a[0]; y = a[1]; }
        else if (c.command === 'quadraticCurveTo') { cur ||= [[x, y]]; for (let i = 1; i <= 4; i++) { const t = i / 4, u = 1 - t; cur.push([u * u * x + 2 * u * t * a[0] + t * t * a[2], u * u * y + 2 * u * t * a[1] + t * t * a[3]]); } x = a[2]; y = a[3]; }
        else if (c.command === 'bezierCurveTo') { cur ||= [[x, y]]; for (let i = 1; i <= 6; i++) { const t = i / 6, u = 1 - t; cur.push([u * u * u * x + 3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t * t * t * a[4], u * u * u * y + 3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t * t * t * a[5]]); } x = a[4]; y = a[5]; }
        else if (c.command === 'closePath') { if (cur && cur.length > 1) cs.push(cur); cur = null; }
      }
      if (cur && cur.length > 1) cs.push(cur);
      return cs;
    };
    let name = null;
    try { if (fk.post && fk.post.version === 2) name = (code) => { const gid = gidOf(code); const g = gid > 0 ? fk.getGlyph(gid) : null; return g ? g.name : null; }; } catch (e) { name = null; }
    return { em, outline, name };
  }
  return null;
}

// ---- Layer 2: Braille fonts ----
// A Braille font draws 2x3 (or 2x4) dot cells but maps them to Latin letters,
// often with odd case ("ilÇe SaĞlIk"): such runs are pictures, never text.
// Recognised by name, or by shape: sampled letter glyphs consist only of 1-8
// equal round dots placed on a grid of at most 2 columns x 4 rows.
export function looksLikeBrailleCell(cs, em) {
  if (!cs || !cs.length) return false;
  const comps = components(cs, em);
  if (comps.length < 1 || comps.length > 8) return false;
  const ws = comps.map((k) => k.b.x1 - k.b.x0), hs = comps.map((k) => k.b.y1 - k.b.y0);
  const d = Math.max(...ws, ...hs);
  if (d <= 0 || d > 0.35 * em) return false;
  for (let i = 0; i < comps.length; i++) {
    if (ws[i] / hs[i] > 1.35 || hs[i] / ws[i] > 1.35 || ws[i] < 0.6 * d || hs[i] < 0.6 * d) return false;
  }
  const cols = [], rows = [];
  const near = (arr, v) => arr.some((a) => Math.abs(a - v) < 0.6 * d);
  for (const k of comps) {
    const cx = (k.b.x0 + k.b.x1) / 2, cy = (k.b.y0 + k.b.y1) / 2;
    if (!near(cols, cx)) cols.push(cx);
    if (!near(rows, cy)) rows.push(cy);
  }
  return cols.length <= 2 && rows.length <= 4;
}
export function detectBraille(info, source) {
  if (/braille/i.test(info.baseFont || '')) return true;
  if (!source) return false;
  const codes = [...info.toUni.entries()].filter(([, u]) => /^\p{L}$/u.test(u)).map(([c]) => c).slice(0, 14);
  if (codes.length < 4) return false;
  let yes = 0, n = 0;
  for (const c of codes) {
    let cs = null; try { cs = source.outline(c); } catch (e) { cs = null; }
    if (!cs || !cs.length) continue;
    n++; if (looksLikeBrailleCell(cs, source.em)) yes++;
  }
  return n >= 4 && yes / n >= 0.85;
}
