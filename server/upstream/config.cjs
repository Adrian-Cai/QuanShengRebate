/**
 * 职责：读取并校验服务端上游配置，固定 TOP 网关白名单，提供日志脱敏。
 * 边界：仅服务端引用；只读 process.env（不自动加载 .env 文件）；密钥绝不进入前端、日志、测试快照或仓库。
 * 调用方：server/catalog.cjs、server/upstream/{taobao-client,mapper}.cjs、server/server.cjs。
 * 关键点：live 模式缺凭据时不抛启动异常，而是返回 missing[] 供 /api/health 与 503 错误码使用；
 *         网关只接受白名单，用户输入永远不能变成任意抓取地址；G0 账号实测后需复核网关与签名方式。
 */
'use strict';

// TOP 固定网关白名单。G0 需按账号实测确认实际应使用的地址，不在白名单内的值直接拒绝启动。
const GATEWAYS = Object.freeze([
  'https://gw.api.taobao.com/router/rest',
  'https://eco.taobao.com/router/rest',
  'https://api.taobao.com/router/rest'
]);
const DEFAULT_GATEWAY = GATEWAYS[0];

// 这些值必须由部署环境注入；material_id 与推广位一样属于账号相关参数，不写死公开文档中的候选值。
const LIVE_REQUIRED = Object.freeze([
  'TAOBAO_APP_KEY',
  'TAOBAO_APP_SECRET',
  'TAOBAO_ADZONE_ID',
  'TAOBAO_MATERIAL_ID_RECOMMEND',
  'QUANSHENG_PRODUCT_REF_KEY'
]);

const TTL_MIN = 30_000;
const TTL_MAX = 120_000;
const TTL_DEFAULT = 45_000;
const FIXTURE_REF_KEY = 'fixture-only-not-a-secret';

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function readConfig(env = process.env, overrides = {}) {
  const upstream = String(overrides.upstream || env.QUANSHENG_UPSTREAM || 'live').toLowerCase();
  if (upstream !== 'live' && upstream !== 'fixture') {
    throw new Error('QUANSHENG_UPSTREAM 只能是 live 或 fixture。');
  }

  const gateway = String(env.TAOBAO_GATEWAY || DEFAULT_GATEWAY).replace(/\/+$/, '');
  if (!GATEWAYS.includes(gateway)) {
    throw Object.assign(new Error('TAOBAO_GATEWAY 不在官方 TOP 网关白名单内。'), { code: 'INVALID_GATEWAY' });
  }

  const signMethod = String(env.TAOBAO_SIGN_METHOD || 'md5').toLowerCase();
  if (signMethod !== 'md5' && signMethod !== 'hmac') {
    throw Object.assign(new Error('TAOBAO_SIGN_METHOD 只能是 md5 或 hmac。'), { code: 'INVALID_SIGN_METHOD' });
  }

  const cfg = {
    upstream,
    gateway,
    signMethod,
    appKey: String(env.TAOBAO_APP_KEY || '').trim(),
    appSecret: String(env.TAOBAO_APP_SECRET || '').trim(),
    adzoneId: String(env.TAOBAO_ADZONE_ID || '').trim(),
    siteId: String(env.TAOBAO_SITE_ID || '').trim(),
    materialIdRecommend: String(env.TAOBAO_MATERIAL_ID_RECOMMEND || '').trim(),
    materialIdSearch: String(env.TAOBAO_MATERIAL_ID_SEARCH || '').trim(),
    productRefKey: String(env.QUANSHENG_PRODUCT_REF_KEY || '').trim(),
    cacheTtlMs: clampInt(env.QUANSHENG_CACHE_TTL_MS, TTL_DEFAULT, TTL_MIN, TTL_MAX),
    timeoutMs: clampInt(env.QUANSHENG_UPSTREAM_TIMEOUT_MS, 8000, 1000, 30_000),
    missing: LIVE_REQUIRED.filter(key => !String(env[key] || '').trim())
  };

  // fixture 是显式启用的离线测试数据源，使用固定非密钥值；真实凭据永远不由代码补默认值。
  if (upstream === 'fixture' && !cfg.productRefKey) cfg.productRefKey = FIXTURE_REF_KEY;
  return cfg;
}

function credentialsReady(cfg) {
  return cfg.upstream === 'fixture' || cfg.missing.length === 0;
}

function upstreamStatus(cfg) {
  if (cfg.upstream === 'fixture') return 'FIXTURE';
  return cfg.missing.length ? 'MISSING_CREDENTIALS' : 'READY';
}

function mask(value) {
  const s = String(value || '');
  if (!s) return '(empty)';
  if (s.length <= 6) return '******';
  return s.slice(0, 3) + '***' + s.slice(-2);
}

/** 供日志使用：绝不包含 appSecret / productRefKey / 完整签名。 */
function safeConfig(cfg) {
  return {
    upstream: cfg.upstream,
    gateway: cfg.gateway,
    signMethod: cfg.signMethod,
    status: upstreamStatus(cfg),
    appKey: mask(cfg.appKey),
    adzoneId: mask(cfg.adzoneId),
    siteId: mask(cfg.siteId),
    materialIdRecommend: mask(cfg.materialIdRecommend),
    cacheTtlMs: cfg.cacheTtlMs,
    timeoutMs: cfg.timeoutMs,
    missing: cfg.missing.slice()
  };
}

/** 把可能出现在上游错误信息里的敏感串替换为占位符，避免写进日志或响应。 */
function redact(text, cfg) {
  let out = String(text == null ? '' : text);
  for (const secret of [cfg.appSecret, cfg.productRefKey, cfg.appKey]) {
    if (secret && secret.length >= 4) out = out.split(secret).join('***');
  }
  return out;
}

module.exports = {
  GATEWAYS,
  DEFAULT_GATEWAY,
  LIVE_REQUIRED,
  TTL_DEFAULT,
  FIXTURE_REF_KEY,
  readConfig,
  credentialsReady,
  upstreamStatus,
  safeConfig,
  redact
};
