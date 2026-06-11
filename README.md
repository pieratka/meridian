# Meridian — Personal Intelligence Briefing

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

A personal "intelligence agency": scrape RSS sources → summarize + embed each article with an LLM →
cluster related stories → synthesize a daily intelligence brief → browse it in a web UI.

This is a **single, self-contained Python app** (Flask web UI + a stage-based CLI), deployed as **one
container on Fly.io** with **SQLite on a volume**. No Cloudflare, no separate ML service, no vector DB.

## Lineage

- Concept and prompts originate from [`iliane5/meridian`](https://github.com/iliane5/meridian) (MIT).
- This codebase is re-based on [`lfzawacki/meridiano`](https://github.com/lfzawacki/meridiano) (AGPL-3.0),
  a single-container re-implementation. Because we vendor that code, **this project is AGPL-3.0** (see `LICENSE`).
- Our changes: LLM/embeddings routed to **Google Gemini** via liteLLM, our RSS feed set, and a Fly.io
  deployment (one machine running the web app + a daily in-container cron).

## How it works

`run_briefing.py` orchestrates four stages (run individually or together with `--all`):

1. **scrape** — fetch RSS, extract article text (`trafilatura`) + a representative image, store in SQLite.
2. **process** — LLM summary + embedding per article.
3. **rate** — LLM assigns a 1–10 impact score.
4. **generate** — cluster recent articles (KMeans, in-memory), analyze each cluster, synthesize the brief.

`app.py` (Flask) serves the briefs and articles with full-text search.

## Tech stack

- Python 3.13, Flask + gunicorn, SQLModel over **SQLite** (or Postgres)
- **liteLLM** → Google Gemini (`gemini-2.0-flash` for text, `gemini-embedding-001` for embeddings)
- `feedparser`, `trafilatura`, `scikit-learn` (KMeans), `numpy`

## Quick start (local)

```bash
uv sync
cp .env.example .env          # set GEMINI_API_KEY (models default to Gemini)
uv run python -m meridiano.run_briefing --feed default --all   # scrape → … → brief
uv run gunicorn --bind 0.0.0.0:5000 meridiano.app:app          # browse at localhost:5000
```

Feeds are plain Python in `src/meridiano/feeds/<profile>.py` (each exports `RSS_FEEDS`).

## Deploy (Fly.io)

```bash
fly launch --no-deploy
fly volumes create data --size 1
fly secrets set GEMINI_API_KEY=... FLASK_SECRET_KEY=...
fly deploy
```

One machine runs gunicorn (web) plus `supercronic`, which fires the daily brief at 06:00 UTC
(`docker/crontab`). See `fly.toml` and `docker/`.
