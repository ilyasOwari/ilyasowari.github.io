// Clamped move / resize planning. A plan is computed on every pointer move
// (live preview) and the very same plan is committed on release, so what the
// user sees while dragging is exactly what is kept. Blocks never overlap and
// never leave the page; when the requested position/size is impossible the
// plan holds the closest achievable one instead of refusing.
import { blockRect, collides, findBlock, isPinned, closeGap } from './blockOps.js';

const freeAt = (page, bs, set, dx, dy) => bs.every((b) => !collides(page, b, { x: b.x + dx, y: b.y + dy, s: b.s }, set));

// ---------- move ----------
export function planMove(page, ids, dx, dy) {
  const set = new Set(ids);
  const bs = page.blocks.filter((b) => set.has(b.id));
  if (!bs.length) return null;
  const ok = (x, y) => freeAt(page, bs, set, x, y);
  const rs = bs.map(blockRect);
  const minX = -Math.min(...rs.map((r) => r.x)), maxX = page.w - Math.max(...rs.map((r) => r.x + r.w));
  const minY = -Math.min(...rs.map((r) => r.y)), maxY = page.h - Math.max(...rs.map((r) => r.y + r.h));
  const tx = Math.max(minX, Math.min(maxX, dx)), ty = Math.max(minY, Math.min(maxY, dy));
  const done = (x, y) => ({ dx: x, dy: y, clamped: Math.hypot(x - dx, y - dy) > 0.5 });
  if (ok(tx, ty)) return done(tx, ty);
  const cands = [];
  // 1. walk along the drag path up to the first obstacle
  const dist = Math.hypot(tx, ty), n = Math.max(2, Math.ceil(dist / 2));
  let last = [0, 0];
  for (let i = 1; i <= n; i++) { const x = (tx * i) / n, y = (ty * i) / n; if (!ok(x, y)) break; last = [x, y]; }
  cands.push(last);
  // 2. from there, slide along each axis towards the target
  const slide = ([x, y], axis) => {
    let lo = 0, hi = 1;
    const at = (m) => (axis === 'x' ? [x + (tx - x) * m, y] : [x, y + (ty - y) * m]);
    if (ok(...at(1))) return at(1);
    for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (ok(...at(m))) lo = m; else hi = m; }
    return at(lo);
  };
  const sx = slide(last, 'x'), sy = slide(last, 'y');
  cands.push(sx, sy, slide(sx, 'y'), slide(sy, 'x'));
  // 3. nearest free spot around the target (rings; expand further when starting overlapped)
  const maxR = ok(0, 0) ? 96 : Math.ceil(Math.max(page.w, page.h));
  for (let r = 3; r <= maxR; r += r <= 96 ? 3 : 6) {
    let best = null;
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const x = Math.max(minX, Math.min(maxX, tx + Math.cos(a) * r)), y = Math.max(minY, Math.min(maxY, ty + Math.sin(a) * r));
      if (ok(x, y)) { const d = Math.hypot(x - tx, y - ty); if (!best || d < best.d) best = { x, y, d }; }
    }
    if (best) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (ok(best.x + (tx - best.x) * m, best.y + (ty - best.y) * m)) lo = m; else hi = m; }
      cands.push([best.x + (tx - best.x) * lo, best.y + (ty - best.y) * lo]);
      break;
    }
  }
  let bestC = cands[0], bd = Infinity;
  for (const c of cands) { const d = Math.hypot(c[0] - tx, c[1] - ty); if (d < bd - 1e-6) { bd = d; bestC = c; } }
  return done(bestC[0], bestC[1]);
}
export function applyMovePlan(page, ids, plan) {
  if (!plan || Math.hypot(plan.dx, plan.dy) < 0.5) return false;
  const set = new Set(ids);
  page.blocks.filter((b) => set.has(b.id)).forEach((b) => { b.x += plan.dx; b.y += plan.dy; });
  if (plan.shifts && plan.shifts.size) {
    for (const b of page.blocks) {
      const sy = plan.shifts.get(b.id);
      if (sy) b.y += sy;
    }
  }
  return plan.clamped ? 'clamped' : true;
}

export function planMagnetMove(page, ids, dx, dy, { lockPage = false } = {}) {
  const set = new Set(ids);
  const bs = page.blocks.filter((b) => set.has(b.id));
  if (!bs.length) return null;
  if (dy <= 0.5) {
    const base = planMove(page, ids, dx, dy);
    if (!base) return null;
    const shifts = new Map();
    if (base.dy < -0.5) {
      const mvOldBot = Math.max(...bs.map((b) => blockRect(b).y + blockRect(b).h));
      const followers = page.blocks.filter((b) => !set.has(b.id) && !b.free && !isPinned(page, b) && blockRect(b).y >= mvOldBot - 1);
      if (followers.length) {
        const fSet = new Set(followers.map((b) => b.id));
        const ign = new Set([...set, ...fSet]);
        const mvAfter = bs.map((b) => ({ ...b, x: b.x + base.dx, y: b.y + base.dy }));
        const maxUp = -base.dy;
        const okUp = (s) => followers.every((b) => {
          const nb = { x: b.x, y: b.y - s, s: b.s };
          if (collides(page, b, nb, ign)) return false;
          const rb = blockRect({ ...b, ...nb });
          return mvAfter.every((m) => {
            const rm = blockRect(m);
            return rb.x + rb.w <= rm.x + 0.5 || rm.x + rm.w <= rb.x + 0.5 || rb.y + rb.h <= rm.y + 0.5 || rm.y + rm.h <= rb.y + 0.5;
          });
        });
        let shift = maxUp;
        if (!okUp(shift)) {
          let lo = 0, hi = shift;
          for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (okUp(m)) lo = m; else hi = m; }
          shift = lo;
        }
        if (shift > 0.5) for (const b of followers) shifts.set(b.id, -shift);
      }
    }
    return { ...base, shifts };
  }

  // Downward move (dy > 0.5): allow free side-by-side placement next to narrower
  // blocks when the target lane is clear; otherwise push below rows downward
  const rs = bs.map(blockRect);
  const minX = -Math.min(...rs.map((r) => r.x)), maxX = page.w - Math.max(...rs.map((r) => r.x + r.w));
  const minY = -Math.min(...rs.map((r) => r.y)), maxY = page.h - Math.max(...rs.map((r) => r.y + r.h));
  const tx = Math.max(minX, Math.min(maxX, dx)), ty = Math.max(minY, Math.min(maxY, dy));
  const mvOldBot = Math.max(...rs.map((r) => r.y + r.h));
  const below = page.blocks.filter((b) => !set.has(b.id) && !b.free && !isPinned(page, b) && blockRect(b).y >= mvOldBot - 2);
  if (freeAt(page, bs, set, tx, ty)) {
    const mvX0 = Math.min(...rs.map((r) => r.x)) + tx, mvX1 = Math.max(...rs.map((r) => r.x + r.w)) + tx;
    const mvY1 = Math.max(...rs.map((r) => r.y + r.h)) + ty;
    const hitsHorizontal = below.some((b) => {
      const r = blockRect(b);
      return r.x < mvX1 + 2 && r.x + r.w > mvX0 - 2 && r.y < mvY1 + 2;
    });
    if (!hitsHorizontal) return { dx: tx, dy: ty, clamped: Math.hypot(tx - dx, ty - dy) > 0.5, shifts: new Map() };
  }
  const hPlan = Math.abs(dx) > 0.5 ? planMove(page, ids, dx, 0) : { dx: 0, dy: 0 };
  const actualDx = hPlan ? hPlan.dx : 0;
  const pins = page.blocks.filter((b) => !set.has(b.id) && !b.free && isPinned(page, b))
    .map(blockRect).filter((r) => r.y > mvOldBot - 1).map((r) => r.y - 4);
  const bottomLimit = Math.min(page.h - 12, ...(pins.length ? pins : [page.h - 12]));
  const sorted = below.map((b) => ({ b, r: blockRect(b) })).sort((a, c) => a.r.y - c.r.y);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && it.r.y < last.y1 - 1) {
      last.items.push(it);
      last.y1 = Math.max(last.y1, it.r.y + it.r.h);
    } else {
      rows.push({ items: [it], y0: it.r.y, y1: it.r.y + it.r.h });
    }
  }
  const shifts = new Map();
  let actualDy = dy;
  if (!rows.length) {
    const maxDown = Math.max(0, bottomLimit - mvOldBot);
    actualDy = Math.min(dy, maxDown);
  } else {
    const gaps = [rows[0].y0 - mvOldBot];
    for (let i = 1; i < rows.length; i++) gaps.push(rows[i].y0 - rows[i - 1].y1);
    const freeBot = Math.max(0, bottomLimit - rows[rows.length - 1].y1);
    // If there is a manual gap (> 30pt) directly below the dragged block, let it
    // approach the next row down to 12pt before pushing lower rows downward.
    const slack0 = gaps[0] > 30 ? Math.max(0, gaps[0] - 12) : 0;
    if (lockPage) {
      actualDy = Math.min(dy, Math.max(0, bottomLimit - mvOldBot));
      const push = Math.max(0, actualDy - slack0);
      if (push > 0.5) {
        for (const row of rows) for (const it of row.items) shifts.set(it.b.id, push);
      }
    } else {
      const totalGaps = gaps.reduce((s, g) => s + Math.max(0, g), 0);
      actualDy = Math.min(dy, freeBot + totalGaps);
      const push = Math.max(0, actualDy - slack0);
      if (push > 0.5) {
        const g0 = slack0 > 0 ? Math.min(gaps[0], 12) : gaps[0];
        const remGaps = gaps.slice(1).reduce((s, g) => s + Math.max(0, g), 0) + Math.max(0, g0);
        const compress = Math.max(0, push - freeBot);
        const alpha = remGaps > 0 ? (remGaps - compress) / remGaps : 1;
        let curBot = mvOldBot + actualDy;
        for (let i = 0; i < rows.length; i++) {
          const gi = i === 0 ? g0 : gaps[i];
          const g = gi > 0 ? gi * alpha : gi;
          const newY0 = curBot + g;
          const dRow = newY0 - rows[i].y0;
          if (Math.abs(dRow) > 0.5) for (const it of rows[i].items) shifts.set(it.b.id, dRow);
          curBot = newY0 + (rows[i].y1 - rows[i].y0);
        }
      }
    }
  }
  return { dx: actualDx, dy: actualDy, clamped: Math.hypot(actualDx - dx, actualDy - dy) > 0.5, shifts };
}

// ---------- resize ----------
// k: requested factor relative to the current size, hd: handle (n, se, w...).
export function planResize(page, id, k, hd) {
  const b = findBlock(page, id);
  if (!b) return null;
  const s0 = b.s || 1, R = blockRect(b);
  const bottom0 = R.y + R.h;
  const geom = (f) => {
    const w = R.w * f, h = R.h * f;
    let x = hd.includes('w') ? R.x + R.w - w : R.x;
    if (!hd.includes('w') && !hd.includes('e')) x = Math.max(0, Math.min(x, page.w - w)); // pure n / s: stay on the page
    const y = hd.includes('n') ? R.y + R.h - h : R.y;
    return { x, y, w, h };
  };
  // A: grow in place without touching anything else
  const okA = (f) => { const g = geom(f); return !collides(page, b, { x: g.x, y: g.y, s: s0 * f }); };
  // B: grow and push the blocks below down (only if the page has room)
  // (first only ordinary blocks; if that is not enough, the footer too)
  const allBelow = page.blocks.filter((o) => o.id !== b.id && !o.free && blockRect(o).y >= bottom0 - 1);
  const pushFor = (g) => Math.max(0, g.y + g.h - bottom0);
  let below = [];
  const okB = (f) => {
    const g = geom(f);
    const push = pushFor(g);
    const save = below.map((o) => o.y), sb = [b.x, b.y, b.s];
    below.forEach((o) => { o.y += push; });
    b.x = g.x; b.y = g.y; b.s = s0 * f;
    let good = !collides(page, b, b);
    if (good) good = below.every((o) => !collides(page, o, o));
    below.forEach((o, i) => { o.y = save[i]; });
    [b.x, b.y, b.s] = sb;
    return good;
  };
  const maxF = (ok, target) => {
    if (ok(target)) return target;
    let lo = 1, hi = target;
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
    return lo;
  };
  const target = Math.max(0.15 / s0, Math.min(k, 6));
  let f, push = 0, mode = 'A';
  if (target <= 1) f = okA(target) ? target : 1;
  else {
    f = maxF(okA, target);
    for (const set of [allBelow.filter((o) => !isPinned(page, o)), allBelow]) {
      if (f >= target - 1e-4 || !set.length) continue;
      below = set;
      const fb = maxF(okB, target);
      if (fb > f + 0.004) { f = fb; mode = set; push = pushFor(geom(fb)); }
    }
  }
  const g = geom(f);
  return {
    id, f, s: s0 * f, x: g.x, y: g.y, w: g.w, h: g.h, push, pushIds: mode === 'A' ? [] : mode.map((o) => o.id),
    clamped: Math.abs(f - target) > 1e-3, unchanged: Math.abs(f - 1) < 0.003,
  };
}
export function applyResizePlan(page, plan, magnet = false) {
  if (!plan || plan.unchanged) return false;
  const b = findBlock(page, plan.id);
  if (!b) return false;
  const old = blockRect(b);
  const set = new Set(plan.pushIds);
  page.blocks.forEach((o) => { if (set.has(o.id)) o.y += plan.push; });
  b.s = plan.s; b.x = plan.x; b.y = plan.y;
  // smaller now: with the magnet on, what is below moves up into the freed room
  if (magnet && plan.f < 1 && !b.free) { const nr = blockRect(b); closeGap(page, { x: old.x, y: old.y, w: old.w, h: old.h }, old.y + old.h - (nr.y + nr.h), nr.y + nr.h); }
  return plan.push > 0.01 ? 'pushed' : plan.clamped ? 'clamped' : true;
}

// live Mıknatıs preview while a corner is dragged: how far each other block moves (y)
export function previewResize(page, plan, magnet) {
  const out = new Map();
  if (!plan || !magnet || !(plan.f < 1) || plan.unchanged) return out;
  const clone = { ...page, blocks: page.blocks.map((b) => ({ ...b })) };
  applyResizePlan(clone, plan, true);
  clone.blocks.forEach((c, i) => { const o = page.blocks[i]; if (c.id !== plan.id && Math.abs(c.y - o.y) > 0.01) out.set(c.id, c.y - o.y); });
  return out;
}
