# 测试套件说明 · 诚实数字门 · 打僵尸

> **⚠️ 当前口径勘误（V3/V4，2026-11-14）**：下文 §3–§7 是 V1/V2 阶段 QA 的过程记录，
> 其中若干**数值已过期**，阅读时以本条为准：
> `gateCountFor(1/5/12)` 现为 **20 / 25 / 26**（旧文写 2/3/6）、`MAX_GATE_GROUPS=30`、
> Boss `durationMs` 现为 **13000**（普通关 9500，旧文 2600）、陷阱扣 **25%**（旧 20%）、
> `play_level` 默认超时 **90000ms** 且选门策略默认 **`best`**（读 `__GAME_DEBUG__.bestPath`），
> 单关 20–30 组门 / 41–52 秒（旧文「达到 6 组门」「8 分钟」均为旧值）。
> 现行全套命令与结果见 `docs/TEST_REPORT.md` §13、§14；`npm test` 为唯一权威自检入口。
> V4 另新增只读观测字段 `__GAME_DEBUG__.combat = {shots,hits,kills,bullets,slots,alive,bossHit}`，
> 用于证明弹丸真的从枪口飞向僵尸并在接触帧命中；`browser_check.py` 覆盖全流程回归，
> 逐屏截图另由 V4 专项 Playwright 采样（同一套本机 Chrome，按 `win / lose / reduced-motion` 三种模式）产出，
> 交付级证据在 `tests/screenshots/v4_*_L*_s3_*.png` 与 `docs/screenshots/v4-*.png`。
> 「严禁修改 index.html / README.md」是当时 QA 阶段的分工约定，不适用于现在的维护者。

> 归属：QA 工程师（任务 #4）。**本目录由 QA 独立产出，严禁修改 `index.html` / `README.md` / `assets/`。**
> 分两阶段执行：**阶段 A** 只搭测试套件 + 语法自检；**阶段 B**（team-lead 通知后）运行全部断言 + 浏览器真实验证 + 出报告。

---

## 1. 环境依赖

| 项 | 版本 / 路径 |
|---|---|
| Node.js | `v22.22.2`（需支持 `node:vm` / `BigInt` / `assert.deepStrictEqual`） |
| Python | `/opt/homebrew/opt/python@3.9/bin/python3.9`（`3.9.17`） |
| Playwright（Python） | `from playwright.sync_api import sync_playwright` |
| Chrome | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |

> 缓存缺 1223 版 headless shell，`browser_check.py` **必须**用 `executable_path` 指向本机 Chrome；直接 `launch()` 会失败。

---

## 2. 文件清单

| 文件 | 职责 | 运行命令 |
|---|---|---|
| `extract-core.js` | 同源 GameCore 抽取器（ARCHITECTURE §3.4）。正则抽 `<script id="game-core">`，`vm.runInNewContext(code, sandbox, {timeout:5000})`，sandbox 只给最小全局集合（故意不给 window/document/fetch/AudioContext/performance/timer，core 偷碰即 `ReferenceError`）；支持 CJS（`module.exports`）与浏览器（`__GAME_CORE__`）分支；**CLI 硬断言 API 数量 === 26（裁决 U-1）** | `node tests/extract-core.js` → 打印 API 名列表与数量并校验 26 |
| `core.test.js` | Node 纯函数断言，可直接 `node tests/core.test.js`，输出通过/失败计数；退出码非 0 表示失败 | `node tests/core.test.js` |
| `static-audit.js` | 对 `index.html` 全文静态审计（§12.7 禁用词 + 技术禁用模式 + 结构检查），报告每项命中数与命中行号 | `node tests/static-audit.js` / `node tests/static-audit.js --json` |
| `browser_check.py` | Playwright 真实浏览器验证（阶段 A 只写不跑） | `/opt/homebrew/opt/python@3.9/bin/python3.9 tests/browser_check.py --protocol file` |
| `README.md` | 本说明 | — |

`core.test.js` / `static-audit.js` 均通过 `require('./extract-core')` 复用同一份抽取协议，避免两处正则漂移。

---

## 3. 阶段 A / 阶段 B

> **状态更新（2026-11-10）：阶段 A、阶段 B 均已完成，并通过交付后高负载加固复核。** QA 最终轮 `http://` 284/284、`file://` 285/285 失败 0；team-lead 于 23:02 / 23:08 用加固后的本脚本在同一份 `index.html` 上全新重跑，再次 `http://` 284/284、`file://` 285/285、失败 0、退出码 0、console error 0、外部请求 0（详见 `docs/TEST_REPORT.md` §5.12，`browser-r5-*.log`）。结构化结果见 `tests/test-results.json`（file，加固复核轮）与 `tests/test-results-http.json`（http，加固复核轮），共 **21 张**截图在 `tests/screenshots/`（V-1~V-8 + 五视口 + `grayscale_in_game` / `reduced_motion_in_game` + `probe_keyboard_s3`；灰阶与 reduced-motion 各 1 张，取自关卡内门组预览场景，如实命名）。

### 阶段 A（已完成）
- 5 个文件全部落盘；
- 语法自检：每个 `.js` 跑 `node --check`，`browser_check.py` 跑 `python3.9 -m py_compile`；
- **不运行** `core.test.js` / `static-audit.js` / `browser_check.py` 里针对 `index.html` 的断言（工程师还在并行写 `index.html`，文件此刻不存在或不完整）。
- 任务 #4 保持 `in_progress`，不标记 `completed`。

### 阶段 B（已完成）
```bash
# 1) 抽取 + 纯函数断言
node tests/extract-core.js
node tests/core.test.js
# 2) 静态审计
node tests/static-audit.js
node tests/static-audit.js --json
# 3) 浏览器真实验证（file://）
/opt/homebrew/opt/python@3.9/bin/python3.9 tests/browser_check.py --protocol file
# 4) 浏览器真实验证（http://，脚本内自起 python3 -m http.server）
/opt/homebrew/opt/python@3.9/bin/python3.9 tests/browser_check.py --protocol http --port 8765
```
> 阶段 B 允许按实机 DOM/接口修 `browser_check.py` 的选择器与对准策略（仍不得改 `index.html`）。

---

## 4. 覆盖的断言 / 判读

### `core.test.js`
- API 契约（裁决 U-1 严格 26 项）：§3.2 的 23 个函数 + `CONSTANTS` / `PHASES` / `BUILTIN_MANIFEST`（共 26 项）存在，且 `Object.keys(Core).length === 26`；`Core` 与三个常量对象已 `Object.freeze`；`BUILTIN_MANIFEST.entries.length === 12`；常量取值抽查；**不**检查 `projectToScreen` / `buildScene`。
- PRNG：`makeRng(1)` 两次前 100 输出一致；`seedFor(n)` 闭式公式；`powInt` / `maxBig`。
- 门运算：`+n / ×n / -n / ÷n`、`7n ÷ 2n === 3n`、减门下限 0、结果恒 `bigint`、`GateResult` 字段齐全。
- `applyGatePath` / `bestPath` 自洽 + 独立贪心复算。
- 格式化：`0/999/-42/1.23K/4.56M/7.89B/1.00e18`、超大数无 `Infinity/NaN`、`bigintToDecimal` 精确。
- `generateLevel(n)` 对 `n=1,5,50,200,1000` 各两次 `deepEqual`；`gateCountFor(1/5/12)=2/3/6`；`entryPowerFor(1)=10n`、`entryPowerFor(5)=18n`、`enemyPowerFor(5)=81n`；`isBossLevel(5/10)=true`。
- **1–1000 关批量**（每关 9 类断言，约 9000 条）：`solvable===true`、`tunedRounds===0`、每组至少一道正门、每组至少一道负门（RENDERING I-4）、门值全 bigint 无 Infinity/NaN、结构完整、**张力**（`bestPower*10n >= enemyPower*11n` 且 `worstPower < enemyPower`）、`applyGatePath` 约定自洽。
- `resolveBattle`：`(40n,30n)` → 胜 / loss=3 / powerAfter=37；`(20n,30n)` → 负 / powerAfter=0n / rollbackPower=10n；Boss `durationMs=2600`；相同输入重复 100 次一致。
- `interpolate(0n,100n,500)===50n`。
- `buildAssetPlan`：`mode:'off'` → `plannedRequestCount=0` 且 12 条全 `willRequest=false`；`mode:'remote'` + `protocol:'file:'` → 仍零请求。
- `resolveAssetSource`：注入 `MockAssetLoader`（主源 404 + 备用源超时）→ `degraded`；组合 `createHealthSnapshot` → `gameplayBlocked===false`、字段齐全、`Object.freeze`。
- `createHealthSnapshot`：字段齐全、`gameplayBlocked` 恒 false、`summary.generated===12`。
- §3.4.4 双向验证：CJS / 浏览器分支 API 键集合一致；DOM 守卫（`guardDom` 抛错 getter）下 core 加载与调用不触碰被禁全局。

### `static-audit.js`
- 产品禁用词 11 个：每项报告 **raw（剥离注释前）/ code（剥离注释后）命中数与行号**，并区分 `legit`（合法否定语境）与 `violation`（违规）。**PASS 判据 = 全部 violation 命中数为 0**。
- 技术禁用模式：`Math.random` / `<script src=` / `<link rel=stylesheet href=` / `@import url(http` / `@font-face` / `<img src` / `<audio src` / `XMLHttpRequest` / `eval(` / `new Function(` / `https?://` 字面量 / 绝对路径 `/assets/` / `type=module` 等，硬违规项 `code` 命中应为 0；`fetch(` / `localStorage` / core 内 `Number(` 等为**软检查**（如实报告行号，供人工确认协议守卫 / try-catch，不计入失败）。
- 结构检查：`<script>` 恰好 7 个且 id 集合 = `game-core, game-assets, game-audio, game-render, game-input, game-session, game-boot`（core 首、boot 尾）；script 开/闭标签数量一致（core 内无字面 `</script>` 截断）；`id="game-core"` 唯一；core 块内无 `</script>` 字面量、无 `Math.random`、剥离注释后不访问 DOM/IO 全局；无裸大整数（≥16 位未带 `n`）。
- **裁决 U-9（新增）**：按 `<script>` 块分段检索，`game-core` 与 `game-session` 两个块内**不得出现 `ctx.*`**（只有 `game-render` 持有 Canvas 上下文）；分别报告 raw / code（剥离注释后）命中数与行号，code 命中计入硬违规。`node tests/static-audit.js --json` 结果里对应 `scriptBlockCtx[]`。
- 输出末尾给出 `硬违规总数` 与 `判定: PASS/FAIL`；`--json` 输出结构化结果。

### `browser_check.py`
- 启动：本机 Chrome + `headless=True`；`--protocol file|http`（http 用 `subprocess` 管 `python3 -m http.server` 生命周期）。
- 断言 `window.__GAME_DEBUG__` / `__ASSET_HEALTH__` / `__GAME_CORE__` 存在；默认 `externalRequestCount===0`、`summary.generated===12`、`gameplayBlocked===false`、`mode==='off'`。
- `console error` / `pageerror` 为 0（过滤 favicon 噪声）；`performance.getEntriesByType('resource')` 无 `http(s)://` 项，`file` 模式下应为 `[]`。
- **首页与门组结构守卫**（实机校准）：`inner_text` 断言「没有隐藏玩法，没有骗人广告」、无登录/礼包/充值/分享得元素；`gates` 结构为 `[{index,doorCount,gates:[...]}]`、每个门 `value` 均为十进制字符串（`GROUPS_JS` / `EXPECT_JS` 依赖此结构）。
- **S4 不自动跳转**（team-lead 实机确认）：每关胜利 / 失败浮层必须**显式点按钮**（[下一关] / [重试本关]），脚本统一走 `advance_from_s4()`，并断言点击后 `phase` 由 S4 变为 S1/S2；不依赖任何「等待自动进关」。
- **按钮定位防误点**：失败浮层标题「再来一次，不看广告」与副标题「兵力不足，免费重试本关，不扣任何东西」也含候选词；`click_button()` 一律优先 `get_by_role('button')` / 可交互元素作用域，纯文本兜底也限定在 `button/[role=button]/a` 内，避免点到静态文案误报成功。
- **真实操作通关 1–5 关（含第 5 关 Boss）**：读 `__GAME_DEBUG__.gates` 找每组正门 → 鼠标拖拽对准 → 等状态机到 S4 → 点 [下一关]；逐关断言 `phaseTrace===['S1','S2','S3','S4']`、胜利、HUD 兵力与 `__GAME_CORE__.applyGate` 链运算预期一致、level+1。**每关独立 `safe` + 独立超时**，单点卡住只记该关失败明细（level / phase / done），不拖垮后续关卡。
- **高 CPU 负载稳健性（2026-11-10 加固）**：`play_level()` 一次性预规划每组目标 lane 并缓存 canvas 尺寸；S2 阶段只在 `activeGroup`（即将判定的门组）变化时主动对准一次，`align_verified()` 用只读 `targetX` 闭环确认输入已生效、丢失时重试，轮询改用 Python 侧 `time.sleep(0.04)` 而非 CDP 的 `wait_for_timeout(90)`；对准期间若又跨过一组会立刻追赶。旧实现每轮轮询都重新对准（约 5 次 CDP 往返），在 load average 40+ 的机器上往返延迟会挤占门组判定窗口、误选负门并级联误报 36–38 条失败；该问题**仅存在于测试脚本，产品本体在同一负载下独立试玩 5/5 全胜**。
- **失败重试**：故意对准负门 → **用浏览器 `inner_text` 断言渲染结果为完整中文「再来一次，不看广告」且 HTML 实体已解码**（工程师用 `&#x770B;` 规避源码字面量，源码 raw 命中可能为 0，不能只靠源码检索）、副标题含「兵力不足 / 免费重试」、无复活/看广告/跳过/续命按钮 → 显式点 [重试本关] 后 `entryPower` 与首次一致、不跳关；连续 20 次仍可重试（`--retry-count` 可调）。
- **三端输入**：触屏（`has_touch=True` context + PointerEvent）、键盘、鼠标拖拽各独立通关一关。键盘优先用 `__GAME_DEBUG__.currentLane` 做**闭环控制**（裁决新增 `targetX` / `currentLane` / `activeGroup`），字段缺失时自动回退启发式按键时长。
- **超时**：`play_level` 每关独立 `timeout_ms=60000`、S4 等待 25s，超时即记一条带实际值的失败断言；`page.set_default_timeout(60000)`（40 关约 6–10 分钟）。
- **资源降级**：`__ASSET_TEST_HOOKS__.simulateFailure({primary:true,fallbacks:true,timeout:true})` → `degraded` / `gameplayBlocked===false` / 请求数不增 / 仍可完整通关一关；`reset()` 后恢复 `generated===12`。
- **断网**：`context.set_offline(True)` 下完整玩 ≥10 关（默认 12 关，覆盖 n=5/10 两个 Boss 且达到 6 组门）。
- **响应式**：320/375/430/1280/1920 五种视口断言 `scrollWidth<=clientWidth`、前景可见控件间无非预期重叠；V-1~V-8 逐屏截图落盘 `tests/screenshots/`；另截 `grayscale_in_game` 与 `reduced_motion_in_game` 各 1 张（如实命名）。重叠断言会**排除铺满 `#stage` 的遮罩背景容器**：`.overlay` 用 `position:absolute;inset:0` 铺满居中的 480px 舞台（并非铺满视口），HUD 工具按钮与它是设计上的前后分层，浮层可见时旧断言恒误报 3 处重叠。
- **帧率**：S3 满屏时用 `requestAnimationFrame` 采样，断言平均 fps ≥ 45，并对 6 组门场景单独断言。
- 输出 `tests/test-results.json`：每项含 `name / ok / expected / actual / detail`，失败项带具体断言名与实际值。

### 判读
- `core.test.js`：`通过 N 失败 0` 且退出码 0 为通过；`失败明细` 给出断言名与期望/实际值。
- `static-audit.js`：`判定: PASS` 且 `硬违规总数: 0` 为通过；软提示需人工确认。
- `browser_check.py`：`failed: 0` 且退出码 0 为通过；`checks[]` 中 `ok:false` 的项即具体问题。

---

## 5. 已知口径与规格矛盾（如实记录，阶段 B 前请 team-lead 确认）

1. **「看广告」禁用词与失败文案冲突（team-lead 已裁决）**：**采用 QA 的合法语境区分方案**——`static-audit.js` 命中前为「不/无」、或行内含「再来一次 / 没有骗人广告 / 诚实声明」等否定式诚实文案时记 `legit`，否则记 `violation`；**raw / code / legit / violation 四组数字都如实报告，PASS 只基于 `violation=0`**。产品裁决失败文案「再来一次，不看广告」**保留不改**。工程师用 HTML 实体 `&#x770B;` 规避源码字面量，故源码 raw 命中可能为 0；阶段 B **必须**用浏览器 `inner_text` 断言渲染结果为完整中文且实体已解码（已落实到 `browser_check.py`），不能只靠源码检索。
2. **`Date` / `Math.random` 的 vm 守卫**：`vm.runInNewContext` 会自动注入 ECMAScript 标准内置（含 `Date` 与 `Math.random`），无法靠「不提供」拦截。`extract-core.js` 已显式把 `sandbox.Date` 置 `undefined`（偷碰即抛错）；`Math.random` 由 `static-audit.js` 静态检索守卫；`window/document/fetch/AudioContext/performance/timer` 等非标准全局在 sandbox 中确实不存在，偷碰即 `ReferenceError`。
3. **GameCore 严格 26 项（已由裁决 U-1/U-2 定案，不再是待确认项）**：`projectToScreen` / `buildScene` 属 `game-render` IIFE 局部，**不是** Core 导出。按 team-lead 第 2 条保持「**26 项硬性 + 27/28 额外项柔性 info 记录**」——柔性记录只打印信息，**不计入断言、不把它们当作 Core API**。`extract-core.js` CLI 与 `core.test.js` 均对「26 项签名 + `Object.keys(Core).length === 26`」做硬断言；A-10 的 28 项及透视数字一律不执行（详见第 7 节）。
4. **`applyGatePath` 的 `door` 语义（team-lead 已审出真实 bug 并裁决）**：原实现 `bestPath()` push `gates[j].lane`，而 `applyGatePath()` 把 `door` 当 `gates` 数组下标，Fisher-Yates 打散后 lane≠下标导致错位。工程师已统一为**数组下标**。`core.test.js` 的 `computeWorst()` 相应改为**优先按 index 构造 worstPath**，并保留 lane 回退的自动探测 + 自洽断言作回归守卫（team-lead 认可该设计）。
5. **bigint 字面量带 `n` 的静态口径**：`static-audit.js` 把「所有 bigint 字面量带 n」落实为「core 块（剥离注释/字符串后）无 ≥16 位裸大整数字面量」，并额外统计 `\d+n` 数量作为信息项；短常量（`10n`/`7n`）不受影响。

---

## 6. 阶段 B 前希望确认的 DOM / 接口细节（QA 用，不阻塞阶段 A）

> **team-lead 已逐条答复**（阶段 A 问题裁决）：按钮文案 / 浮层类型 / `__ASSET_TEST_HOOKS__` 方法名与参数 / 键盘 STEP / `powerBefore` 语义，由工程师在交付消息与 README 列明；`__GAME_DEBUG__` 将新增只读 `targetX` / `currentLane` / `activeGroup`（脚本已内建键盘闭环控制）；`outcome.powerBefore` 已存在（穿门后、战斗前）。以下保留为「阶段 B 若选择器对不上可自行修脚本」的校准点：

1. ~~`__GAME_DEBUG__.gates` 的确切 JSON 结构~~ → **已实机确认**：`[{index, doorCount, gates:[{id, op, value, label, positive, lane}]}]`，`value` 为十进制字符串；`outcome.powerBefore` = 穿门后战斗前兵力。脚本已加结构守卫断言，同时保留多结构容错。
2. ~~是否可暴露 `targetX` / 当前对准 lane~~ → **已裁决新增**：`__GAME_DEBUG__` 增加只读 `targetX` / `currentLane` / `activeGroup`；`browser_check.py` 已用 `currentLane` 做**键盘闭环控制**（比启发式按键时长可靠），字段缺失时自动回退启发式。
3. 键盘 `STEP` 大小 / 每 lane 宽度对应的按键时长、Canvas 的 id 或可定位选择器、Canvas 的 letterbox 变换是否与 §9.1 完全一致（脚本按 `scale=min(cssW/480,cssH/854)` 换算逻辑坐标）。
4. ~~各按钮的实际文案~~ → **已实机确认**：`♪` / `↺` / `?` / `开始游戏` / `♪ 声音：开` / `下一关` / `重试本关` / `刷新资源` / `返回`。脚本已按此校准候选词表，并用「role → 可交互元素 → 文字」多重回退。
5. `__ASSET_TEST_HOOKS__` 方法名与 `simulateFailure(opts)` 参数是否与 §7.6 一致；`reset()` 后 `__ASSET_HEALTH__.summary` 的恢复口径。
6. `outcome.powerBefore`（bigint→string）= 穿门后、战斗前的兵力 —— **team-lead 已确认存在且语义一致**；脚本用它做「HUD 兵力与运算预期一致」断言。
7. ~~浮层类型~~ → **已实机确认**：DOM 覆盖层（非 Canvas 内绘制），`inner_text('body')` 可直接读到「再来一次，不看广告」；HTML 实体 `&#x770B;` 渲染正确；失败副标题「兵力不足，免费重试本关，不扣任何东西」。

### 阶段 B 实机基线（team-lead 已用 Playwright 在 `file://` 下实跑，直接采信）

1. **S4 停浮层、不自动跳转**：不操作时流程为 `S1→S2→S3→S4`，之后一直停 S4；胜利须点「下一关」、失败须点「重试本关」。脚本每关显式点击并断言离开 S4（见 `advance_from_s4()`）。
2. 默认态：`externalRequestCount=0`、`gameplayBlocked=false`、`summary.generated=12`、`mode='off'`、`performance.getEntriesByType('resource')=[]`、控制台错误 0 条。
3. 首页文案「没有隐藏玩法，没有骗人广告」与三行操作图示齐全，无广告/登录/礼包元素。
4. 工程师本轮增强 S3 战斗画面（僵尸潮密度 / 我方阵型 / 弹幕 / S3 隐藏门框）**只改 `game-render` 绘制**，不改判定 / 状态机 / 接口，QA 断言不受影响。
5. 阶段 A 末尾：**只跑 `node --check` 与 `py_compile` 语法自检，暂不跑完整 `core.test.js`**（工程师正在删 2 个 Core 导出，此刻跑会因 26 项键数断言失败；等阶段 B 一起跑）。

---

## 7. 规格统一裁决（`docs/SPEC-UNIFICATION.md`，最高优先级）

> 架构师在实现/测试开工后把 `ARCHITECTURE.md` 从 1711 行增补到 2274 行（A-9~A-13），与已下发基线冲突。下表为**唯一执行基线**，覆盖本 README 及 `tests/` 下所有脚本口径。

| 裁决 | 唯一基线 | 测试侧落实 |
|---|---|---|
| **U-1 / U-2** | GameCore **严格 26 项**（§3.2 原表），`Object.freeze` 收口；`buildScene` / `projectToScreen` 为 `game-render` IIFE 局部，不新增 script 块 / 全局 | `extract-core.js` CLI 硬断言 `Object.keys(Core).length === 26`；`core.test.js` 断言 26 项签名 + 键数 26 + 冻结；**不**要求、不断言 27/28 项 |
| **U-3** | 2.5D 透视用 `RENDERING.md §2`：`HORIZON_Y=250`、`projectY(z)=250+604·z^1.6`、`halfWidth(z)=60+180z`、`projectX=240+u·halfWidth`、`scale(z)=0.35+0.65z`、`fogAlpha=0.55(1−z)` | 阶段 B 若做视觉数值断言用这套；**不**用 A-10 的 `256.2 / 529.5 / z^2.2 / scale=0.18+0.82z^1.8 / halfWidth=28+182z^1.4`。当前 4 个脚本均无透视数字断言 |
| **U-4** | 合成 BGM 用 `RENDERING.md §6`（BPM 128、8 小节、kick/hihat/bass/lead 四轨、lookahead 25ms、共用 masterGain） | 音频断言**只查**：首次手势后 AudioContext running、切后台恢复、静音持久化、无 `<audio src>` / 无音频文件请求、无外部请求；**不断言具体 BPM**。其中 `<audio src>` 由 `static-audit.js` 覆盖、无外部请求由 `browser_check.py` 覆盖；当前脚本未新增 BPM/音频数值断言 |
| **U-5** | 任务仍为 **T01→T10**（无 T11） | 不影响测试脚本；文档口径同步 |
| **U-8** | 验收 = `PRD.md §9 A-1~A-15` + `RENDERING.md §9 V-1~V-8` + `§7.3 张力断言` | 截图按 V-1~V-8 逐屏落盘；张力断言为阶段 B 核心：1–1000 关同时满足 `bestPower*10n >= enemyPower*11n` 且 `worstPower < enemyPower`，且每组 ≥1 正门、≥1 负门 |
| **U-9** | `game-core` 与 `game-session` 块内**禁止任何 `ctx.*`**；只有 `game-render` 持有 Canvas 上下文 | `static-audit.js` 新增按 script 块分段检索（见第 4 节），报告 raw/code 命中数与行号，code 命中计入硬违规 |
| **U-6 / U-7** | 骨架 7 script / 4 个 `window.__*` / 零请求 / `file://` 可玩；§5.4 BigInt 闭式公式、I-4、§5.6 可解性、§6 S3 快照锁定、§7 三档 mode、§8 状态机、§10 测试边界、§12 禁用词 | 两版一致，现有断言不变 |

阅读顺序：`SPEC-UNIFICATION.md` → `RENDERING.md` → `ARCHITECTURE.md §0~§8 / §10~§12 / §14` → `PRD.md`；`ARCHITECTURE.md` 的 A-9~A-13 仅作背景参考，其中与 U-1~U-5 冲突的数字不执行。

> 阶段 A 其余要求不变：4 个脚本 + README 落盘、`node --check` 与 `python3.9 -m py_compile` 语法自检通过、**不运行**针对 `index.html` 的断言、不修改 `index.html` / `README.md` / `assets/`。
