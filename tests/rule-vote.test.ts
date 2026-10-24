// 구단 투표 V2·V3 (구단투표 기획안 v0.2 8장 테스트 13개): 안건·AI 표·단장 회의 단계·우리 표·개표·쿨다운·저장·재현.
// 실제 신호로는 2028년 결산 전에 안건이 생기지 않으므로, 세션·오프시즌 시험은 안건 고르기(proposeFutureRule)를 바꿔 2026 결산에 안건을 올린다.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season } from '../src/engine';
import { GameSession, type GameSave } from '../src/game/session';
import { aiVotes, countVotes, interestBreakdown, meritExcess, voteOutlook, voteParts, votesNeeded, type RuleAgenda, type VoteFacts } from '../src/ai/vote';
import { readFileSync } from 'node:fs';
import { stageHeadline, stageLeftovers } from '../src/ui/offStage';
import { ruleNews, voteResultText } from '../src/league/ruleNews';
import { createLeague } from '../src/league/create';
import { FUTURE_RULE_SPEC, futureValue, proposeFutureRule, type FutureRuleKey, type RuleSignal } from '../src/league/futureRules';
import * as Off from '../src/league/offseason';
import { agendaText, RULE_VOTE, ruleVoteOn, tallyAgenda, tallyText } from '../src/league/ruleVote';
import type { LeagueState } from '../src/league/types';
import { worldFromLeague } from '../src/league/world';

/** 켜면 2026 결산(신호 없는 해)에도 이 안건을 올린다 */
const force = vi.hoisted(() => ({ on: false, key: 'foreign' as string, dir: 1, signal: 0.9 }));
vi.mock('../src/league/futureRules', async (orig) => {
  const m = await orig<typeof import('../src/league/futureRules')>();
  const forced = (league: LeagueState, signal: RuleSignal) => {
    const key = force.key as FutureRuleKey;
    const before = m.futureValue(league, key, signal.year);
    return { year: signal.year + 1, key, before, after: Math.round((before + force.dir * m.FUTURE_RULE_SPEC[key].step) * 1000) / 1000,
      reason: '시험 안건 (게임 속 가상 결정)', signal: force.signal };
  };
  return {
    ...m,
    proposeFutureRule: (league: LeagueState, signal: RuleSignal) => {
      const real = m.proposeFutureRule(league, signal);
      return force.on ? forced(league, signal) : real;
    },
    // 표결을 끈 리그(예전 길)에서 같은 변경을 결산 때 바로 넣는다
    judgeFutureRules: (league: LeagueState, signal: RuleSignal) => {
      if (!force.on) return m.judgeFutureRules(league, signal);
      m.proposeFutureRule(league, signal);
      const s = forced(league, signal);
      (league.ruleShifts ??= []).push(s);
      return s;
    },
  };
});

/** 켜면 결산 때 신뢰도와 상관없이 해고된다 (해고 중 단장 회의 시험) */
const fire = vi.hoisted(() => ({ on: false }));
vi.mock('../src/league/owner', async (orig) => {
  const m = await orig<typeof import('../src/league/owner')>();
  return { ...m, get FIRE_BELOW() { return fire.on ? 101 : m.FIRE_BELOW; } };
});

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** 2026 정규시즌을 끝낸 세션 저장 (결산 전) */
let seasonEnd: GameSave;
const SEED = 'vote';
const TEAM = 3;

beforeAll(() => {
  store = loadDataStore();
  const g = GameSession.create(store, { year: 2026, teamIdx: TEAM, seed: SEED }, FAST);
  g.advance(1000);
  seasonEnd = roundTrip(g.toSave());
}, 120_000);

/** 결산까지 해서 단장 회의 단계로 (안건을 올린다) */
function toVote(): GameSession {
  const g = GameSession.load(store, roundTrip(seasonEnd), FAST);
  force.on = true;
  try { g.beginOffseason(); } finally { force.on = false; }
  return g;
}

/** 결산에서 해고된 채 단장 회의 단계로 */
function toVoteFired(save: GameSave = seasonEnd): GameSession {
  const g = GameSession.load(store, roundTrip(save), FAST);
  force.on = true;
  fire.on = true;
  try { g.beginOffseason(); } finally { force.on = false; fire.on = false; }
  return g;
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

/** 모든 구단 AI로 2026 시즌을 돌리고 결산까지 (longsim과 같은 길) */
function aiOffseason(seed: string, agenda: boolean): { league: LeagueState; off: Off.OffseasonState } {
  const { league } = createLeague(store, 2026, seed, FAST);
  const world = worldFromLeague(structuredClone(league), store, FAST);
  const season = Season.start(world, FAST, seed);
  season.runToEnd();
  force.on = agenda;
  try { return { league, off: Off.beginOffseason(league, world, season, store, -1, FAST) }; } finally { force.on = false; }
}

function runOff(league: LeagueState, off: Off.OffseasonState): void {
  let guard = 0;
  while (off.stage !== 'ready' && guard++ < 60) Off.advanceStage(league, off, store, FAST);
}

const facts = (n: number, f: (i: number) => Partial<VoteFacts> = () => ({})): VoteFacts[] => Array.from({ length: n }, (_, i) => ({
  team: i, cash: 100, strength: 100, domestic: 100, foreign: 0.1, capUse: 0.7, net: 0, absence: 1000, depth: 1, bullpen: 10, pitchBat: 0, hr: 1, eye: 0.4, kPitch: 0.2,
  tendency: 'contend', ...f(i),
}));
const agenda = (o: Partial<RuleAgenda> = {}): RuleAgenda => ({ id: '2031-foreign', year: 2031, key: 'foreign', before: 3, after: 4, reason: '시험 (게임 속 가상 결정)', signal: 0.97, ...o });

describe('AI 표 (ai/vote.ts, 난수 없음)', () => {
  it('같은 지표 → 같은 표. 이해 지표 표준화 합은 0', () => {
    const f = facts(10, (i) => ({ cash: 50 + i * 13, strength: 200 - i * 7, foreign: (i % 4) / 10, domestic: 300 + ((i * 37) % 90) }));
    expect(aiVotes(agenda(), f, 10)).toEqual(aiVotes(agenda(), roundTrip(f), 10));
    const sum = voteParts(agenda(), f).reduce((a, p) => a + p.interest, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-9);
  });

  it('명분이 크면 만장일치, 문턱을 갓 넘으면 갈린다. 동점(점수 0)은 반대', () => {
    const f = facts(10, (i) => ({ cash: i, strength: -i, domestic: (i * 7) % 10, foreign: i / 20, tendency: i < 5 ? 'contend' : 'rebuild' }));
    const big = { meritBase: 3, meritSpan: 0, interest: 1, lean: 0, statusQuo: 0, statusQuoBig: 0 };
    expect(aiVotes(agenda(), f, 10, big).every((v) => v === 1)).toBe(true);
    const yes = aiVotes(agenda({ signal: 0.98 }), f, 10).filter((v) => v === 1).length;
    expect(yes).toBeGreaterThan(0);
    expect(yes).toBeLessThan(10);
    // 이해가 모두 같고 명분 = 현상유지면 점수 0 → 모두 반대
    const flat = { meritBase: 0.3, meritSpan: 0, interest: 1, lean: 0, statusQuo: 0.3, statusQuoBig: 1.2 };
    expect(aiVotes(agenda(), facts(10), 10, flat).every((v) => v === 0)).toBe(true);
  });

  it('명분: 신호가 문턱을 넘은 정도 0~1', () => {
    expect(meritExcess(agenda({ signal: 0.98 }))).toBeCloseTo(0, 6);
    expect(meritExcess(agenda({ signal: 0.97 }))).toBeCloseTo(0.5, 6);
    expect(meritExcess(agenda({ signal: 0.9 }))).toBe(1);
    expect(meritExcess(agenda({ key: 'capGrowth', before: 0.05, after: 0.07, signal: 4.5 }))).toBeCloseTo(0.5, 6);
  });

  it('표결권 없는 구단(퓨처스)은 −1, 문턱 = ceil(구단 수 × 2/3)', () => {
    expect([9, 10, 11, 12].map(votesNeeded)).toEqual([6, 7, 8, 8]);
    const v = aiVotes(agenda(), facts(10).slice(0, 9), 10);
    expect(v[9]).toBe(-1);
    expect(countVotes(v, -1).need).toBe(6);
  });
});

describe('결정표·여론 (결정 4·10)', () => {
  const ai = (yes: number) => Array.from({ length: 10 }, (_, t) => (t === 0 ? 1 : t <= yes ? 1 : 0));
  it('AI 찬성이 문턱 − 1이면 우리 표가 가르고, 문턱 − 2·문턱이면 상관없다', () => {
    // 우리 구단 0, 다른 9곳 중 찬성 6 = 문턱 7 − 1
    expect(voteOutlook(ai(6), 0)).toMatchObject({ yes: 6, no: 3, need: 7, swing: 'decisive' });
    expect(countVotes(ai(6), 0, 'yes').passed).toBe(true);
    expect(countVotes(ai(6), 0, 'no').passed).toBe(false);
    expect(countVotes(ai(6), 0).passed).toBe(false); // 표를 안 내면 반대
    for (const y of [5, 7]) {
      expect(countVotes(ai(y), 0, 'yes').passed).toBe(countVotes(ai(y), 0, 'no').passed);
      expect(voteOutlook(ai(y), 0).swing).toBe(y >= 7 ? 'pass' : 'fail');
    }
    // 미리 보인 수 = 개표 (우리 표를 더하면)
    const o = voteOutlook(ai(6), 0);
    const c = countVotes(ai(6), 0, 'yes');
    expect(c.yes).toBe(o.yes + 1);
  });
});

describe('쿨다운·모드 (proposeFutureRule)', () => {
  const calm = (year: number, o: Partial<RuleSignal> = {}): RuleSignal => ({
    year, hr: 1, so: 1, bb: 1, draw: 0.025, absence: 1000, attendance: 12000, foreignShare: 0.08, deficit: 1, capOver: 0, capUse: 0.7, ...o,
  });
  it('부결된 항목·방향은 2시즌 쉬고(Y+3 시즌 안건부터), 반대 방향은 쉬지 않는다. 가결은 3시즌', () => {
    const L = { seed: 'cool' } as unknown as LeagueState;
    proposeFutureRule(L, calm(2027, { hr: 1.3 }));
    const first = proposeFutureRule(L, calm(2028, { hr: 1.3 }))!;
    expect(first).toMatchObject({ year: 2029, key: 'ball', after: 0.94 });
    const { record } = tallyAgenda({ id: '2029-ball', ...first }, Array.from({ length: 10 }, () => 0), -1);
    L.ruleVotes = [record];
    expect(record.passed).toBe(false);
    expect(proposeFutureRule(L, calm(2029, { hr: 1.3 }))).toBeNull(); // 2030 안건: 쉼
    expect(proposeFutureRule(L, calm(2030, { hr: 1.3 }))).toBeNull(); // 2031 안건: 쉼
    expect(proposeFutureRule(L, calm(2031, { hr: 1.3 }))).toMatchObject({ year: 2032, key: 'ball' });
    // 반대 방향(장타 압력 낮음 → 기준 상향)은 부결 기록과 상관없다
    const M = { seed: 'cool', ruleVotes: [record] } as unknown as LeagueState;
    proposeFutureRule(M, calm(2028, { hr: 0.8 }));
    expect(proposeFutureRule(M, calm(2029, { hr: 0.8 }))).toMatchObject({ year: 2030, key: 'ball', after: 1.06 });
  });

  it('판타지·자유 모드는 표결도 변경도 없다', () => {
    const L = { seed: 'm', fantasy: {} } as unknown as LeagueState;
    expect(ruleVoteOn(L)).toBe(false);
    for (let y = 2027; y < 2033; y++) expect(proposeFutureRule(L, calm(y, { hr: 1.3 }))).toBeNull();
  });
});

describe('단장 회의 단계 (offseason.ts, 모든 구단 AI)', () => {
  it('안건이 있으면 오프시즌 첫 단계가 단장 회의, next로 막힘 없이 개표 → FA', () => {
    const { league, off } = aiOffseason('vote-ai', true);
    expect(off.stage).toBe('vote');
    expect(off.vote!.agendas).toHaveLength(1);
    expect(off.fa.entries).toHaveLength(0); // FA 시장은 개표 뒤에 열린다
    expect(Off.blockedReason(league, off)).toBeNull();
    Off.advanceStage(league, off, store, FAST);
    expect(off.stage).toBe('fa');
    expect(league.ruleVotes).toHaveLength(1);
    const r = league.ruleVotes![0];
    expect(r.yes + r.no).toBe(10);
    expect(r.passed).toBe(r.yes >= 7);
    expect((league.ruleShifts ?? []).length).toBe(r.passed ? 1 : 0);
    expect(off.log.filter((l) => l.stage === 'vote').length).toBeGreaterThanOrEqual(2);
  });

  it('같은 시드 → 같은 안건·표·결과', () => {
    const a = aiOffseason('vote-same', true);
    const b = aiOffseason('vote-same', true);
    expect(b.off.vote).toEqual(a.off.vote);
    Off.advanceStage(a.league, a.off, store, FAST);
    Off.advanceStage(b.league, b.off, store, FAST);
    expect(b.league.ruleVotes).toEqual(a.league.ruleVotes);
    expect(b.league.ruleShifts).toEqual(a.league.ruleShifts);
  });

  it('안건 없는 해: 단계가 안 생기고 표결 기능을 끈 것과 한 자리도 다르지 않다', () => {
    const on = aiOffseason('vote-none', false);
    RULE_VOTE.on = false;
    let off2: ReturnType<typeof aiOffseason>;
    try { off2 = aiOffseason('vote-none', false); } finally { RULE_VOTE.on = true; }
    expect(on.off.stage).toBe('fa');
    expect(on.off.vote).toBeUndefined();
    runOff(on.league, on.off);
    runOff(off2.league, off2.off);
    expect(on.league).toEqual(off2.league);
    expect(on.off).toEqual(off2.off);
  });

  it('가결된 외국인 한도는 같은 오프시즌 외국인 단계에, 부결이면 그대로', () => {
    for (const pass of [true, false]) {
      const { league, off } = aiOffseason('vote-apply', true);
      off.vote!.ai[0] = off.vote!.ai[0].map((v) => (v < 0 ? v : pass ? 1 : 0));
      Off.advanceStage(league, off, store, FAST);
      expect(futureValue(league, 'foreign', 2027)).toBe(pass ? 4 : 3);
      let guard = 0;
      while (off.stage !== 'foreign' && guard++ < 20) Off.advanceStage(league, off, store, FAST);
      expect(off.foreign!.regular).toBe(pass ? 4 : 3);
      if (pass) expect(league.ruleShifts!.at(-1)!.vote).toMatchObject({ yes: 10, no: 0, need: 7 });
    }
  });

  it('가결이면 표결 없이 결산 때 바로 바뀐 것과 리그 진행이 같다 (다음 해 규칙을 읽는 일은 개표 뒤)', () => {
    const a = aiOffseason('vote-eq', true);
    a.off.vote!.ai[0] = a.off.vote!.ai[0].map((v) => (v < 0 ? v : 1));
    runOff(a.league, a.off);
    RULE_VOTE.on = false;
    let b: ReturnType<typeof aiOffseason>;
    try { b = aiOffseason('vote-eq', true); } finally { RULE_VOTE.on = true; }
    expect(b.off.stage).toBe('fa');
    runOff(b.league, b.off);
    const strip = (L: LeagueState) => ({ ...L, ruleVotes: undefined, ruleShifts: L.ruleShifts?.map(({ vote: _v, ...x }) => x) });
    expect(strip(a.league)).toEqual(strip(b.league));
    expect(a.league.ruleShifts).toHaveLength(1);
  });
});

describe('세션: 우리 표·저장·재현', () => {
  it('표를 안 내고 넘기면 반대로 센다. 결과 소식이 남는다', () => {
    const g = toVote();
    expect(g.offseason!.stage).toBe('vote');
    g.nextStage();
    const r = g.league.ruleVotes!.at(-1)!;
    expect(r.userTeam).toBe(TEAM);
    expect(r.user).toBeUndefined();
    expect(r.votes[TEAM]).toBe(0);
    expect(g.offseason!.stage).toBe('fa');
  });

  it('결정표: AI 찬성이 문턱 − 1이면 우리 표대로 가결·부결', () => {
    for (const choice of ['yes', 'no'] as const) {
      const g = toVote();
      const ai = g.offseason!.vote!.ai[0];
      let k = 0;
      for (let t = 0; t < ai.length; t++) if (t !== TEAM && ai[t] >= 0) ai[t] = k++ < 6 ? 1 : 0;
      expect(voteOutlook(ai, TEAM).swing).toBe('decisive');
      expect(g.voteRule(choice).ok).toBe(true);
      g.nextStage();
      expect(g.league.ruleVotes!.at(-1)!.passed).toBe(choice === 'yes');
    }
  });

  it('표결 단계의 다른 조작(투자·연장·설정)은 AI 표를 바꾸지 않는다. 단장 회의 밖에서는 표를 낼 수 없다', () => {
    const g = toVote();
    const before = roundTrip(g.offseason!.vote!.ai);
    g.setInvest('marketing', 2);
    const ext = Off.extensionCandidates(g.league, g.offseason!);
    expect(ext).toEqual([]);
    g.voteRule('yes');
    g.voteRule('no');
    expect(g.offseason!.vote!.ai).toEqual(before);
    g.nextStage();
    expect(g.voteRule('yes').ok).toBe(false);
  });

  it('단장 회의에서 저장 → 불러와 표 → 개표 = 끊김 없이 한 결과. 표를 낸 뒤 저장해도 같다', () => {
    const run = (mode: 0 | 1 | 2) => {
      let g = toVote();
      if (mode === 1) g = GameSession.load(store, roundTrip(g.toSave()), FAST);
      g.voteRule('yes');
      if (mode === 2) g = GameSession.load(store, roundTrip(g.toSave()), FAST);
      g.nextStage();
      g.nextStage();
      return g;
    };
    const a = run(0);
    for (const m of [1, 2] as const) {
      const b = run(m);
      expect(b.league.ruleVotes).toEqual(a.league.ruleVotes);
      expect(b.league.ruleShifts).toEqual(a.league.ruleShifts);
      expect(b.offseason!.fa).toEqual(a.offseason!.fa);
    }
  });

  it('예전 저장 (ruleVotes·vote 없음, FA 단계)도 열리고 이어 돈다', () => {
    const g = GameSession.load(store, roundTrip(seasonEnd), FAST);
    g.beginOffseason();
    expect(g.offseason!.stage).toBe('fa');
    const save = roundTrip(g.toSave()) as GameSave & { league: LeagueState };
    delete save.league.ruleVotes;
    const h = GameSession.load(store, save, FAST);
    finish(h);
    expect(h.league.ruleVotes).toBeUndefined();
  }, 60_000);

  it('재현: 찬성 → 반대 → 찬성 기록을 replay하면 마지막 표(찬성)로 개표, 같은 상태', () => {
    // 시즌 끝 저장에서 불러온 세션은 결산 결과(시상·퓨처스)가 끊김 없이 돈 것과 달라(표결과 상관없는 기존 차이) 처음부터 돈다
    const g = GameSession.create(store, { year: 2026, teamIdx: TEAM, seed: SEED }, FAST);
    g.advance(1000);
    force.on = true;
    try { g.beginOffseason(); } finally { force.on = false; }
    g.voteRule('yes');
    g.voteRule('no');
    g.voteRule('yes');
    g.nextStage();
    expect(g.league.ruleVotes!.at(-1)!.user).toBe('yes');
    force.on = true;
    let r: GameSession;
    try {
      r = GameSession.replay(store, { year: 2026, teamIdx: TEAM, seed: SEED }, g.actions, undefined, FAST);
    } finally { force.on = false; }
    expect(r.league.ruleVotes).toEqual(g.league.ruleVotes);
    expect(r.toSave().league).toEqual(g.toSave().league);
    expect(r.offseason).toEqual(g.offseason);
  }, 120_000);

  it('문구: 안건·결과에 "게임 속 가상 결정", 여론은 정확한 수', () => {
    const g = toVote();
    const v = g.offseason!.vote!;
    const t = agendaText(v.agendas[0], v.ai[0], TEAM);
    expect(t).toContain('게임 속 가상 결정');
    expect(t).toMatch(/여론: 찬성 \d+ · 반대 \d+ · 우리 표/);
    const { record } = tallyAgenda(v.agendas[0], v.ai[0], TEAM, 'yes');
    const text = tallyText(record, (i) => g.league.teams[i].name);
    expect(text).toContain('게임 속 가상 결정');
    expect(text).toContain('(우리)');
    expect(g.offseason!.log.some((l) => l.stage === 'vote' && l.text.includes('단장 회의 안건'))).toBe(true);
    expect(FUTURE_RULE_SPEC.foreign.base).toBe(3);
  });
});

describe('해고 중 단장 회의 (2026-10-23 클사장 결정: 우리 표를 막고 모든 구단 AI 표)', () => {
  /** 모든 구단 AI 개표: 우리 구단 칸도 실무진 추천(AI 표) 그대로 */
  const allAi = (ai: number[]) => ai.map((v) => (v < 0 ? -1 : v));

  it('해고되면 표를 낼 수 없고, 새 구단에 부임해도 이번 회의는 막힌 채 모든 구단 AI 표로 개표한다', () => {
    const g = toVoteFired();
    const offers = g.league.owner!.offers!;
    expect(offers.length).toBeGreaterThan(0);
    expect(g.offseason!.stage).toBe('vote');
    expect(g.voteLocked).toBe(true);
    const r1 = g.voteRule('yes');
    expect(r1).toEqual({ ok: false, message: '해고 중이라 표를 낼 수 없습니다.' });
    expect(g.offseason!.vote!.user).toEqual({});
    expect(g.actions.some((a) => a.type === 'rule-vote')).toBe(false);
    expect(stageLeftovers(g).filter((l) => l.key.startsWith('vote:'))).toEqual([]);
    expect(stageHeadline(g)).toContain('해고 중 · 모든 구단 AI 표');
    expect(g.acceptOffer(offers[0]).ok).toBe(true);
    expect(g.voteLocked).toBe(true);
    expect(g.voteRule('no').ok).toBe(false);
    const ai = roundTrip(g.offseason!.vote!.ai[0]);
    expect(g.nextStage().ok).toBe(true);
    const r = g.league.ruleVotes!.at(-1)!;
    expect(r.userTeam).toBeUndefined();
    expect(r.user).toBeUndefined();
    expect(r.votes).toEqual(allAi(ai));
    expect(g.offseason!.log.some((l) => l.text.includes('해고 중이라 우리 표 없이'))).toBe(true);
    expect(g.offseason!.stage).toBe('fa');
    expect(g.voteLocked).toBe(false);
  });

  it('해고되지 않은 회의는 그대로 (막히지 않음)', () => {
    const g = toVote();
    expect(g.voteLocked).toBe(false);
    expect(g.voteRule('yes').ok).toBe(true);
  });

  it('예전 저장: 해고 중 낸 표가 오프시즌 상태에 남아 있어도 버리고 AI 표로 개표한다', () => {
    const g = toVoteFired();
    const a = g.offseason!.vote!.agendas[0];
    const ai = roundTrip(g.offseason!.vote!.ai[0]);
    const me = g.teamIdx;
    // 예전 코드가 받아 준 표: AI 추천과 반대로 넣어 차이가 드러나게 한다
    g.offseason!.vote!.user[a.id] = ai[me] === 1 ? 'no' : 'yes';
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(h.voteLocked).toBe(true);
    h.acceptOffer(h.league.owner!.offers![0]);
    h.nextStage();
    const r = h.league.ruleVotes!.at(-1)!;
    expect(r.userTeam).toBeUndefined();
    expect(r.votes).toEqual(allAi(ai));
  });

  it('재현: 예전에 해고 중 낸 표가 조작 기록에 있으면 그 표를 버리고, 표 없이 한 것과 같은 상태', () => {
    const opts = { year: 2026, teamIdx: TEAM, seed: SEED };
    const g = GameSession.create(store, opts, FAST);
    g.advance(1000);
    force.on = true;
    fire.on = true;
    try { g.beginOffseason(); } finally { force.on = false; fire.on = false; }
    expect(g.voteLocked).toBe(true);
    g.acceptOffer(g.league.owner!.offers![0]);
    g.nextStage();
    expect(g.league.ruleVotes!.at(-1)!.userTeam).toBeUndefined();
    // 예전 코드가 기록한 표: 해고 중(부임 전)과 부임 뒤에 하나씩 끼워 넣는다
    const begin = g.actions.findIndex((a) => a.type === 'begin-off');
    const accept = g.actions.findIndex((a) => a.type === 'accept-offer');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(accept).toBeGreaterThan(begin);
    const vote = (choice: 'yes' | 'no') => ({ year: 2026, type: 'rule-vote' as const, choice });
    const old = [...g.actions.slice(0, accept), vote('yes'), g.actions[accept], vote('no'), ...g.actions.slice(accept + 1)];
    force.on = true;
    fire.on = true;
    let r: GameSession;
    try {
      r = GameSession.replay(store, opts, old, undefined, FAST);
    } finally { force.on = false; fire.on = false; }
    expect(r.actions).toEqual(g.actions);
    expect(r.league.ruleVotes).toEqual(g.league.ruleVotes);
    expect(r.toSave().league).toEqual(g.toSave().league);
    expect(r.offseason).toEqual(g.offseason);
  }, 120_000);
});

describe('V4 화면 계산 (단장 회의 탭·개표·알림)', () => {
  it('남은 처리·위 줄: 표를 안 냈으면 넘기면 반대로 센다는 줄 (막지 않음), 내면 사라진다', () => {
    const g = toVote();
    const left = stageLeftovers(g);
    expect(left).toHaveLength(1);
    expect(left[0].blocking).toBeFalsy();
    expect(left[0].then).toContain('반대로');
    expect(stageHeadline(g)).toContain('우리 표 0/1');
    g.voteRule('yes');
    expect(stageLeftovers(g)).toEqual([]);
    expect(stageHeadline(g)).toContain('우리 표 1/1');
  });

  it('우리 구단에 닿는 것: 저장한 구단 지표로 낸 몫의 합이 AI 점수의 이해 항과 같다', () => {
    const g = toVote();
    const v = g.offseason!.vote!;
    expect(v.facts?.length).toBe(v.ai[0].filter((x) => x >= 0).length);
    const parts = interestBreakdown(v.agendas[0], v.facts!, TEAM);
    expect(parts.length).toBeGreaterThan(0);
    const mine = voteParts(v.agendas[0], v.facts!).find((p) => p.team === TEAM)!;
    expect(parts.reduce((a, p) => a + p.push, 0)).toBeCloseTo(mine.interest, 9);
    for (const p of parts) expect(p.rank).toBeGreaterThanOrEqual(1);
  });

  it('개막 알림: 가결은 규칙 줄에 표결 결과, 부결은 부결 줄 (가짓수에 세지 않음)', () => {
    for (const pass of [true, false]) {
      const g = toVote();
      const ai = g.offseason!.vote!.ai[0];
      g.offseason!.vote!.ai[0] = ai.map((x) => (x < 0 ? x : pass ? 1 : 0));
      g.voteRule(pass ? 'yes' : 'no');
      g.nextStage();
      const news = g.ruleNewsFor(g.year + 1);
      const line = [...news.main, ...news.other].find((l) => l.status === 'virtual' && l.vote);
      if (pass) {
        expect(line?.vote).toContain('가결');
        expect(line?.vote).toContain('우리 구단 찬성');
        expect(news.rejected).toBeUndefined();
      } else {
        expect(line).toBeUndefined();
        expect(news.rejected).toHaveLength(1);
        expect(news.rejected![0]).toContain('부결');
      }
    }
  });

  it('표결 결과 문구: 표를 안 냈으면 "표를 내지 않음", 모든 구단 AI면 우리 구단 줄 없음', () => {
    expect(voteResultText({ yes: 7, no: 3, need: 7, userTeam: 2 }, true)).toBe('단장 회의 찬성 7 : 반대 3 가결 (문턱 7, 우리 구단 반대 (표를 내지 않음))');
    expect(voteResultText({ yes: 5, no: 5, need: 7 }, false)).toBe('단장 회의 찬성 5 : 반대 5 부결 (문턱 7)');
    const news = ruleNews({ year: 2031, now: {} as never, rejected: [] });
    expect(news.rejected).toBeUndefined();
  });

  it('화면은 우리 표를 GameSession.voteRule로만 낸다 (새 조작·직접 castVote 없음)', () => {
    const src = readFileSync('src/ui/screens/Offseason.tsx', 'utf8');
    expect(src).toContain('session.voteRule(');
    expect(src).not.toMatch(/castVote|'rule-vote'/);
  });
});
