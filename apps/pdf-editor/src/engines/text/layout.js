// Re-flows edited text inside the original text area. Every character keeps the
// style (font, size, colour) of the original character it came from.
import { fallbackAdvance, fallbackHas } from './fontMatch.js';
import { hasVectorGlyph, vectorGlyphAdvance } from './vectorGlyphs.js';
import { styleAt, glyphIsBold, glyphIsItalic, sizeFactor } from './richStyle.js';
import { checkBoxGeom } from './checkBoxOps.js';

// superscript / subscript: smaller characters, baseline moved up / down
export const VK = 0.65;
export function vShift(st, size) { return st && st.v ? (st.v === 'sup' ? -0.33 : 0.14) * size : 0; }

export function resolveChars(model, newParas, map, ctx) {
  // newParas: [{text, marker}] ; map: diff map over joined text
  const out = [];
  let j = 0;
  let prevG = null;
  const firstG = model.charGlyph.find((g) => g) || model.refGlyph;
  newParas.forEach((p, pi) => {
    const chars = [];
    let ci = 0;
    for (const ch of Array.from(p.text)) {
      const st = styleAt(p, ci++);
      const oi = map[j];
      let g = oi >= 0 ? model.charGlyph[oi] : null;
      if (oi >= 0 && !g) { for (let t = oi; t >= 0 && !g; t--) g = model.charGlyph[t]; }
      if (!g) g = prevG || firstG;
      prevG = g;
      // a bold / italic original glyph under a character the editor shows plain is drawn plain
      const needStyled = st || (ch.trim() && (glyphIsBold(g.g) || glyphIsItalic(g.g)));
      let draw = (needStyled && ctx.styled && ctx.styled(ch, g.g, st, ctx.avail)) || drawFor(ch, g, ctx);
      if (draw.kind === 'fb' && (!draw.fb || !fallbackHas(draw.fb, ch)) && hasVectorGlyph(ch)) draw = { kind: 'vec', ch };
      chars.push({ ch, g, draw, oi, st });
      j += ch.length;
    }
    j += 1; // '\n'
    out.push({ chars, marker: p.marker, ...(p.align ? { align: p.align } : {}), ...(p.cb ? { cb: { ...p.cb } } : {}) });
  });
  return out;
}

function drawFor(ch, w, ctx) {
  const g = w.g;
  const code = ctx.avail.canDraw(g.font, ch);
  if (code >= 0) return { kind: 'orig', code };
  let fb = ctx.fallbackFor(g.font);
  if (!fb || !fallbackHas(fb, ch)) fb = ctx.anyFallback(ch);
  if (fb && fallbackHas(fb, ch)) return { kind: 'fb', fb };
  if (hasVectorGlyph(ch)) return { kind: 'vec', ch };
  return { kind: 'fb', fb: ctx.fallbackFor(g.font) };
}

export function charAdvance(c) {
  const g = c.g.g;
  const k = sizeFactor(c.st, g) * (c.st && c.st.v ? VK : 1);
  if (c.draw.kind === 'vec') return vectorGlyphAdvance(c.ch) * g.hsize * k;
  if (c.draw.kind === 'orig') {
    const font = c.draw.info || g.font;
    const w = font.widthOf(c.draw.code);
    return (font.isType3 ? w * font.fontMatrix[0] : w / 1000) * g.hsize * k;
  }
  return fallbackAdvance(c.draw.fb, c.ch) * g.hsize * k;
}

// forcedBreaks: Set of char indexes (per paragraph: `${pi}:${ci}`) where a line must end
export function layoutText(model, paras, k, opts = {}) {
  const A = model.area;
  const top = A.top;
  const hasJustifyBox = !!(model.container && !model.badge && !model.cell && paras.some((p) => (p.align || model.align) === 'justify'));
  const b0 = top + (A.firstBaseline - top) * k + (hasJustifyBox ? 3 * k : 0);
  const step = A.step * k;
  const lines = [];
  const forced = opts.forced || new Set();
  const baseSz = modelBaseSize(model);
  paras.forEach((p, pi) => {
    const effPAlign = p.align || model.align || 'left';
    const indent = (effPAlign === 'left' || effPAlign === 'justify') && p.marker && model.indent > 0 ? model.indent : 0;
    const chars = p.chars.map((c, ci) => ({ ...c, w: charAdvance(c) * k, ci }));
    const pFs = (chars[0] && chars[0].g && chars[0].g.g && chars[0].g.g.hsize) || baseSz;
    const cbG = (p.cb && p.cb.pos) ? checkBoxGeom(p.cb, pFs) : null;
    const cbPadL = (cbG && p.cb.pos === 'left') ? (cbG.w + cbG.gap) * k : 0;
    const colonIdx = model.colonAlignX != null ? chars.findIndex((c, idx) => idx > 0 && idx <= 22 && c.ch === ':') : -1;
    const isSpeaker = colonIdx > 0 && chars.slice(0, colonIdx).some((c) => c.ch !== ' ');
    const jBox = effPAlign === 'justify' && model.container && !model.badge && !model.cell;
    const jPadX = jBox ? Math.max(8, Math.min(14, (A.left - model.container.x0) + 4)) : 0;
    const paraBaseLeft = jBox ? Math.max(A.left, model.container.x0 + jPadX) : A.left;
    let i = 0;
    let firstLine = true;
    if (!chars.length) { lines.push({ pi, items: [], left: paraBaseLeft + cbPadL + indent, first: true, align: p.align || null }); return; }
    while (i < chars.length) {
      const hang = isSpeaker && !firstLine && model.hangIndent > 0 ? model.hangIndent * k : 0;
      const left = paraBaseLeft + cbPadL + (firstLine ? indent : hang);
      let rightBound = A.right;
      if (jBox) {
        rightBound = Math.min(rightBound, model.container.x1 - jPadX);
      }
      if (cbG && p.cb.pos === 'right') {
        if (p.cb.alignX != null) rightBound = Math.min(A.right, p.cb.alignX - cbG.gap * k);
        else if (opts.cbRightReserve > 0) rightBound = Math.max(left + 20, A.right - opts.cbRightReserve * k);
      }
      const maxW = Math.max(12, rightBound - left + 0.01);
      let w = 0, lastBreak = -1, j = i;
      let forcedEnd = -1;
      while (j < chars.length) {
        const c = chars[j];
        if (forced.has(`${pi}:${j}`)) { forcedEnd = j; break; }
        if (c.ch === ' ') lastBreak = j;
        let cw = c.w;
        if (isSpeaker && firstLine && j === colonIdx) {
          const targetX = A.left + (model.colonAlignX - A.left) * k;
          if (left + w < targetX) {
            const padBefore = targetX - (left + w);
            chars[j - 1].w += padBefore;
            w += padBefore;
          }
          const nextNonSp = chars.slice(j + 1).find((q) => q.ch !== ' ');
          if (nextNonSp && model.hangIndent > 0) {
            const targetAfter = A.left + model.hangIndent * k;
            const curAfter = left + w + cw + (chars[j + 1] && chars[j + 1].ch === ' ' ? chars[j + 1].w : 0);
            if (curAfter < targetAfter && chars[j + 1] && chars[j + 1].ch === ' ') {
              chars[j + 1].w += (targetAfter - curAfter);
            }
          }
        }
        if (!opts.keepLineBreaks && w + cw > maxW && c.ch !== ' ' && j > i) break;
        w += cw; j++;
      }
      let end;
      if (forcedEnd >= 0) end = forcedEnd + 1;
      else if (j >= chars.length) end = chars.length;
      else if (lastBreak >= i) end = lastBreak + 1;
      else end = Math.max(j, i + 1);
      const items = chars.slice(i, end);
      // drop trailing spaces from measure
      lines.push({ pi, items, left, rightBound, first: firstLine, align: p.align || null });
      i = end;
      firstLine = false;
    }
  });
  // positions
  let prevBase = null, prevLs = 0;
  lines.forEach((ln, li) => {
    // a line with enlarged characters gets more room above it
    // a line made only of smaller characters keeps its top where it was and
    // takes less room (the text never slides down)
    const ks = ln.items.filter((c) => c.ch !== ' ').map((c) => (c.st && c.st.z > 0 ? c.st.z / baseSz : (c.st && c.st.k) || 1));
    const big = ks.length ? Math.max(...ks) : 1;
    const pExtra = (ln.first && ln.pi > 0 && A.paraGap > 0) ? A.paraGap * k : 0;
    if (big >= 1) ln.baseline = prevBase === null ? b0 + (big - 1) * step * 0.75 : prevBase + step * big + prevLs * k + pExtra;
    else ln.baseline = prevBase === null ? top + (b0 - top) * big : prevBase + step * Math.max(big, 0.5) + prevLs * k + pExtra;
    prevBase = ln.baseline;
    const lss = ln.items.map((c) => (c.st && c.st.ls) || 0);
    prevLs = lss.find((v) => v !== 0) || 0;
    void li;
    const trimmed = ln.items.slice();
    while (trimmed.length && trimmed[trimmed.length - 1].ch === ' ') trimmed.pop();
    const width = trimmed.reduce((s, c) => s + c.w, 0);
    const effAlign = ln.align || model.align || 'left';
    let x = ln.left;
    if (effAlign === 'center') x = (ln.align && width > A.right - A.left) ? A.left : A.left + (A.right - A.left - width) / 2;
    else if (effAlign === 'right') x = (ln.align && width > A.right - A.left) ? A.left : A.right - width;
    if (!ln.align && model.align === 'center' && model.lines.length === 1) {
      const c0 = (model.lines[0].left + model.lines[0].right) / 2;
      x = c0 - width / 2;
    }
    let effW = width;
    if (effAlign === 'justify') {
      const nextLn = lines[li + 1];
      const isLastOfPara = !nextLn || nextLn.pi !== ln.pi;
      if (!isLastOfPara) {
        const spaces = trimmed.filter((c, idx) => c.ch === ' ' && idx > 0 && idx < trimmed.length - 1);
        const targetW = (ln.rightBound ?? A.right) - x;
        const extra = targetW - width;
        if (extra > 0.2 && spaces.length > 0) {
          const add = extra / spaces.length;
          for (const sp of spaces) sp.w += add;
          effW = targetW;
        }
      }
    }
    ln.x = x; ln.width = effW;
    let cx = x;
    for (const c of ln.items) { c.x = cx; cx += c.w; }
    ln.text = ln.items.map((c) => c.ch).join('');
  });
  return { lines, k, step, b0 };
}

// the text's usual size (pt): median size of the original glyphs
export function modelBaseSize(model) {
  if (model.baseSize > 0) return model.baseSize;
  const out = [];
  for (const g of (model.origCharGlyph || model.charGlyph || [])) if (g && !g.space && g.g && (g.g.size || g.g.hsize)) out.push(g.g.size || g.g.hsize);
  if (!out.length && model.refGlyph && model.refGlyph.g) out.push(model.refGlyph.g.size || model.refGlyph.g.hsize || 11);
  if (!out.length) return 11;
  out.sort((a, b) => a - b);
  return out[out.length >> 1];
}
