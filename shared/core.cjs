/**
 * 职责：服务端侧的链接 / 平台识别与平台名称常量（不含任何商品数据）。
 * 边界：纯逻辑，不触网、不读环境变量、不生成任何推广链接或商品对象。
 * 调用方：server/server.cjs 的 POST /api/convert；server/core.test.cjs。
 * 关键点：域名伪造、凭据、端口、URL 混淆一律拒绝；识别结果只含平台与链接，不再返回任何内置商品对象。
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
      // No network resolution here. Credentials, ports, escapes and lookalike hosts are rejected.
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

  return { platformNames, analyze };
});
