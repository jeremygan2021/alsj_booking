import json


class ProtocolError(ValueError):
    pass


def clipped(text: str, maximum: int = 512) -> str:
    return text.encode("utf-8")[:maximum].decode("utf-8", errors="ignore")


def parse_json(text: str) -> dict:
    if len(text.encode("utf-8")) > 8192:
        raise ProtocolError("JSON message exceeds 8192 bytes")
    try:
        value = json.loads(text)
    except (ValueError, RecursionError) as exc:
        raise ProtocolError("Invalid JSON") from exc
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        raise ProtocolError("JSON object with type is required")
    return value


def validate_hello(message: dict):
    params = message.get("audio_params")
    features = message.get("features")
    if (message.get("type") != "hello" or type(message.get("version")) is not int
            or message["version"] != 1 or message.get("transport") != "websocket"):
        raise ProtocolError("Expected version 1 WebSocket hello")
    if not isinstance(params, dict) or any(
        type(params.get(key)) is not type(value) or params.get(key) != value
        for key, value in dict(format="opus", sample_rate=16000, channels=1, frame_duration=60).items()
    ):
        raise ProtocolError("Expected Opus 16000 Hz mono 60 ms")
    if not isinstance(features, dict) or features.get("tts_ready") is not True:
        raise ProtocolError("tts_ready feature is required")
    if type(features.get("persona_ui")) is not int or features["persona_ui"] != 1:
        raise ProtocolError("persona_ui/1 feature is required")


def turn_control_supported(features: dict) -> bool:
    """Explicit continuation requires both capabilities; old firmware stays valid."""
    return features.get("listen_control") is True and features.get("playback_finished") is True
