import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from echo_game.audio import OpusEncoder
from echo_game.device import SessionTools, VOLUME_TOOLS
from echo_game.device_mcp import McpError, STATUS, VOLUME
from echo_game.knowledge import CaseKnowledge, TOOLS
from echo_game.main import create_app
from echo_game.story import Story
import test_game as game
from test_game import FakeProvider, DEVICE

STORY = Path(__file__).resolve().parents[3] / "server/story-materials.json"


class VolumePeer:
    def __init__(self, tools):
        self.tools, self.volume = tools, 35
        self.calls = []
        self.confirm = True
        self.drop = False

    async def send(self, event):
        request = event["payload"]
        if "id" not in request:
            return
        method = request["method"]
        if method == "initialize":
            result = {"protocolVersion": "2024-11-05"}
        elif method == "tools/list":
            result = {"tools": [{"name": n} for n in [STATUS, VOLUME, "self.reboot", "self.screen.set_brightness"]]}
        else:
            name, arguments = request["params"]["name"], request["params"]["arguments"]
            self.calls.append((name, arguments))
            if name == STATUS:
                value = {"audio_speaker": {"volume": self.volume}}
            else:
                self.volume = arguments["volume"]
                if self.drop:
                    return
                value = {"volume": self.volume, "applied": self.confirm}
            result = {"content": [{"type": "text", "text": json.dumps(value)}]}
        self.tools.mcp.receive({"payload": {"jsonrpc": "2.0", "id": request["id"], "result": result}})


class VolumeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        story = Story(STORY, Path(self.temp.name) / "state.json")
        self.tools = SessionTools(CaseKnowledge(story), lambda event: self.peer.send(event), True)
        self.peer = VolumePeer(self.tools)
        self.tools.mcp.timeout = .05
        self.tools.mcp.start()
        await self.tools.mcp.setup_task

    async def asyncTearDown(self):
        await self.tools.mcp.close()
        self.temp.cleanup()

    async def test_relative_uses_fresh_volume_clamps_and_confirms(self):
        self.peer.volume = 55  # A local screen change after discovery.
        self.assertEqual(await self.tools.execute("adjust_volume", '{"delta":-10}'),
                         {"ok": True, "applied": True, "volume": 45})
        self.assertEqual((await self.tools.execute("adjust_volume", '{"delta":100}'))["volume"], 100)
        self.assertEqual((await self.tools.execute("set_volume", '{"volume":0}'))["volume"], 0)
        self.assertEqual((await self.tools.execute("get_volume", '{}'))["volume"], 0)
        self.assertEqual(self.tools.mcp.tools, {STATUS, VOLUME})
        with self.assertRaises(McpError):
            await self.tools.mcp.call("self.reboot", {})

    async def test_invalid_or_unknown_calls_never_touch_device(self):
        before = len(self.peer.calls)
        for raw in ('{"volume":true}', '{"volume":101}', '{"volume":-1}',
                    '{"volume":50.0}', '{"volume":50,"extra":1}', '{"volume":40,"volume":50}'):
            self.assertFalse((await self.tools.execute("set_volume", raw))["ok"])
        self.assertFalse((await self.tools.execute("drive_car_low_speed", '{}'))["ok"])
        self.assertEqual(before, len(self.peer.calls))

    async def test_unconfirmed_timeout_disconnect_never_report_success_or_retry(self):
        self.peer.confirm = False
        self.assertEqual((await self.tools.execute("set_volume", '{"volume":40}'))["error"], "unconfirmed")
        self.peer.drop = True
        result = await self.tools.execute("set_volume", '{"volume":45}')
        self.assertFalse(result["ok"])
        self.assertIsNone(result["applied"])
        self.assertEqual(result["error"], "timeout")
        self.assertEqual(sum(name == VOLUME for name, _ in self.peer.calls), 2)
        await self.tools.mcp.close()
        self.assertFalse((await self.tools.execute("set_volume", '{"volume":50}'))["ok"])


class VolumeProvider(FakeProvider):
    async def connect(self, tools):
        assert tools == TOOLS + VOLUME_TOOLS

    async def send(self, event):
        self.sent.append(event)
        if event["type"] == "input_audio_buffer.append":
            call = {"type": "function_call", "call_id": "volume-1", "name": "adjust_volume", "arguments": '{"delta":-10}'}
            for item in [
                {"type": "input_audio_buffer.speech_stopped"},
                {"type": "response.created", "response": {"id": "volume-call"}},
                {"type": "response.done", "response": {"id": "volume-call", "status": "completed", "output": [call]}}
            ]:
                await self.queue.put(item)
        elif event["type"] == "response.create":
            await self.response()


class VolumeRoundTripTests(unittest.TestCase):
    def test_legacy_game_mcp_false_receives_rpc_and_model_gets_actual_volume(self):
        setup = game.GameTests()
        setup.setUp()
        try:
            with TestClient(create_app(setup.settings, VolumeProvider)) as client:
                with client.websocket_connect("/ws/device", headers={"Authorization": "Bearer " + DEVICE}) as ws:
                    hello = game.GameTests.hello()
                    hello["features"]["mcp"] = False  # Actual 1.0.0-game compatibility.
                    ws.send_json(hello)
                    sid = ws.receive_json()["session_id"]
                    volume, calls, answered = 55, [], False
                    ws.send_json({"type": "listen", "state": "start", "session_id": sid})
                    with OpusEncoder(16000) as encoder:
                        packet = encoder.encode(bytes(1920))
                    while True:
                        message = ws.receive()
                        if message.get("bytes") is not None:
                            continue
                        data = json.loads(message["text"])
                        kind = data["type"]
                        if kind == "persona.state" and data.get("state") == "listening":
                            ws.send_bytes(packet)
                        elif kind == "mcp":
                            p = data["payload"]
                            if "id" not in p:
                                continue
                            if p["method"] == "initialize":
                                result = {}
                            elif p["method"] == "tools/list":
                                result = {"tools": [{"name": name} for name in (STATUS, VOLUME)]}
                            else:
                                name, args = p["params"]["name"], p["params"]["arguments"]
                                calls.append(name)
                                if name == STATUS:
                                    value = {"audio_speaker": {"volume": volume}}
                                else:
                                    self.assertEqual(args, {"volume": 45})
                                    volume = args["volume"]
                                    value = {"volume": volume, "applied": True}
                                    # Wrong session must not release the pending action.
                                    ws.send_json({"type": "mcp", "session_id": "stale", "payload": {
                                        "jsonrpc": "2.0", "id": p["id"], "result": {}}})
                                result = {"content": [{"type": "text", "text": json.dumps(value)}]}
                            ws.send_json({"type": "mcp", "session_id": sid, "payload": {
                                "jsonrpc": "2.0", "id": p["id"], "result": result}})
                        elif kind == "tts":
                            if data["state"] == "start":
                                ws.send_json({"type": "tts.ready", "session_id": sid, "response_id": data["response_id"]})
                            elif data["state"] == "stop":
                                ws.send_json({"type": "tts.played", "session_id": sid, "response_id": data["response_id"]})
                        elif kind == "listen.control":
                            answered = True
                            ws.send_json({"type": "conversation.end", "session_id": sid})
                            break
                    self.assertTrue(answered)
                    self.assertEqual(calls.count(VOLUME), 1)
            provider = VolumeProvider.instances[-1]
            output = next(e["item"]["output"] for e in provider.sent if e["type"] == "conversation.item.create")
            self.assertEqual(json.loads(output), {"ok": True, "applied": True, "volume": 45})
        finally:
            setup.tearDown()
