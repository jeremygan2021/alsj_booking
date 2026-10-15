#!/usr/bin/env bash
set -euo pipefail
# Run as root: install.sh /tmp/echo-game.tar.gz RELEASE_ID [/tmp/private-env]
archive=${1:?release archive required}
release_id=${2:?release id required}
[[ $release_id =~ ^[A-Za-z0-9-]+$ ]] || exit 2
base=/opt/alsj-echo-game
release="$base/releases/$release_id"
test ! -e "$release"
install -d -m 755 "$base/releases" "$release"
tar -xzf "$archive" -C "$release" --no-same-owner
chmod -R a+rX "$release"
if ! test -f /etc/alsj-echo-game.env; then
    install -m 600 "${3:?initial private environment required}" /etc/alsj-echo-game.env
fi
if ! test -x "$base/venv/bin/python"; then
    python3 -m venv "$base/venv"
fi
"$base/venv/bin/pip" install -r "$release/server/requirements.txt" > "$release/pip-install.log" 2>&1
"$base/venv/bin/python" -c 'import ctypes.util; assert ctypes.util.find_library("opus")'
old=$(readlink -f "$base/current" || true)
rollback() {
    if [[ -n "$old" && -d "$old" && "$old" != "$base/current" ]]; then
        ln -sfn "$old" "$base/current"
        systemctl restart alsj-echo-game.service || true
    else
        systemctl stop alsj-echo-game.service || true
    fi
}
trap rollback ERR
ln -sfn "$release" "$base/current"
install -m 644 "$release/deploy/alsj-echo-game.service" /etc/systemd/system/alsj-echo-game.service
systemctl daemon-reload
systemctl enable --now alsj-echo-game.service
systemctl restart alsj-echo-game.service
for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8901/healthz > "$release/health.json" 2>/dev/null; then
        trap - ERR
        printf 'ECHO service ready: %s\n' "$release_id"
        exit 0
    fi
    sleep 1
done
false  # Trigger ERR rollback if startup never became healthy.
