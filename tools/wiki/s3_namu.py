# -*- coding: utf-8 -*-
"""3단계: 나무위키 덤프 받기 + 짝 맞은 선수 문서만 뽑아 캐시.

  python tools/wiki/s3_namu.py --download      덤프 받기 (한 번만, 끊기면 같은 명령으로 이어 받기)
  python tools/wiki/s3_namu.py [--sample]      덤프에서 우리 선수 문서 찾기 → 짝.csv의 '나무위키 제목' 채움
  (시험용) --db <sqlite 경로>                   다른 덤프 파일로 찾기

덤프: archive.org 항목 namuwiki-data-dump-20260829의 namu-md.sqlite 하나 (23,697,330,176바이트, 2026-08-29 공개, 2026년 8월 크롤).
  사용자 허락 2026-10-23. namu-html.sqlite(78 GB)는 받지 않는다 (PC 공간 부족).
  구조: docs(id, title, md BLOB = zlib 압축 마크다운, categories, last_modified …) + 제목 고유 색인 ix_title.
  색인으로 제목을 바로 찾으므로 덤프 전체를 메모리에 올리거나 훑지 않는다.
받은 문서는 신뢰하지 않는 자료: 텍스트로만 읽는다 (HTML·스크립트를 실행하지 않음).
"""
import hashlib
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402
import namumd as N  # noqa: E402
import resolve as R  # noqa: E402

ITEM = 'namuwiki-data-dump-20260829'
FILE = 'namu-md.sqlite'
URL = f'https://archive.org/download/{ITEM}/{FILE}'
SIZE = 23_697_330_176
MD5 = 'dbccd494c79c59bbb98c84173881afc9'  # archive.org 메타데이터 (2026-10-23 확인)
DUMP = C.RAW_NAMU / FILE
PART = C.RAW_NAMU / (FILE + '.part')
NEED_FREE = 30 * 10**9  # 받기 전에 남아 있어야 할 공간 (이미 받은 만큼은 빼 준다)
DOCS = C.RAW_NAMU / '문서'
DUMP_DATE = '2026-08-29'


# ---- 받기

def download():
    C.RAW_NAMU.mkdir(parents=True, exist_ok=True)
    if DUMP.exists() and DUMP.stat().st_size == SIZE:
        C.log(f'[3단계 받기 끝] 이미 받음: {DUMP}')
        return
    have = PART.stat().st_size if PART.exists() else 0
    free = shutil.disk_usage(C.RAW_NAMU).free
    if free + have < NEED_FREE:
        C.log(f'[3단계 받기 멈춤] 남은 공간 {free / 1e9:.1f} GB (이미 받은 {have / 1e9:.1f} GB 포함 {(free + have) / 1e9:.1f} GB) < 30 GB. 공간을 비운 뒤 다시.')
        sys.exit(2)
    C.log(f'[3단계 받기] {URL}\n  → {PART} (이미 {have / 1e9:.2f} / {SIZE / 1e9:.2f} GB, 남은 공간 {free / 1e9:.1f} GB)')
    C.log('  약 2.3 MB/s 기준 전체 약 3시간. 끊겨도 같은 명령을 다시 치면 이어 받는다.')
    ua = C.UA.replace('python-urllib', 'curl')
    cmd = ['curl', '-L', '-C', '-', '--retry', '20', '--retry-delay', '30', '--retry-all-errors',
           '--speed-limit', '1000', '--speed-time', '120', '-A', ua, '-o', str(PART), URL]
    r = subprocess.run(cmd)
    size = PART.stat().st_size if PART.exists() else 0
    if r.returncode != 0 or size != SIZE:
        C.log(f'[3단계 받기 멈춤] curl 종료 코드 {r.returncode}, 받은 크기 {size} / {SIZE}. 같은 명령으로 이어 받기.')
        sys.exit(1)
    C.log('  MD5 확인 중 (몇 분)…')
    h = hashlib.md5()
    with PART.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 22), b''):
            h.update(chunk)
    if h.hexdigest() != MD5:
        C.log(f'[3단계 받기 멈춤] MD5가 다름 ({h.hexdigest()} ≠ {MD5}). 파일을 지우지 말고 보고.')
        sys.exit(1)
    PART.rename(DUMP)
    C.log(f'[3단계 받기 끝] {DUMP} ({SIZE} 바이트, MD5 일치)')


# ---- 찾기

def open_db(path):
    # 읽기 전용 + 변경 불가 표시 (잠금·저널을 만들지 않음)
    return sqlite3.connect(f'file:{Path(path).as_posix()}?mode=ro&immutable=1', uri=True)


def _doc_file(title):
    return DOCS / (hashlib.sha1(title.encode('utf-8')).hexdigest() + '.json')


def cached_doc(title):
    f = _doc_file(title)
    return json.loads(f.read_text(encoding='utf-8')) if f.exists() else None


def get_md(db, title):
    r = db.execute('SELECT md FROM docs WHERE title = ?', (title,)).fetchone()
    return zlib.decompress(r[0]).decode('utf-8', 'replace') if r else None


def titles_like(db, name):
    """'이름' 과 '이름(…)' 꼴 제목 (제목 색인 범위 검색)"""
    rows = db.execute('SELECT title FROM docs WHERE title = ? OR (title >= ? AND title < ?)',
                      (name, name + '(', name + ')')).fetchall()
    # '제목/선수 경력/2024년' 같은 하위 문서는 사람 문서가 아니다
    return [r[0] for r in rows if '/' not in r[0]]


def subdoc_titles(db, title):
    """'제목/선수 경력' 같은 하위 문서 중 기록·경력 쪽"""
    rows = db.execute('SELECT title FROM docs WHERE title >= ? AND title < ?', (title + '/', title + '0')).fetchall()
    return [r[0] for r in rows if re.search(r'경력|기록|성적', r[0])]


def profile(md):
    """정보 상자 표 → {칸 이름: 값}. 같은 칸 이름이 여러 줄이면(출생 날짜·장소) 줄바꿈으로 잇는다"""
    for tb in N.tables(md):
        labels = [r[0] for r in tb if len(r) >= 2]
        if not ({'출생', '투타', '포지션'} & set(labels)):
            continue
        out = {}
        for r in tb:
            if len(r) < 2 or not r[0] or len(r[0]) > 12:
                continue
            vals = [v for v in dict.fromkeys(r[1:]) if v and v != r[0]]
            if vals:
                out[r[0]] = (out[r[0]] + '\n' if r[0] in out else '') + ' '.join(vals)
        return out
    return {}


def evidence(p, stints, md):
    """이 문서가 우리 선수인지: (점수, 근거) 또는 (None, 사유)"""
    from s1_match import evaluate
    cats = N.categories(md)
    box = profile(md)
    if not box and not any('야구' in c for c in cats):
        return None, '야구 문서 아님'
    if any('동음이의' in c for c in cats):
        return None, '동음이의'
    birth = set()
    m = re.search(r'(\d{4})년', box.get('출생', ''))
    if m:
        birth = {int(m.group(1))}
    else:
        for c in cats:
            mm = re.fullmatch(r'(\d{4})년 출생', c)
            if mm:
                birth = {int(mm.group(1))}
    teams = []
    for line in box.get('소속팀', '').split('\n'):
        f = C.franchise_of(line)
        mm = re.search(r'\((\d{4})\s*(?:~\s*(\d{4})?)?', line)
        if f:
            teams.append((f, int(mm.group(1)) if mm else None, int(mm.group(2) or mm.group(1)) if mm else None))
    if not teams:
        for c in cats:
            f = C.franchise_of(c.split('/')[0])
            if f:
                teams.append((f, None, None))
    return evaluate(p, stints, birth, teams)


def candidates(p, wiki_title):
    names = {p['name']}
    if wiki_title:
        names.add(C.strip_paren(wiki_title))
    return names


def resolve_one(db, p, info, stints, names, taken=()):
    """근거가 모자라거나 같은 점수 후보가 여럿일 때: 넘겨주기로 겹친 후보를 묶고 더 많은 근거로 다시 본다 (resolve.py).
    taken: 다른 선수의 짝으로 이미 쓰인 제목 (그 사람의 다른 제목까지 함께 뺀다)"""
    cands = {}
    for name in names:
        for t in titles_like(db, name):
            md = get_md(db, t)
            cats = N.categories(md)
            if any('동음이의' in c for c in cats) or not (profile(md) or any('야구' in c for c in cats)):
                continue
            cands[t] = R.namu_cand(md)
    scored = [(*R.score(p, info, stints, cands[g[0]]), g[0]) for g in R.same_person_groups(cands)
              if not any(t in taken for t in g)]
    best, why = R.pick([(s, t, w) for s, w, t in scored])
    return best, why, cands


def find(db, players, stints, wiki_titles, master=None):
    """1차: 생년·구단·연도 점수로 고른다. 2차: 1차에서 애매한 선수만 resolve.py 근거로, 1차 짝이 안 쓴 문서 중에서 다시 고른다"""
    picks, amb, pending = {}, [], []
    for p in players:
        scored = {}
        names = candidates(p, wiki_titles.get(p['id']))
        for name in names:
            for t in titles_like(db, name):
                md = get_md(db, t)
                s, why = evidence(p, stints.get(p['id'], set()), md)
                if s is not None and s > 0:
                    scored[t] = (s, why, md)
        ranked = sorted(scored.items(), key=lambda kv: -kv[1][0])
        if not ranked:
            continue
        reason = ''
        if ranked[0][1][0] < 3:
            reason = '근거 부족 (나무위키)'
        elif len(ranked) > 1 and ranked[1][1][0] == ranked[0][1][0]:
            reason = '같은 점수 후보 여럿 (나무위키)'
        if reason:
            pending.append((p, names, ' / '.join(t for t, _ in ranked[:4]), reason))
            continue
        t, (s, why, md) = ranked[0]
        picks[p['id']] = (t, f'나무:{why}', md)
    taken = {t for t, _, _ in picks.values()}
    n_resolved = 0
    for p, names, shown, reason in pending:
        best, why2, _ = resolve_one(db, p, R.player_info(p, master), stints.get(p['id'], set()), names, taken)
        if best:
            n_resolved += 1
            picks[p['id']] = (best[1], f'나무:다시 가림:{best[2]}', get_md(db, best[1]))
        else:
            amb.append((p['id'], p['name'], shown, f'{reason}, 다시 가림: {why2}'))
    C.log(f'  애매 {len(pending)}명 중 다시 가려서 고름 {n_resolved}명')
    # 한 문서에 우리 선수 둘이면 버린다
    seen = {}
    for pid, (t, _, _) in list(picks.items()):
        if t in seen:
            for x in (pid, seen[t]):
                if x in picks:
                    amb.append((x, '', t, '한 문서에 우리 선수 여럿 (나무위키)'))
                    del picks[x]
        seen[t] = pid
    return picks, amb


def save_doc(db, title, md):
    DOCS.mkdir(parents=True, exist_ok=True)
    subs = [{'title': s, 'md': get_md(db, s)} for s in subdoc_titles(db, title)]
    _doc_file(title).write_text(json.dumps({'title': title, 'md': md, 'subdocs': subs, 'fetched': DUMP_DATE},
                                           ensure_ascii=False), encoding='utf-8')


# ---- 뽑기 (4단계가 부른다)

HAND = {'좌': 'L', '우': 'R', '양': 'S'}


def extract(doc):
    import s4_extract as X
    import wikitext as W
    md = doc['md']
    box = profile(md)
    prof = {}
    birth = box.get('출생', '')
    m = re.search(r'(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일', birth)
    if m:
        prof['생년월일'] = f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
    lines = [l for l in birth.split('\n')[1:] if l.strip()]
    if lines:
        prof['출신지'] = lines[0].strip()
    m = re.search(r'(\d{3})\s*cm', box.get('신체', ''))
    if m:
        prof['키'] = int(m.group(1))
    m = re.search(r'(\d{2,3})\s*kg', box.get('신체', ''))
    if m:
        prof['몸무게'] = int(m.group(1))
    m = re.match(r'([좌우양])(?:투|언|사)?.*?([좌우양])타', box.get('투타', ''))
    if m:
        prof['투'], prof['타'] = HAND[m.group(1)], HAND[m.group(2)]
    if '언' in box.get('투타', '') or '사' in box.get('투타', '')[:2]:
        prof['언더핸드'] = '예'
    for k in ('국적', '포지션', '학력', '프로 입단', '소속팀', '병역', '연봉', '계약', '가족', '등번호', '지도자', '응원가'):
        if box.get(k) and k not in ('가족',):  # 가족은 사생활이라 뽑지 않는다
            prof[k if k != '학력' else '출신 학교'] = box[k].replace('\n', ' / ')
    if '포지션' in prof:
        first = re.split(r'[,/·\s]', prof['포지션'])[0].strip()
        if first in X.POS:
            prof['포지션 코드'] = X.POS[first]
    m = re.search(r'(\d{4})', box.get('프로 입단', ''))
    if m:
        prof['입단 연도'] = int(m.group(1))
    grids = N.tables(md) + [t for s in doc.get('subdocs', []) if s.get('md') for t in N.tables(s['md'])]
    seasons = X.season_rows_grid(grids)
    keep, cut_sec, cut_sent = [], 0, 0
    texts = [(doc['title'], md)] + [(s['title'], s['md']) for s in doc.get('subdocs', []) if s.get('md')]
    for src_title, text in texts:
        for title, body in N.sections(text):
            if title and W.SKIP_SECTION_RE.search(title):
                continue
            if title and W.BANNED_SECTION_RE.search(title):
                cut_sec += 1
                continue
            summary, ct = X.summarize(body)
            cut_sent += ct
            if summary:
                keep.append(((title or '머리말') + ('' if src_title == doc['title'] else f' ({src_title})'), summary))
    return {
        'source': 'namu', 'title': doc['title'], 'revid': N.front(md).get('last_modified'), 'fetched': doc.get('fetched'),
        'profile': prof, 'seasons': seasons, 'narrative': keep, 'cut_sections': cut_sec, 'cut_sentences': cut_sent,
    }


def main():
    C.stdout_utf8()
    if '--download' in sys.argv:
        download()
        return
    sample = '--sample' in sys.argv
    db_path = Path(sys.argv[sys.argv.index('--db') + 1]) if '--db' in sys.argv else DUMP
    if not db_path.exists():
        C.log(f'[3단계 멈춤] 덤프가 없음: {db_path}. 먼저 --download.')
        sys.exit(1)
    out_dir, note_dir = C.out_paths(sample)
    players = C.load_players()
    if sample:
        ids = set(C.sample_ids())
        players = [p for p in players if p['id'] in ids]
    pairs_f = out_dir / '짝.csv'
    pairs = {r['선수ID']: r for r in C.read_csv(pairs_f)} if pairs_f.exists() else {}
    wiki_titles = {k: r['위키 제목'] for k, r in pairs.items() if r['위키 제목']}
    stints = C.player_stints(C.load_seasons())
    db = open_db(db_path)
    C.log(f'[3단계] 나무위키 덤프에서 찾기: 선수 {len(players)}명, 덤프 {db_path}')
    picks, amb = find(db, players, stints, wiki_titles, C.load_master_extra())
    for pid, (t, why, md) in picks.items():
        save_doc(db, t, md)
    names = {p['id']: p['name'] for p in players}
    rows = []
    for p in players:
        r = pairs.get(p['id'])
        nt, nwhy = (picks[p['id']][0], picks[p['id']][1]) if p['id'] in picks else ('', '')
        if r or nt:
            r = r or {'선수ID': p['id'], '이름': p['name'], '위키 제목': '', '위키데이터': '', '위키 근거': '', '점수': ''}
            rows.append([r['선수ID'], r['이름'], r['위키 제목'], r['위키데이터'], r['위키 근거'], r['점수'], nt, nwhy])
    C.write_csv(pairs_f, ['선수ID', '이름', '위키 제목', '위키데이터', '위키 근거', '점수', '나무위키 제목', '나무 근거'], rows)
    amb_f = note_dir / '짝_애매.csv'
    old = [r for r in C.read_csv(amb_f) if r['출처'] != '나무위키'] if amb_f.exists() else []
    C.write_csv(amb_f, ['선수ID', '이름', '후보', '사유', '출처'],
                [[r['선수ID'], r['이름'], r['후보'], r['사유'], r['출처']] for r in old] +
                [[a[0], a[1] or names.get(a[0], ''), a[2], a[3], '나무위키'] for a in amb])
    C.log(f'[3단계 끝] 선수 {len(players)} · 나무위키 짝 {len(picks)} · 애매 {len({a[0] for a in amb})} · 못 찾음 {len(players) - len(picks) - len({a[0] for a in amb})}')


if __name__ == '__main__':
    main()
