// Pure line-break calculations for SectionEditor: keeps untouched prefix lines
// locked to the PDF's line ends and applies live layout lineEndAt updates.
import { styleSig } from '../../engines/text/richStyle.js';

export function parasLayoutSig(paras) {
  return JSON.stringify((paras || []).map((p) => [p.text || '', !!p.marker, p.st || [], p.align || '']));
}

function perCharSigs(st, n) {
  const arr = new Array(n).fill(null);
  for (const r of st || []) {
    for (let i = r.a; i < r.b && i < n; i++) arr[i] = { ...(arr[i] || {}), ...r.s };
  }
  return arr.map((x) => styleSig(x));
}

function utf16ToCp(text, utf16Off) {
  return Array.from((text || '').slice(0, Math.max(0, utf16Off))).length;
}

function addBreakIdx(set, ci, cpArr) {
  const plen = cpArr.length;
  if (ci <= 0 || ci >= plen) return;
  let c = ci;
  while (c < plen && cpArr[c] === ' ') c++;
  const idx = c - 1;
  if (idx >= 0 && idx < plen - 1 && cpArr[idx] !== '\n' && cpArr[idx + 1] !== '\n') set.add(idx);
}

export function breaksFromLineEnds(paras, lineEndAt) {
  const list = paras || [];
  const sets = list.map(() => new Set());
  if (!lineEndAt || !lineEndAt.length || !list.length) return sets;
  const cpArrs = list.map((p) => Array.from(p.text || ''));
  const starts = [];
  let acc = 0;
  for (const p of list) {
    starts.push(acc);
    acc += (p.text || '').length + 1;
  }
  for (const end of lineEndAt) {
    let pi = starts.length - 1;
    while (pi > 0 && starts[pi] > end) pi--;
    const ci = utf16ToCp(list[pi].text || '', end - starts[pi]);
    addBreakIdx(sets[pi], ci, cpArrs[pi]);
  }
  return sets;
}

export function computeActiveBreaks(baseParas, origLineEnds, baseStSigs, curParas) {
  const curList = curParas || [];
  const sets = curList.map(() => new Set());
  if (!origLineEnds || !origLineEnds.length || !baseParas || !baseParas.length || !curList.length) return sets;

  const origStartsU16 = [];
  let accU16 = 0;
  for (const p of baseParas) {
    origStartsU16.push(accU16);
    accU16 += (p || '').length + 1;
  }
  const origCpArrs = baseParas.map((p) => Array.from(p || ''));
  const curCpArrs = curList.map((p) => Array.from(p.text || ''));

  const mapped = [];
  for (const end of origLineEnds) {
    let origPi = origStartsU16.length - 1;
    while (origPi > 0 && origStartsU16[origPi] > end) origPi--;
    const origCiCp = utf16ToCp(baseParas[origPi] || '', end - origStartsU16[origPi]);
    mapped.push([origPi, origCiCp]);
  }

  if (curList.length === baseParas.length) {
    const pDiffs = curList.map((p, pi) => {
      const a0 = origCpArrs[pi], b0 = curCpArrs[pi];
      let d = 0;
      while (d < a0.length && d < b0.length && a0[d] === b0[d]) d++;
      if (d === a0.length && d === b0.length) d = Infinity;
      const initSig = baseStSigs ? baseStSigs[pi] : undefined;
      if (initSig !== undefined && JSON.stringify(p.st || []) !== initSig) {
        let init = [];
        try { init = initSig ? JSON.parse(initSig) : []; } catch { init = []; }
        const s0 = perCharSigs(init, b0.length);
        const s1 = perCharSigs(p.st, b0.length);
        const at = s1.findIndex((v, i) => v !== s0[i]);
        d = Math.min(d, at >= 0 ? at : Math.max(0, b0.length - 1));
      }
      return d;
    });
    for (const [origPi, origCiCp] of mapped) {
      if (origCiCp < pDiffs[origPi]) addBreakIdx(sets[origPi], origCiCp, curCpArrs[origPi]);
    }
    return sets;
  }

  const origAllCp = Array.from(baseParas.join('\n'));
  const curAllCp = Array.from(curList.map((p) => p.text || '').join('\n'));
  let firstDiff = 0;
  while (firstDiff < origAllCp.length && firstDiff < curAllCp.length && origAllCp[firstDiff] === curAllCp[firstDiff]) firstDiff++;
  let accCp = 0;
  for (let pi = 0; pi < curList.length; pi++) {
    const p = curList[pi];
    const n = curCpArrs[pi].length;
    const curSig = JSON.stringify(p.st || []);
    const initSig = baseStSigs && pi < baseStSigs.length ? baseStSigs[pi] : '[]';
    if (curSig !== initSig) {
      const a0 = perCharSigs(p.st, n);
      let init = [];
      try { init = initSig ? JSON.parse(initSig) : []; } catch { init = []; }
      const b0 = perCharSigs(init, n);
      let at = a0.findIndex((v, i) => v !== b0[i]);
      if (at < 0) at = n ? n - 1 : 0;
      firstDiff = Math.min(firstDiff, accCp + at);
    }
    accCp += n + 1;
  }

  const origStartsCp = [];
  let oAcc = 0;
  for (const arr of origCpArrs) {
    origStartsCp.push(oAcc);
    oAcc += arr.length + 1;
  }
  const curStartsCp = [];
  let cAcc = 0;
  for (const arr of curCpArrs) {
    curStartsCp.push(cAcc);
    cAcc += arr.length + 1;
  }

  for (const [origPi, origCiCp] of mapped) {
    const globalCp = origStartsCp[origPi] + origCiCp;
    if (globalCp >= firstDiff) continue;
    let curPi = curStartsCp.length - 1;
    while (curPi > 0 && curStartsCp[curPi] > globalCp) curPi--;
    addBreakIdx(sets[curPi], globalCp - curStartsCp[curPi], curCpArrs[curPi]);
  }
  return sets;
}

export function segmentsFromBreaks(textOrChars, breakSet) {
  const chs = Array.isArray(textOrChars)
    ? textOrChars.map((c) => (typeof c === 'string' ? c : c.ch))
    : Array.from(String(textOrChars || ''));
  const n = chs.length;
  const breaks = breakSet && breakSet.size
    ? [...breakSet].filter((x) => x >= 0 && x < n - 1).sort((a, b) => a - b)
    : [];
  const segs = [];
  let a = 0;
  for (const brk of breaks) {
    let end = chs[brk] === ' ' ? brk : brk + 1;
    while (end > a && chs[end - 1] === ' ') end--;
    segs.push([a, end]);
    a = brk + 1;
  }
  let end = n;
  while (end > a && chs[end - 1] === ' ') end--;
  segs.push([a, end]);
  return segs;
}
