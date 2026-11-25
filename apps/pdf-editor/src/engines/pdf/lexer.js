// Content-stream tokenizer. Produces operator records that keep the raw byte
// range of every operator (operands included) so untouched operators can be
// copied back byte-for-byte when a stream is rewritten.

const WS = new Uint8Array(256);
[0, 9, 10, 12, 13, 32].forEach((c) => { WS[c] = 1; });
const DELIM = new Uint8Array(256);
'()<>[]{}/%'.split('').forEach((ch) => { DELIM[ch.charCodeAt(0)] = 1; });

export class PdfName { constructor(n) { this.n = n; } }
export class PdfStr { constructor(bytes, hex) { this.bytes = bytes; this.hex = hex; } }
export class PdfOpTok { constructor(v) { this.v = v; } }

function decodeName(raw) {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function tokenize(bytes) {
  const n = bytes.length;
  let i = 0;
  const ops = [];
  const stack = [];          // operand stack (may contain nested arrays/dicts)
  const nest = [];           // open arrays/dicts
  let opStart = -1;

  const push = (v) => {
    if (nest.length) nest[nest.length - 1].push(v); else stack.push(v);
  };
  const markStart = (pos) => { if (opStart < 0) opStart = pos; };

  while (i < n) {
    const c = bytes[i];
    if (WS[c]) { i++; continue; }
    if (c === 37) { // % comment
      while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++;
      continue;
    }
    const tokStart = i;
    if (c === 47) { // name
      i++;
      let s = '';
      while (i < n && !WS[bytes[i]] && !DELIM[bytes[i]]) s += String.fromCharCode(bytes[i++]);
      markStart(tokStart); push(new PdfName(decodeName(s)));
      continue;
    }
    if (c === 40) { // literal string
      i++;
      let depth = 1;
      const out = [];
      while (i < n && depth > 0) {
        let b = bytes[i++];
        if (b === 92) { // backslash
          const e = bytes[i++];
          if (e === 110) out.push(10); else if (e === 114) out.push(13);
          else if (e === 116) out.push(9); else if (e === 98) out.push(8);
          else if (e === 102) out.push(12);
          else if (e === 13) { if (bytes[i] === 10) i++; }
          else if (e === 10) { /* line continuation */ }
          else if (e >= 48 && e <= 55) {
            let v = e - 48;
            for (let k = 0; k < 2 && bytes[i] >= 48 && bytes[i] <= 55; k++) v = v * 8 + (bytes[i++] - 48);
            out.push(v & 255);
          } else out.push(e);
          continue;
        }
        if (b === 40) depth++;
        else if (b === 41) { depth--; if (depth === 0) break; }
        out.push(b);
      }
      markStart(tokStart); push(new PdfStr(Uint8Array.from(out), false));
      continue;
    }
    if (c === 60) { // < : hex string or dict
      if (bytes[i + 1] === 60) {
        i += 2; markStart(tokStart);
        const d = []; d.isDict = true; nest.push(d);
        continue;
      }
      i++;
      let hex = '';
      while (i < n && bytes[i] !== 62) { const b = bytes[i++]; if (!WS[b]) hex += String.fromCharCode(b); }
      i++;
      if (hex.length % 2) hex += '0';
      const arr = new Uint8Array(hex.length / 2);
      for (let k = 0; k < arr.length; k++) arr[k] = parseInt(hex.substr(k * 2, 2), 16) || 0;
      markStart(tokStart); push(new PdfStr(arr, true));
      continue;
    }
    if (c === 62 && bytes[i + 1] === 62) { // end dict
      i += 2;
      const d = nest.pop() || [];
      const obj = {};
      for (let k = 0; k + 1 < d.length; k += 2) { if (d[k] instanceof PdfName) obj[d[k].n] = d[k + 1]; }
      push(obj);
      continue;
    }
    if (c === 91) { i++; markStart(tokStart); const a = []; nest.push(a); continue; }
    if (c === 93) { i++; const a = nest.pop() || []; push(a); continue; }
    if (c === 123 || c === 125) { i++; continue; }
    // number or keyword
    let s = '';
    while (i < n && !WS[bytes[i]] && !DELIM[bytes[i]]) s += String.fromCharCode(bytes[i++]);
    if (!s) { i++; continue; }
    const ch0 = s.charCodeAt(0);
    if ((ch0 >= 48 && ch0 <= 57) || ch0 === 45 || ch0 === 43 || ch0 === 46) {
      let v = parseFloat(s);
      if (Number.isNaN(v)) v = 0;
      markStart(tokStart); push(v);
      continue;
    }
    if (s === 'true' || s === 'false') { markStart(tokStart); push(s === 'true'); continue; }
    if (s === 'null') { markStart(tokStart); push(null); continue; }
    if (nest.length) { continue; } // stray keyword in array; ignore
    // operator
    if (s === 'BI') {
      // inline image: BI <dict pairs> ID <data> EI
      const startPos = opStart >= 0 ? opStart : tokStart;
      const dict = [];
      // read dict tokens until ID
      let j = i;
      const sub = [];
      while (j < n) {
        while (j < n && WS[bytes[j]]) j++;
        if (bytes[j] === 73 && bytes[j + 1] === 68 && (WS[bytes[j + 2]] || j + 2 >= n)) { j += 3; break; }
        // grab a token roughly
        let t = '';
        while (j < n && !WS[bytes[j]]) t += String.fromCharCode(bytes[j++]);
        sub.push(t);
      }
      for (let k = 0; k + 1 < sub.length; k += 2) dict.push([sub[k], sub[k + 1]]);
      // find EI preceded by whitespace and followed by whitespace/EOF
      let k = j;
      while (k < n - 1) {
        if (bytes[k] === 69 && bytes[k + 1] === 73 && WS[bytes[k - 1]] && (k + 2 >= n || WS[bytes[k + 2]] || DELIM[bytes[k + 2]])) break;
        k++;
      }
      const end = Math.min(n, k + 2);
      ops.push({ op: 'BI', args: [dict], s: startPos, e: end });
      i = end; stack.length = 0; opStart = -1;
      continue;
    }
    ops.push({ op: s, args: stack.slice(), s: opStart >= 0 ? opStart : tokStart, e: i });
    stack.length = 0; opStart = -1;
  }
  return ops;
}

// ---- serialisation helpers ----
function fmtNum(v) {
  if (Number.isInteger(v)) return String(v);
  let s = v.toFixed(4);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
export function serializeArg(a) {
  if (typeof a === 'number') return fmtNum(a);
  if (a instanceof PdfName) return '/' + a.n.replace(/[^!-~]|[#()<>[\]{}/%]/g, (ch) => '#' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
  if (a instanceof PdfStr) return '<' + Array.from(a.bytes, (b) => b.toString(16).padStart(2, '0')).join('') + '>';
  if (Array.isArray(a)) return '[' + a.map(serializeArg).join(' ') + ']';
  if (a === true) return 'true';
  if (a === false) return 'false';
  if (a === null) return 'null';
  if (typeof a === 'object') return '<<' + Object.entries(a).map(([k, v]) => '/' + k + ' ' + serializeArg(v)).join(' ') + '>>';
  return String(a);
}
export function serializeOp(op, args) {
  return (args.length ? args.map(serializeArg).join(' ') + ' ' : '') + op;
}
export { fmtNum };
