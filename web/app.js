/**
 * 职责：网页交互层 —— 请求 /api/v1/products 渲染淘宝联盟真实商品，处理分页、筛选、搜索、
 *       空/错/超时分区、商品详情、历史记录与仅识别平台的转链占位页。
 * 边界：不含任何内置商品数据；不伪造推广链接或购买入口；正式转链 /api/v1/conversions 本次范围外。
 * 调用方：web/index.html（defer 加载），同源 Node 服务提供数据。
 * 关键点：goodsJob / convertJob 竞态控制保留；金额由 web/core.js 的 formatMoney/priceView 统一处理；
 *         上游失败按错误码分区提示，绝不回退到任何离线兜底数据；fixture 数据源在页面上显著标注。
 */
(() => {
  'use strict';
  const C = window.CouponCore;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const state = { platform: 'all', category: 'all', query: '', sort: 'recommend' };
  const labels = { taobao: '淘', jd: '京', pdd: '拼' };
  const classes = { taobao: 'tb', jd: 'jd', pdd: 'pdd' };
  const HISTORY_KEY = 'quansheng.history.v2';

  const ERROR_TEXT = {
    UPSTREAM_TIMEOUT: '淘宝联盟接口响应超时，请稍后重试。',
    UPSTREAM_RATE_LIMITED: '淘宝联盟接口调用过于频繁，请稍后再试。',
    UPSTREAM_PERMISSION_MISSING: '服务端尚未配置完整的淘宝联盟凭据或权限，商品暂不可用，请联系管理员。',
    UPSTREAM_ERROR: '淘宝联盟接口暂时不可用，请稍后重试。',
    PLATFORM_NOT_ENABLED: '该平台尚未开放，当前仅接入淘宝联盟。',
    INVALID_CURSOR: '分页信息已失效，请重新查询。'
  };

  let toastTimer;
  let convertJob = 0;
  let goodsJob = 0;
  let visibleProducts = [];
  let nextCursor = null;
  let dataSource = null;

  class ApiError extends Error {
    constructor(code, message, retryable = true) {
      super(message);
      this.code = code;
      this.retryable = retryable;
    }
  }

  async function requestApi(path, options = {}) {
    let response;
    try {
      response = await fetch(path, { ...options, signal: AbortSignal.timeout(12000) });
    } catch (error) {
      const timeout = error && error.name === 'TimeoutError';
      throw new ApiError(timeout ? 'UPSTREAM_TIMEOUT' : 'NETWORK',
        timeout ? '接口请求超时，请稍后重试。' : '无法连接服务，请先运行 npm start 并访问 http://localhost:3000。');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (data && data.error && data.error.code) || 'UNKNOWN';
      throw new ApiError(code, ERROR_TEXT[code] || (data && data.error && data.error.message) || `接口请求失败（HTTP ${response.status}）。`,
        code !== 'INVALID_INPUT' && code !== 'INVALID_CURSOR');
    }
    if (!data || data.mode !== 'live') throw new ApiError('BAD_MODE', '接口没有返回正式模式的数据。');
    return data;
  }

  async function loadGoods(cursor) {
    const params = { platform: state.platform, sort: state.sort, limit: '20' };
    if (state.query) params.query = state.query;
    else if (state.category !== 'all') params.category = state.category;
    if (cursor) params.cursor = cursor;
    const result = await requestApi(`/api/v1/products?${new URLSearchParams(params)}`);
    if (!Array.isArray(result.items)) throw new ApiError('BAD_SHAPE', '商品接口没有返回列表。');
    return result;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const badge = p => `<i class="platform-icon ${classes[p] || 'tb'}">${labels[p] || '淘'}</i>`;

  function basisChip(item) {
    const map = {
      CONFIRMED: ['到手价已确认', 'confirmed'],
      ESTIMATED: ['预估价 · 含条件', 'estimated'],
      UNKNOWN: ['到手价未知', 'unknown']
    };
    const [text, kind] = map[item.priceBasis] || map.UNKNOWN;
    return `<span class="price-basis ${kind}">${text}</span>`;
  }

  function couponHtml(item) {
    const view = C.couponView(item);
    if (!view.amount) return `<span class="coupon-badge coupon-none">${esc(view.text)}</span>`;
    const conditions = view.conditions.length
      ? `<span class="coupon-conditions">${esc(view.conditions.join(' · '))}</span>` : '';
    return `<span class="coupon-badge"><span>券</span><b>¥${esc(view.amount)}</b></span>${conditions}`;
  }

  function cardHtml(item) {
    const ref = esc(item.productRef);
    const title = esc(item.title);
    const view = C.priceView(item);
    const image = esc(C.productImage(item));
    return `
      <article class="product-card">
        <button class="product-image" data-product="${ref}" aria-label="查看${title}">
          <img src="${image}" alt="${title}" loading="lazy" referrerpolicy="no-referrer">
        </button>
        <div class="product-content">
          <div class="product-origin">${badge(item.platform)} ${item.store ? esc(item.store) : '淘宝联盟商品'}</div>
          <button class="product-title" data-product="${ref}">${title}</button>
          <div class="coupon-row">${couponHtml(item)}</div>
          <div class="product-price-row">
            <span class="price"><small>¥</small>${esc(view.display)}</span>
            <span class="price-caption">${esc(view.caption)}</span>
            ${view.showOriginal ? `<span class="original-price">¥${esc(view.original)}</span>` : ''}
          </div>
          ${basisChip(item)}
          ${view.note ? `<p class="price-note">${esc(view.note)}</p>` : ''}
          <div class="product-bottom"><span>淘宝联盟 · 实时</span><button class="detail-button" data-product="${ref}">查看详情 →</button></div>
        </div>
      </article>`;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
  }
  function showDialog(title, html) {
    $('#dialog-kicker').textContent = title;
    $('#dialog-content').innerHTML = html;
    $('#dialog').showModal();
  }

  function showGoodsError(error) {
    const code = error.code || 'NETWORK';
    const titles = {
      UPSTREAM_TIMEOUT: '上游响应超时',
      UPSTREAM_RATE_LIMITED: '上游限流',
      UPSTREAM_PERMISSION_MISSING: '凭据或权限未就绪',
      UPSTREAM_ERROR: '上游暂时不可用',
      NETWORK: '无法连接服务',
      PLATFORM_NOT_ENABLED: '平台未开放'
    };
    $('#goods-error').dataset.kind = code;
    $('#goods-error-title').textContent = titles[code] || '商品加载失败';
    $('#goods-error-message').textContent = error.message;
    $('#goods-retry').hidden = !error.retryable;
    $('#goods-error').hidden = false;
  }

  function syncFilters() {
    for (const [selector, key] of [['[data-platform]', 'platform'], ['[data-category]', 'category']]) {
      for (const button of $$(selector)) {
        const active = button.dataset[key] === state[key];
        button.classList.toggle('selected', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }
    $('#clear-filter').hidden = state.platform === 'all' && state.category === 'all' && !state.query;
    $('#sort-select').value = state.sort;
  }

  function showDataSourceNotice(result) {
    const banner = $('#data-source-notice');
    if (result.notice) {
      banner.textContent = result.notice;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  async function renderGoods({ append = false } = {}) {
    const job = ++goodsJob;
    const cursor = append ? nextCursor : '';
    if (append && !cursor) return;
    const grid = $('#product-grid');
    if (!append) { visibleProducts = []; nextCursor = null; grid.replaceChildren(); }
    grid.setAttribute('aria-busy', 'true');
    $('#goods-loading').hidden = false;
    $('#goods-error').hidden = true;
    $('#empty-state').hidden = true;
    $('#query-label').hidden = true;
    $('#load-more').hidden = true;
    syncFilters();

    try {
      const result = await loadGoods(cursor);
      if (job !== goodsJob) return;
      const incoming = Array.isArray(result.items) ? result.items : [];
      visibleProducts = append ? visibleProducts.concat(incoming) : incoming.slice();
      nextCursor = result.nextCursor || null;
      dataSource = result.dataSource;
      showDataSourceNotice(result);
      grid.innerHTML += incoming.map(cardHtml).join('');
      $('#empty-state').hidden = visibleProducts.length !== 0;
      $('#query-label').hidden = !state.query;
      if (state.query) $('#query-label').textContent = `搜索“${state.query}” · 当前 ${visibleProducts.length} 件商品`;
      $('#load-more').hidden = !nextCursor;
    } catch (error) {
      if (job !== goodsJob) return;
      showGoodsError(error);
    } finally {
      if (job === goodsJob) {
        $('#goods-loading').hidden = true;
        grid.removeAttribute('aria-busy');
      }
    }
  }

  function route() {
    const isConvert = location.hash === '#convert';
    $('#home-page').hidden = isConvert;
    $('#convert-page').hidden = !isConvert;
    $$('[data-nav]').forEach(el => {
      const active = el.dataset.nav === (isConvert ? 'convert' : 'home');
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    document.title = isConvert ? '链接查券 · 券省' : '券省 · 先领券，再下单';
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (isConvert) renderHistory();
  }

  function resetConversion() {
    convertJob++;
    $('#convert-submit').disabled = false;
    $('#convert-submit').innerHTML = '识别链接平台 <span>→</span>';
    $('#convert-result').hidden = true;
    $('#input-error').hidden = true;
    $('#link-input').removeAttribute('aria-invalid');
    detect();
  }
  function fillLink(text) {
    $('#link-input').value = text;
    resetConversion();
    if (location.hash !== '#convert') location.hash = 'convert';
  }

  function detailHtml(item) {
    const view = C.priceView(item);
    return `<img class="dialog-product-img" src="${esc(C.productImage(item))}" alt="${esc(item.title)}" referrerpolicy="no-referrer">
      <div class="product-origin">${badge(item.platform)} ${item.store ? esc(item.store) : '淘宝联盟商品'}</div>
      <h2>${esc(item.title)}</h2>
      <div class="product-price-row"><span class="price"><small>¥</small>${esc(view.display)}</span><span class="price-caption">${esc(view.caption)}</span>${view.showOriginal ? `<span class="original-price">¥${esc(view.original)}</span>` : ''}</div>
      <div class="coupon-row">${couponHtml(item)}</div>
      ${basisChip(item)}
      <p class="dialog-note">${esc(view.note || '价格与优惠以淘宝联盟返回及平台结算页为准。')}</p>
      <p class="dialog-note">商品引用：<code>${esc(item.productRef)}</code>。正式转链与领券购买入口（/api/v1/conversions）待接入，当前不提供可购买的推广链接。</p>`;
  }

  function productDetail(ref) {
    const item = visibleProducts.find(p => p.productRef === ref);
    if (!item) { toast('该商品已不在当前列表中，请重新搜索。'); return; }
    showDialog('商品详情 / 淘宝联盟', detailHtml(item));
    saveHistory(item);
  }

  function detect() {
    const text = $('#link-input').value;
    const r = C.analyze(text);
    $('#clear-link').hidden = !text;
    $('#platform-detection').textContent = !text ? '等待粘贴链接' : r.error
      ? '输入后点击识别' : `已识别：${C.platformNames[r.platform]}${r.kind === 'token' ? '淘口令' : ''}`;
    $('#platform-detection').classList.toggle('detected', !r.error);
  }

  function loadHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(data)) return [];
      return data.filter(i => i && typeof i.ref === 'string' && Number.isFinite(i.time)).slice(0, 5);
    } catch { return []; }
  }
  function saveHistory(item) {
    try {
      const list = loadHistory().filter(i => i.ref !== item.productRef);
      list.unshift({ ref: item.productRef, title: item.title, platform: item.platform, time: Date.now() });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 5)));
    } catch { toast('浏览器未允许保存本地记录'); }
    renderHistory();
  }
  function renderHistory() {
    const list = loadHistory();
    $('#clear-history').hidden = !list.length;
    $('#history-list').innerHTML = list.length
      ? list.map(i => `<button class="history-row" data-history="${esc(i.ref)}"><span><b>${esc(i.title)}</b><small>${esc(C.platformNames[i.platform] || '淘宝')} · ${new Date(i.time).toLocaleDateString('zh-CN')}</small></span><i>↗</i></button>`).join('')
      : '<div class="history-empty">查看过的商品会记录在这里（仅保存商品引用）。</div>';
  }

  async function convertLink(text) {
    const result = await requestApi('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!Object.hasOwn(C.platformNames, result.platform) ||
        result.status !== 'UPSTREAM_NOT_CONNECTED' ||
        result.product !== null || result.promotion !== null) {
      throw new ApiError('BAD_SHAPE', '转链接口的返回不符合正式契约。', false);
    }
    return result;
  }

  function renderResult(r) {
    $('#convert-result').innerHTML = `
      <div class="result-label"><span></span>已识别平台 · 正式转链待接入</div>
      <h3 class="result-heading">${badge(r.platform)} ${esc(C.platformNames[r.platform])}${r.kind === 'token' ? '淘口令' : '链接'}已识别</h3>
      <p class="result-message">${esc(r.notice || '本次仅识别链接所属平台。')}</p>
      <div class="result-facts">
        <div><span>识别平台</span><b>${esc(C.platformNames[r.platform])}</b></div>
        <div><span>商品信息</span><b class="status-unconnected">未查询</b></div>
        <div><span>推广链接</span><b class="status-unconnected">未生成</b></div>
      </div>
      <div class="result-actions"><button class="secondary-button" id="conversion-info">查看接入说明 ↗</button></div>
      <p class="result-message">正式转链、领券与购买入口属于 /api/v1/conversions，本次范围外；京东、拼多多平台未开放。</p>`;
    $('#conversion-info').onclick = () => showDialog('正式转链 / 待接入',
      '<h2>现在只做平台识别。</h2><p>当前服务仅识别链接所属平台，不查询商品、优惠或佣金，也不生成任何推广链接。</p><p>正式转链需要账号权限核对、推广位配置和 /api/v1/conversions 实现；完成后这里才会出现可领券购买的入口。</p>');
    $('#convert-result').hidden = false;
    $('#convert-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function guide() {
    showDialog('QUANSHENG / 使用说明',
      '<h2>先看真实商品，再等转链。</h2><ol><li><b>浏览真实商品</b><br>首页展示淘宝联盟实时返回的标题、主图、当前价与已知券信息。</li><li><b>理解价格口径</b><br>只有资格明确的到手价才标「到手价」；含凑单、满减等条件时显示「预估价」并列出条件。</li><li><b>链接识别</b><br>粘贴淘宝、京东或拼多多链接可识别平台，但暂不查询商品或生成推广链接。</li></ol><p>京东联盟、多多进宝尚未开放。优惠与资格以淘宝联盟返回及平台结算页为准；付款、物流与售后均在原购物平台完成。</p>');
  }

  async function showStatus() {
    try {
      const data = await requestApi('/api/v1/platforms');
      const rows = data.platforms.map(p => `<li>${esc(p.name)}：${p.enabled ? '已接入（淘宝联盟实时数据）' : '未开放'}</li>`).join('');
      showDialog('接入状态', `<h2>平台开放状态</h2><ul>${rows}</ul><p>当前数据源：${esc(dataSource || '加载中')}。正式转链 /api/v1/conversions 待接入。</p>`);
    } catch (error) { toast(error.message); }
  }

  $('#convert-form').onsubmit = async event => {
    event.preventDefault();
    const job = ++convertJob;
    const input = $('#link-input');
    const button = $('#convert-submit');
    $('#input-error').hidden = true;
    $('#convert-result').hidden = true;
    input.removeAttribute('aria-invalid');
    button.disabled = true;
    button.textContent = '正在识别平台…';
    try {
      const result = await convertLink(input.value);
      if (job === convertJob) renderResult(result);
    } catch (error) {
      if (job !== convertJob) return;
      $('#input-error').textContent = error.message;
      $('#input-error').hidden = false;
      if (C.analyze(input.value).error) input.setAttribute('aria-invalid', 'true');
    } finally {
      if (job === convertJob) { button.disabled = false; button.innerHTML = '识别链接平台 <span>→</span>'; }
    }
  };

  $('#link-input').oninput = resetConversion;
  $('#clear-link').onclick = () => { fillLink(''); $('#link-input').focus(); };
  $('#search-form').onsubmit = event => {
    event.preventDefault();
    const text = $('#search-input').value.trim();
    if (!text) { toast('输入商品名称或粘贴商品链接'); $('#search-input').focus(); return; }
    if (/https?:\/\/|[￥¥]/i.test(text)) { fillLink(text); return; }
    state.query = text;
    state.category = 'all';
    renderGoods();
    $('#goods-section').scrollIntoView({ behavior: 'smooth' });
  };
  $('#sort-select').onchange = e => { state.sort = e.target.value; renderGoods(); };
  function clearFilters() {
    Object.assign(state, { platform: 'all', category: 'all', query: '', sort: 'recommend' });
    $('#search-input').value = '';
    renderGoods();
  }
  $('#clear-filter').onclick = clearFilters;
  $('#empty-reset').onclick = clearFilters;
  $('#goods-retry').onclick = () => renderGoods();
  $('#load-more').onclick = () => renderGoods({ append: true });
  $('#start-convert').onclick = () => { location.hash = 'convert'; };
  $('#guide-button').onclick = guide;
  $('#footer-guide').onclick = guide;
  $('#status-info').onclick = showStatus;
  $('#clear-history').onclick = () => {
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* storage disabled */ }
    renderHistory();
    toast('已清空本设备记录');
  };
  $('#dialog-close').onclick = () => $('#dialog').close();
  $('#dialog').onclick = e => {
    if (e.target === $('#dialog')) {
      const r = e.target.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
    }
  };

  document.addEventListener('click', e => {
    const product = e.target.closest('[data-product]');
    if (product) { productDetail(product.dataset.product); return; }
    const platform = e.target.closest('[data-platform]');
    if (platform) {
      if (platform.dataset.disabled === 'true') { toast('该平台未开放，当前仅接入淘宝联盟。'); return; }
      state.platform = platform.dataset.platform;
      renderGoods();
      return;
    }
    const category = e.target.closest('[data-category]');
    if (category) { state.category = category.dataset.category; state.query = ''; $('#search-input').value = ''; renderGoods(); return; }
    const collection = e.target.closest('[data-collection]');
    if (collection) {
      Object.assign(state, { category: collection.dataset.collection, query: '', platform: 'all' });
      $('#search-input').value = '';
      renderGoods();
      $('#goods-section').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const search = e.target.closest('[data-search]');
    if (search) { $('#search-input').value = search.dataset.search; $('#search-form').requestSubmit(); return; }
    const history = e.target.closest('[data-history]');
    if (history) productDetail(history.dataset.history);
  });

  window.addEventListener('hashchange', route);
  if (location.protocol === 'file:') {
    showGoodsError(new ApiError('NETWORK', '请通过 npm start 启动服务后访问 http://localhost:3000，浏览器不能直接打开本地文件调用正式接口。', false));
  } else {
    renderGoods();
  }
  renderHistory();
  route();
})();
