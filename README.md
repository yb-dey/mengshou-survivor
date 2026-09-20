# 萌兽消消岛 · 云端开发仓库

单文件 HTML5 游戏《萌兽消消岛》，零运行时依赖。

- `game/` —— 游戏本体（HTML + assets 贴图 + audio 音效）
- `ci/` —— 云端验证脚本（在 GitHub Actions 上跑，不占用本机）
- `.github/workflows/verify.yml` —— 云端验证流水线

## 为什么要用 GitHub

把**重活（浏览器渲染验证）外移到 GitHub 的服务器**，本机只做轻活（改文本）。
这样开 AI 辅助开发时，笔记本不会被浏览器验证拖慢。

| 能力 | 在哪跑 |
|---|---|
| 改代码（文本编辑） | 本机 |
| 浏览器验证 / 截图 / 采样 | **GitHub Actions（云端）** |
| 代码备份 | **GitHub 仓库（云端）** |

## 云端验证怎么用

推送到 `main` 会自动触发，也可以在仓库的 **Actions → 云端验证 → Run workflow** 手动触发。

跑完在 Actions 页面下载 `verify-report` 制品，里面是：

- `report.json` —— 结论 / 加载耗时 / Canvas 状态 / 调试接口采样 / 错误列表
- `report.md` —— 人看的版本
- `screen.png` —— 首屏截图

**PASS** = 页面加载无 JS 报错 + Canvas 渲染非空白。

## 本地手动跑（可选）

```bash
npm install --no-save playwright
npx playwright install chromium
node ci/verify.mjs
```

## 约束（不可违反）

- **数值与密度冻结**：只做表现层提升，不动数值 / 密度 / 开局节奏
- **像素内存 ≤ 4MB**：当前 3.402MB，余量 612KB —— 再加贴图前先回收
- **改前先量数据**：任何"这是缺陷"的判断，先用运行时真实值验证前提
