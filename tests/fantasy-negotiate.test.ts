// 판타지 협상: 설득 결과(호감·요구액 할인)가 실제 게임 판단(트레이드 평가·다년 계약 요구액)을 바꾸고, 재현된다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type SimPlayer } from '../src/engine';
import { GameSession } from '../src/game/session';
import { agentTalk, agentTalkBlock, discountOf, goodwillOf, tradeTalk, tradeTalkBlock, GOODWILL_MAX } from '../src/fantasy/negotiate';
import { goodwillFor } from '../src/fantasy/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const mock = { provider: 'mock' as const, model: 'mock', key: '' };
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

/** 우리 한 명 ↔ 상대 한 명 가운데 조금(0~GOODWILL_MAX런) 모자라 거절되는 트레이드 */
function nearMiss(g: GameSession): { ai: number; give: SimPlayer; get: SimPlayer; gap: number } | null {
  const mine = g.team.org.filter((p) => !p.foreign && !p.dev);
  for (const t of g.world.teams) {
    if (t.idx === g.teamIdx) continue;
    for (const get of t.org.filter((p) => !p.foreign && !p.dev).slice(0, 25)) {
      for (const give of mine.slice(0, 30)) {
        const ev = g.evaluateTrade(t.idx, [give], [get]);
        const gap = ev.detail.need - ev.detail.gain;
        if (ev.verdict === 'reject-value' && gap > 0.5 && gap < GOODWILL_MAX - 0.5) return { ai: t.idx, give, get, gap };
      }
    }
  }
  return null;
}

describe('판타지 협상', () => {
  it('값 바꾸기: 태도 −3~+3 → 호감 ±6런, 할인 최대 10%·할증 최대 6%', () => {
    expect(goodwillOf(3)).toBe(6);
    expect(goodwillOf(-3)).toBe(-6);
    expect(discountOf(3)).toBeCloseTo(0.1, 2);
    expect(discountOf(-3)).toBeCloseTo(-0.06, 2);
  });

  it('트레이드: 조금 모자라 거절되던 제안이 설득(호감)으로 성사되고, 재현이 같다', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'neg-1', fantasy: {} }, FAST);
    g.advance(15);
    const m = nearMiss(g);
    expect(m, '조금 모자란 트레이드를 찾지 못했습니다').not.toBeNull();
    const { ai, give, get } = m!;
    expect(g.evaluateTrade(ai, [give], [get]).verdict).toBe('reject-value');
    const e = await tradeTalk(g, { ...mock }, { team: ai, proposal: 'x', verdict: 'short', gap: m!.gap, tendency: 't', argument: '좋은 제안입니다' });
    // 시험용 AI는 태도 2 (호감 +4). 모자란 만큼을 확실히 넘기려고 최대 호감으로 바꿔 넣는다
    e.effects = [{ type: 'tradeGoodwill', team: ai, runs: GOODWILL_MAX, days: 14 }];
    g.addFantasy(e);
    expect(goodwillFor(g.fantasy, ai, 2026, g.currentDay)).toBe(GOODWILL_MAX);
    expect(tradeTalkBlock(g, ai)).toMatch(/다시 이야기/);
    expect(g.proposeTrade(ai, [give], [get]).verdict).toBe('accept');
    expect(give.teamIdx).toBe(ai);
    g.advance(20);
    // 호감은 14일 뒤 사라진다
    expect(goodwillFor(g.fantasy, ai, 2026, g.currentDay)).toBe(0);
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(g.toSave().league));
    // 성사 뒤 20일 안에 AI 구단끼리 다시 트레이드할 수 있어(16-5b neg-1: KT → 7번 구단) 상대 구단이 아니라 원본 판의 소속과 견준다
    expect(r.world.players.find((p) => p.id === give.id)!.teamIdx).toBe(g.world.players.find((p) => p.id === give.id)!.teamIdx);
  }, 600_000);

  it('보통 게임에는 호감이 없다 (평가가 그대로)', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'neg-2' }, FAST);
    expect(goodwillFor(g.fantasy, 0, 2026, 0)).toBe(0);
  }, 120_000);

  it('다년 계약: 에이전트 설득으로 요구액이 깎이고 실제 계약 연봉도 깎인 값, 같은 선수는 한 번만', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'neg-3', fantasy: {} }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const offers = g.extensionOffers();
    expect(offers.length).toBeGreaterThan(0);
    const target = offers.sort((a, b) => b.demands[0].salary - a.demands[0].salary)[0];
    const before = target.demands.find((d) => d.years === 2)!.salary;
    const e = await agentTalk(g, { ...mock }, target.p, '다년 계약', '오래 함께하고 싶습니다');
    g.addFantasy(e);
    const pct = discountOf(2);
    const after = g.extensionOffers().find((x) => x.p.id === target.p.id)!.demands.find((d) => d.years === 2)!.salary;
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(before * (1 - pct), -2);
    expect(agentTalkBlock(g, target.p)).toMatch(/이미 협상/);
    expect(g.extend(target.p.id, 2).ok).toBe(true);
    expect(g.leaguePlayer(target.p.id)!.contract.salary).toBe(after);
  }, 600_000);
});
