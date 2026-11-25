// Word font mapping and page-wide conversion to metric-compatible Word fonts.
import { getManifest } from './fontMatch.js';
import { fontIsBold, fontIsItalic, glyphIsBold, glyphIsItalic } from './richStyle.js';
import { openAllModels, applyTextEdit } from './editSession.js';
import { layoutInserted, insFrame, insParas } from './insertedLayout.js';
import { srcIndexOf } from '../../model/blockState.js';
import * as ops from '../../model/blockOps.js';
import { commitMulti } from '../../core/pageOps.js';

export const WORD_FONT_MAP = {
  Carlito: 'Calibri',
  Caladea: 'Cambria',
  Tinos: 'Times New Roman',
  LiberationSans: 'Arial',
  'Liberation Sans': 'Arial',
  Cousine: 'Courier New',
};

const COUSINE_RE = /cousine|courier|consolas|menlo|mono/i;
const CALADEA_RE = /cambria|caladea/i;
const CARLITO_RE = /calibri|carlito/i;
const ARIAL_RE = /arial(?!\s*rounded)|helvetica|liberation\s*sans|liberationsans|arimo|verdana|tahoma|frutiger|univers|myriad|gill/i;
const TIMES_RE = /times|tinos|liberation\s*serif|liberationserif|georgia|minion|garamond|palatino|book\s*antiqua|baskerville|serif/i;

export function toWordFont(fontInfo, extra = {}) {
  const isObj = fontInfo && typeof fontInfo === 'object';
  const rawName = isObj
    ? `${fontInfo.baseFont || ''} ${(fontInfo.style && fontInfo.style.clean) || ''} ${fontInfo.family || ''}`
    : String(fontInfo || '');
  const cleanName = rawName.replace(/^[A-Z]{6}\+/, '').replace(/\.ttf$/i, '').trim();
  const bold = extra.bold !== undefined
    ? !!extra.bold
    : (isObj ? (fontIsBold(fontInfo) || (fontInfo.weight || 0) >= 600) : /bold|black|heavy|demi|semibold/i.test(cleanName));
  const italic = extra.italic !== undefined
    ? !!extra.italic
    : (isObj ? (fontIsItalic(fontInfo) || !!fontInfo.italic) : /italic|oblique/i.test(cleanName));
  const isSerif = !!(isObj && ((fontInfo.style && fontInfo.style.serif) || fontInfo.serif));
  const isMono = !!(isObj && ((fontInfo.style && fontInfo.style.mono) || fontInfo.mono));

  let family = 'Carlito';
  if (CALADEA_RE.test(cleanName)) family = 'Caladea';
  else if (CARLITO_RE.test(cleanName)) family = 'Carlito';
  else if (COUSINE_RE.test(cleanName) || isMono) family = 'Cousine';
  else if (ARIAL_RE.test(cleanName)) family = 'LiberationSans';
  else if (TIMES_RE.test(cleanName) || isSerif) family = 'Tinos';

  let file;
  if (family === 'Cousine') {
    file = bold ? 'Cousine-Bold.ttf' : 'Cousine-Regular.ttf';
  } else {
    const suffix = bold && italic ? 'BoldItalic' : (bold ? 'Bold' : (italic ? 'Italic' : 'Regular'));
    file = `${family}-${suffix}.ttf`;
  }
  return { file, family, wordName: WORD_FONT_MAP[family], bold, italic };
}

function compressRanges(chars) {
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const s = chars[i].s;
    if (!s || !Object.keys(s).length) continue;
    const sig = JSON.stringify(s);
    const last = out[out.length - 1];
    if (last && last.b === i && last._sig === sig) last.b = i + 1;
    else out.push({ a: i, b: i + 1, s: { ...s }, _sig: sig });
  }
  return out.map(({ a, b, s }) => ({ a, b, s }));
}

export function wordFontParasForModel(model, an = null) {
  const byId = new Map();
  for (const g of (an && an.seg && an.seg.glyphs) || []) {
    if (g && g.g && g.g.font) byId.set(String(g.g.font.id), g.g.font);
  }
  const firstG = (model.charGlyph && model.charGlyph.find(Boolean))
    || (model.origCharGlyph && model.origCharGlyph.find(Boolean))
    || model.refGlyph
    || null;
  let pos = 0;
  return (model.paras || []).map((p) => {
    const arr = Array.from(p.text || '');
    const chars = arr.map((ch) => ({ ch, s: null }));
    for (const r of p.st || []) {
      for (let i = r.a; i < r.b && i < chars.length; i++) {
        chars[i].s = { ...(chars[i].s || {}), ...r.s };
      }
    }
    for (let j = 0; j < chars.length; j++) {
      const gl = (model.charGlyph && model.charGlyph[pos + j])
        || (model.origCharGlyph && model.origCharGlyph[pos + j])
        || firstG;
      const curSt = chars[j].s || {};
      let srcFont = gl && gl.g ? gl.g.font : null;
      if (curSt.f && curSt.f.startsWith('lib:')) srcFont = curSt.f.slice(4);
      else if (curSt.f && curSt.f.startsWith('orig:')) srcFont = byId.get(curSt.f.slice(5)) || srcFont;
      const wf = toWordFont(srcFont);
      const nextSt = { ...curSt, f: 'lib:' + wf.family };
      if (!('b' in nextSt) && gl && gl.g && glyphIsBold(gl.g)) nextSt.b = 1;
      if (!('i' in nextSt) && gl && gl.g && glyphIsItalic(gl.g)) nextSt.i = 1;
      chars[j].s = nextSt;
    }
    pos += arr.length + 1;
    const st = compressRanges(chars);
    return {
      text: p.text,
      marker: !!p.marker,
      ...(p.align ? { align: p.align } : {}),
      ...(p.cb ? { cb: { ...p.cb } } : {}),
      ...(st.length ? { st } : {}),
    };
  });
}

function convertInsertedTextBlock(ins) {
  const wfBase = toWordFont(ins.font || 'Carlito-Regular.ttf');
  const paras = insParas(ins).map((p) => {
    const arr = Array.from(p.text || '');
    const chars = arr.map((ch) => ({ ch, s: { f: 'lib:' + wfBase.family } }));
    for (const r of p.st || []) {
      const s2 = { ...(r.s || {}) };
      if (s2.f && s2.f.startsWith('lib:')) s2.f = 'lib:' + toWordFont(s2.f.slice(4)).family;
      else if (!s2.f) s2.f = 'lib:' + wfBase.family;
      for (let i = r.a; i < r.b && i < chars.length; i++) chars[i].s = { ...s2 };
    }
    const st = compressRanges(chars);
    return st.length ? { text: p.text, st } : { text: p.text };
  });
  return { ...ins, font: wfBase.file, paras };
}

export const WORD_FONT_FILES_PREFIX = ['Carlito-', 'Caladea-', 'Tinos-', 'LiberationSans-', 'Cousine-'];
export function isWordFontFile(file) {
  return typeof file === 'string' && WORD_FONT_FILES_PREFIX.some((pre) => file.startsWith(pre));
}
export function isPageWordFonts(page) {
  if (!page || !Array.isArray(page.blocks) || !page.blocks.length) return false;
  let hasText = false;
  for (const b of page.blocks) {
    if (b.inserted) {
      if (b.inserted.type !== 'text') continue;
      hasText = true;
      if (!isWordFontFile(b.inserted.font || 'Carlito-Regular.ttf')) return false;
      for (const pr of insParas(b.inserted)) {
        for (const r of pr.st || []) {
          const f = r.s && r.s.f;
          if (f && !(f.startsWith('lib:') && f.slice(4) in WORD_FONT_MAP)) return false;
        }
      }
      continue;
    }
    for (const p of b.parts || []) {
      if (!p.src || p.decor || p.editable === false) continue;
      if (p.kind === 'image' || p.kind === 'graphic' || p.kind === 'insimg') continue;
      if (p.obj === 'deco' || p.obj === 'bg' || p.obj === 'photo') continue;
      if (p.addedText && (!p.edit || !(p.edit.runs && p.edit.runs.length))) continue;
      hasText = true;
      if (!p.edit) return false;
      if (!p.edit.wordFonts) return false;
      for (const r of p.edit.runs || []) {
        if (r.font !== 'vec' && !(r.font && r.font.startsWith('fb:') && isWordFontFile(r.font.slice(3)))) return false;
      }
    }
  }
  return hasText;
}

export function isDocumentWordFonts(session) {
  if (!session || !Array.isArray(session.pages) || !session.pages.length) return false;
  let any = false;
  for (const pg of session.pages) {
    if (!pg.blocks) {
      if (pg.srcIndex !== null) return false;
      continue;
    }
    if (pg.blocks.length) {
      if (!isPageWordFonts(pg)) return false;
      any = true;
    }
  }
  return any;
}

async function collectPageWordFontUpdates(session, avail, page) {
  session.ensurePage(page);
  const usedFiles = new Set();
  const partUpdates = [];
  const insUpdates = [];

  for (const b of page.blocks || []) {
    if (b.inserted) {
      if (b.inserted.type !== 'text') continue;
      const ins = convertInsertedTextBlock(b.inserted);
      const laid = await layoutInserted(ins);
      const F = insFrame(ins, laid);
      if (ins.font) usedFiles.add(ins.font);
      for (const ln of laid.lines) for (const r of ln.runs) if (r.file) usedFiles.add(r.file);
      insUpdates.push({ blockId: b.id, inserted: ins, bw: F.bw, bh: F.bh });
      continue;
    }
    const si = srcIndexOf(page, b);
    const an = (si !== null && si !== undefined) ? session.analysis(si) : null;
    const effAn = an || { seg: { glyphs: [] }, links: [] };
    for (const p of b.parts || []) {
      if (!p.src || p.decor || p.editable === false) continue;
      if (p.kind === 'image' || p.kind === 'graphic' || p.kind === 'insimg') continue;
      if (p.obj === 'deco' || p.obj === 'bg' || p.obj === 'photo') continue;
      if (!an && !p.addedText) continue;

      const models = openAllModels(effAn, p);
      if (!models.length) continue;
      const subs = [];
      let dx = 0, dy = 0, oldBottom = null, cutX = null;
      const keepGrowth = (e) => {
        if (e.delta && Math.abs(e.delta) > 0.01) { dy = e.delta; oldBottom = e.oldBottom; }
        if (e.deltaX && e.deltaX > dx) { dx = e.deltaX; cutX = e.cutX; }
      };
      for (const m of models) {
        const hasChars = m.paras && m.paras.some((pr) => (pr.text || '').replace(/\u00a0/g, ' ').trim());
        if (!hasChars) {
          if (m.prevEdit) { subs.push(m.prevEdit); keepGrowth(m.prevEdit); }
          continue;
        }
        const paras = wordFontParasForModel(m, effAn);
        const res = await applyTextEdit({
          an: effAn,
          part: p,
          model: { ...m, keepLineBreaks: true },
          paras,
          avail,
          canGrow: () => false,
          canGrowX: () => !(m.cell || m.cellRight),
        });
        subs.push(res.edit);
        keepGrowth(res.edit);
        for (const r of res.edit.runs || []) {
          if (r.font && r.font.startsWith('fb:')) usedFiles.add(r.font.slice(3));
        }
      }
      if (!subs.length) continue;
      const merged = {
        wordFonts: true,
        clusters: subs,
        removeGlyphs: subs.flatMap((e) => e.removeGlyphs || []),
        runs: subs.flatMap((e) => e.runs || []),
        marks: subs.flatMap((e) => e.marks || []),
        dropGfx: subs.flatMap((e) => e.dropGfx || []),
        dropBoxes: subs.flatMap((e) => e.dropBoxes || []),
        delta: dy,
        oldBottom,
        deltaX: dx,
        cutX,
        k: 1,
      };
      const dw = p.obj === 'text' ? Math.max(p.dw || p.src.w, p.src.w + dx) : p.src.w + dx;
      const dh = p.obj === 'text' ? Math.max(p.dh || p.src.h, p.src.h + dy) : p.src.h + dy;
      partUpdates.push({ blockId: b.id, partId: p.id, edit: merged, dw, dh });
    }
  }
  return { partUpdates, insUpdates, usedFiles };
}

function applyPageUpdates(pg, { partUpdates, insUpdates }) {
  let any = false;
  for (const u of insUpdates) {
    const b = ops.findBlock(pg, u.blockId);
    if (!b || !b.inserted) continue;
    b.inserted = u.inserted; b.bw = u.bw; b.bh = u.bh;
    any = true;
  }
  for (const u of partUpdates) {
    const b = ops.findBlock(pg, u.blockId);
    const pt = b && b.parts.find((q) => q.id === u.partId);
    if (!pt) continue;
    pt.edit = u.edit; pt.dw = u.dw; pt.dh = u.dh;
    ops.recalcBlock(b);
    any = true;
  }
  return any;
}

export async function convertPageToWordFonts(session, controller, page) {
  if (!page) return { changed: 0, usedFiles: new Set() };
  await getManifest();
  const upd = await collectPageWordFontUpdates(session, controller.s.avail, page);
  if (!upd.partUpdates.length && !upd.insUpdates.length) return { changed: 0, usedFiles: upd.usedFiles };
  controller.commit(page, 'text', (pg) => applyPageUpdates(pg, upd));
  return { changed: upd.partUpdates.length + upd.insUpdates.length, usedFiles: upd.usedFiles };
}

export async function convertDocumentToWordFonts(session, controller) {
  if (!session || !Array.isArray(session.pages) || !session.pages.length) return { changed: 0, usedFiles: new Set() };
  await getManifest();
  const usedFiles = new Set();
  const perPage = [];
  let changed = 0;
  for (const pg of session.pages) {
    const upd = await collectPageWordFontUpdates(session, controller.s.avail, pg);
    for (const f of upd.usedFiles) usedFiles.add(f);
    if (upd.partUpdates.length || upd.insUpdates.length) {
      perPage.push({ pg, upd });
      changed += upd.partUpdates.length + upd.insUpdates.length;
    }
  }
  if (!changed) return { changed: 0, usedFiles };
  commitMulti(controller, 'text', () => {
    let any = false;
    for (const { pg, upd } of perPage) {
      if (applyPageUpdates(pg, upd)) any = true;
    }
    return any;
  });
  return { changed, usedFiles };
}
