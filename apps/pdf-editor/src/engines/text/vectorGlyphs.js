// Vector fallback glyphs for symbols/icons missing from embedded PDF and fallback fonts.
// Normalized coordinates: u in [0..adv] left-to-right, v in [0..0.75] upward from baseline.

const ADV = {
  '→': 0.88, '←': 0.88, '↔': 0.92, '⇒': 0.90, '⇐': 0.90,
  '➔': 0.88, '➜': 0.88, '➝': 0.88, '➞': 0.88,
  '↑': 0.56, '↓': 0.56,
  '✓': 0.78, '✔': 0.82, '✕': 0.74, '✖': 0.78, '✗': 0.74, '✘': 0.78,
  '•': 0.42, '●': 0.68, '○': 0.68, '◦': 0.48,
  '■': 0.68, '□': 0.68, '▪': 0.48, '▫': 0.48,
  '▲': 0.74, '△': 0.74, '▼': 0.74, '▽': 0.74, '▶': 0.68, '◀': 0.68,
  '◆': 0.72, '◇': 0.72, '★': 0.84, '☆': 0.84,
  '×': 0.62, '÷': 0.62, '±': 0.62, '≈': 0.62, '≠': 0.62, '≤': 0.62, '≥': 0.62,
  '°': 0.42, '√': 0.68, '–': 0.55, '—': 0.95, '…': 0.88,
};

export function hasVectorGlyph(ch) {
  return Object.prototype.hasOwnProperty.call(ADV, ch);
}

export function vectorGlyphAdvance(ch) {
  return ADV[ch] || 0.75;
}

function strokeColorOf(fill, csAvailable, fillColorOps) {
  if (!fill || !fill.op) return '0 G';
  const op = fill.op;
  if (op === 'g' || op === 'rg' || op === 'k') return `${fill.args.join(' ')} ${op.toUpperCase()}`;
  const f = fillColorOps(fill, null, csAvailable);
  return f.replace(/\s([a-z]+)$/i, (_, s) => ' ' + s.toUpperCase());
}

function circlePath(pt, cx, cy, r) {
  const k = 0.5522847498 * r;
  const p = (dx, dy) => pt(cx + dx, cy + dy);
  return `${p(r, 0)} m ${p(r, k)} ${p(k, r)} ${p(0, r)} c ${p(-k, r)} ${p(-r, k)} ${p(-r, 0)} c ${p(-r, -k)} ${p(-k, -r)} ${p(0, -r)} c ${p(k, -r)} ${p(r, -k)} ${p(r, 0)} c h`;
}

function polyPath(pt, pts, close = true) {
  const segs = pts.map(([u, v], i) => `${pt(u, v)} ${i === 0 ? 'm' : 'l'}`);
  if (close) segs.push('h');
  return segs.join(' ');
}

export function vectorGlyphOps(ch, x, y, size, fill, synB, gs, toUser, csAvailable, fillColorOps, f) {
  const pt = (u, v) => {
    const [ux, uy] = toUser(x + u * size, y - v * size);
    return `${f(ux)} ${f(uy)}`;
  };
  const lw = Math.max(0.45, size * (synB ? 0.11 : 0.08));
  const fillCol = fillColorOps(fill, null, csAvailable);
  const strokeCol = strokeColorOf(fill, csAvailable, fillColorOps);
  const sOp = (d, w = lw) => `q ${gs}${strokeCol} ${f(w)} w 1 j 1 J ${d} S Q`;
  const fOp = (d) => `q ${gs}${fillCol} ${d} f Q`;

  switch (ch) {
    case '→': case '➔': case '➜': case '➝': case '➞':
      return [sOp(`${pt(0.08, 0.32)} m ${pt(0.76, 0.32)} l ${pt(0.54, 0.53)} m ${pt(0.78, 0.32)} l ${pt(0.54, 0.11)} l`)];
    case '←':
      return [sOp(`${pt(0.80, 0.32)} m ${pt(0.12, 0.32)} l ${pt(0.34, 0.53)} m ${pt(0.10, 0.32)} l ${pt(0.34, 0.11)} l`)];
    case '↔':
      return [sOp(`${pt(0.12, 0.32)} m ${pt(0.80, 0.32)} l ${pt(0.30, 0.50)} m ${pt(0.10, 0.32)} l ${pt(0.30, 0.14)} l ${pt(0.62, 0.50)} m ${pt(0.82, 0.32)} l ${pt(0.62, 0.14)} l`)];
    case '↑':
      return [sOp(`${pt(0.28, 0.06)} m ${pt(0.28, 0.66)} l ${pt(0.10, 0.46)} m ${pt(0.28, 0.68)} l ${pt(0.46, 0.46)} l`)];
    case '↓':
      return [sOp(`${pt(0.28, 0.68)} m ${pt(0.28, 0.08)} l ${pt(0.10, 0.28)} m ${pt(0.28, 0.06)} l ${pt(0.46, 0.28)} l`)];
    case '⇒':
      return [sOp(`${pt(0.08, 0.40)} m ${pt(0.66, 0.40)} l ${pt(0.08, 0.24)} m ${pt(0.66, 0.24)} l ${pt(0.54, 0.54)} m ${pt(0.82, 0.32)} l ${pt(0.54, 0.10)} l`)];
    case '⇐':
      return [sOp(`${pt(0.24, 0.40)} m ${pt(0.82, 0.40)} l ${pt(0.24, 0.24)} m ${pt(0.82, 0.24)} l ${pt(0.36, 0.54)} m ${pt(0.08, 0.32)} l ${pt(0.36, 0.10)} l`)];
    case '✓': case '✔':
      return [sOp(`${pt(0.10, 0.30)} m ${pt(0.32, 0.08)} l ${pt(0.70, 0.62)} l`, lw * (ch === '✔' ? 1.35 : 1.05))];
    case '✕': case '✖': case '✗': case '✘':
      return [sOp(`${pt(0.14, 0.10)} m ${pt(0.60, 0.58)} l ${pt(0.60, 0.10)} m ${pt(0.14, 0.58)} l`, lw * (ch === '✖' || ch === '✘' ? 1.3 : 1.0))];
    case '•':
      return [fOp(circlePath(pt, 0.21, 0.31, 0.13))];
    case '●':
      return [fOp(circlePath(pt, 0.34, 0.33, 0.25))];
    case '○':
      return [sOp(circlePath(pt, 0.34, 0.33, 0.24))];
    case '◦':
      return [sOp(circlePath(pt, 0.24, 0.31, 0.13))];
    case '■':
      return [fOp(polyPath(pt, [[0.10, 0.08], [0.58, 0.08], [0.58, 0.56], [0.10, 0.56]]))];
    case '□':
      return [sOp(polyPath(pt, [[0.10, 0.08], [0.58, 0.08], [0.58, 0.56], [0.10, 0.56]]))];
    case '▪':
      return [fOp(polyPath(pt, [[0.12, 0.18], [0.36, 0.18], [0.36, 0.42], [0.12, 0.42]]))];
    case '▫':
      return [sOp(polyPath(pt, [[0.12, 0.18], [0.36, 0.18], [0.36, 0.42], [0.12, 0.42]]))];
    case '▲':
      return [fOp(polyPath(pt, [[0.09, 0.08], [0.65, 0.08], [0.37, 0.62]]))];
    case '△':
      return [sOp(polyPath(pt, [[0.09, 0.08], [0.65, 0.08], [0.37, 0.62]]))];
    case '▼':
      return [fOp(polyPath(pt, [[0.09, 0.62], [0.65, 0.62], [0.37, 0.08]]))];
    case '▽':
      return [sOp(polyPath(pt, [[0.09, 0.62], [0.65, 0.62], [0.37, 0.08]]))];
    case '▶':
      return [fOp(polyPath(pt, [[0.12, 0.08], [0.12, 0.60], [0.58, 0.34]]))];
    case '◀':
      return [fOp(polyPath(pt, [[0.56, 0.08], [0.56, 0.60], [0.10, 0.34]]))];
    case '◆':
      return [fOp(polyPath(pt, [[0.36, 0.06], [0.64, 0.34], [0.36, 0.62], [0.08, 0.34]]))];
    case '◇':
      return [sOp(polyPath(pt, [[0.36, 0.06], [0.64, 0.34], [0.36, 0.62], [0.08, 0.34]]))];
    case '★': case '☆': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const ang = Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? 0.33 : 0.14;
        pts.push([0.42 + rad * Math.cos(ang), 0.35 + rad * Math.sin(ang)]);
      }
      return [ch === '★' ? fOp(polyPath(pt, pts)) : sOp(polyPath(pt, pts))];
    }
    case '×':
      return [sOp(`${pt(0.12, 0.14)} m ${pt(0.50, 0.52)} l ${pt(0.50, 0.14)} m ${pt(0.12, 0.52)} l`)];
    case '÷':
      return [
        sOp(`${pt(0.10, 0.33)} m ${pt(0.52, 0.33)} l`),
        fOp(circlePath(pt, 0.31, 0.52, 0.055)),
        fOp(circlePath(pt, 0.31, 0.14, 0.055)),
      ];
    case '±':
      return [sOp(`${pt(0.10, 0.39)} m ${pt(0.52, 0.39)} l ${pt(0.31, 0.20)} m ${pt(0.31, 0.58)} l ${pt(0.10, 0.12)} m ${pt(0.52, 0.12)} l`)];
    case '≠':
      return [sOp(`${pt(0.10, 0.42)} m ${pt(0.52, 0.42)} l ${pt(0.10, 0.24)} m ${pt(0.52, 0.24)} l ${pt(0.18, 0.10)} m ${pt(0.44, 0.56)} l`)];
    case '≤':
      return [sOp(`${pt(0.50, 0.58)} m ${pt(0.12, 0.39)} l ${pt(0.50, 0.20)} l ${pt(0.12, 0.10)} m ${pt(0.50, 0.10)} l`)];
    case '≥':
      return [sOp(`${pt(0.12, 0.58)} m ${pt(0.50, 0.39)} l ${pt(0.12, 0.20)} l ${pt(0.12, 0.10)} m ${pt(0.50, 0.10)} l`)];
    case '≈':
      return [sOp(`${pt(0.08, 0.40)} m ${pt(0.22, 0.48)} ${pt(0.40, 0.32)} ${pt(0.54, 0.40)} c ${pt(0.08, 0.24)} m ${pt(0.22, 0.32)} ${pt(0.40, 0.16)} ${pt(0.54, 0.24)} c`)];
    case '°':
      return [sOp(circlePath(pt, 0.21, 0.56, 0.10), lw * 0.85)];
    case '√':
      return [sOp(`${pt(0.06, 0.32)} m ${pt(0.22, 0.06)} l ${pt(0.44, 0.66)} l ${pt(0.64, 0.66)} l`)];
    case '–':
      return [sOp(`${pt(0.06, 0.30)} m ${pt(0.49, 0.30)} l`)];
    case '—':
      return [sOp(`${pt(0.05, 0.30)} m ${pt(0.90, 0.30)} l`)];
    case '…':
      return [
        fOp(circlePath(pt, 0.16, 0.08, 0.055)),
        fOp(circlePath(pt, 0.44, 0.08, 0.055)),
        fOp(circlePath(pt, 0.72, 0.08, 0.055)),
      ];
    default:
      return [];
  }
}
