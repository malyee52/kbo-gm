"""KBO 수비상(2023~) 순위를 선수 ID로 바꿔 public/data/defense_awards.json으로 쓴다 (2026-10-13).

KBO 공식 사이트는 사전 승인 없는 자동 수집을 금지해(robots.txt) 수비 기록을 받을 수 없다. 대신 언론에 공개된
수비상 순위(감독·코치·단장 투표 75% + 수비 기록 25%)로 수비 추정값을 보정한다 (src/engine/defense.ts awardFloor).

쓰는 법: python tools/build_defense_awards.py
원본: data-src/수비상.csv (연도, 포지션, 순위, 선수, 구단, 총점, 출처). 이름과 그 해 소속(타자 기록)으로 ID를 찾는다.
기사가 이적 뒤 소속으로 쓴 경우(예: 2024 허경민 KT)를 위해, 그 해 소속이 안 맞으면 이름만으로 한 명일 때 받는다.
"""
import csv
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data-src' / '수비상.csv'
DATA = ROOT / 'public' / 'data'


def main():
    players = json.loads((DATA / 'players.json').read_text(encoding='utf-8'))
    plist = players if isinstance(players, list) else players.get('players', list(players.values()))
    name_of = {p['id']: p['name'] for p in plist}
    out = {}
    missing = []
    with io.open(SRC, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            y = int(r['연도'])
            season = json.loads((DATA / 'seasons' / f'{y}.json').read_text(encoding='utf-8'))
            rows = [b for b in season['bat'] if name_of.get(b[0]) == r['선수']]
            hit = [b for b in rows if b[1] == r['구단']] or (rows if len({b[0] for b in rows}) == 1 else [])
            if not hit:
                missing.append(f"{y} {r['포지션']} {r['선수']}({r['구단']})")
                continue
            pid = hit[0][0]
            out.setdefault(pid, []).append({'year': y, 'pos': r['포지션'], 'rank': int(r['순위'])})
    (DATA / 'defense_awards.json').write_text(json.dumps({
        'version': 1, 'source': 'data-src/수비상.csv (KBO 수비상 순위, 언론 보도)', 'players': out,
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'수비상: {sum(len(v) for v in out.values())}건, 선수 {len(out)}명 → {DATA / "defense_awards.json"}')
    if missing:
        print('찾지 못함:', ', '.join(missing))


if __name__ == '__main__':
    main()
