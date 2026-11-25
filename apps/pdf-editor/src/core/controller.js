// All model mutations go through here: per-page history entries + events.
import { snapshotPage, restorePage } from './history.js';
import * as ops from '../model/blockOps.js';
import * as area from '../model/areaOps.js';
import { planMove, applyMovePlan, planMagnetMove, planResize, applyResizePlan } from '../model/clamp.js';
import { openBlockText, applyBlockText } from './textEdits.js';
import { restoreAll, snapshotLazy, snapshotLike, sameSnap, emitSnap, insertNear, movePageAdjacent, commitMulti, detach } from './pageOps.js';
import { cascadeUp, cascadeDown } from './magnetFlow.js';
import { cropBlock } from '../model/cropOps.js';
import { dehydrateBlocks } from './imageStore.js';
import { makeFree, unfree } from './freeOps.js';

function dodgeFreeBadges(page, movedIds) {
  if (!page || !page.blocks) return;
  const fixed = page.blocks.filter((o) => !o.free).map((o) => ({ b: o, r: ops.blockRect(o) }));
  const over = (x, y, w, h, r) => Math.min(x + w, r.x + r.w) - Math.max(x, r.x) > 1 && Math.min(y + h, r.y + r.h) - Math.max(y, r.y) > 1;
  const anyHit = (x, y, w, h) => fixed.some(({ r }) => over(x, y, w, h, r));
  for (const b of page.blocks) {
    if (!b.free || b.behind || !b.autoFloat || !b.home || b.home.pageId !== page.id) continue;
    if (movedIds && movedIds.has(b.id)) { b.home = { pageId: page.id, x: b.x, y: b.y, s: b.s || 1 }; continue; }
    const br = ops.blockRect(b), bw = br.w, bh = br.h;
    const hx = b.home.x, hy = b.home.y;
    if (!anyHit(hx, hy, bw, bh)) { b.x = hx; b.y = hy; continue; }
    const hits = fixed.filter(({ r }) => over(hx, hy, bw, bh, r)).map(({ r }) => r);
    const ux0 = Math.min(...hits.map((r) => r.x)), uy0 = Math.min(...hits.map((r) => r.y));
    const ux1 = Math.max(...hits.map((r) => r.x + r.w)), uy1 = Math.max(...hits.map((r) => r.y + r.h));
    const isBot = hy > page.h * 0.5, isRight = hx + bw / 2 >= page.w * 0.5;
    const cxOut = isRight ? Math.min(page.w - bw - 10, Math.max(hx, ux1 + 6)) : Math.max(10, Math.min(hx, ux0 - bw - 6));
    const cyOut = isBot ? Math.min(page.h - bh - 8, Math.max(hy, uy1 + 4)) : Math.max(8, Math.min(hy, uy0 - bh - 4));
    const cands = [
      [cxOut, cyOut],
      [isRight ? page.w - bw - 10 : 10, cyOut],
      [cxOut, hy],
      [hx, cyOut],
      [isRight ? Math.max(10, ux0 - bw - 6) : Math.min(page.w - bw - 10, ux1 + 6), cyOut],
    ];
    let best = null;
    for (const [cx, cy] of cands) {
      if (cx < 8 || cx + bw > page.w - 8 || cy < 6 || cy + bh > page.h - 6) continue;
      if (!anyHit(cx, cy, bw, bh)) { best = [cx, cy]; break; }
    }
    if (!best) best = [Math.max(8, Math.min(page.w - bw - 8, cxOut)), Math.max(6, Math.min(page.h - bh - 6, cyOut))];
    b.x = best[0]; b.y = best[1];
  }
}

export class Controller {
  constructor(session, bus) { this.s = session; this.bus = bus; }

  commit(page, label, fn) {
    this.s.ensurePage(page);
    const before = snapshotPage(page);
    let r;
    try { r = fn(page); } catch (e) { restorePage(page, before); throw e; }
    if (r === false || r === null) { restorePage(page, before); return r; }
    dodgeFreeBadges(page, label === 'move' ? this.s.selection?.ids : null);
    dehydrateBlocks(page.blocks); // pictures live in the image store, the model keeps ids
    const after = snapshotPage(page);
    if (JSON.stringify(before) === JSON.stringify(after)) return r;
    this.s.history.push({ type: 'page', pageId: page.id, before, after, label });
    this.changed(page);
    return r;
  }
  changed(page) {
    page.version = (page.version || 0) + 1;
    this.s.dirty = true;
    this.bus.emit('page:changed', page);
    this.bus.emit('history');
  }
  undo() { const e = this.s.history.undo(); if (e) this.apply(e, 'before'); return !!e; }
  redo() { const e = this.s.history.redo(); if (e) this.apply(e, 'after'); return !!e; }
  apply(e, which) {
    if (e.type === 'multi') {
      restoreAll(this.s, e[which]);
      this.s.selection = { pageId: null, ids: new Set() };
      this.s.dirty = true;
      emitSnap(this, e[which]);
      this.bus.emit('selection');
      this.bus.emit('history');
      return;
    }
    if (e.type === 'pages') {
      this.s.pages = e[which].slice();
      this.s.dirty = true;
      this.bus.emit('pages:changed');
      this.bus.emit('history');
      return;
    }
    const page = this.s.pageById(e.pageId);
    if (!page) return;
    restorePage(page, e[which]);
    this.s.selection = { pageId: page.id, ids: new Set() };
    this.s.dirty = true;
    this.bus.emit('page:changed', page);
    this.bus.emit('selection');
    this.bus.emit('history');
    this.bus.emit('reveal', page);
  }

  // ---- block operations (return truthy on success) ----
  move(page, ids, dx, dy, plan = null) {
    const mag = this.s.magnet !== false;
    const set = new Set(ids);
    const mv = (page.blocks || []).filter((b) => set.has(b.id));
    if (!mag || !mv.length || mv.some((b) => b.free)) {
      return this.commit(page, 'move', (p) => applyMovePlan(p, ids, plan || planMove(p, ids, dx, dy)));
    }
    return this.flowCommit(page, 'move', (p, touch) => {
      const pPlan = plan || planMagnetMove(p, ids, dx, dy, { lockPage: !!this.s.lockPage });
      const r = applyMovePlan(p, ids, pPlan);
      if (!r) return false;
      if (this.s.lockPage && pPlan.dy > 0.5) {
        cascadeDown(this.s, p, touch);
      }
      return r;
    });
  }
  moveAcrossPages(fromPage, toPage, ids, deltaX, deltaY) {
    if (!fromPage || !toPage || fromPage === toPage || !ids.length) return false;
    const set = new Set(ids);
    const mag = this.s.magnet !== false;
    return commitMulti(this, 'move', () => {
      this.s.ensurePage(fromPage); this.s.ensurePage(toPage);
      const bs = fromPage.blocks.filter((b) => set.has(b.id));
      if (!bs.length) return false;
      const oldRects = bs.map(ops.blockRect);
      const cand = bs.map((b) => {
        const r = ops.blockRect(b);
        return { b, x: Math.max(4, Math.min(toPage.w - r.w - 4, b.x + deltaX)), y: Math.max(4, Math.min(toPage.h - r.h - 4, b.y + deltaY)) };
      });
      const fitsAt = (dx, dy) => cand.every(({ b, x, y }) => !ops.collides(toPage, b, { x: x + dx, y: y + dy, s: b.s }, set));
      let adjX = 0, adjY = 0;
      if (!fitsAt(0, 0)) {
        // search nearby free spot on target page without overlapping
        let found = null;
        for (let r = 4; r <= 120 && !found; r += 4) {
          for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2;
            const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
            if (fitsAt(ox, oy)) { found = [ox, oy]; break; }
          }
        }
        if (!found) return false;
        adjX = found[0]; adjY = found[1];
      }
      detach(fromPage, bs);
      cand.forEach(({ b, x, y }) => { b.x = x + adjX; b.y = y + adjY; toPage.blocks.push(b); });
      if (mag) {
        for (const or of oldRects) { ops.compactBand(fromPage, or); ops.closeGap(fromPage, or, Infinity, or.y); }
        if (this.s.lockPage) cascadeUp(this.s, fromPage);
      }
      return true;
    });
  }
  nudge(page, ids, dx, dy) { return this.commit(page, 'move', (p) => !!ops.moveClamped(p, ids, dx, dy)); }
  resize(page, plan) {
    const mag = this.s.magnet !== false;
    const fn = (p) => applyResizePlan(p, plan, mag);
    return mag && plan && plan.f < 1 ? this.flowCommit(page, 'resize', fn) : this.commit(page, 'resize', fn);
  }
  remove(page, ids) {
    const mag = this.s.magnet !== false;
    const fn = (p) => ops.deleteBlocks(p, ids, { compact: mag });
    return mag ? this.flowCommit(page, 'delete', fn) : this.commit(page, 'delete', fn);
  }
  // a change with the magnet on: the page change, then rows from the following
  // pages flow up into the freed room; all of it is ONE undo step
  // a change with the magnet on: the page change, then (with "Sayfalar arası
  // geçiş") rows flow between pages. Every page it touches, and pages it adds,
  // go into ONE undo step; nothing is recorded when nothing changed.
  flowCommit(page, label, fn, opts = {}) {
    const s = this.s;
    const before = snapshotLazy(s, [page]);
    s.ensurePage(page);
    let r;
    try {
      r = fn(page, before.touch);
      if (r !== false && r !== null) {
        dodgeFreeBadges(page, label === 'move' ? s.selection?.ids : null);
        const allowCascade = opts.cascade ? !!opts.cascade() : true;
        if (s.lockPage && allowCascade) {
          try { cascadeUp(s, page, before.touch); } catch (e) { console.error(e); }
        }
      }
    } catch (e) { restoreAll(s, before); emitSnap(this, before); throw e; }
    if (r === false || r === null) {
      const orderChanged = s.pages.length !== before.order.length || s.pages.some((p, i) => p !== before.order[i]);
      restoreAll(s, before);
      if (orderChanged) emitSnap(this, before);
      return r;
    }
    for (const id of before.states.keys()) { const p = s.pageById(id); if (p) dehydrateBlocks(p.blocks); }
    const after = snapshotLike(s, before);
    if (sameSnap(s, before, after)) return r;
    const orderChanged = after.order.length !== before.order.length || after.order.some((p, i) => p !== before.order[i]);
    delete before.touch;
    s.history.push({ type: 'multi', before, after, label });
    s.dirty = true;
    for (const id of after.states.keys()) { const p = s.pageById(id); if (p) p.version = (p.version || 0) + 1; }
    emitSnap(this, after, orderChanged);
    this.bus.emit('history');
    return r;
  }
  swap(page, id, dir) {
    let res;
    this.commit(page, 'swap', (p) => { res = ops.swapDirection(p, id, dir); return res === 'swapped' || res === 'nudged'; });
    return res;
  }
  merge(page, ids) { return this.commit(page, 'merge', (p) => ops.mergeBlocks(p, ids)); }
  ungroup(page, id) { return this.commit(page, 'ungroup', (p) => ops.ungroupBlock(p, id)); }
  setBg(page, ids, mode) { return this.commit(page, 'bg', (p) => { ops.setBackground(p, ids, mode); return true; }); }
  setWhiteBg(page, on) { return this.commit(page, 'whitebg', (p) => { p.whiteBg = !!on; return true; }); }
  split(page, rect) {
    let res;
    this.commit(page, 'split', (p) => { res = area.splitArea(p, rect, this.s); return res.ok; });
    return res;
  }
  erase(page, rect) { return this.commit(page, 'erase', (p) => area.eraseArea(p, rect, 'natural', null, this.s)); }
  cover(page, rect, fill) { return this.commit(page, 'cover', (p) => area.coverArea(p, rect, fill, this.s)); }
  crop(page, id, rect) { return this.commit(page, 'crop', (p) => cropBlock(p, id, rect, this.s)); }
  makeFree(page, id, pt) { let out = null; this.commit(page, 'free', (p) => { out = makeFree(this.s, p, id, pt); return !!out; }); return out; }
  unfree(page, id) { return this.commit(page, 'unfree', (p) => unfree(p, id)); }
  moveAdjacent(page, ids, dir, mode = 'auto') { return movePageAdjacent(this, page, ids, dir, mode); }
  resetPage(page) {
    if (!page.initial) return false;
    return this.commit(page, 'reset', (p) => { restorePage(p, p.initial); return true; });
  }
  moveToNextPage(page, ids, mode = 'auto') { return movePageAdjacent(this, page, ids, 1, mode); }
  insertNear(page, block, pref, exact) { return insertNear(this, page, block, pref, exact); }
  insertBlock(page, block) {
    return this.commit(page, 'insert', (p) => {
      const spot = findFreeSpot(p, block);
      if (!spot) return false;
      block.x = spot.x; block.y = spot.y;
      p.blocks.push(block);
      return block.id;
    });
  }
  addBlankPage(afterId) {
    const before = this.s.pages.slice();
    const ref = this.s.pageById(afterId) || this.s.pages[this.s.pages.length - 1];
    const pg = { id: ops.newId('pg'), srcIndex: null, w: ref.w, h: ref.h, blocks: [], deleted: [], erase: [], whiteBg: false, version: 0 };
    pg.initial = snapshotPage(pg);
    const i = this.s.pages.indexOf(ref);
    this.s.pages.splice(i + 1, 0, pg);
    this.s.history.push({ type: 'pages', before, after: this.s.pages.slice() });
    this.s.dirty = true;
    this.bus.emit('pages:changed');
    this.bus.emit('history');
    return pg;
  }
  deletePage(id) {
    if (this.s.pages.length <= 1) return false;
    const before = this.s.pages.slice();
    this.s.pages = this.s.pages.filter((p) => p.id !== id);
    this.s.history.push({ type: 'pages', before, after: this.s.pages.slice() });
    this.s.dirty = true;
    this.bus.emit('pages:changed');
    this.bus.emit('history');
    return true;
  }
  deletePages(ids) {
    const set = new Set(ids || []);
    if (!set.size) return false;
    const after = this.s.pages.filter((p) => !set.has(p.id));
    if (after.length < 1 || after.length === this.s.pages.length) return false;
    const before = this.s.pages.slice();
    this.s.pages = after;
    this.s.history.push({ type: 'pages', before, after: this.s.pages.slice() });
    this.s.dirty = true;
    this.bus.emit('pages:changed');
    this.bus.emit('history');
    return true;
  }
  reorderPages(orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.length !== this.s.pages.length) return false;
    const byId = new Map(this.s.pages.map((p) => [p.id, p]));
    const after = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    if (after.length !== this.s.pages.length) return false;
    if (after.every((p, i) => p === this.s.pages[i])) return false;
    const before = this.s.pages.slice();
    this.s.pages = after;
    this.s.history.push({ type: 'pages', before, after: this.s.pages.slice() });
    this.s.dirty = true;
    this.bus.emit('pages:changed');
    this.bus.emit('history');
    return true;
  }
  insertPagesAfter(afterId, newPages) {
    if (!Array.isArray(newPages) || !newPages.length) return false;
    const before = this.s.pages.slice();
    const ref = this.s.pageById(afterId) || this.s.pages[this.s.pages.length - 1];
    const i = ref ? this.s.pages.indexOf(ref) : this.s.pages.length - 1;
    this.s.pages.splice(i + 1, 0, ...newPages);
    this.s.history.push({ type: 'pages', before, after: this.s.pages.slice() });
    this.s.dirty = true;
    this.bus.emit('pages:changed');
    this.bus.emit('history');
    return newPages;
  }

  // ---- text editing (all text groups of a block in one go) ----
  openText(page, blockId) { this.s.ensurePage(page); return openBlockText(this.s, page, blockId); }
  applyText(ctx, results) { return applyBlockText(this, ctx, results); }
}

// first free position for a new block: top-down scan with 6pt steps
export function findFreeSpot(page, block, prefer) {
  const w = block.bw * (block.s || 1), h = block.bh * (block.s || 1);
  const tryAt = (x, y) => !ops.collides(page, block, { x, y, s: block.s || 1 });
  if (prefer && tryAt(prefer.x, prefer.y)) return prefer;
  const m = Math.min(36, page.w * 0.06);
  for (let y = m; y + h <= page.h - m / 2; y += 6) {
    for (let x = m; x + w <= page.w - m / 2; x += 6) if (tryAt(x, y)) return { x, y };
  }
  return null;
}

