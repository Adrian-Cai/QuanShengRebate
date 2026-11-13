# 券省 · 淘宝联盟实时商品版（V1.2 契约）

网站与微信小程序现在**只从淘宝联盟官方接口取数**，不再包含任何演示商品、demo 模式或整数分金额契约。
京东联盟、多多进宝 **未开放**（tab 置灰）；正式转链 `/api/v1/conversions`、领券购买入口、订单同步与佣金结算均**未实现**。

> ⚠️ **G0 尚未完成**：本机没有 `.env`，环境变量里也没有 `TAOBAO_*` 凭据，因此**没有做过一次真实 TOP 网关调用**。
> 本次交付的是契约、适配器、页面与离线测试；真实联调与字段映射复核必须由账号持有者完成，见「真实调用验收」。
> 缺凭据时服务仍可启动，但 `/api/v1/products` 返回 **503 `UPSTREAM_PERMISSION_MISSING`**，绝不会回退到示例数据。

## 1. 环境变量

服务只从**进程环境 / 容器 / 部署平台**读取配置，不会自动加载 `.env` 文件。可以 `.env.example` 为模板，用部署平台注入；**不要把真实密钥写进仓库、镜像、日志或聊天**。

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `QUANSHENG_UPSTREAM` | 否 | `live`（默认，真实调用）/ `fixture`（离线合成测试数据源，仅测试与 CI） |
| `PORT` | 否 | 默认 3000 |
| `TAOBAO_APP_KEY` | live 必需 | 淘宝联盟应用 AppKey |
| `TAOBAO_APP_SECRET` | live 必需 | App Secret，仅服务端使用 |
| `TAOBAO_ADZONE_ID` | live 必需 | 推广位 PID 末段数字 |
| `TAOBAO_MATERIAL_ID_RECOMMEND` | live 必需 | 首页推荐物料 ID，**账号相关，代码不写死候选值** |
| `QUANSHENG_PRODUCT_REF_KEY` | live 必需 | 服务端 HMAC 密钥，用于 `productRef` 与 `nextCursor` 签名 |
| `TAOBAO_SITE_ID` | 否 | 精选/物料接口需要时填写 |
| `TAOBAO_MATERIAL_ID_SEARCH` | 否 | 关键词搜索物料 ID；留空则不透传该参数 |
| `TAOBAO_GATEWAY` | 否 | 只允许固定白名单内的官方 TOP 网关，默认 `https://gw.api.taobao.com/router/rest` |
| `TAOBAO_SIGN_METHOD` | 否 | `md5`（默认）或 `hmac`，按账号实测确认 |
| `QUANSHENG_CACHE_TTL_MS` | 否 | 30000–120000，默认 45000 |
| `QUANSHENG_UPSTREAM_TIMEOUT_MS` | 否 | 1000–30000，默认 8000 |

京东联盟、多多进宝**未开放**，无需配置。`AFFILIATE_MODE` 已彻底移除。

## 2. 启动与离线验证

要求 Node.js ≥ 22，零第三方依赖，无需 `npm install`。

```bash
node --version
npm test          # 36 项离线契约测试，不触网、不注入密钥
npm run smoke     # 自启动离线 fixture 服务并跑冒烟检查
npm start         # 启动同源网站 + API，默认 http://localhost:3000
```

`npm run smoke` 默认自己启动一个 `fixture` 服务，不依赖 `npm start`。若要检查已经启动的服务：

```bash
npm run smoke -- http://127.0.0.1:3000
```

浏览器打开 [http://localhost:3000](http://localhost:3000)，`web/mobile.html` 是 iframe 的手机布局预览。
**不能直接双击 `web/index.html`**：`file://` 下无法调用同源 API，页面会明确提示先启动服务。

### 关于 `fixture` 数据源

`QUANSHENG_UPSTREAM=fixture` 是**显式开启的离线测试缝**，用于让 CI 与 `npm test` 在无密钥时仍能验证契约。
它的响应带 `dataSource:'fixture'` 与 `notice`，网页顶部会显示醒目提示，`/api/health` 的 `upstream.status` 为 `FIXTURE`。
**它不是真实联盟数据，不是上游失败时的兜底，生产环境必须使用 `live`**。Dockerfile 与 Compose 已固定 `QUANSHENG_UPSTREAM=live`。

## 3. HTTP 接口（V1.2 正式契约）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | `mode:'live'`、`liveImplemented:true`、`dataSource`、上游状态与平台开放状态 |
| GET | `/api/v1/products` | 商品列表；参数 `platform / feed / query / sort / category / cursor / limit` |
| GET | `/api/v1/platforms` | 平台开放状态（taobao 开放，jd / pdd 未开放） |
| POST | `/api/convert` | **仅链接与平台识别**；`product` 与 `promotion` 恒为 `null` |
| GET | `/api/products` | **已移除**，返回 404 `NOT_IMPLEMENTED` |
| GET/POST | `/api/v1/*` 其他路径 | 404 `NOT_IMPLEMENTED` |

商品对象（`Money = { amount: 十进制元字符串, currency:'CNY' }`）：

```json
{
  "platform": "taobao",
  "productRef": "tbk.<HMAC 签名，不透明>",
  "title": "商品标题",
  "imageUrl": "https://img.alicdn.com/...",
  "currentPrice": { "amount": "79.00", "currency": "CNY" },
  "finalPrice": { "amount": "69.00", "currency": "CNY" },
  "priceBasis": "CONFIRMED | ESTIMATED | UNKNOWN",
  "priceConditions": [],
  "priceNote": "",
  "coupon": {
    "availability": "AVAILABLE | NONE | UNKNOWN",
    "eligibility": "ELIGIBLE | CONDITIONAL | UNKNOWN",
    "discount": { "amount": "10", "currency": "CNY" },
    "conditions": ["满99元可用"],
    "expiresAt": "2026-12-31T23:59:59+08:00"
  },
  "category": "家居",
  "store": "店铺名或 null"
}
```

**价格口径**：只有券资格明确且到手价路径不含凑单 / 需买 N 件 / 跨店满减等条件时，才给 `CONFIRMED` 的 `finalPrice`；
含条件时 `finalPrice: null` + `priceBasis: 'ESTIMATED'` 并写明条件；缺价 `UNKNOWN`。金额全程十进制字符串，减法必须经整数分中转。

**商品列表不下发** `click_url` / `coupon_share_url` / `purchaseActions` 等任何购买入口；商品卡点击只展示详情，不伪装成可领券购买。

错误码（HTTP 语义见 `docs/quansheng-fullstack-development-plan.md` §9.6）：

| code | HTTP | 含义 |
| --- | --- | --- |
| `UPSTREAM_PERMISSION_MISSING` | 503 | 凭据/权限未就绪或上游权限错误 |
| `UPSTREAM_TIMEOUT` | 504 | 上游超时 |
| `UPSTREAM_RATE_LIMITED` | 503 | 上游限流 / 配额 |
| `UPSTREAM_ERROR` | 502 | 其他上游错误 |
| `PLATFORM_NOT_ENABLED` | 503 | 请求了未开放平台 |
| `INVALID_INPUT` / `INVALID_CURSOR` | 400 | 参数或分页游标非法 |
| `NOT_IMPLEMENTED` | 404 | 未实现的接口（含旧 `/api/products`） |

## 4. 真实调用验收（G0，需你完成）

代码已就绪，但**账号侧核对与真实调用必须由你执行**：

1. 在淘宝联盟控制台确认：应用角色（推广者 `taobao.tbk.dg.*` vs 服务商 `taobao.tbk.sc.*`）、升级版接口权限包、
   `app_key / app_secret`、推广位 PID 三段、可用 `material_id`、关键词搜索 `q` 的比价场景权限、TOP 网关与签名方式。
2. 把确认后的值通过环境变量注入（不要发到聊天、不要写进仓库），设置 `QUANSHENG_UPSTREAM=live`。
3. **先真实调用一次**，把成功的响应脱敏后另存为 `docs/fixtures/taobao-material-sample.json`（本次未创建，见「待确认」）。
   同时保存权限截图 / 文档版本 / 错误码样例，作为字段映射依据。
4. 按实测响应复核 `server/upstream/mapper.cjs` 的容器解析与字段映射（当前按公开字段做宽容解析，**尚未经你的账号验证**）。
5. 验收：

```bash
npm test
npm run smoke
npm start                      # 另开终端、已注入凭据
npm run smoke -- --live        # 真实调用验收：真实标题/价格/券、搜索、平台状态、无示例残留
```

6. 浏览器打开 `http://localhost:3000`，并在微信开发者工具导入 `miniprogram/` 核对（真机还需 HTTPS 合法域名与备案）。

CI 与 `npm test` 始终离线，不注入密钥；真实调用验收应另设受控人工流程。

## 5. 小程序

1. 微信开发者工具导入 `miniprogram/` 目录，选择测试号或自己的 AppID。
2. 在 `miniprogram/app.js` 配置 `globalData.apiBase`：
   - 开发者工具本地联调：`apiBase: 'http://127.0.0.1:3000'`、`allowLocalHttpInDevTools: true`（真机强制 HTTPS，会拒绝本地 HTTP）。
   - 真机/上线：已备案并配置为 `request` 合法域名的 HTTPS 地址，`allowLocalHttpInDevTools: false`。
3. 外链主图来自阿里 CDN，需在小程序后台配置 `downloadFile` 合法域名；若防盗链导致加载失败，`productImage()` 会回退本地占位图。
4. 未配置 `apiBase` 时页面明确报错，不会回退任何内置商品。

## 6. Docker / Jenkins / 部署

```bash
# 需要已在环境中注入全部 TAOBAO_* 与 QUANSHENG_PRODUCT_REF_KEY，否则 Compose 会以 :? 必填校验拒绝启动
docker compose up --build
```

`Dockerfile` 固定 `QUANSHENG_UPSTREAM=live` 且镜像内不含密钥。`compose.deploy.yaml` 从目标机运行时环境读取密钥，
`deploy.env` 只记录镜像标签。

Jenkins 流水线全程离线：`npm test` → 启动 `QUANSHENG_UPSTREAM=fixture` 临时容器 → `node scripts/smoke.cjs http://127.0.0.1:3000` → 归档镜像与 `deploy.env`。
**CI 不注入密钥、不调用淘宝网关、不因缺凭据失败**。真实调用验收需另设受控人工 stage，不要放进默认流水线。

## 7. 文件清单

| 路径 | 用途 |
| --- | --- |
| `server/server.cjs` | 同源 HTTP 服务（静态站点 + V1.2 API + 链接识别占位） |
| `server/catalog.cjs` | 编排：平台开放状态、查询规范化、分页游标、缓存、凭据检查 |
| `server/upstream/config.cjs` | 环境变量校验、网关白名单、日志脱敏 |
| `server/upstream/taobao-client.cjs` | TOP 签名、POST form、超时、错误码分类 |
| `server/upstream/mapper.cjs` | 上游字段 → V1.2 映射、金额、券、到手价口径、`productRef` |
| `server/upstream/cache.cjs` | 45 秒短缓存、同键单飞、失败不缓存 |
| `server/upstream/fixture.cjs` | **离线合成测试数据**（仅测试/CI，显式开启，显著标注） |
| `shared/core.cjs` | 服务端链接/平台识别（不含商品数据） |
| `web/core.js`、`web/app.js`、`web/index.html`、`web/styles.css` | 网页：真实商品卡、券条件、错误分区、加载更多 |
| `web/mobile.html` | iframe 手机布局预览（自动继承首页，未改动） |
| `miniprogram/utils/{core,api}.js`、`app.js`、`pages/{home,convert}/*` | 小程序：V1.2 契约、平台识别占位 |
| `server/*.test.cjs` | 4 组离线契约测试（36 项） |
| `scripts/smoke.cjs` | 离线冒烟 + `--live` 真实调用验收 |
| `.env.example`、`.gitignore`、`Dockerfile`、`compose*.yaml`、`Jenkinsfile` | 配置、构建与部署 |
| `docs/*.md` | V1.2 方案与原型阶段技术记录（本次未改动） |
| `server/schema.sql` | 数据库表结构草案，未执行 |

## 8. 缺口审查与待确认

| 检查项 | 状态 |
| --- | --- |
| 网页 / 小程序商品来源 | 已改为 `GET /api/v1/products`，无内置商品副本；京东/拼多多 tab 置灰 |
| 金额与价格口径 | Money 十进制字符串、条件价 `ESTIMATED` + `finalPrice:null`、整数分中转 |
| 凭据安全 | 仅服务端环境变量；日志脱敏；不进前端 / 仓库 / CI |
| 上游失败 | 分类错误码 + 分区提示，**绝不回退示例数据** |
| `docs/fixtures/taobao-material-sample.json` | **未创建**：计划要求「先真实调用、后留 fixture」，当前无凭据，不能伪造「真实响应样本」 |
| 字段映射 | 按公开字段实现，**待 G0 真实响应复核**；`final_promotion_path_list` 解析做了宽容处理 |
| 真实调用 / `--live` 验收 | **未执行**，需 `TAOBAO_*` 凭据与账号权限 |
| 浏览器 / 微信开发者工具 / 真机 | **未人工验收**，需在本机打开与导入 |
| `/api/v1/conversions`、领券购买、订单同步、佣金 | 范围外，未实现；接口留白 |
| 京东联盟 / 多多进宝适配器 | 范围外，未实现；tab 已禁用 |

**计划内需要确认的冲突**：计划同时要求「彻底移除示例数据、生产失败不回退样例」与「smoke 默认 `QUANSHENG_UPSTREAM=fixture` 离线数据源」。
本次按保守口径实现：fixture 必须显式开启、响应与页面显著标注、仅用于测试与 CI、生产固定 `live`、上游失败绝不切换到 fixture。
若你希望**完全移除运行时 fixture 数据源**（改用纯测试内 fixture），需要调整 `scripts/smoke.cjs` 与 Jenkins 的 smoke 策略。

另：计划引用的 `docs/quansheng-page-api-preparation.md:61-94` 存在于 GitHub 仓库，但本次实施时的本地工作区缺少该文件（由压缩包还原时未包含），
已在本次提交前从远程恢复，未做修改。其 `/api/v1/products` 最小字段示例
（`productRef / imageUrl / currentPrice / finalPrice / priceBasis / coupon / nextCursor`）与本次实现一致；
字段口径仍以计划内映射表与 V1.2 §9.5/§9.6 为准。
