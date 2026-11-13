/**
 * 职责：把淘宝联盟上游字段映射为 V1.2 正式商品契约，处理金额十进制字符串、图片白名单、
 *       券资格判定、到手价口径（priceBasis）与不透明 productRef。
 * 边界：纯函数，零网络、零第三方依赖；商品列表绝不返回 click_url / coupon_share_url / purchaseActions。
 * 调用方：server/catalog.cjs、server/adapter.test.cjs。
 * 关键点：金额全程十进制字符串，禁止 parseFloat 相减；换算必须经过整数分中转。
 *         final_promotion_price 是「预估到手价」，含凑单/满减等条件时 finalPrice 必须为 null。
 *         字段映射以 G0 真实响应为准复核，这里按公开字段做宽容解析，不声称已联调通过。
 */
'use strict';

const crypto = require('node:crypto');

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
// 阿里系图片 CDN 后缀白名单；网页与小程序仍各自再做一次校验。
const IMAGE_HOST_SUFFIXES = Object.freeze([
  'alicdn.com', 'tbcdn.cn', 'taobaocdn.com', 'tbcache.com', 'taobao.com', 'tmall.com'
]);
const PLACEHOLDER_IMAGE = '/assets/logo.svg';
// 出现这些路径文案时，到手价含条件，不能当成确定券后价。
const CONDITIONAL_PATH = /凑单|需买|买\s*\d+\s*件|跨店|满减|津贴|品类券|限购|指定|部分\s*sku|叠加|vip|会员|预售|定金/i;
const FORBIDDEN_FIELDS = Object.freeze(['click_url', 'coupon_share_url', 'sourceUrl', 'purchaseActions', 'promotion']);

function cleanText(value, max = 120) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeAmountString(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return value.toFixed(2);
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return MONEY_RE.test(s) ? s : null;
}

/** Money = { amount: 十进制元字符串, currency: 'CNY' }；非法值返回 null，绝不猜测。 */
function toMoney(value) {
  const s = normalizeAmountString(value);
  return s === null ? null : { amount: s, currency: 'CNY' };
}

function moneyToFen(money) {
  const s = normalizeAmountString(typeof money === 'object' && money !== null ? money.amount : money);
  if (s === null) return null;
  const [whole, fraction = ''] = s.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

function fenToMoney(fen) {
  if (!Number.isSafeInteger(fen) || fen < 0) return null;
  return { amount: `${Math.floor(fen / 100)}.${String(fen % 100).padStart(2, '0')}`, currency: 'CNY' };
}

/** 唯一允许的金额减法：先转整数分，再中转回字符串，杜绝浮点误差。 */
function subtractMoney(minuend, subtrahend) {
  const a = moneyToFen(minuend);
  const b = moneyToFen(subtrahend);
  if (a === null || b === null || a < b) return null;
  return fenToMoney(a - b);
}

function normalizeImageUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return PLACEHOLDER_IMAGE;
  let s = raw.trim();
  if (s.startsWith('//')) s = 'https:' + s;
  else if (/^http:\/\//i.test(s)) s = 'https://' + s.slice(7);
  else if (!/^https:\/\//i.test(s)) return PLACEHOLDER_IMAGE;
  let url;
  try { url = new URL(s); } catch { return PLACEHOLDER_IMAGE; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return PLACEHOLDER_IMAGE;
  const host = url.hostname.toLowerCase();
  if (!IMAGE_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith('.' + suffix))) return PLACEHOLDER_IMAGE;
  url.hash = '';
  return url.toString();
}

function pad2(value) { return String(value).padStart(2, '0'); }

/** 上游券时间是北京时间字符串；统一输出带 +08:00 的 ISO，纯日期按当日 23:59:59 处理。 */
function toIsoBeijing(value) {
  if (value === undefined || value === null || value === '') return null;
  const m = String(value).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const iso = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}T${pad2(m[4] || '23')}:${m[5] || '59'}:${m[6] || '59'}+08:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function parseCouponInfo(info) {
  const text = cleanText(info, 80);
  if (!text) return { threshold: null, discount: null, text: '' };
  const m = text.match(/满\s*(\d+(?:\.\d{1,2})?)\s*元?\s*减\s*(\d+(?:\.\d{1,2})?)\s*元?/);
  if (m) return { threshold: toMoney(m[1]), discount: toMoney(m[2]), text };
  const only = text.match(/(\d+(?:\.\d{1,2})?)\s*元/);
  return { threshold: null, discount: only ? toMoney(only[1]) : null, text };
}

function mapCoupon(raw) {
  const keys = [
    'coupon_amount', 'coupon_info', 'coupon_start_fee', 'coupon_start_time',
    'coupon_end_time', 'coupon_remain_count', 'coupon_total_count'
  ];
  const present = keys.some(key => raw[key] !== undefined && raw[key] !== null && raw[key] !== '');
  if (!present) {
    return { availability: 'UNKNOWN', eligibility: 'UNKNOWN', discount: null, conditions: [], expiresAt: null };
  }

  const parsed = parseCouponInfo(raw.coupon_info);
  const remain = Number(raw.coupon_remain_count);
  const amountFen = moneyToFen(toMoney(raw.coupon_amount) || parsed.discount);
  const discount = toMoney(raw.coupon_amount) || parsed.discount;
  const threshold = toMoney(raw.coupon_start_fee) || parsed.threshold;
  const thresholdFen = moneyToFen(threshold);
  const expiresAt = toIsoBeijing(raw.coupon_end_time);

  let availability = 'AVAILABLE';
  if (Number.isFinite(remain) && remain <= 0) availability = 'NONE';
  else if (amountFen === null || amountFen <= 0) availability = 'NONE';
  else if (!Number.isFinite(Number(raw.coupon_amount)) && !parsed.text && !raw.coupon_start_fee) availability = 'UNKNOWN';

  const conditions = [];
  if (availability === 'AVAILABLE' && thresholdFen !== null && thresholdFen > 0) {
    conditions.push(`满${threshold.amount}元可用`);
  }
  if (availability === 'AVAILABLE' && /限|仅|指定|部分|sku/i.test(parsed.text) && conditions.length === 0) {
    conditions.push(parsed.text);
  }

  let eligibility = 'UNKNOWN';
  if (availability === 'NONE') eligibility = 'ELIGIBLE';
  else if (availability === 'UNKNOWN') eligibility = 'UNKNOWN';
  else if (conditions.length) eligibility = 'CONDITIONAL';
  else if (amountFen !== null && amountFen > 0) eligibility = 'ELIGIBLE';

  return {
    availability,
    eligibility,
    discount: availability === 'AVAILABLE' ? discount : null,
    conditions,
    expiresAt
  };
}

function pathTexts(raw) {
  const list = raw.final_promotion_path_list;
  const arr = Array.isArray(list)
    ? list
    : Array.isArray(list && list.map_data) ? list.map_data : [];
  const texts = [];
  for (const entry of arr) {
    const text = typeof entry === 'string'
      ? entry
      : cleanText(entry && (entry.desc || entry.name || entry.text || entry.title), 80);
    if (text) texts.push(text);
  }
  return texts;
}

function mapPrice(raw, coupon) {
  const currentPrice = toMoney(raw.zk_final_price) || toMoney(raw.reserve_price);
  const promo = toMoney(raw.final_promotion_price);
  const paths = pathTexts(raw);
  const conditional = paths.some(text => CONDITIONAL_PATH.test(text));

  if (!promo) {
    return {
      currentPrice,
      finalPrice: null,
      priceBasis: 'UNKNOWN',
      priceConditions: paths,
      priceNote: '上游未提供到手价，价格以平台结算页为准。'
    };
  }
  const currentFen = moneyToFen(currentPrice);
  const promoFen = moneyToFen(promo);
  if (conditional) {
    return {
      currentPrice,
      finalPrice: null,
      priceBasis: 'ESTIMATED',
      priceConditions: paths,
      priceNote: '预估到手价含凑单、满减或限购条件，需到平台结算页确认。'
    };
  }
  if (coupon.eligibility === 'CONDITIONAL' || coupon.availability === 'UNKNOWN' || coupon.eligibility === 'UNKNOWN') {
    return {
      currentPrice,
      finalPrice: null,
      priceBasis: 'ESTIMATED',
      priceConditions: paths.concat(coupon.conditions),
      priceNote: '券资格或门槛尚未确认，不能把预估到手价当作确定券后价。'
    };
  }
  if (currentFen !== null && promoFen !== null && promoFen > currentFen) {
    return {
      currentPrice,
      finalPrice: null,
      priceBasis: 'ESTIMATED',
      priceConditions: paths,
      priceNote: '上游到手价高于当前价，已按预估价处理。'
    };
  }
  return {
    currentPrice,
    finalPrice: promo,
    priceBasis: 'CONFIRMED',
    priceConditions: [],
    priceNote: ''
  };
}

/**
 * 不透明商品引用：HMAC-SHA256(itemId) 生成，不暴露上游 item_id，也无法被客户端伪造。
 * 真实 ID 只在服务端短生命周期 refStore 中关联，供后续 /api/v1/conversions 使用。
 */
function productRef(itemId, productRefKey) {
  const sig = crypto.createHmac('sha256', String(productRefKey))
    .update('tbk:' + String(itemId), 'utf8').digest('base64url').slice(0, 22);
  return 'tbk.' + sig;
}

function verifyProductRef(ref, itemId, productRefKey) {
  return typeof ref === 'string' && ref === productRef(itemId, productRefKey);
}

function mapItem(raw, ctx) {
  if (!raw || typeof raw !== 'object') return null;
  const itemId = String(raw.item_id === undefined ? '' : raw.item_id).trim();
  if (!itemId) return null; // 新商品 ID 可能是加密字符串，不做 Number 转换
  const title = cleanText(raw.short_title || raw.title, 120);
  if (!title) return null;
  const coupon = mapCoupon(raw);
  const price = mapPrice(raw, coupon);
  const ref = productRef(itemId, ctx.productRefKey);
  const item = {
    platform: 'taobao',
    productRef: ref,
    title,
    imageUrl: normalizeImageUrl(raw.pict_url || raw.white_image || raw.small_image_url),
    currentPrice: price.currentPrice,
    finalPrice: price.finalPrice,
    priceBasis: price.priceBasis,
    priceConditions: price.priceConditions,
    priceNote: price.priceNote,
    coupon,
    category: cleanText(raw.level_one_category_name, 20) || null,
    store: cleanText(raw.shop_title || raw.seller_nick, 40) || null
  };
  // 防御：映射层永远不把推广/购买入口下发到商品列表。
  for (const field of FORBIDDEN_FIELDS) delete item[field];
  return { item, refEntry: { ref, platform: 'taobao', itemId } };
}

function pickNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

/** 宽容解析上游容器：兼容 xxx_response.result_list.map_data 与简化 result_list.map_data。 */
function extractMapData(raw) {
  if (!raw || typeof raw !== 'object') return { list: [], totalResults: 0 };
  const candidates = [];
  for (const key of Object.keys(raw)) {
    if (/_response$/i.test(key) && raw[key] && typeof raw[key] === 'object') candidates.push(raw[key]);
  }
  candidates.push(raw, raw.data, raw.result);
  for (const node of candidates) {
    if (!node || typeof node !== 'object') continue;
    const rl = node.result_list;
    const list = Array.isArray(rl && rl.map_data) ? rl.map_data
      : Array.isArray(node.map_data) ? node.map_data
        : Array.isArray(node.data) ? node.data : null;
    if (list) {
      return {
        list,
        totalResults: pickNumber((rl && rl.total_results) ?? node.total_results, list.length)
      };
    }
  }
  return { list: [], totalResults: 0 };
}

function mapResponse(raw, ctx) {
  const { list, totalResults } = extractMapData(raw);
  const items = [];
  const refEntries = [];
  for (const entry of list) {
    const mapped = mapItem(entry, ctx);
    if (mapped) { items.push(mapped.item); refEntries.push(mapped.refEntry); }
  }
  return { items, refEntries, totalResults };
}

module.exports = {
  MONEY_RE,
  IMAGE_HOST_SUFFIXES,
  PLACEHOLDER_IMAGE,
  CONDITIONAL_PATH,
  cleanText,
  normalizeAmountString,
  toMoney,
  moneyToFen,
  fenToMoney,
  subtractMoney,
  normalizeImageUrl,
  toIsoBeijing,
  mapCoupon,
  mapPrice,
  productRef,
  verifyProductRef,
  mapItem,
  mapResponse,
  extractMapData
};
