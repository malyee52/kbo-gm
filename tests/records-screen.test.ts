// 순위·개인 기록 화면 (2026-10-23 UI 2단계 U2-4): 전체 표 줄의 규정 판정·거르기, 순위 줄(게임차·연속·남은 경기)과 공통 표 정렬.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, lineTeam } from '../src/engine';
import { GameSession } from '../src/game/session';
import { batQualified, leaders, BAT_CATEGORIES, pitQualified, qualifiedOuts, qualifiedPa } from '../src/game/stats';
import { seasonWar } from '../src/league/awards';
import { batRecs, EMPTY_REC_FILTER, filterRecs, pitRecs, pitRole } from '../src/ui/records';
import { sortRows } from '../src/ui/table';
import { standRows, STAND_COLS } from '../src/ui/screens/Standings';

let g: GameSession;

beforeAll(() => {
  const store = loadDataStore();
  const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'records' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
  g.advance(40, { event: false, tradeOffer: false, injury: false, cast: false });
}, 120_000);

describe('개인 기록 전체 표', () => {
  it('타석·상대 타자가 있는 선수 전부, 규정 판정은 1위 보드와 같다', () => {
    const s = g.season;
    const war = seasonWar(g.world, s);
    const bats = batRecs(g.world.players, s, war);
    const pits = pitRecs(g.world.players, s, war);
    expect(bats.length).toBe(g.world.players.filter((p) => s.bat[p.idx].pa > 0 && s.teams[lineTeam(p)]).length);
    for (const r of bats) {
      expect(r.q).toBe(batQualified(r.l, s.teams[r.team].g));
      expect(r.q).toBe(r.l.pa >= qualifiedPa(s.teams[r.team].g));
    }
    for (const r of pits) expect(r.q).toBe(pitQualified(r.l, s.teams[r.team].g) && r.l.outs >= qualifiedOuts(s.teams[r.team].g));
    // 규정 이상 타율 1위 = 1위 보드 타율 1위
    const q = filterRecs(bats, { ...EMPTY_REC_FILTER, qualified: true }).filter((r) => !r.p.isPitcher);
    const best = [...q].sort((a, b) => b.l.h / b.l.ab - a.l.h / a.l.ab || a.p.idx - b.p.idx)[0];
    const board = leaders(g.world.players.filter((p) => !p.isPitcher), s.bat, BAT_CATEGORIES[0], s.teams, batQualified, 1)[0];
    expect(best.p.idx).toBe(board.player.idx);
  });
  it('거르기: 팀·자리·나이·규정을 함께 건다', () => {
    const s = g.season;
    const war = seasonWar(g.world, s);
    const bats = batRecs(g.world.players, s, war);
    const me = g.teamIdx;
    const f = filterRecs(bats, { team: me, pos: 'SS', ageMax: 30, qualified: false });
    expect(f.every((r) => r.team === me && r.pos === 'SS' && r.age !== null && r.age <= 30)).toBe(true);
    expect(filterRecs(bats, { ...EMPTY_REC_FILTER, ageMax: 15 })).toEqual([]);
    const pits = pitRecs(g.world.players, s, war);
    expect(filterRecs(pits, { ...EMPTY_REC_FILTER, pos: 'SP' }).every((r) => r.role === 'SP' && r.l.gs > 0)).toBe(true);
    expect(pitRole({ g: 10, gs: 5 })).toBe('SP');
    expect(pitRole({ g: 10, gs: 4 })).toBe('RP');
    expect(pitRole({ g: 0, gs: 0 })).toBe('RP');
  });
});

describe('순위표', () => {
  it('순위 순으로, 1위 게임차 없음, 남은 경기 = 일정에 남은 경기, 연속은 연승 +·연패 −', () => {
    const s = g.season;
    const rows = standRows(s);
    expect(rows.map((r) => r.team)).toEqual(s.standings());
    expect(rows[0].gb).toBeNull();
    expect(rows.slice(1).every((r) => r.gb !== null && r.gb >= 0)).toBe(true);
    const left = s.schedule.slice(s.day).flat().filter((x) => x.home === rows[0].team || x.away === rows[0].team).length;
    expect(rows[0].left).toBe(left);
    for (const r of rows) {
      if (r.f.streak.endsWith('연승')) expect(r.streak).toBeGreaterThan(0);
      else if (r.f.streak.endsWith('연패')) expect(r.streak).toBeLessThan(0);
      else expect(r.streak).toBe(0);
    }
  });
  it('공통 표 정렬: 득실차 높은 순, 다시 순위 순', () => {
    const rows = standRows(g.season);
    const byDiff = sortRows(rows, STAND_COLS, { key: 'diff', desc: true });
    for (let i = 1; i < byDiff.length; i++) expect(byDiff[i - 1].t.rs - byDiff[i - 1].t.ra).toBeGreaterThanOrEqual(byDiff[i].t.rs - byDiff[i].t.ra);
    expect(sortRows(rows, STAND_COLS, { key: 'rank', desc: false }).map((r) => r.rank)).toEqual(rows.map((r) => r.rank));
  });
});
