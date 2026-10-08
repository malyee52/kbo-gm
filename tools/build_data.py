#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""자료집 엑셀 → 게임 데이터 JSON.

사용법:  python3 tools/build_data.py [엑셀 경로] [출력 폴더]
기본값:  data-src/KBO_단장게임_자료집.xlsx → public/data/

만드는 파일
  players.json          선수 마스터 (선수 한 명당 한 줄)
  seasons/<연도>.json   그 해의 구단, 리그 합계, 타자·투수 시즌 기록
  meta.json             연도 목록, 구단 계보, 연도별 규칙, 능력 산출용 사전 평균
  contracts.json        FA·비FA 다년 계약 (2000~2025 계약 시작, 금액 미검증 보조자료)
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data-src' / 'KBO_단장게임_자료집.xlsx'
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'public' / 'data'

POS = {'포수': 'C', '1루수': '1B', '2루수': '2B', '3루수': '3B', '유격수': 'SS', '좌익수': 'LF', '중견수': 'CF',
       '우익수': 'RF', '지명타자': 'DH', '내야수': 'IF', '외야수': 'OF', '선발투수': 'SP', '구원투수': 'RP',
       '마무리투수': 'CL', '투수': 'P'}
HAND = {'우': 'R', '좌': 'L', '양': 'S'}

BAT_FIELDS = ['id', 'team', 'pos', 'g', 'pa', 'ab', 'r', 'h', 'd', 't', 'hr', 'rbi', 'sb', 'cs', 'bb', 'hbp', 'so', 'gdp', 'sf', 'sac']
BAT_COLS = ['선수ID', '팀', '포지션(보조)', 'G', 'PA', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'CS', 'BB', 'HBP', 'SO', 'GDP', 'SF', 'SAC']
PIT_FIELDS = ['id', 'team', 'role', 'g', 'gs', 'w', 'l', 'sv', 'hld', 'outs', 'tbf', 'h', 'hr', 'bb', 'hbp', 'so', 'r', 'er']
PIT_COLS = ['선수ID', '팀', '역할(보조)', 'G', 'GS(보조)', 'W', 'L', 'SV', 'HLD', '아웃카운트', 'TBF', 'H', 'HR', 'BB', 'HBP', 'SO', 'R', 'ER']


def rows(ws):
    it = ws.iter_rows(values_only=True)
    header = list(next(it))
    for r in it:
        if r[0] is None:
            continue
        yield dict(zip(header, r))


def hands(bt):
    """'우투좌타', '우언투우타' → (던지는 손, 치는 손, 언더핸드 여부)"""
    if not bt or '투' not in bt:
        return None, None, False
    th, ba = bt.split('투')
    return HAND.get(th[0]), HAND.get(ba[0]), '언' in th


def school_of(career):
    """2026 프로필의 출신교·경력 문자열 → 'UNIV'(대졸) / 'HS'(고졸) / None.
    괄호 안 학교는 프로 입단 뒤 다닌 곳(사이버대 등)이라 빼고, 대학('...대')을 거쳤으면 대졸로 본다."""
    if not career:
        return None
    parts = [x.strip() for x in career.split('-') if x.strip() and not x.strip().startswith('(')]
    if any(x.endswith('대') or '대학' in x for x in parts):
        return 'UNIV'
    if any(x.endswith('고') for x in parts):
        return 'HS'
    return None


def contract_years(v):
    """계약 기간. '2(+2 선수옵션)'처럼 옵션이 붙으면 보장 기간(앞 숫자)만 쓴다."""
    if isinstance(v, int):
        return v
    m = re.match(r'\s*(\d+)', str(v or ''))
    return int(m.group(1)) if m else None


def rules_for(year):
    """연도별 규칙. source: 'confirmed' = 자료집 제도연표에서 출처 확인, 'assumed' = 미확인이라 가정한 값."""
    if year >= 2026: roster, rs = 29, 'confirmed'
    elif year >= 2020: roster, rs = 28, 'confirmed'
    elif year >= 2015: roster, rs = 27, 'confirmed'
    elif year == 2014: roster, rs = 26, 'confirmed'
    else: roster, rs = 26, 'assumed'
    if year < 1998: foreign, fs = 0, 'confirmed'
    elif year <= 2000: foreign, fs = 2, 'confirmed'
    elif year <= 2002: foreign, fs = 3, 'confirmed'
    elif year <= 2013: foreign, fs = 2, 'assumed'
    elif year <= 2025: foreign, fs = 3, 'confirmed'
    else: foreign, fs = 4, 'confirmed'
    if year <= 1988: post = 2
    elif year <= 2014: post = 4
    else: post = 5
    return {
        'rosterSize': roster, 'rosterSizeSource': rs,
        'foreignLimit': foreign, 'foreignLimitSource': fs,
        'maxInnings': 11 if year >= 2025 else 12, 'maxInningsSource': 'confirmed' if year >= 2008 else 'assumed',
        'postseasonTeams': post, 'postseasonTeamsSource': 'confirmed' if year >= 2015 else 'assumed',
    }


def main():
    print(f'읽는 중: {SRC}')
    wb = load_workbook(SRC, read_only=True, data_only=True)

    # ---- 선수 마스터
    players = []
    kind_of = {}
    for r in rows(wb['선수마스터']):
        th, ba, under = hands(r['투타'])
        kind = {'타자': 'B', '투수': 'P'}.get(r['구분'], 'BP')
        pid = str(r['선수ID'])
        kind_of[pid] = kind
        foreign = {'Y': True, 'N': False}.get(r['외국인'])
        players.append({
            'id': pid, 'name': r['선수명'], 'kind': kind, 'pos': POS.get(r['주포지션']),
            'throws': th, 'bats': ba, 'underhand': under or None,
            'birthYear': r['출생연도'], 'foreign': foreign,
            'entryYear': r['입단연도(추정)'], 'entryExact': r['입단연도(보조자료)'],
            'first': r['첫 1군 시즌'], 'last': r['마지막 1군 시즌'],
            'school': school_of(r['출신교·경력(2026 프로필)']),
            'real': True,
        })
    for p in players:
        for k in [k for k, v in p.items() if v is None]:
            del p[k]

    # ---- 계약 (FA계약 시트)
    contracts = []
    for r in rows(wb['FA계약']):
        years_ = contract_years(r['기간(년)'])
        if not isinstance(r['계약 첫 시즌'], int) or not years_:
            continue
        contracts.append({
            'first': r['계약 첫 시즌'], 'id': str(r['선수ID']), 'name': r['선수명'],
            'kind': 'FA' if r['종류'] == 'FA' else 'nonFA', 'years': years_,
            'guaranteed': r['보장액(억 원)'] or 0, 'option': r['옵션(억 원)'] or 0,
            **({'note': str(r['기간(년)'])} if not isinstance(r['기간(년)'], int) else {}),
        })

    # ---- 순위표
    teams = defaultdict(list)
    for r in rows(wb['시즌순위']):
        teams[r['시즌']].append({
            'name': r['팀'], 'franchise': r['프랜차이즈'], 'league': r['리그'], 'rank': r['최종 순위(KBO 표기)'],
            'g': r['경기'], 'w': r['승'], 'l': r['패'], 't': r['무'], 'pct': r['승률(KBO 표기)'],
            'home': r['홈(승-무-패)'], 'away': r['방문(승-무-패)'],
        })

    # ---- 시즌 기록
    bat = defaultdict(list)
    pit = defaultdict(list)
    for r in rows(wb['타자시즌']):
        row = [str(r['선수ID']) if c == '선수ID' else (POS.get(r[c]) if c == '포지션(보조)' else r[c]) for c in BAT_COLS]
        bat[r['시즌']].append(row)
    wpbk = defaultdict(int)
    for r in rows(wb['투수시즌']):
        wpbk[r['시즌']] += (r['WP'] or 0) + (r['BK'] or 0)
        row = [str(r['선수ID']) if c == '선수ID' else (POS.get(r[c]) if c == '역할(보조)' else r[c]) for c in PIT_COLS]
        pit[r['시즌']].append(row)

    years = sorted(teams)
    bi = {f: i for i, f in enumerate(BAT_FIELDS)}
    pi = {f: i for i, f in enumerate(PIT_FIELDS)}

    def n(v):
        return v or 0

    # ---- 리그 합계 (타자 쪽: 타석·안타 종류, 투수 쪽: 삼진·볼넷·사구·피홈런. 과거 타자 기록 일부에 볼넷·삼진이 비어 있어 투수 쪽을 쓴다)
    league = {}
    for y in years:
        b, p = bat[y], pit[y]
        L = {
            'teamGames': sum(t['g'] for t in teams[y]),
            'pa': sum(n(r[bi['pa']]) for r in b), 'ab': sum(n(r[bi['ab']]) for r in b), 'h': sum(n(r[bi['h']]) for r in b),
            'd': sum(n(r[bi['d']]) for r in b), 't': sum(n(r[bi['t']]) for r in b), 'hr': sum(n(r[bi['hr']]) for r in b),
            'r': sum(n(r[bi['r']]) for r in b), 'gdp': sum(n(r[bi['gdp']]) for r in b),
            'sb': sum(n(r[bi['sb']]) for r in b), 'sf': sum(n(r[bi['sf']]) for r in b), 'sac': sum(n(r[bi['sac']]) for r in b),
            'tbf': sum(n(r[pi['tbf']]) for r in p), 'bb': sum(n(r[pi['bb']]) for r in p), 'hbp': sum(n(r[pi['hbp']]) for r in p),
            'so': sum(n(r[pi['so']]) for r in p), 'hrAllowed': sum(n(r[pi['hr']]) for r in p),
            'wpbk': wpbk.get(y, 0),
            'er': sum(n(r[pi['er']]) for r in p), 'runsAllowed': sum(n(r[pi['r']]) for r in p), 'outs': sum(n(r[pi['outs']]) for r in p),
        }
        pa, tbf = L['pa'], L['tbf']
        L['rates'] = {
            's1': (L['h'] - L['d'] - L['t'] - L['hr']) / pa, 'd2': L['d'] / pa, 't3': L['t'] / pa, 'hr': L['hr'] / pa,
            'bb': L['bb'] / tbf, 'hbp': L['hbp'] / tbf, 'so': L['so'] / tbf,
        }
        L['avg'] = L['h'] / L['ab']
        L['runsPerTeamGame'] = L['r'] / L['teamGames']
        L['era'] = L['er'] * 27 / L['outs']
        L['gdpPerPa'] = L['gdp'] / pa
        L['sacPerPa'] = L['sac'] / pa
        L['sfPerPa'] = L['sf'] / pa
        L['unearnedShare'] = 1 - L['er'] / L['runsAllowed']
        L['wpbkPerPa'] = L['wpbk'] / tbf if L['wpbk'] else None  # 폭투+보크. 2001년부터 기록
        league[y] = L

    # ---- 능력 산출용 사전 평균: 출전이 적은 선수-시즌의 리그 대비 비율 (전 시즌 합산)
    ev_b = {'s1': None, 'd2': 'd', 't3': 't', 'hr': 'hr', 'bb': 'bb', 'hbp': 'hbp', 'so': 'so'}
    num_b = defaultdict(float); den_b = defaultdict(float)
    num_p = defaultdict(float); den_p = defaultdict(float)
    for y in years:
        if y == years[-1]:
            continue  # 진행 중 시즌 제외
        R = league[y]['rates']
        for r in bat[y]:
            pa = n(r[bi['pa']])
            if kind_of.get(r[bi['id']]) == 'P' or not (0 < pa < 100):
                continue
            h, d, t, hr = n(r[bi['h']]), n(r[bi['d']]), n(r[bi['t']]), n(r[bi['hr']])
            cnt = {'s1': h - d - t - hr, 'd2': d, 't3': t, 'hr': hr}
            for e in ('s1', 'd2', 't3', 'hr'):
                num_b[e] += cnt[e]; den_b[e] += pa * R[e]
            if r[bi['bb']] is not None and r[bi['so']] is not None:
                for e in ('bb', 'hbp', 'so'):
                    num_b[e] += n(r[bi[ev_b[e]]]); den_b[e] += pa * R[e]
        for r in pit[y]:
            tbf = n(r[pi['tbf']])
            if not (0 < tbf < 150):
                continue
            hit_rate = R['s1'] + R['d2'] + R['t3']
            num_p['hit'] += n(r[pi['h']]) - n(r[pi['hr']]); den_p['hit'] += tbf * hit_rate
            for e in ('hr', 'bb', 'hbp', 'so'):
                num_p[e] += n(r[pi[e]]); den_p[e] += tbf * R[e]
    priors = {
        'batter': {e: round(num_b[e] / den_b[e], 4) for e in num_b},
        'pitcher': {e: round(num_p[e] / den_p[e], 4) for e in num_p},
        'note': '타자 100타석 미만, 투수 상대 타자 150명 미만 선수-시즌의 리그 대비 비율',
    }

    # ---- 쓰기
    (OUT / 'seasons').mkdir(parents=True, exist_ok=True)
    dump = lambda o, p: p.write_text(json.dumps(o, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    dump({'version': 1, 'players': players}, OUT / 'players.json')
    dump({'version': 1, 'note': '보조자료의 FA 계약 목록. 금액은 구단 발표와 대조하지 않았다. 옵션 제외 보장액(억 원)', 'contracts': contracts},
         OUT / 'contracts.json')
    for y in years:
        dump({
            'year': y, 'complete': y != years[-1], 'games': max(t['g'] for t in teams[y]) if y != years[-1] else 144,
            'teams': teams[y], 'league': league[y],
            'batFields': BAT_FIELDS, 'bat': bat[y], 'pitFields': PIT_FIELDS, 'pit': pit[y],
        }, OUT / 'seasons' / f'{y}.json')
    franchises = defaultdict(list)
    for y in years:
        for t in teams[y]:
            f = franchises[t['franchise']]
            if not f or f[-1]['name'] != t['name']:
                f.append({'name': t['name'], 'from': y, 'to': y})
            else:
                f[-1]['to'] = y
    dump({
        'version': 1, 'source': SRC.name, 'years': years, 'inProgress': [years[-1]],
        'franchises': franchises, 'successors': {'쌍방울': 'SSG', '현대계': '히어로즈'},
        'rules': {y: rules_for(y) for y in years}, 'priors': priors,
    }, OUT / 'meta.json')
    total = sum(f.stat().st_size for f in OUT.rglob('*.json'))
    print(f'선수 {len(players):,}명, 시즌 {len(years)}개({years[0]}~{years[-1]}), '
          f'타자 시즌 {sum(len(v) for v in bat.values()):,}행, 투수 시즌 {sum(len(v) for v in pit.values()):,}행')
    print(f'계약 {len(contracts)}건, 학력 구분 {sum(1 for p in players if p.get("school"))}명')
    print(f'사전 평균(타자): {priors["batter"]}')
    print(f'사전 평균(투수): {priors["pitcher"]}')
    print(f'출력: {OUT} ({total / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
