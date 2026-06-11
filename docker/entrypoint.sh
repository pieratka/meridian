#!/usr/bin/env bash
set -euo pipefail

# Create DB tables if they don't exist. gunicorn imports app.py without running its
# __main__ block, so we must initialize the schema here on every boot (idempotent).
.venv/bin/python -c "from meridiano import database; database.init_db()"

# Start the daily-brief cron in the background (output flows to container logs).
/usr/local/bin/supercronic /app/docker/crontab &

# Start the web UI in the foreground. If gunicorn exits, the Fly machine restarts.
exec .venv/bin/gunicorn --bind 0.0.0.0:5000 --workers 2 --timeout 180 meridiano.app:app
