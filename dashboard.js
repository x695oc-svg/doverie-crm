// Дашборд: счётчики, дедлайны, прогресс проектов, активность, мини-календарь
import { h, clear, relTime, fmtDT, startOfDay, addDays, sameDay, isOverdue, isToday, toCSV, download } from './utils.js';
import { icon, avatar, emptyState, refreshIcons, toast } from './ui.js';
import { store, project, userName, projectStats } from './realtime.js';
import { openTask } from './tasks.js';
import { openEventModal } from './calendar.js';

function stat(ic, label, n, cls) {
  return h('div', { class: 'card stat ' + cls, onclick: () => (location.hash = '#/tasks'), role: 'link', tabindex: 0 },
    h('div', { class: 'ic' }, icon(ic)), h('div', {}, h('b', {}, n), h('span', { class: 'muted' }, label)));
}
function exportData(kind) {
  const ds = { projects: store.projects, tasks: store.tasks, subtasks: store.subtasks, comments: store.comments, events: store.events, contacts: store.contacts, interactions: store.interactions };
  if (kind === 'json') download(`home-crm-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(ds, null, 2), 'application/json');
  else for (const [k, rows] of Object.entries(ds)) if (rows.length) download(`home-crm-${k}.csv`, toCSV(rows), 'text/csv');
  toast('Экспорт выполнен', 'success');
}

export function render(c) {
  clear(c);
  const now = new Date(), open = store.tasks.filter((t) => t.status !== 'done'), weekAgo = Date.now() - 7 * 864e5;
  const today = open.filter((t) => isToday(t.due_at)).length, over = open.filter(isOverdue).length;
  const prog = store.tasks.filter((t) => t.status === 'in_progress').length;
  const doneW = store.tasks.filter((t) => t.status === 'done' && t.completed_at && new Date(t.completed_at) > weekAgo).length;

  const soon = open.filter((t) => t.due_at && new Date(t.due_at) <= addDays(now, 7)).sort((a, b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 8);
  const projects = store.projects.filter((p) => !p.archived && p.status !== 'done');
  const acts = store.activity.filter((a) => a.entity_type !== 'user' || true).slice(0, 10);

  const monday = startOfDay(addDays(now, -((now.getDay() + 6) % 7)));
  const week = h('div', { class: 'week' }, Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i);
    const items = [
      ...store.events.filter((e) => sameDay(new Date(e.starts_at), day)).map((e) => ({ t: e.title, col: project(e.project_id)?.color || '#6d7cff', f: () => openEventModal(e.id) })),
      ...store.tasks.filter((t) => t.due_at && sameDay(new Date(t.due_at), day) && t.status !== 'done').map((t) => ({ t: '✓ ' + t.title, col: project(t.project_id)?.color || '#8b93a3', f: () => openTask(t.id) })),
    ];
    return h('div', { class: 'day' + (sameDay(day, now) ? ' today' : '') }, h('h4', {}, day.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' })),
      items.slice(0, 4).map((it) => h('span', { class: 'chip', style: 'border-left-color:' + it.col, onclick: it.f, title: it.t }, it.t)),
      items.length > 4 ? h('span', { class: 'small muted' }, `+ ещё ${items.length - 4}`) : null);
  }));

  c.append(
    h('div', { class: 'page-head' }, h('h1', {}, `Привет, ${store.me.display_name}`), h('div', { class: 'grow' }),
      h('button', { class: 'btn sm', onclick: () => exportData('json') }, icon('download'), 'Бэкап JSON'), h('button', { class: 'btn sm', onclick: () => exportData('csv') }, icon('file-spreadsheet'), 'Экспорт CSV')),
    h('div', { class: 'stat-grid' }, stat('calendar-check', 'Сегодня', today, ''), stat('alert-triangle', 'Просрочено', over, 'danger'), stat('loader', 'В процессе', prog, 'warn'), stat('check-circle-2', 'Завершено за неделю', doneW, 'ok')),
    h('div', { class: 'dash-grid' },
      h('div', { class: 'card' }, h('h3', {}, 'Ближайшие дедлайны (7 дней)'),
        soon.length ? soon.map((t) => h('div', { class: 'list-item', dataset: { id: t.id }, onclick: () => openTask(t.id) },
          h('span', { class: 'dot', style: 'background:' + (project(t.project_id)?.color || '#8b93a3') }), h('span', { class: 'grow' }, t.title),
          h('span', { class: 'small due ' + (isOverdue(t) ? 'over' : isToday(t.due_at) ? 'today' : '') }, fmtDT(t.due_at)))) : emptyState('calendar-check', 'Дедлайнов нет', 'На ближайшую неделю всё спокойно')),
      h('div', { class: 'card' }, h('h3', {}, 'Прогресс проектов'),
        projects.length ? projects.map((p) => { const s = projectStats(p.id); return h('div', { style: 'margin-bottom:14px;cursor:pointer', dataset: { id: p.id }, onclick: () => (location.hash = '#/project/' + p.id) },
          h('div', { class: 'row small', style: 'justify-content:space-between;margin-bottom:4px' }, h('span', {}, p.name), h('span', { class: 'muted' }, `${s.done}/${s.total} · ${s.pct}%`)),
          h('div', { class: 'progress' }, h('div', { style: `width:${s.pct}%;background:${p.color}` }))); }) : emptyState('folder-open', 'Нет активных проектов', 'Создайте первый проект')),
      h('div', { class: 'card' }, h('h3', {}, 'Последние действия'),
        acts.length ? acts.map((a) => h('div', { class: 'list-item', style: 'cursor:default', dataset: { id: a.id } }, avatar(userName(a.actor_id), 'xs'),
          h('span', { class: 'grow small' }, h('b', {}, userName(a.actor_id)), ' ' + a.message + ', ', h('span', { class: 'muted' }, relTime(a.created_at))))) : emptyState('activity', 'Пока тихо', 'Здесь будут действия команды')),
      h('div', { class: 'card span2', style: 'grid-column:1/-1' }, h('h3', {}, 'Неделя'), week)));
  refreshIcons();
}
export const update = null;
