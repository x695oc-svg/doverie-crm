// UI-компоненты: тосты, модальные окна, аватары, пустые состояния, скелетоны
import { h, initials, colorFor } from './utils.js';

export const icon = (n) => h('i', { 'data-lucide': n });
let iconTimer;
export function refreshIcons() {
  if (!window.lucide) return;
  clearTimeout(iconTimer);
  iconTimer = setTimeout(() => window.lucide.createIcons(), 0);
}

export function toast(msg, type = 'info', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + type, role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

const stack = [];
export function openModal({ title, body, footer, side = false, wide = false, onClose }) {
  const overlay = h('div', { class: 'overlay' + (side ? ' side' : '') });
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const api = {
    el: bodyEl,
    close() {
      const i = stack.indexOf(api);
      if (i < 0) return;
      stack.splice(i, 1); overlay.remove();
      if (onClose) onClose();
    },
  };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : '') + (side ? ' panel' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h3', {}, title),
      h('button', { class: 'icon-btn', title: 'Закрыть (Esc)', 'aria-label': 'Закрыть', onclick: () => api.close() }, icon('x'))),
    bodyEl, footer ? h('div', { class: 'modal-foot' }, footer) : null);
  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) api.close(); });
  document.body.append(overlay);
  stack.push(api);
  refreshIcons();
  if (!side) setTimeout(() => bodyEl.querySelector('input:not([type=checkbox]),textarea,select')?.focus(), 30);
  return api;
}
export const closeTop = () => { if (stack.length) { stack[stack.length - 1].close(); return true; } return false; };
export const hasModal = () => stack.length > 0;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTop(); });

export function confirmDialog(text, okLabel = 'Подтвердить', danger = true) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } m.close(); };
    const m = openModal({
      title: 'Подтверждение', body: h('p', { style: 'margin:0' }, text), onClose: () => { if (!done) { done = true; resolve(false); } },
      footer: [h('button', { class: 'btn', onclick: () => finish(false) }, 'Отмена'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => finish(true) }, okLabel)],
    });
  });
}

export const field = (label, control, cls = '') => h('label', { class: 'field ' + cls }, h('span', {}, label), control);
export function avatar(name, size = '') {
  return h('span', { class: 'avatar ' + size, style: 'background:' + colorFor(name || '?'), title: name || '' }, initials(name));
}
export function emptyState(ic, title, hint) {
  return h('div', { class: 'empty' }, icon(ic), h('b', {}, title), hint ? h('span', {}, hint) : null);
}
export function skeletons(n = 4) {
  return h('div', { class: 'stack' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' })));
}
export function errorBox(msg, retry) {
  return h('div', { class: 'error-box' }, 'Ошибка: ' + msg, retry ? h('button', { class: 'btn sm', style: 'margin-left:12px', onclick: retry }, 'Повторить') : null);
}
export function popover(anchor, content) {
  const p = h('div', { class: 'popover' }, content);
  anchor.parentElement.append(p);
  const r = anchor.getBoundingClientRect();
  p.style.top = anchor.offsetTop + anchor.offsetHeight + 6 + 'px';
  if (r.left + 300 > innerWidth) p.style.right = '0'; else p.style.left = '0';
  const off = (e) => { if (!p.contains(e.target) && !anchor.contains(e.target)) close(); };
  const close = () => { p.remove(); document.removeEventListener('mousedown', off); };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
  refreshIcons();
  return { close, el: p };
}
