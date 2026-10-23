# -*- coding: utf-8 -*-
"""위키 차이 정리: data-src/wiki/기록_차이.csv·인적사항_차이.csv → reports/wiki-diff.md (사용자 확인용 묶음)

  python tools/wiki/diff_report.py

칸마다 고르는 표는 기록_차이.csv 그대로 둔다. 여기서는 개수를 묶고, 흔한 까닭을 기계로 짐작해 예를 든다.
짐작 (위에서부터 처음 맞는 것 하나):
  4사구        볼넷 칸의 위키 값 = 우리 볼넷 + 몸에 맞는 공
  이적 합산    위키 값 = 그 해 우리 모든 구단 값의 합 (시즌 중 이적)
  2026 진행 중 2026년 (우리 10월 8일 스냅샷, 나무위키 8월 크롤, 위키백과 10월 23일 받음)
  연도 밀림    위키 값(5 이상) = 우리 같은 항목의 앞뒤 해 값, 차이 3 이상
  칸 밀림      위키 값(10 이상) = 우리 같은 해 다른 항목 값, 차이 3 이상 (작은 수·작은 차이는 우연히 맞기 쉬워 뺀다)
  이닝 끝수    아웃 칸이 1~2 차이 (1/3이닝 표기·반올림)
  그 밖
"""
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import s5_merge as M  # noqa: E402

KO_FIELD = {}
for k, v in M.FIELD_KO.items():
    KO_FIELD[('bat', v)] = k
    KO_FIELD[('pit', M.PIT_KO.get(k, v))] = k
for k, v in M.PIT_KO.items():
    KO_FIELD[('pit', v)] = k
SRC_LABEL = {'w': '위키백과만 다름', 'n': '나무위키만 다름', 'same': '둘 다 다르고 둘이 같음', 'split': '둘 다 다르고 둘도 다름'}
OUT = C.ROOT / 'reports' / 'wiki-diff.md'


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def era(y):
    return '2026' if y >= 2026 else f'{y // 10 * 10}년대'


def size_bucket(d):
    d = abs(d)
    return '±1' if d <= 1 else ('2~5' if d <= 5 else '6 이상')


def classify(rows):
    """기록_차이.csv 행마다 누가 다른가·차이·크기·짐작한 까닭을 붙인다 (diff_209.py도 쓴다)"""
    seasons = C.load_seasons(C.BASE_DATA if C.BASE_DATA.exists() else None)  # s5_merge와 같은 기반 자료 (위키 값 넣기 전)
    ours = M.our_season_rows(seasons)
    by_year = defaultdict(list)  # (선수, 연도, 종류) → [행 값]
    for (pid, y, fr, kind), v in ours.items():
        by_year[(pid, y, kind)].append(v)

    out = []
    for r in rows:
        kind = 'pit' if r['구분'] == '투수' else 'bat'
        y, k = int(r['연도']), KO_FIELD.get((kind, r['항목']))
        o, w, n = num(r['우리 값']), num(r['위키 값']), num(r['나무 값'])
        wd = w is not None and w != o
        nd = n is not None and n != o
        src = 'same' if wd and nd and w == n else 'split' if wd and nd else 'w' if wd else 'n'
        theirs = [v for v, d in ((w, wd), (n, nd)) if d]
        diff = max((v - o for v in theirs), key=abs)
        frs = r['계보'].split('+') if r.get('계보') else [C.franchise_of(r['구단']) or r['구단']]
        fr = frs[0]
        mine = M.add_fields([ours.get((r['선수ID'], y, f, kind), {}) for f in frs])  # 합산 줄은 우리 구단별 행의 합
        allrows = by_year.get((r['선수ID'], y, kind), [])
        why = '그 밖'
        if k == 'bb' and mine.get('hbp') is not None and any(v == o + mine['hbp'] for v in theirs) and mine['hbp'] > 0:
            why = '4사구'
        elif len(allrows) > 1 and k and any(v == sum((x.get(k) or 0) for x in allrows) for v in theirs):
            why = '이적 합산'
        elif y >= 2026:
            why = '2026 진행 중'
        elif k and abs(diff) >= 3 and any(v >= 5 and v == (ours.get((r['선수ID'], yy, fr, kind)) or {}).get(k) for v in theirs for yy in (y - 1, y + 1)):
            why = '연도 밀림'
        elif k and abs(diff) >= 3 and any(v >= 10 and v == mv for v in theirs for kk, mv in mine.items() if kk != k and isinstance(mv, (int, float))):
            why = '칸 밀림'
        elif k == 'outs' and abs(diff) <= 2:
            why = '이닝 끝수'
        out.append({**r, 'src': src, 'diff': diff, 'size': size_bucket(diff), 'why': why, 'era': era(y), 'kind': kind})
    return out


def main():
    C.stdout_utf8()
    rows = C.read_csv(C.OUT_DIR / '기록_차이.csv')
    prof = C.read_csv(C.OUT_DIR / '인적사항_차이.csv')
    out = classify(rows)

    L = ['# 위키 차이 정리 (사용자 확인용)', '',
         f'`python tools/wiki/diff_report.py`가 만든다. 원자료: `data-src/wiki/기록_차이.csv` {len(rows):,}칸, `인적사항_차이.csv` {len(prof):,}칸.',
         '신뢰도 규칙(2026-10-23 사용자): 우리 원자료 > 위키백과 > 나무위키. **기록 값이 다르면 자동으로 바꾸지 않는다.** 이 문서는 고를 규칙을 정하기 위한 묶음이다.',
         '칸마다 고르는 표는 `기록_차이.csv` 그대로 쓴다.',
         '**2026-10-23 사용자 결정: 4장의 "나".** 위키 두 곳이 같은 값으로 다른 칸만 `reports/wiki-diff-209.md`로 하나씩 확인하고 (`tools/wiki/diff_209.py`), '
         '확인 전까지와 나머지 칸은 우리 값을 그대로 쓴다.', '']

    def table(title, key, order=None):
        c = Counter(key(x) for x in out)
        ks = order or [k for k, _ in c.most_common()]
        L.extend([f'### {title}', '', '| 묶음 | 칸 | 몫 |', '|---|---:|---:|'])
        for kk in ks:
            if c.get(kk):
                L.append(f'| {kk} | {c[kk]:,} | {c[kk] / len(out):.0%} |')
        L.append('')

    L += ['## 1. 기록 차이 개수', '']
    table('누가 다른가', lambda x: SRC_LABEL[x['src']], list(SRC_LABEL.values()))
    table('차이 크기 (우리 값과 가장 많이 벌어진 쪽)', lambda x: x['size'], ['±1', '2~5', '6 이상'])
    table('연대', lambda x: x['era'], sorted({x['era'] for x in out}))
    table('항목 (상위 20)', lambda x: f"{r_kind(x)} {x['항목']}")
    # 항목 × 크기
    L += ['### 항목별 크기 (상위 15 항목)', '', '| 항목 | ±1 | 2~5 | 6 이상 | 합 |', '|---|---:|---:|---:|---:|']
    ic = Counter(f"{r_kind(x)} {x['항목']}" for x in out)
    for item, tot in ic.most_common(15):
        s = Counter(x['size'] for x in out if f"{r_kind(x)} {x['항목']}" == item)
        L.append(f"| {item} | {s['±1']} | {s['2~5']} | {s['6 이상']} | {tot} |")
    L.append('')
    # 누가 × 크기
    L += ['### 누가 다른가 × 크기', '', '| 묶음 | ±1 | 2~5 | 6 이상 |', '|---|---:|---:|---:|']
    for sk, label in SRC_LABEL.items():
        s = Counter(x['size'] for x in out if x['src'] == sk)
        L.append(f"| {label} | {s['±1']} | {s['2~5']} | {s['6 이상']} |")
    L.append('')

    L += ['## 2. 흔한 까닭 (기계 짐작)', '',
          '위에서부터 처음 맞는 것 하나로 센다. 짐작이라 틀릴 수 있다 (`tools/wiki/diff_report.py` 머리말의 규칙).', '']
    table('까닭', lambda x: x['why'])
    gb = Counter(f"{r_kind(x)} {x['항목']}" for x in out if x['why'] == '그 밖' and x['size'] == '±1')
    L += ['메모 (사람 짐작):',
          f"- '그 밖'의 ±1 중 가장 많은 것은 {', '.join(f'{k} {v}' for k, v in gb.most_common(3))}칸이다. 타자 경기 수는 대수비·대주자 출장을 세는 법이 자료마다 달라 보인다 (확인 못 함).",
          '- 시즌 중 이적 합산(위키 값 = 그 해 우리 여러 구단 합)은 0칸이었다. 우리 행은 계보별로 합쳐 견주고, 위키 표도 구단별로 나뉘어 있다.',
          '- 2026년은 우리 10월 8일 스냅샷, 나무위키 8월 말 크롤, 위키백과 10월 23일 받음이라 날짜 차이로 어긋난다. 정규시즌 끝 값으로 다시 받기 전에는 비교 의미가 적다.',
          "- '이닝 끝수'는 1/3이닝 표기(133⅓, 133.1)를 읽는 법 차이로 보인다.", '']
    for why in [k for k, _ in Counter(x['why'] for x in out).most_common()]:
        xs = [x for x in out if x['why'] == why]
        L += [f'#### {why} — 예', '', '| 선수 | 연도 | 구단 | 항목 | 우리 | 위키백과 | 나무위키 |', '|---|---|---|---|---:|---:|---:|']
        step = max(1, len(xs) // 6)
        for x in xs[::step][:6]:
            L.append(f"| {x['이름']} ({x['선수ID']}) | {x['연도']} | {x['구단']} | {r_kind(x)} {x['항목']} | {x['우리 값']} | {x['위키 값']} | {x['나무 값']} |")
        L.append('')

    # 인적 사항
    L += ['## 3. 인적 사항 차이', '', '우리 값이 있는데 위키 값이 다른 것. 규칙상 우리 값을 그대로 두고, 짝이 틀렸는지 확인하는 용도다.', '',
          '| 항목 | 칸 | 위키백과와 다름 | 나무위키와 다름 | 둘 다 같은 값으로 다름 |', '|---|---:|---:|---:|---:|']
    pc = Counter(r['항목'] for r in prof)
    for item, tot in pc.most_common():
        xs = [r for r in prof if r['항목'] == item]
        wv = sum(1 for r in xs if r['위키 값'] and r['위키 값'] != r['우리 값'])
        nv = sum(1 for r in xs if r['나무 값'] and r['나무 값'] != r['우리 값'])
        both = sum(1 for r in xs if r['위키 값'] and r['위키 값'] == r['나무 값'] and r['위키 값'] != r['우리 값'])
        L.append(f'| {item} | {tot} | {wv} | {nv} | {both} |')
    L.append('')
    bd = [r for r in prof if r['항목'] == '생년월일']
    yy = Counter('해가 다름' if (r['위키 값'] or r['나무 값'])[:4] != r['우리 값'][:4] else '월일만 다름' for r in bd)
    L += [f"생년월일 {len(bd)}칸: 해가 다름 {yy['해가 다름']}, 월일만 다름 {yy['월일만 다름']}. "
          '해가 다르면 나이가 바뀌어 능력·노화에 영향이 있다. 예:', '',
          '| 선수 | 우리 | 위키백과 | 나무위키 |', '|---|---|---|---|']
    bd.sort(key=lambda r: (r['우리 값'][:4] == (r['위키 값'] or r['나무 값'])[:4],))
    for r in bd[:yy['해가 다름'] + 4]:
        L.append(f"| {r['이름']} ({r['선수ID']}) | {r['우리 값']} | {r['위키 값']} | {r['나무 값']} |")
    L.append('')

    # 규칙 안별 효과
    def count(pred):
        return sum(1 for x in out if pred(x))
    agree = count(lambda x: x['src'] == 'same')
    agree_small = count(lambda x: x['src'] == 'same' and x['size'] == '±1')
    big = agree - agree_small
    L += ['## 4. 처리 규칙 안', '',
          '| 안 | 규칙 | 우리 값을 바꾸는 칸 | 사람이 하나씩 볼 칸 |', '|---|---|---:|---:|',
          '| 가 | 모두 우리 값 유지. 차이 목록은 기록으로만 남긴다 | 0 | 0 |',
          f'| 나 | 위키백과·나무위키가 **서로 같고** 우리와 다른 칸만 목록으로 하나씩 확인, 나머지는 우리 값 유지 | 확인 뒤 정함 | {agree:,} |',
          f'| 다 | 나 중 ±1인 {agree_small:,}칸은 한 번에 승인받아 위키 값으로 바꾸고, 2 이상 다른 {big:,}칸만 하나씩 확인 | {agree_small:,} | {big:,} |', '',
          '- 한쪽 위키만 다른 칸(약 92%)은 어느 안이든 우리 값을 그대로 둔다 (위키 표 밀림·오타가 섞여 있다: 위 "칸 밀림"·"연도 밀림").',
          '- KBO 공식 기록과 대조하지 못한다 (자동 수집 보류). 그래서 "확인"은 위키 두 곳이 서로 같은지까지만 볼 수 있다.', '']
    OUT.write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
    C.log(f'[차이 정리 끝] 기록 {len(rows)} · 인적 {len(prof)} → {OUT}')


def r_kind(x):
    return '투수' if x['kind'] == 'pit' else '타자'


if __name__ == '__main__':
    main()
