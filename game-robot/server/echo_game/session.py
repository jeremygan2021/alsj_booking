"""Game-only XiaoZhi voice transport; no imports or dispatch into robot code."""
import asyncio
from async_timeout import timeout as async_timeout
import base64
import json
import time
from dataclasses import dataclass, field
from uuid import uuid4

from .audio import OpusDecoder, OpusEncoder, PcmFramer
from .protocol import ProtocolError, parse_json, validate_hello, turn_control_supported
from .providers import QwenProvider
from .knowledge import TOOLS, ToolCalls
from .device import SessionTools, VOLUME_TOOLS, VOLUME_INSTRUCTIONS


@dataclass
class Reply:
    id: str
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=100))
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    played: asyncio.Event = field(default_factory=asyncio.Event)
    framer: PcmFramer = field(default_factory=PcmFramer)
    text: str = ""
    stop_sent: bool = False
    resume: bool = False
    sender: asyncio.Task | None = None
    last_caption: float = 0
    calls: ToolCalls = field(default_factory=ToolCalls)


class GameSession:
    def __init__(self, ws, settings, knowledge, provider_factory=QwenProvider):
        self.ws, self.settings = ws, settings
        self.id = uuid4().hex
        self.provider = provider_factory(settings)
        self.knowledge = knowledge
        self.tools = None
        self.followup = False
        self.tool_rounds = 0
        self.reply = None
        self.listening = False
        self.input_ended = asyncio.Event()
        self.lock = asyncio.Lock()
        self.decoder = OpusDecoder()
        self.tasks = []
        self.failure = asyncio.get_running_loop().create_future()

    def playback_done(self, task):
        if not task.cancelled() and task.exception() and not self.failure.done():
            self.failure.set_exception(task.exception())

    async def send(self, kind, **fields):
        async with self.lock:
            await asyncio.wait_for(self.ws.send_text(json.dumps(
                {"type": kind, "session_id": self.id, **fields}, ensure_ascii=False)), 3)

    async def run(self):
        try:
            initial = await asyncio.wait_for(self.ws.receive_text(), 10)
            hello = parse_json(initial)
            validate_hello(hello)
            if hello["features"].get("game_role") != "echo-archivist":
                raise ProtocolError("此端口仅接收ECHO游戏固件")
            if not turn_control_supported(hello["features"]):
                raise ProtocolError("需要显式续听和播放完成回执")
            if hello["features"].get("control_only"):
                raise ProtocolError("游戏服务不接收机器人管理会话")
            await self.send("hello", version=1, transport="websocket",
                features={"listen_control": True, "playback_finished": True},
                audio_params=dict(format="opus", sample_rate=24000, channels=1, frame_duration=60))
            # 1.0.0-game advertises mcp=false but already implements the guarded
            # MCP request/reply path. Probe only its two volume-related tools;
            # this cloud compatibility fix needs no ESP32 rewrite.
            volume_enabled = type(hello["features"].get("mcp")) is bool
            self.tools = SessionTools(self.knowledge, lambda event: self.send(
                event["type"], **{k: v for k, v in event.items() if k != "type"}), volume_enabled)
            if volume_enabled:
                self.provider.settings = self.settings.model_copy(update={
                    "qwen_instructions": self.settings.qwen_instructions + VOLUME_INSTRUCTIONS})
            await self.provider.connect(TOOLS + (VOLUME_TOOLS if volume_enabled else []))
            self.tasks = [asyncio.create_task(self.device_loop()), asyncio.create_task(self.model_loop())]
            if volume_enabled:
                self.tools.mcp.start()
            self.tasks.append(self.failure)
            done, _ = await asyncio.wait(self.tasks, timeout=1800, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            if self.tools:
                await self.tools.mcp.close()
            for task in self.tasks:
                task.cancel()
            if self.reply and self.reply.sender:
                self.reply.sender.cancel()
                self.tasks.append(self.reply.sender)
            await asyncio.gather(*self.tasks, return_exceptions=True)
            await self.provider.close()
            self.decoder.close()

    async def device_loop(self):
        while True:
            message = await asyncio.wait_for(self.ws.receive(), 300)
            if message["type"] == "websocket.disconnect":
                return
            packet = message.get("bytes")
            if packet is not None:
                if self.listening:
                    pcm = self.decoder.decode(packet)
                    await self.provider.send({"type": "input_audio_buffer.append",
                                              "audio": base64.b64encode(pcm).decode()})
                continue
            data = parse_json(message.get("text", ""))
            if data.get("session_id") != self.id:
                continue
            kind, reply = data["type"], self.reply
            matches = reply and data.get("response_id") == reply.id
            if kind in {"abort", "conversation.end"}:
                return  # Retire upstream history and all queued audio on interruption.
            if kind == "listen" and data.get("state") == "start":
                if reply and (not matches or not reply.resume):
                    continue
                if not self.listening:
                    self.tool_rounds = 0
                    await self.provider.send({"type": "input_audio_buffer.clear"})
                    self.input_ended.clear()
                    self.listening = True
                    await self.send("persona.state", state="listening", message="我在听，你说。")
            elif kind == "listen" and data.get("state") == "stop" and self.listening:
                self.listening = False
                # Qwen semantic VAD owns commit/response creation. A manual
                # commit here races its automatic response. Supply a bounded
                # silence tail, as in the source XiaoZhi transport.
                async with async_timeout(5):
                    for _ in range(34):
                        if self.input_ended.is_set():
                            break
                        await self.provider.send({"type": "input_audio_buffer.append",
                                                  "audio": base64.b64encode(bytes(1920)).decode()})
                        try:
                            await asyncio.wait_for(self.input_ended.wait(), .06)
                            break
                        except asyncio.TimeoutError:
                            pass
                    await self.input_ended.wait()
            elif kind == "tts.ready" and matches:
                reply.ready.set()
            elif kind == "tts.played" and matches and reply.stop_sent:
                reply.played.set()
            elif kind == "ping":
                await self.send("pong")
            elif kind == "mcp":
                self.tools.mcp.receive(data)
            elif kind == "ui.select":
                await self.send("ui.result", request_id=data.get("request_id", ""), ok=False,
                                message="游戏权限由主持人控制，请直接语音提问")
            # Device notifications grant no game or robot authority.

    async def model_loop(self):
        async for event in self.provider.events():
            kind = event.get("type")
            if kind == "error":
                raise ProtocolError("语音服务返回错误")
            if kind == "conversation.item.input_audio_transcription.completed":
                text = event.get("transcript", "")
                if isinstance(text, str):
                    await self.send("stt", text=text[:600])
            elif kind == "input_audio_buffer.speech_stopped":
                self.input_ended.set()
                self.listening = False
                await self.send("persona.state", state="thinking", message="让我想一想。")
            elif kind == "response.created":
                self.input_ended.set()
                if self.reply and not self.reply.resume and not self.followup:
                    raise ProtocolError("不允许重叠回答")
                rid = event.get("response", {}).get("id")
                if not isinstance(rid, str) or not 1 <= len(rid) <= 128:
                    raise ProtocolError("回答编号无效")
                self.listening = False
                self.followup = False
                self.reply = Reply(rid)
                self.reply.sender = asyncio.create_task(self.play(self.reply))
                self.reply.sender.add_done_callback(self.playback_done)
            else:
                reply = self.reply
                rid = event.get("response_id") or event.get("response", {}).get("id")
                if not reply or rid != reply.id or reply.resume:
                    continue
                # A failed sender must also interrupt a full producer queue.
                if reply.sender.done():
                    reply.sender.result()
                if kind in {"response.audio_transcript.delta", "response.text.delta"}:
                    delta = event.get("delta", "")
                    if not isinstance(delta, str):
                        raise ProtocolError("字幕格式无效")
                    reply.text = (reply.text + delta)[-4000:]
                    if time.monotonic() - reply.last_caption > .2:
                        await self.caption(reply)
                elif kind in {"response.audio_transcript.done", "response.text.done"}:
                    text = event.get("transcript", event.get("text", reply.text))
                    if not isinstance(text, str):
                        raise ProtocolError("字幕格式无效")
                    reply.text = text[-4000:]
                    await self.caption(reply)
                elif kind == "response.audio.delta":
                    delta = event.get("delta", "")
                    if not isinstance(delta, str) or len(delta) > 1_000_000:
                        raise ProtocolError("语音块过大或格式无效")
                    for frame in reply.framer.feed(base64.b64decode(delta, validate=True)):
                        await self.enqueue(reply, frame)
                elif kind == "response.function_call_arguments.done":
                    reply.calls.add(event)
                elif kind == "response.done":
                    detail = event.get("response", {})
                    if detail.get("status") not in (None, "completed"):
                        raise ProtocolError("回答未正常完成")
                    for item in detail.get("output", []):
                        if item.get("type") == "function_call":
                            reply.calls.add(item)
                    for frame in reply.framer.flush():
                        await self.enqueue(reply, frame)
                    await self.enqueue(reply, None)
                    await reply.sender
                    if reply.calls.calls:
                        self.tool_rounds += 1
                        if self.tool_rounds > 8:
                            raise ProtocolError("知识库查询轮数已达上限")
                        device_call = any(name in {t["function"]["name"] for t in VOLUME_TOOLS}
                                          for name, _ in reply.calls.calls.values())
                        await self.send("persona.state", state="tool",
                                        message="正在调整扬声器" if device_call else "让我翻翻这页记录。")
                        self.followup = True
                        await reply.calls.respond(self.provider, self.tools)
                        continue
                    reply.resume = True
                    await self.send("listen.control", state="start", response_id=reply.id)

    async def enqueue(self, reply, frame):
        put = asyncio.create_task(reply.queue.put(frame))
        try:
            done, _ = await asyncio.wait({put, reply.sender}, timeout=15,
                                         return_when=asyncio.FIRST_COMPLETED)
            if put in done:
                return
            if reply.sender in done:
                reply.sender.result()
                raise ProtocolError("播放提前结束")
            raise ProtocolError("播放队列等待超时")
        finally:
            if not put.done():
                put.cancel()
            await asyncio.gather(put, return_exceptions=True)

    async def caption(self, reply):
        text = reply.text.encode()[-512:].decode(errors="ignore")
        await self.send("tts", state="sentence_start", text=text, response_id=reply.id)
        reply.last_caption = time.monotonic()

    async def play(self, reply):
        with OpusEncoder() as encoder:
            await self.send("tts", state="start", response_id=reply.id)
            await asyncio.wait_for(reply.ready.wait(), 3)
            clock = time.monotonic()
            while True:
                pcm = await asyncio.wait_for(reply.queue.get(), 60)
                if pcm is None:
                    break
                await asyncio.sleep(max(0, clock - time.monotonic()))
                async with self.lock:
                    await asyncio.wait_for(self.ws.send_bytes(encoder.encode(pcm)), 3)
                clock = max(clock + .06, time.monotonic())
            reply.stop_sent = True
            await self.send("tts", state="stop", response_id=reply.id)
            await asyncio.wait_for(reply.played.wait(), 15)
