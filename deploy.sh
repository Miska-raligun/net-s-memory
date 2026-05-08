#!/usr/bin/env bash
# One-click deploy for net-s-memory.
#
# What it does:
#   1. Verifies docker + docker compose v2 are installed.
#   2. Generates infra/deploy.env on first run with random secrets.
#   3. Builds & starts the full stack (postgres+pgvector / redis / minio /
#      api / web) with restart=unless-stopped.
#   4. Waits for postgres + api to come healthy and runs alembic migrations.
#   5. Prints access URLs and the most useful follow-up commands.
#
# Re-running is safe: an existing deploy.env is preserved, secrets are not
# regenerated, volumes (postgres / minio) survive across runs, and migrations
# are idempotent.

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
COMPOSE_FILE="infra/docker-compose.deploy.yml"
ENV_FILE="infra/deploy.env"
ENV_EXAMPLE="infra/deploy.env.example"

# Print helpers
say()  { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Sanity checks
command -v docker >/dev/null 2>&1 || fail "docker not installed"
docker compose version >/dev/null 2>&1 \
  || fail "docker compose v2 not installed (try: apt install docker-compose-plugin)"
command -v openssl >/dev/null 2>&1 || fail "openssl not installed"

dc() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# 2. Generate deploy.env on first run
if [ ! -f "$ENV_FILE" ]; then
  say "Generating $ENV_FILE with random secrets…"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  jwt=$(openssl rand -hex 32)
  pg=$(openssl rand -hex 16)
  mn=$(openssl rand -hex 16)
  # portable in-place sed (works on GNU and BSD/macOS)
  sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$jwt|" "$ENV_FILE"
  sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pg|" "$ENV_FILE"
  sed -i.bak "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$mn|" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
  ok  "$ENV_FILE created. Edit it to set LLM_API_KEY / SEARCH_API_KEY / PUBLIC_API_BASE."
else
  ok "$ENV_FILE already exists — keeping it."
fi

mkdir -p keys

# 3. Build + start
say "Building and starting services (this can take a few minutes on first run)…"
dc up -d --build

# 4. Wait for postgres + api
say "Waiting for postgres…"
for _ in $(seq 1 60); do
  if dc exec -T postgres pg_isready -U memory >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
dc exec -T postgres pg_isready -U memory >/dev/null 2>&1 \
  || fail "postgres did not become ready in time. Check 'docker compose -f $COMPOSE_FILE logs postgres'."

say "Running alembic migrations…"
dc exec -T api alembic upgrade head

say "Waiting for api /health…"
for _ in $(seq 1 60); do
  if dc exec -T api curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# 5. Status
api_port=$(grep -E '^API_PORT=' "$ENV_FILE" | cut -d= -f2 || true)
web_port=$(grep -E '^WEB_PORT=' "$ENV_FILE" | cut -d= -f2 || true)
minio_console=$(grep -E '^MINIO_CONSOLE_PORT=' "$ENV_FILE" | cut -d= -f2 || true)
api_port=${api_port:-8000}
web_port=${web_port:-3000}
minio_console=${minio_console:-9001}

ok "Deploy complete."
cat <<EOF

  Web:           http://<server>:$web_port
  API:           http://<server>:$api_port
  MinIO console: http://<server>:$minio_console  (root user / pass from $ENV_FILE)

Follow-up commands:

  # Pull a hot list and produce signed news leaves
  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE \
      exec api python -m app.ingest.run_once zhihu

  # Cluster collected news into events
  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE \
      exec api python -m app.events.run

  # Anchor today's Merkle root into Bitcoin via OpenTimestamps
  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE \
      exec api python -m app.crypto.anchor_run

  # Recompute every user's reputation
  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE \
      exec api python -m app.reputation.run

  # Tail logs
  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f --tail=100

  # Stop everything (data persists in named volumes)
  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE down

EOF

if grep -q '^LLM_API_KEY=$' "$ENV_FILE"; then
  warn "LLM_API_KEY is empty in $ENV_FILE — credibility analysis & followup will be disabled."
fi
if grep -q '^SEARCH_PROVIDER=$' "$ENV_FILE"; then
  warn "SEARCH_PROVIDER is empty — followup tracker (追踪后续) will return 503 until you set it."
fi
