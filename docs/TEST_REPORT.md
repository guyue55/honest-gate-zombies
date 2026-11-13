# 测试报告 · 诚实数字门 · 打僵尸

> 阶段 B 全面真实验证 / 真实模拟点击试玩
> 执行人：QA 工程师（任务 #4）　日期：2026-11-10
> 被测对象：`index.html`（3490 行 / 149562 字节，单文件内联全部 CSS/JS，零构建；含 `planSeq` 竞态守卫与内联零请求 favicon 修复；已含 2026-11-10 续重构：士兵/僵尸写实化 · 关卡加长 · 陷阱常驻；已含 2026-11-12 视觉升级 V2/V2.1：明亮化、圆润立体人海、门组渲染裁剪、场景丰富度）

---

## 1. 结论摘要

**全部验证通过。** QA 断言集内未发现实现侧缺陷；team-lead 独立复核发现的 2 项实现侧问题（favicon 404、异步竞态）已修复并回归，最终交付版本无已知缺陷（详见 §5.11）。

- 三个 Node 脚本全绿：Core 严格 26 项 API、纯函数断言 9296/9296、静态审计硬违规 0 / PASS。
- Playwright 真实浏览器在 `file://` 与 `http://127.0.0.1:8765/` 双协议下完成真实点击试玩：1–5 关（含第 5 关 Boss）、三端输入各独立通关、连续 20 次失败免费重试、资源自愈降级、断网 12 关、V-1~V-8 截图、五视口、灰阶 / reduced-motion、帧率、只读性与逐屏诚实性。
- 运行时 `console error` / `pageerror` 恒为 **0**；`performance.getEntriesByType('resource')` 无 http(s) 外部项，`file://` 下为 `[]`；默认 `externalRequestCount=0`、`summary.generated=12`、`gameplayBlocked=false`、`mode='off'`。
- 最终轮：`http://` **284/284 通过**、`file://` **285/285 通过**，双协议失败 **0**、退出码 **0**、`consoleErrors=[]`。
- QA 最终轮帧率实测平均 **60.57 fps（http）/ 60.58 fps（file）**（≥45），6 组门满屏僵尸场景 **60.98 / 60.97 fps**；41 个 rAF 样本，最高组数 6。**加固复核轮（§5.12）**同为 0 失败，平均 **60.61 / 60.56 fps**，6 组门 **60.59 / 61.12 fps**。
- 智能路由判定结论：QA 三轮的 24 条失败**均源于测试脚本自身**，QA 自行修复后回归归零（详见第 3、7 节）。此外 team-lead 独立复核另发现并推动修复 **2 项实现侧问题**（http 下 `/favicon.ico` 404、`simulateFailure`/`reset` 异步竞态），均已复验通过（详见第 5.11 节）；最终交付版本无已知实现缺陷。
- **交付后复现性复核**：在 load average 36–49 的共享主机上全新重跑暴露出测试脚本的高负载时序脆弱性（非产品缺陷）；已加固 `browser_check.py` 并用同一份 `index.html` 在 23:02 / 23:08 全新重跑，双协议再次 **0 失败**（§5.12）。

最终轮汇总数字见 **第 3.4 节** / **第 5.10 节**，交付后加固复核轮见 **第 5.12 节**。

---

## 2. 环境与工具

| 项 | 版本 / 路径 | 用途 |
|---|---|---|
| Node.js | `v22.22.2` | `node:vm` / `BigInt` / `assert` |
| Python | `/opt/homebrew/opt/python@3.9/bin/python3.9`（`3.9.17`） | Playwright 驱动 |
| Playwright（Python） | `from playwright.sync_api import sync_playwright` | 真实浏览器自动化 |
| Chrome | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`（`157.0.8103.50`） | `headless=True` + `executable_path`（缓存缺 1223 版 headless shell，必须指定本机 Chrome） |
| 静态服务 | `python3 -m http.server 8765 --directory <root>`（脚本内 `subprocess` 管生命周期） | `http://` 协议轮 |

统一参数：`--retry-count 20`、`--offline-levels 12`（用户要求充分验证，时长不是约束）。
每关独立 `timeout_ms=60000`、S4 等待 25s、`page.set_default_timeout(60000)`，单关卡住只写一条带 `level/phase/done` 的失败明细，不拖垮整轮。

测试脚本（全部由 QA 独立产出，仅位于 `tests/`）：

| 文件 | 职责 |
|---|---|
| `tests/extract-core.js` | 同源 GameCore 抽取器（§3.4），`vm.runInNewContext` 最小 sandbox，CLI 硬断言 26 项 API |
| `tests/core.test.js` | Node 纯函数断言（可直接 `node tests/core.test.js`） |
| `tests/static-audit.js` | 全文静态审计（禁用词 / 技术禁用模式 / 结构 / U-9 分段 `ctx.*`） |
| `tests/browser_check.py` | Playwright 真实浏览器验证（双协议 / 试玩 / 截图 / 帧率 / 只读性） |
| `tests/README.md` | 运行命令与环境说明 |

---

## 3. 执行轮次与智能路由判定

按 team-lead 的「智能路由」规则执行：**失败源于 `index.html` → 反馈 team-lead 转交工程师；源于测试脚本 → QA 自行修复后重跑**。

### 3.1 第 1 轮（基线，file 协议）

`通过 248 / 失败 22 / 合计 270`，`consoleErrors=[]`。22 条失败归为 3 类，**全部为测试脚本缺陷**：

| 失败项 | 条数 | 根因 | 判定 |
|---|---|---|---|
| `失败#N 重试后 entryPower 与首次一致`（期望 `10` 实际 `21`） | 20 | 脚本把**第 1 关**入关兵力 `P0(1)=10` 当作基准，而重试循环发生在**第 6 关**，`P0(6)=21`。实现侧重试后 `entryPower` 恒为 21 且 20 次一致，行为正确 | 脚本 bug |
| `有帧率采样`（实际 0） | 1 | `play_level()` 的 `done >= gc` 提前 `break`，在 S2 结束瞬间跳出循环，**错过 S3 观察窗口**，导致 S3 截图与 rAF 帧率采样缺失 | 脚本 bug |
| `键盘 独立通关一关` | 1 | `align_keyboard()` 用 `keyboard.press()` 单次点按；实机键盘是「按住连续积分 360 px/s」，单帧不产生位移 | 脚本 bug |

### 3.2 第 2 轮（回归，http + file 双协议）

先修复 4 处脚本缺陷（`entryPower` 基准取第 6 关、`play_level` 不提前 break、`align_keyboard` 改 `down+按住 110ms+up`、补齐第 8 项只读性与逐屏诚实性断言 + 帮助面板 12 条资源完整性断言），并用「局部回归探针」确认键盘 `win=True`、`phaseTrace=['S1','S2','S3','S4']`、fps 采样 60.18、新增断言 15/15 通过后再跑全流程。

| 协议 | 通过 / 合计 | 失败 | 唯一失败项 |
|---|---|---|---|
| `http://` | 283 / 284 | 1 | `采集到 6 组门(gateCount>=6)场景的 fps 样本` |
| `file://` | 284 / 285 | 1 | 同上 |

根因仍是**脚本执行顺序**：`main()` 把 `seg_fps()` 排在断网 12 关之前，而 6 组门场景只出现在 `n>=12`，统计时视野内最高组数为 4。两轮 JSON 的 `fpsSamples` 中实际都含 `{"level":12,"groups":6,"fps":60.71}`（**第 2 轮数值，非最终轮**；最终轮为 60.98 http / 60.97 file），数据本身完全达标。第 1 轮 3 类失败与 4 处修复全部回归通过，**未复现**。

### 3.3 最终轮（收尾确认，http + file 双协议）

修复 `main()` 顺序：把 `safe('帧率', seg_fps)` 移至 `safe('断网通关', ...)` 之后。双协议各重跑一轮完整流程。

**结果：双协议均 0 失败、退出码 0**（`FINAL_HTTP_EXIT=0` / `FINAL_FILE_EXIT=0`）。第 1 轮 3 类缺陷与第 2 轮 1 类顺序缺陷全部归零且未复现；新增的只读性 / 逐屏诚实性 / 帮助面板 12 条资源完整性断言全部通过。

### 3.4 最终轮汇总

| 协议 | 通过 | 失败 | 合计 | 退出码 | consoleErrors | rAF 样本 | 平均 fps | 6 组门 fps |
|---|---|---|---|---|---|---|---|---|
| `http://127.0.0.1:8765/index.html` | **284** | **0** | 284 | 0 | `[]` | 41 | **60.57** | **60.98** |
| `file://…/index.html` | **285** | **0** | 285 | 0 | `[]` | 41 | **60.58** | **60.97** |

> 上表为 **QA 阶段 B 最终轮**（09:16:56 / 09:22:34）的数字，归档副本为 `test-results-http-final.json` / `test-results-file-final.json`。交付后 team-lead 又做了高负载复现性复核并加固脚本，用同一份 `index.html` 在 23:02:22 / 23:08:01 全新重跑，双协议再次 0 失败（http 284/284、file 285/285，平均 60.61 / 60.56 fps，6 组门 60.59 / 61.12 fps），见 **§5.12**；当前落盘的 `tests/test-results.json`、`test-results-http.json`、`test-results-file.json` 均为该**加固复核轮**结果（file 为主结果，最后一轮跑 file），三份均 0 失败。第 1 轮 248/270 仅作为历史基线保留。

### 3.5 智能路由结论

三轮共发现 24 条失败（第 1 轮 22 + 第 2 轮 2），**100% 为测试脚本自身缺陷**：比较基准错误、观察窗口提前关闭、输入方式与实机积分模型不符、统计段调用顺序过早。QA 未因这些失败要求修改 `index.html`，也未向 team-lead 转交实现 bug。实现侧另有 2 项问题由 team-lead 独立复核发现（favicon 404、异步竞态），已修复并回归，详见第 5.11 节。

---

## 4. Node 层验证结果

### 4.1 `node tests/extract-core.js`

```
API 数量   : 26（裁决 U-1：严格 26 项）
API 数量断言 : PASS (26)
```
26 项导出：`applyGate / applyGatePath / bestPath / bigintToDecimal / buildAssetPlan / createHealthSnapshot / enemyPowerFor / entryPowerFor / formatCompact / formatNumber / gateCountFor / generateLevel / interpolate / isBossLevel / makeRng / maxBig / milestoneFor / powInt / resolveAssetSource / resolveBattle / seedFor / tuneLevel / verifySolvable` + `CONSTANTS / PHASES / BUILTIN_MANIFEST`。`projectToScreen` / `buildScene` 不存在（符合 U-2：属 `game-render` IIFE 局部）。

### 4.2 `node tests/core.test.js`

```
通过: 9296  失败: 0  合计: 9296
```
覆盖：PRNG 确定性、四则门（`7n ÷ 2n === 3n`、减门下限 0、结果恒 bigint）、`applyGatePath`/`bestPath` 自洽、格式化全程字符串操作、`generateLevel(1/5/50/200/1000)` 双次 deepEqual、`gateCountFor(1/5/12)=2/3/6`、`entryPowerFor(1)=10n`/`entryPowerFor(5)=18n`/`enemyPowerFor(5)=81n`、**1–1000 关批量可解性 + 每组至少一正一负门 + 张力断言**（`bestPower*10n >= enemyPower*11n` 且 `worstPower < enemyPower`）、`resolveBattle` 胜/负/回滚与 100 次重复一致、`interpolate`、`buildAssetPlan` 零请求、`resolveAssetSource` 降级 + `createHealthSnapshot`、`Object.freeze` 与 26 项签名、§3.4.4 CJS/浏览器分支双向验证。

### 4.3 `node tests/static-audit.js --json`

```
result = PASS    hardViolations = 0
文件行数（wc -l / 文本模式）= 2778    totalLines（--json，按 \n 切分）= 2779
```

> 两种计数口径指同一文件：`wc -l` / 文本模式为 **2778 行**（team-lead 重跑值），`--json` 的 `totalLines` 按 `\n` 切分含末行故为 **2779**。阶段 B 开头在 2770 行版本测得 2771；最终交付版本（2778 行 / 112818 字节，含 #12/#13 修复）已复跑，仍为 `PASS / 硬违规 0`，其余各项命中数完全一致。

**产品禁用词 11 项**：`复活 / 看广告 / 激励视频 / 礼包码 / 首充 / 抽卡 / 续命 / 跳过关卡 / 分享得 / 立即下载 / 差一点` —— raw / code / legit / violation **全部为 0**。（失败文案「再来一次，不看广告」由浏览器 `inner_text` 单独断言，不依赖源码字面量。）

**技术禁用模式 17 项**（13 个硬项 raw/code 全 0）：`Math.random`、`<script src=`、`<link rel=stylesheet href=`、`@import url(http`、`@font-face`、`<img src`、`<audio src`、`XMLHttpRequest`、`eval(`、`new Function(`、`http(s)://` 运行时字面量、绝对路径 `/assets/`、`type=module`。

**软提示 3 条**（不计入失败，已人工确认非违规）：

| 项 | 命中 | 确认结论 |
|---|---|---|
| `fetch(` | 行 817，1 处 | 位于 `mode!=='off'` 且非 `file:` 的守卫内，默认 off + file 短路，实机零外部请求 |
| `localStorage` | 6 处（行 738/744/1088/1093/2237/2244） | 静音/最佳关持久化，try-catch 包裹 |
| 浮点字面量 | raw 270 / code 267 | 渲染层颜色与透明度，正则误报；1–1000 关 BigInt 精确断言兜底 |

**结构检查 13 项全通过**：script 恰好 7 个且 id 集合符合 §3.5（core 首、boot 尾）、开/闭标签数一致、`id="game-core"` 唯一、core 块内无 `</script>` 字面量 / 无 `Math.random` / 不访问 DOM/IO 全局、无 ≥16 位裸大整数。

**U-9 分段 `ctx.*`**：`game-core` 与 `game-session` 两个块 raw/code 命中均为 **0**（只有 `game-render` 持有 Canvas 上下文）。

**bigint 字面量**：`nakedLargeIntegerHits=0`，`\d+n` 计数 49（信息项）。

---

## 5. Playwright 真实浏览器验证

### 5.1 双协议与零外部请求

| 断言 | file | http |
|---|---|---|
| `__GAME_DEBUG__` / `__ASSET_HEALTH__` / `__GAME_CORE__` 均为 object | ✅ | ✅ |
| `externalRequestCount === 0` | ✅ | ✅ |
| `summary.generated === 12` | ✅ | ✅ |
| `gameplayBlocked === false` | ✅ | ✅ |
| `mode === 'off'` | ✅ | ✅ |
| `performance.resource` 无 http(s) 外部项 | ✅ | ✅ |
| `file://` 下 `resource === []` | ✅ | — |
| `console error / pageerror === 0` | ✅（`consoleErrors=[]`） | ✅（`consoleErrors=[]`） |

### 5.2 真实模拟点击试玩 1–5 关（用户重点）

从首页 [开始游戏] 起，逐关读取 `__GAME_DEBUG__.gates` 找每组正门 → 鼠标拖拽把队伍对准正门 → 真实走完 `S1→S2→S3→S4` → 显式点 [下一关]。

- `phaseTrace === ['S1','S2','S3','S4']`：**8/8 通过**
- `outcome.win === true`：**5/5 通过**（含第 5 关 Boss）
- `HUD 兵力与 applyGate 链预期一致`：**5/5 通过**（用 `outcome.powerBefore` 对照 `EXPECT_JS` 独立复算）
- 胜利后 `level+1`、**S4 显式点击后离开 S4**：**37/37 通过**（S4 停浮层不自动跳转，脚本不依赖自动进关）
- 首页诚实文案「没有隐藏玩法，没有骗人广告」、无登录/礼包/充值/分享得/VIP：通过
- `gates` 结构 `[{index,doorCount,gates:[...]}]`、每个门 `value` 为十进制字符串：通过

### 5.3 三端输入各独立通关一关

| 输入 | 方式 | 结果 |
|---|---|---|
| 触屏 | `has_touch=True` context + `PointerEvent` + `touchscreen.tap` | ✅ 独立通关 |
| 键盘 | `A/D` 按住连续积分闭环（读 `__GAME_DEBUG__.currentLane`，与 `gates[].lane` 同口径；实测 `targetX=240 ↔ currentLane=1`） | ✅ 独立通关（第 1 轮失败，修复后通过） |
| 鼠标拖拽 | `mouse.down/move/up` 映射到逻辑坐标 | ✅ 独立通关 |

三者 `phaseTrace` 均为四段、结果均为胜利。

### 5.4 失败与重试（连续 20 次）

故意对准负门制造失败，逐次断言：

- 浏览器 `inner_text` 渲染为完整中文「**再来一次，不看广告**」、无 `&#` 字面量（HTML 实体 `&#x770B;` 解码正确）：**20/20**
- 副标题「兵力不足 / 免费重试」：**20/20**
- 无「复活 / 看广告 / 跳过 / 续命 / 分享得」按钮：**20/20**
- 点 [重试本关] 后 `entryPower` 与首次进入该关一致（`P0(6)=21`）：**20/20**（第 1 轮因基准取错误报，修复后通过）
- 重试不跳关（恒为第 6 关）：**20/20**
- 连续 20 次后仍可继续免费重试：通过

### 5.5 资源自愈

`window.__ASSET_TEST_HOOKS__.simulateFailure({primary:true,fallbacks:true,timeout:true})` →
`summary.degraded=12` / `gameplayBlocked=false` / `externalRequestCount=0`（零真实网络 IO）/ `degraded` 状态成立 →
**降级状态下仍完整通关一关** → `reset()` 后 `summary.generated` 恢复 12。全部通过。
帮助面板「操作与资源健康」显示外部请求数 0 / 游玩是否受阻「否」，资源健康表 DOM 含 **12 条**内置资源（与 `BUILTIN_MANIFEST.entries.length===12` 一致），390×844 视口内可见约 8 行，其余在滚动/可视区外。

### 5.6 断网 12 关

`context.set_offline(True)` 下完整玩 12 关（覆盖 n=5 / n=10 两个 Boss 关、n=12 达 6 组门），逐关 `win===true`：**34/34 相关断言通过**；断网下仍无 http(s) 外部资源项；累计通关 ≥10 关。

### 5.7 只读性与诚实性（阶段 B 第 8 项）

- 对 `__GAME_DEBUG__` / `__ASSET_HEALTH__` 做属性写入与整体替换尝试：`level` / `mode` 均不变，快照仍为 `Object.freeze`：通过。
- 逐屏诚实性（首页、第 1 关胜利浮层、失败浮层、帮助面板）：无「复活 / 续命 / 登录 / 注册 / 内购 / 充值 / 礼包 / 领取奖励 / 分享得 / VIP / 下载APP / 看广告得 / 跳过本关 / 付费」文案，无 http(s) 外链 `<a href>`：通过。
  - 注：诚实文案「没有骗人广告」「不看广告」本身含「广告」二字，故不用「广告」泛查，避免误伤。

### 5.8 响应式 / 灰阶 / reduced-motion

320×568 / 375×667 / 430×932 / 1280×800 / 1920×1080 五视口：`scrollWidth <= clientWidth`、无可见元素重叠，全部通过。灰阶与 reduced-motion 各截取关卡内门组预览场景 1 张，如实命名为 `grayscale_in_game.png` / `reduced_motion_in_game.png`（见 §6.1 命名真实性说明）。

### 5.9 帧率

S3 满屏僵尸期间用 `requestAnimationFrame` 采样：

- 样本数：**41**（http / file 各 41，最高组数 6）
- 平均 fps：**60.57（http）/ 60.58（file）**，「平均 fps >= 45」断言 **2/2 通过**
- 6 组门（`groups>=6`）场景：**60.98（http）/ 60.97（file）**，「6 组门场景平均 fps >= 45」断言 **1/1 通过**
- 全部样本区间约 **60 – 61.5 fps**，无掉帧

### 5.10 最终轮通过 / 失败汇总

| 协议 | 通过 / 合计 | 失败 | 关键分组通过情况 |
|---|---|---|---|
| `http://` | **284 / 284** | **0** | phaseTrace 8/8、胜利 5/5、HUD 兵力 5/5、渲染文案 20/20、HTML 实体 20/20、副标题 20/20、无复活/看广告按钮 20/20、entryPower 一致 20/20、重试不跳关 20/20、离开 S4 37/37、断网 34/34、三端独立通关 3/3、只读写入无效 2/2、Object.freeze 2/2、逐屏诚实性 4/4、12 条资源 1/1、gates 结构 1/1、门 value 1/1、帧率 2/2、6 组门帧率 1/1、console error 1/1 |
| `file://` | **285 / 285** | **0** | 同上（file 多 1 条 `resource === []` 断言） |

两协议 `consoleErrors=[]`、无 http(s) 外部资源项、零外部请求、`summary.generated=12`、`gameplayBlocked=false`、`mode='off'`。

### 5.11 team-lead 独立复核与补充验证

QA 三轮统计的 24 条失败均属测试脚本缺陷；此外 team-lead 在独立复核中另发现并推动修复了 **2 项实现侧问题**（不在 QA 断言集内）：

| 问题 | 现象 | 修复 | 复验结果 |
|---|---|---|---|
| http 下 `/favicon.ico` 404 | Pages 场景浏览器自动请求 favicon，产生 1 条 http(s) resource + 2 条 console error | `<head>` 内联 `<link rel="icon" href="data:,">` | http 默认 `off`：`resources=[]`、`consoleErrors=[]`、失败请求 `[]` |
| `simulateFailure()` / `reset()` 异步竞态 | 注入未 await 紧接 `reset()`，旧异步链末尾覆盖新状态（`generated=11 / degraded=1`） | `game-assets` 加 `planSeq` 代次守卫：`runPlan()` 捕获 seq，链中每步与末尾回调校验，旧链跳过覆盖；`refresh()` 的 `file:` 同步分支同步自增作废旧链 | `/tmp/wb_reset_check.py`：竞态路径 `generated=12 / degraded=0`；`degraded=12` 时仍能进入 S1 |

竞态复验的确切时序：注入 `simulateFailure()` 未 `await` → 紧接调用 `reset()` → 等待 **900ms** 后读取快照，结果为 `generated=12 / degraded=0`（旧异步链已被 `planSeq` 代次守卫丢弃，不再覆盖新状态）。

同步订正 `README.md:76–84`：`simulateFailure()` / `reset()` 返回 `Promise<AssetHealthSnapshot>`、调用方必须 `await`，删除不实的「同步预填 / 立即读与 await 后读一致」表述。修复后三个 Node 脚本重新全绿（26 项 API / 9296 条断言 / 静态硬违规 0），双协议最终轮见 §5.10。

**动态清单端到端实测**（脚本 `/tmp/wb_dynamic_manifest_check.py`；临时站点 `http://127.0.0.1:8901` 放置 `index.html` 真实副本与可控 manifest，Playwright + 本机 Chrome，9 项断言全 PASS）：

| 场景 | 实测结果 |
|---|---|
| 默认 `off` | `manifestVersion=1.0.0-builtin`、`ext=0`、`httpResources=[]`、console error 0、`generated=12` |
| `?assets=local` + 服务端清单 `2.0.0-update` | 真实采纳 `2.0.0-update`，`ext=1`（仅 `/assets/manifest.json`），`generated=12`、`blocked=false` |
| `?manifest=<url>` remote `3.0.0-remote` | `mode=remote`、采纳 `3.0.0-remote`、`ext=1` |
| remote `0.9.0-old` | 旧版本被拒，保持 `1.0.0-builtin`，不降级覆盖内置清单 |
| 主源 + 备用源全 404（`4.0.0-broken`） | `generated=11 / degraded=1`，失效条目 `source=generator:bg.track`，`blocked=false`，点击开始仍进入 S1 |

需如实区分：上表最后一行是**显式启用外部资源且真实 404** 的场景，浏览器会记录 6 条 404 console（`ext=7`），属预期行为，与「默认 `off` / 正常模式 console error = 0」不矛盾。

**GitHub Pages 子路径部署**（脚本 `/tmp/wb_subpath_check.py`；站点置于 `/repo/` 子目录，3 项断言全 PASS）：`/repo/index.html` 默认 `mode=off`、`ext=0`、`resources=[]`、`errors=[]`；`?assets=local` 正确解析为 `/repo/assets/manifest.json`（相对路径、未写死 `/assets/`），`generated=12`、`blocked=false`；仍可点击进入关卡（`phase=S1`）。

**其他独立复验**：`/tmp/wb_playthrough.py` 完成 1–5 关真实点击通关（含 Boss、鼠标 / 键盘 / 触屏三端）、第 6 关故意失败 →「再来一次，不看广告」→ 免费重试回滚 `entryPower=21`、帮助面板资源健康、60 fps、`ext=0`、错误 `[]`；`/tmp/wb_http_check.py`（探针修正为 `await` 后）http 默认零请求零报错、`?assets=local` `ext=1`、await 故障注入 `degraded=12 / blocked=false / ext=0`、`reset()` 恢复 12，`/assets/manifest.json`、`/README.md`、`/.nojekyll` 均 HTTP 200。team-lead 另逐张目视 V-1 / V-3 / V-5 / V-5 Boss / V-7 / V-8 / 320×568 / 灰阶 / reduced-motion，结论与 §6 一致。

### 5.12 高负载复现性复核与测试脚本加固（team-lead，2026-11-10 夜间）

**背景**：交付后 team-lead 在 22:11 / 22:18 用**同一份 `index.html`**（SHA-256 前缀 `3248952e`，mtime 09:06:30，全程未改动）全新重跑 `browser_check.py`，在共享主机 **load average 36 / 49 / 42**（8 用户）下得到 http 38 条、file 36 条失败；而独立试玩脚本 `/tmp/wb_playthrough.py` 在**同一负载**下仍 5/5 全胜（含 Boss）、三端输入、失败重试、60 fps、错误 `[]`。据此判定：**产品本体无缺陷，失败集中于测试脚本的时序假设**。

**根因（三层）**：

1. 门组预览 `PREVIEW_MS=2000`，首个门组在 S2 开始 `GROUP_LEAD=1400ms` 后判定，且 `resolveGroup()` 取的是**队伍实际 `teamX`** 而非 `targetX`。rAF 仍为 60 fps（`dt=min(50, ts-last)`，游戏时间≈墙钟），但高负载下 **CDP 往返延迟**可达数百毫秒，前置的截图 / 结构断言会吃掉这 3.4s 窗口，导致第 1 关误选负门，随后「level 恒为 1」级联产生 20 条重试断言与关卡断言误报。
2. 旧 `play_level()` 每轮轮询都用 `done` 下标重新对准一次（约 5 次 CDP/轮），往返越多越容易错过门组窗口。
3. 旧「无可见元素重叠」断言把 `.overlay` 计入配对：该元素用 `position:absolute;inset:0` 铺满**居中 480px 的 `#stage`**（并非铺满视口），HUD 三个 `.hbtn` 与它属设计上的前后分层；**浮层可见时该断言恒报 3 处重叠**，与 QA 09:xx 轮「恰好在无浮层状态测量」的 0 结果不一致。

**加固（仅改 `tests/browser_check.py`，`index.html` 一行未动）**：

| 改动 | 内容 |
|---|---|
| 预规划 + 缓存 | 关卡开始一次性算出每组目标 lane、缓存 canvas rect，不再每轮重算 |
| 主动对准 | S2 阶段只在 `activeGroup`（即将判定的门组）变化时对准，并可追赶最新组，避免漏组 |
| 闭环确认 | 新增 `align_verified()`，用只读 `targetX` 确认输入已生效，丢失时重试 3 次 |
| 确定性起点 | 先完成第 0 组对准，再按 `Space` 显式跳过 2s 预览，使 S2 从「已对准」时刻开始；轮询改用 Python 侧 `time.sleep(0.04)` |
| 重叠断言 | 排除铺满 `#stage` 的背景容器，只检测前景可见控件之间的非预期重叠 |

**验证**：

- 中间诊断轮（r4，负载仍 15–40）：http 39 / file 35 失败，日志 `browser-r4-*.log` 保留为诊断证据；据此定位并补齐「先对准再跳 S1」的确定性起点。
- 加固后同一脚本、同一份 `index.html` 全新重跑（r5，`browser-r5-*.log`）：

| 协议 | 时间 | 通过 / 合计 | 失败 | 退出码 | consoleErrors | rAF 样本 | 平均 fps | 6 组门 fps |
|---|---|---|---|---|---|---|---|---|
| `http://` | 23:02:22 | **284 / 284** | **0** | 0 | `[]` | 41 | **60.61** | **60.59** |
| `file://` | 23:08:01 | **285 / 285** | **0** | 0 | `[]` | 41 | **60.56** | **61.12** |

- 两轮 `maxGroups=6`（断网第 12 关样本），`seg_fps()` 走 `if six` 分支通过；21 张截图由本轮重新生成，team-lead 目视复核 `V-6_win_lv1.png`（「第 1 关 · 清空 / +27 / 剩余兵力 37 / 下一关」）与 `V-5_boss_battle.png`（BOSS 血条 + 深紫剪影 + 900 兵力楔形阵 + 密集弹幕），确认为绿色轮证据，此前失败轮覆盖的截图已全部刷新。
- 本轮后复跑三个 Node 脚本仍全绿：26 项 API PASS / 9296 断言 / 静态硬违规 0；3 个 `.js` `node --check` 与 `browser_check.py` `py_compile` 全 OK。

**文档一致性**：同步订正 `tests/README.md`（截图 24 → 21 张、最终轮结果口径、高负载加固与重叠断言说明），并在 `docs/ARCHITECTURE.md` 头部加入「执行基线优先级提示」，明确 A-9~A-13 中被 `SPEC-UNIFICATION.md` 覆盖的可执行数字（28 项 API / A-10 透视公式 / T11）不落地，避免架构文档自称「最终规格」造成误读。

---

## 6. 视觉效果：截图清单与目视评价

截图落盘 `tests/screenshots/`。以下评价均为 **QA 本人用图像查看工具逐张目视** 后给出，非「仅保存」。

### 6.1 截图清单

| 编号 | 文件 | 内容 |
|---|---|---|
| V-1 | `V-1_home.png` | 首页 |
| V-2 | `V-2_s1_preview.png` | S1 门组预览 |
| V-3 | `V-3_s2_run.png` | S2 跑酷 / 立体闸门 |
| V-4 | `V-4_gate_hit.png` | 穿门飘字 |
| V-5 | `V-5_s3_battle.png` / `V-5_boss_battle.png` | S3 战斗 / Boss 战 |
| V-6 | `V-6_win_lv1..5.png` | 胜利结算（含第 5 关 Boss） |
| V-7 | `V-7_fail.png` | 失败浮层 |
| V-8 | `V-8_help.png` | 帮助 / 资源健康面板 |
| 视口 | `viewport_320x568 / 375x667 / 430x932 / 1280x800 / 1920x1080.png` | 五视口 |
| 灰阶 | `grayscale_in_game.png` | 色盲模拟（关卡内门组预览场景） |
| 动效 | `reduced_motion_in_game.png` | prefers-reduced-motion（同一场景） |
| 补充 | `probe_keyboard_s3.png` | 键盘通关时的 S3 战斗画面（修复验证探针） |

> **命名真实性（方案 A，本轮修正）**：`seg_responsive()` 原先对同一「当前页面状态」连拍 3 张却分别命名为 `grayscale_V-1_home / V-3_s2_run / V-4_gate_hit`（reduced_motion 同理连拍 2 张），文件名与内容不符，属验证证据失真（非产品缺陷）。已改为每种条件各截 1 张并如实命名 `grayscale_in_game.png` / `reduced_motion_in_game.png`，删除 5 张误导性旧文件。**灰阶与 reduced-motion 截图均取自关卡内门组预览场景，并非首页 / S2 跑酷 / 穿门的重拍。**

### 6.2 逐屏目视评价

**首页（V-1）**：深蓝渐变背景 + 居中卡片，标题「HONEST GATE ZOMBIES / 数字门 · 打僵尸」，副标题「没有隐藏玩法，没有骗人广告」，青色主按钮 [开始游戏] 视觉层级最强。触屏 / 键盘 / 鼠标三行操作图示（↔ / A D / 拖）图标与文字对齐、清晰可读；底部「小队伍选加法，大队伍选乘法」「清空本关全部僵尸即过关，失败可无限重试」完整。无空白、错位、截断，无广告 / 登录 / 礼包 / 内购元素。

**S1 门组预览（V-2）**：本关 2 组门、每组 3 道，左侧标注「第 1 组 / 第 2 组」，HUD 我方兵力 10（黄）/ 敌方战力 30，顶部「本关门组预览 · 点击或稍候开始」，底部「按住左右滑动，对准蓝色正门」。正负门用红 / 青蓝边框 + 运算符双重编码（-10 / ×2 / -3、×2 / -3 / ×3），透视跑道与僵尸剪影已有纵深。无重叠或截断。

**S2 跑酷（V-3）**：三道立体闸门带玻璃高光与扫描线，中间正门有白色虚线对准高亮 + 底部指示三角，队伍位于跑道近端。透视网格、远景城市剪影、散布的僵尸与路侧灯柱构成明确的 2.5D 纵深。红 / 青配色 contrast 充足，运算符（-10 / ×2 / -3）字号清晰。

**穿门飘字（V-4）**：黄色「+10」「×2」运算飘字带深色描边，HUD 我方兵力由 10 更新为 20，与 `applyGate` 链一致；门玻璃高光、粒子、队列与僵尸潮同屏但飘字不遮挡 HUD。上下两组门框层次分明，无文字截断。

**S3 战斗（`V-5_s3_battle.png` / `probe_keyboard_s3.png`）**：这是用户重点关注的「僵尸潮与弹幕群体感」——**充分达成**。画面顶部是密集的紫红色僵尸纵深阵列（远景成排 + 中景散布），近端是放大的青色楔形我方方阵（成排成列、前列少后列多），中间有大量黄色交叉弹幕斜线 + 白色圆形弹丸/命中粒子，形成明确的「群体对群体」交火感。**门框已隐藏**，不遮挡战斗画面。HUD 我方兵力 40 / 敌方战力 29 清晰，底部「自动开火，清空僵尸」，背景暗红渐变强化战斗氛围。无错位、无截断、无异常空白。

**Boss 战（`V-5_boss_battle.png`）**：与普通 S3 的区别清晰可辨——左上多出「第 5 关 / BOSS 关」标签、顶部有紫红渐变的独立 **BOSS 血条**、画面中上方有带发光轮廓的**深紫色大型 Boss 剪影**、屏幕暗角与边缘泛红更重、我方楔形方阵规模显著放大（兵力 900，铺满左下）、敌方战力 79、底部提示改为「关底 Boss 出现了」。弹幕、白色弹丸与紫红僵尸纵列依旧密集，门框同样隐藏。血条与 HUD 无重叠、无截断，层级清楚。

**Boss 胜利结算（V-6_win_lv5）**：`CLEAR / 第 5 关 · 清空 / 僵尸已全部清空`，三格数据「本关增兵 +874 / 剩余兵力 892 / 最高关 5」，[下一关] 主按钮。数字与文案对齐、层级清楚，无广告 / 复活 / 礼包元素。

**失败浮层（V-7）**：`RETRY / 再来一次，不看广告`（完整中文，无 `&#` 乱码）/「兵力不足，免费重试本关，不扣任何东西」/ [重试本关]。**无任何复活、看广告、跳过、续命、分享按钮**，与诚实设计一致。卡片居中、留白合理，无截断。

**帮助面板（V-8）**：`HELP / ASSETS / 操作与资源健康`，含「怎么玩」「操作」说明，资源健康区显示「外部请求数 0」「游玩是否受阻 否」，表格为「资源 | 状态 | 来源/原因」三列，视口内可见 8 行全部 `generated`；[刷新资源] / [返回] 按钮完整。文字无截断、表格无重叠。

### 6.3 灰阶 / reduced-motion / 五视口

- **灰阶（`filter:grayscale(1)`，`grayscale_in_game.png`）**：截图取自关卡内门组预览场景（多道门分两排），非首页。文字、HUD 数字（我方兵力 25 / 敌方剩余 75）、底部提示、门框轮廓在失去颜色后仍清晰可读，对比度足够。**正负门的红/青颜色编码完全失效**，但仍可通过「虚线（当前对准） vs 实线边框」与清晰的运算符号文字标签（如 `÷2 / ×3 / -8 / ×2`）区分——信息无丢失，这是「四重编码」设计的预期效果。如实记录：灰阶下**不能仅靠明度**区分正负门，需读符号或边框样式；team-lead 独立目视结论一致（虚线 vs 实线 + 文字标签、HUD 25/75 完整可读）。
- **reduced-motion（`reduced_motion_in_game.png`）**：同一关卡场景布局正常，门组、队伍、僵尸、HUD 均正常渲染，粒子/动效明显收敛，文字与按钮可读，无错位、无空白、信息完整。
- **320×568**：最窄视口下 4 组门预览完整居中，组号与运算符无截断，无横向裁切，按钮不重叠。
- **430×932**：4 组门预览 + 队伍 + HUD 布局舒展，留白合理。
- **1920×1080**：游戏画面保持竖屏比例 letterbox 居中，左右为深色留白（正常设计，非裁切），HUD 与门组清晰；无元素重叠。

### 6.4 视觉结论

V-1~V-8 及补充截图**无空白、无错位、无文字截断、无元素重叠**；S3 僵尸潮与交叉弹幕具备群体感与纵深感；正负门在彩色下有颜色 + 符号 + 形状 + 对准高亮多重编码，灰阶下仍可通过运算符区分。视觉效果达到验收要求。

---

## 7. 失败项及归零情况

| # | 失败项 | 出现轮次 | 条数 | 根因（均为测试脚本） | 修复 | 最终状态 |
|---|---|---|---|---|---|---|
| 1 | `失败#N 重试后 entryPower 与首次一致` | 第 1 轮 file | 20 | 比较基准误用第 1 关 `P0(1)=10`，实际重试在第 6 关 `P0(6)=21` | `seg_fail_retry` 用 `d6.entryPower` 作 `base_entry`，断言改名为「与首次进入该关一致」 | ✅ 归零 |
| 2 | `有帧率采样` | 第 1 轮 file | 1 | `play_level` 的 `done>=gc` 提前 break，错过 S3 观察窗口 | 移除提前 break，循环持续到 `phase in ('S3','S4')`，60s 独立超时兜底；`done<gc` 时才继续对准 | ✅ 归零 |
| 3 | `键盘 独立通关一关` | 第 1 轮 file | 1 | `keyboard.press()` 单帧不产生「按住连续积分 360 px/s」位移 | 改 `keyboard.down(k)` + 按住 110ms + `up`，闭环读 `currentLane`，上限 40 次 | ✅ 归零 |
| 4 | `采集到 6 组门(gateCount>=6)场景的 fps 样本` | 第 2 轮 http + file | 2 | `main()` 把 `seg_fps()` 排在断网 12 关之前，6 组门样本尚未采集 | 把 `seg_fps()` 移到 `seg_offline()` 之后 | ✅ 归零 |

**合计 24 条失败 → 全部归零；QA 断言集内实现侧缺陷 0 条。**（另有 2 项由 team-lead 独立复核发现并已修复的实现侧问题，见 §5.11。）

另有一处「测试脚本覆盖缺口」而非失败：阶段 B 第 8 项要求的「只读性 + 逐屏诚实性」与「帮助面板 12 条资源完整性」原本未编写断言，已在第 2 轮前补齐（新增 `check_honesty()`、`__GAME_DEBUG__`/`__ASSET_HEALTH__` 写入无效断言、12 条资源 id 断言），并通过局部探针与最终轮验证。

---

## 8. 遗留问题与观察（非阻断）

1. **灰阶下颜色编码失效**：正负门在 `grayscale(1)` 下明度接近，需依赖运算符文字与虚线对准框区分。符号清晰可读，属可接受设计，但若追求极致无障碍，可考虑给负门增加形状差异（已有门框开口形状差异）或纹理。
2. **帮助面板 12 条资源表在 390×844 视口内可见约 8 行**，其余在滚动/可视区外；DOM 数据完整为 12 条，非缺数据。宽视口或滚动后可查看全部。
3. **灰阶 / reduced-motion 截图命名已修正（方案 A，本轮）**：原先 `grayscale_V-*` / `reduced_motion_V-*` 对同一场景连拍、命名与内容不符，属验证证据失真（非产品缺陷）。已把 `seg_responsive()` 改为每种条件各截 1 张并如实命名 `grayscale_in_game.png` / `reduced_motion_in_game.png`，删除 5 张旧文件，报告 §6.1 / §6.3 已同步；两种条件下信息均完整可读。
4. 静态审计 3 条软提示（`fetch` 守卫内 1 处、`localStorage` try-catch 6 处、浮点字面量 267 处渲染层颜色）经实机「零外部请求 + 1–1000 关 BigInt 精确」兜底确认均为非违规，保留为软提示。
5. **极高 CPU 负载下的测试脚本时序敏感性（非产品问题，已缓解）**：共享主机 load average 达 36–49 时，Playwright CDP 往返延迟会挤压「2s 预览 + 1.4s 首门组」的选门窗口，旧 `browser_check.py` 会误选负门并级联误报；同一负载下独立试玩仍 5/5 全胜。已通过预规划 / `activeGroup` 主动对准 / `targetX` 闭环 / 显式跳过 S1 / 重叠断言修正完成加固，并在 23:02（http）与 23:08（file）用同一份 `index.html` 全新重跑再次取得 0 失败（§5.12）。正常负载下不触发；若未来在更极端的共享主机上复跑，建议单独占机。
6. **无阻断性遗留问题**。QA 断言集内未发现实现缺陷；team-lead 独立复核发现的 2 项实现侧问题已修复并回归（第 5.11 节），当前版本无已知待修项。

---

## 9. 交付物清单

| 文件 | 说明 |
|---|---|
| `tests/test-results.json` | **加固复核轮**（file，23:08:01，285/285 / 0 失败）结构化结果，每项含 `name / ok / expected / actual / detail` |
| `tests/test-results-http.json` / `tests/test-results-file.json` | 加固复核轮双协议结果（http 23:02:22 为 284/284；file 与 `test-results.json` 同源，均 0 失败） |
| `tests/test-results-http-final.json` / `test-results-file-final.json` | QA 最终轮双协议结果备份（09:16 / 09:22，均 0 失败） |
| `tests/test-results-round1.json` | 第 1 轮基线结果（248/270） |
| `tests/browser-round1.log` | 第 1 轮运行日志 |
| `tests/browser-round2-http.log` / `tests/browser-round2-file.log` | 第 2 轮日志 |
| `tests/browser-final-http.log` / `tests/browser-final-file.log` | QA 最终轮双协议日志 |
| `tests/browser-r3-http.log` / `tests/browser-r3-file.log` | 方案 A 改名后重跑的双协议日志（均 0 失败） |
| `tests/browser-r4-http.log` / `tests/browser-r4-file.log` | 高负载诊断轮日志（保留为 §5.12 根因定位证据，非交付判定依据） |
| `tests/browser-r5-http.log` / `tests/browser-r5-file.log` | **加固复核轮双协议日志（rc=0，0 失败）** |
| `tests/screenshots/*.png` | 共 **21 张**：V-1~V-8（含 `V-5_s3_battle` / `V-5_boss_battle`）+ 五视口 + `grayscale_in_game` / `reduced_motion_in_game` + `probe_keyboard_s3` |
| `docs/TEST_REPORT.md` | 本报告 |

---

## 10. 结论

在 `file://` 与 `http://` 双协议下，以真实点击 / 键盘 / 触屏 / 鼠标拖拽完成 40+ 关次试玩，覆盖功能、状态机、数值、资源自愈、断网、只读性、诚实性、响应式、可访问性与视觉表现，**最终轮 `http://` 284/284、`file://` 285/285 全部通过，退出码 0，控制台错误 0，外部请求 0，平均帧率 60.57 / 60.58 fps，6 组门场景 60.98 / 60.97 fps**。三个 Node 脚本亦全绿（26 项 API / 9296 断言 / 静态硬违规 0）。

按智能路由判定，QA 三轮中出现的 24 条失败 100% 为测试脚本自身缺陷并已全部归零。除此之外，team-lead 独立复核另发现并修复了 2 项 QA 断言集外的实现侧问题（`favicon` 404、`simulateFailure`/`reset` 异步竞态），并完成 `README.md` 口径订正；修复后三个 Node 脚本与双协议最终轮均重新回归通过（§5.11）。

交付后又在 load average 36–49 的共享主机上做了一次**全新复现性复核**：暴露的是测试脚本的高负载时序假设（非产品缺陷，同一负载下独立试玩 5/5 全胜），已对 `browser_check.py` 完成 5 项加固，并在 23:02:22 / 23:08:01 用**同一份 `index.html`（未改动一行）**重新跑出 `http://` 284/284、`file://` 285/285、失败 0、退出码 0、`consoleErrors=[]`（§5.12）。**当前交付版本无已知缺陷，项目可交付。**

---

## 11. 重构回归验证：士兵/僵尸写实化 · 关卡加长 · 陷阱常驻（2026-11-10 续）

> 触发：用户指令「士兵和敌人（僵尸）太假，联网充分调查清楚，然后重构优化，而且每一关时间太短，关卡内的陷阱之类的样式也太少，等于没有。注：一些问题、结论必须二次分析确认。」

### 11.1 重构内容
1. **士兵/僵尸写实化**（联网调研：部件拆分异步运动、厚描边赛璐珞、2-bone IK 行走、僵尸驼背前伸/破衣/凹陷眼窝/腐色）。重绘 `drawUnit`（头盔/护甲/持枪/步枪枪口火光/多色变体 + 摆腿行走）与 `drawHorde`（驼背前倾/前伸爪臂/破衣轮廓/蹒跚相位/多变体），全部 Canvas 2D 程序化、零资源、确定性。
2. **关卡加长**：`gateCountFor=3+floor(level/3)`（封顶 6）替代原 `2+floor(level/3)`；S2 节奏 `GROUP_LEAD/INTERVAL/TAIL` 放慢约 25–30%，结算/战斗时长同步加长。
3. **陷阱常驻**（本轮二次分析确认后重点修复）：原 `rng()<0.5` 仅 50% 概率放 1 个、且只落非正门 lane、远距过小 → 实战「等于没有」。改为「`rng()<0.72` 铺满全部非正门 lane，否则至少 1 个」；`drawTraps` 新增**红色危险警示带 + 黑黄斜纹危险条**，精灵放大 1.25×；4 种类型 `spike/saw/fire/crusher` 按 `(group*3+lane+li)%4` 循环。

### 11.2 Node 三层验证（全绿）
| 脚本 | 结果 |
|---|---|
| `tests/extract-core.js` | **API 数量断言 PASS（26）** |
| `tests/core.test.js` | **通过 11844 / 失败 0 / 合计 11844**（较重构前 11097 增加：陷阱不变量在更多陷阱组上复算） |
| `tests/static-audit.js` | **硬违规 0 / 判定 PASS** |

### 11.3 真实浏览器验证（Playwright + 本机 Chrome，headless）
- **陷阱样式齐现且常驻**（80 关抽样）：`spike=155 / crusher=148 / saw=129 / fire=118`；**每关必有陷阱组（80/80）**，共 550 个陷阱组；`bestPathAvoidsTraps = true`（100% 可胜不变量保持）。
- **4 关完整真实点击通关**：L1 `10→120→117`（含陷阱扣兵）、L2 `11→297→294`、L3 `13→468→465`、L4 `15→1620→1616`，全部 **WIN**；`ASSET.ext=0`（零外部请求）、`CONSOLE=[]`、`PAGEERR=[]`。
- **二次分析确认**：第一遍「陷阱已存在」结论在数据结构层成立、在玩家体感层不成立（频率过低+渲染过弱），本轮已修订；修复后 `verifySolvable`/`generateLevel` 重生机制仍保证每关有正门、最优路径无陷阱，确定性/零外链/26 项 API 不变，回归全绿。

### 11.4 重构截图（新增）
| 文件 | 内容 |
|---|---|
| `tests/screenshots/refactor_trap_on_2.png` | S2 近景：左侧 `-10` 门尖刺、右侧 `-3` 门压锤/锯齿，中间 `×2` 正门安全 |
| `tests/screenshots/refactor_s3_zombies.png` | S3 战斗：写实士兵（头盔/护甲/步枪/枪口火光）自动开火 vs 驼背前伸僵尸群 |
| `tests/screenshots/refactor_s2_seq03.png` / `refactor_s2_seq05.png` | S2 不同推进时刻的门组与陷阱分布 |
| `tests/screenshots/refactor_win.png` | 第 1 关清空结算浮层 |

### 11.5 结论
用户三项诉求（士兵/僵尸太假、关卡太短、陷阱等于没有）已联网调研 → 二次分析确认 → 重构实现 → 真实浏览器验证，全部通过；未引入外部资源、未破坏确定性、未改动 26 项 Core API、维持 100% 诚实玩法与单文件 `file://` 可玩。

---

## 12. 视觉升级 V2 / V2.1 全量回归（2026-11-12）

> 触发：用户指令「还是联网充分调研清楚，也可以找相关游戏/小程序的截图、视频进行视觉识别和学习，现在就像个简短无缺的像素游戏，体验还不好」。
> 调研、16 张官方截图识别、差距清单 D1–D10、二次分析确认 9 条详见 `docs/VISUAL-UPGRADE.md`；实现后**又做了两轮截图复核**，新发现并修复 D11–D19，见该文档第七节。

### 12.1 改动范围（严格只落表现层）
- `index.html` CSS：`<meta color-scheme>` 与 30+ 选择器全量明亮化（首页 / 结算 / 帮助 / HUD 按钮 / 徽章 / 资源健康表）。
- `game-render` IIFE：`COL`、`themeTop`、`beginFrame`、`drawBackground`（太阳/云/沙丘）、`drawSkyline`、`drawFarHorde`、`drawTrack`、`drawRoadside`、`drawGate`、`drawMassUnits`、`drawCrowdMass`、`drawBadge`、`drawProgress`、`drawEffects`、`drawUnit`、`drawLeg`、`drawHorde`、`drawZLeg`、`drawBoss`、`drawHud`、`drawOverlay`、`buildScene`。
- `game-session`：**仅** `buildState` 新增 `groupCount`（上一轮已加）与 `resolveGroup` 的装饰性 `gateBurst`；本轮未新增任何 Session/Core 逻辑。
- **未改**：Core 26 项 API、`applyGate / bestPath / resolveBattle / verifySolvable`、`buildGroups` 陷阱生成、`S.gates / S.traps`、`buildDebugSnapshot`、状态机时序、输入映射、`laneCenterX`、投影函数、BigInt 数值链路、音频开关。

### 12.2 Node 三层
| 脚本 | 结果 |
|---|---|
| 7 个 `<script>` 块 `new Function` 语法检查 | **7 / 7 OK，0 失败** |
| `tests/extract-core.js` | **API 数量断言 PASS（26）**，未增未删 |
| `tests/core.test.js` | **11844 / 11844，失败 0** |
| `tests/static-audit.js` | **硬违规 0 / 判定 PASS**（core 块无 `Math.random`、无 DOM/IO、无 `ctx.*`） |

### 12.3 真实浏览器（Playwright + 本机 Chrome，headless）
- **截图脚本** `/tmp/wb_v2_shots.py`：首页 / S1 预览 / S2 五连拍 / S3 战斗 / S4 结算，`RES {"ext":0}`、`CONSOLE []`、`PAGEERR []`、`win=True`。
- **4 关真实点击通关**：L1 `10→120→117`、L2 `11→297→294`、L3 `13→468→465`、L4 `15→1620→1616`，全部 **WIN**；`ASSET.ext=0`、`CONSOLE []`、`PAGEERR []`。证明渲染裁剪、人海层、新特效均未影响判定与可胜性。
- **目视二次复核**：`v2_s2_02.png` 门组不再堆叠（同屏 ≤2 组）、远景人海为可辨圆润小人、近景士兵为明亮蓝白个体；`v2_06_s3.png` 跑道纯白、短曳光弹取代激光网格、无残留危险带；`v2_01_home.png` / `v2_07_s4.png` 白卡蓝字与游戏内统一；`grayscale_in_game.png` 正负门四重编码仍可辨。

### 12.4 交付级双协议回归
| 协议 | 结果 |
|---|---|
| `browser_check.py --protocol file` | **285 / 285，失败 0** |
| `browser_check.py --protocol http --port 8765` | **284 / 284，失败 0** |

覆盖范围：默认健康状态与零外部请求、1–5 关（含第 5 关 Boss）、20 次失败免费重试、资源降级注入、帮助面板 V-8、5 视口、灰阶、reduced-motion、三端输入独立通关、断网 12 关、帧率、控制台错误。
- **6 组门满屏帧率**：`fpsSamples` 平均 **60.45 fps**（断言阈值 ≥45），与升级前 60.5–61.1 fps 持平 → 新增人海层/沙丘/道具未造成性能回退。
- `consoleErrors=[]`，`externalRequestCount=0`，`performance.resource` 无 http(s) 外部项。

### 12.5 新增 / 更新截图
| 文件 | 内容 |
|---|---|
| `tests/screenshots/v2_01_home.png` | 明亮白卡首页 |
| `tests/screenshots/v2_02_s1.png` | S1 明亮门组预览 + 大号关卡标题 |
| `tests/screenshots/v2_s2_00..04.png` | S2 五连拍：门组推进、陷阱、人海与数字气泡 |
| `tests/screenshots/v2_06_s3.png` | S3 明亮战斗：圆润蓝军 vs 亮色尸潮 + 短曳光弹 |
| `tests/screenshots/v2_07_s4.png` | 明亮结算卡 |
| `tests/screenshots/grayscale_in_game.png` / `reduced_motion_in_game.png` | 可访问性证据 |
| `tests/screenshots/viewport_*.png` | 5 视口响应式证据 |

### 12.6 结论
视觉升级 V2/V2.1 已完成「调研 → 识别 → 确认 → 实现 → **两轮真机截图复核** → 全量回归」闭环，全部硬约束保持，双协议 0 失败，帧率无回退；**当前交付版本无已知缺陷，可交付**。

---

## 13. 体验重构 V3：节奏 / 决策 / 战斗 / 手感（2026-11-13）

> 触发：用户指令「重构升级，游戏体验太差，不仅视觉形象、体验都很哈，游戏体验也很差，**随便动几下一个关卡就结束了**，请充分联网调研专业资料、方案、经验等，全面优化、重构、升级」。
> 延续硬性要求：「一些问题、结论必须**二次分析确认**」——本节 13.3、13.4 记录了被否决的两版方案，13.6 记录了**代码写完仍不成立**、靠真机截图才定位的 11 项缺陷。

### 13.1 联网调研：先把「太短」量化

| 来源 | 关键结论 | 对本作的判决 |
|---|---|---|
| innovecs（hyper-casual 关卡时长拆解） | 单关 **15–45 秒**；首次 session **45–90 秒** | 旧设计 3–6 组门 = **9–14.7 秒**，低于下限 40%，必然「还没进入状态就结束」 |
| 9-pixels 对 40 款榜单产品统计 | **10 秒关太浅，建立不了情绪投入**；首 session 中位 45–90 秒 | 旧值正落在被明确点名的「10 秒」档，用户的体感判断与数据一致 |
| easyhub（数字门品类实机） | 单次 run **60–90 秒** | 新设计 41–52 秒，落在该品类合理侧（且本作失败可立即重试、无加载等待） |
| Count Masters 玩法拆解 | 小队伍拿加法、大队伍拿乘法；陷阱/红门是**代价**不是选项；关键是读「两道门的数字」而不是红蓝颜色 | 旧设计「每组一道乘法、永远拖到蓝门」= **没有决策**，只是位移 |
| Juice / game-feel 清单（hitstop、震动分级、音高递进、动态范围、reduced-motion） | hitstop **30–80ms** 表现重量；轻击 2–5px、重击 8–15px；连续同质事件用音高递增回报；**如果每个事件都震，就再没有事件值得震**；juice 不得掩盖可读性 | 直接成为 13.5 的设计准则 |

### 13.2 节奏重构（「随便动几下就结束」的正面修复）

| 项 | 旧值 | 新值 |
|---|---|---|
| `gateCountFor(n)` | `3 + floor(n/3)`，封顶 6 | `20 + floor(n/2)`，Boss 关 +3，封顶 **30** |
| 第 1 关组数 | 3 | **20** |
| 第 5 关组数 | 4（Boss） | **25**（Boss） |
| 第 20 关起 | 6 | **30** |
| `GROUP_LEAD / INTERVAL / TRAVEL / TAIL` | 与 3–6 组匹配的短节奏 | **2100 / 1400 / 1150 / 1800** |
| 战斗时长 | 2000ms（Boss 3400ms） | **9500ms（Boss 13000ms）** |
| 单关实测（S2 + S3） | **9.5 秒** | **41.0 / 42.7 / 42.7 / 44.2 / 52.1 秒**（L1–L5） |

### 13.3 数值曲线重构（第一版被否决 → 二次分析）

**被否决的第一版**：20 组每组一道乘法 → L1 最优兵力 **7.55B**、L20 达 **19.3Qa**，HUD 无法阅读，且「每组都是乘法」等于没有选择。

**采用方案：倍率预算制**
- `spurtCount = max(1, floor(g/12))`（每 12 组一次冲刺门）、`riskCount = max(2, round(g*0.12))`（约 12% 风险门）；其余组为纯加法 / 负门。单关倍率门 3–5 个。
- **加法门基准从 `P0` 改为「本组预期兵力」**：`expect = expect * 147 / 100` 逐组递增，`addDoor(tenths) = expect * tenths / 10`。
  真机截图证据：旧实现出现「我方 2.39K、门上写 +15」，加法分支等于不存在；改后加法与 ×2 同量级，才是真选择。
- **组型三态**：`risk`（正门挂 ×2/×3 陷阱，安全门是 ×2 或大加法）、`spurt`（冲刺门）、`normal`（加法对减法）。
  风险组里「×3 扣 25% 后 = 2.25」比安全 ×2 更优，但「×2 扣 25% 后 = 1.5」比安全 ×2 更差 —— 所以「看到红门就绕开」和「看到红门就冲」**都是错的**。
- **不变量**：每组必有至少一道负门（I-4 保留）；每组必有至少一道「正门且无陷阱」（防御性保底，保证 `bestPath` 必可解）。

**敌方兵力校准（三次迭代，两次自我否决）**

| 版本 | 校准口径 | 结果 | 判定 |
|---|---|---|---|
| v1 | 最优路径 × 42% | 稳妥走法仅 **18/100** 关可过，玩家被迫赌博 | **否决** |
| v2 | 稳妥路径 × 88% | 真实输入余量仅 1.14 倍，QA「选首个安全正门」实测 **L1 win=False** | **否决** |
| v3（交付） | 稳妥路径 × **72%** | 余量 **39%**，L1 `best/enemy = 1.40`；L1–L200 稳妥路径 100/100 可过 | **采用** |

其中 v2 的否决来自「二次分析确认」：断言全绿不等于玩家能过——QA 脚本按「首个正门」走，与数学最优差 20%+ 时就翻车。因此同时修了两处：敌方口径放宽到 72%，并给 `__GAME_DEBUG__` 增加只读 `bestPath` 供 QA 稳定通关。

### 13.4 战斗阶段：从 2 秒演出 → 9.5–13 秒可交互

- `CONSTANTS.BATTLE_MS = 9500`、`BOSS_BATTLE_MS = 13000`，三波推进（`battleWave = floor(p*3)`）。
- 战斗中 `inputLocked = false`，玩家横移集火；集火点 `focusX = 240 + A·sin(t·1.15 + wave·1.9)`（**确定性**，无随机）；
  每 110ms 采样一次精度 `clamp(1 - |teamX - focusX|/215, 0, 1)`。
- 评级 `gradeFor(score, win)`：≥0.74 **S**、≥0.52 **A**、≥0.30 **B**，否则 C；失败恒 D。结算卡显示「战斗评级（只影响评价，不影响过关）」+ 集火精准度 + 最高连击。
- **诚实性复核（关键）**：`resolveBattle(入口快照)` 在 S3 开始时**一次性**锁定 `S.outcome`；集火只影响 `focusScore → grade`，
  **不写入 `power` / `outcome` / 下一关起始值**。因此「拖不拖」不会改变胜负，100% 可胜承诺与「数值可复现」均不变。

### 13.5 手感层

| 项 | 实现 | 依据 |
|---|---|---|
| 跟随 | `teamX += (target - teamX) * (1 - Math.exp(-dt/88))` | 88ms 时间常数的指数跟随：有重量、不瞬移、不拖沓 |
| 顿帧 hitstop | 普通 38ms / 大倍率(≥×3) 70ms / 踩陷阱 85ms；冻结期间只让 `tickEffects(dt*0.25)`，画面照常渲染 | 30–80ms 是「重量」的主要来源；只冻推进不冻渲染，避免掉帧假象 |
| 震动分级 | 轻门 2px / 正门 4px / 大倍率 7px / 陷阱 9px | 反馈必须有动态范围 |
| 连击与音高 | 只有「正门 + 未踩陷阱 + 兵力增加」累计 `combo`；音效按 `Math.pow(2, min(9,combo)/12)` 半音递进；combo≥3 弹「连击 xN」 | 连续同质事件用音高递增回报 |
| reduced-motion | hitstop / 震动 / 光爆 / 粒子 / 集火光带全部关闭，判定与数值不变 | 尊重系统偏好 |

### 13.6 视觉层：真机截图逐项定位的 11 个缺陷（D20–D30）

代码全绿之后，靠 8 轮真机截图目视才发现的问题：

| 编号 | 截图证据 | 根因 | 处置 |
|---|---|---|---|
| D20 | 近景方阵把门板与地面陷阱盖住一半 | 绘制顺序为 traps→gates→allies，且 `TEAM_Z=0.86` 太靠前 | 顺序改 **horde→boss→allies→gates→traps**；`TEAM_Z` 0.92；门 `z>0.90` 即退出绘制 |
| D21 | `+2.76K` / `-1.72K` 撑破门板并与邻门相撞 | 门值字号固定 | `drawGate` 按门洞宽度 `maxW = laneW*0.86` 自适应缩字 |
| D22 | 地面陷阱被近景队伍完全挡住 = 没有 | 陷阱画在地面 | 门板加**黄黑警示带 + `!` 三角**（`g.trapped`），双通道提示 |
| D23 | 队伍左侧另有一团剪影，像两群「幽灵人」 | 远景人海 `spreadU` 过宽且不跟随队伍 | 我方 `spreadU` 0.26、`far/near` 0.50/0.70，并加 `uCenter = teamU` |
| D24 | S2 路面「到处是人和怪」，读不出前后 | `hordeSpan` 过宽 | S2 收窄到 **0.22**（S3 仍 0.62） |
| D25 | 场景内敌方数字气泡正好压住远处门组 | 气泡与 HUD 信息重复 | 移除场景内敌方气泡（juice 不得掩盖状态） |
| D26 | `+391` 白字在亮天空上几乎看不见 | 纯白描边字 | 加深色胶囊底 + 由 y=130 移到 y=196 |
| D27 | Boss 只是地平线上的紫色小人，撑不起 Boss 关 | `boss.z = 0.06`（projectY≈257、体宽 44px） | z→**0.26**（体宽≈59px、高≈105px）+ 重画为「腿/收腰躯干/手臂/肩刺/黄眼/獠牙」的丧尸王 + 落地影 + 深紫外描边 |
| D28 | S3 顶部显示「0 / 20 组门」但连击 x15，进度条为空 | `nextGroup` 在非 S2 阶段为 `null` → 回落到 0 | 非 S2 用 `gateChoices.length`（S3/S4 显示 20/20 满格） |
| D29 | 地平线上两团黑色涂鸦，还压住集火准星与「集火」标签 | S3 每 2 帧弹一个 24px 粗描边的「+1」浮字，远景堆叠 | 移除该浮字；击杀反馈由命中火花 + HUD 敌方余量承担 |
| D30 | `+18` 是挂陷阱的门，但门板上**没有**黄黑警示带、也没有 `!` 三角（D22 的修复等于没生效） | `buildScene` 重新投影门对象时只复制了 `positive/highlighted` 等字段，**把 `trapped` 丢掉了**；而地面尖刺在远景只是三个小三角，看不出是陷阱 | 投影时补 `trapped:!!g.trapped`；复拍确认黄黑斜纹带与 `!` 三角出现在门板顶部 |

### 13.7 Node 三层（全绿）

| 脚本 | 结果 |
|---|---|
| 7 个 `<script>` 块 `new Function` 语法 | **7 / 7 OK，0 失败** |
| `tests/extract-core.js` | **API 数量断言 PASS（26）**（未增未删） |
| `tests/core.test.js` | **通过 15809 / 失败 0 / 合计 15809** |
| `tests/static-audit.js` | **硬违规 0 / 判定 PASS** |

`core.test.js` 本轮同步的三处口径变更（均为设计变更，不是放宽断言）：
① `MAX_GATE_GROUPS` 6→30、`BATTLE_MS` 2000→9500、`BOSS_BATTLE_MS` 3400→13000、`gateCountFor(1/5/12)=20/25/26`；
② 独立贪心复算加入陷阱 25% 惩罚（否则与 `bestPath` 口径不一致）；
③ 旧不变量「陷阱只落非正门」被**有意替换**为「陷阱确实会挂在正门上（`risky>0`）」，并新增 L1–L200 三条：每组必有「正门且无陷阱」、`bestPath × 10 ≥ enemy × 11`、稳妥路径必可过关且多数关卡冒险更高。

**测试侧同步（不涉及产品行为）**
- `browser_check.py` 新增 `plan_lanes()`，通关用例默认 `choose='best'` 读只读 `bestPath` 选门。
  原因：敌方按稳妥路径 ×72% 校准后，「首个正门」在风险组可能正挂陷阱（−25%），实测会把**正常通关**判成 `win=False` 假失败。
- `EXPECT_JS` 复算补上陷阱 25% 惩罚。第一版试图用 `d.traps` 反推，结果仍然误报（期望 64860 / 实际 63942）——
  因为 `traps[]` 只保留**渲染窗口内**的陷阱（`z ≤ 0.90`），跨全程反推会漏掉大部分踩坑。
  根因确认后改为在 debug 快照的每道门上增加只读 `trapped` 事实位（不新增 Core API、不参与判定），复算立即一致。
  这条同样是「二次分析确认」的产物：断言失败先怀疑测试口径，再用逐步观测（10→15→33→59→**89**→**201**…）反解出
  `118−118/4=89`、`267−267/4=201`，才确认是漏算陷阱而不是产品缺陷。

### 13.8 真机验证：连续 5 关（含 Boss）

脚本 `/tmp/wb_v3_boss.py`（用 `bestPath` 驱动选门，S3 按住拖动跟随 `focusX`）：

```text
L1 groups=20 boss=False win=True grade=S combo=15 s2=31.5s s3=9.5s
L2 groups=21 boss=False win=True grade=S combo=17 s2=33.2s s3=9.5s
L3 groups=21 boss=False win=True grade=S combo=15 s2=33.2s s3=9.5s
L4 groups=22 boss=False win=True grade=S combo=18 s2=34.7s s3=9.5s
L5 groups=25 boss=True  win=True grade=S combo=18 s2=39.1s s3=13.0s
CONSOLE []   PAGEERR []
```

| 关 | 组数 | 穿门后兵力 | 敌方战力 | 战后兵力 | best/enemy | 单关时长 |
|---|---|---|---|---|---|---|
| 1 | 20 | 63,942 | 45,645 | 59,378 | 1.40 | 41.0s |
| 2 | 21 | 120,855 | 86,847 | 112,171 | 1.39 | 42.7s |
| 3 | 21 | 110,036 | 76,871 | 102,349 | 1.43 | 42.7s |
| 4 | 22 | 221,847 | 159,146 | 205,933 | 1.39 | 44.2s |
| 5（Boss） | 25 | 1,239,752 | 883,912 | 1,151,361 | 1.40 | 52.1s |

集火精准度 0.85–0.92（脚本按 `focusX` 跟随），全部 **S 级**；失败浮层（V-7）与胜利浮层（V-6）文案、按钮、排版均正常。

### 13.9 交付级双协议回归（最终代码）

`browser_check.py` 默认参数（`--retry-count 20`、`--offline-levels 12`）在**最终代码**上完整重跑：

| 协议 | 结果 | 帧率（20–28 组门满屏） | 控制台 |
|---|---|---|---|
| `--protocol file` | **285 / 285，失败 0**，退出码 0 | 41 个 rAF 样本，平均 **60.66 fps**，最低 60.27 | `consoleErrors=[]` |
| `--protocol http --port 8765` | **284 / 284，失败 0**，退出码 0 | 41 个样本，平均 **57.72 fps**；37 个 ≥60.1，4 个约 30.5（L9–L12，未复现） | `consoleErrors=[]` |

> 帧率口径：断言为「平均 fps ≥ 45」。`file://` 41 个样本全部 ≥60.27；
> `http://` 的 41 个样本里 **37 个 ≥60.1**，另有 4 个连续掉到约 **30.3–30.9**，恰好是「断网 12 关」段的 **L9–L12**。
> 同一份代码在 `file://` 的同样 4 关是 **60.7–60.9**，L7/L8 与 L12 之后也都是 60+，因此**不是关卡变长带来的稳定回退**，
> 而是该段出现的一次性环境异常（未能复现，未定位到产品侧原因，如实记录）。
> 两组样本的最大组数均为 **28 组门**，V2 时代为 6 组门 60.45 fps —— 组数翻了 4 倍，帧率仍在 60 档。

覆盖范围与 V2 轮一致：默认健康状态与零外部请求、1–5 关（含 Boss）、连续 20 次失败免费重试、资源降级注入、
帮助面板 V-8、5 视口、灰阶、reduced-motion、三端输入各自独立通关、断网 12 关、帧率、只读性与逐屏诚实性。
单关从 9–14.7 秒拉长到 41–52 秒后，整轮回归耗时从约 8 分钟增加到约 32 分钟——**这是关卡变长的直接证据**。

**回归中暴露并修掉的两个真问题（都属于「断言失败先说清是产品还是测试」）**

| 现象 | 第一反应 | 二次分析结论 | 处置 |
|---|---|---|---|
| 第 1 关「HUD 兵力与运算预期一致」期望 64860 / 实际 63942 | 怀疑 `applyGate` 算错 | 逐步观测 10→15→33→59→**89**→**201** 反解出 `118−118/4=89`、`267−267/4=201`：第 3、4 组是**挂陷阱的 ×2 / ×3**，测试复算漏了 25% 惩罚 | 测试侧补惩罚；`traps[]` 只含渲染窗口内陷阱，故在 debug 快照的每道门上加只读 `trapped` 位 |
| http 并发跑时「键盘 独立通关一关」偶发 `win=False`（283/284） | 怀疑键盘输入在 V3 失效 | 同一份代码在 `file://` 稳定通过；定位为测试侧 `align_keyboard` 每步只推进约 40px，20–30 组关卡里跨 3 道门要 8+ 次起停，间隙卡在 1400ms 判定窗口边缘 | 测试侧改为「按住 + 25ms 轮询 `currentLane`，到位即松键」，随后单独重跑 http 全绿 |

### 13.10 结论

用户三条诉求全部闭环：

1. **「随便动几下一个关卡就结束了」** → 单关从 **9.5 秒** 提到 **41–52 秒**（20–30 组门 + 9.5–13 秒战斗），落在数字门品类实机 60–90 秒的合理侧；
2. **「视觉形象、体验都很哈」** → 11 项真机截图缺陷（D20–D30）逐条修复：门压在队伍之上、陷阱标识上移到门板、Boss 重画为丧尸王、进度计数修正、黑色浮字移除；
3. **「游戏体验很差」** → 决策结构从「永远拖到蓝门」改为「倍率预算 + 风险门」，敌方按稳妥路径 ×72% 校准（稳妥必过、冒险更高），并加入 hitstop / 分级震动 / 连击音高 / 可交互集火 + 评级。

硬约束逐条保持：单文件 `index.html`（3962 行 / 176,527 字节）、零外链（全文无 `http://` / `https://` 字面量）、零构建、`file://` 双击可玩、GitHub Pages 可部署、
26 项 Core API 不变、BigInt 无限关卡、确定性（`Math.random` 仅一处注释）、100% 诚实玩法、100% 可胜。

---

## 14. V4 · 战斗表现重构、全面审查与交付级验证（2026-11-14）

### 14.1 触发与范围

用户反馈：「不止，全面的体验都很差，如射击效果、子弹效果、碰撞效果、对战效果都是，感觉很潦草，要全面打磨升级」，
随后要求「全面检查和审核，挖掘值得改进或修复的地方，逐一处理、测试」「确认没问题则提交推送」。
本轮按编程专家 Pro 六步（分析 → 方案 → 执行 → 验证 → 交付 → 复盘）执行，继承历史硬要求 **「一些问题、结论必须二次分析确认」**：
每条视觉 / 交互结论都必须由真机截图或 debug 快照再确认一次，不以「代码看起来对」作为完成判据。

审查范围覆盖 `index.html` 的 7 个 `<script>` 块（core / audio / session / render / input / bootstrap 等）、
测试套件、工程配置与全部文档；逐项清单见 `docs/V4-AUDIT.md`。

### 14.2 联网调研依据与参数落地

调研 Agent 返回 8 类一手资料（VFX 三阶段时序、Hades 接触帧同步、Game Feel 101、Vlambeer 30 tricks、
hitstop 冷却、粒子上限、枪口焰时长、WCAG reduced-motion），完整 URL 与逐项映射见 `docs/V4-AUDIT.md §0 / §0.1`。

| 反馈元素 | 调研值 | 落地值 | 是否有意偏离 |
|---|---|---|---|
| 接触帧同步 | 判定后 0–100ms 内反馈 | `t>=1` 同帧 `onImpact()` | 优于下限 |
| 命中闪白 | 1–2 帧 / ≤80ms | 80ms 线性衰减 + 黄边 | 一致 |
| 火花 / 冲击环 | 8–14 粒 / 0.2–0.3s | 普通 8 / 重击 10 / Boss 14；200 / 260 / 300ms | 一致 |
| 击退 | 5–20px / 120–250ms | `12·sc` px / 190ms + squash | 一致 |
| 枪口焰 | 0.05–0.15s | 80ms，仅真正开火的射手 | 一致 |
| 拖尾 | 0.08–0.2s、3–5 帧、头亮尾淡 taper | 190–280ms，锥形多边形 + 出生 8% 行程渐显 | **有意偏离**：本作是自动开火打远处尸潮，需读得出方向；每帧在途仅约 10 发 |
| 曳光比例 | 每 5–10 发画 1 条 | 每发都画 | **有意偏离**：总量极小，全画更可读且开销更低 |
| 顿帧 | 40–120ms，**必须带冷却** | 重击 45ms / Boss 60ms，`hitstopCooldown=620ms` | 取轻档下限，避免约 38 发/秒下变幻灯片 |
| 屏震 | 2–5 / 6–10 / 10–16px，约 200ms 衰减 | 仅重击 5px / Boss 8px，二次衰减；普通命中不震 | 一致（动态范围） |
| 齐射错峰 | 30–80ms | 同拍每发 `t` 错开 12% 飞行时间 ≈ 27ms | 一致 |
| 死亡溶解 | 约 2s | 520ms + 尸体留痕 | **有意偏离**：战斗仅 9.5s，2s 会留一批半透明僵尸；用留痕保留 permanence |

### 14.3 全面审查发现与处置矩阵

| 类 | 发现（摘要） | 处置 |
|---|---|---|
| A1–A3 | **子弹不是投射物**：`buildScene()` 每帧用 `makeRng(frame)` 撒 10 条静态 14×26 短斜线；`drawEffects()` 末尾另画 3–6 条随机曳光；`tickS3()` 每 5 帧又随机撒 `bullet`/`hit`；爆炸点与僵尸完全无关 | 三套假特效全删；新增 session 层确定性弹道模拟，render 只做投影 |
| A4 | `tickS3` 给 effect 写了 `tx` 字段，但 `buildState()` 白名单只保留 `{kind,x,y,z,text,amount,t}`，字段被丢弃 | effects 改为 `S.effects.slice()` / `(state.effects||[]).slice()`，保留 `uz/zz/seed/amount` |
| A5 | 受击效果整个 ttl 恒亮，最后一帧突然消失 | `flash` 线性、`shake` 二次衰减 |
| A6 | 胜负画面几乎一样：输了也在「清场」，僵尸照样倒 | 胜负分叉：失败不产生击倒、尸潮满编前压、无准星、全灭停火 |
| A7 | 枪口焰常亮且随机出现在任意位置 | 只在真正开火的 shooter 上、80ms |
| A8 | 无齐射错峰，全员同帧同相 | 每 84ms 一拍 + 每发 `t` 错峰 |
| A9 | `fire` / `zombie.down` 音效**定义了却从未被调用**；9.5s 战斗基本无声 | 补齐 `fire` / `bullet.hit` / `boss.hit` / `zombie.down`，全部节流 |
| A10 | `slowmo` 是假的：只把 `post.timeScale=0.45` 叠一层黄色蒙版，没有任何真实时间缩放 | 删除黄蒙版；改为 `fxSlowT` 只把特效老化降到 `FX_SLOW_SCALE=0.35`，gameplay 时间 / 评级 / 胜负不变 |
| A11 | 命中与碰撞无反馈链（无闪白 / 火花 / 击退 / 留痕） | 单一 `onImpact()` 接触帧入口统一处理 |
| A12 | 集火准星 y 不在敌人身上 | 准星落在尸潮前沿投影；失败局直接隐藏 |
| B1–B5 | S3 跟随线性（与 S2 的 88ms 指数跟随不一致）、战斗无 hitstop、`flash/shake` 不衰减、effect 死字段、HUD 缺波次 / 击倒 | 统一指数跟随、重击/Boss 顿帧 + 屏震、生命周期衰减、清理死字段、新增 S3 状态胶囊 |
| C1–C4 | 敌人数两套口径、effects 无上限、缺只读观测 | 子弹上限 54、特效受控、debug 新增只读 `combat{shots,hits,kills,bullets,slots,alive,bossHit}` |
| D1–D4 | 文档口径过期、缺 GitHub 工程配置 | 勘误 `docs/ARCHITECTURE.md` / `tests/README.md`；补齐 `.gitignore` / `LICENSE` / `package.json` / CI / `check-deploy.mjs` / `DEPLOY.md` / `CONTRIBUTING.md` / `SECURITY.md` / `CHANGELOG.md` |

### 14.4 关键实现（全部在表现层，Core 零改动）

| 模块 | 新增 / 修改 | 作用 |
|---|---|---|
| `game-session` 常量 | `GROUP_LEAD=2100` / `GROUP_INTERVAL=1400` / `TRAVEL=1150` / `GROUP_TAIL=1800` / `TEAM_Z=0.92` / `ALLY_PLANE_Z=0.86` / `FIRE_INTERVAL=84` / `FX_SLOW_SCALE=0.35` | 波次与齐射节拍 |
| `zombieSlots(hc,frame,bt,focusX,phase,win)` | 新增 | 确定性僵尸槽位；失败时槽位不衰减、整体前压 |
| `allySlot(idx,uc)` / `findSlot(idx)` | 新增 | 枪口 (u,z) 与命中选择 |
| `spawnVolley()` | 新增 | 每拍 3–4 名错峰射手，弹丸 `{u0,z0,u1,z1,t,ttl,heavy,boss,targetIdx,seed}`，`shooters=min(10,unitCount)`，全灭直接 return |
| `onImpact(bx)` | 新增 | 接触帧统一：`flash=1` / `knock=1` / 击倒 520ms 溶解 / 冲击环 / 火花 / 碎屑 / 音效 / 重击与 Boss 顿帧屏震 |
| `tickCombat(dt)` | 新增 | 推进弹丸、命中判定、状态衰减、击倒预算 `min(hordeN, floor(hordeN*min(1,battleT*1.18)))` |
| `drawCombat(s)` + `taperPath(...)` | 新增 | 非线性推进 `1-(1-p)^1.45`、出生渐显、尾细头粗锥形曳光 + 白热弹头 |
| `drawHorde(s)` / `drawBoss(s)` | 修改 | 逐只 `flash/knock/dead`、尸体留痕、Boss 受击抖动 / 血条闪光 |
| `drawEffects(s)` | 修改 | `muzzle` / `impact` / `debris` 三类接触帧特效 |
| `drawHud(s)` / `drawFocus(s)` | 修改 | 波次 + 击倒胶囊；失败文案「尸潮压上来了」；失败隐藏准星 |
| `drawCrowdBadges(s)` | 修改 | `crowd.ally<=0` 时不画漂浮 `0` 气泡 |
| `game-audio` | 修改 | 4 类战斗音效接线并节流 |

**胜负仍由 S3 入口快照 + `Core.resolveBattle()` 一次性锁定**；新增的 `battleShots / battleHits / battleKills / zState` 不写回 `power`、不影响下一关起始值、不影响 `gradeFor(focusScore,win)` 的输入口径。

### 14.5 真机逐屏验证（V4 最终代码）

用 `/tmp/wb_v4_shots.py`（Playwright + 本机 Chrome，520×900，`file://`）按 `bestPath` / 最差分路真实通关，
逐 0.9 / 2.6 / 4.8 / 7.2 / 9.0 秒截图并采样 `__GAME_DEBUG__.combat`：

| 场景 | 结果 |
|---|---|
| L1 胜利 | `win=True grade=S`，`shots=362 / hits=350 / kills=30 / slots=30 / alive=0`，`CONSOLE []`、`PAGEERR []` |
| L1 失败（最终代码重拍） | `win=False grade=D`，`shots=0 / hits=0 / kills=0 / bullets=0 / slots=30 / alive=30`；截图确认无橙色子弹、无冲击环、无集火准星、无蓝色士兵、无漂浮 `0` 气泡，僵尸满编前压；HUD「尸潮压上来了」、底部「兵力不足，尸潮压上来了」 |
| reduced-motion | 无冲击环 / 火花 / 枪口焰 / 闪白 / 震动，弹丸降级为细线仍可读，判定与数值不变 |
| L2 / L3 / L4 | 全 `win=True grade=S`；`kills=30/32/32 = slots`，`alive=0`，单关 S2 33.1 / 33.2 / 34.6 秒 |
| L5（Boss） | S2 39.0s，`power=1239752 enemy=883912`，`shots=493 / hits=483 / kills=34 / alive=0`，`grade=S`；Boss 血条、受击抖动与尸潮同屏 |
| 控制台 | 5 关连续 `CONSOLE [] n=0`、`PAGEERR [] n=0`、`EXIT=0` |

截图证据：`docs/screenshots/v4-battle.png`（L1 胜利 S3）、`v4-boss.png`（L5 Boss）、
`v4-lose.png`（最终失败局）、`v4-reduced.png`（降级），以及
`tests/screenshots/v4_win_L*_s3_*.png`（L1–L5 逐关 5 时点）、`v4_lose_L1_s3_*.png`、
`v4_win-reduced_L1_s3_*.png` 全时序原图。V4 首轮「修复前」的无关卡号截图已由 `.gitignore` 排除，不作为交付证据。

### 14.6 二次分析确认记录（历史硬要求）

| 现象 | 第一反应 | 二次分析（截图 / debug 复核） | 最终处置 |
|---|---|---|---|
| 首轮胜利 `kills=31 > slots=30`、`alive=3` | 以为 debug 统计口径错 | 放大状态机发现同一只处于 `0<dead<1` 溶解中的僵尸被重复计入击倒 | `alive` 与击倒条件统一为 `st.dead===0`，并加战斗进度击倒预算；之后稳定 `kills=slots, alive=0` |
| 弹道在白色跑道上几乎看不见 | 以为只是颜色浅 | 真机截图显示淡黄细线与路面黄色虚线混在一起 | 加深琥珀外描边、拉长尾迹、提高齐射密度 |
| 加粗后像「橙色管子」且压住自己人 | 以为再调透明度即可 | 放大图确认是等宽粗线近景透视过大，起点压住蓝兵与兵力气泡 | 改为尾细头粗锥形 `taperPath` + 出生渐显；S3 远景 `allyMass` 降到 `0.72*min(1,uc/40)`；闭包 `trailQuad` 外提避免每帧每弹建函数 |
| 失败局「我方兵力 0、一个蓝兵都没有却还在射击」 | 以为只是 HUD 文案 | debug 显示 `shots>0` 且画面有弹道、冲击环、准星 | `spawnVolley()` 全灭 return、齐射规模按射手数缩放、失败隐藏准星与集火提示、远景人海随兵力衰减 |
| 失败局仍有一个漂浮蓝色 `0` 气泡 | 以为属于 HUD 正常显示 | 截图确认远景人海已 0，气泡却悬在跑道上，像空标签 | `drawCrowdBadges()` 在 `crowd.ally<=0` 时 return；重拍截图复核通过 |
| 失败局氛围不够、与胜利局色调太像 | 以为提示文案已足够 | 对比两张截图确认红色警示强度差异不足 | `post.alarm` 失败系数 `0.045 → 0.085` |
| 全文 `grep -c Math.random` 得 **2** 而旧文档写「仅一处注释」 | 以为确定性被破坏 | 逐行核对：一处在渲染层「禁用 Math.random」注释，一处在 V4 弹道段「不引入 Math.random」注释；`static-audit.js` 的 `stripJsComments()` 会把注释替换为等长空格后再检索，故 `code` 命中 0、硬违规 0 | 属文档口径过期（§13 写于 V3 时点），不改代码；§14.9 与 `VISUAL-UPGRADE.md §9.8` 按现行 2 处注释如实记录 |
| 最终 `file://` 回归出现 `[FAIL] 键盘 独立通关一关 win=False`，而同轮 `http://` 三端输入 0 失败 | 怀疑 V4 改动影响了键盘输入或 S2 判定 | ① 核对 V4 diff：本轮**未改** `game-input`、S2 门组判定、`bestPath`、`applyGate`、`resolveBattle`；② 单独（无并发）复测键盘通关 **3 次**，全部 `win=True`、`bestPathMismatches=0`、`powerBefore=63942 / enemyPower=45645` 三次完全一致、`phaseTrace=[S1,S2,S3,S4]`、零 console/pageerror，判定 `PRODUCT_OK`；③ 顺带发现真问题：两个回归进程同时 `open('tests/test-results.json','w')`，产出交错损坏的 JSON（片段 `"ok"S1true`） | 判定为**双协议并行时高负载下的测试侧时序抖动**，不改产品代码；修复 `browser_check.py`（按协议分文件 + 临时文件原子替换 + `--results` 参数），并**串行**重跑双协议全量回归作为交付证据（见 §14.8） |

### 14.7 Node 四层与脚本语法

最后一次修改（`badge0` / `alarmLose`）后立即复核：

```text
OK badge0
OK alarmLose
blocks 7 bad 0                    # 7 个 <script> 块 new Function 语法检查
API 数量断言 : PASS (26)
通过: 15809  失败: 0  合计: 15809
硬违规总数: 0        判定: PASS
硬性问题: 0          判定: PASS  # scripts/check-deploy.mjs
```

`index.html` 最终 **4359 行 / 198,171 字节**（≤300 KiB 预算）。

### 14.8 最终双协议全量回归与帧率

命令（默认参数：`--retry-count 20`、`--offline-levels 12`）：

```bash
python3.9 -u tests/browser_check.py --protocol file
python3.9 -u tests/browser_check.py --protocol http --port 8765
```

#### 14.8.1 第一轮：双协议并行（暴露测试基建缺陷）

| 协议 | 通过 / 合计 | 失败 | 退出码 |
|---|---|---|---|
| `http://` | **284 / 284** | 0 | 0 |
| `file://` | 284 / 285 | 1（键盘 独立通关一关 `win=False`） | 1 |

两轮各约 31 分 52 秒，覆盖调试接口 / 零外部请求 / 1–5 关含 Boss / 20 次失败免费重试 /
资源降级注入 / 帮助面板 / 5 视口 + 灰阶 + reduced-motion / 三端输入 / 断网 12 关 / 帧率 / 控制台。
`http://` 全绿；`file://` 唯一失败项的二次分析见 §14.6 与 §14.8.2。

**同时发现一个真问题**：两个进程都写死 `tests/test-results.json`，
收尾时同时 `open(...,'w')` 造成内容交错，产出无法 `JSON.parse` 的文件（片段 `"ok"S1true`）。
这不是产品问题，但会让「结构化结果」失去可信度，必须修。

#### 14.8.2 键盘 FAIL 的二次分析（结论：非产品回归）

- 产品侧：V4 只改 `game-session` / `game-render` / `game-audio` 的战斗表现层；
  `game-input`、S2 判定窗口、`bestPath`、`applyGate`、`resolveBattle` 全部未动。
- 实测：无并发条件下键盘独立通关 **3/3 全胜**，`bestPathMismatches=0`，
  三次 `powerBefore=63942` / `enemyPower=45645` 完全一致（确定性成立的旁证），
  `phaseTrace=[S1,S2,S3,S4]`，console error / pageerror 均为 0 → `PRODUCT_OK`。
- 与 V3 已记录的同类现象一致：并发跑双协议时 CDP 往返延迟挤占 1400ms 门组判定窗口，
  `align_keyboard` 偶发丢事件导致误选负门。属**测试侧时序抖动**。
- 处置：不改产品代码；修测试基建，并改用**串行**重跑消除并发干扰。

#### 14.8.3 `browser_check.py` 基建修复

| 改动 | 作用 |
|---|---|
| 默认输出改为 `tests/test-results-<protocol>.json` | file / http 各写各的，不再互相覆盖 |
| 先写 `<path>.tmp` 再 `os.replace()` 原子替换 | 任何时刻读到的都是完整 JSON，不会留下半份 |
| 新增 `--results <path>` | 允许显式指定归档路径 |
| 顶部 docstring / `tests/README.md` 勘误 | 说明结果文件是本地运行产物、由 `.gitignore` 排除，不随仓库分发 |

`py_compile` 语法校验通过；`npm test` 四层不受影响（CI 只跑 Node 四层，不跑 Playwright）。

#### 14.8.4 串行复核轮（不并发，最终交付证据）

> 两个协议按 `file → http` **串行**重跑（修复后的脚本，各自输出独立 JSON）。
> 通过数 / FPS / `consoleErrors` / 外部请求数在跑完后回填。

### 14.9 硬约束复核

| 约束 | 复核结论 |
|---|---|
| 26 项 Core API 严格不变 | `extract-core.js` **PASS (26)**，本轮未改 `game-core` |
| 确定性 / 无 `Math.random` | 新增派生全部走 `Core.makeRng` / `fireSeq` / `frame` / `level`；全文 `Math.random` **2 处均为注释**（`static-audit.js` 先 `stripJsComments()` 再检索，`code` 命中 0），硬违规 0；§13 的「仅一处注释」是 V3 时点口径 |
| 100% 可胜 / 诚实玩法 | 战场状态不写回 `power / outcome`；L1–L200 稳妥路径 100/100 可过；无广告 / 复活 / 登录 / 内购 / 养成 / 第二玩法 |
| 评级只影响评价 | `gradeFor(focusScore, win)` 不变，命中数只用于展示与 HUD |
| `game-session` 不得出现 `ctx.*`（U-9） | 模拟在 session、投影在 render；`static-audit` 分段检查 |
| 单文件 / 零外链 / `file://` | 全文无 `http(s)://` 字面量；`check-deploy.mjs` 11 条断言 PASS |
| reduced-motion | 闪白 / 火花 / 碎屑 / 枪口焰 / 震动 / 顿帧全关，弹丸降级细线（保留射击可读性） |
| 体积 | 198,171 字节 < 300 KiB |

### 14.10 静态托管与线上 GitHub Pages 验证

**仓库**：`guyue55/honest-gate-zombies`（公开 / MIT / `main` / Pages `Deploy from a branch` → `/ (root)` / `.nojekyll`）。
首次 push 后 CI（`.github/workflows/ci.yml`）**9 秒 success**；Pages 状态 `building → built`，
`https://guyue55.github.io/honest-gate-zombies/` 返回 **200**。

#### 14.10.1 上线前：项目子路径真机预检

把 `index.html` / `.nojekyll` / `assets/manifest.json` 复制到临时站点根目录的
`honest-gate-zombies/` 子目录，用 `http.server` + 本机 Chrome 打开
`http://127.0.0.1:8766/honest-gate-zombies/index.html`：

| 检查 | 结果 |
|---|---|
| HTTP / title | 200 / 「诚实数字门 · 打僵尸」 |
| `#btn-start` / `__GAME_DEBUG__` | 均存在，初始 `phase=HOME` |
| 点击「开始游戏」 | `phase=S1`、`level=1`，S1 门组预览完整（20 组门 / 分 3 段推进） |
| `performance.getEntriesByType('resource')` | `[]` |
| console error / pageerror / requestfailed / 外部请求 | 全为 `[]` |

结论：挂在 `/honest-gate-zombies/` 子路径下不会 404，`check-deploy.mjs` 的「无根绝对路径」断言得到真机印证。

#### 14.10.2 线上 HTTPS 真机验收

本机 Chrome（520×900）真实访问 Pages 地址：

| 检查 | 结果 |
|---|---|
| `http_status` / `title` | **200** / 「诚实数字门 · 打僵尸」 |
| `#btn-start` / `__GAME_DEBUG__` / canvas | 均存在；canvas 逻辑尺寸 `480×854` |
| 状态推进 | `HOME` → 点开始 `S1` → 空格跳预览 `S2`（`level=1`） |
| **断网后继续玩** | `context.set_offline(True)` 后仍保持 `S2`、debug 可读，拖拽选门后门组继续滚动推进、队伍跟随移动，画面完整 |
| `performance.getEntriesByType('resource')` | **`[]`** —— 线上运行时零外部资源请求 |
| console error / pageerror / requestfailed / HTTP≥400 / 外部请求 | 全为 `[]` |
| 判定 | **PASS** |

截图二次确认：线上 S2 与断网后 S2 两帧，HUD 关卡 / 兵力 / 进度条、门组（含门板黄黑陷阱警示带）、
我方人海、远景尸潮、跑道场景均完整渲染，无空白、无缺失资源、无网络错误提示。

> 如实标注边界：线上真机验收只跑到 S2 与断网后的继续操作，**没有在线上跑完整一关**；
> 「完整通关一关 / 三端输入 / 20 次重试 / 灰阶 / reduced-motion / 帧率」由 §14.8 的双协议全量回归与 §14.5 的逐屏验证覆盖。
> 断网「刷新后仍可完整玩一关」这一条未在线上单独验证；`file://` 双击离线可玩由双协议回归覆盖。

### 14.11 结论

用户所指「射击 / 子弹 / 碰撞 / 对战都很潦草」的根因不是美术精度，而是**表现层与模拟层完全脱钩**：
子弹、爆炸、曳光都是按帧随机撒的静态贴图，既不从枪口出发、也不落在僵尸身上，音效分支从未被调用，胜负画面无分叉。
V4 把战斗改为「确定性弹道 → 接触帧统一反馈 → 胜负分叉表现」三层结构，并按调研参数建立普通 / 重击 / Boss 三级动态范围，
在不触碰 Core、不改数值曲线、不破坏 100% 可胜与诚实玩法的前提下完成升级。
所有视觉结论均由真机截图或只读 debug 快照二次确认，未以「代码看起来对」结案。
