# ECHO Game DISP v1.1

从当前小智屏幕固件派生的独立游戏板型。800×480、ESP32-S3、16MB Flash、8MB OPI PSRAM、GT911和ES8311引脚沿用现有硬件，未更改电气连接。

构建名 `echo-game-disp-v1`，Kconfig `CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1`，工厂由本目录 `DECLARE_BOARD(XLerobotDisp)` 提供（类名沿用硬件来源，构建仅链接一个工厂）。服务端口8901，设备配置隔离在 `echo_*` 命名空间。使用说明见本模块根目录README。
