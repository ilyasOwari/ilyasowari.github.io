// Photocopy / scan background cleanup ("Arka planı temizle"). Pure pixels.
//   1. the paper tone is estimated per tile (a bright percentile) and smoothed:
//      uneven grey, toner haze and shadows become one flat light tone;
//   2. every pixel is divided by its local paper tone (flat-field), so ink
//      keeps its contrast, colour and anti-aliased edges (tables stay crisp);
//   3. near-paper values snap to the paper tone, near-black ink to one dark;
//   4. lone specks (tiny dark dots with no ink nearby) are removed;
//   5. photo / picture areas (many mid-tones, continuous tone) are left as they are.
const lumAt = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];

export function cleanScanImage(img, px = 3, { paperTone = null, specks = true } = {}) {
  const { data, width: W, height: H } = img;
  const T = Math.max(16, Math.round(10 * px)); // ~10 pt tiles
  const gw = Math.ceil(W / T), gh = Math.ceil(H / T);
  const bg = new Float32Array(gw * gh), photo = new Uint8Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let ty = 0; ty < gh; ty++) for (let tx = 0; tx < gw; tx++) {
    hist.fill(0);
    let n = 0, mid = 0;
    for (let y = ty * T; y < Math.min(H, (ty + 1) * T); y += 2) for (let x = tx * T; x < Math.min(W, (tx + 1) * T); x += 2) {
      const v = lumAt(data, (y * W + x) * 4) | 0; hist[v]++; n++;
    }
    // paper = 90th percentile of the tile
    let acc = 0, p90 = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= 0.9 * n) { p90 = v; break; } }
    for (let v = Math.round(p90 * 0.35); v < Math.round(p90 * 0.82); v++) mid += hist[v];
    bg[ty * gw + tx] = p90;
    // a photo: lots of mid-tones (text tiles are mostly paper + dark strokes;
    // dark banners are dark throughout and get the uniform dark below)
    photo[ty * gw + tx] = mid > 0.5 * n ? 1 : 0;
  }
  // paper tiles only: a text-dense / photo tile's percentile is not paper
  const med = (arr) => { const a = Array.from(arr).sort((x, y) => x - y); return a[a.length >> 1] || 255; };
  const paperTiles = [];
  for (let i = 0; i < bg.length; i++) if (!photo[i]) paperTiles.push(bg[i]);
  const pMed = med(paperTiles.length ? paperTiles : bg);
  for (let i = 0; i < bg.length; i++) if (photo[i] || bg[i] < 0.75 * pMed) bg[i] = pMed;
  // smooth the paper map (3x3 mean, twice)
  for (let pass = 0; pass < 2; pass++) {
    const c = bg.slice();
    for (let ty = 0; ty < gh; ty++) for (let tx = 0; tx < gw; tx++) {
      let s = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = ty + dy, xx = tx + dx; if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue; s += c[yy * gw + xx]; k++;
      }
      bg[ty * gw + tx] = s / k;
    }
  }
  // grow photo areas by one tile (their edges)
  const ph = photo.slice();
  for (let ty = 0; ty < gh; ty++) for (let tx = 0; tx < gw; tx++) {
    if (!photo[ty * gw + tx]) continue;
    // a lone "photo" tile is a dense word / logo bit, not a picture
    let nb = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = ty + dy, xx = tx + dx; if ((dy || dx) && yy >= 0 && xx >= 0 && yy < gh && xx < gw && photo[yy * gw + xx]) nb++; }
    if (nb < 3) { ph[ty * gw + tx] = 0; continue; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = ty + dy, xx = tx + dx; if (yy >= 0 && xx >= 0 && yy < gh && xx < gw) ph[yy * gw + xx] = 2; }
  }
  const paper = paperTone != null ? paperTone : Math.max(240, Math.min(255, Math.round(pMed + 12)));
  const out = new Uint8ClampedArray(data.length);
  const bgAt = (x, y) => {
    const fx = Math.max(0, Math.min(gw - 1.001, x / T - 0.5)), fy = Math.max(0, Math.min(gh - 1.001, y / T - 0.5));
    const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    return (bg[y0 * gw + x0] * (1 - ax) + bg[y0 * gw + x1] * ax) * (1 - ay) + (bg[y1 * gw + x0] * (1 - ax) + bg[y1 * gw + x1] * ax) * ay;
  };
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (ph[((y / T) | 0) * gw + ((x / T) | 0)]) { out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2]; out[i + 3] = 255; continue; }
    const b = Math.max(40, bgAt(x, y));
    const r = data[i] / b, g = data[i + 1] / b, bl = data[i + 2] / b;
    const l = 0.3 * r + 0.59 * g + 0.11 * bl; // 1 = paper
    const chroma = Math.max(r, g, bl) - Math.min(r, g, bl);
    if (l >= 0.9 && chroma < 0.12) { out[i] = out[i + 1] = out[i + 2] = paper; out[i + 3] = 255; continue; }
    // contrast stretch: paper -> paper tone, <= 0.3 -> near black (strokes
    // keep their weight; anti-aliased edges keep their grey steps)
    const st = (v) => Math.max(0, Math.min(1, (v - 0.3) / (0.9 - 0.3)));
    if (chroma < 0.12 && l < 0.3) { out[i] = out[i + 1] = out[i + 2] = 28; ink[y * W + x] = 1; out[i + 3] = 255; continue; }
    out[i] = Math.round(28 + (paper - 28) * st(r)); out[i + 1] = Math.round(28 + (paper - 28) * st(g)); out[i + 2] = Math.round(28 + (paper - 28) * st(bl)); out[i + 3] = 255;
    if (l < 0.6) ink[y * W + x] = 1;
  }
  if (specks) removeSpecks(out, ink, W, H, px, paper, ph, gw, T);
  return { data: out, width: W, height: H, paper };
}

// tiny dark components (<= ~0.4 pt across) with no other ink within ~2.5 pt
// (i/ü/ş dots and colons always have their letter / partner that close)
function removeSpecks(out, ink, W, H, px, paper, ph, gw, T) {
  const maxD = Math.max(1, Math.round(0.4 * px)), R = Math.max(5, Math.round(2.5 * px));
  const seen = new Uint8Array(W * H), st = [], comp = [];
  for (let s = 0; s < W * H; s++) {
    if (!ink[s] || seen[s]) continue;
    comp.length = 0; st.push(s); seen[s] = 1;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, big = false;
    while (st.length) {
      const q = st.pop(); comp.push(q);
      const x = q % W, y = (q / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x1 - x0 > maxD || y1 - y0 > maxD) big = true;
      for (const n of [q - 1, q + 1, q - W, q + W]) {
        if (n < 0 || n >= W * H || seen[n] || !ink[n]) continue;
        if ((n === q - 1 && x === 0) || (n === q + 1 && x === W - 1)) continue;
        seen[n] = 1; st.push(n);
      }
    }
    if (big || ph[((y0 / T) | 0) * gw + ((x0 / T) | 0)]) continue;
    // any other ink around it? (the dot of an i, a comma next to a word)
    let near = false;
    for (let y = Math.max(0, y0 - R); y <= Math.min(H - 1, y1 + R) && !near; y++) {
      for (let x = Math.max(0, x0 - R); x <= Math.min(W - 1, x1 + R); x++) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
        if (ink[y * W + x]) { near = true; break; }
      }
    }
    if (near) continue;
    for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x1 + 1); x++) {
      const i = (y * W + x) * 4; out[i] = out[i + 1] = out[i + 2] = paper;
    }
  }
}
