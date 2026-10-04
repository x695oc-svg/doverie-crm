// Календарь (FullCalendar v6): события и дедлайны задач
import { h, clear, toInput, fromInput, addDays } from './utils.js';
import { icon, openModal, toast, confirmDialog, field, refreshIcons, emptyState, errorBox } from './ui.js';
import { store, project, approvedUsers, create, patch, remove, logAct, canEditOwn } from './realtime.js';
import { openTask } from './tasks.js';

let cal = null;
const filt = { project: '', person: '' };
const ACCENT = '#6d7cff';

function buildEvents() {
  const out = [];
  for (const e of store.events) {
    if (filt.project && e.project_id !== filt.project) continue;
    if (filt.person && !(e.attendees || []).includes(filt.person) && e.created_by !== filt.person) continue;
    const col = project(e.project_id)?.color || ACCENT;
    out.push({ id: 'e:' + e.id, title: e.title, start: e.starts_at, end: e.ends_at || undefined, allDay: e.all_day, backgroundColor: col, borderColor: col,
      editable: canEditOwn(e), extendedProps: { kind: 'event', rid: e.id } });
  }
  for (const t of store.tasks) {
    if (!t.due_at) continue;
    if (filt.project && t.project_id !== filt.project) continue;
    if (filt.person && t.assignee_id !== filt.person) continue;
    const col = project(t.project_id)?.color || '#8b93a3';
    out.push({ id: 't:' + t.id, title: (t.status === 'done' ? '✔ ' : '✓ ') + t.title, start: t.due_at, allDay: false, editable: false, backgroundColor: 'transparent', borderColor: col, textColor: '#e6e8ee',
      classNames: ['is-task'], extendedProps: { kind: 'task', rid: t.id } });
  }
  return out;
}

export function openEventModal(id, defaults = {}) {
  const ev = id ? store.events.find((x) => x.id === id) : null;
  if (id && !ev) return;
  const editable = !ev || canEditOwn(ev);
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const d = ev || { title: '', description: '', project_id: null, starts_at: now.toISOString(), ends_at: new Date(+now + 36e5).toISOString(), all_day: false, attendees: [], ...defaults };
  const title = h('input', { value: d.title, maxlength: 160, disabled: !editable, 'aria-label': 'Название' });
  const desc = h('textarea', { disabled: !editable }); desc.value = d.description || '';
  const proj = h('select', { disabled: !editable }, h('option', { value: '' }, 'Без проекта'), store.projects.filter((p) => !p.archived).map((p) => h('option', { value: p.id, selected: p.id === d.project_id }, p.name)));
  const allDay = h('input', { type: 'checkbox', disabled: !editable }); allDay.checked = !!d.all_day;
  const start = h('input', { type: 'datetime-local', disabled: !editable }), end = h('input', { type: 'datetime-local', disabled: !editable });
  const setMode = (toAll) => {
    const t = toAll ? 'date' : 'datetime-local'; const s = start.value, e = end.value;
    start.type = t; end.type = t;
    start.value = s ? (toAll ? s.slice(0, 10) : s.slice(0, 10) + 'T09:00') : ''; end.value = e ? (toAll ? e.slice(0, 10) : e.slice(0, 10) + 'T10:00') : '';
  };
  start.value = toInput(d.starts_at);
  end.value = d.ends_at ? toInput(d.all_day ? new Date(+new Date(d.ends_at) - 864e5).toISOString() : d.ends_at) : start.value;
  if (d.all_day) setMode(true);
  allDay.onchange = () => setMode(allDay.checked);
  const sel = new Set(d.attendees || []);
  const people = h('div', { class: 'stack', style: 'gap:6px' }, approvedUsers().map((u) => {
    const cb = h('input', { type: 'checkbox', disabled: !editable, onchange: () => (cb.checked ? sel.add(u.id) : sel.delete(u.id)) }); cb.checked = sel.has(u.id);
    return h('label', { class: 'row', style: 'gap:8px;cursor:pointer' }, cb, u.display_name);
  }));
  const body = h('div', { class: 'form-grid' }, h('div', { class: 'full' }, field('Название', title)), h('div', { class: 'full' }, field('Описание', desc)),
    field('Проект', proj), h('label', { class: 'row', style: 'gap:8px;align-self:end;padding-bottom:10px' }, allDay, 'Весь день'),
    field('Начало', start), field('Конец', end), h('div', { class: 'full' }, field('Участники', people)));
  const footer = [];
  if (ev && editable) footer.push(h('button', { class: 'btn danger', onclick: async () => {
    if (!(await confirmDialog(`Удалить событие «${ev.title}»?`, 'Удалить'))) return;
    if (await remove('events', ev.id)) { logAct(`удалил событие «${ev.title}»`, 'event', null); m.close(); toast('Событие удалено', 'success'); }
  } }, icon('trash-2'), 'Удалить'));
  footer.push(h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'));
  if (editable) footer.push(h('button', { class: 'btn primary', onclick: async (e) => {
    if (!title.value.trim()) { toast('Введите название события', 'warning'); title.focus(); return; }
    if (!start.value) { toast('Укажите начало', 'warning'); return; }
    let s = fromInput(start.value), en = fromInput(end.value || start.value);
    if (allDay.checked) en = addDays(new Date(en), 1).toISOString();
    if (new Date(en) < new Date(s)) { toast('Конец раньше начала', 'warning'); return; }
    const v = { title: title.value.trim(), description: desc.value.trim() || null, project_id: proj.value || null, starts_at: s, ends_at: en, all_day: allDay.checked, attendees: [...sel] };
    e.target.disabled = true;
    const r = ev ? await patch('events', ev.id, v) : await create('events', { ...v, created_by: store.me.id });
    e.target.disabled = false;
    if (r) { logAct(`${ev ? 'изменил' : 'создал'} событие «${r.title}»`, 'event', r.id); m.close(); toast('Событие сохранено', 'success'); }
  } }, 'Сохранить'));
  const m = openModal({ title: ev ? 'Событие' : 'Новое событие', body, footer, wide: true });
}

export function render(c) {
  clear(c);
  if (!window.FullCalendar) { c.append(errorBox('Не загрузился FullCalendar (проверьте сеть)', () => render(c))); return; }
  const selP = h('select', { 'aria-label': 'Проект', onchange: () => { filt.project = selP.value; cal.refetchEvents(); } }, h('option', { value: '' }, 'Все проекты'),
    store.projects.filter((p) => !p.archived).map((p) => h('option', { value: p.id, selected: p.id === filt.project }, p.name)));
  const selU = h('select', { 'aria-label': 'Человек', onchange: () => { filt.person = selU.value; cal.refetchEvents(); } }, h('option', { value: '' }, 'Все люди'),
    approvedUsers().map((u) => h('option', { value: u.id, selected: u.id === filt.person }, u.display_name)));
  const el = h('div');
  c.append(h('div', { class: 'page-head' }, h('h1', {}, 'Календарь'), h('div', { class: 'grow' }), selP, selU,
    h('button', { class: 'btn primary', onclick: () => openEventModal(null) }, icon('plus'), 'Событие')), h('div', { class: 'card cal-wrap' }, el));
  const mobile = innerWidth < 768;
  cal = new window.FullCalendar.Calendar(el, {
    locale: 'ru', firstDay: 1, initialView: mobile ? 'listWeek' : 'dayGridMonth', height: mobile ? 'auto' : 'calc(100vh - 190px)', nowIndicator: true,
    headerToolbar: mobile ? { left: 'prev,next', center: 'title', right: 'dayGridMonth,listWeek' } : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' },
    buttonText: { today: 'Сегодня', month: 'Месяц', week: 'Неделя', day: 'День', list: 'Список' },
    selectable: true, editable: true, dayMaxEvents: 4, eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false }, slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    events: (info, ok) => ok(buildEvents()),
    select: (i) => { openEventModal(null, { starts_at: i.start.toISOString(), ends_at: i.end.toISOString(), all_day: i.allDay }); cal.unselect(); },
    eventClick: (i) => { const p = i.event.extendedProps; if (p.kind === 'task') openTask(p.rid); else openEventModal(p.rid); },
    eventDrop: async (i) => { const ok = await saveMove(i.event); if (!ok) i.revert(); },
    eventResize: async (i) => { const ok = await saveMove(i.event); if (!ok) i.revert(); },
  });
  cal.render();
  refreshIcons();
}
async function saveMove(e) {
  if (e.extendedProps.kind !== 'event') return false;
  const start = e.start, end = e.end || (e.allDay ? addDays(start, 1) : new Date(+start + 36e5));
  return !!(await patch('events', e.extendedProps.rid, { starts_at: start.toISOString(), ends_at: end.toISOString(), all_day: e.allDay }));
}
export function update() { if (cal && cal.el?.isConnected) cal.refetchEvents(); }
