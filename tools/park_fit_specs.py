#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""구장 제원 회귀 (구장효과 기획안 P4, 보고서만. 계수는 src/engine/params.ts park.specFit에 자리값으로 옮긴다).

펜스 거리로 구장의 홈런 지수, (2루타 + 3루타) 지수를 맞히는 식 (기획안 4.2):
  - 표본: 하드힛 구장 구성표(2022~2025 묶음, 100 = 리그)가 있는 구장 × 그 묶음 마지막 해 제원 (parks.json 공용 행).
    투구 단위 원본이 있으면 한밭(2023~2024, 표에 없음)을 원본 다시 세기로 더한 판도 같이 낸다 (tools/park_measure.py와 같은 셈).
  - 설명 변수는 둘 이하: ⓐ 평균 거리 (좌·중·우 평균) ⓑ 좌우 평균 + 중앙. 펜스 높이는 회귀에 넣지 않고 잔차와의 상관만 본다.
  - 한 구장 빼고 맞히기(leave-one-out) 오차를 "모두 중립(1)"과 견준다. 짐작이 중립보다 못하면 결정 1의 C안 짐작 부분을
    B안(중립)으로 내릴지 사용자에게 다시 묻는다 (기획안 4.2-3).
  - 당김 w (짐작 log 지수 × w)를 0~1, 0.1 단위로 바꿔 한 구장 빼고 맞히기 오차가 가장 작은 값을 고른다 (4.3).
  - 득점 계수 f는 두 지수에서 사건별 득점 가치로 거꾸로 셈해, 하드힛 f(구장-기간 평균)가 있는 모든 구장-기간에서 맞혀 본다.
  - 상·하한(4.2-5)과 신구장 고르기 범위(6.1)는 표본의 최소~최대.

사용법:  python -I -X utf8 tools/park_fit_specs.py [--pbp data-src/naver_pbp] [--out reports/park-specs-fit.md]
"""
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import park_measure as PM  # noqa: E402  (같은 셈을 쓴다: 구장 ID, 원본 다시 세기, 구장-기간)


def arg(name, default=None):
    return sys.argv[sys.argv.index(f'--{name}') + 1] if f'--{name}' in sys.argv else default


OUT = Path(arg('out', ROOT / 'reports' / 'park-specs-fit.md'))
PM.PBP = Path(arg('pbp', PM.PBP))
# 사건별 득점 가치 (tools/build_data.py PARK_RUN_VALUE와 같다, tools/park_run_value.ts)
RUN_VALUE = {'s1': 0.63, 'd2': 0.88, 't3': 0.88, 'hr': 1.39}  # 2026-10-24 다시 잰 값 (보고서의 f 견주기 절에만 쓴다)
W_STEPS = [round(0.1 * i, 1) for i in range(11)]


def spec_row(parks, pid, year):
    return next((s for s in parks['specs'] if s['id'] == pid and not s['franchise'] and s['from'] <= year <= (s['to'] or 9999)), None)


def features(s):
    """제원 행 → (평균 거리, 좌우 평균, 중앙, 높이). 좌중·우중은 쓰지 않는다 (대부분 비어 있다)"""
    f = s['fence']
    if None in (f['l'], f['c'], f['r']):
        return None
    lr = (f['l'] + f['r']) / 2
    h = s['height']['lr'] if s['height']['lr'] is not None else s['height']['c']
    return {'mean': (f['l'] + f['c'] + f['r']) / 3, 'lr': lr, 'c': f['c'], 'h': h, 'l': f['l'], 'r': f['r']}


def ols(X, y):
    X1 = np.column_stack([np.ones(len(X)), X])
    beta, *_ = np.linalg.lstsq(X1, y, rcond=None)
    return beta


def predict(beta, X):
    return np.column_stack([np.ones(len(X)), X]) @ beta


def loo(X, y):
    """한 구장 빼고 맞히기 예측값"""
    out = np.zeros(len(y))
    for i in range(len(y)):
        m = np.arange(len(y)) != i
        out[i] = predict(ols(X[m], y[m]), X[i:i + 1])[0]
    return out


def rmse(e):
    return float(np.sqrt(np.mean(np.square(e))))


def league_rates(years):
    """리그 단타·2루타·3루타·홈런 타석당 비율과 타석당 득점 (시즌 JSON league)"""
    tot = defaultdict(float)
    for y in years:
        lg = json.loads((ROOT / 'public' / 'data' / 'seasons' / f'{y}.json').read_text(encoding='utf-8'))['league']
        for k in ('pa', 'h', 'd', 't', 'hr', 'r'):
            tot[k] += lg[k]
    s1 = tot['h'] - tot['d'] - tot['t'] - tot['hr']
    return {'s1': s1 / tot['pa'], 'd2': tot['d'] / tot['pa'], 't3': tot['t'] / tot['pa'], 'hr': tot['hr'] / tot['pa'], 'rpa': tot['r'] / tot['pa']}


def run_factor(hr_log, xb_log, R):
    """홈런·(2루타 + 3루타) log 지수 → 득점 계수 f (단타 1, build_data.py park_events의 득점 셈과 같은 꼴)"""
    m = {'hr': math.exp(hr_log), 'd2': math.exp(xb_log), 't3': math.exp(xb_log)}
    return 1 + sum(RUN_VALUE[e] * R[e] * (m[e] - 1) for e in m) / R['rpa']


def main():
    parks = PM.load_json(ROOT / 'public' / 'data' / 'parks.json')
    meta = PM.load_json(ROOT / 'public' / 'data' / 'meta.json')
    hh = PM.hardhit_components()
    R = league_rates([2022, 2023, 2024, 2025])
    wxb = R['d2'] / (R['d2'] + R['t3'])

    # 표본: 하드힛 표 구장 (2025 제원), 원본이 있으면 한밭 2023~2024
    rows = []
    for pid in sorted({p for p, _ in hh}):
        h = hh[(pid, 'ALL')]
        s = spec_row(parks, pid, 2025)
        ft = features(s)
        xb = wxb * float(h['2루타']) + (1 - wxb) * float(h['3루타'])
        rows.append({'id': pid, 'src': '하드힛 2022~2025', 'spec': s, **ft, 'hr': math.log(float(h['홈런']) / 100), 'xb': math.log(xb / 100),
                     'run': math.log(float(h['득점']) / 100), 'games': int(h['경기']), 'dome': s['dome']})
    extra = []
    if PM.PBP.exists():
        counts = PM.pbp_counts()
        keys = [(y, '한화') for y in (2023, 2024) if (y, '한화') in counts]
        if keys:
            P = PM.pool(counts, keys)
            hr, _ = PM.ratio_index(P['home'], P['road'], 'hr')
            d2, _ = PM.ratio_index(P['home'], P['road'], 'd2')
            t3, _ = PM.ratio_index(P['home'], P['road'], 't3')
            run, _ = PM.ratio_index(P['home'], P['road'], 'runs')
            s = spec_row(parks, 'hanbat', 2024)
            extra.append({'id': 'hanbat', 'src': '원본 2023~2024', 'spec': s, **features(s), 'hr': math.log(hr), 'xb': math.log(wxb * d2 + (1 - wxb) * t3),
                          'run': math.log(run), 'games': sum(counts[k]['home']['games'] for k in keys), 'dome': False})

    L = ['# 구장 제원 회귀 (구장효과 기획안 P4)', '',
         '`python -I -X utf8 tools/park_fit_specs.py` · 보고서만. 계수는 `src/engine/params.ts` `park.specFit` 자리값 (아직 경기에 쓰지 않는다, P5)', '',
         f'(2루타 + 3루타) 지수 = 2루타 지수 × {wxb:.3f} + 3루타 지수 × {1 - wxb:.3f} (2022~2025 리그 2루타·3루타 비). '
         'log 지수는 ln(지수 / 100). 평균 거리 = (좌 + 중 + 우) / 3. 높이는 좌우 높이 (없으면 중앙).', '',
         '## 표본', '',
         '| 구장 | 자료 | 경기 | 좌 | 중 | 우 | 평균 거리 | 높이 | 돔 | 홈런 지수 | (2루타+3루타) 지수 | 득점 지수 |',
         '|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|']
    for r in rows + extra:
        L.append(f'| {r["id"]} | {r["src"]} | {r["games"]} | {r["l"]:g} | {r["c"]:g} | {r["r"]:g} | {r["mean"]:.1f} | '
                 f'{"—" if r["h"] is None else format(r["h"], "g")} | '
                 f'{"돔" if r["dome"] else ""} | {100 * math.exp(r["hr"]):.1f} | {100 * math.exp(r["xb"]):.1f} | {100 * math.exp(r["run"]):.1f} |')
    L.append('')

    results = {}
    for label, sample in (('하드힛 9곳', rows), ('한밭 원본 더한 10곳', rows + extra)):
        if label != '하드힛 9곳' and not extra:
            continue
        n = len(sample)
        res = {}
        for tgt in ('hr', 'xb'):
            y = np.array([r[tgt] for r in sample])
            for kind, cols in (('a', ['mean']), ('b', ['lr', 'c'])):
                X = np.array([[r[c] for c in cols] for r in sample])
                beta = ols(X, y)
                fit = predict(beta, X)
                pl = loo(X, y)
                # 당김 w: 짐작 log × w
                ws = {w: rmse(w * pl - y) for w in W_STEPS}
                best = min(ws, key=lambda w: (round(ws[w], 6), -w))
                r2 = 1 - np.sum((y - fit) ** 2) / np.sum((y - y.mean()) ** 2)
                res[(tgt, kind)] = {'beta': beta, 'r2': r2, 'loo': rmse(pl - y), 'neutral': rmse(y), 'ws': ws, 'best': best,
                                    'pl': pl, 'y': y, 'resid': y - fit, 'cols': cols}
        results[label] = (sample, res)

        L += [f'## 맞춤과 한 구장 빼고 맞히기 ({label})', '',
              '오차는 log 지수 RMSE (0.10 ≈ 지수 10%). "중립"은 모두 1(log 0)로 맞혔을 때. w는 짐작 log × w의 당김, 최적 w는 한 구장 빼고 맞히기 오차가 가장 작은 값.', '',
              '| 맞히는 값 | 식 | 계수 | R² (맞춘 표본) | 한 구장 빼고 오차 | 중립 오차 | 최적 w | 최적 w 오차 | w = 0.5 오차 |',
              '|---|---|---|---:|---:|---:|---:|---:|---:|']
        for (tgt, kind), v in res.items():
            b = v['beta']
            form = f'{b[0]:+.3f} {b[1]:+.4f}×평균거리' if kind == 'a' else f'{b[0]:+.3f} {b[1]:+.4f}×좌우 {b[2]:+.4f}×중앙'
            L.append(f'| {"홈런" if tgt == "hr" else "(2루타+3루타)"} | {"ⓐ 평균 거리" if kind == "a" else "ⓑ 좌우 + 중앙"} | {form} | {v["r2"]:.2f} | '
                     f'{v["loo"]:.3f} | {v["neutral"]:.3f} | {v["best"]:.1f} | {v["ws"][v["best"]]:.3f} | {v["ws"][0.5]:.3f} |')
        L.append('')
        L += ['구장마다 한 구장 빼고 맞힌 값 (ⓐ, 지수):', '', '| 구장 | 홈런 실측 | 홈런 짐작 (w 1) | (2루타+3루타) 실측 | 짐작 (w 1) |', '|---|---:|---:|---:|---:|']
        for i, r in enumerate(sample):
            L.append(f'| {r["id"]} | {100 * math.exp(r["hr"]):.0f} | {100 * math.exp(res[("hr", "a")]["pl"][i]):.0f} | '
                     f'{100 * math.exp(r["xb"]):.0f} | {100 * math.exp(res[("xb", "a")]["pl"][i]):.0f} |')
        L.append('')
        # 높이 신호: ⓐ 잔차와 높이
        hs = [(r['h'], res[('hr', 'a')]['resid'][i], res[('xb', 'a')]['resid'][i]) for i, r in enumerate(sample) if r['h'] is not None]
        if len(hs) > 2:
            h, e1, e2 = map(np.array, zip(*hs))
            L += [f'펜스 높이 신호 (ⓐ 잔차 대 높이, 높이가 있는 {len(hs)}곳): 홈런 상관 {np.corrcoef(h, e1)[0, 1]:+.2f} · 기울기 {np.polyfit(h, e1, 1)[0]:+.3f}/m, '
                  f'(2루타+3루타) 상관 {np.corrcoef(h, e2)[0, 1]:+.2f} · 기울기 {np.polyfit(h, e2, 1)[0]:+.3f}/m. '
                  '기획안 6.2의 고정 규칙(1m당 홈런 −4% = log −0.041, 2루타+3루타 +3%)과 견준다.', '']
    sample, res = results['하드힛 9곳']

    # 좌우 비대칭 신호: log(좌타 홈런 / 우타 홈런) 대 (좌 − 우) 펜스
    asym = []
    for r in sample:
        hl, hr_ = hh.get((r['id'], 'L')), hh.get((r['id'], 'R'))
        if hl and hr_:
            asym.append((r['l'] - r['r'], math.log(float(hl['홈런']) / float(hr_['홈런'])), r['id']))
    d, lr, ids = zip(*asym)
    L += ['## 좌우 비대칭 신호', '',
          '좌타 홈런 ÷ 우타 홈런 (하드힛 좌우 표) 대 좌측 − 우측 펜스 거리. 좌측이 멀수록(+) 좌타가 당겨 치는 우측이 가까워 좌타 쪽이 커질 것.', '',
          '| 구장 | 좌 − 우 (m) | 좌타 ÷ 우타 홈런 |', '|---|---:|---:|']
    for a, b, i in asym:
        L.append(f'| {i} | {a:+.1f} | {math.exp(b):.2f} |')
    L += ['', f'좌우 거리가 다른 구장은 {sum(1 for a in d if a)}곳뿐이라 기울기를 잴 수 없다 (거리 같은 구장 사이의 좌타 ÷ 우타 흔들림 표준편차 '
          f'{np.std([b for a, b, _ in asym if a == 0], ddof=1):.2f}). 기획안 6.2-3 규칙(1m당 짧은 쪽 +2%)은 임시값 그대로.', '']

    # 득점 계수 f: 두 지수 짐작 → f, 하드힛 f 구장-기간 평균과
    pf = {int(y): v for y, v in meta['parkFactors'].items()}
    periods = defaultdict(list)
    for y in sorted(pf):
        if y == 2026:
            continue
        for fr, f in pf[y].items():
            pid = PM.park_of(parks, fr, y)
            periods[(pid, PM.spec_period(parks, pid, y))].append(f)
    hr_a, xb_a = res[('hr', 'a')], res[('xb', 'a')]
    lines, errs, errs_half, neutral, tab_fit = [], [], [], [], {}
    for (pid, start), fs in sorted(periods.items()):
        s = spec_row(parks, pid, start)
        ft = features(s) if s else None
        if not ft:
            lines.append(f'| {pid} {start}~ | {np.mean(fs):.3f} | (펜스 칸 없음) | | |')
            continue
        # 표본 안 구장은 그 구장을 빼고 맞춘 식으로 (한 구장 빼고)
        m = np.array([r['id'] != pid for r in sample])
        bh = ols(np.array([[r['mean']] for r in sample])[m], hr_a['y'][m])
        bx = ols(np.array([[r['mean']] for r in sample])[m], xb_a['y'][m])
        gh, gx = predict(bh, np.array([[ft['mean']]]))[0], predict(bx, np.array([[ft['mean']]]))[0]
        f1, f5 = run_factor(gh, gx, R), run_factor(0.5 * gh, 0.5 * gx, R)
        mf = float(np.mean(fs))
        errs.append(f1 - mf); errs_half.append(f5 - mf); neutral.append(1 - mf)
        lines.append(f'| {pid} {start}~ | {mf:.3f} | {f1:.3f} | {f5:.3f} | {"표본" if not m.all() else "표본 밖"} |')
    L += ['## 득점 계수 f로 본 짐작 (2015~2025 구장-기간)', '',
          'ⓐ 식(해당 구장은 빼고 맞춤)의 홈런·(2루타+3루타) 짐작에서 득점 가치로 f를 셈해, 하드힛 f의 그 구장-기간 평균과 견준다 '
          f'(사건별 득점 가치 {RUN_VALUE}, 2022~2025 리그 비율). 하드힛 f는 구단 평균 1로 맞춘 값이라 수준이 조금 다를 수 있다.', '',
          '| 구장-기간 | 하드힛 f 평균 | 짐작 f (w 1) | 짐작 f (w 0.5) | 회귀 표본 |', '|---|---:|---:|---:|---|']
    L += lines
    L += ['', f'RMSE: 짐작 w 1 {rmse(errs):.4f} · w 0.5 {rmse(errs_half):.4f} · 중립 1 {rmse(neutral):.4f} ({len(errs)}개 구장-기간)', '']
    tab_fit['f'] = (rmse(errs), rmse(errs_half), rmse(neutral), len(errs))

    # 상·하한과 고르기 범위
    allr = rows + extra
    fs_all = [v for y in pf for v in pf[y].values()]
    hs = [r['h'] for r in allr if r['h'] is not None]
    L += ['## 상·하한 (4.2-5)과 신구장 고르기 범위 (6.1)', '',
          f'- 홈런 지수: 표본 {100 * math.exp(min(r["hr"] for r in rows)):.1f}~{100 * math.exp(max(r["hr"] for r in rows)):.1f} (하드힛 9곳)',
          f'- (2루타+3루타) 지수: 표본 {100 * math.exp(min(r["xb"] for r in rows)):.1f}~{100 * math.exp(max(r["xb"] for r in rows)):.1f}',
          f'- 득점 계수 f: 2015~2026 하드힛 {min(fs_all):.3f}~{max(fs_all):.3f}',
          f'- 좌측 펜스 {min(r["l"] for r in allr):g}~{max(r["l"] for r in allr):g}m, 우측 {min(r["r"] for r in allr):g}~{max(r["r"] for r in allr):g}m, '
          f'중앙 {min(r["c"] for r in allr):g}~{max(r["c"] for r in allr):g}m, 높이 {min(hs):g}~{max(hs):g}m (높이 없는 구장: '
          f'{", ".join(r["id"] for r in allr if r["h"] is None) or "없음"}). 볼파크 우측 8m 벽은 좌우 높이 칸에 넣지 않았다.', '']
    OUT.write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
    print(f'→ {OUT}')
    for label, (_, res) in results.items():
        for k, v in res.items():
            print(label, k, f'loo {v["loo"]:.3f} neutral {v["neutral"]:.3f} best w {v["best"]} {v["ws"][v["best"]]:.3f} beta {np.round(v["beta"], 4)}')
    print('f', tab_fit['f'])


if __name__ == '__main__':
    main()
