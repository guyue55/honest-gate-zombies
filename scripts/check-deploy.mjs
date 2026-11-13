#!/usr/bin/env node
/**
 * 可静态托管性守卫（GitHub Pages / 任意静态服务器 / file://）。
 *
 * 目的：把「单文件、零外链、零构建、子路径可挂」这套硬约束变成一条可执行断言，
 * 避免后续改动悄无声息地引入外链、绝对路径或大文件，导致 Pages 上 404 / 白屏。
 *
 * 用法：node scripts/check-deploy.mjs [--json]
 * 退出码：0 通过；1 有硬性问题。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'index.html');
const SIZE_BUDGET = 300 * 1024; // 300 KiB：单文件交付预算

const checks = [];
const info = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

if (!existsSync(ENTRY)) {
  console.error('缺少 index.html，无法检查');
  process.exit(1);
}

const html = readFileSync(ENTRY, 'utf8');
const bytes = statSync(ENTRY).size;

/* 1. 入口与 Pages 约定 */
check('根目录有 index.html', existsSync(ENTRY), 'index.html');
check('存在 .nojekyll（禁用 Jekyll，保证下划线目录/文件原样发布）', existsSync(join(ROOT, '.nojekyll')));
check('入口以 <!DOCTYPE html> 开头', /^\s*<!DOCTYPE html>/i.test(html));
check('含 viewport meta（移动端竖屏）', /<meta[^>]+name=["']viewport["']/i.test(html));
check('有非空 <title>', /<title>[^<]*\S[^<]*<\/title>/i.test(html));

/* 2. 零外链：任何协议前缀都视为违规（README 里的徽章不算运行期资源） */
const externalHits = [];
for (const re of [
  /https?:\/\//gi,
  /\/\/(?:cdn|unpkg|jsdelivr|cdnjs|fonts)\./gi,
  /<script[^>]+\bsrc\s*=/gi,
  /<link[^>]+rel=["']stylesheet["'][^>]*>/gi,
  /@import\s+url\(/gi,
  /@font-face/gi,
  /<img[^>]+\bsrc\s*=/gi,
  /<audio[^>]+\bsrc\s*=/gi,
  /XMLHttpRequest/gi,
  /\beval\s*\(/gi,
]) {
  const m = html.match(re);
  if (m) externalHits.push(`${re.source} ×${m.length}`);
}
check('运行期零外链 / 零外部资源', externalHits.length === 0, externalHits.join('; ') || '0 命中');

/* 2b. 唯一允许的联网点是资源自愈机制里的 window.fetch，它必须带 file:// 短路且默认关闭。
   这两条断言把「默认零请求」从口头承诺变成可回归的检查（实测由 browser_check.py 复核）。 */
const fetchHits = [...html.matchAll(/\bfetch\s*\(/gi)].length;
check('唯一联网点带 file:// 短路守卫', fetchHits === 0 || html.includes('file-protocol-skip'), `fetch ×${fetchHits}`);
check(
  '资源自愈默认 mode=off（首帧不发起任何请求）',
  /mode\s*:\s*['"]off['"]/.test(html) || /['"]off['"]\s*;/.test(html),
  'mode off'
);

/* 3. 子路径可挂：不得出现以 / 开头的绝对路径引用 */
const absoluteHits = [...html.matchAll(/(?:src|href)\s*=\s*["']\/(?!\/)/gi)].map((m) => m[0]);
check('无根绝对路径（项目站点挂在 /repo-name/ 下不会 404）', absoluteHits.length === 0, absoluteHits.join(', ') || '0 命中');

/* 4. 页面内引用的相对资源必须真实存在且大小写一致（GitHub Pages 为 Linux，大小写敏感） */
const relRefs = new Set();
for (const re of [/(?:src|href)\s*=\s*["'](?!https?:|\/\/|#|data:|javascript:)([^"'?]+)/gi, /["'](assets\/[\w./-]+)["']/gi]) {
  for (const m of html.matchAll(re)) relRefs.add(m[1]);
}
const missing = [];
for (const ref of relRefs) {
  const p = join(ROOT, ref);
  if (!existsSync(p)) missing.push(ref);
}
check(
  '页面引用的本地资源都存在（区分大小写）',
  missing.length === 0,
  missing.length ? `缺失: ${missing.join(', ')}` : [...relRefs].join(', ') || '无外部引用'
);

/* 5. 体积预算 */
check(
  `单文件体积 ≤ ${SIZE_BUDGET / 1024} KiB`,
  bytes <= SIZE_BUDGET,
  `${(bytes / 1024).toFixed(1)} KiB`
);

/* 6. 体积信息（非断言）：仓库若被塞入构建产物会立刻看出来 */
info.push(`index.html = ${bytes} B / ${html.split('\n').length} 行`);
for (const extra of ['assets/manifest.json', 'docs/screenshots/home.png']) {
  if (existsSync(join(ROOT, extra))) info.push(`${extra} = ${statSync(join(ROOT, extra)).size} B`);
}

const failed = checks.filter((c) => !c.ok);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks, info }, null, 2));
} else {
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`);
  for (const line of info) console.log(`INFO  ${line}`);
  console.log(`\n硬性问题: ${failed.length}  判定: ${failed.length === 0 ? 'PASS' : 'FAIL'}`);
}
process.exit(failed.length === 0 ? 0 : 1);
