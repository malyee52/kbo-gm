# 클러치 기록 퍼짐 점검 (2026-10-25, 공개 특수능력 재료)
# 실행: python -I -X utf8 tools/pbp_clutch.py <원본 parquet 폴더>  (data-src/naver_pbp, 원본은 저장소에 넣지 않는다. 출처 CC BY 4.0: data-src/pbp_derived/README.md)
# 득점권·7회 이후 1점 차 이내의 wOBA 차이가 선수 사이에서 표본 잡음보다 넓은지, 같은 선수 해마다 이어지는지 본다. 리그 단위 요약만 출력한다.
import sys
import numpy as np
import pandas as pd

RAW = sys.argv[1]
W = {'walk': 0.69, 'hit_by_pitch': 0.72, 'single': 0.88, 'double': 1.25, 'triple': 1.58, 'home_run': 2.03}
NOT_PA = {'sac_bunt', 'catcher_interference'}


def load(y):
    d = pd.read_parquet(f'{RAW}/kbo_pbp_{y}.parquet', columns=['game_pk', 'at_bat_number', 'pitch_number', 'inning', 'inning_topbot', 'batter', 'pitcher', 'on_2b', 'on_3b', 'home_score', 'away_score', 'events', 'stand', 'outs_when_up'])
    d = d.sort_values(['game_pk', 'at_bat_number', 'pitch_number']).groupby(['game_pk', 'at_bat_number']).tail(1)
    d = d[d['events'].notna() & ~d['events'].isin(NOT_PA)].copy()
    d['woba'] = d['events'].map(W).fillna(0.0)
    d['risp'] = d['on_2b'].notna() | d['on_3b'].notna()
    bat_lead = np.where(d['inning_topbot'] == 'top', d['away_score'] - d['home_score'], d['home_score'] - d['away_score'])
    d['late'] = (d['inning'] >= 7) & (np.abs(bat_lead) <= 1)
    d['year'] = y
    return d


def split(d, who, key, min_n=40):
    g = d.groupby([who, key])['woba'].agg(['mean', 'count']).unstack(key)
    g = g.dropna()
    g = g[(g[('count', True)] >= min_n) & (g[('count', False)] >= 150)]
    diff = g[('mean', True)] - g[('mean', False)]
    var_pa = d['woba'].var()
    noise = np.sqrt((var_pa / g[('count', True)] + var_pa / g[('count', False)]).mean())
    return diff, noise


years = [2023, 2024, 2025]
data = {y: load(y) for y in years}
for who, label in [('batter', '타자'), ('pitcher', '투수')]:
    for key, kl in [('risp', '득점권'), ('late', '7회 이후 1점 차 이내')]:
        diffs = {}
        for y in years:
            diff, noise = split(data[y], who, key)
            diffs[y] = diff
            sd = diff.std()
            true_sd = np.sqrt(max(0.0, sd ** 2 - noise ** 2))
            print(f'{label} {kl} {y}: 선수 {len(diff)}명, wOBA 차이 퍼짐 {sd:.3f}, 표본 잡음 {noise:.3f}, 잡음 뺀 참 퍼짐 {true_sd:.3f}, 리그 평균 차이 {diff.mean():+.3f}')
        for a, b in [(2023, 2024), (2024, 2025)]:
            j = pd.concat([diffs[a], diffs[b]], axis=1, join='inner').dropna()
            r = np.corrcoef(j.iloc[:, 0], j.iloc[:, 1])[0, 1] if len(j) > 5 else float('nan')
            print(f'  {label} {kl} {a}→{b} 같은 선수 상관 r = {r:+.3f} (n={len(j)})')

print('wOBA 가중치는 대략값(볼넷 0.69 … 홈런 2.03)이고 희생번트·타격방해는 뺐다.')
