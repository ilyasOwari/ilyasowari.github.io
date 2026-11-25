// Layout of a user-inserted text box: paragraphs of styled characters (bold,
// italic, underline, colour, size, font, superscript / subscript), measured
// with the bundled font files so the screen and the saved PDF are identical.
import { getManifest, loadFallbackFont, fallbackAdvance, fallbackHas } from './fontMatch.js';
import { pickVariant, styleAt } from './richStyle.js';
import { VK, vShift } from './layout.js';

const LH = 1.25;
// old inserted boxes had plain lines
export function insParas(ins) {
  if (ins.paras && ins.paras.length) return ins.paras;
  return (ins.lines || ['']).map((text) => ({ text }));
}
export function insPadding(ins) {
  const box = ins.box;
  return box && (box.fc || box.bc) ? Math.max(3, Math.min(10, ins.size * 0.4)) + (box.bc ? box.bw || 0 : 0) : 2;
}

export async function layoutInserted(ins) {
  const man = await getManifest();
  const base = man.find((m) => m.file === ins.font) || man.find((m) => m.file === 'Carlito-Regular.ttf') || man[0];
  const baseBold = (base.weight || 400) >= 600, baseItal = !!base.italic;
  const size = ins.size || 14;
  const pad = insPadding(ins);
  const wrapW = ins.maxW > 0 ? Math.max(20, ins.maxW - 2 * pad) : Infinity;
  const stepMul = ins.lineStep > 0 && size > 0 ? Math.max(0.95, Math.min(1.8, ins.lineStep / size)) : LH;
  const lines = [];
  let y = 0, maxW = 0;

  const splitWrap = (items) => {
    if (wrapW === Infinity || !items.length) return [items];
    const out = [];
    let i = 0;
    while (i < items.length) {
      let lineW = 0, lastSpace = -1, j = i;
      while (j < items.length) {
        const w = items[j].adv;
        if (j > i && lineW + w > wrapW) break;
        lineW += w;
        if (items[j].ch === ' ') lastSpace = j;
        j++;
      }
      if (j < items.length && lastSpace > i) {
        out.push(items.slice(i, lastSpace));
        i = lastSpace + 1;
        while (i < items.length && items[i].ch === ' ') i++;
      } else {
        let end = Math.max(i + 1, j);
        while (end < items.length && items[end].ch !== ' ') end++;
        out.push(items.slice(i, end));
        i = end;
        while (i < items.length && items[i].ch === ' ') i++;
      }
    }
    return out;
  };

  const paras = insParas(ins);
  for (let pi = 0; pi < paras.length; pi++) {
    if (pi > 0 && ins.paraGap > 0) y += ins.paraGap;
    const p = paras[pi];
    const chars = Array.from(p.text || '');
    if (!chars.length) {
      lines.push({ baseline: y + size * 0.95, runs: [], width: 0 });
      y += size * LH;
      continue;
    }
    const items = [];
    for (let ci = 0; ci < chars.length; ci++) {
      const ch = chars[ci];
      const st = styleAt(p, ci) || {};
      const fam = st.f && st.f.startsWith('lib:') ? st.f.slice(4) : base.family;
      let v = pickVariant(man, fam, !!st.b || baseBold, !!st.i || baseItal) || { file: base.file, synB: false, synI: false };
      let fb = await loadFallbackFont(v.file);
      if (!fallbackHas(fb, ch)) { v = pickVariant(man, 'Carlito', !!st.b || baseBold, !!st.i || baseItal); fb = await loadFallbackFont(v.file); }
      const k = st.z > 0 ? st.z / size : (st.k || 1);
      const sz = size * k * (st.v ? VK : 1);
      const adv = fallbackAdvance(fb, ch) * sz;
      const sig = [v.file, v.synB, v.synI, sz, st.c || '', st.u ? 1 : 0, st.v || ''].join('|');
      items.push({ ch, adv, sz, k, file: v.file, synB: v.synB, synI: v.synI, color: st.c || null, u: !!st.u, dy: vShift(st, size * k), sig });
    }
    for (const lineChars of splitWrap(items)) {
      const runs = [];
      let x = 0, big = 1;
      for (const it of lineChars) {
        big = Math.max(big, it.k);
        const last = runs[runs.length - 1];
        if (last && last.sig === it.sig) { last.text += it.ch; last.w += it.adv; }
        else runs.push({ sig: it.sig, text: it.ch, x, w: it.adv, size: it.sz, file: it.file, synB: it.synB, synI: it.synI, color: it.color, u: it.u, dy: it.dy });
        x += it.adv;
      }
      const lh = size * big;
      const baseline = y + lh * 0.95;
      lines.push({ baseline, runs, width: x });
      maxW = Math.max(maxW, x);
      y += lh * stepMul;
    }
  }
  if (ins.align === 'center' && lines.length) {
    const targetW = Math.max(maxW, Number.isFinite(wrapW) ? wrapW : maxW);
    maxW = targetW;
    for (const ln of lines) {
      const dx = Math.max(0, (targetW - ln.width) / 2);
      if (dx > 0) for (const r of ln.runs) r.x += dx;
    }
  }
  const h = Math.max(size * 1.2, y - (lines.length ? (size * stepMul - size * 1.2) : 0));
  return { w: maxW, h, lines };
}

// block size + where the text starts inside it (oval boxes leave more room)
export function insFrame(ins, L) {
  const pad = insPadding(ins);
  const oval = ins.box && (ins.box.fc || ins.box.bc) && ins.box.shape === 'oval';
  const cw = L.w + 2, ch = L.h;
  const iw = oval ? cw * 1.42 : cw, ih = oval ? ch * 1.42 : ch;
  const bw = iw + 2 * pad, bh = ih + 2 * pad;
  return { bw, bh, ox: (bw - cw) / 2 + 1, oy: (bh - ch) / 2 };
}
export const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const colorHexOf = (ins) => (ins.color ? '#' + ins.color.map((v) => v.toString(16).padStart(2, '0')).join('') : '#000000');
