# Docker 本地部署

上传完整源码后，在项目根目录执行：

```powershell
docker compose up -d --build
```

如果服务器访问 npm 官方源不稳定，可以显式指定镜像源：

```powershell
docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com
docker compose up -d
```

访问地址：

```text
http://localhost:4017
```

常用命令：

```powershell
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
docker compose restart
docker compose down
```

数据位置：

```text
docker-data/backend/backend.sqlite
```

这个目录保存后台用户、套餐、额度、流水、系统设置等 SQLite 数据。迁移或备份时保留 `docker-data/backend` 即可。
