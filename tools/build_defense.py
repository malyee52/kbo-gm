#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""수비 원본(저장소 밖) → data-src/수비이닝.csv · 수비평판.csv (가공값만, 능력치 v2 16-3a, 2026-10-23).

원본 (저장소에 올리지 않는다, 결정 "수비·구종 자료"):
  C:/Users/ararp/kbo-gm-raw/수비구종/수비.csv       KBO 공식 사이트 수비 기록 2001~2026 (사용자 수집)
  C:/Users/ararp/kbo-gm-raw/수비구종/수비_2004.csv  2004년 보완 540행 (수비.csv의 2004년 30행을 대신한다)
  C:/Users/ararp/kbo-gm-raw/정리/수비평판.csv       나무위키·위키백과 서술에서 뽑은 수비 평판 (조사 직원)
정리 규칙은 조사 직원 정리본(kbo-gm-raw/정리/수비이닝/스크립트/step2_refine_matcher.py)을 따른다:
  IP 칸이 엑셀 날짜로 바뀐 값 복원 ('01월 03일' = 1/3, '02월 03일' = 2/3, 181건), 투수 행 제외,
  선수 ID 짝 = 이름 → 그 해 시즌 기록·소속 계보 → 생년 → 같은 구단 기록 대조 (동명이인).
  (2001 데이비스 수비율 'qqq…' 고침은 수비율을 쓰지 않아 필요 없다.)

쓰는 법: python tools/build_defense.py [원본 폴더]   (그다음 python tools/build_data.py --defense-only)
  정리본(kbo-gm-raw/정리/수비이닝/수비이닝_야수.csv)이 있으면 행 수와 선수 ID를 대조해 다르면 멈춘다.
평판 CSV에는 근거 문장을 넣지 않는다 (실존 선수 서술 문장, 라이선스). 등급·시기·출처 문서 제목만 넣는다.
평판의 시기 글은 적힌 연도만 연도 범위로 바꾼다 ('데뷔 초'·'20대'·'고교 시절' 같은 말은 버리고, 연도가 없으면 통산으로 본다).
시기 글이 '고교 시절'뿐인 평판 줄은 버린다 (프로 수비 근거가 아님, 2026-10-23 클사장 결정).
어깨 (능력치 v2 12.6·결정 28, 16-3b 자료 단계): 근거 요약의 어깨 낱말을 ARM_GOOD·ARM_BAD로 갈라 '어깨' 열(1 좋음, -1 나쁨, 0 없음·둘 다)에 담는다.
  낱말은 어깨 힘만 본다 ('송구 불안' 같은 정확도, '어깨 부상'은 넣지 않는다). 시기는 그 평판 줄의 시기를 따른다. 낱말 목록은 임시값.
"""
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'public' / 'data'
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
RAW = Path(ARGS[0]) if ARGS else Path('C:/Users/ararp/kbo-gm-raw')
RAW_DEF = RAW / '수비구종' / '수비.csv'
RAW_2004 = RAW / '수비구종' / '수비_2004.csv'
RAW_REP = RAW / '정리' / '수비평판.csv'
CHECK_DEF = RAW / '정리' / '수비이닝' / '수비이닝_야수.csv'
OUT_DEF = ROOT / 'data-src' / '수비이닝.csv'
OUT_REP = ROOT / 'data-src' / '수비평판.csv'

DEF_SOURCE = 'KBO 공식 사이트 수비 기록 (사용자 수집)'
POS_KR = {'포수': 'C', '1루수': '1B', '2루수': '2B', '3루수': '3B', '유격수': 'SS', '좌익수': 'LF', '중견수': 'CF', '우익수': 'RF'}
# 어깨 낱말 (임시값). 문장은 저장소에 넣지 않고 갈린 값만 넣는다
ARM_GOOD = re.compile(r'강견|어깨가 (매우 |아주 |굉장히 )?(강|좋)|강한 어깨|좋은 어깨|강한 송구|송구(력|가) (매우 |아주 )?(강|좋|뛰어)|레이저|대포알')
ARM_BAD = re.compile(r'약견|어깨가 (매우 |많이 )?(약|좋지 않|나쁘)|약한 어깨|송구력이 (매우 |많이 )?(약|좋지 않|나쁘)')
REP_POS = ('C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'IF', 'OF', '전반')
REP_LEVEL = {'매우 좋음': 2, '좋음': 1, '보통': 0, '나쁨': -1, '매우 나쁨': -2}


def parse_ip(s):
    """'1149 1/3' → 아웃 수 (이닝 × 3, 정수). 엑셀이 날짜로 바꾼 '01월 03일'·'02월 03일'은 1/3·2/3"""
    s = s.strip()
    if not s or s == '-':
        return 0
    if s == '01월 03일':
        return 1
    if s == '02월 03일':
        return 2
    if ' ' in s:
        whole, frac = s.split(' ')
    elif '/' in s:
        whole, frac = '0', s
    else:
        whole, frac = s, ''
    outs = int(whole) * 3
    if frac:
        a, b = frac.split('/')
        outs += round(int(a) * 3 / int(b))
    return outs


def num(v):
    v = (v or '').strip()
    return int(v) if v.isdigit() else 0


def load_game_data():
    players = {p['id']: p for p in json.loads((DATA / 'players.json').read_text(encoding='utf-8'))['players']}
    meta = json.loads((DATA / 'meta.json').read_text(encoding='utf-8'))
    franchise_of = {}
    for fr, spans in meta['franchises'].items():
        for s in spans:
            for y in range(s['from'], s['to'] + 1):
                franchise_of[(s['name'], y)] = fr
    bat, pit = defaultdict(list), defaultdict(list)
    for y in meta['years']:
        s = json.loads((DATA / 'seasons' / f'{y}.json').read_text(encoding='utf-8'))
        for r in s['bat']:
            bat[(y, r[0])].append(dict(zip(s['batFields'], r)))
        for r in s['pit']:
            pit[(y, r[0])].append(dict(zip(s['pitFields'], r)))
    return players, franchise_of, bat, pit


def raw_rows():
    """수비.csv(2004년 빼고) + 수비_2004.csv. 원본 행 수(투수 포함)를 연도별로 함께 센다"""
    out = []
    with RAW_DEF.open(encoding='utf-8-sig', newline='') as f:
        out += [r for r in csv.DictReader(f) if r['year'] != '2004']
    with RAW_2004.open(encoding='utf-8-sig', newline='') as f:
        out += list(csv.DictReader(f))
    return out


def matcher(players, franchise_of, bat, pit):
    by_name = defaultdict(list)
    for p in players.values():
        by_name[p['name']].append(p['id'])

    def match(year, team, name, is_pit, g, gs, outs):
        """step2_refine_matcher.match_player와 같은 순서. (선수 ID, 사유) — 못 찾으면 ID None"""
        cands = by_name.get(name, [])
        if not cands:
            return None, 'no-name'
        fr = franchise_of.get((team, year), team)
        info = []
        for cid in cands:
            b, p = bat.get((year, cid), []), pit.get((year, cid), [])
            teams = {r['team'] for r in b} | {r['team'] for r in p}
            info.append({'cid': cid, 'b': b, 'p': p, 'any': bool(b or p), 'primary': bool(p) if is_pit else bool(b),
                         'team': team in teams or fr in {franchise_of.get((t, year), t) for t in teams},
                         'by': players[cid].get('birthYear')})
        if len(info) == 1:
            c = info[0]
            return c['cid'], 'ok' if c['team'] else 'team-differs' if c['any'] else 'ok-not-in-season'
        in_year = [c for c in info if c['any']]
        if not in_year:
            aged = [c for c in info if c['by'] and 18 <= year - c['by'] <= 45]
            return (aged[0]['cid'], 'ok-age') if len(aged) == 1 else (None, 'ambiguous-no-season')
        if len(in_year) == 1:
            return in_year[0]['cid'], 'ok'
        same_team = [c for c in in_year if c['team']]
        if len(same_team) == 1:
            return same_team[0]['cid'], 'ok'
        pool = same_team if len(same_team) > 1 else in_year
        side = [c for c in pool if c['primary']]
        if len(side) == 1:
            return side[0]['cid'], 'ok'
        side = side or pool
        if is_pit:
            best, d1, d2 = None, 10 ** 9, 10 ** 9
            for c in side:
                for r in c['p']:
                    if franchise_of.get((r['team'], year), r['team']) == fr or r['team'] == team:
                        d = abs((r.get('outs') or 0) - outs) + abs((r.get('g') or 0) - g) * 3 + abs((r.get('gs') or 0) - gs) * 5
                        if d < d1:
                            best, d1, d2 = c['cid'], d, d1
                        elif d < d2:
                            d2 = d
            if best and (d1 <= 2 or d2 - d1 >= 10):
                return best, 'ok-stats'
        else:
            hits = []
            for c in side:
                for r in c['b']:
                    if (franchise_of.get((r['team'], year), r['team']) == fr or r['team'] == team) and r['g'] >= g:
                        hits.append((c['cid'], r['g'] - g))
            hits.sort(key=lambda x: x[1])
            if len(hits) == 1 or (len(hits) > 1 and hits[0][1] < hits[1][1]):
                return hits[0][0], 'ok-stats'
        return None, f'ambiguous({len(side)})'

    return match


def build_innings(players, franchise_of, bat, pit):
    match = matcher(players, franchise_of, bat, pit)
    rows, why, raw_n, bad = [], Counter(), Counter(), []
    for r in raw_rows():
        y = int(r['year'])
        raw_n[y] += 1
        outs = parse_ip(r['IP'])
        pid, reason = match(y, r['team'], r['player'], r['position'] == '투수', num(r['G']), num(r['GS']), outs)
        why[reason] += 1
        if pid is None:
            bad.append(f'{y} {r["team"]} {r["player"]} {r["position"]} ({reason})')
            continue
        if r['position'] == '투수':
            continue
        rows.append({'선수ID': pid, '이름': r['player'], '연도': y, '구단': r['team'], '자리': POS_KR[r['position']],
                     'G': num(r['G']), 'GS': num(r['GS']), '이닝x3': outs, 'E': num(r['E']), 'PO': num(r['PO']),
                     'A': num(r['A']), 'DP': num(r['DP']), 'PB': num(r['PB']), 'SB': num(r['SB']), 'CS': num(r['CS'])})
    if bad:
        sys.exit('선수 ID를 찾지 못한 행 %d개:\n  ' % len(bad) + '\n  '.join(bad[:30]))
    rows.sort(key=lambda x: (x['연도'], x['구단'], x['선수ID'], x['자리']))
    return rows, why, raw_n


def check_against_reference(rows):
    """조사 직원 정리본과 행 수·선수 ID 대조 (정리본이 없으면 건너뛴다)"""
    if not CHECK_DEF.exists():
        print(f'정리본 없음, 대조 건너뜀: {CHECK_DEF}')
        return
    with CHECK_DEF.open(encoding='utf-8-sig', newline='') as f:
        ref = list(csv.DictReader(f))
    key = lambda y, t, n, p, g: (int(y), t, n, p, int(g))  # noqa: E731
    want = Counter((key(r['연도'], r['구단'], r['선수명'], r['포지션'], r['G']), r['선수ID']) for r in ref)
    got = Counter((key(r['연도'], r['구단'], r['이름'], r['자리'], r['G']), r['선수ID']) for r in rows)
    if len(ref) != len(rows) or want != got:
        diff = list((want - got).items())[:10] + list((got - want).items())[:10]
        sys.exit(f'정리본과 다름: 정리본 {len(ref)}행, 이번 {len(rows)}행. 예: {diff}')
    print(f'정리본 대조: {len(rows):,}행, 선수 ID 모두 같음')


# ---- 평판 시기 글 → 연도 범위

YEAR_SPAN = re.compile(r'(\d{4})년?\s*~\s*(\d{4})(년대)?')
YEAR_ONE = re.compile(r'(\d{4})년(대)?')


def period_of(text):
    """시기 글 → (시작, 끝, 알아본 연도). 적힌 연도('2018년', '2024년~2025년', '2007년~2020년대')만 쓴다.
    '데뷔 초'·'전성기'·'20대'·'고교 시절' 같은 말은 옮기지 않는다 — 한 줄에 여러 시기가 섞여 평판이 어느 시기 것인지
    가릴 수 없어서다 (예: '데뷔 초 실책 많음, 전성기 최정상급'). 연도가 하나도 없으면 시기 없음 = 통산
    (기획안 12.4 ①: 그 자리 누적 이닝 ÷ 2,300만큼, 300이닝 거름)"""
    t = (text or '').strip()
    spans, used = [], []
    for a, b, dec in YEAR_SPAN.findall(t):
        spans.append((int(a), int(b) + (9 if dec else 0)))
        used.append(f'{a}~{b}{"년대" if dec else ""}')
    for y, dec in YEAR_ONE.findall(YEAR_SPAN.sub(' ', t)):
        spans.append((int(y), int(y) + (9 if dec else 0)))
        used.append(f'{y}{"년대" if dec else ""}')
    if not spans:
        return None, None, ''
    return min(a for a, _ in spans), max(b for _, b in spans), ', '.join(dict.fromkeys(used))


def amateur_only(text):
    """시기 글이 '고교 시절'(띄어쓰기 무관)만으로 된 줄인가. '고교 시절, 2017년'·'고교 시절, 데뷔 초'처럼 다른 시기가 섞이면 아니다"""
    parts = [p.replace(' ', '') for p in (text or '').split(',') if p.strip()]
    return bool(parts) and all(p == '고교시절' for p in parts)


def build_reputation(players):
    with RAW_REP.open(encoding='utf-8-sig', newline='') as f:
        src = list(csv.DictReader(f))
    out, skipped = [], Counter()
    for r in src:
        pid = r['선수ID'].strip()
        if pid not in players:
            sys.exit(f'평판: 없는 선수 ID {pid} ({r["이름"]})')
        if r['자리'] not in REP_POS or r['평판'] not in REP_LEVEL:
            sys.exit(f'평판: 모르는 자리·등급 {r["자리"]} {r["평판"]} ({r["이름"]})')
        if amateur_only(r['시기']):
            skipped['시기가 고교 시절뿐이라 버림'] += 1
            continue
        a, b, used = period_of(r['시기'])
        if r['시기'].strip() not in ('', '통산') and not used:
            skipped['연도 없는 시기 글이라 통산으로 봄'] += 1
        text = r.get('근거 요약') or ''
        arm = (1 if ARM_GOOD.search(text) else 0) - (1 if ARM_BAD.search(text) else 0)
        title = ('나무위키: ' + r['나무위키 출처']) if r['나무위키 출처'] else ('위키백과: ' + r['위키백과 출처'])
        out.append({'선수ID': pid, '이름': r['이름'], '자리': r['자리'], '평판': r['평판'], '수준': REP_LEVEL[r['평판']],
                    '시기_시작': a if a is not None else '', '시기_끝': b if b is not None else '', '시기_근거': used or '통산',
                    '어깨': arm, '출처': title})
    out.sort(key=lambda x: (x['선수ID'], x['자리'], x['시기_시작'] or 0))
    return out, skipped


def write_csv(path, rows, head):
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=head, lineterminator='\n')
        w.writeheader()
        w.writerows(rows)


def main():
    players, franchise_of, bat, pit = load_game_data()
    rows, why, raw_n = build_innings(players, franchise_of, bat, pit)
    check_against_reference(rows)
    for r in rows:
        r['출처'] = DEF_SOURCE
    write_csv(OUT_DEF, rows, ['출처', '선수ID', '이름', '연도', '구단', '자리', 'G', 'GS', '이닝x3', 'E', 'PO', 'A', 'DP', 'PB', 'SB', 'CS'])
    if raw_n[2004] != 540:
        sys.exit(f'2004년 원본이 540행이 아님: {raw_n[2004]}행 (수비_2004.csv 보완본을 확인)')
    print(f'수비 이닝 {len(rows):,}행 (원본 {sum(raw_n.values()):,}행, 투수 행 제외), 2004년 원본 {raw_n[2004]}행 → {OUT_DEF}')
    print('  선수 ID 짝: ' + ', '.join(f'{k} {v:,}' for k, v in why.most_common()))
    rep, skipped = build_reputation(players)
    write_csv(OUT_REP, rep, ['출처', '선수ID', '이름', '자리', '평판', '수준', '시기_시작', '시기_끝', '시기_근거', '어깨'])
    print(f'수비 평판 {len(rep):,}행 ({len({r["선수ID"] for r in rep}):,}명) → {OUT_REP}' + ''.join(f', {k} {v}행' for k, v in skipped.items()))
    arm = Counter(r['어깨'] for r in rep)
    print(f'  어깨 낱말: 좋음 {arm[1]}행 ({len({r["선수ID"] for r in rep if r["어깨"] == 1})}명), 나쁨 {arm[-1]}행 ({len({r["선수ID"] for r in rep if r["어깨"] == -1})}명)')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
