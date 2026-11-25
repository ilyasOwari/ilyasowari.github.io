// Renders changed block parts (and white-background pages) exactly like the
// exporter would, by building a tiny one-page PDF with the same code and
// rendering it with pdf.js.
import { PDFDocument, PDFObjectCopier, PDFName, PDFArray, PDFNumber } from '../../../vendor/pdf-lib.esm.min.js';
import fontkit from '../../../vendor/fontkit.esm.js';
import { buildSourceForms, assemblePart, placementMatrix } from '../export/partBuilder.js';
import { vecRuleIdx } from '../export/vecRules.js';
import { naturalFillOps } from '../export/pageComposer.js';
import { FontEmbedder } from '../export/fontEmbedder.js';
import { filterStream, cloneResources, addXObjects } from '../pdf/filter.js';
import { transformBox } from '../../core/geometry.js';
import { fmtNum as f } from '../pdf/lexer.js';
import { openPdfjs, renderPage } from './pdfjs.js';

const srcFormCache = new WeakMap(); // an -> Map(key -> forms)
export function clearSourceForms(an) { srcFormCache.delete(an); }
function sourceForms(session, an, part, whiteBg) {
  let m = srcFormCache.get(an);
  if (!m) { m = new Map(); srcFormCache.set(an, m); }
  const key = JSON.stringify([part.src, part.clip || 0, whiteBg, part.edit ? [part.edit.removeGlyphs, part.edit.dropGfx || 0, part.edit.dropBoxes || 0] : 0, part.erase || 0, part.removedG || 0, part.bgMode || 0, part.obj ? [part.keep || 0, part.keepG || 0, vecRuleIdx(an, part)] : 0]);
  if (!m.has(key)) m.set(key, buildSourceForms(session.workDoc, an, part, { whiteBg }));
  return m.get(key);
}

async function newDoc() { const d = await PDFDocument.create({ updateMetadata: false }); d.registerFontkit(fontkit); return d; }
function setBox(page, box, rotate) {
  const arr = (b) => { const a = PDFArray.withContext(page.doc.context); [b.x0, b.y0, b.x1, b.y1].forEach((v) => a.push(PDFNumber.of(v))); return a; };
  page.node.set(PDFName.of('MediaBox'), arr(box));
  page.node.delete(PDFName.of('CropBox'));
  if (rotate) page.node.set(PDFName.of('Rotate'), PDFNumber.of(rotate));
}
async function renderDoc(doc, scale, canvas, transparent = false) {
  const bytes = await doc.save({ useObjectStreams: false });
  const pdf = await openPdfjs(bytes);
  try { const pg = await pdf.getPage(1); await renderPage(pg, scale, canvas, transparent); }
  finally { pdf.destroy(); }
  return canvas;
}

// Render one part as it will appear (unscaled part size), to `canvas` at `scale` px/pt
export async function renderPartPreview(session, an, pageModel, part, scale, canvas, opts = {}) {
  const doc = await newDoc();
  const copier = PDFObjectCopier.for(session.workDoc.context, doc.context);
  const env = {
    doc, an, copy: (x) => copier.copy(x), fonts: new FontEmbedder(doc),
    fontById: (id) => session.fontById(id),
    naturalFill: naturalFillOps(an, pageModel, true), whiteBg: !!pageModel.whiteBg,
  };
  const sf = sourceForms(session, an, part, !!pageModel.whiteBg);
  const form = await assemblePart(env, part, sf);
  const fakeBlock = { x: 0, y: 0, s: 1 };
  const p0 = { ...part, dx: 0, dy: 0, sc: 1 };
  const m = placementMatrix(an, p0, fakeBlock);
  const page = doc.addPage([10, 10]);
  const ui = { x0: 0, y0: 0, x1: part.dw, y1: part.dh };
  setBox(page, transformBox(an.Minv, ui), an.geo.rot);
  const xd = doc.context.obj({}); xd.set(PDFName.of('P'), form);
  const res = doc.context.obj({}); res.set(PDFName.of('XObject'), xd);
  if (env.naturalFill.gs) { const gd = doc.context.obj({}); gd.set(PDFName.of(env.naturalFill.gs.name), copier.copy(env.naturalFill.gs.obj)); res.set(PDFName.of('ExtGState'), gd); }
  page.node.set(PDFName.of('Resources'), res);
  // natural colour under the part (as it would sit on the page)
  const bg = transformBox(an.Minv, ui);
  const fill = pageModel.whiteBg ? '1 g' : env.naturalFill(part.clip || part.src);
  // object parts are transparent: they are layered over each other
  const transparent = !!part.obj || opts.transparent;
  const content = (transparent ? '' : `q ${fill} ${f(bg.x0)} ${f(bg.y0)} ${f(bg.x1 - bg.x0)} ${f(bg.y1 - bg.y0)} re f Q\n`) + `q ${m.map(f).join(' ')} cm /P Do Q`;
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  return renderDoc(doc, scale, canvas, transparent);
}

// Page with its background items removed (for "Tüm zemini beyaz yap")
export async function renderWhitePage(session, an, scale, canvas) {
  const doc = await newDoc();
  const src = session.workDoc;
  const copier = PDFObjectCopier.for(src.context, doc.context);
  const filtered = filterStream(src, an.rec, { removeGlyph: () => false, dropItem: (it) => an.bgItemSet.has(it) });
  const res = cloneResources(src.context, an.page.node.Resources());
  addXObjects(src.context, res, filtered.extraXObjects);
  const page = doc.addPage([10, 10]);
  setBox(page, an.geo.box, an.geo.rot);
  page.node.set(PDFName.of('Resources'), copier.copy(res));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(filtered.bytes)));
  return renderDoc(doc, scale, canvas);
}
