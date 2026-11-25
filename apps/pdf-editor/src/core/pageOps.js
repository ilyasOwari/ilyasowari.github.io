// Operations that touch more than one page (one undo step for all of them):
// move blocks to a new page, make room by pushing blocks down (overflow goes
// to a new page), and placing new content near a point with shrink-to-fit.
import { snapshotPage, restorePage } from './history.js';
import * as ops from '../model/blockOps.js';
import { srcIndexOf, isForeign } from '../model/blockState.js';
import { dehydrateBlocks } from './imageStore.js';

// A page whose block model was never prepared is recorded as `null`: restoring
// it puts the page back to "unprepared" (rebuilt from the PDF on next use), so
// content moved onto such a page never survives an undo.
const pageState = (p) => (p.blocks ? snapshotPage(p) : null);
export function snapshotAll(s) {
  return {
    order: s.pages.slice(),
    states: new Map(s.pages.map((p) => [p.id, pageState(p)])),
    pageNums: s.pageNums ? { ...s.pageNums } : null,
    oldPageNumsAsked: !!s.oldPageNumsAsked,
  };
}
// Lazy variant for single-page operations that may spill onto other pages:
// only pages passed to touch() (BEFORE they are prepared or changed) are recorded.
export function snapshotLazy(s, pages = []) {
  const snap = { order: s.pages.slice(), states: new Map(), pageNums: s.pageNums ? { ...s.pageNums } : null, oldPageNumsAsked: !!s.oldPageNumsAsked };
  snap.touch = (p) => { if (p && !snap.states.has(p.id)) snap.states.set(p.id, pageState(p)); };
  pages.forEach(snap.touch);
  return snap;
}
// the "after" counterpart of a lazy snapshot: same page ids (+ pages added since)
export function snapshotLike(s, before) {
  const ids = new Set(before.states.keys());
  for (const p of s.pages) if (!before.order.includes(p)) ids.add(p.id);
  const byId = new Map(s.pages.concat(before.order).map((p) => [p.id, p]));
  const states = new Map();
  for (const id of ids) { const p = byId.get(id); if (p) states.set(id, pageState(p)); }
  return { order: s.pages.slice(), states, pageNums: s.pageNums ? { ...s.pageNums } : null, oldPageNumsAsked: !!s.oldPageNumsAsked };
}
export function restoreAll(s, snap) {
  const byId = new Map(s.pages.concat(snap.order).map((p) => [p.id, p]));
  s.pages = snap.order.slice();
  for (const [id, st] of snap.states) {
    const p = byId.get(id);
    if (!p) continue;
    if (st) restorePage(p, st);
    else if (p.blocks) { p.blocks = null; p.initial = undefined; p.deleted = []; p.erase = []; p.keepOriginal = []; p.whiteBg = false; p.version = (p.version || 0) + 1; }
  }
  if ('pageNums' in snap) s.pageNums = snap.pageNums ? { ...snap.pageNums } : null;
  if ('oldPageNumsAsked' in snap) s.oldPageNumsAsked = !!snap.oldPageNumsAsked;
}
// true when two snapshots describe the same document state
// (an unprepared page equals the same page freshly prepared and untouched)
export function sameSnap(s, a, b) {
  if (a.order.length !== b.order.length || a.order.some((p, i) => p !== b.order[i])) return false;
  if (JSON.stringify(a.pageNums) !== JSON.stringify(b.pageNums)) return false;
  const byId = new Map(s.pages.concat(a.order, b.order).map((p) => [p.id, p]));
  const ids = new Set([...a.states.keys(), ...b.states.keys()]);
  for (const id of ids) {
    let x = a.states.get(id), y = b.states.get(id);
    if (x === undefined || y === undefined) continue;
    const p = byId.get(id);
    if (x === null && y === null) continue;
    if (x === null) x = p && p.initial; if (y === null) y = p && p.initial;
    if (JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}
// notify views about a restored / changed set of pages
export function emitSnap(C, snap, orderChanged = true) {
  if (orderChanged) C.bus.emit('pages:changed');
  for (const id of snap.states.keys()) { const p = C.s.pageById(id); if (p) C.bus.emit('page:changed', p); }
}
// run fn(); record one history entry covering every page it changed
export function commitMulti(C, label, fn) {
  const s = C.s;
  const before = snapshotAll(s);
  let r;
  try { r = fn(); } catch (e) { restoreAll(s, before); throw e; }
  if (r === false || r === null || r === undefined) { restoreAll(s, before); C.bus.emit('pages:changed'); return r; }
  for (const p of s.pages) dehydrateBlocks(p.blocks);
  const after = snapshotAll(s);
  if (sameSnap(s, before, after)) { C.bus.emit('pages:changed'); return r; }
  s.history.push({ type: 'multi', before, after, label });
  s.dirty = true;
  for (const p of s.pages) if (p.blocks) p.version = (p.version || 0) + 1;
  C.bus.emit('pages:changed');
  for (const p of s.pages) if (p.blocks) C.bus.emit('page:changed', p);
  C.bus.emit('history');
  return r;
}

export function newBlankPage(s, ref) {
  const pg = { id: ops.newId('pg'), srcIndex: null, w: ref.w, h: ref.h, blocks: [], deleted: [], erase: [], whiteBg: false, version: 0 };
  pg.initial = snapshotPage(pg);
  return pg;
}
const topMargin = (page) => {
  const ys = (page.blocks || []).filter((b) => !ops.isPinned(page, b)).map((b) => b.y);
  return Math.max(24, Math.min(60, ys.length ? Math.min(...ys) : 50));
};

// Take blocks off `page` (leaving their area empty) and return them ready for another page.
export function detach(page, bs) {
  for (const b of bs) {
    if (!isForeign(b)) for (const p of b.parts) if (p.src && !p.addedText && !p.addedTable) page.deleted.push({ x: p.src.x, y: p.src.y, w: p.src.w, h: p.src.h });
    b.from = srcIndexOf(page, b);
    if (b.from === null) delete b.from; // blank-page content (inserted items) needs no source
  }
  const set = new Set(bs.map((b) => b.id));
  page.blocks = page.blocks.filter((b) => !set.has(b.id));
  return bs;
}

// "Sonraki sayfaya taşı": a new blank page right after, blocks at its top (same x)
export function moveToNewPage(C, page, ids) {
  return commitMulti(C, 'toNextPage', () => {
    const s = C.s;
    const bs = page.blocks.filter((b) => ids.includes(b.id));
    if (!bs.length) return false;
    const np = newBlankPage(s, page);
    s.pages.splice(s.pages.indexOf(page) + 1, 0, np);
    const top = Math.min(...bs.map((b) => b.y));
    const m = topMargin(page);
    detach(page, bs).forEach((b) => { b.y = b.y - top + m; np.blocks.push(b); });
    return np;
  });
}

// Push everything at or below y down by dy; blocks that no longer fit move
// (in reading order) to a new page inserted after this one.
export function pushDown(s, page, y, dy, ignore = new Set()) {
  const movers = page.blocks.filter((b) => !ignore.has(b.id) && b.y >= y - 0.5 && !ops.isPinned(page, b)).sort((a, b) => a.y - b.y);
  const bottom = page.h - Math.max(24, page.h * 0.07);
  const overflow = [];
  for (const b of movers) {
    const r = ops.blockRect(b);
    if (r.y + dy + r.h > bottom) overflow.push(b); else b.y += dy;
  }
  if (!overflow.length) return null;
  const np = newBlankPage(s, page);
  s.pages.splice(s.pages.indexOf(page) + 1, 0, np);
  const top = Math.min(...overflow.map((b) => b.y));
  const m = topMargin(page);
  detach(page, overflow).forEach((b) => { b.y = b.y - top + m; np.blocks.push(b); });
  return np;
}

// Best free spot near `pref` (page coords), shrinking down to `minS`.
export function bestSpot(page, block, pref, minS = 0.6) {
  let best = null;
  for (let s = 1; s >= minS - 1e-9; s -= 0.1) {
    const w = block.bw * s, h = block.bh * s;
    const m = 18;
    for (let y = m; y + h <= page.h - m; y += 4) {
      for (let x = m; x + w <= page.w - m; x += 4) {
        if (ops.collides(page, block, { x, y, s })) continue;
        const d = Math.hypot(Math.max(0, x - pref.x, pref.x - (x + w)) * 0.5, y - pref.y) + (1 - s) * 260;
        if (!best || d < best.d) best = { x, y, s, d };
      }
    }
    if (best && best.d < 60 + (1 - s) * 260) break;
  }
  return best;
}

// Insert a new block near pref; if nothing fits, open room below pref (overflow to a new page).
export function insertNear(C, page, block, pref, exact = false) {
  return commitMulti(C, 'insert', () => {
    C.s.ensurePage(page);
    if (block.free) {
      // floating objects: an empty spot near the point if there is one, else on top
      let spot = null;
      if (!exact) { block.free = false; spot = bestSpot(page, block, pref, 1); block.free = true; }
      if (!spot) {
        const k = Math.min(1, (page.w - 8) / block.bw, (page.h - 8) / block.bh);
        spot = { x: Math.max(4, Math.min(pref.x, page.w - block.bw * k - 4)), y: Math.max(4, Math.min(pref.y, page.h - block.bh * k - 4)), s: k };
      }
      block.x = spot.x; block.y = spot.y; block.s = spot.s;
      page.blocks.push(block);
      return block.id;
    }
    let spot = bestSpot(page, block, pref);
    if (!spot) {
      const y = Math.max(18, Math.min(pref.y, page.h - block.bh - 30));
      const below = page.blocks.filter((b) => b.y >= y - 0.5 && !ops.isPinned(page, b));
      const yTop = below.length ? Math.min(...below.map((b) => b.y)) : y;
      pushDown(C.s, page, yTop, block.bh + 6);
      spot = bestSpot(page, block, { x: pref.x, y: yTop }, 1) || bestSpot(page, block, pref, 0.3);
      if (!spot) return false;
    }
    block.x = spot.x; block.y = spot.y; block.s = spot.s;
    page.blocks.push(block);
    return block.id;
  });
}

// "Önceki sayfa" / "Sonraki sayfa": shared placement & page-shift logic.
const contentBlocks = (page) => (page.blocks || []).filter((b) => !b.free && !ops.isPinned(page, b));
function marginsOf(page, refPage = null) {
  const cb = contentBlocks(page).map(ops.blockRect);
  const pins = (page.blocks || []).filter((b) => !b.free && ops.isPinned(page, b)).map(ops.blockRect);
  const hdrBot = Math.max(0, ...pins.filter((r) => r.y + r.h < page.h * 0.12).map((r) => r.y + r.h + 6));
  const ftrTop = Math.min(page.h, ...pins.filter((r) => r.y > page.h * 0.6).map((r) => r.y - 6));
  const top = Math.max(24, hdrBot, cb.length ? Math.min(52, Math.min(...cb.map((r) => r.y))) : (refPage ? topMargin(refPage) : 40));
  const bot = Math.min(ftrTop, page.h - Math.max(24, Math.min(48, page.h * 0.055)));
  const left = cb.length ? Math.max(18, Math.min(48, Math.min(...cb.map((r) => r.x)))) : 36;
  const right = cb.length ? Math.max(18, Math.min(48, page.w - Math.max(...cb.map((r) => r.x + r.w)))) : 36;
  return { top, bot, left, right, hdrBot };
}
function gapOfPage(page) {
  const rs = contentBlocks(page).map(ops.blockRect).sort((a, b) => a.y - b.y);
  const gs = [];
  for (let i = 1; i < rs.length; i++) {
    const g = rs[i].y - Math.max(...rs.slice(0, i).map((r) => r.y + r.h));
    if (g > 0.5 && g < 60) gs.push(g);
  }
  if (!gs.length) return 10;
  gs.sort((a, b) => a - b);
  return Math.max(6, Math.min(28, gs[gs.length >> 1]));
}
function groupBox(bs) {
  const rs = bs.map(ops.blockRect);
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}
function canPlaceGroup(target, bs, gx, gy, m) {
  const g = groupBox(bs);
  if (gx < m.left - 0.5 || gx + g.w > target.w - m.right + 0.5 || gy < m.top - 0.5 || gy + g.h > m.bot + 0.5) return false;
  const dx = gx - g.x, dy = gy - g.y;
  const ig = new Set(bs.map((b) => b.id));
  return !bs.some((b) => ops.collides(target, b, { x: b.x + dx, y: b.y + dy, s: b.s }, ig));
}
function putGroup(target, bs, gx, gy) {
  const g = groupBox(bs);
  const dx = gx - g.x, dy = gy - g.y;
  bs.forEach((b) => { b.x += dx; b.y += dy; target.blocks.push(b); });
}
function clampX(origX, gw, target, m) {
  return Math.max(m.left, Math.min(origX, target.w - m.right - gw));
}

// Strict NEXT-page fit: only above topmost block, to the right of topmost row
// (without entering space beside lower blocks), or pushing target's blocks down.
function tryPlaceNext(target, bs, srcPage = null) {
  const m = marginsOf(target, srcPage);
  const g = groupBox(bs);
  const cb = contentBlocks(target);
  const gap = gapOfPage(target);
  const prefX = clampX(g.x, g.w, target, m);
  if (!cb.length) {
    const gy = m.top;
    for (const gx of [prefX, m.left]) if (canPlaceGroup(target, bs, gx, gy, m)) { putGroup(target, bs, gx, gy); return true; }
    return false;
  }
  const rs = cb.map(ops.blockRect).sort((a, b) => a.y - b.y || a.x - b.x);
  const topY = rs[0].y;
  const topLim = Math.max(24, m.hdrBot);
  const mTight = { ...m, top: topLim };
  // 1) Above topmost block
  if (topY - gap - g.h >= topLim - 0.5) {
    const gy = Math.max(topLim, Math.min(m.top, topY - gap - g.h));
    for (const gx of [prefX, m.left]) if (canPlaceGroup(target, bs, gx, gy, mTight)) { putGroup(target, bs, gx, gy); return true; }
  }
  // 2) To the right of topmost block (never beside blocks below top row)
  const topRow = rs.filter((r) => r.y < rs[0].y + rs[0].h - 1);
  const topRowRight = Math.max(...topRow.map((r) => r.x + r.w));
  const belowTop = rs.filter((r) => !topRow.includes(r));
  const nextRowTop = belowTop.length ? Math.min(...belowTop.map((r) => r.y)) : Infinity;
  const rx = topRowRight + gap;
  if (topY + g.h <= Math.min(m.bot, nextRowTop - 0.5) + 0.5 && canPlaceGroup(target, bs, rx, topY, mTight)) {
    putGroup(target, bs, rx, topY); return true;
  }
  // 3) Push target's content blocks down within page margins
  const yPlace = Math.max(topLim, Math.min(m.top, topY));
  const need = Math.max(0, yPlace + g.h + gap - topY);
  const maxBot = Math.max(...rs.map((r) => r.y + r.h));
  if (need > 0 && maxBot + need <= m.bot + 0.5) {
    const ids = new Set(cb.map((b) => b.id));
    if (cb.every((b) => !ops.collides(target, b, { x: b.x, y: b.y + need, s: b.s }, ids))) {
      cb.forEach((b) => { b.y += need; });
      const ok = [prefX, m.left].find((gx) => canPlaceGroup(target, bs, gx, yPlace, mTight));
      if (ok !== undefined) { putGroup(target, bs, ok, yPlace); return true; }
      cb.forEach((b) => { b.y -= need; });
    }
  }
  return false;
}

// Strict PREVIOUS-page fit: only to the right of bottommost row (never beside
// blocks above it), below bottommost block, or after pulling target's blocks up.
function tryPlacePrev(target, bs) {
  const m = marginsOf(target);
  const g = groupBox(bs);
  const cb = contentBlocks(target);
  const gap = gapOfPage(target);
  const prefX = clampX(g.x, g.w, target, m);
  if (!cb.length) {
    const gy = m.top;
    for (const gx of [prefX, m.left]) if (canPlaceGroup(target, bs, gx, gy, m)) { putGroup(target, bs, gx, gy); return true; }
    return false;
  }
  const rs = cb.map(ops.blockRect);
  const botY = Math.max(...rs.map((r) => r.y + r.h));
  const botRow = rs.filter((r) => r.y + r.h >= botY - 4);
  const botRowTop = Math.min(...botRow.map((r) => r.y));
  const botRowRight = Math.max(...botRow.map((r) => r.x + r.w));
  const aboveRow = rs.filter((r) => r.y + r.h <= botRowTop + 1);
  const prevRowBot = aboveRow.length ? Math.max(...aboveRow.map((r) => r.y + r.h)) : 0;
  // 1) To the right of bottommost row (must stay at/below botRowTop & clear of aboveRow)
  const rx = botRowRight + gap, ry = Math.max(botRowTop, prevRowBot > 0 ? prevRowBot + 0.5 : m.top);
  if (canPlaceGroup(target, bs, rx, ry, m)) { putGroup(target, bs, rx, ry); return true; }
  // 2) Below bottommost block
  const belowY = botY + gap;
  for (const gx of [prefX, m.left]) if (canPlaceGroup(target, bs, gx, belowY, m)) { putGroup(target, bs, gx, belowY); return true; }
  // 3) Pull target's content blocks up (rigid shift first, then compact large middle holes)
  const topLim = Math.max(24, m.hdrBot, Math.min(36, Math.min(...rs.map((r) => r.y))));
  const topY = Math.min(...rs.map((r) => r.y));
  const need = (botY + gap + g.h) - m.bot;
  const maxRigid = topY - topLim;
  if (need > 0 && maxRigid >= need - 0.5) {
    const ids = new Set(cb.map((b) => b.id));
    if (cb.every((b) => !ops.collides(target, b, { x: b.x, y: b.y - need, s: b.s }, ids))) {
      cb.forEach((b) => { b.y -= need; });
      const py = (botY - need) + gap;
      const ok = [prefX, m.left].find((gx) => canPlaceGroup(target, bs, gx, py, m));
      if (ok !== undefined) { putGroup(target, bs, ok, py); return true; }
      cb.forEach((b) => { b.y += need; });
    }
  }
  return false;
}

export function movePageAdjacent(C, page, ids, dir, mode = 'auto') {
  const s = C.s;
  const srcBs = page.blocks.filter((b) => ids.includes(b.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  if (!srcBs.length) return { ok: false, reason: 'none' };
  const idx = s.pages.indexOf(page);
  if (dir < 0) {
    if (idx <= 0) return { ok: false, reason: 'noSpacePrev' };
    let target = null;
    const ok = commitMulti(C, 'toPrevPage', () => {
      const prev = s.pages[idx - 1];
      s.ensurePage(prev);
      const bs = page.blocks.filter((b) => ids.includes(b.id)).sort((a, b) => a.y - b.y || a.x - b.x);
      detach(page, bs);
      if (!tryPlacePrev(prev, bs)) return false;
      target = prev; return prev;
    });
    return ok ? { ok: true, page: target } : { ok: false, reason: 'noSpacePrev' };
  }
  // NEXT page: last page or explicit 'blank' inserts blank page immediately
  if (mode === 'blank' || idx + 1 >= s.pages.length) {
    let np = null;
    commitMulti(C, 'toNextPage', () => {
      const bs = page.blocks.filter((b) => ids.includes(b.id)).sort((a, b) => a.y - b.y || a.x - b.x);
      np = newBlankPage(s, page);
      s.pages.splice(s.pages.indexOf(page) + 1, 0, np);
      const m = topMargin(page);
      const top = Math.min(...bs.map((b) => b.y));
      detach(page, bs).forEach((b) => { b.y = b.y - top + m; np.blocks.push(b); });
      return np;
    });
    return { ok: true, page: np };
  }
  if (mode === 'shift') {
    let target = null;
    const ok = commitMulti(C, 'toNextPage', () => {
      const next = s.pages[idx + 1];
      const bs = page.blocks.filter((b) => ids.includes(b.id)).sort((a, b) => a.y - b.y || a.x - b.x);
      detach(page, bs);
      let prevPage = page;
      let cur = next;
      let incoming = bs;
      while (cur && incoming.length) {
        s.ensurePage(cur);
        // Evict bottom blocks from cur one by one until incoming fits at the top
        const order = contentBlocks(cur).sort((a, b) => {
          const ra = ops.blockRect(a), rb = ops.blockRect(b);
          return (rb.y + rb.h) - (ra.y + ra.h) || rb.x - ra.x;
        });
        const evicted = [];
        let placed = tryPlaceNext(cur, incoming, prevPage);
        while (!placed && order.length) {
          const btm = order.shift();
          evicted.push(btm);
          cur.blocks = cur.blocks.filter((x) => x !== btm);
          placed = tryPlaceNext(cur, incoming, prevPage);
        }
        if (!placed) {
          if (cur === next) return false;
          // Restore cur and place incoming on a new blank page right before cur
          cur.blocks.push(...evicted);
          const bp = newBlankPage(s, prevPage);
          s.pages.splice(s.pages.indexOf(cur), 0, bp);
          const m = topMargin(prevPage);
          const evTop = Math.min(...incoming.map((b) => b.y));
          incoming.forEach((b) => { b.y = b.y - evTop + m; bp.blocks.push(b); });
          break;
        }
        const sortedEv = evicted.sort((a, b) => a.y - b.y || a.x - b.x);
        if (!sortedEv.length) break;
        // Restore evicted blocks temporarily on `cur` so `detach(cur, sortedEv)` records holes & from cleanly
        cur.blocks.push(...sortedEv);
        detach(cur, sortedEv);
        const fol = s.pages[s.pages.indexOf(cur) + 1] || null;
        if (fol && fol.w === cur.w) {
          prevPage = cur;
          cur = fol;
          incoming = sortedEv;
        } else {
          const bp = newBlankPage(s, cur);
          s.pages.splice(s.pages.indexOf(cur) + 1, 0, bp);
          const m = topMargin(cur);
          const evTop = Math.min(...sortedEv.map((b) => b.y));
          sortedEv.forEach((b) => { b.y = b.y - evTop + m; bp.blocks.push(b); });
          break;
        }
      }
      target = next; return next;
    });
    return ok ? { ok: true, page: target } : { ok: false, reason: 'askNext' };
  }
  // mode === 'auto': try fitting directly on existing next page
  let target = null;
  const ok = commitMulti(C, 'toNextPage', () => {
    const next = s.pages[idx + 1];
    s.ensurePage(next);
    const bs = page.blocks.filter((b) => ids.includes(b.id)).sort((a, b) => a.y - b.y || a.x - b.x);
    detach(page, bs);
    if (!tryPlaceNext(next, bs, page)) return false;
    target = next; return next;
  });
  return ok ? { ok: true, page: target } : { ok: false, reason: 'askNext' };
}

export function moveToAdjacent(C, page, ids, dir) {
  const res = movePageAdjacent(C, page, ids, dir, 'auto');
  return res.ok ? res.page : null;
}
