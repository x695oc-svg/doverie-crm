// Авторизация: вход, регистрация, ожидание одобрения, защита страниц, автовыход
import { sb } from './supabase-client.js';
import { h } from './utils.js';
import { refreshIcons } from './ui.js';

const DOMAIN = 'home.local';
export const toEmail = (login) => `${String(login).trim().toLowerCase()}@${DOMAIN}`;

// ---------- Пароль ----------
const WEAK = ['123456', '12345678', '123456789', 'qwerty', 'password', 'пароль', 'йцукен', 'admin', 'letmein', '111111', '000000', 'abc123', 'welcome', 'iloveyou'];
export function passwordRules(p) {
  const low = p.toLowerCase();
  return [
    { ok: p.length >= 12, text: 'От 12 символов' },
    { ok: /[a-zа-я]/.test(p), text: 'Строчная буква' },
    { ok: /[A-ZА-Я]/.test(p), text: 'Заглавная буква' },
    { ok: /\d/.test(p), text: 'Цифра' },
    { ok: /[^A-Za-zА-Яа-я0-9]/.test(p), text: 'Спецсимвол' },
    { ok: !!p && !WEAK.some((w) => low.includes(w)) && !/(.)\1{3,}/.test(p), text: 'Не простой пароль' },
  ];
}

// ---------- Сессия и профиль ----------
export async function getProfile() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { session: null, profile: null };
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error) throw error;
  return { session, profile: data };
}
export async function logout() {
  try { await sb.auth.signOut(); } catch (e) { /* игнорируем: всё равно уходим на вход */ }
  location.replace('login.html');
}
function goByStatus(profile) {
  if (profile.status === 'approved') location.replace('index.html');
  else if (profile.status === 'pending') location.replace('pending.html');
  else { sb.auth.signOut().finally(() => location.replace('login.html?blocked=1')); }
}
// Для index.html: только approved, иначе редирект
export async function requireApproved() {
  let r;
  try { r = await getProfile(); } catch (e) { r = { error: e }; }
  if (r.error) throw r.error;
  if (!r.session || !r.profile) { await sb.auth.signOut().catch(() => {}); location.replace('login.html'); return new Promise(() => {}); }
  if (r.profile.status !== 'approved') { goByStatus(r.profile); return new Promise(() => {}); }
  return r;
}

// ---------- Автовыход через 30 минут бездействия ----------
export function startIdleWatch(limitMin = 30) {
  const LIMIT = limitMin * 60000, WARN = 60000;
  let last = Date.now(), banner = null;
  const reset = () => { if (!banner) last = Date.now(); };
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
  setInterval(() => {
    const left = LIMIT - (Date.now() - last);
    if (left <= 0) { logout(); return; }
    if (left <= WARN) {
      if (!banner) {
        banner = h('div', { class: 'idle-warn', role: 'alertdialog' }, h('span', { id: 'idle-text' }),
          h('button', { class: 'btn primary sm', onclick: () => { banner.remove(); banner = null; last = Date.now(); } }, 'Остаться'));
        document.body.append(banner);
      }
      banner.querySelector('#idle-text').textContent = `Выход из-за бездействия через ${Math.ceil(left / 1000)} с`;
    }
  }, 1000);
}

// ---------- Страницы ----------
const $ = (id) => document.getElementById(id);
function bindToggle() {
  const btn = $('toggle-pw'); if (!btn) return;
  btn.addEventListener('click', () => {
    const inp = $('password'); const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    btn.firstChild?.setAttribute?.('data-lucide', show ? 'eye-off' : 'eye');
    btn.replaceChildren(h('i', { 'data-lucide': show ? 'eye-off' : 'eye' })); refreshIcons();
  });
}
const authError = (m) => {
  const s = String(m || '');
  if (/invalid login/i.test(s)) return 'Неверный логин или пароль';
  if (/already registered|already been registered/i.test(s)) return 'Этот логин уже занят';
  if (/rate limit|too many/i.test(s)) return 'Слишком много запросов, попробуйте позже';
  if (/failed to fetch|network/i.test(s)) return 'Нет связи с сервером';
  if (/email.*invalid|invalid.*email/i.test(s)) return 'Сервер отклонил логин (см. README → «Частые проблемы»)';
  return 'Ошибка: ' + s;
};

async function initLogin() {
  bindToggle();
  const err = $('form-error');
  if (new URLSearchParams(location.search).has('blocked')) err.textContent = 'Ваш аккаунт заблокирован администратором.';
  try { const r = await getProfile(); if (r.profile && r.profile.status !== 'blocked') return goByStatus(r.profile); } catch (e) { /* остаёмся на входе */ }
  const KEY = 'homecrm.loginFails';
  const state = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { n: 0, until: 0 }; } catch { return { n: 0, until: 0 }; } };
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const st = state();
    if (st.until > Date.now()) { err.textContent = `Слишком много попыток. Повторите через ${Math.ceil((st.until - Date.now()) / 60000)} мин.`; return; }
    const login = $('login').value.trim(), pass = $('password').value;
    if (!login || !pass) { err.textContent = 'Введите логин и пароль'; return; }
    if (!/^[A-Za-z0-9_]{4,20}$/.test(login)) { err.textContent = 'Неверный логин или пароль'; return; }
    const btn = $('submit'); btn.disabled = true; err.textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: toEmail(login), password: pass });
    btn.disabled = false;
    if (error) {
      const n = st.n + 1;
      localStorage.setItem(KEY, JSON.stringify(n >= 5 ? { n: 0, until: Date.now() + 5 * 60000 } : { n, until: 0 }));
      err.textContent = n >= 5 ? 'Пять неудачных попыток. Вход заблокирован на 5 минут.' : `${authError(error.message)} (попытка ${n} из 5)`;
      return;
    }
    localStorage.removeItem(KEY);
    try { const r = await getProfile(); r.profile ? goByStatus(r.profile) : (err.textContent = 'Профиль не найден'); }
    catch (ex) { err.textContent = authError(ex.message); }
  });
}

function initRegister() {
  bindToggle();
  const err = $('form-error'), pw = $('password'), rules = $('rules');
  const draw = () => {
    const r = passwordRules(pw.value), ok = r.filter((x) => x.ok).length;
    rules.replaceChildren(...r.map((x) => h('li', { class: x.ok ? 'ok' : '' }, (x.ok ? '✓ ' : '○ ') + x.text)));
    const bar = $('meter-bar'); bar.style.width = (ok / r.length * 100) + '%';
    bar.style.background = ok < 3 ? 'var(--danger)' : ok < 6 ? 'var(--warning)' : 'var(--success)';
    $('meter-text').textContent = pw.value ? (ok < 3 ? 'Слабый пароль' : ok < 6 ? 'Средний пароль' : 'Надёжный пароль') : 'Надёжность пароля';
  };
  pw.addEventListener('input', draw); draw();
  $('register-form').addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    const login = $('login').value.trim(), name = $('name').value.trim();
    if (!/^[A-Za-z0-9_]{4,20}$/.test(login)) { err.textContent = 'Логин: 4–20 символов, латиница, цифры и _'; return; }
    if (name.length < 2 || name.length > 40) { err.textContent = 'Имя: от 2 до 40 символов'; return; }
    if (passwordRules(pw.value).some((r) => !r.ok)) { err.textContent = 'Пароль не соответствует требованиям'; return; }
    if (pw.value !== $('password2').value) { err.textContent = 'Пароли не совпадают'; return; }
    const btn = e.target.querySelector('button.primary'); btn.disabled = true;
    const { error } = await sb.auth.signUp({ email: toEmail(login), password: pw.value, options: { data: { login: login.toLowerCase(), display_name: name } } });
    btn.disabled = false;
    if (error) { err.textContent = authError(error.message); return; }
    try { const r = await getProfile(); r.profile ? goByStatus(r.profile) : location.replace('pending.html'); }
    catch { location.replace('pending.html'); }
  });
}

async function initPending() {
  $('logout').addEventListener('click', logout);
  let r;
  try { r = await getProfile(); } catch (e) { r = {}; }
  if (!r.session || !r.profile) return location.replace('login.html');
  if (r.profile.status !== 'pending') return goByStatus(r.profile);
  $('who').textContent = `${r.profile.display_name} (${r.profile.login})`;
  const check = async () => { try { const x = await getProfile(); if (!x.profile) return logout(); if (x.profile.status !== 'pending') goByStatus(x.profile); } catch (e) { /* сеть недоступна — повторим */ } };
  sb.channel('pending-' + r.profile.id).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${r.profile.id}` }, check).subscribe();
  setInterval(check, 15000);
}

const page = document.body?.dataset?.page;
if (page) {
  refreshIcons();
  if (page === 'login') initLogin();
  else if (page === 'register') initRegister();
  else if (page === 'pending') initPending();
}
