#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""리그 연도별 타구 유형·방향 비율 엑셀 → 가공값 (data-src/batted_ball_derived/). **임시값 (출처 미확인)**.

사용법:  python -I -X utf8 tools/batted_ball_derive.py
읽는 것: data-src/batted_ball/KBO_타구유형_타구방향_2010-2026.xlsx (커밋하지 않는다. 사용자가 다른 곳에서 찾은 값을
         GPT가 엑셀로 정리한 것, 원 출처 미확인 — 2026-10-22 사용자)
         data-src/naver_pbp/kbo_pbp_{2023..2026}.parquet (있으면, 표본 수가 시즌 인플레이 타구 수와 맞는지 대조)
만드는 것: data-src/batted_ball_derived/batted_ball.csv  연도별 비율과 엔진에 쓸 수 있는 몫(GB÷(GB+FB), 방향 비율), 대조 열
같은 입력이면 같은 결과가 나온다.
"""
import csv
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data-src' / 'batted_ball' / 'KBO_타구유형_타구방향_2010-2026.xlsx'
PBP = ROOT / 'data-src' / 'naver_pbp'
OUT = ROOT / 'data-src' / 'batted_ball_derived'
STATUS = '임시값(출처 미확인)'


def sheet_rows(ws, ncols):
    """머리글 다음의 연도 행만"""
    out = {}
    for row in ws.iter_rows(values_only=True):
        if isinstance(row[0], int):
            out[row[0]] = row[1:ncols]
    return out


def pbp_counts(year):
    """시즌 인플레이 타구 수, 인플레이 아웃(+실책·야수선택·희생) 수, 양타 타자를 뺀 인플레이 수"""
    p = PBP / f'kbo_pbp_{year}.parquet'
    if not p.exists():
        return None
    import pandas as pd
    df = pd.read_parquet(p, columns=['batter', 'stand', 'pitch_result', 'events', 'game_date'])
    ip = df[df.pitch_result == 'H']
    outs = ip.events.isin(['field_out', 'double_play', 'triple_play', 'sac_fly', 'sac_bunt', 'fielders_choice', 'field_error']).sum()
    st = df.dropna(subset=['stand']).groupby(['batter', 'stand']).size().unstack(fill_value=0)
    # 한 시즌에 좌·우 타석 모두 10구 이상 = 양타
    switch = set(st[(st.get('L', 0) >= 10) & (st.get('R', 0) >= 10)].index)
    return {'in_play': len(ip), 'outs': int(outs), 'non_switch': int((~ip.batter.isin(switch)).sum()),
            'last_date': df.game_date.max()}


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    typ = sheet_rows(wb['타구 유형'], 7)  # GB%, FB%, LD%, PU%, GB/FB, 표본
    dirs = sheet_rows(wb['타구 방향'], 5)  # 당겨, 중앙, 밀어, 표본
    rows = []
    for year in sorted(set(typ) | set(dirs)):
        gb, fb, ld, pu, gbfb, tn = typ.get(year, (None,) * 6)
        pull, center, oppo, dn = dirs.get(year, (None,) * 4)
        c = pbp_counts(year)
        rows.append([
            year, STATUS, gb, fb, ld, pu, gbfb, tn, pull, center, oppo, dn,
            round(gb / (gb + fb), 4) if gb and fb else '',
            c['in_play'] if c else '', c['outs'] if c else '', c['non_switch'] if c else '', c['last_date'] if c else '',
            round(tn / c['in_play'], 4) if c and tn else '', round(tn / c['outs'], 4) if c and tn else '',
            round(dn / c['non_switch'], 4) if c and dn else '',
        ])
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / 'batted_ball.csv').open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['year', 'status', 'gb_pct', 'fb_pct', 'ld_pct', 'pu_pct', 'gb_fb', 'type_n', 'pull_pct', 'center_pct',
                    'oppo_pct', 'dir_n', 'gb_share_of_gb_fb', 'pbp_in_play', 'pbp_in_play_outs', 'pbp_in_play_non_switch',
                    'pbp_last_date', 'type_n_per_in_play', 'type_n_per_out', 'dir_n_per_non_switch'])
        w.writerows(rows)
    print(f'→ {(OUT / "batted_ball.csv").relative_to(ROOT)} ({len(rows)}해)')


if __name__ == '__main__':
    sys.exit(main())
