// Turns interpreter output into UI-space "atoms": text lines and graphic items.
import { transformBox, boxArea } from '../../core/geometry.js';

const DECOR_RE = /black|heavy|ultra|poster|display|brush|script|brevia|comic ?sans ms bold|impact|bebas|anton|logo|titling|stencil|shadow|outline|inline/i;

export function isDecorativeFont(font, size) {
  if (!font) return false;
  // Braille cells: dots, not letters (kept as pictures, never edited as text)
  if (font.isBraille && font.isBraille()) return true;
  // Type 3 fonts with a Unicode map (Chrome / Skia PDFs draw ALL text this way) are
  // real text; without one the glyphs are just drawings
  if (font.isType3) return !font.hasToUnicode;
  const name = font.style ? font.style.clean : font.baseFont;
  if (DECOR_RE.test(name) && (font.style.italic || size >= 14 || /black|heavy|ultra|brevia/i.test(name))) return true;
  return false;
}

function colorDist(a, b) {
  if (!a || !b) return 0;
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

// a glyph lying wholly outside its clip area is never drawn (e.g. Word list
// numbers pushed left of a clipped text box). It still shapes the lines (a
// paragraph starts there) but it is not part of the editable text - otherwise
// editing its paragraph would rewrite it as visible text
function clippedAway(g) {
  const c = g.clip, b = g.bbox;
  if (!c || !b) return false;
  const e = 0.05;
  return b.x1 <= c.x0 + e || b.x0 >= c.x1 - e || b.y1 <= c.y0 + e || b.y0 >= c.y1 - e;
}

export function buildAtoms(interp, geo) {
  const M = geo.M;
  const pageArea = geo.width * geo.height;
  const blendWhite = (rgb, a) => (!rgb || a == null || a >= 0.99 ? rgb : rgb.map((v) => Math.round(v * a + 255 * (1 - a))));
  // ---- glyphs -> UI ----
  const glyphs = interp.glyphs.map((g, idx) => {
    const b = transformBox(M, g.bbox);
    return { g, idx, b, uni: g.uni, size: g.size, rgb: blendWhite(g.fillRgb, g.ca), ca: g.ca ?? 1, space: /^\s*$/.test(g.uni), invisible: g.Tr === 3 || g.Tr === 7, clipped: clippedAway(g) };
  });
  // ---- lines ----
  const vis = glyphs.filter((x) => !x.invisible && x.b.x1 > x.b.x0);
  const lines = [];
  let cur = null;
  const baseline = (x) => { const p = x.g.trm; return M[1] * p[4] + M[3] * p[5] + M[5]; };
  for (const x of vis) {
    const by = baseline(x);
    const startNew = !cur
      || Math.abs(by - cur.baseline) > Math.max(0.35 * x.size, 1)
      || x.b.x0 < cur.b.x1 - 0.5 * x.size
      || x.b.x0 - cur.b.x1 > Math.max(1.6 * x.size, 8)
      || (Math.abs(x.size - cur.size) > 0.35 * cur.size)
      || (!x.space && !cur.lastSpace && colorDist(x.rgb, cur.rgb) > 90 && x.b.x0 - cur.b.x1 > 0.15 * x.size)
      || (!x.space && colorDist(x.rgb, cur.rgb) > 90 && x.b.x0 - cur.b.x1 > 1.5);
    if (startNew) {
      cur = { kind: 'text', glyphs: [], b: { ...x.b }, baseline: by, size: x.size, rgb: x.rgb, lastSpace: x.space };
      lines.push(cur);
    }
    cur.glyphs.push(x);
    if (!x.space) {
      cur.b.x0 = Math.min(cur.b.x0, x.b.x0); cur.b.x1 = Math.max(cur.b.x1, x.b.x1);
      cur.b.y0 = Math.min(cur.b.y0, x.b.y0); cur.b.y1 = Math.max(cur.b.y1, x.b.y1);
      if (!cur.rgbSet) { cur.rgb = x.rgb; cur.rgbSet = true; }
    }
    cur.lastSpace = x.space;
  }
  const textAtoms = lines.filter((l) => l.glyphs.some((x) => !x.space)).map((l) => {
    // recompute bbox from non-space glyphs only
    const ns = l.glyphs.filter((x) => !x.space);
    const b = { x0: Math.min(...ns.map((x) => x.b.x0)), y0: Math.min(...ns.map((x) => x.b.y0)), x1: Math.max(...ns.map((x) => x.b.x1)), y1: Math.max(...ns.map((x) => x.b.y1)) };
    const decor = ns.some((x) => isDecorativeFont(x.g.font, x.size));
    const boldCount = ns.filter((x) => x.g.font && x.g.font.style && x.g.font.style.weight >= 600).length;
    const bold = boldCount > ns.length / 2;
    return { ...l, b, text: l.glyphs.map((x) => x.uni).join(''), decor, bold };
  });
  // ---- graphic items ----
  const bgItems = [];
  const gfx = [];
  for (const it of interp.items) {
    if (!it.bbox) continue;
    const b = transformBox(M, it.bbox);
    const cb = { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(geo.width, b.x1), y1: Math.min(geo.height, b.y1) };
    if (cb.x1 - cb.x0 < 0.1 || cb.y1 - cb.y0 < 0.1) continue;
    const area = boxArea(cb);
    if (area < 0.5) continue;
    const ca = it.ca ?? 1, CA = it.CA ?? 1;
    const a = { kind: it.kind, item: it, b: cb, area, fill: !!it.fill, stroke: !!it.stroke, rgb: blendWhite(it.fillRgb, ca), strokeRgb: blendWhite(it.strokeRgb, CA), ca, CA };
    if (area > pageArea * 0.4) { bgItems.push(a); continue; }
    gfx.push(a);
  }
  return { glyphs, textAtoms, gfx, bgItems };
}
