// Small crypto primitives for the PDF standard security handler.
export function rc4(key, data) {
  const s = new Uint8Array(256); for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const K = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
const R = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
export function md5(data) {
  const n = data.length, padLen = ((n + 8) >> 6) * 64 + 64;
  const b = new Uint8Array(padLen); b.set(data); b[n] = 0x80;
  const dv = new DataView(b.buffer);
  dv.setUint32(padLen - 8, (n * 8) >>> 0, true); dv.setUint32(padLen - 4, Math.floor(n / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; } else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      const t = D; D = C; C = B;
      const x = (A + F + K[i] + M[g]) | 0;
      B = (B + ((x << R[i]) | (x >>> (32 - R[i])))) | 0; A = t;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16); const o = new DataView(out.buffer);
  o.setInt32(0, a0, true); o.setInt32(4, b0, true); o.setInt32(8, c0, true); o.setInt32(12, d0, true);
  return out;
}

// ---- AES (128/256) ----
const SBOX = new Uint8Array(256), INV = new Uint8Array(256);
(() => {
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) INV[SBOX[i]] = i;
})();
const xt = (a) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
const mul0 = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };
const MT = {}; for (const k of [9, 11, 13, 14]) { MT[k] = new Uint8Array(256); for (let i = 0; i < 256; i++) MT[k][i] = mul0(i, k); }
const M9 = MT[9], M11 = MT[11], M13 = MT[13], M14 = MT[14];
function expandKey(key) {
  const nk = key.length / 4, nr = nk + 6, w = new Uint8Array(16 * (nr + 1));
  w.set(key);
  let rcon = 1;
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let t = w.slice((i - 1) * 4, i * 4);
    if (i % nk === 0) { t = Uint8Array.from([SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]); rcon = xt(rcon); }
    else if (nk > 6 && i % nk === 4) t = t.map((b) => SBOX[b]);
    for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - nk) * 4 + j] ^ t[j];
  }
  return { w, nr };
}
function encBlock({ w, nr }, inp) {
  const s = new Uint8Array(inp);
  for (let i = 0; i < 16; i++) s[i] ^= w[i];
  for (let r = 1; r <= nr; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    const t = new Uint8Array(s);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) s[c * 4 + rr] = t[((c + rr) % 4) * 4 + rr];
    if (r !== nr) for (let c = 0; c < 4; c++) {
      const a = s.slice(c * 4, c * 4 + 4);
      s[c * 4] = xt(a[0]) ^ xt(a[1]) ^ a[1] ^ a[2] ^ a[3];
      s[c * 4 + 1] = a[0] ^ xt(a[1]) ^ xt(a[2]) ^ a[2] ^ a[3];
      s[c * 4 + 2] = a[0] ^ a[1] ^ xt(a[2]) ^ xt(a[3]) ^ a[3];
      s[c * 4 + 3] = xt(a[0]) ^ a[0] ^ a[1] ^ a[2] ^ xt(a[3]);
    }
    for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
  }
  return s;
}
function decBlock({ w, nr }, inp) {
  const s = new Uint8Array(inp);
  for (let i = 0; i < 16; i++) s[i] ^= w[nr * 16 + i];
  for (let r = nr - 1; r >= 0; r--) {
    const t = new Uint8Array(s);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) s[((c + rr) % 4) * 4 + rr] = t[c * 4 + rr];
    for (let i = 0; i < 16; i++) s[i] = INV[s[i]];
    for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
    if (r !== 0) for (let c = 0; c < 4; c++) {
      const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
      s[c * 4] = M14[a0] ^ M11[a1] ^ M13[a2] ^ M9[a3];
      s[c * 4 + 1] = M9[a0] ^ M14[a1] ^ M11[a2] ^ M13[a3];
      s[c * 4 + 2] = M13[a0] ^ M9[a1] ^ M14[a2] ^ M11[a3];
      s[c * 4 + 3] = M11[a0] ^ M13[a1] ^ M9[a2] ^ M14[a3];
    }
  }
  return s;
}
export function aesCbcDecrypt(key, iv, data, unpad = true) {
  data = new Uint8Array(data); iv = new Uint8Array(iv);
  const ks = expandKey(key);
  const n = data.length - (data.length % 16);
  const out = new Uint8Array(n);
  let prev = iv;
  for (let o = 0; o < n; o += 16) {
    const blk = data.subarray(o, o + 16);
    const d = decBlock(ks, blk);
    for (let i = 0; i < 16; i++) out[o + i] = d[i] ^ prev[i];
    prev = blk;
  }
  if (unpad && n) { const p = out[n - 1]; if (p > 0 && p <= 16) return out.slice(0, n - p); }
  return out;
}
export function aesCbcEncryptNoPad(key, iv, data) {
  const ks = expandKey(key);
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let o = 0; o < data.length; o += 16) {
    const blk = data.slice(o, o + 16);
    for (let i = 0; i < 16; i++) blk[i] ^= prev[i];
    prev = encBlock(ks, blk); out.set(prev, o);
  }
  return out;
}
export function aesEcbEncryptNoPad(key, data) { return aesCbcEncryptNoPad(key, new Uint8Array(16), data); }
const digest = (alg) => async (d) => new Uint8Array(await globalThis.crypto.subtle.digest(alg, d));
export const sha256 = digest('SHA-256'), sha384 = digest('SHA-384'), sha512 = digest('SHA-512');
