/**
 * 职责：为离线测试 / CI 提供「TOP 响应形状」的合成数据，让 smoke 与契约测试不触网、不注入密钥。
 * 边界：这是测试夹具，不是真实联盟响应，也不是生产数据源，更不是上游失败时的兜底样例。
 *       只有显式设置 QUANSHENG_UPSTREAM=fixture（或 createServer({upstreamMode:'fixture'})）才会启用；
 *       响应带 dataSource:'fixture' 与 notice，界面和 /api/health 全程可辨认。
 * 调用方：server/catalog.cjs、scripts/smoke.cjs。
 * 关键点：G0 真实调用成功后应把脱敏响应另存为 docs/fixtures/taobao-material-sample.json，
 *         那份才是字段映射依据；本文件只能用于验证映射代码，不能证明上游已联调通过。
 */
'use strict';

const NOTICE = '离线合成测试数据（fixture），不是真实联盟商品；请配置凭据后以 QUANSHENG_UPSTREAM=live 重新验收。';

const SYNTHETIC_ITEMS = [
  {
    item_id: 'SYN-TB-1001', title: '轻量随行保温杯 500mL', short_title: '保温杯 500mL',
    pict_url: 'https://img.alicdn.com/imgextra/i1/synthetic/1001.jpg',
    zk_final_price: '79.00', reserve_price: '99.00', final_promotion_price: '69.00',
    final_promotion_path_list: [{ desc: '商品优惠券' }],
    coupon_amount: '10', coupon_start_fee: '0', coupon_start_time: '2026-11-01',
    coupon_end_time: '2026-12-31', coupon_remain_count: 120,
    level_one_category_name: '家居', shop_title: '合成测试店铺甲'
  },
  {
    item_id: 'SYN-TB-1002', title: '无线降噪头戴耳机', short_title: '降噪耳机',
    pict_url: 'https://img.alicdn.com/imgextra/i2/synthetic/1002.jpg',
    zk_final_price: '129.00', reserve_price: '159.00', final_promotion_price: '99.00',
    final_promotion_path_list: [{ desc: '凑单满减' }, { desc: '需买2件' }],
    coupon_amount: '30', coupon_start_fee: '99', coupon_start_time: '2026-11-01',
    coupon_end_time: '2026-12-01', coupon_remain_count: 50,
    level_one_category_name: '数码', shop_title: '合成测试店铺乙'
  },
  {
    item_id: 'SYN-TB-1003', title: '原生木浆抽纸 12 包装', short_title: '抽纸囤货装',
    pict_url: '//gw.alicdn.com/imgextra/i3/synthetic/1003.jpg',
    zk_final_price: '29.90', reserve_price: '39.90', final_promotion_price: '29.90',
    final_promotion_path_list: [],
    level_one_category_name: '日用', shop_title: '合成测试店铺丙'
  },
  {
    item_id: 'SYN-TB-1004', title: '简约帆布托特包', short_title: '帆布托特包',
    pict_url: 'https://not-an-alibaba-host.example/steal.jpg',
    zk_final_price: '39.90', reserve_price: '49.90', final_promotion_price: '39.90',
    final_promotion_path_list: [{ desc: '无券' }],
    coupon_amount: '0', coupon_start_fee: '0', coupon_remain_count: 0,
    level_one_category_name: '服饰', shop_title: '合成测试店铺丁'
  },
  {
    item_id: 'SYN-TB-1005', title: '陶瓷早餐马克杯 350mL', short_title: '早餐马克杯',
    pict_url: 'https://img.alicdn.com/imgextra/i4/synthetic/1005.jpg',
    zk_final_price: '29.90', reserve_price: '39.90',
    final_promotion_path_list: [],
    coupon_info: '满99元减10元', coupon_start_fee: '99',
    coupon_end_time: '2026-12-15', coupon_remain_count: 20,
    level_one_category_name: '家居', shop_title: '合成测试店铺戊'
  },
  {
    item_id: 'SYN-TB-1006', title: '便携快速充电器 30W', short_title: '快速充电器',
    pict_url: 'https://img.alicdn.com/imgextra/i1/synthetic/1006.jpg',
    zk_final_price: '69.00', reserve_price: '89.00', final_promotion_price: '59.00',
    final_promotion_path_list: [{ desc: '商品优惠券' }],
    coupon_amount: '10', coupon_start_fee: '0',
    coupon_end_time: '2026-12-20', coupon_remain_count: 200,
    level_one_category_name: '数码', shop_title: '合成测试店铺己'
  },
  {
    item_id: 'SYN-TB-1007', title: '原味即食燕麦 500g', short_title: '即食燕麦',
    pict_url: 'https://img.alicdn.com/imgextra/i2/synthetic/1007.jpg',
    zk_final_price: '19.90', reserve_price: '25.90', final_promotion_price: '17.90',
    final_promotion_path_list: [{ desc: '商品优惠券' }],
    coupon_amount: '2', coupon_start_fee: '0',
    coupon_end_time: '2026-11-30', coupon_remain_count: 88,
    level_one_category_name: '食品', shop_title: '合成测试店铺庚'
  }
];

function buildFixtureRaw({ q = '', category = '', pageNo = 1, pageSize = 20 } = {}) {
  const needle = String(q || '').trim();
  const cat = String(category || '').trim();
  const filtered = SYNTHETIC_ITEMS.filter(item => {
    const haystack = `${item.title} ${item.short_title || ''} ${item.level_one_category_name || ''}`;
    if (needle && !haystack.includes(needle)) return false;
    if (cat && !haystack.includes(cat)) return false;
    return true;
  });
  const start = (pageNo - 1) * pageSize;
  const map_data = filtered.slice(start, start + pageSize);
  return {
    _synthetic: true,
    tbk_dg_material_optional_upgrade_response: {
      _synthetic: true,
      result_list: { map_data, total_results: filtered.length }
    }
  };
}

module.exports = { NOTICE, SYNTHETIC_ITEMS, buildFixtureRaw };
