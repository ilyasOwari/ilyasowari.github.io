// pdf.js wrapper (local vendor copy, works offline).
import * as pdfjsLib from '../../../vendor/pdfjs/pdf.min.mjs';

const base = new URL('../../../vendor/pdfjs/', import.meta.url);
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;

export async function openPdfjs(bytes, password) {
  const task = pdfjsLib.getDocument({
    data: bytes.slice(0), password: password || undefined,
    cMapUrl: new URL('cmaps/', base).href, cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', base).href,
    isEvalSupported: false, enableXfa: false, fontExtraProperties: false,
  });
  return task.promise;
}
export function isPasswordError(e) { return e && (e.name === 'PasswordException' || /password/i.test(e.message || '')); }
export function isWrongPassword(e) { return e && e.name === 'PasswordException' && e.code === 2; }

// Render one page to a canvas at `scale` (CSS px per pt * devicePixelRatio)
export async function renderPage(pdfPage, scale, canvas, transparent = false) {
  const vp = pdfPage.getViewport({ scale });
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  const annMode = (pdfjsLib.AnnotationMode && pdfjsLib.AnnotationMode.ENABLE) ?? 1;
  const task = pdfPage.render({ canvasContext: ctx, viewport: vp, background: transparent ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,1)', annotationMode: annMode });
  await task.promise;
  return canvas;
}
export { pdfjsLib };
