#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""투구 단위 문자중계 → 세이브 상황 구원 등판과 블론 나눔 (엔진 2 10단계 블론 원인 분해, data-src/pbp_derived/save_situations.csv).

사용법:  python -I -X utf8 tools/pbp_saves.py
읽는 것: data-src/naver_pbp/kbo_pbp_{2023,2024,2025}.parquet (커밋하지 않는다)
만드는 것 (리그 단위, 선수별 값 없음):
  save_situations.csv   해 × 구분(kind) × 칸(key)별 수
    kind=entry_inning: 세이브 상황 구원 등판의 등판 회('~6'·'7'·'8'·'9~')별 등판(n)·블론(blown)
    kind=entry_lead:   등판 때 리드 1·2·3·4+별 등판·블론
    kind=entry_runners: 등판 때 누상 주자 0~3별 등판·블론
    kind=late_lead:    7회 이후 반 이닝 시작 때 수비 팀 리드(-4 이하 … +4 이상)별 반 이닝 수(n)
    kind=late_runs:    7회 이후 반 이닝 수(n)와 그 득점(blown 칸에 득점)
    kind=total:        세이브 상황 구원 등판 전체 (n)·블론, 구원 등판 전체(key=all_relief)
정의는 엔진과 같다 (engine/state.ts isSaveSituation: 1~3점 리드, 또는 리드 ≤ 누상 주자 + 2. 블론 = 그 투수가 마운드에 있는 동안 리드가 사라짐).
등판 시점의 점수·주자는 그 투수의 첫 공 직전 값이다. 같은 입력이면 같은 결과.
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data-src' / 'naver_pbp'
OUT = ROOT / 'data-src' / 'pbp_derived'
YEARS = [2023, 2024, 2025]


def inning_key(i):
    return '~6' if i <= 6 else '9~' if i >= 9 else str(i)


def main():
    rows = []
    for year in YEARS:
        df = pd.read_parquet(RAW / f'kbo_pbp_{year}.parquet')
        df = df.sort_values(['game_date', 'game_pk', 'at_bat_number', 'pitch_number'], kind='mergesort').reset_index(drop=True)
        top = df.inning_topbot == 'top'
        df['fld_team'] = np.where(top, df.home_team, df.away_team)
        # 수비 팀 기준 리드 (공 전·후)
        df['lead_pre'] = np.where(top, df.home_score - df.away_score, df.away_score - df.home_score)
        df['lead_post'] = np.where(top, df.post_home_score - df.post_away_score, df.post_away_score - df.post_home_score)
        df['runners'] = df[['on_1b', 'on_2b', 'on_3b']].notna().sum(axis=1)
        df['seq'] = np.arange(len(df))
        first = df.groupby(['game_pk', 'fld_team']).pitcher.transform('first')
        rel = df[df.pitcher != first]
        app = rel.groupby(['game_pk', 'fld_team', 'pitcher'], sort=False).agg(
            inning=('inning', 'first'), lead=('lead_pre', 'first'), runners=('runners', 'first'),
            min_lead=('lead_post', 'min')).reset_index()
        app['save_sit'] = (app.lead >= 1) & ((app.lead <= 3) | (app.lead <= app.runners + 2))
        app['blown'] = app.save_sit & (app.min_lead <= 0)
        ss = app[app.save_sit]
        rows.append([year, 'total', 'all_relief', len(app), 0])
        rows.append([year, 'total', 'save_sit', len(ss), int(ss.blown.sum())])
        for key, g in ss.groupby(ss.inning.map(inning_key)):
            rows.append([year, 'entry_inning', key, len(g), int(g.blown.sum())])
        for key, g in ss.groupby(ss.lead.clip(upper=4)):
            rows.append([year, 'entry_lead', f'{int(key)}' if key < 4 else '4+', len(g), int(g.blown.sum())])
        for key, g in ss.groupby('runners'):
            rows.append([year, 'entry_runners', str(int(key)), len(g), int(g.blown.sum())])
        # 7회 이후 반 이닝: 시작 때 리드와 득점
        # 득점 = 반 이닝 마지막 공 뒤 리드와 첫 공 전 리드의 차 (수비 팀 리드가 준 만큼)
        half = df[df.inning >= 7].groupby(['game_pk', 'inning', 'inning_topbot'], sort=False).agg(
            lead=('lead_pre', 'first'), end=('lead_post', 'last')).reset_index()
        half['runs'] = half.lead - half.end
        for key, g in half.groupby(half.lead.clip(-4, 4)):
            rows.append([year, 'late_lead', str(int(key)), len(g), 0])
        rows.append([year, 'late_runs', 'half_innings', len(half), int(half.runs.sum())])
        print(f'{year}: 구원 등판 {len(app):,}, 세이브 상황 {len(ss):,}, 블론 {int(ss.blown.sum())}')
    pd.DataFrame(rows, columns=['year', 'kind', 'key', 'n', 'blown']).to_csv(
        OUT / 'save_situations.csv', index=False, encoding='utf-8', lineterminator='\n')


if __name__ == '__main__':
    main()
