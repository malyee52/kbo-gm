#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""구장 효과 실측 재점검 (구장효과 기획안 P3, 보고서만. 게임 자료·결과는 바꾸지 않는다).

① 투구 단위 원본(2023~2026)을 구장별로 다시 세어 하드힛 구장 구성표(2022~2025 묶음)와 견준다
② 해마다 득점 계수 f(meta.json parkFactors) 대 같은 구장-기간 평균: 어느 쪽이 다음 해를 더 잘 맞히나
③ 2015~2021 사이에 f의 계단(리모델링 경계 후보)이 있는가, parks.json 제원 행과 맞나
④ park-check 기울기 (tools/park_check.ts 결과 파일을 읽어 옮긴다)

사용법:  python -I -X utf8 tools/park_measure.py [--pbp data-src/naver_pbp] [--check 파일.md] [--out reports/park-measure.md]

읽는 것:
  data-src/naver_pbp/kbo_pbp_{2023..2026}.parquet  투구 단위 원본 (slothman3878, Hugging Face, CC BY 4.0. 커밋하지 않는다,
                                                   내려받기는 data-src/pbp_derived/README.md). 구장 칸이 없어 홈 팀의 그 해 주 구장
                                                   (parks.json)으로 본다 → 제2구장(포항·울산·청주) 경기도 주 구장에 섞인다.
  data-src/hardhit_derived/park_components.csv     하드힛 구장 구성표 (100 = 리그 평균, 구장 자체 지수)
  public/data/meta.json parkFactors                 하드힛 파크팩터로 만든 연도별 홈 구장 득점 계수 f (build_data.py park_factors)
  public/data/parks.json                            구장 제원 기간 (구장효과 기획안 7.1·7.2)

필요한 것: pandas, pyarrow (pbp_derive.py와 같다).
"""
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent


def arg(name, default=None):
    return sys.argv[sys.argv.index(f'--{name}') + 1] if f'--{name}' in sys.argv else default


PBP = Path(arg('pbp', ROOT / 'data-src' / 'naver_pbp'))
CHECK = arg('check')
OUT = Path(arg('out', ROOT / 'reports' / 'park-measure.md'))
YEARS = [2023, 2024, 2025, 2026]
# 문자중계 팀 코드 → 계보
TEAM = {'LG': 'LG', 'OB': '두산', 'SS': '삼성', 'HT': 'KIA', 'LT': '롯데', 'HH': '한화', 'SK': 'SSG', 'WO': '히어로즈', 'NC': 'NC', 'KT': 'KT'}
# 하드힛 구성표 구장 이름 → 구장 ID (validate_data.py와 같다)
HARDHIT_PARKS = {'잠실': 'jamsil', '대구': 'lionspark', '인천': 'munhak', '부산': 'sajik', '대전': 'ballpark', '수원': 'suwon',
                 '창원': 'changwon', '광주': 'champions', '고척': 'gocheok'}
EVENTS = {'single': 's1', 'double': 'd2', 'triple': 't3', 'home_run': 'hr', 'walk': 'bb', 'strikeout': 'so'}
EV_KO = {'runs': '득점', 's1': '단타', 'd2': '2루타', 't3': '3루타', 'hr': '홈런', 'bb': '볼넷', 'so': '삼진'}
HARDHIT_COL = {'runs': '득점', 's1': '단타', 'd2': '2루타', 't3': '3루타', 'hr': '홈런', 'bb': '볼넷', 'so': '삼진'}
N_TEAMS = 10


def load_json(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def park_of(parks, franchise, year):
    """그 해 그 계보의 주 구장 ID (parks.json use)"""
    for u in parks['use']:
        if u['kind'] == '주' and u['franchise'] == franchise and u['from'] <= year <= (u['to'] or 9999):
            return u['park']
    return None


def spec_period(parks, park, year):
    """그 해 구장의 '같은 제원 기간' 열쇠: 공용 제원 행 가운데 변경 ≠ 없음 경계로 묶은 첫 행의 시작 해"""
    rows = sorted((s for s in parks['specs'] if s['id'] == park and not s['franchise']), key=lambda s: s['from'])
    start = rows[0]['from'] if rows else None
    for s in rows:
        if s['change'] != '없음':
            start = s['from']
        if s['from'] <= year <= (s['to'] or 9999):
            return start
    return start


# ---- ① 투구 단위 원본 다시 세기

def pbp_counts():
    """(연도, 계보) → {'home'|'road': {타석, 사건 수, 경기, 득점, 좌우타별 타석·사건}}"""
    out = {}
    for y in YEARS:
        f = PBP / f'kbo_pbp_{y}.parquet'
        if not f.exists():
            continue
        df = pd.read_parquet(f, columns=['game_pk', 'home_team', 'away_team', 'at_bat_number', 'pitch_number', 'events', 'stand',
                                         'post_home_score', 'post_away_score'])
        last = df.loc[df.groupby(['game_pk', 'at_bat_number']).pitch_number.idxmax()]
        last = last[last.events.notna()]
        games = df.groupby('game_pk').agg(home=('home_team', 'first'), away=('away_team', 'first'),
                                          hs=('post_home_score', 'max'), as_=('post_away_score', 'max'))
        games['runs'] = games.hs + games.as_
        for side, col in (('home', 'home_team'), ('road', 'away_team')):
            for code, g in last.groupby(col):
                fr = TEAM[code]
                d = out.setdefault((y, fr), {}).setdefault(side, {})
                d['pa'] = len(g)
                for ev, k in EVENTS.items():
                    d[k] = int((g.events == ev).sum())
                for hand in ('L', 'R'):
                    gh = g[g.stand == hand]
                    d[f'pa_{hand}'] = len(gh)
                    for ev, k in EVENTS.items():
                        d[f'{k}_{hand}'] = int((gh.events == ev).sum())
            for code, g in games.groupby('home' if side == 'home' else 'away'):
                d = out[(y, TEAM[code])][side]
                d['games'] = len(g)
                d['runs'] = int(g.runs.sum())
    return out


def ratio_index(h, r, k, hand=''):
    """홈 ÷ 원정 비 → 구장 자체 지수 (리그 평균 1). 원정 구장은 나머지 9개 구장이라 p = N·비 / (N − 1 + 비).
    log 표준오차는 건수의 포아송 근사 (득점은 경기 단위 분산을 쓰지 않은 근사, 실제보다 작다)"""
    if k == 'runs':
        hr_, rr_, nh, nr = h['runs'] / h['games'], r['runs'] / r['games'], h['runs'], r['runs']
    else:
        pa = f'pa_{hand}' if hand else 'pa'
        kk = f'{k}_{hand}' if hand else k
        if not h[pa] or not r[pa] or not h[kk] or not r[kk]:
            return None, None
        hr_, rr_, nh, nr = h[kk] / h[pa], r[kk] / r[pa], h[kk], r[kk]
    ratio = hr_ / rr_
    return N_TEAMS * ratio / (N_TEAMS - 1 + ratio), math.sqrt(1 / nh + 1 / nr)


def pool(counts, keys):
    """여러 (연도, 계보) 칸을 더한다"""
    out = {'home': defaultdict(int), 'road': defaultdict(int)}
    for key in keys:
        for side in ('home', 'road'):
            for k, v in counts[key][side].items():
                out[side][k] += v
    return out


def hardhit_components():
    rows = {}
    with (ROOT / 'data-src' / 'hardhit_derived' / 'park_components.csv').open(encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            if r['구장'] in HARDHIT_PARKS:
                rows[(HARDHIT_PARKS[r['구장']], r['타자'])] = r
    return rows


def corr(xs, ys):
    xs, ys = np.array(xs, float), np.array(ys, float)
    return float(np.corrcoef(xs, ys)[0, 1]) if len(xs) > 2 else float('nan')


def slope(xs, ys):
    xs, ys = np.array(xs, float), np.array(ys, float)
    return float(np.polyfit(xs, ys, 1)[0]) if len(xs) > 2 else float('nan')


# ---- 보고서

def main():
    parks = load_json(ROOT / 'public' / 'data' / 'parks.json')
    meta = load_json(ROOT / 'public' / 'data' / 'meta.json')
    pf = {int(y): v for y, v in meta['parkFactors'].items()}
    L = ['# 구장 효과 실측 재점검 (구장효과 기획안 P3)', '',
         f'`python -I -X utf8 tools/park_measure.py{" --check " + CHECK if CHECK else ""}` · 보고서만 (게임 자료·결과는 그대로)', '']

    counts = pbp_counts() if PBP.exists() else {}
    have = sorted({y for y, _ in counts})
    hh = hardhit_components()

    # ① 구장별 다시 세기 대 하드힛 구성표
    L += ['## ① 투구 단위 원본 다시 세기 대 하드힛 구성표', '']
    if not counts:
        L += [f'원본 `{PBP}`가 없어 건너뜀 (내려받기는 `data-src/pbp_derived/README.md`).', '']
    else:
        L += [f'원본 연도: {", ".join(map(str, have))} (2026은 7월 26일까지). 홈 경기를 홈 팀의 그 해 주 구장(parks.json)으로 보고, '
              '구장마다 그 구장을 쓴 구단-해의 홈 경기(양 팀 타자)와 같은 구단-해의 원정 경기를 더해 비를 낸다. '
              f'구장 자체 지수 = {N_TEAMS}·비 / ({N_TEAMS - 1} + 비) × 100 (원정 구장 = 나머지 구장 평균으로 보는 흔한 근사). '
              '하드힛 표는 2022~2025 묶음이고 원본은 2022가 없어 **2023~2025**로 맞춘다. 제2구장 경기는 원본에서 가릴 수 없어 주 구장에 섞인다 '
              '(하드힛 표는 포항·울산을 따로 뺐다). ± 는 log 지수의 포아송 표준오차.', '']
        units = defaultdict(list)  # 구장 ID → (연도, 계보)
        for (y, fr) in counts:
            if 2023 <= y <= 2025:
                units[park_of(parks, fr, y)].append((y, fr))
        evs = ['runs', 's1', 'd2', 't3', 'hr', 'bb', 'so']
        L += ['| 구장 | 원본 구단-해 | ' + ' | '.join(f'{EV_KO[k]} 원본 / 하드힛' for k in evs) + ' |',
              '|---|---|' + '---:|' * len(evs)]
        pairs = defaultdict(lambda: ([], []))
        for pid in sorted(units, key=lambda p: (p not in HARDHIT_PARKS.values(), p)):
            P = pool(counts, units[pid])
            cells = []
            for k in evs:
                v, se = ratio_index(P['home'], P['road'], k)
                h = hh.get((pid, 'ALL'))
                hv = float(h[HARDHIT_COL[k]]) if h else None
                if v is not None and hv is not None:
                    pairs[k][0].append(math.log(v))
                    pairs[k][1].append(math.log(hv / 100))
                cells.append(f'{100 * v:.0f}±{100 * se:.0f} / {hv:.0f}' if hv is not None else f'{100 * v:.0f}±{100 * se:.0f} / —')
            yrs = sorted({y for y, _ in units[pid]})
            L.append(f'| {pid} | {"·".join(sorted({fr for _, fr in units[pid]}))} {yrs[0]}~{yrs[-1]} | ' + ' | '.join(cells) + ' |')
        L += ['', '사건별 log 지수의 구장 사이 일치 (하드힛 표가 있는 구장만):', '',
              '| 사건 | 구장 수 | 상관 | 기울기 (원본 = a × 하드힛) | 차이 표준편차 (log) |', '|---|---:|---:|---:|---:|']
        for k in evs:
            xs, ys = pairs[k][1], pairs[k][0]
            if len(xs) > 2:
                d = np.std(np.array(ys) - np.array(xs))
                L.append(f'| {EV_KO[k]} | {len(xs)} | {corr(xs, ys):.2f} | {slope(xs, ys):.2f} | {d:.3f} |')
        # 좌우타
        L += ['', '좌타(L)·우타(R) 홈런·2루타 지수 (원본 2023~2025 / 하드힛):', '',
              '| 구장 | 좌타 홈런 | 우타 홈런 | 좌타 2루타 | 우타 2루타 |', '|---|---:|---:|---:|---:|']
        side_pairs = defaultdict(lambda: ([], []))
        for pid in sorted(u for u in units if u in HARDHIT_PARKS.values()):
            P = pool(counts, units[pid])
            cells = []
            for k in ('hr', 'd2'):
                for hand in ('L', 'R'):
                    v, se = ratio_index(P['home'], P['road'], k, hand)
                    h = hh.get((pid, hand))
                    hv = float(h[HARDHIT_COL[k]]) if h else None
                    if v and hv:
                        side_pairs[(k, hand)][0].append(math.log(v))
                        side_pairs[(k, hand)][1].append(math.log(hv / 100))
                    cells.append(f'{100 * v:.0f}±{100 * se:.0f} / {hv:.0f}' if v and hv else '—')
            L.append(f'| {pid} | ' + ' | '.join([cells[0], cells[1], cells[2], cells[3]]) + ' |')
        L.append('')
        L.append('상관: ' + ', '.join(f'{EV_KO[k]} {hand} {corr(*side_pairs[(k, hand)][::-1]):.2f}' for k in ('hr', 'd2') for hand in ('L', 'R')))
        L.append('')

        # 해마다 원본 득점 지수 대 f
        L += ['### 해마다: 원본 득점 지수 대 하드힛 f', '',
              '같은 구단-해의 원본 득점 지수(홈 ÷ 원정 경기당 득점, 위 근사)와 meta.json f. f는 해마다 구단 평균 1로 맞춘 값이라 원본도 같은 해 평균 1로 나눈다.', '',
              '| 해 | 구단 수 | 상관 | 기울기 (원본 = a × f) | 차이 표준편차 | 원본 득점 지수 log 표준오차 (평균) |', '|---|---:|---:|---:|---:|---:|']
        all_x, all_y = [], []
        for y in have:
            xs, ys, ses = [], [], []
            for fr in TEAM.values():
                if (y, fr) not in counts or fr not in pf.get(y, {}):
                    continue
                v, se = ratio_index(counts[(y, fr)]['home'], counts[(y, fr)]['road'], 'runs')
                xs.append(pf[y][fr]); ys.append(v); ses.append(se)
            m = np.mean(ys)
            ys = [v / m for v in ys]
            all_x += [math.log(x) for x in xs]; all_y += [math.log(v) for v in ys]
            L.append(f'| {y} | {len(xs)} | {corr(xs, ys):.2f} | {slope(np.log(xs), np.log(ys)):.2f} | '
                     f'{np.std(np.log(ys) - np.log(xs)):.3f} | {np.mean(ses):.3f} |')
        L.append(f'| 모두 | {len(all_x)} | {corr(all_x, all_y):.2f} | {slope(all_x, all_y):.2f} | {np.std(np.array(all_y) - np.array(all_x)):.3f} | |')
        L.append('')

    # ② 해마다 f 대 기간 평균
    L += ['## ② 해마다 f 대 같은 구장-기간 평균 (다음 해 맞히기)', '',
          'meta.json f (2015~2026, 하드힛). 같은 구장-기간 = 같은 계보·같은 주 구장이고 parks.json 공용 제원 행의 `변경 ≠ 없음` 경계 안. '
          '해 y의 f를 맞히는 값: ⓐ 앞 해 f ⓑ 그 기간 앞 해들 평균 ⓒ 그 기간 나머지 해 평균 (뒤 해 포함, 옛 해에 거꾸로 쓸 때와 같은 꼴) ⓓ 1 (중립). '
          '2026은 부분 시즌이라 맞히는 대상에서 뺀다 (재료로는 쓴다).', '']
    periods = defaultdict(list)  # (계보, 구장, 기간 시작) → [(해, f)]
    for y in sorted(pf):
        for fr, f in pf[y].items():
            pid = park_of(parks, fr, y)
            periods[(fr, pid, spec_period(parks, pid, y))].append((y, f))
    err = defaultdict(list)
    for key, ys in periods.items():
        ys.sort()
        for i, (y, f) in enumerate(ys):
            if y == 2026 or i == 0:
                continue
            prev = [v for _, v in ys[:i]]
            others = [v for j, (_, v) in enumerate(ys) if j != i]
            err['a'].append(ys[i - 1][1] - f)
            err['b'].append(np.mean(prev) - f)
            err['c'].append(np.mean(others) - f)
            err['d'].append(1 - f)
            err['e'].append(0.5 * (ys[i - 1][1] + np.mean(others)) - f)
    rmse = {k: float(np.sqrt(np.mean(np.square(v)))) for k, v in err.items()}
    L += [f'맞힌 구단-해 {len(err["a"])}개 (기간 둘째 해부터).', '',
          '| 맞히는 값 | RMSE (f) |', '|---|---:|',
          f'| ⓐ 앞 해 f | {rmse["a"]:.4f} |', f'| ⓑ 기간 앞 해들 평균 | {rmse["b"]:.4f} |',
          f'| ⓒ 기간 나머지 해 평균 | {rmse["c"]:.4f} |', f'| ⓔ ⓐ와 ⓒ 반반 | {rmse["e"]:.4f} |', f'| ⓓ 중립 1 | {rmse["d"]:.4f} |', '']
    # 기간 안 해마다 흔들림
    sds = [np.std([v for _, v in ys], ddof=1) for ys in periods.values() if len(ys) >= 3]
    means = [np.mean([v for _, v in ys]) for ys in periods.values() if len(ys) >= 3]
    L += [f'기간 안 해마다 표준편차 평균 {np.mean(sds):.4f} (3년 이상 기간 {len(sds)}개), 기간 평균의 구장 사이 표준편차 {np.std(means, ddof=1):.4f}.', '',
          '| 계보 | 구장 | 기간 | 해 수 | 평균 f | 표준편차 | 최소~최대 |', '|---|---|---|---:|---:|---:|---|']
    for (fr, pid, start), ys in sorted(periods.items(), key=lambda kv: (kv[0][0], kv[1][0][0])):
        vs = [v for _, v in ys]
        L.append(f'| {fr} | {pid} | {ys[0][0]}~{ys[-1][0]} | {len(vs)} | {np.mean(vs):.3f} | '
                 f'{(np.std(vs, ddof=1) if len(vs) > 1 else 0):.3f} | {min(vs):.3f}~{max(vs):.3f} |')
    L.append('')

    # ③ 계단 찾기
    L += ['## ③ 2015~2021 f의 계단 (리모델링 경계 후보)', '',
          '같은 계보·같은 주 구장으로 이어진 해들(제원 경계 무시)에서, 해 k를 경계로 앞·뒤 평균 차이와 t = 차이 / (해마다 표준편차 × √(1/앞 + 1/뒤)). '
          '앞·뒤 2해 이상인 경계만. 해마다 표준편차는 ②의 기간 안 평균값을 쓴다 (한 구장 안에서 재면 계단이 섞여 커진다). |t| ≥ 3을 굵게.', '']
    noise = float(np.mean(sds))
    L += ['| 계보 | 구장 | 해 | 가장 큰 계단 (해) | 앞 평균 → 뒤 평균 | t | parks.json 제원 경계 |', '|---|---|---|---|---|---:|---|']
    runs_ = defaultdict(list)
    for y in sorted(pf):
        for fr, f in pf[y].items():
            runs_[(fr, park_of(parks, fr, y))].append((y, f))
    for (fr, pid), ys in sorted(runs_.items()):
        ys.sort()
        best = None
        for k in range(2, len(ys) - 1):
            a = [v for _, v in ys[:k]]
            b = [v for y, v in ys[k:] if y != 2026] or [v for _, v in ys[k:]]
            if len(b) < 2:
                continue
            t = (np.mean(b) - np.mean(a)) / (noise * math.sqrt(1 / len(a) + 1 / len(b)))
            if not best or abs(t) > abs(best[1]):
                best = (ys[k][0], t, np.mean(a), np.mean(b))
        bounds = sorted({s['from'] for s in parks['specs'] if s['id'] == pid and not s['franchise'] and s['change'] != '없음'
                         and ys[0][0] < s['from'] <= ys[-1][0]})
        bt = '—' if not bounds else ', '.join(f'{b} ({next(s["change"] for s in parks["specs"] if s["id"] == pid and s["from"] == b and not s["franchise"])})' for b in bounds)
        if best:
            tt = f'**{best[1]:+.1f}**' if abs(best[1]) >= 3 else f'{best[1]:+.1f}'
            L.append(f'| {fr} | {pid} | {ys[0][0]}~{ys[-1][0]} | {best[0]} | {best[2]:.3f} → {best[3]:.3f} | {tt} | {bt} |')
        else:
            L.append(f'| {fr} | {pid} | {ys[0][0]}~{ys[-1][0]} | (해가 적음) | | | {bt} |')
    L.append('')

    # ④ park-check
    L += ['## ④ park-check 기울기', '']
    if CHECK and Path(CHECK).exists():
        txt = Path(CHECK).read_text(encoding='utf-8')
        head = next((l for l in txt.splitlines() if l.startswith('`npx')), '')
        line = next((l for l in txt.splitlines() if l.startswith('기울기')), '(기울기 줄 없음)')
        L += [f'지금 코드로 다시 잼: {head}', '', line, '']
    else:
        L += ['`--check`로 tools/park_check.ts 결과 파일을 주면 옮긴다.', '']
    OUT.write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
    print(f'→ {OUT}')


if __name__ == '__main__':
    main()
