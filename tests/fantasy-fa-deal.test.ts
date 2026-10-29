// AI 판정(판타지·자유 모드)으로 정한 FA 조건이 FA 시장 마감 뒤 실제 계약에 그대로 이행되는가 (2026-10-29 사용자 보고
// "fa때 ai로 판정된 조건들이 실제로 이행되지 않는 문제")
// - 자유 모드: 게임 마스터가 FA 시장의 선수에게 move·contract를 내면 전에는 FA 항목이 열린 채 남아, 라운드 마감 때 다른 구단 계약·무적 선수로 덮였다
// - 판타지 모드: 에이전트 설득 할인으로 깎은 값을 제시하면 수락 기준만 낮아지고, 구단 고르기는 깎기 전 값으로 견줘 늘 다른 구단에 졌다
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { resolveOps } from '../src/fantasy/free';
import { agentTalk, sanitizeDeal, DEAL_MAX_SALARY } from '../src/fantasy/negotiate';
import { spendLimit } from '../src/league/owner';
import { minSalary } from '../src/league/salary';
import { leniencyOf, NEGOTIATE_SCALE } from '../src/fantasy/leniency';

// LLM 답 고정: llmReply가 있으면 completeJsonText가 그 답을 낸다 (실제 API는 부르지 않는다, 제공자는 mock)
let llmReply: string | null = null;
vi.mock('../src/fantasy/llm', async (orig) => {
  const m = await orig<typeof import('../src/fantasy/llm')>();
  return { ...m, completeJsonText: async (s: Parameters<typeof m.completeJsonText>[0], req: Parameters<typeof m.completeJsonText>[1]) => llmReply ?? m.completeJsonText(s, req) };
});
const mock = { provider: 'mock' as const, model: 'mock', key: '' };

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

/** 시즌을 끝내고 오프시즌 FA 단계 첫 라운드까지 */
function toFa(seed: string, fantasy: { free?: boolean }): GameSession {
  const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed, fantasy }, FAST);
  g.advance(100000);
  // 구단주 신뢰를 손으로 올리지 않는다 (조작 기록에 없어 재현이 어긋난다). 해고되면 FA 단계로 못 간다
  g.beginOffseason();
  for (let guard = 0; g.offseason!.stage !== 'fa' && guard < 20; guard++) expect(g.nextStage().ok).toBe(true);
  expect(g.offseason!.stage).toBe('fa');
  return g;
}

/** FA 단계를 끝까지 (보상선수 단계 앞까지) */
function finishFa(g: GameSession): void {
  for (let guard = 0; g.offseason!.stage === 'fa' && guard < 10; guard++) expect(g.nextStage().ok).toBe(true);
}

describe('AI 판정 FA 조건의 이행', () => {
  it('자유 모드: 게임 마스터가 합의한 다른 구단 FA(이동 + 연봉·기간)는 FA 마감 뒤에도 우리 구단·그 조건', () => {
    const g = toFa('fa-deal-1', { free: true });
    const off = g.offseason!;
    const lg = g.teamIdx;
    // 요구액이 가장 높은 다른 구단 FA (AI 구단들이 다투는 선수)
    const e = off.fa.entries.find((x) => x.status === 'open' && !x.returnee && x.from !== lg)!;
    const p = g.leaguePlayer(e.id)!;
    const salary = Math.round(e.ask / 1000) / 10 + 0.3; // 억 원
    const { ops, dropped } = resolveOps(g, [
      { op: 'move', player: `${p.name}@${g.league.teams[e.from].name}`, to: g.league.teams[lg].name },
      { op: 'contract', player: `${p.name}@${g.league.teams[lg].name}`, salary, years: 3 },
    ]);
    expect(dropped).toEqual([]);
    g.addFantasy({ kind: 'action', title: 'FA 합의', text: 'x', ops });
    // 판정 즉시 계약 확정
    expect(e.status).toBe('signed');
    expect(e.team).toBe(lg);
    finishFa(g);
    const lp = g.leaguePlayer(e.id)!;
    expect(lp.team).toBe(lg);
    expect(lp.contract.salary).toBe(Math.round(salary * 10000));
    expect(lp.contract.until).toBe(off.year + 3);
    expect(lp.contract.kind).toBe('fa');
    // 외부 FA 영입 한 명으로 센다, 재현이 같다
    expect(off.fa.signings[lg]).toBeGreaterThanOrEqual(1);
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(g.toSave().league));
    expect(roundTrip(r.toSave().offseason)).toEqual(roundTrip(g.toSave().offseason));
  }, 900_000);

  it('자유 모드: 게임 마스터가 계약(contract)만 낸 우리 FA는 그 조건으로 잔류', () => {
    const g = toFa('fa-deal-2', { free: true });
    const off = g.offseason!;
    const lg = g.teamIdx;
    const e = off.fa.entries.find((x) => x.status === 'open' && !x.returnee && x.from === lg);
    expect(e, '우리 FA가 없는 시드').toBeDefined();
    const p = g.leaguePlayer(e!.id)!;
    const { ops } = resolveOps(g, [{ op: 'contract', player: p.name, salary: 2.5, years: 2 }]);
    g.addFantasy({ kind: 'action', title: '잔류 합의', text: 'x', ops });
    finishFa(g);
    expect(e!.status).toBe('signed');
    const lp = g.leaguePlayer(e!.id)!;
    expect(lp.team).toBe(lg);
    expect(lp.contract.salary).toBe(25000);
    expect(lp.contract.until).toBe(off.year + 2);
  }, 900_000);

  it('판타지 모드: 에이전트가 깎아 준 값으로 제시하면, 깎기 전 값과 같은 무게로 다른 구단 제시와 견준다', () => {
    const g = toFa('fa-deal-3', {});
    const lg = g.teamIdx;
    // 견줄 판: 같은 자리에서 우리 제시 없이 1라운드를 마감해, 원 소속이 아닌 구단이 요구 기간으로 데려간 선수와 그 연봉을 찾는다
    const ref = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(ref.nextStage().ok).toBe(true);
    const target = ref.offseason!.fa.entries.find((x) => x.round === 1 && x.status === 'signed' && !x.returnee
      && x.team !== x.from && x.team !== lg && x.from !== lg && x.signedYears === x.years);
    expect(target, '다른 구단이 데려간 외부 FA가 없는 시드').toBeDefined();
    const e = g.offseason!.fa.entries.find((x) => x.id === target!.id)!;
    // 에이전트 설득 할인 10% (agentTalk 효과와 같은 칸). 그 구단 연봉의 90%를 요구 기간으로 제시 (할인 전 값으로 치면 그 구단과 같다)
    g.addFantasy({ kind: 'chat', title: '에이전트', text: 'x', effects: [{ type: 'demandDiscount', player: e.id, pct: 0.1 }] });
    const offer = Math.ceil(target!.salary! * 0.9);
    expect(g.offerFa(e.id, offer, e.years).ok).toBe(true);
    expect(g.nextStage().ok).toBe(true);
    // 깎은 값 ÷ (1 − 할인) ≥ 그 구단 연봉 → 같은 무게 이상 (같으면 우리 쪽). 전에는 깎은 값 그대로 견줘 늘 졌다
    expect(e.status).toBe('signed');
    expect(e.team).toBe(lg);
    expect(g.leaguePlayer(e.id)!.contract.salary).toBe(offer);
  }, 900_000);

  // 사용자 재현 (2026-10-29): "로얄티를 근거로 FA 연봉을 동결한다고 했는데 실제로 그렇게 제안하면 거절"
  // 전에는 에이전트(LLM)가 말(reply)로 어떤 양보든 할 수 있었지만, 게임에 들어가는 것은 태도(stance −3~3) → 요구액 할인 최대 DISCOUNT_MAX(10%) × 관대함 배율뿐이라
  // 말로 약속한 조건(동결 = 전년 연봉)과 실제 수락 기준(요구액 × (1 − 할인))이 어긋났다. 이제 deal 숫자로 받아 그 조건 제시는 반드시 수락 (사용자 결정 "말한 대로 이행")
  it('판타지 모드: 에이전트가 말로 "연봉 동결"에 동의하면, 그 값(전년 연봉)으로 낸 제시가 받아들여진다 [사용자 재현]', async () => {
    const g = toFa('fa-deal-2', {});
    const off = g.offseason!;
    const lg = g.teamIdx;
    // 우리 FA 가운데 요구액이 전년 연봉보다 크게 높은 선수 (동결이면 할인 10%로 닿지 않는다)
    const e = off.fa.entries.find((x) => x.status === 'open' && !x.returnee && x.from === lg && x.prevSalary < x.ask * 0.8);
    expect(e, '요구액이 전년 연봉보다 25% 넘게 높은 우리 FA가 없는 시드').toBeDefined();
    const p = g.leaguePlayer(e!.id)!;
    llmReply = JSON.stringify({ reply: '구단에 대한 선수의 로열티를 존중합니다. 내년 연봉은 올해와 같은 금액으로 동결하는 데 동의하겠습니다.', stance: 3,
      deal: { salary: e!.prevSalary / 10000, years: e!.years } });
    try {
      const talk = await agentTalk(g, { ...mock }, p, 'FA 협상', '프랜차이즈 선수로서의 로열티를 봐서 연봉 동결로 남아 달라');
      g.addFantasy(talk);
      // 게임이 실제로 받은 것: 할인 10% (보통 관대함), 말한 동결과는 다른 값
      const pct = (talk.effects![0] as { pct: number }).pct;
      expect(pct).toBeCloseTo(0.1 * NEGOTIATE_SCALE[leniencyOf(g.league)], 3);
      expect(e!.prevSalary).toBeLessThan(e!.ask * (1 - pct));
      // 말한 조건은 숫자로 따로 들어간다
      expect(talk.effects![1]).toEqual({ type: 'agreedDeal', player: p.id, salary: e!.prevSalary, years: e!.years });
    } finally {
      llmReply = null;
    }
    // 동결 조건(전년 연봉, 요구 기간)으로 제시
    expect(g.offerFa(e!.id, e!.prevSalary, e!.years).ok).toBe(true);
    expect(g.nextStage().ok).toBe(true);
    const rejected = off.log.some((l) => l.text.includes(`${p.name}: 우리 제시`));
    expect(rejected, `${p.name}: 에이전트가 동결에 동의했는데 우리 제시가 거절됐다 (요구 ${e!.ask}, 제시 ${e!.prevSalary})`).toBe(false);
    expect(e!.status).toBe('signed');
    expect(e!.team).toBe(lg);
    expect(g.leaguePlayer(e!.id)!.contract.salary).toBe(e!.prevSalary);
  }, 900_000);

  it('판타지 모드: 합의 조건은 저장 왕복·재현에서 같고, 다른 구단이 더 많이 내도 합의 조건 제시가 이긴다', async () => {
    const g = toFa('fa-deal-3', {});
    const lg = g.teamIdx;
    // 다른 구단이 데려가는 외부 FA (견줄 판에서 확인)
    const ref = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(ref.nextStage().ok).toBe(true);
    const target = ref.offseason!.fa.entries.find((x) => x.round === 1 && x.status === 'signed' && !x.returnee && x.team !== x.from && x.team !== lg && x.from !== lg)!;
    const e = g.offseason!.fa.entries.find((x) => x.id === target.id)!;
    const p = g.leaguePlayer(e.id)!;
    const salary = Math.round(target.salary! * 0.7 / 1000) * 1000; // 그 구단 연봉의 70%
    llmReply = JSON.stringify({ reply: '좋습니다. 그 조건이면 계약하겠습니다.', stance: 1, deal: { salary: salary / 10000, years: e.years } });
    try {
      g.addFantasy(await agentTalk(g, { ...mock }, p, 'FA 협상', '우리 팀의 중심이 되어 달라'));
    } finally {
      llmReply = null;
    }
    expect(g.fantasy!.deals).toEqual([{ id: p.id, year: g.year, salary, years: e.years }]);
    // 저장 왕복
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(h.fantasy!.deals).toEqual(g.fantasy!.deals);
    // 합의보다 낮거나 기간이 다르면 합의 아님 (보통 규칙: 요구액에 크게 못 미쳐 거절)
    expect(g.offerFa(e.id, salary, e.years).ok).toBe(true);
    expect(g.nextStage().ok).toBe(true);
    expect(e.status).toBe('signed');
    expect(e.team).toBe(lg);
    expect(g.leaguePlayer(e.id)!.contract.salary).toBe(salary);
    expect(g.offseason!.log.some((l) => l.text.includes('에이전트와 합의한 조건'))).toBe(true);
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(g.toSave().league));
  }, 900_000);

  it('판타지 모드: 합의와 다른 기간·낮은 연봉은 합의가 아니다', async () => {
    const g = toFa('fa-deal-2', {});
    const lg = g.teamIdx;
    const e = g.offseason!.fa.entries.find((x) => x.status === 'open' && !x.returnee && x.from === lg && x.prevSalary < x.ask * 0.8)!;
    const p = g.leaguePlayer(e.id)!;
    llmReply = JSON.stringify({ reply: '동결로 하죠.', stance: 0, deal: { salary: e.prevSalary / 10000, years: 2 } });
    try {
      g.addFantasy(await agentTalk(g, { ...mock }, p, 'FA 협상', '동결'));
    } finally {
      llmReply = null;
    }
    expect(g.offerFa(e.id, e.prevSalary, 3).ok).toBe(true);
    expect(g.nextStage().ok).toBe(true);
    expect(g.offseason!.log.some((l) => l.text.includes(`${p.name}: 우리 제시`))).toBe(true);
    expect(e.team === lg && e.salary === e.prevSalary).toBe(false);
  }, 900_000);

  it('판타지 모드: 비FA 다년 계약도 합의한 기간이면 합의 연봉 그대로', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'neg-3', fantasy: {} }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const target = g.extensionOffers().sort((a, b) => b.demands[0].salary - a.demands[0].salary)[0];
    const now = target.p.contract.salary;
    llmReply = JSON.stringify({ reply: '지금 연봉 그대로 4년 하겠습니다.', stance: 3, deal: { salary: now / 10000, years: 4 } });
    try {
      g.addFantasy(await agentTalk(g, { ...mock }, target.p, '다년 계약', '오래 함께하자'));
    } finally {
      llmReply = null;
    }
    expect(g.extensionOffers().find((x) => x.p.id === target.p.id)!.demands.find((d) => d.years === 4)!.salary).toBe(now);
    expect(g.extend(target.p.id, 4).ok).toBe(true);
    expect(g.leaguePlayer(target.p.id)!.contract.salary).toBe(now);
  }, 600_000);

  it('합의 조건 검사: 숫자가 없거나 엉뚱하면 버린다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'fa-deal-s', fantasy: {} }, FAST);
    const L = g.league;
    const t = g.teamIdx;
    const min = minSalary(2027, L);
    expect(sanitizeDeal(L, t, 2026, { salary: 4.5, years: 3 })).toEqual({ salary: 45000, years: 3 });
    expect(sanitizeDeal(L, t, 2026, { salary: '4.5억', years: '2' })).toEqual({ salary: 45000, years: 2 });
    for (const bad of [null, undefined, '동결', {}, { salary: 4.5 }, { years: 3 }, { salary: -3, years: 2 }, { salary: 0, years: 2 }, { salary: 'abc', years: 2 },
      { salary: 4.5, years: 0 }, { salary: 4.5, years: 2.5 }, { salary: 4.5, years: 11 }, { salary: (min - 100) / 10000, years: 1 }, { salary: 150, years: 1 },
      { salary: Infinity, years: 1 }]) {
      expect(sanitizeDeal(L, t, 2026, bad), JSON.stringify(bad)).toBeNull();
    }
    // 우리 구단 지출 상한(샐러리캡)을 혼자 넘는 연봉: 캡을 낮춘 판으로 (자유 모드 규정 capScale)
    const tight = roundTrip(L);
    tight.rules = { ...(tight.rules ?? {}), capScale: 0.1 };
    const low = spendLimit(tight, t, 2027)!;
    expect(sanitizeDeal(tight, t, 2026, { salary: low / 10000, years: 1 })).toEqual({ salary: low, years: 1 });
    expect(low).toBeLessThan(DEAL_MAX_SALARY);
    expect(sanitizeDeal(tight, t, 2026, { salary: (low + 10000) / 10000, years: 1 })).toBeNull();
  }, 120_000);
});
