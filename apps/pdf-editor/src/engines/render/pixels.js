// Pixel helpers: natural page colour (mode colour with tolerance) sampling.
function key(r, g, b) { return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); }

// Mode colour of the page margins (outer 4% band) -> [r,g,b]
export function pageNaturalColor(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const bw = Math.max(2, Math.round(w * 0.04)), bh = Math.max(2, Math.round(h * 0.03));
  const regions = [[0, 0, w, bh], [0, h - bh, w, bh], [0, 0, bw, h], [w - bw, 0, bw, h]];
  return modeOf(ctx, regions);
}
// Mode colour of a ring around rect (canvas pixels)
export function ringColor(canvas, x, y, rw, rh, ring = 6) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  const cl = (v, m) => Math.max(0, Math.min(m, v));
  const regions = [
    [x - ring, y - ring, rw + 2 * ring, ring], [x - ring, y + rh, rw + 2 * ring, ring],
    [x - ring, y, ring, rh], [x + rw, y, ring, rh],
  ].map(([a, b, c, d]) => { const x0 = cl(Math.round(a), W), y0 = cl(Math.round(b), H); return [x0, y0, cl(Math.round(a + c), W) - x0, cl(Math.round(b + d), H) - y0]; });
  return modeOf(ctx, regions);
}
function modeOf(ctx, regions) {
  const counts = new Map();
  const sums = new Map();
  for (const [x, y, w, h] of regions) {
    if (w <= 0 || h <= 0) continue;
    const d = ctx.getImageData(x, y, w, h).data;
    const step = Math.max(1, Math.floor((w * h) / 6000)) * 4;
    for (let i = 0; i < d.length; i += step) {
      const k = key(d[i], d[i + 1], d[i + 2]);
      counts.set(k, (counts.get(k) || 0) + 1);
      const s = sums.get(k) || [0, 0, 0];
      s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2];
      sums.set(k, s);
    }
  }
  let best = null, bc = 0;
  for (const [k, c] of counts) if (c > bc) { bc = c; best = k; }
  if (best === null) return [255, 255, 255];
  const s = sums.get(best);
  return s.map((v) => Math.round(v / bc));
}
export function rgbCss(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
