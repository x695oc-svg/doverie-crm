# Home CRM

CRM и таск-трекер для небольшой команды с синхронизацией в реальном времени.
Frontend: чистые HTML/CSS/JS (ES modules, без сборщика). Backend: Supabase (Auth, Postgres, Realtime, RLS, Edge Functions).

## Быстрый старт

### 1. Создание проекта в Supabase
1. Зарегистрируйтесь на https://supabase.com и нажмите **New project** (бесплатный тариф).
2. Запомните пароль БД. Дождитесь окончания создания проекта.
3. Откройте **Project Settings → API** и скопируйте **Project URL** и **anon public key**.

### 2. Отключение подтверждения почты и лимиты
1. **Authentication → Providers → Email**: отключите **Confirm email** (регистрация идёт без почты, логин превращается в `логин@home.local`).
2. По желанию в **Authentication → Rate Limits** уменьшите лимиты регистраций/входов в час.
3. В **Authentication → Policies/Passwords** можно поставить минимальную длину пароля 12 (клиент уже проверяет это сам).

### 3. Запуск schema.sql и seed.sql
1. **SQL Editor → New query**, вставьте содержимое `supabase/schema.sql`, нажмите **Run**.
2. `seed.sql` (проект «Сидоров» и 7 задач) запускайте **после** шага 4, когда уже есть хотя бы один аккаунт (иначе скрипт сообщит об этом).

### 4. Аккаунты Степана и Дмитрия
1. **Authentication → Users → Add user → Create new user**:
   - `stepan@home.local` и `dmitry@home.local`;
   - задайте надёжные пароли (от 12 символов), отметьте **Auto Confirm User**.
   (Либо зарегистрируйтесь на `register.html` с логинами `stepan` и `dmitry`.)
2. Выполните `supabase/make_admins.sql` в SQL Editor. Он назначит роль `admin`, статус `approved` и защиту от понижения/блокировки/удаления. Если логины другие — поправьте список в скрипте.
3. Теперь выполните `supabase/seed.sql`.

### 5. Edge Function delete-user
```bash
npm i -g supabase            # или scoop/brew, см. документацию Supabase CLI
supabase login
supabase link --project-ref <ВАШ_PROJECT_REF>
supabase functions deploy delete-user
```
Секреты `SUPABASE_URL`, `SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY` в Edge Functions уже доступны автоматически. Если нужно задать вручную:
```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
```
Ключ `service_role` хранится только в секретах Supabase. Никогда не вставляйте его в `config.js`, код или репозиторий.

### 6. config.js
```bash
cp config.example.js config.js
```
Вставьте `SUPABASE_URL` и **anon key**. Файл `config.js` в `.gitignore` и в репозиторий не попадает.
Для локального запуска: `python3 -m http.server 8080` и откройте http://localhost:8080/login.html (ES-модули не работают через `file://`).

### 7. GitHub Pages (или Cloudflare Pages / Netlify)
1. Создайте репозиторий и загрузите проект (`git push` в ветку `main`).
2. **Settings → Secrets and variables → Actions** добавьте секреты `SUPABASE_URL` и `SUPABASE_ANON_KEY` (только публичные значения).
3. **Settings → Pages → Source: GitHub Actions**. Workflow `.github/workflows/pages.yml` сам создаст `config.js` при деплое и опубликует сайт.
4. Cloudflare Pages / Netlify: подключите репозиторий, build command — пусто, папка публикации — корень; `config.js` добавьте вручную (Netlify: загрузкой файла; Cloudflare: через собственную команду `printf`, как в workflow).
5. В Supabase → **Authentication → URL Configuration** укажите адрес сайта как Site URL.

### 8. Проверка безопасности
- Откройте `index.html` без входа — должен произойти редирект на `login.html`.
- Зарегистрируйте тестового пользователя: он видит только `pending.html`. В консоли браузера запрос `select * from tasks` вернёт пустой список (RLS).
- Войдите как admin, раздел «Пользователи»: «Одобрить» — у тестового пользователя страница обновится сама.
- Попробуйте заблокировать/удалить Степана или Дмитрия: кнопок нет (интерфейс); прямой `update profiles set role='member'` из SQL Editor и вызов функции с их id вернут ошибку (триггер и Edge Function).
- Проверьте блокировку входа: 5 неверных паролей → 5 минут ожидания.

### 9. Бэкап
На Дашборде: **Бэкап JSON** (все таблицы одним файлом) и **Экспорт CSV** (по файлу на таблицу). Дополнительно используйте Supabase → Database → Backups.

### 10. Частые проблемы
| Проблема | Решение |
|---|---|
| Белый экран / «Проверьте config.js» | Нет `config.js` или неверные URL/anon key. |
| «Email address is invalid» при регистрации | Некоторые настройки Supabase отклоняют домен `.local`. Замените `DOMAIN` в `js/auth.js` и логины в `make_admins.sql`/Edge Function на домен вроде `home.example.com`. |
| После регистрации сразу просит подтвердить почту | Не отключён **Confirm email** (шаг 2). |
| Изменения не приходят в реальном времени | Выполните блок Realtime из `schema.sql` повторно; проверьте Database → Replication. |
| Удаление пользователя даёт ошибку | Функция не задеплоена (шаг 5) или вызывающий не admin. |
| Нельзя изменить чужую задачу | Так задумано: member правит только свои задачи (создал/исполнитель). |
| Старая версия после обновления | Очистите кэш PWA (DevTools → Application → Clear storage) или увеличьте `CACHE` в `sw.js`. |
| `Failed to load module` локально | Запускайте через http-сервер, не через `file://`. |

## Горячие клавиши
`N` — новая задача, `/` или `Ctrl+K` — поиск, `Esc` — закрыть окно.

## Структура
См. дерево в корне архива: `js/` — модули, `supabase/` — БД и Edge Function, `sw.js` + `manifest.json` — PWA.
