// Minimal encodings + glyph-name → Unicode mapping (compact AGL subset).
const WIN_HI = {
  128: 0x20AC, 130: 0x201A, 131: 0x0192, 132: 0x201E, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x02C6,
  137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152, 142: 0x017D, 145: 0x2018, 146: 0x2019, 147: 0x201C,
  148: 0x201D, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x02DC, 153: 0x2122, 154: 0x0161, 155: 0x203A,
  156: 0x0153, 158: 0x017E, 159: 0x0178,
};
export function winAnsiToUnicode(code) {
  if (code >= 32 && code < 127) return String.fromCharCode(code);
  if (code >= 160 && code <= 255) return String.fromCharCode(code);
  if (WIN_HI[code]) return String.fromCharCode(WIN_HI[code]);
  return null;
}
const WIN_REV = new Map();
for (let c = 0; c < 256; c++) { const u = winAnsiToUnicode(c); if (u) WIN_REV.set(u, c); }
export function unicodeToWinAnsi(ch) { return WIN_REV.has(ch) ? WIN_REV.get(ch) : -1; }

const MAC_HI = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uF8FFÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
export function macRomanToUnicode(code) {
  if (code >= 32 && code < 127) return String.fromCharCode(code);
  if (code >= 128) return MAC_HI[code - 128] || null;
  return null;
}

const NAMED = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&',
  quotesingle: "'", quoteright: '\u2019', quoteleft: '\u2018', parenleft: '(', parenright: ')', asterisk: '*',
  plus: '+', comma: ',', hyphen: '-', minus: '\u2212', period: '.', slash: '/', colon: ':', semicolon: ';',
  less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\',
  bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}',
  asciitilde: '~', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', quotedblleft: '\u201C', quotedblright: '\u201D', quotesinglbase: '\u201A',
  quotedblbase: '\u201E', endash: '\u2013', emdash: '\u2014', bullet: '\u2022', ellipsis: '\u2026',
  dotlessi: '\u0131', germandbls: '\u00DF', ae: '\u00E6', AE: '\u00C6', oe: '\u0153', OE: '\u0152',
  oslash: '\u00F8', Oslash: '\u00D8', degree: '\u00B0', copyright: '\u00A9', registered: '\u00AE',
  trademark: '\u2122', section: '\u00A7', paragraph: '\u00B6', periodcentered: '\u00B7', fi: 'fi', fl: 'fl',
  ff: 'ff', ffi: 'ffi', ffl: 'ffl', checkmark: '\u2713', multiply: '\u00D7', divide: '\u00F7',
  nbspace: '\u00A0', exclamdown: '\u00A1', questiondown: '\u00BF', guillemotleft: '\u00AB',
  guillemotright: '\u00BB', guilsinglleft: '\u2039', guilsinglright: '\u203A', dagger: '\u2020',
  daggerdbl: '\u2021', sterling: '\u00A3', yen: '\u00A5', Euro: '\u20AC', cent: '\u00A2', florin: '\u0192',
  perthousand: '\u2030', onehalf: '\u00BD', onequarter: '\u00BC', threequarters: '\u00BE', mu: '\u00B5',
  plusminus: '\u00B1', logicalnot: '\u00AC', brokenbar: '\u00A6', eth: '\u00F0', Eth: '\u00D0',
  thorn: '\u00FE', Thorn: '\u00DE', ordfeminine: '\u00AA', ordmasculine: '\u00BA', currency: '\u00A4',
  uni00A0: '\u00A0', arrowright: '\u2192', arrowleft: '\u2190', circumflex: '\u02C6', tilde: '\u02DC',
};
const ACC = { acute: '\u0301', grave: '\u0300', dieresis: '\u0308', circumflex: '\u0302', tilde: '\u0303', ring: '\u030A',
  cedilla: '\u0327', caron: '\u030C', breve: '\u0306', dotaccent: '\u0307', macron: '\u0304', ogonek: '\u0328', hungarumlaut: '\u030B', commaaccent: '\u0326' };

const TR_NAMED = {
  Gbreve: '\u011E', gbreve: '\u011F', Idotaccent: '\u0130', Idot: '\u0130', idotless: '\u0131',
  Scedilla: '\u015E', scedilla: '\u015F', Scommaaccent: '\u015E', scommaaccent: '\u015F',
  Ccedilla: '\u00C7', ccedilla: '\u00E7', Odieresis: '\u00D6', odieresis: '\u00F6',
  Udieresis: '\u00DC', udieresis: '\u00FC', f_i: 'fi', f_l: 'fl', f_f: 'ff', f_f_i: 'ffi', f_f_l: 'ffl',
};

export function glyphNameToUnicode(name) {
  if (!name) return null;
  if (TR_NAMED[name]) return TR_NAMED[name];
  const base = name.split('.')[0].split('_')[0] || name;
  if (TR_NAMED[base]) return TR_NAMED[base];
  if (NAMED[base]) return NAMED[base];
  if (/^[A-Za-z]$/.test(base)) return base;
  let m = /^uni([0-9A-Fa-f]{4,})$/.exec(base);
  if (m) { try { return String.fromCodePoint(...m[1].match(/.{4}/g).map((h) => parseInt(h, 16))); } catch (e) { return null; } }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(base);
  if (m) { try { return String.fromCodePoint(parseInt(m[1], 16)); } catch (e) { return null; } }
  m = /^([A-Za-z])(acute|grave|dieresis|circumflex|tilde|ring|cedilla|caron|breve|dotaccent|macron|ogonek|hungarumlaut|commaaccent)$/.exec(base);
  if (m) return (m[1] + ACC[m[2]]).normalize('NFC');
  return null;
}

export const STANDARD_DIFF_HINT = 'StandardEncoding';
