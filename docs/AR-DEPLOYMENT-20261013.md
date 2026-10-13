# Web AR Docker 发布记录

发布日期：2026-10-13，北京时间23:14。站点：https://alsj.luna.ski

## 发布结果

- Docker Compose 应用容器：`alsj-booking`。
- 镜像：`alsj-booking:20261013T151410Z`，容器健康状态 `healthy`。
- 当前版本：`/opt/alsj_booking/releases/20261013T151410Z`。
- 保留的上一版：`/opt/alsj_booking/releases/20261008T152151Z`。
- 部署前数据库备份服务结果：`Result=success`、`ExecMainStatus=0`。
- 继续连接现有 PostgreSQL，未重建数据库服务。
- 发布前后公开活动状态均为第一幕、已报名1人。

## 线上入口

- [公开体验](https://alsj.luna.ski/ar/demo)
- [正式搜证](https://alsj.luna.ski/ar/wall-study)
- [定位海报](https://alsj.luna.ski/ar/target)

正式搜证仍受玩家登录、票务核验、签到、角色批准及第三幕权限约束。公开体验不写入正式证据册。

## 验证

本地10项接口测试、9项浏览器流程检查及生产构建通过。部署后进一步验证：

1. HTTPS加载实际GLB，3D预览与射线点击能打开体验证物。
2. HTTPS生产包中的MindAR通过合成视频输入完成识别、丢失、重新识别，相机关闭后媒体轨道结束。
3. 未登录访问正式场景API返回401。
4. 在线定位海报展示与打印页面正常。
5. GLB文件头及定位文件大小检查通过；线上浏览器无页面脚本异常。

报告：`output/playwright/ar-online/report.json`，截图位于同目录。模拟视频测试不替代手机实拍，现场仍需验证实际设备、光照、识别距离及误差。海报按A4、100%比例打印，整图18×24厘米。

## 回滚

```sh
cd /opt/alsj_booking/releases/20261008T152151Z
docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --no-build
sudo ln -sfn "$PWD" /opt/alsj_booking/current
```

回滚切换应用镜像，不恢复或覆盖数据库。本次发布包校验值：

```text
SHA256 491915730d1ba1d5518349d57c7256bcf7855639316817ad69b24b2be4f5a4f3
```

服务器登录信息未写入代码、环境示例、发布包或此记录。
