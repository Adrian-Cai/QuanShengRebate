/**
 * 职责：券省同源 HTTP 服务 —— 静态站点 + V1.2 正式商品 API + 链接识别占位接口。
 * 边界：只有一种 live 模式，没有 demo / AFFILIATE_MODE；凭据缺失仍可启动，但商品接口明确 503，绝不回退样例。
 * 调用方：npm start；server/*.test.cjs、scripts/smoke.cjs 通过 createServer(options) 注入目录与数据源。
 * 关键点：所有 /api 响应带 requestId；上游错误按 V1.2 错误码与 HTTP 语义映射；日志不输出密钥。
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Core = require('../shared/core.cjs');
const configMod = require('./upstream/config.cjs');
const catalogMod = require('./catalog.cjs');

const publicRoot = path.resolve(__dirname, '../web');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function response(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function errorBody(code, message, requestId, extra = {}) {
  return { error: { code, message }, requestId, ...extra };
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw Object.assign(new Error('请求内容过大'), { status: 413, code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求体必须是有效 JSON'), { status: 400, code: 'INVALID_JSON' }); }
}

const FRIENDLY = {
  UPSTREAM_TIMEOUT: '联盟接口响应超时，请稍后重试。',
  UPSTREAM_RATE_LIMITED: '联盟接口调用过于频繁，请稍后再试。',
  UPSTREAM_PERMISSION_MISSING: '服务端尚未配置完整的淘宝联盟凭据或权限，请联系管理员。',
  UPSTREAM_ERROR: '联盟接口暂时不可用，请稍后重试。',
  PLATFORM_NOT_ENABLED: '该平台尚未开放。',
  INVALID_CURSOR: '分页信息已失效，请重新查询。'
};

function createServer(options = {}) {
  const catalog = options.catalog || catalogMod.createCatalog({
    upstreamMode: options.upstreamMode,
    config: options.config,
    callTop: options.callTop,
    cache: options.cache
  });

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return response(res, 200, { ...catalog.health(), notice: 'V1.2 正式契约', requestId });
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/platforms') {
        return response(res, 200, {
          mode: 'live', platforms: catalog.platforms(),
          notice: '当前仅接入淘宝联盟；京东、拼多多未开放。', requestId
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/products') {
        const query = Object.fromEntries(url.searchParams);
        try {
          const result = await catalog.list(query);
          return response(res, 200, { ...result, requestId });
        } catch (err) {
          const status = err.status || 502;
          const code = err.code || 'UPSTREAM_ERROR';
          return response(res, status, errorBody(code, FRIENDLY[code] || err.message || '商品加载失败。', requestId, {
            mode: 'live', retryable: code !== 'INVALID_INPUT' && code !== 'INVALID_CURSOR'
          }));
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/convert') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
          return response(res, 415, errorBody('JSON_REQUIRED', '请使用 application/json', requestId));
        }
        const data = await body(req);
        const result = Core.analyze(data && data.text);
        if (result.error) {
          return response(res, 400, errorBody(result.code, result.error, requestId));
        }
        // 只做链接/平台识别。正式转链属于 /api/v1/conversions，本次范围外，不伪造商品或推广链接。
        return response(res, 200, {
          id: requestId,
          mode: 'live',
          platform: result.platform,
          kind: result.kind,
          status: 'UPSTREAM_NOT_CONNECTED',
          conversionEndpoint: 'NOT_IMPLEMENTED',
          product: null,
          promotion: null,
          notice: '本次仅识别链接所属平台；正式转链 /api/v1/conversions 待接入，未查询商品、未生成推广链接。',
          requestId
        });
      }

      // /api/products（旧示例接口）已移除，与其他未知 /api/* 一样返回 NOT_IMPLEMENTED。
      if (url.pathname.startsWith('/api/')) {
        return response(res, 404, errorBody('NOT_IMPLEMENTED', '当前服务没有这个接口', requestId));
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return response(res, 405, errorBody('METHOD_NOT_ALLOWED', '不支持此请求方法', requestId));
      }
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); }
      catch { return response(res, 400, errorBody('BAD_PATH', '无效路径', requestId)); }
      const file = path.resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(publicRoot + path.sep)) {
        return response(res, 403, errorBody('FORBIDDEN', '禁止访问', requestId));
      }
      try {
        const bytes = await fs.readFile(file);
        res.writeHead(200, {
          'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch {
        return response(res, 404, errorBody('NOT_FOUND', '页面不存在', requestId));
      }
    } catch (err) {
      const status = err.status || 500;
      const code = err.code || 'INTERNAL_ERROR';
      const message = err.status ? err.message : '服务暂时不可用';
      return response(res, status, errorBody(code, message, requestId));
    }
  });
}

if (require.main === module) {
  const cfg = configMod.readConfig();
  const server = createServer({ config: cfg });
  const port = Number(process.env.PORT || 3000);
  const safe = configMod.safeConfig(cfg);
  console.log('券省 V1.2 服务已启动，端口 ' + port + '；dataSource=' + safe.upstream + '；upstream.status=' + safe.status + '。');
  console.log('上游配置（脱敏）：' + JSON.stringify(safe));
  if (cfg.upstream === 'fixture') {
    console.warn('警告：QUANSHENG_UPSTREAM=fixture 仅用于离线测试，返回的是合成数据，不是真实联盟商品。');
  }
  if (safe.status === 'MISSING_CREDENTIALS') {
    console.warn('警告：缺少 ' + safe.missing.join(', ') + '；/api/v1/products 将返回 503，不会回退示例数据。');
  }
  server.listen(port, () => console.log('监听 http://localhost:' + port));
}

module.exports = { createServer, FRIENDLY };
