-- 设计草案，未由演示服务执行。使用 SQLite 兼容语法。
-- 订单同步必须只在服务端和管理端执行，不作为公开客户端 API。
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS conversions (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK(platform IN ('taobao','pdd','jd')),
  product_id TEXT,
  media_slot TEXT NOT NULL,
  tracking_ref TEXT,
  attribution_scope TEXT NOT NULL CHECK(attribution_scope IN ('platform','channel','user')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS affiliate_orders (
  platform TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_line_id TEXT NOT NULL DEFAULT '',
  tracking_ref TEXT,
  currency TEXT NOT NULL DEFAULT 'CNY',
  commission_rate_raw TEXT,
  expected_commission_fen INTEGER,
  settled_commission_fen INTEGER,
  normalized_status TEXT NOT NULL CHECK(normalized_status IN ('pending','paid','received','settled','invalid','refunded','unknown')),
  raw_status TEXT NOT NULL,
  platform_updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(platform,order_id,order_line_id)
);
CREATE INDEX IF NOT EXISTS affiliate_orders_tracking ON affiliate_orders(platform,tracking_ref);
CREATE TABLE IF NOT EXISTS sync_checkpoints (
  platform TEXT NOT NULL,
  stream TEXT NOT NULL,
  cursor_json TEXT,
  last_success_at TEXT,
  PRIMARY KEY(platform,stream)
);
