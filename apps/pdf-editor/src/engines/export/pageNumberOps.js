// Page number text on the output page.
import { fmtNum as f } from '../pdf/lexer.js';
import { pageNumberSpot } from '../../model/pageNumbers.js';
export const PAGE_NUM_FONT = 'Carlito-Regular.ttf';
export async function pageNumberOps(env, an, page, cfg, text, extraFonts) {
  const pf = await env.fonts.get(PAGE_NUM_FONT);
  extraFonts.set(pf.name, pf.font.ref);
  const w = pf.font.widthOfTextAtSize(text, cfg.size);
  const p = pageNumberSpot(cfg, page, w);
  return [`q ${an.Minv.map(f).join(' ')} cm 0.2 0.2 0.25 rg BT /${pf.name} 1 Tf ${f(cfg.size)} 0 0 ${f(-cfg.size)} ${f(p.x)} ${f(p.y)} Tm ${pf.font.encodeText(text).toString()} Tj ET Q`];
}
