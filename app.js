// Точка входа: защита страницы, каркас, маршрутизация, горячие клавиши, синхронизация
import { sb } from './supabase-client.js';
import { requireApproved, logout, startIdleWatch } from './auth.js';
import { h, clear, relTime, debounce, ROLE } from './utils.js';
import { icon, avatar, skeletons, errorBox, toast, popover, refreshIcons, hasModal } from './ui.js';
import { store, bus, loadAll, subscribe, isAdmin } from './realtime.js';
import * as dashboard from './dashboard.js';
import * as calendar from './calendar.js';
import * as projects from './projects.js';
import * as tasks from './tasks.js';
import * as contacts from './contacts.js';
import * as users from './users.js';
import { openSearch } from './search.js';
import { userName } from './realtime.js';

const view = document.getElementById('view');
const NAV = [['dashboard', 'Дашборд', 'layout-dashboard'], ['calendar', 'Календарь', 'calendar'], ['projects', 'Проекты', 'folder-kanban'],
  ['tasks', 'Задачи', 'check-square'], ['contacts', 'Контакты', 'contact'], ['users', 'Пользователи', 'shield-check']];
let route = { name: 'dashboard', param: null, mod: dashboard };

// ---------- Маршрутизация ----------
function parseHash() {
  const [, name = 'dashboard', param = null] = location.hash.replace(/^#\/?/, '#/').split('/');
  return { name: name || 'dashboard', param };
}
function renderRoute() {
  const { name, param } = parseHash();
  const mods = { dashboard, calendar, projects, tasks, contacts, users };
  let mod = mods[name], fn;
  if (name === 'project') { mod = projects; fn = () => projects.renderProject(view, param); }
  else if (!mod || (name === 'users' && !isAdmin())) { mod = dashboard; fn = () => dashboard.render(view); route = { name: 'dashboard', param: null, mod }; }
  else fn = () => mod.render(view);
  route = { name: mods[name] || name === 'project' ? name : 'dashboard', param, mod };
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === (route.name === 'project' ? 'projects' : route.name)));
  if (!store.loaded) { clear(view).append(skeletons(5)); return; }
  try { fn(); } catch (e) { console.error(e); clear(view).append(errorBox(e.message, renderRoute)); }
  refreshIcons();
}
const softUpdate = debounce(() => {
  if (!store.loaded) return;
  const active = document.activeElement;
  try {
    if (route.name === 'project') projects.updateProject(view);
    else if (route.mod.update) route.mod.update();
    else if (!(active && view.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName))) route.mod.render(view);
  } catch (e) { console.error(e); }
  pendingFlash.forEach((id) => document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((el) => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }));
  pendingFlash.clear(); refreshIcons();
}, 120);
const pendingFlash = new Set();

// ---------- Каркас ----------
function buildShell() {
  const items = NAV.filter(([n]) => n !== 'users' || isAdmin());
  const nav = document.getElementById('nav'), bottom = document.getElementById('bottom-nav');
  items.forEach(([n, label, ic]) => {
    nav.append(h('a', { href: '#/' + n, dataset: { route: n }, title: label }, icon(ic), h('span', { class: 'label' }, label)));
    bottom.append(h('a', { href: '#/' + n, dataset: { route: n } }, icon(ic), label));
  });
  const me = store.me;
  document.getElementById('me-avatar').replaceWith(Object.assign(avatar(me.display_name, 'lg'), { id: 'me-avatar' }));
  document.getElementById('me-name').textContent = me.display_name;
  document.getElementById('me-role').textContent = ROLE[me.role];
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('search-trigger').addEventListener('click', openSearch);

  const cb = document.getElementById('create-btn');
  cb.addEventListener('click', () => {
    const p = popover(cb, [['Задача', 'check-square', () => tasks.openTask(null)], ['Проект', 'folder-plus', () => projects.openProjectModal(null)],
      ['Событие', 'calendar-plus', () => calendar.openEventModal(null)], ['Контакт', 'user-plus', () => contacts.openContactModal(null)]]
      .map(([l, ic, f]) => h('button', { onclick: () => { p.close(); f(); } }, icon(ic), l)));
  });
  const bell = document.getElementById('bell');
  bell.addEventListener('click', () => {
    const list = store.notifs.length ? store.notifs.slice(0, 15).map((a) => h('div', { class: 'item small', style: 'padding:8px 10px;display:block' },
      h('b', {}, userName(a.actor_id)), ' ' + a.message, h('div', { class: 'muted' }, relTime(a.created_at)))) : [h('div', { class: 'item muted small', style: 'padding:12px' }, 'Новых уведомлений нет')];
    popover(bell, list); store.notifs.forEach((n) => { n.read = true; }); drawBell();
  });
  refreshIcons();
}
function drawBell() {
  const n = store.notifs.filter((x) => !x.read).length, b = document.getElementById('bell-count');
  b.hidden = n === 0; b.textContent = n > 9 ? '9+' : n;
}
function drawConn() {
  const on = store.online;
  document.getElementById('conn').classList.toggle('off', !on);
  document.getElementById('conn-text').textContent = on ? 'Онлайн' : 'Оффлайн';
  document.getElementById('offline-bar').hidden = on;
}

// ---------- Горячие клавиши ----------
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || hasModal()) return;
  if (e.key === '/') { e.preventDefault(); openSearch(); }
  else if (e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'т') { e.preventDefault(); tasks.openTask(null, route.name === 'project' ? { project_id: route.param } : {}); }
});

// ---------- Запуск ----------
async function boot() {
  try {
    const { profile } = await requireApproved();
    store.me = profile;
    buildShell(); drawConn(); drawBell();
    window.addEventListener('hashchange', renderRoute);
    clear(view).append(skeletons(5));
    renderRoute();
    startIdleWatch(30);
    const load = async () => {
      try { await loadAll(); subscribe(); }
      catch (e) { console.error(e); clear(view).append(errorBox('не удалось загрузить данные: ' + e.message, load)); }
    };
    await load();
    bus.addEventListener('change', (e) => {
      const d = e.detail;
      if (d.type === 'reload') { renderRoute(); return; }
      if (d.id && !d.mine) pendingFlash.add(d.id);
      softUpdate();
    });
    bus.addEventListener('conn', () => { drawConn(); toast(store.online ? 'Соединение восстановлено' : 'Связь потеряна. Пытаемся переподключиться…', store.online ? 'success' : 'warning'); });
    bus.addEventListener('notif', drawBell);
    // Отметка активности
    const beat = () => { if (store.online) sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', store.me.id).then(() => {}); };
    beat(); setInterval(beat, 120000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && store.online) loadAll().catch(() => {}); });
  } catch (e) {
    console.error(e);
    clear(view).append(errorBox(e.message || 'Не удалось запустить приложение. Проверьте config.js', () => location.reload()));
  }
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
boot();
