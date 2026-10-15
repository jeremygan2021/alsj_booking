"""Volume controls for this voice session; no arbitrary MCP or robot dispatch."""
import asyncio
import logging

from .device_mcp import DeviceMcpClient, McpError, STATUS, VOLUME, object_json
from .knowledge import function

log = logging.getLogger(__name__)

VOLUME_TOOLS = [
    function("get_volume", "查询当前小智扬声器的真实音量百分比。", {}),
    function("set_volume", "按用户明确要求设置音量百分比，0静音，100最大。收到设备成功回执后才能说已调好。",
             {"volume": {"type": "integer", "minimum": 0, "maximum": 100}}, ["volume"]),
    function("adjust_volume", "调大或调小音量。后端读取当前真实音量再加减；大一点用delta=10，小一点用delta=-10。不要猜测当前音量。",
             {"delta": {"type": "integer", "minimum": -100, "maximum": 100}}, ["delta"]),
]
VOLUME_NAMES = frozenset(t["function"]["name"] for t in VOLUME_TOOLS)
VOLUME_INSTRUCTIONS = (
    "用户询问或要求调节扬声器音量时，直接使用get_volume、set_volume或adjust_volume，不需要查询案情知识库。"
    "‘大一点/小一点’分别调用adjust_volume(delta=10/-10)，按当前音量调整；明确百分比用set_volume。"
    "用户明确要求静音才设为0。音量操作不附加案情追问。只有工具ok=true且设备确认实际值后才能说调节成功；"
    "超时或失败必须如实说明未确认，不能自动重复调节，也不能谎称已调整。"
)


class SessionTools:
    def __init__(self, knowledge, send, enabled):
        self.knowledge = knowledge
        self.enabled = enabled
        self.mcp = DeviceMcpClient(send, self.status_changed)
        self.lock = asyncio.Lock()

    @staticmethod
    def status_changed(result):
        speaker = result.get("audio_speaker")
        volume = speaker.get("volume") if isinstance(speaker, dict) else None
        if type(volume) is int and 0 <= volume <= 100:
            log.info("game_volume_status volume=%d", volume)

    async def current(self):
        result = await self.mcp.call(STATUS, {})
        speaker = result.get("audio_speaker")
        volume = speaker.get("volume") if isinstance(speaker, dict) else None
        if type(volume) is not int or not 0 <= volume <= 100:
            raise McpError("unconfirmed", "设备没有返回有效音量")
        return volume

    async def execute(self, name, raw_arguments):
        # A phase change retires all work, including delayed device requests.
        if self.knowledge.story.state.revision != self.knowledge.revision:
            raise RuntimeError("Game knowledge changed; retire this session")
        if name not in VOLUME_NAMES:
            return self.knowledge.execute(name, raw_arguments)
        try:
            if not isinstance(raw_arguments, str) or len(raw_arguments.encode()) > 4096:
                raise ValueError()
            arguments = object_json(raw_arguments)
            field = {"set_volume": "volume", "adjust_volume": "delta"}.get(name)
            if not isinstance(arguments, dict) or set(arguments) != ({field} if field else set()):
                raise ValueError()
            if field:
                value = arguments[field]
                if type(value) is not int or not (-100 if field == "delta" else 0) <= value <= 100:
                    raise ValueError()
        except (ValueError, TypeError, RecursionError):
            return {"ok": False, "applied": False, "error": "invalid_arguments"}
        if not self.enabled:
            return {"ok": False, "applied": False, "error": "volume_unavailable"}
        try:
            async with self.lock:
                if name == "get_volume":
                    return {"ok": True, "volume": await self.current()}
                target = value if name == "set_volume" else max(0, min(100, await self.current() + value))
                result = await self.mcp.call(VOLUME, {"volume": target})
                if result.get("applied") is not True or type(result.get("volume")) is not int or result["volume"] != target:
                    raise McpError("unconfirmed", "设备未确认目标音量，不能报告成功")
                log.info("game_volume_confirmed volume=%d", target)
                return {"ok": True, "applied": True, "volume": target}
        except McpError as exc:
            log.warning("game_volume_failed code=%s", exc.code)
            return {"ok": False, "applied": None, "error": exc.code,
                    "message": "音量操作未获确认，请勿报告成功或自动重试。"}
