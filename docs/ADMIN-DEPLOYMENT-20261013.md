# Admin Docker 发布记录

2026-10-13，北京时间23:41，通过现有Docker Compose上线。

- 入口：https://alsj.luna.ski/admin
- 应用容器：`alsj-booking`，状态`healthy`。
- 镜像：`alsj-booking:20261013T154145Z`。
- 当前版本：`/opt/alsj_booking/releases/20261013T154145Z`。
- 保留上一版：`/opt/alsj_booking/releases/20261013T153752Z`。
- 部署前备份服务成功，未重建PostgreSQL。
- 活动状态发布前后均为第一幕、已报名2人。

验证：本地12项测试、8项后台浏览器检查、服务器独立PostgreSQL schema中的管理员管理/持久化测试以及原报名/权限/事务/并发测试通过。线上admin登录及内容API返回200，未登录内容API返回401，报名列表不返回密码字段。线上未写入测试报名、角色卡、线索或场景配置。

管理员账号admin兼容原GM密码；新增内容管理中心覆盖报名资料、完整角色卡、线索、NPC、委托、拍品、广播、AR场景和首页文案。范围见[操作说明](ADMIN-OPERATIONS.md)。

发布包SHA256：`9cdbed09c8f101082bcab1904f1515bd8fd2f0dc4797559f23b3822c73fbeaf0`。

回滚：进入上一版目录，执行 `docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --no-build`，再将 `/opt/alsj_booking/current` 指回该目录。新增配置表可保留，不覆盖或恢复玩家数据库。
