# 部署说明

## 在线地址

**https://guyue55.github.io/honest-gate-zombies/**

仓库：<https://github.com/guyue55/honest-gate-zombies> · 公开 · MIT

Pages 配置：**Build and deployment → Deploy from a branch → `main` / `/ (root)`**。
不需要 Actions、不需要构建命令、不需要 `docs/` 作为源目录——根目录的 `index.html` 就是站点入口。
根目录下的 `.nojekyll` 让 GitHub 跳过 Jekyll，保证下划线目录与静态资源原样发布。

## 三种打开方式

| 方式 | 命令 / 操作 | 适用 |
|---|---|---|
| **双击即玩** | 直接双击 `index.html`（`file://`） | 最简；无需安装、无需联网 |
| **本地静态服务器** | `npm run serve` → <http://127.0.0.1:8080> | 想模拟 http 环境、测资源自愈 `?assets=local` |
| **GitHub Pages** | 打开上面的在线地址 | 分享、手机浏览器 |

游戏只依赖浏览器原生能力（Canvas 2D、Web Audio、Pointer/Keyboard 事件、系统字体栈），
没有 `<script src>` / `<link rel=stylesheet>` / `<img src>` / `@font-face` / ES Module，
因此 `file://` 不会因 CORS 被拦，挂在项目站点子路径 `/honest-gate-zombies/` 下也不会 404。

## 为什么不用构建

`index.html` 内联了全部 CSS 与 7 个 `<script>` 块。所有画面由 Canvas 2D 程序化绘制，
音效与 BGM 由 Web Audio 实时合成。`assets/manifest.json` 只在显式 `?assets=local` 且非 `file:`
时才可能被读取；默认 `mode=off`，**运行时外部请求数为 0**。

把仓库里的 `assets/`、`docs/`、`tests/`、`.github/`、`scripts/` 全删掉，只留 `index.html`，游戏功能完全不变。

## 发布流程

```bash
# 1) 本地四层自检（零依赖，不用 npm install）
npm test                          # extract-core + core.test + static-audit + check-deploy

# 2) 可选：真实浏览器双协议全量回归
python3 tests/browser_check.py --protocol file
python3 tests/browser_check.py --protocol http --port 8765

# 3) 提交并推送
git add -A && git commit -m "..." && git push origin main
```

Pages 会在 `main` 更新后自动重新发布（通常几十秒）。CI（`.github/workflows/ci.yml`）
在每次 push / PR 跑同一套 Node 四层自检，不参与部署。

首次用 GitHub CLI 建档与开启 Pages 的命令（记录用，已经执行过）：

```bash
gh repo create guyue55/honest-gate-zombies --public \
  --description "..." --source=. --remote=origin --push
gh api -X POST repos/guyue55/honest-gate-zombies/pages \
  -f "build_type=legacy" -f "source[branch]=main" -f "source[path]=/"
```

## 部署自检脚本

`node scripts/check-deploy.mjs` 把「能静态托管」变成 11 条可执行断言：

- 根目录有 `index.html`、有 `.nojekyll`、DOCTYPE / viewport / title 齐备
- 运行期零外链（无 `http(s)://`、CDN、`<script src>`、外部样式 / 字体 / 图片 / 音频、`eval`、XHR）
- 唯一 `fetch` 带 `file:` 短路守卫、资源自愈默认 `mode=off`
- 无根绝对路径（项目站点子路径不会 404）
- 页面引用的本地资源真实存在且大小写一致（Pages 是 Linux，大小写敏感）
- 单文件体积 ≤ 300 KiB

## 验收清单

部署后在浏览器里确认：

- [ ] `https://guyue55.github.io/honest-gate-zombies/` 返回 200，直接显示首页「数字门 · 打僵尸」
- [ ] DevTools Network 无跨域 / 404；Console 无 error
- [ ] 点「开始游戏」→ 穿完 20 组门 → 9.5 秒战斗 → 结算，可点「下一关」
- [ ] 手机竖屏、桌面窄窗口都不出现横向滚动
- [ ] 断网 / 飞行模式下刷新仍可完整玩一关
- [ ] 灰阶模式下正负门可区分；系统开启「减少动态效果」后震动 / 闪白 / 粒子关闭

## 自定义域名（可选）

在仓库根目录加 `CNAME` 文件（内容为域名），并把 DNS 指向
`guyue55.github.io`；随后在 Pages 设置里填同一域名并开启 Enforce HTTPS。
游戏本身不含任何绝对地址，换域名无需改代码。

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| Pages 404 | 源分支/目录选错，或没有根目录 `index.html` | 设为 `main` / `/ (root)` |
| 资源 404 | 使用了 `/assets/...` 根绝对路径 | 改相对路径；`check-deploy.mjs` 会拦 |
| 样式/脚本被 Jekyll 吃掉 | 缺 `.nojekyll` | 保留根目录 `.nojekyll` |
| 本地能跑、线上白屏 | 文件名大小写不一致 | Linux 区分大小写；`check-deploy.mjs` 会核 |
| 手机上画面被裁 | 视口 meta 或舞台缩放 | 保留 `index.html` 的 viewport 与 resize 逻辑 |
