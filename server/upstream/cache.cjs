/**
 * 职责：进程内短缓存，TTL 默认 45 秒（V1.2 建议 30–120 秒），同键单飞去重，失败不缓存。
 * 边界：仅服务端；只缓存成功的商品列表，绝不缓存错误信息，也不作为上游失败时的兜底数据源。
 * 调用方：server/catalog.cjs、server/adapter.test.cjs。
 * 关键点：缓存键含「方法 + 规范化参数 + 平台 + 页面」，避免不同查询条件串页。
 */
'use strict';

function canonical(params = {}) {
  return Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}

function buildCacheKey({ platform, method, params = {}, pageNo = 1, pageSize = 20 }) {
  return [platform, method, String(pageNo), String(pageSize), canonical(params)].join('|');
}

function createCache({ ttlMs = 45_000, now = () => Date.now() } = {}) {
  const store = new Map();
  const inFlight = new Map();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) { store.delete(key); return undefined; }
      return entry.value;
    },
    set(key, value) {
      if (value === undefined) return;
      store.set(key, { value, expiresAt: now() + ttlMs });
    },
    /** 同键并发只发起一次 loader；loader 抛错时不写入缓存，并在 finally 清理在途记录。 */
    async getOrLoad(key, loader) {
      const hit = this.get(key);
      if (hit !== undefined) return hit;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const task = (async () => {
        const value = await loader();
        this.set(key, value);
        return value;
      })();
      inFlight.set(key, task);
      try {
        return await task;
      } finally {
        if (inFlight.get(key) === task) inFlight.delete(key);
      }
    },
    get size() { return store.size; },
    get pending() { return inFlight.size; },
    clear() { store.clear(); inFlight.clear(); }
  };
}

module.exports = { canonical, buildCacheKey, createCache };
