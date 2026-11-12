const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const Core = require('../shared/core.cjs');

const base = process.argv[2] || 'http://127.0.0.1:3000';

async function request(path, options) {
  const response = await fetch(new URL(path, base), {
    ...options,
    signal: AbortSignal.timeout(3000)
  });
  assert.equal(response.status, 200, path + ' 请求失败，HTTP ' + response.status);
  return response;
}

async function health() {
  const deadline = Date.now() + 12000;
  for (;;) {
    try {
      return await (await request('/api/health')).json();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(300);
    }
  }
}

async function convert(text) {
  const response = await request('/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  return response.json();
}

async function main() {
  const status = await health();
  assert.equal(status.ok, true);
  assert.equal(status.mode, 'demo');

  const home = await (await request('/')).text();
  assert.match(home, /id="product-grid"/);
  assert.match(home, /id="convert-form"/);
  const mobile = await (await request('/mobile.html')).text();
  assert.match(mobile, /<iframe src="index.html"/);
  assert.match((await request('/app.js')).headers.get('content-type'), /javascript/);

  const list = await (await request('/api/products?platform=jd&query=' + encodeURIComponent('耳机'))).json();
  assert.equal(list.mode, 'demo');
  assert.deepEqual(list.items.map(product => product.id), ['demo-jd-headphones']);

  for (const platform of ['taobao', 'jd', 'pdd']) {
    const result = await convert(Core.exampleUrl(platform));
    assert.equal(result.mode, 'demo');
    assert.equal(result.status, 'DEMO_RESULT');
    assert.equal(result.platform, platform);
    assert.equal(result.product.platform, platform);
    assert.equal(result.promotion, null);
  }

  const unknown = await convert('https://item.jd.com/100001.html');
  assert.equal(unknown.status, 'UPSTREAM_NOT_CONNECTED');
  assert.equal(unknown.product, null);
  assert.equal(unknown.promotion, null);
  console.log('冒烟检查通过。网站、京东筛选、三平台示例转链及普通链接识别均正常。');
}

main().catch(error => {
  console.error('冒烟检查失败。', error);
  process.exitCode = 1;
});
