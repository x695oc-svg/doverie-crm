// Контакты (CRM): список, карточка, лента взаимодействий
import { h, clear, KIND, fmtDT, toInput, fromInput, debounce } from './utils.js';
import { icon, openModal, toast, confirmDialog, field, avatar, emptyState, refreshIcons } from './ui.js';
import { store, userName, create, patch, remove, logAct, canEditOwn, isAdmin } from './realtime.js';

let sel = null, q = '', tagFilter = '';
let listEl = null, detailEl = null;
const splitTags = (s) => [...new Set(s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 12);

export function openContactModal(id) {
  const c = id ? store.contacts.find((x) => x.id === id) : null;
  if (id && !c) return;
  const d = c || { name: '', phone: '', email: '', company: '', tags: [], notes: '' };
  const f = {
    name: h('input', { value: d.name, maxlength: 120 }), phone: h('input', { value: d.phone || '', type: 'tel', maxlength: 40 }),
    email: h('input', { value: d.email || '', type: 'email', maxlength: 120 }), company: h('input', { value: d.company || '', maxlength: 120 }),
    tags: h('input', { value: (d.tags || []).join(', '), placeholder: 'через запятую' }), notes: h('textarea'),
  };
  f.notes.value = d.notes || '';
  const body = h('div', { class: 'form-grid' }, h('div', { class: 'full' }, field('Имя', f.name)), field('Телефон', f.phone), field('Email', f.email),
    h('div', { class: 'full' }, field('Компания', f.company)), h('div', { class: 'full' }, field('Теги', f.tags)), h('div', { class: 'full' }, field('Заметки', f.notes)));
  const footer = [h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'), h('button', { class: 'btn primary', onclick: async (e) => {
    if (!f.name.value.trim()) { toast('Введите имя', 'warning'); f.name.focus(); return; }
    if (f.email.value && !/^\S+@\S+\.\S+$/.test(f.email.value.trim())) { toast('Некорректный email', 'warning'); return; }
    const v = { name: f.name.value.trim(), phone: f.phone.value.trim() || null, email: f.email.value.trim() || null, company: f.company.value.trim() || null, tags: splitTags(f.tags.value), notes: f.notes.value.trim() || null };
    e.target.disabled = true;
    const r = c ? await patch('contacts', c.id, v) : await create('contacts', { ...v, created_by: store.me.id });
    e.target.disabled = false;
    if (r) { sel = r.id; logAct(`${c ? 'изменил' : 'добавил'} контакт «${r.name}»`, 'contact', r.id); m.close(); toast('Контакт сохранён', 'success'); if (location.hash !== '#/contacts') location.hash = '#/contacts'; }
  } }, 'Сохранить')];
  const m = openModal({ title: c ? 'Редактирование контакта' : 'Новый контакт', body, footer });
}

function drawList() {
  if (!listEl) return;
  const allTags = [...new Set(store.contacts.flatMap((c) => c.tags || []))].sort();
  const items = store.contacts.filter((c) => {
    const s = q.toLowerCase();
    if (tagFilter && !(c.tags || []).includes(tagFilter)) return false;
    return !s || [c.name, c.company, c.phone, c.email].some((x) => (x || '').toLowerCase().includes(s));
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  clear(listEl).append(
    allTags.length ? h('div', { class: 'row', style: 'gap:6px;margin-bottom:10px' }, h('span', { class: 'tag', style: tagFilter ? 'opacity:.5' : '', onclick: () => { tagFilter = ''; drawList(); } }, 'все'),
      allTags.map((t) => h('span', { class: 'tag', style: tagFilter === t ? '' : 'opacity:.6', onclick: () => { tagFilter = t; drawList(); } }, '#' + t))) : null,
    items.length ? items.map((c) => h('div', { class: 'contact-row' + (c.id === sel ? ' sel' : ''), dataset: { id: c.id }, tabindex: 0, onclick: () => { sel = c.id; drawList(); drawDetail(); },
      onkeydown: (e) => { if (e.key === 'Enter') { sel = c.id; drawList(); drawDetail(); } } },
      avatar(c.name), h('div', { style: 'min-width:0' }, h('b', {}, c.name), h('div', { class: 'small muted' }, c.company || c.phone || c.email || '')))) : emptyState('users', 'Контактов нет', 'Нажмите «Создать → Контакт»'));
  refreshIcons();
}

function drawDetail() {
  if (!detailEl) return;
  const c = store.contacts.find((x) => x.id === sel);
  clear(detailEl);
  if (!c) { detailEl.append(h('div', { class: 'card' }, emptyState('contact', 'Выберите контакт', 'Слева список, справа — карточка'))); refreshIcons(); return; }
  const projs = store.projects.filter((p) => p.contact_id === c.id);
  const inter = store.interactions.filter((i) => i.contact_id === c.id).sort((a, b) => b.happened_at.localeCompare(a.happened_at));
  const kind = h('select', { 'aria-label': 'Тип' }, Object.entries(KIND).map(([k, v]) => h('option', { value: k }, v)));
  const when = h('input', { type: 'datetime-local', value: toInput(new Date().toISOString()), 'aria-label': 'Дата' });
  const note = h('input', { placeholder: 'Что обсудили', maxlength: 500, 'aria-label': 'Заметка' });
  const ic = { call: 'phone', meeting: 'users', message: 'message-square' };
  detailEl.append(h('div', { class: 'card stack' },
    h('div', { class: 'row' }, avatar(c.name, 'lg'), h('div', { class: 'grow' }, h('h2', {}, c.name), h('div', { class: 'muted' }, c.company || '')),
      canEditOwn(c) ? [h('button', { class: 'btn', onclick: () => openContactModal(c.id) }, icon('pencil'), 'Изменить'),
        h('button', { class: 'btn danger', onclick: async () => { if (!(await confirmDialog(`Удалить контакт «${c.name}»?`, 'Удалить'))) return; if (await remove('contacts', c.id)) { logAct(`удалил контакт «${c.name}»`, 'contact', null); sel = null; toast('Контакт удалён', 'success'); } } }, icon('trash-2'))] : null),
    h('div', { class: 'row' },
      c.phone ? h('a', { class: 'btn', href: 'tel:' + c.phone.replace(/[^\d+]/g, '') }, icon('phone'), c.phone) : null,
      c.email ? h('a', { class: 'btn', href: 'mailto:' + c.email }, icon('mail'), c.email) : null),
    (c.tags || []).length ? h('div', { class: 'row', style: 'gap:6px' }, c.tags.map((t) => h('span', { class: 'tag', onclick: () => { tagFilter = t; drawList(); } }, '#' + t))) : null,
    c.notes ? h('div', {}, h('h4', { style: 'margin-bottom:4px' }, 'Заметки'), h('p', { style: 'white-space:pre-wrap;margin:0' }, c.notes)) : null,
    h('div', {}, h('h4', { style: 'margin-bottom:6px' }, 'Проекты'), projs.length ? h('div', { class: 'row' }, projs.map((p) => h('a', { class: 'badge', href: '#/project/' + p.id, style: 'border-color:' + p.color }, p.name))) : h('span', { class: 'muted small' }, 'Нет привязанных проектов')),
    h('div', {}, h('h4', { style: 'margin-bottom:8px' }, 'Взаимодействия'),
      h('div', { class: 'row', style: 'flex-wrap:nowrap;margin-bottom:10px' }, h('div', { style: 'width:150px' }, kind), h('div', { style: 'width:210px' }, when), h('div', { class: 'grow' }, note),
        h('button', { class: 'btn primary', onclick: async () => {
          if (!note.value.trim()) { toast('Опишите взаимодействие', 'warning'); return; }
          const r = await create('interactions', { contact_id: c.id, kind: kind.value, note: note.value.trim(), happened_at: fromInput(when.value) || new Date().toISOString(), author_id: store.me.id });
          if (r) logAct(`добавил взаимодействие (${KIND[r.kind].toLowerCase()}) с «${c.name}»`, 'contact', c.id);
        } }, icon('plus'))),
      inter.length ? inter.map((i) => h('div', { class: 'list-item', style: 'cursor:default', dataset: { id: i.id } }, icon(ic[i.kind]),
        h('div', { class: 'grow' }, h('b', {}, KIND[i.kind]), ' — ' + (i.note || ''), h('div', { class: 'small muted' }, `${fmtDT(i.happened_at)} · ${userName(i.author_id)}`)),
        (i.author_id === store.me.id || isAdmin()) ? h('button', { class: 'icon-btn', 'aria-label': 'Удалить', onclick: () => remove('interactions', i.id) }, icon('x')) : null))
        : h('span', { class: 'muted small' }, 'Взаимодействий пока нет'))));
  refreshIcons();
}

export function render(c) {
  clear(c);
  listEl = h('div'); detailEl = h('div');
  c.append(h('div', { class: 'page-head' }, h('h1', {}, 'Контакты'), h('div', { class: 'grow' }),
    h('button', { class: 'btn primary', onclick: () => openContactModal(null) }, icon('plus'), 'Новый контакт')),
    h('div', { class: 'split' }, h('div', { class: 'card' }, h('input', { placeholder: 'Поиск контактов…', value: q, 'aria-label': 'Поиск', style: 'margin-bottom:10px', oninput: debounce((e) => { q = e.target.value; drawList(); }, 150) }), listEl), detailEl));
  drawList(); drawDetail(); refreshIcons();
}
export function update() { drawList(); drawDetail(); }
export function select(id) { sel = id; }
