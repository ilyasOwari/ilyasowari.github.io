// Pure layout operations on a page model. Rule: blocks never overlap.
import { rectsOverlap } from '../core/geometry.js';
import { dehydrateImg } from '../core/imageStore.js';
import { isForeign } from './blockState.js';

let seq = 0;
export const newId = (p = 'b') => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;
const EPS = 0.05;

export function partRect(b, p, at = b) {
  const s = (at.s ?? b.s ?? 1) * (p.sc || 1);
  const bs = at.s ?? b.s ?? 1;
  return { x: at.x + p.dx * bs, y: at.y + p.dy * bs, w: p.dw * s, h: p.dh * s };
}
export function blockRects(b, at = b) {
  if (!b.parts.length) { const s = at.s ?? b.s ?? 1; return [{ x: at.x, y: at.y, w: b.bw * s, h: b.bh * s }]; }
  return b.parts.map((p) => partRect(b, p, at));
}
export function blockRect(b) { const s = b.s || 1; return { x: b.x, y: b.y, w: b.bw * s, h: b.bh * s }; }
export function recalcBlock(b) {
  if (!b.parts.length) return b;
  b.bw = Math.max(...b.parts.map((p) => p.dx + p.dw * (p.sc || 1)));
  b.bh = Math.max(...b.parts.map((p) => p.dy + p.dh * (p.sc || 1)));
  return b;
}
export function findBlock(page, id) { return page.blocks.find((b) => b.id === id); }

// Would `b` placed at `at` overlap anything (other than `ignore`) or leave the page?
export function collides(page, b, at, ignore = new Set()) {
  const rs = blockRects(b, at);
  for (const r of rs) {
    if (r.x < -EPS || r.y < -EPS || r.x + r.w > page.w + EPS || r.y + r.h > page.h + EPS) return true;
  }
  // free (floating) objects sit on their own layer: they overlap anything
  if (b.free) return false;
  for (const o of page.blocks) {
    if (o.id === b.id || ignore.has(o.id) || o.free) continue;
    const ors = blockRects(o);
    for (const r of rs) for (const q of ors) if (rectsOverlap(r, q, EPS)) return true;
  }
  return false;
}

export function moveBlock(page, id, x, y) {
  const b = findBlock(page, id);
  if (!b) return false;
  if (collides(page, b, { x, y, s: b.s })) return false;
  b.x = x; b.y = y;
  return true;
}
export function moveMany(page, ids, dx, dy) {
  const set = new Set(ids);
  const bs = page.blocks.filter((b) => set.has(b.id));
  for (const b of bs) if (collides(page, b, { x: b.x + dx, y: b.y + dy, s: b.s }, set)) return false;
  bs.forEach((b) => { b.x += dx; b.y += dy; });
  return true;
}
// Resize; when the full size does not fit, grow as far as possible (the
// fixed corner stays put because x, y and s change linearly together).
export function resizeBlock(page, id, s, x, y) {
  const b = findBlock(page, id);
  if (!b || s <= 0.05) return false;
  const at = (t) => ({ x: b.x + (x - b.x) * t, y: b.y + (y - b.y) * t, s: (b.s || 1) + (s - (b.s || 1)) * t });
  let t = 1;
  if (collides(page, b, at(1))) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (collides(page, b, at(m))) hi = m; else lo = m; }
    t = lo;
    if (Math.abs(at(t).s - (b.s || 1)) < 0.004) return false;
  }
  const r = at(t);
  b.s = r.s; b.x = r.x; b.y = r.y;
  return t < 1 ? 'clamped' : true;
}

// Nearest free spot to (dx,dy) for a set of blocks (page edges clamp first).
export function nearestFree(page, bs, dx, dy, set, maxR = 72) {
  const ok = (ddx, ddy) => bs.every((b) => !collides(page, b, { x: b.x + ddx, y: b.y + ddy, s: b.s }, set));
  // keep inside the page
  const rs = bs.map(blockRect);
  const minX = -Math.min(...rs.map((r) => r.x)), maxX = page.w - Math.max(...rs.map((r) => r.x + r.w));
  const minY = -Math.min(...rs.map((r) => r.y)), maxY = page.h - Math.max(...rs.map((r) => r.y + r.h));
  dx = Math.max(minX, Math.min(maxX, dx)); dy = Math.max(minY, Math.min(maxY, dy));
  if (ok(dx, dy)) return { dx, dy };
  for (let r = 2; r <= maxR; r += 2) {
    let best = null;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const cx = dx + Math.cos(a) * r, cy = dy + Math.sin(a) * r;
      if (ok(cx, cy)) { const d = Math.hypot(cx, cy); if (!best || d < best.d) best = { dx: cx, dy: cy, d }; }
    }
    if (best) {
      // tighten toward the target
      let lo = 0, hi = 1;
      for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (ok(best.dx + (dx - best.dx) * m, best.dy + (dy - best.dy) * m)) lo = m; else hi = m; }
      return { dx: best.dx + (dx - best.dx) * lo, dy: best.dy + (dy - best.dy) * lo };
    }
  }
  return null;
}
export function moveClamped(page, ids, dx, dy) {
  const set = new Set(ids);
  const bs = page.blocks.filter((b) => set.has(b.id));
  if (!bs.length) return false;
  const f = nearestFree(page, bs, dx, dy, set);
  if (!f || Math.hypot(f.dx, f.dy) < 0.5) return false;
  bs.forEach((b) => { b.x += f.dx; b.y += f.dy; });
  return Math.hypot(f.dx - dx, f.dy - dy) > 0.5 ? 'clamped' : true;
}

export function isPinned(page, b) {
  if (b.free) return true; // floating objects never get pushed around
  const r = blockRect(b);
  return (r.y > page.h * 0.9 && r.h < page.h * 0.07) || (r.y + r.h < page.h * 0.06);
}

// Delete blocks completely; rows below move up into freed horizontal bands.
export function deleteBlocks(page, ids, { compact = true } = {}) {
  const set = new Set(ids);
  const gone = page.blocks.filter((b) => set.has(b.id));
  if (!gone.length) return false;
  for (const b of gone) if (!isForeign(b)) for (const p of b.parts) if (p.src && !p.addedText && !p.addedTable) page.deleted.push({ x: p.src.x, y: p.src.y, w: p.src.w, h: p.src.h });
  page.blocks = page.blocks.filter((b) => !set.has(b.id));
  if (compact) {
    const bands = gone.filter((b) => !b.free).map(blockRect).sort((a, b) => b.y - a.y);
    for (const band of bands) { const before = page.blocks.map((b) => b.y).join(); compactBand(page, band); if (before === page.blocks.map((b) => b.y).join()) closeGap(page, band, Infinity, band.y); }
  }
  return true;
}
export function compactBand(page, band) {
  const y0 = band.y, y1 = band.y + band.h;
  const movable = page.blocks.filter((b) => !isPinned(page, b));
  // anything still occupying the band? then nothing moves (side-by-side layout)
  const occupied = page.blocks.some((b) => { if (b.free) return false; const r = blockRect(b); return r.y < y1 - 0.5 && r.y + r.h > y0 + 0.5; });
  if (occupied) return;
  const below = movable.filter((b) => blockRect(b).y >= y1 - 0.5);
  if (!below.length) return;
  const nextTop = Math.min(...below.map((b) => blockRect(b).y));
  const shift = nextTop - y0;
  if (shift <= 0.5) return;
  // don't pull blocks up over pinned blocks or other blocks (safety check)
  const ids = new Set(below.map((b) => b.id));
  for (const b of below) if (collides(page, b, { x: b.x, y: b.y - shift, s: b.s }, ids)) return;
  below.forEach((b) => { b.y -= shift; });
}

// Swap with the nearest neighbour in a direction (or nudge if none)
export function swapDirection(page, id, dir) {
  const a = findBlock(page, id);
  if (!a) return 'none';
  const A = blockRect(a);
  const vertical = dir === 'up' || dir === 'down';
  const overlap = (r) => (vertical ? Math.min(A.x + A.w, r.x + r.w) - Math.max(A.x, r.x) : Math.min(A.y + A.h, r.y + r.h) - Math.max(A.y, r.y));
  let best = null, bestD = Infinity;
  for (const o of page.blocks) {
    if (o.id === id) continue;
    const R = blockRect(o);
    if (overlap(R) <= 1) continue;
    let d;
    if (dir === 'down') d = R.y - (A.y + A.h); else if (dir === 'up') d = A.y - (R.y + R.h);
    else if (dir === 'right') d = R.x - (A.x + A.w); else d = A.x - (R.x + R.w);
    if (d < -1) continue;
    if (d < bestD) { bestD = d; best = o; }
  }
  if (!best) {
    const step = 10;
    const dx = dir === 'left' ? -step : dir === 'right' ? step : 0;
    const dy = dir === 'up' ? -step : dir === 'down' ? step : 0;
    return moveBlock(page, id, a.x + dx, a.y + dy) ? 'nudged' : 'blocked';
  }
  const B = blockRect(best);
  let na, nb;
  if (dir === 'down') { nb = { x: best.x, y: A.y }; na = { x: a.x, y: B.y + B.h - A.h }; }
  else if (dir === 'up') { na = { x: a.x, y: B.y }; nb = { x: best.x, y: A.y + A.h - B.h }; }
  else if (dir === 'right') { nb = { x: A.x, y: best.y }; na = { x: B.x + B.w - A.w, y: a.y }; }
  else { na = { x: B.x, y: a.y }; nb = { x: A.x + A.w - B.w, y: best.y }; }
  const ign = new Set([a.id, best.id]);
  const okA = !collides(page, a, { ...na, s: a.s }, ign);
  const okB = !collides(page, best, { ...nb, s: best.s }, ign);
  const ra = blockRects(a, { ...na, s: a.s }), rb = blockRects(best, { ...nb, s: best.s });
  const mutual = ra.some((r) => rb.some((q) => rectsOverlap(r, q, EPS)));
  if (!okA || !okB || mutual) return 'blocked';
  a.x = na.x; a.y = na.y; best.x = nb.x; best.y = nb.y;
  return 'swapped';
}

export function setBackground(page, ids, mode) {
  const set = new Set(ids);
  page.blocks.filter((b) => set.has(b.id)).forEach((b) => b.parts.forEach((p) => { p.bgMode = mode || null; }));
}

export function mergeBlocks(page, ids) {
  const set = new Set(ids);
  const bs = page.blocks.filter((b) => set.has(b.id) && (b.parts.length || b.inserted));
  if (bs.length < 2) return null;
  const srcBlocks = bs.filter((b) => !b.inserted && b.parts.some((p) => p.src));
  const origins = new Set(srcBlocks.map((b) => (isForeign(b) ? `f:${b.from}` : 'native')));
  if (origins.size > 1) return null;
  const sharedFrom = srcBlocks.length && isForeign(srcBlocks[0]) ? srcBlocks[0].from : undefined;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  const parts = [];
  for (const b of bs) {
    const s = b.s || 1;
    if (b.inserted) {
      if (b.inserted.type === 'image') {
        parts.push({
          id: newId('p'), kind: 'insimg', src: null, editable: false,
          img: { ...dehydrateImg({ dataUrl: b.inserted.dataUrl, imgId: b.inserted.imgId }), iw: b.bw, ih: b.bh, aspect: b.bh / Math.max(1, b.bw), caption: '', capSize: 0, anchor: 0, wrap: false, width: 1 },
          dx: b.x - x, dy: b.y - y, dw: b.bw, dh: b.bh, sc: s,
        });
      } else if (b.inserted.type === 'text') {
        parts.push({
          id: newId('p'), kind: 'instext', src: null, editable: false,
          inserted: JSON.parse(JSON.stringify(b.inserted)),
          dx: b.x - x, dy: b.y - y, dw: b.bw, dh: b.bh, sc: s,
        });
      }
      continue;
    }
    for (const p of b.parts) parts.push({ ...p, dx: b.x + p.dx * s - x, dy: b.y + p.dy * s - y, sc: (p.sc || 1) * s });
  }
  const nb = recalcBlock({ id: newId('b'), kind: 'group', x, y, s: 1, bw: 0, bh: 0, parts, ...(sharedFrom !== undefined ? { from: sharedFrom } : {}) });
  const idx = page.blocks.findIndex((b) => set.has(b.id));
  page.blocks = page.blocks.filter((b) => !set.has(b.id));
  page.blocks.splice(Math.max(0, idx), 0, nb);
  return nb.id;
}
export function ungroupBlock(page, id) {
  const b = findBlock(page, id);
  if (!b || b.parts.length < 2) return null;
  const s = b.s || 1;
  const fromProp = isForeign(b) ? { from: b.from } : {};
  const freeProp = b.free ? { free: true } : {};
  const out = b.parts.map((p) => {
    const ps = (p.sc || 1) * s;
    const x = b.x + p.dx * s, y = b.y + p.dy * s;
    if (p.kind === 'instext' && p.inserted) {
      return { id: newId('b'), kind: 'inserted', x, y, s: 1, bw: p.dw * ps, bh: p.dh * ps, parts: [], ...freeProp, inserted: JSON.parse(JSON.stringify(p.inserted)) };
    }
    if (p.kind === 'insimg' && p.img) {
      const insImg = { type: 'image', ...(p.img.imgId ? { imgId: p.img.imgId } : { dataUrl: p.img.dataUrl }) };
      return { id: newId('b'), kind: 'inserted', x, y, s: 1, bw: p.dw * ps, bh: p.dh * ps, parts: [], ...freeProp, inserted: insImg };
    }
    return recalcBlock({
      id: newId('b'), kind: p.kind || 'graphic', x, y, s: 1, bw: 0, bh: 0,
      ...(p.src ? fromProp : {}), ...freeProp,
      parts: [{ ...p, dx: 0, dy: 0, sc: ps }],
    });
  });
  const idx = page.blocks.indexOf(b);
  page.blocks.splice(idx, 1, ...out);
  return out.map((o) => o.id);
}

// "Mıknatıs": blocks under `rect` (same columns) move up, at most `maxShift`
// and never above `topLimit`, as far as nothing collides.
// Manual gaps (> 30pt) are preserved: only the freed height (`y1 - topLimit`)
// is closed, and all blocks below move together so their relative distances stay intact.
export function closeGap(page, rect, maxShift, topLimit = rect.y) {
  const y1 = rect.y + rect.h;
  const hov = (r) => Math.min(r.x + r.w, rect.x + rect.w) - Math.max(r.x, rect.x) > 1;
  const col = page.blocks.filter((b) => !isPinned(page, b) && blockRect(b).y >= y1 - 1 && hov(blockRect(b)));
  if (!col.length) return 0;
  // everything below the first moved block (in those columns) comes along
  const top = Math.min(...col.map((b) => blockRect(b).y));
  const gap = Math.max(0, top - y1);
  const limitShift = gap > 30 ? Math.max(0, y1 - topLimit) : (top - topLimit);
  let shift = Math.min(maxShift, limitShift);
  if (!(shift > 0.5)) return 0;
  const movers = page.blocks.filter((b) => !isPinned(page, b) && blockRect(b).y >= top - 0.5 && (hov(blockRect(b)) || col.some((c) => { const r = blockRect(c), q = blockRect(b); return Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x) > 1; })));
  const ids = new Set(movers.map((b) => b.id));
  const ok = (d) => movers.every((b) => !collides(page, b, { x: b.x, y: b.y - d, s: b.s }, ids));
  if (!ok(shift)) {
    let lo = 0, hi = shift;
    for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
    shift = lo;
  }
  if (shift < 0.5) return 0;
  movers.forEach((b) => { b.y -= shift; });
  return shift;
}
