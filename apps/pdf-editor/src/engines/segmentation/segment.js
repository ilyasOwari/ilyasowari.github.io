// Page segmentation entry point: interpreter output -> plain block data.
import { buildAtoms } from './atoms.js';
import { buildParagraphs, clusterAtoms, groupRows } from './cluster.js';
import { unionBox, boxArea } from '../../core/geometry.js';
import { mergeColumnTextRuns, collapseVerticalTextParts } from './mergeTextRuns.js';

export { mergeColumnTextRuns };

let seq = 0;
const nid = (p) => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;
const PAD = 1.2;
const isBoldGlyph = (g) => {
  const f = g && (g.g ? g.g.font : g.font);
  return !!(f && f.style && f.style.weight >= 600);
};

function memberKinds(members) {
  const k = { text: 0, image: 0, fill: 0, decor: 0 };
  for (const m of members) {
    if (m.kind === 'text') { if (m.decor) k.decor++; else k.text++; }
    else if (m.kind === 'image') k.image++;
    else if (m.fill) k.fill++;
  }
  return k;
}

export function segmentPage(interp, geo) {
  const { glyphs, textAtoms: rawTextAtoms, gfx: rawGfx, bgItems } = buildAtoms(interp, geo);
  const { textAtoms, gfx, wmBlocks, wmItemSet, wmGlyphSet } = extractWatermarks(rawTextAtoms, rawGfx, geo);
  const paras = buildParagraphs(textAtoms, gfx, { x0: 0, y0: 0, x1: geo.width, y1: geo.height });
  const atoms = [...paras, ...gfx];
  const clusters = clusterAtoms(atoms, geo);
  const rows = groupRows(clusters, geo);
  const clamp = (b) => ({ x0: Math.max(0, b.x0 - PAD), y0: Math.max(0, b.y0 - PAD), x1: Math.min(geo.width, b.x1 + PAD), y1: Math.min(geo.height, b.y1 + PAD) });
  const blocks = [];
  for (const row of rows) {
    const parts = row.map((c) => {
      const b = clamp(c.b);
      const k = memberKinds(c.members);
      const kind = k.text ? (k.fill || k.image ? 'box' : 'text') : (k.image ? 'image' : 'graphic');
      return { id: nid('p'), src: { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }, kind, editable: k.text > 0, decor: k.decor > 0 && !k.text, _ink: inkBox(c) };
    });
    // partial padding may create overlaps between neighbours: shrink back
    const ub = parts.reduce((acc, p) => unionBox(acc, { x0: p.src.x, y0: p.src.y, x1: p.src.x + p.src.w, y1: p.src.y + p.src.h }), null);
    parts.forEach((p) => { p.dx = p.src.x - ub.x0; p.dy = p.src.y - ub.y0; p.dw = p.src.w; p.dh = p.src.h; });
    const kind = parts.length > 1 ? 'group' : parts[0].kind;
    blocks.push({ id: nid('b'), kind, x: ub.x0, y: ub.y0, s: 1, bw: ub.x1 - ub.x0, bh: ub.y1 - ub.y0, parts, origin: { x: ub.x0, y: ub.y0 } });
  }
  const dbg = (tag) => { if (globalThis.__SEGDBG) console.log('SEG', tag, JSON.stringify(blocks.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.bw), Math.round(b.bh), b.parts.map((q) => q._ink && [q._ink.x0, q._ink.y0, q._ink.x1, q._ink.y1].map(Math.round).join(','))]))); };
  dbg('raw');
  mergeInkOverlaps(blocks);
  dbg('ink');
  mergeTinyBlocks(blocks);
  dbg('tiny');
  mergeNearDecor(blocks);
  dbg('near');
  mergeSmallImageCaptions(blocks);
  dbg('imgcap');
  mergeSequentialGridBlocks(blocks, textAtoms, gfx);
  dbg('gridseq');
  mergeSequentialListBlocks(blocks, textAtoms);
  mergeAlignedUniformLines(blocks, textAtoms);
  mergeAlignedBodyParagraphs(blocks, textAtoms, gfx);
  mergeColumnTextRuns(blocks, textAtoms, gfx, geo);
  mergeChecklistBlocks(blocks, textAtoms, gfx);
  collapseVerticalTextParts(blocks, textAtoms, gfx, geo);
  resolvePadOverlaps(blocks);
  mergeSmallImageCaptions(blocks);
  for (const b of blocks) { delete b._isGrid; for (const p of b.parts) delete p._ink; }
  blocks.push(...wmBlocks);
  blocks.sort((a, b) => a.y - b.y || a.x - b.x);
  return { blocks, bgItems, wmItemSet, wmGlyphSet, glyphCount: glyphs.length, textAtoms, glyphs, atoms: { gfx, bgItems, paras } };
}

// the real ink of a cluster: pictures / drawings exactly, text lines without
// their empty ascender / descender room
function inkBox(c) {
  let u = null;
  const add = (b) => { u = u ? { x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) } : { ...b }; };
  const walk = (m) => {
    if (m.kind === 'text' && m.lines) { for (const l of m.lines) { const hh = l.b.y1 - l.b.y0; add({ x0: l.b.x0, x1: l.b.x1, y0: l.b.y0 + hh * 0.2, y1: l.b.y1 - hh * 0.2 }); } return; }
    if (m.kind === 'text') { const hh = m.b.y1 - m.b.y0; add({ x0: m.b.x0, x1: m.b.x1, y0: m.b.y0 + hh * 0.2, y1: m.b.y1 - hh * 0.2 }); return; }
    add(m.b);
  };
  for (const m of c.members || []) walk(m);
  return u || c.b;
}
const inkOf = (bl) => bl.parts.reduce((u, p) => { const k = p._ink; if (!k) return u; return u ? { x0: Math.min(u.x0, k.x0), y0: Math.min(u.y0, k.y0), x1: Math.max(u.x1, k.x1), y1: Math.max(u.y1, k.y1) } : { ...k }; }, null);
// blocks whose real content overlaps are one thing (a picture and the label
// box sitting on it, a code and its caption...): never cut between them
function mergeInkOverlaps(blocks) {
  // per part: a picture and the label box sitting on it, a code and its caption
  const hit = (P, Q) => P && Q && Math.min(P.x1, Q.x1) - Math.max(P.x0, Q.x0) > 0.3 && Math.min(P.y1, Q.y1) - Math.max(P.y0, Q.y0) > 0.3;
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < blocks.length && !again; i++) for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      if (!a.parts.some((p) => b.parts.some((q) => hit(p._ink, q._ink)))) continue;
      joinBlocks(a, b); blocks.splice(j, 1); again = true; break;
    }
  }
}
function joinBlocks(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const parts = [...a.parts, ...b.parts];
  parts.forEach((p) => { p.dx = p.src.x - x; p.dy = p.src.y - y; });
  a.parts = parts; a.x = x; a.y = y; a.origin = { x, y }; a.kind = 'group';
  a.bw = Math.max(...parts.map((p) => p.dx + p.dw)); a.bh = Math.max(...parts.map((p) => p.dy + p.dh));
}
// very small boxes right next to a bigger block (letter labels under photos,
// tick boxes...) belong to it
function mergeTinyBlocks(blocks) {
  const gapOf = (a, b) => Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.bw, b.x + b.bw), Math.max(a.y, b.y) - Math.min(a.y + a.bh, b.y + b.bh));
  for (let again = true; again;) {
    again = false;
    for (const t of blocks) {
      if (t.bw * t.bh >= 700 || Math.max(t.bw, t.bh) >= 40) continue;
      let best = null;
      for (const o of blocks) {
        if (o === t || o.bw * o.bh < 3 * t.bw * t.bh) continue;
        const g = gapOf(t, o);
        if (g <= 4 && (!best || g < best.g)) best = { o, g };
      }
      if (best) { joinBlocks(best.o, t); blocks.splice(blocks.indexOf(t), 1); again = true; break; }
    }
  }
}

// small drawings with no text (frame pieces, ribbons, stars, underline bars)
// join the bigger block lying within a short radius, as long as the joined box
// does not run into any third block
function mergeNearDecor(blocks, R = 6) {
  const gapOf = (a, b) => Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.bw, b.x + b.bw), Math.max(a.y, b.y) - Math.min(a.y + a.bh, b.y + b.bh));
  const deco = (b) => b.parts.every((p) => p.kind === 'graphic' || p.decor);
  const over = (a, r) => Math.min(a.x + a.bw, r.x1) - Math.max(a.x, r.x0) > 0.5 && Math.min(a.y + a.bh, r.y1) - Math.max(a.y, r.y0) > 0.5;
  for (let again = true, guard = 0; again && guard < 400; guard++) {
    again = false;
    for (const t of blocks) {
      if (!deco(t) || t.bw * t.bh >= 4000) continue;
      let best = null;
      for (const o of blocks) {
        if (o === t || o.bw * o.bh < 3 * t.bw * t.bh) continue;
        const g = gapOf(t, o);
        if (g > R || (best && g >= best.g)) continue;
        const u = { x0: Math.min(t.x, o.x), y0: Math.min(t.y, o.y), x1: Math.max(t.x + t.bw, o.x + o.bw), y1: Math.max(t.y + t.bh, o.y + o.bh) };
        if (blocks.some((q) => q !== t && q !== o && over(q, u))) continue;
        best = { o, g };
      }
      if (best) { joinBlocks(best.o, t); blocks.splice(blocks.indexOf(t), 1); again = true; break; }
    }
  }
}
// padding can make neighbouring blocks overlap by a hair: cut in the empty gap
// between their real content (never through a picture, drawing or text line)
function resolvePadOverlaps(blocks) {
  const inkP = (p) => p._ink || { x0: p.src.x, y0: p.src.y, x1: p.src.x + p.src.w, y1: p.src.y + p.src.h };
  const box = (bl) => inkOf(bl) || { x0: bl.x, y0: bl.y, x1: bl.x + bl.bw, y1: bl.y + bl.bh };
  for (let again = true, guard = 0; again && guard < 200; guard++) {
    again = false;
    outer: for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i], b = blocks[j];
        const partsOverlap = a.parts.some((p) => b.parts.some((q) => Math.min(p.src.x + p.src.w, q.src.x + q.src.w) - Math.max(p.src.x, q.src.x) > 0 && Math.min(p.src.y + p.src.h, q.src.y + q.src.h) - Math.max(p.src.y, q.src.y) > 0));
        const ox = Math.min(a.x + a.bw, b.x + b.bw) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.bh, b.y + b.bh) - Math.max(a.y, b.y);
        if (ox <= 0 || oy <= 0) continue;
        if (!partsOverlap && (a._isGrid || b._isGrid) && Math.min(ox, oy) > 3) continue;
        const vert = oy <= ox;
        const first = vert ? (a.y < b.y ? a : b) : (a.x < b.x ? a : b), second = first === a ? b : a;
        const F = box(first), S = box(second);
        const lo = vert ? F.y1 : F.x1, hi = vert ? S.y0 : S.x0; // the clear gap between the two contents
        if (hi > lo) {
          const edge = vert ? first.y + first.bh : first.x + first.bw, start = vert ? second.y : second.x;
          const mid = Math.min(Math.max((edge + start) / 2, lo), hi);
          shrink(first, vert ? 'bottom' : 'right', edge - mid + 0.01); shrink(second, vert ? 'top' : 'left', mid - start + 0.01);
          continue;
        }
        if (!partsOverlap && (vert ? oy : ox) <= 3.5) {
          const d = (vert ? oy : ox) / 2 + 0.05;
          shrink(first, vert ? 'bottom' : 'right', d); shrink(second, vert ? 'top' : 'left', d);
          continue;
        }
        // no clear gap: parts that only sit beside the other block become their own block
        const beside = (bl, other, P) => (vert ? P.x1 <= other.x + 0.3 || P.x0 >= other.x + other.bw - 0.3 : P.y1 <= other.y + 0.3 || P.y0 >= other.y + other.bh - 0.3);
        for (const [bl, other] of [[second, first], [first, second]]) {
          if (bl.parts.length < 2) continue;
          const off = bl.parts.filter((p) => { const P = inkP(p); const bad = bl === second ? (vert ? P.y0 < lo : P.x0 < lo) : (vert ? P.y1 > hi : P.x1 > hi); return bad && beside(bl, other, { x0: p.src.x, y0: p.src.y, x1: p.src.x + p.src.w, y1: p.src.y + p.src.h }); });
          if (!off.length || off.length === bl.parts.length) continue;
          const ar = (ps) => ps.reduce((t, p) => t + p.src.w * p.src.h, 0);
          if (ar(off) > 0.3 * ar(bl.parts)) continue; // only small things (a code, a caption) are split off
          bl.parts = bl.parts.filter((p) => !off.includes(p));
          refit(bl);
          const nb = { id: nid('b'), kind: off.length > 1 ? 'group' : off[0].kind, x: 0, y: 0, s: 1, bw: 0, bh: 0, parts: off, origin: { x: 0, y: 0 } };
          refit(nb); if (bl.parts.length === 1) bl.kind = bl.parts[0].kind;
          blocks.push(nb);
          again = true; break outer;
        }
        // still tangled: one block (never slice a picture, code or text line)
        joinBlocks(a, b); blocks.splice(j, 1); again = true; break outer;
      }
    }
  }
}
function refit(bl) {
  const ub = bl.parts.reduce((u, p) => unionBox(u, { x0: p.src.x, y0: p.src.y, x1: p.src.x + p.src.w, y1: p.src.y + p.src.h }), null);
  bl.x = ub.x0; bl.y = ub.y0; bl.bw = ub.x1 - ub.x0; bl.bh = ub.y1 - ub.y0; bl.origin = { x: ub.x0, y: ub.y0 };
  bl.parts.forEach((p) => { p.dx = p.src.x - ub.x0; p.dy = p.src.y - ub.y0; p.dw = p.src.w; p.dh = p.src.h; });
}
function shrink(bl, side, d) {
  for (const p of bl.parts) {
    if (side === 'bottom' && p.dy + p.dh > bl.bh - d - 0.01) { p.src.h -= d; p.dh -= d; }
    if (side === 'right' && p.dx + p.dw > bl.bw - d - 0.01) { p.src.w -= d; p.dw -= d; }
    if (side === 'top' && p.dy < d) { p.src.y += d; p.src.h -= d; p.dh -= d; p.dy = Math.max(0, p.dy - d); }
    if (side === 'left' && p.dx < d) { p.src.x += d; p.src.w -= d; p.dw -= d; p.dx = Math.max(0, p.dx - d); }
  }
  if (side === 'bottom') bl.bh -= d;
  if (side === 'right') bl.bw -= d;
  if (side === 'top') { bl.y += d; bl.bh -= d; bl.origin.y += d; bl.parts.forEach((p) => { if (p.dy > 0) p.dy -= 0; }); }
  if (side === 'left') { bl.x += d; bl.bw -= d; bl.origin.x += d; }
}

// Small picture/QR code + adjacent short caption/title ("Track R.1") belong together
function mergeSmallImageCaptions(blocks) {
  const over = (a, r) => Math.min(a.x + a.bw, r.x1) - Math.max(a.x, r.x0) > 0.5 && Math.min(a.y + a.bh, r.y1) - Math.max(a.y, r.y0) > 0.5;
  const hasImg = (b) => b.parts.some((p) => p.kind === 'image' || p.kind === 'box' || (p.kind === 'graphic' && !p.decor));
  const isSmallTxt = (b) => b.bw < 95 && b.bh < 28 && b.parts.every((p) => p.kind === 'text');
  for (let again = true, guard = 0; again && guard < 100; guard++) {
    again = false;
    for (let i = 0; i < blocks.length && !again; i++) {
      const a = blocks[i];
      if (!hasImg(a) || a.bw < 18 || a.bh < 18 || a.bw >= 95 || a.bh >= 95) continue;
      for (let j = 0; j < blocks.length; j++) {
        if (i === j) continue;
        const t = blocks[j];
        if (!isSmallTxt(t)) continue;
        const vGap = t.y >= a.y + a.bh ? t.y - (a.y + a.bh) : (a.y >= t.y + t.bh ? a.y - (t.y + t.bh) : 0);
        if (vGap > 14) continue;
        const hov = Math.min(a.x + a.bw, t.x + t.bw) - Math.max(a.x, t.x);
        const acx = a.x + a.bw / 2, tcx = t.x + t.bw / 2;
        if (hov < 0.5 * Math.min(a.bw, t.bw) && Math.abs(acx - tcx) > 18) continue;
        const u = { x0: Math.min(a.x, t.x), y0: Math.min(a.y, t.y), x1: Math.max(a.x + a.bw, t.x + t.bw), y1: Math.max(a.y + a.bh, t.y + t.bh) };
        if (blocks.some((q) => q !== a && q !== t && over(q, u))) continue;
        joinBlocks(a, t); blocks.splice(j, 1); again = true; break;
      }
    }
  }
}

// Pattern recognition: consecutive sequential badge rows ("a-b-c-d" + "e-f-g", "1-2-3" + "4-5-6") form one grid block
function blockBadgeSeq(b, textAtoms, gfx) {
  const hits = [];
  for (const l of textAtoms) {
    if (l.decor) continue;
    const cx = (l.b.x0 + l.b.x1) / 2, cy = (l.b.y0 + l.b.y1) / 2;
    if (cx < b.x - 1 || cx > b.x + b.bw + 1 || cy < b.y - 1 || cy > b.y + b.bh + 1) continue;
    const s = l.text.replace(/\s+/g, '');
    if (!s || s.length > 2) continue;
    let kind = null, code = null;
    if (/^[1-9]\d?$/.test(s)) { kind = 'num'; code = parseInt(s, 10); }
    else if (/^[a-z]$/.test(s)) { kind = 'lower'; code = s.charCodeAt(0); }
    else if (/^[A-Z]$/.test(s)) { kind = 'upper'; code = s.charCodeAt(0); }
    if (!kind) continue;
    const hasBox = gfx.some((g) => (g.fill || g.stroke) && g.area < 14 * l.size * l.size && Math.min(g.b.x1, l.b.x1) > Math.max(g.b.x0, l.b.x0) && Math.min(g.b.y1, l.b.y1) > Math.max(g.b.y0, l.b.y0));
    if (!hasBox) continue;
    hits.push({ kind, code, x: l.b.x0, y: l.baseline });
  }
  if (hits.length < 2) return null;
  const k0 = hits[0].kind;
  if (hits.some((h) => h.kind !== k0)) return null;
  hits.sort((p, q) => (Math.abs(p.y - q.y) < 12 ? p.x - q.x : p.y - q.y));
  for (let i = 1; i < hits.length; i++) if (hits[i].code !== hits[i - 1].code + 1) return null;
  return { kind: k0, first: hits[0].code, last: hits[hits.length - 1].code };
}

function mergeSequentialGridBlocks(blocks, textAtoms, gfx) {
  const over = (a, r) => Math.min(a.x + a.bw, r.x1) - Math.max(a.x, r.x0) > 1 && Math.min(a.y + a.bh, r.y1) - Math.max(a.y, r.y0) > 1;
  for (let again = true, guard = 0; again && guard < 100; guard++) {
    again = false;
    for (let i = 0; i < blocks.length && !again; i++) {
      const a = blocks[i];
      const sa = blockBadgeSeq(a, textAtoms, gfx);
      if (!sa) continue;
      for (let j = 0; j < blocks.length; j++) {
        if (i === j) continue;
        const b = blocks[j];
        if (b.y < a.y + a.bh * 0.5) continue;
        const vGap = b.y - (a.y + a.bh);
        if (vGap > Math.max(45, Math.min(a.bh, b.bh) * 0.65)) continue;
        const hov = Math.min(a.x + a.bw, b.x + b.bw) - Math.max(a.x, b.x);
        if (hov < 0.45 * Math.min(a.bw, b.bw)) continue;
        const sb = blockBadgeSeq(b, textAtoms, gfx);
        if (!sb || sb.kind !== sa.kind || sb.first !== sa.last + 1) continue;
        const ux0 = Math.max(Math.min(a.x, b.x), Math.min(a.x + a.bw, b.x + b.bw) - Math.max(a.bw, b.bw));
        const between = blocks.some((q) => q !== a && q !== b && q.y + q.bh > a.y + a.bh - 2 && q.y < b.y + 2 && over(q, { x0: Math.min(a.x, b.x), y0: a.y + a.bh, x1: Math.max(a.x + a.bw, b.x + b.bw), y1: b.y }));
        void ux0;
        if (between) continue;
        joinBlocks(a, b); a._isGrid = true; blocks.splice(j, 1); again = true; break;
      }
    }
  }
}

function blockListInfo(b, textAtoms) {
  if (!b.parts.every((p) => p.kind === 'text')) return null;
  const lines = textAtoms
    .filter((l) => !l.decor && ((l.b.x0 + l.b.x1) / 2 >= b.x - 1) && ((l.b.x0 + l.b.x1) / 2 <= b.x + b.bw + 1)
      && ((l.b.y0 + l.b.y1) / 2 >= b.y - 1) && ((l.b.y0 + l.b.y1) / 2 <= b.y + b.bh + 1))
    .sort((p, q) => p.baseline - q.baseline);
  if (!lines.length) return null;
  const parse = (l) => {
    const s = (l.glyphs || []).map((g) => g.uni || '').join('').trim();
    let m = /^(\d{1,2})\s*[.)]\s+\S/.exec(s);
    if (m) return { kind: 'num', code: parseInt(m[1], 10) };
    m = /^([a-zA-Z])\s*[.)]\s+\S/.exec(s);
    if (m) return { kind: m[1] === m[1].toLowerCase() ? 'alphaL' : 'alphaU', code: m[1].toLowerCase().charCodeAt(0) };
    m = /^([•●○◦▪▫‣▸►✓✔*\-–—])\s*\S/.exec(s);
    if (m) return { kind: 'bullet', code: 0 };
    return null;
  };
  const first = parse(lines[0]);
  if (!first) return null;
  let last = first;
  for (let i = 1; i < lines.length; i++) {
    const mk = parse(lines[i]);
    if (mk && mk.kind === first.kind && (mk.kind === 'bullet' || mk.code === last.code + 1)) last = mk;
  }
  const ns = lines[0].glyphs.filter((g) => !g.space);
  const bold = ns.filter(isBoldGlyph).length > ns.length / 2;
  return { kind: first.kind, first: first.code, last: last.code, size: lines[0].size || 10, bold };
}

function mergeSequentialListBlocks(blocks, textAtoms) {
  for (let again = true, guard = 0; again && guard < 120; guard++) {
    again = false;
    blocks.sort((p, q) => p.y - q.y || p.x - q.x);
    for (let i = 0; i < blocks.length && !again; i++) {
      const a = blocks[i];
      const ia = blockListInfo(a, textAtoms);
      if (!ia) continue;
      for (let j = i + 1; j < blocks.length; j++) {
        const b = blocks[j];
        if (b.y < a.y + a.bh - 2) continue;
        const vGap = b.y - (a.y + a.bh);
        if (vGap > 45) break;
        if (Math.abs(a.x - b.x) > 12) continue;
        const ib = blockListInfo(b, textAtoms);
        if (!ib || ib.kind !== ia.kind || ib.bold !== ia.bold || Math.abs(ib.size - ia.size) > 1.5) continue;
        if (ib.kind !== 'bullet' && ib.first !== ia.last + 1) continue;
        const between = blocks.some((q) => q !== a && q !== b && q.y + q.bh > a.y + a.bh + 1 && q.y < b.y - 1);
        if (between) continue;
        joinBlocks(a, b); blocks.splice(j, 1); again = true; break;
      }
    }
  }
}

function blockUniformLineInfo(b, textAtoms) {
  if (!b.parts.every((p) => p.kind === 'text') || b.bw > 280) return null;
  const lines = textAtoms
    .filter((l) => !l.decor && ((l.b.x0 + l.b.x1) / 2 >= b.x - 1) && ((l.b.x0 + l.b.x1) / 2 <= b.x + b.bw + 1)
      && ((l.b.y0 + l.b.y1) / 2 >= b.y - 1) && ((l.b.y0 + l.b.y1) / 2 <= b.y + b.bh + 1))
    .sort((p, q) => p.b.y0 - q.b.y0 || p.b.x0 - q.b.x0);
  if (!lines.length) return null;
  const lineBold = (l) => {
    const ns = l.glyphs.filter((g) => !g.space);
    if (!ns.length) return null;
    return ns.filter(isBoldGlyph).length > ns.length / 2;
  };
  const firstBold = lineBold(lines[0]);
  if (firstBold == null) return null;
  const firstSize = lines[0].size || 10;
  const firstX = lines[0].b.x0;
  const firstRgb = lines[0].rgb ? lines[0].rgb.join(',') : '';
  for (const l of lines) {
    if (l.b.y1 - l.b.y0 > 64) return null;
    if (Math.abs((l.size || 10) - firstSize) > 1.2) return null;
    if (lineBold(l) !== firstBold) return null;
    const rgb = l.rgb ? l.rgb.join(',') : '';
    if (rgb !== firstRgb) return null;
    const txt = (l.glyphs || []).map((g) => g.uni || '').join('').trim();
    if (/^\d{1,2}\s*[.)]\s+\S/.test(txt)) return null;
  }
  return { size: firstSize, bold: firstBold, rgb: firstRgb, lineH: lines[0].b.y1 - lines[0].b.y0, firstX, centerX: b.x + b.bw * 0.5 };
}

function mergeAlignedUniformLines(blocks, textAtoms) {
  for (let again = true, guard = 0; again && guard < 120; guard++) {
    again = false;
    blocks.sort((p, q) => p.y - q.y || p.x - q.x);
    for (let i = 0; i < blocks.length && !again; i++) {
      const a = blocks[i];
      const ia = blockUniformLineInfo(a, textAtoms);
      if (!ia) continue;
      for (let j = i + 1; j < blocks.length; j++) {
        const b = blocks[j];
        if (b.y < a.y + a.bh - 2) continue;
        const vGap = b.y - (a.y + a.bh);
        if (vGap > Math.max(28, ia.size * 2.4)) break;
        const ib = blockUniformLineInfo(b, textAtoms);
        if (!ib || ib.bold !== ia.bold || ib.rgb !== ia.rgb || Math.abs(ib.size - ia.size) > 1.2) continue;
        const sameLeft = Math.abs(ib.firstX - ia.firstX) <= 10;
        const sameCenter = Math.abs(ib.centerX - ia.centerX) <= 18;
        if (!sameLeft && !sameCenter) continue;
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x + a.bw, b.x + b.bw);
        const between = blocks.some((q) => q !== a && q !== b && !q.free && q.y + q.bh > a.y + a.bh + 1 && q.y < b.y - 1 && Math.min(q.x + q.bw, x1) > Math.max(q.x, x0));
        if (between) continue;
        joinBlocks(a, b); blocks.splice(j, 1); again = true; break;
      }
    }
  }
}

function mergeAlignedBodyParagraphs(blocks, textAtoms, gfx) {
  const bodyInfo = (b) => {
    if (b.free || !b.parts.every((p) => p.kind === 'text' || (p.kind === 'graphic' && p.src.w <= 14 && p.src.h <= 14)) || b.bw < 180) return null;
    const lines = textAtoms.filter((l) => !l.decor
      && ((l.b.x0 + l.b.x1) / 2 >= b.x - 1) && ((l.b.x0 + l.b.x1) / 2 <= b.x + b.bw + 1)
      && ((l.b.y0 + l.b.y1) / 2 >= b.y - 1) && ((l.b.y0 + l.b.y1) / 2 <= b.y + b.bh + 1));
    if (!lines.length) return null;
    const ns = lines.flatMap((l) => l.glyphs.filter((g) => !g.space));
    if (ns.length < 15) return null;
    const bold = ns.filter(isBoldGlyph).length > ns.length * 0.85;
    if (bold) return null;
    return { size: lines[0].size || 10 };
  };
  for (let again = true, guard = 0; again && guard < 120; guard++) {
    again = false;
    blocks.sort((p, q) => p.y - q.y || p.x - q.x);
    for (let i = 0; i < blocks.length && !again; i++) {
      const a = blocks[i];
      const ia = bodyInfo(a);
      if (!ia) continue;
      for (let j = i + 1; j < blocks.length; j++) {
        const b = blocks[j];
        if (b.y < a.y + a.bh - 2) continue;
        const vGap = b.y - (a.y + a.bh);
        if (vGap > Math.max(26, ia.size * 2.5)) break;
        if (Math.abs(a.x - b.x) > 28) continue;
        const ib = bodyInfo(b);
        if (!ib || Math.abs(ib.size - ia.size) > 1.0) continue;
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x + a.bw, b.x + b.bw);
        if (Math.min(a.x + a.bw, b.x + b.bw) - Math.max(a.x, b.x) < 0.6 * Math.min(a.bw, b.bw)) continue;
        const betweenBlk = blocks.some((q) => q !== a && q !== b && !q.free && q.y + q.bh > a.y + a.bh + 1 && q.y < b.y - 1 && Math.min(q.x + q.bw, x1) > Math.max(q.x, x0));
        if (betweenBlk) continue;
        const betweenGfx = gfx.some((g) => (g.fill || g.stroke) && (g.b.x1 - g.b.x0 > 14 || g.b.y1 - g.b.y0 > 14) && g.b.y1 > a.y + a.bh - 1 && g.b.y0 < b.y + 1 && Math.min(g.b.x1, x1) > Math.max(g.b.x0, x0));
        if (betweenGfx) continue;
        joinBlocks(a, b); blocks.splice(j, 1); again = true; break;
      }
    }
  }
}

function mergeChecklistBlocks(blocks, textAtoms, gfx) {
  const infoOf = (b) => {
    if (b.free || b.bw < 140) return null;
    if (!b.parts.every((p) => p.kind === 'text' || (p.kind === 'graphic' && p.src.w <= 22 && p.src.h <= 22))) return null;
    const lines = textAtoms.filter((l) => !l.decor
      && ((l.b.x0 + l.b.x1) / 2 >= b.x - 1) && ((l.b.x0 + l.b.x1) / 2 <= b.x + b.bw + 1)
      && ((l.b.y0 + l.b.y1) / 2 >= b.y - 1) && ((l.b.y0 + l.b.y1) / 2 <= b.y + b.bh + 1));
    if (!lines.length) return null;
    const ns = lines.flatMap((l) => l.glyphs.filter((g) => !g.space));
    if (ns.length < 10) return null;
    const bold = ns.filter(isBoldGlyph).length > ns.length * 0.85;
    if (bold) return null;
    const hasBox = b.parts.some((p) => p.kind === 'graphic');
    const textX = Math.min(...lines.map((l) => l.b.x0));
    return { size: lines[0].size || 10, hasBox, textX };
  };
  for (let again = true, guard = 0; again && guard < 120; guard++) {
    again = false;
    blocks.sort((p, q) => p.y - q.y || p.x - q.x);
    for (let i = 0; i < blocks.length && !again; i++) {
      const a = blocks[i];
      const ia = infoOf(a);
      if (!ia) continue;
      for (let j = i + 1; j < blocks.length; j++) {
        const b = blocks[j];
        if (b.y < a.y + a.bh - 2) continue;
        const vGap = b.y - (a.y + a.bh);
        if (vGap > Math.max(26, ia.size * 2.5)) break;
        const ib = infoOf(b);
        if (!ib || (!ia.hasBox && !ib.hasBox) || Math.abs(ib.size - ia.size) > 1.2) continue;
        if (Math.abs(a.x - b.x) > 22 && Math.abs(ia.textX - ib.textX) > 16) continue;
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x + a.bw, b.x + b.bw);
        const betweenBlk = blocks.some((q) => q !== a && q !== b && !q.free && q.y + q.bh > a.y + a.bh + 1 && q.y < b.y - 1 && Math.min(q.x + q.bw, x1) > Math.max(q.x, x0));
        if (betweenBlk) continue;
        const betweenGfx = gfx.some((g) => (g.fill || g.stroke) && g.b.y1 > a.y + a.bh - 1 && g.b.y0 < b.y + 1 && Math.min(g.b.x1, x1) > Math.max(g.b.x0, x0) && (g.b.x1 - g.b.x0 > 24 || g.b.y1 - g.b.y0 > 24));
        if (betweenGfx) continue;
        joinBlocks(a, b); blocks.splice(j, 1); again = true; break;
      }
    }
  }
}

function extractWatermarks(textAtoms, gfx, geo) {
  const empty = { textAtoms, gfx, wmBlocks: [], wmItemSet: new Set(), wmGlyphSet: new Set() };
  if (!gfx.length && !textAtoms.length) return empty;
  const lum = (c) => (c ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : 0);
  const isPale = (c) => !!(c && lum(c) > 200);
  const isDark = (c) => !c || lum(c) < 165;
  const over = (a, b, pad = 0) => Math.min(a.x1, b.x1 + pad) > Math.max(a.x0, b.x0 - pad) && Math.min(a.y1, b.y1 + pad) > Math.max(a.y0, b.y0 - pad);
  const darkLines = textAtoms.filter((l) => isDark(l.rgb) && l.glyphs.filter((g) => !g.space).length >= 3);

  const isPaleGfx = (g) => {
    const gw = g.b.x1 - g.b.x0, gh = g.b.y1 - g.b.y0;
    if (g.kind === 'image') {
      if (gw <= 70 || gh <= 50 || g.area <= 4000) return false;
      if ((g.ca ?? 1) < 0.85) return darkLines.some((l) => over(g.b, l.b));
      if (gw > 100 && gh > 80 && darkLines.some((l) => over(g.b, l.b))) return true;
      const hits = darkLines.filter((l) => over(g.b, l.b) && l.glyphs.filter((x) => !x.space).length >= 6);
      if (hits.length < 2) return false;
      const ys = hits.map((l) => l.baseline);
      return Math.max(...ys) - Math.min(...ys) > 30;
    }
    if (g.kind !== 'path' || !(g.fill || g.stroke)) return false;
    if (g.fill && !g.stroke && g.item.nSub <= 1) return false;
    const hasAlpha = (g.fill && (g.ca ?? 1) < 0.55) || (g.stroke && (g.CA ?? 1) < 0.55);
    if (g.fill && !hasAlpha) return false;
    if (g.fill && !isPale(g.rgb) && (g.ca ?? 1) >= 0.55) return false;
    const strokePale = isPale(g.strokeRgb || g.item.strokeRgb) && lum(g.strokeRgb || g.item.strokeRgb) < 252;
    if (g.stroke && !hasAlpha && !strokePale) return false;
    return true;
  };

  const lineStr = (l) => (l && l.glyphs ? l.glyphs.map((g) => g.uni || '').join('').replace(/\s+/g, '') : '');
  const isShadowPair = (a, b) => {
    if (Math.abs((a.size || 0) - (b.size || 0)) > 2.5) return false;
    const sa = lineStr(a), sb = lineStr(b);
    if (sa && sb && sa === sb) return true;
    return Math.abs(a.b.x0 - b.b.x0) < 6 && Math.abs(a.b.y0 - b.b.y0) < 6 && Math.abs(a.b.x1 - b.b.x1) < 6;
  };
  const hasDarkBackdrop = (l) => gfx.some((g) => (g.kind === 'image' ? !isPaleGfx(g) : (g.fill && !isPale(g.rgb))) && over(g.b, l.b) && boxArea(g.b) > boxArea(l.b));
  const isPaleText = (l) => {
    if (!l || !l.glyphs || !l.glyphs.length) return false;
    const ca = l.glyphs[0]?.g?.ca ?? 1;
    const lLum = l.rgb ? lum(l.rgb) : 0;
    if (lLum >= 250 && ca >= 0.9) return false;
    const paleCol = isPale(l.rgb) && lLum < 252;
    if (hasDarkBackdrop(l)) return false;
    // Rule 1: two texts overlapping -> the paler one is a watermark regardless of font size (ignore drop-shadow duplicates of same text)
    const overlapsDarkerText = darkLines.some((dl) => dl !== l && !isShadowPair(dl, l) && over(dl.b, l.b) && lLum > (dl.rgb ? lum(dl.rgb) : 0) + 45 && lLum > 155);
    if (overlapsDarkerText) return true;
    // White / near-white text that does not overlap any darker text is a title on a colored banner/shape, not a watermark
    if (lLum > 220 && !darkLines.some((dl) => !isShadowPair(dl, l) && over(dl.b, l.b, 8))) return false;
    if (ca >= 0.55 && !(paleCol && l.size >= 18)) return false;
    return darkLines.some((dl) => !isShadowPair(dl, l) && over(dl.b, l.b, 8)) || l.size > 26;
  };

  const cands = gfx.filter(isPaleGfx);
  const textCands = textAtoms.filter(isPaleText);
  if (!cands.length && !textCands.length) return empty;
  const used = new Set();
  const wmGfx = new Set();
  const wmTexts = new Set();
  const wmBlocks = [];

  for (const seed of cands) {
    if (used.has(seed)) continue;
    const comp = [seed];
    used.add(seed);
    let ub = { ...seed.b };
    for (let added = true; added;) {
      added = false;
      for (const c of cands) {
        if (used.has(c) || !over(ub, c.b, 14)) continue;
        used.add(c);
        comp.push(c);
        ub = unionBox(ub, c.b);
        added = true;
      }
    }
    const uw = ub.x1 - ub.x0, uh = ub.y1 - ub.y0;
    if (uw < 80 || uh < 55 || uw * uh < 5000) continue;
    if (!darkLines.some((l) => over(ub, l.b))) continue;
    // Pull in sibling graphics from the same Form XObject (e.g. outlined ARGE letters + sub-labels) or white-filled/outlined watermark paths inside ub
    const compSids = new Set(comp.map((c) => c.item && c.item.depth > 0 && c.item.sid).filter(Boolean));
    for (const g of gfx) {
      if (used.has(g)) continue;
      const sameSid = g.item && g.item.depth > 0 && compSids.has(g.item.sid);
      const whiteOutlined = g.kind === 'path' && g.fill && g.stroke && g.rgb && lum(g.rgb) > 240 && over(ub, g.b, 4);
      if (sameSid || whiteOutlined) {
        used.add(g);
        comp.push(g);
        ub = unionBox(ub, g.b);
      }
    }
    for (const c of comp) wmGfx.add(c);
    // pale watermark text overlapping or hugging this watermark
    for (const l of textAtoms) {
      if (!isPale(l.rgb) || lum(l.rgb) >= 252 || !over(ub, l.b, 18)) continue;
      if (hasDarkBackdrop(l)) continue;
      if (lum(l.rgb) > 220 && !darkLines.some((dl) => !isShadowPair(dl, l) && over(dl.b, l.b, 8))) continue;
      wmTexts.add(l);
      ub = unionBox(ub, l.b);
    }
    const bx0 = Math.max(0, ub.x0 - PAD), by0 = Math.max(0, ub.y0 - PAD);
    const bx1 = Math.min(geo.width, ub.x1 + PAD), by1 = Math.min(geo.height, ub.y1 + PAD);
    const bw = bx1 - bx0, bh = by1 - by0;
    wmBlocks.push({
      id: nid('b'), kind: 'graphic', free: true, behind: true, watermark: true,
      x: bx0, y: by0, s: 1, bw, bh, origin: { x: bx0, y: by0 },
      parts: [{ id: nid('p'), src: { x: bx0, y: by0, w: bw, h: bh }, dx: 0, dy: 0, dw: bw, dh: bh, kind: 'graphic', editable: false, decor: true, tp: true, watermark: true }],
    });
  }
  // Standalone text watermarks not already absorbed into a graphic watermark block
  for (const l of textCands) {
    if (wmTexts.has(l)) continue;
    wmTexts.add(l);
    const ub = l.b;
    const bx0 = Math.max(0, ub.x0 - PAD), by0 = Math.max(0, ub.y0 - PAD);
    const bx1 = Math.min(geo.width, ub.x1 + PAD), by1 = Math.min(geo.height, ub.y1 + PAD);
    const bw = bx1 - bx0, bh = by1 - by0;
    wmBlocks.push({
      id: nid('b'), kind: 'graphic', free: true, behind: true, watermark: true,
      x: bx0, y: by0, s: 1, bw, bh, origin: { x: bx0, y: by0 },
      parts: [{ id: nid('p'), src: { x: bx0, y: by0, w: bw, h: bh }, dx: 0, dy: 0, dw: bw, dh: bh, kind: 'graphic', editable: false, decor: true, tp: true, watermark: true }],
    });
  }
  if (!wmBlocks.length) return empty;
  const wmItemSet = new Set([...wmGfx].map((g) => g.item));
  const wmGlyphSet = new Set([...wmTexts].flatMap((l) => l.glyphs.map((g) => g.idx)));
  return {
    textAtoms: textAtoms.filter((l) => !wmTexts.has(l)),
    gfx: gfx.filter((g) => !wmGfx.has(g)),
    wmBlocks, wmItemSet, wmGlyphSet,
  };
}
