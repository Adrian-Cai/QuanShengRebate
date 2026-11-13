/**
 * 职责：小程序「链接识别」占位页 —— 本地识别平台 + 服务端 /api/convert 校验，不查询商品、不转链。
 * 边界：本次不实现 /api/v1/conversions；不生成推广链接、不跳转购买、不保存演示记录。
 * 调用方：pages/convert/index.wxml；首页搜索命中链接时通过 globalData.pendingLink 传入。
 * 关键点：_job 竞态控制；结果恒为「已识别平台 · 正式转链待接入」。
 */
const Api = require('../../utils/api');
const Core = require('../../utils/core');

Page({
  data: { text: '', detected: '等待粘贴链接', error: '', busy: false, result: null },

  onShow() {
    const text = getApp().globalData.pendingLink;
    if (text) { getApp().globalData.pendingLink = ''; this.fill(text); }
  },

  onInput(e) { this.fill(e.detail.value); },

  fill(text) {
    this._job = (this._job || 0) + 1;
    const r = Core.analyze(text);
    this.setData({
      text, error: '', result: null, busy: false,
      detected: !text ? '等待粘贴链接' : r.error ? '输入后点击识别' : '已识别：' + Core.platformNames[r.platform]
    });
  },

  clear() { this.fill(''); },

  paste() {
    wx.getClipboardData({
      success: res => this.fill(res.data),
      fail: () => this.setData({ error: '未能读取剪贴板，请长按输入框手动粘贴。' })
    });
  },

  async convert() {
    const text = this.data.text;
    if (!String(text || '').trim()) { this.setData({ error: '请先粘贴商品链接或分享文案。' }); return; }
    const job = this._job = (this._job || 0) + 1;
    this.setData({ busy: true, error: '', result: null });
    try {
      const r = await Api.convert(text);
      if (job !== this._job) return;
      this.setData({ result: r, busy: false });
    } catch (e) {
      if (job === this._job) this.setData({ error: e.message, busy: false });
    }
  },

  info() {
    wx.showModal({
      title: '正式转链待接入',
      content: '当前服务仅识别链接所属平台，不查询商品、优惠或佣金，也不生成任何推广链接。正式转链需要账号权限核对、推广位配置与 /api/v1/conversions 实现；京东、拼多多平台未开放。',
      showCancel: false
    });
  }
});
