const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../shared/core.cjs');
const {createServer}=require('./server.cjs');
test('识别官方长短链接，允许整段分享文案和中文句末标点',()=>{
  assert.equal(Core.analyze('【分享】https://m.tb.cn/h.demo，').platform,'taobao');
  assert.equal(Core.analyze('https://u.jd.com/demo').platform,'jd');
  assert.equal(Core.analyze('https://p.pinduoduo.com/demo').platform,'pdd');
});
test('拒绝伪造域名、凭证、端口和 URL 混淆',()=>{
  for(const url of ['https://taobao.com.evil.example/item','https://eviltaobao.com/item','https://user@taobao.com/item','https://taobao.com:9999/item','https://taobao.com%2eevil.com/item','https://127.0.0.1/item','https://taobao.com\\@evil.com/item','javascript:alert(1)'])assert.ok(Core.analyze(url).error,url);
});
test('单次请求多个商品链接时要求用户选择，重复链接除外',()=>{
  assert.equal(Core.analyze('https://u.jd.com/a https://u.jd.com/b').code,'MULTIPLE_LINKS');
  assert.equal(Core.analyze('https://u.jd.com/a https://u.jd.com/a').platform,'jd');
});
test('真实链接不会被替换成虚构商品',()=>{
  assert.equal(Core.analyze('https://item.taobao.com/item.htm?id=12345').demoProduct,null);
  assert.equal(Core.analyze(Core.exampleUrl(Core.products[0])).demoProduct.id,Core.products[0].id);
  assert.equal(Core.analyze('￥Abc123456￥').demoProduct,null);
});
test('输入边界不触发上游调用',()=>{
  for(const text of [undefined,null,{},''])assert.equal(Core.analyze(text).code,'EMPTY_INPUT');
  assert.equal(Core.analyze('a'.repeat(2001)).code,'INPUT_TOO_LONG');
});
test('价格全程使用整数分，专区筛选与排序符合实际金额',()=>{
  const items=Core.filterProducts({category:'under10',sort:'price-asc'});
  assert.equal(items.length,2);assert.ok(items.every(p=>Core.finalPrice(p)<=990));
  assert.equal(Core.money(Core.finalPrice(items[0])),'9.9');
  const prices=Core.filterProducts({sort:'price-asc'}).map(Core.finalPrice);
  assert.deepEqual(prices,[...prices].sort((a,b)=>a-b));
});
test('正式模式拒绝启动，避免把演示返回当作真实优惠',()=>assert.throws(()=>createServer({mode:'live'}),/LIVE_ADAPTERS_NOT_IMPLEMENTED/));
test('API 验证、未知链接及示例响应均不包含可购物的推广链接',async()=>{
  const server=createServer({mode:'demo'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const convert=text=>fetch(base+'/api/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
    const unknown=await (await convert('https://item.jd.com/123456.html')).json();assert.equal(unknown.product,null);assert.equal(unknown.promotion,null);assert.equal(unknown.status,'UPSTREAM_NOT_CONNECTED');
    const demo=await(await convert(Core.exampleUrl('pdd'))).json();assert.ok(demo.product);assert.equal(demo.mode,'demo');assert.equal(demo.promotion,null);
    assert.equal((await convert('https://evil.example/item')).status,400);
    assert.equal((await fetch(base+'/api/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
    assert.equal((await fetch(base+'/api/convert',{method:'POST',body:'hello'})).status,415);
    assert.equal((await fetch(base+'/api/orders')).status,404);
    assert.equal((await fetch(base+'/')).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
