#!/usr/bin/env bash
set -euo pipefail
umask 077
directory=/var/backups/alsj_booking
mkdir -p "$directory"
filename="$directory/alsj-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'if [ -f "$filename.partial" ]; then unlink "$filename.partial"; fi' EXIT
docker exec pg pg_dump -U alsj -d alsj --no-owner --format=custom > "$filename.partial"
mv "$filename.partial" "$filename"
find "$directory" -maxdepth 1 -name 'alsj-????????T??????Z.dump' -type f -mtime +14 -delete
printf 'PostgreSQL backup completed: %s\n' "$filename"
