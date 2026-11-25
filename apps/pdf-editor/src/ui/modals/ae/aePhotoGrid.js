// Photo + Badge Grid Shell (left/right/mid/bottom add, gap width, smart order)
import { h } from '../../common/dom.js';
import { t } from '../../../i18n/i18n.js';
import { icon } from '../../../../assets/icons/icons.js';
import { openAllModels } from '../../../engines/text/editSession.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export function setupAePhotoGrid(st) {
  const {
    an, doc, stage, guides, slot, R, O, pad, extra, X, Y,
    objs, sections, allEds, badgeOnlyText, multiSel,
    scaleOf, partOf, place, render, wireObjEl, makeSectionEditor,
    commitSnap, flushTextSync, syncSlotBox,
  } = st;

  const photoCardObjs = () => objs.filter((o) => !o.deleted && (o.type === 'photo' || o.type === 'img') && o.w >= 16 && o.h >= 16);
  let photoGridUi = null;
  if (badgeOnlyText && photoCardObjs().length >= 2) {
    let rebuildMidStrips = () => {};
    const syncStageToObjs = () => {
      const act = objs.filter((o) => !o.deleted);
      if (!act.length) return;
      const minX = Math.min(R.x, ...act.map((o) => o.x));
      const minY = Math.min(R.y, ...act.map((o) => o.y));
      const maxX = Math.max(R.x + R.w, ...act.map((o) => o.x + o.w));
      const maxY = Math.max(R.y + R.h, ...act.map((o) => o.y + o.h));
      R.x = minX; R.y = minY; R.w = Math.max(R.w, maxX - minX); R.h = Math.max(R.h, maxY - minY);
      O.x = R.x - pad; O.y = R.y - pad;
      Object.assign(stage.style, { width: (R.w + 2 * pad) * st.k + 'px', height: (R.h + pad + extra) * st.k + 'px' });
      Object.assign(slot.style, { left: X(R.x) + 'px', top: Y(R.y) + 'px', width: R.w * st.k + 'px', height: R.h * st.k + 'px' });
      objs.forEach(place);
      syncSlotBox();
      rebuildMidStrips();
    };

    const getPhotoCards = () => {
      const photos = photoCardObjs();
      const cards = photos.map((p) => {
        let bestBadge = null, bestD = Infinity;
        for (const s of sections) {
          if (!s.badge || s.o.deleted) continue;
          const cx = s.o.x + s.o.w / 2, cy = s.o.y + s.o.h / 2;
          if (cx >= p.x - 10 && cx <= p.x + p.w + 10 && cy >= p.y + p.h - 10 && cy <= p.y + p.h + 42) {
            const d = Math.hypot(cx - (p.x + p.w / 2), cy - (p.y + p.h + 8));
            if (d < bestD) { bestD = d; bestBadge = s; }
          }
        }
        const extras = objs.filter((x) => !x.deleted && x !== p
          && (!bestBadge || (x !== bestBadge.o && x !== bestBadge.o._badgeBgObj))
          && (x.type === 'deco' || x.type === 'box') && x.w <= Math.max(48, p.w * 0.65) && x.h <= 44
          && x.x + x.w / 2 >= p.x - 10 && x.x + x.w / 2 <= p.x + p.w + 10
          && x.y >= p.y + p.h - 10 && x.y <= p.y + p.h + 44);
        return { p, badgeSec: bestBadge, extras };
      });
      const avgH = cards.reduce((s, c) => s + c.p.h, 0) / Math.max(1, cards.length);
      cards.sort((a, b) => a.p.y - b.p.y);
      const rows = [];
      for (const c of cards) {
        const cy = c.p.y + c.p.h / 2;
        const last = rows[rows.length - 1];
        if (last && Math.abs(cy - last.cy) < Math.max(14, avgH * 0.45)) {
          last.items.push(c);
          last.cy = last.items.reduce((s, it) => s + it.p.y + it.p.h / 2, 0) / last.items.length;
        } else {
          rows.push({ cy, items: [c] });
        }
      }
      rows.forEach((r) => r.items.sort((a, b) => a.p.x - b.p.x));
      return { cards: rows.flatMap((r) => r.items), rows };
    };

    const moveCardBy = (card, dx, dy) => {
      card.p.x += dx; card.p.y += dy; place(card.p);
      if (card.badgeSec && card.badgeSec.o) {
        const bo = card.badgeSec.o;
        bo.x += dx; bo.y += dy;
        if (bo._base) { bo._base.x += dx; bo._base.y += dy; }
        card.badgeSec.x = bo.x; card.badgeSec.y = bo.y;
        place(bo);
        const bg = bo._badgeBgObj;
        if (bg && !bg.deleted) {
          bg.x += dx; bg.y += dy;
          if (bg._base) { bg._base.x += dx; bg._base.y += dy; }
          place(bg);
        }
      }
      for (const ex of card.extras) {
        ex.x += dx; ex.y += dy;
        if (ex._base) { ex._base.x += dx; ex._base.y += dy; }
        place(ex);
      }
    };

    const createTemplateCard = (x, y, tplCard, badgeRowEl, prependBadge = false) => {
      const tp = tplCard.p;
      const tbs = tplCard.badgeSec;
      const cardH = (tbs && tbs.o && tbs.o.y > tp.y + 12) ? Math.min(tp.h, tbs.o.y - tp.y - 2) : tp.h;
      const oid = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const o = {
        id: oid, type: 'img', placeholder: true,
        img: { dataUrl: '', anchor: 0, wrap: false, width: 1 },
        x, y, w: tp.w, h: cardH, keep: [], keepG: [],
      };
      o.el = h('div', { class: 'ae-obj ae-img ae-placeholder', 'data-testid': 'ae-obj', 'data-type': 'img', 'data-oid': o.id });
      o.view = h('div', { class: 'ae-view' }, h('span', { html: icon('image', 'icon icon-sm') }), h('span', null, t('clickToReplace')));
      o.el.append(o.view);
      wireObjEl(o);
      objs.push(o); stage.insertBefore(o.el, guides); place(o);

      for (const ex of tplCard.extras) {
        const dxE = ex.x - tp.x, dyE = ex.y - tp.y;
        const eo = {
          id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + 'e',
          type: ex.type,
          src: { ...ex.src }, full: { ...(ex.full || ex.src) },
          keep: (ex.keep || []).slice(), keepG: (ex.keepG || []).slice(),
          edit: ex.edit ? clone(ex.edit) : null, nine: ex.nine ? { ...ex.nine } : null,
          k: ex.k, dw: ex.dw, dh: ex.dh, x: x + dxE, y: y + dyE, w: ex.w, h: ex.h,
        };
        eo.el = h('div', { class: 'ae-obj ae-' + eo.type, 'data-testid': 'ae-obj', 'data-type': eo.type, 'data-oid': eo.id });
        eo.view = h('div', { class: 'ae-view' });
        eo.canvas = h('canvas'); eo.view.append(eo.canvas); eo.el.append(eo.view);
        wireObjEl(eo);
        objs.push(eo); stage.insertBefore(eo.el, guides); place(eo); render(eo);
      }

      let newBadgeSec = null;
      if (tbs && tbs.o) {
        const to = tbs.o;
        const scT = scaleOf(to);
        const toBase = to._base || to;
        const tplBg = (to._badgeBgObj && !to._badgeBgObj.deleted) ? to._badgeBgObj : null;
        const dxB = toBase.x - tp.x, dyB = toBase.y - tp.y;
        const bx = x + dxB, by = y + dyB;
        const toKeep = (to.keep || []).slice();
        const pillKeep = toKeep.length ? toKeep : (tplBg && tplBg.keep ? tplBg.keep.slice() : []);
        const pillG = pillKeep.length && an && an.atoms && an.atoms.gfx
          ? pillKeep.map((gi) => an.atoms.gfx[gi]).find((g) => g && g.fill && g.rgb && (0.299 * g.rgb[0] + 0.587 * g.rgb[1] + 0.114 * g.rgb[2]) < 210)
          : null;
        const toContainer = to.container ? { ...to.container }
          : (tbs.model && tbs.model.container ? { ...tbs.model.container }
            : (pillG && pillG.b ? { ...pillG.b } : null));
        let bgObj = null;
        if (toKeep.length) {
          bgObj = {
            id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + 'bg',
            type: 'deco',
            src: { ...toBase.src }, full: { ...(toBase.full || toBase.src) },
            keep: toKeep, keepG: [], edit: null, nine: null, k: scT,
            dw: toBase.dw, dh: toBase.dh, x: bx, y: by, w: toBase.w, h: toBase.h,
          };
        } else if (tplBg && tplBg.keep && tplBg.keep.length) {
          const bgBase = tplBg._base || tplBg;
          const scBgT = scaleOf(tplBg);
          bgObj = {
            id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + 'bg',
            type: 'deco',
            src: { ...bgBase.src }, full: { ...(bgBase.full || bgBase.src) },
            keep: tplBg.keep.slice(), keepG: [], edit: null, nine: null, k: scBgT,
            dw: bgBase.dw, dh: bgBase.dh, x: x + (bgBase.x - tp.x), y: y + (bgBase.y - tp.y), w: bgBase.w, h: bgBase.h,
          };
        }
        if (bgObj) {
          bgObj._base = { src: { ...bgObj.src }, full: { ...bgObj.full }, keepG: [], edit: null, dw: bgObj.dw, dh: bgObj.dh, w: bgObj.w, h: bgObj.h, x: bgObj.x, y: bgObj.y };
          bgObj.el = h('div', { class: 'ae-obj ae-deco', 'data-testid': 'ae-obj', 'data-type': 'deco', 'data-oid': bgObj.id });
          bgObj.view = h('div', { class: 'ae-view' });
          bgObj.canvas = h('canvas'); bgObj.view.append(bgObj.canvas); bgObj.el.append(bgObj.view);
          wireObjEl(bgObj);
          objs.push(bgObj); stage.insertBefore(bgObj.el, guides); place(bgObj); render(bgObj);
        }
        const badgeRect = toContainer || toBase.src;
        const bDw = Math.max(8, (badgeRect.x1 != null ? badgeRect.x1 - badgeRect.x0 : toBase.dw));
        const bDh = Math.max(8, (badgeRect.y1 != null ? badgeRect.y1 - badgeRect.y0 : toBase.dh));
        const bOffX = (badgeRect.x0 != null ? (badgeRect.x0 - toBase.src.x) * scT : 0);
        const bOffY = (badgeRect.y0 != null ? (badgeRect.y0 - toBase.src.y) * scT : 0);
        const src = toContainer
          ? { x: toContainer.x0, y: toContainer.y0, w: bDw, h: bDh }
          : { x: toBase.src.x + (bx - toBase.x) / scT, y: toBase.src.y + (by - toBase.y) / scT, w: toBase.dw, h: toBase.dh };
        const toBaseline = (tbs.model && tbs.model.area && Number.isFinite(tbs.model.area.firstBaseline))
          ? tbs.model.area.firstBaseline
          : (to.badgeBaseline ?? null);
        const bo = {
          id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + 'b',
          type: 'text', addedText: true, badge: true,
          refGlyphIdx: to.refGlyphIdx != null && to.refGlyphIdx >= 0
            ? to.refGlyphIdx
            : (tbs.model?.origCharGlyph?.find(Boolean)?.idx ?? (to.keepG && to.keepG[0] != null ? to.keepG[0] : -1)),
          fontSize: (tbs.model?.lines?.[0]?.size) || to.fontSize || tbs.model?.fontSize || 10,
          baseW: src.w,
          container: toContainer,
          badgeBaseline: toBaseline,
          src: { ...src }, full: { ...src }, keep: [], keepG: [], edit: null, nine: null, k: scT,
          dw: src.w, dh: src.h, x: bx + bOffX, y: by + bOffY, w: src.w * scT, h: src.h * scT,
        };
        bo._base = { src: { ...bo.src }, full: { ...bo.full }, keepG: [], edit: null, dw: bo.dw, dh: bo.dh, w: bo.w, h: bo.h, x: bo.x, y: bo.y };
        bo._origPart = partOf(bo);
        if (bgObj) { bo._badgeBgObj = bgObj; bgObj._badgeContainer = toContainer ? { ...toContainer } : null; }
        bo.el = h('div', { class: 'ae-obj ae-text ae-added-text', 'data-testid': 'ae-obj', 'data-type': 'text', 'data-oid': bo.id });
        bo.view = h('div', { class: 'ae-view' });
        bo.canvas = h('canvas'); bo.view.append(bo.canvas); bo.el.append(bo.view);
        wireObjEl(bo);
        objs.push(bo); stage.insertBefore(bo.el, guides); place(bo);
        const model = openAllModels(an, bo._origPart)[0];
        model.badge = true;
        const tplSt = tbs.model?.paras?.[0]?.st?.[0]?.s ? clone(tbs.model.paras[0].st[0].s) : {};
        const hasExtraBg = (tplCard.extras || []).some((ex) => !ex.deleted && ex.keep && ex.keep.length);
        if (toKeep.length > 0 || bgObj || hasExtraBg) {
          delete tplSt.bg;
        } else if (!tplSt.bg && an && an.atoms && an.atoms.gfx) {
          const toBx = { x0: toBase.src.x - 2, y0: toBase.src.y - 2, x1: toBase.src.x + toBase.src.w + 2, y1: toBase.src.y + toBase.src.h + 2 };
          const pillG2 = an.atoms.gfx.find((g) => g && g.fill && g.rgb && (g.b.x1 - g.b.x0) <= 44 && (g.b.y1 - g.b.y0) <= 32
            && g.b.x0 <= toBx.x1 && g.b.x1 >= toBx.x0 && g.b.y0 <= toBx.y1 && g.b.y1 >= toBx.y0
            && (0.299 * g.rgb[0] + 0.587 * g.rgb[1] + 0.114 * g.rgb[2]) < 180);
          if (pillG2 && pillG2.rgb) {
            const hex = '#' + pillG2.rgb.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
            tplSt.bg = { shape: 'round', fc: hex, fo: 1, bc: null, bw: 0, bo: 0 };
          }
        }
        model.paras = [{ text: '-', marker: false, ...(toContainer ? { align: 'center' } : {}), ...(Object.keys(tplSt).length ? { st: [{ a: 0, b: 1, s: tplSt }] } : {}) }];
        model.text = '-';
        newBadgeSec = { o: bo, model, badge: true, maxGrowX: 0, maxGrowY: 0, y: bo.y, x: bo.x, rowEl: badgeRowEl };
        newBadgeSec.ed = makeSectionEditor(newBadgeSec);
        newBadgeSec.lastSyncedParas = null;
        if (prependBadge) badgeRowEl.prepend(newBadgeSec.ed.el);
        else badgeRowEl.append(newBadgeSec.ed.el);
        sections.push(newBadgeSec);
        allEds.push(newBadgeSec.ed);
      }
      return { p: o, badgeSec: newBadgeSec };
    };

    const addTemplateCards = (dir, afterRowIdx = 0) => {
      const { cards, rows } = getPhotoCards();
      if (!cards.length) return;
      commitSnap();
      const gapsY = [];
      for (let r = 0; r < rows.length - 1; r++) {
        const bot = Math.max(...rows[r].items.map((c) => c.p.y + c.p.h));
        const top = Math.min(...rows[r + 1].items.map((c) => c.p.y));
        gapsY.push(top - bot);
      }
      const gapY = gapsY.length ? Math.max(18, gapsY.reduce((a, b) => a + b, 0) / gapsY.length) : 24;
      const singleCardGap = 56;

      if (dir === 'right') {
        for (const r of rows) {
          const last = r.items[r.items.length - 1];
          const rowGap = r.items.length >= 2
            ? Math.max(6, last.p.x - (r.items[r.items.length - 2].p.x + r.items[r.items.length - 2].p.w))
            : singleCardGap;
          const rowEl = (last.badgeSec && last.badgeSec.rowEl) || doc.querySelector('.te-row-badges') || h('div', { class: 'te-row te-row-badges' });
          if (!rowEl.parentNode) doc.append(rowEl);
          createTemplateCard(last.p.x + last.p.w + rowGap, last.p.y, last, rowEl, false);
        }
      } else if (dir === 'left') {
        const rowPlans = rows.map((r) => {
          const first = r.items[0];
          const rowGap = r.items.length >= 2
            ? Math.max(6, r.items[1].p.x - (first.p.x + first.p.w))
            : singleCardGap;
          const newX = first.p.x - (first.p.w + rowGap);
          return { r, first, rowGap, newX };
        });
        const minNewX = Math.min(...rowPlans.map((p) => p.newX));
        const shiftRight = minNewX < 8 ? (8 - minNewX) : 0;
        if (shiftRight > 0) for (const c of cards) moveCardBy(c, shiftRight, 0);
        for (const pl of rowPlans) {
          const rowEl = (pl.first.badgeSec && pl.first.badgeSec.rowEl) || doc.querySelector('.te-row-badges') || h('div', { class: 'te-row te-row-badges' });
          if (!rowEl.parentNode) doc.append(rowEl);
          createTemplateCard(pl.newX + shiftRight, pl.first.p.y, pl.first, rowEl, true);
        }
      } else if (dir === 'mid') {
        const tplRow = rows[Math.max(0, Math.min(rows.length - 1, afterRowIdx))];
        const rowTop = Math.min(...tplRow.items.map((c) => c.p.y));
        const rowBot = Math.max(...tplRow.items.map((c) => c.p.y + c.p.h));
        const shiftDy = (rowBot - rowTop) + gapY;
        for (let r = afterRowIdx + 1; r < rows.length; r++) {
          for (const c of rows[r].items) moveCardBy(c, 0, shiftDy);
        }
        const newRowEl = h('div', { class: 'te-row te-row-badges' });
        const afterBadgeRow = tplRow.items.find((c) => c.badgeSec && c.badgeSec.rowEl)?.badgeSec.rowEl;
        if (afterBadgeRow) afterBadgeRow.after(newRowEl); else doc.append(newRowEl);
        for (const c of tplRow.items) {
          createTemplateCard(c.p.x, rowBot + gapY, c, newRowEl, false);
        }
      } else if (dir === 'bottom') {
        const lastRow = rows[rows.length - 1];
        const maxBot = Math.max(...lastRow.items.map((c) => c.p.y + c.p.h));
        const newRowEl = h('div', { class: 'te-row te-row-badges' });
        const lastBadgeRow = [...doc.querySelectorAll('.te-row-badges')].pop();
        if (lastBadgeRow) lastBadgeRow.after(newRowEl); else doc.append(newRowEl);
        for (const c of lastRow.items) {
          createTemplateCard(c.p.x, maxBot + gapY, c, newRowEl, false);
        }
      }
      syncStageToObjs();
      st.syncLayout();
      if (dir === 'bottom' && stage.parentElement) {
        const sc = stage.parentElement;
        requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; });
      }
      flushTextSync();
    };

    let photoGapOffset = 0;
    const gapValSpan = h('span', { class: 'te-col-val', 'data-testid': 'ae-gap-val' }, '0');
    const stepPhotoGap = (d) => {
      const { rows } = getPhotoCards();
      if (!rows.length) return;
      const minGap = Math.min(...rows.flatMap((r) => r.items.slice(1).map((c, i) => c.p.x - (r.items[i].p.x + r.items[i].p.w))));
      if (d < 0 && minGap + d < 2) return;
      commitSnap();
      photoGapOffset += d;
      gapValSpan.textContent = (photoGapOffset > 0 ? '+' : '') + photoGapOffset;
      for (const r of rows) {
        for (let i = 1; i < r.items.length; i++) moveCardBy(r.items[i], i * d, 0);
      }
      syncStageToObjs();
    };

    const smartOrderCards = (kind) => {
      const { cards } = getPhotoCards();
      const selectedCards = cards.filter((c) => multiSel.has(c.p));
      const targets = (selectedCards.length >= 2 ? selectedCards : cards).filter((c) => c.badgeSec);
      if (!targets.length) return;
      commitSnap();
      targets.forEach((c, idx) => {
        const ed = c.badgeSec.ed;
        const ps = ed.value();
        const curText = (ps && ps[0] && ps[0].text) || '';
        const suffix = curText.trim().endsWith('.') ? '.' : (curText.trim().endsWith(')') ? ')' : '');
        const label = (kind === 'alpha' ? String.fromCharCode(97 + (idx % 26)) : String(idx + 1)) + suffix;
        const pEl = ed.paper.querySelector('.te-para');
        if (pEl) {
          const firstSpan = pEl.querySelector('span');
          if (firstSpan) {
            firstSpan.textContent = label;
            while (firstSpan.nextSibling) firstSpan.nextSibling.remove();
          } else {
            pEl.textContent = label;
          }
          ed.placeMarks();
        }
      });
      flushTextSync();
    };

    const btnTplLeft = h('button', { type: 'button', class: 'ae-edge-btn ae-edge-left', 'data-testid': 'ae-tpl-left', onclick: () => addTemplateCards('left') }, '+ ' + t('addTemplateLeft'));
    const btnTplRight = h('button', { type: 'button', class: 'ae-edge-btn ae-edge-right', 'data-testid': 'ae-tpl-right', onclick: () => addTemplateCards('right') }, '+ ' + t('addTemplateRight'));
    const btnTplBottom = h('button', { type: 'button', class: 'ae-bottom-add-btn', 'data-testid': 'ae-tpl-bottom', onclick: () => addTemplateCards('bottom') }, '+ ' + t('addTemplateBottomEnd'));
    const btnGapDec = h('button', { type: 'button', 'data-testid': 'ae-gap-dec', onclick: () => stepPhotoGap(-2) }, '−');
    const btnGapInc = h('button', { type: 'button', 'data-testid': 'ae-gap-inc', onclick: () => stepPhotoGap(+2) }, '+');
    const gapCard = h('div', { class: 'ae-grid-card' },
      h('span', { class: 'ae-grid-card-title' }, t('gapWidth')),
      h('div', { class: 'te-col-step' }, btnGapDec, gapValSpan, btnGapInc));
    const btnSortNum = h('button', { type: 'button', class: 'ae-sort-pill num', 'data-testid': 'ae-sort-num', onclick: () => smartOrderCards('num') }, '1, 2, 3…');
    const btnSortAlpha = h('button', { type: 'button', class: 'ae-sort-pill alpha', 'data-testid': 'ae-sort-alpha', onclick: () => smartOrderCards('alpha') }, 'a, b, c…');
    const smartCard = h('div', { class: 'ae-grid-card' },
      h('span', { class: 'ae-grid-card-title' }, t('smartOrder')),
      h('div', { class: 'ae-sort-pair' }, btnSortNum, btnSortAlpha));
    const sideCol = h('div', { class: 'ae-grid-side' }, smartCard, gapCard);

    const midStrips = [];
    rebuildMidStrips = () => {
      midStrips.forEach((el) => el.remove());
      midStrips.length = 0;
      const { rows } = getPhotoCards();
      for (let r = 0; r < rows.length - 1; r++) {
        const rowBot = Math.max(...rows[r].items.map((c) => {
          const bBot = c.badgeSec && c.badgeSec.o && !c.badgeSec.o.deleted ? c.badgeSec.o.y + c.badgeSec.o.h : c.p.y + c.p.h;
          return Math.max(c.p.y + c.p.h, bBot);
        }));
        const nextTop = Math.min(...rows[r + 1].items.map((c) => c.p.y));
        const midY = (rowBot + nextTop) * 0.5;
        const strip = h('button', {
          type: 'button', class: 'ae-mid-strip', 'data-testid': `ae-tpl-mid-${r}`,
          style: { top: (Y(midY) - 10) + 'px' },
          onpointerdown: (ev) => ev.stopPropagation(),
          onclick: (ev) => { ev.stopPropagation(); addTemplateCards('mid', r); },
        }, '+ ' + t('addTemplateMid'));
        stage.append(strip);
        midStrips.push(strip);
      }
    };
    rebuildMidStrips();

    photoGridUi = { sideCol, btnTplLeft, btnTplRight, btnTplBottom };
  }
  st.photoGridUi = photoGridUi;
}
