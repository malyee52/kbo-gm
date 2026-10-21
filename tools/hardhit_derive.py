#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""하드힛 CSV 원본 → 커밋할 수 있는 가공 파일 (data-src/hardhit_derived/).

사용법:  python -I -X utf8 tools/hardhit_derive.py
읽는 것: data-src/hardhit/ (원본, 커밋하지 않는다), public/data/players.json·meta.json·seasons/ (선수 연결용)
만드는 것:
  data-src/hardhit_derived/bat_running.csv   타자 도루·도루실패·병살타 (2003~, 타자 classic)
  data-src/hardhit_derived/pitch_hand.csv    투수 투구손·언더핸드 (1982~, 투수 classic 파일의 투구손 구분 _좌/_우/_좌언/_우언)
  data-src/hardhit_derived/clutch_bat.csv    타자 클러치·득점권 (2015~, 타자 clutch): WPA, WPA/LI, CLUTCH, pLI, 득점권 타율, SD/MD
  data-src/hardhit_derived/clutch_pit.csv    투수 상황 기록 (1982~, 투수 situation): WPA, RE24, SD/MD, gmLI, pLI, 홀드, 세이브, 블론
  reports/hardhit-unmatched.md               연결률과 못 맞춘 행

원본 표를 그대로 옮기지 않고, 게임 선수 ID에 연결한 필요한 값만 남긴다.
기록 일부: 하드힛(https://hardhit.ai), 비상업적 이용.
"""
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hardhit_common import HAND_SUFFIX, RAW, ROOT, SKIPPED, Matcher, files, num, read_file  # noqa: E402

OUT = ROOT / 'data-src' / 'hardhit_derived'
REPORT = ROOT / 'reports' / 'hardhit-unmatched.md'


class Log:
    """종류·연도별 연결 결과와 못 맞춘 행"""

    def __init__(self):
        self.count = defaultdict(Counter)  # 종류 → 사유별 건수
        self.by_year = defaultdict(Counter)  # (종류, 연도) → ok / miss
        self.missed = defaultdict(list)  # 종류 → [(연도, 손, 이름, 팀, 나이, 사유)]

    def add(self, kind, year, hand, row, pid, why):
        self.count[kind][why] += 1
        self.by_year[(kind, year)]['ok' if pid else 'miss'] += 1
        if not pid:
            self.missed[kind].append((year, hand or '', row.get('이름'), row.get('팀'), row.get('나이', ''), why))

    def write(self, extra):
        lines = ['# 하드힛 선수 연결 결과', '',
                 '`python -I -X utf8 tools/hardhit_derive.py`가 만든다. 키는 (연도, 이름, 팀 계보, 나이)이고, 이름이 같은 후보가 여럿이면 팀 → 나이로 좁힌다.',
                 '그래도 둘 이상이면 짐작하지 않고 비운다 (ambiguous). 사유: no-name = 게임 선수 마스터에 없는 이름, not-in-season = 그 해 게임 기록에 없음,',
                 'team-differs = 이름이 하나뿐이라 연결했지만 팀이 다름 (연결됨), by-stats = 이름이 없거나 겹쳐 같은 팀·나이에서 기록(타석·안타, 투수는 경기·아웃)이 똑같은 한 명에 연결 (개명 등).', '']
        lines += extra
        lines += ['## 종류별', '', '| 종류 | 연결 | 팀 다름(연결) | 기록 대조(연결) | 못 맞춤 | 연결률 |', '|---|---:|---:|---:|---:|---:|']
        for kind, c in self.count.items():
            ok = c['ok'] + c['team-differs'] + c['by-stats']
            miss = sum(v for k, v in c.items() if k not in ('ok', 'team-differs', 'by-stats'))
            lines.append(f'| {kind} | {c["ok"]} | {c["team-differs"]} | {c["by-stats"]} | {miss} | {ok / max(1, ok + miss):.1%} |')
        lines += ['', '## 연도별 연결률', '']
        kinds = list(self.count)
        years = sorted({y for _, y in self.by_year})
        lines += ['| 연도 | ' + ' | '.join(kinds) + ' |', '|---|' + '---:|' * len(kinds)]
        for y in years:
            cells = []
            for k in kinds:
                c = self.by_year.get((k, y))
                cells.append(f'{c["ok"] / (c["ok"] + c["miss"]):.1%} ({c["miss"]})' if c else '-')
            lines.append(f'| {y} | ' + ' | '.join(cells) + ' |')
        lines += ['', '괄호는 못 맞춘 행 수.', '', '## 못 맞춘 행', '']
        for kind, rows in self.missed.items():
            lines += [f'### {kind} ({len(rows)}행)', '', '| 연도 | 손 | 이름 | 팀 | 나이 | 사유 |', '|---|---|---|---|---|---|']
            lines += [f'| {y} | {h} | {n} | {t} | {a} | {w} |' for y, h, n, t, a, w in rows]
            lines.append('')
        REPORT.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def write_csv(name, header, rows):
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / name).open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(header)
        w.writerows(rows)
    print(f'{name}: {len(rows)}행')


def bat_running(M, log):
    """타자 classic → 연도, 선수ID, 도루, 도루실패, 병살타"""
    out = []
    for y, _, p in files('batter', 'classic'):
        if y not in M.seasons:
            continue
        for r in read_file(p)[1]:
            pid, why = M.match(y, r['이름'], r['팀'], num(r['나이']), 'bat', {'pa': num(r['타석']), 'h': num(r['안타'])})
            log.add('타자 classic', y, None, r, pid, why)
            if pid:
                v = [num(r['도루']), num(r['도루실패']), num(r['병살타'])]
                out.append([y, pid] + ['' if x is None else int(x) for x in v])
    out.sort(key=lambda r: (r[0], r[1]))
    write_csv('bat_running.csv', ['연도', '선수ID', '도루', '도루실패', '병살타'], out)


def outs_of(ip):
    """'178.2' → 536"""
    v = num(ip)
    if v is None:
        return None
    whole = int(v)
    return whole * 3 + round((v - whole) * 10)


def pitcher_stats(r):
    return {'g': num(r['경기']), 'outs': outs_of(r['이닝'])}


def pitch_hand(M, log):
    """투수 classic (투구손별 파일) → 연도, 선수ID, 손, 언더"""
    out = []
    for y, hand, p in files('pitcher', 'classic'):
        if y not in M.seasons or hand is None:
            continue
        th, under = HAND_SUFFIX[hand]
        for r in read_file(p)[1]:
            pid, why = M.match(y, r['이름'], r['팀'], num(r['나이']), 'pit', pitcher_stats(r))
            log.add('투수 classic', y, hand, r, pid, why)
            if pid:
                out.append([y, pid, th, int(under)])
    out.sort(key=lambda r: (r[0], r[1]))
    write_csv('pitch_hand.csv', ['연도', '선수ID', '손', '언더'], out)


def kbb_names(M):
    """투수 kbb·classic 파일 → {(연도, 손, 나이, 보직, 경기, 이닝): {(이름, 팀), ...}}

    투수 saber·situation 파일은 이름과 팀이 모두 '-'로 나온다 (사이트 버그, 사용자 확인).
    같은 연도·같은 손의 kbb 파일과 (나이, 보직, 경기, 이닝)으로 맞대 이름과 팀을 채운다 (사용자 지시).
    kbb_2025_좌 파일이 2024 자료라 빠지므로, 이름이 있는 classic 파일도 같은 키로 함께 쓴다 (두 파일의 같은 선수는 하나로 센다).
    키가 겹치면 kbb와 공통인 열(SD, MD, gmLI, pLI, BABIP, K%, BB%)이 모두 같은 한 명으로 가른다. 그래도 둘 이상이면 비운다."""
    names = defaultdict(set)
    second = {}
    for table in ('kbb', 'classic'):
        for y, hand, p in files('pitcher', table):
            if hand is None:
                continue
            for r in read_file(p)[1]:
                key = (y, hand, r['나이'], r['보직'], r['경기'], r['이닝'])
                names[key].add((r['이름'], r['팀']))
                if table == 'kbb':
                    second[key + (r['이름'], r['팀'])] = tuple(r[c] for c in SECOND)
    return names, second


SECOND = ('SD', 'MD', 'gmLI', 'pLI', 'BABIP', 'K%', 'BB%')


def named_pitchers(M, log, table, names, fill):
    """이름이 가려진 투수 표 → [(연도, 손, 선수ID, 행)]. fill[표] = 사유별 건수 (kbb 맞대기 결과)"""
    out = []
    for y, hand, p in files('pitcher', table):
        if y not in M.seasons or hand is None:
            continue
        for r in read_file(p)[1]:
            if r['이름'] in ('-', ''):
                key = (y, hand, r['나이'], r['보직'], r['경기'], r['이닝'])
                hit = names[0].get(key, set())
                if len(hit) > 1:
                    mine = tuple(r[c] for c in SECOND)
                    hit = {h for h in hit if names[1].get(key + h) == mine}
                    fill[table]['겹침 → 공통 열로 가름'] += len(hit) == 1
                if len(hit) != 1:
                    fill[table]['겹침' if hit else '못 맞춤'] += 1
                    log.add(f'투수 {table}', y, hand, r, None, 'kbb-ambiguous' if hit else 'kbb-none')
                    continue
                fill[table]['채움'] += 1
                name, team = next(iter(hit))
                r = dict(r, 이름=name, 팀=team)
            pid, why = M.match(y, r['이름'], r['팀'], num(r['나이']), 'pit', pitcher_stats(r))
            log.add(f'투수 {table}', y, hand, r, pid, why)
            if pid:
                out.append((y, hand, pid, r))
    return out


def cell(v, digits=3):
    x = num(v)
    return '' if x is None else round(x, digits)


def clutch_bat(M, log):
    """타자 clutch (2015~) → 연도, 선수ID, 타석, WPA, WPA/LI, CLUTCH, pLI, 득점권 타율, 타율, SD, MD"""
    out = []
    for y, _, p in files('batter', 'clutch'):
        if y not in M.seasons:
            continue
        for r in read_file(p)[1]:
            pid, why = M.match(y, r['이름'], r['팀'], None, 'bat', {'pa': num(r['PA'])})
            log.add('타자 clutch', y, None, r, pid, why)
            if pid:
                out.append([y, pid, int(num(r['PA']) or 0), cell(r['WPA']), cell(r['WPA/LI']), cell(r['CLUTCH']), cell(r['pLI']),
                            cell(r['RISP']), cell(r['AVG']), cell(r['SD'], 0), cell(r['MD'], 0)])
    out.sort(key=lambda r: (r[0], r[1]))
    write_csv('clutch_bat.csv', ['연도', '선수ID', '타석', 'WPA', 'WPA/LI', 'CLUTCH', 'pLI', '득점권타율', '타율', 'SD', 'MD'], out)


def clutch_pit(M, log, names, fill):
    """투수 situation (1982~) → 연도, 선수ID, 보직, 경기, 아웃, WPA, RE24, SD, MD, gmLI, pLI, 홀드, 세이브, 블론"""
    out = []
    for y, hand, pid, r in named_pitchers(M, log, 'situation', names, fill):
        out.append([y, pid, r['보직'], int(num(r['경기']) or 0), outs_of(r['이닝']) or 0, cell(r['WPA']), cell(r['RE24'], 2),
                    cell(r['SD'], 0), cell(r['MD'], 0), cell(r['gmLI'], 2), cell(r['pLI'], 2),
                    cell(r['HLD'], 0), cell(r['SV'], 0), cell(r['BSV'], 0)])
    out.sort(key=lambda r: (r[0], r[1]))
    write_csv('clutch_pit.csv', ['연도', '선수ID', '보직', '경기', '아웃', 'WPA', 'RE24', 'SD', 'MD', 'gmLI', 'pLI', '홀드', '세이브', '블론'], out)


def main():
    if not RAW.exists():
        raise SystemExit(f'원본 폴더가 없다: {RAW} (하드힛 CSV는 사용자가 직접 받아 넣는다)')
    M = Matcher()
    log = Log()
    extra = []
    bat_running(M, log)
    pitch_hand(M, log)
    names = kbb_names(M)
    fill = defaultdict(Counter)
    clutch_bat(M, log)
    clutch_pit(M, log, names, fill)
    extra += ['## 이름이 가려진 투수 표 (saber·situation)', '',
              '같은 연도·같은 손의 kbb(와 classic) 파일과 (나이, 보직, 경기, 이닝)으로 맞대 이름과 팀을 채웠다. 둘 이상 맞으면 kbb와 공통인 열(SD, MD, gmLI, pLI, BABIP, K%, BB%)이 모두 같은 한 명으로 가르고, 그래도 둘 이상이면 짐작하지 않고 비운다.', '',
              '| 표 | 채움 | 그중 겹침을 공통 열로 가름 | 겹침(비움) | 못 맞춤 |', '|---|---:|---:|---:|---:|']
    extra += [f'| {t} | {c["채움"]} | {c["겹침 → 공통 열로 가름"]} | {c["겹침"]} | {c["못 맞춤"]} |' for t, c in fill.items()]
    extra.append('')
    if SKIPPED:
        extra += ['## 건너뛴 원본 파일', '', '파일 이름의 연도와 속 메타의 시즌이 달라 건너뛰었다 (다른 해 파일과 내용이 같다). 그 해 자료는 빠져 있다.', '']
        extra += [f'- {n}: 속은 {y}년 자료' for n, y in SKIPPED] + ['']
    log.write(extra)
    print(f'보고: {REPORT}')


if __name__ == '__main__':
    main()
