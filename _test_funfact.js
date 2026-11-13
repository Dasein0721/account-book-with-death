/*
 * _test_funfact.js —— 「换算」小趣闻回归测试（⑧ VSL 趣闻固定保守口径）
 *
 * 用法：node _test_funfact.js（或 npm test）
 *
 * 与 verify.js 同一套沙箱方案：把 index.html 的 <script> 原样加载进 Node 沙箱，
 * 截断顶层初始化调用，直接调用真实 renderFunFact()，断言 ⑧ 修复项：
 *   a. 主句金额统一用 vsalFor() 保守口径（GUO X Q 1998，1 微死亡 ¥3.28），与列表 yuanText 一致；
 *   b. 随机研究只作背景，且带方法类型标签（市场行为（工资补偿）/ 个人意愿（问卷））；
 *   c. 尾注按单篇文献报数（「按这篇算则是 ¥X」），不合成 24 项的中位数/区间定位；
 *   d. 「换一条」只换背景研究（Math.random 变化 → 文本变化），主句金额 ¥3.28 口径不变。
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

// 与 verify.js 相同：在第一个顶层初始化调用前截断（renderFunFact / vsalFor / VSL 均已定义在截断点之前）。
const cutAt = src.indexOf('\nrenderEventSelect();');
if (cutAt === -1) {
  console.error('✗ 未找到顶层初始化调用标记 renderEventSelect();，index.html 结构可能已变化');
  process.exit(2);
}
const core = src.slice(0, cutAt);

// ---- 最小 DOM 桩 ----
function makeEl() {
  return {
    addEventListener() {}, removeEventListener() {},
    value: '', checked: false, innerHTML: '', textContent: '',
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    focus() {}, click() {}, blur() {},
    setAttribute() {}, removeAttribute() {},
    options: [], selectedIndex: 0,
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

// ---- Math 桩：random 由测试侧可变的 rndVal 控制，其余方法继承自宿主 Math ----
let rndVal = 0.1;
const mathStub = Object.create(Math);
mathStub.random = () => rndVal;

const sandbox = {
  document,
  localStorage,
  Math: mathStub,
  console,
  setTimeout: () => 0,
  clearTimeout() {},
  window: { devicePixelRatio: 1, localStorage, addEventListener() {} },
};
vm.createContext(sandbox);

const wrapped = '(function(){\n' + core + '\nreturn { VSL, vsalFor, renderFunFact, yuanText,' +
  ' setFunFactNetMM(n){ funFactNetMM = n; }, getFunFactNetMM(){ return funFactNetMM; },' +
  ' resetFunFactPick(){ funFactPick = null; } };\n})()';

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

console.log('「换算」小趣闻回归（优化问题清单 ⑧）\n');

const funFactEl = elStub;   // $("funFact") 经 document.getElementById 返回 elStub

// ---- a. 主句金额 = 净偏移 × ¥3.28（保守口径），与列表 yuanText 同口径 ----
{
  api.setFunFactNetMM(100);
  rndVal = 0.1;
  api.renderFunFact();
  const h = funFactEl.innerHTML;
  const mm = parseFloat((h.match(/值 ¥([\d.]+)/) || [0, '0'])[1]);
  const want = '¥' + Math.round(100 * mm);
  check('a1', '净偏移 100 微死亡 → 主句金额 = 100 × 本篇折算价（¥' + mm + ' → ' + want + '）',
    mm > 0 && h.indexOf(want) !== -1, '本篇 ¥' + mm + '，期望 ' + want);
  check('a2', '尾注声明「本句按这一篇的折算价」并给出该篇单价',
    h.indexOf('本句按这一篇的折算价 ¥' + mm + '/微死亡') !== -1);
  api.setFunFactNetMM(0);
  rndVal = 0.1;
  api.renderFunFact();
  const h0 = funFactEl.innerHTML;
  check('a3', '净偏移 0 → 主句「没啥差别」，不出现金额',
    h0.indexOf('没啥差别') !== -1 && h0.indexOf('¥328') === -1);
}

// ---- b. 随机研究仅作背景，带方法类型标签 ----
{
  api.setFunFactNetMM(100);
  rndVal = 0.1;
  api.renderFunFact();
  const h = funFactEl.innerHTML;
  const hasType = h.indexOf('市场行为（工资补偿）') !== -1 || h.indexOf('个人意愿（问卷）') !== -1;
  check('b', '背景研究带方法类型标签（市场行为（工资补偿）/ 个人意愿（问卷））',
    hasType && h.indexOf('口径：') !== -1);
}

// ---- c. 尾注按单篇报数、不再合成中位数（2026-11-13 改：24 项来自两种方法，混算中位数无意义）----
{
  api.setFunFactNetMM(100);
  rndVal = 0.1;
  api.renderFunFact();
  const h = funFactEl.innerHTML;
  check('c', '尾注按单篇报数、并说明与「风险构成」口径不同；不出现「中位约/这篇属于」合成定位句',
    h.indexOf('本句按这一篇的折算价') !== -1 &&
    h.indexOf('每一行按各自领域的代表研究折算') !== -1 &&
    h.indexOf('中位约') === -1 &&
    h.indexOf('这篇属于') === -1);
}

// ---- d. 同一状态重复 render 不重抽；「换一条」才换研究 ----
{
  api.setFunFactNetMM(100);
  rndVal = 0.0;
  api.renderFunFact();
  const h1 = funFactEl.innerHTML;
  rndVal = 0.99;
  api.renderFunFact();                   // 拖动滑块时的重复 render：缓存命中，不应换研究
  const hCached = funFactEl.innerHTML;
  api.resetFunFactPick();                // 点「换一条」：清缓存后重抽
  rndVal = 0.99;
  api.renderFunFact();
  const h2 = funFactEl.innerHTML;
  const selfOk = (x) => {
    const m = parseFloat((x.match(/值 ¥([\d.]+)/) || [0, '0'])[1]);
    return m > 0 && x.indexOf('¥' + Math.round(100 * m)) !== -1;
  };
  check('d', '同一状态重复 render 不换研究（拖动不闪）；「换一条」后才换，两次金额各自自洽',
    h1 === hCached && h1 !== h2 && selfOk(h1) && selfOk(h2),
    `缓存命中=${h1 === hCached}，换一条后变化=${h1 !== h2}，自洽=${selfOk(h1)}/${selfOk(h2)}`);
}

// ---- 汇总 ----
console.log(`\n结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`);
if (fail > 0) {
  console.error('✗ 存在未通过的回归项，请检查 index.html。');
  process.exit(1);
} else {
  console.log('✓ 小趣闻回归全部通过。');
}
