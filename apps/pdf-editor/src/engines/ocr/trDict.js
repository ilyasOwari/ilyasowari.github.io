// Offline Turkish dictionary + suffix-stripping analyzer for full-page OCR verification.
// Backs up suspect-word detection and unambiguous word rescue against `assets/dict/tr-words.txt`.
import { loadBytes } from '../../core/assets.js';

let dictPromise = null;

// Common Turkish inflectional/derivational endings ordered longest-first for greedy stripping.
const SUFFIXES = [
  'larından', 'lerinden', 'larında', 'lerinde', 'larıdır', 'leridir',
  'larının', 'lerinin', 'larına', 'lerine', 'larını', 'lerini', 'larıyla', 'leriyle',
  'mışlar', 'mişler', 'muşlar', 'müşler', 'acaklar', 'ecekler',
  'maktadır', 'mektedir', 'masını', 'mesini', 'masında', 'mesinde',
  'ından', 'inden', 'undan', 'ünden', 'sından', 'sinden', 'sundan', 'sünden',
  'ndan', 'nden', 'tır', 'tir', 'tur', 'tür', 'dır', 'dir', 'dur', 'dür',
  'ları', 'leri', 'ımız', 'imiz', 'umuz', 'ümüz', 'ınız', 'iniz', 'unuz', 'ünüz',
  'mız', 'miz', 'muz', 'müz', 'nız', 'niz', 'nuz', 'nüz',
  'acak', 'ecek', 'arak', 'erek', 'malı', 'meli', 'dığı', 'diği', 'duğu', 'düğü',
  'tığı', 'tiği', 'tuğu', 'tüğü', 'yor', 'muş', 'miş', 'müş', 'mış',
  'dan', 'den', 'tan', 'ten', 'nda', 'nde', 'yla', 'yle', 'nın', 'nin', 'nun', 'nün',
  'lık', 'lik', 'luk', 'lük', 'lığ', 'liğ', 'luğ', 'lüğ',
  'sız', 'siz', 'suz', 'süz', 'lı', 'li', 'lu', 'lü',
  'cı', 'ci', 'cu', 'cü', 'çı', 'çi', 'çu', 'çü',
  'lar', 'ler', 'mak', 'mek', 'ma', 'me', 'sa', 'se',
  'da', 'de', 'ta', 'te', 'ya', 'ye', 'la', 'le',
  'ın', 'in', 'un', 'ün', 'ım', 'im', 'um', 'üm',
  'sı', 'si', 'su', 'sü', 'yı', 'yi', 'yu', 'yü',
  'dı', 'di', 'du', 'dü', 'tı', 'ti', 'tu', 'tü',
  'kı', 'ki', 'ku', 'kü', 'a', 'e', 'ı', 'i', 'u', 'ü',
];

const UNSOFTEN = { 'ğ': 'k', 'b': 'p', 'c': 'ç', 'd': 't' };

export const normTr = (s) => (s || '').normalize('NFC').toLocaleLowerCase('tr-TR');

async function gunzipText(bytes) {
  if (typeof DecompressionStream !== 'undefined') {
    const st = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(st).text();
  }
  const zlib = await import('node:zlib');
  return new TextDecoder('utf-8').decode(zlib.gunzipSync(bytes));
}

// word -> frequency. Turkish: Wikipedia word-frequency list (~180k words,
// Turkish-aware lower case), English: ~47k most frequent words, plus the
// hand-made core list (frequency 1000 when it is missing from the big lists).
// The result is a Map, so `.has()` / `.size` work like the old Set.
export async function loadTrDict() {
  if (!dictPromise) {
    dictPromise = (async () => {
      const map = new Map();
      const addFreq = (txt) => {
        for (const line of txt.split('\n')) {
          const tab = line.search(/[ \t]/); // "word freq"
          if (tab < 1) continue;
          const w = line.slice(0, tab), n = +line.slice(tab + 1) || 1;
          map.set(w, (map.get(w) || 0) + n);
        }
      };
      for (const rel of ['assets/dict/tr-freq.txt.gz', 'assets/dict/en-freq.txt.gz']) {
        try { addFreq(await gunzipText(await loadBytes(rel))); } catch (e) { /* optional */ }
      }
      try {
        const txt = new TextDecoder('utf-8').decode(await loadBytes('assets/dict/tr-words.txt'));
        for (const line of txt.split(/\r?\n/)) {
          const w = line.trim();
          if (!w || w.startsWith('#')) continue;
          const k = normTr(w);
          map.set(k, Math.max(1000, map.get(k) || 0)); // hand-made core list: always trusted
        }
      } catch (e) { /* optional */ }
      return map;
    })().catch(() => new Map());
  }
  return dictPromise;
}

export const wordFreq = (dict, w) => (dict && dict.get ? dict.get(w) || 0 : (dict && dict.has && dict.has(w) ? 1 : 0));

function stripPunct(raw) {
  return (raw || '').trim()
    .replace(/^[("'«\[*•\-–—\d]+/u, '')
    .replace(/[)"'»\].,;:!?/\\|]+$/u, '');
}

// big frequency dictionary: rare entries are often typos / OCR-like junk of
// the corpus, so a whole word needs >= 20 uses and a stem under a suffix >= 100
const inDict = (w, dictSet, depth) => {
  if (dictSet && dictSet.get && dictSet.size >= 20000) return (dictSet.get(w) || 0) >= (depth ? 100 : 20);
  return dictSet.has(w);
};

function canFormInDict(w, dictSet, depth = 0) {
  if (!w || w.length < 2) return false;
  if (inDict(w, dictSet, depth)) return true;
  if (w.includes("'")) {
    const pre = w.split("'")[0];
    if (pre.length >= 2 && inDict(pre, dictSet, 1)) return true;
  }
  if (depth >= 4) return false;
  for (const suf of SUFFIXES) {
    if (w.length - suf.length < 2 || !w.endsWith(suf)) continue;
    const stem = w.slice(0, w.length - suf.length);
    if (suf.length === 1 && depth >= 1 && stem.length < 3) continue;
    if (canFormInDict(stem, dictSet, depth + 1)) return true;
    const last = stem[stem.length - 1];
    if (UNSOFTEN[last]) {
      const hard = stem.slice(0, -1) + UNSOFTEN[last];
      if (canFormInDict(hard, dictSet, depth + 1)) return true;
    }
    // Vowel-buffer removal (e.g. arabası -> araba, evleri -> ev)
    if ((suf.length >= 2 && /^[aıeiouöü]/u.test(suf)) || /^[snym]/u.test(suf)) {
      if (stem.endsWith('s') || stem.endsWith('y') || stem.endsWith('n')) {
        const bStem = stem.slice(0, -1);
        if (bStem.length >= 2 && canFormInDict(bStem, dictSet, depth + 1)) return true;
      }
    }
  }
  return false;
}

export function isKnownTurkishWord(rawWord, dictSet) {
  if (!rawWord) return true;
  const trimmed = rawWord.trim();
  if (!trimmed) return true;
  if (/^[\d.,:/\-+%()]+$/.test(trimmed)) return true;
  if (/^(?:[IVX]{1,5}|[A-ZÇĞİÖŞÜ]\.(?:[A-ZÇĞİÖŞÜ]\.)+)$/u.test(trimmed)) return true;
  if (/^(?:Müd\.|Dr\.|Prof\.|Doç\.|Yrd\.|Av\.|vb\.|vs\.|bl\.|ek\.?)$/iu.test(trimmed)) return true;
  const clean = stripPunct(trimmed);
  if (!clean || !/\p{L}/u.test(clean)) return true;
  // Short uppercase acronyms ("SHU", "ATA", "AOF", "EK")
  if (clean.length <= 4 && clean === clean.toLocaleUpperCase('tr-TR') && clean !== clean.toLocaleLowerCase('tr-TR')) return true;
  if (clean.length <= 2) return true;
  if (!dictSet || dictSet.size < 20) return true;
  const parts = clean.split(/[-/]/).filter(Boolean);
  return parts.every((part) => {
    const low = normTr(part);
    if (low.length <= 2) return true;
    return canFormInDict(low, dictSet);
  });
}

const TR_ALPHA = 'abcçdefgğhıijklmnoöprsştuüvyzqwxâîû';

// Conservative dictionary rescue: only a word the dictionary does not know
// (not even with suffixes) is replaced, only by a word ONE edit away
// (substitution, insertion, deletion, swap), and only when that word is
// common (>= 50 uses; >= 200 when the OCR word parses as stem + suffix) and
// clearly the most frequent candidate (5x the next).
export function suggestTurkishWord(rawWord, dictSet, pageWords = null) {
  if (!dictSet || dictSet.size < 20) return null;
  const clean = stripPunct(rawWord);
  if (clean.length < 4 || clean.length > 20 || /\d/.test(clean)) return null;
  const low = normTr(clean);
  // a whole-word hit is never replaced; a word known only through suffix
  // analysis ("sayla" = say + la) needs a much more common neighbour
  if (wordFreq(dictSet, low) >= 20) return null;
  const viaSuffix = canFormInDict(low, dictSet);
  if (viaSuffix && !(dictSet.get && dictSet.size >= 20000)) return null;
  const seen = new Set();
  const cands = [];
  // ranking: corpus frequency, x1000 when the same page has the word read
  // confidently elsewhere, /20 when the edit changes the first letter (OCR
  // rarely gets a whole word right but its first letter wrong)
  const tryW = (w, pos) => {
    if (seen.has(w)) return; seen.add(w);
    let f = wordFreq(dictSet, w);
    if (!f) return;
    const onPage = pageWords && pageWords.has(w);
    const raw = f;
    if (onPage) f *= 1000;
    if (pos === 0) f /= 20;
    cands.push({ w, f, raw, onPage });
  };
  for (let i = 0; i <= low.length; i++) {
    for (const ch of TR_ALPHA) {
      tryW(low.slice(0, i) + ch + low.slice(i), i); // insertion
      if (i < low.length) tryW(low.slice(0, i) + ch + low.slice(i + 1), i); // substitution
    }
    if (i < low.length) tryW(low.slice(0, i) + low.slice(i + 1), i); // deletion
    if (i < low.length - 1) tryW(low.slice(0, i) + low[i + 1] + low[i] + low.slice(i + 2), i); // swap
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.f - a.f);
  if (!cands[0].onPage && cands[0].raw < (viaSuffix ? 200 : 50)) return null;
  if (cands[1] && cands[1].f * 5 > cands[0].f) return null;
  return cands[0].w;
}

// ---- Turkish letter restoration (PaddleOCR's latin model reads "ı" as "i",
// "İ" as "I" and sometimes drops ğ/ş/ç/ö/ü marks). For each word the spelling
// the dictionary supports best is chosen: first only the i/ı positions; when
// no variant is known at all, the other mark pairs are tried as well.
const I_SET = new Set(['i', 'ı', 'I', 'İ']);
const PAIRS = { g: 'ğ', ğ: 'g', s: 'ş', ş: 's', c: 'ç', ç: 'c', o: 'ö', ö: 'o', u: 'ü', ü: 'u' };
const scoreForm = (w, dict) => {
  const f = wordFreq(dict, w);
  if (f >= 20) return 1e3 + f; // whole word
  return canFormInDict(w, dict) ? 1 : 0; // stem + suffixes
};
function harmonyMisses(s) {
  let prevV = null, miss = 0;
  for (const c of s) {
    if ((c === 'i' || c === 'ı') && prevV) {
      if ((prevV === 'a' || prevV === 'ı') && c === 'i') miss++;
      else if ((prevV === 'e' || prevV === 'i') && c === 'ı') miss++;
    }
    if ('aeıioöuü'.includes(c)) prevV = c;
  }
  return miss;
}
function restoreCore(core, dict) {
  const chars = Array.from(core);
  const lowAt = (c) => (c === 'I' ? 'ı' : c === 'İ' ? 'i' : c.toLocaleLowerCase('tr-TR'));
  const low = chars.map(lowAt);
  const iPos = chars.map((c, k) => (I_SET.has(c) ? k : -1)).filter((k) => k >= 0);
  const build = (pos, alt) => {
    let best = null, bestSc = -1, bestCh = Infinity;
    const n = pos.length;
    if (n > 12) return null;
    for (let mask = 0; mask < (1 << n); mask++) {
      const s = low.slice();
      let changes = 0;
      pos.forEach((k, j) => { const flip = (mask >> j) & 1; if (flip) { s[k] = alt(low[k]); changes++; } });
      const w = s.join('');
      let sc = scoreForm(w, dict);
      // stem + suffix analysis is not vowel-harmony aware: among such forms
      // prefer the one whose i/ı follow the vowel before them
      if (sc > 0 && sc < 1e3) sc -= 0.001 * harmonyMisses(s);
      if (sc > bestSc || (sc === bestSc && changes < bestCh)) { best = s; bestSc = sc; bestCh = changes; }
    }
    return bestSc > 0 ? best : null;
  };
  let res = iPos.length ? build(iPos, (c) => (c === 'i' ? 'ı' : 'i')) : (scoreForm(low.join(''), dict) > 0 ? low : null);
  // the suffix analysis is permissive ("çalismalar" parses): unless stage 1
  // found a whole dictionary word, also try the other mark pairs and take a
  // whole word from there when there is one
  if (!res || scoreForm(res.join(''), dict) < 1e3) {
    const pos = chars.map((c, k) => (I_SET.has(c) || PAIRS[lowAt(c)] ? k : -1)).filter((k) => k >= 0);
    const r2 = build(pos, (c) => (c === 'i' ? 'ı' : c === 'ı' ? 'i' : PAIRS[c] || c));
    if (r2 && (!res || scoreForm(r2.join(''), dict) >= 1e3)) res = r2;
  }
  if ((!res || scoreForm(res.join(''), dict) < 1e3) && low.length >= 3 && low.length <= 20) {
    // the latin model sometimes drops "ş" (and the vowel before it)
    // altogether: "gösterilmitir", "iaretlenmi", "çalmalar". Put back one
    // "ş" / "ış" / "iş" anywhere (with the mark pairs tried as above) and keep
    // it only for a clearly common word.
    let best = null, bestF = 0, second = 0;
    for (const ins of ['ş', 'ış', 'iş']) {
      for (let k = 1; k <= low.length; k++) {
        const arr = low.slice(0, k).concat(Array.from(ins), low.slice(k));
        const pos = arr.map((c, j) => ((j >= k && j < k + ins.length) ? -1 : (c === 'i' || c === 'ı' || PAIRS[c] ? j : -1))).filter((j) => j >= 0);
        if (pos.length > 8) continue;
        for (let mask = 0; mask < (1 << pos.length); mask++) {
          const t = arr.slice();
          pos.forEach((j, q) => { if ((mask >> q) & 1) t[j] = t[j] === 'i' ? 'ı' : t[j] === 'ı' ? 'i' : PAIRS[t[j]]; });
          const w = t.join(''), f = wordFreq(dict, w);
          if (f > bestF) { if (!best || best.w !== w) second = bestF; bestF = f; best = { w, t, k, n: ins.length }; } else if (f > second && (!best || w !== best.w)) second = f;
        }
      }
    }
    if (best && bestF >= 50 && bestF > 5 * second) {
      const up = chars.length > 1 && chars.every((c) => c === c.toLocaleUpperCase('tr-TR'));
      chars.splice(best.k, 0, ...Array.from({ length: best.n }, () => (up ? 'İ' : 'i')));
      res = best.t;
    }
  }
  if (!res) {
    // nothing known: vowel harmony for the suffix vowels - an i/ı after a
    // back vowel (a, ı) is "ı", after a front vowel (e, i) "i"; the first
    // vowel of the word (the root) is left as read
    let prevV = null, changed = false;
    const s = low.slice();
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (I_SET.has(chars[k]) && prevV) {
        const want = prevV === 'a' || prevV === 'ı' ? 'ı' : prevV === 'e' || prevV === 'i' ? 'i' : null;
        if (want && want !== c) { s[k] = want; changed = true; }
      }
      if ('aeıioöuü'.includes(s[k])) prevV = s[k];
    }
    if (!changed) return core;
    res = s;
  }
  return chars.map((c, k) => {
    const r = res[k];
    const upper = c !== c.toLocaleLowerCase('tr-TR') || c === 'I' || c === 'İ';
    return upper ? r.toLocaleUpperCase('tr-TR') : r;
  }).join('');
}
// accented letters Turkish does not use (the latin model knows French,
// Portuguese, ... too): read "Í" as "İ", "ō" as "o" and so on; ö/ü/ğ come back
// through the mark pairs below when the dictionary wants them
const FOREIGN = { í: 'i', ì: 'i', ï: 'i', ī: 'i', Í: 'İ', Ì: 'İ', Ï: 'İ', Ī: 'İ', ó: 'o', ò: 'o', ō: 'o', õ: 'o', ô: 'o', Ó: 'O', Ò: 'O', Ō: 'O', Õ: 'O', Ô: 'O',
  ú: 'u', ù: 'u', ū: 'u', Ú: 'U', Ù: 'U', Ū: 'U', é: 'e', è: 'e', ê: 'e', ë: 'e', É: 'E', È: 'E', Ê: 'E', Ë: 'E', á: 'a', à: 'a', ā: 'a', ã: 'a', ä: 'a', Á: 'A', À: 'A', Ā: 'A', Ã: 'A', Ä: 'A',
  ș: 'ş', Ș: 'Ş', ţ: 't', ț: 't', ñ: 'n', Ñ: 'N', ǧ: 'ğ', Ǧ: 'Ğ', ý: 'ı', ÿ: 'y', ō: 'o' };
const FOREIGN_RE = new RegExp(`[${Object.keys(FOREIGN).join('')}]`, 'gu');
export function restoreTurkishLetters(text, dict) {
  if (!text || !dict || dict.size < 20000) return text;
  text = text.replace(FOREIGN_RE, (c) => FOREIGN[c]);
  return text.replace(/[A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîû]{2,}/gu, (core) => {
    // mixed-case acronyms / codes and very long tokens stay as read
    if (core.length > 24) return core;
    return restoreCore(core, dict);
  });
}
