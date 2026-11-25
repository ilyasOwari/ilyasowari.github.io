// Dependency-free uncompressed (STORE) ZIP builder and reader with IEEE 802.3 CRC-32.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function dosTimeDate(date = new Date()) {
  const y = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() >> 1) & 31);
  const dt = (((y - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, date: dt };
}

export function makeZipBytes(files) {
  const entries = files.map((f) => {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : (f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data));
    const crc = crc32(data);
    return { nameBytes, data, crc };
  });

  const { time, date } = dosTimeDate();
  let localTotal = 0;
  let cdTotal = 0;
  for (const e of entries) {
    localTotal += 30 + e.nameBytes.length + e.data.length;
    cdTotal += 46 + e.nameBytes.length;
  }
  const out = new Uint8Array(localTotal + cdTotal + 22);
  const dv = new DataView(out.buffer);
  const offsets = [];

  let pos = 0;
  for (const e of entries) {
    offsets.push(pos);
    dv.setUint32(pos, 0x04034b50, true);
    dv.setUint16(pos + 4, 20, true); // version needed: 2.0
    dv.setUint16(pos + 6, 0x0800, true); // UTF-8 filename flag
    dv.setUint16(pos + 8, 0, true); // compression method: STORE
    dv.setUint16(pos + 10, time, true);
    dv.setUint16(pos + 12, date, true);
    dv.setUint32(pos + 14, e.crc, true);
    dv.setUint32(pos + 18, e.data.length, true);
    dv.setUint32(pos + 22, e.data.length, true);
    dv.setUint16(pos + 26, e.nameBytes.length, true);
    dv.setUint16(pos + 28, 0, true);
    out.set(e.nameBytes, pos + 30);
    out.set(e.data, pos + 30 + e.nameBytes.length);
    pos += 30 + e.nameBytes.length + e.data.length;
  }

  const cdOffset = pos;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    dv.setUint32(pos, 0x02014b50, true);
    dv.setUint16(pos + 4, 20, true); // version made by
    dv.setUint16(pos + 6, 20, true); // version needed
    dv.setUint16(pos + 8, 0x0800, true); // UTF-8 flag
    dv.setUint16(pos + 10, 0, true); // method: STORE
    dv.setUint16(pos + 12, time, true);
    dv.setUint16(pos + 14, date, true);
    dv.setUint32(pos + 16, e.crc, true);
    dv.setUint32(pos + 20, e.data.length, true);
    dv.setUint32(pos + 24, e.data.length, true);
    dv.setUint16(pos + 28, e.nameBytes.length, true);
    dv.setUint16(pos + 30, 0, true);
    dv.setUint16(pos + 32, 0, true);
    dv.setUint16(pos + 34, 0, true);
    dv.setUint16(pos + 36, 0, true);
    dv.setUint32(pos + 38, 0, true);
    dv.setUint32(pos + 42, offsets[i], true);
    out.set(e.nameBytes, pos + 46);
    pos += 46 + e.nameBytes.length;
  }

  const cdSize = pos - cdOffset;
  dv.setUint32(pos, 0x06054b50, true);
  dv.setUint16(pos + 4, 0, true);
  dv.setUint16(pos + 6, 0, true);
  dv.setUint16(pos + 8, entries.length, true);
  dv.setUint16(pos + 10, entries.length, true);
  dv.setUint32(pos + 12, cdSize, true);
  dv.setUint32(pos + 16, cdOffset, true);
  dv.setUint16(pos + 20, 0, true);

  return out;
}

export function readZipBytes(zipU8) {
  const bytes = zipU8 instanceof Uint8Array ? zipU8 : new Uint8Array(zipU8);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 65558);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: EOCD record not found');

  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const files = new Map();

  let pos = cdOffset;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('Invalid ZIP: bad CD signature');
    const method = dv.getUint16(pos + 10, true);
    const expectedCrc = dv.getUint32(pos + 16, true);
    const compSize = dv.getUint32(pos + 20, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localOff = dv.getUint32(pos + 42, true);
    const name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error(`Invalid ZIP: bad local header for ${name}`);
    if (method !== 0) throw new Error(`Unsupported ZIP method ${method} for ${name}`);
    const lhNameLen = dv.getUint16(localOff + 26, true);
    const lhExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const payload = bytes.slice(dataStart, dataStart + compSize);
    const actualCrc = crc32(payload);
    if (actualCrc !== expectedCrc) {
      throw new Error(`CRC32 mismatch for ${name}: expected ${expectedCrc.toString(16)}, got ${actualCrc.toString(16)}`);
    }
    files.set(name, payload);
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}
