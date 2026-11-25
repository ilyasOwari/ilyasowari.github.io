// Shared glyph/run purging helpers used when erasing, covering, cropping, or splitting block parts.
export function purgeRunText(r, sBox) {
  const h = Math.max(4, r.m ? Math.hypot(r.m[2], r.m[3]) : (r.size || 12));
  const x0 = r.x, w = Math.max(1, r.w || 1), x1 = x0 + w;
  const y0 = r.y - 0.85 * h, y1 = r.y + 0.25 * h;
  const iy = Math.max(0, Math.min(y1, sBox.y1) - Math.max(y0, sBox.y0));
  const ix = Math.max(0, Math.min(x1, sBox.x1) - Math.max(x0, sBox.x0));
  if (iy < h * 0.35 || ix <= 0.5) return [r];
  if (sBox.x0 <= x0 + 1 && sBox.x1 >= x1 - 1) return [];
  const t = r.text || '';
  const n = t.length;
  if (!n || (ix / w) >= 0.85) return [];
  const i0 = Math.max(0, Math.floor(((sBox.x0 - x0) / w) * n));
  const i1 = Math.min(n, Math.ceil(((sBox.x1 - x0) / w) * n));
  const out = [];
  if (i0 > 0) out.push({ ...r, w: w * (i0 / n), text: t.slice(0, i0), codes: r.codes ? r.codes.slice(0, i0) : [] });
  if (i1 < n) out.push({ ...r, x: x0 + w * (i1 / n), w: w * ((n - i1) / n), text: t.slice(i1), codes: r.codes ? r.codes.slice(i1) : [] });
  return out;
}

export function purgePartText(an, p, sRect) {
  const sBox = { x0: sRect.x, y0: sRect.y, x1: sRect.x + sRect.w, y1: sRect.y + sRect.h };
  const hitBox = (b) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    if (cx >= sBox.x0 && cx <= sBox.x1 && cy >= sBox.y0 && cy <= sBox.y1) return true;
    const ix = Math.max(0, Math.min(b.x1, sBox.x1) - Math.max(b.x0, sBox.x0));
    const iy = Math.max(0, Math.min(b.y1, sBox.y1) - Math.max(b.y0, sBox.y0));
    return (ix * iy) / Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0)) >= 0.4;
  };
  const rmIds = [];
  if (an && p.src) {
    for (const g of an.seg.glyphs) {
      const cx = (g.b.x0 + g.b.x1) / 2, cy = (g.b.y0 + g.b.y1) / 2;
      if (cx >= p.src.x - 2 && cx <= p.src.x + p.src.w + 2 && cy >= p.src.y - 2 && cy <= p.src.y + p.src.h + 2 && hitBox(g.b)) rmIds.push(g.idx);
    }
  }
  if (rmIds.length) p.removedG = [...new Set([...(p.removedG || []), ...rmIds])];
  const rmSet = new Set(p.removedG || []);
  if (p.keepG && rmSet.size) p.keepG = p.keepG.filter((id) => !rmSet.has(id));
  if (p.edit) {
    if (rmIds.length) p.edit.removeGlyphs = [...new Set([...(p.edit.removeGlyphs || []), ...rmIds])];
    const origRuns = p.edit.runs || [];
    const newRuns = origRuns.flatMap((r) => purgeRunText(r, sBox));
    const runsChanged = newRuns.length !== origRuns.length || newRuns.some((r, k) => r.text !== origRuns[k]?.text);
    p.edit.runs = newRuns;
    const scrubCluster = (c) => {
      if (rmIds.length) c.removeGlyphs = [...new Set([...(c.removeGlyphs || []), ...rmIds])];
      const cr0 = c.runs || [];
      const cr1 = cr0.flatMap((r) => purgeRunText(r, sBox));
      const ch = cr1.length !== cr0.length || cr1.some((r, k) => r.text !== cr0[k]?.text);
      c.runs = cr1;
      if ((ch || rmIds.length) && c.paras) {
        const keptLines = an ? an.seg.textAtoms.filter((l) => l.glyphs.some((g) => !rmSet.has(g.idx) && !(c.removeGlyphs || []).includes(g.idx) && (g.b.x0 + g.b.x1) / 2 >= p.src.x && (g.b.x0 + g.b.x1) / 2 <= p.src.x + p.src.w && (g.b.y0 + g.b.y1) / 2 >= p.src.y && (g.b.y0 + g.b.y1) / 2 <= p.src.y + p.src.h)) : [];
        const rows = [];
        for (const l of keptLines) {
          const tx = l.glyphs.filter((g) => !rmSet.has(g.idx)).map((g) => g.uni).join('').trim();
          if (tx) rows.push({ y: l.baseline, x: l.left, text: tx });
        }
        for (const r of cr1) {
          const row = rows.find((q) => Math.abs(q.y - r.y) < 3);
          if (row && !row.fromRun) { /* skip duplicate */ }
          else if (row) row.text += r.text;
          else rows.push({ y: r.y, x: r.x, text: r.text, fromRun: true });
        }
        rows.sort((a, b) => a.y - b.y || a.x - b.x);
        const byLine = [];
        for (const rw of rows) {
          const prev = byLine[byLine.length - 1];
          if (prev && Math.abs(prev.y - rw.y) < 3 && rw.fromRun && prev.fromRun) prev.text += rw.text;
          else byLine.push({ ...rw });
        }
        c.paras = byLine.length ? byLine.map((rw) => ({ text: rw.text.trim(), marker: false })) : [{ text: '', marker: false }];
        c.charSrc = [];
        delete c.lineEndAt;
      }
    };
    if (Array.isArray(p.edit.clusters)) p.edit.clusters.forEach(scrubCluster);
    else if (runsChanged || rmIds.length) scrubCluster(p.edit);
  }
}

// Keep ONLY text inside keepRect (by purging outside bands around it inside bounds)
export function purgePartOutside(an, p, bounds, keepRect) {
  const bx0 = bounds.x, by0 = bounds.y, bx1 = bounds.x + bounds.w, by1 = bounds.y + bounds.h;
  const kx0 = keepRect.x, ky0 = keepRect.y, kx1 = keepRect.x + keepRect.w, ky1 = keepRect.y + keepRect.h;
  if (ky0 > by0 + 0.5) purgePartText(an, p, { x: bx0 - 4, y: by0 - 4, w: bounds.w + 8, h: ky0 - by0 + 4 });
  if (ky1 < by1 - 0.5) purgePartText(an, p, { x: bx0 - 4, y: ky1, w: bounds.w + 8, h: by1 - ky1 + 4 });
  if (kx0 > bx0 + 0.5) purgePartText(an, p, { x: bx0 - 4, y: ky0 - 0.5, w: kx0 - bx0 + 4, h: (ky1 - ky0) + 1 });
  if (kx1 < bx1 - 0.5) purgePartText(an, p, { x: kx1, y: ky0 - 0.5, w: bx1 - kx1 + 4, h: (ky1 - ky0) + 1 });
}
