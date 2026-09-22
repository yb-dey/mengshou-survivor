// 构建自包含展示页：把 sprites_alpha/*.webp 以 base64 内联进单文件 HTML。
// 区分「焦点角色」(Boss/Hero，大卡) 与「萌兽图鉴」(敌人/宠物，网格) 两个分区。
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const alphaDir = path.join(root, "sprites_alpha");
const out = path.join(root, "showcase.html");

const bosses = [
  { key: "forest_ancient", cn: "森林古木", en: "Forest Ancient", elem: "木 / 土", type: "敌方·BOSS", rarity: "传说", hp: "极高", spd: "极低",
    trait: "召唤藤蔓：周期性召唤小藤蔓掩护自身，并释放范围践踏震退玩家。", c1: "#a6d9b0", c2: "#3f7d52" },
];
const heroes = [
  { key: "spirit_deer", cn: "灵鹿祭司", en: "Spirit Deer", elem: "光", type: "可玩英雄", rarity: "史诗", hp: "中", spd: "中",
    trait: "星辉治疗：持续为附近友军回复生命，并可施放净化驱散负面状态。", c1: "#e8d6ff", c2: "#b48bff" },
];
const enemies = [
  { key: "sprout_bunny", cn: "芽芽兔", en: "Sprout Bunny", elem: "木", type: "敌方·小兵", rarity: "普通", hp: "低", spd: "中",
    trait: "分裂：被击杀时原地留下一颗芽，短暂后萌出小兔继续袭扰。", c1: "#c7f3d2", c2: "#79cf94" },
  { key: "flame_fox", cn: "火苗狐", en: "Flame Fox", elem: "火", type: "敌方·快速", rarity: "普通", hp: "低", spd: "高",
    trait: "灼烧：接触玩家时附加持续灼烧伤害，逼迫走位。", c1: "#ffdcb0", c2: "#ff8a5c" },
  { key: "water_frog", cn: "水滴蛙", en: "Water Frog", elem: "水", type: "敌方·远程", rarity: "普通", hp: "中", spd: "中",
    trait: "吐水弹：周期性发射追踪水弹，需预判躲避。", c1: "#c4e8ff", c2: "#5cb8ff" },
  { key: "stone_turtle", cn: "石甲龟", en: "Stone Turtle", elem: "土", type: "敌方·坦克", rarity: "稀有", hp: "高", spd: "低",
    trait: "减伤护盾：受到伤害降低 40%，需要集火或穿透。", c1: "#ece2d2", c2: "#b3a486" },
  { key: "star_bird", cn: "星羽鸟", en: "Star Bird", elem: "光", type: "敌方·飞行", rarity: "稀有", hp: "中", spd: "极高",
    trait: "俯冲：高空蓄力后向玩家俯冲，机动性极强。", c1: "#e7d8ff", c2: "#a98bff" },
  { key: "cotton_sheep", cn: "棉花羊", en: "Cotton Sheep", elem: "光 / 治愈", type: "友方·宠物(可捕捉)", rarity: "史诗", hp: "中", spd: "低",
    trait: "掉落羊毛：被抚摸或击败概率掉落回血羊毛，是可养成伙伴。", c1: "#ffe9f2", c2: "#ffb3d1" },
];

const rarityColor = { 普通: "#9fb4c9", 稀有: "#6aa6ff", 史诗: "#ff9ed6", 传说: "#ffb14e" };

function card(c, big) {
  const fp = path.join(alphaDir, c.key + ".webp");
  const b64 = fs.readFileSync(fp).toString("base64");
  const uri = `data:image/webp;base64,${b64}`;
  const rc = rarityColor[c.rarity] || "#9fb4c9";
  const artH = big ? 280 : 200;
  const imgS = big ? 220 : 160;
  return `
    <article class="card" style="--c1:${c.c1};--c2:${c.c2}">
      <div class="art" style="height:${artH}px"><img src="${uri}" alt="${c.cn}" loading="lazy" style="width:${imgS}px;height:${imgS}px"/></div>
      <div class="meta">
        <div class="name-zh">${c.cn}</div>
        <div class="name-en">${c.en}</div>
        <div class="tags">
          <span class="tag tag-elem">${c.elem}</span>
          <span class="tag tag-type">${c.type}</span>
          <span class="tag" style="background:${rc}22;color:${rc};border-color:${rc}55">${c.rarity}</span>
        </div>
        <div class="stats">
          <span>❤ HP <b>${c.hp}</b></span>
          <span>⚡ 速度 <b>${c.spd}</b></span>
        </div>
        <p class="trait">${c.trait}</p>
      </div>
    </article>`;
}

const featured = [...bosses, ...heroes].map(c => card(c, true)).join("\n");
const gallery = enemies.map(c => card(c, false)).join("\n");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>萌兽内容包 · 森灵萌兽展示</title>
<style>
  :root{ --bg:#11131c; --panel:#181b27; --ink:#eef1f8; --sub:#9aa3b8; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;
    background:radial-gradient(1200px 600px at 50% -10%,#26304a 0%,#11131c 60%);
    color:var(--ink);min-height:100vh;padding:40px 20px 64px;
  }
  header{max-width:1080px;margin:0 auto 28px;text-align:center}
  header .kicker{letter-spacing:.32em;font-size:12px;color:#7f8db0;text-transform:uppercase}
  header h1{font-size:34px;margin:8px 0 6px;background:linear-gradient(90deg,#9fe6c0,#7fb0ff,#ff9ed6);-webkit-background-clip:text;background-clip:text;color:transparent}
  header p{color:var(--sub);font-size:14px;line-height:1.7;max-width:760px;margin:0 auto}
  .badges{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:14px}
  .badge{font-size:12px;padding:5px 12px;border-radius:999px;background:#ffffff10;border:1px solid #ffffff1a;color:#cdd6ea}
  .section-title{max-width:1080px;margin:34px auto 16px;font-size:18px;font-weight:700;color:#cdd6ea;display:flex;align-items:center;gap:10px}
  .section-title::before{content:"";width:6px;height:18px;border-radius:3px;background:linear-gradient(#7fb0ff,#ff9ed6)}
  .featured{max-width:1080px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:20px}
  .grid{max-width:1080px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
  .card{
    background:linear-gradient(180deg,#1c2030,#161924);
    border:1px solid #ffffff14;border-radius:20px;overflow:hidden;
    transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s;
    box-shadow:0 10px 30px #00000040;
  }
  .card:hover{transform:translateY(-6px);box-shadow:0 18px 44px #00000066}
  .art{
    display:flex;align-items:center;justify-content:center;
    background:radial-gradient(circle at 50% 40%,var(--c1),var(--c2));
    position:relative;overflow:hidden;
  }
  .art::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 120%,#00000033,transparent 60%)}
  .art img{object-fit:contain;animation:float 3.4s ease-in-out infinite;filter:drop-shadow(0 8px 14px #00000055);position:relative;z-index:1}
  @keyframes float{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-10px) rotate(1deg)}}
  .card:nth-child(2n) .art img{animation-delay:.5s}
  .card:nth-child(3n) .art img{animation-delay:1s}
  .meta{padding:16px 18px 20px}
  .name-zh{font-size:20px;font-weight:700}
  .name-en{font-size:12px;color:var(--sub);letter-spacing:.04em;margin-bottom:10px}
  .tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
  .tag{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid #ffffff1f;background:#ffffff0d;color:#cdd6ea}
  .tag-elem{background:#7fb0ff22;color:#a9c8ff;border-color:#7fb0ff55}
  .tag-type{background:#ff9ed622;color:#ffc2e4;border-color:#ff9ed655}
  .stats{display:flex;gap:14px;font-size:13px;color:var(--sub);margin-bottom:10px}
  .stats b{color:var(--ink)}
  .trait{font-size:13px;line-height:1.6;color:#c4cde0}
  footer{max-width:1080px;margin:36px auto 0;color:var(--sub);font-size:12px;text-align:center;line-height:1.8}
  footer a{color:#7fb0ff}
</style>
</head>
<body>
<header>
  <div class="kicker">INDEPENDENT CONTENT PACK</div>
  <h1>森灵萌兽 · 内容包展示</h1>
  <p>一套统一 chibi 画风的新萌兽 / Boss / 可玩英雄（云端 Miora 生成 · 边缘洪水填充抠图透底），可在割草幸存者玩法中作 Boss、英雄、敌兵与可捕捉伙伴。本包为<strong>独立命名空间</strong>，不与主游戏文件冲突，待主文件释放后即可接入。</p>
  <div class="badges">
    <span class="badge">8 个角色</span>
    <span class="badge">512²/1024² RGBA 透明</span>
    <span class="badge">PNG + WebP 双格式</span>
    <span class="badge">已透底抠图</span>
    <span class="badge">非 GROK 文件</span>
  </div>
</header>

<section>
  <div class="section-title">焦点角色 · Boss &amp; Hero</div>
  <main class="featured">
${featured}
  </main>
</section>

<section>
  <div class="section-title">萌兽图鉴 · 敌人 &amp; 伙伴</div>
  <main class="grid">
${gallery}
  </main>
</section>

<footer>
  资产目录：<code>_content_pack/sprites_alpha/</code>（透明 PNG/WebP） · 原始生成图：<code>sprites/</code><br/>
  接入说明见 <a href="README.md">README.md</a> · 本页为自包含单文件（精灵已内联）。
</footer>
</body>
</html>`;

fs.writeFileSync(out, html, "utf-8");
console.log("已生成", out, (fs.statSync(out).size / 1024).toFixed(1) + "KB");
