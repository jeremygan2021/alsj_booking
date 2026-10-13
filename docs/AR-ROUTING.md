# AR 页面路由

`/ar` 和 `/ar/` 是免登录二维码搜证入口，渲染 `PublicAR`，保留活动导航、证物模型、音乐和沉浸搜证。`/ar?clue=E-01` 直接展示对应基础线索，不依赖活动介绍或会话接口加载成功。

`/ar/demo` 和 `/ar/:sceneId` 通过 `ArScenePage` 懒加载原墙面定位场景组件。场景的浏览器前进后退会更新组件 key，卸载前一个相机/定位运行实例。`/ar/target` 由服务器提供定位海报 HTML。

合并代码时不要在 `App` 中为 `/ar` 提前返回未声明的 `ArPage`。曾发生的白屏是这一引用导致的 `ReferenceError`，当时 HTML、JS 和 API 都返回 200，容器健康检查也通过。发布前必须构建并运行浏览器回归，实际检查页面内容与脚本错误。

构建后应确认 `dist/ar-assets`、`dist/ar-target.html`、`dist/favicon.svg` 存在，再打包部署。生产保留原有 `.env`、短信配置和数据库；测试使用独立数据库或随机 PostgreSQL schema。
