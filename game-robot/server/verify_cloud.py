#!/usr/bin/env python3
"""Opt-in synthetic speech -> cloud ASR -> game tools -> speech protocol check."""
import argparse
import asyncio
from async_timeout import timeout as async_timeout
import base64
import json
from array import array
import sys
from websockets.asyncio.client import connect
from echo_game.audio import OpusDecoder, OpusEncoder
from echo_game.config import Settings
from echo_game.providers import QwenProvider

QUESTION = "请查庄园主人的身份。"


async def verify(settings, url, question=QUESTION, volume_test=False):
    speech = QwenProvider(settings, speech_text=question)
    pcm = bytearray()
    try:
        async with async_timeout(60):
            await speech.connect([])
            await speech.send({"type": "conversation.item.create", "item": {"type": "message", "role": "user",
                "content": [{"type": "input_text", "text": question}]}})
            await speech.send({"type": "response.create"})
            async for event in speech.events():
                if event.get("type") == "response.audio.delta":
                    pcm.extend(base64.b64decode(event["delta"], validate=True))
                elif event.get("type") == "response.done":
                    if event.get("response", {}).get("status") not in (None, "completed"):
                        raise RuntimeError("Synthetic speech failed")
                    break
                elif event.get("type") == "error":
                    code = str(event.get("error", {}).get("code", "unknown"))
                    raise RuntimeError("Synthetic speech failed; upstream code=" + code[:100])
    finally:
        await speech.close()
    if not pcm:
        raise RuntimeError("No synthetic input speech")
    # Fixture-only 24k -> 16k interpolation, avoiding Python 3.13's removed
    # audioop module. Production input/output still use native Opus codecs.
    samples = array("h", pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    resampled = array("h")
    for index in range(len(samples) * 2 // 3):
        left, half = divmod(index * 3, 2)
        value = samples[left] if not half else (samples[left] + samples[min(left + 1, len(samples) - 1)]) // 2
        resampled.append(value)
    if sys.byteorder != "little":
        resampled.byteswap()
    audio = resampled.tobytes()
    audio += bytes(32000)  # One second of tail silence for semantic VAD.
    audio += bytes((-len(audio)) % 1920)
    async with async_timeout(100):
        async with connect(url, additional_headers={"Authorization": "Bearer " + settings.device_token},
                           proxy=None, max_size=8192, max_queue=16) as ws:
            features = {"persona_ui": 1, "tts_ready": True, "listen_control": True,
                        "playback_finished": True, "game_role": "echo-archivist"}
            if volume_test:
                features["mcp"] = False  # Simulate the already-flashed 1.0.0-game.
            await ws.send(json.dumps({"type": "hello", "version": 1, "transport": "websocket",
                "features": features,
                "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60}}))
            hello = json.loads(await ws.recv())
            sid = hello["session_id"]
            simulated_volume, volume_writes = 55, []

            async def device_rpc(event):
                nonlocal simulated_volume
                if event.get("type") != "mcp":
                    return False
                if not volume_test:
                    raise RuntimeError("Unexpected device RPC")
                request = event["payload"]
                if "id" not in request:
                    return True
                method = request["method"]
                if method == "initialize":
                    result = {"protocolVersion": "2024-11-05"}
                elif method == "tools/list":
                    result = {"tools": [{"name": n} for n in ("self.get_device_status", "self.audio_speaker.set_volume")]}
                elif method == "tools/call":
                    name = request["params"]["name"]
                    if name == "self.get_device_status":
                        value = {"audio_speaker": {"volume": simulated_volume}}
                    elif name == "self.audio_speaker.set_volume":
                        simulated_volume = request["params"]["arguments"]["volume"]
                        volume_writes.append(simulated_volume)
                        value = {"volume": simulated_volume, "applied": True}
                    else:
                        raise RuntimeError("Unexpected hardware tool")
                    result = {"content": [{"type": "text", "text": json.dumps(value)}]}
                else:
                    raise RuntimeError("Unexpected RPC method")
                await ws.send(json.dumps({"type": "mcp", "session_id": sid, "payload": {
                    "jsonrpc": "2.0", "id": request["id"], "result": result}}))
                return True

            await ws.send(json.dumps({"type": "listen", "state": "start", "session_id": sid}))
            state = json.loads(await ws.recv())
            while await device_rpc(state):
                state = json.loads(await ws.recv())
            if state.get("state") != "listening":
                raise RuntimeError("Cloud device session did not start listening")

            async def upload():
                with OpusEncoder(16000) as encoder:
                    for offset in range(0, len(audio), 1920):
                        await ws.send(encoder.encode(audio[offset:offset + 1920]))
                        await asyncio.sleep(.06)

            sender = asyncio.create_task(upload())
            frames, tool_phases, caption, transcript = 0, 0, "", ""
            try:
                with OpusDecoder(24000) as decoder:
                    async for raw in ws:
                        if isinstance(raw, bytes):
                            decoder.decode(raw)
                            frames += 1
                            continue
                        event = json.loads(raw)
                        if await device_rpc(event):
                            continue
                        kind = event.get("type")
                        if kind == "stt":
                            transcript = event.get("text", "")
                        elif kind == "tts":
                            if event["state"] == "sentence_start":
                                caption = event.get("text", "")
                            elif event["state"] in {"start", "stop"}:
                                await ws.send(json.dumps({"type": "tts.ready" if event["state"] == "start" else "tts.played",
                                    "session_id": sid, "response_id": event["response_id"]}))
                        elif kind == "persona.state" and event.get("state") == "tool":
                            tool_phases += 1
                        elif kind == "persona.state" and event.get("state") == "error":
                            raise RuntimeError("Cloud dialogue reported an error")
                        elif kind == "listen.control":
                            await ws.send(json.dumps({"type": "conversation.end", "session_id": sid}))
                            result = {"asr": transcript, "reply": caption, "audio_frames": frames,
                                      "knowledge_rounds": tool_phases, "resumed_after_playback": True}
                            if volume_test:
                                result["simulated_device_volume_writes"] = volume_writes
                                if volume_writes != [45]:
                                    raise RuntimeError("Relative volume tool did not apply exactly one 55 -> 45 adjustment")
                            if not transcript or not frames or not tool_phases:
                                raise RuntimeError("Voice or knowledge function call was not verified")
                            return result
                raise RuntimeError("Cloud session ended before turn completion")
            finally:
                sender.cancel()
                await asyncio.gather(sender, return_exceptions=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--url", default="wss://alsj.luna.ski/echo/ws/device")
    parser.add_argument("--volume-test", action="store_true", help="Simulate device RPC; never controls the real ESP32")
    args = parser.parse_args()
    question = "请把音量调小一点。" if args.volume_test else QUESTION
    print(json.dumps(asyncio.run(verify(Settings(_env_file=args.env_file), args.url, question, args.volume_test)), ensure_ascii=False))
