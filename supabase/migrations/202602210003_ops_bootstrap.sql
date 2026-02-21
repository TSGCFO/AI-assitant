create extension if not exists pg_cron;

insert into storage.buckets (id, name, public)
values ('assistant-files', 'assistant-files', false)
on conflict (id) do nothing;

create or replace function public.dispatch_due_reminders_job()
returns integer
language plpgsql
as $$
declare
  delivered_count integer := 0;
begin
  with due as (
    select id, user_id, text
    from reminders
    where delivered_at is null
      and due_at <= now()
    for update skip locked
  ),
  inserted as (
    insert into notifications (id, user_id, title, body, link_url, created_at)
    select gen_random_uuid(), user_id, 'Reminder', text, '/', now()
    from due
    returning id
  ),
  updated as (
    update reminders r
    set delivered_at = now()
    from due
    where r.id = due.id
    returning r.id
  )
  select count(*) into delivered_count from updated;

  return delivered_count;
end;
$$;

create or replace function public.enqueue_daily_briefing_notifications_job()
returns integer
language plpgsql
as $$
declare
  inserted_count integer := 0;
begin
  with recipients as (
    select distinct user_id
    from sessions
  ),
  inserted as (
    insert into notifications (id, user_id, title, body, link_url, created_at)
    select
      gen_random_uuid(),
      recipients.user_id,
      'Daily briefing ready',
      'Open the app and tap Refresh in the Daily Briefing card.',
      '/',
      now()
    from recipients
    where not exists (
      select 1
      from notifications n
      where n.user_id = recipients.user_id
        and n.title = 'Daily briefing ready'
        and n.created_at::date = now()::date
    )
    returning id
  )
  select count(*) into inserted_count from inserted;

  return inserted_count;
end;
$$;

do $$
declare
  reminder_job_id integer;
  briefing_job_id integer;
begin
  select jobid into reminder_job_id
  from cron.job
  where jobname = 'assistant_dispatch_due_reminders';

  if reminder_job_id is not null then
    perform cron.unschedule(reminder_job_id);
  end if;

  perform cron.schedule(
    'assistant_dispatch_due_reminders',
    '* * * * *',
    $job$select public.dispatch_due_reminders_job();$job$
  );

  select jobid into briefing_job_id
  from cron.job
  where jobname = 'assistant_enqueue_daily_briefing_notifications';

  if briefing_job_id is not null then
    perform cron.unschedule(briefing_job_id);
  end if;

  perform cron.schedule(
    'assistant_enqueue_daily_briefing_notifications',
    '0 7 * * *',
    $job$select public.enqueue_daily_briefing_notifications_job();$job$
  );
end;
$$;
