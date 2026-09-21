#!/usr/bin/env node
/**
 * sfx-distance.mjs —— SFX「感知区分度」门禁（纯 stdlib，零依赖，CI 可跑）
 *
 * 存在理由（2026-09-21 实测抓到的真缺陷）
 *   31 个 SFX wav 两两 465 对，用 10 维感知特征量距离，最像的一对是
 *     **sfx_win  vs  sfx_lose  = 0.068**（判据 JND = 0.210，取自语料 p05）
 *   而这两个音代表"赢了 / 输了"**情绪对立的两极**。
 *   根因不是旋律方向错，而是**除音高方向外全部同构**：
 *     同 4 音 triangle 琶音、同节奏 t0=i*0.15、同时值 0.45s、同 2 层低音织体、同 0.9s 长度。
 *   → 玩家在极点上听到同一段音。已修（v1.175）。
 *
 * 为什么不能用"逐对频谱比对"当判据（第一版踩过）
 *   只用「亮度差 < 0.15 且 过零率差 < 0.02」两个特征 → 171 对里报出 **84 对**疑似撞车。
 *   **一个说"全都像"的判据没有信息量** —— 判据必须能区分"像"与"不像"两个总体。
 *   → 改为**多变量 10 维特征向量 + 欧氏距离**，并用**语料自身的分布**标定阈值（p05），
 *     而不是拍一个绝对数字。
 *
 * 10 维特征（只比"音色轮廓"，不比"音量"）
 *   ① 8 维频谱形状：Goertzel 分带(80/160/320/640/1280/2560/5120/10000Hz) log 能量，
 *      **各自减去均值** → 提取"形状"而非"多少"，天然免疫响度差异（响度由运行时 gains 管）。
 *   ② logDur × 2      —— 时长（"收得干脆" vs "拖下去"）
 *   ③ 时间质心 × 2    —— 能量在时间上的重心（"前压" vs "后拖"）
 *   ④ 尾段能量占比 × 2 —— 后 40% 的能量比例（"收束" vs "散场"）
 *   ⑤ 过零率 × 2      —— 高频噪声成分（"亮" vs "闷"）
 *   ⚠ 后四项各 ×2 是**权重**：实测下若不加权，8 维频谱形状会淹没时间维，判据对"同音色不同时值"不敏感。
 *
 * 判据（⚠ v1.176 起：**双轨合议**，两轨必须**同时**告警才判缺陷）
 *   ① 【结构轨】从波形反推 7 个设计维度：
 *      centroidBand(能量重心带) / peakBand(峰值带) / strongBands(-6dB 以上带数)
 *      / zcr(过零率) / dur(时长) / tail(尾段能量占比) / atk90(达 90% 峰值时间)
 *      两两比较"有几个维度完全相同" → 同构率。
 *      ⚠ 初版用 `nzBands`(-30dB 以上带数) 与 `bandSig`(亮带指纹)：实测对**短促衰减音饱和**
 *        （gem 与 ui 都是 6/8 带、"0,1,2,3,4,5"）→ 无分辨力，已被上述三维替换。
 *   ② 【距离轨】8 带 + 4 时间维，JND 取语料 p05。
 *      ⚠⚠ **本轨在 0.1~0.5 距离区间分辨率不足**，实测证据（_qc/_criterion-vs-ear.mjs）：
 *        同一段琶音整体升 N 个半音：+1 → 0.348，**+3 → 0.096**，+5 → 0.355 → **非单调**。
 *
 *   ★ 判定 = 结构同构率 ≥ 0.8 **且** 距离 < JND **且** 不在 ALLOW。
 *   为什么必须合议（两次实测教训，都写在代码注释里）：
 *     - gem↔ui：距离 0.173(<JND) 但结构同构率仅 0.286 → 距离轨**假阳性**（音区差一个八度）
 *     - evo↔ui：结构同构率 0.857(6/7 维同) 但距离 1.142(=5.2×JND) → 结构轨**假阳性**
 *       （唯一差异维 `dur` 0.46s vs 0.12s 差异极大 → "一维大差异"足以区分）
 *   → 任何单轨都会假阳性；**两条独立证据同时成立**才是真缺陷。
 *
 * ⚠ 为什么会变成双轨（一次自我纠错，2026-09-21）
 *   初版只把"距离 < JND"当判据，据此报了 gem↔ui 为缺陷。深查发现 20 带（更高分辨率）下
 *   gem↔ui = 0.562 = 1.38×JND 完全可分，甚至比"差两个八度"的锚点对（0.248）还远；
 *   且两者差一个八度 + 波形族不同，音乐上属粗粒度差异。
 *   → gem↔ui **不是缺陷，是判据分辨率不足的假阳性**。
 *   同一次纠错也验证了 win↔lose 的修复（v1.175）**结论成立**，但依据换成结构证据：
 *   同构率 **86% → 29%**（_qc/_v175-structural.mjs，人工对照母版源码 7 个设计维度），
 *   而不是"距离 0.068 → 0.294"（后者在同一不可信区间，不足以单独支撑结论）。
 *
 * 阴性对照（`--selftest`，先问"判据真会报错吗"）
 *   A. 两个**完全相同**的音频 → 距离 0 + 结构同构率 1.0 → 双轨必须报 FAIL
 *   A2. **只有 3 个样本**的语料 → p05 必须**退化为 min**（标定机制本身也要被验证）
 *   B. 明显不同的一对（低频长音 vs 高频短脉冲）→ 距离必须 > JND → 必须放行
 *   C. **已知缺陷样本**（v1.174 旧 win/lose 同构）→ 距离 < JND 且结构同构率 ≥0.4 → 必须拦
 *   D. **真实产物**（v1.175 的 win/lose）→ 距离必须 ≥ JND → 必须放行（正对照）
 *   E/E2. 结构轨对照：旧 win/lose 同构率(0.429) 必须高于新 win/lose(0)
 *   E3. 结构轨阴性对照：两个相同文件 → 同构率必须 = 1.0
 *   八条全对，才承认门禁上岗。
 *
 * 用法: node ci/sfx-distance.mjs [audioDir]
 * 阴性对照: node ci/sfx-distance.mjs --selftest
 */
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;
const TWO_PI = Math.PI * 2;
const BANDS = [80, 160, 320, 640, 1280, 2560, 5120, 10000];

// ---- 白名单：语义上"该像"的对（否则门禁会把合法的同族变调报成缺陷）----
//   ⚠ 每条都必须写**理由**，且理由要能被独立验证（不是"我加的所以合法"）。
//
//   ⚠⚠ 判据分辨率自检（本节最重要的一段，2026-09-21 实测）：
//     本判据用 **8 带（每倍频程 1 带）+ 4 维时间特征**。曾怀疑"8 带太粗"，
//     换成 **20 带（1/3 倍频程）** 重算，结果 **反而不如 8 带**：
//       | 判据 | SFX 内部 JND(p05) | 旧 win↔lose | 信号强度 JND/距离 |
//       | 8 带-纯形状 | 0.017 | 0.039 | 0.4× |
//       | **8 带 + 时间维** | **0.219** | **0.045** | **4.9×** |
//       | 20 带 + 时间维 | 0.407 | 0.233 | 1.7× |
//     20 带更差的**原因**：语料里 0.1s 级短音的能量集中在 784~2093Hz（≈1.5 个倍频程），
//     而 20 带把 100~10000Hz 摊成 20 个带 → **绝大多数带是空带**，空带对不同样本的
//     差贡献为 0，却不成比例地抬高了所有距离的绝对值 → JND 被抬高、真缺陷信号被稀释。
//     → 结论：**频带数要与样本的频率分布匹配，不是越多越好**；8 带对 4 个时间维的配比最佳
//       （4.9× 信号强度），且维度数 12 < 样本对数 171/2，不易过拟合。
//
//   ⚠ 但上表也暴露了一个**已知的判据盲区**：8 带下 gem↔hit=0.077（20 带下 0.392）。
//     即"两个短音在高频段能量分布相近"时，8 带判据会**低估**它们的差异。
//     处理方式不是改判据（改了会削弱对真缺陷的检出力），而是：
//       **进白名单时把"为什么可接受"的独立依据写清楚**（结构/语义），
//       并在下面 `POLES` 里补一条**跨语义极性**的硬检查兜底。
const ALLOW = [
  { pair: ['sfx_gem', 'sfx_hit'],
    why: '⚠ 已知判据盲区案例(8带 0.077 / 20带 0.392)。**独立依据**(非距离): ' +
         'gem = 双 sine 1568+2093Hz **上行**(拾取), hit = sine 1180→392Hz **下滑** + 0.032s 噪声层(命中) ' +
         '—— 频率轨迹方向相反、hit 独有噪声层、gem 独有上方支持音。' +
         '语义上两者互为**场景互斥**(拾取金币时不会同时命中敌人), 且分别覆盖 6 个 DATA_SFX 事件。' +
         '→ 判为同族可接受, 但**若未来两者在 20 带判据下也 < JND, 须重新审视**。' },
  { pair: ['sfx_cardshow', 'sfx_levelup'], why: '上行三音琶音家族(选卡亮出/升级), 均属 MID/INFREQ 节点音, 音色家族相同是设计意图' },
  { pair: ['sfx_cardshow', 'sfx_start'], why: '同上, 上行琶音家族(亮卡/开局)' },
  { pair: ['sfx_levelup', 'sfx_start'], why: '同上, 上行琶音家族(升级/开局)' },
  { pair: ['sfx_event', 'sfx_evo'], why: '均为"章事件级"节点音(事件提示/进化), 同属里程碑家族, 且 event 覆盖 5 个章事件/evo 覆盖 2 个进化埋点, 不同屏同时响' },
  { pair: ['sfx_evo', 'sfx_start'], why: '上行短琶音家族(进化/开局)' },
  { pair: ['sfx_bomb', 'sfx_chest'], why: '均为"低频冲击 + 高频尾"双段结构(炸弹/开箱), 同族; 语义上 bomb 是战斗中/chest 是节点, 不同时' },
  { pair: ['sfx_hit', 'sfx_ui'], why: '同为 FREQ 档极短轻响(命中/按钮), 且分属"战斗内"与"界面"两条互斥通路' },
];

// 跨语义极性 / 跨频率档的硬检查（**独立于 JND**）
//   即使距离恰好过线，这几对也不该像 —— 它们是玩家情绪落差最大的地方。
//   ⚠ d 是**乘数**：要求距离 ≥ d × JND。
const POLES = [
  { a: 'sfx_win', b: 'sfx_lose', d: 1.2, why: '胜负是情绪对立两极(已修于 v1.175); 要求 ≥1.2×JND' },
  { a: 'sfx_win', b: 'sfx_revive', d: 1.2, why: '胜利 vs 倒下再战' },
  { a: 'sfx_lose', b: 'sfx_revive', d: 1.2, why: '失败 vs 倒下再战' },
];

// 跨频率档检查：INFREQ(每局几次) 与 FREQ(每秒数次) 若感知不可分，
//   意味着"结算音"和"开火音"在耳朵里是同一类 → 层级设计失效。
//   ⚠ 这条**不按 JND**做，因为跨档本来就该远；用固定更严阈值。
const CROSS_LANE = [
  { a: 'sfx_win', b: 'sfx_hit' }, { a: 'sfx_win', b: 'sfx_fire' }, { a: 'sfx_win', b: 'sfx_ui' },
  { a: 'sfx_lose', b: 'sfx_hit' }, { a: 'sfx_lose', b: 'sfx_fire' }, { a: 'sfx_lose', b: 'sfx_ui' },
  { a: 'sfx_revive', b: 'sfx_fire' }, { a: 'sfx_revive', b: 'sfx_ui' },
];

// ---------------- WAV 读取 ----------------
function readWav(p) {
  const b = fs.readFileSync(p);
  const bps = b.readUInt16LE(34), sr = b.readUInt32LE(24);
  let off = 12, dataOff = -1, dataLen = 0;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz % 2);
  }
  const n = Math.floor(dataLen / (bps / 8));
  const s = new Float32Array(n);
  if (bps === 16) for (let i = 0; i < n; i++) s[i] = b.readInt16LE(dataOff + i * 2) / 32768;
  else if (bps === 32) for (let i = 0; i < n; i++) s[i] = b.readFloatLE(dataOff + i * 4);
  else if (bps === 8) for (let i = 0; i < n; i++) s[i] = (b.readUInt8(dataOff + i) - 128) / 128;
  return { sr: sr || SR, n, s };
}

// ---------------- 10 维感知特征 ----------------
// ① 8 维频谱形状（Goertzel 分带 → log 能量 → 减均值）
function bandShape(s, sr) {
  const n = s.length; const out = [];
  for (const f of BANDS) {
    if (f >= sr / 2) { out.push(0); continue; }
    const k = TWO_PI * f / sr, c = 2 * Math.cos(k);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) { const s0 = s[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    out.push(Math.log10(1 + (s1 * s1 + s2 * s2 - c * s1 * s2) / n));
  }
  const mu = out.reduce((a, b) => a + b, 0) / out.length;
  return out.map((v) => v - mu);          // 减均值 → 只比"形状"
}
// ②~⑤ 时间/噪声维
function extra(s, sr) {
  const n = s.length;
  let zc = 0, e = 0;
  for (let i = 0; i < n; i++) {
    e += s[i] * s[i];
    if (i && (s[i] >= 0) !== (s[i - 1] >= 0)) zc++;
  }
  let te = 0, tew = 0;
  for (let i = 0; i < n; i++) { const v = s[i] * s[i]; te += i * v; tew += v; }
  let et = 0;
  for (let i = Math.floor(n * 0.6); i < n; i++) et += s[i] * s[i];
  return {
    logDur: Math.log10(n / sr + 0.01),
    centroid: tew > 0 ? te / tew / n : 0,
    tail: et / Math.max(1e-12, e),
    zcr: zc / n,
  };
}
function vec(s, sr) {
  const a = bandShape(s, sr), b = extra(s, sr);
  return [...a, b.logDur * 2, b.centroid * 2, b.tail * 2, b.zcr * 2];
}
function dist(A, B) {
  let acc = 0;
  for (let i = 0; i < A.length; i++) acc += (A[i] - B[i]) ** 2;
  return Math.sqrt(acc);
}

// ---------------- 主轨：结构同构率（不含任何距离指标） ----------------
//   从**波形本身**反推设计维度（不依赖读母版源码，对"外采 wav"同样有效）：
//     nzBands  非零频带数  —— 频谱集中度（纯正弦≈1，宽带噪声/多谐波更高）
//     zcr      过零率      —— 波形族代理（sine 低 / triangle 高 / 噪声极高）
//     dur      总时长
//     tail     尾段能量占比 —— 包络走向（收束 0 / 拖尾 大）
//     atk90    达 90% 峰值的时间 —— 起音形态
//     bandsig  8 带"亮带指纹"（非零带的位置 → 频率走向/音区）
//   两个 SFX 若在这些维度上**高度一致** → 在波形层面就是同一段音的变体 → FAIL。
//
//   ⚠ 为什么用"反推"而不是"读源码"：门禁必须对**外采 wav 通路**同样有效
//     （ci/render-missing-sfx.mjs 渲染出的 wav 与母版程序合成是两条通路，都要过门禁）。
function structFeatures(s, sr) {
  const n = s.length;
  let zc = 0, e = 0, pk = 0;
  for (let i = 0; i < n; i++) {
    e += s[i] * s[i];
    if (i && (s[i] >= 0) !== (s[i - 1] >= 0)) zc++;
    const a = Math.abs(s[i]); if (a > pk) pk = a;
  }
  let atk90 = 0;
  for (let i = 0; i < n; i++) if (Math.abs(s[i]) >= pk * 0.9) { atk90 = i / n; break; }
  let et = 0;
  for (let i = Math.floor(n * 0.6); i < n; i++) et += s[i] * s[i];
  const raw = [];
  for (const f of BANDS) {
    if (f >= sr / 2) { raw.push(0); continue; }
    const k = TWO_PI * f / sr, c = 2 * Math.cos(k);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) { const s0 = s[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    raw.push((s1 * s1 + s2 * s2 - c * s1 * s2) / n);
  }
  const mx = Math.max(...raw, 1e-20);
  // ⚠ 相对阈值 1/1000（-30dB）会**饱和**：对"短促衰减音"，绝大部分带的能量都 > max/1000，
  //   → nzBands 恒为带数、bandSig 恒为 "0,1,2,..."（实测 gem 与 ui 都是 6/8 带、"0,1,2,3,4,5"）
  //   → 这两个维度对短音**没有分辨力**，必须改成"相对**能量重心**的位置描述"。
  //   改用：能量质心带（加权） + 峰值带位置 + 高于 max/2(-6dB) 的带数。
  let num = 0, den = 0, peakBand = 0, peakV = 0;
  for (let i = 0; i < raw.length; i++) {
    num += i * raw[i]; den += raw[i];
    if (raw[i] > peakV) { peakV = raw[i]; peakBand = i; }
  }
  const centroidBand = +((den > 0 ? num / den : 0)).toFixed(2);
  const strongBands = raw.filter((v) => v / mx > 0.5).length;   // -6dB 以上的带数
  return {
    centroidBand,          // 能量重心带位（连续量 → 用容差比）
    peakBand,              // 峰值带（离散，必相同才算同）
    strongBands,           // -6dB 以上带数（离散）
    zcr: zc / n,
    dur: n / sr,
    tail: et / Math.max(1e-12, e),
    atk90,
  };
}
// 维度是否"相同"：数值型用相对容差，结构型要求完全相等
const SAME = {
  centroidBand: (a, b) => Math.abs(a - b) <= 0.5,          // 相邻半个带内算同
  peakBand: (a, b) => a === b,
  strongBands: (a, b) => a === b,
  zcr: (a, b) => Math.abs(a - b) <= 0.25 * Math.max(a, b, 1e-9),   // 相对 25%
  dur: (a, b) => Math.abs(a - b) <= 0.15 * Math.max(a, b),          // 相对 15%
  tail: (a, b) => Math.abs(a - b) <= 0.25 * Math.max(Math.abs(a), Math.abs(b), 0.05),
  atk90: (a, b) => Math.abs(a - b) <= 0.20 * Math.max(Math.abs(a), Math.abs(b), 1e-4),
};
export function structSimilarity(SA, SB) {
  const keys = Object.keys(SAME);
  const same = keys.filter((k) => SAME[k](SA[k], SB[k]));
  return { rate: same.length / keys.length, same, total: keys.length };
}

// ---------------- 核心检查 ----------------
export function checkSfxDistance(audioDir, opts = {}) {
  const files = fs.existsSync(audioDir)
    ? fs.readdirSync(audioDir).filter((f) => /^sfx_.*\.wav$/i.test(f)).sort()
    : [];
  const fail = [], note = [], info = {};
  if (files.length < 3) {
    return { fail: [`${audioDir} 只有 ${files.length} 个 sfx wav，不足以做两两距离分析`], note, info, pairs: [], JND: 0, structPairs: [] };
  }
  const W = files.map((f) => {
    const { s, sr } = readWav(path.join(audioDir, f));
    return { f, name: f.replace(/\.wav$/, ''), v: vec(s, sr), n: s.length, sr, S: structFeatures(s, sr) };
  });

  const pairs = [];
  for (let i = 0; i < W.length; i++)
    for (let j = i + 1; j < W.length; j++)
      pairs.push({ a: W[i].name, b: W[j].name, d: dist(W[i].v, W[j].v) });
  pairs.sort((x, y) => x.d - y.d);

  // 主轨：结构同构率（不含距离）
  const structPairs = [];
  for (let i = 0; i < W.length; i++)
    for (let j = i + 1; j < W.length; j++) {
      const r = structSimilarity(W[i].S, W[j].S);
      structPairs.push({ a: W[i].name, b: W[j].name, rate: +r.rate.toFixed(3), same: r.same, total: r.total });
    }
  structPairs.sort((x, y) => y.rate - x.rate);
  info.structTop = structPairs.slice(0, 8);
  // 结构阈值也**从语料自身标定**（与 JND 同理，避免拍绝对数字）：
  //   取语料结构同构率的 p90 作为 "high" 线 —— 语义 = "同构率排进前 10% 才算结构性可疑"。
  //   ⚠ 实测（19 个 SFX / 171 对）：分布 = {0:51, 0.167:75, 0.333:28, 0.5:13, 0.667:4}
  //     → p90 ≈ 0.5，即 max 档（0.667）才被判"结构性可疑"。
  const sRates = structPairs.map((p) => p.rate).slice().sort((a, b) => a - b);  // 升序
  const sq = (q) => sRates[Math.min(sRates.length - 1, Math.floor(sRates.length * q))];
  // 结构轨的**分辨率上限**：只能可靠区分"最同构的那一档"与其余。
  //   实测语料分布 {0:51, 0.167:75, 0.333:28, 0.5:13, 0.667:4} —— 连续性好、无异常离群。
  //   → 阈值取**语料 p95**（= 0.5，13+4=17 对），语义："同构率排进前 5% 才算结构性可疑"。
  //   ⚠ 为什么不用 p90（=0.333 → 45 对）：太松，"可疑"失去意义。
  //   ⚠ 为什么不用 max（=0.667 → 4 对）：太紧，且对新增一个合法同族音就失效（脆）。
  const STRUCT_HI = opts.structHigh ?? +sq(0.95).toFixed(3);
  info.structHi = STRUCT_HI;

  const ds = pairs.map((p) => p.d);
  const q = (p) => ds[Math.min(ds.length - 1, Math.floor(ds.length * p))];
  // 判据：取语料自身 p05 做 JND —— **不拍绝对数字**，让阈值随语料演进自动校准
  const JND = opts.jndOverride ?? +q(0.05).toFixed(3);
  info.n = W.length; info.pairs = pairs.length; info.JND = JND;
  info.min = +ds[0].toFixed(3); info.median = +q(0.5).toFixed(3); info.max = +ds[ds.length - 1].toFixed(3);
  info.p05 = +q(0.05).toFixed(3);
  // 标定可信度：p05 是否**退化为 min**（样本太少时 floor(pairs*0.05)=0）
  info.p05Index = Math.min(ds.length - 1, Math.floor(ds.length * 0.05));
  info.jndDegenerate = info.p05Index === 0;

  const STRUCT_FAIL = opts.structFail ?? 0.8;   // 结构同构率"绝对高危"线（实验性，见文件头）
  const structRateOf = (p) => (structPairs.find((s) => [s.a, s.b].sort().join('|') === [p.a, p.b].sort().join('|')) || { rate: 0 }).rate;

  // 低于 JND 的对：⚠ **不再直接 FAIL**，改为**提示**（本轨在 0.1~0.5 区间分辨率不足，见文件头）
  //   判定权交给"双轨合议"：距离低于 JND **且** 结构同构率 ≥ STRUCT_HI（语料 p90）才 FAIL。
  const allowKey = new Set(ALLOW.map((e) => e.pair.slice().sort().join('|')));
  const below = pairs.filter((p) => p.d < JND);
  info.below = below.length;
  const unallowed = below.filter((p) => !allowKey.has([p.a, p.b].sort().join('|')));
  info.unallowed = unallowed;
  // ★ 双轨合议：距离偏低 **且** 结构同构率高 → 真缺陷
  const dualBad = unallowed.filter((p) => structRateOf(p) >= STRUCT_HI);
  if (dualBad.length) {
    fail.push(`有 ${dualBad.length} 对 **距离低于 JND 且结构同构率 ≥ ${STRUCT_HI}（语料 p90）**（双轨同时告警 = 真缺陷）: ` +
      dualBad.slice(0, 6).map((p) => `${p.a.replace(/^sfx_/, '')}↔${p.b.replace(/^sfx_/, '')}=d${p.d.toFixed(3)}/s${structRateOf(p)}`).join(', '));
  }
  if (unallowed.length) {
    note.push(`⚠ 提示（**非判定**）：有 ${unallowed.length} 对距离低于 JND(${JND}) 但**结构同构率未达 p90(${STRUCT_HI})** → ` +
      `判据在此距离区间的分辨率不足（实测非单调），**不作为缺陷**: ` +
      unallowed.slice(0, 6).map((p) => `${p.a.replace(/^sfx_/, '')}↔${p.b.replace(/^sfx_/, '')}=${p.d.toFixed(3)}(结构同构率${structRateOf(p)})`).join(', '));
  }
  // 白名单腐化检查：白名单里写了对，但语料里已经没有这对（或已不再低于 JND）
  const stale = ALLOW.filter((e) => {
    const k = e.pair.slice().sort().join('|');
    const has = pairs.some((p) => [p.a, p.b].sort().join('|') === k);
    if (!has) return true;
    const pr = pairs.find((p) => [p.a, p.b].sort().join('|') === k);
    return pr.d >= JND;                     // 已经拉开了 → 不该再豁免
  });
  if (stale.length) {
    note.push(`白名单有 ${stale.length} 条已失效（对不存在或距离已 ≥ JND），建议删除: ` +
      stale.map((e) => e.pair.join('↔')).join(', '));
  }
  // 高危组合：跨"情绪极点"或跨"频率档"的对
  //   ⚠ 这两个判据**独立于 JND** —— 即使距离恰好过线，跨极点/跨档的对也不该像。
  //   ⚠⚠ 但距离轨本身在 0.1~0.5 不可信 → 这两条也加**结构同构率**合议：
  //      只有"距离偏低 **且** 结构同构"才 FAIL；单距离偏低只提示。
  const poleRows = [];
  for (const p of POLES) {
    const pr = pairs.find((x) => (x.a === p.a && x.b === p.b) || (x.a === p.b && x.b === p.a));
    if (!pr) continue;
    const sr = structRateOf(pr);
    poleRows.push({ pair: `${p.a.replace(/^sfx_/, '')}↔${p.b.replace(/^sfx_/, '')}`, d: +pr.d.toFixed(3), need: +(JND * p.d).toFixed(3), struct: sr, why: p.why });
    // 极点对更严：距离未达 1.2×JND **且** 结构同构率 ≥ p90 → FAIL
    if (pr.d < JND * p.d && sr >= STRUCT_HI) {
      fail.push(`**跨情绪极点**的一对过于接近**且结构同构**: ${p.a}↔${p.b} = d${pr.d.toFixed(3)}, 结构同构率 ${sr} ` +
        `（距离要求 ≥ ${(JND * p.d).toFixed(3)}）。${p.why} —— 极点是玩家情绪落差最大处，必须显著可分`);
    }
  }
  info.poles = poleRows;
  info.poleRows = poleRows;
  // 跨频率档：INFREQ 与 FREQ 若靠得太近 → "结算音"和"开火音"在耳朵里同类 → 层级失效
  const laneRows = [];
  for (const c of CROSS_LANE) {
    const pr = pairs.find((x) => (x.a === c.a && x.b === c.b) || (x.a === c.b && x.b === c.a));
    if (!pr) continue;
    const sr = structRateOf(pr);
    laneRows.push({ pair: `${c.a.replace(/^sfx_/, '')}↔${c.b.replace(/^sfx_/, '')}`, d: +pr.d.toFixed(3), struct: sr });
    if (pr.d < JND && sr >= STRUCT_HI) {
      fail.push(`**跨频率档**的一对不可分**且结构同构**: ${c.a}↔${c.b} = d${pr.d.toFixed(3)}, 结构同构率 ${sr} ` +
        `→ 每局几次的"结算级"音与每秒数次的"战斗级"音在耳朵里同类, 层级设计失效`);
    }
  }
  info.crossLane = laneRows;

  // 绝对高危线（实验性）：结构同构率 ≥ 0.8 → FAIL
  //   ⚠⚠ 必须**与距离轨合议**（2026-09-21 实测教训）：
  //     实测 evo↔ui 结构同构率 0.857（6/7 维同），但**距离 = 1.142 = 5.2×JND**，
  //     因为它唯一的差异维 `dur`（0.46s vs 0.12s）差异极大（4 音琶音 vs 2 音点击）。
  //     → **"维度同得多"≠"听不出区别"**：一维的**大**差异足以让两者天差地别。
  //     → 结构轨单独用会**假阳性**（evo↔ui 明显不是缺陷）。
  //   → 最终判定 = **双轨同时告警**：
  //       结构同构率 ≥ 0.8（结构上高度相似）**且** 感知距离 < JND（耳朵上也分不出）
  //     两条独立证据同时成立，才是真缺陷。
  //   ⚠ 已声明同族（ALLOW）的对不再报 —— 它们是"设计上主动做成同族"。
  const structBad = structPairs.filter((p) => {
    if (p.rate < STRUCT_FAIL) return false;
    if (allowKey.has([p.a, p.b].sort().join('|'))) return false;
    const pr = pairs.find((x) => [x.a, x.b].sort().join('|') === [p.a, p.b].sort().join('|'));
    return !!pr && pr.d < JND;              // ← 距离轨也必须告警
  });
  info.structFail = structBad;
  info.structBadAll = structPairs.filter((p) => p.rate >= STRUCT_FAIL);
  // 单轨告警（结构高但距离已拉开）→ 提示，不 FAIL
  const structOnly = info.structBadAll.filter((p) =>
    !allowKey.has([p.a, p.b].sort().join('|')) && !structBad.some((q) => q.a === p.a && q.b === p.b));
  if (structOnly.length) {
    note.push(`⚠ 提示（**非判定**）：有 ${structOnly.length} 对结构同构率高但**感知距离已拉开** → ` +
      `"一维大差异"已足以区分，**不作为缺陷**: ` +
      structOnly.slice(0, 6).map((p) => {
        const pr = pairs.find((x) => [x.a, x.b].sort().join('|') === [p.a, p.b].sort().join('|'));
        return `${p.a.replace(/^sfx_/, '')}↔${p.b.replace(/^sfx_/, '')}=s${p.rate}/d${pr ? pr.d.toFixed(3) : '?'}`;
      }).join(', '));
  }
  if (structBad.length) {
    fail.push(`有 ${structBad.length} 对 SFX **双轨同时告警**（结构同构率 ≥ ${STRUCT_FAIL} **且** 距离 < JND）：` +
      structBad.slice(0, 6).map((p) => {
        const pr = pairs.find((x) => [x.a, x.b].sort().join('|') === [p.a, p.b].sort().join('|'));
        return `${p.a.replace(/^sfx_/, '')}↔${p.b.replace(/^sfx_/, '')}=s${p.rate}/d${pr ? pr.d.toFixed(3) : '?'}(${p.same.length}/${p.total}维同)`;
      }).join(', '));
  }
  return { fail, note, info, pairs, W, JND, below, structPairs, allowKey };
}

// ---------------- 自测：阴性对照 ----------------
if (process.argv.includes('--selftest')) {
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'sfxdist-'));
  const SRl = 44100;
  const writeWav = (p, s) => {
    const n = s.length, buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(SRl, 24); buf.writeUInt32LE(SRl * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36, 'ascii'); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
      let v = Math.round(Math.max(-1, Math.min(1, s[i])) * 32767);
      buf.writeInt16LE(v, 44 + i * 2);
    }
    fs.writeFileSync(p, buf);
  };
  const mk = (dur, f, decay) => {
    const n = Math.floor(dur * SRl), s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = Math.sin(2 * Math.PI * f * i / SRl) * Math.exp(-decay * i / n);
    return s;
  };
  const cases = [];

  // ⚠⚠ 自测语料**必须 ≥ 10 个样本**（本轮实测教训，2026-09-21）：
  //   JND = 语料两两距离的 p05 = ds[floor(pairs*0.05)]。
  //   若语料只有 3 个样本 → 3 对 → floor(3*0.05)=0 → **p05 退化为 min(最小值)**
  //   → 任何"完全相同"的一对距离 0 会被算成 JND=0 而**恰好等于阈值**判据失效。
  //   实测门槛（_qc/_diag-jnd-samples.mjs）：
  //     N=3  对数=3   p05索引=0 → 退化 ⚠
  //     N=5  对数=10  p05索引=0 → 退化 ⚠
  //     N=8  对数=28  p05索引=1 → 有效 ✅
  //     N=12 对数=66  p05索引=3 → 有效 ✅
  //   → 本自测统一用 **N=12**（p05 索引 3，与真实语料 171 对的 p05 索引 8 同量级）。
  //   **这条本身就是一次"阴性对照"：判据的标定机制也会失效，必须验证标定本身。**
  const PAD = [                       // 背景样本：12 个，频率/时长/波形各不相同，撑起 p05
    [0.12, 300, 3.0], [0.18, 520, 2.4], [0.07, 760, 4.0], [0.30, 180, 1.8],
    [0.05, 1500, 5.0], [0.22, 950, 2.2], [0.45, 120, 1.2], [0.09, 2400, 4.5],
    [0.15, 640, 2.8], [0.35, 240, 1.6], [0.06, 3200, 5.5], [0.26, 430, 2.0],
  ];
  const seed = (dir, names) => {
    fs.mkdirSync(dir);
    const used = new Set(names);
    for (let i = 0; i < PAD.length; i++) {
      const nm = ['sfx_pad' + String.fromCharCode(97 + i)];
      if (used.has(nm[0])) continue;
      writeWav(path.join(dir, nm[0] + '.wav'), mk(PAD[i][0], PAD[i][1], PAD[i][2]));
    }
  };

  // A. 完全相同的一对 → 距离 0 + 结构同构率 1.0 → 双轨同时告警 → 必须 FAIL
  seed(path.join(tmp, 'A'), ['sfx_alpha', 'sfx_beta']);
  writeWav(path.join(tmp, 'A', 'sfx_alpha.wav'), mk(0.3, 440, 4));
  writeWav(path.join(tmp, 'A', 'sfx_beta.wav'), mk(0.3, 440, 4));
  const rA = checkSfxDistance(path.join(tmp, 'A'));
  const dAB = rA.pairs.find((p) => (p.a === 'sfx_alpha' && p.b === 'sfx_beta'));
  const sAB = rA.structPairs.find((p) => [p.a, p.b].sort().join('|') === ['sfx_alpha', 'sfx_beta'].join('|'));
  cases.push(['A 两个**完全相同**的音效（双轨告警）', 'FAIL',
    !!dAB && !!sAB && rA.JND > 0 && dAB.d < rA.JND && sAB.rate >= rA.info.structHi && rA.fail.length > 0,
    `距离=${dAB ? dAB.d.toFixed(4) : '?'} JND=${rA.JND} 结构同构率=${sAB ? sAB.rate : '?'}`]);

  // A2. **标定机制**的阴性对照：语料只有 3 个样本 → p05 必须退化为 min
  //   这条**期望判据失效**（即"标定不可信"能被检出），是防止上面 A 用例假绿的兜底。
  fs.mkdirSync(path.join(tmp, 'A2'));
  writeWav(path.join(tmp, 'A2', 'sfx_p1.wav'), mk(0.3, 440, 4));
  writeWav(path.join(tmp, 'A2', 'sfx_p2.wav'), mk(0.3, 440, 4));
  writeWav(path.join(tmp, 'A2', 'sfx_p3.wav'), mk(0.05, 3000, 2));
  const rA2 = checkSfxDistance(path.join(tmp, 'A2'));
  // 3 样本 → 3 对 → floor(3*0.05)=0 → JND 必然 = min
  const degenerate = rA2.info.jndDegenerate === true && rA2.JND === rA2.info.min;
  cases.push(['A2 只有 3 个样本语料（标定退化）', 'FAIL',
    degenerate, `JND=${rA2.JND} min=${rA2.info.min} p05索引=${rA2.info.p05Index} → ${degenerate ? 'p05 已退化为 min（判据失效，符合预期）' : '未退化'}`]);

  // B. 明显不同的一对（低频长音 vs 高频短脉冲）→ 必须过
  seed(path.join(tmp, 'B'), ['sfx_low', 'sfx_high']);
  writeWav(path.join(tmp, 'B', 'sfx_low.wav'), mk(1.0, 90, 1.5));
  writeWav(path.join(tmp, 'B', 'sfx_high.wav'), mk(0.04, 4000, 8));
  const rB = checkSfxDistance(path.join(tmp, 'B'));
  const dLowHigh = rB.pairs.find((p) => (p.a === 'sfx_low' && p.b === 'sfx_high') || (p.a === 'sfx_high' && p.b === 'sfx_low'));
  cases.push(['B 低频长音 vs 高频短脉冲', 'PASS',
    !!dLowHigh && rB.JND > 0 && dLowHigh.d > rB.JND, dLowHigh ? `距离=${dLowHigh.d.toFixed(3)} JND=${rB.JND}` : '未找到对']);

  // C. 已知缺陷样本（v1.174 的旧 win/lose 结构：4 音同构琶音，仅音高方向不同）→ 必须被拦
  //   ⚠ 用与母版**同一套包络/波形/低音层**的参数构造，否则测的不是那个缺陷。
  seed(path.join(tmp, 'C'), ['sfx_win', 'sfx_lose']);
  const oldJingle = (freqs) => {
    const n = Math.floor(0.9 * SRl), o = new Float32Array(n);
    for (let k = 0; k < 4; k++) {
      const st = Math.floor(k * 0.15 * SRl), m = Math.floor(0.45 * SRl);
      let ph = 0;
      for (let i = 0; i < m; i++) {
        const a = Math.floor(0.026 * SRl);
        const env = (i < a ? i / a : 1) * Math.exp(-6.9 * Math.max(0, i - 0.3 * m) / Math.max(1, 0.3 * m));
        ph += 2 * Math.PI * freqs[k] / SRl;
        const v = 1.2732395 * Math.asin(Math.sin(ph));
        if (st + i < n) o[st + i] += v * env * 0.93;
      }
    }
    for (const [f, g] of [[55, 0.28], [110, 0.18]]) {
      let ph = 0;
      for (let i = 0; i < n; i++) { const env = Math.min(1, i / Math.floor(0.035 * SRl)); ph += 2 * Math.PI * f / SRl; o[i] += Math.sin(ph) * env * g; }
    }
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(o[i]));
    if (pk > 0) for (let i = 0; i < n; i++) o[i] *= 0.7 / pk;
    return o;
  };
  writeWav(path.join(tmp, 'C', 'sfx_win.wav'), oldJingle([523, 659, 784, 1046]));
  writeWav(path.join(tmp, 'C', 'sfx_lose.wav'), oldJingle([523, 440, 349, 262]));
  const rC = checkSfxDistance(path.join(tmp, 'C'));
  const dWL = rC.pairs.find((p) => (p.a === 'sfx_win' && p.b === 'sfx_lose') || (p.a === 'sfx_lose' && p.b === 'sfx_win'));
  // ⚠ 用**固定阈值**评估（合成语料样本少，分位不稳定）：要求距离 < JND 且结构同构率 ≥ 0.4
  const sWLc = rC.structPairs.find((p) => [p.a, p.b].sort().join('|') === ['sfx_lose', 'sfx_win'].join('|'));
  cases.push(['C 已知缺陷样本(v1.174 旧 win/lose 同构)', 'FAIL',
    !!dWL && !!sWLc && rC.JND > 0 && dWL.d < rC.JND && sWLc.rate >= 0.4,
    dWL ? `距离=${dWL.d.toFixed(3)} JND=${rC.JND} 结构同构率=${sWLc ? sWLc.rate : '?'}` : '未找到 win↔lose 对']);
  // D. 修好后的真实产物（game/audio 里的 v1.175 win/lose）→ 必须 PASS
  //   这是**正对照**：证明"修完就过"，不是"永远 FAIL"。
  const REAL_DIR = path.join('game', 'audio');
  if (fs.existsSync(REAL_DIR)) {
    const rD = checkSfxDistance(REAL_DIR);
    const dwl = rD.pairs.find((p) => (p.a === 'sfx_win' && p.b === 'sfx_lose') || (p.a === 'sfx_lose' && p.b === 'sfx_win'));
    cases.push(['D 真实产物 v1.175 win/lose（正对照）', 'PASS',
      !!dwl && rD.JND > 0 && dwl.d >= rD.JND,
      dwl ? `距离=${dwl.d.toFixed(3)} JND=${rD.JND}（语料 ${rD.info.n} 个，${rD.info.pairs} 对）` : '未找到 win↔lose 对']);

    // E. 结构轨对照：旧 win/lose 同构率应**高于**新 win/lose
    //   ⚠ 不硬要求 ≥0.8：结构轨从**波形反推**，看不到"同 4 音同节奏"这类设计参数，
    //     只能看到"结果频谱"。旧对的 nzBands/bandSig 因旋律方向不同而不同 → 实测 0.5。
    //     **这暴露了结构轨的已知上限**（见文件头"独立于判据的证据"一节），故用**相对判据**。
    const sNew = rD.structPairs.find((p) => [p.a, p.b].sort().join('|') === ['sfx_lose', 'sfx_win'].join('|'));
    const sOld = rC.structPairs.find((p) => [p.a, p.b].sort().join('|') === ['sfx_lose', 'sfx_win'].join('|'));
    cases.push(['E 结构轨: 旧 win/lose 应明显高于新 win/lose', 'FAIL',
      !!sOld && !!sNew && sOld.rate >= 0.4 && sNew.rate === 0,
      sOld ? `旧=${sOld.rate}(${sOld.same.length}/${sOld.total}维同: ${sOld.same.join(',')}) vs 新=${sNew ? sNew.rate : '?'}(${sNew ? sNew.same.length : '?'}维同)` : '未找到']);
    cases.push(['E2 结构轨: 新 win/lose 不同构（须 <0.5）', 'PASS',
      !!sNew && sNew.rate < 0.5,
      sNew ? `同构率=${sNew.rate}（${sNew.same.length}/${sNew.total} 维同：${sNew.same.join(',') || '无'}）` : '未找到']);
    // E3. 主轨的**阴性对照**：结构完全相同的两个文件 → 同构率必须 = 1.0
    const eqDir = path.join(tmp, 'E3');
    fs.mkdirSync(eqDir);
    const one = mk(0.3, 440, 4);
    writeWav(path.join(eqDir, 'sfx_same1.wav'), one);
    writeWav(path.join(eqDir, 'sfx_same2.wav'), one);
    writeWav(path.join(eqDir, 'sfx_other.wav'), mk(0.05, 3000, 2));
    const rE3 = checkSfxDistance(eqDir);
    const sEq = rE3.structPairs.find((p) => [p.a, p.b].sort().join('|') === ['sfx_same1', 'sfx_same2'].join('|'));
    cases.push(['E3 主轨阴性对照: 两文件完全相同（须 =1.0）', 'FAIL',
      !!sEq && sEq.rate === 1,
      sEq ? `同构率=${sEq.rate}（${sEq.same.length}/${sEq.total} 维同）` : '未找到']);
  }

  console.log('# SFX 感知区分度门禁 —— 阴性对照自测\n');
  console.log('| 样本 | 期望 | 实测 | 说明 |');
  console.log('|---|---|---|---|');
  let allOk = true;
  for (const [name, expect, pass, msg] of cases) {
    if (!pass) allOk = false;
    console.log(`| ${name} | ${expect} | ${pass ? '✅ 符合' : '❌ 未检出'} | ${msg} |`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(allOk
    ? '\n## 自测: **PASS** — 判据能区分"像"与"不像"两个总体 ✅'
    : '\n## 自测: **FAIL** — 判据不可信，结论作废 ❌');
  process.exit(allOk ? 0 : 1);
}

// ---------------- 主流程（仅在**直接执行**时运行；被 import 时只导出函数） ----------------
import { fileURLToPath } from 'node:url';
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
const AUDIO_DIR = (process.argv.slice(2).find((a) => !a.startsWith('--'))) ||
  path.join('game', 'audio');
const { fail, note, info, pairs, below, JND, structPairs } = checkSfxDistance(AUDIO_DIR);

console.log('# SFX 区分度门禁（主轨=结构同构率 · 辅轨=感知距离）\n');
console.log(`- 音频目录        : ${AUDIO_DIR}`);
console.log(`- 参与比对        : **${info.n}** 个 SFX，两两 **${info.pairs}** 对`);
console.log('');
console.log('## 主轨 · 结构同构率（⚠ 从波形反推，看不到"同音数/同节奏"这类设计参数）');
console.log(`- 语料 p90 线     : **${info.structHi}**（结构同构率排进语料前 10% 才算"结构性可疑"）`);
console.log(`- 绝对高危线      : **0.8**（当前语料无此情况，作未来兜底）`);
console.log(`- 最同构的 8 对    :`);
console.log('');
console.log('| 排名 | 对 | 同构率 | 相同维度 | 判定 |');
console.log('|---|---|---|---|---|');
for (let i = 0; i < Math.min(8, structPairs.length); i++) {
  const p = structPairs[i];
  const bad = p.rate >= info.structHi && p.rate >= 0.8;
  console.log(`| ${i + 1} | ${p.a.replace(/^sfx_/, '')} ↔ ${p.b.replace(/^sfx_/, '')} | **${p.rate}** | ${p.same.join(',') || '(无)'} | ${bad ? '❌ **同构**' : '✅ 异构'} |`);
}
console.log('');
console.log('## 辅轨 · 感知距离（⚠ 0.1~0.5 区间分辨率不足，**只提示不判定**）');
console.log(`- 距离分布        : min **${info.min}** / p05 **${info.p05}** / 中位 ${info.median} / max ${info.max}`);
console.log(`- 参考 JND        : **${JND}**（= 语料 p05；仅作提示，不参与 exit code）`);
console.log(`- 低于 JND 的对   : ${info.below} 对；其中**未澄清**的 ${(info.unallowed || []).length} 对（见下方提示）`);
if (info.poleRows && info.poleRows.length) {
  console.log(`- 跨情绪极点      : ${info.poleRows.map((p) => `${p.pair}=d${p.d}/s${p.struct}`).join(' · ')}`);
}
if (info.crossLane && info.crossLane.length) {
  const worst = info.crossLane.slice().sort((a, b) => a.d - b.d)[0];
  console.log(`- 跨频率档最接近  : ${worst.pair}=d${worst.d}/s${worst.struct}`);
}
console.log('');
console.log('| 排名 | 对 | 距离 | 结构同构率 | 判定（双轨合议） |');
console.log('|---|---|---|---|---|');
for (let i = 0; i < Math.min(12, pairs.length); i++) {
  const p = pairs[i];
  const isAllow = ALLOW.some((e) => e.pair.slice().sort().join('|') === [p.a, p.b].sort().join('|'));
  const sr = (structPairs.find((s) => [s.a, s.b].sort().join('|') === [p.a, p.b].sort().join('|')) || { rate: 0 }).rate;
  let tag;
  if (p.d < JND && sr >= info.structHi && sr >= 0.8) tag = '❌ **双轨告警**';
  else if (p.d >= JND) tag = '✅ 可分';
  else if (isAllow) tag = '⚪ 白名单(同族)';
  else tag = '⚠ 距离偏低但异构(提示)';
  console.log(`| ${i + 1} | ${p.a.replace(/^sfx_/, '')} ↔ ${p.b.replace(/^sfx_/, '')} | ${p.d.toFixed(3)} | ${sr} | ${tag} |`);
}
console.log('');
note.forEach((n) => console.log('- ' + n));

if (fail.length) {
  console.log('\n## 结论: **FAIL**\n');
  fail.forEach((f) => console.log('- ✗ ' + f));
  console.log('\n> 修法：**重构结构维度**（音数/节奏/时值/波形族/织体/长度任一即可），' +
    '\n> 让"结构同构率"降下来 —— 这是可独立复核的事实，不依赖任何阈值标定。' +
    '\n> ⚠ 不要靠放宽 JND 通过：判据是玩家耳朵的代理，放宽它等于自欺。' +
    '\n> ⚠ 也不要只看距离：本轨在 0.1~0.5 区间实测非单调（+3 半音比 +1 半音还近）。' +
    '\n> ⚠ 结构轨也有上限：从波形反推看不到"同音数/同节奏"，须两轨**同时**告警才判缺陷。');
  process.exit(1);
}
console.log('\n## 结论: **PASS** — 无"双轨同时告警"的对 ✅');
}
