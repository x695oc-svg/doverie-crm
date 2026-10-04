// Раздел «Пользователи» (только admin)
import { h, clear, ROLE, USER_STATUS, fmtDate, relTime } from './utils.js';
import { icon, toast, confirmDialog, avatar, emptyState, refreshIcons } from './ui.js';
import { store, patch, logAct, isAdmin } from './realtime.js';
import { sb } from './supabase-client.js';

async function setStatus(u, status, verb) {
  if (u.is_protected || u.role === 'admin') { toast('Администраторов менять нельзя', 'warning'); return; }
  const r = await patch('profiles', u.id, { status });
  if (r) { logAct(`${verb} пользователя «${u.display_name}»`, 'user', u.id); toast('Готово', 'success'); }
}
async function delUser(u) {
  if (u.is_protected || u.role === 'admin') { toast('Администраторов удалять нельзя', 'warning'); return; }
  if (!(await confirmDialog(`Удалить аккаунт «${u.display_name}» (${u.login}) навсегда?`, 'Удалить'))) return;
  const { data, error } = await sb.functions.invoke('delete-user', { body: { user_id: u.id } });
  if (error || data?.error) { toast('Не удалось удалить: ' + (data?.error || error.message), 'error', 6000); return; }
  store.profiles = store.profiles.filter((p) => p.id !== u.id);
  toast('Аккаунт удалён', 'success'); render(document.getElementById('view'));
}

export function render(c) {
  clear(c);
  if (!isAdmin()) { c.append(emptyState('lock', 'Доступ запрещён', 'Раздел только для администраторов')); refreshIcons(); return; }
  const auto = h('input', { type: 'checkbox', 'aria-label': 'Автоодобрение', onchange: async () => {
    const { error } = await sb.from('settings').update({ value: auto.checked }).eq('key', 'auto_approve');
    if (error) { auto.checked = !auto.checked; toast('Не удалось сохранить: ' + error.message, 'error'); } else { store.settings.auto_approve = auto.checked; toast(auto.checked ? 'Автоодобрение включено' : 'Автоодобрение выключено', 'success'); }
  } });
  auto.checked = store.settings.auto_approve === true;
  const users = [...store.profiles].sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || a.created_at.localeCompare(b.created_at));
  const btn = (label, ic, cls, fn) => h('button', { class: 'btn sm ' + cls, onclick: fn }, icon(ic), label);
  c.append(h('div', { class: 'page-head' }, h('h1', {}, 'Пользователи'), h('div', { class: 'grow' }),
    h('label', { class: 'row', style: 'gap:8px;cursor:pointer' }, auto, 'Автоодобрение новых пользователей')),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['', 'Имя', 'Логин', 'Роль', 'Статус', 'Регистрация', 'Активность', 'Действия'].map((x) => h('th', {}, x)))),
      h('tbody', {}, users.map((u) => {
        const prot = u.is_protected || u.role === 'admin';
        return h('tr', { dataset: { id: u.id } }, h('td', {}, avatar(u.display_name)), h('td', {}, u.display_name), h('td', {}, u.login), h('td', {}, ROLE[u.role]),
          h('td', {}, h('span', { class: 'badge ' + u.status }, USER_STATUS[u.status])), h('td', {}, fmtDate(u.created_at)), h('td', {}, u.last_seen ? relTime(u.last_seen) : '—'),
          h('td', {}, prot ? h('span', { class: 'muted small' }, 'Защищён') : h('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' },
            u.status !== 'approved' ? btn('Одобрить', 'check', 'primary', () => setStatus(u, 'approved', 'одобрил')) : null,
            u.status === 'pending' ? btn('Отклонить', 'x', '', async () => { if (await confirmDialog(`Отклонить заявку «${u.display_name}»?`, 'Отклонить')) setStatus(u, 'blocked', 'отклонил заявку'); }) : null,
            u.status === 'approved' ? btn('Заблокировать', 'ban', '', async () => { if (await confirmDialog(`Заблокировать «${u.display_name}»?`, 'Заблокировать')) setStatus(u, 'blocked', 'заблокировал'); }) : null,
            btn('Удалить', 'trash-2', 'danger', () => delUser(u))));
      })))));
  refreshIcons();
}
export const update = render;
