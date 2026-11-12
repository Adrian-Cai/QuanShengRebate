const Core = require('./core');

function isDevTools() {
  const info = typeof wx.getDeviceInfo === 'function'
    ? wx.getDeviceInfo()
    : wx.getSystemInfoSync();
  return info.platform === 'devtools';
}

function request(config, path, data, method = 'GET') {
  const base = (config.apiBase || '').replace(/\/+$/, '');
  const localDemo = config.useDemoData && config.useDemoApi &&
    /^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/.test(base) && isDevTools();
  if (!localDemo && !/^https:\/\/[^/\s?#]+(?:\/[^?#]*)?$/.test(base)) {
    return Promise.reject(new Error('请配置合法请求域名的 HTTPS 服务地址。本机 HTTP 仅用于开发者工具的演示联调。'));
  }
  const expectedMode = config.useDemoData ? 'demo' : 'live';
  return new Promise((resolve, reject) => wx.request({
    url: base + path,
    method,
    data,
    header: { 'content-type': 'application/json' },
    timeout: 12000,
    success(res) {
      const result = res.data;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const message = result && result.error && result.error.message;
        reject(new Error(message || '服务暂时不可用，请稍后重试'));
        return;
      }
      if (!result || result.mode !== expectedMode) {
        reject(new Error(expectedMode === 'demo'
          ? '服务端没有返回可用的演示数据'
          : '服务端尚未开放真实联盟服务'));
        return;
      }
      resolve(result);
    },
    fail() {
      reject(new Error('网络连接失败，请检查服务地址和开发工具的网络设置'));
    }
  }));
}

function present(p) {
  return Object.assign({}, p, {
    priceLabel: Core.money(Core.finalPrice(p)),
    couponLabel: Core.money(p.couponFen),
    originalLabel: Core.money(p.priceFen),
    platformName: Core.platformNames[p.platform],
    imagePath: p.imageUrl || '/assets/' + p.image + '.png'
  });
}

module.exports = {
  present,
  async products(filters) {
    const config = getApp().globalData;
    if (config.useDemoData && !config.useDemoApi) {
      return { mode: 'demo', items: Core.filterProducts(filters).map(present) };
    }
    const result = await request(config, '/api/products', filters);
    if (!Array.isArray(result.items)) throw new Error('商品接口没有返回列表');
    return Object.assign({}, result, { items: result.items.map(present) });
  },
  async convert(text) {
    const config = getApp().globalData;
    if (!config.useDemoData || config.useDemoApi) {
      const result = await request(config, '/api/convert', { text }, 'POST');
      return Object.assign({}, result, { product: result.product ? present(result.product) : null });
    }
    const result = Core.analyze(text);
    if (result.error) throw new Error(result.error);
    return {
      mode: 'demo',
      platform: result.platform,
      kind: result.kind,
      product: result.demoProduct ? present(result.demoProduct) : null,
      promotion: null,
      status: result.demoProduct ? 'DEMO_RESULT' : 'UPSTREAM_NOT_CONNECTED'
    };
  }
};
