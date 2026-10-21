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
  drafts.json           입단 연도별 신인 지명 (1982~2027, 원년 멤버·육성선수 포함)

함께 읽는 파일
  data-src/외국인_개막명단.csv   시작 연도 개막 때 구단별 외국인과 아시아쿼터 여부 (meta.json의 foreignOpening, 선수 마스터의 asia)
                                 자료집에 날짜·국적이 없어 따로 둔다. '확인' 열이 '미확인'이면 추정값이다.
  data-src/병역_면제명단.csv     국제대회 금메달 대표팀과 2026 아시안게임 새 면제자 (military.json). 출처 열 참조.
                                 상무·경찰 복무는 자료집 선수마스터의 '출신교·경력(2026 프로필)'에서 읽는다.
                                 엑셀의 다른 내용을 바꾸지 않고 이것만 다시 만들려면: build_data.py --military-only
  data-src/baseballchart/kbo_draft_1982-2027.csv
                                 입단 연도별 실제 신인 지명 (drafts.json). baseballchart.kr에서 받은 원본, CC BY-NC-SA 2.0 KR.
                                 같은 폴더의 SOURCE.md 참조. 지명받고 그해 입단하지 않은 선수(해외 진출 등)는 실제 입단 해로 옮긴다 (defer_unsigned).
                                 이것만 다시 만들려면: build_data.py --drafts-only
  data-src/감독.csv              연도별 구단 감독 실명 (managers.json). 한국어 위키백과 구단별 감독 틀·감독 목록, 2026 보도로 만든 것.
                                 '시점'이 개막이면 그 시즌을 시작한 감독, 중도면 시즌 중 바뀐 감독. 메모에 확인할 점.
                                 감독의 운영 경향(도루 시도·희생번트·구원 등판)은 그 감독이 시즌 내내 맡은 해의 팀 기록으로 계산한다.
                                 이것만 다시 만들려면: build_data.py --managers-only
  data-src/hardhit_derived/      하드힛(https://hardhit.ai, 비상업적 이용) 기록을 게임 선수 ID에 연결한 가공값.
                                 원본(data-src/hardhit/, 커밋 안 함)에서 tools/hardhit_derive.py가 만든다. 원본이 없어도 이 폴더로 빌드된다.
                                 bat_running.csv: 자료집에 비어 있는 타자 도루·도루실패·병살타를 채운다 (값이 있으면 자료집 값을 두고 다른 건수만 센다)
"""
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
SRC = Path(ARGS[0]) if ARGS else ROOT / 'data-src' / 'KBO_단장게임_자료집.xlsx'
FOREIGN_OPENING = ROOT / 'data-src' / '외국인_개막명단.csv'
TRAITS_CSV = ROOT / 'data-src' / '특수능력.csv'
MILITARY_CSV = ROOT / 'data-src' / '병역_면제명단.csv'
MANAGERS_CSV = ROOT / 'data-src' / '감독.csv'
HARDHIT = ROOT / 'data-src' / 'hardhit_derived'
HARDHIT_REPORT = ROOT / 'reports' / 'hardhit-fill.md'
# 그 해 1군 기록이 자료에 없지만 선수단에 넣어야 하는 선수 (예: 2026 김광현). 기록 0인 행을 그 시즌에 더한다
EXTRA_ROSTER = ROOT / 'data-src' / '추가_명단.csv'
# 숨겨진 특수능력: CSV의 한글 이름 → 엔진 코드 (src/engine/traits.ts의 TRAIT_INFO와 같아야 한다)
TRAIT_LABELS = {
    '승부사': 'clutch', '가을 사나이': 'october', '위기 탈출': 'escape', '철인': 'ironman', '늦게 지는 꽃': 'evergreen',
    '에이스 체력': 'stamina', '안방 사나이': 'homer', '좌완 킬러': 'vsLeft', '우완 킬러': 'vsRight',
}


def trait_key(pid):
    """선수 ID → traits.json의 키. 소금을 붙인 FNV-1a 32비트 해시 (src/engine/traits.ts의 traitKey와 같은 값)"""
    h = 0x811c9dc5
    for b in f'kbo-gm/traits/{pid}'.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xffffffff
    return f'{h:08x}'


def build_traits(known_ids):
    """data-src/특수능력.csv → {해시: [코드, ...]}. 모르는 선수 ID나 능력 이름은 오류"""
    table = {}
    if not TRAITS_CSV.exists():
        return table
    with TRAITS_CSV.open(encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            pid = str(r['선수ID']).strip()
            codes = [TRAIT_LABELS.get(x.strip()) for x in (r['능력'] or '').split(';') if x.strip()]
            if not codes:
                continue
            if pid not in known_ids:
                raise SystemExit(f'특수능력.csv: 없는 선수 ID {pid} ({r.get("선수명")})')
            if None in codes:
                raise SystemExit(f'특수능력.csv: 모르는 능력 이름 "{r["능력"]}" ({r.get("선수명")}). 가능한 값: {", ".join(TRAIT_LABELS)}')
            table[trait_key(pid)] = sorted(set(codes))
    return dict(sorted(table.items()))


def dump_traits(table):
    (OUT).mkdir(parents=True, exist_ok=True)
    (OUT / 'traits.json').write_text(json.dumps({
        'version': 1,
        'note': '숨겨진 특수능력. 키는 선수 ID의 해시(tools/build_data.py trait_key), 값은 능력 코드. 화면에 보이지 않는다.',
        'traits': table,
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'특수능력: {len(table)}명 → {OUT / "traits.json"}')
DRAFTS = ROOT / 'data-src' / 'baseballchart' / 'kbo_draft_1982-2027.csv'
DRAFT_POS = {'투수': 'P', '포수': 'C', '내야수': 'IF', '외야수': 'OF', '지명타자': 'DH'}


def draft_pos(text):
    """포지션 표기 → (P·C·IF·OF·DH, 투타겸업 여부). '투수/외야수'처럼 둘이면 앞의 것. 투타겸업은 투수로 본다"""
    if not text:
        return 'IF', False
    if text == '투타겸업':
        return 'P', True
    first = re.split(r'[/,·]', text)[0].strip()
    return DRAFT_POS.get(first, 'IF'), len(re.split(r'[/,·]', text)) > 1


def draft_rows():
    """baseballchart.kr 원본 → 입단 연도별 지명 목록 (원본 순서 그대로)"""
    out = defaultdict(list)
    if not DRAFTS.exists():
        return out
    with DRAFTS.open(encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            kind = r['갈래'].strip()
            rnd = None
            m = re.fullmatch(r'(\d+)라운드', kind)
            if m:
                kind, rnd = '라운드', int(m.group(1))
            overall = re.search(r'(\d+)순위', r['자리'] or '')
            pos, two_way = draft_pos(r['포지션'].strip())
            career = [x.strip() for x in (r['이력'] or '').split('-') if x.strip()]
            name = re.sub(r'\s*\(.*\)$', '', r['선수']).strip()  # '김바위 (김용윤)' → 김바위
            row = {
                'kind': kind, 'round': rnd, 'overall': int(overall.group(1)) if overall else None,
                'team': r['지명 구단'].strip(), 'name': name, 'pos': pos,
                'school': career[0] if career else '',
                # 이력에 대학(…대, …대학교)이 있으면 대졸로 본다
                'univ': any(x.endswith('대') or '대학' in x for x in career),
                'games': int(r['통산 경기'] or 0),
            }
            if two_way:
                row['twoWay'] = True
            out[str(r['연도'])].append(row)
    return out
OUT = Path(ARGS[1]) if len(ARGS) > 1 else ROOT / 'public' / 'data'


def master_games(out_dir):
    """선수 ID → 실제 KBO 1군 통산 경기 (시즌마다 타자·투수 기록 중 많은 쪽)"""
    meta = json.loads((out_dir / 'meta.json').read_text(encoding='utf-8'))
    total = defaultdict(int)
    for y in meta['years']:
        sd = json.loads((out_dir / 'seasons' / f'{y}.json').read_text(encoding='utf-8'))
        bi = sd['batFields'].index('g')
        pi = sd['pitFields'].index('g')
        g = defaultdict(int)
        for r in sd['bat']:
            g[r[0]] = max(g[r[0]], r[bi] or 0)
        for r in sd['pit']:
            g[r[0]] = max(g[r[0]], r[pi] or 0)
        for k, v in g.items():
            total[k] += v
    return total


def school_key(name):
    """'광주제일고'·'광주일고'처럼 같은 학교의 다른 표기를 맞춘다"""
    return (name or '').replace('제일', '일').replace('상업고', '상고').replace('공업고', '공고').strip()


def defer_unsigned(drafts, players, games_of):
    """지명 행을 실제 선수와 잇고, 지명받고 그해 입단하지 않은 행을 정리한다
    (2026-10-12 사용자: 2001년 채태인·추신수 같은 선수가 그해 드래프트에 나온다).
    해외 진출·대학 진학으로 지명만 받고 몇 해 뒤 입단한 선수가 지명 해 게임 드래프트에 나오면 실제보다 일찍 KBO에서 뛰고,
    게임은 지명 행을 선수 마스터와 '이름 + 입단 연도 ±1'로만 맞춰 가짜 동명 선수가 생겼다.
    - 잇기: 같은 이름의 국내 선수마다, 데뷔 해까지의 지명 가운데 통산 경기(원본 '통산 경기')가 그 선수의 실제 1군 통산 경기와
      맞는 행(±25%·5경기)을 그 선수의 입단 지명으로 보고 pid를 붙인다 (나이가 맞는 행만). 여럿이면 경기 수가 가장 가까운 행, 같으면 입단 해와 가까운 행.
      실제 입단(entryYear)이 지명 2년 넘게 뒤면 행을 입단 해로 옮기고 drafted에 원래 지명 연도를 남긴다 (예: 추신수 2007 SK 해외 → 2021).
    - 빼기: 이은 행보다 앞선 같은 이름·같은 출신교의 0경기 지명은 그 사람이 입단하지 않은 지명이다 (예: 채태인 2001 두산)
    돌려주는 값: (정리한 지명, 옮긴 목록, 뺀 목록)"""
    by_name = defaultdict(list)
    for m in players:
        if not m.get('foreign') and m.get('first'):
            by_name[m['name']].append(m)
    rows_of = defaultdict(list)
    for y, lst in drafts.items():
        for d in lst:
            if d['kind'] not in ('육성선수', '원년 멤버'):
                rows_of[d['name']].append((int(y), d))
    claim = {}
    drop = set()
    for name, rows_ in rows_of.items():
        rows_.sort(key=lambda x: x[0])
        taken = set()
        for m in sorted(by_name.get(name, []), key=lambda m: (m['first'], m['id'])):
            b = m.get('birthYear')
            gm = games_of.get(m['id'], 0)
            age_ok = lambda y: (16 <= y - b <= 45) if b else (y >= m['first'] - 20)
            near = lambda g: g > 0 and abs(g - gm) <= max(5, gm * 0.25)
            ok = [(y, d) for y, d in rows_ if id(d) not in taken and y <= m['first'] and age_ok(y) and near(d['games'])]
            if not ok:
                continue
            # 경기 수가 가장 가까운 행, 같으면 실제 입단 해와 가까운 행 (동명이인끼리 경기 수가 적으면 헷갈린다)
            y, d = min(ok, key=lambda x: (abs(x[1]['games'] - gm), abs(x[0] - (m.get('entryYear') or x[0])), -x[0]))
            taken.add(id(d))
            claim[id(d)] = m
            for y2, d2 in rows_:
                if y2 < y and id(d2) not in taken and d2['games'] == 0 and age_ok(y2) and school_key(d2['school']) == school_key(d['school']):
                    drop.add(id(d2))
                    taken.add(id(d2))
    out = defaultdict(list)
    moved, dropped = [], []
    for y in sorted(drafts, key=int):
        Y = int(y)
        for d in drafts[y]:
            if id(d) in drop:
                dropped.append(f"{d['name']} {Y}")
                continue
            m = claim.get(id(d))
            if not m:
                out[y].append(d)
                continue
            row = dict(d, pid=m['id'])
            e = m.get('entryYear') or Y
            if e > Y + 1:
                row['drafted'] = Y
                out[str(e)].append(row)
                moved.append(f"{d['name']} {Y}→{e}")
            else:
                out[y].append(row)
    return dict(out), moved, dropped


def dump_drafts(drafts, players):
    drafts, moved, dropped = defer_unsigned(drafts, players, master_games(OUT))
    (OUT / 'drafts.json').write_text(json.dumps({
        'version': 1, 'source': 'baseballchart.kr/draft (나무위키 「(연도) KBO 신인 드래프트」 문서 정리, 2026-09-21 수집)',
        'license': 'CC BY-NC-SA 2.0 KR', 'years': {y: drafts[y] for y in sorted(drafts, key=int)},
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'신인 지명: 그해 입단하지 않은 지명 {len(moved)}건을 실제 입단 해로 옮김, {len(dropped)}건은 나중 지명이 있어 뺌')
    return drafts

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


# ---- 감독 (managers.json)

def build_managers(out_dir):
    """감독.csv → {seasons: {연도: {계보: [{name, kind, mid}]}}, people: {이름: 경력·운영 경향}}.
    운영 경향은 그 감독이 개막부터 끝까지 맡은 시즌(중도 교체가 없는 해)의 팀 기록을 그 해 리그 평균과 견준 배율이다.
      steal: (도루 + 도루자) / (단타 + 볼넷 + 사구), bunt: 희생번트 / 타석, relief: (등판 − 선발) / 경기
    시즌이 적으면 1 쪽으로 당긴다 (n / (n + 2)). 성격·인물평은 넣지 않는다 (기록 사실만)."""
    if not MANAGERS_CSV.exists():
        return
    meta = json.loads((out_dir / 'meta.json').read_text(encoding='utf-8'))
    with MANAGERS_CSV.open(encoding='utf-8-sig', newline='') as f:
        rows_ = [r for r in csv.DictReader(f)]
    seasons = defaultdict(lambda: defaultdict(list))
    for r in rows_:
        seasons[r['시즌']][r['계보']].append({'name': r['감독'], 'kind': r['구분'], **({'mid': True} if r['시점'] == '중도' else {})})

    def team_stats(y):
        sd = json.loads((out_dir / 'seasons' / f'{y}.json').read_text(encoding='utf-8'))
        bi = {k: i for i, k in enumerate(sd['batFields'])}
        pi = {k: i for i, k in enumerate(sd['pitFields'])}
        out = {}
        for t in sd['teams']:
            b = [r for r in sd['bat'] if r[bi['team']] == t['name']]
            p = [r for r in sd['pit'] if r[pi['team']] == t['name']]
            g = lambda rs, k, ix: sum((r[ix[k]] or 0) for r in rs)
            singles = g(b, 'h', bi) - g(b, 'd', bi) - g(b, 't', bi) - g(b, 'hr', bi)
            on1 = singles + g(b, 'bb', bi) + g(b, 'hbp', bi)
            out[t['franchise']] = {
                'steal': (g(b, 'sb', bi) + g(b, 'cs', bi)), 'on1': on1, 'sac': g(b, 'sac', bi), 'pa': g(b, 'pa', bi),
                'relief': g(p, 'g', pi) - g(p, 'gs', pi), 'games': t['g'], 'rank': t['rank'],
            }
        return out

    acc = defaultdict(lambda: {'steal': [], 'bunt': [], 'relief': []})
    people = {}
    for y in meta['years']:
        ts = team_stats(y)
        lg = {k: sum(v[k] for v in ts.values()) for k in ('steal', 'on1', 'sac', 'pa', 'relief', 'games')}
        for fr, ms in seasons.get(str(y), {}).items():
            for m in ms:
                pe = people.setdefault(m['name'], {'first': y, 'last': y, 'seasons': 0, 'acting': 0, 'teams': [], 'titles': 0})
                pe['last'] = y
                if fr not in pe['teams']:
                    pe['teams'].append(fr)
                if m['kind'] == '정식':
                    pe['seasons'] += 1
                else:
                    pe['acting'] += 1
            full = [m for m in ms if not m.get('mid')]
            if len(ms) != 1 or not full or fr not in ts:
                continue
            name = full[0]['name']
            t = ts[fr]
            if t['rank'] == 1 and y not in meta.get('inProgress', []):  # 진행 중인 시즌의 1위는 우승이 아니다
                people[name]['titles'] += 1
            ratio = lambda a, b, la, lb: (a / b) / (la / lb) if b and lb and la else None
            for k, v in (('steal', ratio(t['steal'], t['on1'], lg['steal'], lg['on1'])), ('bunt', ratio(t['sac'], t['pa'], lg['sac'], lg['pa'])),
                         ('relief', ratio(t['relief'], t['games'], lg['relief'], lg['games']))):
                if v is not None:
                    acc[name][k].append(v)
    for name, pe in people.items():
        a = acc.get(name)
        n = len(a['steal']) if a else 0
        pe['full'] = n
        for k in ('steal', 'bunt', 'relief'):
            vs = a[k] if a else []
            mean = sum(vs) / len(vs) if vs else 1.0
            pe[k] = round(1 + (mean - 1) * len(vs) / (len(vs) + 2), 3)
    (out_dir / 'managers.json').write_text(json.dumps({
        'source': MANAGERS_CSV.name,
        'seasons': seasons,
        'people': people,
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'감독: {len(rows_)}행, {len(people)}명 → {out_dir / "managers.json"}')


# ---- 병역 (military.json)

SERVICE_UNITS = ('상무', '경찰')


def service_unit(career):
    """2026 프로필 경력에 상무·경찰 야구단이 있으면 그 이름. 학교 이름(군산상고 등)과 섞이지 않게 '-'로 나눈 칸 단위로 본다"""
    for part in (career or '').split('-'):
        part = part.strip()
        for u in SERVICE_UNITS:
            if part.startswith(u):
                return u
    return None


def build_military(profiles, out_dir):
    """실제 병역 자료 → {선수 ID: {served?, exempt?}}.
    profiles: 선수 ID → 2026 프로필 경력 문자열. 시즌 기록과 선수 마스터는 out_dir의 JSON에서 읽는다 (같은 빌드에서 만든 것).
    - served: 프로필 경력에 상무·경찰이 있는 선수. end = 1군 기록이 1~2시즌 빈 마지막 해 (복무를 마친 해 추정, 없으면 생략)
    - exempt: 병역_면제명단.csv의 금메달 대표팀(미필이었으면 면제)과 2026 새 면제자. year = 대회 연도"""
    players = json.loads((out_dir / 'players.json').read_text(encoding='utf-8'))['players']
    meta = json.loads((out_dir / 'meta.json').read_text(encoding='utf-8'))
    seen = defaultdict(dict)  # 선수 ID → {연도: 구단}
    for y in meta['years']:
        sd = json.loads((out_dir / 'seasons' / f'{y}.json').read_text(encoding='utf-8'))
        for r in sd['bat'] + sd['pit']:
            seen[str(r[0])][y] = r[1]
    table = {}
    for p in players:
        if p.get('foreign'):
            continue
        unit = service_unit(profiles.get(p['id']))
        if not unit:
            continue
        ys = sorted(seen.get(p['id'], {}))
        end = None
        for a, b in zip(ys, ys[1:]):
            if 2 <= b - a <= 3:  # 1~2시즌 공백
                end = b - 1
        table[p['id']] = {'served': {'unit': unit, **({'end': end} if end else {})}}
    unmatched = []
    if MILITARY_CSV.exists():
        by_name = defaultdict(list)
        for p in players:
            if not p.get('foreign'):
                by_name[p['name']].append(p)
        with MILITARY_CSV.open(encoding='utf-8-sig', newline='') as f:
            for r in csv.DictReader(f):
                y, name, team = int(r['연도']), r['선수명'].strip(), (r['당시소속'] or '').strip()
                cands = by_name.get(name, [])
                if team in ('아마추어',):
                    pick = [p for p in cands if (p.get('first') or 0) >= y]
                elif team.startswith('해외:'):  # 그 해에는 해외 리그. 다른 해에 뛴 KBO 구단으로 가린다
                    pick = [p for p in cands if team[3:] in seen[p['id']].values()]
                elif team in ('', '해외'):
                    pick = cands
                else:
                    pick = [p for p in cands if any(seen[p['id']].get(x) == team for x in (y - 1, y, y + 1))]
                if len(pick) != 1:
                    unmatched.append(f"{y} {name}({team or '-'}): 후보 {len(pick)}명")
                    continue
                e = table.setdefault(pick[0]['id'], {})
                if 'exempt' not in e or e['exempt']['year'] > y:
                    e['exempt'] = {'year': y, 'event': r['대회']}
    (out_dir / 'military.json').write_text(json.dumps({
        'version': 1,
        'note': '실제 병역 자료. served = 2026 프로필 경력의 상무·경찰(end = 1군 공백으로 본 복무 끝 해, 추정), '
                'exempt = 국제대회 금메달 대표팀(병역_면제명단.csv, year = 대회 연도). 여기 없는 선수는 자료가 없는 것이다.',
        'players': dict(sorted(table.items())),
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    served = sum(1 for v in table.values() if 'served' in v)
    exempt = sum(1 for v in table.values() if 'exempt' in v)
    print(f'병역: 상무·경찰 {served}명, 금메달 면제·대표 {exempt}명 → {out_dir / "military.json"}')
    for u in unmatched:
        print(f'  병역_면제명단.csv 연결 못 함: {u}')


def hardhit_csv(name):
    path = HARDHIT / name
    if not path.exists():
        return []
    with path.open(encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))


def fill_running(bat):
    """하드힛 도루·도루실패·병살타로 자료집의 빈 값을 채운다. 값이 이미 있는데 다르면 자료집 값을 두고 센다.
    → 보고서 줄 목록"""
    hh = {(int(r['연도']), r['선수ID']): r for r in hardhit_csv('bat_running.csv')}
    if not hh:
        return []
    cols = (('sb', '도루'), ('cs', '도루실패'), ('gdp', '병살타'))
    idx = {f: BAT_FIELDS.index(f) for f, _ in cols}
    filled, differ, same = defaultdict(int), defaultdict(int), defaultdict(int)
    filled_y = defaultdict(lambda: defaultdict(int))
    examples = defaultdict(list)
    for y, rows_ in bat.items():
        for row in rows_:
            h = hh.get((y, row[0]))
            if not h:
                continue
            for f, k in cols:
                if h[k] == '':
                    continue
                v = int(h[k])
                cur = row[idx[f]]
                if cur is None:
                    row[idx[f]] = v
                    filled[f] += 1
                    filled_y[y][f] += 1
                elif cur != v:
                    differ[f] += 1
                    if len(examples[f]) < 10:
                        examples[f].append(f'{y} {row[0]} 자료집 {cur} / 하드힛 {v}')
                else:
                    same[f] += 1
    out = ['## 타자 도루·도루실패·병살타 (bat_running.csv)', '',
           '빈 값은 하드힛 값으로 채우고, 값이 있으면 자료집 값을 둔다 (다른 건수만 센다).', '',
           '| 항목 | 채움 | 같음 | 다름(자료집 값 유지) |', '|---|---:|---:|---:|']
    out += [f'| {k} | {filled[f]} | {same[f]} | {differ[f]} |' for f, k in cols]
    out += ['', '연도별 채움 (도루 / 도루실패 / 병살타):', '']
    out += [f'- {y}: {d["sb"]} / {d["cs"]} / {d["gdp"]}' for y, d in sorted(filled_y.items())]
    for f, k in cols:
        if examples[f]:
            out += ['', f'{k} 다른 예 (연도 선수ID):', ''] + [f'- {e}' for e in examples[f]]
    print(f'하드힛 채움: 도루 {filled["sb"]}, 도루실패 {filled["cs"]}, 병살타 {filled["gdp"]} / 다름(자료집 유지) {dict(differ)}')
    return out


def profiles_of(wb):
    return {str(r['선수ID']): r['출신교·경력(2026 프로필)'] for r in rows(wb['선수마스터']) if r['출신교·경력(2026 프로필)']}


def main():
    if '--military-only' in sys.argv:
        # 병역 자료만 다시 만든다 (다른 JSON은 그대로라 저장 호환에 영향 없음)
        build_military(profiles_of(load_workbook(SRC, read_only=True, data_only=True)), OUT)
        return
    if '--drafts-only' in sys.argv:
        # 지명 자료만 다시 만든다 (선수 마스터는 players.json에서 읽는다)
        dump_drafts(draft_rows(), json.loads((OUT / 'players.json').read_text(encoding='utf-8'))['players'])
        return
    if '--managers-only' in sys.argv:
        # 감독 CSV만 다시 반영한다 (시즌 JSON에서 운영 경향을 계산한다)
        build_managers(OUT)
        return
    if '--traits-only' in sys.argv:
        # 특수능력 CSV만 다시 반영한다 (엑셀을 읽지 않으므로 다른 JSON과 저장 호환은 그대로)
        ids = {p['id'] for p in json.loads((OUT / 'players.json').read_text(encoding='utf-8'))['players']}
        dump_traits(build_traits(ids))
        return
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

    # ---- 외국인 개막 명단 (CSV)
    foreign_opening = defaultdict(lambda: defaultdict(list))
    asia_ids = set()
    if FOREIGN_OPENING.exists():
        with FOREIGN_OPENING.open(encoding='utf-8-sig', newline='') as f:
            for r in csv.DictReader(f):
                if r['구분'] == '제외':
                    continue
                asia = r['구분'] == '아시아쿼터'
                foreign_opening[str(r['연도'])][r['구단']].append({'id': str(r['선수ID']), 'asia': asia, 'confirmed': r['확인'] == '확인'})
                if asia:
                    asia_ids.add(str(r['선수ID']))
    for p in players:
        if p['id'] in asia_ids:
            p['asia'] = True

    # ---- 신인 지명 (baseballchart.kr 원본)
    drafts = draft_rows()

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

    # ---- 하드힛 가공값으로 빈 기록 채우기
    hardhit_report = fill_running(bat)

    # ---- 추가 명단 (CSV): 그 해 기록이 없는 선수를 기록 0인 행으로 넣는다. 능력은 직전 시즌 기록에서 나온다
    extra_ids = set()
    if EXTRA_ROSTER.exists():
        with EXTRA_ROSTER.open(encoding='utf-8-sig', newline='') as f:
            for r in csv.DictReader(f):
                y, pid, team = int(r['시즌']), str(r['선수ID']).strip(), r['구단'].strip()
                m = next((p for p in players if p['id'] == pid), None)
                if not m:
                    raise SystemExit(f'추가_명단.csv: 없는 선수 ID {pid} ({r.get("선수명")})')
                if team not in {t['name'] for t in teams.get(y, [])}:
                    raise SystemExit(f'추가_명단.csv: {y}년에 없는 구단 {team} ({r.get("선수명")})')
                is_pit = r['구분'].strip() == '투수'
                have = any(row[0] == pid for row in (pit[y] if is_pit else bat[y]))
                if have:
                    continue
                if is_pit:
                    role = m.get('pos') if m.get('pos') in ('SP', 'RP', 'CL') else None
                    pit[y].append([pid, team, role] + [0] * (len(PIT_FIELDS) - 3))
                else:
                    pos = m.get('pos') if m.get('pos') not in ('SP', 'RP', 'CL', 'P') else None
                    bat[y].append([pid, team, pos] + [0] * (len(BAT_FIELDS) - 3))
                extra_ids.add((y, pid))
                if m.get('last', 0) < y:
                    m['last'] = y

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

    # ---- 특별 엔트리 (은퇴식 등으로 하루 1군에 등록된 선수)
    # 그 해 1~2경기, 3타석·상대 타자 3명 이하, 34세 이상, 그 해가 마지막 1군 시즌인 선수 (규칙으로 고른 값).
    # 새 게임은 시작 연도 명단의 선수를 리그에 넣지 않는다 (현역이 아니다). 진행 중 시즌은 "마지막 시즌" 조건이 늘 참이다.
    bi, pi = BAT_FIELDS.index, PIT_FIELDS.index
    pmap = {p['id']: p for p in players}
    special = {}
    for y in years:
        use = defaultdict(lambda: [0, 0, 0])  # 경기, 타석, 상대 타자
        for r in bat[y]:
            u = use[r[bi('id')]]
            u[0] = max(u[0], r[bi('g')] or 0)
            u[1] += r[bi('pa')] or 0
        for r in pit[y]:
            u = use[r[pi('id')]]
            u[0] = max(u[0], r[pi('g')] or 0)
            u[2] += r[pi('tbf')] or 0
        ids = []
        for pid, (g, pa, bf) in use.items():
            m = pmap.get(pid)
            if not m or not m.get('birthYear') or (y, pid) in extra_ids:
                continue  # 추가 명단의 기록 0 행은 은퇴식이 아니다
            if g <= 2 and pa <= 3 and bf <= 3 and y - m['birthYear'] >= 34 and m.get('last') == y:
                ids.append(pid)
        if ids:
            special[str(y)] = sorted(ids)

    # ---- 쓰기
    (OUT / 'seasons').mkdir(parents=True, exist_ok=True)
    dump = lambda o, p: p.write_text(json.dumps(o, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    dump({'version': 1, 'players': players}, OUT / 'players.json')
    dump_traits(build_traits({p['id'] for p in players}))
    drafts = dump_drafts(drafts, players)
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
        **({'foreignOpening': foreign_opening} if foreign_opening else {}),
        'specialEntries': special,
    }, OUT / 'meta.json')
    build_military(profiles_of(wb), OUT)
    build_managers(OUT)
    if hardhit_report:
        head = ['# 하드힛 가공값 반영 결과', '', '`python tools/build_data.py`가 만든다. 기록 일부: 하드힛(https://hardhit.ai), 비상업적 이용.', '']
        HARDHIT_REPORT.write_text('\n'.join(head + hardhit_report) + '\n', encoding='utf-8')
    total = sum(f.stat().st_size for f in OUT.rglob('*.json'))
    print(f'선수 {len(players):,}명, 시즌 {len(years)}개({years[0]}~{years[-1]}), '
          f'타자 시즌 {sum(len(v) for v in bat.values()):,}행, 투수 시즌 {sum(len(v) for v in pit.values()):,}행')
    print(f'계약 {len(contracts)}건, 학력 구분 {sum(1 for p in players if p.get("school"))}명')
    print(f'신인 지명: {len(drafts)}개 연도 {sum(len(v) for v in drafts.values()):,}명 ({min(drafts, default="-")}~{max(drafts, default="-")} 입단)')
    print(f'추가 명단: {len(extra_ids)}명')
    print(f'외국인 개막 명단: {", ".join(f"{y}년 {sum(len(v) for v in t.values())}명" for y, t in foreign_opening.items()) or "없음"}, 아시아쿼터 {len(asia_ids)}명')
    print(f'사전 평균(타자): {priors["batter"]}')
    print(f'사전 평균(투수): {priors["pitcher"]}')
    print(f'출력: {OUT} ({total / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
