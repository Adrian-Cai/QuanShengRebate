(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CouponCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const platformNames = { taobao: '淘宝', jd: '京东', pdd: '拼多多' };
  const products = [
    {id:'demo-tb-mug',platform:'taobao',title:'轻量随行保温杯 · 把温暖带在身边',store:'生活器物示例店',category:'home',image:'mug',bg:'#f0eee7',priceFen:7900,couponFen:2000,tag:'秋冬小确幸',benefit:'日常精选',sub:'奶油白 / 500mL'},
    {id:'demo-jd-headphones',platform:'jd',title:'无线降噪头戴耳机 · 享受自己的节奏',store:'数码好物示例店',category:'digital',image:'headphones',bg:'#ebecef',priceFen:12900,couponFen:3000,tag:'通勤好搭子',benefit:'数码精选',sub:'雾灰色 / 蓝牙连接'},
    {id:'demo-pdd-tissue',platform:'pdd',title:'原生木浆柔韧抽纸 · 家庭囤货装',store:'日用百货示例店',category:'daily',image:'tissue',bg:'#f5eee5',priceFen:2990,couponFen:1000,tag:'日用囤货',benefit:'家庭常备',sub:'柔韧三层 / 12包装'},
    {id:'demo-tb-bag',platform:'taobao',title:'简约帆布托特包 · 装下一整天的日常',store:'随身日常示例店',category:'daily',image:'bag',bg:'#ecefe6',priceFen:3990,couponFen:1000,tag:'轻松出门',benefit:'通勤精选',sub:'燕麦色 / 大容量'},
    {id:'demo-jd-lamp',platform:'jd',title:'柔光蘑菇台灯 · 留一盏属于自己的灯',store:'品质居家示例店',category:'home',image:'lamp',bg:'#eeeae3',priceFen:8900,couponFen:2000,tag:'居家幸福感',benefit:'氛围好物',sub:'奶油色 / 三档调光'},
    {id:'demo-pdd-coffee',platform:'pdd',title:'风味挂耳咖啡 · 慢一点也很美好',store:'咖啡日记示例店',category:'food',image:'coffee',bg:'#ede6dc',priceFen:3490,couponFen:1500,tag:'每天一杯',benefit:'早餐好搭档',sub:'中度烘焙 / 10袋装'},
    {id:'demo-tb-kettle',platform:'taobao',title:'复古温控电热水壶 · 一杯热茶的时间',store:'好好生活示例店',category:'home',image:'kettle',bg:'#e9ece3',priceFen:15900,couponFen:4000,tag:'好物慢生活',benefit:'居家精选',sub:'橄榄绿 / 1.2L'},
    {id:'demo-pdd-socks',platform:'pdd',title:'舒适纯色中筒袜 · 每天都有好心情',store:'舒适日常示例店',category:'daily',image:'socks',bg:'#f1e9e4',priceFen:1990,couponFen:1000,tag:'9.9元专区',benefit:'实用好物',sub:'经典配色 / 3双装'},
    {id:'demo-jd-mouse',platform:'jd',title:'轻音无线鼠标 · 让桌面清爽一点',store:'桌面好物示例店',category:'digital',image:'mouse',bg:'#e8ede9',priceFen:5900,couponFen:1500,tag:'桌面好搭子',benefit:'数码精选',sub:'奶油白 / 双模连接'},
    {id:'demo-tb-cup',platform:'taobao',title:'陶瓷早餐马克杯 · 接住一天的好心情',store:'生活器物示例店',category:'home',image:'cup',bg:'#f0e7dd',priceFen:2990,couponFen:1000,tag:'早餐小时光',benefit:'居家精选',sub:'燕麦奶色 / 350mL'},
    {id:'demo-pdd-oats',platform:'pdd',title:'原味即食燕麦 · 认真吃好每顿早餐',store:'健康早餐示例店',category:'food',image:'oats',bg:'#eeeddf',priceFen:1990,couponFen:1000,tag:'9.9元专区',benefit:'早餐优选',sub:'原味 / 500g'},
    {id:'demo-jd-charger',platform:'jd',title:'便携快速充电器 · 旅途中的小能量',store:'数码好物示例店',category:'digital',image:'charger',bg:'#eeeaf0',priceFen:6900,couponFen:2000,tag:'轻装出发',benefit:'出行精选',sub:'白色 / 单口便携'}
  ];
  const hosts = {
    taobao:['taobao.com','tmall.com','tb.cn'],
    jd:['jd.com','3.cn'],
    pdd:['pinduoduo.com','yangkeduo.com']
  };
  const money = fen => (fen / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  const finalPrice = p => p.priceFen - p.couponFen;
  function exampleUrl(p) {
    if (typeof p === 'string') p = products.find(x => x.id === p) || products.find(x => x.platform === p);
    if (!p) return '';
    if (p.platform === 'taobao') return 'https://item.taobao.com/item.htm?id=' + p.id;
    if (p.platform === 'jd') return 'https://item.jd.com/' + p.id + '.html';
    return 'https://mobile.yangkeduo.com/goods.html?goods_id=' + p.id;
  }
  function analyze(text) {
    if (typeof text !== 'string' || !text.trim()) return {error:'请先粘贴商品链接或分享文案。',code:'EMPTY_INPUT'};
    if (text.length > 2000) return {error:'分享文案过长，请保留商品链接后重试。',code:'INPUT_TOO_LONG'};
    const urls = text.match(/https?:\/\/[^\s<>\u3000]+/gi) || [];
    if (urls.length === 0) {
      if (/[￥¥][A-Za-z0-9]{6,30}[￥¥]/.test(text)) return {platform:'taobao',kind:'token',demoProduct:null,url:null};
      return {error:'未找到支持的链接，请复制淘宝、京东或拼多多的完整商品链接。',code:'NO_URL'};
    }
    const found=[];
    for (const raw of urls) {
      const candidate=raw.replace(/[，。；！、）】》,;!\)\]"'“”‘’]+$/g,'');
      const match=candidate.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
      if (!match) continue;
      const authority=match[1].toLowerCase();
      // No network resolution here. Credentials, ports, escapes and lookalike hosts are rejected.
      if (!/^[a-z0-9.-]+$/.test(authority) || authority.includes('..') || authority.endsWith('.')) continue;
      const platform=Object.keys(hosts).find(key => hosts[key].some(domain => authority===domain || authority.endsWith('.'+domain)));
      if (!platform) continue;
      const demoProduct=products.find(p => exampleUrl(p)===candidate) || null;
      found.push({platform,url:candidate,kind:'url',demoProduct});
    }
    const unique=[...new Map(found.map(item => [item.url,item])).values()];
    if(unique.length>1) return {error:'检测到多个不同的商品链接，请每次只粘贴一个。',code:'MULTIPLE_LINKS'};
    if(unique.length===1) return unique[0];
    return {error:'暂不支持这个链接，请使用淘宝、京东或拼多多官方分享链接。',code:'UNSUPPORTED_HOST'};
  }
  function filterProducts({platform='all',category='all',query='',sort='recommend'}={}) {
    const q=query.trim().toLowerCase();
    let list=products.filter(p => (platform==='all'||p.platform===platform) && (category==='all'||(category==='under10'?finalPrice(p)<=990:p.category===category)) && (!q||[p.title,p.store,p.sub,platformNames[p.platform]].some(v=>v.toLowerCase().includes(q))));
    if(sort==='price-asc') list.sort((a,b)=>finalPrice(a)-finalPrice(b));
    if(sort==='coupon-desc') list.sort((a,b)=>b.couponFen-a.couponFen);
    return list;
  }
  return {products,platformNames,money,finalPrice,exampleUrl,analyze,filterProducts};
});
