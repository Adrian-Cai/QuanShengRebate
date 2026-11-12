const Api=require('../../utils/api');
const Core=require('../../utils/core');
Page({
  data:{query:'',platform:'all',category:'all',products:[],loading:false,error:'',demo:true,
    platforms:[{id:'all',name:'全部'},{id:'taobao',name:'淘宝'},{id:'jd',name:'京东'},{id:'pdd',name:'拼多多'}],
    categories:[{id:'all',name:'精选推荐'},{id:'daily',name:'日用百货'},{id:'home',name:'品质居家'},{id:'digital',name:'数码好物'},{id:'food',name:'吃点好的'},{id:'under10',name:'9.9元专区'}]},
  onLoad(){this.setData({demo:getApp().globalData.useDemoData});this.loadProducts();},
  async loadProducts(){const loadId=this._loadId=(this._loadId||0)+1;this.setData({loading:true,error:''});try{const r=await Api.products({query:this.data.query,platform:this.data.platform,category:this.data.category});if(loadId===this._loadId)this.setData({products:r.items,loading:false});}catch(e){if(loadId===this._loadId)this.setData({error:e.message,loading:false,products:[]});}},
  onInput(e){this.setData({query:e.detail.value});},
  search(){const q=this.data.query.trim();if(/https?:\/\/|[￥¥]/i.test(q)){getApp().globalData.pendingLink=q;wx.switchTab({url:'/pages/convert/index'});return;}this.loadProducts();},
  platform(e){this.setData({platform:e.currentTarget.dataset.id});this.loadProducts();},
  category(e){this.setData({category:e.currentTarget.dataset.id});this.loadProducts();},
  scene(e){this.setData({query:'',platform:'all',category:e.currentTarget.dataset.id});this.loadProducts();},
  convert(){wx.switchTab({url:'/pages/convert/index'});},
  product(e){const p=this.data.products.find(x=>x.id===e.currentTarget.dataset.id);if(!p)return;const link=this.data.demo?Core.exampleUrl(p):p.sourceUrl;if(!link){wx.showToast({title:'暂未返回可用的推广入口',icon:'none'});return;}getApp().globalData.pendingLink=link;wx.switchTab({url:'/pages/convert/index'});},
  guide(){wx.showModal({title:'先领券，再下单',content:'复制商品链接 → 查券并转链 → 回购物平台领券下单。付款与售后在原平台进行。当前为演示工程，不生成真实推广链接。',showCancel:false});}
});
