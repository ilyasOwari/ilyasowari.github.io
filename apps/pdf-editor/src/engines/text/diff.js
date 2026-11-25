// Myers diff on arrays of characters: maps every new index to an old index (or -1).
export function diffMap(a, b) {
  const N = a.length, M = b.length;
  const max = N + M;
  if (max === 0) return [];
  if (N * M > 25e6) return lcsFallback(a, b);
  const V = new Int32Array(2 * max + 2);
  const trace = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(V.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && V[max + k - 1] < V[max + k + 1])) x = V[max + k + 1];
      else x = V[max + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      V[max + k] = x;
      if (x >= N && y >= M) { found = true; break; }
    }
  }
  // backtrack
  const map = new Array(M).fill(-1);
  let x = N, y = M;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const Vd = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && Vd[max + k - 1] < Vd[max + k + 1])) prevK = k + 1; else prevK = k - 1;
    const prevX = Vd[max + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; map[y] = x; }
    if (d > 0) { x = prevX; y = prevY; }
  }
  return map;
}
function lcsFallback(a, b) {
  // cheap prefix/suffix matching for huge inputs
  const map = new Array(b.length).fill(-1);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) { map[p] = p; p++; }
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) { map[b.length - 1 - s] = a.length - 1 - s; s++; }
  return map;
}
