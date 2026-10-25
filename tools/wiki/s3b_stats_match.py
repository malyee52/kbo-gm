# -*- coding: utf-8 -*-
"""3단계 덧붙임: 생년·투타가 빈 선수 중 나무위키 짝이 없는 선수를 시즌 기록 표로 짝짓는다 (2026-10-23, 빈 자료 결정 3)

  python tools/wiki/s3b_stats_match.py

생년이 없으면 s3_namu.py의 근거(생년·구단·연도)로는 같은 이름 문서('김경호', '김성수(1968)' …) 중에서 고를 수 없다.
여기서는 같은 이름 꼴 제목(titles_like)의 문서마다 KBO 시즌 기록 표를 읽어 우리 기록(위키 값을 넣기 전 기반 자료)과 견준다.
  - 같은 해·계보·타자/투수 줄의 경기 수와 안타(타자) 또는 아웃(투수)이 모두 같으면 '맞는 해'.
  - 맞는 해가 우리 1군 해의 절반 이상이고 2해 이상(1군 한 해뿐이면 그 한 해), 우리와 다른 줄이 맞는 해보다 적은 문서가
    **하나뿐일 때만** 짝으로 한다. 둘 이상이면 동명이인으로 버리고 목록에 남긴다.
쓰는 것: data-src/wiki/짝.csv의 '나무위키 제목'·'나무 근거'('나무:기록 일치 n/m해'), 문서 캐시(4단계가 읽음),
         ~/kbo-gm-raw/정리/짝_기록일치.csv (고른 것·버린 것 목록)
"""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import namumd as N  # noqa: E402
import s3_namu as S  # noqa: E402
import s4_extract as X  # noqa: E402
import s5_merge as M  # noqa: E402

KEYS = {'bat': ('g', 'h'), 'pit': ('g', 'outs')}


def doc_rows(db, title):
    md = S.get_md(db, title)
    if not md:
        return []
    grids = N.tables(md) + [t for s in S.subdoc_titles(db, title) for t in N.tables(S.get_md(db, s) or '')]
    return X.season_rows_grid(grids)


def score(rows, ours, years):
    """(맞는 해 수, 다른 줄 수)"""
    hit, miss = set(), 0
    for r in rows:
        mine = ours.get((r['year'], r['kind']))
        if not mine:
            miss += 1
            continue
        tot = M.add_fields([mine[f] for f in r['franchises'] if f in mine])
        ks = KEYS[r['kind']]
        if all(r['fields'].get(k) is not None and r['fields'].get(k) == tot.get(k) for k in ks):
            hit.add(r['year'])
        else:
            miss += 1
    return len(hit & years), miss


def main():
    C.stdout_utf8()
    base = C.BASE_DATA if (C.BASE_DATA / 'players.json').exists() else C.build_base_data()
    players = C.load_players(base)
    seasons = C.load_seasons(base)
    by_year = {}
    for (pid, y, fr, kind), v in M.our_season_rows(seasons).items():
        by_year.setdefault(pid, {}).setdefault((y, kind), {})[fr] = v
    pairs_f = C.OUT_DIR / '짝.csv'
    pairs = C.read_csv(pairs_f)
    byid = {r['선수ID']: r for r in pairs}
    used = {r['나무위키 제목'] for r in pairs if r.get('나무위키 제목')}
    targets = [p for p in players if not p.get('foreign') and (not p.get('birthYear') or not p.get('throws') or not p.get('bats'))
               and not (byid.get(p['id']) or {}).get('나무위키 제목')]
    db = S.open_db(S.DUMP)
    picked, log, why_n = {}, [], Counter()
    for p in targets:
        ours = by_year.get(p['id'], {})
        years = {y for y, _ in ours}
        if not years:
            continue
        need = 1 if len(years) == 1 else max(2, (len(years) + 1) // 2)
        good = []
        for t in S.titles_like(db, p['name']):
            if t in used:
                continue
            rows = doc_rows(db, t)
            if not rows:
                continue
            hit, miss = score(rows, ours, years)
            if hit >= need and miss < hit:
                good.append((t, hit, miss))
        if len(good) == 1:
            t, hit, miss = good[0]
            picked[p['id']] = (t, f'나무:기록 일치 {hit}/{len(years)}해')
            log.append([p['id'], p['name'], t, hit, len(years), miss, '고름'])
            why_n['고름'] += 1
        elif good:
            log.append([p['id'], p['name'], ' / '.join(g[0] for g in good), '', len(years), '', '후보 여럿 (버림)'])
            why_n['후보 여럿'] += 1
        else:
            why_n['맞는 문서 없음'] += 1
    # 두 선수가 한 문서를 고르면 둘 다 버린다
    cnt = Counter(t for t, _ in picked.values())
    for pid, (t, _) in list(picked.items()):
        if cnt[t] > 1:
            del picked[pid]
            why_n['고름'] -= 1
            why_n['한 문서에 여럿 (버림)'] += 1
    names = {p['id']: p['name'] for p in players}
    for pid, (t, why) in picked.items():
        S.save_doc(db, t, S.get_md(db, t))
        r = byid.get(pid)
        if r is None:
            r = {'선수ID': pid, '이름': names[pid], '위키 제목': '', '위키데이터': '', '위키 근거': '', '점수': ''}
            pairs.append(r)
        r['나무위키 제목'], r['나무 근거'] = t, why
    head = ['선수ID', '이름', '위키 제목', '위키데이터', '위키 근거', '점수', '나무위키 제목', '나무 근거']
    order = {p['id']: i for i, p in enumerate(players)}
    pairs.sort(key=lambda r: order.get(r['선수ID'], 1 << 30))
    C.write_csv(pairs_f, head, [[r.get(h, '') for h in head] for r in pairs])
    C.write_csv(C.RAW_NOTE / '짝_기록일치.csv', ['선수ID', '이름', '문서', '맞는 해', '우리 1군 해', '다른 줄', '결과'], log)
    C.log(f'[3b 끝] 대상 {len(targets)}명 · {dict(why_n)} → {pairs_f}')


if __name__ == '__main__':
    main()
