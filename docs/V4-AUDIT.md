# V4 全面审查与打磨清单 · 射击 / 子弹 / 碰撞 / 对战

> 触发：用户指令「不止，全面的体验都很差，如 射击效果、子弹效果、碰撞想过、对战效果都是，感觉很潦草，要全面打磨升级」+
> 「全面检查和审核，挖掘值得改进或修复的地方，逐一处理、测试」。
> 工作流：编程专家 Pro（分析 → 方案 → 执行 → 验证 → 交付 → 复盘）。
> 继承硬性要求：**一些问题、结论必须二次分析确认**；不向用户提问；交付不能是半成品。

---

## 0. 联网调研依据（本轮新增）

| 来源 | 关键结论 | 落地决策 |
|---|---|---|
| [VFX Shape and Timing](https://gdad.wiki/wiki/game-art/vfx-shape-and-timing) | 三阶段时序：anticipation → **main 峰值必须落在接触帧** → dissipation；拖尾「表达方向而不是射程」，头亮尾淡、快速消散；线性曲线显得机械，用 ease-in/out；峰值延迟超过约 100ms 会被读成卡顿 | 弹丸按 `1-(1-t)^1.45` 非线性推进；所有反馈（闪白 / 火花 / 击退 / 音效）在 `t>=1` 的同一帧触发 |
| [Juice, the Difference Between Code and Feel](https://www.socratopia.app/library/game-design-compelling-en/chapter-11) | Hades 案例：一次命中的音、粒子、震动、hitstop、敌人受击、血条全部**同步在接触帧**；「三个同步的反馈比十个错位的反馈更锐利」；反馈按情境分层 | 建立单一 `onImpact()` 接触帧入口，禁止按帧随机撒特效 |
| [Game Feel 101](https://gamedo.live/news/game-feel-juice-guide-indie-devs) | 震动 50–150ms 且**强度随时间衰减**；hitstop 2–5 帧；敌人**每发必闪白 1–2 帧**、按伤害击退；弹幕拖尾传达路径 | 闪白 95ms、击退 190ms；震动 / 顿帧只给重击与 Boss，带冷却 |
| [VFX & Game Feel Polish](https://gamineai.com/courses/build-complete-indie-game-unity-2026/lessons/lesson-10-vfx-and-game-feel-polish) | 命中火花 0.2–0.4s、5–15 粒子；拖尾 0.08–0.2s；hitstop 0.06–0.12s **必须带冷却**，否则连击变幻灯片；**限制最大粒子数** | 普通命中 6 火花 / 200ms，重击 9 / 260ms，Boss 12 / 300ms；子弹上限 54、并发特效受控 |
| [VFX Visual Effects & Particle Systems](https://gamineai.com/courses/3d-first-person-shooter/lessons/lesson-11-visual-effects-particle-systems) | 枪口焰 0.05–0.15s，短促即读；避免长期全白；按距离缩放 | 枪口焰 80ms、星形 + 白热芯，只在**真正开火的那一排士兵**上出现 |
| [Why Controls Matter More Than Art](https://gamemaker8.com/design/game-feel-juice-what-makes-controls-feel-good-why-matters-more-than-graphics) | 反馈强度必须与事件重要性成正比；拖尾 3–5 帧消散；**音画同步**；「每个动作都震 = 没有动作值得震」 | 建立三级动态范围（普通 / 重击 / Boss），普通命中不震屏、不顿帧 |
| [Vlambeer 30 tricks](https://artificials.ch?p=1605/) | 更大更快的子弹、更高射速、命中特效、受击变白、击退、枪口焰、死后留痕、低频 | 弹头白热圆点 + 渐隐拖尾；击倒后留低透明度残影 |
| [How Bullets Work in Video Games](https://www.positioniseverything.net/how-bullets-work-in-video-games/) | 反馈层：枪口焰 → 曳光 → 命中材质反馈 → 后坐 / 震动 → 音频；过多反馈会遮蔽敌人、掉帧 | 分层绘制，但每类都限量；远景尸潮不被特效盖住 |

> 与 V3 已采用的 innovecs / 9-pixels / easyhub 关卡时长结论不冲突：本轮只动 S3 表现层，不改单关时长与数值曲线。

### 0.1 参数对照表（调研值 → 落地值 → 有意偏离）

| 反馈元素 | 调研经验值 | 本项目落地 | 说明 |
|---|---|---|---|
| 枪口焰 | 0.05–0.15s、5–10 种变体、避免长期全白 | **80ms**，星形 + 白热芯，按 shooter `idx` 与 `seed` 旋转错峰 | 一致 |
| 弹丸拖尾 | 0.08–0.2s、3–5 帧消散、头亮尾淡、taper | 飞行 **190–280ms**，尾细头粗锥形多边形 + 出生 8% 行程渐显 | 飞行时间略长：本作是「自动开火打远处尸潮」，需要读得出弹道方向；每帧在途仅约 10 发 |
| 曳光显示比例 | hitscan 游戏每 5–10 发画 1 条 | **每发都画** | 有意偏离：本作每帧在途仅 ~10 发（非 100+ 弹幕），全画反而可读且开销更低 |
| 命中确认延迟 | 判定后 **0–100ms** 内必须反馈 | **接触帧同帧**（`t>=1` 的 `onImpact()`） | 优于下限 |
| 命中闪白 | 1–2 帧 / ≤80ms，纯白剪影 | **80ms** 线性衰减 + 黄边 | 一致；reduced-motion 下关闭 |
| 火花 | 8–14 个、0.2–0.3s、5–15 粒子上限 | 普通 **8** / 重击 **10** / Boss **14**，200 / 260 / 300ms | 一致 |
| 冲击环 | 约 180ms | 200 / 260 / 300ms | 一致 |
| 击退 | 5–20px、120–250ms | `12·sc` px（约 7–14px）、**190ms** 衰减 + squash | 一致 |
| 顿帧 | 轻 40–60ms / 重 80–120ms；**必须带冷却** | 重击 **45ms** / Boss **60ms**，`hitstopCooldown=620ms` | 取轻档下限：约 38 发/秒，避免连击变幻灯片 |
| 屏震 | 轻 2–5 / 中 6–10 / 重 10–16px，约 200ms 衰减 | 仅重击 **5px** / Boss **8px**，200ms **二次衰减** | 普通命中完全不震（动态范围） |
| 死亡溶解 | 约 2s、确定性种子 | **520ms** + 尸体留痕（永久低透明度） | 有意偏离：单关战斗仅 9.5s，2s 会让 20% 时长里站着一批半透明僵尸；用「留痕」保留 permanence |
| 齐射错峰 | 30–80ms stagger | 同拍每发起 `t` 错开 **12% 飞行时间 ≈ 27ms**，枪口焰亮度同步错峰 | 一致 |
| 死亡 > 普通命中 | 击杀爆点显著更大 | 击倒时**额外**叠一层 lvl2 冲击环 + 8 粒碎屑 | 一致 |
| reduced-motion / WCAG | 关闭闪白与高频闪烁；不叠加位移类效果 | 闪白 / 火花 / 碎屑 / 枪口焰 / 震动 / 顿帧全关；弹丸降级为细线；`hitstop` 用状态标志而非 `timeScale=0` | 一致 |

补充来源（上表参数主要来自）：
[Game Feel 101](https://gamedo.live/news/game-feel-juice-guide-indie-devs) ·
[Game feel and juice (GameMaker8)](https://gamemaker8.com/design/game-feel-juice-what-makes-controls-feel-good-why-matters-more-than-graphics) ·
[Juice Up Your Game / Vlambeer 30 tricks](https://artificials.ch?p=1605/) ·
[How Bullets Work in Video Games](https://www.positioniseverything.net/how-bullets-work-in-video-games/) ·
[Mega Cat Studios 开发日志](https://megacatstudios.com/ko/blogs/game-development/tagged/game-dev) ·
[子弹轨迹与枪口焰视觉设计](https://www.hxrwx.com/%e9%a3%9e%e8%a1%8c%e8%bd%a8%e8%bf%b9%e4%b8%8e%e5%ad%90%e5%bc%b9%e7%89%b9%e6%95%88%ef%bc%9a%e5%b0%84%e5%87%bb%e6%b8%b8%e6%88%8f%e7%9a%84%e8%a7%86%e8%a7%89%e8%ae%be%e8%ae%a1%ef%bc%8c%e9%9b%b6%e5%9f%ba%e7%a1%80%e7%a1%80%e4%b9%9f%e8%83%bd%e7%8e%a9%e5%be%97%e8%bd%ac/)

---

## 1. 审查发现（逐项，含根因与处置）

### A 类 · 战斗表现「假」——用户所指的「潦草」根因

| # | 发现 | 根因（代码位置） | 处置 |
|---|---|---|---|
| A1 | **子弹不是投射物**：屏幕上飘的是固定 14×26 的静态短斜线，淡出即消失 | `buildScene()` 每帧用 `makeRng(frame)` 生成 10 个 `{kind:'bullet', x:60+rng()*360, y:655-rng()*35, t:rng()*0.8}`；`drawEffects` 只画 `moveTo(x,y)→lineTo(x+14,y-26)` | 删除；改为 game-session 内真实弹道模拟，render 只投影 |
| A2 | **两套互相打架的假弹道** | `drawEffects()` 末尾另用第二个 RNG 画 3–6 条随机位置「短曳光弹」 | 删除整段，由 `drawCombat()` 统一 |
| A3 | **爆炸点与僵尸无关** | `tickS3` 每 5 帧在 `focusX ± (70\|220)`、`y=300+rng()*130` 生成 `hit`；`buildScene` 每帧再随机 7 个 | 删除；命中点 = 被击中僵尸槽位在接触帧的 `(u,z)` |
| A4 | **弹道终点字段被丢掉**：`tickS3` 给 bullet 写了 `tx`，但 `buildState` / `buildScene` 映射 effects 时只保留 6 个字段 | 两处 effects 映射白名单 | 改为直接切片传递自定义字段（`uz/zz/seed/amount`） |
| A5 | **僵尸「受击」是整排常亮**：按 `zr/zRows < battleT*1.05` 点亮，从 10% 进度起一排排永久闪白 | `buildScene` 的 `hit` 布尔 + `drawHorde` 的 `if(z.hit)` 矩形 | 改为逐只 `flash(95ms) / knock(190ms) / hits / dead` 状态机 |
| A6 | **胜负画面几乎一样**：`enemyMass`、`z.hit`、`hordeCount` 都只按 `battleT` 衰减，失败时也在「清场」 | 三处只吃 `battleT`，不读 `outcome.win` | 分叉：胜利靠命中逐个击倒；失败不产生击倒、尸潮向镜头前压、红色氛围加强 |
| A7 | **枪口焰是恒定黄点**：`firing && !reducedMotion` 就画一个固定 2.5px 圆 | `drawUnit` | 只在实际开火的 shooter 上按 `muzzle` 衰减画星形焰 + 后坐 |
| A8 | **无齐射错峰**：所有 ally 同时 `firing=true` | `buildScene` 全员置位 | 每 96ms 一拍、每拍 2–3 名错峰射手，仅这些人有焰与后坐 |
| A9 | **`fire` / `zombie.down` 音效定义了但从未调用** → 9.5–13s 战斗除 BGM 完全无声 | `game-audio` 定义 / 全文件仅 5 处 `play()`，均非战斗 | 接线 `fire` / `bullet.hit` / `boss.hit` / `zombie.down`，全部带节流 |
| A10 | **假慢动作**：`slowmo` 只把 `post.timeScale=0.45`，而它唯一的用途是叠一层 8% 黄蒙版，没有任何时间缩放 | `buildScene` / `drawOverlay` | 删除假黄蒙版；改为**特效慢放**（只把 `tickEffects` 降到 0.35×，gameplay 时间不变，避免破坏 `durationMs` 断言） |
| A11 | **碰撞反馈缺失**：无冲击环、无火花、无击退、无死亡溶解、无留痕、Boss 血条只随 `battleT` 线性掉且 Boss 完全不受击 | — | `impact` 三级 + `debris` 死亡碎屑 + 尸体留痕 + Boss 抖动 / 闪白 / 血条闪光 |
| A12 | **准星不在敌人身上**：`drawFocus` 固定 `cy=306`，而尸潮纵深 0.10–0.72（y≈260–560） | 硬编码 y | `cy = projectY(horde.z+0.16)`，并收窄光带 |

### B 类 · 手感与一致性

| # | 发现 | 处置 |
|---|---|---|
| B1 | `tickS3` 队伍跟随用线性 `dt/85`，`tickS2` 用指数 `1-exp(-dt/88)` → 同一局的两种手感 | 统一为指数跟随 |
| B2 | 战斗阶段完全没有 hitstop，连续命中无重量 | 仅重击 / Boss 命中插入 22–34ms 微顿帧，**带 620ms 冷却**（调研明确要求连击不得变幻灯片） |
| B3 | `flash` / `shake` 在 buildScene 里取 `amount` **原值**，整个 ttl 内恒定，最后一帧突然消失（违反「强度随时间衰减」） | 乘 `(1-e.t)` 平滑衰减 |
| B4 | `shakeBoost` 是定义后从未读写的死字段 | 删除 |
| B5 | S3 顶部没有「现在是第几波 / 击倒多少」的信息 | HUD 增加战斗状态胶囊（纯观测） |

### C 类 · 性能与正确性

| # | 发现 | 处置 |
|---|---|---|
| C1 | 旧实现每帧 2 次 `makeRng` + 17 个假特效对象，稳态 100+ 特效，全是噪声 | 删除；新实现稳态约 6 发在途子弹 + 5 个接触特效，显著降低 draw call |
| C2 | 敌人数两套口径：`hordeCountFor()` 与 `buildScene()` S3 各自算 | 统一由 game-session 恒定编制 `S.hordeN`，render 只消费 |
| C3 | `S.effects` 上限 180；新增碰撞特效若不分类可能挤掉门组反馈 | 子弹独立数组 + 特效按 TTL 短周期，实测并发 < 40 |
| C4 | debug 快照不暴露战斗数据，QA 无法验证「命中是否真的发生」 | 新增只读 `combat` 字段（shots / hits / kills / bullets / alive） |

### D 类 · 工程与文档

| # | 发现 | 处置 |
|---|---|---|
| D1 | `tests/README.md` §4 仍写 `gateCountFor(1/5/12)=2/3/6`、`Boss durationMs=2600`、`timeout_ms=60000`、`6 组门` | 顶部加「当前口径勘误」，指向 V3/V4 实测值 |
| D2 | `docs/ARCHITECTURE.md` 仍有一处 `BATTLE_MS=1600` | 同步为 9500 / 13000 |
| D3 | README 的 Pages 章节只是「把仓库推上去即可」，无真实地址与配置 | 建立真实仓库后写入线上地址、Pages 配置与验证命令 |
| D4 | 无 `.gitignore` / `LICENSE` / CI / 部署自检脚本 | 本轮补齐（见 §3） |

---

## 2. 硬约束复核（V4 不得破坏）

| 约束 | 护卫方式 |
|---|---|
| 26 项 Core API 严格不变 | 不改 `game-core`；`extract-core.js` PASS(26) |
| 确定性、无 `Math.random` | 全部派生用 `Core.makeRng` / `frame` / `fireSeq`；`static-audit` 硬违规 0 |
| 100% 可胜 / 诚实玩法 | 新战场数据**不写入** `power` / `outcome` / 下一关起始值；胜负仍由 `resolveBattle(入口快照)` 一次锁定 |
| 评级只影响评价 | `gradeFor(focusScore, win)` 不变，命中数只作展示与 HUD |
| `game-session` 不得出现 `ctx.*`（U-9） | 模拟全在 session，投影全在 render；`static-audit` 分段检查 |
| 单文件 / 零外链 / `file://` | `scripts/check-deploy.mjs` + `static-audit.js` |
| reduced-motion | 关掉火花 / 碎屑 / 枪口焰 / 震动 / 顿帧，弹丸降级为细线（保留射击可读性） |
| 性能 | 20–30 组门 + 30–56 只僵尸下 rAF ≥45fps |

---

## 3. 本轮同时补齐的 GitHub 工程配置

`.gitignore` · `LICENSE`(MIT) · `package.json`(npm test 四层) · `.editorconfig` ·
`.github/workflows/ci.yml` · `.github/ISSUE_TEMPLATE/bug_report.md` ·
`scripts/check-deploy.mjs`（单文件 / 零外链 / 子路径 / 体积守卫）·
`docs/DEPLOY.md` · `CHANGELOG.md` · `CONTRIBUTING.md` · `SECURITY.md` ·
`docs/screenshots/`（README 展示用精选图）。

---

## 4. 验证矩阵

| 层 | 命令 | 判据 |
|---|---|---|
| Node | `npm test` | 26 API / 15809 断言 / 硬违规 0 / 部署守卫 PASS |
| 语法 | 7 个 `<script>` 块 `new Function` | 0 失败 |
| 真机 | `tests/browser_check.py --protocol file` / `--protocol http` | 双协议全绿、`consoleErrors=[]`、外部请求 0 |
| 逐屏 | S2 / S3 三波 / Boss / 胜负 / 灰阶 / reduced-motion 截图 | 子弹起点在枪口、终点在僵尸身上；命中同帧闪白 + 火花；失败时尸潮不消失 |
| 线上 | Pages HTTPS 实机 | 可开局、无 404、无控制台报错 |

> 状态栏会在验证完成后回填；所有「看起来对但没跑过」的项一律不标完成。
