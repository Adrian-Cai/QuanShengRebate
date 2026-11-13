/**
 * 职责：淘宝开放平台 TOP 网关签名、POST form 调用、超时控制与上游错误码分类。
 * 边界：只调用 METHODS 白名单内的官方方法；不引入 SDK；不记录密钥、签名或完整上游响应。
 * 调用方：server/catalog.cjs（编排层），server/adapter.test.cjs（离线签名/错误分类测试）。
 * 关键点：MD5(secret + 排序拼接 kv + secret) 大写十六进制；时间戳按北京时间 yyyy-MM-dd HH:mm:ss；
 *         权限/限流/超时/其他分别映射为 V1.2 错误码，普通用户不看到凭据细节。
 */
'use strict';

const crypto = require('node:crypto');
const { redact } = require('./config.cjs');

const METHODS = Object.freeze(new Set([
  'taobao.tbk.dg.material.recommend',
  'taobao.tbk.dg.material.optional.upgrade'
]));

// G0 需按账号实测复核：应用角色可能是推广者 dg.* 或服务商 sc.*，权限不足的表现形式也会不同。
const PERMISSION_CODES = new Set([11, 12, 13, 15, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 40, 41, 42, 43]);
const RATE_CODES = new Set([7, 8, 9]);
const PERMISSION_WORDS = /权限|未开通|未授权|授权|签名|appkey|app_key|session|permission|isv\.|invalid signature/i;
const RATE_WORDS = /限流|频率|配额|超出|too many|rate limit|quota|call limited|flow control/i;

class UpstreamError extends Error {
  constructor(code, status, message, meta = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = status;
    this.meta = meta;
  }
}

function upstreamError(code, status, message, meta) {
  return new UpstreamError(code, status, message, meta);
}

/** TOP 要求北京时间；用 UTC+8 偏移构造，避免依赖宿主机时区。 */
function topTimestamp(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/** 业务参数与公共参数按 key 升序拼接；secret 只用于签名，不进入请求。 */
function buildSignedParams(method, business, cfg, timestamp = topTimestamp()) {
  if (!METHODS.has(method)) {
    throw upstreamError('INVALID_INPUT', 400, '未批准的联盟接口方法。');
  }
  const params = {
    app_key: cfg.appKey,
    method,
    timestamp,
    format: 'json',
    v: '2.0',
    sign_method: cfg.signMethod
  };
  for (const [key, value] of Object.entries(business || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object') {
      throw upstreamError('INVALID_INPUT', 400, '上游业务参数不接受对象或数组。');
    }
    params[key] = String(value);
  }
  const base = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  params.sign = cfg.signMethod === 'hmac'
    ? crypto.createHmac('md5', cfg.appSecret).update(base, 'utf8').digest('hex').toUpperCase()
    : crypto.createHash('md5').update(cfg.appSecret + base + cfg.appSecret, 'utf8').digest('hex').toUpperCase();
  return params;
}

function classifyTopError(payload, cfg) {
  const err = (payload && payload.error_response) || {};
  const code = Number(err.code);
  const detail = [err.msg, err.sub_code, err.sub_msg].filter(Boolean).join(' / ');
  const safeDetail = redact(detail, cfg);
  if (Number.isFinite(code) && RATE_CODES.has(code)) {
    return upstreamError('UPSTREAM_RATE_LIMITED', 503, '联盟接口调用过于频繁，请稍后重试。', { topCode: code, detail: safeDetail });
  }
  if (Number.isFinite(code) && PERMISSION_CODES.has(code)) {
    return upstreamError('UPSTREAM_PERMISSION_MISSING', 503, '联盟接口权限或凭据校验未通过，请联系管理员核对账号权限。', { topCode: code, detail: safeDetail });
  }
  if (RATE_WORDS.test(detail)) {
    return upstreamError('UPSTREAM_RATE_LIMITED', 503, '联盟接口配额或限流，请稍后重试。', { topCode: code || null, detail: safeDetail });
  }
  if (PERMISSION_WORDS.test(detail)) {
    return upstreamError('UPSTREAM_PERMISSION_MISSING', 503, '联盟接口权限或凭据校验未通过，请联系管理员核对账号权限。', { topCode: code || null, detail: safeDetail });
  }
  return upstreamError('UPSTREAM_ERROR', 502, '联盟接口暂时不可用，请稍后重试。', { topCode: code || null, detail: safeDetail });
}

/**
 * @param {string} method 白名单内的 TOP 方法
 * @param {object} business 业务参数（用户输入只能作为 q，且必须经过 catalog 规范化）
 * @param {object} cfg config.readConfig 的结果
 * @param {object} [deps] 测试注入：{fetchImpl, timestamp}
 */
async function callTop(method, business, cfg, deps = {}) {
  let params;
  try {
    params = buildSignedParams(method, business, cfg, deps.timestamp || topTimestamp());
  } catch (error) {
    throw error;
  }
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw upstreamError('UPSTREAM_ERROR', 502, '运行环境不支持 fetch。');
  }

  let response;
  try {
    response = await fetchImpl(cfg.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', 'Accept': 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(cfg.timeoutMs)
    });
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw upstreamError('UPSTREAM_TIMEOUT', 504, '联盟接口响应超时，请稍后重试。');
    }
    throw upstreamError('UPSTREAM_ERROR', 502, '无法连接联盟接口，请稍后重试。');
  }

  if (!response.ok) {
    throw upstreamError('UPSTREAM_ERROR', 502, '联盟网关返回 HTTP ' + response.status + '。', { httpStatus: response.status });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw upstreamError('UPSTREAM_ERROR', 502, '联盟接口返回的格式无法解析。');
  }
  if (payload && payload.error_response) throw classifyTopError(payload, cfg);
  return payload;
}

module.exports = {
  METHODS,
  UpstreamError,
  upstreamError,
  topTimestamp,
  buildSignedParams,
  classifyTopError,
  callTop
};
