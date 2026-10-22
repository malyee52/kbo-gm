# -*- coding: utf-8 -*-
"""한국어 위키백과 위키 문법을 다루는 작은 도구: 정보 상자, 표, 절, 글 정리.
받은 원문은 신뢰하지 않는 자료로 보고 텍스트로만 읽는다."""
import re


def _find_close(s, i, open_='{{', close='}}'):
    """s[i:]가 open_으로 시작할 때 짝이 맞는 close의 끝 위치"""
    depth = 0
    j = i
    while j < len(s):
        if s.startswith(open_, j):
            depth += 1
            j += len(open_)
        elif s.startswith(close, j):
            depth -= 1
            j += len(close)
            if depth == 0:
                return j
        else:
            j += 1
    return len(s)


def split_top(s, sep='|'):
    """틀·링크 안의 구분자는 무시하고 나눈다"""
    out = []
    depth_t = depth_l = 0
    cur = []
    i = 0
    while i < len(s):
        if s.startswith('{{', i):
            depth_t += 1
            cur.append('{{')
            i += 2
            continue
        if s.startswith('}}', i) and depth_t:
            depth_t -= 1
            cur.append('}}')
            i += 2
            continue
        if s.startswith('[[', i):
            depth_l += 1
            cur.append('[[')
            i += 2
            continue
        if s.startswith(']]', i) and depth_l:
            depth_l -= 1
            cur.append(']]')
            i += 2
            continue
        if s.startswith(sep, i) and depth_t == 0 and depth_l == 0:
            out.append(''.join(cur))
            cur = []
            i += len(sep)
            continue
        cur.append(s[i])
        i += 1
    out.append(''.join(cur))
    return out


def infobox(text, names=('야구 선수 정보', '야구인 정보', '야구 선수', '스포츠인 정보', '인물 정보')):
    """첫 정보 상자 틀의 이름과 {항목: 원문 값}. 없으면 (None, {})"""
    if not text:
        return None, {}
    for m in re.finditer(r'\{\{\s*([^|{}\n]+?)\s*(?=\||\n)', text):
        name = m.group(1).strip()
        if not any(name.replace('_', ' ').startswith(n) for n in names):
            continue
        end = _find_close(text, m.start())
        body = text[m.start() + 2:end - 2]
        parts = split_top(body)
        fields = {}
        for p in parts[1:]:
            if '=' in p:
                k, v = p.split('=', 1)
                fields[k.strip()] = v.strip()
        return name, fields
    return None, {}


def clean(s):
    """위키 문법을 걷어 낸 글"""
    if not s:
        return ''
    s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    s = re.sub(r'<ref[^>]*/>', '', s)
    s = re.sub(r'<ref[^>]*>.*?</ref>', '', s, flags=re.S)
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'</?nowiki\s*/?>', '', s)
    s = re.sub(r'<[^>]+>', '', s)
    # 날짜 틀은 숫자로
    s = re.sub(r'\{\{\s*(?:출생일과 나이|출생일|사망일과 나이|사망일)\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})[^{}]*\}\}',
               lambda m: f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}', s)
    for _ in range(4):
        s2 = re.sub(r'\{\{[^{}]*\}\}', '', s)
        if s2 == s:
            break
        s = s2
    s = re.sub(r'\[\[(?:파일|File|그림|Image|분류|Category):[^\]]*\]\]', '', s, flags=re.I)
    s = re.sub(r'\[\[[^\]|]*\|([^\]]*)\]\]', r'\1', s)
    s = re.sub(r'\[\[([^\]]*)\]\]', r'\1', s)
    s = re.sub(r'\[https?://\S+\s+([^\]]*)\]', r'\1', s)
    s = re.sub(r'\[https?://\S+\]', '', s)
    s = re.sub(r"'{2,}", '', s)
    s = s.replace('&nbsp;', ' ')
    return re.sub(r'[ \t]+', ' ', s).strip()


def sections(text):
    """[(제목, 단계, 본문)] — 첫 절 앞 머리글은 제목 ''"""
    out = []
    pos = 0
    title, level = '', 0
    for m in re.finditer(r'^(={2,6})\s*(.*?)\s*\1\s*$', text, flags=re.M):
        out.append((title, level, text[pos:m.start()]))
        title, level = clean(m.group(2)), len(m.group(1))
        pos = m.end()
    out.append((title, level, text[pos:]))
    return out


def tables(text):
    """위키 표들. 각 표는 행 목록, 행은 (머리칸 여부, 칸 글) 목록. rowspan·colspan을 펼친다."""
    res = []
    i = 0
    while True:
        a = text.find('{|', i)
        if a < 0:
            break
        b = _find_close(text, a, '{|', '|}')
        res.append(_parse_table(text[a + 2:b - 2]))
        i = b
    return res


def _cell_split(content):
    """칸 하나: '속성 | 내용' 이면 (속성, 내용)"""
    parts = split_top(content, '|')
    if len(parts) >= 2 and ('=' in parts[0] or parts[0].strip() == '') and '[[' not in parts[0]:
        return parts[0], '|'.join(parts[1:])
    return '', content


def _parse_table(body):
    raw_rows = []
    cur = None
    for line in body.split('\n'):
        st = line.strip()
        if not st:
            continue
        if st.startswith('|-'):
            cur = []
            raw_rows.append(cur)
            continue
        if st.startswith('|+'):
            continue
        if st[0] in '!|':
            if cur is None:
                cur = []
                raw_rows.append(cur)
            head = st[0] == '!'
            sep = '!!' if head else '||'
            content = st[1:]
            parts = split_top(content, '||')
            if head:
                parts = [q for p in parts for q in split_top(p, '!!')]
            for p in parts:
                attr, val = _cell_split(p)
                rs = re.search(r'rowspan\s*=\s*"?(\d+)', attr)
                cs = re.search(r'colspan\s*=\s*"?(\d+)', attr)
                cur.append((head, clean(val), int(rs.group(1)) if rs else 1, int(cs.group(1)) if cs else 1))
        elif cur:
            # 칸 내용이 다음 줄로 이어짐
            h, v, r, c = cur[-1]
            cur[-1] = (h, (v + ' ' + clean(st)).strip(), r, c)
    grid = []
    pending = {}  # 열 → (남은 행 수, 칸)
    for row in raw_rows:
        if not row:
            continue
        out = []
        col = 0
        cells = list(row)
        while cells or pending.get(col):
            if pending.get(col):
                n, cell = pending[col]
                out.append(cell)
                pending[col] = (n - 1, cell) if n > 1 else None
                col += 1
                continue
            h, v, r, c = cells.pop(0)
            for k in range(c):
                out.append((h, v))
                if r > 1:
                    pending[col] = (r - 1, (h, v))
                col += 1
        grid.append(out)
    return grid


# ---- 서술 거르기: 실존 선수에게 붙이지 않는 사건 (CLAUDE.md "지켜야 할 규칙")
# 2026-10-23 전체 노트 검사에서 샌 것을 더했다: 절 제목('음주운전 적발', '인터넷 불법 도박', '교제 여성 폭행')이
# 절 제목 목록에 없어 통과했고, 결혼·출산 같은 사생활 문장과 크롤링본의 광고 글이 남았다.
# 센 낱말(STRONG): 절 제목이나 절 본문 어느 문장에든 나오면 그 절을 통째로 뺀다.
STRONG = [
    '음주', '만취', '도박', '불법 스포츠', '폭행', '폭력', '폭언', '구타', '약물', '도핑', '금지 약물', '금지약물', '마약', '대마',
    '마리화나', '필로폰', '양성 반응', '양성반응', '성추행', '성폭', '성범죄', '성매매', '성희롱', '몰카', '불법', '체포', '구속',
    '기소', '입건', '송치', '재판', '징역', '벌금', '집행유예', '유죄', '항소', '선고', '사기', '괴롭힘', '학폭', '학교폭력',
    '학교 폭력', '갑질', '가혹행위', '징계', '출장 정지', '출장정지', '출전 정지', '출전정지', '자격 정지', '제명', '승부조작',
    '승부 조작', '불륜', '이혼', '스캔들', '횡령', '혐의', '비위', '물의', '자숙', '사과문', '위반', '협박', '위증', '탈세',
    '뺑소니', '무면허', '경찰 조사', '검찰', '수사', '흑역사', '불미스러운',
]
# 약한 낱말: 그 문장만 뺀다 (경기 서술에도 흔히 나오는 말과 사생활)
WEAK = [
    '논란', '구설', '사건', '사고', '불화', '의혹', '사생활', '열애', '연애', '교제', '여자친구', '여친', '결혼', '혼인', '재혼',
    '아내', '배우자', '남편', '임신', '출산', '득남', '득녀', '자녀', '장인', '처가', '모친상', '부친상', '빙부상', '빙모상', '별세',
    '투병', '우울', '극단적 선택', '자살', '간 이식',
]
BANNED = STRONG + WEAK
STRONG_RE = re.compile('|'.join(re.escape(w) for w in STRONG))
# '부인'은 '내측부인대' 같은 말을 피한다
BANNED_RE = re.compile('|'.join(re.escape(w) for w in BANNED) + r'|(?<![측])부인(?!대)')
# 절 제목만 보고 통째로 빼는 것
BANNED_SECTION_RE = re.compile(r'논란|사건|사고|구설|비판|비난|사생활|가족|개인사|배우자|결혼|자녀|연애|열애|징계|물의|스캔들|의혹|법적|재판|범죄'
                               r'|인간관계|흑역사|사과|' + STRONG_RE.pattern)
# 서술 정리에서 볼 필요 없는 절 ('관련 문서'는 나무위키 크롤링본에서 광고 글이 섞여 들어오는 자리)
SKIP_SECTION_RE = re.compile(r'각주|외부 링크|같이 보기|참고|출신 학교|통산 기록|주요 기록|연도별|기록$|수상|출처|둘러보기|관련 항목|관련 문서|^경력$|등번호')
# 나무위키 크롤링본에 끼어든 광고 (표시 낱말 또는 광고 주소)
AD_RE = re.compile(r'qlPVvAEK|\b[\w-]+\.(?:co\.kr|com|net|kr)\b')


def banned_section(title, plain):
    """절을 통째로 뺄지: 제목이 금지 목록에 걸리거나, 본문 어느 곳에든 센 낱말이 있으면"""
    return bool((title and BANNED_SECTION_RE.search(title)) or STRONG_RE.search(plain or ''))


def keep_sections(secs, plain_of=lambda b: b):
    """[(제목, 단계, 본문)] → [(제목, 본문, 상태)]  상태: 'keep' | 'skip'(볼 필요 없음) | 'cut'(금지 사건).
    뺀 절 아래의 하위 절(단계가 더 깊은 절)도 함께 뺀다 ('사건 사고' 아래 '2016년' 같은 절)."""
    out, cut_at, skip_at = [], None, None
    for title, level, body in secs:
        if cut_at is not None and level > cut_at:
            out.append((title, body, 'cut'))
            continue
        if skip_at is not None and level > skip_at:
            out.append((title, body, 'skip'))
            continue
        cut_at = skip_at = None
        plain = plain_of(body)
        if title and SKIP_SECTION_RE.search(title):
            skip_at = level
            out.append((title, plain, 'skip'))
        elif banned_section(title, plain):
            cut_at = level
            out.append((title, plain, 'cut'))
        else:
            out.append((title, plain, 'keep'))
    return out
