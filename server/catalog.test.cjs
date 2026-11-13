/**
 * 职责：离线验证目录编排层 —— 平台开放状态、输入白名单、凭据缺失、分页游标、缓存键与上游方法。
 * 边界：不触网；所有上游调用通过 callTop 注入；不注入任何真实密钥。
 * 调用方：npm test。
 * 关键点：凭据缺失时 503 且绝不回退数据；用户输入只能作为 q 进入白名单方法。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('./upstream/config.cjs');
const catalogMod = require('./catalog.cjs');
const fixture = require('./upstream/fixture.cjs');

function fixtureCatalog(extra = {}) {
  return catalogMod.createCatalog({ config: config.readConfig({ QUANSHENG_UPSTREAM: 'fixture' }), ...extra });
}

function liveCatalog(envOverrides = {}) {
  const env = {
    QUANSHENG_UPSTREAM: 'live',
    TAOBAO_APP_KEY: 'unit-key',
    TAOBAO_APP_SECRET: 'unit-secret',
    TAOBAO_ADZONE_ID: 'unit-adzone',
    TAOBAO_MATERIAL_ID_RECOMMEND: 'material-from-console',
    QUANSHENG_PRODUCT_REF_KEY: 'unit-ref-key',
    ...envOverrides
  };
  const calls = [];
  const callTop = async (method, params) => {
    calls.push({ method, params });
    return fixture.buildFixtureRaw({
      q: params.q || '', pageNo: params.page_no || 1, pageSize: params.page_size || 20
    });
  };
  return { catalog: catalogMod.createCatalog({ config: config.readConfig(env), callTop }), calls };
}

test('平台开放状态：仅淘宝开放，京东与拼多多标注未开放', () => {
  const catalog = fixtureCatalog();
  const platforms = catalog.platforms();
  assert.deepEqual(platforms.map(p => p.id), ['taobao', 'jd', 'pdd']);
  assert.equal(platforms[0].enabled, true);
  assert.equal(platforms[1].enabled, false);
  assert.equal(platforms[1].reason, '未开放');
  assert.equal(catalog.platformStatus().pdd.status, 'NOT_OPEN');
});

test('健康检查：fixture 可辨认；live 缺凭据 ok:false + MISSING_CREDENTIALS', () => {
  const fixtureHealth = fixtureCatalog().health();
  assert.equal(fixtureHealth.mode, 'live');
  assert.equal(fixtureHealth.liveImplemented, true);
  assert.equal(fixtureHealth.dataSource, 'fixture');
  assert.equal(fixtureHealth.upstream.status, 'FIXTURE');
  assert.ok(fixtureHealth.warning);

  const liveHealth = catalogMod.createCatalog({ config: config.readConfig({ QUANSHENG_UPSTREAM: 'live' }) }).health();
  assert.equal(liveHealth.ok, false);
  assert.equal(liveHealth.upstream.status, 'MISSING_CREDENTIALS');
  assert.ok(liveHealth.upstream.missing.includes('TAOBAO_APP_SECRET'));
});

test('输入规范化：分类映射到 q、拒绝伪分类与不支持的排序、限制长度', () => {
  assert.equal(catalogMod.normalizeQuery({ category: 'home' }).q, '家居');
  assert.equal(catalogMod.normalizeQuery({ category: 'digital' }).feed, 'search');
  assert.equal(catalogMod.normalizeQuery({}).feed, 'recommended');
  assert.throws(() => catalogMod.normalizeQuery({ category: 'under10' }), /不支持的分类/);
  assert.throws(() => catalogMod.normalizeQuery({ sort: 'coupon-desc' }), /不支持的排序/);
  assert.throws(() => catalogMod.normalizeQuery({ platform: 'evil' }), /不支持的平台/);
  assert.throws(() => catalogMod.normalizeQuery({ feed: 'ranking' }), /不支持的推荐流/);
  assert.throws(() => catalogMod.normalizeQuery({ feed: 'search' }), /需要提供 query/);
  assert.equal(catalogMod.normalizeQuery({ feed: 'recommended' }).feed, 'recommended');
  assert.equal(catalogMod.normalizeQuery({ feed: 'recommended', query: '耳机' }).feed, 'search');
  assert.equal(catalogMod.normalizeQuery({ query: 'x'.repeat(500) }).q.length, 100);
});

test('fixture 模式：V1.2 字段、显著标注、无示例回退链接', async () => {
  const catalog = fixtureCatalog();
  const result = await catalog.list({ platform: 'all' });
  assert.equal(result.mode, 'live');
  assert.equal(result.dataSource, 'fixture');
  assert.ok(result.notice);
  assert.ok(result.items.length > 0);
  const item = result.items[0];
  for (const key of ['platform', 'productRef', 'title', 'imageUrl', 'currentPrice', 'finalPrice', 'priceBasis', 'coupon']) {
    assert.ok(Object.hasOwn(item, key), '缺少字段 ' + key);
  }
  assert.equal(item.currentPrice.currency, 'CNY');
  assert.ok(JSON.stringify(result.items).includes('finalPrice'));
  assert.ok(!JSON.stringify(result.items).includes('priceFen'));
  assert.ok(!JSON.stringify(result.items).includes('click_url'));
});

test('凭据缺失：503 UPSTREAM_PERMISSION_MISSING，不返回任何商品、不回退样例', async () => {
  const catalog = catalogMod.createCatalog({ config: config.readConfig({ QUANSHENG_UPSTREAM: 'live' }) });
  await assert.rejects(catalog.list({ platform: 'all' }), err => {
    assert.equal(err.code, 'UPSTREAM_PERMISSION_MISSING');
    assert.equal(err.status, 503);
    return true;
  });
});

test('平台门禁：京东 / 拼多多返回 503 PLATFORM_NOT_ENABLED', async () => {
  const catalog = fixtureCatalog();
  for (const platform of ['jd', 'pdd']) {
    await assert.rejects(catalog.list({ platform }), err => err.code === 'PLATFORM_NOT_ENABLED' && err.status === 503);
  }
});

test('上游调用：只把用户输入作为 q，方法白名单，material_id 来自配置而非硬编码', async () => {
  const { catalog, calls } = liveCatalog();
  await catalog.list({ platform: 'taobao' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'taobao.tbk.dg.material.recommend');
  assert.equal(calls[0].params.material_id, 'material-from-console');
  assert.equal(calls[0].params.adzone_id, 'unit-adzone');
  assert.equal(calls[0].params.q, undefined);

  await catalog.list({ query: '耳机', sort: 'price-asc' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'taobao.tbk.dg.material.optional.upgrade');
  assert.equal(calls[1].params.q, '耳机');
  assert.equal(calls[1].params.sort, 'price_asc');
  assert.equal(calls[1].params.material_id, undefined, '搜索物料 ID 不应硬编码公开文档候选值');
  assert.ok(!JSON.stringify(calls[1].params).includes('unit-secret'));
});

test('缓存：同键复用上游结果，不同条件重新请求，失败不缓存', async () => {
  const { catalog, calls } = liveCatalog();
  await catalog.list({ query: '耳机' });
  await catalog.list({ query: '耳机' });
  assert.equal(calls.length, 1);
  await catalog.list({ query: '杯子' });
  assert.equal(calls.length, 2);

  const env = {
    QUANSHENG_UPSTREAM: 'live', TAOBAO_APP_KEY: 'k', TAOBAO_APP_SECRET: 's',
    TAOBAO_ADZONE_ID: 'a', TAOBAO_MATERIAL_ID_RECOMMEND: 'm', QUANSHENG_PRODUCT_REF_KEY: 'r'
  };
  let attempts = 0;
  const failingCatalog = catalogMod.createCatalog({
    config: config.readConfig(env),
    callTop: async () => { attempts++; const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; }
  });
  await assert.rejects(failingCatalog.list({ platform: 'taobao' }));
  await assert.rejects(failingCatalog.list({ platform: 'taobao' }));
  assert.equal(attempts, 2, '上游失败绝不能被缓存成可复用数据');
});

test('分页游标：签名绑定查询条件与位点，伪造/错配/过期均拒绝', async () => {
  const { catalog } = liveCatalog();
  const first = await catalog.list({ limit: '2' });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);

  const second = await catalog.list({ limit: '2', cursor: first.nextCursor });
  assert.equal(second.pageNo, 2);
  assert.equal(second.items.length, 2);

  const [body, sig] = first.nextCursor.split('.');
  await assert.rejects(catalog.list({ limit: '2', cursor: body + '.' + 'x'.repeat(sig.length) }), err => err.code === 'INVALID_CURSOR');
  await assert.rejects(catalog.list({ limit: '2', query: '别的关键词', cursor: first.nextCursor }), err => err.code === 'INVALID_CURSOR');
  await assert.rejects(catalog.list({ limit: '3', cursor: first.nextCursor }), err => err.code === 'INVALID_CURSOR');

  const key = 'unit-ref-key';
  const expired = catalogMod.encodeCursor({ v: 1, p: 'taobao', f: 'recommended', q: '', s: 'recommend', c: 'all', l: 2, n: 2, exp: Date.now() - 1000 }, key);
  await assert.rejects(catalog.list({ limit: '2', cursor: expired }), err => err.code === 'INVALID_CURSOR');
});

test('商品引用：映射后可在服务端短生命周期内解析回上游 ID', async () => {
  const catalog = fixtureCatalog();
  const result = await catalog.list({ platform: 'taobao' });
  const resolved = catalog.resolveProductRef(result.items[0].productRef);
  assert.ok(resolved);
  assert.equal(resolved.platform, 'taobao');
  assert.ok(resolved.itemId.startsWith('SYN-TB-'));
  assert.equal(catalog.resolveProductRef('tbk.forged'), null);
});
