// Per-character styling chosen in the text editor (bold, italic, underline,
// colour, size, font). A paragraph carries `st: [{a, b, s}]` ranges over its
// characters; `s` = { b, i, u, c: '#rrggbb', k: size factor, z: size in pt (wins over k),
// f: 'lib:Family' | 'orig:<fontId>' }.
import { getManifest, loadFallbackFont, matchFont, fallbackHas } from './fontMatch.js';

export function styleAt(para, ci) {
  if (!para.st) return null;
  let out = null;
  for (const r of para.st) if (ci >= r.a && ci < r.b) out = { ...(out || {}), ...r.s };
  return out && Object.keys(out).length ? out : null;
}
// size multiplier of a character over the original glyph it is drawn from:
// an absolute size (z, pt) is reached exactly whatever the glyph's own size
export function sizeFactor(st, g) {
  if (st && st.z > 0) { const gs = g && (g.size || g.hsize); return gs > 0 ? st.z / gs : 1; }
  return (st && st.k) || 1;
}
export const hasStyles = (paras) => paras.some((p) => p.st && p.st.length);
export const bgSig = (b) => (b && (b.fc || b.bc) ? `${b.shape || 'round'}|${b.fc || ''}|${b.fo ?? 1}|${b.bc || ''}|${b.bw ?? 1.5}|${b.bo ?? 1}` : '');
export const styleSig = (s) => (s ? JSON.stringify(['b' in s ? (s.b ? 1 : 0) : -1, 'i' in s ? (s.i ? 1 : 0) : -1, s.u ? 1 : 0, s.c || '', s.k || 1, s.z || 0, s.f || '', s.v || '', s.link || '', s.ls || 0, bgSig(s.bg)]) : '');

export function hexToFill(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { op: 'rg', args: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => Math.round(v * 1000) / 1000) };
}

// the library file for a family + bold/italic, or the closest one (synth the rest)
export function pickVariant(man, family, bold, italic) {
  const fam = man.filter((m) => m.family === family);
  if (!fam.length) return null;
  const score = (m) => (((m.weight || 400) >= 600) === !!bold ? 0 : 2) + (!!m.italic === !!italic ? 0 : 1);
  const best = fam.slice().sort((a, b) => score(a) - score(b) || Math.abs((a.weight || 400) - (bold ? 700 : 400)) - Math.abs((b.weight || 400) - (bold ? 700 : 400)))[0];
  return { file: best.file, synB: !!bold && (best.weight || 400) < 600, synI: !!italic && !best.italic };
}

// Is the ORIGINAL drawing of a font / glyph bold or italic? One rule for the editor,
// the initial styles and the layout: font weight, the font name, and - for a glyph -
// Word-style synthetic bold (text render mode 2 = fill + stroke).
export const fontIsBold = (info) => !!info && (!!(info.style && info.style.weight >= 600) || /bold|black|heavy|demi|semibold/i.test(`${info.baseFont || ''} ${(info.style && info.style.clean) || ''}`));
export const fontIsItalic = (info) => !!info && (!!(info.style && info.style.italic) || /italic|oblique/i.test(`${info.baseFont || ''} ${(info.style && info.style.clean) || ''}`));
export const glyphSynBold = (g) => !!g && g.Tr === 2;
export const glyphIsBold = (g) => !!g && (fontIsBold(g.font) || glyphSynBold(g));
export const glyphIsItalic = (g) => !!g && fontIsItalic(g.font);
const origBold = fontIsBold;
const origItalic = fontIsItalic;

// Preloads every library font the styles need; returns a sync resolver used by layout.
export async function prepareStyleFonts(model, paras, fontInfoById) {
  const man = await getManifest();
  const famOf = new Map();
  const loaded = new Map();
  const infoFamily = async (info) => {
    if (!info) return 'Carlito';
    if (!famOf.has(info.id)) { const m = await matchFont(info); famOf.set(info.id, m ? m.family : 'Carlito'); }
    return famOf.get(info.id);
  };
  const want = new Set();
  const fontsInModel = new Map();
  for (const g of model.charGlyph.concat(model.origCharGlyph || [])) if (g && g.g.font) fontsInModel.set(g.g.font.id, g.g.font);
  const allFams = async () => {
    for (const info of fontsInModel.values()) {
      const fam = await infoFamily(info);
      for (const b of [false, true]) for (const i of [false, true]) { const v = pickVariant(man, fam, b, i); if (v) want.add(v.file); }
    }
  };
  // bold / italic original glyphs may be drawn regular (the editor shows a
  // character without b / i as regular): their families' variants are needed
  if (model.charGlyph.concat(model.origCharGlyph || []).some((g) => g && g.g && (glyphIsBold(g.g) || glyphIsItalic(g.g)))) await allFams();
  for (const p of paras) for (const r of p.st || []) {
    const s = r.s || {};
    const infos = s.f && s.f.startsWith('orig:') ? [fontInfoById(s.f.slice(5))] : [...fontsInModel.values()];
    if (s.f && s.f.startsWith('lib:')) {
      for (const b of [false, true]) for (const i of [false, true]) { const v = pickVariant(man, s.f.slice(4), b, i); if (v) want.add(v.file); }
    } else if ('b' in s || 'i' in s || s.f) {
      for (const info of infos) {
        const fam = await infoFamily(info);
        for (const b of [false, true]) for (const i of [false, true]) { const v = pickVariant(man, fam, b, i); if (v) want.add(v.file); }
      }
    }
  }
  for (const f of want) loaded.set(f, await loadFallbackFont(f));
  // resolve: (ch, srcGlyph g.g, style, avail) -> draw | null (null = no styling of the font)
  // What the editor shows is what gets drawn: b / i are on only when the
  // character's style says so; a bold / italic original glyph without them is
  // drawn regular. Explicit styles always win over the original font.
  return (ch, g, s, avail) => {
    s = s || {};
    let info = g.font;
    const wantB = !!s.b;
    const wantI = !!s.i;
    if (s.f && s.f.startsWith('orig:')) {
      const oi = fontInfoById(s.f.slice(5));
      if (oi) {
        if (wantI === origItalic(oi) && (wantB === origBold(oi) || (wantB && !origBold(oi) && glyphSynBold(g)))) {
          const code = avail.canDraw(oi, ch);
          if (code >= 0) return { kind: 'orig', code, info: oi, ...(wantB && !origBold(oi) ? { synB: true } : {}) };
        }
        info = oi;
      }
    }
    if (!s.f && wantI === origItalic(info)) {
      if (wantB === origBold(info)) return null; // the original glyph as it is (synthetic stroke bold dropped)
      if (wantB && glyphSynBold(g)) {
        // Word-style stroke bold: keep the original face, stroke it again
        const code = avail.canDraw(info, ch);
        if (code >= 0) return { kind: 'orig', code, synB: true };
      }
    }
    let fam = s.f && s.f.startsWith('lib:') ? s.f.slice(4) : (famOf.get(info && info.id) || 'Carlito');
    const v = pickVariant(man, fam, wantB, wantI) || pickVariant(man, 'Carlito', wantB, wantI);
    const fb = v && loaded.get(v.file);
    if (!fb || !fallbackHas(fb, ch)) return null;
    return { kind: 'fb', fb, synB: v.synB, synI: v.synI };
  };
}

// fonts the editor offers: embedded fonts of this document that can draw ordinary
// letters, then the 14 library families
export async function fontChoices(an, avail) {
  const man = await getManifest();
  const seen = new Map();
  for (const x of an.seg.glyphs) {
    const info = x.g ? x.g.font : x.font;
    if (!info || seen.has(info.id)) continue;
    seen.set(info.id, info);
  }
  const orig = [];
  const names = new Set();
  for (const info of seen.values()) {
    if (info.isType3) continue;
    if (['a', 'e', 'o', 'n', 's', 't'].some((c) => avail.canDraw(info, c) < 0)) continue;
    const name = prettyFontName(info.baseFont || '');
    if (!name || names.has(name)) continue;
    names.add(name);
    orig.push({ id: 'orig:' + info.id, name, family: famGuess(man, name) });
  }
  const fams = [...new Set(man.map((m) => m.family))];
  const lib = fams.map((f) => ({ id: 'lib:' + f, name: f.replace(/([a-z])([A-Z])/g, '$1 $2'), regular: (pickVariant(man, f, false, false) || {}).file, family: f }));
  return { orig, lib };
}
export function prettyFontName(base) {
  return base.replace(/^[A-Z]{6}\+/, '').replace(/[-_,]+/g, ' ').replace(/MT$|PS$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}
function famGuess(man, name) {
  const n = name.toLowerCase().replace(/\s/g, '');
  const hit = man.find((m) => m.aliases.some((a) => n.includes(a.replace(/\s/g, ''))) || n.includes(m.family.toLowerCase()));
  return hit ? hit.family : 'Carlito';
}
