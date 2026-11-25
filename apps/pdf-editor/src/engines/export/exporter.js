// Builds the output PDF: a fresh copy of the original, every changed page
// recomposed (unchanged pages are byte-identical objects), blank pages added.
import { PDFDocument } from '../../../vendor/pdf-lib.esm.min.js';
import fontkit from '../../../vendor/fontkit.esm.js';
import { FontCache } from '../pdf/fonts.js';
import { analyzePage } from '../pdf/analyze.js';
import { composePage } from './pageComposer.js';
import { FontEmbedder } from './fontEmbedder.js';
import { snapshotPage } from '../../core/history.js';
import { pageNumberFor } from '../../model/pageNumbers.js';
import { pageNumberOps } from './pageNumberOps.js';
import { sourceContext, prepareLinks, finishStructure } from './docStructure.js';

export function isPageChanged(p) {
  if (p.srcIndex === null) return true;
  if (!p.blocks) return false;
  return JSON.stringify(snapshotPage(p)) !== JSON.stringify(p.initial);
}

export async function buildOutput(session) {
  const doc = await PDFDocument.load(session.srcBytes, { updateMetadata: false, throwOnInvalidObject: false });
  doc.registerFontkit(fontkit);
  const n0 = doc.getPageCount();
  // final page order: original pages by srcIndex, blanks as new pages
  const order = session.pages;
  const keep = new Set(order.filter((p) => p.srcIndex !== null).map((p) => p.srcIndex));
  // insert blank pages at the end first, then reorder via indices
  const blankIdx = new Map();
  for (const p of order) if (p.srcIndex === null) { doc.addPage([p.w, p.h]); blankIdx.set(p.id, doc.getPageCount() - 1); }
  const fc = new FontCache(doc.context);
  const fonts = new FontEmbedder(doc);
  const fontById = (id) => fc.byRef.get(id) || null;
  // analyses of the ORIGINAL page content (taken before any page is recomposed)
  const anCache = new Map();
  const analysisOf = (i) => { if (!anCache.has(i)) anCache.set(i, analyzePage(doc, i, fc)); return anCache.get(i); };
  const numbered = !!(session.pageNums && session.pageNums.on);
  if (numbered) for (const p of order) session.ensurePage(p);
  const todo = order.filter((p) => p.blocks && (isPageChanged(p) || (numbered && pageNumberFor(session, order.indexOf(p)))));
  for (const p of todo) {
    analysisOf(p.srcIndex !== null ? p.srcIndex : blankIdx.get(p.id));
    for (const b of p.blocks) if (b.from !== undefined && b.from !== null) analysisOf(b.from);
  }
  for (const p of todo) {
    const idx = p.srcIndex !== null ? p.srcIndex : blankIdx.get(p.id);
    const num = pageNumberFor(session, order.indexOf(p));
    const pageExtras = num ? (an, pm, extraFonts) => pageNumberOps({ fonts }, an, pm, session.pageNums, num, extraFonts) : null;
    await composePage({ doc, fonts, fontById, analysisOf, pageExtras }, analysisOf(idx), p);
  }
  const indices = order.map((p) => (p.srcIndex !== null ? p.srcIndex : blankIdx.get(p.id)));
  const identity = indices.length === n0 && indices.every((v, i) => v === i);
  if (identity && keep.size === n0) return doc.save({ useObjectStreams: false });
  // pages deleted / reordered / added: a new document. Bookmarks, links between
  // pages and document info are carried over (best effort, never blocks saving).
  let src = null;
  try { src = sourceContext(doc); prepareLinks(src); } catch (e) { console.warn('links', e); src = null; }
  const out = await PDFDocument.create({ updateMetadata: false });
  const copied = await out.copyPages(doc, indices);
  copied.forEach((pg) => out.addPage(pg));
  if (src) finishStructure(src, out, indices, session.name);
  else { try { out.setTitle(doc.getTitle() || session.name); } catch { /* ignore */ } }
  return out.save({ useObjectStreams: false });
}
