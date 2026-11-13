# 安全说明

## 这个项目收集什么

**什么都不收集。** 没有后端、没有账号、没有埋点、没有分析 SDK、没有第三方脚本、
没有 Cookie 同意条、没有运行时网络请求。唯一写进浏览器的本地状态是
`localStorage['hgz.best']`（最高通关关卡，一个整数），包在 `try/catch` 里，
无存储权限时自动退化为内存态。

`window.__GAME_DEBUG__` / `__ASSET_HEALTH__` / `__GAME_CORE__` / `__ASSET_TEST_HOOKS__`
都是只读或纯本地的调试接口，不上传数据，也不能改兵力、跳关或改胜负。
`__ASSET_TEST_HOOKS__` 的故障注入走 MockLoader，全程零真实网络 IO。

## 报告漏洞

这是一个纯静态单文件游戏，没有服务端攻击面。但如果你发现：

- 能绕过 `verifySolvable` 或改写胜负 / 兵力的接口；
- 引入了外部请求、隐私收集或恶意依赖；
- 可通过输入造成崩溃、无限循环或浏览器级问题；

请在 [Issues](https://github.com/guyue55/honest-gate-zombies/issues) 提交，
或优先使用 GitHub 的 **Report a vulnerability**（私有安全通告）。

请不要在公开 issue 中贴任何密钥、令牌或个人数据。修复会随 `main` 分支的 Pages 部署一同发布。

## 供应链

零运行时依赖，零构建步骤。`package.json` 的 `scripts` 只调用仓库内的 Node / Python 脚本，
不执行 `npm install` 也不会产生 `node_modules`。CI 只用 `actions/checkout` 与 `actions/setup-node`，
权限固定为 `contents: read`。
