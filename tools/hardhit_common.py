# -*- coding: utf-8 -*-
"""하드힛 CSV 원본 읽기와 게임 선수 연결 (tools/hardhit_derive.py에서 쓴다).

원본은 data-src/hardhit/ (사용자가 하드힛 유료 회원으로 직접 받은 파일, 커밋하지 않는다).
각 파일은 앞에 '항목,값' 메타 줄이 있고, 열이 5개 넘는 첫 줄이 머리줄이다.
"""
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data-src' / 'hardhit'
DATA = ROOT / 'public' / 'data'

# 투수 파일의 투구손 접미사 → (던지는 손, 언더핸드 여부)
HAND_SUFFIX = {'좌': ('L', False), '우': ('R', False), '우언': ('R', True), '좌언': ('L', True)}

NAME_RE = re.compile(r'^hardhit_(batter|pitcher)_([a-z]+)_(\d{4})(?:_(좌언|우언|좌|우))?\.csv$')


def read_file(path):
    """→ (메타 dict, 데이터 행 list[dict])"""
    with path.open(encoding='utf-8-sig', newline='') as f:
        lines = list(csv.reader(f))
    meta, header, data = {}, None, []
    for row in lines:
        if header is None:
            if len(row) > 5:
                header = row
            elif len(row) >= 2:
                meta[row[0]] = row[1]
            continue
        if len(row) == len(header):
            data.append(dict(zip(header, row)))
    return meta, data


# 파일 이름의 연도와 속 메타의 시즌이 다른 파일 (다른 해 파일과 내용이 같다) → 건너뛴다
SKIPPED = []


def files(kind, table):
    """종류(batter/pitcher)·표(classic/clutch/saber/...)의 원본 파일 → [(연도, 손 접미사 또는 None, 경로)]

    연도는 파일 속 메타('기준 시즌' 또는 '표시 시즌')를 믿는다. 파일 이름과 다르면 잘못 받은 파일이라 건너뛴다
    (2026-10-22 확인: pitcher_kbb_2025_좌 = 2024 자료, batter_saber_2022 = 2020 자료로 각각 그 해 파일과 같다)."""
    out = []
    for p in sorted(RAW.glob(f'hardhit_{kind}_{table}_*.csv')):
        m = NAME_RE.match(p.name)
        if not m:
            continue
        meta, _ = read_file(p)
        season = meta.get('기준 시즌') or meta.get('표시 시즌')
        if season and int(season) != int(m.group(3)):
            if p.name not in [s for s, _ in SKIPPED]:
                SKIPPED.append((p.name, int(season)))
            continue
        out.append((int(m.group(3)), m.group(4), p))
    return out


def num(v):
    """'1,234' '12.5%' '-' '' → float 또는 None"""
    if v is None:
        return None
    v = v.strip().replace(',', '').rstrip('%')
    if v in ('', '-'):
        return None
    try:
        return float(v)
    except ValueError:
        return None


class Matcher:
    """하드힛 (연도, 이름, 팀, 나이) → 게임 선수 ID.

    후보는 그 해 게임 시즌 기록에 있는 선수다 (투수 파일은 투수 기록, 타자 파일은 타자 기록 먼저).
    이름이 같은 후보가 여럿이면 팀 계보, 다음으로 나이(생년 기준 ±1)로 좁힌다. 그래도 둘 이상이면 짐작하지 않는다.
    """

    def __init__(self):
        self.players = {p['id']: p for p in json.loads((DATA / 'players.json').read_text(encoding='utf-8'))['players']}
        meta = json.loads((DATA / 'meta.json').read_text(encoding='utf-8'))
        self.years = meta['years']
        # (팀 이름, 연도) → 계보. 하드힛은 그 시대 이름을 쓴다 (예: 빙그레, OB, 넥센)
        self.franchise_of = {}
        for fr, spans in meta['franchises'].items():
            for s in spans:
                for y in range(s['from'], s['to'] + 1):
                    self.franchise_of[(s['name'], y)] = fr
        self.rows = {}  # (연도, 'bat'|'pit') → {선수ID: [기록 행 dict, ...]}
        self.seasons = {}
        for y in self.years:
            s = json.loads((DATA / 'seasons' / f'{y}.json').read_text(encoding='utf-8'))
            self.seasons[y] = s
            for side, key in (('bat', 'batFields'), ('pit', 'pitFields')):
                d = defaultdict(list)
                for r in s[side]:
                    d[r[0]].append(dict(zip(s[key], r)))
                self.rows[(y, side)] = d
        self.by_name = defaultdict(list)
        for p in self.players.values():
            self.by_name[p['name']].append(p['id'])

    def franchise(self, team, year):
        if team in ('', '-', None):
            return None
        return self.franchise_of.get((team, year), self.franchise_of.get((ALIAS.get(team, team), year), team))

    def teams_of(self, pid, year):
        return {self.franchise(r['team'], year) for side in ('bat', 'pit') for r in self.rows[(year, side)].get(pid, [])}

    def stats_equal(self, pid, year, side, stats):
        """게임 시즌 기록 중 한 행이 stats(필드 → 값)와 모두 같은가"""
        return any(all((r.get(k) or 0) == v for k, v in stats.items()) for r in self.rows[(year, side)].get(pid, []))

    def match(self, year, name, team, age, side, stats=None):
        """→ (선수ID 또는 None, 사유). 사유: ok / team-differs / by-stats / ambiguous / no-name / not-in-season

        stats(게임 기록 필드 → 값, 예: 타석·안타)가 있으면 이름이 같은 후보가 여럿일 때 기록으로 가르고,
        이름이 없을 때(개명·표기 차이, 예: 한동민 → 한유섬) 같은 팀·나이에서 기록이 똑같은 선수가 하나뿐이면 연결한다 (by-stats).
        """
        fr = self.franchise(team, year)

        def age_ok(i):
            b = self.players[i].get('birthYear')
            return age is None or b is None or -1 <= age - (year - b) <= 0  # 하드힛 나이는 연도-생년 또는 그보다 1 적다

        def by_stats(why):
            if stats and fr and any(stats.values()):
                c = [i for i in self.rows[(year, side)] if fr in self.teams_of(i, year) and age_ok(i) and self.stats_equal(i, year, side, stats)]
                if len(c) == 1:
                    return c[0], 'by-stats'
            return None, why

        ids = self.by_name.get(name, [])
        if not ids:
            return by_stats('no-name')
        other = 'pit' if side == 'bat' else 'bat'
        cand = [i for i in ids if i in self.rows[(year, side)]]
        if not cand:
            cand = [i for i in ids if i in self.rows[(year, other)]]
        if not cand:
            return by_stats('not-in-season')
        if len(cand) > 1:
            c2 = [i for i in cand if fr in self.teams_of(i, year)] if fr else cand
            if len(c2) != 1:
                c2 = [i for i in (c2 or cand) if age_ok(i)]
            if len(c2) != 1 and stats:
                c2 = [i for i in (c2 or cand) if self.stats_equal(i, year, side, stats)]
            if len(c2) != 1:
                return None, 'ambiguous'
            return c2[0], 'ok'
        i = cand[0]
        if not age_ok(i) and len(ids) > 1:
            return None, 'ambiguous'
        if fr and fr not in self.teams_of(i, year):
            return i, 'team-differs'
        return i, 'ok'


# 하드힛 팀 표기가 게임 시즌 자료와 다를 때 (필요하면 더한다)
ALIAS = {}
