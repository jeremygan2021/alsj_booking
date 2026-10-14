# NPC物料与3D线索更新

完整内容源：`server/story-materials.json`。使用说明：`交付包_阿拉斯加之夜/NPC与3D物料使用说明.md`。

## 角色与头像

| 原稿 | 代码ID | 姓名 | 头像 | 本版公开身份 |
|---|---|---|---|---|
| N00 | host | 阿德里安·索恩 | src/assets/npcs/host.webp | 庄园主人、ADS创始人 |
| N01 | attorney | 伊芙琳·维尔 | src/assets/npcs/attorney.webp | ADS首席人格架构师 |
| N02 | detective | 诺拉·里德 | src/assets/npcs/detective.webp | ADS外聘合规顾问；案发后揭示探员身份 |
| N03 | security | 里昂·默瑟 | src/assets/npcs/security.webp | ADS首席财务官 |
| N04 | scientist | 西奥多·布莱克 | src/assets/npcs/scientist.webp | 拍卖师、发布活动主持人 |
| N05 | singer | 克拉拉·沃克 | src/assets/npcs/singer.webp | 艺术策展人、瑟琳娜生前好友 |

旧代码ID保留。头像按代码现有关联复用，本次未重绘；旧头像外观及服饰与本版文字存在差异，独立包已注明。

## 内容与接入

- 每名NPC：公开小传、原稿第一人称故事、本人时间线、已知事实、未知/禁说内容、阶段证言、目标、道具及证据对照。
- 25条EV原稿证据映射到25个稳定E编号，另保留E-09手枪排除线索，共26组代码线索。
- 13类模型制作单包含外形、热点网格名、观察动作、格式、剧情边界及生成提示词；13类正式程序化GLB已生成。
- NPC工作台增加“我的NPC剧本”；GM NPC档案展示全部剧本和模型单。
- 正式GLB存在时选用，否则使用原三类示例GLB。模型查看器已接入观察点标记和镜头定位；六个验尸节点支持独立公开二维码。
- 固定v3迁移种子，新增v4增量迁移修正20:48刷卡/20:45邀约/20:55—21:04里昂会议等默认事实，保留GM编辑与既有ID。

本次为本地代码与物料更新，未执行线上部署。
