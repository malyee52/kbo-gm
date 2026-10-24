# -*- coding: utf-8 -*-
"""6단계: 나무위키 덤프에서 수상·올스타전 표를 뽑아 선수 ID와 짝짓는다 (2026-10-23, 빈 자료 결정 4)

  python tools/wiki/s6_awards.py

읽는 문서 (덤프 namu-md.sqlite, 읽기 전용):
  수상: 'KBO 골든글러브 역대 수상자/투수·포수·내야수·외야수·지명타자', 'KBO MVP', 'KBO 리그 신인왕 역대 수상자',
        'KBO 한국시리즈/역대 기록' (한국시리즈 MVP), 'KBO 올스타전' (미스터 올스타)
  올스타전 경기: 'KBO 올스타전'의 역대 경기 표 (해·날짜·구장·결과)
짝짓기 (위에서부터 처음 맞는 것):
  1. 수상자 칸 링크의 나무위키 문서 제목 = data-src/wiki/짝.csv의 '나무위키 제목' (선수 문서 짝)
  2. 이름 + 그 해 + 계보로 시즌 기록(public/data/seasons)에 행이 있는 선수가 하나뿐
  3. 이름 + 그 해에 1군 기록이 있는 선수가 하나뿐 (외국인은 위키 이름의 낱말 하나가 우리 이름과 같아도 된다)
  못 짝지은 것은 선수ID를 비우고 reports/wiki-awards.md 목록에 남긴다.
쓰는 것: data-src/수상.csv, data-src/올스타.csv, reports/wiki-awards.md (원문은 저장소에 올리지 않는다)
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import namumd as N  # noqa: E402
import s3_namu as S  # noqa: E402

FIRST_YEAR, LAST_YEAR = 1982, 2025
GG_DOCS = [('투수', 'P'), ('포수', 'C'), ('내야수', None), ('외야수', 'OF'), ('지명타자', 'DH')]
GG_INFIELD = {'1루수': '1B', '2루수': '2B', '3루수': '3B', '유격수': 'SS'}
AWARD_HEAD = ['상', '연도', '부문', '이름', '선수ID', '구단', '계보', '짝 근거', '출처', '확인']
ALLSTAR_HEAD = ['연도', '경기', '날짜', '구장', '구장ID', '팀1', '점수1', '점수2', '팀2', '승리', '출처', '확인']
# 올스타전 구장 문서 제목 → data-src/구장.csv의 구장ID (구장 표에 없는 제2구장은 비운다)
PARK_IDS = {
    '서울종합운동장 야구장': 'jamsil', '동대문야구장': 'dongdaemun', '사직 야구장': 'sajik', '구덕 야구장': 'gudeok',
    '무등 야구장': 'mudeung', '광주-기아 챔피언스 필드': 'champions', '대구시민운동장 야구장': 'daegu_civic',
    '대구 삼성 라이온즈 파크': 'lionspark', '한밭 야구장': 'hanbat', '대전 한화생명 이글스파크': 'hanbat',
    '한화생명 이글스파크': 'hanbat', '대전 한화생명 볼파크': 'ballpark', '숭의야구장': 'sungui',
    '인천 SSG 랜더스필드': 'munhak', '인천 문학 야구장': 'munhak', '수원 케이티 위즈 파크': 'suwon', '목동 야구장': 'mokdong',
    '고척 스카이돔': 'gocheok', '마산 야구장': 'masan', '창원NC파크': 'changwon', '전주종합경기장 야구장': 'jeonju',
}


def clean(text):
    """칸 글 → 이름·값 (각주·줄바꿈 뒤 덧말 '/(만장일치)' 떼기)"""
    t = re.sub(r'\[\^?[^\]]*\]', '', text or '')
    return t.split('\n')[0].split('/')[0].strip()


def year_of(text):
    m = re.match(r'\s*(\d{4})', text or '')
    return int(m.group(1)) if m else None


def find_table(tbs, head):
    """머리 행이 head로 시작하는 첫 표 (칸 글만 견준다)"""
    for i, tb in enumerate(tbs):
        if tb and [re.sub(r'\s', '', c[0]) for c in tb[0][:len(head)]] == head:
            return i, tb
    return None, None


class Matcher:
    def __init__(self):
        players = C.load_players()
        self.name = {p['id']: p['name'] for p in players}
        self.foreign = {p['id'] for p in players if p.get('foreign')}
        self.by_namu = {}
        for r in C.read_csv(C.OUT_DIR / '짝.csv'):
            if r.get('나무위키 제목'):
                self.by_namu[r['나무위키 제목']] = r['선수ID']
        self.rows = defaultdict(set)  # (연도, 선수ID) → 계보들
        for y, s in C.load_seasons().items():
            fr = {t['name']: t['franchise'] for t in s['teams']}
            for kind in ('bat', 'pit'):
                for r in s[kind]:
                    self.rows[(int(y), r[0])].add(fr.get(r[1], r[1]))
        self.year_ids = defaultdict(set)
        for (y, pid) in self.rows:
            self.year_ids[y].add(pid)

    def names_fit(self, pid, name):
        ours = self.name[pid]
        if ours.replace(' ', '') == name.replace(' ', ''):
            return True
        # 외국인: 위키 '멜 로하스 주니어' ↔ 우리 '로하스', '앤디 밴 헤켄' ↔ '밴헤켄'
        return pid in self.foreign and (ours in name.split() or name.replace(' ', '').endswith(ours.replace(' ', '')))

    def match(self, name, links, year, franchise):
        """→ (선수ID, 근거). 못 찾으면 ('', 까닭)"""
        for t in links:
            pid = self.by_namu.get(t)
            if pid and (year, pid) in self.rows:
                return pid, '문서 짝'
        cands = [pid for pid in self.year_ids.get(year, ()) if self.names_fit(pid, name)]
        if franchise:
            hit = [pid for pid in cands if franchise in self.rows[(year, pid)]]
            if len(hit) == 1:
                return hit[0], '이름·해·계보'
            if len(hit) > 1:
                return '', f'동명이인 {len(hit)}명 (같은 해·계보)'
        if len(cands) == 1:
            return cands[0], '이름·해'
        return '', '후보 없음' if not cands else f'동명이인 {len(cands)}명'


def team_of(cell):
    """구단 칸 (글, 링크) → (구단 이름, 계보)"""
    text, links = cell
    for t in links:
        fr = C.franchise_of(t)
        if fr:
            return t, fr
    t = clean(text)
    return t, C.franchise_of(t)


def source(title, md):
    return f"나무위키: {title} (덤프 {S.DUMP_DATE}, 고침 {N.front(md).get('last_modified', '')[:10]})"


def award_rows(db, M, out, miss):
    def add(award, year, part, name_cell, team_cell, title, md):
        if year is None or not FIRST_YEAR <= year <= LAST_YEAR:
            return
        name = clean(name_cell[0])
        if not name or name in ('-', '없음', '수상자 없음'):
            return
        team, fr = team_of(team_cell)
        prev = next((r for r in out if r[0] == award and r[1] == year and r[3] == name and (award != '골든글러브' or r[2] == part)), None)
        if prev:  # 같은 수상이 두 줄 (1985 MVP 김성한 '1루수'·'투수'): 부문을 합친다
            if part and part not in prev[2].split('·'):
                prev[2] = f'{prev[2]}·{part}' if prev[2] else part
            return
        pid, why = M.match(name, [t for t in name_cell[1] if not t.startswith(('한국프로야구', 'KBO'))], year, fr)
        out.append([award, year, part, name, pid, team, fr or '', why if pid else '', source(title, md), '출처 확인'])
        if not pid:
            miss.append([award, year, part, name, team, why])

    for doc, code in GG_DOCS:
        title = f'KBO 골든글러브 역대 수상자/{doc}'
        md = S.get_md(db, title)
        tbs = N.tables(md, links=True)
        part = code
        for tb in tbs:
            head = ' '.join(c[0] for c in tb[0]) if tb else ''
            m = re.search(r'(1루수|2루수|3루수|유격수) 부문', head)
            if m:
                part = GG_INFIELD[m.group(1)]
                continue
            if not tb or [re.sub(r'\s', '', c[0]) for c in tb[0][:3]] != ['연도', '이름', '소속팀']:
                continue
            for r in tb[1:]:
                add('골든글러브', year_of(r[0][0]), part, r[1], r[2], title, md)
    for award, title in (('MVP', 'KBO MVP'), ('신인왕', 'KBO 리그 신인왕 역대 수상자')):
        md = S.get_md(db, title)
        _, tb = find_table(N.tables(md, links=True), ['연도', '이름', '포지션', '소속팀'])
        for r in tb[1:]:
            add(award, year_of(r[0][0]), clean(r[2][0]), r[1], r[3], title, md)
    title = 'KBO 한국시리즈/역대 기록'
    md = S.get_md(db, title)
    _, tb = find_table(N.tables(md, links=True), ['연도', '우승팀', 'MVP'])
    for r in tb[1:]:
        part = re.search(r'\(([^)]*)\)', r[2][0])
        add('한국시리즈 MVP', year_of(r[0][0]), part.group(1) if part else '', r[2], r[1], title, md)
    title = 'KBO 올스타전'
    md = S.get_md(db, title)
    _, tb = find_table(N.tables(md, links=True), ['년도', '선수명', '당시소속팀'])
    for r in tb[1:]:
        add('올스타전 MVP', year_of(r[0][0]), '', r[1], r[2], title, md)


def allstar_rows(db):
    title = 'KBO 올스타전'
    md = S.get_md(db, title)
    _, tb = find_table(N.tables(md, links=True), ['연도', '날짜', '경기장', '시구', '결과'])
    out, nth = [], Counter()
    for r in tb[1:]:
        y = year_of(r[0][0])
        if y is None or not FIRST_YEAR <= y <= LAST_YEAR:
            continue
        t1, s1, s2, t2 = (clean(c[0]) for c in r[4:8])
        if not (s1.isdigit() and s2.isdigit()) or '~' in r[1][0]:
            continue  # 우천 취소, 2020년 온라인 투표 대회('9월 8일 ~ 27일') 등
        nth[y] += 1
        park = next((t for t in r[2][1]), clean(r[2][0]))
        win = t1 if int(s1) > int(s2) else t2 if int(s2) > int(s1) else '무승부'
        out.append([y, nth[y], clean(r[1][0]), park, PARK_IDS.get(park, ''), t1, int(s1), int(s2), t2, win,
                    source(title, md), '출처 확인'])
    return out


def main():
    C.stdout_utf8()
    db = S.open_db(S.DUMP)
    M = Matcher()
    awards, miss = [], []
    award_rows(db, M, awards, miss)
    games = allstar_rows(db)
    C.write_csv(C.ROOT / 'data-src' / '수상.csv', AWARD_HEAD, awards)
    C.write_csv(C.ROOT / 'data-src' / '올스타.csv', ALLSTAR_HEAD, games)
    by = Counter(r[0] for r in awards)
    ok = Counter(r[0] for r in awards if r[4])
    why = Counter(r[7] for r in awards if r[4])
    L = ['# 위키 수상·올스타전 짝짓기 결과', '',
         '`python tools/wiki/s6_awards.py`가 만든다. 나무위키 덤프(' + S.DUMP_DATE + ') 표 → `data-src/수상.csv`·`data-src/올스타.csv`. '
         '수상은 위키 확인(빈 자료 결정 2: 위키 확인 = 출처 확인)이고 KBO 공식 자료와는 대조하지 않았다.', '',
         '| 상 | 줄 | 선수 ID 짝 | 비율 |', '|---|---:|---:|---:|']
    for k in by:
        L.append(f'| {k} | {by[k]} | {ok[k]} | {ok[k] / by[k]:.1%} |')
    L += ['', f'짝 근거: {", ".join(f"{k} {v}" for k, v in why.most_common())}', '',
          f'올스타전 경기 {len(games)}줄 ({len({g[0] for g in games})}개 해).', '',
          '## 못 짝지은 수상', '', '| 상 | 연도 | 부문 | 이름 | 구단 | 까닭 |', '|---|---:|---|---|---|---|']
    L += [f'| {" | ".join(str(x) for x in r)} |' for r in miss]
    (C.ROOT / 'reports' / 'wiki-awards.md').write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
    C.log(f'[6단계 끝] 수상 {len(awards)}줄 (짝 {sum(ok.values())}, 못 짝 {len(miss)}) · 올스타전 {len(games)}경기')


if __name__ == '__main__':
    main()
