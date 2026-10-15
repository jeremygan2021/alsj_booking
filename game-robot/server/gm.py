#!/usr/bin/env python3
"""Local GM controls; reads a token from environment/.env, never from argv."""
import argparse
import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from dotenv import load_dotenv


def main():
    parser = argparse.ArgumentParser(description="ECHO档案助理主持人控制")
    parser.add_argument("--url")
    parser.add_argument("--env-file", default=".env")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("state", help="查看幕数和证据目录")
    change = sub.add_parser("set", help="更新幕数/向所有在场玩家公开证据")
    change.add_argument("--phase", type=int, choices=range(1, 5))
    change.add_argument("--release", action="append", default=[])
    change.add_argument("--hide", action="append", default=[])
    sub.add_parser("reset", help="新一场游戏：第一幕，撤回公开目录")
    question = sub.add_parser("ask", help="文字试问当前权限的模型，使用云服务")
    question.add_argument("text")
    args = parser.parse_args()
    load_dotenv(args.env_file)
    args.url = args.url or os.environ.get("ECHO_API_URL", "https://alsj.luna.ski/echo")
    token = os.environ.get("ECHO_GM_TOKEN", "")
    if not token:
        parser.error("请先配置 ECHO_GM_TOKEN")

    def request(path, method="GET", body=None):
        encoded = json.dumps(body).encode() if body is not None else None
        req = Request(args.url.rstrip("/") + path, data=encoded, method=method,
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urlopen(req, timeout=50) as response:
            return json.load(response)

    try:
        if args.command == "ask":
            result = request("/api/gm/ask", "POST", {"text": args.text})
        elif args.command == "state":
            result = request("/api/gm/state")
        else:
            state = request("/api/gm/state")["state"]
            if args.command == "reset":
                state.update(phase=1, released_evidence=[])
            else:
                if args.phase is not None:
                    state["phase"] = args.phase
                state["released_evidence"] = sorted((set(state["released_evidence"]) |
                    set(args.release)) - set(args.hide))
            result = request("/api/gm/state", "PUT", state)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except HTTPError as exc:
        print(f"请求失败 HTTP {exc.code}: {exc.read(4096).decode(errors='replace')}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
