// Chooses the closest bundled open font for an original PDF font, using name
// hints, serif/mono class, weight, italic and width / x-height metrics.
import { loadJson, loadBytes } from '../../core/assets.js';
import fontkit from '../../../vendor/fontkit.esm.js';

let manifestP = null;
const parsed = new Map();
export function getManifest() {
  if (!manifestP) manifestP = loadJson('assets/fonts/manifest.json');
  return manifestP;
}
export async function loadFallbackFont(file) {
  if (parsed.has(file)) return parsed.get(file);
  const p = (async () => {
    const bytes = await loadBytes(`assets/fonts/${file}`);
    const fk = fontkit.create(bytes);
    return { file, bytes, fk, upm: fk.unitsPerEm };
  })();
  parsed.set(file, p);
  return p;
}

function origAvgWidth(info) {
  // average advance of lowercase letters present in the original font (em units)
  let sum = 0, n = 0;
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    const code = info.fromUni.get(ch);
    if (code === undefined) continue;
    const w = info.widthOf(code);
    if (w > 0) { sum += info.isType3 ? w * info.fontMatrix[0] : w / 1000; n++; }
  }
  return n >= 5 ? sum / n : 0;
}

export async function matchFont(info) {
  const man = await getManifest();
  const st = info.style || { family: '', weight: 400, italic: false };
  const name = `${info.baseFont} ${st.family} ${info.descriptor && info.descriptor.family || ''}`.toLowerCase().replace(/^[a-z]{6}\+/, '');
  const avg = origAvgWidth(info);
  const xh = info.descriptor && info.descriptor.xHeight ? info.descriptor.xHeight / 1000 : 0;
  let best = null, bestScore = -Infinity;
  for (const f of man) {
    let s = 0;
    const famHit = f.aliases.some((a) => name.includes(a)) || name.replace(/\s/g, '').includes(f.family.toLowerCase());
    if (famHit) s += 60;
    if (!!f.serif === !!st.serif) s += 18; else s -= 25;
    if (!!f.mono === !!st.mono) s += 6; else s -= 40;
    s -= Math.abs((f.weight || 400) - (st.weight || 400)) / 20;
    if (!!f.italic === !!st.italic) s += 10; else s -= 12;
    if (avg) s -= Math.abs(f.avgWidth - avg) / avg * 60;
    if (xh && f.xHeight) s -= Math.abs(f.xHeight - xh) / xh * 25;
    if (s > bestScore) { bestScore = s; best = f; }
  }
  return best;
}

// Width of a string in a fallback font, in em
export function fallbackAdvance(fb, ch) {
  const g = fb.fk.glyphForCodePoint(ch.codePointAt(0));
  return g ? g.advanceWidth / fb.upm : 0.5;
}
export function fallbackHas(fb, ch) {
  if (/\s/.test(ch)) return true;
  const g = fb.fk.glyphForCodePoint(ch.codePointAt(0));
  return !!(g && g.id);
}
