# 角色自动审核发布

2026-10-30 北京时间17:46发布至 https://alsj.luna.ski/play。

- 功能提交：`de20ff689769a71323c9feef4ead40f7de2846eb`。
- 发布版本：`20261030T094637Z-de20ff6-auto-review`。
- 玩家提交角色，服务端在同一事务内保存校验后的NPC关联、任务并将角色设为 `approved`，无需GM确认。使用生成草稿缓存、模板及失败重试的路径均适用。模型失败仍保留资料供重试，迟到结果不能覆盖新版本。
- 关联NPC立即可见，其他NPC保持不可见。GM仍能重新开放编辑；票务核验、签到与阶段限制沿用原流程。
- 玩家页、角色表单、后台说明已同步更新自动审核文案。
- 发布前数据库备份成功，`Result=success`、`ExecMainStatus=0`。已有7名角色均已批准，没有批量修改已有角色。
- 基于前一生产镜像制作补丁，覆盖 `server/app.js` 和重新构建的前端，保留原依赖、媒体、OSS配置及其他服务。购票二维码从前一生产版本恢复到源码，修复本地构建缺失文件；另修正音频测试在中文路径下的URL解码。

验证：本地178项测试、前端构建、1项浏览器完整流程通过；生产镜像内17项角色生成测试在PostgreSQL随机独立schema中全部通过，测试后自动删除schema，不创建生产报名或调用真实模型。线上页面、公开API返回200，匿名角色提交返回401，容器healthy，线上前端自动审核文案已核对。

容器内 `server/app.js` SHA-256：`5e6a8be3ce6a5af164d35123afb9a4eed6ccb46e7fb2c1494e695329ac156331`，与本地一致。

回滚：在 `/opt/alsj_booking/releases/20261030T065526Z-0c046d8` 执行 `docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --no-build`，再将 `/opt/alsj_booking/current` 指回该目录。应用回滚不会撤销已通过的角色状态。
