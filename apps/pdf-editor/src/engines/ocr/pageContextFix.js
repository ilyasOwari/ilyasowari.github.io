// Page-level OCR noise cleanup and context-aware fuzzy self-correction
// (fixes corrupted words using high-confidence matches & bigrams elsewhere on the same page).

import { suggestTurkishWord, isKnownTurkishWord } from './trDict.js';

const NOISE_OK_SHORT = /^(?:ve|de|da|ki|bu|şu|o|ek|il|no|tc|ab|\d+)$/iu;
const STANDALONE_PUNCT = /^[/&+]$/;
const TR_DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const DATE_TOKEN_RE = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/;

// Clean stray photocopy specks, standalone punctuation, and trailing pipe artifacts
export function cleanNoiseTokens(words) {
  const out = [];
  for (const w of words || []) {
    if (!w) continue;
    let txt = (w.text || '').trim();
    if (!txt) continue;
    const conf = w.confidence ?? w.conf ?? 100;
    if (STANDALONE_PUNCT.test(txt)) {
      if (conf >= 35) out.push(txt === w.text ? w : { ...w, text: txt });
      continue;
    }
    if (txt === '|') {
      if (conf >= 55) out.push(txt === w.text ? w : { ...w, text: txt });
      continue;
    }
    if (txt.length > 1) txt = txt.replace(/\s*\|+$/u, '').replace(/^\|+\s*/u, '').trim();
    if (!txt || !/[\p{L}\p{N}]/u.test(txt)) continue;
    const letters = (txt.match(/[\p{L}\p{N}]/gu) || []).length;
    const pureAlpha2 = txt.length === 2 && /^[\p{L}]{2}$/u.test(txt) && conf >= 52;
    // short pure numbers (table scores "14", "9", "85,5") are kept from ~55 %
    // (one lone digit from 65 %: a speck or rule remnant is often read as "1")
    const pureNum = /^\d{1,3}(?:[.,]\d{1,2})?$/.test(txt) && conf >= (txt.length === 1 ? 65 : 55);
    // short codes: column / question labels "S1", "9p", "B2"
    const code = /^(?:[A-ZÇĞİÖŞÜ]\d{1,2}|\d{1,2}[a-zA-Z])$/u.test(txt) && conf >= 55;
    if (letters <= 2 && conf < 78 && !pureAlpha2 && !pureNum && !code && !(NOISE_OK_SHORT.test(txt) && conf >= 62)) continue;
    out.push(txt === w.text ? w : { ...w, text: txt });
  }
  return out;
}

const CONFUSABLE_PAIRS = [
  ['o', 'ö'], ['u', 'ü'], ['s', 'ş'], ['c', 'ç'], ['g', 'ğ'],
  ['i', 'ı'], ['i', 'l'], ['i', '1'], ['ı', '1'], ['l', '1'],
  ['r', 'n'], ['v', 'y'], ['f', 'h'], ['e', 'c'], ['a', 'o'],
  ['m', 'n'], ['b', 'h'], ['k', 'x'], ['z', '2'], ['s', '5'],
];
const CONFUSABLE = new Set(CONFUSABLE_PAIRS.flatMap(([a, b]) => [`${a}:${b}`, `${b}:${a}`]));

const normLower = (s) => (s || '')
  .toLocaleLowerCase('tr-TR')
  .replace(/^[("'«\[*•]+|[)"'»\].,;:!?/]+$/gu, '');

function subCost(a, b) {
  if (a === b) return 0;
  return CONFUSABLE.has(`${a}:${b}`) ? 0.35 : 1;
}

// Normalized similarity in [0..1] tuned for Turkish/Latin OCR confusion pairs
export function ocrSimilarity(rawA, rawB) {
  const a = normLower(rawA), b = normLower(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > Math.max(2, Math.floor(Math.max(m, n) * 0.35))) return 0;
  const dp = Array.from({ length: m + 1 }, () => new Float32Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + subCost(a[i - 1], b[j - 1]),
      );
    }
  }
  return Math.max(0, 1 - dp[m][n] / Math.max(m, n));
}

function matchPunctAndCase(orig, targetCore) {
  const m = /^([("'«\[*•]*)(.*?)([)"'»\].,;:!?/]*)$/u.exec(orig || '');
  const pre = m ? m[1] : '', coreOrig = m ? m[2] : orig, suf = m ? m[3] : '';
  let out = targetCore;
  if (coreOrig && coreOrig === coreOrig.toLocaleUpperCase('tr-TR') && coreOrig !== coreOrig.toLocaleLowerCase('tr-TR')) {
    out = targetCore.toLocaleUpperCase('tr-TR');
  } else if (coreOrig && /^[A-ZÇĞİÖŞÜ]/u.test(coreOrig)) {
    const chars = Array.from(targetCore.toLocaleLowerCase('tr-TR'));
    if (chars.length) chars[0] = chars[0].toLocaleUpperCase('tr-TR');
    out = chars.join('');
  } else if (coreOrig) {
    out = targetCore.toLocaleLowerCase('tr-TR');
  }
  return pre + out + suf;
}

// Auto-correct glitched/uncertain words by matching neighbor bigrams, high-conf page copies, and offline TR dict
export function autoCorrectFromPageContext(blocks, dictSet = null) {
  const refs = []; // high-confidence tokens across page
  const seqs = []; // ordered token lists per block/para
  for (const blk of blocks || []) {
    for (const para of blk.paras || []) {
      const ws = para.words || [];
      seqs.push(ws);
      for (const wd of ws) {
        const core = normLower(wd.text);
        if (core.length >= 3 && (wd.conf ?? 100) >= 86 && /^[\p{L}\p{N}-]+$/u.test(core)) {
          const rawCore = (wd.text || '').replace(/^[("'«\[*•]+|[)"'»\].,;:!?/]+$/gu, '');
          refs.push({ core, rawCore, conf: wd.conf ?? 100 });
        }
      }
    }
  }
  if (!refs.length) return blocks;

  // Build bigram map from high-confidence consecutive tokens
  const bigrams = [];
  for (const ws of seqs) {
    for (let i = 0; i < ws.length - 1; i++) {
      const a = ws[i], b = ws[i + 1];
      if ((a.conf ?? 100) >= 85 && (b.conf ?? 100) >= 85) {
        const ca = normLower(a.text), cb = normLower(b.text);
        if (ca.length >= 3 && cb.length >= 3) {
          bigrams.push({
            aCore: ca, bCore: cb,
            aRaw: (a.text || '').replace(/^[("'«\[*•]+|[)"'»\].,;:!?/]+$/gu, ''),
            bRaw: (b.text || '').replace(/^[("'«\[*•]+|[)"'»\].,;:!?/]+$/gu, ''),
          });
        }
      }
    }
  }

  for (const ws of seqs) {
    for (let i = 0; i < ws.length; i++) {
      const wd = ws[i];
      const core = normLower(wd.text);
      if (core.length < 4) continue;
      // a correct dictionary word is never "fixed" towards a look-alike
      // elsewhere on the page (a garbled footer "Ssyal Hizmet" turned every
      // "Sosyal" into "Ssyal")
      if (dictSet && dictSet.size >= 20000 && /\p{L}{3}/u.test(core) && isKnownTurkishWord(wd.text, dictSet)) continue;
      let fixedCore = null;

      // 1) Neighbor-anchored match (e.g. "Sena ORAL ENHAN" -> "Sena ÖNAL ERHAN")
      const prevTxt = i > 0 ? normLower(ws[i - 1].text) : '';
      const nextTxt = i + 1 < ws.length ? normLower(ws[i + 1].text) : '';
      let bestScore = 0;
      for (const bg of bigrams) {
        if (prevTxt && ocrSimilarity(prevTxt, bg.aCore) >= 0.85) {
          const sim = ocrSimilarity(core, bg.bCore);
          if (sim >= 0.68 && sim < 1 && sim > bestScore && Math.abs(core.length - bg.bCore.length) <= 1) {
            bestScore = sim; fixedCore = bg.bRaw;
          }
        }
        if (nextTxt && ocrSimilarity(nextTxt, bg.bCore) >= 0.85) {
          const sim = ocrSimilarity(core, bg.aCore);
          if (sim >= 0.68 && sim < 1 && sim > bestScore && Math.abs(core.length - bg.aCore.length) <= 1) {
            bestScore = sim; fixedCore = bg.aRaw;
          }
        }
      }

      // 2) Standalone high-integrity lexicon match (e.g. "ATATURK" -> "ATATÜRK", "Vakhkebir" -> "Vakfıkebir")
      if (!fixedCore && (wd.conf ?? 100) < 92 && core.length >= 5) {
        for (const rf of refs) {
          if (rf.conf < 90 || rf.core === core) continue;
          const sim = ocrSimilarity(core, rf.core);
          if (sim >= 0.84 && sim > bestScore) {
            bestScore = sim; fixedCore = rf.rawCore;
          }
        }
      }

      if (fixedCore) {
        const nextWordText = matchPunctAndCase(wd.text, fixedCore);
        if (nextWordText !== wd.text) {
          wd.text = nextWordText;
          wd.conf = Math.max(wd.conf ?? 0, 90);
        }
      }
    }
  }
  // 3) Turkish weekday lexicon rescue when parenthesized "(Sah)" or paired near a date "17/11/2026"
  for (const blk of blocks || []) {
    const blkText = (blk.paras || []).map((p) => p.text || '').join(' ');
    const blkHasDate = DATE_TOKEN_RE.test(blkText);
    for (const para of blk.paras || []) {
      const ws = para.words || [];
      for (const wd of ws) {
        const raw = (wd.text || '').trim();
        const core = normLower(raw);
        if (core.length < 3 || core.length > 10) continue;
        const parenOrDate = /^[({\[]?.*[)}\]]$/.test(raw) && /[()]/.test(raw) || blkHasDate;
        if (!parenOrDate) continue;
        const expanded = core.replace(/h/g, 'lı');
        let bestDay = null, bestDayScore = 0;
        for (const day of TR_DAYS) {
          const dLow = day.toLocaleLowerCase('tr-TR');
          if (core === dLow) { bestDay = null; break; }
          const sc = Math.max(ocrSimilarity(core, dLow), ocrSimilarity(expanded, dLow));
          if (sc >= 0.78 && sc > bestDayScore) { bestDayScore = sc; bestDay = day; }
        }
        if (bestDay) {
          const nextTxt = matchPunctAndCase(raw, bestDay);
          if (nextTxt !== wd.text) {
            wd.text = nextTxt;
            wd.conf = Math.max(wd.conf ?? 0, 88);
          }
        }
      }
    }
  }
  // 4) dictionary rescue (one edit away, much more frequent; see suggestTurkishWord)
  const pageWords = new Set();
  for (const blk of blocks || []) for (const para of blk.paras || []) for (const wd of para.words || []) {
    if ((wd.conf ?? 100) >= 85) pageWords.add(normLower((wd.text || '').replace(/[^\p{L}]/gu, '')));
  }
  for (const blk of blocks || []) {
    for (const para of blk.paras || []) {
      for (const wd of para.words || []) {
        const raw = (wd.text || '').trim();
        if (dictSet && dictSet.size >= 50 && (wd.conf ?? 100) < 92) {
          const dictHit = suggestTurkishWord(raw, dictSet, pageWords);
          if (dictHit) {
            const nextTxt = matchPunctAndCase(raw, dictHit);
            if (nextTxt !== wd.text) {
              wd.text = nextTxt;
              wd.conf = Math.max(wd.conf ?? 0, 88);
            }
          }
        }
      }
    }
  }
  for (const blk of blocks || []) {
    for (const p of blk.paras || []) {
      if (p.words) p.text = p.words.map((w) => w.text).filter(Boolean).join(' ');
    }
  }
  return blocks;
}
