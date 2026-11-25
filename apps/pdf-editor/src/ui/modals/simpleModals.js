// Password prompt, settings and "Metin ekle" dialogs.
import { getScanPrefs, setScanPrefs } from '../../engines/ocr/paddle.js';
import { APP_VERSION } from '../../core/version.js';
import { h } from '../common/dom.js';
import { t, getLang, setLang } from '../../i18n/i18n.js';
import { openModal } from '../common/modal.js';

export function askPassword(wrong) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'password', autocomplete: 'off', 'data-testid': 'pw-input' });
    const err = h('div', { class: 'err' }, wrong ? t('passwordWrong') : '');
    const ok = h('button', { class: 'btn primary', 'data-testid': 'pw-ok' }, t('ok'));
    const body = h('div', { class: 'modal-body', style: { width: '360px' } }, h('div', { class: 'field' }, h('label', {}, t('passwordLabel')), inp), err);
    const foot = h('div', { class: 'modal-foot' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: () => m.close(null) }, t('cancel')), ok);
    let done = false;
    const m = openModal({ title: t('passwordTitle'), body, foot, onClose: (v) => { if (!done) resolve(null); void v; } });
    const submit = () => { done = true; m.close(); resolve(inp.value); };
    ok.onclick = submit;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => inp.focus(), 30);
  });
}

export function openSettings(app) {
  const sel = h('select', {}, h('option', { value: 'tr' }, 'Türkçe'), h('option', { value: 'en' }, 'English'));
  sel.value = getLang();
  const auto = h('input', { type: 'checkbox' });
  auto.checked = app.autosaveEnabled();
  const body = h('div', { class: 'modal-body', style: { width: '380px' } },
    h('div', { class: 'field' }, h('label', {}, t('language')), sel),
    h('label', { class: 'switch', style: { marginTop: '10px' } }, auto, t('autosave')),
    h('div', { class: 'version', style: { marginTop: '14px' } }, `${t('version')} ${APP_VERSION}`));
  const ok = h('button', { class: 'btn primary' }, t('ok'));
  const foot = h('div', { class: 'modal-foot' }, h('div', { class: 'grow' }), ok);
  const m = openModal({ title: t('settingsTitle'), body, foot, closeOnBackdrop: true });
  ok.onclick = () => { m.close(); app.setAutosave(auto.checked); if (sel.value !== getLang()) setLang(sel.value); };
}

// "Sayfayı tara": Hızlı (PaddleOCR) / Kaliteli (Tesseract + PaddleOCR vote)
// and the background cleanup switch. Resolves { mode, cleanBg } or null.
export function openScanDialog({ scanned = true } = {}) {
  return new Promise((resolve) => {
    const pref = getScanPrefs();
    const opt = (value, label, desc) => {
      const r = h('input', { type: 'radio', name: 'scanmode', value, 'data-testid': 'scan-' + value });
      r.checked = pref.mode === value;
      return h('label', { class: 'scan-opt' }, r, h('span', {}, h('strong', {}, label), h('small', {}, desc)));
    };
    const fast = opt('fast', t('scanFast'), t('scanFastDesc')), qual = opt('quality', t('scanQuality'), t('scanQualityDesc'));
    const clean = h('input', { type: 'checkbox', 'data-testid': 'scan-clean' });
    clean.checked = scanned && pref.cleanBg; clean.disabled = !scanned;
    const body = h('div', { class: 'modal-body scan-dialog', style: { width: '420px' } }, qual, fast,
      h('label', { class: 'switch', style: { marginTop: '12px' } }, clean, t('scanCleanBg')));
    const ok = h('button', { class: 'btn primary', 'data-testid': 'scan-ok' }, t('scanStart'));
    const foot = h('div', { class: 'modal-foot' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: () => m.close() }, t('cancel')), ok);
    let done = false;
    const m = openModal({ title: t('scanModeTitle'), body, foot, closeOnBackdrop: true, onClose: () => { if (!done) resolve(null); } });
    ok.onclick = () => {
      const mode = body.querySelector('input[name=scanmode]:checked')?.value || 'quality';
      const res = { mode, cleanBg: clean.checked && scanned };
      if (scanned) setScanPrefs(res); else setScanPrefs({ ...pref, mode });
      done = true; m.close(); resolve(res);
    };
    setTimeout(() => ok.focus(), 30);
  });
}

export function openInsertText(fonts, onOk, init = null) {
  const ta = h('textarea', { rows: '4', style: { width: '100%', font: '15px/1.4 inherit', padding: '8px', border: '1px solid var(--line-2)', borderRadius: '7px', resize: 'vertical' }, 'data-testid': 'ins-text' });
  const size = h('input', { type: 'number', min: '5', max: '96', value: '12' });
  const font = h('select', {}, fonts.map((f) => h('option', { value: f.file }, f.label)));
  const color = h('input', { type: 'color', value: '#1d2433', style: { height: '34px', width: '60px' } });
  const body = h('div', { class: 'modal-body', style: { width: '460px' } },
    h('div', { class: 'field' }, h('label', {}, t('textLabel')), ta),
    h('div', { style: { display: 'flex', gap: '10px' } },
      h('div', { class: 'field', style: { flex: 1 } }, h('label', {}, t('fontLabel')), font),
      h('div', { class: 'field', style: { width: '90px' } }, h('label', {}, t('sizeLabel')), size),
      h('div', { class: 'field' }, h('label', {}, t('colorLabel')), color)));
  const ok = h('button', { class: 'btn primary', 'data-testid': 'ins-ok' }, t('ok'));
  const foot = h('div', { class: 'modal-foot' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: () => m.close() }, t('cancel')), ok);
  const m = openModal({ title: t('insertTextTitle'), body, foot });
  ok.onclick = () => {
    const text = ta.value.replace(/\r/g, '').replace(/\s+$/, '');
    if (!text) { m.close(); return; }
    const hex = color.value.slice(1);
    m.close();
    onOk({ text, size: Math.max(5, Math.min(96, +size.value || 12)), font: font.value, color: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) });
  };
  if (init) {
    ta.value = init.lines.join('\n'); size.value = String(init.size); font.value = init.font;
    color.value = '#' + (init.color || [0, 0, 0]).map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  setTimeout(() => ta.focus(), 30);
}

export function askNextPageSpace() {
  return new Promise((resolve) => {
    let res = null;
    const done = (v) => { res = v; m.close(); resolve(v); };
    const body = h('div', { class: 'modal-body', style: { width: '430px' } }, h('p', { style: { margin: '0', lineHeight: '1.45', color: 'var(--ink-2)' } }, t('noSpaceNextBody')));
    const bCancel = h('button', { class: 'btn', 'data-testid': 'np-cancel', onclick: () => done(null) }, t('cancel'));
    const bShift = h('button', { class: 'btn', 'data-testid': 'np-shift', onclick: () => done('shift') }, t('shiftNextPage'));
    const bBlank = h('button', { class: 'btn primary', 'data-testid': 'np-blank', onclick: () => done('blank') }, t('moveBlankPage'));
    const foot = h('div', { class: 'modal-foot' }, bCancel, h('div', { class: 'grow' }), bShift, bBlank);
    const m = openModal({ title: t('noSpaceNextTitle'), body, foot, onClose: () => { if (res === null) resolve(null); } });
  });
}

export function askRemoveOldPageNums() {
  return new Promise((resolve) => {
    let res = null;
    const done = (v) => { res = v; m.close(); resolve(v); };
    const body = h('div', { class: 'modal-body', style: { width: '400px' } }, h('p', { style: { margin: '0', lineHeight: '1.45', color: 'var(--ink-2)' } }, t('oldPageNumsAsk')));
    const bKeep = h('button', { class: 'btn', 'data-testid': 'oldpn-keep', onclick: () => done(false) }, t('keepOld'));
    const bDel = h('button', { class: 'btn primary', 'data-testid': 'oldpn-del', onclick: () => done(true) }, t('del'));
    const foot = h('div', { class: 'modal-foot' }, h('div', { class: 'grow' }), bKeep, bDel);
    const m = openModal({ title: t('pageNums'), body, foot, onClose: () => { if (res === null) resolve(false); } });
    setTimeout(() => bDel.focus(), 20);
  });
}
