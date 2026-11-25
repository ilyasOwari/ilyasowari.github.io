// 2D affine helpers. Matrices are [a, b, c, d, e, f] (PDF convention):
// x' = a*x + c*y + e ; y' = b*x + d*y + f
export const IDENT = [1, 0, 0, 1, 0, 0];

export function mul(m1, m2) { // apply m1 first, then m2
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}
export function inv(m) {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
export function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
export function translate(tx, ty) { return [1, 0, 0, 1, tx, ty]; }
export function scale(sx, sy = sx) { return [sx, 0, 0, sy, 0, 0]; }

export function bboxOfPoints(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
export function transformBox(m, b) {
  const p = [...apply(m, b.x0, b.y0), ...apply(m, b.x1, b.y0), ...apply(m, b.x0, b.y1), ...apply(m, b.x1, b.y1)];
  return bboxOfPoints(p);
}
export function intersectBox(a, b) {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}
export function unionBox(a, b) {
  if (!a) return { ...b }; if (!b) return { ...a };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
export function boxArea(b) { return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0); }
export function boxContains(outer, inner, tol = 0) {
  return inner.x0 >= outer.x0 - tol && inner.y0 >= outer.y0 - tol && inner.x1 <= outer.x1 + tol && inner.y1 <= outer.y1 + tol;
}
export function boxesTouch(a, b, tol = 0) {
  return a.x0 <= b.x1 + tol && b.x0 <= a.x1 + tol && a.y0 <= b.y1 + tol && b.y0 <= a.y1 + tol;
}
// rect helpers ({x,y,w,h}, UI space, y down)
export function rectToBox(r) { return { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }; }
export function boxToRect(b) { return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }; }
export function rectsOverlap(a, b, eps = 0.01) {
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}
export function pointInBox(b, x, y) { return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; }
