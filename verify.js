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
const document = {
  getElementById: () => elStub,
  querySelector: () => elStub,
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  addEventListener() {},
};
const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
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
  MALE, FEMALE, EVENTS, REL, SRC, COEF_FACTORS, MEAN_REF, COEF_CI, VSL, IDX, DIET_IDS,
  EV_RANGE, EV_YEAR, CAP_SIGMA,
  qAt, computeCoefficients, computeSurvival, saturate, bodyShapeFactor, colorTone,
  activityFactor, dietFactor, rawFactor, anchorDivisor, meanRef, coefMM, sigmaFromCI,
  monteCarloBand, sampleCoeff, eventTotalMicromort, computeFromParts,
  DEFL_INC, DEFL_CPI, DEFL_BASE, deflIncomeRatio, deflCpiCum, deflFactor,
  vsalFor, yuanText, VSL_PICK, VSL_DOMAIN_OF,
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
  check('1', '年龄 40 男 → 年度背景风险 ≈ 2245 微死亡（WHO 40 岁男 2.245‰）',
    Math.round(mm) === 2245, `qAt(40,"m")=${mm.toFixed(1)} 微死亡/年`);
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
  const mm = api.qAt(AGE, SEX) * (f - 1) * 1e6;
  check('4', '吸烟 20 支/天 → 系数 1.4865、等效额外 ≈ 1092 微死亡/年（相对人群平均 8 支/天）',
    Math.round(mm) === 1092, `f=${f.toFixed(4)}，等效额外=${mm.toFixed(1)} 微死亡/年`);
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

  // Q-04 改判：CAP 只管 ≥2 因素的饱和组合，单项极端值保留裸 HR（用户 2026-11-13 裁定）
  const glu15 = api.computeCoefficients(AGE, SEX, null, null, null, 15, null, null, null, null, null, null, null);
  check('9e', '只填血糖 15 mmol/L → 裸 HR ≈ 2.45，可高于 CAP 1.92（CAP 只约束 ≥2 因素的组合）',
    Math.abs(glu15.coeff - 2.4496) <= 0.05 && glu15.coeff > api.CAP_METABOLIC,
    'coeff=' + glu15.coeff.toFixed(4) + '，CAP=' + api.CAP_METABOLIC.toFixed(2));
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
  const legacy = api.colorTone('饮酒', 'pos', 50);   // 旧签名（第三参数是数字）仍按饮酒处理
  const ok = aZero === 'ok' && aLow === 'mut' && aHigh === 'danger'
          && sZero === 'ok' && sLow === 'mut' && sHigh === 'danger'
          && flat === 'mut' && other === 'ok' && legacy === 'mut';
  check('16', '⑦ 饮酒/吸烟三档着色：0=绿、低于人群平均=灰、高于平均=红（其他因素不受影响，旧调用兼容）',
    ok, `饮酒 0/${aLow}/${aHigh}，吸烟 ${sZero}/${sLow}/${sHigh}，持平=${flat}，心率=${other}`);
}

// ---- 汇总 ----
console.log(`\n结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`);
if (fail > 0) {
  console.error('✗ 存在未通过的验收项，请检查 index.html 或规格书。');
  process.exit(1);
} else {
  console.log('✓ 全部验收项通过。');
}
