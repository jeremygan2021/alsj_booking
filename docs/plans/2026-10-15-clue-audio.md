# 线索配音与网页搜证实施计划

目标：26条证据（基础及鉴定说明）和6个AR节点均可点击聆听带配乐的MiniMax固定音色演绎。扫码展示对应线索后可以播放，换线索停止旧音频，不自动抢播。适合对话的证言及通知采用多角色，事实边界不超出该层正文。

## 数据约定

- `server/audio/clue-audio.json`：`{version,model,tracks:[{id,part,sourceHash,filename,duration,speakers}]}`。
- `part`为`body`或`detail`；节点只有body。`sourceHash`为原正文原样UTF-8 SHA256（不规范化）；`filename`匹配`e-01-body.mp3`或`ar-01-body.mp3`，放`server/audio/files/`。
- API线索结果增加`audio: {body?:{url,duration,speakers},detail?:{url,duration,speakers}}`。无可用且匹配当前文字的文件时不返回音频。
- 公开基础音频：`/api/ar/clues/:id/audio`和`/api/ar/nodes/:id/audio`；不提供detail查询。已登录：`/api/clues/:id/audio/:part`，沿用原线索与鉴定权限，禁止直接公开静态映射files目录。
- 音频来源署名：服务端音频metadata带`credits`（使用Kevin MacLeod配乐CC BY4.0及官网链接）；播放器可展开署名。

## 并行任务

1. 后端：先补权限及音频内容变更失效测试，确认缺失功能导致失败；实现registry固定映射、公开基础/玩家层级音频路由、Range与cache权限。覆盖未解锁、鉴定失败、成功、路径探测、正文修改导致旧音频隐藏，修正现有公开API字段断言。
2. 前端：先补浏览器行为用例；统一ClueAudio组件接入ClueReveal及实际扫码AR覆盖层的模型操作区；PublicAR主页面不渲染播放器，显示“点击聆听”、暂停/重播/进度，故障可重试，切换与关闭停止。全站互斥线索播放，聆听时压低/暂停现有氛围音乐，不修改用户主动暂停偏好；深度录音只在detail获准后显示。无需新增在线TTS。
3. 音频制作：按实际content.js与publicInvestigationNodes导出正文，撰写分层台本；沿用现有角色固定音色与已下载授权配乐。提交异步MiniMax任务并缓存任务ID；成功后下载、混音、测量并制作58份文件。敏感生成密钥仅临时文件，不入仓、不入交付。
4. 集成：测试→构建→浏览器扫码及播放验收→独立review→制作交付包和当前站点发布包。按现有部署流程备份数据库并更新应用，保留旧版本可回退；线上核验字节Range、32项基础音频、私密鉴定音频权限、网页入口和正式用户数据不被测试写入。

## 验收

声音内容与可见正文层级一致；所有媒体可解码且无削波；多角色音色固定；音频失败不妨碍文字搜证；旧音频不能在切码后继续响；不新增匿名深度资料或密钥暴露。
