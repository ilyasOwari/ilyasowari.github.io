// Full-page OCR helpers: a second, Sauvola-binarised reading of the page,
// word-level voting between readings, and the boxes of ink nobody read
// (table cells, lone numbers) for a crop-by-crop re-read.
import { isKnownTurkishWord } from './trDict.js';

// internal switches (full-page OCR): second Sauvola pass + voting, and the
// crop-by-crop re-read. Each roughly doubles / adds to the reading time.
export const ocrOptions = { twoPass: true, reread: true, paddleInput: 'raw', fuse: true, marks: true, tessOnlyMin: 65 };

// Sauvola local threshold (integral images): T = m * (1 + k * (s / R - 1)).
// Faint strokes on a grey scan stay black where one global cut loses them.
export function sauvola(img, { win = 31, k = 0.2, R = 128 } = {}) {
  const { data, width: W, height: H } = img;
  const n = W * H, lum = new Float64Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2];
  const W1 = W + 1, S = new Float64Array(W1 * (H + 1)), S2 = new Float64Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let r = 0, r2 = 0;
    for (let x = 0; x < W; x++) {
      const v = lum[y * W + x]; r += v; r2 += v * v;
      S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + r; S2[(y + 1) * W1 + x + 1] = S2[y * W1 + x + 1] + r2;
    }
  }
  const h = win >> 1, out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - h), y1 = Math.min(H, y + h + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - h), x1 = Math.min(W, x + h + 1), a = (y1 - y0) * (x1 - x0);
      const s = S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
      const s2 = S2[y1 * W1 + x1] - S2[y0 * W1 + x1] - S2[y1 * W1 + x0] + S2[y0 * W1 + x0];
      const m = s / a, sd = Math.sqrt(Math.max(0, s2 / a - m * m));
      const v = lum[y * W + x] <= m * (1 + k * (sd / R - 1)) ? 0 : 255;
      const o = (y * W + x) * 4; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const norm = (t) => (t || '').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '');

// score of one reading of a word: Tesseract confidence, + a dictionary bonus
// for a known word (or a number), - a little for an unknown longer word
export function wordScore(w, dict) {
  const conf = w.confidence ?? w.conf ?? 0;
  const t = (w.text || '').trim();
  if (!dict || dict.size < 20000 || !/\p{L}/u.test(t)) return conf;
  const core = t.replace(/[^\p{L}'-]/gu, '');
  if (core.length < 3) return conf;
  return conf + (isKnownTurkishWord(t, dict) ? 8 : -4);
}

// passes: arrays of words ({text, confidence, bbox}). Greedy: the best scored
// reading wins its place; readings overlapping it (>= 40 % of the smaller box)
// are dropped. Two passes reading the same text there = agreement bonus.
export function voteWords(passes, dict = null) {
  const all = [];
  passes.forEach((ws, pi) => (ws || []).forEach((w) => { if (w && w.bbox && (w.text || '').trim()) all.push({ w, pi, sc: wordScore(w, dict) }); }));
  for (const a of all) {
    for (const b of all) {
      if (a === b || a.pi === b.pi || a.agree) continue;
      if (norm(a.w.text) && norm(a.w.text) === norm(b.w.text) && inter(a.w.bbox, b.w.bbox) >= 0.4 * Math.min(area(a.w.bbox), area(b.w.bbox))) { a.agree = true; }
    }
  }
  for (const a of all) if (a.agree) a.sc += 5;
  all.sort((a, b) => b.sc - a.sc);
  const kept = [];
  for (const a of all) {
    if (kept.some((k) => inter(k.w.bbox, a.w.bbox) >= 0.4 * Math.min(area(k.w.bbox), area(a.w.bbox)))) continue;
    kept.push(a);
  }
  return kept.map((k) => (k.agree ? { ...k.w, confidence: Math.min(99, Math.max(k.w.confidence ?? 0, (k.w.confidence ?? 0) + 5)), voted: 2 } : { ...k.w, voted: 1 }));
}

// ink boxes (word-sized groups of dark components of a binary image) that no
// read word covers: lone numbers in table cells, short labels
export function unreadInkBoxes(bin, words, px = 3, { maxN = 150 } = {}) {
  const { data, width: W, height: H } = bin;
  const step = 2, gW = Math.ceil(W / step), gH = Math.ceil(H / step);
  const on = new Uint8Array(gW * gH);
  for (let gy = 0; gy < gH; gy++) for (let gx = 0; gx < gW; gx++) {
    let dark = false;
    for (let dy = 0; dy < step && !dark; dy++) for (let dx = 0; dx < step; dx++) {
      const x = gx * step + dx, y = gy * step + dy;
      if (x < W && y < H && data[(y * W + x) * 4] < 128) { dark = true; break; }
    }
    on[gy * gW + gx] = dark ? 1 : 0;
  }
  const seen = new Uint8Array(gW * gH), comps = [], st = [];
  for (let i = 0; i < gW * gH; i++) {
    if (!on[i] || seen[i]) continue;
    let x0 = gW, y0 = gH, x1 = 0, y1 = 0, n = 0;
    seen[i] = 1; st.push(i);
    while (st.length) {
      const q = st.pop(), x = q % gW, y = (q / gW) | 0; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gW || ny >= gH) continue;
        const r = ny * gW + nx; if (on[r] && !seen[r]) { seen[r] = 1; st.push(r); }
      }
    }
    const b = { x0: x0 * step, y0: y0 * step, x1: (x1 + 1) * step, y1: (y1 + 1) * step, n };
    const h = b.y1 - b.y0, w = b.x1 - b.x0;
    // glyph-like: 4..30 pt tall, not a long rule, not a speck
    if (h < 4 * px || h > 30 * px || w > 40 * px || n < 6) continue;
    comps.push(b);
  }
  // components -> word boxes (same line, gap < 0.7 x height)
  comps.sort((a, b) => a.x0 - b.x0);
  const groups = [];
  for (const c of comps) {
    const g = groups.find((g) => {
      const hh = Math.max(g.y1 - g.y0, c.y1 - c.y0);
      const ov = Math.min(g.y1, c.y1) - Math.max(g.y0, c.y0);
      return ov > 0.5 * Math.min(g.y1 - g.y0, c.y1 - c.y0) && c.x0 - g.x1 < 0.7 * hh && c.x0 - g.x1 > -0.5 * hh;
    });
    if (g) { g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1); } else groups.push({ ...c });
  }
  const out = groups.filter((g) => {
    if (g.x1 - g.x0 > 60 * px) return false;
    return !words.some((w) => inter(w.bbox, g) >= 0.3 * area(g));
  });
  return out.slice(0, maxN);
}

export const NUMLIKE = /^[\d\s.,/()%+-]{1,8}$/;
