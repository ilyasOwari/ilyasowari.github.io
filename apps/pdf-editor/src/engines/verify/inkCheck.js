// Layer 3 of text verification: letters that are drawn as vector outlines
// instead of text (design tools sometimes convert single glyphs, e.g. the
// Turkish "i", to curves). The text layer then reads "Dstrct" while the page
// shows "District".
// Runs when the block editor opens, only for lines that have glyph-sized
// vector shapes inside or right next to them, and confirms each suspicious
// gap with the page raster that is already rendered (is there visible ink
// between the two letters, within the line's height?). It only FLAGS spots;
// the line OCR (layer 4) decides what, if anything, is missing there.

const LETTER = /[\p{L}\p{N}]/u;

// first text index of each glyph item in model.text
function textPosOf(model) {
  const pos = new Map();
  model.charGlyph.forEach((g, i) => { if (g && !pos.has(g)) pos.set(g, i); });
  return pos;
}

// glyph-sized filled/stroked vector paths near a line
function candidatePaths(gfx, l) {
  const sz = l.size || 10, out = [];
  const yTop = l.baseline - 1.05 * sz, yBot = l.baseline + 0.3 * sz;
  const xL = l.left - 0.5 * sz, xR = l.right + 0.6 * sz;
  gfx.forEach((a, gi) => {
    if (a.kind !== 'path' || !(a.fill || a.stroke)) return;
    const w = a.b.x1 - a.b.x0, h = a.b.y1 - a.b.y0;
    if (w > 0.6 * sz || h > 1.1 * sz || w * h > 0.5 * sz * sz || (w < 0.02 * sz && h < 0.02 * sz)) return;
    const cx = (a.b.x0 + a.b.x1) / 2, cy = (a.b.y0 + a.b.y1) / 2;
    if (cx < xL || cx > xR || cy < yTop || cy > yBot) return;
    out.push({ gi, b: a.b, cx });
  });
  return out;
}

// raster: { data (RGBA), width, height, scale (px per pt), ox, oy (pt origin) }
function inkRatio(raster, x0, x1, y0, y1, bg) {
  const s = raster.scale;
  const px0 = Math.max(0, Math.floor((x0 - raster.ox) * s)), px1 = Math.min(raster.width, Math.ceil((x1 - raster.ox) * s));
  const py0 = Math.max(0, Math.floor((y0 - raster.oy) * s)), py1 = Math.min(raster.height, Math.ceil((y1 - raster.oy) * s));
  if (px1 - px0 < 1 || py1 - py0 < 2) return { ratio: 0, cols: 0 };
  let ink = 0, n = 0; const cols = new Set();
  for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) {
    const i = (y * raster.width + x) * 4, d = raster.data;
    const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    n++; if (diff > 120) { ink++; cols.add(x); }
  }
  return { ratio: ink / n, cols: cols.size };
}

// most common (quantised) colour of the line band = its background
function bandBackground(raster, l) {
  const s = raster.scale, sz = l.size || 10;
  const px0 = Math.max(0, Math.floor((l.left - raster.ox) * s)), px1 = Math.min(raster.width, Math.ceil((l.right - raster.ox) * s));
  const py0 = Math.max(0, Math.floor((l.baseline - 0.8 * sz - raster.oy) * s)), py1 = Math.min(raster.height, Math.ceil((l.baseline + 0.2 * sz - raster.oy) * s));
  const hist = new Map(); const d = raster.data;
  const step = Math.max(1, Math.floor((px1 - px0) * (py1 - py0) / 4000));
  let k = 0;
  for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) {
    if ((k++ % step) !== 0) continue;
    const i = (y * raster.width + x) * 4;
    const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  let best = 0xFFF, bn = -1;
  for (const [key, n] of hist) if (n > bn) { bn = n; best = key; }
  return [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
}

// -> [{ line, pos (insertion index in model.text), gfx: [gi], x0, x1 }]
export function findInkGaps(model, gfx, raster) {
  const out = [];
  if (!model || !model.lines || !model.charGlyph || !gfx || !gfx.length) return out;
  const pos = textPosOf(model);
  model.lines.forEach((l, li) => {
    if (l.decor) return;
    const cands = candidatePaths(gfx, l);
    if (!cands.length) return;
    const sz = l.size || 10;
    if (raster && sz * raster.scale < 7) return; // too small on screen to judge
    const bg = raster ? bandBackground(raster, l) : null;
    const gl = l.glyphs.filter((g) => !g.space && !g.invisible);
    const covered = (x) => gl.some((g) => x > g.b.x0 + 0.1 * (g.b.x1 - g.b.x0) && x < g.b.x1 - 0.1 * (g.b.x1 - g.b.x0));
    const spots = [];
    for (let i = 0; i < gl.length; i++) {
      const a = gl[i], b = gl[i + 1] || null;
      if (!LETTER.test(a.uni || '')) continue;
      const x0 = a.b.x1 - 0.08 * sz, x1 = b ? b.b.x0 + 0.08 * sz : a.b.x1 + 0.45 * sz;
      if (x1 <= x0) continue;
      const inGap = cands.filter((c) => c.cx > x0 && c.cx < x1 && !covered(c.cx));
      if (!inGap.length) continue;
      // the shapes must be letter-high (a stem), not just a dot or an underline
      const top = Math.min(...inGap.map((c) => c.b.y0)), bot = Math.max(...inGap.map((c) => c.b.y1));
      if (bot - top < 0.3 * sz) continue;
      if (raster) {
        const gx0 = Math.min(...inGap.map((c) => c.b.x0)), gx1 = Math.max(...inGap.map((c) => c.b.x1));
        const r = inkRatio(raster, Math.max(x0, gx0), Math.min(x1, gx1), l.baseline - 0.75 * sz, l.baseline, bg);
        if (r.ratio < 0.12 || r.cols < 1) continue; // the shape is not visibly there
      }
      const p = pos.get(a);
      if (p == null) continue;
      const body = inGap.reduce((q, c) => ((c.b.x1 - c.b.x0) * (c.b.y1 - c.b.y0) > (q.b.x1 - q.b.x0) * (q.b.y1 - q.b.y0) ? c : q));
      spots.push({ line: li, pos: p + (a.uni || ' ').length, gfx: inGap.map((c) => c.gi), x0, x1, end: !b, bodyH: (body.b.y1 - body.b.y0) / sz });
    }
    out.push(...spots);
  });
  return out;
}

// raster helper: page-raster canvas (whole page, px = pt * scale) -> region
export function rasterRegion(canvas, scale, box) {
  const px0 = Math.max(0, Math.floor(box.x0 * scale)), py0 = Math.max(0, Math.floor(box.y0 * scale));
  const px1 = Math.min(canvas.width, Math.ceil(box.x1 * scale)), py1 = Math.min(canvas.height, Math.ceil(box.y1 * scale));
  if (px1 - px0 < 2 || py1 - py0 < 2) return null;
  const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(px0, py0, px1 - px0, py1 - py0);
  return { data: img.data, width: img.width, height: img.height, scale, ox: px0 / scale, oy: py0 / scale };
}
