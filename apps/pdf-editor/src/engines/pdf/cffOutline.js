// Minimal, read-only CFF (Type 2 charstring) reader: glyph names / CIDs and
// glyph outlines as flattened polygons. Used to recover the meaning of glyphs a
// PDF maps to no (or a broken) Unicode value. Never used for drawing.
import { CFF_STD_STRINGS } from './cffStdStrings.js';

function readIndex(b, pos) {
  const count = (b[pos] << 8) | b[pos + 1];
  if (!count) return { items: [], end: pos + 2 };
  const offSize = b[pos + 2];
  const offs = [];
  let p = pos + 3;
  for (let i = 0; i <= count; i++) {
    let v = 0;
    for (let k = 0; k < offSize; k++) v = (v << 8) | b[p++];
    offs.push(v);
  }
  const base = p - 1;
  const items = [];
  for (let i = 0; i < count; i++) items.push([base + offs[i], base + offs[i + 1]]);
  return { items, end: base + offs[count] };
}

function readDict(b, start, end) {
  const d = {};
  const ops = [];
  let p = start;
  while (p < end) {
    const v = b[p];
    if (v <= 21) {
      let key = v; p++;
      if (v === 12) { key = 1200 + b[p]; p++; }
      d[key] = ops.splice(0);
    } else if (v === 28) { ops.push(((b[p + 1] << 24) >> 16) | b[p + 2]); p += 3; }
    else if (v === 29) { ops.push((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]); p += 5; }
    else if (v === 30) {
      let s = ''; p++;
      const nib = '0123456789.EE?-?';
      for (;;) {
        const x = b[p++]; const hi = x >> 4, lo = x & 15;
        if (hi === 15) break; s += hi === 12 ? 'E-' : nib[hi];
        if (lo === 15) break; s += lo === 12 ? 'E-' : nib[lo];
      }
      ops.push(parseFloat(s) || 0);
    } else if (v >= 32 && v <= 246) { ops.push(v - 139); p++; }
    else if (v >= 247 && v <= 250) { ops.push((v - 247) * 256 + b[p + 1] + 108); p += 2; }
    else if (v >= 251 && v <= 254) { ops.push(-(v - 251) * 256 - b[p + 1] - 108); p += 2; }
    else p++;
  }
  return d;
}

const bias = (n) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

export function parseCFF(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const hdrSize = b[2];
  const names = readIndex(b, hdrSize);
  const tops = readIndex(b, names.end);
  const strings = readIndex(b, tops.end);
  const gsubrIdx = readIndex(b, strings.end);
  const str = (sid) => {
    if (sid < CFF_STD_STRINGS.length) return CFF_STD_STRINGS[sid];
    const it = strings.items[sid - CFF_STD_STRINGS.length];
    if (!it) return null;
    let s = ''; for (let i = it[0]; i < it[1]; i++) s += String.fromCharCode(b[i]);
    return s;
  };
  const [ts, te] = tops.items[0];
  const top = readDict(b, ts, te);
  if (top[1206] && top[1206][0] !== 2) throw new Error('charstring type');
  const cs = readIndex(b, top[17][0]);
  const nGlyphs = cs.items.length;
  const isCID = !!top[1230];
  // charset: gid -> sid (name-keyed) or cid
  const charset = new Array(nGlyphs).fill(0);
  const csOff = top[15] ? top[15][0] : 0;
  if (csOff > 2) {
    let p = csOff; const fmt = b[p++];
    let gid = 1;
    if (fmt === 0) { while (gid < nGlyphs) { charset[gid++] = (b[p] << 8) | b[p + 1]; p += 2; } }
    else {
      while (gid < nGlyphs) {
        const first = (b[p] << 8) | b[p + 1]; p += 2;
        const nLeft = fmt === 1 ? b[p++] : ((b[p] << 8) | b[p + 1]); if (fmt !== 1) p += 2;
        for (let k = 0; k <= nLeft && gid < nGlyphs; k++) charset[gid++] = first + k;
      }
    }
  } else {
    for (let g = 1; g < nGlyphs; g++) charset[g] = g; // ISOAdobe approximation
  }
  const privOf = (dict) => {
    if (!dict[18]) return { subrs: [], bias: 0 };
    const [size, off] = dict[18];
    const pd = readDict(b, off, off + size);
    const subrs = pd[19] ? readIndex(b, off + pd[19][0]).items : [];
    return { subrs, bias: bias(subrs.length) };
  };
  let fds = null, fdSelect = null;
  if (isCID && top[1236]) {
    fds = readIndex(b, top[1236][0]).items.map(([s, e]) => privOf(readDict(b, s, e)));
    fdSelect = new Uint8Array(nGlyphs);
    let p = top[1237][0]; const fmt = b[p++];
    if (fmt === 0) { for (let g = 0; g < nGlyphs; g++) fdSelect[g] = b[p++]; }
    else if (fmt === 3) {
      const nR = (b[p] << 8) | b[p + 1]; p += 2;
      let first = (b[p] << 8) | b[p + 1]; p += 2;
      for (let r = 0; r < nR; r++) {
        const fd = b[p++]; const next = (b[p] << 8) | b[p + 1]; p += 2;
        for (let g = first; g < next && g < nGlyphs; g++) fdSelect[g] = fd;
        first = next;
      }
    }
  }
  const priv = isCID ? null : privOf(top);
  const gsubrs = gsubrIdx.items, gbias = bias(gsubrs.length);
  const cidToGid = isCID ? new Map(charset.map((cid, g) => [cid, g])) : null;
  return {
    isCID, nGlyphs,
    glyphName: (gid) => (isCID ? null : gid === 0 ? '.notdef' : str(charset[gid])),
    gidForCID: (cid) => (isCID ? (cidToGid.get(cid) ?? -1) : cid),
    gidForName: (name) => { if (isCID) return -1; for (let g = 1; g < nGlyphs; g++) if (str(charset[g]) === name) return g; return -1; },
    outline: (gid) => (gid >= 0 && gid < nGlyphs ? runCharstring(b, cs.items[gid], gsubrs, gbias, isCID ? fds[fdSelect[gid]] || fds[0] : priv) : null),
  };
}

// Type 2 charstring interpreter -> array of contours, each an array of [x, y]
// (curves flattened to 6 segments; font units).
function runCharstring(b, range, gsubrs, gbias, priv) {
  const contours = [];
  let cur = null;
  let x = 0, y = 0, nStems = 0, haveWidth = false;
  const st = [];
  const moveTo = (nx, ny) => { if (cur && cur.length > 1) contours.push(cur); x = nx; y = ny; cur = [[x, y]]; };
  const lineTo = (nx, ny) => { x = nx; y = ny; if (!cur) cur = [[x, y]]; cur.push([x, y]); };
  const curveTo = (x1, y1, x2, y2, x3, y3) => {
    if (!cur) cur = [[x, y]];
    const x0 = x, y0 = y;
    for (let i = 1; i <= 6; i++) {
      const t = i / 6, u = 1 - t;
      cur.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
    x = x3; y = y3;
  };
  const stems = () => { if (st.length % 2 && !haveWidth) st.shift(); haveWidth = true; nStems += st.length >> 1; st.length = 0; };
  let depth = 0, ended = false;
  const exec = (s, e) => {
    if (++depth > 12) return;
    let p = s;
    while (p < e && !ended) {
      const v = b[p++];
      if (v >= 32) {
        if (v <= 246) st.push(v - 139);
        else if (v <= 250) st.push((v - 247) * 256 + b[p++] + 108);
        else if (v <= 254) st.push(-(v - 251) * 256 - b[p++] - 108);
        else { st.push(((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) / 65536); p += 4; }
        continue;
      }
      if (v === 28) { st.push(((b[p] << 24) >> 16) | b[p + 1]); p += 2; continue; }
      switch (v) {
        case 1: case 3: case 18: case 23: stems(); break;
        case 19: case 20: stems(); p += (nStems + 7) >> 3; break;
        case 21: if (st.length > 2 && !haveWidth) st.shift(); haveWidth = true; moveTo(x + st[0], y + st[1]); st.length = 0; break;
        case 22: if (st.length > 1 && !haveWidth) st.shift(); haveWidth = true; moveTo(x + st[0], y); st.length = 0; break;
        case 4: if (st.length > 1 && !haveWidth) st.shift(); haveWidth = true; moveTo(x, y + st[0]); st.length = 0; break;
        case 5: for (let i = 0; i + 1 < st.length; i += 2) lineTo(x + st[i], y + st[i + 1]); st.length = 0; break;
        case 6: case 7: {
          let h = v === 6;
          for (let i = 0; i < st.length; i++) { if (h) lineTo(x + st[i], y); else lineTo(x, y + st[i]); h = !h; }
          st.length = 0; break;
        }
        case 8: for (let i = 0; i + 5 < st.length; i += 6) curveTo(x + st[i], y + st[i + 1], x + st[i] + st[i + 2], y + st[i + 1] + st[i + 3], x + st[i] + st[i + 2] + st[i + 4], y + st[i + 1] + st[i + 3] + st[i + 5]); st.length = 0; break;
        case 24: {
          let i = 0;
          for (; i + 5 < st.length - 2; i += 6) curveTo(x + st[i], y + st[i + 1], x + st[i] + st[i + 2], y + st[i + 1] + st[i + 3], x + st[i] + st[i + 2] + st[i + 4], y + st[i + 1] + st[i + 3] + st[i + 5]);
          lineTo(x + st[i], y + st[i + 1]); st.length = 0; break;
        }
        case 25: {
          let i = 0;
          for (; i + 1 < st.length - 6; i += 2) lineTo(x + st[i], y + st[i + 1]);
          curveTo(x + st[i], y + st[i + 1], x + st[i] + st[i + 2], y + st[i + 1] + st[i + 3], x + st[i] + st[i + 2] + st[i + 4], y + st[i + 1] + st[i + 3] + st[i + 5]);
          st.length = 0; break;
        }
        case 26: case 27: {
          let i = 0; let d1 = 0;
          if (st.length % 4) d1 = st[i++];
          for (; i + 3 < st.length; i += 4) {
            if (v === 26) { curveTo(x + d1, y + st[i], x + d1 + st[i + 1], y + st[i] + st[i + 2], x + d1 + st[i + 1], y + st[i] + st[i + 2] + st[i + 3]); }
            else { curveTo(x + st[i], y + d1, x + st[i] + st[i + 1], y + d1 + st[i + 2], x + st[i] + st[i + 1] + st[i + 3], y + d1 + st[i + 2]); }
            d1 = 0;
          }
          st.length = 0; break;
        }
        case 30: case 31: {
          let h = v === 31; let i = 0;
          while (i + 3 < st.length) {
            const last = st.length - i === 5;
            if (h) { const dx3 = st[i + 3]; curveTo(x + st[i], y, x + st[i] + st[i + 1], y + st[i + 2], x + st[i] + st[i + 1] + (last ? st[i + 4] : 0), y + st[i + 2] + dx3); i += last ? 5 : 4; }
            else { const dy3 = st[i + 3]; curveTo(x, y + st[i], x + st[i + 1], y + st[i] + st[i + 2], x + st[i + 1] + dy3, y + st[i] + st[i + 2] + (last ? st[i + 4] : 0)); i += last ? 5 : 4; }
            h = !h;
          }
          st.length = 0; break;
        }
        case 10: { const n = st.pop() + priv.bias; const r = priv.subrs[n]; if (r) exec(r[0], r[1]); break; }
        case 29: { const n = st.pop() + gbias; const r = gsubrs[n]; if (r) exec(r[0], r[1]); break; }
        case 11: depth--; return;
        case 14: if (st.length % 2 && !haveWidth) st.shift(); ended = true; break;
        case 12: {
          const w = b[p++];
          const a = st;
          if (w === 35) { curveTo(x + a[0], y + a[1], x + a[0] + a[2], y + a[1] + a[3], x + a[0] + a[2] + a[4], y + a[1] + a[3] + a[5]); curveTo(x + a[6], y + a[7], x + a[6] + a[8], y + a[7] + a[9], x + a[6] + a[8] + a[10], y + a[7] + a[9] + a[11]); }
          else if (w === 34) { const y0 = y; curveTo(x + a[0], y, x + a[0] + a[1], y + a[2], x + a[0] + a[1] + a[3], y + a[2]); curveTo(x + a[4], y, x + a[4] + a[5], y0, x + a[4] + a[5] + a[6], y0); }
          else if (w === 36) { const y0 = y; curveTo(x + a[0], y + a[1], x + a[0] + a[2], y + a[1] + a[3], x + a[0] + a[2] + a[4], y + a[1] + a[3]); curveTo(x + a[5], y, x + a[5] + a[6], y + a[7], x + a[5] + a[6] + a[7 + 1], y0); }
          else if (w === 37) { const sx = x, sy = y; const c1x = x + a[0], c1y = y + a[1], c2x = c1x + a[2], c2y = c1y + a[3], ex = c2x + a[4], ey = c2y + a[5]; curveTo(c1x, c1y, c2x, c2y, ex, ey); const c3x = x + a[6], c3y = y + a[7], c4x = c3x + a[8], c4y = c3y + a[9]; const dx = c4x - sx, dy = c4y - sy; if (Math.abs(dx) > Math.abs(dy)) curveTo(c3x, c3y, c4x, c4y, c4x + a[10], sy); else curveTo(c3x, c3y, c4x, c4y, sx, c4y + a[10]); }
          st.length = 0; break;
        }
        default: st.length = 0;
      }
    }
    depth--;
  };
  exec(range[0], range[1]);
  if (cur && cur.length > 1) contours.push(cur);
  return contours;
}
