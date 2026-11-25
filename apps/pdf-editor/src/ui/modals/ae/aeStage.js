// Stage selection, marquee, pan-in-frame, handles & stage actions
import { h } from '../../common/dom.js';
import { ocrPatchesOf, restoreSuppressedOcrText } from './aeOcr.js';

const SNAP_PX = 5;
const CORNERS = ['nw', 'ne', 'sw', 'se'];
const ALL = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function setupAeStage(st) {
  const {
    stage, slot, guides, R, O, X, Y,
    objs, sections, isUnit, cropable, scaleOf,
    place, render, syncSlotBox, commitSnap,
  } = st;

  const handlesEl = h('div', { class: 'ae-handles' });
  stage.append(handlesEl);

  function syncMultiClasses() {
    objs.forEach((x) => {
      x.el.classList.toggle('on', x === st.sel && st.multiSel.size <= 1);
      x.el.classList.toggle('multi-on', st.multiSel.has(x) && st.multiSel.size > 1);
    });
  }
  function applyCoverImageToObj(o, dataUrl, im) {
    const scale = Math.max(o.w / Math.max(1, im.naturalWidth), o.h / Math.max(1, im.naturalHeight));
    const iw = im.naturalWidth * scale, ih = im.naturalHeight * scale;
    const ox = (o.w - iw) / 2, oy = (o.h - ih) / 2;
    o.placeholder = false;
    o.type = 'img';
    o._rawImg = { dataUrl, im, w: im.naturalWidth, h: im.naturalHeight };
    o._crop = { ox, oy, iw, ih };
    o.img = { dataUrl, rawDataUrl: dataUrl, crop: { ...o._crop }, anchor: 0, wrap: false, width: 1 };
    o.canvas = null;
    o.view.textContent = '';
    const imgEl = h('img', { src: dataUrl, draggable: 'false' });
    Object.assign(imgEl.style, {
      position: 'absolute',
      left: (ox / o.w) * 100 + '%',
      top: (oy / o.h) * 100 + '%',
      width: (iw / o.w) * 100 + '%',
      height: (ih / o.h) * 100 + '%',
      maxWidth: 'none', maxHeight: 'none',
    });
    o.view.append(imgEl);
    o.el.dataset.type = 'img';
    o.el.classList.remove('ae-photo', 'ae-placeholder');
    o.el.classList.add('ae-img');
    place(o);
  }
  function bakeCroppedImage(o) {
    if (!o || o.type !== 'img' || !o._rawImg || !o._crop) return;
    const { im } = o._rawImg;
    const { ox, oy, iw, ih } = o._crop;
    const pxW = Math.min(1600, Math.max(240, Math.round(o.w * 4)));
    const pxH = Math.max(40, Math.round(pxW * (o.h / Math.max(1, o.w))));
    const c = document.createElement('canvas');
    c.width = pxW; c.height = pxH;
    const g = c.getContext('2d');
    const sx = pxW / o.w, sy = pxH / o.h;
    g.drawImage(im, ox * sx, oy * sy, iw * sx, ih * sy);
    o.img.dataUrl = c.toDataURL('image/png');
    o.img.rawDataUrl = o._rawImg.dataUrl;
    o.img.crop = { ...o._crop };
  }
  function bakePlaceholderImage(o) {
    if (!o || !o.placeholder) return;
    const pxW = Math.max(160, Math.round(o.w * 3)), pxH = Math.max(100, Math.round(o.h * 3));
    const c = document.createElement('canvas');
    c.width = pxW; c.height = pxH;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, pxW, pxH);
    g.strokeStyle = '#cbd5e1';
    g.lineWidth = 3;
    g.strokeRect(2, 2, pxW - 4, pxH - 4);
    o.img = { dataUrl: c.toDataURL('image/png'), anchor: 0, wrap: false, width: 1, placeholder: true };
  }
  function enterPanMode(o) {
    if (!o) return;
    if (o.type === 'img' && !o._rawImg && o.img?.dataUrl) {
      const im = new Image();
      im.onload = () => { applyCoverImageToObj(o, o.img.dataUrl, im); enterPanMode(o); };
      im.src = o.img.dataUrl;
      return;
    }
    if (st.panMode && st.panMode !== o) exitPanMode();
    st.panMode = o;
    select(o);
    o.el.classList.add('pan-mode');
    drawHandles();
  }
  function exitPanMode() {
    if (!st.panMode) return;
    const o = st.panMode;
    st.panMode = null;
    o.el.classList.remove('pan-mode');
    if (o.type === 'img') bakeCroppedImage(o);
    drawHandles();
    commitSnap();
  }
  function pickImageFor(o) {
    const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg', 'data-testid': 'ae-file' });
    inp.style.display = 'none'; document.body.append(inp);
    inp.onchange = () => {
      const f = inp.files[0]; inp.remove(); if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image();
        im.onload = () => {
          applyCoverImageToObj(o, rd.result, im);
          bakeCroppedImage(o);
          st.syncLayout(); enterPanMode(o); commitSnap();
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    };
    inp.click();
  }
  function select(o) {
    if (st.mode === 'crop' && o !== st.sel) st.mode = null;
    if (st.panMode && o !== st.panMode) exitPanMode();
    st.multiSel.clear();
    if (o) st.multiSel.add(o);
    st.sel = o;
    syncMultiClasses();
    drawHandles(); st.syncButtons();
  }
  function drawHandles() {
    handlesEl.textContent = '';
    if (!st.sel || st.sel.deleted || st.multiSel.size > 1 || st.panMode === st.sel) return;
    const list = st.mode === 'crop' ? ALL : (st.sel.type === 'bg' ? ALL : CORNERS);
    handlesEl.className = 'ae-handles' + (st.mode === 'crop' ? ' crop' : '');
    Object.assign(handlesEl.style, { left: X(st.sel.x) + 'px', top: Y(st.sel.y) + 'px', width: st.sel.w * st.k + 'px', height: st.sel.h * st.k + 'px' });
    for (const hd of list) {
      const el = h('div', { class: 'ae-h ' + hd, 'data-h': hd, 'data-testid': 'ae-h-' + hd });
      el.addEventListener('pointerdown', (e) => onHandle(e, hd));
      handlesEl.append(el);
    }
  }
  function snapLines(except) {
    const xs = [R.x, R.x + R.w / 2, R.x + R.w], ys = [R.y, R.y + R.h / 2, R.y + R.h];
    for (const o of objs) if (o !== except && !o.deleted) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
    return { xs, ys };
  }
  function snap(vals, lines) {
    let best = null;
    for (const v of vals) for (const L of lines) { const d = L - v; if (Math.abs(d) * st.k <= SNAP_PX && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: L }; }
    return best;
  }
  function showGuides(gx, gy) {
    guides.textContent = '';
    if (gx) guides.append(h('div', { class: 'ae-guide v', style: { left: X(gx.at) + 'px' } }));
    if (gy) guides.append(h('div', { class: 'ae-guide h', style: { top: Y(gy.at) + 'px' } }));
  }
  function followersOf(o) {
    if (!isUnit(o)) return [];
    return objs.filter((x) => x !== o && !x.deleted && !isUnit(x) && x.w * x.h < o.w * o.h
      && x.x + x.w / 2 >= o.x - 0.5 && x.x + x.w / 2 <= o.x + o.w + 0.5 && x.y + x.h / 2 >= o.y - 0.5 && x.y + x.h / 2 <= o.y + o.h + 0.5)
      .map((x) => ({ x, r: { x: x.x, y: x.y, w: x.w, h: x.h } }));
  }
  function carry(fol, r0, r1) {
    const sx = r1.w / r0.w, sy = r1.h / r0.h, s1 = Math.min(sx, sy);
    for (const { x, r } of fol) {
      const cxp = r1.x + (r.x + r.w / 2 - r0.x) * sx, cyp = r1.y + (r.y + r.h / 2 - r0.y) * sy;
      x.w = r.w * s1; x.h = r.h * s1; x.x = cxp - x.w / 2; x.y = cyp - x.h / 2;
      place(x);
    }
  }
  function inkAt(x, e) {
    if (x.type === 'text' || x.type === 'box' || x.type === 'img') return true;
    const c = x.canvas; if (!c || !c.width) return true;
    const r = c.getBoundingClientRect(); if (!r.width) return true;
    const px = Math.floor((e.clientX - r.left) / r.width * c.width), py = Math.floor((e.clientY - r.top) / r.height * c.height);
    if (px < 0 || py < 0 || px >= c.width || py >= c.height) return false;
    try { return c.getContext('2d').getImageData(px, py, 1, 1).data[3] > 24; } catch { return true; }
  }
  function stackAt(e) {
    const hits = objs.filter((x) => !x.deleted && !x.ocrPatch && !x.el.hidden).filter((x) => { const r = x.el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
    // Metin tara items sit over the picture: their whole box picks them
    const ocrHit = hits.filter((x) => x.ocr);
    if (ocrHit.length) return ocrHit.sort((a, b) => a.w * a.h - b.w * b.h);
    const inked = hits.filter((x) => inkAt(x, e));
    return (inked.length ? inked : hits).sort((a, b) => a.w * a.h - b.w * b.h);
  }
  function onDown(e, o) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); stage.focus();
    if (st.panMode === o && o._crop) {
      const sx = e.clientX, sy = e.clientY, ox0 = o._crop.ox, oy0 = o._crop.oy;
      const imgEl = o.view.querySelector('img');
      track(e, (ev) => {
        const dx = (ev.clientX - sx) / st.k, dy = (ev.clientY - sy) / st.k;
        o._crop.ox = Math.max(o.w - o._crop.iw, Math.min(0, ox0 + dx));
        o._crop.oy = Math.max(o.h - o._crop.ih, Math.min(0, oy0 + dy));
        if (imgEl) {
          imgEl.style.left = (o._crop.ox / o.w) * 100 + '%';
          imgEl.style.top = (o._crop.oy / o.h) * 100 + '%';
        }
      }, () => { bakeCroppedImage(o); commitSnap(); });
      return;
    }
    if (st.panMode && st.panMode !== o) exitPanMode();
    const stack = st.mode === 'crop' ? [o] : stackAt(e);
    const wasSel = st.sel && stack.includes(st.sel) ? st.sel : null;
    if (stack.length && !wasSel) o = stack[0]; else if (wasSel) o = wasSel;
    if (e.shiftKey) {
      if (st.multiSel.has(o)) { st.multiSel.delete(o); if (st.sel === o) st.sel = [...st.multiSel][0] || null; }
      else { if (st.sel && !st.multiSel.has(st.sel)) st.multiSel.add(st.sel); st.multiSel.add(o); st.sel = o; }
      syncMultiClasses(); drawHandles(); st.syncButtons();
      return;
    }
    if (!(st.multiSel.size > 1 && st.multiSel.has(o))) {
      if (st.sel !== o || st.multiSel.size > 1) select(o);
    }
    const sx = e.clientX, sy = e.clientY, x0 = o.x, y0 = o.y;
    const isGroup = st.multiSel.size > 1 && st.multiSel.has(o);
    const groupItems = isGroup ? [...st.multiSel].map((mm) => ({ m: mm, x0: mm.x, y0: mm.y, r00: { x: mm.x, y: mm.y, w: mm.w, h: mm.h }, fol: followersOf(mm) })) : null;
    const L = snapLines(o);
    const fol = isGroup ? [] : followersOf(o), r00 = { x: o.x, y: o.y, w: o.w, h: o.h };
    let moved = false;
    track(e, (ev) => {
      const dx = (ev.clientX - sx) / st.k, dy = (ev.clientY - sy) / st.k;
      if (!moved && Math.hypot(dx, dy) * st.k < 3) return;
      moved = true;
      if (isGroup) {
        for (const it of groupItems) {
          it.m.x = it.x0 + dx; it.m.y = it.y0 + dy;
          place(it.m); carry(it.fol, it.r00, { x: it.m.x, y: it.m.y, w: it.m.w, h: it.m.h });
          it.m.el.classList.add('dragging');
        }
        return;
      }
      let nx = x0 + dx, ny = y0 + dy;
      const gx = snap([nx, nx + o.w / 2, nx + o.w], L.xs), gy = snap([ny, ny + o.h / 2, ny + o.h], L.ys);
      if (gx) nx += gx.d; if (gy) ny += gy.d;
      o.x = nx; o.y = ny; place(o); carry(fol, r00, { x: o.x, y: o.y, w: o.w, h: o.h }); drawHandles(); showGuides(gx, gy);
      o.el.classList.add('dragging');
    }, () => {
      guides.textContent = '';
      if (isGroup) {
        for (const it of groupItems) { it.m.el.classList.remove('dragging'); if (moved) it.m.el.classList.remove('ae-fresh'); }
        syncSlotBox();
        if (!moved) { select(o); return; }
        commitSnap();
        return;
      }
      o.el.classList.remove('dragging'); syncSlotBox();
      if (moved) o.el.classList.remove('ae-fresh'); // new item: glow until moved once
      if (!moved) {
        if (o.placeholder) { pickImageFor(o); return; }
        if (wasSel && stack.length > 1) select(stack[(stack.indexOf(wasSel) + 1) % stack.length]);
        return;
      }
      if (o.type === 'photo' || o.type === 'img') {
        const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
        const tgt = objs.find((p) => p !== o && !p.deleted && !p.ocrPatch && (p.type === 'photo' || p.type === 'img') && c.x > p.x && c.x < p.x + p.w && c.y > p.y && c.y < p.y + p.h);
        if (tgt) swap(o, { x: x0, y: y0, w: o.w, h: o.h }, tgt);
      }
      drawHandles();
      commitSnap();
    });
  }
  function fitInto(o, box) {
    const f = Math.min(box.w / o.w, box.h / o.h);
    o.w *= f; o.h *= f; o.x = box.x + (box.w - o.w) / 2; o.y = box.y + (box.h - o.h) / 2;
  }
  function swap(a, aBox, b) {
    const bBox = { x: b.x, y: b.y, w: b.w, h: b.h };
    fitInto(a, bBox); fitInto(b, aBox);
    place(a); place(b);
  }
  function onHandle(e, hd) {
    e.preventDefault(); e.stopPropagation();
    const o = st.sel; if (!o) return;
    const sx = e.clientX, sy = e.clientY;
    const r0 = { x: o.x, y: o.y, w: o.w, h: o.h }, src0 = o.src ? { ...o.src } : null, nine0 = o.nine ? { ...o.nine } : null, crop0 = o._crop ? { ...o._crop } : null;
    const sc = o.src ? scaleOf(o) : 1;
    const fol = st.mode === 'crop' ? [] : followersOf(o);
    let changed = false;
    track(e, (ev) => {
      const dx = (ev.clientX - sx) / st.k, dy = (ev.clientY - sy) / st.k;
      if (Math.hypot(dx, dy) > 0.2) changed = true;
      if (st.mode === 'crop' && o.type === 'img' && crop0) {
        let { x, y, w, h: hh } = r0;
        const imgL = r0.x + crop0.ox, imgT = r0.y + crop0.oy, imgR = imgL + crop0.iw, imgB = imgT + crop0.ih;
        if (hd.includes('w')) { const nx = Math.min(r0.x + r0.w - 8, Math.max(imgL, r0.x + dx)); w = r0.x + r0.w - nx; x = nx; }
        if (hd.includes('e')) w = Math.max(8, Math.min(imgR - x, r0.w + dx));
        if (hd.includes('n')) { const ny = Math.min(r0.y + r0.h - 8, Math.max(imgT, r0.y + dy)); hh = r0.y + r0.h - ny; y = ny; }
        if (hd.includes('s')) hh = Math.max(8, Math.min(imgB - y, r0.h + dy));
        o.x = x; o.y = y; o.w = w; o.h = hh;
        o._crop = { ox: imgL - x, oy: imgT - y, iw: crop0.iw, ih: crop0.ih };
        const imgEl = o.view.querySelector('img');
        if (imgEl) Object.assign(imgEl.style, { left: (o._crop.ox / o.w) * 100 + '%', top: (o._crop.oy / o.h) * 100 + '%', width: (o._crop.iw / o.w) * 100 + '%', height: (o._crop.ih / o.h) * 100 + '%' });
      } else if (st.mode === 'crop' && src0) {
        const F = o.full; let { x, y, w, h: hh } = src0;
        if (hd.includes('w')) { const nx = Math.min(x + w - 4, Math.max(F.x, x + dx / sc)); w += x - nx; x = nx; }
        if (hd.includes('e')) w = Math.max(4, Math.min(F.x + F.w - x, w + dx / sc));
        if (hd.includes('n')) { const ny = Math.min(y + hh - 4, Math.max(F.y, y + dy / sc)); hh += y - ny; y = ny; }
        if (hd.includes('s')) hh = Math.max(4, Math.min(F.y + F.h - y, hh + dy / sc));
        o.src = { x, y, w, h: hh };
        o.dw = w; o.dh = hh;
        o.x = r0.x + (x - src0.x) * sc; o.y = r0.y + (y - src0.y) * sc; o.w = w * sc; o.h = hh * sc;
      } else if (o.type === 'bg') {
        let { x, y, w, h: hh } = r0;
        if (hd.includes('e')) w = Math.max(8, r0.w + dx);
        if (hd.includes('s')) hh = Math.max(8, r0.h + dy);
        if (hd.includes('w')) { w = Math.max(8, r0.w - dx); x = r0.x + r0.w - w; }
        if (hd.includes('n')) { hh = Math.max(8, r0.h - dy); y = r0.y + r0.h - hh; }
        const s0 = r0.w / (nine0 ? nine0.w : o.src.w);
        o.nine = { w: w / s0, h: hh / s0 };
        Object.assign(o, { x, y, w, h: hh });
      } else {
        const fx = (hd.includes('e') ? r0.w + dx : r0.w - dx) / r0.w, fy = (hd.includes('s') ? r0.h + dy : r0.h - dy) / r0.h;
        const f = Math.max(0.08, Math.abs(fx - 1) > Math.abs(fy - 1) ? fx : fy);
        const w = r0.w * f, hh = r0.h * f;
        o.x = hd.includes('w') ? r0.x + r0.w - w : r0.x; o.y = hd.includes('n') ? r0.y + r0.h - hh : r0.y;
        o.w = w; o.h = hh;
      }
      place(o); carry(fol, r0, { x: o.x, y: o.y, w: o.w, h: o.h }); drawHandles();
    }, () => {
      if (o.type === 'bg') render(o); else if (o.type !== 'photo' && o.type !== 'img') render(o);
      for (const { x } of fol) if (x.type === 'text' || x.type === 'deco' || x.type === 'box') render(x);
      syncSlotBox();
      if (changed) commitSnap();
    });
  }
  function track(e, onMove, onEnd) {
    const id = e.pointerId; const tgt = e.target;
    try { tgt.setPointerCapture(id); } catch (err) { /* ignore */ }
    let raf = 0, last = null;
    const mv = (ev) => { if (ev.pointerId !== id) return; last = ev; if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (last) onMove(last); }); };
    const up = (ev) => {
      if (ev.pointerId !== undefined && ev.pointerId !== id) return;
      if (raf) { cancelAnimationFrame(raf); raf = 0; if (last) onMove(last); }
      window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
      onEnd();
    };
    window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  }
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target !== stage && e.target !== slot) return;
    if (st.panMode) { e.preventDefault(); exitPanMode(); return; }
    if (st.mode === 'crop' && st.sel) {
      e.preventDefault();
      st.mode = null; drawHandles(); st.syncButtons(); commitSnap();
      return;
    }
    e.preventDefault(); stage.focus();
    const sr = stage.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    let marqueeEl = null, moved = false;
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    track(e, (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      if (!marqueeEl) {
        marqueeEl = h('div', { class: 'ae-marquee', 'data-testid': 'ae-marquee' });
        stage.append(marqueeEl);
      }
      const lx0 = Math.min(sx, ev.clientX) - sr.left, ly0 = Math.min(sy, ev.clientY) - sr.top;
      const lw = Math.abs(ev.clientX - sx), lh = Math.abs(ev.clientY - sy);
      Object.assign(marqueeEl.style, { left: lx0 + 'px', top: ly0 + 'px', width: lw + 'px', height: lh + 'px' });
      x0 = O.x + lx0 / st.k; y0 = O.y + ly0 / st.k;
      x1 = O.x + (lx0 + lw) / st.k; y1 = O.y + (ly0 + lh) / st.k;
    }, () => {
      if (marqueeEl) marqueeEl.remove();
      if (!moved) { select(null); return; }
      st.multiSel.clear();
      for (const o of objs) {
        if (o.deleted || o.el.hidden) continue;
        if (isUnit(o) && o.w > R.w * 0.8 && o.h > R.h * 0.8) continue;
        if (o.x + o.w >= x0 && o.x <= x1 && o.y + o.h >= y0 && o.y <= y1) st.multiSel.add(o);
      }
      st.sel = [...st.multiSel][0] || null;
      syncMultiClasses(); drawHandles(); st.syncButtons();
    });
  });
  stage.addEventListener('keydown', (e) => {
    if (st.panMode && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); exitPanMode(); return; }
    if (!st.sel && !st.multiSel.size) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
    else if (e.key === 'Enter' && st.sel && (st.sel.addedText || (st.sel.keepG && st.sel.keepG.length))) {
      e.preventDefault();
      const hit = sections.find((s) => s.o === st.sel);
      if (hit && hit.ed) { hit.ed.el.scrollIntoView({ block: 'nearest' }); hit.ed.focusEnd(); }
    } else if (e.key === 'Escape' && st.mode === 'crop') { st.mode = null; drawHandles(); st.syncButtons(); }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault(); const d = e.shiftKey ? 5 : 1;
      const targets = st.multiSel.size > 1 ? [...st.multiSel] : (st.sel ? [st.sel] : []);
      for (const tgt of targets) {
        const fol = followersOf(tgt), r0 = { x: tgt.x, y: tgt.y, w: tgt.w, h: tgt.h };
        if (e.key === 'ArrowLeft') tgt.x -= d; if (e.key === 'ArrowRight') tgt.x += d; if (e.key === 'ArrowUp') tgt.y -= d; if (e.key === 'ArrowDown') tgt.y += d;
        place(tgt); carry(fol, r0, { x: tgt.x, y: tgt.y, w: tgt.w, h: tgt.h });
      }
      drawHandles(); syncSlotBox();
      commitSnap();
    }
  });

  function del() {
    const targets = st.multiSel.size > 0 ? [...st.multiSel] : (st.sel ? [st.sel] : []);
    if (!targets.length) return;
    for (const tgt of targets) {
      const fol = isUnit(tgt) ? followersOf(tgt).map((f) => f.x) : [];
      tgt.deleted = true; place(tgt);
      for (const p of ocrPatchesOf(tgt)) { p.deleted = true; place(p); } // original pixels come back
      restoreSuppressedOcrText(tgt, objs, { place, render });
      if (tgt._badgeBgObj) { tgt._badgeBgObj.deleted = true; place(tgt._badgeBgObj); }
      for (const f of fol) { f.deleted = true; place(f); }
    }
    st.multiSel.clear();
    select(null); syncSlotBox(); st.syncLayout();
    if (targets.some((t) => t.ocr && t._encBox) && st.flushTextSync) {
      st.flushTextSync({ renderPreview: true }).then(() => commitSnap());
      return;
    }
    commitSnap();
  }
  function toggleCrop() { if (!st.sel || !cropable(st.sel)) return; st.mode = st.mode === 'crop' ? null : 'crop'; drawHandles(); st.syncButtons(); }
  function replacePhoto() {
    if (!st.sel || (st.sel.type !== 'photo' && st.sel.type !== 'img')) return;
    pickImageFor(st.sel);
  }
  function zorder(dir) {
    if (!st.sel) return;
    const i = objs.indexOf(st.sel); objs.splice(i, 1);
    if (dir > 0) objs.push(st.sel); else objs.unshift(st.sel);
    objs.forEach((o) => stage.insertBefore(o.el, guides));
    commitSnap();
  }

  Object.assign(st, {
    syncMultiClasses, applyCoverImageToObj, bakeCroppedImage, bakePlaceholderImage,
    enterPanMode, exitPanMode, pickImageFor, select, drawHandles, onDown, fitInto,
    del, toggleCrop, replacePhoto, zorder,
  });
}
