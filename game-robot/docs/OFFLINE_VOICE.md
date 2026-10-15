# ECHO离线唤醒应答音色

固件1.0.1-game将四段嵌入式唤醒应答由Zane男声换成游戏云端同款Tina。它们位于`firmware/main/boards/echo-game/echo-game-disp-v1/wake_responses/`，应答文字保持不变：

- 在的，你说吧。
- 我在，你说吧。
- 你说，我听着呢。
- 嗯，我在听。

这些录音使用真实Qwen3.8 Realtime / Tina生成，随应用编译，不在共用字体/唤醒模型资源分区里。因此更新需要重新刷游戏应用；无需刷资源、NVS、分区表或OTA数据。原XLeRobot项目中的Zane录音和原小智配置保持原样。

## 重新生成

在game-robot/server内运行，私有环境只在本地读取，不要提交密钥：

```bash
.venv/bin/python generate_wake_responses.py --env-file ../.private/cloud.env --output ../.private/tina-wake-candidate
```

先检查输出manifest中的voice与游戏云端ECHO_QWEN_VOICE相同，再将四个OGG和manifest复制到上述固件源码目录。生成脚本保存有效的单段缓存，失败重跑时复用已完成的录音。音频为单声道Opus，头部输入采样率16kHz、每包60ms；每段最多40帧、16KiB，与固件PlaySoundTask限制一致。必须检查实际固件OggDemuxer能完整解析所有包，不能仅凭播放器能播放判定兼容。

构建使用ESP-IDF6.1：`python scripts/build.py echo-game/echo-game-disp-v1 --name echo-game-disp-v1 --language zh-CN`。实体更新仍按XLeRobot项目的ESP32_FIRMWARE_PROFILES.md：新备份整个Flash并独立核对，读取真实分区/活动槽，确认共用资源一致，只换ECHO应用，写后独立校验应用、配置及整个资源分区，再启动。

生成录音、构建和写入校验通过，不代替现场唤醒、听感和播放后收音验收。
