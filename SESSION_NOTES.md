# Session Notes — Meridian to Prod

> Running recap of the work to take this project to production. Pairs with `ROADMAP.md`
> (the plan/checklist). This file is the narrative: what we found, what we decided, what's
> set up on this machine, and exactly how to resume. Last updated: 2026-06-11.

## TL;DR — current status

- **Branch:** `revive-brief-pipeline`. One checkpoint commit: `da3b816`. **Not pushed** to the fork yet.
- **Done:** Phase 0 (fork+repoint), Phase 1 (local DB), brief-pipeline revival (code), local ingestion validated.
- **Paused at:** Phase 2 (ML service → Google Cloud Run), **blocked on GCP billing** (see below).
- **Next blocker to clear (yours):** activate the GCP billing account so it reads `open: true`.

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
  simulated by `wrangler dev`, and it needs a real Gemini key + the ML service. That's Phases 2–3.

### Phase 2 — ML service → Google Cloud Run ⏳ BLOCKED
- Decided Cloud Run over Fly (user has Google accounts + prior GCP experience; the Docker image is
  Cloud-Run-ready). `services/meridian-ml-service/fly.toml` left in place but unused.
- Installed `gcloud` (572.0.0). Authed as **pierre@atka.io**.
- **BLOCKER:** the only billing account on pierre@atka.io (`01AE33-BC587D-3F0CD7`, EUR, org
  `804697887742` = atka.io Workspace) is **`open: false`** — closed/inactive, can't fund a project.
  User couldn't activate it this session. Cloud Run can't deploy without an open billing account.

## How to resume (next session)

1. **Clear the billing blocker** (user): activate billing so `gcloud billing accounts list` shows
   `OPEN: True`. Console: https://console.cloud.google.com/billing/01AE33-BC587D-3F0CD7
   — or log in with a different Google account that already has open billing (`gcloud auth login`),
   or use a personal account.
2. **Then I run Phase 2 (Cloud Run), no further interaction needed:**
   ```bash
   gcloud projects create meridian-<suffix> --set-as-default        # or pick existing
   gcloud billing projects link <project> --billing-account=01AE33-BC587D-3F0CD7
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
   gcloud run deploy meridian-ml-service \
     --source services/meridian-ml-service --region europe-west1 \
     --port 8080 --memory 1Gi --allow-unauthenticated \
     --set-env-vars API_TOKEN=<generate-strong-token>
   # then: curl <url>/ping ; test /embeddings
   ```
   The `API_TOKEN` set here must equal the Worker's `MERIDIAN_ML_SERVICE_API_KEY` in Phase 3.
3. **Phase 3+:** backend Worker on Cloudflare (replace author's hardcoded Hyperdrive/R2/queue IDs),
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

- ML `/embeddings` calls `compute_embeddings` without `e5_prefix`; e5 wants `"passage: "`/`"query: "`.
  Clustering still works (consistently prefix-less) but quality is suboptimal.
- Notebook cell 10 references `study.best_trial.params` (optuna) while cell 8 is a manual grid search
  — clean up when productionizing the brief job.
- `content_body_text` truncated to ~10KB in DB (full copy in R2 `content_body_r2_key`).
