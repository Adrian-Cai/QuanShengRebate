const Api=require('../../utils/api');
const Core=require('../../utils/core');
function history(){try{return (wx.getStorageSync('quansheng.history')||[]).filter(x=>x&&Core.products.some(p=>p.id===x.id)).slice(0,5);}catch(e){return [];}}
Page({
  data:{text:'',detected:'等待粘贴链接',error:'',busy:false,result:null,history:[],demo:true},
  onShow(){this.setData({demo:getApp().globalData.useDemoData,history:history()});const text=getApp().globalData.pendingLink;if(text){getApp().globalData.pendingLink='';this.fill(text);}},
  onInput(e){this.fill(e.detail.value);},
  fill(text){this._job=(this._job||0)+1;const r=Core.analyze(text);this.setData({text,error:'',result:null,busy:false,detected:!text?'等待粘贴链接':r.error?'输入后点击查询':'已识别：'+Core.platformNames[r.platform]});},
  clear(){this.fill('');},
  example(e){this.fill(Core.exampleUrl(e.currentTarget.dataset.platform));},
  paste(){wx.getClipboardData({success:res=>this.fill(res.data),fail:()=>this.setData({error:'未能读取剪贴板，请长按输入框手动粘贴。'})});},
  async convert(){
    const job=this._job=(this._job||0)+1;this.setData({busy:true,error:'',result:null});
    try{const r=await Api.convert(this.data.text);if(job!==this._job)return;
      this.setData({result:Object.assign({},r,{platformName:Core.platformNames[r.platform]}),busy:false});
      if(r.mode==='demo'&&r.product){const list=history().filter(x=>x.id!==r.product.id);list.unshift({id:r.product.id,title:r.product.title,platformName:r.product.platformName,imagePath:r.product.imagePath});try{wx.setStorageSync('quansheng.history',list.slice(0,5));this.setData({history:list.slice(0,5)});}catch(e){}}
    }catch(e){if(job===this._job)this.setData({error:e.message,busy:false});}
  },
  copyDemo(){const r=this.data.result;if(!r||!r.product)return;wx.setClipboardData({data:'[券省交互演示，不可购物]\n'+r.product.title+'\n示例券后价 ¥'+r.product.priceLabel+'\n未生成真实推广链接。'});},
  purchase(){
    // Read only a server-verified launch descriptor. The demo never fabricates one.
    const r=this.data.result;if(!r||r.mode!=='live'||!r.promotion){wx.showModal({title:'当前为演示',content:'尚未连接联盟应用，没有可用于购物的领券或推广链接。',showCancel:false});return;}
    const p=r.promotion;
    // Called directly in this user tap handler; never after an asynchronous conversion callback.
    if(p.miniProgram&&p.miniProgram.appId&&p.miniProgram.path){wx.navigateToMiniProgram({appId:p.miniProgram.appId,path:p.miniProgram.path,envVersion:'release',fail:()=>wx.showModal({title:'暂时无法跳转',content:'请使用平台允许的其他购买方式，或稍后再试。',showCancel:false})});return;}
    if(p.copyText){wx.setClipboardData({data:p.copyText,success:()=>wx.showModal({title:'已复制推广内容',content:'请前往'+r.platformName+' App 粘贴打开，核对优惠后下单。',showCancel:false})});return;}
    wx.showModal({title:'暂不支持此方式',content:'该平台尚未返回当前小程序可使用的推广入口。',showCancel:false});
  },
  previous(e){this.fill(Core.exampleUrl(e.currentTarget.dataset.id));},
  clearHistory(){wx.removeStorageSync('quansheng.history');this.setData({history:[]});}
});
