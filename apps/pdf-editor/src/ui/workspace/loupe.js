// Magnifier next to the scissors cursor: shows the exact cut point enlarged.
import { h } from '../common/dom.js';
import { composeRegion } from './compose.js';

const SIZE = 132, MAG = 3;
export class Loupe {
  constructor(view) {
    this.view = view;
    this.c = h('canvas', { class: 'loupe', 'data-testid': 'loupe' });
  }
  show(p, R) {
    const v = this.view, z = v.z, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const span = SIZE / (z * MAG); // page pt shown across the loupe
    const rect = { x: p.x - span / 2, y: p.y - span / 2, w: span, h: span };
    const px = (SIZE * dpr) / span;
    const src = composeRegion(v, rect, px);
    const c = this.c;
    c.width = SIZE * dpr; c.height = SIZE * dpr;
    const g = c.getContext('2d');
    g.save();
    g.beginPath(); g.arc(c.width / 2, c.height / 2, c.width / 2 - 1, 0, Math.PI * 2); g.clip();
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    // the cut lines through the point, clipped to the block
    g.strokeStyle = '#e0282e'; g.lineWidth = 1.5 * dpr; g.setLineDash([5 * dpr, 3 * dpr]);
    const X = (x) => (x - rect.x) * px, Y = (y) => (y - rect.y) * px;
    g.beginPath();
    g.moveTo(Math.max(0, X(R.x)), Y(p.y)); g.lineTo(Math.min(c.width, X(R.x + R.w)), Y(p.y));
    g.moveTo(X(p.x), Math.max(0, Y(R.y))); g.lineTo(X(p.x), Math.min(c.height, Y(R.y + R.h)));
    g.stroke();
    g.restore();
    g.beginPath(); g.arc(c.width / 2, c.height / 2, c.width / 2 - 1, 0, Math.PI * 2); g.strokeStyle = 'rgba(30,30,40,.55)'; g.lineWidth = 2 * dpr; g.setLineDash([]); g.stroke();
    // up-right of the cursor; flip to the left / below near the page edge
    let left = p.x * z + 22, top = p.y * z - SIZE - 22;
    if (left + SIZE > v.page.w * z) left = p.x * z - SIZE - 22;
    if (top < 0) top = p.y * z + 22;
    Object.assign(c.style, { left: left + 'px', top: top + 'px', width: SIZE + 'px', height: SIZE + 'px' });
    if (c.parentNode !== v.el) v.el.append(c);
  }
  hide() { this.c.remove(); }
}
