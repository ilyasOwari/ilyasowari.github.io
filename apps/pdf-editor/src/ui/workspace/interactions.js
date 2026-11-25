// Pointer interactions on a page: select, drag (first press), resize,
// marquee (select / split / erase), double-click edit, context menu.
import { h } from '../common/dom.js';
import { findBlock, blockRect } from '../../model/blockOps.js';
import { Scissors } from './scissors.js';
import { CropTool } from './cropTool.js';
import { InsertGuide } from './insertGuide.js';
import { planMove, planMagnetMove, planResize, previewResize } from '../../model/clamp.js';

const DRAG_THRESHOLD = 3;

export function attachInteractions(view, app) {
  const el = view.el;
  const scissors = new Scissors(view, app);
  view.scissors = scissors;
  const crop = new CropTool(view, app);
  view.crop = crop;
  const insertGuide = new InsertGuide(view, app);
  view.insertGuide = insertGuide;
  const toPt = (e) => { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) / view.z, y: (e.clientY - r.top) / view.z }; };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || app.busy) return;
    app.hideContextMenu();
    const page = view.page;
    app.session.ensurePage(page);
    const tool = app.session.tool;
    if (tool === 'insertSpot') { insertGuide.down(e); return; }
    const handle = e.target.closest('.handle');
    const blockEl = e.target.closest('.block');
    if (tool === 'split') { if (!e.target.closest('.sc-label')) scissors.down(e); return; }
    if (tool === 'crop') {
      if (e.target.closest('.crop-frame,.crop-bar')) return;
      if (blockEl) crop.start(blockEl.dataset.blockId); else { crop.cancel(); app.setTool('select'); }
      return;
    }
    if (tool === 'erase' || tool === 'marquee' || tool === 'cover' || tool === 'scanArea' || tool === 'restoreArea' || !blockEl) { startMarquee(e, tool); return; }
    const id = blockEl.dataset.blockId;
    const sel = app.session.selection;
    if (handle && sel.pageId === page.id && sel.ids.size === 1 && sel.ids.has(id)) { startResize(e, id, handle.dataset.handle); return; }
    if (app.floating) app.floating.setAnchor(page.id, toPt(e));
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      if (sel.pageId !== page.id) app.select(page, [id]);
      else { const ids = new Set(sel.ids); if (ids.has(id)) ids.delete(id); else ids.add(id); app.select(page, [...ids]); }
      if (!app.session.selection.ids.has(id)) return;
    } else if (sel.pageId !== page.id || !sel.ids.has(id)) app.select(page, [id]);
    startDrag(e, [...app.session.selection.ids]);
  });

  // (pointer capture retargets click events to the page, so hit-test by model)
  const blockAt = (pt) => {
    const bl = (view.page.blocks || []).slice().reverse().find((b) => { const r = blockRect(b); return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h; });
    return bl ? bl.id : null;
  };
  el.addEventListener('dblclick', (e) => {
    if (app.session.tool !== 'select') return;
    const pt = toPt(e);
    const id = blockAt(pt);
    if (!id) return;
    const sel = app.session.selection;
    const ids = sel.pageId === view.page.id && sel.ids.has(id) && sel.ids.size > 1 ? [...sel.ids] : [id];
    app.editArea(view.page, ids, { point: pt });
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const page = view.page;
    app.session.ensurePage(page);
    const blockEl = e.target.closest('.block');
    const sel = app.session.selection;
    if (app.floating) app.floating.suppressForCtx = true;
    try {
      if (blockEl && (sel.pageId !== page.id || !sel.ids.has(blockEl.dataset.blockId))) app.select(page, [blockEl.dataset.blockId]);
      if (!blockEl && sel.pageId !== page.id) app.select(page, []);
      app.showContextMenu(e.clientX, e.clientY, page, toPt(e), !!blockEl);
    } finally {
      if (app.floating) app.floating.suppressForCtx = false;
    }
  });

  // Shared pointer tracking: ends exactly once (up, cancel, lost capture or
  // Escape); the live preview is updated at most once per animation frame.
  function track(e, { onMove, onEnd }) {
    el.setPointerCapture(e.pointerId);
    let last = e, raf = 0, ended = false;
    const frame = () => { raf = 0; onMove(last); };
    const move = (ev) => { if (ev.pointerId !== e.pointerId) return; last = ev; if (!raf) raf = requestAnimationFrame(frame); };
    const finish = (ev, cancelled) => {
      if (ended) return;
      ended = true;
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up); window.removeEventListener('pointerup', up, true); window.removeEventListener('keydown', key, true);
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (ev && ev.clientX !== undefined && !cancelled) last = ev;
      onEnd(last, cancelled);
    };
    const up = (ev) => { if (ev.pointerId !== undefined && ev.pointerId !== e.pointerId) return; finish(ev.type === 'pointerup' ? ev : null, false); };
    const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); finish(null, true); } };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up); window.addEventListener('pointerup', up, true); window.addEventListener('keydown', key, true);
  }
  const elsOf = (ids) => ids.map((id) => view.blockEls.get(id)).filter(Boolean).map((r) => r.el);

  function startDrag(e, ids) {
    const page = view.page;
    const els = elsOf(ids);
    const x0 = e.clientX, y0 = e.clientY;
    const ws = app.workspace && app.workspace.el;
    const scrollL0 = ws ? ws.scrollLeft : 0, scrollT0 = ws ? ws.scrollTop : 0;
    const viewList = [...app.workspace.views.values()];
    const myViewIdx = viewList.indexOf(view);
    const hasPrevPage = myViewIdx > 0;
    const hasNextPage = myViewIdx >= 0 && myViewIdx < viewList.length - 1;
    let dragging = false, crossFloating = false, lastEv = e, autoScrollRaf = 0;
    app.hideFloating();
    const rawDelta = (ev) => ({
      dx: (ev.clientX - x0) + ((ws ? ws.scrollLeft : 0) - scrollL0),
      dy: (ev.clientY - y0) + ((ws ? ws.scrollTop : 0) - scrollT0),
    });
    const pageUnder = (ev) => {
      for (const v of app.workspace.views.values()) {
        const r = v.el.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return v;
      }
      return null;
    };
    const nearestOtherPage = (ev) => {
      const hit = pageUnder(ev);
      if (hit) return hit;
      let best = null, bestScore = Infinity;
      for (const v of app.workspace.views.values()) {
        if (v === view) continue;
        const r = v.el.getBoundingClientRect();
        if (ev.clientX < r.left - 80 || ev.clientX > r.right + 80) continue;
        const dy = ev.clientY < r.top ? r.top - ev.clientY : (ev.clientY > r.bottom ? ev.clientY - r.bottom : 0);
        if (dy > 72) continue;
        const dx = ev.clientX < r.left ? r.left - ev.clientX : (ev.clientX > r.right ? ev.clientX - r.right : 0);
        const sc = dy + dx * 0.25;
        if (sc < bestScore) { bestScore = sc; best = v; }
      }
      return best;
    };
    const bs = page.blocks.filter((b) => ids.includes(b.id));
    const bRects = bs.map(blockRect);
    const minBy = bRects.length ? Math.min(...bRects.map((r) => r.y)) : 0;
    const maxBy = bRects.length ? Math.max(...bRects.map((r) => r.y + r.h)) : 0;
    const useMagnet = () => app.session.magnet !== false && bs.length && !bs.some((b) => b.free);
    const clearFollowerTransforms = () => {
      for (const bEl of view.el.querySelectorAll('.block')) {
        if (!ids.includes(bEl.dataset.blockId)) bEl.style.transform = '';
      }
    };
    const planAt = (ev) => {
      const { dx, dy } = rawDelta(ev);
      const dxPt = dx / view.z, dyPt = dy / view.z;
      return useMagnet()
        ? planMagnetMove(page, ids, dxPt, dyPt, { lockPage: !!app.session.lockPage })
        : planMove(page, ids, dxPt, dyPt);
    };
    const applyDragMove = (ev) => {
      const { dx, dy } = rawDelta(ev);
      const tv = pageUnder(ev);
      const vr = view.el.getBoundingClientRect();
      const grpTop = vr.top + minBy * view.z + dy;
      const grpBot = vr.top + maxBy * view.z + dy;
      crossFloating = !!(
        (tv && tv !== view)
        || (hasNextPage && (ev.clientY > vr.bottom - 6 || grpBot > vr.bottom + 8))
        || (hasPrevPage && (ev.clientY < vr.top + 6 || grpTop < vr.top - 8))
      );
      if (crossFloating) {
        clearFollowerTransforms();
        els.forEach((b) => { b.classList.add('cross-page'); b.style.transform = `translate(${dx}px, ${dy}px)`; });
        return;
      }
      els.forEach((b) => b.classList.remove('cross-page'));
      const p = planAt(ev);
      clearFollowerTransforms();
      if (p) {
        els.forEach((b) => { b.style.transform = `translate(${p.dx * view.z}px, ${p.dy * view.z}px)`; });
        if (p.shifts && p.shifts.size) {
          for (const [bid, sy] of p.shifts) {
            const fEl = view.blockEls?.get(bid)?.el || view.el.querySelector(`.block[data-block-id="${bid}"]`);
            if (fEl) fEl.style.transform = `translate(0px, ${sy * view.z}px)`;
          }
        }
      }
    };
    const stopAutoScroll = () => {
      if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = 0; }
    };
    const ensureAutoScroll = () => {
      if (autoScrollRaf || !ws || !dragging || !crossFloating) return;
      const step = () => {
        autoScrollRaf = 0;
        if (!dragging || !crossFloating || !ws) return;
        const wr = ws.getBoundingClientRect();
        let spd = 0;
        if (hasNextPage && lastEv.clientY > wr.bottom - 54) spd = Math.min(22, Math.max(4, (lastEv.clientY - (wr.bottom - 54)) * 0.4));
        else if (hasPrevPage && lastEv.clientY < wr.top + 54) spd = -Math.min(22, Math.max(4, ((wr.top + 54) - lastEv.clientY) * 0.4));
        if (!spd) return;
        const before = ws.scrollTop;
        ws.scrollTop += spd;
        if (ws.scrollTop !== before) applyDragMove(lastEv);
        autoScrollRaf = requestAnimationFrame(step);
      };
      autoScrollRaf = requestAnimationFrame(step);
    };
    const snapBackEls = () => {
      els.forEach((b) => {
        if (b.style.transform && b.style.transform !== 'translate(0px, 0px)') b.classList.add('snapback');
        b.style.transform = '';
      });
      setTimeout(() => els.forEach((b) => b.classList.remove('snapback')), 230);
    };
    track(e, {
      onMove(ev) {
        lastEv = ev;
        if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_THRESHOLD) return;
        if (!dragging) { dragging = true; view.el.style.zIndex = '20'; els.forEach((b) => b.classList.add('dragging')); }
        applyDragMove(ev);
        if (crossFloating) ensureAutoScroll(); else stopAutoScroll();
      },
      onEnd(ev, cancelled) {
        stopAutoScroll();
        view.el.style.zIndex = '';
        els.forEach((b) => b.classList.remove('dragging', 'cross-page'));
        const endEv = ev || lastEv;
        if (!dragging && !cancelled && Math.hypot(endEv.clientX - x0, endEv.clientY - y0) >= DRAG_THRESHOLD) dragging = true;
        if (!dragging || cancelled) { clearFollowerTransforms(); snapBackEls(); app.showFloating(); return; }
        // a newly inserted block keeps its glow until the user moves it once
        if (app.freshBlocks && ids.some((id) => app.freshBlocks.has(id))) {
          ids.forEach((id) => app.freshBlocks.delete(id));
          els.forEach((b) => b.classList.remove('just-inserted'));
        }
        const tv = pageUnder(endEv) || (crossFloating ? nearestOtherPage(endEv) : null);
        if (tv && tv !== view) {
          clearFollowerTransforms();
          const { dx, dy } = rawDelta(endEv);
          const sr = view.el.getBoundingClientRect(), tr = tv.el.getBoundingClientRect();
          const dxTarget = (dx - (tr.left - sr.left)) / tv.z;
          const dyTarget = (dy - (tr.top - sr.top)) / tv.z;
          const ok = app.controller.moveAcrossPages(page, tv.page, ids, dxTarget, dyTarget);
          if (ok) {
            if (app.floating) app.floating.setAnchor(tv.page.id, { x: (endEv.clientX - tr.left) / tv.z, y: (endEv.clientY - tr.top) / tv.z });
            app.select(tv.page, ids);
            const targetView = app.workspace.view(tv.page.id);
            const placedEls = targetView ? ids.map((bid) => targetView.blockEls.get(bid)?.el).filter(Boolean) : [];
            if (placedEls.length) {
              placedEls.forEach((b) => { b.style.transform = 'scale(1.015)'; });
              requestAnimationFrame(() => requestAnimationFrame(() => {
                placedEls.forEach((b) => { b.classList.add('cross-settle'); b.style.transform = ''; });
                setTimeout(() => placedEls.forEach((b) => b.classList.remove('cross-settle')), 210);
              }));
            }
          } else { snapBackEls(); app.toastKey('noSpace'); }
          app.showFloating();
          return;
        }
        const p = planAt(endEv);
        const r = p && app.controller.move(page, ids, p.dx, p.dy, p);
        // clamping is silent: the block simply stops at the last free spot
        if (!r) { clearFollowerTransforms(); snapBackEls(); }
        else if (app.floating && endEv && endEv.clientX !== undefined) app.floating.setAnchor(page.id, toPt(endEv));
        app.showFloating();
      },
    });
  }

  function startResize(e, id, hd) {
    e.stopPropagation();
    const page = view.page;
    const b = findBlock(page, id);
    const rec = view.blockEls.get(id);
    if (!b || !rec) return;
    const R = blockRect(b);
    const x0 = e.clientX, y0 = e.clientY;
    let pushed = [];
    app.hideFloating();
    rec.el.classList.add('resizing');
    const planAt = (ev) => {
      const dx = (ev.clientX - x0) / view.z, dy = (ev.clientY - y0) / view.z;
      const kw = hd.includes('e') ? (R.w + dx) / R.w : hd.includes('w') ? (R.w - dx) / R.w : null;
      const kh = hd.includes('s') ? (R.h + dy) / R.h : hd.includes('n') ? (R.h - dy) / R.h : null;
      const k = kw !== null && kh !== null ? Math.max(kw, kh) : (kw ?? kh);
      return planResize(page, id, k, hd);
    };
    const show = (p) => {
      const z = view.z;
      rec.el.style.transformOrigin = 'left top';
      rec.el.style.transform = p ? `translate(${(p.x - R.x) * z}px, ${(p.y - R.y) * z}px) scale(${p.f})` : '';
      pushed.forEach((x) => { x.style.transform = ''; });
      pushed = p && p.push > 0 ? elsOf(p.pushIds) : [];
      pushed.forEach((x) => { x.style.transform = `translate(0px, ${p.push * z}px)`; });
      // Mıknatıs: while shrinking, the blocks below follow up live (same gap)
      const lift = previewResize(page, p, app.session.magnet !== false);
      for (const [bid, d] of lift) {
        const r = view.blockEls.get(bid); if (!r) continue;
        r.el.style.transform = `translate(0px, ${d * z}px)`; pushed.push(r.el);
      }
    };
    const reset = () => { show(null); rec.el.style.transformOrigin = ''; rec.el.classList.remove('resizing'); };
    track(e, {
      onMove(ev) { show(planAt(ev)); },
      onEnd(ev, cancelled) {
        const p = cancelled ? null : planAt(ev);
        const moved = Math.hypot(ev.clientX - x0, ev.clientY - y0) > 2;
        void moved;
        if (!p || p.unchanged) { reset(); app.showFloating(); return; }
        show(p);
        rec.el.classList.remove('resizing');
        const r = app.controller.resize(page, p);
        if (!r) reset();
        else if (r === 'pushed') app.toastKey('resizePushed');
        app.showFloating();
      },
    });
  }

  function startMarquee(e, tool) {
    const page = view.page;
    const p0 = toPt(e);
    const box = h('div', { class: 'marquee ' + (tool === 'split' ? 'split' : tool === 'erase' ? 'erase' : (tool === 'cover' || tool === 'scanArea' || tool === 'restoreArea') ? 'cover' : '') });
    let shown = false;
    el.setPointerCapture(e.pointerId);
    let rect = null, lastPt = p0;
    const move = (ev) => {
      const p = toPt(ev);
      lastPt = p;
      const x = Math.max(0, Math.min(p0.x, p.x)), y = Math.max(0, Math.min(p0.y, p.y));
      const x2 = Math.min(page.w, Math.max(p0.x, p.x)), y2 = Math.min(page.h, Math.max(p0.y, p.y));
      rect = { x, y, w: x2 - x, h: y2 - y };
      if (!shown && (rect.w > 2 || rect.h > 2)) { el.append(box); shown = true; }
      Object.assign(box.style, { left: x * view.z + 'px', top: y * view.z + 'px', width: rect.w * view.z + 'px', height: rect.h * view.z + 'px' });
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      box.remove();
      if (!rect || rect.w < 3 || rect.h < 3) {
        // plain click on empty area (or tiny marquee): select under pointer / clear
        const blockEl = e.target.closest('.block');
        if (blockEl && app.floating) app.floating.setAnchor(page.id, p0);
        app.select(page, blockEl ? [blockEl.dataset.blockId] : []);
        return;
      }
      if (tool === 'split') app.splitArea(page, rect);
      else if (tool === 'erase') app.eraseArea(page, rect);
      else if (tool === 'cover') app.coverArea(page, rect);
      else if (tool === 'scanArea') app.scanPageRegion(page, rect);
      else if (tool === 'restoreArea') app.restoreArea(page, rect);
      else {
        const ids = page.blocks.filter((b) => { const r = blockRect(b); return r.x < rect.x + rect.w && r.x + r.w > rect.x && r.y < rect.y + rect.h && r.y + r.h > rect.y; }).map((b) => b.id);
        if (ids.length && app.floating) app.floating.setAnchor(page.id, lastPt);
        app.select(page, ids);
      }
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
}
