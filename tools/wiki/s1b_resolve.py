# -*- coding: utf-8 -*-
"""1단계 뒤: 위키백과 애매한 짝을 더 많은 근거로 다시 가린다 (네트워크 없음, 1단계가 받아 둔 원문 캐시만).

  python tools/wiki/s1b_resolve.py            s1_match.py 다음, s3_namu.py 전에

읽는 것: ~/kbo-gm-raw/정리/짝_애매.csv 중 출처가 '위키백과'인 줄, data-src/wiki/짝.csv, 위키백과 원문 캐시
근거와 고르는 기준은 resolve.py. 다른 선수의 짝으로 이미 쓰인 문서는 후보에서 뺀다.
고른 짝은 짝.csv에 더하고(근거 '다시 가림:…'), 못 고른 것은 짝_애매.csv에 사유를 고쳐 남긴다.
"""
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import resolve as R  # noqa: E402
import s1_match as M  # noqa: E402

HEAD = ['선수ID', '이름', '위키 제목', '위키데이터', '위키 근거', '점수', '나무위키 제목', '나무 근거']


def main():
    C.stdout_utf8()
    sample = '--sample' in sys.argv
    out_dir, note_dir = C.out_paths(sample)
    pairs_f, amb_f = out_dir / '짝.csv', note_dir / '짝_애매.csv'
    pairs = {r['선수ID']: r for r in C.read_csv(pairs_f)}
    amb = C.read_csv(amb_f)
    wiki_amb = [r for r in amb if r['출처'] == '위키백과']
    players = {p['id']: p for p in C.load_players()}
    master = C.load_master_extra()
    stints = C.player_stints(C.load_seasons())
    taken = {r['위키 제목']: pid for pid, r in pairs.items() if r['위키 제목']}

    chosen, left = {}, []
    for r in wiki_amb:
        p = players.get(r['선수ID'])
        if not p:
            continue
        titles = list(dict.fromkeys([t.strip() for t in r['후보'].split(' / ') if t.strip()] + M.probe_titles(p)))
        scored = []
        for t in titles:
            pg = C.cached_page(t)  # 캐시에 없으면 받지 않는다
            if not pg or pg.get('missing') or pg.get('disambig') or not pg.get('content'):
                continue
            title = pg.get('title') or t
            if title in taken and taken[title] != p['id']:
                continue
            if not any(s[1] == title for s in scored):
                s, why = R.score(p, R.player_info(p, master), stints.get(p['id'], set()), R.wiki_cand(pg['content']))
                scored.append((s, title, why, pg.get('qid') or ''))
        best, why = R.pick([(s, t, w) for s, t, w, _ in scored])
        if best:
            q = next(x[3] for x in scored if x[1] == best[1])
            chosen[p['id']] = (best[1], q, best[2], best[0])
        else:
            left.append([r['선수ID'], r['이름'], r['후보'], f'{r["사유"]}, 다시 가림: {why}', '위키백과'])
    # 다시 가린 선수 둘이 한 문서를 고르면 둘 다 버린다
    by_title = defaultdict(list)
    for pid, c in chosen.items():
        by_title[c[0]].append(pid)
    for t, pids in by_title.items():
        if len(pids) > 1:
            for pid in pids:
                del chosen[pid]
                left.append([pid, players[pid]['name'], t, '다시 가림: 한 문서에 우리 선수 여럿', '위키백과'])

    for pid, (t, q, why, s) in chosen.items():
        old = pairs.get(pid)
        pairs[pid] = {'선수ID': pid, '이름': players[pid]['name'], '위키 제목': t, '위키데이터': q, '위키 근거': '다시 가림:' + why,
                      '점수': s, '나무위키 제목': old['나무위키 제목'] if old else '', '나무 근거': old['나무 근거'] if old else ''}
    order = [p for p in C.load_players() if p['id'] in pairs]
    C.write_csv(pairs_f, HEAD, [[pairs[p['id']][h] for h in HEAD] for p in order])
    C.write_csv(amb_f, ['선수ID', '이름', '후보', '사유', '출처'],
                [[r['선수ID'], r['이름'], r['후보'], r['사유'], r['출처']] for r in amb if r['출처'] != '위키백과'] + left)
    C.log(f'[1단계 다시 가림 끝] 위키백과 애매 {len(wiki_amb)} → 고름 {len(chosen)} · 버림 {len(left)}')


if __name__ == '__main__':
    main()
