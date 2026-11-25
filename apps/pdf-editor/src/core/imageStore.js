// Session-level picture store. Inserted / replaced pictures (data URLs, often
// megabytes) live here ONCE, keyed by a content hash; the block model, the undo
// history and autosave snapshots only carry the short id (img.imgId, img.rawId,
// inserted.imgId). Identical pictures share one entry.
function hash53(str) {
  let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export class ImageStore {
  constructor(entries) { this.map = new Map(entries || []); }
  put(dataUrl) {
    if (!dataUrl) return null;
    let id = 'im' + hash53(dataUrl) + '_' + dataUrl.length.toString(36);
    let n = 0;
    while (this.map.has(id) && this.map.get(id) !== dataUrl) id = id.replace(/~\d+$/, '') + '~' + (++n); // hash collision
    if (!this.map.has(id)) this.map.set(id, dataUrl);
    return id;
  }
  get(id) { return id ? this.map.get(id) || '' : ''; }
  has(id) { return this.map.has(id); }
  entries(ids) { return [...this.map].filter(([k]) => !ids || ids.has(k)); }
  clear() { this.map.clear(); }
}

let active = new ImageStore();
export function useImageStore(store) { active = store || new ImageStore(); return active; }
export function imageStore() { return active; }
export const putImage = (dataUrl) => active.put(dataUrl);
export const getImage = (id) => active.get(id);

// picture source for any img-like object (inline data URL wins, old data)
export function imgSrc(o) { return (o && (o.dataUrl || (o.imgId && active.get(o.imgId)))) || ''; }
export function rawImgSrc(o) { return (o && (o.rawDataUrl || (o.rawId && active.get(o.rawId)))) || ''; }

// model form: ids only
export function dehydrateImg(img) {
  if (!img) return img;
  const o = { ...img };
  if (o.dataUrl) { o.imgId = active.put(o.dataUrl); }
  if (o.rawDataUrl) { o.rawId = active.put(o.rawDataUrl); }
  delete o.dataUrl; delete o.rawDataUrl;
  return o;
}
// editor form: data URLs filled in (ids kept)
export function hydrateImg(img) {
  if (!img) return img;
  const o = { ...img };
  if (!o.dataUrl && o.imgId) o.dataUrl = active.get(o.imgId);
  if (!o.rawDataUrl && o.rawId) o.rawDataUrl = active.get(o.rawId);
  return o;
}

// walk blocks in place: move every inline data URL into the store.
// Returns true when something was moved (old saved data / editor output).
export function dehydrateBlocks(blocks) {
  if (!Array.isArray(blocks)) return false;
  let moved = false;
  for (const b of blocks) {
    if (!b) continue;
    if (b.inserted && b.inserted.type === 'image' && b.inserted.dataUrl) { b.inserted = dehydrateImg(b.inserted); moved = true; }
    if (Array.isArray(b.parts)) for (const p of b.parts) {
      if (p && p.img && (p.img.dataUrl || p.img.rawDataUrl)) { p.img = dehydrateImg(p.img); moved = true; }
    }
  }
  return moved;
}
export function dehydratePage(p) {
  if (!p) return false;
  const a = dehydrateBlocks(p.blocks);
  const b = p.initial ? dehydrateBlocks(p.initial.blocks) : false;
  return a || b;
}

// ids referenced by blocks (pages + their initial state)
export function collectImageIds(pages, out = new Set()) {
  const add = (blocks) => {
    for (const b of blocks || []) {
      if (b.inserted && b.inserted.imgId) out.add(b.inserted.imgId);
      for (const p of b.parts || []) if (p.img) { if (p.img.imgId) out.add(p.img.imgId); if (p.img.rawId) out.add(p.img.rawId); }
    }
  };
  for (const p of pages || []) { add(p.blocks); if (p.initial) add(p.initial.blocks); }
  return out;
}
