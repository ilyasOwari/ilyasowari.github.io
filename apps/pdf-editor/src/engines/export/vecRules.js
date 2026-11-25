// Frames, rules and underlines of a stretched object part are redrawn as the
// app's own vector lines instead of being cut/stretched with the artwork:
// their ends follow the part's new geometry (grow as the text grows, shrink
// when lines are removed) while thickness, colour and dash stay the same, and
// a crop can never erase them.
import { fmtNum as f } from '../pdf/lexer.js';

const thinMax = 3.2;
// classify one gfx atom (UI coords) as a straight line / frame, or null
export function lineOf(atom) {
  const it = atom && atom.item;
  if (!it || it.kind !== 'path' || it.isClip || (it.ca ?? 1) < 0.99 || (it.CA ?? 1) < 0.99) return null;
  if (it.rawBox && it.bbox && (Math.abs(it.rawBox.x0 - it.bbox.x0) > 0.2 || Math.abs(it.rawBox.x1 - it.bbox.x1) > 0.2 || Math.abs(it.rawBox.y0 - it.bbox.y0) > 0.2 || Math.abs(it.rawBox.y1 - it.bbox.y1) > 0.2)) return null; // clipped drawing
  const b = atom.b, w = b.x1 - b.x0, h = b.y1 - b.y0;
  const rgb = (c) => (c || [0, 0, 0]).map((v) => Math.max(0, Math.min(255, v)));
  const style = { dash: it.dash && it.dash.arr.some((v) => v > 0.01) ? it.dash : null, cap: it.cap || 0 };
  const boxy = !!(it.isRect || it.axisBox);
  if (it.fill && !it.stroke && boxy) {
    if (h <= thinMax && w >= Math.max(6, h * 4)) return { dir: 'h', a: b.x0, b: b.x1, c: (b.y0 + b.y1) / 2, t: h, fill: rgb(it.fillRgb), ...style, dash: null };
    if (w <= thinMax && h >= Math.max(6, w * 4)) return { dir: 'v', a: b.y0, b: b.y1, c: (b.x0 + b.x1) / 2, t: w, fill: rgb(it.fillRgb), ...style, dash: null };
    return null;
  }
  if (it.stroke && !it.fill && (it.nSub || 1) === 1) {
    const lw = it.lw || 1, hl = lw / 2;
    if (boxy && w > lw + 3 && h > lw + 3) return { dir: 'r', x0: b.x0 + hl, y0: b.y0 + hl, x1: b.x1 - hl, y1: b.y1 - hl, t: lw, stroke: rgb(it.strokeRgb), ...style };
    if (h <= lw + 1.2 && w >= 6) return { dir: 'h', a: b.x0 + hl, b: b.x1 - hl, c: (b.y0 + b.y1) / 2, t: lw, stroke: rgb(it.strokeRgb), ...style };
    if (w <= lw + 1.2 && h >= 6) return { dir: 'v', a: b.y0 + hl, b: b.y1 - hl, c: (b.x0 + b.x1) / 2, t: lw, stroke: rgb(it.strokeRgb), ...style };
  }
  return null;
}

// does the part change its geometry (so the original artwork gets cut/stretched)?
export function partStretched(part) {
  if (!part || !part.obj) return false;
  if (part.nine) return Math.abs(part.nine.w - part.src.w) > 0.3 || Math.abs(part.nine.h - part.src.h) > 0.3;
  const e = part.edit;
  if (!e) return false;
  return Math.abs(e.deltaX || 0) > 0.01 || (e.deltaLeft || 0) > 0.01 || Math.abs(e.delta || 0) > 0.01 || (e.deltaTop || 0) > 0.01
    || (Array.isArray(e.cuts) && e.cuts.length > 0) || (Array.isArray(e.colCuts) && e.colCuts.length > 0);
}

// gfx indexes of `part.keep` that are redrawn as vectors (only for stretched parts)
export function vecRuleIdx(an, part) {
  if (!partStretched(part) || !an || !an.atoms) return [];
  return (part.keep || []).filter((gi) => !!lineOf(an.atoms.gfx[gi]));
}

// source -> destination mapping along one axis from the part's slices
export function axisMap(spans) {
  const sp = spans.slice().sort((p, q) => p.s - q.s);
  return (v) => {
    for (const r of sp) if (v >= r.s - 0.01 && v <= r.s + r.l + 0.01) return r.s + r.d + (v - r.s) * r.k;
    // inside a cropped gap: snap to where the following content now starts
    const nx = sp.find((r) => r.s > v);
    if (nx) return nx.s + nx.d;
    const last = sp[sp.length - 1];
    return last ? last.s + last.d + last.l * last.k : v;
  };
}
export function sliceMaps(slices) {
  const xs = new Map(), ys = new Map();
  for (const s of slices) {
    xs.set(`${s.sx}|${s.sw}`, { s: s.sx, l: s.sw, d: s.dx, k: s.kx || 1 });
    ys.set(`${s.sy}|${s.sh}`, { s: s.sy, l: s.sh, d: s.dy, k: s.ky || 1 });
  }
  return { mx: axisMap([...xs.values()]), my: axisMap([...ys.values()]) };
}

const col = (c) => c.map((v) => f(v / 255)).join(' ');
const dashOp = (L) => (L.dash ? `[${L.dash.arr.map(f).join(' ')}] ${f(L.dash.ph || 0)} d ` : '');
// drawing ops (UI coords; caller wraps them in `q <Minv> cm ... Q`) for one line after mapping
export function lineOps(L, mx, my) {
  if (L.dir === 'r') {
    const x0 = mx(L.x0), x1 = mx(L.x1), y0 = my(L.y0), y1 = my(L.y1);
    if (x1 - x0 < 0.3 || y1 - y0 < 0.3) return '';
    return `q ${col(L.stroke)} RG ${f(L.t)} w ${L.cap} J ${dashOp(L)}${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)} re S Q`;
  }
  const h = L.dir === 'h';
  const a = h ? mx(L.a) : my(L.a), b = h ? mx(L.b) : my(L.b), c = h ? my(L.c) : mx(L.c);
  if (b - a < 0.3) return '';
  if (L.fill) {
    const r = h ? [a, c - L.t / 2, b - a, L.t] : [c - L.t / 2, a, L.t, b - a];
    return `q ${col(L.fill)} rg ${r.map(f).join(' ')} re f Q`;
  }
  const seg = h ? `${f(a)} ${f(c)} m ${f(b)} ${f(c)} l` : `${f(c)} ${f(a)} m ${f(c)} ${f(b)} l`;
  return `q ${col(L.stroke)} RG ${f(L.t)} w ${L.cap} J ${dashOp(L)}${seg} S Q`;
}
// all vector lines of a part, mapped through its slices
export function vecRuleOps(an, part, slices) {
  const idx = vecRuleIdx(an, part);
  if (!idx.length) return [];
  const { mx, my } = sliceMaps(slices);
  return idx.map((gi) => lineOps(lineOf(an.atoms.gfx[gi]), mx, my)).filter(Boolean);
}
