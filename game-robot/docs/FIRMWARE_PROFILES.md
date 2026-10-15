# 两套固件的选择与部署

本仓库包含游戏网站、ECHO云端后端和独立ESP32游戏固件。原小智/XLeRobot固件继续在原项目维护；根据当前用户目标选择，不根据最近构建目录或同名xiaozhi.bin猜测。

| 用户目标 | 选择 | 源码/服务 |
| --- | --- | --- |
| ECHO、游戏问答、庄园档案员NPC | echo-game，固件1.0.1-game | 本仓库game-robot/firmware；云端wss://alsj.luna.ski/echo/ws/device |
| 恢复原小智/XLeRobot功能 | xlerobot-persona，以已核验的原应用为准 | 原xiaozhi_hardware仓库product-firmware和原8899后端 |

游戏云端后端1.0.2-game与ESP32固件1.0.1-game各自独立发版。后端以Python/systemd运行；现有游戏网站沿用原有部署，二者通过同一域名的不同路由访问。ESP32只负责收放音、字幕、触屏和唤醒。

## 配置隔离

游戏使用echo_ws、echo_mqtt、echo_audio、echo_display、echo_board、echo_assets；原版使用websocket、mqtt、audio、display、board、assets。Wi-Fi、字体和唤醒模型共用。两版仍用“你好小智”唤醒；Tina离线应答嵌在游戏应用里。禁止用游戏地址覆盖原版地址，禁止为了切换配置而整片擦除。

## 构建

使用ESP-IDF6.1，在game-robot/firmware目录运行：

```bash
python scripts/build.py echo-game/echo-game-disp-v1 --name echo-game-disp-v1 --language zh-CN
```

源代码不包含设备令牌、Wi-Fi私密默认值或云端模型密钥。部署者按game_secrets.h.example准备被Git忽略的game_secrets.h，只写入设备接入令牌；模型密钥和GM令牌只保存在云端私有环境。含设备令牌的构建二进制不得公开提交或作为公共下载。

## 实体写入前后

1. 依据当前用户目标选profile、版本、源码和应用，核对SHA-256，不让“已连接USB”代替用户目标。
2. 枚举真实端口，确认芯片/MAC/容量。当前适配板为ESP32-S3、16MB Flash、8MB PSRAM、800×480 RGB/GT911/ES8311；其他设备重新核对。
3. 在新私有目录完整备份Flash，独立verify-flash核对。解析该快照的真实分区和OTA元数据，确定实际活动槽和真实原应用；备份不要提交Git。
4. 对比资源和分区表，只有相同布局/资源时才能只换应用。已核验参考布局ota_0在0x20000，资源在0x800000，但不能把参考偏移直接当作任何设备的写入目标。
5. 写后保持下载模式，独立验证新应用、保留配置及整个资源分区；读回配置逐字节比较，再启动设备并确认版本、屏幕/音频初始化、目标云端连接和真实收放音。
6. 恢复原小智应使用首次刷游戏前已核验的原版应用。本轮游戏更新前的ECHO1.0.0回退包不是原小智0.6.6。不要恢复整片旧NVS覆盖后续设置。

现场设备和私有恢复材料由部署机器单独记录。原工作站还在xiaozhi-disp-v1.1/docs/ESP32_CURRENT_PROFILE.md保存现场记录；其他机器应先找自己的记录，不假定本仓库携带那块设备的备份。

## 发布状态

固件1.0.1-game应用2,945,776字节，SHA-256为04a8d28fe19308b0760c93fde58338aec14c38e84fa30f0ecbfae3c398c13bdc；共用资源SHA-256为523838a9c0ce7f26a764d155ac2d80e6a794d2fd5b642e03fcc6aa9db1821161。该摘要只用于识别本轮已验证构建；部署者使用不同设备令牌重建后摘要会变化。

已完成构建、写入、独立校验、启动和一次本地Tina应答完整播放；现场听感和长期稳定性单独验收。详细证据见../VALIDATION.md和OFFLINE_VOICE.md。
