import tr from './tr.js';
import en from './en.js';

const dicts = { tr, en };
let lang = (() => { try { return localStorage.getItem('pdfflow.lang') || 'tr'; } catch (e) { return 'tr'; } })();
const listeners = new Set();

export function t(key) { return (dicts[lang] && dicts[lang][key]) ?? tr[key] ?? key; }
export function getLang() { return lang; }
export function setLang(l) {
  if (!dicts[l]) return;
  lang = l;
  try { localStorage.setItem('pdfflow.lang', l); } catch (e) { /* ignore */ }
  document.documentElement.lang = l;
  listeners.forEach((fn) => fn(l));
}
export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }
