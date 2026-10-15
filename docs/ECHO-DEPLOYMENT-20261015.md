# ECHO游戏机器人与网站发布

2026-10-15 23:42（北京时间）。

游戏固件源码、Realtime后端、知识库工具、NPC角色卡、Tina本地应答和首页角色故事已推送至jeremygan2021/alsj_booking的main。部署代码提交：`e73d19f3f23883924ccf507f95869438eb8acafa`。

| 项目 | 发布位置 | 版本/发布号 |
| --- | --- | --- |
| 游戏网站 | https://alsj.luna.ski | 20261015T153641Z；容器alsj-booking，healthy |
| ECHO云端后端 | https://alsj.luna.ski/echo/healthz | 1.0.2-game；20261015T153557Z-e73d19f3-echo；原生Python/systemd |
| ECHO ESP32固件 | 已刷入的USB设备 | 1.0.1-game；四段Tina本地唤醒应答，本次发布未再次刷写 |

网站沿用现有部署，ECHO仍以独立原生服务alsj-echo-game.service运行。两者均对应上述代码提交；没有将ECHO改成Docker服务。游戏固件源码仅在game-robot/firmware中维护，没有发布原小智/XLeRobot项目中其他任务的未提交代码。

## 核对结果

- 远端main已收到代码提交；固件源码和便携的固件选择说明一并提交。设备令牌、模型密钥、GM令牌、真实备份、私有固件二进制不进入Git。
- 网站61项测试与前端构建通过；ECHO22项后端测试通过；固件100项主机测试和前一轮ESP-IDF6.1构建/真机写入校验通过。
- 切幕测试补全模拟客户端关闭握手，再核对旧模型会话退出，避免TestClient直接取消导致错误。
- 网站镜像标签为代码提交，容器healthy；ECHO14个运行模块的服务器SHA-256均与本地提交源码匹配，SOURCE_REVISION记录同一提交。
- 生产1440与390宽度浏览器检查通过：ECHO的三段故事可见，六位原人物保留，无横向溢出，无页面异常，邀请入口正常打开。
- 新部署后两组真实云端Realtime试问通过：ECHO讲自己的庄园往事，并通过档案回答庄园主人是索恩。
- 游戏网站与AR公开接口均HTTP200，GM接口无令牌仍401；ECHO游戏状态保持revision1、第一幕、无公开证据。
- 网站部署前数据库备份Result=success、ExecMainStatus=0，未恢复或清空数据库。保留Nginx/证书及/echo/路由，nginx -t通过。
- 原网站版本20261015T062509Z和原ECHO版本20261015T151352Z-echo-npc仍保留，可按各自部署说明回退；回退应用不自动恢复数据库。

网站发布包SHA-256：`0bf13346b980905c267a829a46c23a2e1adec135823e70953e1c4441787f9ed6`。

ECHO后端发布包SHA-256：`c17a862d7da1c2836676daf7837948bfdbcec35b6ad8b8bf0b01dd238568b2c9`。

固件1.0.1-game应用SHA-256：`04a8d28fe19308b0760c93fde58338aec14c38e84fa30f0ecbfae3c398c13bdc`。该构建含部署设备令牌，仅留在私有交付目录；其他部署者根据源码和空配置模板构建自己的版本。固件与后端版本独立，不根据后端版本号猜测应刷文件。
