// Cut lines never slice through an object: pictures, drawings and text lines
// of a block (in page coordinates); a line that would cross one moves to the
// nearest clear gap at the object's edge.
import { partDestRect, srcIndexOf } from '../model/blockState.js';

export function blockInk(session, page, b, { textOnly = false } = {}) {
  const si = srcIndexOf(page, b);
  if (si === null || si === undefined || !b.parts.length) return [];
  const an = session.analysis(si);
  const out = [];
  const R = { w: b.bw * (b.s || 1), h: b.bh * (b.s || 1) };
  for (const p of b.parts) {
    if (!p.src) continue;
    const d = partDestRect(b, p), S = p.src;
    const ox = p.clip ? p.clip.x : S.x, oy = p.clip ? p.clip.y : S.y;
    const kx = d.w / p.dw, ky = d.h / p.dh;
    const map = (bx) => ({ x0: d.x + (bx.x0 - ox) * kx, y0: d.y + (bx.y0 - oy) * ky, x1: d.x + (bx.x1 - ox) * kx, y1: d.y + (bx.y1 - oy) * ky });
    const inside = (bx) => { const cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2; return cx >= ox && cx <= ox + p.dw && cy >= oy && cy <= oy + p.dh; };
    for (const g of textOnly ? [] : an.atoms.gfx) {
      if (!inside(g.b)) continue;
      const m = map(g.b);
      // frames / backgrounds spanning (almost) the whole block are containers, not objects
      if ((m.x1 - m.x0) > R.w * 0.6 && (m.y1 - m.y0) > R.h * 0.6) continue;
      out.push(m);
    }
    const rmSet = new Set([...(p.removedG || []), ...((p.edit && p.edit.removeGlyphs) || [])]);
    for (const l of an.seg.textAtoms) {
      const liveG = l.glyphs.filter((g) => !rmSet.has(g.idx) && !g.space && (g.uni || '').trim());
      if (!liveG.length) continue;
      const lb = { x0: Math.min(...liveG.map((g) => g.b.x0)), y0: l.b.y0, x1: Math.max(...liveG.map((g) => g.b.x1)), y1: l.b.y1 };
      if (!inside(lb)) continue;
      out.push(map({ x0: lb.x0 - 0.5, x1: lb.x1 + 0.5, y0: lb.y0 - 0.5, y1: lb.y1 + 0.5 }));
    }
    if (p.edit && Array.isArray(p.edit.runs)) {
      for (const r of p.edit.runs) {
        if (!(r.text || '').trim()) continue;
        const rh = Math.max(4, Math.hypot(r.m[2], r.m[3]));
        const rb = { x0: r.x - 0.5, x1: r.x + (r.w || 0) + 0.5, y0: r.y - 0.85 * rh, y1: r.y + 0.25 * rh };
        if (rb.x1 < ox || rb.x0 > ox + p.dw || rb.y1 < oy || rb.y0 > oy + p.dh) continue;
        out.push(map(rb));
      }
    }
  }
  return out;
}

// axis 'h' = a horizontal cut line at y = pos spanning x in [a, b]; 'v' likewise
export function snapCut(ink, axis, pos, a, b, lo = -Infinity, hi = Infinity) {
  const crossing = (p) => ink.filter((m) => (axis === 'h'
    ? m.y0 < p - 0.2 && m.y1 > p + 0.2 && m.x0 < b && m.x1 > a
    : m.x0 < p - 0.2 && m.x1 > p + 0.2 && m.y0 < b && m.y1 > a));
  if (!crossing(pos).length) return pos;
  const walk = (dir) => {
    let p = pos;
    for (let i = 0; i < 40; i++) {
      const c = crossing(p);
      if (!c.length) return p;
      p = dir < 0 ? Math.min(...c.map((m) => (axis === 'h' ? m.y0 : m.x0))) - 0.3 : Math.max(...c.map((m) => (axis === 'h' ? m.y1 : m.x1))) + 0.3;
      if (p < lo || p > hi) return null;
    }
    return null;
  };
  const up = walk(-1), down = walk(1);
  if (up === null && down === null) return pos;
  if (up === null) return down;
  if (down === null) return up;
  return Math.abs(up - pos) <= Math.abs(down - pos) ? up : down;
}
