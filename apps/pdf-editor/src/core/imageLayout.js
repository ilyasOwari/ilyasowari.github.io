// Images inserted in a text block: 9-position anchor, optional wrap (text
// area narrows / moves) and caption. Returns the adjusted text area.
export function layoutImages(model, imgs) {
  const A = model.area;
  const area = { ...A };
  const W = A.right - A.left;
  const size = model.lines[0] ? model.lines[0].size : 11;
  const gap = Math.max(3, size * 0.4);
  const placed = [];
  for (const im of imgs || []) {
    const iw = Math.max(12, W * (im.width || 0.35));
    const ih = iw * (im.aspect || 0.75);
    const capSize = size * 0.85;
    const capH = im.caption ? capSize * 1.45 : 0;
    const col = im.anchor % 3, row = Math.floor(im.anchor / 3);
    const top = A.top, bottom = Math.max(A.bottom, A.top + ih + capH);
    const x = col === 0 ? A.left : col === 1 ? A.left + (W - iw) / 2 : A.right - iw;
    let y = row === 0 ? top : row === 1 ? (top + bottom) / 2 - (ih + capH) / 2 : bottom - ih - capH;
    if (im.wrap) {
      if (col === 0) area.left = Math.max(area.left, A.left + iw + gap);
      else if (col === 2) area.right = Math.min(area.right, A.right - iw - gap);
      else if (row === 2) area.lastBaseline -= ih + capH + gap;
      else { const sh = ih + capH + gap; area.top += sh; area.firstBaseline += sh; y = top; }
    }
    placed.push({ ...im, iw, ih, capH, capSize, x, y });
  }
  if (area.right - area.left < W * 0.25) { area.left = A.left; area.right = A.right; }
  return { area, placed };
}
