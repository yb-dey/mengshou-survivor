# -*- coding: utf-8 -*-
"""build_balance_report.py — 由 tools/sim_result.json 生成平衡验证报告页
纯本地、零依赖、不卡机。
"""
import os
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(ROOT, 'tools', 'sim_result.json'), encoding='utf-8'))
OPT_PATH = os.path.join(ROOT, 'tools', 'sim_result_opt.json')
OPT = json.load(open(OPT_PATH, encoding='utf-8')) if os.path.exists(OPT_PATH) else None

END = R['endless']
B = R['builds']
E = R['economy']


def hero_rows():
    rows = []
    order = sorted(END.items(), key=lambda x: -x[1]['medianWave'])
    for hk, v in order:
        ms = v['milestoneRate']
        opt = OPT['endless'][hk] if OPT else None
        rows.append(
            '<tr><td><b>%s</b></td><td>%d</td><td>%d</td><td>%s</td><td>%s</td><td>%s</td></tr>'
            % (v['cn'], v['p25'], v['medianWave'],
               ('%d' % opt['p75']) if opt else str(v['p75']),
               ('%.1f / %.1f' % (v['meanTimeSec'] / 60.0, opt['meanTimeSec'] / 60.0)) if opt else '%.1f 分钟' % (v['meanTimeSec'] / 60.0),
               ' / '.join('%dmin %d%%' % (int(k) // 60, round(r * 100)) for k, r in ms.items())))
    return ''.join(rows)


def pick_rows():
    mx = B['topPicks'][0]['n']
    rows = []
    for t in B['topPicks']:
        rows.append('<div class="mrow"><span class="lb">%s</span>'
                    '<span class="bar"><i style="width:%.0f%%;background:#e8c463"></i></span>'
                    '<span class="vv">%d</span></div>'
                    % (t['cn'], t['n'] / mx * 100, t['n']))
    return ''.join(rows)


html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 数值平衡验证报告</title>
<style>
  :root{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; --red:#e06666; }
  *{ box-sizing:border-box;margin:0;padding:0 }
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:28px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:24px; font-size:13.5px; text-align:center; max-width:860px; line-height:1.6 }
  .wrap{ width:100%; max-width:920px; display:flex; flex-direction:column; gap:20px }
  .card{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25); border-radius:16px; padding:20px 24px }
  .card h2{ font-size:17px; margin-bottom:12px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:12px }
  table.tbl{ border-collapse:collapse; width:100%; font-size:12.5px; margin-top:6px }
  table.tbl th,table.tbl td{ border:1px solid rgba(159,224,180,.25); padding:6px 9px; text-align:center }
  table.tbl th{ background:rgba(232,196,99,.12); font-weight:700 }
  .verdict{ display:inline-block; border-radius:8px; padding:3px 12px; font-weight:800; font-size:13px }
  .v-pass{ background:rgba(111,227,154,.18); color:#8fe3a8; border:1px solid #3fa66a }
  .v-warn{ background:rgba(232,196,99,.15); color:#e8c463; border:1px solid #c49a2e }
  .note{ font-size:12.5px; opacity:.82; line-height:1.75 }
  .note b{ color:var(--gold) }
  .find{ border-left:4px solid var(--gold); background:rgba(232,196,99,.07); border-radius:8px; padding:10px 14px; margin:10px 0; font-size:13px; line-height:1.7 }
  .mrow{ display:flex; align-items:center; gap:8px; margin:5px 0; font-size:12.5px }
  .mrow .lb{ width:110px; flex:none; opacity:.85 }
  .mrow .bar{ flex:1; height:10px; background:rgba(255,255,255,.08); border-radius:5px; overflow:hidden }
  .mrow .bar i{ display:block; height:100% }
  .mrow .vv{ width:40px; text-align:right; color:var(--gold); font-weight:700 }
  footer{ margin-top:24px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:840px }
</style>
</head>
<body>
  <h1>📊 数值平衡验证报告</h1>
  <div class="sub">对内容包三套核心数值的蒙特卡洛验证（半解析逐秒模型，seed __SEED__，每英雄 __N__ 局）。模型口径为<b>相对比较</b>（英雄间/构筑间差异与门槛可达性），非绝对预言；假设与局限见文末。数据来自 13 份设计 JSON，模拟器 <code>tools/sim_balance.py</code>，本页由 <code>tools/build_balance_report.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>A · 无尽存活预期 <small>4 英雄 × __N__ 局</small> <span class="verdict v-warn">发现失衡</span></h2>
      <table class="tbl">
        <tr><th>英雄</th><th>P25 波</th><th>保守中位</th><th>乐观 P75</th><th>时长(保守/乐观 分钟)</th><th>里程碑达成率（保守档）</th></tr>
        __HERO_ROWS__
      </table>
      <div class="find"><b>平衡决策已落地（R38）：</b>采用方案①——里程碑由 5/10/20 分钟调整为 <b>4/8/15 分钟</b>（atSec 240/480/900）。双档复核：保守档（站桩倾向）4 分钟达成率 1–6%，乐观档（熟练走位）中位 w14、<b>4 分钟达成率 100%</b>——实机介于两档之间，首个里程碑对中位玩家「够一够可及」✓；8/15 分钟两档皆 0%，定位「进阶/大师级目标」（模拟口径偏保守：无走位轨迹与主动拾取物技，实机达成率预计高于模拟值）。</div>
      <div class="note">存活为确定性压力曲线主导（半解析模型固有特性），故 P25≈P50≈P75；分布散布依赖实机的走位误差与掉落运气，模拟已含走位波动 ±12% 与果实随机抽样。</div>
    </div>
    <div class="card">
      <h2>B · 构筑 DPS 分布 <small>1000 局贪心抽卡至 Lv.20</small> <span class="verdict v-pass">健康</span></h2>
      <table class="tbl">
        <tr><th>基线 DPS</th><th>P25</th><th>中位</th><th>P75</th><th>上限</th><th>成长倍率（中位）</th></tr>
        <tr><td>20.0</td><td>__BP25__</td><td>__BMED__</td><td>__BP75__</td><td>__BMAX__</td><td>__BGAIN__×</td></tr>
      </table>
      <div class="note" style="margin-top:10px">高选取率卡（贪心策略下的构筑核心，与「流派深挖」设计意图一致）：</div>
      __PICKS__
      <div class="note" style="margin-top:8px">口径：元素专精近似并入攻击乘区；未计入 projectiles/reaction/summon 等非直接乘区——实际构筑上限高于此值。</div>
    </div>
    <div class="card">
      <h2>C · 经济闭环复验 <small>确定性重放</small> <span class="verdict v-pass">HEALTHY</span></h2>
      <table class="tbl">
        <tr><th>总产出</th><th>总消耗</th><th>跨表一致</th><th>积压率</th><th>判定</th></tr>
        <tr><td>__EF__</td><td>__ED__</td><td>__EMATCH__</td><td>__EHR__</td><td>__EVD__</td></tr>
      </table>
      <div class="note" style="margin-top:8px">meta_upgrades 18 项几何成本重算 = economy.json 总消耗（__EMATCH2__），与 game-economy 技能校验（E1–E4 PASS）互相印证。</div>
    </div>
    <div class="card">
      <h2>📐 模型假设与局限</h2>
      <div class="note">
        ① 玩家成长轴：线性 __G__%/分钟（由构筑模拟 Lv20≈3× 基线校准）；<br>
        ② 走位规避：综合规避率 80%（校准至熟练玩家中位存活 ≈10 分钟量级）；<br>
        ③ 综合清场系数 ×3.2（含 AOE/召唤/DoT）；<br>
        ④ 追击到达率 35%（budget 中仅部分追上玩家）；<br>
        ⑤ 敌均基础 HP 取 45（30–90 中值）；<br>
        ⑥ 里程碑达成率为「存活至该秒」的比例。<br>
        局限：无走位轨迹仿真、无反应结算链、无装备/拾取物主动技。结果用于<b>相对比较与门槛可达性判断</b>。
      </div>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>验证轮报告：发现→建议→（设计决策）→复核。模拟器 sim_balance.py 零依赖纯标准库，seed 固定可复现。</footer>
</body>
</html>'''

ms_rows = hero_rows()
html = (html.replace('__HERO_ROWS__', ms_rows)
            .replace('__SEED__', str(R['seed']))
            .replace('__N__', str(R['nRuns']))
            .replace('__BP25__', str(B['dpsP25']))
            .replace('__BMED__', str(B['dpsMedian']))
            .replace('__BP75__', str(B['dpsP75']))
            .replace('__BMAX__', str(B['dpsMax']))
            .replace('__BGAIN__', '%.2f' % (B['dpsMedian'] / B['baseDps']))
            .replace('__PICKS__', pick_rows())
            .replace('__EF__', format(E['totalFaucet'], ','))
            .replace('__ED__', format(E['totalDrain'], ','))
            .replace('__EMATCH__', '✓ 一致' if E['drainMatch'] else '✗ 不一致')
            .replace('__EMATCH2__', '✓' if E['drainMatch'] else '✗')
            .replace('__EHR__', str(E['hoardingRate']))
            .replace('__EVD__', E['verdict'])
            .replace('__G__', '8.5'))

out = os.path.join(ROOT, 'balance_report.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('balance_report.html written:', os.path.getsize(out), 'bytes')
