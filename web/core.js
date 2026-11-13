/**
 * 职责：浏览器侧的纯展示工具 —— 链接/平台识别、Money 格式化、价格口径与图片白名单。
 * 边界：不含任何商品数据、不发请求、不生成推广链接；商品一律来自 GET /api/v1/products。
 * 调用方：web/app.js（同源加载），web/core.test 相关的离线契约检查。
 * 关键点：priceBasis 为 ESTIMATED / UNKNOWN 时绝不把当前价标成「确定券后价」；
 *         所有上游文本前端仍必须做 HTML 转义；图片只接受 https + 阿里图片域名。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CouponCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const platformNames = { taobao: '淘宝', jd: '京东', pdd: '拼多多' };
  const hosts = {
    taobao: ['taobao.com', 'tmall.com', 'tb.cn'],
    jd: ['jd.com', '3.cn'],
    pdd: ['pinduoduo.com', 'yangkeduo.com']
  };
  const imageHostSuffixes = ['alicdn.com', 'tbcdn.cn', 'taobaocdn.com', 'tbcache.com', 'taobao.com', 'tmall.com'];
  const placeholderImage = 'assets/logo.svg';

  function analyze(text) {
    if (typeof text !== 'string' || !text.trim()) return { error: '请先粘贴商品链接或分享文案。', code: 'EMPTY_INPUT' };
    if (text.length > 2000) return { error: '分享文案过长，请保留商品链接后重试。', code: 'INPUT_TOO_LONG' };
    const urls = text.match(/https?:\/\/[^\s<>\u3000]+/gi) || [];
    if (urls.length === 0) {
      if (/[￥¥][A-Za-z0-9]{6,30}[￥¥]/.test(text)) return { platform: 'taobao', kind: 'token', url: null };
      return { error: '未找到支持的链接，请复制淘宝、京东或拼多多的完整商品链接。', code: 'NO_URL' };
    }
    const found = [];
    for (const raw of urls) {
      const candidate = raw.replace(/[，。；！、）】》,;!\)\]"'“”‘’]+$/g, '');
      const match = candidate.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
      if (!match) continue;
      const authority = match[1].toLowerCase();
      if (!/^[a-z0-9.-]+$/.test(authority) || authority.includes('..') || authority.endsWith('.')) continue;
      const platform = Object.keys(hosts).find(key => hosts[key].some(domain => authority === domain || authority.endsWith('.' + domain)));
      if (!platform) continue;
      found.push({ platform, url: candidate, kind: 'url' });
    }
    const unique = [...new Map(found.map(item => [item.url, item])).values()];
    if (unique.length > 1) return { error: '检测到多个不同的商品链接，请每次只粘贴一个。', code: 'MULTIPLE_LINKS' };
    if (unique.length === 1) return unique[0];
    return { error: '暂不支持这个链接，请使用淘宝、京东或拼多多的官方分享链接。', code: 'UNSUPPORTED_HOST' };
  }

  /** Money = { amount, currency }；只做展示格式化，不做任何金额计算。 */
  function formatMoney(money) {
    if (!money || money.currency !== 'CNY' || typeof money.amount !== 'string') return '—';
    return money.amount.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function priceView(item) {
    const confirmed = item && item.finalPrice && item.priceBasis === 'CONFIRMED';
    const displayAmount = formatMoney(confirmed ? item.finalPrice : (item && item.currentPrice));
    let note = '';
    if (!item || !item.currentPrice) note = '价格未知，以平台结算页为准';
    else if (item.priceBasis === 'ESTIMATED') note = item.priceNote || '预估到手价含条件，需到平台结算页确认';
    else if (item.priceBasis === 'UNKNOWN') note = item.priceNote || '到手价未知，以平台结算页为准';
    return {
      display: displayAmount,
      caption: confirmed ? '到手价' : '当前价',
      confirmed: !!confirmed,
      showOriginal: !!confirmed && !!item.currentPrice,
      original: item && item.currentPrice ? formatMoney(item.currentPrice) : '',
      note
    };
  }

  function couponView(item) {
    const coupon = item && item.coupon;
    if (!coupon || coupon.availability === 'NONE') return { text: '暂无可用券', amount: '', conditions: [] };
    if (coupon.availability === 'UNKNOWN') return { text: '券信息未确认', amount: '', conditions: [] };
    const amount = formatMoney(coupon.discount);
    const conditions = Array.isArray(coupon.conditions) ? coupon.conditions.slice() : [];
    let expiry = '';
    if (coupon.expiresAt) {
      const date = new Date(coupon.expiresAt);
      if (!Number.isNaN(date.getTime())) expiry = `${date.getMonth() + 1}月${date.getDate()}日到期`;
    }
    return {
      amount,
      conditions: expiry ? conditions.concat(expiry) : conditions,
      text: amount ? `${amount}元券` : '有券'
    };
  }

  function isSafeImageUrl(url) {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) return false;
      const host = parsed.hostname.toLowerCase();
      return imageHostSuffixes.some(suffix => host === suffix || host.endsWith('.' + suffix));
    } catch { return false; }
  }

  function productImage(item) {
    return item && isSafeImageUrl(item.imageUrl) ? item.imageUrl : placeholderImage;
  }

  return { platformNames, analyze, formatMoney, priceView, couponView, isSafeImageUrl, productImage, placeholderImage };
});
