# MiniMax角色与现场演绎发布

2026-10-18 17:16（北京时间）发布至 https://alsj.luna.ski。

- 应用版本：`20261018T091632Z`；代码提交 `a27a77c2653b53073eeae563d2604bd6eaf20a3a`，Docker健康状态 `healthy`。
- 上一版保留为 `/opt/alsj_booking/releases/20261018T090807Z-sms188888`。部署前PostgreSQL备份成功：`Result=success`、`ExecMainStatus=0`。
- 服务端已配置MiniMax `MiniMax-M2.5` / `image-01`。密钥只保存在服务器持久化环境文件，权限600，供容器用户读取；未进入Git、前端或发布归档。Nginx网站代理等待时间调整为210秒，保留ECHO独立路由。
- `/play`提供一键生成可修改的头像、姓名与故事草稿。原样提交复用同一批NPC关联，GM可查看完整保存档案；角色审核与玩家资格规则继续有效。
- `/admin`的“现场演绎音频”纳入更新交付包14段MiniMax固定角色音色成片，共1363.488秒，含背景音乐和音效；A10/A11/A12默认折叠。未重复调用TTS制作已有成片。
- 保留本次同时完成的后台付费手机号导入及之前已部署的快捷登录配置；未导入真实付费名单。

验证：

- 77项接口、规则与模块回归通过；前端生产构建成功。新增浏览器回归通过，覆盖生成失败保留、重试、人工提交、14段实际MP3互斥播放、退出停播、终局折叠、下载与390像素布局。
- 一例真实MiniMax文本与图片完整生成成功：448字故事、3名NPC关联、512px WebP。没有将测试人物写入生产报名库。
- PostgreSQL验证通过，使用独立随机schema，未读写生产public表。
- 线上 `/api/public`返回 `provider=MiniMax`、`configured=true`、`inspiration=true`；GM清单14段、8组固定音色，14个MP3的Range读取全部206且类型为audio/mpeg、私有缓存策略正确。
- 匿名请求现场清单和终局MP3均401；验证GM会话已退出。ECHO健康接口200，版本1.0.2-game。
- `nginx -t`通过；现有数据库、账号及ECHO独立服务保留。

发布归档：`output/releases/alsj-minimax-20261018.tar.gz`，62,286,661字节。

SHA-256：`481f750b9df656211935af35f0e35b8ebc8204174a15445014414b9593b29a45`。
