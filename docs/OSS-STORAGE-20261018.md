# OSS 模型与音频存储试运行

已在 `tangledup-ai-staging`（上海区）上传 89 个资源：17 个 GLB 模型、58 个线索与节点音频、14 个现场音频，共 60,528,298 字节。包含 AR 示例场景模型。上传后每个文件均经过完整下载和 SHA-256 校验。

对象使用 `alsj/assets/v1/<sha256>.<扩展名>`，逐对象设置 private，不改变现有 Bucket 的 ACL、跨域或其他业务目录。没有上传剧本、数据库、密钥或内部制作稿。

`server/asset-storage.json` 记录本地资源与对象的对应关系；服务器从环境读取 `OSS_ENABLED`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`。密钥不放入清单、前端或 Git。第一组用户提供的凭据已被 OSS 禁用，实际使用第二组。

现有 API URL、搜证鉴权和正文匹配校验继续生效。授权通过后，服务端签名读取私有 OSS 对象并转发字节，支持 GET、HEAD 和 Range。签名与 OSS 凭据不发送到浏览器。`X-Asset-Storage: oss` 标识实际从 OSS 读取；未启用、文件版本不匹配或 OSS 在响应前不可用时返回本地副本，标识为 `local`。本地文件保留作回退，试运行不会减少服务器现存副本占用；流量仍经应用服务器。

重新上传：在服务端环境配置 `OSS_BUCKET`、`OSS_ENDPOINT` 和上述凭据，执行 `python3 scripts/upload-oss-assets.py`，校验全部完成后才原子替换清单。对象内容寻址，已有匹配对象不重复上传。更改资源后需重新上传并发布清单，版本不符时会继续使用新本地文件。

发布基于线上 `20261018T100158Z` 镜像叠加 6 个服务端文件，未覆盖工作区同时进行的短信和角色语音修改。当前发布 `20261018T155049Z-oss`；前一版本和生产环境备份均已保留。设置 `OSS_ENABLED=false` 后重启应用可恢复全部本地读取。

验证：12 项相关本地测试通过；上线前使用隔离内存数据库验证真实 OSS 音频、正式模型、示例模型的 Range 请求；匿名访问 OSS 的 MP3/GLB 均为 403，未登录访问高级音频和终局音频为 401。

上线后已通过公网完整下载校验 49 个公开资源（32 段基础音频和 17 个模型），全部返回 OSS 标识且 SHA-256 一致；玩家页返回 200。
通过 GM 登录进一步完整下载了 14 段现场音频，全部确认从 OSS 返回，SHA-256 与成片清单一致；验证会话已退出。临时凭据文件已删除。

## 2026-10-19：独立背景音乐原曲

另上传五首原曲：Darkest Child、At Rest、Awkward Meeting、Danse Macabre、Long note One，共 55,376,568 字节。它们与此前已上传的混音成片分别保存，复用内容寻址对象目录，逐对象设置 private。每首均完整下载核对 SHA-256，匿名读取均返回 403；五个本地 MP3 完整解码通过。

`server/audio/background-music.json` 记录曲名、对象键、文件哈希、原作者与授权信息；生产目录 `/var/lib/alsj_booking/background-music.json` 保留同一清单。带署名的清单也已上传到 OSS 的 `alsj/background-music/v1/` 目录。临时服务器原曲副本和上传归档已清理。

可使用 `scripts/upload-background-music.py <原曲目录> --output <清单路径>` 重新归档；凭据仍只从服务端环境读取。当前网页继续播放已含配乐的演绎成片；本次仅归档独立背景音乐，未增加单独播放或自动播放功能。
