// Düzenle editor - object elements and text sections: preview rendering/placement of stage objects, page/grow limits, collecting the text sections in reading order, wiring object pointer handlers.
// Part of areaEditor.js: runs inside openAreaEditor(); `T` is the shared editor state built there.
import { h } from '../common/dom.js';
import { t } from '../../i18n/i18n.js';
import { icon } from '../../../assets/icons/icons.js';
import { renderPartPreview } from '../../engines/render/preview.js';
import { openAllModels } from '../../engines/text/editSession.js';
import { isBlankText } from '../../engines/text/blank.js';
import { clone } from './areaEditorShared.js';
import { bindOcrEnclosure } from './ae/aeOcr.js';

export function setupAreaObjects(T) {
  const {
    R, X, Y, an, ctx, dpr, guides, isUnit, objs, page, session, st, stage, syncSlotBox,
  } = T;
  Object.assign(T, {
    render, place, pageLimitRight, pageLimitLeft, computeMaxGrowX, computeMaxGrowY, computeMaxGrowLeft, wireObjEl, renderPlaceholderView,
  });

  function renderPlaceholderView(o) {
    o.placeholder = true;
    if (o.el) o.el.classList.add('ae-placeholder');
    o.canvas = null;
    if (o.view) {
      o.view.textContent = '';
      o.view.append(h('span', { html: icon('image', 'icon icon-sm') }), h('span', null, t('clickToReplace')));
    }
  }

  // ---------- object elements ----------
  // every non-text graphic can be cropped: it is drawn whole once and shows a window of it
  const cropable = (o) => ((o.type === 'photo' || o.type === 'deco' || o.type === 'box' || o.type === 'bg') && !o.nine && !o.clip && !!o.full && !(o.edit && (o.edit.delta || o.edit.deltaX || o.edit.deltaLeft || o.edit.tableSpec))) || (o.type === 'img' && !o.placeholder && !!o._rawImg); T.cropable = cropable;
  const partOf = (o) => ({
    id: o.id, obj: o.type, src: { ...(cropable(o) ? o.full : o.src) }, keep: o.keep, keepG: o.keepG,
    edit: o.edit || undefined, nine: o.nine || undefined, erase: o.erase || undefined, bgMode: o.bgMode || undefined, clip: o.clip || undefined,
    cell: o.cell || undefined, cellRight: o.cellRight || undefined, container: o.container || undefined,
    badge: o.badge || undefined, badgeBaseline: o.badgeBaseline ?? undefined, removedG: o.removedG || undefined,
    addedText: o.addedText || undefined, addedTable: o.addedTable || undefined, refGlyphIdx: o.refGlyphIdx, fontSize: o.fontSize, baseW: o.baseW,
    ocr: o.ocr || undefined, ocrGroup: o.ocrGroup || undefined, ocrPatchFlat: o.ocrPatchFlat || undefined, ocrBgHex: o.ocrBgHex || undefined, origLines: o.origLines || undefined, lineStep: o.lineStep || undefined,
    dw: cropable(o) ? o.full.w : (o.nine ? o.nine.w : o.dw), dh: cropable(o) ? o.full.h : (o.nine ? o.nine.h : o.dh),
    dx: 0, dy: 0, sc: 1,
  }); T.partOf = partOf;
  const scaleOf = (o) => o.w / (o.nine ? o.nine.w : o.dw); T.scaleOf = scaleOf;

  const jobs = new Map();
  async function render(o) {
    if (o.type === 'img' || o.deleted) return;
    const part = partOf(o);
    const s = scaleOf(o) * T.k * dpr * 1.25;
    // the same part at the same scale is already on the canvas: moving a cell
    // (column insert/delete, style change) must not rasterise it again
    const sig = JSON.stringify([part, s]);
    if (o.rendered && o._renderSig === sig) return jobs.get(o.id);
    const job = (jobs.get(o.id) || Promise.resolve()).then(async () => {
      // Uygula started: the previews still queued are never seen again
      if (T.st && T.st.applying) return;
      if (o.rendered && o._renderSig === sig) return;
      const c = document.createElement('canvas');
      try { await renderPartPreview(session, an, page, part, s, c, { transparent: true }); } catch (e) { console.error(e); return; }
      if (!o.canvas) { o.canvas = h('canvas'); o.view.textContent = ''; o.view.append(o.canvas); }
      o.canvas.width = c.width; o.canvas.height = c.height;
      const g = o.canvas.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.drawImage(c, 0, 0);
      o.rendered = true; o._renderSig = sig;
      place(o);
    });
    jobs.set(o.id, job);
    return job;
  }
  function place(o) {
    o.el.hidden = !!o.deleted;
    const soloOcrBg = !o.deleted && o.addedText && o.ocrBgHex && objs.every((u) => u === o || u.deleted);
    Object.assign(o.el.style, { left: X(o.x) + 'px', top: Y(o.y) + 'px', width: o.w * T.k + 'px', height: o.h * T.k + 'px', backgroundColor: soloOcrBg ? o.ocrBgHex : '' });
    if (cropable(o) && o.canvas) {
      const s = scaleOf(o) * T.k;
      Object.assign(o.canvas.style, { position: 'absolute', left: -(o.src.x - o.full.x) * s + 'px', top: -(o.src.y - o.full.y) * s + 'px', width: o.full.w * s + 'px', height: o.full.h * s + 'px' });
    } else if (o.canvas) {
      Object.assign(o.canvas.style, { position: 'static', width: '100%', height: '100%' });
    }
  }

  // ---------- collective text sections (all text groups in reading order) ----------
  const sections = []; T.sections = sections;
  // free page space to the right / below the object, limited by OTHER blocks of the page (never overlap them)
  function pageLimitRight(o) {
    let lim = (page.w || R.x + R.w) - 14;
    for (const b of page.blocks || []) {
      if ((ctx.ids || []).includes(b.id) || b.free) continue;
      const s = b.s || 1, bx = b.x, by = b.y, bw = b.bw * s, bh = b.bh * s;
      if (Math.min(by + bh, o.y + o.h) - Math.max(by, o.y) > 1 && bx >= o.x + o.w - 2) lim = Math.min(lim, bx - 4);
    }
    return lim;
  }
  const sideMargin = Math.min(52, Math.max(28, Math.round((page.w || R.x + R.w) * 0.085)));
  const blockBeyondMargin = R.x < sideMargin - 1 || (R.x + R.w) > (page.w || R.x + R.w) - sideMargin + 1;
  function oneFingerRightLimit(rect) {
    const rEdge = rect.x + rect.w;
    const effMargin = blockBeyondMargin ? 8 : sideMargin;
    const pageRight = Math.max(rEdge, (page.w || R.x + R.w) - effMargin);
    return Math.min(pageLimitRight(rect), pageRight);
  }
  function pageLimitLeft(o) {
    let lim = 8;
    for (const b of page.blocks || []) {
      if ((ctx.ids || []).includes(b.id) || b.free) continue;
      const s = b.s || 1, bx = b.x, by = b.y, bw = b.bw * s, bh = b.bh * s;
      if (Math.min(by + bh, o.y + o.h) - Math.max(by, o.y) > 1 && bx + bw <= o.x + 2) lim = Math.max(lim, bx + bw + 4);
    }
    return lim;
  }
  function pageLimitBelow(o) {
    let lim = (page.h || R.y + R.h) - 30;
    for (const b of page.blocks || []) {
      if ((ctx.ids || []).includes(b.id) || b.free) continue;
      const s = b.s || 1, bx = b.x, by = b.y, bw = b.bw * s;
      if (Math.min(bx + bw, o.x + o.w) - Math.max(bx, o.x) > 1 && by >= o.y + o.h - 2) lim = Math.min(lim, by - 3);
    }
    return lim;
  }
  function computeMaxGrowX(o, model) {
    if (model.badge) return 0;
    if (o.cell && o.cell.col != null && (o._cellInnerW || o.maxColWidthSrc)) {
      const lim = Math.max(o._cellInnerW || 0, o.maxColWidthSrc || 0);
      return Math.max(0, lim - (o.baseW || o._base.src.w) + 2);
    }
    if (o._rowCard) {
      const card = o._rowCard;
      const scStart = scaleOf(o);
      const refObj = card.panel
        ? (card.panel._base || card.panel)
        : {
            x: Math.min(...card.rows.map((r) => r.text._base.x)),
            y: Math.min(...card.rows.map((r) => r.text._base.y)),
            w: card.cardRightEdgeUi - Math.min(...card.rows.map((r) => r.text._base.x)),
            h: Math.max(...card.rows.map((r) => r.text._base.y + r.text._base.h)) - Math.min(...card.rows.map((r) => r.text._base.y)),
          };
      const cardSet = card.memberSet;
      const extR = objs.filter((x) => !x.deleted && !x.ocrPatch && !cardSet.has(x) && Math.min(x.y + x.h, refObj.y + refObj.h) - Math.max(x.y, refObj.y) > 2 && x.x >= card.cardRightEdgeUi - 2);
      const limR = extR.length ? Math.min(...extR.map((x) => x.x)) - 4 : oneFingerRightLimit(refObj);
      const remSrc = Math.max(0, (limR - card.cardRightEdgeUi) / scStart);
      const baseDxSrc = (o._base && o._base.edit && o._base.edit.deltaX > 0) ? o._base.edit.deltaX : 0;
      return remSrc + baseDxSrc;
    }
    const scStart = scaleOf(o);
    const ob = o._base || o;
    const bx = ob.x, bw = ob.w, by = ob.y, bh = ob.h;
    if (o.ocr) {
      const origBaseUi = bx + (o.baseW || ob.src.w) * scStart;
      if (o._encBox && !o._encBox.deleted) {
        const u = o._encBox, ub = u._base || u, scU = ub.w / (ub.nine ? ub.nine.w : ub.dw);
        const sub = o._encSubBox || ub.src;
        const subRightUi = ub.x + (sub.x1 - ub.src.x) * scU;
        const insideRoom = Math.max(0, (subRightUi - origBaseUi - 2) / scStart);
        return insideRoom + (o._encGrowR || 0);
      }
      const ph = objs.find((p) => p !== o && !p.deleted && !p.ocrPatch && (p.type === 'photo' || p.type === 'img')
        && (bx + bw * 0.5) >= p.x && (bx + bw * 0.5) <= p.x + p.w
        && (by + bh * 0.5) >= p.y && (by + bh * 0.5) <= p.y + p.h);
      const limUi = ph ? (ph.x + ph.w - 4) : oneFingerRightLimit(ob);
      return Math.max(0, (limUi - origBaseUi) / scStart);
    }
    const rightSibs = objs.filter((x) => x !== o && !x.deleted && !x.ocrPatch && !isUnit(x) && (!o.cell || x.type === 'text') && Math.min(x.y + x.h, by + bh) - Math.max(x.y, by) > 2 && x.x + x.w > bx + bw && x.x >= bx + bw - 16);
    const encUnits = objs.filter((u) => {
      if (u === o || u.deleted || !isUnit(u)) return false;
      const ub = u._base || u;
      return bx >= ub.x - 2 && bx + bw <= ub.x + ub.w + 2 && by >= ub.y - 2 && by + bh <= ub.y + ub.h + 2;
    }).sort((a, b) => ((a._base ? a._base.w * a._base.h : a.w * a.h) - (b._base ? b._base.w * b._base.h : b.w * b.h)));
    const encUnit = encUnits[0] || null;
    const outerEnc = encUnits[1] || null;
    const hasOwnBox = !!(model.container && o.keep && o.keep.length);
    if (o.cell && o.cell.col != null && rightSibs.length) {
      const rightMarginUi = pageLimitRight(o) - 18;
      const remColsW = rightSibs.reduce((s, r) => s + ((r._base ? r._base.w : r.w) + 6), 0);
      return Math.max(0, (rightMarginUi - remColsW - (bx + bw)) / scStart);
    }
    let rightCapSrc = null;
    if (rightSibs.length || encUnit) {
      const eb0 = encUnit ? (encUnit._base || encUnit) : null;
      const rightUi = Math.min(...rightSibs.map((x) => x.x), eb0 ? eb0.x + eb0.w : Infinity) - 4;
      if (Number.isFinite(rightUi)) {
        rightCapSrc = o._base.src.x + (rightUi - bx) / scStart;
        if (!hasOwnBox) model.area.right = Math.max(model.area.left + 10, Math.min(model.area.right, rightCapSrc));
      }
    }
    if (o.hasBorder || hasOwnBox) {
      const limitUi = rightSibs.length ? Math.min(...rightSibs.map((x) => x.x)) - 4 : (encUnit ? encUnit.x + encUnit.w - 4 : oneFingerRightLimit(ob));
      return Math.min(60, Math.max(0, (limitUi - (bx + bw)) / scStart));
    }
    if (encUnit && !rightSibs.length && !model.container && o.cell) {
      const eb = encUnit._base || encUnit;
      const isEdgeDecor = (x) => x.x >= eb.x + eb.w - 16 && x.x <= eb.x + eb.w + 24 && (x.type === 'img' || x.type === 'photo' || (x.w < 40 && x.h < 40));
      const extR = objs.filter((x) => !x.deleted && !x.ocrPatch && !isUnit(x) && !isEdgeDecor(x) && Math.min(x.y + x.h, eb.y + eb.h) - Math.max(x.y, eb.y) > 2 && x.x >= eb.x + eb.w - 2);
      const extL = objs.filter((x) => !x.deleted && !x.ocrPatch && !isUnit(x) && Math.min(x.y + x.h, eb.y + eb.h) - Math.max(x.y, eb.y) > 2 && x.x + x.w <= eb.x + 2);
      const limR = extR.length ? Math.min(...extR.map((x) => x.x)) - 4 : pageLimitRight(encUnit);
      const limL = extL.length ? Math.max(...extL.map((x) => x.x + x.w)) + 4 : pageLimitLeft(encUnit);
      const growR5 = Math.max(0, limR - (bx + bw)) / scStart;
      const pullL = Math.max(0, eb.x - limL) / scStart;
      o._encBox = encUnit; o._encGrowR = growR5; o._encPullL = pullL;
      return growR5 + pullL;
    }
    const baseRight = o._base.src.x + o._base.src.w - 0.3;
    return (o.cell || o.cellRight || model.container || rightSibs.length)
      ? Math.max(0, model.container ? 0 : ((rightCapSrc ?? model.area.right) - baseRight))
      : Infinity;
  }

  function computeMaxGrowY(o, model) {
    if (model.badge) return 0;
    return Infinity;
  }

  function computeMaxGrowLeft(o, model) {
    const hasOwnBox = !!(model.container && o.keep && o.keep.length);
    if (!model.badge && !o.hasBorder && !hasOwnBox) return 0;
    const scStart = scaleOf(o);
    const bx = (o._base ? o._base.x : o.x), bw = (o._base ? o._base.w : o.w);
    const leftSibs = objs.filter((x) => x !== o && !x.deleted && !x.ocrPatch && !isUnit(x) && Math.min(x.y + x.h, o.y + o.h) - Math.max(x.y, o.y) > 2 && x.x < bx && x.x + x.w <= bx + 16);
    const encUnit = objs.find((u) => u !== o && u !== o._badgeBgObj && !u.deleted && isUnit(u) && o.x >= u.x - 2 && o.x + o.w <= u.x + u.w + 2 && o.y >= u.y - 2 && o.y + o.h <= u.y + u.h + 2);
    const leftUi = leftSibs.length
      ? Math.max(...leftSibs.map((x) => x.x + x.w)) + 4
      : (encUnit ? encUnit.x + 4 : pageLimitLeft(o));
    const avail = Math.max(0, (bx - leftUi) / scStart);
    return model.badge ? Math.min(20, avail) : Math.min(38, avail);
  }

  for (const o of objs) {
    if (!o._base) {
      const prevDl = (o.edit && o.edit.deltaLeft > 0.01) ? o.edit.deltaLeft : 0;
      const scB = scaleOf(o);
      const baseSrc = o.src ? { ...o.src } : null;
      let baseDw = o.dw, baseW = o.w, baseX = o.x;
      if (prevDl > 0 && baseSrc) {
        baseSrc.x += prevDl;
        if (o.addedText && o.badge && o.baseW) {
          baseSrc.w = o.baseW;
          baseDw = o.baseW;
        } else {
          baseSrc.w = Math.max(4, baseSrc.w - prevDl);
          baseDw = Math.max(4, baseDw - prevDl);
        }
        baseW = baseDw * scB;
        baseX += prevDl * scB;
      }
      o._base = { src: baseSrc, full: o.full ? { ...o.full } : null, keepG: (o.keepG || []).slice(), edit: o.edit ? clone(o.edit) : null, nine: o.nine ? { ...o.nine } : null, dw: baseDw, dh: o.dh, w: baseW, h: o.h, x: baseX, y: o.y };
    }
    if (o.badge && o.addedText && o.container && !o._badgeBgObj) {
      const bgHit = objs.find((u) => u !== o && !u.deleted && (u.type === 'deco' || u.type === 'bg')
        && u.keep && u.keep.length && u.w <= 72 && u.h <= 36
        && Math.min(u.x + u.w, o.x + o.w) > Math.max(u.x, o.x) - 2
        && Math.min(u.y + u.h, o.y + o.h) > Math.max(u.y, o.y) - 2);
      if (bgHit) { o._badgeBgObj = bgHit; bgHit._badgeContainer = { ...o.container }; }
    }
  }
  for (const o of objs) {
    if (!o.ocr || o.deleted) continue;
    if (o.ocrGroup) {
      const ps = objs.filter((p) => p !== o && p.ocrPatch && !p.deleted && p.ocrGroup === o.ocrGroup);
      for (const p of ps) { p._ocrOwner = o; if (!p._base) p._base = { x: p.x, y: p.y, w: p.w, h: p.h }; }
      if (ps.length) { o.ocrPatchObjs = ps; o.ocrPatchObj = ps[0]; }
    }
    bindOcrEnclosure(o, objs, an, R, { isUnit, pageLimitRight, pageLimitLeft, scaleOf });
  }
  function buildRowCards() {
    const roleDecos = objs.filter((o) => !o.deleted && o.type === 'deco' && (o.rowRole === 'answerBar' || o.rowRole === 'sideBox'));
    if (!roleDecos.length) return;
    const panels = objs.filter((u) => !u.deleted && u.type === 'bg');
    const inPanel = (p, o) => {
      const pb = p._base, ob = o._base;
      const cxO = ob.x + ob.w * 0.5, cyO = ob.y + ob.h * 0.5;
      return cxO >= pb.x - 4 && cxO <= pb.x + pb.w + 4 && cyO >= pb.y - 4 && cyO <= pb.y + pb.h + 4;
    };
    const groups = new Map();
    for (const d of roleDecos) {
      const p = panels.find((u) => inPanel(u, d)) || null;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(d);
    }
    for (const [panel, items] of groups) {
      const bars = items.filter((x) => x.rowRole === 'answerBar');
      const boxes = items.filter((x) => x.rowRole === 'sideBox');
      let rowTexts;
      if (panel) {
        const pb = panel._base;
        rowTexts = objs.filter((x) => !x.deleted && x.type === 'text' && !x.badge && !(x.cell && x.cell.col != null)
          && (x._base.x + x._base.w * 0.5) >= pb.x - 2 && (x._base.x + x._base.w * 0.5) <= pb.x + pb.w + 2
          && (x._base.y + x._base.h * 0.5) >= pb.y - 2 && (x._base.y + x._base.h * 0.5) <= pb.y + pb.h + 2);
      } else {
        const minY = Math.min(...items.map((x) => x._base.y)) - 24;
        const maxY = Math.max(...items.map((x) => x._base.y + x._base.h)) + 24;
        const minX = Math.min(...items.map((x) => x._base.x));
        const maxX = Math.max(...items.map((x) => x._base.x + x._base.w));
        rowTexts = objs.filter((x) => !x.deleted && x.type === 'text' && !x.badge && !(x.cell && x.cell.col != null)
          && x._base.y + x._base.h >= minY && x._base.y <= maxY
          && x._base.x < maxX + 100 && x._base.x + x._base.w > minX - 100);
      }
      rowTexts.sort((a, b) => a._base.y - b._base.y);
      if (!rowTexts.length) continue;
      const rows = rowTexts.map((text) => ({ text, bars: [], boxes: [] }));
      for (const bar of bars) {
        let hit = rows[0];
        for (const r of rows) {
          if (r.text._base.y <= bar._base.y + 4) hit = r;
          else break;
        }
        hit.bars.push(bar);
      }
      for (const box of boxes) {
        const cyB = box._base.y + box._base.h * 0.5;
        let bestR = rows[0], bestD = Infinity;
        for (const r of rows) {
          const rTop = r.text._base.y;
          const rEnd = Math.max(rTop + r.text._base.h, ...r.bars.map((b) => b._base.y + b._base.h));
          const mid = (rTop + r.text._base.h + rTop) * 0.5;
          const d = Math.max(rTop - cyB, 0, cyB - rEnd) + Math.abs(cyB - mid) * 0.01;
          if (d < bestD) { bestD = d; bestR = r; }
        }
        bestR.boxes.push(box);
      }
      const rightBoxes = boxes.filter((b) => b.sideEdge === 'right');
      const minPadL = panel ? Math.max(4, Math.min(...rowTexts.map((t) => t._base.x - panel._base.x))) : 4;
      const innerRightUi = rightBoxes.length
        ? Math.min(...rightBoxes.map((b) => b._base.x)) - 5
        : (panel ? panel._base.x + panel._base.w - minPadL : null);
      const cardRightEdgeUi = Math.max(
        panel ? panel._base.x + panel._base.w : -Infinity,
        ...boxes.map((b) => b._base.x + b._base.w),
        ...bars.map((b) => b._base.x + b._base.w),
        ...rowTexts.map((t) => t._base.x + t._base.w),
      );
      const memberSet = new Set([panel, ...rowTexts, ...bars, ...boxes].filter(Boolean));
      const baseCardDxUi = Math.max(0, ...rowTexts.map((t) => ((t._base.edit && t._base.edit.deltaX > 0) ? t._base.edit.deltaX * scaleOf(t) : 0)));
      const card = { panel, rows, bars, boxes, innerRightUi, cardRightEdgeUi, memberSet, baseCardDxUi };
      if (panel) panel._rowCard = card;
      for (const r of rows) r.text._rowCard = card;
    }
  }
  buildRowCards();
  for (const o of objs) {
    if (o.deleted || o.type !== 'text' || (!o.addedText && (!o.keepG || !o.keepG.length || !an))) continue;
    const origPart = partOf(o);
    if (o.edit && o.edit.deltaLeft > 0.01 && o._base && o._base.src) {
      origPart.src = { ...o._base.src };
      origPart.dw = o._base.dw;
    }
    o._origPart = origPart;
    const models = openAllModels(an, origPart);
    const sc0 = scaleOf(o);
    for (const model of models) {
      if (o.cell && !model.cell) model.cell = { ...o.cell };
      if (o._rowCard) {
        model.sharedPanel = true;
        if (o._rowCard.innerRightUi != null) {
          const origInnerRightUi = o._rowCard.innerRightUi - o._rowCard.baseCardDxUi;
          const innerRightSrc = o._base.src.x + (origInnerRightUi - o._base.x) / sc0;
          const origMaxRight = model.lines.length ? Math.max(...model.lines.map((l) => l.right)) : model.area.right;
          model.area.right = Math.max(model.area.left + 20, origMaxRight, innerRightSrc);
        }
      }
      // a stray glyph group with nothing readable (e.g. an invisible Symbol-font list mark
      // beside a framed box, or a lone space) must not become its own editor cell/column;
      // the object stays on the stage untouched. Real table cells keep their slot.
      if (!o.addedText && !model.badge && !model.cell && isBlankText(model.text)) continue;
      const maxGrowX = computeMaxGrowX(o, model);
      const maxGrowLeft = computeMaxGrowLeft(o, model);
      const maxGrowY = computeMaxGrowY(o, model);
      const sec = {
        o, model, badge: !!model.badge, maxGrowX, maxGrowLeft, maxGrowY,
        y: o.y + (model.area.top - o.src.y) * sc0,
        x: o.x + (model.area.left - o.src.x) * sc0,
      };
      sections.push(sec);
    }
  }
  sections.sort((a, b) => {
    const ca = a.model && a.model.cell, cb = b.model && b.model.cell;
    const ga = ca ? (ca.gridRow ?? ca.row) : null;
    const gb = cb ? (cb.gridRow ?? cb.row) : null;
    if (ga != null && gb != null && a.o !== b.o) {
      if (Math.abs(a.y - b.y) < 80) return ga !== gb ? ga - gb : ca.col - cb.col;
    }
    return Math.abs(a.y - b.y) < 12 ? a.x - b.x : a.y - b.y;
  });

  function wireObjEl(o) {
    o.el.addEventListener('pointerdown', (e) => st.onDown(e, o));
    o.el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (o.type === 'img' || (o.type === 'photo' && o.full && (o.full.w > o.src.w + 1 || o.full.h > o.src.h + 1))) {
        if (st.panMode === o) st.exitPanMode();
        else st.enterPanMode(o);
        return;
      }
      const hit = sections.find((s) => s.o === o);
      if (hit && hit.ed) { hit.ed.el.scrollIntoView({ block: 'nearest' }); hit.ed.focusEnd(); }
    });
  }
  for (const o of objs) {
    const cls = 'ae-obj ae-' + o.type + (o.ocrPatch ? ' ae-ocr-patch' : '') + (o.ocr ? ' ae-ocr-text' : '');
    o.el = h('div', { class: cls, 'data-testid': o.ocrPatch ? 'ae-ocr-patch' : 'ae-obj', 'data-type': o.type, 'data-oid': o.id });
    o.view = h('div', { class: 'ae-view' });
    o.el.append(o.view);
    if (o.type === 'img') {
      if (o.placeholder || (o.img && o.img.placeholder) || !(o.img && o.img.dataUrl)) {
        renderPlaceholderView(o);
      } else if (o.img && o.img.rawDataUrl && o.img.crop) {
        const crop = o.img.crop;
        o._crop = { ...crop };
        const rawIm = new Image();
        rawIm.src = o.img.rawDataUrl;
        o._rawImg = { dataUrl: o.img.rawDataUrl, im: rawIm, w: rawIm.naturalWidth || crop.iw, h: rawIm.naturalHeight || crop.ih };
        rawIm.onload = () => { if (o._rawImg) { o._rawImg.w = rawIm.naturalWidth; o._rawImg.h = rawIm.naturalHeight; } };
        const imEl = h('img', { src: o.img.rawDataUrl, draggable: 'false' });
        Object.assign(imEl.style, {
          position: 'absolute',
          left: (crop.ox / o.w) * 100 + '%',
          top: (crop.oy / o.h) * 100 + '%',
          width: (crop.iw / o.w) * 100 + '%',
          height: (crop.ih / o.h) * 100 + '%',
          maxWidth: 'none', maxHeight: 'none',
        });
        o.view.append(imEl);
      } else {
        const im = h('img', { src: o.img.dataUrl, draggable: 'false' });
        o.view.append(im);
      }
    } else { o.canvas = h('canvas'); o.view.append(o.canvas); }
    wireObjEl(o);
    stage.append(o.el);
  }
  stage.append(guides);
  objs.forEach(place);
  syncSlotBox();
  const ready = Promise.all(objs.map(render)); T.ready = ready;
}
