// Helpers to open user-inserted text blocks/parts inside the unified stage Area Editor (Düzenle).
import { insParas, colorHexOf } from '../engines/text/insertedLayout.js';
import { getManifest } from '../engines/text/fontMatch.js';
import { openAllModels, applyTextEdit } from '../engines/text/editSession.js';
import { blockRect, partRect } from '../model/blockOps.js';
import { fallbackSrcIndex } from '../model/blockState.js';
import { hydrateImg } from './imageStore.js';

function styledParasForIns(ins, man) {
  const base = (man || []).find((m) => m.file === ins.font) || (man || []).find((m) => m.file === 'Carlito-Regular.ttf') || (man && man[0]) || { family: 'Carlito', weight: 400, italic: false };
  const sz = ins.size || 12;
  const col = colorHexOf(ins);
  const fam = 'lib:' + (base.family || 'Carlito');
  const b = (base.weight || 400) >= 600;
  const it = !!base.italic;
  const baseStyle = { z: sz, c: col, f: fam, ...(b ? { b: 1 } : {}), ...(it ? { i: 1 } : {}), ...(ins.align === 'center' ? { al: 'center' } : {}) };
  return insParas(ins).map((p) => {
    const len = Array.from(p.text || '').length;
    if (!len) return { text: '', marker: false, ...(ins.align === 'center' ? { align: 'center' } : {}) };
    const st = [{ a: 0, b: len, s: { ...baseStyle } }];
    if (Array.isArray(p.st) && p.st.length) {
      const merged = Array.from({ length: len }, () => ({ ...baseStyle }));
      for (const r of p.st) for (let k = Math.max(0, r.a); k < Math.min(len, r.b); k++) merged[k] = { ...merged[k], ...r.s };
      const outSt = [];
      for (let k = 0; k < len; k++) {
        const s = merged[k];
        const sig = JSON.stringify(s);
        const prev = outSt[outSt.length - 1];
        if (prev && prev._sig === sig && prev.b === k) prev.b = k + 1;
        else outSt.push({ a: k, b: k + 1, s, _sig: sig });
      }
      return { text: p.text, marker: false, ...(ins.align === 'center' ? { align: 'center' } : {}), st: outSt.map(({ a, b: end, s }) => ({ a, b: end, s })) };
    }
    return { text: p.text, marker: false, ...(ins.align === 'center' ? { align: 'center' } : {}), st };
  });
}

export function fallbackEditFromIns(ins, man = null) {
  const paras = styledParasForIns(ins, man);
  return {
    clusters: [{ clusterKey: 'ins0', paras, runs: [], removeGlyphs: [], marks: [], dropGfx: [], dropBoxes: [], k: 1, delta: 0, deltaX: 0 }],
    removeGlyphs: [], runs: [], marks: [], dropGfx: [], dropBoxes: [], delta: 0, deltaX: 0, k: 1,
  };
}

async function buildInsPreparedEdit(an, ins, rect, man, avail) {
  const sz = ins.size || 12;
  const baseW = Math.max(40, (ins.maxW && Number.isFinite(ins.maxW) ? ins.maxW : rect.w) + 2);
  const basePart = {
    id: 'ins0', kind: 'obj', obj: 'text', addedText: true,
    ocr: !!(ins.ocrBgHex || ins.align === 'center' || ins.lineStep),
    lineStep: ins.lineStep || undefined,
    origLines: Math.max(1, insParas(ins).length),
    refGlyphIdx: -1, fontSize: sz, baseW,
    src: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    full: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    keep: [], keepG: [], dw: rect.w, dh: rect.h,
  };
  const paras = styledParasForIns(ins, man);
  const model = openAllModels(an, basePart)[0];
  if (ins.align === 'center') model.align = 'center';
  const { edit } = await applyTextEdit({
    an, part: basePart, model, paras,
    avail: avail || { canDraw: () => -1 },
    canGrow: () => true,
    canGrowX: () => true,
    canGrowLeft: () => false,
  });
  return {
    ...edit,
    clusters: [{
      clusterKey: model.clusterKey, area: { ...model.area },
      paras: edit.paras, charSrc: edit.charSrc, lineEndAt: edit.lineEndAt,
      runs: edit.runs, removeGlyphs: edit.removeGlyphs || [], marks: edit.marks || [],
      dropGfx: edit.dropGfx || [], dropBoxes: edit.dropBoxes || [], k: edit.k || 1,
    }],
  };
}

export async function normalizeInsertedForEdit(session, page, ids, avail = null) {
  const si = fallbackSrcIndex(session, page);
  const an = si !== null && si !== undefined ? session.analysis(si) : null;
  const man = await getManifest().catch(() => []);
  const av = avail || (session && session.avail) || null;
  const set = new Set(ids);
  for (const b of page.blocks || []) {
    if (!set.has(b.id)) continue;
    if (b.inserted && b.inserted.type === 'text') {
      b._preparedEdit = await buildInsPreparedEdit(an, b.inserted, blockRect(b), man, av);
    } else if (Array.isArray(b.parts)) {
      for (const p of b.parts) {
        if (p.kind === 'instext' && p.inserted) {
          p._preparedEdit = await buildInsPreparedEdit(an, p.inserted, partRect(b, p), man, av);
        }
      }
    }
  }
}

export function clearPreparedInserted(page, ids) {
  const set = new Set(ids);
  for (const b of page.blocks || []) {
    if (!set.has(b.id)) continue;
    delete b._preparedEdit;
    if (Array.isArray(b.parts)) for (const p of b.parts) delete p._preparedEdit;
  }
}

export function insToStageObj(id, ins, rect, preparedEdit = null, extra = null) {
  if (ins && ins.type === 'image') {
    return { id, type: 'img', img: hydrateImg(ins), x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
  const sz = (ins && ins.size) || 12;
  const w = Math.max(40, rect.w || 150), h = Math.max(18, rect.h || sz * 1.4);
  const src = { x: rect.x, y: rect.y, w, h };
  const ocrBgHex = (extra && extra.ocrBgHex) || (ins && ins.ocrBgHex) || undefined;
  return {
    id, type: 'text', addedText: true, refGlyphIdx: -1, fontSize: sz, baseW: w,
    ...(ocrBgHex ? { ocrBgHex } : {}),
    ...(extra && extra.ocr ? { ocr: true } : {}),
    src: { ...src }, full: { ...src }, keep: [], keepG: [],
    edit: preparedEdit || fallbackEditFromIns(ins || { paras: [{ text: '' }], size: sz }),
    nine: null, dw: w, dh: h, x: rect.x, y: rect.y, w, h,
  };
}

export function buildVirtualInsertCtx(session, page, pt, preset = null) {
  const si = fallbackSrcIndex(session, page);
  const an = si !== null && si !== undefined ? session.analysis(si) : null;
  const pw = page.w || 595, ph = page.h || 842;
  const w = Math.min(240, Math.max(90, pw - pt.x - 20));
  const sz = (preset && preset.size) || 12;
  const h = Math.max(22, Math.round(sz * 1.4));
  const x = Math.max(12, Math.min(pw - w - 12, pt.x));
  const y = Math.max(12, Math.min(ph - h - 12, pt.y));
  const ins = {
    type: 'text', paras: [{ text: '' }], size: sz,
    font: preset && preset.bold ? 'Carlito-Bold.ttf' : 'Carlito-Regular.ttf',
    color: (preset && preset.color) || [29, 36, 51], box: null,
  };
  const obj = insToStageObj('oins1', ins, { x, y, w, h }, fallbackEditFromIns(ins));
  return { R: { x, y, w, h }, an, si, ids: [], objects: [obj], page };
}
