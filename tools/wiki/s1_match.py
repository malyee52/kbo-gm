# -*- coding: utf-8 -*-
"""1단계: 우리 선수 ↔ 한국어 위키백과 문서 짝 맞추기.

  python tools/wiki/s1_match.py            전체 (3,626명)
  python tools/wiki/s1_match.py --sample   견본 (tools/wiki/sample_ids.txt), 결과는 저장소 밖 견본 폴더

가) 위키데이터 SPARQL 4개로 야구 관련 사람의 QID·한국어 문서 제목·생년월일·국적·KBO 소속팀을 받는다 (CC0).
나) 이름이 같은 후보 중 생년·구단·연도가 맞는 것을 고른다.
다) 못 찾은 선수는 한국어 위키백과에서 제목을 직접 찾아본다 ('이름', '이름 (야구 선수)', '이름 (야구인)', '이름 (19xx년)',
    동음이의 문서면 그 안의 야구 쪽 링크). 받은 원문은 캐시에 남아 2단계가 다시 받지 않는다.
결과: data-src/wiki/짝.csv (선수ID, 이름, 위키 제목, 위키데이터, 나무위키 제목, 근거, 점수)
      ~/kbo-gm-raw/정리/짝_애매.csv (선수ID, 이름, 후보, 사유) — 애매하면 버리고 여기에만 남긴다.
나무위키 제목은 3단계(s3_namu.py)가 채운다.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import wikitext as W  # noqa: E402

KBO = 'wd:Q625168'
SPARQL_Q = {
    # 야구 선수이거나 KBO와 이어진 사람 중 한국어 문서가 있는 사람
    'people': f"""
SELECT ?item ?title ?birth WHERE {{
  {{ ?item wdt:P106 wd:Q10871364 }} UNION {{ ?item wdt:P118 {KBO} }} UNION {{ ?item wdt:P54 ?tm . ?tm wdt:P118 {KBO} }}
  ?item wdt:P31 wd:Q5 .
  ?article schema:about ?item ; schema:isPartOf <https://ko.wikipedia.org/> ; schema:name ?title .
  OPTIONAL {{ ?item wdt:P569 ?birth }}
}}""",
    'nationality': f"""
SELECT ?item ?natLabel WHERE {{
  {{ ?item wdt:P106 wd:Q10871364 }} UNION {{ ?item wdt:P118 {KBO} }} UNION {{ ?item wdt:P54 ?tm . ?tm wdt:P118 {KBO} }}
  ?item wdt:P31 wd:Q5 ; wdt:P27 ?nat .
  ?article schema:about ?item ; schema:isPartOf <https://ko.wikipedia.org/> .
  ?nat rdfs:label ?natLabel . FILTER(lang(?natLabel) = 'ko')
}}""",
    'teams': f"""
SELECT ?item ?teamLabel ?start ?end WHERE {{
  ?item p:P54 ?st . ?st ps:P54 ?team . ?team wdt:P118 {KBO} .
  OPTIONAL {{ ?st pq:P580 ?start }} OPTIONAL {{ ?st pq:P582 ?end }}
  ?team rdfs:label ?teamLabel . FILTER(lang(?teamLabel) = 'ko')
}}""",
    # 키(P2048)·몸무게(P2067)·투타(P741): 있는 만큼 (단위 그대로, 5단계에서 cm·kg로)
    'body': f"""
SELECT DISTINCT ?item ?h ?hu ?w ?wu ?handLabel WHERE {{
  ?item wdt:P54 ?tm . ?tm wdt:P118 {KBO} .
  OPTIONAL {{ ?item p:P2048/psv:P2048 [ wikibase:quantityAmount ?h ; wikibase:quantityUnit ?hu ] }}
  OPTIONAL {{ ?item p:P2067/psv:P2067 [ wikibase:quantityAmount ?w ; wikibase:quantityUnit ?wu ] }}
  OPTIONAL {{ ?item wdt:P741 ?hand . ?hand rdfs:label ?handLabel . FILTER(lang(?handLabel) = 'ko') }}
  FILTER(BOUND(?h) || BOUND(?w) || BOUND(?handLabel))
}}""",
}


def sparql(http, name, refresh=False):
    f = C.RAW_WIKI / 'sparql' / f'{name}.json'
    f.parent.mkdir(parents=True, exist_ok=True)
    if f.exists() and not refresh:
        return json.loads(f.read_text(encoding='utf-8'))
    C.log(f'  위키데이터 질의: {name}')
    d = http.get(C.SPARQL, {'query': SPARQL_Q[name], 'format': 'json'}, post=True)
    rows = [{k: v['value'] for k, v in b.items()} for b in d['results']['bindings']]
    f.write_text(json.dumps({'fetched': C.TODAY, 'rows': rows}, ensure_ascii=False), encoding='utf-8')
    return {'fetched': C.TODAY, 'rows': rows}


def qid(uri):
    return uri.rsplit('/', 1)[-1]


def year_of(s):
    m = re.match(r'(\d{4})', s or '')
    return int(m.group(1)) if m else None


def wiki_people(http, refresh):
    people = {}
    for r in sparql(http, 'people', refresh)['rows']:
        q = qid(r['item'])
        p = people.setdefault(q, {'qid': q, 'title': r['title'], 'births': set(), 'nat': set(), 'teams': []})
        if r.get('birth'):
            y = year_of(r['birth'])
            if y:
                p['births'].add(y)
    for r in sparql(http, 'nationality', refresh)['rows']:
        p = people.get(qid(r['item']))
        if p:
            p['nat'].add(r['natLabel'])
    for r in sparql(http, 'teams', refresh)['rows']:
        p = people.get(qid(r['item']))
        if p:
            p['teams'].append((C.franchise_of(r['teamLabel']), year_of(r.get('start')), year_of(r.get('end'))))
    sparql(http, 'body', refresh)  # 5단계에서 쓴다 (캐시만)
    return people


def name_keys(title, foreign):
    base = C.strip_paren(title)
    keys = {base, base.replace(' ', '')}
    if foreign:
        keys |= {t for t in re.split(r'[\s·\-]+', base) if len(t) >= 2}
    return keys


def team_score(stints, teams):
    """우리 (연도, 계보) 기록과 위키 소속팀이 겹치는 정도: 연도까지 겹치면 3, 구단만 2, 없으면 0"""
    ours = {f for _, f in stints}
    best = 0
    for f, a, b in teams:
        if f not in ours:
            continue
        best = max(best, 2)
        if a or b:
            lo, hi = a or 1982, b or 2100
            if any(fr == f and lo <= y <= hi for y, fr in stints):
                return 3
    return best


def evaluate(p, stints, cand_birth, cand_teams, foreign_ok=True):
    """점수와 근거. 생년이 다르면 None"""
    why = []
    score = 0
    by = p.get('birthYear')
    if by and cand_birth:
        if by not in cand_birth:
            return None, '생년 다름'
        score += 3
        why.append('생년')
    ts = team_score(stints, cand_teams)
    if ts:
        score += ts
        why.append('구단·연도' if ts == 3 else '구단')
    if not foreign_ok:
        return None, '국적 다름'
    return score, '+'.join(why)


def match_wikidata(players, stints, people):
    index = defaultdict(set)
    for q, w in people.items():
        foreignish = bool(w['nat']) and not (w['nat'] & {'대한민국', '조선민주주의인민공화국'})
        for k in name_keys(w['title'], True):
            # 띄어쓰기로 나눈 조각은 외국 이름일 때만
            if k == C.strip_paren(w['title']) or k == C.strip_paren(w['title']).replace(' ', '') or foreignish:
                index[k].add(q)
    picks = {}
    amb = []
    leftover = {}  # 근거가 모자란 후보 제목 → 제목 탐색에서 본문으로 다시 본다
    for p in players:
        cands = index.get(p['name'], set())
        scored = []
        for q in cands:
            w = people[q]
            whole = C.strip_paren(w['title']).replace(' ', '') == p['name']
            korean = bool(w['nat'] & {'대한민국'})
            if p.get('foreign') and korean and not whole:
                continue
            s, why = evaluate(p, stints.get(p['id'], set()), w['births'], w['teams'])
            if s is None:
                continue
            if not whole:
                # 외국인 이름 조각만 맞은 경우는 구단이 맞아야 한다 (아니면 본문으로 다시 본다)
                if team_score(stints.get(p['id'], set()), w['teams']) == 0:
                    leftover.setdefault(p['id'], []).append(w['title'])
                    continue
                why += '+이름 조각'
            scored.append((s, q, why))
        scored.sort(reverse=True)
        if not scored:
            continue
        if scored[0][0] < 3:
            leftover.setdefault(p['id'], []).extend(people[q]['title'] for _, q, _ in scored)
            continue
        if len(scored) > 1 and scored[1][0] == scored[0][0]:
            amb.append((p['id'], p['name'], ' / '.join(people[q]['title'] for _, q, _ in scored[:4]), '같은 점수 후보 여럿'))
            continue
        s, q, why = scored[0]
        picks[p['id']] = {'title': people[q]['title'], 'qid': q, 'why': '위키데이터:' + why, 'score': s}
    return picks, amb, leftover


# ---- 제목 탐색

def page_evidence(p, stints, rec):
    """받은 문서가 이 선수인지: (점수, 근거) 또는 (None, 사유)"""
    if rec.get('missing') or not rec.get('content'):
        return None, '문서 없음'
    if rec.get('disambig'):
        return None, '동음이의'
    text = rec['content']
    name, box = W.infobox(text)
    if not re.search(r'야구|KBO', (name or '') + text[:3000]):
        return None, '야구 문서 아님'
    birth = None
    m = re.search(r'(\d{4})-\d{2}-\d{2}', W.clean(box.get('생년월일', '')))
    if m:
        birth = {int(m.group(1))}
    else:
        m = re.search(r'\[\[분류:(\d{4})년 출생\]\]', text)
        birth = {int(m.group(1))} if m else set()
    teams = []
    for m in re.finditer(r'\*\s*(.+?)\((\d{4})년\s*(?:~\s*(\d{4})?년?)?', W.clean(box.get('경력', '')) or ''):
        f = C.franchise_of(m.group(1))
        if f:
            teams.append((f, int(m.group(2)), int(m.group(3)) if m.group(3) else None))
    if not teams:
        years = [int(y) for k in ('첫 출장', '마지막 경기', '프로 입단 연도') for y in re.findall(r'(\d{4})년', box.get(k, ''))]
        for m in re.finditer(r'\[\[분류:(.+?) 선수\]\]', text):
            f = C.franchise_of(m.group(1))
            if f:
                teams.append((f, min(years) if years else None, max(years) if years else None))
    s, why = evaluate(p, stints, birth, teams)
    return s, ('본문:' + why) if s is not None else why


def probe_titles(p):
    n = p['name']
    t = [n, f'{n} (야구 선수)', f'{n} (야구인)']
    if p.get('birthYear'):
        t.append(f'{n} ({p["birthYear"]}년)')
    return t


def probe(http, players, stints, taken, leftover):
    want = {p['id']: list(dict.fromkeys(probe_titles(p) + leftover.get(p['id'], []))) for p in players}
    pages = C.fetch_pages(http, [t for ts in want.values() for t in ts], '제목 탐색')
    # 동음이의 문서 안의 야구 쪽 링크도 후보로
    extra = {}
    for p in players:
        for t in want[p['id']]:
            rec = pages[t]
            if rec.get('disambig') and rec.get('content'):
                links = re.findall(r'\[\[([^\]|#]+)(?:\|[^\]]*)?\]\][^\n]*?(?:야구|투수|포수|내야수|외야수|타자)', rec['content'])
                extra[p['id']] = [l.strip() for l in links if C.strip_paren(l.strip()) == p['name']]
    more = [t for ts in extra.values() for t in ts if t not in pages]
    if more:
        pages.update(C.fetch_pages(http, more, '동음이의 링크'))
    picks, amb = {}, []
    for p in players:
        scored = {}
        for t in want[p['id']] + extra.get(p['id'], []):
            rec = pages.get(t)
            if not rec:
                continue
            s, why = page_evidence(p, stints.get(p['id'], set()), rec)
            if s is not None and s > 0:
                scored[rec['title']] = (s, why, rec.get('qid'))
        ranked = sorted(scored.items(), key=lambda kv: -kv[1][0])
        if not ranked:
            continue
        if ranked[0][1][0] < 3:
            amb.append((p['id'], p['name'], ' / '.join(t for t, _ in ranked), '근거 부족 (제목 탐색)'))
            continue
        if len(ranked) > 1 and ranked[1][1][0] == ranked[0][1][0]:
            amb.append((p['id'], p['name'], ' / '.join(t for t, _ in ranked[:4]), '같은 점수 후보 여럿 (제목 탐색)'))
            continue
        title, (s, why, q) = ranked[0]
        if title in taken:
            amb.append((p['id'], p['name'], title, f'이미 다른 선수({taken[title]})의 짝'))
            continue
        picks[p['id']] = {'title': title, 'qid': q or '', 'why': '제목 탐색+' + why, 'score': s}
    return picks, amb


def main():
    C.stdout_utf8()
    sample = '--sample' in sys.argv
    refresh = '--refresh-sparql' in sys.argv
    out_dir, note_dir = C.out_paths(sample)
    players = C.load_players()
    if sample:
        ids = set(C.sample_ids())
        players = [p for p in players if p['id'] in ids]
    stints = C.player_stints(C.load_seasons())
    http = C.Polite()
    C.log(f'[1단계] 짝 맞추기: 선수 {len(players)}명')
    people = wiki_people(http, refresh)
    C.log(f'  위키데이터 사람 {len(people)}명 (한국어 문서 있음)')
    picks, amb, leftover = match_wikidata(players, stints, people)
    # 한 문서가 우리 선수 둘에 걸리면 점수가 높은 쪽만, 같으면 둘 다 버린다
    by_title = defaultdict(list)
    for pid, m in picks.items():
        by_title[m['title']].append(pid)
    names = {p['id']: p['name'] for p in players}
    for t, pids in by_title.items():
        if len(pids) < 2:
            continue
        pids.sort(key=lambda x: -picks[x]['score'])
        keep = pids[0] if picks[pids[0]]['score'] > picks[pids[1]]['score'] else None
        for pid in pids:
            if pid != keep:
                amb.append((pid, names[pid], t, '한 문서에 우리 선수 여럿'))
                del picks[pid]
    C.log(f'  위키데이터로 짝 {len(picks)}명')
    rest = [p for p in players if p['id'] not in picks and p['id'] not in {a[0] for a in amb}]
    taken = {m['title']: pid for pid, m in picks.items()}
    pk2, amb2 = probe(http, rest, stints, taken, leftover)
    picks.update(pk2)
    amb += amb2
    C.log(f'  제목 탐색으로 짝 {len(pk2)}명')
    old_namu = {}
    f = out_dir / '짝.csv'
    if f.exists():
        old_namu = {r['선수ID']: (r['나무위키 제목'], r['나무 근거']) for r in C.read_csv(f)}
    rows = []
    for p in players:
        m = picks.get(p['id'])
        nt, nwhy = old_namu.get(p['id'], ('', ''))
        if m or nt:
            m = m or {'title': '', 'qid': '', 'why': '', 'score': ''}
            rows.append([p['id'], p['name'], m['title'], m['qid'], m['why'], m['score'], nt, nwhy])
    C.write_csv(f, ['선수ID', '이름', '위키 제목', '위키데이터', '위키 근거', '점수', '나무위키 제목', '나무 근거'], rows)
    amb_ids = {a[0] for a in amb}
    C.write_csv(note_dir / '짝_애매.csv', ['선수ID', '이름', '후보', '사유', '출처'],
                [list(a) + ['위키백과'] for a in amb])
    none = len(players) - len(picks) - len(amb_ids - set(picks))
    C.log(f'[1단계 끝] 선수 {len(players)} · 짝 {len(picks)} · 애매 {len(amb_ids - set(picks))} · 문서 못 찾음 {none} · 요청 {http.count}번')
    C.log(f'  → {f}')


if __name__ == '__main__':
    main()
