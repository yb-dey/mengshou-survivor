#!/usr/bin/env node
/**
 * assert-audio-map.mjs —— 断言「会被渲染的音效集合」与「会被加载的映射表」严格一致
 *
 * 存在理由（2026-09-21 实测抓到的真缺陷）：
 *   `CONFIG.audio.gains` 有 **19** 个 SFX 键 → `Audio._renderAll()` 遍历它，程序化渲染这 19 个；
 *   而 `AUDIO_ASSET.sfxFiles` 只有 **15** 个键 → `tryLoadLocalFiles()` 按它 fetch。
 *   多出的 4 个（SFX_CARDSHOW / SFX_CHEST / SFX_EVENT / SFX_REVIVE）
 *   **永远拿不到外采文件**，静默走程序化兜底 —— 覆盖 **10 个埋点**
 *   （全部 5 个章事件提示 + 复活 + revivecard + 开箱 + 弹卡 + eventgift）。
 *   这不是"做错"，是"**根本没做**"：两张表各自都自洽，只有交叉比对才看得出来。
 *
 * 同型坑（本项目已踩两次）：
 *   · dist/ 长期 0 个音频，而 verify-dist 全绿（静默降级到程序化合成）
 *   · 本次：sfxFiles 少 4 键，无任何报错
 *   → 共同点：**"运行时按表拼接的路径"没有任何字面量**，正则/构建/lint 全都看不见，
 *     必须**从"会被使用的集合"反推清单**再比对产物。
 *
 * 本断言查 5 条（任何一条不满足 → exit 1）：
 *   ① gains 的键集 ⊆ sfxFiles 的键集（否则那些键永远无外采文件）
 *   ② sfxFiles 里每个键都能在 game/audio/ 找到对应文件
 *   ③ game/audio/ 里不存在"无任何 sfxFiles/gains 键引用"的孤儿文件
 *   ④ gains 里每个键都有程序化合成器分支（否则外采缺失时无声，属二次静默降级）
 *      —— 用 `--no-proc` 跳过（有些项目没有程序化兜底层）
 *   ⑤ （v1.169 新增，**最强的一条**）`DATA_SFX` 里 `sfx: "SFX_XXX"` 引用的每个 buffer
 *      都必须同时存在于 gains 与 sfxFiles。
 *      —— 前四条都是"声明表之间互相印证"，而 ⑤ 引入的是**真正的消费方**：
 *         `DATA_SFX` 有 69 个条目（shoot/beam/hit/boom/eventfog/...），全部落回 19 个 buffer。
 *         这才是"游戏实际会播放的声音"的权威口径。
 *         只对 gains↔sfxFiles 做闭环，**两张表可以一起漏**（都在 HTML 里、一起改就一起错）；
 *         而 DATA_SFX 是 69 个游戏事件，漏一个立即在事件层露馅。
 *
 *   ⑥ （v1.169 新增）**加载清单必须遍历声明表，不能是手抄副本** ——
 *      `tryLoadLocalFiles()` 里若出现 `var localBgm = {...}` / `var localSfx = {...}`
 *      这类硬编码清单，就与 `AUDIO_ASSET.bgmFiles/sfxFiles` 构成"两份真相"。
 *      本项目实测：硬编码 6/7 键 vs 声明 10/19 键 → **12 个 SFX + 4 个 BGM 永远不被 fetch**。
 *      ⚠ 这是 v1.168 修的那类坑的**更深一层**：v1.168 补"声明表漏键"，
 *        本项防"加载清单漏键" —— 补完声明表也不算完，还得有人真的按它加载。
 *
 *   ⑦ （v1.170 新增）**外采渲染器不得再抄一份 gain 表**：
 *      `ci/render-missing-sfx.mjs` 里若出现 `const GAINS =` 或归一调用里含 gain，
 *      则该 gain 会被**烘焙进文件峰值**，而运行时（12593 行）**又乘一次**
 *      → **同一个 gain 应用两次**，且两次取的是**不同版本的值**（陈旧值 × 现行值），
 *      误差非线性叠加。实测 `sfx_fire.wav` 峰值/gain = 2.168，全场唯一离群。
 *      正确口径 = 与游戏 `_renderAll`(12173 行) 一致：**只做平峰值归一** `peakNorm`，
 *      响度层级**只由运行时 gains 决定**（单一权威）。
 *      ⑦ 与 ①②③⑤⑥ 同源，都是"手抄副本"病 —— 这也是本项目第二大缺陷类。
 *
 * 用法: node ci/assert-audio-map.mjs [srcHtml] [audioDir]
 * 阴性对照: node ci/assert-audio-map.mjs --selftest
 */
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const SELFTEST = argv.includes('--selftest');

const HTML = argv.find((a) => !a.startsWith('--')) ||
  path.join('game', fs.readdirSync('game').find((f) => f.toLowerCase().endsWith('.html')));
const AUDIO_DIR = argv.filter((a) => !a.startsWith('--'))[1] || path.join(path.dirname(HTML), 'audio');

/** 从 idx 处开始的花括号配平取体（本项目数据表有 // 行注释与嵌套对象） */
function balanced(s, idx) {
  const j = s.indexOf('{', idx);
  let d = 0;
  for (let k = j; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) return s.slice(j, k + 1); }
  }
  return '';
}
const stripComments = (t) => t.replace(/\/\/[^\n]*/g, '');

/** 核心检查：给定 HTML 文本与音频目录，返回 {fail, note, info} */
export function checkAudioMap(s, audioDir, opts = {}) {
  const rendererSrc = opts.rendererSrc;   // 供自测注入"被改坏的渲染器"；主流程不传则读磁盘
  const fail = [];
  const note = [];
  const info = {};

  // ---- gains 表（决定会被渲染的集合）----
  //   ⚠ 锚点必须用 `audio:` 定位（`gains:` 在全文件可能先被注释/文档提到）
  const ai = s.indexOf('audio:');
  const gi = ai >= 0 ? s.indexOf('gains:', ai) : s.indexOf('gains:');
  if (gi < 0) return { fail: ['HTML 里找不到 CONFIG.audio.gains'], note, info };
  const gains = new Set(
    [...stripComments(balanced(s, gi)).matchAll(/\b(SFX_[A-Z0-9_]+)\s*:/g)].map((m) => m[1]));
  info.gains = gains.size;

  // ---- sfxFiles 表（决定会被加载的集合）----
  //   ⚠ 锚点用 `sfxFiles:` 本身（该名字只在此处出现）
  const fi = s.indexOf('sfxFiles:');
  if (fi < 0) return { fail: ['HTML 里找不到 AUDIO_ASSET.sfxFiles'], note, info };
  const sfxMap = new Map(
    [...stripComments(balanced(s, fi)).matchAll(/(SFX_[A-Z0-9_]+)\s*:\s*"([^"]+)"/g)]
      .map((m) => [m[1], m[2]]));
  info.sfxFiles = sfxMap.size;

  // ---- 磁盘文件 ----
  const disk = fs.existsSync(audioDir)
    ? new Set(fs.readdirSync(audioDir).filter((f) => /^sfx_.*\.(wav|mp3|ogg|m4a)$/i.test(f)))
    : new Set();
  info.disk = disk.size;

  // ---- ① gains ⊆ sfxFiles ----
  const noMap = [...gains].filter((g) => !sfxMap.has(g)).sort();
  if (noMap.length) {
    fail.push(`CONFIG.audio.gains 有 ${noMap.length} 个键在 AUDIO_ASSET.sfxFiles 里没有映射 ` +
      `→ 这些音效**永远拿不到外采文件**，静默走程序化兜底: ${noMap.join(', ')}`);
  }

  // ---- ② sfxFiles 每项都有文件 ----
  const fileMiss = [...sfxMap].filter(([, f]) => !disk.has(f + '.wav') && !disk.has(f + '.mp3'))
    .map(([k, f]) => `${k}→${f}.wav`);
  if (fileMiss.length) {
    fail.push(`sfxFiles 声明了但 game/audio/ 里找不到文件（${fileMiss.length} 个）: ${fileMiss.join(', ')}`);
  }

  // ---- ③ 孤儿文件 ----
  const referenced = new Set([...sfxMap.values()].map((f) => f + '.wav'));
  const orphan = [...disk].filter((f) => !referenced.has(f)).sort();
  if (orphan.length) {
    fail.push(`game/audio/ 有 ${orphan.length} 个孤儿 sfx 文件（无任何 sfxFiles 键引用，不会被加载）: ` +
      orphan.join(', '));
  }

  // ---- ④ gains 每个键都有程序化合成器分支 ----
  if (!opts.noProc) {
    const proc = new Set([...s.matchAll(/id\s*===\s*"(SFX_[A-Z0-9_]+)"/g)].map((m) => m[1]));
    const noProc = [...gains].filter((g) => !proc.has(g)).sort();
    if (noProc.length) {
      fail.push(`CONFIG.audio.gains 有 ${noProc.length} 个键没有程序化合成器分支 ` +
        `→ 外采文件缺失时会**完全无声**（二次静默降级）: ${noProc.join(', ')}`);
    }
  }

  // ---- ⑤ DATA_SFX 引用的 buffer 全部可达（**消费方口径**，最强的一条）----
  //   DATA_SFX = 66 个游戏事件 → 每个条目 `sfx: "SFX_XXX"` 指向一个 buffer。
  //   它才是"游戏实际会播放的声音"的权威清单；gains/sfxFiles 只是它的实现细节。
  //   只闭环 gains↔sfxFiles 有个盲区：两张表都在同一份 HTML 里，可以**一起漏**。
  //   ⚠ 锚点必须用 `var DATA_SFX` —— 全文件有 5 处出现 "DATA_SFX" 字样，
  //     其中 1377 行是**注释**（"事件映射在 [03] DATA_SFX"）且出现在真正的定义之前。
  //     我第一版就用裸 indexOf 命中了那条注释 → balanced() 圈错了块 → 检查 ⑤ 静默永不触发，
  //     靠阴性对照 E/F 才抓到。（本次自证：**守卫本身也会犯"名字匹配 ≠ 真身"的错**。）
  const si = s.search(/var\s+DATA_SFX\s*=/);
  if (si >= 0) {
    const used = new Set(
      [...stripComments(balanced(s, si)).matchAll(/sfx:\s*"(SFX_[A-Z0-9_]+)"/g)].map((m) => m[1]));
    info.used = used.size;
    if (!used.size) {
      fail.push('DATA_SFX 块解析出 0 个 buffer 引用 —— 锚点/解析可能失效（本检查形同虚设）');
    }
    const noGain = [...used].filter((u) => !gains.has(u)).sort();
    const noFile = [...used].filter((u) => !sfxMap.has(u)).sort();
    if (noGain.length) {
      fail.push(`DATA_SFX 有 ${noGain.length} 个被游戏事件引用的 buffer 不在 CONFIG.audio.gains 里 ` +
        `→ 这些声音**根本没有合成器**（播放即静默/报错）: ${noGain.join(', ')}`);
    }
    if (noFile.length) {
      fail.push(`DATA_SFX 有 ${noFile.length} 个被游戏事件引用的 buffer 不在 AUDIO_ASSET.sfxFiles 里 ` +
        `→ 只能程序化兜底、永远拿不到外采文件: ${noFile.join(', ')}`);
    }
  } else {
    note.push('未找到 `var DATA_SFX =`（跳过消费方口径检查 ⑤）');
  }

  // ---- ⑥ 加载清单必须**遍历声明表**，不能硬编码副本 ----
  //   v1.169 抓到的更深一层同类坑：`tryLoadLocalFiles()` 里硬编码 localBgm(6)/localSfx(7)，
  //   而 AUDIO_ASSET 声明 10/19 → 12 个 SFX + 4 个 BGM 永远不被 fetch。
  //   凡是"手抄的副本"都会漏；正确做法是 `for (id in AUDIO_ASSET.xxxFiles)`。
  //
  //   ⚠⚠ 锚点教训（同一轮内第二次踩，务必记住）：
  //     这里**不能**用 `s.indexOf('tryLoadLocalFiles')` —— 它命中的是 CONFIG 块里的一句
  //     **注释/字段提及**（idx 34712），而真正的函数体在 idx **518770**（相隔 484KB）！
  //     第一版就是这么写的，于是窗口读到了无关文本 → 基线被误报为 FAIL。
  //     → 锚点必须带**函数定义语法**：`tryLoadLocalFiles: function`。
  const li = s.search(/tryLoadLocalFiles\s*:\s*function/);
  if (li >= 0) {
    // 窗口取函数体一段（够覆盖 loadOne 之后的清单段）
    const body = s.slice(li, li + 2600);
    const hardLbm = /var\s+localBgm\s*=\s*\{/.test(body);
    const hardLsfx = /var\s+localSfx\s*=\s*\{/.test(body);
    const iterBgm = /for\s*\(\s*\w+\s+in\s+AUDIO_ASSET\.bgmFiles\s*\)/.test(body);
    const iterSfx = /for\s*\(\s*\w+\s+in\s+AUDIO_ASSET\.sfxFiles\s*\)/.test(body);
    info.loadIter = iterBgm && iterSfx;
    if (hardLbm || hardLsfx || !iterBgm || !iterSfx) {
      fail.push('tryLoadLocalFiles() 的加载清单不是遍历 AUDIO_ASSET 声明表 ' +
        `（硬编码 localBgm=${hardLbm} / localSfx=${hardLsfx}；` +
        `遍历 bgmFiles=${iterBgm} / sfxFiles=${iterSfx}）` +
        ' → 手抄副本一旦与声明表不一致，多出的键**永远不会被 fetch**（静默降级）');
    }
  } else {
    note.push('未找到 `tryLoadLocalFiles: function`（跳过加载清单检查 ⑥）');
  }

  // ---- ⑦ （v1.170 新增）**外采渲染器不得再抄一份 gain 表** ----
  //   病根同 ①②③⑤⑥：**手抄副本**。实测 `ci/render-missing-sfx.mjs` 里有一张 GAINS 表，
  //   19 条中 12 条与真身 `CONFIG.audio.gains` 漂移（CARD 0.62↔0.70 / HURT 0.62↔0.72 /
  //   BOSS_DIE 0.70↔0.80 / WIN 0.68↔0.80 …）。
  //   危害不是"抄错"而是**双重缩放**：该表的值被烘焙进**文件峰值**，而运行时第 12593 行
  //   **又乘一次** `CONFIG.audio.gains[sid]` → 同一个 gain 应用两次，且两次取的是
  //   **不同版本的值**，误差非线性叠加（实测 `sfx_fire.wav` 峰值/gain = 2.168，全场唯一离群）。
  //   正确做法：外采文件与游戏内合成器 `_renderAll` 同口径 —— **只做平峰值归一**，
  //   响度层级**只由运行时 gains 决定**（单一权威）。
  const rp = path.join('ci', 'render-missing-sfx.mjs');
  if (rendererSrc !== undefined ? rendererSrc !== null : fs.existsSync(rp)) {
    const r = rendererSrc !== undefined && rendererSrc !== null
      ? rendererSrc
      : fs.readFileSync(rp, 'utf8');
    const hasGainTable = /const\s+GAINS\s*=/.test(r);
    const bakesGain = /normalize\s*\(\s*\w+\s*,\s*[^)]*gain/i.test(r) ||
      /0\.708\s*\*\s*gain/.test(r);
    info.rendererClean = !hasGainTable && !bakesGain;
    if (hasGainTable) {
      fail.push('ci/render-missing-sfx.mjs 又出现了 per-id 增益表 `const GAINS =` ' +
        '→ 它与 CONFIG.audio.gains 必然漂移，且被烘焙进文件峰值 → 运行时再乘一次 = 双重缩放');
    }
    if (bakesGain) {
      fail.push('ci/render-missing-sfx.mjs 的归一调用里仍含 gain（烘焙时乘了一次）' +
        '→ 与运行时 gains 构成双重缩放；应只做平峰值归一 normalize(raw, PEAK_NORM)');
    }
  } else {
    note.push('未找到 ci/render-missing-sfx.mjs（跳过外采渲染器检查 ⑦）');
  }

  // 全等提示（是否还有其它结构性差异）
  if (gains.size !== sfxMap.size) {
    note.push(`gains(${gains.size}) 与 sfxFiles(${sfxMap.size}) 键数不一致`);
  }
  return { fail, note, info };
}

// ---------------- 自测：阴性对照（构造必错样本，验证守卫真会报错）----------------
if (SELFTEST) {
  const base = fs.readFileSync(HTML, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'amap-'));
  for (const f of fs.readdirSync(AUDIO_DIR)) {
    if (f.endsWith('.wav')) fs.copyFileSync(path.join(AUDIO_DIR, f), path.join(tmpDir, f));
  }
  const cases = [];
  const ok0 = checkAudioMap(base, tmpDir);
  cases.push(['基线（真实产物）', ok0.fail.length === 0, ok0.fail.join(' | ') || 'PASS']);

  // A. 从 sfxFiles 删掉一个键 → ① 应报
  const a = base.replace(/(SFX_REVIVE:\s*"sfx_revive")/, 'REMOVED_REVIVE: "x"');
  const ra = checkAudioMap(a, tmpDir);
  cases.push(['A 删 sfxFiles 一个键（gains 仍有）', ra.fail.some((f) => /永远拿不到外采文件/.test(f)),
    ra.fail.join(' | ')]);

  // B. 删一个磁盘文件 → ② 应报
  const t2 = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'amap-'));
  for (const f of fs.readdirSync(tmpDir)) fs.copyFileSync(path.join(tmpDir, f), path.join(t2, f));
  fs.unlinkSync(path.join(t2, 'sfx_event.wav'));
  const rb = checkAudioMap(base, t2);
  cases.push(['B 删磁盘 sfx_event.wav', rb.fail.some((f) => /找不到文件/.test(f)), rb.fail.join(' | ')]);

  // C. 放一个孤儿文件 → ③ 应报
  const t3 = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'amap-'));
  for (const f of fs.readdirSync(tmpDir)) fs.copyFileSync(path.join(tmpDir, f), path.join(t3, f));
  fs.writeFileSync(path.join(t3, 'sfx_ghost.wav'), 'x');
  const rc = checkAudioMap(base, t3);
  cases.push(['C 放孤儿 sfx_ghost.wav', rc.fail.some((f) => /孤儿/.test(f)), rc.fail.join(' | ')]);

  // D. 去掉某键的合成器分支 → ④ 应报
  const d = base.replace(/id === "SFX_CHEST"/, 'id === "SFX_NOPE"');
  const rd = checkAudioMap(d, tmpDir);
  cases.push(['D 去掉 SFX_CHEST 合成器分支', rd.fail.some((f) => /完全无声/.test(f)),
    rd.fail.join(' | ')]);

  // E. ⑤ 消费方口径：DATA_SFX 引用一个"两张表都没有"的 buffer → 应报
  //    （这是前四条**抓不到**的一类：gains 与 sfxFiles 都自洽，只有游戏事件引用了它）
  const e = base.replace(/(sfx:\s*"SFX_EVENT")/, 'sfx: "SFX_GHOSTBUFFER"');
  const re2 = checkAudioMap(e, tmpDir);
  cases.push(['E DATA_SFX 引用不存在的 buffer', re2.fail.some((f) => /根本没有合成器/.test(f)),
    re2.fail.join(' | ')]);

  // F. ⑤ 的**纯净**变体：gains 与 sfxFiles「一起漏」掉 SFX_REVIVE，
  //    但 DATA_SFX 的两个事件（revive / revivecard）仍在引用它。
  //    → 检查 ① 静默（两表一致），检查 ④ 静默（合成器还在），
  //      只有 ⑤ 的「消费方口径」能抓到 —— 这正是 ①~④ 的**结构性盲区**。
  const f2 = base
    .replace(/SFX_REVIVE:\s*0\.62,\s*/, '')
    .replace(/,?\s*SFX_REVIVE:\s*"sfx_revive"/, '');
  const rf2 = checkAudioMap(f2, tmpDir);
  cases.push(['F gains+sfxFiles 一起漏掉 SFX_REVIVE（仅 ⑤ 能抓）',
    rf2.fail.some((f) => /DATA_SFX[\s\S]*不在 AUDIO_ASSET\.sfxFiles/.test(f)) &&
    !rf2.fail.some((f) => /没有映射/.test(f)),
    rf2.fail.join(' | ')]);

  // G. ⑥ 加载清单退回硬编码副本 → 应报
  const g = base.replace(
    /for\s*\(\s*id\s+in\s+AUDIO_ASSET\.sfxFiles\s*\)/,
    'var localSfx = { SFX_FIRE: 1 }; for (id in localSfx)');
  const rg = checkAudioMap(g, tmpDir);
  cases.push(['G 加载清单退回硬编码 localSfx', rg.fail.some((f) => /不是遍历 AUDIO_ASSET/.test(f)),
    rg.fail.join(' | ')]);

  // H. ⑦ 渲染器重新引入 per-id 增益表 → 应报
  const RENDERER = fs.readFileSync(path.join('ci', 'render-missing-sfx.mjs'), 'utf8');
  const h = checkAudioMap(base, tmpDir,
    { rendererSrc: RENDERER + '\nconst GAINS = { SFX_FIRE: 0.32 };\n' });
  cases.push(['H 渲染器又抄一份 GAINS 表', h.fail.some((f) => /又出现了 per-id 增益表/.test(f)),
    h.fail.join(' | ')]);

  // I. ⑦ 归一调用里仍烘焙 gain（双重缩放）→ 应报
  //    构造：把正确的 normalize(raw, PEAK_NORM) 换回旧的 normalize(raw, 0.708*gain/0.708)
  const i = checkAudioMap(base, tmpDir, {
    rendererSrc: RENDERER.replace(/normalize\s*\(\s*raw\s*,\s*PEAK_NORM\s*\)/,
      'normalize(raw, 0.708 * gain / 0.708)'),
  });
  cases.push(['I 渲染器归一里仍烘焙 gain（双重缩放）',
    i.fail.some((f) => /仍含 gain/.test(f)), i.fail.join(' | ')]);

  console.log('# 音频映射断言 —— 阴性对照自测\n');
  console.log('| 样本 | 期望 | 实测 | 说明 |');
  console.log('|---|---|---|---|');
  let allOk = true;
  for (const [name, pass, msg] of cases) {
    if (!pass) allOk = false;
    console.log(`| ${name} | ${name.startsWith('基线') ? 'PASS' : 'FAIL'} | ${pass ? '✅ 符合' : '❌ 未检出'} | ${msg.slice(0, 110)} |`);
  }
  for (const t of [tmpDir, t2, t3]) fs.rmSync(t, { recursive: true, force: true });
  console.log(allOk ? '\n## 自测: **PASS** — 守卫能检出全部 9 类错误 ✅' : '\n## 自测: **FAIL** — 有样本未被检出 ❌');
  process.exit(allOk ? 0 : 1);
}

// ---------------- 主流程 ----------------
const s = fs.readFileSync(HTML, 'utf8');
const { fail, note, info } = checkAudioMap(s, AUDIO_DIR);

console.log('# 音频映射一致性断言\n');
console.log('- 源 HTML   : ' + HTML);
console.log('- 音频目录  : ' + AUDIO_DIR);
console.log(`- CONFIG.audio.gains : ${info.gains} 个（会被程序化渲染的集合）`);
console.log(`- AUDIO_ASSET.sfxFiles: ${info.sfxFiles} 个（会被 fetch 的映射表）`);
console.log(`- DATA_SFX 引用的 buffer: ${info.used ?? '—'} 个（**消费方口径**，66 个游戏事件落回这些）`);
console.log(`- 磁盘 sfx 文件      : ${info.disk} 个`);
note.forEach((n) => console.log('- ' + n));

if (fail.length) {
  console.log('\n## 结论: **FAIL**\n');
  fail.forEach((f) => console.log('- ✗ ' + f));
  console.log('\n> 两张表各自自洽、只有交叉比才看得出来的缺口，正是"静默降级"的温床。' +
    '\n> 修法：把缺口补进 sfxFiles 并渲染对应文件（`ci/render-missing-sfx.mjs --apply`），' +
    '\n> 而不是放宽本断言。');
  process.exit(1);
}
console.log('\n## 结论: **PASS** — 渲染集合 / 加载映射 / 磁盘文件三者一致 ✅');
