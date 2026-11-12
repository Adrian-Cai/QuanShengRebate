const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server.cjs');
const Api = require('../miniprogram/utils/api.js');

const sample = 'https://item.jd.com/demo-jd-headphones.html';

function useWechat(config, wx) {
  global.getApp = () => ({ globalData: config });
  global.wx = wx;
}

test.afterEach(() => {
  delete global.getApp;
  delete global.wx;
});

test('小程序离线预览沿用本地商品和转链样例', async () => {
  useWechat({ useDemoData: true, useDemoApi: false }, {
    request() { assert.fail('离线预览发出了网络请求'); }
  });
  const list = await Api.products({ platform: 'jd' });
  assert.equal(list.items.length, 4);
  assert.equal(list.items[0].platformName, '京东');
  const result = await Api.convert(sample);
  assert.equal(result.product.id, 'demo-jd-headphones');
  assert.equal(result.promotion, null);
});

test('小程序开发者工具通过同一个演示 API 筛选商品和转链', async t => {
  const server = createServer({ mode: 'demo' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const methods = [];
  useWechat({
    useDemoData: true,
    useDemoApi: true,
    apiBase: 'http://127.0.0.1:' + server.address().port
  }, {
    getDeviceInfo: () => ({ platform: 'devtools' }),
    async request(options) {
      methods.push(options.method);
      const url = new URL(options.url);
      const request = { method: options.method, headers: options.header };
      if (options.method === 'GET') url.search = new URLSearchParams(options.data);
      else request.body = JSON.stringify(options.data);

      try {
        const response = await fetch(url, request);
        options.success({ statusCode: response.status, data: await response.json() });
      } catch {
        options.fail();
      }
    }
  });

  const list = await Api.products({ platform: 'jd', query: '耳机' });
  assert.deepEqual(list.items.map(product => product.id), ['demo-jd-headphones']);
  assert.equal(list.items[0].priceLabel, '99');
  const result = await Api.convert(sample);
  assert.equal(result.mode, 'demo');
  assert.equal(result.status, 'DEMO_RESULT');
  assert.equal(result.product.id, list.items[0].id);
  assert.equal(result.promotion, null);
  await assert.rejects(Api.convert(''), /链接|口令/);
  assert.deepEqual(methods, ['GET', 'POST', 'POST']);
});

test('真机网络演示要求 HTTPS，正式模式拒绝演示返回', async () => {
  const config = { useDemoData: true, useDemoApi: true, apiBase: 'http://127.0.0.1:3000' };
  useWechat(config, {
    getSystemInfoSync: () => ({ platform: 'android' }),
    request(options) {
      assert.equal(options.url, 'https://example.com/api/products');
      options.success({ statusCode: 200, data: { mode: 'demo', items: [] } });
    }
  });
  await assert.rejects(Api.products({}), /HTTPS/);
  config.apiBase = 'https://example.com';
  assert.deepEqual(await Api.products({}), { mode: 'demo', items: [] });
  config.useDemoData = false;
  await assert.rejects(Api.products({}), /尚未开放真实联盟服务/);
});
