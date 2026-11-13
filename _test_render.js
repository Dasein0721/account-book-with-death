'use strict';
/* _test_render.js —— 「已填状态下渲染一遍」回归测试（Q-64）
 * 背景：2026-11-13 的 Q-62 注释把 render() 里的 bandN 从块内 const 写成块外引用，
 * 浏览器里 render() 抛 ReferenceError，曲线/寿命账/风险构成全空；verify + init 两套测试都没抓住
 * （init 测试只断言「初始化写了 innerHTML」，而 render 在它之后抛）。
 * 本脚本用严格 DOM 桩（未知 id 返回 null、元素缺方法就报错）灌一份已填数据，跑完整脚本，
 * 再显式调用 render()，断言：不抛异常、canvas 真的画了线、寿命账与数字卡有内容、档案下拉有条目。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = path.join(__dirname, 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  → ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

const stats = { ops: 0, strokes: 0, texts: 0, nan: 0 };
const ctxObj = new Proxy({}, {
  get: (t, k) => {
    if (k === 'measureText') return s => ({ width: String(s).length * 6 });
    if (k === 'canvas') return { width: 860, height: 400 };
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (typeof k !== 'string') return undefined;
    return (...a) => {
      stats.ops++;
      if (k === 'stroke') stats.strokes++;
      if (k === 'fillText' || k === 'strokeText') stats.texts++;
      if (a.some(v => typeof v === 'number' && !isFinite(v))) stats.nan++;
    };
  },
  set: () => true
});
const mk = id => ({
  id, value: '', checked: false, textContent: '', innerHTML: '', disabled: false,
  style: {}, dataset: {}, min: '', max: '', step: '',
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, removeEventListener() {},
  appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {},
  querySelectorAll: () => [], querySelector: () => null, getContext: () => ctxObj,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 860, height: 400 }),
  setAttribute() {}, getAttribute: () => null, removeAttribute() {},
  focus() {}, nextElementSibling: null, parentElement: null, children: [],
  clientWidth: 860, clientHeight: 400, width: 860, height: 400, tagName: 'DIV', nodeType: 1,
  insertAdjacentHTML() {}, contains: () => false, closest: () => null, click() {}
});
const cache = new Map();
const radio = v => { const r = mk('sex-' + v); r.value = v; return r; };
const document = {
  getElementById: id => {
    if (!ids.has(id)) return null;                    // 严格：页面里没有的 id 一律 null
    if (!cache.has(id)) cache.set(id, mk(id));
    return cache.get(id);
  },
  querySelector: sel => sel.indexOf('name=sex') >= 0 ? radio('m') : null,
  querySelectorAll: sel => sel.indexOf('name=sex') >= 0 ? [radio('m'), radio('f')] : [],
  createElement: tag => mk('dyn-' + tag),
  addEventListener() {}, body: mk('body'), documentElement: mk('html'), readyState: 'complete'
};
const store = new Map([
  ['rb_inputs', JSON.stringify({ age: '40', bmi: '26', waist: '92', sbp: '140', glu: '6', ldl: '3.2', hr: '80', sleep: '6', alcohol: '100', smoke: '10', activity: 'low', diet: 'bad', sex: 'm' })],
  ['rb_instances', JSON.stringify([{ name: '甲' }, { name: '乙' }, { name: '丙' }, { name: '丁' }])]
]);
const localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};
const win = {
  document, localStorage, addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  devicePixelRatio: 2, setTimeout: (f, t) => setTimeout(f, t), clearTimeout,
  requestAnimationFrame: f => setTimeout(f, 16),
  print() {}, confirm: () => true,
  ResizeObserver: class { observe() {} disconnect() {} }
};
win.window = win; win.console = console;
const sandbox = Object.assign(Object.create(null), win, {
  Math, JSON, Date, Object, Array, String, Number, RegExp, parseFloat, parseInt, isNaN, isFinite
});
vm.createContext(sandbox);

console.log('_test_render.js —— 已填状态渲染回归');
let initErr = null;
try { vm.runInContext(script, sandbox, { filename: 'index.html' }); }
catch (e) { initErr = e; }
ok('1  顶层初始化不抛异常', !initErr, initErr ? initErr.message : '无异常');

// 直接把输入框填上（不依赖 loadState 的存储键实现细节），确保走到「有系数、有不确定带」的分支
const F = { age:'40', bmi:'26', waist:'92', sbp:'140', glu:'6', ldl:'3.2', hr:'80', sleep:'6', alcohol:'100', smoke:'10' };
Object.keys(F).forEach(k => { const el = document.getElementById(k); if (el) el.value = F[k]; });
const actEl = document.getElementById('activity'); if (actEl) actEl.value = 'low';
const dietEl = document.getElementById('diet'); if (dietEl) dietEl.value = 'bad';

let renderErr = null;
const before = stats.ops;
try { sandbox.render(); } catch (e) { renderErr = e; }
ok('2  已填状态下 render() 不抛异常', !renderErr, renderErr ? renderErr.message : '无异常');

ok('3  canvas 有绘制调用（≥100 次操作）', stats.ops - before >= 100, (stats.ops - before) + ' 次');
ok('4  曲线真的描了线（≥1 次 stroke）', stats.strokes >= 1, stats.strokes + ' 次');
ok('5  没有非有限坐标（NaN/Infinity）', stats.nan === 0, stats.nan + ' 个');

const led = document.getElementById('lspanLedger').innerHTML;
ok('6  寿命收支表有内容且无 NaN', led.length > 200 && led.indexOf('NaN') < 0, led.length + ' 字符');
const nums = document.getElementById('nums').innerHTML;
ok('7  数字卡有百分比且无 NaN', nums.indexOf('%') >= 0 && nums.indexOf('NaN') < 0, nums.length + ' 字符');
const warns = document.getElementById('warnings').innerHTML;
ok('9  系数不确定带提示语已渲染（band 分支走到）', warns.indexOf('次蒙特卡洛抽样') >= 0, warns.length + ' 字符');
const inst = document.getElementById('instSelect').innerHTML;
ok('10 档案下拉载入 4 条已存档案', (inst.match(/<option/g) || []).length >= 4, (inst.match(/<option/g) || []).length + ' 条');

// 11：清空年龄后 render() 走提前返回分支，上一次的风险构成必须被清掉（Q-75）
document.getElementById('age').value = '';
let clearErr = null;
try { sandbox.render(); } catch (e) { clearErr = e; }
const rp = document.getElementById('riskProfile').innerHTML;
ok('11 清空年龄后旧的风险构成被清掉', !clearErr && rp.indexOf('填好年龄与性别后') >= 0, clearErr ? clearErr.message : rp.length + ' 字符');

// 12：事件著录面板靠 class 展开（Q-98）——旧写法 style.display="" 压不过样式表里的 .lou{display:none}，面板永远打不开
const louSet = new Set(['lou']);   // toggleEventLou 会先校验 class 里有 "lou"
const fakeLou = { classList: { contains: k => louSet.has(k), add: k => louSet.add(k), remove: k => louSet.delete(k),
  toggle: (k, on) => { const v = (on === undefined) ? !louSet.has(k) : !!on; v ? louSet.add(k) : louSet.delete(k); return v; } } };
const fakeRow = { nextElementSibling: fakeLou, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; } };
let louErr = null;
try { sandbox.toggleEventLou(fakeRow); } catch (e) { louErr = e; }
const openOk = !louErr && louSet.has('open') && fakeRow.attrs['aria-expanded'] === 'true';
try { sandbox.toggleEventLou(fakeRow); } catch (e) { louErr = e; }
const closeOk = !louErr && !louSet.has('open') && fakeRow.attrs['aria-expanded'] === 'false';
ok('12 著录面板按 class 展开/收起并同步 aria-expanded', openOk && closeOk, louErr ? louErr.message : 'open=' + openOk + '，close=' + closeOk);

// 13/14：模块化（Q-117）后，Report 仍能由 render() 的快照生成、Chart 暴露绘制 API
document.getElementById('age').value = '40'; sandbox.render();
let repTxt = '', modErr = null;
try { repTxt = vm.runInContext('Report.build()', sandbox); } catch (e) { modErr = e; }
ok('13 报告模块能由最新快照生成且无 NaN', !modErr && repTxt.indexOf('输入档案') >= 0 && repTxt.indexOf('NaN') < 0, modErr ? modErr.message : repTxt.length + ' 字符');
let chartApi = '';
try { chartApi = vm.runInContext('typeof Chart.draw + "/" + typeof Chart.geom + "/" + typeof Chart.attachPointer', sandbox); } catch (e) { chartApi = 'ERR ' + e.message; }
ok('14 Chart 模块暴露 draw/geom/attachPointer', chartApi === 'function/function/function', chartApi);

// 15：空态下容器变宽（resize/转屏）时，canvas 缓冲必须先跟随新宽度再画占位；
// 否则占位文字按旧缓冲的坐标画，会偏心，右侧还会残留上一帧（第六份外审 #1）
document.getElementById('age').value = '';
sandbox.render();                                   // 回到空态（占位）
const cw = document.getElementById('chartWrap');
cw.clientWidth = 500;                               // 模拟容器从 860 缩到 500
const cvEl = document.getElementById('chart');
let resizeErr = null;
try { sandbox.chartRedraw(); } catch (e) { resizeErr = e; }
ok('15 空态 resize 后 canvas 缓冲跟随新宽度', !resizeErr && cvEl.width === Math.round(500 * 2),
  resizeErr ? resizeErr.message : ('width=' + cvEl.width + '，期望 ' + Math.round(500 * 2)));

// 16：90 岁后 SR 描述不能是空串（第七份外审）——旧实现只列 50–90，高龄用户失去图表描述
document.getElementById('age').value = '95';
let srErr = null;
try { sandbox.render(); } catch (e) { srErr = e; }
const srTxt = document.getElementById('chartSr').textContent;
ok('16 高龄（95 岁）图表的屏幕阅读器描述仍有关键年龄', !srErr && srTxt.indexOf('100 岁') >= 0 && srTxt.indexOf('105 岁') >= 0,
  srErr ? srErr.message : srTxt);

// 17：事件行 aria-controls 必须指向真实存在的著录面板 id（第七份外审）
let evHtml = '', evErr = null;
try {
  vm.runInContext('eventList = [{kind:"event",name:"一氧化碳中毒",value:1,unit:"年",perYearMicromort:8.65}]', sandbox);
  vm.runInContext('renderEvents()', sandbox);
  evHtml = document.getElementById('evList').innerHTML;
} catch (e) { evErr = e; }
const ctrl = (evHtml.match(/aria-controls="(lou-[^"]+)"/) || [])[1] || '';
ok('17 事件行 aria-controls 指向存在的著录面板', !evErr && !!ctrl && evHtml.indexOf('id="' + ctrl + '"') >= 0,
  evErr ? evErr.message : (ctrl || '未生成 aria-controls'));

// 18：二次 tap 后必须重新上锁，否则 pointermove 的 touch 分支会直接 return（第八份外审）
let touchErr = null, touchLocked = false;
try {
  const cv = document.getElementById('chart');
  const handlers = {};
  cv.addEventListener = (type, fn) => { handlers[type] = fn; };
  vm.runInContext('Chart.attachPointer()', sandbox);
  vm.runInContext('lastBubble.active=true; lastBubble.locked=false; lastBubble.hideTimer=null;', sandbox);
  handlers.pointerdown({ pointerType:'touch', pointerId:1, clientX:100, clientY:100 });
  touchLocked = vm.runInContext('lastBubble.locked', sandbox);
} catch (e) { touchErr = e; }
ok('18 二次 tap 后气泡仍可拖动', !touchErr && touchLocked === true,
  touchErr ? touchErr.message : ('locked=' + touchLocked));

// 19：导入的旧备份可能带越界 coefIdx，刷新时不能把整页打崩（第八份外审）
let coefErr = null, coefVal = null;
try {
  vm.runInContext('eventList=[{kind:"coef",name:"坏索引",value:1,unit:"",coefIdx:99,perYearMicromort:123}]; refreshCoefEntries();', sandbox);
  coefVal = vm.runInContext('eventList[0].perYearMicromort', sandbox);
} catch (e) { coefErr = e; }
ok('19 越界 coefIdx 不崩溃且保留原值', !coefErr && coefVal === 123,
  coefErr ? coefErr.message : ('perYearMicromort=' + coefVal));

// 20：事件 unit 来自可导入的备份，必须转义（第八份外审）
let unitErr = null, unitHtml = '';
try {
  vm.runInContext('eventList=[{kind:"event",name:"测试",value:1,unit:"<img src=x onerror=alert(1)>",perYearMicromort:1}]; renderEvents();', sandbox);
  unitHtml = document.getElementById('evList').innerHTML;
} catch (e) { unitErr = e; }
ok('20 事件 unit 已转义', !unitErr && unitHtml.indexOf('&lt;img') >= 0 && unitHtml.indexOf('<img src=x') < 0,
  unitErr ? unitErr.message : (unitHtml.indexOf('&lt;img') >= 0 ? 'escaped' : 'not escaped'));

// 21：100 岁对照不应重复显示 10/20/30 年（都会落到 105 岁末元素）（第八份外审）
let cmpErr = null, cmpTxt = '';
try {
  vm.runInContext('instances=[{name:"百岁",sex:"m",inputs:{age:"100"},events:[]}]; const sel=$("cmpInst"); sel.value="百岁"; renderCompare(40,"m");', sandbox);
  cmpTxt = document.getElementById('cmpOut').textContent;
} catch (e) { cmpErr = e; }
ok('21 高龄对照不再重复 10/20/30 年', !cmpErr && cmpTxt.indexOf('至 105 岁（5 年后）') >= 0 && cmpTxt.indexOf('30 年后') < 0,
  cmpErr ? cmpErr.message : cmpTxt);

// 22：月模式的 base.t 是月数，不能再拿年龄差当数组下标（第九份外审）
let monthErr = null, monthSr = '';
try {
  document.getElementById('age').value = '40';
  vm.runInContext('mode = "month"; render();', sandbox);
  monthSr = document.getElementById('chartSr').textContent;
  vm.runInContext('mode = "year";', sandbox);
} catch (e) { monthErr = e; }
ok('22 月模式图表描述按未来月数取点', !monthErr && monthSr.indexOf('未来 12 月') >= 0 && monthSr.indexOf('未来 36 月') >= 0,
  monthErr ? monthErr.message : monthSr);

// 23：对照档案的系数缓存只按「性别 + 输入」记，τ 变了仍返回旧系数（第十份外审）
let tauErr = null, tauA = null, tauB = null;
try {
  const tauInst = { name: 'τ测试', sex: 'm', inputs: { age: '60', bmi: '30', waist: '100', sbp: '160', glu: '7', ldl: '4', hr: '80', sleep: '7', alcohol: '0', smoke: '0', activity: 'low' } };
  vm.runInContext('tau = 0.9; INST_COEFF_CACHE.clear();', sandbox);
  tauA = vm.runInContext('instCoeff(' + JSON.stringify(tauInst) + ').coeff', sandbox);
  vm.runInContext('tau = 1.9;', sandbox);
  tauB = vm.runInContext('instCoeff(' + JSON.stringify(tauInst) + ').coeff', sandbox);
  vm.runInContext('tau = TAU_DEFAULT;', sandbox);
} catch (e) { tauErr = e; }
ok('23 对照系数缓存随 τ 失效', !tauErr && Math.abs(tauA - tauB) > 1e-6,
  tauErr ? tauErr.message : ('τ=0.9 → ' + tauA + '，τ=1.9 → ' + tauB));

// 24：年模式下 maxMonths 不参与计算，改「查询未来 N 年」不应让 MC 带缓存键变化并重跑（第十一份外审）
let bandKeyErr = null, bandKeyA = '', bandKeyB = '';
try {
  const setVal = (id, v) => { document.getElementById(id).value = v; };
  setVal('age', '40'); setVal('bmi', '30'); setVal('sbp', '160'); setVal('queryN', '10');
  vm.runInContext('mode = "year"; render();', sandbox);
  bandKeyA = vm.runInContext('bandCacheKey', sandbox);
  setVal('queryN', '60');
  vm.runInContext('render();', sandbox);
  bandKeyB = vm.runInContext('bandCacheKey', sandbox);
} catch (e) { bandKeyErr = e; }
ok('24 年模式查询年数不使 MC 带缓存失效', !bandKeyErr && !!bandKeyA && bandKeyA === bandKeyB,
  bandKeyErr ? bandKeyErr.message : ('键一致=' + (bandKeyA === bandKeyB) + '；键头=' + String(bandKeyA).slice(0, 60)));

// 25：月模式气泡年龄不能带长小数（内部审查 P3）——t=10 月 = 30.8333… 岁，显示应取一位
let bubbleErr = null, bubbleTxt = '';
try {
  document.getElementById('age').value = '30';
  vm.runInContext('mode = "month"; render(); lastBubble.active = true; lastBubble.t = 10; Chart.refreshBubble();', sandbox);
  bubbleTxt = document.getElementById('chartBubble').innerHTML;
} catch (e) { bubbleErr = e; }
ok('25 月模式气泡年龄取一位小数', !bubbleErr && bubbleTxt.indexOf('30.8 岁') >= 0 && !/30\.8333/.test(bubbleTxt),
  bubbleErr ? bubbleErr.message : bubbleTxt.slice(0, 80));

// 26：背景年风险必须用 PH 换算，不能线性 q×coeff（内部审查 P2：100 岁 ×2.01 曾显示 102.5%）
let bgErr = null, bgVal = 0, bgPh = 0;
try {
  bgVal = vm.runInContext('bgMicromort(100, "m", 2.0129)', sandbox);
  const q = vm.runInContext('qAt(100, "m")', sandbox);
  bgPh = (1 - Math.pow(1 - q, 2.0129)) * 1e6;
} catch (e) { bgErr = e; }
ok('26 背景年风险不超过 100% 且与 PH 一致', !bgErr && bgVal <= 1e6 && Math.abs(bgVal - bgPh) < 1,
  bgErr ? bgErr.message : ('bg=' + bgVal.toFixed(1) + '，PH=' + bgPh.toFixed(1)));

// 27：清空当前填写不能把空值回写已存档案（内部审查 P1）——确认框承诺「已存档案不受影响」
let clearAllErr = null, archiveAfter = null, curAfter = null, selectAfter = null;
try {
  vm.runInContext('instances = [{name:"甲",sex:"m",inputs:{age:"50"},events:[]}]; curInstName="甲"; saveInstances();', sandbox);
  document.getElementById('instSelect').value = '甲';   // 模拟清空前下拉正显示「甲」
  vm.runInContext('clearAll();', sandbox);
  const after = JSON.parse(store.get('rb_instances'));
  archiveAfter = after[0] && after[0].inputs && after[0].inputs.age;
  curAfter = vm.runInContext('curInstName', sandbox);
  selectAfter = document.getElementById('instSelect').value;
} catch (e) { clearAllErr = e; }
ok('27 清空填写不覆盖已存档案且下拉复位', !clearAllErr && archiveAfter === '50' && curAfter === null && selectAfter === '',
  clearAllErr ? clearAllErr.message : ('档案年龄=' + archiveAfter + '，curInstName=' + curAfter + '，下拉=' + selectAfter));

// 28：可展开事件行必须用真正的 button，不能让 div[role=button] 包着删除 button（UX 盲审 P2）
let evA11yErr = null, evA11yHtml = '';
try {
  vm.runInContext('eventList=[{kind:"event",name:"一氧化碳中毒",value:1,unit:"年",perYearMicromort:8.65}]; renderEvents();', sandbox);
  evA11yHtml = document.getElementById('evList').innerHTML;
} catch (e) { evA11yErr = e; }
ok('28 事件展开行是真实按钮且删除按钮同级',
  !evA11yErr && evA11yHtml.indexOf('role="button"') < 0 && evA11yHtml.indexOf('class="ev-main"') >= 0 && evA11yHtml.indexOf('class="x"') >= 0,
  evA11yErr ? evA11yErr.message : evA11yHtml.slice(0, 90));

// 29：示例卡展开后必须让读屏知道状态与对应故事（UX 盲审 P3）
const exA11yHtml = document.getElementById('exampleCards').innerHTML;
ok('29 示例卡展开按钮带 aria-expanded/aria-controls',
  exA11yHtml.indexOf('aria-expanded="false"') >= 0 && exA11yHtml.indexOf('aria-controls="ex-story-') >= 0,
  'aria-expanded=' + (exA11yHtml.indexOf('aria-expanded="false"') >= 0) + '，aria-controls=' + (exA11yHtml.indexOf('aria-controls="ex-story-') >= 0));

// 30：坏 rb_events 只应丢事件，不能让后面的 τ / 勾选 / 单位恢复整段跳过（内部审查 P3 补漏）
let evLoadErr = null, tauAfterBadEvents = null;
try {
  store.set('rb_events', '{bad');
  store.set('rb_tau', '1.7');
  vm.runInContext('tau = TAU_DEFAULT; loadState();', sandbox);
  tauAfterBadEvents = vm.runInContext('tau', sandbox);
} catch (e) { evLoadErr = e; }
ok('30 坏事件 JSON 不阻断 τ 恢复', !evLoadErr && tauAfterBadEvents === 1.7,
  evLoadErr ? evLoadErr.message : ('τ=' + tauAfterBadEvents));

// 31：档案名可含竖线，join("|") 会把两组不同名字撞成同一签名，对照下拉不再重建（内部审查 P3 补漏）
let cmpSigErr = null, cmpHtmlA = '', cmpHtmlB = '';
try {
  vm.runInContext('instances=[{name:"a|b",sex:"m",inputs:{age:"50"},events:[]},{name:"c",sex:"m",inputs:{age:"50"},events:[]}]; renderCompare(40,"m");', sandbox);
  cmpHtmlA = document.getElementById('cmpInst').innerHTML;
  vm.runInContext('instances=[{name:"a",sex:"m",inputs:{age:"50"},events:[]},{name:"b|c",sex:"m",inputs:{age:"50"},events:[]}]; renderCompare(40,"m");', sandbox);
  cmpHtmlB = document.getElementById('cmpInst').innerHTML;
} catch (e) { cmpSigErr = e; }
ok('31 含竖线的档案名不会撞对照签名', !cmpSigErr && cmpHtmlA !== cmpHtmlB && cmpHtmlB.indexOf('b|c') >= 0,
  cmpSigErr ? cmpSigErr.message : ('重建=' + (cmpHtmlA !== cmpHtmlB)));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败（共 ' + (pass + fail) + ' 条）');
process.exit(fail === 0 ? 0 : 1);