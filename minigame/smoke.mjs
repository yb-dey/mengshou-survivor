// smoke.mjs — 在 Node 里跑「适配层 + 游戏原脚本」，验证小游戏移植的启动路径
//
// 为什么能在本机跑：小游戏环境本来就是**没有 DOM 的 JS 宿主**，本机用 `node:vm` 造一个沙箱
//   把 `wx` 桩塞进去，就等价于一个最小宿主。全程**不渲染、不开浏览器**（用户要求别让电脑卡）。
//
// 它验什么（这就是"移植成功"的可判定判据）：
//   ① 适配层能在只提供 `wx` 的前提下建起 document/window/Image/… 全局
//   ② 游戏原脚本（4,386,481 字符，一个字节不改）能**跑完初始化不抛异常**
//   ③ `init()` 末尾注册了 requestAnimationFrame 主循环
//   ④ 手动驱动 N 帧，帧函数不抛异常（覆盖渲染路径）
//   ⑤ 输出宿主 API 用量表 —— 可以对照母版实测的适配面，看有没有漏配的 API
//
// 用法:
//   node smoke.mjs            # 初始化 + 1 帧
//   node smoke.mjs --frames 5
//   node smoke.mjs --selftest # 阴性对照：故意抽掉 adapter 的一个映射，必须报 FAIL

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { existsSync, statSync, readdirSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
// 【第 55 轮】仓库位置**自动识别**：本工程现在同时存在于两处 ——
//   仓库内 `mengshou-survivor/minigame/`（权威源，云端 CI 跑它）与工作区 `小游戏移植/`（本地副本）。
//   两种布局下 dist/ 与 game/ 的相对位置不同 ⇒ 按"哪个目录里有 dist/萌兽消消岛.html"来选，避免写死路径。
const REPO = [join(HERE, '..'), join(HERE, '..', 'mengshou-survivor')]
  .find((d) => existsSync(join(d, 'dist', '萌兽消消岛.html')) || existsSync(join(d, 'game', '萌兽消消岛.html')))
  || join(HERE, '..', 'mengshou-survivor')
const SELFTEST = process.argv.includes('--selftest')
const FRAMES = (() => { const i = process.argv.indexOf('--frames'); return i > 0 ? Number(process.argv[i + 1]) : 5 })()

// ── 取出游戏脚本 ───────────────────────────────────────────────────────────
// ⚠ 优先验**构建产物** `game.bundle.js`（那才是要发布的东西）；
//   没有构建过才退回内联母版。验源码不验产物 = 验错了对象。
const BUNDLE = join(HERE, 'game.bundle.js')
let gameCode, gameFrom
if (existsSync(BUNDLE)) {
  gameCode = readFileSync(BUNDLE, 'utf8')
  gameFrom = 'game.bundle.js（构建产物 = 要发布的东西）'
} else {
  const html = readFileSync(join(REPO, 'game', '萌兽消消岛.html'), 'utf8')
  const mm = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!mm) { console.error('❌ 既没有 game.bundle.js，母版里也找不到 <script> 块'); process.exit(1) }
  gameCode = mm[1]
  gameFrom = 'game/萌兽消消岛.html（内联母版 · 未构建）'
}
console.log(`被测脚本来源：${gameFrom}\n`)

// ── 画布 / 2D 上下文 桩 ────────────────────────────────────────────────────
const CTX_METHODS = ['save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
  'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect',
  'fillText', 'strokeText', 'drawImage', 'putImageData', 'setLineDash', 'drawFocusIfNeeded', 'isPointInPath']
// ── 布局占用记录器（--layout）：只算包围盒，不做光栅化 ──────────────────────
// 为什么不做真光栅化：实测 600 帧的绘制普查显示路径类（beginPath/stroke/fill/lineTo/
//   arc/roundRect/ellipse）占约 **23%**，要实现真正的 Canvas2D 路径填充成本过高；
//   而 `drawImage` 37% + `setTransform` 31% + fillRect 0.8% 已经能用"变换 + 包围盒"覆盖。
// 它回答的问题：**屏幕上哪些区域从没被画过 / 哪些带最挤**。
//   项目此前只有**静态坐标扫描**（第 10 轮，靠 grep 字面坐标），这里是**运行时真实绘制调用**，
//   而且带完整变换矩阵 —— 静态扫描看不到 `setTransform` 之后的坐标系。
const LAYOUT = process.argv.includes('--layout')
const BOXES = []
let M = [1, 0, 0, 1, 0, 0]
const M_STACK = []
let PATH_BOX = null
const mulM = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]
const ptM = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]
const N = (v) => (typeof v === 'number' && isFinite(v) ? v : 0)
function pushBox(x, y, w, h, op, t) {
  const p = [ptM(x, y), ptM(x + w, y), ptM(x, y + h), ptM(x + w, y + h)]
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1])
  BOXES.push({ op, t, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
}
function pathAdd(x, y) {
  const q = ptM(x, y)
  PATH_BOX = PATH_BOX
    ? [Math.min(PATH_BOX[0], q[0]), Math.min(PATH_BOX[1], q[1]), Math.max(PATH_BOX[2], q[0]), Math.max(PATH_BOX[3], q[1])]
    : [q[0], q[1], q[0], q[1]]
}
function wrapLayout(c, canvas) {
  const main = () => !!canvas.__isMain
  return new Proxy(c, {
    get(t, k, r) {
      const orig = Reflect.get(t, k, r)
      if (typeof orig !== 'function') return orig
      return function (...a) {
        if (main()) {
          try {
            switch (k) {
              case 'setTransform': M = [N(a[0]), N(a[1]), N(a[2]), N(a[3]), N(a[4]), N(a[5])]; break
              case 'transform': M = mulM(M, [N(a[0]), N(a[1]), N(a[2]), N(a[3]), N(a[4]), N(a[5])]); break
              case 'resetTransform': M = [1, 0, 0, 1, 0, 0]; break
              case 'translate': M = mulM(M, [1, 0, 0, 1, N(a[0]), N(a[1])]); break
              case 'scale': M = mulM(M, [N(a[0]), 0, 0, N(a[1]), 0, 0]); break
              case 'rotate': { const s = Math.sin(N(a[0])), co = Math.cos(N(a[0])); M = mulM(M, [co, s, -s, co, 0, 0]); break }
              case 'save': M_STACK.push(M.slice()); break
              case 'restore': if (M_STACK.length) M = M_STACK.pop(); break
              case 'beginPath': PATH_BOX = null; break
              case 'moveTo': case 'lineTo': pathAdd(N(a[0]), N(a[1])); break
              case 'rect': case 'roundRect': pathAdd(N(a[0]), N(a[1])); pathAdd(N(a[0]) + N(a[2]), N(a[1]) + N(a[3])); break
              case 'arc': case 'ellipse': { const rx = N(a[2]), ry = N(a[3]); pathAdd(N(a[0]) - rx, N(a[1]) - ry); pathAdd(N(a[0]) + rx, N(a[1]) + ry); break }
              case 'arcTo': pathAdd(N(a[0]), N(a[1])); pathAdd(N(a[2]), N(a[3])); break
              case 'quadraticCurveTo': case 'bezierCurveTo': for (const q of a) if (typeof q === 'number') { /* 控制点已在包络内，忽略 */ } break
              case 'fill': case 'stroke': case 'clip':
                if (PATH_BOX) { BOXES.push({ op: String(k), x0: PATH_BOX[0], y0: PATH_BOX[1], x1: PATH_BOX[2], y1: PATH_BOX[3] }); if (k !== 'clip') PATH_BOX = null }
                break
              case 'fillRect': case 'strokeRect': case 'clearRect': pushBox(N(a[0]), N(a[1]), N(a[2]), N(a[3]), String(k)); break
              case 'drawImage': {
                let dx, dy, dw, dh
                if (a.length >= 9) { dx = N(a[5]); dy = N(a[6]); dw = N(a[7]); dh = N(a[8]) }
                else if (a.length >= 5) { dx = N(a[1]); dy = N(a[2]); dw = N(a[3]); dh = N(a[4]) }
                else { dx = N(a[1]); dy = N(a[2]); dw = N(a[0] && a[0].width) || 0; dh = N(a[0] && a[0].height) || 0 }
                pushBox(dx, dy, dw, dh, 'drawImage')
                break
              }
              case 'fillText': case 'strokeText': {
                let w = 10
                try { w = t.measureText(a[0]).width } catch (e) {}
                const mm2 = /(\d+(?:\.\d+)?)px/.exec(t.font || '')
                const sz = mm2 ? Number(mm2[1]) : 10
                // ⚠ 必须尊重 textAlign：居中文本的 x 是**中心**，不是左边缘。
                //   第一版一律当成左边缘 → 把 `fillText(box 720..1952)` 报成"出屏"（画布才 1440 宽），
                //   纯属自建工具的假阳性 —— 差一点把正常布局报成"控件出屏"（审核真会卡的那种）。
                const al = String(t.textAlign || 'start')
                const anchor = al === 'center' ? 0.5 : (al === 'right' || al === 'end' ? 1 : 0)
                pushBox(N(a[1]) - w * anchor, N(a[2]) - sz, w, sz * 1.25, String(k), String(a[0]))
                break
              }
            }
          } catch (e) { /* 记录失败绝不影响游戏 */ }
        }
        return orig.apply(t, a)
      }
    },
  })
}

// 绘制调用普查：给桩加计数器 —— 这决定"若要自己光栅化，该实现哪些 API"
const CALLS = Object.create(null)
const callTotal = () => { let s = 0; for (const k in CALLS) s += CALLS[k]; return s }
function makeCtx(canvas) {
  const c = {
    canvas,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    lineDashOffset: 0, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr',
    shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none',
    imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    measureText(s) {
      const m2 = /(\d+(?:\.\d+)?)px/.exec(c.font || '')
      const size = m2 ? Number(m2[1]) : 10
      // 中文按 1.0 em、其它按 0.55 em 估宽 —— 只为让布局走下去，不追求像素精确
      let w = 0
      for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2e80 ? size : size * 0.55
      return { width: w, actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2 }
    },
    createLinearGradient() { return { addColorStop() {} } },
    createRadialGradient() { return { addColorStop() {} } },
    createConicGradient() { return { addColorStop() {} } },
    createPattern() { return { setTransform() {} } },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } },
    getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) } },
    getLineDash() { return [] },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    drawFocusIfNeeded() {},
  }
  for (const name of CTX_METHODS) if (!(name in c)) c[name] = function () { CALLS[name] = (CALLS[name] || 0) + 1 }
  return LAYOUT ? wrapLayout(c, canvas) : c
}
function makeCanvas() {
  const c = { width: 300, height: 150, style: {}, __isCanvas: true, __ctx: null }
  c.getContext = (t) => (String(t).indexOf('2d') === 0 ? (c.__ctx || (c.__ctx = makeCtx(c))) : null)
  c.addEventListener = function () {}; c.removeEventListener = function () {}
  c.getBoundingClientRect = () => ({ left: 0, top: 0, right: c.width, bottom: c.height, width: c.width, height: c.height })
  c.toDataURL = () => 'data:image/png;base64,'
  c.requestAnimationFrame = () => 0
  return c
}
// 图片桩：**读真实文件、解真实尺寸**。
//   ⚠ 早期版本永远返回 128x128 的假图 —— 于是「游戏跑通了」完全**没有**验证素材是否加载。
//     这与音频那次是同一类：**静默降级**（缺图时母版回落程序化剪影，不报错、但画面全变了）。
const IMG = { loaded: 0, failed: 0, bytes: 0, sizes: new Map(), missing: [] }
const NOASSETS = process.argv.includes('--no-assets')   // 阴性对照：把所有素材读成缺失
function makeImage() {
  const img = { width: 0, height: 0, complete: false, crossOrigin: null, __isImage: true, onload: null, onerror: null }
  let src = ''
  Object.defineProperty(img, 'src', {
    get() { return src },
    set(v) {
      src = v
      setTimeout(() => {
        try {
          if (NOASSETS) throw new Error('阴性对照：素材一律视为缺失')
          const rel = String(v).replace(/^\.?\//, '')
          const p = join(HERE, rel)
          if (!existsSync(p)) throw new Error('缺文件 ' + rel)
          const st = statSync(p)
          const buf = readFileSync(p)
          const m = readImageSize(buf)
          img.width = m.w; img.height = m.h
          if (!img.width || !img.height) throw new Error('尺寸为 0: ' + rel)
          img.complete = true
          IMG.loaded++; IMG.bytes += st.size
          const k = `${img.width}x${img.height}`
          IMG.sizes.set(k, (IMG.sizes.get(k) || 0) + 1)
          if (typeof img.onload === 'function') img.onload({ target: img })
        } catch (e) {
          IMG.failed++; IMG.missing.push(String(v) + ' :: ' + e.message)
          if (typeof img.onerror === 'function') img.onerror({ target: img })
        }
      }, 0)
    },
  })
  img.addEventListener = function (t, f) { if (t === 'load') img.onload = f }
  img.removeEventListener = function () {}
  return img
}
// 只读文件头取尺寸：WebP(VP8/VP8L/VP8X) / PNG / GIF / JPEG 都覆盖
function readImageSize(b) {
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = b.toString('ascii', 12, 16)
    if (fmt === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
    if (fmt === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
    if (fmt === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (b.length > 10 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue }
      const mk = b[i + 1]
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
      }
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return { w: 0, h: 0 }
}
const AUDIO = { ctx: 0, createOscillator: 0, createBufferSource: 0, createGain: 0, createBuffer: 0, start: 0, stop: 0, connect: 0, disconnect: 0, decodeAudioData: 0, resume: 0 }
// 【第 57 轮】把每个 AudioBuffer 的**真实样本**留下来（母版用 getChannelData(0).set(out) 写入）
AUDIO.buffers = []
// 阴性对照开关：模拟"桩写不进去"的旧行为 ⇒ 程序化音频体检必须 FAIL（证明它测的是波形、不是计数器）
const SILENT_SYNTH = process.argv.includes('--silent-synth')
function makeAudioStub() {
  // ⚠ 给音频桩加计数器：母版**静默降级**，所以"跑通了"证明不了"有声音"。
  //   必须显式断言"音频节点真的被创建并 start 过"，否则整个移植可能交付成哑巴游戏。
  AUDIO.ctx++
  const node = () => ({
    connect() { AUDIO.connect++; return this }, disconnect() { AUDIO.disconnect++ },
    start() { AUDIO.start++ }, stop() { AUDIO.stop++ },
    gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} },
    frequency: { value: 440, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    detune: { value: 0 }, type: 'sine', buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: { value: 1 },
    onended: null, Q: { value: 1 }, threshold: { value: -24 }, knee: { value: 30 }, ratio: { value: 12 }, attack: { value: 0.003 }, release: { value: 0.25 },
  })
  return {
    currentTime: 0, sampleRate: 44100, state: 'running', destination: node(), listener: {},
    createGain: () => { AUDIO.createGain++; return node() }, createGainNode: () => { AUDIO.createGain++; return node() },
    createOscillator: () => { AUDIO.createOscillator++; return node() },
    createBufferSource: () => { AUDIO.createBufferSource++; return node() },
    createBiquadFilter: () => { AUDIO.createBiquadFilter++; return node() },
    createDynamicsCompressor: node, createDelay: node, createConvolver: node, createWaveShaper: node,
    createStereoPanner: node, createPanner: node, createAnalyser: () => Object.assign(node(), { fftSize: 2048, frequencyBinCount: 1024, getByteFrequencyData() {}, getByteTimeDomainData() {} }),
    createBuffer: (ch, len, rate) => {
      AUDIO.createBuffer++
      const data = new Float32Array(len)          // 稳定数组：合成器 set() 进来的内容会留在 data 上
      AUDIO.buffers.push({ ch, len, rate, data })
      return {
        numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate,
        getChannelData: () => (SILENT_SYNTH ? new Float32Array(len) : data),
      }
    },
    createPeriodicWave: () => ({}),
    decodeAudioData: (buf, ok) => { AUDIO.decodeAudioData++; if (ok) ok({ duration: 1, getChannelData: () => new Float32Array(1) }) },
    resume: () => { AUDIO.resume++; return Promise.resolve() }, suspend: () => Promise.resolve(), close: () => Promise.resolve(),
  }
}

// ── wx 桩 ──────────────────────────────────────────────────────────────────
const rafPending = []
let rafSeq = 0
const clipboard = { count: 0, last: null }   // 剪贴板桩：记调用次数与末次内容（阶段 ⑮ 判据）
const touch = {}
const storage = new Map()
// 存档往返：`--dump-save <f>` 跑完落盘；`--load-save <f>` 冷启动时预载同一份存储。
//   母版 `Platform.Storage.load(SAVE_KEY)` → `validateSave`/`clampSaveRanges`，
//   **读回来若被校验拒掉，玩家进度就是静默丢失**（阶段⑥只验"写发生过"，验不到这个）。
const SAVE_DUMP = (() => { const i = process.argv.indexOf('--dump-save'); return i > 0 ? process.argv[i + 1] : null })()
const SAVE_LOAD = (() => { const i = process.argv.indexOf('--load-save'); return i > 0 ? process.argv[i + 1] : null })()
if (SAVE_LOAD && existsSync(SAVE_LOAD)) {
  const prev = JSON.parse(readFileSync(SAVE_LOAD, 'utf8'))
  for (const [k, v] of Object.entries(prev.storage || {})) storage.set(k, v)
  console.log(`（--load-save：预载上次存储 ${storage.size} 个键）`)
}
const canvasObjs = []   // 记下所有画布对象，跑完再看它们的**最终**尺寸（游戏是建完才设 width/height 的）
// 设备剖面：母版按 windowWidth/Height 算 letterbox、并按 safeArea 躲刘海。
//   ⚠ 【第 33 轮修】这两个常量**必须在使用前定义**：桩 `wx.getSystemInfoSync()`（下面 L288 附近）
//     是**在 stage ① 调用适配层时**就被读的，而原来 DEVW/SAFE 定义在 L459 —— 那时它们还在 TDZ，
//     桩一抛错、适配层 catch 后回落到硬编码的 375x667 ⇒ **`--device` 从来没传到游戏里**：
//     之前"4 个设备剖面出屏 0 个"其实是**同一个 375x667 跑了四遍**（自建工具的假保证）。
const DEV = (() => { const i = process.argv.indexOf('--device'); return i > 0 ? process.argv[i + 1] : '375x667' })()
const [DEVW, DEVH] = DEV.split('x').map(Number)
const SAFE = (() => { const i = process.argv.indexOf('--safe'); return i > 0 ? Number(process.argv[i + 1]) : 0 })()
// 【第 56 轮】阴性对照开关：**故意不把 safeArea 透传给游戏**，用来证明布局门禁真的会拦人
//   （第 33 轮踩过的正是这个坑：`--device/--safe` 因 TDZ 从没传进游戏，“四个剖面出屏 0 个”其实是同一个 375x667 跑了四遍）。
const NOSAFE = process.argv.includes('--no-safe-passthrough')

const wx = {
  createCanvas: () => { const c = makeCanvas(); canvasObjs.push(c); return c },
  createImage: makeImage,
  getSystemInfoSync: () => ({
    windowWidth: DEVW, windowHeight: DEVH, screenWidth: DEVW, screenHeight: DEVH,
    pixelRatio: 2, platform: 'devtools', system: 'node-smoke', SDKVersion: '2.19.0',
    safeArea: { top: NOSAFE ? 0 : SAFE, bottom: DEVH, left: 0, right: DEVW, width: DEVW, height: DEVH - SAFE },
    windowTop: NOSAFE ? 0 : SAFE, windowBottom: 0,
  }),
  onTouchStart: (f) => { touch.start = f }, onTouchMove: (f) => { touch.move = f },
  onTouchEnd: (f) => { touch.end = f }, onTouchCancel: (f) => { touch.cancel = f },
  onShow: (f) => { touch.show = f }, onHide: (f) => { touch.hide = f },
  setClipboardData: (o) => { clipboard.count++; clipboard.last = o && o.data },
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''), setStorageSync: (k, v) => storage.set(k, v),
  removeStorageSync: (k) => storage.delete(k), clearStorageSync: () => storage.clear(),
  createWebAudioContext: makeAudioStub, createInnerAudioContext: () => ({ src: '', play() {}, pause() {}, stop() {}, destroy() {}, onEnded() {}, onError() {}, onCanplay() {} }),
  setKeepScreenOn() {}, onWindowResize: () => {}, offWindowResize() {}, triggerGC() {}, setPreferredFramesPerSecond() {},
}

// `--no-hide-bridge`：阴性对照用 —— 桩里不给 wx.onHide/onShow，适配层就不会注册切后台桥接，
//   ⑭ 必须报 FAIL（证明它能测出"切后台不暂停"这个真实缺口，而不是恒绿）
const NOHIDEBRIDGE = process.argv.includes('--no-hide-bridge')
if (NOHIDEBRIDGE) { delete wx.onHide; delete wx.onShow }

// `--no-clipboard-bridge`：阴性对照用 —— 桩里不给 wx.setClipboardData，适配层就不提供
//   navigator.clipboard.writeText，⑮ 必须报 FAIL（证明它能测出"导出存档恒失败"这个缺口）
const NOCLIPBRIDGE = process.argv.includes('--no-clipboard-bridge')
if (NOCLIPBRIDGE) delete wx.setClipboardData
const NOB64 = process.argv.includes('--no-b64')   // 阴性对照：抽掉 btoa，⑮ 的编码层判据必须失败

// ── 沙箱 ───────────────────────────────────────────────────────────────────
// `--no-audio`：阴性对照用 —— 抽掉宿主的 WebAudio 工厂，⑩ 必须报 FAIL
//   （母版对此**静默降级**：不报错、只是从此无声，所以必须有专项断言才拦得住）
const NOAUDIO = process.argv.includes('--no-audio')
if (NOAUDIO) delete wx.createWebAudioContext
const sandbox = {
  wx, console, setTimeout, clearTimeout, setInterval, clearInterval,
  __wxRaf: (cb) => { rafPending.push(cb); return ++rafSeq },
  __wxRealRaf: null,
  __wxCaf: () => {},
  Date, Math, JSON, Promise, TextEncoder, TextDecoder,
}
sandbox.globalThis = sandbox
sandbox.GameGlobal = sandbox
const ctx = vm.createContext(sandbox)

// ── 阴性对照：几何上抽掉一个必需映射，必须报 FAIL ──────────────────────────
let adapterSrc = readFileSync(join(HERE, 'adapter.js'), 'utf8')
if (SELFTEST) {
  // 抽掉 `document` 的注入 —— 游戏脚本必然立刻 ReferenceError/document is not defined
  adapterSrc = adapterSrc.replace('root.document = doc', '/* [阴性对照] root.document 被抽掉 */')
  console.log('【阴性对照】已抽掉 adapter 的 root.document 注入\n')
}

function stage(name, fn) {
  try { fn(); console.log(`✅ ${name}`); return true } catch (e) {
    console.log(`❌ ${name}\n      ${String(e && e.message).slice(0, 200)}`)
    const st = String(e && e.stack || '').split('\n').slice(1, 4).map((l) => '      ' + l.trim()).join('\n')
    if (st) console.log(st)
    return false
  }
}

let ok = true
ok = stage('① 适配层加载（只给 wx，建起浏览器全局）', () => {
  vm.runInContext(adapterSrc, ctx, { filename: 'adapter.js' })
  const need = ['document', 'window', 'Image', 'requestAnimationFrame', 'localStorage']
  const miss = need.filter((k) => sandbox[k] === undefined)
  if (miss.length) throw new Error('缺少全局: ' + miss.join(', '))
}) && ok

ok = stage(`② 游戏原脚本初始化（${gameCode.length} 字符，未改一字）`, () => {
  vm.runInContext(gameCode, ctx, { filename: 'game.js' })
}) && ok

// 等图片桩把真实文件读完：它们是**异步 onload**，不等待的话游戏会在"一张图都还没到"的状态下开跑
//   （母版对缺图是**静默回落程序化剪影**，所以"能跑"证明不了"素材到了"）。
await new Promise((r) => setTimeout(r, 150))
console.log(`  （已等待图片桩：成功 ${IMG.loaded} / 失败 ${IMG.failed}）`)
// ⚠ 存档比对必须在**启动瞬间**取快照：之后任何一局游戏都会改动 saveData，
//   拿"玩过之后的"去比"持久化的"就是口径不对等 —— 我第一版正是这么错的，
//   于是把进程 B 自己打出来的 208 击杀当成了"存档读回不对"（4 个字段的假警报）。
const bootSave = SAVE_LOAD ? JSON.parse(JSON.stringify(sandbox.saveData || {})) : null

// ── 探针模式：游戏脚本是普通 <script>，顶层 var 会成为沙箱全局 → 可以直接读它的状态机 ──
if (process.argv.includes('--probe-input')) {
  console.log('\n=== 坐标映射探针：pointerToView(clientX,clientY) → view ===')
  const mc = canvasObjs.find((c) => c.__isMain) || canvasObjs[0]
  console.log(`  主画布 ${mc.width}x${mc.height}；宿主 window ${sandbox.innerWidth}x${sandbox.innerHeight}；dpr ${sandbox.devicePixelRatio}`)
  const f = sandbox.pointerToView
  if (typeof f !== 'function') { console.log('  ❌ pointerToView 不是全局函数'); process.exit(0) }
  const pts = [[0, 0], [sandbox.innerWidth / 2, sandbox.innerHeight / 2], [sandbox.innerWidth, sandbox.innerHeight], [10, 20]]
  for (const [cx, cy] of pts) {
    let v
    try { v = f({ clientX: cx, clientY: cy, pageX: cx, pageY: cy, offsetX: cx, offsetY: cy, target: mc }) } catch (e) { console.log(`  client(${cx},${cy}) → ❌ ${e.message}`); continue }
    console.log(`  client(${cx},${cy}) → view(${v && v.x}, ${v && v.y})`)
  }
  console.log('  参照：游戏逻辑坐标系为 CONFIG.viewW x CONFIG.viewH')
  try { console.log(`  CONFIG.viewW=${sandbox.CONFIG.viewW} viewH=${sandbox.CONFIG.viewH}`) } catch (e) {}
  process.exit(0)
}

// ── 探针模式：游戏脚本是普通 <script>，顶层 var 会成为沙箱全局 → 可以直接读它的状态机 ──
if (process.argv.includes('--probe')) {
  const SKIP = new Set(['wx', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Date', 'Math', 'JSON', 'Promise', 'TextEncoder', 'TextDecoder', 'globalThis', 'GameGlobal', 'Infinity', 'NaN', 'undefined'])
  console.log('\n=== 沙箱顶层全局（游戏脚本暴露出来的） ===')
  for (const n of Object.keys(sandbox)) {
    if (SKIP.has(n) || n.startsWith('__')) continue
    let v, t
    try { v = sandbox[n]; t = typeof v } catch (e) { console.log(`  ${n} : <取值抛异常>`); continue }
    let extra = ''
    try {
      if (t === 'function') extra = '()'
      else if (t === 'object' && v) extra = ' keys=[' + Object.keys(v).slice(0, 16).join(', ') + ']'
      else extra = ' = ' + String(v).slice(0, 70)
    } catch (e) { extra = ' <枚举抛异常>' }
    console.log(`  ${n.padEnd(22)} ${t.padEnd(9)}${extra}`)
  }
  if (sandbox.GAME) {
    console.log('\n=== GAME 现状 ===')
    for (const k of Object.keys(sandbox.GAME)) {
      let v
      try { v = sandbox.GAME[k] } catch { continue }
      const t = Array.isArray(v) ? `Array(${v.length})` : typeof v
      if (t === 'object' || t === 'function') { console.log(`  ${k.padEnd(22)} ${t}`); continue }
      console.log(`  ${k.padEnd(22)} ${t} = ${String(v).slice(0, 60)}`)
    }
  }
  process.exit(0)
}

ok = stage('③ 主循环已注册 requestAnimationFrame', () => {
  if (rafPending.length === 0) throw new Error('init() 后没有任何 rAF 注册 —— 主循环没起来')
}) && ok

let perFrameCounts = []
ok = stage(`④ 驱动 ${FRAMES} 帧不抛异常`, () => {
  for (let i = 0; i < FRAMES; i++) {
    const cb = rafPending.shift()
    if (!cb) throw new Error(`第 ${i + 1} 帧没有可驱动的回调`)
    const before = canvasObjs.length
    cb(i * 16.7)
    perFrameCounts.push(canvasObjs.length - before)
  }
}) && ok
const afterInit = canvasObjs.length - perFrameCounts.reduce((a, b) => a + b, 0) - 0
const afterFrames = canvasObjs.length

// 移植里最大的一块工作量是 6 种指针事件（母版实测），所以必须**真的派发一次**才算验到。
ok = stage('⑤ 合成触摸 → 指针事件派发进游戏监听器', () => {
  if (typeof touch.start !== 'function') throw new Error('适配层没注册 wx.onTouchStart')
  const mk = (x, y) => ({ touches: [{ clientX: x, clientY: y, identifier: 0 }], changedTouches: [{ clientX: x, clientY: y, identifier: 0 }] })
  touch.start(mk(187, 400))
  if (touch.move) { touch.move(mk(200, 430)); touch.move(mk(215, 460)) }
  if (touch.end) touch.end({ touches: [], changedTouches: [{ clientX: 215, clientY: 460, identifier: 0 }] })
  const u = sandbox.__wxadapter.used
  const miss = ['emit:pointerdown', 'emit:pointermove', 'emit:pointerup'].filter((k) => !u[k])
  if (miss.length) throw new Error('没派发出去: ' + miss.join(', '))
  const errs = sandbox.__wxadapter.errors
  if (errs.length) throw new Error(`游戏监听器抛异常 ${errs.length} 次 —— 首个: ${errs[0]}`)
}) && ok

ok = stage('⑥ 存档写入 → wx 存储非空（往返）', () => {
  if (!sandbox.__wxadapter.used['setStorageSync']) throw new Error('启动过程没有写存档')
  if (storage.size === 0) throw new Error('调用过 setStorageSync，但 wx 存储里是空的')
}) && ok

ok = stage('⑦ 画布台账（内存风险量）', () => {
  if (!canvasObjs.length) throw new Error('一个画布都没建')
}) && ok

// ── 实战：进一局 + 跑一段真实玩法 ──────────────────────────────────────────
// 用游戏**自己的**调试入口 debugPlayClean(chapter, dailyId, freeze)：
//   它内部 startRun() + setState(PLAYING)，且 freeze=false 时不置 GAME.paused。
const playFrames = (() => { const i = process.argv.indexOf('--play-frames'); return i > 0 ? Number(process.argv[i + 1]) : 900 })()
const FREEZE = process.argv.includes('--freeze')   // 阴性对照：冻结游戏时钟，进度判据必须失败
const NOPLAY = process.argv.includes('--no-play')  // 停在首页（给 --layout 用：量大厅/HOME 的布局）
const MOVE = process.argv.includes('--move')       // 喂移动输入（否则玩家站桩，约 10 秒阵亡）
// 设备剖面已在文件上方（桩之前）定义 —— 见那里的注释（第 33 轮 TDZ 修复）
let playMs = 0
let picks = 0
let restarts = 0
const frameCalls = []   // 逐帧绘制调用总数（性能趋势：后期怪多时应该涨）

if (NOPLAY) {
  console.log('（--no-play：跳过实战两阶段，停在 HOME —— 供 --layout 量首页布局）')
} else {
ok = stage('⑧ 进入实战（调游戏自己的 debugPlayClean）', () => {
  if (typeof sandbox.debugPlayClean !== 'function') throw new Error('游戏没暴露 debugPlayClean —— 换别的入口')
  // ⚠ 极性：源码是 `if (freeze !== false) GAME.paused = true` ——
  //   要"不暂停"必须**传 false**。我第一版传了 `!FREEZE`（=true）→ 不冻结时反而暂停，
  //   于是 ⑨ 的进度判据被卡在 runTime 0。故这里补一条显式断言，专门拦这种极性反了。
  sandbox.debugPlayClean(0, '', FREEZE)
  const st = sandbox.GAME.state
  if (st !== sandbox.GAME.flow.PLAYING) throw new Error(`state=${st}，没有进入 PLAYING`)
  if (FREEZE && !sandbox.GAME.paused) throw new Error('阴性对照没生效：freeze 未置 paused')
  if (!FREEZE && sandbox.GAME.paused) throw new Error('不该暂停却 paused=true（freeze 极性反了）')
}) && ok

ok = stage(`⑨ 跑 ${playFrames} 帧真实玩法（进度判据：runTime 必须推进）`, () => {
  const rt0 = sandbox.GAME.runTime
  const t0 = Date.now()
  const DEAD = ['REVIVE_MODAL', 'RESULT_LOSE', 'RESULT_WIN']
  for (let i = 0; i < playFrames; i++) {
    const st = sandbox.GAME.state
    // 喂移动输入：直接写游戏自己的输入状态 `Input.joy`（不必猜触摸坐标）。
    //   ⚠ 不喂的话玩家站桩，约 10 秒阵亡 —— **后期系统（BOSS/怪潮/章节结算）根本跑不到**。
    //   只是"转圈"也不够（实测 36000 帧里仍死 3 次、只推进 16 秒）：必须**真闪避**，
    //   否则永远走不到后期。策略 = 朝"最近敌人"的反方向 + 一点切向分量（纯逃跑会被逼进死角）。
    if (MOVE && sandbox.Input && sandbox.Input.joy) {
      const p = sandbox.player, ep = sandbox.enemyPool
      let dx = Math.cos(i * 0.011), dy = Math.sin(i * 0.011)
      if (p && Array.isArray(ep)) {
        // ⚠ 实测对比（同一 36000 帧）：
        //   只躲最近敌人 → runTime **180.0s**（打到 BOSS）、重开 1 次
        //   多点 1/d² 排斥 → runTime 69.4s、重开 2 次（**更差**，玩家被逼到顶边 y=119）
        //   ⇒ 用"躲最近敌人"为主。但它会把玩家逼到屏幕边（实测 x=14）——再加一条**自校准防贴边**：
        //     敌群的包围盒 ≈ 场地，玩家跑出这个圈就朝圈心拉回来（不依赖任何魔数地图尺寸）。
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bx = 0, by = 0, bd = Infinity
        for (const e of ep) {
          if (!e || e.active === false || e.alive === false) continue
          if (typeof e.hp === 'number' && e.hp <= 0) continue
          if (e.x < bx0) bx0 = e.x
          if (e.x > bx1) bx1 = e.x
          if (e.y < by0) by0 = e.y
          if (e.y > by1) by1 = e.y
          const ex = e.x - p.x, ey = e.y - p.y
          const d = ex * ex + ey * ey
          if (d < bd) { bd = d; bx = ex; by = ey }
        }
        if (isFinite(bd)) {
          const L = Math.sqrt(bd) || 1
          let ax = -bx / L, ay = -by / L
          const outside = p.x < bx0 - 60 || p.x > bx1 + 60 || p.y < by0 - 60 || p.y > by1 + 60
          if (outside && isFinite(bx0)) {
            const cx = (bx0 + bx1) / 2 - p.x, cy = (by0 + by1) / 2 - p.y
            const CL = Math.hypot(cx, cy) || 1
            ax = ax * 0.35 + (cx / CL) * 0.65      // 出圈了就主要往回走
            ay = ay * 0.35 + (cy / CL) * 0.65
          }
          const AL = Math.hypot(ax, ay) || 1
          const sway = Math.sin(i * 0.03) * 0.5
          dx = ax / AL - (ay / AL) * sway
          dy = ay / AL + (ax / AL) * sway
        }
      }
      const m = Math.hypot(dx, dy) || 1
      sandbox.Input.joy.active = true
      sandbox.Input.joy.dx = dx / m
      sandbox.Input.joy.dy = dy / m
      sandbox.Input.joy.len = 1
    }
    // 升级弹窗会**冻结游戏时钟**（源码注释：「模态暂停期间 GAME.time 冻结」）——
    //   所以必须用游戏自己的选卡入口把它关掉，否则帧全耗在弹窗上、根本没打到战斗。
    if (st === sandbox.GAME.flow.LEVELUP_MODAL && typeof sandbox.onTapLevelupCard === 'function') {
      try { sandbox.onTapLevelupCard(0); picks++ } catch (e) { throw new Error(`选卡第 ${picks + 1} 次抛异常: ${e.message}`) }
    } else if (DEAD.indexOf(st) >= 0) {
      // 阵亡/结算后用游戏自己的入口重开 —— 这样长跑能持续压测（也是**泄漏检查**：
      //   画布数与各对象池是否随重启次数增长）。
      sandbox.debugPlayClean(0, '', false)
      restarts++
    }
    const cb = rafPending.shift()
    if (!cb) throw new Error(`第 ${i + 1} 帧没有可驱动的回调（主循环在第 ${i} 帧断了）`)
    cb(i * 16.7)
    frameCalls.push(callTotal())
  }
  playMs = Date.now() - t0
  const rt1 = sandbox.GAME.runTime
  // 判据刻意**不用魔数阈值**：只要"时钟必须单调推进"这条结构事实。
  if (!(rt1 > rt0)) throw new Error(`runTime 没有推进（${rt0} → ${rt1}）—— 游戏没在跑`)
  const errs = sandbox.__wxadapter.errors
  if (errs.length) throw new Error(`事件监听器抛异常 ${errs.length} 次 —— 首个: ${errs[0]}`)
}) && ok
}   // ← --no-play 分支结束

// ── ⑩ 音频路径（专项：母版静默降级，"跑通"证明不了"有声音"）────────────────
ok = stage('⑩ 音频路径真的活了', () => {
  if (sandbox.__wxadapter && sandbox.__wxadapter.audioMissing) throw new Error('适配层报告音频缺失（没提供 AudioContext）')
  const w = sandbox.window || {}
  const ac = w.AudioContext || w.webkitAudioContext
  if (typeof ac !== 'function') throw new Error('window.AudioContext 不存在 —— 游戏会静默无声（母版不报错）')
  if (!AUDIO.ctx) throw new Error('游戏从未创建 AudioContext')
  if (NOPLAY) return   // 首页模式不做节点断言（BGM 可能尚未起）
  const nodes = AUDIO.createOscillator + AUDIO.createBufferSource + AUDIO.createGain + AUDIO.createBuffer
  if (nodes === 0) throw new Error('建了 AudioContext 但**一个音频节点都没建** —— 仍然无声')
  if (AUDIO.start === 0) throw new Error('音频节点没被 start() —— 仍然无声')
}) && ok
console.log(`  音频台账：AudioContext×${AUDIO.ctx}  osc×${AUDIO.createOscillator}  bufferSrc×${AUDIO.createBufferSource}  gain×${AUDIO.createGain}  buffer×${AUDIO.createBuffer}  start×${AUDIO.start}  connect×${AUDIO.connect}`)

// ── ⑪ 素材路径（专项：母版缺图时**回落程序化剪影**，同样不报错 ⇒ 必须显式断言）────
ok = stage('⑪ 素材真的加载了（真读 assets/ 并解真实尺寸）', () => {
  const dir = join(HERE, 'assets')
  const expected = existsSync(dir) ? readdirSync(dir).length : 0
  if (expected === 0) throw new Error('构建产物 assets/ 是空的 —— 先跑 build-minigame.mjs')
  if (IMG.loaded < expected) throw new Error(`包里 ${expected} 张，只成功加载 ${IMG.loaded} 张`)
  // ⚠ 判据**只能**是「文件明明在包里、却加载失败」。
  //   母版对 hero_* / ground_* / items/* 等**本就不在仓库里**的素材是**设计内回落程序化绘制**
  //   （注释原文「缺 TEX/地面 PNG 不再 fetch 刷 404(程序化路径)」）——
  //   把「设计内回落」判成缺陷，正是项目 AGENTS.md 连续警告过 4 次的那个错。
  const realBad = IMG.missing.filter((m) => existsSync(join(HERE, m.split(' :: ')[0])))
  if (realBad.length) throw new Error(`文件在包里却加载失败 ${realBad.length} 张: ${realBad[0]}`)
}) && ok
{
  const dir = join(HERE, 'assets')
  const expected = existsSync(dir) ? readdirSync(dir).length : 0
  console.log(`  素材台账：包内 ${expected} 张 → 成功加载 ${IMG.loaded} 张 / 共 ${(IMG.bytes / 1048576).toFixed(2)} MB`)
  console.log(`  尺寸分布（前 5）：${[...IMG.sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + ' ×' + v).join('   ')}（不同尺寸 ${IMG.sizes.size} 种）`)
  const fallback = IMG.missing.filter((m) => !existsSync(join(HERE, m.split(' :: ')[0])))
  if (fallback.length) {
    console.log(`  设计内回落 ${fallback.length} 张（不在包里，母版按程序化绘制兜底）: ${fallback.map((m) => m.split(' :: ')[0]).slice(0, 6).join(', ')}`)
  }
}

// 实战台账
if ((ok || FREEZE) && !NOPLAY) {
  const g = sandbox.GAME
  const num = (v) => (typeof v === 'number' ? v.toFixed(1) : String(v))
  console.log(`\n实战台账：state=${g.state}  runTime=${num(g.runTime)}  game.time=${num(g.time)}  paused=${!!g.paused}  chapterIdx=${g.chapterIdx}`)
  console.log(`  ${playFrames} 帧耗时 ${playMs} ms（${(playMs / playFrames).toFixed(2)} ms/帧 —— Node 空画布，不代表真机）`)
  console.log(`  自动选卡 ${picks} 次；重开对局 ${restarts} 次（阵亡/结算后自动重开 = 长跑压测）`)
  if (typeof sandbox.countLiveEnemies === 'function') {
    try { console.log(`  场上存活敌人 ${sandbox.countLiveEnemies()}（enemyPool 长度 ${Array.isArray(sandbox.enemyPool) ? sandbox.enemyPool.length : '?'}）`) } catch (e) {}
  }
  // boss 状态：`runTime` 在 BOSS 战期间**暂停**（源码注释「主时钟…BOSS 战计时暂停」），
  //   所以 runTime 卡在某个整秒 + game.time 继续走 = 已经打到了 BOSS。
  try {
    const g = sandbox.GAME
    let bs = null
    try { bs = sandbox.bossState } catch (e) {}
    console.log(`  boss 线索：bossWarnIdx=${g.bossWarnIdx} bossWarnT=${(g.bossWarnT || 0).toFixed(1)} bossBannerT=${(g.bossBannerT || 0).toFixed(1)}`
      + (bs ? ` bossState.active=${!!bs.active}${bs.id ? ' id=' + bs.id : ''}` : ''))
    if (g.runTime > 0 && Math.abs(g.runTime - Math.round(g.runTime)) < 1e-6 && g.time - g.runTime > 5) {
      console.log(`  ⇒ runTime 停在整数 ${g.runTime} 且 game.time 已多走 ${(g.time - g.runTime).toFixed(0)} 秒 —— 符合「BOSS 战计时暂停」⇒ **打到了 BOSS**`)
    }
  } catch (e) {}
  // 逐帧绘制调用：设备无关的性能信号（微信画布每次调用都有开销，故"每帧多少次"比 Node 的 ms/帧更有参考价值）
  if (frameCalls.length > 20) {
    // ⚠ frameCalls 存的是**累计值**，必须取差分才是"每帧调用数"（我第一版直接拿累计值当每帧，
    //   得到"中位 155 万次/帧"这种荒谬数）—— 与 P1「量错对象」同族。
    const per = []
    for (let i = 1; i < frameCalls.length; i++) per.push(frameCalls[i] - frameCalls[i - 1])
    const sorted = [...per].sort((a, b) => a - b)
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
    const head = per.slice(0, Math.max(1, Math.floor(per.length * 0.1)))
    const tail = per.slice(Math.floor(per.length * 0.9))
    const avg = (a) => Math.round(a.reduce((s, v) => s + v, 0) / Math.max(1, a.length))
    console.log(`  绘制调用/帧（差分）：中位 ${q(0.5)}  最小 ${sorted[0]}  最大 ${sorted[sorted.length - 1]}`)
    console.log(`    前 10% 帧均值 ${avg(head)} → 后 10% 帧均值 ${avg(tail)}（${avg(tail) > avg(head) * 1.5 ? '⚠ 显著上升，后期压力大' : '量级稳定'}）`)
  }
  for (const nm of ['EnemyPool', 'BulletPool', 'GemPool', 'ParticlePool']) {
    const p = sandbox[nm]
    if (p && Array.isArray(p.list)) {
      const act = p.list.filter((x) => x && x.active).length
      console.log(`  ${nm.padEnd(14)} 活跃 ${String(act).padStart(4)} / 总 ${p.total ?? p.list.length}`)
    }
  }
  const r = sandbox.run
  if (r && typeof r === 'object') {
    const bits = []
    for (const k of ['kills', 'level', 'xp', 'pendingLevels', 'hp', 'maxHp', 'time']) {
      if (r[k] !== undefined) bits.push(`${k}=${typeof r[k] === 'number' ? r[k].toFixed(1) : r[k]}`)
    }
    if (bits.length) console.log(`  run: ${bits.join('  ')}`)
  }
  const pl = sandbox.player
  if (pl && typeof pl === 'object') console.log(`  player: hp=${num(pl.hp)}/${num(pl.maxHp)}  x=${num(pl.x)} y=${num(pl.y)}`)
}

// ── 绘制调用普查（决定"自己光栅化"要覆盖哪些 API）─────────────────────────
CALLS.drawImage = CALLS.drawImage || 0
const callRows = Object.entries(CALLS).sort((a, b) => b[1] - a[1])
const totalCalls = callRows.reduce((s, r) => s + r[1], 0)
// ── ⑬ 存档往返（跨进程：带着上次的存储冷启动）──────────────────────────────
ok = stage('⑬ 存档往返（读回来的必须与上次一致）', () => {
  if (!SAVE_LOAD) { console.log('    （未给 --load-save，跳过）'); return }
  if (!existsSync(SAVE_LOAD)) throw new Error(`找不到存档文件 ${SAVE_LOAD}`)
  const prev = JSON.parse(readFileSync(SAVE_LOAD, 'utf8'))
  const savedKeys = Object.keys(prev.storage || {})
  if (savedKeys.length === 0) throw new Error('上次落盘的存储是空的 —— 这次往返没有意义（先跑一次 --dump-save）')
  // ⚠ 对照口径：必须拿**持久化的那份**比，不能拿上次的**内存快照**比。
  //   第一版就是拿内存快照比的 → 报出 `totalKills: 239 → 405` 这种"不一致"，
  //   其实是因为落盘时内存已涨到 405、而存储里还是 239（**两边本来就该不同**）。
  const rawKey = Object.keys(prev.storage).find((k) => k.indexOf('save') >= 0) || savedKeys[0]
  let persisted = {}
  try {
    const parsed = JSON.parse(prev.storage[rawKey])
    // 实测母版 wrapper 形状 = `{ d: <saveData>, chk: <校验和> }`（不是 .data）；
    //   带 chk 说明 validateSave 会验签 —— 也正是"存了读不回"最可能的失败点。
    persisted = parsed && parsed.d ? parsed.d : (parsed && parsed.data ? parsed.data : parsed)
    console.log(`    wrapper 键: ${parsed && typeof parsed === 'object' ? Object.keys(parsed).join(',') : '(非对象)'}${parsed && parsed.chk !== undefined ? '（含校验和 chk）' : ''}`)
  } catch (e) { throw new Error(`存储里的 ${rawKey} 不是合法 JSON: ${e.message}`) }
  const cur = bootSave || {}
  const keys = Object.keys(persisted).filter((k) => k !== 'schemaVersion')   // schemaVersion 被迁移逻辑消费掉，属预期
  let same = 0
  const diff = []
  for (const k of keys) {
    const a = JSON.stringify(persisted[k])
    const b = JSON.stringify(cur[k])
    if (a === b) same++; else diff.push(`${k}: 持久化 ${String(a).slice(0, 36)} → 读回 ${String(b).slice(0, 36)}`)
  }
  console.log(`    存储键 ${rawKey}（持久化 ${Object.keys(persisted).length} 字段，比对 ${keys.length} 个；schemaVersion 由迁移消费）`)
  console.log(`    启动瞬间快照 → **${same} / ${keys.length} 个逐字一致**`)
  if (diff.length) {
    // 成因已判定（第 23 轮）：空结构被 `validateSave` 规范化成默认形状
    //   （如 `dailyBest: {}` → `{date:"",wins:0,bestKills:0,…}`），**无信息丢失** —— 不是缺口。
    //   故只提示、不判 FAIL；但也不再写「未判定」，那会误导读者。
    console.log(`    ℹ ${diff.length} 个字段读回后被规范化（空结构 → 默认形状，无信息丢失）：`)
    for (const d of diff.slice(0, 4)) console.log(`        ${d}`)
  }
  if (same === 0) throw new Error('读回来的存档与持久化的一个字段都对不上 —— 存档没被读取（或被 validateSave 拒了）')
  if (same < 3) throw new Error(`只对上 ${same} 个字段 —— 不足以证明存档被读取`)
}) && ok

// 存档落盘（给下一次 --load-save 用）
if (SAVE_DUMP) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(SAVE_DUMP, JSON.stringify({ storage: Object.fromEntries(storage), saveData: sandbox.saveData || {} }, null, 1), 'utf8')
  console.log(`\n存档已落盘 -> ${SAVE_DUMP}（存储 ${storage.size} 键；saveData ${Object.keys(sandbox.saveData || {}).length} 字段）`)
}

console.log(`\n绘制调用普查：共 ${totalCalls} 次，前 16 名：`)
for (const [k, v] of callRows.slice(0, 16)) console.log(`  ${k.padEnd(18)} ${String(v).padStart(8)}  ${(v / totalCalls * 100).toFixed(1)}%`)

// ── ⑫ 坐标映射（专项：事件"派发了"不等于"点到的地方对"）────────────────────
// 母版 `pointerToView` 用画布的**显示盒**（getBoundingClientRect().width）把 client 坐标
//   归一到 720x1280。适配层若返回内部缓冲尺寸（1440），换算会变成 ×0.5 ——
//   **每次点击都偏到左上、屏幕大半区域点不动**（实测），而阶段⑤照样全绿。
const BADRECT = process.argv.includes('--bad-rect')   // 阴性对照：把显示盒伪装成内部尺寸
ok = stage('⑫ 输入坐标映射（屏幕中心必须映射到逻辑中心 360,640）', () => {
  const mc = canvasObjs.find((c) => c.__isMain) || canvasObjs[0]
  if (BADRECT) {
    mc.getBoundingClientRect = () => ({ left: 0, top: 0, right: mc.width, bottom: mc.height, width: mc.width, height: mc.height })
    console.log(`    （阴性对照：已把显示盒伪装成内部尺寸 ${mc.width}x${mc.height}）`)
  }
  const rect = mc.getBoundingClientRect()
  console.log(`  显示盒 ${rect.width}x${rect.height}；内部缓冲 ${mc.width}x${mc.height}；宿主窗口 ${sandbox.innerWidth}x${sandbox.innerHeight}`)
  if (!(rect.width > 0) || !(rect.height > 0)) throw new Error('显示盒宽高为 0')
  if (typeof sandbox.pointerToView !== 'function') throw new Error('pointerToView 不是全局函数')
  const cx = sandbox.innerWidth / 2, cy = sandbox.innerHeight / 2
  const v = sandbox.pointerToView({ clientX: cx, clientY: cy, pageX: cx, pageY: cy, target: mc })
  const ex = sandbox.CONFIG.viewW / 2, ey = sandbox.CONFIG.viewH / 2
  const tol = 8
  if (Math.abs(v.x - ex) > tol || Math.abs(v.y - ey) > tol) {
    throw new Error(`屏幕中心 (${cx},${cy}) 映射到 view(${v.x.toFixed(1)},${v.y.toFixed(1)})，期望约 (${ex},${ey}) —— 点击会偏位`)
  }
}) && ok
// ── ⑭ 切后台/回前台（第 42 轮新增）─────────────────────────────────────────
// 为什么必须有这一阶段：母版靠 `document.hidden` + `visibilitychange` 走「切后台 → 立即暂停 →
//   暂停菜单 → 写档 → 挂起音频」（母版 onVisibility，注释原文「hidden 立即暂停, 回来不自动恢复,
//   由玩家在暂停菜单点继续」）。小游戏没有 document，适配层原先把 hidden 硬编码成 false，
//   于是这条路径**一次都不执行**：切后台不暂停、不写档、不 suspend 音频、不释放战斗指针。
//   ⚠ 阴性对照 `--no-hide-bridge`（见上方桩处）：本阶段必须失败。
ok = stage('⑭ 切后台 → 暂停 + 写档；回前台不自动恢复', () => {
  if (NOHIDEBRIDGE) console.log('    （阴性对照 --no-hide-bridge：桩里没有 wx.onHide/onShow）')
  if (typeof touch.hide !== 'function') throw new Error('适配层没注册 wx.onHide —— 切后台永远不会暂停')
  if (typeof touch.show !== 'function') throw new Error('适配层没注册 wx.onShow')
  // 自成一局：不依赖 ⑨ 结束时的状态（默认跑法玩家会阵亡，结束时是 RESULT_*）
  sandbox.debugPlayClean(0, '', false)
  if (sandbox.GAME.state !== sandbox.GAME.flow.PLAYING) throw new Error('重开一局失败，没进 PLAYING')
  const u2 = sandbox.__wxadapter.used
  const writes0 = u2['setStorageSync'] || 0
  // ⚠ 先预热 30 帧让局内时钟真的走起来 —— 否则"暂停冻结"是在 0.0→0.0 上断言的，等于没测
  for (let i = 0; i < 30; i++) { const cb = rafPending.shift(); if (cb) cb(3e6 + i * 16.7) }
  const rt0 = sandbox.GAME.runTime
  if (!(rt0 > 0.2)) throw new Error(`预热后局内时钟仍为 ${rt0.toFixed(2)}s —— 断言前提不成立`)
  touch.hide()                      // ← 等价于玩家切到微信聊天
  if (sandbox.document.hidden !== true) throw new Error('wx.onHide 之后 document.hidden 仍不是 true —— 桥没接上')
  if (sandbox.GAME.state !== sandbox.GAME.flow.PAUSED_MENU) throw new Error(`切后台没暂停：state=${sandbox.GAME.state}`)
  if (!sandbox.uiPauseMenu || sandbox.uiPauseMenu.visible !== true) throw new Error('暂停菜单没显示')
  if (!sandbox.uiBtnContinue || sandbox.uiBtnContinue.visible !== true) throw new Error('「继续游戏」按钮没显示')
  // 【第 43 轮】暂停层只说「回大厅」三个字是不够的：普通章中途退出=本局掉落静默作废（金币唯一入账=结算确认），
  //   而同一按钮在无尽章会自动结算（R31）。副标必须把这个差别写在按钮上。
  const goHome = sandbox.uiBtnGoHome
  if (!goHome) throw new Error('暂停层里没有「回大厅」按钮')
  if (!goHome.sub) throw new Error('「回大厅」没有副标 —— 玩家无从知道退出会不会结算（v1.198 契约）')
  if (String(goHome.sub).indexOf('不结算') !== 0) throw new Error('普通章退出未提示「不结算」：' + goHome.sub)
  console.log(`   「回大厅」副标：${goHome.sub}（普通章=作废；无尽章=自动结算）`)
  // ⚠ 只测 loot=0 那条等于半个探针：有掉落时的金额、以及无尽章的「自动结算」都要真的走到（测完还原）。
  const loot0 = sandbox.run.coinsGained | 0
  const endless0 = !!sandbox.GAME.endlessMode
  sandbox.run.coinsGained = 123
  sandbox.syncPauseQuitNotice()
  if (String(goHome.sub).indexOf('123') < 0) throw new Error('有掉落时副标未显示金额：' + goHome.sub)
  sandbox.GAME.endlessMode = true
  sandbox.syncPauseQuitNotice()
  if (goHome.sub !== '自动结算') throw new Error('无尽章副标应为「自动结算」，实际：' + goHome.sub)
  sandbox.GAME.endlessMode = endless0
  sandbox.run.coinsGained = loot0
  sandbox.syncPauseQuitNotice()
  if (String(goHome.sub).indexOf('不结算') !== 0) throw new Error('还原后副标异常：' + goHome.sub)
  if ((u2['setStorageSync'] || 0) <= writes0) throw new Error('切后台没有写档（母版在 onVisibility 里调 Storage.save）')
  if (!(u2['onHide'] >= 1)) throw new Error('适配层台账里没有 onHide（桥没被调到）')
  // 暂停期间跑 30 帧：局内时钟必须冻结（否则"暂停"只是画了个菜单）
  // 时间戳单调递增并跨 60 秒：模拟"切走 60 秒再回来"，顺便验证 dtCap 钳制（否则回来会快进 60 秒）
  for (let i = 0; i < 30; i++) { const cb = rafPending.shift(); if (cb) cb(3e6 + 60000 + i * 16.7) }
  if (Math.abs(sandbox.GAME.runTime - rt0) > 1e-6) {
    throw new Error(`暂停期间局内时钟仍在走：runTime ${rt0.toFixed(2)} → ${sandbox.GAME.runTime.toFixed(2)}`)
  }
  touch.show()                      // ← 玩家回到游戏
  if (sandbox.document.hidden !== false) throw new Error('wx.onShow 之后 document.hidden 仍是 true')
  if (sandbox.GAME.state !== sandbox.GAME.flow.PAUSED_MENU) throw new Error('回前台自动恢复了 —— 母版裁决是「回来不自动恢复」')
  sandbox.onTapContinue()           // ← 玩家点「继续游戏」
  if (sandbox.GAME.state !== sandbox.GAME.flow.PLAYING) throw new Error('点继续后没回到 PLAYING')
  if (sandbox.uiPauseMenu.visible !== false) throw new Error('点继续后暂停菜单没关')
  const rt1 = sandbox.GAME.runTime
  for (let i = 0; i < 10; i++) { const cb = rafPending.shift(); if (cb) cb(3e6 + 61000 + i * 16.7) }
  const adv = sandbox.GAME.runTime - rt1
  if (!(adv > 0)) throw new Error(`继续后局内时钟没恢复：runTime 停在 ${rt1.toFixed(2)}`)
  // 10 帧(≈0.17s) + 首帧钳制(0.1s) ⇒ 应 < 1s。若钳制失效，这里会是 ≈60s（切后台一次就跑完一分钟）
  if (!(adv < 1.0)) throw new Error(`回前台发生快进：10 帧推进了 ${adv.toFixed(1)}s（dtCap 钳制没生效）`)
  console.log(`   切后台 → 暂停 ✅ 写档 ${writes0}→${u2['setStorageSync']} ✅ 局内时钟冻结在 ${rt0.toFixed(1)}s；回前台 → 不自动恢复 ✅，点「继续」后时钟恢复 ✅`)
}) && ok
// ── ⑮ 导出存档（剪贴板契约，第 42 轮新增）───────────────────────────────────
// 为什么必须有：小游戏**没有可框选的文字**，母版"复制失败 → 见下方手动复制"的降级路径在这里等于不存在。
//   所以 `Clipboard.copy()` 必须真的走通，否则设置页的「导出存档」是死按钮。
//   ⚠ 阴性对照 `--no-clipboard-bridge`（见上方桩处）：本阶段必须失败。
ok = stage('⑮ 导出存档：复制必须真的进剪贴板', () => {
  if (NOCLIPBRIDGE) console.log('    （阴性对照 --no-clipboard-bridge：桩里没有 wx.setClipboardData）')
  if (!sandbox.navigator || !sandbox.navigator.clipboard || typeof sandbox.navigator.clipboard.writeText !== 'function') {
    throw new Error('适配层没提供 navigator.clipboard.writeText —— 导出存档在小游戏里将恒失败')
  }
  if (typeof sandbox.Platform.Clipboard.copy !== 'function') throw new Error('拿不到母版 Platform.Clipboard.copy')
  const c0 = clipboard.count
  if (NOB64) { delete sandbox.btoa; delete sandbox.window.btoa; console.log('    （阴性对照 --no-b64：抽掉 btoa，模拟适配层没补编码）') }
  if (typeof sandbox.exportSaveText !== 'function') throw new Error('拿不到母版 exportSaveText()')
  // ⚠ 真实链路：母版 exportSaveText() = JSON+chk → encodeURIComponent → btoa（不是直接塞一个假字符串）
  const code = sandbox.exportSaveText()
  if (typeof code !== 'string' || !code) throw new Error('exportSaveText() 返回 ' + JSON.stringify(code) + ' —— 存档码没生成出来（编码层断了）')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(code)) throw new Error('存档码不是合法 base64：' + code.slice(0, 40))
  let _parsed = null
  try { _parsed = JSON.parse(sandbox.Platform.Coding.decode(code)) } catch (e) { throw new Error('存档码解码失败：' + String(e && e.message).slice(0, 60)) }
  if (!_parsed || !_parsed.d || !_parsed.chk) throw new Error('存档码结构不对（缺 d/chk）：' + Object.keys(_parsed || {}).join(','))
  console.log(`   导出链路：存档码 ${code.length} 字符 base64（解码回 JSON 含 d/chk）✅`)
  const okCopy = sandbox.Platform.Clipboard.copy(code)
  if (okCopy !== true) throw new Error('母版 Clipboard.copy() 返回 ' + okCopy + ' —— UI 会走「见下方手动复制」降级，而小游戏里没法框选')
  if (clipboard.count !== c0 + 1) throw new Error(`wx.setClipboardData 没被调到（计数 ${c0} → ${clipboard.count}）`)
  if (clipboard.last !== code) throw new Error('进剪贴板的内容不对：' + JSON.stringify(clipboard.last))
  if (!((sandbox.__wxadapter.used || {})['setClipboardData'] >= 1)) throw new Error('适配层台账里没有 setClipboardData')
  const pasteVal = sandbox.Platform.Clipboard.paste()
  console.log(`   复制 ✅（wx.setClipboardData ×${clipboard.count}，${String(clipboard.last).length} 字符）；导入：paste() 返回 ${pasteVal === null ? 'null（小游戏无同步 prompt ⇒ 已知限制，见 README）' : JSON.stringify(pasteVal)}`)
}) && ok

// ── ⑰ 程序化音频体检（第 57 轮新增）─────────────────────────────────────────
// 为什么必须有：小游戏形态**不随包带 wav**（路线 A：适配层不给 fetch）⇒ 玩家听到的 100% 是程序化合成；
//   而这条路径此前只被"数了数 buffer 个数"（阶段⑩）⇒ 波形层面**零判据**。
// 判据全部来自实测（本机 30 个 buffer / 28 种长度）：
//   A 形态一致：采样率一律 44100、单声道；B 全部非静音；C **峰值统一 0.7000**
//   （与 H5 形态那 19 个 wav 的峰值 0.7000 **同口径** ⇒ 两种形态响度上限等价，这是"听到的"那一路的硬证据）；
//   D 不削波；E 覆盖度（不同长度 ≥24、BGM 命中 ≥8、SFX 不同长度 ≥14）。
//   ⚠ 阴性对照 `--silent-synth`（桩写不进去 ⇒ 量到全零）必须让 B/C 报错。
const AB = AUDIO.buffers || []
{
  const byLen = new Map()
  for (const b of AB) {
    let g = byLen.get(b.len)
    if (!g) { g = { len: b.len, n: 0, rate: b.rate, ch: b.ch, peak: 0, rms: 0 }; byLen.set(b.len, g) }
    g.n++
    let pk = 0, sq = 0
    const d = b.data
    for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > pk) pk = v; sq += d[i] * d[i] }
    const rms = d.length ? Math.sqrt(sq / d.length) : 0
    if (pk > g.peak) g.peak = pk
    if (rms > g.rms) g.rms = rms
  }
  const rows = [...byLen.values()].sort((a, b) => b.len - a.len)
  const bgmRefs = (() => { try { return Object.values(sandbox.DATA_BGM || {}).map((d) => d.refSmp).filter(Boolean) } catch (e) { return [] } })()
  const isBgm = (len) => bgmRefs.some((r) => Math.abs(r - len) <= 2)
  const bgmHit = rows.filter((r) => isBgm(r.len)).length
  const sfxRows = rows.filter((r) => !isBgm(r.len))
  console.log(`\n⑰ 程序化音频：AudioBuffer ${AB.length} 个 / 不同长度 ${rows.length} 种（BGM 命中 ${bgmHit}/${bgmRefs.length}，SFX 不同长度 ${sfxRows.length}）`)
  console.log('   长度      秒      个数  峰值      RMS      BGM?')
  for (const r of rows.slice(0, 30)) {
    console.log(`   ${String(r.len).padEnd(9)} ${(r.len / r.rate).toFixed(3).padEnd(7)} ${String(r.n).padEnd(5)} ${r.peak.toFixed(4).padEnd(8)} ${r.rms.toFixed(4).padEnd(8)} ${isBgm(r.len) ? 'BGM' : ''}`)
  }
  const aFails = []
  // 「解锁静音缓冲」是**设计内**的唯一静音：母版 L12943 用 floor(sr*CONFIG.audio.unlockSilentSec) 建它，
  //   目的是拿一次用户手势去解锁音频（内容本就不该有声音）⇒ 判据要把这一条单独放行、并反过来断言它确实是静的。
  const unlockLen = (() => { try { return Math.max(1, Math.floor(44100 * sandbox.CONFIG.audio.unlockSilentSec)) } catch (e) { return -1 } })()
  const badRate = rows.filter((r) => r.rate !== 44100 || r.ch !== 1)
  if (badRate.length) aFails.push(`A 形态不一致：${badRate.length} 种长度的采样率/声道不是 44100/单声道`)
  const silent = rows.filter((r) => !(r.peak > 0.01) && r.len !== unlockLen)
  if (!AB.length) aFails.push('B 一个 AudioBuffer 都没有创建 —— 程序化音频整条路没跑起来')
  else if (silent.length) aFails.push(`B 有 ${silent.length} 种长度是静音（峰值 ≤0.01，且不是解锁缓冲 ${unlockLen}）: ${silent.slice(0, 4).map((r) => r.len).join(', ')}`)
  const unlockRow = rows.find((r) => r.len === unlockLen)
  if (unlockRow && unlockRow.peak > 0.01) aFails.push(`B 解锁缓冲（len=${unlockLen}）本应静音，实测峰值 ${unlockRow.peak.toFixed(4)}`)
  const offNorm = rows.filter((r) => Math.abs(r.peak - 0.7) > 0.01 && r.len !== unlockLen)
  if (offNorm.length) aFails.push(`C 峰值未统一到 0.7000（H5 形态 wav 同口径）：${offNorm.slice(0, 4).map((r) => r.len + '→' + r.peak.toFixed(4)).join(', ')}`)
  const clipped = rows.filter((r) => r.peak > 1.0)
  if (clipped.length) aFails.push(`D 削波：${clipped.length} 种长度峰值 >1.0`)
  if (rows.length < 24) aFails.push(`E 覆盖度不足：不同长度 ${rows.length} < 24（事件种类变少 = 音频退化）`)
  if (bgmRefs.length && bgmHit < 8) aFails.push(`E BGM 只命中 ${bgmHit}/${bgmRefs.length}（<8）`)
  if (sfxRows.length < 14) aFails.push(`E SFX 不同长度只有 ${sfxRows.length} < 14`)
  // ── ⑰b 逐事件合成（比"数长度"更硬）────────────────────────────────────────
  //   母版 `_renderAll()` 对 `CONFIG.audio.gains` 的**每个 id** 调 `_renderOne`；而 `_renderOne` 末尾有
  //   「未知 id ⇒ `_alloc(0.01)` 静音兜底」（L12483）。⇒ 某个 id 缺分支时，纯程序化形态（小游戏）下
  //   那个事件**永远是哑的**，而"buffer 个数 / 长度种类"这类统计完全看不出来。
  //   判据用母版自己的静音阈值：`peak > 0.0001`（L12700 同款）。
  const sfxIds = (() => { try { return Object.keys(sandbox.CONFIG.audio.gains) } catch (e) { return [] } })()
  const silentIds = []
  const idPeak = (w) => { let pk = 0; for (let i = 0; i < w.length; i++) { const v = w[i] < 0 ? -w[i] : w[i]; if (v > pk) pk = v } return pk }
  for (const id of sfxIds) {
    let pk = -1, len = 0
    try { const w = sandbox.Audio._renderOne(id, 44100); len = w.length; pk = idPeak(w) } catch (e) { void e }
    if (!(pk > 0.0001)) silentIds.push(`${id}(len=${len},peak=${pk < 0 ? "抛错" : pk.toFixed(5)})`)
  }
  // 判据自证：造一个**不存在**的 id ⇒ 必须掉进静音兜底（长度 441、峰值 0），否则这判据测不出缺失分支
  let idProbeOk = false
  try {
    const bogus = sandbox.Audio._renderOne('SFX___NOT_A_REAL_ID___', 44100)
    idProbeOk = bogus.length === 441 && idPeak(bogus) === 0
  } catch (e) { void e }
  console.log(`  逐事件合成：${sfxIds.length} 个 id，静音 ${silentIds.length} 个；自证（假 id 必须是 441 全零）：${idProbeOk ? '✅' : '✘'}`)
  if (!sfxIds.length) aFails.push('B 读不到 CONFIG.audio.gains —— 逐事件判据无法成立')
  if (silentIds.length) aFails.push(`B 有 ${silentIds.length} 个事件合成出来是静音（小游戏形态下这些音永远听不到）：${silentIds.slice(0, 6).join(' ')}`)
  if (!idProbeOk) aFails.push('判据自证失败：假 id 没掉进静音兜底 ⇒ 这条判据测不出缺失分支（假保证）')
  if (aFails.length) {
    console.log('  ❌ 程序化音频体检未过：')
    for (const f of aFails) console.log('     - ' + f)
    ok = false
  } else {
    console.log(`  ✅ 程序化音频体检通过（${AB.length} 个 buffer / ${rows.length} 种长度，峰值统一 0.7000，单声道 44100）`)
  }
}

const used = (sandbox.__wxadapter && sandbox.__wxadapter.used) || {}
const rows = Object.entries(used).sort((a, b) => b[1] - a[1])
console.log(`\n宿主 API 用量（适配层实际被调到的部分）：`)
if (!rows.length) console.log('  (无 —— 适配层没被用到，可疑)')
for (const [k, v] of rows) console.log(`  ${k.padEnd(26)} ${v}`)

// 画布台账：小游戏内存有限，建了多少张、每张多大，是移植前必须知道的数
const sizeTally = new Map()
for (const c of canvasObjs) {
  const k = `${c.width}x${c.height}`
  sizeTally.set(k, (sizeTally.get(k) || 0) + 1)
}
const px = canvasObjs.reduce((s, c) => s + (c.width * c.height), 0)
console.log(`\n画布台账：共 ${canvasObjs.length} 张，合计 ${(px / 1e6).toFixed(1)} Mpx（≈${(px * 4 / 1048576).toFixed(0)} MB @RGBA）`)
// ⚠ 关键区分：**一次性预渲染缓存** vs **每帧泄漏**。只报总数会把两者混为一谈。
const grow = perFrameCounts.reduce((a, b) => a + b, 0)
console.log(`  初始化阶段建了 ${afterInit} 张；${FRAMES} 帧里又建了 ${grow} 张（每帧 ${FRAMES ? (grow / FRAMES).toFixed(2) : '-'} 张）`)
if (perFrameCounts.length) {
  const head = perFrameCounts.slice(0, 8).join(', ')
  console.log(`  逐帧新增: [${head}${perFrameCounts.length > 8 ? ', …' : ''}]`)
  // ⚠ 泄漏判据要**排除首帧**：首帧本来就会做一批预渲染。
  //   把首帧算进来会误报"仍在增长"（我第一版就这么错过，假警报会让人去追不存在的泄漏）。
  const warm = perFrameCounts.slice(1)
  const warmGrow = warm.reduce((a, b) => a + b, 0)
  console.log(`  首帧新增 ${perFrameCounts[0] ?? 0} 张（首帧预渲染）；此后 ${warm.length} 帧新增 ${warmGrow} 张`)
  console.log(`  → ${warmGrow === 0 ? '✅ 不随帧增长（＝一次性缓存，非泄漏）' : '⚠ 仍在增长，需查是否泄漏'}（判据：同一脚本跑 5 帧与 60 帧，总数应相同）`)
}
for (const [k, v] of [...sizeTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${k.padEnd(14)} × ${v}`)
// ── 【第 61 轮】画布预算门禁（把"内存风险量"从只打印变成会拦人）──────────────────
//   为什么：小游戏形态最大的真实风险就是这段预渲染缓存（README §五 的头号风险），
//   而阶段⑦ 只断言"建过画布" ⇒ 缓存翻一倍也不会有人知道，直到低端机 OOM。
//   阈值来源（实测，不是拍的）：真图桩复测 **1105–1107 张 / 48.5–49.0 Mpx ≈ 185–187 MB @RGBA**
//   ⇒ 上限 **1200 张 / 55 Mpx**（≈+10% 余量：加一批预渲染会红，正常波动不会）。
//   同时把"预热后不再新建"这条（原来只打印）也变成硬判据 —— 它正是"泄漏 vs 一次性缓存"的分界。
const CANVAS_MAX_N = +(process.env.CANVAS_MAX_N || 1200)
const CANVAS_MAX_MPX = +(process.env.CANVAS_MAX_MPX || 55)
const CANVAS_HOG = +(process.env.CANVAS_HOG || 0)   // 阴性对照：凭空多算 N 张 512²，预算必须 FAIL
if (CANVAS_HOG) {
  for (let i = 0; i < CANVAS_HOG; i++) canvasObjs.push({ width: 512, height: 512 })
  console.log(`  （阴性对照 CANVAS_HOG=${CANVAS_HOG}：多算 ${CANVAS_HOG} 张 512² ⇒ 预算必须 FAIL）`)
}
const budgetPx = canvasObjs.reduce((s, c) => s + (c.width * c.height), 0)
const warmGrow2 = perFrameCounts.slice(1).reduce((a, b) => a + b, 0)
const canvasFails = []
if (canvasObjs.length > CANVAS_MAX_N) canvasFails.push(`画布张数 ${canvasObjs.length} > 上限 ${CANVAS_MAX_N}`)
if (budgetPx / 1e6 > CANVAS_MAX_MPX) canvasFails.push(`画布体量 ${(budgetPx / 1e6).toFixed(1)} Mpx > 上限 ${CANVAS_MAX_MPX} Mpx（≈${(budgetPx * 4 / 1048576).toFixed(0)} MB @RGBA）`)
if (warmGrow2 > 0) canvasFails.push(`预热后每帧仍在新建 ${warmGrow2} 张 ⇒ 疑似泄漏（判据：同脚本跑 5 帧与 60 帧总数应相同）`)
if (canvasFails.length) {
  console.log('  ❌ 画布预算未过：')
  for (const f of canvasFails) console.log('     - ' + f)
  ok = false
} else {
  console.log(`  ✅ 画布预算通过（${canvasObjs.length} 张 / ${(budgetPx / 1e6).toFixed(1)} Mpx ≈ ${(budgetPx * 4 / 1048576).toFixed(0)} MB @RGBA；上限 ${CANVAS_MAX_N} 张 / ${CANVAS_MAX_MPX} Mpx）`)
}

const errs = (sandbox.__wxadapter && sandbox.__wxadapter.errors) || []
if (errs.length) { console.log(`\n⚠ 事件监听器抛异常 ${errs.length} 次，前 3 条：`); errs.slice(0, 3).forEach((e) => console.log('  ' + e.slice(0, 120))) }

// ── 布局占用热图（--layout）────────────────────────────────────────────────
if (LAYOUT) {
  const { createRequire } = await import('node:module')
  // 【第 56 轮修】sharp 只是**画热图用**，不是判据依赖 —— 原来写死了本机路径，云端必红（实测）。
  //   解析顺序：常规模块 → 本机 profile 路径 → 放弃（跳过 PNG）。`--no-bitmap` 可强制跳过（等价 CI 环境）。
  const NO_BITMAP = process.argv.includes('--no-bitmap')
  let sharpOptional = null
  if (!NO_BITMAP) {
    for (const spec of ['sharp', 'C:/Users/28151/.dsh/profiles/node_modules/sharp']) {
      try { sharpOptional = createRequire('file:///C:/x.js')(spec); break } catch (e) { void e }
    }
  }
  if (!sharpOptional) console.log('  （无 sharp / --no-bitmap：跳过布局热图 PNG —— 判据不依赖它）')
  const mc = canvasObjs.find((c) => c.__isMain) || canvasObjs[0]
  const W = Math.max(1, Math.round(mc.width)), H = Math.max(1, Math.round(mc.height))
  const CELL = 8
  const gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL)
  const grid = new Int32Array(gw * gh)
  for (const b of BOXES) {
    const cx0 = Math.max(0, Math.floor(b.x0 / CELL)), cx1 = Math.min(gw - 1, Math.floor(b.x1 / CELL))
    const cy0 = Math.max(0, Math.floor(b.y0 / CELL)), cy1 = Math.min(gh - 1, Math.floor(b.y1 / CELL))
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) grid[y * gw + x]++
  }
  // ⚠ 关键修正：**"全部绘制"的覆盖率必然是 100%** —— 背景/暗角/边框铺满全屏，
  //   所以它回答不了"哪里空"。必须把"背景类大块"剔掉，只看**局部内容元素**。
  //   （这与项目第 10 轮的做法同源：那一次也是靠区分"内容元素 vs 暗角/边框条"才得出结论。）
  const SA = W * H
  const isBig = (b) => (b.x1 - b.x0) * (b.y1 - b.y0) >= 0.05 * SA
  const CONTENT = BOXES.filter((b) => !isBig(b))
  const BIG = BOXES.filter(isBig)
  const cgrid = new Int32Array(gw * gh)
  for (const b of CONTENT) {
    const cx0 = Math.max(0, Math.floor(b.x0 / CELL)), cx1 = Math.min(gw - 1, Math.floor(b.x1 / CELL))
    const cy0 = Math.max(0, Math.floor(b.y0 / CELL)), cy1 = Math.min(gh - 1, Math.floor(b.y1 / CELL))
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) cgrid[y * gw + x]++
  }
  let maxv = 0, covered = 0
  let cmax = 0, ccovered = 0
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > maxv) maxv = grid[i]
    if (grid[i] > 0) covered++
    if (cgrid[i] > cmax) cmax = cgrid[i]
    if (cgrid[i] > 0) ccovered++
  }
  const RGB = Buffer.alloc(gw * gh * 3)
  const lg = Math.log(1 + cmax)
  for (let i = 0; i < cgrid.length; i++) {
    const t = cgrid[i] === 0 ? 0 : Math.log(1 + cgrid[i]) / lg
    RGB[i * 3] = Math.round(26 + t * 229)
    RGB[i * 3 + 1] = Math.round(26 + t * 64)
    RGB[i * 3 + 2] = Math.round(26 + t * 14)
  }
  // 【第 56 轮修】输出目录按**候选**挑（工作区布局优先，其次仓库内 `ci/out`）——
  //   原实现写死 `../_dsh-kit/aa-test/`，在仓库内跑必然「写出失败」（非致命，但日志误导）。
  const OUT_CANDS = [
    join(HERE, '..', '_dsh-kit', 'aa-test', 'layout-heat.png'),
    join(HERE, '..', 'ci', 'out', 'layout-heat.png'),
  ]
  const OUT = OUT_CANDS.find((p) => existsSync(dirname(p))) || null
  if (!OUT) console.log('  （没有可写的热图目录：跳过 PNG）')
  try {
    if (sharpOptional && OUT) {
      await sharpOptional(RGB, { raw: { width: gw, height: gh, channels: 3 } }).resize({ width: 320, kernel: 'nearest' }).png().toFile(OUT)
      console.log(`\n布局占用热图（只画**内容元素**，背景大块已剔除）-> ${OUT}`)
    }
  } catch (e) { console.log(`\n布局热图写出失败: ${e.message}`) }
  console.log(`布局占用（--layout）：主画布 ${W}x${H}；记录绘制包围盒 ${BOXES.length} 个`)
  console.log(`  全部绘制：有绘制的格 ${covered}/${gw * gh} = ${(covered / (gw * gh) * 100).toFixed(1)}%（背景铺满，故必然接近 100%，**这个数没有信息量**）`)
  console.log(`  内容元素：${CONTENT.length} 个（剔除背景大块 ${BIG.length} 个，判据 = 包围盒面积 ≥ 屏幕 5%）`)
  console.log(`  内容覆盖：有内容的格 ${ccovered}/${gw * gh} = ${(ccovered / (gw * gh) * 100).toFixed(1)}%；单格最高 ${cmax} 次`)
  const SEG = 32, segH = Math.max(1, Math.floor(gh / SEG))
  const prof = []
  for (let s = 0; s < SEG; s++) {
    let sum = 0, n = 0
    for (let y = s * segH; y < Math.min(gh, (s + 1) * segH); y++) for (let x = 0; x < gw; x++) { sum += cgrid[y * gw + x]; n++ }
    prof.push(sum / Math.max(1, n))
  }
  const pmax = Math.max(1, ...prof)
  // ── 出屏体检：内容元素是否越过画布边界 / 落进刘海带 ──────────────────────
  //   ⚠ 这一条对应的正是项目云端的 `ci/ui-fit.mjs`（**需要 playwright，本机跑不了**），
  //     口径是「返回/关闭类控件是唯一出口，被裁即有真实可用性代价」。
  {
    const outside = CONTENT.filter((b) => b.x0 < -1 || b.y0 < -1 || b.x1 > W + 1 || b.y1 > H + 1)
    const safeTopDev = SAFE * (H / DEVH)      // 刘海带在 device 空间的底边
    const inNotch = SAFE > 0 ? CONTENT.filter((b) => b.y0 < safeTopDev - 1) : []
    // 【第 32 轮】带内**按 op 分类**再下结论：只有**文字/UI**进带才是"被刘海吃掉"，
    //   场景装饰（背景/世界元素）进带是设计内（相机本来就铺满屏）。旧结论只报总数，会误导。
    const notchByOp = {}
    for (const b of inNotch) notchByOp[b.op] = (notchByOp[b.op] || 0) + 1
    const notchText = inNotch.filter((b) => b.op === 'fillText' || b.op === 'strokeText')
    console.log(`  出屏体检（device ${W}x${H}）：越过画布边界的内容元素 ${outside.length} 个；落进刘海带(${safeTopDev.toFixed(0)}px 以上)的 ${inNotch.length} 个`)
    // 把**安全区输入**也打出来：否则"带内没变化"分不清是修法没生效，还是输入本来就是 0（第 33 轮教训）
    try {
      const saIn = sandbox.__wxadapter && sandbox.__wxadapter.safeArea
      const vsIn = sandbox.GAME && sandbox.GAME.viewSafe
      const saTop = sandbox.Platform && sandbox.Platform.SafeArea ? sandbox.Platform.SafeArea.top : 'n/a'
      console.log(`  安全区输入：宿主 safeArea=${JSON.stringify(saIn)} · 母版 SafeArea.top=${saTop} · 母版 viewSafe=${JSON.stringify(vsIn)}`)
    } catch (e) { console.log('  安全区输入：读取失败 ' + e.message) }
    console.log(`    带内 op 分布：${Object.entries(notchByOp).map(([k, v]) => `${k}×${v}`).join(' ') || '（空）'}`)
    console.log(`    带内**文字**元素 ${notchText.length} 个` +
      (notchText.length
        ? ` → 最上 6 个：${notchText.slice().sort((a, b) => a.y0 - b.y0).slice(0, 6).map((b) => `y${b.y0.toFixed(0)}「${String(b.t || '').slice(0, 8)}」`).join(' ')}`
        : '（无 ⇒ 刘海没吃掉 HUD 文字）'))
    if (outside.length) {
      const worst = outside.slice().sort((p, q) => (q.x1 - W) - (p.x1 - W)).slice(0, 3)
      for (const b of worst) console.log(`    ⚠ ${b.op} box(${b.x0.toFixed(0)},${b.y0.toFixed(0)})-(${b.x1.toFixed(0)},${b.y1.toFixed(0)})`)
    }
    // 上屏画布的绘制区是否被 letterbox 留白（留白 = 内容被压到中间，两侧黑边）
    const usedW = CONTENT.reduce((m, b) => Math.max(m, b.x1), 0)
    const usedH = CONTENT.reduce((m, b) => Math.max(m, b.y1), 0)
    console.log(`  内容实际用到 ${usedW.toFixed(0)}x${usedH.toFixed(0)}（画布 ${W}x${H}）⇒ ${usedW < W * 0.98 ? '⚠ 右侧有未用区' : '✅ 横向铺满'}`)

    // ── 【第 56 轮】把"出屏体检"从**只打印**升级成**门禁**（云端 4 剖面跑它）─────────────
    //   只钉两条**可判定**的（本轮 4 剖面实测：越过边界 700~1196、带内 280 个全是 fill ——
    //   两者都属设计内，当判据就会永远红，属"判据选错对象"）：
    //     A1 剖面真的生效：宿主 safeArea 必须如实传到母版（`--safe 47` ⇒ SafeArea.top 必须是 47）；
    //     A2 刘海带内文字元素必须为 0（只有文字/UI 进带才是"被刘海吃掉"，母版 L945 同口径）。
    const layoutFails = [];
    let saTopRaw = null;
    try { saTopRaw = sandbox.Platform && sandbox.Platform.SafeArea ? sandbox.Platform.SafeArea.top : null } catch (e) { void e }
    const saTopNum = Number(saTopRaw);
    if (!Number.isFinite(saTopNum) || Math.abs(saTopNum - SAFE) > 0.01) {
      layoutFails.push(`A1 剖面没生效：--safe ${SAFE} 但母版 Platform.SafeArea.top=${JSON.stringify(saTopRaw)}` +
        '（此时「这一屏没被刘海吃掉」这类结论全是假的 —— 第 33 轮同型）')
    }
    if (notchText.length) {
      layoutFails.push(`A2 刘海带里有 ${notchText.length} 个文字元素（应 0）：` +
        notchText.slice().sort((a, b) => a.y0 - b.y0).slice(0, 3).map((b) => `y${b.y0.toFixed(0)}「${String(b.t || '').slice(0, 8)}」`).join(' '))
    }
    // 判据自证：同一个规则函数喂**合成盒子**，四种情形必须分对（否则判据本身不可信）
    const notchRule = (boxes, safeTop) => (safeTop > 0
      ? boxes.filter((b) => (b.op === 'fillText' || b.op === 'strokeText') && b.y0 < safeTop - 1).length : 0);
    const PROBE = [
      ['文字在带内 → 抓到', [{ op: 'fillText', y0: 5 }], 94, 1],
      ['fill 在带内 → 不算（设计内）', [{ op: 'fill', y0: 0 }], 94, 0],
      ['文字在带下方 → 不算', [{ op: 'fillText', y0: 120 }], 94, 0],
      ['无刘海(safeTop=0) → 规则不适用', [{ op: 'fillText', y0: 5 }], 0, 0],
    ];
    const probeBad = PROBE.filter(([, boxes, st, want]) => notchRule(boxes, st) !== want).map(([n]) => n);
    console.log(`  判据自证（合成盒子 4 例）：${probeBad.length ? '✘ ' + probeBad.join(' / ') : '✅ 全对'}`)
    if (probeBad.length) layoutFails.push('判据自证失败：' + probeBad.join(' / '))
    if (layoutFails.length) {
      console.log('  ❌ 布局门禁未过：')
      for (const f of layoutFails) console.log('     - ' + f)
      ok = false
    } else {
      console.log('  ✅ 布局门禁通过（剖面已生效 + 刘海带内 0 个文字）')
    }
  }
  // 底部细查：这条带里到底画了什么 —— 用于核对《健康游戏忠告》的落位（当初只靠静态坐标扫描定在
  //   逻辑 y 1246–1278 = device 2492–2556，**从未被渲染/运行时验证过**）。
  {
    const by0 = Math.max(0, H - 240)
    const inBand = CONTENT.filter((b) => b.y1 > by0 && b.y0 < H)
    const byOp = new Map()
    for (const b of inBand) byOp.set(b.op, (byOp.get(b.op) || 0) + 1)
    console.log(`  底部细查（device y ${by0}–${H}）：内容元素 ${inBand.length} 个，按类型：`)
    for (const [k, v] of [...byOp.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(12)} ${v}`)
    const buckets = new Map()
    for (const b of inBand.filter((x) => x.op === 'fillText')) {
      const k = Math.floor(b.y0 / 20) * 20
      buckets.set(k, (buckets.get(k) || 0) + 1)
    }
    console.log('    其中 fillText 的 y 分布（20px 一档，device）:')
    for (const [k, v] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) console.log(`      y ${k}–${k + 20}  ${v}`)
  }
  console.log('  竖直剖面（**只算内容元素**，上→下，段均值；█ 越多越挤）:')
  prof.forEach((v, s) => {
    const y0 = Math.round(s * segH * CELL), y1 = Math.round(Math.min(gh, (s + 1) * segH) * CELL)
    console.log(`    y ${String(y0).padStart(4)}-${String(y1).padStart(4)}  ${'█'.repeat(Math.round(v / pmax * 26)).padEnd(26)} ${v.toFixed(0)}`)
  })
}

// ── ⑯ 真入口 game.js：资源分包门控（第 52 轮新增）────────────────────────────
// 为什么必须有这一阶段：**平台第一个执行的文件是 game.js，而它此前从未被这个冒烟测过** ——
//   阶段①②跑的是 adapter.js + game.bundle.js，game.js 只是"看着没问题"。
//   第 52 轮 game.js 里多了「分包没下载完不许启动」的门控，这条顺序写错的表现是：
//   **上线后一屏色块**（母版对缺图是静默回落程序化剪影 —— 不报错、不崩、不卡，任何现有判据都看不见）。
//
// 分支覆盖：成功 / 失败（fail-open 仍要能玩）/ 老基础库无此方法 / **一直不回调（必须不启动）**。
//   场景选择：默认 success；`--subpackage-fail` / `--no-loadsubpackage` / `--subpackage-stall` 切其余三个。
// ⑯a 是**纯函数判据 + 内建 4 条构造错误**（不只验真文件，还要证明这个判据真的会报错）。
function checkSubpackageWiring(decl, entrySrc) {
  const errs = []
  const subs = Array.isArray(decl && decl.subpackages) ? decl.subpackages : []
  const a = subs.find((s) => s.name === 'assets')
  if (!a) errs.push('game.json 的 subpackages 里没有 name="assets" 的分包')
  else if (String(a.root || '').replace(/\/$/, '') !== 'assets') errs.push(`分包 assets 的 root=${a.root}，期望 assets/`)
  if (!/loadSubpackage\s*\(/.test(entrySrc)) errs.push('game.js 里没有调用 wx.loadSubpackage —— 声明了分包却不加载，178 张图会静默回落程序化绘制')
  if (!/['"]assets['"]/.test(entrySrc)) errs.push('game.js 里没有引用分包名 assets')
  return errs
}
async function stageAsync(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); return true } catch (e) {
    console.log(`❌ ${name}\n      ${String(e && e.message).slice(0, 220)}`)
    return false
  }
}
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms))
const SUBPKG_SCENARIO = process.argv.includes('--subpackage-stall') ? 'stall'
  : process.argv.includes('--subpackage-fail') ? 'fail'
    : process.argv.includes('--no-loadsubpackage') ? 'skip' : 'ok'

// 真入口的独立沙箱：require 桩把 './adapter.js' / './game.bundle.js' 映到**同一份源码**上，
//   这样测的就是真实的入口文件，而不是它的副本。
function bootEntry(scenario) {
  const calls = []
  const wx2 = Object.assign({}, wx)
  if (scenario !== 'skip') {
    wx2.loadSubpackage = (o) => {
      calls.push({ name: o && o.name })
      if (scenario === 'ok') setTimeout(() => o && o.success && o.success({}), 0)
      else if (scenario === 'fail') setTimeout(() => o && o.fail && o.fail({ errMsg: 'stub-fail' }), 0)
      // stall：永不回调
      return { onProgressUpdate() {} }
    }
  }
  const box = {
    wx: wx2, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, TextEncoder, TextDecoder,
    __wxRaf: (cb) => { rafPending.push(cb); return ++rafSeq }, __wxRealRaf: null, __wxCaf: () => {},
  }
  box.globalThis = box
  box.GameGlobal = box
  const c2 = vm.createContext(box)
  const entrySrc = readFileSync(join(HERE, 'game.js'), 'utf8')
  const srcMap = { './adapter.js': adapterSrc, './game.bundle.js': gameCode }
  box.require = (p) => {
    if (!(p in srcMap)) throw new Error('入口 require 了未桩的模块: ' + p)
    vm.runInContext(srcMap[p], c2, { filename: p })
  }
  vm.runInContext(entrySrc, c2, { filename: 'game.js' })
  return { box, calls }
}

let okSub = true
if (!SELFTEST) {
  okSub = await stageAsync('⑯a 分包接线一致性（game.json ↔ game.js）＋ 3 条构造错误必须都被抓到', () => {
    const decl = JSON.parse(readFileSync(join(HERE, 'game.json'), 'utf8'))
    const entry = readFileSync(join(HERE, 'game.js'), 'utf8')
    const real = checkSubpackageWiring(decl, entry)
    if (real.length) throw new Error('真实接线有问题：' + real.join('；'))
    const controls = [
      ['声明里抽掉 assets 分包', {}, entry],
      ['root 写成别的目录', { subpackages: [{ name: 'assets', root: 'pics/' }] }, entry],
      ['入口不调 loadSubpackage', decl, entry.replace(/wx\.loadSubpackage\(/g, 'wx.__neverCalled(')],
    ]
    const missed = controls.filter(([, d, s]) => checkSubpackageWiring(d, s).length === 0).map(([n]) => n)
    if (missed.length) throw new Error('阴性对照没被抓到（判据恒绿）：' + missed.join(' / '))
    const n = existsSync(join(HERE, 'assets')) ? readdirSync(join(HERE, 'assets')).length : 0
    if (n !== 178) throw new Error(`assets/ 里 ${n} 个文件，期望 178`)
    console.log(`    真实接线 0 问题；3 条构造错误全部被抓到；assets/ 178 个文件在位`)
  })
  okSub = await stageAsync(`⑯b 真入口执行顺序（场景 ${SUBPKG_SCENARIO}）`, async () => {
    const { box, calls } = bootEntry(SUBPKG_SCENARIO)
    if (SUBPKG_SCENARIO === 'skip') {
      if (box.GAME === undefined) throw new Error('没有 loadSubpackage 时应当直接启动，但 GAME 未定义')
      if (!box.__subpackage || box.__subpackage.state !== 'skipped') throw new Error(`state=${box.__subpackage && box.__subpackage.state}，期望 skipped`)
    } else {
      if (calls.length !== 1 || calls[0].name !== 'assets') throw new Error(`loadSubpackage 调用异常：${JSON.stringify(calls)}`)
      if (box.GAME !== undefined) throw new Error('success 回调之前就启动了游戏 —— 分包里的图这时还不存在')
      if (box.__subpackage.state !== 'loading') throw new Error(`等待中 state=${box.__subpackage.state}，期望 loading`)
      await waitMs(30)
      if (SUBPKG_SCENARIO === 'stall') {
        if (box.GAME !== undefined) throw new Error('一直不回调却启动了 —— 门控是假的')
        console.log('    （阴性对照有效：分包永不回调 ⇒ 游戏确实没有启动）')
      } else if (SUBPKG_SCENARIO === 'ok') {
        if (box.GAME === undefined) throw new Error('success 之后没有启动游戏')
        if (box.__subpackage.state !== 'ok') throw new Error(`state=${box.__subpackage.state}，期望 ok`)
      } else {
        if (box.__subpackage.state !== 'fail') throw new Error(`state=${box.__subpackage.state}，期望 fail`)
        if (box.GAME === undefined) throw new Error('fail 之后没有兜底启动（白屏比缺图更糟）')
        if (typeof box.__retryAssetsSubpackage !== 'function') throw new Error('没有留下重试入口 __retryAssetsSubpackage')
      }
    }
    await waitMs(80)   // 让图片桩把文件读完
    console.log(`    state=${box.__subpackage.state}；入口耗时 ${box.__subpackage.elapsedMs}ms；图片桩累计成功 ${IMG.loaded}`)
  })
  ok = okSub && ok
}

console.log(`\n结论：${ok ? (NOPLAY ? '启动 + 输入 通过（--no-play：未跑实战）' : '启动 + 输入 + 实战 全部通过') : '失败'}（本轮：初始化帧 ${FRAMES}、实战帧 ${playFrames}；rAF 待驱动 ${rafPending.length} 个；分包场景 ${SUBPKG_SCENARIO}）`)
if (SELFTEST) {
  // 阴性对照的期望是"必须失败"
  const pass = !ok
  console.log(pass ? '✔ 阴性对照有效（抽掉 document 后确实报 FAIL）' : '✘ 阴性对照失效 —— 抽掉了还绿，说明本测试给的是假保证')
  process.exit(pass ? 0 : 1)
}
process.exit(ok ? 0 : 1)
