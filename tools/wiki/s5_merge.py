# -*- coding: utf-8 -*-
"""5단계: 신뢰도 순서로 합치기 — 우리 원자료 > 위키백과(+위키데이터) > 나무위키. 빈 칸만 채운다.

  python tools/wiki/s5_merge.py [--sample]

쓰는 것 (data-src/wiki/, 견본은 저장소 밖 견본 폴더):
  인적사항.csv        우리 자료가 빈 인적 사항 → 채울 값 (선수ID, 이름, 항목, 값, 출처, 문서 제목, 받은 날짜)
                      게임에 쓸 일이 없는 긴 글 항목(LONG_ITEMS)은 저장소 밖 ~/kbo-gm-raw/정리/인적사항_긴글.csv로 (같은 열)
  인적사항_차이.csv   우리 값이 있는데 위키·나무 값이 다른 것 (자동 반영 안 함, 짝 확인용)
  기록_채움후보.csv   우리 시즌 기록에 있는 행의 빈 칸을 위키·나무 값으로 채울 후보 (한 구단 줄만)
  기록_차이.csv       우리 값과 다른 칸 (비슷해도 모두) — 자동 반영 금지, 사용자 확인용.
                      시즌 중 이적 합산 줄('롯데/kt')은 우리 구단별 행의 합과 견준다 (계보 열 '롯데+KT')
  기록_빠진행.csv     우리 자료에 행이 없는 위키 표 행과 그 분류 (정말 빠짐·구단 나눔·투타 다름·동명이인 표 …)
                      → tools/wiki/missing_report.py가 reports/wiki-missing-rows.md로
  기록_뺀행.csv       견주지 않고 뺀 위키 표 행 수 (해외 리그·KBO 출범 전·동명이인 표 …)
  출처.csv            쓴 문서 목록 (출처, 문서 제목, 주소, 판, 받은 날짜, 라이선스)
쓰는 것 (저장소 밖): ~/kbo-gm-raw/정리/선수/<선수ID>_<이름>.md — 서술 요점 노트
마지막 줄에 요약 (짝 수, 받은 문서 수, 채운 칸 수, 차이 칸 수, 걸러 낸 서술 수).
public/data/·build_data.py·게임 코드는 건드리지 않는다 (게임 반영은 사용자 확인 뒤).
"""
import json
import re
import sys
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import namumd as N  # noqa: E402

LICENSE = {
    '위키백과': 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/deed.ko)',
    '위키데이터': 'CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/deed.ko)',
    '나무위키': 'CC BY-NC-SA 2.0 KR (https://creativecommons.org/licenses/by-nc-sa/2.0/kr/)',
}
SRC_NAME = {'wiki': '위키백과', 'namu': '나무위키', 'wikidata': '위키데이터'}
FIELD_KO = {
    'g': '경기', 'pa': '타석', 'ab': '타수', 'r': '득점', 'h': '안타', 'd': '2루타', 't': '3루타', 'hr': '홈런', 'rbi': '타점',
    'sb': '도루', 'cs': '도루실패', 'bb': '볼넷', 'hbp': '몸에 맞는 공', 'so': '삼진', 'gdp': '병살타', 'sf': '희생플라이',
    'sac': '희생번트', 'gs': '선발', 'w': '승', 'l': '패', 'sv': '세이브', 'hld': '홀드', 'outs': '아웃(이닝×3)',
    'tbf': '상대 타자', 'er': '자책점',
}
PIT_KO = {'r': '실점', 'h': '피안타', 'hr': '피홈런', 'so': '탈삼진'}
# 위키·나무에서 뽑는 인적 사항 항목 (이 순서로 쓴다)
ITEMS = ['생년월일', '사망일', '출신지', '국적', '키', '몸무게', '투', '타', '언더핸드', '포지션', '포지션 코드', '입단 연도',
         '드래프트', '프로 입단', '첫 출장', '마지막 경기', '소속팀', '병역', '출신 학교', '연봉', '계약', '등번호', '지도자', '응원가']
# 세부 포지션을 위키로 채우는 선수: 1군 마지막 해가 이 해까지인 야수 (2026-10-23 빈 자료 결정 3).
# 그 뒤에도 뛴 야수는 '세부 포지션(위키)' 칸으로만 남긴다 (수비 기록으로 정하는 능력치 v2 16-3a 몫)
POS_FILL_UNTIL = 2000
POS_GROUP = {'1B': 'IF', '2B': 'IF', '3B': 'IF', 'SS': 'IF', 'LF': 'OF', 'CF': 'OF', 'RF': 'OF'}
HOLD_FROM = 2000  # KBO 홀드 공식 기록 시작 (자료집 제도연표 기준으로 확인 필요, 2000년 이전 값은 견주지 않음)
UNIT = {'Q174728': 1, 'Q11573': 100, 'Q218593': 2.54, 'Q11570': 1, 'Q100995': 0.45359237}


def ours_profile(players, master, military):
    """우리 자료의 인적 사항 {선수ID: {항목: 값}} — 빈 것은 넣지 않는다"""
    out = {}
    for p in players:
        m = master.get(p['id'], {})
        o = {}
        if m.get('birth'):
            o['생년월일'] = str(m['birth'])[:10]
        hw = m.get('hw') or ''
        mm = re.search(r'(\d{3})\s*cm', hw)
        if mm:
            o['키'] = int(mm.group(1))
        mm = re.search(r'(\d{2,3})\s*kg', hw)
        if mm:
            o['몸무게'] = int(mm.group(1))
        if p.get('throws'):
            o['투'] = p['throws']
        if p.get('bats'):
            o['타'] = p['bats']
        if p.get('underhand'):
            o['언더핸드'] = '예'
        if p.get('pos') and p['pos'] not in ('IF', 'OF'):
            o['포지션 코드'] = p['pos']
        if p.get('foreign') is not None:
            o['국적'] = '외국' if p['foreign'] else '대한민국'
        if p['id'] in military:
            o['병역'] = json.dumps(military[p['id']], ensure_ascii=False)
        if p.get('school'):
            o['출신 학교'] = p['school']
        if p.get('entryExact'):
            o['입단 연도'] = p['entryExact']
        out[p['id']] = o
    return out


def same(item, ours, theirs):
    """우리 값과 같다고 볼지 (형식 차이만 있는 것)"""
    if item == '국적':
        korean = '대한민국' in str(theirs) or '한국' == str(theirs)
        return (ours == '대한민국') == korean
    if item in ('포지션 코드', '병역', '출신 학교', '입단 연도'):
        # 형식이 다르거나(병역·학교) 위키 목록 순서가 주 포지션이 아니라서(포지션) 견주지 않고 빈 칸 채우기만 한다
        return True  # 형식이 달라 견주지 않고 빈 칸 채우기만 한다
    return str(ours) == str(theirs)


def wikidata_body():
    f = C.RAW_WIKI / 'sparql' / 'body.json'
    out = {}
    if not f.exists():
        return out
    d = json.loads(f.read_text(encoding='utf-8'))
    for r in d['rows']:
        q = r['item'].rsplit('/', 1)[-1]
        o = out.setdefault(q, {})
        if r.get('h') and r.get('hu', '').rsplit('/', 1)[-1] in UNIT:
            o.setdefault('키', round(float(r['h']) * UNIT[r['hu'].rsplit('/', 1)[-1]]))
        if r.get('w') and r.get('wu', '').rsplit('/', 1)[-1] in UNIT:
            o.setdefault('몸무게', round(float(r['w']) * UNIT[r['wu'].rsplit('/', 1)[-1]]))
        if r.get('handLabel'):
            o.setdefault('투타(위키데이터)', r['handLabel'])
    out['_fetched'] = d.get('fetched')
    return out


def our_season_rows(seasons):
    """(선수ID, 연도, 계보, 'bat'|'pit') → {항목: 값} (같은 계보 여러 행이면 더한다)"""
    out = {}
    for y, s in seasons.items():
        fr = {t['name']: t['franchise'] for t in s['teams']}
        for kind, fk in (('bat', 'batFields'), ('pit', 'pitFields')):
            f = s[fk]
            for r in s[kind]:
                key = (r[0], y, fr.get(r[1], r[1]), kind)
                row = dict(zip(f, r))
                cur = out.get(key)
                if cur is None:
                    out[key] = {k: v for k, v in row.items() if k not in ('id', 'team', 'pos', 'role', 'posSrc', 'gmli')}
                else:
                    for k, v in row.items():
                        if k in cur and isinstance(v, (int, float)) and isinstance(cur[k], (int, float)):
                            cur[k] += v
                        elif k in cur and v is None:
                            cur[k] = None
    return out


# 빠진 행 후보 (기록_빠진행.csv). 우리 자료에 그 선수·해·계보 행이 없는 위키 표 행을 가른다 (2026-10-23 하네스 고침)
MISS_HEAD = ['선수ID', '이름', '연도', '구단', '구분', '계보', '분류', '출처', '우리 그 해', '위키 기록', '칸']
REALLY_MISSING = ('정말 빠짐: 두 위키 모두', '정말 빠짐: 한 위키만 (다른 위키 표 없음)', '정말 빠짐: 이적 전·후 구단 행')
# 그 해 합이 같은지 볼 항목 (둘 이상 있어야 견준다)
MATCH_KEYS = {'bat': ('g', 'ab', 'h', 'hr', 'pa'), 'pit': ('g', 'outs', 'w', 'l', 'so')}
NAMESAKE_MIN_ROWS = 3      # 이 이상 해가 있는 표에서
NAMESAKE_MAX_MATCH = 0.5   # 우리 1군 해와 겹치는 몫이 이보다 작으면 동명이인 표로 본다 (임시값)


# 구단 이름을 쓴 해 (빠진 행 후보의 구단 글이 그 해와 안 맞으면 의심으로 돌린다. 앞뒤 한 해는 봐준다)
NAME_YEARS = {
    'MBC': (1982, 1989), 'LG': (1990, 2026), 'OB': (1982, 1998), '두산': (1999, 2026), '해태': (1982, 2001), 'KIA': (2001, 2026),
    '기아': (2001, 2026), '삼미': (1982, 1985), '청보': (1985, 1987), '태평양': (1988, 1995), '현대': (1996, 2007),
    '빙그레': (1986, 1993), '한화': (1994, 2026), '쌍방울': (1991, 1999), 'SK': (2000, 2020), 'SSG': (2021, 2026),
    '우리': (2008, 2008), '히어로즈': (2008, 2026), '넥센': (2010, 2018), '키움': (2019, 2026), 'NC': (2013, 2026), 'KT': (2015, 2026),
    '삼성': (1982, 2026), '롯데': (1982, 2026),
}


def name_fits_year(team, y):
    words = [w.upper() if w.upper() in NAME_YEARS else w for w in re.split(r'[\s/,·→\-–~～()\[\]]+', team or '')]
    known = [NAME_YEARS[w] for w in words if w in NAME_YEARS]
    return not known or any(a - 1 <= y <= b + 1 for a, b in known)


def add_fields(rows):
    """값 사전 여러 개의 합. 하나라도 빈(None) 항목은 None"""
    out = {}
    for r in rows:
        for k, v in r.items():
            if not isinstance(v, (int, float)) and v is not None:
                continue
            if k not in out:
                out[k] = v
            elif out[k] is None or v is None:
                out[k] = None
            else:
                out[k] += v
    return out


def same_total(a, b, kind):
    ks = [k for k in MATCH_KEYS[kind] if a.get(k) is not None and b.get(k) is not None]
    return len(ks) >= 2 and all(a[k] == b[k] for k in ks)


def minus(a, b):
    return {k: v - (b.get(k) or 0) for k, v in a.items() if isinstance(v, (int, float))}


def brief(kind, f):
    """빠진 행 목록에 보일 짧은 기록"""
    if kind == 'pit':
        ip = '' if f.get('outs') is None else f"{f['outs'] // 3}{['', '⅓', '⅔'][f['outs'] % 3]}"
        parts = [('경기', f.get('g')), ('이닝', ip or None), ('승', f.get('w')), ('패', f.get('l')), ('세', f.get('sv'))]
    else:
        parts = [('경기', f.get('g')), ('타석', f.get('pa')), ('타수', f.get('ab')), ('안타', f.get('h')), ('홈런', f.get('hr'))]
    return ' · '.join(f'{k} {v}' for k, v in parts if v is not None)


def compare_seasons(pid, name, exs, our_by_year, our_years, fill_rows, diff_rows, miss_rows, dropped):
    """위키 시즌 표 행을 우리 행과 견줘 채움 후보·차이·빠진 행 후보로 나눈다. 해(연도·타자/투수)마다, 출처마다:
    1. 표의 줄이 모두 우리 구단 행에 맞으면(시즌 중 이적 합산 줄 '롯데/kt'는 우리 구단별 행의 합) 줄마다 견준다.
    2. 아니어도 그 해 합이 우리 그 해 합과 같으면(우리가 이적한 해를 한 구단 행에 합쳐 두었거나 구단 표기가 다름)
       그 해 합끼리 견준다 ('구단 표기·나눔만 다름'으로도 남긴다).
    3. 남은 줄은 빠진 행 후보로 가른다.
    빈 칸 채우기는 우리 한 구단 행에 맞는 것만 (합산 줄의 빈 칸은 어느 구단 몫인지 몰라 안 채움).
    표 전체가 우리 1군 해와 거의 겹치지 않으면 동명이인 표로 보고 견주지 않는다."""
    src_rows = {}
    for src in ('wiki', 'namu'):
        rows = exs.get(src, {}).get('seasons', [])
        years = {r['year'] for r in rows}
        if len(years) >= NAMESAKE_MIN_ROWS and len(years & our_years) / len(years) < NAMESAKE_MAX_MATCH:
            dropped[f'{SRC_NAME[src]} 동명이인 의심 표'] += len(rows)
            seen = set()
            for r in rows:
                if r['year'] in our_years or (r['year'], r['kind']) in seen:
                    continue
                seen.add((r['year'], r['kind']))
                miss_rows.append([pid, name, r['year'], r['team'], '투수' if r['kind'] == 'pit' else '타자', '+'.join(r['franchises']),
                                  '동명이인 의심 표 (견주지 않음)', f"{SRC_NAME[src]}: {exs[src]['title']}", '', brief(r['kind'], r['fields']),
                                  len(r['fields'])])
            continue
        by = {}
        for r in rows:
            d = by.setdefault((r['year'], r['kind']), {})
            d.setdefault(tuple(r['franchises']), r)  # 같은 표가 두 번 나오면 앞의 것
        src_rows[src] = by
    kinds_of = {src: {k[1] for k in by} for src, by in src_rows.items()}

    for (y, kind) in sorted({k for by in src_rows.values() for k in by}):
        ko = '투수' if kind == 'pit' else '타자'
        ours = our_by_year.get((pid, y, kind), {})
        our_total = add_fields(list(ours.values())) if ours else {}
        cmp = {}       # 우리 계보 묶음 → 출처 → (구단 글, 값)
        left = {}      # 출처 → 남은 줄 [행]
        split = []     # 구단 표기·나눔만 다른 출처
        for src, by in src_rows.items():
            rows = list(by.get((y, kind), {}).values())
            if not rows:
                continue
            used = [fr for r in rows for fr in r['franchises']]
            if all(fr in ours for fr in used) and len(used) == len(set(used)):
                for r in rows:
                    cmp.setdefault(tuple(r['franchises']), {})[src] = (r['team'], r['fields'])
            elif ours and same_total(add_fields([r['fields'] for r in rows]), our_total, kind):
                cmp.setdefault(tuple(ours), {})[src] = (' + '.join(r['team'] for r in rows), add_fields([r['fields'] for r in rows]))
                split.append(src)
            else:
                for r in rows:
                    if all(fr in ours for fr in r['franchises']):
                        cmp.setdefault(tuple(r['franchises']), {})[src] = (r['team'], r['fields'])
                    else:
                        left.setdefault(src, []).append(r)
        if split:
            team, fields = cmp[tuple(ours)][split[0]]
            miss_rows.append([pid, name, y, team, ko, '+'.join(ours), '구단 표기·나눔만 다름 (그 해 합이 같음)',
                              ' · '.join(SRC_NAME[s] for s in split), ', '.join(f'{fr} {brief(kind, v)}' for fr, v in ours.items()),
                              brief(kind, fields), 0])
        for frs, got in cmp.items():
            mine = add_fields([ours[fr] for fr in frs])
            team = (got.get('wiki') or got.get('namu'))[0]
            wf = got.get('wiki', (None, {}))[1]
            nf = got.get('namu', (None, {}))[1]
            for k in dict.fromkeys(list(wf) + list(nf)):
                if k == 'hld' and y < HOLD_FROM:
                    continue  # 홀드 기록이 없던 해 (위키 표의 0·빈칸은 채우지 않는다)
                wv, nv = wf.get(k), nf.get(k)
                if wv is None and nv is None:
                    continue
                label = (PIT_KO.get(k) if kind == 'pit' else None) or FIELD_KO.get(k, k)
                base = [pid, name, y, team, ko, label]
                if mine.get(k) is None:
                    if len(frs) == 1:
                        pick, ps = (wv, '위키백과') if wv is not None else (nv, '나무위키')
                        fill_rows.append(base + ['', '' if wv is None else wv, '' if nv is None else nv, pick, ps, frs[0]])
                    else:
                        dropped['합산 줄의 빈 칸 (어느 구단 몫인지 몰라 안 채움)'] += 1
                elif (wv is not None and wv != mine[k]) or (nv is not None and nv != mine[k]):
                    diff_rows.append(base + [mine[k], '' if wv is None else wv, '' if nv is None else nv, '+'.join(frs)])

        missing_year = {}  # 출처 → 행 (우리 그 해 기록이 아예 없는 것)
        for src, rows in left.items():
            for r in rows:
                fr_txt = '+'.join(r['franchises'])
                if ours:
                    # 그 해 우리 행이 다른 구단에만 있다
                    src_total = add_fields([x['fields'] for x in src_rows[src][(y, kind)].values()])
                    cls = ('정말 빠짐: 이적 전·후 구단 행' if same_total(minus(src_total, r['fields']), our_total, kind)
                           else '의심: 그 해 구단·값이 모두 다름')
                    miss_rows.append([pid, name, y, r['team'], ko, fr_txt, cls, SRC_NAME[src],
                                      ', '.join(f'{fr} {brief(kind, v)}' for fr, v in ours.items()), brief(kind, r['fields']), len(r['fields'])])
                    continue
                other = our_by_year.get((pid, y, 'bat' if kind == 'pit' else 'pit'))
                if other:
                    miss_rows.append([pid, name, y, r['team'], ko, fr_txt, '투타 다름 (우리는 그 해 다른 쪽 기록만)', SRC_NAME[src],
                                      ', '.join(f'{fr} {"타자" if kind == "pit" else "투수"}' for fr in other), brief(kind, r['fields']),
                                      len(r['fields'])])
                    continue
                missing_year.setdefault(src, r)
        if missing_year:
            first = missing_year.get('wiki') or missing_year.get('namu')
            if not all(name_fits_year(r['team'], y) for r in missing_year.values()):
                cls = '의심: 그 해에 없던 구단 이름'
            elif len(missing_year) == 2:
                cls = '정말 빠짐: 두 위키 모두'
            else:
                other = 'namu' if 'wiki' in missing_year else 'wiki'
                cls = '의심: 다른 위키 표에는 그 해가 없음' if kind in kinds_of.get(other, ()) else '정말 빠짐: 한 위키만 (다른 위키 표 없음)'
            miss_rows.append([pid, name, y, first['team'], ko, '+'.join(first['franchises']), cls,
                              ' · '.join(SRC_NAME[s] for s in missing_year), '', brief(kind, first['fields']), len(first['fields'])])


def page_url(src, title):
    if src == 'wiki':
        return 'https://ko.wikipedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_'))
    return N.source_url(title)


# 인적 사항 중 게임 자료에 칸이 없고 글이 긴 항목: 저장소에 올리지 않고 정리 폴더에 둔다 (2026-10-23 카드).
# 출신 학교(고졸·대졸)·입단 연도·키·몸무게처럼 게임이 쓸 수 있는 것은 인적사항.csv에 남긴다.
LONG_ITEMS = {'소속팀', '첫 출장', '마지막 경기', '지도자', '출신지', '응원가', '연봉', '계약', '드래프트', '프로 입단'}


def write_note(note_dir, p, exs):
    safe = re.sub(r'[\\/:*?"<>|]', '_', p['name'])
    f = note_dir / '선수' / f'{p["id"]}_{safe}.md'
    f.parent.mkdir(parents=True, exist_ok=True)
    lines = [f'# {p["name"]} ({p["id"]}) 서술 요점', '',
             '> 원문 요점 발췌(자동, 절마다 앞 두 문장 안팎). 저장소에 올리지 않는다. 실존 선수 금지 사건이 든 절·문장은 뺐다.', '']
    for ex in exs:
        src = SRC_NAME[ex['source']]
        lines += [f'## {src}: {ex["title"]}', '',
                  f'- 출처: {page_url(ex["source"], ex["title"])}',
                  f'- 판: {ex.get("revid") or ""} · 받은 날짜: {ex.get("fetched") or ""} · 라이선스: {LICENSE[src]}',
                  f'- 걸러 낸 절 {ex["cut_sections"]} · 문장 {ex["cut_sentences"]}', '']
        for title, summary in ex['narrative']:
            lines.append(f'- **{title}**: {summary}')
        lines.append('')
    f.write_text('\n'.join(lines), encoding='utf-8')


def main():
    C.stdout_utf8()
    sample = '--sample' in sys.argv
    out_dir, note_dir = C.out_paths(sample)
    ex_dir = note_dir / '추출'
    C.log('[5단계] 위키 값을 넣지 않은 기반 자료 만드는 중 (build_data.py --no-wiki)…')
    base = C.build_base_data()
    players = C.load_players(base)
    if sample:
        ids = set(C.sample_ids())
        players = [p for p in players if p['id'] in ids]
    byid = {p['id']: p for p in players}
    pairs = {r['선수ID']: r for r in C.read_csv(out_dir / '짝.csv')}
    military = json.loads((base / 'military.json').read_text(encoding='utf-8'))['players']
    C.log('[5단계] 합치기: 자료집 선수마스터 읽는 중…')
    ours = ours_profile(players, C.load_master_extra(), military)
    seasons = C.load_seasons(base)
    our_by_year = defaultdict(dict)  # (선수, 연도, 종류) → {계보: 값}
    our_years = defaultdict(set)     # 선수 → 1군 기록이 있는 해
    for (opid, y, fr, kind), v in our_season_rows(seasons).items():
        our_by_year[(opid, y, kind)][fr] = v
        our_years[opid].add(y)
    dropped = Counter()  # 견주지 않고 뺀 위키 표 행 (까닭 → 행 수)
    wd = wikidata_body()

    # 정리 노트는 다시 만든다 (거르기 목록이 바뀌면 지난 노트에 걸러야 할 글이 남아 있을 수 있다)
    for f in (note_dir / '선수').glob('*.md'):
        f.unlink()
    prof_rows, prof_diff, fill_rows, diff_rows, src_rows, miss_rows = [], [], [], [], [], []
    cut_sec = cut_sent = 0
    docs = {'wiki': 0, 'namu': 0}
    for pid, pr in pairs.items():
        p = byid.get(pid)
        if not p:
            continue
        exs = {}
        for src in ('wiki', 'namu'):
            f = ex_dir / src / f'{pid}.json'
            if f.exists():
                exs[src] = json.loads(f.read_text(encoding='utf-8'))
                docs[src] += 1
        q = pr.get('위키데이터')
        if q and q in wd:
            exs['wikidata'] = {'source': 'wikidata', 'title': q, 'fetched': wd.get('_fetched'), 'profile': wd[q], 'seasons': []}
        for src, ex in exs.items():
            for why, n in ex.get('dropped_rows', {}).items():
                dropped[f'{SRC_NAME[src]} {why}'] += n
            name = SRC_NAME[src]
            url = page_url(src, ex['title']) if src != 'wikidata' else f'https://www.wikidata.org/wiki/{q}'
            src_rows.append([pid, p['name'], name, ex['title'], url, ex.get('revid') or '', ex.get('fetched') or '', LICENSE[name]])
            cut_sec += ex.get('cut_sections', 0)
            cut_sent += ex.get('cut_sentences', 0)

        # 인적 사항: 위키백과 > 위키데이터 > 나무위키
        o = ours.get(pid, {})
        order = [s for s in ('wiki', 'wikidata', 'namu') if s in exs]
        for item in ITEMS:
            vals = {s: exs[s]['profile'][item] for s in order if exs[s]['profile'].get(item) not in (None, '')}
            if not vals:
                continue
            if item == '포지션 코드':
                # 출처 중 가장 자세한 값 (나무위키 '좌익수'가 위키백과 '외야수'보다 앞), 같으면 신뢰 순서
                s = next((s for s in order if vals.get(s) not in (None, 'IF', 'OF')), None) or next(s for s in order if s in vals)
                if vals[s] != 'P' and max(our_years.get(pid, {0})) > POS_FILL_UNTIL:
                    # 2001년 뒤에도 뛴 야수는 위키로 채우지 않고 칸으로만 남긴다 (수비 기록으로 정한다)
                    prof_rows.append([pid, p['name'], '세부 포지션(위키)', vals[s], SRC_NAME[s], exs[s]['title'], exs[s].get('fetched') or ''])
                    if not p.get('pos'):
                        # 포지션이 아예 빈 선수는 큰 갈래(C·IF·OF·DH)만 채운다
                        prof_rows.append([pid, p['name'], item, POS_GROUP.get(vals[s], vals[s]), SRC_NAME[s], exs[s]['title'],
                                          exs[s].get('fetched') or ''])
                    continue
                if item not in o:
                    prof_rows.append([pid, p['name'], item, vals[s], SRC_NAME[s], exs[s]['title'], exs[s].get('fetched') or ''])
                continue
            if item in o:
                bad = {s: v for s, v in vals.items() if not same(item, o[item], v)}
                if bad:
                    prof_diff.append([pid, p['name'], item, o[item], vals.get('wiki', ''), vals.get('wikidata', ''), vals.get('namu', '')])
                continue
            s = order[[s in vals for s in order].index(True)]
            prof_rows.append([pid, p['name'], item, vals[s], SRC_NAME[s], exs[s]['title'], exs[s].get('fetched') or ''])

        # 시즌 기록: 칸마다 우리 값과 견준다 (빠진 행은 따로 가른다)
        compare_seasons(pid, p['name'], exs, our_by_year, our_years.get(pid, set()), fill_rows, diff_rows, miss_rows, dropped)

        narr = [exs[s] for s in ('wiki', 'namu') if s in exs and exs[s].get('narrative')]
        if narr:
            write_note(note_dir, p, narr)

    prof_head = ['선수ID', '이름', '항목', '값', '출처', '문서 제목', '받은 날짜']
    C.write_csv(out_dir / '인적사항.csv', prof_head, [r for r in prof_rows if r[2] not in LONG_ITEMS])
    C.write_csv(note_dir / '인적사항_긴글.csv', prof_head, [r for r in prof_rows if r[2] in LONG_ITEMS])
    C.write_csv(out_dir / '인적사항_차이.csv', ['선수ID', '이름', '항목', '우리 값', '위키 값', '위키데이터 값', '나무 값'], prof_diff)
    C.write_csv(out_dir / '기록_채움후보.csv',
                ['선수ID', '이름', '연도', '구단', '구분', '항목', '우리 값', '위키 값', '나무 값', '채울 값', '채울 출처', '계보'], fill_rows)
    C.write_csv(out_dir / '기록_차이.csv', ['선수ID', '이름', '연도', '구단', '구분', '항목', '우리 값', '위키 값', '나무 값', '계보'], diff_rows)
    C.write_csv(out_dir / '기록_빠진행.csv', MISS_HEAD, miss_rows)
    C.write_csv(out_dir / '기록_뺀행.csv', ['까닭', '행 수'], sorted(dropped.items()))
    C.write_csv(out_dir / '출처.csv', ['선수ID', '이름', '출처', '문서 제목', '주소', '판', '받은 날짜', '라이선스'], src_rows)
    n_wiki = sum(1 for r in pairs.values() if r['위키 제목'] and r['선수ID'] in byid)
    n_namu = sum(1 for r in pairs.values() if r.get('나무위키 제목') and r['선수ID'] in byid)
    C.log(f'  → {out_dir}')
    C.log(f'[요약] 선수 {len(players)} · 짝 위키백과 {n_wiki} · 나무위키 {n_namu} · 받은 문서 위키백과 {docs["wiki"]} · 나무위키 {docs["namu"]}'
          f' · 채운 칸 인적 {len(prof_rows)} · 기록 {len(fill_rows)} · 차이 칸 인적 {len(prof_diff)} · 기록 {len(diff_rows)}'
          f' · 빠진 행 후보 {len(miss_rows)} (정말 빠짐 {sum(1 for r in miss_rows if r[6] in REALLY_MISSING)})'
          f' · 걸러 낸 서술 절 {cut_sec} · 문장 {cut_sent}')


if __name__ == '__main__':
    main()
