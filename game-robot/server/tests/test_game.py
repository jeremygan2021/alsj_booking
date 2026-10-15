import asyncio
import base64
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from echo_game.audio import OpusDecoder, OpusEncoder
from echo_game.config import Settings
from echo_game.main import create_app
from echo_game.story import GameState, Story
from echo_game.knowledge import TOOLS, CaseKnowledge

ROOT = Path(__file__).resolve().parents[3]
STORY = ROOT / "server/story-materials.json"
DEVICE = "d" * 24
GM = "g" * 32


class FakeProvider:
    instances = []

    def __init__(self, settings):
        self.settings = settings
        self.queue = asyncio.Queue()
        self.sent = []
        self.closed = False
        self.__class__.instances.append(self)

    async def connect(self, tools):
        assert tools == TOOLS

    async def send(self, event):
        self.sent.append(event)
        if event["type"] == "input_audio_buffer.append":
            await self.response()
        elif event["type"] == "response.create":
            await self.response()

    async def response(self):
        number = sum(e["type"] in {"input_audio_buffer.append", "response.create"} for e in self.sent)
        rid = f"reply-{number}"
        for event in [
            {"type": "input_audio_buffer.speech_stopped"},
            {"type": "conversation.item.input_audio_transcription.completed", "transcript": "你是谁？"},
            {"type": "response.created", "response": {"id": rid}},
            {"type": "response.audio_transcript.done", "response_id": rid,
             "transcript": "我是ECHO档案助理。你想了解哪位来宾？"},
            {"type": "response.audio.delta", "response_id": rid,
             "delta": base64.b64encode(bytes(2880)).decode()},
            {"type": "response.done", "response": {"id": rid, "status": "completed"}},
        ]:
            await self.queue.put(event)

    async def events(self):
        while True:
            yield await self.queue.get()

    async def close(self):
        self.closed = True


class ToolProvider(FakeProvider):
    async def send(self, event):
        self.sent.append(event)
        if event["type"] == "input_audio_buffer.append":
            call = dict(type="function_call", call_id="case-call", name="get_case_evidence",
                        arguments='{"evidence_id":"E-13"}')
            for item in [
                {"type": "input_audio_buffer.speech_stopped"},
                {"type": "response.created", "response": {"id": "tool-first"}},
                {"type": "response.function_call_arguments.done", "response_id": "tool-first", **{k: v for k, v in call.items() if k != "type"}},
                {"type": "response.done", "response": {"id": "tool-first", "status": "completed", "output": [call]}},
            ]:
                await self.queue.put(item)
        elif event["type"] == "response.create":
            await self.response()


class GameTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name) / "state.json"
        self.settings = Settings(_env_file=None, device_token=DEVICE, gm_token=GM,
                                 story_file=STORY, state_file=self.state)
        self.app = create_app(self.settings, FakeProvider)
        self.headers = {"Authorization": "Bearer " + GM}

    def tearDown(self):
        self.temp.cleanup()

    def test_context_does_not_include_actor_secrets_or_unreleased_evidence(self):
        story = self.app.state.story
        context = story.public_context()
        self.assertNotIn("主持人已开放终局真相", context)
        self.assertNotIn("事件", context)
        self.assertEqual(context["已公开证据"], [])
        for character in context["公开人物"]:
            self.assertEqual(set(character), {"name", "english", "role", "publicBio"})
        payload = json.dumps(context, ensure_ascii=False)
        self.assertNotIn("20:58", payload)
        self.assertNotIn("真正凶手", payload)

    def test_only_gm_can_release_eligible_evidence_and_solution(self):
        with TestClient(self.app) as client:
            self.assertEqual(client.get("/api/gm/state").status_code, 401)
            self.assertEqual(client.get("/api/gm/state", headers={"Authorization": "Bearer " + DEVICE}).status_code, 401)
            proposed = dict(revision=0, phase=1, released_evidence=["E-13"])
            self.assertEqual(client.put("/api/gm/state", headers=self.headers, json=proposed).status_code, 409)
            proposed.update(phase=3)
            self.assertEqual(client.put("/api/gm/state", headers=self.headers, json=proposed).status_code, 200)
            self.assertEqual(client.put("/api/gm/state", headers=self.headers, json=proposed).status_code, 409)
            view = self.app.state.story.public_context()
            self.assertEqual([e["clueId"] for e in view["已公开证据"]], ["E-13"])
            proposed.update(revision=1, reveal_solution=True)
            self.assertEqual(client.put("/api/gm/state", headers=self.headers, json=proposed).status_code, 422)
            del proposed["reveal_solution"]
            proposed.update(phase=4)
            self.assertEqual(client.put("/api/gm/state", headers=self.headers, json=proposed).status_code, 200)
            self.assertNotIn("主持人已开放终局真相", self.app.state.story.public_context())

    def test_persistence_reset_and_unknown_or_duplicate_ids(self):
        story = self.app.state.story
        for ids in (["E-99"], ["E-13", "E-13"]):
            with self.assertRaises(ValueError):
                story.update(GameState(phase=3, released_evidence=ids))
        story.update(GameState(phase=3, released_evidence=["E-13"]))
        restored = Story(STORY, self.state)
        self.assertEqual(restored.state.released_evidence, ["E-13"])
        restored.update(GameState(revision=1))
        self.assertEqual(restored.public_context()["已公开证据"], [])

    def test_text_audition_uses_only_current_context(self):
        with TestClient(self.app) as client:
            response = client.post("/api/gm/ask", headers=self.headers, json={"text": "你是谁？"})
            self.assertEqual(response.status_code, 200)
            self.assertIn("ECHO", response.json()["reply"])
            settings = FakeProvider.instances[-1].settings
            self.assertNotIn("20:58", settings.qwen_instructions)

    @staticmethod
    def hello():
        return dict(type="hello", version=1, transport="websocket", features={"persona_ui": 1,
            "tts_ready": True, "listen_control": True, "playback_finished": True,
            "game_role": "echo-archivist"},
            audio_params=dict(format="opus", sample_rate=16000, channels=1, frame_duration=60))

    def test_voice_round_trip_requires_ready_and_played_before_resume(self):
        with TestClient(self.app) as client:
            with client.websocket_connect("/ws/device", headers={"Authorization": "Bearer " + DEVICE}) as ws:
                ws.send_json(self.hello())
                hello = ws.receive_json()
                sid = hello["session_id"]
                ws.send_json(dict(type="listen", state="start", session_id=sid))
                self.assertEqual(ws.receive_json()["state"], "listening")
                with OpusEncoder(16000) as encoder:
                    ws.send_bytes(encoder.encode(bytes(1920)))
                audio_seen = False
                stop_seen = False
                while True:
                    message = ws.receive()
                    if message.get("bytes") is not None:
                        with OpusDecoder(24000) as decoder:
                            self.assertEqual(len(decoder.decode(message["bytes"])), 2880)
                        audio_seen = True
                        continue
                    data = json.loads(message["text"])
                    if data["type"] == "tts" and data["state"] == "start":
                        ws.send_json(dict(type="tts.ready", session_id=sid, response_id=data["response_id"]))
                    if data["type"] == "tts" and data["state"] == "stop":
                        self.assertTrue(audio_seen)
                        stop_seen = True
                        ws.send_json(dict(type="tts.played", session_id=sid, response_id=data["response_id"]))
                    if data["type"] == "listen.control":
                        self.assertTrue(stop_seen)
                        ws.send_json(dict(type="listen", state="start", session_id=sid, response_id="stale"))
                        ws.send_json(dict(type="listen", state="start", session_id=sid, response_id=data["response_id"]))
                        self.assertEqual(ws.receive_json()["state"], "listening")
                        ws.send_json(dict(type="conversation.end", session_id=sid))
                        break
        self.assertTrue(FakeProvider.instances[-1].closed)

    def test_game_state_change_disconnects_live_history(self):
        with TestClient(self.app) as client:
            with client.websocket_connect("/ws/device", headers={"Authorization": "Bearer " + DEVICE}) as ws:
                ws.send_json(self.hello())
                ws.receive_json()
                result = client.put("/api/gm/state", headers=self.headers, json={"revision": 0, "phase": 2})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(ws.receive()["type"], "websocket.close")
                # A real peer completes the server's close handshake. TestClient
                # otherwise cancels its scope without notifying the receive loop.
                ws.close(code=1012)
                provider = FakeProvider.instances[-1]
                async def wait_for_retirement():
                    for _ in range(100):
                        if provider.closed:
                            return
                        await asyncio.sleep(.01)
                    raise AssertionError("Old game history was not retired")
                client.portal.call(wait_for_retirement)

    def test_continuous_dialogue_and_abort_release_provider(self):
        with TestClient(self.app) as client:
            with client.websocket_connect("/ws/device", headers={"Authorization": "Bearer " + DEVICE}) as ws:
                ws.send_json(self.hello())
                sid = ws.receive_json()["session_id"]
                ws.send_json(dict(type="listen", state="start", session_id=sid))
                self.assertEqual(ws.receive_json()["state"], "listening")
                with OpusEncoder(16000) as encoder:
                    packet = encoder.encode(bytes(1920))
                ids = []
                for turn in range(2):
                    ws.send_bytes(packet)
                    while True:
                        message = ws.receive()
                        if message.get("bytes") is not None:
                            continue
                        data = json.loads(message["text"])
                        if data["type"] == "tts" and data["state"] == "start":
                            ids.append(data["response_id"])
                            ws.send_json(dict(type="tts.ready", session_id=sid, response_id=data["response_id"]))
                        elif data["type"] == "tts" and data["state"] == "stop":
                            ws.send_json(dict(type="tts.played", session_id=sid, response_id=data["response_id"]))
                        elif data["type"] == "listen.control":
                            ws.send_json(dict(type="listen", state="start", session_id=sid, response_id=data["response_id"]))
                            self.assertEqual(ws.receive_json()["state"], "listening")
                            break
                self.assertEqual(len(set(ids)), 2)
                ws.send_json(dict(type="abort", session_id=sid))
                self.assertEqual(ws.receive()["type"], "websocket.close")
        provider = FakeProvider.instances[-1]
        self.assertTrue(provider.closed)
        self.assertEqual(sum(e["type"] == "input_audio_buffer.clear" for e in provider.sent), 3)

    def test_function_call_queries_backend_then_resumes_only_after_answer(self):
        app = create_app(self.settings, ToolProvider)
        with TestClient(app) as client:
            with client.websocket_connect("/ws/device", headers={"Authorization": "Bearer " + DEVICE}) as ws:
                ws.send_json(self.hello())
                sid = ws.receive_json()["session_id"]
                ws.send_json(dict(type="listen", state="start", session_id=sid))
                ws.receive_json()
                with OpusEncoder(16000) as encoder:
                    ws.send_bytes(encoder.encode(bytes(1920)))
                starts = []
                queried = False
                while True:
                    message = ws.receive()
                    if message.get("bytes") is not None:
                        continue
                    data = json.loads(message["text"])
                    if data["type"] == "tts" and data["state"] == "start":
                        starts.append(data["response_id"])
                        ws.send_json(dict(type="tts.ready", session_id=sid, response_id=data["response_id"]))
                    elif data["type"] == "tts" and data["state"] == "stop":
                        ws.send_json(dict(type="tts.played", session_id=sid, response_id=data["response_id"]))
                    elif data["type"] == "persona.state" and data["state"] == "tool":
                        queried = True
                    elif data["type"] == "listen.control":
                        self.assertTrue(queried)
                        self.assertEqual(starts, ["tool-first", "reply-2"])
                        self.assertEqual(data["response_id"], "reply-2")
                        ws.send_json(dict(type="conversation.end", session_id=sid))
                        break
        outputs = [e["item"] for e in ToolProvider.instances[-1].sent if e["type"] == "conversation.item.create"]
        self.assertEqual(len(outputs), 1)
        self.assertEqual(json.loads(outputs[0]["output"])["error"], "not_available")

    def test_original_firmware_and_wrong_device_token_are_rejected(self):
        with TestClient(self.app) as client:
            with self.assertRaises(Exception):
                with client.websocket_connect("/ws/device", headers={"Authorization": "Bearer invalid"}):
                    pass
            with client.websocket_connect("/ws/device", headers={"Authorization": "Bearer " + DEVICE}) as ws:
                hello = self.hello()
                del hello["features"]["game_role"]
                ws.send_json(hello)
                self.assertEqual(ws.receive_json()["state"], "error")
                self.assertEqual(ws.receive()["type"], "websocket.close")


if __name__ == "__main__":
    unittest.main()
