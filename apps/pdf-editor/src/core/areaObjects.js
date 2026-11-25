// Area editor model: a block (or several selected blocks) taken apart into
// objects — background boxes, photos, small label / checkbox boxes, text
// groups, other drawings — each drawn from the original PDF content on its own.
// Applying puts the objects back as one block of "object parts".
import * as ops from '../model/blockOps.js';
import { hydrateImg, dehydrateImg } from './imageStore.js';
import { partDestRect, srcIndexOf, fallbackSrcIndex } from '../model/blockState.js';
import { fitBack } from '../model/photoOps.js';
import { findClusters } from '../engines/text/textModel.js';
import { insToStageObj } from './insertedBlocks.js';

const cx = (b) => (b.x0 + b.x1) / 2, cy = (b) => (b.y0 + b.y1) / 2;
const inR = (r, x, y, t = 0) => x >= r.x - t && x <= r.x + r.w + t && y >= r.y - t && y <= r.y + r.h + t;
const toRect = (b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
const union = (a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b });
const boxIn = (o, i, t = 0.5) => i.x0 >= o.x0 - t && i.y0 >= o.y0 - t && i.x1 <= o.x1 + t && i.y1 <= o.y1 + t;
const touch = (a, b, g) => a.x0 <= b.x1 + g && b.x0 <= a.x1 + g && a.y0 <= b.y1 + g && b.y0 <= a.y1 + g;
let seq = 0;
const oid = () => 'o' + (++seq);

export const SMALL = 1200; // pt² — label boxes, badges, checkboxes

export function decomposeBlocks(session, page, ids) {
  session.ensurePage(page);
  const blocks = ids.map((id) => ops.findBlock(page, id)).filter(Boolean);
  if (!blocks.length) return { error: 'none' };
  const rawSis = blocks.filter((b) => !b.inserted).map((b) => srcIndexOf(page, b)).filter((x) => x !== null && x !== undefined);
  const sis = new Set(rawSis);
  if (sis.size > 1) return { error: 'mixed' };
  const si = sis.size === 1 ? [...sis][0] : fallbackSrcIndex(session, page);
  const an = si === null || si === undefined ? null : session.analysis(si);
  const objects = [];
  let R = null;
  for (const b of blocks) {
    const br = ops.blockRect(b);
    R = union(R, { x0: br.x, y0: br.y, x1: br.x + br.w, y1: br.y + br.h });
    if (b.inserted) {
      if (b.inserted.type === 'image' || b.inserted.type === 'text') objects.push(insToStageObj(oid(), b.inserted, br, b._preparedEdit || null, { ocrBgHex: b.ocrBgHex, ocr: !!b._ocrBlock }));
      continue;
    }
    for (const p of b.parts) {
      const d = partDestRect(b, p);
      if (p.kind === 'instext' && p.inserted) { objects.push(insToStageObj(oid(), p.inserted, d, p._preparedEdit || null, { ocrBgHex: p.ocrBgHex || p.inserted.ocrBgHex, ocr: !!p.ocr })); continue; }
      if (p.kind === 'insimg' || !p.src) {
        if (p.img) objects.push({
          id: oid(), type: 'img', img: hydrateImg(p.img),
          ...(p.img.placeholder ? { placeholder: true } : {}),
          x: d.x, y: d.y, w: d.w, h: d.h,
          ...(p.inline ? { inline: true } : {}),
          ...(p.ocrPatch ? { ocrPatch: true, ...(p.ocrGroup ? { ocrGroup: p.ocrGroup } : {}) } : {}),
        });
        continue;
      }
      if (p.obj) { objects.push(fromObjPart(p, d)); continue; }
      if (!an) continue;
      objects.push(...splitPart(an, page, b, p, d));
    }
  }
  // drawing order: backgrounds, drawings, photos, boxes, text
  const rank = { bg: 0, deco: 1, photo: 2, img: 2, box: 3, text: 4 };
  // Graphics keep the PDF's own paint order (their lowest drawing index): a
  // white panel painted over a red board must stay above it, whatever their
  // types or sizes. Text stays on top; objects without source drawings
  // (inserted pictures, added boxes) follow the type ranking after them.
  const minKeep = (o) => (o.keep && o.keep.length ? Math.min(...o.keep) : null);
  const keyOf = (o) => {
    const mk = o.type === 'text' ? null : minKeep(o);
    return [o.type === 'text' ? 1 : 0, mk != null ? 0 : 1, mk != null ? mk : rank[o.type], -(o.w * o.h)];
  };
  const keys = new Map(objects.map((o) => [o, keyOf(o)]));
  objects.sort((a, b) => { const A = keys.get(a), B = keys.get(b); for (let k = 0; k < 4; k++) if (A[k] !== B[k]) return A[k] - B[k]; return 0; });
  return { an, si, ids: blocks.map((b) => b.id), R: toRect(R), objects, page };
}

function fromObjPart(p, d) {
  const k = d.w / p.dw;
  return { id: oid(), type: p.obj, src: { ...p.src }, full: { ...(p.full || p.src) }, keep: p.keep || [], keepG: p.keepG || [], edit: p.edit || null, nine: p.nine ? { ...p.nine } : null, erase: p.erase ? p.erase.map((e) => ({ ...e })) : undefined,
    ...(p.clip ? { clip: { ...p.clip } } : {}),
    bgMode: p.bgMode || undefined,
    removedG: p.removedG ? p.removedG.slice() : [],
    badge: !!p.badge, badgeBaseline: p.badgeBaseline ?? null, hasBorder: !!p.hasBorder, addedText: !!p.addedText, addedTable: !!p.addedTable, refGlyphIdx: p.refGlyphIdx, fontSize: p.fontSize, baseW: p.baseW, cell: p.cell ? { ...p.cell } : null, cellRight: p.cellRight || 0, container: p.container ? { ...p.container } : null,
    ocr: !!p.ocr, ocrGroup: p.ocrGroup || undefined, ocrPatchFlat: !!p.ocrPatchFlat, ocrBgHex: p.ocrBgHex || undefined, origLines: p.origLines || undefined, lineStep: p.lineStep || undefined,
    rowRole: p.rowRole || undefined, sideEdge: p.sideEdge || undefined,
    k, dw: p.dw, dh: p.dh, x: d.x, y: d.y, w: d.w, h: d.h };
}

function splitPart(an, page, b, p, d) {
  const S = p.src, k = d.w / p.dw;
  const map = (bx) => ({ x: d.x + (bx.x0 - S.x) * k, y: d.y + (bx.y0 - S.y) * k, w: (bx.x1 - bx.x0) * k, h: (bx.y1 - bx.y0) * k });
  const erased = (bx) => (p.erase || []).some((e) => boxIn({ x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h }, bx, 0.3));
  const srcB = { x0: S.x, y0: S.y, x1: S.x + S.w, y1: S.y + S.h };
  const G = [];
  an.atoms.gfx.forEach((g, i) => {
    if (!inR(S, cx(g.b), cy(g.b))) return;
    if (erased(g.b)) return;
    if (page.whiteBg && an.bgItemSet && an.bgItemSet.has(g.item)) return;
    G.push({ i, g, used: false });
  });
  const out = [];
  const mk = (type, bx, keep, keepG, extra = {}) => {
    const c = { x0: Math.max(bx.x0, srcB.x0 - 2), y0: Math.max(bx.y0, srcB.y0 - 2), x1: Math.min(bx.x1, srcB.x1 + 2), y1: Math.min(bx.y1, srcB.y1 + 2) };
    const src = toRect(c);
    const r = map(c);
    const o = { id: oid(), type, src, full: { ...src }, keep, keepG, edit: null, nine: null, k, dw: src.w, dh: src.h, ...(type !== 'photo' && p.bgMode ? { bgMode: p.bgMode } : {}), ...r, ...extra };
    // "Gizle" fills baked into the block stay with the graphics they cover
    if (type !== 'text') {
      const cov = (p.erase || []).filter((e) => e.fill && e.x < c.x1 && e.x + e.w > c.x0 && e.y < c.y1 && e.y + e.h > c.y0);
      if (cov.length) o.erase = cov.map((e) => ({ ...e }));
    }
    out.push(o); return o;
  };
  // photos (+ a frame drawn tightly around them)
  for (const ph of G.filter((x) => x.g.kind === 'image' && x.g.area > 300)) {
    if (ph.used) continue;
    let bx = { ...ph.g.b }; const keep = [ph.i]; ph.used = true;
    for (const f of G) {
      if (f.used || f.g.kind === 'image') continue;
      const m = 7, fb = f.g.b, ib = ph.g.b;
      if (fb.x0 <= ib.x0 + 0.5 && fb.y0 <= ib.y0 + 0.5 && fb.x1 >= ib.x1 - 0.5 && fb.y1 >= ib.y1 - 0.5 && fb.x0 > ib.x0 - m && fb.y0 > ib.y0 - m && fb.x1 < ib.x1 + m && fb.y1 < ib.y1 + m) {
        bx = union(bx, fb); keep.push(f.i); f.used = true;
      }
    }
    // other images / drawings lying fully on the photo belong to it
    for (const f of G) if (!f.used && f.g.area < ph.g.area * 0.5 && boxIn(bx, f.g.b, 0.2) && f.g.kind === 'image') { keep.push(f.i); f.used = true; }
    mk('photo', bx, keep, []);
  }
  // bounded containers enclosing a single non-badge text cluster ("e.g." pills, speech bubbles, option boxes)
  // belong to that text object so container + text move, resize and grow/shrink together
  const isGfxObj = p.obj === 'deco' || p.obj === 'bg';
  const clusters = (p.edit && !isGfxObj) ? [] : findClusters(an, p);
  const permRm = new Set(p.removedG || []);
  const removed = new Set([...((p.edit && p.edit.removeGlyphs) || []), ...permRm]);
  const glyphOk = (x) => !x.invisible && !permRm.has(x.idx) && inR(S, cx(x.b), cy(x.b)) && !(p.erase || []).some((e) => inR(e, cx(x.b), cy(x.b)));
  const lines = an.seg.textAtoms.filter((l) => inR(S, cx(l.b), cy(l.b)) || l.glyphs.some((x) => glyphOk(x)));
  if (!p.edit) {
    const nonBadge = clusters.filter((c) => !c.badge && !(c.cell && c.cell.gridRow != null));
    for (const c of nonBadge) {
      const cb = c.para.b;
      const enclosesOnlyMe = (gb) => !nonBadge.some((c2) => c2 !== c && cx(c2.para.b) >= gb.x0 - 1 && cx(c2.para.b) <= gb.x1 + 1 && cy(c2.para.b) >= gb.y0 - 1 && cy(c2.para.b) <= gb.y1 + 1);
      const areaCap = (g) => (g.area < 22000 ? 1.05 : (clusters.length === 1 ? 0.45 : 0.55)) * S.w * S.h;
      const cands = G.filter((x) => !x.used && x.g.kind !== 'image' && (x.g.fill || x.g.stroke)
        && x.g.area < areaCap(x.g)
        && cx(cb) >= x.g.b.x0 && cx(cb) <= x.g.b.x1 && cy(cb) >= x.g.b.y0 && cy(cb) <= x.g.b.y1
        && x.g.b.x0 <= cb.x0 + 4 && x.g.b.x1 >= cb.x1 - 4 && x.g.b.y0 <= cb.y0 + 6 && x.g.b.y1 >= cb.y1 - 6
        && enclosesOnlyMe(x.g.b))
        .sort((a, b) => a.g.area - b.g.area);
      const g0 = cands[0];
      if (!g0) continue;
      const matched = G.filter((cg) => !cg.used && cg.g.kind !== 'image' && cg.g.area <= g0.g.area * 1.25 && boxIn(g0.g.b, cg.g.b, 3) && enclosesOnlyMe(cg.g.b));
      matched.forEach((m) => { m.used = true; });
      c._keepGfx = matched.map((m) => m.i);
      const isWhite = (c0) => c0 && c0[0] > 240 && c0[1] > 240 && c0[2] > 240;
      const diffRgb = (a, b) => !a || !b || (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) > 45;
      c._hasBorder = matched.some((m) => !!m.g.stroke && !isWhite(m.g.item?.strokeRgb) && diffRgb(m.g.item?.strokeRgb, m.g.fill ? m.g.item?.fillRgb : g0.g.item?.fillRgb));
      let ub = { ...g0.g.b };
      for (const m of matched) ub = union(ub, m.g.b);
      c._boxRect = ub;
    }
    // bind each badge's small box graphic (+ any adjacent empty checkbox) directly to its badge text
    for (const c of clusters.filter((c2) => c2.badge)) {
      const cb = c.para.b;
      const cands = G.filter((x) => !x.used && x.g.kind !== 'image' && (x.g.fill || x.g.stroke)
        && x.g.area < 14 * c.para.size * c.para.size
        && x.g.b.x0 <= cb.x0 + 2 && x.g.b.x1 >= cb.x1 - 2 && x.g.b.y0 <= cb.y0 + 2 && x.g.b.y1 >= cb.y1 - 2)
        .sort((a, b) => a.g.area - b.g.area);
      const g0 = cands[0];
      if (!g0) continue;
      const matched = G.filter((cg) => !cg.used && cg.g.kind !== 'image' && cg.g.area <= g0.g.area * 1.2 && boxIn(g0.g.b, cg.g.b, 2));
      matched.forEach((m) => { m.used = true; });
      let badgeUb = { ...g0.g.b };
      for (const m of matched) badgeUb = union(badgeUb, m.g.b);
      c._badgeBox = badgeUb;
      // also attach an adjacent small empty checkbox right beside the badge
      const bw = badgeUb.x1 - badgeUb.x0, bh = badgeUb.y1 - badgeUb.y0;
      const adj = G.filter((cg) => !cg.used && cg.g.kind !== 'image' && (cg.g.fill || cg.g.stroke)
        && cg.g.area < 2.8 * g0.g.area && cg.g.area < 14 * c.para.size * c.para.size
        && Math.min(cg.g.b.y1, badgeUb.y1) - Math.max(cg.g.b.y0, badgeUb.y0) > 0.5 * Math.min(bh, cg.g.b.y1 - cg.g.b.y0)
        && ((cg.g.b.x0 >= badgeUb.x1 - 2 && cg.g.b.x0 - badgeUb.x1 <= Math.max(12, bw * 1.1))
          || (cg.g.b.x1 <= badgeUb.x0 + 2 && badgeUb.x0 - cg.g.b.x1 <= Math.max(12, bw * 1.1)))
        && !lines.some((l) => l.glyphs.some((g) => !g.space && inR({ x: cg.g.b.x0, y: cg.g.b.y0, w: cg.g.b.x1 - cg.g.b.x0, h: cg.g.b.y1 - cg.g.b.y0 }, cx(g.b), cy(g.b), 0.5))));
      for (const a of adj) {
        const adjGroup = G.filter((cg) => !cg.used && cg.g.kind !== 'image' && cg.g.area <= a.g.area * 1.2 && boxIn(a.g.b, cg.g.b, 2));
        for (const m of adjGroup) { m.used = true; matched.push(m); }
      }
      c._keepGfx = matched.map((m) => m.i);
      let ub = { ...badgeUb };
      for (const m of matched) ub = union(ub, m.g.b);
      c._boxRect = ub;
    }
  }
  // everything else that is not text or a photo — frames, colour bands, highlights,
  // shadows, small label / score boxes, lines — is ONE graphic unit (the block's
  // template): it moves and scales as a whole and the text sits on top of it
  const rest = G.filter((x) => !x.used);
  const boxes = [];
  if (rest.length) {
    // Split any distinct lower/inset panel (e.g., white option box inside green dialogue box)
    // into its own deco unit so it moves together with its own text when upper text shrinks/grows.
    const bigFills = rest.filter((x) => x.g.fill && x.g.kind === 'path' && x.g.area >= SMALL).sort((a, b) => b.g.area - a.g.area);
    const outer = bigFills[0];
    const inset = outer && bigFills.find((x) => x !== outer && (x.g.b.y1 - x.g.b.y0) > 38 && x.g.area < outer.g.area * 0.72 && x.g.b.y0 > outer.g.b.y0 + 20 && x.g.b.x0 >= outer.g.b.x0 - 4 && x.g.b.x1 <= outer.g.b.x1 + 4);
    const insetSet = new Set();
    if (inset) {
      for (const x of rest) {
        if (x === inset || (x.g.area <= inset.g.area * 1.15 && boxIn(inset.g.b, x.g.b, 3))) insetSet.add(x);
      }
    }
    let outerItems = rest.filter((x) => !insetSet.has(x));
    const emitUnit = (items) => {
      if (!items.length) return;
      let bx = null; items.forEach((x) => { bx = union(bx, x.g.b); }); items.forEach((x) => { x.used = true; });
      const big = items.filter((x) => x.g.fill && x.g.kind === 'path' && x.g.area >= SMALL);
      const outline = (x) => big.length === 1 && !x.g.fill && x.g.stroke && ['x0', 'y0', 'x1', 'y1'].every((k2) => Math.abs(x.g.b[k2] - big[0].g.b[k2]) < 2);
      const plainPanel = big.length === 1 && items.every((x) => x === big[0] || outline(x));
      mk(plainPanel ? 'bg' : 'deco', bx, items.map((x) => x.i), [], plainPanel ? {} : { unit: true });
    };
    const isGridTable = clusters.some((c) => c.cell && c.cell.gridRow != null);
    let didRowCardSplit = false;
    if (!isGfxObj && !isGridTable) {
      const outerStrokes = outer ? rest.filter((x) => x !== outer && !x.g.fill && x.g.stroke && ['x0', 'y0', 'x1', 'y1'].every((k2) => Math.abs(x.g.b[k2] - outer.g.b[k2]) < 2.5)) : [];
      const outerSet = new Set(outer ? [outer, ...outerStrokes] : []);
      const hasGlyphInside = (b) => lines.some((l) => l.glyphs.some((g) => !g.space && !permRm.has(g.idx) && (g.uni || '').trim()
        && cx(g.b) > b.x0 + 1 && cx(g.b) < b.x1 - 1 && cy(g.b) > b.y0 + 1 && cy(g.b) < b.y1 - 1));
      const pool = rest.filter((x) => !outerSet.has(x) && !insetSet.has(x) && x.g.kind === 'path' && (x.g.fill || x.g.stroke)
        && (!outer || boxIn(outer.g.b, x.g.b, 4)) && !hasGlyphInside(x.g.b));
      const boxAreaOf = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
      const iouOf = (a, b) => {
        const ix0 = Math.max(a.x0, b.x0), iy0 = Math.max(a.y0, b.y0);
        const ix1 = Math.min(a.x1, b.x1), iy1 = Math.min(a.y1, b.y1);
        const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
        const uni = boxAreaOf(a) + boxAreaOf(b) - inter;
        return uni > 0 ? inter / uni : 0;
      };
      const shapeGroups = [];
      for (const x of pool.slice().sort((a, b) => b.g.area - a.g.area)) {
        const grp = shapeGroups.find((g) => g.items.length < 4
          && ((boxIn(g.b, x.g.b, 3) && x.g.area >= boxAreaOf(g.b) * 0.45) || iouOf(g.b, x.g.b) >= 0.65));
        if (grp) { grp.items.push(x); grp.b = union(grp.b, x.g.b); }
        else shapeGroups.push({ items: [x], b: { ...x.g.b } });
      }
      const refW = outer ? (outer.g.b.x1 - outer.g.b.x0) : S.w;
      const barCands = shapeGroups.filter((g) => {
        const w = g.b.x1 - g.b.x0, h = g.b.y1 - g.b.y0;
        return g.items.length <= 4 && w >= Math.max(45, refW * 0.30) && h >= 3 && h <= 28 && w / h >= 3.2;
      });
      const barClusters = [];
      for (const g of barCands) {
        const w = g.b.x1 - g.b.x0;
        let cl = barClusters.find((c) => Math.abs(c.x0 - g.b.x0) <= 14 && Math.abs(c.w - w) <= 0.25 * Math.max(c.w, w));
        if (!cl) { cl = { x0: g.b.x0, w, items: [] }; barClusters.push(cl); }
        cl.items.push(g);
        cl.x0 = cl.items.reduce((s, q) => s + q.b.x0, 0) / cl.items.length;
        cl.w = cl.items.reduce((s, q) => s + (q.b.x1 - q.b.x0), 0) / cl.items.length;
      }
      const answerBars = [];
      for (const cl of barClusters) {
        const sorted = cl.items.slice().sort((a, b) => a.b.y0 - b.b.y0);
        const nonOv = [];
        for (const g of sorted) {
          if (!nonOv.length || g.b.y0 >= nonOv[nonOv.length - 1].b.y1 - 2) nonOv.push(g);
        }
        if (nonOv.length >= 2) answerBars.push(...nonOv);
      }
      const barSet = new Set(answerBars);
      const boxCands = shapeGroups.filter((g) => {
        const w = g.b.x1 - g.b.x0, h = g.b.y1 - g.b.y0;
        return !barSet.has(g) && g.items.length <= 4 && w >= 6 && w <= Math.max(72, refW * 0.25)
          && h >= 6 && h <= 45 && w / h <= 3.5 && h / w <= 2.5;
      });
      const boxClusters = [];
      for (const g of boxCands) {
        const w = g.b.x1 - g.b.x0, h = g.b.y1 - g.b.y0, cxg = cx(g.b);
        let cl = boxClusters.find((c) => Math.abs(c.cx - cxg) <= 10
          && Math.abs(c.w - w) <= 0.35 * Math.max(c.w, w)
          && Math.abs(c.h - h) <= 0.35 * Math.max(c.h, h));
        if (!cl) { cl = { cx: cxg, w, h, items: [] }; boxClusters.push(cl); }
        cl.items.push(g);
        const n = cl.items.length;
        cl.cx = cl.items.reduce((s, q) => s + cx(q.b), 0) / n;
        cl.w = cl.items.reduce((s, q) => s + (q.b.x1 - q.b.x0), 0) / n;
        cl.h = cl.items.reduce((s, q) => s + (q.b.y1 - q.b.y0), 0) / n;
      }
      const textClusters = clusters.filter((c) => !c.badge && !(c.cell && c.cell.gridRow != null));
      const sideBoxes = [];
      for (const cl of boxClusters) {
        const sorted = cl.items.slice().sort((a, b) => a.b.y0 - b.b.y0);
        const nonOv = [];
        for (const g of sorted) {
          if (!nonOv.length || g.b.y0 >= nonOv[nonOv.length - 1].b.y1 - 2) nonOv.push(g);
        }
        if (nonOv.length < 2) continue;
        const colMinY = nonOv[0].b.y0, colMaxY = nonOv[nonOv.length - 1].b.y1;
        const bandTexts = textClusters.filter((c) => c.para.b.y1 >= colMinY - 12 && c.para.b.y0 <= colMaxY + 12);
        const refTexts = bandTexts.length >= 2 ? bandTexts : textClusters;
        const tMinX = refTexts.length ? Math.min(...refTexts.map((c) => c.para.b.x0)) : S.x;
        const tMaxX = refTexts.length ? Math.max(...refTexts.map((c) => c.para.b.x1)) : S.x + S.w;
        const tMidX = (tMinX + tMaxX) * 0.5;
        if (refTexts.length >= 2) {
          const colMinX = Math.min(...nonOv.map((g) => g.b.x0));
          const colMaxX = Math.max(...nonOv.map((g) => g.b.x1));
          const sitsRight = colMinX >= tMaxX - 6 && colMinX >= tMinX + 20;
          const sitsLeft = colMaxX <= tMinX + 8 && colMaxX <= tMaxX - 20;
          if (!sitsRight && !sitsLeft) continue;
          const nearCount = nonOv.filter((g) => {
            const cyG = cy(g.b);
            return refTexts.some((c) => (g.b.y0 <= c.para.b.y1 + 2 && g.b.y1 >= c.para.b.y0 - 2) || Math.abs(cyG - cy(c.para.b)) <= 24);
          }).length;
          if (nearCount < 2) continue;
        }
        const edge = cl.cx >= tMidX ? 'right' : 'left';
        for (const g of nonOv) sideBoxes.push({ ...g, sideEdge: edge });
      }
      if (answerBars.length >= 2 || sideBoxes.length >= 2) {
        didRowCardSplit = true;
        const extractedSet = new Set();
        for (const bar of answerBars) for (const x of bar.items) extractedSet.add(x);
        for (const box of sideBoxes) for (const x of box.items) extractedSet.add(x);
        outerItems = rest.filter((x) => !insetSet.has(x) && !extractedSet.has(x));
        emitUnit(outerItems);
        emitUnit([...insetSet]);
        for (const bar of answerBars) {
          bar.items.forEach((x) => { x.used = true; });
          mk('deco', bar.b, bar.items.map((x) => x.i), [], { rowRole: 'answerBar' });
        }
        for (const box of sideBoxes) {
          box.items.forEach((x) => { x.used = true; });
          mk('deco', box.b, box.items.map((x) => x.i), [], { rowRole: 'sideBox', sideEdge: box.sideEdge });
        }
      }
    }
    if (!didRowCardSplit) {
      emitUnit(outerItems);
      emitUnit([...insetSet]);
    }
  }
  if (isGfxObj) {
    if (p.edit && out.length) {
      out[0].edit = JSON.parse(JSON.stringify(p.edit));
      out[0].dw = p.dw;
      out[0].dh = p.dh;
      out[0].w = p.dw * k;
      out[0].h = p.dh * k;
    }
    return out;
  }
  // text
  const inBox = (x) => boxes.find((o) => inR(o.src, cx(x.b), cy(x.b), 0.3));
  // glyphs on a label box go with the box
  for (const l of lines) for (const x of l.glyphs) { if (!glyphOk(x) || removed.has(x.idx)) continue; const o = inBox(x); if (o) o.keepG.push(x.idx); }
  if (p.edit) {
    // an already edited text stays one object with its edit
    const keepG = [];
    for (const l of lines) for (const x of l.glyphs) if (glyphOk(x) && !inBox(x)) keepG.push(x.idx);
    mk('text', srcB, p.keep ? p.keep.slice() : [], keepG, { edit: JSON.parse(JSON.stringify(p.edit)), removedG: p.removedG ? p.removedG.slice() : [], dw: p.dw, dh: p.dh, w: p.dw * k, h: p.dh * k, badge: !!p.badge, hasBorder: !!p.hasBorder, cell: p.cell ? { ...p.cell } : null, cellRight: p.cellRight || 0, container: p.container ? { ...p.container } : null });
    return out;
  }
  const taken = new Set();
  for (const c of clusters) {
    const keepG = []; let bx = null;
    for (const l of c.para.lines) for (const x of l.glyphs) {
      if (!glyphOk(x) || inBox(x) || taken.has(x.idx)) continue;
      keepG.push(x.idx); taken.add(x.idx); if (!x.space) bx = union(bx, x.b);
    }
    if (!keepG.length || !bx) continue;
    const cBox = c._badgeBox || c._boxRect || (c.container && c.container.b) || null;
    const srcBox = c._boxRect || cBox;
    const extra = { badge: !!c.badge, hasBorder: !!c._hasBorder, ...(c.cell ? { cell: { ...c.cell }, cellRight: c.cellRight || 0 } : {}), ...(cBox ? { container: { ...cBox } } : {}) };
    const padBx = { x0: bx.x0 - 1, y0: bx.y0 - 1, x1: bx.x1 + 1, y1: bx.y1 + 1 };
    // a panel shared by several text clusters (list rows on one template) must not become the box of each row
    const sharedPanel = !!cBox && !c._boxRect && clusters.filter((c2) => !c2.badge && c2.container && c2.container.b === c.container.b).length > 1;
    const isGridCell = !!(c.cell && c.cell.gridRow != null);
    const srcBx = srcBox && !sharedPanel && !isGridCell && (c.badge || c.para.lines.length === 1 || c._keepGfx) ? union(padBx, srcBox) : padBx;
    mk('text', srcBx, c._keepGfx || [], keepG, extra);
  }
  // any other text line (badge numbers outside boxes, dotted lines...)
  for (const l of lines) {
    const keepG = []; let bx = null;
    for (const x of l.glyphs) if (glyphOk(x) && !inBox(x) && !taken.has(x.idx)) { keepG.push(x.idx); taken.add(x.idx); if (!x.space) bx = union(bx, x.b); }
    if (keepG.length && bx) mk('text', { x0: bx.x0 - 1, y0: bx.y0 - 1, x1: bx.x1 + 1, y1: bx.y1 + 1 }, [], keepG);
  }
  // covered ("Gizle") text lines: keep an empty editable placeholder so user can re-type there in Düzenle
  const covers = (p.erase || []).filter((e) => e.fill);
  if (covers.length) {
    for (const l of lines) {
      const coveredGs = l.glyphs.filter((x) => !x.invisible && !permRm.has(x.idx) && !taken.has(x.idx) && covers.some((e) => inR(e, cx(x.b), cy(x.b))));
      const ink = coveredGs.filter((x) => !x.space);
      if (!ink.length) continue;
      let bx = null;
      for (const x of ink) { taken.add(x.idx); bx = union(bx, x.b); }
      if (bx) mk('text', { x0: bx.x0 - 1, y0: bx.y0 - 1, x1: bx.x1 + 1, y1: bx.y1 + 1 }, [], [], {
        addedText: true, refGlyphIdx: ink[0].idx, fontSize: l.size || 11, baseW: Math.max(24, bx.x1 - bx.x0),
      });
    }
  }
  return out;
}

// object -> block part (block at X0,Y0 with s = 1)
export function objToPart(o, X0, Y0) {
  if (o.type === 'img') {
    const w = o.w, h = o.h;
    const imgMeta = { ...dehydrateImg(o.img), iw: w, ih: h, aspect: h / w, caption: o.img.caption || '', capSize: o.img.capSize || 0 };
    if (o.placeholder || (o.img && o.img.placeholder)) imgMeta.placeholder = true;
    else delete imgMeta.placeholder;
    return { id: ops.newId('p'), kind: 'insimg', src: null, editable: false,
      img: imgMeta, dx: o.x - X0, dy: o.y - Y0, dw: w, dh: h, sc: 1,
      ...(o.ocrPatch ? { inline: true, ocrPatch: true, ...(o.ocrGroup ? { ocrGroup: o.ocrGroup } : {}) } : (o.inline ? { inline: true } : {})) };
  }
  const part = { id: ops.newId('p'), kind: 'obj', obj: o.type, src: { ...o.src }, full: { ...o.full }, keep: o.keep.slice(), keepG: o.keepG.slice(), editable: o.type === 'text' || o.type === 'box', dx: o.x - X0, dy: o.y - Y0 };
  if (o.bgMode) part.bgMode = o.bgMode;
  if (o.edit) part.edit = o.edit;
  if (o.removedG && o.removedG.length) part.removedG = o.removedG.slice();
  if (o.badge) part.badge = true;
  if (o.badgeBaseline != null) part.badgeBaseline = o.badgeBaseline;
  if (o.hasBorder) part.hasBorder = true;
  if (o.addedText) {
    part.addedText = true; part.refGlyphIdx = o.refGlyphIdx; part.fontSize = o.fontSize; part.baseW = o.baseW;
    if (o.ocrBgHex) part.ocrBgHex = o.ocrBgHex;
    if (o.ocr) {
      part.ocr = true;
      if (o.ocrGroup) part.ocrGroup = o.ocrGroup;
      if (o.ocrPatchFlat) part.ocrPatchFlat = true;
      if (o.origLines) part.origLines = o.origLines;
      if (o.lineStep) part.lineStep = o.lineStep;
    }
  }
  if (o.addedTable) part.addedTable = true;
  if (o.cell) part.cell = { ...o.cell };
  if (o.cellRight) part.cellRight = o.cellRight;
  if (o.container) part.container = { ...o.container };
  if (o.rowRole) part.rowRole = o.rowRole;
  if (o.sideEdge) part.sideEdge = o.sideEdge;
  if (o.erase && o.erase.length) part.erase = o.erase.map((e) => ({ ...e }));
  if (o.clip) part.clip = { ...o.clip };
  if (o.nine) { part.nine = { ...o.nine }; part.dw = o.nine.w; part.dh = o.nine.h; part.sc = o.w / o.nine.w; }
  else { part.dw = o.dw; part.dh = o.dh; part.sc = o.w / o.dw; }
  return part;
}

// Replace the edited blocks by one block made of the objects, then make it fit
// its old slot (place / push the blocks below down / shrink). Inside a commit.
export function applyObjects(page, ctx, objects) {
  const keep = objects.filter((o) => !o.deleted);
  const old = ctx.ids.map((id) => ops.findBlock(page, id)).filter(Boolean);
  const idx = old.length ? Math.min(...old.map((b) => page.blocks.indexOf(b))) : page.blocks.length;
  // the original content is gone from the page under the old blocks
  page.deleted = page.deleted || [];
  for (const b of old) {
    if (b.from !== undefined && b.from !== null) continue;
    for (const p of b.parts) if (p.src && !p.obj) page.deleted.push({ ...p.src, mode: 'natural' });
    for (const p of b.parts) if (p.obj && !p.addedText && !p.addedTable) page.deleted.push({ ...(p.full || p.src), mode: 'natural' });
  }
  page.blocks = page.blocks.filter((b) => !ctx.ids.includes(b.id));
  if (!keep.length) return { id: null, how: 'deleted' };
  const X0 = Math.min(...keep.map((o) => o.x)), Y0 = Math.min(...keep.map((o) => o.y));
  const from = (old[0] && old[0].from !== undefined && old[0].from !== null) ? old[0].from : (page.srcIndex === null && ctx.si !== null && ctx.si !== undefined ? ctx.si : undefined);
  const nb = ops.recalcBlock({ id: ops.newId('b'), kind: 'group', x: X0, y: Y0, s: 1, bw: 0, bh: 0, parts: keep.map((o) => objToPart(o, X0, Y0)) });
  if (from !== undefined && from !== null) nb.from = from;
  if (!old.length) return nb;
  if (old.every((b) => b.free)) {
    nb.free = true;
    page.blocks.splice(Math.max(0, idx), 0, nb);
    return { id: nb.id, how: 'placed' };
  }
  page.blocks.splice(Math.max(0, idx), 0, nb);
  const how = fitBack(page, nb, ctx.R);
  return { id: nb.id, how };
}
