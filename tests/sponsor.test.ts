// 재정 2 F4 (docs/재정2_기획안.md 4.6·4.7·7장 F4a·F4b): 스폰서 계약·상품·식음, 구단주 예산 회의.
// ① 스폰서 제안·이름·자동 계약 ② 기본(자동)이면 스폰서+상품 리그 합이 예전 공식 +1~+6% (F6 맞춤), 조작·저장·replay
// ③ 회의 판정 경계(59·60, 44·45), 목표 상한·하한, 낮추기 → 증가 절반, 단계 순서, 돈 한 번만, 저장·replay
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { cashOf, faSupportCap, seasonFlows, sponsorAmount, starBonus } from '../src/league/finance';
import {
  askMoney, askScore, closeMeeting, FA_CAP_SCALE, holdMeeting, meetingOf, MEETING_ACCEPT, MEETING_CONDITIONAL, shiftGoal, verdictOf,
} from '../src/league/meeting';
import { STAGES } from '../src/league/offseason';
import { resultOf } from '../src/league/postseason';
import {
  bestOffer, dealsAt, emptySlots, expectedAmount, makeOffers, SPONSOR_NAME_PARTS, SPONSOR_SLOTS, type SponsorOffer,
} from '../src/league/sponsor';
import { isFuturesTeam } from '../src/league/world';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
const opts = (seed: string) => ({ year: 2026, teamIdx: lg, seed });

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
});

function toStage(g: GameSession, stage: string): void {
  let guard = 0;
  while (g.offseason!.stage !== stage && guard++ < 40) {
    const st = g.offseason!.stage;
    if (st === 'draft') g.autoDraft();
    if (st === 'comp') g.autoComp();
    if (st === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.offseason!.stage).toBe(stage);
}
function openNext(g: GameSession): void {
  toStage(g, 'ready');
  expect(g.openNextSeason().ok).toBe(true);
}
function toOffseason(g: GameSession): void {
  g.advance(100000);
  g.advancePostseason(10_000);
  g.beginOffseason();
}

// 실존 기업·그룹 이름 (가상 기업 이름에 들어가면 안 된다)
const REAL = ['삼성', '현대', '엘지', 'LG', 'SK', '롯데', '한화', '두산', '기아', '신한', '국민', '농협', '키움', '넥센', '쿠팡', '네이버', '카카오', 'CJ', '포스코', 'GS',
  '효성', '하이트', '오리온', '빙그레', '농심', '해태', '대한항공', '아시아나', '하나', '우리', '미래에셋', '신세계', '이마트', 'KT', '셀트리온', '크래프톤', '넷마블', '엔씨',
  '컴투스', '한국전력', '코오롱', '대상', '오뚜기', '동원', '풀무원', '매일', '남양', '교촌', '배달의민족', '토스', '한진', '금호', '부영', '태광', 'OB', 'MBC', '청보', '태평양', '쌍방울', '삼미', '해태'];

describe('① 스폰서 제안·자동 계약', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, opts('sp-t1'), FAST);
    toOffseason(g);
  });

  it('가상 기업 이름에 실존 기업 이름이 없다 (모든 조합)', () => {
    for (const a of SPONSOR_NAME_PARTS.PRE) for (const b of SPONSOR_NAME_PARTS.SUF) for (const r of REAL) expect(a + b).not.toContain(r);
  });

  it('첫 결산 뒤 모든 1군 구단에 빈 자리 셋 × 제안 셋, 같은 시드 같은 제안, 이름은 겹치지 않는다', () => {
    const L = g.league;
    for (let t = 0; t < L.teams.length; t++) {
      if (isFuturesTeam(L, t, 2027)) continue;
      const o = L.finance![t].sponsorOffers!;
      expect(o.year).toBe(2027);
      for (const s of SPONSOR_SLOTS) {
        expect(o.slots[s]).toHaveLength(3);
        for (const x of o.slots[s]!) { expect(x.years).toBeGreaterThanOrEqual(1); expect(x.years).toBeLessThanOrEqual(3); expect(x.amount).toBeGreaterThan(0); }
      }
      const names = SPONSOR_SLOTS.flatMap((s) => o.slots[s]!.map((x) => x.name));
      expect(new Set(names).size).toBe(names.length);
    }
    const again = makeOffers(L, lg, 2027, 1, 15000);
    expect(again).toEqual(makeOffers(L, lg, 2027, 1, 15000));
    // 메인 자리가 서브보다 비싸다 (자리 몫 0.6 대 0.2)
    const avg = (xs: SponsorOffer[]) => xs.reduce((s, x) => s + x.amount, 0) / xs.length;
    expect(avg(again.slots.main!)).toBeGreaterThan(2 * avg(again.slots.sub1!));
  });

  it('고르지 않으면 개막 때 기대 연액이 가장 큰 제안으로 자동 계약 (AI도 같은 규칙), 계약 기간 동안 연액 고정', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    const offers = roundTrip(r.league.finance!.map((f) => f.sponsorOffers));
    openNext(r);
    const L = r.league;
    for (let t = 0; t < L.teams.length; t++) {
      const o = offers[t];
      if (!o) continue;
      const deals = dealsAt(L, t, 2027);
      expect(deals).toHaveLength(3);
      for (const d of deals) {
        const list = o.slots[d.slot]!;
        expect(d.name).toBe(list[bestOffer(list)].name);
        expect(expectedAmount(d)).toBe(Math.max(...list.map(expectedAmount)));
        expect(d.to - d.from + 1).toBe(d.years);
      }
      expect(L.finance![t].sponsorOffers).toBeUndefined();
    }
  });
});

describe('② 돈 흐름·조작·저장', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, opts('sp-t2'), FAST);
    toOffseason(g);
  });

  it('기본(자동 계약) 첫 계약 시즌: 스폰서 + 상품·식음 리그 합이 예전 공식(같은 시즌 성적·인기도)의 +1~+6% (F6 맞춤)', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    openNext(r);
    r.advance(100000);
    r.advancePostseason(10_000);
    const L = r.league;
    const W = r.world;
    const S = r.season;
    const ps = resultOf(r.postseason!);
    const stars = starBonus(W, L);
    const legacy = L.teams.reduce((s, _, t) => {
      const rec = S.teams[t];
      const depth = ps.seeds.includes(t) ? 1 + ps.series.filter((x) => x.winner === t).length : 0;
      return s + sponsorAmount(L, t, isFuturesTeam(L, t, W.year), rec.w / Math.max(1, rec.w + rec.l), depth, stars[t] ?? 0, W.year);
    }, 0);
    // 시즌 중 상품·식음은 홈 경기마다 들어온다
    expect(seasonFlows({ league: L, world: W, season: S }, lg, 60).items.merch).toBeGreaterThan(0);
    r.beginOffseason();
    const now = L.teams.reduce((s, _, t) => { const h = L.finance![t].history.at(-1)!; return s + (h.items.sponsor ?? 0) + (h.items.merch ?? 0); }, 0);
    const merch = L.teams.reduce((s, _, t) => s + (L.finance![t].history.at(-1)!.items.merch ?? 0), 0);
    // 재정 2 F6 (2026-11-04): 장기 균형 맞춤으로 스폰서 계약 몫 55 → 58억 (예전 75억의 +4%). 첫 계약 시즌은 예전 공식의 +1~+6%
    // (장기에서는 계약이 지난 시즌 인기도를 따르고 상품·식음이 관중을 따라 F3 수준이 된다, reports/finance-longrun-f6.md)
    expect(now / legacy).toBeGreaterThan(1.01);
    expect(now / legacy).toBeLessThan(1.06);
    // 상품·식음은 평균 구단 20억 안팎 (임시값 맞춤)
    expect(merch / L.teams.length).toBeGreaterThan(150_000);
    expect(merch / L.teams.length).toBeLessThan(300_000);
  });

  it('조작 sponsor-sign: 빈 자리·없는 제안은 거절, 고른 제안으로 계약, replay·저장 왕복이 같은 계약·같은 다음 시즌 자금', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    const o = r.league.finance![lg].sponsorOffers!;
    const pick = o.slots.main!.findIndex((_, i) => i !== bestOffer(o.slots.main!));
    expect(r.signSponsor('main', 7).ok).toBe(false);
    expect(r.signSponsor('main', pick).ok).toBe(true);
    expect(r.signSponsor('main', 0).ok).toBe(false);
    expect(emptySlots(r.league, lg, 2027)).toEqual(['sub1', 'sub2']);
    const info = r.reproInfo();
    const back = GameSession.replay(store, roundTrip(info.opts), roundTrip(info.actions), info.at, FAST);
    expect(back.league.finance![lg].sponsors).toEqual(r.league.finance![lg].sponsors);
    const saved = GameSession.load(store, roundTrip(r.toSave()) as GameSaveV2, FAST);
    openNext(r);
    openNext(saved);
    expect(dealsAt(r.league, lg, 2027).find((d) => d.slot === 'main')!.name).toBe(o.slots.main![pick].name);
    r.advance(40);
    saved.advance(40);
    expect(saved.cashNow()).toBe(r.cashNow());
    // 시즌 중에는 계약할 수 없다
    expect(r.signSponsor('sub1', 0).ok).toBe(false);
  });
});

describe('③ 구단주 예산 회의', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, opts('sp-t3'), FAST);
    toOffseason(g);
  });

  it('단계 순서: 정원 정리 → 구단주 예산 회의 → 개막 준비, 회의 단계에서만 요청', () => {
    expect(STAGES.slice(-3)).toEqual(['release', 'meeting', 'ready']);
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(r.ownerAsk('money').ok).toBe(false);
    toStage(r, 'meeting');
    expect(r.ownerAsk('none').ok).toBe(true);
    expect(r.ownerAsk('money').ok).toBe(false); // 한 해 한 번
  });

  it('판정 경계: 60점 수락·59점 조건부·45점 조건부·44점 거절, 등급·목표·같은 요청 가감', () => {
    expect(verdictOf(MEETING_ACCEPT)).toBe('accept');
    expect(verdictOf(MEETING_ACCEPT - 1)).toBe('conditional');
    expect(verdictOf(MEETING_CONDITIONAL)).toBe('conditional');
    expect(verdictOf(MEETING_CONDITIONAL - 1)).toBe('reject');
    const L = roundTrip(g.league);
    const base = askScore(L, lg, 2027, 'money', { trust: 50, achieved: null }).score;
    expect(askScore(L, lg, 2027, 'money', { trust: 50, achieved: true }).score).toBe(base + 10);
    expect(askScore(L, lg, 2027, 'money', { trust: 50, achieved: false }).score).toBe(base - 10);
    // 같은 요청을 3년 안에 했으면 −10
    L.finance![lg].meetings = [{ year: 2025, ask: 'money', result: 'accepted', goalShift: 0, trust: 0, reason: '' }];
    expect(askScore(L, lg, 2027, 'money', { trust: 50, achieved: null }).score).toBe(base - 10);
    expect(askScore(L, lg, 2027, 'faCap', { trust: 50, achieved: null }).score).toBe(base);
    L.finance![lg].meetings = [{ year: 2023, ask: 'money', result: 'accepted', goalShift: 0, trust: 0, reason: '' }];
    expect(askScore(L, lg, 2027, 'money', { trust: 50, achieved: null }).score).toBe(base);
    // 실제 판정: 신뢰도로 점수를 60·59·44에 맞춘다
    const at = (score: number, ask: 'money' | 'faCap' = 'money') => {
      const M = roundTrip(g.league);
      const cash0 = cashOf(M, lg);
      const r = holdMeeting(M, lg, 2026, ask, { trust: score - (base - 50), achieved: null });
      return { r, M, gained: cashOf(M, lg) - cash0 };
    };
    const ok = at(60);
    expect(ok.r.record!.result).toBe('accepted');
    expect(ok.gained).toBe(askMoney(ok.M, lg, 2027));
    expect(ok.M.ledger.filter((e) => e.kind === 'parentExtra' && e.to === lg)).toHaveLength(1);
    const cond = at(59);
    expect(cond.r.record!.result).toBe('conditional');
    expect(cond.gained).toBe(0);
    const yes = holdMeeting(cond.M, lg, 2026, 'money', { trust: 0, achieved: null }, true);
    expect(yes.record!.result).toBe('accepted-cond');
    expect(yes.record!.goalShift).toBe(1);
    expect(cashOf(cond.M, lg) - cashOf(g.league, lg)).toBe(askMoney(cond.M, lg, 2027));
    expect(holdMeeting(cond.M, lg, 2026, 'money', { trust: 0, achieved: null }, true).ok).toBe(false); // 두 번 받지 않음
    const no = at(45);
    expect(no.r.record!.result).toBe('conditional');
    expect(closeMeeting(no.M, lg, 2026, { trust: 0, achieved: null }).result).toBe('declined');
    const rej = at(44);
    expect(rej.r.record!.result).toBe('rejected');
    expect(rej.r.record!.trust).toBe(-2);
    expect(rej.gained).toBe(0);
    // FA 계약금 지원 한도: 다음 FA(장부 연도 + 1)에 1.5배
    const fa = at(60, 'faCap');
    expect(faSupportCap(fa.M, lg, 2028)).toBe(Math.round(faSupportCap(g.league, lg, 2028) * FA_CAP_SCALE));
    expect(faSupportCap(fa.M, lg, 2027)).toBe(faSupportCap(g.league, lg, 2027));
  });

  it('목표 이동은 우승 위·탈꼴찌 아래로 가지 않는다', () => {
    expect(shiftGoal('champion', 1)).toBe('champion');
    expect(shiftGoal('notLast', -1)).toBe('notLast');
    expect(shiftGoal('postseason', 1)).toBe('champion');
    expect(shiftGoal('postseason', -1)).toBe('notLast');
  });

  it('목표 낮추기: 개막 목표 한 단계 아래, 달성하면 신뢰도 증가 절반 − 4. replay·저장 왕복 같음', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    toStage(r, 'meeting');
    expect(r.ownerAsk('lowerGoal').ok).toBe(true);
    const info = r.reproInfo();
    const back = GameSession.replay(store, roundTrip(info.opts), roundTrip(info.actions), info.at, FAST);
    expect(meetingOf(back.league, lg, 2027)).toEqual(meetingOf(r.league, lg, 2027));
    const saved = GameSession.load(store, roundTrip(r.toSave()) as GameSaveV2, FAST);
    // 견줄 판: 같은 시드에서 요청 없음
    const plain = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    openNext(r);
    openNext(saved);
    openNext(plain);
    const shifted = shiftGoal(plain.owner.goal!.kind, -1);
    expect(r.owner.goal!.kind).toBe(shifted);
    expect(saved.owner.goal!.kind).toBe(shifted);
    toOffseason(r);
    const h = r.owner.history.at(-1)!;
    const m = meetingOf(r.league, lg, 2027)!;
    expect(m.trust).toBeLessThanOrEqual(-4);
    // 신뢰도 변화 = 목표 판정(달성이면 절반) + 회의 몫 + 재정 몫 (재정 몫은 −15~+2)
    expect(h.trustAfter - h.trustBefore).toBeLessThanOrEqual(m.trust + 2 + (h.achieved ? 25 : 0));
  });

  it('요청 없이 넘기면 "요청 없음"(+1), 예전 조작 기록처럼 회의 단계에서 바로 개막해도 된다. AI 윈나우·자금 평균 아래만 돈 요청', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    toStage(r, 'meeting');
    expect(r.openNextSeason().ok).toBe(true);
    const m = meetingOf(r.league, lg, 2027)!;
    expect(m.ask).toBe('none');
    expect(m.trust).toBeGreaterThanOrEqual(-2); // +1 (예산 초과면 −3)
    for (let t = 0; t < r.league.teams.length; t++) {
      if (t === lg) continue;
      const mt = meetingOf(r.league, t, 2027);
      if (mt) { expect(mt.ask).toBe('money'); expect(['accepted', 'accepted-cond', 'rejected']).toContain(mt.result); }
    }
    // 돈은 장부에 한 번만 (판타지 면담 효과와 따로)
    const extra = r.league.ledger.filter((e) => e.kind === 'parentExtra' && e.year === 2027);
    for (let t = 0; t < r.league.teams.length; t++) expect(extra.filter((e) => e.to === t).length).toBeLessThanOrEqual(1);
  });
});
