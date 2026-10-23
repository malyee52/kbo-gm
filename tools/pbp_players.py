#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""투구 단위 자료 → 선수 연결 표와 선수별 가공값 (data-src/pbp_derived/). 경기 엔진 2 D단계 (docs/경기엔진2_기획안.md 6장).

사용법:  python -I -X utf8 tools/pbp_players.py
읽는 것: data-src/naver_pbp/kbo_pbp_{연도}.parquet (원본, 커밋하지 않는다, 받는 법은 data-src/pbp_derived/README.md)
         public/data/players.json·seasons/ (선수 연결 대조), data-src/hardhit_derived/pitch_hand.csv (투수 투구손)
         data-src/pbp_derived/{pa_pitches,relief,platoon,pitch_types}.csv (리그 가공값, 선수별 합 검사)
만드는 것 (선수별 가공값을 커밋한다: 사용자 결정 2026-10-22, 기획안 7장 18·19):
  player_link.csv        자료의 선수 코드 ↔ 게임 선수 ID, 이름 대조, 타석·상대 타자 수
  player_link_dupes.csv  같은 이름의 다른 게임 선수가 2022년 뒤에 뛴 연결 (손으로 확인할 목록)
  batter_ppa.csv         타자-시즌 타석당 투구 수 (고의4구 뺌, pa_pitches.csv의 all과 같은 정의)
  pitcher_ppa.csv        투수-시즌 타석당 투구 수 (같은 정의. 타석 공은 그 타석 마지막 공의 투수에게)
  pitcher_arsenal.csv    투수-시즌 구종별 공 수·비율·평균 구속
  relief_usage.csv       투수-시즌 등판·선발·구원 등판, 연투·3연투 횟수, 구원 등판 평균 투구 수·휴식일
  platoon_split.csv      선수-시즌 상대 투구손(타자) / 상대 타석 방향(투수)별 결과 건수
  platoon4.csv           리그 좌타·우타 × 좌투·우투 4칸 타율·출루율·장타율 (투구손은 하드힛 pitch_hand.csv)
  player_check.csv       선수별 값을 더한 합 대 리그 가공값
같은 입력이면 같은 결과가 나온다 (정렬·반올림 고정).
출처: slothman3878, "KBO Play-by-Play 2023-2026 (v0)" (Hugging Face, CC BY 4.0). 투구손 일부: 하드힛(https://hardhit.ai).
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pbp_derive import KEY, OUT, PARTIAL, PITCH_KO, ROOT, YEARS, load, pa_table, r  # noqa: E402

DATA = ROOT / 'public' / 'data'
HAND = ROOT / 'data-src' / 'hardhit_derived' / 'pitch_hand.csv'
SPLIT_EVENTS = ['K', 'BB', 'HBP', '1B', '2B', '3B', 'HR', 'SF', 'SH', 'CI']


def write(name, cols, rows):
    with (OUT / name).open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(cols)
        w.writerows(rows)


def read_csv(path):
    with path.open(encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def slash(c):
    """결과 건수(SPLIT_EVENTS + pa) → 타율·출루율·장타율"""
    h = c['1B'] + c['2B'] + c['3B'] + c['HR']
    ab = c['pa'] - c['BB'] - c['HBP'] - c['SF'] - c['SH'] - c['CI']
    tb = c['1B'] + 2 * c['2B'] + 3 * c['3B'] + 4 * c['HR']
    obp_d = ab + c['BB'] + c['HBP'] + c['SF']
    return (h / ab if ab else None, (h + c['BB'] + c['HBP']) / obp_d if obp_d else None, tb / ab if ab else None)


def main():
    players = {p['id']: p for p in json.loads((DATA / 'players.json').read_text(encoding='utf-8'))['players']}
    by_name = defaultdict(list)
    for p in players.values():
        by_name[p['name']].append(p['id'])
    hand = {(int(x['연도']), x['선수ID']): x['손'] for x in read_csv(HAND)}
    lg_ppa = {(int(x['year']), x['group']): x for x in read_csv(OUT / 'pa_pitches.csv')}
    lg_relief = {int(x['year']): x for x in read_csv(OUT / 'relief.csv')}
    lg_platoon = {(int(x['year']), x['stand']): x for x in read_csv(OUT / 'platoon.csv')}
    lg_ptype = {(int(x['year']), x['pitch_type']): x for x in read_csv(OUT / 'pitch_types.csv')}

    link = {}  # 코드 → {이름들, 연도들, 타석, 상대 타자}
    rows = defaultdict(list)
    check = []
    hand_src = defaultdict(int)
    for year in YEARS:
        part = 1 if year in PARTIAL else 0
        df = load(year)
        pa = pa_table(df)
        done = pa[pa.ev.notna()]
        nonibb = done[~done.ibb]
        pitched = df[df.pitch_number > 0]
        season = json.loads((DATA / 'seasons' / f'{year}.json').read_text(encoding='utf-8'))
        game_bat = {x[0] for x in season['bat']}
        game_pit = {x[0] for x in season['pit']}

        # ---- 연결 표 ----
        for code, name in pd.concat([done[['batter', 'batter_name']].set_axis(['c', 'n'], axis=1),
                                     done[['pitcher', 'pitcher_name']].set_axis(['c', 'n'], axis=1)]).drop_duplicates().itertuples(index=False):
            e = link.setdefault(code, {'names': set(), 'years': set(), 'pa': 0, 'bf': 0, 'in_season': True})
            e['names'].add(name)
            e['years'].add(year)
        for code, n in done.groupby('batter').size().items():
            link[code]['pa'] += int(n)
            if not part and code not in game_bat and code not in game_pit:
                link[code]['in_season'] = False
        for code, n in done.groupby('pitcher').size().items():
            link[code]['bf'] += int(n)
            if not part and code not in game_pit and code not in game_bat:
                link[code]['in_season'] = False

        # ---- 타석당 투구 수 (고의4구 뺌) ----
        for side, col, out in (('bat', 'batter', 'batter_ppa'), ('pit', 'pitcher', 'pitcher_ppa')):
            g = nonibb.groupby(col).agg(pa=('npitch', 'size'), pitches=('npitch', 'sum'))
            for code, x in g.sort_index().iterrows():
                rows[out].append([year, part, code, int(x.pa), int(x.pitches), r(x.pitches / x.pa, 3)])
            lg = lg_ppa[(year, 'all')]
            mine = g.pitches.sum() / g.pa.sum()
            check.append([year, f'{out}: 공 합 ÷ 타석 합', int(g.pa.sum()), r(mine, 5), lg['pa'], lg['mean'], r(mine - float(lg['mean']), 5)])

        # ---- 구종 ----
        pt = pitched[pitched.pitch_type.notna()]
        tot = pt.groupby('pitcher').size()
        for (code, typ), g in pt.groupby(['pitcher', 'pitch_type']):
            sp = g.release_speed_kmh.dropna()
            rows['arsenal'].append([year, part, code, typ, PITCH_KO.get(typ, ''), len(g), r(len(g) / tot[code], 4),
                                    len(sp), r(sp.mean(), 1) if len(sp) else ''])
        lgp = pt.pitch_type.value_counts()
        for typ, n in sorted(lgp.items()):
            mine = int(sum(x[5] for x in rows['arsenal'] if x[0] == year and x[3] == typ))
            check.append([year, f'구종 {typ} 공 수', len(tot), mine, '', int(lg_ptype[(year, typ)]['pitches']), mine - int(lg_ptype[(year, typ)]['pitches'])])

        # ---- 등판·연투 (pbp_derive.py 5절과 같은 정의) ----
        first = pitched.groupby(['game_pk', 'fld_team']).pitcher.first().rename('starter')
        app = pitched.groupby(['game_pk', 'game_date', 'fld_team', 'pitcher'], sort=False).agg(
            pitches=('pitch_number', 'size')).reset_index().join(first, on=['game_pk', 'fld_team'])
        app['is_start'] = app.pitcher == app.starter
        app['d'] = pd.to_datetime(app.game_date)
        app = app.sort_values(['pitcher', 'd', 'game_pk'], kind='mergesort')
        app['prev_d'] = app.groupby('pitcher').d.shift(1)
        app['prev2_d'] = app.groupby('pitcher').d.shift(2)
        app['rest'] = (app.d - app.prev_d).dt.days - 1
        app['three'] = ((app.d - app.prev_d).dt.days == 1) & ((app.prev_d - app.prev2_d).dt.days == 1)
        b2b_all = three_all = known_all = 0
        for code, g in app.groupby('pitcher'):
            rp = g[~g.is_start]
            known = rp[rp.rest.notna()]
            b2b, three = int((known.rest == 0).sum()), int(known.three.sum())
            b2b_all += b2b
            three_all += three
            known_all += len(known)
            rows['relief'].append([year, part, code, len(g), int(g.is_start.sum()), len(rp), len(known), b2b, three,
                                   r(known.rest[known.rest >= 0].mean(), 2) if len(known) else '',
                                   r(rp.pitches.mean(), 2) if len(rp) else ''])
        lr = lg_relief[year]
        check.append([year, '구원 연투 비율', known_all, r(b2b_all / known_all, 4), '', lr['back_to_back_rate'], r(b2b_all / known_all - float(lr['back_to_back_rate']), 4)])
        check.append([year, '구원 3연투 비율', known_all, r(three_all / known_all, 4), '', lr['three_straight_rate'], r(three_all / known_all - float(lr['three_straight_rate']), 4)])
        check.append([year, '구원 등판 수', int((~app.is_start).sum()), int((~app.is_start).sum()), '', lr['apps'], int((~app.is_start).sum()) - int(lr['apps'])])

        # ---- 좌우 분할 ----
        sp = done[done.stand.isin(['L', 'R'])].copy()

        def throws(code):
            h = hand.get((year, code)) or hand.get((year - 1, code))
            if h:
                hand_src['hardhit'] += 1
                return h
            t = players.get(code, {}).get('throws')
            hand_src['players.json' if t else 'none'] += 1
            return t

        tmap = {c: throws(c) for c in sp.pitcher.unique()}
        sp['throws'] = sp.pitcher.map(tmap)
        sp = sp[sp.throws.isin(['L', 'R'])]
        cells = {}
        for side, col, vs in (('bat', 'batter', 'throws'), ('pit', 'pitcher', 'stand')):
            for (code, v), g in sp.groupby([col, vs]):
                vc = g.ev.value_counts()
                rows['split'].append([year, part, side, code, v, len(g)] + [int(vc.get(e, 0)) for e in SPLIT_EVENTS])
        for (st, th), g in sp.groupby(['stand', 'throws']):
            vc = g.ev.value_counts()
            c = {e: int(vc.get(e, 0)) for e in SPLIT_EVENTS}
            c['pa'] = len(g)
            cells[(st, th)] = c
            avg, obp, slg = slash(c)
            rows['platoon4'].append([year, part, st, th, len(g), r(avg), r(obp), r(slg), r(obp + slg), r(c['K'] / len(g)),
                                     r(c['BB'] / len(g)), r(c['HR'] / len(g))])
        for st in ('L', 'R'):
            c = {k: cells[(st, 'L')][k] + cells[(st, 'R')][k] for k in cells[(st, 'L')]}
            avg = slash(c)[0]
            lp = lg_platoon[(year, st)]
            check.append([year, f'좌우 분할 {st}타 타율 (4칸 합)', c['pa'], r(avg), lp['pa'], lp['avg'], r(avg - float(lp['avg']), 4)])
        n_split = sum(x[5] for x in rows['split'] if x[0] == year and x[2] == 'bat')
        check.append([year, '좌우 분할 타석 (타자 행 합 = 투수 행 합)', n_split, n_split,
                      '', sum(x[5] for x in rows['split'] if x[0] == year and x[2] == 'pit'), 0])

    # ---- 연결 표 쓰기 ----
    link_rows, dupes = [], []
    for code in sorted(link):
        e = link[code]
        p = players.get(code)
        gname = p['name'] if p else ''
        same = int(bool(p) and gname in e['names'])
        link_rows.append([code, code if p else '', '/'.join(sorted(e['names'])), gname, same,
                          ' '.join(str(y) for y in sorted(e['years'])), e['pa'], e['bf'], int(e['in_season'])])
        # 같은 이름의 다른 선수가 자료 기간(2022~)에 뛰었으면 손 확인 목록에 (코드가 KBO 선수 코드라 연결 자체는 코드로 정해진다)
        others = [players[i] for i in by_name.get(gname, []) if i != code and (players[i].get('last') or 0) >= YEARS[0] - 1]
        if p and others:
            dupes.append([gname, code, p.get('birthYear', ''), p.get('kind', ''), ' '.join(str(y) for y in sorted(e['years'])),
                          ' / '.join(f"{o['id']} ({o.get('birthYear', '?')}년생 {o.get('kind', '')} {o.get('first', '?')}~{o.get('last', '?')})" for o in others)])

    write('player_link.csv', ['code', 'game_id', 'pbp_name', 'game_name', 'name_same', 'years', 'pa', 'bf', 'in_game_season'], link_rows)
    write('player_link_dupes.csv', ['name', 'id', 'birth_year', 'kind', 'pbp_years', 'same_name_others'], dupes)
    write('batter_ppa.csv', ['year', 'partial', 'id', 'pa', 'pitches', 'ppa'], rows['batter_ppa'])
    write('pitcher_ppa.csv', ['year', 'partial', 'id', 'pa', 'pitches', 'ppa'], rows['pitcher_ppa'])
    write('pitcher_arsenal.csv', ['year', 'partial', 'id', 'pitch_type', 'name_ko', 'pitches', 'share', 'speed_n', 'speed_mean_kmh'], rows['arsenal'])
    write('relief_usage.csv', ['year', 'partial', 'id', 'apps', 'starts', 'relief_apps', 'relief_with_prev', 'back_to_back',
                               'three_straight', 'mean_rest_days', 'relief_mean_pitches'], rows['relief'])
    write('platoon_split.csv', ['year', 'partial', 'side', 'id', 'vs', 'pa'] + [e.lower() for e in SPLIT_EVENTS], rows['split'])
    write('platoon4.csv', ['year', 'partial', 'stand', 'throws', 'pa', 'avg', 'obp', 'slg', 'ops', 'k_rate', 'bb_rate', 'hr_rate'], rows['platoon4'])
    write('player_check.csv', ['year', 'metric', 'n', 'players', 'league_n', 'league', 'diff'], check)

    # ---- 연결률 (2023~2025, 결과가 있는 타석 기준) ----
    full = [y for y in YEARS if y not in PARTIAL]
    lp = sum(e['pa'] for c, e in link.items() if c in players and e['in_season'])
    print(f'선수 코드 {len(link)}개, 게임 ID와 같은 코드 {sum(1 for c in link if c in players)}개, 이름 다름 {sum(1 for x in link_rows if not x[4])}개')
    print(f'연결 타석 (부분 시즌 포함 전 범위): {lp} / {sum(e["pa"] for e in link.values())}')
    print(f'동명이인 연결 {len(dupes)}명, 투구손 출처 {dict(hand_src)}, 완료 시즌 {full}')
    print(f'→ {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
