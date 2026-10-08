# 阿拉斯加之夜：最后的遗嘱

根据用户提供的TRPG策划V2构建的本地全栈首版。React响应式玩家页面 + GM导演后台 + NPC任务页面，Express服务端 + PostgreSQL持久化数据库（本地开发可使用SQLite）。当前项目为单场活动。

## 运行

需要Node.js 22.13+（已在本机Node 26.3测试）。

```sh
npm install
npm run dev
```

打开 http://localhost:3000 。玩家入口 `/play`，管理入口 `/admin`。首次启动生成 `.env`，工作人员密码随机生成，不包含默认公开密码。

```sh
node scripts/credentials.js
```

这个命令仅在本机显示GM及六NPC各自的账号密码。GM账号为 `gm`，NPC账号为 `npc:host`、`npc:detective`、`npc:security`、`npc:singer`、`npc:scientist`、`npc:attorney`。账号标识保留兼容：`host` 对应盖茨比、`singer` 对应黛西、`attorney` 对应维拉、`detective` 对应FBI探员、`security` 对应保镖、`scientist` 对应AI研究员。只将对应NPC口令发给对应工作人员；`.env`不提交版本控制。

```sh
npm test
npm run build
npm start
```

开发与生产均为同源API和HttpOnly Cookie会话。默认仅监听127.0.0.1；如需局域网测试设置 `HOST=0.0.0.0` 并在手机使用本机局域网IP地址。二维码基于当前访问域名生成，localhost二维码无法被其他设备访问。

## 已实现

- 公开活动首页、四幕介绍、六NPC公开档案、40人报名容量限制，GM可调整容量与门票参考价。
- 手机号/邮箱与密码报名登录、随机会话、密码scrypt哈希、7天会话有效期、登录限频、同源写入检查。
- 报名后专属邀请二维码；扫码仍要求登录对应玩家账号，二维码不承担永久鉴权。
- 角色背景填写、受控模板生成NPC关系/秘密/两项委托、GM批准及阵营分配；隐藏同伙最多3人，不随机分配。
- GM人工核验票务、幂等签到并发放3枚初始金币、调查组分配。
- NPC只能完成自己名下委托；首次完成记账发奖励，重复请求不重复领奖，第一幕自动奖励累计上限10金币（含签到）。
- 金币流水、GM金币调整、多人联盟集资的人工账本操作；余额不可负或低于已有竞拍预留额。
- 六件拍品、实时轮询竞拍价、领先竞拍余额预留、GM落槌、单次成交和背包发放。
- 十二张核心证据种子、现场二维码、内置相机扫码/图片识别/编号入口、密封卡3D翻牌、永久证据册。
- 基础证据第三幕取得，额外细节由服务端D20结果决定；每组每区仅一次主要鉴定，技能匹配+2，自然20自动取得进阶信息。
- 四幕切换、全场广播、玩家12秒/后台8秒轮询、GM紧急放行、证据内容和NPC背景编辑。
- 终幕道具使用登记（一次性）与GM现场执行；最终嫌疑人、动机/手段/机会三证、结局选择及投票统计。
- 全部工作人员操作记录，GM/NPC/玩家数据权限分离。

## 当前范围与待接入

**支付**：当前为线下付款 + GM人工核验，没有接入微信/支付宝支付、自动退款或短信。

**人物生成**：当前为受控模板，没有调用外部AI模型。真实AI接入需服务端密钥、生成约束和GM审核；接口返回 `generator: curated-template`，避免把模板伪装成AI生成。

**剧情**：采用策划方案的六NPC、四幕与十二张关键证据，证据措辞为开发种子，尚未完成精确分钟级时间线和36份独立角色剧本。需活动前由策划定稿。NPC图像目前为首字母档案封面，正式立绘可后续替换。

**庭审**：道具效果由GM在现场执行。命运重掷券当前登记使用后需GM现场裁定，系统不自动进行额外重掷。最终胜负也由GM审核三项证据和附加目标后裁定，统计页面不自动宣判。

**扫码**：证据册支持后置相机扫码、从二维码图片识别、手动输入编号；也可用手机系统/微信扫一扫打开线索链接。扫码后显示密封卡，点击翻牌时服务端检查登录、付款、签到、角色批准和剧情阶段；登录后保留原线索链接。相机需要HTTPS或localhost及浏览器授权；微信内置浏览器等若不能开启相机，可以用图片或编号。图像仅在本机识别，关闭扫描窗口或切后台会停止相机；扫码识别库按需加载。减少动态效果的系统设置会关闭翻牌过渡。

**运营**：单场活动。生产使用现有 PostgreSQL，按日执行数据库备份；本地未配置 `DATABASE_URL` 时使用 `data/alaska.sqlite`。广播为轮询；无密码找回、短信验证和多人转账事务。联盟集资先使用GM人工账本调整；正式运营前应添加批量集资流程。

## 部署配置

生产部署使用 Docker，仅运行应用容器，连接服务器已有的 PostgreSQL，不创建数据库容器。部署、备份、更新和回滚见 [deployment/README.md](deployment/README.md)。

`.env` 中设置 `DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE` 即可启用 PostgreSQL；不要将真实连接密码提交到代码库。连接池最多 3 个连接。首次启动创建数据表并填充缺失种子，重启不会覆盖 GM 编辑。修改 GM/NPC 主密钥时还应清空 sessions 表，使旧工作人员会话失效。

```sh
# 在具有创建测试 schema 权限的数据库上运行 PostgreSQL 集成测试
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/DATABASE' npm run test:postgres
```

测试在随机独立 schema 中运行，验证完成后删除测试 schema，不写入生产 public 表。覆盖完整玩法、数据持久化、事务回滚以及两个应用实例并发报名、签到和拍卖结算。本地 `npm test` 使用独立 SQLite 数据库。

## 目录

`src/`：页面、交互与样式。`server/content.js`：NPC/证据/拍品种子。`server/db.js`：数据库适配入口与本地SQLite结构。`server/postgres.js`：PostgreSQL结构与事务。`server/app.js`：鉴权与规则引擎。`tests/api.test.js`：独立内存数据库集成测试。`DESIGN.md`：视觉和内容约定。

技术资料：[Node SQLite](https://nodejs.org/api/sqlite.html)、[Vite](https://vite.dev/guide/)。

## VR 评估

当前现场玩法优先使用手机扫码与翻牌。若增加远程搜证，可先做360°全景网页；头显WebXR暂不列入必需功能。方案对比与实施条件见 [docs/WEB-VR-ASSESSMENT.md](docs/WEB-VR-ASSESSMENT.md)。
