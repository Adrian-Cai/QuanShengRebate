# 券省本地联调包

解压后进入 `quansheng-local-integration`，用 Node.js 启动网站和演示 API。包内包含微信原生小程序、Jenkins 构建流水线和 V1.2 开发方案。

## 启动网站和 API

使用 Node.js 22 或更高版本，在含有 `package.json` 的目录执行。

```bash
node --version
npm start
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。网页和 API 由同一个进程提供，直接运行即可，无需安装项目依赖。停止服务时按 Ctrl+C。直接双击 `web/index.html` 仍可离线预览，接口联调请使用上述地址。

| 地址 | 可调试的内容 |
| --- | --- |
| `http://localhost:3000/` | 精选商品、平台与专题筛选、搜索、转链预览 |
| `http://localhost:3000/mobile.html` | 手机双 Tab 布局预览 |
| `GET /api/health` | 查看当前运行模式和平台接入状态 |
| `GET /api/products?platform=jd` | 读取京东示例商品 |
| `POST /api/convert` | 识别链接并返回对应的演示结果 |

打开浏览器开发者工具的 Network 面板。点击京东筛选并搜索「耳机」，应看到 `GET /api/products?platform=jd&category=all&query=…` 和一张耳机商品卡。进入转链页提交示例链接时，应看到 `POST /api/convert`，请求体为 `{ "text": "…" }`。

在 Windows PowerShell 中，若 `npm` 被脚本执行策略拦截，可运行 `npm.cmd start`，也可直接运行 `node server/server.cjs`。

端口 3000 已占用时，可用另一个端口启动，再把浏览器和接口地址中的端口改为对应值。

```powershell
$env:PORT = '3001'
node server/server.cjs
```

macOS 或 Linux 可运行 `PORT=3001 node server/server.cjs`。服务读取进程环境中的 `PORT` 与 `AFFILIATE_MODE`，默认使用 3000 端口和 `demo` 模式。

## 调试演示 API

保持服务运行，另开 PowerShell 执行以下命令。

```powershell
$base = 'http://localhost:3000'
Invoke-RestMethod "$base/api/health"
Invoke-RestMethod "$base/api/products?platform=jd"
$body = @{ text = 'https://item.jd.com/demo-jd-headphones.html' } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$base/api/convert" -ContentType 'application/json' -Body $body
```

macOS 或 Linux 可用 curl。

```bash
curl http://localhost:3000/api/health
curl 'http://localhost:3000/api/products?platform=jd'
curl -X POST http://localhost:3000/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"text":"https://item.jd.com/demo-jd-headphones.html"}'
```

健康检查返回 `mode: demo`。示例链接 `https://item.jd.com/demo-jd-headphones.html` 返回 `DEMO_RESULT`、耳机商品和 `promotion: null`。普通链接 `https://item.jd.com/100001.html` 返回 `UPSTREAM_NOT_CONNECTED`，`product` 和 `promotion` 均为 `null`。空输入或不受支持的链接返回 HTTP 400。

在项目根目录运行自动化测试。保持服务启动后，可以另开终端运行冒烟检查。若服务改用 3001 端口，运行 `npm run smoke -- http://127.0.0.1:3001`。

```bash
npm test
npm run smoke
```

## 运行微信小程序

1. 在微信开发者工具中导入 `miniprogram` 目录。
2. 使用工具支持的测试号或游客模式，或选择自己的 AppID。
3. 离线预览保持 `useDemoData: true`、`useDemoApi: false`。编译后可预览「首页」和「转链查券」。
4. 联调时先启动 Node 服务，在 `miniprogram/app.js` 保持 `useDemoData: true`，设置 `useDemoApi: true` 和 `apiBase: 'http://127.0.0.1:3000'`，重新编译后在工具的网络面板核对请求。

本机 HTTP 仅适用于微信开发者工具的演示联调。若开发者工具拦截该请求，可用工具的本地调试设置允许请求，或将 `apiBase` 改为已配置为合法请求域名的 HTTPS 演示服务。真机联调使用 HTTPS 地址。已通过模拟 `wx.request` 测试验证适配层与本地服务的请求和返回，开发者工具及真机需在本地验收。

## 使用 Docker Compose

在已启动 Docker 的电脑上，进入包内根目录执行。

```bash
docker compose up --build
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。Compose 默认把端口发布到本机，停止并清理容器可运行 `docker compose down`。修改代码后可以重新运行构建命令。包内也保留 `Dockerfile` 供直接构建。

## Jenkins 构建与部署

1. 将解压后的项目提交到 Git，在 Jenkins 创建 Pipeline 任务，选择 **Pipeline script from SCM**，脚本路径填 `Jenkinsfile`。
2. 在安装 Git、Docker CLI 和 gzip，且能连接 Docker daemon 的 Linux Agent 上运行。首次构建需要能拉取 `node:22-alpine`。若 Jenkins 有多种 Agent，可将 `agent any` 改为 Docker 构建节点标签。
3. 触发 Build。流水线检出代码，构建 `quansheng-demo:<commit>-<build>`，在镜像内执行 `npm test`，再启动临时容器运行冒烟检查。成功后从 Jenkins 的构建归档下载以下三个文件。

| 文件 | 用途 |
| --- | --- |
| `quansheng-image.tar.gz` | 构建产出的 Docker 镜像 |
| `deploy.env` | 记录本次构建的镜像标签 |
| `compose.deploy.yaml` | 以该标签启动演示服务 |

在目标机器上将三个文件放在同一目录。目标机安装 Docker 和 Compose V2，然后执行。

```bash
docker image load -i quansheng-image.tar.gz
docker compose -p quansheng --env-file deploy.env -f compose.deploy.yaml up -d --no-build
curl --fail http://127.0.0.1:3000/api/health
```

健康检查应返回 `"ok": true` 和 `"mode": "demo"`。服务端口默认只绑定目标机的 `127.0.0.1:3000`。端口占用时可在 `deploy.env` 增加 `QUANSHENG_PORT=3001`，并用新端口做健康检查。回滚时从上一次成功构建取回三个文件并执行相同命令，保留 `-p quansheng` 以更新同一服务。

## 文件和实现进度

| 路径 | 用途 |
| --- | --- |
| `web/` | 网页源码、手机布局预览与图片 |
| `miniprogram/` | 微信原生双 Tab 小程序源码 |
| `server/` | Node.js 演示服务、接口测试、数据库表结构草案 |
| `scripts/smoke.cjs` | 对正在运行的服务检查页面、健康状态、商品筛选和三平台转链样例 |
| `shared/core.cjs` | 服务端的商品示例与链接识别逻辑 |
| `docs/quansheng-fullstack-development-plan.md` | 最新 V1.2 方案，包括联盟商品来源、转链、订单归因、分佣、退款与提现 |
| `docs/implementation.md` | 原型阶段的技术记录 |
| `compose.yaml`、`Dockerfile` | 容器启动配置 |
| `Jenkinsfile`、`compose.deploy.yaml` | 构建、验证、镜像归档和部署配置 |

## 缺口审查

| 检查项 | 本次处理 |
| --- | --- |
| 网页与后端 | 首页、筛选搜索和转链已调用同源 API，加入商品加载、失败重试和空结果提示 |
| 小程序与后端 | 默认离线预览，可切换到同一套演示 API，并校验服务端运行模式 |
| 联调与构建 | 加入冒烟检查、Jenkinsfile 和部署配置；Jenkins 与容器部署需在有 Docker 的节点验收 |
| 真实商品和推广 | 待核对首家联盟应用的商品、转链、推广位和订单权限，再实现对应适配器 |
| 订单与用户收益 | 待接入订单和退款数据后实现归因、分佣、退款冲减和提现；正式 `/api/v1` 契约见 V1.2 方案 |

当前工程以 `demo` 模式运行，商品、价格和优惠为示例。`AFFILIATE_MODE=live` 会拒绝启动。
