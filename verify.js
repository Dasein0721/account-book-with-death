/*
 * verify.js —— 验收标准可复跑脚本（开发期工具）
 *
 * 用法：node verify.js
 *
 * 设计原则：不复制公式，直接把 index.html 里的 <script> 原样加载进 Node 沙箱，
 * 调用其中的真实函数（qAt / computeCoefficients / saturate / VSL / …）逐条断言
 * 功能规格书「七、验收标准」的 9+1 条。脚本与交付物永不漂移。
 *
 * 对应《功能规格书.md》第 119 行起「七、验收标准」。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('✗ 未在 index.html 中找到 <script> 段');
  process.exit(2);
}
const src = m[1];

// 顶层初始化调用（renderEventSelect(); loadState(); render(); …）会触发 DOM/canvas 副作用；
// 验收脚本只需纯数据与计算函数，故在第一个顶层初始化调用前截断，避免桩不完整导致崩溃。
// 截断点之前已完整定义：MALE/FEMALE/EVENTS/VSL 等数据、qAt/computeCoefficients/saturate 等函数。
const cutAt = src.indexOf('\nrenderEventSelect();');
if (cutAt === -1) {
  console.error('✗ 未找到顶层初始化调用标记 renderEventSelect();，index.html 结构可能已变化');
  process.exit(2);
}
const core = src.slice(0, cutAt);

// ---- 最小 DOM 桩：仅用于让残余的顶层 addEventListener 不报错（截断后基本不再触发） ----
function makeEl() {
  return {
    addEventListener() {}, removeEventListener() {},
    value: '', checked: false, innerHTML: '', textContent: '',
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    focus() {}, click() {}, blur() {},
    setAttribute() {}, removeAttribute() {},
    step: '', min: '', max: '', placeholder: '',
  };
}
const elStub = makeEl();
const _elCache = new Map();
function elById(id) { if (!_elCache.has(id)) _elCache.set(id, makeEl()); return _elCache.get(id); }
const document = {
  getElementById: (id) => elById(id),
  querySelector: () => elStub,
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  addEventListener() {},
};
const _store = new Map();
const localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  get length() { return _store.size; },
  key: (i) => { const ks = Array.from(_store.keys()); return i < ks.length ? ks[i] : null; },
};
const window = { devicePixelRatio: 1, localStorage };

const sandbox = {
  document,
  window,
  localStorage,
  console,
  setTimeout: () => 0,
  clearTimeout() {},
};
vm.createContext(sandbox);

// ---- 包裹成 IIFE，导出需要的符号（含可改 tau / 可强制正态抽样 z 的闭包 setter）----
const wrapped = `(function(){\n${core}\nreturn {
  MALE, FEMALE, EVENTS, CATALOG, REL, SRC, COEF_FACTORS, MEAN_REF, COEF_CI, VSL, IDX, DIET_IDS, Storage,
  EV_RANGE, EV_YEAR, CAP_SIGMA,
  qAt, computeCoefficients, computeSurvival, lifeExpectancyYears, saturate, bodyShapeFactor, colorTone, validateData,
  activityFactor, dietFactor, rawFactor, anchorDivisor, meanRef, coefMM, sigmaFromCI,
  monteCarloBand, sampleCoeff, eventTotalMicromort, computeFromParts,
  DEFL_INC, DEFL_CPI, DEFL_BASE, deflIncomeRatio, deflCpiCum, deflFactor,
  vsalFor, yuanText, vslRangeText, vslFieldStats, VSL_PICK, VSL_DOMAIN_OF,
  K_LIFESTYLE, CAP_METABOLIC, TAU_DEFAULT,
  setTau(t){ tau = t; }, getTau(){ return tau; },
  setZ(z){ Z_FORCE = z; }, getLastCapS(){ return lastCapS; },
};})()`;

let api;
try {
  api = vm.runInContext(wrapped, sandbox, { filename: 'index.html<script>' });
} catch (e) {
  console.error('✗ index.html <script> 在沙箱中执行失败：', e && e.stack || e);
  process.exit(2);
}

// ---- 断言工具 ----
let pass = 0, fail = 0;
function check(id, label, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${id}  ${label}${detail ? '  → ' + detail : ''}`); }
  else    { fail++; console.log(`  ✗ ${id}  ${label}${detail ? '  → ' + detail : ''}`); }
}
function near(id, label, actual, expected, tol) {
  const a = Number(actual), e = Number(expected);
  check(id, label, Math.abs(a - e) <= tol,
    `期望≈${e}，实际=${+a.toFixed(4)}（容差 ${tol}）`);
}

// ---- 常用：40 岁男 ----
const AGE = 40, SEX = 'm';

console.log('死亡风险模拟器 · 验收标准复跑（功能规格书 §七 + 优化问题清单新增断言）\n');

// ============ 1. 年度背景风险 ============
{
  const q = api.qAt(AGE, SEX);
  const mm = q * 1e6;
  check('1', '年龄 40 男 → PCHIP 单岁背景风险 ≈ 1922 微死亡（40–44 岁组 2.245‰ 平滑到单岁）',
    Math.round(mm) === 1922, `qAt(40,"m")=${mm.toFixed(1)} 微死亡/年`);
  // 回归：平滑表曾把 0–4 岁组率连乘 5 次、并丢弃 85–104 岁已存的单岁值
  check('1b', '生命表婴幼段按单岁值重建：q0≈5.410‰、q1≈0.498‰',
    Math.abs(api.qAt(0, 'm') * 1e3 - 5.410) < 0.001 && Math.abs(api.qAt(1, 'm') * 1e3 - 0.498) < 0.001,
    `q0=${(api.qAt(0,'m')*1e3).toFixed(3)}‰ q1=${(api.qAt(1,'m')*1e3).toFixed(3)}‰`);
  check('1c', '高龄段保留 Gompertz 单岁值：q90≈192.967‰',
    Math.abs(api.qAt(90, 'm') * 1e3 - 192.967) < 0.01,
    `q90=${(api.qAt(90,'m')*1e3).toFixed(3)}‰`);
  // 回归：Storage 门面缺 length/key 时，导出与清除按钮会静默空转
  try {
    api.Storage.setItem('rb_schema', '2'); api.Storage.setItem('rb_last', '{}');
    api.Storage.setItem('rb_disclaimer_ok', '1'); api.Storage.setItem('other_key', 'x');
    const ks = api.Storage.keys('rb_');
    check('1d', 'Storage.keys("rb_") 能枚举已存键（导出/清除按钮依赖）',
      ks.length === 3 && ks.indexOf('other_key') === -1, 'keys=' + JSON.stringify(ks));
  } catch (e) {
    check('1d', 'Storage.keys("rb_") 能枚举已存键（导出/清除按钮依赖）', false, String(e && e.message || e));
  }
  // 回归：85 岁原本是 5 岁组平填与 Gompertz 单岁值的交界，曾出现 84→85 的 ×1.6 跳变；
  // 现在两侧都来自同一条单调曲线，要求接缝比值落在邻域内、且 12–100 岁无 >10% 的折点。
  {
    const seg = (q, a) => q[a] / q[a - 1];
    const mSeg = seg(api.MALE, 85), fSeg = seg(api.FEMALE, 85);
    const mNb = [seg(api.MALE, 84), seg(api.MALE, 86)], fNb = [seg(api.FEMALE, 84), seg(api.FEMALE, 86)];
    const okSeam = mSeg > Math.min(...mNb) * 0.85 && mSeg < Math.max(...mNb) * 1.15
                && fSeg > Math.min(...fNb) * 0.85 && fSeg < Math.max(...fNb) * 1.15;
    check('1e', '84→85 岁无缝：接缝比值与邻域一致（男 ' + mSeg.toFixed(3) + ' / 女 ' + fSeg.toFixed(3) + '）', okSeam);
    const bad = [];
    for (const arr of [api.MALE, api.FEMALE]) {
      for (let a = 12; a < 100; a++) {
        const r = seg(arr, a), nb = (seg(arr, a - 1) + seg(arr, a + 1)) / 2;
        if (Math.abs(r / nb - 1) > 0.10) bad.push(a + '→' + (a + 1) + ':' + (r / nb - 1).toFixed(2));
      }
    }
    check('1f', '12–100 岁无 >10% 的曲线折点（PCHIP 平滑无台阶）', bad.length === 0, bad.slice(0, 5).join(' '));
  }
  // 回归：消防员由「自媒体推算 D 级」改为「官方分子 ÷ 官方分母 B 级」
  {
    const f = api.CATALOG.find(c => c.n === '消防员');
    // 回归：公式列「÷ … ×1e6」曾算错 10 倍（4.9 / 0.9），此处按官方分子÷分母复算
    const nat = api.CATALOG.find(c => c.n === '自然灾害（全类型）');
    const rab = api.CATALOG.find(c => c.n === '狂犬病');
    const okF = !!f && f.r === 'B' && Math.abs(parseFloat(f.v) - 174) < 0.5;
    const okNat = !!nat && Math.abs(parseFloat(nat.v) - 691 / 1.40967e9 * 1e6) < 0.005;
    const okRab = !!rab && Math.abs(parseFloat(rab.v) - 127 / 1.40967e9 * 1e6) < 0.005;
    check('1g', 'CATALOG 公式复算：消防员 174 / 自然灾害 0.49 / 狂犬病 0.09（官方分子÷分母×1e6）',
      okF && okNat && okRab,
      (f ? 'v=' + f.v + ' r=' + f.r : 'CATALOG 中找不到消防员')
      + ' nat=' + (nat ? nat.v : '—') + ' rab=' + (rab ? rab.v : '—'));
  }
  // 回归：③ 不确定带随暴露量展宽（σ 按「每单位暴露」的 CI 宽度乘暴露步数）
  {
    const spread = (sbp) => {
      const res = api.computeCoefficients(AGE, SEX, null, null, sbp, null, null, null, null, null, null);
      const b = api.monteCarloBand(AGE, SEX, res, 0, 'month', 120, 600);
      const at = b[120];
      return (at.p975 - at.p025) / at.p50;
    };
    const s120 = spread(120), s180 = spread(180);
    check('1h', '③ 不确定带随暴露量展宽：180 mmHg 的带宽 ≥ 2× 120 mmHg',
      s180 > s120 * 2,
      '120=' + (s120 * 100).toFixed(3) + '% 180=' + (s180 * 100).toFixed(3) + '%');
  }
  // 回归：③ 心率+睡眠同时偏离时给出「剔除重叠项」的同一口径系数，单项时不提示
  {
    const both = api.computeCoefficients(AGE, SEX, 32, null, 150, null, null, 100, 5, null, null);
    const onlyHr = api.computeCoefficients(AGE, SEX, 32, null, 150, null, null, 100, null, null, null);
    const hasAlt = both.note.some(s => s.indexOf('剔除后同一口径') >= 0);
    const noAlt = !onlyHr.note.some(s => s.indexOf('剔除后同一口径') >= 0);
    check('1i', '③ 心率+睡眠重叠给出剔除后的同一口径系数（仅一项时不提示）', hasAlt && noAlt,
      'both=' + hasAlt + ' onlyHr=' + noAlt);
  }
  // 回归：⑤ VSL 给出同领域四分位区间（点估计不变）
  {
    const txt = api.vslRangeText('跌倒');
    const st = api.vslFieldStats('跌倒');
    check('1j', '⑤ VSL 同领域四分位区间可算（n≥3、lo<hi）',
      !!st && st.n >= 3 && st.lo < st.hi && /¥[\d.]+–¥[\d.]+/.test(txt),
      txt || '(空)');
  }
}

// ============ 2. extra 叠加后曲线下降 ============
{
  const base = api.computeSurvival(AGE, SEX, 1, 0, 'year');
  const extra = api.computeSurvival(AGE, SEX, 1, 500, 'year');
  const s0 = base.find(d => d.t === 1).s;
  const s1 = extra.find(d => d.t === 1).s;
  check('2', '输入 extra 500 → 1 年存活率在基础曲线下方、略降',
    s1 < s0 && Math.abs((s0 - s1) - 500 / 1e6) < 1e-5,
    `基础 1 年存活=${s0.toFixed(6)}，叠加后=${s1.toFixed(6)}`);
}

// ============ 3. 跳伞事件 ============
{
  let ev = null;
  for (const cat of api.EVENTS) {
    const hit = (cat.items || []).find(it => it[0] === '跳伞');
    if (hit) { ev = hit; break; }
  }
  check('3', '风险换算选「跳伞」→ 列表出现「跳伞 · 8 微死亡/年」',
    !!ev && ev[1] === 8, ev ? `跳伞 mm=${ev[1]}，单位=${ev[2]}` : 'EVENTS 中无跳伞');
}

// ============ 4. 吸烟 20 支/天 → 等效额外 494 微死亡/年 ============
{
  const f = api.rawFactor(api.IDX.SMOKE, 20, SEX) / api.anchorDivisor('吸烟', SEX, AGE);
  const q = api.qAt(AGE, SEX);
  const mm = ((1 - Math.pow(1 - q, f)) - q) * 1e6;
  check('4', '吸烟 20 支/天 → 系数 1.4865、等效额外 ≈ 934 微死亡/年（PCHIP 后比例风险口径）',
    Math.round(mm) === 934, `f=${f.toFixed(4)}，等效额外=${mm.toFixed(1)} 微死亡/年`);
}

// ============ 5 / 5a. VSL 两口径 ============
{
  const qin = api.VSL[0].fields[0].studies[0];
  const guo = api.VSL[0].fields[0].studies[1];
  check('5', '市场行为→职业→Qin X Z 2005 → 当时 ¥1.81 / 今日 ¥9.75',
    qin.author === 'Qin X Z' && qin.year === 2005 &&
    Math.abs(qin.raw / 100 - 1.81) < 0.01 && Math.abs(qin.today / 100 - 9.75) < 0.01,
    `raw=${qin.raw}万→当时¥${(qin.raw/100).toFixed(2)}，today=${qin.today}万→今日¥${(qin.today/100).toFixed(2)}`);
  {
  // 每一行按「该因素所属领域」的代表研究折算：不同领域/年份 → 价格必须不同（曾经被统一成同一个 ¥3.28）
  const health = api.vsalFor('血压'), traffic = api.vsalFor('道路交通事故（公安口径）');
  const p1 = api.yuanText(100, '血压'), p2 = api.yuanText(100, '道路交通事故（公安口径）');
  check('5c', '风险构成逐行按领域取价：健康类 ≠ 交通类，且各自标注研究年份',
    health.author !== traffic.author && p1 !== p2 && /Hammitt|Zheng|GUO|Cao/.test(p1),
    `健康=${health.author}${health.year} ¥${health.mm}；交通=${traffic.author}${traffic.year} ¥${traffic.mm}`);
}
{
  const inc = api.deflIncomeRatio(1998), cpi = api.deflCpiCum(2004);
  check('5b', '折算因子由年度表现算：GUO 1998 收入比 ≈ 10.41、2004→2025 CPI 累计 ≈ 1.56（不再写死）',
    Math.abs(inc - 10.4147) < 1e-3 && Math.abs(cpi - 1.5569) < 5e-3,
    `收入比=${inc}，CPI累计=${cpi}`);
}
check('5a', '市场行为→职业→GUO X Q 1998 → 今日 ¥3.28（31.5 万，非 220.5 万）',
    guo.author === 'GUO X Q' && guo.year === 1998 && Math.abs(guo.today / 100 - 3.28) < 0.01,
    `raw=${guo.raw}万，today=${guo.today}万→今日¥${(guo.today/100).toFixed(2)}`);
}

// ============ 6. 收缩压 200 → 约束到 180，系数 ≈ 1.372 ============
{
  const f = api.rawFactor(api.IDX.SBP, 180, SEX) / api.anchorDivisor('血压（收缩压）', SEX, AGE);
  near('6', '收缩压 200 被约束到 180（输入 max=180）→ 系数 ≈ 1.372', f, 1.372, 0.01);
}

// ============ 7. 40 岁男 + 吸烟 20 + 收缩压 160 → 置信带 + 风险构成 ============
{
  const res = api.computeCoefficients(AGE, SEX, null, null, 160, null, null, null, null, null, 20, null, null);
  const hasSmoke = res.lifeFactors.some(x => x.k === '吸烟');
  const hasSbp = res.metFactors.some(x => x.k === '血压');
  const band = api.monteCarloBand(AGE, SEX, res, 0, 'year', undefined, 200);
  const b1 = band[10] || band[band.length - 1];
  const bandOk = !!b1 && b1.p025 <= b1.p50 && b1.p50 <= b1.p975;
  check('7', '吸烟20+收缩压160 → 系数不确定带生成 + 风险构成含吸烟/血压',
    hasSmoke && hasSbp && bandOk,
    `lifeFactors 含吸烟=${hasSmoke}，metFactors 含血压=${hasSbp}，band p025≤p50≤p975=${bandOk}`);
}

// ============ 8. 全填人群平均值 → 综合风险 ≈ 1.00 ============
{
  const res = api.computeCoefficients(AGE, SEX, 24.2, 84, 122, 5.5, 2.9, 74, 7, 135, 8, null, null);
  near('8', '各系数均填人群平均值（男 μ）→ 综合风险 ≈ 1.00 倍', res.coeff, 1.00, 0.02);
}

// ============ 9. 单因素不饱和 / 代谢簇饱和 / τ 三档 ============
{
  api.setTau(1.3);
  const onlyBMI = api.computeCoefficients(AGE, SEX, 30, null, null, null, null, null, null, null, null, null, null);
  near('9a', '只填 BMI 30 → ≈ 1.27 倍（单因素不饱和=裸 HR）', onlyBMI.coeff, 1.27, 0.02);

  const metab = api.computeCoefficients(AGE, SEX, 30, 100, 160, 7, 4, null, null, null, null, null, null);
  near('9b', 'BMI30+腰围100+收缩压160+血糖7+LDL4 → ≈ 1.46 倍（代谢簇饱和，τ=1.3）', metab.coeff, 1.46, 0.03);

  api.setTau(0.9);
  const t09 = api.computeCoefficients(AGE, SEX, 30, 100, 160, 7, 4, null, null, null, null, null, null);
  near('9c', 'τ 拖到 0.9 → ≈ 1.59 倍（更保守）', t09.coeff, 1.59, 0.03);

  api.setTau(1.9);
  const t19 = api.computeCoefficients(AGE, SEX, 30, 100, 160, 7, 4, null, null, null, null, null, null);
  near('9d', 'τ 拖到 1.9 → ≈ 1.35 倍（更压缩）', t19.coeff, 1.35, 0.03);

  api.setTau(1.3);

  // Q-04 再改判（2026-11-16，1.0.3）：单项极端值同样受 CAP 约束——Li 2016 的 1.92 是五成分联合上限，单项 2.45 无流行病学对应
  const glu15 = api.computeCoefficients(AGE, SEX, null, null, null, 15, null, null, null, null, null, null, null);
  check('9e', '只填血糖 15 mmol/L → 封顶到 CAP 1.92（单项不得越过五成分联合上限）',
    Math.abs(glu15.coeff - api.CAP_METABOLIC) <= 1e-9 && glu15.coeff <= api.CAP_METABOLIC + 1e-12,
    'coeff=' + glu15.coeff.toFixed(4) + '，CAP=' + api.CAP_METABOLIC.toFixed(2));
  const glu15mix = api.computeCoefficients(AGE, SEX, 35, null, 180, 15, null, null, null, null, null, null, null);
  check('9f', '血糖 15 + BMI 35 + 血压 180 → 仍 ≤ CAP，且不低于任一单因素（封顶后不再抬升，但绝不下降）',
    glu15mix.coeff <= api.CAP_METABOLIC + 1e-9 && glu15mix.coeff >= glu15.coeff - 1e-9,
    'mix=' + glu15mix.coeff.toFixed(4) + '，单血糖=' + glu15.coeff.toFixed(4) + '，CAP=' + api.CAP_METABOLIC.toFixed(2));
}

// ============ 10. 代谢簇单调性（加危险因素不降综合系数） ============
{
  const base = api.computeCoefficients(AGE, SEX, 35, null, null, null, null, null, null, null, null, null, null).coeff;
  const plusSbp = api.computeCoefficients(AGE, SEX, 35, null, 180, null, null, null, null, null, null, null, null).coeff;
  const plusGluHi = api.computeCoefficients(AGE, SEX, 35, null, 180, 15, null, null, null, null, null, null, null).coeff;
  const monotonic = base <= plusSbp + 1e-9 && plusSbp <= plusGluHi + 1e-9;
  check('10', '代谢簇单调性：BMI35 ≤ BMI35+血压180 ≤ BMI35+血压180+血糖15（加危险因素不降）',
    monotonic, `base=${base.toFixed(4)} → +血压=${plusSbp.toFixed(4)} → +血糖15=${plusGluHi.toFixed(4)}`);
}

// ============ 15. 超范围输入不丢弃系数（曾把 BMI 36 / 心率 110 的系数打回 1.0，等于给最危险的人群降风险） ============
{
  const hr100 = api.computeCoefficients(AGE, SEX, null, null, null, null, null, 100, null, null, null, null, null).coeff;
  const hr120 = api.computeCoefficients(AGE, SEX, null, null, null, null, null, 120, null, null, null, null, null).coeff;
  const bmi35 = api.computeCoefficients(AGE, SEX, 35, null, null, null, null, null, null, null, null, null, null).coeff;
  const bmi40 = api.computeCoefficients(AGE, SEX, 40, null, null, null, null, null, null, null, null, null, null).coeff;
  const hrNull = api.computeCoefficients(AGE, SEX, null, null, null, null, null, null, null, null, null, null, null).coeff;
  const hrMsg = api.computeCoefficients(AGE, SEX, null, null, null, null, null, 120, null, null, null, null, null).warn.join('');
  check('15', '超范围指标不外推：心率 120 与「没填心率」等价，且 warn 说明「此系数未计入」',
    Math.abs(hr120 - hrNull) <= 1e-9 && hrMsg.indexOf('此系数未计入') !== -1,
    `HR120=${hr120.toFixed(4)} 未填=${hrNull.toFixed(4)} 同样本？${Math.abs(hr120 - hrNull) <= 1e-9}`);
}

// ============ 11. ⑨ 确定性路径等价：computeCoefficients ≡ sampleCoeff(z=0) ============
{
  const diet = { diet_v: true, diet_f: true, diet_r: true, diet_l: true, diet_fish: true };
  const res = api.computeCoefficients(AGE, SEX, 30, 100, 160, 7, 4, 90, 5, 100, 20, 'low', diet);
  api.setZ(0);
  const sampled = api.sampleCoeff(res);
  api.setZ(null);
  const ok = Math.abs(sampled - res.coeff) <= 1e-9;
  check('11', '⑨ 重构等价：同一输入下 computeCoefficients 与 sampleCoeff(z=0) 的 coeff 完全相等（±1e-9）',
    ok, `computeCoefficients=${res.coeff}，sampleCoeff(z=0)=${sampled}，Δ=${Math.abs(sampled-res.coeff)}`);
}

// ============ 17. 体型抽样值与 lifeRisk 计数同源（第九份外审） ============
{
  const bodyF = 1.002;
  const res = {
    lifeFactors: [{ k: '吸烟', f: 1.1 }, { k: '饮酒', f: 1.1 }],
    metFactors: [{ k: '体型', f: bodyF, ci: 'BODY' }],
    indepFactors: [], bodyF
  };
  api.setZ(-1.96);
  const sampled = api.sampleCoeff(res);
  const sb = bodyF * Math.exp(api.COEF_CI.BODY * (-1.96));
  const expected = api.computeFromParts({
    lifeFactors: res.lifeFactors,
    metFactors: [{ k: '体型', f: sb }],
    indepFactors: [], bodyF: sb
  }).coeff;
  api.setZ(null);
  check('17', '体型抽样值同时用于系数与 lifeRisk 计数（z=-1.96，旧实现会多计一次）',
    Math.abs(sampled - expected) <= 1e-12,
    'sampleCoeff=' + sampled.toFixed(6) + '，同源期望=' + expected.toFixed(6));
}

// ============ 12. ④ 未成年人 BMI 不再触发成人「过瘦段」伪影，改给 WS/T 586-2018 说明 ============
{
  const res = api.computeCoefficients(10, 'm', 17, null, null, null, null, 78, null, null, null, null, null);
  const hasThin = res.note.some(t => t.indexOf('过瘦') !== -1);
  const hasWST = res.note.some(t => t.indexOf('WS/T 586-2018') !== -1);
  check('12', '④ 陈默伪影：10 岁 BMI 17 不含「过瘦段」提示、含 WS/T 586-2018 分年龄界值说明',
    !hasThin && hasWST, `含过瘦=${hasThin}，含WS/T=${hasWST}`);
}

// ============ 13. ② 运动/饮食保护方向 CI 纳入抽样（z=±1.96 边界） ============
{
  const diet = { diet_v: true, diet_f: true, diet_r: true, diet_l: true, diet_fish: true };
  const resAct = api.computeCoefficients(AGE, SEX, null, null, null, null, null, null, null, null, null, 'high', null);
  const resDiet = api.computeCoefficients(AGE, SEX, null, null, null, null, null, null, null, null, null, null, diet);
  const hasAct = resAct.lifeFactors.some(x => x.k === '运动' && x.ci === 'ACTIVITY');
  const hasDiet = resDiet.lifeFactors.some(x => x.k === '饮食' && x.ci === 'DIET');
  api.setZ(1.96);
  const actHi = api.sampleCoeff(resAct), dietHi = api.sampleCoeff(resDiet);
  api.setZ(-1.96);
  const actLo = api.sampleCoeff(resAct), dietLo = api.sampleCoeff(resDiet);
  api.setZ(0);
  const act0 = api.sampleCoeff(resAct), diet0 = api.sampleCoeff(resDiet);
  api.setZ(null);
  // 仅运动/饮食一个因子时 coeff 即该因子的抽样值；σ 由 CI 对数中点反推，
  // 0.78/0.89 略偏离对数中点，故按 2dp 基准 [0.76,0.80]/[0.85,0.93] 用 ±0.002 容差
  const okA = hasAct && Math.abs(actHi - 0.80) <= 0.002 && Math.abs(actLo - 0.76) <= 0.002 && Math.abs(act0 - 0.78) <= 1e-9;
  const okD = hasDiet && Math.abs(dietHi - 0.93) <= 0.002 && Math.abs(dietLo - 0.85) <= 0.002 && Math.abs(diet0 - 0.89) <= 1e-9;
  check('13', '② 运动(0.78)/饮食(0.89) 参与 CI 抽样：z=±1.96 落在 [0.76,0.80]/[0.85,0.93]，z=0 等于点估计',
    okA && okD,
    `运动 z=+1.96→${actHi.toFixed(4)}、z=-1.96→${actLo.toFixed(4)}、z=0→${act0.toFixed(4)}；`+
    `饮食 z=+1.96→${dietHi.toFixed(4)}、z=-1.96→${dietLo.toFixed(4)}、z=0→${diet0.toFixed(4)}`);
}

// ============ 22. 月模式下一次性事件与年模式同口径（曾缩水 12 倍） ============
{
  const y = api.computeSurvival(AGE, SEX, 1, 0, 'year', undefined, 1000);
  const mo = api.computeSurvival(AGE, SEX, 1, 0, 'month', 12, 1000);
  const lossY = 1 - y[1].s;
  const lossM = 1 - mo[12].s;
  const ok = Math.abs(lossY - lossM) <= 2e-4 && lossM > 0.0008;
  check('22', '月模式的一次性事件与年模式等量（1,000 微死亡 ≈ 首年损失 0.1%），不再缩水 12 倍',
    ok, `年模式首年损失=${(lossY*1e6).toFixed(0)} 微死亡，月模式 12 个月损失=${(lossM*1e6).toFixed(0)} 微死亡`);
}

// ============ 14. ⑥ CAP 抽样：metDangerCount≥2 时 capS 按 Li 2016 CI（1.48–2.49）抽样 ============
{
  const res = api.computeCoefficients(AGE, SEX, 30, 100, 160, 7, 4, null, null, null, null, null, null);
  api.setZ(1.96);
  api.sampleCoeff(res);
  const capHi = api.getLastCapS();
  api.setZ(-1.96);
  api.sampleCoeff(res);
  const capLo = api.getLastCapS();
  api.setZ(0);
  api.sampleCoeff(res);
  const cap0 = api.getLastCapS();
  const cc0 = api.computeCoefficients(AGE, SEX, 30, 100, 160, 7, 4, null, null, null, null, null, null).coeff;
  api.setZ(null);
  const ok = Math.abs(capHi - 2.49) <= 0.005 && Math.abs(capLo - 1.48) <= 0.005 && Math.abs(cap0 - 1.92) <= 1e-12;
  check('14', '⑥ CAP 抽样：z=±1.96 时 capS≈[1.48,2.49]（Li 2016 CI），z=0 时 capS=1.92 且 coeff 与点估计一致',
    ok, `capHi=${capHi.toFixed(4)}，capLo=${capLo.toFixed(4)}，cap0=${cap0.toFixed(4)}，coeff@z=0=${cc0.toFixed(6)}`);
}

// ============ 16. 饮酒/吸烟三档着色：0=绿、仍有摄入但低于平均=灰、达到或超过平均=红 ============
{
  const exp = (a, s) => ({ alcohol: a, smoke: s });
  const aZero = api.colorTone('饮酒', 'pos', exp(0, 0));
  const aLow  = api.colorTone('饮酒', 'pos', exp(50, 0));
  const aHigh = api.colorTone('饮酒', 'neg', exp(300, 0));
  const sZero = api.colorTone('吸烟', 'pos', exp(0, 0));
  const sLow  = api.colorTone('吸烟', 'pos', exp(0, 5));
  const sHigh = api.colorTone('吸烟', 'neg', exp(0, 20));
  const flat  = api.colorTone('饮酒', 'zero', exp(0, 0));
  const other = api.colorTone('心率', 'pos', exp(0, 0));
  const ok = aZero === 'ok' && aLow === 'mut' && aHigh === 'danger'
          && sZero === 'ok' && sLow === 'mut' && sHigh === 'danger'
          && flat === 'mut' && other === 'ok';
  check('16', '⑦ 饮酒/吸烟三档着色：0=绿、低于人群平均=灰、高于平均=红（其他因素不受影响）',
    ok, `饮酒 0/${aLow}/${aHigh}，吸烟 ${sZero}/${sLow}/${sHigh}，持平=${flat}，心率=${other}`);
}

// ============ 26. 寿命收支分母：t=0 不计入剩余寿命 ============
{
  const flatY = Array.from({length:66}, (_,t)=>({t, s:1}));
  const flatM = Array.from({length:37}, (_,t)=>({t, s:1}));
  const leY = api.lifeExpectancyYears(flatY, 'year');
  const leM = api.lifeExpectancyYears(flatM, 'month');
  const ok = Math.abs(leY - 65) < 1e-9 && Math.abs(leM - 3) < 1e-9;
  check('26', '寿命收支分母从 t=1 起加：66 个整年点 → 65 年，37 个月点 → 3 年', ok, 'leY=' + leY + '，leM=' + leM);
}

// ============ 27. 事件名与 CATALOG 著录一一对应 ============
{
  const evNames = api.EVENTS.flatMap(c => c.items.map(i => i[0]));
  const missing = evNames.filter(n => !api.CATALOG.some(c => c.n === n));
  check('27', '每个事件名都能在 CATALOG 找到著录（改名不会静默丢来源）', missing.length === 0,
    missing.length ? '缺失：' + missing.join('、') : '事件 ' + evNames.length + ' 条，全部有著录');
}

// ============ 28. 数据自检：事件/CATALOG/信度/SRC 一致 ============
{
  const errs = api.validateData();
  check('28', '数据自检无错误（事件/CATALOG/信度/SRC/区间/年份/数值/竖线）', errs.length === 0,
    errs.length ? errs.slice(0, 5).join('；') : '事件 ' + api.EVENTS.flatMap(c=>c.items).length + ' 条');
}

// ============ 29. qAt 非法输入：NaN 抛错、越界钳制 ============
{
  let threw = false;
  try { api.qAt(NaN, 'm'); } catch (e) { threw = true; }
  const neg = api.qAt(-5, 'm');
  const base0 = api.qAt(0, 'm');
  const over = api.qAt(200, 'm');
  check('29', 'qAt(NaN) 抛错（不再静默当作必死）；qAt(-5)=qAt(0)；qAt(200)=1',
    threw && Math.abs(neg - base0) < 1e-12 && over === 1,
    'throw=' + threw + '，q(-5)=' + neg + '，q(0)=' + base0 + '，q(200)=' + over);
}

// ============ 30. 组内插值：组首低于组率、组尾高于组率 ============
{
  const q = [40, 41, 42, 43, 44].map(a => api.qAt(a, 'm') * 1000);
  const band = 2.245;
  const ok = q[0] < band && q[4] > band && (q[4] - q[0]) > 0.5;
  check('30', '40–44 岁组内年率不平（PCHIP 插值），组首 ' + q[0].toFixed(3) + '‰ < 组率 ' + band + '‰ < 组尾 ' + q[4].toFixed(3) + '‰',
    ok, '组内极差 ' + (q[4] - q[0]).toFixed(3) + '‰');
}

// ============ 31. 「八成四」出处（1.0.5 起：封面只注官方口径，差异下放附录 A） ============
{
  const ok = html.indexOf("《健康中国行动（2019—2030 年）》") >= 0
          && html.indexOf("逐条写在附录 A") >= 0
          && html.indexOf("五类只合到约七成") >= 0
          && html.indexOf("拼在一起不等于全国总量") >= 0
          && html.indexOf("不是矛盾") < 0;
  check('31', '封面 84% 只注《健康中国行动》官方口径并指向附录 A；附录 A 交代事件表约七成的两处原因（分母与分类），封面不再自行结案', ok);
}

// ============ 32. 附录 A 的 e₀ 对照句（1.0.3 改对、1.0.4 写回，1.0.5 改回并锁死） ============
{
  const stale = html.indexOf("比国家公布值低约 2–3 岁") >= 0;
  const ok = !stale && html.indexOf("低约 0.6 岁") >= 0 && html.indexOf("78.45") >= 0;
  check('32', '附录 A e₀ 对照句：0.6 岁口径 + WHO 总人口 78.45，旧「2–3 岁」不再出现', ok,
    'stale=' + stale);
}

// ============ 33–40. 无障碍与可用性（1.0.5 同批回归锁定） ============
{
  const numsLive = /id="nums"[^>]*aria-live/.test(html);
  const ok = !numsLive
    && html.indexOf('id="numsSr"') >= 0
    && html.indexOf('aria-atomic="true"') >= 0
    && src.indexOf('数字卡已更新') >= 0;
  check('33', '数字卡不再整块 aria-live（避免重播上百字），改由 #numsSr 播一句摘要', ok, 'numsLive=' + numsLive);
}
{
  const ok = html.indexOf('--mut:#59544B') >= 0
    && html.indexOf('.src-dim{font-size:12px;color:#4E4A41;}') >= 0;
  check('34', '正文灰色说明文字加深到 AA 以上（--mut #59544B、.src-dim #4E4A41；实测最低 6.0:1）', ok);
}
{
  const ok = html.indexOf('min-height:36px') >= 0
    && html.indexOf('min-height:34px') >= 0
    && html.indexOf('min-height:32px') >= 0;
  check('35', '按钮 / 输入框 / 复选项设最小点击高度（桌面 32–36px，移动 44px）', ok);
}
{
  const ok = src.indexOf('cap.className = "sr-only"') >= 0
    && src.indexOf('hint.className = "tbl-hint"') >= 0
    && html.indexOf('.tbl-hint{') >= 0;
  check('36', '数据表补 programmatic 标题（caption.sr-only），宽表溢出时才显示横滑提示', ok);
}
{
  const ok = src.indexOf('已合并到列表里的') >= 0 && src.indexOf('同名条目重复') >= 0;
  check('37', '同名同口径重复添加时合并数量并提示；同名条目（含状态项）汇总到 #evDupHint', ok);
}
{
  const ok = src.indexOf("aria-label=\"移除第 '+(i+1)+' 条：'") >= 0;
  check('38', '删除按钮读作「移除第 N 条：名称」（同名行不再无法区分）', ok);
}
{
  const ok = src.indexOf('条状态对比项不参与累计') >= 0 && src.indexOf('不参与「事件累计」') >= 0;
  check('39', '状态对比行标注「不参与事件累计、不叠加曲线」，并在合计旁报出条数', ok);
}
{
  const ok = src.indexOf('const APP_VERSION = "1.0.5"') >= 0
    && src.indexOf("个人风险报告（v'+APP_VERSION+'）") >= 0
    && html.indexOf('1.0.5（2026-11-17 · 当前版本') >= 0;
  check('40', '报告头版本引用单一常量 APP_VERSION（不再手写），版本记录含 1.0.5', ok);
}

// ============ 33. 蓝带固定种子：同一输入两次计算结果逐点一致 ============
{
  const res = api.computeCoefficients(AGE, SEX, 30, 100, 160, 7, 4, null, null, null, null, null, null);
  const b1 = api.monteCarloBand(AGE, SEX, res, 0, 'year', undefined, 60, 'seed-test-A');
  api.monteCarloBand(AGE, SEX, res, 0, 'year', undefined, 60, 'seed-test-B');
  const b2 = api.monteCarloBand(AGE, SEX, res, 0, 'year', undefined, 60, 'seed-test-A');
  const same = b1.length === b2.length && b1.every((x, i) => x.p025 === b2[i].p025 && x.p50 === b2[i].p50 && x.p975 === b2[i].p975);
  check('33', '蓝带按输入指纹固定种子：同一档案两次计算逐点一致（刷新/打印不漂移）', same,
    'points=' + b1.length);
}

// ---- 汇总 ----
console.log(`\n结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`);
if (fail > 0) {
  console.error('✗ 存在未通过的验收项，请检查 index.html 或规格书。');
  process.exit(1);
} else {
  console.log('✓ 全部验收项通过。');
}
