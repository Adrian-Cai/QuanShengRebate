# 券省本地调试包

解压后进入 `quansheng-local-debug`，用 Node.js 启动网站和演示 API。包内同时提供微信原生小程序和 V1.2 开发方案。

## 启动网站和 API

使用 Node.js 22 或更高版本，在含有 `package.json` 的目录执行。

```bash
node --version
npm start
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。网页和 API 由同一个进程提供，直接运行即可，无需安装项目依赖。停止服务时按 Ctrl+C。

| 地址 | 可调试的内容 |
| --- | --- |
| `http://localhost:3000/` | 精选商品、平台与专题筛选、搜索、转链预览 |
| `http://localhost:3000/mobile.html` | 手机双 Tab 布局预览 |
| `GET /api/health` | 查看当前运行模式和平台接入状态 |
| `GET /api/products?platform=jd` | 读取京东示例商品 |
| `POST /api/convert` | 识别链接并返回对应的演示结果 |

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

健康检查返回 `mode: demo`。使用 `demo-` 示例商品链接会返回样例商品，其他受支持的链接只返回平台识别结果，`product` 和 `promotion` 为 `null`。网页和小程序各自使用内置示例数据，修改服务端 API 时可用上述请求单独验证。

在项目根目录运行原有自动化测试。

```bash
npm test
```

## 运行微信小程序

1. 在微信开发者工具中导入 `miniprogram` 目录。
2. 使用工具支持的测试号或游客模式，或选择自己的 AppID。
3. 保持 `miniprogram/app.js` 中的 `useDemoData: true`，编译后可预览「首页」和「转链查券」。

小程序演示使用本地数据与图片，可以独立预览。正式接入时需要配置后端 HTTPS 合法请求域名，并在自己的 AppID 下验证跳转和审核。此包的验收使用源码和配置检查，微信开发者工具及真机编译由你本地完成。

## 使用 Docker Compose

在已启动 Docker 的电脑上，进入包内根目录执行。

```bash
docker compose up --build
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。Compose 默认把端口发布到本机，停止并清理容器可运行 `docker compose down`。修改代码后可以重新运行构建命令。包内也保留 `Dockerfile` 供直接构建。

## 文件和实现进度

| 路径 | 用途 |
| --- | --- |
| `web/` | 网页源码、手机布局预览与图片 |
| `miniprogram/` | 微信原生双 Tab 小程序源码 |
| `server/` | Node.js 演示服务、接口测试、数据库表结构草案 |
| `shared/core.cjs` | 服务端的商品示例与链接识别逻辑 |
| `docs/quansheng-fullstack-development-plan.md` | 最新 V1.2 方案，包括联盟商品来源、转链、订单归因、分佣、退款与提现 |
| `docs/implementation.md` | 原型阶段的技术记录 |
| `compose.yaml`、`Dockerfile` | 容器启动配置 |

**可运行代码是演示原型。** 商品、价格和优惠为示例，联盟真实适配器、订单同步、用户分佣和提现是 V1.2 的后续实现项。演示可直接启动，数据库表结构草案供开发参考。

`AFFILIATE_MODE=live` 会拒绝启动。接通真实转链前，需要完成正式适配器并使用获得权限的联盟账号联调。
