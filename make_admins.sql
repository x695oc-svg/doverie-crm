-- ИНСТРУКЦИЯ
-- 1. Authentication → Users → Add user → Create new user:
--      stepan@home.local   и   dmitry@home.local   (задайте надёжные пароли, отметьте Auto Confirm User).
--    Либо зарегистрируйтесь через register.html с логинами stepan и dmitry.
-- 2. Если вы используете другие логины — измените список ниже.
-- 3. Выполните этот скрипт в SQL Editor. Он назначит роль admin, статус approved и защитит аккаунты от
--    понижения, блокировки и удаления (триггер protect_profiles + Edge Function delete-user).

update public.profiles
set role = 'admin', status = 'approved', is_protected = true,
    display_name = case login when 'stepan' then 'Степан' when 'dmitry' then 'Дмитрий' else display_name end
where login in ('stepan','dmitry');

-- Проверка: должно вернуться 2 строки
select login, display_name, role, status, is_protected from public.profiles where is_protected;
