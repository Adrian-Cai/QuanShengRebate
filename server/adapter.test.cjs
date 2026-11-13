/**
 * 职责：离线验证上游适配层（配置、签名、错误分类、字段映射、金额精度、券口径、图片白名单、缓存）。
 * 边界：不触网、不读真实凭据；callTop 通过注入 fetchImpl 验证，绝不访问淘宝网关。
 * 调用方：npm test。
 * 关键点：金额禁止浮点相减；商品列表不得出现任何推广/购买链接字段。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const config = require('./upstream/config.cjs');
const client = require('./upstream/taobao-client.cjs');
const mapper = require('./upstream/mapper.cjs');
const cacheMod = require('./upstream/cache.cjs');
const fixture = require('./upstream/fixture.cjs');

function fakeConfig(overrides = {}) {
  const env = {
    QUANSHENG_UPSTREAM: 'live',
    TAOBAO_APP_KEY: 'test-app-key',
    TAOBAO_APP_SECRET: 'test-app-secret-DO-NOT-LOG',
    TAOBAO_ADZONE_ID: '123456789',
    TAOBAO_MATERIAL_ID_RECOMMEND: 'material-from-console',
    QUANSHENG_PRODUCT_REF_KEY: 'test-ref-key',
    ...overrides
  };
  return config.readConfig(env);
}

test('配置：网关白名单、必填项、TTL 区间与脱敏', () => {
  const cfg = fakeConfig({ QUANSHENG_CACHE_TTL_MS: '999999' });
  assert.equal(cfg.gateway, config.GATEWAYS[0]);
  assert.equal(cfg.missing.length, 0);
  assert.equal(cfg.cacheTtlMs, 120_000);
  assert.throws(() => fakeConfig({ TAOBAO_GATEWAY: 'https://evil.example/router/rest' }), /INVALID_GATEWAY|白名单/);
  assert.throws(() => fakeConfig({ TAOBAO_SIGN_METHOD: 'sha256' }), /INVALID_SIGN_METHOD|md5/);
  const missing = config.readConfig({ QUANSHENG_UPSTREAM: 'live' });
  assert.equal(config.upstreamStatus(missing), 'MISSING_CREDENTIALS');
  assert.ok(missing.missing.includes('TAOBAO_APP_SECRET'));
  const safe = config.safeConfig(cfg);
  assert.ok(!JSON.stringify(safe).includes('test-app-secret-DO-NOT-LOG'));
  assert.ok(config.redact('签名出错 secret=test-app-secret-DO-NOT-LOG', cfg).includes('***'));
  assert.equal(config.readConfig({ QUANSHENG_UPSTREAM: 'fixture' }).upstream, 'fixture');
});

test('TOP 签名：按 key 排序、MD5(secret+kv+secret)、密钥不进入请求参数', () => {
  const cfg = fakeConfig();
  const params = client.buildSignedParams('taobao.tbk.dg.material.optional.upgrade',
    { q: '耳机', adzone_id: '123456789', page_size: 20 }, cfg, '2026-11-13 10:00:00');
  const base = Object.keys(params).filter(k => k !== 'sign').sort().map(k => `${k}${params[k]}`).join('');
  const expected = crypto.createHash('md5')
    .update(cfg.appSecret + base + cfg.appSecret, 'utf8').digest('hex').toUpperCase();
  assert.equal(params.sign, expected);
  assert.equal(params.q, '耳机');
  assert.equal(params.format, 'json');
  assert.equal(params.v, '2.0');
  assert.ok(!JSON.stringify(params).includes(cfg.appSecret));
  assert.throws(() => client.buildSignedParams('taobao.tbk.sc.material.optional', {}, cfg), /未批准/);
  assert.throws(() => client.buildSignedParams('taobao.tbk.dg.material.recommend', { nested: { a: 1 } }, cfg), /不接受对象/);
  assert.match(client.topTimestamp(new Date('2026-01-01T00:00:00Z')), /^2026-01-01 08:00:00$/);
});

test('上游错误分类：权限 / 限流 / 其他，且不泄露密钥', () => {
  const cfg = fakeConfig();
  const permission = client.classifyTopError({ error_response: { code: 11, msg: 'Insufficient APP Permissions' } }, cfg);
  assert.equal(permission.code, 'UPSTREAM_PERMISSION_MISSING');
  assert.equal(permission.status, 503);
  const rate = client.classifyTopError({ error_response: { code: 7, msg: 'app call limited' } }, cfg);
  assert.equal(rate.code, 'UPSTREAM_RATE_LIMITED');
  assert.equal(rate.status, 503);
  const keyword = client.classifyTopError({ error_response: { code: 999, msg: '请求频率超出配额' } }, cfg);
  assert.equal(keyword.code, 'UPSTREAM_RATE_LIMITED');
  const other = client.classifyTopError({ error_response: { code: 999, msg: 'unexpected' } }, cfg);
  assert.equal(other.code, 'UPSTREAM_ERROR');
  assert.equal(other.status, 502);
  const leaked = client.classifyTopError({ error_response: { code: 999, msg: 'secret=test-app-secret-DO-NOT-LOG' } }, cfg);
  assert.ok(!JSON.stringify(leaked.meta).includes('test-app-secret-DO-NOT-LOG'));
});

test('callTop：成功返回、错误响应、超时与网络失败（全部注入 fetch，不触网）', async () => {
  const cfg = fakeConfig();
  const calls = [];
  const okFetch = async (url, options) => {
    calls.push({ url, body: options.body, method: options.method });
    return { ok: true, status: 200, json: async () => ({ tbk_dg_material_recommend_response: { result_list: { map_data: [] } } }) };
  };
  const payload = await client.callTop('taobao.tbk.dg.material.recommend', { adzone_id: '1' }, cfg, { fetchImpl: okFetch });
  assert.ok(payload.tbk_dg_material_recommend_response);
  assert.equal(calls[0].url, cfg.gateway);
  assert.equal(calls[0].method, 'POST');
  assert.ok(calls[0].body.includes('sign='));

  await assert.rejects(
    client.callTop('taobao.tbk.dg.material.recommend', {}, cfg, {
      fetchImpl: async () => ({ ok: true, json: async () => ({ error_response: { code: 11, msg: 'no permission' } }) })
    }),
    err => err.code === 'UPSTREAM_PERMISSION_MISSING'
  );
  await assert.rejects(
    client.callTop('taobao.tbk.dg.material.recommend', {}, cfg, {
      fetchImpl: async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; }
    }),
    err => err.code === 'UPSTREAM_TIMEOUT' && err.status === 504
  );
  await assert.rejects(
    client.callTop('taobao.tbk.dg.material.recommend', {}, cfg, { fetchImpl: async () => { throw new Error('ECONNRESET'); } }),
    err => err.code === 'UPSTREAM_ERROR' && err.status === 502
  );
});

test('金额：全程十进制字符串，整数分中转杜绝浮点误差', () => {
  assert.deepEqual(mapper.toMoney('12.30'), { amount: '12.30', currency: 'CNY' });
  assert.equal(mapper.toMoney('12.345'), null);
  assert.equal(mapper.toMoney('-1'), null);
  assert.equal(mapper.toMoney('abc'), null);
  assert.equal(mapper.toMoney(undefined), null);
  assert.equal(mapper.moneyToFen({ amount: '0.30' }), 30);
  assert.equal(mapper.moneyToFen('12.05'), 1205);
  assert.deepEqual(mapper.subtractMoney({ amount: '0.30' }, { amount: '0.10' }), { amount: '0.20', currency: 'CNY' });
  assert.deepEqual(mapper.subtractMoney('129.00', '30.00'), { amount: '99.00', currency: 'CNY' });
  assert.equal(mapper.subtractMoney('1.00', '2.00'), null);
  assert.deepEqual(mapper.fenToMoney(990), { amount: '9.90', currency: 'CNY' });
});

test('图片：协议升级、阿里域名白名单、伪造域名与端口回退占位图', () => {
  assert.match(mapper.normalizeImageUrl('//img.alicdn.com/a.jpg'), /^https:\/\/img\.alicdn\.com/);
  assert.match(mapper.normalizeImageUrl('http://gw.alicdn.com/a.jpg'), /^https:\/\/gw\.alicdn\.com/);
  assert.equal(mapper.normalizeImageUrl('https://evil.example/a.jpg'), mapper.PLACEHOLDER_IMAGE);
  assert.equal(mapper.normalizeImageUrl('https://img.alicdn.com.evil.example/a.jpg'), mapper.PLACEHOLDER_IMAGE);
  assert.equal(mapper.normalizeImageUrl('https://user@img.alicdn.com/a.jpg'), mapper.PLACEHOLDER_IMAGE);
  assert.equal(mapper.normalizeImageUrl('https://img.alicdn.com:8080/a.jpg'), mapper.PLACEHOLDER_IMAGE);
  assert.equal(mapper.normalizeImageUrl('/assets/logo.svg'), mapper.PLACEHOLDER_IMAGE);
});

test('券：无券/余量为零/字段缺失/门槛条件/ISO 有效期', () => {
  assert.equal(mapper.mapCoupon({}).availability, 'UNKNOWN');
  assert.equal(mapper.mapCoupon({ coupon_amount: '10', coupon_remain_count: 0 }).availability, 'NONE');
  const none = mapper.mapCoupon({ coupon_amount: '0', coupon_remain_count: 10 });
  assert.equal(none.availability, 'NONE');
  const conditional = mapper.mapCoupon({
    coupon_amount: '10', coupon_start_fee: '99', coupon_remain_count: 5, coupon_end_time: '2026-12-01'
  });
  assert.equal(conditional.availability, 'AVAILABLE');
  assert.equal(conditional.eligibility, 'CONDITIONAL');
  assert.deepEqual(conditional.conditions, ['满99元可用']);
  assert.match(conditional.expiresAt, /^2026-12-01T23:59:59\+08:00$/);
  const parsed = mapper.mapCoupon({ coupon_info: '满99元减10元', coupon_remain_count: 5 });
  assert.equal(parsed.discount.amount, '10');
  assert.ok(parsed.conditions.includes('满99元可用'));
});

test('到手价口径：条件路径 / 券门槛 / 缺价 / 资格明确', () => {
  const eligible = mapper.mapCoupon({ coupon_amount: '10', coupon_start_fee: '0', coupon_remain_count: 5 });
  const confirmed = mapper.mapPrice({
    zk_final_price: '79.00', final_promotion_price: '69.00',
    final_promotion_path_list: [{ desc: '商品优惠券' }]
  }, eligible);
  assert.equal(confirmed.priceBasis, 'CONFIRMED');
  assert.equal(confirmed.finalPrice.amount, '69.00');

  const conditional = mapper.mapPrice({
    zk_final_price: '129.00', final_promotion_price: '99.00',
    final_promotion_path_list: [{ desc: '凑单满减' }, { desc: '需买2件' }]
  }, eligible);
  assert.equal(conditional.priceBasis, 'ESTIMATED');
  assert.equal(conditional.finalPrice, null);
  assert.ok(conditional.priceConditions.length >= 2);

  const unknownPrice = mapper.mapPrice({ zk_final_price: '29.90' }, eligible);
  assert.equal(unknownPrice.priceBasis, 'UNKNOWN');
  assert.equal(unknownPrice.finalPrice, null);

  const conditionalCoupon = mapper.mapCoupon({ coupon_amount: '10', coupon_start_fee: '99', coupon_remain_count: 5 });
  const estimatedByCoupon = mapper.mapPrice({ zk_final_price: '129.00', final_promotion_price: '99.00' }, conditionalCoupon);
  assert.equal(estimatedByCoupon.priceBasis, 'ESTIMATED');
  assert.equal(estimatedByCoupon.finalPrice, null);
});

test('映射：上游容器解析、不透明 productRef、列表不含任何推广链接字段', () => {
  const raw = fixture.buildFixtureRaw({ pageNo: 1, pageSize: 20 });
  const result = mapper.mapResponse(raw, { productRefKey: 'unit-test-key' });
  assert.equal(result.items.length, fixture.SYNTHETIC_ITEMS.length);
  assert.equal(result.totalResults, fixture.SYNTHETIC_ITEMS.length);
  assert.equal(result.refEntries.length, result.items.length);

  const first = result.items[0];
  assert.equal(first.platform, 'taobao');
  assert.match(first.productRef, /^tbk\.[A-Za-z0-9_-]+$/);
  assert.ok(!first.productRef.includes('SYN-TB-1001'), '商品引用不得暴露上游 item_id');
  assert.equal(first.currentPrice.currency, 'CNY');
  assert.ok(['CONFIRMED', 'ESTIMATED', 'UNKNOWN'].includes(first.priceBasis));
  assert.ok(first.coupon && first.coupon.availability);

  const serialized = JSON.stringify(result.items);
  for (const forbidden of ['click_url', 'coupon_share_url', 'sourceUrl', 'purchaseActions', 'priceFen', 'couponFen']) {
    assert.ok(!serialized.includes(forbidden), '列表不应下发 ' + forbidden);
  }
  assert.ok(!serialized.includes('SYN-TB-'), '不应直接下发上游 item_id');

  assert.equal(mapper.productRef('SYN-TB-1001', 'key-a'), mapper.productRef('SYN-TB-1001', 'key-a'));
  assert.notEqual(mapper.productRef('SYN-TB-1001', 'key-a'), mapper.productRef('SYN-TB-1001', 'key-b'));
  assert.equal(mapper.verifyProductRef(first.productRef, result.refEntries[0].itemId, 'unit-test-key'), true);
  assert.equal(mapper.verifyProductRef(first.productRef, 'another-id', 'unit-test-key'), false);
  assert.equal(mapper.mapItem({ title: 'no id' }, { productRefKey: 'k' }), null);
  assert.equal(mapper.extractMapData({ result_list: { map_data: [], total_results: 0 } }).totalResults, 0);
});

test('缓存：TTL 过期、同键单飞、失败不缓存、键含条件与页面', async () => {
  let now = 1000;
  const cache = cacheMod.createCache({ ttlMs: 1000, now: () => now });
  cache.set('k', { value: 1 });
  assert.deepEqual(cache.get('k'), { value: 1 });
  now = 2500;
  assert.equal(cache.get('k'), undefined);

  let loads = 0;
  const cache2 = cacheMod.createCache({ ttlMs: 60_000 });
  const loader = async () => { loads++; await new Promise(r => setTimeout(r, 5)); return { ok: true }; };
  const [a, b] = await Promise.all([cache2.getOrLoad('same', loader), cache2.getOrLoad('same', loader)]);
  assert.equal(loads, 1);
  assert.deepEqual(a, b);

  let failures = 0;
  const failing = async () => { failures++; throw new Error('upstream down'); };
  await assert.rejects(cache2.getOrLoad('failing', failing));
  await assert.rejects(cache2.getOrLoad('failing', failing));
  assert.equal(failures, 2, '失败不能被缓存');
  assert.equal(cache2.size, 1);

  const keyA = cacheMod.buildCacheKey({ platform: 'taobao', method: 'm', params: { q: '耳机' }, pageNo: 1, pageSize: 20 });
  const keyB = cacheMod.buildCacheKey({ platform: 'taobao', method: 'm', params: { q: '耳机' }, pageNo: 2, pageSize: 20 });
  const keyC = cacheMod.buildCacheKey({ platform: 'taobao', method: 'm', params: { q: '杯子' }, pageNo: 1, pageSize: 20 });
  assert.notEqual(keyA, keyB);
  assert.notEqual(keyA, keyC);
});
