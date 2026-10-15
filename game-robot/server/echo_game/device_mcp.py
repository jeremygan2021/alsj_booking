"""Bounded MCP client carried over the already authenticated device WebSocket.

Only the device receive loop consumes messages. RPC callers await matching IDs;
no timeout retries a hardware command because its outcome may be unknown.
"""
from __future__ import annotations

import asyncio
import json
from async_timeout import timeout as async_timeout

STATUS = "self.get_device_status"
VOLUME = "self.audio_speaker.set_volume"
ALLOWED_TOOLS = frozenset((STATUS, VOLUME))


class McpError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def object_json(text):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate field")
            value[key] = item
        return value
    value = json.loads(text, object_pairs_hook=unique)
    if not isinstance(value, dict):
        raise ValueError("expected an object")
    return value


class DeviceMcpClient:
    def __init__(self, send, status_changed, *, timeout=5.0):
        self.send, self.status_changed = send, status_changed
        self.timeout = timeout
        self.pending = {}
        self.next_id = 0
        self.closed = False
        self.started = False
        self.ready = asyncio.Event()
        self.tools = set()
        self.setup_task = None
        self.setup_error = None

    def start(self):
        if not self.started and not self.closed:
            self.started = True
            self.setup_task = asyncio.create_task(self._initialize())

    async def _initialize(self):
        try:
            await self.request("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                "clientInfo": {"name": "echo-game-volume", "version": "1.0"}})
            await self.send({"type": "mcp", "payload": {"jsonrpc": "2.0", "method": "notifications/initialized"}})
            cursor, cursors = None, set()
            for _ in range(16):
                page = await self.request("tools/list", {"cursor": cursor} if cursor else {})
                entries = page.get("tools")
                if not isinstance(entries, list) or len(entries) > 128:
                    raise McpError("invalid_response", "Device returned invalid MCP tool discovery")
                for entry in entries:
                    if isinstance(entry, dict) and entry.get("name") in ALLOWED_TOOLS:
                        self.tools.add(entry["name"])
                cursor = page.get("nextCursor")
                if cursor in (None, ""):
                    break
                if not isinstance(cursor, str) or len(cursor) > 256 or cursor in cursors:
                    raise McpError("invalid_response", "Device returned invalid MCP pagination")
                cursors.add(cursor)
            else:
                raise McpError("tool_limit", "Device MCP discovery exceeded the page limit")
            self.ready.set()
            if STATUS in self.tools:
                try:
                    await self.call(STATUS, {})
                except McpError:
                    pass  # Optional initial status failure must not poison discovery.
        except asyncio.CancelledError:
            raise
        except McpError as exc:
            self.setup_error = exc
        except Exception:
            self.setup_error = McpError("unavailable", "Device MCP initialization failed")
        finally:
            self.ready.set()

    async def request(self, method, params):
        if self.closed:
            raise McpError("disconnected", "Device disconnected")
        if len(self.pending) >= 8:
            raise McpError("busy", "Too many pending device requests")
        self.next_id += 1
        request_id = self.next_id
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        try:
            async with async_timeout(self.timeout):
                await self.send({"type": "mcp", "payload": {"jsonrpc": "2.0", "id": request_id,
                    "method": method, "params": params}})
                return await asyncio.shield(future)
        except asyncio.TimeoutError:
            raise McpError("timeout", "Device acknowledgement timed out; the command may have executed; do not automatically repeat it") from None
        except asyncio.CancelledError:
            raise
        except McpError:
            raise
        except Exception:
            raise McpError("disconnected", "Device request could not be delivered; execution is unknown") from None
        finally:
            self.pending.pop(request_id, None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()  # Retrieve a disconnect result during caller cancellation.

    def receive(self, message):
        payload = message.get("payload")
        if not isinstance(payload, dict) or payload.get("jsonrpc") != "2.0" or type(payload.get("id")) is not int:
            return
        future = self.pending.get(payload["id"])
        if future is None or future.done():
            return
        if "error" in payload:
            future.set_exception(McpError("device_error", "Device rejected the MCP request"))
        elif isinstance(payload.get("result"), dict):
            future.set_result(payload["result"])
        else:
            future.set_exception(McpError("invalid_response", "Device returned an invalid MCP result"))

    async def call(self, name, arguments):
        if name not in ALLOWED_TOOLS:
            raise McpError("forbidden", "Device tool is not permitted")
        if not self.started or self.closed:
            raise McpError("unavailable", "Device MCP is not available")
        try:
            await asyncio.wait_for(self.ready.wait(), self.timeout)
        except asyncio.TimeoutError:
            raise McpError("not_ready", "Device MCP discovery is not ready") from None
        if self.setup_error:
            raise self.setup_error
        if name not in self.tools:
            raise McpError("unsupported", "Device does not expose the requested tool")
        result = await self.request("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError") is True:
            raise McpError("device_error", "Device reported that the action failed")
        content = result.get("content")
        if not isinstance(content, list) or len(content) != 1 or not isinstance(content[0], dict):
            raise McpError("invalid_response", "Device did not provide a structured action result")
        item = content[0]
        if item.get("type") != "text" or not isinstance(item.get("text"), str):
            raise McpError("invalid_response", "Device did not provide a JSON text result")
        try:
            value = object_json(item["text"])
        except (ValueError, RecursionError):
            raise McpError("unconfirmed", "Device did not confirm the actual setting; firmware may require an update") from None
        if name == STATUS:
            self.status_changed(value)
        return value

    async def close(self):
        self.closed = True
        self.ready.set()
        for future in self.pending.values():
            if not future.done():
                future.set_exception(McpError("disconnected", "Device disconnected; pending action outcome is unknown"))
        if self.setup_task:
            self.setup_task.cancel()
            await asyncio.gather(self.setup_task, return_exceptions=True)
