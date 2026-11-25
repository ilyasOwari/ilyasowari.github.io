// ToUnicode CMap parser (bfchar / bfrange / codespacerange).
import { tokenize, PdfStr } from './lexer.js';

function bytesToInt(b) { let v = 0; for (const x of b) v = v * 256 + x; return v; }
function utf16beToString(b) {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  if (b.length % 2) s += String.fromCharCode(b[b.length - 1]);
  return s;
}

export function parseToUnicode(bytes) {
  const map = new Map();
  const codeLens = new Set();
  let ops;
  try { ops = tokenize(bytes); } catch (e) { return { map, codeLens }; }
  for (const o of ops) {
    const a = o.args;
    if (o.op === 'endcodespacerange') {
      for (let i = 0; i + 1 < a.length; i += 2) if (a[i] instanceof PdfStr) codeLens.add(a[i].bytes.length);
    } else if (o.op === 'endbfchar') {
      for (let i = 0; i + 1 < a.length; i += 2) {
        if (!(a[i] instanceof PdfStr)) continue;
        const code = bytesToInt(a[i].bytes);
        const dst = a[i + 1];
        if (dst instanceof PdfStr) map.set(code, utf16beToString(dst.bytes));
        codeLens.add(a[i].bytes.length);
      }
    } else if (o.op === 'endbfrange') {
      for (let i = 0; i + 2 < a.length; i += 3) {
        if (!(a[i] instanceof PdfStr) || !(a[i + 1] instanceof PdfStr)) continue;
        const lo = bytesToInt(a[i].bytes), hi = bytesToInt(a[i + 1].bytes);
        codeLens.add(a[i].bytes.length);
        const dst = a[i + 2];
        if (hi - lo > 65535) continue;
        if (Array.isArray(dst)) {
          for (let c = lo; c <= hi; c++) { const d = dst[c - lo]; if (d instanceof PdfStr) map.set(c, utf16beToString(d.bytes)); }
        } else if (dst instanceof PdfStr) {
          const base = Array.from(dst.bytes);
          for (let c = lo; c <= hi; c++) {
            const b = base.slice();
            let add = c - lo, k = b.length - 1;
            while (add > 0 && k >= 0) { const v = b[k] + add; b[k] = v & 255; add = v >> 8; k--; }
            map.set(c, utf16beToString(b));
          }
        }
      }
    }
  }
  return { map, codeLens };
}
