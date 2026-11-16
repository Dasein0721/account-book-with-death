# 与死神的账本

把日常风险换算成同一把尺子——**微死亡**（micromort，1 µmort = 1/1,000,000 的死亡概率），并允许读者填自己的年龄、性别和九项健康指标，得到个人生存曲线、寿命账本与"少一个微死亡值多少钱"。

成品是一个**单文件离线网页**：`index.html`，4,246 行、约 310 KB，HTML + CSS + JS 全部内联。双击即用，无构建步骤、零运行时依赖、不发任何网络请求。

- 读者入口：打开页面，按章节往下读；第 2 章是计算器。
- 开发者入口：下面 [快速开始](#快速开始) / [代码结构](#代码结构) / [测试](#测试) / [已知限制](#已知限制)。

## 快速开始

```bash
git clone https://github.com/Dasein0721/account-book-with-death.git
cd account-book-with-death
open index.html          # macOS；Windows 双击，Linux 用 xdg-open
```

不联网、不安装、不注册。数据只写在本机 `localStorage`。

跑自检需要 Node ≥ 18（脚本用 `vm` + 手写 DOM 桩，无第三方依赖）：

```bash
npm test        # verify 40 + funfact 6 + init 18 + render 44 = 108 条断言
npm run check   # 上面这些 + lint（109 个 id / 31 个控件可达名 / 1 个锚点）
```

## 页面里有什么

| 区块 | 交互 | 产物 |
|---|---|---|
| 第 1 章 风险换算 | 从 58 条事件（跳伞、登山、职业暴露、疾病……）里选一条，折成微死亡；可点"换算成事件"反查 | 事件 → 微死亡 / 等效次数 |
| 第 2 章 个人状态 | 年龄、性别必填；九项状态（吸烟、饮酒、血压、血糖、血脂、腰围、BMI、静息心率、睡眠）+ 运动、饮食；可存多份档案 | 综合系数、生存曲线、风险构成 |
| 第 3 章 价格 | 24 篇中国 VSL 研究逐篇列示；CPI 与收入两条折算口径 | 微死亡定价（元/µmort，区间） |
| 第 4 章 微寿命 | 年模式 / 月模式切换；可叠加一次性或每年额外风险 | 寿命账本：逐因素扣掉的年数 |
| 报告 | 打印（可另存 PDF）或复制纯文本 | 六节结构：报告头、输入、核心结果、风险构成、事件清单、方法与局限 |
| 本机数据 | 档案保存/载入/删除、导出/导入 JSON、清除 | 全部在浏览器内完成 |

无障碍：键盘可操作（canvas 有 `tabindex` 与方向键读数）、`aria-live` 播报计算结果、`prefers-reduced-motion` 降级、`@media print` 单独排版。

## 代码结构

单文件，自上而下四段：样式 → 正文 HTML → 数据区 → 逻辑区。

| 行 | 内容 |
|---|---|
| 1–929 | `<style>`（约 350 行）与正文 HTML（四章 + 两附录 + 序/尾声） |
| 929–1539 | **数据区**：`APP_DATA`（934）与九项系数表、CI、锚定与校准常量 |
| 1429–1515 | `Model` IIFE：`qAt` / `computeSurvival` / `computeFromParts` / `saturate` / `clampQ` |
| 1564–1855 | 工具函数、`Storage` 持久化门面、档案（instances）管理 |
| 1863–2285 | 状态系数与折算、蒙特卡洛、事件累计、寿命账本 |
| 2286–2613 | `Chart` IIFE：几何单一来源、绘制、悬垂气泡 |
| 2614–2793 | `Report` IIFE：报告生成、文本摘要、复制兜底 |
| 2794–3706 | 主渲染 `render()`、各区块渲染、章节导航、初始化 |
| 4230–4246 | `Store` 门面 + 测试钩子（`window.__test`） |

约定：**数据只读**（逻辑层不改 `APP_DATA`）、**存储只走 `Storage`**（`getItem/setItem/removeItem/keys` 四个方法，1541）、**图表几何只算一次**（`Chart` 暴露 `geom`，渲染与指针气泡共用）。

`APP_DATA` 的键：`MALE`/`FEMALE`（106 个单岁 q 值，单位 ‰/年，0–105 岁）、`EVENTS`（5 组 58 条）、`CATALOG`（60 条著录）、`REFS`（34 条）、`VSL`（2 表 24 篇），以及 `SMOKE/SBP/BMI/WAIST/GLU/LDL/HR/SLEEP/ALCOHOL/BODY/ACTIVITY/DIET` 等系数表与 `DEFL_INC/DEFL_CPI/DEFL_BASE`。

改数据的姿势：编辑 `APP_DATA` → `npm test`。`EVENTS` 里每条都要在 `CATALOG` 有同名著录，缺了 `validateData()`（1252）会在控制台报错并在页面顶部显示提示。

## 模型

```
WHO 中国 2019–2023 生命表（5 岁组）
  └─ 组内连乘到组端点 + 单调三次样条（PCHIP）插到单岁，85+ 用表内单岁值
       └─ q0(a)：基线年死亡概率
九项状态 → 综合系数 c（相对同龄同性别平均人）
  └─ 生活方式项按 1.12 插值；代谢项连乘后封顶 1.92；τ 校准衰减
       └─ qh = 1 − (1 − q0)^c，再与额外风险做竞争风险合成 1 − (1 − qh)(1 − extra)
            └─ 存活率 S(t) = ∏(1 − q)
                 └─ 蒙特卡洛抽系数 CI → 2.5–97.5% 分位带
```

蓝带是**模型参数的不确定性**（由各系数的 95% CI 反推 σ，再按暴露与参照的步长缩放），不是统计置信区间，也不是"某事发生的概率"。

## 测试

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `verify.js` | 40 | 数据自检（EVENTS↔CATALOG 对齐、信度分级、区间口径）、模型不变量（系数 1 复原生命表、单调性、封顶、月模式等价） |
| `_test_init.js` | 18 | 初始化：DOM 就绪、默认状态、档案与存储读回 |
| `_test_render.js` | 44 | `render()` 各区块输出、边界输入、空值兜底 |
| `_test_funfact.js` | 6 | 趣闻条随机取值的稳定性 |
| `lint.js` | — | 静态体检：语法错误、`id` 重复、控件有无可达名、`href="#…"` 锚点是否存在 |

**不覆盖**：真实浏览器排版、打印分页、`localStorage` 真实配额行为、canvas 像素输出。改完 UI 建议手动开一次页面。

## 已知限制

- **e₀ 偏低 2–3 岁**：按本表算，男 75.75、女 81.51 年；比国家公布的期望寿命低，差额来自 5 岁组平年率与曲线积分的口径，不是算错。
- **系数是相对风险，不是因果**：1.49 表示"这批人比平均人死亡率高 49%"，不能反推"某项因素造成了多少死亡"，也不能把系数当绝对风险。
- **代谢项封顶 1.92**：多个代谢危险因素叠加后系数不再上升，这是为了防止连乘外推，代价是极端画像被低估。
- **蓝带不是置信区间**：见上节。
- **只算到 105 岁**；月模式把年存活率开 12 次方近似到月。
- **VSL 不平均**：24 篇方法不同（工资风险法、意愿支付法），逐篇呈现并给区间，不给单一"权威值"。
- **中文正文约 1.2 万字**，页面高度约 13,000 px——不是长文档阅读器，是图文混排的单页。

## 数据底稿

正文每个数字都有「来源与著录」，可展开看文献、口径与折算过程。六份可复算底稿在 `data/`：

| 文件 | 内容 |
|---|---|
| [life-table-WHO2019-2023.md](data/life-table-WHO2019-2023.md) | WHO 中国生命表原始 5 岁组值与平滑说明 |
| [micromort-events.md](data/micromort-events.md) | 58 条微死亡事件的分子、分母、口径与年份 |
| [price-index.md](data/price-index.md) | CPI 与收入的跨期折算指数 |
| [vsl-bibliography.md](data/vsl-bibliography.md) | 24 篇中国 VSL 研究的著录与取值 |
| [model-calibration.md](data/model-calibration.md) | 连乘高估的校准过程（1.12 / 1.92 / τ 的来处） |
| [state-coefficient-averages.md](data/state-coefficient-averages.md) | 九项状态系数的锚定人群均值 |

## 目录

```
index.html                 主程序（单文件，零依赖）
verify.js                  数据与模型断言（40 条）
_test_init.js              初始化冒烟（18 条）
_test_render.js            渲染回归（44 条）
_test_funfact.js           趣闻回归（6 条）
lint.js                    静态体检
package.json               npm test / npm run check 入口
data/                      六份数据底稿（索引见 data/README.md）
docs/screenshot.png        首屏截图
CHANGELOG.md               版本记录
CITATION.cff               引用信息
LICENSE                    CC BY-NC 4.0 全文
```

## 版本

`x.y.z`：`z` 补丁（口径修正、缺陷、文案、无障碍，功能边界不变）、`y` 新增功能或结构调整、`x` 不兼容重写。

当前 **1.0.4**（2026-11-16）：正文收为四章，"数据与来源""参考文献"降为附录 A / B；尾声改写；不确定带宽度口径修正（饮酒项步长从 60 改为 420 g/周，见 CHANGELOG）；`qAt` 对非有限年龄改为抛错；`computeSurvival` 加缓存，蒙特卡洛 N=1000 从 168 ms 降到 71 ms。点估计未变。明细见 [CHANGELOG.md](CHANGELOG.md)。

## 许可与引用

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)：署名、非商业性使用；商业用途须事先取得作者许可。转发、改编并公开发表须保留作者名与作品名；个人学习、研究、体验自由。引用格式见 [CITATION.cff](CITATION.cff)。

内容提示：全书讨论死亡与伤害。页面顶部有心理援助提示（可一键关闭），全国心理援助热线 **12356** 常驻页脚。

© 2026 [Dasein0721](https://github.com/Dasein0721)
