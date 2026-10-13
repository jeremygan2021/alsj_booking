#!/usr/bin/env bash
set -euo pipefail
# Update the existing application only; keep Nginx, certificates and database services.
archive=${1:-/tmp/alsj-booking-release.tar.gz}
previous=$(readlink -f /opt/alsj_booking/current)
test -f "$previous/deployment/.env"
test -f "$archive"
sudo systemctl start alsj-backup.service
release_id=$(date -u +%Y%m%dT%H%M%SZ)
release=/opt/alsj_booking/releases/$release_id
sudo mkdir -p "$release"
sudo tar -xzf "$archive" -C "$release"
sudo chown -R "$(id -un):$(id -gn)" "$release"
cd "$release"
ALSJ_NODE_IMAGE=node:24.21.0-bookworm-slim
if docker image inspect alsj-node:24.21.0 >/dev/null 2>&1; then ALSJ_NODE_IMAGE=alsj-node:24.21.0; fi
printf 'ALSJ_RELEASE=%s\nALSJ_NODE_IMAGE=%s\nALSJ_COMMIT=%s\n' "$release_id" "$ALSJ_NODE_IMAGE" "${ALSJ_COMMIT:-unknown}" > deployment/.env
export BUILDX_BUILDER=default
docker compose --env-file deployment/.env -f deployment/compose.yaml build
rollback() {
  cd "$previous"
  docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --no-build
  printf 'AR update failed; restored previous release: %s\n' "$previous" >&2
}
trap rollback ERR
docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --no-build
healthy=false
for attempt in {1..40}; do
  if curl -fsS http://127.0.0.1:3206/api/ar/demo >/dev/null; then healthy=true; break; fi
  sleep 1
done
test "$healthy" = true
curl -fsS https://alsj.luna.ski/api/ar/demo | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["demo"] and len(d["hotspots"]) == 3'
curl -fsS https://alsj.luna.ski/ar-assets/targets/study-wall.mind -o /tmp/alsj-wall-target-check.mind
test "$(wc -c < /tmp/alsj-wall-target-check.mind)" -gt 1000
curl -fsS https://alsj.luna.ski/ar-assets/models/study-cabinet.glb -o /tmp/alsj-cabinet-check.glb
python3 -c 'from pathlib import Path; assert Path("/tmp/alsj-cabinet-check.glb").read_bytes()[:4] == b"glTF"'
sudo ln -sfn "$release" /opt/alsj_booking/current
trap - ERR
printf 'AR release deployed: %s\nPrevious release: %s\n' "$release_id" "$previous"
