-- Тестовые данные: проект «Сидоров» и 7 задач. Запускать после schema.sql и после создания хотя бы одного аккаунта (лучше после make_admins.sql).
do $$
declare uid uuid; pid uuid := gen_random_uuid(); cid uuid := gen_random_uuid(); tid uuid;
begin
  select id into uid from public.profiles where role = 'admin' order by created_at limit 1;
  if uid is null then select id into uid from public.profiles order by created_at limit 1; end if;
  if uid is null then raise exception 'Сначала создайте хотя бы один аккаунт'; end if;

  insert into public.contacts(id,name,phone,email,company,tags,notes,created_by)
  values (cid,'Иван Сидоров','+79990001122','sidorov@example.com','ООО «Сидоров и Ко»',array['клиент','ремонт'],'Предпочитает звонки до 18:00.',uid);

  insert into public.projects(id,name,description,client,contact_id,color,start_date,end_date,status,created_by)
  values (pid,'Сидоров','Ремонт квартиры и сопровождение договора подряда.','Иван Сидоров',cid,'#6d7cff',current_date,current_date+60,'active',uid);

  insert into public.tasks(project_id,title,description,status,priority,importance,due_at,assignee_id,position,created_by) values
   (pid,'Согласовать смету','Отправить смету клиенту и получить подтверждение.','todo','high',4,now()+interval '2 days',uid,1000,uid),
   (pid,'Заказать материалы','Плитка, сантехника, электрика.','todo','medium',3,now()+interval '5 days',uid,2000,uid),
   (pid,'Подготовить договор подряда','Проверить условия по срокам и штрафам.','in_progress','critical',5,now()+interval '1 day',uid,1000,uid),
   (pid,'Замер помещений','Выезд на объект.','in_progress','medium',3,now()-interval '1 day',uid,2000,uid),
   (pid,'Первичная встреча','Обсудили объём работ.','done','low',2,now()-interval '5 days',uid,1000,uid),
   (pid,'Собрать документы на квартиру','Выписка ЕГРН, паспорт.','done','medium',3,now()-interval '3 days',uid,2000,uid),
   (pid,'Выставить счёт на аванс','Аванс 30%.','todo','high',4,now()+interval '3 hours',uid,3000,uid);

  select id into tid from public.tasks where project_id = pid and title = 'Подготовить договор подряда';
  insert into public.subtasks(task_id,title,done,position,created_by) values
   (tid,'Проверить реквизиты сторон',true,1000,uid),(tid,'Согласовать сроки',false,2000,uid),(tid,'Добавить приложение со сметой',false,3000,uid);
  insert into public.comments(task_id,author_id,body) values (tid,uid,'Клиент просил добавить пункт о гарантии.');
  insert into public.events(title,description,project_id,starts_at,ends_at,created_by)
  values ('Встреча с Сидоровым','Обсуждение сметы',pid,date_trunc('hour',now())+interval '1 day 3 hours',date_trunc('hour',now())+interval '1 day 4 hours',uid);
  insert into public.contact_interactions(contact_id,kind,note,author_id) values (cid,'call','Первый звонок, договорились о встрече.',uid);
end $$;
