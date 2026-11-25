// Photos inside a block for the block editor: find them, then apply the
// user's changes (move / resize / delete / replace) and fit the block back
// into its slot (push the blocks below down, else shrink to fit).
import * as ops from './blockOps.js';
import { putImage } from '../core/imageStore.js';
import { splitArea, eraseArea } from './areaOps.js';
import { partDestRect } from './blockState.js';

const inside = (o, i, t = 1) => i.x0 >= o.x - t && i.y0 >= o.y - t && i.x1 <= o.x + o.w + t && i.y1 <= o.y + o.h + t;

export function findPhotos(an, page, block) {
  const out = [];
  for (const p of block.parts) {
    if (!p.src || p.kind === 'insimg') continue;
    const d = partDestRect(block, p), k = d.w / p.src.w;
    const imgs = an.atoms.gfx.filter((g) => g.kind === 'image' && g.area > 300 && inside(p.src, g.b));
    for (const g of imgs) {
      // include a frame drawn tightly around the picture
      let b = { ...g.b };
      for (const f of an.atoms.gfx) {
        if (f === g || f.kind === 'image') continue;
        const m = 7;
        if (f.b.x0 <= b.x0 + 0.5 && f.b.y0 <= b.y0 + 0.5 && f.b.x1 >= b.x1 - 0.5 && f.b.y1 >= b.y1 - 0.5
          && f.b.x0 > g.b.x0 - m && f.b.y0 > g.b.y0 - m && f.b.x1 < g.b.x1 + m && f.b.y1 < g.b.y1 + m) {
          b = { x0: Math.min(b.x0, f.b.x0), y0: Math.min(b.y0, f.b.y0), x1: Math.max(b.x1, f.b.x1), y1: Math.max(b.y1, f.b.y1) };
        }
      }
      if (!inside(p.src, b, 0.5)) b = { x0: Math.max(b.x0, p.src.x), y0: Math.max(b.y0, p.src.y), x1: Math.min(b.x1, p.src.x + p.src.w), y1: Math.min(b.y1, p.src.y + p.src.h) };
      if ((p.erase || []).some((e) => e.x <= b.x0 + 1 && e.y <= b.y0 + 1 && e.x + e.w >= b.x1 - 1 && e.y + e.h >= b.y1 - 1)) continue;
      if (out.some((o) => o.partId === p.id && Math.abs(o.sb.x0 - b.x0) < 1 && Math.abs(o.sb.y0 - b.y0) < 1)) continue;
      out.push({ id: `ph${out.length}`, partId: p.id, sb: b, edited: !!p.edit, rect: { x: d.x + (b.x0 - p.src.x) * k, y: d.y + (b.y0 - p.src.y) * k, w: (b.x1 - b.x0) * k, h: (b.y1 - b.y0) * k } });
    }
  }
  return out;
}

// changes: [{ rect, to?: rect, del?: true, replace?: { dataUrl, aspect } }]
// Runs inside a controller commit. Returns { id } of the block or { error }.
export function applyPhotoChanges(page, blockId, changes) {
  let id = blockId;
  const before = ops.blockRect(ops.findBlock(page, id));
  for (const c of changes) {
    const b = ops.findBlock(page, id);
    if (!b) break;
    if (c.del || c.replace) {
      eraseArea(page, c.rect);
      if (c.replace) {
        const to = c.to || c.rect;
        const bs = b.s || 1;
        const w = to.w / bs, hh = w * (c.replace.aspect || to.h / to.w);
        b.parts.push({ id: ops.newId('p'), kind: 'insimg', src: null, editable: false,
          img: { imgId: putImage(c.replace.dataUrl), caption: '', capSize: 0, anchor: 0, wrap: false, width: 1, aspect: c.replace.aspect, iw: w, ih: hh },
          dx: (to.x - b.x) / bs, dy: (to.y - b.y) / bs, dw: w, dh: hh, sc: 1 });
        normalise(b);
      }
      if (!ops.findBlock(page, id)) return { error: 'gone' };
      continue;
    }
    if (!c.to) continue;
    const ids0 = new Set(page.blocks.map((x) => x.id));
    const res = splitArea(page, c.rect);
    if (!res.ok) return { error: res.reason };
    const pieces = res.newIds.map((n) => ops.findBlock(page, n));
    let piece = pieces[0];
    const k = c.to.w / c.rect.w;
    if (!piece) { piece = ops.findBlock(page, id); } // the whole block was the photo
    piece.x = c.to.x; piece.y = c.to.y; piece.s = (piece.s || 1) * k;
    if (piece.id !== id && ops.findBlock(page, id)) id = ops.mergeBlocks(page, [id, piece.id]) || id;
    void ids0;
  }
  const b = ops.findBlock(page, id);
  if (b) fitBack(page, b, before);
  return { id };
}

function normalise(b) {
  const s = b.s || 1;
  const minDx = Math.min(...b.parts.map((p) => p.dx)), minDy = Math.min(...b.parts.map((p) => p.dy));
  if (minDx < 0 || minDy < 0) {
    b.parts.forEach((p) => { p.dx -= Math.min(0, minDx); p.dy -= Math.min(0, minDy); });
    b.x += Math.min(0, minDx) * s; b.y += Math.min(0, minDy) * s;
  }
  ops.recalcBlock(b);
}

// Make the edited block fit again: push the blocks below down when they can
// move (all still on the page), otherwise shrink the block into its slot.
export function fitBack(page, b, before) {
  normalise(b);
  if (b.x < 0) b.x = 0;
  if (b.y < 0) b.y = 0;
  const rInit = ops.blockRect(b);
  const sideMargin = Math.min(52, Math.max(28, Math.round(page.w * 0.085)));
  const beyondMargin = !!(before && (before.x < sideMargin - 1 || before.x + before.w > page.w - sideMargin + 1));
  const mL = beyondMargin ? 8 : sideMargin;
  const mR = beyondMargin ? 8 : sideMargin;
  const maxW = Math.max(40, page.w - mL - mR);
  const grewW = !!(before && rInit.w > before.w + 1);
  if (grewW || rInit.x < mL - 0.5 || rInit.x + rInit.w > page.w - mR + 0.5) {
    const origCx = before ? (before.x + before.w * 0.5) : (page.w * 0.5);
    if (rInit.w > maxW) {
      const scaleX = maxW / Math.max(1, rInit.w);
      const newS = (b.s || 1) * scaleX;
      if (!ops.collides(page, b, { x: mL, y: b.y, s: newS })) {
        b.x = mL;
        b.s = newS;
      } else {
        b.x = Math.max(mL, Math.min(page.w - mR - rInit.w * scaleX, b.x));
        b.s = newS;
      }
    } else {
      const wantX = grewW
        ? Math.max(mL, Math.min(page.w - mR - rInit.w, origCx - rInit.w * 0.5))
        : Math.max(mL, Math.min(page.w - mR - rInit.w, b.x));
      if (Math.abs(wantX - b.x) > 0.5) {
        if (!ops.collides(page, b, { x: wantX, y: b.y, s: b.s || 1 })) {
          b.x = wantX;
        } else {
          let lo = 0, hi = 1;
          for (let it = 0; it < 8; it++) {
            const m = (lo + hi) * 0.5;
            const tx = b.x + (wantX - b.x) * m;
            if (!ops.collides(page, b, { x: tx, y: b.y, s: b.s || 1 })) lo = m;
            else hi = m;
          }
          if (lo > 0.05) b.x = b.x + (wantX - b.x) * lo;
        }
      }
      const rPost = ops.blockRect(b);
      if (rPost.x + rPost.w > page.w - mR + 0.5) {
        const availW = Math.max(20, (page.w - mR) - rPost.x);
        b.s = (b.s || 1) * (availW / Math.max(1, rPost.w));
      }
    }
  }
  const rNow = ops.blockRect(b);
  if (rNow.x + rNow.w > page.w) {
    const shiftX = (rNow.x + rNow.w) - page.w;
    b.x = Math.max(0, b.x - shiftX);
    const rShifted = ops.blockRect(b);
    if (rShifted.x + rShifted.w > page.w) {
      const availW = Math.max(20, page.w - rShifted.x);
      b.s = (b.s || 1) * (availW / Math.max(1, rShifted.w));
    }
  }
  if (!ops.collides(page, b, b)) return 'ok';
  const r = ops.blockRect(b);
  const oldBottom = before.y + before.h;
  const dy = r.y + r.h - oldBottom;
  if (dy > 0) {
    // cascade: every block below moves only as far as needed to clear what is
    // above it, so the free gaps between blocks are used up first
    const below = page.blocks.filter((o) => o.id !== b.id && !o.free && ops.blockRect(o).y >= before.y + 1).sort((a, c) => a.y - c.y);
    const saved = below.map((o) => o.y);
    const placed = [ops.blockRect(b)];
    let ok = true;
    for (const o of below) {
      const r0 = ops.blockRect(o);
      let need = 0;
      for (const q of placed) if (q.x < r0.x + r0.w - 0.05 && r0.x < q.x + q.w - 0.05 && q.y < r0.y + r0.h) need = Math.max(need, q.y + q.h + 1 - r0.y);
      if (need > 0) {
        if (ops.isPinned(page, o) && need > 0) { /* a footer may move a little if there is room */ }
        o.y += need;
      }
      const r1 = ops.blockRect(o);
      if (r1.y + r1.h > page.h - 8) { ok = false; break; }
      placed.push(r1);
    }
    if (ok && !ops.collides(page, b, b) && below.every((o) => !ops.collides(page, o, o))) return below.some((o, i) => o.y !== saved[i]) ? 'pushed' : 'ok';
    below.forEach((o, i) => { o.y = saved[i]; });
  }
  // Before shrinking, try nudging to the nearest free spot at full scale (prevents tiny collapse when a table widens into a side neighbor)
  const nf = ops.nearestFree(page, [b], 0, 0, new Set([b.id]), 72);
  if (nf) {
    b.x += nf.dx;
    b.y += nf.dy;
    return 'ok';
  }
  // shrink around the best anchor until it fits (never collapse to 5% due to a left-edge overlap)
  const s0 = b.s || 1;
  const tryShrinkAt = (ax, ay) => {
    let lo = 0.05, hi = 1;
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (ops.collides(page, b, { x: ax, y: ay, s: s0 * m })) hi = m; else lo = m; }
    return { x: ax, y: ay, lo };
  };
  const anchors = [
    [b.x, b.y],
    [before.x, before.y],
    [Math.max(0, before.x + before.w - b.bw * s0), before.y],
  ];
  let best = tryShrinkAt(anchors[0][0], anchors[0][1]);
  for (let i = 1; i < anchors.length; i++) {
    const cand = tryShrinkAt(anchors[i][0], anchors[i][1]);
    if (cand.lo > best.lo) best = cand;
  }
  b.x = best.x; b.y = best.y; b.s = s0 * best.lo;
  return 'shrunk';
}
