#!/bin/sh
# Brings the database in line with lib/db/schema.ts. Runs automatically as the
# "migrate" service on every `docker compose up`; outside Docker use `npm run db:sync`.
#   1. If the schema changed since the last migration, write a new migration into ./drizzle
#   2. Apply every migration the database hasn't run yet
set -eu
cd "$(dirname "$0")/.."

echo "[db] checking lib/db/schema.ts for changes"
if ! ./node_modules/.bin/drizzle-kit generate --name "schema_$(date -u +%Y%m%d%H%M%S)" </dev/null; then
  echo "[db] Could not generate the migration automatically." >&2
  echo "[db] If you renamed a table or column, run 'npm run db:generate' on your machine to answer drizzle-kit's questions, then start again." >&2
  exit 1
fi

echo "[db] applying migrations"
if [ -f .env ]; then node --env-file=.env scripts/migrate.mjs; else node scripts/migrate.mjs; fi
