// Last-document memory in the browser's IndexedDB (no size limit like
// localStorage): the opened PDF's bytes are written ONCE when it is opened
// ('doc'), the editing state (page models, pictures, settings, view) after
// every change ('state'). Opening another PDF replaces both. Survives browser
// restarts (Chrome, Edge, Firefox, Brave); private windows forget it on close.
import { collectImageIds } from './imageStore.js';

const DB = 'pdfflow', STORE = 'work', LEGACY = 'last';
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const out = fn(st);
    t.oncomplete = () => { db.close(); res(out && out.result !== undefined ? out.result : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
    t.onabort = () => { db.close(); rej(t.error || new Error('abort')); };
  });
}
const enabledLS = () => { try { return localStorage.getItem('pdfflow.autosave') !== '0'; } catch { return true; } };
let persistAsked = false;
function askPersistent() {
  // keeps the browser from evicting the saved document under storage pressure
  // (silent in Chromium browsers; Firefox would show a prompt, so not there)
  if (persistAsked) return; persistAsked = true;
  try {
    if (/firefox/i.test(navigator.userAgent)) return;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
  } catch { /* ignore */ }
}

function stateOf(session, view = {}) {
  const pages = session.pages.map((p) => ({ id: p.id, srcIndex: p.srcIndex, w: p.w, h: p.h, blocks: p.blocks, deleted: p.deleted, erase: p.erase, whiteBg: p.whiteBg, keepOriginal: p.keepOriginal || [], initial: p.initial || null, natural: p.natural || null }));
  const images = session.images ? session.images.entries(collectImageIds(pages)) : [];
  const settings = {
    pageNums: session.pageNums || null, oldPageNumsAsked: !!session.oldPageNumsAsked,
    magnet: session.magnet !== false, lockPage: !!session.lockPage,
    insertFlow: session.insertFlow !== false,
    zoom: view.zoom || null, pageIndex: view.pageIndex ?? null,
  };
  return { docId: session.docId, pages, images, settings, dirty: !!session.dirty, time: Date.now() };
}

export const autosave = {
  enabled() { return enabledLS(); },
  setEnabled(v) { try { localStorage.setItem('pdfflow.autosave', v ? '1' : '0'); } catch { /* */ } if (!v) this.clear(); },
  // a newly opened document: forget the previous one, remember this one
  async saveDoc(session, view) {
    askPersistent();
    const doc = { docId: session.docId, name: session.name, bytes: session.srcBytes, wasEncrypted: !!session.wasEncrypted, time: Date.now() };
    const state = stateOf(session, view);
    await tx('readwrite', (st) => { st.delete(LEGACY); st.put(doc, 'doc'); st.put(state, 'state'); });
  },
  async save(session, view) {
    if (!session.docId) return;
    const state = stateOf(session, view);
    await tx('readwrite', (st) => st.put(state, 'state'));
  },
  // { name, bytes, docId, pages|null, images, settings } or null
  async load() {
    try {
      const [doc, state, legacy] = await tx('readonly', (st) => {
        const out = { result: [] };
        const a = st.get('doc'), b = st.get('state'), c = st.get(LEGACY);
        a.onsuccess = () => { out.result[0] = a.result; }; b.onsuccess = () => { out.result[1] = b.result; }; c.onsuccess = () => { out.result[2] = c.result; };
        return out;
      });
      if (doc && doc.bytes && doc.bytes.length) {
        const ok = state && state.docId === doc.docId && Array.isArray(state.pages) && state.pages.length;
        return { name: doc.name, bytes: doc.bytes, docId: doc.docId, pages: ok ? state.pages : null, images: ok ? state.images || [] : [], settings: ok ? state.settings || {} : {}, dirty: ok ? !!state.dirty : false };
      }
      // v5.1 and older: one record with bytes + pages (pictures inline)
      if (legacy && legacy.bytes && legacy.bytes.length && Array.isArray(legacy.pages)) {
        return { name: legacy.name, bytes: legacy.bytes, docId: null, pages: legacy.pages, images: legacy.images || [], settings: {}, dirty: true };
      }
      return null;
    } catch { return null; }
  },
  async clear() { try { await tx('readwrite', (st) => { st.delete('doc'); st.delete('state'); st.delete(LEGACY); }); } catch { /* ignore */ } },
};
