/**
 * 职责：离线验证小程序请求层 —— mode:'live' 校验、HTTPS / 开发者工具本地联调规则、
 *       /api/v1/products 路径、V1.2 字段展示、券条件与错误码传递。
 * 边界：wx.request 全部通过注入的 bridge 模拟；不触网到淘宝网关、不注入真实密钥。
 * 调用方：npm test。
 * 关键点：present() 只读 Money/priceBasis/coupon，不再读 priceFen/couponFen。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('./upstream/config.cjs');
const { createServer } = require('./server.cjs');
const Api = require('../miniprogram/utils/api.js');

function useWechat(cfg, wxImpl) {
  global.getApp = () => ({ globalData: cfg });
  global.wx = wxImpl;
}

test.afterEach(() => { delete global.getApp; delete global.wx; });

async function withServer(options, fn) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { return await fn(base); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function wxBridge({ platform = 'devtools', requests = [] } = {}) {
  return {
    getDeviceInfo: () => ({ platform }),
    getSystemInfoSync: () => ({ platform }),
    async request(options) {
      requests.push({ url: options.url, method: options.method, data: options.data });
      const url = new URL(options.url);
      if (options.method === 'GET') url.search = new URLSearchParams(options.data);
      try {
        const response = await fetch(url, {
          method: options.method,
          headers: options.header,
          body: options.method === 'POST' ? JSON.stringify(options.data) : undefined
        });
        options.success({ statusCode: response.status, data: await response.json() });
      } catch { options.fail(); }
    }
  };
}

const SAMPLE_V12 = {
  platform: 'taobao', productRef: 'tbk.test-ref', title: '轻量随行保温杯',
  imageUrl: 'https://img.alicdn.com/a.jpg',
  currentPrice: { amount: '79.00', currency: 'CNY' },
  finalPrice: { amount: '69.00', currency: 'CNY' },
  priceBasis: 'CONFIRMED',
  coupon: { availability: 'AVAILABLE', eligibility: 'ELIGIBLE', discount: { amount: '10', currency: 'CNY' }, conditions: [], expiresAt: null }
};

test('开发者工具本地 HTTP 联调：请求 /api/v1/products 并按 V1.2 展示', async () => {
  await withServer({ upstreamMode: 'fixture' }, async base => {
    const requests = [];
    useWechat({ apiBase: base, allowLocalHttpInDevTools: true, pendingLink: '' }, wxBridge({ requests }));
    const list = await Api.products({ query: '耳机', platform: 'all' });
    assert.equal(requests[0].url, base + '/api/v1/products');
    assert.equal(requests[0].method, 'GET');
    assert.equal(list.mode, 'live');
    assert.equal(list.dataSource, 'fixture');
    assert.ok(list.items.length > 0);
    const item = list.items[0];
    assert.ok(item.productRef.startsWith('tbk.'));
    assert.ok(item.priceLabel);
    assert.equal(item.platformName, '淘宝');
    assert.ok(item.basisLabel);
    assert.ok(!Object.hasOwn(item, 'priceFen'));
    assert.ok(!Object.hasOwn(item, 'couponFen'));

    const result = await Api.convert('https://item.taobao.com/item.htm?id=123');
    assert.equal(result.status, 'UPSTREAM_NOT_CONNECTED');
    assert.equal(result.product, null);
    assert.equal(result.promotion, null);
    assert.equal(result.platformName, '淘宝');
    assert.ok(requests.some(r => r.url === base + '/api/convert'));
  });
});

test('拒绝非 live 响应，避免把演示数据当作真实商品', async () => {
  useWechat({ apiBase: 'https://example.com', allowLocalHttpInDevTools: false }, {
    getDeviceInfo: () => ({ platform: 'devtools' }),
    request(options) { options.success({ statusCode: 200, data: { mode: 'demo', items: [] } }); }
  });
  await assert.rejects(Api.products({}), /正式模式|live/);
});

test('真机强制 HTTPS：本地 HTTP 被拒绝，未配置 apiBase 明确报错，非法域名被拒绝', async () => {
  const cfg = { apiBase: 'http://127.0.0.1:3000', allowLocalHttpInDevTools: true };
  useWechat(cfg, wxBridge({ platform: 'android' }));
  await assert.rejects(Api.products({}), /HTTPS/);

  cfg.apiBase = '';
  await assert.rejects(Api.products({}), /配置 apiBase/);

  cfg.apiBase = 'https://example.com/steal?x=1';
  await assert.rejects(Api.products({}), /HTTPS/);

  cfg.apiBase = 'https://example.com';
  let seenUrl = '';
  useWechat(cfg, {
    getDeviceInfo: () => ({ platform: 'android' }),
    request(options) {
      seenUrl = options.url;
      options.success({ statusCode: 200, data: { mode: 'live', items: [], nextCursor: null } });
    }
  });
  const result = await Api.products({});
  assert.equal(seenUrl, 'https://example.com/api/v1/products');
  assert.deepEqual(result.items, []);
});

test('present()：确定到手价 / 条件预估价 / 券门槛与外链图片白名单', () => {
  const confirmed = Api.present(SAMPLE_V12);
  assert.equal(confirmed.priceLabel, '69');
  assert.equal(confirmed.priceCaption, '到手价');
  assert.equal(confirmed.originalLabel, '79');
  assert.equal(confirmed.couponText, '10元券');
  assert.equal(confirmed.imagePath, SAMPLE_V12.imageUrl);

  const estimated = Api.present(Object.assign({}, SAMPLE_V12, {
    finalPrice: null, priceBasis: 'ESTIMATED',
    priceNote: '预估到手价含凑单、满减或限购条件，需到平台结算页确认。',
    coupon: Object.assign({}, SAMPLE_V12.coupon, {
      eligibility: 'CONDITIONAL', conditions: ['满99元可用'], expiresAt: '2026-12-01T23:59:59+08:00'
    })
  }));
  assert.equal(estimated.priceLabel, '79');
  assert.equal(estimated.priceCaption, '当前价');
  assert.equal(estimated.showOriginal, false);
  assert.match(estimated.couponConditions, /满99元可用/);
  assert.match(estimated.priceNote, /预估到手价/);
  assert.equal(estimated.basisLabel, '预估价 · 含条件');

  const unsafe = Api.present(Object.assign({}, SAMPLE_V12, { imageUrl: 'https://evil.example/a.jpg' }));
  assert.equal(unsafe.imagePath, '/assets/logo.png');
});

test('上游错误码传递到页面，便于按超时/权限/限流分区提示', async () => {
  const cfg = config.readConfig({ QUANSHENG_UPSTREAM: 'live' });
  await withServer({ config: cfg }, async base => {
    useWechat({ apiBase: base, allowLocalHttpInDevTools: true }, wxBridge());
    await assert.rejects(Api.products({}), err => {
      assert.equal(err.code, 'UPSTREAM_PERMISSION_MISSING');
      assert.match(err.message, /凭据|权限/);
      return true;
    });
  });
});

test('平台状态接口：京东/拼多多为未开放', async () => {
  await withServer({ upstreamMode: 'fixture' }, async base => {
    useWechat({ apiBase: base, allowLocalHttpInDevTools: true }, wxBridge());
    const result = await Api.platforms();
    assert.equal(result.mode, 'live');
    assert.equal(result.platforms.find(p => p.id === 'taobao').enabled, true);
    assert.equal(result.platforms.find(p => p.id === 'jd').enabled, false);
  });
});
