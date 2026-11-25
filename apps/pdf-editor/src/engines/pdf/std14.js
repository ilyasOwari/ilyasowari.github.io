// Metrics of the 14 standard PDF fonts (for fonts without /Widths).
import { loadJson } from '../../core/assets.js';
import { glyphNameToUnicode } from './encodings.js';

let data = null;
const uniToName = new Map();
export async function loadStd14() {
  if (data) return data;
  data = await loadJson('assets/std14.json');
  for (const f of Object.values(data)) for (const n of Object.keys(f.w)) { const u = glyphNameToUnicode(n); if (u && !uniToName.has(u)) uniToName.set(u, n); }
  return data;
}
export function std14For(baseFont) {
  if (!data || !baseFont) return null;
  let n = baseFont.replace(/^[A-Z]{6}\+/, '');
  if (data[n]) return data[n];
  const low = n.toLowerCase().replace(/[\s_-]/g, '');
  const bold = /bold|black|heavy|semibold/.test(low), ital = /italic|oblique/.test(low);
  let fam = null;
  if (/^(arial|helvetica|liberationsans|arimo|verdana|tahoma|segoe)/.test(low)) fam = 'Helvetica';
  else if (/^(times|liberationserif|tinos|georgia|cambria|garamond)/.test(low)) fam = 'Times';
  else if (/^(courier|liberationmono|cousine|consolas)/.test(low)) fam = 'Courier';
  else if (/^symbol/.test(low)) return data.Symbol;
  else if (/^zapf/.test(low)) return data.ZapfDingbats;
  if (!fam) return null;
  if (fam === 'Times') n = bold && ital ? 'Times-BoldItalic' : bold ? 'Times-Bold' : ital ? 'Times-Italic' : 'Times-Roman';
  else n = `${fam}${bold || ital ? '-' : ''}${bold ? 'Bold' : ''}${ital ? 'Oblique' : ''}`;
  return data[n] || null;
}
export function std14Width(metrics, code, uni, diffName) {
  const name = diffName || (uni ? uniToName.get(uni) : null);
  if (name && metrics.w[name] !== undefined) return metrics.w[name];
  return null;
}
