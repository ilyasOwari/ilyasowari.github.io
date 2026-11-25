// Resource-dictionary helpers: find the names a content stream uses and build a
// minimal resource dictionary so previews copy only what they need.
import { tokenize, PdfName } from '../pdf/lexer.js';
import { resolve, PDFDict, PDFName } from '../pdf/pdfobj.js';

const DEVICE = new Set(['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'Pattern']);

export function usedNames(bytes) {
  const used = { Font: new Set(), XObject: new Set(), ExtGState: new Set(), ColorSpace: new Set(), Pattern: new Set(), Shading: new Set(), Properties: new Set() };
  for (const o of tokenize(bytes)) {
    const a = o.args;
    const nm = (x) => (x instanceof PdfName ? x.n : null);
    switch (o.op) {
      case 'Tf': if (nm(a[0])) used.Font.add(nm(a[0])); break;
      case 'Do': if (nm(a[0])) used.XObject.add(nm(a[0])); break;
      case 'gs': if (nm(a[0])) used.ExtGState.add(nm(a[0])); break;
      case 'cs': case 'CS': if (nm(a[0]) && !DEVICE.has(nm(a[0]))) used.ColorSpace.add(nm(a[0])); break;
      case 'scn': case 'SCN': if (nm(a[a.length - 1])) used.Pattern.add(nm(a[a.length - 1])); break;
      case 'sh': if (nm(a[0])) used.Shading.add(nm(a[0])); break;
      case 'BDC': case 'DP': if (nm(a[1])) used.Properties.add(nm(a[1])); break;
      case 'BI': {
        const d = a[0] || [];
        for (const [k, v] of d) if ((k === '/CS' || k === '/ColorSpace') && v && v.startsWith('/') && !/Device|^\/[GR]$|^\/RGB|^\/CMYK|^\/I$/.test(v)) used.ColorSpace.add(v.slice(1));
        break;
      }
      default:
    }
  }
  return used;
}

// Build a dictionary with only `used` names from `res` (+ extra entries)
export function minimalResources(ctx, res, used, extra = {}) {
  const out = ctx.obj({});
  res = resolve(ctx, res);
  for (const cat of Object.keys(used)) {
    const names = used[cat];
    const sub = res instanceof PDFDict ? resolve(ctx, res.get(PDFName.of(cat))) : null;
    const ex = extra[cat] || new Map();
    if (!names.size && !ex.size) continue;
    const d = ctx.obj({});
    for (const n of names) {
      if (ex.has(n)) continue;
      const v = sub instanceof PDFDict ? sub.get(PDFName.of(n)) : undefined;
      if (v) d.set(PDFName.of(n), v);
    }
    for (const [n, v] of ex) d.set(PDFName.of(n), v);
    out.set(PDFName.of(cat), d);
  }
  return out;
}
