# -*- coding: utf-8 -*-
"""5단계: 신뢰도 순서로 합치기 — 우리 원자료 > 위키백과(+위키데이터) > 나무위키. 빈 칸만 채운다.

  python tools/wiki/s5_merge.py [--sample]

쓰는 것 (data-src/wiki/, 견본은 저장소 밖 견본 폴더):
  인적사항.csv        우리 자료가 빈 인적 사항 → 채울 값 (선수ID, 이름, 항목, 값, 출처, 문서 제목, 받은 날짜)
  인적사항_차이.csv   우리 값이 있는데 위키·나무 값이 다른 것 (자동 반영 안 함, 짝 확인용)
  기록_채움후보.csv   우리 시즌 기록의 빈 칸(또는 빈 행)을 위키·나무 값으로 채울 후보
  기록_차이.csv       우리 값과 다른 칸 (비슷해도 모두) — 자동 반영 금지, 사용자 확인용
  출처.csv            쓴 문서 목록 (출처, 문서 제목, 주소, 판, 받은 날짜, 라이선스)
쓰는 것 (저장소 밖): ~/kbo-gm-raw/정리/선수/<선수ID>_<이름>.md — 서술 요점 노트
마지막 줄에 요약 (짝 수, 받은 문서 수, 채운 칸 수, 차이 칸 수, 걸러 낸 서술 수).
public/data/·build_data.py·게임 코드는 건드리지 않는다 (게임 반영은 사용자 확인 뒤).
"""
import json
import re
import sys
import urllib.parse
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


def page_url(src, title):
    if src == 'wiki':
        return 'https://ko.wikipedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_'))
    return N.source_url(title)


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
    players = C.load_players()
    if sample:
        ids = set(C.sample_ids())
        players = [p for p in players if p['id'] in ids]
    byid = {p['id']: p for p in players}
    pairs = {r['선수ID']: r for r in C.read_csv(out_dir / '짝.csv')}
    military = json.loads((C.DATA / 'military.json').read_text(encoding='utf-8'))['players']
    C.log('[5단계] 합치기: 자료집 선수마스터 읽는 중…')
    ours = ours_profile(players, C.load_master_extra(), military)
    seasons = C.load_seasons()
    our_rows = our_season_rows(seasons)
    wd = wikidata_body()

    prof_rows, prof_diff, fill_rows, diff_rows, src_rows = [], [], [], [], []
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
            if item in o:
                bad = {s: v for s, v in vals.items() if not same(item, o[item], v)}
                if bad:
                    prof_diff.append([pid, p['name'], item, o[item], vals.get('wiki', ''), vals.get('wikidata', ''), vals.get('namu', '')])
                continue
            s = order[[s in vals for s in order].index(True)]
            prof_rows.append([pid, p['name'], item, vals[s], SRC_NAME[s], exs[s]['title'], exs[s].get('fetched') or ''])

        # 시즌 기록: 칸마다 우리 값과 견준다
        wrows = {}
        for src in ('wiki', 'namu'):
            for r in exs.get(src, {}).get('seasons', []):
                wrows.setdefault((r['year'], r['franchise'], r['kind']), {}).setdefault(src, r)
        for (y, fr, kind), got in sorted(wrows.items()):
            mine = our_rows.get((pid, y, fr, kind))
            keys = list(dict.fromkeys(k for s in ('wiki', 'namu') if s in got for k in got[s]['fields']))
            for k in keys:
                if k == 'hld' and y < HOLD_FROM:
                    continue  # 홀드 기록이 없던 해 (위키 표의 0·빈칸은 채우지 않는다)
                wv = got.get('wiki', {}).get('fields', {}).get(k)
                nv = got.get('namu', {}).get('fields', {}).get(k)
                label = (PIT_KO.get(k) if kind == 'pit' else None) or FIELD_KO.get(k, k)
                team = (got.get('wiki') or got.get('namu'))['team']
                base = [pid, p['name'], y, team, '투수' if kind == 'pit' else '타자', label]
                if mine is None or mine.get(k) is None:
                    pick, ps = (wv, '위키백과') if wv is not None else (nv, '나무위키')
                    fill_rows.append(base + ['(행 없음)' if mine is None else '', '' if wv is None else wv, '' if nv is None else nv, pick, ps])
                elif (wv is not None and wv != mine[k]) or (nv is not None and nv != mine[k]):
                    diff_rows.append(base + [mine[k], '' if wv is None else wv, '' if nv is None else nv])

        narr = [exs[s] for s in ('wiki', 'namu') if s in exs and exs[s].get('narrative')]
        if narr:
            write_note(note_dir, p, narr)

    C.write_csv(out_dir / '인적사항.csv', ['선수ID', '이름', '항목', '값', '출처', '문서 제목', '받은 날짜'], prof_rows)
    C.write_csv(out_dir / '인적사항_차이.csv', ['선수ID', '이름', '항목', '우리 값', '위키 값', '위키데이터 값', '나무 값'], prof_diff)
    C.write_csv(out_dir / '기록_채움후보.csv',
                ['선수ID', '이름', '연도', '구단', '구분', '항목', '우리 값', '위키 값', '나무 값', '채울 값', '채울 출처'], fill_rows)
    C.write_csv(out_dir / '기록_차이.csv', ['선수ID', '이름', '연도', '구단', '구분', '항목', '우리 값', '위키 값', '나무 값'], diff_rows)
    C.write_csv(out_dir / '출처.csv', ['선수ID', '이름', '출처', '문서 제목', '주소', '판', '받은 날짜', '라이선스'], src_rows)
    n_wiki = sum(1 for r in pairs.values() if r['위키 제목'] and r['선수ID'] in byid)
    n_namu = sum(1 for r in pairs.values() if r.get('나무위키 제목') and r['선수ID'] in byid)
    C.log(f'  → {out_dir}')
    C.log(f'[요약] 선수 {len(players)} · 짝 위키백과 {n_wiki} · 나무위키 {n_namu} · 받은 문서 위키백과 {docs["wiki"]} · 나무위키 {docs["namu"]}'
          f' · 채운 칸 인적 {len(prof_rows)} · 기록 {len(fill_rows)} · 차이 칸 인적 {len(prof_diff)} · 기록 {len(diff_rows)}'
          f' · 걸러 낸 서술 절 {cut_sec} · 문장 {cut_sent}')


if __name__ == '__main__':
    main()
