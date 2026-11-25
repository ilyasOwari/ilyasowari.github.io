// Pure table style model (patterns + color palettes + cell fill calculation) shared by editor and PDF export.
export const TABLE_PATTERNS = ['sade', 'ust', 'sol', 'ustSol'];
export const TABLE_COLOR_ORDER = ['orijinal', 'renksiz', 'mavi', 'yesil', 'kirmizi', 'mor', 'sari', 'tirtikli', 'ozel'];
export const DEFAULT_CUSTOM = { koyu: [174, 190, 252], ilk: [238, 242, 255], ikinci: [255, 255, 255] };

export const TABLE_COLORS = {
  renksiz: {
    koyu: [255, 255, 255],
    normal: [255, 255, 255],
    soluk: [255, 255, 255],
    cizgi: [203, 213, 225],
    borderWidth: 0.75,
    innerH: true,
    innerV: true,
    outerBorder: true,
    radius: 0,
    borderStyle: 'solid',
    noVertLines: false,
    headerAccent: null,
  },
  mavi: {
    koyu: [186, 214, 252],
    normal: [255, 255, 255],
    soluk: [239, 246, 255],
    cizgi: [147, 197, 253],
    borderWidth: 0.75,
    innerH: true,
    innerV: true,
    outerBorder: true,
    radius: 0,
    borderStyle: 'solid',
    noVertLines: false,
    headerAccent: null,
  },
  yesil: {
    koyu: [182, 240, 204],
    normal: [255, 255, 255],
    soluk: [240, 253, 244],
    cizgi: [134, 239, 172],
    borderWidth: 0.75,
    innerH: true,
    innerV: true,
    outerBorder: true,
    radius: 0,
    borderStyle: 'solid',
    noVertLines: false,
    headerAccent: null,
  },
  kirmizi: {
    koyu: [252, 198, 198],
    normal: [255, 255, 255],
    soluk: [254, 242, 242],
    cizgi: [252, 165, 165],
    borderWidth: 0.75,
    innerH: true,
    innerV: true,
    outerBorder: true,
    radius: 0,
    borderStyle: 'solid',
    noVertLines: false,
    headerAccent: null,
  },
  mor: {
    koyu: [228, 204, 254],
    normal: [255, 255, 255],
    soluk: [250, 245, 255],
    cizgi: [216, 180, 254],
    borderWidth: 0.75,
    innerH: true,
    innerV: true,
    outerBorder: true,
    radius: 0,
    borderStyle: 'solid',
    noVertLines: false,
    headerAccent: null,
  },
  sari: {
    koyu: [252, 211, 77],
    normal: [255, 251, 235],
    soluk: [254, 243, 199],
    cizgi: [251, 191, 36],
    borderWidth: 0,
    innerH: false,
    innerV: false,
    outerBorder: false,
    radius: 6,
    borderStyle: 'solid',
    noVertLines: true,
    headerAccent: null,
  },
  tirtikli: {
    koyu: [210, 228, 254],
    normal: [255, 255, 255],
    soluk: [248, 251, 255],
    cizgi: [96, 165, 250],
    borderWidth: 1.25,
    innerH: false,
    innerV: false,
    outerBorder: true,
    radius: 0,
    borderStyle: 'scalloped',
    noVertLines: true,
    headerAccent: null,
  },
};

export function rgbEq(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const validRgb = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => typeof v === 'number' && Number.isFinite(v));

export function cloneCustom(custom) {
  const c = custom || {};
  return {
    koyu: validRgb(c.koyu) ? c.koyu.slice() : DEFAULT_CUSTOM.koyu.slice(),
    ilk: validRgb(c.ilk) ? c.ilk.slice() : DEFAULT_CUSTOM.ilk.slice(),
    ikinci: validRgb(c.ikinci) ? c.ikinci.slice() : DEFAULT_CUSTOM.ikinci.slice(),
  };
}

export function rgbToHex(rgb) {
  const c = validRgb(rgb) ? rgb : [255, 255, 255];
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const m = typeof hex === 'string' && hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function cellTone(pattern, r, c) {
  if (pattern === 'sade') return r % 2 === 0 ? 'soluk' : 'normal';
  if (pattern === 'ust') return r === 0 ? 'koyu' : (r % 2 === 1 ? 'soluk' : 'normal');
  if (pattern === 'sol') return c === 0 ? 'koyu' : (r % 2 === 0 ? 'soluk' : 'normal');
  if (pattern === 'ustSol') return (r === 0 || c === 0) ? 'koyu' : (r % 2 === 1 ? 'soluk' : 'normal');
  return null;
}

export function paletteFor(color, origPalette = null, custom = null, pattern = null) {
  if (color === 'ozel') {
    const cu = cloneCustom(custom);
    const lineBase = pattern === 'sade' ? cu.ilk : cu.koyu;
    return {
      koyu: cu.koyu,
      normal: cu.ikinci,
      soluk: cu.ilk,
      cizgi: mixRgb(lineBase, [71, 85, 105], 0.32),
      borderWidth: 0.75,
      innerH: true,
      innerV: true,
      outerBorder: true,
      radius: 0,
      borderStyle: 'solid',
      noVertLines: false,
      headerAccent: null,
    };
  }
  if (color === 'orijinal') {
    const op = origPalette || {};
    const normal = op.bodyBg || [255, 255, 255];
    const cizgi = op.borderColor || [203, 213, 225];
    const rawH = op.headerBg || null;
    const koyu = (rawH && !rgbEq(rawH, normal)) ? rawH : mixRgb(normal, cizgi, 0.42);
    const soluk = op.altRowBg || mixRgb(normal, koyu, 0.45);
    const innerV = op.innerV ?? true;
    const bw = op.borderWidth ?? 0.75;
    return {
      koyu,
      normal,
      soluk,
      cizgi,
      borderWidth: bw,
      innerH: op.innerH ?? true,
      innerV,
      outerBorder: op.outerBorder ?? (bw > 0),
      radius: op.radius || 0,
      borderStyle: op.borderStyle || 'solid',
      noVertLines: op.noVertLines ?? !innerV,
      headerAccent: null,
    };
  }
  return TABLE_COLORS[color] || TABLE_COLORS.mavi;
}

export function cellFill(pattern, color, r, c, origPalette = null, custom = null) {
  if (color === 'renksiz') return [255, 255, 255];
  if (!pattern) {
    if (color === 'orijinal') {
      if (r === 0 && origPalette && origPalette.headerBg) return origPalette.headerBg;
      if (r % 2 === 1 && origPalette && origPalette.altRowBg) return origPalette.altRowBg;
      return (origPalette && origPalette.bodyBg) || [255, 255, 255];
    }
    if (color === 'sari') return TABLE_COLORS.sari.soluk;
    if (color === 'tirtikli') return [255, 255, 255];
    const defPal = paletteFor(color, origPalette, custom, 'ust');
    return defPal[cellTone('ust', r, c)] || defPal.normal;
  }
  const tone = cellTone(pattern, r, c);
  const pal = paletteFor(color, origPalette, custom, pattern);
  return (tone && pal[tone]) || pal.normal;
}

const LEGACY_PRESET_MAP = {
  blue: { pattern: 'ust', color: 'mavi' },
  green: { pattern: 'ust', color: 'yesil' },
  red: { pattern: 'ust', color: 'kirmizi' },
  purple: { pattern: 'ust', color: 'mor' },
  minimal: { pattern: 'ust', color: 'renksiz' },
  amberBox: { pattern: null, color: 'sari' },
  scallopBox: { pattern: null, color: 'tirtikli' },
  orig: { pattern: null, color: 'orijinal' },
};

export function migrateTableStyle(tableSpec) {
  if (tableSpec && typeof tableSpec.color === 'string' && (tableSpec.color === 'orijinal' || tableSpec.color === 'ozel' || TABLE_COLORS[tableSpec.color])) {
    return {
      pattern: TABLE_PATTERNS.includes(tableSpec.pattern) ? tableSpec.pattern : null,
      color: tableSpec.color,
      custom: tableSpec.color === 'ozel' ? cloneCustom(tableSpec.custom) : null,
    };
  }
  const mapped = tableSpec && tableSpec.presetKey ? LEGACY_PRESET_MAP[tableSpec.presetKey] : null;
  return mapped ? { ...mapped } : { pattern: null, color: 'orijinal' };
}

export function buildTableStyleProps(pattern, color, origPalette, custom = null) {
  const pal = paletteFor(color, origPalette, custom, pattern);
  const bodyBg = (color === 'sari' && !pattern) ? pal.soluk : pal.normal;
  const headerBg = cellFill(pattern, color, 0, 0, origPalette, custom);
  const altFill = cellFill(pattern, color, 1, 1, origPalette, custom);
  const altRowBg = altFill && !rgbEq(altFill, bodyBg) ? altFill : null;
  return {
    pattern: pattern || null,
    color,
    custom: color === 'ozel' ? cloneCustom(custom) : null,
    origPalette,
    headerBg,
    bodyBg,
    altRowBg,
    borderColor: pal.cizgi,
    borderWidth: pal.borderWidth,
    innerH: pal.innerH,
    innerV: pal.innerV,
    outerBorder: pal.outerBorder,
    radius: pal.radius || 0,
    borderStyle: pal.borderStyle || 'solid',
    noVertLines: !!pal.noVertLines,
    headerAccent: null,
  };
}
