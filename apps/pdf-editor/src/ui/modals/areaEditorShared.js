// Helpers shared by areaEditor.js and its parts.

export const clone = (v) => JSON.parse(JSON.stringify(v));

export const cloneParas = (ps) => (ps || []).map((p) => ({
  text: p.text, marker: !!p.marker,
  ...(p.align ? { align: p.align } : {}),
  ...(p.cb ? { cb: clone(p.cb) } : {}),
  ...(p.st && p.st.length ? { st: p.st.map((r) => ({ a: r.a, b: r.b, s: clone(r.s) })) } : {}),
}));
