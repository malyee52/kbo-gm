#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""구종 원본(저장소 밖) → data-src/구종.csv (16-1a) · data-src/위키_구종.csv (16-1b) (가공값만, 능력치 v2, 2026-10-23).

원본 (저장소에 올리지 않는다, 결정 "구종 자료 쓸 곳"):
  C:/Users/ararp/kbo-gm-raw/수비구종/구종 데이터.csv   visualbaseball.com 구종 자료 2016~2026 (사용자 수집): 투수·시즌·구종마다
                                                     구속·도달시간·릴리스 높이·무브·낙차·그 투수의 구종 사용률 문자열
  C:/Users/ararp/kbo-gm-raw/수비구종/구종 가치.csv     같은 곳의 구종 가치: 투수·시즌·구종마다 RV/100·투구수·PA
  C:/Users/ararp/kbo-gm-raw/정리/구종/위키_구종.csv    나무위키·위키백과 덤프에서 뽑은 구종 목록 (잼쨩, 웹 접속 없음)

visualbaseball 짝 맞추기 (선수 ID 열이 없다):
  - 이름 끝 ' Q'(규정이닝 표시로 보임)를 뗀다. 팀 이름(넥센·SK 등)은 meta.json 계보로 그 해 구단과 견준다.
  - (시즌·이름) → 그 해 투수 기록이 있는 같은 이름 선수. 그 팀(계보)에 한 명이면 그 선수 (ok), 그 팀에 없고 그 해 한 명이면
    그 선수 (ok-team-differs, 이적 등), 그 해 기록이 없으면 등록 기간 안의 같은 이름 투수 한 명 (ok-no-season).
  - 같은 팀에 같은 이름 투수가 둘이면 (이승현 삼성 2021~2026 등) 구종 가치 행을 두 묶음으로 나누고(합쳐진 사용률과 견줌)
    두 묶음을 PA·투구수 합으로 사람에게 준다 (ok-stats, 아래 build_visual 설명). 그것으로 못 정하면 두 사람의 다른 해 구종
    구성과 견준다 (ok-stats-arsenal). 그래도 못 정하면 못 맞춘 행으로 남긴다.
  - 시즌 중 이적한 투수는 구종 데이터에 같은 값이 두 팀 이름으로 실린다 (ars-dup-traded, 하나로 합친다).
  - 게임 자료에 없는 투수 (2016~2025 김상수 1988년생, 2021~2022 박웅)는 no-pitcher로 남는다.
  - 구종 데이터 파일은 같은 시즌의 같은 이름 투수 둘을 한 사람처럼 합쳐 두 팀에 같은 행을 싣는다 (사용률 합 약 200%).
    그런 묶음(사용률 합이 100 ± 1.5 밖이거나 같은 구종이 두 번)은 구속·무브·사용률을 쓰지 않는다 (merged).
  - 못 맞춘 행과 합쳐진 묶음은 reports/pitches-unmatched.md에 남긴다.
data-src/구종.csv: 한 행 = 선수 · 연도 · 구종. 도달시간·PA·순위·원래 사용률 문자열은 넣지 않는다.
data-src/위키_구종.csv: 잼쨩 결과에서 기획안 15.6 열만 (이름 열은 사람 확인용, 빌드는 읽지 않는다). 설명 문장은 원래 없다.

쓰는 법: python tools/build_pitches.py [원본 폴더]   (그다음 python tools/build_data.py --pitches-only)
"""
import csv
import itertools
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'public' / 'data'
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
RAW = Path(ARGS[0]) if ARGS else Path('C:/Users/ararp/kbo-gm-raw')
RAW_ARS = RAW / '수비구종' / '구종 데이터.csv'
RAW_RV = RAW / '수비구종' / '구종 가치.csv'
RAW_WIKI = RAW / '정리' / '구종' / '위키_구종.csv'
OUT_PITCH = ROOT / 'data-src' / '구종.csv'
OUT_WIKI = ROOT / 'data-src' / '위키_구종.csv'
REPORT = ROOT / 'reports' / 'pitches-unmatched.md'

SOURCE = 'visualbaseball.com 구종 자료, 사용자 수집 2026-10, 가공'
PITCH_TYPES = ('포심', '투심', '싱커', '커터', '슬라이더', '스위퍼', '커브', '체인지업', '포크', '너클볼')
WIKI_TYPES = PITCH_TYPES + ('기타',)
USAGE = re.compile(r'(\S+) ([\d.]+)%')
# 같은 팀 동명이인 나눔 (임시값): 사용률 거리(%p 합)가 둘째 나눔과 USAGE_GAP 넘게 벌어져야 하고, 사람 정하기의 로그 거리
# (PA 합·투구수 합 ÷ 상대 타자 × 그 해 비율)는 SPLIT_MAX 이하이며 반대 길과 SWAP_GAP 넘게 벌어져야 한다
USAGE_GAP = 1.0
SPLIT_MAX = 0.3
SWAP_GAP = 0.1
ARSENAL_GAP = 20


def strip_name(s):
    s = s.strip()
    return s[:-2].strip() if s.endswith(' Q') else s


def fnum(v):
    v = (v or '').strip().replace('°', '')
    return float(v) if v not in ('', '-') else None


def load_game():
    players = {p['id']: p for p in json.loads((DATA / 'players.json').read_text(encoding='utf-8'))['players']}
    meta = json.loads((DATA / 'meta.json').read_text(encoding='utf-8'))
    fr_of = {(s['name'], y): fr for fr, spans in meta['franchises'].items() for s in spans for y in range(s['from'], s['to'] + 1)}
    pit = defaultdict(lambda: defaultdict(dict))  # 연도 → 이름 → 선수 ID → {계보: 상대 타자}
    for y in meta['years']:
        if y < 2016:
            continue
        s = json.loads((DATA / 'seasons' / f'{y}.json').read_text(encoding='utf-8'))
        f = s['pitFields']
        ii, it, ib = f.index('id'), f.index('team'), f.index('tbf')
        for r in s['pit']:
            pid = r[ii]
            fr = fr_of.get((r[it], y), r[it])
            d = pit[y][players[pid]['name']].setdefault(pid, {})
            d[fr] = d.get(fr, 0) + (r[ib] or 0)
    return players, fr_of, pit


def match_group(year, team, name, players, fr_of, pit):
    """(시즌·팀·이름) → (선수 ID 목록, 사유). 같은 팀 동명이인이면 ID 둘과 'split'"""
    fr = fr_of.get((team, year), team)
    cands = pit[year].get(name, {})
    on_team = [pid for pid, frs in cands.items() if fr in frs]
    if len(on_team) == 1:
        return on_team, 'ok'
    if len(on_team) > 1:
        return sorted(on_team), 'split'
    if len(cands) == 1:
        return list(cands), 'ok-team-differs'
    if cands:
        return [], f'ambiguous({len(cands)})'
    alive = [p['id'] for p in players.values() if p['name'] == name and p.get('kind') == 'P'
             and (p.get('first') or 0) <= year <= (p.get('last') or 0) + 1]
    if len(alive) == 1:
        return alive, 'ok-no-season'
    return [], 'no-pitcher' if not alive else f'ambiguous({len(alive)})'


def read_raw(path):
    with path.open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def build_visual(players, fr_of, pit):
    ars_raw, rv_raw = read_raw(RAW_ARS), read_raw(RAW_RV)
    unmatched, merged = [], []
    why = Counter()

    # ---- 구종 가치: (시즌·팀·이름) 묶음 → 선수 ID
    rv_groups = defaultdict(list)
    for r in rv_raw:
        rv_groups[(int(r['season']), r['팀'], strip_name(r['선수']))].append(r)
    rv_rows = []  # (선수 ID, 연도, 팀, 구종, 투구수, RV/100, 사유)
    splits = []
    for (y, team, name), rows in rv_groups.items():
        ids, reason = match_group(y, team, name, players, fr_of, pit)
        if reason == 'split':
            splits.append(((y, team, name), rows, ids))
            continue
        why[reason] += len(rows)
        if not ids:
            unmatched += [(y, team, name, r['구종'], int(r['투구수']), reason, '구종 가치') for r in rows]
            continue
        rv_rows += [(ids[0], y, team, r['구종'], int(r['투구수']), float(r['RV/100']), reason) for r in rows]

    # 같은 팀 동명이인 (이승현 삼성 2021~2026 등): 구종 데이터 파일은 둘을 합쳐 구종별 사용률을 더해 실었다 (합 약 200%).
    # 1. 구종 가치 행을 두 묶음으로 나누는 모든 경우 중 두 묶음의 사용률 합(구종별)이 합쳐진 사용률에 가장 가까운 나눔을 고른다
    #    (둘째로 가까운 다른 나눔과 USAGE_GAP 넘게 벌어져야 한다).
    # 2. 두 묶음을 두 사람에게 주는 두 길 중 PA(그 구종으로 끝난 타석) 합·투구수 합이 그 사람의 상대 타자 × 그 해 비율에
    #    가까운 쪽 (로그 거리 합, 다른 길과 SWAP_GAP 넘게 벌어져야 한다). 못 정하면 그 묶음 행 모두 못 맞춘 행으로 남긴다.
    logs, logn = defaultdict(list), defaultdict(list)
    pa_sum, n_sum = defaultdict(int), defaultdict(int)
    for r in rv_raw:
        pa_sum[(int(r['season']), r['팀'], strip_name(r['선수']))] += int(r['PA'])
        n_sum[(int(r['season']), r['팀'], strip_name(r['선수']))] += int(r['투구수'])
    for (y, team, name), pa in pa_sum.items():
        ids, reason = match_group(y, team, name, players, fr_of, pit)
        bf = pit[y][name][ids[0]].get(fr_of.get((team, y), team), 0) if reason == 'ok' else 0
        if bf >= 100 and pa > 0:
            logs[y].append(math.log(pa / bf))
            logn[y].append(math.log(n_sum[(y, team, name)] / bf))
    pa_ratio = {y: math.exp(median(v)) for y, v in logs.items()}
    n_ratio = {y: math.exp(median(v)) for y, v in logn.items()}
    merged_usage = {}
    for r in ars_raw:
        merged_usage.setdefault((int(r['season']), r['팀'], strip_name(r['선수'])),
                                {m.group(1): float(m.group(2)) for m in USAGE.finditer(r['구종 사용률'])})
    pending = []

    def assign_split(ids, y, team, name, order, owner, stable, flip, reason='ok-stats'):
        nonlocal unmatched
        for i, r in enumerate(order):
            if i in stable:
                rv_rows.append((ids[owner[i] ^ flip], y, team, r['구종'], int(r['투구수']), float(r['RV/100']), reason))
                why[reason] += 1
            else:
                unmatched.append((y, team, name, r['구종'], int(r['투구수']), 'split-row-unsure', '구종 가치'))
                why['split-row-unsure'] += 1

    for (y, team, name), rows, ids in splits:
        fr = fr_of.get((team, y), team)
        usage = merged_usage.get((y, team, name))
        by_type = defaultdict(list)
        for r in rows:
            by_type[r['구종']].append(r)
        order = [r for v in by_type.values() for r in v]
        anchor = max(range(len(order)), key=lambda i: int(order[i]['투구수']))
        reason = None
        if len(ids) != 2 or any(len(v) > 2 for v in by_type.values()):
            reason = 'split-too-many'
        elif not usage:
            reason = 'split-no-usage'
        else:
            parts = {}
            for perm in itertools.product(*[list(itertools.permutations(range(2), len(v))) for v in by_type.values()]):
                owner = tuple(o for owners in perm for o in owners)
                if owner[anchor] == 1:  # 두 묶음을 바꾼 나눔은 같은 나눔 (가장 많이 던진 행을 늘 묶음 0에)
                    continue
                n = [Counter(), Counter()]
                for o, r in zip(owner, order):
                    n[o][r['구종']] += int(r['투구수'])
                tot = [sum(c.values()) or 1 for c in n]
                du = sum(abs(sum(100 * n[i][p] / tot[i] for i in range(2)) - usage.get(p, 0)) for p in set(usage) | set(by_type))
                parts[owner] = du
            best = min(parts.values())
            near = [o for o, du in parts.items() if du < best + USAGE_GAP]
            # 거의 같은 거리의 나눔들이 묶음을 다르게 준 행(대개 적게 던진 구종)은 빼고, 나머지로 사람을 정한다
            stable = [i for i in range(len(order)) if len({o[i] for o in near}) == 1]
            owner = near[0] if len(near) == 1 else min(near, key=lambda o: parts[o])
            ways = []
            for flip in (0, 1):
                pa, nn = [0, 0], [0, 0]
                for i in range(len(order)):
                    pa[owner[i] ^ flip] += int(order[i]['PA'])
                    nn[owner[i] ^ flip] += int(order[i]['투구수'])
                d = sum(abs(math.log(max(pa[k], 1) / max(pit[y][name][ids[k]][fr] * pa_ratio[y], 1)))
                        + abs(math.log(max(nn[k], 1) / max(pit[y][name][ids[k]][fr] * n_ratio[y], 1))) for k in range(2))
                ways.append((d, flip))
            ways.sort()
            if ways[0][0] > SPLIT_MAX or ways[1][0] - ways[0][0] < SWAP_GAP:
                pending.append(((y, team, name), ids, order, owner, stable, f'split-who-close({ways[0][0]:.2f}/{ways[1][0]:.2f})'))
                continue
            assign_split(ids, y, team, name, order, owner, stable, ways[0][1])
            continue
        unmatched += [(y, team, name, r['구종'], int(r['투구수']), reason, '구종 가치') for r in rows]
        why[reason.split('(')[0]] += len(rows)
    # 사람을 못 정한 해는 같은 두 사람의 다른 해(정해진 해) 구종 구성과 견준다: 묶음별 구종 몫과 그 사람 다른 해 구종 몫의
    # 거리(%p 합)가 반대 길보다 ARSENAL_GAP 넘게 작으면 그쪽으로
    for (y, team, name), ids, order, owner, stable, why_close in pending:
        def share(rows_):
            c = Counter()
            for r in rows_:
                c[r[3]] += r[4]
            t = sum(c.values()) or 1
            return {k: 100 * v / t for k, v in c.items()}
        other = {pid: share([r for r in rv_rows if r[0] == pid and r[1] != y]) for pid in ids}
        group = [share([(None, None, None, order[i]['구종'], int(order[i]['투구수'])) for i in stable if owner[i] == g]) for g in (0, 1)]
        dist = lambda a, b: sum(abs(a.get(k, 0) - b.get(k, 0)) for k in set(a) | set(b))  # noqa: E731
        ways = sorted((dist(group[0], other[ids[f]]) + dist(group[1], other[ids[1 - f]]), f) for f in (0, 1))
        if all(other.values()) and ways[1][0] - ways[0][0] >= ARSENAL_GAP:
            assign_split(ids, y, team, name, order, owner, stable, ways[0][1], 'ok-stats-arsenal')
            continue
        unmatched += [(y, team, name, r['구종'], int(r['투구수']), why_close, '구종 가치') for r in order]
        why['split-who-close'] += len(order)

    # ---- 구종 데이터: (시즌·#) 묶음 = 한 투수 (같은 이름 둘이 합쳐진 묶음은 버림)
    ars_groups = defaultdict(list)
    for r in ars_raw:
        ars_groups[(int(r['season']), r['#'])].append(r)
    ars = {}  # (선수 ID, 연도, 구종) → (팀, 값들, 사유)
    for (y, _), rows in ars_groups.items():
        team, name = rows[0]['팀'], strip_name(rows[0]['선수'])
        usage = {}
        dup = False
        for m in USAGE.finditer(rows[0]['구종 사용률']):
            dup |= m.group(1) in usage
            usage[m.group(1)] = float(m.group(2))
        types = [r['구종'] for r in rows]
        total = sum(usage.values())
        ids, reason = match_group(y, team, name, players, fr_of, pit)
        if dup or len(set(types)) < len(types) or abs(total - 100) > 1.5 or reason == 'split':
            merged.append((y, team, name, round(total, 1), len(rows)))
            why['ars-merged'] += len(rows)
            continue
        if not ids:
            unmatched += [(y, team, name, r['구종'], None, reason, '구종 데이터') for r in rows]
            why['ars-' + reason] += len(rows)
            continue
        why['ars-' + reason] += len(rows)
        for r in rows:
            key = (ids[0], y, r['구종'])
            val = {
                'speed': fnum(r['구속 (KM/H)']), 'vmov': fnum(r['수직 무브 (CM)']), 'hmov': fnum(r['수평 무브 (CM)']),
                'rel': fnum(r['릴리스 높이 (CM)']), 'drop': fnum(r['낙차 각도']), 'usage': usage.get(r['구종']),
            }
            if key in ars:
                # 시즌 중 이적한 투수는 같은 값이 두 팀 이름으로 실린다 (김태훈 2023 키움·삼성): 하나로
                if ars[key][1] != val:
                    sys.exit(f'구종 데이터: 한 선수·시즌·구종이 값이 다른 두 묶음에 있음 {key}')
                ars[key] = (ars[key][0] + '/' + team, val, ars[key][2])
                why['ars-dup-traded'] += 1
                continue
            ars[key] = (team, val, reason)

    # ---- 합치기: (선수·연도·구종)
    rv = {}
    for pid, y, team, ptype, n, v, reason in rv_rows:
        key = (pid, y, ptype)
        if key in rv:  # 한 선수가 두 팀 이름으로 따로 실린 경우: 투구수 합, RV는 투구수 무게 평균
            t0, n0, v0, r0 = rv[key]
            rv[key] = (t0 + '/' + team, n0 + n, (v0 * n0 + v * n) / (n0 + n), r0)
        else:
            rv[key] = (team, n, v, reason)
    out = []
    for key in sorted(set(rv) | set(ars), key=lambda k: (k[1], k[0], PITCH_TYPES.index(k[2]) if k[2] in PITCH_TYPES else 99)):
        pid, y, ptype = key
        a = ars.get(key)
        v = rv.get(key)
        d = a[1] if a else {}
        rd = lambda x, k: '' if x is None else round(x, k)  # noqa: E731
        out.append({
            '출처': SOURCE, '선수ID': pid, '이름': players[pid]['name'], '연도': y, '구단': (a or v)[0], '구종': ptype,
            '구속': rd(d.get('speed'), 1), '수직무브': rd(d.get('vmov'), 1), '수평무브': rd(d.get('hmov'), 1),
            '릴리스높이': '' if d.get('rel') is None else int(round(d['rel'])),
            '낙차': rd(d.get('drop'), 1), '사용률': rd(d.get('usage'), 1),
            '투구수': v[1] if v else '', 'RV100': rd(v[2], 2) if v else '',
            '짝근거': (v or a)[-1] if not (a and v) or a[-1] == v[-1] else f'{a[-1]}+{v[-1]}',
        })
    return out, unmatched, merged, why, len(ars_raw), len(rv_raw)


def build_wiki(players):
    rows = read_raw(RAW_WIKI)
    out, bad = [], []
    for r in rows:
        pid = r['선수ID'].strip()
        if pid not in players:
            bad.append(f'없는 선수 ID {pid} ({r["이름"]})')
            continue
        if r['구종'] not in WIKI_TYPES:
            bad.append(f'모르는 구종 {r["구종"]} ({r["이름"]})')
            continue
        out.append({k: r[k].strip() for k in ('선수ID', '이름', '구종_원문', '구종', '순서', '주무기', '시작연도', '끝연도', '최고구속', '짝근거', '출처')})
    if bad:
        sys.exit('위키 구종: ' + '; '.join(bad[:20]))
    out.sort(key=lambda x: (x['선수ID'], int(x['순서'])))
    return out


def write_csv(path, rows, head):
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=head, lineterminator='\n')
        w.writeheader()
        w.writerows(rows)


def write_report(unmatched, merged, why, n_ars, n_rv, out):
    big = [u for u in unmatched if u[4] is not None and u[4] >= 300]
    lines = [
        '# 구종 자료 짝 맞추기 결과 (visualbaseball → 선수 ID)', '',
        '`python tools/build_pitches.py`가 만든다 (능력치 v2 16-1a). 원본은 저장소 밖이다.', '',
        f'- 원본: 구종 데이터 {n_ars:,}행 · 구종 가치 {n_rv:,}행 → `data-src/구종.csv` {len(out):,}행',
        '- 짝 사유별 행 수: ' + ', '.join(f'{k} {v:,}' for k, v in sorted(why.items())),
        f'- 못 맞춘 행 {len(unmatched)}개 (그중 투구수 300 이상 {len(big)}개), 합쳐진 묶음 {len(merged)}개', '',
        '## 같은 이름 투수가 합쳐진 구종 데이터 묶음 (구속·무브·사용률을 쓰지 않음, 구종 가치는 팀별이라 따로 맞춤)', '',
        '| 연도 | 팀 | 이름 | 사용률 합 | 행 |', '|---|---|---|---|---|',
    ] + [f'| {y} | {t} | {n} | {s} | {k} |' for y, t, n, s, k in sorted(merged)] + [
        '', '## 못 맞춘 행', '', '| 연도 | 팀 | 이름 | 구종 | 투구수 | 사유 | 파일 |', '|---|---|---|---|---|---|---|',
    ] + [f'| {y} | {t} | {n} | {p} | {"" if c is None else c} | {r} | {f} |' for y, t, n, p, c, r, f in sorted(unmatched, key=lambda u: (u[0], u[1], u[2], u[3]))]
    with REPORT.open('w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')


def main():
    players, fr_of, pit = load_game()
    out, unmatched, merged, why, n_ars, n_rv = build_visual(players, fr_of, pit)
    write_csv(OUT_PITCH, out, ['출처', '선수ID', '이름', '연도', '구단', '구종', '구속', '수직무브', '수평무브', '릴리스높이', '낙차', '사용률', '투구수', 'RV100', '짝근거'])
    write_report(unmatched, merged, why, n_ars, n_rv, out)
    print(f'구종 {len(out):,}행 (선수 {len({r["선수ID"] for r in out}):,}명) → {OUT_PITCH}')
    print('  짝: ' + ', '.join(f'{k} {v:,}' for k, v in sorted(why.items())))
    big = [u for u in unmatched if u[4] is not None and u[4] >= 300]
    print(f'  못 맞춘 행 {len(unmatched)} (투구수 300 이상 {len(big)}), 합쳐진 묶음 {len(merged)} → {REPORT}')
    wiki = build_wiki(players)
    write_csv(OUT_WIKI, wiki, ['선수ID', '이름', '구종_원문', '구종', '순서', '주무기', '시작연도', '끝연도', '최고구속', '짝근거', '출처'])
    print(f'위키 구종 {len(wiki):,}행 (투수 {len({r["선수ID"] for r in wiki}):,}명) → {OUT_WIKI}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
