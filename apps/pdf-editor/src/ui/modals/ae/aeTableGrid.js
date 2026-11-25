// Table detection and grid geometry: cell metadata, keyboard nav, grid/frame extraction, original palette, column/row slots and bounds.
// Part of aeTable.js: runs inside setupAeTable(); `T` is the shared table state built there.
import { h } from '../../common/dom.js';
import { setupTableSlots } from './aeTableSlots.js';

// 1.7 cm = 48.2 PDF points (sayfa sol ve sağ maksimum genişleme sınırı)
const MARGIN_17CM_PT = 48.2;

export function setupTableGrid(T) {
  const {
    an, cellRows, colSecs, ctx, guides, isUnit, objs, partOf, place, render, scaleOf, sections, stage,
    wireObjEl,
  } = T;
  const nonTableSecs = sections.filter((s) => !colSecs.includes(s) && !s.o.deleted && !s.badge);

  for (const s of colSecs) {
    const o = s.o;
    o._colTargetX = o.x;
    o._rowTargetY = o.y;
    if (o._tblW0 == null) {
      // ink width at editor open: an already-edited cell part is as wide as
      // its old wrap area, its text only as wide as its runs
      const rs = (o.edit && o.edit.runs) || [];
      const sc = o.dw ? o.w / o.dw : 1;
      let ink = rs.length && o.src ? Math.max(...rs.map((r) => r.x + (r.w || 0) - o.src.x)) * sc : (o.addedText ? 0 : o.w);
      if (!rs.length && !o.addedText && s.model && Array.isArray(s.model.lines) && s.model.lines.length) {
        const minL = Math.min(...s.model.lines.map((l) => l.left));
        const maxR = Math.max(...s.model.lines.map((l) => l.right));
        ink = Math.min(ink, Math.max(1, (maxR - minL + 2) * sc));
      }
      o._tblW0 = Math.min(o.w, Math.max(1, ink));
      if (o._inkW == null) o._inkW = (o.addedText && !rs.length) ? 0 : o._tblW0;
    }
    if (o._base) {
      o._base.x = o.x;
      o._base.y = o.y;
      o._base.w = o.w;
      o._base.h = o.h;
      o._base.dw = o.dw;
      o._base.dh = o.dh;
    }
    if (s.model && s.model.area && s.model._origAreaSpan == null) {
      s.model._origAreaLeft = s.model.area.left;
      s.model._origAreaSpan = Math.max(16, s.model.area.right - s.model.area.left);
    }
  }

  const reindexRowAndColMeta = () => {
    for (let rIdx = 0; rIdx < cellRows.length; rIdx++) {
      const row = cellRows[rIdx];
      for (const s of colSecs) {
        if (s.rowEl !== row) continue;
        if (s.model && s.model.cell) {
          s.model.cell.row = rIdx;
          if (s.model.cell.gridRow != null) s.model.cell.gridRow = rIdx;
        }
        if (s.o && s.o.cell) {
          s.o.cell.row = rIdx;
          if (s.o.cell.gridRow != null) s.o.cell.gridRow = rIdx;
        }
        if (s.o && s.o._origPart && s.o._origPart.cell) {
          s.o._origPart.cell.row = rIdx;
          if (s.o._origPart.cell.gridRow != null) s.o._origPart.cell.gridRow = rIdx;
        }
      }
    }
  }; T.reindexRowAndColMeta = reindexRowAndColMeta;
  reindexRowAndColMeta();

  const wireCellKeyboardNav = (sec) => {
    if (!sec || !sec.ed || sec.ed._navWired) return;
    sec.ed._navWired = true;
    sec.ed.paper.addEventListener('keydown', (e) => {
      const rIdx = cellRows.indexOf(sec.rowEl);
      const cIdx = sec.model?.cell?.col;
      if (rIdx < 0 || cIdx == null) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        let nr = rIdx, nc = cIdx + (e.shiftKey ? -1 : 1);
        if (nc >= T.colCount) { nc = 0; nr++; }
        else if (nc < 0) { nc = T.colCount - 1; nr--; }
        if (nr >= 0 && nr < cellRows.length) {
          const target = colSecs.find((s) => s.rowEl === cellRows[nr] && s.model.cell.col === nc && !s.o.deleted);
          if (target) target.ed.focusEnd();
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const edge = sec.ed.caretEdge();
        if (!edge) return;
        if (e.key === 'ArrowDown' && edge.onLastLine && rIdx + 1 < cellRows.length) {
          const target = colSecs.find((s) => s.rowEl === cellRows[rIdx + 1] && s.model.cell.col === cIdx && !s.o.deleted);
          if (target) { e.preventDefault(); target.ed.focusAt(false, edge.caretX, true); }
        } else if (e.key === 'ArrowUp' && edge.onFirstLine && rIdx - 1 >= 0) {
          const target = colSecs.find((s) => s.rowEl === cellRows[rIdx - 1] && s.model.cell.col === cIdx && !s.o.deleted);
          if (target) { e.preventDefault(); target.ed.focusAt(true, edge.caretX, true); }
        }
      }
    });
  }; T.wireCellKeyboardNav = wireCellKeyboardNav;
  colSecs.forEach(wireCellKeyboardNav);

  const textWidthOfCol = (c) => {
    const cs = colSecs.filter((s) => s.model.cell.col === c);
    let maxW = 0;
    for (const s of cs) {
      const p = s.ed.paper.querySelector('.te-para');
      if (!p) continue;
      const rng = document.createRange();
      rng.selectNodeContents(p);
      const rw = rng.getBoundingClientRect().width;
      if (rw > maxW) maxW = rw;
    }
    return maxW;
  };

  const syncCellWidths = () => {
    const avgFlex = [];
    for (let c = 0; c < T.colCount; c++) {
      const cs = colSecs.filter((s) => s.model.cell.col === c);
      const slotW0 = (T.colSlots && T.colSlots[c] && T.tableSc) ? Math.round(T.colSlots[c].slotWUi / T.tableSc) : 0;
      const colW = cs.reduce((m, s) => Math.max(m, s.model?.cell?.colW ? Math.round(s.model.cell.colW) : 0), 0) || slotW0;
      if (colW) avgFlex.push(colW);
      let maxMin = 0;
      for (const s of cs) {
        const mw = parseInt(s.ed.el.style.minWidth || '0', 10) || 0;
        if (mw > maxMin) maxMin = mw;
      }
      const tw = textWidthOfCol(c);
      if (tw > 0) maxMin = Math.max(maxMin, Math.min(170, Math.ceil(tw + 28)));
      const effFlex = Math.max(24, (colW || (avgFlex.length ? Math.round(avgFlex.reduce((a, b) => a + b, 0) / avgFlex.length) : 60)) + (T.colOffsets[c] || 0));
      for (const s of cs) {
        s.ed.el.style.flex = `${effFlex} 1 0`;
        s.ed.el.style.minWidth = `${Math.max(32, Math.min(48, effFlex), maxMin)}px`;
      }
    }
  }; T.syncCellWidths = syncCellWidths;

  const plainRefGlyphIdx = (() => {
    const segGlyphs = (an && an.seg && an.seg.glyphs) || [];
    for (const s of colSecs) {
      if (s.rowEl === cellRows[0]) continue;
      const cgs = (s.model && s.model.origCharGlyph) || [];
      for (const g of cgs) {
        if (!g || g.space || !g.g || !g.g.font) continue;
        const st = g.g.font.style;
        const isBold = !!(st && st.weight >= 600) || /bold|black|heavy/i.test(g.g.font.baseFont || '');
        if (isBold) continue;
        const fl = g.g.fill;
        const isColored = fl && fl.args && fl.args.length >= 3 && (Math.max(...fl.args) - Math.min(...fl.args) > 0.12 || Math.max(...fl.args) > 0.5);
        if (!isColored && g.idx >= 0) return g.idx;
      }
    }
    const fallbackG = segGlyphs.find((g) => g && !g.space && g.g && g.g.font && !(g.g.font.style && g.g.font.style.weight >= 600) && !/bold|black|heavy/i.test(g.g.font.baseFont || ''));
    return fallbackG ? fallbackG.idx : -1;
  })(); T.plainRefGlyphIdx = plainRefGlyphIdx;

  const plainFontSize = (() => {
    const g = plainRefGlyphIdx >= 0 && an?.seg?.glyphs?.[plainRefGlyphIdx];
    if (g && g.g && g.g.hsize) return Math.round(g.g.hsize * 10) / 10;
    for (const s of colSecs) {
      if (s.rowEl !== cellRows[0] && (s.o?.fontSize || s.model?.fontSize)) {
        return s.o.fontSize || s.model.fontSize;
      }
    }
    return 10;
  })(); T.plainFontSize = plainFontSize;

  const stripModelStyle = (model) => {
    if (!model) return;
    if (Array.isArray(model.paras)) {
      for (const p of model.paras) {
        delete p.st;
        p.marker = false;
      }
    }
  }; T.stripModelStyle = stripModelStyle;

  const cellsMinUiX = Math.min(...colSecs.map((s) => s.o._base.x));
  const cellsMaxUiX = Math.max(...colSecs.map((s) => s.o._base.x + s.o._base.w));
  const cellsMinUiY = Math.min(...colSecs.map((s) => s.o._base.y));
  const cellsMaxUiY = Math.max(...colSecs.map((s) => s.o._base.y + s.o._base.h));
  const cellsSpanUiH = Math.max(16, cellsMaxUiY - cellsMinUiY);

  const coloredBadgeBoxes = [];
  const hasColorTint = (c) => {
    if (!c) return false;
    if (Array.isArray(c) && c.length >= 3) {
      const r = c[0] > 1 ? c[0] / 255 : c[0];
      const gr = c[1] > 1 ? c[1] / 255 : c[1];
      const b = c[2] > 1 ? c[2] / 255 : c[2];
      return (r - b) > 0.035 && (r - gr) > 0.035;
    }
    if (c.args && c.args.length >= 3) {
      const r = c.args[0] > 1 ? c.args[0] / 255 : c.args[0];
      const gr = c.args[1] > 1 ? c.args[1] / 255 : c.args[1];
      const b = c.args[2] > 1 ? c.args[2] / 255 : c.args[2];
      return (r - b) > 0.035 && (r - gr) > 0.035;
    }
    return false;
  };
  if (an && an.atoms && an.atoms.gfx) {
    for (const g of an.atoms.gfx) {
      if (!g || !g.b) continue;
      const gw = g.b.x1 - g.b.x0, gh = g.b.y1 - g.b.y0;
      if (gw > 3.8 && gh > 3.8 && gw <= 105 && gh <= 48) {
        if (hasColorTint(g.stroke) || hasColorTint(g.fill) || hasColorTint(g.sColor) || hasColorTint(g.fColor) || hasColorTint(g.color) || hasColorTint(g.item?.strokeRgb) || hasColorTint(g.item?.fillRgb)) {
          coloredBadgeBoxes.push(g.b);
        }
      }
    }
  }

  const isCellBadgeBoxGfx = (g) => {
    if (!g || !g.b) return false;
    const gw = g.b.x1 - g.b.x0, gh = g.b.y1 - g.b.y0;
    if (gw <= 3.8 || gh <= 3.8) return false;
    if (gw > 105 || gh > 48) return false;
    if (hasColorTint(g.stroke) || hasColorTint(g.fill) || hasColorTint(g.sColor) || hasColorTint(g.fColor) || hasColorTint(g.color) || hasColorTint(g.item?.strokeRgb) || hasColorTint(g.item?.fillRgb)) return true;
    return coloredBadgeBoxes.some((bb) => Math.abs(bb.x0 - g.b.x0) < 3 && Math.abs(bb.x1 - g.b.x1) < 3 && Math.abs(bb.y0 - g.b.y0) < 3 && Math.abs(bb.y1 - g.b.y1) < 3);
  };

  const isTableStructureGfx = (g) => {
    if (!g || !g.b || !(g.stroke || g.fill)) return false;
    return !isCellBadgeBoxGfx(g);
  };

  // Üstteki diyalog balonunu (Selin/Joy gibi tablo dışı paragrafları içeren dış kutuyu) belirle:
  const outerDialogueObjs = objs.filter((u) => {
    if (u.deleted || !u._base || !(isUnit(u) || u.type === 'bg' || u.type === 'deco')) return false;
    return nonTableSecs.some((ns) => {
      const cy = ns.o._base.y + ns.o._base.h * 0.5;
      return cy >= u._base.y - 4 && cy <= u._base.y + u._base.h + 4 && ns.o._base.y < cellsMinUiY - 12;
    });
  });

  // Tablonun kendi arka plan/çizgi kutusunu bul:
  const cellsSpanUiW = Math.max(24, cellsMaxUiX - cellsMinUiX);
  const tableGridObjs = objs.filter((u) => {
    if (u.deleted || !u._base || outerDialogueObjs.includes(u)) return false;
    if (u.edit && u.edit.tableSpec) return true;
    if (!(isUnit(u) || u.type === 'bg' || u.type === 'deco' || (u.type === 'box' && u.w > 80))) return false;
    if (u._base.w < cellsSpanUiW * 0.45 && u._base.h < cellsSpanUiH * 0.45) return false;
    const coversCells = colSecs.some((s) => s.o._base.x >= u._base.x - 24 && s.o._base.x <= u._base.x + u._base.w + 24 &&
                                            s.o._base.y >= u._base.y - 24 && s.o._base.y + s.o._base.h <= u._base.y + u._base.h + 24);
    if (!coversCells) return false;
    if (u._base.y < cellsMinUiY - 36 && u._base.h > cellsSpanUiH * 1.75) return false;
    return true;
  });

  const alreadyExtractedGrid = tableGridObjs.some((u) => u.edit && u.edit.tableSpec);
  const sideTapeGfx = new Set(); T.sideTapeGfx = sideTapeGfx;

  if (an && an.atoms && an.atoms.gfx && !alreadyExtractedGrid) {
    const cellKeptGfx = new Set();
    const textObjSet = new Set(colSecs.map((s) => s.o));
    for (const to of textObjSet) {
      if (!to.keep || !to.keep.length) continue;
      const remainKeep = [];
      for (const gi of to.keep) {
        const g = an.atoms.gfx[gi];
        if (isTableStructureGfx(g)) {
          cellKeptGfx.add(gi);
        } else {
          remainKeep.push(gi);
        }
      }
      if (remainKeep.length !== to.keep.length) {
        to.keep = remainKeep;
        to._baseKeep = remainKeep.slice();
        if (to._origPart) to._origPart.keep = remainKeep.slice();
      }
    }

    // Eğer şık kutusunun arka planı üstteki diyalog balonunun (`outerDialogueObjs`) içinde kaldıysa onu oradan ayır:
    if (tableGridObjs.length === 0 && outerDialogueObjs.length > 0) {
      const minSx = Math.min(...colSecs.map((s) => s.o.src.x)) - 24;
      const maxSx = Math.max(...colSecs.map((s) => s.o.src.x + s.o.src.w)) + 24;
      const minSy = Math.min(...colSecs.map((s) => s.o.src.y)) - 16;
      const maxSy = Math.max(...colSecs.map((s) => s.o.src.y + s.o.src.h)) + 16;
      for (const ou of outerDialogueObjs) {
        if (!Array.isArray(ou.keep)) continue;
        const remainOu = [];
        for (const gi of ou.keep) {
          const g = an.atoms.gfx[gi];
          if (g && g.b && g.b.x0 >= minSx && g.b.x1 <= maxSx && g.b.y0 >= minSy && g.b.y1 <= maxSy && isTableStructureGfx(g)) {
            cellKeptGfx.add(gi);
          } else {
            remainOu.push(gi);
          }
        }
        if (remainOu.length !== ou.keep.length) {
          ou.keep = remainOu;
          ou._baseKeep = remainOu.slice();
          render(ou);
        }
      }
    }

    for (const u of tableGridObjs) {
      if (!u.keep || !u.keep.length) continue;
      const gKeep = [];
      for (const gi of u.keep) {
        const g = an.atoms.gfx[gi];
        if (!g || !g.b) continue;
        const gw = g.b.x1 - g.b.x0, gh = g.b.y1 - g.b.y0;
        const coversAnyCell = colSecs.some((s) => {
          const scx = s.o.src.x + s.o.src.w * 0.5, scy = s.o.src.y + s.o.src.h * 0.5;
          return scx >= g.b.x0 && scx <= g.b.x1 && scy >= g.b.y0 && scy <= g.b.y1;
        });
        const isHairline = (gw <= 3.5 && gh >= 10) || (gh <= 3.5 && gw >= 12);
        const isSideTape = !coversAnyCell && !isHairline && gw > 3.5 && gh > 3.5
          && gw < Math.min(60, u.src.w * 0.25) && gh < Math.min(60, u.src.h * 0.45)
          && (g.b.x0 < u.src.x + 14 || g.b.x1 > u.src.x + u.src.w - 14);
        if (isSideTape) {
          // tape / clip decorations on the box edges: not part of the grid
          // analysis, but they stay in the picture (re-added below)
          sideTapeGfx.add(gi);
          continue;
        } else if (isTableStructureGfx(g)) {
          gKeep.push(gi);
        } else {
          const gcx = (g.b.x0 + g.b.x1) * 0.5, gcy = (g.b.y0 + g.b.y1) * 0.5;
          let bestSec = null, bestD = Infinity;
          for (const s of colSecs) {
            if (s.o.addedText) continue;
            const a = s.model.area || { left: s.o.src.x, right: s.o.src.x + s.o.src.w, top: s.o.src.y, bottom: s.o.src.y + s.o.src.h };
            const dx = Math.max(a.left - gcx, 0, gcx - a.right);
            const dy = Math.max(a.top - gcy, 0, gcy - a.bottom);
            const d = Math.hypot(dx, dy);
            if (d < bestD && d < 24) { bestD = d; bestSec = s; }
          }
          if (bestSec) {
            if (!bestSec.o.keep.includes(gi)) {
              bestSec.o.keep.push(gi);
              bestSec.o.keep.sort((a, b) => a - b);
              bestSec.o._baseKeep = bestSec.o.keep.slice();
              if (bestSec.o._origPart) bestSec.o._origPart.keep = bestSec.o.keep.slice();
              const scO = scaleOf(bestSec.o);
              const nx0 = Math.min(bestSec.o.src.x, g.b.x0 - 0.8);
              const ny0 = Math.min(bestSec.o.src.y, g.b.y0 - 0.8);
              const nx1 = Math.max(bestSec.o.src.x + bestSec.o.src.w, g.b.x1 + 0.8);
              const ny1 = Math.max(bestSec.o.src.y + bestSec.o.src.h, g.b.y1 + 0.8);
              const dx0 = nx0 - bestSec.o.src.x, dy0 = ny0 - bestSec.o.src.y;
              bestSec.o.src = { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 };
              bestSec.o.full = { ...bestSec.o.src };
              bestSec.o.dw = bestSec.o.src.w; bestSec.o.dh = bestSec.o.src.h;
              bestSec.o.x += dx0 * scO; bestSec.o.y += dy0 * scO;
              bestSec.o._colTargetX = bestSec.o.x; bestSec.o._rowTargetY = bestSec.o.y;
              bestSec.o.w = bestSec.o.dw * scO; bestSec.o.h = bestSec.o.dh * scO;
              bestSec.o._base = { ...bestSec.o._base, src: { ...bestSec.o.src }, full: { ...bestSec.o.full }, dw: bestSec.o.dw, dh: bestSec.o.dh, x: bestSec.o.x, y: bestSec.o.y, w: bestSec.o.w, h: bestSec.o.h };
              bestSec.o._origPart = partOf(bestSec.o);
            }
          } else {
            gKeep.push(gi);
          }
        }
      }
      u.keep = gKeep;
      u._baseKeep = gKeep.slice();
    }

    if (cellKeptGfx.size > 0 || tableGridObjs.length === 0) {
      if (tableGridObjs.length > 0 && cellKeptGfx.size > 0) {
        const mainG = tableGridObjs[0];
        const merged = new Set([...(mainG.keep || []), ...cellKeptGfx]);
        mainG.keep = [...merged].sort((a, b) => a - b);
        mainG._baseKeep = mainG.keep.slice();
        let x0 = mainG.src.x, y0 = mainG.src.y, x1 = x0 + mainG.src.w, y1 = y0 + mainG.src.h;
        for (const gi of cellKeptGfx) {
          const b = an.atoms.gfx[gi]?.b;
          if (b) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
        }
        const scG = scaleOf(mainG);
        const dx0 = x0 - mainG.src.x, dy0 = y0 - mainG.src.y;
        mainG.src = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        mainG.full = { ...mainG.src };
        mainG.dw = mainG.src.w; mainG.dh = mainG.src.h;
        mainG.x += dx0 * scG; mainG.y += dy0 * scG;
        mainG.w = mainG.dw * scG; mainG.h = mainG.dh * scG;
        mainG._base = { ...mainG._base, src: { ...mainG.src }, full: { ...mainG.full }, dw: mainG.src.w, dh: mainG.src.h, x: mainG.x, y: mainG.y, w: mainG.src.w * scG, h: mainG.src.h * scG };
      } else if (tableGridObjs.length === 0) {
        const refT = colSecs.find((s) => !s.o.addedText)?.o || colSecs[0].o;
        const scG = scaleOf(refT);
        let x0 = Math.min(...colSecs.map((s) => s.o.src.x)) - 8;
        let y0 = Math.min(...colSecs.map((s) => s.o.src.y)) - 5;
        let x1 = Math.max(...colSecs.map((s) => s.o.src.x + s.o.src.w)) + 8;
        let y1 = Math.max(...colSecs.map((s) => s.o.src.y + s.o.src.h)) + 5;
        for (const gi of cellKeptGfx) {
          const b = an.atoms.gfx[gi]?.b;
          if (b) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
        }
        const ux = refT._base.x + (x0 - refT._base.src.x) * scG;
        const uy = refT._base.y + (y0 - refT._base.src.y) * scG;
        const dw = x1 - x0, dh = y1 - y0;
        const keepArr = [...cellKeptGfx].sort((a, b) => a - b);
        const u = {
          id: 'o_tbl_grid_' + Date.now().toString(36),
          type: 'deco',
          src: { x: x0, y: y0, w: dw, h: dh },
          full: { x: x0, y: y0, w: dw, h: dh },
          keep: keepArr, _baseKeep: keepArr.slice(), keepG: [],
          edit: null, nine: null, k: scG,
          dw, dh, x: ux, y: uy, w: dw * scG, h: dh * scG,
        };
        u._base = { src: { ...u.src }, full: { ...u.full }, keepG: [], edit: null, dw, dh, w: u.w, h: u.h, x: u.x, y: u.y };
        u.el = h('div', { class: 'ae-obj ae-deco', 'data-testid': 'ae-obj', 'data-type': 'deco', 'data-oid': u.id });
        u.view = h('div', { class: 'ae-view' }); u.canvas = h('canvas'); u.view.append(u.canvas); u.el.append(u.view);
        wireObjEl(u);
        objs.unshift(u);
        stage.insertBefore(u.el, stage.querySelector('.ae-obj') || guides);
        tableGridObjs.push(u);
      }
    }
    for (const to of textObjSet) { place(to); render(to); }
  }

  if (tableGridObjs.length > 1) {
    tableGridObjs.sort((a, b) => (a.w * a.h) - (b.w * b.h));
    const primary = tableGridObjs[0];
    for (let i = 1; i < tableGridObjs.length; i++) {
      const other = tableGridObjs[i];
      primary.keep = [...new Set([...(primary.keep || []), ...(other.keep || [])])].sort((a, b) => a - b);
      primary._baseKeep = primary.keep.slice();
      other.deleted = true;
      place(other);
    }
    tableGridObjs.length = 1;
  }

  const mainGrid = tableGridObjs[0]; T.mainGrid = mainGrid;
  T.bodyBoxSrc = null;
  if (sideTapeGfx.size > 0 && an && an.atoms && an.atoms.gfx && mainGrid && mainGrid.keep && mainGrid.keep.length) {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const gi of mainGrid.keep) {
      const b = an.atoms.gfx[gi]?.b;
      if (!b) continue;
      if (b.x0 < bx0) bx0 = b.x0;
      if (b.y0 < by0) by0 = b.y0;
      if (b.x1 > bx1) bx1 = b.x1;
      if (b.y1 > by1) by1 = b.y1;
    }
    if (Number.isFinite(bx0) && bx1 > bx0 && by1 > by0) T.bodyBoxSrc = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
  }
  const existingSpec = mainGrid && mainGrid.edit && mainGrid.edit.tableSpec ? mainGrid.edit.tableSpec : null;
  setupTableSlots(T, { isTableStructureGfx, tableGridObjs, outerDialogueObjs, nonTableSecs });
}
