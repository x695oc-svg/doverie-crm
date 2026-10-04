// Задачи: карточка, канбан, таблица, боковая панель, страница «Задачи»
import { h, clear, STATUS, PRIORITY, PRIO_W, fmtDT, relTime, isOverdue, isToday, toInput, fromInput, debounce, plural } from './utils.js';
import { icon, openModal, toast, confirmDialog, field, avatar, emptyState, refreshIcons } from './ui.js';
import { store, bus, user, userName, project, approvedUsers, create, patch, remove, logAct, canEditTask, isAdmin } from './realtime.js';

const FIELD_LABEL = { title: 'название', description: 'описание', project_id: 'проект', priority: 'приоритет', importance: 'важность', due_at: 'дедлайн', assignee_id: 'исполнителя' };

// ---------- Операции ----------
export async function updateTask(id, changes) {
  const t = store.tasks.find((x) => x.id === id); if (!t) return null;
  const local = {}; const me = store.me.id, now = new Date().toISOString();
  // Оптимистичное повторение логики триггера БД (реальные значения придут с сервера)
  if (changes.status && changes.status !== t.status) {
    if (changes.status === 'in_progress') Object.assign(local, { started_by: me, started_at: now, completed_by: null, completed_at: null });
    else if (changes.status === 'done') Object.assign(local, { completed_by: me, completed_at: now, ...(t.started_at ? {} : { started_by: me, started_at: now }) });
    else Object.assign(local, { started_by: null, started_at: null, completed_by: null, completed_at: null });
  }
  const title = t.title;
  const res = await patch('tasks', id, changes, { ...local, updated_by: me });
  if (!res) return null;
  if (changes.status && changes.status !== t.status) logAct(`перевёл задачу «${title}» в «${STATUS[changes.status]}»`, 'task', id);
  const other = Object.keys(changes).filter((k) => FIELD_LABEL[k]).map((k) => FIELD_LABEL[k]);
  if (other.length) logAct(`изменил задачу «${res.title}»: ${other.join(', ')}`, 'task', id);
  return res;
}
export async function createTask(data) {
  const sameCol = store.tasks.filter((t) => t.project_id === data.project_id && t.status === (data.status || 'todo'));
  const position = sameCol.reduce((m, t) => Math.max(m, t.position), 0) + 1000;
  const row = await create('tasks', { status: 'todo', priority: 'medium', importance: 3, ...data, position, created_by: store.me.id });
  if (row) logAct(`создал задачу «${row.title}»`, 'task', row.id);
  return row;
}
export async function deleteTask(id) {
  const t = store.tasks.find((x) => x.id === id); if (!t) return false;
  if (!(await confirmDialog(`Удалить задачу «${t.title}»? Подзадачи и комментарии тоже будут удалены.`, 'Удалить'))) return false;
  const ok = await remove('tasks', id);
  if (ok) { logAct(`удалил задачу «${t.title}»`, 'task', null); toast('Задача удалена', 'success'); }
  return ok;
}

// ---------- Фильтры и сортировка ----------
const val = {
  title: (t) => t.title.toLowerCase(), project: (t) => project(t.project_id)?.name.toLowerCase() || '~',
  status: (t) => ['todo', 'in_progress', 'done'].indexOf(t.status), priority: (t) => PRIO_W[t.priority],
  importance: (t) => t.importance, due_at: (t) => (t.due_at ? new Date(t.due_at).getTime() : Infinity),
  assignee: (t) => userName(t.assignee_id).toLowerCase(), created_by: (t) => userName(t.created_by).toLowerCase(),
};
export function sortTasks(list, key, dir = 1) {
  const a = [...list];
  const by = (f, d) => a.sort((x, y) => (f(x) > f(y) ? 1 : f(x) < f(y) ? -1 : 0) * d);
  if (key === 'manual') return by((t) => t.position, 1);
  if (key === 'urgency') return by(val.due_at, 1);
  if (key === 'importance') return by(val.importance, -1);
  if (key === 'prio') return by(val.priority, -1);
  if (key === 'created') return by((t) => t.created_at, -1);
  return by(val[key] || val.title, dir);
}
export function applyFilters(list, f) {
  const q = (f.q || '').trim().toLowerCase(), now = new Date(), week = new Date(Date.now() + 7 * 864e5);
  return list.filter((t) => {
    if (q && !(t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))) return false;
    if (f.project && t.project_id !== f.project) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.assignee === 'none' ? t.assignee_id : f.assignee && t.assignee_id !== f.assignee) return false;
    if (f.due === 'overdue' && !isOverdue(t)) return false;
    if (f.due === 'today' && !(t.due_at && isToday(t.due_at))) return false;
    if (f.due === 'week' && !(t.due_at && new Date(t.due_at) >= now && new Date(t.due_at) <= week)) return false;
    if (f.due === 'none' && t.due_at) return false;
    return true;
  });
}
const opt = (v, l, sel) => h('option', { value: v, selected: sel }, l);
function select(key, state, options, onChange, minw) {
  const s = h('select', { 'aria-label': key, style: minw ? `min-width:${minw}px` : '', onchange: () => { state[key] = s.value; onChange(); } },
    options.map(([v, l]) => opt(v, l, (state[key] || '') === v)));
  return s;
}
export function filterBar(state, onChange, o = {}) {
  const people = [['', 'Все исполнители'], ['none', 'Без исполнителя'], ...approvedUsers().map((u) => [u.id, u.display_name])];
  const bar = h('div', { class: 'toolbar' },
    h('input', { class: 'search', placeholder: 'Поиск по задачам…', value: state.q || '', 'aria-label': 'Поиск', oninput: debounce((e) => { state.q = e.target.value; onChange(); }, 150) }),
    o.project ? select('project', state, [['', 'Все проекты'], ...store.projects.filter((p) => !p.archived).map((p) => [p.id, p.name])], onChange) : null,
    o.status ? select('status', state, [['', 'Все статусы'], ...Object.entries(STATUS)], onChange) : null,
    select('priority', state, [['', 'Любой приоритет'], ...Object.entries(PRIORITY)], onChange),
    select('assignee', state, people, onChange),
    select('due', state, [['', 'Любой дедлайн'], ['overdue', 'Просрочено'], ['today', 'Сегодня'], ['week', 'Ближайшие 7 дней'], ['none', 'Без дедлайна']], onChange),
    o.sort ? select('sort', state, [['manual', 'Сортировка: вручную'], ['urgency', 'По срочности'], ['importance', 'По важности'], ['prio', 'По приоритету'], ['created', 'По дате создания']], onChange) : null);
  return bar;
}

// ---------- Карточка на доске ----------
export function taskCard(t) {
  const subs = store.subtasks.filter((s) => s.task_id === t.id), cm = store.comments.filter((c) => c.task_id === t.id).length;
  const dueCls = isOverdue(t) ? 'over' : t.status !== 'done' && isToday(t.due_at) ? 'today' : '';
  const p = project(t.project_id);
  return h('div', { class: 'task-card' + (canEditTask(t) ? '' : ' readonly'), dataset: { id: t.id }, tabindex: 0, role: 'button', onclick: () => openTask(t.id),
    onkeydown: (e) => { if (e.key === 'Enter') openTask(t.id); } },
    h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap;align-items:flex-start' },
      h('div', { class: 'title' }, t.title), h('span', { class: 'badge ' + t.priority }, PRIORITY[t.priority])),
    h('div', { class: 'meta' }, h('span', { class: 'stars', title: 'Важность ' + t.importance }, '★'.repeat(t.importance) + '☆'.repeat(5 - t.importance)),
      t.due_at ? h('span', { class: 'due ' + dueCls }, icon('clock'), ' ', fmtDT(t.due_at)) : null,
      p ? h('span', { class: 'row', style: 'gap:4px' }, h('span', { class: 'dot', style: 'background:' + p.color }), p.name) : null),
    h('div', { class: 'meta' },
      t.assignee_id ? avatar(userName(t.assignee_id), 'xs') : null, h('span', {}, 'создал: ' + userName(t.created_by))),
    t.status === 'in_progress' && t.started_at ? h('div', { class: 'meta' }, `взял в работу: ${userName(t.started_by)}, ${relTime(t.started_at)}`) : null,
    t.status === 'done' && t.completed_at ? h('div', { class: 'meta' }, `завершил: ${userName(t.completed_by)}, ${relTime(t.completed_at)}`) : null,
    h('div', { class: 'meta' }, subs.length ? h('span', {}, '☑ ' + subs.filter((s) => s.done).length + '/' + subs.length) : null,
      cm ? h('span', {}, '💬 ' + cm) : null));
}

// ---------- Канбан (SortableJS) ----------
export function kanban(container, tasks, { projectId = null, sort = 'manual' } = {}) {
  clear(container);
  const board = h('div', { class: 'kanban' });
  for (const [st, label] of Object.entries(STATUS)) {
    const list = sortTasks(tasks.filter((t) => t.status === st), sort);
    const body = h('div', { class: 'col-body', dataset: { status: st } }, list.length ? list.map(taskCard) : null);
    board.append(h('div', { class: 'col' },
      h('div', { class: 'col-head' }, h('span', {}, label), h('span', { class: 'count' }, list.length)), body,
      h('button', { class: 'btn ghost sm', style: 'margin-top:10px', onclick: () => openTask(null, { status: st, project_id: projectId }) }, icon('plus'), 'Добавить')));
    if (window.Sortable) {
      window.Sortable.create(body, {
        group: 'tasks', animation: 160, ghostClass: 'sortable-ghost', filter: '.readonly', preventOnFilter: false, delay: 120, delayOnTouchOnly: true,
        onEnd: (evt) => {
          const id = evt.item.dataset.id, to = evt.to;
          const ids = [...to.children].map((c) => c.dataset.id).filter(Boolean), i = ids.indexOf(id);
          const pos = (x) => store.tasks.find((t) => t.id === x)?.position;
          const prev = i > 0 ? pos(ids[i - 1]) : null, next = i < ids.length - 1 ? pos(ids[i + 1]) : null;
          const position = prev != null && next != null ? (prev + next) / 2 : prev != null ? prev + 1000 : next != null ? next - 1000 : 1000;
          const t = store.tasks.find((x) => x.id === id);
          const ch = { position }; if (t && t.status !== to.dataset.status) ch.status = to.dataset.status;
          updateTask(id, ch);
        },
      });
    }
  }
  container.append(board);
  refreshIcons();
}

// ---------- Таблица ----------
const COLS = [['title', 'Название'], ['project', 'Проект'], ['status', 'Статус'], ['priority', 'Приоритет'], ['importance', 'Важность'], ['due_at', 'Дедлайн'], ['assignee', 'Исполнитель'], ['created_by', 'Создал']];
export function taskTable(container, tasks, { sortState, onSort, bulk = false }) {
  clear(container);
  if (!tasks.length) { container.append(emptyState('list-checks', 'Задач нет', 'Измените фильтры или создайте задачу клавишей N')); refreshIcons(); return; }
  const rows = sortTasks(tasks, sortState.col, sortState.dir);
  const sel = new Set();
  const bar = h('div', { class: 'bulk', hidden: true });
  const upd = () => {
    clear(bar); bar.hidden = sel.size === 0; if (!sel.size) return;
    const st = h('select', {}, opt('', 'Сменить статус…'), Object.entries(STATUS).map(([k, v]) => opt(k, v)));
    const as = h('select', {}, opt('', 'Сменить исполнителя…'), opt('none', 'Без исполнителя'), approvedUsers().map((u) => opt(u.id, u.display_name)));
    st.onchange = async () => { if (st.value) { for (const id of sel) await updateTask(id, { status: st.value }); sel.clear(); toast('Статус обновлён', 'success'); draw(); } };
    as.onchange = async () => { if (as.value) { for (const id of sel) await updateTask(id, { assignee_id: as.value === 'none' ? null : as.value }); sel.clear(); toast('Исполнитель обновлён', 'success'); draw(); } };
    bar.append(h('b', {}, `Выбрано: ${sel.size}`), st, as,
      h('button', { class: 'btn danger sm', onclick: async () => {
        if (!(await confirmDialog(`Удалить ${sel.size} ${plural(sel.size, 'задачу', 'задачи', 'задач')}?`, 'Удалить'))) return;
        for (const id of [...sel]) { const t = store.tasks.find((x) => x.id === id); if (await remove('tasks', id)) logAct(`удалил задачу «${t?.title}»`, 'task', null); }
        sel.clear(); toast('Удалено', 'success'); draw();
      } }, icon('trash-2'), 'Удалить'));
    refreshIcons();
  };
  const wrap = h('div', { class: 'table-wrap' });
  const draw = () => {
    upd();
    const all = h('input', { type: 'checkbox', 'aria-label': 'Выбрать все', onchange: (e) => { rows.forEach((t) => (e.target.checked ? sel.add(t.id) : sel.delete(t.id))); draw(); } });
    all.checked = rows.length > 0 && rows.every((t) => sel.has(t.id));
    clear(wrap).append(h('table', {},
      h('thead', {}, h('tr', {}, bulk ? h('th', { style: 'width:40px' }, all) : null,
        COLS.map(([k, l]) => h('th', { class: 'sortable', onclick: () => onSort(k) }, l + (sortState.col === k ? (sortState.dir > 0 ? ' ▲' : ' ▼') : ''))))),
      h('tbody', {}, rows.map((t) => {
        const p = project(t.project_id), dueCls = isOverdue(t) ? 'over' : t.status !== 'done' && isToday(t.due_at) ? 'today' : '';
        const cb = h('input', { type: 'checkbox', 'aria-label': 'Выбрать', onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? sel.add(t.id) : sel.delete(t.id); upd(); } });
        cb.checked = sel.has(t.id);
        return h('tr', { class: 'clickable', dataset: { id: t.id }, onclick: () => openTask(t.id) },
          bulk ? h('td', {}, cb) : null,
          h('td', { class: 'wrap' }, t.title),
          h('td', {}, p ? h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('span', { class: 'dot', style: 'background:' + p.color }), p.name) : '—'),
          h('td', {}, h('span', { class: 'badge ' + (t.status === 'todo' ? '' : t.status) }, STATUS[t.status])),
          h('td', {}, h('span', { class: 'badge ' + t.priority }, PRIORITY[t.priority])),
          h('td', {}, h('span', { class: 'stars' }, '★'.repeat(t.importance))),
          h('td', {}, h('span', { class: 'due ' + dueCls }, t.due_at ? fmtDT(t.due_at) : '—')),
          h('td', {}, t.assignee_id ? h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, avatar(userName(t.assignee_id), 'xs'), userName(t.assignee_id)) : '—'),
          h('td', {}, userName(t.created_by)));
      }))));
    refreshIcons();
  };
  container.append(bar, wrap); draw();
}

// ---------- Боковая панель задачи ----------
export function openTask(id, defaults = {}) {
  const t = id ? store.tasks.find((x) => x.id === id) : null;
  if (id && !t) { toast('Задача не найдена', 'warning'); return; }
  const isNew = !t, ro = !isNew && !canEditTask(t);
  const d = isNew ? { title: '', description: '', project_id: null, status: 'todo', priority: 'medium', importance: 3, due_at: null, assignee_id: store.me.id, ...defaults } : t;
  const c = {
    title: h('input', { value: d.title, maxlength: 200, placeholder: 'Название задачи', disabled: ro, 'aria-label': 'Название' }),
    description: h('textarea', { placeholder: 'Описание', disabled: ro }),
    project: h('select', { disabled: ro }, opt('', 'Без проекта'), store.projects.filter((p) => !p.archived || p.id === d.project_id).map((p) => opt(p.id, p.name))),
    status: h('select', { disabled: ro }, Object.entries(STATUS).map(([k, v]) => opt(k, v))),
    priority: h('select', { disabled: ro }, Object.entries(PRIORITY).map(([k, v]) => opt(k, v))),
    importance: h('select', { disabled: ro }, [1, 2, 3, 4, 5].map((n) => opt(String(n), '★'.repeat(n) + ' (' + n + ')'))),
    due: h('input', { type: 'datetime-local', disabled: ro }),
    assignee: h('select', { disabled: ro }, opt('', 'Не назначен'), approvedUsers().map((u) => opt(u.id, u.display_name))),
  };
  const setVals = (x, force) => {
    const set = (el, v) => { if (force || document.activeElement !== el) el.value = v ?? ''; };
    set(c.title, x.title); set(c.description, x.description); set(c.project, x.project_id); set(c.status, x.status); set(c.priority, x.priority);
    set(c.importance, String(x.importance)); set(c.due, toInput(x.due_at)); set(c.assignee, x.assignee_id);
  };
  setVals(d, true);
  const collect = () => ({
    title: c.title.value.trim(), description: c.description.value.trim() || null, project_id: c.project.value || null, status: c.status.value,
    priority: c.priority.value, importance: +c.importance.value, due_at: fromInput(c.due.value), assignee_id: c.assignee.value || null,
  });
  const meta = h('div', { class: 'small muted', style: 'margin:12px 0' });
  const subBox = h('div'), cmBox = h('div'), histBox = h('div'), detail = h('div'), tabs = h('div', { class: 'tabs' });

  const drawMeta = () => {
    const x = store.tasks.find((y) => y.id === id); if (!x) return;
    clear(meta).append(h('div', {}, `Создал: ${userName(x.created_by)}, ${fmtDT(x.created_at)}`),
      x.started_at ? h('div', {}, `Взял в работу: ${userName(x.started_by)}, ${fmtDT(x.started_at)}`) : null,
      x.completed_at ? h('div', {}, `Завершил: ${userName(x.completed_by)}, ${fmtDT(x.completed_at)}`) : null);
  };
  const drawSubs = () => {
    const subs = store.subtasks.filter((s) => s.task_id === id).sort((a, b) => a.position - b.position);
    const done = subs.filter((s) => s.done).length;
    const input = h('input', { placeholder: 'Новая подзадача — Enter', disabled: ro, maxlength: 200, onkeydown: async (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return; e.preventDefault();
      const title = input.value.trim(); input.value = '';
      await create('subtasks', { task_id: id, title, done: false, position: subs.reduce((m, s) => Math.max(m, s.position), 0) + 1000, created_by: store.me.id });
    } });
    clear(subBox).append(h('h4', { style: 'margin:18px 0 8px' }, `Подзадачи ${subs.length ? done + '/' + subs.length : ''}`),
      subs.length ? h('div', { class: 'progress', style: 'margin-bottom:8px' }, h('div', { style: `width:${done / subs.length * 100}%` })) : null,
      subs.map((s) => {
        const cb = h('input', { type: 'checkbox', disabled: ro, 'aria-label': s.title, onchange: () => patch('subtasks', s.id, { done: cb.checked }) }); cb.checked = s.done;
        return h('div', { class: 'sub-item' + (s.done ? ' done' : '') }, cb, h('span', { class: 'grow' }, s.title),
          ro ? null : h('button', { class: 'icon-btn', title: 'Удалить', 'aria-label': 'Удалить подзадачу', onclick: () => remove('subtasks', s.id) }, icon('x')));
      }), input);
    refreshIcons();
  };
  const drawComments = () => {
    const cms = store.comments.filter((x) => x.task_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ta = h('textarea', { placeholder: 'Написать комментарий…', maxlength: 4000, style: 'min-height:60px', 'aria-label': 'Комментарий' });
    clear(cmBox).append(h('h4', { style: 'margin:18px 0 8px' }, `Комментарии (${cms.length})`),
      cms.map((m) => h('div', { class: 'comment', dataset: { id: m.id } }, avatar(userName(m.author_id), 'xs'),
        h('div', { class: 'grow' }, h('div', { class: 'small' }, h('b', {}, userName(m.author_id)), h('span', { class: 'muted' }, ' · ' + relTime(m.created_at))), h('p', {}, m.body)),
        (m.author_id === store.me.id || isAdmin()) ? h('button', { class: 'icon-btn', title: 'Удалить', 'aria-label': 'Удалить комментарий', onclick: () => remove('comments', m.id) }, icon('trash-2')) : null)),
      h('div', { class: 'stack', style: 'margin-top:10px' }, ta,
        h('button', { class: 'btn primary sm', style: 'align-self:flex-end', onclick: async () => {
          const body = ta.value.trim(); if (!body) return; ta.value = '';
          const r = await create('comments', { task_id: id, author_id: store.me.id, body });
          if (r) logAct(`прокомментировал задачу «${store.tasks.find((x) => x.id === id)?.title}»`, 'task', id);
        } }, 'Отправить')));
    refreshIcons();
  };
  const drawHist = () => {
    const items = store.activity.filter((a) => a.entity_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    clear(histBox).append(items.length ? items.map((a) => h('div', { class: 'list-item', style: 'cursor:default' }, avatar(userName(a.actor_id), 'xs'),
      h('div', { class: 'grow' }, h('b', {}, userName(a.actor_id)), ' ' + a.message), h('span', { class: 'small muted' }, fmtDT(a.created_at)))) : emptyState('history', 'Истории пока нет', 'Здесь появятся изменения задачи'));
    refreshIcons();
  };
  const dt = h('div', { class: 'form-grid' },
    h('div', { class: 'full' }, field('Название', c.title)), h('div', { class: 'full' }, field('Описание', c.description)),
    field('Проект', c.project), field('Статус', c.status), field('Приоритет', c.priority), field('Важность', c.importance),
    field('Дедлайн', c.due), field('Исполнитель', c.assignee));
  detail.append(dt, isNew ? h('p', { class: 'small muted' }, 'Подзадачи и комментарии станут доступны после создания.') : [meta, subBox, cmBox]);
  const tabBtn = (label, key) => h('button', { class: key === 'd' ? 'active' : '', onclick: (e) => {
    [...tabs.children].forEach((b) => b.classList.remove('active')); e.target.classList.add('active');
    detail.hidden = key !== 'd'; histBox.hidden = key !== 'h'; if (key === 'h') drawHist();
  } }, label);
  histBox.hidden = true;
  if (!isNew) tabs.append(tabBtn('Детали', 'd'), tabBtn('История', 'h'));

  let m;
  const footer = [];
  if (isNew) {
    footer.push(h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'), h('button', { class: 'btn primary', onclick: async (e) => {
      const v = collect(); if (!v.title) { toast('Введите название задачи', 'warning'); c.title.focus(); return; }
      e.target.disabled = true; const r = await createTask(v); e.target.disabled = false;
      if (r) { m.close(); toast('Задача создана', 'success'); }
    } }, 'Создать'));
  } else {
    if (!ro) footer.push(h('button', { class: 'btn danger', onclick: async () => { if (await deleteTask(id)) m.close(); } }, icon('trash-2'), 'Удалить'));
    footer.push(h('button', { class: 'btn', onclick: () => m.close() }, 'Закрыть'));
    const bind = (el, field, conv) => el.addEventListener('change', () => {
      const v = conv(); if (field === 'title' && !v) { toast('Название не может быть пустым', 'warning'); setVals(store.tasks.find((x) => x.id === id), true); return; }
      updateTask(id, { [field]: v });
    });
    bind(c.title, 'title', () => c.title.value.trim()); bind(c.description, 'description', () => c.description.value.trim() || null);
    bind(c.project, 'project_id', () => c.project.value || null); bind(c.status, 'status', () => c.status.value);
    bind(c.priority, 'priority', () => c.priority.value); bind(c.importance, 'importance', () => +c.importance.value);
    bind(c.due, 'due_at', () => fromInput(c.due.value)); bind(c.assignee, 'assignee_id', () => c.assignee.value || null);
  }
  // Живое обновление панели при изменениях от других пользователей
  const onChange = (e) => {
    if (isNew) return;
    const x = store.tasks.find((y) => y.id === id);
    if (!x) { m.close(); toast('Задача удалена другим пользователем', 'warning'); return; }
    if (e.detail.table === 'tasks') { setVals(x, false); drawMeta(); }
    if (e.detail.table === 'subtasks') drawSubs();
    if (e.detail.table === 'comments') drawComments();
    if (e.detail.table === 'activity' && !histBox.hidden) drawHist();
  };
  bus.addEventListener('change', onChange);
  m = openModal({ title: isNew ? 'Новая задача' : 'Задача', side: true, body: [tabs, detail, histBox], footer, onClose: () => bus.removeEventListener('change', onChange) });
  if (isNew) setTimeout(() => c.title.focus(), 50); else { drawMeta(); drawSubs(); drawComments(); }
  return m;
}

// ---------- Страница «Задачи» ----------
const SORT_KEY = 'homecrm.tasks.sort';
const filters = { q: '', project: '', status: '', priority: '', assignee: '', due: '' };
let sortState = (() => { try { return JSON.parse(localStorage.getItem(SORT_KEY)) || { col: 'due_at', dir: 1 }; } catch { return { col: 'due_at', dir: 1 }; } })();
let res = null;
function draw() {
  if (!res || !res.isConnected) return;
  taskTable(res, applyFilters(store.tasks, filters), {
    sortState, bulk: true,
    onSort: (k) => { sortState = { col: k, dir: sortState.col === k ? -sortState.dir : 1 }; localStorage.setItem(SORT_KEY, JSON.stringify(sortState)); draw(); },
  });
}
export function render(c) {
  clear(c);
  res = h('div');
  c.append(h('div', { class: 'page-head' }, h('h1', {}, 'Задачи'), h('div', { class: 'grow' }),
    h('button', { class: 'btn primary', onclick: () => openTask(null) }, icon('plus'), 'Новая задача')),
    filterBar(filters, draw, { project: true, status: true }), res);
  draw(); refreshIcons();
}
export const update = draw;
