// 프랜차이즈 등급과 트레이드 가산치 (docs/프랜차이즈_트레이드_기획안.md, 2026-11-05 사용자 결정). 악용 시나리오는 tests/trade.test.ts E9~.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluateTrade, FRANCHISE_PREMIUM, franchisePremium, type TeamSituation } from '../src/ai/trade';
import type { ValueContext } from '../src/ai/value';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng, type SimPlayer } from '../src/engine';
import { GameSession } from '../src/game/session';
import { createLeague } from '../src/league/create';
import { ensureTenureWar, faSoon, franchiseRecord, franchiseTier, TIER_A, TIER_B, TITLE_SEASONS, titleKeysOf } from '../src/league/franchise';
import type { LeaguePlayer, LeagueState } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

function newGame(seed = 'franchise') {
  const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  return GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
}

describe('등급 판정', () => {
  let league: LeagueState;
  let p: LeaguePlayer;
  const noTitles = new Map<string, Set<string>>();
  const fr = () => league.teams[0].franchise;
  const set = (seasons: number, war: number) => { p.history = []; p.tenure0 = { franchise: fr(), seasons, war }; };
  const titled = (...keys: string[]) => new Map([[p.id, new Set(keys)]]);

  beforeAll(() => {
    league = createLeague(store, 2026, 'franchise-tier', FAST).league;
    p = league.players.find((x) => x.team === 0 && !x.foreign)!;
  });

  it('재직·구단 WAR 경계값', () => {
    set(TIER_A.seasons, TIER_A.war);
    expect(franchiseTier(p, league, 0, noTitles)).toBe(2);
    set(TIER_A.seasons - 1, TIER_A.war + 50);
    expect(franchiseTier(p, league, 0, noTitles)).toBe(1);
    set(TIER_A.seasons, TIER_A.war - 0.1);
    expect(franchiseTier(p, league, 0, noTitles)).toBe(1);
    set(TIER_B.seasons, TIER_B.war);
    expect(franchiseTier(p, league, 0, noTitles)).toBe(1);
    set(TIER_B.seasons - 1, TIER_A.war);
    expect(franchiseTier(p, league, 0, noTitles)).toBe(0);
    set(TIER_B.seasons, TIER_B.war - 0.1);
    expect(franchiseTier(p, league, 0, noTitles)).toBe(0);
  });

  it('칭호: 프랜차이즈 스타는 그 구단 것만, 레전드·원클럽맨은 재직이 있어야 올린다', () => {
    set(10, TIER_B.war - 1);
    expect(franchiseTier(p, league, 0, titled(`fstar:${fr()}`))).toBe(1);
    expect(franchiseTier(p, league, 0, titled('fstar:다른구단'))).toBe(0);
    set(10, TIER_B.war);
    expect(franchiseTier(p, league, 0, titled(`fstar:${fr()}`))).toBe(2);
    set(TITLE_SEASONS, 0);
    expect(franchiseTier(p, league, 0, titled('L:1'))).toBe(2);
    expect(franchiseTier(p, league, 0, titled('one15'))).toBe(2);
    set(TITLE_SEASONS - 1, 0);
    expect(franchiseTier(p, league, 0, titled('L:1'))).toBe(0);
    // 효과와 관계없는 칭호는 등급을 올리지 않는다
    expect(franchiseTier(p, league, 0, titled('lead:hr', 'mvp'))).toBe(0);
  });

  it('다른 구단에서는 재직이 없어 등급이 없고, 계보가 같으면 이름이 바뀌어도 이어 센다', () => {
    set(TIER_A.seasons, TIER_A.war);
    expect(franchiseTier(p, league, 1, noTitles)).toBe(0);
    const yb = league.yearbook;
    league.yearbook = [{ year: 2020, teams: [{ name: '옛 이름', franchise: fr() }] }] as unknown as LeagueState['yearbook'];
    p.tenure0 = undefined;
    p.history = [{ year: 2020, team: '옛 이름', bat: [1] }, { year: 2020, team: league.teams[0].name, bat: [1] }] as unknown as LeaguePlayer['history'];
    // 한 해에 두 줄이어도 한 시즌
    expect(franchiseRecord(p, league, 0).seasons).toBe(1);
    league.yearbook = yb;
  });

  it('시작 때 실존 선수는 시작 전 실제 기록으로 등급이 있다', () => {
    const { league: L } = createLeague(store, 2026, 'franchise-real', FAST);
    const keys = titleKeysOf(L);
    const tierOf = (name: string) => { const x = L.players.find((q) => q.name === name && q.team >= 0)!; return franchiseTier(x, L, x.team, keys); };
    expect(tierOf('최정')).toBe(2);
    expect(tierOf('양현종')).toBe(2);
    expect(tierOf('노시환')).toBeGreaterThanOrEqual(1);
    const n = L.players.filter((x) => x.team >= 0 && franchiseTier(x, L, x.team, keys) === 2).length;
    expect(n).toBeGreaterThanOrEqual(L.teams.length / 2);
    expect(n).toBeLessThanOrEqual(L.teams.length * 3);
  });

  it('칸이 없는 예전 저장은 채우면 새 게임과 같은 값이다', () => {
    const { league: L } = createLeague(store, 2026, 'franchise-old', FAST);
    const want = L.players.map((x) => x.tenure0?.war);
    expect(want.some((w) => (w ?? 0) > 0)).toBe(true);
    for (const x of L.players) if (x.tenure0) delete x.tenure0.war;
    ensureTenureWar(L, store);
    expect(L.players.map((x) => x.tenure0?.war)).toEqual(want);
  });

  it('FA 임박: 계약이 남았으면 아니다', () => {
    const { league: L } = createLeague(store, 2026, 'franchise-fa', FAST);
    const x = L.players.find((q) => !q.foreign && q.team >= 0 && q.service >= 12)!;
    expect(faSoon({ ...x, contract: { ...x.contract, until: 2026 } }, 2026)).toBe(true);
    expect(faSoon({ ...x, contract: { ...x.contract, until: 2028 } }, 2026)).toBe(false);
  });

  it('등급은 능력·잠재·숨은 값을 읽지 않는다 (가져오는 모듈)', () => {
    const src = readFileSync('src/league/franchise.ts', 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1].split('/').pop());
    for (const bad of ['ratings', 'potential', 'traits', 'branches', 'scout', 'growth', 'value']) expect(imports, bad).not.toContain(bad);
    expect(src).not.toMatch(/\.potential|\.ceil\b|\.timing|Rng|Math\.random/);
  });
});

describe('가산치', () => {
  const ctxOf = (tier: 0 | 1 | 2, soon: boolean): ValueContext => ({ franchise: () => ({ tier, faSoon: soon }) }) as unknown as ValueContext;
  const sp = {} as SimPlayer;

  it('값은 A 40·B 15런이고 리빌딩·FA 임박은 각각 0.7배로 곱한다 (S4)', () => {
    expect(FRANCHISE_PREMIUM).toEqual([0, 15, 40]);
    expect(franchisePremium(sp, 0, 'contend', ctxOf(2, false))).toBe(40);
    expect(franchisePremium(sp, 0, 'contend', ctxOf(1, false))).toBe(15);
    expect(franchisePremium(sp, 0, 'rebuild', ctxOf(2, false))).toBeCloseTo(28);
    expect(franchisePremium(sp, 0, 'contend', ctxOf(2, true))).toBeCloseTo(28);
    expect(franchisePremium(sp, 0, 'rebuild', ctxOf(1, true))).toBeCloseTo(7.35);
    expect(franchisePremium(sp, 0, 'contend', ctxOf(0, true))).toBe(0);
    expect(franchisePremium(sp, 0, 'contend', {} as ValueContext)).toBe(0);
  });

  it('AI가 먼저 거는 제안: 자기 A 선수를 꺼내지 않고 우리 A·B 선수를 달라고 하지 않는다', () => {
    const g = newGame('franchise-offer');
    g.advance(10);
    const G = g as unknown as { aiTradeOffer(r: Rng): { team: number; give: string; get: string } | null };
    const byId = new Map(g.world.players.map((p) => [p.id, p]));
    const tier = (id: string, team: number) => g.values.franchise!(byId.get(id)!, team).tier;
    let n = 0;
    for (let i = 0; i < 150; i++) {
      const o = G.aiTradeOffer(new Rng(`offer/${i}`));
      if (!o) continue;
      n++;
      expect(tier(o.get, o.team)).toBeLessThan(2);
      expect(tier(o.give, g.teamIdx)).toBe(0);
    }
    expect(n).toBeGreaterThan(0);
  }, 120_000);

  it('세부 난이도가 낮아도 가산치는 줄지 않는다 (need가 아니라 gain에서 뺀다)', () => {
    const g = newGame('franchise-strict');
    const ai = g.world.teams.find((t) => t.idx !== g.teamIdx)!;
    const ctx: ValueContext = { ...g.values, franchise: () => ({ tier: 2, faSoon: false }) };
    const sit: TeamSituation = g.situation(ai.idx);
    const give = ai.org.filter((p) => !p.foreign)[0];
    const prop = { aiTeam: ai.idx, give: [give], receive: [g.team.org.filter((p) => !p.foreign)[0]] };
    const a = evaluateTrade({ ...prop, strict: 1 }, ai.org, sit, ctx);
    const b = evaluateTrade({ ...prop, strict: 0.5 }, ai.org, sit, ctx);
    expect(a.detail.premium).toBeGreaterThan(0);
    expect(b.detail.gain).toBe(a.detail.gain);
    expect(b.detail.premium).toBe(a.detail.premium);
  });
});
