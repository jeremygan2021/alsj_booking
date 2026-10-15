from pathlib import Path
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ECHO_", env_file=".env", extra="ignore",
                                      hide_input_in_errors=True)
    host: str = "0.0.0.0"
    port: int = Field(default=8901, ge=1, le=65535)
    device_token: str = Field(min_length=16, repr=False)
    gm_token: str = Field(min_length=24, repr=False)
    qwen_api_key: str = Field(default="", repr=False)
    qwen_workspace_id: str = ""
    qwen_region: str = "cn-beijing"
    qwen_model: str = "qwen3.8-omni-flash-realtime"
    qwen_voice: str = "Tina"
    qwen_vad_threshold: float = 0.5
    qwen_vad_silence_ms: int = 400
    upstream_timeout: float = 15
    persona_name: str = "ECHO档案助理"
    qwen_instructions: str = ""
    story_file: Path = Path(__file__).resolve().parents[3] / "server/story-materials.json"
    state_file: Path = Path("state/game.json")
    max_devices: int = Field(default=4, ge=1, le=16)

    @model_validator(mode="after")
    def distinct_tokens(self):
        if self.device_token == self.gm_token:
            raise ValueError("游戏设备和GM需要使用不同令牌")
        if any(x.startswith("REPLACE_") for x in (self.device_token, self.gm_token)):
            raise ValueError("请替换示例令牌")
        return self
