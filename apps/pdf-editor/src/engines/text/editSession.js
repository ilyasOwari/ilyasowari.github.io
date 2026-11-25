// Glue between the UI text editor and the text engine.
import { findClusters, buildTextModel } from './textModel.js';
import { computeEdit } from './applyEdit.js';
import { matchFont, loadFallbackFont, fallbackHas, getManifest } from './fontMatch.js';
import { prepareStyleFonts, hasStyles, glyphIsBold, glyphIsItalic } from './richStyle.js';

const inR = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// Pick the paragraph cluster to edit (closest to the click point, else largest)
export function openTextModel(an, part, point) {
  const clusters = findClusters(an, part).filter((c) => !c.badge);
  if (!clusters.length) return null;
  let pick = null;
  if (part.edit && part.edit.clusterKey) pick = clusters.find((c) => keyOf(c) === part.edit.clusterKey);
  if (!pick && point) {
    let best = Infinity;
    for (const c of clusters) {
      const b = c.para.b;
      const dx = Math.max(b.x0 - point.x, 0, point.x - b.x1), dy = Math.max(b.y0 - point.y, 0, point.y - b.y1);
      const d = Math.hypot(dx, dy);
      if (d < best) { best = d; pick = c; }
    }
  }
  if (!pick) pick = clusters.slice().sort((a, b) => b.para.lines.length * (b.para.b.x1 - b.para.b.x0) - a.para.lines.length * (a.para.b.x1 - a.para.b.x0))[0];
  const sub = part.edit && part.edit.clusterKey === keyOf(pick) ? part.edit : null;
  return modelFor(an, part, pick, sub);
}

// every text group of a part (paragraph clusters and badge numbers), in reading order
export function openAllModels(an, part) {
  if (part.addedText) return [buildAddedTextModel(an, part)];
  const clusters = findClusters(an, part);
  const subs = part.edit ? (part.edit.clusters || (part.edit.clusterKey ? [part.edit] : [])) : [];
  return clusters.map((c) => {
    const key = keyOf(c);
    const m = modelFor(an, part, c, subs.find((e) => e.clusterKey === key) || null);
    m.badge = !!(c.badge || part.badge);
    if (c.cell || part.cell) m.cell = { ...(c.cell || {}), ...(part.cell || {}) };
    return m;
  }).sort((a, b) => {
    const ga = a.cell && a.cell.gridRow, gb = b.cell && b.cell.gridRow;
    if (ga != null && gb != null) return ga !== gb ? ga - gb : a.cell.col - b.cell.col;
    return a.area.top - b.area.top || a.area.left - b.area.left;
  });
}

export function buildAddedTextModel(an, part) {
  const glyphs = an && an.seg && an.seg.glyphs;
  const isBoldGlyph = (g) => {
    const fn = g && g.g && g.g.font;
    if (!fn) return false;
    return !!((fn.style && fn.style.weight >= 600) || /bold|black|heavy/i.test((fn.baseFont || '') + ' ' + ((fn.style && fn.style.clean) || '')));
  };
  let refG = glyphs && part.refGlyphIdx >= 0 ? glyphs[part.refGlyphIdx] : null;
  if (!refG && glyphs) {
    refG = glyphs.find((g) => !g.space && g.g && g.g.font && !isBoldGlyph(g) && g.g.hsize >= 8.5 && g.g.hsize <= 16)
      || glyphs.find((g) => !g.space && g.g && g.g.font && g.g.hsize >= 9 && g.g.hsize <= 16)
      || glyphs.find((g) => !g.space && g.g && g.g.font)
      || glyphs[0] || null;
  }
  const isLightFill = (fl) => {
    if (!fl || !fl.args) return false;
    if (fl.op === 'g' || fl.op === 'G') return fl.args[0] > 0.72;
    if (fl.op === 'rg' || fl.op === 'RG') return (fl.args[0] * 0.3 + fl.args[1] * 0.59 + fl.args[2] * 0.11) > 0.72;
    if (fl.op === 'k' || fl.op === 'K') return fl.args[0] + fl.args[1] + fl.args[2] + fl.args[3] < 0.25;
    return false;
  };
  const sz = part.badge
    ? Math.max(6, Math.min(28, part.fontSize || (refG && refG.g && refG.g.hsize) || 10))
    : (part.ocr
      ? Math.max(6, Math.min(144, part.fontSize || (refG && refG.g && refG.g.hsize) || 11))
      : Math.max(9, Math.min(16, part.fontSize || (refG && refG.g && refG.g.hsize) || 11)));
  if (!refG) {
    refG = {
      idx: -1, space: false, uni: 'a',
      b: { x0: part.src.x, y0: part.src.y, x1: part.src.x + 6, y1: part.src.y + sz + 1 },
      g: { font: null, size: sz, hsize: sz, w0: 0.5, trm: [sz, 0, 0, -sz, 0, 0], fill: { op: 'rg', args: [0.11, 0.14, 0.2] }, gsName: null },
    };
  } else {
    const g0 = refG.g || {};
    const fill = part.cell
      ? { op: 'rg', args: [0.11, 0.14, 0.2] }
      : (part.badge && g0.fill ? g0.fill : ((!g0.fill || isLightFill(g0.fill)) ? { op: 'rg', args: [0.11, 0.14, 0.2] } : g0.fill));
    const scale = g0.hsize ? sz / g0.hsize : 1;
    const trm = g0.trm ? g0.trm.map((v, idx) => (idx < 4 ? v * scale : v)) : [sz, 0, 0, -sz, 0, 0];
    refG = { ...refG, size: sz, g: { ...g0, size: sz, hsize: sz, trm, fill } };
  }
  const baseW = part.baseW || part.src.w || 160;
  let left = part.src.x + 1;
  let right = part.src.x + Math.max(part.ocr ? 12 : 30, baseW - 2);
  let align = 'left';
  const step = part.lineStep || (sz * 1.25);
  let top = part.src.y + 1;
  let firstBaseline = top + 0.82 * sz;
  if (part.badge && part.container) {
    const cb = part.container;
    const bw = Math.max(4, cb.x1 - cb.x0), bh = Math.max(4, cb.y1 - cb.y0);
    const pad = Math.min(1.5, Math.max(0.5, bw * 0.08));
    left = cb.x0 + pad;
    right = cb.x1 - pad;
    align = 'center';
    firstBaseline = Number.isFinite(part.badgeBaseline)
      ? part.badgeBaseline
      : Math.max(cb.y0 + 0.65 * sz, Math.min(cb.y1 - 0.1 * sz, cb.y0 + (bh + 0.72 * sz) * 0.5));
    top = firstBaseline - 0.8 * sz;
  }
  const nLines = Math.max(1, part.origLines || 1);
  const lastBaseline = firstBaseline + (nLines - 1) * step;
  const bottom = lastBaseline + 0.25 * sz;
  const sub = part.edit ? ((part.edit.clusters && part.edit.clusters[0]) || part.edit) : null;
  const hasPrev = !!(sub && sub.paras);
  return {
    addedText: true,
    ocr: !!part.ocr,
    sharedPanel: !!part.ocr,
    refGlyph: refG,
    paraIndent: [false],
    newParaIndent: false,
    partSrc: { ...part.src, w: baseW },
    partId: part.id,
    text: hasPrev ? sub.paras.map((p) => p.text).join('\n') : '',
    origText: '',
    charGlyph: [refG],
    origCharGlyph: [refG],
    paraStartsAt: [0],
    lineEndAt: hasPrev && Array.isArray(sub.lineEndAt) ? sub.lineEndAt.slice() : [],
    lines: [],
    indent: 0,
    align,
    container: part.container ? { ...part.container } : null,
    cell: part.cell ? { ...part.cell } : null,
    cellRight: part.cellRight || null,
    badge: !!part.badge,
    area: { left, right, firstBaseline, lastBaseline, step, top, bottom },
    glyphIdx: [],
    marks: [],
    clusterKey: 'added_' + (part.id || '0'),
    isLast: true,
    paras: hasPrev ? sub.paras.map((p) => ({ ...p })) : [{ text: '', marker: false }],
    prevEdit: sub || null,
  };
}

function modelFor(an, part, pick, sub) {
  const model = buildTextModel(an, part, pick);
  model.clusterKey = keyOf(pick);
  model.origText = model.text;
  model.origCharGlyph = model.charGlyph;
  // is this text the last thing in the part (so the box may grow / be trimmed)?
  const below = an.seg.textAtoms.some((l) => inR(part.src, (l.b.x0 + l.b.x1) / 2, (l.b.y0 + l.b.y1) / 2) && !pick.para.lines.includes(l) && l.b.y0 > model.area.bottom - 1)
    || an.atoms.gfx.some((g) => inR(part.src, (g.b.x0 + g.b.x1) / 2, (g.b.y0 + g.b.y1) / 2) && g.b.y0 > model.area.bottom + 1 && !(model.container && g.b.y1 >= model.container.y1 - 1));
  model.isLast = !below && !pick.badge && !part.badge;
  if (sub && sub.paras) {
    // continue from the previous edit
    const glyphByIdx = new Map(an.seg.glyphs.map((x) => [x.idx, x]));
    model.text = sub.paras.map((p) => p.text).join('\n');
    model.charGlyph = sub.charSrc.map((i) => (i >= 0 ? glyphByIdx.get(i) || null : null));
    model.paras = sub.paras.map((p) => ({ ...p }));
    model.prevEdit = sub;
    // the line breaks of the applied layout (older saved edits: none recorded)
    if (Array.isArray(sub.lineEndAt)) model.lineEndAt = sub.lineEndAt.slice();
  } else {
    const fillHex = (fl) => {
      if (!fl || !fl.args) return null;
      let r = 0, g = 0, b = 0;
      if (fl.op === 'g' || fl.op === 'G') { r = g = b = fl.args[0] * 255; }
      else if (fl.op === 'rg' || fl.op === 'RG') { r = fl.args[0] * 255; g = fl.args[1] * 255; b = fl.args[2] * 255; }
      else if (fl.op === 'k' || fl.op === 'K') {
        const [c, m, y, k] = fl.args;
        r = (1 - c) * (1 - k) * 255; g = (1 - m) * (1 - k) * 255; b = (1 - y) * (1 - k) * 255;
      } else return null;
      if (r < 60 && g < 60 && b < 60 && Math.max(r, g, b) - Math.min(r, g, b) < 22) return null;
      const hx = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
      return `#${hx(r)}${hx(g)}${hx(b)}`;
    };
    const links = (an && an.links) || [];
    const linkAt = (ub) => {
      if (!ub || !links.length) return null;
      const cx = (ub.x0 + ub.x1) / 2, cy = (ub.y0 + ub.y1) / 2;
      const hit = links.find((lk) => cx >= lk.b.x0 - 1 && cx <= lk.b.x1 + 1 && cy >= lk.b.y0 - 1 && cy <= lk.b.y1 + 1);
      return hit ? hit.uri : null;
    };
    const glyphSt = (g) => {
      if (!g || !g.g || g.space) return null;
      const b = glyphIsBold(g.g);
      const it = glyphIsItalic(g.g);
      const c = fillHex(g.g.fill);
      const link = linkAt(g.ub || g.b);
      if (!b && !it && !c && !link) return null;
      const o = {};
      if (b) o.b = 1;
      if (it) o.i = 1;
      if (c) o.c = c;
      if (link) o.link = link;
      return o;
    };
    let pos = 0;
    model.paras = model.text.split('\n').map((t, pi) => {
      const p = { text: t, marker: !!(model.paraIndent && model.paraIndent[pi]), ...(model.align === 'center' ? { align: 'center' } : {}) };
      const st = [];
      let cur = null, curSig = '';
      for (let j = 0; j < t.length; j++) {
        const gs = glyphSt(model.charGlyph[pos + j]);
        const sig = gs ? `${gs.b || 0}|${gs.i || 0}|${gs.c || ''}|${gs.link || ''}` : '';
        if (sig !== curSig) {
          if (cur) st.push(cur);
          cur = gs ? { a: j, b: j + 1, s: gs } : null;
          curSig = sig;
        } else if (cur) cur.b = j + 1;
      }
      if (cur) st.push(cur);
      if (st.length) p.st = st;
      pos += t.length + 1;
      return p;
    });
    model.initStSigs = model.paras.map((p) => JSON.stringify(p.st || []));
  }
  return model;
}
function keyOf(c) { const b = c.para.b; return `${b.x0.toFixed(1)},${b.y0.toFixed(1)}`; }

export async function prepareFonts(model) {
  const infos = new Map();
  for (const g of model.origCharGlyph.concat(model.charGlyph, model.refGlyph ? [model.refGlyph] : [])) if (g && g.g.font) infos.set(g.g.font.id, g.g.font);
  const fb = new Map();
  for (const [id, info] of infos) {
    const m = await matchFont(info);
    if (m) fb.set(id, await loadFallbackFont(m.file));
  }
  const man = await getManifest();
  const universal = [];
  for (const file of ['LiberationSans-Regular.ttf', 'FiraSans-Regular.ttf', 'Tinos-Regular.ttf']) {
    if (man.some((m) => m.file === file)) universal.push(await loadFallbackFont(file));
  }
  return {
    fallbackFor: (info) => (info ? fb.get(info.id) : null) || universal[0],
    anyFallback: (ch) => universal.find((f) => fallbackHas(f, ch)) || null,
  };
}

// Returns { edit, dh, warnings }
export async function applyTextEdit({ an, part, model, paras, avail, canGrow, canGrowX, canGrowLeft }) {
  const fonts = await prepareFonts(model);
  const warnings = [];
  const styledGlyphs = model.charGlyph.concat(model.origCharGlyph || []).some((g) => g && g.g && (glyphIsBold(g.g) || glyphIsItalic(g.g)));
  if (an && an.seg && (hasStyles(paras) || styledGlyphs)) {
    const byId = new Map();
    for (const x of an.seg.glyphs) if (x.g && x.g.font) byId.set(String(x.g.font.id), x.g.font);
    fonts.styled = await prepareStyleFonts(model, paras, (id) => byId.get(String(id)) || null);
  }
  // `model` text/charGlyph are the CURRENT text; geometry always from the original
  const baseModel = { ...model };
  const res = computeEdit(baseModel, paras, { avail, ...fonts, canGrow, canGrowX, canGrowLeft, isLast: model.isLast, warnings });
  const edit = { ...res, clusterKey: model.clusterKey };
  const dh = part.src.h + (edit.delta || 0);
  const dw = part.src.w + (edit.deltaX || 0);
  return { edit, dh, dw, warnings };
}
