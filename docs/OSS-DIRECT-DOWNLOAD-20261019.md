# 固定资源入口与 OSS 直接下载

发布 `20261018T162847Z-oss-direct`，前一版本 `20261018T160226Z` 保留。此次基于线上镜像增量发布四个服务端文件，不覆盖同时进行的角色配乐和其他界面修改。

## 最终访问方式

网页继续使用现有固定地址，例如 `/api/ar/models/aurora-trophy.glb`、`/api/ar/clues/E-01/audio`、`/api/staff/performance-audio/A12/file`，这些入口无需随签名更换。私密入口先完成登录、线索取得/鉴定、GM身份、录音所有者或角色修订检查，然后返回 HTTP 307，媒体字节由浏览器直接向 OSS 请求。个人录音和角色自我介绍同样直连，转写所需的服务端读取保持原样。

对象依然 private；OSS URL 的签名有效期约七天，固定入口每次鉴权后生成当前签名，不向前端发送 AccessKey Secret。HEAD 单独按 HEAD 签名，GET与Range共享 GET 签名。签名 URL 属于有效期内可使用的凭证，接口响应采用 private,no-store 和 no-referrer；网页不需要持久化签名。

## 配置与回退

服务端 `OSS_DIRECT_DOWNLOAD=true` 开启；设为 false 并重启应用即可恢复此前的 OSS 代理读取。静态文件版本不匹配、未配置 OSS 时继续使用本地副本。浏览器已跳转后的 OSS 故障无法由应用自动拦截，此时可关闭开关恢复代理方案。

Bucket 增加且仅增加 `https://alsj.luna.ski` 的 GET/HEAD 跨域规则及 Range 等读取请求头，不增加上传权限，不修改 Bucket 或对象 ACL，原规则完整保留。原配置备份 `/var/backups/alsj_booking/oss-cors-before-direct-20261019.xml`。

## 验证

- 18 项相关本地测试通过，覆盖签名、固定键与目标域名限制、鉴权先于跳转、无权限不下发链接、所有权与旧角色版本隔离、直连时应用不读取媒体内容，以及旧代理回退。
- 新镜像中 5 项独立回归通过；上线前使用真实 OSS 验证公开音频、正式模型、示例模型、GM终局音频的 GET/HEAD/Range 与 CORS。
- 线上 Chromium 实测完整 GLB 下载到浏览器，音频元信息、实际播放、拖动至第 10 秒成功，音频分段返回 206。
- 固定入口只返回几百字节的跳转响应；大文件请求目标为 OSS。

未变更前端打包、CDN域名、数据库内容、报名名单或活动阶段。
