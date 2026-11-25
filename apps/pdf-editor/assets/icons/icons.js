// Hand-drawn 24x24 line icons (stroke = currentColor).
const P = {
  cover: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7 9h10v6H7z" fill="currentColor" fill-opacity=".25"/><path d="m4 20 16-16"/>',
  crop: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>',
  magnet: '<path d="M6 4h4v8a2 2 0 0 0 4 0V4h4v8a6 6 0 0 1-12 0z"/><path d="M6 8h4M14 8h4"/>',
  lockPage: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2"/>',
  pageNum: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M10.5 14.5l1.5-1v5M10.5 18.5h3"/>',
  freeObj: '<rect x="3" y="7" width="11" height="11" rx="1.5"/><path d="m3 15 3.5-3 3 2.5 2-1.5 2.5 2"/><path d="M15 4h5v5M20 4l-6 6"/>',
  toLayout: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/>',
  prevPage: '<path d="M14 4H6v16h12V8z"/><path d="m12 11-3 3 3 3M9 14h6"/>',
  nextPage: '<path d="M14 4H6v16h12V8z"/><path d="m12 11 3 3-3 3M15 14H9"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H11"/>',
  redo: '<path d="m15 7 4.5 4.5L15 16"/><path d="M19 11.5H9.5a5 5 0 0 0 0 10H13"/>',
  pointer: '<path d="M6 3.5 18.5 12l-5.6 1.3 3.3 6.2-2.4 1.3-3.3-6.2L6 18.6z" stroke-linejoin="round"/>',
  marquee: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M12 4h2M18 4h.5A1.5 1.5 0 0 1 20 5.5V8M20 12v2M20 18v.5a1.5 1.5 0 0 1-1.5 1.5H18M12 20h2M8 20H5.5A1.5 1.5 0 0 1 4 18.5V18M4 12v2"/><path d="m11 10 7 4.2-3 .7 1.8 3.3-1.3.7-1.8-3.3-2.2 2.1z" fill="currentColor" stroke-width="1"/>',
  edit: '<path d="M4 20h4.2L19.4 8.8a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8z"/><path d="m13.5 6.5 4 4"/>',
  cut: '<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.6 8.4 19 16.5M8.6 15.6 19 7.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="12" rx="1.8"/><path d="M5.5 15.5H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v.5"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V5"/><path d="M9 11h6M9 15h4"/>',
  trash: '<path d="M4.5 7h15M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1z"/><path d="M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12"/><path d="M10 11v6M14 11v6"/>',
  split: '<rect x="3.5" y="4" width="17" height="16" rx="1.5" stroke-dasharray="2.6 2.2"/><path d="M8 9.5h8v5H8z" fill="currentColor" fill-opacity=".18"/><path d="M12 2v3M12 19v3"/>',
  erase: '<path d="m8.5 19.5-4-4a1.6 1.6 0 0 1 0-2.3l8.7-8.7a1.6 1.6 0 0 1 2.3 0l4 4a1.6 1.6 0 0 1 0 2.3l-8 8.7z"/><path d="m9.6 8.1 6.3 6.3M8.5 19.5H20"/>',
  merge: '<rect x="3.5" y="3.5" width="8" height="8" rx="1.5"/><rect x="12.5" y="12.5" width="8" height="8" rx="1.5"/><path d="M11.5 7.5h3a2 2 0 0 1 2 2v3M12.5 16.5h-3a2 2 0 0 1-2-2v-3"/>',
  ungroup: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M13.5 6h3.5a3.5 3.5 0 0 1 0 0M6 13.5V17" stroke-dasharray="1.6 1.8"/>',
  text: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
  scanText: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8.5 9V8h7v1M12 8v8M10.5 16h3"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="m4 17.5 5-5 3.5 3.5 2.5-2.5 5 5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.2 4.5v15M14.8 4.5v15"/>',
  page: '<path d="M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M13.5 3.5V8H18M11.5 11v6M8.5 14h6"/>',
  bgRemove: '<path d="M12 3.5s-5.5 6.1-5.5 10a5.5 5.5 0 0 0 11 0c0-3.9-5.5-10-5.5-10z"/><path d="m4 4 16 16"/>',
  bgWhite: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5 9.5 4M4 15l11-11M8.5 20 20 8.5" stroke-opacity=".45"/><rect x="8" y="8" width="8" height="8" rx="1" fill="#fff"/>',
  alignCenter: '<path d="M12 3v18"/><rect x="6" y="6.5" width="12" height="4" rx="1" fill="currentColor" fill-opacity=".22"/><rect x="4" y="13.5" width="16" height="4" rx="1"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  beforeAfter: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/><path d="M3.5 4.5H12v15H5.5a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".22" stroke="none"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M8 10.5h5M10.5 8v5"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M8 10.5h5"/>',
  fitWidth: '<path d="M4 5v14M20 5v14"/><path d="M7.5 12h9M10 9.5 7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/><circle cx="12" cy="12" r="6.4"/>',
  open: '<path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13.2a1.5 1.5 0 0 0 1.4-1l2-6.5H8.2a1.5 1.5 0 0 0-1.4 1l-3.3 6"/><path d="M3.5 7.5V6A1.5 1.5 0 0 1 5 4.5h4l2 2.2h6.5A1.5 1.5 0 0 1 19 8.2v2.3"/>',
  save: '<path d="M5 3.5h11l3.5 3.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M7.5 3.5v5h8v-5M7 20.5v-6.5h10v6.5"/>',
  saveAs: '<path d="M12 20.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5h11l3.5 3.5v3.5"/><path d="M7.5 3.5v5h8v-5M7 20.5V14h5"/><path d="m14.5 21 .5-2.6 5-5a1.4 1.4 0 0 1 2 2l-5 5z"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>', right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  upload: '<path d="M7 18.5H6a4.5 4.5 0 0 1-.8-8.9A6 6 0 0 1 16.8 8a4.5 4.5 0 0 1 1.2 8.8"/><path d="M12 20.5v-9M8.5 14.5 12 11l3.5 3.5"/>',
  pdf: '<path d="M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M13.5 3.5V8H18"/><path d="M8 13h8M8 16.5h5"/>',
  paragraph: '<path d="M11 19V5h6M15 5v14M11 12H9.5a3.5 3.5 0 0 1 0-7H11"/>',
  caret: '<path d="m6 9 6 6 6-6"/>', more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  lang: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.6a5 5 0 0 1-4-2l-2.6-3.6a1.5 1.5 0 0 1 2.4-1.8L8 14"/>',
};
export function icon(name, cls = 'icon') {
  const body = P[name] || P.more;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
// Yellow paragraph-start arrow used in the text editor
export function paraMarkSvg() {
  return '<svg class="te-mark" viewBox="0 0 26 18" aria-hidden="true"><path d="M1.5 6.2h13.5V1.8L24.5 9 15 16.2v-4.4H1.5z" fill="#ffc400" stroke="#b88a00" stroke-width="1.1" stroke-linejoin="round"/></svg>';
}
