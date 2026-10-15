#!/usr/bin/env python3
"""Add only the game's /echo/ route to the existing HTTPS site; restore on failure."""
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

site = Path("/etc/nginx/conf.d/alsj.luna.ski.conf")
snippet = Path("/etc/nginx/snippets/alsj-echo-game.conf")
source = Path(__file__).with_name("nginx-location.conf")
backup = Path("/var/backups/alsj-echo-game") / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup.mkdir(parents=True, exist_ok=False)
shutil.copy2(site, backup / site.name)
old = site.read_text()
previous_snippet = snippet.read_text() if snippet.exists() else None
try:
    marker = "    include /etc/nginx/snippets/alsj-echo-game.conf;"
    if marker not in old:
        anchor = "    ssl_protocols TLSv1.2 TLSv1.3;"
        if old.count(anchor) != 1 or "location /echo/" in old:
            raise RuntimeError("Review the existing HTTPS site before adding ECHO")
        site.write_text(old.replace(anchor, anchor + "\n" + marker))
    snippet.parent.mkdir(parents=True, exist_ok=True)
    snippet.write_text(source.read_text())
    subprocess.run(["nginx", "-t"], check=True)
    subprocess.run(["systemctl", "reload", "nginx"], check=True)
except BaseException:
    site.write_text(old)
    if previous_snippet is None:
        snippet.unlink(missing_ok=True)
    else:
        snippet.write_text(previous_snippet)
    raise
print("ECHO HTTPS/WebSocket route configured; existing site route preserved")
