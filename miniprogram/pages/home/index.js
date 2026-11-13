/**
 * 职责：小程序首页 —— 加载 /api/v1/products 的 V1.2 真实商品，处理平台/分类/搜索/分页与错误分区。
 * 边界：不含任何内置商品或链接；不生成推广链接；卡片点击只展示详情，不伪装成可购买入口。
 * 调用方：pages/home/index.wxml（数据绑定与事件）。
 * 关键点：loadId 竞态控制；京东/拼多多 tab 置灰；priceBasis 与券条件按 present() 字段展示。
 */
const Api = require('../../utils/api');

const DEFAULT_PLATFORMS = [
  { id: 'all', name: '全部', enabled: true },
  { id: 'taobao', name: '淘宝', enabled: true },
  { id: 'jd', name: '京东 未开放', enabled: false },
  { id: 'pdd', name: '拼多多 未开放', enabled: false }
];
const CATEGORIES = [
  { id: 'all', name: '精选推荐' }, { id: 'daily', name: '日用百货' },
  { id: 'home', name: '品质居家' }, { id: 'digital', name: '数码好物' },
  { id: 'food', name: '吃点好的' }
];

Page({
  data: {
    query: '', platform: 'all', category: 'all', products: [],
    loading: false, error: '', errorKind: '', notice: '', dataSource: '',
    nextCursor: '', platforms: DEFAULT_PLATFORMS, categories: CATEGORIES
  },

  onLoad() { this.loadPlatforms(); this.loadProducts(); },

  async loadPlatforms() {
    try {
      const result = await Api.platforms();
      const enabled = {};
      result.platforms.forEach(p => { enabled[p.id] = !!p.enabled; });
      const platforms = DEFAULT_PLATFORMS.map(p => Object.assign({}, p, { enabled: p.id === 'all' ? true : !!enabled[p.id] }));
      this.setData({ platforms });
    } catch (e) { /* 保留默认开放状态；错误由商品请求统一提示 */ }
  },

  async loadProducts(append = false) {
    const loadId = this._loadId = (this._loadId || 0) + 1;
    this.setData({ loading: true, error: '', errorKind: '' });
    const params = {
      query: this.data.query,
      platform: this.data.platform,
      sort: 'recommend',
      limit: 20
    };
    if (!params.query && this.data.category !== 'all') params.category = this.data.category;
    if (append && this.data.nextCursor) params.cursor = this.data.nextCursor;
    try {
      const result = await Api.products(params);
      if (loadId !== this._loadId) return;
      const items = append ? this.data.products.concat(result.items) : result.items;
      this.setData({
        products: items, loading: false,
        nextCursor: result.nextCursor || '',
        dataSource: result.dataSource || '',
        notice: result.notice || ''
      });
    } catch (e) {
      if (loadId !== this._loadId) return;
      this.setData({ error: e.message, errorKind: e.code || 'NETWORK', loading: false, products: [], nextCursor: '' });
    }
  },

  onInput(e) { this.setData({ query: e.detail.value }); },

  search() {
    const q = String(this.data.query || '').trim();
    if (/https?:\/\/|[￥¥]/i.test(q)) {
      getApp().globalData.pendingLink = q;
      wx.switchTab({ url: '/pages/convert/index' });
      return;
    }
    this.setData({ query: q, category: 'all' });
    this.loadProducts();
  },

  platform(e) {
    const id = e.currentTarget.dataset.id;
    const target = this.data.platforms.find(p => p.id === id);
    if (target && !target.enabled) { wx.showToast({ title: '该平台未开放', icon: 'none' }); return; }
    this.setData({ platform: id });
    this.loadProducts();
  },

  category(e) { this.setData({ category: e.currentTarget.dataset.id, query: '' }); this.loadProducts(); },
  scene(e) { this.setData({ query: '', platform: 'all', category: e.currentTarget.dataset.id }); this.loadProducts(); },
  loadMore() { if (this.data.nextCursor && !this.data.loading) this.loadProducts(true); },
  retry() { this.loadProducts(); },
  convert() { wx.switchTab({ url: '/pages/convert/index' }); },

  product(e) {
    const ref = e.currentTarget.dataset.ref;
    const p = this.data.products.find(x => x.productRef === ref);
    if (!p) return;
    const lines = [
      p.title,
      `${p.priceCaption} ¥${p.priceLabel}${p.showOriginal ? '（原价 ¥' + p.originalLabel + '）' : ''}`,
      `券：${p.couponText}${p.couponConditions ? '（' + p.couponConditions + '）' : ''}`,
      p.basisLabel + (p.priceNote ? '：' + p.priceNote : ''),
      '正式转链与领券购买入口待接入，当前不提供可购买的推广链接。'
    ];
    wx.showModal({ title: '商品详情 · 淘宝联盟', content: lines.join('\n'), showCancel: false });
  },

  guide() {
    wx.showModal({
      title: '先领券，再下单',
      content: '首页商品来自淘宝联盟实时接口，只有资格明确的到手价才标为「到手价」，含条件时标为「预估价」。京东与拼多多未开放；正式转链 /api/v1/conversions 待接入，暂不提供领券购买入口。价格以平台结算页为准。',
      showCancel: false
    });
  }
});
