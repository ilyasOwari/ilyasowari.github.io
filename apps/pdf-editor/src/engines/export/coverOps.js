// Fill of a covered ("Gizle") area: one colour, or a gradient drawn as thin bands.
import { fmtNum as f } from '../pdf/lexer.js';
import { transformBox } from '../../core/geometry.js';

export function coverBands(h, n = 48) {
  const F = h.fill;
  if (!F || F.type !== 'lin') return [{ x: h.x, y: h.y, w: h.w, h: h.h, c: F ? F.c : [255, 255, 255] }];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const c = F.c0.map((v, k) => Math.round(v + (F.c1[k] - v) * t));
    if (F.dir === 'v') out.push({ x: h.x, y: h.y + (h.h * i) / n, w: h.w, h: h.h / n + 0.05, c });
    else out.push({ x: h.x + (h.w * i) / n, y: h.y, w: h.w / n + 0.05, h: h.h, c });
  }
  return out;
}
export function coverFillOps(an, h) {
  return coverBands(h).map((r) => {
    const bb = transformBox(an.Minv, { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
    return `q ${r.c.map((v) => f(v / 255)).join(' ')} rg ${f(bb.x0)} ${f(bb.y0)} ${f(bb.x1 - bb.x0)} ${f(bb.y1 - bb.y0)} re f Q`;
  });
}
