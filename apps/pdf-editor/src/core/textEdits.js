// Block text editing: every text group of a block (paragraphs, single rows,
// badge numbers) is opened together and written back in place, group by group.
import * as ops from '../model/blockOps.js';
import { hydrateImg, dehydrateImg } from './imageStore.js';
import { openAllModels, applyTextEdit } from '../engines/text/editSession.js';
import { partDestRect, srcIndexOf } from '../model/blockState.js';
import { rectsOverlap } from './geometry.js';
import { layoutImages } from './imageLayout.js';

export function openBlockText(session, page, blockId) {
  const b = ops.findBlock(page, blockId);
  if (!b) return null;
  const si = srcIndexOf(page, b);
  if (si === null || si === undefined) return null;
  const an = session.analysis(si);
  const sections = [];
  for (const p of b.parts) {
    if (p.editable === false || p.decor || !p.src) continue;
    const models = openAllModels(an, p);
    const mainKey = (models.find((m) => !m.badge) || {}).clusterKey;
    const d = partDestRect(b, p), k = d.w / p.src.w;
    for (const m of models) {
      const images = b.parts.filter((q) => q.kind === 'insimg' && q.forPart === p.id && (q.forKey || mainKey) === m.clusterKey).map((q) => hydrateImg(q.img));
      sections.push({ partId: p.id, model: m, images, badge: m.badge, y: d.y + (m.area.top - p.src.y) * k, x: d.x + (m.area.left - p.src.x) * k });
    }
  }
  if (!sections.length) return null;
  sections.sort((a, c) => (Math.abs(a.y - c.y) < 4 ? a.x - c.x : a.y - c.y));
  return { page, blockId, an, sections };
}

const sameImgs = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

// results[i] = { paras, imgs } for ctx.sections[i]
export async function applyBlockText(controller, ctx, results) {
  const { page, blockId, an } = ctx;
  const block = ops.findBlock(page, blockId);
  if (!block) throw new Error('block gone');
  const perPart = new Map();
  ctx.sections.forEach((s, i) => { if (!perPart.has(s.partId)) perPart.set(s.partId, []); perPart.get(s.partId).push({ s, r: results[i] }); });
  const updates = [];
  const warnings = [];
  for (const [partId, items] of perPart) {
    const part = block.parts.find((p) => p.id === partId);
    if (!part) continue;
    let dx = 0, dy = 0, cutX = null, oldBottom = null;
    const fits = (dw, dh) => {
      const probe = structuredClone(block);
      const pp = probe.parts.find((p) => p.id === partId);
      pp.dw = dw; pp.dh = dh;
      ops.recalcBlock(probe);
      const r = partDestRect(probe, pp);
      if (r.x + r.w > page.w + 0.05 || r.y + r.h > page.h + 0.05) return false;
      for (const o of page.blocks) {
        if (o.id === block.id) continue;
        for (const q of ops.blockRects(o)) if (rectsOverlap(r, q, 0.05)) return false;
      }
      const cur = partDestRect(block, part);
      for (const q of probe.parts) if (q.id !== pp.id && q.kind !== 'insimg' && rectsOverlap(r, partDestRect(probe, q), 0.05) && !rectsOverlap(cur, partDestRect(probe, q), 0.05)) return false;
      return true;
    };
    const subs = [], placedAll = [];
    let any = false;
    for (const { s, r } of items) {
      const m = s.model;
      const newText = r.paras.map((p) => p.text).join('\n');
      const unchanged = newText === m.text && JSON.stringify(r.paras.map((p) => [!!p.marker, p.st || []])) === JSON.stringify(m.paras.map((p) => [!!p.marker, p.st || []])) && sameImgs(r.imgs, s.images);
      if (unchanged && !m.prevEdit) continue;
      any = true;
      if (unchanged && m.prevEdit) { subs.push(m.prevEdit); keepGrowth(m.prevEdit); continue; }
      const { area, placed } = layoutImages(m, r.imgs || []);
      const canGrow = m.isLast ? (d) => fits(part.src.w + dx, part.src.h + d) : () => false;
      const canGrowX = s.badge ? null : (d) => fits(part.src.w + Math.max(dx, d), part.src.h + dy);
      const res = await applyTextEdit({ an, part, model: { ...m, area }, paras: r.paras, avail: controller.s.avail, canGrow, canGrowX });
      warnings.push(...res.warnings);
      subs.push(res.edit);
      keepGrowth(res.edit);
      placed.forEach((im) => placedAll.push({ im, key: m.clusterKey }));
    }
    function keepGrowth(e) {
      if (e.delta && Math.abs(e.delta) > 0.01) { dy = e.delta; oldBottom = e.oldBottom; }
      if (e.deltaX && e.deltaX > dx) { dx = e.deltaX; cutX = e.cutX; }
    }
    if (!any) continue;
    const merged = subs.length ? {
      clusters: subs, removeGlyphs: subs.flatMap((e) => e.removeGlyphs), runs: subs.flatMap((e) => e.runs), marks: subs.flatMap((e) => e.marks || []), dropGfx: subs.flatMap((e) => e.dropGfx || []), dropBoxes: subs.flatMap((e) => e.dropBoxes || []),
      delta: dy, oldBottom, deltaX: dx, cutX, k: 1,
    } : null;
    // images of untouched groups stay as they are
    const keepImgs = block.parts.filter((q) => q.kind === 'insimg' && q.forPart === partId && !items.some(({ s, r }) => (q.forKey || s.model.clusterKey) === s.model.clusterKey && !sameImgs(r.imgs, s.images)));
    updates.push({ partId, edit: merged, dh: part.src.h + dy, dw: part.src.w + dx, placed: placedAll, keepImgIds: new Set(keepImgs.map((q) => q.id)) });
  }
  if (!updates.length) return { warnings };
  controller.commit(page, 'text', (p) => {
    const b = ops.findBlock(p, blockId);
    for (const u of updates) {
      const pt = b.parts.find((q) => q.id === u.partId);
      pt.edit = u.edit; pt.dh = u.dh; pt.dw = u.dw;
      const tsc = pt.sc || 1;
      const replacedKeys = new Set(u.placed.map((x) => x.key));
      b.parts = b.parts.filter((q) => !(q.kind === 'insimg' && q.forPart === pt.id && (!u.keepImgIds.has(q.id) || replacedKeys.has(q.forKey))));
      for (const { im, key } of u.placed) {
        b.parts.push({
          id: ops.newId('p'), kind: 'insimg', forPart: pt.id, forKey: key, src: null, editable: false,
          img: { ...dehydrateImg({ dataUrl: im.dataUrl, imgId: im.imgId }), caption: im.caption, capSize: im.capSize, anchor: im.anchor, wrap: im.wrap, width: im.width, aspect: im.aspect, iw: im.iw, ih: im.ih },
          dx: pt.dx + (im.x - pt.src.x) * tsc, dy: pt.dy + (im.y - pt.src.y) * tsc, dw: im.iw, dh: im.ih + im.capH, sc: tsc,
        });
      }
    }
    ops.recalcBlock(b);
    return true;
  });
  return { warnings };
}
