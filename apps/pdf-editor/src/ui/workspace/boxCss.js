// A positioned div that shows a box (fill / border / shape) like the PDF does.
import { h } from '../common/dom.js';
import { hexRgb } from '../../engines/text/insertedLayout.js';

const rgba = (hex, a) => `rgba(${hexRgb(hex).join(',')},${a})`;
export function boxCss(g, box, z, s = 1) {
  const el = h('div', { class: 'box-deco', 'data-testid': 'box-deco' });
  Object.assign(el.style, {
    left: g.x * z + 'px', top: g.y * z + 'px', width: g.w * z + 'px', height: g.h * z + 'px',
    borderRadius: g.oval ? '50%' : (g.r || 0) * z + 'px',
    background: box.fc ? rgba(box.fc, box.fo ?? 1) : 'transparent',
    border: box.bc && box.bw > 0 ? `${box.bw * s * z}px solid ${rgba(box.bc, box.bo ?? 1)}` : '0',
  });
  return el;
}
