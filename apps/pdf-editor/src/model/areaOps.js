// Area tools: "Böl ve Ayır" (split out) and "Alan Sil" (erase area).
import { newId, partRect, recalcBlock, blockRects, blockRect } from './blockOps.js';
import { rectsOverlap } from '../core/geometry.js';
import { cropBlock } from './cropOps.js';
import { srcIndexOf, isForeign } from './blockState.js';
import { purgePartText, purgePartOutside } from './partTextPurge.js';

function inter(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 - x > 0.5 && y2 - y > 0.5 ? { x, y, w: x2 - x, h: y2 - y } : null;
}
const contains = (o, i) => i.x >= o.x - 0.3 && i.y >= o.y - 0.3 && i.x + i.w <= o.x + o.w + 0.3 && i.y + i.h <= o.y + o.h + 0.3;

// page rect -> part source rect
function toSource(b, p, r) {
  const d = partRect(b, p);
  const k = p.dw / d.w;
  const ox = p.clip ? p.clip.x : p.src.x, oy = p.clip ? p.clip.y : p.src.y;
  return { x: ox + (r.x - d.x) * k, y: oy + (r.y - d.y) * k, w: r.w * k, h: r.h * k };
}

// tag: extra fields stored on every hole / patch this call makes (OCR passes
// { ocrId } so "Bir alanı eski hâline döndür" can take its own patches back)
export function eraseArea(page, rect, mode = 'natural', fill = null, session = null, tag = null) {
  const extra = { ...(fill ? { fill, clear: true } : {}), ...(tag || {}) };
  const T = tag || {};
  let touched = false;
  const remove = [];
  let inside = 0; // covered area that lies on block parts
  for (const b of page.blocks) {
    const an = session && session.analyses ? session.analyses.get(srcIndexOf(page, b)) : null;
    const keep = [];
    for (const p of b.parts) {
      const d = partRect(b, p);
      const i = inter(d, rect);
      if (!i) { keep.push(p); continue; }
      touched = true;
      if (contains(rect, d)) { if (p.src && !isForeign(b) && !p.addedText && !p.addedTable) page.deleted.push({ ...p.src, mode, ...T }); continue; }
      if (!p.src) { keep.push(p); continue; }
      const m = fill ? 0.8 : 0;
      const im = m ? (inter(d, { x: i.x - m, y: i.y - m, w: i.w + 2 * m, h: i.h + 2 * m }) || i) : i;
      const sRect = toSource(b, p, im);
      purgePartText(an, p, sRect);
      if (fill) {
        // "Gizle": the fill (with a small margin) becomes part of the block's own
        // picture, so it moves and scales with the block as one piece
        p.erase = [...(p.erase || []), { ...sRect, mode, clear: true, fill: { ...fill }, ...T }];
        inside += i.w * i.h;
      } else p.erase = [...(p.erase || []), { ...sRect, mode, ...T }];
      keep.push(p);
    }
    if (!b.parts.length) {
      const r = blockRects(b)[0];
      if (contains(rect, r)) { remove.push(b.id); touched = true; }
      continue;
    }
    b.parts = keep;
    if (!keep.length) remove.push(b.id); else recalcBlock(b);
  }
  page.blocks = page.blocks.filter((b) => !remove.includes(b.id));
  // the area may also contain page decoration outside any block; when the cover
  // lies on blocks, their own pictures carry the fill and the page only gets a hole
  if (fill && inside >= 0.85 * rect.w * rect.h) page.erase.push({ ...rect, mode: 'natural', clear: true, baked: true, ...T });
  else page.erase.push({ ...rect, mode, ...extra });
  return touched || true;
}

// returns { ok, newIds } or { ok:false, reason }
export function splitArea(page, rect, session = null) {
  const created = [];
  const hits = [];
  for (const b of page.blocks) for (const p of b.parts) { const d = partRect(b, p); const i = inter(d, rect); if (i && p.src) hits.push({ b, p, i, d }); }
  if (!hits.length) return { ok: false, reason: 'nothingHere' };
  const byBlock = new Map();
  const addCreatedPart = (b, part) => {
    let arr = byBlock.get(b);
    if (!arr) { arr = []; byBlock.set(b, arr); }
    arr.push(part);
  };
  const makeSubPart = (an, b, p, d, qPage, forCreated) => {
    const bs = b.s || 1, sc = p.sc || 1;
    const baseOx = p.clip ? p.clip.x : p.src.x, baseOy = p.clip ? p.clip.y : p.src.y;
    const kX = p.dw / d.w, kY = p.dh / d.h;
    const win = { x: baseOx + (qPage.x - d.x) * kX, y: baseOy + (qPage.y - d.y) * kY, w: qPage.w * kX, h: qPage.h * kY };
    const cp = structuredClone(p);
    cp.id = newId('p');
    cp.cut = true;
    cp.erase = (p.erase || []).filter((e) => rectsOverlap(e, win));
    purgePartOutside(an, cp, { x: baseOx, y: baseOy, w: p.dw, h: p.dh }, win);
    if (p.edit && p.obj === 'text' && !(p.keep && p.keep.length)) {
      const hasRuns = cp.edit && cp.edit.runs && cp.edit.runs.some((r) => (r.text || '').trim());
      const hasGlyph = Array.isArray(cp.keepG) && cp.keepG.length > 0;
      if (!hasRuns && !hasGlyph) return null;
    }
    if (!p.edit && !p.nine && !p.clip) {
      cp.src = { ...win };
      if (cp.full) cp.full = { ...win };
    } else if (p.obj === 'text' && !(p.keep && p.keep.length)) {
      cp.src = { ...win };
      if (cp.full) cp.full = { ...win };
      delete cp.clip;
      if (cp.edit) { delete cp.edit.delta; delete cp.edit.deltaX; delete cp.edit.deltaLeft; }
    } else {
      cp.clip = { ...win };
    }
    cp.dw = win.w; cp.dh = win.h;
    if (forCreated) { cp.dx = qPage.x; cp.dy = qPage.y; cp.sc = bs * sc; }
    else { cp.dx = p.dx + (qPage.x - d.x) / bs; cp.dy = p.dy + (qPage.y - d.y) / bs; }
    return cp;
  };
  for (const { b, p, i, d } of hits) {
    if (contains(i, d)) continue; // whole part inside: grouped into the new block below
    const si = srcIndexOf(page, b);
    const an = session && session.analysis && si !== null && si !== undefined ? session.analysis(si) : null;
    const remPages = [];
    if (i.y > d.y + 0.5) remPages.push({ x: d.x, y: d.y, w: d.w, h: i.y - d.y });
    if (i.y + i.h < d.y + d.h - 0.5) remPages.push({ x: d.x, y: i.y + i.h, w: d.w, h: d.y + d.h - i.y - i.h });
    if (i.x > d.x + 0.5) remPages.push({ x: d.x, y: i.y, w: i.x - d.x, h: i.h });
    if (i.x + i.w < d.x + d.w - 0.5) remPages.push({ x: i.x + i.w, y: i.y, w: d.x + d.w - i.x - i.w, h: i.h });
    const newParts = remPages.map((q) => makeSubPart(an, b, p, d, q, false)).filter(Boolean);
    const cutPart = makeSubPart(an, b, p, d, i, true);
    const idx = b.parts.indexOf(p);
    b.parts.splice(idx, 1, ...newParts);
    if (cutPart) addCreatedPart(b, cutPart);
  }
  // parts entirely inside the rect: move them out of their block into the SAME new block per source block
  const whole = hits.filter(({ i, d }) => contains(i, d));
  for (const { b, p, d } of whole) {
    if (b.parts.length === 1 && !byBlock.has(b)) continue; // the block itself already is the piece
    b.parts.splice(b.parts.indexOf(p), 1);
    addCreatedPart(b, { ...p, dx: d.x, dy: d.y, sc: (b.s || 1) * (p.sc || 1) });
  }
  for (const [b, parts] of byBlock) {
    const minX = Math.min(...parts.map((pt) => pt.dx));
    const minY = Math.min(...parts.map((pt) => pt.dy));
    for (const pt of parts) { pt.dx -= minX; pt.dy -= minY; }
    created.push(recalcBlock({ id: newId('b'), kind: b.kind || parts[0].kind, x: minX, y: minY, s: 1, bw: 0, bh: 0, parts, ...(isForeign(b) ? { from: b.from } : {}) }));
  }
  for (const b of page.blocks) if (b.parts.length) recalcBlockKeepOrigin(b);
  page.blocks = page.blocks.filter((b) => b.parts.length > 0 || b.inserted);
  page.blocks.push(...created);
  return { ok: true, newIds: created.map((c) => c.id) };
}

// after removing parts the block may start further right/down: normalise
function recalcBlockKeepOrigin(b) {
  const s = b.s || 1;
  const minDx = Math.min(...b.parts.map((p) => p.dx)), minDy = Math.min(...b.parts.map((p) => p.dy));
  if (minDx > 0.01 || minDy > 0.01) {
    b.parts.forEach((p) => { p.dx -= minDx; p.dy -= minDy; });
    b.x += minDx * s; b.y += minDy * s;
  }
  recalcBlock(b);
}

// "Gizle": cover a rectangle with a colour (or gradient). Whatever is under it
// no longer exists: removed on export, and blocks give back the covered edge
// bands so other blocks can be placed there.
export function coverArea(page, rect, fill, session = null) {
  for (const b of page.blocks.slice()) {
    if (b.inserted || b.free) continue;
    const R = blockRect(b);
    const ix0 = Math.max(R.x, rect.x), iy0 = Math.max(R.y, rect.y), ix1 = Math.min(R.x + R.w, rect.x + rect.w), iy1 = Math.min(R.y + R.h, rect.y + rect.h);
    if (ix1 - ix0 < 0.5 || iy1 - iy0 < 0.5) continue;
    const fullW = ix0 <= R.x + 0.5 && ix1 >= R.x + R.w - 0.5, fullH = iy0 <= R.y + 0.5 && iy1 >= R.y + R.h - 0.5;
    let keep = null;
    if (fullW && iy0 <= R.y + 0.5 && iy1 < R.y + R.h) keep = { x: R.x, y: iy1, w: R.w, h: R.y + R.h - iy1 };
    else if (fullW && iy1 >= R.y + R.h - 0.5 && iy0 > R.y) keep = { x: R.x, y: R.y, w: R.w, h: iy0 - R.y };
    else if (fullH && ix0 <= R.x + 0.5 && ix1 < R.x + R.w) keep = { x: ix1, y: R.y, w: R.x + R.w - ix1, h: R.h };
    else if (fullH && ix1 >= R.x + R.w - 0.5 && ix0 > R.x) keep = { x: R.x, y: R.y, w: ix0 - R.x, h: R.h };
    if (keep) {
      const an = session && session.analyses ? session.analyses.get(srcIndexOf(page, b)) : null;
      for (const p of b.parts) {
        if (!p.src) continue;
        const i = inter(partRect(b, p), rect);
        if (i) purgePartText(an, p, toSource(b, p, i));
      }
      cropBlock(page, b.id, keep, session);
    }
  }
  return eraseArea(page, rect, 'cover', fill, session);
}

// "Bir alanı eski hâline döndür": OCR text blocks lying (mostly) in rect are
// removed together with every hole / cover patch they made, so the original
// page image shows there again; rect is remembered (page.keepOriginal) and
// later scans leave it alone. Returns false when nothing changed.
export function restoreOriginalArea(page, rect) {
  const area = (r) => Math.max(1e-6, r.w * r.h);
  const ids = new Set();
  for (const b of page.blocks) {
    if (!b._ocrBlock) continue;
    const r = blockRect(b), i = inter(r, rect);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const centreIn = cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
    if (i && (centreIn || i.w * i.h >= 0.5 * area(r))) ids.add(b.id);
  }
  // patches of removed blocks, and untagged-by-block OCR patches inside rect
  const mine = (e) => e && e.ocrId && (ids.has(e.ocrId) || contains(rect, e));
  const before = JSON.stringify([page.blocks.length, page.erase.length, page.deleted.length]);
  page.blocks = page.blocks.filter((b) => !ids.has(b.id));
  page.erase = page.erase.filter((e) => !mine(e));
  page.deleted = page.deleted.filter((e) => !mine(e));
  let partChanged = false;
  for (const b of page.blocks) {
    for (const p of b.parts || []) {
      if (!p.erase || !p.erase.length) continue;
      const src = toSource(b, p, rect);
      const keep = p.erase.filter((e) => !(e.ocrId && (ids.has(e.ocrId) || contains(src, e))));
      if (keep.length !== p.erase.length) { p.erase = keep; partChanged = true; }
    }
  }
  page.keepOriginal = [...(page.keepOriginal || []), { x: rect.x, y: rect.y, w: rect.w, h: rect.h }];
  return partChanged || before !== JSON.stringify([page.blocks.length, page.erase.length, page.deleted.length]) || true;
}
