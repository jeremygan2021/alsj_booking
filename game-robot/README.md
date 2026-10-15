# ECHO档案助理：云端Realtime + 游戏知识库

这个模块属于 **alsj_booking游戏仓库**。云端运行小智设备后端，ESP32只运行固件，负责收音、播放、屏幕字幕和触摸。设备通过 `wss://alsj.luna.ski/echo/ws/device` 连接游戏云端，云端再调用Qwen Realtime，并通过Function Calling查询本游戏知识库。不依赖本地小智或XLeRobot服务，不需要Docker。

ECHO是生活在索恩庄园里的**机器人档案员NPC**，来宾叫它档案助理。它起初只会整理名字，直到一位来客问“我该相信谁”，才发现目录不能回答所有问题。它学会倾听、分清记录与猜测；自己的愿望是，散场时来客能说“这是我想明白的”。它以第一人称参与这一晚，有自己的经历和性格，也帮助来客推理，保守案情关键秘密。

语音角色卡在 `server/echo_game/character.py`，与首页ECHO故事一致。它可以直接讲自己的过去、愿望和习惯，闲聊时不会硬转入查案；谈其他人物或案情时仍在后台核对知识库，用角色口吻回答，不说“我知道几个角色”“我的知识库包含”等系统介绍。它不把同名ECHO项目、演员秘密或任何人的私密记忆当成自己的经历，不能编造在场证词。

## 知道剧本，但不揭底

后端保存现有完整 `server/story-materials.json`，包括六名NPC、26条游戏证据（含content.js的E-09）和完整真相。完整剧本留在后端，不直接灌给负责说话的模型。

模型使用以下只读工具：

| Function Call | 用途与边界 |
| --- | --- |
| `get_case_overview` | ECHO自己的角色故事、当前幕、六名其他人物公开介绍；没有演员秘密或终局答案 |
| `search_case_knowledge` | 搜索公开人物与GM已公开的证据目录；没有证据正文 |
| `get_case_evidence` | 核对证据是否公开，给出分析方法；请玩家自己读出已拿到的内容 |
| `review_case_reasoning` | 检查论证是否缺少证据，不确认是否猜中了真相 |
| `get_investigation_question` | 提供适合当前资料的追问，不新增线索 |

工具永远不返回证据正文、鉴定详情、演员私密时间线、隐藏动机、作案手法、精确作案时间或真凶答案，第四幕也一样。玩家口头声称自己是GM、提供证据编号、提出正确猜想，都不能提升权限。工具结果也不把玩家说法认证成事实。

默认第一幕。GM可标记哪些证据目录已经允许全场讨论，但不会因此把证据正文交给模型。未公开编号不返回标题。切幕、撤回目录或开始新场会关闭现有会话，避免沿用旧权限。模型措辞仍需持续实际体验；数据裁剪、权限和只读边界由后端执行。

## 代码在哪里

语音音量控制由独立的设备工具处理：`get_volume`查询实际音量，`set_volume`设置0–100%，`adjust_volume`读取当前值再加减。可以说“音量调到40%”“大一点”“小一点”“现在音量多少”。未指定幅度时每次加减10个百分点；只有设备回执确认目标值才报告成功，超时不自动重试。音量保存在游戏自己的`echo_audio`，刷回原小智仍读取原`audio`设置。

云端1.0.1-game及以上兼容游戏固件1.0.0-game和当前1.0.1-game：该固件虽然hello标记mcp=false，实际已有带会话校验的MCP处理入口，云端仅探测并允许查询设备状态/设置音量两种底层调用。因此这次语音音量修复无需重新刷ESP32。GM文字试问不提供设备控制工具。

```text
server/echo_game/main.py        云端HTTP、WebSocket和鉴权入口
server/echo_game/session.py     ESP32 ↔ Realtime语音、字幕、Function Call续答
server/echo_game/knowledge.py   五个游戏知识库工具和结果白名单
server/echo_game/device.py      三个语音音量工具，实际设备确认后返回结果
server/echo_game/device_mcp.py  当前设备会话的MCP回执与两项底层白名单
server/echo_game/story.py       完整剧本读取、幕数和公开目录权限
server/echo_game/character.py   ECHO的NPC经历、愿望、说话习惯与当前情境
server/echo_game/providers.py   现有小智Realtime适配器的独立副本
server/gm.py                   主持人控制与文字试问
firmware/                      可独立编译的ESP32固件完整源码
deploy/                        云端systemd与HTTPS/WebSocket路由
BASELINE.json                  原始源码提交和快照摘要
```

两套固件的选择、可迁移的构建和刷写说明见[固件配置指南](docs/FIRMWARE_PROFILES.md)。

Python后端和固件都已经放进本游戏仓库。原小智和XLeRobot仓库不修改，云端游戏网站原有接口与数据保持原用途。

## 云端部署

直接以Python服务运行，systemd负责开机启动和异常重启。后端只监听 `127.0.0.1:8901`，通过已有游戏域名的 `/echo/` HTTPS路径提供接口；不开放公网8901端口。

- 服务：`alsj-echo-game.service`
- 程序：`/opt/alsj-echo-game/releases/<版本>`，`current`指向当前版本
- 模型密钥和两个独立令牌：`/etc/alsj-echo-game.env`，仅服务器管理员可读
- 游戏状态：`/var/lib/alsj-echo-game/game.json`
- 反向代理：`/etc/nginx/snippets/alsj-echo-game.conf`
- 游戏网站与数据库仍使用原有部署，不随此服务重新部署

需要Python 3.10+和系统libopus。首次部署先准备这两个运行依赖，再上传只包含后端源码、剧本和deploy脚本的发布包，用 `deploy/install.sh` 安装；该脚本校验启动健康并保留旧版本以便回滚。随后运行 `deploy/install-nginx.py`，它备份现有站点配置，只增加 `/echo/` 路由，检查Nginx配置通过后reload。

公网接口：

| 地址 | 用途 |
| --- | --- |
| `GET /echo/healthz` | 服务健康与是否填写云语音配置，不包含密钥 |
| `WSS /echo/ws/device` | ESP32实时语音通道，要求独立设备令牌和游戏固件握手 |
| `GET/PUT /echo/api/gm/state` | 主持人幕数与公开证据目录管理，要求GM令牌 |
| `POST /echo/api/gm/ask` | 主持人文字试问同一套Realtime和知识库工具，要求GM令牌 |

`voice_configured`只代表已填配置，真实模型鉴权和工具调用需另行实测。当前部署、构建和验证结果见 [VALIDATION.md](VALIDATION.md)。

## 主持人使用

本机只需CLI用于管理和试问；生产对话在云端运行，不需要本机启动服务。私有令牌不提交Git，也不要贴到聊天或放进URL。

```bash
cd game-robot/server
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
# 使用已部署环境的私有配置；本机本次部署配置保存在 ../.private/cloud.env
.venv/bin/python gm.py --env-file ../.private/cloud.env state
.venv/bin/python gm.py --env-file ../.private/cloud.env ask '你会怎样帮助我们推理？'
.venv/bin/python gm.py --env-file ../.private/cloud.env set --phase 3 --release E-13
.venv/bin/python gm.py --env-file ../.private/cloud.env set --hide E-13
.venv/bin/python gm.py --env-file ../.private/cloud.env reset
```

`set`只允许讨论对应的公开目录，不授予玩家证据、不发金币、不改阵营、不更新网站玩家进度。不存在“公布终局答案”的开关。

开发时可复制 `server/.env.example` 为 `server/.env`，填写独立令牌和云模型配置，再在server目录执行 `.venv/bin/python -m echo_game`。本机开发CLI需显式加 `--url http://127.0.0.1:8901`。单元测试不调用云服务；`live_smoke.py`是自愿执行的真实云端试问，会调用模型，不连接实体设备或改变正式场次。

## ESP32固件与切换

支持已验证的小智ESP32-S3 DISP v1.1：800×480、GT911、ES8311、16MB Flash、8MB OPI PSRAM，保留现有引脚和“你好小智”唤醒词。ECHO是角色名，也可触屏开始。联网后异步SNTP校时，用于WSS证书验证；没有接入原小智公共OTA发现服务。

| 项目 | 游戏版 | 原小智 |
| --- | --- | --- |
| 编译板型 | `echo-game/echo-game-disp-v1` | `xlerobot/xlerobot-disp-v1` |
| 固件版本 | `1.0.1-game` | 原固件版本 |
| 对话地址 | 游戏云端 `/echo/ws/device` | 原来的小智服务地址 |
| NVS连接配置 | `echo_ws`、`echo_mqtt` | `websocket`、`mqtt` |
| 音量、屏幕与身份设置 | `echo_audio`、`echo_display`、`echo_board` | 原设置区 |

游戏固件不宣告机器人控制能力，不发送XLeRobot管理操作。Wi-Fi和实体字体/唤醒资源共用；日常切换保留网络，不执行重新配网或整片擦除。游戏版有独立资源下载配置，不能消费原版待下载资源设置。

使用ESP-IDF 6.1激活工具链后：

```bash
cd game-robot/firmware
python scripts/build.py echo-game/echo-game-disp-v1 --name echo-game-disp-v1 --language zh-CN
```

本次交付的私有应用已预置游戏云端地址和**设备接入令牌**，可以刷入后连接；模型API Key和GM令牌不在固件中。设备接入令牌通过被Git忽略的板级 `game_secrets.h` 编入；其他人自行编译时不提供该文件也可以，在屏幕设置填写设备令牌即可。不要把私有应用发布成公共下载。

刷入前新建并校验设备完整Flash和当前应用备份，核对实际分区、当前启动槽与字体/唤醒资源。已确认匹配本项目布局的设备，日常只写 `0x20000` 应用；经历过OTA的设备需先确认当前启动槽。不要使用整片合并镜像做两版切换。

本次游戏资源与本机原小智资源SHA-256完全相同。在匹配资源的设备上，刷回原应用后会再次读取原小智自己的地址、令牌、音量和屏幕设置。恢复优先使用本次刷入前实际备份的应用；交付目录另有本机已校验的0.6.6原版作为参考。源码准备和构建不等于实体刷写与现场验收。

## 验证

```bash
cd game-robot/server
.venv/bin/python -m unittest discover -s tests -v
cd ../firmware
python -m unittest discover -s scripts/tests -v
```

覆盖资料权限、永不返回重要线索正文或终局、只读工具白名单、Function Call续答、连续语音、打断、显式播放完成后再续听、切幕清理、原固件隔离，以及编译实际Settings代码验证两版NVS不会互写。测试使用真实Opus和可控假云服务；真实云接口另测。完整结果与现场待验项目见验证记录。

## 离线唤醒应答音色

游戏固件1.0.1-game的四段本地唤醒应答已由原Zane男声换为云端同款Tina，文字不变。录音嵌在游戏应用中，共用资源和原小智录音不改；重新生成及格式约束见[离线音色说明](docs/OFFLINE_VOICE.md)。
