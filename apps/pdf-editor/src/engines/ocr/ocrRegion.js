// "Metin tara": turning OCR output of a drawn rectangle into editable text
// items. Pure pixel work on RGBA image data ({ data, width, height }) so it
// can be tested without a browser.
//  - runs():      a line's words, low-confidence words dropped, split where a
//                 dropped word was (its pixels must stay untouched)
//  - sizeFor():   font size from the ink height and the letters it contains
//  - lineLook():  background around the text (flat/smooth gradient or busy),
//                 ink colour, bold, and for a flat background the cleaned
//                 pixels (the text painted out) as a patch

export const MIN_CONF = 60;

// words of one OCR line -> runs of consecutive confident words
export function runs(words, minConf = MIN_CONF) {
  const out = [];
  let cur = null;
  for (const w of words) {
    const txt = (w.text || '').trim();
    const ok = txt && (w.confidence ?? w.conf ?? 0) >= minConf && /[\p{L}\p{N}]/u.test(txt);
    if (!ok) { cur = null; continue; }
    if (!cur) { cur = { words: [] }; out.push(cur); }
    cur.words.push({ text: txt, bbox: w.bbox });
  }
  for (const r of out) {
    r.text = r.words.map((w) => w.text).join(' ');
    r.bbox = r.words.reduce((a, w) => ({ x0: Math.min(a.x0, w.bbox.x0), y0: Math.min(a.y0, w.bbox.y0), x1: Math.max(a.x1, w.bbox.x1), y1: Math.max(a.y1, w.bbox.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  }
  return out;
}

const ASC = /[A-ZÇĞİÖŞÜ0-9bdfhkltıiİ'"!?%&#/\\(){}[\]|]/u;
const DESC = /[gjpqyşçŞÇ(),;{}[\]|]/u;
// ink height (px) -> font size (px), with the share of the em the letters reach
export function sizeFor(text, hPx) {
  const up = ASC.test(text) ? 0.72 : 0.5;
  const down = DESC.test(text) ? 0.2 : 0;
  const em = hPx / (up + down);
  return { size: em, baselineFromBottom: down * em, top: up };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// least-squares plane c = a + b*x + c*y per channel over sample points
function fitPlane(pts) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  const sv = [0, 0, 0], sxv = [0, 0, 0], syv = [0, 0, 0];
  for (const p of pts) {
    n++; sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    for (let j = 0; j < 3; j++) { sv[j] += p.c[j]; sxv[j] += p.x * p.c[j]; syv[j] += p.y * p.c[j]; }
  }
  const M = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
  const solve = (b) => {
    const A = M.map((r, i) => [...r, b[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]];
      if (Math.abs(A[i][i]) < 1e-9) return null;
      for (let r = 0; r < 3; r++) { if (r === i) continue; const f = A[r][i] / A[i][i]; for (let c = i; c < 4; c++) A[r][c] -= f * A[i][c]; }
    }
    return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
  };
  const co = [0, 1, 2].map((j) => solve([sv[j], sxv[j], syv[j]]) || [sv[j] / Math.max(1, n), 0, 0]);
  return (x, y) => co.map((q) => q[0] + q[1] * x + q[2] * y);
}

// sample dominant background colour around + cleanly inside a word/run box
export function sampleBg(img, box) {
  const { data, width: W, height: H } = img;
  const bx0 = clamp(Math.floor(box.x0), 0, W - 1), by0 = clamp(Math.floor(box.y0), 0, H - 1);
  const bx1 = clamp(Math.ceil(box.x1), bx0 + 1, W), by1 = clamp(Math.ceil(box.y1), by0 + 1, H);
  const h = by1 - by0, r = clamp(Math.round(h * 0.14), 2, 10);
  const hist = new Map();
  const add = (x, y, wt = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4, k = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    const e = hist.get(k) || { n: 0, s: [0, 0, 0] };
    e.n += wt; e.s[0] += data[i] * wt; e.s[1] += data[i + 1] * wt; e.s[2] += data[i + 2] * wt;
    hist.set(k, e);
  };
  const stepR = Math.max(1, Math.round(r / 3));
  for (let y = by0 - r; y < by1 + r; y += stepR) {
    for (let x = bx0 - r; x < bx1 + r; x += stepR) {
      if (x < bx0 || x >= bx1 || y < by0 || y >= by1) add(x, y, 2);
    }
  }
  const stepI = Math.max(1, Math.round(Math.sqrt(((bx1 - bx0) * h) / 4000)));
  for (let y = by0; y < by1; y += stepI) for (let x = bx0; x < bx1; x += stepI) add(x, y, 1);
  let best = null;
  for (const e of hist.values()) if (!best || e.n > best.n) best = e;
  return best ? best.s.map((v) => Math.round(v / best.n)) : [255, 255, 255];
}

// look of one text run. box = ink bbox in px (x0,y0,x1,y1); sizePx = font size
export function lineLook(img, box, sizePx) {
  const { data, width: W, height: H } = img;
  const at = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const pad = Math.max(2, Math.round(sizePx * 0.09)); // ink, antialiasing and outlines
  const bx0 = clamp(Math.floor(box.x0), 0, W - 1), by0 = clamp(Math.floor(box.y0), 0, H - 1);
  const bx1 = clamp(Math.ceil(box.x1), bx0 + 1, W), by1 = clamp(Math.ceil(box.y1), by0 + 1, H);
  const cx0 = clamp(bx0 - pad, 0, W - 1), cy0 = clamp(by0 - pad, 0, H - 1);
  const cx1 = clamp(bx1 + pad, cx0 + 1, W), cy1 = clamp(by1 + pad, cy0 + 1, H);
  const ring = Math.max(2, Math.round(sizePx * 0.15));
  const R0x = clamp(cx0 - ring, 0, W), R0y = clamp(cy0 - ring, 0, H), R1x = clamp(cx1 + ring, 0, W), R1y = clamp(cy1 + ring, 0, H);
  const pts = [];
  const step = Math.max(1, Math.round(Math.sqrt(((R1x - R0x) * (R1y - R0y)) / 6000)));
  for (let y = R0y; y < R1y; y += 1) {
    for (let x = R0x; x < R1x; x += (y >= cy0 && y < cy1) ? 1 : step) {
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) continue;
      pts.push({ x, y, c: at(x, y) });
    }
  }
  if (pts.length < 8) for (let x = cx0; x < cx1; x++) { pts.push({ x, y: cy0, c: at(x, cy0) }); pts.push({ x, y: cy1 - 1, c: at(x, cy1 - 1) }); }
  // robust plane: fit, drop the worst quarter (stray ink of neighbours), refit
  let plane = fitPlane(pts);
  const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const ds = pts.map((p) => dist(p.c, plane(p.x, p.y)));
  const cut = ds.slice().sort((a, b) => a - b)[Math.floor(ds.length * 0.8)] ?? 0;
  const kept = pts.filter((p, i) => ds[i] <= cut);
  if (kept.length >= 8) plane = fitPlane(kept);
  let se = 0, near = 0;
  for (const p of pts) { const e = dist(p.c, plane(p.x, p.y)); se += e * e; if (e < 22) near++; }
  const rms = Math.sqrt(se / Math.max(1, pts.length)), share = near / Math.max(1, pts.length);
  const fullFlat = rms < 14 && share > 0.88;
  // main colour the text sits on (busy case: the cover and the box fill)
  const dominant = fullFlat ? ringBg(img, cx0, cy0, cx1, cy1, ring) : ringBg(img, cx0, cy0, cx1, cy1, ring);
  let innerFlat = false;
  if (!fullFlat) {
    const innerDom = sampleBg(img, box);
    const stepIn = Math.max(1, Math.round(Math.sqrt(((bx1 - bx0) * (by1 - by0)) / 900)));
    const domPts = [], otherPts = [];
    let totIn = 0;
    for (let y = by0; y < by1; y += stepIn) {
      for (let x = bx0; x < bx1; x += stepIn) {
        const c = at(x, y);
        totIn++;
        if (dist(c, innerDom) < 28) domPts.push({ x, y, c });
        else otherPts.push(c);
      }
    }
    const oHist = new Map();
    for (const c of otherPts) {
      const k = (c[0] >> 4) * 256 + (c[1] >> 4) * 16 + (c[2] >> 4);
      const e = oHist.get(k) || { n: 0, s: [0, 0, 0] }; e.n++; e.s[0] += c[0]; e.s[1] += c[1]; e.s[2] += c[2]; oHist.set(k, e);
    }
    let topOther = null;
    for (const e of oHist.values()) if (!topOther || e.n > topOther.n) topOther = e;
    const topC = topOther ? topOther.s.map((v) => v / topOther.n) : null;
    const inkIn = topC ? otherPts.filter((c) => dist(c, topC) < 40).length : 0;
    if (domPts.length >= Math.max(10, totIn * 0.38) && (domPts.length + inkIn) / Math.max(1, totIn) >= 0.88) {
      plane = fitPlane(domPts);
      let seIn = 0;
      for (const p of domPts) { const e = dist(p.c, plane(p.x, p.y)); seIn += e * e; }
      if (Math.sqrt(seIn / domPts.length) < 12) innerFlat = true;
    }
  }
  const flat = fullFlat || innerFlat;
  // ink: pixels inside the text box clearly away from the background
  const bgAt = flat ? plane : () => dominant;
  const inkPts = [];
  let maxD = 0;
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) { const c = at(x, y), d = dist(c, bgAt(x, y)); if (d > 40) { inkPts.push({ x, y, c, d }); if (d > maxD) maxD = d; } }
  const strong = inkPts.filter((p) => p.d >= maxD * 0.75);
  const ink = strong.length ? [0, 1, 2].map((j) => { const v = strong.map((p) => p.c[j]).sort((a, b) => a - b); return v[v.length >> 1]; }) : [29, 36, 51];
  // bold: typical horizontal stroke width against the font size
  const isInk = new Uint8Array((bx1 - bx0) * (by1 - by0));
  for (const p of inkPts) if (p.d >= maxD * 0.45) isInk[(p.y - by0) * (bx1 - bx0) + (p.x - bx0)] = 1;
  const runsW = [];
  for (let y = 0; y < by1 - by0; y++) { let r = 0; for (let x = 0; x <= bx1 - bx0; x++) { const v = x < bx1 - bx0 ? isInk[y * (bx1 - bx0) + x] : 0; if (v) r++; else if (r) { runsW.push(r); r = 0; } } }
  runsW.sort((a, b) => a - b);
  const stroke = runsW.length ? runsW[runsW.length >> 1] : 0;
  const bold = sizePx > 0 && stroke / sizePx > 0.125;
  // continuous stroke width: 2 x ink area / ink outline length (not quantised
  // to whole pixels like the run median) - used for page-relative bold
  const bw0 = bx1 - bx0, bh0 = by1 - by0;
  let inkN = 0, edgeN = 0;
  for (let y = 0; y < bh0; y++) for (let x = 0; x < bw0; x++) {
    if (!isInk[y * bw0 + x]) continue;
    inkN++;
    if (x === 0 || !isInk[y * bw0 + x - 1]) edgeN++;
    if (x === bw0 - 1 || !isInk[y * bw0 + x + 1]) edgeN++;
    if (y === 0 || !isInk[(y - 1) * bw0 + x]) edgeN++;
    if (y === bh0 - 1 || !isInk[(y + 1) * bw0 + x]) edgeN++;
  }
  const strokeF = edgeN ? (4 * inkN) / edgeN : 0;
  // edge softness: share of faint (antialias / scan blur) pixels among the ink
  const softN = inkPts.filter((p) => p.d < maxD * 0.45).length;
  const soft = inkPts.length ? softN / inkPts.length : 0;
  const out = { flat, rms, share, dominant, ink, bold, stroke, strokeF, soft, rect: { x0: cx0, y0: cy0, x1: cx1, y1: cy1 } };
  if (!flat) {
    // busy (photo/pattern): keep the core [cx0..cx1, cy0..cy1] 100% opaque so original
    // ink/outlines never bleed through, blur cleaned background, feather only an extra outer skirt
    const feather = Math.max(2, Math.min(5, Math.round(sizePx * 0.08)));
    const X0 = clamp(cx0 - feather, 0, cx0), Y0 = clamp(cy0 - feather, 0, cy0);
    const X1 = clamp(cx1 + feather, cx1, W), Y1 = clamp(cy1 + feather, cy1, H);
    const w = X1 - X0, h = Y1 - Y0;
    const rawMask = new Uint8Array(w * h);
    const buf = new Float32Array(w * h * 3);
    const coreX0 = Math.max(0, bx0 - 1 - X0), coreY0 = Math.max(0, by0 - 1 - Y0);
    const coreX1 = Math.min(w, bx1 + 1 - X0), coreY1 = Math.min(h, by1 + 1 - Y0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = at(X0 + x, Y0 + y), idx = y * w + x;
        buf[idx * 3] = c[0]; buf[idx * 3 + 1] = c[1]; buf[idx * 3 + 2] = c[2];
        if (x >= coreX0 && x < coreX1 && y >= coreY0 && y < coreY1 && dist(c, dominant) > 40) rawMask[idx] = 1;
      }
    }
    const inkMask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let hit = rawMask[y * w + x];
        if (!hit && X0 + x >= cx0 && X0 + x < cx1 && Y0 + y >= cy0 && Y0 + y < cy1) {
          for (let dy = -2; dy <= 2 && !hit; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h && rawMask[ny * w + nx]) { hit = 1; break; }
            }
          }
        }
        if (hit) inkMask[y * w + x] = 1;
      }
    }
    const rad = Math.max(2, Math.min(6, Math.round(sizePx * 0.08)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!inkMask[idx]) continue;
        let r = 0, g = 0, b = 0, cnt = 0;
        const stepS = Math.max(1, Math.floor(rad / 2));
        for (let dy = -rad * 2; dy <= rad * 2; dy += stepS) {
          const ny = y + dy; if (ny < 0 || ny >= h) continue;
          for (let dx = -rad * 2; dx <= rad * 2; dx += stepS) {
            const nx = x + dx; if (nx < 0 || nx >= w || inkMask[ny * w + nx]) continue;
            const i3 = (ny * w + nx) * 3;
            r += buf[i3]; g += buf[i3 + 1]; b += buf[i3 + 2]; cnt++;
          }
        }
        const i3 = idx * 3;
        if (cnt > 0) { buf[i3] = r / cnt; buf[i3 + 1] = g / cnt; buf[i3 + 2] = b / cnt; }
        else { buf[i3] = dominant[0]; buf[i3 + 1] = dominant[1]; buf[i3 + 2] = dominant[2]; }
      }
    }
    const tmp = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xA = Math.max(0, x - rad), xB = Math.min(w - 1, x + rad), cnt = xB - xA + 1;
        let r = 0, g = 0, b = 0;
        for (let k = xA; k <= xB; k++) { const i3 = (y * w + k) * 3; r += buf[i3]; g += buf[i3 + 1]; b += buf[i3 + 2]; }
        const o3 = (y * w + x) * 3;
        tmp[o3] = r / cnt; tmp[o3 + 1] = g / cnt; tmp[o3 + 2] = b / cnt;
      }
    }
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const yA = Math.max(0, y - rad), yB = Math.min(h - 1, y + rad), cnt = yB - yA + 1;
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let k = yA; k <= yB; k++) { const i3 = (k * w + x) * 3; r += tmp[i3]; g += tmp[i3 + 1]; b += tmp[i3 + 2]; }
        const i4 = (y * w + x) * 4;
        const pxX = X0 + x, pxY = Y0 + y;
        const outD = Math.max(0, cx0 - pxX, pxX - (cx1 - 1), cy0 - pxY, pxY - (cy1 - 1));
        px[i4] = Math.round(r / cnt); px[i4 + 1] = Math.round(g / cnt); px[i4 + 2] = Math.round(b / cnt);
        px[i4 + 3] = outD > 0 ? Math.round((255 * Math.max(0, feather + 1 - outD)) / (feather + 1)) : 255;
      }
    }
    out.patch = { x: X0, y: Y0, w, h, data: px };
    out.rect = { x0: X0, y0: Y0, x1: X1, y1: Y1 };
  } else {
    // paint the text out with the fitted background (smooth gradient kept);
    // if an outer box border touched the padding margin (`innerFlat`), leave border pixels transparent
    const w = cx1 - cx0, h = cy1 - cy0, px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const pxX = cx0 + x, pxY = cy0 + y;
      const c = plane(pxX, pxY), i = (y * w + x) * 4;
      const inInnerInk = pxX >= bx0 - 1 && pxX < bx1 + 1 && pxY >= by0 - 1 && pxY < by1 + 1;
      if (innerFlat && !inInnerInk && dist(at(pxX, pxY), c) >= 38) {
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0;
      } else {
        px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
      }
    }
    out.patch = { x: cx0, y: cy0, w, h, data: px };
  }
  return out;
}

export const toHex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

// most frequent colour inside a box (the background between the letters; for
// thin text it wins over the ink)
export function boxBg(img, box) {
  const { data, width: W, height: H } = img;
  const x0 = clamp(Math.floor(box.x0), 0, W - 1), y0 = clamp(Math.floor(box.y0), 0, H - 1);
  const x1 = clamp(Math.ceil(box.x1), x0 + 1, W), y1 = clamp(Math.ceil(box.y1), y0 + 1, H);
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 20000)));
  const hist = new Map();
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const i = (y * W + x) * 4, k = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    const e = hist.get(k) || { n: 0, s: [0, 0, 0] }; e.n++; e.s[0] += data[i]; e.s[1] += data[i + 1]; e.s[2] += data[i + 2]; hist.set(k, e);
  }
  let best = null; for (const e of hist.values()) if (!best || e.n > best.n) best = e;
  return best ? best.s.map((v) => Math.round(v / best.n)) : [255, 255, 255];
}

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = ix * iy, ar = (q) => (q.x1 - q.x0) * (q.y1 - q.y0);
  return { iou: i / Math.max(1, ar(a) + ar(b) - i), inA: i / Math.max(1, ar(a)) };
};
// words of several OCR passes -> one list (an overlapping word is kept once,
// the more confident reading wins; fragments inside a whole word go)
export function mergeWords(lists, minConf = MIN_CONF) {
  const all = lists.flat().map((w) => ({ ...w, text: (w.text || '').trim(), conf: w.confidence ?? w.conf ?? 0, bbox: w.bbox }))
    .filter((w) => w.text && w.conf >= minConf && /[\p{L}\p{N}]/u.test(w.text));
  all.sort((a, b) => b.conf - a.conf || b.text.length - a.text.length);
  const out = [];
  for (const w of all) {
    if (out.some((o) => { const r = iou(w.bbox, o.bbox); return r.iou > 0.3 || r.inA > 0.6; })) continue;
    // a longer reading covering this one and its neighbours replaces them
    out.push(w);
  }
  return out;
}

export function filterIsolatedIconNoise(words) {
  return words.filter((w) => {
    if (!w.singleBlob) return true;
    const txt = (w.text || '').trim();
    if (txt.length !== 1 || /\d/.test(txt)) return true;
    const cy = (w.bbox.y0 + w.bbox.y1) * 0.5, h = w.bbox.y1 - w.bbox.y0;
    return words.some((o) => o !== w && !o.singleBlob
      && Math.abs(((o.bbox.y0 + o.bbox.y1) * 0.5) - cy) <= Math.max(h, o.bbox.y1 - o.bbox.y0) * 0.55
      && Math.min(Math.abs(o.bbox.x0 - w.bbox.x1), Math.abs(w.bbox.x0 - o.bbox.x1)) <= Math.max(h, o.bbox.y1 - o.bbox.y0) * 3.5);
  });
}

const readingSort = (a, b) => {
  const ba = a.bbox, bb = b.bbox;
  const hA = ba.y1 - ba.y0, hB = bb.y1 - bb.y0;
  const ovY = Math.min(ba.y1, bb.y1) - Math.max(ba.y0, bb.y0);
  if (ovY > 0.5 * Math.min(hA, hB) && Math.abs((ba.y0 + ba.y1) - (bb.y0 + bb.y1)) <= Math.max(hA, hB) * 0.6) {
    return ba.x0 - bb.x0;
  }
  return ba.y0 - bb.y0 || ba.x0 - bb.x0;
};

// words -> text items: words on one baseline, of one height, close together
// and on the same background form one item; anything else (another shape,
// another line, far away) becomes its own item
export function groupWords(words, bgOf = () => null) {
  const ws = words.map((w) => ({ ...w, h: w.bbox.y1 - w.bbox.y0, cy: (w.bbox.y0 + w.bbox.y1) / 2, bg: bgOf(w) }));
  ws.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const groups = [];
  const sameBg = (a, b) => !a || !b || Math.max(...a.map((v, j) => Math.abs(v - b[j]))) < 35;
  for (const w of ws) {
    let best = null;
    for (const g of groups) {
      const last = g.words[g.words.length - 1];
      const hh = Math.max(last.h, w.h), gap = w.bbox.x0 - last.bbox.x1;
      if (gap < -0.3 * hh || gap > 0.9 * hh) continue;
      if (Math.max(last.h, w.h) / Math.max(1, Math.min(last.h, w.h)) > 1.28) continue;
      if (Math.abs(last.cy - w.cy) > 0.35 * hh) continue;
      if (!sameBg(last.bg, w.bg)) continue;
      if (!best || gap < best.gap) best = { g, gap };
    }
    if (best) best.g.words.push(w); else groups.push({ words: [w] });
  }
  return groups.map((g) => {
    let text = '';
    g.words.forEach((w, i) => {
      if (i) { const p = g.words[i - 1], gap = w.bbox.x0 - p.bbox.x1; text += gap > 0.16 * Math.max(p.h, w.h) ? ' ' : ''; }
      text += w.text;
    });
    const bbox = g.words.reduce((a, w) => ({ x0: Math.min(a.x0, w.bbox.x0), y0: Math.min(a.y0, w.bbox.y0), x1: Math.max(a.x1, w.bbox.x1), y1: Math.max(a.y1, w.bbox.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    return { text, bbox, words: g.words };
  }).sort(readingSort);
}

// consecutive lines of one paragraph/block -> merged multi-line item when they share
// background colour, font size, ink colour, weight and alignment with no rule between them
export function groupLines(items, img = null) {
  if (!items || items.length <= 1) return (items || []).map((it) => ({ ...it, lines: [it] }));
  const sorted = items.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const maxD = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const hasBorderBetween = (a, b) => {
    if (!img) return false;
    const x0 = clamp(Math.floor(Math.max(a.bbox.x0, b.bbox.x0)), 0, img.width - 1);
    const x1 = clamp(Math.ceil(Math.min(a.bbox.x1, b.bbox.x1)), x0 + 1, img.width);
    const y0 = clamp(Math.ceil(a.bbox.y1) + 1, 0, img.height);
    const y1 = clamp(Math.floor(b.bbox.y0) - 1, 0, img.height);
    const span = x1 - x0;
    if (y1 <= y0 || span < 8) return false;
    const dom = a.look.dominant;
    for (let y = y0; y < y1; y++) {
      let hit = 0;
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * 4;
        const d = Math.max(Math.abs(img.data[i] - dom[0]), Math.abs(img.data[i + 1] - dom[1]), Math.abs(img.data[i + 2] - dom[2]));
        if (d > 40) hit++;
      }
      if (hit / span >= 0.72) return true;
    }
    return false;
  };
  const blocks = [];
  for (const cur of sorted) {
    let best = null;
    for (const blk of blocks) {
      const last = blk.lines[blk.lines.length - 1];
      const hA = last.sz.size, hB = cur.sz.size, hh = Math.max(hA, hB);
      if (hh / Math.max(1, Math.min(hA, hB)) > 1.25) continue;
      const gap = cur.bbox.y0 - last.bbox.y1;
      if (cur.bbox.y0 < last.bbox.y0 + 0.4 * Math.min(hA, hB) || gap > 1.05 * hh) continue;
      const ovX = Math.min(last.bbox.x1, cur.bbox.x1) - Math.max(last.bbox.x0, cur.bbox.x0);
      if (ovX <= 0) continue;
      const cA = (last.bbox.x0 + last.bbox.x1) * 0.5, cB = (cur.bbox.x0 + cur.bbox.x1) * 0.5;
      if (Math.abs(last.bbox.x0 - cur.bbox.x0) > hh * 2 && Math.abs(cA - cB) > hh * 2) continue;
      if (maxD(last.look.dominant, cur.look.dominant) >= 35) continue;
      if (maxD(last.look.ink, cur.look.ink) >= 55) continue;
      if (!!last.look.bold !== !!cur.look.bold || !!last.look.flat !== !!cur.look.flat) continue;
      if (hasBorderBetween(last, cur)) continue;
      if (!best || gap < best.gap) best = { blk, gap };
    }
    if (best) {
      best.blk.lines.push(cur);
      const b = best.blk.bbox;
      b.x0 = Math.min(b.x0, cur.bbox.x0); b.y0 = Math.min(b.y0, cur.bbox.y0);
      b.x1 = Math.max(b.x1, cur.bbox.x1); b.y1 = Math.max(b.y1, cur.bbox.y1);
    } else {
      blocks.push({ bbox: { ...cur.bbox }, lines: [cur] });
    }
  }
  return blocks.sort(readingSort);
}

// small high-contrast spots no OCR pass covered (single digits on badges,
// short labels): candidates for a second, one-spot-at-a-time reading
export function uncoveredSpots(img, covered, { minH = 8, maxN = 12 } = {}) {
  const { data, width: W, height: H } = img;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2];
  // local mean (box filter by integral image)
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let r = 0; for (let x = 0; x < W; x++) { r += lum[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + r; } }
  const rad = Math.max(6, Math.round(Math.min(W, H) / 8));
  const mean = (x, y) => { const x0 = Math.max(0, x - rad), y0 = Math.max(0, y - rad), x1 = Math.min(W, x + rad + 1), y1 = Math.min(H, y + rad + 1); return (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0)); };
  const on = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(lum[y * W + x] - mean(x, y)) > 45) on[y * W + x] = 1;
  const inCovered = (x, y) => covered.some((b) => x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2);
  const seen = new Uint8Array(W * H), comps = [];
  const stack = [];
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!on[s0] || seen[s0]) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
    stack.push(s0); seen[s0] = 1;
    while (stack.length) {
      const q = stack.pop(), x = q % W, y = (q / W) | 0; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const r = ny * W + nx; if (on[r] && !seen[r]) { seen[r] = 1; stack.push(r); }
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (h < minH || h > H * 0.9 || w > W * 0.9 || w > h * 12 || n < 20) continue;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (inCovered(cx, cy)) continue;
    comps.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, n });
  }
  // nested spots (a digit inside its badge): keep the outer one
  const outer = comps.filter((c) => !comps.some((o) => o !== c && o.x0 <= c.x0 && o.y0 <= c.y0 && o.x1 >= c.x1 && o.y1 >= c.y1));
  return outer.sort((a, b) => b.n - a.n).slice(0, maxN);
}

// letter-like blobs, light ones and dark ones separately (white letters on a
// coloured shape with a dark outline: the light set holds only the letters),
// grouped into words / short lines. Each cluster carries its own clean
// black-on-white picture (only its letters), the best input for the reader
// for outlined, light-on-dark or decorated text.
export function letterClusters(img, { minH = 8, maxN = 40 } = {}) {
  const { data, width: W, height: H } = img;
  const lum = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = (77 * data[i * 4] + 151 * data[i * 4 + 1] + 28 * data[i * 4 + 2]) >> 8;
  const comps = [];
  const lab = new Int32Array(W * H);
  const info = [null];
  let next = 1;
  for (const pol of ['light', 'dark']) {
    const on = pol === 'light' ? (v) => v >= 190 : (v) => v <= 80;
    const stack = [];
    for (let s0 = 0; s0 < W * H; s0++) {
      if (lab[s0] || !on(lum[s0])) continue;
      const id = next++;
      let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0, edge = false;
      lab[s0] = id; stack.push(s0);
      while (stack.length) {
        const q = stack.pop(), x = q % W, y = (q / W) | 0; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const r = ny * W + nx; if (!lab[r] && on(lum[r])) { lab[r] = id; stack.push(r); }
        }
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1, fill = n / (w * h);
      info[id] = { pol, x0, y0, x1: x1 + 1, y1: y1 + 1, h };
      if (edge || h < minH * 0.45 || h > H * 0.8 || w > h * 2.6 || n < 12 || fill < 0.08 || fill > 0.97) continue;
      comps.push({ id, pol, x0, y0, x1: x1 + 1, y1: y1 + 1, h, n });
    }
  }
  // letters -> words / short lines
  comps.sort((a, b) => a.x0 - b.x0);
  const groups = [];
  for (const c of comps) {
    let best = null;
    for (const g of groups) {
      if (g.pol !== c.pol) continue;
      const gh = g.y1 - g.y0, hh = Math.max(gh, c.h);
      const gap = c.x0 - g.x1;
      if (gap > 0.75 * hh || gap < -0.5 * hh) continue;
      const ov = Math.min(g.y1, c.y1) - Math.max(g.y0, c.y0);
      if (ov < 0.45 * Math.min(gh, c.h)) continue;
      if (hh / Math.max(1, Math.min(gh, c.h)) > 2.4) continue;
      if (!best || gap < best.gap) best = { g, gap };
    }
    if (best) { const g = best.g; g.cs.push(c); g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1); }
    else groups.push({ pol: c.pol, cs: [c], x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
  }
  const out = groups.filter((g) => g.y1 - g.y0 >= minH && g.cs.some((c) => c.h >= minH)).sort((a, b) => b.cs.length - a.cs.length || (b.x1 - b.x0) - (a.x1 - a.x0)).slice(0, maxN);
  for (const g of out) {
    const ids = new Set(g.cs.map((c) => c.id));
    const gh = g.y1 - g.y0, mark = new Map();
    const small = (l) => {
      if (mark.has(l)) return mark.get(l);
      const q = info[l];
      const v = !!q && q.pol === g.pol && q.h < gh * 0.6 && q.x0 >= g.x0 - 2 && q.x1 <= g.x1 + 2 && q.y0 >= g.y0 - gh * 0.35 && q.y1 <= g.y1 + gh * 0.35;
      mark.set(l, v); return v;
    };
    const pad = Math.round((g.y1 - g.y0) * 0.35);
    const X0 = Math.max(0, g.x0 - pad), Y0 = Math.max(0, g.y0 - pad), X1 = Math.min(W, g.x1 + pad), Y1 = Math.min(H, g.y1 + pad);
    const w = X1 - X0, h = Y1 - Y0, px = new Uint8ClampedArray(w * h * 4).fill(255);
    // the cluster's letters plus small marks in its box (i dots, accents)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = lab[(Y0 + y) * W + X0 + x];
      if (l && (ids.has(l) || small(l))) { const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
    }
    g.pic = { x: X0, y: Y0, w, h, data: px };
  }
  return out;
}

// most common colour of a ring of width r around a box
export function ringBg(img, X0, Y0, X1, Y1, r) {
  const { data, width: W, height: H } = img;
  const hist = new Map();
  const add = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4, k = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    const e = hist.get(k) || { n: 0, s: [0, 0, 0] }; e.n++; e.s[0] += data[i]; e.s[1] += data[i + 1]; e.s[2] += data[i + 2]; hist.set(k, e);
  };
  for (let y = Y0 - r; y < Y1 + r; y++) for (let x = X0 - r; x < X1 + r; x++) if (x < X0 || x >= X1 || y < Y0 || y >= Y1) add(x, y);
  let best = null; for (const e of hist.values()) if (!best || e.n > best.n) best = e;
  return best ? best.s.map((v) => Math.round(v / best.n)) : [255, 255, 255];
}
