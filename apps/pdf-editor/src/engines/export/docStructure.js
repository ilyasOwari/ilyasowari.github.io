// Keeps the parts of the document structure that matter to a reader when the
// output has to be rebuilt as a NEW document (pages deleted / reordered / added):
// bookmarks (outline), internal links between pages, and document info.
// Everything here is best effort: any failure is swallowed by the caller and
// the export goes on exactly as before.
import { PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFString, PDFHexString } from '../../../vendor/pdf-lib.esm.min.js';

const N = (s) => PDFName.of(s);
const textOf = (o) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : null);

function namedDests(doc) {
  const ctx = doc.context, map = new Map();
  const cat = doc.catalog;
  const old = ctx.lookup(cat.get(N('Dests')));
  if (old instanceof PDFDict) for (const [k, v] of old.entries()) map.set(k.decodeText(), v);
  const names = ctx.lookup(cat.get(N('Names')));
  const tree = names instanceof PDFDict ? ctx.lookup(names.get(N('Dests'))) : null;
  const seen = new Set();
  const walk = (node, depth) => {
    if (!(node instanceof PDFDict) || seen.has(node) || depth > 32) return;
    seen.add(node);
    const arr = ctx.lookup(node.get(N('Names')));
    if (arr instanceof PDFArray) for (let i = 0; i + 1 < arr.size(); i += 2) { const k = textOf(ctx.lookup(arr.get(i))); if (k !== null && !map.has(k)) map.set(k, arr.get(i + 1)); }
    const kids = ctx.lookup(node.get(N('Kids')));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) walk(ctx.lookup(kids.get(i)), depth + 1);
  };
  walk(tree, 0);
  return map;
}

// explicit destination array of a dest / named dest, or null
function resolveDest(doc, d, named) {
  const ctx = doc.context;
  let v = ctx.lookup(d);
  for (let hop = 0; hop < 3 && v && !(v instanceof PDFArray); hop++) {
    if (v instanceof PDFDict) v = ctx.lookup(v.get(N('D')));
    else { const k = textOf(v); if (k === null) return null; v = ctx.lookup(named().get(k)); }
  }
  return v instanceof PDFArray ? v : null;
}

// source page index of an explicit destination
function destPageIndex(doc, arr, pageIdx) {
  if (!arr || arr.size() < 1) return -1;
  const first = arr.get(0);
  if (first instanceof PDFRef) { const i = pageIdx.get(first.toString()); return i === undefined ? -1 : i; }
  if (first instanceof PDFNumber) return first.asNumber();
  return -1;
}

export function sourceContext(doc) {
  const pageIdx = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  let nd = null;
  const named = () => (nd || (nd = namedDests(doc)));
  return { doc, pageIdx, named };
}

// Before copyPages: point every internal link at a page NUMBER instead of a page
// object, so copying a page does not drag the whole target page along.
export function prepareLinks(src) {
  const { doc, pageIdx, named } = src;
  const ctx = doc.context;
  for (const page of doc.getPages()) {
    const annots = ctx.lookup(page.node.get(N('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = ctx.lookup(annots.get(i));
      if (!(a instanceof PDFDict) || ctx.lookup(a.get(N('Subtype'))) !== N('Link')) continue;
      const fix = (holder, key) => {
        const arr = resolveDest(doc, holder.get(N(key)), named);
        if (!arr) { holder.delete(N(key)); return false; }
        const idx = destPageIndex(doc, arr, pageIdx);
        if (idx < 0) { holder.delete(N(key)); return false; }
        const rest = []; for (let k = 1; k < arr.size(); k++) rest.push(ctx.lookup(arr.get(k)));
        holder.set(N(key), ctx.obj([PDFNumber.of(idx), ...rest]));
        return true;
      };
      if (a.has(N('Dest'))) fix(a, 'Dest');
      const act = ctx.lookup(a.get(N('A')));
      if (act instanceof PDFDict && ctx.lookup(act.get(N('S'))) === N('GoTo')) {
        const copy = act.clone(ctx);
        fix(copy, 'D');
        a.set(N('A'), copy);
      }
    }
  }
}

// After copyPages: page numbers -> the new page objects; links to deleted pages go
function finishLinks(out, oldToNew) {
  const ctx = out.context, pages = out.getPages();
  for (const page of pages) {
    const annots = ctx.lookup(page.node.get(N('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    const keep = [];
    let changed = false;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i), a = ctx.lookup(ref);
      let ok = true;
      if (a instanceof PDFDict && ctx.lookup(a.get(N('Subtype'))) === N('Link')) {
        const remap = (holder, key) => {
          const arr = ctx.lookup(holder.get(N(key)));
          if (!(arr instanceof PDFArray) || !(arr.get(0) instanceof PDFNumber)) return;
          const j = oldToNew.get(arr.get(0).asNumber());
          if (j === undefined) { ok = false; return; }
          arr.set(0, pages[j].ref);
        };
        if (a.has(N('Dest'))) remap(a, 'Dest');
        const act = ctx.lookup(a.get(N('A')));
        if (act instanceof PDFDict && ctx.lookup(act.get(N('S'))) === N('GoTo') && act.has(N('D'))) remap(act, 'D');
        if (a.has(N('Dest')) === false && !(act instanceof PDFDict) && !a.has(N('A'))) ok = false; // nothing left to do
      }
      if (ok) keep.push(ref); else changed = true;
    }
    if (changed) page.node.set(N('Annots'), ctx.obj(keep));
  }
}

function copyOutline(src, out, oldToNew) {
  const { doc, pageIdx, named } = src;
  const sctx = doc.context, octx = out.context;
  const root = sctx.lookup(doc.catalog.get(N('Outlines')));
  if (!(root instanceof PDFDict)) return;
  const pages = out.getPages();
  const seen = new Set();
  let total = 0;
  const destOf = (item) => {
    let d = item.get(N('Dest'));
    if (!d) { const a = sctx.lookup(item.get(N('A'))); if (a instanceof PDFDict && sctx.lookup(a.get(N('S'))) === N('GoTo')) d = a.get(N('D')); }
    if (!d) return null;
    const arr = resolveDest(doc, d, named);
    const j = oldToNew.get(destPageIndex(doc, arr, pageIdx));
    if (j === undefined) return null;
    const rest = []; for (let k = 1; k < arr.size(); k++) { const v = sctx.lookup(arr.get(k)); rest.push(v instanceof PDFNumber || v instanceof PDFName ? v : null); }
    return octx.obj([pages[j].ref, ...rest.map((v) => v || 'null')].map((v) => (v === 'null' ? octx.obj(null) : v)));
  };
  const build = (first, parentRef, depth) => {
    const made = [];
    let cur = sctx.lookup(first);
    while (cur instanceof PDFDict && !seen.has(cur) && depth < 64 && total < 20000) {
      seen.add(cur); total++;
      const ref = octx.nextRef();
      const kids = build(cur.get(N('First')), ref, depth + 1);
      const dest = destOf(cur);
      if (dest || kids.length) {
        const title = textOf(sctx.lookup(cur.get(N('Title')))) || '';
        const d = octx.obj({});
        d.set(N('Title'), PDFHexString.fromText(title));
        d.set(N('Parent'), parentRef);
        if (dest) d.set(N('Dest'), dest);
        if (kids.length) {
          const cnt = sctx.lookup(cur.get(N('Count')));
          const closed = cnt instanceof PDFNumber && cnt.asNumber() < 0;
          d.set(N('First'), kids[0].ref); d.set(N('Last'), kids[kids.length - 1].ref);
          d.set(N('Count'), PDFNumber.of(closed ? -kids.length : kids.length));
        }
        const f = sctx.lookup(cur.get(N('F'))); if (f instanceof PDFNumber) d.set(N('F'), f);
        const c = sctx.lookup(cur.get(N('C')));
        if (c instanceof PDFArray && c.size() === 3) d.set(N('C'), octx.obj([0, 1, 2].map((i) => { const v = sctx.lookup(c.get(i)); return v instanceof PDFNumber ? v.asNumber() : 0; })));
        made.push({ ref, d });
      }
      cur = sctx.lookup(cur.get(N('Next')));
    }
    made.forEach((m, i) => {
      if (i > 0) m.d.set(N('Prev'), made[i - 1].ref);
      if (i < made.length - 1) m.d.set(N('Next'), made[i + 1].ref);
      octx.assign(m.ref, m.d);
    });
    return made;
  };
  const rootRef = octx.nextRef();
  const top = build(root.get(N('First')), rootRef, 0);
  if (!top.length) return;
  octx.assign(rootRef, octx.obj({ Type: 'Outlines', First: top[0].ref, Last: top[top.length - 1].ref, Count: top.length }));
  out.catalog.set(N('Outlines'), rootRef);
  const mode = sctx.lookup(doc.catalog.get(N('PageMode')));
  if (mode instanceof PDFName) out.catalog.set(N('PageMode'), mode);
}

function copyInfo(doc, out, fallbackTitle) {
  const tryDo = (fn) => { try { fn(); } catch { /* ignore */ } };
  tryDo(() => out.setTitle(doc.getTitle() || fallbackTitle));
  tryDo(() => { const v = doc.getAuthor(); if (v) out.setAuthor(v); });
  tryDo(() => { const v = doc.getSubject(); if (v) out.setSubject(v); });
  tryDo(() => { const v = doc.getKeywords(); if (v) out.setKeywords([v]); });
  tryDo(() => { const v = doc.getCreator(); if (v) out.setCreator(v); });
  tryDo(() => { const v = doc.getProducer(); if (v) out.setProducer(v); });
  tryDo(() => { const v = doc.getCreationDate(); if (v) out.setCreationDate(v); });
  tryDo(() => out.setModificationDate(new Date()));
  tryDo(() => { const l = doc.catalog.get(N('Lang')); const v = doc.context.lookup(l); if (v instanceof PDFString || v instanceof PDFHexString) out.catalog.set(N('Lang'), PDFHexString.fromText(v.decodeText())); });
}

// after copyPages(doc, indices) into `out`
export function finishStructure(src, out, indices, fallbackTitle) {
  const oldToNew = new Map();
  indices.forEach((oldIdx, j) => { if (oldIdx < src.pageIdx.size && !oldToNew.has(oldIdx)) oldToNew.set(oldIdx, j); });
  try { finishLinks(out, oldToNew); } catch (e) { console.warn('links', e); }
  try { copyOutline(src, out, oldToNew); } catch (e) { console.warn('outline', e); }
  try { copyInfo(src.doc, out, fallbackTitle); } catch (e) { console.warn('info', e); }
}
