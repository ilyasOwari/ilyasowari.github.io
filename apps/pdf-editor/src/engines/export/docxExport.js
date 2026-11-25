// Builds a Word (.docx) package from an EditSession:
// - Fixed-position text boxes with real paragraphs (no line-by-line splitting)
// - Native Word tables (<w:tbl>) with column widths and cellFill() shading
// - Positioned raster images (<wp:anchor> + <pic:pic>)
// - Decorative lines, borders, shapes, watermarks and backgrounds are excluded
import { PDFDocument } from '../../../vendor/pdf-lib.esm.min.js';
import { FontCache } from '../pdf/fonts.js';
import { analyzePage } from '../pdf/analyze.js';
import { loadStd14 } from '../pdf/std14.js';
import { openAllModels } from '../text/editSession.js';
import { findClusters } from '../text/textModel.js';
import { styleAt, glyphIsBold, glyphIsItalic } from '../text/richStyle.js';
import { cbDocxSymbol } from '../text/checkBoxOps.js';
import { toWordFont } from '../text/wordFonts.js';
import { insParas } from '../text/insertedLayout.js';
import { cellFill, migrateTableStyle } from '../../core/tableStyle.js';
import { srcIndexOf } from '../../model/blockState.js';
import { imgSrc } from '../../core/imageStore.js';
import { dataUrlToBytes } from './inserted.js';
import { makeZipBytes } from './zipStore.js';
import {
  contentTypesXml,
  rootRelsXml,
  docRelsXml,
  stylesXml,
  sectionPrXml,
  renderFlowItems,
  documentXml,
  rgbToHex6,
  fillToHex6,
} from './docxXml.js';

function fontLookupMap(an) {
  const byId = new Map();
  for (const g of (an && an.seg && an.seg.glyphs) || []) {
    if (g && g.g && g.g.font) byId.set(String(g.g.font.id), g.g.font);
  }
  return byId;
}

function modelLineStepPt(model, scale, baseSizePt) {
  const step = model.area && model.area.step;
  return step && step > 0 ? step * scale : baseSizePt * 1.25;
}

function modelToDocxParas(model, an, scale = 1) {
  const byId = fontLookupMap(an);
  const firstG = (model.charGlyph && model.charGlyph.find(Boolean))
    || (model.origCharGlyph && model.origCharGlyph.find(Boolean))
    || model.refGlyph
    || (model.lines && model.lines[0] && model.lines[0].glyphs && model.lines[0].glyphs.find(Boolean))
    || null;
  const fallbackSizePt = ((firstG && firstG.g && firstG.g.size) || (model.lines && model.lines[0] && model.lines[0].size) || 11) * scale;
  const lineStepPt = modelLineStepPt(model, scale, fallbackSizePt);
  const paraGapPt = model.area && model.area.paraGap > 0 ? model.area.paraGap * scale : 0;
  const paras = model.paras && model.paras.length ? model.paras : [{ text: '', marker: false }];

  const out = [];
  let charOffset = 0;
  let lastRealG = firstG;

  const buildRunForChar = (p, j, ch, absIdx) => {
    const rawGl = model.charGlyph && model.charGlyph[absIdx];
    if (rawGl) lastRealG = rawGl;
    const gl = rawGl || lastRealG;
    const st = styleAt(p, j);

    let srcFont = gl && gl.g ? gl.g.font : null;
    if (st && st.f) {
      if (st.f.startsWith('lib:')) srcFont = st.f.slice(4);
      else if (st.f.startsWith('orig:')) srcFont = byId.get(st.f.slice(5)) || srcFont;
      else srcFont = st.f;
    }

    const bold = st && ('b' in st) ? !!st.b : (gl && gl.g ? glyphIsBold(gl.g) : false);
    const italic = st && ('i' in st) ? !!st.i : (gl && gl.g ? glyphIsItalic(gl.g) : false);
    const wf = toWordFont(srcFont, { bold, italic });
    const underline = !!(st && st.u);
    const colorHex = (st && st.c) ? fillToHex6(st.c, '000000') : fillToHex6(gl && gl.g && gl.g.fill, '000000');

    let sizePt = (gl && gl.g && gl.g.size) || (model.lines && model.lines[0] && model.lines[0].size) || 11;
    if (st && st.z > 0) sizePt = st.z;
    else if (st && st.k > 0) sizePt *= st.k;
    if (st && st.v) sizePt *= 0.65;
    sizePt = Math.max(4, Math.round(sizePt * scale * 2) / 2);

    const sig = `${wf.wordName}|${sizePt}|${bold ? 1 : 0}|${italic ? 1 : 0}|${underline ? 1 : 0}|${colorHex}`;
    return { sig, text: ch, fontName: wf.wordName, sizePt, bold, italic, underline, colorHex };
  };

  const runsOfRange = (p, startJ, endJ, baseAbs) => {
    const runs = [];
    for (let j = startJ; j < endJ; j++) {
      const ch = Array.from(p.text || '')[j];
      const item = buildRunForChar(p, j, ch, baseAbs + j);
      const last = runs[runs.length - 1];
      if (last && last._sig === item.sig) last.text += item.text;
      else runs.push({ _sig: item.sig, text: item.text, fontName: item.fontName, sizePt: item.sizePt, bold: item.bold, italic: item.italic, underline: item.underline, colorHex: item.colorHex });
    }
    return runs.length
      ? runs.map(({ _sig, ...r }) => r)
      : [{ text: '', fontName: toWordFont(firstG && firstG.g && firstG.g.font).wordName, sizePt: fallbackSizePt, bold: false, italic: false, underline: false, colorHex: '000000' }];
  };

  const lineEnds = Array.isArray(model.lineEndAt) ? model.lineEndAt : [];
  for (let pi = 0; pi < paras.length; pi++) {
    const p = paras[pi];
    const text = p.text || '';
    const arr = Array.from(text);
    const align = p.align || (model.align === 'center' ? 'center' : 'left');
    const firstIndentPt = (align === 'left' && model.paraIndent && model.paraIndent[pi] && model.indent > 0) ? model.indent * scale : 0;
    const spaceAfterPt = pi < paras.length - 1 ? paraGapPt : 0;

    const splitPts = align === 'center'
      ? [...new Set(lineEnds.map((e) => e - charOffset).filter((e) => e > 0 && e < arr.length))].sort((a, b) => a - b)
      : [];

    const cbRun = (p.cb && p.cb.pos) ? {
      text: p.cb.pos === 'left' ? `${cbDocxSymbol(p.cb.shape)} ` : `  ${cbDocxSymbol(p.cb.shape)}`,
      fontName: 'Calibri',
      sizePt: Math.max(4, Math.round(fallbackSizePt * 2) / 2),
      bold: false, italic: false, underline: false,
      colorHex: fillToHex6(p.cb.bc, '334155'),
    } : null;

    if (splitPts.length > 0) {
      let curStart = 0;
      const bounds = [...splitPts, arr.length];
      const added = [];
      for (let bi = 0; bi < bounds.length; bi++) {
        let sIdx = curStart;
        const eIdx = bounds[bi];
        if (bi > 0) while (sIdx < eIdx && arr[sIdx] === ' ') sIdx++;
        if (sIdx < eIdx || bounds.length === 1) {
          added.push({
            align,
            firstIndentPt: 0,
            spaceBeforePt: 0,
            spaceAfterPt: bi === bounds.length - 1 ? spaceAfterPt : 0,
            lineStepPt,
            runs: runsOfRange(p, sIdx, eIdx, charOffset),
          });
        }
        curStart = bounds[bi];
      }
      if (cbRun && added.length) {
        if (p.cb.pos === 'left') added[0].runs.unshift(cbRun);
        else added[added.length - 1].runs.push({ ...cbRun });
      }
      out.push(...added);
    } else {
      const runs = runsOfRange(p, 0, arr.length, charOffset);
      if (cbRun) {
        if (p.cb.pos === 'left') runs.unshift(cbRun);
        else runs.push(cbRun);
      }
      out.push({
        align,
        firstIndentPt,
        spaceBeforePt: 0,
        spaceAfterPt,
        lineStepPt,
        runs,
      });
    }

    charOffset += arr.length + 1;
  }

  return out;
}

function insertedToDocxParas(ins, scale = 1) {
  const wfBase = toWordFont(ins.font || 'Carlito-Regular.ttf');
  const baseSize = (ins.size || 14) * scale;
  const defHex = ins.color ? rgbToHex6(ins.color) || '000000' : '000000';
  const lineStepPt = baseSize * 1.25;

  return insParas(ins).map((p) => {
    const arr = Array.from(p.text || '');
    const runs = [];
    for (let j = 0; j < arr.length; j++) {
      const st = styleAt(p, j);
      const srcFont = st && st.f ? (st.f.startsWith('lib:') ? st.f.slice(4) : st.f) : (ins.font || 'Carlito-Regular.ttf');
      const bold = st && ('b' in st) ? !!st.b : wfBase.bold;
      const italic = st && ('i' in st) ? !!st.i : wfBase.italic;
      const wf = toWordFont(srcFont, { bold, italic });
      const underline = !!(st && st.u);
      const colorHex = (st && st.c) ? fillToHex6(st.c, defHex) : defHex;
      let sizePt = st && st.z > 0 ? st.z * scale : baseSize * ((st && st.k) || 1);
      if (st && st.v) sizePt *= 0.65;
      sizePt = Math.max(4, Math.round(sizePt * 2) / 2);

      const sig = `${wf.wordName}|${sizePt}|${bold ? 1 : 0}|${italic ? 1 : 0}|${underline ? 1 : 0}|${colorHex}`;
      const last = runs[runs.length - 1];
      if (last && last._sig === sig) last.text += arr[j];
      else runs.push({ _sig: sig, text: arr[j], fontName: wf.wordName, sizePt, bold, italic, underline, colorHex });
    }
    return {
      align: p.align || 'left',
      firstIndentPt: 0,
      spaceBeforePt: 0,
      spaceAfterPt: 0,
      lineStepPt,
      runs: runs.length
        ? runs.map(({ _sig, ...r }) => r)
        : [{ text: '', fontName: wfBase.wordName, sizePt: baseSize, bold: wfBase.bold, italic: wfBase.italic, underline: false, colorHex: defHex }],
    };
  });
}

function modelBoxOnPage(b, p, model) {
  const bs = b.s || 1;
  const s = bs * (p.sc || 1);
  const px0 = b.x + (p.dx || 0) * bs;
  const py0 = b.y + (p.dy || 0) * bs;
  const area = model.area || { left: p.src.x, top: p.src.y, right: p.src.x + p.src.w, bottom: p.src.y + p.src.h, step: 14 };

  let leftSrc = area.left;
  let rightSrc = Math.max(area.right || leftSrc, leftSrc);
  const hasCentered = (model.paras || []).some((pr) => pr.align === 'center') || model.align === 'center';
  if (hasCentered && model.container) {
    leftSrc = Math.min(leftSrc, model.container.x0 + 2);
    rightSrc = Math.max(rightSrc, model.container.x1 - 2);
  }
  if (model.lines && model.lines.length > 1) {
    rightSrc = Math.max(rightSrc, ...model.lines.map((l) => l.right));
  } else if (model.lines && model.lines.length === 1) {
    rightSrc = Math.max(model.lines[0].right, p.src.x + p.src.w + ((p.edit && p.edit.deltaX) || 0));
  }
  if (p.edit && Array.isArray(p.edit.runs) && p.edit.runs.length) {
    for (const r of p.edit.runs) {
      if (r.x != null) leftSrc = Math.min(leftSrc, r.x);
      if (r.x != null && r.w != null) rightSrc = Math.max(rightSrc, r.x + r.w);
    }
  }
  if (!model.badge && !model.cell && p.dw && p.kind !== 'box') {
    rightSrc = Math.max(rightSrc, p.src.x + p.dw);
  }
  if (hasCentered && model.lines && model.lines.length) {
    const tMinL = Math.min(...model.lines.map((l) => l.left));
    const tMaxR = Math.max(...model.lines.map((l) => l.right));
    if (p.kind === 'box') {
      leftSrc = tMinL;
      rightSrc = Math.max(rightSrc, tMaxR);
    }
  }

  const x = Math.max(0, px0 + (leftSrc - p.src.x) * s);
  const y = Math.max(0, py0 + (area.top - p.src.y) * s);
  const w = Math.max(20, (rightSrc - leftSrc) * s + 6);
  const h = Math.max(12, ((area.bottom || (area.top + 14)) - area.top) * s + 4);
  return { x, y, w, h, scale: s };
}

function buildEditedTableItem(b, gridPart, anS) {
  const ts = gridPart.edit && gridPart.edit.tableSpec;
  if (!ts || !Array.isArray(ts.xs) || ts.xs.length < 2 || !Array.isArray(ts.ys) || ts.ys.length < 2) return null;
  const bs = b.s || 1;
  const gSc = bs * (gridPart.sc || 1);
  const gx0 = b.x + (gridPart.dx || 0) * bs;
  const gy0 = b.y + (gridPart.dy || 0) * bs;
  const style = migrateTableStyle(ts);

  const nRows = ts.ys.length - 1;
  const nCols = ts.xs.length - 1;
  const colWidthsPt = [];
  for (let c = 0; c < nCols; c++) colWidthsPt.push(Math.max(10, (ts.xs[c + 1] - ts.xs[c]) * gSc));
  const rowHeightsPt = [];
  for (let r = 0; r < nRows; r++) rowHeightsPt.push(Math.max(10, (ts.ys[r + 1] - ts.ys[r]) * gSc));

  const cellMap = new Map();
  for (const p of b.parts || []) {
    if (!p.cell || p.cell.row == null || p.cell.col == null) continue;
    const key = `${p.cell.row}:${p.cell.col}`;
    if (!cellMap.has(key)) cellMap.set(key, []);
    cellMap.get(key).push(p);
  }

  const rows = [];
  for (let r = 0; r < nRows; r++) {
    const rowCells = [];
    for (let c = 0; c < nCols; c++) {
      const fillRgb = cellFill(style.pattern, style.color, r, c, ts.origPalette, style.custom);
      const isWhite = fillRgb && fillRgb[0] >= 253 && fillRgb[1] >= 253 && fillRgb[2] >= 253;
      const fillHex = fillRgb && !isWhite ? rgbToHex6(fillRgb) : null;

      const cParts = cellMap.get(`${r}:${c}`) || [];
      const paras = [];
      let vAlign = 'center';
      for (const cp of cParts) {
        if (cp.cell && cp.cell.vAlign) vAlign = cp.cell.vAlign;
        const cSc = bs * (cp.sc || 1);
        const effAn = anS || { seg: { glyphs: [] }, links: [] };
        const models = openAllModels(effAn, cp);
        for (const m of models) {
          const hasAny = (m.paras || []).some((pr) => (pr.text || '').length > 0);
          if (hasAny) paras.push(...modelToDocxParas(m, effAn, cSc));
        }
      }
      rowCells.push({ fillHex, vAlign, paras });
    }
    rows.push(rowCells);
  }

  return {
    y: gy0 + (ts.ys[0] - gridPart.src.y) * gSc,
    item: {
      kind: 'table',
      table: {
        x: gx0 + (ts.xs[0] - gridPart.src.x) * gSc,
        y: gy0 + (ts.ys[0] - gridPart.src.y) * gSc,
        colWidthsPt,
        rowHeightsPt,
        borderHex: rgbToHex6(ts.borderColor) || 'CBD5E1',
        borderWidthPt: ts.borderWidth ?? 0.75,
        outerBorder: ts.outerBorder !== false,
        innerH: ts.innerH !== false,
        innerV: ts.innerV !== false && !ts.noVertLines,
        rows,
      },
    },
  };
}

function dedupSortedCoords(vals, tol = 2.0) {
  const sorted = vals.slice().sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    if (!out.length || v - out[out.length - 1] > tol) out.push(v);
    else out[out.length - 1] = (out[out.length - 1] + v) * 0.5;
  }
  return out;
}

function buildRawGridTableItem(b, p, gridModels, anS) {
  const bs = b.s || 1;
  const s = bs * (p.sc || 1);
  const px0 = b.x + (p.dx || 0) * bs;
  const py0 = b.y + (p.dy || 0) * bs;
  const gfx = (anS && anS.atoms && anS.atoms.gfx) || [];

  const sx0 = p.src.x - 4, sy0 = p.src.y - 4, sx1 = p.src.x + p.src.w + 4, sy1 = p.src.y + p.src.h + 4;
  const rawXs = [], rawYs = [];
  let borderColor = [203, 213, 225];
  let borderWidth = 0.75;
  for (const g of gfx) {
    if (g.kind !== 'path' || !(g.fill || g.stroke)) continue;
    if (g.b.x1 < sx0 || g.b.x0 > sx1 || g.b.y1 < sy0 || g.b.y0 > sy1) continue;
    const gw = g.b.x1 - g.b.x0, gh = g.b.y1 - g.b.y0;
    if (gh <= 3.5 && gw >= 20) {
      rawYs.push((g.b.y0 + g.b.y1) * 0.5);
      const lc = g.fill ? g.rgb : g.item && g.item.strokeRgb;
      if (lc && (lc[0] < 245 || lc[1] < 245 || lc[2] < 245)) borderColor = lc;
      if (g.item && g.item.lw) borderWidth = Math.max(0.5, Math.min(2, g.item.lw));
    } else if (gw <= 3.5 && gh >= 12) {
      rawXs.push((g.b.x0 + g.b.x1) * 0.5);
    }
  }

  let xs = dedupSortedCoords(rawXs, 2.5);
  let ys = dedupSortedCoords(rawYs, 2.5);
  const maxR = Math.max(...gridModels.map((m) => m.cell.gridRow));
  const maxC = Math.max(...gridModels.map((m) => m.cell.col));
  if (xs.length < maxC + 2) {
    xs = [p.src.x];
    for (let c = 0; c <= maxC; c++) {
      const inCol = gridModels.filter((m) => m.cell.col === c);
      const cw = inCol[0] && inCol[0].cell.colW ? inCol[0].cell.colW : (p.src.w / (maxC + 1));
      xs.push(xs[xs.length - 1] + cw);
    }
  }
  if (ys.length < maxR + 2) {
    ys = Array.from({ length: maxR + 2 }, (_, r) => p.src.y + (r * p.src.h) / (maxR + 1));
  }

  const nRows = ys.length - 1;
  const nCols = xs.length - 1;
  const byCell = new Map();
  for (const m of gridModels) {
    const key = `${m.cell.gridRow}:${m.cell.col}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(m);
  }

  const findCellBgHex = (x0, y0, x1, y1) => {
    const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5;
    const hit = gfx
      .filter((g) => g.kind === 'path' && g.fill && g.rgb
        && cx >= g.b.x0 && cx <= g.b.x1 && cy >= g.b.y0 && cy <= g.b.y1
        && (g.b.x1 - g.b.x0) > (x1 - x0) * 0.5 && (g.b.y1 - g.b.y0) > (y1 - y0) * 0.5
        && (g.b.y1 - g.b.y0) < (ys[ys.length - 1] - ys[0]) * 0.65)
      .sort((a, b2) => a.area - b2.area)[0];
    if (!hit) return null;
    if (hit.rgb[0] >= 253 && hit.rgb[1] >= 253 && hit.rgb[2] >= 253) return null;
    return rgbToHex6(hit.rgb);
  };

  const rows = [];
  for (let r = 0; r < nRows; r++) {
    const rowCells = [];
    for (let c = 0; c < nCols; c++) {
      const ms = byCell.get(`${r}:${c}`) || [];
      const paras = ms.flatMap((m) => modelToDocxParas(m, anS, s));
      rowCells.push({ fillHex: findCellBgHex(xs[c], ys[r], xs[c + 1], ys[r + 1]), vAlign: 'center', paras });
    }
    rows.push(rowCells);
  }

  const tx = px0 + (xs[0] - p.src.x) * s;
  const ty = py0 + (ys[0] - p.src.y) * s;
  return {
    y: ty,
    item: {
      kind: 'table',
      table: {
        x: tx,
        y: ty,
        colWidthsPt: Array.from({ length: nCols }, (_, c) => Math.max(10, (xs[c + 1] - xs[c]) * s)),
        rowHeightsPt: Array.from({ length: nRows }, (_, r) => Math.max(10, (ys[r + 1] - ys[r]) * s)),
        borderHex: rgbToHex6(borderColor) || 'CBD5E1',
        borderWidthPt: borderWidth,
        outerBorder: true,
        innerH: true,
        innerV: true,
        rows,
      },
    },
  };
}

function registerDataUrlImage(dataUrl, mediaState) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const isPng = /^data:image\/png/i.test(dataUrl) || !/^data:image\/jpe?g/i.test(dataUrl);
  const ext = isPng ? 'png' : 'jpg';
  const bytes = dataUrlToBytes(dataUrl);
  if (!bytes || !bytes.length) return null;
  const idx = mediaState.list.length + 1;
  const rId = `rIdImg${idx}`;
  const fileName = `image${idx}.${ext}`;
  mediaState.list.push({ rId, fileName, ext, bytes });
  if (ext === 'png') mediaState.hasPng = true;
  else mediaState.hasJpg = true;
  return rId;
}

async function extractPageItems(page, siOffset, getAn, mediaState, opts) {
  const items = [];
  const blocks = (page.blocks || []).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));

  for (const b of blocks) {
    if (b.watermark) continue;
    const bs = b.s || 1;

    if (b.inserted) {
      if (b.inserted.type === 'text') {
        const paras = insertedToDocxParas(b.inserted, bs);
        if (paras.some((pr) => pr.runs.some((r) => r.text.trim()))) {
          items.push({
            y: b.y,
            item: { kind: 'textbox', box: { x: Math.max(0, b.x), y: Math.max(0, b.y), w: b.bw * bs + 6, h: b.bh * bs + 4 }, paras },
          });
        }
      } else if (b.inserted.type === 'image') {
        const rId = registerDataUrlImage(imgSrc(b.inserted), mediaState);
        if (rId) {
          items.push({ y: b.y, item: { kind: 'image', img: { x: Math.max(0, b.x), y: Math.max(0, b.y), w: b.bw * bs, h: b.bh * bs, rId } } });
        }
      }
      continue;
    }

    const si = siOffset(b);
    const anS = si !== null && si !== undefined ? await getAn(si) : null;
    const effAn = anS || { seg: { glyphs: [] }, links: [] };

    const gridPart = (b.parts || []).find((p) => (p.edit && p.edit.tableSpec) || p.addedTable);
    if (gridPart) {
      const tblItem = buildEditedTableItem(b, gridPart, anS);
      if (tblItem) items.push(tblItem);
    }

    const blkBoxes = [];
    for (const p of b.parts || []) {
      const s = bs * (p.sc || 1);
      if (p === gridPart || (gridPart && p.cell)) continue;
      if (p.decor) continue;
      if (p.obj === 'deco' || p.obj === 'bg') continue;

      if (p.kind === 'insimg' && p.img) {
        if (p.inline) continue; // OCR background cover patches are not exported to Word
        const rId = registerDataUrlImage(imgSrc(p.img), mediaState);
        if (rId) {
          const x = b.x + (p.dx || 0) * bs, y = b.y + (p.dy || 0) * bs;
          items.push({ y, item: { kind: 'image', img: { x: Math.max(0, x), y: Math.max(0, y), w: p.img.iw * s, h: p.img.ih * s, rId } } });
        }
        continue;
      }

      if (p.kind === 'instext' && p.inserted) {
        const paras = insertedToDocxParas(p.inserted, s);
        const x = b.x + (p.dx || 0) * bs, y = b.y + (p.dy || 0) * bs;
        blkBoxes.push({ badge: false, cell: false, centered: paras.every((pr) => pr.align === 'center'), box: { x: Math.max(0, x), y: Math.max(0, y), w: (p.dw || 80) * s + 6, h: (p.dh || 20) * s + 4 }, paras });
        continue;
      }

      if (p.kind === 'image' || p.obj === 'photo') {
        if (typeof opts.extractPartImage === 'function') {
          const rect = { x: b.x + (p.dx || 0) * bs, y: b.y + (p.dy || 0) * bs, w: (p.dw || p.src.w) * s, h: (p.dh || p.src.h) * s };
          const dataUrl = await opts.extractPartImage(page, b, p, rect);
          const rId = registerDataUrlImage(dataUrl, mediaState);
          if (rId) items.push({ y: rect.y, item: { kind: 'image', img: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: rect.w, h: rect.h, rId } } });
        }
        continue;
      }

      if (p.kind === 'graphic') {
        if (typeof opts.extractPartImage === 'function' && p.src) {
          const rw = (p.dw || p.src.w) * s, rh = (p.dh || p.src.h) * s;
          if (rw >= 18 && rh >= 18 && Math.max(rw / rh, rh / rw) <= 18) {
            const rect = { x: b.x + (p.dx || 0) * bs, y: b.y + (p.dy || 0) * bs, w: rw, h: rh };
            const dataUrl = await opts.extractPartImage(page, b, p, rect);
            const rId = registerDataUrlImage(dataUrl, mediaState);
            if (rId) items.push({ y: rect.y, item: { kind: 'image', img: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: rect.w, h: rect.h, rId } } });
          }
        }
        continue;
      }
      if (p.editable === false) continue;
      if (!p.src) continue;
      if (!anS && !p.addedText) continue;

      if (p.kind === 'box' && typeof opts.extractPartImage === 'function' && anS && anS.atoms && anS.atoms.gfx) {
        const imgAtoms = anS.atoms.gfx.filter((g) => g.kind === 'image' && g.area > 300
          && g.b.x1 >= p.src.x - 1 && g.b.x0 <= p.src.x + p.src.w + 1
          && g.b.y1 >= p.src.y - 1 && g.b.y0 <= p.src.y + p.src.h + 1);
        for (const ga of imgAtoms) {
          const px0 = b.x + (p.dx || 0) * bs, py0 = b.y + (p.dy || 0) * bs;
          const rect = { x: px0 + (ga.b.x0 - p.src.x) * s, y: py0 + (ga.b.y0 - p.src.y) * s, w: (ga.b.x1 - ga.b.x0) * s, h: (ga.b.y1 - ga.b.y0) * s };
          const cw = Math.max(1, ga.b.x1 - ga.b.x0), ch = Math.max(1, ga.b.y1 - ga.b.y0);
          const cropPart = { ...p, src: { x: ga.b.x0, y: ga.b.y0, w: cw, h: ch }, dw: cw, dh: ch, edit: undefined, nine: undefined };
          const dataUrl = await opts.extractPartImage(page, b, cropPart, rect);
          const rId = registerDataUrlImage(dataUrl, mediaState);
          if (rId) items.push({ y: rect.y, item: { kind: 'image', img: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), w: rect.w, h: rect.h, rId } } });
        }
      }

      const models = openAllModels(effAn, p);
      if (!models.length) continue;

      const gridModels = models.filter((m) => m.cell && m.cell.gridRow != null);
      if (gridModels.length >= 2) {
        items.push(buildRawGridTableItem(b, p, gridModels, effAn));
      }

      const textModels = models.filter((m) => !(gridModels.length >= 2 && m.cell && m.cell.gridRow != null));
      for (const m of textModels) {
        const hasAny = (m.paras || []).some((pr) => (pr.text || '').trim().length > 0);
        if (!hasAny) continue;
        const paras = modelToDocxParas(m, effAn, s);
        const box = modelBoxOnPage(b, p, m);
        blkBoxes.push({ badge: !!m.badge, cell: !!m.cell, centered: paras.every((pr) => pr.align === 'center'), box, paras });
      }
    }

    blkBoxes.sort((a, c) => (a.box.y - c.box.y) || (a.box.x - c.box.x));
    const mergedBlk = [];
    for (const cur of blkBoxes) {
      const prev = mergedBlk[mergedBlk.length - 1];
      const canMergeInBlk = prev && !prev.badge && !cur.badge && !prev.cell && !cur.cell
        && cur.box.y >= prev.box.y + prev.box.h - 6
        && ((cur.centered && prev.centered) || Math.abs(cur.box.x - prev.box.x) <= 28);
      if (canMergeInBlk) {
        const gap = Math.max(2, cur.box.y - (prev.box.y + prev.box.h));
        if (prev.paras.length) prev.paras[prev.paras.length - 1].spaceAfterPt = Math.max(prev.paras[prev.paras.length - 1].spaceAfterPt || 0, gap);
        prev.paras.push(...cur.paras);
        const x0 = Math.min(prev.box.x, cur.box.x), y0 = Math.min(prev.box.y, cur.box.y);
        const x1 = Math.max(prev.box.x + prev.box.w, cur.box.x + cur.box.w);
        const y1 = Math.max(prev.box.y + prev.box.h, cur.box.y + cur.box.h);
        prev.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, scale: prev.box.scale };
        prev.centered = prev.centered && cur.centered;
      } else {
        mergedBlk.push(cur);
      }
    }
    for (const g of mergedBlk) {
      items.push({ y: g.box.y, item: { kind: 'textbox', box: g.box, paras: g.paras } });
    }
  }

  return items.sort((a, b) => a.y - b.y).map((entry) => entry.item);
}

export async function buildDocx(session, opts = {}) {
  await loadStd14().catch(() => null);

  let pdfDoc = null;
  let fc = null;
  const anCache = new Map();
  const getAn = async (si) => {
    if (si === null || si === undefined) return null;
    if (anCache.has(si)) return anCache.get(si);
    if (typeof session.analysis === 'function') {
      try {
        const a = session.analysis(si);
        if (a) { anCache.set(si, a); return a; }
      } catch { /* fallback to loading srcBytes */ }
    }
    if (!pdfDoc && session.srcBytes) {
      pdfDoc = await PDFDocument.load(session.srcBytes, { updateMetadata: false, throwOnInvalidObject: false });
      fc = new FontCache(pdfDoc.context);
    }
    if (pdfDoc) {
      const a = analyzePage(pdfDoc, si, fc);
      anCache.set(si, a);
      return a;
    }
    return null;
  };

  const mediaState = { list: [], hasPng: false, hasJpg: false };
  const pages = session.pages || [];
  let nextShapeId = 1;
  const bodyChunks = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (typeof session.ensurePage === 'function') session.ensurePage(page);
    const items = await extractPageItems(page, (b) => srcIndexOf(page, b), getAn, mediaState, opts);
    bodyChunks.push(renderFlowItems(items, page.w, () => nextShapeId++));

    if (pi < pages.length - 1) {
      bodyChunks.push(`<w:p><w:pPr>${sectionPrXml(page.w, page.h)}</w:pPr></w:p>`);
    }
  }

  const lastPage = pages[pages.length - 1] || { w: 595, h: 842 };
  bodyChunks.push(sectionPrXml(lastPage.w, lastPage.h));

  const zipFiles = [
    { name: '[Content_Types].xml', data: contentTypesXml(mediaState) },
    { name: '_rels/.rels', data: rootRelsXml() },
    { name: 'word/_rels/document.xml.rels', data: docRelsXml(mediaState.list) },
    { name: 'word/styles.xml', data: stylesXml() },
    { name: 'word/document.xml', data: documentXml(bodyChunks.join('')) },
  ];
  for (const m of mediaState.list) {
    zipFiles.push({ name: `word/media/${m.fileName}`, data: m.bytes });
  }

  return makeZipBytes(zipFiles);
}
