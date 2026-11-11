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
    width: 0, height: 0, clientWidth: 0, offsetWidth: 0, offsetHeight: 0,
    getContext: () => ({ clearRect() {}, setTransform() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {} }),
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
  setTimeout: () => 777,   // 返回哨兵值以便断言「已排定时器」（沙箱不真正调度）
  clearTimeout() {},
};
vm.createContext(sandbox);

// ---- 包裹成 IIFE，导出需要的符号（含可改 tau / 可强制正态抽样 z 的闭包 setter）----
const wrapped = `(function(){\n${core}\nreturn {
  MALE, FEMALE, EVENTS, REL, SRC, COEF_FACTORS, MEAN_REF, COEF_CI, VSL, IDX, DIET_IDS,
  EV_RANGE, EV_YEAR, CAP_SIGMA, CATALOG, catalogOf, REFS,
  qAt, computeCoefficients, computeSurvival, saturate, bodyShapeFactor,
  activityFactor, dietFactor, rawFactor, anchorDivisor, meanRef, coefMM, sigmaFromCI,
  monteCarloBand, sampleCoeff, eventTotalMicromort, computeFromParts, fmt,
  attachChartPointer, bubbleTextAt, drawCrosshair, tAtPx,
  hideBubble, bubbleTouchDown, bubbleTouchUp, BUBBLE_HIDE_MS,
  getLastBubble(){ return lastBubble; },
  setLastRenderState(st){ lastRenderState = st; }, buildReport, buildTextSummary,
  K_LIFESTYLE, CAP_METABOLIC, TAU_DEFAULT,
  setTau(t){ tau = t; }, getTau(){ return tau; },
  setZ(z){ Z_FORCE = z; }, getLastCapS(){ return lastCapS; },
  setLastSeries(s){ lastSeries = s; }, setLastAge(a){ lastAge = a; }, setMode(m){ mode = m; },
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
  check('1', '年龄 40 男 → 年度背景风险 ≈ 1015 微死亡（CL4 40 岁男 1.015‰）',
    Math.round(mm) === 1015, `qAt(40,"m")=${mm.toFixed(1)} 微死亡/年`);
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
  check('4', '吸烟 20 支/天 → 等效额外 ≈ 494 微死亡/年（相对人群平均 8 支/天）',
    Math.round(mm) === 494, `f=${f.toFixed(4)}，等效额外=${mm.toFixed(1)} 微死亡/年`);
}

// ============ 5 / 5a. VSL 两口径 ============
{
  const qin = api.VSL[0].fields[0].studies[0];
  const guo = api.VSL[0].fields[0].studies[1];
  check('5', '市场行为→职业→Qin X Z 2005 → 当时 ¥1.81 / 今日 ¥9.75',
    qin.author === 'Qin X Z' && qin.year === 2005 &&
    Math.abs(qin.raw / 100 - 1.81) < 0.01 && Math.abs(qin.today / 100 - 9.75) < 0.01,
    `raw=${qin.raw}万→当时¥${(qin.raw/100).toFixed(2)}，today=${qin.today}万→今日¥${(qin.today/100).toFixed(2)}`);
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
  check('7', '吸烟20+收缩压160 → 置信区间带生成 + 风险构成含吸烟/血压',
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

// ============ 15. 二期：事件库扩充（32 → 58 行）+ CATALOG 全覆盖 + 不通过名单缺席 ============
{
  const rows = [];
  api.EVENTS.forEach(cat=>{ (cat.items||[]).forEach(it=>rows.push(it)); });
  const cats = api.EVENTS.length;
  const uncovered = rows.map(r=>r[0]).filter(n=>!api.catalogOf(n));
  const banned = ["烧伤","儿童中毒"].filter(n=>rows.some(r=>r[0]===n));
  const dup = rows.length - new Set(rows.map(r=>r[0])).size;
  check('15', '二期事件库：5 组 58 行（一期 32 + 新增 26），CATALOG 覆盖全部行，不通过条目缺席，无重名',
    cats===5 && rows.length===58 && uncovered.length===0 && banned.length===0 && dup===0,
    `分组=${cats}，行数=${rows.length}，未著录=${uncovered.join(',')||'无'}，不通过条目在场=${banned.join(',')||'无'}，重名=${dup}`);
}

// ============ 16. 二期：新增 26 条 + 对照 2 条的出版级著录 9 字段完整性 ============
{
  const NEW26 = ["溺水（1–4 岁）","溺水（5–14 岁）","溺水（全人群）","跌倒（≥65 岁）","意外跌落（全人群）",
    "步行（行人-机动车事故）","驾乘机动车（车-车碰撞）","骑电动自行车","道路交通事故（公安口径）",
    "道路交通事故（监测口径）","道路交通事故（WHO 口径）","酒驾（含醉驾，全人群）","酒驾（含醉驾，驾驶人）",
    "意外中毒（全人群）","一氧化碳中毒","火灾（监测口径）","火灾（消防救援局口径）","意外的机械性窒息",
    "婴儿窒息（城市，每10万婴儿）","婴儿窒息（农村，每10万婴儿）","触电","自然灾害（全类型）","狂犬病",
    "高空坠物砸死","流感重症（超额死亡）","心源性猝死","对照·自杀","对照·被杀"];
  const bad = NEW26.map(n=>{
    const c = api.catalogOf(n);
    if(!c) return n+"（缺条目）";
    const miss = ["n","v","u","c","s","y","p","l","r"].filter(k=> !(typeof c[k]==="string" && c[k].trim().length>0));
    return miss.length ? n+"（缺 "+miss.join('/')+"）" : null;
  }).filter(Boolean);
  check('16', '二期：新增 26 条 + 对照 2 条的出版级著录 9 字段（名称/数值/单位/换算式/来源/年份/样本口径/局限/信度）全部非空',
    bad.length===0, bad.length ? bad.join('；') : '28/28 完整');
}

// ============ 17. 二期：悬垂气泡函数齐备 + 数值与数字卡同源（真实 monteCarloBand 输出形状，≤0.1%） ============
{
  api.setMode("year"); api.setLastAge(40); api.setZ(0);
  const res = api.computeCoefficients(40, 'm', null,null,null,null,null,null,null,null,null,null,null,null);
  const band = api.monteCarloBand(40, 'm', res, 0, 'year', undefined, 200);   // 真实输出：按 t 索引的 {p025,p25,p50,p75,p975} 数组
  const base = api.computeSurvival(40, 'm', res.coeff, 0, 'year', undefined);
  const adj  = api.computeSurvival(40, 'm', res.coeff, 500, 'year', undefined);
  const shapeOk = Array.isArray(band) && band.length > 30 && typeof band[10].p50 === "number" && band[10].t === undefined;
  api.setLastSeries({ base, adj, band });
  const fnOk = typeof api.attachChartPointer==="function" && typeof api.bubbleTextAt==="function" &&
               typeof api.drawCrosshair==="function" && typeof api.tAtPx==="function";
  const b = api.bubbleTextAt(10);
  const exp50 = api.fmt(band[10].p50*100,2)+"%";
  const expIQR = api.fmt(band[10].p25*100,2)+"%–"+api.fmt(band[10].p75*100,2)+"%";
  const ok = fnOk && shapeOk && !!b && b.html.indexOf("10 年后（50 岁）")!==-1 && b.html.indexOf(exp50)!==-1 &&
             b.html.indexOf(expIQR)!==-1 && b.html.indexOf("置信区间中位数")!==-1 &&
             b.html.indexOf("叠加额外风险后")!==-1 && b.html.indexOf("基础 · 点估计")!==-1;
  api.setZ(null);
  check('17', '二期：气泡函数齐备；真实 band 形状（band[t].p50 无 .t 字段）；t=10 气泡 4 行数据齐全且与数字卡同源',
    ok, ok ? (b.html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()) : '函数缺失/形状不符/内容不符');
}

// ============ 18. 二期：响应式与章节化骨架（viewport/@media/touch-action/7 章+目录+气泡+报告 DOM） ============
{
  const need = ['<meta name="viewport"', '@media (max-width:767px)', '@media (max-width:479px)',
    'touch-action:pan-y', 'id="chapterNav"', 'id="prologue"', 'id="ch1"', 'id="ch2"', 'id="ch3"',
    'id="ch4"', 'id="ch5"', 'id="epilogue"', 'id="chartBubble"', 'id="chartOverlay"',
    'id="reportCard"', '#printRoot{display:none;}', 'IntersectionObserver',
    '.refs li', 'overflow-wrap:anywhere', 'details{max-width:100%'];
  const miss = need.filter(s=> html.indexOf(s)===-1);
  check('18', '二期：viewport 元标签、767/479 断点、touch-action:pan-y、7 章骨架、目录高亮（IntersectionObserver）、气泡/报告 DOM、打印根 CSS、参考文献/折叠卡换行规则齐备',
    miss.length===0, miss.length ? '缺失：'+miss.join('、') : '20/20 齐备');
}

// ============ 19. 二期（t16 修复）：气泡触摸状态机——二次 tap 立即关闭；pointerup 先解锁再排 2s 淡出 ============
{
  api.setLastSeries({ base:[{t:10,s:0.95}], adj:null, band:null });
  const down1 = api.bubbleTouchDown();            // 首次触摸 → true，进入拖动（active+locked）
  const a1 = api.getLastBubble().active, l1 = api.getLastBubble().locked;   // 立即取快照（对象为活引用）
  const up1  = api.bubbleTouchUp();               // 松手 → 先解锁再排定时器
  const l2 = api.getLastBubble().locked, timer2 = api.getLastBubble().hideTimer;
  const down2 = api.bubbleTouchDown();            // 二次 tap → 立即关闭（active 态触发）
  const a3 = api.getLastBubble().active, l3 = api.getLastBubble().locked;
  clearTimeout(timer2);
  const ok = down1===true && a1===true && l1===true &&
             up1===true && l2===false && timer2===777 &&
             down2===false && a3===false && l3===false;
  check('19', '二期（t16 修复）：触摸状态机——首次触摸锁定拖动；松手先解锁（locked=false）并排 2s 淡出定时器；二次 tap 立即关闭',
    ok, ok ? 'down1='+down1+' upTimer='+timer2+' down2='+down2 : 'down1='+down1+' a1='+a1+' l1='+l1+' up1='+up1+' lockedUp='+l2+' timer='+timer2+' down2='+down2+' active3='+a3+' l3='+l3);
}

// ============ 20. 二期（t16 修复）：报告表 2 补 25–75% 区间，与文本摘要同口径 ============
{
  api.setMode("year"); api.setZ(0); api.setLastAge(40);
  const res = api.computeCoefficients(40, 'm', null,null,null,null,null,null,null,null,null,null,null,null);
  const band = api.monteCarloBand(40, 'm', res, 0, 'year', undefined, 200);
  const base = api.computeSurvival(40, 'm', res.coeff, 0, 'year', undefined);
  const adj  = api.computeSurvival(40, 'm', res.coeff, 500, 'year', undefined);
  api.setLastRenderState({ age:40, sex:'m', bmi:null, waist:null, sbp:null, glu:null, ldl:null, hr:null,
    sleep:null, alcohol:null, smoke:null, activity:null, diet:null,
    res, extra:500, base, adj, band, marks:[10,20,30], queryN:null, mode:'year' });
  const rep = api.buildReport();
  const sum = api.buildTextSummary();
  const iqr10 = api.fmt(band[10].p25*100,2)+"%–"+api.fmt(band[10].p75*100,2)+"%";
  const ok = rep.indexOf("25–75%")!==-1 && rep.indexOf("2.5–97.5%")!==-1 && rep.indexOf(iqr10)!==-1 &&
             sum.indexOf("25–75%")!==-1 && sum.indexOf(iqr10)!==-1;
  api.setZ(null);
  check('20', '二期（t16 修复）：报告表 2 含 25–75% 与 2.5–97.5% 区间，且与文本摘要同口径（同 10 年 IQR 字符串）',
    ok, ok ? '表2与摘要均含 '+iqr10 : 'rep25='+rep.indexOf("25–75%")+' repIQR='+rep.indexOf(iqr10)+' sumIQR='+sum.indexOf(iqr10));
}

// ============ 21. t23（质检回修）：信度卡年份跨度文案 1922–2024（EV_YEAR 中登珠峰 1922–2012 属合法数据年份，保留） ============
{
  const ok = html.includes("年份跨度 1922–2024") && !html.includes("年份跨度 1922–2012");
  check('21', 't23-①：年份跨度文案已改为 1922–2024，且「年份跨度 1922–2012」不复现',
    ok, ok ? '两处信度卡文案均已更新' : '1922–2024='+html.includes("年份跨度 1922–2024")+' 旧文案='+html.includes("年份跨度 1922–2012"));
}

// ============ 22. t23（质检回修）：健康素养实测值 27.78% + 工矿商贸 1.09（2024） ============
{
  const ok = html.includes("2022 年已达 27.78%") && !html.includes("2022 年已达到约 22%") &&
             html.includes("（1.09，2024）") && !html.includes("（10.9，2024）");
  check('22', 't23-②③：健康素养 2022 实测 27.78% 存在（旧 22% 表述不复现）；工矿商贸 1.09（2024）存在（旧 10.9 不复现）',
    ok, ok ? '27.78% / 1.09 均已落地' : '素养='+html.includes("2022 年已达 27.78%")+' 工矿='+html.includes("（1.09，2024）"));
}

// ============ 23. t23（质检回修）：参考文献著录防回归 ============
{
  const ok = html.includes("European Journal of Epidemiology, 2010, 25(6): 375-384") &&
             !html.includes("北京, 2020 年代") &&
             html.includes("中国循环杂志, 2024, 39(7): 625-660") &&
             html.includes("China Agricultural Economic Review, 2013") &&
             html.includes("Environmental and Resource Economics, 2009") &&
             html.includes("PLoS ONE, 2016, 11(5): e0154990") &&
             html.includes("2025-05-01 起全国 31 省区市全部开通");
  check('23', 't23-④：参考文献著录——[13] Wu 2010 EJE、[23] 2023 概要 2024 中国循环杂志（旧「2020 年代」不复现）、[24] Qin 2013 CAER、[25] Guo & Hammitt 2009 ERE、新增 [29] Li 2016 PLOS ONE（补齐正文 Li 2016 引文）、[28] 补 12356 全国开通日期',
    ok, ok ? '6/6 著录项齐备' : '检查 [13]/[23]/[24]/[25]/[28]/[29] 著录');
}

// ============ 24. t23（质检回修）：报告饮酒行「克/周」+ 疑似项文案 + 尾声质检信息 ============
{
  const ok = html.includes('st.alcohol+" 克/周"') && !html.includes('st.alcohol+" 次/周"') &&
             html.includes("约 ±5%–20%") && !html.includes("约 ±20%") &&
             html.includes("未在单一数值中体现") &&
             html.includes('id="waist" min="60" max="110"') &&
             html.includes("两者相差约 4–7 倍") &&
             html.includes("蓝线＝叠加额外风险后") && !html.includes("橙线＝叠加额外风险后");
  check('24', 't23-⑤+回修：报告饮酒行「克/周」（旧「次/周」不复现）；S3 区间口径 ±5%–20%；S4 溺水著录修正；S8 腰围 min=60；S10 倍数措辞；E2 蓝线图注（尾声质检信息由 check 57 覆盖）',
    ok, ok ? '8/8 项齐备' : '存在未落地回修项');
}

// ============ 25. 三期 A1：账本美学 15 色板令牌 + 字体栈 ============
{
  const tokens = ["--bg:#F4EFE1","--card:#FBF8EF","--line:#DCD4BD","--ink:#2B2A26","--mut:#6E6960",
    "--acc:#A94438","--acc-soft:#F2E3DD","--acc-deep:#8C3327","--warn:#8A5F00","--warn-soft:#F6EFDC",
    "--ok:#0F6E56","--danger:#A32D2D","--ci:#185FA5","--bead:#C9C1AA","--paper-ink:rgba(43,42,38,.028)"];
  const miss = tokens.filter(t=> html.indexOf(t)===-1);
  const fonts = html.indexOf("--font-head")!==-1 && /--font-head:[^;]*"Songti SC"/.test(html) &&
                html.indexOf("--font-body")!==-1 && /--font-body:[^;]*Georgia/.test(html) &&
                html.indexOf("repeating-linear-gradient")!==-1;
  check('25', '三期 A1：15 个账本色板令牌值全部落地；--font-head 首项 Songti SC、--font-body 首项 Georgia；纸纹背景存在',
    miss.length===0 && fonts, miss.length ? '缺失：'+miss.join('、') : '15/15 令牌 + 字体栈 + 纸纹齐备');
}

// ============ 26. 三期 A2：装饰层边界——封面/章头/卷轴题额/算珠，且不越界 ============
{
  const ok = html.indexOf(".cover::after")!==-1 &&
             html.indexOf(".ch-head::before")!==-1 && html.indexOf(".ch-head::after")!==-1 &&
             html.indexOf("3px double")!==-1 && html.indexOf("border-top:1px solid var(--ink)")!==-1 &&
             html.indexOf("@media print")!==-1 && html.indexOf("content:none")!==-1 &&
             html.indexOf(".num::before")===-1 && html.indexOf("table::before")===-1 &&
             html.indexOf("#chartBubble::before")===-1 && html.indexOf("#printRoot::before")===-1;
  check('26', '装饰层：封面印章/章头/卷轴题额（上栏线+下 double 印泥线）存在；打印时装饰关闭；数据卡/表格/气泡/打印根无装饰伪元素',
    ok, ok ? '装饰层边界正确' : '装饰伪元素缺项或越界');
}

// ============ 27. 三期 A3：书名落地（title/h1/subtitle/报告头脚/剪贴板）+ 68 万强调 + 术语基线 ============
{
  const ok = html.includes("<title>与死神的账本：用微死亡丈量中国人的风险</title>") &&
             html.includes("<b class=\"hl\">68 万</b>") &&
             html.includes("与死神的账本 · 个人风险报告（v2.0）") &&
             html.includes("与死神的账本 · 仅本机生成，不上传不联网") &&
             html.includes("《与死神的账本》个人风险报告") &&
             html.includes("用微死亡丈量中国人的风险");
  const term = (html.match(/死亡风险/g)||[]).length;
  check('27', '三期 A3：书名「与死神的账本」在标题/报告头/报告脚/剪贴板逐字落地；68 万加红注；正文术语「死亡风险」13 处与二期终版一致（书名更名处为获批改动）',
    ok && term===13, ok ? ('书名 7 处齐备；术语='+term) : ('书名缺项或术语漂移 term='+term));
}

// ============ 28. 三期 A4：图表账本化——网格/基线/轴字换账本色，CI 蓝与信度四色原值不动 ============
{
  const ok = html.includes('"#C9C1AA"') && html.includes('"#DCD4BD"') && html.includes('"#E7E1CE"') &&
             html.includes('"#8A8578"') && html.includes("11px Georgia, serif") &&
             html.includes(".rel-A{color:#0F6E56") && html.includes(".rel-B{color:#185FA5") &&
             html.includes(".rel-C{color:#7a6200") && html.includes(".rel-D{color:#A32D2D") &&
             html.includes("rgba(24,95,165,0.10)") && html.includes("rgba(24,95,165,0.20)") &&
             html.includes("rgba(24,95,165,0.55)") &&
             (html.match(/#185FA5/g)||[]).length===9 && (html.match(/rgba\(24,95,165/g)||[]).length===4;
  check('28', '三期 A4：图表网格 --bead/--line/竖格/基线 #8A8578/Georgia 轴字落地；信度 A-D 四色与 CI 蓝（#185FA5×9、rgba 透明带×4）原值不变',
    ok, ok ? '账本色与 CI 蓝/信度色共存' : '图表颜色或信度色被改动');
}

// ============ 29. 三期 A5：目录条 7 入口（附录不进导航） ============
{
  const n = (html.match(/data-ch=/g)||[]).length;
  check('29', '三期 A5：章节目录 7 个入口（序/1-5 章/尾声；附录参考文献不进导航）',
    n===7 && html.indexOf("id=\"refs\"")!==-1 && html.indexOf("chapterNav")!==-1, 'data-ch 计数='+n);
}

// ============ 30. 三期 A6：REFS 重排 1-34 连续单调 + D2/D3 新条目 + 导航遮罩/自动归位 + B1/B3 守卫 ============
{
  const s = html.indexOf("const REFS = [");
  const e = html.indexOf("function renderRefs", s);
  const slice = s>=0 && e>s ? html.slice(s, e) : "";
  const nums = [...slice.matchAll(/^\s*"\[(\d{1,2})\]/gm)].map(m=>parseInt(m[1],10));
  const monotonic = nums.length===34 && nums.every((v,i)=> v===i+1);
  const liby = /\[24\] LI Z X, YANG X H/.test(slice);
  const ijbnpa = slice.includes("10.1186/s12966-019-0860-z");
  const qin = /\[30\] QIN X Z, LI L X/.test(slice);
  const hotline = /\[34\] 国家卫生健康委员会\. 关于应用“12356”/.test(slice);
  const ok = monotonic && liby && ijbnpa && qin && hotline &&
             html.includes("mask-image:linear-gradient") &&
             html.includes('block:"nearest"') && html.includes("inline:\"center\"") &&
             html.includes("padding:9px 14px") &&
             html.includes("先在「个人状态」填写年龄与性别，再看等效微死亡") &&
             html.includes("未填年龄/性别");
  check('30', '三期 A6：参考文献序列单调 1-34（[24]=Li 2016/[25]=CKB IJBNPA DOI/[30]=Qin 2013/[34]=12356）；导航右缘遮罩+active 自动归位+9px/14px 触控；D5 B1/B3 守卫文案',
    ok, ok ? 'REFS 1-34 单调，4 处锚点正确，D4/D5 齐备' : ('nums='+nums.length+' mono='+monotonic+' liby='+liby+' ijbnpa='+ijbnpa+' qin='+qin+' hotline='+hotline));
}

// ============ 31. 三期 A7：折叠组件 + 附录节位置 + [n] 标注 + 免责/求助不折叠 ============
{
  const sums = ["为什么 D 级「数值本身」无法升档","μ 值来源明细（9 项）",
    "28→24 篇折算口径与方法","编校信息（版本 1.0.0 · 作者自校）",
    "方法与局限（锚定口径 · 分簇公式 · 比例风险假设）"];
  const miss = sums.filter(s=> html.indexOf(s)===-1);
  const refsBetween = html.indexOf('id="refs"') > html.indexOf('id="ch5"') && html.indexOf('id="refs"') < html.indexOf('id="epilogue"');
  const cites = ["#ref-25","#ref-24","#ref-13","#ref-14","#ref-32","#ref-7"].every(h=> html.includes('href="'+h+'"'));
  const refsDetails = html.includes("(i===0||i===1)") && html.includes('id="ref-');
  const disOut = html.includes("本工具仅供理解风险量级，不构成任何医疗或预测结论");
  check('31', '三期 A7：5 处折叠 summary 逐字在场；附录节位于第5章与尾声之间；[n] 标注 6 处锚点对应（href="#ref-N"）；参考文献 5 组 details（前两组默认展开）+ 每条 id=ref-n；免责句在折叠外',
    miss.length===0 && refsBetween && cites && refsDetails && disOut,
    miss.length ? '缺失 summary：'+miss.join('、') : '折叠/附录/[n]锚点/ref-n/免责全部齐备');
}

// ============ 32. 三期 A8/A10：打印规则强化 + 零外部资源 + 移动端细节 ============
{
  const ok = html.includes("border-bottom:3px double #000") && html.includes("print-color-adjust:exact") &&
             html.includes("content:none") &&
             !html.includes("<script src") && !html.includes("@font-face") && !html.includes("url(http") &&
             !html.includes('rel="stylesheet"') &&
             html.includes("id=\"chapterProgress\"") && html.includes("{passive:true}") &&
             html.includes(".risk-val{width:96px");
  check('32', '三期 A8/A10：打印标题 double 下划线+图保持原色+装饰关闭；零外部资源（无 script src/@font-face/url(http)/stylesheet link）；进度条 DOM+passive 滚动；风险构成条 ≤479px 值列 96px',
    ok, ok ? '打印/零依赖/移动端细节齐备' : '存在未落地项');
}

// ============ 33. t44 R1：引注体系锚点（附录总入口 + 10 处 ref-n + 附录句 ch1 链接 + summary 锚点守卫） ============
{
  const refsAnchor = html.includes('href="#refs"');
  const citeCount = (html.match(/href="#ref-/g) || []).length;
  const ch1Link = html.includes('见<a href="#ch1">第1章事件列表</a>');
  const summaryGuard = html.includes("ev.stopPropagation()") && html.includes('summary a');
  check('33', 't44 R1：附录《参考文献》可跳转锚点 href="#refs"；href="#ref-" 共 10 处（[7]/[26]-[29]/[25]/[24]/[13]/[14]/[32]）；附录说明句第1章链接；summary 内锚点 stopPropagation 守卫',
    refsAnchor && citeCount===10 && ch1Link && summaryGuard,
    `refsAnchor=${refsAnchor} citeCount=${citeCount} ch1Link=${ch1Link} guard=${summaryGuard}`);
}

// ============ 34. t44 T1：朴玮著录替换为已核实题名（占位语不得复现） ============
{
  const piao = html.includes("朴玮, 赵丽云, 房红芸, 等. 中国18岁及以上成人饮酒行为现况[J]. 中国食物与营养, 2021, 27(10): 15-19.");
  const noPlaceholder = !html.includes("题名以刊文为准");
  check('34', 't44 T1：[27] 朴玮著录已替换为核实题名「中国18岁及以上成人饮酒行为现况」，占位语「题名以刊文为准」不复现',
    piao && noPlaceholder,
    piao ? '题名已替换；占位语已清除' : '题名缺失或占位语残留');
}

// ============ 35. 回修 P0-①：著录「数值或区间」不重复拼接单位（微死亡/微死亡不复现） ============
{
  const noDup = !html.includes("cat.u.indexOf('/')>=0?'/'+esc(cat.u)") && html.includes("esc(cat.v)+' 微死亡</td>");
  check('35', '回修 P0：著录「数值或区间」只显示数值+微死亡，不重复拼接单位（旧「微死亡/微死亡/次」不复现）',
    noDup, noDup ? '单位拼接已移除' : '单位拼接残留');
}

// ============ 36. 回修 P0-②：报告饮食计数走 DIET_IDS.filter（st.diet.length 不复现） ============
{
  const noDietLen = !html.includes("st.diet.length") && html.includes("DIET_IDS.filter(id=>st.diet[id]).length");
  check('36', '回修 P0：报告饮食达标计数用 DIET_IDS.filter（旧 st.diet.length 对对象无效，不复现）',
    noDietLen, noDietLen ? '饮食计数已修正' : 'st.diet.length 残留');
}

// ============ 37. 回修 P0-③：微寿命条形图 .fill 填充条齐备（3 条，宽由 --w 驱动） ============
{
  const fills = (html.match(/class="fill"/g)||[]).length;
  const css = html.includes(".microbars .mb .fill{display:block") && html.includes("width:var(--w,0)");
  check('37', '回修 P0：微寿命条形图 3 条 .fill 填充条齐备，CSS width:var(--w) 驱动',
    fills===3 && css, `fills=${fills} css=${css}`);
}

// ============ 38. 回修 P0-④：打印预览残留清除（#reportPrintArea 与 preview.innerHTML 均已移除） ============
{
  const hidden = !html.includes("reportPrintArea") && !html.includes("preview.innerHTML");
  check('38', '回修 P0：打印预览残留清除（#reportPrintArea 与 preview.innerHTML 均不复现）',
    hidden, hidden ? '预览残留已清除' : '打印预览残留');
}

// ============ 39-45. 1.0.0 稳定化（外部评审四缺陷 + 寿命收支 + 本土化 + 版本/口径） ============
{
  // 39 月模式：月数换算为岁数（旧 lastAge + t 把月数当岁数）
  const monthFix = html.includes('lastAge + (mode==="month" ? t/12 : t)');
  check('39', '1.0.0：月模式年龄用 t/12 换算（旧 lastAge+t 把月数当岁数）',
    monthFix, monthFix ? '月模式年龄换算已修正' : '月模式年龄换算缺失');
}
{
  // 40 双计数：includeEvents 开关 + eventTotalDisplay/eventTotalMicromort 分流 + 复选框
  const ev = html.includes('let includeEvents = false') && html.includes('function eventTotalDisplay')
    && html.includes('function eventTotalMicromort') && html.includes('includeEvents ? eventTotalDisplay() : 0')
    && html.includes('id="evInCurve"') && html.includes('id="evInCurveNote"');
  check('40', '1.0.0：事件默认仅对比不叠加（includeEvents 开关 + 复选框 #evInCurve + 警示）',
    ev, ev ? '双计数开关齐备' : 'includeEvents 或复选框缺失');
}
{
  // 41 寿命收支：lifespanUnit + 函数 + 卡片 + 接线
  const lspan = html.includes('let lifespanUnit = "min"') && html.includes('function lifeExpectancyYears')
    && html.includes('function coeffWithFactorAvg') && html.includes('function buildLifespanLedger')
    && html.includes('function renderLifespan') && html.includes('id="lspanUnit"') && html.includes('id="lspanLedger"')
    && html.includes('renderLifespan(ageI, sex, res, extra)') && html.includes('clearLifespan();');
  check('41', '1.0.0：寿命收支账（lifespanUnit + 逐因素敏感度 + #lspanUnit/#lspanLedger + render 接线）',
    lspan, lspan ? '寿命收支账齐备' : '寿命收支账缺失');
}
{
  // 42 canvas 残留：早退块清 canvas（lastSeries=null + chart/chartOverlay clearRect）
  const cvClear = html.includes('const cv=$("chart"); if(cv){ cv.getContext("2d").clearRect')
    && html.includes('const co=$("chartOverlay"); if(co){ co.getContext("2d").clearRect')
    && html.includes('lastSeries = null;');
  check('42', '1.0.0：render 早退清 canvas（chart/chartOverlay clearRect + lastSeries 重置）',
    cvClear, cvClear ? 'canvas 清理齐备' : 'canvas 清理缺失');
}
{
  // 43 本土化：三原型周平/秦远/林安，旧英文名不复现
  const loc = html.includes('周平 · 相信平均') && html.includes('秦远 · 攀岩爱好者') && html.includes('林安 · 三个孩子的母亲')
    && !html.includes('诺姆') && !html.includes('凯尔文') && !html.includes('普鲁登丝');
  check('43', '1.0.0：三原型本土化（周平/秦远/林安；旧名诺姆/凯尔文/普鲁登丝不复现）',
    loc, loc ? '三原型本土化完成' : '本土化名缺失或旧名残留');
}
{
  // 44 版本 + 口径：版本 1.0.0、旧 3.0 不复现、差值口径句在场
  const ver = html.includes('版本 1.0.0') && !html.includes('版本 3.0') && html.includes('不是对个人寿命的预言');
  check('44', '1.0.0：版本号 1.0.0 + 差值口径句（所有时间维度数字是比平均差值，非个人寿命预言）',
    ver, ver ? '版本与口径句齐备' : '版本号或口径句缺失');
}
{
  // 45 打印占位：printRoot 初始化有「尚未生成报告」占位（Ctrl+P 不空白）
  const ph = html.includes('root.id = "printRoot"') && html.includes('尚未生成报告');
  check('45', '1.0.0：#printRoot 初始化占位（尚未生成报告，Ctrl+P 不空白）',
    ph, ph ? '打印占位齐备' : '打印占位缺失');
}
{
  // 46 打印旧数据守卫：render 早退时置空 lastRenderState（无效输入不再打印旧快照）
  const lrs = html.includes('lastRenderState = null');
  check('46', '1.0.0：render 早退置空 lastRenderState（无效输入不打印旧快照）',
    lrs, lrs ? '打印快照守卫齐备' : 'lastRenderState 置空缺失');
}
{
  // 47 打印分页 + 图表可访问性：break-inside:avoid、max-height、canvas aria-label
  const p47 = html.includes('break-inside:avoid') && html.includes('max-height:170mm') && html.includes('role="img"') && html.includes('aria-label="生存曲线图');
  check('47', '1.0.0：打印分页（break-inside/max-height）+ 图表 aria-label 可访问性',
    p47, p47 ? '打印分页与可访问性齐备' : '分页或 aria 缺失');
}
{
  // 48 焦虑柔化 + 人物叙事衔接 + 序章数据来源
  const p48 = html.includes('如因此感到焦虑或不安，请拨打全国心理援助热线') && html.includes('序章的三位朋友（周平、秦远、林安）代表三种风险态度')
    && html.includes('2022 年中国居民健康素养监测情况');
  check('48', '1.0.0：免责加 12356 + 人物叙事衔接 + 序章数据来源（健康素养监测）',
    p48, p48 ? '柔化/衔接/来源齐备' : '其中一项缺失');
}

{
  // 49 寿命收支账终生期望寿命与显示模式解耦（修复月模式 leAvg 截断放大 ~13 倍）
  const p49 = html.includes('function buildLifespanLedger(age, sex, res, extra){')
    && html.includes('computeSurvival(age, sex, 1, 0, "year", 0)')
    && html.includes('computeSurvival(age, sex, res.coeff, extra, "year", 0)');
  check('49', '1.0.0：寿命收支账终生期望寿命按年模式到 105 岁（与显示模式解耦）',
    p49, p49 ? '解耦正确' : '仍按 mode/maxMonths 计算');
}
{
  // 50 月模式数字卡自适应
  const p50 = html.includes('function monthMarks(age){') && html.includes('mode==="month" ? monthMarks(ageI)');
  check('50', '1.0.0：月模式数字卡/报告表 2 按剩余月数自适应（monthMarks）',
    p50, p50 ? 'monthMarks 齐备' : '月模式 marks 仍固定');
}
{
  // 51 文本摘要：月单位 + extra 输入框 + 综合状态系数
  const p51 = html.includes('m+(st.mode==="month"?"月":"年")')
    && html.includes('额外风险输入框 ')
    && html.includes('你的综合状态系数');
  check('51', '1.0.0：文本摘要修月单位 + 补额外风险输入框 + 综合状态系数命名',
    p51, p51 ? '三处口径齐备' : '文本摘要仍有遗留');
}
{
  // 52 报告输入档案运动 mid 档
  const p52 = html.includes('st.activity==="mid" ? "大致相当"');
  check('52', '1.0.0：报告输入档案运动「大致相当」（mid 档不再误显示未填写）',
    p52, p52 ? '运动档正确' : 'mid 档仍显示未填写');
}
{
  // 53 参考文献去重编号
  const p53 = html.includes('.refs{list-style:none');
  check('53', '1.0.0：参考文献去重编号（.refs 改 list-style:none，避免「1. [1]」双编号）',
    p53, p53 ? '已去重' : '仍双编号');
}
{
  // 54 事件列表数量/单位 + 年单位禁用数量输入
  const p54 = html.includes('const qtyUnit = (e.unit && e.unit!=="年")') && html.includes('inp.disabled = true');
  check('54', '1.0.0：事件列表显示数量/单位 + 「年」单位禁用数量输入',
    p54, p54 ? '齐备' : '事件数量显示或年单位禁用缺失');
}
{
  // 55 第3章提示文案同步 + 报告表4标注
  const p55 = html.includes('默认仅作对比；勾选下方「计入曲线」后才会叠加到这里') && html.includes('事件默认仅作对比、不叠加曲线');
  check('55', '1.0.0：第3章提示文案同步 + 报告表 4 标注「默认不叠加」',
    p55, p55 ? '文案与标注同步' : '文案过时或表4未标注');
}
{
  // 56 includeEvents / lspanUnit 持久化
  const p56 = html.includes('rb_includeEvents') && html.includes('rb_lspanUnit');
  check('56', '1.0.0：includeEvents / lspanUnit 持久化（saveState+loadState）',
    p56, p56 ? '持久化齐备' : '刷新后状态丢失');
}

{
  // 57 发布向：去掉「三审三校 / 质检编号 / 差错率公示」等内部流程词（个人项目改作者自校）
  const p57 = !html.includes('三审三校') && !html.includes('质检报告编号') && !html.includes('DQ-20261110-03')
    && !html.includes('差错率公示') && html.includes('作者自校') && html.includes('多轮独立评审');
  check('57', '发布向：内部流程词（三审三校/质检编号/差错率公示）已移除，统一为作者自校 + 多轮独立评审',
    p57, p57 ? '口径统一' : '内部流程词残留');
}
{
  // 58 renderLifespan 无用参数（mode/maxMonths）已删除
  const p58 = !html.includes('renderLifespan(ageI, sex, res, extra, mode') && html.includes('renderLifespan(ageI, sex, res, extra)');
  check('58', '发布向：renderLifespan 无用参数 mode/maxMonths 已删除',
    p58, p58 ? '参数已清理' : '无用参数残留');
}
{
  // 59 #reportPrintArea 遗留元素已删除（div + CSS 规则）
  const p59 = !html.includes('reportPrintArea');
  check('59', '发布向：#reportPrintArea 遗留元素已彻底删除',
    p59, p59 ? '已删除' : 'reportPrintArea 残留');
}
{
  // 60 长途货运司机：去掉假精确区间 [100,120]，改为「来源分歧 10–50 倍，仅量级参考」
  const p60 = !html.includes('[100,120]') && html.includes('来源分歧 10–50 倍（10–12/10万 至 500/10万）')
    && html.includes('不设精确区间');
  check('60', '发布向：长途货运司机去掉假精确区间，统一「来源分歧 10–50 倍，仅量级参考」',
    p60, p60 ? '区间口径一致' : '假精确区间残留');
}
{
  // 61 全身麻醉 5 vs 10 口径打架：第1章加注说明
  const p61 = html.includes('医学文献口径 10 微死亡/次') && html.includes('与书中的 5 微死亡/次不同');
  check('61', '发布向：全身麻醉 5 vs 10 口径已加注说明',
    p61, p61 ? '口径说明齐备' : '麻醉口径说明缺失');
}
{
  // 62 小趣闻：净偏移改为「各项单独折算的粗略合计」口径（不再误导为总风险偏离）
  const p62 = html.includes('各项单独折算的粗略合计');
  check('62', '发布向：小趣闻净偏移标注「各项单独折算的粗略合计」（避免与综合系数混淆）',
    p62, p62 ? '口径标注齐备' : '粗略合计标注缺失');
}
{
  // 63 美术收敛：删封面算珠串（.cover::before），保留印章（.cover::after）+题额（.cover h1::before/after）；新增未成年人(<18)图表警示徽章
  const beadGone = !html.includes(".cover::before");
  const sealKept = html.includes(".cover::after") && html.includes(".cover h1::before");
  const ageWarn = html.includes('id="ageWarn"') && html.includes("ageI < 18") && html.includes("演示参考：未成年人");
  check('63', '美术收敛：删封面算珠串（.cover::before 移除）、印章/题额保留；未成年人(<18)图表警示徽章存在并在 render 随 ageI<18 显隐',
    beadGone && sealKept && ageWarn,
    `beadGone=${beadGone} sealKept=${sealKept} ageWarn=${ageWarn}`);

  // 64 「年」单位事件可添加：addEvent 对年单位事件 qty 直接取 1，绕过禁用空输入框 parseFloat("")=NaN 的静默返回
  const yearUnitAddable = html.includes('sel.kind==="event" && sel.unit==="年"');
  check('64', '「年」单位事件可添加：addEvent 对年单位事件 qty 直接取 1（不再因禁用空输入框 parseFloat("")=NaN 静默返回）',
    yearUnitAddable,
    `yearUnitAddable=${yearUnitAddable}`);

  // 65 打印页脚：移除无效的 counter(page)/counter(pages)（普通元素 ::after 中不生效，会渲染 0/0），保留署名行
  const pageCounterGone = !html.includes("counter(page)") && html.includes('class="report-foot"');
  check('65', '打印页脚：移除无效的 counter(page)/counter(pages)（普通元素 ::after 中不生效，会渲染 0/0），保留署名行',
    pageCounterGone,
    `pageCounterGone=${pageCounterGone}`);
}

// ---- 汇总 ----
console.log(`\n结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`);
if (fail > 0) {
  console.error('✗ 存在未通过的验收项，请检查 index.html 或规格书。');
  process.exit(1);
} else {
  console.log('✓ 全部验收项通过。');
}
