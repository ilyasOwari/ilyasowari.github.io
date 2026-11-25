// Pure helpers for worksheet checkboxes / shapes ("İşaret Kutusu": Kare, Dikdörtgen, Daire).

const LEADING_BOX_RE = /^\s*(?:[☐☑☒□■▢○●◯◎⚪⚫⬜⬛◻◼▫▪▭]|\[\s*\]|\(\s*\)|\{\s*\})\s*/u;
const ROMAN_PAT = '(?:[xX]{1,3}(?:[iI][xX]|[iI][vV]|[vV]?[iI]{0,3})|[iI][xX]|[iI][vV]|[vV][iI]{0,3}|[iI]{1,3})';
const LEADING_LIST_RE = new RegExp(`^\\s*(?:\\(?\\s*(?:\\d{1,3}|${ROMAN_PAT}|[a-zA-Z])\\s*[.)]|[•●○◦▪▫‣▸►✓✔❖➤*\\-–—])\\s+`);
const TRAILING_MARKER_RE = /\s*(?:[☐☑☒□■▢○●◯◎⚪⚫⬜⬛◻◼▫▪▭]|\[\s*\]|\(\s*\)|\{\s*\}|\(\s*[TDYtdyFf]\s*\/\s*[FfYyNn]\s*\)|(?:\s+|^)[TDYtdy]\s*\/\s*[FfYyNn]|_{2,}|\.{4,})\s*$/u;

export function checkBoxGeom(cb, fs = 10) {
  const h0 = Math.max(9.5, Math.min(18, (fs || 10) * 1.18));
  const h = Math.round(h0 * 10) / 10;
  const w = cb && cb.shape === 'rect' ? Math.round(h0 * 1.75 * 10) / 10 : h;
  const r = cb && cb.shape === 'circle' ? 0 : Math.min(2.4, Math.round(h * 0.18 * 10) / 10);
  const gap = Math.max(5, Math.round((fs || 10) * 0.5 * 10) / 10);
  return { w, h, r, gap, oval: !!(cb && cb.shape === 'circle') };
}

export function cleanLeadingForCheckBox(text) {
  const orig = String(text ?? '');
  let next = orig;
  for (let pass = 0; pass < 2; pass++) {
    const step = next.replace(LEADING_BOX_RE, '').replace(LEADING_LIST_RE, '');
    if (step === next) break;
    next = step;
  }
  next = next.replace(/^\s+/, '');
  if (orig.trim() && !next.trim()) return { text: orig, removed: 0 };
  return { text: next, removed: Array.from(orig).length - Array.from(next).length };
}

export function cleanTrailingForCheckBox(text) {
  const orig = String(text ?? '');
  let next = orig;
  for (let pass = 0; pass < 2; pass++) {
    const step = next.replace(TRAILING_MARKER_RE, '');
    if (step === next) break;
    next = step;
  }
  next = next.replace(/\s+$/, '');
  if (orig.trim() && !next.trim()) return { text: orig, removed: 0 };
  return { text: next, removed: Array.from(orig).length - Array.from(next).length };
}

export function stripLeadingListPrefix(text) {
  const orig = String(text ?? '');
  const m = orig.match(LEADING_LIST_RE);
  if (!m) return { text: orig, removed: 0, sep: null };
  const next = orig.slice(m[0].length);
  if (orig.trim() && !next.trim()) return { text: orig, removed: 0, sep: null };
  const sep = m[0].includes(')') ? ')' : '.';
  return { text: next, removed: Array.from(orig).length - Array.from(next).length, sep };
}

export function alphaOrderLabel(idx) {
  let n = Math.max(0, Math.floor(idx));
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function smartOrderPrefix(kind, idx, sep = '.') {
  const label = kind === 'alpha' ? alphaOrderLabel(idx) : String(idx + 1);
  return `${label}${sep} `;
}

export function applySmartOrderText(text, kind, idx, sep = '.') {
  const orig = String(text ?? '');
  if (!orig.trim()) return { text: orig, removed: 0, prefix: '' };
  const stripped = stripLeadingListPrefix(orig);
  const prefix = smartOrderPrefix(kind, idx, sep);
  return { text: prefix + stripped.text, removed: stripped.removed, prefix };
}

export function cbDocxSymbol(shape) {
  if (shape === 'rect') return '▭';
  if (shape === 'circle') return '○';
  return '☐';
}

export function cbSig(cb) {
  return cb && cb.pos
    ? `${cb.pos}|${cb.shape || 'square'}|${cb.bc || ''}|${cb.fc ?? ''}|${cb.bw || ''}|${cb.alignX ?? ''}`
    : '';
}
