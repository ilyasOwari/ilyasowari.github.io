// Turns an edited text into a serialisable part edit: which original glyphs to
// remove, the new text runs (original font where possible) and box slices.
import { diffMap } from './diff.js';
import { resolveChars, layoutText, VK, vShift } from './layout.js';
import { styleKey } from './textModel.js';
import { styleSig, bgSig, hexToFill, glyphIsBold, glyphIsItalic, sizeFactor } from './richStyle.js';
import { checkBoxGeom } from './checkBoxOps.js';
import { parasFromText, perCharSigs, forcedBreaks, layoutOneLine } from './applyEditBreaks.js';

export { parasFromText };

export function computeEdit(model, newParas, ctx) {
  const oldText = model.text;
  const newText = newParas.map((p) => p.text).join('\n');
  const a = Array.from(oldText), b = Array.from(newText);
  const map = diffMap(a, b);
  const o = Array.from(model.origText ?? oldText);
  let firstDiff = 0;
  while (firstDiff < b.length && firstDiff < o.length && o[firstDiff] === b[firstDiff]) firstDiff++;
  // the first newly styled character counts as a change too (line breaks after it re-flow)
  {
    let acc = 0;
    // per-character comparison, so removing a style (bold off, colour back) counts as well
    newParas.forEach((p, pi) => {
      const initSig = model.initStSigs ? model.initStSigs[pi] : undefined;
      const n = Array.from(p.text).length;
      const cur = JSON.stringify(p.st || []);
      if (initSig === undefined ? (p.st && p.st.length) : cur !== initSig) {
        const a0 = perCharSigs(p.st, n);
        let init = [];
        try { init = initSig ? JSON.parse(initSig) : []; } catch (e) { init = []; }
        const b0 = perCharSigs(init, n);
        let at = a0.findIndex((v, i) => v !== b0[i]);
        if (at < 0) at = n ? n - 1 : 0;
        firstDiff = Math.min(firstDiff, acc + at);
      }
      acc += n + 1;
    });
  }
  const paras = resolveChars(model, newParas, map, ctx);
  const forced = forcedBreaks(model, newParas, firstDiff);
  const A0 = model.area;
  let ratio = 1;
  for (const ol of model.lines) {
    const gl = ol.glyphs.slice(ol.leadSpaces);
    while (gl.length && gl[gl.length - 1].space) gl.pop();
    if (gl.length < 8) continue;
    const sum = gl.reduce((s, x) => s + x.g.w0 * x.g.hsize, 0);
    const ext = ol.right - ol.left;
    if (ext > 0 && sum / ext > ratio) ratio = Math.min(1.06, sum / ext);
  }
  const A = { ...A0, right: model.lines.length > 1 ? A0.left + (A0.right - A0.left) * ratio + 0.3 : A0.right };
  model = { ...model, area: A };
  // free text (no container) may not run past its block unless there is room
  let freeGrowX = 0;
  if (!model.container && !model.sharedPanel && model.partSrc) {
    const srcR = model.partSrc.x + model.partSrc.w - 0.3;
    if (A.right > srcR) {
      const need = A.right - srcR;
      if (ctx.canGrowX && ctx.canGrowX(need)) freeGrowX = need;
      else {
        let lo = 0, hi = need;
        if (ctx.canGrowX) for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (ctx.canGrowX(mid)) lo = mid; else hi = mid; }
        freeGrowX = Math.max(0, lo - 0.3);
        A.right = srcR + freeGrowX;
      }
    }
  }
  const capacityBaseline = A.lastBaseline + 0.6;
  const lastOf = (L) => (L.lines.length ? L.lines[L.lines.length - 1].baseline : A.firstBaseline);
  const tailLsOf = (L) => {
    const last = L && L.lines && L.lines[L.lines.length - 1];
    if (!last || !last.items) return 0;
    return last.items.reduce((m, c) => (c.st && c.st.ls != null && c.st.ls !== 0 ? c.st.ls : m), 0) * (L.k || 1);
  };
  const isCell = !!(model.cell || model.cellRight || (model.container && !model.badge));
  const singleTight = newParas.length === 1 && ((model.lines.length === 1 && (model.cell || (model.container && (model.container.y1 - model.container.y0) < 2 * A.step))) || (model.badge && !!model.container && model.lines.length <= 1));
  const line0Sz = (model.lines[0] && model.lines[0].size) || model.fontSize || (model.refGlyph && model.refGlyph.g && model.refGlyph.g.hsize) || 10;
  let L, k = 1, grow = 0, growX = 0, growLeft = 0;
  let wrappedCell = false;
  if (singleTight && !wrappedCell) {
    const avail = A.right - A.left;
    const measure = (kk) => {
      const o = layoutOneLine(model, paras[0], kk, 0, growLeft, Math.max(0, growX));
      return o;
    };
    k = 1;
    let one = measure(1);
    if (one.width > avail + 0.3) {
      const need = one.width - avail + (model.badge ? 2.6 : 0.5);
      if (!model.badge && ctx.canGrowX) {
        if (ctx.canGrowX(need)) growX = need;
        else {
          let lo = 0, hi = need;
          for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (ctx.canGrowX(mid)) lo = mid; else hi = mid; }
          growX = lo > 1 ? lo - 0.3 : 0;
        }
      }
      // Step 2: if right side wasn't enough, check left free space before shrinking font
      const rem = need - growX;
      if (rem > 0.3 && ctx.canGrowLeft) {
        if (ctx.canGrowLeft(rem)) growLeft = rem;
        else {
          let lo = 0, hi = rem;
          for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (ctx.canGrowLeft(mid)) lo = mid; else hi = mid; }
          growLeft = lo > 1 ? lo - 0.3 : 0;
        }
      }
      if (growX || growLeft) one = measure(1);
    } else if (one.width < avail - 1.5 && model.container && !model.badge && !paras[0].align && ctx.canGrowX) {
      const minW = Math.max(12, line0Sz * 1.1);
      growX = -Math.max(0, Math.min(avail - minW, avail - one.width));
      if (growX) one = measure(1);
    }
    const totalAvail = avail + Math.max(0, growX) + growLeft;
    if (one.width > totalAvail + 0.3 && !model.badge && !model.cell && ctx.isLast) {
      const probeMax = (fn, cap) => {
        if (!fn) return 0;
        if (fn(cap)) return cap;
        let lo = 0, hi = cap;
        for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (fn(mid)) lo = mid; else hi = mid; }
        return lo > 1 ? lo - 0.3 : 0;
      };
      let wL = layoutText(model, paras, 1, { forced });
      let wrapGX = 0, wrapGL = 0;
      if (wL.lines.length > 2) {
        const capR = probeMax(ctx.canGrowX, 38);
        const capL = probeMax(ctx.canGrowLeft, 38);
        if (capR > 1 || capL > 1) {
          const wideArea = { ...A, left: A.left - capL, right: A.right + capR };
          const wWide = layoutText({ ...model, area: wideArea }, paras, 1, { forced });
          if (wWide.lines.length === 2) {
            wL = wWide;
            const maxLineR = Math.max(...wL.lines.map((ln) => ln.x + ln.width));
            const minLineL = Math.min(...wL.lines.map((ln) => ln.x));
            wrapGX = Math.max(0, Math.min(capR, maxLineR - A.right + 0.5));
            wrapGL = Math.max(0, Math.min(capL, A.left - minLineL + 0.5));
          }
        }
      }
      if (wL.lines.length > 1 && wL.lines.length <= 2) {
        const need = lastOf(wL) - A.lastBaseline;
        if (need <= 0.6 || (ctx.canGrow && ctx.canGrow(need))) {
          L = wL; k = 1; grow = Math.max(0, need); wrappedCell = true;
          growX = wrapGX; growLeft = wrapGL;
        }
      } else if (wL.lines.length > 2) {
        const capR = probeMax(ctx.canGrowX, 38);
        const capL = probeMax(ctx.canGrowLeft, 38);
        const fitArea = { ...A, left: A.left - capL, right: A.right + capR };
        for (let kk = 0.96; kk >= 0.18 - 1e-9; kk -= 0.02) {
          const kL = layoutText({ ...model, area: fitArea }, paras, kk, { forced: new Set() });
          if (kL.lines.length <= 2) {
            const need = Math.max(0, lastOf(kL) - A.lastBaseline);
            if (need <= 0.6 || (ctx.canGrow && ctx.canGrow(need))) {
              L = kL; k = kk; grow = need; wrappedCell = true;
              const maxLineR = Math.max(...kL.lines.map((ln) => ln.x + ln.width));
              const minLineL = Math.min(...kL.lines.map((ln) => ln.x));
              growX = Math.max(0, Math.min(capR, maxLineR - A.right + 0.5));
              growLeft = Math.max(0, Math.min(capL, A.left - minLineL + 0.5));
              break;
            }
          }
        }
      }
      if (wrappedCell && model.container && L.lines.length === 2) {
        const cMid = (model.container.y0 + model.container.y1 + grow) / 2;
        const lTop = L.lines[0].baseline - 0.72 * L.lines[0].size;
        const lBot = L.lines[1].baseline + 0.18 * L.lines[1].size;
        const dyC = cMid - (lTop + lBot) / 2;
        if (Math.abs(dyC) > 0.3 && Math.abs(dyC) < 6) {
          for (const ln of L.lines) ln.baseline += dyC;
        }
      }
    }
    if (!wrappedCell) {
      while (one.width > totalAvail + 0.3 && k > 0.2) { k -= 0.02; one = measure(k); }
      if (one.width > totalAvail - 0.05 && one.width > 0) {
        k = Math.max(0.12, k * Math.max(0.1, totalAvail - 0.1) / one.width);
        one = measure(k);
      }
      // keep the vertical centre of the original line
      const centre = A.firstBaseline - 0.33 * line0Sz;
      one.baseline = centre + 0.33 * line0Sz * k;
      L = { lines: [one], k, step: A.step * k };
      const tailLs = tailLsOf(L);
      if (tailLs > 0 && ctx.canGrow) {
        if (ctx.canGrow(tailLs)) grow = tailLs;
        else {
          let lo = 0, hi = tailLs;
          for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (ctx.canGrow(mid)) lo = mid; else hi = mid; }
          if (lo > 0.5) grow = lo;
        }
      }
    } else {
      const tailLs = tailLsOf(L);
      if (tailLs > 0 && ctx.canGrow && ctx.canGrow(grow + tailLs)) grow += tailLs;
    }
  } else if (!wrappedCell) {
    let activeModel = model;
    let fittedVert = false;
    const keepLB = !!model.keepLineBreaks;
    L = layoutText(activeModel, paras, 1, { forced, keepLineBreaks: keepLB });
    if (lastOf(L) > capacityBaseline && (model.container || model.sharedPanel) && !model.badge && !model.cell) {
      const probeMax = (fn, cap) => {
        if (!fn) return 0;
        if (fn(cap)) return cap;
        let lo = 0, hi = cap;
        for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (fn(mid)) lo = mid; else hi = mid; }
        return lo > 1 ? lo - 0.3 : 0;
      };
      const capR = probeMax(ctx.canGrowX, model.sharedPanel ? 260 : 60);
      const capL = model.sharedPanel ? 0 : probeMax(ctx.canGrowLeft, 38);
      const safePad = model.sharedPanel ? 2 : 6;
      const usableR = Math.max(0, capR - safePad), usableL = Math.max(0, capL - safePad);
      if (usableR > 1 || usableL > 1) {
        const wideArea = { ...A, left: A.left - usableL, right: A.right + usableR };
        const wL = layoutText({ ...model, area: wideArea }, paras, 1, { forced });
        if (wL.lines.length < L.lines.length || lastOf(wL) <= capacityBaseline) {
          const maxR = Math.max(...wL.lines.map((ln) => ln.x + ln.width));
          const minL = Math.min(...wL.lines.map((ln) => ln.x));
          const needR = usableR > 0 && maxR > A.right - 0.1 ? Math.max(0, Math.min(capR, maxR - A.right + safePad)) : 0;
          const needL = usableL > 0 && minL < A.left + 0.1 ? Math.max(0, Math.min(capL, A.left - minL + safePad)) : 0;
          if (needR <= capR + 0.1 && needL <= capL + 0.1) {
            L = wL;
            activeModel = { ...model, area: { ...A, left: A.left - needL, right: A.right + needR } };
            growX = needR;
            growLeft = needL;
          }
        } else if (model.sharedPanel && usableR > 1 && wL.lines.length > 1) {
          const maxR = Math.max(...wL.lines.map((ln) => ln.x + ln.width));
          if (maxR > A.right + 0.3) {
            const needR = Math.max(0, Math.min(capR, maxR - A.right + safePad));
            L = wL;
            activeModel = { ...model, area: { ...A, right: A.right + needR } };
            growX = needR;
          }
        }
      }
      const maxLines = model.lines.length + 1;
      if (!model.sharedPanel && L.lines.length > maxLines && ctx.isLast) {
        const fitArea = A;
        for (let kk = 0.96; kk >= 0.18 - 1e-9; kk -= 0.02) {
          const kL = layoutText({ ...model, area: fitArea }, paras, kk, { forced: new Set() });
          if (kL.lines.length <= maxLines) {
            const needK = Math.max(0, lastOf(kL) - A.lastBaseline);
            const maxGrow = A.step + 1;
            const gNeed = Math.min(maxGrow, needK);
            if (gNeed <= 0.6 || (ctx.canGrow && ctx.canGrow(gNeed))) {
              L = kL; k = kk; grow = gNeed;
              growX = 0; growLeft = 0;
              fittedVert = true;
              break;
            }
          }
        }
      }
    }
    const rightFreeCbs = paras.filter((p) => p.cb && p.cb.pos === 'right' && p.cb.alignX == null);
    if (rightFreeCbs.length && k === 1) {
      const needCb = Math.max(...rightFreeCbs.map((p) => {
        const g = checkBoxGeom(p.cb, line0Sz);
        return g.w + g.gap;
      }));
      const cbLines = L.lines.filter((ln) => paras[ln.pi] && paras[ln.pi].cb && paras[ln.pi].cb.pos === 'right' && paras[ln.pi].cb.alignX == null);
      const maxCbLineR = cbLines.length ? Math.max(...cbLines.map((ln) => ln.x + ln.width)) : activeModel.area.left;
      const needR = Math.max(0, maxCbLineR + needCb - activeModel.area.right);
      if (needR > 0.3) {
        if (ctx.canGrowX && ctx.canGrowX(growX + needR)) {
          activeModel = { ...activeModel, area: { ...activeModel.area, right: activeModel.area.right + needR } };
          growX += needR;
        } else {
          let remR = 0;
          if (ctx.canGrowX) {
            let lo = 0, hi = needR;
            for (let it = 0; it < 10; it++) {
              const mid = (lo + hi) / 2;
              if (ctx.canGrowX(growX + mid)) lo = mid; else hi = mid;
            }
            remR = lo > 0.5 ? Math.max(0, lo - 0.3) : 0;
          }
          const reserve = Math.max(2, needCb - remR);
          const nextArea = remR > 0.3 ? { ...activeModel.area, right: activeModel.area.right + remR } : activeModel.area;
          activeModel = { ...activeModel, area: nextArea };
          growX += remR;
          L = layoutText(activeModel, paras, 1, { forced: new Set(), keepLineBreaks: false, cbRightReserve: reserve });
        }
      }
    }
    const tryK = (kk) => layoutText(activeModel, paras, kk, { forced: kk === 1 ? forced : new Set(), keepLineBreaks: !!model.keepLineBreaks && kk === 1 });
    const hasLs = newParas.some((p) => p.st && p.st.some((r) => r.s && r.s.ls != null && r.s.ls !== 0));
    // a size the user typed is kept exactly: make room instead of shrinking the text
    const hasZ = newParas.some((p) => p.st && p.st.some((r) => r.s && r.s.z > 0));
    const hasAnyCb = newParas.some((p) => p.cb && p.cb.pos);
    if (model.cell && !hasZ && k === 1) {
      const badH = (ly) => ly.lines.some((ln, idx) => {
        if (ln.width > (A.right - A.left) + 0.4) return true;
        const nxt = ly.lines[idx + 1];
        if (!nxt || nxt.pi !== ln.pi || !ln.items.length || !nxt.items.length) return false;
        const aCh = ln.items[ln.items.length - 1].ch, bCh = nxt.items[0].ch;
        return aCh !== ' ' && aCh !== '-' && bCh !== ' ';
      });
      if (badH(L)) {
        for (let kk = 0.96; kk >= 0.35 - 1e-9; kk -= 0.02) {
          const kL = tryK(kk);
          if (!badH(kL)) { L = kL; k = kk; break; }
          if (kk <= 0.36) { L = kL; k = kk; }
        }
      }
    }
    const endOf = (layout) => lastOf(layout) + tailLsOf(layout);
    if (endOf(L) > capacityBaseline && !fittedVert) {
      const need1 = endOf(L) - A.lastBaseline;
      if (((hasLs || hasZ || isCell || model.addedText || model.container || model.sharedPanel || hasAnyCb) && ctx.isLast || tailLsOf(L) > 0) && ctx.canGrow && ctx.canGrow(need1)) {
        grow = need1;
      } else if (hasLs && ctx.isLast && ctx.canGrow) {
        let lo = 0, hi = need1;
        for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (ctx.canGrow(mid)) lo = mid; else hi = mid; }
        const maxG = lo > 0.5 ? lo : 0;
        for (k = 0.98; k >= 0.35 - 1e-9; k -= 0.02) {
          L = tryK(k);
          const nk = Math.max(0, endOf(L) - A.lastBaseline);
          if (nk <= maxG + 0.3) { grow = nk; break; }
        }
      } else {
        for (k = 0.98; k >= 0.88 - 1e-9; k -= 0.02) { L = tryK(k); if (endOf(L) <= capacityBaseline) break; }
        if (endOf(L) > capacityBaseline && ctx.isLast) {
          const need = endOf(L) - A.lastBaseline;
          if (ctx.canGrow(need)) grow = need;
        }
        if (endOf(L) > capacityBaseline && !grow) {
          for (; k >= 0.35 - 1e-9; k -= 0.02) { L = tryK(k); if (endOf(L) <= capacityBaseline) break; }
          if (endOf(L) > capacityBaseline && ctx.isLast) {
            const need = endOf(L) - A.lastBaseline;
            if (ctx.canGrow(need)) grow = need; else ctx.warnings.push('overflow');
          }
        }
      }
    }
  }
// which original lines stay untouched
  const keep = new Set();
  const forceRewrite = !!(model._ocrRepaired || (model.extraDropGfx && model.extraDropGfx.length));
  if (!forceRewrite && L.k === 1 && (!singleTight || wrappedCell)) {
    L.lines.forEach((ln, i) => {
      if (newParas[ln.pi] && newParas[ln.pi].align === 'justify') return;
      const ol = model.lines[i];
      if (!ol) return;
      const oText = ol.glyphs.slice(ol.leadSpaces).map((g) => g.uni).join('').replace(/\u00A0/g, ' ').replace(/ +$/, '');
      const nText = ln.text.replace(/ +$/, '');
      if (oText !== nText) return;
      if (Math.abs(ol.baseline - ln.baseline) > 0.3) return;
      if (Math.abs(ol.left - ln.x) > 0.8) return;
      const oStyles = ol.glyphs.slice(ol.leadSpaces).filter((g) => !g.space).map((g) => styleKey(g.g)).join(',');
      const nStyles = ln.items.filter((c) => c.ch !== ' ').map((c) => styleKey(c.g.g)).join(',');
      if (oStyles !== nStyles) return;
      if (ln.items.some((c) => c.st && !c.g?._fromInit)) return;
      // a bold / italic original glyph shown plain in the editor must be redrawn
      if (ln.items.some((c) => c.ch.trim() && c.g && c.g.g && (glyphIsBold(c.g.g) || glyphIsItalic(c.g.g)))) return;
      keep.add(i);
    });
  }
  const removeGlyphs = [];
  model.lines.forEach((ol, i) => { if (!keep.has(i)) ol.glyphs.forEach((g) => removeGlyphs.push(g.idx)); });
  // runs
  const runs = [];
  L.lines.forEach((ln, i) => {
    if (keep.has(i)) return;
    let cur = null;
    const items = ln.items.slice();
    while (items.length && items[items.length - 1].ch === ' ') items.pop();
    const isJustify = !!(newParas[ln.pi] && newParas[ln.pi].align === 'justify');
    for (const c of items) {
      if (isJustify && c.ch === ' ') { cur = null; continue; }
      const g = c.g.g;
      const st = c.st || null;
      const fontTag = c.draw.kind === 'vec' ? 'vec' : (c.draw.kind === 'orig' ? `orig:${(c.draw.info || g.font).id}` : `fb:${c.draw.fb.file}`);
      const isFbTrCap = c.draw.kind === 'fb' && /^[İĞÜÖŞÇ]$/.test(c.ch);
      const capBoost = isFbTrCap ? 1.06 : 1;
      const sk = c.draw.kind === 'vec' ? `vec:${runs.length}` : `${fontTag}|${styleKey(g)}|${styleSig(st)}|${c.draw.synB ? 1 : 0}${c.draw.synI ? 1 : 0}|${capBoost}`;
      if (!cur || cur.sk !== sk) {
        const kk = L.k * sizeFactor(st, g) * (st && st.v ? VK : 1) * capBoost;
        const m = g.trm.slice(0, 4).map((v) => v * kk);
        if (c.draw.synI) { m[2] += 0.21 * m[0]; m[3] += 0.21 * m[1]; }
        cur = {
          sk, font: fontTag, m, x: c.x, y: ln.baseline + vShift(st, Math.hypot(g.trm[2], g.trm[3]) * L.k * sizeFactor(st, g)), w: 0,
          codes: [], text: '', fill: st && st.c ? hexToFill(st.c) : g.fill, gs: g.gsName, bpc: ((c.draw.info || g.font) && (c.draw.info || g.font).bytesPerCode) || 1,
        };
        if (st && st.u) cur.u = 1;
        if (st && st.link) cur.link = st.link;
        if (c.draw.synB) cur.synB = 1;
        runs.push(cur);
      }
      cur.w += c.w;
      if (c.draw.kind === 'orig') cur.codes.push(c.draw.code);
      cur.text += c.ch;
    }
  });
  runs.forEach((r) => delete r.sk);
  // highlights / word boxes follow their words
  const marks = [], dropGfx = [...(model.extraDropGfx || [])], dropBoxes = [];
  for (const mk of model.marks || []) {
    const set = new Set(mk.set);
    const anyChanged = model.lines.some((ol, idx) => !keep.has(idx) && ol.glyphs.some((g) => set.has(g.idx)));
    if (!anyChanged) continue;
    dropGfx.push(mk.gi);
    if (mk.origBox) dropBoxes.push(mk.origBox);
    const rects = [];
    L.lines.forEach((ln) => {
      const idxs = [];
      ln.items.forEach((c, idx) => { if (c.ch !== ' ' && c.g && set.has(c.g.idx)) idxs.push(idx); });
      if (!idxs.length) return;
      const span = ln.items.slice(idxs[0], idxs[idxs.length - 1] + 1).filter((c) => c.ch !== ' ');
      const prevNonSpace = idxs[0] > 0 ? ln.items.slice(0, idxs[0]).reverse().find((c) => c.ch !== ' ') : null;
      const nextNonSpace = idxs[idxs.length - 1] + 1 < ln.items.length ? ln.items.slice(idxs[idxs.length - 1] + 1).find((c) => c.ch !== ' ') : null;
      const minX0 = prevNonSpace ? prevNonSpace.x + prevNonSpace.w + 0.8 : -Infinity;
      const maxX1 = nextNonSpace ? nextNonSpace.x - 0.8 : Infinity;
      const x0 = Math.max(minX0, Math.min(...span.map((c) => c.x)) - mk.padL * L.k);
      const x1 = Math.min(maxX1, Math.max(...span.map((c) => c.x + c.w)) + mk.padR * L.k);
      rects.push({ x: x0, y: ln.baseline + mk.top * L.k, w: x1 - x0, h: (mk.bot - mk.top) * L.k });
    });
    if (rects.length) marks.push({ rects, fill: mk.fill, stroke: mk.stroke, lw: mk.lw });
  }
  // Merge same-style inline marks that end up adjacent on the same line (e.g. wrapped highlight pulled onto 1 line)
  const sameCol = (a, b) => (a === b) || (a && b && a.length === b.length && a.every((v, i) => v === b[i]));
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      const a = marks[i], b = marks[j];
      if (!sameCol(a.fill, b.fill) || !sameCol(a.stroke, b.stroke) || a.lw !== b.lw) continue;
      b.rects = b.rects.filter((rb) => {
        const ra = a.rects.find((r) => Math.abs(r.y - rb.y) < 1.5 && Math.abs(r.h - rb.h) < 1.5 && rb.x <= r.x + r.w + 6 && r.x <= rb.x + rb.w + 6);
        if (!ra) return true;
        const x0 = Math.min(ra.x, rb.x), x1 = Math.max(ra.x + ra.w, rb.x + rb.w);
        ra.x = x0; ra.w = x1 - x0; ra.y = Math.min(ra.y, rb.y); ra.h = Math.max(ra.h, rb.h);
        return false;
      });
      if (!b.rects.length) { marks.splice(j, 1); j--; }
    }
  }
  // user-applied word backgrounds ("Metin arkaplanı")
  const rawUserBg = [];
  for (let i = 0; i < L.lines.length; i++) {
    if (keep.has(i)) continue;
    const ln = L.lines[i];
    const items = ln.items.slice();
    while (items.length && items[items.length - 1].ch === ' ') items.pop();
    let j = 0;
    while (j < items.length) {
      const bg = items[j].st && items[j].st.bg;
      const s0 = bgSig(bg);
      if (!s0) { j++; continue; }
      let e = j + 1;
      while (e < items.length && bgSig(items[e].st && items[e].st.bg) === s0) e++;
      const span = items.slice(j, e);
      const maxH = Math.max(...span.map((c) => ((c.g && c.g.g && c.g.g.hsize) || 10) * L.k * sizeFactor(c.st, c.g && c.g.g)));
      const bwPad = bg.bc ? (bg.bw || 1.5) * 0.5 : 0;
      const padX = (bg.shape === 'round' ? Math.max(3.5, maxH * 0.26) : Math.max(2.2, maxH * 0.2)) + bwPad;
      const padY = Math.max(1.5, maxH * 0.16) + bwPad;
      const x0 = span[0].x - padX, x1 = span[span.length - 1].x + span[span.length - 1].w + padX;
      const y0 = ln.baseline - 0.82 * maxH - padY, y1 = ln.baseline + 0.24 * maxH + padY;
      rawUserBg.push({ lineIdx: i, sig: s0, bg: { ...bg }, x0, y0, x1, y1, fullLine: j === 0 && e === items.length });
      j = e;
    }
  }
  // Merge consecutive full-line / multi-line blocks with identical bg into ONE uniform rect (no overlap stripes)
  for (let k0 = 0; k0 < rawUserBg.length; k0++) {
    const cur = rawUserBg[k0];
    if (cur._used) continue;
    const grp = [cur];
    cur._used = true;
    for (let k1 = k0 + 1; k1 < rawUserBg.length; k1++) {
      const nxt = rawUserBg[k1];
      if (nxt._used || nxt.sig !== cur.sig) continue;
      const last = grp[grp.length - 1];
      if (nxt.lineIdx === last.lineIdx + 1 && Math.min(last.x1, nxt.x1) > Math.max(last.x0, nxt.x0) && (last.fullLine || nxt.fullLine)) {
        grp.push(nxt);
        nxt._used = true;
      }
    }
    if (grp.length >= 2 && grp.every((g) => g.fullLine)) {
      const x0 = Math.min(...grp.map((g) => g.x0)), y0 = Math.min(...grp.map((g) => g.y0));
      const x1 = Math.max(...grp.map((g) => g.x1)), y1 = Math.max(...grp.map((g) => g.y1));
      const w = x1 - x0, h = y1 - y0, bg = cur.bg;
      marks.push({ rects: [{ x: x0, y: y0, w, h, r: bg.shape === 'sharp' ? 0 : Math.min(w, h, 28) * 0.22, oval: bg.shape === 'oval' }], box: { ...bg } });
    } else {
      // Prevent vertical overlap between adjacent lines so semi-transparent fills never double-paint
      for (let gIdx = 1; gIdx < grp.length; gIdx++) {
        const prev = grp[gIdx - 1], g = grp[gIdx];
        if (prev.y1 > g.y0) {
          const midY = (prev.y1 + g.y0) * 0.5;
          prev.y1 = midY;
          g.y0 = midY;
        }
      }
      const rects = grp.map((g) => {
        const w = g.x1 - g.x0, h = Math.max(1, g.y1 - g.y0), bg = g.bg;
        return { x: g.x0, y: g.y0, w, h, r: bg.shape === 'sharp' ? 0 : Math.min(w, h) * 0.22, oval: bg.shape === 'oval' };
      });
      marks.push({ rects, box: { ...cur.bg } });
    }
  }
  // paragraph checkboxes ("İşaret kutusu": Başına / Karşısına -> Kare, Dikdörtgen, Daire)
  if (newParas.some((p) => p.cb && p.cb.pos)) {
    const rightFree = newParas.filter((p) => p.cb && p.cb.pos === 'right' && p.cb.alignX == null);
    const rightLines = L.lines.filter((ln) => newParas[ln.pi] && newParas[ln.pi].cb && newParas[ln.pi].cb.pos === 'right' && newParas[ln.pi].cb.alignX == null);
    const maxRightCbW = rightFree.length
      ? Math.max(...rightFree.map((p) => checkBoxGeom(p.cb, line0Sz * L.k).w))
      : 0;
    const maxRightGap = Math.max(5, line0Sz * L.k * 0.5);
    const rightExtent = rightLines.length ? Math.max(...rightLines.map((ln) => ln.x + ln.width)) : A.right;
    const areaRightEff = A.right + Math.max(0, growX);
    const sharedRightBoxX = Math.max(rightExtent + maxRightGap, areaRightEff - maxRightCbW);
    for (let pi = 0; pi < newParas.length; pi++) {
      const cb = newParas[pi] && newParas[pi].cb;
      if (!cb || !cb.pos) continue;
      const pLines = L.lines.filter((ln) => ln.pi === pi);
      if (!pLines.length) continue;
      const fs = Math.max(6, ((pLines[0].items.find((c) => c.g && c.g.g)?.g.g.hsize) || line0Sz) * L.k);
      const g = checkBoxGeom(cb, fs);
      const top1 = pLines[0].baseline - 0.78 * fs;
      const bot1 = pLines[0].baseline + 0.22 * fs;
      const lastBot = pLines[pLines.length - 1].baseline + 0.22 * fs;
      const boxW = g.w;
      let boxH, boxX, boxY;
      if (cb.pos === 'right') {
        boxX = cb.alignX != null ? cb.alignX : sharedRightBoxX;
        if (pLines.length >= 2 && cb.shape !== 'circle') {
          const extraH = Math.min((lastBot - bot1) * 0.55, g.h * 0.9, 16);
          boxH = g.h + extraH;
          boxY = top1 + (lastBot - top1 - boxH) * 0.35;
        } else {
          boxH = g.h;
          boxY = pLines.length === 1
            ? ((top1 + bot1) * 0.5 - boxH * 0.5)
            : (top1 + (lastBot - top1 - boxH) * 0.35);
        }
      } else {
        boxX = A.left;
        boxH = g.h;
        boxY = (top1 + bot1) * 0.5 - boxH * 0.5;
      }
      marks.push({
        rects: [{ x: boxX, y: boxY, w: boxW, h: boxH, r: g.r, oval: g.oval }],
        box: {
          fc: cb.fc === null ? null : (cb.fc || '#ffffff'),
          fo: cb.fc === null ? 0 : 1,
          bc: cb.bc || '#334155',
          bw: cb.bw || 1.1,
          bo: 1,
          shape: g.oval ? 'oval' : 'round',
        },
        isCb: true,
      });
    }
  }
  // char source map for re-editing
  const charSrc = [];
  paras.forEach((p, pi) => { p.chars.forEach((c) => { for (let t = 0; t < c.ch.length; t++) charSrc.push(c.g.idx); }); if (pi < paras.length - 1) charSrc.push(-1); });
  // where the laid-out lines end (same meaning as model.lineEndAt): the editor
  // shows these line breaks when the text is opened again
  const lineEndAt = [];
  {
    const pStart = []; let acc = 0;
    paras.forEach((p) => { pStart.push(acc); acc += p.chars.reduce((n, c) => n + c.ch.length, 0) + 1; });
    L.lines.forEach((ln, li) => {
      const nx = L.lines[li + 1];
      if (!nx || nx.pi !== ln.pi || !ln.items.length) return;
      const chs = paras[ln.pi].chars;
      let end = ln.items[ln.items.length - 1].ci + 1;
      while (end > 0 && chs[end - 1].ch === ' ') end--;
      lineEndAt.push(pStart[ln.pi] + chs.slice(0, end).reduce((n, c) => n + c.ch.length, 0));
    });
  }
  if (model.keepLineBreaks && !model.cell && !model.badge && model.partSrc && L.lines && L.lines.length) {
    const maxLineR = Math.max(...L.lines.map((ln) => ln.x + ln.width));
    const srcR = model.partSrc.x + model.partSrc.w;
    if (maxLineR > srcR + 0.2) {
      const need = maxLineR - srcR + 1;
      if (ctx.canGrowX && ctx.canGrowX(need)) growX = Math.max(growX, need);
    }
  }
  const newLast = lastOf(L) + tailLsOf(L);
  const delta = (ctx.isLast ? (newLast - A.lastBaseline) : 0);
  const resDelta = grow ? grow : (delta < 0 ? delta : 0);
  const compactBox = model.container && !model.badge && (model.container.y1 - model.container.y0) < 90;
  const cutY = compactBox
    ? Math.max(model.partSrc.y + Math.abs(Math.min(0, resDelta)) + 3, (model.container.y0 + model.container.y1) / 2)
    : A.bottom;
  return {
    removeGlyphs, runs, marks, dropGfx, dropBoxes, k: L.k, delta: resDelta,
    paras: newParas.map((p) => ({
      text: p.text, marker: p.marker,
      ...(p.align ? { align: p.align } : {}),
      ...(p.cb ? { cb: { ...p.cb } } : {}),
      ...(p.st && p.st.length ? { st: p.st.map((r) => ({ a: r.a, b: r.b, s: { ...r.s } })) } : {}),
    })), charSrc,
    lineCount: L.lines.length, lineEndAt, oldBottom: cutY, deltaX: Math.max(growX, freeGrowX), deltaLeft: growLeft,
    cutLeftX: model.badge && model.container ? model.container.x0 + (model.container.x1 - model.container.x0) * 0.45 : undefined,
    cutX: compactBox ? (model.container.x0 + model.container.x1) / 2
      : (model.container ? model.container.x1 - Math.min(8, (model.container.y1 - model.container.y0) * 0.6) : (model.partSrc ? model.partSrc.x + model.partSrc.w : A.right)),
  };
}
