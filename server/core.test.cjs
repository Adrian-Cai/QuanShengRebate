/**
 * 职责：离线验证链接识别边界 + V1.2 HTTP 契约（health / products / platforms / convert / 静态资源）。
 * 边界：不触网到淘宝网关；服务端用 fixture 数据源或空凭据 live 配置注入，不读取真实环境变量。
 * 调用方：npm test。
 * 关键点：旧 /api/products 必须 404；正式模式不再拒绝启动；缺凭据 503 且绝不回退商品数据。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('../shared/core.cjs');
const config = require('./upstream/config.cjs');
const { createServer } = require('./server.cjs');

async function withServer(options, fn) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { return await fn(base); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function convert(base, text, contentType = 'application/json') {
  return fetch(base + '/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: typeof text === 'string' && text.startsWith('{') && contentType === 'application/json' ? text : JSON.stringify({ text })
  });
}

test('识别官方长短链接，允许整段分享文案和中文句末标点', () => {
  assert.equal(Core.analyze('【分享】https://m.tb.cn/h.demo，').platform, 'taobao');
  assert.equal(Core.analyze('https://u.jd.com/demo').platform, 'jd');
  assert.equal(Core.analyze('https://p.pinduoduo.com/demo').platform, 'pdd');
});

test('拒绝伪造域名、凭证、端口和 URL 混淆', () => {
  for (const url of [
    'https://taobao.com.evil.example/item', 'https://eviltaobao.com/item',
    'https://user@taobao.com/item', 'https://taobao.com:9999/item',
    'https://taobao.com%2eevil.com/item', 'https://127.0.0.1/item',
    'https://taobao.com\\@evil.com/item', 'javascript:alert(1)'
  ]) assert.ok(Core.analyze(url).error, url);
});

test('单次请求多个商品链接时要求用户选择，重复链接除外', () => {
  assert.equal(Core.analyze('https://u.jd.com/a https://u.jd.com/b').code, 'MULTIPLE_LINKS');
  assert.equal(Core.analyze('https://u.jd.com/a https://u.jd.com/a').platform, 'jd');
});

test('识别结果只含平台与链接，不含任何商品对象或推广链接', () => {
  const result = Core.analyze('https://item.taobao.com/item.htm?id=12345');
  assert.equal(result.platform, 'taobao');
  assert.equal(result.product, undefined);
  assert.equal(result.demoProduct, undefined);
  assert.equal(result.promotion, undefined);
  assert.equal(result.click_url, undefined);
  assert.equal(Core.analyze('￥Abc123456￥').kind, 'token');
  assert.equal(Core.analyze('￥Abc123456￥').url, null);
});

test('输入边界不触发上游调用', () => {
  for (const value of [undefined, null, {}, '']) assert.equal(Core.analyze(value).code, 'EMPTY_INPUT');
  assert.equal(Core.analyze('a'.repeat(2001)).code, 'INPUT_TOO_LONG');
});

test('正式模式不再拒绝启动；health 为 live + liveImplemented，无 demo 闸门', async () => {
  assert.doesNotThrow(() => createServer({ upstreamMode: 'fixture', mode: 'live' }));
  await withServer({ upstreamMode: 'fixture' }, async base => {
    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.mode, 'live');
    assert.equal(health.liveImplemented, true);
    assert.equal(health.ok, true);
    assert.equal(health.dataSource, 'fixture');
    assert.ok(health.platforms.taobao.enabled);
    assert.equal(health.platforms.jd.enabled, false);
  });
});

test('V1.2 商品契约：字段齐备、无整数分字段、无购买链接、旧接口 404', async () => {
  await withServer({ upstreamMode: 'fixture' }, async base => {
    const products = await (await fetch(base + '/api/v1/products')).json();
    assert.equal(products.mode, 'live');
    assert.ok(Array.isArray(products.items));
    assert.ok(products.items.length > 0);
    const serialized = JSON.stringify(products.items);
    assert.ok(!serialized.includes('priceFen') && !serialized.includes('couponFen'));
    assert.ok(!serialized.includes('click_url') && !serialized.includes('purchaseActions'));
    assert.ok(products.requestId);

    const platforms = await (await fetch(base + '/api/v1/platforms')).json();
    assert.equal(platforms.mode, 'live');
    assert.equal(platforms.platforms.find(p => p.id === 'pdd').reason, '未开放');

    assert.equal((await fetch(base + '/api/products')).status, 404);
    assert.equal((await fetch(base + '/api/v1/orders')).status, 404);
    assert.equal((await (await fetch(base + '/api/v1/orders')).json()).error.code, 'NOT_IMPLEMENTED');
    assert.equal((await fetch(base + '/api/v1/products?platform=jd')).status, 503);
  });
});

test('转链占位：只识别平台，product/promotion 恒为 null，输入校验保留', async () => {
  await withServer({ upstreamMode: 'fixture' }, async base => {
    const recognized = await (await convert(base, 'https://item.taobao.com/item.htm?id=12345')).json();
    assert.equal(recognized.mode, 'live');
    assert.equal(recognized.status, 'UPSTREAM_NOT_CONNECTED');
    assert.equal(recognized.conversionEndpoint, 'NOT_IMPLEMENTED');
    assert.equal(recognized.platform, 'taobao');
    assert.equal(recognized.product, null);
    assert.equal(recognized.promotion, null);

    const token = await (await convert(base, '￥Abc123456￥')).json();
    assert.equal(token.platform, 'taobao');
    assert.equal(token.product, null);

    assert.equal((await convert(base, 'https://evil.example/item')).status, 400);
    assert.equal((await convert(base, '{', 'application/json')).status, 400);
    assert.equal((await fetch(base + '/api/convert', { method: 'POST', body: 'hello' })).status, 415);
    assert.equal((await convert(base, '')).status, 400);
  });
});

test('缺凭据 live：health ok:false，商品接口 503 且不返回任何商品', async () => {
  const cfg = config.readConfig({ QUANSHENG_UPSTREAM: 'live' });
  await withServer({ config: cfg }, async base => {
    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.ok, false);
    assert.equal(health.upstream.status, 'MISSING_CREDENTIALS');
    const response = await fetch(base + '/api/v1/products');
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.error.code, 'UPSTREAM_PERMISSION_MISSING');
    assert.equal(payload.items, undefined, '绝不能回退到任何示例商品');
    assert.ok(payload.requestId);
  });
});

test('静态站点：页面与资源可访问，HTML/JS 无演示数据与示例商品残留', async () => {
  await withServer({ upstreamMode: 'fixture' }, async base => {
    assert.equal((await fetch(base + '/')).status, 200);
    assert.match((await fetch(base + '/app.js')).headers.get('content-type'), /javascript/);
    const mobile = await (await fetch(base + '/mobile.html')).text();
    assert.match(mobile, /<iframe src="index.html"/);
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /id="product-grid"/);
    assert.match(html, /id="convert-form"/);
    assert.ok(!/示例商品|交互演示|领券预览/.test(html));

    const webRoot = path.resolve(__dirname, '../web');
    for (const file of ['core.js', 'app.js', 'index.html']) {
      const text = fs.readFileSync(path.join(webRoot, file), 'utf8');
      assert.ok(!/priceFen|couponFen|exampleUrl|AFFILIATE_MODE|useDemoData/.test(text), file + ' 仍含旧契约字段');
    }
  });
});
