// Helpers for "Metin tara" (OCR) inside the Düzenle area editor:
// binds each OCR text item to its enclosing shape/sub-box (deco/bg), and keeps
// the container's slices + sibling positions synchronized when text grows/shrinks.
import { clone } from '../areaEditorShared.js';

const boxArea = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const boxIn = (o, i, t = 3) => i.x0 >= o.x0 - t && i.y0 >= o.y0 - t && i.x1 <= o.x1 + t && i.y1 <= o.y1 + t;

export function findSubBox(u, cxSrc, cySrc, minW, minH, an) {
  const gfx = an && an.atoms && an.atoms.gfx;
  if (!gfx || !u || !Array.isArray(u.keep) || !u.keep.length) return null;
  const cands = [];
  for (const gi of u.keep) {
    const g = gfx[gi];
    if (!g || g.kind !== 'path' || !(g.fill || g.stroke)) continue;
    const b = g.b;
    if (cxSrc < b.x0 - 2 || cxSrc > b.x1 + 2 || cySrc < b.y0 - 2 || cySrc > b.y1 + 2) continue;
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    if (bw < Math.max(8, minW * 0.55) || bh < Math.max(8, minH * 0.55)) continue;
    cands.push({ g, b, area: boxArea(b) });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.area - b.area);
  const g0 = cands[0];
  let ub = { ...g0.b };
  for (const c of cands) {
    if (c === g0) continue;
    if (c.area <= g0.area * 1.35 && boxIn(ub, c.b, 3)) {
      ub = { x0: Math.min(ub.x0, c.b.x0), y0: Math.min(ub.y0, c.b.y0), x1: Math.max(ub.x1, c.b.x1), y1: Math.max(ub.y1, c.b.y1) };
    }
  }
  return ub;
}

export function bindOcrEnclosure(o, objs, an, R, { isUnit, pageLimitRight, pageLimitLeft, scaleOf }) {
  if (!o || o.deleted) return null;
  const ob = o._base || o;
  const cxO = ob.x + ob.w * 0.5, cyO = ob.y + ob.h * 0.5;
  const units = objs.filter((u) => {
    if (!u || u === o || u.deleted || !isUnit(u)) return false;
    const ub = u._base || u;
    if (cxO < ub.x - 4 || cxO > ub.x + ub.w + 4 || cyO < ub.y - 4 || cyO > ub.y + ub.h + 4) return false;
    const ovX = Math.min(ob.x + ob.w, ub.x + ub.w) - Math.max(ob.x, ub.x);
    const ovY = Math.min(ob.y + ob.h, ub.y + ub.h) - Math.max(ob.y, ub.y);
    return ovX > Math.min(ob.w, ub.w) * 0.45 && ovY > Math.min(ob.h, ub.h) * 0.45;
  }).sort((a, b) => {
    const ab = a._base || a, bb = b._base || b;
    return (ab.w * ab.h) - (bb.w * bb.h);
  });
  const u = units[0] || null;
  if (!u) {
    o._encBox = null;
    o._encSubBox = null;
    return null;
  }
  const ub = u._base || u;
  const scU = ub.w / (ub.nine ? ub.nine.w : ub.dw);
  const cxSrc = ub.src.x + (cxO - ub.x) / scU;
  const cySrc = ub.src.y + (cyO - ub.y) / scU;
  const subBox = findSubBox(u, cxSrc, cySrc, ob.w / scU, ob.h / scU, an) || { x0: ub.src.x, y0: ub.src.y, x1: ub.src.x + ub.src.w, y1: ub.src.y + ub.src.h };
  const sc0 = scaleOf(o);
  const limR = pageLimitRight ? pageLimitRight(u) : (R.x + R.w);
  const limL = pageLimitLeft ? pageLimitLeft(u) : 8;
  o._encBox = u;
  o._encSubBox = subBox;
  o.container = { ...subBox };
  if (o._origPart) o._origPart.container = { ...subBox };
  o._encGrowR = Math.max(0, (limR - (ub.x + ub.w)) / sc0);
  o._encPullL = Math.max(0, (ub.x - limL) / sc0);
  return u;
}

export function ocrPatchesOf(o) {
  if (!o) return [];
  if (Array.isArray(o.ocrPatchObjs) && o.ocrPatchObjs.length) return o.ocrPatchObjs;
  return o.ocrPatchObj ? [o.ocrPatchObj] : [];
}

// Remove original PDF glyphs (and tiny letter-shaped paths inside vector art) directly
// behind an OCR seed so expanding the box or applying edits never leaves ghost text below.
export function suppressUnderlyingOcrText(o, sdBox, objs, an, { isUnit, scaleOf, place, render }) {
  if (!o || !sdBox || !an) return;
  const box = { x0: sdBox.x - 1.5, y0: sdBox.y - 1.5, x1: sdBox.x + sdBox.w + 1.5, y1: sdBox.y + sdBox.h + 1.5 };
  const glyphs = (an.seg && an.seg.glyphs) || [];
  for (const x of objs) {
    if (!x || x === o || x.deleted || x.addedText || x.ocr || x.type !== 'text' || !Array.isArray(x.keepG) || !x.keepG.length) continue;
    const scX = scaleOf(x), rem = [], kept = [];
    for (const gi of x.keepG) {
      const g = glyphs[gi];
      if (g && !g.space && g.b) {
        const gx = x.x + ((g.b.x0 + g.b.x1) * 0.5 - x.src.x) * scX;
        const gy = x.y + ((g.b.y0 + g.b.y1) * 0.5 - x.src.y) * scX;
        if (gx >= box.x0 && gx <= box.x1 && gy >= box.y0 && gy <= box.y1) { rem.push(gi); continue; }
      }
      kept.push(gi);
    }
    if (!rem.length) continue;
    x.keepG = kept;
    x.removedG = [...new Set([...(x.removedG || []), ...rem])];
    (o._suppressedG ||= []).push({ oid: x.id, glyphs: rem });
    if (!kept.some((gi) => glyphs[gi] && !glyphs[gi].space)) { x.deleted = true; place(x); }
    else render(x);
  }
  const gfx = (an.atoms && an.atoms.gfx) || [];
  const boxW = box.x1 - box.x0, boxH = box.y1 - box.y0, sArea = boxW * boxH;
  for (const u of objs) {
    if (!u || u.deleted || !isUnit(u) || !Array.isArray(u.keep) || !u.keep.length) continue;
    const ub = u._base || u, scU = ub.w / (ub.nine ? ub.nine.w : ub.dw);
    const sBox = { x0: ub.src.x + (box.x0 - ub.x) / scU, y0: ub.src.y + (box.y0 - ub.y) / scU, x1: ub.src.x + (box.x1 - ub.x) / scU, y1: ub.src.y + (box.y1 - ub.y) / scU };
    const sbW = sBox.x1 - sBox.x0, sbH = sBox.y1 - sBox.y0, remK = [], keptK = [];
    for (const gi of u.keep) {
      const g = gfx[gi];
      const hit = g && g.kind === 'path' && boxIn(sBox, g.b, 1.5) && boxArea(g.b) < sArea * 0.55 / (scU * scU) && (g.b.x1 - g.b.x0) < sbW * 0.72 && (g.b.y1 - g.b.y0) <= sbH + 1.5;
      if (hit) remK.push(gi); else keptK.push(gi);
    }
    if (!remK.length) continue;
    u.keep = keptK;
    (o._suppressedK ||= []).push({ oid: u.id, gfx: remK });
    render(u);
  }
}

export function restoreSuppressedOcrText(o, objs, { place, render }) {
  if (!o) return;
  for (const rec of o._suppressedG || []) {
    const x = objs.find((z) => z.id === rec.oid);
    if (!x) continue;
    const rmSet = new Set(rec.glyphs);
    x.keepG = [...new Set([...(x.keepG || []), ...rec.glyphs])].sort((a, b) => a - b);
    x.removedG = (x.removedG || []).filter((gi) => !rmSet.has(gi));
    x.deleted = false; place(x); render(x);
  }
  for (const rec of o._suppressedK || []) {
    const u = objs.find((z) => z.id === rec.oid);
    if (!u) continue;
    u.keep = [...new Set([...(u.keep || []), ...rec.gfx])].sort((a, b) => a - b);
    u.deleted = false; place(u); render(u);
  }
}

const rgbHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

export function applySectionBoxStyle(sec, an, scaleOf, inkHex) {
  if (!sec || !sec.o || !sec.ed || !sec.ed.paper || sec.badge) return;
  const { o, ed, model } = sec;
  const isCell = !!(model && model.cell);
  const wUi = o._base ? o._base.w : o.w;
  const lineCnt = (model && model.paras ? model.paras.length : 1);
  const soloRow = !sec.rowEl || sec.rowEl.querySelectorAll('.te-paper-wrap').length === 1;
  if (!isCell && soloRow && wUi < 290 && lineCnt <= 3 && (o.ocr || o.addedText || o._encBox || o.hasBorder || (model && model.container && !model.sharedPanel))) {
    ed.el.classList.add('te-compact-box');
  }
  const applyOnDarkFallback = () => {
    const c = inkHex || (model && model.paras && model.paras[0] && model.paras[0].runs && model.paras[0].runs[0] && model.paras[0].runs[0].c);
    if (c && /^#[0-9a-f]{6}$/i.test(c)) {
      const v = parseInt(c.slice(1), 16);
      if (0.3 * (v >> 16) + 0.59 * ((v >> 8) & 255) + 0.11 * (v & 255) > 185) ed.el.classList.add('te-on-dark');
    }
  };
  let bgHex = o.ocrBgHex || null;
  if (!bgHex && an && an.atoms && an.atoms.gfx) {
    const u = o._encBox, ob = o._base || o;
    const idxs = [...(o.keep || []), ...(u && u.keep ? u.keep : [])];
    const refObj = u || o, rb = refObj._base || refObj, sc = scaleOf(refObj);
    const cxSrc = rb.src.x + ((ob.x + ob.w * 0.5) - rb.x) / sc, cySrc = rb.src.y + ((ob.y + ob.h * 0.5) - rb.y) / sc;
    const cands = idxs.map((gi) => an.atoms.gfx[gi]).filter((g) => g && g.kind === 'path' && g.fill && g.rgb && Math.min(...g.rgb) < 238
      && cxSrc >= g.b.x0 - 2 && cxSrc <= g.b.x1 + 2 && cySrc >= g.b.y0 - 2 && cySrc <= g.b.y1 + 2 && boxArea(g.b) < rb.src.w * rb.src.h * 1.1)
      .sort((a, b) => boxArea(a.b) - boxArea(b.b));
    if (cands[0]) bgHex = rgbHex(cands[0].rgb);
  }
  if (!bgHex || !/^#[0-9a-f]{6}$/i.test(bgHex)) { applyOnDarkFallback(); return; }
  const n = parseInt(bgHex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (Math.min(r, g, b) >= 242) { applyOnDarkFallback(); return; }
  ed.paper.style.backgroundColor = bgHex;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum <= 165) {
    ed.el.classList.add('te-bg-dark');
    ed.paper.style.borderColor = 'rgba(15,23,42,.38)';
    ed.paper.style.caretColor = '#fff';
  } else {
    ed.el.classList.remove('te-bg-dark', 'te-on-dark');
    ed.paper.style.borderColor = 'rgba(15,23,42,.18)';
    ed.paper.style.caretColor = '#0f172a';
  }
}

function mergeAxisCuts(raw, tol = 6) {
  if (!raw.length) return [];
  const sorted = raw.slice().sort((a, b) => a.cut - b.cut);
  const out = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && (cur.cut <= last.cut + tol || (cur.sub && last.sub && Math.min(cur.subMax, last.subMax) > Math.max(cur.subMin, last.subMin) + 2))) {
      if (cur.deltaSrc > last.deltaSrc) {
        last.deltaSrc = cur.deltaSrc;
        last.cut = cur.cut;
        last.strip = cur.strip;
      }
      last.subMin = Math.min(last.subMin, cur.subMin);
      last.subMax = Math.max(last.subMax, cur.subMax);
      last.owners.add(cur.owner);
    } else {
      out.push({ ...cur, owners: new Set([cur.owner]) });
    }
  }
  return out;
}

export async function syncOcrEnclosures({ objs, isUnit, scaleOf, place, render, renderPreview = true }) {
  const unitSet = new Set();
  for (const o of objs) {
    if (o && o.ocr && o._encBox && !o._encBox.deleted) unitSet.add(o._encBox);
  }
  if (!unitSet.size) return;
  const renderQueue = [];
  for (const u of unitSet) {
    const ts = objs.filter((t) => t && t.ocr && t._encBox === u);
    if (!ts.length) continue;
    const ub = u._base || u;
    const scU = ub.w / (ub.nine ? ub.nine.w : ub.dw);
    if (u._origEdit === undefined) u._origEdit = ub.edit ? clone(ub.edit) : null;
    const rawH = [], rawV = [];
    for (const t of ts) {
      if (t.deleted || !t.edit) continue;
      const tb = t._base || t;
      const sub = t._encSubBox || { x0: ub.src.x, y0: ub.src.y, x1: ub.src.x + ub.src.w, y1: ub.src.y + ub.src.h };
      const subRightUi = ub.x + (sub.x1 - ub.src.x) * scU;
      const subBotUi = ub.y + (sub.y1 - ub.src.y) * scU;
      const padR = Math.max(2, Math.min(8, subRightUi - (tb.x + tb.w)));
      const padB = Math.max(1, Math.min(6, subBotUi - (tb.y + tb.h)));
      const effRightUi = Math.max(subRightUi, tb.x + tb.w + padR);
      const effBotUi = Math.max(subBotUi, tb.y + tb.h + padB);
      const needX = (tb.x + t.w + padR) - effRightUi;
      const needY = (tb.y + t.h + padB) - effBotUi;
      if (t.w > tb.w + 0.5 && needX > 0.5) {
        const capX = (t._encGrowR || 0) * scaleOf(t);
        const dxUi = capX > 0 ? Math.min(needX, capX) : needX;
        if (dxUi > 0.5) {
          const cutX = Math.max(sub.x0 + 2, Math.min(sub.x1 - 2, (sub.x0 + sub.x1) * 0.5));
          const stripW = Math.max(1, Math.min(4, (sub.x1 - sub.x0) * 0.22));
          rawH.push({ cut: cutX, strip: stripW, deltaSrc: dxUi / scU, subMin: sub.x0, subMax: sub.x1, sub: true, owner: t });
        }
      }
      if (t.h > tb.h + 0.5 && needY > 0.5) {
        const yCut = Math.max(sub.y0 + 2, Math.min(sub.y1 - 2, (sub.y0 + sub.y1) * 0.5));
        const stripH = Math.max(1, Math.min(4, (sub.y1 - sub.y0) * 0.22));
        rawV.push({ cut: yCut, strip: stripH, deltaSrc: needY / scU, subMin: sub.y0, subMax: sub.y1, sub: true, owner: t });
      }
    }
    const hCuts = mergeAxisCuts(rawH, 4);
    const vCuts = mergeAxisCuts(rawV, 6);
    let totalDxSrc = hCuts.reduce((s, c) => s + c.deltaSrc, 0);
    const maxDxCap = ts.reduce((m, t) => Math.min(m, ((t._encGrowR || 0) * scaleOf(t)) / scU), Infinity);
    if (Number.isFinite(maxDxCap) && totalDxSrc > maxDxCap && totalDxSrc > 0) {
      const ratio = maxDxCap / totalDxSrc;
      for (const c of hCuts) c.deltaSrc *= ratio;
      totalDxSrc = maxDxCap;
    }
    const totalDySrc = vCuts.reduce((s, c) => s + c.deltaSrc, 0);
    if (totalDxSrc <= 0.05 && totalDySrc <= 0.05 && !u._hasOcrEdit) continue;
    if (u.type === 'bg') {
      if (totalDxSrc > 0.05 || totalDySrc > 0.05) {
        u.nine = { w: ub.src.w + totalDxSrc, h: ub.src.h + totalDySrc };
        u.dw = u.nine.w; u.dh = u.nine.h;
      } else {
        u.nine = ub.nine ? { ...ub.nine } : null;
        u.dw = ub.dw; u.dh = ub.dh;
      }
    } else if (totalDxSrc <= 0.05 && totalDySrc <= 0.05) {
      u.edit = u._origEdit ? clone(u._origEdit) : null;
      u.dw = ub.dw; u.dh = ub.dh;
    } else {
      const nextEdit = { ...(u._origEdit ? clone(u._origEdit) : {}), removeGlyphs: [], runs: [] };
      if (hCuts.length === 1) {
        nextEdit.deltaX = totalDxSrc;
        nextEdit.cutX = hCuts[0].cut;
      } else if (hCuts.length > 1) {
        nextEdit.deltaX = totalDxSrc;
        nextEdit.colCuts = hCuts.map((c) => ({ x0: c.cut - c.strip, x1: c.cut, delta: c.deltaSrc }));
      }
      if (vCuts.length === 1) {
        nextEdit.delta = totalDySrc;
        nextEdit.oldBottom = vCuts[0].cut;
        nextEdit.stripH = vCuts[0].strip;
      } else if (vCuts.length > 1) {
        nextEdit.delta = totalDySrc;
        nextEdit.cuts = vCuts.map((c) => ({ y0: c.cut - c.strip, y1: c.cut, delta: c.deltaSrc }));
      }
      u.edit = nextEdit;
      u.dw = ub.src.w + totalDxSrc;
      u.dh = ub.src.h + totalDySrc;
    }
    u.w = u.dw * scU;
    u.h = u.dh * scU;
    u._hasOcrEdit = totalDxSrc > 0.05 || totalDySrc > 0.05;
    place(u);
    if (renderPreview) renderQueue.push(render(u));

    // Reposition OCR children, their patches, and right/lower sibling elements inside or attached to u
    const totalDxUi = totalDxSrc * scU;
    for (const x of objs) {
      if (x === u || x.deleted || !x._base || isUnit(x)) continue;
      const xb = x._base;
      const inHorizBand = Math.min(xb.y + xb.h, ub.y + ub.h) - Math.max(xb.y, ub.y) > 2;
      const insideU = (xb.x + xb.w * 0.5) >= ub.x - 4 && (xb.x + xb.w * 0.5) <= ub.x + ub.w + 4
        && (xb.y + xb.h * 0.5) >= ub.y - 4 && (xb.y + xb.h * 0.5) <= ub.y + ub.h + 4;
      const rightEdgeAttach = xb.x >= ub.x + ub.w - 16 && xb.x <= ub.x + ub.w + 24 && inHorizBand
        && (x.type === 'img' || x.type === 'photo' || (xb.w < 40 && xb.h < 40));
      let sx = 0, sy = 0;
      if (rightEdgeAttach) {
        sx = totalDxUi;
      } else if (x.ocrPatch && x._ocrOwner) {
        const own = x._ocrOwner;
        for (const c of hCuts) {
          if (c.owners.has(own)) continue;
          const cutUi = ub.x + (c.cut - ub.src.x) * scU;
          if ((xb.x + xb.w * 0.5) > cutUi + 2) sx += c.deltaSrc * scU;
        }
        for (const c of vCuts) {
          if (c.owners.has(own)) continue;
          const cutUi = ub.y + (c.cut - ub.src.y) * scU;
          if ((xb.y + xb.h * 0.5) > cutUi + 2) sy += c.deltaSrc * scU;
        }
      } else if (insideU && x.ocr) {
        for (const c of hCuts) {
          if (c.owners.has(x)) continue;
          const cutUi = ub.x + (c.cut - ub.src.x) * scU;
          if ((xb.x + xb.w * 0.5) > cutUi + 2) sx += c.deltaSrc * scU;
        }
        for (const c of vCuts) {
          if (c.owners.has(x)) continue;
          const cutUi = ub.y + (c.cut - ub.src.y) * scU;
          if ((xb.y + xb.h * 0.5) > cutUi + 2) sy += c.deltaSrc * scU;
        }
      } else if (!(x.cell && x.cell.col != null) && !x._rowCard) {
        for (const c of vCuts) {
          const cutUi = ub.y + (c.cut - ub.src.y) * scU;
          if (xb.y > cutUi + 2) sy += c.deltaSrc * scU;
        }
      }
      const dSx = sx - (x._ocrShiftX || 0);
      const dSy = sy - (x._ocrShiftY || 0);
      if (Math.abs(dSx) > 0.1 || Math.abs(dSy) > 0.1) {
        if (Math.abs(dSx) > 0.1) { x.x += dSx; x._ocrShiftX = sx; }
        if (Math.abs(dSy) > 0.1) { x.y += dSy; x._ocrShiftY = sy; }
        place(x);
      }
    }
  }
  if (renderQueue.length) await Promise.all(renderQueue);
}
