#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""능력 산출의 회귀 상수(K) 맞추기.

직전 3시즌으로 만든 예측 비율이 그 해 실제 비율과 가장 가까워지는 K를 사건별로 찾는다.
예측식은 src/engine/ratings.ts 와 같다. 결과를 src/engine/params.ts 의 batRegress / pitRegress 에 옮긴다.

사용법:  python3 tools/fit_regression.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / 'public' / 'data'
meta = json.loads((DATA / 'meta.json').read_text(encoding='utf-8'))
kinds = {p['id']: p['kind'] for p in json.loads((DATA / 'players.json').read_text(encoding='utf-8'))['players']}
W = [1.0, 0.8, 0.6]
GRID = [25, 50, 75, 100, 150, 200, 300, 400, 600, 800, 1200, 1800]

seasons = {}
for y in meta['years']:
    s = json.loads((DATA / 'seasons' / f'{y}.json').read_text(encoding='utf-8'))
    if not s['complete']:
        continue
    bf, pf = s['batFields'], s['pitFields']
    s['batMap'] = {r[0]: dict(zip(bf, r)) for r in s['bat']}
    s['pitMap'] = {r[0]: dict(zip(pf, r)) for r in s['pit']}
    seasons[y] = s


def bat_counts(r):
    return {'so': r['so'], 'bb': r['bb'], 'hbp': r['hbp'], 'hr': r['hr'], 's1': r['h'] - r['d'] - r['t'] - r['hr'], 'd2': r['d'], 't3': r['t']}


def pit_counts(r):
    return {'so': r['so'], 'bb': r['bb'], 'hbp': r['hbp'], 'hr': r['hr'], 'hit': r['h'] - r['hr']}


def lg_rate(s, e):
    R = s['league']['rates']
    return R['s1'] + R['d2'] + R['t3'] if e == 'hit' else R[e]


def fit(kind):
    events = ['so', 'bb', 'hbp', 'hr', 's1', 'd2', 't3'] if kind == 'bat' else ['so', 'bb', 'hbp', 'hr', 'hit']
    prior = meta['priors']['batter' if kind == 'bat' else 'pitcher']
    key, counts, mp = ('pa', bat_counts, 'batMap') if kind == 'bat' else ('tbf', pit_counts, 'pitMap')
    out = {}
    for e in events:
        samples = []  # (가중 표본, 가중 리그환산 횟수, 실제 비율, 실제 표본)
        for y, s in seasons.items():
            for pid, r in s[mp].items():
                n = r[key] or 0
                if n < 100 or (kind == 'bat' and kinds.get(pid) == 'P'):
                    continue
                c = counts(r)[e]
                if c is None:
                    continue
                num = den = 0.0
                for i, w in enumerate(W):
                    h = seasons.get(y - 1 - i)
                    hr = h[mp].get(pid) if h else None
                    if not hr or not (hr[key] or 0):
                        continue
                    hc = counts(hr)[e]
                    if hc is None:
                        continue
                    num += w * hc / lg_rate(h, e)
                    den += w * hr[key]
                samples.append((den, num, c / (n * lg_rate(s, e)), n))
        best = None
        for k in GRID:
            loss = sum(n * ((num + k * prior[e]) / (den + k) - act) ** 2 for den, num, act, n in samples) / sum(x[3] for x in samples)
            if best is None or loss < best[1]:
                best = (k, loss)
        out[e] = best[0]
        print(f'{kind} {e:4s} 최적 K = {best[0]:5d}  (표본 {len(samples):,}개, 평균제곱오차 {best[1]:.4f})')
    return out


if __name__ == '__main__':
    b = fit('bat')
    p = fit('pit')
    print('batRegress:', json.dumps(b))
    print('pitRegress:', json.dumps(p))
