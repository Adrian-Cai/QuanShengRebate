# 券省页面接口分析与联调清单

2026-11-12｜依据 `quansheng-local-debug.zip` 中的网页、小程序与演示服务，以及 V1.2 开发方案。

首批业务接口可以收敛为商品列表和查券转链两组。先用现有演示 API 跑通前端请求，再用相同的页面行为验收正式 `/api/v1` 接口。

## 1. 从页面动作找接口

针对每个动作记录「什么时候触发、页面要显示什么、数据从哪里来、用户等到什么结果」。同一数据源由同一个接口服务多个动作。

例如首页点「京东」时，需要返回京东商品的标题、主图、价格和优惠。点「数码好物」或提交「耳机」时，页面仍渲染同一张商品卡，只需更换列表查询参数。粘贴商品分享文案后提交则需要另一个接口，因为它要识别平台、查优惠和取得推广入口。

在本地启动项目后，可打开浏览器开发者工具的 Network，筛选 Fetch/XHR，再操作平台切换、关键词搜索和转链。当前网页由本地 JavaScript 渲染，操作时业务请求列表为空。接好 HTTP 之后，用相同动作核对请求和返回。小程序可以在开发者工具的网络面板做对应验证。

## 2. 当前页面和接口映射

| 页面 / 操作 | 当前行为 | 首批接口或本地处理 |
| --- | --- | --- |
| 网页首页 / 小程序首页首次加载 | 网页从 `web/core.js` 取示例，小程序从 `utils/core.js` 取示例 | `GET /api/products` 用于联调，目标 `GET /api/v1/products` |
| 切换淘宝、京东、拼多多 | 在本地示例数组里筛选 | 同一列表接口传 `platform` |
| 点击专题或分类 | 主题卡片切换商品分类筛选 | 同一列表接口传 `category`，专题展示文案可留在页面配置 |
| 输入关键词并点击搜索 | 本地按标题、店铺等字段匹配 | 同一列表接口传 `query`，搜索后刷新结果 |
| 切换排序 | 网页本地按价格或优惠金额排序，小程序现有首页无排序入口 | 网页列表接口传 `sort`，商品合约和平台支持范围确定后启用对应排序 |
| 点商品卡 | 网页用已有卡片数据打开预览，小程序带入示例链接跳转到转链页 | 预览复用列表数据。确认查券时用同一转链接口，正式版可提交 `productRef` |
| 粘贴链接、口令或分享文案 | 本地识别文本和平台，网页首页会带入转链页 | 粘贴、预识别和页面切换在客户端完成，提交时再请求 |
| 点击「查找优惠，预览转链」 | 当前两端从内置演示逻辑生成结果 | `POST /api/convert` 用于联调，目标 `POST /api/v1/conversions` |
| 查看优惠 / 复制 / 去购买 | 演示仅展示示例并允许复制演示说明 | 正式版显示转链响应中的优惠及购买动作，点击时由客户端执行返回的动作 |
| 最近记录、清空、领券指南 | 记录留在浏览器或微信本地存储，指南是静态文案 | 沿用本地能力。跨设备记录或后台编辑指南成为需求后，再设计对应接口 |
| 手机网页预览 `mobile.html` | 嵌入同一网页显示手机布局 | 共用网页接口 |

代码定位可查看 `web/app.js` 的 `renderGoods()`、`productDetail()` 和 `#convert-form` 提交处理，以及 `miniprogram/pages/home/index.js` 的 `loadProducts()`、`miniprogram/pages/convert/index.js` 的 `convert()`。

## 3. 调试包中已经可以调用的接口

| 方法与路径 | 入参 | 当前实测 |
| --- | --- | --- |
| `GET /api/health` | 无 | HTTP 200，`mode: demo`，`liveImplemented: false`。适合启动检查 |
| `GET /api/products` | `platform`、`category`、`query`、`sort` | HTTP 200。`platform=jd` 返回 4 条示例；加 `category=digital&query=耳机` 返回 1 条 |
| `POST /api/convert` | JSON `{ "text": "商品链接或分享文案" }` | 示例链接返回 `DEMO_RESULT` 和示例商品，`promotion` 为 `null` |

当前列表返回 `mode`、`items`、`notice`，示例商品价格是整数分 `priceFen` 和 `couponFen`。转链接口返回 `id`、`mode`、`platform`、`kind`、`status`、`product`、`promotion` 和 `notice`。服务器实现见 `server/server.cjs`，筛选规则见 `shared/core.cjs`。

实测普通京东链接返回 HTTP 200 和 `UPSTREAM_NOT_CONNECTED`，只识别到平台。空输入返回 HTTP 400 `EMPTY_INPUT`，不支持的域名返回 HTTP 400 `UNSUPPORTED_HOST`。`/api/v1/products` 当前返回 404，正式接口在方案阶段。

网页目前没有请求这三个接口。小程序 `miniprogram/utils/api.js` 已有 `wx.request` 封装，但 `miniprogram/app.js` 默认开启本地演示。它的网络分支要求 HTTPS 地址并且响应 `mode` 为 `live`，所以关掉 `useDemoData` 后会拒绝现有演示服务的响应。准备小程序网络联调时，应把数据读取方式和服务端运行模式做成两个独立配置。在小程序已配置的 HTTPS 服务上，调试配置可接收 `demo` 响应，正式配置继续要求 `live`。

用 PowerShell 直接调用现有服务。先在项目根目录运行 `npm start`，再在另一个终端运行以下命令。

```powershell
$base = 'http://localhost:3000'
Invoke-RestMethod "$base/api/health"
Invoke-RestMethod "$base/api/products?platform=jd"
$body = @{ text = 'https://item.jd.com/demo-jd-headphones.html' } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$base/api/convert" -ContentType 'application/json' -Body $body
```

## 4. 首批正式接口合约草案

沿用 V1.2 方案第 9 节的 `/api/v1` 前缀。下面给出页面需要的最小字段与请求示例，供前后端确认。

### 商品列表 `GET /api/v1/products`

- 首页首屏示例 `GET /api/v1/products?platform=jd&feed=recommended`。
- 搜索示例 `GET /api/v1/products?platform=jd&query=耳机&category=digital`。
- `platform` 使用 `taobao`、`jd`、`pdd`。先用有权限的一家联调，按选中的平台取数。当前原型的「全部」可继续用于演示。正式页面如保留跨平台总览，需另定各平台分页和失败展示。
- `query`、`category` 和 `sort` 按当前筛选传递。`cursor` 和 `limit` 用于正式分页，先确定每个平台支持哪些筛选与排序。按价格排序时，对不可比较的条件价保留价格说明。
- 返回 `items` 与 `nextCursor`，无结果使用空数组。商品卡需要 `productRef`、平台、标题、主图、现价、优惠及价格口径。商品内容来自联盟，后端做字段统一，`productRef` 用于再次查券或转链。

首个商品卡的示例响应如下。价格按 V1.2 的 `Money` 契约用十进制元字符串传递，演示接口的整数分在适配层转换一次。

```json
{
  "mode": "demo",
  "items": [{
    "productRef": "demo-jd-headphones",
    "platform": "jd",
    "title": "无线降噪头戴耳机",
    "imageUrl": "/assets/headphones.svg",
    "currentPrice": { "amount": "129.00", "currency": "CNY" },
    "finalPrice": { "amount": "99.00", "currency": "CNY" },
    "priceBasis": "ESTIMATED",
    "coupon": {
      "availability": "AVAILABLE",
      "eligibility": "CONDITIONAL",
      "discount": { "amount": "30.00", "currency": "CNY" },
      "conditions": ["演示优惠，实际使用需满足券规则"],
      "expiresAt": null
    }
  }],
  "nextCursor": null
}
```

资格或价格条件不明时可返回 `finalPrice: null`。前端用 `priceBasis` 和券条件展示已知信息，避免把条件价直接显示成确定到手价。

### 查券转链 `POST /api/v1/conversions`

链接和分享文案用同一个请求结构。

```json
{
  "input": { "kind": "share_text", "text": "用户粘贴的商品链接或分享文案" },
  "clientHint": "web"
}
```

首页商品在用户确认查券时提交商品引用。

```json
{
  "input": { "kind": "product_ref", "productRef": "demo-jd-headphones" },
  "clientHint": "wechat"
}
```

按 V1.2 约定携带 `Idempotency-Key`。输入和会话由后端校验，推广位由后端配置决定。`clientHint` 帮助选择展示方式，服务端按实际身份与渠道权限确定可用入口。

| 响应内容 | 页面用法 |
| --- | --- |
| `conversionId`、`mode`、`status`、`platform` | 记录此次结果并展示处理状态和所属平台 |
| `product` | 展示标题、图片、现价、到手价口径，缺失时展示已知状态 |
| `coupon` | 显示有券、无券、未知以及门槛和时效 |
| `purchaseActions` | 按接口提供的 `OPEN_WEB`、`OPEN_MINIPROGRAM`、`COPY_TEXT` 显示对应按钮 |
| `generatedAt`、`upstreamExpiresAt`、`refreshAfter` | 明确查询时间与购买入口的有效性 |

首批建议同步返回结果。有券可推广和无券可推广都可以是 `READY`，界面用 `coupon` 展示差异。平台明确无法推广时用 `NOT_PROMOTABLE`，对应购买动作列表为空。正式结果只能返回通过联盟和当前客户端权限验证的购买动作。演示响应持续标注为演示。

无效输入、平台不支持、上游权限缺失、上游超时和限流按 V1.2 第 9.6 节约定返回。若后续采用异步处理，再为 `PROCESSING` 增加 `GET /api/v1/conversions/{id}`，并校验当前会话是结果的所有者。

## 5. 三家联盟需要准备的资料

前端共用上述两个接口。联盟接入方为每个平台准备商品选品或搜索、商品及优惠查询、生成有效推广入口三个能力，并保存一份脱敏成功响应和失败响应，用于字段映射和联调。

| 平台 | 确认的接入方向 | 要实际验证的内容 |
| --- | --- | --- |
| 淘宝联盟 | 物料精选、物料搜索、万能转链 | AppKey、推广位、媒体权限及支持的分享输入。普通淘宝分享链接、联盟推广链接和淘口令的转链权限要按实际应用核对。[淘宝精选](https://developer.alibaba.com/docs/api.htm?apiId=62201) · [淘宝搜索](https://developer.alibaba.com/docs/api.htm?apiId=64759) · [淘宝转链](https://developer.alibaba.com/docs/api.htm?apiId=65409) |
| 京东联盟 | 商品及优惠券查询、通用推广链接 | AppKey、媒体和推广位、可用的商品标识、优惠与转链字段。分别拿到网站和小程序允许的购买入口样例。[京东联盟接口说明](https://jos.jd.com/jdunion) |
| 多多进宝 | 推荐、榜单或商品搜索，再生成推广入口 | 以应用控制台为准记录实际接口、商品标识、推广位、授权方式和支持渠道。官方资料中的接口名称和返回字段需要以账号实测确认。[多多进宝商品推广资料](https://commoncdn.yangkeduo.com/pdd_oms/2021-01-12/2e22638bda0b0f77479f89dab1de2988.pdf) |

各平台至少准备三种样例。有券可推广、无券仍可推广、商品失效或权限不足。网站与小程序分别核对返回的购买入口。密钥由服务端配置，前端只取得整理后的商品、优惠和购买动作。

## 6. 开发与验收顺序

1. 用现有 `/api/products` 和 `/api/convert` 验证两组样例。网页从 `renderGoods()` 和表单提交处接同源请求，商品预览改为读取已加载列表。小程序保留本地演示，同时准备独立的网络联调配置。
2. 确认列表筛选字段、商品引用、券条件、状态和购买动作。把已有演示样例适配为正式合约格式，前后端按同一份样例核对。正式版从商品卡进入转链页时，携带 `productRef` 并生成 `product_ref` 请求，手动粘贴仍使用 `share_text`。
3. 选择已开通权限的一家联盟，先接推荐或搜索，再接真实商品优惠与转链。对照联盟响应核对金额、资格、链接和渠道。
4. 真实链路验证后，按相同契约接入另外两家。专题后台、详情页、跨设备历史、订单看板、推广收益与提现按各自页面开发时补充。

| 首批验收 | 预期 |
| --- | --- |
| 切换平台、分类、搜索和排序 | 调用同一商品列表接口，参数与操作一致，快速切换时旧结果不会覆盖新选择 |
| 首页商品和手动粘贴链接 | 提交给同一转链接口，分别使用 `product_ref` 与 `share_text` |
| 页面空结果和上游失败 | 空列表、失效、无权限、超时各有可理解的反馈，用户可按提示重试或调整 |
| 优惠与入口 | 有券、无券、条件券按真实字段显示，前端只展示当前渠道支持的购买按钮 |
| 演示和正式联调 | 演示数据标识清晰，普通真实链接不会被示例商品替代 |

联盟订单同步由后端任务调用。推广中心页面开发后再接 `/api/v1/me/promotion-orders`、`/api/v1/me/earnings` 和 `/api/v1/me/withdrawals` 等接口，退款与提现规则沿用 V1.2 第 17 节。
