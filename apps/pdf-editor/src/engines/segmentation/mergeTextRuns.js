// Vertical column text-run merging (block-level and intra-block part collapsing) for segment.js.
import { findLineBgBox } from './cluster.js';
import { unionBox } from '../../core/geometry.js';

const isBoldGlyph = (g) => {
  const f = g && (g.g ? g.g.font : g.font);
  return !!(f && f.style && f.style.weight >= 600);
};

const inkOf = (bl) => bl.parts.reduce((u, p) => {
  const k = p._ink;
  if (!k) return u;
  return u ? { x0: Math.min(u.x0, k.x0), y0: Math.min(u.y0, k.y0), x1: Math.max(u.x1, k.x1), y1: Math.max(u.y1, k.y1) } : { ...k };
}, null);

function joinBlocks(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const parts = [...a.parts, ...b.parts];
  parts.forEach((p) => { p.dx = p.src.x - x; p.dy = p.src.y - y; });
  a.parts = parts; a.x = x; a.y = y; a.origin = { x, y }; a.kind = 'group';
  a.bw = Math.max(...parts.map((p) => p.dx + p.dw));
  a.bh = Math.max(...parts.map((p) => p.dy + p.dh));
}

function rectTextInfo(x0, y0, x1, y1, textAtoms, gfx, pageBounds) {
  const lines = textAtoms.filter((l) => !l.decor
    && ((l.b.x0 + l.b.x1) / 2 >= x0 - 1) && ((l.b.x0 + l.b.x1) / 2 <= x1 + 1)
    && ((l.b.y0 + l.b.y1) / 2 >= y0 - 1) && ((l.b.y0 + l.b.y1) / 2 <= y1 + 1))
    .sort((p, q) => p.b.y0 - q.b.y0 || p.b.x0 - q.b.x0);
  if (!lines.length) return null;
  if (lines.some((l) => /(?:^|\s)[A-Ea-e][.)]\s+\S.*(?:^|\s)[B-Fb-f][.)]\s+\S/.test(l.text || ''))) return null;
  const bg0 = findLineBgBox(lines[0], gfx, pageBounds);
  if (lines.some((l) => findLineBgBox(l, gfx, pageBounds) !== bg0)) return null;
  const ns = lines.flatMap((l) => (l.glyphs || []).filter((g) => !g.space));
  if (!ns.length) return null;
  const sizes = lines.map((l) => l.size || 10).sort((p, q) => p - q);
  const size = sizes[sizes.length >> 1];
  const allBold = ns.filter(isBoldGlyph).length > ns.length * 0.85;
  const lx0 = Math.min(...lines.map((l) => l.b.x0)), lx1 = Math.max(...lines.map((l) => l.b.x1));
  const ly0 = Math.min(...lines.map((l) => l.b.y0)), ly1 = Math.max(...lines.map((l) => l.b.y1));
  return {
    size, allBold, bgBox: bg0, x0: lx0, x1: lx1, y0: ly0, y1: ly1,
    w: Math.max(1, lx1 - lx0), h: Math.max(1, ly1 - ly0),
    firstBaseline: lines[0].baseline, lastBaseline: lines[lines.length - 1].baseline,
  };
}

function canMergeVerticalPair(ia, ib, rxA, rxB, gfx, outerBlockOk) {
  const vOv = Math.min(ia.y1, ib.y1) - Math.max(ia.y0, ib.y0);
  if (vOv > 0.5 || ib.firstBaseline <= ia.lastBaseline + 0.4 * Math.min(ia.size, ib.size)) return false;
  const gapY = ib.y0 - ia.y1;
  if (gapY < -0.5) return false;
  const maxSz = Math.max(ia.size, ib.size), minSz = Math.min(ia.size, ib.size);
  if ((maxSz - minSz) / Math.max(1, minSz) > 0.20) return false;
  if (ia.allBold !== ib.allBold || ia.bgBox !== ib.bgBox) return false;
  if (gapY > 2.8 * maxSz) return 'tooFar';
  const leftClose = Math.abs(ia.x0 - ib.x0) <= 2.5 * maxSz || Math.abs(rxA.x - rxB.x) <= 2.5 * maxSz;
  const xOv = Math.min(ia.x1, ib.x1) - Math.max(ia.x0, ib.x0);
  const withinSpan = xOv >= 0.6 * Math.min(ia.w, ib.w);
  if (!leftClose && !withinSpan) return false;
  const ux0 = Math.min(rxA.x, rxB.x), ux1 = Math.max(rxA.x + rxA.w, rxB.x + rxB.w);
  const uy0 = Math.min(rxA.y, rxB.y), uy1 = Math.max(rxA.y + rxA.h, rxB.y + rxB.h);
  if (!outerBlockOk(ux0, uy0, ux1, uy1)) return false;
  const sepGfx = gfx.some((g) => g !== ia.bgBox && (g.fill || g.stroke || g.kind === 'image')
    && (g.b.x1 - g.b.x0 > 12 || g.b.y1 - g.b.y0 > 12)
    && g.b.y1 > ia.y1 - 2 && g.b.y0 < ib.y0 + 2
    && Math.min(g.b.x1, ux1) > Math.max(g.b.x0, ux0)
    && !(g.b.x0 <= ux0 + 2 && g.b.x1 >= ux1 - 2 && g.b.y0 <= uy0 + 2 && g.b.y1 >= uy1 - 2));
  return !sepGfx;
}

export function mergeColumnTextRuns(blocks, textAtoms, gfx, geo = null) {
  const pageBounds = geo ? { x0: 0, y0: 0, x1: geo.width, y1: geo.height } : null;
  const colTextInfo = (b) => {
    if (b.free || b._isGrid || b.watermark || !b.parts || !b.parts.length) return null;
    if (!b.parts.every((p) => p.kind === 'text' && !p.decor && p.editable)) return null;
    return rectTextInfo(b.x, b.y, b.x + b.bw, b.y + b.bh, textAtoms, gfx, pageBounds);
  };
  for (let again = true, guard = 0; again && guard < 160; guard++) {
    again = false;
    blocks.sort((p, q) => p.y - q.y || p.x - q.x);
    for (let i = 0; i < blocks.length && !again; i++) {
      const a = blocks[i];
      const ia = colTextInfo(a);
      if (!ia) continue;
      for (let j = i + 1; j < blocks.length; j++) {
        const b = blocks[j];
        const ib = colTextInfo(b);
        if (!ib) continue;
        const ok = canMergeVerticalPair(
          ia, ib,
          { x: a.x, y: a.y, w: a.bw, h: a.bh },
          { x: b.x, y: b.y, w: b.bw, h: b.bh },
          gfx,
          (ux0, uy0, ux1, uy1) => !blocks.some((q) => q !== a && q !== b && !q.free && Math.min(q.x + q.bw, ux1) > Math.max(q.x, ux0) + 1 && Math.min(q.y + q.bh, uy1) > Math.max(q.y, uy0) + 1),
        );
        if (ok === 'tooFar') { if (b.y - (a.y + a.bh) > 3.2 * Math.max(ia.size, ib.size)) break; continue; }
        if (!ok) continue;
        const inkU = unionBox(inkOf(a), inkOf(b));
        joinBlocks(a, b);
        const p0 = a.parts[0];
        a.kind = 'text';
        a.parts = [{ id: p0.id, src: { x: a.x, y: a.y, w: a.bw, h: a.bh }, dx: 0, dy: 0, dw: a.bw, dh: a.bh, kind: 'text', editable: true, decor: false, ...(inkU ? { _ink: inkU } : {}) }];
        blocks.splice(j, 1);
        again = true;
        break;
      }
    }
  }
  for (const b of blocks) {
    if (b.parts.length < 2 || !colTextInfo(b)) continue;
    const side = b.parts.some((p, pi) => b.parts.some((q, qi) => qi > pi && Math.min(p.src.y + p.src.h, q.src.y + q.src.h) - Math.max(p.src.y, q.src.y) > 0.4 * Math.min(p.src.h, q.src.h)));
    if (side) continue;
    const inkU = inkOf(b), p0 = b.parts[0];
    b.kind = 'text';
    b.parts = [{ id: p0.id, src: { x: b.x, y: b.y, w: b.bw, h: b.bh }, dx: 0, dy: 0, dw: b.bw, dh: b.bh, kind: 'text', editable: true, decor: false, ...(inkU ? { _ink: inkU } : {}) }];
  }
}

// Inside composite blocks (e.g. numbered section header + wide rule + body
// paragraphs), collapse vertically consecutive compatible text parts into a
// single unified text part so "Düzenle" and Word export treat them as one box.
export function collapseVerticalTextParts(blocks, textAtoms, gfx, geo = null) {
  const pageBounds = geo ? { x0: 0, y0: 0, x1: geo.width, y1: geo.height } : null;
  const partInfo = (p) => {
    if (!p || p.kind !== 'text' || p.decor || !p.editable) return null;
    return rectTextInfo(p.src.x, p.src.y, p.src.x + p.src.w, p.src.y + p.src.h, textAtoms, gfx, pageBounds);
  };
  const hasSideTextSibling = (b, p) => b.parts.some((q) => q !== p && q.kind === 'text' && !q.decor && q.editable
    && (q.src.w >= 18 || q.src.h >= 18)
    && Math.min(p.src.y + p.src.h, q.src.y + q.src.h) - Math.max(p.src.y, q.src.y) > 0.4 * Math.min(p.src.h, q.src.h));

  for (const b of blocks) {
    if (b.free || b._isGrid || b.watermark || !b.parts || b.parts.length < 2) continue;
    for (let again = true, guard = 0; again && guard < 120; guard++) {
      again = false;
      b.parts.sort((p, q) => p.src.y - q.src.y || p.src.x - q.src.x);
      for (let i = 0; i < b.parts.length && !again; i++) {
        const pa = b.parts[i];
        const ia = partInfo(pa);
        if (!ia || hasSideTextSibling(b, pa)) continue;
        for (let j = i + 1; j < b.parts.length; j++) {
          const pb = b.parts[j];
          const ib = partInfo(pb);
          if (!ib || hasSideTextSibling(b, pb)) continue;
          const ok = canMergeVerticalPair(
            ia, ib, pa.src, pb.src, gfx,
            (ux0, uy0, ux1, uy1) => {
              const partBetween = b.parts.some((q) => q !== pa && q !== pb
                && Math.min(q.src.x + q.src.w, ux1) > Math.max(q.src.x, ux0) + 1
                && q.src.y + q.src.h > pa.src.y + pa.src.h + 1 && q.src.y < pb.src.y - 1);
              if (partBetween) return false;
              return !blocks.some((ob) => ob !== b && !ob.free && Math.min(ob.x + ob.bw, ux1) > Math.max(ob.x, ux0) + 1 && Math.min(ob.y + ob.bh, uy1) > Math.max(ob.y, uy0) + 1);
            },
          );
          if (ok === 'tooFar') break;
          if (!ok) continue;
          const ux0 = Math.min(pa.src.x, pb.src.x), uy0 = Math.min(pa.src.y, pb.src.y);
          const ux1 = Math.max(pa.src.x + pa.src.w, pb.src.x + pb.src.w), uy1 = Math.max(pa.src.y + pa.src.h, pb.src.y + pb.src.h);
          const uw = ux1 - ux0, uh = uy1 - uy0;
          const inkU = pa._ink && pb._ink ? unionBox(pa._ink, pb._ink) : (pa._ink || pb._ink || null);
          b.parts[i] = {
            id: pa.id,
            src: { x: ux0, y: uy0, w: uw, h: uh },
            dx: ux0 - b.x, dy: uy0 - b.y, dw: uw, dh: uh,
            kind: 'text', editable: true, decor: false,
            ...(inkU ? { _ink: inkU } : {}),
          };
          b.parts.splice(j, 1);
          again = true;
          break;
        }
      }
    }
    if (b.parts.length === 1 && b.parts[0].kind === 'text') b.kind = 'text';
  }
}
