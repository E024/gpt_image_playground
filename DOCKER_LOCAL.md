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

生产域名反向代理时，只代理前端端口：

```text
https://你的域名  ->  http://127.0.0.1:4017
```

不要把 `3018` 后端端口直接暴露给公网；compose 默认只让后端在 Docker 网络内被前端访问。宝塔/Nginx 反代到 `4017` 时，需要保留这些请求头：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Authorization $http_authorization;
proxy_set_header Cookie $http_cookie;
proxy_set_header X-Session-Token $http_x_session_token;
proxy_buffering off;
```

如果宝塔开启了反向代理缓存，请对 `/backend-api/` 关闭缓存。登录态接口已经返回 `Cache-Control: no-store`，代理层也不应缓存这些响应。

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
