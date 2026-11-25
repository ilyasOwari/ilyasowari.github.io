// What the page shows right now (base + blocks), for a region: used by the
// magnifier and by "Gizle" to read the surrounding colours.
// `base` may be a sharper raster of the same page (OCR renders one at its own
// resolution instead of stretching the on-screen one).
export function composeRegion(view, rect, px, base = view.base) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(rect.w * px)); c.height = Math.max(1, Math.round(rect.h * px));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  const sc = base.width / view.page.w; // base raster px per pt
  if (base.width) g.drawImage(base, rect.x * sc, rect.y * sc, rect.w * sc, rect.h * sc, 0, 0, c.width, c.height);
  const z = view.z;
  const order = view.page.blocks.filter((b) => b.free && b.behind)
    .concat(view.page.blocks.filter((b) => !b.free), view.page.blocks.filter((b) => b.free && !b.behind));
  for (const b of order) {
    const rec = view.blockEls.get(b.id); if (!rec) continue;
    for (const cv of rec.el.querySelectorAll('canvas,img')) {
      const l = b.x + (parseFloat(cv.style.left) || 0) / z, t = b.y + (parseFloat(cv.style.top) || 0) / z;
      const w = cv.style.width && cv.style.width.endsWith('px') ? parseFloat(cv.style.width) / z : (b.bw * (b.s || 1));
      const hh = cv.style.height && cv.style.height.endsWith('px') ? parseFloat(cv.style.height) / z : (b.bh * (b.s || 1));
      if (l > rect.x + rect.w || t > rect.y + rect.h || l + w < rect.x || t + hh < rect.y) continue;
      try { g.drawImage(cv, (l - rect.x) * px, (t - rect.y) * px, w * px, hh * px); } catch { /* not ready */ }
    }
  }
  return c;
}

// dominant colour along each edge of a rect (a few px inside it) -> fill spec
// { type: 'solid', c } or { type: 'lin', dir: 'v'|'h', c0, c1 }
export function edgeFill(view, rect) {
  const px = Math.max(1, Math.min(3, 600 / Math.max(rect.w, rect.h)));
  const c = composeRegion(view, rect, px);
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const d = g.getImageData(0, 0, W, H).data;
  const at = (x, y) => { const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const inset = Math.min(2, Math.floor(Math.min(W, H) / 4));
  const dominant = (pts) => {
    const m = new Map();
    for (const p of pts) { const k = p.map((v) => v >> 3).join(','); const e = m.get(k) || { n: 0, s: [0, 0, 0] }; e.n++; e.s = e.s.map((v, j) => v + p[j]); m.set(k, e); }
    let best = null; for (const e of m.values()) if (!best || e.n > best.n) best = e;
    return best ? best.s.map((v) => Math.round(v / best.n)) : [255, 255, 255];
  };
  const line = (x0, y0, x1, y1, n = 80) => { const out = []; for (let i = 0; i <= n; i++) out.push(at(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n))); return out; };
  const top = dominant(line(0, inset, W - 1, inset)), bot = dominant(line(0, H - 1 - inset, W - 1, H - 1 - inset));
  const lef = dominant(line(inset, 0, inset, H - 1)), rig = dominant(line(W - 1 - inset, 0, W - 1 - inset, H - 1));
  const dist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const all = dominant([...line(0, inset, W - 1, inset), ...line(0, H - 1 - inset, W - 1, H - 1 - inset), ...line(inset, 0, inset, H - 1), ...line(W - 1 - inset, 0, W - 1 - inset, H - 1)]);
  // a gradient: opposite edges differ, and the side edges change smoothly between them
  const smooth = (pts, a, b) => { const n = pts.length; let ok = 0; pts.forEach((p, i) => { const t = i / (n - 1); const e = a.map((v, j) => v + (b[j] - v) * t); if (dist(p, e) < 28) ok++; }); return ok / n > 0.7; };
  // fit: share of edge pixels the chosen fill explains (low = busy photo)
  const edges = [line(0, inset, W - 1, inset), line(0, H - 1 - inset, W - 1, H - 1 - inset), line(inset, 0, inset, H - 1), line(W - 1 - inset, 0, W - 1 - inset, H - 1)];
  const fitOf = (model) => { let ok = 0, n = 0; edges.forEach((pts, ei) => pts.forEach((p, i) => { n++; if (dist(p, model(ei, i / (pts.length - 1))) < 40) ok++; })); return ok / n; };
  const mix = (a, b, t) => a.map((v, j) => v + (b[j] - v) * t);
  if (dist(top, bot) > 24 && dist(top, bot) >= dist(lef, rig) && smooth(line(inset, 0, inset, H - 1), top, bot)) return { type: 'lin', dir: 'v', c0: top, c1: bot, fit: fitOf((e, t) => (e === 0 ? top : e === 1 ? bot : mix(top, bot, t))) };
  if (dist(lef, rig) > 24 && smooth(line(0, inset, W - 1, inset), lef, rig)) return { type: 'lin', dir: 'h', c0: lef, c1: rig, fit: fitOf((e, t) => (e === 2 ? lef : e === 3 ? rig : mix(lef, rig, t))) };
  return { type: 'solid', c: all, fit: fitOf(() => all) };
}

// the main colour of what is drawn inside a rect apart from its background
export function inkColor(view, rect, fill) {
  const c = composeRegion(view, rect, Math.max(1, Math.min(2, 300 / Math.max(rect.w, rect.h))));
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const bgs = fill.type === 'solid' ? [fill.c] : [fill.c0, fill.c1];
  const m = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const p = [d[i], d[i + 1], d[i + 2]];
    if (bgs.some((b) => Math.max(...b.map((v, j) => Math.abs(v - p[j]))) < 60)) continue;
    const k = p.map((v) => v >> 4).join(','); const e = m.get(k) || { n: 0, s: [0, 0, 0] }; e.n++; e.s = e.s.map((v, j) => v + p[j]); m.set(k, e);
  }
  let best = null; for (const e of m.values()) if (!best || e.n > best.n) best = e;
  return best ? best.s.map((v) => Math.round(v / best.n)) : [29, 36, 51];
}
