// PaddleOCR (PP-OCRv5 detection + latin recognition, ONNX) in a module worker,
// so the page stays responsive while it reads. onnxruntime-web is vendored
// (vendor/ort, WASM build only), models live in assets/models/paddle. WASM is
// multi-threaded when the page is cross-origin isolated (launch.mjs sends
// COOP/COEP). WebGPU was left out: in tests its session setup took >70 s and
// driver bugs can give wrong text; CPU is ~4-5 s per page.
let ort = null, det = null, rec = null, keys = null, ep = 'wasm';

// mobile detector (4.8 MB) by default; the 88 MB server one is optional
// (pdfflow.ocrDet = 'server', file det_v5.onnx): ~1.5 points better, 3x slower
async function init({ base, det: detKind = 'mobile' }) {
  const detName = detKind === 'server' ? 'det_v5.onnx' : 'det_v5_mobile.onnx';
  if (det) return { ep };
  ort = await import(new URL('vendor/ort/ort.wasm.min.mjs', base).href);
  ort.env.wasm.wasmPaths = new URL('vendor/ort/', base).href;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  const models = new URL('assets/models/paddle/', base);
  const fetchBytes = async (name, share) => {
    const r = await fetch(new URL(name, models));
    if (!r.ok) throw new Error(`model ${name}: ${r.status}`);
    const total = +r.headers.get('content-length') || 0;
    const reader = r.body.getReader(); const parts = []; let got = 0, lastPct = -1;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      parts.push(value); got += value.length;
      const pct = total ? Math.round(share[0] + (share[1] - share[0]) * got / total) : -1;
      if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; self.postMessage({ type: 'progress', pct }); }
    }
    const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const [detB, recB, dictTxt] = [await fetchBytes(detName, [0, 80]), await fetchBytes('rec_latin_v5.onnx', [80, 90]), await (await fetch(new URL('latin_dict.txt', models))).text()];
  const lines = dictTxt.split('\n').map((s) => s.replace(/\r$/, ''));
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  keys = ['', ...lines, ' '];
  const tryEps = [['wasm']];
  let lastErr = null;
  for (const eps of tryEps) {
    try {
      det = await ort.InferenceSession.create(detB, { executionProviders: eps, graphOptimizationLevel: 'all' });
      rec = await ort.InferenceSession.create(recB, { executionProviders: eps, graphOptimizationLevel: 'all' });
      ep = eps[0];
      break;
    } catch (e) { lastErr = e; det = rec = null; }
  }
  if (!det) throw lastErr || new Error('no execution provider');
  self.postMessage({ type: 'progress', pct: 100 });
  return { ep };
}

// The CTC time steps only place a word roughly; the line layout / bold / size
// logic downstream wants Tesseract-like boxes that hug the ink. Each word may
// grow or shrink up to halfway to its neighbours; vertically it stays within
// 40% of the detected core height so it never reaches the next line.
function tightenToInk(L, W, H, b, words) {
  const X0 = Math.max(0, Math.floor(b.x0)), X1 = Math.min(W, Math.ceil(b.x1)), ch = b.core.y1 - b.core.y0,
    Y0 = Math.max(0, Math.floor(Math.max(b.y0, b.core.y0 - 0.4 * ch))), Y1 = Math.min(H, Math.ceil(Math.min(b.y1, b.core.y1 + 0.4 * ch)));
  if (X1 - X0 < 2 || Y1 - Y0 < 2) return;
  let lo = 255, hi = 0;
  for (let y = Y0; y < Y1; y += 2) for (let x = X0; x < X1; x += 2) { const v = L[y * W + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 40) return;
  const thr = (lo + hi) / 2, col = new Uint16Array(X1 - X0);
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) if (L[y * W + x] < thr) col[x - X0]++;
  for (let k = 0; k < words.length; k++) {
    const w = words[k].bbox;
    const left = k ? (words[k - 1].bbox.x1 + w.x0) / 2 : X0, right = k < words.length - 1 ? (w.x1 + words[k + 1].bbox.x0) / 2 : X1;
    let a = Math.max(X0, Math.floor(left)), z = Math.min(X1 - 1, Math.ceil(right));
    while (a < z && !col[a - X0]) a++;
    while (z > a && !col[z - X0]) z--;
    if (z - a < 1) continue;
    let ya = Y1, yz = Y0;
    for (let y = Y0; y < Y1; y++) for (let x = a; x <= z; x++) if (L[y * W + x] < thr) { if (y < ya) ya = y; if (y > yz) yz = y; break; }
    if (yz <= ya) continue;
    words[k].bbox = { x0: a, y0: ya, x1: z + 1, y1: yz + 1 };
  }
}

// box-filter sampler on a summed-area table: when a line is shrunk to the
// recogniser's 48 px (often 2-3x smaller than the page render) plain bilinear
// sampling aliases thin strokes away; averaging the covered pixels does not
function makeArea(L, W, H) {
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += L[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; }
  }
  const at = (x, y) => S[y * (W + 1) + x];
  // mean of L over [x0,x1) x [y0,y1) (integer-snapped, at least 1 px)
  return (x0, y0, x1, y1) => {
    let a = Math.max(0, Math.min(W - 1, Math.floor(x0))), b = Math.max(0, Math.min(H - 1, Math.floor(y0)));
    let c = Math.max(a + 1, Math.min(W, Math.round(x1))), d = Math.max(b + 1, Math.min(H, Math.round(y1)));
    return (at(c, d) - at(a, d) - at(c, b) + at(a, b)) / ((c - a) * (d - b));
  };
}

const bil = (L, W, H, x, y) => {
  x = Math.max(0, Math.min(W - 1.001, x)); y = Math.max(0, Math.min(H - 1.001, y));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
  return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + W] * (1 - fx) + L[i + W + 1] * fx) * fy;
};

async function run({ data, width: W, height: H, maxSide = 1920, boxThresh = 0.6, thresh = 0.3 }) {
  const tAll = performance.now();
  const rgba = new Uint8ClampedArray(data);
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2];
  // ---- detection (DB): probability map -> connected text regions
  const sc = Math.min(1, maxSide / Math.max(W, H));
  const dw = Math.max(32, Math.round((W * sc) / 32) * 32), dh = Math.max(32, Math.round((H * sc) / 32) * 32);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225], plane = dw * dh;
  const inp = new Float32Array(3 * plane);
  const area = makeArea(L, W, H), fx = W / dw, fy = H / dh;
  const sampleDet = fx > 1.3 || fy > 1.3 ? (x, y) => area(x * fx, y * fy, (x + 1) * fx, (y + 1) * fy) : (x, y) => bil(L, W, H, (x * W) / dw, (y * H) / dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const v = sampleDet(x, y) / 255;
    for (let c = 0; c < 3; c++) inp[c * plane + y * dw + x] = (v - mean[c]) / std[c];
  }
  const tm = { prep: 0, det: 0, rec: 0 }; let t0 = performance.now();
  const dOut = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, dh, dw]) });
  tm.det = performance.now() - t0; t0 = performance.now();
  const prob = dOut[det.outputNames[0]].data;
  const seen = new Uint8Array(plane), boxes = [], st = [];
  for (let i = 0; i < plane; i++) {
    if (seen[i] || prob[i] <= thresh) continue;
    let x0 = dw, y0 = dh, x1 = 0, y1 = 0, n = 0, ps = 0;
    seen[i] = 1; st.push(i);
    while (st.length) {
      const q = st.pop(), x = q % dw, y = (q / dw) | 0; n++; ps += prob[q];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !seen[q - 1] && prob[q - 1] > thresh) { seen[q - 1] = 1; st.push(q - 1); }
      if (x < dw - 1 && !seen[q + 1] && prob[q + 1] > thresh) { seen[q + 1] = 1; st.push(q + 1); }
      if (y > 0 && !seen[q - dw] && prob[q - dw] > thresh) { seen[q - dw] = 1; st.push(q - dw); }
      if (y < dh - 1 && !seen[q + dw] && prob[q + dw] > thresh) { seen[q + dw] = 1; st.push(q + dw); }
    }
    if (n < 10 || ps / n < boxThresh) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, d = (w * h * 1.5) / (2 * (w + h)); // DB "unclip"
    const kx = W / dw, ky = H / dh;
    boxes.push({
      core: { x0: x0 * kx, y0: y0 * ky, x1: (x1 + 1) * kx, y1: (y1 + 1) * ky },
      x0: Math.max(0, (x0 - d) * kx), y0: Math.max(0, (y0 - d) * ky), x1: Math.min(W, (x1 + 1 + d) * kx), y1: Math.min(H, (y1 + 1 + d) * ky),
    });
  }
  boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  // ---- recognition (CTC) per line; word boxes from the character time steps
  const lines = [];
  for (const b of boxes) {
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    if (bw < 4 || bh < 4) continue;
    const RH = 48, RW = Math.min(3200, Math.max(16, Math.round((bw * RH) / bh))), rp = RH * RW;
    const t = new Float32Array(3 * rp);
    const kx = bw / RW, ky = bh / RH, shrink = kx > 1.3 || ky > 1.3;
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
      const g = shrink ? area(b.x0 + x * kx, b.y0 + y * ky, b.x0 + (x + 1) * kx, b.y0 + (y + 1) * ky) : bil(L, W, H, b.x0 + ((x + 0.5) * bw) / RW, b.y0 + ((y + 0.5) * bh) / RH);
      const v = (g / 255 - 0.5) / 0.5;
      t[y * RW + x] = t[rp + y * RW + x] = t[2 * rp + y * RW + x] = v;
    }
    const tr0 = performance.now();
    const r = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, RH, RW]) });
    tm.rec += performance.now() - tr0;
    const o = r[rec.outputNames[0]], T = o.dims[1], C = o.dims[2], p = o.data;
    const chars = []; let last = -1;
    for (let i = 0; i < T; i++) {
      let m = 0, mv = -Infinity;
      for (let c = 0; c < C; c++) if (p[i * C + c] > mv) { mv = p[i * C + c]; m = c; }
      if (m !== 0 && m !== last) chars.push({ ch: keys[m] ?? '', t: i, pr: mv });
      last = m;
    }
    const step = bw / T, xAt = (ti) => b.x0 + (ti + 0.5) * step;
    const words = []; let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const text = cur.map((c) => c.ch).join('');
      const conf = 100 * cur.reduce((s, c) => s + c.pr, 0) / cur.length;
      const x0 = Math.max(b.core.x0, xAt(cur[0].t) - step * 1.2), x1 = Math.min(b.core.x1, xAt(cur[cur.length - 1].t) + step * 1.2);
      words.push({ text, confidence: Math.round(conf * 10) / 10, bbox: { x0, y0: b.core.y0, x1: Math.max(x0 + 1, x1), y1: b.core.y1 } });
      cur = [];
    };
    for (const c of chars) { if (c.ch === ' ') flush(); else cur.push(c); }
    flush();
    if (words.length) { tightenToInk(L, W, H, b, words); lines.push({ bbox: { ...b.core }, words }); }
  }
  tm.all = performance.now() - tAll;
  return { lines, tm };
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'init') self.postMessage({ id, ok: true, out: await init(e.data) });
    else { const { lines, tm } = await run(e.data); self.postMessage({ id, ok: true, out: lines, ms: tm }); }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
