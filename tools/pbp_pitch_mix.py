#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""구종 × 코스 × 공 결과 리그 표 (경기 엔진 2 20단계, docs/경기엔진2_기획안.md 3.4.1·6장 20-1~20-4).

사용법:  python -I -X utf8 tools/pbp_pitch_mix.py [원본 폴더]   (기본 data-src/naver_pbp)
읽는 것: kbo_pbp_{2023,2024,2025}.parquet (온전한 시즌만, 커밋하지 않는다. 출처·내려받기는 data-src/pbp_derived/README.md)
만드는 것: data-src/pbp_derived/pitch_type_zone.csv (리그 단위, 선수별 값 없음)와 그 값을 엔진 상수로 옮긴 src/engine/pitchTable.ts (자동 생성)
  구종(pitch_type, 엔진 표준 이름) × 코스(zone) 칸마다 공 결과 건수:
  b 볼, c 루킹 스트라이크, s 헛스윙(번트 헛스윙 포함), f 파울(번트 파울 포함), h 사구, 맞힘(인플레이) 결과 x1b·x2b·x3b·xhr·xout (안타 밖은 모두 xout)
  코스: mid 가운데(존 가로·세로 가운데 ⅓), in_high·in_low·out_high·out_low 존 안 나머지(타자 몸쪽·바깥쪽 × 존 위·아래 절반), chase 존 밖.
  존: |plate_x| ≤ 0.83피트(홈플레이트 반 + 공 반지름), sz_bot ≤ plate_z ≤ sz_top. 몸쪽은 우타 plate_x < 0, 좌타 plate_x > 0 (포수 시점).
  좌표가 없는 공은 코스 'none'으로 따로 센다 (엔진은 코스 표에 쓰지 않는다).
같은 입력이면 같은 결과가 나온다 (정렬 고정).
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data-src' / 'pbp_derived' / 'pitch_type_zone.csv'
YEARS = [2023, 2024, 2025]
KEY = ['game_pk', 'at_bat_number']
# 문자중계 구종 기호 → 엔진 표준 구종 이름 (src/data/pitches.ts와 같은 낱말, 슬러브는 슬라이더로)
TYPE = {'FF': '포심', 'SI': '투심', 'FC': '커터', 'SL': '슬라이더', 'ST': '스위퍼', 'SV': '슬라이더',
        'CU': '커브', 'CH': '체인지업', 'FO': '포크', 'KN': '너클볼'}
RESULT = {'B': 'b', 'T': 'c', 'S': 's', 'V': 's', 'F': 'f', 'W': 'f', 'H': 'x'}
HIT = {'single': 'x1b', 'double': 'x2b', 'triple': 'x3b', 'home_run': 'xhr'}
COLS = ['b', 'c', 's', 'f', 'h', 'x1b', 'x2b', 'x3b', 'xhr', 'xout']
ZONES = ['mid', 'in_high', 'in_low', 'out_high', 'out_low', 'chase', 'none']
HALF = 0.83


def region(df):
    x = df.plate_x
    z = df.plate_z
    bot, top = df.sz_bot, df.sz_top
    known = x.notna() & z.notna() & bot.notna() & top.notna()
    inz = known & (x.abs() <= HALF) & (z >= bot) & (z <= top)
    h = top - bot
    mid = inz & (x.abs() <= HALF / 3) & (z >= bot + h / 3) & (z <= top - h / 3)
    xin = np.where(df.stand == 'R', -x, x)
    inside = xin > 0
    high = z > (bot + top) / 2
    out = np.where(~known, 'none', np.where(~inz, 'chase', np.where(mid, 'mid',
                   np.where(inside, np.where(high, 'in_high', 'in_low'), np.where(high, 'out_high', 'out_low')))))
    return out


def main():
    raw = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data-src' / 'naver_pbp'
    parts = []
    for y in YEARS:
        df = pd.read_parquet(raw / f'kbo_pbp_{y}.parquet')
        df = df[(df.pitch_number > 0) & df.pitch_type.isin(TYPE.keys()) & df.pitch_result.notna()].copy()
        df = df.sort_values(['game_date', 'game_pk', 'at_bat_number', 'pitch_number'], kind='mergesort')
        last = df.pitch_number == df.groupby(KEY).pitch_number.transform('max')
        cat = df.pitch_result.map(RESULT)
        # 자료는 사구를 B로 적는다: 타석 마지막 공이고 결과가 사구면 사구
        cat = cat.where(~((df.pitch_result == 'B') & last & (df.events == 'hit_by_pitch')), 'h')
        hit = df.events.map(HIT).fillna('xout')
        cat = cat.where(cat != 'x', hit)
        df['cat'] = cat
        df['type'] = df.pitch_type.map(TYPE)
        df['zone'] = region(df)
        parts.append(df[df.cat.notna()][['type', 'zone', 'cat', 'balls', 'strikes']])
    all_ = pd.concat(parts)
    tab = all_.groupby(['type', 'zone', 'cat']).size().unstack('cat', fill_value=0).reindex(columns=COLS, fill_value=0)
    order = {t: i for i, t in enumerate(['포심', '투심', '커터', '슬라이더', '스위퍼', '커브', '체인지업', '포크', '너클볼'])}
    rows = []
    for (t, z), v in tab.iterrows():
        rows.append([t, z] + [int(v[c]) for c in COLS])
    rows.sort(key=lambda r: (order[r[0]], ZONES.index(r[1])))
    pd.DataFrame(rows, columns=['pitch_type', 'zone'] + COLS).to_csv(OUT, index=False, encoding='utf-8', lineterminator='\n')
    print(f'→ {OUT.relative_to(ROOT)} ({len(all_)}구, {YEARS[0]}~{YEARS[-1]})')
    write_ts(rows, all_, order)


def write_ts(rows, all_, order):
    types = sorted({r[0] for r in rows}, key=lambda t: order[t])
    zones = ZONES[:-1]
    lines = ['// 자동 생성: python -I -X utf8 tools/pbp_pitch_mix.py (고치지 않는다). 투구 단위 리그 집계: slothman3878, "KBO Play-by-Play 2023-2026 (v0)"',
             f'// (Hugging Face, CC BY 4.0)를 가공. KBO·네이버와 무관한 비공식 자료. {YEARS[0]}~{YEARS[-1]} 온전한 시즌을 합쳤다 (data-src/pbp_derived/pitch_type_zone.csv).',
             '',
             '/** 공 결과 칸 순서: 볼, 루킹, 헛스윙, 파울, 사구, 맞힘 뒤 단타·2루타·3루타·홈런·아웃 */',
             f"export const PITCH_OUTCOMES = {COLS!r} as const;",
             f"export const ZONE_KEYS = {zones!r} as const;",
             '',
             '/** 구종 → 코스 → 공 결과 건수 (코스 좌표가 없는 공 제외) */',
             'export const ZONE_COUNTS: Record<string, Record<string, readonly number[]>> = {']
    by = {(r[0], r[1]): r[2:] for r in rows}
    for t in types:
        inner = ', '.join(f"{z}: [{', '.join(str(x) for x in by.get((t, z), [0] * len(COLS)))}]" for z in zones)
        lines.append(f"  '{t}': {{ {inner} }},")
    lines.append('};')
    lines.append('')
    lines.append('/** 카운트 칸(볼 × 3 + 스트라이크) → 구종별 공 수 (좌표 없는 공 포함, 리그 볼 배합) */')
    lines.append('export const COUNT_TYPE_COUNTS: Record<string, readonly number[]> = {')
    ct = all_.groupby(['type', 'balls', 'strikes']).size()
    for t in types:
        v = [int(ct.get((t, b, s), 0)) for b in range(4) for s in range(3)]
        lines.append(f"  '{t}': [{', '.join(str(x) for x in v)}],")
    lines.append('};')
    ts = ROOT / 'src' / 'engine' / 'pitchTable.ts'
    NL = chr(10)
    ts.write_text(NL.join(lines).replace('"', "'") + NL, encoding='utf-8', newline=NL)
    print(f'→ {ts.relative_to(ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
