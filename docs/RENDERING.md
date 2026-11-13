# 渲染与效果补充设计 · 诚实数字门 · 打僵尸

> 定位：对 `docs/ARCHITECTURE.md` §9（视觉与交互）的**增强规格**，由交付侧在用户提出「充分思考技术和效果，比如 Three.js 等，设计最稳妥完善的方案」后补充。
> 优先级：本文件与 ARCHITECTURE.md 冲突时，**骨架类约束以 ARCHITECTURE.md 为准，效果类约束以本文件为准**；本文件已在第 10 章逐条声明兼容性，不改变任何定死签名。
> 日期：2026-11-10

---

## 1. 为什么认真评估了 Three.js 但不用它

### 1.1 联网核查到的事实（2026-11-10 实检索）

| # | 事实 | 来源 |
|---|---|---|
| F1 | Three.js 官方 Migration Guide：`build/three.js` 与 `build/three.min.js` 自 r150 起弃用，**r160 移除** | https://github.com/mrdoob/three.js/wiki/Migration-Guide |
| F2 | 官方论坛 Mugen87：UMD 构建「have been removed with r161 since they are unusable with addons」，官方只给 ESM / 构建工具 / 停留在旧版三条路 | https://discourse.threejs.org/t/umd-version-of-three-js-v-161/60912/5 |
| F3 | 现代 Three.js 只发 `three.module.js` / `three.cjs`；addons 全在 `examples/jsm` 且依赖 import map | https://blog.csdn.net/weixin_34072296/article/details/164501915 |
| F4 | `file://` 下 ES Modules 受同源策略约束，origin 为 `null`，Chrome 直接 CORS 拦截；本地文件无法设置 `Access-Control-Allow-Origin` | https://stackoverflow.com/a/75259288 |
| F5 | `file://` 下 GLTFLoader / TextureLoader / DRACOLoader 的 `fetch` + ArrayBuffer 链断裂，模块脚本还要求正确 MIME；典型现象就是双击后白屏 | https://ask.csdn.net/questions/9594629/56575029 |
| F6 | 连 GDevelop 这类引擎都因为 r160 后无经典脚本构建，被迫自建 Rollup 子项目把 ESM 打成全局 `THREE` | https://blog.gitcode.com/8415a7a221619f9732459be44f7bbb1e.html |
| F7 | 同类产品公开短板正是「高频闯关、多怪物同屏、特效叠加 → 卡顿 / 帧率波动 / 闪屏 / 加载延迟」 | `RESEARCH.md` C7（DataEye） |

### 1.2 在本项目硬约束下，Three.js 只剩三条路，全部不可接受

| 路径 | 代价 | 判定 |
|---|---|---|
| 锁死 r149 之前的 UMD 老版本 | 停止维护、已知缺陷、无法用现代 addons，且需把 ~600KB 库内联进单文件 | ❌ 违反「最稳妥」 |
| 自建 Rollup 把 ESM 打成全局经典脚本 | 引入构建步骤与 npm 依赖链 | ❌ 违反「零构建 / 零依赖」 |
| 强制用户起 HTTP 服务器 | 双击 `file://` 不再可玩 | ❌ 违反用户最初的纯静态诉求与 PRD R-01 |

### 1.3 横向技术选型评估

评分：✅ 满足 / ⚠️ 有代价 / ❌ 不满足。**「最稳妥」的权重高于「最炫」。**

| 方案 | file:// 双击 | 零外部请求/离线 | Pages 子路径 | 单文件体积 | 移动端/微信内置浏览器 | 120+ 单位帧率 | 自动化视觉验证 | 实现调试复杂度 | 资源失效风险 | 结论 |
|---|---|---|---|---|---|---|---|---|---|---|
| Three.js (WebGL/ESM) | ❌ ESM 被 CORS 拦 | ⚠️ 内联库可做到 | ⚠️ 需 import map | ❌ +600KB~1.2MB | ⚠️ WebGL 可用性不确定 | ⚠️ InstancedMesh 强但低端机风险高 | ⚠️ 截图依赖 GPU/软件渲染 | ❌ 高 | ⚠️ 中 | **不用** |
| PixiJS / 原生 WebGL | ❌ 同上（Pixi v8 亦 ESM 优先） | ⚠️ | ⚠️ | ⚠️ +400KB | ⚠️ | ✅ 批处理强 | ⚠️ | ❌ 高 | ⚠️ | **不用** |
| CSS 3D / SVG | ✅ | ✅ | ✅ | ✅ | ⚠️ 大量 DOM 变换掉帧 | ❌ 单位多时 DOM 爆炸 | ✅ | ⚠️ 中 | ✅ | **不用** |
| Canvas 2D 平面 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 低 | ✅ | 基线，但**效果不足** |
| **Canvas 2D + 2.5D 伪立体** | ✅ | ✅ | ✅ | ✅ 零增量 | ✅ 无 GPU 依赖 | ✅ 绘制上限可控 | ✅ 纯 CPU 截图稳定 | ✅ 低 | ✅ | **✅ 采用** |

补充实测证据：本机 Chrome 走真实 `file://` 协议探针结果——`location.protocol='file:'`、Canvas 2D 与 `globalCompositeOperation='lighter'` 可用、首次手势后 `AudioContext.state='running'`、`localStorage` 可用、`BigInt(2)**BigInt(200)` 精确、`performance.getEntriesByType('resource')=[]`、控制台错误 0 条。**零依赖单文件 + 2.5D 方案不是纸面推演，是已验证可跑通的路线。**

### 1.4 裁决

> 主渲染采用 **Canvas 2D + 2.5D 伪立体投影**，零第三方、零构建、零外部请求；用透视、立体闸门、带阴影和跑动姿态的小人、光晕/泛光/震屏/暗角等手法把画面做到接近广告素材的质感，而不是靠引入 3D 引擎。

**未来若确需真 3D 的演进路径**（本次不实现）：因第 5 章的渲染抽象层把「场景描述（纯数据）」与「绘制后端」彻底解耦，届时只需替换 `game-render` 这一个 script 块、实现同一组方法即可；Three.js 以「仅在 http(s) 下、显式开关启用、作为 `AssetProvider` 的一个可选资源、失败自动回退 Canvas2D」的方式接入，默认态仍恒为零请求。核心逻辑、关卡生成、胜负结算、状态机一行都不用改。

---

## 2. 2.5D 透视投影规格（可实现公式）

逻辑坐标系沿用 ARCHITECTURE.md §12.5：`480 × 854`，`y` 自下而上为前进方向。所有世界物体用归一化坐标 `(u, z)` 描述：

- `u ∈ [-1, 1]`：横向归一化位置（`-1` 左边界，`+1` 右边界）；
- `z ∈ [0, 1]`：深度，`z=0` 最远（地平线），`z=1` 最近（屏幕底部）。

```
HORIZON_Y = 250          // 地平线
NEAR_Y    = 854          // 屏幕底部
projectY(z)  = HORIZON_Y + (NEAR_Y - HORIZON_Y) * Math.pow(z, 1.6)
halfWidth(z) = 60 + 180 * z                  // 跑道远端半宽 60，近端 240（近宽远窄）
projectX(u,z)= 240 + u * halfWidth(z)
scale(z)     = 0.35 + 0.65 * z              // 远小近大
fogAlpha(z)  = 0.55 * (1 - z)               // 远处雾化叠加 BG_TOP
```

- 门组随 `cameraY` 推进，`z` 由 `0.15 → 1` 递增；队伍固定在 `z = 0.86`（约 `screenY ≈ 700`，与 §12.5 一致）。
- 门框、单位、僵尸、Boss 一律先按 `scale(z)` 缩放再绘制；文字标签最小字号 12 逻辑像素，且不随 `scale` 缩到不可读（用 `Math.max(12, 22*scale(z))`）。
- 门 lane 的横向命中判定仍以**队伍中心 `x` 落在哪个等分 `[0,480]` 区间**为准（ARCHITECTURE.md §12.5 的离散事件），**透视只影响绘制，不影响判定**——避免「看起来擦到门边缘但算另一道门」的歧义。
- S1 门组预览用同一套 `projectX/projectY`，只是把所有门组按 z 压缩排布成一屏缩略图，让玩家能「开局先扫一眼门序」（RESEARCH C12）。

---

## 3. 分层渲染配方（对 §9.1 七层的逐层增强）

绘制顺序不变（L0→L6），只把每层内容做实：

| 层 | 具体绘制配方 |
|---|---|
| **L0 背景** | 天空竖向渐变 `BG_TOP→BG_BOTTOM`；顶部 12 个静态星点 + 一轮低饱和月；**远景废墟剪影 2 层**（不同明度、按 `cameraY*0.06 / 0.12` 视差缓慢横移）；地平线处一条 40px 高的雾带渐变；Boss 关在天空叠一层极淡紫。 |
| **L1 跑道** | 用 `halfWidth(z)` 画两侧边界发光线；地面按 z 画 10 条横向透视网格线（间距随 `projectY` 非线性）+ 从消失点放射的 5 条纵向线；路面中线虚线随 `cameraY` 流动；两侧路灯按 z 由小到大依次亮起。 |
| **L2 门** | 见第 4 章。按 z 从远到近排序绘制（远处先画），保证遮挡正确。 |
| **L3 单位** | 我方小兵按 z 排序、带椭圆地面阴影、跑动摆臂；僵尸与 Boss 同理。绘制上限沿用 `MAX_DRAW_UNITS=120`，**超出时阵型不再增人，改由 HUD 大数字 + 队伍底部「×N」密度光晕表达真实兵力**。 |
| **L4 特效** | 穿门飘字、数字跳动、增益/减益粒子、自动开火弹幕、命中火花、震屏、闪白、慢动作。发光统一用 `shadowBlur + globalCompositeOperation='lighter'`（已实测 `file://` 可用）。 |
| **L5 HUD** | 第 N 关 / 兵力大数字（`formatNumber`，带深色描边 + 亮黄）/ 敌方剩余 / Boss 血条 / 静音·重开·? 三个按钮 / 一行极简提示「小队伍选加法，大队伍选乘法」；**当前即将判定的门组用一个细框 + 底部箭头标出**，玩家永远知道下一次判定是哪一组。 |
| **L6 浮层** | 首页（标题 + 一句诚实声明 + 副标题 + 开始按钮 + 三行操作图示）、胜利结算、失败浮层「再来一次，不看广告」、帮助面板（操作说明 + 资源健康表 + 刷新资源）。DOM 覆盖层优先，需与 Canvas 逻辑坐标做同一套 letterbox 变换。 |

### 3.1 我方小兵画法（不再是圆点）

在 `(x,y)` 处、`s = scale(z)` 下依次画：

1. 地面椭圆阴影：`ctx.ellipse(x, y, 6*s, 2.4*s, 0, 0, 2π)`，填充 `rgba(0,0,0,.35)`；
2. 双腿：两条 `1.8*s` 宽线段，相位 `sin(frame*0.25 + index*0.7)` 前后摆；
3. 躯干：`POS→POS2` 竖向渐变的圆角胶囊，高 `11*s`、宽 `6*s`；
4. 头：半径 `3.2*s` 圆 + 左上高光点；
5. 持枪臂：一条短线 + `1.2*s` 宽枪管，开火时后坐位移；
6. 深色描边 `rgba(4,10,20,.65)` 保证深背景上不糊。

阵型：按 `min(power,120)` 排成楔形（前列少、后列多），行距 `9*s`、列距 `8*s`，整体随 `targetX` 缓动横移；人多时向两侧铺开并压缩行距，最多铺满 `halfWidth(z)*1.7`。

### 3.2 僵尸与 Boss

- 僵尸：`NEG→NEG2` 渐变、佝偻前倾、双臂前伸、蹒跚相位比小兵慢 0.6 倍；眼睛两个亮点；被击中时闪白 2 帧 + 3 个火花粒子后消失。密度随关卡增长但同样受绘制上限约束。
- Boss（`n%5===0`）：体型 `4~5` 倍、`BOSS='#a855f7'` 多层轮廓 + 外圈缓慢旋转光环 + 头顶独立血条（宽度 260 逻辑像素，`interpolate(Z0→0n)` 递减，**纯视觉，不改已锁定的结果**）；登场 500ms 内屏幕边缘泛紫脉冲 + 一次轻微震屏 + `boss.spawn` 音效。

### 3.3 后处理与氛围

- **泛光**：所有发光元素先以 `lighter` 叠一层半透明大半径描边，再画实心本体；
- **暗角**：整屏覆盖一次径向渐变 `rgba(0,0,0,0)→rgba(0,0,0,.45)`（只画一次，不做离屏模糊，保帧率）；
- **闪白**：命中/穿门瞬间全屏 `rgba(255,255,255,.06)` 一帧；
- **震屏**：`ctx.translate(dx,dy)`，`dx/dy` 由 `makeRng(frameCount ^ seed)` 派生（**禁 `Math.random`**），幅度 ≤3 逻辑像素，`prefers-reduced-motion` 时归零；
- **慢动作**：胜利揭晓前 180ms 把 `timeScale` 降到 0.45，随后恢复；
- **警报氛围**：S3 战斗开始时屏幕四边泛红脉冲 2 次（呼应 RESEARCH C8「紧急通知」/C17「边缘泛红 + 警报」）。

---

## 4. 立体闸门画法（四重编码 + 立体感）

每道门是一个**带厚度的梯形门框**，不是平面矩形：

1. 由 `projectX(u,z)` / `projectY(z)` 得到门在屏幕上的左右边界 `x1,x2` 与顶/底 `yTop,yBottom`；
2. **厚度**：向右下偏移 `(5*scale, 4*scale)` 画一层深色侧面，形成挤出感；
3. **门框**：宽 `6*scale` 的发光描边，`shadowColor` 用 `POS`（正）/ `NEG`（负），`shadowBlur=14*scale`；
   - 正门：顶部为**上扬圆弧**，四角大圆角；
   - 负门：顶部为**下压 V 形折角**，四角切角 —— 灰阶下也能一眼分辨；
4. **玻璃内胆**：竖向 `linearGradient`，正门 `rgba(56,189,248,.28)→rgba(34,211,238,.06)`，负门对应红色；叠一条随 `frameCount` 上下移动的扫描亮线（低画质档关闭）；
5. **标签**：`label`（`+7` / `×3` / `−2` / `÷2`）用 `Math.max(14, 26*scale(z))` 粗体，亮黄 `NUM` + 深色描边；符号 `+ − × ÷` 本身就参与编码；
6. **箭头**：正门 ↑ 上扬、负门 ↓ 下压，画在标签下方；
7. **对准高亮**：队伍 `targetX` 所在 lane 的门额外加一圈白色虚线描边 + 底部指示三角，让玩家清楚自己正选哪一道。

> 四重编码 = 颜色 + 运算符号 + 箭头 + 门框形状，满足 PRD R-05 的色盲可辨要求；灰阶截图下仍需可区分。

---

## 5. 渲染器抽象层（**不新增 script 块、不新增全局**）

关键点：ARCHITECTURE.md §12.1 规定全局命名空间只有 4 个 `window.__*`、§3.5 规定恰好 7 个 `<script id=...>`。因此抽象层**完全落在 `game-render` 这个 IIFE 内部**，对外仍只暴露 `Renderer.create(canvas)` / `resize(dpr)` / `draw(state)`，签名不变。

```
// game-render 内部（局部，不挂 window）
Scene = {
  cameraZ: number, frame: number, quality: 'high'|'medium'|'low',
  horizonY: 250, nearY: 854,
  gates:   [{ id, u, z, op, label, positive, highlighted }],
  allies:  [{ u, z, phase, firing }],
  zombies: [{ u, z, phase, hit }],
  boss:    null | { u, z, hpRatio },
  effects: [{ type, u, z, ttl, text? }],
  hud:     { level, powerText, enemyText, bossHpRatio, muted, hint },
  overlay: null | { type, ... }
}

Renderer = {
  create(canvas), resize(dpr), draw(state),
  // 内部方法（同一 IIFE 内互相调用，未来换后端只需替换这一组实现）
  buildScene(state): Scene,          // 纯数据转换，不含 Canvas API
  projectX(u,z), projectY(z), scale(z),
  beginFrame(scene), drawBackground(s), drawTrack(s), drawGate(s,g),
  drawUnit(s,a), drawHorde(s,z), drawBoss(s,b), drawEffects(s),
  drawHud(s), drawOverlay(s), endFrame(s)
}
```

- `buildScene(state)` 是**纯函数**：`GameSession` 的运行时 state → Scene 数据，不触碰 Canvas / DOM；可被 Node 单独断言（例如「门数 = 关卡门组数 × 每组门数」「highlighted 恰好 1 道」）。
- `draw(state)` 只是 `const s = buildScene(state); beginFrame→...→endFrame` 的固定编排。
- 判定逻辑（哪个 lane 生效、胜负、兵力）**全部留在 core / session**，渲染层只读 Scene，绝不反写。
- 未来替换 WebGL/Three.js 渲染器：实现同一组方法 + 消费同一份 Scene，替换 `game-render` 块即可，其余 6 个块零改动。

---

## 6. 音频增强：程序化合成 BGM（呼应「魔性 BGM」考据）

ARCHITECTURE.md §9.6 的 8 类音效全部保留，在 `game-audio` 内部追加一个轻量音序器，**不新增 script 块、不新增全局、不引入音频文件**：

- **调度**：`look-ahead` 模式，`setInterval(25ms)` 向前调度 `0.12s` 内的音符，时间基准 `AudioContext.currentTime`（不用 `setTimeout` 直接发声，避免抖动）；
- **节拍**：4/4、BPM 128、8 小节循环；五声音阶，避免难听的半音冲突；
- **4 条纯合成音轨**：
  1. Kick：`sine` 频率包络 `120→45Hz`，`gain` 0.25→0 用 0.12s；
  2. Hihat：白噪声 buffer + `highpass 7000Hz`，0.03s 衰减；
  3. Bass：`sawtooth` + `lowpass 400Hz`，跟随根音；
  4. Lead：`square` + 短 `gain` 包络，只在第 2/4/6/8 小节出现，留白避免吵；
- **主音量**：`masterGain.gain = 0.16`；静音时置 0，不销毁 context；与 8 类音效共用同一 `masterGain`；
- **状态联动**：S3 战斗与 Boss 关自动把 BPM 提到 142 并加入低频脉冲；S4 结算回落；
- **生命周期**：首次用户手势 `unlock()` 后才启动；`visibilitychange` 隐藏时停止调度、返回时若 `state==='suspended'` 先 `resume()` 再恢复调度；`prefers-reduced-motion` 不影响音频，但静音偏好优先；
- **零请求保证**：所有波形由 `OscillatorNode` / `AudioBuffer` 内存生成，无 `<audio src>`、无 fetch、无外部资源。

---

## 7. 游戏性修订：保证「选错会输」的决策张力

### 7.1 发现的问题

ARCHITECTURE.md §5.5 只保证「每组至少一道正增益门」（不变量 I-2）。若某一组的 2–3 道门全是 `+n` / `×n`，玩家无论选哪道都赢，`选门` 这个唯一自由度就失去意义——这会让游戏变成无脑点下一关，与「广告里那个要动脑的 +1 ×2 决策」不符。

### 7.2 修订（对 §5.5 门值生成规则的**唯一改动**）

> **新增不变量 I-4：每组必须至少一道负门（`sub` 或 `div`）。**

```
doorCount = 2 → 1 道保底正门(mul, value≥2n) + 1 道负门
doorCount = 3 → 1 道保底正门(mul, value≥2n) + 1 道随机门(可正可负) + 1 道负门
保底正门候选不变：普通关 {2n,3n}，Boss/里程碑关 {2n,3n,5n}
负门候选不变：sub = P0(n)*{1/3,1/2,1}，div = 2n
每组至多 1 道 div；lane 仍用 rng 做 Fisher-Yates 打散
```

I-1（保底 ×2 正门）、I-2（每组有正门）、I-3（全 bigint）、§5.4 全部公式、§5.6 构造式可解性证明**均不受影响**，1–1000 关仍 100% 可解。

### 7.3 新增 QA 断言（不新增 GameCore API）

用现有 `bestPath(level)` 与 `applyGatePath(power, path, level)` 即可计算，无需改 26 项签名：

```
for n in 1..1000:
  L = generateLevel(n)
  best  = bestPath(L).power                       // 每组选局部最大结果
  worst = applyGatePath(L.entryPower, worstPath(L), L).power   // 每组选局部最小结果
  assert best  * 10n >= L.enemyPower * 11n       // 存在必胜路径（原 R-13）
  assert worst < L.enemyPower                    // 存在必败路径（新增张力断言）
```

> 「存在必胜路径」且「存在必败路径」同时成立，才叫真正的决策。QA 把这两条一起写进 `tests/core.test.js`。

---

## 8. 画质自适应与可访问性

| 档位 | dpr 上限 | 粒子上限 | 单位上限 | 泛光/扫描线/暗角 | 触发 |
|---|---|---|---|---|---|
| high | 2 | 240 | 120 | 全开 | 默认 |
| medium | 2 | 120 | 90 | 泛光开，扫描线关 | 连续 30 帧平均 fps < 45 |
| low | 1.5 | 40 | 60 | 全关，小人简化为胶囊+头 | 连续 30 帧平均 fps < 32 |

- 升级需 fps > 55 且稳定 3 秒（滞回，防档位抖动）；帧率统计用 `performance.now()` 的滑动窗口，不参与任何胜负判定。
- `prefers-reduced-motion`：震屏归零、闪白关闭、粒子减半、飘字改静态淡入、扫描线静止；**玩法与数值完全不变**。
- 灰阶模拟下四重编码仍可辨；全部交互键盘可达；对比度沿用 §12.6 常量（≥4.5:1）。

---

## 9. 截图级验收补充（交给 QA，与 PRD A-1~A-15 合并执行）

真实验证**不能只断言逻辑**。用 `/opt/homebrew/opt/python@3.9/bin/python3.9` 的 Playwright + 本机 Chrome（`executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`，已实测可启动）在 `file://` 下逐屏截图并落盘 `tests/screenshots/`：

| # | 画面 | 必检项 |
|---|---|---|
| V-1 | 首页 | 标题、一句诚实声明、副标题、开始按钮、三行操作图示；**无登录/礼包/广告/下载/行业批判** |
| V-2 | S1 门组预览 | 本关全部门组缩略一屏可见、关卡号与 P/Z 并排显示 |
| V-3 | S2 选门跑酷 | 透视跑道近宽远窄、立体闸门四重编码、当前对准 lane 高亮、我方小兵带阴影与跑动姿态 |
| V-4 | 穿门瞬间 | `+7`/`×3` 飘字、数字跳动、粒子与泛光、HUD 兵力与预期公式一致 |
| V-5 | S3 战斗 / Boss 关 | 自动开火弹幕、僵尸潮、Boss 独立血条与登场演出、边缘红色警报 |
| V-6 | 胜利浮层 | 「第 N 关 · 清空」+ 增兵 / 剩余兵力 / 最高关 + [下一关]，无签到分享诱导 |
| V-7 | 失败浮层 | 「再来一次，不看广告」+ [重试本关]；**无复活/看广告/跳过/续命** |
| V-8 | 帮助面板 | 操作说明 + 资源健康表（12 条状态 / 来源 / 失败原因）+ [刷新资源] |

另需：320 / 375 / 430 / 1280 / 1920 五种视口无横向滚动与元素重叠；控制台零报错；`performance.getEntriesByType('resource')` 无 http(s) 项；连续 6 组门 + 满屏僵尸时帧率 ≥45fps；注入资源双失败后 V-1~V-7 画面不空白、游戏仍可通关。

---

## 10. 与 ARCHITECTURE.md 的兼容性声明（逐条）

| 约束 | 本文件是否改动 |
|---|---|
| 7 个 `<script id=...>` 块及加载顺序 | ❌ 不改；2.5D / 抽象层 / BGM 分别落在 `game-render`、`game-audio` 内部 |
| 4 个 `window.__*` 全局命名空间 | ❌ 不新增；`Renderer` 内部方法与音序器均为 IIFE 局部 |
| `GameCore` 26 项 API 签名、§3.1 数据结构 | ❌ 不改；张力断言用现有 `bestPath` + `applyGatePath` 组合实现 |
| §5.4 全部闭式公式、§5.6 可解性证明 | ❌ 不改；仅 §5.5 门值生成增加 I-4（每组至少一负门） |
| §6 战斗快照锁定裁定、§7 资源三档 mode | ❌ 不改 |
| §8 状态机 S1–S4、§10 测试边界、§12 常量/颜色/禁用词 | ❌ 不改 |
| T01–T10 任务顺序 | ❌ 不改；本文件内容并入 **T07（渲染）/ T06（音频）/ T03（门生成）** 三个任务的完成判据 |

**无待明确事项**，实现中若出现新歧义由开发侧自行研究决定，不向用户提问（PRD H-7）。
