// Asset loading that works both in the browser (fetch) and in Node tests (fs).
const BASE = (() => {
  try { return new URL('../../', import.meta.url); } catch (e) { return null; }
})();
const cache = new Map();
export async function loadBytes(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const p = (async () => {
    const url = new URL(rel, BASE);
    if (typeof window === 'undefined' && url.protocol === 'file:') {
      const fs = await import('node:fs');
      return new Uint8Array(fs.readFileSync(url));
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`asset ${rel}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  })();
  cache.set(rel, p);
  return p;
}
export async function loadJson(rel) {
  const b = await loadBytes(rel);
  return JSON.parse(new TextDecoder().decode(b));
}
