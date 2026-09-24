# 全界面巡检截图（art-shots 流水线自动落盘）

推这个目录下任何改动即触发；产物同时写 ci/out 与 _shots/v1210/。

## ⚠ 新鲜度规矩（2026-09-24 实测踩到，写在最前面）

**截图不会随代码自动更新。** 触发条件只有 `_shots/**` 与 workflow 文件本身
（`.github/workflows/art-shots.yml` 的 `on.push.paths`）——**改了游戏再 push 不会刷新它们**。
实测：v1.210m/n 四个提交之后，`v1210/` 里仍是那四个提交**之前**的画面，
而当时的巡检照样打印「产物三形态同源 ✓」——**版本串同源 ≠ 你看到的画是同源**。

⇒ 判新鲜度只看一件事：**`_shots/v1210/*.png` 的时间 vs 母版最后一次改动的时间**。
`_qc/_audit-omissions.mjs` 已把这条加进巡检（截图落后于母版即报 STALE）。

## 怎么刷新

1. push 任意改动到本目录（这份 README 也算）→ 云端 `art-shots` 跑一遍，把新图 + `run.txt`
   **提交回仓库**；也可走 `workflow_dispatch` 手动触发。
2. `ci/out/` 被 `.gitignore` 忽略 ⇒ workflow 里必须 `git add -f`，否则提交阶段「绿着但啥也没提」（已修）。
3. 新图落地后本地重建看板：`node _qc/_shots-gallery.mjs`。
