/**
 * 职责：商品目录编排层 —— 首页推荐 / 关键词搜索 / 排序 / 分页游标 / 平台开放状态 / 凭据状态。
 * 边界：不直接读 HTTP 请求对象；用户输入只作为 q 传给白名单内的 TOP 方法；不含任何示例商品兜底。
 * 调用方：server/server.cjs、server/catalog.test.cjs、scripts/smoke.cjs。
 * 关键点：live 缺凭据 → 503 UPSTREAM_PERMISSION_MISSING，绝不回退 fixture 或样例；
 *         fixture 必须显式开启且响应带 dataSource/notice；分页游标服务端签名并绑定查询条件与位点。
 */
'use strict';

const crypto = require('node:crypto');
const configMod = require('./upstream/config.cjs');
const client = require('./upstream/taobao-client.cjs');
const mapper = require('./upstream/mapper.cjs');
const cacheMod = require('./upstream/cache.cjs');
const fixture = require('./upstream/fixture.cjs');

const PLATFORMS = Object.freeze([
  { id: 'taobao', name: '淘宝', enabled: true, status: 'OPEN', reason: null },
  { id: 'jd', name: '京东', enabled: false, status: 'NOT_OPEN', reason: '未开放' },
  { id: 'pdd', name: '拼多多', enabled: false, status: 'NOT_OPEN', reason: '未开放' }
]);

const METHODS = Object.freeze({
  recommended: 'taobao.tbk.dg.material.recommend',
  search: 'taobao.tbk.dg.material.optional.upgrade'
});
const FEEDS = Object.freeze(new Set(['recommended', 'search']));

// 只暴露上游确实支持的能力；本地伪分类（home/digital/under10）一律映射为 q 或直接拒绝。
const CATEGORY_QUERY = Object.freeze({ all: '', daily: '日用', home: '家居', digital: '数码', food: '食品' });
const SORTS = Object.freeze({ recommend: '', 'price-asc': 'price_asc' });
const CURSOR_TTL_MS = 10 * 60 * 1000;
const REF_TTL_MS = 10 * 60 * 1000;
const MAX_QUERY_LENGTH = 100;
const MAX_LIMIT = 20;

function fail(code, status, message) {
  return new client.UpstreamError(code, status, message);
}

function normalizeQuery(raw = {}) {
  const get = key => (raw[key] === undefined ? '' : String(raw[key]));
  const platform = get('platform') || 'all';
  if (!['all', 'taobao', 'jd', 'pdd'].includes(platform)) throw fail('INVALID_INPUT', 400, '不支持的平台参数。');
  const sort = get('sort') || 'recommend';
  if (!Object.hasOwn(SORTS, sort)) throw fail('INVALID_INPUT', 400, '不支持的排序方式。');
  const category = get('category') || 'all';
  if (!Object.hasOwn(CATEGORY_QUERY, category)) throw fail('INVALID_INPUT', 400, '不支持的分类，上游没有对应的伪分类能力。');

  const rawFeed = get('feed');
  if (rawFeed && !FEEDS.has(rawFeed)) throw fail('INVALID_INPUT', 400, '不支持的推荐流参数。');
  let q = get('query').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
  if (!q) q = CATEGORY_QUERY[category];
  const limitRaw = Number(get('limit') || MAX_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limitRaw))) : MAX_LIMIT;
  if (rawFeed === 'search' && !q) throw fail('INVALID_INPUT', 400, '关键词搜索需要提供 query。');
  // 有关键词就必须走搜索方法；feed 只是显式声明，不能把用户输入塞进推荐物料接口。
  const feed = q ? 'search' : 'recommended';
  const cursor = get('cursor');

  return {
    platform,
    resolvedPlatform: platform === 'all' ? 'taobao' : platform,
    feed,
    q,
    sort,
    category,
    limit,
    cursor,
    cursorPayload: null
  };
}

function encodeCursor(payload, key) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', String(key)).update(body, 'utf8').digest('base64url').slice(0, 22);
  return body + '.' + sig;
}

function decodeCursor(cursor, key) {
  if (typeof cursor !== 'string' || !cursor.includes('.')) throw fail('INVALID_CURSOR', 400, '分页游标无效。');
  const [body, sig] = cursor.split('.');
  const expected = crypto.createHmac('sha256', String(key)).update(body, 'utf8').digest('base64url').slice(0, 22);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw fail('INVALID_CURSOR', 400, '分页游标校验失败。');
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw fail('INVALID_CURSOR', 400, '分页游标内容无效。'); }
  if (!payload || payload.v !== 1 || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
    throw fail('INVALID_CURSOR', 400, '分页游标已过期，请重新查询。');
  }
  return payload;
}

function buildUpstreamParams(q, pageNo, cfg) {
  // 用户输入仅经过 q 进入这里，且方法由 feed 决定，不接受客户端指定的 PID / 网关 / 任意 URL。
  if (q.feed === 'search') {
    const params = { adzone_id: cfg.adzoneId, q: q.q, page_no: pageNo, page_size: q.limit };
    if (cfg.materialIdSearch) params.material_id = cfg.materialIdSearch;
    if (cfg.siteId) params.site_id = cfg.siteId;
    if (SORTS[q.sort]) params.sort = SORTS[q.sort];
    return params;
  }
  const params = {
    adzone_id: cfg.adzoneId,
    material_id: cfg.materialIdRecommend,
    page_no: pageNo,
    page_size: q.limit
  };
  if (cfg.siteId) params.site_id = cfg.siteId;
  return params;
}

function createCatalog(options = {}) {
  const cfg = options.config || configMod.readConfig(process.env, { upstream: options.upstreamMode });
  const cache = options.cache || cacheMod.createCache({ ttlMs: cfg.cacheTtlMs });
  const callTopImpl = options.callTop || ((method, params, c) => client.callTop(method, params, c));
  const refStore = new Map();

  function platforms() { return PLATFORMS.map(p => ({ ...p })); }
  function platformStatus() {
    return Object.fromEntries(PLATFORMS.map(p => [p.id, { enabled: p.enabled, status: p.status, reason: p.reason }]));
  }
  function health() {
    const status = configMod.upstreamStatus(cfg);
    return {
      ok: status !== 'MISSING_CREDENTIALS',
      mode: 'live',
      liveImplemented: true,
      dataSource: cfg.upstream === 'fixture' ? 'fixture' : 'taobao',
      upstream: {
        status,
        gateway: cfg.gateway,
        signMethod: cfg.signMethod,
        missing: cfg.missing.slice()
      },
      platforms: platformStatus(),
      warning: cfg.upstream === 'fixture' ? fixture.NOTICE : null
    };
  }

  function resolveProductRef(ref) {
    const entry = refStore.get(ref);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) { refStore.delete(ref); return null; }
    return { platform: entry.platform, itemId: entry.itemId };
  }

  async function list(rawQuery = {}) {
    const q = normalizeQuery(rawQuery);
    const target = PLATFORMS.find(p => p.id === q.resolvedPlatform);
    if (!target || !target.enabled) {
      throw fail('PLATFORM_NOT_ENABLED', 503, `${target ? target.name : q.resolvedPlatform} 平台未开放，当前仅接入淘宝联盟。`);
    }

    if (q.cursor) {
      const payload = decodeCursor(q.cursor, cfg.productRefKey);
      if (payload.p !== q.resolvedPlatform || payload.f !== q.feed || payload.q !== q.q ||
          payload.s !== q.sort || payload.c !== q.category || payload.l !== q.limit) {
        throw fail('INVALID_CURSOR', 400, '分页游标与当前查询条件不一致，请重新查询。');
      }
      q.cursorPayload = payload;
    }
    const pageNo = q.cursorPayload ? q.cursorPayload.n : 1;
    if (!Number.isSafeInteger(pageNo) || pageNo < 1) throw fail('INVALID_CURSOR', 400, '分页位点无效。');

    const upstreamParams = buildUpstreamParams(q, pageNo, cfg);
    const cacheKey = cacheMod.buildCacheKey({
      platform: q.resolvedPlatform,
      method: METHODS[q.feed],
      params: upstreamParams,
      pageNo,
      pageSize: q.limit
    });

    const mapped = await cache.getOrLoad(cacheKey, async () => {
      if (cfg.upstream === 'fixture') {
        const raw = fixture.buildFixtureRaw({ q: q.q, pageNo, pageSize: q.limit });
        return mapper.mapResponse(raw, { productRefKey: cfg.productRefKey, method: METHODS[q.feed] });
      }
      if (!configMod.credentialsReady(cfg)) {
        throw fail('UPSTREAM_PERMISSION_MISSING', 503,
          '服务端未配置完整的淘宝联盟凭据或接口权限，商品列表暂不可用；不会回退到示例数据。');
      }
      const raw = await callTopImpl(METHODS[q.feed], upstreamParams, cfg);
      return mapper.mapResponse(raw, { productRefKey: cfg.productRefKey, method: METHODS[q.feed] });
    });

    for (const entry of mapped.refEntries) {
      refStore.set(entry.ref, { ...entry, expiresAt: Date.now() + REF_TTL_MS });
    }

    const hasMore = mapped.totalResults > pageNo * q.limit || mapped.items.length === q.limit;
    const nextCursor = hasMore
      ? encodeCursor({
        v: 1, p: q.resolvedPlatform, f: q.feed, q: q.q, s: q.sort, c: q.category,
        l: q.limit, n: pageNo + 1, exp: Date.now() + CURSOR_TTL_MS
      }, cfg.productRefKey)
      : null;

    return {
      mode: 'live',
      dataSource: cfg.upstream === 'fixture' ? 'fixture' : 'taobao',
      platform: q.resolvedPlatform,
      feed: q.feed,
      query: q.q,
      sort: q.sort,
      pageNo,
      limit: q.limit,
      items: mapped.items,
      nextCursor,
      generatedAt: new Date().toISOString(),
      notice: cfg.upstream === 'fixture' ? fixture.NOTICE : null
    };
  }

  return { cfg, platforms, platformStatus, health, list, resolveProductRef, encodeCursor, decodeCursor };
}

module.exports = {
  PLATFORMS,
  METHODS,
  CATEGORY_QUERY,
  SORTS,
  MAX_LIMIT,
  createCatalog,
  normalizeQuery,
  encodeCursor,
  decodeCursor,
  buildUpstreamParams
};
