// 【v1.197】第 33 维度门禁：首局路由契约
//
// 契约（产品规则，不是实现细节）：
//   ① 新档（无任何通关记录）第一次点「出击」必须落到**教程短章 idx 0**，
//      不允许把第一次进游戏的玩家直接丢进最长/最难的推荐正片（v1.70 的 recommendedChapter=5 是星星巅 10 分钟无尽章）。
//   ② 有过任一通关后，恢复 v1.70 原意：主 CTA / 选章默认指向推荐章。
//   ③ 「推荐」标签必须与主 CTA **同源**（都取自 pickRecommendedChapter()），
//      不允许选章卡自己再读一份 CONFIG.recommendedChapter —— 那就是"标签说推荐 A、按钮送你去 B"。
//   ④ 新档判据必须容错：chapterCleared 缺失/非对象一律按新档处理（旧档走 migrateChain 会补出该字段）。
//
// 阴性对照见 selftest()：7 种"把契约改坏"的变异，每一种都必须被判 FAIL。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_GAME = join(HERE, '..', 'game', '萌兽消消岛.html');
// 取第一个非 --flag 的参数当源文件（第一版把 `--selftest` 当路径读 → ENOENT）
const fileArg = () => process.argv.slice(2).find((a) => !a.startsWith('--')) || DEFAULT_GAME;

// ---- 源码抽取：花括号配对，先剥行注释（新代码的注释里有 {} 字面量，会骗过朴素配对）----
function stripLineComments(s) {
  return s.split('\n').map((l) => {
    const i = l.indexOf('//');
    return i >= 0 ? l.slice(0, i) : l;
  }).join('\n');
}
export function extractFn(src, name) {
  const clean = stripLineComments(src);
  const idx = clean.indexOf('function ' + name + '(');
  if (idx < 0) return null;
  const open = clean.indexOf('{', idx);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') { depth--; if (depth === 0) return clean.slice(idx, i + 1); }
  }
  return null;
}

// ---- 契约检查：纯函数（源字符串 → 错误列表），selftest 靠它做变异对照 ----
export function runChecks(src, cfg) {
  const errors = [];
  const note = (ok, msg) => { if (!ok) errors.push(msg); return ok; };

  const fLock = extractFn(src, 'chapterLocked');
  const fClear = extractFn(src, 'hasAnyChapterClear');
  const fPick = extractFn(src, 'pickRecommendedChapter');
  if (!note(!!fLock && !!fClear && !!fPick, '缺少三个函数之一（chapterLocked / hasAnyChapterClear / pickRecommendedChapter）')) {
    return { errors, results: [] };
  }

  // 章节表：**按条目切分**再取自身 name/durMin
  //   （不能对整块正则抓 name/durMin —— 章内嵌套对象也有 name 字段，会整体错位）
  const mTable = src.match(/var DATA_CHAPTER = \[[\s\S]*?\n\];/);
  if (!note(!!mTable, '未找到 DATA_CHAPTER 表')) return { errors, results: [] };
  const chapters = mTable[0].split(/\{\s*chId: "/).slice(1).map((chunk) => {
    const nm = chunk.match(/name: "([^"]+)"/);
    const du = chunk.match(/durMin: (\d+)/);
    return { name: nm ? nm[1] : '?', durMin: du ? Number(du[1]) : NaN };
  });
  const names = chapters.map((c) => c.name);
  const durs = chapters.map((c) => c.durMin);

  const mCfg = src.match(/recommendedChapter: (\d+)/);
  const recCfg = mCfg ? Number(mCfg[1]) : NaN;
  const CONFIG = { recommendedChapter: recCfg };
  const DATA_CHAPTER = chapters;

  // 用抽取到的真实实现建沙箱（chapterLocked 也从源码取，不重写）
  let api;
  try {
    api = new Function(
      'saveData', 'CONFIG', 'DATA_CHAPTER',
      fLock + '\n' + fClear + '\n' + fPick + '\nreturn { pickRecommendedChapter, hasAnyChapterClear };'
    );
  } catch (e) {
    note(false, '抽取到的源码无法求值：' + e.message);
    return { errors, results: [] };
  }
  const pick = (saveData) => api(saveData, CONFIG, DATA_CHAPTER).pickRecommendedChapter();

  const results = [];
  const caseOf = (label, got, want) => {
    const ok = got === want;
    results.push({ label, got, want, ok });
    note(ok, `${label}：期望 ${want}，实际 ${got}`);
  };

  // ① 新档 → 教程短章 0
  caseOf('新档首局', pick({ chapterUnlocked: 6, chapterCleared: {} }), 0);
  // ② 有任一通关 → 推荐章
  caseOf('有通关后', pick({ chapterUnlocked: 6, chapterCleared: { ch1: true } }), recCfg);
  // ③ chapterCleared 非对象/缺失 → 按新档
  caseOf('存档无 chapterCleared', pick({ chapterUnlocked: 6 }), 0);
  caseOf('chapterCleared 为 null', pick({ chapterUnlocked: 6, chapterCleared: null }), 0);
  // ④ 值全 false 不算通关
  caseOf('只有 false 记录', pick({ chapterUnlocked: 6, chapterCleared: { ch1: false } }), 0);
  // ⑤ 推荐章被锁时回落"已解锁最后一章"
  const unlocked2 = pick({ chapterUnlocked: 2, chapterCleared: { ch1: true } });
  caseOf('推荐章被锁(chapterUnlocked=2)', unlocked2, Math.min(2, DATA_CHAPTER.length) - 1);

  // 数据侧不变量：首局章必须是短章，且短于推荐章
  note(durs.length >= 2, `DATA_CHAPTER 至少 2 章（实际 ${durs.length}）`);
  note(durs[0] <= 6, `首局章时长应 ≤6 分钟（实际 ${durs[0]}）`);
  note(recCfg >= 0 && recCfg < durs.length, `recommendedChapter=${recCfg} 越界（共 ${durs.length} 章）`);
  note(durs[0] < durs[recCfg], `首局章(${durs[0]}min)应短于推荐章(${durs[recCfg]}min)`);

  // 静态：标签与 CTA 同源、守卫在位
  const nLabel = src.split('this.idx === pickRecommendedChapter()').length - 1;
  note(nLabel === 2, `选章卡「推荐」标签应有 2 处取自 pickRecommendedChapter()（实际 ${nLabel}）`);
  note(!src.includes('this.idx === CONFIG.recommendedChapter'), '选章卡仍在直接读 CONFIG.recommendedChapter（标签与 CTA 不同源）');
  const nCta = src.split('startRun(pickRecommendedChapter())').length - 1;
  note(nCta === 1, `主 CTA 应恰好 1 处 startRun(pickRecommendedChapter())（实际 ${nCta}）`);
  note(src.includes('!hasAnyChapterClear() && !chapterLocked(0)'), '缺少「idx 0 被锁则回落」的守卫');

  results.push({
    label: '章节表：' + chapters.map((c, i) => i + ' ' + c.name + '/' + c.durMin + 'min').join(' · '),
    got: '', want: '', ok: true, info: true,
  });
  return { errors, results, names, durs, recCfg };
}

// ---- 阴性对照：每个变异都必须让 runChecks 报错 ----
export function selftest() {
  const cases = [];
  const base = readFileSync(fileArg(), 'utf8');
  const t = (name, mutate) => {
    const mutated = mutate(base);
    let bad = 0, why = '变异未生效(字符串没匹配上)';
    if (mutated !== base) {
      const r = runChecks(mutated, {});
      bad = r.errors.length;
      why = r.errors[0] || '未被判 FAIL';
    }
    cases.push({ name, pass: bad > 0, why });
  };

  cases.push({ name: '基线未变异应 0 错误', pass: runChecks(base, {}).errors.length === 0, why: (runChecks(base, {}).errors[0] || '') });

  t('M1 删掉新档分支', (s) => s.replace('  if (!hasAnyChapterClear() && !chapterLocked(0)) return 0;', ''));
  t('M2 hasAnyChapterClear 恒真', (s) => s.replace('  for (k in cc) if (cc[k]) return true;', '  return true;'));
  t('M3 标签改回直接读 CONFIG', (s) => s.replace(/this\.idx === pickRecommendedChapter\(\)/g, 'this.idx === CONFIG.recommendedChapter'));
  t('M4 主 CTA 绕过函数', (s) => s.replace('startRun(pickRecommendedChapter())', 'startRun(CONFIG.recommendedChapter)'));
  t('M5 去掉 idx0 被锁守卫', (s) => s.replace('!hasAnyChapterClear() && !chapterLocked(0)', '!hasAnyChapterClear()'));
  t('M6 chapterCleared 缺失时按老档', (s) => s.replace('if (!cc || typeof cc !== "object") return false;', 'if (!cc || typeof cc !== "object") return true;'));
  t('M7 首局章被改成超长章', (s) => s.replace(/durMin: 4,/, 'durMin: 12,'));

  let pass = 0;
  console.log('=== selftest: ci/first-session-route.mjs (v1.197 第 33 维度) ===');
  for (const c of cases) {
    if (c.pass) pass++;
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}${c.pass ? '' : '  ← ' + c.why}`);
  }
  console.log('\nselftest ' + pass + '/' + cases.length + ' ' + (pass === cases.length ? 'PASS' : 'FAIL'));
  return pass === cases.length;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('first-session-route.mjs');
if (isMain) {
  if (process.argv.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  }
  const file = fileArg();
  const src = readFileSync(file, 'utf8');
  console.log('=== ci/first-session-route.mjs (v1.197 第 33 维度：首局路由) ===');
  console.log('  源 ' + resolve(file).replace(/\\/g, '/').split('/').slice(-2).join('/') + ' (' + src.length.toLocaleString('en-US') + ' 字符)');
  const r = runChecks(src, {});
  for (const c of r.results) console.log('  ' + (c.info ? '·' : (c.ok ? '✅' : '❌')) + ' ' + c.label + (c.info ? '' : `（期望 ${c.want} / 实际 ${c.got}）`));
  if (r.errors.length) { console.log('\n❌ 违规:'); for (const e of r.errors) console.log('  ' + e); process.exit(1); }
  console.log('\n✅ PASS —— 新档首局走教程短章 · 有进度走推荐章 · 标签与主 CTA 同源');
}
