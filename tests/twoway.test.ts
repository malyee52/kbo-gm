// 투타 겸업 (2026-10-13 사용자 "모든 선수가 해당 능력치를 가지게 하되 실제 능력치로 성장할 수 있는 것은 특정 몇몇만", 오타니식 + 구단 역할 선택)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { gradeAt, runsForGradeAt } from '../src/league/twoway';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('투타 겸업', () => {
  it('모든 선수가 반대쪽 능력을 갖고, 대부분은 낮고 자라지 않으며, 실제 투타겸업 지명 선수만 잠재력이 높다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'tw-1' }, FAST);
    const L = g.league;
    expect(L.players.every((p) => p.alt)).toBe(true);
    const normal = L.players.filter((p) => !p.twoWayTalent);
    expect(normal.every((p) => gradeAt(p.alt!.runs, 2026) <= 26 && gradeAt(p.alt!.potential, 2026) <= 29)).toBe(true);
    const talent = L.players.filter((p) => p.twoWayTalent);
    expect(talent.length).toBeGreaterThan(0);
    expect(talent.every((p) => gradeAt(p.alt!.potential, 2026) >= 52)).toBe(true);
    expect(L.players.find((p) => p.name === '강백호')?.twoWayTalent).toBe(true);
  }, 120_000);

  it('이도류 투수: 지명타자로도 나가고 등판 다음 날은 타석에서 쉰다. 저장·재현이 같다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'tw-2' }, FAST);
    const ace = g.team.org.filter((p) => p.isPitcher && !p.foreign && (p.pit?.startShare ?? 0) > 0.8).sort((a, b) => a.value - b.value)[0];
    const lp = g.leaguePlayer(ace.id)!;
    lp.alt = { runs: runsForGradeAt(65, 2026), potential: runsForGradeAt(70, 2026) }; // 시험용: 타격이 좋은 투수
    expect(g.setTwoWay(ace.id, true).ok).toBe(true);
    expect(g.world.players[ace.idx].alt?.bat).toBeDefined();
    g.advance(40);
    const s = g.season;
    expect(s.bat[ace.idx].pa).toBeGreaterThan(30);
    expect(s.pit[ace.idx].gs).toBeGreaterThan(3);
    // 등판 다음 날(일정 색인) 우리 경기 박스스코어에 타자로 없다
    const games = [...s.boxes.entries()].sort((a, b) => a[0] - b[0]);
    const starts = new Set(games.filter(([, b]) => [b.home, b.away].some((side) => side.pitchers[0]?.idx === ace.idx)).map(([k]) => s.log[k]?.day ?? -1));
    let checked = 0;
    for (const [k, b] of games) {
      const day = s.log[k]?.day ?? -1;
      if (!starts.has(day - 1)) continue;
      checked++;
      expect([b.home, b.away].some((side) => side.batters.some((x) => x.idx === ace.idx))).toBe(false);
    }
    expect(checked).toBeGreaterThan(0);
    // (반대쪽 능력을 시험용으로 직접 바꿔 재현 비교는 하지 않는다. 저장·불러오기는 같아야 한다)
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(h.world.players[ace.idx].alt?.bat).toBeDefined();
    h.advance(5); g.advance(5);
    expect(roundTrip(h.toSave().season)).toEqual(roundTrip(g.toSave().season));
    expect(g.setTwoWay(ace.id, false).ok).toBe(true);
    expect(g.world.players[ace.idx].alt).toBeUndefined();
  }, 600_000);

  it('오프시즌: 반대쪽 능력도 자라고(겸업 재능만 크게), 실제 투타겸업 지명 신인(하현승)은 겸업 재능', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'tw-3' }, FAST);
    const talent = g.league.players.filter((p) => p.twoWayTalent && p.team >= 0);
    const before = new Map(talent.map((p) => [p.id, p.alt!.runs]));
    g.advance(100000);
    g.beginOffseason();
    for (const p of talent) {
      const lp = g.leaguePlayer(p.id);
      if (lp && lp.birthYear && 2027 - lp.birthYear <= 26) expect(lp.alt!.runs, lp.name).toBeGreaterThan(before.get(p.id)!);
    }
    let guard = 0;
    while (g.offseason!.stage !== 'ready' && guard++ < 40) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    const ha = g.league.players.find((p) => p.name === '하현승');
    expect(ha?.twoWayTalent).toBe(true);
    g.openNextSeason();
    expect(g.leaguePlayer(ha!.id)!.alt).toBeDefined();
  }, 900_000);
});
