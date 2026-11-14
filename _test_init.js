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
const hiddenToggles = [];   // 记录 instLoadCard 的 hidden 切换方向
const evToolsToggles = [];  // 记录 evTools 的 hidden 切换方向
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
    classList: {
      add() {}, remove() {},
      toggle(c, force) { if (id === 'instLoadCard' && c === 'hidden') hiddenToggles.push(force); if (id === 'evTools' && c === 'hidden') evToolsToggles.push(force); },
      contains() { return false; },
    },
    getContext: () => ctx2d(),
    addEventListener(type, fn) { (this._ev || (this._ev = {}))[type] = fn; },
    removeEventListener() {}, dispatchEvent() {},
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
  addEventListener() {}, removeEventListener() {}, scrollTo() {}, print() {}, confirm: () => true,
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
check('6', '无档案时档案卡仍显示，便于直接存第一份', !hiddenToggles.includes(true), 'hidden 切换=' + JSON.stringify(hiddenToggles));
check('7', '空事件列表时「换一批参照」禁用', byId.get('eqShuffle').disabled === true, 'disabled=' + byId.get('eqShuffle').disabled);
check('8', '空事件列表时事件工具隐藏', evToolsToggles.includes(true), 'hidden 切换=' + JSON.stringify(evToolsToggles));
const saveFail = inCtx(`(function(){
  const s=localStorage.setItem;
  localStorage.setItem=function(k,v){ if(k==="rb_instances") throw new Error("quota"); return s.call(localStorage,k,v); };
  let r; try{ r=saveInstances(); }catch(e){ r="threw"; }
  localStorage.setItem=s;
  return r;
})()`, "missing");
check('9', '档案写入失败时 saveInstances 返回 false 且不抛', saveFail === false, '返回=' + saveFail);
const norm = inCtx(`(function(){
  localStorage.setItem("rb_instances", JSON.stringify([
    {name:"",sex:"m",inputs:{age:"30"},events:[]},
    {name:"A",sex:"m",inputs:{age:"40"},events:[]},
    {name:"A",sex:"f",inputs:{age:"41"},events:[]}
  ]));
  loadInstances();
  const out={n:StoreState.instances.length,name:StoreState.instances[0]&&StoreState.instances[0].name,age:StoreState.instances[0]&&StoreState.instances[0].inputs.age};
  localStorage.removeItem("rb_instances"); localStorage.removeItem("rb_curInst");
  return out;
})()`, null);
check('10', '空名档案被清掉，重名档案保留最后一条', norm && norm.n===1 && norm.name==='A' && norm.age==='41', JSON.stringify(norm));
const lockedRaw = inCtx(`(function(){
  localStorage.removeItem("rb_inputs");
  ioLocked=true; const el=document.getElementById("age"); el.value="40"; saveState(); ioLocked=false;
  return localStorage.getItem("rb_inputs");
})()`, "missing");
check('11', '清除/导入期间自动保存被冻结', lockedRaw === null, 'rb_inputs=' + lockedRaw);
check('12', '无档案时「删除」不可点', byId.get('instDelete').disabled === true, 'disabled=' + byId.get('instDelete').disabled);
const delRollback = inCtx(`(function(){
  StoreState.instances=[{name:"A",sex:"m",inputs:{age:"40"},events:[]},{name:"B",sex:"f",inputs:{age:"50"},events:[]}];
  const sel=document.getElementById("instSelect"); sel.value="B";
  const btn=document.getElementById("instDelete");
  const orig=localStorage.setItem;
  localStorage.setItem=function(k,v){ if(k==="rb_instances") throw new Error("quota"); return orig.call(localStorage,k,v); };
  try{ btn._ev.click(); } finally { localStorage.setItem=orig; }
  return {n:StoreState.instances.length, names:StoreState.instances.map(i=>i.name).join(",")};
})()`, null);
check('13', '删除失败时档案按原索引插回', delRollback && delRollback.n===2 && delRollback.names==="A,B", JSON.stringify(delRollback));
const saveRollback = inCtx(`(function(){
  StoreState.instances=[];
  document.getElementById("instName").value="X";
  document.getElementById("age").value="40";
  const btn=document.getElementById("instSaveAs");
  const orig=localStorage.setItem;
  localStorage.setItem=function(k,v){ if(k==="rb_instances") throw new Error("quota"); return orig.call(localStorage,k,v); };
  try{ btn._ev.click(); } finally { localStorage.setItem=orig; }
  return {n:StoreState.instances.length, msg:document.getElementById("instHint").textContent};
})()`, null);
check('14', '存为档案失败时不留下内存档案并明确提示', saveRollback && saveRollback.n===0 && saveRollback.msg.indexOf("未保存") >= 0, JSON.stringify(saveRollback));
const recovered = inCtx(`(function(){
  ioLocked=true;
  const b=document.getElementById("ioRecover"); b._ev.click();
  return ioLocked;
})()`, "missing");
check('15', '「恢复自动保存」能解除 ioLocked', recovered === false, 'ioLocked=' + recovered);
const corruptStart = hiddenToggles.length;
inCtx('localStorage.setItem("rb_instances","{bad"); loadInstances(); renderInstSelect();', null);
const corruptVisible = hiddenToggles[corruptStart] === false;
const corruptHint = byId.get('instHint').textContent;
inCtx('localStorage.removeItem("rb_instances"); localStorage.removeItem("rb_instances_corrupt"); StoreState.instances=[]; renderInstSelect();', null);
check('16', '坏档案时「已存档案」卡保持可见并说明留底', corruptVisible && corruptHint.indexOf("rb_instances_corrupt") >= 0, 'visible=' + corruptVisible + '，hint=' + corruptHint);

const clamped = inCtx(`(function(){
  const a=document.getElementById("age"), b=document.getElementById("bmi");
  a.min="0"; a.max="100"; b.min="15"; b.max="35";
  localStorage.setItem("rb_inputs", JSON.stringify({age:"999", bmi:"99", sex:"m"}));
  loadState();
  return {age: a.value, bmi: b.value};
})()`, null);
check('17', '恢复超范围输入时按控件边界 clamp', clamped && clamped.age === "100" && clamped.bmi === "35",
  JSON.stringify(clamped));

const roundTrip = inCtx(`(function(){
  document.getElementById("age").value="40";
  StoreState.eventList=[{kind:"event",name:"测试",value:1,unit:"年",perYearMicromort:1}];
  const a=collectState();
  applyState(a);
  const b=collectState();
  const strip = arr=>arr.map(e=>{ const {key, ...rest}=e; return rest; });
  return {same:a.sex===b.sex && a.inputs.age===b.inputs.age && JSON.stringify(strip(a.events))===JSON.stringify(strip(b.events)), a:a, b:b};
})()`, false);
check('18', 'collectState/applyState 一次往返保持同一状态', roundTrip && roundTrip.same === true, JSON.stringify(roundTrip));

console.log('\n结果：' + pass.length + ' 通过 / ' + fail.length + ' 失败（共 ' + (pass.length + fail.length) + ' 条）');
if (fail.length) { console.error('✗ 初始化冒烟未通过。'); process.exit(1); }
console.log('✓ 初始化路径冒烟通过。');
