// Pure pixel structure detector + OCR preprocessor for full-page OCR:
// finds dark banners, skew-tolerant table rules (hRules, vRules), and
// logos/stamps/emblems (logoZones), and prepares a clean black-on-white image
// for Tesseract without touching original color sampling data.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function estimateBgLum(lum, W, H) {
  const hist = new Uint32Array(32);
  const step = Math.max(1, Math.round(Math.sqrt((W * H) / 16000)));
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) hist[lum[y * W + x] >> 3]++;
  }
  let bestBin = 31, bestCnt = -1;
  for (let i = 18; i < 32; i++) {
    if (hist[i] > bestCnt) { bestCnt = hist[i]; bestBin = i; }
  }
  return bestBin * 8 + 4;
}

// Merge boxes aligned along their main axis when close on cross-axis AND overlapping/bridging on main-axis
function mergeRuleRuns(runs, horiz, crossTol, alongTol) {
  if (!runs.length) return [];
  const buckets = [];
  for (const r of runs) {
    const rC = horiz ? (r.y0 + r.y1) * 0.5 : (r.x0 + r.x1) * 0.5;
    let hit = null;
    for (const b of buckets) {
      const bC = horiz ? (b.y0 + b.y1) * 0.5 : (b.x0 + b.x1) * 0.5;
      if (Math.abs(rC - bC) > crossTol) continue;
      if (horiz) {
        if (r.x0 <= b.x1 + alongTol && r.x1 >= b.x0 - alongTol) { hit = b; break; }
      } else if (r.y0 <= b.y1 + alongTol && r.y1 >= b.y0 - alongTol) { hit = b; break; }
    }
    if (hit) {
      hit.x0 = Math.min(hit.x0, r.x0); hit.x1 = Math.max(hit.x1, r.x1);
      hit.y0 = Math.min(hit.y0, r.y0); hit.y1 = Math.max(hit.y1, r.y1);
    } else buckets.push({ ...r });
  }
  return buckets;
}

// Drop periodic interior hatching lines (which always have parallel siblings on both sides within ~11pt)
function dropHatchInterior(rules, horiz, px) {
  const maxStep = 11 * px;
  return rules.filter((r, idx) => {
    const rPos = horiz ? (r.y0 + r.y1) * 0.5 : (r.x0 + r.x1) * 0.5;
    const rLo = horiz ? r.x0 : r.y0, rHi = horiz ? r.x1 : r.y1;
    let hasBefore = false, hasAfter = false;
    for (let j = 0; j < rules.length; j++) {
      if (j === idx) continue;
      const o = rules[j];
      const oLo = horiz ? o.x0 : o.y0, oHi = horiz ? o.x1 : o.y1;
      const ov = Math.min(rHi, oHi) - Math.max(rLo, oLo);
      if (ov < 0.35 * Math.min(rHi - rLo, oHi - oLo)) continue;
      const oPos = horiz ? (o.y0 + o.y1) * 0.5 : (o.x0 + o.x1) * 0.5;
      const d = oPos - rPos;
      if (d < -1.5 * px && d >= -maxStep) hasBefore = true;
      else if (d > 1.5 * px && d <= maxStep) hasAfter = true;
      if (hasBefore && hasAfter) return false;
    }
    return true;
  });
}

export function detectPageStructure(img, px = 2) {
  const { data, width: W, height: H } = img;
  const lum = new Uint8Array(W * H);
  const sat = new Uint8Array(W * H);
  const minCh = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    lum[i] = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat[i] = mx - mn;
    minCh[i] = mn;
  }
  const bgLum = estimateBgLum(lum, W, H);
  const darkCut = bgLum - 45;

  // 1) Dark header banners (e.g. "ÖĞRENCİ VE UYGULAMA BİLGİLERİ", "EK: 2")
  const minBanW = Math.max(28, Math.round(45 * px));
  const rawBanners = [];
  for (let y = 0; y < H; y++) {
    let start = -1, gap = 0, darkCnt = 0;
    for (let x = 0; x < W; x++) {
      const isDark = lum[y * W + x] < 105;
      if (isDark) { if (start < 0) { start = x; darkCnt = 0; } gap = 0; darkCnt++; }
      else if (start >= 0 && ++gap > Math.max(12, Math.round(18 * px))) {
        const end = x - gap + 1;
        if (end - start >= minBanW && darkCnt / (end - start) >= 0.52) rawBanners.push({ x0: start, y0: y, x1: end, y1: y + 1 });
        start = -1;
      }
    }
    if (start >= 0 && W - start >= minBanW && darkCnt / (W - start) >= 0.52) rawBanners.push({ x0: start, y0: y, x1: W, y1: y + 1 });
  }
  // Merge vertically stacked banner strips sharing >70% x-overlap
  const bannersRaw = [];
  for (const r of rawBanners) {
    const prev = bannersRaw.find((b) => r.y0 <= b.y1 + Math.max(2, px) && Math.min(b.x1, r.x1) - Math.max(b.x0, r.x0) >= 0.7 * Math.min(b.x1 - b.x0, r.x1 - r.x0));
    if (prev) { prev.x0 = Math.min(prev.x0, r.x0); prev.x1 = Math.max(prev.x1, r.x1); prev.y1 = Math.max(prev.y1, r.y1); }
    else bannersRaw.push({ ...r });
  }
  const banners = bannersRaw.filter((b) => (b.y1 - b.y0) >= Math.round(10 * px) && (b.y1 - b.y0) <= Math.round(42 * px));
  const inBanner = (x, y) => banners.some((b) => x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2);

  // 2) Skew-tolerant local-contrast hRules and vRules (never inside banners)
  const dSide = Math.max(4, Math.round(3.2 * px));
  const halfW = Math.max(1, Math.round(0.6 * px));
  const minHLen = Math.min(Math.round(90 * px), Math.round(W * 0.45));
  const minVLen = Math.min(Math.round(28 * px), Math.round(H * 0.28));
  const gapLim = Math.max(2, Math.round(2.5 * px));

  const rawH = [];
  const lineCut = Math.min(bgLum - 32, 212);
  for (let y = dSide + 1; y < H - dSide - 1; y++) {
    let start = -1, gap = 0;
    for (let x = 2; x < W - 2; x++) {
      let cMin = 255;
      for (let dy = -halfW; dy <= halfW; dy++) { const v = lum[(y + dy) * W + x]; if (v < cMin) cMin = v; }
      const tAvg = (lum[(y - dSide) * W + x] + lum[(y - dSide - 1) * W + x]) >> 1;
      const bAvg = (lum[(y + dSide) * W + x] + lum[(y + dSide + 1) * W + x]) >> 1;
      const isLine = !inBanner(x, y) && Math.min(tAvg, bAvg) - cMin >= 12 && Math.max(tAvg, bAvg) > 190 && cMin < lineCut;
      if (isLine) { if (start < 0) start = x; gap = 0; }
      else if (start >= 0 && ++gap > gapLim) {
        const end = x - gap + 1;
        if (end - start >= minHLen) rawH.push({ x0: start, y0: y, x1: end, y1: y + 1 });
        start = -1;
      }
    }
    if (start >= 0 && W - 2 - start >= minHLen) rawH.push({ x0: start, y0: y, x1: W - 2, y1: y + 1 });
  }
  const hRules = dropHatchInterior(
    mergeRuleRuns(rawH, true, Math.max(3, Math.round(2.5 * px)), Math.round(5 * px))
      .filter((r) => (r.y1 - r.y0) <= Math.max(6, Math.round(8 * px))),
    true, px,
  );

  const rawV = [];
  for (let x = dSide + 1; x < W - dSide - 1; x++) {
    let start = -1, gap = 0;
    for (let y = 2; y < H - 2; y++) {
      let cMin = 255;
      for (let dx = -halfW; dx <= halfW; dx++) { const v = lum[y * W + x + dx]; if (v < cMin) cMin = v; }
      const lAvg = (lum[y * W + x - dSide] + lum[y * W + x - dSide - 1]) >> 1;
      const rAvg = (lum[y * W + x + dSide] + lum[y * W + x + dSide + 1]) >> 1;
      const isLine = !inBanner(x, y) && Math.min(lAvg, rAvg) - cMin >= 12 && Math.max(lAvg, rAvg) > 190 && cMin < lineCut;
      if (isLine) { if (start < 0) start = y; gap = 0; }
      else if (start >= 0 && ++gap > gapLim) {
        const end = y - gap + 1;
        if (end - start >= minVLen) rawV.push({ x0: x, y0: start, x1: x + 1, y1: end });
        start = -1;
      }
    }
    if (start >= 0 && H - 2 - start >= minVLen) rawV.push({ x0: x, y0: start, x1: x + 1, y1: H - 2 });
  }
  const vRules = dropHatchInterior(
    mergeRuleRuns(rawV, false, Math.max(3, Math.round(2.5 * px)), Math.round(5 * px))
      .filter((r) => (r.x1 - r.x0) <= Math.max(6, Math.round(8 * px))),
    false, px,
  );

  // 3) Chromatic + luminance logo/seal/stamp/emblem connected components
  const step = Math.max(1, W * H > 1200000 ? Math.round(px / 2) : 1);
  const gW = Math.ceil(W / step), gH = Math.ceil(H / step);
  const minLogo = 20 * px, maxLogo = 155 * px;
  const skipMask = new Uint8Array(gW * gH);
  const markSkip = (r) => {
    const x0 = clamp(Math.floor(r.x0 / step) - 1, 0, gW - 1), x1 = clamp(Math.ceil(r.x1 / step) + 1, 0, gW);
    const y0 = clamp(Math.floor(r.y0 / step) - 1, 0, gH - 1), y1 = clamp(Math.ceil(r.y1 / step) + 1, 0, gH);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) skipMask[y * gW + x] = 1;
  };
  hRules.filter((r) => (r.x1 - r.x0) > maxLogo).forEach(markSkip);
  vRules.filter((r) => (r.y1 - r.y0) > maxLogo).forEach(markSkip);
  banners.forEach(markSkip);

  const isInkOrColor = (idx) => lum[idx] < darkCut || (sat[idx] >= 24 && bgLum - minCh[idx] >= 32);
  const fg = new Uint8Array(gW * gH);
  for (let gy = 0; gy < gH; gy++) {
    const sy = Math.min(H - 1, gy * step);
    for (let gx = 0; gx < gW; gx++) {
      if (skipMask[gy * gW + gx]) continue;
      if (isInkOrColor(sy * W + Math.min(W - 1, gx * step))) fg[gy * gW + gx] = 1;
    }
  }
  const seen = new Uint8Array(gW * gH);
  const rawLogos = [];
  const stack = [];
  const reach = Math.max(1, Math.round((1.5 * px) / step));
  for (let i = 0; i < gW * gH; i++) {
    if (!fg[i] || seen[i]) continue;
    let x0 = gW, y0 = gH, x1 = 0, y1 = 0, cnt = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % gW, y = (p / gW) | 0;
      cnt++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gW || ny >= gH) continue;
          const idx = ny * gW + nx;
          if (fg[idx] && !seen[idx]) { seen[idx] = 1; stack.push(idx); }
        }
      }
    }
    const bx0 = x0 * step, by0 = y0 * step, bx1 = Math.min(W, (x1 + 1) * step), by1 = Math.min(H, (y1 + 1) * step);
    const bw = bx1 - bx0, bh = by1 - by0;
    if (bw < minLogo || bh < minLogo || bw > maxLogo || bh > maxLogo) continue;
    const ar = bw / Math.max(1, bh);
    if (ar < 0.45 || ar > 2.2) continue;
    if (cnt < (bw * bh) / (step * step) * 0.03) continue;
    let emptyRows = 0;
    for (let y = by0; y < by1; y++) {
      let hasInk = false;
      for (let x = bx0; x < bx1; x++) if (isInkOrColor(y * W + x)) { hasInk = true; break; }
      if (!hasInk) emptyRows++;
    }
    if (emptyRows / Math.max(1, bh) < 0.18) rawLogos.push({ x0: bx0, y0: by0, x1: bx1, y1: by1 });
  }
  // Merge adjacent/overlapping logo pieces (e.g. concentric blue stamp rings)
  const logoZones = [];
  const gapL = Math.round(10 * px);
  for (const r of rawLogos) {
    const hit = logoZones.find((z) => r.x0 <= z.x1 + gapL && r.x1 >= z.x0 - gapL && r.y0 <= z.y1 + gapL && r.y1 >= z.y0 - gapL);
    if (hit) { hit.x0 = Math.min(hit.x0, r.x0); hit.y0 = Math.min(hit.y0, r.y0); hit.x1 = Math.max(hit.x1, r.x1); hit.y1 = Math.max(hit.y1, r.y1); }
    else logoZones.push({ x0: Math.max(0, r.x0 - Math.round(2 * px)), y0: Math.max(0, r.y0 - Math.round(2 * px)), x1: Math.min(W, r.x1 + Math.round(2 * px)), y1: Math.min(H, r.y1 + Math.round(2 * px)) });
  }

  // Drop stray rules wholly inside detected logo emblems; on full pages also drop unanchored short vertical streaks
  const cleanRule = (r) => !logoZones.some((z) => r.x0 >= z.x0 - 4 && r.x1 <= z.x1 + 4 && r.y0 >= z.y0 - 4 && r.y1 <= z.y1 + 4);
  const fHRules = hRules.filter(cleanRule);
  const hBarriers = hBarriersInit(fHRules, banners);
  function hBarriersInit(hr, bn) {
    return [...hr, ...bn.flatMap((b) => [
      { x0: b.x0, y0: b.y0 - 1, x1: b.x1, y1: b.y0 + 1 },
      { x0: b.x0, y0: b.y1 - 1, x1: b.x1, y1: b.y1 + 1 },
    ])];
  }
  const touchesHBarrier = (cx, y) => hBarriers.some((h) => (h.x1 - h.x0) >= Math.round(90 * px) && cx >= h.x0 - 4 && cx <= h.x1 + 4 && Math.abs((h.y0 + h.y1) * 0.5 - y) <= Math.round(5 * px));
  const hasInkCrossingV = (r) => {
    if ((r.y1 - r.y0) >= 160 * px) return false;
    const stepY = Math.max(1, Math.round(px * 0.5));
    const reach = Math.max(2, Math.round(3.5 * px));
    const needConsec = Math.max(3, Math.round(1.6 * px));
    const needTotal = Math.max(5, Math.round(3.5 * px));
    const cx = (r.x0 + r.x1) * 0.5;
    const yStart = touchesHBarrier(cx, r.y0) ? Math.floor(r.y0) : Math.floor(r.y0 - 6 * px);
    const yEnd = touchesHBarrier(cx, r.y1) ? Math.ceil(r.y1) : Math.ceil(r.y1 + 6 * px);
    const onHRule = (y) => fHRules.some((h) => cx >= h.x0 - 4 && cx <= h.x1 + 4 && y >= h.y0 - 2.5 * px && y <= h.y1 + 2.5 * px);
    let consec = 0, total = 0;
    for (let y = Math.max(1, yStart); y < Math.min(H - 1, yEnd); y += stepY) {
      if (inBanner(cx, y) || onHRule(y)) { consec = 0; continue; }
      let lDark = false, rDark = false;
      for (let dx = 1; dx <= reach; dx++) {
        const lx = Math.floor(r.x0) - dx, rx = Math.ceil(r.x1) + dx - 1;
        if (lx >= 0 && lum[y * W + lx] < 168) lDark = true;
        if (rx < W && lum[y * W + rx] < 168) rDark = true;
      }
      if (lDark && rDark) {
        consec++; total++;
        if (consec >= needConsec || total >= needTotal) return true;
      } else {
        consec = 0;
      }
    }
    return false;
  };
  const fVRules = vRules.filter((r) => {
    if (!cleanRule(r)) return false;
    if (hasInkCrossingV(r)) return false;
    if (H > 350 * px && (r.y1 - r.y0) < 72 * px) {
      const cx = (r.x0 + r.x1) * 0.5;
      if (!touchesHBarrier(cx, r.y0) || !touchesHBarrier(cx, r.y1)) return false;
    }
    return true;
  });

  // Extended vertical splitters: ONLY extend into a banner if an actual light vertical divider runs through it
  const vSplits = fVRules.map((r) => {
    let y0 = r.y0, y1 = r.y1;
    for (const b of banners) {
      if (r.x0 < b.x0 - 4 || r.x1 > b.x1 + 4 || Math.abs(r.y0 - b.y1) > Math.round(8 * px)) continue;
      let lightRows = 0, totalRows = 0;
      const sx0 = clamp(Math.floor(r.x0 - 1), 0, W - 1), sx1 = clamp(Math.ceil(r.x1 + 1), sx0 + 1, W);
      for (let yy = Math.floor(b.y0 + 2); yy < Math.ceil(b.y1 - 2); yy++) {
        totalRows++;
        let maxLum = 0;
        for (let xx = sx0; xx < sx1; xx++) maxLum = Math.max(maxLum, lum[yy * W + xx]);
        if (maxLum > 110) lightRows++;
      }
      if (totalRows > 0 && lightRows / totalRows >= 0.68) y0 = Math.min(y0, b.y0);
    }
    return { x0: r.x0, y0, x1: r.x1, y1 };
  });

  const hasVRuleBetween = (xA, xB, y0, y1) => {
    const lo = Math.min(xA, xB) - 2, hi = Math.max(xA, xB) + 2;
    const hSpan = Math.max(4, y1 - y0);
    return vSplits.some((r) => {
      const cx = (r.x0 + r.x1) * 0.5;
      if (cx < lo || cx > hi) return false;
      return Math.min(y1, r.y1) - Math.max(y0, r.y0) >= 0.35 * hSpan;
    });
  };
  const hasHRuleBetween = (yA, yB, x0, x1) => {
    const lo = Math.min(yA, yB) - 3, hi = Math.max(yA, yB) + 3;
    const wSpan = Math.max(8 * px, x1 - x0);
    return hBarriers.some((r) => {
      const cy = (r.y0 + r.y1) * 0.5;
      if (cy < lo || cy > hi) return false;
      return Math.min(x1, r.x1) - Math.max(x0, r.x0) >= Math.min(wSpan, Math.max(8 * px, 0.25 * wSpan));
    });
  };
  const overlapsLogo = (b, thresh = 0.25) => {
    const area = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
    return logoZones.some((z) => Math.max(0, Math.min(b.x1, z.x1) - Math.max(b.x0, z.x0)) * Math.max(0, Math.min(b.y1, z.y1) - Math.max(b.y0, z.y0)) / area > thresh);
  };
  const ptScale = (list) => list.map((r) => ({ x0: r.x0 / px, y0: r.y0 / px, x1: r.x1 / px, y1: r.y1 / px }));

  return {
    px, bgLum, banners, hRules: fHRules, vRules: fVRules, vSplits, logoZones,
    hasVRuleBetween, hasHRuleBetween, overlapsLogo,
    ptBanners: ptScale(banners), ptRulesH: ptScale(fHRules), ptRulesV: ptScale(fVRules), ptLogos: ptScale(logoZones),
  };
}

// Produce an OCR-clean RGBA copy for Tesseract: invert dark banners, erase light-gray cell hatching, drop long border lines
export function preprocessForOcr(img, struct, { grayR = null, grayCut = 200 } = {}) {
  const { data, width: W, height: H } = img;
  const out = new Uint8ClampedArray(data);
  const px = (struct && struct.px) || 2;
  const lum = new Uint8Array(W * H);
  const sat = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    lum[i] = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const banners = (struct && struct.banners) || [];
  const inBan = new Uint8Array(W * H);
  const edgePad = Math.max(2, Math.round(0.8 * px));
  for (const b of banners) {
    // Invert full banner body so small boxes like "EK: 2" leave no dark border frame for Tesseract
    const bx0 = clamp(Math.floor(b.x0), 0, W), bx1 = clamp(Math.ceil(b.x1), 0, W);
    const by0 = clamp(Math.floor(b.y0), 0, H), by1 = clamp(Math.ceil(b.y1), 0, H);
    for (let y = by0; y < by1; y++) {
      for (let x = bx0; x < bx1; x++) {
        const i = y * W + x;
        inBan[i] = 1;
        const onOuterEdge = x < bx0 + edgePad || x >= bx1 - edgePad || y < by0 + edgePad || y >= by1 - edgePad;
        const v = onOuterEdge ? 255 : Math.min(255, Math.max(0, 255 - lum[i]));
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
        out[i * 4 + 3] = 255;
      }
    }
    // Clear 2px outer halo around banner edges to avoid spurious '|' border echoes
    const hx0 = clamp(bx0 - 2, 0, W), hx1 = clamp(bx1 + 2, 0, W);
    const hy0 = clamp(by0 - 2, 0, H), hy1 = clamp(by1 + 2, 0, H);
    for (let y = hy0; y < hy1; y++) for (let x = hx0; x < hx1; x++) {
      if (inBan[y * W + x]) continue;
      if (lum[y * W + x] < 165) {
        const i = (y * W + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = 255;
      }
    }
  }
  // Remove light-gray halftone/hatching shading (keeping fine gray small footer ink & edges intact)
  // A light pixel counts as hatching only when no real ink lies within about
  // 1 pt: the soft grey fringe of scanned / photographed letters sits right
  // next to their dark core and must stay, or Tesseract loses whole strokes.
  const R = grayR ?? Math.max(1, Math.round(px));
  // row-wise min over [x-R, x+R], then column-wise min -> min over the (2R+1)^2 window
  const rowMin = new Uint8Array(W * H), winMin = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) { let m = 255; for (let k = Math.max(0, x - R), e = Math.min(W - 1, x + R); k <= e; k++) if (lum[o + k] < m) m = lum[o + k]; rowMin[o + x] = m; }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { let m = 255; for (let k = Math.max(0, y - R), e = Math.min(H - 1, y + R); k <= e; k++) if (rowMin[k * W + x] < m) m = rowMin[k * W + x]; winMin[y * W + x] = m; }
  }
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (inBan[i] || lum[i] <= 182 || lum[i] >= 252 || sat[i] >= 35) continue;
      if (winMin[i] > grayCut) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255; }
    }
  }
  // Erase long structural table lines AND banner column splitters on OCR copy
  const wipeRule = (r) => {
    const x0 = clamp(Math.floor(r.x0 - 1), 0, W), x1 = clamp(Math.ceil(r.x1 + 1), 0, W);
    const y0 = clamp(Math.floor(r.y0 - 1), 0, H), y1 = clamp(Math.ceil(r.y1 + 1), 0, H);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = 255;
    }
  };
  ((struct && struct.hRules) || []).filter((r) => (r.x1 - r.x0) > 80 * px).forEach(wipeRule);
  ((struct && struct.vSplits) || (struct && struct.vRules) || []).filter((r) => (r.y1 - r.y0) > 65 * px).forEach(wipeRule);
  return { data: out, width: W, height: H };
}

// Prune photocopy streaks/lines that pierce strictly through the interior of recognized words
export function pruneRulesPiercingWords(struct, rawWords) {
  if (!struct || !rawWords || !rawWords.length) return struct;
  const px = struct.px || 2;
  const words = rawWords.filter((w) => w && w.bbox && (w.confidence ?? w.conf ?? 100) >= 68 && (w.text || '').trim().length >= 2);
  const keepV = (r) => {
    if ((r.y1 - r.y0) >= 110 * px) return true;
    const cx = (r.x0 + r.x1) * 0.5;
    const piercesWord = words.some((w) => {
      const b = w.bbox;
      if (cx <= b.x0 + 3 * px || cx >= b.x1 - 3 * px) return false;
      return Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0) >= 0.45 * (b.y1 - b.y0);
    });
    return !piercesWord;
  };
  const keepH = (r) => {
    if ((r.x1 - r.x0) >= 150 * px) return true;
    const cy = (r.y0 + r.y1) * 0.5;
    return !words.some((w) => {
      const b = w.bbox;
      return cy > b.y0 + 2 * px && cy < b.y1 - 2 * px && Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0) >= 0.35 * (b.x1 - b.x0);
    });
  };
  struct.vRules = struct.vRules.filter(keepV);
  struct.vSplits = struct.vSplits.filter(keepV);
  struct.ptRulesV = struct.vRules.map((r) => ({ x0: r.x0 / px, y0: r.y0 / px, x1: r.x1 / px, y1: r.y1 / px }));
  struct.hRules = struct.hRules.filter(keepH);
  struct.ptRulesH = struct.hRules.map((r) => ({ x0: r.x0 / px, y0: r.y0 / px, x1: r.x1 / px, y1: r.y1 / px }));
  return struct;
}

// Trim cleanup erase rectangle away from table lines and logos (never away from dark banners)
export function clampRectAwayFromStructure(rect, struct, padPt = 1.0) {
  if (!struct) return { ...rect };
  let x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
  const blockers = [...(struct.ptRulesH || []), ...(struct.ptRulesV || []), ...(struct.ptLogos || [])];
  for (const b of blockers) {
    const ix = Math.min(x1, b.x1 + padPt) - Math.max(x0, b.x0 - padPt);
    const iy = Math.min(y1, b.y1 + padPt) - Math.max(y0, b.y0 - padPt);
    if (ix <= 0 || iy <= 0) continue;
    const cxR = (x0 + x1) * 0.5, cxB = (b.x0 + b.x1) * 0.5;
    const cyR = (y0 + y1) * 0.5, cyB = (b.y0 + b.y1) * 0.5;
    if ((b.x1 - b.x0) <= 8 && iy >= 0.4 * (y1 - y0)) {
      if (cxB < cxR) x0 = Math.max(x0, b.x1 + padPt);
      else x1 = Math.min(x1, b.x0 - padPt);
    } else if ((b.y1 - b.y0) <= 8 && ix >= 0.4 * (x1 - x0)) {
      if (cyB < cyR) y0 = Math.max(y0, b.y1 + padPt);
      else y1 = Math.min(y1, b.y0 - padPt);
    }
  }
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? { ...rect, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// Sweep nearby stray same-band ink remnants (clipped partial letters, orphan fragments) inside cell/banner bounds
export function expandEraseForRemnants(boxPx, img, struct, inkRgb, bgRgb) {
  if (!boxPx || !img || !img.data) return boxPx;
  const { data, width: W, height: H } = img;
  const px = (struct && struct.px) || 2;
  const bgLum = bgRgb ? (0.3 * bgRgb[0] + 0.59 * bgRgb[1] + 0.11 * bgRgb[2]) : 255;
  const lightInk = bgLum < 120;
  let cellL = Math.max(0, Math.floor(boxPx.x0 - 14 * px));
  let cellR = Math.min(W - 1, Math.ceil(boxPx.x1 + 14 * px));
  const y0 = Math.max(0, Math.floor(boxPx.y0 - 2 * px));
  const y1 = Math.min(H - 1, Math.ceil(boxPx.y1 + 2 * px));
  const isBlocked = (x) => (struct && struct.logoZones || []).some((z) => x >= z.x0 - 2 && x <= z.x1 + 2 && y1 >= z.y0 && y0 <= z.y1);
  if (struct && struct.vRules) {
    for (const r of struct.vRules) {
      if (Math.min(y1, r.y1) - Math.max(y0, r.y0) < 0.4 * Math.max(1, y1 - y0)) continue;
      if (r.x1 <= boxPx.x0) cellL = Math.max(cellL, Math.ceil(r.x1 + 1));
      else if (r.x0 >= boxPx.x1) cellR = Math.min(cellR, Math.floor(r.x0 - 1));
    }
  }
  const hasInkAtCol = (x) => {
    if (isBlocked(x)) return false;
    for (let y = y0; y <= y1; y++) {
      const i = (y * W + x) * 4;
      const lum = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      if (lightInk ? (lum > 140) : (lum < 145 && Math.abs(lum - bgLum) >= 48)) return true;
    }
    return false;
  };
  let nx0 = boxPx.x0, nx1 = boxPx.x1;
  const maxGap = Math.round(7 * px);
  for (let x = Math.floor(boxPx.x0) - 1, gap = 0; x >= cellL; x--) {
    if (hasInkAtCol(x)) { nx0 = Math.min(nx0, x); gap = 0; }
    else if (++gap > maxGap) break;
  }
  for (let x = Math.ceil(boxPx.x1) + 1, gap = 0; x <= cellR; x++) {
    if (hasInkAtCol(x)) { nx1 = Math.max(nx1, x); gap = 0; }
    else if (++gap > maxGap) break;
  }
  return { ...boxPx, x0: nx0, x1: nx1 };
}

// a word whose centre lies in a detected logo / stamp zone and that was read
// with low confidence: emblem ring text, seal noise
export function inLogoUnsure(w, zones, minConf = 80) {
  const conf = w.confidence ?? w.conf ?? 0;
  if (!zones || !zones.length || conf >= minConf) return false;
  // numbers and short codes ("14", "85,5", "S1") in a falsely detected
  // "logo" (dense scanned table cells) are kept from 55 %
  if (conf >= 55 && /^[\p{L}]?\d{1,3}(?:[.,/]\d{1,2})?[\p{L}]?$/u.test((w.text || '').trim())) return false;
  const cx = (w.bbox.x0 + w.bbox.x1) / 2, cy = (w.bbox.y0 + w.bbox.y1) / 2;
  return zones.some((z) => cx >= z.x0 && cx <= z.x1 && cy >= z.y0 && cy <= z.y1);
}

// Share of a box's ink that is coloured (blue / red pen, stamps): ink =
// clearly darker than the paper; coloured = channels far apart. Handwritten
// dates, signatures and stamps on forms are nearly always in coloured ink.
export function colorInkShare(img, b) {
  const { data, width: W, height: H } = img;
  const x0 = Math.max(0, Math.floor(b.x0)), x1 = Math.min(W, Math.ceil(b.x1)), y0 = Math.max(0, Math.floor(b.y0)), y1 = Math.min(H, Math.ceil(b.y1));
  let ink = 0, col = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 4, r = data[i], g = data[i + 1], bl = data[i + 2];
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
      if (0.3 * r + 0.59 * g + 0.11 * bl > 185) continue;
      ink++;
      if (mx - mn >= 45) col++;
    }
  }
  return ink >= 8 ? col / ink : 0;
}

// Marks that are not printed text: coloured ink (pen, stamp) or a logo /
// emblem zone. A word there is kept only when it is certain (both engines
// read the same text confidently, or one engine is all but sure of a known
// word); otherwise the original image is left as it is - no text, no patch.
// a pen-written part inside a printed word ("03" written over "…/11/2026"):
// one square-ish slice of the word that is mostly coloured ink
function penPart(img, b) {
  const h = b.y1 - b.y0, wd = b.x1 - b.x0;
  if (h <= 0 || wd < 2 * h) return false;
  const step = Math.max(2, Math.round(h));
  for (let x = b.x0; x + step <= b.x1 + 1; x += Math.max(1, Math.round(step / 2))) {
    const sh = colorInkShare(img, { x0: x, y0: b.y0, x1: Math.min(b.x1, x + step), y1: b.y1 });
    if (sh >= 0.5) return true;
  }
  return false;
}

export function inMarkUnsure(w, img, struct, { fused = false, minConf = 95, known = () => true } = {}) {
  const conf = w.confidence ?? w.conf ?? 0;
  const inLogo = (struct && struct.logoZones || []).some((z) => {
    const cx = (w.bbox.x0 + w.bbox.x1) / 2, cy = (w.bbox.y0 + w.bbox.y1) / 2;
    return cx >= z.x0 && cx <= z.x1 && cy >= z.y0 && cy <= z.y1;
  });
  const inBanner = (struct && struct.banners || []).some((z) => w.bbox.x0 >= z.x0 - 2 && w.bbox.x1 <= z.x1 + 2 && w.bbox.y0 >= z.y0 - 2 && w.bbox.y1 <= z.y1 + 2);
  const tx = (w.text || '').trim(), core = tx.replace(/[^\p{L}\p{N}]/gu, '');
  // dark banners: halftone / edge noise read by one engine only ("Poa", "6")
  // share of the word inside a dark banner; a "word" straddling the banner
  // edge is the halftone edge + whatever is under it ("Poa"), never text
  const area = Math.max(1, (w.bbox.x1 - w.bbox.x0) * (w.bbox.y1 - w.bbox.y0));
  const bShare = Math.max(0, ...(struct && struct.banners || []).map((z) => Math.max(0, Math.min(w.bbox.x1, z.x1) - Math.max(w.bbox.x0, z.x0)) * Math.max(0, Math.min(w.bbox.y1, z.y1) - Math.max(w.bbox.y0, z.y0)) / area));
  if (fused && bShare >= 0.25 && bShare <= 0.85) return true;
  if (fused && (inBanner || bShare > 0.85) && !w.agree && (core.length <= 1 || !known(tx))) return true;
  if (!inBanner && img) {
    const share = colorInkShare(img, w.bbox);
    // handwriting inside a printed word ("03" over "…/11/2026"): the word
    // stays as the original picture, even when both engines read it
    if (share < 0.35 && penPart(img, w.bbox)) return true;
  }
  const coloured = !inBanner && img && colorInkShare(img, w.bbox) >= 0.35;
  if (!inLogo && !coloured) return false;
  // numbers / short codes in a "logo" zone that is really a dense scanned
  // table: kept from 55 % as before (pen-written ones are not: coloured)
  if (!coloured && conf >= 55 && /^\p{L}?\d{1,4}\p{L}?$/u.test(core) && /^[\p{L}\p{N}.,/:;()%+!\-]+$/u.test(tx)) return false;
  // plain black dictionary words next to an emblem (a zone that grew over
  // the heading text): kept; the emblem's own letters are short / unknown
  if (!coloured && conf >= 75 && core.length >= 4 && /\p{L}{4}/u.test(core) && known(tx)) return false;
  if (fused) return !(w.agree && conf >= 80 && known(w.text));
  return !(conf >= minConf && known(w.text));
}
