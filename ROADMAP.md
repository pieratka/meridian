# Meridian — Path to Production

> Working notes for taking this fork to prod. Started from a clean clone of the
> open-source [`iliane5/meridian`](https://github.com/iliane5/meridian) (upstream commits
> Mar–May 2025). This file tracks the deploy path and the brief-stage rework.

## What it is

A personal "intelligence agency": scrapes RSS sources → extracts + embeds articles →
clusters related stories → LLM-synthesizes a daily intelligence brief → shows it in a Nuxt UI.

Monorepo (Turborepo / pnpm):

| Unit | Path | Stack | Role |
|---|---|---|---|
| backend | `apps/backend` | CF Workers, Hono, Durable Objects, Queues, Workflows, R2 | scrape, fetch, embed, serve API |
| frontend | `apps/frontend` | Nuxt 3 / Vue 3 / Tailwind | display briefs (CF Pages) |
| briefs | `apps/briefs` | Python | clustering + brief synthesis (**manual / being revived**) |
| database | `packages/database` | Drizzle + Postgres | schema + migrations |
| ml-service | `services/meridian-ml-service` | FastAPI on Fly.io | embeddings (+ optional clustering) |

## Current state (June 2026)

- Ingestion half (scrape → fetch → represent → embed → store) is solid and modern.
- The **brief half was orphaned by the May `v1-candidate` refactor**: per-article rich
  analysis was dropped in favor of cheap representation + embedding, and the orchestration
  notebook (`reportV5.ipynb`, 2140 lines) was deleted in commit `e46c62d`. The remaining
  `events.py`/`llm.py` are just helpers. Reviving this is the gating work (Phase 5 below).

---

## Deployment path

Phases 0–4 are provisioning/config (need *your* accounts + keys). Phase 5 is the real code work.

### Phase 0 — Make it yours
- [ ] Fork to your own GitHub, repoint `origin` (currently points at upstream `iliane5/meridian`).
- [ ] Copy the three `.env.example` → `.env` (`packages/database`, `apps/frontend`, `services/meridian-ml-service`).

### Phase 1 — Database  ✅ (local dev DB)
- [x] **Local Postgres 16 via Homebrew** + **pgvector 0.8.0 built from source for pg16**
      (brew service, auto-starts at login). Role `postgres`/`mysecretpassword`, DB `meridian`.
      `DATABASE_URL` in `packages/database/.env`.
- [x] `migrate` → 5 tables + `vector` extension active.
- [x] **Fixed stale `seed.ts`** (referenced the old `$sources` table; rewrote for `$data_sources`).
      Seeded 5 RSS sources (HN, BBC World, Al Jazeera, NPR, Guardian World).
- [ ] **Prod**: provision cloud Postgres with pgvector (Neon/Supabase) and point prod `DATABASE_URL` at it.

### Phase 2 — ML service (Google Cloud Run)  ⏳ in progress, blocked on billing
Decided on **Cloud Run** instead of Fly (already-owned Google account; existing GCP experience;
the Docker image is Cloud-Run-ready — `python:3.11-slim`, CPU torch, e5-small baked in, uvicorn).
The `fly.toml` is left in place but unused.
- [x] Installed `gcloud` (572.0.0); authenticated as **pierre@atka.io**.
- [ ] **BLOCKER:** pierre@atka.io has **0 projects and 0 billing accounts**. Cloud Run needs a project
      with billing enabled. Prior GCP deploys were likely under a different Google account.
      → User is checking which account has billing before we proceed.
- [ ] Create/select GCP project, set billing.
- [ ] Enable APIs: `run`, `cloudbuild`, `artifactregistry`.
- [ ] Deploy from source (Cloud Build builds the Dockerfile):
      `gcloud run deploy meridian-ml-service --source services/meridian-ml-service \
        --region europe-west1 --port 8080 --memory 1Gi --allow-unauthenticated \
        --set-env-vars API_TOKEN=<strong-token>`
      (`API_TOKEN` must equal the Worker's `MERIDIAN_ML_SERVICE_API_KEY` in Phase 3.)
- [ ] Note the service URL → becomes `MERIDIAN_ML_SERVICE_URL`. Test `/ping` + `/embeddings`.

### Local validation (done) ✅
- Ran the backend Worker via `wrangler dev` against the local `meridian` DB (Hyperdrive override:
  `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`), secrets in `apps/backend/.dev.vars`.
- `POST /do/admin/initialize-dos` → DOs scraped all 5 feeds → **160 real articles ingested**
  (status `NEW`) into `ingested_items`, raw payloads in simulated R2, IDs sent to the local queue.
- **Ingestion half proven end-to-end locally.** Processing (representation + embedding) does NOT run
  locally: Cloudflare **Workflows aren't simulated** (`wrangler dev` binds them to a remote resource),
  and it needs real `GEMINI_API_KEY` + a running ML service. → exercised by Phases 2–3.

### Phase 3 — Backend Worker (Cloudflare) — most config-heavy
- [ ] In `apps/backend/wrangler.jsonc`, replace **the original author's hardcoded resources**:
  - Hyperdrive id `b748bf83...` → create your own Hyperdrive → your Postgres, swap the id.
  - Create the R2 bucket (`meridian-articles-prod`), Queue + DLQ in your account.
- [ ] Set Worker secrets: `API_TOKEN`, `DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_BASE_URL`,
      `MERIDIAN_ML_SERVICE_URL`, `MERIDIAN_ML_SERVICE_API_KEY` (+ `AXIOM_*` if used).
- [ ] Deploy, then `POST /do/admin/initialize-dos` to spin up per-source scrapers.

### Phase 4 — Frontend (CF Pages)
- [ ] Fill `apps/frontend/.env` (DB url, session password ≥32 chars, worker API url, admin creds, worker token).
- [ ] Uncomment the Pages deploy in `.github/workflows/deploy-services.yaml` (currently disabled), or deploy manually.

### Phase 5 — Revive + automate brief generation  ← the real work (see below)

### Phase 6 — CI
- [ ] Add the GitHub Actions secrets the deploy workflow expects so push-to-main auto-migrates + deploys backend.

---

## Phase 5 spec — reviving the brief pipeline

**The seam:** the brief stage needs, per article: the stored `embedding` (clustering) and the
article **text** (cluster-analysis prompts). It does **not** need the old rich per-article
analysis — the deep-analysis prompt (cell 22) feeds the LLM raw article text, not the old summary.
The only true gap was that `/events` didn't return the processed text.

### Changes — status

- [x] **Backend `/events`** (`apps/backend/src/routers/events.router.ts`): now also returns
      `content` (= `content_body_text`), `embeddingText`, `wordCount`.
- [x] **Python Event model** (`apps/briefs/src/events.py`): rewritten to the new `/events` shape
      (dropped 8 dead required fields; embedding now comes from the API). Base URL is
      `MERIDIAN_WORKER_API` (defaults to `http://localhost:8787`).
- [x] **Restored** `apps/briefs/reportV5.ipynb` (+ `reportV5.md` sample) from git (`e46c62d^`).
- [x] **Notebook rewired**:
  - cell 3 — fetch + minimal `articles_df` + `all_embeddings` from stored vectors.
  - cells 5/6 — local re-embedding removed (no more torch/transformers); use stored embeddings.
  - cell 46 — publish endpoint now `MERIDIAN_WORKER_API` env var (was author's worker).
- [ ] **Run end-to-end** against a populated DB; the LLM cluster-review/analysis/brief/tldr cells
      (14, 22, 28–42) should work unchanged once `Event.content` is populated.
- [ ] **Productionize**: convert the notebook into a headless `apps/briefs/src/main.py`
      (fetch → cluster → review → analyze → outline → brief → title → tldr → publish) and schedule it
      (GitHub Action cron / Fly scheduled machine / CF Cron worker). This is "Phase 5" for deploy.

### Known issues found while tracing (not yet fixed)

- **Embedding prefix (quality):** `services/.../main.py` calls `compute_embeddings` **without**
  `e5_prefix`, but multilingual-e5 expects `"passage: "`/`"query: "`. Clustering still works
  (vectors are consistently prefix-less) but quality is suboptimal. Consider passing
  `e5_prefix="passage: "` on the `/embeddings` endpoint.
- **Notebook clustering drift:** cell 10 references `study.best_trial.params` (optuna) but cell 8
  is a manual grid search — `study` is undefined. The hardcoded params below it are what actually
  run; clean this up when productionizing.
- **Content truncation:** `content_body_text` is capped at ~10KB in DB (full copy in
  `content_body_r2_key`). Fine for v1; fetch from R2 if you want full text in analysis.

### Backlog (enhancements, post-revival)

- Cluster **continuity / story tracking** (link today's clusters to yesterday's via centroid
  similarity) — highest product value; `reports.tldr` already exists.
- **Email distribution** — `newsletter` table + MailerLite dep are already scaffolded.
- Near-duplicate **dedup** before clustering (wire copies inflate clusters + cost).
- **More source types** — schema is generalized (`data_sources`, `item_id_from_source`) but only
  `RSS` is implemented. Easy/high-signal next: Reddit/HN, gov feeds, YouTube transcripts.
- Move clustering into a ML-service `/cluster` endpoint (optional; notebook does it locally fine).
