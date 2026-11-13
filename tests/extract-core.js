'use strict';
/**
 * tests/extract-core.js —— 同源 GameCore 抽取器（ARCHITECTURE §3.4「A-2 同源代码抽取协议」）
 *
 * 职责：
 *  1. 读取 index.html，用定死正则抽出 <script id="game-core"> 块内的源码；
 *  2. 在「最小全局集合」的 vm sandbox 中执行，故意不提供任何浏览器 / IO 全局；
 *     core 若意外触碰 window / document / fetch / AudioContext / timer 等，vm 抛 ReferenceError；
 *  3. 同时支持 UMD 的 CommonJS 分支（module.exports）与浏览器分支（__GAME_CORE__）；
 *  4. 导出 extractCore(htmlPath) 供 core.test.js / static-audit.js require；
 *  5. CLI：node tests/extract-core.js [htmlPath] 打印 API 名列表与数量。
 *
 * 说明（诚实记录）：vm 的 contextified sandbox 会自动提供 ECMAScript 标准内置对象，
 * 其中 Date / Math.random 属于标准内置，无法靠「不提供」拦截；本项目对它们的守卫
 * 依赖 core.test.js 的确定性断言与 static-audit.js 的静态检索。真正能在 sandbox 中
 * 拦截的是 window / document / localStorage / fetch / performance / timer 等非标准全局。
 * 为让 Date 的偷碰也立即暴露，这里显式把 sandbox.Date 置为 undefined。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DEFAULT_HTML_PATH = path.resolve(__dirname, '..', 'index.html');

// §3.4.1 / §3.4.2 定死的抽取正则（不得放宽，避免误抽到其它 script 块）
const CORE_SCRIPT_RE = /<script\s+id="game-core"[^>]*>([\s\S]*?)<\/script>/i;

// §3.4.3 mock 全局最小集合（语言内置 + 静默 console）
const ALLOWED_GLOBALS = [
  'BigInt', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON',
  'Map', 'Set', 'Promise', 'Error', 'TypeError', 'RangeError', 'Symbol', 'Function', 'RegExp',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite'
];

// 浏览器 / IO 全局：主 sandbox 一律不提供；guardDom 模式下改成「一读就抛错」的探针
const BLOCKED_DOM_GLOBALS = [
  'window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest',
  'AudioContext', 'Audio', 'Image', 'navigator', 'location', 'performance',
  'setTimeout', 'setInterval', 'requestAnimationFrame',
  'CanvasRenderingContext2D', 'HTMLCanvasElement'
];

// guardDom 探针只覆盖「core 绝不会用 typeof 做防御性检查」的全局，避免误伤 UMD 模板
const DOM_GUARD_PROBE_NAMES = [
  'document', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest',
  'AudioContext', 'performance', 'setTimeout', 'setInterval', 'requestAnimationFrame'
];

function noop() {}

function makeSandbox(browserBranch, guardDom) {
  const sandbox = {};
  for (const key of ALLOWED_GLOBALS) {
    if (global[key] !== undefined) sandbox[key] = global[key];
  }
  sandbox.console = { log: noop, warn: noop, error: noop, info: noop, debug: noop };

  // CommonJS 分支开关：提供 module 命中 UMD 的 `typeof module === 'object' && module.exports`
  if (!browserBranch) sandbox.module = { exports: {} };

  // 标准内置 Date 无法靠「不提供」屏蔽，显式置 undefined，偷碰立即 TypeError
  sandbox.Date = undefined;

  if (guardDom) {
    for (const name of DOM_GUARD_PROBE_NAMES) {
      Object.defineProperty(sandbox, name, {
        configurable: true,
        enumerable: false,
        get() {
          throw new ReferenceError('game-core 偷碰被禁全局: ' + name);
        }
      });
    }
  }
  return sandbox;
}

/** 读取并返回 game-core 块内源码（不执行）。 */
function extract(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(CORE_SCRIPT_RE);
  if (!m) {
    throw new Error('未找到 <script id="game-core"> 块；请核对 ARCHITECTURE §3.4.1 的 UMD 模板');
  }
  return m[1];
}

/**
 * 执行并返回 { core, sandbox, code }。
 * opts.browserBranch: true 走浏览器分支（__GAME_CORE__），false 走 CJS（module.exports）
 * opts.guardDom:      true 时把被禁全局替换为抛错 getter，供 DOM 守卫断言
 */
function extractCoreVerbose(htmlPath, opts) {
  const o = Object.assign({ browserBranch: false, guardDom: false }, opts || {});
  const code = extract(htmlPath || DEFAULT_HTML_PATH);
  const sandbox = makeSandbox(o.browserBranch, o.guardDom);

  // 浏览器分支追加只读探针，兼容 UMD 未挂 __GAME_CORE__ 的兜底实现（§3.4.2）
  const probe = o.browserBranch
    ? '\n;try { globalThis.__CORE_EXPORT_PROBE__ = globalThis.__GAME_CORE__; } catch (e) {}'
    : '';

  vm.runInNewContext(code + probe, sandbox, {
    timeout: 5000,
    filename: o.browserBranch ? 'game-core.browser.js' : 'game-core.js'
  });

  let core;
  if (!o.browserBranch) {
    core = sandbox.module && sandbox.module.exports;
  } else {
    core = sandbox.__GAME_CORE__ || sandbox.__CORE_EXPORT_PROBE__;
  }
  if (!core || typeof core !== 'object') {
    throw new Error('未能取得 Core 对象：CJS 分支 module.exports / 浏览器分支 __GAME_CORE__ 均为空');
  }
  return { core, sandbox, code };
}

/** 主导出：返回 GameCore 对象。 */
function extractCore(htmlPath, opts) {
  return extractCoreVerbose(htmlPath, opts).core;
}

module.exports = {
  extractCore,
  extractCoreVerbose,
  extract,
  CORE_SCRIPT_RE,
  DEFAULT_HTML_PATH,
  ALLOWED_GLOBALS,
  BLOCKED_DOM_GLOBALS
};

// ---- CLI：node tests/extract-core.js [htmlPath] ----
if (require.main === module) {
  const htmlPath = process.argv[2] || DEFAULT_HTML_PATH;
  try {
    const { core } = extractCoreVerbose(htmlPath, { browserBranch: false });
    const keys = Object.keys(core).sort();
    // 裁决 U-1：GameCore 严格 26 项（§3.2 原表）。
    // projectToScreen / buildScene 属 game-render IIFE 局部（U-2），不是 Core 导出。
    const API_COUNT_EXPECTED = 26;
    console.log('index.html : ' + htmlPath);
    console.log('API 数量   : ' + keys.length + '（裁决 U-1：严格 26 项）');
    console.log('API 名列表 :');
    for (const k of keys) {
      const v = core[k];
      console.log('  - ' + k + ' : ' + (typeof v === 'function' ? 'function' : typeof v));
    }
    if (keys.length !== API_COUNT_EXPECTED) {
      console.error('[extract-core] API 数量断言失败：期望 ' + API_COUNT_EXPECTED +
        '，实际 ' + keys.length + '；严格 §3.2 原表 26 项，' +
        'buildScene / projectToScreen 属 game-render 局部，不应作为 Core 导出');
      process.exit(1);
    }
    console.log('API 数量断言 : PASS (' + API_COUNT_EXPECTED + ')');
  } catch (e) {
    console.error('[extract-core] 失败: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  }
}
