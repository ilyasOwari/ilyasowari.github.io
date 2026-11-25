// Offline OCR (tesseract.js, local copy under vendor/tesseract). Loaded only
// the first time something actually needs reading; one worker, jobs queued.
// The worker is closed again after a minute without work.
const base = new URL('../../../vendor/tesseract/', import.meta.url);
let workerP = null, queue = Promise.resolve(), idleTimer = null, failed = false;

async function getWorker() {
  if (failed) throw new Error('ocr unavailable');
  if (!workerP) {
    workerP = (async () => {
      const T = await import(new URL('tesseract.esm.min.js', base).href);
      const createWorker = T.createWorker || (T.default && T.default.createWorker);
      return createWorker('tur+eng', 1, {
        workerPath: new URL('worker.min.js', base).href,
        corePath: new URL('./', base).href.replace(/\/$/, ''),
        langPath: new URL('lang', base).href,
        workerBlobURL: false, cacheMethod: 'none', gzip: true,
      });
    })().catch((e) => { failed = true; workerP = null; throw e; });
  }
  return workerP;
}
function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => { const p = workerP; workerP = null; if (p) { try { (await p).terminate(); } catch (e) { /* ignore */ } } }, 60000);
}
function run(canvas, psm) {
  const job = queue.then(async () => {
    clearTimeout(idleTimer);
    const w = await getWorker();
    await w.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1', tessedit_char_whitelist: '' });
    const { data } = await w.recognize(canvas);
    return { text: (data.text || '').replace(/\s+$/, ''), confidence: data.confidence || 0 };
  });
  queue = job.catch(() => {}).then(armIdle);
  return job;
}
// lines with their words (text, confidence, bbox in canvas px) of a region
// coloured text (yellow on blue, white on a photo) reads far better from a
// plain grey image than from the colours themselves
function grey(canvas) {
  const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d'); g.drawImage(canvas, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const y = 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2]; a[i] = a[i + 1] = a[i + 2] = y; a[i + 3] = 255; }
  g.putImageData(d, 0, 0);
  return c;
}
// whitelist: only these characters may be read (e.g. digits for a score cell)
export function ocrWords(canvas, psm = 3, { whitelist = '' } = {}) {
  const job = queue.then(async () => {
    canvas = grey(canvas);
    clearTimeout(idleTimer);
    const w = await getWorker();
    await w.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1', tessedit_char_whitelist: whitelist });
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: false, hocr: false, tsv: false });
    const lines = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      lines.push({ bbox: l.bbox, words: (l.words || []).map((wd) => ({ text: wd.text, confidence: wd.confidence, bbox: wd.bbox })) });
    }
    return lines;
  });
  queue = job.catch(() => {}).then(armIdle);
  return job;
}
export const ocrLine = (canvas) => run(canvas, 7);   // single text line
export const ocrGlyph = (canvas) => run(canvas, 10); // single character
export const ocrAvailable = () => !failed;
