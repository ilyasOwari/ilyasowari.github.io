// Builds the editable text model of one paragraph cluster inside a block part:
// plain text with paragraph starts, per-character source glyph (for style),
// and the geometry of the original text area.
import { findLineBgBox } from '../segmentation/cluster.js';
import { boxArea, intersectBox } from '../../core/geometry.js';
import { isBlankText } from './blank.js';
import {
  joinColourRuns, inlineMarks, paraOf, splitColumns, lineListMarker,
  findConfirmedListLines, buildParagraphsWithLists, extractOptionTable, extractGridTable,
} from './textModelTables.js';

export { splitColumns, lineListMarker };

const inRect = (r, x, y) => x >= r.x - 0.5 && x <= r.x + r.w + 0.5 && y >= r.y - 0.5 && y <= r.y + r.h + 0.5;

export function styleKey(g) {
  const f = g.fill || {};
  return `${g.font ? g.font.id : '?'}|${g.size.toFixed(2)}|${g.hsize.toFixed(2)}|${f.op}:${JSON.stringify(f.args || [])}|${f.cs || ''}`;
}

export function findClusters(analysis, part) {
  const rmSet = new Set(part.removedG || []);
  const keepSet = part.keepG && part.keepG.length ? new Set(part.keepG) : null;
  const erases = part.erase || [];
  const gone = (g) => {
    if (rmSet.has(g.idx)) return true;
    if (keepSet && !keepSet.has(g.idx)) return true;
    const gx = (g.b.x0 + g.b.x1) / 2, gy = (g.b.y0 + g.b.y1) / 2;
    if (!keepSet && !inRect(part.src, gx, gy)) return true;
    return erases.some((e) => gx >= e.x && gx <= e.x + e.w && gy >= e.y && gy <= e.y + e.h);
  };
  const lines = [];
  for (const l of analysis.seg.textAtoms) {
    if (l.decor) continue;
    if (analysis.wmGlyphSet && l.glyphs.every((g) => analysis.wmGlyphSet.has(g.idx))) continue;
    const cx = (l.b.x0 + l.b.x1) / 2, cy = (l.b.y0 + l.b.y1) / 2;
    const boxOver = l.b.x1 >= part.src.x - 0.5 && l.b.x0 <= part.src.x + part.src.w + 0.5 && l.b.y1 >= part.src.y - 0.5 && l.b.y0 <= part.src.y + part.src.h + 0.5;
    if (!boxOver && !(keepSet && l.glyphs.some((g) => keepSet.has(g.idx)))) continue;
    if (!rmSet.size && !erases.length && !keepSet && inRect(part.src, cx, cy)) { lines.push(l); continue; }
    const surv = l.glyphs.filter((g) => !gone(g));
    const ink = surv.filter((g) => !g.space && (g.uni || '').trim());
    if (!ink.length) continue;
    if (surv.length === l.glyphs.length && inRect(part.src, cx, cy)) { lines.push(l); continue; }
    const b = { x0: Math.min(...ink.map((g) => g.b.x0)), y0: Math.min(...ink.map((g) => g.b.y0)), x1: Math.max(...ink.map((g) => g.b.x1)), y1: Math.max(...ink.map((g) => g.b.y1)) };
    lines.push({ ...l, glyphs: surv, b, left: ink[0].b.x0, right: ink[ink.length - 1].b.x1, text: surv.map((g) => g.uni).join('') });
  }
  const rawLines = [];
  for (const l of analysis.seg.textAtoms) {
    const cx = (l.b.x0 + l.b.x1) / 2, cy = (l.b.y0 + l.b.y1) / 2;
    const boxOver = inRect(part.src, cx, cy) || (l.b.x1 > part.src.x && l.b.x0 < part.src.x + part.src.w && l.b.y1 > part.src.y && l.b.y0 < part.src.y + part.src.h);
    if (boxOver || (keepSet && l.glyphs.some((g) => keepSet.has(g.idx)))) rawLines.push(l);
  }
  if (!lines.length) {
    if (part.cell && part.cell.gridRow != null && rawLines.length) {
      const merged = joinColourRuns(rawLines.slice().sort((p, q) => p.baseline - q.baseline || p.b.x0 - q.b.x0));
      return [{ para: paraOf(merged), container: null, cell: part.cell, cellRight: part.cellRight || null }];
    }
    return [];
  }
  // fill items inside the part (badges / container)
  const fills = analysis.atoms.gfx.filter((a) => a.fill && a.kind === 'path' && inRect(part.src, (a.b.x0 + a.b.x1) / 2, (a.b.y0 + a.b.y1) / 2));
  const isBadge = (l) => {
    const n = l.glyphs.filter((x) => !x.space).length;
    if (n > 3) return false;
    const txt = l.glyphs.map((x) => x.uni || '').join('').trim();
    if (txt.includes('/')) return false;
    return fills.some((f) => {
      const rgb = f.rgb;
      if (rgb && rgb[0] > 235 && rgb[1] > 235 && rgb[2] > 235) return false;
      const fw = f.b.x1 - f.b.x0, fh = f.b.y1 - f.b.y0;
      return fw < 4.5 * l.size && fh < 2.5 * l.size && intersectBox(f.b, l.b) && boxArea(f.b) < 10 * l.size * l.size && boxArea(intersectBox(f.b, l.b)) > 0.5 * boxArea(l.b);
    });
  };
  if (part.cell && part.cell.gridRow != null) {
    const merged = joinColourRuns(lines.slice().sort((p, q) => p.baseline - q.baseline || p.b.x0 - q.b.x0));
    return [{ para: paraOf(merged), container: null, cell: part.cell, cellRight: part.cellRight || null }];
  }
// 1) Çift katmanlı (biri 'i'siz kalın, diğeri 'i'li ince) mükerrer satırları tüm sayfa atomları (textAtoms) üzerinden karşılaştır:
  {
    const normNoI = (s) => (s || '').toLowerCase().replace(/[iıİI1l\s\-#().]/g, '').replace(/[çc]/g, 'c').replace(/[ğg]/g, 'g').replace(/[öo]/g, 'o').replace(/[şs]/g, 's').replace(/[üu]/g, 'u');
    const allAtoms = analysis.seg.textAtoms || [];
    const dropDup = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (dropDup.has(lines[i])) continue;
      const a = lines[i];
      const ka = normNoI(a.text);
      if (ka.length < 3) continue;
      const aScore = (a.text.match(/[iıİ]/g) || []).length * 4 + a.text.length;
      // Hem mevcut part içindeki satırlarda hem de tüm sayfa satırlarında tam ('i'li) eşini ara:
      for (const b of allAtoms) {
        if (b === a || b.decor) continue;
        if (Math.abs(a.b.x0 - b.b.x0) > 40) continue;
        // a second layer lies over the first one; another line elsewhere
        // ('Sayfa' in a header and 'Sayfa 1' in a cell below) is not a copy
        if (Math.abs(a.baseline - b.baseline) > Math.max(2, 0.5 * (a.size || 10))) continue;
        if (normNoI(b.text) !== ka) continue;
        const bScore = (b.text.match(/[iıİ]/g) || []).length * 4 + b.text.length;
        if (bScore > aScore) {
          // Tam metinli katmanın ('b') harflerini, mevcut katmanın ('a') konumuna ve kalınlığına aktar:
          const wasBold = a.bold || a.glyphs.some((g) => g.g && g.g.font && g.g.font.style && g.g.font.style.weight >= 600);
          const dy = a.baseline - b.baseline;
          const dx = a.b.x0 - b.b.x0;
          a.glyphs = b.glyphs.map((g) => ({
            ...g,
            b: { x0: g.b.x0 + dx, y0: g.b.y0 + dy, x1: g.b.x1 + dx, y1: g.b.y1 + dy },
          }));
          a.text = b.text;
          a.bold = wasBold;
          // Eğer 'b' de aynı düzenleme penceresinin içindeyse, mükerrer çıkmaması için onu sil:
          const bInLines = lines.find((x) => x !== a && Math.abs(x.baseline - b.baseline) < 1.5 && Math.abs(x.b.x0 - b.b.x0) < 2);
          if (bInLines) {
            dropDup.add(bInLines);
            part.removedG = part.removedG || [];
            for (const lg of bInLines.glyphs) if (lg.idx != null && !part.removedG.includes(lg.idx)) part.removedG.push(lg.idx);
          }
          break;
        }
      }
    }
    if (dropDup.size) {
      for (let i = lines.length - 1; i >= 0; i--) if (dropDup.has(lines[i])) lines.splice(i, 1);
    }
  }

  const grid = extractGridTable(analysis, part, lines);
  const gridLineSet = new Set(grid.usedLines);
  const freeLines = lines.filter((l) => !gridLineSet.has(l) && !isBlankText(l.text));
  const badgeLines = freeLines.filter(isBadge);
  const badgeSet = new Set(badgeLines);
  const nonBadge = freeLines.filter((l) => !badgeSet.has(l));
  for (const l of nonBadge) l._bgBox = findLineBgBox(l, analysis.atoms.gfx, part.src);
  const main = joinColourRuns(nonBadge);
  const paras = [];
  const cells = [...grid.cells];
  if (main.length) {
    const tbl = extractOptionTable(main);
    cells.push(...tbl.cells);
    const listSet = findConfirmedListLines(tbl.rest);
    const built = tbl.rest.length ? buildParagraphsWithLists(tbl.rest, analysis.atoms.gfx, part.src, listSet) : [];
    for (const pa of built) {
      const t = splitColumns(pa);
      if (!t) { paras.push(pa); continue; }
      paras.push(...t.rest); cells.push(...t.cells);
    }
  }
  const container = fills.filter((f) => paras.some((p) => f.b.x0 <= p.b.x0 + 0.5 && f.b.x1 >= p.b.x1 - 0.5 && f.b.y0 <= p.b.y0 + 2 && f.b.y1 >= p.b.y1 - 2))
    .sort((a, b) => boxArea(a.b) - boxArea(b.b));
  const out = paras.map((p) => ({ para: p, container: container.find((f) => f.b.x0 <= p.b.x0 + 0.5 && f.b.x1 >= p.b.x1 - 0.5 && f.b.y0 <= p.b.y0 + 2 && f.b.y1 >= p.b.y1 - 2) || null }));
  // columns that came out as separate paragraphs with the same rows -> cells (yalnızca gerçek kutu/tablo içindeyse ve çerçeve sınırı aşmıyorsa)
  {
    const boxFrames = (analysis.atoms?.gfx || []).filter((g) => (g.stroke || g.fill) && (g.b.x1 - g.b.x0) >= 25 && (g.b.y1 - g.b.y0) >= 20);
    const separatedByFrame = (a, b) => {
      const acx = (a.para.b.x0 + a.para.b.x1) * 0.5, acy = (a.para.b.y0 + a.para.b.y1) * 0.5;
      const bcx = (b.para.b.x0 + b.para.b.x1) * 0.5, bcy = (b.para.b.y0 + b.para.b.y1) * 0.5;
      return boxFrames.some((f) => {
        const aIn = acx >= f.b.x0 && acx <= f.b.x1 && acy >= f.b.y0 && acy <= f.b.y1;
        const bIn = bcx >= f.b.x0 && bcx <= f.b.x1 && bcy >= f.b.y0 && bcy <= f.b.y1;
        return aIn !== bIn;
      });
    };
    const multi = out.filter((o) => !o.badge && o.para.lines.length >= 2);
    const sameBox = (a, b) => (a.container || null) === (b.container || null) && (a.para.lines[0]?._bgBox || null) === (b.para.lines[0]?._bgBox || null);
    const bl = (o) => o.para.lines.map((l) => l.baseline);
    const same = (a, b) => bl(a).filter((x) => bl(b).some((y) => Math.abs(x - y) < 1)).length;
    const apart = (a, b) => a.para.b.x1 < b.para.b.x0 - 4 || b.para.b.x1 < a.para.b.x0 - 4;
    const used = new Set();
    for (const a of multi) {
      if (used.has(a)) continue;
      const grp = [a, ...multi.filter((b) => b !== a && !used.has(b) && sameBox(a, b) && apart(a, b) && !separatedByFrame(a, b) && same(a, b) >= Math.min(2, Math.min(bl(a).length, bl(b).length)) && same(a, b) >= 0.6 * Math.min(bl(a).length, bl(b).length))];
      if (grp.length < 2) continue;
      if (grp.some((x, i) => grp.some((y, j) => i < j && !apart(x, y)))) continue;
      grp.sort((x, y) => x.para.b.x0 - y.para.b.x0);
      grp.forEach((g, ci) => {
        used.add(g);
        const right = ci + 1 < grp.length ? grp[ci + 1].para.b.x0 - 4 : null;
        for (const l of g.para.lines) cells.push({ para: paraOf([l]), container: null, cell: { row: Math.round(l.baseline * 2), col: ci, n: grp.length }, cellRight: right });
      });
    }
    for (let i = out.length - 1; i >= 0; i--) if (used.has(out[i])) out.splice(i, 1);
  }
  {
    const overBox = (b, ux0, uy0, ux1, uy1) => Math.min(b.x1, ux1) > Math.max(b.x0, ux0) + 1 && Math.min(b.y1, uy1) > Math.max(b.y0, uy0) + 1;
    const onBadgeRow = (p) => badgeLines.some((bl) => Math.abs(bl.baseline - p.lines[0].baseline) < Math.max(6, 0.7 * (p.size || 10)));
    const boxCx = (b) => (b.x0 + b.x1) * 0.5, boxCy = (b) => (b.y0 + b.y1) * 0.5;
    const boxHasNonSpaceGlyph = (b) => nonBadge.some((l) => l.glyphs.some((gl) => !gl.space && (gl.uni || '').trim()
      && boxCx(gl.b) > b.x0 + 1 && boxCx(gl.b) < b.x1 - 1 && boxCy(gl.b) > b.y0 + 1 && boxCy(gl.b) < b.y1 - 1));
    const sepGfx = (ab, bb, ux0, ux1) => (analysis.atoms?.gfx || []).some((g) => {
      if (!(g.fill || g.stroke)) return false;
      const gw = g.b.x1 - g.b.x0, gh = g.b.y1 - g.b.y0;
      if (Math.min(g.b.x1, ux1) <= Math.max(g.b.x0, ux0)) return false;
      if (gw >= 35 && gh <= 5 && g.b.y1 >= ab.y1 - 2 && g.b.y0 <= bb.y0 + 2) return true;
      return gw >= 35 && gh <= 26 && gw / Math.max(0.5, gh) >= 3.2
        && g.b.y0 >= ab.y1 - 2 && g.b.y1 <= bb.y0 + 2 && !boxHasNonSpaceGlyph(g.b);
    });
    const sideRaw = (analysis.atoms?.gfx || []).filter((g) => {
      if (!(g.fill || g.stroke) || g.kind !== 'path') return false;
      const w = g.b.x1 - g.b.x0, h = g.b.y1 - g.b.y0;
      return w >= 6 && w <= 72 && h >= 6 && h <= 45 && w / h <= 3.5 && h / w <= 2.5
        && inRect(part.src, boxCx(g.b), boxCy(g.b)) && !boxHasNonSpaceGlyph(g.b);
    });
    const dedupBoxes = [];
    for (const g of sideRaw.slice().sort((a, b) => boxArea(b.b) - boxArea(a.b))) {
      const w = g.b.x1 - g.b.x0, h = g.b.y1 - g.b.y0;
      const dup = dedupBoxes.find((d) => {
        const dw = d.x1 - d.x0, dh = d.y1 - d.y0;
        return Math.abs(boxCx(d) - boxCx(g.b)) <= 3 && Math.abs(boxCy(d) - boxCy(g.b)) <= 3
          && Math.abs(dw - w) <= 0.25 * Math.max(dw, w) && Math.abs(dh - h) <= 0.25 * Math.max(dh, h);
      });
      if (dup) {
        dup.x0 = Math.min(dup.x0, g.b.x0); dup.y0 = Math.min(dup.y0, g.b.y0);
        dup.x1 = Math.max(dup.x1, g.b.x1); dup.y1 = Math.max(dup.y1, g.b.y1);
      } else {
        dedupBoxes.push({ ...g.b });
      }
    }
    const boxCols = [];
    for (const b of dedupBoxes) {
      const w = b.x1 - b.x0, h = b.y1 - b.y0, cxB = boxCx(b);
      let col = boxCols.find((c) => Math.abs(c.cx - cxB) <= 10
        && Math.abs(c.avgW - w) <= 0.35 * Math.max(c.avgW, w)
        && Math.abs(c.avgH - h) <= 0.35 * Math.max(c.avgH, h));
      if (!col) { col = { cx: cxB, avgW: w, avgH: h, items: [] }; boxCols.push(col); }
      col.items.push(b);
      const n = col.items.length;
      col.cx = col.items.reduce((s, q) => s + boxCx(q), 0) / n;
      col.avgW = col.items.reduce((s, q) => s + (q.x1 - q.x0), 0) / n;
      col.avgH = col.items.reduce((s, q) => s + (q.y1 - q.y0), 0) / n;
    }
    const validSideCols = boxCols
      .map((c) => {
        const items = c.items.slice().sort((a, b) => a.y0 - b.y0);
        const clean = [];
        for (const b of items) {
          if (!clean.length || b.y0 >= clean[clean.length - 1].y1 - 2) clean.push(b);
        }
        return {
          minX: clean.length ? Math.min(...clean.map((b) => b.x0)) : 0,
          maxX: clean.length ? Math.max(...clean.map((b) => b.x1)) : 0,
          items: clean,
        };
      })
      .filter((c) => c.items.length >= 2);
    const sideBoxesDiffer = (ab, bb) => {
      const cyA = boxCy(ab), cyB = boxCy(bb);
      for (const col of validSideCols) {
        const isRight = col.minX >= ab.x1 - 4 && col.minX >= bb.x1 - 4;
        const isLeft = col.maxX <= ab.x0 + 4 && col.maxX <= bb.x0 + 4;
        if (!isRight && !isLeft) continue;
        let bestA = null, bestDA = Infinity, bestB = null, bestDB = Infinity;
        for (const b of col.items) {
          const cyBox = boxCy(b);
          const ovA = b.y0 <= ab.y1 + 2 && b.y1 >= ab.y0 - 2;
          const ovB = b.y0 <= bb.y1 + 2 && b.y1 >= bb.y0 - 2;
          const dA = ovA ? Math.abs(cyBox - cyA) * 0.1 : Math.abs(cyBox - cyA);
          const dB = ovB ? Math.abs(cyBox - cyB) * 0.1 : Math.abs(cyBox - cyB);
          if (dA < bestDA) { bestDA = dA; bestA = b; }
          if (dB < bestDB) { bestDB = dB; bestB = b; }
        }
        if (bestA && bestB && bestA !== bestB && Math.abs(boxCy(bestA) - cyA) <= 24 && Math.abs(boxCy(bestB) - cyB) <= 24) return true;
      }
      return false;
    };
    for (let again = true; again;) {
      again = false;
      out.sort((a, b) => a.para.b.y0 - b.para.b.y0 || a.para.b.x0 - b.para.b.x0);
      for (let i = 0; i < out.length && !again; i++) {
        const A = out[i];
        if (A.badge || A.cell) continue;
        for (let j = i + 1; j < out.length; j++) {
          const B = out[j];
          if (B.badge || B.cell) continue;
          if ((A.container || null) !== (B.container || null)) continue;
          if ((A.para.lines[0]?._bgBox || null) !== (B.para.lines[0]?._bgBox || null)) continue;
          if (onBadgeRow(A.para) !== onBadgeRow(B.para)) continue;
          const ab = A.para.b, bb = B.para.b;
          if (Math.min(ab.y1, bb.y1) - Math.max(ab.y0, bb.y0) > 0.5 || bb.y0 < ab.y1 - 1) continue;
          const maxS = Math.max(A.para.size || 10, B.para.size || 10), minS = Math.min(A.para.size || 10, B.para.size || 10);
          if ((maxS - minS) / Math.max(1, minS) > 0.35) continue;
          if (bb.y0 - ab.y1 > 4.5 * maxS) continue;
          const xOv = Math.min(ab.x1, bb.x1) - Math.max(ab.x0, bb.x0);
          const sameCol = xOv > 0
            || Math.abs(ab.x0 - bb.x0) <= 6 * maxS
            || Math.abs((ab.x0 + ab.x1) * 0.5 - (bb.x0 + bb.x1) * 0.5) <= 2.5 * maxS;
          if (!sameCol) continue;
          const ux0 = Math.min(ab.x0, bb.x0), ux1 = Math.max(ab.x1, bb.x1);
          const uy0 = Math.min(ab.y0, bb.y0), uy1 = Math.max(ab.y1, bb.y1);
          if (sepGfx(ab, bb, ux0, ux1)) continue;
          if (sideBoxesDiffer(ab, bb)) continue;
          const blocked = out.some((Q) => Q !== A && Q !== B && overBox(Q.para.b, ux0, uy0, ux1, uy1))
            || cells.some((Q) => overBox(Q.para.b, ux0, uy0, ux1, uy1))
            || badgeLines.some((l) => overBox(l.b, ux0, uy0, ux1, uy1));
          if (blocked) continue;
          A.para = paraOf(A.para.lines.concat(B.para.lines));
          out.splice(j, 1);
          again = true;
          break;
        }
      }
    }
  }
  for (const c of cells) out.push(c);
  // numbers/letters in coloured badges are always editable on their own (badge stays a graphic)
  for (const l of badgeLines) {
    const box = fills.filter((f) => intersectBox(f.b, l.b) && boxArea(f.b) < 10 * l.size * l.size)
      .sort((a, b) => boxArea(intersectBox(b.b, l.b)) - boxArea(intersectBox(a.b, l.b)) || boxArea(a.b) - boxArea(b.b))[0];
    out.push({ para: { kind: 'text', lines: [l], b: { ...l.b }, size: l.size }, container: box || null, badge: true });
  }
  return out;
}

export function buildTextModel(analysis, part, cluster) {
  const { para } = cluster;
  const container = cluster.container || (part.container ? { b: part.container.b || part.container } : null);
  const cellRight = cluster.cellRight || part.cellRight || null;
  const cell = cluster.cell || part.cell || null;
  const isBadge = !!(cluster.badge || part.badge);
  const isPuaCh = (u) => /^[\uE000-\uF8FF]+$/.test((u || '').trim());
  const lines = para.lines.slice().sort((a, b) => a.baseline - b.baseline).map((l) => {
    let gl = l.glyphs.slice().sort((a, b) => a.b.x0 - b.b.x0 || a.idx - b.idx);
    let puaEnd = 0;
    while (puaEnd < gl.length && (gl[puaEnd].space || isPuaCh(gl[puaEnd].uni))) {
      if (isPuaCh(gl[puaEnd].uni)) { puaEnd++; while (puaEnd < gl.length && gl[puaEnd].space) puaEnd++; break; }
      puaEnd++;
    }
    const hadPuaLead = puaEnd > 0 && gl.slice(0, puaEnd).some((g) => isPuaCh(g.uni));
    if (hadPuaLead && gl.slice(puaEnd).some((x) => !x.space && (x.uni || '').trim())) {
      gl = gl.slice(puaEnd);
    }
    const ns = gl.filter((x) => !x.space);
    return { glyphs: gl, baseline: l.baseline, left: ns[0].b.x0, right: ns[ns.length - 1].b.x1, size: l.size, leadSpaces: 0, hadPuaLead };
  });
  let minLeft = Math.min(...lines.map((l) => l.left));
  let maxRight = Math.max(...lines.map((l) => l.right));
  const first = lines[0], last = lines[lines.length - 1];
  // alignment (computed first so centered wrapped lines stay one paragraph)
  let align = 'left';
  if (lines.length >= 1) {
    const ctr = lines.map((l) => (l.left + l.right) / 2);
    const spreadC = Math.max(...ctr) - Math.min(...ctr);
    const spreadL = Math.max(...lines.map((l) => l.left)) - Math.min(...lines.map((l) => l.left));
    if (lines.length > 1 && spreadL > 3 && (spreadC < 1.8 || (spreadL > 4 && spreadC <= 4.0 && spreadC < spreadL * 0.35))) align = 'center';
    if (lines.length === 1 && container) {
      const lp = first.left - container.b.x0, rp = container.b.x1 - first.right;
      if (Math.abs(lp - rp) < 2.5 && lp > (isBadge ? 0.5 : 3)) align = 'center';
    }
  }
  const compactBox = !!(container && (container.b.y1 - container.b.y0) < 90);
  // paragraph starts
  const confirmedStarts = findConfirmedListLines(lines);
  const isTocLine = (q) => /(?:\.{3,}|(?:\.\s){3,})\s*\d{1,4}\s*$/.test((q.glyphs || []).map((g) => g.uni || '').join('').trim());
  const hasToc = lines.filter(isTocLine).length >= 2;
  const lineTxt = (q) => (q.glyphs || []).map((g) => g.uni || '').join('').trimEnd();
  const hasSentencePunct = lines.filter((q) => /[.!?…:"”)]$/.test(lineTxt(q))).length >= 2;
  const stepYs = [];
  for (let k = 1; k < lines.length; k++) { const dy = lines[k].baseline - lines[k - 1].baseline; if (dy > 0) stepYs.push(dy); }
  stepYs.sort((a, b) => a - b);
  const maxLineSz = Math.max(...lines.map((l) => l.size || 10));
  const intraCands = stepYs.filter((dy) => dy <= 1.62 * maxLineSz);
  const medianStep = intraCands.length ? intraCands[Math.floor(intraCands.length / 2)] : (stepYs.length ? Math.min(stepYs[0], (lines[0]?.size || 10) * 1.35) : (lines[0]?.size || 10) * 1.2);
  let activeHangX = null;
  const starts = lines.map((l, i) => {
    let lead = 0;
    for (const g of l.glyphs) { if (g.space) lead++; else break; }
    l.leadSpaces = lead;
    const mk = lineListMarker(l);
    if (mk && (mk.type === 'bullet' || mk.type === 'num' || mk.type === 'alpha' || mk.type === 'roman' || mk.type === 'speaker')) {
      const nonSp = l.glyphs.filter((g) => !g.space);
      const afterMk = nonSp.slice(mk.len || 1).find((g) => !/^[\s•\-–—.*◦▪▸.)]+$/.test(g.uni || ''));
      activeHangX = afterMk ? afterMk.b.x0 : null;
    } else if (activeHangX != null && Math.abs(l.left - activeHangX) > 0.8 * l.size) {
      activeHangX = null;
    }
    if (i === 0) return true;
    if (hasToc && (isTocLine(l) || isTocLine(lines[i - 1]))) return true;
    if (confirmedStarts.has(l)) return true;
    if (mk && (mk.type === 'speaker' || mk.type === 'bullet' || lines.some((q, qi) => qi !== i && lineListMarker(q)?.type === mk.type))) return true;
    if (cell && lines.every((q) => (q.right - q.left) < 0.45 * Math.max(20, (cellRight || maxRight) - minLeft))) return true;
    if (lines.length >= 2 && lines.every((q) => q.glyphs.filter((g) => !g.space).length <= 4)) return true;
    if (align === 'center' || compactBox) return false;
    const prev = lines[i - 1];
    const prevText = lineTxt(prev);
    const prevEnded = /[.!?…:"”)]$/.test(prevText);
    const vGap = l.baseline - prev.baseline;
    if (vGap > medianStep * 1.30) return true;
    // Hanging-indent continuation of a bullet / list item: never split wrapped lines
    if (activeHangX != null && Math.abs(l.left - activeHangX) <= 0.8 * l.size) return false;
    // If previous line did not finish its sentence and gap is normal, keep as same paragraph
    if (hasSentencePunct && !prevEnded) return false;
    if (lead >= 2) return true;
    if (l.left - minLeft > 0.6 * l.size) return true;
    if (prev.right < minLeft + 0.72 * (maxRight - minLeft) && prevEnded && lines.length > 2) return true;
    return false;
  });
  // glyphs clipped away in the PDF (a list number hidden outside a clipped text
  // box) told where paragraphs start; they are not drawn, so they are not
  // part of the text, its left edge or its layout
  if (lines.some((l) => l.glyphs.some((g) => g.clipped))) {
    for (const l of lines) {
      if (!l.glyphs.some((g) => g.clipped)) continue;
      const gl = l.glyphs.filter((g) => !g.clipped);
      const ns = gl.filter((x) => !x.space);
      if (!ns.length) continue;
      let lead = 0;
      for (const g of gl) { if (g.space) lead++; else break; }
      l.glyphs = gl.slice(lead); l.leadSpaces = 0;
      l.left = ns[0].b.x0; l.right = ns[ns.length - 1].b.x1;
    }
    minLeft = Math.min(...lines.map((l) => l.left));
    maxRight = Math.max(...lines.map((l) => l.right));
  }
  const hasBulletLeft = (l) => {
    if (l.hadPuaLead) return true;
    const gfx = analysis && analysis.atoms && analysis.atoms.gfx;
    if (!gfx) return false;
    return gfx.some((g) => (g.fill || g.stroke) && g.b.x1 - g.b.x0 <= 14 && g.b.y1 - g.b.y0 <= 14
      && g.b.x1 <= l.left + 1 && g.b.x0 >= l.left - 3 * (l.size || 10)
      && g.b.y0 <= l.baseline + 2 && g.b.y1 >= l.baseline - (l.size || 10));
  };
  const indentLines = align === 'left'
    ? lines.filter((l, i) => starts[i] && i > 0 && !hasBulletLeft(l) && l.left - minLeft > 0.6 * l.size)
    : [];
  const startCount = starts.filter(Boolean).length;
  const firstIndented = align === 'left' && !hasBulletLeft(lines[0]) && lines[0].left - minLeft > 0.6 * lines[0].size;
  const atMinStartCount = lines.filter((l, i) => starts[i] && Math.abs(l.left - minLeft) <= 3).length;
  let indent = 0;
  if (align === 'left') {
    if (indentLines.length && !(indentLines.length === 1 && startCount >= 2 && atMinStartCount >= 1 && !firstIndented)) {
      indent = indentLines[0].left - minLeft;
    } else if (firstIndented && (startCount === 1 || indentedLinesOrNone())) {
      indent = lines[0].left - minLeft;
    }
  }
  function indentedLinesOrNone() { return indentLines.length > 0 || atMinStartCount === 0; }
  // text + char map
  // vector shapes that an accepted repair replaced (layer 3/4 add to it; a
  // letter drawn as curves must not show twice once it is real text)
  const droppedCurveGfx = new Set();

  let text = '';
  const charGlyph = [];
  const paraStartsAt = [];
  const lineEndAt = [];
  lines.forEach((l, i) => {
    const gl = l.glyphs.slice(l.leadSpaces);
    if (i > 0) {
      if (starts[i]) { text = text.replace(/ +$/, ''); while (charGlyph.length > text.length) charGlyph.pop(); text += '\n'; charGlyph.push(null); }
      else if (!/[ \-\u00AD]$/.test(text)) { text += ' '; charGlyph.push(charGlyph[charGlyph.length - 1] || null); }
    }
    if (starts[i]) paraStartsAt.push(text.length);
    let prevG = null;
    for (let gi = 0; gi < gl.length; gi++) {
      const g = gl[gi];
      if (prevG && !prevG.space && !g.space) {
        const gap = g.b.x0 - prevG.b.x1, sz = l.size || g.size || 10;
        const bothLetters = /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test((prevG.uni || '').slice(-1)) && /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test((g.uni || '')[0] || '');
        if (gap > (bothLetters ? 0.23 : 0.22) * sz) {
          const n = Math.max(1, Math.min(6, Math.round(gap / (0.28 * sz))));
          for (let k = 0; k < n; k++) { text += ' '; charGlyph.push(prevG); }
        }
      }
      // a no-break space glyph is an ordinary word space in the editable text
      // (the editor reads spaces back as ' '; otherwise an untouched paragraph
      // would count as changed and be rewritten)
      const u = (g.uni || '').replace(/\u00A0/g, ' ');
      text += u;
      for (let k = 0; k < u.length; k++) charGlyph.push(g);
      prevG = g;
    }
    lineEndAt.push(text.replace(/ +$/, '').length);
  });
  text = text.replace(/ +$/, '');
  charGlyph.length = text.length;

  // (the old Turkish case "repair" that ran here is gone: the lines it was
  // written for are Braille cells, now recognised as pictures - layer 2)
  const intraSteps = [], breakGaps = [];
  for (let i = 1; i < lines.length; i++) {
    const dy = lines[i].baseline - lines[i - 1].baseline;
    if (dy <= 0) continue;
    if (starts[i]) breakGaps.push(dy);
    else intraSteps.push(dy);
  }
  const step = intraSteps.length ? intraSteps.reduce((s, v) => s + v, 0) / intraSteps.length : medianStep;
  const paraGap = breakGaps.length ? Math.max(0, (breakGaps.reduce((s, v) => s + v, 0) / breakGaps.length) - step) : 0;
  // horizontal area
  let areaLeft = minLeft, areaRight = maxRight;
  if (container) {
    const padL = minLeft - container.b.x0;
    const innerRight = container.b.x1 - Math.max(padL, 2);
    if (lines.length > 1) areaRight = maxRight;
    else areaRight = Math.max(maxRight, innerRight);
  } else if (lines.length === 1) {
    areaRight = Math.max(maxRight, analysis.textRight || maxRight);
  }
  // never run into other things on the same row (checkboxes, pictures, other text)
  {
    const band = { y0: first.baseline - 0.8 * first.size, y1: last.baseline + 0.25 * last.size };
    const own = new Set(lines.flatMap((l) => l.glyphs.map((g) => g.idx)));
    const inPart = (b) => inRect(part.src, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const obst = [
      ...analysis.atoms.gfx.filter((g) => g.b.x1 - g.b.x0 < 0.5 * (areaRight - areaLeft) && (g.b.x1 - g.b.x0) * (g.b.y1 - g.b.y0) < 4000).map((g) => g.b),
      ...analysis.seg.textAtoms.filter((l) => !l.glyphs.some((g) => own.has(g.idx))).map((l) => l.b),
    ].filter((b) => inPart(b) && b.y0 < band.y1 && b.y1 > band.y0 && b.x0 >= maxRight - 0.5);
    if (obst.length) areaRight = Math.max(maxRight, Math.min(areaRight, Math.min(...obst.map((b) => b.x0)) - 3));
  }
  // centred single line in a small box (badge numbers): the whole inner width is usable
  if (container && lines.length === 1 && isBadge) {
    const pad = Math.min(1.8, Math.max(0.75, (container.b.x1 - container.b.x0) * 0.1));
    areaLeft = Math.min(minLeft, container.b.x0 + pad); areaRight = Math.max(maxRight, container.b.x1 - pad);
  }
  // a table cell never runs into the next column
  if (cellRight) areaRight = Math.max(maxRight, Math.min(areaRight, cellRight));
  const desc = 0.25 * last.size;
  const marks = inlineMarks(analysis, part, lines, container, cell);
  const paraIndent = align === 'left'
    ? lines.filter((l, i) => starts[i]).map((l) => indent > 0 && !hasBulletLeft(l) && (l.leadSpaces >= 2 || l.left - minLeft > 0.6 * l.size))
    : lines.filter((l, i) => starts[i]).map(() => false);
  // Detect aligned ':' colons (e.g. "Selin : ...", "Joy   : ...") and hanging indent after ':'
  let colonAlignX = null, hangIndent = 0;
  {
    const cXs = [], aXs = [];
    lines.forEach((l, i) => {
      if (!starts[i]) return;
      const txt = l.glyphs.map((g) => g.uni || '').join('');
      if (!/^\s*\S{1,18}\s*:/.test(txt)) return;
      const cg = l.glyphs.find((g) => g.uni === ':');
      if (!cg) return;
      const ci = l.glyphs.indexOf(cg);
      const ag = l.glyphs.slice(ci + 1).find((g) => !g.space);
      cXs.push(cg.b.x0);
      aXs.push(ag ? ag.b.x0 : cg.b.x1 + l.size * 0.35);
    });
    if (cXs.length >= 2 && Math.max(...cXs) - Math.min(...cXs) < 3.5) {
      colonAlignX = cXs.reduce((s, v) => s + v, 0) / cXs.length;
      const avgAfter = aXs.reduce((s, v) => s + v, 0) / aXs.length;
      hangIndent = Math.max(0, avgAfter - areaLeft);
    }
  }
  const paras = text.split('\n').map((t, pi) => ({ text: t, marker: !!paraIndent[pi], ...(align === 'center' ? { align: 'center' } : {}) }));
  return {
    paras, paraIndent, newParaIndent: indent > 0 && indentLines.length > 0, partSrc: { ...part.src },
    partId: part.id, text, charGlyph, paraStartsAt, lineEndAt, lines, indent, align, colonAlignX, hangIndent, container: container ? { ...container.b } : null,
    cell, cellRight, badge: isBadge,
    area: { left: areaLeft, right: areaRight, firstBaseline: first.baseline, lastBaseline: last.baseline, step, paraGap, top: first.baseline - 0.8 * first.size, bottom: last.baseline + desc },
    glyphIdx: lines.flatMap((l) => l.glyphs.map((g) => g.idx)),
    extraDropGfx: [...droppedCurveGfx],
    marks,
  };
}