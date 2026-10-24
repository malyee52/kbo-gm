#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""투구 단위 문자중계 자료 → 선수별 추가 진루·번트 가공값 (data-src/pbp_derived/). 능력치 v2 16-3d (기획안 7.2 결정 3, 1.3).

사용법:  python -I -X utf8 tools/pbp_running.py [--raw <원본 폴더>]
읽는 것: data-src/naver_pbp/kbo_pbp_{2023,2024,2025,2026}.parquet (커밋하지 않는다, 내려받기는 data-src/pbp_derived/README.md).
         --raw로 다른 폴더를 줄 수 있다 (같은 파일을 다른 작업 폴더에 받아 둔 경우).
         data-src/pbp_derived/player_link.csv (자료 코드 → 게임 선수 ID, tools/pbp_players.py)
만드는 것 (선수별 가공값, 커밋한다: 사용자 결정 2026-10-22과 같은 갈래):
  runner_adv.csv  주자-시즌: 추가 진루 기회·성공·주루사와 리그 기대 성공
    기회는 세 가지 (타석 마지막 공의 주자 상태 → 타석 뒤 상태):
      - 단타 때 1루 주자 (2루가 비었을 때): 3루 이상 가면 성공
      - 단타 때 2루 주자: 홈에 들어오면 성공
      - 2루타 때 1루 주자: 홈에 들어오면 성공
    주자가 타석 뒤 베이스에 없고 아웃이 늘지 않았으면 득점, 아웃이 늘었으면 주루사로 본다 (안타라 타자는 아웃이 아니다).
    exp: 그 기회들의 (기회 종류 × 아웃 수) 칸 리그 성공률 합 (그 해 리그, 주력은 빼지 않는다: 엔진 쪽에서 뺀다)
  batter_bunt.csv  타자-시즌: 희생번트(sh)와 희생번트 상황(1·2루 주자, 2아웃 미만)의 번트 파울·번트 헛스윙 공(wv),
    그중 기습 번트(안타 노림)로 보는 몫(wvh)
    번트 실패가 인플레이(뜬공·선행 주자 아웃)로 끝나면 자료에 번트 표시가 없어 셀 수 없다. 그래서 "W·V 공 대비 희생번트"를 번트 수행의 대리값으로 쓴다.
    기습 번트는 공 하나하나로는 가를 수 없다 (인플레이 번트 표시·타구 표시 없음, 카운트 분포도 희생번트와 같다).
    그래서 그 타자의 주자 없을 때 W·V 비율(공당, 주자가 없으면 희생번트가 없으니 모두 기습 번트) × 희생번트 상황 공 수를 기습 번트 몫으로 보고,
    그 시즌 wv보다 크지 않게 자른다 (16-3e. 주자가 있을 때도 같은 비율로 기습 번트를 댄다고 보는 가정, 임시)
같은 입력이면 같은 결과가 나온다 (정렬 고정).
출처: slothman3878, "KBO Play-by-Play 2023-2026 (v0)" (Hugging Face, CC BY 4.0).
"""
import csv
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(sys.argv[sys.argv.index('--raw') + 1]) if '--raw' in sys.argv else ROOT / 'data-src' / 'naver_pbp'
OUT = ROOT / 'data-src' / 'pbp_derived'
YEARS = [2023, 2024, 2025, 2026]
PARTIAL = {2026}
KEY = ['game_pk', 'at_bat_number']
COLS = KEY + ['game_date', 'pitch_number', 'pitch_result', 'events', 'batter', 'outs_when_up', 'post_outs',
              'on_1b', 'on_2b', 'on_3b', 'post_on_1b', 'post_on_2b', 'post_on_3b']


def code(x):
    """주자·타자 코드 (빈 칸은 None)"""
    return None if x is None or (isinstance(x, float) and x != x) or x == '' else str(x)


def load_link():
    with (OUT / 'player_link.csv').open(encoding='utf-8') as f:
        return {r['code']: r['game_id'] for r in csv.DictReader(f) if r['game_id']}


def chances(last):
    """타석 마지막 공 표 → 기회 행 (주자, 종류, 아웃, 결과 0 머묾 / 1 성공 / 2 주루사)"""
    out = []
    for row in last.itertuples(index=False):
        ev = row.events
        if ev not in ('single', 'double'):
            continue
        r1, r2 = code(row.on_1b), code(row.on_2b)
        post = {code(row.post_on_1b), code(row.post_on_2b), code(row.post_on_3b)}
        outs_added = row.post_outs - row.outs_when_up
        p3 = code(row.post_on_3b)

        def result(r, extra_base_hit):
            if r in post:
                return 1 if extra_base_hit else 0
            return 1 if outs_added == 0 else 2

        if ev == 'single':
            if r1 and not r2:
                out.append((r1, '1to3', row.outs_when_up, result(r1, p3 == r1)))
            if r2:
                out.append((r2, '2toH', row.outs_when_up, result(r2, False)))
        elif r1:
            out.append((r1, '1toH', row.outs_when_up, result(r1, False)))
    return out


def main():
    link = load_link()
    adv_rows = []
    bunt_rows = []
    for year in YEARS:
        df = pd.read_parquet(RAW / f'kbo_pbp_{year}.parquet', columns=COLS)
        df = df.sort_values(['game_date', 'game_pk', 'at_bat_number', 'pitch_number'], kind='mergesort').reset_index(drop=True)
        last = df[df.pitch_number == df.groupby(KEY).pitch_number.transform('max')]
        ch = pd.DataFrame(chances(last), columns=['runner', 'kind', 'outs', 'res'])
        cell = ch.groupby(['kind', 'outs']).res.apply(lambda s: (s == 1).mean())
        ch['exp'] = [cell[(k, o)] for k, o in zip(ch.kind, ch.outs)]
        per = defaultdict(lambda: [0, 0, 0, 0.0])
        for rr, res, e in zip(ch.runner, ch.res, ch.exp):
            p = per[rr]
            p[0] += 1
            p[1] += res == 1
            p[2] += res == 2
            p[3] += e
        for c, (n, ext, outs, e) in sorted(per.items()):
            if c in link:
                adv_rows.append([year, int(year in PARTIAL), link[c], n, int(ext), int(outs), round(e, 3)])
        # 번트: 희생번트 타석과 희생번트 상황(1·2루 주자, 2아웃 미만)의 W·V 공. 주자 없는 기습 번트(안타 노림)는 희생번트가 될 수 없어 뺀다
        thrown = df[df.pitch_number > 0]
        is_wv = thrown.pitch_result.isin(['V', 'W'])
        sac_sit = (thrown.on_1b.notna() | thrown.on_2b.notna()) & (thrown.outs_when_up < 2)
        empty = thrown.on_1b.isna() & thrown.on_2b.isna() & thrown.on_3b.isna()
        wv = thrown[sac_sit & is_wv].groupby('batter').size()
        n_sac = thrown[sac_sit].groupby('batter').size()
        wv0 = thrown[empty & is_wv].groupby('batter').size()
        n0 = thrown[empty].groupby('batter').size()
        sh = last[last.events == 'sac_bunt'].groupby('batter').size()
        wvh_sum = 0.0
        for c in sorted(set(wv.index) | set(sh.index)):
            if c in link:
                w_ = int(wv.get(c, 0))
                # 기습 번트 몫: 주자 없을 때 W·V 비율 × 희생번트 상황 공 수, 그 시즌 W·V 공보다 크지 않게
                wvh = min(w_, wv0.get(c, 0) / n0[c] * n_sac.get(c, 0)) if n0.get(c, 0) else 0.0
                wvh_sum += wvh
                bunt_rows.append([year, int(year in PARTIAL), link[c], int(sh.get(c, 0)), w_, round(wvh, 3)])
        print(f'{year}: 추가 진루 기회 {len(ch)} (성공 {(ch.res == 1).mean():.3f}, 주루사 {(ch.res == 2).mean():.3f}), '
              f'희생번트 {int(sh.sum())} · W·V 공 {int(wv.sum())} (기습 번트 몫 {wvh_sum:.1f})')
    with (OUT / 'runner_adv.csv').open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['year', 'partial', 'id', 'opp', 'ext', 'outs', 'exp'])
        w.writerows(adv_rows)
    with (OUT / 'batter_bunt.csv').open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['year', 'partial', 'id', 'sh', 'wv', 'wvh'])
        w.writerows(bunt_rows)
    print(f'runner_adv.csv {len(adv_rows)}행, batter_bunt.csv {len(bunt_rows)}행')


if __name__ == '__main__':
    main()
