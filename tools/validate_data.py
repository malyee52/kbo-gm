#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""게임 데이터 JSON 검사.

사용법:  python3 tools/validate_data.py [데이터 폴더]
오류가 있으면 종료 코드 1. 경고는 알려진 공백을 수로 보여 주는 용도이며 실패로 치지 않는다.
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'public' / 'data'

errors, warnings = [], []
err = errors.append
warn = warnings.append


def load(p):
    return json.loads(p.read_text(encoding='utf-8'))


def main():
    meta = load(DATA / 'meta.json')
    players = load(DATA / 'players.json')['players']

    # ---- 선수 마스터
    ids = Counter(p['id'] for p in players)
    for pid, c in ids.items():
        if c > 1:
            err(f'players: 중복 ID {pid} ({c}회)')
    by_id = {p['id']: p for p in players}
    for p in players:
        for k in ('id', 'name', 'kind', 'entryYear', 'first', 'last'):
            if p.get(k) in (None, ''):
                err(f'players {p.get("id")}: 필수 항목 {k} 없음')
        if p.get('kind') not in ('B', 'P', 'BP'):
            err(f'players {p["id"]}: kind 값 이상 {p.get("kind")}')
        if p.get('first', 0) > p.get('last', 0):
            err(f'players {p["id"]}: 첫 시즌이 마지막 시즌보다 늦음')
        if not (1982 <= p.get('entryYear', 0) <= p.get('first', 0)):
            err(f'players {p["id"]}: 입단연도 {p.get("entryYear")}가 1982~첫 시즌 범위를 벗어남')
        by = p.get('birthYear')
        if by is not None and not (15 <= p['first'] - by <= 50):
            err(f'players {p["id"]} {p["name"]}: 첫 시즌 나이 {p["first"] - by}')
    c = Counter()
    for p in players:
        c['생년 없음'] += 'birthYear' not in p
        c['포지션 없음'] += 'pos' not in p
        c['투타 없음'] += 'throws' not in p
        c['외국인 여부 미확인'] += 'foreign' not in p
    for k, v in c.items():
        if v:
            warn(f'players: {k} {v:,}명')

    # ---- 시즌 파일
    for y in meta['years']:
        s = load(DATA / 'seasons' / f'{y}.json')
        bf = {f: i for i, f in enumerate(s['batFields'])}
        pf = {f: i for i, f in enumerate(s['pitFields'])}
        names = [t['name'] for t in s['teams']]
        if len(set(names)) != len(names):
            err(f'{y}: 구단 이름 중복')
        if s['complete']:
            for t in s['teams']:
                if t['w'] + t['l'] + t['t'] != t['g']:
                    err(f'{y} {t["name"]}: 승+패+무 {t["w"] + t["l"] + t["t"]} != 경기 {t["g"]}')
            if sum(t['w'] for t in s['teams']) != sum(t['l'] for t in s['teams']):
                err(f'{y}: 리그 전체 승수와 패수가 다름')
        seen = Counter()
        per_team_b, per_team_p = Counter(), Counter()
        for r in s['bat']:
            pid = r[bf['id']]
            seen[('b', pid)] += 1
            if pid not in by_id:
                err(f'{y} 타자: 마스터에 없는 선수 {pid}')
            if r[bf['team']] not in names:
                err(f'{y} 타자 {pid}: 순위표에 없는 팀 {r[bf["team"]]}')
            pa, ab, h = r[bf['pa']] or 0, r[bf['ab']] or 0, r[bf['h']] or 0
            d, t, hr = r[bf['d']] or 0, r[bf['t']] or 0, r[bf['hr']] or 0
            if not (h <= ab <= pa):
                err(f'{y} 타자 {pid}: 안타 {h} ≤ 타수 {ab} ≤ 타석 {pa} 위반')
            if d + t + hr > h:
                err(f'{y} 타자 {pid}: 장타 합 {d + t + hr} > 안타 {h}')
            if pa > 750:
                err(f'{y} 타자 {pid}: 타석 {pa} 과다')
            if r[bf['bb']] is not None and (r[bf['bb']] or 0) + (r[bf['hbp']] or 0) + ab > pa:
                err(f'{y} 타자 {pid}: 타수+볼넷+사구가 타석보다 큼')
            if by_id.get(pid, {}).get('kind') != 'P':
                per_team_b[r[bf['team']]] += 1
        for r in s['pit']:
            pid = r[pf['id']]
            seen[('p', pid)] += 1
            if pid not in by_id:
                err(f'{y} 투수: 마스터에 없는 선수 {pid}')
            if r[pf['team']] not in names:
                err(f'{y} 투수 {pid}: 순위표에 없는 팀 {r[pf["team"]]}')
            outs, tbf, er, rr = r[pf['outs']] or 0, r[pf['tbf']] or 0, r[pf['er']] or 0, r[pf['r']] or 0
            if er > rr:
                err(f'{y} 투수 {pid}: 자책점 {er} > 실점 {rr}')
            if tbf < outs - 30:
                err(f'{y} 투수 {pid}: 상대 타자 {tbf}가 아웃 {outs}에 비해 너무 적음')
            if tbf < (r[pf['h']] or 0) + (r[pf['bb']] or 0) + (r[pf['so']] or 0):
                err(f'{y} 투수 {pid}: 상대 타자 수가 안타+볼넷+삼진보다 적음')
            per_team_p[r[pf['team']]] += 1
        for (k, pid), n in seen.items():
            if n > 1:
                err(f'{y}: 선수 {pid}가 {"타자" if k == "b" else "투수"} 기록에 {n}번 나옴')
        for t in names:
            if per_team_b[t] < 12:
                err(f'{y} {t}: 타자 {per_team_b[t]}명 (12명 미만)')
            if per_team_p[t] < 6:
                err(f'{y} {t}: 투수 {per_team_p[t]}명 (6명 미만)')
        L = s['league']
        if abs(L['pa'] - L['tbf']) > 0.002 * L['pa']:
            err(f'{y}: 타석 합 {L["pa"]}과 투수 상대 타자 합 {L["tbf"]}이 0.2% 넘게 다름')
        if L['hr'] != L['hrAllowed']:
            warn(f'{y}: 타자 홈런 합 {L["hr"]} != 투수 피홈런 합 {L["hrAllowed"]}')
        if L['r'] != L['runsAllowed']:
            warn(f'{y}: 타자 득점 합 {L["r"]} != 투수 실점 합 {L["runsAllowed"]}')
        if not (0.22 <= L['avg'] <= 0.31):
            err(f'{y}: 리그 타율 {L["avg"]:.3f} 범위 밖')
        miss = sum(1 for r in s['bat'] if r[bf['bb']] is None)
        if miss:
            warn(f'{y}: 볼넷·삼진이 빈 타자 {miss}행')
        nopos = sum(1 for r in s['bat'] if r[bf['pos']] is None and (r[bf['pa']] or 0) >= 30 and by_id[r[bf['id']]]['kind'] != 'P')
        if nopos:
            warn(f'{y}: 30타석 이상인데 시즌 포지션이 없는 타자 {nopos}행')

    # ---- 외국인 개막 명단 (data-src/외국인_개막명단.csv)
    for y, teams in meta.get('foreignOpening', {}).items():
        s = load(DATA / 'seasons' / f'{y}.json')
        bf = {k: i for i, k in enumerate(s['batFields'])}
        pf = {k: i for i, k in enumerate(s['pitFields'])}
        team_of = {r[bf['id']]: r[bf['team']] for r in s['bat']}
        team_of.update({r[pf['id']]: r[pf['team']] for r in s['pit']})
        unconfirmed = 0
        for t, lst in teams.items():
            regular = sum(1 for x in lst if not x['asia'])
            asia = sum(1 for x in lst if x['asia'])
            if regular > 3:
                err(f'외국인 개막 명단 {y} {t}: 일반 외국인 {regular}명 (3명까지)')
            if asia > 1:
                err(f'외국인 개막 명단 {y} {t}: 아시아쿼터 {asia}명 (1명까지)')
            for x in lst:
                pl = by_id.get(x['id'])
                if not pl:
                    err(f'외국인 개막 명단 {y} {t}: 없는 선수 ID {x["id"]}')
                    continue
                if not pl.get('foreign'):
                    err(f'외국인 개막 명단 {y} {t}: {pl["name"]}은(는) 외국인이 아님')
                if team_of.get(x['id']) != t:
                    err(f'외국인 개막 명단 {y} {t}: {pl["name"]}의 {y}년 기록 소속이 {team_of.get(x["id"])}')
                unconfirmed += not x.get('confirmed')
        if unconfirmed:
            warn(f'외국인 개막 명단 {y}: 미확인 {unconfirmed}명 (출전량·이름으로 추정한 값)')

    # ---- 신인 지명 (drafts.json, baseballchart.kr 원본)
    drafts_path = DATA / 'drafts.json'
    if drafts_path.exists():
        drafts = load(drafts_path)['years']
        known = set()
        for y in meta['years']:
            known.update(t['name'] for t in load(DATA / 'seasons' / f'{y}.json')['teams'])
        for y, lst in drafts.items():
            for d in lst:
                if d['team'] not in known:
                    err(f'신인 지명 {y}: 모르는 구단 {d["team"]} ({d["name"]})')
                if d['pos'] not in ('P', 'C', 'IF', 'OF', 'DH'):
                    err(f'신인 지명 {y}: 포지션 {d["pos"]} ({d["name"]})')
                if d['kind'] == '라운드' and not d['round']:
                    err(f'신인 지명 {y}: 라운드 없음 ({d["name"]})')
            overall = [d['overall'] for d in lst if d['overall']]
            if len(overall) != len(set(overall)):
                warn(f'신인 지명 {y}: 전체 순위가 겹침')
        two_way = sum(1 for lst in drafts.values() for d in lst if d.get('twoWay'))
        if two_way:
            warn(f'신인 지명: 포지션이 둘인 선수 {two_way}명 (앞의 포지션, 투타겸업은 투수로 봄)')

    # ---- 숨겨진 특수능력 (traits.json): 키가 실제 선수의 해시인지, 코드가 아는 값인지. 이름은 출력하지 않는다 (숨김)
    traits_path = DATA / 'traits.json'
    if traits_path.exists():
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from build_data import TRAIT_LABELS, trait_key  # noqa: E402
        keys = {trait_key(p['id']) for p in players}
        codes = set(TRAIT_LABELS.values())
        table = load(traits_path)['traits']
        for k, v in table.items():
            if k not in keys:
                err(f'특수능력: 어느 선수와도 맞지 않는 키 {k}')
            for c in v:
                if c not in codes:
                    err(f'특수능력: 모르는 코드 {c}')
            if len(v) > 3:
                warn(f'특수능력: 한 선수에 능력 {len(v)}개')
        warn(f'특수능력: {len(table)}명 (기준은 tools/suggest_traits.py, 수정은 data-src/특수능력.csv)')

    # ---- 특별 엔트리 (새 게임에서 빼는 선수, 규칙으로 고른 값이라 확인용으로 보여 준다)
    for y, ids in sorted(meta.get('specialEntries', {}).items()):
        if int(y) >= 2015:
            warn(f'특별 엔트리로 보고 새 게임에서 뺌 {y}: ' + ', '.join(by_id[i]['name'] for i in ids if i in by_id))

    print(f'검사 대상: 선수 {len(players):,}명, 시즌 {len(meta["years"])}개')
    print(f'경고 {len(warnings)}건')
    for w in warnings:
        print('  경고:', w)
    print(f'오류 {len(errors)}건')
    for e in errors[:60]:
        print('  오류:', e)
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
