// Open-document session: original bytes, pdf.js doc (rendering), pdf-lib doc
// (analysis), per-page analyses and the plain-data page model.
import { PDFDocument } from '../../vendor/pdf-lib.esm.min.js';
import fontkit from '../../vendor/fontkit.esm.js';
import { openPdfjs, isPasswordError } from '../engines/render/pdfjs.js';
import { FontCache } from '../engines/pdf/fonts.js';
import { analyzePage } from '../engines/pdf/analyze.js';
import { pageGeometry } from '../engines/pdf/interpreter.js';
import { FontAvailability } from '../engines/text/fontAvail.js';
import { loadPdfLib } from '../engines/pdf/pdfLoader.js';
import { History, snapshotPage } from './history.js';
import { autoFloatPageNumbers } from '../model/pageNumbers.js';
import { newId } from '../model/blockOps.js';
import { loadStd14 } from '../engines/pdf/std14.js';
import { ImageStore } from './imageStore.js';

export class OpenError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }

export class Session {
  constructor() {
    this.history = new History();
    this.analyses = new Map();
    this.selection = { pageId: null, ids: new Set() };
    this.tool = 'select';
    this.dirty = false;
    this.zoom = 1;
    this.insertFlow = true;
    this.images = new ImageStore(); // inserted pictures, by id
  }

  static async open(bytes, name, askPassword) {
    const s = new Session();
    s.name = name.replace(/\.pdf$/i, '');
    await loadStd14().catch(() => null);
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
    if (!head.includes('%PDF')) throw new OpenError('errNotPdf');
    // pdf.js (rendering) — may need a password
    let password = '';
    for (;;) {
      try { s.pdfjs = await openPdfjs(bytes, password); break; } catch (e) {
        if (isPasswordError(e)) {
          password = await askPassword(e.code === 2);
          if (password === null) throw new OpenError('cancelled');
          continue;
        }
        throw new OpenError('errBroken', e && e.message);
      }
    }
    // pdf-lib (analysis + export)
    let doc;
    try {
      const r = await loadPdfLib(bytes, password);
      doc = r.doc;
      if (r.decrypted) {
        // keep an unencrypted copy as the editing base: output stays editable
        bytes = await doc.save({ useObjectStreams: false });
        doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
        s.wasEncrypted = true;
      }
    } catch (e) {
      if (e && e.code === 'unsupported') throw new OpenError('errEncrypted');
      throw new OpenError('errBroken', e && e.message);
    }
    s.srcBytes = bytes;
    doc.registerFontkit(fontkit);
    s.workDoc = doc;
    s.fontCache = new FontCache(doc.context);
    s.avail = new FontAvailability(doc.context);
    const n = doc.getPageCount();
    if (n !== s.pdfjs.numPages) throw new OpenError('errBroken', 'page count mismatch');
    s.pages = [];
    for (let i = 0; i < n; i++) {
      const g = pageGeometry(doc.getPage(i));
      s.pages.push({ id: newId('pg'), srcIndex: i, w: g.width, h: g.height, blocks: null, deleted: [], erase: [], whiteBg: false, version: 0 });
    }
    return s;
  }

  async appendPdf(bytes, askPassword) {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
    if (!head.includes('%PDF')) throw new OpenError('errNotPdf');
    let password = '';
    for (;;) {
      try {
        const testPdf = await openPdfjs(bytes, password);
        try { await testPdf.destroy(); } catch { /* ignore */ }
        break;
      } catch (e) {
        if (isPasswordError(e)) {
          password = await askPassword(e.code === 2);
          if (password === null) throw new OpenError('cancelled');
          continue;
        }
        throw new OpenError('errBroken', e && e.message);
      }
    }
    let otherDoc;
    try {
      const r = await loadPdfLib(bytes, password);
      otherDoc = r.doc;
      if (r.decrypted) {
        const cleanBytes = await otherDoc.save({ useObjectStreams: false });
        otherDoc = await PDFDocument.load(cleanBytes, { updateMetadata: false, throwOnInvalidObject: false });
      }
    } catch (e) {
      if (e && e.code === 'unsupported') throw new OpenError('errEncrypted');
      throw new OpenError('errBroken', e && e.message);
    }
    const addCount = otherDoc.getPageCount();
    if (!addCount) return [];
    const baseCount = this.workDoc.getPageCount();
    const indices = Array.from({ length: addCount }, (_, i) => i);
    const copied = await this.workDoc.copyPages(otherDoc, indices);
    for (const pg of copied) this.workDoc.addPage(pg);
    const mergedBytes = await this.workDoc.save({ useObjectStreams: false });
    const nextPdfjs = await openPdfjs(mergedBytes);
    const prevPdfjs = this.pdfjs;
    this.srcBytes = mergedBytes;
    this.pdfjs = nextPdfjs;
    if (prevPdfjs) { try { await prevPdfjs.destroy(); } catch { /* ignore */ } }
    const newPages = [];
    for (let k = 0; k < addCount; k++) {
      const srcIndex = baseCount + k;
      const g = pageGeometry(this.workDoc.getPage(srcIndex));
      newPages.push({ id: newId('pg'), srcIndex, w: g.width, h: g.height, blocks: null, deleted: [], erase: [], whiteBg: false, version: 0 });
    }
    return newPages;
  }

  analysis(srcIndex) {
    if (!this.analyses.has(srcIndex)) {
      const an = analyzePage(this.workDoc, srcIndex, this.fontCache);
      this.avail.noteUsed(an.interp.glyphs);
      this.analyses.set(srcIndex, an);
    }
    return this.analyses.get(srcIndex);
  }
  // make sure the page has its block model
  ensurePage(page) {
    if (page.blocks) return page;
    if (page.srcIndex === null) { page.blocks = []; page.initial = snapshotPage(page); return page; }
    const an = this.analysis(page.srcIndex);
    page.blocks = structuredClone(an.seg.blocks);
    if (this.pages.length >= 2) {
      const nIdx = page === this.pages[0] ? 1 : 0;
      const np = this.pages[nIdx];
      if (np && np.srcIndex !== null && !this.analyses.has(np.srcIndex)) {
        try { this.analysis(np.srcIndex); } catch {}
      }
      autoFloatPageNumbers(this);
    }
    page.initial = snapshotPage(page);
    return page;
  }
  analyzeAllInBackground(onDone) {
    let i = 0;
    const step = () => {
      if (i >= this.pages.length) { if (onDone) onDone(); return; }
      const p = this.pages[i++];
      if (p.srcIndex !== null) { try { this.analysis(p.srcIndex); } catch (e) { console.warn(e); } }
      (window.requestIdleCallback || setTimeout)(step);
    };
    step();
  }
  pageById(id) { return this.pages.find((p) => p.id === id); }
  fontById(id) { for (const f of this.fontCache.byRef.values()) if (f.id === id) return f; return null; }
  get outName() { return `${this.name}-duzenlendi.pdf`; }
}
