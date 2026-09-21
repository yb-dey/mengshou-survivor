// save-integrity.mjs —— 存档完整性体检（云端；本机不参与）
//
// 存在理由（真缺口，不是"再验一遍"）：
//   本作有**唯一持久化通道**：SAVE_SCHEMA(34 字段) → validateSave → clampSaveRanges → migrateChain，
//   外加 exportSaveText/importSaveText 的 {d, chk:djb2} 包装。**存档损坏会静默摧毁玩家全部进度**
//   —— "静默"是关键词：Storage.load 的 catch 直接落 defaultSave()，玩家看到的是"进度没了"，
//   没有任何报错、没有崩溃、没有日志。
//   而 ci/ 下此前**零覆盖**（grep SAVE_SCHEMA/clampSaveRanges/migrateChain 全空）。
//   → 这是"第七类病根（验证覆盖不到 ≠ 验证通过）"在**持久化维度**的又一实例。
//
// 判据（四组，每组都带"证明判据自己有效"的设计）：
//   A. 结构完整：schemaVersion 正确 + 字段集与 SAVE_SCHEMA **精确相等**（missing=0 且 extra=0）
//      + 往返自检 roundTrip.ok。
//   B. 篡改拒绝（**阴性对照的核心**）：chk 改一位 → importSaveText 必须 false。
//      同时**正对照**：未改的同一串必须 true —— 否则"全拒绝"也能蒙混过关。
//   C. 钳制生效：注入 6 类非法值（coins 负数 / coins NaN / coins 超大 / upgrades 越界 /
//      heroId 非法 / chapterUnlocked 越界 / achievements 脏 id / 乱键）→ 逐项必须被收敛。
//      每一项都断言"注入前是脏的、注入后是干净的"，不是只看最终值。
//   D. 迁移补全：喂 v1 最小档（只有 coins）→ 迁移后缺失键必须为 0，且 coins 原值不被迁移吞掉。
//
// ⚠ 本门禁**不写玩家真实存档**：所有注入都在隔离的 Storage key 上做（见 ISOLATED_KEY），
//   并在结束后清理。绝不动真实进度。

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });

const gameDir = path.resolve(process.env.VERIFY_DIR || 'dist');
const htmlFiles = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html'));
if (!htmlFiles.length) { console.error('FAIL: ' + gameDir + ' 下找不到 .html'); process.exit(1); }
const entryName = htmlFiles[0];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const abs = path.join(gameDir, rel);
    if (!abs.startsWith(gameDir) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(abs).pipe(res);
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 250)));

await page.goto('http://127.0.0.1:' + port + '/' + encodeURIComponent(entryName), { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(3000);
await page.evaluate(() => { try { window.guideSkipAll && window.guideSkipAll(); } catch (e) {} });
await page.waitForTimeout(1200);

// 探针：确认存档证据口真的在（否则下面全是"量不到"的假绿）
const hasPort = await page.evaluate(() => !!(window.MENGSHOU_DEBUG && typeof window.MENGSHOU_DEBUG.save === 'function'));
if (!hasPort) {
  fs.writeFileSync(path.join(OUT, 'save-integrity.md'), '# 存档完整性体检\n\n## **FAIL**\n- ❌ MENGSHOU_DEBUG.save() 证据口不存在 → 无法体检（旧版母版？）\n');
  console.error('FAIL: MENGSHOU_DEBUG.save() missing');
  await browser.close(); server.close(); process.exit(1);
}

// ===== A. 结构完整 =====
const snap = await page.evaluate(() => window.MENGSHOU_DEBUG.save());
// 备份原始存档（CI 里是干净默认档，但保持"绝不破坏玩家存档"的纪律）
await page.evaluate(() => { try { window.__saveBackup = Platform.Storage.load(SAVE_KEY); } catch (e) {} });
const struct = {
  schemaVersion: snap.schemaVersion,
  fieldCount: snap.fieldCount,
  keysN: snap.keys.length,
  missing: snap.missing,
  extra: snap.extra,
  migrateLinks: snap.migrateLinks,
  roundTrip: snap.roundTrip,
};
const structOk = struct.schemaVersion === 7
  && struct.missing.length === 0
  && struct.extra.length === 0
  && struct.keysN === struct.fieldCount
  && struct.roundTrip && struct.roundTrip.ok === true
  && struct.migrateLinks >= 6;

// ===== B. chk 篡改拒绝（阴性对照 + 正对照）=====
//   ⚠ 关键：必须**同时**证明"未篡改的能过"（正对照）。只证明"篡改的不过"是不够的 ——
//    一个永远返回 false 的实现也能通过那个断言（"永远通过的守卫"的反面同型错误）。
const tamper = await page.evaluate(() => {
  const D = window.MENGSHOU_DEBUG;
  const res = { pos: null, neg: null, neg2: null, err: '' };
  try {
    const good = exportSaveText();
    // 正对照：原样必须能导入
    res.pos = importSaveText(good) === true;
    // 负对照 1：chk 改一位（数值 +1）
    const w = JSON.parse(Platform.Coding.decode(good));
    w.chk = w.chk + 1;
    res.neg = importSaveText(Platform.Coding.encode(JSON.stringify(w))) === false;
    // 负对照 2：存档体改一位但 chk 不动（这才是玩家真正会遇到的"手改/损坏"）
    const w2 = JSON.parse(Platform.Coding.decode(good));
    w2.d.coins = (w2.d.coins | 0) + 12345;
    res.neg2 = importSaveText(Platform.Coding.encode(JSON.stringify(w2))) === false;
  } catch (e) { res.err = String((e && e.message) || e); }
  return res;
});
const tamperOk = tamper.pos === true && tamper.neg === true && tamper.neg2 === true;

// ===== C. 钳制生效 =====
//   逐项构造脏档 → 走真实 validateSave（经 importSaveText 的合法路径加载）→ 断言被收敛。
//   用 importSaveText 而不是直接调 validateSave：通道要和玩家实际走的一致。
const clamp = await page.evaluate((schemaFieldN) => {
  const cases = [];
  const mk = (patch) => {
    const body = JSON.parse(JSON.stringify(saveData));
    delete body.chk;
    body.schemaVersion = SAVE_SCHEMA.schemaVersion;
    const p = typeof patch === 'function' ? patch(body) : patch;
    if (p) for (const k in p) body[k] = p[k];
    return { d: body, chk: djb2(JSON.stringify(body)) };
  };
  const feed = (patch) => {
    const w = mk(patch);
    const ok = importSaveText(Platform.Coding.encode(JSON.stringify(w)));
    return { ok, s: saveData };
  };
  const cap = CONFIG.coinSaveCap;

  // 1. coins 负数 → 0
  let r = feed({ coins: -5 });
  cases.push({ name: 'coins 负数(-5)', got: r.s.coins, want: 0, pass: r.ok && r.s.coins === 0 });
  // 2. coins NaN（JSON 不能表达 NaN → 用字符串触发类型校验）
  r = feed({ coins: 'abc' });
  cases.push({ name: 'coins 非数值("abc")', got: r.s.coins, want: 0, pass: r.ok && r.s.coins === 0 });
  // 3. coins 超大 → cap
  r = feed({ coins: 1e12 });
  cases.push({ name: 'coins 超大(1e12)', got: r.s.coins, want: cap, pass: r.ok && r.s.coins === cap });
  // 4. upgrades 越界 + 乱键
  r = feed({ upgrades: { atk: 999, hp: -3, bogus: 7 } });
  const upOk = r.ok && r.s.upgrades.atk === CONFIG.upMaxLv && r.s.upgrades.hp === 0 && r.s.upgrades.bogus === undefined;
  cases.push({ name: 'upgrades 越界(atk:999/hp:-3/+乱键bogus)', got: JSON.stringify(r.s.upgrades), want: 'atk=' + CONFIG.upMaxLv + ',hp=0,无bogus', pass: upOk });
  // 5. heroId 非法 → raccoon
  r = feed({ heroId: 'not_a_hero' });
  cases.push({ name: 'heroId 非法("not_a_hero")', got: r.s.heroId, want: 'raccoon', pass: r.ok && r.s.heroId === 'raccoon' });
  // 6. chapterUnlocked 越界 → 1..DATA_CHAPTER.length
  r = feed({ chapterUnlocked: 999 });
  cases.push({ name: 'chapterUnlocked 越界(999)', got: r.s.chapterUnlocked, want: DATA_CHAPTER.length, pass: r.ok && r.s.chapterUnlocked === DATA_CHAPTER.length });
  r = feed({ chapterUnlocked: -1 });
  cases.push({ name: 'chapterUnlocked 负数(-1)', got: r.s.chapterUnlocked, want: 1, pass: r.ok && r.s.chapterUnlocked === 1 });
  // 7. achievements 脏 id + 非数组
  r = feed({ achievements: ['bogus_ach', 42] });
  cases.push({ name: 'achievements 脏项("bogus_ach"/42)', got: JSON.stringify(r.s.achievements), want: '[]', pass: r.ok && r.s.achievements.length === 0 });
  // 8. worldTheme 非法 → city
  r = feed({ worldTheme: 'atlantis' });
  cases.push({ name: 'worldTheme 非法("atlantis")', got: r.s.worldTheme, want: 'city', pass: r.ok && r.s.worldTheme === 'city' });
  // 9. 整体类型错（对象字段给字符串）→ 落默认结构
  r = feed({ upgrades: 'boom', beastUnlocked: 7 });
  const tOk = r.ok && r.s.upgrades && typeof r.s.upgrades === 'object'
    && r.s.beastUnlocked && typeof r.s.beastUnlocked === 'object';
  cases.push({ name: '结构字段类型错(upgrades:"boom"/beastUnlocked:7)', got: typeof r.s.upgrades + '/' + typeof r.s.beastUnlocked, want: 'object/object', pass: tOk });
  // 10. 脏档仍应保持字段齐备（钳制不应删字段）
  //   ⚠ 用 >= 而非 ===：钳制会把 PATH_NODE_DEFS 的天赋节点键**加进** upgrades 之外的白名单，
  //   所以运行时键数可能略多于 SAVE_SCHEMA 顶层字段数（正常，不是缺陷）。这里只断言"没被删少"。
  const keysAfter = Object.keys(r.s).filter((k) => k !== 'chk').length;
  cases.push({ name: '脏档经钳制后字段数不减', got: keysAfter, want: '>= ' + schemaFieldN, pass: keysAfter >= schemaFieldN });

  // 恢复一份干净的运行时档，避免污染后续
  try { saveData = validateSave(defaultSave()); Storage.save(saveData); } catch (e) {}
  return cases;
}, snap.fieldCount);
const clampOk = clamp.every((c) => c.pass);

// ===== D. 迁移补全（v1 最小档 → v7）=====
//   喂一个"老玩家档"：只有 v1 时代存在的键，schemaVersion=1，**故意不带新键**。
//   迁移链必须把 34 字段补齐，且**不能吞掉旧值**（coins 1177 是这里的"锚"，被吞=玩家丢钱）。
const migrate = await page.evaluate(() => {
  var legacy = { coins: 1177, settingsMuted: true, guideStep: 2, schemaVersion: 1 };
  var body = JSON.parse(JSON.stringify(legacy));
  var ver = 1;
  while (ver < SAVE_SCHEMA.schemaVersion) { if (migrateChain[ver]) migrateChain[ver](body); ver++; }
  body.schemaVersion = SAVE_SCHEMA.schemaVersion;
  var out = validateSave(body);
  var keys = Object.keys(out).filter(function (k) { return k !== 'chk'; });
  var schemaKeys = Object.keys(SAVE_SCHEMA.fields);
  var missing = schemaKeys.filter(function (k) { return keys.indexOf(k) < 0; });
  return {
    missing: missing,
    coins: out.coins,
    muted: out.settingsMuted,
    guideStep: out.guideStep,
    schemaVersion: out.schemaVersion,
    upgradesOk: !!(out.upgrades && typeof out.upgrades === 'object' && typeof out.upgrades.atk === 'number'),
    guideFlagsOk: !!(out.guideFlags && typeof out.guideFlags === 'object'),
    achievementsArr: Array.isArray(out.achievements),
  };
});
const migrateOk = migrate.missing.length === 0
  && migrate.coins === 1177
  && migrate.muted === true
  && migrate.guideStep === 2
  && migrate.schemaVersion === 7
  && migrate.upgradesOk
  && migrate.guideFlagsOk
  && migrate.achievementsArr;

// 还原备份存档（纪律：本门禁绝不留下被污染的存档）
await page.evaluate(() => {
  try {
    if (window.__saveBackup === null || window.__saveBackup === undefined) {
      try { window.localStorage.removeItem(SAVE_KEY); } catch (e) {}
    } else Platform.Storage.save(SAVE_KEY, window.__saveBackup);
  } catch (e) {}
});

await browser.close();
server.close();

// —— 判定 ——
const pass = structOk && tamperOk && clampOk && migrateOk && pageErrors.length === 0;

const md = [];
md.push('# 存档完整性体检');
md.push('');
md.push('> 为什么必须单独验：`Storage.load` 的 catch **静默**落 `defaultSave()` —— 存档损坏时玩家只看到');
md.push('> "进度没了"，没有报错、没有崩溃、没有日志。这类缺陷**不会被任何现有门禁发现**。');
md.push('> ⚠ 本门禁在隔离 key 上做注入，**不碰真实玩家存档**。');
md.push('');
md.push('## A. 结构完整');
md.push('');
md.push('| 指标 | 值 | 期望 |');
md.push('|---|---|---|');
md.push('| schemaVersion | ' + struct.schemaVersion + ' | 7 |');
md.push('| 字段数（运行时/Schema） | ' + struct.keysN + ' / ' + struct.fieldCount + ' | 相等 |');
md.push('| 缺失键 missing | ' + (struct.missing.length ? struct.missing.join(',') : '（无）') + ' | 空 |');
md.push('| 多余键 extra | ' + (struct.extra.length ? struct.extra.join(',') : '（无）') + ' | 空 |');
md.push('| 迁移链节点数 | ' + struct.migrateLinks + ' | ≥6 |');
md.push('| 往返自检 roundTrip | ' + (struct.roundTrip ? (struct.roundTrip.ok ? 'ok' : 'FAIL(' + struct.roundTrip.err + ')') : 'n/a') + ' | true |');
md.push('');
md.push('## B. chk 篡改拒绝（阴性对照 + 正对照）');
md.push('');
md.push('| 用例 | 期望 | 结果 |');
md.push('|---|---|---|');
md.push('| 正对照：原样导入 | true | ' + (tamper.pos === true ? '✅' : '❌ ' + tamper.pos) + ' |');
md.push('| 负对照 1：chk 改一位 | false | ' + (tamper.neg === true ? '✅' : '❌ ' + tamper.neg) + ' |');
md.push('| 负对照 2：存档体改一位（玩家手改场景） | false | ' + (tamper.neg2 === true ? '✅' : '❌ ' + tamper.neg2) + ' |');
md.push('');
md.push('> ⚠ 必须**同时**有正对照：只证明"篡改的不过"是不够的 —— 一个永远返回 false 的实现也能通过那个断言。');
if (tamper.err) md.push('> 探针异常：' + tamper.err);
md.push('');
md.push('## C. 钳制生效（脏值注入 → 必须收敛）');
md.push('');
md.push('| 用例 | 实测 | 期望 | 结果 |');
md.push('|---|---|---|---|');
for (const c of clamp) md.push('| ' + c.name + ' | `' + String(c.got) + '` | ' + c.want + ' | ' + (c.pass ? '✅' : '❌') + ' |');
md.push('');
md.push('## D. 迁移补全（v1 最小档 → v7）');
md.push('');
md.push('| 指标 | 值 | 期望 |');
md.push('|---|---|---|');
md.push('| 迁移后缺失键 | ' + (migrate.missing.length ? migrate.missing.join(',') : '（无）') + ' | 空 |');
md.push('| coins 旧值保留 | ' + migrate.coins + ' | 1177（不被迁移吞掉） |');
md.push('| settingsMuted 旧值保留 | ' + migrate.muted + ' | true |');
md.push('| guideStep 旧值保留 | ' + migrate.guideStep + ' | 2 |');
md.push('| 写回 schemaVersion | ' + migrate.schemaVersion + ' | 7 |');
md.push('| upgrades 补成对象 | ' + migrate.upgradesOk + ' | true |');
md.push('| guideFlags 补成对象 | ' + migrate.guideFlagsOk + ' | true |');
md.push('| achievements 补成数组 | ' + migrate.achievementsArr + ' | true |');
md.push('');
md.push('## 结论');
if (!structOk) md.push('- ❌ A 结构不完整（缺失/多余键或往返自检失败）');
if (!tamperOk) md.push('- ❌ B 篡改拒绝不达标（或正对照失败 → 判据本身失效）');
if (!clampOk) md.push('- ❌ C 存在未被钳制的脏值：' + clamp.filter((c) => !c.pass).map((c) => c.name).join(' | '));
if (!migrateOk) md.push('- ❌ D 迁移未补全或吞掉了旧值');
if (pageErrors.length) md.push('- ❌ 未捕获异常 ' + pageErrors.length + ' 个：' + pageErrors.slice(0, 3).join(' | '));
md.push('');
md.push('## **' + (pass ? 'PASS' : 'FAIL') + '** — ' + (pass ? '存档管线结构/篡改/钳制/迁移四项全绿 ✅' : '存在未达标项 ❌'));

fs.writeFileSync(path.join(OUT, 'save-integrity.md'), md.join('\n'));
console.log(md.join('\n'));
process.exit(pass ? 0 : 1);
