FROM python:3.13-slim-bookworm

# uv for fast, reproducible installs
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# supercronic: a lightweight cron designed for containers. Runs the daily brief
# in the same machine as the web app (required: SQLite lives on a single Fly volume).
ARG SUPERCRONIC_VERSION=v0.2.33
# TARGETARCH is provided automatically by buildx (amd64/arm64); default for plain builds.
ARG TARGETARCH=amd64
ADD https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH} /usr/local/bin/supercronic
RUN chmod +x /usr/local/bin/supercronic

WORKDIR /app
COPY . .
RUN uv sync --no-dev --frozen

RUN chmod +x docker/entrypoint.sh
EXPOSE 5000
ENTRYPOINT ["docker/entrypoint.sh"]
