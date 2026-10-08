#!/usr/bin/env bash
set -euo pipefail
# Run as a sudo-capable Docker account after uploading the release archive.
release_id=$(date -u +%Y%m%dT%H%M%SZ)
release=/opt/alsj_booking/releases/$release_id
sudo mkdir -p "$release"
sudo tar -xzf /tmp/alsj-booking-release.tar.gz -C "$release"
sudo chown -R "$(id -un):$(id -gn)" "$release"
sudo install -d -o 1000 -g 1000 -m 700 /var/lib/alsj_booking /var/backups/alsj_booking
sudo python3 - <<'PY'
from pathlib import Path
import secrets, os
p=Path('/var/lib/alsj_booking/.env')
s=p.read_text() if p.exists() else ''
keys={line.split('=',1)[0] for line in s.splitlines() if '=' in line}
if 'DATABASE_URL' not in keys:
    raise SystemExit('Configure DATABASE_URL in /var/lib/alsj_booking/.env before deployment')
if 'GM_PASSWORD' not in keys: s+='\nGM_PASSWORD='+secrets.token_urlsafe(24)+'\n'
if 'NPC_PASSWORD' not in keys: s+='\nNPC_PASSWORD='+secrets.token_urlsafe(32)+'\n'
p.write_text(s)
os.chmod(p,0o600);os.chown(p,1000,1000)
PY
cd "$release"
if ! docker image inspect node:24.21.0-bookworm-slim >/dev/null 2>&1; then
    docker pull node:24.21.0-bookworm-slim
fi
# The default daemon builder can reuse the images already pulled on this host.
export BUILDX_BUILDER=default
docker tag node:24.21.0-bookworm-slim alsj-node:24.21.0
export ALSJ_NODE_IMAGE=alsj-node:24.21.0
printf 'ALSJ_RELEASE=%s\nALSJ_NODE_IMAGE=%s\n' "$release_id" "$ALSJ_NODE_IMAGE" > deployment/.env
export ALSJ_RELEASE="$release_id"
docker compose -f deployment/compose.yaml build
docker compose -f deployment/compose.yaml up -d
for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:3206/api/public >/dev/null; then break; fi
    sleep 1
done
curl -fsS http://127.0.0.1:3206/api/public >/dev/null
sudo ln -sfn "$release" /opt/alsj_booking/current
sudo mkdir -p /var/www/alsj-acme
if [ -f /etc/nginx/conf.d/alsj.luna.ski.conf ]; then
    sudo cp /etc/nginx/conf.d/alsj.luna.ski.conf /etc/nginx/conf.d/alsj.luna.ski.conf.backup."$release_id"
fi
sudo tee /etc/nginx/conf.d/alsj.luna.ski.conf >/dev/null <<'NGINX'
server {
    listen 80;
    server_name alsj.luna.ski;
    location /.well-known/acme-challenge/ { root /var/www/alsj-acme; }
    location / {
        proxy_pass http://127.0.0.1:3206;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/alsj-acme -d alsj.luna.ski --non-interactive --agree-tos --register-unsafely-without-email --deploy-hook 'systemctl reload nginx'
sudo install -m 644 deployment/alsj.luna.ski.conf /etc/nginx/conf.d/alsj.luna.ski.conf
sudo nginx -t
sudo systemctl reload nginx
sudo install -m 755 deployment/backup-postgres.sh /opt/alsj_booking/backup-postgres.sh
sudo install -m 644 deployment/alsj-backup.service deployment/alsj-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alsj-backup.timer
sudo systemctl start alsj-backup.service
docker compose -f deployment/compose.yaml ps
printf 'Deployed Docker release: %s\n' "$release_id"
