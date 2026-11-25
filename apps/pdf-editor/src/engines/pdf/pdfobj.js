// Thin helpers over pdf-lib's object model.
import { PDFDict, PDFArray, PDFName, PDFNumber, PDFRef, PDFStream, PDFRawStream, PDFString, PDFHexString, decodePDFRawStream } from '../../../vendor/pdf-lib.esm.min.js';

export function resolve(ctx, o) { return o instanceof PDFRef ? ctx.lookup(o) : o; }
export function dget(ctx, dict, key) {
  if (!(dict instanceof PDFDict)) return undefined;
  return resolve(ctx, dict.get(PDFName.of(key)));
}
export function num(o, def = 0) { return o instanceof PDFNumber ? o.asNumber() : def; }
export function nameOf(o) { return o instanceof PDFName ? o.decodeText() : undefined; }
export function arr(ctx, o) {
  o = resolve(ctx, o);
  if (!(o instanceof PDFArray)) return [];
  return o.asArray().map((x) => resolve(ctx, x));
}
export function numArr(ctx, o) { return arr(ctx, o).map((x) => num(x)); }
export function strBytes(o) {
  if (o instanceof PDFHexString || o instanceof PDFString) return o.asBytes();
  return null;
}
export function streamBytes(stream) {
  if (!stream) return new Uint8Array(0);
  if (stream instanceof PDFRawStream) {
    try { return decodePDFRawStream(stream).decode(); } catch (e) { return new Uint8Array(0); }
  }
  if (stream instanceof PDFStream && stream.getContents) return stream.getContents();
  return new Uint8Array(0);
}
export function dictKeys(dict) {
  if (!(dict instanceof PDFDict)) return [];
  return dict.keys().map((k) => k.decodeText());
}
export function pageContentBytes(ctx, pageNode) {
  const c = resolve(ctx, pageNode.get(PDFName.of('Contents')));
  const parts = [];
  if (c instanceof PDFArray) c.asArray().forEach((r) => parts.push(streamBytes(resolve(ctx, r))));
  else if (c) parts.push(streamBytes(c));
  let len = parts.reduce((a, p) => a + p.length + 1, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}
export { PDFDict, PDFArray, PDFName, PDFNumber, PDFRef, PDFStream, PDFRawStream };
