# 熄灯剧情与循环背景音乐发布

2026-10-30 北京时间18:21发布至 https://alsj.luna.ski/admin 的“现场演绎音频”。

- 功能提交：`1b0999104ec73fc8b690bdd8ef1d560f7bf2fdfa`。
- 发布版本：`20261030T102153Z-1b09991-blackout`，镜像 revision 与功能提交一致，容器 healthy。
- 基于上一生产镜像制作补丁，替换现场音频清单、目录模块、两个MP3、OSS资源映射及已构建前端。保留原应用功能、依赖、数据库及其他媒体。上一版本 `20261030T094637Z-de20ff6-auto-review` 保留；发布前数据库备份 `Result=success`、`ExecMainStatus=0`。

B06《熄灯惊变·剧情版》100秒：西奥多、克拉拉、伊芙琳、里昂、诺拉沿用原固定MiniMax系统音色及速度、音高，按情节设置情绪。实际调用 `speech-2.8-hd` 异步语音接口，15段对白与惊叫均完成供应商字幕和审定台词的规范化比对。背景音乐对白闪避，混入枪声、脚步、门响、碰撞和人群反应。实际操作为现场摔杯→熄主灯→点击B06；不监听摔杯或控制实体灯光。索恩已遇害，不新增其现场对白，枪声不改变奖杯致伤的主案设定。

B07《凶险暗流·纯BGM循环版》98秒：只使用下载的背景音乐，处理循环衔接，无对白、尖叫、枪声或其他外加音效。默认单曲循环，可取消勾选。两段播放互斥；B06提前加载且不循环。

音乐采用Kevin MacLeod的Controlled Chaos与Volatile Reaction（CC BY 4.0），B07仅使用Controlled Chaos。B06音效含Kenney CC0素材及原创合成舞台音效。作者来源与署名保留在播放页和离线包。API密钥不进入源码、前端、发布包或Git。

两个新成片使用内容寻址上传至既有私有OSS，共91个运行资源。完整回读SHA-256与本地一致，匿名OSS读取403；不改变Bucket ACL或其他业务资源。

验证：

- 本地178项自动检查全部通过，生产构建成功。
- 浏览器回归通过：16段清单、B06从头重播、B07循环开关、互斥播放、终局折叠、退出停播、下载和手机布局。
- 线上GM目录16段；B06为100秒且不循环，B07为98秒且默认循环，无角色和动作提示。
- 线上两段均返回 `X-Asset-Storage: oss-direct`，OSS完整下载SHA-256及Range 206通过。
- 未登录访问GM目录、B06、B07均401；验证GM会话已退出。
- `/play`、`/admin`、`/api/public`返回200，新前端循环及纯BGM文案已核对。

发布归档：`output/releases/alsj-blackout-20261030.tar.gz`，8,745,029字节，SHA-256：`cccfd62ee4df6dc25c4a2a40e24c452e68f41e23bd9162c73cf8aebd17b4d7a6`。

回滚：在 `/opt/alsj_booking/releases/20261030T094637Z-de20ff6-auto-review` 使用该目录的 `deployment/.env` 执行 `docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --no-build app`，再将 `/opt/alsj_booking/current` 指回旧目录。无需恢复数据库。

## 18:33 枪声、人群及FBI重混版

- 功能提交 `e9b3d17a9b67a41963101bca644c5ff37a6d1fe8`，发布目录 `20261030T103351Z-e9b3d17-crowd-v3`。补丁仅更新B06、音频清单和OSS资源映射，复用原前端与其他媒体；数据库备份成功，前版保留。
- B06仍为100秒。新增四位普通宾客（两男两女）与一位FBI现场探员，分别绑定固定系统音色。原五位角色沿用原音色，改为交错短句、回应与打断；共42条MiniMax语音片段，全部通过供应商字幕与审定台词的规范化核验。
- FBI协助人员在混乱中给出短促控场口令，不提前讲诺拉的调查秘密，不宣布死因。宾客声分近远和左右方位，人群层使用实际宾客语音，不再重复截取主角的同一句惊叫。
- 枪声采用kurt在OpenGameArt发布的CC0实录素材，来源 https://opengameart.org/node/70780 。在7、18.4、18.78、48、74.2秒播放，响枪时短暂降低其他声部。前80毫秒的枪声RMS比同时段其他声部高21.24—22.94dB；编码后五处峰值约-1.9dBFS。该测量用于确认枪声没有被混音掩盖，不替代现场音响听感校准。
- B07字节保持原样，SHA-256仍为 `5ce115cdd8beaa12b8aae3760a0c8d40b9b4e22ba8592af1e4fbf72615584134`。
- 本地178项自动检查及页面播放回归通过。新版B06已上传私有OSS并完整回读核验，匿名对象访问403。
- 发布包 `output/releases/alsj-blackout-crowd-v3.tar.gz`，3,217,960字节，SHA-256 `69cc479b49cb698af75fec88f6f27e5e179c900c1c1282edb688946febe28d25`。
- 回滚目标为 `/opt/alsj_booking/releases/20261030T102153Z-1b09991-blackout`，用该目录的Compose环境启动旧应用后切回current，无需恢复数据库。
- 上线后B06/B07均完成GM授权后的OSS直连、完整SHA-256及Range 206核验；未登录入口401，验证会话已退出，容器healthy。
