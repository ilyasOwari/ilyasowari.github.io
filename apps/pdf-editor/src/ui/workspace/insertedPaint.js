// Screen drawing of user-inserted rich text boxes (same layout as the PDF).
import { layoutInserted, insFrame, colorHexOf } from '../../engines/text/insertedLayout.js';
import { boxCss } from './boxCss.js';

export async function paintInsertedText(app, b, c, px) {
  const ins = b.inserted;
  const L = await layoutInserted(ins);
  const F = insFrame(ins, L);
  const files = new Set(L.lines.flatMap((l) => l.runs.map((r) => r.file)));
  await Promise.all([...files].map((f) => document.fonts.load(`20px "${app.fontFamilyFor(f)}"`).catch(() => {})));
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const def = colorHexOf(ins);
  ctx.globalAlpha = ins.box && ins.box.to !== undefined ? ins.box.to : 1;
  for (const ln of L.lines) for (const r of ln.runs) {
    const x = (F.ox + r.x) * px, y = (F.oy + ln.baseline + r.dy) * px, sz = r.size * px;
    ctx.save();
    ctx.fillStyle = r.color || def; ctx.strokeStyle = r.color || def;
    ctx.font = `${sz}px "${app.fontFamilyFor(r.file)}"`;
    ctx.textBaseline = 'alphabetic';
    ctx.translate(x, y);
    if (r.synI) ctx.transform(1, 0, -0.21, 1, 0, 0);
    ctx.fillText(r.text, 0, 0);
    if (r.synB) { ctx.lineWidth = sz * 0.035; ctx.lineJoin = 'round'; ctx.strokeText(r.text, 0, 0); }
    ctx.restore();
    if (r.u) { ctx.fillStyle = r.color || def; ctx.fillRect(x, y + r.size * 0.1 * px, r.w * px, Math.max(0.5, r.size * 0.055) * px); }
  }
  return F;
}
// the box behind an inserted text: CSS on a div filling the block
export function insertedBoxDiv(b, z) {
  const box = b.inserted && b.inserted.box;
  if (!box || !(box.fc || box.bc)) return null;
  const s = b.s || 1, w = b.bw * s, h = b.bh * s;
  return boxCss({ x: 0, y: 0, w, h, r: box.shape === 'round' ? Math.min(b.bw, b.bh) * 0.22 * s : 0, oval: box.shape === 'oval' }, box, z, s);
}
