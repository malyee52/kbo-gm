# -*- coding: utf-8 -*-
"""7단계: 나무위키 구단 문서 정보 상자에서 구단 계보 날짜(창단·해체·구단명 변천·연고지)를 뽑아
시즌 자료(public/data/seasons)의 구단 이름·계보(franchise)와 견준다 (2026-10-23, 빈 자료 결정 4)

  python tools/wiki/s7_lineage.py

쓰는 것: data-src/구단_계보.csv (한 행 = 구단 문서 × 구단명 기간), reports/wiki-lineage.md (시즌 자료와 다른 곳)
견주는 법: 해마다 시즌 자료의 (짧은 구단 이름, 계보) 목록과, 위키 구단명 변천에서 그 해에 쓰인 이름의 첫 낱말
('OB 베어스' → 'OB', '우리 히어로즈' → '우리')을 견준다. 시즌 중에 이름이 바뀐 해(1985 삼미 → 청보)는
위키에 두 이름이 같이 나오므로 어느 하나와 같으면 같다고 본다.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import namumd as N  # noqa: E402
import s3_namu as S  # noqa: E402

TEAM_DOCS = ['LG 트윈스', '두산 베어스', '삼성 라이온즈', 'KIA 타이거즈', '롯데 자이언츠', '한화 이글스', 'SSG 랜더스',
             '키움 히어로즈', 'NC 다이노스', 'kt wiz', '현대 유니콘스', '쌍방울 레이더스']
HEAD = ['문서', '계보', '항목', '값', '시작', '끝', '출처']
# 위키 첫 낱말 ↔ 시즌 자료 짧은 이름이 표기만 다른 것
SAME_NAME = {'kt': 'KT', '서울': '히어로즈'}


def periods(text):
    """'MBC 청룡 (1982~1989)\\nLG 트윈스 (1990~)' → [(이름, 시작, 끝)] (끝 None = 지금까지)"""
    out = []
    for line in (text or '').split('\n'):
        line = re.sub(r'\[\^?[^\]]*\]', '', line).strip()
        m = re.match(r'(.*?)\s*\((\d{4})(?:[^~)]*)~\s*(\d{4})?[^)]*\)', line)
        if m:
            out.append((m.group(1).strip(), int(m.group(2)), int(m.group(3)) if m.group(3) else None))
    return out


def infobox(md):
    for tb in N.tables(md):
        labs = [r[0] for r in tb if len(r) >= 2]
        if '창단' in labs:
            out = {}
            for r in tb:
                if len(r) >= 2 and r[0] != r[-1]:
                    out.setdefault(r[0], []).append(r[-1])
            return out
    return {}


def main():
    C.stdout_utf8()
    db = S.open_db(S.DUMP)
    rows, names = [], {}  # names: 계보 → [(이름, 시작, 끝)]
    for doc in TEAM_DOCS:
        md = S.get_md(db, doc)
        box = infobox(md)
        fr = C.franchise_of(doc) or C.franchise_of(re.sub('kt', 'KT', doc))
        src = f"나무위키: {doc} (덤프 {S.DUMP_DATE}, 고침 {N.front(md).get('last_modified', '')[:10]})"
        for k in ('창단', '해체'):
            for v in box.get(k, []):
                m = re.match(r'(\d{4})년 (\d{1,2})월 (\d{1,2})일', v)
                if m:
                    rows.append([doc, fr, k, f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}', m.group(1), '', src])
        for k, item in (('구단명 변천', '구단명'), ('연고지', '연고지'), ('연고지 변천', '연고지')):
            for v in box.get(k, []):
                for name, a, b in periods(v):
                    rows.append([doc, fr, item, name, a, b or '', src])
                    if item == '구단명':
                        names.setdefault(fr, []).append((name, a, b))
        if fr not in names:
            # 이름이 한 번도 안 바뀐 구단(롯데·삼성·쌍방울)은 '구단명 변천' 칸이 없다 → 문서 제목을 창단 해부터 해체 해까지
            a = next((int(r[4]) for r in rows if r[0] == doc and r[2] == '창단'), None)
            b = next((int(r[4]) for r in rows if r[0] == doc and r[2] == '해체'), None)
            if a:
                rows.append([doc, fr, '구단명', doc, a, b or '', src + ' (구단명 변천 칸 없음, 문서 제목)'])
                names[fr] = [(doc, a, b)]
    C.write_csv(C.ROOT / 'data-src' / '구단_계보.csv', HEAD, rows)

    seasons = C.load_seasons()
    diffs = []
    for y in sorted(int(k) for k in seasons):
        s = seasons[str(y)] if str(y) in seasons else seasons[y]
        ours = {t['franchise']: t['name'] for t in s['teams']}
        wiki = {}
        for fr, ps in names.items():
            for name, a, b in ps:
                if a <= y <= (b or 9999):
                    w = name.split()[0]
                    wiki.setdefault(fr, set()).add(SAME_NAME.get(w, w))
        for fr in sorted(set(ours) | set(wiki)):
            o, w = ours.get(fr), wiki.get(fr, set())
            if o is None:
                diffs.append([y, fr, '(시즌 자료에 없음)', ' · '.join(sorted(w)), '위키에는 그 해 구단명이 있음'])
            elif not w:
                diffs.append([y, fr, o, '(위키 구단명 없음)', '위키 구단명 변천에 그 해가 없음'])
            elif o not in w and not any(C.franchise_of(x) == fr and x.upper().startswith(o.upper()) for x in w):
                diffs.append([y, fr, o, ' · '.join(sorted(w)), '이름이 다름'])
    L = ['# 구단 계보 날짜: 위키와 시즌 자료 견줌', '',
         '`python tools/wiki/s7_lineage.py`가 만든다. 나무위키 구단 문서 정보 상자(창단·해체·구단명 변천·연고지) → `data-src/구단_계보.csv` '
         f'({len(rows)}줄, 구단 문서 {len(TEAM_DOCS)}개). 아래는 해마다 시즌 자료의 구단 이름(계보별)과 위키 구단명이 다른 곳이다.', '',
         f'다른 곳 {len(diffs)}개.', '', '| 해 | 계보 | 시즌 자료 이름 | 위키 이름 | 까닭 |', '|---:|---|---|---|---|']
    L += [f'| {" | ".join(str(x) for x in r)} |' for r in diffs]
    (C.ROOT / 'reports' / 'wiki-lineage.md').write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
    C.log(f'[7단계 끝] 구단 계보 {len(rows)}줄 · 시즌 자료와 다른 곳 {len(diffs)}개')


if __name__ == '__main__':
    main()
