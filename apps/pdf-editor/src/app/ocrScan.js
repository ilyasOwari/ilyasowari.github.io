// "Metin tara" (Düzenle toolbar): the user draws a rectangle on the stage;
// that part of the page is rendered at high resolution and read (OCR). Every
// separate word group (another line, another shape, far apart) becomes its
// own editable text item at the same place, size, colour and weight. The
// FULL original word box (+ a margin for antialiasing and outlines) is
// covered by a patch that stays where the original was, whatever the user
// does with the new text: flat / smooth gradient background -> painted out
// with the fitted background; busy (photo, pattern) -> filled with the main
// colour it sits on, and the new text gets a text box of that colour.
import { composeRegion } from '../ui/workspace/compose.js';
import { ocrWords } from '../engines/ocr/ocr.js';
import { mergeWords, groupWords, groupLines, filterIsolatedIconNoise, letterClusters, sampleBg, sizeFor, lineLook, toHex } from '../engines/ocr/ocrRegion.js';
import { detectPageStructure, preprocessForOcr, pruneRulesPiercingWords, clampRectAwayFromStructure, inMarkUnsure } from '../engines/ocr/pageStructure.js';
import { reconstructLines, segmentOcrLines, buildDigitizedBlocks, applyWordCorrection, rebaseBoldLines, harmonizeLabelLines } from '../engines/ocr/pageDigitize.js';
import { loadTrDict, restoreTurkishLetters, isKnownTurkishWord } from '../engines/ocr/trDict.js';
import { paddleWords, paddleAvailable } from '../engines/ocr/paddle.js';
import { fuseWords } from '../engines/ocr/ocrFusion.js';
import { sauvola, voteWords, unreadInkBoxes, NUMLIKE, ocrOptions } from '../engines/ocr/ocrPasses.js';
import { eraseArea, restoreOriginalArea } from '../model/areaOps.js';
import { findBlock, collides } from '../model/blockOps.js';
import { layoutInserted, insFrame } from '../engines/text/insertedLayout.js';
import { showLoading, hideLoading } from '../ui/common/modal.js';
import { toast } from '../ui/common/toast.js';
import { t } from '../i18n/i18n.js';
import { openOcrVerifyPanel } from '../ui/modals/ocrVerifyPanel.js';
import { openScanDialog } from '../ui/modals/simpleModals.js';
import { cleanScanImage } from '../engines/ocr/bgClean.js';
import { putImage, imgSrc } from '../core/imageStore.js';
import { newId } from '../model/blockOps.js';

const wordsOf = (lines) => lines.flatMap((l) => l.words || []);

function cropWordDataUrl(cv, b, pad = 6) {
  const x0 = Math.max(0, Math.floor(b.x0 - pad)), y0 = Math.max(0, Math.floor(b.y0 - pad));
  const x1 = Math.min(cv.width, Math.ceil(b.x1 + pad)), y1 = Math.min(cv.height, Math.ceil(b.y1 + pad));
  if (x1 <= x0 || y1 <= y0) return null;
  const c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0;
  c.getContext('2d').drawImage(cv, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

function crop(cv, b, pad) {
  const x0 = Math.max(0, Math.floor(b.x0 - pad)), y0 = Math.max(0, Math.floor(b.y0 - pad));
  const x1 = Math.min(cv.width, Math.ceil(b.x1 + pad)), y1 = Math.min(cv.height, Math.ceil(b.y1 + pad));
  const c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0;
  c.getContext('2d').drawImage(cv, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return { c, x0, y0 };
}

// all words of a canvas (canvas px): whole-picture passes (automatic and
// sparse-text page segmentation), then each letter cluster no pass read
// confidently on its own (outlined / light-on-dark words, badge digits)
export async function readCanvas(cv, { minH = 8 } = {}) {
  const [a, b] = [await ocrWords(cv, 3), await ocrWords(cv, 11)];
  const words = mergeWords([wordsOf(a), wordsOf(b)]);
  const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
  // each letter cluster on its own, as clean black-on-white letters
  for (const g of letterClusters(img, { minH })) {
    const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
    if (words.some((w) => cx >= w.bbox.x0 && cx <= w.bbox.x1 && cy >= w.bbox.y0 && cy <= w.bbox.y1 && w.conf >= 80)) continue;
    const c = document.createElement('canvas'); c.width = g.pic.w; c.height = g.pic.h;
    c.getContext('2d').putImageData(new ImageData(g.pic.data, g.pic.w, g.pic.h), 0, 0);
    const got = mergeWords([wordsOf(await ocrWords(c, g.cs.length === 1 ? 10 : 7))], 70);
    for (const w of got) words.push({ ...w, bbox: { x0: w.bbox.x0 + g.pic.x, y0: w.bbox.y0 + g.pic.y, x1: w.bbox.x1 + g.pic.x, y1: w.bbox.y1 + g.pic.y }, cluster: true, singleBlob: g.cs.length === 1 });
  }
  const merged = filterIsolatedIconNoise(mergeWords([words], 0));
  words.length = 0; words.push(...merged);
  return { words, img };
}

// real text painted out (each box filled with the colour around it) so the
// reader only sees pictures of text
function maskRects(cv, rects, pad) {
  if (!rects.length) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  const d = g.getImageData(0, 0, W, H).data;
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x0 - pad)), y0 = Math.max(0, Math.floor(r.y0 - pad)), x1 = Math.min(W, Math.ceil(r.x1 + pad)), y1 = Math.min(H, Math.ceil(r.y1 + pad));
    if (x1 <= x0 || y1 <= y0) continue;
    const ring = [];
    const add = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) { const i = (y * W + x) * 4; ring.push([d[i], d[i + 1], d[i + 2]]); } };
    for (let x = x0; x < x1; x++) { add(x, y0 - 1); add(x, y1); }
    for (let y = y0; y < y1; y++) { add(x0 - 1, y); add(x1, y); }
    const med = [0, 1, 2].map((j) => { const v = ring.map((c) => c[j]).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 255; });
    g.fillStyle = `rgb(${med[0]},${med[1]},${med[2]})`; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

// Tesseract reading of the page: one pass, + a Sauvola-binarised second pass
// with word voting, + a crop-by-crop re-read of unread ink / weak words
async function tesseractPageWords(cv, px, dictSet) {
  lastEngine = 'tesseract';
  let pageWords = wordsOf(await ocrWords(cv, 3));
  let binImg = null;
  if (ocrOptions.twoPass || ocrOptions.reread) {
    const g = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    binImg = sauvola(g, { win: (Math.round(12 * px) | 1) });
  }
  if (ocrOptions.twoPass) {
    const bcv = document.createElement('canvas'); bcv.width = cv.width; bcv.height = cv.height;
    bcv.getContext('2d').putImageData(new ImageData(binImg.data, binImg.width, binImg.height), 0, 0);
    pageWords = voteWords([pageWords, wordsOf(await ocrWords(bcv, 3))], dictSet);
  }
  if (ocrOptions.reread) pageWords = await rereadWeakSpots(cv, binImg, pageWords, px);
  return pageWords;
}
// engine of the last full-page reading ('paddle' | 'tesseract' | 'fused'), for tests / debugging
let lastEngine = null;
export const lastOcrEngine = () => lastEngine;

// crop-by-crop re-read (single line, psm 7) of ink no word covers (lone
// numbers in table cells) and of weak short words; a number-like result is
// read once more with a digit whitelist. A reading is only taken when it is
// more confident than what was there.
async function rereadWeakSpots(cv, binImg, words, px) {
  const jobs = [];
  for (const b of unreadInkBoxes(binImg, words, px)) jobs.push({ box: b, old: null });
  for (const w of words) {
    const conf = w.confidence ?? 0, t = (w.text || '').trim();
    if (conf < 75 && t.length <= 6 && jobs.length < 220) jobs.push({ box: w.bbox, old: w });
  }
  const out = words.slice();
  const pad = (b) => Math.max(4, Math.round(0.35 * (b.y1 - b.y0)));
  for (const j of jobs) {
    const p = pad(j.box);
    const { c, x0, y0 } = crop(cv, j.box, p);
    if (c.width < 6 || c.height < 6) continue;
    // white frame: Tesseract reads a word touching the image edge badly
    const fr = document.createElement('canvas'); fr.width = c.width + 20; fr.height = c.height + 20;
    const fg = fr.getContext('2d'); fg.fillStyle = '#fff'; fg.fillRect(0, 0, fr.width, fr.height); fg.drawImage(c, 10, 10);
    const best = (ws) => { const a = wordsOf(ws).filter((w) => (w.text || '').trim()); if (!a.length) return null; return { text: a.map((w) => w.text).join(' '), confidence: Math.min(...a.map((w) => w.confidence ?? 0)) }; };
    let r = best(await ocrWords(fr, 7));
    if (r && /\d/.test(r.text) && NUMLIKE.test(r.text.replace(/\s+/g, ''))) {
      const d = best(await ocrWords(fr, 7, { whitelist: '0123456789/.,()%-' }));
      if (d && d.confidence > r.confidence) r = d;
    }
    if (!r || !/[\p{L}\p{N}]/u.test(r.text)) continue;
    const bbox = { x0: x0, y0: y0, x1: x0 + c.width, y1: y0 + c.height };
    const tight = { x0: Math.max(bbox.x0, j.box.x0), y0: Math.max(bbox.y0, j.box.y0), x1: Math.min(bbox.x1, j.box.x1), y1: Math.min(bbox.y1, j.box.y1) };
    if (j.old) {
      if (r.confidence > (j.old.confidence ?? 0) + 5) out[out.indexOf(j.old)] = { ...j.old, text: r.text, confidence: r.confidence, reread: true };
    } else if (r.confidence >= 60) {
      out.push({ text: r.text, confidence: r.confidence, bbox: tight, reread: true });
    }
  }
  return out;
}

const toUrl = (p) => {
  const pc = document.createElement('canvas'); pc.width = p.w; pc.height = p.h;
  pc.getContext('2d').putImageData(new ImageData(p.data, p.w, p.h), 0, 0);
  return pc.toDataURL('image/png');
};

export const ocrScan = {
  // rect (page pt) -> seeds for the area editor; skip = page rects already
  // read in this session (their originals are covered on the stage)
  // textRects = real (editable) text in the area: masked out before reading,
  // and a word lying over it (>30 %) is dropped - never a second copy
  async ocrSeeds(page, rect, { skip = [], textRects = [] } = {}) {
    const view = this.workspace.view(page.id);
    if (!view || rect.w < 3 || rect.h < 3) return { seeds: [] };
    // ~5 px per pt (about 360 dpi), at most ~10 MP
    const px = Math.max(1.5, Math.min(5, Math.sqrt(1e7 / (rect.w * rect.h))));
    const P = (v) => v / px;
    const cv = composeRegion(view, rect, px);
    const orig = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); // for the looks / covers
    const toPx = (r) => ({ x0: (r.x - rect.x) * px, y0: (r.y - rect.y) * px, x1: (r.x + r.w - rect.x) * px, y1: (r.y + r.h - rect.y) * px });
    const real = textRects.map(toPx).filter((b) => b.x1 > 0 && b.y1 > 0 && b.x0 < cv.width && b.y0 < cv.height);
    maskRects(cv, real, Math.max(1, Math.round(0.6 * px)));
    const { words } = await readCanvas(cv, { minH: Math.round(3 * px) });
    const img = orig;
    const overReal = (bb) => { const a = Math.max(1, (bb.x1 - bb.x0) * (bb.y1 - bb.y0)); let s = 0; for (const r of real) s += Math.max(0, Math.min(bb.x1, r.x1) - Math.max(bb.x0, r.x0)) * Math.max(0, Math.min(bb.y1, r.y1) - Math.max(bb.y0, r.y0)); return s / a > 0.3; };
    const inSkip = (bb) => skip.some((r) => { const cx = rect.x + P((bb.x0 + bb.x1) / 2), cy = rect.y + P((bb.y0 + bb.y1) / 2); return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h; });
    const groups = groupWords(words.filter((w) => !inSkip(w.bbox) && !overReal(w.bbox)), (w) => sampleBg(img, w.bbox));
    const lineItems = [];
    for (const g of groups) {
      const hPx = g.bbox.y1 - g.bbox.y0;
      if (hPx < 5) continue;
      const sz = sizeFor(g.text, hPx);
      const look = lineLook(img, g.bbox, sz.size);
      lineItems.push({ ...g, sz, look });
    }
    const blocks = groupLines(lineItems, img);
    const seeds = [];
    for (const blk of blocks) {
      const first = blk.lines[0], last = blk.lines[blk.lines.length - 1];
      const avgSzPx = blk.lines.reduce((s, l) => s + l.sz.size, 0) / blk.lines.length;
      const box = { x: rect.x + P(blk.bbox.x0), y: rect.y + P(blk.bbox.y0), w: P(blk.bbox.x1 - blk.bbox.x0), h: P(blk.bbox.y1 - blk.bbox.y0) };
      const size = P(avgSzPx);
      const firstBase = rect.y + P(first.bbox.y1 - first.sz.baselineFromBottom);
      const lastBase = rect.y + P(last.bbox.y1 - last.sz.baselineFromBottom);
      const lineStep = blk.lines.length > 1 ? Math.max(size * 0.9, (lastBase - firstBase) / (blk.lines.length - 1)) : size * 1.25;
      const style = { c: toHex(first.look.ink), f: 'lib:LiberationSans' };
      if (first.look.bold) style.b = true;
      const bgHex = toHex(first.look.dominant);
      const patches = blk.lines.map((l) => {
        const p = l.look.patch;
        return { dataUrl: toUrl(p), x: rect.x + P(p.x), y: rect.y + P(p.y), w: P(p.w), h: P(p.h) };
      });
      seeds.push({
        text: blk.lines.map((l) => l.text).join('\n'),
        lines: blk.lines.map((l) => l.text),
        lineCount: blk.lines.length,
        lineStep,
        size,
        x: box.x - 1,
        y: firstBase - 0.82 * size - 1,
        w: Math.max(16, box.w + Math.max(4, size * 0.25)),
        h: box.h,
        style,
        bgHex,
        flat: blk.lines.every((l) => l.look.flat),
        orig: box,
        patch: patches[0],
        patches,
      });
    }
    return { seeds, onlyReal: !seeds.length && real.length > 0 };
  },

  // "Bir alanı eski hâline döndür" (tool 'restoreArea'): one undo step
  async restoreArea(page, rect) {
    if (!page || !rect || rect.w < 2 || rect.h < 2) return;
    if (this.setTool) this.setTool('select');
    // a cleaned page: the words were painted out in the cleaned picture, so
    // that part of the picture is cleaned again from the original page
    const cb = page.blocks.find((b) => b._cleanBg && b.inserted && b.inserted.type === 'image');
    let newImg = null;
    if (cb && this.rasters && page.srcIndex !== null && page.srcIndex !== undefined) {
      try {
        const im = new Image(); im.src = imgSrc(cb.inserted); await im.decode();
        const W = im.naturalWidth, H = im.naturalHeight, px = W / page.w;
        const raster = await this.rasters.make(page, px, false);
        const rc = document.createElement('canvas'); rc.width = W; rc.height = H;
        const rg = rc.getContext('2d'); rg.fillStyle = '#fff'; rg.fillRect(0, 0, W, H); rg.drawImage(raster, 0, 0, W, H);
        const cl = cleanScanImage(rg.getImageData(0, 0, W, H), px);
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d'); g.drawImage(im, 0, 0);
        const x0 = Math.max(0, Math.floor(rect.x * px)), y0 = Math.max(0, Math.floor(rect.y * px));
        const x1 = Math.min(W, Math.ceil((rect.x + rect.w) * px)), y1 = Math.min(H, Math.ceil((rect.y + rect.h) * px));
        if (x1 > x0 && y1 > y0) g.putImageData(new ImageData(cl.data, W, H), 0, 0, x0, y0, x1 - x0, y1 - y0);
        const url = c.toDataURL('image/png');
        newImg = putImage(url.length > 6e6 ? c.toDataURL('image/jpeg', 0.92) : url);
      } catch (e) { console.warn('restoreArea: cleaned picture not updated', e); }
    }
    this.controller.commit(page, 'restoreArea', (p) => {
      if (newImg) { const b = p.blocks.find((x) => x.id === cb.id); if (b) b.inserted = { ...b.inserted, imgId: newImg }; }
      return restoreOriginalArea(p, rect);
    });
    if (this.scheduleSave) this.scheduleSave();
    toast(t('restoreAreaDone'));
  },

  // a page with (almost) no real text is a scan / photo: only there the
  // background can be cleaned (the page becomes one cleaned picture)
  isScannedPage(page) {
    if (!page || page.srcIndex === null || page.srcIndex === undefined) return false;
    const an = this.session.analysis(page.srcIndex);
    let n = 0;
    for (const l of (an && an.seg && an.seg.textAtoms) || []) if (!l.decor) for (const g of l.glyphs) if (!g.space && g.uni && /\S/.test(g.uni)) n++;
    return n < 40;
  },

  async scanPageDialog() {
    const page = this.currentPage();
    if (!page) return;
    const res = await openScanDialog({ scanned: this.isScannedPage(page) });
    if (res) await this.scanCurrentPage(res);
  },

  async scanCurrentPage(opts = {}) {
    const page = this.currentPage();
    if (!page) return;
    return this.scanPageRegion(page, { x: 0, y: 0, w: page.w, h: page.h }, { fullPage: true, ...opts });
  },

  // The page raster at the OCR resolution itself (with deleted / erased spots
  // painted like on screen). Stretching the on-screen raster (often ~1.3 px/pt)
  // up to 3-3.5 px/pt blurred every letter. Very large pages keep the screen one.
  async ocrBase(view, page, px) {
    const have = view.base && view.base.width && page.w ? view.base.width / page.w : 0;
    if (!this.rasters || page.srcIndex === null || page.srcIndex === undefined || have >= px * 0.95 || page.w * page.h * px * px > 40e6) return view.base;
    try {
      const raster = await this.rasters.make(page, px, !!page.whiteBg);
      const c = document.createElement('canvas');
      view.drawBase.call({ base: c, page: view.page, natural: () => view.natural(), holes: () => view.holes() }, raster, px);
      return c;
    } catch (e) {
      console.warn('OCR: sharp page render failed, using the screen raster', e);
      return view.base;
    }
  },

  async scanPageRegion(page, rawRect, { fullPage = false, mode = 'quality', cleanBg = false } = {}) {
    if (!page || !rawRect) return;
    const view = this.workspace.view(page.id);
    if (!view) return;
    if (!fullPage && this.setTool) this.setTool('select');
    const rx = Math.max(0, Math.min(page.w, rawRect.x));
    const ry = Math.max(0, Math.min(page.h, rawRect.y));
    const rect = {
      x: rx,
      y: ry,
      w: Math.max(0, Math.min(page.w - rx, rawRect.w)),
      h: Math.max(0, Math.min(page.h - ry, rawRect.h)),
    };
    if (rect.w < 4 || rect.h < 4) return;
    showLoading(t('ocrPageReading'));
    let digitized = null, origCv = null, hasReal = false, cleanPage = null, pxUsed = 0;
    try {
      this.session.ensurePage(page);
      const basePx = view.base && view.base.width && page.w ? view.base.width / page.w : 0;
      const px = fullPage
        ? Math.max(3.0, Math.min(3.5, basePx >= 2.6 && basePx <= 3.6 ? basePx : Math.sqrt(9e6 / Math.max(1, page.w * page.h))))
        : Math.max(3.0, Math.min(5.0, Math.sqrt(4e6 / Math.max(1, rect.w * rect.h))));
      const baseCv = await this.ocrBase(view, page, px);
      const cv = composeRegion(view, rect, px, baseCv);
      pxUsed = px;
      // "Arka planı temizle": the page picture itself (no edits on it), cleaned
      if (fullPage && cleanBg && this.isScannedPage(page)) {
        const bc = document.createElement('canvas'); bc.width = cv.width; bc.height = cv.height;
        const bg = bc.getContext('2d'); bg.fillStyle = '#fff'; bg.fillRect(0, 0, bc.width, bc.height);
        if (baseCv.width) bg.drawImage(baseCv, 0, 0, bc.width, bc.height);
        cleanPage = cleanScanImage(bg.getImageData(0, 0, bc.width, bc.height), px);
      }
      const orig = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      origCv = document.createElement('canvas'); origCv.width = cv.width; origCv.height = cv.height;
      origCv.getContext('2d').putImageData(orig, 0, 0);
      const struct = detectPageStructure(orig, px);
      const real = [];
      const addReal = (x0, y0, x1, y1) => {
        const px0 = (x0 - rect.x) * px, py0 = (y0 - rect.y) * px, px1 = (x1 - rect.x) * px, py1 = (y1 - rect.y) * px;
        if (px1 > 0 && px0 < cv.width && py1 > 0 && py0 < cv.height) real.push({ x0: px0, y0: py0, x1: px1, y1: py1 });
      };
      const an = page.srcIndex !== null && page.srcIndex !== undefined ? this.session.analysis(page.srcIndex) : null;
      for (const b of page.blocks || []) {
        if (b.inserted) {
          addReal(b.x, b.y, b.x + b.bw * (b.s || 1), b.y + b.bh * (b.s || 1));
          continue;
        }
        for (const p of b.parts || []) {
          if (p.addedText && p.src) {
            const bx = b.x + p.dx * (b.s || 1), by = b.y + p.dy * (b.s || 1);
            addReal(bx, by, bx + p.dw * (b.s || 1) * (p.sc || 1), by + p.dh * (b.s || 1) * (p.sc || 1));
          }
        }
      }
      for (const l of (an && an.seg && an.seg.textAtoms) || []) {
        if (l.decor) continue;
        for (const g of l.glyphs) {
          if (g.space || !g.uni || /^[\s\uFFFD]*$/.test(g.uni)) continue;
          addReal(g.b.x0, g.b.y0, g.b.x1, g.b.y1);
        }
      }
      hasReal = real.length > 0;
      // PaddleOCR reads the untouched grey page (its detector was trained on
      // real photos/scans); Tesseract gets the cleaned black-and-white one
      let rawCv = null;
      if (ocrOptions.paddleInput === 'raw') {
        rawCv = document.createElement('canvas'); rawCv.width = cv.width; rawCv.height = cv.height;
        rawCv.getContext('2d').putImageData(orig, 0, 0);
        maskRects(rawCv, real, Math.max(1, Math.round(0.6 * px)));
      }
      const cleanImg = preprocessForOcr(orig, struct);
      cv.getContext('2d').putImageData(new ImageData(cleanImg.data, cleanImg.width, cleanImg.height), 0, 0);
      // logo zones are NOT painted out before reading: on scans, dense table
      // cells / handwriting are often taken for emblems and their text was lost.
      // A word inside a logo zone is kept only when Tesseract is confident.
      maskRects(cv, real, Math.max(1, Math.round(0.6 * px)));
      const dict = await loadTrDict().catch(() => null);
      // Hızlı: PaddleOCR alone. Kaliteli: Tesseract and PaddleOCR at the same
      // time, then word-by-word voting (ocrFusion). Paddle failing to load /
      // run never stops the scan: Tesseract reads alone then.
      const wantPaddle = paddleAvailable() && (mode === 'fast' || ocrOptions.fuse);
      const padP = wantPaddle
        ? paddleWords(rawCv || cv, { progress: (pct) => showLoading(`${t('ocrModelLoading')} %${pct}`) })
          .then((lines) => wordsOf(lines).map((w) => ({ ...w, text: restoreTurkishLetters(w.text, dict) })))
          .catch((e) => { console.warn('PaddleOCR failed, using Tesseract', e); if (mode === 'fast') toast(t('ocrPaddleFallback')); return null; })
        : Promise.resolve(null);
      let pageWords = null, fused = false;
      if (mode === 'fast') {
        pageWords = await padP;
        if (pageWords) lastEngine = 'paddle';
        showLoading(t('ocrPageReading'));
      }
      if (!pageWords) {
        const [tw, pw] = await Promise.all([tesseractPageWords(cv, px, dict), mode === 'fast' ? null : padP]);
        showLoading(t('ocrPageReading'));
        pageWords = pw ? fuseWords(tw, pw, dict, { tessOnlyMin: ocrOptions.tessOnlyMin }) : tw;
        if (pw) { fused = true; lastEngine = 'fused'; }
      }
      const dictSet = dict;
      const overReal = (bb) => {
        const a = Math.max(1, (bb.x1 - bb.x0) * (bb.y1 - bb.y0));
        let s = 0;
        for (const r of real) s += Math.max(0, Math.min(bb.x1, r.x1) - Math.max(bb.x0, r.x0)) * Math.max(0, Math.min(bb.y1, r.y1) - Math.max(bb.y0, r.y0));
        return s / a > 0.3;
      };
      // signatures, stamps, pen-written dates and logos: only certain words
      const markOpts = { fused, known: (tx) => isKnownTurkishWord(tx, dict), minConf: lastEngine === 'paddle' ? 95 : 88 };
      // areas the user gave back to the original image ("eski hâline döndür")
      const keep = (page.keepOriginal || []).map((r) => ({ x0: (r.x - rect.x) * px, y0: (r.y - rect.y) * px, x1: (r.x + r.w - rect.x) * px, y1: (r.y + r.h - rect.y) * px }));
      const inKeep = (bb) => { const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2; return keep.some((k) => cx >= k.x0 && cx <= k.x1 && cy >= k.y0 && cy <= k.y1); };
      const cleanWords = pageWords.filter((w) => w && w.bbox && !overReal(w.bbox) && !inKeep(w.bbox) && !(ocrOptions.marks && inMarkUnsure(w, orig, struct, markOpts)));
      pruneRulesPiercingWords(struct, cleanWords);
      const lines = reconstructLines(cleanWords, orig, struct, px);
      rebaseBoldLines(lines, px);
      harmonizeLabelLines(lines, struct);
      const segBlocks = segmentOcrLines(lines, struct, px);
      digitized = buildDigitizedBlocks(segBlocks, { px, rect, struct, dictSet });
    } catch (e) {
      console.error(e);
      hideLoading();
      toast(t('ocrFail'), { error: true });
      return;
    }
    hideLoading();
    if (!digitized || !digitized.blocks.length) {
      toast(t(hasReal ? 'ocrOnlyReal' : 'ocrNone'));
      return;
    }

    const built = [];
    for (const item of digitized.blocks) {
      const box = item.origBox || { x: item.x, y: item.y, w: item.w, h: item.h };
      const maxAllowW = item.cellMaxW ? Math.min(page.w - box.x - 4, item.cellMaxW) : Math.min(page.w - box.x - 4, box.w * 1.15 + 6);
      const banH = item.bannerPt ? Math.max(8, item.bannerPt.y1 - item.bannerPt.y0 - 1.5) : Infinity;
      const initSize = Math.max(6.5, Math.min(48, Math.round((item.rawSz || item.size || 11) * 10) / 10));
      const scaleSize = (sz) => {
        const ratio = sz / Math.max(1, ins.size);
        ins.size = sz;
        if (item.origLineCount > 1 && item.lastBase && item.firstBase) {
          ins.lineStep = Math.max(sz * 1.02, Math.min(sz * 1.7, (item.lastBase - item.firstBase) / (item.origLineCount - 1)));
        } else if (ins.lineStep) {
          ins.lineStep = Math.max(sz * 1.02, ins.lineStep * ratio);
        }
        if (ins.paraGap) ins.paraGap *= ratio;
      };
      const ins = {
        type: 'text',
        paras: item.paras.map((p) => ({ text: p.text })),
        size: initSize,
        lineStep: item.lineStep,
        paraGap: item.paraGap || 0,
        align: item.align,
        font: item.bold ? 'Carlito-Bold.ttf' : 'Carlito-Regular.ttf',
        color: item.color,
        ocrBgHex: item.ocrBgHex,
        maxW: item.flowing ? Math.min(maxAllowW, box.w + 4) : Infinity,
        box: null,
      };
      let L = await layoutInserted(ins);
      let inkW = Math.max(1, ...(L.lines || []).map((ln) => ln.width));
      // Bidirectional size fit: gently scale UP when Carlito renders narrower (capped at 1.14x
      // and skipped on tall mixed/handwritten lines), then prevent overflow across cell walls & banners
      const mixedTall = (item.origLineCount || 1) >= 2 && box.h / item.origLineCount > initSize * 1.8;
      if (!mixedTall && inkW < box.w * 0.92 && L.h < Math.min(banH - 2, box.h * 1.12)) {
        const upW = (box.w * 0.96) / inkW;
        const upH = Math.min(
          Number.isFinite(banH) ? (banH - 1.5) / Math.max(1, L.h + 3) : 1.14,
          (box.h * 1.1) / Math.max(1, L.h),
        );
        const upK = Math.min(upW, upH, maxAllowW / inkW, 1.14);
        if (upK > 1.04) {
          scaleSize(Math.min(48, Math.round(ins.size * upK * 10) / 10));
          L = await layoutInserted(ins);
          inkW = Math.max(1, ...(L.lines || []).map((ln) => ln.width));
        }
      }
      for (let it = 0; it < 8 && ins.size > 6.0; it++) {
        const tooWide = inkW > maxAllowW + 0.5;
        const tooManyLines = !item.flowing && L.lines.length > (item.origLineCount || item.paras.length);
        const tooTall = L.h > box.h * 1.18 + 3 || (item.bannerPt && L.h + 4 > item.bannerPt.y1 - item.bannerPt.y0 - 0.5);
        if (!tooWide && !tooManyLines && !tooTall) break;
        const k = Math.min(
          tooWide ? maxAllowW / Math.max(1, inkW) : 1,
          L.h > box.h * 1.18 + 3 ? (box.h * 1.1) / Math.max(1, L.h) : 1,
          item.bannerPt ? banH / Math.max(1, L.h + 4) : 1,
          0.94,
        );
        scaleSize(Math.max(6.0, Math.round(ins.size * Math.max(0.75, k) * 10) / 10));
        L = await layoutInserted(ins);
        inkW = Math.max(1, ...(L.lines || []).map((ln) => ln.width));
      }
      ins.maxW = ins.align === 'center'
        ? Math.max(box.w + 2, Math.ceil(inkW) + 5)
        : (item.flowing ? Math.min(maxAllowW, Math.max(box.w + 2, Math.ceil(inkW) + 5)) : Math.min(page.w - box.x - 4, Math.max(box.w + 2, Math.ceil(inkW) + 5)));
      L = await layoutInserted(ins);
      const F = insFrame(ins, L);
      const line0Base = L.lines && L.lines[0] ? L.lines[0].baseline : ins.size * 0.95;
      let bx = ins.align === 'center' ? box.x + (box.w - F.bw) * 0.5 : box.x - F.ox;
      let by = item.firstBase ? item.firstBase - (F.oy + line0Base) : box.y;
      if (item.bannerPt) {
        const bTop = item.bannerPt.y0, bBot = item.bannerPt.y1;
        by = (bBot - bTop) <= F.bh + 1 ? bTop + (bBot - bTop - F.bh) * 0.5 : Math.max(bTop + 0.5, Math.min(bBot - F.bh - 0.5, by));
        bx = Math.max(item.bannerPt.x0 + 2, Math.min(item.bannerPt.x1 - F.bw - 2, bx));
      }
      bx = Math.max(4, Math.min(page.w - F.bw - 4, bx));
      by = Math.max(4, Math.min(page.h - F.bh - 4, by));
      const eraseRects = item.eraseRects.map((er) => (er.inBanner ? er : clampRectAwayFromStructure(er, item.struct, 0.7))).filter(Boolean);
      built.push({
        block: {
          id: item.blockId, kind: 'inserted',
          x: bx, y: by, s: 1,
          bw: F.bw, bh: F.bh, parts: [], free: false,
          ocrBgHex: item.ocrBgHex, _ocrBlock: true,
          inserted: ins, _ocrParas: item.paras, _ocrLines: item.paras,
        },
        eraseRects,
      });
    }

    // cleaned page: the OCR'd words are simply painted out with the paper
    // tone in the cleaned picture, which replaces the page image (one block
    // at the back); the original page content is hidden under a white hole
    let cleanBlock = null;
    if (cleanPage) {
      const c = document.createElement('canvas'); c.width = cleanPage.width; c.height = cleanPage.height;
      const g = c.getContext('2d');
      g.putImageData(new ImageData(cleanPage.data, cleanPage.width, cleanPage.height), 0, 0);
      // each word box takes the median colour of the cleaned picture just
      // around it (paper tone on paper, the banner's tone in a dark banner)
      const { data: cd, width: CW, height: CH } = cleanPage;
      const ringColour = (x0, y0, x1, y1) => {
        const ch = [[], [], []];
        const take = (x, y) => { if (x < 0 || y < 0 || x >= CW || y >= CH) return; const i = (y * CW + x) * 4; ch[0].push(cd[i]); ch[1].push(cd[i + 1]); ch[2].push(cd[i + 2]); };
        for (let x = x0; x <= x1; x += 2) { take(x, y0 - 2); take(x, y1 + 2); }
        for (let y = y0; y <= y1; y += 2) { take(x0 - 2, y); take(x1 + 2, y); }
        if (!ch[0].length) return `rgb(${cleanPage.paper},${cleanPage.paper},${cleanPage.paper})`;
        const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
        return `rgb(${med(ch[0])},${med(ch[1])},${med(ch[2])})`;
      };
      const fills = [];
      for (const entry of built) for (const er of entry.eraseRects) {
        const x0 = Math.floor(er.x * pxUsed), y0 = Math.floor(er.y * pxUsed), x1 = Math.ceil((er.x + er.w) * pxUsed), y1 = Math.ceil((er.y + er.h) * pxUsed);
        fills.push([x0, y0, x1, y1, ringColour(x0, y0, x1, y1)]);
      }
      for (const [x0, y0, x1, y1, c] of fills) { g.fillStyle = c; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
      let url = c.toDataURL('image/png');
      if (url.length > 6e6) url = c.toDataURL('image/jpeg', 0.92);
      const hex = '#' + cleanPage.paper.toString(16).padStart(2, '0').repeat(3);
      cleanBlock = { id: newId('b'), kind: 'inserted', x: 0, y: 0, s: 1, bw: page.w, bh: page.h, parts: [], inserted: { type: 'image', imgId: putImage(url) }, free: true, behind: true, _cleanBg: true };
      const dark = (hx) => typeof hx === 'string' && /^#[0-9a-f]{6}$/i.test(hx) && parseInt(hx.slice(1, 3), 16) + parseInt(hx.slice(3, 5), 16) + parseInt(hx.slice(5, 7), 16) < 384;
      for (const entry of built) if (!dark(entry.block.ocrBgHex || entry.block.inserted.ocrBgHex)) { entry.block.ocrBgHex = hex; entry.block.inserted.ocrBgHex = hex; }
    }
    const createdIds = built.map((b) => b.block.id);
    this.controller.commit(page, 'ocrPage', (p) => {
      if (cleanBlock) {
        eraseArea(p, { x: 0, y: 0, w: p.w, h: p.h }, 'white', null, this.session, { cleanBgId: cleanBlock.id });
        p.blocks.unshift(cleanBlock);
      }
      for (const entry of built) {
        if (cleanBlock) { entry.block.free = false; if (collides(p, entry.block, entry.block)) entry.block.free = true; p.blocks.push(entry.block); continue; }
        for (const er of entry.eraseRects) {
          eraseArea(p, { x: er.x, y: er.y, w: er.w, h: er.h }, 'natural', { type: 'solid', c: er.c }, this.session, { ocrId: entry.block.id });
        }
        entry.block.free = false;
        if (collides(p, entry.block, entry.block)) entry.block.free = true;
        p.blocks.push(entry.block);
      }
      return true;
    });
    if (this.session.magnet !== false) {
      this.session.magnet = false;
      if (this.refreshRibbon) this.refreshRibbon();
      if (this.scheduleSave) this.scheduleSave();
    }
    if (createdIds.length) this.select(page, [createdIds[0]]);

    const suspects = digitized.suspects.map((s) => ({
      ...s,
      cropDataUrl: cropWordDataUrl(origCv, s.bboxPx),
    }));
    if (suspects.length) {
      openOcrVerifyPanel({
        app: this, page, suspects,
        onApplyWord: async (sus, newText) => {
          const cur = findBlock(page, sus.blockId);
          if (!cur) return;
          const pi = sus.paraIdx ?? sus.lineIdx;
          // measure on a copy: the real block may only change inside commit(),
          // otherwise the fix is in the undo snapshot already (not undoable)
          // and an unchanged frame size meant no redraw / no autosave at all
          const probe = JSON.parse(JSON.stringify({ inserted: cur.inserted, _ocrParas: cur._ocrParas, _ocrLines: cur._ocrLines }));
          if (!applyWordCorrection(probe, pi, sus.wordIdx, newText)) return;
          const F = insFrame(probe.inserted, await layoutInserted(probe.inserted));
          this.controller.commit(page, 'ocrFix', (p) => {
            const blk = findBlock(p, sus.blockId);
            if (!blk || !applyWordCorrection(blk, pi, sus.wordIdx, newText)) return false;
            blk.bw = F.bw; blk.bh = F.bh;
            return true;
          });
        },
      });
    } else {
      toast(t('ocrPageDoneClean'));
    }
  },
};
