# -*- coding: utf-8 -*-
"""4단계: 받은 문서에서 인적 사항·시즌 기록·서술 요점을 뽑는다.

  python tools/wiki/s4_extract.py [--sample]

읽는 것: data-src/wiki/짝.csv, ~/kbo-gm-raw/wiki/pages/ (위키백과 캐시), ~/kbo-gm-raw/namuwiki/문서/ (3단계가 뽑은 나무위키 문서)
쓰는 것: ~/kbo-gm-raw/정리/추출/{wiki,namu}/<선수ID>.json — 5단계(s5_merge.py)가 합친다.
서술은 절마다 앞 두 문장 안팎(250자 이하)만 남기고, 실존 선수 금지 사건(wikitext.BANNED)이 든 절·문장은 빼고 수만 센다.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import wikitext as W  # noqa: E402

BAT = {
    '경기': 'g', '출장': 'g', '타석': 'pa', '타수': 'ab', '득점': 'r', '안타': 'h', '2루타': 'd', '3루타': 't', '홈런': 'hr',
    '타점': 'rbi', '도루': 'sb', '도실': 'cs', '도루자': 'cs', '도루실패': 'cs', '볼넷': 'bb', '4구': 'bb', '사구': 'hbp',
    '몸맞': 'hbp', '몸에맞는공': 'hbp', '삼진': 'so', '경기수': 'g', '병살': 'gdp', '병살타': 'gdp', '희플': 'sf', '희비': 'sf', '희생플라이': 'sf',
    '희타': 'sac', '희번': 'sac', '희생번트': 'sac',
}
PIT = {
    '경기': 'g', '출장': 'g', '경기수': 'g', '선발': 'gs', '승': 'w', '승리': 'w', '패': 'l', '패전': 'l', '세이브': 'sv', '세': 'sv',
    '홀드': 'hld', '홀': 'hld', '이닝': 'outs', '투구이닝': 'outs', '타자': 'tbf', '타자수': 'tbf', '상대타자': 'tbf',
    '피안타': 'h', '피홈런': 'hr', '볼넷': 'bb', '4구': 'bb', '사구': 'hbp', '몸맞': 'hbp', '탈삼진': 'so', '실점': 'r',
    '자책': 'er', '자책점': 'er',
}
POS = {
    '투수': 'P', '포수': 'C', '1루수': '1B', '2루수': '2B', '3루수': '3B', '유격수': 'SS', '좌익수': 'LF', '중견수': 'CF',
    '우익수': 'RF', '외야수': 'OF', '내야수': 'IF', '지명타자': 'DH', '지명 타자': 'DH',
}
HAND = {'좌': 'L', '우': 'R', '양': 'S'}


def outs_of(s):
    """'133 2/3', '133⅔', '133.2' → 아웃 수"""
    s = s.replace(' ', '').replace('⅓', '+1').replace('⅔', '+2')
    m = re.fullmatch(r'(\d+)(?:\+(\d)|(\d)/3|\.(\d))?', s.replace('+1/3', '+1').replace('+2/3', '+2'))
    if not m:
        return None
    frac = m.group(2) or m.group(3) or m.group(4) or '0'
    if int(frac) > 2:
        return None
    return int(m.group(1)) * 3 + int(frac)


def num(s):
    s = (s or '').strip().replace(',', '')
    return int(s) if re.fullmatch(r'\d+', s) else None


def season_rows(text):
    """위키백과 원문의 KBO 시즌 기록 표 행"""
    return season_rows_grid([[c[1] for c in row] for row in tb] for tb in W.tables(text))


def season_rows_grid(grids):
    """표(행 = 칸 글 목록)들에서 KBO 시즌 기록 행: [{year, team, franchise, kind, fields}]
    머리 행은 첫 칸이 '연도'인 행. 표 중간에 머리 행이 다시 나오면 건너뛴다. KBO 밖 구단(MLB·NPB 등)과 통산 행은 뺀다."""
    out = []
    for tb in grids:
        hi = next((i for i, r in enumerate(tb) if r and re.sub(r'\s', '', r[0]) in ('연도', '년도', '시즌')), None)
        if hi is None:
            continue
        head = [re.sub(r'\s', '', c) for c in tb[hi]]
        hs = set(head)
        if hs & {'평균자책점', '평자책', '방어율', 'ERA', '탈삼진', '피안타'}:
            kind, cmap = 'pit', PIT
        elif hs & {'타율', '타수'}:
            kind, cmap = 'bat', BAT
        else:
            continue
        team_col = next((i for i, h in enumerate(head) if h in ('소속', '팀명', '팀', '구단', '소속팀')), None)
        if team_col is None:
            continue
        for cells in tb[hi + 1:]:
            if len(cells) < len(head):
                continue
            m = re.match(r'(\d{4})', cells[0].strip())
            if not m:
                continue
            fr = C.franchise_of(cells[team_col])
            if not fr:
                continue
            fields = {}
            for i, h in enumerate(head):
                key = cmap.get(h)
                if not key or key in fields:
                    continue
                v = outs_of(cells[i]) if key == 'outs' else num(cells[i])
                if v is not None:
                    fields[key] = v
            if fields:
                out.append({'year': int(m.group(1)), 'team': cells[team_col].strip(), 'franchise': fr, 'kind': kind, 'fields': fields})
    return out


def military_of(career_text):
    """정보 상자 경력에서 상무·경찰 복무 (군 야구단). [{unit, from, to}]"""
    out = []
    for line in career_text.split('\n'):
        if re.search(r'상무|국군체육부대|경찰|경찰청', line):
            m = re.search(r'\((\d{4})년\s*(?:~\s*(\d{4})년)?', line)
            unit = '경찰' if '경찰' in line else '상무'
            if m:
                out.append({'unit': unit, 'from': int(m.group(1)), 'to': int(m.group(2) or m.group(1))})
    return out


def strip_blocks(text):
    """틀·표를 통째로 걷어 낸다 (서술만 남김)"""
    for open_, close in (('{|', '|}'), ('{{', '}}')):
        while True:
            i = text.find(open_)
            if i < 0:
                break
            j = W._find_close(text, i, open_, close)
            text = text[:i] + text[j:]
    return text


def summarize(plain):
    """서술 글 → (앞 두 문장 안팎 250자 이하 요약, 걸러 낸 문장 수). 금지 사건 낱말이 든 문장은 뺀다"""
    plain = re.sub(r'^\s*[*#:;>-]+\s*', '', plain, flags=re.M)
    plain = re.sub(r'\s*\n\s*', ' ', plain).strip()
    if not plain:
        return '', 0
    sents = [s.strip() for s in re.split(r'(?<=[다요음함됨]\.)\s+|(?<=\.)\s+(?=[가-힣A-Z])', plain) if s.strip()]
    good, cut = [], 0
    for s in sents:
        if W.BANNED_RE.search(s):
            cut += 1
        else:
            good.append(s)
    summary = ''
    for s in good[:2]:
        if len(summary) + len(s) > 250:
            break
        summary += (' ' if summary else '') + s
    if not summary and good:
        summary = good[0][:247] + '…'
    return summary, cut


def digest(text):
    """위키백과 서술 요점: (절 목록 [(제목, 요약)], 걸러 낸 절 수, 걸러 낸 문장 수)"""
    keep, cut_sec, cut_sent = [], 0, 0
    for title, level, body in W.sections(text):
        if title and W.SKIP_SECTION_RE.search(title):
            continue
        if title and W.BANNED_SECTION_RE.search(title):
            cut_sec += 1
            continue
        summary, cut = summarize(W.clean(strip_blocks(body)))
        cut_sent += cut
        if summary:
            keep.append((title or '머리말', summary))
    return keep, cut_sec, cut_sent


def extract_wiki(page):
    text = page['content']
    _, box = W.infobox(text)
    g = lambda k: W.clean(box.get(k, ''))  # noqa: E731
    prof = {}
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', g('생년월일'))
    if m:
        prof['생년월일'] = m.group(0)
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', g('사망일'))
    if m:
        prof['사망일'] = m.group(0)
    for k, item in (('신장', '키'), ('체중', '몸무게')):
        mm = re.match(r'(\d{2,3})(?:\.\d)?\s*(?:cm|kg)?$', g(k))
        if mm:
            prof[item] = int(mm.group(1))
    if HAND.get(g('투구')[:1]):
        prof['투'] = HAND[g('투구')[:1]]
    if HAND.get(g('타석')[:1]):
        prof['타'] = HAND[g('타석')[:1]]
    for k, item in (('국적', '국적'), ('출신지', '출신지'), ('수비 위치', '포지션'), ('드래프트 순위', '드래프트'),
                    ('첫 출장', '첫 출장'), ('마지막 경기', '마지막 경기')):
        if g(k):
            prof[item] = g(k)
    if '포지션' in prof:
        first = re.split(r'[,/·]', prof['포지션'])[0].strip()
        if first in POS:
            prof['포지션 코드'] = POS[first]
    m = re.search(r'(\d{4})', g('프로 입단 연도'))
    if m:
        prof['입단 연도'] = int(m.group(1))
    mil = military_of(W.clean(box.get('경력', '')).replace('*', '\n*'))
    if mil:
        prof['병역'] = '; '.join(f'{x["unit"]} {x["from"]}~{x["to"]}' for x in mil)
    for title, _, body in W.sections(text):
        if title == '출신 학교':
            schools = [W.clean(l.lstrip('*# ')) for l in body.split('\n') if l.strip().startswith('*')]
            if schools:
                prof['출신 학교'] = ' / '.join(s for s in schools if s)
    secs, cut_sec, cut_sent = digest(text)
    return {
        'source': 'wiki', 'title': page['title'], 'revid': page.get('revid'), 'fetched': page.get('fetched'),
        'profile': prof, 'seasons': season_rows(text),
        'narrative': secs, 'cut_sections': cut_sec, 'cut_sentences': cut_sent,
    }


def main():
    C.stdout_utf8()
    sample = '--sample' in sys.argv
    out_dir, note_dir = C.out_paths(sample)
    pairs = C.read_csv(out_dir / '짝.csv')
    dest = note_dir / '추출'
    n_wiki = n_namu = 0
    (dest / 'wiki').mkdir(parents=True, exist_ok=True)
    (dest / 'namu').mkdir(parents=True, exist_ok=True)
    import s3_namu  # 나무위키 문서 읽기 (덤프에서 뽑아 둔 것)
    # 짝이 없어진 선수의 지난 추출 결과는 지운다 (5단계가 폴더의 파일을 그대로 읽으므로)
    keep = {'wiki': {r['선수ID'] for r in pairs if r['위키 제목']}, 'namu': {r['선수ID'] for r in pairs if r.get('나무위키 제목')}}
    for src, ids in keep.items():
        for f in (dest / src).glob('*.json'):
            if f.stem not in ids:
                f.unlink()
    for r in pairs:
        if r['위키 제목']:
            page = C.cached_page(r['위키 제목'])
            if page and page.get('content'):
                ex = extract_wiki(page)
                (dest / 'wiki' / f'{r["선수ID"]}.json').write_text(json.dumps(ex, ensure_ascii=False), encoding='utf-8')
                n_wiki += 1
        if r.get('나무위키 제목'):
            doc = s3_namu.cached_doc(r['나무위키 제목'])
            if doc:
                ex = s3_namu.extract(doc)
                (dest / 'namu' / f'{r["선수ID"]}.json').write_text(json.dumps(ex, ensure_ascii=False), encoding='utf-8')
                n_namu += 1
    C.log(f'[4단계 끝] 뽑은 문서: 위키백과 {n_wiki}쪽 · 나무위키 {n_namu}쪽 → {dest}')


if __name__ == '__main__':
    main()
