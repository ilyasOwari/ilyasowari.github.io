// "Kırp": keep only the part of a block inside a rectangle; the rest is
// deleted for real (its source area becomes a hole: removed on export).
// Also used by "Gizle" to give back the covered edge bands of a block.
import { partRect, recalcBlock, findBlock } from './blockOps.js';
import { isForeign, srcIndexOf } from './blockState.js';
import { purgePartOutside } from './partTextPurge.js';

const inter = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 - x > 0.5 && y2 - y > 0.5 ? { x, y, w: x2 - x, h: y2 - y } : null;
};

// crop one part to the page rect `keep`; returns false when nothing is left
function cropPart(page, b, p, keep, an) {
  const d = partRect(b, p);
  const i = inter(d, keep);
  const recordHole = !isForeign(b) && !p.addedText && !p.addedTable;
  if (!i) { if (p.src && recordHole) page.deleted.push({ ...p.src, mode: 'natural' }); return false; }
  if (i.x <= d.x + 0.01 && i.y <= d.y + 0.01 && i.x + i.w >= d.x + d.w - 0.01 && i.y + i.h >= d.y + d.h - 0.01) return true;
  const bs = b.s || 1;
  const kDw = p.dw / d.w, kDh = p.dh / d.h;
  const L = (i.x - d.x) * kDw, T = (i.y - d.y) * kDh, W = i.w * kDw, H = i.h * kDh;
  if (p.src) {
    const baseOx = p.clip ? p.clip.x : p.src.x, baseOy = p.clip ? p.clip.y : p.src.y;
    const win = { x: baseOx + L, y: baseOy + T, w: W, h: H };
    purgePartOutside(an, p, { x: baseOx, y: baseOy, w: p.dw, h: p.dh }, win);
    if (p.edit || p.nine || p.clip) {
      if (p.obj === 'text' && !(p.keep && p.keep.length)) {
        p.src = { ...win };
        if (p.full) p.full = { ...win };
        delete p.clip;
        if (p.edit) { delete p.edit.delta; delete p.edit.deltaX; delete p.edit.deltaLeft; }
      } else {
        p.clip = win;
      }
      p.cut = true;
    } else {
      const kSx = p.src.w / d.w, kSy = p.src.h / d.h;
      const sL = (i.x - d.x) * kSx, sT = (i.y - d.y) * kSy, sW = i.w * kSx, sH = i.h * kSy;
      const S = p.src;
      if (recordHole) {
        if (sT > 0.01) page.deleted.push({ x: S.x, y: S.y, w: S.w, h: sT, mode: 'natural' });
        if (S.h - sT - sH > 0.01) page.deleted.push({ x: S.x, y: S.y + sT + sH, w: S.w, h: S.h - sT - sH, mode: 'natural' });
        const o = 0.6;
        if (sL > 0.01) page.deleted.push({ x: S.x, y: S.y + sT - o, w: sL, h: sH + 2 * o, mode: 'natural' });
        if (S.w - sL - sW > 0.01) page.deleted.push({ x: S.x + sL + sW, y: S.y + sT - o, w: S.w - sL - sW, h: sH + 2 * o, mode: 'natural' });
      }
      p.src = { x: S.x + sL, y: S.y + sT, w: sW, h: sH };
      if (p.full) p.full = { ...p.src };
      p.cut = true;
    }
  } else if (p.img) {
    p.img = { ...p.img, iw: W, ih: H };
  }
  p.dx += (i.x - d.x) / bs; p.dy += (i.y - d.y) / bs;
  p.dw = W; p.dh = H;
  return true;
}

export function cropBlock(page, id, keep, session = null) {
  const b = findBlock(page, id);
  if (!b || b.inserted) return false;
  const si = srcIndexOf(page, b);
  const an = session && session.analysis && si !== null && si !== undefined ? session.analysis(si) : null;
  const parts = b.parts.filter((p) => cropPart(page, b, p, keep, an));
  if (!parts.length) { page.blocks = page.blocks.filter((x) => x !== b); return 'deleted'; }
  b.parts = parts;
  // the block now starts at its first remaining content
  const s = b.s || 1;
  const minDx = Math.min(...parts.map((p) => p.dx)), minDy = Math.min(...parts.map((p) => p.dy));
  parts.forEach((p) => { p.dx -= minDx; p.dy -= minDy; });
  b.x += minDx * s; b.y += minDy * s;
  recalcBlock(b);
  return true;
}
