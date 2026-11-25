import fontkit from '../../../vendor/fontkit.esm.js';
// Reads everything we need about a PDF font resource: code splitting, widths,
// Unicode mapping (both directions), style hints and the embedded program.
import { dget, num, nameOf, arr, numArr, streamBytes, resolve, PDFDict, PDFRef } from './pdfobj.js';
import { parseToUnicode } from './cmap.js';
import { winAnsiToUnicode, macRomanToUnicode, glyphNameToUnicode } from './encodings.js';
import { std14For, std14Width } from './std14.js';
import { makeRecoverer, glyphSource, detectBraille } from './glyphRecover.js';

const WEIGHT_WORDS = [
  [/thin|hairline/i, 100], [/extralight|ultralight/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semibold|demibold|demi/i, 600], [/extrabold|ultrabold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
];

export function styleFromName(baseName) {
  const clean = (baseName || '').replace(/^[A-Z]{6}\+/, '');
  let weight = 400;
  for (const [re, w] of WEIGHT_WORDS) { if (re.test(clean)) { weight = w; break; } }
  const italic = /italic|oblique|\bit\b|-it$/i.test(clean);
  const family = clean.split(/[-,]/)[0].replace(/(MT|PS|Std|Pro|LT)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return { clean, family, weight, italic };
}

export function loadFontInfo(ctx, fontDict, key) {
  const subtype = nameOf(dget(ctx, fontDict, 'Subtype')) || 'Type1';
  const baseFont = nameOf(dget(ctx, fontDict, 'BaseFont')) || key;
  const info = {
    key, subtype, baseFont, isType0: subtype === 'Type0', isType3: subtype === 'Type3',
    widths: new Map(), defaultWidth: 0, toUni: new Map(), fromUni: new Map(), bytesPerCode: 1,
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0], program: null, programType: null, descriptor: {},
  };
  attachFontMethods(info);
  let descDict;
  if (info.isType0) {
    info.bytesPerCode = 2;
    const desc = arr(ctx, dget(ctx, fontDict, 'DescendantFonts'))[0];
    descDict = dget(ctx, desc, 'FontDescriptor');
    info.defaultWidth = num(dget(ctx, desc, 'DW'), 1000);
    const W = arr(ctx, dget(ctx, desc, 'W'));
    for (let i = 0; i < W.length;) {
      const first = num(W[i]);
      const next = W[i + 1];
      if (next && next.asArray) {
        next.asArray().forEach((w, k) => info.widths.set(first + k, num(resolve(ctx, w))));
        i += 2;
      } else {
        const last = num(next), w = num(W[i + 2]);
        if (last - first < 70000) for (let c = first; c <= last; c++) info.widths.set(c, w);
        i += 3;
      }
    }
    const c2g = dget(ctx, desc, 'CIDToGIDMap');
    if (c2g && c2g.dict) {
      const m = streamBytes(c2g);
      info.cidToGid = (cid) => (cid * 2 + 1 < m.length ? (m[cid * 2] << 8) | m[cid * 2 + 1] : null);
    }
    const enc = nameOf(dget(ctx, fontDict, 'Encoding')) || '';
    info.encodingName = enc;
    info.identity = /Identity/.test(enc);
  } else {
    descDict = dget(ctx, fontDict, 'FontDescriptor');
    const first = num(dget(ctx, fontDict, 'FirstChar'), 0);
    const ws = numArr(ctx, dget(ctx, fontDict, 'Widths'));
    ws.forEach((w, k) => info.widths.set(first + k, w));
    info.defaultWidth = num(dget(ctx, descDict, 'MissingWidth'), 0);
    if (info.isType3) {
      const fm = numArr(ctx, dget(ctx, fontDict, 'FontMatrix'));
      if (fm.length === 6) info.fontMatrix = fm;
    }
    // base encoding
    const encObj = dget(ctx, fontDict, 'Encoding');
    let baseEnc = nameOf(encObj);
    const diffs = new Map();
    if (encObj instanceof PDFDict) {
      baseEnc = nameOf(dget(ctx, encObj, 'BaseEncoding'));
      let code = 0;
      for (const d of arr(ctx, dget(ctx, encObj, 'Differences'))) {
        if (d && d.asNumber) code = d.asNumber();
        else { const n = nameOf(d); if (n) diffs.set(code++, n); }
      }
    }
    info.encodingName = baseEnc || 'builtin';
    for (let c = 0; c < 256; c++) {
      let u = null;
      if (diffs.has(c)) u = glyphNameToUnicode(diffs.get(c));
      else if (baseEnc === 'MacRomanEncoding') u = macRomanToUnicode(c);
      else u = winAnsiToUnicode(c); // WinAnsi / Standard / builtin approximation
      if (u) info.toUni.set(c, u);
    }
    info.diffs = diffs;
    // standard 14 fonts (or aliases) without /Widths: use the built-in metrics
    if (!ws.length) {
      const m = std14For(nameOf(dget(ctx, fontDict, 'BaseFont')) || '');
      if (m) {
        info.std14 = true;
        for (let c = 0; c < 256; c++) {
          const w = std14Width(m, c, info.toUni.get(c), diffs.get(c));
          if (w !== null) info.widths.set(c, w);
        }
        if (!info.defaultWidth) info.defaultWidth = m.w.space || 500;
      }
    }
  }
  // ToUnicode overrides encoding guesses (only when valid printable Unicode is mapped)
  const tu = dget(ctx, fontDict, 'ToUnicode');
  if (tu && tu.dict) {
    const { map } = parseToUnicode(streamBytes(tu));
    if (map.size) {
      if (info.isType0) {
        info.toUni = map;
      } else {
        map.forEach((v, k) => {
          if (!v || v.charCodeAt(0) < 32 || v === '\uFFFD') return;
          // CorelDRAW bug: if Differences explicitly named a lowercase glyph (e.g. /gbreve, /scedilla) but ToUnicode mapped uppercase, keep Differences
          if (info.diffs && info.diffs.has(k)) {
            const dn = glyphNameToUnicode(info.diffs.get(k));
            if (dn && dn.toLowerCase() === v.toLowerCase() && dn !== v) return;
          }
          info.toUni.set(k, v);
        });
      }
      info.hasToUnicode = true;
    }
  }
  // descriptor
  if (descDict instanceof PDFDict) {
    const flags = num(dget(ctx, descDict, 'Flags'));
    info.descriptor = {
      flags, ascent: num(dget(ctx, descDict, 'Ascent'), 750), descent: num(dget(ctx, descDict, 'Descent'), -250),
      capHeight: num(dget(ctx, descDict, 'CapHeight'), 0), xHeight: num(dget(ctx, descDict, 'XHeight'), 0),
      italicAngle: num(dget(ctx, descDict, 'ItalicAngle'), 0), fontWeight: num(dget(ctx, descDict, 'FontWeight'), 0),
      stemV: num(dget(ctx, descDict, 'StemV'), 0), avgWidth: num(dget(ctx, descDict, 'AvgWidth'), 0),
      family: (() => { const f = dget(ctx, descDict, 'FontFamily'); return f && f.decodeText ? f.decodeText() : ''; })(),
    };
    const ff2 = dget(ctx, descDict, 'FontFile2'), ff3 = dget(ctx, descDict, 'FontFile3'), ff1 = dget(ctx, descDict, 'FontFile');
    if (ff2) { info.programRef = ff2; info.programType = 'truetype'; }
    else if (ff3) { info.programRef = ff3; info.programType = nameOf(dget(ctx, ff3.dict, 'Subtype')) === 'OpenType' ? 'opentype' : 'cff'; }
    else if (ff1) { info.programRef = ff1; info.programType = 'type1'; }
  }
  info.embedded = !!info.programRef;
  // Gömülü TrueType/OpenType font programından eksik veya bozuk (örn. CorelDRAW 'i' harfi) Unicode eşleşmelerini kurtar:
  if (info.programRef && (info.programType === 'truetype' || info.programType === 'opentype')) {
    try {
      const fk = fontkit.create(streamBytes(info.programRef));
      if (fk && fk.characterSet) {
        const gidToUni = new Map();
        for (const cp of fk.characterSet) {
          if (cp <= 32 || cp === 0xFFFD) continue;
          const g = fk.glyphForCodePoint(cp);
          if (g && g.id > 0 && !gidToUni.has(g.id)) gidToUni.set(g.id, String.fromCodePoint(cp));
        }
        if (info.isType0) {
          gidToUni.forEach((ch, gid) => {
            const cur = info.toUni.get(gid);
            if (!cur || !cur.trim() || cur.charCodeAt(0) <= 32 || cur === '\uFFFD') info.toUni.set(gid, ch);
          });
        } else {
          for (let c = 0; c < 256; c++) {
            const cur = info.toUni.get(c);
            if (cur && cur.trim() && cur.charCodeAt(0) > 32 && cur !== '\uFFFD') continue;
            // Önce fontun dahili cmap tablosundan (1-byte code -> glyph), olmazsa doğrudan GID olarak dene:
            let g = null;
            try { g = fk.glyphForCodePoint(c); } catch (e) { /* ignore */ }
            if (!g || !g.id) { try { g = fk.getGlyph(c); } catch (e) { /* ignore */ } }
            if (g && g.id > 0 && gidToUni.has(g.id)) info.toUni.set(c, gidToUni.get(g.id));
          }
        }
      }
    } catch (e) { /* ignore */ }
  }
  // reverse mapping (first code wins; prefer non-zero widths)
  info.toUni.forEach((u, code) => {
    if (!u) return;
    const w = info.widths.has(code) ? info.widths.get(code) : info.defaultWidth;
    if (!info.fromUni.has(u) || (w > 0 && info.widthOf(info.fromUni.get(u)) <= 0)) info.fromUni.set(u, code);
  });
  // inked glyphs with no / broken Unicode: resolved lazily, once per code
  // (shared lazily-built glyph source; Braille fonts are never "repaired")
  let src;
  const source = () => {
    if (src === undefined) { src = null; try { if (info.programRef) src = glyphSource(info, streamBytes(info.programRef), fontkit, info.cidToGid); } catch (e) { src = null; } }
    return src;
  };
  let braille;
  info.isBraille = () => { if (braille === undefined) { try { braille = detectBraille(info, /braille/i.test(baseFont) ? null : source()); } catch (e) { braille = false; } } return braille; };
  if (info.programRef) {
    let rec;
    info.recovered = new Map(); info.unresolved = new Map();
    info.recoverUni = (code) => {
      if (rec === undefined) { rec = null; if (!info.isBraille() && source()) rec = makeRecoverer(info, source()); }
      return rec ? rec(code) : null;
    };
  }
  // style
  const st = styleFromName(baseFont);
  const fl = info.descriptor.flags || 0;
  info.style = {
    family: st.family || info.descriptor.family || baseFont,
    weight: info.descriptor.fontWeight >= 100 && st.weight === 400 ? info.descriptor.fontWeight : (st.weight === 400 && (fl & (1 << 18)) ? 700 : st.weight),
    italic: st.italic || !!(fl & 64) || Math.abs(info.descriptor.italicAngle || 0) > 3,
    serif: !!(fl & 2) || /times|serif|georgia|garamond|minion|cambria|book/i.test(baseFont),
    mono: !!(fl & 1) || /mono|courier|consol/i.test(baseFont),
    clean: st.clean,
  };
  return info;
}

// methods attached lazily to keep loadFontInfo readable
export function attachFontMethods(info) {
  info.widthOf = function widthOf(code) {
    const w = this.widths.has(code) ? this.widths.get(code) : this.defaultWidth;
    return w;
  };
  return info;
}

// split a byte string into character codes
export function splitCodes(info, bytes) {
  const out = [];
  if (info.bytesPerCode === 2) {
    for (let i = 0; i + 1 < bytes.length; i += 2) out.push({ code: (bytes[i] << 8) | bytes[i + 1], len: 2 });
    if (bytes.length % 2) out.push({ code: bytes[bytes.length - 1], len: 1 });
  } else {
    for (let i = 0; i < bytes.length; i++) out.push({ code: bytes[i], len: 1 });
  }
  return out;
}

export function encodeCode(info, code) {
  return info.bytesPerCode === 2 ? [(code >> 8) & 255, code & 255] : [code & 255];
}

export class FontCache {
  constructor(ctx) { this.ctx = ctx; this.byRef = new Map(); }
  get(fontRefOrDict, key) {
    const id = fontRefOrDict instanceof PDFRef ? fontRefOrDict.toString() : null;
    if (id && this.byRef.has(id)) return this.byRef.get(id);
    const dict = resolve(this.ctx, fontRefOrDict);
    const info = attachFontMethods({ widthOf() { return 0; } });
    let full;
    try { full = loadFontInfo(this.ctx, dict, key); } catch (e) { full = { key, subtype: 'unknown', baseFont: key, widths: new Map(), defaultWidth: 500, toUni: new Map(), fromUni: new Map(), bytesPerCode: 1, fontMatrix: [0.001, 0, 0, 0.001, 0, 0], descriptor: {}, style: { family: key, weight: 400, italic: false } }; }
    Object.assign(info, full);
    attachFontMethods(info);
    info.ref = fontRefOrDict instanceof PDFRef ? fontRefOrDict : null;
    info.id = id || `inline:${key}:${Math.random().toString(36).slice(2, 8)}`;
    if (id) this.byRef.set(id, info);
    return info;
  }
}
