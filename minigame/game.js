/**
 * game.js —— 微信小游戏入口
 *
 * 顺序不能反：适配层必须先跑（它负责把 wx 的 API 补成 document/window/Image/…），
 * 之后游戏原脚本才认得那些浏览器全局。
 *
 * ⚠ 游戏脚本 `game.bundle.js` 是**构建产物**，不要手改：
 *   它由 `node build-minigame.mjs` 从 `mengshou-survivor/dist/萌兽消消岛.html`
 *   里抽出唯一那个 <script> 块生成 —— 母版始终是唯一真源。
 *
 * ── 【第 52 轮】资源分包门控 ────────────────────────────────────────────────
 * 为什么要有这一段（不是"优化"，是**尺寸硬线**逼出来的）：
 *   主包 = game.bundle.js（1.79 MB）+ assets/（178 张 webp，1.99 MB）= **3.76 / 4.00 MB（94%）**。
 *   平台线是**悬崖**：再进一批美术就直接传不上去，而且失败发生在"上传"这一步，本地毫无预兆。
 *   ⇒ 按官方《分包加载》把 `assets/` 声明成分包（见 `game.json` 的 `subpackages`），
 *     主包只剩代码 **1.79 MB（45%）**，余量 2.2 MB；总包 3.78 MB / 上限 30 MB。
 *   （官方口径：主包 ≤4M、单个普通分包不限制大小、所有主包+分包 ≤30M。
 *     https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html ）
 *
 * 为什么**必须先下载完再启动游戏**：
 *   分包里的文件在 `wx.loadSubpackage` 成功之前**不存在**。游戏启动时就会去加载那 178 张图，
 *   拿不到时母版是**静默回落程序化剪影**（不报错、不崩）—— 那就是"上线后玩家看到一屏色块"。
 *   ⇒ 这里把 `require('./game.bundle.js')` 放进 success 回调里，**顺序由入口文件保证**。
 *
 * 老基础库（< 2.1.0）：官方说这些版本「不需要调用 wx.loadSubpackage」，后台会下发整包兼容代码，
 *   且**根本没有这个方法** ⇒ 没有就跳过（`skipped`），直接启动。
 *
 * 失败不装死：`fail` 时记录 + 仍以无图模式启动（可玩 > 白屏），并把状态留在
 *   `GameGlobal.__subpackage` 里，供后续诊断/重试读取。
 */
require('./adapter.js')       // ① 补宿主 API（必须在最前）

var ASSETS_SUBPACKAGE = 'assets'

var sub = { name: ASSETS_SUBPACKAGE, state: 'loading', startedAt: Date.now(), error: null }
if (typeof GameGlobal !== 'undefined') GameGlobal.__subpackage = sub

function boot() { require('./game.bundle.js') }   // ② 游戏原脚本，一个字节不改

function mark(state, err) {
  sub.state = state
  if (err) sub.error = String((err && (err.errMsg || err.message)) || err).slice(0, 200)
  sub.elapsedMs = Date.now() - sub.startedAt
}

var hasApi = (typeof wx !== 'undefined') && wx && (typeof wx.loadSubpackage === 'function')
if (!hasApi) {
  // 基础库 < 2.1.0：整包下发，无需也不能加载分包
  mark('skipped')
  boot()
} else {
  var task = wx.loadSubpackage({
    name: ASSETS_SUBPACKAGE,      // name 可以填 name 或 root（官方原文）
    success: function () { mark('ok'); boot() },
    fail: function (err) {
      mark('fail', err)
      console.error('[分包] ' + ASSETS_SUBPACKAGE + ' 加载失败，以无图模式启动（美术会回落程序化绘制）：', err)
      boot()
    },
  })
  if (task && typeof task.onProgressUpdate === 'function') {
    task.onProgressUpdate(function (r) { sub.progress = r && r.progress })
  }
  // 留给后续页面/诊断用的重试入口（本次不自动重试：避免与平台的下载重试叠加）
  if (typeof GameGlobal !== 'undefined') {
    GameGlobal.__retryAssetsSubpackage = function () {
      if (sub.state === 'ok') return sub
      wx.loadSubpackage({
        name: ASSETS_SUBPACKAGE,
        success: function () { mark('ok'); if (!sub.booted) { sub.booted = true; boot() } },
        fail: function (err) { mark('fail', err) },
      })
      return sub
    }
  }
}
