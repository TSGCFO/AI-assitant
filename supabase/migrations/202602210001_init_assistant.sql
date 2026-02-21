create extension if not exists vector;

create table if not exists sessions (
  id uuid primary key,
  user_id text not null,
  title text not null default 'New conversation',
  mode text not null default 'text',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_user_id_updated_idx
  on sessions (user_id, updated_at desc);

create table if not exists messages (
  id uuid primary key,
  session_id uuid not null references sessions (id) on delete cascade,
  user_id text not null,
  role text not null,
  content text not null,
  audio_url text,
  created_at timestamptz not null default now()
);

create index if not exists messages_session_created_idx
  on messages (session_id, created_at asc);

create table if not exists working_memory (
  user_id text not null,
  session_id uuid not null references sessions (id) on delete cascade,
  rolling_summary text not null default '',
  active_entities jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

create table if not exists semantic_memory (
  id uuid primary key,
  user_id text not null,
  session_id uuid not null references sessions (id) on delete cascade,
  message_ids text[] not null default '{}',
  text_chunk text not null,
  embedding vector(3072) not null,
  created_at timestamptz not null default now()
);

create index if not exists semantic_memory_user_idx
  on semantic_memory (user_id, created_at desc);

create index if not exists semantic_memory_embedding_idx
  on semantic_memory using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

create or replace function match_semantic_memory (
  p_user_id text,
  query_embedding vector(3072),
  match_count int default 6,
  match_threshold float default 0.2
)
returns table (
  id uuid,
  session_id uuid,
  message_ids text[],
  text_chunk text,
  created_at timestamptz,
  similarity_score float,
  recency_score float,
  final_score float
)
language sql
as $$
  with ranked as (
    select
      sm.id,
      sm.session_id,
      sm.message_ids,
      sm.text_chunk,
      sm.created_at,
      1 - ((sm.embedding::halfvec(3072)) <=> (query_embedding::halfvec(3072))) as similarity_score,
      greatest(
        0,
        1 - extract(epoch from (now() - sm.created_at)) / (60 * 60 * 24 * 30)
      ) as recency_score
    from semantic_memory sm
    where sm.user_id = p_user_id
      and (1 - ((sm.embedding::halfvec(3072)) <=> (query_embedding::halfvec(3072)))) >= match_threshold
  )
  select
    ranked.id,
    ranked.session_id,
    ranked.message_ids,
    ranked.text_chunk,
    ranked.created_at,
    ranked.similarity_score,
    ranked.recency_score,
    (ranked.similarity_score * 0.8 + ranked.recency_score * 0.2) as final_score
  from ranked
  order by final_score desc
  limit match_count;
$$;
