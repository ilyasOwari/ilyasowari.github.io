// "Kaliteli" page scan: Tesseract and PaddleOCR read the same page at the
// same time; their words are matched by box overlap and the better reading
// of each spot wins. Tesseract's boxes are kept wherever possible (its bold /
// size measurements are better); Paddle mostly fixes misread letters.
import { isKnownTurkishWord } from './trDict.js';

const norm = (t) => (t || '').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '');
// letters without Turkish marks: "çalışma" ~ "calisma" (same word, marks differ)
const FOLD = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
export const foldTr = (t) => norm(t).replace(/[çğıöşüâîû]/g, (c) => FOLD[c]);

const ovX = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
const ovY = (a, b) => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
// same spot: overlapping on the same text line
function sameSpot(a, b) {
  const h = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  if (h <= 0 || ovY(a, b) < 0.5 * h) return false;
  const w = Math.min(a.x1 - a.x0, b.x1 - b.x0);
  return w > 0 && ovX(a, b) >= 0.35 * w;
}
const union = (ws) => ws.reduce((u, w) => ({ x0: Math.min(u.x0, w.bbox.x0), y0: Math.min(u.y0, w.bbox.y0), x1: Math.max(u.x1, w.bbox.x1), y1: Math.max(u.y1, w.bbox.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const NUM = /^[\d.,/:%()+-]+$/;

// how believable a reading (several words) is: confidence (Paddle's CTC
// probabilities run higher than Tesseract's, so they are scaled down), +
// known dictionary words, - unknown longer words
function readingScore(ws, engine, dict) {
  let s = 0;
  for (const w of ws) {
    const c = w.confidence ?? 0;
    s += engine === 'p' ? 0.55 * c + 40 : c;
    const t = (w.text || '').trim(), core = t.replace(/[^\p{L}]/gu, '');
    if (dict && core.length >= 3) s += isKnownTurkishWord(t, dict) ? 12 : -10;
    else if (NUM.test(t)) s += 2;
  }
  return s / Math.max(1, ws.length);
}

// tess, padd: [{ text, confidence (0-100), bbox }] in the same canvas px.
// Returns words like Tesseract's, with `agree` (both engines read the same
// text there) and `src` ('t' | 'p' | 'tp').
export function fuseWords(tess, padd, dict = null, { paddleOnlyMin = 92, tessOnlyMin = 65 } = {}) {
  const T = tess.filter((w) => w && w.bbox && (w.text || '').trim());
  const P = padd.filter((w) => w && w.bbox && (w.text || '').trim());
  // connected groups of overlapping words across the two engines
  const nT = T.length, parent = [...Array(nT + P.length).keys()];
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < nT; i++) for (let j = 0; j < P.length; j++) if (sameSpot(T[i].bbox, P[j].bbox)) parent[find(i)] = find(nT + j);
  const groups = new Map();
  for (let i = 0; i < parent.length; i++) {
    const r = find(i); if (!groups.has(r)) groups.set(r, { t: [], p: [] });
    if (i < nT) groups.get(r).t.push(T[i]); else groups.get(r).p.push(P[i - nT]);
  }
  const out = [];
  for (const { t, p } of groups.values()) {
    t.sort((a, b) => a.bbox.x0 - b.bbox.x0); p.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    if (!p.length) {
      // Tesseract alone: Paddle's detector saw no text there at all, so a weak
      // unknown "word" is most likely a speck / rule / banner edge read as letters
      for (const w of t) {
        const tx = (w.text || '').trim(), core = tx.replace(/[^\p{L}]/gu, '');
        const junk = (w.confidence ?? 0) < tessOnlyMin && core.length >= 1 && !NUM.test(tx) && !(dict && core.length >= 3 && isKnownTurkishWord(tx, dict));
        if (!junk) out.push({ ...w, src: 't', agree: false });
      }
      continue;
    }
    if (!t.length) {
      // Paddle alone: only clearly good readings (Tesseract saw nothing there)
      for (const w of p) {
        const tx = (w.text || '').trim(), core = tx.replace(/[^\p{L}]/gu, '');
        const ok = (w.confidence ?? 0) >= paddleOnlyMin && (NUM.test(tx) || (dict ? core.length >= 3 && isKnownTurkishWord(tx, dict) : true));
        if (ok) out.push({ ...w, src: 'p', agree: false });
      }
      continue;
    }
    const tt = t.map((w) => w.text).join(' '), pt = p.map((w) => w.text).join(' ');
    if (norm(tt) === norm(pt)) {
      // same text: Tesseract's words / boxes, more trusted
      out.push(...t.map((w) => ({ ...w, confidence: Math.min(99, Math.max(w.confidence ?? 0, 90)), src: 'tp', agree: true })));
      continue;
    }
    const sT = readingScore(t, 't', dict), sP = readingScore(p, 'p', dict);
    // same letters apart from Turkish marks: the dictionary decides (Paddle's
    // marks were restored from it), otherwise Tesseract's tur model
    const marksOnly = foldTr(tt) === foldTr(pt);
    const takeP = marksOnly ? sP > sT + 4 : sP > sT;
    if (!takeP) { out.push(...t.map((w) => ({ ...w, src: 't', agree: false }))); continue; }
    if (t.length === 1 && p.length === 1) {
      out.push({ ...t[0], text: p[0].text, confidence: Math.round(Math.min(99, 0.55 * (p[0].confidence ?? 0) + 40)), src: 'p', agree: false });
    } else {
      // different word split: Paddle's words, on the line Tesseract measured
      const u = union(t);
      out.push(...p.map((w) => ({ ...w, bbox: { x0: w.bbox.x0, x1: w.bbox.x1, y0: Math.min(w.bbox.y0, u.y0), y1: Math.max(w.bbox.y1, u.y1) }, confidence: Math.round(Math.min(99, 0.55 * (w.confidence ?? 0) + 40)), src: 'p', agree: false })));
    }
  }
  return out;
}
