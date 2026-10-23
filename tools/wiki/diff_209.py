# -*- coding: utf-8 -*-
"""위키 기록 차이 확인표: 위키백과·나무위키가 같은 값으로 우리와 다른 칸만 (2026-10-23 사용자 결정 '나')

  python tools/wiki/diff_209.py

  reports/wiki-diff-209.md                 사람이 보는 표 (선수별로 묶고, 차이 큰 선수·칸부터)
  ~/kbo-gm-raw/정리/기록_확인_209.csv       고르기 칸('고름': 우리/위키)이 끝에 있는 사본. 저장소에 올리지 않는다

확인이 끝나기 전까지 이 칸들도 우리 값을 그대로 쓴다. 고른 결과를 게임 자료에 넣는 단계는 아직 없다.
"""
import csv
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import diff_report as D  # noqa: E402

OUT_MD = C.ROOT / 'reports' / 'wiki-diff-209.md'
OUT_CSV = C.RAW_NOTE / '기록_확인_209.csv'
HEADER = ['선수ID', '이름', '연도', '구단', '구분', '항목', '우리 값', '위키 값', '나무 값', '차이', '짐작한 까닭', '고름']


def fmt(d):
    d = int(d) if float(d).is_integer() else round(d, 1)
    return f'+{d}' if d > 0 else str(d)


def show(x, key):
    """아웃 칸은 사람이 읽기 쉽게 이닝도 붙인다 (128 → 128 (42⅔))"""
    v = x[key]
    if not v or not x['항목'].startswith('아웃'):
        return v
    outs = int(float(v))
    return f"{v} ({outs // 3}{['', '⅓', '⅔'][outs % 3]})"


def main():
    C.stdout_utf8()
    out = [x for x in D.classify(C.read_csv(C.OUT_DIR / '기록_차이.csv')) if x['src'] == 'same']
    by_player = defaultdict(list)
    for x in out:
        by_player[(x['선수ID'], x['이름'])].append(x)
    for xs in by_player.values():
        xs.sort(key=lambda x: (-abs(x['diff']), int(x['연도']), x['구분'], x['항목']))
    # 선수 순서: 가장 큰 차이 → 칸 수 → 선수ID
    players = sorted(by_player, key=lambda p: (-abs(by_player[p][0]['diff']), -len(by_player[p]), p[0]))
    flat = [x for p in players for x in by_player[p]]

    with open(OUT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        for x in flat:
            w.writerow([x['선수ID'], x['이름'], x['연도'], x['구단'], x['구분'], x['항목'],
                        x['우리 값'], x['위키 값'], x['나무 값'], fmt(x['diff']), x['why'], ''])

    size = defaultdict(int)
    for x in flat:
        size[x['size']] += 1
    L = ['# 위키 기록 차이 확인표 (위키 두 곳이 같은 값으로 우리와 다른 칸)', '',
         f'`python tools/wiki/diff_209.py`가 만든다. 원자료 `data-src/wiki/기록_차이.csv`에서 위키백과·나무위키 값이 서로 같고 우리 값과 다른 칸 '
         f'**{len(flat)}칸 · 선수 {len(players)}명** (±1 {size["±1"]} · 2~5 {size["2~5"]} · 6 이상 {size["6 이상"]}).',
         '2026-10-23 사용자 결정(질문 1의 \'나\'): 이 칸만 사람이 하나씩 확인한다. **확인 전까지는 우리 값을 그대로 쓴다.**',
         f'고르기는 저장소 밖 사본 `{OUT_CSV.as_posix().replace(Path.home().as_posix(), "~")}`의 끝 열 \'고름\'에 `우리` 또는 `위키`로 적는다.',
         '차이 = 위키 값 − 우리 값. 짐작한 까닭은 기계 짐작이다 (`tools/wiki/diff_report.py` 머리말 규칙). KBO 공식 기록과는 대조하지 못했다.',
         '선수는 가장 큰 차이 순, 선수 안에서는 차이 큰 칸부터.', '']
    for pid, name in players:
        xs = by_player[(pid, name)]
        L += [f'### {name} ({pid}) — {len(xs)}칸', '',
              '| 연도 | 구단 | 항목 | 우리 | 위키백과 | 나무위키 | 차이 | 짐작한 까닭 |', '|---|---|---|---:|---:|---:|---:|---|']
        for x in xs:
            L.append(f"| {x['연도']} | {x['구단']} | {x['구분']} {x['항목']} | {show(x, '우리 값')} | {show(x, '위키 값')} | {show(x, '나무 값')} "
                     f"| {fmt(x['diff'])} | {x['why']} |")
        L.append('')
    OUT_MD.write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
    C.log(f'[확인표 끝] {len(flat)}칸 · 선수 {len(players)}명 → {OUT_MD}, {OUT_CSV}')


if __name__ == '__main__':
    main()
