#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""투구 단위 문자중계 자료 → 번트 타석 가공값 (data-src/pbp_derived/bunt.csv). 경기 엔진 2 8단계 (docs/경기엔진2_기획안.md 6장).

사용법:  python -I -X utf8 tools/pbp_bunt.py
읽는 것: data-src/naver_pbp/kbo_pbp_{2023,2024,2025,2026}.parquet (커밋하지 않는다, 내려받기는 data-src/pbp_derived/README.md)
만드는 것 (리그 단위, 선수별 값 없음):
  bunt.csv  해마다
    - sac_bunt: 희생번트로 끝난 타석 수, 평균 투구 수, 투구 수 분포 (1~5, 6 이상)
    - bunt_pa: 번트 헛스윙(V)·번트 파울(W) 공이 하나라도 있는 타석. 결과 묶음별 수 (희생번트 아닌 번트 시도의 끝, 강공 전환 포함)
    - bunt_k: 2스트라이크 번트 파울(W)로 끝난 삼진
같은 입력이면 같은 결과가 나온다.
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data-src' / 'naver_pbp'
OUT = ROOT / 'data-src' / 'pbp_derived' / 'bunt.csv'
YEARS = [2023, 2024, 2025, 2026]
PARTIAL = {2026}
KEY = ['game_pk', 'at_bat_number']
GROUP = {'sac_bunt': 'SH', 'single': 'H', 'double': 'H', 'triple': 'H', 'home_run': 'H', 'strikeout': 'K',
         'walk': 'BB', 'hit_by_pitch': 'BB', 'field_out': 'OUT', 'double_play': 'DP', 'triple_play': 'DP',
         'fielders_choice': 'FC', 'field_error': 'ROE', 'sac_fly': 'OUT', 'catcher_interference': 'BB'}


def main():
    rows = []
    for year in YEARS:
        df = pd.read_parquet(RAW / f'kbo_pbp_{year}.parquet', columns=KEY + ['pitch_number', 'pitch_result', 'events'])
        df = df[df.pitch_number > 0]
        g = df.groupby(KEY)
        n = g.size().rename('n')
        last = g.tail(1).set_index(KEY)
        ev = last.events
        bunted = df.pitch_result.isin(['V', 'W']).groupby([df[k] for k in KEY]).any()
        pa = pd.DataFrame({'n': n, 'ev': ev, 'bunted': bunted, 'last': last.pitch_result})
        pa = pa[pa.ev.notna()]
        sh = pa[pa.ev == 'sac_bunt']
        dist = [(sh.n == k).mean() for k in range(1, 6)] + [(sh.n >= 6).mean()]
        bp = pa[pa.bunted]
        grp = bp.ev.map(GROUP).fillna('OUT').value_counts()
        rows.append({
            'year': year, 'partial': int(year in PARTIAL), 'pa': len(pa),
            'sac_bunt': len(sh), 'sac_pitches': round(float(sh.n.mean()), 3),
            **{f'p{k}': round(float(v), 4) for k, v in zip(['1', '2', '3', '4', '5', '6plus'], dist)},
            'bunt_pa': len(bp), 'bunt_pa_pitches': round(float(bp.n.mean()), 3),
            **{f'bunt_{k}': int(grp.get(k, 0)) for k in ['SH', 'H', 'K', 'BB', 'OUT', 'DP', 'FC', 'ROE']},
            'bunt_k_on_w': int(((bp.ev == 'strikeout') & (bp['last'] == 'W')).sum()),
        })
    pd.DataFrame(rows).to_csv(OUT, index=False, encoding='utf-8', lineterminator='\n')
    print(pd.DataFrame(rows).to_string())


if __name__ == '__main__':
    main()
