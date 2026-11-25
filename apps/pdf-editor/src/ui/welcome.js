// Opening screen: big centred "PDF Ekle" with drag & drop.
import { h, clear } from './common/dom.js';
import { t, getLang, setLang } from '../i18n/i18n.js';
import { icon } from '../../assets/icons/icons.js';
import { APP_VERSION } from '../core/version.js';

export function renderWelcome(el, { onFile, onResume, hasResume, resumeName = '' }) {
  clear(el);
  const input = document.getElementById('file-input');
  const zone = h('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': t('addPdf') },
    h('div', { class: 'big-icon', html: icon('pdf') }),
    h('button', { class: 'add-btn', id: 'add-pdf', onclick: (e) => { e.stopPropagation(); input.click(); }, html: icon('upload') + `<span>${t('addPdf')}</span>` }),
    h('div', { class: 'hint' }, t('dropHint')));
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  const card = h('div', { class: 'welcome-card' },
    h('div', { class: 'welcome-brand' }, h('img', { src: 'favicon.svg', alt: '' }), t('appName')),
    zone,
    hasResume ? h('div', { class: 'resume' }, h('button', { class: 'btn', 'data-testid': 'resume', onclick: onResume, title: resumeName }, t('resume') + (resumeName ? ` — ${resumeName}` : ''))) : null,
    h('div', { class: 'lang' }, h('button', { onclick: () => setLang('tr'), style: getLang() === 'tr' ? { fontWeight: 700 } : null }, 'Türkçe'), '·',
      h('button', { onclick: () => setLang('en'), style: getLang() === 'en' ? { fontWeight: 700 } : null }, 'English')),
    h('div', { class: 'version', 'data-testid': 'app-version' }, `${t('version')} ${APP_VERSION}`));
  el.append(card);
  // drag & drop anywhere on the welcome screen
  const over = (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); zone.classList.add('drag'); } };
  el.ondragenter = over; el.ondragover = over;
  el.ondragleave = (e) => { if (e.target === el || !el.contains(e.relatedTarget)) zone.classList.remove('drag'); };
  el.ondrop = (e) => {
    e.preventDefault(); zone.classList.remove('drag');
    const f = [...(e.dataTransfer?.files || [])][0];
    if (f) onFile(f);
  };
}
