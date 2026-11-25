// Block-engine based full-page OCR digitization:
// reconstructs complete lines (respecting rules & logos), merges compatible
// lines into flowing multi-paragraph blocks, and queues suspect words.
import { sampleBg, sizeFor, lineLook } from './ocrRegion.js';
import { cleanNoiseTokens, autoCorrectFromPageContext } from './pageContextFix.js';
import { expandEraseForRemnants } from './pageStructure.js';
import { isKnownTurkishWord } from './trDict.js';

export const SUSPECT_CONF = 85;

// Flag words that Tesseract is unsure about, are not valid Turkish words, or look like OCR glitches
export function isSuspectWord(w, prevWord = null, dictSet = null) {
  if (!w) return false;
  const txt = (w.text || '').trim();
  if (!txt) return false;
  const conf = w.confidence ?? w.conf ?? 0;
  // with the full dictionary a known word is only queued when Tesseract was
  // really unsure; without it (load failed) the old confidence rule applies
  const bigDict = dictSet && dictSet.size >= 20000;
  const known = bigDict ? isKnownTurkishWord(txt, dictSet) : false;
  if (conf < (bigDict && known ? 55 : SUSPECT_CONF)) return true;
  if (txt.length >= 2 && txt.length <= 5 && /\p{L}/u.test(txt) && /\d/.test(txt)) return true;
  if (/[|~^`]/.test(txt)) return true;
  if (/^\d{1,2}$/.test(txt) && prevWord) {
    const pTxt = (prevWord.text || '').trim();
    if (/^[A-ZÇĞİÖŞÜ]{2,}$/u.test(pTxt)) return true;
  }
  if (dictSet && dictSet.size >= 50 && conf < 96 && !(bigDict ? known : isKnownTurkishWord(txt, dictSet))) return true;
  return false;
}

// Shrink base font size proportionally when OCR estimates overflow the original line bounds
export function fitFontSizeToBox(lines, boxW, boxH, baseSize) {
  const arr = Array.isArray(lines) && lines.length ? lines : [''];
  let sz = Math.max(6.5, baseSize || 11);
  const maxChars = Math.max(1, ...arr.map((s) => Array.from(s || '').length));
  const estW = maxChars * sz * 0.54;
  if (boxW > 8 && estW > boxW * 1.06) sz = Math.max(6.5, sz * ((boxW * 1.04) / estW));
  const estH = arr.length === 1 ? sz : (arr.length - 1) * (sz * 1.2) + sz;
  if (boxH > 6 && estH > boxH * 1.15) sz = Math.max(6.5, sz * ((boxH * 1.1) / estH));
  return Math.round(sz * 10) / 10;
}

const maxDiff = (a, b) => (!a || !b ? 0 : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])));
const hOv = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
const uBox = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

// Group Tesseract words into complete horizontal lines without shattering wide justified gaps
// x-height of a text line in px: the band of rows where most of the ink is
// (ascenders, descenders, brackets and stray marks only add thin rows)
export function lineXHeight(img, b) {
  const { data, width: W, height: H } = img;
  const x0 = Math.max(0, Math.floor(b.x0)), x1 = Math.min(W, Math.ceil(b.x1)), y0 = Math.max(0, Math.floor(b.y0)), y1 = Math.min(H, Math.ceil(b.y1));
  if (y1 - y0 < 4 || x1 - x0 < 4) return 0;
  const rows = new Array(y1 - y0).fill(0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2] < 150) rows[y - y0]++;
  }
  const mx = Math.max(...rows);
  if (mx < 3) return 0;
  // the densest contiguous band at >= 45 % of the peak row
  let best = 0, run = 0;
  for (const r of rows) { run = r >= 0.45 * mx ? run + 1 : 0; if (run > best) best = run; }
  return best;
}

export function reconstructLines(rawLinesOrWords, img, struct = null, px = 2) {
  const raw = [];
  for (const it of rawLinesOrWords || []) {
    if (it && Array.isArray(it.words)) raw.push(...it.words);
    else if (it && typeof it.text === 'string' && it.bbox) raw.push(it);
  }
  const bannerAt = (b) => {
    if (!struct || !struct.banners) return null;
    const cx = (b.x0 + b.x1) * 0.5, cy = (b.y0 + b.y1) * 0.5;
    return struct.banners.find((bn) => cx >= bn.x0 && cx <= bn.x1 && cy >= bn.y0 && cy <= bn.y1) || null;
  };
  const bannerLook = (bbox, ban, baseLook) => {
    if (!img) return { ink: [242, 242, 244], dominant: [32, 32, 34], bold: !!(baseLook && baseLook.bold), flat: true };
    const { data, width: W, height: H } = img;
    let dR = 0, dG = 0, dB = 0, dN = 0, lR = 0, lG = 0, lB = 0, lN = 0;
    const x0 = Math.max(0, Math.floor(Math.max(ban.x0, bbox.x0 - 2))), x1 = Math.min(W, Math.ceil(Math.min(ban.x1, bbox.x1 + 2)));
    const y0 = Math.max(0, Math.floor(ban.y0 + 1)), y1 = Math.min(H, Math.ceil(ban.y1 - 1));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        if (lum < 115) { dR += r; dG += g; dB += b; dN++; }
        else if (lum > 155 && x >= bbox.x0 && x <= bbox.x1 && y >= bbox.y0 && y <= bbox.y1) { lR += r; lG += g; lB += b; lN++; }
      }
    }
    const dominant = dN >= 4 ? [Math.round(dR / dN), Math.round(dG / dN), Math.round(dB / dN)] : [32, 32, 34];
    const ink = lN >= 4 ? [Math.round(lR / lN), Math.round(lG / lN), Math.round(lB / lN)] : [242, 242, 244];
    return { ink, dominant, bold: !!(baseLook && baseLook.bold), flat: true };
  };

  const clean = [];
  for (const wd of cleanNoiseTokens(raw)) {
    const b = wd.bbox;
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    if (bw < 1 || bh < 4) continue;
    const conf = wd.confidence ?? wd.conf ?? 100;
    // inside a logo / stamp zone only confident words survive (dense table cells
    // on scans are often mistaken for emblems; their text must not vanish)
    if (conf < 80 && struct && struct.overlapsLogo && struct.overlapsLogo(b, 0.25)) continue;
    const inBan = bannerAt(b);
    const bg = inBan ? [32, 32, 34] : (img ? sampleBg(img, b) : [255, 255, 255]);
    if (!inBan && conf < 76 && bw < bh * 0.7 && !/[\d]/u.test(wd.text) && wd.text.length <= 2) {
      const look = img ? lineLook(img, b, bh) : null;
      if (look && !look.flat) continue;
    }
    const cand = { text: wd.text, conf, confidence: conf, bbox: b, eraseBbox: { ...b }, bg, h: bh, cy: (b.y0 + b.y1) * 0.5 };
    // Deduplicate spatially overlapping OCR tokens (e.g. hatched cells producing duplicate boxes)
    const tokenScore = (t) => (t.conf ?? 80) + Math.min(10, ((t.text || '').match(/[\p{L}\p{N}]/gu) || []).length * 1.5);
    const dupIdx = clean.findIndex((o) => {
      const oy = Math.min(o.bbox.y1, b.y1) - Math.max(o.bbox.y0, b.y0);
      if (oy <= 0.45 * Math.min(o.h, bh)) return false;
      const ox = Math.min(o.bbox.x1, b.x1) - Math.max(o.bbox.x0, b.x0);
      return ox > 0.45 * Math.min(o.bbox.x1 - o.bbox.x0, bw);
    });
    if (dupIdx >= 0) {
      const prev = clean[dupIdx];
      const eb = uBox(prev.eraseBbox, cand.eraseBbox);
      if (tokenScore(cand) > tokenScore(prev)) {
        cand.eraseBbox = eb;
        clean[dupIdx] = cand;
      } else {
        prev.eraseBbox = eb;
      }
      continue;
    }
    clean.push(cand);
  }
  if (!clean.length) return [];

  // Bucket words into shared horizontal bands (preserving short x-height words like "ve", "ev", "de")
  clean.sort((a, b) => a.cy - b.cy || a.bbox.x0 - b.bbox.x0);
  const bands = [];
  for (const w of clean) {
    let best = null;
    for (const band of bands) {
      const ovY = Math.min(band.y1, w.bbox.y1) - Math.max(band.y0, w.bbox.y0);
      const minH = Math.min(band.y1 - band.y0, w.h);
      const bigRatio = Math.max(band.maxH, w.h) / Math.max(1, Math.min(band.maxH, w.h));
      const overlapsBand = ovY >= 0.58 * Math.max(1, minH) && bigRatio <= 2.7;
      const centerClose = Math.abs(band.avgCy - w.cy) <= 0.45 * Math.max(band.avgH, w.h) && bigRatio <= 1.55;
      if (!overlapsBand && !centerClose) continue;
      const d = Math.abs(band.avgCy - w.cy);
      if (!best || d < best.d) best = { band, d };
    }
    if (best) {
      best.band.words.push(w);
      best.band.y0 = Math.min(best.band.y0, w.bbox.y0);
      best.band.y1 = Math.max(best.band.y1, w.bbox.y1);
      best.band.maxH = Math.max(best.band.maxH, w.h);
      const n = best.band.words.length;
      best.band.avgCy = best.band.words.reduce((s, x) => s + x.cy, 0) / n;
      best.band.avgH = best.band.words.reduce((s, x) => s + x.h, 0) / n;
    } else bands.push({ words: [w], y0: w.bbox.y0, y1: w.bbox.y1, maxH: w.h, avgCy: w.cy, avgH: w.h });
  }

  const isTrueColumnGutter = (bandIdx, xLo, xHi, refH, yRef) => {
    if (xHi <= xLo + 4) return false;
    let leftCount = 0, rightAligned = 0;
    for (let i = 0; i < bands.length; i++) {
      if (i === bandIdx) continue;
      const b = bands[i];
      if (Math.abs(b.avgCy - yRef) > 14 * refH) continue;
      const bws = b.words.slice().sort((a, b2) => a.bbox.x0 - b2.bbox.x0);
      if (!bws.length) continue;
      // Check horizontal white corridor gaps in row `b` (including before first word & after last word)
      const gaps = [[-Infinity, bws[0].bbox.x0]];
      for (let wi = 1; wi < bws.length; wi++) gaps.push([bws[wi - 1].bbox.x1, bws[wi].bbox.x0]);
      gaps.push([bws[bws.length - 1].bbox.x1, Infinity]);
      const sharedW = Math.max(0, ...gaps.map(([g0, g1]) => Math.min(xHi, g1) - Math.max(xLo, g0)));
      if (sharedW < 1.15 * refH) return false;
      const hitGapIdx = gaps.findIndex(([g0, g1]) => Math.min(xHi, g1) - Math.max(xLo, g0) >= 1.15 * refH);
      if (hitGapIdx > 0 && bws[hitGapIdx - 1].bbox.x1 <= xLo + 1.0 * refH) leftCount++;
      if (hitGapIdx >= 0 && hitGapIdx < bws.length) {
        const rw = bws[hitGapIdx];
        if (Math.abs(rw.bbox.x0 - xHi) <= 2.5 * refH && sharedW >= 1.3 * refH) rightAligned++;
      }
    }
    return rightAligned >= 1 || leftCount >= 2;
  };

  // Column anchors: x where a word starts after a clear gap (or starts its
  // row). A left edge shared by 2+ other rows is a column / table cell start,
  // so a moderate gap in front of it splits the line even without ruling
  // (faint scanned table lines are often not detected at all).
  const anchors = [];
  bands.forEach((band, bi) => {
    const ws = band.words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
    ws.forEach((w, wi) => {
      const prev = ws[wi - 1];
      if (!prev || w.bbox.x0 - prev.bbox.x1 > 1.2 * Math.max(prev.h, w.h)) anchors.push({ x: w.bbox.x0, bi });
    });
  });
  const isColumnStart = (x, bi, refH) => {
    const rows = new Set();
    for (const a of anchors) if (a.bi !== bi && Math.abs(a.x - x) <= 0.6 * refH) rows.add(a.bi);
    return rows.size >= 2;
  };
  // Rows (other than bi, nearby) with white space running through [xLo, xHi]
  // at least 1.15 x refH wide: a real column boundary lines up over several
  // rows; the wide gaps of justified text fall at different places per row.
  const corridorRows = (bandIdx, xLo, xHi, refH, yRef) => {
    let n = 0;
    for (let i = 0; i < bands.length; i++) {
      if (i === bandIdx) continue;
      const b = bands[i];
      if (Math.abs(b.avgCy - yRef) > 8 * refH) continue;
      const bws = b.words.slice().sort((a, b2) => a.bbox.x0 - b2.bbox.x0);
      const first = bws[0].bbox.x0, last = bws[bws.length - 1].bbox.x1;
      // a short row (cell text not reaching this x) says nothing either way
      if (last < xLo || first > xHi) continue;
      let open = true;
      for (const w of bws) if (w.bbox.x1 > xLo + 0.15 * refH && w.bbox.x0 < xHi - 0.15 * refH) { open = false; break; }
      if (open) n++;
    }
    return n;
  };
  // Justified line: several word gaps, all of about the same width (the line
  // was stretched evenly), none much wider than the rest
  const isJustifiedLine = (ws) => {
    if (ws.length < 4) return false;
    const g = [];
    for (let i = 1; i < ws.length; i++) g.push(Math.max(0, ws[i].bbox.x0 - ws[i - 1].bbox.x1));
    const sorted = g.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1];
    const h = Math.max(...ws.map((w) => w.h));
    if (med < 0.45 * h) return false; // ordinary spacing: nothing to protect
    return sorted[sorted.length - 1] <= Math.max(1.7 * med, med + 0.8 * h);
  };
  const normEcho = (s) => (s || '').toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]/gu, '');
  const lines = [];
  bands.forEach((band, bi) => {
    const ws = band.words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const justified = isJustifiedLine(ws);
    let cur = [ws[0]];
    const flush = (arr) => {
      const cleaned = [];
      for (let ai = 0; ai < arr.length; ai++) {
        const w = arr[ai];
        if ((w.text || '').trim() === '|') {
          const betweenWords = ai > 0 && ai + 1 < arr.length
            && /\p{L}/u.test(arr[ai - 1].text || '')
            && /\p{L}/u.test(arr[ai + 1].text || '');
          if (betweenWords) cleaned.push({ ...w, text: 'I' });
        } else {
          cleaned.push(w);
        }
      }
      if (!cleaned.length) return;
      const text = cleaned.map((x) => x.text).join(' ');
      const bbox = cleaned.reduce((a, x) => uBox(a, x.bbox), { ...cleaned[0].bbox });
      const rawErase = cleaned.reduce((a, x) => uBox(a, x.eraseBbox || x.bbox), { ...(cleaned[0].eraseBbox || cleaned[0].bbox) });
      const hs = cleaned.map((w) => w.h).sort((a, b) => a - b);
      const medH = Math.max(5, hs[hs.length >> 1] || (bbox.y1 - bbox.y0));
      let sz = sizeFor(text, medH);
      // the box height can be inflated (a bracket, a pen stroke, a table rule
      // touching the word): cap the size by the measured x-height
      if (img && /[a-zçğıöşü]{3}/u.test(text)) {
        const xh = lineXHeight(img, bbox);
        if (xh > 3 && sz.size > 1.22 * (xh / 0.47)) sz = sizeFor(text, medH * (1.12 * (xh / 0.47)) / sz.size);
      }
      const rawLook = img ? lineLook(img, bbox, sz.size) : { ink: [29, 36, 51], dominant: cleaned[0].bg, bold: false, flat: true };
      const ban = bannerAt(bbox);
      const look = ban ? bannerLook(bbox, ban, rawLook) : rawLook;
      const eraseBbox = img ? expandEraseForRemnants(rawErase, img, struct, look.ink, look.dominant) : rawErase;
      lines.push({ text, bbox, eraseBbox, words: cleaned, sz, look, banner: ban ? { x0: ban.x0, y0: ban.y0, x1: ban.x1, y1: ban.y1 } : null });
    };
    for (let wi = 1; wi < ws.length; wi++) {
      const prev = cur[cur.length - 1], w = ws[wi];
      const maxH = Math.max(prev.h, w.h);
      const gap = w.bbox.x0 - prev.bbox.x1;
      const y0 = Math.min(prev.bbox.y0, w.bbox.y0), y1 = Math.max(prev.bbox.y1, w.bbox.y1);
      // Merge side-by-side duplicate/substring echo tokens ("Ygulama ygulama", "Birim Birimi")
      const pL = normEcho(prev.text), wL = normEcho(w.text);
      const isEcho = gap <= 0.45 * maxH && pL.length >= 4 && wL.length >= 4
        && (pL === wL || pL.includes(wL) || wL.includes(pL));
      if (isEcho) {
        const keepNew = (wL.length > pL.length && (w.conf ?? 80) >= (prev.conf ?? 80) - 10) || (wL.length === pL.length && (w.conf ?? 80) > (prev.conf ?? 80));
        const mergedErase = uBox(prev.eraseBbox || prev.bbox, w.eraseBbox || w.bbox);
        if (keepNew) cur[cur.length - 1] = { ...w, eraseBbox: mergedErase };
        else cur[cur.length - 1] = { ...prev, eraseBbox: mergedErase };
        continue;
      }
      const diffBg = maxDiff(prev.bg, w.bg) >= 42;
      const vRuleSplit = struct && struct.hasVRuleBetween && struct.hasVRuleBetween(prev.bbox.x1, w.bbox.x0, y0, y1);
      const logoSplit = struct && struct.overlapsLogo && gap > 4 && struct.overlapsLogo({ x0: prev.bbox.x1, y0, x1: w.bbox.x0, y1 }, 0.25);
      // a gap is only a column boundary when the white space lines up with
      // other rows; on an evenly stretched (justified) line it needs 3 rows
      const rows = gap > 1.4 * maxH ? corridorRows(bi, prev.bbox.x1, w.bbox.x0, maxH, band.avgCy) : 0;
      const tooWide = gap > 5.5 * maxH && (!justified || rows >= 2);
      const colSplit = !tooWide && gap > 1.65 * maxH && (justified ? rows >= 3 : isTrueColumnGutter(bi, prev.bbox.x1, w.bbox.x0, maxH, band.avgCy));
      const anchorSplit = !tooWide && !colSplit && gap > 1.4 * maxH && isColumnStart(w.bbox.x0, bi, maxH) && rows >= (justified ? 3 : 2);
      if (diffBg || vRuleSplit || logoSplit || tooWide || colSplit || anchorSplit) {
        flush(cur);
        cur = [w];
      } else {
        cur.push(w);
      }
    }
    flush(cur);
  });
  return lines.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

// Page-relative bold. The fixed "stroke / size > 0.125" rule calls almost
// everything bold on scans, where blur widens every stroke by about the same
// number of pixels. Here a line's stroke is compared with the page's own
// typical (regular) stroke: residual = stroke - 0.09 x size (0.09 em is a
// regular stroke), baseline = 30th percentile of the residuals weighted by
// characters (body text dominates), bold = clearly above the baseline.
// Guards (keep the fixed rule): too little text to know what "regular" is,
// the fixed rule calling >= 70 % of the text bold, or a baseline so heavy (> 1.4 pt) that the page itself is mostly bold.
export function rebaseBoldLines(lines, px = 2) {
  const ls = (lines || []).filter((l) => !l.banner && l.look && l.look.strokeF > 0 && l.sz && l.sz.size > 0);
  const chars = (l) => ((l.text || '').match(/[\p{L}\p{N}]/gu) || []).length;
  const total = ls.reduce((s, l) => s + chars(l), 0);
  if (ls.length < 8 || total < 150) return { applied: false, reason: 'few' };
  // the fixed rule already calls most of the page bold: either a really bold
  // page (tables of bold cells, posters) or a heavy scan - keep its verdict
  const absBold = ls.reduce((s, l) => s + (l.look.bold ? chars(l) : 0), 0);
  if (absBold >= total * 0.7) return { applied: false, reason: 'mostlyBold' };
  const res = ls.map((l) => ({ l, r: l.look.strokeF - 0.09 * l.sz.size, w: chars(l) })).sort((a, b) => a.r - b.r);
  let acc = 0, base = res[0].r;
  for (const e of res) { acc += e.w; if (acc >= total * 0.3) { base = e.r; break; } }
  if (base / px > 1.4) return { applied: false, reason: 'heavy', base };
  for (const e of res) e.l.look = { ...e.l.look, bold: e.r > base + Math.max(1.3, 0.04 * e.l.sz.size) };
  return { applied: true, base };
}

// A label that wraps inside one cell ("Birim Yetkilisi (Adı" / "Soyadı)")
// is one font size; short lines measure badly (a ")" or descender stretches
// the box). Left-aligned lines right under each other, with no rule between
// them and sizes within 1.6x, take the longer line's size (and bold, when
// the short one is a word or two).
export function harmonizeLabelLines(lines, struct = null) {
  const ls = (lines || []).filter((l) => !l.banner && l.sz && l.sz.size > 0 && l.bbox).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const chars = (l) => ((l.text || '').match(/[\p{L}\p{N}]/gu) || []).length;
  let n = 0;
  for (let i = 0; i < ls.length; i++) {
    const a = ls[i], ha = a.bbox.y1 - a.bbox.y0;
    for (let j = i + 1; j < ls.length; j++) {
      const b = ls[j], hb = b.bbox.y1 - b.bbox.y0, h = Math.max(ha, hb);
      const gap = b.bbox.y0 - a.bbox.y1;
      if (gap > 0.9 * h) break;
      if (gap < -0.35 * h || Math.abs(a.bbox.x0 - b.bbox.x0) > 1.2 * Math.min(ha, hb)) continue;
      if (struct && struct.hasHRuleBetween && struct.hasHRuleBetween(a.bbox.y1 - 1, b.bbox.y0 + 1, Math.max(a.bbox.x0, b.bbox.x0), Math.min(a.bbox.x1, b.bbox.x1))) continue;
      const r = Math.max(a.sz.size, b.sz.size) / Math.min(a.sz.size, b.sz.size);
      if (r < 1.12 || r > 1.6) break;
      const [ref, oth] = chars(a) >= chars(b) ? [a, b] : [b, a];
      if (chars(oth) > 0.8 * chars(ref) && chars(oth) > 8) break;
      const k = ref.sz.size / oth.sz.size;
      oth.sz = { ...oth.sz, size: ref.sz.size, baselineFromBottom: (oth.sz.baselineFromBottom || 0) * k };
      if (ref.look && oth.look && (oth.text || '').trim().split(/\s+/).length <= 2) oth.look = { ...oth.look, bold: ref.look.bold };
      n++;
      break;
    }
  }
  return n;
}

// Merge reconstructed lines vertically into logical PDF-Flow blocks
export function segmentOcrLines(lines, struct = null, px = 2) {
  if (!lines || !lines.length) return [];
  const sorted = lines.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const blocks = sorted.map((l) => ({ bbox: { ...l.bbox }, lines: [l], sz: l.sz.size, look: l.look }));

  const intersectsThird = (iA, iB, ux0, uy0, ux1, uy1) => blocks.some((o, idx) => idx !== iA && idx !== iB
    && o.bbox.x1 > ux0 + 2 && o.bbox.x0 < ux1 - 2 && o.bbox.y1 > uy0 + 2 && o.bbox.y0 < uy1 - 2);
  const vRuleInside = (ux0, uy0, ux1, uy1) => {
    if (!struct || !struct.vRules) return false;
    const margin = 4 * px;
    if (ux1 - ux0 <= 2 * margin) return false;
    return struct.vRules.some((r) => {
      const cx = (r.x0 + r.x1) * 0.5;
      return cx > ux0 + margin && cx < ux1 - margin && Math.min(uy1, r.y1) - Math.max(uy0, r.y0) >= 0.4 * (uy1 - uy0);
    });
  };
  // table rows: a line with another line beside it (same height band, apart
  // horizontally) is a cell of a row. Two such cells only stack into one block
  // when they are as close as the lines of one cell, never across a row gap
  // (faint scanned row rules are often not detected).
  const rowMate = new Set();
  for (const a of sorted) for (const b of sorted) {
    if (a === b) continue;
    const ov = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0);
    if (ov >= 0.5 * Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0) && (b.bbox.x0 >= a.bbox.x1 || a.bbox.x0 >= b.bbox.x1)) { rowMate.add(a); break; }
  }
  const logoBetween = (yA, yB, ux0, ux1) => struct && struct.logoZones && struct.logoZones.some((z) => z.x1 > ux0 + 2 && z.x0 < ux1 - 2 && z.y1 > yA - 2 && z.y0 < yB + 2);

  for (let again = true, guard = 0; again && guard < 200; guard++) {
    again = false;
    blocks.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    for (let i = 0; i < blocks.length && !again; i++) {
      const A = blocks[i];
      const lastA = A.lines[A.lines.length - 1];
      for (let j = i + 1; j < blocks.length; j++) {
        const B = blocks[j];
        const firstB = B.lines[0];
        if (firstB.bbox.y0 < lastA.bbox.y0 + 0.35 * Math.min(A.sz, B.sz)) continue;
        const gapY = firstB.bbox.y0 - lastA.bbox.y1;
        const maxSz = Math.max(A.sz, B.sz), minSz = Math.min(A.sz, B.sz);
        if (gapY > 3.4 * maxSz) break;
        if (rowMate.has(lastA) && rowMate.has(firstB) && gapY > 0.9 * maxSz) continue;
        if (maxDiff(lastA.look.dominant, firstB.look.dominant) >= 38) continue;
        if (maxDiff(lastA.look.ink, firstB.look.ink) >= 65) continue;
        const ux0 = Math.min(A.bbox.x0, B.bbox.x0), ux1 = Math.max(A.bbox.x1, B.bbox.x1);
        const uy0 = A.bbox.y0, uy1 = B.bbox.y1;
        if (struct && struct.hasHRuleBetween && struct.hasHRuleBetween(lastA.bbox.y1, firstB.bbox.y0, ux0, ux1)) continue;
        if (logoBetween(lastA.bbox.y1, firstB.bbox.y0, ux0, ux1)) continue;
        if (vRuleInside(ux0, uy0, ux1, uy1)) continue;
        const cA = (A.bbox.x0 + A.bbox.x1) * 0.5, cB = (B.bbox.x0 + B.bbox.x1) * 0.5;
        const centeredMatch = Math.abs(cA - cB) <= 2.2 * maxSz;
        const sizeRatio = maxSz / Math.max(1, minSz);
        if (sizeRatio > (centeredMatch ? 1.38 : 1.32)) continue;
        const wA = A.bbox.x1 - A.bbox.x0, wB = B.bbox.x1 - B.bbox.x0;
        const leftShift = Math.abs(A.bbox.x0 - B.bbox.x0);
        const symCenter = centeredMatch && Math.abs((A.bbox.x1 - cB) - (cB - A.bbox.x0)) <= 3.0 * maxSz;
        const leftMatch = leftShift <= 2.6 * maxSz || (leftShift <= 3.2 * maxSz && hOv(A.bbox, B.bbox) >= 0.45 * Math.min(wA, wB));
        if (!leftMatch && !symCenter) continue;
        if (intersectsThird(i, j, ux0, uy0, ux1, uy1)) continue;
        A.lines.push(...B.lines);
        A.bbox = uBox(A.bbox, B.bbox);
        A.sz = A.lines.reduce((s, l) => s + l.sz.size, 0) / A.lines.length;
        blocks.splice(j, 1);
        again = true;
        break;
      }
    }
  }
  return blocks;
}

const BULLET_RE = /^(?:[*•\-–—]|\d{1,2}[.)]|[a-zA-Z][.)])\s*\S/;

// Convert segmented OCR blocks into flowing multi-paragraph block specs + suspect queue
export function buildDigitizedBlocks(segBlocks, { px = 1, rect = { x: 0, y: 0 }, struct = null, dictSet = null } = {}) {
  const blocks = [];
  const suspects = [];
  const P = (v) => v / px;

  for (let bi = 0; bi < (segBlocks || []).length; bi++) {
    const blk = segBlocks[bi];
    const bLines = blk.lines || [];
    if (!bLines.length) continue;
    const blockId = `ocrb_${bi + 1}_${Date.now().toString(36)}`;
    const first = bLines[0];
    const szSorted = bLines.map((l) => (l.sz && l.sz.size) || 12).sort((a, b) => a - b);
    const medSzPx = szSorted[szSorted.length >> 1] || 12;
    const avgSzPx = medSzPx;
    const rawSz = Math.max(7, Math.min(48, P(medSzPx)));
    const w = Math.max(20, P(blk.bbox.x1 - blk.bbox.x0));
    const h = Math.max(10, P(blk.bbox.y1 - blk.bbox.y0));
    const blkCx = (blk.bbox.x0 + blk.bbox.x1) * 0.5;

    let align = 'left';
    if (bLines.length >= 2) {
      const widths = bLines.map((l) => l.bbox.x1 - l.bbox.x0);
      const spread = Math.max(...widths) - Math.min(...widths);
      const meanC = bLines.reduce((s, l) => s + Math.abs((l.bbox.x0 + l.bbox.x1) * 0.5 - blkCx), 0) / bLines.length;
      const meanL = bLines.reduce((s, l) => s + Math.abs(l.bbox.x0 - blk.bbox.x0), 0) / bLines.length;
      if (spread > 1.8 * avgSzPx && meanC < 1.2 * avgSzPx && meanC < 0.65 * meanL) align = 'center';
    }

    const xsSorted = bLines.map((l) => l.bbox.x0).sort((a, b) => a - b);
    const contLeft = xsSorted[Math.floor(xsSorted.length * 0.25)] ?? blk.bbox.x0;

    const gaps = [];
    for (let i = 1; i < bLines.length; i++) gaps.push(Math.max(0, bLines[i].bbox.y0 - bLines[i - 1].bbox.y1));
    const sortedGaps = gaps.slice().sort((a, b) => a - b);
    const medGap = sortedGaps.length ? sortedGaps[sortedGaps.length >> 1] : 0;

    // Group lines into flowing paragraphs; bullets or 2-3 char indented starts open new paragraphs
    const paras = [];
    const eraseRects = [];
    const breakExtras = [];
    let curPara = null;
    for (let li = 0; li < bLines.length; li++) {
      const l = bLines[li];
      const lLook = l.look || first.look || { ink: [29, 36, 51], dominant: [255, 255, 255], bold: false, flat: true };
      const c = (lLook.dominant || [255, 255, 255]).map((v) => Math.max(0, Math.min(255, Math.round(v))));
      const eb = l.eraseBbox || l.bbox;
      let ex0 = Math.max(0, rect.x + P(eb.x0) - 1.8);
      let ey0 = Math.max(0, rect.y + P(eb.y0) - 2.2);
      let ex1 = ex0 + Math.max(4, P(eb.x1 - eb.x0) + 3.6);
      let ey1 = ey0 + Math.max(4, P(eb.y1 - eb.y0) + 4.2);
      if (l.banner) {
        ex0 = Math.max(ex0, rect.x + P(l.banner.x0) + 0.8);
        ey0 = Math.max(ey0, rect.y + P(l.banner.y0) + 0.8);
        ex1 = Math.min(ex1, rect.x + P(l.banner.x1) - 0.8);
        ey1 = Math.min(ey1, rect.y + P(l.banner.y1) - 0.8);
      }
      if (ex1 > ex0 + 1 && ey1 > ey0 + 1) {
        eraseRects.push({ x: ex0, y: ey0, w: ex1 - ex0, h: ey1 - ey0, c, ...(l.banner ? { inBanner: true } : {}) });
      }
      const words = (l.words && l.words.length ? l.words : [{ text: l.text || '', conf: 100, bbox: l.bbox }])
        .map((wd) => ({
          text: (wd.text || '').trim(),
          conf: Math.round(wd.confidence ?? wd.conf ?? 100),
          bboxPx: wd.bbox || l.bbox,
        }))
        .filter((wd) => wd.text);

      let newPara = !curPara || align === 'center';
      let gapY = 0;
      if (!newPara && li > 0) {
        const prev = bLines[li - 1];
        gapY = Math.max(0, l.bbox.y0 - prev.bbox.y1);
        const prevW = prev.bbox.x1 - prev.bbox.x0;
        const blkW = blk.bbox.x1 - blk.bbox.x0;
        const indentedStart = (l.bbox.x0 - contLeft) >= 1.15 * avgSzPx;
        const prevTxt = (prev.text || '').trimEnd();
        const prevEndedSentence = /[.!?:)]$/.test(prevTxt) && prevW < 0.76 * blkW;
        if (gapY > Math.max(1.45 * medGap, 0.65 * avgSzPx)) newPara = true;
        else if (BULLET_RE.test(l.text || '') || indentedStart) newPara = true;
        else if (blkW > 80 && prevEndedSentence) newPara = true;
      }
      if (newPara) {
        if (curPara && gapY > medGap) breakExtras.push(gapY - medGap);
        curPara = { words: [], text: '' };
        paras.push(curPara);
      }
      curPara.words.push(...words);
      curPara.text = curPara.words.map((wd) => wd.text).join(' ');
    }

    const lineTexts = align === 'center' ? paras.map((p) => p.text) : bLines.map((l) => l.text || '');
    const size = fitFontSizeToBox(lineTexts, w, h, rawSz);
    const firstBase = rect.y + P(first.bbox.y1 - ((first.sz && first.sz.baselineFromBottom) || 0));
    const last = bLines[bLines.length - 1];
    const lastBase = rect.y + P(last.bbox.y1 - ((last.sz && last.sz.baselineFromBottom) || 0));
    const lineStep = bLines.length > 1 ? Math.max(size * 1.05, Math.min(size * 1.65, (lastBase - firstBase) / (bLines.length - 1))) : size * 1.25;
    const avgExtraPx = breakExtras.length ? breakExtras.reduce((s, v) => s + v, 0) / breakExtras.length : 0;
    const paraGap = align === 'center' || !breakExtras.length ? 0 : Math.max(2, Math.min(size * 1.1, P(avgExtraPx)));
    const look0 = first.look || { ink: [29, 36, 51], dominant: [255, 255, 255], bold: false, flat: true };
    const color = look0.ink.map((v) => Math.max(0, Math.min(255, Math.round(v))));
    const dom0 = (look0.dominant || [255, 255, 255]).map((v) => Math.max(0, Math.min(255, Math.round(v))));
    const ocrBgHex = '#' + dom0.map((v) => v.toString(16).padStart(2, '0')).join('');
    const boldCount = bLines.filter((l) => l.look && l.look.bold).length;
    const bannerPt = first.banner
      ? { x0: rect.x + P(first.banner.x0), y0: rect.y + P(first.banner.y0), x1: rect.x + P(first.banner.x1), y1: rect.y + P(first.banner.y1) }
      : null;

    const origBox = {
      x: Math.max(4, rect.x + P(blk.bbox.x0)),
      y: Math.max(4, firstBase - (0.95 * size + 2)),
      w,
      h,
    };
    let cellMaxW = null;
    if (struct && struct.ptRulesV && struct.ptRulesV.length) {
      const rightWalls = struct.ptRulesV.filter((r) => r.x0 > origBox.x + origBox.w - 4 && Math.min(origBox.y + origBox.h, r.y1) - Math.max(origBox.y, r.y0) > 0.35 * origBox.h);
      if (rightWalls.length) {
        const vx = Math.min(...rightWalls.map((r) => r.x0));
        cellMaxW = Math.max(origBox.w + 2, vx - origBox.x - 4);
      }
    }

    blocks.push({
      blockId,
      x: origBox.x,
      y: origBox.y,
      w: Math.max(w + 6, 24),
      h,
      origBox, cellMaxW,
      rawSz, firstBase, lastBase, bannerPt, ocrBgHex,
      origLineCount: bLines.length,
      flowing: align !== 'center' && paras.length < bLines.length,
      size, lineStep, paraGap, align,
      bold: boldCount > bLines.length / 2,
      color,
      flat: !!look0.flat,
      paras,
      lines: paras,
      eraseRects,
      struct,
    });
  }

  autoCorrectFromPageContext(blocks, dictSet);

  for (let bi = 0; bi < blocks.length; bi++) {
    const blk = blocks[bi];
    for (let pi = 0; pi < blk.paras.length; pi++) {
      const ws = blk.paras[pi].words || [];
      for (let wi = 0; wi < ws.length; wi++) {
        const wd = ws[wi];
        if (!isSuspectWord(wd, wi > 0 ? ws[wi - 1] : null, dictSet)) continue;
        suspects.push({
          id: `sus_${bi}_${pi}_${wi}`,
          blockId: blk.blockId, paraIdx: pi, wordIdx: wi, lineIdx: pi,
          text: wd.text, conf: wd.conf, bboxPx: wd.bboxPx,
          pageRect: {
            x: rect.x + P(wd.bboxPx.x0), y: rect.y + P(wd.bboxPx.y0),
            w: P(wd.bboxPx.x1 - wd.bboxPx.x0), h: P(wd.bboxPx.y1 - wd.bboxPx.y0),
          },
        });
      }
    }
  }
  return { blocks, suspects };
}

// Apply user verification fix (or delete word if empty) directly into digitized block
export function applyWordCorrection(block, paraIdx, wordIdx, newText) {
  if (!block || !block.inserted) return false;
  const clean = String(newText ?? '').trim();
  const paras = block.inserted.paras || [];
  const srcList = block._ocrParas || block._ocrLines;
  if (Array.isArray(srcList) && srcList[paraIdx]) {
    const row = srcList[paraIdx];
    if (!row.words || !row.words[wordIdx]) return false;
    row.words[wordIdx].text = clean;
    row.text = row.words.map((w) => w.text).filter(Boolean).join(' ');
    if (paras[paraIdx]) paras[paraIdx].text = row.text;
    else paras[paraIdx] = { text: row.text };
    return true;
  }
  if (!paras[paraIdx]) return false;
  const toks = (paras[paraIdx].text || '').split(/\s+/).filter(Boolean);
  if (wordIdx < 0 || wordIdx >= toks.length) return false;
  if (clean) toks[wordIdx] = clean;
  else toks.splice(wordIdx, 1);
  paras[paraIdx].text = toks.join(' ');
  return true;
}
