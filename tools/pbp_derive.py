#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""투구 단위 문자중계 자료 → 리그 단위 가공값 (data-src/pbp_derived/). 경기 엔진 2 (docs/경기엔진2_기획안.md 3.6·5장)용.

사용법:  python -I -X utf8 tools/pbp_derive.py
읽는 것: data-src/naver_pbp/kbo_pbp_{2023,2024,2025,2026}.parquet (커밋하지 않는다, 내려받기는 data-src/pbp_derived/README.md)
         public/data/seasons/{연도}.json (검증 대조용 리그 합계)
만드는 것 (모두 리그 단위, 선수별 값 없음):
  count_chain.json        카운트 12칸별 투구 결과 확률 (볼카운트 사슬 모양, 기획안 3.6)
  count_pitch.csv         같은 값의 표 (건수와 확률)
  count_pa_outcome.csv    카운트별 타석 결과: 그 카운트에서 끝난 타석(ending), 그 카운트를 지난 타석(through)
  pa_pitches.csv          타석당 투구 수 분포와 결과별 평균
  starter_pitches.csv     선발 투구 수 분포·이닝·상대 타자
  starter_ip_pitches.csv  선발 이닝 ↔ 투구 수 관계 (구간별)
  relief.csv              구원 등판당 투구 수·아웃, 연투·3연투 비율
  relief_rest.csv         구원 등판 전 휴식일 분포
  team_pitching.csv       구단-시즌별 선발 투구 수·100구 이상 비율, 구원 연투·3연투 비율 (감독 성향 '투수 밀어붙이기'·'불펜 연투 허용', 엔진 2 10단계),
                          고의4구 수·상대 타석 (감독 성향 '고의4구 빈도', 엔진 2 13단계)
  team_lineup.csv         구단-시즌별 선발 라인업 변동: 전 경기와 선발 9명이 다른 경기 비율, 바뀐 사람 수 평균 (감독 성향 '컨디션 반영' 대리값, 13단계)
  ibb.csv                 고의4구 팀·시즌당 수 (투구 없는 자동 고의4구 + 볼 3개 전에 끝난 볼넷 = 카운트 중 고의4구 선언)
  pitch_types.csv         구종 비율과 평균 구속
  pitch_types_count.csv   카운트별 구종 비율
  home_away.csv           홈 승률, 홈·원정 경기당 득점
  platoon.csv             타자 좌타·우타별 결과
  league_summary.csv      리그 요약 (엔진 검증 지표에 맞춘 값)
  validation.csv          집계값 대 게임 데이터(public/data/seasons) 리그 합계 대조
같은 입력이면 같은 결과가 나온다 (정렬·반올림 고정).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data-src' / 'naver_pbp'
OUT = ROOT / 'data-src' / 'pbp_derived'
SEASONS = ROOT / 'public' / 'data' / 'seasons'
YEARS = [2023, 2024, 2025, 2026]
PARTIAL = {2026: '2026-07-26까지 (부분 시즌)'}
KEY = ['game_pk', 'at_bat_number']

# 투구 결과 분류 (사슬 칸). B는 타석 마지막 공이고 결과가 사구면 사구로 나눈다 (자료가 사구를 B로 적음)
PITCH_CATS = ['ball', 'called_strike', 'swinging_strike', 'foul', 'in_play', 'hbp', 'bunt_foul', 'bunt_miss']
RESULT_CAT = {'B': 'ball', 'T': 'called_strike', 'S': 'swinging_strike', 'F': 'foul', 'H': 'in_play',
              'W': 'bunt_foul', 'V': 'bunt_miss'}
# 타석 결과 묶음
EVENT_CODE = {
    'strikeout': 'K', 'walk': 'BB', 'hit_by_pitch': 'HBP', 'single': '1B', 'double': '2B', 'triple': '3B',
    'home_run': 'HR', 'field_out': 'OUT', 'double_play': 'DP', 'triple_play': 'DP', 'sac_fly': 'SF',
    'sac_bunt': 'SH', 'field_error': 'ROE', 'fielders_choice': 'FC', 'catcher_interference': 'CI',
}
OUTCOMES = ['K', 'BB', 'HBP', '1B', '2B', '3B', 'HR', 'OUT', 'DP', 'SF', 'SH', 'ROE', 'FC', 'CI']
IN_PLAY = ['1B', '2B', '3B', 'HR', 'OUT', 'DP', 'SF', 'SH', 'ROE', 'FC', 'CI']
PITCH_KO = {'FF': '직구', 'SI': '투심·싱커', 'FC': '커터', 'SL': '슬라이더', 'ST': '스위퍼', 'SV': '슬러브',
            'CU': '커브', 'CH': '체인지업', 'FO': '포크', 'KN': '너클볼'}


def r(x, nd=4):
    """반올림 고정 (재현용). NaN은 빈 칸"""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return ''
    return round(float(x), nd)


def write_csv(name, rows, cols):
    df = pd.DataFrame(rows, columns=cols)
    df.to_csv(OUT / name, index=False, encoding='utf-8', lineterminator='\n')


def load(year):
    df = pd.read_parquet(RAW / f'kbo_pbp_{year}.parquet')
    df = df.sort_values(['game_date', 'game_pk', 'at_bat_number', 'pitch_number'], kind='mergesort').reset_index(drop=True)
    df['year'] = year
    # 수비 팀 = 초에는 홈, 말에는 원정
    df['fld_team'] = np.where(df.inning_topbot == 'top', df.home_team, df.away_team)
    df['bat_team'] = np.where(df.inning_topbot == 'top', df.away_team, df.home_team)
    df['last'] = df.pitch_number == df.groupby(KEY).pitch_number.transform('max')
    df['ev'] = df.events.map(EVENT_CODE)  # null(이닝이 타석 중 끝남)은 NaN
    cat = df.pitch_result.map(RESULT_CAT)
    cat = cat.where(~((df.pitch_result == 'B') & df['last'] & (df.events == 'hit_by_pitch')), 'hbp')
    df['cat'] = cat  # 투구 없는 타석(pitch_number 0)은 NaN
    return df


def pa_table(df):
    """타석 하나 = 한 행 (마지막 공). 결과 없는 타석(이닝이 타석 중 끝남)도 남긴다"""
    last = df[df['last']].copy()
    npitch = df[df.pitch_number > 0].groupby(KEY).size().rename('npitch')
    last = last.join(npitch, on=KEY)
    last['npitch'] = last.npitch.fillna(0).astype(int)
    last['ibb_auto'] = last.pitch_number == 0
    # 볼 3개가 되기 전에 볼넷으로 끝난 타석 = 카운트 중간에 고의4구를 선언 (마지막 공은 실제 볼)
    last['ibb_mid'] = (last.events == 'walk') & (last.pitch_number > 0) & (last.balls < 3)
    last['ibb'] = last.ibb_auto | last.ibb_mid
    last['outs_made'] = last.post_outs - last.outs_when_up
    return last


def slash(counts):
    """결과 건수 dict → 타율·출루율·장타율·삼진·볼넷 비율"""
    c = {k: counts.get(k, 0) for k in OUTCOMES}
    pa = sum(c.values())
    h = c['1B'] + c['2B'] + c['3B'] + c['HR']
    ab = pa - c['BB'] - c['HBP'] - c['SF'] - c['SH'] - c['CI']
    tb = c['1B'] + 2 * c['2B'] + 3 * c['3B'] + 4 * c['HR']
    return {
        'pa': pa, 'avg': h / ab if ab else np.nan,
        'obp': (h + c['BB'] + c['HBP']) / (ab + c['BB'] + c['HBP'] + c['SF']) if pa else np.nan,
        'slg': tb / ab if ab else np.nan, 'k_rate': c['K'] / pa if pa else np.nan,
        'bb_rate': c['BB'] / pa if pa else np.nan, 'hr_rate': c['HR'] / pa if pa else np.nan,
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    chain = {'source': 'slothman3878/kbo_playbyplay v0 (CC BY 4.0)', 'note':
             '카운트(볼-스트라이크)별 다음 공 결과 확률. 투구 없는 자동 고의4구 제외. 2스트라이크 파울은 카운트 유지, '
             '2스트라이크 번트 파울(bunt_foul)은 삼진. hbp는 사구로 끝난 공', 'years': {}}
    rows = {k: [] for k in ['count_pitch', 'count_pa', 'pa_pitches', 'starter', 'starter_rel', 'relief', 'rest',
                            'ibb', 'team', 'lineup', 'ptype', 'ptype_count', 'home', 'platoon', 'summary', 'validation']}

    for year in YEARS:
        part = 1 if year in PARTIAL else 0
        df = load(year)
        pa = pa_table(df)
        done = pa[pa.ev.notna()]  # 결과가 있는 타석
        pitched = df[df.pitch_number > 0]

        # ---- 1. 카운트별 투구 결과 (사슬) ----
        cc = pitched.groupby(['balls', 'strikes', 'cat']).size().unstack(fill_value=0)
        cc = cc.reindex(columns=PITCH_CATS, fill_value=0)
        ychain = {}
        for (b, s), row in cc.iterrows():
            n = int(row.sum())
            probs = {c: r(row[c] / n, 5) for c in PITCH_CATS}
            ychain[f'{b}-{s}'] = {'n': n, **probs}
            rows['count_pitch'].append([year, part, b, s, n] + [int(row[c]) for c in PITCH_CATS]
                                       + [r(row[c] / n, 5) for c in PITCH_CATS])
        chain['years'][str(year)] = {'partial': bool(part), 'counts': ychain}

        # ---- 2. 카운트별 타석 결과 ----
        nonibb = done[~done.ibb]
        # ending: 마지막 공 직전 카운트
        for (b, s), g in nonibb.groupby(['balls', 'strikes']):
            vc = g.ev.value_counts().to_dict()
            sl = slash(vc)
            rows['count_pa'].append([year, part, 'ending', b, s, len(g)] + [vc.get(o, 0) for o in OUTCOMES]
                                    + [r(sl['avg']), r(sl['obp']), r(sl['slg'])])
        # through: 그 카운트의 공이 하나라도 있었던 타석
        thr = pitched[['game_pk', 'at_bat_number', 'balls', 'strikes']].drop_duplicates()
        thr = thr.merge(nonibb[KEY + ['ev']], on=KEY)
        for (b, s), g in thr.groupby(['balls', 'strikes']):
            vc = g.ev.value_counts().to_dict()
            sl = slash(vc)
            rows['count_pa'].append([year, part, 'through', b, s, len(g)] + [vc.get(o, 0) for o in OUTCOMES]
                                    + [r(sl['avg']), r(sl['obp']), r(sl['slg'])])

        # ---- 3. 타석당 투구 수 ----
        groups = {'all': nonibb, 'K': nonibb[nonibb.ev == 'K'], 'BB': nonibb[nonibb.ev == 'BB'],
                  'HBP': nonibb[nonibb.ev == 'HBP'], 'in_play': nonibb[nonibb.ev.isin(IN_PLAY)]}
        for name, g in groups.items():
            np_ = g.npitch
            dist = [int((np_ == k).sum()) for k in range(1, 11)] + [int((np_ >= 11).sum())]
            rows['pa_pitches'].append([year, part, name, len(g), r(np_.mean(), 3), r(np_.std(ddof=0), 3)]
                                      + [r(x / len(g), 4) for x in dist])

        # ---- 4. 선발 ----
        # 팀별 경기 첫 공의 투수 = 선발
        first = pitched.groupby(['game_pk', 'fld_team']).pitcher.first().rename('starter')
        app = pitched.groupby(['game_pk', 'game_date', 'fld_team', 'pitcher'], sort=False).agg(
            pitches=('pitch_number', 'size'), first_idx=('at_bat_number', 'min')).reset_index()
        # 아웃·상대 타자는 타석 마지막 공의 투수에게
        outs = pa.groupby(['game_pk', 'fld_team', 'pitcher']).outs_made.sum().rename('outs')
        bf = done.groupby(['game_pk', 'fld_team', 'pitcher']).size().rename('bf')
        app = app.join(outs, on=['game_pk', 'fld_team', 'pitcher']).join(bf, on=['game_pk', 'fld_team', 'pitcher'])
        app[['outs', 'bf']] = app[['outs', 'bf']].fillna(0).astype(int)
        app = app.join(first, on=['game_pk', 'fld_team'])
        app['is_start'] = app.pitcher == app.starter
        st = app[app.is_start]
        p = st.pitches
        pct = np.percentile(p, [10, 25, 50, 75, 90])
        corr = np.corrcoef(st.pitches, st.outs)[0, 1]
        rows['starter'].append([year, part, len(st), r(p.mean(), 2), r(p.std(ddof=0), 2)] + [r(x, 1) for x in pct]
                               + [r((p >= 100).mean()), r((p >= 110).mean()), r(st.outs.mean() / 3, 3),
                                  r(st.bf.mean(), 2), r((st.outs >= 18).mean()), r(p.sum() / max(1, st.outs.sum()) * 3, 2),
                                  r(corr, 3)])
        for lo, hi, label in [(0, 60, '~59'), (60, 80, '60~79'), (80, 90, '80~89'), (90, 100, '90~99'),
                              (100, 110, '100~109'), (110, 999, '110~')]:
            g = st[(st.pitches >= lo) & (st.pitches < hi)]
            rows['starter_rel'].append([year, part, 'pitches', label, len(g), r(g.outs.mean() / 3, 3) if len(g) else '',
                                        r(g.pitches.mean(), 1) if len(g) else ''])
        for lo, hi, label in [(0, 9, '~2.2'), (9, 12, '3~3.2'), (12, 15, '4~4.2'), (15, 18, '5~5.2'),
                              (18, 21, '6~6.2'), (21, 24, '7~7.2'), (24, 99, '8~')]:
            g = st[(st.outs >= lo) & (st.outs < hi)]
            rows['starter_rel'].append([year, part, 'innings', label, len(g), r(g.outs.mean() / 3, 3) if len(g) else '',
                                        r(g.pitches.mean(), 1) if len(g) else ''])

        # ---- 5. 구원 ----
        rp = app[~app.is_start].copy()
        team_games = pitched.groupby('fld_team').game_pk.nunique().sum()
        # 휴식일: 같은 투수의 바로 앞 등판(선발 포함)과의 날짜 차이 - 1
        allapp = app[['pitcher', 'game_date', 'game_pk', 'first_idx', 'is_start', 'fld_team']].copy()
        allapp['d'] = pd.to_datetime(allapp.game_date)
        allapp = allapp.sort_values(['pitcher', 'd', 'game_pk'], kind='mergesort')
        allapp['prev_d'] = allapp.groupby('pitcher').d.shift(1)
        allapp['prev2_d'] = allapp.groupby('pitcher').d.shift(2)
        allapp['rest'] = (allapp.d - allapp.prev_d).dt.days - 1
        allapp['three'] = ((allapp.d - allapp.prev_d).dt.days == 1) & ((allapp.prev_d - allapp.prev2_d).dt.days == 1)
        ra = allapp[~allapp.is_start]
        has_prev = ra.rest.notna()
        rq = rp.pitches
        rows['relief'].append([year, part, len(rp), r(len(rp) / team_games, 3), r(rq.mean(), 2), r(rq.std(ddof=0), 2)]
                              + [r(x, 1) for x in np.percentile(rq, [10, 25, 50, 75, 90])]
                              + [r((rq >= 30).mean()), r(rp.outs.mean(), 3), r(rp.outs.sum() / app.outs.sum()),
                                 r((ra.rest[has_prev] == 0).mean()), r(ra.three[has_prev].mean()),
                                 r((ra.rest[has_prev] < 0).mean())])
        buckets = [('같은 날 (더블헤더)', lambda x: x < 0), ('0 (연투)', lambda x: x == 0), ('1', lambda x: x == 1),
                   ('2', lambda x: x == 2), ('3', lambda x: x == 3), ('4', lambda x: x == 4),
                   ('5~9', lambda x: (x >= 5) & (x <= 9)), ('10~', lambda x: x >= 10)]
        rr = ra.rest[has_prev]
        for label, f in buckets:
            rows['rest'].append([year, part, label, int(f(rr).sum()), r(f(rr).mean())])

        # 구단별 (팀 코드 = 문자중계 표기). 연투·3연투는 앞 등판이 있는 구원 등판 중 비율 (리그 값과 같은 정의)
        for team in sorted(app.fld_team.unique()):
            ts_ = st[st.fld_team == team].pitches
            tra = ra[ra.fld_team == team]
            thp = tra.rest.notna()
            tgames = pitched[pitched.fld_team == team].game_pk.nunique()
            tpa = pa[(pa.fld_team == team) & pa.ev.notna()]
            rows['team'].append([year, part, team, len(ts_), r(ts_.mean(), 2), r((ts_ >= 100).mean()), len(tra),
                                 r(len(tra) / tgames, 3), r((tra.rest[thp] == 0).mean()), r(tra.three[thp].mean()),
                                 int(tpa.ibb.sum()), len(tpa)])

        # 구단별 선발 라인업 변동 (감독 성향 '컨디션 반영' 대리값, 엔진 2 13단계): 경기마다 그 팀 첫 9타석의 타자 = 선발 9명.
        # 전 경기(날짜·경기 순)와 선발 9명 구성이 다른 경기 비율, 바뀐 사람 수 평균. 첫 9타석이 안 되는 경기는 건너뛴다
        first9 = pa.sort_values(KEY, kind='mergesort').groupby(['game_pk', 'bat_team'], sort=False).head(9)
        lineups = first9.groupby(['bat_team', 'game_date', 'game_pk'], sort=True).batter.apply(lambda b: frozenset(b) if len(b) == 9 else None)
        for team in sorted(pa.bat_team.unique()):
            prev, n, changed, moved = None, 0, 0, 0
            for lu in lineups.loc[team]:
                if lu is None or len(lu) != 9:
                    prev = None
                    continue
                if prev is not None:
                    n += 1
                    d = len(lu - prev)
                    changed += d > 0
                    moved += d
                prev = lu
            rows['lineup'].append([year, part, team, n, r(changed / n), r(moved / n, 3)])

        # ---- 6. 자동 고의4구 ----
        ibb = pa[pa.ibb]
        per_team = ibb.groupby('fld_team').size().reindex(sorted(df.fld_team.unique()), fill_value=0)
        rows['ibb'].append([year, part, len(ibb), int(ibb.ibb_auto.sum()), int(ibb.ibb_mid.sum()),
                            r(len(ibb) / len(per_team), 2), int(per_team.min()), int(per_team.max()),
                            r(len(ibb) / done.shape[0] * 1000, 3)])

        # ---- 7. 구종 ----
        pt = pitched[pitched.pitch_type.notna()]
        tot = len(pt)
        for code, g in pt.groupby('pitch_type'):
            sp = g.release_speed_kmh.dropna()
            rows['ptype'].append([year, part, code, PITCH_KO.get(code, ''), len(g), r(len(g) / tot, 5),
                                  len(sp), r(sp.mean(), 2), r(sp.std(ddof=0), 2)])
        for (b, s), g in pt.groupby(['balls', 'strikes']):
            vc = g.pitch_type.value_counts()
            for code in sorted(vc.index):
                rows['ptype_count'].append([year, part, b, s, code, int(vc[code]), r(vc[code] / len(g), 5)])

        # ---- 8. 홈·원정 ----
        fin = df.groupby('game_pk').agg(home=('home_team', 'first'), away=('away_team', 'first'),
                                        hs=('post_home_score', 'last'), as_=('post_away_score', 'last'))
        hw, aw = int((fin.hs > fin.as_).sum()), int((fin.hs < fin.as_).sum())
        ties = int((fin.hs == fin.as_).sum())
        rows['home'].append([year, part, len(fin), hw, aw, ties, r(hw / (hw + aw)), r(fin.hs.mean(), 3), r(fin.as_.mean(), 3)])
        # 팀 승률 표준편차
        rec = {}
        for _, g in fin.iterrows():
            for t, us, them in ((g.home, g.hs, g.as_), (g.away, g.as_, g.hs)):
                w_, l_ = rec.get(t, (0, 0))
                rec[t] = (w_ + (us > them), l_ + (us < them))
        pcts = [w_ / (w_ + l_) for w_, l_ in rec.values()]

        # ---- 9. 좌타·우타 ----
        for hand in ['L', 'R']:
            g = done[done.stand == hand]
            sl = slash(g.ev.value_counts().to_dict())
            rows['platoon'].append([year, part, hand, sl['pa'], r(sl['avg']), r(sl['obp']), r(sl['slg']),
                                    r(sl['k_rate']), r(sl['bb_rate']), r(sl['hr_rate'])])

        # ---- 10. 리그 요약 ----
        vc = done.ev.value_counts().to_dict()
        sl = slash(vc)
        npa = len(done)
        tg = 2 * len(fin)
        bat_pa = done.groupby(['bat_team', 'batter']).size()
        top9 = np.mean([g.sort_values(ascending=False).head(9).sum() / g.sum() for _, g in bat_pa.groupby(level=0)])
        pit_outs = app.groupby(['fld_team', 'pitcher']).outs.sum()
        top5 = np.mean([g.sort_values(ascending=False).head(5).sum() / g.sum() for _, g in pit_outs.groupby(level=0)])
        # 규정 타석(팀 경기 × 3.1) 타자 BABIP 표준편차
        teams_n = len(rec)
        qual = 3.1 * tg / teams_n
        bb = done.groupby('batter').ev.value_counts().unstack(fill_value=0).reindex(columns=OUTCOMES, fill_value=0)
        bpa = bb.sum(axis=1)
        q = bb[bpa >= qual]
        h_ = q['1B'] + q['2B'] + q['3B']
        ab_ = q.sum(axis=1) - q.BB - q.HBP - q.SF - q.SH - q.CI
        babip = h_ / (ab_ - q.K - q.HR + q.SF)
        lg_babip = (vc.get('1B', 0) + vc.get('2B', 0) + vc.get('3B', 0)) / (
            sl['pa'] - sum(vc.get(k, 0) for k in ['BB', 'HBP', 'SH', 'CI', 'K', 'HR']))
        summ = {
            'games': len(fin), 'pa': npa, 'runs_per_team_game': (fin.hs.sum() + fin.as_.sum()) / tg,
            'avg': sl['avg'], 'obp': sl['obp'], 'slg': sl['slg'], 'k_rate': sl['k_rate'], 'bb_rate': sl['bb_rate'],
            'hbp_rate': vc.get('HBP', 0) / npa, 'hr_rate': sl['hr_rate'],
            's1_rate': vc.get('1B', 0) / npa, 'd2_rate': vc.get('2B', 0) / npa, 't3_rate': vc.get('3B', 0) / npa,
            'babip': lg_babip, 'dp_per_pa': vc.get('DP', 0) / npa, 'sf_per_pa': vc.get('SF', 0) / npa,
            'sh_per_pa': vc.get('SH', 0) / npa, 'roe_per_pa': vc.get('ROE', 0) / npa, 'fc_per_pa': vc.get('FC', 0) / npa,
            'pa_per_team_game': npa / tg, 'pitches_per_pa': nonibb.npitch.mean(), 'pitches_per_pa_all': len(pitched) / npa,
            'pitches_per_team_game': len(pitched) / tg, 'home_win_pct': hw / (hw + aw), 'tie_rate': ties / len(fin),
            'team_win_pct_sd': float(np.std(pcts)), 'top9_pa_share': top9, 'top5_ip_share': top5,
            'starter_pitches': st.pitches.mean(), 'starter_ip': st.outs.mean() / 3, 'starter_bf': st.bf.mean(),
            'relief_out_share': rp.outs.sum() / app.outs.sum(), 'relief_apps_per_team_game': len(rp) / team_games,
            'outs_per_relief_app': rp.outs.mean(), 'ibb_per_team': len(ibb) / teams_n,
            'qual_batters': len(q), 'qual_babip_sd': float(babip.std(ddof=0)),
            'null_event_pa': int(pa.ev.isna().sum()),
        }
        for k, v in summ.items():
            rows['summary'].append([year, part, k, r(v, 5) if isinstance(v, float) else v])

        # ---- 11. 게임 데이터 대조 ----
        sp = SEASONS / f'{year}.json'
        if sp.exists() and not part:
            lg = json.loads(sp.read_text(encoding='utf-8'))['league']
            ab = lg['ab']
            pairs = [
                ('pa', npa, lg['pa']), ('h', vc.get('1B', 0) + vc.get('2B', 0) + vc.get('3B', 0) + vc.get('HR', 0), lg['h']),
                ('2b', vc.get('2B', 0), lg['d']), ('3b', vc.get('3B', 0), lg['t']), ('hr', vc.get('HR', 0), lg['hr']),
                ('bb', vc.get('BB', 0), lg['bb']), ('hbp', vc.get('HBP', 0), lg['hbp']), ('so', vc.get('K', 0), lg['so']),
                ('sf', vc.get('SF', 0), lg['sf']), ('sh', vc.get('SH', 0), lg['sac']), ('gdp(병살+삼중살)', vc.get('DP', 0), lg['gdp']),
                ('runs', int(fin.hs.sum() + fin.as_.sum()), lg['r']),
                ('avg', sl['avg'], lg['h'] / ab),
                ('obp', sl['obp'], (lg['h'] + lg['bb'] + lg['hbp']) / (ab + lg['bb'] + lg['hbp'] + lg['sf'])),
                ('slg', sl['slg'], (lg['h'] + lg['d'] + 2 * lg['t'] + 3 * lg['hr']) / ab),
                ('k_rate', sl['k_rate'], lg['so'] / lg['pa']), ('bb_rate', sl['bb_rate'], lg['bb'] / lg['pa']),
            ]
            for name, mine, theirs in pairs:
                diff = (mine - theirs) / theirs if theirs else np.nan
                rows['validation'].append([year, name, r(mine, 5), r(theirs, 5), r(diff, 5)])
        print(f'{year}: 투구 {len(pitched):,} 타석 {npa:,} (결과 없음 {summ["null_event_pa"]}, 고의4구 {len(ibb)})')

    cnt = ['year', 'partial', 'balls', 'strikes', 'n'] + [f'n_{c}' for c in PITCH_CATS] + [f'p_{c}' for c in PITCH_CATS]
    write_csv('count_pitch.csv', rows['count_pitch'], cnt)
    write_csv('count_pa_outcome.csv', rows['count_pa'],
              ['year', 'partial', 'basis', 'balls', 'strikes', 'pa'] + [f'n_{o}' for o in OUTCOMES] + ['avg', 'obp', 'slg'])
    write_csv('pa_pitches.csv', rows['pa_pitches'], ['year', 'partial', 'group', 'pa', 'mean', 'sd']
              + [f'p{k}' for k in range(1, 11)] + ['p11plus'])
    write_csv('starter_pitches.csv', rows['starter'],
              ['year', 'partial', 'starts', 'mean', 'sd', 'p10', 'p25', 'p50', 'p75', 'p90', 'share_100plus',
               'share_110plus', 'mean_ip', 'mean_bf', 'share_6ip_plus', 'pitches_per_inning', 'corr_pitches_outs'])
    write_csv('starter_ip_pitches.csv', rows['starter_rel'], ['year', 'partial', 'by', 'bucket', 'starts', 'mean_ip', 'mean_pitches'])
    write_csv('relief.csv', rows['relief'],
              ['year', 'partial', 'apps', 'apps_per_team_game', 'mean_pitches', 'sd_pitches', 'p10', 'p25', 'p50', 'p75',
               'p90', 'share_30plus', 'mean_outs', 'relief_out_share', 'back_to_back_rate', 'three_straight_rate',
               'same_day_rate'])
    write_csv('team_pitching.csv', rows['team'], ['year', 'partial', 'team', 'starts', 'starter_mean', 'share_100plus',
                                                  'relief_apps', 'relief_per_game', 'back_to_back_rate', 'three_straight_rate',
                                                  'ibb', 'bf'])
    write_csv('team_lineup.csv', rows['lineup'], ['year', 'partial', 'team', 'games', 'changed_share', 'mean_changed'])
    write_csv('relief_rest.csv', rows['rest'], ['year', 'partial', 'rest_days', 'apps', 'share'])
    write_csv('ibb.csv', rows['ibb'], ['year', 'partial', 'ibb', 'ibb_no_pitch', 'ibb_mid_count', 'per_team', 'team_min', 'team_max', 'per_1000_pa'])
    write_csv('pitch_types.csv', rows['ptype'], ['year', 'partial', 'pitch_type', 'name_ko', 'pitches', 'share',
                                                 'speed_n', 'speed_mean_kmh', 'speed_sd_kmh'])
    write_csv('pitch_types_count.csv', rows['ptype_count'], ['year', 'partial', 'balls', 'strikes', 'pitch_type', 'pitches', 'share'])
    write_csv('home_away.csv', rows['home'], ['year', 'partial', 'games', 'home_w', 'away_w', 'ties', 'home_win_pct',
                                              'home_runs_per_game', 'away_runs_per_game'])
    write_csv('platoon.csv', rows['platoon'], ['year', 'partial', 'stand', 'pa', 'avg', 'obp', 'slg', 'k_rate', 'bb_rate', 'hr_rate'])
    write_csv('league_summary.csv', rows['summary'], ['year', 'partial', 'metric', 'value'])
    write_csv('validation.csv', rows['validation'], ['year', 'metric', 'pbp', 'game_data', 'diff'])
    (OUT / 'count_chain.json').write_text(json.dumps(chain, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    print(f'→ {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
