// Mıknatıs across pages: after something on a page got smaller or was deleted,
// rows from the top of the next page that now fit move up to the end of this
// page (same gap as the page's own rows), then the next page closes its gap and
// pulls from the page after it, and so on. Runs inside one history entry.
import * as ops from '../model/blockOps.js';
import { detach, newBlankPage } from './pageOps.js';

const flow = (page) => (page.blocks || []).filter((b) => !b.free && !ops.isPinned(page, b));

// the lowest point the page's own content originally reached (never grow past it)
function limitOf(page) {
  const init = page.initial && page.initial.blocks ? page.initial.blocks : [];
  const bots = init.filter((b) => !b.free && !ops.isPinned(page, b)).map((b) => ops.blockRect(b)).map((r) => r.y + r.h);
  const pins = (page.blocks || []).filter((b) => !b.free && ops.isPinned(page, b)).map(ops.blockRect).filter((r) => r.y > page.h * 0.6).map((r) => r.y - 4);
  let lim = bots.length ? Math.max(...bots) + 1 : page.h - 40;
  if (pins.length) lim = Math.min(lim, ...pins);
  return Math.min(lim, page.h - 12);
}
// usual vertical gap between rows on this page
function gapOf(page) {
  const rs = flow(page).map(ops.blockRect).sort((a, b) => a.y - b.y);
  const gs = [];
  for (let i = 1; i < rs.length; i++) { const g = rs[i].y - Math.max(...rs.slice(0, i).map((r) => r.y + r.h)); if (g > 0.5 && g < 60) gs.push(g); }
  if (!gs.length) return 10;
  gs.sort((a, b) => a - b);
  return Math.max(3, Math.min(30, gs[gs.length >> 1]));
}
// the highest point the page's own content originally started at
function topOf(page) {
  const init = page.initial && page.initial.blocks ? page.initial.blocks : [];
  const tops = init.filter((b) => !b.free && !ops.isPinned(page, b)).map((b) => ops.blockRect(b).y);
  return tops.length ? Math.min(...tops) : 36;
}
// the top row of a page: the first block plus everything overlapping its height
function topRow(page) {
  const fs = flow(page).map((b) => [b, ops.blockRect(b)]).sort((a, c) => a[1].y - c[1].y);
  if (!fs.length) return null;
  let y0 = fs[0][1].y, y1 = fs[0][1].y + fs[0][1].h;
  const row = [fs[0]];
  for (const it of fs.slice(1)) { if (it[1].y < y1 - 1) { row.push(it); y1 = Math.max(y1, it[1].y + it[1].h); } }
  return { blocks: row.map((x) => x[0]), y0, y1 };
}

function pullUpPair(s, pg, nx, onTouch) {
  onTouch(pg); onTouch(nx); s.ensurePage(pg); s.ensurePage(nx);
  if (pg.w !== nx.w) return false;
  const lim = limitOf(pg), gap = gapOf(pg), nxTop0 = topOf(nx);
  let moved = false;
  for (let guard = 0; guard < 60; guard++) {
    const row = topRow(nx);
    if (!row) break;
    const extraTop = Math.max(0, row.y0 - nxTop0);
    const own = flow(pg).map(ops.blockRect);
    const bottom = own.length ? Math.max(...own.map((r) => r.y + r.h)) : 36;
    const y = bottom + (own.length ? gap : 0) + (extraTop > 30 ? extraTop : 0);
    const dy = y - row.y0;
    if (y + (row.y1 - row.y0) > lim) break;
    // must not land on anything already on this page
    const ids = new Set(row.blocks.map((b) => b.id));
    if (row.blocks.some((b) => ops.collides(pg, b, { x: b.x, y: b.y + dy, s: b.s }, ids))) break;
    detach(nx, row.blocks);
    row.blocks.forEach((b) => { b.y += dy; pg.blocks.push(b); });
    // the next page closes the hole at its top (its own gaps stay the same)
    ops.closeGap(nx, { x: 0, y: row.y0, w: nx.w, h: row.y1 - row.y0 }, Infinity, row.y0);
    moved = true;
  }
  return moved;
}

export function cascadeUp(s, startPage, onTouch = () => {}) {
  let i = s.pages.indexOf(startPage);
  let movedAny = false;
  for (; i >= 0 && i < s.pages.length - 1; i++) {
    if (!pullUpPair(s, s.pages[i], s.pages[i + 1], onTouch)) break;
    movedAny = true;
  }
  return movedAny;
}

export function cascadeUpAll(s, onTouch = () => {}) {
  let movedAny = false;
  for (let i = 0; i < s.pages.length - 1; i++) {
    if (pullUpPair(s, s.pages[i], s.pages[i + 1], onTouch)) movedAny = true;
  }
  return movedAny;
}

export function cascadeDown(s, startPage, onTouch = () => {}) {
  let i = s.pages.indexOf(startPage);
  let movedAny = false;
  for (; i >= 0 && i < s.pages.length; i++) {
    const pg = s.pages[i];
    onTouch(pg); s.ensurePage(pg);
    const lim = limitOf(pg);
    const over = flow(pg).filter((b) => { const r = ops.blockRect(b); return r.y + r.h > lim + 0.5; })
      .sort((a, b) => ops.blockRect(a).y - ops.blockRect(b).y);
    if (!over.length) break;
    let nx = s.pages[i + 1];
    if (!nx || nx.w !== pg.w) {
      nx = newBlankPage(s, pg);
      s.pages.splice(i + 1, 0, nx);
    }
    onTouch(nx); s.ensurePage(nx);
    const topO = Math.min(...over.map((b) => ops.blockRect(b).y));
    const botO = Math.max(...over.map((b) => { const r = ops.blockRect(b); return r.y + r.h; }));
    const gap = gapOf(nx);
    const mTop = 36;
    const needShift = (botO - topO) + gap;
    const nxFlow = flow(nx);
    if (nxFlow.length) {
      const nxTop = Math.min(...nxFlow.map((b) => ops.blockRect(b).y));
      const d = Math.max(0, mTop + needShift - nxTop);
      if (d > 0.5) nxFlow.forEach((b) => { b.y += d; });
    }
    detach(pg, over).forEach((b) => { b.y = b.y - topO + mTop; nx.blocks.push(b); });
    movedAny = true;
  }
  return movedAny;
}
