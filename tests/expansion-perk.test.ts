// 창단 특례 (2026-10-23 사용자 결정 "빈 자료 물음 4"): 1군 첫 두 시즌 외국인 +1·1군 엔트리 +1·외부 FA 보상선수 면제.
// kt 2015~2016 (자료집 제도연표 41), NC 2013~2014 (나무위키 원문), 게임 안 창단도 같은 규칙.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, teamRules } from '../src/engine';
import { GameSession } from '../src/game/session';
import { createLeague } from '../src/league/create';
import { EXPANSION_PERK_FROM, expansionPerk, foreignRule, teamForeignRule } from '../src/league/eras';
import * as Off from '../src/league/offseason';
import { perkTeamsFor, ruleNews, ruleSnapshot } from '../src/league/ruleNews';
import { worldFromLeague } from '../src/league/world';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

describe('창단 특례 판정', () => {
  it('1군 첫해부터 두 시즌만, NC(2013) 전 창단 구단(빙그레 1986·쌍방울 1991)은 없다', () => {
    const league = { expansions: [{ team: 9, firstYear: 2015 }, { team: 7, firstYear: 1986 }, { team: 10, firstYear: 2030 }] };
    expect(EXPANSION_PERK_FROM).toBe(2013);
    expect([2014, 2015, 2016, 2017].map((y) => expansionPerk(league, 9, y))).toEqual([false, true, true, false]);
    expect(expansionPerk(league, 7, 1986)).toBe(false);
    // 게임 안 창단 (자료 없는 해)도 같은 규칙
    expect([2030, 2031, 2032].map((y) => expansionPerk(league, 10, y))).toEqual([true, true, false]);
    expect(expansionPerk(league, 3, 2015)).toBe(false);
  });

  it('외국인 한도: 특례 구단만 아시아쿼터 아닌 자리 1명 더, 외국인 제도가 없는 해는 그대로', () => {
    const league = { expansions: [{ team: 9, firstYear: 2015 }] };
    const rule = foreignRule(store.meta, 2015);
    expect(teamForeignRule(rule, league, 9, 2015)).toEqual({ total: rule.total + 1, asia: rule.asia, regular: rule.regular + 1 });
    expect(teamForeignRule(rule, league, 3, 2015)).toEqual(rule);
    const none = { total: 0, asia: 0, regular: 0 };
    expect(teamForeignRule(none, league, 9, 2015)).toEqual(none);
  });
});

describe('kt 2015 (시작 때 이미 1군)', () => {
  it('2015 시작: kt 엔트리 28명·외국인 4명, 다른 구단은 27명·3명. 2016도 특례, 2017 시작은 없음', () => {
    const { league, world } = createLeague(store, 2015, 'perk-kt', FAST);
    const kt = league.teams.findIndex((t) => t.franchise === 'KT');
    expect(league.expansions).toEqual([{ team: kt, firstYear: 2015 }]);
    expect(teamRules(world, world.teams[kt])).toEqual({ rosterSize: 28, activeSize: 26, foreignLimit: 4, foreignActive: 3 });
    for (const t of world.teams.filter((x) => x.idx !== kt)) expect(teamRules(world, t)).toEqual({ rosterSize: 27, activeSize: 25, foreignLimit: 3, foreignActive: 2 });
    const w16 = worldFromLeague({ ...league, year: 2016 }, store, FAST);
    expect(teamRules(w16, w16.teams[kt])).toEqual({ rosterSize: 28, activeSize: 26, foreignLimit: 4, foreignActive: 3 });
    const later = createLeague(store, 2017, 'perk-kt', FAST);
    expect(later.league.expansions ?? []).toEqual([]);
  });

  it('플레이어 kt: 1군 28명까지 등록할 수 있고 29명은 막힌다, 외국인 4명까지', () => {
    const probe = createLeague(store, 2015, 'perk-entry', FAST).league;
    const kt = probe.teams.findIndex((t) => t.franchise === 'KT');
    const g = GameSession.create(store, { year: 2015, teamIdx: kt, seed: 'perk-entry' }, FAST);
    const org = g.team.org.filter((p) => !p.dev && !p.foreign);
    const err = (n: number) => g.checkEntry(org.slice(0, n).map((p) => p.idx)).errors.filter((e) => e.startsWith('1군 엔트리'));
    expect(err(28)).toEqual([]);
    expect(err(29)[0]).toContain('최대 28명');
  });
});

describe('kt 2014 시작 (퓨처스 구단) → 2014 시즌 뒤 오프시즌', () => {
  let g: GameSession;
  let kt: number;
  beforeAll(() => {
    const probe = createLeague(store, 2014, 'perk-off', FAST).league;
    kt = probe.teams.findIndex((t) => t.franchise === 'KT');
    g = GameSession.create(store, { year: 2014, teamIdx: 0, seed: 'perk-off' }, FAST);
    g.advance(1000);
    g.beginOffseason();
  }, 120_000);

  it('FA 보상: kt 영입은 보상선수 없이 보상금만, 다른 구단은 등급제 전 P2 규정. 2016 시즌 뒤 kt는 특례가 끝난다', () => {
    const off = g.offseason!;
    expect(Off.faCompRule(g.league, off, 'P2', kt)).toEqual({ cashOnly: 3, withPlayer: null, protect: null, perk: true });
    expect(Off.faCompRule(g.league, off, 'P2', 0)).toEqual({ cashOnly: 3, withPlayer: 2, protect: 20, perk: false });
    expect(Off.faCompRule(g.league, { year: 2015 }, 'P2', kt).perk).toBe(true);
    expect(Off.faCompRule(g.league, { year: 2016 }, 'P2', kt).perk).toBe(false);
    // 등급제 뒤 (가상 창단): 그 등급의 보상금만 비율, C등급은 원래 보상선수가 없어 특례가 아니다
    expect(Off.faCompRule(g.league, off, 'A', kt)).toMatchObject({ cashOnly: 3, withPlayer: null, perk: true });
    expect(Off.faCompRule(g.league, off, 'C', kt)).toMatchObject({ cashOnly: 1.5, withPlayer: null, perk: false });
  });

  it('kt가 데려간 FA는 보상선수 단계에 없고 장부에 직전 연봉 300% 보상금만 남는다', () => {
    while (g.offseason!.stage === 'fa') g.nextStage();
    const off = g.offseason!;
    expect((off.comp ?? []).filter((c) => c.to === kt)).toEqual([]);
    const signed = off.fa.entries.filter((e) => e.status === 'signed' && e.team === kt && e.from !== kt && !e.returnee);
    expect(signed.length).toBeGreaterThan(0); // 시드 perk-off: 이성열·김강민
    for (const e of signed) {
      const name = g.leaguePlayer(e.id)!.name;
      const l = g.league.ledger.find((x) => x.note.startsWith(`${name} FA 보상금`) && x.from === kt)!;
      expect(l.note).toContain('창단 특례');
      expect(l.amount).toBe(Math.round(3 * e.prevSalary));
    }
  });

  it('외국인 보유 한도: kt 4명, 다른 구단 3명 (2015 시즌)', () => {
    const off = g.offseason!;
    expect(Off.foreignLimits(off, g.league, kt).regular).toBe(4);
    expect(Off.foreignLimits(off, g.league, 0).regular).toBe(3);
  });
});

describe('개막 알림과 규칙 연표', () => {
  it('1군 첫해에 "창단 특례" 줄, 특례가 끝난 다음 해에 "창단 특례 끝" 줄', () => {
    const league = { teams: [{ name: 'KT', franchise: 'KT' }, { name: '가상', franchise: 'X' }], expansions: [{ team: 0, firstYear: 2015 }, { team: 1, firstYear: 2030 }] };
    const at = (year: number) => ruleNews({ year, now: ruleSnapshot(store.meta, year), prev: ruleSnapshot(store.meta, year - 1), perks: perkTeamsFor(league, year) });
    const l15 = at(2015).main.find((l) => l.title.startsWith('창단 특례'))!;
    expect(l15.title).toBe('창단 특례: KT (2015~2016 시즌)');
    expect(l15.status).toBe('confirmed');
    expect(at(2016).main.some((l) => l.title.startsWith('창단 특례'))).toBe(false);
    expect(at(2017).main.find((l) => l.title.startsWith('창단 특례'))!.title).toBe('창단 특례 끝: KT');
    expect(at(2030).main.find((l) => l.title.startsWith('창단 특례'))!.status).toBe('virtual');
  });

  it('2015 시작 요약에 kt 특례가 들어간다', () => {
    const g = GameSession.create(store, { year: 2015, teamIdx: 0, seed: 'perk-news' }, FAST);
    expect(g.ruleNewsFor(2015).summary.some((s) => s.startsWith('창단 특례 KT (2015~2016 시즌)'))).toBe(true);
  });
});
