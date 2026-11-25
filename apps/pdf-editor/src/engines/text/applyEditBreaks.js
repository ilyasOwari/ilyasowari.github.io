// Line-break preservation and single-line centering/alignment helpers for applyEdit.js.
import { layoutText } from './layout.js';
import { styleSig } from './richStyle.js';

export function parasFromText(model) {
  const t = model.text;
  return t.split('\n').map((text) => ({ text, marker: true }));
}

export function perCharSigs(st, n) {
  const arr = new Array(n).fill(null);
  for (const r of st || []) for (let i = r.a; i < r.b && i < n; i++) arr[i] = { ...(arr[i] || {}), ...r.s };
  return arr.map((x) => styleSig(x));
}

function addForcedBreak(set, pi, ci, text) {
  const arr = Array.from(text), plen = arr.length;
  if (ci <= 0 || ci >= plen) return;
  let c = ci;
  while (c < plen && arr[c] === ' ') c++;
  set.add(`${pi}:${c - 1}`);
}

export function forcedBreaks(model, newParas, firstDiff) {
  const set = new Set();
  if (model.keepLineBreaks && newParas.map((p) => p.text).join('\n') === model.text) {
    const starts = [];
    let acc = 0;
    newParas.forEach((p) => { starts.push(acc); acc += Array.from(p.text).length + 1; });
    for (const end of model.lineEndAt) {
      let pi = starts.length - 1;
      while (pi > 0 && starts[pi] > end) pi--;
      addForcedBreak(set, pi, end - starts[pi], newParas[pi].text);
    }
    return set;
  }
  const origParas = (model.origText ?? model.text).split('\n');
  if (newParas.length === origParas.length) {
    const origStarts = [];
    let acc = 0;
    origParas.forEach((p) => { origStarts.push(acc); acc += Array.from(p).length + 1; });
    const pDiffs = newParas.map((p, pi) => {
      const a0 = Array.from(origParas[pi]), b0 = Array.from(p.text);
      let d = 0;
      while (d < a0.length && d < b0.length && a0[d] === b0[d]) d++;
      if (d === a0.length && d === b0.length) d = Infinity;
      const initSig = model.initStSigs ? model.initStSigs[pi] : undefined;
      if (initSig !== undefined && JSON.stringify(p.st || []) !== initSig) {
        let init = [];
        try { init = initSig ? JSON.parse(initSig) : []; } catch { init = []; }
        const s0 = perCharSigs(init, b0.length), s1 = perCharSigs(p.st, b0.length);
        const at = s1.findIndex((v, i) => v !== s0[i]);
        d = Math.min(d, at >= 0 ? at : Math.max(0, b0.length - 1));
      }
      return d;
    });
    for (const end of model.lineEndAt) {
      let pi = origStarts.length - 1;
      while (pi > 0 && origStarts[pi] > end) pi--;
      if (newParas[pi] && newParas[pi].align === 'justify') continue;
      const ci = end - origStarts[pi];
      if (ci < pDiffs[pi]) addForcedBreak(set, pi, ci, newParas[pi].text);
    }
    return set;
  }
  const starts = [];
  let acc = 0;
  newParas.forEach((p) => { starts.push(acc); acc += Array.from(p.text).length + 1; });
  for (const end of model.lineEndAt) {
    if (end >= firstDiff) break;
    let pi = starts.length - 1;
    while (pi > 0 && starts[pi] > end) pi--;
    addForcedBreak(set, pi, end - starts[pi], newParas[pi].text);
  }
  return set;
}

export function layoutOneLine(model, para, k, shift = 0, extraL = 0, extraR = 0) {
  const L = layoutText(model, [para], k, { forced: new Set(), noWrap: true });
  // merge all wrapped lines into one (noWrap)
  const items = L.lines.flatMap((l) => l.items);
  let x = (para.align || model.badge || !model.lines[0] ? model.area.left : model.lines[0].left) - extraL;
  const trimmed = items.slice();
  if (!model.badge) while (trimmed.length && trimmed[trimmed.length - 1].ch === ' ') trimmed.pop();
  const width = trimmed.reduce((s, c) => s + c.w, 0);
  if (para.align) {
    const leftB = model.area.left - extraL;
    const rightB = model.area.right + extraR;
    if (width > rightB - leftB) x = leftB;
    else if (para.align === 'center') x = leftB + (rightB - leftB - width) / 2;
    else if (para.align === 'right') x = rightB - width;
    else x = leftB;
  } else if (model.align === 'center' || model.badge) {
    const cx0 = (model.badge && model.container) || !model.lines[0]
      ? (model.container ? (model.container.x0 + model.container.x1) / 2 : (model.area.left + model.area.right) / 2)
      : (model.lines[0].left + model.lines[0].right) / 2;
    x = cx0 + shift + (extraR - extraL) / 2 - width / 2;
  }
  if (model.badge) {
    const leftBound = model.area.left - extraL;
    const availW = (model.area.right - model.area.left) + extraL + extraR;
    if (width <= availW + 0.05) x = Math.max(leftBound, Math.min(leftBound + availW - width, x));
    else x = leftBound;
  }
  let cx = x;
  for (const c of items) { c.x = cx; cx += c.w; }
  return { pi: 0, items, x, width, baseline: L.lines[0] ? L.lines[0].baseline : model.area.firstBaseline, text: items.map((c) => c.ch).join('') };
}
