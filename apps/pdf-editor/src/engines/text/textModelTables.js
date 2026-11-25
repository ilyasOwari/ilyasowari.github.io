// List, multi-column, option-table, grid-table, colour-run, and inline-mark helpers
// used by textModel.js (keeps textModel.js under 700 lines).
import { buildParagraphs } from '../segmentation/cluster.js';

const inRect = (r, x, y) => x >= r.x - 0.5 && x <= r.x + r.w + 0.5 && y >= r.y - 0.5 && y <= r.y + r.h + 0.5;
export const paraOf = (lines) => ({ kind: 'text', lines, size: lines[0].size, b: { x0: Math.min(...lines.map((l) => l.b.x0)), y0: Math.min(...lines.map((l) => l.b.y0)), x1: Math.max(...lines.map((l) => l.b.x1)), y1: Math.max(...lines.map((l) => l.b.y1)) } });

// a line is cut into pieces where the colour changes (highlighted or coloured
// words); for editing, pieces on the same baseline that follow each other like
// words belong to one line again (each glyph keeps its own colour)
export function joinColourRuns(lines) {
  let cur = lines;
  for (let k = 0; k < 6; k++) { const n = joinPass(cur); if (n.length === cur.length) return n; cur = n; }
  return cur;
}
function joinPass(lines) {
  const out = [];
  const sorted = lines.slice().sort((a, b) => a.b.x0 - b.b.x0);
  for (const l of sorted) {
    const prev = out.find((q) => {
      if (q.decor || l.decor) return false;
      if (Math.abs(q.baseline - l.baseline) >= 0.4 * Math.min(q.size, l.size)) return false;
      if (Math.abs(q.size - l.size) >= 0.35 * q.size) return false;
      const gap = l.b.x0 - q.b.x1;
      const maxGap = lineListMarker(q) && /^(?:\d{1,2}|[a-zA-Z])[.)]$|^[•●○◦▪▫‣▸►✓✔□■❖➤*\-–—\uE000-\uF8FF]$/.test((q.text || '').trim()) ? 2.8 * l.size : 1.2 * l.size;
      return gap > -0.3 * l.size && gap < maxGap;
    });
    if (!prev) { out.push(l); continue; }
    const glyphs = prev.glyphs.concat(l.glyphs);
    const ns = glyphs.filter((x) => !x.space);
    const boldN = ns.filter((x) => x.g.font && x.g.font.style && x.g.font.style.weight >= 600).length;
    const m = { ...prev, glyphs, text: prev.text + (prev.text.endsWith(' ') || l.text.startsWith(' ') ? '' : ' ') + l.text,
      left: Math.min(prev.left ?? prev.b.x0, l.left ?? l.b.x0), right: Math.max(prev.right ?? prev.b.x1, l.right ?? l.b.x1),
      b: { x0: Math.min(prev.b.x0, l.b.x0), y0: Math.min(prev.b.y0, l.b.y0), x1: Math.max(prev.b.x1, l.b.x1), y1: Math.max(prev.b.y1, l.b.y1) }, bold: boldN > ns.length / 2 };
    out[out.indexOf(prev)] = m;
  }
  return out;
}

// highlights / small boxes drawn behind a few words of ONE line: they follow
// those words when the text is re-laid (the old drawing is left out)
export function inlineMarks(analysis, part, lines, container, cell = null) {
  const out = [];
  const totalNonSpace = lines.reduce((s, l) => s + l.glyphs.filter((g) => !g.space).length, 0);
  analysis.atoms.gfx.forEach((a, gi) => {
    if (a.kind !== 'path' || !(a.fill || a.stroke)) return;
    const cx = (a.b.x0 + a.b.x1) / 2, cy = (a.b.y0 + a.b.y1) / 2;
    if (!inRect(part.src, cx, cy)) return;
    if (container && Math.abs(a.b.x0 - container.b.x0) < 4 && Math.abs(a.b.x1 - container.b.x1) < 4 && Math.abs(a.b.y0 - container.b.y0) < 4 && Math.abs(a.b.y1 - container.b.y1) < 4) return;
    const matched = [];
    for (const l of lines) {
      // behind the words, or a thin bar right under them (underline)
      const under = a.b.y1 - a.b.y0 < 0.3 * l.size && a.b.y0 > l.baseline - 0.25 * l.size && a.b.y0 < l.baseline + 0.5 * l.size;
      const gs = l.glyphs.filter((g) => !g.space && (g.b.x0 + g.b.x1) / 2 > a.b.x0 && (g.b.x0 + g.b.x1) / 2 < a.b.x1 && (under || ((g.b.y0 + g.b.y1) / 2 > a.b.y0 && (g.b.y0 + g.b.y1) / 2 < a.b.y1)));
      if (!gs.length) continue;
      matched.push({ line: l, gs });
    }
    if (!matched.length || matched.length > 3) return;
    const line = matched[0].line;
    if (matched.length === 1 && a.b.y1 - a.b.y0 > 2.4 * line.size) return;
    if (matched.length > 1 && a.b.y1 - a.b.y0 > (matched.length + 1.2) * line.size) return;
    const set = matched.flatMap((m) => m.gs);
    if (lines.length > 1 && set.length >= totalNonSpace * 0.9) return; // a whole-block frame/band
    const all = line.glyphs.filter((g) => !g.space);
    const isUnder = a.b.y1 - a.b.y0 < 0.3 * line.size;
    const x0 = Math.min(...set.map((g) => g.b.x0)), x1 = Math.max(...set.map((g) => g.b.x1));
    if (isUnder && (x0 - a.b.x0 > 5 || a.b.x1 - x1 > 6)) return;
    if (cell && cell.gridRow != null && (isUnder || (a.b.x1 - a.b.x0) > (x1 - x0) + 8)) return;
    const maxSpanW = Math.max(...lines.map((q) => q.right)) - Math.min(...lines.map((q) => q.left));
    if (matched.length === 1 && set.length === all.length && lines.length > 1 && !isUnder && (x0 - a.b.x0 > 8 || a.b.x1 - x1 > 8) && (a.b.x1 - a.b.x0) > 0.75 * maxSpanW) return; // a whole-line band
    const it = a.item;
    out.push({ gi, set: set.map((g) => g.idx), fill: a.fill ? it.fillRgb : null, stroke: a.stroke ? it.strokeRgb : null, lw: it.lw || 0.75,
      origBox: { x0: a.b.x0, y0: a.b.y0, x1: a.b.x1, y1: a.b.y1 },
      top: a.b.y0 - line.baseline, bot: Math.min(a.b.y1 - line.baseline, 0.7 * line.size), padL: Math.max(0, Math.min(2.8, x0 - a.b.x0)), padR: Math.max(0, Math.min(2.8, a.b.x1 - x1)) });
  });
  return out;
}

// Columned text ("1. a. dad    b. sister    c. grandmother" on every row):
// every row x column becomes its own cell, so each one is edited and re-flowed
// on its own and the rows stay lined up. Lines that are not part of the table
// stay normal paragraphs.
export function splitColumns(para) {
  const L = para.lines.slice().sort((a, b) => a.baseline - b.baseline);
  if (L.length < 2) return null;
  const hasListOption = L.some((l) => /(?:^|\s)(?:[a-fA-F]|\d{1,2})[.)]\s/.test(l.text || ''));
  if (!hasListOption && L.some((l) => (l.b.x1 - l.b.x0) > 260)) return null;
  const runsOf = (l) => {
    const gl = l.glyphs.filter((g) => !g.space && (g.uni || '').trim()).sort((a, b) => a.b.x0 - b.b.x0);
    const runs = []; let cur = null;
    for (const g of gl) {
      if (cur && g.b.x0 - cur.x1 > 1.4 * l.size) { runs.push(cur); cur = null; }
      if (!cur) cur = { x0: g.b.x0, x1: g.b.x1 }; else cur.x1 = Math.max(cur.x1, g.b.x1);
    }
    if (cur) runs.push(cur);
    return runs;
  };
  const R = L.map(runsOf);
  const multi = R.filter((r) => r.length >= 2);
  if (multi.length < 2) return null;
  const cols = [];
  for (const x of multi.flat().map((r) => r.x0).sort((a, b) => a - b)) { const c = cols.find((q) => Math.abs(q.x - x) < 4); if (c) c.n++; else cols.push({ x, n: 1 }); }
  const starts = cols.filter((c) => c.n >= Math.max(2, Math.ceil(multi.length * 0.6))).map((c) => c.x).sort((a, b) => a - b);
  if (starts.length < 2) return null;
  const atStart = (x) => starts.some((s) => Math.abs(s - x) < 4);
  const hasGapNear = (l, x) => l.glyphs.some((g, idx) => !g.space && Math.abs(g.b.x0 - x) < 6 && (idx === 0 || l.glyphs[idx - 1].space || g.b.x0 - l.glyphs[idx - 1].b.x1 > 0.18 * l.size));
  const isRow = R.map((r, li) => (r.length >= 2 && r.every((q) => atStart(q.x0))) || (starts.slice(1).every((s) => hasGapNear(L[li], s)) && Math.abs(L[li].b.x0 - starts[0]) < 8));
  if (isRow.filter(Boolean).length < 2) return null;
  const cells = [], rest = [];
  let pend = [];
  const flush = () => { if (pend.length) rest.push(paraOf(pend)); pend = []; };
  L.forEach((l, i) => {
    if (!isRow[i]) { pend.push(l); return; }
    flush();
    starts.forEach((x0, ci) => {
      const x1 = ci + 1 < starts.length ? starts[ci + 1] : Infinity;
      const gl = l.glyphs.filter((g) => { const cx = (g.b.x0 + g.b.x1) / 2; return cx >= x0 - 2 && cx < x1 - 2; });
      const ink = gl.filter((g) => !g.space && (g.uni || '').trim());
      if (!ink.length) return;
      const sub = { ...l, glyphs: gl, b: { x0: Math.min(...ink.map((g) => g.b.x0)), y0: l.b.y0, x1: Math.max(...ink.map((g) => g.b.x1)), y1: l.b.y1 } };
      cells.push({ para: paraOf([sub]), container: null, cell: { row: Math.round(l.baseline * 2), col: ci, n: starts.length }, cellRight: x1 === Infinity ? null : x1 - 4 });
    });
  });
  flush();
  return { cells, rest };
}

// Pattern detection helpers: list items ("a. ... b. ... c.") and multi-column options ("1. a. ... b. ... c. ...")
export function lineListMarker(l) {
  const s = (l.glyphs || []).map((g) => g.uni || '').join('');
  let m = /^\s*([a-zA-Z])\s*[.)](?:\s+\S|\s*$)/.exec(s);
  if (m) {
    const ch = m[1].toLowerCase();
    return { type: m[1] === ch ? 'alphaL' : 'alphaU', val: ch.charCodeAt(0) - 97 };
  }
  m = /^\s*(\d{1,2})\s*[.)](?:\s+\S|\s*$)/.exec(s);
  if (m) return { type: 'num', val: parseInt(m[1], 10) };
  m = /^\s*([•●○◦▪▫‣▸►✓✔□■❖➤\uE000-\uF8FF])(?:\s*\S|\s*$)/.exec(s);
  if (m) return { type: 'bullet', ch: m[1], val: 0 };
  m = /^\s*([*\-–—])(?:\s+\S|\s*$)/.exec(s);
  if (m) return { type: 'bullet', ch: m[1], val: 0 };
  m = /^\s*[A-ZÇĞİÖŞÜ][a-zçğıöşüA-ZÇĞİÖŞÜ]{1,15}\s*:\s+\S/.exec(s);
  if (m) return { type: 'speaker', val: 0 };
  return null;
}

export function findConfirmedListLines(lines) {
  const out = new Set();
  const cands = [];
  for (const l of lines) {
    const mk = lineListMarker(l);
    if (!mk || mk.type === 'speaker') continue;
    const left = l.b ? l.b.x0 : 0;
    cands.push({ l, mk, left, y: l.baseline || 0 });
  }
  const byType = new Map();
  for (const c of cands) {
    if (!byType.has(c.mk.type)) byType.set(c.mk.type, []);
    byType.get(c.mk.type).push(c);
  }
  for (const arr of byType.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.y - b.y);
    // group by aligned left coordinate
    const cols = [];
    for (const item of arr) {
      let grp = cols.find((g) => Math.abs(g.x - item.left) < Math.max(18, 2.5 * (item.l.size || 10)));
      if (!grp) { grp = { x: item.left, items: [] }; cols.push(grp); }
      grp.items.push(item);
    }
    for (const g of cols) {
      if (g.items.length < 2) continue;
      if (g.items[0].mk.type === 'bullet') {
        for (const it of g.items) out.add(it.l);
        continue;
      }
      let seqOk = true;
      for (let i = 1; i < g.items.length; i++) {
        if (g.items[i].mk.val <= g.items[i - 1].mk.val) { seqOk = false; break; }
      }
      if (!seqOk && g.items[0].mk.val !== 0 && g.items[0].mk.val !== 1) continue;
      if (seqOk || g.items.length >= 3) for (const it of g.items) out.add(it.l);
    }
  }
  return out;
}

export function buildParagraphsWithLists(lines, gfx, bounds, confirmedListSet) {
  const paras = buildParagraphs(lines, gfx, bounds);
  if (!confirmedListSet.size) return paras;
  const out = [];
  for (const p of paras) {
    if (p.lines.length <= 1 || !p.lines.some((l) => confirmedListSet.has(l))) { out.push(p); continue; }
    let cur = [];
    for (const l of p.lines) {
      if (confirmedListSet.has(l) && cur.length) { out.push(paraOf(cur)); cur = [l]; }
      else cur.push(l);
    }
    if (cur.length) out.push(paraOf(cur));
  }
  return out;
}

function rowOptionMarkers(glyphs, size) {
  const markers = [];
  const n = glyphs.length;
  for (let i = 0; i < n; i++) {
    const g = glyphs[i];
    if (g.space || !(g.uni || '').trim()) continue;
    const prev = i > 0 ? glyphs[i - 1] : null;
    const atBoundary = i === 0 || prev.space || (g.b.x0 - prev.b.x1) > 0.16 * size;
    if (!atBoundary) continue;
    let tail = '';
    for (let k = i; k < Math.min(n, i + 12); k++) tail += glyphs[k].uni || '';
    const mNumOpt = /^(\d{1,2})\s*[.)]\s*([a-fA-F])\s*[.)](?=\s|$)/.exec(tail);
    if (mNumOpt) {
      markers.push({ x0: g.b.x0, gi: i, ch: mNumOpt[2].toLowerCase() });
      let acc = 0;
      while (i + 1 < n && acc < mNumOpt[0].length) { acc += (glyphs[i].uni || '').length; if (acc < mNumOpt[0].length) i++; }
      continue;
    }
    const mOpt = /^([a-fA-F])\s*[.)](?=\s|$)/.exec(tail);
    if (mOpt) { markers.push({ x0: g.b.x0, gi: i, ch: mOpt[1].toLowerCase() }); }
  }
  return markers;
}

export function extractOptionTable(lines) {
  // group main lines into visual horizontal rows by baseline
  const sorted = lines.slice().sort((a, b) => a.baseline - b.baseline || a.b.x0 - b.b.x0);
  const rows = [];
  for (const l of sorted) {
    let row = rows.find((r) => Math.abs(r.baseline - l.baseline) < 0.45 * Math.min(r.size, l.size));
    if (!row) { row = { baseline: l.baseline, size: l.size, bgBox: l._bgBox, lines: [], glyphs: [] }; rows.push(row); }
    row.lines.push(l);
  }
  const rowMarkers = rows.map((row) => {
    const gs = row.lines.flatMap((l) => l.glyphs).slice().sort((a, b) => a.b.x0 - b.b.x0 || a.idx - b.idx);
    row.glyphs = gs;
    return rowOptionMarkers(gs, row.size);
  });
  const multiIdx = rowMarkers.map((ms, ri) => (ms.length >= 2 ? ri : -1)).filter((ri) => ri >= 0);
  if (multiIdx.length < 2) return { cells: [], rest: lines };
  // cluster marker x0 positions across rows
  const cols = [];
  for (const ri of multiIdx) {
    for (const m of rowMarkers[ri]) {
      let c = cols.find((q) => Math.abs(q.x - m.x0) < 10);
      if (c) { c.sum += m.x0; c.n++; c.x = c.sum / c.n; }
      else cols.push({ x: m.x0, sum: m.x0, n: 1 });
    }
  }
  const starts = cols.filter((c) => c.n >= 2).map((c) => c.x).sort((a, b) => a - b);
  if (starts.length < 2) return { cells: [], rest: lines };
  const tableRows = new Set();
  rowMarkers.forEach((ms, ri) => {
    const matched = ms.filter((m) => starts.some((sx) => Math.abs(m.x0 - sx) < 10));
    if (matched.length >= 2) tableRows.add(ri);
  });
  if (tableRows.size < 2) return { cells: [], rest: lines };
  const cells = [], rest = [];
  rows.forEach((row, ri) => {
    if (!tableRows.has(ri)) { rest.push(...row.lines); return; }
    const ms = rowMarkers[ri];
    const colSplits = starts.map((sx) => {
      const m = ms.find((mm) => Math.abs(mm.x0 - sx) < 10);
      return m ? m.x0 : sx;
    });
    const baseLine = row.lines[0];
    colSplits.forEach((x0, ci) => {
      const x1 = ci + 1 < colSplits.length ? colSplits[ci + 1] : Infinity;
      const gl = row.glyphs.filter((g) => {
        const cx = (g.b.x0 + g.b.x1) / 2;
        return cx >= x0 - 2 && cx < x1 - 2;
      });
      const ink = gl.filter((g) => !g.space && (g.uni || '').trim());
      if (!ink.length) return;
      const sub = {
        ...baseLine, glyphs: gl,
        b: { x0: Math.min(...ink.map((g) => g.b.x0)), y0: Math.min(...ink.map((g) => g.b.y0)), x1: Math.max(...ink.map((g) => g.b.x1)), y1: Math.max(...ink.map((g) => g.b.y1)) },
        left: ink[0].b.x0, right: ink[ink.length - 1].b.x1, text: gl.map((g) => g.uni || '').join(''),
      };
      cells.push({ para: paraOf([sub]), container: null, cell: { row: Math.round(row.baseline * 2), col: ci, n: colSplits.length }, cellRight: x1 === Infinity ? null : x1 - 4 });
    });
  });
  return { cells, rest };
}

export function extractGridTable(analysis, part, lines) {
  const empty = { cells: [], usedLines: [] };
  if (!lines.length || !analysis.atoms || !analysis.atoms.gfx) return empty;
  const sx0 = part.src.x - 4, sy0 = part.src.y - 4, sx1 = part.src.x + part.src.w + 4, sy1 = part.src.y + part.src.h + 4;
  const hSegs = [], vSegs = [];
  for (const a of analysis.atoms.gfx) {
    if (a.kind !== 'path' || !(a.fill || a.stroke)) continue;
    if (a.b.x1 < sx0 || a.b.x0 > sx1 || a.b.y1 < sy0 || a.b.y0 > sy1) continue;
    const w = a.b.x1 - a.b.x0, h = a.b.y1 - a.b.y0;
    if (h <= 2.5 && w >= 24) {
      hSegs.push({ y: (a.b.y0 + a.b.y1) / 2, x0: a.b.x0, x1: a.b.x1 });
    } else if (w <= 2.5 && h >= 16) {
      vSegs.push({ x: (a.b.x0 + a.b.x1) / 2, y0: a.b.y0, y1: a.b.y1 });
    }
  }
  if (hSegs.length < 3 || vSegs.length < 3) return empty;
  const clusterAxis = (segs, key, s0Key, s1Key, tol = 3) => {
    const sorted = segs.slice().sort((a, b) => a[key] - b[key]);
    const groups = [];
    for (const s of sorted) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(s[key] - g.val) <= tol) {
        g.vals.push(s[key]);
        g.val = g.vals.reduce((u, v) => u + v, 0) / g.vals.length;
        g.segs.push(s);
      } else {
        groups.push({ val: s[key], vals: [s[key]], segs: [s] });
      }
    }
    return groups;
  };
  const hGroups = clusterAxis(hSegs, 'y', 'x0', 'x1');
  const vGroups = clusterAxis(vSegs, 'x', 'y0', 'y1');
  if (hGroups.length < 3 || vGroups.length < 3) return empty;
  const spanOf = (segs, k0, k1) => {
    const ivs = segs.map((s) => [s[k0], s[k1]]).sort((a, b) => a[0] - b[0]);
    let total = 0, cur0 = ivs[0][0], cur1 = ivs[0][1];
    for (let i = 1; i < ivs.length; i++) {
      if (ivs[i][0] <= cur1 + 2) cur1 = Math.max(cur1, ivs[i][1]);
      else { total += cur1 - cur0; cur0 = ivs[i][0]; cur1 = ivs[i][1]; }
    }
    return total + (cur1 - cur0);
  };
  const minX = Math.min(...vGroups.map((g) => g.val)), maxX = Math.max(...vGroups.map((g) => g.val));
  const minY = Math.min(...hGroups.map((g) => g.val)), maxY = Math.max(...hGroups.map((g) => g.val));
  const tblW = maxX - minX, tblH = maxY - minY;
  if (tblW < 40 || tblH < 24) return empty;
  const ys = hGroups.filter((g) => spanOf(g.segs, 'x0', 'x1') >= tblW * 0.4).map((g) => g.val);
  const xs = vGroups.filter((g) => spanOf(g.segs, 'y0', 'y1') >= tblH * 0.25).map((g) => g.val);
  if (xs.length < 3 || ys.length < 3) return empty;
  // Aralarında boşluk olan bağımsız kart/tabela kutularını (kesintisiz yatay çizgisi olmayan montaj sayfalarını) tablo yapma:
  // A ruled line may be drawn as one stroke or as one piece per cell (browser /
  // Word tables with collapsed borders): pieces that touch count as one line.
  const longestRun = (segs) => {
    const ivs = segs.map((s) => [s.x0, s.x1]).sort((a, b) => a[0] - b[0]);
    let best = 0, c0 = ivs[0][0], c1 = ivs[0][1];
    for (let i = 1; i < ivs.length; i++) {
      if (ivs[i][0] <= c1 + 2) c1 = Math.max(c1, ivs[i][1]);
      else { best = Math.max(best, c1 - c0); c0 = ivs[i][0]; c1 = ivs[i][1]; }
    }
    return Math.max(best, c1 - c0);
  };
  if (hGroups.filter((g) => longestRun(g.segs) >= tblW * 0.72).length < 2) return empty;
  const gx0 = xs[0] - 2, gx1 = xs[xs.length - 1] + 2, gy0 = ys[0] - 2, gy1 = ys[ys.length - 1] + 2;
  const usedLines = [];
  const cellMap = new Map();
  const findIdx = (arr, v) => {
    for (let i = 0; i < arr.length - 1; i++) if (v >= arr[i] - 2 && v <= arr[i + 1] + 2) return i;
    return -1;
  };
  const pushToCell = (r, c, sub) => {
    if (r < 0 || c < 0) return;
    const key = `${r}:${c}`;
    if (!cellMap.has(key)) cellMap.set(key, { r, c, lines: [] });
    cellMap.get(key).lines.push(sub);
  };
  for (const l of lines) {
    const cx = (l.b.x0 + l.b.x1) / 2, cy = (l.b.y0 + l.b.y1) / 2;
    if (cy < gy0 || cy > gy1 || l.b.x1 < gx0 || l.b.x0 > gx1) continue;
    const r = findIdx(ys, cy);
    if (r < 0) continue;
    usedLines.push(l);
    const cross = xs.slice(1, -1).some((vx) => l.b.x0 < vx - 2 && l.b.x1 > vx + 2);
    if (!cross) {
      pushToCell(r, findIdx(xs, cx), l);
    } else {
      for (let c = 0; c < xs.length - 1; c++) {
        const gl = l.glyphs.filter((g) => {
          const gcx = (g.b.x0 + g.b.x1) / 2;
          return gcx >= xs[c] - 1 && gcx <= xs[c + 1] + 1;
        });
        const ink = gl.filter((g) => !g.space && (g.uni || '').trim());
        if (!ink.length) continue;
        pushToCell(r, c, {
          ...l, glyphs: gl,
          b: { x0: Math.min(...ink.map((g) => g.b.x0)), y0: Math.min(...ink.map((g) => g.b.y0)), x1: Math.max(...ink.map((g) => g.b.x1)), y1: Math.max(...ink.map((g) => g.b.y1)) },
          left: ink[0].b.x0, right: ink[ink.length - 1].b.x1, text: gl.map((g) => g.uni || '').join(''),
        });
      }
    }
  }
  if (cellMap.size < 2) return empty;
  const cells = [...cellMap.values()]
    .sort((a, b) => a.r - b.r || a.c - b.c)
    .map(({ r, c, lines: cls }) => {
      const sorted = cls.slice().sort((p, q) => p.baseline - q.baseline || p.b.x0 - q.b.x0);
      const merged = joinColourRuns(sorted);
      return {
        para: paraOf(merged),
        container: null,
        cell: { row: r, gridRow: r, col: c, n: xs.length - 1, colW: xs[c + 1] - xs[c] },
        cellRight: xs[c + 1] - 3,
      };
    });
  return { cells, usedLines };
}
