// PDF ops for a user-inserted rich text box (box fill / border + styled runs).
import { fmtNum as f } from '../pdf/lexer.js';
import { layoutInserted, insFrame, hexRgb, colorHexOf } from '../text/insertedLayout.js';
import { boxOps, gsName } from './boxOps.js';
import { mstrOf } from './uiSpace.js';

export async function insertedTextOps(env, an, b, extraFonts, extraGs) {
  const ins = b.inserted, s = b.s || 1;
  const L = await layoutInserted(ins);
  const F = insFrame(ins, L);
  const out = [`q ${mstrOf(an.Minv)} cm ${f(s)} 0 0 ${f(s)} ${f(b.x)} ${f(b.y)} cm`];
  const box = ins.box;
  if (box && (box.fc || box.bc)) out.push(...boxOps(env, extraGs, { x: 0, y: 0, w: F.bw, h: F.bh, r: box.shape === 'round' ? Math.min(F.bw, F.bh) * 0.22 : 0, oval: box.shape === 'oval' }, box));
  const to = box && box.to !== undefined ? box.to : 1;
  const gs = gsName(env, extraGs, to);
  const def = colorHexOf(ins);
  for (const ln of L.lines) for (const r of ln.runs) {
    if (!r.text.trim()) continue;
    const pf = await env.fonts.get(r.file);
    extraFonts.set(pf.name, pf.font.ref);
    const col = hexRgb(r.color || def).map((v) => f(v / 255)).join(' ');
    const x = F.ox + r.x, y = F.oy + ln.baseline + r.dy, sz = r.size;
    const tr = r.synB ? `${col} RG ${f(sz * 0.035)} w 1 j 2 Tr` : '0 Tr';
    out.push(`q ${gs}${col} rg BT ${tr} /${pf.name} 1 Tf ${f(sz)} 0 ${f(r.synI ? 0.21 * sz : 0)} ${f(-sz)} ${f(x)} ${f(y)} Tm ${pf.font.encodeText(r.text).toString()} Tj ET Q`);
    if (r.u) out.push(`q ${gs}${col} rg ${f(x)} ${f(y + sz * 0.1)} ${f(r.w)} ${f(Math.max(0.5, sz * 0.055))} re f Q`);
  }
  out.push('Q');
  return out;
}
