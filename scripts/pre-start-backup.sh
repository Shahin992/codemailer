#!/bin/sh
# Run by the "backup" service on every `docker compose up`, before "migrate": saves the whole database to
# ./backups/auto-before-start-<time>.sql.gz and keeps the newest 10, so a migration never runs without a
# fresh backup. Restore one with:
#   gunzip -c backups/auto-before-start-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
set -eu
set -o pipefail

mkdir -p /backups
file="/backups/auto-before-start-$(date -u +%Y%m%d-%H%M%S).sql.gz"
pg_dump --clean --if-exists | gzip > "$file.part"
mv "$file.part" "$file"
# Runs as root inside the container; hand the files to the server's user so its own scripts can manage them.
chown "$BACKUP_OWNER" /backups "$file"
ls -1t /backups/auto-before-start-*.sql.gz | tail -n +11 | while read -r old; do rm -f -- "$old"; done
echo "[backup] saved $file ($(du -h "$file" | cut -f1))"
