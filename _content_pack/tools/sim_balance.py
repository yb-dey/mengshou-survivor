# -*- coding: utf-8 -*-
"""sim_balance.py — 内容包数值平衡蒙特卡洛模拟（纯标准库，半解析逐秒模型）
三套验证：
  A. 无尽存活预期（4 英雄 × N 局，endless 曲线 + heroes 参数 + 克制链 + 被动）
  B. 构筑 DPS 分布（upgrades.json 抽卡模拟，贪心选卡到 Lv.20）
  C. 经济闭环复验（economy.json faucet 累积 vs meta_upgrades 总投入，确定性）
输出 tools/sim_result.json（供 build_balance_report.py 生成报告页）。
模型口径：相对比较用（英雄间/构筑间差异），非绝对预言——报告页须注明假设。
"""
import json
import os
import random
import statistics

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HJ = json.load(open(os.path.join(ROOT, 'data', 'heroes.json'), encoding='utf-8'))
EJ = json.load(open(os.path.join(ROOT, 'data', 'endless.json'), encoding='utf-8'))
UJ = json.load(open(os.path.join(ROOT, 'data', 'upgrades.json'), encoding='utf-8'))
ECON = json.load(open(os.path.join(ROOT, 'data', 'economy.json'), encoding='utf-8'))
WJ = json.load(open(os.path.join(ROOT, 'data', 'wave_design.json'), encoding='utf-8'))

ENEMIES = WJ['enemies']
N_RUNS = int(os.environ.get('SIM_N', '400'))
MAX_WAVE = 60
RNG_SEED = 20260923

STRONG = {'fire': 'wood', 'wood': 'earth', 'earth': 'water', 'water': 'light', 'light': 'fire'}


def budget(w):
    return round(6 + 2 * (w - 1) + 0.15 * (w - 1) ** 2)


def hp_mul(w):
    return 1 + 0.22 * (w - 1) + 0.012 * (w - 1) ** 2


def dmg_mul(w):
    return 1 + 0.10 * (w - 1) + 0.005 * (w - 1) ** 2


def coins_per_wave(w):
    return max(2, 10 - w // 3)


def phase_pool(w):
    for p in EJ['phases']:
        if w >= p['from'] and (p['to'] is None or w <= p['to']):
            return p['pool']
    return EJ['phases'][-1]['pool']


# ============ A. 无尽存活（半解析逐秒） ============
def sim_endless(rng, hero_key, h):
    """返回 (存活秒数, 存活波数, 击杀数)"""
    b = h['base']
    pv = h['passive']
    hp_max = float(b['hp'])
    hp = hp_max
    elem = h['element']
    atk_dps_base = b['atk'] / b['atkIntervalSec']
    GROWTH_PER_MIN = 0.085   # 升级成长轴：前期经验曲线平缓，升级更快（构筑实测 Lv20≈3× 基线）
    # 敌种平均克制系数（波内均匀混池）
    def avg_mul(w):
        pool = phase_pool(w)
        m = 0.0
        for k in pool:
            ee = ENEMIES[k]['element']
            if STRONG[elem] == ee:
                m += 1.6
            elif STRONG[ee] == elem:
                m += 0.6
            else:
                m += 1.0
        return m / len(pool)

    wave = 1
    t_in_wave = 0.0
    t_total = 0.0
    kills = 0
    spawned = 0.0      # 本波已生成
    alive = 0.0        # 在场敌数（浮点近似）
    heal_t = 0.0
    dodge_t = 0.0
    dodge_ready = False
    luck = rng.uniform(0.92, 1.12)   # 该局走位状态波动
    while wave <= MAX_WAVE:
        t_in_wave += 1.0
        t_total += 1.0
        atk_dps = atk_dps_base * (1 + GROWTH_PER_MIN * t_total / 60.0)   # 升级成长
        # 追击在场近似：budget 中仅 35% 追上玩家（其余散布全屏），随本波击杀递减
        CHASE = 0.35
        amul = avg_mul(wave)
        avg_ehp = 45.0 * hp_mul(wave)          # 敌种基础 HP 30~90，取中值近似 45
        kill_rate = atk_dps * amul * 3.2 / max(avg_ehp, 1.0)   # ×3.2 综合 AOE/召唤/DoT 清场系数
        alive = max(0.0, budget(wave) * CHASE - kill_rate * rng.uniform(0.85, 1.15) * t_in_wave)
        killed = min(alive, kill_rate)
        alive -= killed
        kills += int(killed)
        if rng.random() < 0.018 * killed:     # 治愈果实真随机抽样（低频大回复，天然高方差）
            hp = min(hp_max, hp + hp_max * 0.2)
        # 精英/Boss 额外压力（波首）
        if wave % EJ['cycles']['eliteEveryWaves'] == 0 and t_in_wave <= 2:
            alive += 1.0
        if wave % EJ['cycles']['bossEveryWaves'] == 0 and t_in_wave <= 4:
            alive += 1.0
        # 受伤：走位+防御构筑综合规避模型（survival_skill 校准至熟练玩家中位存活 ≈10 分钟）
        SURVIVAL_SKILL = 0.80
        attackers = min(2.0, alive * 0.15)
        dmg = attackers * 6.0 * dmg_mul(wave) * (1 - SURVIVAL_SKILL) * luck * rng.uniform(0.7, 1.3)
        # 被动：霜甲减伤
        if pv.get('dmgReducePct'):
            dmg *= (1 - pv['dmgReducePct'] / 100.0)
        # 被动：雷羽鹰闪避
        if pv.get('dodgeCdSec'):
            dodge_t += 1.0
            if not dodge_ready and dodge_t >= pv['dodgeCdSec']:
                dodge_ready = True
            if dodge_ready and dmg > 0:
                dodge_ready = False
                dodge_t = 0.0
                dmg = 0.0
        hp -= dmg
        # 被动：灵鹿自回
        if pv.get('healPctEvery'):
            heal_t += 1.0
            if heal_t >= pv['healEverySec']:
                heal_t = 0.0
                hp = min(hp_max, hp + hp_max * pv['healPctEvery'] / 100.0)
        # 随机扰动（走位误差 ±8%）
        hp -= rng.uniform(0, dmg * 0.08)
        if hp <= 0:
            return t_total, wave, kills
        # 焰心灼烧额外击杀贡献已并入 DPS 口径外，此处不计
        if t_in_wave >= 20.0:
            wave += 1
            t_in_wave = 0.0
            spawned = 0.0
            hp = min(hp_max, hp + 2.0)         # 波间喘息
    return t_total, MAX_WAVE, kills


def run_endless():
    rng = random.Random(RNG_SEED)
    out = {}
    for hk, h in HJ['heroes'].items():
        waves = []
        times = []
        for _ in range(N_RUNS):
            t, w, _k = sim_endless(rng, hk, h)
            waves.append(w)
            times.append(t)
        sw = sorted(waves)
        med = sw[len(sw) // 2]
        p25 = sw[len(sw) // 4]
        p75 = sw[len(sw) * 3 // 4]
        milestones = {m['atSec']: sum(1 for t in times if t >= m['atSec']) / N_RUNS for m in EJ['milestones']}
        out[hk] = {
            'cn': h['cn'], 'medianWave': med, 'p25': p25, 'p75': p75,
            'meanTimeSec': round(statistics.mean(times), 1),
            'milestoneRate': {str(k): round(v, 3) for k, v in milestones.items()},
        }
    return out


# ============ B. 构筑 DPS（贪心抽卡到 Lv.20） ============
def greedy_pick(rng, owned, stats, level, cards):
    """抽 3 张（权重+缩放，排除满层），返回边际增益最大的 key"""
    lv = level
    ep_w = UJ['levelUp']['weights']['epic'] + UJ['levelUp']['scaling']['epicPerLevel'] * (lv - 1)
    lg_w = UJ['levelUp']['weights']['legendary'] + UJ['levelUp']['scaling']['legendaryPerLevel'] * (lv - 1)
    pool = []
    for k, v in cards.items():
        if owned.get(k, 0) >= v['maxStacks']:
            continue
        w = UJ['levelUp']['weights'][v['rarity']]
        if v['rarity'] == 'epic':
            w = ep_w
        elif v['rarity'] == 'legendary':
            w = lg_w
        pool.append((k, w))
    if not pool:
        return None
    picks = []
    for _ in range(3):
        tot = sum(w for _, w in pool)
        r = rng.uniform(0, tot)
        for i, (k, w) in enumerate(pool):
            r -= w
            if r < 0:
                picks.append(k)
                pool.pop(i)
                break
    best, best_gain = None, -1.0
    for k in picks:
        g = marginal_dps(stats, cards[k]['effects'])
        if g > best_gain:
            best, best_gain = k, g
    return best


def marginal_dps(stats, eff):
    """简化 DPS 口径：base(20) × (1+atkPct/100) × (1+critRate×critDmg) + DoT 项"""
    s2 = dict(stats)
    for k, v in eff.items():
        if k == 'elementDmgPct':
            for _e, p in v.items():
                s2['atkPct'] = s2.get('atkPct', 0) + p      # 元素专精近似并入攻击乘区（报告注明）
        else:
            s2[k] = s2.get(k, 0) + v
    atk = 20.0 * (1 + s2.get('atkPct', 0) / 100.0)
    crit = min(1.0, s2.get('critRate', 0)) * (1.5 + s2.get('critDmg', 0))
    dot = 20.0 * s2.get('dotDmgPct', 0) / 100.0 * 0.25     # DoT 项占基础攻击 25% 时间权重
    return atk * (1 + crit) + dot


def run_builds():
    rng = random.Random(RNG_SEED + 1)
    cards = UJ['upgrades']
    results = []
    pick_count = {}
    for _ in range(1000):
        owned = {}
        stats = {}
        for lv in range(1, 21):
            k = greedy_pick(rng, owned, stats, lv, cards)
            if k is None:
                break
            owned[k] = owned.get(k, 0) + 1
            eff = cards[k]['effects']
            for ek, ev in eff.items():
                if ek == 'elementDmgPct':
                    for _e, p in ev.items():
                        stats['atkPct'] = stats.get('atkPct', 0) + p
                else:
                    stats[ek] = stats.get(ek, 0) + ev
            pick_count[k] = pick_count.get(k, 0) + 1
        results.append(marginal_dps(stats, {}))
    sr = sorted(results)
    top = sorted(pick_count.items(), key=lambda x: -x[1])[:8]
    return {
        'runs': 1000, 'maxLevel': 20,
        'dpsP25': round(sr[len(sr) // 4], 1), 'dpsMedian': round(sr[len(sr) // 2], 1),
        'dpsP75': round(sr[len(sr) * 3 // 4], 1), 'dpsMax': round(sr[-1], 1),
        'baseDps': 20.0,
        'topPicks': [{'key': k, 'cn': cards[k]['cn'], 'n': n} for k, n in top],
    }


# ============ C. 经济闭环复验（确定性） ============
def run_economy():
    total_drain = sum(
        sum(round(v['cost']['base'] * v['cost']['growth'] ** (l - 1)) for l in range(1, v['maxLevel'] + 1))
        for v in json.load(open(os.path.join(ROOT, 'data', 'meta_upgrades.json'), encoding='utf-8'))['metaUpgrades'].values()
    )
    F = ECON['model']['total_faucet']
    D = ECON['model']['total_drain']
    hr = (F - D) / F
    waves_needed = int(D / 7) + 1          # 按平均每波净产 7 币粗估回本周数
    return {
        'totalFaucet': F, 'totalDrain': D, 'jsonDrain': total_drain,
        'drainMatch': total_drain == D,
        'hoardingRate': round(hr, 4), 'verdict': 'HEALTHY' if hr <= 0.3 else 'INFLATION',
        'netSurplus': F - D,
    }


if __name__ == '__main__':
    import time
    t0 = time.time()
    res = {
        'seed': RNG_SEED, 'nRuns': N_RUNS,
        'endless': run_endless(),
        'builds': run_builds(),
        'economy': run_economy(),
    }
    dt = time.time() - t0
    out = os.path.join(ROOT, 'tools', 'sim_result.json')
    json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('sim_result.json written:', os.path.getsize(out), 'bytes; %.1fs' % dt)
    for hk, v in res['endless'].items():
        print('  %-12s 存活中位 w%d（P25 %d / P75 %d）里程碑 %s' % (v['cn'], v['medianWave'], v['p25'], v['p75'], v['milestoneRate']))
    b = res['builds']
    print('  构筑 DPS P25/50/75 = %s / %s / %s（基线 20）' % (b['dpsP25'], b['dpsMedian'], b['dpsP75']))
    print('  经济积压率', res['economy']['hoardingRate'], res['economy']['verdict'], 'drainMatch', res['economy']['drainMatch'])
