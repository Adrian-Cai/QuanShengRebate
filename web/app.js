(() => {
  'use strict';
  const C=window.CouponCore;
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  const state={platform:'all',category:'all',query:'',sort:'recommend'};
  const labels={taobao:'淘',jd:'京',pdd:'拼'};
  const classes={taobao:'tb',jd:'jd',pdd:'pdd'};
  let toastTimer,convertJob=0;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const badge=p=>`<i class="platform-icon ${classes[p]}">${labels[p]}</i>`;
  const price=p=>`<span class="price"><small>¥</small>${C.money(C.finalPrice(p))}</span><span class="after-coupon">券后</span><span class="original-price">¥${C.money(p.priceFen)}</span>`;
  const coupon=p=>`<span class="coupon-badge"><span>券</span><b>¥${C.money(p.couponFen)}</b></span>`;
  function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3200);}
  function showDialog(title,html){$('#dialog-kicker').textContent=title;$('#dialog-content').innerHTML=html;$('#dialog').showModal();}
  function guide(){showDialog('QUANSHENG / 领券指南','<h2>先领券，再下单。</h2><ol><li><b>复制链接</b><br>从淘宝、京东或拼多多复制商品分享链接。</li><li><b>查券与转链</b><br>平台查询可用优惠，再通过联盟接口生成带推广身份的链接。</li><li><b>回原平台购买</b><br>领取可用优惠后下单。付款、物流与售后均在原购物平台完成。</li></ol><p>不是每件商品都有券，价格、优惠与资格以平台结算页为准。平台可从有效推广订单中获得佣金。</p><p>当前页面是交互原型，商品、价格、优惠与结果均为示例，尚未接入任何联盟账号；不能产生真实推广订单。</p>');}
  function renderGoods(){
    const list=C.filterProducts(state);
    $('#product-grid').innerHTML=list.map(p=>`<article class="product-card"><button class="product-image" style="--product-bg:${p.bg}" data-product="${p.id}" aria-label="查看${esc(p.title)}"><span class="image-label">${p.tag}</span><img src="assets/${p.image}.svg" alt="${esc(p.title)}示例插画" loading="lazy"></button><div class="product-content"><div class="product-origin">${badge(p.platform)} ${esc(p.store)}</div><button class="product-title" data-product="${p.id}">${esc(p.title)}</button><span class="product-subtitle">${esc(p.sub)}</span><div class="coupon-row">${coupon(p)}<span class="product-benefit">${p.benefit}</span></div><div class="product-price-row">${price(p)}</div><div class="product-bottom"><span>优惠示例</span><button class="buy-button" data-product="${p.id}">领券预览 ↗</button></div></div></article>`).join('');
    $('#empty-state').hidden=list.length!==0;
    $$('[data-platform]').forEach(el=>{const active=el.dataset.platform===state.platform;el.classList.toggle('selected',active);el.setAttribute('aria-pressed',active);});
    $$('[data-category]').forEach(el=>{const active=el.dataset.category===state.category;el.classList.toggle('selected',active);el.setAttribute('aria-pressed',active);});
    $('#query-label').hidden=!state.query;$('#query-label').textContent=`搜索“${state.query}” · ${list.length} 件示例好物`;
    $('#clear-filter').hidden=state.platform==='all'&&state.category==='all'&&!state.query;
  }
  function route(){
    const isConvert=location.hash==='#convert';
    $('#home-page').hidden=isConvert;$('#convert-page').hidden=!isConvert;
    $$('[data-nav]').forEach(el=>{const active=el.dataset.nav===(isConvert?'convert':'home');el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    document.title=isConvert?'链接查券 · 券省':'券省 · 先领券，再下单';
    window.scrollTo({top:0,behavior:'instant'});
    if(isConvert)renderHistory();
  }
  function fillLink(text){convertJob++;$('#convert-submit').disabled=false;$('#convert-submit').innerHTML='查找优惠，预览转链 <span>→</span>';$('#link-input').value=text;$('#convert-result').hidden=true;$('#input-error').hidden=true;detect();if(location.hash!=='#convert')location.hash='convert';}
  function productDetail(id){
    const p=C.products.find(p=>p.id===id);if(!p)return;
    showDialog('好物预览 / 示例商品',`<img class="dialog-product-img" src="assets/${p.image}.svg" alt="${esc(p.title)}示例插画"><div class="product-origin">${badge(p.platform)} ${esc(p.store)}</div><h2>${esc(p.title)}</h2><span class="product-subtitle">${esc(p.sub)}</span><div class="product-price-row">${price(p)}</div><div class="coupon-row">${coupon(p)}<span class="product-benefit">${p.benefit}</span></div><p>这是演示商品，价格与优惠仅用于体验。尚未生成真实领券链接。</p><button class="primary-button" id="product-convert">体验这件商品的转链流程 →</button>`);
    $('#product-convert').onclick=()=>{$('#dialog').close();fillLink(C.exampleUrl(p));};
  }
  function detect(){
    const text=$('#link-input').value;const r=C.analyze(text);
    $('#clear-link').hidden=!text;
    $('#platform-detection').textContent=!text?'等待粘贴链接':r.error?'输入后点击查询':`已识别：${C.platformNames[r.platform]}${r.kind==='token'?'淘口令':''}`;
    $('#platform-detection').classList.toggle('detected',!r.error);
  }
  function loadHistory(){try{const data=JSON.parse(localStorage.getItem('quansheng.history.v1')||'[]');return Array.isArray(data)?data.filter(i=>i&&C.products.some(p=>p.id===i.id)&&Number.isFinite(i.time)).slice(0,5):[];}catch{return [];}}
  function saveHistory(p){try{const items=loadHistory().filter(i=>i.id!==p.id);items.unshift({id:p.id,time:Date.now()});localStorage.setItem('quansheng.history.v1',JSON.stringify(items.slice(0,5)));}catch{toast('浏览器未允许保存本地记录');}renderHistory();}
  function renderHistory(){const list=loadHistory();$('#clear-history').hidden=!list.length;$('#history-list').innerHTML=list.length?list.map(i=>{const p=C.products.find(x=>x.id===i.id);return `<button class="history-row" data-history="${p.id}"><img src="assets/${p.image}.svg" alt=""><span><b>${esc(p.title)}</b><small>${C.platformNames[p.platform]} · 演示记录 · ${new Date(i.time).toLocaleDateString('zh-CN')}</small></span><i>↗</i></button>`;}).join(''):'<div class="history-empty">查过的示例好物，会在这里等你。</div>';}
  function renderResult(r){
    const p=r.demoProduct;
    if(p){
      $('#convert-result').innerHTML=`<div class="result-label"><span></span>示例结果 · 尚未连接真实联盟</div><div class="result-product"><img src="assets/${p.image}.svg" alt="示例商品插画"><div><div class="product-origin">${badge(p.platform)} ${C.platformNames[p.platform]} / 示例商品</div><h3>${esc(p.title)}</h3><div class="coupon-row">${coupon(p)}</div><div class="product-price-row">${price(p)}</div></div></div><div class="result-facts"><div><span>识别平台</span><b>${C.platformNames[p.platform]}</b></div><div><span>推广链接</span><b class="status-unconnected">未接入，未生成</b></div></div><div class="result-actions"><button class="primary-button" id="copy-result">复制演示结果</button><button class="secondary-button" id="purchase-info">查看购买方式 ↗</button></div><p class="result-message">此结果来自内置样例，不代表实际查券成功。正式接入后，这里展示接口返回的真实券信息与推广链接。</p>`;
      $('#copy-result').onclick=()=>copy(`[券省交互演示，不可用于购物]\n${p.title}\n${C.platformNames[p.platform]} · 示例券后价 ¥${C.money(C.finalPrice(p))}\n未生成真实优惠券或推广链接。`);
      $('#purchase-info').onclick=()=>showDialog('购买方式 / 未接入','<h2>从这里，回到购物平台。</h2><p>正式接入后，网站展示联盟接口返回的推广链接或口令；小程序按实际授权返回的 appId、path 等数据，提供可用的跳转方式。</p><p>当前仅演示，尚未连接联盟账号，因此没有可购买的领券链接。</p>');
      saveHistory(p);
    }else{
      $('#convert-result').innerHTML=`<div class="result-label"><span></span>已识别平台 · 尚未查询真实商品</div><h3 style="font-size:17px;margin:18px 0 8px">${badge(r.platform)} ${C.platformNames[r.platform]}${r.kind==='token'?'淘口令':'链接'}已识别</h3><p class="result-message">这不是内置示例。当前尚未接入${C.platformNames[r.platform]}联盟 API，无法查询此商品的标题、价格、优惠券或佣金，也未生成推广链接。</p><button class="secondary-button" data-example="${r.platform}" style="margin-top:18px">换用${C.platformNames[r.platform]}示例体验流程 →</button>`;
    }
    $('#convert-result').hidden=false;
    $('#convert-result').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  async function copy(text){try{if(!navigator.clipboard)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(text);toast('已复制演示内容；不含真实购物链接');}catch{showDialog('手动复制','<h2>长按或选中以下内容</h2><textarea readonly style="width:100%;min-height:180px;border:1px solid #e6ddcc;border-radius:8px;padding:12px;background:#fffdfa;color:#80725a">'+esc(text)+'</textarea>');}}
  $('#convert-form').onsubmit=async e=>{
    e.preventDefault();const r=C.analyze($('#link-input').value);$('#input-error').hidden=true;$('#convert-result').hidden=true;
    if(r.error){$('#input-error').textContent=r.error;$('#input-error').hidden=false;$('#link-input').setAttribute('aria-invalid','true');return;}
    $('#link-input').removeAttribute('aria-invalid');const job=++convertJob;const b=$('#convert-submit');b.disabled=true;b.textContent='正在准备演示结果…';
    await new Promise(resolve=>setTimeout(resolve,400));if(job!==convertJob)return;
    b.disabled=false;b.innerHTML='查找优惠，预览转链 <span>→</span>';renderResult(r);
  };
  $('#link-input').oninput=()=>{convertJob++;$('#convert-submit').disabled=false;$('#convert-submit').innerHTML='查找优惠，预览转链 <span>→</span>';$('#input-error').hidden=true;$('#link-input').removeAttribute('aria-invalid');$('#convert-result').hidden=true;detect();};
  $('#clear-link').onclick=()=>{fillLink('');$('#link-input').focus();};
  $('#search-form').onsubmit=e=>{e.preventDefault();const text=$('#search-input').value.trim();if(!text){toast('输入商品名称或粘贴商品链接');$('#search-input').focus();return;}if(/https?:\/\/|[￥¥]/i.test(text)){fillLink(text);return;}state.query=text;state.platform='all';state.category='all';renderGoods();$('#goods-section').scrollIntoView({behavior:'smooth'});};
  $('#sort-select').onchange=e=>{state.sort=e.target.value;renderGoods();};
  function clearFilters(){Object.assign(state,{platform:'all',category:'all',query:'',sort:'recommend'});$('#sort-select').value='recommend';$('#search-input').value='';renderGoods();}
  $('#clear-filter').onclick=clearFilters;$('#empty-reset').onclick=clearFilters;
  $('#start-convert').onclick=()=>location.hash='convert';
  $('#guide-button').onclick=guide;$('#footer-guide').onclick=guide;
  $('#demo-info').onclick=()=>showDialog('当前版本 / 交互演示','<h2>把想法，先变成可体验的页面。</h2><p>你可以浏览示例好物，筛选平台与专题，粘贴链接识别平台，体验查券结果和双 Tab 手机布局。</p><p>商品、价格与优惠均为样例。真实查询、联盟转链、订单同步和佣金结算需要服务端以及三家联盟开通的应用权限。</p><p>本版本按“用户领券，平台赚佣金”设计，尚未涉及用户余额或提现。</p>');
  $('#clear-history').onclick=()=>{try{localStorage.removeItem('quansheng.history.v1');}catch{}renderHistory();toast('已清空本设备记录');};
  $('#dialog-close').onclick=()=>$('#dialog').close();
  $('#dialog').onclick=e=>{if(e.target===$('#dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
  document.addEventListener('click',e=>{
    const product=e.target.closest('[data-product]');if(product){productDetail(product.dataset.product);return;}
    const platform=e.target.closest('[data-platform]');if(platform){state.platform=platform.dataset.platform;renderGoods();return;}
    const category=e.target.closest('[data-category]');if(category){state.category=category.dataset.category;renderGoods();return;}
    const collection=e.target.closest('[data-collection]');if(collection){state.category=collection.dataset.collection;state.query='';state.platform='all';$('#search-input').value='';renderGoods();$('#goods-section').scrollIntoView({behavior:'smooth'});return;}
    const search=e.target.closest('[data-search]');if(search){$('#search-input').value=search.dataset.search;$('#search-form').requestSubmit();return;}
    const example=e.target.closest('[data-example]');if(example){fillLink(C.exampleUrl(example.dataset.example));$('#link-input').focus();return;}
    const history=e.target.closest('[data-history]');if(history){fillLink(C.exampleUrl(history.dataset.history));$('#convert-form').requestSubmit();}
  });
  window.addEventListener('hashchange',route);renderGoods();renderHistory();route();
})();
