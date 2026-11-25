// Character styles inside the editor paragraphs: <span data-rs='{"b":1,...}'>.
// Paragraph content is always read back as characters + style and re-rendered
// from that, so the DOM never collects stray formatting.
import { h } from '../common/dom.js';

const cleanBg = (b) => {
  if (!b || (!b.fc && !b.bc)) return null;
  return { shape: b.shape || 'round', fc: b.fc || null, fo: b.fo ?? 1, bc: b.bc || null, bw: b.bw ?? 1.5, bo: b.bo ?? 1 };
};
const clean = (s) => { const o = {}; if (!s) return null; for (const k of ['b', 'i', 'u']) if (s[k]) o[k] = 1; if (s.c) o.c = s.c; if (s.z > 0) o.z = Math.round(Number(s.z) * 10) / 10; else if (s.k && Math.abs(s.k - 1) > 0.001) o.k = s.k; if (s.f) o.f = s.f; if (s.v === 'sup' || s.v === 'sub') o.v = s.v; if (s.link) o.link = String(s.link); if (Number(s.ls)) o.ls = Number(s.ls); const bg = cleanBg(s.bg); if (bg) o.bg = bg; return Object.keys(o).length ? o : null; };
export const sig = (s) => JSON.stringify(clean(s) || {});

export function readPara(d) {
  const chars = [];
  const walk = (n, st) => {
    if (n.nodeType === 3) { for (const ch of Array.from(n.data)) chars.push({ ch: ch === '\u00a0' ? ' ' : ch, s: st }); return; }
    if (n.nodeType !== 1) return;
    if (n.tagName === 'BR') { chars.push({ ch: '\n', s: null }); return; }
    let s2 = st;
    if (n.dataset && n.dataset.rs) { try { s2 = { ...(st || {}), ...JSON.parse(n.dataset.rs) }; } catch (e) { /* ignore */ } }
    for (const c of n.childNodes) walk(c, s2);
  };
  for (const c of d.childNodes) walk(c, null);
  if (chars.length && chars[chars.length - 1].ch === '\n') chars.pop();
  return chars.map((c) => ({ ch: c.ch, s: clean(c.s) }));
}

let fontCss = (f) => null;
export function setFontCss(fn) { fontCss = fn; }
export function cssOf(s) {
  const st = {};
  if (s.b) st.fontWeight = '700';
  if (s.i) st.fontStyle = 'italic';
  if (s.u || s.link) st.textDecoration = 'underline';
  if (s.c) st.color = s.c;
  else if (s.link) st.color = '#1d4ed8';
  // z: absolute size in pt, shown relative to the paragraph's original size (--bs)
  const rel = (f) => (s.z > 0 ? `calc(${+(s.z * f).toFixed(2)}em / var(--bs, ${s.z}))` : Math.round((s.k || 1) * f * 100) + '%');
  if (s.z > 0 || s.k) st.fontSize = rel(1);
  if (s.v) { st.verticalAlign = s.v === 'sup' ? 'super' : 'sub'; st.fontSize = rel(0.65); }
  if (s.f) { const fam = fontCss(s.f); if (fam) st.fontFamily = fam; }
  if (s.bg) {
    const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
    if (s.bg.fc) st.backgroundColor = rgba(s.bg.fc, s.bg.fo ?? 1);
    if (s.bg.bc && (s.bg.bw || 0) > 0) st.boxShadow = `inset 0 0 0 ${Math.max(1, s.bg.bw)}px ${rgba(s.bg.bc, s.bg.bo ?? 1)}`;
    st.borderRadius = s.bg.shape === 'sharp' ? '0px' : s.bg.shape === 'oval' ? '999px' : '4px';
    st.padding = '1px 3px';
    st.boxDecorationBreak = 'clone';
  }
  return st;
}
export function renderPara(d, chars, breakSet = null) {
  d.textContent = '';
  const hasBreaks = !!(breakSet && breakSet.size);
  let i = 0;
  while (i < chars.length) {
    if (chars[i].ch === '\n') { d.append(h('br')); i++; continue; }
    const k = sig(chars[i].s);
    if (hasBreaks && breakSet.has(i)) {
      const sp = k === '{}' ? h('span', { class: 'te-lb' }) : h('span', { class: 'te-lb', 'data-rs': k, style: cssOf(chars[i].s) });
      sp.textContent = chars[i].ch;
      d.append(sp);
      i++;
      continue;
    }
    let j = i; let txt = '';
    while (j < chars.length && chars[j].ch !== '\n' && !(hasBreaks && breakSet.has(j)) && sig(chars[j].s) === k) { txt += chars[j].ch; j++; }
    if (k === '{}') d.append(document.createTextNode(txt));
    else { const sp = h('span', { 'data-rs': k, style: cssOf(chars[i].s) }); sp.textContent = txt; d.append(sp); }
    i = j;
  }
  d.dataset.lbKey = hasBreaks ? [...breakSet].sort((a, b) => a - b).join(',') : '';
  if (!chars.length || chars[chars.length - 1].ch === '\n') d.append(h('br'));
}
// paragraph -> engine ranges [{a,b,s}] (indexes over Array.from(text))
export function rangesOf(chars) {
  const out = [];
  chars.forEach((c, i) => {
    if (!c.s) return;
    const last = out[out.length - 1];
    if (last && last.b === i && sig(last.s) === sig(c.s)) last.b = i + 1;
    else out.push({ a: i, b: i + 1, s: { ...c.s } });
  });
  return out;
}
export function charsFrom(text, st) {
  const arr = Array.from(text).map((ch) => ({ ch, s: null }));
  for (const r of st || []) for (let i = r.a; i < r.b && i < arr.length; i++) arr[i].s = clean({ ...(arr[i].s || {}), ...r.s });
  return arr;
}
// character offset of a DOM point inside a paragraph (same counting as readPara)
export function offsetIn(d, node, off) {
  let n = 0, done = false;
  const walk = (x) => {
    if (done) return;
    if (x === node && x.nodeType === 3) { n += Array.from(x.data.slice(0, off)).length; done = true; return; }
    if (x === node) { for (let i = 0; i < off && i < x.childNodes.length; i++) walk(x.childNodes[i]); done = true; return; }
    if (x.nodeType === 3) { n += Array.from(x.data).length; return; }
    if (x.nodeType === 1 && x.tagName === 'BR') { n += 1; return; }
    for (const c of x.childNodes) { walk(c); if (done) return; }
  };
  if (node === d) { for (let i = 0; i < off && i < d.childNodes.length; i++) walk(d.childNodes[i]); return n; }
  for (const c of d.childNodes) { walk(c); if (done) break; }
  return n;
}
export function pointAt(d, target, startSide = false) {
  let n = 0;
  const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let last = null;
  for (let x = walker.nextNode(); x; x = walker.nextNode()) {
    if (x.nodeType === 3) {
      const arr = Array.from(x.data);
      if (startSide ? n + arr.length > target : n + arr.length >= target) return [x, arr.slice(0, target - n).join('').length];
      n += arr.length; last = x;
    } else if (x.tagName === 'BR') { if (n === target) return [x.parentNode, [...x.parentNode.childNodes].indexOf(x)]; n += 1; }
  }
  return last ? [last, last.data.length] : [d, 0];
}
