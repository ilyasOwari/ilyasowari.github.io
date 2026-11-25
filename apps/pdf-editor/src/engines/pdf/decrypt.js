// Standard security handler (RC4 40/128-bit, AES-128; AES-256 R5/R6 via WebCrypto).
// Decrypts strings and streams of a pdf-lib document in place so that
// owner-restricted ("permissions only") PDFs can be edited.
import { PDFName, PDFDict, PDFRawStream, PDFString, PDFHexString, PDFArray, PDFRef, PDFNumber } from '../../../vendor/pdf-lib.esm.min.js';
import { md5, rc4, aesCbcDecrypt, sha256, sha384, sha512, aesEcbEncryptNoPad, aesCbcEncryptNoPad } from './crypto.js';

const PAD = Uint8Array.from([0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);

function bytesOf(o) { if (o instanceof PDFString || o instanceof PDFHexString) return o.asBytes(); return new Uint8Array(0); }
function num(o, d = 0) { return o instanceof PDFNumber ? o.asNumber() : d; }
const concat = (...arrs) => { const n = arrs.reduce((a, b) => a + b.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
const latin1 = (s) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0) & 255));

async function fileKeyR2to4(enc, idBytes, password) {
  const R = num(enc.get(PDFName.of('R'))), O = bytesOf(enc.lookup(PDFName.of('O'))), P = num(enc.get(PDFName.of('P')));
  const len = R === 2 ? 5 : (num(enc.get(PDFName.of('Length')), 40) / 8 || 5);
  const pw = concat(latin1(password).slice(0, 32), PAD).slice(0, 32);
  const p = new Uint8Array(4); new DataView(p.buffer).setInt32(0, P, true);
  const encMeta = enc.get(PDFName.of('EncryptMetadata'));
  let input = concat(pw, O.slice(0, 32), p, idBytes);
  if (R >= 4 && encMeta && String(encMeta) === 'false') input = concat(input, Uint8Array.from([255, 255, 255, 255]));
  let key = md5(input).slice(0, len);
  if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key).slice(0, len);
  return { key, R, O, len };
}
function checkUser(enc, key, R, idBytes) {
  const U = bytesOf(enc.lookup(PDFName.of('U')));
  if (R === 2) { const c = rc4(key, PAD); return c.every((b, i) => b === U[i]); }
  let x = rc4(key, md5(concat(PAD, idBytes)));
  for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
  return x.slice(0, 16).every((b, i) => b === U[i]);
}
function ownerToUserPassword(enc, password, R, len) {
  const O = bytesOf(enc.lookup(PDFName.of('O')));
  const pw = concat(latin1(password).slice(0, 32), PAD).slice(0, 32);
  let k = md5(pw);
  if (R >= 3) for (let i = 0; i < 50; i++) k = md5(k);
  k = k.slice(0, len);
  let x = O.slice(0, 32);
  if (R === 2) x = rc4(k, x);
  else for (let i = 19; i >= 0; i--) x = rc4(k.map((b) => b ^ i), x);
  return String.fromCharCode(...x);
}

async function hashR6(pw, salt, udata, R) {
  let K = await sha256(concat(pw, salt, udata));
  if (R === 5) return K;
  let i = 0;
  for (;;) {
    const K1 = concat(pw, K, udata);
    const rep = new Uint8Array(K1.length * 64);
    for (let j = 0; j < 64; j++) rep.set(K1, j * K1.length);
    const E = await aesCbcEncryptNoPad(K.slice(0, 16), K.slice(16, 32), rep);
    let sum = 0; for (let j = 0; j < 16; j++) sum += E[j];
    const m = sum % 3;
    K = m === 0 ? await sha256(E) : m === 1 ? await sha384(E) : await sha512(E);
    i++;
    if (i >= 64 && E[E.length - 1] <= i - 32) break;
  }
  return K.slice(0, 32);
}
async function fileKeyR6(enc, password) {
  const R = num(enc.get(PDFName.of('R')));
  const U = bytesOf(enc.lookup(PDFName.of('U'))), O = bytesOf(enc.lookup(PDFName.of('O')));
  const UE = bytesOf(enc.lookup(PDFName.of('UE'))), OE = bytesOf(enc.lookup(PDFName.of('OE')));
  const pw = new TextEncoder().encode(password).slice(0, 127);
  const iv = new Uint8Array(16);
  // owner?
  let h = await hashR6(pw, O.slice(32, 40), U.slice(0, 48), R);
  if (h.every((b, i) => b === O[i])) {
    const k = await hashR6(pw, O.slice(40, 48), U.slice(0, 48), R);
    return aesCbcDecrypt(k, iv, OE, false);
  }
  h = await hashR6(pw, U.slice(32, 40), new Uint8Array(0), R);
  if (h.every((b, i) => b === U[i])) {
    const k = await hashR6(pw, U.slice(40, 48), new Uint8Array(0), R);
    return aesCbcDecrypt(k, iv, UE, false);
  }
  void aesEcbEncryptNoPad;
  return null;
}

// Derive the key and return synchronous decryptors, or null for a wrong password.
export async function makeDecryptor(ctx, password = '') {
  const encRef = ctx.trailerInfo.Encrypt;
  const enc = encRef instanceof PDFRef ? ctx.lookup(encRef) : encRef;
  if (!(enc instanceof PDFDict)) return { unsupported: true };
  const filter = enc.get(PDFName.of('Filter'));
  if (!filter || filter.decodeText() !== 'Standard') return { unsupported: true };
  const V = num(enc.get(PDFName.of('V')));
  const R = num(enc.get(PDFName.of('R')));
  const ids = ctx.trailerInfo.ID;
  const idBytes = ids instanceof PDFArray ? bytesOf(ctx.lookup(ids.get(0))) : new Uint8Array(0);
  let key = null, aes = false, aes256 = false, identity = false;
  if (R >= 5) {
    key = await fileKeyR6(enc, password);
    aes = true; aes256 = true;
    if (!key) return null;
  } else {
    let r = await fileKeyR2to4(enc, idBytes, password);
    if (!checkUser(enc, r.key, r.R, idBytes)) {
      const upw = ownerToUserPassword(enc, password, r.R, r.len);
      r = await fileKeyR2to4(enc, idBytes, upw);
      if (!checkUser(enc, r.key, r.R, idBytes)) return null;
    }
    key = r.key;
    if (V === 4) {
      const cf = enc.lookup(PDFName.of('CF'));
      const stmf = enc.get(PDFName.of('StmF'));
      const sub = cf instanceof PDFDict && stmf ? cf.lookup(stmf) : null;
      const cfm = sub instanceof PDFDict ? sub.get(PDFName.of('CFM')) : null;
      aes = !!(cfm && cfm.decodeText() === 'AESV2');
      identity = !!(stmf && stmf.decodeText() === 'Identity');
    }
  }
  const objKey = (ref) => {
    if (aes256) return key;
    const n = ref.objectNumber, g = ref.generationNumber;
    const extra = Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255]);
    const salt = aes ? Uint8Array.from([0x73, 0x41, 0x6C, 0x54]) : new Uint8Array(0);
    return md5(concat(key, extra, salt)).slice(0, Math.min(16, key.length + 5));
  };
  const dec = (ref, data) => {
    if (identity || !data.length) return data;
    const k = objKey(ref);
    if (aes) { if (data.length < 32) return new Uint8Array(0); return aesCbcDecrypt(k, data.slice(0, 16), data.slice(16), true); }
    return rc4(k, data);
  };
  return { dec, encRef, enc };
}

// Decrypt every remaining string/stream in place (objects that came out of
// object streams are already plain).
export function decryptInPlace(ctx, d, skip = new Set()) {
  const { dec, encRef, enc } = d;
  const walk = (obj, ref) => {
    if (obj instanceof PDFString || obj instanceof PDFHexString) return PDFHexString.of(Array.from(dec(ref, obj.asBytes()), (b) => b.toString(16).padStart(2, '0')).join(''));
    if (obj instanceof PDFArray) { for (let i = 0; i < obj.size(); i++) obj.set(i, walk(obj.get(i), ref)); return obj; }
    if (obj instanceof PDFDict) { for (const [kk, v] of obj.entries()) obj.set(kk, walk(v, ref)); return obj; }
    return obj;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref === encRef || obj === enc || skip.has(ref)) continue;
    if (obj instanceof PDFRawStream) {
      const type = obj.dict.get(PDFName.of('Type'));
      if (type instanceof PDFName && type.decodeText() === 'XRef') continue;
      walk(obj.dict, ref);
      ctx.assign(ref, PDFRawStream.of(obj.dict, dec(ref, obj.contents)));
    } else if (obj instanceof PDFDict) {
      const type = obj.get(PDFName.of('Type'));
      if (type instanceof PDFName && type.decodeText() === 'Sig') continue;
      walk(obj, ref);
    } else if (obj instanceof PDFArray) walk(obj, ref);
    else if (obj instanceof PDFString || obj instanceof PDFHexString) ctx.assign(ref, walk(obj, ref));
  }
  ctx.trailerInfo.Encrypt = undefined;
  if (encRef instanceof PDFRef) ctx.delete(encRef);
}

