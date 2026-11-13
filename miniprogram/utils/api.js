/**
 * 职责：小程序请求层 —— 调用 /api/v1/products、/api/v1/platforms、/api/convert，
 *       把 V1.2 正式契约映射为页面展示字段，并强制校验 mode:'live' 与请求域名。
 * 边界：不含任何内置商品数据，没有演示/正式混合开关；不做真实转链或购买跳转。
 * 调用方：miniprogram/pages/home/index.js、pages/convert/index.js、server/mini-api.test.cjs。
 * 关键点：真机强制 HTTPS 合法域名；http://127.0.0.1:3000 仅当 allowLocalHttpInDevTools=true
 *         且运行于微信开发者工具时才允许；present() 只读 Money/priceBasis/coupon，不读整数分字段。
 */
const Core = require('./core');

function isDevTools() {
  try {
    const info = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    return !!(info && info.platform === 'devtools');
  } catch (e) { return false; }
}

function validateBase(config) {
  const base = String((config && config.apiBase) || '').replace(/\/+$/, '');
  if (!base) throw new Error('请先配置 apiBase（HTTPS 合法域名）。');
  const localAllowed = config.allowLocalHttpInDevTools === true && isDevTools() &&
    /^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/.test(base);
  if (localAllowed) return base;
  if (!/^https:\/\/[^/\s?#]+(?:\/[^?#]*)?$/.test(base)) {
    throw new Error('请配置合法请求域名的 HTTPS 服务地址；本机 HTTP 仅允许在开发者工具中联调。');
  }
  return base;
}

function request(config, path, data, method = 'GET') {
  let base;
  try { base = validateBase(config); } catch (error) { return Promise.reject(error); }
  return new Promise((resolve, reject) => wx.request({
    url: base + path,
    method,
    data,
    header: { 'content-type': 'application/json' },
    timeout: 12000,
    success(res) {
      const result = res.data;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const detail = result && result.error;
        const error = new Error((detail && detail.message) || '服务暂时不可用，请稍后重试');
        error.code = (detail && detail.code) || 'HTTP_ERROR';
        reject(error);
        return;
      }
      if (!result || result.mode !== 'live') {
        reject(new Error('服务端没有返回正式模式（live）的数据'));
        return;
      }
      resolve(result);
    },
    fail() {
      reject(new Error('网络连接失败，请检查服务地址与小程序合法域名配置'));
    }
  }));
}

function present(p) {
  const price = Core.priceView(p);
  const coupon = Core.couponView(p);
  return Object.assign({}, p, {
    priceLabel: price.display,
    priceCaption: price.caption,
    priceNote: price.note,
    showOriginal: price.showOriginal,
    originalLabel: price.original,
    couponLabel: coupon.amount,
    couponText: coupon.text,
    couponConditions: coupon.conditions.join(' · '),
    basisLabel: Core.basisLabel(p),
    platformName: Core.platformNames[p.platform] || '淘宝',
    imagePath: Core.productImage(p)
  });
}

module.exports = {
  present,
  request,
  async products(filters) {
    const result = await request(getApp().globalData, '/api/v1/products', filters || {});
    if (!Array.isArray(result.items)) throw new Error('商品接口没有返回列表');
    return Object.assign({}, result, { items: result.items.map(present) });
  },
  async platforms() {
    const result = await request(getApp().globalData, '/api/v1/platforms');
    if (!Array.isArray(result.platforms)) throw new Error('平台接口没有返回列表');
    return result;
  },
  async convert(text) {
    const result = await request(getApp().globalData, '/api/convert', { text }, 'POST');
    if (result.status !== 'UPSTREAM_NOT_CONNECTED' || result.product !== null || result.promotion !== null) {
      throw new Error('链接识别接口的返回不符合正式契约');
    }
    return Object.assign({}, result, { platformName: Core.platformNames[result.platform] || '' });
  }
};
