// "Bağımsız hale getir": any block (or one picture of it) leaves the block layout and becomes a free
// object on the top layer (can lie over anything). "Düzene geri al" puts it
// back into the layout at the nearest free spot.
import * as ops from '../model/blockOps.js';
import { srcIndexOf } from '../model/blockState.js';
import { decomposeBlocks, applyObjects, objToPart } from './areaObjects.js';
import { bestSpot } from './pageOps.js';

const inRect = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// does the block show a picture (for the context menu)?
export function blockHasImage(session, page, b) {
  if (b.inserted) return b.inserted.type === 'image';
  if (b.parts.some((p) => p.img || p.obj === 'photo' || p.obj === 'img')) return true;
  const si = srcIndexOf(page, b);
  if (si === null || si === undefined) return false;
  const an = session.analysis(si);
  return b.parts.some((p) => p.src && an.atoms.gfx.some((g) => g.kind === 'image' && g.area > 300 && inRect(p.src, { x: (g.b.x0 + g.b.x1) / 2, y: (g.b.y0 + g.b.y1) / 2 })));
}

// inside a commit; returns the id of the free block or null
export function makeFree(session, page, id, pt) {
  void session; void pt;
  const b = ops.findBlock(page, id);
  if (!b) return null;
  if (b.free) return b.id;
  b.free = true;
  b.home = { x: b.x, y: b.y, s: b.s || 1 };
  return b.id;
}

// back into the layout: same place if it is free there, else the nearest free spot
export function unfree(page, id) {
  const b = ops.findBlock(page, id);
  if (!b || !b.free) return false;
  delete b.free;
  const home = b.home; delete b.home;
  if (!ops.collides(page, b, b)) return true;
  // where it came from, if that place is still empty
  if (home) { const at = { x: home.x, y: home.y, s: home.s }; if (!ops.collides(page, { ...b, s: home.s }, at)) { b.x = home.x; b.y = home.y; b.s = home.s; return true; } }
  const f = ops.nearestFree(page, [b], 0, 0, new Set([b.id]), 400);
  if (f) { b.x += f.dx; b.y += f.dy; return true; }
  const sp = bestSpot(page, b, home ? { x: home.x, y: home.y } : { x: b.x, y: b.y }, 0.8) || bestSpot(page, b, { x: b.x, y: b.y }, 0.3);
  if (!sp) return false;
  b.x = sp.x; b.y = sp.y; b.s = sp.s;
  return true;
}
