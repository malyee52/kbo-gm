#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""투구 단위 자료 → 볼카운트 사슬 능력(능력치 v2 16-1)의 리그 칸 표와 선수별 가공값 (data-src/pbp_derived/).

기획: docs/능력치v2_기획안.md 1.2(타자 능력), 1.5(투수 능력), 1.8(칸 함수와 새 가공표).
사용법:  python -I -X utf8 tools/pbp_plate.py [원본 폴더]
읽는 것: 원본 폴더(기본 data-src/naver_pbp/)의 kbo_pbp_{연도}.parquet (원본, 커밋하지 않는다, 받는 법은 data-src/pbp_derived/README.md)
만드는 것:
  count_zone.csv     연도 × 칸(볼-스트라이크) × 존 안/밖: 공, 스윙 안 함(볼·루킹 스트라이크·사구), 스윙(헛스윙·파울·인플레이), 번트
  batter_plate.csv   타자-시즌: 존 안·밖 공과 스윙, 스윙 중 맞힘, 2스트라이크 칸 맞힘, 맞힘 중 파울, 2스트라이크 타석·삼진.
                     exp_* = 같은 공을 리그 평균 타자가 받았을 때의 기대값 (그 해 칸 × 존별 리그 비율의 합). 능력 = logit(실제) − logit(기대)
  pitcher_plate.csv  투수-시즌: 공, 존 안 공, 스윙 중 맞힘, 맞힘 중 파울, 존 밖 스윙. exp_*는 같은 칸에서 리그 평균 투수의 기대값
정의:
  존 = |plate_x| ≤ 17/24 + 0.121피트, sz_bot − 0.121 ≤ plate_z ≤ sz_top + 0.121 (홈플레이트 반폭·공 반지름, 존 높이는 자료의 타자별 값)
  칸 = 그 공을 던지기 전 볼카운트. 스윙 = 헛스윙(S)·파울(F)·인플레이(H). 번트(W·V)는 스윙에서 뺀다 (기획안 1.2 "번트는 따로").
  위치가 없는 공(약 2%), 고의4구 타석의 공은 선수 값·리그 비율에서 뺀다 (count_zone.csv의 zone 'na' 행에 공 수만 남긴다).
같은 입력이면 같은 결과가 나온다 (정렬·반올림 고정).
출처: slothman3878, "KBO Play-by-Play 2023-2026 (v0)" (Hugging Face, CC BY 4.0).
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pbp_derive  # noqa: E402
from pbp_derive import KEY, OUT, PARTIAL, YEARS, pa_table, r  # noqa: E402

HALF_W = 17 / 24 + 0.121
BALL_R = 0.121
SWING = {'swinging_strike', 'foul', 'in_play'}
CONTACT = {'foul', 'in_play'}


def write(name, cols, rows):
    pd.DataFrame(rows, columns=cols).to_csv(OUT / name, index=False, encoding='utf-8', lineterminator='\n')


def prepare(year):
    df = pbp_derive.load(year)
    pa = pa_table(df)
    ibb = pa.loc[pa.ibb, KEY]
    df = df[(df.pitch_number > 0) & df.cat.notna()].copy()
    df = df.merge(ibb.assign(_ibb=True), on=KEY, how='left')
    df = df[df._ibb.isna()].drop(columns='_ibb')
    df['cell'] = df.balls.astype(int) * 3 + df.strikes.astype(int)
    df = df[(df.balls <= 3) & (df.strikes <= 2)]
    loc = df.plate_x.notna() & df.plate_z.notna() & df.sz_top.notna() & df.sz_bot.notna()
    df['zone'] = np.where(~loc, 'na', np.where(
        (df.plate_x.abs() <= HALF_W) & (df.plate_z >= df.sz_bot - BALL_R) & (df.plate_z <= df.sz_top + BALL_R), 'in', 'out'))
    df['bunt'] = df.cat.isin(['bunt_foul', 'bunt_miss'])
    df['swing'] = df.cat.isin(SWING)
    df['contact'] = df.cat.isin(CONTACT)
    df['foul'] = df.cat == 'foul'
    return df, pa


def main():
    if len(sys.argv) > 1:
        pbp_derive.RAW = Path(sys.argv[1])
    zone_rows, bat_rows, pit_rows = [], [], []
    for year in YEARS:
        part = 1 if year in PARTIAL else 0
        df, pa = prepare(year)
        for (cell, zone), g in df.groupby(['cell', 'zone']):
            vc = g.cat.value_counts()
            zone_rows.append([year, part, cell // 3, cell % 3, zone, len(g), int(vc.get('ball', 0)), int(vc.get('called_strike', 0)),
                              int(vc.get('hbp', 0)), int(vc.get('swinging_strike', 0)), int(vc.get('foul', 0)), int(vc.get('in_play', 0)),
                              int(g.bunt.sum())])
        # 리그 비율 (위치 있고 번트 아닌 공): 칸별 존 비율, 칸 × 존별 스윙·맞힘(스윙 중)·파울(맞힘 중)
        u = df[(df.zone != 'na') & ~df.bunt].copy()
        u['inz'] = u.zone == 'in'
        z_rate = u.groupby('cell').inz.mean()
        sw_rate = u.groupby(['cell', 'zone']).swing.mean()
        sw = u[u.swing]
        ct_rate = sw.groupby(['cell', 'zone']).contact.mean()
        ct = u[u.contact]
        fo_rate = ct.groupby(['cell', 'zone']).foul.mean()
        idx = pd.MultiIndex.from_arrays([u.cell, u.zone])
        u['e_zone'] = u.cell.map(z_rate).to_numpy()
        u['e_swing'] = sw_rate.reindex(idx).to_numpy()
        u['e_contact'] = ct_rate.reindex(idx).to_numpy()
        u['e_foul'] = fo_rate.reindex(idx).to_numpy()
        u['two'] = u.strikes == 2
        u['out'] = ~u.inz
        u['sw_c'] = u.swing * u.contact
        u['sw_e'] = u.swing * u.e_contact
        u['ct_f'] = u.contact * u.foul
        u['ct_e'] = u.contact * u.e_foul
        u['sw2'] = u.swing & u.two
        u['sw2_c'] = u.sw2 * u.contact
        u['sw2_e'] = u.sw2 * u.e_contact
        u['in_sw'] = u.inz & u.swing
        u['in_e'] = u.inz * u.e_swing
        u['out_sw'] = u.out & u.swing
        u['out_e'] = u.out * u.e_swing
        # 2스트라이크에 이른 타석과 그 삼진 (결과 있는 타석, 고의4구 뺌)
        done = pa[pa.ev.notna() & ~pa.ibb]
        reached = df[df.strikes == 2].groupby(KEY).size().rename('r2')
        d2 = done.join(reached, on=KEY)
        d2 = d2[d2.r2.notna() | (d2.ev == 'K')]
        for side, col, rows in (('bat', 'batter', bat_rows), ('pit', 'pitcher', pit_rows)):
            g = u.groupby(col).agg(n=('cell', 'size'), n_in=('inz', 'sum'), e_in=('e_zone', 'sum'),
                                   sw_in=('in_sw', 'sum'), e_sw_in=('in_e', 'sum'), n_out=('out', 'sum'),
                                   sw_out=('out_sw', 'sum'), e_sw_out=('out_e', 'sum'),
                                   swings=('swing', 'sum'), contact=('sw_c', 'sum'), e_contact=('sw_e', 'sum'),
                                   sw2=('sw2', 'sum'), contact2=('sw2_c', 'sum'), e_contact2=('sw2_e', 'sum'),
                                   contacts=('contact', 'sum'), fouls=('ct_f', 'sum'), e_fouls=('ct_e', 'sum'))
            npa = done.groupby(col).size()
            p2 = d2.groupby(col).size()
            k2 = d2[d2.ev == 'K'].groupby(col).size()
            for code, x in g.sort_index().iterrows():
                base = [year, part, code, int(npa.get(code, 0)), int(x.n)]
                if side == 'bat':
                    rows.append(base + [int(x.n_in), int(x.sw_in), r(x.e_sw_in, 3), int(x.n_out), int(x.sw_out), r(x.e_sw_out, 3),
                                        int(x.swings), int(x.contact), r(x.e_contact, 3), int(x.sw2), int(x.contact2), r(x.e_contact2, 3),
                                        int(x.contacts), int(x.fouls), r(x.e_fouls, 3), int(p2.get(code, 0)), int(k2.get(code, 0))])
                else:
                    rows.append(base + [int(x.n_in), r(x.e_in, 3), int(x.n_out), int(x.sw_out), r(x.e_sw_out, 3),
                                        int(x.swings), int(x.contact), r(x.e_contact, 3),
                                        int(x.contacts), int(x.fouls), r(x.e_fouls, 3), int(p2.get(code, 0)), int(k2.get(code, 0))])
        print(year, '공', len(df), '위치 있음·번트 아님', len(u), '존 안', r(u.inz.mean()), '스윙', r(u.swing.mean()),
              '맞힘', r(sw.contact.mean()), '타자', len(bat_rows), '투수', len(pit_rows))
    write('count_zone.csv', ['year', 'partial', 'balls', 'strikes', 'zone', 'pitches', 'ball', 'called_strike', 'hbp',
                             'swinging_strike', 'foul', 'in_play', 'bunt'], zone_rows)
    write('batter_plate.csv', ['year', 'partial', 'id', 'pa', 'pitches', 'n_in', 'sw_in', 'exp_sw_in', 'n_out', 'sw_out', 'exp_sw_out',
                               'swings', 'contact', 'exp_contact', 'swings_2s', 'contact_2s', 'exp_contact_2s',
                               'contacts', 'fouls', 'exp_fouls', 'pa_2s', 'k_2s'], bat_rows)
    write('pitcher_plate.csv', ['year', 'partial', 'id', 'bf', 'pitches', 'n_in', 'exp_in', 'n_out', 'sw_out', 'exp_sw_out',
                                'swings', 'contact', 'exp_contact', 'contacts', 'fouls', 'exp_fouls', 'pa_2s', 'k_2s'], pit_rows)


if __name__ == '__main__':
    main()
