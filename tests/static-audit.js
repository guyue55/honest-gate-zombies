'use strict';
/**
 * tests/static-audit.js —— 对 index.html 全文静态审计
 *
 * 运行：node tests/static-audit.js [--json] [--html <path>]
 * 覆盖 ARCHITECTURE §12.7：
 *   - 产品禁用词（PRD 6.4 / R-15）：11 个词，报告「剥离注释前 / 剥离注释后」命中数与行号，
 *     并区分「合法否定语境（如失败文案『再来一次，不看广告』）」与「违规命中」；
 *   - 技术禁用模式：Math.random / script src / link stylesheet / @import / @font-face /
 *     img src / audio src / XHR / eval / new Function / http(s) 字面量 / 绝对路径 /assets/ 等；
 *   - 结构检查：7 个 script 块且 id 符合 §3.5、无 type="module"、game-core 块内无
 *     </script> 字面量 / 无 Math.random / 不访问 DOM 全局、所有 bigint 字面量带 n；
 *   - 裁决 U-9：按 <script> 块分段检索，game-core / game-session 块内不得出现 ctx.*。
 *
 * 判定：硬违规（violation）总数 === 0 → PASS；软检查（fetch / localStorage / Number( 等）
 * 只如实报告不计入失败，供阶段 B 人工确认协议守卫 / try-catch。
 */
const fs = require('fs');
const path = require('path');
const { extract, CORE_SCRIPT_RE, DEFAULT_HTML_PATH } = require('./extract-core');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const htmlArgIdx = argv.indexOf('--html');
const HTML_PATH = htmlArgIdx >= 0 && argv[htmlArgIdx + 1]
  ? path.resolve(argv[htmlArgIdx + 1]) : DEFAULT_HTML_PATH;

// ---------------- 产品禁用词（§12.7） ----------------
const PRODUCT_WORDS = [
  '复活', '看广告', '激励视频', '礼包码', '首充', '抽卡',
  '续命', '跳过关卡', '分享得', '立即下载', '差一点'
];

// ---------------- 技术禁用模式（§12.7） ----------------
// [名称, 正则, 硬违规?, 说明]
const TECH_PATTERNS = [
  ['Math.random', /Math\.random/, true, '表现层随机须用 makeRng 派生'],
  ['<script src=', /<script\b[^>]*\bsrc\s*=/i, true, '零外部脚本'],
  ['<link rel=stylesheet href=', /<link\b(?=[^>]*\brel\s*=\s*['"]stylesheet['"])(?=[^>]*\bhref\s*=)[^>]*>/i, true, '零外部样式'],
  ['@import url(http', /@import\s+url\(\s*['"]?\s*https?:/i, true, '零外部样式导入'],
  ['@font-face', /@font-face/i, true, '系统字体栈，无外部字体'],
  ['<img src', /<img\b[^>]*\bsrc\s*=/i, true, '零外部图片'],
  ['<audio src', /<audio\b[^>]*\bsrc\s*=/i, true, '零外部音频'],
  ['XMLHttpRequest', /XMLHttpRequest/, true, '禁止 XHR'],
  ['eval(', /\beval\s*\(/, true, '禁止 eval'],
  ['new Function(', /new\s+Function\s*\(/, true, '禁止动态构造函数'],
  ['http(s):// 运行时字面量', /https?:\/\//, true, '剥离注释后应为 0'],
  ['绝对路径 /assets/', /['"]\/assets\//, true, 'Pages 子路径会 404'],
  ['<script> 内 </script> 字面量', /<\/script\s*>/i, false, '仅对 game-core 块做硬判定，见结构检查'],
  ['type=module', /type\s*=\s*['"]?module['"]?/i, true, '无 ES Module（file:// 会被 CORS 拦）'],
  // ---- 软检查：如实报告，不直接判定违规 ----
  ['fetch(', /\bfetch\s*\(/, false, '软：需确认在 mode≠off 且非 file: 守卫内'],
  ['localStorage', /\blocalStorage\b/, false, '软：需确认 try/catch 包裹'],
  ['bigint/number 混算(浮点字面量)', /\b\d+\.\d+\b/, false, '软：需人工确认是否参与 bigint 算术']
];

const EXPECTED_IDS = [
  'game-core', 'game-assets', 'game-audio', 'game-render',
  'game-input', 'game-session', 'game-boot'
];

const CORE_FORBIDDEN_GLOBALS = [
  'window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest',
  'AudioContext', 'Audio', 'Image', 'navigator', 'location', 'performance',
  'Date', 'setTimeout', 'setInterval', 'requestAnimationFrame',
  'CanvasRenderingContext2D', 'HTMLCanvasElement'
];

// ---------------- 工具 ----------------
function lineStarts(text) {
  const arr = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') arr.push(i + 1);
  return arr;
}
function lineAt(starts, idx) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}
function indexOfAll(text, needle) {
  const out = [];
  let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) { out.push(i); i += needle.length; }
  return out;
}
function regexHits(text, re) {
  const out = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = r.exec(text)) !== null) {
    out.push(m.index);
    if (m[0] === '') r.lastIndex++;
  }
  return out;
}
/** 把注释替换成等长空格，保持行号与命中位置对齐；字符串内容原样保留。 */
function blankOut(match) { return match.replace(/[^\n]/g, ' '); }
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, blankOut);
}
/**
 * 剥离 JS / CSS 注释（// 与 /* *\/），感知 ' " ` 字符串。
 * 特例：`://` 中的 `//` 不当行注释（保留无引号 URL 以便被禁用模式检出）。
 */
function stripJsComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let state = 'code';
  let quote = '';
  while (i < n) {
    const c = text[i], c2 = text[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/' && (i === 0 || text[i - 1] !== ':')) {
        state = 'line'; out += '  '; i += 2; continue;
      }
      if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; } else out += ' ';
      i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += (c === '\n' ? '\n' : ' '); i++; continue;
    }
    // state === 'str'
    if (c === '\\') { out += c + (i + 1 < n ? text[i + 1] : ''); i += 2; continue; }
    out += c;
    if (c === quote) state = 'code';
    i++;
  }
  return out;
}

/**
 * 全文剥离：只对 <script> / <style> 块内应用 JS/CSS 注释剥离，
 * HTML 标签区（含属性引号）不进入状态机，避免把属性引号误判为字符串起止。
 * 传入纯 JS 片段（如 game-core 块内容，无 <script 标签）时直接按 JS 剥离。
 * 剥离一律替换为等长空格，命中位置与行号保持对齐。
 */
function stripCodeComments(text) {
  if (text.indexOf('<script') === -1 && text.indexOf('<style') === -1) {
    return stripJsComments(text);
  }
  return text
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
      (m, a, b, c) => a + stripJsComments(b) + c)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
      (m, a, b, c) => a + stripJsComments(b) + c);
}

/** 合法语境判定：失败文案「再来一次，不看广告」中的「看广告」属否定式诚实文案，非违规。 */
function classifyProduct(word, text, idx) {
  if (word !== '看广告') return 'violation';
  const before = text.slice(Math.max(0, idx - 1), idx);
  if (before === '不' || before === '无') return 'legit';
  const ls = text.lastIndexOf('\n', idx - 1) + 1;
  let le = text.indexOf('\n', idx);
  if (le < 0) le = text.length;
  const line = text.slice(ls, le);
  if (/(不看广告|没有骗人广告|无广告|再来一次|诚实声明|不弹|不植入|不请求)/.test(line)) return 'legit';
  return 'violation';
}

/**
 * 按 <script ...> 分段（U-9 用）：返回 {id, attrs, content, offset}。
 * offset 为块内容在全文中的起始下标，便于把块内命中换算成全文行号。
 */
function scriptBlocks(raw) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const idm = /\bid\s*=\s*['"]([^'"]+)['"]/i.exec(m[1]);
    out.push({
      id: idm ? idm[1] : null,
      attrs: m[1],
      content: m[2],
      offset: m.index + m[0].indexOf('>') + 1
    });
  }
  return out;
}

// ---------------- 主审计 ----------------
function audit() {
  const raw = fs.readFileSync(HTML_PATH, 'utf8');
  const noHtml = stripHtmlComments(raw);
  const code = stripCodeComments(noHtml);
  const starts = lineStarts(raw);
  const totalLines = starts.length;

  const report = {
    file: HTML_PATH,
    totalLines,
    productWords: [],
    techPatterns: [],
    structure: [],
    scriptBlockCtx: [],
    bigint: {},
    softNotes: [],
    hardViolations: 0,
    result: 'PASS'
  };
  let violations = 0;

  // ---- 产品禁用词 ----
  for (const word of PRODUCT_WORDS) {
    const rawHits = indexOfAll(raw, word);
    const codeHits = indexOfAll(code, word);
    let legit = 0, violation = 0;
    const legitLines = [], violationLines = [];
    for (const idx of codeHits) {
      const ln = lineAt(starts, idx);
      if (classifyProduct(word, code, idx) === 'legit') { legit++; legitLines.push(ln); }
      else { violation++; violationLines.push(ln); }
    }
    violations += violation;
    report.productWords.push({
      word,
      rawHits: rawHits.length, rawLines: rawHits.map(i => lineAt(starts, i)),
      codeHits: codeHits.length,
      legit, legitLines, violation, violationLines
    });
  }

  // ---- 技术禁用模式 ----
  for (const [name, re, hard, note] of TECH_PATTERNS) {
    // `</script>` 字面量全文必然存在（各 script 闭合标签），只在 core 块单独硬判定
    if (name.indexOf('</script>') >= 0) {
      report.techPatterns.push({ name, rawHits: null, codeHits: null, hard: false, note: '见结构检查 coreLiteralCloseScript', lines: [] });
      continue;
    }
    const rawHits = regexHits(raw, re);
    const codeHits = regexHits(code, re);
    const lines = codeHits.map(i => lineAt(starts, i));
    if (hard) violations += codeHits.length;
    else if (codeHits.length) report.softNotes.push(name + ' 命中 ' + codeHits.length + ' 处（行 ' + lines.join(',') + '）：' + note);
    report.techPatterns.push({
      name, hard, note,
      rawHits: rawHits.length, rawLines: rawHits.map(i => lineAt(starts, i)),
      codeHits: codeHits.length, lines
    });
  }

  // ---- 结构检查 ----
  const scriptTags = Array.from(raw.matchAll(/<script\b[^>]*>/gi)).map(m => m[0]);
  const ids = scriptTags.map(t => {
    const m = t.match(/\bid\s*=\s*['"]([^'"]+)['"]/i);
    return m ? m[1] : null;
  });
  function structure(name, cond, detail) {
    if (!cond) violations++;
    report.structure.push({ name, ok: !!cond, detail: detail || '' });
  }
  structure('script 块恰好 7 个', scriptTags.length === 7, '实际=' + scriptTags.length);
  // core 块内若写字面 </script>，HTML 解析会提前截断，表现为结束标签多于开始标签
  const openTags = (raw.match(/<script\b/gi) || []).length;
  const closeTags = (raw.match(/<\/script\s*>/gi) || []).length;
  structure('script 开/闭标签数量一致（core 内无字面 </script> 截断）',
    openTags === closeTags, 'open=' + openTags + ' close=' + closeTags);
  structure('script id 集合符合 §3.5',
    JSON.stringify(ids.slice().sort()) === JSON.stringify(EXPECTED_IDS.slice().sort()),
    '实际=' + JSON.stringify(ids));
  structure('game-core 为首个 script 块', ids[0] === 'game-core', '首个=' + ids[0]);
  structure('game-boot 为末个 script 块', ids[ids.length - 1] === 'game-boot', '末个=' + ids[ids.length - 1]);
  structure('id="game-core" 恰好 1 个',
    (raw.match(/\bid\s*=\s*['"]game-core['"]/gi) || []).length === 1,
    '实际=' + (raw.match(/\bid\s*=\s*['"]game-core['"]/gi) || []).length);

  // game-core 块内容与位置
  const coreMatch = CORE_SCRIPT_RE.exec(raw);
  let coreCode = '';
  let coreOffset = 0;
  if (coreMatch) {
    coreCode = coreMatch[1];
    coreOffset = coreMatch.index + coreMatch[0].indexOf('>') + 1;
  }
  structure('可抽取 <script id="game-core"> 块', !!coreMatch, coreMatch ? '' : '未找到');

  if (coreMatch) {
    const coreClean = stripCodeComments(coreCode);
    // core 块内 </script> 字面量（须写为 '<\/script>' 转义）
    const closeLiteral = /<\/script/i.test(coreCode);
    structure('core 块内无 </script> 字面量', !closeLiteral,
      closeLiteral ? '命中行 ' + lineAt(starts, coreOffset + coreCode.search(/<\/script/i)) : '');
    // core 块内 Math.random
    const mr = regexHits(coreClean, /Math\.random/);
    structure('core 块内无 Math.random', mr.length === 0,
      mr.length ? '命中行 ' + mr.map(i => lineAt(starts, coreOffset + i)).join(',') : '');
    // core 块内 DOM / IO 全局（剥离注释后）
    const domRe = new RegExp('\\b(' + CORE_FORBIDDEN_GLOBALS.join('|') + ')\\b', 'g');
    const domHits = regexHits(coreClean, domRe);
    const domWords = domHits.map(i => {
      const m = new RegExp('\\b(' + CORE_FORBIDDEN_GLOBALS.join('|') + ')\\b').exec(coreClean.slice(i, i + 40));
      return m ? m[1] : '?';
    });
    structure('core 块内不访问 DOM/IO 全局（注释已剥离）', domHits.length === 0,
      domHits.length ? domWords.join(',') + ' @行 ' + domHits.map(i => lineAt(starts, coreOffset + i)).join(',') : '');
    // bigint 字面量带 n：疑似「>=16 位裸大整数且未带 n」→ 精度风险，硬违规
    const nakedBig = regexHits(coreClean, /\b\d{16,}\b(?!n)/);
    structure('core 块内无裸大整数(>=16位,未带n)', nakedBig.length === 0,
      nakedBig.length ? '命中行 ' + nakedBig.map(i => lineAt(starts, coreOffset + i)).join(',') : '');
    report.bigint = {
      nakedLargeIntegerHits: nakedBig.length,
      nakedLargeIntegerLines: nakedBig.map(i => lineAt(starts, coreOffset + i)),
      bigintLiteralCount: regexHits(coreClean, /\b\d+n\b/).length,
      note: '「所有 bigint 字面量带 n」按「无 >=16 位裸大整数字面量」口径静态判定；\\d+n 计数为信息项'
    };
    // 软：core 块内 Number( / parseInt( / parseFloat(（§12.2 禁止把 bigint 转 number）
    for (const [label, re] of [
      ['Number(', /\bNumber\s*\(/], ['parseInt(', /\bparseInt\s*\(/], ['parseFloat(', /\bparseFloat\s*\(/]
    ]) {
      const h = regexHits(coreClean, re);
      if (h.length) report.softNotes.push('core 块内 ' + label + ' 命中 ' + h.length + ' 处（行 ' +
        h.map(i => lineAt(starts, coreOffset + i)).join(',') + '）：需确认未用于 bigint→number 判定');
    }
  }

  // ---- U-9：game-core / game-session 块内禁止 ctx.*（按 script 块分段检索） ----
  // 只有 game-render 持有 Canvas 上下文；core 纯逻辑、session 只产出 Scene 数据。
  const blocks = scriptBlocks(raw);
  const ctxRe = /\bctx\s*\./;
  for (const targetId of ['game-core', 'game-session']) {
    const b = blocks.find(x => x.id === targetId);
    if (!b) {
      structure('[' + targetId + '] 块存在（ctx.* 检查前提）', false, '未找到该 script 块');
      report.scriptBlockCtx.push({ id: targetId, found: false, rawHits: 0, codeHits: 0, lines: [] });
      continue;
    }
    const cleaned = stripJsComments(b.content);
    const rawHits = regexHits(b.content, ctxRe);
    const codeHits = regexHits(cleaned, ctxRe);
    const lines = codeHits.map(i => lineAt(starts, b.offset + i));
    structure('[' + targetId + '] 块内无 ctx.*（运行时代码路径）', codeHits.length === 0,
      codeHits.length ? '命中 ' + codeHits.length + ' 处，行 ' + lines.join(',') : '');
    report.scriptBlockCtx.push({
      id: targetId, found: true,
      rawHits: rawHits.length, rawLines: rawHits.map(i => lineAt(starts, b.offset + i)),
      codeHits: codeHits.length, lines
    });
  }

  report.hardViolations = violations;
  report.result = violations === 0 ? 'PASS' : 'FAIL';
  return report;
}

// ---------------- 输出 ----------------
function printText(r) {
  console.log('========== static-audit.js 结果 ==========');
  console.log('文件: ' + r.file);
  console.log('总行数: ' + r.totalLines);
  console.log('');
  console.log('[产品禁用词]  raw=剥离注释前 / code=剥离注释后 / legit=合法否定语境 / violation=违规');
  for (const p of r.productWords) {
    if (p.rawHits === null) continue;
    console.log('  ' + p.word.padEnd(8, ' ') +
      ' raw=' + p.rawHits + ' code=' + p.codeHits +
      ' legit=' + p.legit + ' violation=' + p.violation +
      '  行号(raw)=' + (p.rawLines.join(',') || '-') +
      '  行号(violation)=' + (p.violationLines.join(',') || '-'));
  }
  console.log('');
  console.log('[技术禁用模式]  hard=硬违规');
  for (const t of r.techPatterns) {
    if (t.rawHits === null) { console.log('  ' + t.name.padEnd(30, ' ') + ' → 见结构检查'); continue; }
    console.log('  ' + t.name.padEnd(30, ' ') +
      ' hard=' + (t.hard ? 'Y' : 'N') +
      ' raw=' + t.rawHits + ' code=' + t.codeHits +
      '  行号(code)=' + (t.lines.join(',') || '-'));
  }
  console.log('');
  console.log('[结构检查]');
  for (const s of r.structure) {
    console.log('  ' + (s.ok ? '✓' : '✗') + ' ' + s.name + (s.detail ? ' | ' + s.detail : ''));
  }
  console.log('');
  console.log('[script 块 ctx.* 分段检索（U-9，仅 game-render 可持有 Canvas 上下文）]');
  for (const b of r.scriptBlockCtx) {
    console.log('  ' + String(b.id).padEnd(14, ' ') +
      ' found=' + (b.found ? 'Y' : 'N') +
      ' raw=' + b.rawHits + ' code=' + b.codeHits +
      '  行号(code)=' + (b.lines.join(',') || '-'));
  }
  console.log('');
  console.log('[bigint 字面量]');
  console.log('  裸大整数(>=16位,未带n)命中: ' + r.bigint.nakedLargeIntegerHits +
    '  \\d+n 计数: ' + r.bigint.bigintLiteralCount);
  if (r.softNotes.length) {
    console.log('');
    console.log('[软提示] ' + r.softNotes.length + ' 条（如实报告，不计入失败）');
    for (const n of r.softNotes) console.log('  - ' + n);
  }
  console.log('');
  console.log('硬违规总数: ' + r.hardViolations);
  console.log('判定: ' + r.result);
  console.log('=========================================');
}

function runCli() {
  try {
    const r = audit();
    if (asJson) console.log(JSON.stringify(r, null, 2));
    else printText(r);
    process.exit(r.result === 'PASS' ? 0 : 1);
  } catch (e) {
    if (asJson) console.log(JSON.stringify({ result: 'ERROR', error: String(e && e.stack ? e.stack : e) }, null, 2));
    else console.error('[static-audit.js] 失败: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  }
}

if (require.main === module) runCli();

module.exports = {
  audit, printText, stripHtmlComments, stripJsComments, stripCodeComments,
  scriptBlocks, classifyProduct, PRODUCT_WORDS, TECH_PATTERNS
};
