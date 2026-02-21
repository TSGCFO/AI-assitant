alter table if exists sessions
  add column if not exists summary text not null default '',
  add column if not exists summary_updated_at timestamptz,
  add column if not exists is_title_custom boolean not null default false,
  add column if not exists persona_id text not null default 'default',
  add column if not exists preferred_language text default 'en';

alter table if exists messages
  add column if not exists format text not null default 'text',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_from_message_id uuid,
  add column if not exists regeneration_root_id uuid;

create table if not exists saved_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  session_id uuid not null references sessions (id) on delete cascade,
  message_id uuid not null references messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);

create index if not exists saved_messages_user_session_idx
  on saved_messages (user_id, session_id, created_at desc);

create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  session_id uuid not null references sessions (id) on delete cascade,
  message_id uuid not null references messages (id) on delete cascade,
  value text not null check (value in ('up', 'down')),
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, message_id)
);

create table if not exists message_translations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  message_id uuid not null references messages (id) on delete cascade,
  target_language text not null,
  translated_text text not null,
  created_at timestamptz not null default now(),
  unique (user_id, message_id, target_language)
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  session_id uuid not null references sessions (id) on delete cascade,
  message_id uuid references messages (id) on delete set null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  storage_path text not null,
  url text not null,
  kind text not null default 'other',
  created_at timestamptz not null default now()
);

create index if not exists attachments_user_session_idx
  on attachments (user_id, session_id, created_at desc);

create table if not exists message_citations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  message_id uuid not null references messages (id) on delete cascade,
  title text not null,
  url text not null,
  source text,
  snippet text,
  created_at timestamptz not null default now()
);

create index if not exists message_citations_message_idx
  on message_citations (message_id, created_at asc);

create table if not exists search_cache (
  query text primary key,
  answer text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null,
  notes text,
  due_at timestamptz,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_status_due_idx
  on tasks (user_id, status, due_at asc nulls last);

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  task_id uuid references tasks (id) on delete set null,
  text text not null,
  due_at timestamptz not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reminders_due_status_idx
  on reminders (due_at, delivered_at);

create table if not exists briefings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  briefing_date date not null,
  timezone text not null,
  content text not null,
  topics text[] not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists briefings_user_date_idx
  on briefings (user_id, briefing_date);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null,
  body text not null,
  link_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on notifications (user_id, created_at desc);

create table if not exists feature_flags (
  key text not null,
  user_id text,
  enabled boolean not null default false,
  rollout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (key, user_id)
);

create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sessions_search_idx
  on sessions using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '')));

create index if not exists messages_search_idx
  on messages using gin (to_tsvector('simple', coalesce(content, '')));
