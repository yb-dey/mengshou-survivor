/**
 * 阴性对照：证明 content-gap-scan 的门禁**真的会 FAIL**。
 * 永远通过的守卫比没有更危险。
 *
 * 做法：造一个"必然有缺口"的最小样本 ——
 *   game_dir/game.html 里 DATA_ENEMY 声明 2 个敌人，AI_ART_TABLE 一个都不给。
 * 跑 GATE=1 → 期望 exit 1。
 *
 * 【环境坑】构造/清理临时目录必须用 **node**（fs.rmSync），
 *   不能用 bash 的 rm：Bash 的 /tmp 与 node 的 /tmp 不是同一个地方（本项目实测）。
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const TMP = path.resolve('ci/out/_negcontent');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'game'), { recursive: true });

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>
var AI_ART_TABLE = {}; /* AI_ART_INJECT */
var DATA_ENEMY = {
  rabbit: { id: "rabbit", name: "兔", variants: [ { id: "boss1", name: "王" } ] }
};
var DATA_BEAST = [ { id: "capybara" } ];
var DATA_WEAPON = { pinecone: { id: "pinecone", kind: "straight" } };
var DATA_GEAR = [ { id: "pinebow" } ];
var DATA_BGM = { harbor: { name: "港湾" } };
var DATA_CHAPTER = [ { chId: "ch1" } ];
var DATA_WORLD_THEME = [ { id: "meadow" } ];
</script></body></html>`;
fs.writeFileSync(path.join(TMP, 'game', 'game.html'), html, 'utf8');
fs.mkdirSync(path.join(TMP, 'game', 'audio'), { recursive: true });

console.log('[阴性样本] ' + TMP);
let code = 0;
let out = '';
try {
  out = execFileSync(process.execPath, [path.resolve('ci/content-gap-scan.mjs')], {
    cwd: TMP, encoding: 'utf8', env: { ...process.env, GATE: '1' },
  });
} catch (e) {
  code = e.status;
  out = (e.stdout || '') + (e.stderr || '');
}

const tail = out.split('\n').filter((l) => /缺口|✅|❌/.test(l)).join('\n');
console.log(tail);
console.log('\n[阴性对照] GATE=1 期望 exit=1，实际 exit=' + code + ' → ' + (code === 1 ? '✅ 守卫有效（真会 FAIL）' : '❌ 守卫失效！'));

// 清理（node 删，不用 bash）
fs.rmSync(TMP, { recursive: true, force: true });
console.log('[清理] ' + (fs.existsSync(TMP) ? '❌ 残留' : '✅ 已删除'));
process.exit(code === 1 ? 0 : 1);
