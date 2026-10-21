#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""숨겨진 특수능력 후보를 기록으로 뽑아 data-src/특수능력.csv 초안을 만든다.

사용법:  python tools/suggest_traits.py [--year 2026] [--out data-src/특수능력.csv]

규칙 (2026-10-08, 사용자가 "조건을 완화해도 된다"고 해서 넓게 잡은 값. 모두 임시 기준):
- 대상: 그 해 1군 기록이 있는 실존 선수.
- 프랜차이즈: 지금 소속 구단(계보 기준)에서 8시즌 이상 → 안방 사나이.
- 레전드: 통산 12시즌 이상이고 누적 기록이 충분한 선수 (타자 4,000타석 또는 150홈런, 투수 1,000이닝 또는 100세이브 또는 150세이브+홀드 또는 900탈삼진)
  → 늦게 지는 꽃. 타점 700 이상 타자는 승부사, 100세이브 이상 투수는 위기 탈출, 1,000이닝 이상 선발은 에이스 체력.
- 철인: 통산 10시즌 이상이고 시즌당 평균 출전이 많은 선수 (야수 110경기, 선발 140이닝, 구원 55경기).
- 클러치 (2026-10-22, 하드힛 가공값 data-src/hardhit_derived/clutch_bat.csv·clutch_pit.csv, 파일이 없으면 건너뜀):
  최근 5시즌(그 해 제외) 1,000타석 이상이고 CLUTCH 합 +2.0 이상인 타자 → 승부사.
  최근 5시즌 구원(세이브+홀드 30 이상)으로 SD+MD 60 이상이고 SD 비율(SD/(SD+MD)) 0.72 이상인 투수 → 위기 탈출.
  CLUTCH = 레버리지를 뺀 WPA와 실제 WPA의 차이 (팬그래프식), SD/MD = 승리 확률을 6%p 넘게 올린/내린 등판.
- 한 선수에 최대 2개 (우선순위: 안방 사나이 → 승부사·위기 탈출·에이스 체력 → 늦게 지는 꽃 → 철인).
- 가을 사나이, 좌완 킬러, 우완 킬러는 기록으로 가릴 수 없어 자동으로 주지 않는다. CSV를 직접 고쳐 넣는다.

CSV는 사람이 고치는 파일이다. 다시 돌리면 덮어쓰므로, 직접 고친 뒤에는 돌리지 말고 build_data.py만 쓴다.
능력 열은 세미콜론으로 여러 개를 적는다 (예: 안방 사나이;승부사). 가능한 값은 tools/build_data.py의 TRAIT_LABELS.
"""
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'public' / 'data'


def arg(name, default):
    i = sys.argv.index(f'--{name}') if f'--{name}' in sys.argv else -1
    return sys.argv[i + 1] if i >= 0 else default


YEAR = int(arg('year', 2026))
OUT = Path(arg('out', ROOT / 'data-src' / '특수능력.csv'))

# 기준값 (임시값)
FRANCHISE_SEASONS = 8
CLUTCH_SEASONS = 5
CLUTCH_MIN_PA = 1000
CLUTCH_SUM = 2.0
SHUTDOWN_MIN = 60
SHUTDOWN_RATE = 0.72
SHUTDOWN_RELIEF = 30
HARDHIT = ROOT / 'data-src' / 'hardhit_derived'
LEGEND_SEASONS = 12
IRON_SEASONS = 10


def load(p):
    return json.loads(p.read_text(encoding='utf-8'))


def rows(d, k):
    fields = d[k + 'Fields']
    return [dict(zip(fields, r)) for r in d[k]]


def clutch_tables():
    """하드힛 가공값 → (타자 id → {타석, CLUTCH}, 투수 id → {SD, MD, 세이브, 홀드}) 최근 CLUTCH_SEASONS시즌 합"""
    def read(name):
        path = HARDHIT / name
        if not path.exists():
            return []
        with path.open(encoding='utf-8', newline='') as f:
            return [r for r in csv.DictReader(f) if YEAR - CLUTCH_SEASONS <= int(r['연도']) < YEAR]
    bat, pit = defaultdict(Counter), defaultdict(Counter)
    for r in read('clutch_bat.csv'):
        bat[r['선수ID']]['pa'] += int(r['타석'])
        bat[r['선수ID']]['clutch'] += float(r['CLUTCH'] or 0)
    for r in read('clutch_pit.csv'):
        for k in ('SD', 'MD', '세이브', '홀드'):
            pit[r['선수ID']][k] += float(r[k] or 0)
    return bat, pit


def main():
    meta = load(DATA / 'meta.json')
    players = {p['id']: p for p in load(DATA / 'players.json')['players']}
    cur = load(DATA / 'seasons' / f'{YEAR}.json')
    t2f_cur = {t['name']: t['franchise'] for t in cur['teams']}
    # 지금 소속 (투수 기록이 있으면 투수 기록의 팀)
    team_of = {}
    for r in rows(cur, 'bat'):
        team_of[r['id']] = r['team']
    for r in rows(cur, 'pit'):
        team_of[r['id']] = r['team']

    # 통산 (그 해 이전까지)
    seasons = Counter()           # id → 1군 시즌 수
    fr_seasons = defaultdict(Counter)  # id → 계보별 시즌 수
    bat = defaultdict(Counter)    # id → 누적 타자 기록
    pit = defaultdict(Counter)    # id → 누적 투수 기록
    for y in meta['years']:
        if y >= YEAR:
            continue
        d = load(DATA / 'seasons' / f'{y}.json')
        t2f = {t['name']: t['franchise'] for t in d['teams']}
        seen = set()
        for r in rows(d, 'bat'):
            if r['id'] not in team_of:
                continue
            for k in ('g', 'pa', 'hr', 'rbi'):
                bat[r['id']][k] += r[k] or 0
            if r['id'] not in seen:
                seen.add(r['id'])
                seasons[r['id']] += 1
                fr_seasons[r['id']][t2f.get(r['team'], r['team'])] += 1
        for r in rows(d, 'pit'):
            if r['id'] not in team_of:
                continue
            for k in ('g', 'gs', 'outs', 'sv', 'hld', 'so'):
                pit[r['id']][k] += r[k] or 0
            if r['id'] not in seen:
                seen.add(r['id'])
                seasons[r['id']] += 1
                fr_seasons[r['id']][t2f.get(r['team'], r['team'])] += 1

    # 특별 엔트리(은퇴 경기 등)로 새 게임에서 빠지는 선수는 뺀다
    special = set(meta.get('specialEntries', {}).get(str(YEAR), []))
    clutch_b, clutch_p = clutch_tables()
    out = []
    for pid, team in team_of.items():
        p = players.get(pid)
        if not p or not p.get('real', True) or pid in special:
            continue
        n = seasons[pid]
        if n == 0:
            continue
        is_pit = p['kind'] == 'P' or (pid in pit and pid not in bat)
        b, q = bat[pid], pit[pid]
        why = []
        traits = []

        fr = t2f_cur.get(team, team)
        fn = fr_seasons[pid][fr]
        if fn >= FRANCHISE_SEASONS:
            traits.append('안방 사나이')
            why.append(f'{fr} {fn}시즌')

        cb, cp = clutch_b.get(pid), clutch_p.get(pid)
        if not is_pit and cb and cb['pa'] >= CLUTCH_MIN_PA and cb['clutch'] >= CLUTCH_SUM:
            traits.append('승부사')
            why.append(f'최근 {CLUTCH_SEASONS}시즌 CLUTCH {cb["clutch"]:+.1f} ({cb["pa"]}타석)')
        if is_pit and cp and cp['세이브'] + cp['홀드'] >= SHUTDOWN_RELIEF and cp['SD'] + cp['MD'] >= SHUTDOWN_MIN                 and cp['SD'] / (cp['SD'] + cp['MD']) >= SHUTDOWN_RATE:
            traits.append('위기 탈출')
            why.append(f'최근 {CLUTCH_SEASONS}시즌 SD {cp["SD"]:.0f} / MD {cp["MD"]:.0f}')

        ip = q['outs'] / 3
        starter = is_pit and q['gs'] >= q['g'] * 0.5
        legend = n >= LEGEND_SEASONS and (
            (not is_pit and (b['pa'] >= 4000 or b['hr'] >= 150)) or
            (is_pit and (ip >= 1000 or q['sv'] >= 100 or q['sv'] + q['hld'] >= 150 or q['so'] >= 900)))
        if legend:
            if not is_pit and b['rbi'] >= 700:
                traits.append('승부사')
                why.append(f'통산 {b["rbi"]}타점')
            elif is_pit and q['sv'] >= 100:
                traits.append('위기 탈출')
                why.append(f'통산 {q["sv"]}세이브')
            elif is_pit and ip >= 1000 and starter:
                traits.append('에이스 체력')
                why.append(f'통산 {ip:.0f}이닝')
            traits.append('늦게 지는 꽃')
            why.append(f'통산 {n}시즌 ' + (f'{b["pa"]}타석 {b["hr"]}홈런' if not is_pit else f'{ip:.0f}이닝 {q["so"]}탈삼진'))

        if n >= IRON_SEASONS:
            per = (ip / n) if starter else ((q['g'] if is_pit else b['g']) / n)
            iron = (starter and per >= 140) or (is_pit and not starter and per >= 55) or (not is_pit and per >= 110)
            if iron:
                traits.append('철인')
                why.append(f'시즌당 {per:.0f}' + ('이닝' if starter else '경기'))

        traits = list(dict.fromkeys(traits))[:2]
        if not traits:
            continue
        out.append({'선수ID': pid, '선수명': p['name'], '구단': team, '구분': '투수' if is_pit else '야수',
                    '능력': ';'.join(traits), '근거': ', '.join(why), '확인': '자동'})

    out.sort(key=lambda r: (r['구단'], r['구분'], r['선수명']))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open('w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['선수ID', '선수명', '구단', '구분', '능력', '근거', '확인'])
        w.writeheader()
        w.writerows(out)
    c = Counter(t for r in out for t in r['능력'].split(';'))
    print(f'{YEAR}년 기준 후보 {len(out)}명 → {OUT}')
    for k, v in c.most_common():
        print(f'  {k}: {v}명')
    by_team = Counter(r['구단'] for r in out)
    print('  구단별: ' + ', '.join(f'{t} {n}' for t, n in sorted(by_team.items())))


if __name__ == '__main__':
    main()
