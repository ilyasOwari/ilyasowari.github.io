// Semantic block segmentation: paragraphs, containers (box + everything inside),
// badges glued to their text, captions glued to images, and row groups.
import { unionBox, boxArea, intersectBox } from '../../core/geometry.js';

class UF {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[b] = a; }
  dbg(a, b, why, atoms) { if (globalThis.SEG_DEBUG) { const f = (x) => [x.b.x0, x.b.y0, x.b.x1, x.b.y1].map((v) => v.toFixed(0)).join(','); console.log('U', why, atoms[a].kind, f(atoms[a]), atoms[b].kind, f(atoms[b])); } this.union(a, b); }
}
const vOverlap = (a, b) => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const hOverlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
const hGap = (a, b) => Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
const vGap = (a, b) => Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);

const big = (g) => (g.b.x1 - g.b.x0) > 18 && (g.b.y1 - g.b.y0) > 18;
const sameColor = (a, b) => a.rgb && b.rgb && Math.abs(a.rgb[0] - b.rgb[0]) + Math.abs(a.rgb[1] - b.rgb[1]) + Math.abs(a.rgb[2] - b.rgb[2]) < 0.06;
// two graphics count as one drawing only when they really touch
function touches(A, B) {
  const gx = hGap(A.b, B.b), gy = vGap(A.b, B.b);
  if (gx >= 0.8 || gy >= 0.8) return false;
  if (gx <= 0 && gy <= 0) return true;
  // an edge-to-edge contact between a large panel/tile and anything of another colour is a layout gap
  if ((big(A) || big(B)) && !sameColor(A, B)) return false;
  return Math.max(gx, gy) < 0.8;
}

export function findLineBgBox(l, gfx, bounds = null) {
  if (!gfx || !gfx.length) return null;
  const cx = (l.b.x0 + l.b.x1) / 2, cy = (l.b.y0 + l.b.y1) / 2;
  const lw = Math.max(1, l.b.x1 - l.b.x0), lh = Math.max(1, l.b.y1 - l.b.y0);
  const bArea = bounds ? (bounds.w ?? (bounds.x1 - bounds.x0)) * (bounds.h ?? (bounds.y1 - bounds.y0)) : Infinity;
  let best = null, bestA = Infinity;
  for (const a of gfx) {
    if (a.kind !== 'path' || !(a.fill || a.stroke)) continue;
    const ab = a.b;
    if (cx < ab.x0 - 1 || cx > ab.x1 + 1 || cy < ab.y0 - 1 || cy > ab.y1 + 1) continue;
    const ah = ab.y1 - ab.y0, aw = ab.x1 - ab.x0, area = aw * ah;
    if (bounds && area > 0.55 * bArea) continue;
    if (ah > Math.max(6 * (l.size || 10), 4.5 * lh)) continue;
    const ox = Math.min(ab.x1, l.b.x1) - Math.max(ab.x0, l.b.x0);
    if (ox < 0.55 * lw) continue;
    if (area < bestA) { bestA = area; best = a; }
  }
  return best;
}

export function buildParagraphs(lines, gfx = null, bounds = null) {
  const sorted = [...lines].sort((a, b) => a.b.y0 - b.b.y0 || a.b.x0 - b.b.x0);
  if (gfx) for (const l of sorted) l._bgBox = findLineBgBox(l, gfx, bounds);
  const paras = [];
  for (const l of sorted) {
    let target = null;
    for (const p of paras) {
      const last = p.lines[p.lines.length - 1];
      const step = l.baseline - last.baseline;
      if (step <= 0.3 * l.size || step > 1.9 * Math.max(l.size, last.size)) continue;
      if (Math.abs(l.size - last.size) > 0.2 * last.size) continue;
      if (l.decor !== last.decor) continue;
      if (!!l.bold !== !!last.bold) {
        const lastTxt = (last.glyphs || []).map((g) => g.uni || '').join('').trimEnd();
        const lastEnded = /[.!?…:"”)]$/.test(lastTxt);
        const lastNs = (last.glyphs || []).filter((g) => !g.space);
        const lastBoldCnt = lastNs.filter((g) => { const f = g && (g.g ? g.g.font : g.font); return f && f.style && f.style.weight >= 600; }).length;
        const mixedBold = lastBoldCnt > 0 && lastBoldCnt < lastNs.length;
        if (lastEnded && !mixedBold) continue;
        if (step > 1.5 * Math.max(l.size, last.size)) continue;
      }
      if (gfx && l._bgBox !== last._bgBox) continue;
      if (p.step && step > 1.3 * p.step) continue;
      if (hOverlap(l.b, p.b) < 0.3 * Math.min(l.b.x1 - l.b.x0, p.b.x1 - p.b.x0)) continue;
      const sameCenter = Math.abs((l.b.x0 + l.b.x1) / 2 - (p.b.x0 + p.b.x1) / 2) <= 2.5 * l.size && l.b.x0 >= p.b.x0 - 2 * l.size && l.b.x1 <= p.b.x1 + 2 * l.size;
      if (Math.abs(l.b.x0 - p.b.x0) > 6 * l.size && !sameCenter) continue;
      target = p; break;
    }
    if (target) { const last = target.lines[target.lines.length - 1]; target.step = target.step || (l.baseline - last.baseline); target.lines.push(l); target.b = unionBox(target.b, l.b); }
    else paras.push({ kind: 'text', lines: [l], b: { ...l.b }, size: l.size, decor: l.decor });
  }
  return paras;
}

export function clusterAtoms(atoms, geo) {
  const n = atoms.length;
  const uf = new UF(n);
  const core = (a) => {
    if (a.kind !== 'text') return a.b;
    const s = a.size || 10;
    const first = a.lines[0], last = a.lines[a.lines.length - 1];
    return { x0: a.b.x0, x1: a.b.x1, y0: first.baseline - 0.72 * first.size, y1: last.baseline + 0.12 * last.size };
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = atoms[i], B = atoms[j];
      const a = core(A), b = core(B);
      const bothText = A.kind === 'text' && B.kind === 'text';
      // 1) overlap / containment
      if (intersectBox(a, b)) {
        if (!bothText || vOverlap(a, b) > 0.25 * Math.min(a.y1 - a.y0, b.y1 - b.y0)) { uf.dbg(i, j, 'overlap', atoms); continue; }
      }
      const T = A.kind === 'text' ? A : (B.kind === 'text' ? B : null);
      const G = T === A ? B : A;
      // 2) badge / bullet glued horizontally to its text line
      if (T && G.kind !== 'text') {
        const s = T.size || 10;
        const firstLine = T.lines ? T.lines[0].b : T.b;
        const gArea = boxArea(G.b);
        if (gArea < (4 * s) * (4 * s) && hGap(firstLine, G.b) < 1.1 * s && hGap(firstLine, G.b) > -0.5 * s
          && vOverlap(firstLine, G.b) > 0.4 * Math.min(firstLine.y1 - firstLine.y0, G.b.y1 - G.b.y0)) { uf.dbg(i, j, 'badge', atoms); continue; }
        // caption right under/over an image or box, within its horizontal span
        if (G.kind === 'image' && T.b.y0 >= G.b.y1 - 2 && G.b.x1 - G.b.x0 > 2 * s && hOverlap(T.b, G.b) > 0.65 * Math.min(T.b.x1 - T.b.x0, G.b.x1 - G.b.x0) && vGap(T.b, G.b) < 1.2 * s && ((T.b.x1 - T.b.x0) < (G.b.x1 - G.b.x0) * 1.35 || (G.b.x1 - G.b.x0 < 95 && G.b.y1 - G.b.y0 < 95 && T.b.x1 - T.b.x0 < 95 && T.lines.length === 1 && Math.abs((T.b.x0 + T.b.x1) / 2 - (G.b.x0 + G.b.x1) / 2) < 20))) { uf.dbg(i, j, 'caption', atoms); continue; }
      }
      // 3) text-text on the same baseline, close together (e.g. number + text)
      if (bothText) {
        const s = Math.max(A.size, B.size);
        if (A.lines.length === 1 && B.lines.length === 1 && Math.abs(A.lines[0].baseline - B.lines[0].baseline) < 0.3 * s && hGap(a, b) < 0.9 * s && hGap(a, b) > -0.2 * s && !A.decor === !B.decor) { uf.dbg(i, j, 'textrow', atoms); continue; }
      }
      // 4) graphics touching each other (not two separate panels / tiles)
      if (!T && touches(A, B)) { uf.dbg(i, j, 'gfxtouch', atoms); continue; }
    }
  }
  const groups = new Map();
  atoms.forEach((a, i) => { const r = uf.find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(a); });
  let clusters = [...groups.values()].map((members) => ({ members, b: members.reduce((acc, m) => unionBox(acc, m.b), null) }));
  // enforce: no two clusters overlap
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (intersectBox(clusters[i].b, clusters[j].b)) {
          const ov = intersectBox(clusters[i].b, clusters[j].b);
          if (boxArea(ov) < 0.5 || Math.min(ov.x1 - ov.x0, ov.y1 - ov.y0) < 1.5) continue; // hairline: trimmed later
          clusters[i] = { members: [...clusters[i].members, ...clusters[j].members], b: unionBox(clusters[i].b, clusters[j].b) };
          clusters.splice(j, 1); changed = true; break outer;
        }
      }
    }
  }
  return clusters;
}

// rows: clusters sharing a horizontal band are moved together
export function groupRows(clusters, geo) {
  const items = clusters.map((c, i) => ({ c, i }));
  const uf = new UF(clusters.length);
  const maxH = geo.height * 0.28;
  const pureText = (c) => c.members && c.members.length > 0 && c.members.every((m) => m.kind === 'text' && !m.decor);
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      if (pureText(clusters[i]) && pureText(clusters[j])) continue;
      const a = clusters[i].b, b = clusters[j].b;
      if ((pureText(clusters[i]) || pureText(clusters[j])) && hGap(a, b) > 14) continue;
      const ha = a.y1 - a.y0, hb = b.y1 - b.y0;
      if (ha > maxH || hb > maxH) continue;
      const ov = vOverlap(a, b);
      if (ov > 0.6 * Math.min(ha, hb) && Math.min(ha, hb) > 0.55 * Math.max(ha, hb)) uf.union(i, j);
    }
  }
  const rows = new Map();
  items.forEach(({ c, i }) => { const r = uf.find(i); if (!rows.has(r)) rows.set(r, []); rows.get(r).push(c); });
  return [...rows.values()];
}
