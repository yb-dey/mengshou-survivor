/**
 * adapter.js —— 把微信小游戏宿主 API 补成这份单文件游戏需要的浏览器 API
 *
 * 为什么要它：母版是一个**单文件 HTML**（`game/萌兽消消岛.html`，1 个 <script> 块、0 外链、0 样式表），
 *   而小游戏运行环境里**没有 DOM**：没有 `document` / `window` / `Image` / `localStorage`……
 *   官方路线就是"适配层"：先补齐这些全局对象，再让原脚本原样跑起来。本文件即该适配层。
 *
 * 适配面来自**实测**（不是猜的）——`_dsh-kit/adapter-surface.mjs` 扫母版得到的真实用量：
 *   `document.createElement` 55 次（其中 canvas 53）· `getContext('2d')` 59 次 ·
 *   事件 14 种（`pointer*` 6 种是最大工作量）· 存储仅 4 处调用 ·
 *   `innerHTML` / `querySelector` **全 0**（说明没有 DOM UI 要重写）。
 *
 * 设计原则：
 *   1. **不改游戏源码**。适配层只提供 API，游戏脚本一个字节不动。
 *   2. **画布 2D 上下文用"记录式空实现"**：小游戏真机上 `wx.createCanvas()` 给的就是真画布，
 *      所以这里的 getContext('2d') 在**真机**上返回真上下文；本文件里的 `makeCtx()` 只在
 *      Node 冒烟测试（`smoke.mjs`）里被 `__SLOT__` 桩替代 —— 见文件末尾的导出约定。
 *   3. **可测**：所有宿主调用都集中在 `root.__wxadapter` 上，便于冒烟测试断言"哪些 API 被用到了"。
 *
 * 用法（小游戏入口 game.js）：
 *   require('./adapter.js')          // 必须先跑适配层
 *   require('./game.bundle.js')      // 再跑游戏原脚本
 */

;(function (root) {
  'use strict'

  var wx = root.wx
  if (!wx) throw new Error('adapter.js: 找不到 wx（本文件必须在小游戏环境里运行）')

  var used = {}
  function note(k) { used[k] = (used[k] || 0) + 1 }
  root.__wxadapter = { used: used }

  // ── 系统信息 ──────────────────────────────────────────────────────────────
  var info = null
  try { info = wx.getSystemInfoSync() } catch (e) { info = null }
  if (!info) info = { windowWidth: 375, windowHeight: 667, pixelRatio: 2, platform: 'devtools', system: '', SDKVersion: '2.19.0' }
  root.__wxsys = info

  var screenW = info.windowWidth || 375
  var screenH = info.windowHeight || 667
  var dpr = info.pixelRatio || 1

  // 【第 33 轮】把宿主的**真实安全区**透传给母版：母版 `Platform.SafeArea.init` 会优先用它
  //   （没有它就只能靠 `env()`（小游戏无 DOM）+ 宽高比猜，两者都不准）。
  //   口径：CSS px，与浏览器 `env(safe-area-inset-*)` 一致；缺字段时回落到 0/屏幕边。
  //   `--safe N` 的探针桩也走这条路 ⇒ 探针从此能**端到端**驱动安全区（此前母版根本不读 wx 的 safeArea）。
  if (info.safeArea) {
    root.__wxadapter.safeArea = {
      top: info.safeArea.top || 0,
      right: Math.max(0, screenW - (info.safeArea.right != null ? info.safeArea.right : screenW)),
      bottom: Math.max(0, screenH - (info.safeArea.bottom != null ? info.safeArea.bottom : screenH)),
      left: info.safeArea.left || 0
    }
  }

  // ── 画布 ──────────────────────────────────────────────────────────────────
  // ⚠ 关键约定：官方规定**首次** wx.createCanvas() 返回上屏画布，之后返回离屏画布。
  //   所以这里**先把它占住**留给 `#cv`（实测母版 L37259 用 document.getElementById("cv") 取它）。
  //   否则一旦游戏先建离屏画布，就会把上屏画布当成离屏用掉 —— 真机上的经典移植坑。
  var mainCanvas = null
  // 画布上也要能挂监听：实测母版把指针/键盘事件绑在**画布元素**上（不是 window），
  //   所以适配层必须把 canvas.addEventListener 也接进同一张监听表 —— 否则输入全哑。
  // ⚠ 画布的「CSS 显示尺寸」必须由 `style` 决定，**不能**用 `c.width`（那是内部缓冲 1440x2560）。
  //   实测母版 `pointerToView`（L13276）用 `rect.width` 把 client 坐标归一到 720x1280：
  //     x = (e.clientX - rect.left) * CONFIG.viewW / rect.width
  //   而母版自己会写 `CANVAS.el.style.width = cssW + "px"`（按窗口算出的 letterbox 尺寸，实测 375）。
  //   若这里返回内部尺寸 1440，换算就变成 ×0.5 —— **每次点击都偏到左上、屏幕大半区域点不动**（实测）。
  function cssSize(c) {
    // 主画布在小游戏里是**letterbox 居中**的：显示盒 = 居中内容盒（与浏览器里 CSS 摆出来的同一口径）
    if (c && c.__isMain && LBOX.on && LBOX.s > 0) return { w: LBOX.dw * LBOX.s / dpr, h: LBOX.dh * LBOX.s / dpr }
    var w = screenW, h = screenH
    var sw = parseFloat(c.style && c.style.width)
    var sh = parseFloat(c.style && c.style.height)
    if (isFinite(sw) && sw > 0) w = sw
    if (isFinite(sh) && sh > 0) h = sh
    return { w: w, h: h }
  }
  // ── 绘制路径 letterbox（第 34 轮）────────────────────────────────────────
  // 为什么必须做：母版把 9:16 内容画进**固定 1440x2560 后备缓冲**；浏览器里靠 CSS 把 canvas 摆成
  //   letterbox 盒（390x693 居中，上边距 75px > 刘海 47px）。小游戏**没有 CSS 排版**，
  //   显示画布恒铺满屏幕 ⇒ 三个后果：
  //     ① 后备缓冲被拉伸铺满 ⇒ 19.5:9 上**纵向拉伸 ≈21.7%**（844÷(390×2560/1440)=1.217）
  //     ② 内容顶边落在屏幕 y=0 ⇒ **刘海压住首页顶栏/标题**
  //     ③ `getBoundingClientRect` 报的显示盒与实际不符 ⇒ 点击纵向偏移
  // 做法（**不改游戏源码**）：①后备缓冲钉在**屏幕物理尺寸**上；②把游戏每次
  //   `setTransform(dpr,0,0,dpr,tx,ty)` 与 letterbox 矩阵 L 复合（L·M 仍是 scale+translate）；
  //   ③`getBoundingClientRect` 改报**居中内容盒**（CSS px）⇒ 输入映射自动对齐。
  // ⚠ `resetTransform()` 必须也设成 L（原生 reset 会丢掉 letterbox）。
  var LBOX = { on: true, s: 1, ox: 0, oy: 0, bw: 0, bh: 0, dw: 1440, dh: 2560 }
  function screenPhys() { return { w: Math.round(screenW * dpr), h: Math.round(screenH * dpr) } }
  function recomputeLetterbox() {
    var sp = screenPhys()
    var dw = LBOX.dw || 1440, dh = LBOX.dh || 2560
    var s = Math.min(sp.w / dw, sp.h / dh)
    LBOX.s = s
    LBOX.ox = Math.round((sp.w - dw * s) / 2)
    LBOX.oy = Math.round((sp.h - dh * s) / 2)
    LBOX.bw = sp.w
    LBOX.bh = sp.h
  }
  function installLetterbox(c) {
    if (!LBOX.on) return
    recomputeLetterbox()
    root.__wxadapter.letterbox = {
      s: LBOX.s, ox: LBOX.ox, oy: LBOX.oy, buffer: [LBOX.bw, LBOX.bh],
      design: [LBOX.dw, LBOX.dh],
      contentCss: [LBOX.dw * LBOX.s / dpr, LBOX.dh * LBOX.s / dpr],
      offsetCss: [LBOX.ox / dpr, LBOX.oy / dpr]
    }
    var rawGet = c.getContext
    // 后备缓冲：游戏写 width/height 会被**纠回**屏幕尺寸，但**先把它写的值当作设计尺寸记下来**。
    //   ⚠ 这一步不能省：低端机上母版会把 `CONFIG.dprCap` 降到 1 ⇒ 设计缓冲变 720x1280，
    //     若仍按 1440x2560 缩放，画面会缩到左上角（比拉伸更糟）。
    //   ⚠ `capture=false` 只在安装时用一次：那时画布还是宿主默认尺寸（桩里是 300x150），
    //     当设计尺寸记下来就错了。
    function enforce(capture) {
      var gw = c.width, gh = c.height
      if (gw === LBOX.bw && gh === LBOX.bh) return
      if (capture && gw > 0 && gh > 0 && (gw !== LBOX.dw || gh !== LBOX.dh)) {
        LBOX.dw = gw
        LBOX.dh = gh
        recomputeLetterbox()
        root.__wxadapter.letterbox.design = [LBOX.dw, LBOX.dh]
        root.__wxadapter.letterbox.s = LBOX.s
        root.__wxadapter.letterbox.ox = LBOX.ox
        root.__wxadapter.letterbox.oy = LBOX.oy
        root.__wxadapter.letterbox.contentCss = [LBOX.dw * LBOX.s / dpr, LBOX.dh * LBOX.s / dpr]
        root.__wxadapter.letterbox.offsetCss = [LBOX.ox / dpr, LBOX.oy / dpr]
        note('letterbox:designChanged')
      }
      c.width = LBOX.bw
      c.height = LBOX.bh
      note('letterbox:bufferReset')
      var raw = rawGet.call(c, '2d')          // 用**未包装**的上下文填黑边
      if (raw) { raw.setTransform(1, 0, 0, 1, 0, 0); raw.fillStyle = '#000'; raw.fillRect(0, 0, LBOX.bw, LBOX.bh) }
    }
    c.getContext = function (kind) {
      var ctx = rawGet.apply(c, arguments)
      if (String(kind) !== '2d' || !ctx || ctx.__lbWrapped) return ctx
      var P = new Proxy(ctx, {
        get: function (t, k) {
          if (k === 'setTransform') {
            return function (a, b, cc, d, e, f) {
              enforce(true)
              t.setTransform(LBOX.s * a, LBOX.s * b, LBOX.s * cc, LBOX.s * d, LBOX.s * e + LBOX.ox, LBOX.s * f + LBOX.oy)
            }
          }
          if (k === 'resetTransform') {
            return function () { enforce(true); t.setTransform(LBOX.s, 0, 0, LBOX.s, LBOX.ox, LBOX.oy) }
          }
          var v = t[k]
          return typeof v === 'function' ? v.bind(t) : v
        },
        set: function (t, k, v) { t[k] = v; return true }
      })
      try { Object.defineProperty(P, '__lbWrapped', { value: true }) } catch (e) {}
      return P
    }
    enforce(false)
  }

  function dressCanvas(c) {
    c.style = c.style || {}
    c.addEventListener = function (t, f) { on(t, f) }
    c.removeEventListener = function (t, f) { off(t, f) }
    // **无条件覆盖**：小游戏里画布的显示盒由适配层定义，宿主自带的同名实现语义可能不同
    //   （实测本机桩就返回内部尺寸，照抄就会踩上面那个坑）。
    c.getBoundingClientRect = function () {
      if (c.__isMain && LBOX.on && LBOX.s > 0) {
        var cw = LBOX.dw * LBOX.s / dpr, ch = LBOX.dh * LBOX.s / dpr
        var cl = LBOX.ox / dpr, ct = LBOX.oy / dpr
        return { left: cl, top: ct, right: cl + cw, bottom: ct + ch, width: cw, height: ch, x: cl, y: ct }
      }
      var s = cssSize(c)
      return { left: 0, top: 0, right: s.w, bottom: s.h, width: s.w, height: s.h, x: 0, y: 0 }
    }
    try {
      Object.defineProperty(c, 'clientWidth', { get: function () { return cssSize(c).w }, configurable: true })
      Object.defineProperty(c, 'clientHeight', { get: function () { return cssSize(c).h }, configurable: true })
    } catch (e) { /* 某些宿主对象不可重定义，忽略 */ }
    if (!c.setAttribute) c.setAttribute = function () {}
    if (!c.getAttribute) c.getAttribute = function () { return null }
    return c
  }
  function ensureDisplay() {
    if (mainCanvas === null) { note('createCanvas:display'); mainCanvas = dressCanvas(wx.createCanvas()); mainCanvas.__isMain = true; installLetterbox(mainCanvas) }
    return mainCanvas
  }
  function makeCanvas() {
    if (mainCanvas === null) return ensureDisplay()
    note('createCanvas:offscreen')
    var c = dressCanvas(wx.createCanvas())
    c.__isMain = false
    return c
  }
  // 实测母版只用两个 id：`app`（宿主容器，L1713 / L25255）与 `cv`（画布，L37259）。
  var _app = null
  function appEl() {
    if (_app) return _app
    _app = {
      id: 'app', style: {}, className: '',
      clientWidth: screenW, clientHeight: screenH, offsetWidth: screenW, offsetHeight: screenH,
      scrollWidth: screenW, scrollHeight: screenH,
      appendChild: function () {}, removeChild: function () {}, insertBefore: function () {},
      addEventListener: function () {}, removeEventListener: function () {},
      setAttribute: function () {}, getAttribute: function () { return null },
      querySelector: function () { return null }, querySelectorAll: function () { return [] },
      getBoundingClientRect: function () { return { left: 0, top: 0, right: screenW, bottom: screenH, width: screenW, height: screenH } },
    }
    return _app
  }

  // ── 图像 ──────────────────────────────────────────────────────────────────
  function makeImage() {
    note('createImage')
    return wx.createImage()
  }

  // ── 事件：小游戏只有 touch*，要还原成游戏用的 pointer*/mouse*/key* ────────
  // 实测母版监听 14 种事件，其中 pointerdown/pointermove/pointerup/pointercancel/
  //   pointerleave/pointerenter 共 6 种 —— 这是移植的**最大工作量**，故在这里集中做映射。
  var listeners = {}
  function on(type, fn) {
    note('on:' + type)
    ;(listeners[type] || (listeners[type] = [])).push(fn)
  }
  function off(type, fn) {
    var a = listeners[type]; if (!a) return
    var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1)
  }
  function emit(type, ev) {
    note('emit:' + type)
    var a = listeners[type]; if (!a) return
    for (var i = 0; i < a.length; i++) { try { a[i](ev) } catch (e) { errors.push(type + ': ' + (e && e.message ? e.message : String(e))) } }
  }
  var errors = []
  root.__wxadapter.errors = errors
  root.__wxemit = emit

  function normTouch(t) {
    return {
      clientX: t.clientX, clientY: t.clientY, pageX: t.clientX, pageY: t.clientY,
      identifier: t.identifier != null ? t.identifier : 0,
      pointerId: t.identifier != null ? t.identifier : 0,
      pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
      preventDefault: function () {}, stopPropagation: function () {},
    }
  }
  function normTouchEvent(e) {
    var ts = (e.touches || []).map(normTouch)
    var cs = (e.changedTouches || []).map(normTouch)
    return {
      touches: ts, changedTouches: cs, targetTouches: ts,
      pointerId: (cs[0] && cs[0].pointerId) || 0,
      pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
      clientX: cs[0] ? cs[0].clientX : 0, clientY: cs[0] ? cs[0].clientY : 0,
      preventDefault: function () {}, stopPropagation: function () {},
    }
  }
  // 【第 42 轮】切后台/回前台桥接 —— 小游戏**没有 document**，本垫片原先把 hidden 硬编码成 false，
  //   于是母版那条「切后台 → 立即暂停 → 暂停菜单 → 写档 → 挂起音频」(母版 onVisibility，注释原文
  //   「hidden 立即暂停, 回来不自动恢复, 由玩家在暂停菜单点继续」) **一次都没执行过**：切后台不暂停、
  //   不写档、不 suspend 音频、不释放战斗指针。此处按小游戏的真实信号补桥。
  //   ⚠ 只派发 visibilitychange：母版同时监听 pagehide 是给 iOS Safari 用的，两条都派发会让同一个
  //     onVisibility 跑两遍（虽然幂等，但会让台账与写档计数翻倍）。
  var docHidden = false
  if (wx.onHide) wx.onHide(function () { note('onHide'); docHidden = true; emit('visibilitychange', { type: 'visibilitychange' }) })
  if (wx.onShow) wx.onShow(function () { note('onShow'); docHidden = false; emit('visibilitychange', { type: 'visibilitychange' }) })
  if (wx.onTouchStart) wx.onTouchStart(function (e) { var n = normTouchEvent(e); emit('pointerdown', n); emit('touchstart', n); emit('mousedown', n) })
  if (wx.onTouchMove) wx.onTouchMove(function (e) { var n = normTouchEvent(e); emit('pointermove', n); emit('touchmove', n); emit('mousemove', n) })
  if (wx.onTouchEnd) wx.onTouchEnd(function (e) { var n = normTouchEvent(e); emit('pointerup', n); emit('touchend', n); emit('mouseup', n); emit('click', n) })
  if (wx.onTouchCancel) wx.onTouchCancel(function (e) { var n = normTouchEvent(e); emit('pointercancel', n); emit('touchcancel', n) })

  // ── 存储：实测母版只有 4 处存储调用 ──────────────────────────────────────
  var store = {
    getItem: function (k) { note('getStorageSync'); var v = wx.getStorageSync(k); return v === '' || v === undefined || v === null ? null : v },
    setItem: function (k, v) { note('setStorageSync'); wx.setStorageSync(k, String(v)) },
    removeItem: function (k) { note('removeStorageSync'); if (wx.removeStorageSync) wx.removeStorageSync(k) },
    clear: function () { note('clearStorageSync'); if (wx.clearStorageSync) wx.clearStorageSync() },
    key: function () { return null }, get length() { return 0 },
  }

  // ── 计时 ──────────────────────────────────────────────────────────────────
  var rafSeq = 0
  var rafCbs = {}
  function raf(cb) {
    note('requestAnimationFrame')
    var id = ++rafSeq
    rafCbs[id] = cb
    if (typeof requestAnimationFrame === 'function' && root.__wxRealRaf) return root.__wxRealRaf(cb)
    // 真机：交给宿主；Node 冒烟：挂起（由 smoke.mjs 手动驱动帧，避免死循环）
    if (root.__wxRaf) return root.__wxRaf(cb)
    return id
  }
  function caf(id) { delete rafCbs[id]; if (root.__wxCaf) root.__wxCaf(id) }

  // ── 组装全局 ──────────────────────────────────────────────────────────────
  var doc = {
    createElement: function (tag) {
      note('createElement:' + tag)
      if (String(tag).toLowerCase() === 'canvas') return makeCanvas()
      if (String(tag).toLowerCase() === 'img' || String(tag).toLowerCase() === 'image') return makeImage()
      // 其余标签给一个极简元素（实测母版 innerHTML/querySelector 用量为 0，用不到）
      return { style: {}, setAttribute: function () {}, appendChild: function () {}, addEventListener: function () {}, removeEventListener: function () {} }
    },
    createElementNS: function (ns, tag) { return doc.createElement(tag) },
    getElementById: function (id) {
      note('getElementById:' + id)
      if (id === 'cv') return ensureDisplay()
      if (id === 'app') return appEl()
      return null
    },
    querySelector: function () { return null },
    querySelectorAll: function () { return [] },
    addEventListener: on,
    removeEventListener: off,
    get body() { return appEl() },
    get documentElement() { return { style: {}, clientWidth: screenW, clientHeight: screenH } },
    get visibilityState() { return docHidden ? 'hidden' : 'visible' },
    get hidden() { return docHidden },
    get title() { return '萌兽不好惹' },
    set title(v) {},
  }

  var win = {
    innerWidth: screenW, innerHeight: screenH, devicePixelRatio: dpr,
    addEventListener: on, removeEventListener: off,
    requestAnimationFrame: raf, cancelAnimationFrame: caf,
    getComputedStyle: function () { return { getPropertyValue: function () { return '' } } },
    matchMedia: function () { return { matches: false, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} } },
    setTimeout: function (fn, ms) { note('setTimeout'); return setTimeout(fn, ms) },
    clearTimeout: function (id) { return clearTimeout(id) },
    setInterval: function (fn, ms) { note('setInterval'); return setInterval(fn, ms) },
    clearInterval: function (id) { return clearInterval(id) },
    navigator: { userAgent: 'minigame', platform: info.platform || 'minigame', language: 'zh-CN' },
    location: { href: '', search: '', hash: '', protocol: 'https:' },
    localStorage: store,
    sessionStorage: store,
    performance: root.performance || { now: function () { return Date.now() } },
  }
  win.window = win
  win.document = doc
  win.self = win
  win.top = win
  win.parent = win
  // ⚠ 【第 35 轮】`__wxadapter` / `__wxsys` 原本只挂在 root（沙箱全局）上，而**游戏看到的 `window` 是这个 `win`**
  //   ⇒ 母版 `window.__wxadapter.safeArea` 永远是 undefined，安全区透传**静默失效**（实测：宿主给 24/44 的剖面
  //   仍报 `SafeArea.top=47` —— 那是宽高比启发式的值）。是探针的"安全区回显"把这个假生效抓出来的。
  win.__wxadapter = root.__wxadapter
  win.__wxsys = info

  // 全局注入（游戏脚本按浏览器习惯直接引用这些裸名字）
  root.window = win
  root.document = doc
  root.navigator = win.navigator
  root.location = win.location
  root.localStorage = store
  root.sessionStorage = store
  root.Image = function () { return makeImage() }
  root.HTMLCanvasElement = function () {}
  root.HTMLImageElement = function () {}
  root.ImageData = function (w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4) }
  root.requestAnimationFrame = raf
  root.cancelAnimationFrame = caf
  root.performance = win.performance
  root.getComputedStyle = win.getComputedStyle
  root.matchMedia = win.matchMedia
  root.devicePixelRatio = dpr
  root.innerWidth = screenW
  root.innerHeight = screenH
  root.addEventListener = on
  root.removeEventListener = off
  root.alert = function () {}
  root.__wxMainCanvas = function () { return mainCanvas }
  // ── 编码：btoa/atob + escape/unescape（第 42 轮）────────────────────────────
  // ⚠ 母版「导出存档」= `btoa(unescape(encodeURIComponent(JSON)))`（Coding.encode，反过来是
  //   `decodeURIComponent(escape(atob(s)))`）。小游戏**没有 btoa/atob**（它不是浏览器），
  //   `escape/unescape` 也是 Annex B 遗留全局、运行时不一定给 ⇒ encode() 被 try/catch 吞掉后
  //   返回 null ⇒ 导出存档在**编码这步**就断了（补剪贴板也救不回来，第 42 轮实测踩到）。
  //   这里按浏览器语义自己实现：btoa 收的是 latin1 字节串（母版正是这么喂的），越界抛错、
  //   atob 遇非法字符抛错 —— 与浏览器一致，母版的 try/catch 会把它们转成 null 走降级。
  var B64CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  function b64encode(bin) {
    var out = '', i, c1, c2, c3
    for (i = 0; i < bin.length; i += 3) {
      c1 = bin.charCodeAt(i); c2 = bin.charCodeAt(i + 1); c3 = bin.charCodeAt(i + 2)
      if (c1 > 255 || c2 > 255 || c3 > 255) throw new Error('InvalidCharacterError')
      out += B64CH.charAt(c1 >> 2)
      out += B64CH.charAt(((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4))
      out += isNaN(c2) ? '=' : B64CH.charAt(((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6))
      out += isNaN(c3) ? '=' : B64CH.charAt(c3 & 63)
    }
    return out
  }
  function b64decode(b64) {
    var s = String(b64).replace(/\s+/g, '').replace(/=+$/, ''), out = '', i, acc = 0, bits = 0, idx
    for (i = 0; i < s.length; i++) {
      idx = B64CH.indexOf(s.charAt(i))
      if (idx < 0) throw new Error('InvalidCharacterError')
      acc = (acc << 6) | idx; bits += 6
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 255) }
    }
    return out
  }
  function legacyEscape(s) {
    var out = '', i, c, h
    s = String(s)
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i)
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
          c === 64 || c === 42 || c === 95 || c === 43 || c === 45 || c === 46 || c === 47) out += s.charAt(i)
      else if (c < 256) out += '%' + (c < 16 ? '0' : '') + c.toString(16).toUpperCase()
      else { h = c.toString(16).toUpperCase(); while (h.length < 4) h = '0' + h; out += '%u' + h }
    }
    return out
  }
  function legacyUnescape(s) {
    return String(s).replace(/%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g, function (m, u, b) {
      return String.fromCharCode(parseInt(u || b, 16))
    })
  }
  root.btoa = b64encode; root.atob = b64decode
  win.btoa = b64encode; win.atob = b64decode
  // 原生有就别覆盖（浏览器/新宿主可能有真实现）
  if (typeof root.escape !== 'function') root.escape = legacyEscape
  if (typeof root.unescape !== 'function') root.unescape = legacyUnescape

  // ── 剪贴板（第 42 轮）──────────────────────────────────────────────────────
  // ⚠ 母版 `Platform.Clipboard.copy` 有两条路：① `navigator.clipboard.writeText` ② textarea+execCommand。
  //   小游戏里 ② **必然抛错**（垫片的 textarea 没有 select()），于是 copy() 恒 false、设置页显示
  //   「已生成存档代码(见下方, 可手动复制)」—— 可画布上画出来的代码**根本没法框选**，那条降级路径
  //   在小游戏里等于不存在 ⇒「导出存档」实际不可用。微信有现成 API：`wx.setClipboardData`。
  //   只补 ①（同步契约能满足：fire-and-forget，母版随即 return true）。
  //   ⛔ **不补 paste**：`wx.getClipboardData` / `wx.showModal({editable})` 全是**异步**，而母版
  //   `Clipboard.paste()` 是同步返回字符串的契约（H5 用 `window.prompt`）。硬凑只能「回前台预取剪贴板」,
  //   那会**绕过母版那句「导入会覆盖当前进度」的确认**——那是改产品行为，不是补适配 ⇒ 记录不改。
  if (typeof wx.setClipboardData === 'function') {
    win.navigator.clipboard = {
      writeText: function (t) {
        note('setClipboardData')
        try { wx.setClipboardData({ data: String(t) }) } catch (e) { return Promise.reject(e) }
        return Promise.resolve()
      },
    }
  } else {
    note('clipboard:missing')
    root.__wxadapter.clipboardMissing = true
  }

  // ── 音频 ──────────────────────────────────────────────────────────────────
  // ⚠ 实测（第 18 轮）：母版 L12865 是 `var AC = window.AudioContext || window.webkitAudioContext;`，
  //   而且**静默降级** —— 拿不到就把 `this.ctx = null`，play 内再守卫，于是**整局无声且不报任何错**
  //   （源码注释原文：「无 AudioContext 环境亦置位(play 内再守卫, 静默无声)」）。
  //   所以"游戏能跑通"**绝不等于**"有声音"：适配层必须显式提供，否则交付出去的是个哑巴游戏。
  //   微信对应 API：`wx.createWebAudioContext()`（基础库 2.19.0+）。
  if (typeof wx.createWebAudioContext === 'function') {
    root.AudioContext = function () { note('createWebAudioContext'); return wx.createWebAudioContext() }
    root.webkitAudioContext = root.AudioContext
    win.AudioContext = root.AudioContext
    win.webkitAudioContext = root.AudioContext
  } else {
    // 没有 WebAudio 时**不要**塞一个假上下文进去 —— 那等于把"静默无声"这个坑重演一遍并掩盖掉。
    // 显式留痕，让冒烟测试与真机自检都能看见。
    note('audio:missing')
    root.__wxadapter.audioMissing = true
  }

})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof globalThis !== 'undefined' ? globalThis : this))
