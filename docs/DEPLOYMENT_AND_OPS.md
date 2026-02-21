# AI Assistant - Deployment and Operations

Last updated: February 21, 2026

## What Was Implemented

This repository now includes all roadmap features listed in `TODO.md`, including:

- Session search, renaming, summaries, and saved-only filtering
- Bookmarks, reactions, translate, edit/regenerate, export
- Persona modes and language preference
- Markdown/code rendering and improved typing indicator
- Image generation and file upload/analysis flows
- Web-search-enhanced responses with citations support
- Task/reminder APIs and notification inbox
- Daily briefing endpoints and scheduling support
- Push subscription endpoint and service-worker push handlers

## Database Migrations

Added in repo:

- `supabase/migrations/202602210002_roadmap_foundation.sql`
- `supabase/migrations/202602210003_ops_bootstrap.sql`

Applied to Supabase project on February 21, 2026:

- `roadmap_foundation`
- `ops_bootstrap`

`ops_bootstrap` also:

- Ensures storage bucket `assistant-files` exists
- Installs/uses `pg_cron`
- Creates scheduled jobs:
  - `assistant_dispatch_due_reminders` (`* * * * *`)
  - `assistant_enqueue_daily_briefing_notifications` (`0 7 * * *`)

## Environment Checklist

Set these values in deployment environment (not in git):

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET` (`assistant-files` by default)
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`
- `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`

Optional:

- `FEATURE_ALL_ON`
- `WEB_SEARCH_CACHE_MINUTES`
- model overrides (`OPENAI_CHAT_MODEL`, `OPENAI_IMAGE_MODEL`, etc.)

## Required Security Action

If any OpenAI key was previously exposed, rotate it immediately and replace the old key in all environments.

## Verification Commands

Local:

```bash
npm run lint
npm run build
```

Supabase SQL checks:

```sql
select id, name from storage.buckets where id = 'assistant-files';

select jobname, schedule
from cron.job
where jobname in (
  'assistant_dispatch_due_reminders',
  'assistant_enqueue_daily_briefing_notifications'
);
```

## Notes

- Reminder dispatch now works fully from database cron.
- Daily briefing currently schedules a notification prompt; AI briefing content generation is available via `POST /api/briefings/generate`.
- Push delivery registration is wired; actual push delivery provider/web-push sender still needs app-level key provisioning and delivery worker integration for outbound sends.
