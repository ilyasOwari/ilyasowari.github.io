// Per-page analysis: interpretation + segmentation + lookup helpers.
import { Interpreter, pageGeometry } from './interpreter.js';
import { pageContentBytes, PDFName, PDFDict, resolve } from './pdfobj.js';
import { PDFArray, PDFString, PDFHexString } from '../../../vendor/pdf-lib.esm.min.js';
import { segmentPage } from '../segmentation/segment.js';
import { buildAtoms } from '../segmentation/atoms.js';
import { inv, transformBox, apply } from '../../core/geometry.js';

export function analyzePage(doc, pageIndex, fontCache) {
  const page = doc.getPage(pageIndex);
  const interp = new Interpreter(doc.context, fontCache);
  let rec;
  try {
    rec = interp.run(pageContentBytes(doc.context, page.node), page.node.Resources());
  } catch (e) {
    rec = interp.run(new Uint8Array(0), page.node.Resources());
    interp.failed = String(e && e.message || e);
  }
  const geo = pageGeometry(page);
  const M = geo.M, Minv = inv(M);
  interp.glyphs.forEach((g, i) => {
    g.idx = i;
    const b = transformBox(M, g.bbox);
    g.ub = b; g.ucx = (b.x0 + b.x1) / 2; g.ucy = (b.y0 + b.y1) / 2;
  });
  const seg = segmentPage(interp, geo);
  const atoms = seg.atoms;
  const bgItemSet = new Set(atoms.bgItems.map((a) => a.item));
  const bgFillItem = atoms.bgItems.filter((a) => a.fill && a.kind === 'path' && a.area > geo.width * geo.height * 0.8).pop();
  const textRight = seg.textAtoms.length ? Math.max(...seg.textAtoms.filter((t) => !t.decor).map((t) => t.b.x1), 0) : 0;
  const links = [];
  const widgets = [];
  const visualAnnots = [];
  try {
    const annots = resolve(doc.context, page.node.get(PDFName.of('Annots')));
    if (annots instanceof PDFArray) {
      for (let i = 0; i < annots.size(); i++) {
        const d = resolve(doc.context, annots.get(i));
        if (!(d instanceof PDFDict)) continue;
        const sub = resolve(doc.context, d.get(PDFName.of('Subtype')));
        const rect = resolve(doc.context, d.get(PDFName.of('Rect')));
        const rectBox = rect instanceof PDFArray && rect.size() >= 4
          ? (() => {
            const nums = [0, 1, 2, 3].map((k) => resolve(doc.context, rect.get(k))?.asNumber?.() ?? 0);
            return transformBox(M, { x0: Math.min(nums[0], nums[2]), y0: Math.min(nums[1], nums[3]), x1: Math.max(nums[0], nums[2]), y1: Math.max(nums[1], nums[3]) });
          })()
          : null;
        if (sub !== PDFName.of('Link') && sub !== PDFName.of('Popup') && rectBox) {
          visualAnnots.push({ idx: i, b: rectBox });
        }
        if (sub === PDFName.of('Link')) {
          const act = resolve(doc.context, d.get(PDFName.of('A')));
          if (!rectBox || !(act instanceof PDFDict)) continue;
          if (resolve(doc.context, act.get(PDFName.of('S'))) !== PDFName.of('URI')) continue;
          const uObj = resolve(doc.context, act.get(PDFName.of('URI')));
          const uri = uObj instanceof PDFString || uObj instanceof PDFHexString ? uObj.decodeText() : '';
          if (!uri) continue;
          links.push({ b: rectBox, uri, idx: i });
        } else if (sub === PDFName.of('Widget')) {
          const parent = resolve(doc.context, d.get(PDFName.of('Parent')));
          const pDict = parent instanceof PDFDict ? parent : null;
          const ft = resolve(doc.context, d.get(PDFName.of('FT'))) || (pDict && resolve(doc.context, pDict.get(PDFName.of('FT'))));
          if (ft !== PDFName.of('Tx') && ft !== PDFName.of('Ch')) continue;
          const vObj = resolve(doc.context, d.get(PDFName.of('V'))) || (pDict && resolve(doc.context, pDict.get(PDFName.of('V'))));
          const vStr = vObj instanceof PDFString || vObj instanceof PDFHexString || vObj instanceof PDFName ? vObj.decodeText() : '';
          if (!rectBox) continue;
          if (!vStr.trim()) continue;
          widgets.push({ idx: i, b: rectBox });
          const daObj = resolve(doc.context, d.get(PDFName.of('DA'))) || (pDict && resolve(doc.context, pDict.get(PDFName.of('DA'))));
          const daStr = daObj instanceof PDFString || daObj instanceof PDFHexString ? daObj.decodeText() : '';
          const mSz = /(\d+(?:\.\d+)?)\s+Tf/.exec(daStr);
          const fontSize = mSz ? Math.max(8, Math.min(18, parseFloat(mSz[1]) || 10)) : 10;
          const bw = Math.max(20, rectBox.x1 - rectBox.x0), bh = Math.max(14, rectBox.y1 - rectBox.y0);
          seg.blocks.push({
            id: `w${pageIndex}_${i}`, kind: 'inserted', x: rectBox.x0, y: rectBox.y0, s: 1, bw, bh,
            origin: { x: rectBox.x0, y: rectBox.y0 }, parts: [], free: false, widgetIdx: i,
            inserted: {
              type: 'text',
              paras: vStr.replace(/\r\n/g, '\n').split('\n').map((t) => ({ text: t })),
              size: fontSize, font: 'Carlito-Regular.ttf', color: [29, 36, 51], maxW: bw, box: null,
            },
          });
        }
      }
      if (widgets.length) seg.blocks.sort((a, b) => a.y - b.y || a.x - b.x);
    }
  } catch { /* ignore */ }
  return {
    pageIndex, page, interp, rec, geo, M, Minv, seg, atoms, bgItemSet, textRight, links, widgets, visualAnnots,
    wmItemSet: seg.wmItemSet || new Set(), wmGlyphSet: seg.wmGlyphSet || new Set(),
    bgFill: bgFillItem ? { fill: bgFillItem.item.fillOp, gs: bgFillItem.item.gsName, rgb: bgFillItem.rgb } : null,
    uiBox(o) { if (!o.bbox) return null; if (!o._ub) o._ub = transformBox(M, o.bbox); return o._ub; },
    toUser(x, y) { return apply(Minv, x, y); },
  };
}
export { buildAtoms };
