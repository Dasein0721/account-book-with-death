'use strict';
/* _test_init.js —— 初始化路径冒烟测试（Q-12）
 * verify.js 在第一个顶层初始化调用处截断，DOM 初始化段（渲染、事件绑定、canvas 绘制）
 * 从未被执行。本脚本用更完整的 DOM 桩把整段 <script> 跑到底，断言：
 *   1) 顶层初始化不抛异常；
 *   2) 关键函数与数据已就位（qAt / computeCoefficients / render / EVENTS / VSL）；
 *   3) 初始化过程中有真实写入（某个元素的 innerHTML 被赋值），排除"空跑通过"。
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('✗ 未找到 <script>'); process.exit(2); }
const src = m[1];

let writes = 0;
function ctx2d() {
  const noop = () => {};
  return new Proxy({
    measureText: (t) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: [] }),
    setLineDash: noop,
  }, {
    get(t, k) {
      if (k in t) return t[k];
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const byId = new Map();
function makeEl(id) {
  const el = {
    id: id || '', tagName: 'DIV', value: '', checked: false, disabled: false,
    textContent: '', innerText: '', className: '', htmlFor: '', type: '', name: '',
    width: 880, height: 400, offsetWidth: 800, offsetHeight: 400,
    clientWidth: 800, clientHeight: 400, scrollWidth: 800, scrollHeight: 400,
    style: new Proxy({}, { get: () => '', set: () => true }),
    dataset: {}, children: [], childNodes: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext: () => ctx2d(),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {},
    querySelector: () => makeEl(''), querySelectorAll: () => [],
    closest: () => null, contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 }),
    scrollIntoView() {}, focus() {}, blur() {}, click() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    getElementsByTagName: () => [], getElementsByClassName: () => [],
    cloneNode() { return makeEl(id); }, matches: () => false,
    toDataURL: () => 'data:,',
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html || ''; },
    set(v) { this._html = String(v); writes++; },
  });
  return el;
}
const document = {
  getElementById(id) { if (!byId.has(id)) byId.set(id, makeEl(id)); return byId.get(id); },
  querySelector() { return makeEl(''); },
  querySelectorAll() { return []; },
  createElement(tag) { const e = makeEl(''); e.tagName = String(tag).toUpperCase(); return e; },
  createTextNode(t) { return { textContent: String(t) }; },
  addEventListener() {}, removeEventListener() {},
  documentElement: makeEl('html'), body: makeEl('body'), head: makeEl('head'),
  readyState: 'complete',
};
const storage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const window = {
  devicePixelRatio: 2, localStorage: storage, innerWidth: 1200, innerHeight: 900,
  addEventListener() {}, removeEventListener() {}, scrollTo() {}, print() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  requestAnimationFrame: (f) => { try { f(0); } catch (e) { throw e; } return 1; },
  cancelAnimationFrame() {},
  history: { replaceState() {}, pushState() {} },
  location: { hash: '', href: 'http://x/', reload() {} },
  getComputedStyle: () => ({ getPropertyValue: () => '', fontSize: '14px' }),
};
const sandbox = {
  document, window, localStorage: storage, navigator: { userAgent: 'node' },
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error,
  parseFloat, parseInt, isNaN, isFinite, setTimeout: (f) => 1, clearTimeout() {},
  requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame() {},
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
  getComputedStyle: window.getComputedStyle,
  matchMedia: window.matchMedia,
  alert() {}, confirm: () => true, prompt: () => null,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

let threw = null;
try { vm.runInContext(src, sandbox, { filename: 'index.html:script' }); }
catch (e) { threw = e; }

const pass = [], fail = [];
function check(id, label, ok, detail) {
  (ok ? pass : fail).push(id);
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + id + '  ' + label + (detail ? '  → ' + detail : ''));
}
check('1', '整段 <script> 执行到底，初始化不抛异常', !threw, threw ? (threw && threw.message) : '无异常');
check('2', '计算函数已就位', typeof sandbox.qAt === 'function' && typeof sandbox.computeCoefficients === 'function' && typeof sandbox.render === 'function');
function inCtx(expr, dflt) { try { return vm.runInContext(expr, sandbox); } catch (e) { return dflt; } }
const evN = inCtx('(Array.isArray(EVENTS) ? EVENTS.length : -1)', -1);
const maleN = inCtx('(Array.isArray(MALE) ? MALE.length : -1)', -1);
check('3', '数据已载入（EVENTS / MALE 在脚本词法作用域内可见）', evN > 0 && maleN === 106, 'EVENTS=' + evN + '，MALE=' + maleN);
check('4', '初始化确实写入了 DOM（innerHTML 赋值次数 > 0）', writes > 0, 'innerHTML 写入 ' + writes + ' 次');
const q40 = threw ? NaN : sandbox.qAt(40, 'm');
check('5', 'qAt(40, 男) 返回合理年死亡率（0.0005–0.01）', q40 > 0.0005 && q40 < 0.01, 'q40=' + (q40 * 1000).toFixed(3) + '‰');

console.log('\n结果：' + pass.length + ' 通过 / ' + fail.length + ' 失败（共 ' + (pass.length + fail.length) + ' 条）');
if (fail.length) { console.error('✗ 初始化冒烟未通过。'); process.exit(1); }
console.log('✓ 初始化路径冒烟通过。');
