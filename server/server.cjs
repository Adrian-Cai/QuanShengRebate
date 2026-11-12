/** Zero-dependency demonstration API. No live affiliate adapter is implemented here. */
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Core=require('../shared/core.cjs');
const publicRoot=path.resolve(__dirname,'../web');
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const platformStatus=Object.fromEntries(Object.keys(Core.platformNames).map(p=>[p,{configured:false,adapterImplemented:false}]));
function response(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw Object.assign(new Error('请求内容过大'),{status:413,code:'BODY_TOO_LARGE'});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('请求体必须是有效 JSON'),{status:400,code:'INVALID_JSON'});}}
function createServer(options={}){
  const mode=options.mode||process.env.AFFILIATE_MODE||'demo';
  // Refuse live mode: filling credentials alone must never return mock discounts as real data.
  if(mode!=='demo')throw new Error('LIVE_ADAPTERS_NOT_IMPLEMENTED: 正式商品、转链和订单适配器尚未实现。请按 docs/implementation.md 完成并联调后再开放正式模式。');
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/api/health')return response(res,200,{ok:true,mode:'demo',liveImplemented:false,platforms:platformStatus});
      if(req.method==='GET'&&url.pathname==='/api/products'){
        const filters=Object.fromEntries(url.searchParams);
        return response(res,200,{mode:'demo',items:Core.filterProducts(filters),notice:'示例商品，不代表联盟实时信息'});
      }
      if(req.method==='POST'&&url.pathname==='/api/convert'){
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return response(res,415,{error:{code:'JSON_REQUIRED',message:'请使用 application/json'}});
        const data=await body(req);const result=Core.analyze(data&&data.text);
        if(result.error)return response(res,400,{error:{code:result.code,message:result.error}});
        const isSample=!!result.demoProduct;
        return response(res,200,{id:crypto.randomUUID(),mode:'demo',platform:result.platform,kind:result.kind,status:isSample?'DEMO_RESULT':'UPSTREAM_NOT_CONNECTED',product:result.demoProduct,promotion:null,notice:isSample?'仅演示，不生成真实推广链接':'仅识别平台；未连接联盟，未查询真实商品'});
      }
      if(url.pathname.startsWith('/api/'))return response(res,404,{error:{code:'NOT_IMPLEMENTED',message:'当前演示工程没有这个接口'}});
      if(req.method!=='GET'&&req.method!=='HEAD')return response(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'不支持此请求方法'}});
      let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return response(res,400,{error:{code:'BAD_PATH',message:'无效路径'}});}
      const file=path.resolve(publicRoot,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(publicRoot+path.sep))return response(res,403,{error:{code:'FORBIDDEN',message:'禁止访问'}});
      try{const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);}catch{return response(res,404,{error:{code:'NOT_FOUND',message:'页面不存在'}});}
    }catch(err){response(res,err.status||500,{error:{code:err.code||'INTERNAL_ERROR',message:err.status?err.message:'服务暂时不可用'}});}
  });
}
if(require.main===module){const server=createServer();const port=Number(process.env.PORT||3000);server.listen(port,()=>console.log('券省演示服务已启动，端口 '+port+'；真实联盟未接入。'));}
module.exports={createServer};
