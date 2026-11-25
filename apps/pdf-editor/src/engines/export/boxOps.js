// PDF drawing ops in page-UI coordinates (callers wrap them in `q <Minv> cm ... Q`):
// rounded / oval / sharp boxes, opacity graphics states, styled text runs.
import { fmtNum as f } from '../pdf/lexer.js';
import { PDFName } from '../pdf/pdfobj.js';
import { hexRgb } from '../text/insertedLayout.js';

const K = 0.5523;
export function boxPath({ x, y, w, h, r, oval }) {
  if (oval) {
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    return `${f(cx + rx)} ${f(cy)} m ${f(cx + rx)} ${f(cy + ry * K)} ${f(cx + rx * K)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c `
      + `${f(cx - rx * K)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * K)} ${f(cx - rx)} ${f(cy)} c `
      + `${f(cx - rx)} ${f(cy - ry * K)} ${f(cx - rx * K)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c `
      + `${f(cx + rx * K)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * K)} ${f(cx + rx)} ${f(cy)} c h`;
  }
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  if (r < 0.01) return `${f(x)} ${f(y)} ${f(w)} ${f(h)} re`;
  const k = r * K;
  return `${f(x + r)} ${f(y)} m ${f(x + w - r)} ${f(y)} l ${f(x + w - r + k)} ${f(y)} ${f(x + w)} ${f(y + r - k)} ${f(x + w)} ${f(y + r)} c `
    + `${f(x + w)} ${f(y + h - r)} l ${f(x + w)} ${f(y + h - r + k)} ${f(x + w - r + k)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} c `
    + `${f(x + r)} ${f(y + h)} l ${f(x + r - k)} ${f(y + h)} ${f(x)} ${f(y + h - r + k)} ${f(x)} ${f(y + h - r)} c `
    + `${f(x)} ${f(y + r)} l ${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)} c h`;
}
const rgbOp = (hex, op) => hexRgb(hex).map((v) => f(v / 255)).join(' ') + ' ' + op;

// opacity: one ExtGState per value, collected in extraGs (name -> obj)
export function gsName(env, extraGs, ca, CA = ca) {
  if (ca >= 0.999 && CA >= 0.999) return '';
  const name = `PFA${Math.round(ca * 100)}_${Math.round(CA * 100)}`;
  if (!extraGs.has(name)) extraGs.set(name, env.doc.context.obj({ Type: PDFName.of('ExtGState'), ca, CA }));
  return `/${name} gs `;
}
// fill + border of a box; g = geometry (pt, UI coords), box spec
export function boxOps(env, extraGs, g, box) {
  const out = [];
  if (box.fc) out.push(`q ${gsName(env, extraGs, box.fo ?? 1)}${rgbOp(box.fc, 'rg')} ${boxPath(g)} f Q`);
  if (box.bc && box.bw > 0) {
    const i = box.bw / 2; // stroke grows outward so text and inner padding are never squeezed
    const gi = { ...g, x: g.x - i, y: g.y - i, w: g.w + 2 * i, h: g.h + 2 * i, r: g.r ? g.r + i : g.r };
    out.push(`q ${gsName(env, extraGs, 1, box.bo ?? 1)}${rgbOp(box.bc, 'RG')} ${f(box.bw)} w ${boxPath(gi)} S Q`);
  }
  return out;
}
