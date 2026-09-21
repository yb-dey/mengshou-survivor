// gate-audit.mjs —— 门禁自审：**"声称是门禁的步骤必须真的会拦人"**
//
// 存在理由（本轮 v1.172 抓到的真缺陷）：
//   本仓库多个 workflow 用 `continue-on-error: true` + "失败也要上传报告" 的写法，
//   代价是**步骤永远绿** —— 报告里写着 FAIL，GitHub 却打绿勾。
//   实测踩到：save-integrity 报告第一行 `## **FAIL**`，步骤显示 `✓`。
//   更糟的是：`optimize-art` 的步骤名写着「抠图后**必须**仍然 PASS」、
//   `death-frames` 写着「（**门禁**）」—— **注释/名字声称是门禁，实际从不生效**。
//   → 这类"守卫永远通过"比没有守卫更危险：它让人**以为**验过了。
//
// 判据（静态扫描，零依赖、不进浏览器）：
//   1. **声称是门禁的步骤**（步骤名含 GATE / 门禁 / 必须）若同时有 `continue-on-error: true`，
//      则**同一 job 内必须存在"收口步骤"**（读 `steps.<id>.outcome` 且会 `exit 1`）。
//      否则 FAIL —— 这是"名不副实"。
//   2. **声明"仅提示/仅留痕/不作门禁"的步骤**即使带 `continue-on-error` 也**允许**，
//      不追问、不强迫加收口（弃权是合法设计）。
//      ⚠ 但"弃权"必须**在步骤名里写明** —— 否则一律按声称门禁处理。
//   3. 收口步骤引用的 `steps.<id>` 必须在**同一 workflow** 里真实存在（防拼错 id → 收口恒真）。
//
// ⚠ 对照（本判据自证有效）：**阴性 3 个 + 阳性 3 个**。
//   阴性 = 故意违规样本，判据必须报 FAIL；阳性 = 正确样本，判据必须不报。
//   本判据自己的 3 个 bug 全部是被这组对照抓出来的（见正对照 B 与下方注释）——
//   这就是"判据自带对照"的价值：**没有对照的判据，你不知道它是在工作还是在装样子**。

import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.WF_DIR || '.github/workflows';
const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();

// 解析一个 workflow 的 steps（只取 name/id/continue-on-error 三个字段，足够判据用）
function parseSteps(text) {
  const steps = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const m = L.match(/^(\s*)-\s+name:\s*(.+?)\s*$/);
    if (m) { if (cur) steps.push(cur); cur = { name: m[2], id: '', coe: false, coeExpr: false, line: i + 1 }; continue; }
    if (!cur) continue;
    const mi = L.match(/^\s+id:\s*(\S+)\s*$/);
    if (mi) { cur.id = mi[1]; continue; }
    if (/^\s+continue-on-error:\s*true\s*$/.test(L)) { cur.coe = true; continue; }
    // ⚠ 记下"用了表达式控制"的情况（`${{ }}`）—— 静态判不了真假，既不误判成门禁也不放行成"已收口"。
    if (/^\s+continue-on-error:\s*(\$\{\{|false\s*$)/.test(L)) { cur.coeExpr = true; continue; }
  }
  if (cur) steps.push(cur);
  return steps;
}

// 该步骤是否"声称自己是门禁"
//   ⚠ 必须先剥掉**否定式**表述再判（本轮踩到的判据 bug）：
//     "不作门禁" / "不影响门禁" / "仅提示，不作门禁" 里的"门禁"是**放弃身份**，不是声称。
//     若只在最后统一按关键词匹配，这些**正确**写法会被判成"自相矛盾"（自己制造假阳性）。
//   → 做法：先把否定短语整体替换成占位符，再匹配。
const DISCLAIM = /(仅提示|仅留痕|不影响门禁|不作门禁|不作为门禁|不构成门禁|不阻断|仅供参考)/g;
const CLAIM = /(GATE|门禁|必须\s*PASS|必须仍然\s*PASS|必须通过)/;
// ⚠ 占位符本身**不能含"门禁"二字** —— 否则剥离等于没剥（本轮第二踩：写成「〔弃门禁〕」，
//   里面仍有"门禁"，`CLAIM` 照样命中 → 正对照 B 依旧误报）。
function stripDisclaim(name) {
  return String(name).replace(DISCLAIM, '〔NON-GATE〕');
}
function claimsGate(name) {
  return CLAIM.test(stripDisclaim(name));
}
function disclaimsGate(name) {
  return DISCLAIM.test(String(name));
}

function analyze(file, text) {
  const steps = parseSteps(text);
  const realIds = new Set(steps.map((s) => s.id).filter(Boolean));
  // 收口步骤：含 steps.<id>.outcome 且含 exit 1
  const collectorRe = /steps\.([A-Za-z0-9_-]+)\.outcome/g;
  let m;
  const referenced = [];
  while ((m = collectorRe.exec(text))) referenced.push(m[1]);
  const hasExit1 = /\bexit\s+1\b/.test(text);
  const sealedIds = new Set();
  if (hasExit1) referenced.forEach((r) => sealedIds.add(r));

  const issues = [];
  const sealed = [];
  // 判据 3：收口引用的 id 必须真实存在（否则该 outcome 恒为空串，`= "success"` 恒假
  //   或恒真 —— 无论哪种，收口都**不再与被测步骤挂钩**，是"收口步骤写错"的静默失效）
  if (hasExit1) {
    const RUNTIME = new Set(['job', 'steps']);   // 允许的运行时对象前缀
    for (const r of referenced) {
      if (!realIds.has(r) && !RUNTIME.has(r)) {
        issues.push({ kind: '收口引用不存在的 id', file, line: 0, name: 'steps.' + r + '.outcome',
          why: '收口步骤引用了一个**本 workflow 里不存在**的 step id → outcome 取不到值，收口与被测步骤脱钩' });
      }
    }
  }
  for (const s of steps) {
    const disclaims = disclaimsGate(s.name);
    // ⚠ 语义决定顺序（本轮第三踩）：
    //   "仅提示，不作门禁" 这类**否定式**里必定同时出现"提示/门禁"两组词 ——
    //   若先判 `claims && disclaims` 就把它当"自相矛盾"，那是**把正确的弃权写法判成错误**。
    //   正确顺序：**先看是否明确弃权**（弃权 = 本步骤不承担门禁职责，直接跳过，不追问）。
    if (disclaims) continue;
    const claims = claimsGate(s.name);
    if (!s.coe) {
      if (s.coeExpr) continue;  // 用表达式控制 → 静态判不了，不误判也不放行成"已收口"
      if (claims) sealed.push({ file, name: s.name, how: '硬门禁（无 continue-on-error）' });
      continue;
    }
    // 有 continue-on-error 且**未声明弃权**：
    if (!claims) continue;                  // 没声称门禁 → 不强迫
    if (s.id && sealedIds.has(s.id)) { sealed.push({ file, name: s.name, how: '有收口步骤读 outcome=' + s.id }); continue; }
    issues.push({ kind: '名不副实', file, line: s.line, name: s.name,
      why: '步骤名声称是门禁，却带 continue-on-error' + (s.id ? ` 且没有任何收口步骤读 steps.${s.id}.outcome` : ' 且**没有 id**，无法被收口引用') });
  }
  return { issues, sealed };
}

// ===== 阴性对照：两个故意违规的样本，判据必须报 FAIL =====
const NEG_HTML = [
  {
    tag: 'A. 声称门禁 + continue-on-error + 无收口',
    yml: [
      'jobs:',
      '  x:',
      '    steps:',
      '      - name: 跑验证（门禁：必须 PASS）',
      '        id: verify',
      '        continue-on-error: true',
      '        run: node ci/verify.mjs',
    ].join('\n'),
  },
  {
    tag: 'B. 有 continue-on-error 但收口步骤引用了**不存在的 id**（收口恒真）',
    yml: [
      'jobs:', '  x:', '    steps:',
      '      - name: 验证（门禁）', '        id: verify_real', '        continue-on-error: true', '        run: node ci/x.mjs',
      '      - name: 收口', '        if: always()', '        run: |',
      '          [ "${{ steps.verify_typo.outcome }}" = "success" ] || exit 1',
    ].join('\n'),
  },
  {
    tag: 'C. 声称门禁但无 id（收口无法引用）',
    yml: [
      'jobs:',
      '  x:',
      '    steps:',
      '      - name: 验证（必须通过）',
      '        continue-on-error: true',
      '        run: node ci/x.mjs',
      '      - name: 收口',
      '        if: always()',
      '        run: |',
      '          [ "${{ steps.verify.outcome }}" = "success" ] || exit 1',
    ].join('\n'),
  },
];
const negResults = [];
for (const n of NEG_HTML) {
  const r = analyze('<neg>', n.yml);
  negResults.push({ tag: n.tag, detected: r.issues.length > 0, n: r.issues.length });
}
const negOk = negResults.every((r) => r.detected);

// 正对照：**不应**被误报的样本
const POS_SAMPLES = [
  {
    tag: 'A. 正确收口写法（不得误报）',
    yml: [
      'jobs:', '  x:', '    steps:',
      '      - name: 验证（门禁）', '        id: verify', '        continue-on-error: true', '        run: node ci/verify.mjs',
      '      - name: 门禁收口', '        if: always()', '        run: |',
      '          [ "${{ steps.verify.outcome }}" = "success" ] || exit 1',
    ].join('\n'),
  },
  {
    // ⚠ 本样本专门守"否定式被误判"这个判据 bug（本轮实际踩到）：
    //   "仅提示，不作门禁" 里的"门禁"是**放弃身份**，不是声称 → 不得报"自相矛盾"。
    tag: 'B. 否定式声明"不作门禁"（不得误报为自相矛盾）',
    yml: [
      'jobs:', '  x:', '    steps:',
      '      - name: BGM 频谱重心与编排平衡体检（仅提示，不作门禁）',
      '        continue-on-error: true', '        run: python ci/x.py',
    ].join('\n'),
  },
  {
    tag: 'C. 纯硬门禁（无 continue-on-error，不得误报）',
    yml: [
      'jobs:', '  x:', '    steps:',
      '      - name: 音频映射一致性断言（GATE：不一致即失败）',
      '        run: node ci/x.mjs',
    ].join('\n'),
  },
];
const posResults = POS_SAMPLES.map((p) => {
  const r = analyze('<pos>', p.yml);
  return { tag: p.tag, n: r.issues.length, ok: r.issues.length === 0 };
});
const posOk = posResults.every((r) => r.ok);

// ===== 扫描真实 workflow =====
const results = [];
const allIssues = [];
const allSealed = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  const r = analyze(f, text);
  allIssues.push(...r.issues);
  allSealed.push(...r.sealed);
  results.push({ file: f, issues: r.issues.length, sealed: r.sealed.length });
}

const pass = allIssues.length === 0 && negOk && posOk;

const md = [];
md.push('# 门禁自审（"声称是门禁的步骤必须真的会拦人"）');
md.push('');
md.push('> 为什么需要这个判据：本轮实测抓到 —— `save-integrity` 报告第一行写着 `## **FAIL**`，');
md.push('> 而 GitHub 步骤显示 `✓`（`continue-on-error: true` 让失败不影响 job 结论）。');
md.push('> 更糟：`optimize-art` 步骤名写着「抠图后**必须**仍然 PASS」、`death-frames` 写着「（**门禁**）」');
md.push('> —— **注释/名字声称是门禁，实际从不生效**。"守卫永远通过"比没有守卫更危险。');
md.push('');
md.push('## 判据');
md.push('');
md.push('2. 步骤名含 `GATE`/`门禁`/`必须…PASS` 且带 `continue-on-error: true` →');
md.push('   必须有收口步骤（读 `steps.<id>.outcome` 且会 `exit 1`），否则 FAIL。');
md.push('3. 声明"仅提示/仅留痕/不作门禁"的步骤 → **允许**带 `continue-on-error`（合法弃权，不追问）。');
md.push('4. 收口步骤引用的 `steps.<id>` 必须**真实存在**（防拼错 id → 收口恒真/恒假，脱钩静默失效）。');
md.push('');
md.push('## 阴性对照 / 正对照（判据自证有效）');
md.push('');
md.push('| 样本 | 应当 | 判据结论 | 结果 |');
md.push('|---|---|---|---|');
for (const r of negResults) md.push('| 负：' + r.tag + ' | 必须检出 | 检出 ' + r.n + ' 条 | ' + (r.detected ? '✅' : '❌') + ' |');
for (const r of posResults) md.push('| 正：' + r.tag + ' | 不得误报 | 检出 ' + r.n + ' 条 | ' + (r.ok ? '✅' : '❌') + ' |');
md.push('');
md.push('> ⚠ 这组对照**抓出了判据自己的 3 个 bug**（全部本轮实测踩到，值得记下来）：');
md.push('> ① `CLAIM` 在"**不作门禁**"里命中"门禁" → 把**正确**写法误判成"自相矛盾"（3 处假阳性）。');
md.push('> ② 剥离否定短语时占位符写成「〔弃**门禁**〕」—— 里面**仍有"门禁"二字**，剥离等于没剥。');
md.push('> ③ 判断顺序错：`claims && disclaims` 对否定式必然同时为真 → **必然误报**。');
md.push('>   → 修法：**先判是否明确弃权（弃权=跳过，不追问），再判是否声称门禁**。');
md.push('');
md.push('> **教训**：判据自带对照不是"锦上添花"，是**发现判据自己坏了**的唯一手段。');
md.push('> 如果这组对照没写，上面 3 个 bug 会一直躲在一个"永远 PASS"的判据里。');
md.push('');
md.push('## 判据的局限（**它不检查什么** —— 诚实声明，别把它当全能）');
md.push('');
md.push('| 检查不到 | 说明 | 补位手段 |');
md.push('|---|---|---|');
md.push('| 收口步骤本身**逻辑写错** | 只看"读了 outcome 且会 exit 1"，不看比较逻辑对不对 | 收口步骤要**短到一眼可读**（本仓库统一 10 行内）|');
md.push('| 步骤名**没提门禁**但实际在拦人 | 判据只认名字；匿名/朴素命名的硬门禁不进"已收口"清单 | 靠 `verify`/`verify-dist` 的**端到端失败演练**（见下）|');
md.push('| 判据的**执行条件**被改坏 | 例如给收口步骤加 `if: success()` → `always()` 缺失时它自己不会跑 | 收口步骤必须带 `if: always()`；本判据**不校验**此项 |');
md.push('| workflow **触发器**被改窄 | `on: push` 改成 `on: workflow_dispatch` → 门禁永不自动跑 | 无静态手段，靠人工审查 diff |');
md.push('');
md.push('> **最重要的局限**：静态扫描只能证明"**写得像**会拦人"，不能证明"**真的会**拦人"。');
md.push('> 唯一能证明门禁有效的方法是**故意让它失败一次**（阴性对照必须在云端真跑过）。');
md.push('> 本轮 v1.172 的做法：`ci/save-integrity.mjs` 内置阴/正对照；`verify-dist.yml` 的收口步骤');
md.push('> 已在 run `35609728401` 云端真跑并通过 —— **这才叫验证过**，静态自审只是补网。');
md.push('');
md.push('## 各 workflow 扫描结果');
md.push('');
md.push('| workflow | 问题数 | 已收口/硬门禁 |');
md.push('|---|---|---|');
for (const r of results) md.push('| ' + r.file + ' | ' + r.issues + ' | ' + r.sealed + ' |');
md.push('');
if (allSealed.length) {
  md.push('### 已确认会拦人的门禁');
  md.push('');
  for (const s of allSealed) md.push('- `' + s.file + '` — ' + s.name + ' · ' + s.how);
  md.push('');
}
md.push('## 结论');
if (allIssues.length) {
  for (const i of allIssues) md.push('- ❌ **' + i.kind + '** `' + i.file + '` L' + i.line + ' — ' + i.name + '\n  ' + i.why);
} else {
  md.push('- ✅ 所有"声称是门禁"的步骤都真的会拦人（要么是硬门禁，要么有收口步骤）');
}
if (!negOk) md.push('- ❌ **阴性对照未通过 → 本判据自己失效**（它检不出故意的违规样本）');
if (!posOk) md.push('- ❌ 正对照被误报 → 判据会误伤正确写法');
md.push('');
md.push('## **' + (pass ? 'PASS' : 'FAIL') + '** — ' + (pass ? '门禁名实相符 ✅' : '存在名不副实或判据失效 ❌'));

fs.writeFileSync(path.join('ci', 'out', 'gate-audit.md'), md.join('\n'));
console.log(md.join('\n'));
process.exit(pass ? 0 : 1);
