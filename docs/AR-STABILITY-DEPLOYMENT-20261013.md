# AR 稳定性与证物探索发布记录

2026-10-13 北京时间23:37，以 Docker Compose 发布至 https://alsj.luna.ski 。镜像 `alsj-booking:20261013T153752Z`，目录 `/opt/alsj_booking/releases/20261013T153752Z`。

本次增加图像位姿死区、时间平滑、突发跳变过滤和识别容忍；证物约1.1秒渐进取出，随后打开可拖动旋转、双指缩放的独立360度查看器。墙面模型与独立查看器的坐标分开。

规则测试11项、隔离生产构建的浏览器检查10项通过，含真实MindAR对合成摄像头视频的识别/移动/丢失/重识别、缓缓打开时长、360度拖动图像变化、正式证据册收录与相机生命周期。HTTPS线上另验证GLB、热点点击、渐进打开、360度视角变化和匿名访问正式场景的权限限制。手机真实环境的抖动改善仍需现场检验。

发布采用隔离目录：后端沿用23:14版本；后台与首页保持原版，避免将工作目录中另一轮未验证的内容管理改动混入。该轮本地改动未被覆盖。发布前执行数据库备份，活动继续保持第一幕。正式证据资格及幕数检查保持原规则。

线上入口：[体验](https://alsj.luna.ski/ar/demo)、[正式搜证](https://alsj.luna.ski/ar/wall-study)、[定位海报](https://alsj.luna.ski/ar/target)。

回滚到已验证的上一稳定版本：

```sh
cd /opt/alsj_booking/releases/20261013T151410Z
docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --no-build
sudo ln -sfn "$PWD" /opt/alsj_booking/current
```

本次发布包SHA256：`bb3f35a24567e290a7971ec21ba54a390d0b1c5b699fcfcbea6c51bf71a31ae3`。线上浏览器验证报告见 `output/playwright/ar/live-report.json`。
