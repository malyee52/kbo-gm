# 공개 특수능력 2차 기획 재료: '때 나눔'(평균 0) 모양 스킬의 크기 근거 (2026-10-26, 공개 스킬 기획 16-6 2차)
# 실행: python -I -X utf8 tools/pbp_shape_spread.py <원본 parquet 폴더>  (data-src/naver_pbp, 원본은 저장소에 넣지 않는다. 출처 CC BY 4.0: data-src/pbp_derived/README.md)
# 재는 것 (리그 단위 요약만 출력):
#  1. 상황별 득점 가치 기울기: 타석 RE24 변화(주자·아웃 상태 기대 득점, 그 해 자료로 잼)를 wOBA 가중치에 회귀한 기울기를 상황 안·밖으로.
#     평균 0 재분배(상황 안 +Δ, 밖 −Δ·s/(1−s))의 타석당 득점 = s·Δ·(기울기 안 − 기울기 밖).
#  2. 선수별 '때' 차이의 참 퍼짐(퍼짐² − 표본 잡음²)과 같은 선수 해마다 상관 (tools/pbp_skill_spread.py와 같은 방식):
#     타자 초구 스윙률 − 나머지 칸 스윙률, 타자 2스트라이크 뒤 맞힌 공당 추가 루 − 그 전, 투수 초구 존 비율 − 나머지 칸 존 비율,
#     투수 주자 있을 때 맞힌 공당 홈런 − 없을 때, 타자·투수 병살 상황 인플레이당 병살.
import sys
import numpy as np
import pandas as pd

RAW = sys.argv[1]
YEARS = [2023, 2024, 2025]
W = {'walk': 0.69, 'hit_by_pitch': 0.72, 'single': 0.88, 'double': 1.25, 'triple': 1.58, 'home_run': 2.03}
XB = {'double': 1, 'triple': 2, 'home_run': 3}
NOT_PA = {'sac_bunt', 'catcher_interference'}
SWING = {'S', 'F', 'H'}
INPLAY = {'field_out', 'single', 'double', 'triple', 'home_run', 'fielders_choice', 'double_play', 'field_error', 'sac_fly', 'triple_play'}


def logit(p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


def load(y):
    d = pd.read_parquet(f'{RAW}/kbo_pbp_{y}.parquet', columns=['game_pk', 'at_bat_number', 'pitch_number', 'inning', 'inning_topbot', 'batter', 'pitcher',
                                                             'balls', 'strikes', 'outs_when_up', 'on_1b', 'on_2b', 'on_3b', 'home_score', 'away_score',
                                                             'pitch_result', 'plate_x', 'plate_z', 'sz_top', 'sz_bot', 'events', 'runs_scored', 'post_outs',
                                                             'post_on_1b', 'post_on_2b', 'post_on_3b'])
    d = d.sort_values(['game_pk', 'at_bat_number', 'pitch_number']).reset_index(drop=True)
    d['swing'] = d['pitch_result'].isin(SWING)
    d['zone'] = (d['plate_x'].abs() <= 17 / 24 + 0.121) & (d['plate_z'] >= d['sz_bot'] - 0.121) & (d['plate_z'] <= d['sz_top'] + 0.121)
    d['has_loc'] = d['plate_x'].notna() & d['plate_z'].notna() & d['sz_top'].notna()
    d['first'] = (d['balls'] == 0) & (d['strikes'] == 0)
    d['year'] = y
    pa = d.groupby(['game_pk', 'at_bat_number']).agg(reached2s=('strikes', 'max')).reset_index()
    last = d.groupby(['game_pk', 'at_bat_number']).tail(1).merge(pa, on=['game_pk', 'at_bat_number'])
    last = last[last['events'].notna() & ~last['events'].isin(NOT_PA)].copy()
    last['woba'] = last['events'].map(W).fillna(0.0)
    last['risp'] = last['on_2b'].notna() | last['on_3b'].notna()
    last['on'] = last['on_1b'].notna() | last['risp']
    lead = np.where(last['inning_topbot'] == 'top', last['away_score'] - last['home_score'], last['home_score'] - last['away_score'])
    last['late2'] = (last['inning'] >= 7) & (np.abs(lead) <= 2)
    last['late1'] = (last['inning'] >= 7) & (np.abs(lead) <= 1)
    last['clutch_sit'] = last['risp'] | last['late2']
    last['dp_sit'] = last['on_1b'].notna() & (last['outs_when_up'] < 2)
    last['inplay'] = last['events'].isin(INPLAY)
    last['xb'] = last['events'].map(XB).fillna(0.0)
    last['hr'] = last['events'] == 'home_run'
    last['dp'] = last['events'].isin({'double_play', 'triple_play'})
    last['two_s'] = last['reached2s'] >= 2
    # RE24: 그 해 자료로 (주자 상태, 아웃) → 이닝 끝까지 득점의 평균
    last['bases'] = last['on_1b'].notna().astype(int) + 2 * last['on_2b'].notna().astype(int) + 4 * last['on_3b'].notna().astype(int)
    last['post_bases'] = last['post_on_1b'].notna().astype(int) + 2 * last['post_on_2b'].notna().astype(int) + 4 * last['post_on_3b'].notna().astype(int)
    half = last['game_pk'].astype(str) + last['inning'].astype(str) + last['inning_topbot'].astype(str)
    last['rs'] = last['runs_scored'].fillna(0)
    last['rest'] = last.groupby(half)['rs'].transform(lambda s: s[::-1].cumsum()[::-1])  # 이 타석 포함 이닝 끝까지
    re = last.groupby(['bases', 'outs_when_up'])['rest'].mean()
    pre = re.reindex(list(zip(last['bases'], last['outs_when_up']))).to_numpy()
    post_key = list(zip(last['post_bases'], last['post_outs'].fillna(3).clip(upper=3)))
    post = np.array([0.0 if o >= 3 else re.get((b, o), np.nan) for b, o in post_key])
    last['re24'] = post - pre + last['rs']
    return d, last


def spread_rate(g, num_t, den_t, num_f, den_f, min_t, min_f):
    """두 비율(조건 안 num_t/den_t − 밖 num_f/den_f)의 선수 사이 퍼짐과 이항 잡음, 참 퍼짐"""
    g = g[(g[den_t] >= min_t) & (g[den_f] >= min_f)]
    a = g[num_t] / g[den_t]
    b = g[num_f] / g[den_f]
    diff = a - b
    noise = np.sqrt((a * (1 - a) / g[den_t] + b * (1 - b) / g[den_f]).mean())
    sd = diff.std()
    return diff, sd, noise, np.sqrt(max(0.0, sd ** 2 - noise ** 2))


def spread_mean(df, who, key, val, min_t, min_f):
    g = df.groupby([who, key])[val].agg(['mean', 'count', 'var']).unstack(key).dropna()
    g = g[(g[('count', True)] >= min_t) & (g[('count', False)] >= min_f)]
    diff = g[('mean', True)] - g[('mean', False)]
    v = df[val].var()
    noise = np.sqrt((v / g[('count', True)] + v / g[('count', False)]).mean())
    sd = diff.std()
    return diff, sd, noise, np.sqrt(max(0.0, sd ** 2 - noise ** 2))


def corr(a, b):
    j = pd.concat([a, b], axis=1, join='inner').dropna()
    return (j.corr().iloc[0, 1] if len(j) >= 10 else float('nan')), len(j)


def report(name, rows):
    print(name)
    prev = None
    for y, (diff, sd, noise, true) in rows:
        print(f'  {y}: 선수 {len(diff)}명, 리그 평균 {diff.mean():+.4f}, 퍼짐 {sd:.4f}, 잡음 {noise:.4f}, 참 퍼짐 {true:.4f}')
        if prev is not None:
            r, n = corr(prev - prev.mean(), diff - diff.mean())
            print(f'    {y - 1}→{y} 같은 선수 상관 r = {r:+.3f} (n={n})')
        prev = diff


pitches, pas = {}, {}
for y in YEARS:
    pitches[y], pas[y] = load(y)

print('1. 상황별 득점 가치: RE24를 wOBA 가중치에 회귀한 기울기 (런 / wOBA 1), 상황 몫 s, 평균 0 재분배 Δ=0.01 wOBA의 600타석 득점')
for key in ['risp', 'clutch_sit', 'on', 'late1', 'dp_sit']:
    out = []
    for y in YEARS:
        L = pas[y]
        L = L[np.isfinite(L['re24'])]
        sl = {}
        for v in [True, False]:
            sub = L[L[key] == v]
            sl[v] = np.polyfit(sub['woba'], sub['re24'], 1)[0]
        s = L[key].mean()
        out.append(f'{y} s {s:.3f} 안 {sl[True]:.3f} 밖 {sl[False]:.3f} → {600 * s * 0.01 * (sl[True] - sl[False]):+.2f}런')
    print(f'  {key}: ' + ' | '.join(out))

print()
print('2. 같은 평균에서 때만 다른 차이 (선수 사이)')
rows = []
for y in YEARS:
    d = pitches[y]
    d = d[~d['pitch_result'].isin({'W', 'V'})]
    g = d.groupby(['batter', 'first'])['swing'].agg(['sum', 'count']).unstack('first').dropna()
    g.columns = ['sw_f', 'sw_t', 'n_f', 'n_t']
    rows.append((y, spread_rate(g, 'sw_t', 'n_t', 'sw_f', 'n_f', 80, 300)))
report('  타자 초구 스윙률 − 나머지 칸 스윙률 (초구 80개·나머지 300개 이상)', rows)

rows = []
for y in YEARS:
    L = pas[y]
    c = L[L['inplay']]
    rows.append((y, spread_mean(c, 'batter', 'two_s', 'xb', 60, 60)))
report('  타자 맞힌 공당 추가 루(2루타 1·3루타 2·홈런 3): 2스트라이크에 이른 타석 − 그 전에 끝난 타석 (각 60개 이상)', rows)

rows = []
for y in YEARS:
    d = pitches[y]
    d = d[d['has_loc']]
    g = d.groupby(['pitcher', 'first'])['zone'].agg(['sum', 'count']).unstack('first').dropna()
    g.columns = ['z_f', 'z_t', 'n_f', 'n_t']
    rows.append((y, spread_rate(g, 'z_t', 'n_t', 'z_f', 'n_f', 100, 400)))
report('  투수 초구 존 비율 − 나머지 칸 존 비율 (초구 100개·나머지 400개 이상)', rows)

rows = []
for y in YEARS:
    L = pas[y]
    c = L[L['inplay']].copy()
    c['hrf'] = c['hr'].astype(float)
    rows.append((y, spread_mean(c, 'pitcher', 'on', 'hrf', 80, 80)))
report('  투수 맞힌 공당 홈런: 주자 있음 − 없음 (각 80개 이상)', rows)

for who, mn in [('batter', 40), ('pitcher', 40)]:
    rows = []
    for y in YEARS:
        L = pas[y]
        c = L[L['inplay'] & L['dp_sit']].copy()
        c['dpf'] = c['dp'].astype(float)
        g = c.groupby(who)['dpf'].agg(['mean', 'count'])
        g = g[g['count'] >= mn]
        p = c['dpf'].mean()
        noise = np.sqrt((p * (1 - p) / g['count']).mean())
        sd = g['mean'].std()
        print(f'  {who} 병살 상황 인플레이당 병살 {y}: 리그 {p:.3f}, 선수 {len(g)}명, 퍼짐 {sd:.4f}, 잡음 {noise:.4f}, 참 퍼짐 {np.sqrt(max(0, sd**2 - noise**2)):.4f}')

print()
print('3. 리그 칸 몫 (타석 기준)')
for y in YEARS:
    L = pas[y]
    d = pitches[y]
    print(f'  {y}: 2스트라이크에 이른 타석 {L["two_s"].mean():.3f}, 그 타석 인플레이 몫 {L[L["inplay"]]["two_s"].mean():.3f}, 초구 공 몫 {d["first"].mean():.3f}, '
          f'병살 상황 {L["dp_sit"].mean():.3f}, 7회 이후 1점 차 {L["late1"].mean():.3f}, 맞힌 공당 추가 루 2S {L[L.inplay & L.two_s].xb.mean():.3f} / 그 전 {L[L.inplay & ~L.two_s].xb.mean():.3f}')
