// Хранилище данных, Realtime-подписки, оптимистичные мутации с откатом
import { sb } from './supabase-client.js';
import { uuid } from './utils.js';
import { toast } from './ui.js';

export const T = {
  profiles: 'profiles', projects: 'projects', tasks: 'tasks', subtasks: 'subtasks', comments: 'comments',
  events: 'events', contacts: 'contacts', interactions: 'contact_interactions', activity: 'activity_log',
};
export const store = { me: null, settings: {}, notifs: [], online: navigator.onLine, loaded: false };
Object.keys(T).forEach((k) => { store[k] = []; });
export const bus = new EventTarget();
const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

// id, которые изменили мы сами (чтобы не подсвечивать и не уведомлять о собственных действиях)
const touched = new Map();
const touch = (id) => { touched.set(id, Date.now()); setTimeout(() => touched.delete(id), 6000); };
const isMine = (id) => touched.has(id);

// ---------- Справочники ----------
export const user = (id) => store.profiles.find((p) => p.id === id);
export const userName = (id) => user(id)?.display_name || 'Неизвестный';
export const project = (id) => store.projects.find((p) => p.id === id);
export const approvedUsers = () => store.profiles.filter((p) => p.status === 'approved');
export const isAdmin = () => store.me?.role === 'admin';
export function projectStats(pid) {
  const ts = store.tasks.filter((t) => t.project_id === pid);
  const done = ts.filter((t) => t.status === 'done').length;
  return { total: ts.length, done, pct: ts.length ? Math.round(done / ts.length * 100) : 0 };
}
export const canEditTask = (t) => isAdmin() || t.created_by === store.me.id || t.assignee_id === store.me.id;
export const canEditOwn = (row, field = 'created_by') => isAdmin() || row[field] === store.me.id;

// ---------- Загрузка ----------
export async function loadAll() {
  const keys = Object.keys(T);
  const res = await Promise.all(keys.map((k) => {
    let q = sb.from(T[k]).select('*');
    if (k === 'activity') q = q.order('created_at', { ascending: false }).limit(300);
    return q;
  }));
  res.forEach((r, i) => { if (r.error) throw r.error; store[keys[i]] = r.data; });
  const s = await sb.from('settings').select('*');
  if (!s.error) store.settings = Object.fromEntries(s.data.map((x) => [x.key, x.value]));
  const me = store.profiles.find((p) => p.id === store.me?.id);
  if (me) store.me = me;
  store.loaded = true;
  emit('change', { table: '*', type: 'reload' });
}

// ---------- Подписки ----------
let channel = null, lostOnce = false;
function setOnline(v) { if (store.online !== v) { store.online = v; emit('conn'); } }

function applyRow(key, type, row, old) {
  const arr = store[key]; const id = (row && row.id) || (old && old.id);
  const i = arr.findIndex((x) => x.id === id);
  if (type === 'DELETE') { if (i >= 0) arr.splice(i, 1); }
  else if (i >= 0) arr[i] = row;
  else arr.unshift(row);
}

export function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('home-crm');
  for (const k of [...Object.keys(T), 'settings']) {
    const table = T[k] || 'settings';
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
      if (k === 'settings') { if (p.new?.key) { store.settings[p.new.key] = p.new.value; emit('change', { table: k, type: p.eventType }); } return; }
      const id = (p.new && p.new.id) || (p.old && p.old.id);
      const prev = store[k].find((x) => x.id === id);
      // Изменение только last_seen не должно перерисовывать интерфейс
      const quiet = k === 'profiles' && p.eventType === 'UPDATE' && prev && prev.role === p.new.role && prev.status === p.new.status && prev.display_name === p.new.display_name;
      applyRow(k, p.eventType, p.new, p.old);
      if (k === 'profiles' && p.new && p.new.id === store.me?.id) {
        store.me = p.new;
        if (p.new.status !== 'approved') { location.replace('login.html'); return; }
      }
      if (quiet) return;
      const mine = isMine(id);
      emit('change', { table: k, type: p.eventType, id, row: p.new, mine });
      if (k === 'activity' && p.eventType === 'INSERT' && !mine) { store.notifs.unshift(p.new); emit('notif'); }
    });
  }
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      setOnline(true);
      if (lostOnce) { lostOnce = false; loadAll().catch(() => {}); }
    } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) { lostOnce = true; setOnline(false); }
  });
}
window.addEventListener('offline', () => { lostOnce = true; setOnline(false); });
window.addEventListener('online', () => { setOnline(true); loadAll().catch(() => {}); subscribe(); });

// ---------- Мутации (оптимистично, с откатом) ----------
const fail = (msg, e) => { toast(`${msg}: ${e?.message || 'ошибка сети'}`, 'error', 5000); };

export async function create(key, row) {
  row = { id: uuid(), ...row };
  touch(row.id);
  store[key].unshift(row); emit('change', { table: key, type: 'INSERT', id: row.id, mine: true });
  const { data, error } = await sb.from(T[key]).insert(row).select().single();
  if (error) {
    store[key] = store[key].filter((x) => x.id !== row.id);
    emit('change', { table: key, type: 'DELETE', id: row.id, mine: true });
    fail('Не удалось создать', error); return null;
  }
  applyRow(key, 'UPDATE', data); emit('change', { table: key, type: 'UPDATE', id: row.id, mine: true });
  return data;
}

export async function patch(key, id, changes, extraLocal = {}) {
  const i = store[key].findIndex((x) => x.id === id); if (i < 0) return null;
  const before = store[key][i]; touch(id);
  store[key][i] = { ...before, ...changes, ...extraLocal };
  emit('change', { table: key, type: 'UPDATE', id, mine: true });
  const { data, error } = await sb.from(T[key]).update(changes).eq('id', id).select().maybeSingle();
  if (error || !data) {
    const j = store[key].findIndex((x) => x.id === id); if (j >= 0) store[key][j] = before;
    emit('change', { table: key, type: 'UPDATE', id, mine: true });
    fail('Не удалось сохранить', error || { message: 'нет прав на изменение' }); return null;
  }
  applyRow(key, 'UPDATE', data); emit('change', { table: key, type: 'UPDATE', id, mine: true });
  return data;
}

export async function remove(key, id) {
  const i = store[key].findIndex((x) => x.id === id); if (i < 0) return false;
  const before = store[key][i]; touch(id);
  store[key].splice(i, 1); emit('change', { table: key, type: 'DELETE', id, mine: true });
  const { error, count } = await sb.from(T[key]).delete({ count: 'exact' }).eq('id', id);
  if (error || count === 0) {
    store[key].splice(i, 0, before); emit('change', { table: key, type: 'INSERT', id, mine: true });
    fail('Не удалось удалить', error || { message: 'нет прав на удаление' }); return false;
  }
  return true;
}

// Запись в журнал действий (локально появляется сразу)
export function logAct(message, entityType, entityId) {
  const row = { id: uuid(), actor_id: store.me.id, action: entityType, entity_type: entityType, entity_id: entityId, message, created_at: new Date().toISOString() };
  touch(row.id);
  store.activity.unshift(row); emit('change', { table: 'activity', type: 'INSERT', id: row.id, mine: true });
  sb.from('activity_log').insert(row).then(({ error }) => { if (error) console.warn('activity_log:', error.message); });
}
