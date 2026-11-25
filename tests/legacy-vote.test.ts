// 구단 투표(단장 회의)를 뺀 뒤 (2026-11-12 사용자 결정): 리그 결정, 예전 저장 호환.
// 전 tests/rule-vote.test.ts(구단 투표 V2~V4 시험 31개)는 지웠다: AI 표 계산(ai/vote.ts)·우리 표(voteRule)·단장 회의 화면이 모두 없어져 시험할 대상이 없다.
// 남는 것은 (1) 결산 때 리그가 바로 정하는 길, (2) 단장 회의 단계에 멈춘 예전 저장의 자동 개표, (3) 예전 조작 기록 'rule-vote'의 재현이다.
// 왕복 막기(쉼 3시즌·반대 방향 5시즌)는 tests/future-rules.test.ts.
//
// 예전 저장은 지금 코드로 다시 만든다: 결산만 하고(settleOffseason) FA를 열지 않은 오프시즌에 단장 회의 칸을 얹는다 (예전 beginOffseason이 안건 있는 해에 멈추던 자리).
// 실제 신호로는 2028년 결산 전에 변경이 생기지 않으므로 규칙 변경 판정(judgeFutureRules)을 바꿔 2026 결산에 변경을 낸다.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, RULE_VOTE_GONE, type GameSave } from '../src/game/session';
import type { LeagueState } from '../src/league/types';
import type { RuleShift, RuleSignal, FutureRuleKey } from '../src/league/futureRules';
import { countVotes, type LegacyVoteStage, type RuleAgenda, type VoteChoice } from '../src/league/legacyVote';
import { STAGES } from '../src/league/offseason';
import { stageRecord } from '../src/ui/offStage';

/** 켜면 2026 결산(신호 없는 해)에도 외국인 한도 3 → 4 변경을 리그가 정한다 */
const force = vi.hoisted(() => ({ on: false }));
vi.mock('../src/league/futureRules', async (orig) => {
  const m = await orig<typeof import('../src/league/futureRules')>();
  return {
    ...m,
    judgeFutureRules: (league: LeagueState, signal: RuleSignal) => {
      const real = m.judgeFutureRules(league, signal);
      if (!force.on) return real;
      const key: FutureRuleKey = 'foreign';
      const before = m.futureValue(league, key, signal.year);
      const s: RuleShift = { year: signal.year + 1, key, before, after: before + 1, reason: '시험 변경 (게임 속 가상 결정)', signal: 0.9 };
      (league.ruleShifts ??= []).push(s);
      return s;
    },
  };
});

/** 켜면 세션의 결산이 예전 코드처럼 단장 회의 단계에서 멈춘다 (FA를 열지 않음) */
const legacy = vi.hoisted(() => ({ stage: null as null | { agendas: unknown[]; ai: number[][]; user: Record<string, string> } }));
vi.mock('../src/league/offseason', async (orig) => {
  const m = await orig<typeof import('../src/league/offseason')>();
  return {
    ...m,
    beginOffseason: (...args: Parameters<typeof m.beginOffseason>) => {
      if (!legacy.stage) return m.beginOffseason(...args);
      const off = m.settleOffseason(...args);
      (off as { stage: string }).stage = 'vote';
      off.vote = structuredClone(legacy.stage) as LegacyVoteStage;
      return off;
    },
  };
});

/** 켜면 결산 때 신뢰도와 상관없이 해고된다 */
const fire = vi.hoisted(() => ({ on: false }));
vi.mock('../src/league/owner', async (orig) => {
  const m = await orig<typeof import('../src/league/owner')>();
  return { ...m, get FIRE_BELOW() { return fire.on ? 101 : m.FIRE_BELOW; } };
});

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let seasonEnd: GameSave;
const SEED = 'vote';
const TEAM = 3;
const AGENDA: RuleAgenda = { id: '2027-foreign', year: 2027, key: 'foreign', before: 3, after: 4, reason: '시험 안건 (게임 속 가상 결정)', signal: 0.9 };

beforeAll(() => {
  store = loadDataStore();
  const g = GameSession.create(store, { year: 2026, teamIdx: TEAM, seed: SEED }, FAST);
  g.advance(1000);
  seasonEnd = roundTrip(g.toSave());
}, 120_000);

/** 우리 구단 빼고 AI 찬성이 yes곳 (10구단, 문턱 7). 우리 칸은 실무진 추천 0 */
function aiWith(yes: number): number[] {
  let k = 0;
  return Array.from({ length: 10 }, (_, t) => (t === TEAM ? 0 : k++ < yes ? 1 : 0));
}

/** 단장 회의 단계에 멈춘 예전 저장 (지금 코드로 다시 만든 것) */
function legacySave(ai: number[], user: Record<string, VoteChoice> = {}, fired = false): GameSave {
  const g = GameSession.load(store, roundTrip(seasonEnd), FAST);
  legacy.stage = { agendas: [AGENDA], ai: [ai], user };
  fire.on = fired;
  try { g.beginOffseason(); } finally { legacy.stage = null; fire.on = false; }
  expect(g.offseason!.stage as string).toBe('vote');
  expect(g.offseason!.fa.entries).toEqual([]);
  return roundTrip(g.toSave());
}

/** 남은 오프시즌을 자동으로 끝낸다 */
function finish(g: GameSession): void {
  let guard = 0;
  while (g.offseason && g.offseason.stage !== 'ready' && guard++ < 60) {
    const offers = g.league.owner?.offers;
    if (offers?.length) g.acceptOffer(offers[0]);
    if (g.offseason.stage === 'draft') g.autoDraft();
    if (g.offseason.stage === 'comp') g.autoComp();
    if (g.offseason.stage === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.offseason!.stage).toBe('ready');
}

describe('리그 결정 (구단 투표 없음)', () => {
  it('오프시즌 단계에 단장 회의가 없다', () => {
    expect(STAGES as string[]).not.toContain('vote');
    expect(STAGES[0]).toBe('fa');
  });

  it('신호로 정한 변경은 결산 때 바로 들어가고 FA 단계로 연다. 결산 기록과 개막 알림에 "리그 결정"', () => {
    const g = GameSession.load(store, roundTrip(seasonEnd), FAST);
    force.on = true;
    try { g.beginOffseason(); } finally { force.on = false; }
    expect(g.offseason!.stage).toBe('fa');
    expect(g.offseason!.vote).toBeUndefined();
    const s = g.league.ruleShifts!.at(-1)!;
    expect(s).toMatchObject({ year: 2027, key: 'foreign', before: 3, after: 4 });
    expect(s.vote).toBeUndefined();
    expect(g.league.ruleVotes).toBeUndefined();
    expect(stageRecord(g, 'settle').some((l) => l.text.startsWith('2027 시즌 규칙 변경 (리그 결정): 외국인 보유 한도'))).toBe(true);
    const line = g.ruleNewsFor(2027).main.find((l) => l.title.startsWith('외국인 보유 한도'));
    expect(line?.decision).toBe('리그 결정 (게임 속 가상 결정)');
    expect(line).toMatchObject({ before: '3명', after: '4명', note: '시험 변경 (게임 속 가상 결정)' });
  });
});

describe('예전 저장: 단장 회의 단계에 멈춘 저장은 불러올 때 저장된 표로 자동 개표하고 FA로', () => {
  it('우리 표가 없으면 반대로 센다 (AI 찬성 6 → 6 : 4 부결, 규칙 그대로)', () => {
    const h = GameSession.load(store, legacySave(aiWith(6)), FAST);
    expect(h.offseason!.stage).toBe('fa');
    expect(h.offseason!.vote).toBeUndefined();
    expect(h.offseason!.fa.entries.length).toBeGreaterThan(0);
    const r = h.league.ruleVotes!.at(-1)!;
    expect(r).toMatchObject({ id: AGENDA.id, yes: 6, no: 4, need: 7, passed: false, userTeam: TEAM });
    expect(r.user).toBeUndefined();
    expect(r.votes).toEqual(countVotes(aiWith(6), TEAM).votes);
    expect(h.league.ruleShifts ?? []).toEqual([]);
    // 개표 소식은 결산 기록과 소식에
    expect(stageRecord(h, 'settle').some((l) => l.text.startsWith('지난 단장 회의 자동 개표') && l.text.includes('부결'))).toBe(true);
    expect(h.news.some((n) => n.text.startsWith('지난 단장 회의 자동 개표'))).toBe(true);
  });

  it('저장된 우리 표대로 센다 (찬성이면 7 : 3 가결, 변경에 표결 결과가 남고 알림에 단장 회의 줄)', () => {
    const h = GameSession.load(store, legacySave(aiWith(6), { [AGENDA.id]: 'yes' }), FAST);
    const r = h.league.ruleVotes!.at(-1)!;
    expect(r).toMatchObject({ yes: 7, no: 3, passed: true, userTeam: TEAM, user: 'yes' });
    expect(h.league.ruleShifts!.at(-1)).toMatchObject({ year: 2027, key: 'foreign', before: 3, after: 4, vote: { yes: 7, no: 3, need: 7, user: 'yes' } });
    const line = h.ruleNewsFor(2027).main.find((l) => l.title.startsWith('외국인 보유 한도'));
    expect(line?.decision).toBe('단장 회의 찬성 7 : 반대 3 가결 (문턱 7, 우리 구단 찬성)');
  });

  it('가결된 예전 저장은 리그가 결산 때 바로 정한 판과 FA 시장이 같다 (FA는 개표 뒤에 열린다)', () => {
    const h = GameSession.load(store, legacySave(aiWith(8)), FAST);
    expect(h.league.ruleVotes!.at(-1)!.passed).toBe(true);
    const g = GameSession.load(store, roundTrip(seasonEnd), FAST);
    force.on = true;
    try { g.beginOffseason(); } finally { force.on = false; }
    expect(h.offseason!.fa).toEqual(g.offseason!.fa);
    expect(h.offseason!.coachMarket).toEqual(g.offseason!.coachMarket);
  });

  it('해고된 채 맞은 회의는 예전 규칙대로 우리 표를 버리고 모든 구단 AI 표로 센다', () => {
    const ai = aiWith(6);
    const h = GameSession.load(store, legacySave(ai, { [AGENDA.id]: 'yes' }, true), FAST);
    expect(h.league.owner!.offers?.length).toBeGreaterThan(0);
    const r = h.league.ruleVotes!.at(-1)!;
    expect(r.userTeam).toBeUndefined();
    expect(r.user).toBeUndefined();
    expect(r).toMatchObject({ yes: 6, passed: false });
    expect(h.offseason!.stage).toBe('fa');
  });

  it('불러와 개표한 뒤 저장 → 다시 불러와 끝까지 = 바로 끝까지 (같은 상태)', () => {
    const save = legacySave(aiWith(6), { [AGENDA.id]: 'yes' });
    const a = GameSession.load(store, roundTrip(save), FAST);
    finish(a);
    const b0 = GameSession.load(store, roundTrip(save), FAST);
    const b = GameSession.load(store, roundTrip(b0.toSave()), FAST);
    finish(b);
    expect(b.toSave().league).toEqual(a.toSave().league);
    expect(b.offseason).toEqual(a.offseason);
    // 끝까지 가도 개표는 한 번
    expect(a.league.ruleVotes).toHaveLength(1);
  }, 120_000);
});

describe('예전 조작 기록', () => {
  it("재현: 예전 'rule-vote' 조작은 읽히고 아무것도 하지 않는다 (기록에서 빠지고, 없이 한 것과 같은 상태)", () => {
    const opts = { year: 2026, teamIdx: TEAM, seed: SEED };
    const g = GameSession.create(store, opts, FAST);
    g.advance(1000);
    g.beginOffseason();
    g.nextStage();
    const begin = g.actions.findIndex((a) => a.type === 'begin-off');
    expect(begin).toBeGreaterThanOrEqual(0);
    const vote = (choice: 'yes' | 'no') => ({ year: 2026, type: 'rule-vote' as const, choice, agenda: '2027-foreign' });
    const old = [...g.actions.slice(0, begin + 1), vote('yes'), vote('no'), ...g.actions.slice(begin + 1)];
    const r = GameSession.replay(store, opts, old, undefined, FAST);
    expect(r.actions).toEqual(g.actions);
    expect(r.toSave().league).toEqual(g.toSave().league);
    expect(r.offseason).toEqual(g.offseason);
    expect(RULE_VOTE_GONE).toContain('리그가 정합니다');
  }, 120_000);
});
