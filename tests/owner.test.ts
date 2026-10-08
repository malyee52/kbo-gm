// M7 구단주 평가와 난이도: 목표·신뢰도·해고·영입 제의, 샐러리캡 제재, 난이도, 포스트시즌, 완료 기준 한 바퀴.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { createLeague } from '../src/league/create';
import {
  aiPotential, applyCapSanctions, budgetFor, CAP_PICK_DROP, draftSlots, FIRE_BELOW, goalFor, offersFor, outcomeTier, trustDelta,
  type Difficulty, type SeasonOutcome,
} from '../src/league/owner';
import { salaryCap } from '../src/league/salary';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => {
  store = loadDataStore();
});

const outcome = (o: Partial<SeasonOutcome>): SeasonOutcome => ({
  rank: 5, nTeams: 10, postseasonTeams: 5, champion: false, finalist: false, capOver: false, ...o,
});

describe('목표와 신뢰도', () => {
  it('전력 예상 순위로 목표를 정한다', () => {
    expect(goalFor(1, 5)).toBe('champion');
    expect(goalFor(2, 5)).toBe('champion');
    expect(goalFor(5, 5)).toBe('postseason');
    expect(goalFor(6, 5)).toBe('postseason');
    expect(goalFor(7, 5)).toBe('notLast');
  });

  it('달성하면 오르고 놓치면 내린다. 목표보다 잘하거나 못할수록 더 크다', () => {
    expect(outcomeTier(outcome({ champion: true, finalist: true, rank: 3 }))).toBe(3);
    expect(trustDelta('postseason', outcome({ rank: 4 }))).toEqual({ achieved: true, delta: 12 });
    expect(trustDelta('notLast', outcome({ rank: 4 })).delta).toBe(20);
    expect(trustDelta('postseason', outcome({ rank: 7 }))).toEqual({ achieved: false, delta: -10 });
    expect(trustDelta('postseason', outcome({ rank: 10 })).delta).toBe(-16);
    expect(trustDelta('champion', outcome({ rank: 10 })).delta).toBe(-22);
    // 캡 초과는 따로 -10
    expect(trustDelta('postseason', outcome({ rank: 4, capOver: true })).delta).toBe(2);
    // 한 시즌 미달만으로는 시작 신뢰도 50에서 해고되지 않는다
    expect(50 + Math.min(...(['champion', 'postseason', 'notLast'] as const).map((g) => trustDelta(g, outcome({ rank: 10 })).delta))).toBeGreaterThanOrEqual(FIRE_BELOW);
  });

  it('영입 제의는 하위권 구단에서, 원래 구단은 빼고', () => {
    const st = [3, 1, 4, 0, 5, 9, 2, 6, 8, 7];
    expect(offersFor(st, 8)).toEqual([7, 6, 2]);
    expect(offersFor(st, 3)).toEqual([7, 8, 6]);
  });
});

describe('예산과 샐러리캡 제재 (제도연표: 1회 50%, 2회 연속 100% + 1라운드 지명권 9단계 하락)', () => {
  it('모기업 등급에 따라 예산이 다르고 샐러리캡을 넘지 않는다', () => {
    const { league } = createLeague(store, 2026, 'budget', FAST);
    const idx = (n: string) => league.teams.findIndex((t) => t.name === n);
    const cap = salaryCap(2026)!;
    expect(budgetFor(league, idx('삼성'), 2026)).toBe(cap);
    expect(budgetFor(league, idx('키움'), 2026)!).toBeLessThan(budgetFor(league, idx('두산'), 2026)!);
  });

  it('초과하면 제재금, 2회 연속이면 지명권 하락. 지키면 연속 횟수가 0으로', () => {
    const { league } = createLeague(store, 2026, 'cap', FAST);
    const t = 0;
    const star = league.players.find((p) => p.team === t && !p.foreign && p.contract.kind !== 'rookie')!;
    const cap = salaryCap(2026)!;
    star.contract = { ...star.contract, salary: cap }; // 혼자 캡을 채워 초과시킨다
    const first = applyCapSanctions(league, 2026).find((x) => x.team === t)!;
    expect(first.strike).toBe(1);
    expect(first.fine).toBe(Math.round(first.over * 0.5));
    expect(first.pickDrop).toBe(false);
    const second = applyCapSanctions(league, 2027).find((x) => x.team === t)!;
    expect(second.strike).toBe(2);
    expect(second.fine).toBe(Math.round(second.over * 1.0));
    expect(league.draftPenalty![t]).toBe(2027);
    expect(league.ledger.filter((l) => l.from === t && l.note.includes('샐러리캡'))).toHaveLength(2);
    star.contract = { ...star.contract, salary: 3000 };
    applyCapSanctions(league, 2028);
    expect(league.capStrikes![t]).toBe(0);
  });

  it('지명권 하락: 제재 구단은 1라운드에서 9단계 뒤로, 2라운드부터는 그대로', () => {
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const slots = draftSlots(order, 2, new Set([0]));
    expect(slots.slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    expect(slots.slice(10)).toEqual(order);
    expect(CAP_PICK_DROP).toBe(9);
  });
});

describe('난이도 (AI의 잠재력 평가 오차)', () => {
  const players = Array.from({ length: 400 }, (_, i) => ({ id: `p${i}`, potential: (i % 60) - 10 }));
  const mae = (d: Difficulty) => players.reduce((s, p) => s + Math.abs(aiPotential({ seed: 's', difficulty: d }, p) - p.potential), 0) / players.length;

  it('오차는 쉬움 > 보통 > 어려움이고, 같은 선수는 늘 같은 오차', () => {
    expect(mae('easy')).toBeGreaterThan(mae('normal'));
    expect(mae('normal')).toBeGreaterThan(mae('hard'));
    expect(aiPotential({ seed: 's', difficulty: 'easy' }, players[3])).toBe(aiPotential({ seed: 's', difficulty: 'easy' }, players[3]));
  });

  it('밸런스: AI가 평가로 뽑은 상위 20명의 실제 잠재력 평균은 어려움일수록 높다', () => {
    const top = (d: Difficulty) => [...players].sort((a, b) => aiPotential({ seed: 'b', difficulty: d }, b) - aiPotential({ seed: 'b', difficulty: d }, a))
      .slice(0, 20).reduce((s, p) => s + p.potential, 0) / 20;
    expect(top('hard')).toBeGreaterThan(top('normal'));
    expect(top('normal')).toBeGreaterThan(top('easy'));
  });
});

describe('M7 완료 기준: 2026년 시작 → 목표 → 해고 → 다른 구단 부임까지 한 바퀴', () => {
  let g: GameSession;
  let firstTeam: number;
  let save: GameSaveV2;

  beforeAll(() => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'm7-loop-2', difficulty: 'hard' }, FAST);
    firstTeam = g.teamIdx;
    // 신뢰도를 낮춰 두고 목표를 우승으로: 우승하지 못하면 해고된다
    g.owner.trust = 30;
    g.owner.goal = { year: 2026, kind: 'champion', projectedRank: 1 };
    g.advance(100000);
    g.beginOffseason();
  }, 120_000);

  it('시즌 목표가 정해져 있었고, 포스트시즌을 치러 우승팀이 나온다', () => {
    const ps = g.league.lastSeason!.postseason!;
    expect(ps.seeds).toEqual(g.league.lastSeason!.standings.slice(0, 5));
    expect(ps.seeds).toContain(ps.champion);
    expect(ps.series.map((x) => x.round)).toEqual(['wc', 'semi', 'po', 'ks']);
    expect(g.owner.history[0].goal).toBe('champion');
  });

  it('목표를 놓쳐 해고되고, 하위권 구단의 영입 제의를 받는다. 고르기 전에는 오프시즌을 진행할 수 없다', () => {
    const ps = g.league.lastSeason!.postseason!;
    // 이 시드에서 우승하면 이 시험은 성립하지 않는다. 엔진이 바뀌어 우승하게 되면 시드를 바꾼다 (2026-10-08 투수 교체 개편 때 m7-loop → m7-loop-2)
    expect(ps.champion, '이 시드에서 LG가 우승했습니다. 시드를 바꾸세요').not.toBe(firstTeam);
    expect(g.owner.trust).toBeLessThan(FIRE_BELOW);
    expect(g.owner.offers!.length).toBeGreaterThan(0);
    expect(g.owner.offers).not.toContain(firstTeam);
    expect(g.nextStage().ok).toBe(false);
    save = roundTrip(g.toSave());
  });

  it('제의를 받아들이면 새 구단 단장이 되고, 오프시즌을 마쳐 새 구단으로 2027 시즌을 연다', () => {
    const to = g.owner.offers![0];
    expect(g.acceptOffer(to).ok).toBe(true);
    expect(g.teamIdx).toBe(to);
    expect(g.offseason!.userTeam).toBe(to);
    expect(g.owner.trust).toBe(50);
    while (g.offseason!.stage !== 'ready') {
      if (g.offseason!.stage === 'draft') g.autoDraft();
      if (g.offseason!.stage === 'comp') g.autoComp();
      if (g.offseason!.stage === 'release') g.autoRelease();
      expect(g.nextStage().ok).toBe(true);
    }
    expect(g.openNextSeason().ok).toBe(true);
    expect(g.year).toBe(2027);
    expect(g.team.name).toBe(g.league.teams[to].name);
    expect(g.owner.goal?.year).toBe(2027);
    expect(g.owner.history[0].team).toBe(firstTeam);
  });

  it('해고 직후 저장을 불러오면 영입 제의가 그대로 남아 있고, 같은 시드로 다시 돌린 시즌 결과도 같다', () => {
    const b = GameSession.load(store, save, FAST);
    expect(b.owner.offers).toEqual(save.league.owner!.offers);
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    // 신뢰도·목표는 이 시험에서 직접 바꿔 조작 기록에 없다. 그래서 해고까지 재현하지는 않고 시즌 결과가 같은지만 본다
    const c = GameSession.replay(store, { year: 2026, teamIdx: lg, seed: 'm7-loop-2', difficulty: 'hard' }, [], { year: 2026, day: 100000 }, FAST);
    c.advance(100000);
    expect(c.season.teams).toEqual(b.season.teams);
  });
});
