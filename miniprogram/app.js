/**
 * 职责：小程序全局配置。只保留 API 地址与开发者工具联调开关，不再有任何内置数据源开关。
 * 边界：不包含任何密钥；apiBase 留空时页面会明确报错，不会回退到任何内置商品。
 * 调用方：miniprogram/utils/api.js 读取 getApp().globalData。
 * 关键点：真机使用已备案的 HTTPS 合法域名；allowLocalHttpInDevTools 仅在开发者工具中允许 127.0.0.1。
 */
App({
  globalData: {
    // 开发者工具联调示例：apiBase: 'http://127.0.0.1:3000', allowLocalHttpInDevTools: true
    // 真机 / 上线：apiBase 必须是已在小程序后台配置为 request 合法域名的 HTTPS 地址。
    apiBase: '',
    allowLocalHttpInDevTools: false,
    pendingLink: ''
  }
});
