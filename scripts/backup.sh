#!/bin/sh
# Back up the database to ./backups (keeps the newest 14). Run from cron, e.g. nightly:
#   0 3 * * * cd /home/ubuntu/coldmailer && sh scripts/backup.sh >> backups/backup.log 2>&1
# Restore a backup:
#   gunzip -c backups/coldmailer-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/coldmailer-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" --clean --if-exists "$POSTGRES_DB"' | gzip > "$file.part"
mv "$file.part" "$file"
ls -1t backups/coldmailer-*.sql.gz | tail -n +15 | while read -r old; do rm -f -- "$old"; done
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) saved $file ($(du -h "$file" | cut -f1))"
