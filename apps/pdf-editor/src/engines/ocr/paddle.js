// Main-thread side of the PaddleOCR engine (see paddleWorker.js). Lazy: the
// worker and the ~13 MB of models load on the first full-page OCR and then
// stay in memory; a failure marks the engine unavailable for this session so
// the caller falls back to Tesseract.
const base = new URL('../../../', import.meta.url).href;
let lastMs = null;
let worker = null, ready = null, failed = false, nextId = 1, onProgress = null, epName = null;
const pending = new Map();

// a very slow machine or a stuck worker must not hang the app: give up and
// let the caller read the page with Tesseract instead
const LOAD_MS = 180000, RUN_MS = 120000;
function withTimeout(p, ms, what) {
  let tm;
  return Promise.race([p, new Promise((_, rej) => { tm = setTimeout(() => rej(new Error(`PaddleOCR ${what} timed out`)), ms); })]).finally(() => clearTimeout(tm));
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

function call(msg, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

export function paddleLoad({ progress = null } = {}) {
  if (failed) return Promise.reject(new Error('paddle unavailable'));
  onProgress = progress;
  if (!ready) {
    ready = (async () => {
      worker = new Worker(new URL('./paddleWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') { if (onProgress) onProgress(d.pct); return; }
        const p = pending.get(d.id); if (!p) return;
        pending.delete(d.id);
        if (d.ok) { if (d.ms) lastMs = d.ms; p.resolve(d.out); } else p.reject(new Error(d.error));
      };
      worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker error')); pending.clear(); };
      const r = await withTimeout(call({ type: 'init', base, det: lsGet('pdfflow.ocrDet') === 'server' ? 'server' : 'mobile' }), LOAD_MS, 'model load');
      epName = r && r.ep;
      return true;
    })().catch((e) => { failed = true; ready = null; try { worker && worker.terminate(); } catch (x) { /* ignore */ } worker = null; throw e; });
  }
  return ready;
}

// lines [{ bbox, words: [{ text, confidence, bbox }] }] in canvas px, like ocrWords()
export async function paddleWords(canvas, opts = {}) {
  await paddleLoad(opts);
  const g = canvas.getContext('2d');
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  try {
    return await withTimeout(call({ type: 'run', data: img.data.buffer, width: img.width, height: img.height, maxSide: +lsGet('pdfflow.ocrSide') || 1920 }, [img.data.buffer]), RUN_MS, 'page read');
  } catch (e) { failed = true; ready = null; try { worker && worker.terminate(); } catch (x) { /* ignore */ } worker = null; throw e; }
}

export const paddleAvailable = () => !failed;
export const paddleBackend = () => epName;
export const paddleTiming = () => lastMs; // { det, rec, post } ms of the last page

// "Sayfayı tara" choice, remembered: mode 'quality' (Tesseract + PaddleOCR,
// voted word by word; default) or 'fast' (PaddleOCR alone), + background cleanup
const KEY = 'pdfflow.scanPrefs';
export function getScanPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { mode: v.mode === 'fast' ? 'fast' : 'quality', cleanBg: !!v.cleanBg };
  } catch (e) { return { mode: 'quality', cleanBg: false }; }
}
export function setScanPrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify({ mode: p.mode === 'fast' ? 'fast' : 'quality', cleanBg: !!p.cleanBg })); } catch (e) { /* ignore */ }
}
