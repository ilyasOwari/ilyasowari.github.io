import { h } from './dom.js';
let host;
// ms = 0: stays until the returned close() is called (progress messages)
export function toast(msg, { error = false, ms = 2600 } = {}) {
  if (!host) { host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const el = h('div', { class: 'toast' + (error ? ' error' : '') }, msg);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let done = false;
  const close = () => { if (done) return; done = true; el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  if (ms > 0 || error) setTimeout(close, error ? Math.max(ms, 4500) : ms);
  return close;
}
