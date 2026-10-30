# 角色生成流式响应大小修复

2026-10-30 北京时间发布至 https://alsj.luna.ski/play。

- 修复提交：`0c046d8214c7bd44dd84ddabda0b2d8419b84858`，已推送至 `main`。
- 发布版本：`20261030T065526Z-0c046d8`，应用容器健康，镜像 revision 为上述提交。
- 基于原线上版本 `20261018T164740Z` 制作补丁，仅替换 `server/minimax-generation.js`，复用原版本的前端、依赖与其他资源；原发布目录保留用于回滚。
- 发布前数据库备份成功，`Result=success`、`ExecMainStatus=0`，完成于北京时间 14:54:23。

原实现将 SSE 每个分片的重复元数据和独立思考内容全部计入 150000 字节上限，导致正常的短角色正文也可能报“模型响应过大”。现将传输总量上限设为 8 MiB，实际拼接正文继续按 UTF-8 字节限制为 150000；保留剧情校验及私密字段隔离。

验证：

- 本地及新生产镜像内的角色生成模块、接口与规则回归均为 40 项通过。新增用例覆盖超过 150KB 的细碎 SSE 正常完成、思考不外泄、正文超限、传输超限和超限取消读取。
- 容器内模块 SHA-256 与本地修复文件一致：`5e1ae4904276238d0a8df8233994adacffc84222f4353f469e0d354b9c99867c`。
- 线上 `/api/public`、`/play`、`/ar`、`/admin` 均为 HTTP 200；匿名 POST `/api/character/inspire` 为 HTTP 401。
- 回归使用模拟模型响应及独立内存数据库，未创建生产测试报名或调用真实模型生成角色；尚未进行报错手机的实机复测。

本次服务端补丁不依赖前端重新构建。本地全量测试已有一项音频测试受中文目录 URL 路径解析影响，前端构建另受缺失 `public/payment/wechat-contact.jpg` 阻塞；这些问题未随本次补丁修改。

回滚：在 `/opt/alsj_booking/releases/20261018T164740Z` 执行 `docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --no-build`，再将 `/opt/alsj_booking/current` 指回该目录。无需恢复数据库。
