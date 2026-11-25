// Box (border / background fill / shape) around a text block.
// box = { shape: 'sharp'|'round'|'oval', bc, bw, bo, fc, fo, to }
export const hasBox = (box) => !!(box && (box.bc || box.fc));
export function setBlockBox(b, box) {
  if (!b) return;
  b.box = hasBox(box) ? { ...box } : null;
  if (!b.box) delete b.box;
  // the block content is drawn over the box: its parts become transparent layers
  for (const p of b.parts) { if (!p.src) continue; if (b.box && b.box.fc) p.tp = true; else delete p.tp; }
}
// geometry of the box around a block rect (pt): a small gap around the text
// room = free space on each side (never draws over a neighbour)
export function boxGeom(R, box, size = 10, room = null) {
  const g = box && (box.fc || box.bc) ? Math.max(4, Math.min(10, size * 0.45)) : 0;
  const roundExtra = box && box.shape === 'round' ? Math.max(8, Math.min(18, Math.min(R.w, R.h) * 0.08)) : 0;
  const side = (k, extra = 0) => Math.max(0, room ? Math.min(g + extra, room[k]) : g + extra);
  const gl = side('l', roundExtra), gt = side('t'), gr = side('r', roundExtra), gb = side('b');
  const x = R.x - gl, y = R.y - gt, w = R.w + gl + gr, h = R.h + gt + gb;
  const r = box.shape === 'oval' ? null : box.shape === 'round' ? Math.min(w, h) * 0.14 : 0;
  return { x, y, w, h, r, oval: box.shape === 'oval' };
}

// free space around a block on the page (to its neighbours and the page edge)
export function roomAround(page, b) {
  const s = b.s || 1, R = { x: b.x, y: b.y, w: b.bw * s, h: b.bh * s };
  const room = { l: R.x, t: R.y, r: page.w - R.x - R.w, b: page.h - R.y - R.h };
  for (const o of page.blocks) {
    if (o === b || o.id === b.id || o.free) continue;
    const q = { x: o.x, y: o.y, w: o.bw * (o.s || 1), h: o.bh * (o.s || 1) };
    const ovX = Math.min(R.x + R.w, q.x + q.w) - Math.max(R.x, q.x) > -8, ovY = Math.min(R.y + R.h, q.y + q.h) - Math.max(R.y, q.y) > -8;
    if (ovX && q.y + q.h <= R.y + 0.5) room.t = Math.min(room.t, R.y - (q.y + q.h) - 0.5);
    if (ovX && q.y >= R.y + R.h - 0.5) room.b = Math.min(room.b, q.y - (R.y + R.h) - 0.5);
    if (ovY && q.x + q.w <= R.x + 0.5) room.l = Math.min(room.l, R.x - (q.x + q.w) - 0.5);
    if (ovY && q.x >= R.x + R.w - 0.5) room.r = Math.min(room.r, q.x - (R.x + R.w) - 0.5);
  }
  return room;
}
