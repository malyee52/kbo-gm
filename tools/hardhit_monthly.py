#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""하드힛 월별 표 → 타석당 투구 수(P/PA)와 리그 월별 추이 (data-src/hardhit_derived/). 경기 엔진 2 3·4단계 근거.

사용법:  python -I -X utf8 tools/hardhit_monthly.py
읽는 것: data-src/hardhit/monthly/hardhit_{batter,pitcher}_period_YYYY_MM.csv (원본, 커밋하지 않는다)
         public/data/seasons/{연도}.json (월 합계 대조), data-src/pbp_derived/league_summary.csv (투구 단위 P/PA 대조)
만드는 것:
  data-src/hardhit_derived/league_ppa.csv       리그 연도별 P/PA, 투수별 P/PA 분포(백분위, 시즌 상대 타자 100명 이상)
  data-src/hardhit_derived/league_monthly.csv   리그 연·월별 상대 타자·이닝·실점·자책·RA9·ERA·P/PA·타율·출루율(근사)·장타율·OPS
  data-src/hardhit_derived/monthly_trend.csv    월 묶음(3·4월 … 9·10월)별 그 해 시즌 값 대비 비율의 2015~2025 평균
  data-src/hardhit_derived/monthly_check.csv    월별 합계 대 게임 데이터 시즌 합계, 하드힛 P/PA 대 투구 단위 자료 P/PA
  data-src/hardhit_derived/pitcher_ppa.csv     투수-시즌-팀별 P/PA, 게임 선수 ID에 연결 (선수별 가공값, 사용자 결정 2026-10-22로 커밋한다)
                                                못 맞춘 행은 같은 폴더 pitcher_ppa_unmatched.csv
같은 입력이면 같은 결과가 나온다.
기록 일부: 하드힛(https://hardhit.ai), 비상업적 이용.
"""
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hardhit_common import Matcher  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data-src' / 'hardhit' / 'monthly'
OUT = ROOT / 'data-src' / 'hardhit_derived'
SEASONS = ROOT / 'public' / 'data' / 'seasons'
PBP_SUMMARY = ROOT / 'data-src' / 'pbp_derived' / 'league_summary.csv'
YEARS = range(2015, 2027)
PARTIAL = {2026}  # 시즌 진행 중에 받은 표
QUAL_PA = 100
# 월 묶음: 개막 달(3월)은 4월에, 10월은 9월에 붙인다
GROUP = {3: '3·4월', 4: '3·4월', 5: '5월', 6: '6월', 7: '7월', 8: '8월', 9: '9·10월', 10: '9·10월'}
GROUPS = ['3·4월', '5월', '6월', '7월', '8월', '9·10월']


def num(s):
    s = (s or '').strip().replace('%', '').replace('+', '')
    try:
        return float(s)
    except ValueError:
        return 0.0


def outs_of(ip):
    """이닝 '5.2' → 아웃 17"""
    whole, _, frac = str(ip).partition('.')
    return int(whole or 0) * 3 + int(frac or 0)


def read(kind, year, month):
    p = RAW / f'hardhit_{kind}_period_{year}_{month:02d}.csv'
    if not p.exists():
        return None
    with p.open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def r(x, nd=4):
    return '' if x is None else round(float(x), nd)


def pct(xs, q):
    """선형 보간 백분위 (numpy 기본과 같음)"""
    s = sorted(xs)
    if not s:
        return None
    k = (len(s) - 1) * q / 100
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def write(path, cols, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(cols)
        w.writerows(rows)


def main():
    pbp = defaultdict(dict)
    if PBP_SUMMARY.exists():
        with PBP_SUMMARY.open(encoding='utf-8') as f:
            for row in csv.DictReader(f):
                pbp[int(row['year'])][row['metric']] = float(row['value'])

    M = Matcher()
    monthly, ppa_rows, check, players, missing, unmatched = [], [], [], [], [], []
    season_vals = {}  # (연도) → 시즌 값, (연도, 묶음) → 묶음 값
    group_vals = {}
    for year in YEARS:
        part = 1 if year in PARTIAL else 0
        per_pitcher = defaultdict(lambda: [0.0, 0.0])  # (이름, 팀) → [투구수, 타석]
        yb = defaultdict(float)  # 연간 합 (타자 표)
        yp = defaultdict(float)  # 연간 합 (투수 표)
        gb = defaultdict(lambda: defaultdict(float))
        gp = defaultdict(lambda: defaultdict(float))
        months = []
        for month in range(3, 11):
            bat, pit = read('batter', year, month), read('pitcher', year, month)
            if bat is None or pit is None:
                missing.append(f'{year}-{month:02d}')
                continue
            months.append(month)
            b = defaultdict(float)
            for row in bat:
                pa, ab = num(row['타석']), num(row['타수'])
                b['pa'] += pa
                b['ab'] += ab
                b['h'] += num(row['안타'])
                b['hr'] += num(row['홈런'])
                b['bb'] += num(row['볼넷'])
                b['so'] += num(row['삼진'])
                b['r'] += num(row['득점'])
                b['tb'] += round(num(row['장타율']) * ab)  # 장타율 × 타수 = 루타 (반올림 오차 ±0.5)
                b['onbase'] += num(row['출루율']) * pa  # 출루율 분모를 타석으로 근사 (희생번트 몫)
            p = defaultdict(float)
            for row in pit:
                pitches, pa = num(row['투구수']), num(row['타석'])
                p['pitches'] += pitches
                p['pa'] += pa
                p['outs'] += outs_of(row['이닝'])
                p['r'] += num(row['실점'])
                p['er'] += num(row['자책점'])
                p['so'] += num(row['삼진'])
                p['bb'] += num(row['볼넷'])
                p['h'] += num(row['피안타'])
                key = (row['선수'].strip(), row['팀'].strip())
                per_pitcher[key][0] += pitches
                per_pitcher[key][1] += pa
            for k, v in b.items():
                yb[k] += v
                gb[GROUP[month]][k] += v
            for k, v in p.items():
                yp[k] += v
                gp[GROUP[month]][k] += v
            monthly.append([year, part, month] + stats_row(b, p))
        if not months:
            continue
        season_vals[year] = stats(yb, yp)
        for g in GROUPS:
            if g in gb:
                group_vals[(year, g)] = stats(gb[g], gp[g])

        # 투수별 P/PA
        qual = [pi / pa for pi, pa in per_pitcher.values() if pa >= QUAL_PA and pi > 0]
        for (name, team), (pi, pa) in sorted(per_pitcher.items()):
            if pa > 0:
                # 선수 연결: 이름·팀(계보), 겹치면 시즌 상대 타자 수로 가른다 (부분 시즌 2026은 게임 자료와 범위가 달라 기록으로 가르지 않는다)
                pid, why = M.match(year, name, team, None, 'pit', None if part else {'tbf': int(pa)}) if year in M.years else (None, 'not-in-season')
                if pid:
                    players.append([year, part, pid, team, int(pi), int(pa), r(pi / pa if pi else None, 3)])
                else:
                    unmatched.append([year, name, team, int(pa), why])
        lg = yp['pitches'] / yp['pa']
        ppa_rows.append([year, part, ' '.join(f'{m:02d}' for m in months), int(yp['pitches']), int(yp['pa']), r(lg),
                         len(qual)] + [r(pct(qual, q), 3) for q in (10, 25, 50, 75, 90)] + [r(min(qual), 3), r(max(qual), 3)])

        # 대조: 게임 데이터 시즌 합계
        sp = SEASONS / f'{year}.json'
        if sp.exists() and not part:
            L = json.loads(sp.read_text(encoding='utf-8'))['league']
            obp = (L['h'] + L['bb'] + L['hbp']) / (L['ab'] + L['bb'] + L['hbp'] + L['sf'])
            for name, mine, theirs in [
                ('타자 표 타석', yb['pa'], L['pa']), ('투수 표 상대 타자', yp['pa'], L['tbf']),
                ('타자 표 안타', yb['h'], L['h']), ('타자 표 홈런', yb['hr'], L['hr']),
                ('타자 표 볼넷', yb['bb'], L['bb']), ('타자 표 삼진', yb['so'], L['so']),
                ('투수 표 아웃', yp['outs'], L['outs']), ('투수 표 실점', yp['r'], L['runsAllowed']),
                ('투수 표 자책', yp['er'], L['er']),
                ('타율', yb['h'] / yb['ab'], L['h'] / L['ab']), ('출루율 (근사)', yb['onbase'] / yb['pa'], obp),
                ('장타율', yb['tb'] / yb['ab'], (L['h'] + L['d'] + 2 * L['t'] + 3 * L['hr']) / L['ab']),
            ]:
                check.append([year, 'game_data', name, r(mine, 5), r(theirs, 5), r((mine - theirs) / theirs if theirs else None, 5)])
        # 대조: 투구 단위 자료 (투구 없는 자동 고의4구도 타석에 넣은 값, pitches_per_pa_all)
        if year in pbp and 'pitches_per_pa_all' in pbp[year]:
            mine, theirs = lg, pbp[year]['pitches_per_pa_all']
            note = 'pbp_partial' if part else 'pbp'
            check.append([year, note, 'P/PA (하드힛 투구수÷타석 대 투구 단위 전체 공÷타석)', r(mine, 5), r(theirs, 5), r((mine - theirs) / theirs, 5)])

    # 월 묶음 추이: 그 해 시즌 값 대비 비율을 해마다 낸 뒤 평균 (2015~2025, 완료 시즌만)
    keys = ['runs_per_9', 'era', 'ppa', 'avg', 'obp', 'slg', 'ops', 'k_rate', 'bb_rate']
    trend = []
    done_years = [y for y in season_vals if y not in PARTIAL]
    for g in GROUPS:
        ys = [y for y in done_years if (y, g) in group_vals]
        row = [g, len(ys)]
        for k in keys:
            ratios = [group_vals[(y, g)][k] / season_vals[y][k] for y in ys if season_vals[y][k]]
            row.append(r(sum(ratios) / len(ratios), 4))
        for k in keys:
            row.append(r(sum(group_vals[(y, g)][k] for y in ys) / len(ys), 4))
        trend.append(row)

    write(OUT / 'league_ppa.csv', ['year', 'partial', 'months', 'pitches', 'pa', 'ppa', 'qual_pitchers',
                                   'p10', 'p25', 'p50', 'p75', 'p90', 'min', 'max'], ppa_rows)
    write(OUT / 'league_monthly.csv', ['year', 'partial', 'month', 'pa', 'outs', 'runs', 'er', 'runs_per_9', 'era', 'pitches',
                                       'ppa', 'avg', 'obp_approx', 'slg', 'ops_approx', 'k_rate', 'bb_rate'], monthly)
    write(OUT / 'monthly_trend.csv', ['group', 'years'] + [f'ratio_{k}' for k in keys] + [f'mean_{k}' for k in keys], trend)
    write(OUT / 'monthly_check.csv', ['year', 'against', 'metric', 'hardhit', 'other', 'diff'], check)
    players.sort(key=lambda x: (x[0], x[2], x[3]))
    write(OUT / 'pitcher_ppa.csv', ['year', 'partial', 'id', 'team', 'pitches', 'pa', 'ppa'], players)
    write(OUT / 'pitcher_ppa_unmatched.csv', ['year', 'name', 'team', 'pa', 'why'], unmatched)
    tot = sum(x[5] for x in players) + sum(x[3] for x in unmatched)
    print('없는 달:', ', '.join(missing) or '없음')
    print(f'투수 연결: {len(players)}행, 못 맞춤 {len(unmatched)}행 (상대 타자 {sum(x[3] for x in unmatched)} / {tot})')
    print(f'→ {OUT.relative_to(ROOT)}')


def stats(b, p):
    """합계 → 비율. 출루율은 분모를 타석으로 근사"""
    ip9 = p['outs'] / 27
    return {
        'runs_per_9': p['r'] / ip9 if ip9 else 0, 'era': p['er'] / ip9 if ip9 else 0,
        'ppa': p['pitches'] / p['pa'] if p['pa'] else 0, 'avg': b['h'] / b['ab'] if b['ab'] else 0,
        'obp': b['onbase'] / b['pa'] if b['pa'] else 0, 'slg': b['tb'] / b['ab'] if b['ab'] else 0,
        'ops': (b['onbase'] / b['pa'] + b['tb'] / b['ab']) if b['ab'] else 0,
        'k_rate': b['so'] / b['pa'] if b['pa'] else 0, 'bb_rate': b['bb'] / b['pa'] if b['pa'] else 0,
    }


def stats_row(b, p):
    s = stats(b, p)
    return [int(p['pa']), int(p['outs']), int(p['r']), int(p['er']), r(s['runs_per_9'], 3), r(s['era'], 3), int(p['pitches']),
            r(s['ppa']), r(s['avg']), r(s['obp']), r(s['slg']), r(s['ops']), r(s['k_rate']), r(s['bb_rate'])]


if __name__ == '__main__':
    sys.exit(main())
