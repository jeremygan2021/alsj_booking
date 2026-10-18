# 2026-10-18 剧情修订音频制作

模型继续使用 MiniMax `speech-2.8-hd`，固定角色及 voice_id 取自原现场演绎源稿，不改人物音色。生产网站只提供成品 MP3，不携带 MiniMax 密钥，也不在玩家请求时生成语音。

当前修订的 26 条证据的 body/detail 都有正文变化，因此需重制 52 段；6 条 AR 节点正文未变，复用已核验成片。现场演绎只修改 B01、A05、A07、A10、A12，共 5 段；其中未变的台词继续复用原始分轨。A04 的 21:07 演示、A06 的 2022 年授权录音及 A11 的遗言口径仍一致，保留成片。最终实际费用以服务方返回 usage_characters 为准，`--plan`只报告本次尚需提交的新文本字符数。

## 准备与复核

在仓库根目录运行，系统 Python 3 需有 numpy 与 ffmpeg；Node 需在 PATH 中：

```bash
export PATH=/home/ai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
python3 scripts/prepare-clue-audio.py
python3 scripts/prepare-performance-audio.py
python3 scripts/build-clue-audio.py --kind all --only-changed --plan
python3 -m unittest discover -s tests -p 'test_audio_production.py' -v
```

`prepare-clue-audio.py`直接导出当前 `server/content.js` 与 `server/public-investigation.js`，逐条分别处理 body/detail，原样 UTF-8 SHA256 作为 sourceHash。已变正文绝不继续套用旧角色改编台词。旧稿中可疑的 GM 执行指令会在生成前拒绝。未变内容只有在 sourceHash、原台词、voice_id、语速、音高、模型及配乐均可核对时才允许复用。新版 E-15 不声称给出逐字引语，与保留的 A04 演示一致。

默认旧素材读取位置可用参数覆盖：

- 线索成片与分层源稿：`/home/ai/下载/alsj/线索配乐音频_完整交付包/线索配乐音频`。
- 现场成片、原始台词与已下载配乐：`/home/ai/下载/alsj/现场演绎音频_完整制作交付包/现场演绎音频`。

body、detail 与现场演绎为独立制作单元。只朗读 lines.text，现场触发、notes、演员动作、供认条件均不进入语音。A07中裁切材料明确属于西奥多私人节选，后有完整审批及历史记录核对；不把伪造指控读作系统认证事实。

## 付费生成与断点恢复

密钥从临时权限 0600 文件或 MINIMAX_API_KEY 环境读取；不要放入命令行明文、源码或交付包：

```bash
python3 scripts/build-clue-audio.py --kind clues --only-changed --workers 4 --key-file /tmp/alsj-story-minimax-key
python3 scripts/build-clue-audio.py --kind performance --only-changed --workers 4 --key-file /tmp/alsj-story-minimax-key
```

`--ids`可进一步限定，例如 `--ids E-19:body,E-19:detail` 或 `--ids B01,A10`。`--mix-only`仅使用已下载人声或已核验的旧分轨，绝不提交语音任务。`--plan`全程不请求外部服务，不需要密钥。

每句按完整请求正文、模型、voice_id、语速、音高、情感、输出参数的指纹保存在 `output/clue-audio/jobs/<payloadHash>/`。该目录含 state.json、speech.mp3、服务方返回字幕（若有），不含密钥。相同指纹以文件锁串行处理，不因多个线索或两个制作进程重复付费。

创建任务前先将 submitting 状态落盘；拿到 task_id 后才记 submitted。POST超时、断线、响应缺task_id或执行中断会保留 submitting/submission_unknown，不自动重新创建。需先在服务方任务记录核对该请求；确认对应task_id后由操作者将task_id写入原state.json再继续查询。不得为“修复”而清空缓存。查询或下载失败时，重跑同一命令只查询已知task_id。Failed/Expired也不会自动重建收费任务。

已下载人声校验完整文件哈希。混音成片包含当前 sourceHash 与 renditionHash，后者覆盖台词、音色、参数、间隔、配乐和混音版本。每完成一条即原子更新manifest，保留其他未完成条目以便恢复。正文过期的旧条目会被现有网页指纹机制隐藏。

## 验收与GM交付

所有制作完成后：

```bash
python3 scripts/build-clue-audio.py --kind all --only-changed --plan
python3 scripts/verify-audio-transcripts.py
python3 scripts/package-clue-audio.py --kind all --verify-only
python3 scripts/package-clue-audio.py --kind all
```

验收会重新读取当前正文，检查58条线索/节点的层次及 sourceHash，检查现场台词和 voice/参数 renditionHash、完整 MP3 文件哈希及完整解码。新现场动作提示使用本次重新计算的 events，不沿用旧录音时码。对应当前修改的现场成片重新混入已有授权配乐，未沿用旧固定时码的音效轨。

交付输出为 `交付包_阿拉斯加之夜/线索配乐音频` 与 `现场演绎音频`，以及分别带20261018日期的ZIP。全部含剧透，仅交给GM，不作为玩家公开目录。每个目录有机器验收记录、GM台本、CSV、映射、试听页及 SHA256SUMS；机器验证不冒称已经完成主观逐句听审，开演前仍需人工试听与场地调音。

配乐继续使用原已下载 Kevin MacLeod 作品及 CC BY 4.0，逐条保留来源与混音说明。没有新增音乐生成或外部付费请求。

MiniMax 官方接口核对： [创建异步任务](https://platform.minimax.cn/docs/api-reference/speech-t2a-async-create)、[查询异步任务](https://platform.minimax.cn/docs/api-reference/speech-t2a-async-query)、[查询可用音色](https://platform.minimax.cn/docs/api-reference/voice-management-get)。采用 `/v1/t2a_async_v2`、`/v1/query/t2a_async_query_v2` 和 `/v1/files/retrieve`；创建成功后只按原 task_id 查询，下载URL有效期有限，取得结果后立即下载本地缓存。

补充字幕审计：`verify-audio-transcripts.py` 将本次新句服务方返回的 response.titles 与审定 lines.text 做 Unicode NFKC、大小写及去标点空白后的逐字比对，数字与正文汉字不忽略。最终刷新前的废弃 E-21/detail 配置保存在 audit 快照中，同样纳入字幕和付费用量审计；只因版本更新被替换的录音不会漏计费用。报告不冒称逐句人耳听审。
