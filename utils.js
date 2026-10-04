// Общие утилиты и справочники
export const STATUS = { todo: 'К выполнению', in_progress: 'В процессе', done: 'Завершено' };
export const PRIORITY = { low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критичный' };
export const PRIO_W = { low: 1, medium: 2, high: 3, critical: 4 };
export const PROJECT_STATUS = { active: 'Активный', paused: 'На паузе', done: 'Завершён' };
export const ROLE = { admin: 'Администратор', member: 'Участник' };
export const USER_STATUS = { pending: 'Ожидает', approved: 'Одобрен', blocked: 'Заблокирован' };
export const KIND = { call: 'Звонок', meeting: 'Встреча', message: 'Сообщение' };
export const COLORS = ['#6d7cff', '#3ecf8e', '#f5b84b', '#ef5b5b', '#c084fc', '#38bdf8', '#fb923c', '#f472b6'];

// Безопасное создание DOM: весь текст вставляется как textContent (защита от XSS), innerHTML не используется.
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'for') e.htmlFor = v;
    else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly', 'multiple'].includes(k)) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export function relTime(iso) {
  if (!iso) return '—';
  const s = Math.round((new Date(iso) - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
  const a = Math.abs(s);
  if (a < 45) return 'только что';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return fmtDate(iso);
}
// ISO -> значение для input[type=datetime-local] / date (локальное время)
export function toInput(iso, type = 'dt') {
  if (!iso) return '';
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return type === 'date' ? date : `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromInput = (v) => v ? new Date(v.length === 10 ? v + 'T00:00' : v).toISOString() : null;
export const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
export const isOverdue = (t) => t.status !== 'done' && t.due_at && new Date(t.due_at) < new Date();
export const isToday = (iso) => iso && sameDay(new Date(iso), new Date());
export function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
}
export function colorFor(s) {
  let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[x % COLORS.length];
}
export function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  // Защита от CSV-инъекций: значения, начинающиеся с = + - @, экранируются апострофом
  const cell = (v) => { let s = v == null ? '' : Array.isArray(v) ? v.join(';') : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return '\ufeff' + [keys.join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\r\n');
}
export const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, d = m % 10; return m > 10 && m < 20 ? c : d > 1 && d < 5 ? b : d === 1 ? a : c; };
