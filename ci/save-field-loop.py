#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.193 第 20 维度门禁: 存档字段"写入-展示"闭环

【问题】
  R26 引入无尽挑战, 给 chapterBest 扩展了 endlessTime / endlessKills 两键:
    - 写入: L22231/22232(runSummary.endless 分支)
    - 迁移: L11539/11540(clampSaveRanges 白名单携带, 防旧档丢字段)
    - 注释: L22224 明写"取历史更优"
  但**没有任何一处把它们渲染出来**。结算页的"历史最佳"行条件是:
    if (runSummary.win && runSummary.prevBest)   ← 无尽败局 win=false, 恒假
    else if (!runSummary.win && runSummary.note) ← 无尽走这条, 只显示本局 note
  → 玩家"历史最长无尽存活/最高无尽击杀"永久不可见; 且因为 prevBest 只在 pb.wins>0
    时赋值, 而 best.wins++ 只在 win 分支 —— 无尽局连 prevBest 都是 null。

【判据】4 条
  A 解析: 能从源码抽出 clampSaveRanges 携带的 chapterBest 扩展键集合(不退化)
  B 写入: 每个扩展键至少有一处 `X.k = value` 形式赋值
  C 展示: 每个扩展键至少有一处"非赋值"读取, 且读取必须落在绘制/文案调用内
    (即该行同时出现 fillText/ctx./hud 等渲染特征)
  D 消费侧自证: 至少一个扩展键存在"写入有、展示无"的反例会被本判据检出(端到端阴性对照)

用法:
  python3 ci/save-field-loop.py [--selftest] [--file <html>]
环境:
  GAME_HTML=<路径>  切换入口(默认可相对定位)
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_HTML = os.path.normpath(os.path.join(HERE, '..', 'game', '萌兽消消岛.html'))

# 只看 chapterBest 这个对象上的扩展键(常驻三键 wins/bestKills/bestSec 有展示, 不参与)
CORE_KEYS = ('wins', 'bestKills', 'bestSec')
EXPECT_EXT_KEYS = ('endlessTime', 'endlessKills')      # 实测值: R26 引入 2 键
RENDER_HINTS = ('fillText', 'ctx.', 'hud', 'draw', 'String(', 'concat')


class Fail(Exception):
    pass


def read_src(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()


def lines_of(src):
    return src.split('\n')


def strip_comments(src):
    """去掉 // 行注释与 /* */ 块注释, 避免被注释里的关键字骗过(第三类空跑)。"""
    src = re.sub(r'/\*[\s\S]*?\*/', '', src)
    out = []
    for ln in src.split('\n'):
        # 粗略但足够: 不处理字符串内的 // (本文件无此写法)
        i = ln.find('//')
        out.append(ln[:i] if i >= 0 else ln)
    return '\n'.join(out)


def parse_ext_keys(src):
    """从 clampSaveRanges 的 chapterBest 块里抽扩展键(判据 A)。

    锚点用 `obj.chapterBest = nb2`(唯一), 向前回退到 `var nb2` 起, 取整段。
    不依赖注释文案(注释里出现 chapterBest 的位置可能远在数千字符外 → 用注释锚会空跑)。
    """
    end = src.find('obj.chapterBest = nb2')
    if end < 0:
        return None
    start = src.rfind('var nb2', 0, end)
    if start < 0:
        return None
    block = src[start:end]
    # 对象字面量里的 `键:` 形态
    keys = re.findall(r'^\s*([A-Za-z_$][\w$]*)\s*:', block, re.M)
    keys = [k for k in dict.fromkeys(keys)]
    ext = [k for k in keys if k not in CORE_KEYS]
    return ext


def find_writes(src, key):
    return re.findall(r'[\w$\]\.]+\b' + re.escape(key) + r'\s*=(?!=)', src)


def _stmt_spans(src):
    """返回 [(起始行, 结束行, 语句文本)] —— 以 `;` 结尾为界, 把跨行的表达式合并。
    这样 "A + key + B" 这种跨行拼接也能被整体识别(否则按单行扫会漏)。"""
    lines = lines_of(src)
    spans = []
    buf = []
    start = 1
    for i, ln in enumerate(lines, 1):
        if not buf:
            start = i
        buf.append(ln)
        if ln.rstrip().endswith(';'):
            spans.append((start, i, '\n'.join(buf)))
            buf = []
    if buf:
        spans.append((start, len(lines), '\n'.join(buf)))
    return spans


def find_reads(src, key):
    """非赋值读取, 按语句(跨行)粒度返回 [(起始行, 语句文本)]。

    排除三类噪声(它们让历史上本判据"假绿/假红"):
      · obj.chapterBest = nb2 / var v4 = {...} 这类结构骨架
      · var runSummary = {...} 这类字段声明
      · 注释(调用方已 strip_comments)
    """
    kw = re.compile(r'\b' + re.escape(key) + r'\b')
    hits = []
    for (s, e, stmt) in _stmt_spans(src):
        if not kw.search(stmt):
            continue
        flat = ' '.join(stmt.split())
        # 跳过 clamp 骨架 / 定义行
        if 'obj.chapterBest' in flat or re.search(r'\bvar v4\s*=', flat):
            continue
        if re.search(r'\bvar runSummary\s*=', flat):
            continue
        # 跳过纯赋值语句
        if re.search(r'\.' + re.escape(key) + r'\s*=(?!=)', flat):
            continue
        hits.append((s, flat[:200]))
    return hits


def reachable_in_render(src, key, depth=2):
    """在展示语句里"可达"该键 —— 直接出现, 或经由局部变量一层转发。

    例:  `var _line = "..." + runSummary.endlessKills + "...";`
         `ctx.fillText(_line, cx, py + 132);`
    → endlessKills 经 _line 到达 fillText。
    """
    kw = re.compile(r'\b' + re.escape(key) + r'\b')
    # 收集承载该键的局部变量名
    carriers = set()
    for (s, e, stmt) in _stmt_spans(src):
        if not kw.search(stmt):
            continue
        if 'obj.chapterBest' in stmt or re.search(r'\bvar v4\s*=', stmt):
            continue
        if re.search(r'\bvar runSummary\s*=', stmt):
            continue
        for v in re.findall(r'\bvar\s+([A-Za-z_$][\w$]*)', stmt):
            carriers.add(v)
        for v in re.findall(r'^\s*([A-Za-z_$][\w$]*)\s*\+=', stmt, re.M):
            carriers.add(v)
    # 在展示语句中找载体
    shown = []
    for (s, e, stmt) in _stmt_spans(src):
        if not any(h in stmt for h in RENDER_HINTS):
            continue
        if kw.search(stmt) or any(re.search(r'\b' + re.escape(c) + r'\b', stmt) for c in carriers):
            flat = ' '.join(stmt.split())
            shown.append((s, flat[:200]))
    return shown


def check(src, verbose=True):
    res = []
    ok_all = True

    # 判据 A: 解析不退化
    ext = parse_ext_keys(src)
    if ext is None:
        res.append(('A', False, '解析失败: 找不到 chapterBest clamp 块'))
        return False, res, []
    if len(ext) != len(EXPECT_EXT_KEYS):
        res.append(('A', False, '扩展键数 %d != 期望 %d (实际 %s)'
                    % (len(ext), len(EXPECT_EXT_KEYS), ','.join(ext))))
        ok_all = False
    else:
        res.append(('A', True, '扩展键 %d 个: %s' % (len(ext), ','.join(ext))))

    # 判据 B / C
    for k in ext:
        w = find_writes(src, k)
        if not w:
            res.append(('B', False, '%s 无写入点' % k))
            ok_all = False
        else:
            res.append(('B', True, '%s 写入 %d 处' % (k, len(w))))

    for k in ext:
        reads = find_reads(src, k)
        shown = reachable_in_render(src, k)
        if not shown:
            if not reads:
                res.append(('C', False, '%s 无任何非赋值读取 = 死字段(写成即忘)' % k))
            else:
                res.append(('C', False, '%s 有 %d 处读取但都到不了展示语句(仅参与 note 拼接/比较): %s'
                            % (k, len(reads), reads[0][1][:60])))
            ok_all = False
        else:
            res.append(('C', True, '%s 展示于 L%d: %s' % (k, shown[0][0], shown[0][1][:60])))
    return ok_all, res, ext


# ---------------- 阴性对照 ----------------
def mutate_drop_render(src, key):
    """把该键在展示语句里的读取替换掉(模拟'只写不展示')→ 当前源无展示, 故用另一种变异:
    把展示条件里的键名改写成不存在 → 应被 C 检出。"""
    # 本文件当前就处于"无展示"状态, 阴性对照改为: 注入一行展示 → 应转为 PASS
    return src


def selftest():
    """自身逻辑自证: 用合成样本验证 4 条判据真能分别报警。"""
    cases = []

    def make(ext_keys, with_write=True, with_render=True):
        # 构造一个最小可解析片段(锚点与真实代码同构: var nb2 ... obj.chapterBest = nb2)
        obj = ''.join('        %s: 0,\n' % k for k in ext_keys)
        w = ''.join('  runSummary.%s = 1;\n' % k for k in ext_keys) if with_write else ''
        r = ''
        if with_render:
            r = ''.join('  ctx.fillText("best " + be.%s, 0, 0);\n' % k for k in ext_keys)
        clamp = ('// chapterBest clamp\nvar nb2 = {}, k4, b, v4;\n  var v4 = {\n'
                 '    wins: 0,\n    bestKills: 0,\n    bestSec: 0,\n'
                 + obj + '  };\n    obj.chapterBest = nb2;\n')
        return clamp + w + r

    # ① 真实良性(2 键 有写有渲染) → 通过
    s = make(['endlessTime', 'endlessKills'], True, True)
    ok, res, _ = check(s)
    cases.append(('良性: 写+展示齐备', ok is True))

    # ② 只写不展示 → C 必报
    s = make(['endlessTime', 'endlessKills'], True, False)
    ok, res, _ = check(s)
    c_bad = [r for r in res if r[0] == 'C' and not r[1]]
    cases.append(('只写不展示 → C 报 2 条', ok is False and len(c_bad) == 2))

    # ③ 只展示不写 → B 必报
    s = make(['endlessTime', 'endlessKills'], False, True)
    ok, res, _ = check(s)
    b_bad = [r for r in res if r[0] == 'B' and not r[1]]
    cases.append(('只展示不写 → B 报 2 条', ok is False and len(b_bad) == 2))

    # ④ 键数不符 → A 必报
    s = make(['endlessTime'], True, True)
    ok, res, _ = check(s)
    a_bad = [r for r in res if r[0] == 'A' and not r[1]]
    cases.append(('扩展键数不足 → A 报', ok is False and len(a_bad) == 1))

    # ⑤ 无中间件(空表) → A 解析失败
    s = 'var x = 1;\n'
    ok, res, _ = check(s)
    cases.append(('无 clamp 块 → A 解析失败', ok is False and res[0][0] == 'A'))

    # ⑥ 读取存在但不在展示语句 → C 必报(排除"参与拼接即算展示"的假绿)
    s = ('// chapterBest clamp\nvar nb2 = {}, k4, b, v4;\n  var v4 = {\n'
         '    wins: 0,\n    bestKills: 0,\n    bestSec: 0,\n    endlessTime: 0,\n  };\n'
         '    obj.chapterBest = nb2;\n'
         '  runSummary.endlessTime = 1;\n'
         '  var q = 1 + be.endlessTime;\n')
    ok, res, _ = check(s)
    c_bad = [r for r in res if r[0] == 'C' and not r[1]]
    cases.append(('读取不在展示语句 → C 报', ok is False and len(c_bad) == 1))

    # ⑦ 注释里出现 fillText 不得算作展示(去注释后仍报)
    s = ('// chapterBest clamp\nvar nb2 = {}, k4, b, v4;\n  var v4 = {\n'
         '    wins: 0,\n    bestKills: 0,\n    bestSec: 0,\n    endlessTime: 0,\n  };\n'
         '    obj.chapterBest = nb2;\n'
         '  runSummary.endlessTime = 1;\n'
         '  // ctx.fillText(be.endlessTime, 0, 0);\n'
         '  var q = be.endlessTime;\n')
    ok, res, _ = check(strip_comments(s))
    c_bad = [r for r in res if r[0] == 'C' and not r[1]]
    cases.append(('注释内伪展示 → C 仍报', ok is False and len(c_bad) == 1))

    print('=== save-field-loop selftest ===')
    npass = 0
    for i, (name, good) in enumerate(cases, 1):
        print(('  %s %d) %s' % ('PASS' if good else 'FAIL', i, name)))
        npass += 1 if good else 0
    print('  --- %d/%d' % (npass, len(cases)))
    return npass == len(cases)


def main():
    args = sys.argv[1:]
    if '--selftest' in args:
        sys.exit(0 if selftest() else 1)

    html = os.environ.get('GAME_HTML') or DEFAULT_HTML
    if '--file' in args:
        html = args[args.index('--file') + 1]
    if not os.path.isfile(html):
        print('❌ 入口不存在: %s' % html)
        sys.exit(2)

    src = strip_comments(read_src(html))
    print('=== v1.193 存档字段"写入-展示"闭环 ===')
    print('入口: %s (%d 字节)' % (html, len(src)))
    ok, res, ext = check(src)
    for tag, good, msg in res:
        print('  %s [判据 %s] %s' % ('✅' if good else '❌', tag, msg))
    if ok:
        print('✅ 全部通过: %d 个扩展键均"可写入 + 可展示"' % len(ext))
        sys.exit(0)
    print('❌ 存在"写入却永不展示"的死字段(玩家永远看不到的历史记录)')
    sys.exit(1)


if __name__ == '__main__':
    main()
