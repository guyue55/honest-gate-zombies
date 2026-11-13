# 贡献指南

谢谢你有兴趣改这个项目。它很小，但有几条**不能破**的约束——它们是这个游戏存在的理由，不是风格偏好。

## 先跑一次

```bash
git clone https://github.com/guyue55/honest-gate-zombies.git
cd honest-gate-zombies
npm test                 # 不需要 npm install：零依赖
```

`npm test` 会依次跑四层：`extract-core.js`（26 项 API）、`core.test.js`（纯函数断言）、
`static-audit.js`（禁用词 / 确定性 / 结构）、`scripts/check-deploy.mjs`（可静态托管性）。
四层全绿才提 PR。浏览器全量回归是可选但推荐的：

```bash
python3 tests/browser_check.py --protocol file
python3 tests/browser_check.py --protocol http --port 8765
```

见 [`tests/README.md`](tests/README.md) 与 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

## 六条硬约束

1. **一个文件**：游戏本体只住在根目录 `index.html`。不引入构建步骤、打包器、外部脚本/样式/字体/图片/音频。
2. **零外链**：运行时网络请求数为 0。`file://` 双击可玩、断网可玩、GitHub Pages 子路径可玩。
   唯一 `fetch` 在资源自愈机制里，默认 `mode=off` 且 `file:` 硬短路。
3. **确定性**：禁止 `Math.random` 参与生成与胜负。所有变化由 `Core.makeRng` / 关卡号 / 帧号派生。
4. **26 项 Core API 严格不变**：`<script id="game-core">` 是可在 Node `vm` 沙箱里独立加载的纯函数集合，
   不碰 `window` / `document` / `ctx` / `Date` / 定时器。多一项少一项 CI 都会红。
5. **100% 诚实玩法**：不加广告、复活、登录、内购、体力、抽卡、养成、局外数值、第二玩法、分享得奖励。
   失败免费无限重试同一关，不扣任何东西、不降难度。
6. **100% 可胜**：`verifySolvable` 保证最优路径 ≥ 敌方兵力 × 1.1；胜负由 S3 入口快照一次性锁定。
   任何「看起来在打」的表现层改动都**不得**写入兵力、胜负或下一关起始值。

另外：`game-core` 与 `game-session` 块内不得出现 `ctx.*`（Canvas 只属于 `game-render`）。

## 改动分层

| 想改什么 | 改哪里 | 注意 |
|---|---|---|
| 门运算 / 关卡生成 / 可解性 / 数值曲线 | `<script id="game-core">` | 需同步 `tests/core.test.js` 的期望口径 |
| 关卡节奏 / 状态机 / 战斗模拟 / 调试快照 | `<script id="game-session">` | 纯数值；不得碰 ctx；评级只影响评价 |
| 画面 / 特效 / HUD / 弹道绘制 | `<script id="game-render">` | 只读投影 session 下发的数据，不要二次随机生成 |
| 三端输入 | `<script id="game-input">` | 触屏 / 键盘 / 鼠标统一输出 `targetX` |
| 音效 / BGM | `<script id="game-audio">` | Web Audio 实时合成，无音频文件 |

## 提 PR 前自查

- [ ] `npm test` 四层全绿
- [ ] 7 个 `<script>` 块都能被 `new Function` 解析
- [ ] 真机截图确认：门不被队伍挡住、门值不溢出、陷阱在门板上可见、弹道起点在枪口终点在僵尸身上
- [ ] 灰阶下正负门仍可区分；`prefers-reduced-motion` 下震动 / 闪白 / 粒子 / 顿帧全关
- [ ] 胜负由入口快照锁定，新特效不改兵力与 outcome
- [ ] 文档同步（至少 `README.md` + 相关 `docs/` 章节 + `CHANGELOG.md`）

## 报告问题

用 [Bug 模板](.github/ISSUE_TEMPLATE/bug_report.md)，附上 `JSON.stringify(window.__GAME_DEBUG__)` 的输出最有帮助。
不收集任何用户数据，也不要在 issue 里贴密钥或个人隐私。
