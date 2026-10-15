#!/usr/bin/env python3
"""Generate ECHO's embedded cues with the same Qwen voice as cloud dialogue."""
import argparse
import asyncio
from async_timeout import timeout as async_timeout
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

from echo_game.config import Settings
from echo_game.providers import QwenProvider

CLIPS = {"here": "在的，你说吧。", "present": "我在，你说吧。",
         "say": "你说，我听着呢。", "listening": "嗯，我在听。"}


def spoken(text):
    return re.sub(r"[^\w]", "", text).lower()


async def generate(settings, destination):
    destination.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(2)

    async def clip(name, text):
        async with semaphore:
            cached = destination / ("wake_" + name + ".json")
            existing = destination / ("wake_" + name + ".ogg")
            if cached.exists() and existing.exists():
                result = json.loads(cached.read_text())
                if (result.get("voice") == settings.qwen_voice and result.get("text") == text
                        and result.get("sha256") == hashlib.sha256(existing.read_bytes()).hexdigest()):
                    return result
            provider = QwenProvider(settings, speech_text=text)
            pcm, transcript = bytearray(), ""
            try:
                async with async_timeout(60):
                    await provider.connect([])
                    await provider.send({"type": "conversation.item.create", "item": {
                        "type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}})
                    await provider.send({"type": "response.create"})
                    async for event in provider.events():
                        kind = event.get("type")
                        if kind == "response.audio.delta":
                            pcm.extend(base64.b64decode(event["delta"], validate=True))
                        elif kind == "response.audio_transcript.done":
                            transcript = event.get("transcript", "")
                        elif kind == "response.done":
                            if event.get("response", {}).get("status") not in (None, "completed"):
                                raise RuntimeError("Cue generation did not complete")
                            break
                        elif kind == "error":
                            raise RuntimeError("Cue generation failed")
                    else:
                        raise RuntimeError("Cue stream ended early")
            finally:
                await provider.close()
            if not pcm or spoken(transcript) != spoken(text):
                raise RuntimeError("Cue transcript did not match " + name + ": " + repr(transcript))
            with tempfile.TemporaryDirectory() as temporary:
                source = Path(temporary) / "cue.pcm"
                source.write_bytes(pcm)
                target = Path(temporary) / "cue.ogg"
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
                    "-i", str(source), "-af", "loudnorm=I=-18:TP=-3:LRA=7,alimiter=limit=0.78",
                    "-ar", "16000", "-ac", "1", "-c:a", "libopus", "-b:a", "20k",
                    "-application", "voip", "-frame_duration", "60", str(target)], check=True)
                info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_packets",
                    "-show_entries", "stream=nb_read_packets:format=duration", "-of", "json", str(target)]))
                frames = int(info["streams"][0]["nb_read_packets"])
                data = target.read_bytes()
                if len(data) > 16384 or not 1 <= frames <= 40:
                    raise RuntimeError("Cue exceeds firmware's 40-frame/16KiB limit: " + name)
                (destination / ("wake_" + name + ".ogg")).write_bytes(data)
            result = dict(id=name, voice=settings.qwen_voice, text=text, transcript=transcript, duration_s=float(info["format"]["duration"]),
                          opus_frames=frames, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            cached.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            print(json.dumps(result, ensure_ascii=False), flush=True)
            return result

    clips = await asyncio.gather(*(clip(name, text) for name, text in CLIPS.items()), return_exceptions=True)
    errors = [str(result) for result in clips if isinstance(result, Exception)]
    if errors:
        raise RuntimeError("; ".join(errors))
    manifest = dict(model=settings.qwen_model, voice=settings.qwen_voice, sample_rate=16000,
                    channels=1, opus_frame_ms=60, loudness_lufs=-18, true_peak_db=-3,
                    limiter_peak=.78, clips=clips)
    (destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(generate(Settings(_env_file=args.env_file), args.output))
