# -*- coding: utf-8 -*-
"""위키 209칸 처리: 위키백과·나무위키가 같은 값으로 저장소 값과 다른 칸을 신뢰 순서로 가린다 (2026-10-23 사용자 결정 '위키 209칸 처리')

  python tools/wiki/resolve_209.py

신뢰 순서: 하드힛 = KBO 공식 자료 = 저장소 자료 > 위키백과 > 나무위키.
  - 기본은 저장소 값 유지.
  - 하드힛 원본(data-src/hardhit/, 커밋하지 않음)·KBO 공식 자료(사용자 수집 수비 기록의 투수 경기·선발·이닝,
    ~/kbo-gm-raw/정리/수비이닝/수비이닝_투수.csv, 2001~)에 같은 칸이 있으면 견준다.
  - 맨 윗자리 셋(하드힛·KBO 공식·저장소) 중 둘 이상이 위키 값과 같으면 위키 값으로 고친다.
    저장소는 정의상 위키와 다르므로 하드힛과 KBO 공식이 둘 다 위키와 같아야 고친다.
  - 맨 윗자리끼리 갈리면(하드힛 하나만 위키와 같음 등) 저장소 값 유지 + 목록.
쓰는 것:
  data-src/wiki/기록_고침.csv   고칠 칸 (build_data.py가 위키 빈 칸 채우기 뒤에 적용)
  reports/wiki-209-resolve.md   칸마다 값과 결과
하드힛 원본이 이 저장소에 없으면(worktree) 본 저장소 C:/Users/ararp/Desktop/kbo-gm/data-src/hardhit/를 읽는다.
"""
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import common as C  # noqa: E402
import diff_report as D  # noqa: E402
import hardhit_common as H  # noqa: E402

OUT_CSV = C.OUT_DIR / '기록_고침.csv'
OUT_MD = C.ROOT / 'reports' / 'wiki-209-resolve.md'
KBO_PIT = C.RAW_NOTE / '수비이닝' / '수비이닝_투수.csv'
MAIN_HARDHIT = Path('C:/Users/ararp/Desktop/kbo-gm/data-src/hardhit')

# 위키 항목 이름 → 하드힛 classic 열
HH_BAT = {'경기': '경기', '타석': '타석', '타수': '타수', '득점': '득점', '안타': '안타', '2루타': '2루타', '3루타': '3루타', '홈런': '홈런',
          '타점': '타점', '도루': '도루', '도루실패': '도루실패', '볼넷': '볼넷', '삼진': '삼진', '병살타': '병살타'}
HH_PIT = {'경기': '경기', '아웃(이닝×3)': '이닝', '승': '승', '패': '패', '세이브': '세', '홀드': '홀드', '탈삼진': '탈삼진', '볼넷': '볼넷',
          '피홈런': '피홈런', '실점': '실점', '자책점': '자책점'}
# 위키 항목 이름 → KBO 공식 투수 수비 기록 열
KBO_PIT_COLS = {'경기': 'G', '선발': 'GS', '아웃(이닝×3)': '이닝'}


def outs_hh(v):
    """하드힛 이닝 '178.2' → 536"""
    x = H.num(v)
    if x is None:
        return None
    whole = int(x)
    return whole * 3 + round((x - whole) * 10)


def hardhit_table():
    """(선수ID, 연도, 'bat'|'pit') → [(계보, {위키 항목: 값})]"""
    if not H.RAW.exists() and MAIN_HARDHIT.exists():
        H.RAW = MAIN_HARDHIT
    M = H.Matcher()
    out = defaultdict(list)
    for kind, side, cols in (('batter', 'bat', HH_BAT), ('pitcher', 'pit', HH_PIT)):
        for y, _, p in H.files(kind, 'classic'):
            if y not in M.seasons:
                continue
            for r in H.read_file(p)[1]:
                stats = ({'pa': H.num(r['타석']), 'h': H.num(r['안타'])} if side == 'bat'
                         else {'g': H.num(r['경기']), 'outs': outs_hh(r['이닝'])})
                pid, _ = M.match(y, r['이름'], r['팀'], H.num(r['나이']), side, stats)
                if not pid:
                    continue
                vals = {}
                for label, col in cols.items():
                    v = outs_hh(r[col]) if col == '이닝' else H.num(r[col])
                    if v is not None:
                        vals[label] = int(v)
                out[(pid, y, side)].append((M.franchise(r['팀'], y), vals))
    return out


def kbo_pitch_table():
    """(선수ID, 연도) → [(계보, {위키 항목: 값})]  KBO 공식 투수 수비 기록 (경기·선발·이닝)"""
    out = defaultdict(list)
    if not KBO_PIT.exists():
        return out
    for r in C.read_csv(KBO_PIT):
        frs = C.franchises_of(r['구단']) or []
        vals = {}
        for label, col in KBO_PIT_COLS.items():
            v = r.get(col)
            if v in (None, ''):
                continue
            vals[label] = round(float(v) * 3) if col == '이닝' else int(float(v))
        out[(r['선수ID'], int(r['연도']))].append((frs[0] if len(frs) == 1 else None, vals))
    return out


def pick(rows, frs, label):
    """출처 행들에서 그 칸(계보 묶음의 합) 값. 계보가 다 있어야 한다"""
    got = [v for fr, v in rows if fr in frs and label in v]
    if not got or len({fr for fr, v in rows if fr in frs and label in v}) != len(frs):
        return None
    return sum(v[label] for v in got)


def main():
    C.stdout_utf8()
    cells = [x for x in D.classify(C.read_csv(C.OUT_DIR / '기록_차이.csv')) if x['src'] == 'same']
    C.log(f'[209칸] {len(cells)}칸 · 하드힛 원본 읽는 중…')
    hh = hardhit_table()
    kbo = kbo_pitch_table()
    rows, fixes = [], []
    for x in cells:
        y, kind = int(x['연도']), x['kind']
        frs = (x.get('계보') or '').split('+') if x.get('계보') else [C.franchises_of(x['구단'])[0]]
        label = x['항목']
        ours, wiki = int(float(x['우리 값'])), int(float(x['위키 값']))
        hv = pick(hh.get((x['선수ID'], y, kind), []), frs, label) if label in (HH_PIT if kind == 'pit' else HH_BAT) else None
        kv = pick(kbo.get((x['선수ID'], y), []), frs, label) if kind == 'pit' and label in KBO_PIT_COLS else None
        top = [v for v in (hv, kv) if v is not None]
        to_wiki = sum(1 for v in top if v == wiki)
        to_ours = sum(1 for v in top if v == ours) + 1
        if to_wiki >= 2:
            result = '위키 값으로 고침'
            fixes.append([x['선수ID'], x['이름'], y, '+'.join(frs), x['구분'], label, ours, wiki,
                          f"하드힛 {hv} · KBO 공식 {kv} = 위키 {wiki}"])
        elif not top:
            result = '저장소 유지 (맨 윗자리 자료 없음)'
        elif to_ours > to_wiki and to_wiki == 0:
            result = '저장소 유지 (맨 윗자리가 저장소와 같음)' if to_ours > 1 else '저장소 유지 (맨 윗자리 셋이 모두 다름)'
        else:
            result = '갈림: 저장소 유지 (맨 윗자리 하나만 위키와 같음)'
        rows.append({**x, 'hh': hv, 'kbo': kv, 'result': result, 'frs': '+'.join(frs)})

    C.write_csv(OUT_CSV, ['선수ID', '이름', '연도', '계보', '구분', '항목', '저장소 값', '고칠 값', '근거'], fixes)
    cnt = Counter(r['result'] for r in rows)
    L = ['# 위키 209칸 처리 결과', '',
         '`python tools/wiki/resolve_209.py`가 만든다. 위키백과·나무위키가 같은 값으로 저장소 값과 다른 칸 '
         f'(`reports/wiki-diff-209.md`) **{len(rows)}칸**을 신뢰 순서로 가렸다 (2026-10-23 사용자 결정).',
         '신뢰 순서: 하드힛 = KBO 공식 자료 = 저장소 > 위키백과 > 나무위키. 맨 윗자리 셋 중 둘 이상이 위키 값과 같을 때만 고친다 '
         '(저장소는 위키와 다르므로 하드힛과 KBO 공식이 둘 다 위키와 같아야 한다). 고친 칸은 `data-src/wiki/기록_고침.csv` → `tools/build_data.py`.',
         '하드힛: 원본 classic 표(타자 2003~ 상위 200명, 투수 1982~). KBO 공식: 사용자 수집 수비 기록의 투수 경기·선발·이닝(2001~). '
         '타자 경기는 수비 경기와 뜻이 달라 KBO 공식으로 견주지 않는다.', '',
         '| 결과 | 칸 |', '|---|---:|']
    for k, v in cnt.most_common():
        L.append(f'| {k} | {v} |')
    L += ['', '| 선수 | 연도 | 구단 | 항목 | 저장소 | 하드힛 | KBO 공식 | 위키(두 곳) | 결과 |', '|---|---|---|---|---:|---:|---:|---:|---|']
    order = {k: i for i, k in enumerate(['위키 값으로 고침', '갈림: 저장소 유지 (맨 윗자리 하나만 위키와 같음)',
                                         '저장소 유지 (맨 윗자리 셋이 모두 다름)', '저장소 유지 (맨 윗자리가 저장소와 같음)',
                                         '저장소 유지 (맨 윗자리 자료 없음)'])}
    for r in sorted(rows, key=lambda r: (order.get(r['result'], 9), r['선수ID'], int(r['연도']), r['항목'])):
        sh = lambda v: '' if v is None else str(v)  # noqa: E731
        L.append(f"| {r['이름']} ({r['선수ID']}) | {r['연도']} | {r['구단']} | {r['구분']} {r['항목']} | {r['우리 값']} | {sh(r['hh'])} "
                 f"| {sh(r['kbo'])} | {r['위키 값']} | {r['result']} |")
    OUT_MD.write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
    C.log(f'[209칸 끝] {dict(cnt)} → {OUT_CSV}, {OUT_MD}')


if __name__ == '__main__':
    main()
