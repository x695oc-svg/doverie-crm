// Глобальный поиск (Ctrl+K) по задачам, проектам и контактам
import { h, clear, STATUS, debounce } from './utils.js';
import { icon, openModal, emptyState, refreshIcons } from './ui.js';
import { store, project } from './realtime.js';
import { openTask } from './tasks.js';
import { select as selectContact } from './contacts.js';

export function openSearch() {
  const input = h('input', { placeholder: 'Начните вводить: задача, проект или контакт…', 'aria-label': 'Глобальный поиск', autocomplete: 'off' });
  const out = h('div', { style: 'margin-top:12px;max-height:55vh;overflow:auto' });
  let first = null;
  const row = (ic, title, sub, fn) => h('div', { class: 'list-item', tabindex: 0, onclick: () => { m.close(); fn(); }, onkeydown: (e) => { if (e.key === 'Enter') { m.close(); fn(); } } },
    icon(ic), h('div', { class: 'grow' }, h('div', {}, title), sub ? h('div', { class: 'small muted' }, sub) : null));
  const run = () => {
    const s = input.value.trim().toLowerCase(); clear(out); first = null;
    if (!s) { out.append(h('div', { class: 'muted small' }, 'Введите хотя бы один символ')); return; }
    const has = (...v) => v.some((x) => (x || '').toLowerCase().includes(s));
    const tasks = store.tasks.filter((t) => has(t.title, t.description)).slice(0, 8);
    const projs = store.projects.filter((p) => has(p.name, p.client, p.description)).slice(0, 5);
    const cons = store.contacts.filter((c) => has(c.name, c.company, c.phone, c.email)).slice(0, 5);
    const section = (t, items) => items.length ? [h('h4', { class: 'muted small', style: 'margin:10px 0 4px' }, t), ...items] : [];
    const tr = tasks.map((t) => row('check-square', t.title, `${STATUS[t.status]}${project(t.project_id) ? ' · ' + project(t.project_id).name : ''}`, () => openTask(t.id)));
    const pr = projs.map((p) => row('folder', p.name, p.client || '', () => (location.hash = '#/project/' + p.id)));
    const cr = cons.map((c) => row('user', c.name, c.company || c.email || c.phone || '', () => { selectContact(c.id); location.hash = '#/contacts'; window.dispatchEvent(new HashChangeEvent('hashchange')); }));
    const all = [...section('Задачи', tr), ...section('Проекты', pr), ...section('Контакты', cr)];
    if (!all.length) out.append(emptyState('search-x', 'Ничего не найдено', 'Попробуйте другой запрос')); else out.append(all);
    first = tr[0] || pr[0] || cr[0]; refreshIcons();
  };
  input.addEventListener('input', debounce(run, 120));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && first) first.click(); });
  const m = openModal({ title: 'Поиск', body: [input, out] });
  run();
}
