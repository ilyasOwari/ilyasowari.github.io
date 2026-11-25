// Layer 4 helper: compare one extracted line with what OCR read from the
// page image and take ONLY the corrections the earlier layers asked about:
//   - a broken character (U+0000, U+FFFD, private use ...) gets the letter
//     OCR saw in its place,
//   - a flagged gap (vector-drawn letter, layer 3) gets the ONE letter OCR saw
//     there, with OCR's spacing around it.
// Everything else OCR says is ignored (OCR makes its own mistakes), and the
// line is left alone when the two readings do not agree well overall.
import { isBadUni } from '../pdf/glyphRecover.js';

const LETTER = /^\p{L}$/u;
const fold = (c) => c.replace(/[“”„″]/g, '"').replace(/[‘’‚′`]/g, "'").replace(/[–—−]/g, '-');

// the drawn shape must fit the letter OCR names: a short (x-height) stem is
// not an "l", a tall one is not an "o"
const ASC = /^[bdfhklt\p{Lu}\p{N}]$/u, XONLY = /^[acemnorsuvwxzıiöüğ]$/u;
const fitsShape = (ch, bodyH) => bodyH == null || !((ASC.test(ch) && bodyH < 0.6) || (XONLY.test(ch) && bodyH > 0.66));

// lineText: string; ocrText: string; gaps: [index in lineText right after the
// glyph that a gap follows, or { pos, bodyH (main shape height / font size) }]
export function proposeLineFix(lineText, ocrText, { gaps = [], minSim = 0.8 } = {}) {
  const M = [];
  [...lineText].reduce((i, ch) => { if (!/\s/.test(ch)) M.push({ ch, i, bad: isBadUni(ch) }); return i + ch.length; }, 0);
  const O = [];
  let sp = false;
  for (const ch of [...(ocrText || '').normalize('NFC')]) { if (/\s/.test(ch)) { sp = O.length > 0; continue; } O.push({ ch, sp }); sp = false; }
  if (!M.length || !O.length) return null;
  const n = M.length, m = O.length;
  const eq = (a, b) => fold(a.ch) === fold(b.ch);
  const cost = (a, b) => (eq(a, b) ? 0 : (a.bad && LETTER.test(b.ch) ? 0 : 1));
  const D = Array.from({ length: n + 1 }, (_, i) => { const r = new Uint16Array(m + 1); r[0] = i; return r; });
  for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + cost(M[i - 1], O[j - 1]), D[i - 1][j] + 1, D[i][j - 1] + 1);
  // backtrace -> pairs
  const ops = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + cost(M[i - 1], O[j - 1])) { ops.push({ t: 'pair', a: i - 1, b: j - 1 }); i--; j--; }
    else if (j > 0 && D[i][j] === D[i][j - 1] + 1) { ops.push({ t: 'ins', a: i, b: j - 1 }); j--; } // OCR char before M[i]
    else { ops.push({ t: 'del', a: i - 1 }); i--; }
  }
  ops.reverse();
  const nBad = M.filter((x) => x.bad).length;
  const matches = ops.filter((o) => o.t === 'pair' && !M[o.a].bad && eq(M[o.a], O[o.b])).length;
  const edits = []; // { at, del, ins }
  for (const o of ops) if (o.t === 'pair' && M[o.a].bad && LETTER.test(O[o.b].ch)) edits.push({ at: M[o.a].i, del: M[o.a].ch.length, ins: O[o.b].ch, kind: 'char' });
  // insertions: group consecutive OCR chars inserted at the same place
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].t !== 'ins') continue;
    let e = k; while (e + 1 < ops.length && ops[e + 1].t === 'ins' && ops[e + 1].a === ops[k].a) e++;
    const run = ops.slice(k, e + 1).map((o) => O[o.b]);
    const ai = ops[k].a; // inserted before M[ai] (ai === n: at the line end)
    k = e;
    if (run.length !== 1 || !LETTER.test(run[0].ch) || ai === 0) continue;
    const prev = M[ai - 1], next = M[ai] || null;
    const from = prev.i + prev.ch.length, to = next ? next.i : lineText.length;
    const gap = gaps.map((g) => (typeof g === 'number' ? { pos: g } : g)).find((g) => g.pos >= from && g.pos <= to);
    if (!gap || !fitsShape(run[0].ch, gap.bodyH)) continue;
    if (!LETTER.test(prev.ch) || (next && !/^[\p{L}\p{N})\]'".,:;!?-]$/u.test(next.ch))) continue;
    const nextOcr = ops.find((o) => o.t === 'pair' && o.a === ai);
    const ins = (run[0].sp ? ' ' : '') + run[0].ch + (next && nextOcr && O[nextOcr.b].sp ? ' ' : '');
    edits.push({ at: from, del: to - from - (next ? 0 : (lineText.length - to)), ins, kind: 'gap' });
  }
  const pairedBad = ops.filter((o) => o.t === 'pair' && M[o.a].bad).length;
  const gapIns = edits.filter((e) => e.kind === 'gap').length;
  const sim = (2 * matches) / Math.max(1, (n - nBad) + (m - pairedBad - gapIns));
  if (sim < minSim || !edits.length) return null;
  edits.sort((p, q) => q.at - p.at);
  let text = lineText;
  for (const e of edits) text = text.slice(0, e.at) + e.ins + text.slice(e.at + e.del);
  return { text, edits: edits.reverse(), sim };
}
