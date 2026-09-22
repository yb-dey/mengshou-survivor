#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.193/194 第 20 维度门禁: 存档字段"写入-展示"闭环

【问题】
  一、R26 引入无尽挑战, 给 chapterBest 扩展了 endlessTime / endlessKills 两键:
    - 写入: runSummary.endless 分支
    - 迁移: clampSaveRanges 白名单携带, 防旧档丢字段
    - 注释: 明写"取历史更优"
  但**没有任何一处把它们渲染出来**。结算页的"历史最佳"行条件是:
    if (runSummary.win && runSummary.prevBest)   ← 无尽败局 win=false, 恒假
    else if (!runSummary.win && runSummary.note) ← 无尽走这条, 只显示本局 note
  → 玩家"历史最长无尽存活/最高无尽击杀"永久不可见; 且因为 prevBest 只在 pb.wins>0
    时赋值, 而 best.wins++ 只在 win 分支 —— 无尽局连 prevBest 都是 null。

  二、v1.194 用同一判据扫**全部嵌套存档对象**, 抓到同类更大一例:
  saveData.dailyBest {date,wins,bestKills,bestSec,ruleId} 五字段全写盘 + clamp 携带,
  同样**零渲染点** —— 玩家"今天加菜的最好成绩"永久不可见。

【判据】5 条
  A 解析: 能从源码抽出【全部嵌套存档对象】里的键集合(不退化; 实测值写死比对)
  B 写入: 每个被审计的键至少有一处 `X.k = value` 形式赋值
  C 展示: 每个键至少有一处"展示可达"读取(直接出现, 或经一层局部变量转发)
  D 消费侧自证: 端到端阴性对照 —— 对修复前文件必须 exit 1
  E 白名单: 显式豁免需登记理由, 且豁免项必须仍"有写入"(防用豁免掩盖真死字段)

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

# 被审计的嵌套存档对象 -> 期望键数(实测值; 数字变了说明 schema 变了, 必须人工确认后再改)
AUDIT_OBJECTS = {
    'chapterBest': 5,      # wins/bestKills/bestSec + endlessTime/endlessKills
    'dailyBest': 5,        # date/wins/bestKills/bestSec/ruleId
}
# 显式豁免: 键 -> 理由(必须写明"为什么可以不展示")
EXEMPT = {
    # dailyStamp 仅作"日历键"中间量; 同值已由 dailyBest.date 承载并展示 → 冗余字段, 不单独展示
    'dailyStamp': '值 == dailyBest.date, 展示由 dailyBest 承担',
}
EXPECT_TOTAL_KEYS = 10     # 实测值: 两对象合计 10 键
RENDER_HINTS = ('fillText', 'ctx.', 'hud', 'draw', 'String(', 'concat')

# 每个被审计对象在**读取侧**用到的承载名(对象限定匹配用)。
# ⚠ 必须穷举: 漏一个就会把真实展示判成"死字段"(假红); 多写一个就会蹭绿别的对象。
# 判据 C 只认 `<别名>.<key>` 这种**对象限定**读取 —— 裸键名不算(见 _named_in_stmt)。
OBJECT_ALIASES = {
    'chapterBest': ('saveData.chapterBest', 'chapterBest', 'pb', 'best', 'prevBest',
                    '_pe', '_pe2', 'be', 'bestE', 'cb', 'cb2'),
    'dailyBest': ('saveData.dailyBest', 'dailyBest', '_db', 'db', 'dbn'),
}


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


# 对象字面量里绝不能当键名的 JS 关键字(排除 `x ? a : b` 之类误判)
_CODE_KW = frozenset((
    'typeof', 'isFinite', 'Math', 'return', 'function', 'null', 'true', 'false',
    'undefined', 'instanceof', 'new', 'this', 'in', 'of', 'else', 'if', 'for', 'while',
))
# 空兜底 `obj.X = {}`(2 字符) 与近空字面量都不是 schema 定义 → 一律不当锚点
MIN_LITERAL = 20


def _literal_at(src, brace):
    """从 brace 指向的 '{' 开始做括号配平, 返回区间右界(不含)。"""
    depth = 0
    j = brace
    while j < len(src):
        c = src[j]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return -1


def _keys_of_literal(lit):
    """抽对象字面量里的 `键:` 集合, 排除三元表达式的假键。

    ⚠ 不能简单用"值以 typeof 开头就丢"——`date: typeof db.date === "string" ? db.date : ""`
    是**合法键**, 而 `x ? a : b` 里的 `a : b` 才是假键。判据是:
      假键的 ':' 在**最近一个未闭合的 '?' 之后**(即处于三元分支里)。
      → 从键名前 400 字符里数 '?' 与 ':' 的收支, 有未闭合 '?' 说明在分支内。
    """
    body = lit[1:-1]
    keys = []
    for km in re.finditer(r'(?:^|[,{(\s])\s*([A-Za-z_$][\w$]*)\s*:(?!:)', body):
        k = km.group(1)
        if k in _CODE_KW:
            continue
        # 该 ':' 是否落在未闭合的三元 '?' 之后
        head = body[max(0, km.start() - 400):km.start()]
        if head.count('?') > head.count(':'):
            continue                      # 三元分支里的假键
        keys.append(k)
    return [k for k in dict.fromkeys(keys)]


def parse_object_keys(src, obj_name):
    """从 clampSaveRanges 里抽某个嵌套存档对象的键集合(判据 A)。

    必须同时支持**两种真实写法**(缺一种就会静默漏掉整个对象 —— 第九类空跑):
      形态① 直接内联:  obj.X = { a: ..., b: ... };
      形态② 中间变量:  vX = { ... };  obj.X = vX;
      空兜底同形不同义: obj.X = {};      ← 长度 < MIN_LITERAL, 跳过

    锚点一律用**代码唯一串**, 绝不用注释文案(注释可能远在数千字符外 → 定位失败)。
    """
    asg = re.compile(r'obj\.' + re.escape(obj_name) + r'\s*=\s*([A-Za-z_$][\w$]*|\{)')
    fallback = None
    for m in asg.finditer(src):
        tok = m.group(1)
        # ---- 形态① 内联字面量 ----
        if tok == '{':
            brace = m.end() - 1
            bend = _literal_at(src, brace)
            if bend < 0:
                continue
            lit = src[brace:bend]
            if len(lit) < MIN_LITERAL:
                continue                      # 空兜底, 不是 schema
            keys = _keys_of_literal(lit)
            if keys:
                return keys                   # 内联长字面量 = 权威 schema
            continue
        # ---- 形态② 中间变量 ----
        # `obj.X = vX;` 里的 vX 常是纯收集器(如 nb2), 真值模板写在另一个临时变量
        # (如 v4) 里再被搬运进去。所以看赋值语句**之前 3000 字符窗口内**所有 `V = {`
        # 候选, 取离 `obj.X = vX` 最近且**够长**的那个 —— 它才是 schema 定义。
        var = tok
        end = m.start()
        win = max(0, end - 3000)
        best_at, best_keys = -1, None
        for cm in re.finditer(r'([A-Za-z_$][\w$]*)\s*=\s*\{', src[win:end]):
            brace = win + cm.end() - 1
            bend = _literal_at(src, brace)
            if bend < 0 or bend > end + 200:
                continue
            lit = src[brace:bend]
            if len(lit) < MIN_LITERAL:
                continue                 # 空兜底不是 schema
            keys = _keys_of_literal(lit)
            if keys and brace > best_at:
                best_at, best_keys = brace, keys
        if best_keys and fallback is None:
            fallback = best_keys
    return fallback


def parse_all_objects(src):
    """返回 {对象名: [键, ...]}; 任一对象解析失败返回 (None, 失败名)。"""
    out = {}
    for name in AUDIT_OBJECTS:
        ks = parse_object_keys(src, name)
        if not ks:
            return None, name
        out[name] = ks
    return out, None


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


ASSIGN_NOISE = (
    r'obj\.chapterBest', r'obj\.dailyBest',
    r'\bvar v4\s*=', r'\bvar runSummary\s*=',
)


def _named_in_stmt(stmt, key, name):
    """语句里是否**确实读到了 <name>.<key>**(或它的别名)。

    ⚠ 判据 C 的历史假阳性根源: 只匹配裸键名 `wins` 时, `chapterBest.wins` 会被
    `dailyBest` 的展示行"蹭绿"(两个对象都有 wins/bestKills/bestSec)。
    正确做法是要求出现**对象限定**的读取:  `<别名>.<key>`, 其中 <别名> 必须是
    该对象的已知承载名(见 OBJECT_ALIASES)。
    ⚠ 别名的 `.` 前可能是 `saveData.dailyBest`, 也可能只是末段 `_db`;
      两种都要认, 所以对每个别名同时匹配全串与末段。
    """
    aliases = OBJECT_ALIASES.get(name, ())
    for a in aliases:
        for cand in (a, a.split('.')[-1]):
            if re.search(re.escape(cand) + r'\s*\.\s*' + re.escape(key) + r'\b', stmt):
                return True
            # 括号取值: DATA_DAILY[_db.ruleId] / x["key"]
            if re.search(re.escape(cand) + r'\s*\[\s*["\']?' + re.escape(key), stmt):
                return True
    return False


def find_reads(src, key, obj_name=None):
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
        if any(re.search(p, flat) for p in ASSIGN_NOISE):
            continue
        # 跳过纯赋值语句
        if re.search(r'\.' + re.escape(key) + r'\s*=(?!=)', flat):
            continue
        # ① 对象限定匹配优先
        if obj_name and _named_in_stmt(flat, key, obj_name):
            hits.append((s, flat[:200]))
            continue
        # ② 无对象名(通用工具调用)时退回裸键名
        if obj_name is None:
            hits.append((s, flat[:200]))
    return hits


def _decls_of(stmt):
    """语句里声明的局部变量名集合。"""
    vs = set(re.findall(r'\bvar\s+([A-Za-z_$][\w$]*)', stmt))
    vs |= set(re.findall(r'^\s*([A-Za-z_$][\w$]*)\s*\+=', stmt, re.M))
    return vs


def _is_guard_rhs(rhs):
    """判断右值是否只是**布尔守卫/比较**, 而非取该键的值。

    例(守卫, 不算载体):  `!!(db.date === "x")` / `db.date > 0` / `typeof db.date === "string"`
    例(取值, 算载体):    `db.bestSec | 0`        / `"x" + db.wins`  / `DATA_DAILY[db.ruleId]`
    判据: 出现比较/逻辑运算符 `=== !== == != >= <= > < && || !` 且**没有**在
          字符串拼接 / 算术 / 取值语境里直接用它 —— 近似实现: 右值里若出现比较
          运算符, 就要求同时出现明确的"取值语境"(拼接 + / 算术 / 括号取值 / 位运算)。
    """
    if not re.search(r'(===|!==|==|!=|>=|<=|>|<|&&|\|\|)', rhs):
        return False                       # 无比较 → 是取值
    # 有比较: 看是否有"把它当值用"的痕迹
    return not re.search(r'(\+|\[|\||Math\.|parseInt|String\()', rhs)


def _carrier_seed(src, key, obj_name):
    """种子载体: 变量的**初始化右值里确实取到了 <obj>.<key> 的值**。

    ⚠ 关键(两次踩坑后收紧):
      · 不能只看"语句里出现了 <obj>.<key>" —— `var _has = !!(_db.date === _today && ...)`
        里 date 只参与**比较**, 产出的是布尔守卫, 不是 date 的值。
      · 更不能按整语句声明收集载体 —— 会让别的键的载体(_has)串进来。
    正确判据: 变量声明的 `=` 右侧出现 `<别名>.<key>` / `<别名>["key"]`,
              且该右值**不是纯布尔守卫**(见 _is_guard_rhs)。
    """
    aliases = OBJECT_ALIASES.get(obj_name, ()) if obj_name else ()
    pats = []
    for a in aliases:
        for cand in (a, a.split('.')[-1]):
            pats.append(re.escape(cand) + r'\s*\.\s*' + re.escape(key) + r'\b')
            pats.append(re.escape(cand) + r'\s*\[\s*["\']?' + re.escape(key))
    if not pats:
        pats = [r'\b' + re.escape(key) + r'\b']
    val_pat = re.compile('|'.join(pats))
    seeds = set()
    for (s, e, stmt) in _stmt_spans(src):
        if any(re.search(p, stmt) for p in ASSIGN_NOISE):
            continue
        for m in re.finditer(r'\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*)', stmt):
            v, rhs = m.group(1), m.group(2)
            if val_pat.search(rhs) and not _is_guard_rhs(rhs):
                seeds.add(v)
        for m in re.finditer(r'(?:^|[;{(\s,])([A-Za-z_$][\w$]*)\s*=\s*([^;]*)', stmt):
            v, rhs = m.group(1), m.group(2)
            if v in ('var',):
                continue
            if val_pat.search(rhs) and not _is_guard_rhs(rhs):
                seeds.add(v)
        for m in re.finditer(r'(?:^|[;{(\s,])([A-Za-z_$][\w$]*)\s*\+=\s*([^;]*)', stmt):
            v, rhs = m.group(1), m.group(2)
            if val_pat.search(rhs):
                seeds.add(v)
    return seeds


def reachable_in_render(src, key, obj_name=None, depth=3):
    """在展示语句里"可达"该键 —— 支持**多跳**局部变量转发。

    例①(一跳):  `var _line = "..." + runSummary.endlessKills + "...";`
                `ctx.fillText(_line, cx, py + 132);`
    例②(两跳):  `var _bs = _db.bestSec | 0;`                 ← bestSec → _bs
                `var _bm = (_bs / 60) | 0, _bx = _bs % 60;`   ← _bs → _bm,_bx
                `ctx.fillText("最快 " + _bm + ":" + ..., ...);` ← _bm 展示

    ⚠ 三条纪律:
      · 载体必须接收该键的**值**(见 _carrier_seed), 布尔守卫 / 比较不算
      · 传播时同样只认"右值用到载体"的声明, 不做整语句收集
      · 必须迭代到不动点(只看一跳会把真实展示判成假红)
    """
    kw = re.compile(r'\b' + re.escape(key) + r'\b')
    spans = _stmt_spans(src)
    carriers = _carrier_seed(src, key, obj_name)
    # 传播规则: 只要某语句的**右值**用到已知载体, 该语句里被赋值的名字(含
    #   `var v = RHS`、`v = RHS`、`v += RHS`)都进载体集。
    #   ⚠ 必须认"裸赋值"(如 `if (_rr && _rr.name) _rn = _rr.name;`)——
    #     真实代码常先 `var _rn = "";` 再用 if 分支赋值, 只认 var 会漏掉。
    def _assigned(stmt):
        out = set()
        out |= set(re.findall(r'\bvar\s+([A-Za-z_$][\w$]*)\s*=', stmt))
        out |= set(re.findall(r'(?:^|[;{(\s,])([A-Za-z_$][\w$]*)\s*=(?!=)', stmt))
        out |= set(re.findall(r'(?:^|[;{(\s,])([A-Za-z_$][\w$]*)\s*\+=', stmt))
        return out

    def _rhs_of(stmt, name):
        m = re.search(r'\bvar\s+' + re.escape(name) + r'\s*=\s*([^;]*)', stmt)
        if m:
            return m.group(1)
        m = re.search(r'(?:^|[;{(\s,])' + re.escape(name) + r'\s*=\s*([^;]*)', stmt)
        if m:
            return m.group(1)
        m = re.search(r'(?:^|[;{(\s,])' + re.escape(name) + r'\s*\+=\s*([^;]*)', stmt)
        return m.group(1) if m else ''

    for _ in range(depth):
        before = set(carriers)
        for (s, e, stmt) in spans:
            if any(re.search(p, stmt) for p in ASSIGN_NOISE):
                continue
            for v in _assigned(stmt):
                rhs = _rhs_of(stmt, v)
                if not rhs:
                    continue
                if any(re.search(r'\b' + re.escape(c) + r'\b', rhs) for c in carriers):
                    carriers.add(v)
        if carriers == before:
            break
    # ---- 在展示语句中找: ① 直接读 ② 出现载体 ----
    shown = []
    for (s, e, stmt) in spans:
        if not any(h in stmt for h in RENDER_HINTS):
            continue
        direct = _named_in_stmt(stmt, key, obj_name) if obj_name else bool(kw.search(stmt))
        if direct or any(re.search(r'\b' + re.escape(c) + r'\b', stmt) for c in carriers):
            flat = ' '.join(stmt.split())
            shown.append((s, flat[:200]))
    return shown


def check(src, verbose=True):
    res = []
    ok_all = True

    # 判据 A: 解析不退化(全部对象)
    objs, failed = parse_all_objects(src)
    if objs is None:
        res.append(('A', False, '解析失败: 找不到 %s 的 clamp 块(禁止静默跳过)' % failed))
        return False, res, []
    total = sum(len(v) for v in objs.values())
    for name, keys in objs.items():
        exp = AUDIT_OBJECTS[name]
        if len(keys) != exp:
            res.append(('A', False, '%s 键数 %d != 期望 %d (实际 %s)'
                        % (name, len(keys), exp, ','.join(keys))))
            ok_all = False
        else:
            res.append(('A', True, '%s 键 %d 个: %s' % (name, len(keys), ','.join(keys))))
    if total != EXPECT_TOTAL_KEYS:
        res.append(('A', False, '审计键总数 %d != 期望 %d' % (total, EXPECT_TOTAL_KEYS)))
        ok_all = False

    # 判据 E: 豁免项必须仍"有写入"(防用豁免掩盖真死字段)
    for k, why in EXEMPT.items():
        if not find_writes(src, k):
            res.append(('E', False, '豁免项 %s 连写入都没有 → 应删除字段而非豁免(%s)' % (k, why)))
            ok_all = False
        else:
            res.append(('E', True, '豁免 %s 有写入, 理由: %s' % (k, why)))

    # 判据 B / C
    for name, keys in objs.items():
        for k in keys:
            w = find_writes(src, k)
            if not w:
                res.append(('B', False, '%s.%s 无写入点' % (name, k)))
                ok_all = False
            else:
                res.append(('B', True, '%s.%s 写入 %d 处' % (name, k, len(w))))

    for name, keys in objs.items():
        for k in keys:
            reads = find_reads(src, k, name)
            shown = reachable_in_render(src, k, name)
            if not shown:
                if not reads:
                    res.append(('C', False, '%s.%s 无任何非赋值读取 = 死字段(写成即忘)'
                                % (name, k)))
                else:
                    res.append(('C', False, '%s.%s 有 %d 处读取但都到不了展示语句: %s'
                                % (name, k, len(reads), reads[0][1][:60])))
                ok_all = False
            else:
                res.append(('C', True, '%s.%s 展示于 L%d: %s'
                            % (name, k, shown[0][0], shown[0][1][:60])))
    return ok_all, res, objs


# ---------------- 阴性对照 ----------------
def mutate_drop_render(src, key):
    """阴性对照辅助: 见 selftest 与 README 的"端到端"做法(用真·修复前文件)。"""
    return src


def selftest():
    """自身逻辑自证: 用合成样本验证各条判据真能分别报警。

    ⚠ 样本必须与真实源码**同构**, 否则测的就不是真判据(踩过三次):
      · 每个审计对象要有**唯一的中间变量名与唯一的字面量变量**
        (共用 `var v4` 会让 parse_object_keys 串味 → 判据 A 连锁假红)
      · 判据 C 的样本必须用**对象限定读取** + **别名**, 裸键名不算展示
      · 载体样本要走**多跳转发**(var → var), 才测得出传播链
    """
    cases = []
    # 样本键 = 真实 AUDIT_OBJECTS 的键**全量**(判据 A 会比对键数, 少一个即连锁假红)
    KEYS = {'chapterBest': ['wins', 'bestKills', 'bestSec', 'endlessTime', 'endlessKills'],
            'dailyBest': ['date', 'wins', 'bestKills', 'bestSec', 'ruleId']}
    # 每个对象一个专用别名, 必须出现在 OBJECT_ALIASES 里(否则判据 C 认不出展示)
    ALIAS = {'chapterBest': 'cb', 'dailyBest': 'db'}

    def build(with_write=True, with_render=None, drop_render=None):
        """with_render: None=全渲染; set=**只渲染集合内的键**(其余不渲染, 两对象同名键同命运)
        drop_render: set=**排除**这些键(用于构造"只有某对象某键不展示"的场景;
                     键名按 `对象.键` 精确匹配, 避免同名键被一起处理)
        """
        drop_render = drop_render or set()
        if with_render is None:
            with_render = set()
            for v in KEYS.values():
                with_render.update(v)
        out = []
        for name, keys in KEYS.items():
            v = 'v_' + name               # 唯一中间变量
            lv = 'lit_' + name            # 唯一字面量变量
            obj = ''.join('      %s: 0,\n' % k for k in keys)
            out.append('  var %s = {};\n  %s = {\n%s  };\n  obj.%s = %s;\n'
                       % (v, lv, obj, name, v))
            if with_write:
                out.append(''.join('  rec.%s = 1;\n' % k for k in keys))
            out.append(''.join('  ctx.fillText("x " + %s.%s, 0, 0);\n' % (ALIAS[name], k)
                               for k in keys
                               if k in with_render and (name + '.' + k) not in drop_render))
        # 豁免项(dailyStamp)必须仍有写入, 否则判据 E 会(正确地)报"连写入都没有"
        out.append('  obj.dailyStamp = "2026-09-22";\n')
        return ''.join(out)

    # ① 全部键 写+展示齐备 → 通过
    ok, res, _ = check(build())
    cases.append(('良性: 全键写+展示齐备', ok is True))

    # ② 全不展示 → C 报全部键(5+5=10)
    ok, res, _ = check(build(with_render=set()))
    c_bad = [r for r in res if r[0] == 'C' and not r[1]]
    cases.append(('全不展示 → C 报 10 条', ok is False and len(c_bad) == 10))

    # ③ 只展示不写 → B 报全部键
    ok, res, _ = check(build(with_write=False))
    b_bad = [r for r in res if r[0] == 'B' and not r[1]]
    cases.append(('只展示不写 → B 报 10 条', ok is False and len(b_bad) == 10))

    # ④ 单键缺渲染 → C 精确报那一个
    ok, res, _ = check(build(with_render={'endlessTime', 'endlessKills', 'date', 'wins', 'bestKills', 'bestSec'}))
    c_bad = [r for r in res if r[0] == 'C' and not r[1]]
    cases.append(('少渲染 ruleId → C 精确报 1 条', ok is False and len(c_bad) == 1
                  and 'ruleId' in c_bad[0][2]))

    # ⑤ 无 clamp 块 → A 解析失败且显式报警
    ok, res, _ = check('var x = 1;\n')
    cases.append(('无 clamp 块 → A 显式报警', ok is False and res[0][0] == 'A'
                  and '解析失败' in res[0][2]))

    # ⑥ 多跳转发仍应算"可达"(防假红): db.wins -> _r -> _s -> fillText
    s = build(with_render=set())
    s += ('  var _r = db.wins + 1;\n'
          '  var _s = _r * 2;\n'
          '  ctx.fillText("v " + _s, 0, 0);\n')
    ok, res, _ = check(s)
    c_wins = [r for r in res if r[0] == 'C' and not r[1] and 'dailyBest.wins' in r[2]]
    cases.append(('多跳转发(var->var) → C 不再报 wins', ok is False and len(c_wins) == 0))

    # ⑦ 跨对象蹭绿防护: 只给 dailyBest 展示, chapterBest 同名键不得被判"已展示"
    #   本章 key 名刻意省略(不放进 with_render), dailyBest 全渲染 → 只有 chapterBest 5 键该报
    s = build(drop_render={'chapterBest.wins', 'chapterBest.bestKills', 'chapterBest.bestSec',
                           'chapterBest.endlessTime', 'chapterBest.endlessKills'})
    ok, res, _ = check(s)
    c_bad = [r for r in res if r[0] == 'C' and not r[1]]
    cases.append(('跨对象蹭绿防护 → C 只报 chapterBest 的 5 键',
                  ok is False and len(c_bad) == 5
                  and all('chapterBest' in r[2] for r in c_bad)))

    # ⑧ 布尔守卫不算载体: `var _g = !!(db.date === "x");` 不得把 date 判成已展示
    s = build(drop_render={'dailyBest.date'})
    s += '  var _g = !!(db.date === "x");\n  ctx.fillText("g " + _g, 0, 0);\n'
    ok, res, _ = check(s)
    c_date = [r for r in res if r[0] == 'C' and not r[1] and 'dailyBest.date' in r[2]]
    cases.append(('布尔守卫不算载体 → C 仍报 date', ok is False and len(c_date) == 1))

    # ⑨ 注释里出现 fillText 不得算作展示(去注释后仍报 10 条)
    s = build(with_render=set())
    s += '  // ctx.fillText("x" + db.wins, 0, 0);\n'
    ok, res, _ = check(strip_comments(s))
    c_bad = [r for r in res if r[0] == 'C' and not r[1]]
    cases.append(('注释内伪展示 → C 仍报 10 条', ok is False and len(c_bad) == 10))

    # ⑩ 豁免项连写入都没有 → E 必报
    #   样本 build() 里 dailyStamp 有写入, 这里临时把它从样本里摘掉
    saved = EXEMPT.get('dailyStamp')
    try:
        EXEMPT['dailyStamp'] = '测试'
        ok, res, _ = check(build().replace('  obj.dailyStamp = "2026-09-22";\n', ''))
        e_bad = [r for r in res if r[0] == 'E' and not r[1]]
        cases.append(('豁免项无写入 → E 报', ok is False and len(e_bad) == 1))
    finally:
        if saved is None:
            EXEMPT.pop('dailyStamp', None)
        else:
            EXEMPT['dailyStamp'] = saved

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
    ok, res, objs = check(src)
    for tag, good, msg in res:
        print('  %s [判据 %s] %s' % ('✅' if good else '❌', tag, msg))
    if ok:
        total = sum(len(v) for v in objs.values())
        print('✅ 全部通过: %d 个对象 / %d 个字段均"可写入 + 可展示"' % (len(objs), total))
        sys.exit(0)
    print('❌ 存在"写入却永不展示"的死字段(玩家永远看不到的历史记录)')
    sys.exit(1)


if __name__ == '__main__':
    main()
