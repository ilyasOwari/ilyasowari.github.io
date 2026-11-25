import { blockRect, partRect, recalcBlock, isPinned, deleteBlocks } from './blockOps.js';
import { isForeign, srcIndexOf } from './blockState.js';

// Page numbering ("Sayfa numaralandırma"): a document setting, recomputed from
// the current page order, so adding / removing pages renumbers automatically.
// cfg = { on, pos: 'bc'|'bl'|'br'|'tc'|'tl'|'tr', start, skipFirst, size }
export const defaultPageNums = () => ({ on: false, pos: 'bc', start: 1, skipFirst: false, size: 11 });
export function pageNumberFor(session, index) {
  const c = session && session.pageNums;
  if (!c || !c.on) return null;
  if (c.skipFirst && index === 0) return null;
  return String((c.start ?? 1) + index - (c.skipFirst ? 1 : 0));
}
// where the number sits on a page (pt, UI coords: baseline point + alignment)
export function pageNumberSpot(cfg, page, textW) {
  const m = Math.max(18, page.h * 0.035);
  const top = cfg.pos[0] === 't';
  const y = top ? m + cfg.size : page.h - m;
  const a = cfg.pos[1];
  const x = a === 'l' ? page.w * 0.08 : a === 'r' ? page.w * 0.92 - textW : (page.w - textW) / 2;
  return { x, y };
}

const inRect = (r, x, y) => x >= r.x - 0.5 && x <= r.x + r.w + 0.5 && y >= r.y - 0.5 && y <= r.y + r.h + 0.5;
const inAny = (rs, x, y) => rs && rs.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

function partDigits(session, page, b, p) {
  if (p.obj === 'image' || p.kind === 'image' || p.kind === 'graphic' || p.kind === 'insimg') return null;
  if (p.edit && Array.isArray(p.edit.runs)) {
    return p.edit.runs.map((r) => r.text || '').join('').trim();
  }
  const si = srcIndexOf(page, b);
  if (si === null || si === undefined) return null;
  const an = session.analysis(si);
  const glyphs = (an && an.interp && an.interp.glyphs) || [];
  const rm = new Set(p.removedG || []);
  const kg = p.keepG && p.keepG.length ? new Set(p.keepG) : null;
  const gl = glyphs.filter((g) => !rm.has(g.idx) && !inAny(p.erase, g.ucx, g.ucy) && (kg ? kg.has(g.idx) : p.src && inRect(p.src, g.ucx, g.ucy)));
  if (!gl.length) return null;
  gl.sort((a, bb) => Math.round(a.ucy / 3) - Math.round(bb.ucy / 3) || a.ucx - bb.ucx);
  return gl.map((g) => g.uni || '').join('').trim();
}

export function autoFloatPageNumbers(session) {
  if (!session || !session.pages || session.pages.length < 2) return;
  const cands = [];
  session.pages.forEach((p, pi) => {
    if (p.srcIndex === null) return;
    const an = session.analyses.get(p.srcIndex);
    const blocks = p.blocks || (an && an.seg && an.seg.blocks);
    if (!blocks) return;
    const pw = p.w || (an && an.geo && an.geo.w) || 595;
    const ph = p.h || (an && an.geo && an.geo.h) || 842;
    for (const b of blocks) {
      if (isForeign(b)) continue;
      const r = { x: b.x, y: b.y, w: b.bw * (b.s || 1), h: b.bh * (b.s || 1) };
      if (r.w > pw * 0.42 || r.h > 34) continue;
      const inTop = r.y + r.h <= ph * 0.14;
      const inBot = r.y >= ph * 0.80;
      if (!inTop && !inBot) continue;
      const ls = ((an && an.seg && an.seg.textAtoms) || []).filter((l) => !l.decor && (l.b.x0 + l.b.x1) / 2 >= r.x - 2 && (l.b.x0 + l.b.x1) / 2 <= r.x + r.w + 2 && (l.b.y0 + l.b.y1) / 2 >= r.y - 2 && (l.b.y0 + l.b.y1) / 2 <= r.y + r.h + 2);
      if (!ls.length) continue;
      ls.sort((a, bb) => a.baseline - bb.baseline || a.b.x0 - bb.b.x0);
      const txt = ls.map((l) => (l.glyphs || []).map((g) => g.uni || '').join('')).join(' ').trim();
      const nums = [...txt.matchAll(/(\d{1,4})/g)].map((m) => parseInt(m[1], 10)).filter((v) => v >= 1);
      for (const val of new Set(nums)) {
        cands.push({ p, pi, b, r, val, offset: val - pi, zone: inTop ? 'top' : 'bot' });
      }
    }
  });
  const groups = new Map();
  for (const c of cands) {
    const key = `${c.zone}:${c.offset}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const arr of groups.values()) {
    const distinctPages = new Set(arr.map((x) => x.pi));
    if (distinctPages.size < 2) continue;
    for (const c of arr) {
      if (!c.p.blocks || c.b.free) continue;
      c.b.free = true;
      c.b.autoFloat = true;
      c.b.home = { pageId: c.p.id, x: c.b.x, y: c.b.y, s: c.b.s || 1 };
    }
  }
}

export function detectOldPageNumbers(session) {
  if (!session || !session.pages) return [];
  for (const p of session.pages) session.ensurePage(p);
  const cands = [];
  session.pages.forEach((p, pi) => {
    if (p.srcIndex === null || !p.blocks) return;
    const allParts = [];
    for (const b of p.blocks) {
      for (const pt of b.parts) allParts.push({ b, pt, r: partRect(b, pt) });
    }
    for (const b of p.blocks) {
      if (isForeign(b)) continue;
      const pinned = isPinned(p, b);
      for (const pt of b.parts) {
        const r = partRect(b, pt);
        if (r.w > Math.max(90, p.w * 0.22) || r.h > Math.max(42, p.h * 0.06)) continue;
        const midY = r.y + r.h / 2;
        const inTop = r.y + r.h <= p.h * 0.12 || (pinned && midY < p.h * 0.5);
        const inBot = r.y >= p.h * 0.88 || (pinned && midY >= p.h * 0.5);
        if (!inTop && !inBot) continue;
        const alone = !allParts.some(({ pt: op, r: oR }) => {
          if (op === pt) return false;
          const vOver = Math.min(oR.y + oR.h, r.y + r.h) - Math.max(oR.y, r.y);
          if (vOver <= -4) return false;
          const hGap = Math.max(oR.x - (r.x + r.w), r.x - (oR.x + oR.w));
          return hGap < 36;
        });
        if (!alone) continue;
        const txt = partDigits(session, p, b, pt);
        if (!txt || !/^\d{1,4}$/.test(txt)) continue;
        const val = parseInt(txt, 10);
        if (!(val >= 1)) continue;
        const zone = inTop ? 'top' : 'bot';
        const offset = val - pi;
        if (offset < 0) continue;
        cands.push({ pageId: p.id, blockId: b.id, partId: pt.id, pi, val, offset, zone });
      }
    }
  });
  const origCount = session.pages.filter((p) => p.srcIndex !== null).length;
  if (!origCount || !cands.length) return [];
  const groups = new Map();
  for (const c of cands) {
    const key = `${c.zone}:${c.offset}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const byPage = groups.get(key);
    if (!byPage.has(c.pi)) byPage.set(c.pi, c);
  }
  let best = [];
  for (const byPage of groups.values()) {
    const list = [...byPage.values()];
    if (list.length > best.length) best = list;
  }
  if (origCount >= 2) {
    if (best.length < 2 || best.length < Math.ceil(origCount * 0.5)) return [];
  } else {
    if (best.length !== 1 || best[0].val !== 1) return [];
  }
  return best.map(({ pageId, blockId, partId }) => ({ pageId, blockId, partId }));
}

export function removeOldPageNumbers(session, matches) {
  if (!session || !matches || !matches.length) return;
  const byPage = new Map();
  for (const m of matches) {
    if (!byPage.has(m.pageId)) byPage.set(m.pageId, []);
    byPage.get(m.pageId).push(m);
  }
  for (const [pageId, ms] of byPage) {
    const page = session.pages.find((p) => p.id === pageId);
    if (!page || !page.blocks) continue;
    const wholeIds = [];
    for (const m of ms) {
      const b = page.blocks.find((x) => x.id === m.blockId);
      if (!b) continue;
      if (b.parts.length <= 1) { wholeIds.push(b.id); continue; }
      const idx = b.parts.findIndex((p) => p.id === m.partId);
      if (idx < 0) continue;
      const [pt] = b.parts.splice(idx, 1);
      if (pt.src) page.deleted.push({ x: pt.src.x, y: pt.src.y, w: pt.src.w, h: pt.src.h });
      if (b.parts.length === 1 && b.parts[0].kind) b.kind = b.parts[0].kind;
      recalcBlock(b);
    }
    if (wholeIds.length) deleteBlocks(page, wholeIds, { compact: false });
  }
}
