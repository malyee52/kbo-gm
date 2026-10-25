# -*- coding: utf-8 -*-
"""애매한 짝 다시 가리기: 같은 점수 후보가 여럿이거나 근거가 모자란 짝을 더 많은 근거로 다시 본다.

1단계(위키백과)·3단계(나무위키)가 함께 쓴다. 네트워크를 쓰지 않는다 (캐시·덤프만).
근거 (점수):
  생년월일 전체가 같음 +4 · 생년만 같음 +2 · 월일이 같고 해만 1년 다름 +1 (어느 한쪽 오타로 본다) · 그 밖에 다르면 -4
  우리 1군 (연도, 계보) 중 후보 문서의 소속팀·연도 안에 드는 몫 × 4 · 하나도 안 들면 -2
  투수·야수 구분이 같음 +1, 다름 -3 · 투타가 같음 +1, 다름 -1
  출신 학교 (자료집 선수마스터 '출신교·경력' 조각이 문서에 나옴) +1
고르는 기준: 1등 점수가 PICK_MIN 이상이고 2등과 PICK_GAP 이상 벌어져야 한다 (임시값). 아니면 버린다.
나무위키는 넘겨주기 문서가 대상 문서를 통째로 담고 있어서(크롤링본) 같은 사람이 제목 여럿으로 잡힌다.
  출생·소속팀이 같은 후보는 한 사람으로 묶고, '…에서 넘어옴' 표시가 없는 제목을 대표로 쓴다.
"""
import re

import common as C

PICK_MIN = 5.0  # 임시값
PICK_GAP = 2.0  # 임시값

REDIRECT_RE = re.compile(r'\]\([^)]*_noredirect=1\.md[^)]*\)에서 넘어옴')
# 포지션 글 → 투수(True)·야수(False). 야구 포지션 말이 없으면 None (다른 종목 문서 등)
PITCH_RE = re.compile(r'투수|선발|계투|구원|마무리|셋업|불펜')
FIELD_RE = re.compile(r'포수|루수|유격수|외야수|내야수|지명|야수')


def pitcher_of(pos):
    if not pos:
        return None
    p, f = bool(PITCH_RE.search(pos)), bool(FIELD_RE.search(pos))
    return None if p == f else p


_RANGE = re.compile(r'(\d{4})\s*(?:년)?\s*(?:[~\-–]\s*(\d{4})?\s*(?:년)?)?')


def player_info(p, master):
    m = master.get(p['id'], {}) if master else {}
    birth = str(m.get('birth') or '')[:10]
    schools = []
    for part in re.split(r'[-–/,·\s]+', str(m.get('career') or '')):
        part = re.sub(r'\(.*?\)', '', part).strip()
        if len(part) >= 3 and re.search(r'(초|중|고|대)$', part):
            schools.append(part[:-1])
    return {'birth': birth if re.fullmatch(r'\d{4}-\d{2}-\d{2}', birth) else '', 'schools': schools}


def team_ranges(text):
    """'삼성 라이온즈 (1990~1999) / LG 트윈스(1993년 ~ 1997년, 2002년 ~ 2003년)' → [(계보, 시작, 끝)]"""
    out = []
    for m in re.finditer(r'([^()\n/*;]+?)\s*\(([^()]*\d{4}[^()]*)\)', text or ''):
        f = C.franchise_of(m.group(1))
        if not f:
            continue
        for r in _RANGE.finditer(m.group(2)):
            a = int(r.group(1))
            b = int(r.group(2)) if r.group(2) else (2100 if re.search(r'[~\-–]\s*$', m.group(2)[r.start():r.end()]) else a)
            out.append((f, a, b))
    return out


def coverage(stints, ranges):
    """우리 (연도, 계보) 중 후보 소속팀·연도 안에 드는 몫. 후보에 소속팀 자료가 없으면 None"""
    if not ranges or not stints:
        return None
    hit = sum(1 for y, f in stints if any(rf == f and a <= y <= b for rf, a, b in ranges))
    return hit / len(stints)


def score(p, info, stints, cand):
    """cand: {'birth': 'YYYY-MM-DD' 또는 'YYYY', 'teams': [...], 'pitcher': bool|None, 'throws','bats','text'}"""
    s, why = 0.0, []
    cb, ob = cand.get('birth') or '', info.get('birth') or ''
    by = p.get('birthYear')
    if cb:
        if ob and len(cb) == 10:
            if cb == ob:
                s += 4; why.append('생년월일')
            elif cb[4:] == ob[4:] and abs(int(cb[:4]) - int(ob[:4])) == 1:
                s += 1; why.append('월일(해 1년 차)')
            elif by and int(cb[:4]) == by:
                s += 1; why.append('생년(월일 다름)')
            else:
                s -= 4; why.append('생년월일 다름')
        elif by:
            if int(cb[:4]) == by:
                s += 2; why.append('생년')
            else:
                s -= 4; why.append('생년 다름')
    cov = coverage(stints, cand.get('teams'))
    if cov is not None:
        if cov > 0:
            s += 4 * cov; why.append(f'구단·연도 {cov:.0%}')
        else:
            s -= 2; why.append('구단·연도 안 맞음')
    if cand.get('pitcher') is not None and p.get('kind') in ('P', 'B'):
        if cand['pitcher'] == (p.get('kind') == 'P'):
            s += 1; why.append('투수·야수')
        else:
            s -= 3; why.append('투수·야수 다름')
    for k in ('throws', 'bats'):
        if cand.get(k) and p.get(k):
            s += 1 if cand[k] == p[k] else -1
    if cand.get('text') and any(sc in cand['text'] for sc in info.get('schools', [])):
        s += 1; why.append('학교')
    return round(s, 2), '+'.join(why)


def pick(scored):
    """scored: [(점수, 제목, 근거)] → (고른 것 또는 None, 사유)"""
    ranked = sorted(scored, key=lambda x: -x[0])
    if not ranked:
        return None, '후보 없음'
    if ranked[0][0] < PICK_MIN:
        return None, f'근거 부족 ({ranked[0][0]})'
    if len(ranked) > 1 and ranked[0][0] - ranked[1][0] < PICK_GAP:
        return None, f'후보 점수 차 부족 ({ranked[0][0]} / {ranked[1][0]})'
    return ranked[0], ''


# ---- 후보 문서 → 근거

HAND = {'좌': 'L', '우': 'R', '양': 'S'}


def playing_part(career):
    """위키백과 정보 상자 '경력'에서 선수 경력만 (코치·감독·프런트 경력 줄 앞까지)"""
    out = []
    for line in (career or '').split('\n'):
        head = line.strip(" ;'*")
        if re.search(r'경력$', head) and '선수' not in head:
            break
        out.append(line)
    return '\n'.join(out)


def wiki_cand(text):
    import wikitext as W
    _, box = W.infobox(text)
    g = lambda k: W.clean(box.get(k, ''))
    m = re.search(r'(\d{4}-\d{2}-\d{2})', g('생년월일'))
    birth = m.group(1) if m else ''
    if not birth:
        m = re.search(r'\[\[분류:(\d{4})년 출생\]\]', text)
        birth = m.group(1) if m else ''
    pos = g('수비 위치') or g('포지션')
    pitcher = pitcher_of(pos)
    if pitcher is None and '[[분류:KBO 리그 투수]]' in text:
        pitcher = True
    return {'birth': birth, 'teams': team_ranges(playing_part(g('경력'))), 'pitcher': pitcher,
            'throws': HAND.get(g('투구')[:1]), 'bats': HAND.get(g('타석')[:1]), 'text': text[:20000]}


def namu_cand(md):
    import namumd as N
    import s3_namu as S
    box = S.profile(md)
    cats = N.categories(md)
    m = re.search(r'(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일', box.get('출생', ''))
    if m:
        birth = f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
    else:
        m = re.search(r'(\d{4})년', box.get('출생', ''))
        birth = m.group(1) if m else next((c[:4] for c in cats if re.fullmatch(r'\d{4}년 출생', c)), '')
    pos = box.get('포지션', '')
    pitcher = pitcher_of(pos)
    if pitcher is None and any(re.search(r'(좌완|우완) 투수', c) for c in cats):
        pitcher = True
    hand = re.match(r'([좌우양])(?:투|언|사)?.*?([좌우양])타', box.get('투타', ''))
    return {'birth': birth, 'teams': team_ranges(box.get('소속팀', '')), 'pitcher': pitcher,
            'throws': HAND.get(hand.group(1)) if hand else None, 'bats': HAND.get(hand.group(2)) if hand else None,
            'text': md[:20000], 'redirect': bool(REDIRECT_RE.search(md[:2000])),
            'sig': (box.get('출생', '').split('\n')[0].strip(), re.sub(r'\s+', '', box.get('소속팀', '')))}


def same_person_groups(cands):
    """나무위키 후보 {제목: cand} → 한 사람마다 제목 목록, 대표 제목이 맨 앞
    (출생·소속팀이 같으면 한 사람, 넘겨주기 표시 없는 제목 우선)"""
    groups = {}
    for t, c in cands.items():
        key = c['sig'] if c['sig'][0] and c['sig'][1] else ('', t)
        groups.setdefault(key, []).append(t)
    reps = []
    for ts in groups.values():
        ts.sort(key=lambda t: (cands[t]['redirect'], -len(cands[t]['text']), t))
        reps.append(ts)
    return reps
