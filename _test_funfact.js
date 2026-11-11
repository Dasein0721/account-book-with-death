/*
 * _test_funfact.js —— 「换算」小趣闻回归测试（⑧ VSL 趣闻固定保守口径）
 *
 * 用法：node _test_funfact.js（或 npm test）
 *
 * 与 verify.js 同一套沙箱方案：把 index.html 的 <script> 原样加载进 Node 沙箱，
 * 截断顶层初始化调用，直接调用真实 renderFunFact()，断言 ⑧ 修复项：
 *   a. 主句金额统一用 vsalFor() 保守口径（GUO X Q 1998，1 微死亡 ¥3.28），与列表 yuanText 一致；
 *   b. 随机研究只作背景，且带方法类型标签（市场行为（工资补偿）/ 个人意愿（问卷））；
 *   c. 区间定位句「24 篇折算价 ¥0.12–9.75，中位约 ¥3.8，这篇属于偏高/偏低/接近中位」；
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
  ' setFunFactNetMM(n){ funFactNetMM = n; }, getFunFactNetMM(){ return funFactNetMM; } };\n})()';

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
  check('a1', '净偏移 100 微死亡 → 主句金额 ¥328（100 × 3.28 固定保守口径）',
    h.indexOf('¥328') !== -1, h.match(/¥\d{3}/) ? h.match(/¥\d{3}/)[0] : '未找到金额');
  const s0 = api.vsalFor();
  check('a2', '主句注明保守口径 ¥3.28（vsalFor = GUO X Q 1998，1 微死亡 ¥3.28）',
    h.indexOf('¥3.28') !== -1 && s0.author === 'GUO X Q' && s0.year === 1998 &&
    Math.abs(s0.mm - 3.28) < 1e-9,
    `vsalFor()=${s0.author} ${s0.year}，1 微死亡 ¥${s0.mm}`);
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

// ---- c. 区间定位句 ----
{
  api.setFunFactNetMM(100);
  rndVal = 0.1;
  api.renderFunFact();
  const h = funFactEl.innerHTML;
  check('c', '区间定位句「24 篇折算价 ¥0.12–9.75，中位约 ¥3.8，这篇属于…」',
    h.indexOf('24 篇折算价 ¥0.12–9.75') !== -1 &&
    h.indexOf('中位约 ¥3.8') !== -1 &&
    h.indexOf('这篇属于') !== -1);
}

// ---- d. 「换一条」只换背景，主句金额不变 ----
{
  api.setFunFactNetMM(100);
  rndVal = 0.0;
  api.renderFunFact();
  const h1 = funFactEl.innerHTML;
  rndVal = 0.99;
  api.renderFunFact();
  const h2 = funFactEl.innerHTML;
  check('d', '两次不同 Math.random → 背景研究变化（文本不同），主句金额 ¥328 不变',
    h1 !== h2 && h1.indexOf('¥328') !== -1 && h2.indexOf('¥328') !== -1,
    `h1!==h2=${h1 !== h2}，两次主句均含 ¥328=${h1.indexOf('¥328') !== -1 && h2.indexOf('¥328') !== -1}`);
}

// ---- 汇总 ----
console.log(`\n结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`);
if (fail > 0) {
  console.error('✗ 存在未通过的回归项，请检查 index.html。');
  process.exit(1);
} else {
  console.log('✓ 小趣闻回归全部通过。');
}
