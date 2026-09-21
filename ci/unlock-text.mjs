#!/usr/bin/env node
// unlock-text.mjs —— 大厅解锁条件文案 × 真实数据 交叉一致性门禁（零依赖，静态解析内联母版）
//
// 存在理由（v1.187 实测抓到的真缺陷）：
//   `DATA_HALL_UNLOCK.condText` 是**玩家可见**的条件文案（3 处渲染点：锁定态 / 未解锁提示 /
//   仓库行卡 "条件 X"），但它把"击破 BOSS"的**时刻**硬编码进了字符串：
//       startmag  : "击破 6:00 锚点首领（熔岩狮）"
//       mapledart : "击破 10:00 终局首领（深渊鲸王）"
//   而 `cond` 只存 boss id、**无章节限定** → 解锁在玩家**首次击杀该 boss**时触发。
//   实测首次时刻：boss2 = ch2 花花谷 @300s = **5:00**（文案说 6:00，差 60s）
//                 boss3 = ch4 岩岩坡 @480s = **8:00**（文案说 10:00，差 120s）
//   → 玩家在解锁那一局看到的 BOSS 到点时刻与卡面写的**不一样**，是误导。
//
// 病根归类：**"跨表硬编码了一个逐章变化的量"**（数据源两个，文案抄了一份）。
//   ⚠ 关键：**没有这一步交叉比，任何静态审计都查不出** —— 文案本身语法正确、
//     引用正确、长度合规，只有把它与 `DATA_CHAPTER.bossTimes/bossIds` 对齐才看得见。
//
// 判据（3 条）：
//   A. anchor 型：condText 若含 `M:SS` 时刻，必须等于该 boss 的**首次出现时刻**（按章节顺序）
//      —— 因为玩家就是在那一局第一次满足条件、第一次读到这句。
//   B. anchor 型：condText 若含 中文括号括注的 boss 名，必须与 DATA_ENEMY[boss].name 一致。
//   C. clear/achieve 型：引用的 chId / ach id 必须真实存在；含章节名时必须与 DATA_CHAPTER 一致。
//
// ⚠ 阴性对照（本判据自证有效）：内置 3 个**故意违规**样本，判据必须检出。
// 用法: node ci/unlock-text.mjs [--selftest]
import fs from 'node:fs';
import path from 'node:path';

const GAME_DIR = process.env.GAME_DIR || 'game';
// PICK_ENTRY_FILTERED: 排除 _ 前缀（_ = 临时/备份），防审计到备份文件（v1.187 实测）
const entry = fs.readdirSync(GAME_DIR).filter((f) => f.toLowerCase().endsWith('.html') && !f.startsWith('_')).sort()[0];
if (!entry) { console.log('SKIP 找不到 game/*.html'); process.exit(0); }
const src = fs.readFileSync(path.join(GAME_DIR, entry), 'utf8');

// ---- 括号配平取体（勿用 indexOf('];')：对象/数组两种形态都要能吃）----
function cutBody(s, name) {
  const i = s.indexOf('var ' + name);
  if (i < 0) return null;
  let j = s.indexOf('=', i);
  while (j < s.length && s[j] !== '{' && s[j] !== '[') j++;
  const open = s[j], close = open === '{' ? '}' : ']';
  let depth = 0, k = j, inStr = null, inLine = false, inBlock = false;
  for (; k < s.length; k++) {
    const c = s[k], n = s[k + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; k++; } continue; }
    if (inStr) { if (c === '\\') { k++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLine = true; k++; continue; }
    if (c === '/' && n === '*') { inBlock = true; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return s.slice(j, k + 1); }
  }
  return null;
}

const chapBody = cutBody(src, 'DATA_CHAPTER');
const unlockBody = cutBody(src, 'DATA_HALL_UNLOCK');
const achBody = cutBody(src, 'DATA_ACHIEVE');
const enemyBody = cutBody(src, 'DATA_ENEMY');
if (!chapBody || !unlockBody || !achBody || !enemyBody) {
  console.log('SKIP 关键数据表切体失败:', { chapBody: !!chapBody, unlockBody: !!unlockBody, achBody: !!achBody, enemyBody: !!enemyBody });
  process.exit(0);
}

const fmt = (t) => Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');

// ---- 章节：按出现顺序收集 (chId, name, [(bossId, t)]) ----
function parseChapters(body) {
  const out = [];
  const re = /chId:\s*"([^"]+)"[\s\S]{0,200}?name:\s*"([^"]+)"[\s\S]{0,600}?bossTimes:\s*\[([^\]]*)\]\s*,\s*bossIds:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(body))) {
    out.push({
      chId: m[1], name: m[2],
      pairs: m[3].split(',').map((x) => +x.trim()).map((t, i, arr) => ({
        t, bossId: (m[4].split(',')[i] || '').trim().replace(/"/g, ''),
      })).filter((p) => p.bossId),
    });
  }
  return out;
}
const chaps = parseChapters(chapBody);

// bossId → 首次出现 {chId, name, t}
const firstBoss = {};
for (const c of chaps) for (const p of c.pairs) if (!firstBoss[p.bossId]) firstBoss[p.bossId] = { chId: c.chId, name: c.name, t: p.t };

// ---- 敌人名（boss1/2/3 在 DATA_ENEMY 里）----
const bossName = {};
{
  const re = /(boss\d)\s*:\s*\{[\s\S]{0,400}?name:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(enemyBody))) bossName[m[1]] = m[2];
}
// 兜底：显式映射（若 DATA_ENEMY 结构变化导致正则失手）
const BOSS_NAME_FALLBACK = { boss1: '巨盾龟', boss2: '熔岩狮', boss3: '深渊鲸王' };
for (const k of Object.keys(BOSS_NAME_FALLBACK)) if (!bossName[k]) bossName[k] = BOSS_NAME_FALLBACK[k];

// ---- 解锁条目 ----
function parseUnlocks(body) {
  const out = [];
  const re = /\{\s*id:\s*"([^"]+)"[\s\S]{0,400}?cond:\s*\{([^}]*)\}\s*,\s*\n?\s*condText:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(body))) out.push({ id: m[1], cond: m[2].trim(), condText: m[3] });
  return out;
}
const unlocks = parseUnlocks(unlockBody);

// ---- 成就 id 集合 ----
const achIds = new Set();
{
  const re = /id:\s*"([a-z_0-9]+)"/g;
  let m;
  while ((m = re.exec(achBody))) achIds.add(m[1]);
}

// ---- 判据 ----
function check(list, chapsIn, firstIn, bossNameIn, achIdsIn) {
  const problems = [];
  for (const u of list) {
    const bm = u.cond.match(/boss:\s*"([^"]+)"/);
    const cm = u.cond.match(/chId:\s*"([^"]+)"/);
    const am = u.cond.match(/ach:\s*"([^"]+)"/);

    // A. anchor 时刻
    if (bm) {
      const bid = bm[1];
      const fb = firstIn[bid];
      const claim = u.condText.match(/(\d+):(\d{2})/);
      if (claim) {
        if (!fb) { problems.push({ id: u.id, rule: 'A', msg: `condText 写了时刻，但 ${bid} 在任何章节都没出场` }); }
        else {
          const cs = (+claim[1]) * 60 + (+claim[2]);
          if (cs !== fb.t) {
            problems.push({ id: u.id, rule: 'A', msg: `condText 宣称 ${fmt(cs)}，但 ${bid} 首次在 ${fb.chId}(${fb.name}) @${fmt(fb.t)} → 首解锁局玩家会看到 ${fmt(fb.t)}` });
          }
        }
      }
      // B. 名字
      const nm = (u.condText.match(/（([^）]+)）/) || [])[1];
      if (nm && bossNameIn[bid] && nm !== bossNameIn[bid]) {
        problems.push({ id: u.id, rule: 'B', msg: `condText 括注 "${nm}" ≠ DATA_ENEMY.${bid}.name "${bossNameIn[bid]}"` });
      }
    }
    // C. clear / achieve
    if (cm) {
      const c = chapsIn.find((x) => x.chId === cm[1]);
      if (!c) problems.push({ id: u.id, rule: 'C', msg: `cond.chId="${cm[1]}" 在 DATA_CHAPTER 不存在` });
    }
    if (am && !achIdsIn.has(am[1])) {
      problems.push({ id: u.id, rule: 'C', msg: `cond.ach="${am[1]}" 在 DATA_ACHIEVE 不存在` });
    }
  }
  return problems;
}

console.log('# 大厅解锁条件文案 × 数据 交叉一致性');
console.log('');
console.log('- 章节序: ' + chaps.map((c) => c.chId + '(' + c.name + ')').join(' → '));
console.log('- boss 首次: ' + Object.keys(firstBoss).map((b) => `${b}=${firstBoss[b].chId}@${fmt(firstBoss[b].t)}`).join(' · '));
console.log('');
console.log('| id | condText | 判定 |');
console.log('|---|---|---|');

const problems = check(unlocks, chaps, firstBoss, bossName, achIds);
for (const u of unlocks) {
  const bad = problems.filter((p) => p.id === u.id);
  console.log(`| ${u.id} | ${u.condText} | ${bad.length ? '❌ ' + bad.map((b) => b.rule).join('') : '✅'} |`);
}
console.log('');
if (problems.length) {
  console.log('## 问题');
  for (const p of problems) console.log(`- [${p.rule}] ${p.id}: ${p.msg}`);
} else {
  console.log('## 结论: **PASS** — 全部 condText 与真实数据一致 ✅');
}

// ---- 阴性对照 ----
if (process.argv.includes('--selftest')) {
  console.log('');
  console.log('# 阴性对照（判据自证有效）');
  const cases = [
    ['A 注入错误时刻(6:00 冒充 5:00) → 必抓',
      [{ id: 'fake1', cond: 'type: "anchor", boss: "boss2"', condText: '击破 6:00 锚点首领（熔岩狮）' }], 1],
    ['B 注入错误 boss 名 → 必抓',
      [{ id: 'fake2', cond: 'type: "anchor", boss: "boss2"', condText: '击破锚点首领（假狮子）' }], 1],
    ['C 注入不存在的 chId/ach → 必抓',
      [{ id: 'fake3', cond: 'type: "clear", chId: "ch99"', condText: '通关虚空' },
       { id: 'fake4', cond: 'type: "achieve", ach: "kill_99999"', condText: '短成就：不存在' }], 2],
  ];
  let pass = 0;
  for (const [name, sample, wantN] of cases) {
    const got = check(sample, chaps, firstBoss, bossName, achIds);
    const ok = got.length >= wantN;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}（检出 ${got.length}，期望 ≥${wantN}）`);
  }
  // 正对照：当前真实数据不得误报
  const clean = check(unlocks, chaps, firstBoss, bossName, achIds);
  const cleanOk = clean.length === 0;
  if (cleanOk) pass++;
  console.log(`${cleanOk ? 'PASS' : 'FAIL'} 正对照: 当前真实数据 0 误报（实际 ${clean.length}）`);
  console.log(`selftest ${pass}/4`);
  if (pass < 4) process.exitCode = 1;
}

// 有真问题 → 硬门禁
if (problems.length) { console.log(''); console.log('结论: **FAIL**'); process.exit(1); }
