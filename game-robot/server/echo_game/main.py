import asyncio
from async_timeout import timeout as async_timeout
import contextlib
import hmac
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, WebSocket
from pydantic import BaseModel, ConfigDict, Field
from .config import Settings
from .providers import QwenProvider
from .session import GameSession
from .story import GameState, Story
from .knowledge import TOOLS, CaseKnowledge, ToolCalls
from .audio import OpusDecoder
from .character import CHARACTER_REVISION

log = logging.getLogger(__name__)


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=1000)


def create_app(settings=None, provider_factory=QwenProvider):
    config = settings or Settings()
    story = Story(config.story_file, config.state_file)
    sessions = set()
    admission = asyncio.Lock()
    gm_lock = asyncio.Lock()
    audition_slots = asyncio.Semaphore(2)

    @asynccontextmanager
    async def lifespan(app):
        with OpusDecoder():
            pass  # Refuse startup if the host has no native Opus codec.
        yield
        await asyncio.gather(*(ws.close(code=1001) for ws in list(sessions)), return_exceptions=True)

    app = FastAPI(title="ECHO 游戏档案助理", docs_url=None, redoc_url=None, openapi_url=None,
                  lifespan=lifespan)
    app.state.story = story

    def require_gm(authorization):
        if not hmac.compare_digest((authorization or "").encode(), ("Bearer " + config.gm_token).encode()):
            raise HTTPException(401, "需要GM令牌")

    def dialogue_settings():
        return config.model_copy(update={"qwen_instructions": story.prompt()})

    @app.get("/healthz")
    async def health():
        return {"ok": True, "service": "echo-game", "version": "1.0.2-game",
                "character_revision": CHARACTER_REVISION,
                "voice_configured": bool(config.qwen_api_key and config.qwen_workspace_id)}

    @app.get("/api/gm/state")
    async def read_state(authorization: str | None = Header(default=None)):
        require_gm(authorization)
        return story.gm_view()

    @app.put("/api/gm/state")
    async def update_state(state: GameState, authorization: str | None = Header(default=None)):
        require_gm(authorization)
        async with gm_lock:
            try:
                result = story.update(state)
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from None
            # Retire history before exposing a new phase or revoking any evidence.
            await asyncio.gather(*(ws.close(code=1012, reason="Game context changed")
                                   for ws in list(sessions)), return_exceptions=True)
            return result.model_dump()

    @app.post("/api/gm/ask")
    async def audition(question: Question, authorization: str | None = Header(default=None)):
        require_gm(authorization)
        async with audition_slots:
            revision = story.state.revision
            knowledge = CaseKnowledge(story)
            provider = provider_factory(dialogue_settings())
            try:
                async with async_timeout(45):
                    await provider.connect(TOOLS)
                    await provider.send({"type": "conversation.item.create", "item": {
                        "type": "message", "role": "user", "content": [
                            {"type": "input_text", "text": question.text}]}})
                    await provider.send({"type": "response.create"})
                    text = ""
                    calls, rounds = ToolCalls(), 0
                    async for event in provider.events():
                        kind = event.get("type")
                        if kind == "response.created":
                            calls, text = ToolCalls(), ""
                        elif kind == "response.function_call_arguments.done":
                            calls.add(event)
                        elif kind in {"response.audio_transcript.delta", "response.text.delta"}:
                            text = (text + event.get("delta", ""))[:4000]
                        elif kind in {"response.audio_transcript.done", "response.text.done"}:
                            text = event.get("transcript", event.get("text", text))[:4000]
                        elif kind == "response.done":
                            if event.get("response", {}).get("status") not in (None, "completed"):
                                raise ValueError("Model response failed")
                            if revision != story.state.revision:
                                raise HTTPException(409, "幕数或公开资料已变，请重新提问")
                            for item in event.get("response", {}).get("output", []):
                                if item.get("type") == "function_call":
                                    calls.add(item)
                            if calls.calls:
                                rounds += 1
                                if rounds > 8:
                                    raise ValueError("Knowledge tool loop limit")
                                await calls.respond(provider, knowledge)
                                continue
                            if not text.strip():
                                raise ValueError("Empty model response")
                            return {"reply": text, "revision": revision}
                        elif kind == "error":
                            raise ValueError("Model error")
                    raise ValueError("Model response ended early")
            except HTTPException:
                raise
            except Exception as exc:
                log.warning("game_audition_failed kind=%s", type(exc).__name__)
                raise HTTPException(503, "语音模型未就绪，请检查独立游戏服务配置") from None
            finally:
                await provider.close()

    @app.websocket("/ws/device")
    async def device(ws: WebSocket):
        supplied = ws.headers.get("authorization", "")
        if not hmac.compare_digest(supplied.encode(), ("Bearer " + config.device_token).encode()):
            await ws.close(code=1008)
            return
        async with admission:
            if len(sessions) >= config.max_devices:
                await ws.close(code=1013)
                return
            await ws.accept()
            sessions.add(ws)
        try:
            await GameSession(ws, dialogue_settings(), CaseKnowledge(story), provider_factory).run()
        except Exception as exc:
            log.warning("game_session_ended kind=%s", type(exc).__name__)
            with contextlib.suppress(Exception):
                await ws.send_json({"type": "persona.state", "state": "error",
                                    "message": "游戏语音连接已结束，请检查配置后重新开始"})
        finally:
            sessions.discard(ws)
            with contextlib.suppress(Exception):
                await ws.close(code=1000)

    return app
