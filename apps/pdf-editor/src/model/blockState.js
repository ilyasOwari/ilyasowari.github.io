// Pure helpers describing the state of blocks and parts.
// a block that was moved here from another page keeps its source page in `from`
export function isForeign(block) { return block.from !== undefined && block.from !== null; }
export function srcIndexOf(page, block) { return isForeign(block) ? block.from : page.srcIndex; }
export function fallbackSrcIndex(session, page) {
  if (page && page.srcIndex !== null && page.srcIndex !== undefined) return page.srcIndex;
  const origPg = ((session && session.pages) || []).find((pg) => pg.srcIndex !== null && pg.srcIndex !== undefined);
  if (origPg) return origPg.srcIndex;
  return session && session.workDoc && session.workDoc.getPageCount && session.workDoc.getPageCount() > 0 ? 0 : null;
}
export function isPartIdentity(block, part) {
  if (!part.src || isForeign(block)) return false;
  const s = (block.s || 1) * (part.sc || 1);
  return Math.abs(s - 1) < 1e-6
    && Math.abs(block.x + part.dx * (block.s || 1) - part.src.x) < 0.01
    && Math.abs(block.y + part.dy * (block.s || 1) - part.src.y) < 0.01;
}
export function isPartChanged(block, part) {
  return !isPartIdentity(block, part) || !!part.edit || !!part.bgMode || !!(part.erase && part.erase.length) || !!(part.removedG && part.removedG.length) || !!part.cut || !!part.clip || !!part.obj || !!part.tp || !!block.free || !!block.box;
}
// needs a rendered preview (cannot be shown as a crop of the page raster)
export function partNeedsPreview(part, block) {
  if (!part.src) return false;
  return (block && (isForeign(block) || block.free)) || !!part.edit || !!part.bgMode || !!(part.erase && part.erase.length) || !!(part.removedG && part.removedG.length) || !!part.cut || !!part.clip || !!part.obj || !!part.tp;
}
export function partDestRect(block, part) {
  const bs = block.s || 1;
  const s = bs * (part.sc || 1);
  return { x: block.x + part.dx * bs, y: block.y + part.dy * bs, w: part.dw * s, h: part.dh * s };
}
// drawn without its own background (layered over what is below it)
export const partTransparent = (part, block) => !!part.obj || !!part.tp || !!part.clip || !!(block && block.free) || !!(part.erase && part.erase.some((r) => r.clear));
