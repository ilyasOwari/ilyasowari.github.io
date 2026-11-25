// Decides, per character, whether the ORIGINAL embedded font can draw it
// (encodable + glyph really present in the possibly-subsetted program).
import fontkit from '../../../vendor/fontkit.esm.js';
import { streamBytes, dget, nameOf } from '../pdf/pdfobj.js';
import { unicodeToWinAnsi, winAnsiToUnicode } from '../pdf/encodings.js';

export class FontAvailability {
  constructor(ctx) { this.ctx = ctx; this.programs = new Map(); this.used = new Map(); }

  noteUsed(glyphs) {
    for (const g of glyphs) {
      const id = g.font && g.font.id;
      if (!id) continue;
      if (!this.used.has(id)) this.used.set(id, new Set());
      if (g.uni) this.used.get(id).add(g.uni);
    }
  }
  program(info) {
    if (this.programs.has(info.id)) return this.programs.get(info.id);
    let fk = null;
    if (info.programRef && (info.programType === 'truetype' || info.programType === 'opentype')) {
      try { fk = fontkit.create(streamBytes(info.programRef)); } catch (e) { fk = null; }
    }
    this.programs.set(info.id, fk);
    return fk;
  }
  // returns code or -1
  codeFor(info, ch) {
    if (info.isType3) return info.fromUni.has(ch) ? info.fromUni.get(ch) : -1;
    if (info.fromUni.has(ch)) return info.fromUni.get(ch);
    if (!info.isType0 && /WinAnsi/.test(info.encodingName || '')) return unicodeToWinAnsi(ch);
    return -1;
  }
  canDraw(info, ch) {
    if (!info || info.isType3) return -1;
    const code = this.codeFor(info, ch);
    if (code < 0) return -1;
    const ws = /\s/.test(ch);
    const w = info.widthOf(code);
    if (w <= 0 && !ws) return -1;
    const fk = this.program(info);
    if (fk) {
      if (ws) return code;
      let g = null;
      try {
        if (info.isType0) g = fk.getGlyph(code);
        else {
          const hasCmap = !!fk.directory.tables.cmap;
          if (hasCmap) {
            const u = info.toUni.get(code) || winAnsiToUnicode(code) || ch;
            g = fk.glyphForCodePoint(u.codePointAt(0));
            if (!g || !g.id) g = fk.glyphForCodePoint(0xF000 + code);
            if (!g || !g.id) g = fk.glyphForCodePoint(code);
          } else g = fk.getGlyph(code);
        }
        if (!(g && g.id && g.path && g.path.commands.length)) return -1;
        // a CID font whose /W has no width for this code: viewers advance by /DW
        // (often 1000 = a gap after the letter) - only usable when that matches the shape
        if (info.isType0 && !info.widths.has(code) && fk.unitsPerEm) {
          const real = (g.advanceWidth || 0) * 1000 / fk.unitsPerEm;
          if (Math.abs(real - info.defaultWidth) > Math.max(40, real * 0.12)) return -1;
        }
        return code;
      } catch (e) { return -1; }
    }
    // no parsable program: subsets only guarantee characters seen in the document
    const subset = /^[A-Z]{6}\+/.test(info.baseFont || '');
    if (!info.embedded) return code; // standard / system font: viewer supplies the full font
    if (subset || info.programType === 'cff' || info.programType === 'type1') {
      const used = this.used.get(info.id);
      return used && used.has(ch) ? code : (subset ? -1 : code);
    }
    return code;
  }
}
