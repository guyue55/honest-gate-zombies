#!/usr/bin/env python3.9
# -*- coding: utf-8 -*-
"""
tests/browser_check.py —— Playwright 真实浏览器验证（阶段 A 只写不跑）

运行（阶段 B）：
  /opt/homebrew/opt/python@3.9/bin/python3.9 tests/browser_check.py --protocol file
  /opt/homebrew/opt/python@3.9/bin/python3.9 tests/browser_check.py --protocol http --port 8765

必须使用本机 Chrome（缓存缺 1223 版 headless shell，直接 launch 会失败）：
  p.chromium.launch(headless=True,
      executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

输出：tests/test-results-<protocol>.json（结构化结果，失败项带断言名与实际值）。
      按协议分文件 + 临时文件原子替换，支持 file/http 双协议并行回归而不互相覆盖；
      可用 --results <path> 显式指定输出路径。
截图：tests/screenshots/（V-1~V-8 + 灰阶 + prefers-reduced-motion + 5 视口）

容错说明：按钮一律「文字 / role 定位 + 多重回退」，不硬编码未定的 CSS 类名；
阶段 B 若发现选择器 / DOM / 接口对不上，允许修本脚本（但不得改 index.html）。
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import traceback

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'index.html')
SHOTS = os.path.join(ROOT, 'tests', 'screenshots')
# 结果 JSON 默认按协议分文件（见 main 的 --results 处理）：双协议并行回归时，
# 两个进程若同时 open(...,'w') 同一个文件会交错写入、产出无法解析的 JSON。
RESULTS_DIR = os.path.join(ROOT, 'tests')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PY = sys.executable

RESULTS_LIST = []
ALL_ERRORS = []
FPS_SAMPLES = []

# ---------------------------------------------------------------- 工具 / 断言
def check(name, ok, expected=None, actual=None, detail=''):
    RESULTS_LIST.append({
        'name': name, 'ok': bool(ok),
        'expected': expected, 'actual': actual, 'detail': str(detail)
    })
    if not ok:
        print('  [FAIL] %s | 期望=%r 实际=%r %s' % (name, expected, actual, detail))
    return bool(ok)


def section(name):
    print('\n== %s ==' % name)


def safe(name, fn):
    try:
        return fn()
    except Exception as e:
        check(name + ' (段异常)', False, '无异常', str(e), traceback.format_exc())
        return None


def ev(page, expr):
    """安全读取页面表达式：bigint 转字符串，避免 JSON 序列化抛错。"""
    fn = ("() => { const v = (" + expr + "); "
          "const s = JSON.stringify(v, (k, x) => typeof x === 'bigint' ? String(x) : x); "
          "return s === undefined ? null : JSON.parse(s); }")
    return page.evaluate(fn)


def bind_errors(page, tag):
    page.on('console', lambda m: ALL_ERRORS.append(tag + ':console.' + m.type + ':' + m.text)
            if m.type == 'error' else None)
    page.on('pageerror', lambda e: ALL_ERRORS.append(tag + ':pageerror:' + str(e)))


def open_page(browser, url, ctx_opts, tag):
    ctx = browser.new_context(**ctx_opts)
    page = ctx.new_page()
    bind_errors(page, tag)
    page.goto(url, wait_until='load', timeout=30000)
    # 40 关约 6–10 分钟：把元素操作默认超时放宽，避免单点慢操作拖垮整轮（裁决第 7 条）
    page.set_default_timeout(60000)
    page.wait_for_timeout(400)
    return ctx, page


CANVAS_RECT_JS = """() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return {x: r.x, y: r.y, w: r.width, h: r.height};
}"""

POINTER_JS = """(p) => {
  const c = document.querySelector('canvas') || document.body;
  const base = {bubbles: true, cancelable: true, clientX: p.x, clientY: p.y,
                pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1};
  c.dispatchEvent(new PointerEvent('pointerdown', base));
  c.dispatchEvent(new PointerEvent('pointermove', base));
  c.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, base, {buttons: 0})));
}"""

GROUPS_JS = """() => {
  const d = window.__GAME_DEBUG__;
  if (!d || !Array.isArray(d.gates)) return [];
  const toArr = (x) => Array.isArray(x) ? x : (x && Array.isArray(x.gates) ? x.gates : null);
  return d.gates.map(toArr).filter(Boolean).map((grp) => grp.map((g, i) => {
    const label = String(g && g.label !== undefined ? g.label : '');
    const op = String(g && g.op !== undefined ? g.op : '');
    let positive = g && g.positive;
    if (positive === undefined) {
      const c = label.charAt(0);
      positive = (op === 'add' || op === 'mul' || c === '+' || c === '×' || c === '*');
    }
    return {
      lane: (g && g.lane !== undefined) ? g.lane : i,
      doorCount: grp.length, positive: !!positive, op: op,
      value: String(g && g.value !== undefined ? g.value : ''), label: label
    };
  }));
}"""

EXPECT_JS = """() => {
  const d = window.__GAME_DEBUG__, C = window.__GAME_CORE__;
  if (!d || !C) return 'NO_DEBUG';
  const raw = d.gates || [];
  const groups = raw.map((x) => Array.isArray(x) ? x : (x && Array.isArray(x.gates) ? x.gates : []));
  const chosen = d.gateChoices || [];
  /* V3：陷阱门额外扣 25%（TRAP_NUM/TRAP_DEN = 1/4），且必须用「随门下发的 trapped 位」，
     不能用 d.traps —— 后者只保留渲染窗口内的陷阱，用来反推全程会漏掉大部分踩坑，
     导致「HUD 兵力与运算预期一致」误报（实测 L1 期望 64860 / 实际 63942）。 */
  let p = BigInt(String(d.entryPower || '0'));
  for (let i = 0; i < Math.min(chosen.length, groups.length); i++) {
    const grp = groups[i]; if (!grp.length) continue;
    const lane = chosen[i];
    let g = null;
    for (const cand of grp) if (cand.lane === lane || String(cand.lane) === String(lane)) { g = cand; break; }
    if (!g) g = grp[Number(lane)] || grp[0];
    let op = g.op;
    if (!op) {
      const c = String(g.label || '').charAt(0);
      op = (c === '+') ? 'add' : (c === '×' || c === '*') ? 'mul'
         : (c === '-' || c === '−') ? 'sub' : (c === '÷' || c === '/') ? 'div' : 'add';
    }
    let v;
    try { v = BigInt(String(g.value)); } catch (e) {
      try { v = BigInt(String(g.label || '').replace(/[^0-9]/g, '') || '1'); } catch (e2) { v = 1n; }
    }
    try { p = C.applyGate(p, {op: op, value: v, id: 'x', label: '', positive: true, lane: 0}).power; }
    catch (e) { return 'ERR:' + e.message; }
    if (g.trapped) {
      let loss = p / 4n;
      if (loss < 1n) loss = 1n;
      p = p - loss;
    }
  }
  return p.toString();
}"""


def logical_to_screen(rect, lx, ly):
    # ARCHITECTURE §9.1 / §12.5：逻辑 480x854，letterbox 居中
    scale = min(rect['w'] / 480.0, rect['h'] / 854.0) or 1.0
    ox = rect['x'] + (rect['w'] - 480.0 * scale) / 2.0
    oy = rect['y'] + (rect['h'] - 854.0 * scale) / 2.0
    return ox + lx * scale, oy + ly * scale


def align_keyboard(page, lane):
    """键盘对准目标 lane。

    优先用只读 __GAME_DEBUG__.currentLane 做闭环控制（裁决第 6 条：工程师新增
    targetX / currentLane / activeGroup 三个字段），比启发式按键时长可靠；
    字段尚未提供时自动回退到启发式时长，保证阶段 B 任一时点都能跑。
    """
    try:
        d = ev(page, 'window.__GAME_DEBUG__') or {}
    except Exception:
        d = {}
    if d.get('currentLane') is not None:
        # V3 加固：旧实现「按下 110ms → 松开 → 等 40ms」每步只推进约 40px，
        # 20–30 组门的关卡里跨 3 道门要 8+ 次起停，两次起停的间隙正好卡在
        # 1400ms 的判定窗口边缘（并发跑双协议时实测键盘用例偶发 win=False）。
        # 改为「按住 + 每 25ms 读一次 currentLane，到位即松键」，
        # 一次按住即可跨越任意 lane，往返次数反而更少。
        for _ in range(6):  # 上限 6 轮起停，防单点卡死拖垮整轮
            try:
                cur = ev(page, 'window.__GAME_DEBUG__') or {}
                cl = cur.get('currentLane')
                if cl is None:
                    break
                if int(cl) == int(lane):
                    return
                k = 'd' if int(cl) < int(lane) else 'a'
                page.keyboard.down(k)
                try:
                    for _ in range(40):
                        page.wait_for_timeout(25)
                        c2 = ev(page, 'window.__GAME_DEBUG__') or {}
                        cl2 = c2.get('currentLane')
                        if cl2 is None:
                            break
                        if int(cl2) == int(lane):
                            break
                finally:
                    page.keyboard.up(k)
            except Exception:
                break
        return
    # 回退：启发式按键时长（字段缺失时）
    try:
        page.keyboard.down('a')
        page.wait_for_timeout(500)
        page.keyboard.up('a')
        page.keyboard.down('d')
        page.wait_for_timeout(int(120 + lane * 180))
        page.keyboard.up('d')
    except Exception:
        pass


def align(page, method, lane, door_count, rect=None):
    """把队伍对准某道门。mouse/touch 用逻辑坐标映射；keyboard 用闭环/启发式按键。

    `rect` 可由调用方缓存后传入：一次关卡内 canvas 尺寸不变，避免每次对准都做一次
    CDP 往返（高 CPU 负载机器上，往返延迟会挤占门组判定窗口）。
    """
    if rect is None:
        try:
            rect = page.evaluate(CANVAS_RECT_JS)
        except Exception:
            rect = None
    lx = (lane + 0.5) * 480.0 / max(1, door_count)
    ly = 700.0
    if rect:
        sx, sy = logical_to_screen(rect, lx, ly)
    else:
        vs = page.viewport_size or {'width': 390, 'height': 844}
        sx, sy = vs['width'] * (lx / 480.0), vs['height'] * 0.75
    try:
        if method == 'mouse':
            page.mouse.move(sx, sy)
            page.mouse.down()
            page.mouse.move(sx, sy - 30, steps=3)
            page.mouse.up()
        elif method == 'touch':
            page.evaluate(POINTER_JS, {'x': sx, 'y': sy})
            try:
                page.touchscreen.tap(sx, sy)
            except Exception:
                pass
        elif method == 'keyboard':
            align_keyboard(page, lane)
        else:
            page.mouse.click(sx, sy)
    except Exception:
        try:
            page.evaluate(POINTER_JS, {'x': sx, 'y': sy})
        except Exception:
            pass


def align_verified(page, method, lane, door_count, rect=None):
    """对准并闭环确认 `targetX` 已生效；输入事件在慢机器上丢失时自动重试。

    用 `targetX` 而非 `currentLane` 校验：后者按「当前活动门组」的 doorCount 换算，
    门组切换后口径会变，不能作为跨组的稳定判据。
    """
    dc = max(1, door_count)
    want = (lane + 0.5) * 480.0 / dc
    tol = 0.45 * 480.0 / dc
    for _ in range(3):
        align(page, method, lane, dc, rect=rect)
        try:
            got = (ev(page, 'window.__GAME_DEBUG__') or {}).get('targetX')
            if got is not None and abs(float(got) - want) <= tol:
                return True
        except Exception:
            pass
    return False


def choose_lane(grp, mode):
    if not grp:
        return 0
    cands = [g for g in grp if (g['positive'] if mode == 'positive' else not g['positive'])]
    if not cands:
        cands = grp
    return cands[0]['lane']


def plan_lanes(page, groups, mode='positive'):
    """为每组门预规划目标 lane（V3 追加 best 模式）。

    V3 把敌方兵力改为「稳妥路径 × 72%」校准后，「首个正门」不再保证过关：
    风险组里第一道正门可能正挂陷阱（-25%），实测会得到 win=False 的假失败。
    故默认优先读只读快照 `__GAME_DEBUG__.bestPath`（每组最优门的数组下标，
    不含随机性、不参与判定），换算成 lane 后使用；字段缺失时才回退旧启发式。
    """
    fallback = [choose_lane(g, mode) for g in groups]
    if mode != 'best':
        return fallback
    try:
        bp = (page.evaluate('() => (window.__GAME_DEBUG__||{}).bestPath') or [])
    except Exception:
        bp = []
    if not isinstance(bp, list) or len(bp) != len(groups):
        return fallback
    plan = []
    for i, grp in enumerate(groups):
        idx = bp[i]
        if isinstance(idx, int) and 0 <= idx < len(grp):
            plan.append(grp[idx]['lane'])
        else:
            plan.append(fallback[i])
    return plan


def click_button(page, candidates, timeout=2500):
    """文字 / role / CSS 多重回退，最后用空格回车确认（§9.5）。

    实机校准（team-lead 阶段 B 信息）：失败浮层标题「再来一次，不看广告」与副标题
    「兵力不足，免费重试本关，不扣任何东西」也含候选词（再来一次 / 重试本关），
    若用全局 get_by_text 会命中静态文案而非按钮并误报成功。故定位一律优先
    「语义按钮 → 可交互元素内含文字」，纯文本兜底也限定在 button/[role=button]/a 内。
    """
    for c in candidates:
        strategies = (
            lambda c=c: page.get_by_role('button', name=c),
            lambda c=c: page.locator(
                'button:has-text("%s"), [role=button]:has-text("%s"), a:has-text("%s")' % (c, c, c)),
            lambda c=c: page.locator('button, [role=button], a').filter(has_text=c),
        )
        for make in strategies:
            try:
                loc = make()
                if loc and loc.count() > 0 and loc.first.is_visible():
                    loc.first.click(timeout=timeout)
                    return True
            except Exception:
                pass
    for sel in ('button', '[role=button]'):
        try:
            loc = page.locator(sel)
            if loc.count() > 0 and loc.first.is_visible():
                loc.first.click(timeout=1200)
                return True
        except Exception:
            pass
    for key in ('Enter', 'Space'):
        try:
            page.keyboard.press(key)
            return True
        except Exception:
            pass
    return False


def wait_phase(page, phases, timeout_ms=15000):
    deadline = time.time() + timeout_ms / 1000.0
    last = {}
    while time.time() < deadline:
        try:
            d = ev(page, 'window.__GAME_DEBUG__')
            last = d or {}
            if (d or {}).get('phase') in phases:
                return d
        except Exception:
            pass
        page.wait_for_timeout(80)
    return last


def advance_from_s4(page, candidates, label):
    """S4 停浮层、不自动跳转（team-lead 实机确认）：必须显式点按钮，并断言离开 S4。

    §8 状态机表虽写「或自动计时到」，但实机 file:// 下不操作时流程停在 S4；
    本函数不依赖任何自动进关，逐关显式点击并校验 phase 已变为 S1/S2。
    """
    before = (ev(page, 'window.__GAME_DEBUG__') or {}).get('phase')
    moved = click_button(page, candidates)
    check('%s 可点击[%s]' % (label, candidates[0]), moved, True, before)
    d = wait_phase(page, ['S1', 'S2'])
    after = (d or {}).get('phase')
    check('%s 后离开 S4（需显式点击）' % label,
          after in ('S1', 'S2') and after != 'S4', 'S1/S2', after,
          '点击前 phase=%s' % before)
    return d


HONESTY_BAD_WORDS = ('复活', '续命', '登录', '注册', '内购', '充值', '礼包', '领取奖励',
                     '分享得', 'VIP', '下载APP', '看广告得', '跳过本关', '付费')


def check_honesty(page, label, body=None):
    """逐屏诚实性：无广告变现 / 复活 / 登录 / 内购 / 礼包 / 外链元素（阶段 B 第 8 项）。

    注意：诚实文案「没有骗人广告」「不看广告」本身含「广告」二字，故**不用**「广告」
    泛查，只查具体的变现/作弊词，以及 DOM 里真实的 http(s) 外链 <a href>。
    """
    if body is None:
        try:
            body = page.inner_text('body')
        except Exception:
            body = ''
    hits = [w for w in HONESTY_BAD_WORDS if w in body]
    check('%s 无复活/登录/内购/礼包/外链文案' % label, len(hits) == 0, 0, hits)
    ext = ev(page, "Array.from(document.querySelectorAll('a[href]'))"
                   ".map(a=>a.getAttribute('href')).filter(h=>/^https?:/i.test(h||''))") or []
    check('%s 无 http(s) 外链 <a href>' % label, len(ext) == 0, 0, ext)


def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    try:
        page.screenshot(path=os.path.join(SHOTS, name + '.png'))
        return True
    except Exception as e:
        check('截图 ' + name, False, '成功', str(e))
        return False


def sample_fps(page, ms=1000):
    try:
        return page.evaluate("""(d) => new Promise((resolve) => {
          let f = 0; const t0 = performance.now();
          function loop(t) { f++; if (t - t0 >= d) resolve(f * 1000 / (t - t0)); else requestAnimationFrame(loop); }
          requestAnimationFrame(loop);
        })""", ms)
    except Exception:
        return -1.0


def play_level(page, method='mouse', choose='best', shots=None, timeout_ms=90000):
    """真实操作玩完当前一关直到 S4，返回 S4 时的 __GAME_DEBUG__ 快照。

    高负载稳健性（2026-11-10 补充）：一次性预规划每组目标 lane 并缓存 canvas 尺寸；
    S2 阶段只在 `activeGroup`（即将判定的门组）变化时主动对准一次，并用 `targetX`
    闭环确认输入已生效；轮询改用 Python 侧 `time.sleep` 而非 CDP 的
    `wait_for_timeout`。旧实现每次轮询都重新对准（约 5 次 CDP 往返/轮），在
    load average 40+ 的机器上往返延迟会挤占门组判定窗口，导致误选负门。
    """
    shots = shots or {}
    groups = page.evaluate(GROUPS_JS)
    gc = len(groups)
    plan = plan_lanes(page, groups, choose)
    dcs = [g[0]['doorCount'] if g else 2 for g in groups]
    try:
        rect = page.evaluate(CANVAS_RECT_JS)
    except Exception:
        rect = None
    if groups:
        align_verified(page, method, plan[0], dcs[0], rect=rect)
    # S1 门组预览恒为 2000ms，且第一个门组在 S2 开始 1400ms 后判定；高负载机器上
    # 前面的截图 / 结构检查会吃掉这段窗口。这里先完成第 0 组对准（targetX 会保留到
    # S2，队伍在 S2 内约 150ms 收敛），再显式跳过预览，让 S2 从「已对准」的时刻开始，
    # 使前面的 CDP 往返延迟不再影响胜负。
    d0 = ev(page, 'window.__GAME_DEBUG__') or {}
    if d0.get('phase') == 'S1':
        try:
            page.keyboard.press('Space')
        except Exception:
            pass
        # 只做一次轻量复核：若 S1 期间 targetX 被复位，才重新对准（正常路径仅 1 次 CDP）。
        try:
            chk = ev(page, 'window.__GAME_DEBUG__') or {}
            got = chk.get('targetX')
            want0 = (plan[0] + 0.5) * 480.0 / max(1, dcs[0]) if groups else 240.0
            if got is None or abs(float(got) - want0) > 0.45 * 480.0 / max(1, dcs[0]):
                align_verified(page, method, plan[0], dcs[0], rect=rect)
        except Exception:
            pass
    s2_done = gate_done = s3_done = False
    deadline = time.time() + timeout_ms / 1000.0
    last = {}
    completed = False
    last_aligned = 0 if groups else -1
    while time.time() < deadline:
        try:
            d = ev(page, 'window.__GAME_DEBUG__') or {}
        except Exception:
            time.sleep(0.04)
            continue
        last = d
        phase = d.get('phase')
        done = len(d.get('gateChoices') or [])

        if phase == 'S2' and not s2_done and shots.get('s2'):
            s2_done = True
            shot(page, shots['s2'])
        if done > 0 and not gate_done and shots.get('gate'):
            gate_done = True
            shot(page, shots['gate'])
        if phase == 'S3' and not s3_done:
            s3_done = True
            if shots.get('s3'):
                shot(page, shots['s3'])
            fps = sample_fps(page, 1000)
            if fps and fps > 0:
                FPS_SAMPLES.append({'level': d.get('level'), 'groups': gc, 'fps': round(fps, 2)})

        # 不能用 done>=gc 提前 break：那会在 S2 结束瞬间跳出循环，错过 S3 观察窗口，
        # 导致 V-5 S3/Boss 截图与 rAF 帧率采样全部缺失（第 1 轮实测缺陷）。
        # 必须继续轮询直到 phase 真正进入 S3/S4；60s 独立超时兜底防卡死。
        if phase in ('S3', 'S4'):
            completed = True
            break
        # 优先用 activeGroup（即将判定的门组）主动对准；字段缺失时回退到 done 下标。
        ag = d.get('activeGroup')
        ag = int(ag) if ag is not None else min(done, max(0, gc - 1))
        if ag != last_aligned and 0 <= ag < gc:
            align_verified(page, method, plan[ag], dcs[ag], rect=rect)
            last_aligned = ag
            # 慢机器上一次对准期间可能又跨过一组：立刻追赶到最新活动组，避免漏组。
            for _ in range(2):
                try:
                    d2 = ev(page, 'window.__GAME_DEBUG__') or {}
                except Exception:
                    break
                if d2.get('phase') in ('S3', 'S4'):
                    break
                ag2 = d2.get('activeGroup')
                ag2 = int(ag2) if ag2 is not None else min(
                    len(d2.get('gateChoices') or []), max(0, gc - 1))
                if ag2 == last_aligned or not (0 <= ag2 < gc):
                    break
                align_verified(page, method, plan[ag2], dcs[ag2], rect=rect)
                last_aligned = ag2
        time.sleep(0.04)
    # 每关独立超时 + 失败明细（裁决第 7 条）：单关卡住只记一条失败，不拖垮整轮
    if not completed:
        check('关卡 S2 循环独立超时(%dms)' % timeout_ms, False, '在超时内完成', '超时',
              'level=%s phase=%s done=%s/%s' % (last.get('level'), last.get('phase'),
                                                len(last.get('gateChoices') or []), gc))
    d4 = wait_phase(page, ['S4'], timeout_ms=25000)
    if (d4 or {}).get('phase') != 'S4':
        check('关卡状态机在 25s 内到达 S4', False, 'S4', (d4 or {}).get('phase'),
              'level=%s' % (d4 or {}).get('level'))
    return d4 or last


def expected_power(page):
    try:
        return page.evaluate(EXPECT_JS)
    except Exception as e:
        return 'ERR:' + str(e)


def assert_level(page, n, d, check_power=True):
    tag = '第%d关 ' % n
    check(tag + 'phaseTrace === [S1,S2,S3,S4]',
          d.get('phaseTrace') == ['S1', 'S2', 'S3', 'S4'],
          ['S1', 'S2', 'S3', 'S4'], d.get('phaseTrace'))
    outcome = d.get('outcome') or {}
    check(tag + '胜利(outcome.win)', outcome.get('win') is True, True, outcome.get('win'))
    if check_power:
        exp = expected_power(page)
        actual = outcome.get('powerBefore') or d.get('power')
        check(tag + 'HUD 兵力与运算预期一致', str(actual) == str(exp), exp, actual)


# ---------------------------------------------------------------- 各验证段
def seg_debug_and_health(page, protocol):
    section('调试接口 / 默认健康状态 / 零外部请求')
    kinds = ev(page, "({debug: typeof window.__GAME_DEBUG__, health: typeof window.__ASSET_HEALTH__, core: typeof window.__GAME_CORE__})")
    check('window.__GAME_DEBUG__ 存在', kinds.get('debug') == 'object', 'object', kinds.get('debug'))
    check('window.__ASSET_HEALTH__ 存在', kinds.get('health') == 'object', 'object', kinds.get('health'))
    check('window.__GAME_CORE__ 存在', kinds.get('core') == 'object', 'object', kinds.get('core'))

    h = ev(page, 'window.__ASSET_HEALTH__') or {}
    check('默认 externalRequestCount === 0', h.get('externalRequestCount') == 0, 0, h.get('externalRequestCount'))
    check('默认 summary.generated === 12', (h.get('summary') or {}).get('generated') == 12, 12,
          (h.get('summary') or {}).get('generated'))
    check('默认 gameplayBlocked === false', h.get('gameplayBlocked') is False, False, h.get('gameplayBlocked'))
    check('默认 mode === off', h.get('mode') == 'off', 'off', h.get('mode'))

    res = ev(page, "performance.getEntriesByType('resource').map(e => e.name)") or []
    external = [u for u in res if u.startswith('http://') or u.startswith('https://')]
    check('performance.resource 无 http(s) 外部项', len(external) == 0, 0, external)
    if protocol == 'file':
        check('file 模式下 resource 为 []', len(res) == 0, 0, res)

    # 阶段 B 第 8 项：只读性 —— 对两个只读快照的写入 / 整体替换尝试必须无效
    ro = ev(page, "(() => { const D=window.__GAME_DEBUG__, H=window.__ASSET_HEALTH__; "
                  "const b=D&&D.level, m=H&&H.mode; "
                  "try { D.level=999; H.mode='remote'; window.__GAME_DEBUG__={fake:1}; "
                  "       window.__ASSET_HEALTH__={mode:'hacked'}; } catch(e) {} "
                  "const d2=window.__GAME_DEBUG__, h2=window.__ASSET_HEALTH__; "
                  "return {beforeLevel:b, beforeMode:m, afterLevel:d2&&d2.level, afterMode:h2&&h2.mode, "
                  "        sameLevel:!!(d2&&d2.level===b), sameMode:!!(h2&&h2.mode===m), "
                  "        stillFrozenD:!!(d2&&Object.isFrozen(d2)), stillFrozenH:!!(h2&&Object.isFrozen(h2))}; })()") or {}
    check('__GAME_DEBUG__ 写入/替换尝试无效（level 不变）',
          ro.get('sameLevel') is True, True, ro)
    check('__ASSET_HEALTH__ 写入/替换尝试无效（mode 不变）',
          ro.get('sameMode') is True, True, ro)
    check('__GAME_DEBUG__ 快照仍为 Object.freeze', ro.get('stillFrozenD') is True, True, ro)
    check('__ASSET_HEALTH__ 快照仍为 Object.freeze', ro.get('stillFrozenH') is True, True, ro)
    check_honesty(page, '首页')


def seg_home_and_levels(page):
    section('首页 / 通关 1–5 关（含第 5 关 Boss）')
    shot(page, 'V-1_home')
    body = ''
    try:
        body = page.inner_text('body')
    except Exception:
        pass
    # 实机确认（team-lead）：首页诚实文案「没有隐藏玩法，没有骗人广告」与三行操作图示
    check('首页含「没有隐藏玩法，没有骗人广告」',
          '没有隐藏玩法' in body and '没有骗人广告' in body, '含诚实文案', body[:160])
    # 注意：诚实文案本身含「广告」二字，故只查与广告变现相关的具体词，不用「广告」泛查
    check('首页无登录/礼包/充值/分享得元素',
          not any(w in body for w in ('登录', '礼包', '充值', '领取奖励', '分享得', 'VIP')),
          '无', [w for w in ('登录', '礼包', '充值', '领取奖励', '分享得', 'VIP') if w in body])
    check('首页点击「开始」可进入关卡',
          click_button(page, ['开始游戏', '开始', '进入游戏', 'START', '开玩']), True)
    d1 = wait_phase(page, ['S1', 'S2'])
    check('进入第 1 关', (d1 or {}).get('level') in (1, '1'), '1', (d1 or {}).get('level'))
    first_entry = (d1 or {}).get('entryPower')
    if (d1 or {}).get('phase') == 'S1':
        shot(page, 'V-2_s1_preview')

    # 实机确认（team-lead）：gates = [{index, doorCount, gates:[{id,op,value,label,positive,lane}]}]
    # value 为十进制字符串；GROUPS_JS / EXPECT_JS 均依赖此结构，先做一次结构守卫。
    raw_gates = ev(page, 'window.__GAME_DEBUG__.gates') or []
    shape_ok = (isinstance(raw_gates, list) and len(raw_gates) > 0 and
                all(isinstance(g, dict) and isinstance(g.get('gates'), list) and
                    len(g['gates']) > 0 for g in raw_gates))
    check('gates 结构为 [{index,doorCount,gates:[...]}]', shape_ok, '非空分组列表',
          str(raw_gates)[:200])
    vals = [gg.get('value') for g in raw_gates if isinstance(g, dict)
            for gg in (g.get('gates') or []) if isinstance(gg, dict)]
    check('门 value 均为十进制字符串',
          len(vals) > 0 and all(isinstance(v, str) and str(v).lstrip('+-').isdigit()
                                for v in vals),
          '全部为数字字符串', vals[:8])

    def one_level(n):
        shots = None
        if n == 1:
            shots = {'s2': 'V-3_s2_run', 'gate': 'V-4_gate_hit', 's3': 'V-5_s3_battle'}
        elif n == 5:
            shots = {'s3': 'V-5_boss_battle'}
        d = play_level(page, 'mouse', 'best', shots=shots)
        assert_level(page, n, d)
        shot(page, 'V-6_win_lv%d' % n)
        if n == 1:
            check_honesty(page, '第1关胜利浮层(S4)')
        if n < 5:
            dnext = advance_from_s4(page, ['下一关', '继续', 'NEXT', '下一关 ▶'],
                                    '第%d关胜利' % n)
            check('胜利后 level+1 (第%d→%d关)' % (n, n + 1),
                  (dnext or {}).get('level') in (n + 1, str(n + 1)), n + 1, (dnext or {}).get('level'))

    # 每关独立 safe：单关异常/卡住只记该关失败，不拖垮后续关卡（裁决第 7 条）
    for n in range(1, 6):
        safe('第%d关完整流程（独立超时/失败明细）' % n, lambda n=n: one_level(n))
    return first_entry


def seg_fail_retry(page, first_entry, retry_count):
    section('失败免费重试 / 文案 / 连续 %d 次' % retry_count)
    # 当前处于第 5 关胜利浮层（S4 不自动跳转）；显式点下一关进入第 6 关，再故意选负门
    d6 = advance_from_s4(page, ['下一关', '继续', 'NEXT'], '第5关Boss胜利')
    check('Boss 胜利后进入第 6 关', (d6 or {}).get('level') in (6, '6'), 6, (d6 or {}).get('level'))
    # 第 1 轮实测脚本 bug：重试循环发生在**第 6 关**，基准应是 P0(6)=21，
    # 不能用首关传进来的 first_entry=P0(1)=10，否则 20 次断言全部误报。
    base_entry = (d6 or {}).get('entryPower') or first_entry
    check('失败重试基准取第 6 关入关兵力 P0(6)', base_entry is not None,
          '非 None', base_entry)

    def one_failure(i):
        d = play_level(page, 'mouse', 'negative')
        body = ''
        try:
            body = page.inner_text('body')
        except Exception:
            pass
        # 裁决：工程师用 HTML 实体 &#x770B; 规避源码字面量，源码 raw 命中可能为 0；
        # 必须用浏览器渲染后的 inner_text 断言完整中文文案，不能只靠源码检索。
        full = '再来一次，不看广告'
        check('失败#%d 渲染文案完整中文「再来一次，不看广告」' % i,
              full in body or ('再来一次' in body and '不看广告' in body),
              full, body[:160])
        check('失败#%d HTML 实体已解码（渲染文本无 &# 字面量）' % i,
              '&#' not in body, '无 &# 字面量', body[:160])
        # 实机确认：失败浮层副标题「兵力不足，免费重试本关，不扣任何东西」
        check('失败#%d 副标题含「兵力不足 / 免费重试」' % i,
              '兵力不足' in body and '免费重试' in body, '含副标题', body[:160])
        btns = ev(page, "Array.from(document.querySelectorAll('button,[role=button]')).map(b => b.innerText || b.textContent || '')") or []
        bad = [b for b in btns if any(w in b for w in ('复活', '续命', '跳过', '分享得', '看广告'))]
        check('失败#%d 无复活/看广告/跳过/续命按钮' % i, len(bad) == 0, 0, bad)
        if i == 1:
            check_honesty(page, '失败浮层(S4)', body)
        if i == 1:
            shot(page, 'V-7_fail')
        d2 = advance_from_s4(page, ['重试本关', '重试', '再来一次', '重新挑战', 'RETRY'],
                            '失败#%d' % i)
        check('失败#%d 重试后 entryPower 与首次进入该关一致' % i,
              str((d2 or {}).get('entryPower')) == str(base_entry), base_entry,
              (d2 or {}).get('entryPower'))
        check('失败#%d 重试不跳关' % i,
              (d2 or {}).get('level') in (6, '6'), 6, (d2 or {}).get('level'))
        return d2

    for i in range(1, retry_count + 1):
        safe('失败重试循环#%d' % i, lambda i=i: one_failure(i))


def seg_three_inputs(browser, url):
    section('三端输入各独立通关一关')

    def one(method, label, ctx_opts):
        ctx, page = open_page(browser, url, ctx_opts, label)
        try:
            click_button(page, ['开始游戏', '开始', '进入游戏', 'START', '开玩'])
            d = wait_phase(page, ['S1', 'S2'])
            d4 = play_level(page, method, 'best')
            win = (d4.get('outcome') or {}).get('win') is True
            check('%s 独立通关一关' % label, win, True, (d4.get('outcome') or {}).get('win'))
            check('%s phaseTrace 四段' % label, d4.get('phaseTrace') == ['S1', 'S2', 'S3', 'S4'],
                  ['S1', 'S2', 'S3', 'S4'], d4.get('phaseTrace'))
        finally:
            ctx.close()

    base = {'viewport': {'width': 390, 'height': 844}}
    safe('触屏独立通关', lambda: one('touch', '触屏',
         dict(base, has_touch=True, is_mobile=True, device_scale_factor=2)))
    safe('键盘独立通关', lambda: one('keyboard', '键盘', dict(base)))
    safe('鼠标拖拽独立通关', lambda: one('mouse', '鼠标拖拽', dict(base)))


def seg_asset_degrade(page):
    section('资源降级注入 / 仍可通关 / reset')
    hooks = ev(page, 'typeof window.__ASSET_TEST_HOOKS__')
    check('__ASSET_TEST_HOOKS__ 存在', hooks == 'object', 'object', hooks)
    try:
        page.evaluate("() => window.__ASSET_TEST_HOOKS__.simulateFailure({primary: true, fallbacks: true, timeout: true})")
        page.wait_for_timeout(300)
    except Exception as e:
        check('simulateFailure 可调用', False, '无异常', str(e))
    h = ev(page, 'window.__ASSET_HEALTH__') or {}
    degraded = (h.get('summary') or {}).get('degraded', 0)
    assets = h.get('assets') or {}
    any_degraded = any((a or {}).get('status') == 'degraded' for a in assets.values())
    check('注入后状态变 degraded', degraded > 0 or any_degraded, '>0 或任一 degraded', degraded)
    check('注入后 gameplayBlocked === false', h.get('gameplayBlocked') is False, False, h.get('gameplayBlocked'))
    check('注入后 externalRequestCount 不增加', h.get('externalRequestCount') == 0, 0, h.get('externalRequestCount'))
    d = play_level(page, 'mouse', 'best')
    check('资源降级下仍可完整通关一关', (d.get('outcome') or {}).get('win') is True, True,
          (d.get('outcome') or {}).get('win'))
    advance_from_s4(page, ['下一关', '继续', 'NEXT'], '资源降级关胜利')
    try:
        page.evaluate("() => window.__ASSET_TEST_HOOKS__.reset()")
        page.wait_for_timeout(200)
    except Exception as e:
        check('reset 可调用', False, '无异常', str(e))
    h2 = ev(page, 'window.__ASSET_HEALTH__') or {}
    check('reset 后恢复 summary.generated === 12',
          (h2.get('summary') or {}).get('generated') == 12, 12, (h2.get('summary') or {}).get('generated'))


def seg_help_panel(page):
    section('帮助面板 V-8')
    ok_click = click_button(page, ['帮助', '?', '？', '资源状态', '说明'])
    check('可打开帮助面板', ok_click, True)
    shot(page, 'V-8_help')
    body = ''
    try:
        body = page.inner_text('body')
    except Exception:
        pass
    check('帮助面板显示资源健康信息',
          any(w in body for w in ('资源', 'generated', '请求', '状态')), '含资源健康字样', body[:120])
    # 数据完整性：DOM 内资源表共 12 条（与 BUILTIN_MANIFEST.entries.length===12 一致）。
    # 390x844 视口内可见约 8 行，其余在滚动区/可视区外，属视口限制而非缺数据。
    ids = ev(page, "Array.from(document.querySelectorAll('*'))"
                   ".filter(e=>e.children.length===0 && /^[a-z]+\\.[a-z]+$/.test((e.textContent||'').trim()))"
                   ".map(e=>e.textContent.trim())") or []
    uniq = sorted(set(ids))
    check('帮助面板资源健康表含 12 条内置资源', len(uniq) == 12, 12, uniq)
    check_honesty(page, '帮助面板', body)
    click_button(page, ['关闭', '返回', '×', 'X'])


def seg_responsive(page):
    section('响应式 5 视口 / 灰阶 / reduced-motion')
    for w, h in [(320, 568), (375, 667), (430, 932), (1280, 800), (1920, 1080)]:
        page.set_viewport_size({'width': w, 'height': h})
        page.wait_for_timeout(250)
        m = page.evaluate("""() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth
        })""")
        check('视口 %dx%d 无横向滚动(scrollWidth<=clientWidth)' % (w, h),
              m['sw'] <= m['cw'], '<=%d' % m['cw'], m['sw'])
        overlap = page.evaluate("""() => {
          const host = document.querySelector('#stage') || document.body;
          const hr = host.getBoundingClientRect();
          const els = Array.from(document.querySelectorAll('button,[role=button],.overlay,.panel,[class*=layer],[class*=modal]'))
            .filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
                           return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })
            // .overlay 用 position:absolute;inset:0 铺满 #stage（宽屏下仅 480px 居中，
            // 并非铺满视口），HUD 工具按钮与遮罩是设计上的前后分层，不是布局缺陷；
            // 排除「铺满 #stage 的背景容器」后，本断言才检测前景控件间的非预期重叠。
            // （2026-11-10 高负载复跑发现：浮层可见时旧断言恒报 3 处重叠。）
            .filter(e => { const r = e.getBoundingClientRect();
                           return !(r.width >= hr.width * 0.9 && r.height >= hr.height * 0.9); });
          let bad = 0;
          for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
            if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
            const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) bad++;
          }
          return bad;
        }""")
        check('视口 %dx%d 无可见元素重叠' % (w, h), overlap == 0, 0, overlap)
        shot(page, 'viewport_%dx%d' % (w, h))
    page.set_viewport_size({'width': 390, 'height': 844})

    # 灰阶（色盲模拟）：此处截取的是「当前关卡内门组预览场景」，并非首页 /
    # S2 跑酷 / 穿门的重拍。team-lead 阶段 B 补充（方案 A）：每种条件只截 1 张，
    # 用如实命名，避免 V-* 前缀造成「文件名与内容不符」的验证证据失真。
    page.evaluate("() => { document.documentElement.style.filter = 'grayscale(1)'; }")
    page.wait_for_timeout(200)
    shot(page, 'grayscale_in_game')
    page.evaluate("() => { document.documentElement.style.filter = ''; }")

    # prefers-reduced-motion：同一场景，同样如实命名（各 1 张）
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_timeout(200)
    shot(page, 'reduced_motion_in_game')
    page.emulate_media(reduced_motion='no-preference')


def seg_fps():
    section('帧率（连续 6 组门 + 满屏僵尸）')
    if not FPS_SAMPLES:
        check('有帧率采样', False, '>=1 个采样', 0)
        return
    vals = [s['fps'] for s in FPS_SAMPLES]
    avg = sum(vals) / len(vals)
    six = [s['fps'] for s in FPS_SAMPLES if (s.get('groups') or 0) >= 6]
    check('平均 fps >= 45', avg >= 45, '>=45', round(avg, 2))
    if six:
        check('6 组门场景平均 fps >= 45', sum(six) / len(six) >= 45, '>=45',
              round(sum(six) / len(six), 2))
    else:
        check('采集到 6 组门(gateCount>=6)场景的 fps 样本', False, '>=1', 0,
              '当前最高组数=%s' % max((s.get('groups') or 0) for s in FPS_SAMPLES))


def seg_offline(browser, url, levels):
    section('断网（context.set_offline）完整玩 %d 关' % levels)
    ctx, page = open_page(browser, url,
                          {'viewport': {'width': 390, 'height': 844}}, 'offline')
    try:
        ctx.set_offline(True)
        click_button(page, ['开始游戏', '开始', '进入游戏', 'START', '开玩'])
        wait_phase(page, ['S1', 'S2'])
        wins = [0]

        def one_offline(n):
            d = play_level(page, 'mouse', 'best')
            if (d.get('outcome') or {}).get('win') is True:
                wins[0] += 1
            check('断网第%d关通关' % n, (d.get('outcome') or {}).get('win') is True, True,
                  (d.get('outcome') or {}).get('win'))
            if n < levels:
                advance_from_s4(page, ['下一关', '继续', 'NEXT'], '断网第%d关胜利' % n)

        # 每关独立 safe + 独立超时：单点卡住只记该关失败，不拖垮整轮（裁决第 7 条）
        for n in range(1, levels + 1):
            safe('断网第%d关完整流程（独立超时/失败明细）' % n, lambda n=n: one_offline(n))
        wins = wins[0]
        check('断网累计通关 >= 10 关', wins >= 10, '>=10', wins)
        # 含 2 个 Boss 关（n=5,10）
        check('断网流程覆盖 2 个 Boss 关(n=5,10)', levels >= 10, True, levels)
        res = ev(page, "performance.getEntriesByType('resource').map(e => e.name)") or []
        external = [u for u in res if u.startswith('http://') or u.startswith('https://')]
        check('断网下仍无 http(s) 外部资源项', len(external) == 0, 0, external)
    finally:
        ctx.set_offline(False)
        ctx.close()


def seg_console():
    section('控制台错误')
    real = [e for e in ALL_ERRORS if 'favicon' not in e.lower()]
    check('console error / pageerror 为 0', len(real) == 0, 0, real[:10])


def start_server(root, port):
    p = subprocess.Popen([PY, '-m', 'http.server', str(port), '--directory', root],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            s = socket.create_connection(('127.0.0.1', port), 0.2)
            s.close()
            return p
        except Exception:
            time.sleep(0.1)
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--protocol', choices=['file', 'http'], default='file')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--html', default=HTML)
    ap.add_argument('--retry-count', type=int, default=20,
                    help='失败重试连续次数（A-8 要求 20；阶段 B 可临时调小以缩短时长）')
    ap.add_argument('--offline-levels', type=int, default=12,
                    help='断网通关关数（>=10 含 2 个 Boss；12 关可覆盖 6 组门帧率场景）')
    ap.add_argument('--results', default=None,
                    help='结果 JSON 路径；默认 test-results-<protocol>.json，避免双协议并发跑时互相覆盖')
    args = ap.parse_args()
    results_path = args.results or os.path.join(
        RESULTS_DIR, 'test-results-%s.json' % args.protocol)

    server = None
    try:
        if args.protocol == 'http':
            server = start_server(ROOT, args.port)
            url = 'http://127.0.0.1:%d/index.html' % args.port
        else:
            url = 'file://' + os.path.abspath(args.html)
        print('目标 URL: ' + url)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=CHROME)
            ctx, page = open_page(browser, url,
                                  {'viewport': {'width': 390, 'height': 844}}, 'main')
            try:
                safe('调试接口/默认健康/零请求', lambda: seg_debug_and_health(page, args.protocol))
                first_entry = safe('首页与通关1-5关', lambda: seg_home_and_levels(page)) or None
                safe('失败免费重试', lambda: seg_fail_retry(page, first_entry, args.retry_count))
                safe('资源降级', lambda: seg_asset_degrade(page))
                safe('帮助面板', lambda: seg_help_panel(page))
                safe('响应式/灰阶/reduced-motion', lambda: seg_responsive(page))
                safe('三端输入', lambda: seg_three_inputs(browser, url))
                # 帧率统计必须放在断网 12 关之后：6 组门(gateCount>=6)场景只在 n>=12
                # 出现，seg_fps() 若提前调用会看不到该样本而误报（第 2 轮实测缺陷）。
                safe('断网通关', lambda: seg_offline(browser, url, args.offline_levels))
                safe('帧率', seg_fps)
                safe('控制台错误', seg_console)
            finally:
                ctx.close()
                browser.close()
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except Exception:
                pass

    passed = sum(1 for r in RESULTS_LIST if r['ok'])
    failed = sum(1 for r in RESULTS_LIST if not r['ok'])
    out = {
        'protocol': args.protocol,
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'passed': passed, 'failed': failed, 'total': len(RESULTS_LIST),
        'checks': RESULTS_LIST,
        'consoleErrors': ALL_ERRORS,
        'fpsSamples': FPS_SAMPLES,
        'screenshotsDir': SHOTS
    }
    # 先写临时文件再原子替换：即使两个协议同时收尾，也只会各自替换自己的目标文件，
    # 不会留下半份 JSON。
    tmp_path = results_path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, results_path)
    print('\n========== browser_check.py 结果 ==========')
    print('通过: %d  失败: %d  合计: %d' % (passed, failed, len(RESULTS_LIST)))
    print('JSON: ' + results_path)
    print('==========================================')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
