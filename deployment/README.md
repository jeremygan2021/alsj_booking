# Docker 部署

线上地址 https://alsj.luna.ski ，玩家 `/play`，GM/NPC `/admin`。

仅运行 `alsj-booking` 应用容器，连接现有 `pg` 容器中的 `alsj` 数据库，加入现有 `1panel-network`。Compose 不管理 PostgreSQL 的生命周期。应用限制 256 MB，连接池最多 3 个连接，使用轮询更新。

## 目录与服务

- `/opt/alsj_booking/releases/<UTC时间>`：每次部署的代码和已构建前端。
- `/opt/alsj_booking/current`：当前版本符号链接。
- `/var/lib/alsj_booking/.env`：数据库连接和随机工作人员口令，权限 600。只读挂载进应用。
- `/var/backups/alsj_booking/`：PostgreSQL custom 格式备份，权限 600，保留约14天。
- `/etc/nginx/conf.d/alsj.luna.ski.conf`：域名、HTTPS及本机3206端口反向代理。
- `alsj-backup.timer`：每天北京时间03:00，随机延迟最多5分钟；不停止 PostgreSQL。
- `certbot.timer`：证书自动续期，续期后 reload Nginx。

应用端口仅绑定 `127.0.0.1:3206`，Docker 自动重启策略为 `unless-stopped`。服务器已有其他项目不受 Compose 管理。

## 首次部署

服务器需已有 Docker、Compose、Nginx、certbot，域名 A 记录指向服务器；已有 `pg` 容器、数据库账号及 `1panel-network`。先在 `/var/lib/alsj_booking/.env` 配置 `DATABASE_URL`，安装脚本不会创建 PostgreSQL 或写入数据库密码。

本地 `npm ci && npm test && npm run build` 后，打包 `package.json package-lock.json server scripts dist deployment README.md Dockerfile .dockerignore` 上传到服务器 `/tmp/alsj-booking-release.tar.gz`，通过 SSH 执行 `deployment/install-docker.sh`。脚本生成工作人员随机口令（若已有配置则保留）、构建应用、检查接口、配置域名证书、启用备份。

使用官方 `node:24.21.0-bookworm-slim` 作为运行镜像，复用构建缓存。

## 日常操作

```sh
cd /opt/alsj_booking/current
# --env-file 固定当前版本镜像，防止误用 latest
 docker compose --env-file deployment/.env -f deployment/compose.yaml ps
 docker compose --env-file deployment/.env -f deployment/compose.yaml logs --tail 100 app
 docker compose --env-file deployment/.env -f deployment/compose.yaml up -d
 docker exec alsj-booking node scripts/credentials.js
 sudo systemctl start alsj-backup.service
 sudo systemctl list-timers alsj-backup.timer
```

工作人员口令仅在可信终端查看和分发。不要在日志中打印 `.env`、Docker inspect 完整环境或数据库连接字符串。

## 更新与回滚

更新重复打包和安装流程；生产数据库位于已有 PG，应用重新构建不会清空数据。部署前可执行一次备份。

回滚时选择已保留的版本目录，使用该目录的 `deployment/.env` 启动应用，再更新 current 符号链接：

```sh
cd /opt/alsj_booking/releases/<之前版本时间>
docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --no-build
sudo ln -sfn "$PWD" /opt/alsj_booking/current
```

回滚只切换应用镜像，不自动还原数据库。数据库恢复会覆盖数据，应先做当前备份，再由管理员使用现有 `pg` 容器的 `pg_restore` 执行。备份可用 `docker exec -i pg pg_restore --list < /var/backups/alsj_booking/<文件>.dump` 检查；不要为恢复新建 PG 容器。
