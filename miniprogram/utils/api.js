const Core = require('./core');
function request(path, data, method) {
  const config=getApp().globalData;
  if(!/^https:\/\//.test(config.apiBase)) return Promise.reject(new Error('请配置已备案且加入合法域名的 HTTPS 服务端地址'));
  return new Promise((resolve,reject)=>wx.request({url:config.apiBase.replace(/\/$/,'')+path,method:method||'GET',data,timeout:12000,
    success(res){if(res.statusCode>=200&&res.statusCode<300)resolve(res.data);else reject(new Error((res.data.error&&res.data.error.message)||'服务暂时不可用，请稍后重试'));},
    fail(){reject(new Error('网络连接失败，请检查网络后重试'));}
  }));
}
function present(p){return Object.assign({},p,{priceLabel:Core.money(Core.finalPrice(p)),couponLabel:Core.money(p.couponFen),originalLabel:Core.money(p.priceFen),platformName:Core.platformNames[p.platform],imagePath:p.imageUrl||'/assets/'+p.image+'.png'});}
function requireLive(r){if(r.mode!=='live')throw new Error('服务端仍处于演示模式，尚未开放真实联盟服务');return r;}
module.exports={
  present,
  products(filters){if(getApp().globalData.useDemoData)return Promise.resolve({mode:'demo',items:Core.filterProducts(filters).map(present)});return request('/api/products',filters).then(requireLive).then(r=>Object.assign({},r,{items:r.items.map(present)}));},
  convert(text){
    if(!getApp().globalData.useDemoData)return request('/api/convert',{text},'POST').then(requireLive).then(r=>Object.assign({},r,{product:r.product?present(r.product):null}));
    const r=Core.analyze(text);if(r.error)return Promise.reject(new Error(r.error));
    return Promise.resolve({mode:'demo',platform:r.platform,kind:r.kind,product:r.demoProduct?present(r.demoProduct):null,promotion:null,status:r.demoProduct?'DEMO_RESULT':'UPSTREAM_NOT_CONNECTED'});
  }
};
