/**
 * 职责：冒烟检查。默认离线（自启动 fixture 服务或检查指定地址），--live 用于真实淘宝联盟调用验收。
 * 边界：离线模式不触网到联盟网关、不注入密钥；--live 只读取正在运行的服务，不自行发送任何凭据。
 * 调用方：npm run smoke、npm run smoke -- --live、Jenkinsfile（离线）。
 * 关键点：G0 真实调用验收必须使用 --live；CI 与默认模式始终离线。
 */
'use strict';

const assert = require('node:assert/strict');
const { createServer } = require('../server/server.cjs');

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const positional = args.filter(arg => !arg.startsWith('--'));
const DEFAULT_BASE = 'http://127.0.0.1:3000';
const PRICE_BASIS = ['CONFIRMED', 'ESTIMATED', 'UNKNOWN'];

async function get(base, path, options = {}) {
  const response = await fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(8000) });
  const contentType = response.headers.get('content-type') || '';
  return {
    status: response.status,
    contentType,
    json: contentType.includes('json') ? await response.json() : null,
    text: contentType.includes('json') ? '' : await response.text()
  };
}

async function waitForHealth(base, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    try {
      const response = await get(base, '/api/health');
      if (response.status === 200) return response.json;
      lastError = new Error('HTTP ' + response.status);
    } catch (error) { lastError = error; }
    if (Date.now() >= deadline) throw new Error('等待服务就绪失败：' + lastError.message);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

function assertV12Items(items, label) {
  assert.ok(Array.isArray(items), label + ' 没有返回商品列表');
  const serialized = JSON.stringify(items);
  for (const forbidden of ['priceFen', 'couponFen', 'click_url', 'coupon_share_url', 'purchaseActions', 'sourceUrl', 'demo-']) {
    assert.ok(!serialized.includes(forbidden), label + ' 仍含旧契约/演示字段 ' + forbidden);
  }
  for (const item of items) {
    assert.equal(item.platform, 'taobao', label + ' 出现非淘宝平台商品');
    assert.match(item.productRef, /^tbk\.[A-Za-z0-9_-]+$/, label + ' 商品引用不合法');
    assert.ok(typeof item.title === 'string' && item.title.trim(), label + ' 标题为空');
    assert.ok(typeof item.imageUrl === 'string', label + ' 缺少 imageUrl');
    assert.ok(PRICE_BASIS.includes(item.priceBasis), label + ' priceBasis 非法');
    if (item.currentPrice) {
      assert.equal(item.currentPrice.currency, 'CNY');
      assert.match(item.currentPrice.amount, /^\d+(\.\d{1,2})?$/);
    }
    if (item.finalPrice) {
      assert.equal(item.finalPrice.currency, 'CNY');
      assert.match(item.finalPrice.amount, /^\d+(\.\d{1,2})?$/);
    }
    assert.ok(item.coupon && ['AVAILABLE', 'NONE', 'UNKNOWN'].includes(item.coupon.availability));
    assert.ok(['ELIGIBLE', 'CONDITIONAL', 'UNKNOWN'].includes(item.coupon.eligibility));
    if (item.priceBasis === 'ESTIMATED') assert.equal(item.finalPrice, null, '条件价不得作为确定券后价');
  }
}

async function staticChecks(base) {
  const home = await get(base, '/');
  assert.equal(home.status, 200, '首页不可访问');
  assert.match(home.text, /id="product-grid"/);
  assert.match(home.text, /id="convert-form"/);
  assert.ok(!/示例商品|交互演示|领券预览|priceFen/.test(home.text), '页面仍有演示数据标记');
  const mobile = await get(base, '/mobile.html');
  assert.equal(mobile.status, 200);
  assert.match(mobile.text, /<iframe src="index.html"/);
  assert.match((await get(base, '/app.js')).contentType, /javascript/);
  assert.match((await get(base, '/core.js')).contentType, /javascript/);
  assert.match((await get(base, '/styles.css')).contentType, /css/);
}

async function commonChecks(base) {
  const health = await get(base, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.mode, 'live');
  assert.equal(health.json.liveImplemented, true);
  assert.ok(health.json.platforms.taobao.enabled);

  const platforms = await get(base, '/api/v1/platforms');
  assert.equal(platforms.status, 200);
  assert.equal(platforms.json.platforms.find(p => p.id === 'jd').enabled, false);
  assert.equal(platforms.json.platforms.find(p => p.id === 'pdd').enabled, false);

  const old = await get(base, '/api/products');
  assert.equal(old.status, 404, '旧 /api/products 应已移除');
  assert.equal((await get(base, '/api/v1/orders')).status, 404);

  const converted = await get(base, '/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'https://item.taobao.com/item.htm?id=12345' })
  });
  assert.equal(converted.status, 200);
  assert.equal(converted.json.product, null);
  assert.equal(converted.json.promotion, null);
  assert.equal(converted.json.mode, 'live');
}

async function offlineChecks(base) {
  await staticChecks(base);
  await commonChecks(base);
  const list = await get(base, '/api/v1/products');
  assert.equal(list.status, 200, '离线商品接口不可用');
  assert.equal(list.json.mode, 'live');
  assertV12Items(list.json.items, '离线商品列表');
  assert.ok(list.json.requestId);
  if (list.json.dataSource === 'fixture') assert.ok(list.json.notice, 'fixture 数据源必须显著标注');
  console.log(`离线冒烟检查通过：${list.json.items.length} 件商品，dataSource=${list.json.dataSource}，页面与 V1.2 契约均正常。`);
}

async function liveChecks(base) {
  const health = await get(base, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.mode, 'live', '目标服务仍是旧的 demo 服务，请先停止并以新代码重启');
  assert.equal(health.json.liveImplemented, true, '目标服务不是 V1.2 实现');
  assert.equal(health.json.ok, true, '真实验收前必须配置完整凭据');
  assert.equal(health.json.dataSource, 'taobao', '真实验收不能指向 fixture 数据源');
  assert.equal(health.json.upstream.status, 'READY', '上游状态不是 READY：' + JSON.stringify(health.json.upstream));

  await staticChecks(base);
  await commonChecks(base);

  const home = await get(base, '/api/v1/products?platform=taobao&feed=recommended&limit=20');
  assert.equal(home.status, 200, '真实首页推荐调用失败：' + JSON.stringify(home.json));
  assert.equal(home.json.dataSource, 'taobao');
  assert.ok(home.json.items.length > 0, '真实接口没有返回商品');
  assertV12Items(home.json.items, '首页推荐');
  assert.ok(!JSON.stringify(home.json.items).includes('SYN-TB-'), '真实响应里混入了合成测试数据');

  const search = await get(base, '/api/v1/products?query=' + encodeURIComponent('耳机') + '&limit=10');
  assert.equal(search.status, 200, '真实关键词搜索调用失败：' + JSON.stringify(search.json));
  assertV12Items(search.json.items, '关键词搜索');

  const disabled = await get(base, '/api/v1/products?platform=jd');
  assert.equal(disabled.status, 503);
  assert.equal(disabled.json.error.code, 'PLATFORM_NOT_ENABLED');

  const couponCount = home.json.items.filter(i => i.coupon.availability === 'AVAILABLE').length;
  const estimatedCount = home.json.items.filter(i => i.priceBasis === 'ESTIMATED').length;
  console.log('真实调用验收通过。');
  console.log(`  首页 ${home.json.items.length} 件，含券 ${couponCount} 件，条件预估价 ${estimatedCount} 件；搜索返回 ${search.json.items.length} 件。`);
  console.log('  示例标题：' + home.json.items[0].title);
  console.log('  请继续人工核对：公众号/浏览器打开 http://localhost:3000、微信开发者工具导入 miniprogram/。');
}

async function main() {
  if (LIVE) {
    const base = positional[0] || DEFAULT_BASE;
    console.log('真实调用验收（--live）：' + base);
    try { await waitForHealth(base); await liveChecks(base); }
    catch (error) {
      console.error('真实调用验收失败：' + error.message);
      console.error('请先按 G0 核对账号权限，配置 TAOBAO_* 与 QUANSHENG_* 环境变量，并以 QUANSHENG_UPSTREAM=live 重启服务。');
      throw error;
    }
    return;
  }

  if (positional.length) {
    console.log('离线契约检查（外部服务）：' + positional[0]);
    await waitForHealth(positional[0]);
    await offlineChecks(positional[0]);
    return;
  }

  // 默认：自启动离线 fixture 服务，不依赖任何外部进程或凭据。
  const server = createServer({ upstreamMode: 'fixture' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { await offlineChecks(base); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

main().catch(error => {
  console.error('冒烟检查失败。', error);
  process.exitCode = 1;
});
