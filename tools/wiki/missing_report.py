# -*- coding: utf-8 -*-
"""빠진 KBO 행 목록: data-src/wiki/기록_빠진행.csv·기록_뺀행.csv → reports/wiki-missing-rows.md (사용자에게 보이는 표)

  python tools/wiki/missing_report.py [--before <옛 기록_채움후보.csv>]

하네스 고침(2026-10-23, 위키 차이 질문 4) 뒤 우리 자료에 행이 없는 위키 표 행을 분류별로 보인다.
신뢰 순서(하드힛 = KBO 공식 = 저장소 > 위키백과 > 나무위키, 2026-10-23 사용자 결정 '위키 209칸 처리')에 따라
행마다 맨 윗자리 자료(하드힛 원본 classic 표, KBO 공식 수비 기록 2001~)에 그 선수·해 기록이 있는지 붙인다.
맨 윗자리 자료가 없으면(또는 없다고 하면) 저장소(행 없음)를 따른다. 행을 더하면 저장 지문이 바뀌므로 여기서는 더하지 않는다.
--before: 고치기 전 기록_채움후보.csv의 '(행 없음)' 칸이 지금 어디로 갔는지 센다.
"""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import resolve_209 as R  # noqa: E402

OUT = C.ROOT / 'reports' / 'wiki-missing-rows.md'
KBO_FIELD = C.RAW_NOTE / '수비이닝' / '수비이닝_야수.csv'
ORDER = ['정말 빠짐: 두 위키 모두', '정말 빠짐: 한 위키만 (다른 위키 표 없음)', '정말 빠짐: 이적 전·후 구단 행',
         '의심: 다른 위키 표에는 그 해가 없음', '의심: 그 해 구단·값이 모두 다름', '의심: 그 해에 없던 구단 이름',
         '투타 다름 (우리는 그 해 다른 쪽 기록만)', '동명이인 의심 표 (견주지 않음)', '구단 표기·나눔만 다름 (그 해 합이 같음)']
NOTE = {
    '정말 빠짐: 두 위키 모두': '두 위키 표에 다 있고 우리 자료에는 그 해 기록이 없다.',
    '정말 빠짐: 한 위키만 (다른 위키 표 없음)': '한 위키에만 있다 (다른 위키에는 그 선수 기록 표가 없음).',
    '정말 빠짐: 이적 전·후 구단 행': '그 해 우리 행은 다른 구단에만 있고, 위키의 그 해 합에서 이 줄을 빼면 우리 행과 같다.',
    '의심: 다른 위키 표에는 그 해가 없음': '한 위키에만 있고 다른 위키 표에는 그 해가 없다 (해 밀림·2군 기록일 수 있음).',
    '의심: 그 해 구단·값이 모두 다름': '그 해 우리 행이 있는데 구단도 값도 맞지 않는다.',
    '의심: 그 해에 없던 구단 이름': '구단 이름이 그 해에 쓰이지 않았다 (예: 2012 해태).',
    '투타 다름 (우리는 그 해 다른 쪽 기록만)': '우리는 그 해 타자(또는 투수) 기록만 있다. 위키 표 종류 판별이 틀렸거나 투수의 타격 기록이다.',
    '동명이인 의심 표 (견주지 않음)': '표 전체가 우리 1군 해와 절반도 겹치지 않아 다른 사람 표로 보고 견주지 않았다.',
    '구단 표기·나눔만 다름 (그 해 합이 같음)': '빠진 행이 아니다: 우리가 이적한 해를 한 구단 행에 합쳐 두었거나 구단 표기가 달라도 그 해 합이 같다 (칸 값은 그 해 합끼리 견줌).',
}


def kbo_field_years():
    out = set()
    if KBO_FIELD.exists():
        for r in C.read_csv(KBO_FIELD):
            out.add((r['선수ID'], int(r['연도'])))
    return out


def main():
    C.stdout_utf8()
    rows = C.read_csv(C.OUT_DIR / '기록_빠진행.csv')
    dropped = C.read_csv(C.OUT_DIR / '기록_뺀행.csv')
    hh = R.hardhit_table()
    kp = R.kbo_pitch_table()
    kf = kbo_field_years()

    def top(r):
        y, kind = int(r['연도']), 'pit' if r['구분'] == '투수' else 'bat'
        got = []
        if hh.get((r['선수ID'], y, kind)):
            got.append('하드힛 있음')
        if y >= 2001 and ((r['선수ID'], y) in kp or (r['선수ID'], y) in kf):
            got.append('KBO 공식 있음')
        if not got:
            got.append('없음' if y < 2001 else '하드힛·KBO 공식 모두 없음')
        return ', '.join(got)

    cnt = Counter(r['분류'] for r in rows)
    cells = Counter()
    for r in rows:
        cells[r['분류']] += int(r['칸'] or 0)
    L = ['# 위키에만 있는 KBO 시즌 행 (하네스 고친 뒤)', '',
         '`python tools/wiki/missing_report.py`가 만든다. 원자료 `data-src/wiki/기록_빠진행.csv`·`기록_뺀행.csv` (`tools/wiki/s5_merge.py`).',
         '2026-10-23 사용자 결정(위키 차이 질문 4): 행은 더하지 않고 하네스를 고친 뒤 정말 빠진 KBO 행만 다시 뽑는다. '
         '고친 것: 해외 리그(요미우리·지바 롯데·MLB·마이너 …)와 KBO 출범 전 행 빼기, 시즌 중 이적 합산 줄(\'롯데/kt\')은 우리 구단별 행의 합과 견주기, '
         '구단 이름은 낱말로 읽기(전에는 \'요미우리\'의 \'우리\'를 히어로즈로 읽었다), 동명이인 표 걸러 내기, 출장 0 줄 빼기.',
         '신뢰 순서: 하드힛 = KBO 공식 = 저장소 > 위키백과 > 나무위키. **맨 윗자리 근거 열**이 그 선수·해의 하드힛·KBO 공식 기록 유무다 '
         '(하드힛 타자 표는 2003~ 상위 200명뿐, KBO 공식은 수비 기록 2001~). 행을 더하면 저장 지문이 바뀌어 더하지 않았다.', '']
    if '--before' in sys.argv:
        old = [r for r in C.read_csv(Path(sys.argv[sys.argv.index('--before') + 1])) if r['우리 값'] == '(행 없음)']
        fate = Counter()
        now = {(r['선수ID'], r['연도'], r['구분']): r['분류'] for r in rows}
        for r in old:
            frs = C.franchises_of(r['구단'])
            if frs is None or not frs:
                fate['해외·기타 구단 줄 (뺌)'] += 1
            elif int(r['연도']) < 1982:
                fate['KBO 출범 전 (뺌)'] += 1
            else:
                fate[now.get((r['선수ID'], r['연도'], r['구분']), '해외 리그 표·출장 0 줄·합산 줄로 견줌 (빠진 행 아님)')] += 1
        L += [f'## 고치기 전 \'(행 없음)\' {len(old):,}칸이 간 곳', '', '| 지금 | 칸 |', '|---|---:|']
        for k, v in fate.most_common():
            L.append(f'| {k} | {v:,} |')
        L.append('')
    L += ['## 견주지 않고 뺀 위키 표 행', '', '| 까닭 | 행 |', '|---|---:|']
    for r in dropped:
        L.append(f"| {r['까닭']} | {int(r['행 수']):,} |")
    L += ['', '## 분류', '', '| 분류 | 행 | 칸 | 뜻 |', '|---|---:|---:|---|']
    for k in ORDER:
        if cnt.get(k):
            L.append(f'| {k} | {cnt[k]} | {cells[k]:,} | {NOTE[k]} |')
    for k in ORDER[:-1]:
        xs = [r for r in rows if r['분류'] == k]
        if not xs:
            continue
        L += ['', f'### {k} ({len(xs)}행)', '', '| 선수 | 연도 | 위키 구단 | 구분 | 출처 | 위키 기록 | 우리 그 해 | 맨 윗자리 근거 |',
              '|---|---|---|---|---|---|---|---|']
        for r in sorted(xs, key=lambda r: (int(r['연도']), r['선수ID'])):
            L.append(f"| {r['이름']} ({r['선수ID']}) | {r['연도']} | {r['구단']} | {r['구분']} | {r['출처']} | {r['위키 기록']} "
                     f"| {r['우리 그 해'] or '없음'} | {top(r)} |")
    L.append('')
    OUT.write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
    C.log(f'[빠진 행 목록 끝] {dict(cnt)} → {OUT}')


if __name__ == '__main__':
    main()
