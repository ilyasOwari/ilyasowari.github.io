// Load a PDF with pdf-lib, transparently decrypting standard-security files
// (including encrypted object streams, which pdf-lib cannot parse itself).
import { PDFDocument, PDFParser, PDFObjectStreamParser, PDFRawStream } from '../../../vendor/pdf-lib.esm.min.js';
import { makeDecryptor, decryptInPlace } from './decrypt.js';

let state = null; // active hook state while a load is in progress
let patched = false;
function patch() {
  if (patched) return; patched = true;
  const P = PDFParser.prototype;
  const origHeader = P.parseIndirectObjectHeader;
  P.parseIndirectObjectHeader = function (...a) { const r = origHeader.apply(this, a); if (state) state.lastRef = r; return r; };
  const origFor = PDFObjectStreamParser.forStream;
  PDFObjectStreamParser.forStream = function (raw, tick) {
    if (!state) return origFor.call(this, raw, tick);
    if (state.phase === 1) return { parseIntoContext: async () => {} };
    const st = state;
    const plain = PDFRawStream.of(raw.dict, st.dec(st.lastRef, raw.contents));
    const parser = origFor.call(this, plain, tick);
    const ctx = raw.dict.context;
    const run = parser.parseIntoContext.bind(parser);
    parser.parseIntoContext = async () => {
      const oa = ctx.assign;
      ctx.assign = function (ref, obj) { st.fromObjStm.add(ref); return oa.call(ctx, ref, obj); };
      try { return await run(); } finally { ctx.assign = oa; }
    };
    return parser;
  };
}

const OPTS = { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false };

// returns { doc, decrypted } ; throws {code:'password'} if the password is wrong/needed
export async function loadPdfLib(bytes, password = '') {
  bytes = bytes instanceof Uint8Array && bytes.constructor === Uint8Array ? bytes : new Uint8Array(bytes);
  patch();
  let doc = null, failed = null;
  try { doc = await PDFDocument.load(bytes, OPTS); } catch (e) { failed = e; }
  if (doc && !doc.isEncrypted) return { doc, decrypted: false };
  // phase 1: structure only (object streams skipped) to read the Encrypt dict
  state = { phase: 1 };
  let skel;
  try { skel = await PDFDocument.load(bytes, OPTS); } catch (e) { state = null; throw failed || e; } finally { state = null; }
  if (!skel.isEncrypted) { if (failed) throw failed; return { doc, decrypted: false }; }
  const d = await makeDecryptor(skel.context, password);
  if (!d) { const err = new Error('password'); err.code = 'password'; throw err; }
  if (d.unsupported) { const err = new Error('unsupported encryption'); err.code = 'unsupported'; throw err; }
  state = { phase: 2, dec: d.dec, fromObjStm: new Set() };
  const st = state;
  try { doc = await PDFDocument.load(bytes, OPTS); } finally { state = null; }
  const d2 = await makeDecryptor(doc.context, password);
  decryptInPlace(doc.context, d2, st.fromObjStm);
  return { doc, decrypted: true };
}
