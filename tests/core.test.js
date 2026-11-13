'use strict';
/**
 * tests/core.test.js —— GameCore Node 纯函数批量断言
 *
 * 运行：node tests/core.test.js
 * 输出：通过 / 失败计数 + 失败明细；退出码 0 表示全过。
 *
 * 覆盖：
 *  - API 契约（§3.2 的 26 项定死签名 + 冻结常量）；A-10/A-11 增补的 2 项做柔性检查
 *  - PRNG 确定性、门运算四则、applyGatePath / bestPath 一致性、数值格式化
 *  - generateLevel 确定性与闭式公式、1–1000 关批量可解性 / 不变量 / 张力（RENDERING §7.3）
 *  - resolveBattle 确定性、interpolate
 *  - buildAssetPlan / resolveAssetSource / createHealthSnapshot 资源三级回退（A-11）
 *  - §3.4.4 双向验证（CJS / 浏览器分支）与 DOM 守卫
 */
const assert = require('assert');
const { extractCore, extractCoreVerbose, DEFAULT_HTML_PATH } = require('./extract-core');

// ---------------- 轻量断言框架 ----------------
let PASS = 0;
let FAIL = 0;
let GROUP = '';
const FAILURES = [];
const SOFT_WARN = [];

function group(g) { GROUP = g; }

function fmt(v) {
  if (typeof v === 'bigint') return v.toString() + 'n';
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function ok(name, cond, detail) {
  if (cond) {
    PASS++;
  } else {
    FAIL++;
    FAILURES.push({ group: GROUP, name, detail: detail === undefined ? '' : String(detail) });
  }
  return !!cond;
}

function eq(name, actual, expected, detail) {
  return ok(name, Object.is(actual, expected),
    '期望 ' + fmt(expected) + '，实际 ' + fmt(actual) + (detail ? ' | ' + detail : ''));
}

function deep(name, actual, expected) {
  let pass = true;
  let msg = '';
  try { assert.deepStrictEqual(actual, expected); } catch (e) { pass = false; msg = e.message; }
  return ok(name, pass, msg);
}

/** 增强检查：不计入 PASS/FAIL，失败仅记录软警告（避免阶段 B 因实现细节差异误判）。 */
function soft(name, cond, detail) {
  if (!cond) SOFT_WARN.push({ name, detail: detail === undefined ? '' : String(detail) });
}

/** 每段独立 try/catch：某段 API 缺失或抛错不影响后续段，全部如实记录。 */
function run(name, fn) {
  try { fn(); } catch (e) {
    FAIL++;
    FAILURES.push({ group: GROUP, name: name, detail: '段异常: ' + (e && e.stack ? e.stack : e) });
  }
}
async function runAsync(name, fn) {
  try { await fn(); } catch (e) {
    FAIL++;
    FAILURES.push({ group: GROUP, name: name, detail: '段异常: ' + (e && e.stack ? e.stack : e) });
  }
}

// ---------------- 辅助：门路径 / 张力 ----------------
let Core; // main 内赋值

function manualWorstPower(L) {
  let cur = L.entryPower;
  for (const grp of L.groups) {
    let min = null;
    for (let d = 0; d < grp.gates.length; d++) {
      const g = grp.gates[d];
      let p = Core.applyGate(cur, g).power;
      if (grp.traps && grp.traps[d]) {
        const loss = (p * Core.CONSTANTS.TRAP_NUM) / Core.CONSTANTS.TRAP_DEN;
        p = p - loss;
      }
      if (min === null || p < min) min = p;
    }
    cur = min;
  }
  return cur;
}

/** 每组选局部最小结果的门，构造 applyGatePath 需要的 {group,door}[]。 */
function worstPath(L, mode) {
  let cur = L.entryPower;
  const out = [];
  for (const grp of L.groups) {
    let chosen = 0;
    let chosenPower = null;
    for (let d = 0; d < grp.gates.length; d++) {
      const r = Core.applyGate(cur, grp.gates[d]);
      let p = r.power;
      if (grp.traps && grp.traps[d]) {
        const loss = (p * Core.CONSTANTS.TRAP_NUM) / Core.CONSTANTS.TRAP_DEN;
        p = p - loss;
      }
      if (chosenPower === null || p < chosenPower) { chosenPower = p; chosen = d; }
    }
    cur = chosenPower;
    // door 语义可能是 gate.lane 或 gates 数组下标；两种都构造，由 computeWorst 探测
    const door = mode === 'lane'
      ? (grp.gates[chosen].lane !== undefined ? grp.gates[chosen].lane : chosen)
      : chosen;
    out.push({ group: out.length, door });
  }
  return out;
}

/**
 * 用 applyGatePath 计算 worstPower（RENDERING §7.3 要求），并自动探测 door 语义：
 * 取「逐组手动贪心」的结果与 applyGatePath 结果一致的那一种约定。
 * consistent=false 表示 bestPath/applyGatePath 约定不自洽，是需上报的接口问题。
 */
function computeWorst(L) {
  const manual = manualWorstPower(L);
  // 裁决：applyGatePath 的 door 统一为 gates 数组下标（bestPath 亦 push 下标），
  // 故优先按 index 构造 worstPath；lane 作为回退保留自动探测 + 自洽守卫，防语义回归。
  for (const mode of ['index', 'lane']) {
    try {
      const r = Core.applyGatePath(L.entryPower, worstPath(L, mode), L);
      if (r.power === manual) return { power: r.power, consistent: true, mode };
    } catch (e) { /* 换下一种约定 */ }
  }
  return { power: manual, consistent: false, mode: 'manual' };
}

function mkGate(op, value) {
  return { id: 'g0d0', op, value, label: '', positive: op === 'add' || op === 'mul', lane: 0 };
}

// ---------------- 主流程 ----------------
async function main() {
  Core = extractCore(DEFAULT_HTML_PATH);

  // ===== 1. API 契约与冻结 =====
  group('API 契约与冻结');
  run('API 存在性', () => {
    const funcs = [
      'makeRng', 'seedFor', 'powInt', 'maxBig', 'formatNumber', 'formatCompact',
      'bigintToDecimal', 'applyGate', 'applyGatePath', 'bestPath', 'gateCountFor',
      'isBossLevel', 'entryPowerFor', 'enemyPowerFor', 'milestoneFor', 'generateLevel',
      'verifySolvable', 'tuneLevel', 'resolveBattle', 'interpolate', 'buildAssetPlan',
      'resolveAssetSource', 'createHealthSnapshot'
    ];
    const consts = ['CONSTANTS', 'PHASES', 'BUILTIN_MANIFEST'];
    for (const f of funcs) eq('API ' + f + ' 为 function', typeof Core[f], 'function');
    for (const c of consts) ok('API ' + c + ' 存在', Core[c] !== undefined && Core[c] !== null, '实际=' + fmt(Core[c]));
    // 裁决（team-lead 第 2 条）：26 项硬性 + 27/28 额外项柔性记录，保持。
    // 柔性记录只打印信息，不计入 PASS/FAIL，也不把它们当作 Core 26 项 API 断言（U-1/U-2）。
    for (const opt of ['projectToScreen', 'buildScene']) {
      console.log('  [info] 额外项 ' + opt + ': ' +
        (typeof Core[opt] === 'function'
          ? '存在（渲染层增补，非 Core 26 项，不参与断言）'
          : '不存在（符合 U-2：属 game-render IIFE 局部）'));
    }
  });
  eq('Core 已 Object.freeze', Object.isFrozen(Core), true);
  eq('Core 导出键数 === 26（裁决 U-1 严格 §3.2 原表）', Object.keys(Core).length, 26,
    '实际键=' + Object.keys(Core).sort().join(','));

  run('常量冻结与取值', () => {
    const C = Core.CONSTANTS, P = Core.PHASES, M = Core.BUILTIN_MANIFEST;
    eq('CONSTANTS 已冻结', Object.isFrozen(C), true);
    eq('PHASES 已冻结', Object.isFrozen(P), true);
    eq('BUILTIN_MANIFEST 已冻结', Object.isFrozen(M), true);
    eq('BUILTIN_MANIFEST.entries 已冻结', Object.isFrozen(M.entries), true);
    eq('BUILTIN_MANIFEST.entries.length === 12', M.entries.length, 12);
    deep('PHASES === [S1,S2,S3,S4]', Array.from(P), ['S1', 'S2', 'S3', 'S4']);
    for (let i = 0; i < M.entries.length; i++) {
      const e = M.entries[i];
      ok('entry[' + i + '] 字段齐全',
        e && typeof e.id === 'string' && typeof e.type === 'string' &&
        Array.isArray(e.fallbacks) && typeof e.generator === 'string' && e.generator.length > 0,
        '实际=' + fmt(e));
      eq('entry[' + i + '].primary 为空(零请求)', e.primary, '');
      eq('entry[' + i + '].required 恒 false', e.required, false);
      ok('entry[' + i + '].timeoutMs > 0', typeof e.timeoutMs === 'number' && e.timeoutMs > 0, '实际=' + fmt(e.timeoutMs));
    }
    eq('CONSTANTS.P0_BASE', C.P0_BASE, 10n);
    eq('CONSTANTS.GROW_NUM', C.GROW_NUM, 7n);
    eq('CONSTANTS.GROW_DEN', C.GROW_DEN, 6n);
    eq('CONSTANTS.Z_MULT', C.Z_MULT, 3n);
    eq('CONSTANTS.BOSS_NUM', C.BOSS_NUM, 3n);
    eq('CONSTANTS.BOSS_DEN', C.BOSS_DEN, 2n);
    eq('CONSTANTS.SOLVE_NUM', C.SOLVE_NUM, 11n);
    eq('CONSTANTS.SOLVE_DEN', C.SOLVE_DEN, 10n);
    eq('CONSTANTS.LOSS_NUM', C.LOSS_NUM, 1n);
    eq('CONSTANTS.LOSS_DEN', C.LOSS_DEN, 10n);
    eq('CONSTANTS.MAX_TUNE', C.MAX_TUNE, 8);
    eq('CONSTANTS.MAX_GATE_GROUPS', C.MAX_GATE_GROUPS, 30);
    eq('CONSTANTS.MAX_DRAW_UNITS', C.MAX_DRAW_UNITS, 120);
    eq('CONSTANTS.SEED_MIX', C.SEED_MIX, 0x9E3779B1);
    eq('CONSTANTS.LOGICAL_W', C.LOGICAL_W, 480);
    eq('CONSTANTS.LOGICAL_H', C.LOGICAL_H, 854);
  });

  // ===== 2. PRNG 确定性 =====
  group('PRNG 确定性');
  run('makeRng / seedFor', () => {
    const a = Core.makeRng(1), b = Core.makeRng(1);
    let same = true, inRange = true;
    for (let i = 0; i < 100; i++) {
      const x = a(), y = b();
      if (x !== y) same = false;
      if (typeof x !== 'number' || !(x >= 0 && x < 1)) inRange = false;
    }
    ok('makeRng(1) 两次前 100 输出一致', same);
    ok('makeRng(1) 输出恒在 [0,1)', inRange);
    // seedFor 以 n 为种子：闭式公式 ((level * 0x9E3779B1) >>> 0) || 1
    for (const n of [0, 1, 2, 3, 5, 10, 50, 200, 1000]) {
      eq('seedFor(' + n + ') 公式', Core.seedFor(n), ((Math.imul(n, 0x9E3779B1) >>> 0) || 1));
    }
    const s5 = Core.seedFor(5);
    const r1 = Core.makeRng(s5), r2 = Core.makeRng(s5);
    let seq = true;
    for (let i = 0; i < 50; i++) if (r1() !== r2()) seq = false;
    ok('makeRng(seedFor(5)) 两次序列一致（以 n 为种子）', seq);
    eq('powInt(2n,10)', Core.powInt(2n, 10), 1024n);
    eq('maxBig(3n,9n)', Core.maxBig(3n, 9n), 9n);
    eq('maxBig(9n,3n)', Core.maxBig(9n, 3n), 9n);
  });

  // ===== 3. 门运算四则 =====
  group('applyGate 四则语义');
  run('四则 / 向下取整 / 下限 0 / 恒 bigint', () => {
    const cases = [
      ['add', 10n, 5n, 15n],
      ['mul', 10n, 3n, 30n],
      ['sub', 10n, 4n, 6n],
      ['sub', 3n, 10n, 0n],      // 下限 0
      ['div', 7n, 2n, 3n],      // 奇数向下取整
      ['div', 8n, 2n, 4n],
      ['add', 0n, 9n, 9n],
      ['mul', 100000000000000000000n, 3n, 300000000000000000000n] // 大数精确
    ];
    for (const [op, p, v, exp] of cases) {
      const r = Core.applyGate(p, mkGate(op, v));
      eq('applyGate ' + op + '(' + p + ',' + v + ').power', r.power, exp);
      eq('  ... 结果恒 bigint', typeof r.power, 'bigint');
      eq('  ... before', r.before, p);
      eq('  ... delta = power-before', r.delta, exp - p);
      ok('  ... GateResult 字段齐全', r && 'op' in r && 'value' in r && 'label' in r, '实际=' + fmt(r));
    }
    eq('减门下限 0', Core.applyGate(3n, mkGate('sub', 10n)).power, 0n);
    eq('7n ÷ 2n === 3n', Core.applyGate(7n, mkGate('div', 2n)).power, 3n);
  });

  // ===== 4. applyGatePath / bestPath 一致性 =====
  group('applyGatePath / bestPath 一致性');
  run('bestPath 与 applyGatePath 自洽（含独立贪心复算）', () => {
    for (const n of [1, 2, 3, 5, 10, 50, 200, 1000]) {
      const L = Core.generateLevel(n);
      const bp = Core.bestPath(L);
      ok('bestPath(' + n + ') 返回 path/power', Array.isArray(bp.path) && typeof bp.power === 'bigint', '实际=' + fmt(bp));
      eq('bestPath(' + n + ').path.length === groupCount', bp.path.length, L.groupCount);
      const arr = bp.path.map((door, i) => ({ group: i, door }));
      const r = Core.applyGatePath(L.entryPower, arr, L);
      eq('applyGatePath(bestPath(' + n + ')) === bestPath.power', r.power, bp.power);
      eq('applyGatePath(' + n + ') results 链长度', r.results.length, L.groupCount);
      // 独立复算：每组选使 P 最大的门，终值应等于 bestPath.power
      let cur = L.entryPower;
      for (const grp of L.groups) {
        let max = null;
        for (let j = 0; j < grp.gates.length; j++) {
          const rr = Core.applyGate(cur, grp.gates[j]);
          /* V3：陷阱门会扣 25%，独立复算必须同口径，否则会与 bestPath 不一致 */
          let val = rr.power;
          if (grp.traps && grp.traps[j]) {
            let loss = (val * Core.CONSTANTS.TRAP_NUM) / Core.CONSTANTS.TRAP_DEN;
            if (loss < 1n) loss = 1n;
            val = val > 0n ? val - loss : 0n;
          }
          if (max === null || val > max) max = val;
        }
        cur = max;
      }
      eq('独立贪心最大终值 === bestPath.power (n=' + n + ')', cur, bp.power);
    }
  });

  // ===== 4b. 陷阱与难度不变量（V3 二次分析后的新口径） =====
  group('陷阱与难度不变量（L1–L200）');
  run('每组必有「正门且无陷阱」；最优路径恒有 1.1 倍余量', () => {
    let risky = 0;
    for (let n = 1; n <= 200; n++) {
      const L = Core.generateLevel(n);
      const bp = Core.bestPath(L);
      for (let i = 0; i < L.groups.length; i++) {
        const grp = L.groups[i];
        let safe = -1;
        for (let j = 0; j < grp.gates.length; j++) {
          if (grp.gates[j].positive && !(grp.traps && grp.traps[j])) { safe = j; break; }
        }
        ok('L' + n + ' g' + i + ' 存在安全正门（无陷阱）', safe >= 0);
        if (grp.traps && grp.traps.some(Boolean) &&
            grp.gates.some((g, j) => g.positive && grp.traps[j])) risky++;
      }
      ok('L' + n + ' bestPath 长度 === groupCount', bp.path.length, L.groupCount);
      ok('L' + n + ' 最优路径 >= 敌方兵力 × 1.1（100% 可胜）',
         bp.power * 10n >= L.enemyPower * 11n,
         'best=' + fmt(bp.power) + ' Z=' + fmt(L.enemyPower));
    }
    /* V3 设计目标：陷阱会挂在正门上（高倍率 + 危险），这样「看到蓝门就冲」不再是正解。
       旧不变量「陷阱只落非正门 lane」已被有意替换 —— 它把风险收益取舍彻底抹平了。 */
    ok('陷阱确实会挂在正门上（存在真实风险收益取舍）', risky > 0, 'riskyGroups=' + risky);
  });
  run('稳妥路径（只走无陷阱正门）必可过关；冒险上限更高', () => {
    let adventureHigher = 0;
    for (let n = 1; n <= 200; n++) {
      const L = Core.generateLevel(n);
      let p = L.entryPower;
      for (let i = 0; i < L.groups.length; i++) {
        const grp = L.groups[i];
        let best = null;
        for (let j = 0; j < grp.gates.length; j++) {
          const g = grp.gates[j];
          if (!g.positive) continue;
          if (grp.traps && grp.traps[j]) continue;
          const r = Core.applyGate(p, g);
          if (best === null || r.power > best) best = r.power;
        }
        if (best !== null) p = best;
      }
      ok('L' + n + ' 稳妥路径 >= 敌方兵力（不冒险也能过关）', p >= L.enemyPower,
         'safe=' + fmt(p) + ' Z=' + fmt(L.enemyPower));
      if (Core.bestPath(L).power > p) adventureHigher++;
    }
    ok('多数关卡「敢吃陷阱」能拿到更高终值（冒险有回报）',
       adventureHigher >= 100, 'adventureHigher=' + adventureHigher + '/200');
  });
  run('同组走陷阱门不会优于该组最优（陷阱要么是代价、要么是已计入的赌注）', () => {
    let found = -1, tIdx = -1, L = null;
    for (let n = 1; n <= 50 && found < 0; n++) {
      L = Core.generateLevel(n);
      for (let i = 0; i < L.groups.length; i++) {
        if (L.groups[i].traps && L.groups[i].traps.some(Boolean)) {
          found = i;
          tIdx = L.groups[i].traps.findIndex(Boolean);
          break;
        }
      }
    }
    ok('存在带陷阱的关卡样本', found >= 0);
    if (found >= 0) {
      const bp = Core.bestPath(L);
      const path = bp.path.map((door, i) => ({group:i, door}));
      path[found] = {group:found, door:tIdx};
      const rBad = Core.applyGatePath(L.entryPower, path, L);
      /* 用 <= 而非 <：风险组里「陷阱门本身就是最优选择」是允许的
         （高倍率扣 25% 后仍高于安全门），此时相等即正确语义。 */
      ok('故意走陷阱 lane 的终值 <= 最优路径终值', rBad.power <= bp.power,
         'bad=' + rBad.power + ' best=' + bp.power);
    }
  });

  // ===== 5. 数值格式化 =====
  group('数值格式化（§5.7 口径）');
  run('formatNumber / formatCompact / bigintToDecimal', () => {
    eq('formatNumber(0n)', Core.formatNumber(0n), '0');
    eq('formatNumber(999n)', Core.formatNumber(999n), '999');
    eq('formatNumber(-42n)', Core.formatNumber(-42n), '-42');
    eq('formatNumber(1234n)', Core.formatNumber(1234n), '1.23K');
    eq('formatNumber(4560000n)', Core.formatNumber(4560000n), '4.56M');
    eq('formatNumber(7890000000n)', Core.formatNumber(7890000000n), '7.89B');
    eq('formatNumber(10n**18n) 科学计数', Core.formatNumber(10n ** 18n), '1.00e18');
    const huge = 3n * 10n ** 67n;
    const hs = Core.formatNumber(huge);
    ok('超大数全程字符串操作：无 Infinity/NaN', typeof hs === 'string' && !/Infinity|NaN/.test(hs), '实际=' + hs);
    ok('超大数为科学计数字符串', /e\d+$/.test(hs), '实际=' + hs);
    eq('formatCompact(1234n)', Core.formatCompact(1234n), '1.23K');
    eq('formatCompact(4560000n)', Core.formatCompact(4560000n), '4.56M');
    eq('formatCompact === formatNumber(sig:3,sciFrom:18)',
      Core.formatCompact(10n ** 18n), Core.formatNumber(10n ** 18n, { sig: 3, sciFrom: 18 }));
    const b = 123456789012345678901234567890n;
    eq('bigintToDecimal 精确十进制', Core.bigintToDecimal(b), b.toString());
    eq('bigintToDecimal(0n)', Core.bigintToDecimal(0n), '0');
    eq('bigintToDecimal 返回 string', typeof Core.bigintToDecimal(b), 'string');
    ok('bigintToDecimal 无 Infinity/NaN', !/Infinity|NaN/.test(Core.bigintToDecimal(b)));
  });

  // ===== 6. generateLevel 确定性与闭式公式 =====
  group('generateLevel 确定性与公式');
  run('确定性 / gateCountFor / entryPowerFor / enemyPowerFor / isBossLevel', () => {
    for (const n of [1, 5, 50, 200, 1000]) {
      deep('generateLevel(' + n + ') 两次 deepEqual', Core.generateLevel(n), Core.generateLevel(n));
    }
    eq('gateCountFor(1)', Core.gateCountFor(1), 20);
    eq('gateCountFor(5)', Core.gateCountFor(5), 25);
    eq('gateCountFor(12)', Core.gateCountFor(12), 26);
    eq('entryPowerFor(1) === 10n', Core.entryPowerFor(1), 10n);
    eq('entryPowerFor(5) === 18n', Core.entryPowerFor(5), 18n);
    eq('enemyPowerFor(5) === 81n', Core.enemyPowerFor(5), 81n);
    eq('isBossLevel(5) === true', Core.isBossLevel(5), true);
    eq('isBossLevel(10) === true', Core.isBossLevel(10), true);
    eq('isBossLevel(7) === false', Core.isBossLevel(7), false);
    const L = Core.generateLevel(5);
    for (const f of ['level', 'seed', 'isBoss', 'groupCount', 'entryPower', 'enemyPower',
      'bossHp', 'groups', 'theme', 'milestone', 'tunedRounds']) {
      ok('Level(5) 字段 ' + f + ' 存在', f in L, '缺字段 ' + f);
    }
    eq('Level(5).level', L.level, 5);
    eq('Level(5).groupCount === groups.length', L.groupCount, L.groups.length);
    eq('Level(5).isBoss', L.isBoss, true);
    eq('Level(5).bossHp === enemyPower', L.bossHp, L.enemyPower);
    eq('Level(5).seed === seedFor(5)', L.seed, Core.seedFor(5));
    eq('Level(5).entryPower === entryPowerFor(5)', L.entryPower, Core.entryPowerFor(5));
  });

  // ===== 7. 1–1000 关批量 + 张力（RENDERING §7.3） =====
  group('1–1000 关批量 / 张力断言');
  run('批量可解性 / 不变量 / 决策张力', () => {
    for (let n = 1; n <= 1000; n++) {
      const L = Core.generateLevel(n);
      const sv = Core.verifySolvable(L);
      const tag = 'L' + n + ' ';

      ok(tag + 'verifySolvable.solvable === true', sv.solvable === true,
        'solvable=' + fmt(sv.solvable) + ' bestPower=' + fmt(sv.bestPower) + ' enemy=' + fmt(L.enemyPower) + ' reason=' + fmt(sv.reason));
      ok(tag + 'tunedRounds === 0', L.tunedRounds === 0, '实际=' + fmt(L.tunedRounds));

      // 每组至少一道正门（I-2 / R-13）
      let posOk = true;
      for (const grp of L.groups) {
        if (!grp.gates.some(g => g.positive === true || g.op === 'add' || g.op === 'mul')) posOk = false;
      }
      ok(tag + '每组至少一道正门', posOk && sv.everyGroupHasPositive !== false,
        'posOk=' + posOk + ' everyGroupHasPositive=' + fmt(sv.everyGroupHasPositive));

      // 每组至少一道负门（RENDERING I-4）
      let negOk = true;
      for (const grp of L.groups) {
        if (!grp.gates.some(g => g.positive === false || g.op === 'sub' || g.op === 'div')) negOk = false;
      }
      ok(tag + '每组至少一道负门(I-4)', negOk);

      // 门值全 bigint、无 Infinity/NaN
      let bigOk = true;
      for (const grp of L.groups) for (const g of grp.gates) {
        if (typeof g.value !== 'bigint') bigOk = false;
        if (/Infinity|NaN/.test(String(g.value))) bigOk = false;
      }
      ok(tag + '门值全 bigint / 无 Infinity/NaN', bigOk);

      // 结构完整
      ok(tag + '结构完整(gateCount/isBoss/bigint)',
        L.groupCount === Core.gateCountFor(n) && L.groups.length === L.groupCount &&
        L.isBoss === (n % 5 === 0) && typeof L.entryPower === 'bigint' && typeof L.enemyPower === 'bigint');

      // 张力：存在必胜路径
      const best = Core.bestPath(L).power;
      ok(tag + 'bestPower*10n >= enemyPower*11n（选对能赢）', best * 10n >= L.enemyPower * 11n,
        'best=' + fmt(best) + ' enemy=' + fmt(L.enemyPower));

      // 张力：存在必败路径（选错会输）
      const w = computeWorst(L);
      ok(tag + 'worstPower < enemyPower（选错会输）', w.power < L.enemyPower,
        'worst=' + fmt(w.power) + ' enemy=' + fmt(L.enemyPower) + ' mode=' + w.mode);
      ok(tag + 'worstPath 与 applyGatePath 约定自洽', w.consistent, 'mode=' + w.mode);
    }
  });

  // ===== 8. resolveBattle 确定性 =====
  group('resolveBattle 确定性');
  run('胜负 / loss / powerAfter / rollback / 100 次一致', () => {
    const base = { level: 1, entryPower: 10n, isBoss: false };
    const win = Core.resolveBattle({ power: 40n, enemyPower: 30n, ...base });
    eq('win.win', win.win, true);
    eq('win.loss = floor(30/10)', win.loss, 3n);
    eq('win.powerAfter = max(1,40-3)', win.powerAfter, 37n);
    eq('win.powerBefore', win.powerBefore, 40n);
    eq('win.enemyPower', win.enemyPower, 30n);
    eq('win.rollbackPower', win.rollbackPower, 10n);
    eq('win.durationMs(普通=9500)', win.durationMs, 9500);
    eq('win.reason', win.reason, 'power>=enemy');
    const lose = Core.resolveBattle({ power: 20n, enemyPower: 30n, ...base });
    eq('lose.win', lose.win, false);
    eq('lose.powerAfter', lose.powerAfter, 0n);
    eq('lose.rollbackPower', lose.rollbackPower, 10n);
    eq('lose.reason', lose.reason, 'power<enemy');
    const boss = Core.resolveBattle({ power: 100n, enemyPower: 50n, level: 5, entryPower: 18n, isBoss: true });
    eq('boss.durationMs(13000)', boss.durationMs, 13000);
    // 相同输入重复 100 次结果完全一致
    const input = { power: 40n, enemyPower: 30n, ...base };
    const first = Core.resolveBattle(input);
    let same = true;
    for (let i = 0; i < 100; i++) {
      try { assert.deepStrictEqual(Core.resolveBattle(input), first); } catch (e) { same = false; }
    }
    ok('resolveBattle 重复 100 次结果一致', same);
  });

  // ===== 9. interpolate =====
  group('interpolate');
  run('BigInt 线性插值', () => {
    eq('interpolate(0n,100n,500) === 50n', Core.interpolate(0n, 100n, 500), 50n);
    eq('interpolate(t=0) === from', Core.interpolate(0n, 100n, 0), 0n);
    eq('interpolate(t=1000) === to', Core.interpolate(0n, 100n, 1000), 100n);
    eq('interpolate 返回 bigint', typeof Core.interpolate(0n, 100n, 500), 'bigint');
    eq('interpolate 递减(100→0, t=250) === 75n', Core.interpolate(100n, 0n, 250), 75n);
  });

  // ===== 10. buildAssetPlan =====
  group('buildAssetPlan');
  run('off 零请求 / file: 短路 / 12 条全 generator', () => {
    const M = Core.BUILTIN_MANIFEST;
    const p1 = Core.buildAssetPlan(M, { mode: 'off', protocol: 'file:', now: 0 });
    eq('off+file plannedRequestCount === 0', p1.plannedRequestCount, 0);
    eq('off+file items.length === 12', p1.items.length, 12);
    ok('off+file 12 条全 willRequest=false（走 generator）', p1.items.every(it => it.willRequest === false));
    ok('off+file 12 条 sourceOrder 为空', p1.items.every(it => Array.isArray(it.sourceOrder) && it.sourceOrder.length === 0));
    eq('off+file mode', p1.mode, 'off');

    const p2 = Core.buildAssetPlan(M, { mode: 'remote', protocol: 'file:', now: 0 });
    eq('remote+file 仍零请求（file 短路）', p2.plannedRequestCount, 0);
    ok('remote+file 全 willRequest=false', p2.items.every(it => it.willRequest === false));

    const p3 = Core.buildAssetPlan(M, { mode: 'off', protocol: 'https:', now: 0 });
    eq('off+https 仍零请求', p3.plannedRequestCount, 0);
  });

  // ===== 11. createHealthSnapshot =====
  group('createHealthSnapshot');
  run('字段齐全 / Object.freeze / gameplayBlocked / summary', () => {
    const M = Core.BUILTIN_MANIFEST;
    const plan = Core.buildAssetPlan(M, { mode: 'off', protocol: 'file:', now: 0 });
    const states = {};
    let ts = 0;
    for (const it of plan.items) {
      states[it.entry.id] = {
        id: it.entry.id, status: 'generated', source: 'generator:' + it.entry.id,
        reason: '', elapsedMs: 0, attempts: 0, downgradeCount: 0, lastUpdated: ts++
      };
    }
    const snap = Core.createHealthSnapshot(plan, states,
      { externalRequestCount: 0, remoteEnabled: false, now: 0 });
    for (const f of ['manifestVersion', 'lastUpdated', 'externalRequestCount',
      'gameplayBlocked', 'remoteEnabled', 'mode', 'assets', 'summary']) {
      ok('snapshot 字段 ' + f + ' 存在', f in snap, '缺字段 ' + f);
    }
    for (const f of ['generated', 'ok', 'fallback', 'degraded', 'skipped']) {
      ok('snapshot.summary.' + f + ' 为 number', typeof snap.summary[f] === 'number', '实际=' + fmt(snap.summary[f]));
    }
    eq('snapshot 已 Object.freeze', Object.isFrozen(snap), true);
    eq('snapshot.gameplayBlocked === false', snap.gameplayBlocked, false);
    eq('snapshot.summary.generated === 12', snap.summary.generated, 12);
    eq('snapshot.externalRequestCount === 0', snap.externalRequestCount, 0);
    eq('snapshot.mode', snap.mode, 'off');
  });

  // ===== 12. resolveAssetSource（异步，MockAssetLoader 注入） =====
  group('资源三级回退（MockAssetLoader 注入）');
  await runAsync('主源 404 + 备用源超时 → degraded 且 gameplayBlocked=false', async () => {
    const entry = {
      id: 'test.asset', type: 'visual', version: '1.0.0',
      primary: 'https://primary.invalid/a.png',
      fallbacks: ['https://fallback.invalid/b.png'],
      timeoutMs: 50, generator: 'canvas.fallback', required: false
    };
    const calls = [];
    const loader = {
      load(url, timeoutMs) {
        calls.push(url);
        if (url === entry.primary) return Promise.resolve({ ok: false, reason: 'primary-404', elapsedMs: 1 });
        return Promise.resolve({ ok: false, reason: 'fallback-timeout', elapsedMs: timeoutMs });
      }
    };
    const res = await Core.resolveAssetSource(entry, {
      mode: 'remote', protocol: 'https:', loader, maxRetries: 2, now: 0
    });
    eq('resolution.status === degraded', res.status, 'degraded');
    soft('resolution 主源/备用源均被调用', calls.some(u => u === entry.primary) && calls.some(u => u === entry.fallbacks[0]),
      '调用序列=' + JSON.stringify(calls));
    soft('resolution.attempts >= 2', typeof res.attempts === 'number' && res.attempts >= 2, '实际=' + fmt(res.attempts));
    soft('resolution.downgradeCount >= 1', typeof res.downgradeCount === 'number' && res.downgradeCount >= 1, '实际=' + fmt(res.downgradeCount));
    soft('resolution.source 指向 generator', /generator/.test(String(res.source)), '实际=' + fmt(res.source));
    soft('resolution.reason 含 404/timeout', /404|timeout/i.test(String(res.reason)), '实际=' + fmt(res.reason));

    // 组合 createHealthSnapshot（A-11：任何降级都不得阻断游玩）
    // 注意：plan 的 manifest 必须包含被注入的 test.asset，否则 createHealthSnapshot
    // 生成的 assets 里没有该 id，snap.assets[entry.id] 会是 undefined（测试脚本自身 bug）。
    const testManifest = Object.assign({}, Core.BUILTIN_MANIFEST, { entries: [entry] });
    const plan = Core.buildAssetPlan(testManifest,
      { mode: 'remote', protocol: 'https:', now: 0 });
    const states = {};
    states[entry.id] = Object.assign({}, res, { lastUpdated: 0 });
    const snap = Core.createHealthSnapshot(plan, states,
      { externalRequestCount: calls.length, remoteEnabled: true, now: 0 });
    eq('createHealthSnapshot.gameplayBlocked === false', snap.gameplayBlocked, false);
    eq('snapshot 中该资源 status === degraded', snap.assets[entry.id].status, 'degraded');
  });

  // ===== 13. §3.4.4 双向验证与 DOM 守卫 =====
  group('双向验证与 DOM 守卫（§3.4.4）');
  run('CJS / 浏览器分支 API 键集合一致', () => {
    const a = extractCoreVerbose(DEFAULT_HTML_PATH, { browserBranch: false });
    const b = extractCoreVerbose(DEFAULT_HTML_PATH, { browserBranch: true });
    const ka = Object.keys(a.core).sort(), kb = Object.keys(b.core).sort();
    eq('两分支 API 数量一致', ka.length, kb.length);
    eq('两分支 API 键集合一致', JSON.stringify(ka), JSON.stringify(kb));
    eq('浏览器分支 generateLevel 可用', typeof b.core.generateLevel, 'function');
  });
  run('DOM 守卫：core 加载与调用不触碰被禁全局', () => {
    const v = extractCoreVerbose(DEFAULT_HTML_PATH, { browserBranch: false, guardDom: true });
    ok('guardDom 下 Core 可用', v.core && typeof v.core.generateLevel === 'function');
    const L = v.core.generateLevel(10);
    ok('guardDom generateLevel 未触碰 DOM', L && typeof L.entryPower === 'bigint');
    ok('guardDom formatNumber 未触碰 DOM', v.core.formatNumber(1234n) === '1.23K');
  });

  // ===== 汇总 =====
  console.log('');
  console.log('========== core.test.js 结果 ==========');
  console.log('通过: ' + PASS + '  失败: ' + FAIL + '  合计: ' + (PASS + FAIL));
  if (SOFT_WARN.length) {
    console.log('软警告(增强检查，不计入失败): ' + SOFT_WARN.length);
    for (const w of SOFT_WARN) console.log('  [soft] ' + w.name + ' | ' + w.detail);
  }
  if (FAILURES.length) {
    console.log('---- 失败明细（最多显示前 60 条）----');
    const shown = FAILURES.slice(0, 60);
    for (let i = 0; i < shown.length; i++) {
      const f = shown[i];
      console.log((i + 1) + '. [' + f.group + '] ' + f.name + (f.detail ? ' | ' + f.detail : ''));
    }
    if (FAILURES.length > shown.length) console.log('  ... 其余 ' + (FAILURES.length - shown.length) + ' 条省略');
  }
  console.log('======================================');
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('[core.test.js] 无法启动（多为 index.html 的 game-core 尚未就绪或抽取失败）:');
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
