# Session Notes — Meridian to Prod

> Running recap of the work to take this project to production. Pairs with `ROADMAP.md`
> (the plan/checklist). This file is the narrative: what we found, what we decided, what's
> set up on this machine, and exactly how to resume. Last updated: 2026-06-11.

## TL;DR — current status

- **Branch:** `revive-brief-pipeline`. One checkpoint commit: `da3b816`. **Not pushed** to the fork yet.
- **Done:** Phase 0 (fork+repoint), Phase 1 (local DB), brief-pipeline revival (code), local ingestion validated.
- **Phase 2 (ML service) ELIMINATED:** deleted the self-hosted embeddings service and switched to
  **Gemini `gemini-embedding-001`** called from the Worker. The **GCP billing blocker is gone** — no
  Cloud Run, no Fly, no separate service. Inspired by the [`lfzawacki/meridiano`](https://github.com/lfzawacki/meridiano) rewrite.
- **Next:** Phase 3 (Cloudflare backend) — the real remaining deploy work.

## What this project is

A fresh clone of open-source **`iliane5/meridian`** — a personal AI news-intelligence pipeline
(scrape RSS → embed → cluster → LLM daily brief → Nuxt UI). Goal: take it to prod. None of the
original commits are the user's. The ingestion half is solid; the **brief half was orphaned by a
May 2025 refactor** and we revived it. Architecture + full plan: see `ROADMAP.md`.

Key recurring theme: the May `v1-candidate` refactor (switched to cheap per-article
representation+embedding, deferring rich analysis to cluster-time) **left 3 downstream consumers
stale** — all now fixed: the brief notebook/`events.py`, the backend `/events` endpoint, and
`packages/database/src/seed.ts`.

## What we did this session

### Phase 0 — Fork & repoint ✅
- Installed + authed GitHub CLI (`gh`, account **pieratka**).
- Forked to **github.com/pieratka/meridian**. Remotes now: `origin` → pieratka fork,
  `upstream` → iliane5/meridian.

### Brief-pipeline revival ✅ (committed in da3b816)
- Restored deleted `apps/briefs/reportV5.ipynb` (the 2140-line orchestration notebook, recovered
  from `e46c62d^`) and rewired it: use stored embeddings (no local re-embedding / no torch),
  publish endpoint via `MERIDIAN_WORKER_API` env var.
- Backend `apps/backend/src/routers/events.router.ts`: `/events` now also returns `content`
  (= `content_body_text`), `embeddingText`, `wordCount` — the article text the brief
  cluster-analysis prompts need.
- `apps/briefs/src/events.py`: rewrote the `Event` model to the post-refactor `/events` shape.
- `.gitignore`: narrowed `apps/briefs` so the notebook + python are tracked (output/logs stay out).

### Phase 1 — Local database ✅
- **PostgreSQL 16** via Homebrew (brew service, **auto-starts at login**).
- **pgvector 0.8.0 built from source for pg16** (the brew formula version was uncertain;
  source build is deterministic).
- Role `postgres` / password `mysecretpassword`; database **`meridian`**.
- `packages/database/.env` → `DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/meridian"`.
- Ran migrations (5 tables + `vector` ext). Fixed stale `seed.ts` ($sources→$data_sources) and
  seeded 5 RSS sources (HN, BBC World, Al Jazeera, NPR, Guardian World).

### Local ingestion validation ✅
- Ran the backend Worker locally via `wrangler dev` (port 8787), pointing Hyperdrive at the local DB:
  `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://postgres:mysecretpassword@localhost:5432/meridian`.
  Local-only secrets in `apps/backend/.dev.vars` (gitignored): `API_TOKEN=local-dev-token` + placeholders.
- `curl -XPOST localhost:8787/do/admin/initialize-dos -H "Authorization: Bearer local-dev-token"`
  → DOs scraped all 5 feeds → **160 real articles** in `ingested_items` (status `NEW`).
- **Processing (representation+embedding) does NOT run locally:** Cloudflare Workflows aren't
  simulated by `wrangler dev`, and it needs a real Gemini key. Embeddings no longer need a service
  (see Phase 2 below); processing just needs a real `GEMINI_API_KEY`. Exercised in Phase 3.

### Phase 2 — ML service ✅ ELIMINATED (was: → Google Cloud Run, blocked on billing)
- **What changed:** instead of deploying the self-hosted FastAPI embeddings service, we **deleted it**
  and switched the Worker to call **Gemini `gemini-embedding-001`** directly (reuses the existing
  `GEMINI_API_KEY` via `@ai-sdk/google`'s `embedMany`; `taskType: 'CLUSTERING'`, 1536-dim output).
  Idea borrowed from [`lfzawacki/meridiano`](https://github.com/lfzawacki/meridiano), which treats
  embeddings as an API call rather than self-hosted torch inference.
- **The GCP billing blocker is therefore moot** — no Cloud Run, no Fly, no `gcloud` deploy at all.
  (For the record: billing account `01AE33-BC587D-3F0CD7` was still `open: false` at last check, and
  project `concrete-sol-499114-u7` reports `billingEnabled: true` — but we no longer need either.)
- **Edits:** rewrote `apps/backend/src/lib/embeddings.ts`; migrated `ingested_items.embedding`
  `vector(384)→vector(1536)` (migration `0004`, HNSW index rebuilt; local test rows truncated first);
  removed `MERIDIAN_ML_SERVICE_*` from the `Env` type, wrangler types, CI workflow, `.dev.vars`;
  `git rm`'d `services/meridian-ml-service/`. Backend typecheck passes; migration applied locally.

## How to resume (next session)

1. **Phase 3:** backend Worker on Cloudflare (replace author's hardcoded Hyperdrive/R2/queue IDs),
   frontend on Pages, then automate the brief job. See `ROADMAP.md`.

## Local environment cheat-sheet (this machine)

- Tools live under Homebrew: `export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:$PATH"`.
- Postgres auto-runs (brew service). Connect: `psql "postgresql://postgres:mysecretpassword@localhost:5432/meridian"`.
  Local DB holds ~160 test articles (status NEW). `TRUNCATE ingested_items;` to reset.
- Run the Worker locally: from `apps/backend`,
  `WRANGLER_SEND_METRICS=false WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://postgres:mysecretpassword@localhost:5432/meridian" pnpm exec wrangler dev --port 8787`
- Installed this session: `gh` (gpg pieratka), `gcloud` (pierre@atka.io), `postgresql@16`, `pgvector`.
- Gitignored local config (NOT committed, exist on disk): `apps/backend/.dev.vars`, `packages/database/.env`.

## Open quality issues found (not yet fixed) — backlog

- ~~ML `/embeddings` missing e5 `passage:`/`query:` prefix.~~ Resolved — dropped e5 for Gemini
  `gemini-embedding-001` (`taskType: 'CLUSTERING'`), which conditions the embedding natively.
- Notebook cell 10 references `study.best_trial.params` (optuna) while cell 8 is a manual grid search
  — clean up when productionizing the brief job.
- `content_body_text` truncated to ~10KB in DB (full copy in R2 `content_body_r2_key`).
