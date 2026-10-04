// Проекты: список, модальное окно, страница проекта (канбан / список)
import { h, clear, COLORS, PROJECT_STATUS, toInput, fmtDT, fmtDate, plural } from './utils.js';
import { icon, openModal, toast, confirmDialog, field, avatar, emptyState, refreshIcons } from './ui.js';
import { store, user, userName, create, patch, remove, logAct, projectStats, canEditOwn, isAdmin } from './realtime.js';
import { filterBar, applyFilters, kanban, taskTable, openTask } from './tasks.js';

const people = (pid) => {
  const ids = new Set(); store.tasks.filter((t) => t.project_id === pid).forEach((t) => { if (t.assignee_id) ids.add(t.assignee_id); if (t.created_by) ids.add(t.created_by); });
  return [...ids].map((id) => userName(id)).slice(0, 5);
};

export function openProjectModal(id) {
  const p = id ? store.projects.find((x) => x.id === id) : null;
  if (id && !p) return;
  const d = p || { name: '', description: '', client: '', contact_id: null, color: COLORS[0], start_date: null, end_date: null, status: 'active', archived: false };
  const editable = !p || canEditOwn(p);
  let color = d.color;
  const name = h('input', { value: d.name, maxlength: 120, disabled: !editable });
  const desc = h('textarea', { disabled: !editable }); desc.value = d.description || '';
  const client = h('input', { value: d.client || '', maxlength: 120, disabled: !editable });
  const contact = h('select', { disabled: !editable }, h('option', { value: '' }, '— не выбран —'), store.contacts.map((c) => h('option', { value: c.id, selected: c.id === d.contact_id }, c.name)));
  const start = h('input', { type: 'date', value: d.start_date || '', disabled: !editable }), end = h('input', { type: 'date', value: d.end_date || '', disabled: !editable });
  const status = h('select', { disabled: !editable }, Object.entries(PROJECT_STATUS).map(([k, v]) => h('option', { value: k, selected: k === d.status }, v)));
  const sw = h('div', { class: 'swatches' });
  const drawSw = () => { clear(sw).append(COLORS.map((c) => h('button', { type: 'button', class: 'swatch' + (c === color ? ' sel' : ''), style: 'background:' + c, 'aria-label': 'Цвет ' + c, onclick: () => { if (editable) { color = c; drawSw(); } } }))); };
  drawSw();
  const body = h('div', { class: 'form-grid' }, h('div', { class: 'full' }, field('Название', name)), h('div', { class: 'full' }, field('Описание', desc)),
    field('Клиент', client), field('Контакт', contact), field('Начало', start), field('Окончание', end), field('Статус', status), field('Цвет', sw));
  const footer = [];
  if (p && editable) {
    footer.push(h('button', { class: 'btn danger', onclick: async () => {
      if (!(await confirmDialog(`Удалить проект «${p.name}» вместе со всеми задачами?`, 'Удалить'))) return;
      if (await remove('projects', p.id)) { logAct(`удалил проект «${p.name}»`, 'project', null); m.close(); toast('Проект удалён', 'success'); if (location.hash.startsWith('#/project/')) location.hash = '#/projects'; }
    } }, icon('trash-2'), 'Удалить'),
      h('button', { class: 'btn', onclick: async () => { const r = await patch('projects', p.id, { archived: !p.archived }); if (r) { logAct(`${r.archived ? 'архивировал' : 'вернул из архива'} проект «${p.name}»`, 'project', p.id); m.close(); } } }, icon('archive'), p.archived ? 'Из архива' : 'В архив'));
  }
  footer.push(h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'));
  if (editable) footer.push(h('button', { class: 'btn primary', onclick: async (e) => {
    if (!name.value.trim()) { toast('Введите название проекта', 'warning'); name.focus(); return; }
    if (start.value && end.value && end.value < start.value) { toast('Дата окончания раньше начала', 'warning'); return; }
    const v = { name: name.value.trim(), description: desc.value.trim() || null, client: client.value.trim() || null, contact_id: contact.value || null,
      color, start_date: start.value || null, end_date: end.value || null, status: status.value };
    e.target.disabled = true;
    const r = p ? await patch('projects', p.id, v) : await create('projects', { ...v, archived: false, created_by: store.me.id });
    e.target.disabled = false;
    if (r) { logAct(`${p ? 'изменил' : 'создал'} проект «${r.name}»`, 'project', r.id); m.close(); toast('Проект сохранён', 'success'); }
  } }, 'Сохранить'));
  const m = openModal({ title: p ? 'Редактирование проекта' : 'Новый проект', body, footer, wide: true });
}

// ---------- Список проектов ----------
let showArchive = false;
export function render(c) {
  clear(c);
  const grid = h('div', { class: 'cards' });
  const draw = () => {
    clear(grid);
    const list = store.projects.filter((p) => p.archived === showArchive);
    if (!list.length) { grid.append(emptyState('folder-open', showArchive ? 'Архив пуст' : 'Проектов пока нет', 'Нажмите «Создать → Проект»')); refreshIcons(); return; }
    list.forEach((p) => {
      const st = projectStats(p.id);
      const next = store.tasks.filter((t) => t.project_id === p.id && t.status !== 'done' && t.due_at).sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0];
      grid.append(h('div', { class: 'card project-card', dataset: { id: p.id }, style: 'border-top-color:' + p.color, tabindex: 0, role: 'link',
        onclick: () => (location.hash = '#/project/' + p.id), onkeydown: (e) => { if (e.key === 'Enter') location.hash = '#/project/' + p.id; } },
        h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('h3', { style: 'margin:0' }, p.name), h('span', { class: 'badge ' + p.status }, PROJECT_STATUS[p.status])),
        h('div', { class: 'muted small' }, p.client ? 'Клиент: ' + p.client : 'Без клиента'),
        h('div', {}, h('div', { class: 'row small muted', style: 'justify-content:space-between;margin-bottom:4px' }, h('span', {}, `${st.total} ${plural(st.total, 'задача', 'задачи', 'задач')}`), h('span', {}, st.pct + '%')),
          h('div', { class: 'progress' }, h('div', { style: `width:${st.pct}%;background:${p.color}` }))),
        h('div', { class: 'row small muted', style: 'justify-content:space-between' },
          h('span', {}, next ? 'Ближайший дедлайн: ' + fmtDT(next.due_at) : 'Дедлайнов нет'),
          h('span', { class: 'avatars' }, people(p.id).map((n) => avatar(n, 'xs'))))));
    });
  };
  c.append(h('div', { class: 'page-head' }, h('h1', {}, 'Проекты'), h('div', { class: 'grow' }),
    h('button', { class: 'btn', onclick: (e) => { showArchive = !showArchive; e.currentTarget.lastChild.textContent = showArchive ? 'Активные' : 'Архив'; draw(); } }, icon('archive'), showArchive ? 'Активные' : 'Архив'),
    h('button', { class: 'btn primary', onclick: () => openProjectModal(null) }, icon('plus'), 'Новый проект')), grid);
  draw(); refreshIcons();
}
export const update = null;

// ---------- Страница проекта ----------
const pf = { q: '', priority: '', assignee: '', due: '', sort: 'manual' };
let viewMode = localStorage.getItem('homecrm.proj.view') || 'board';
let tableSort = { col: 'due_at', dir: 1 };
let current = null;
export function renderProject(c, pid) {
  const p = store.projects.find((x) => x.id === pid);
  clear(c);
  if (!p) { c.append(emptyState('folder-x', 'Проект не найден', 'Возможно, он был удалён'), h('a', { class: 'btn', href: '#/projects' }, 'К проектам')); refreshIcons(); return; }
  current = pid;
  const head = h('div'), body = h('div');
  const draw = () => {
    const pr = store.projects.find((x) => x.id === pid); if (!pr) { renderProject(c, pid); return; }
    const st = projectStats(pid);
    clear(head).append(h('div', { class: 'card', style: `border-left:4px solid ${pr.color};margin-bottom:16px` },
      h('div', { class: 'row' }, h('a', { class: 'icon-btn', href: '#/projects', title: 'К проектам', 'aria-label': 'Назад' }, icon('arrow-left')),
        h('h1', { style: 'font-size:28px' }, pr.name), h('span', { class: 'badge ' + pr.status }, PROJECT_STATUS[pr.status]), pr.archived ? h('span', { class: 'badge' }, 'В архиве') : null,
        h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: () => openProjectModal(pid) }, icon('pencil'), 'Редактировать'),
        h('button', { class: 'btn primary', onclick: () => openTask(null, { project_id: pid }) }, icon('plus'), 'Задача')),
      pr.description ? h('p', { class: 'muted', style: 'margin:10px 0 0' }, pr.description) : null,
      h('div', { class: 'row small muted', style: 'margin-top:10px' }, pr.client ? h('span', {}, 'Клиент: ' + pr.client) : null,
        pr.end_date ? h('span', {}, 'До: ' + fmtDate(pr.end_date)) : null),
      h('div', { style: 'margin-top:12px' }, h('div', { class: 'row small muted', style: 'justify-content:space-between;margin-bottom:4px' }, h('span', {}, `Выполнено ${st.done} из ${st.total}`), h('span', {}, st.pct + '%')),
        h('div', { class: 'progress' }, h('div', { style: `width:${st.pct}%;background:${pr.color}` })))));
    drawBody();
    refreshIcons();
  };
  const drawBody = () => {
    const tasks = applyFilters(store.tasks.filter((t) => t.project_id === pid), pf);
    if (viewMode === 'board') kanban(body, tasks, { projectId: pid, sort: pf.sort });
    else taskTable(body, tasks, { sortState: tableSort, onSort: (k) => { tableSort = { col: k, dir: tableSort.col === k ? -tableSort.dir : 1 }; drawBody(); } });
  };
  const toggle = h('div', { class: 'row', style: 'gap:0' });
  const drawToggle = () => clear(toggle).append(
    h('button', { class: 'btn' + (viewMode === 'board' ? ' primary' : ''), style: 'border-radius:10px 0 0 10px', onclick: () => { viewMode = 'board'; localStorage.setItem('homecrm.proj.view', viewMode); drawToggle(); drawBody(); } }, icon('columns-3'), 'Доска'),
    h('button', { class: 'btn' + (viewMode === 'list' ? ' primary' : ''), style: 'border-radius:0 10px 10px 0', onclick: () => { viewMode = 'list'; localStorage.setItem('homecrm.proj.view', viewMode); drawToggle(); drawBody(); } }, icon('list'), 'Список'));
  drawToggle();
  const bar = filterBar(pf, drawBody, { sort: true }); bar.append(toggle);
  c.append(head, bar, body); draw();
  c._projectUpdate = () => { if (!c.isConnected) return; const head2 = head; draw(); void head2; };
}
export function updateProject(c) { if (c._projectUpdate) c._projectUpdate(); }
