# 공개 특수능력 크기 재료: 좌우·홈원정 선수별 참 퍼짐과 상황 빈도 (2026-10-26, 공개 스킬 기획 16-6)
# 실행: python -I -X utf8 tools/pbp_skill_spread.py <원본 parquet 폴더>  (data-src/naver_pbp, 원본은 저장소에 넣지 않는다. 출처 CC BY 4.0: data-src/pbp_derived/README.md)
# tools/pbp_clutch.py와 같은 방식: 선수별 wOBA 차이의 퍼짐에서 표본 잡음을 빼 참 퍼짐을 내고, 같은 선수 해마다 상관을 본다. 리그 단위 요약만 출력한다.
# 투수 손은 원본에 없어 투수별 릴리스 x 중앙값의 부호로 짐작한다 (출력에 좌투 비율을 함께 낸다).
import sys
import numpy as np
import pandas as pd

RAW = sys.argv[1]
YEARS = [2023, 2024, 2025]
W = {'walk': 0.69, 'hit_by_pitch': 0.72, 'single': 0.88, 'double': 1.25, 'triple': 1.58, 'home_run': 2.03}
NOT_PA = {'sac_bunt', 'catcher_interference'}


def load(y):
    d = pd.read_parquet(f'{RAW}/kbo_pbp_{y}.parquet', columns=['game_pk', 'at_bat_number', 'pitch_number', 'inning', 'inning_topbot', 'batter', 'pitcher',
                                                             'on_1b', 'on_2b', 'on_3b', 'home_score', 'away_score', 'events', 'stand', 'release_pos_x'])
    hand = d.groupby('pitcher')['release_pos_x'].median()
    d = d.sort_values(['game_pk', 'at_bat_number', 'pitch_number']).groupby(['game_pk', 'at_bat_number']).tail(1)
    d = d[d['events'].notna() & ~d['events'].isin(NOT_PA)].copy()
    d['woba'] = d['events'].map(W).fillna(0.0)
    # 포수 쪽에서 본 릴리스 x: 우투는 음수 쪽 (Statcast 관례)
    d['p_left'] = d['pitcher'].map(hand) > 0
    d['bat_home'] = d['inning_topbot'] != 'top'
    d['risp'] = d['on_2b'].notna() | d['on_3b'].notna()
    d['on'] = d['on_1b'].notna() | d['risp']
    lead = np.where(d['inning_topbot'] == 'top', d['away_score'] - d['home_score'], d['home_score'] - d['away_score'])
    d['late2'] = (d['inning'] >= 7) & (np.abs(lead) <= 2)
    d['clutch_sit'] = d['risp'] | d['late2']
    d['year'] = y
    return d, (hand > 0).mean()


def spread(d, who, key, min_t, min_f):
    """key가 참인 타석과 거짓인 타석의 wOBA 차이: 선수 사이 퍼짐, 표본 잡음, 참 퍼짐. 차이 Series도 돌려준다"""
    g = d.groupby([who, key])['woba'].agg(['mean', 'count']).unstack(key).dropna()
    g = g[(g[('count', True)] >= min_t) & (g[('count', False)] >= min_f)]
    diff = g[('mean', True)] - g[('mean', False)]
    var_pa = d['woba'].var()
    noise = np.sqrt((var_pa / g[('count', True)] + var_pa / g[('count', False)]).mean())
    sd = diff.std()
    return diff, sd, noise, np.sqrt(max(0.0, sd ** 2 - noise ** 2))


def corr(a, b):
    j = pd.concat([a, b], axis=1, join='inner').dropna()
    return (j.corr().iloc[0, 1] if len(j) >= 10 else float('nan')), len(j)


data = {}
for y in YEARS:
    d, left = load(y)
    data[y] = d
    pa = len(d)
    print(f'{y}: 타석 {pa}, 좌투 짐작 비율(투수 수) {left:.2f}, 좌투 상대 타석 비율 {d["p_left"].mean():.3f}, 리그 wOBA {d["woba"].mean():.3f}')
    print(f'  상황 빈도 (타석 몫): 득점권 {d["risp"].mean():.3f}, 7회 이후 2점 차 이내 {d["late2"].mean():.3f}, 둘 중 하나(승부사 조건) {d["clutch_sit"].mean():.3f}, 주자 있음 {d["on"].mean():.3f}')

print()
print('좌우: 같은 손 타자 안에서 (좌투 상대 wOBA − 우투 상대 wOBA). 양타는 뺀다. 표본 하한 좌투 상대 60 · 우투 상대 150 타석')
prev = {}
for y in YEARS:
    d = data[y]
    for st in ['L', 'R']:
        sub = d[d['stand'] == st]
        diff, sd, noise, true = spread(sub, 'batter', 'p_left', 60, 150)
        print(f'  {y} {st}타자: 선수 {len(diff)}명, 리그 평균 차이 {diff.mean():+.3f}, 퍼짐 {sd:.3f}, 잡음 {noise:.3f}, 참 퍼짐 {true:.3f}')
        if (st, y - 1) in prev:
            r, n = corr(prev[(st, y - 1)] - prev[(st, y - 1)].mean(), diff - diff.mean())
            print(f'    {y - 1}→{y} 같은 선수 상관 r = {r:+.3f} (n={n})')
        prev[(st, y)] = diff

print()
print('좌우 (투수): 좌타 상대 wOBA − 우타 상대 wOBA, 같은 손 투수 안에서. 표본 하한 좌타 80 · 우타 80 상대 타자')
prev = {}
for y in YEARS:
    d = data[y][data[y]['stand'].isin(['L', 'R'])].copy()
    d['b_left'] = d['stand'] == 'L'
    for hand, name in [(True, '좌투'), (False, '우투')]:
        sub = d[d['p_left'] == hand]
        diff, sd, noise, true = spread(sub, 'pitcher', 'b_left', 80, 80)
        print(f'  {y} {name}: 선수 {len(diff)}명, 리그 평균 차이 {diff.mean():+.3f}, 퍼짐 {sd:.3f}, 잡음 {noise:.3f}, 참 퍼짐 {true:.3f}')
        if (hand, y - 1) in prev:
            r, n = corr(prev[(hand, y - 1)] - prev[(hand, y - 1)].mean(), diff - diff.mean())
            print(f'    {y - 1}→{y} 같은 선수 상관 r = {r:+.3f} (n={n})')
        prev[(hand, y)] = diff

print()
print('홈·원정: 홈 wOBA − 원정 wOBA. 표본 하한 홈·원정 각 150 타석 (투수 150 상대 타자)')
for who, label in [('batter', '타자'), ('pitcher', '투수')]:
    prev = None
    for y in YEARS:
        diff, sd, noise, true = spread(data[y], who, 'bat_home', 150, 150)
        if who == 'pitcher':
            pass  # 투수 쪽 차이 = (상대 타자가 홈 = 투수 원정) − (투수 홈) 피wOBA라 + 가 "홈에서 좋음"
        print(f'  {y} {label}: 선수 {len(diff)}명, 리그 평균 차이 {diff.mean():+.3f}, 퍼짐 {sd:.3f}, 잡음 {noise:.3f}, 참 퍼짐 {true:.3f}')
        if prev is not None:
            r, n = corr(prev - prev.mean(), diff - diff.mean())
            print(f'    {y - 1}→{y} 같은 선수 상관 r = {r:+.3f} (n={n})')
        prev = diff

print()
print('투수 주자 있음: 주자 있을 때 피wOBA − 없을 때 (위기 탈출). 표본 하한 100 · 150 상대 타자')
prev = None
for y in YEARS:
    diff, sd, noise, true = spread(data[y], 'pitcher', 'on', 100, 150)
    print(f'  {y}: 선수 {len(diff)}명, 리그 평균 차이 {diff.mean():+.3f}, 퍼짐 {sd:.3f}, 잡음 {noise:.3f}, 참 퍼짐 {true:.3f}')
    if prev is not None:
        r, n = corr(prev - prev.mean(), diff - diff.mean())
        print(f'    {y - 1}→{y} 같은 선수 상관 r = {r:+.3f} (n={n})')
    prev = diff

print()
print('여름(7~8월) wOBA − 나머지 달 (여름 사나이). 표본 하한 여름 120 · 나머지 250 타석 (투수 상대 타자, + 가 투수 여름에 나쁨)')
for who, label in [('batter', '타자'), ('pitcher', '투수')]:
    prev = None
    for y in YEARS:
        d = data[y]
        m = pd.read_parquet(f'{RAW}/kbo_pbp_{y}.parquet', columns=['game_pk', 'game_date']).drop_duplicates('game_pk').set_index('game_pk')['game_date']
        d = d.assign(summer=pd.to_datetime(d['game_pk'].map(m)).dt.month.isin([7, 8]))
        diff, sd, noise, true = spread(d, who, 'summer', 120, 250)
        print(f'  {y} {label}: 선수 {len(diff)}명, 여름 타석 몫 {d["summer"].mean():.3f}, 리그 평균 차이 {diff.mean():+.3f}, 퍼짐 {sd:.3f}, 잡음 {noise:.3f}, 참 퍼짐 {true:.3f}')
        if prev is not None:
            r, n = corr(prev - prev.mean(), diff - diff.mean())
            print(f'    {y - 1}→{y} 같은 선수 상관 r = {r:+.3f} (n={n})')
        prev = diff
