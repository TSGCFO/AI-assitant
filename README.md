# Daily Assistant PWA

Android-first Progressive Web App that provides:

- Streaming chat with OpenAI
- Voice interaction (hold-to-talk STT/TTS fallback)
- Realtime voice session bootstrap endpoint
- Persistent sessions and message history
- Working memory plus semantic memory retrieval
- Offline shell plus cached history plus queued outbound sends

## Stack

- Next.js App Router plus TypeScript
- OpenAI APIs (Responses, Realtime session token, STT, TTS, Embeddings)
- Supabase Postgres plus pgvector (optional but recommended)
- Local browser cache plus outbox queue for offline continuity

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
cp .env.example .env.local
```

3. Configure at least:

- `OPENAI_API_KEY`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (optional in local dev, required for durable server-side memory)

4. Start dev server:

```bash
npm run dev
```

5. Open `http://localhost:3000` on desktop or Android Chrome.

## Database schema

Run the migration in `supabase/migrations/202602210001_init_assistant.sql` in your Supabase project to provision:

- `sessions`
- `messages`
- `working_memory`
- `semantic_memory`
- `match_semantic_memory` RPC for vector retrieval

## API surface

- `POST /api/chat/stream`
- `POST /api/realtime/session`
- `POST /api/voice/transcribe`
- `POST /api/voice/synthesize`
- `GET|POST /api/sessions`
- `GET|POST /api/sessions/:id/messages`
- `DELETE /api/sessions/:id`
- `POST /api/memory/retrieve`
- `POST /api/sync/upload`

## PWA notes

- Manifest: `public/manifest.webmanifest`
- Service worker: `public/sw.js`
- Icons: `public/icons`

Install on Android from browser menu -> `Install app`.
