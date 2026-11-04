// 스폰서 계약과 상품·식음 (재정 2 F4a, docs/재정2_기획안.md 4.6, 결정 Q4·Q8).
// - 예전 스폰서·상품 75억(SPONSOR_BASE) × 인기도를 스폰서 계약 55억 몫 + 상품·식음(관중 연동)으로 나눈다.
// - 스폰서 자리는 메인 1·서브 2. 결산 뒤 빈 자리마다 가상 기업 3곳이 제안하고(시드로 정해짐), 고르지 않으면 개막 때 기대 연액이 가장 큰 제안으로 자동 계약 (AI도 같은 규칙).
// - 계약 기간 동안 연액 고정 (2026년 돈, 지급 때 연봉 지수). 성적형·인기형은 결산 때 보너스.
// - 계약이 아직 없는 시즌(새 게임 첫 시즌, 예전 저장)은 예전 공식 그대로 (finance.ts sponsorAmount).
// 수치는 모두 임시값.
import { Rng } from '../engine';
import type { LeagueState } from './types';

export type SponsorSlot = 'main' | 'sub1' | 'sub2';
export const SPONSOR_SLOTS: SponsorSlot[] = ['main', 'sub1', 'sub2'];
export const SLOT_LABEL: Record<SponsorSlot, string> = { main: '메인', sub1: '서브 1', sub2: '서브 2' };
/** 안정형(보너스 없음) · 성적형(가을야구 진출·우승 보너스) · 인기형(관중 목표 보너스) */
export type SponsorStyle = 'stable' | 'perf' | 'pop';
export const STYLE_LABEL: Record<SponsorStyle, string> = { stable: '안정형', perf: '성적형', pop: '인기형' };

/**
 * 스폰서 계약 몫 (만 원, 2026년 돈, 인기도 1일 때 세 자리 합, 임시값). F4a는 55억(+ 상품·식음 20억 = 예전 SPONSOR_BASE 75억).
 * 재정 2 F6 (2026-11-04): 55 → 58억. 3시드 20시즌(tools/finance_longrun.ts)에서 스폰서 + 상품·식음이 F3(예전 공식)보다 해마다 약 1.7억,
 * 입장권 탄력성으로 관중 수입이 약 0.9억 적어 평균 자금이 줄었다. 상품·식음(관중 연동)을 올리면 큰 구장 구단에 몰려
 * (키움 평균 자금 97 → 65억) 인기도를 따르는 계약 몫으로 되돌렸다 (reports/finance-longrun-f6.md)
 */
export const SPONSOR_DEALS_BASE = 580_000;
/** 자리 몫 (임시값) */
export const SLOT_SHARE: Record<SponsorSlot, number> = { main: 0.6, sub1: 0.2, sub2: 0.2 };
/** 성향별 연액 배율 (임시값) */
export const STYLE_SCALE: Record<SponsorStyle, number> = { stable: 1, perf: 0.85, pop: 0.9 };
/** 성적형 보너스: 가을야구 진출 +10%, 우승이면 +25% (진출 몫 대신). 인기형: 홈 경기당 관중이 목표 이상이면 +15% (임시값) */
export const PERF_BONUS = { postseason: 0.1, champion: 0.25 };
export const POP_BONUS = 0.15;
/** 기대 연액 셈의 보너스 확률 (자동 계약 판단, 임시값): 가을야구 진출 반, 우승 10%, 인기 목표 반 */
export const BONUS_ODDS = { postseason: 0.5, champion: 0.1, pop: 0.5 };
/** 기업 성향 배율 범위 (임시값) */
export const FIRM_RANGE: [number, number] = [0.85, 1.15];
/**
 * 기준 연액 맞춤 (임시값): 세 제안 중 기대 연액이 가장 큰 것을 고르므로 고른 계약의 평균이 기준보다 크다.
 * 그 몫을 덜어 자동 계약 리그 합이 기준(SPONSOR_DEALS_BASE × 인기도)에 맞게 (F4a 때 첫 계약 시즌 ±2%로 맞춤)
 */
export const SPONSOR_NORM = 0.98;
/** 상품·식음 1인 구매액 (만 원, 2026년 돈, 임시값): 평균 구단 홈 관중 약 123만 명 → 약 21억. F6에서 0.19도 재 보았으나 0.17 그대로 (SPONSOR_DEALS_BASE 주석) */
export const MERCH_PER_FAN = 0.17;

export interface SponsorOffer {
  /** 가상 기업 이름 */
  name: string;
  style: SponsorStyle;
  /** 계약 기간 (해) */
  years: number;
  /** 연액 (만 원, 2026년 돈) */
  amount: number;
  /** 인기형 목표: 홈 경기당 관중 (제안 때 지난 시즌 값) */
  target?: number;
}
export interface SponsorDeal extends SponsorOffer {
  slot: SponsorSlot;
  /** 첫 시즌·마지막 시즌 */
  from: number;
  to: number;
}
/** 결산 때 만든 다음 시즌 제안 (빈 자리마다 3개) */
export interface SponsorOffers {
  year: number;
  slots: Partial<Record<SponsorSlot, SponsorOffer[]>>;
}

// 가상 기업 이름 (실존 기업 이름이 나오지 않게 조합, tests/sponsor.test.ts 금지 목록)
const PRE = ['늘봄', '푸른솔', '가온', '나래', '다솜', '모아', '새벽별', '초롱', '여울', '노을', '아름드리', '한결', '해오름', '바람꽃'];
const SUF = ['식품', '화학', '정보통신', '물류', '바이오', '금융', '레저', '유통', '소프트', '중공업', '제과', '음료', '주류', '보험'];
export const SPONSOR_NAME_PARTS = { PRE, SUF };

/** 그 시즌에 걸린 계약 */
export function dealsAt(league: Pick<LeagueState, 'finance'>, team: number, year: number): SponsorDeal[] {
  return (league.finance?.[team]?.sponsors ?? []).filter((d) => d.from <= year && year <= d.to);
}

/** 그 시즌 비어 있는 자리 */
export function emptySlots(league: Pick<LeagueState, 'finance'>, team: number, year: number): SponsorSlot[] {
  const taken = new Set(dealsAt(league, team, year).map((d) => d.slot));
  return SPONSOR_SLOTS.filter((s) => !taken.has(s));
}

/** 그 시즌을 계약 모델로 셈하는지 (계약이 하나라도 걸려 있으면). 아니면 예전 공식 */
export const sponsorModelAt = (league: Pick<LeagueState, 'finance'>, team: number, year: number) => dealsAt(league, team, year).length > 0;

/** 기대 연액 (자동 계약 판단, 2026년 돈) */
export function expectedAmount(o: SponsorOffer): number {
  const b = o.style === 'perf' ? BONUS_ODDS.postseason * PERF_BONUS.postseason + BONUS_ODDS.champion * (PERF_BONUS.champion - PERF_BONUS.postseason)
    : o.style === 'pop' ? BONUS_ODDS.pop * POP_BONUS : 0;
  return o.amount * (1 + b);
}

/** 기대 연액이 가장 큰 제안 번호 (같으면 앞 번호) */
export function bestOffer(offers: SponsorOffer[]): number {
  let best = 0;
  for (let i = 1; i < offers.length; i++) if (expectedAmount(offers[i]) > expectedAmount(offers[best])) best = i;
  return best;
}

/**
 * 결산 때 다음 시즌(year) 빈 자리의 제안을 만든다. pop = 지난 시즌 인기도(마케팅·프런트 배율 포함), perGame = 지난 시즌 홈 경기당 관중.
 * 난수는 `${seed}/finance2/sponsor/${year}/${team}` 하나
 */
export function makeOffers(league: LeagueState, team: number, year: number, pop: number, perGame: number): SponsorOffers {
  const rng = new Rng(`${league.seed}/finance2/sponsor/${year}/${team}`);
  const used = new Set<string>(dealsAt(league, team, year).map((d) => d.name));
  const slots: SponsorOffers['slots'] = {};
  for (const slot of emptySlots(league, team, year)) {
    const base = SPONSOR_DEALS_BASE * pop * SLOT_SHARE[slot] * SPONSOR_NORM;
    const list: SponsorOffer[] = [];
    for (let i = 0; i < 3; i++) {
      let name = '';
      do name = PRE[rng.int(PRE.length)] + SUF[rng.int(SUF.length)]; while (used.has(name));
      used.add(name);
      const style = (['stable', 'perf', 'pop'] as SponsorStyle[])[rng.int(3)];
      const firm = FIRM_RANGE[0] + rng.next() * (FIRM_RANGE[1] - FIRM_RANGE[0]);
      const years = 1 + rng.int(3);
      const amount = Math.max(1_000, Math.round((base * firm * STYLE_SCALE[style]) / 1_000) * 1_000);
      list.push({ name, style, years, amount, ...(style === 'pop' ? { target: Math.round(perGame) } : {}) });
    }
    slots[slot] = list;
  }
  return { year, slots };
}

/** 제안 하나로 계약한다 (그 자리가 비어 있어야). 계약 첫 시즌 = 제안의 시즌 */
export function signSponsor(league: LeagueState, team: number, slot: SponsorSlot, offer: number): { ok: boolean; message: string } {
  const f = league.finance?.[team];
  const offers = f?.sponsorOffers;
  if (!f || !offers || !SPONSOR_SLOTS.includes(slot)) return { ok: false, message: '받을 수 있는 스폰서 제안이 없습니다.' };
  const o = offers.slots[slot]?.[offer];
  if (!o) return { ok: false, message: '없는 제안입니다.' };
  if (!emptySlots(league, team, offers.year).includes(slot)) return { ok: false, message: `${SLOT_LABEL[slot]} 자리는 이미 계약되어 있습니다.` };
  f.sponsors = [...(f.sponsors ?? []).filter((d) => d.to >= offers.year - 1), { ...o, slot, from: offers.year, to: offers.year + o.years - 1 }];
  return { ok: true, message: `${SLOT_LABEL[slot]} 스폰서 계약: ${o.name} (${STYLE_LABEL[o.style]}, ${offers.year}~${offers.year + o.years - 1} 시즌, 해마다 ${(o.amount / 10000).toFixed(1)}억 원, 2026년 물가)` };
}

/** 개막 때 (league.year = 새 시즌): 모든 구단의 빈 자리를 기대 연액이 가장 큰 제안으로 자동 계약 (플레이어 구단도 고르지 않은 자리는). 계약한 자리 수 */
export function autoSignSponsors(league: LeagueState, team: number): SponsorSlot[] {
  const f = league.finance?.[team];
  const offers = f?.sponsorOffers;
  if (!f || !offers || offers.year !== league.year) return [];
  const signed: SponsorSlot[] = [];
  for (const slot of emptySlots(league, team, offers.year)) {
    const list = offers.slots[slot];
    if (!list?.length) continue;
    if (signSponsor(league, team, slot, bestOffer(list)).ok) signed.push(slot);
  }
  delete f.sponsorOffers;
  return signed;
}

/** 그 시즌 계약 기본 연액 합 (2026년 돈) */
export const dealsBase = (deals: SponsorDeal[]) => deals.reduce((s, d) => s + d.amount, 0);

/** 결산 보너스 (2026년 돈): 성적형 가을야구 진출·우승, 인기형 관중 목표 */
export function dealsBonus(deals: SponsorDeal[], depth: number, champion: boolean, perGame: number): number {
  let b = 0;
  for (const d of deals) {
    if (d.style === 'perf') b += d.amount * (champion ? PERF_BONUS.champion : depth >= 1 ? PERF_BONUS.postseason : 0);
    else if (d.style === 'pop' && d.target !== undefined && perGame >= d.target) b += d.amount * POP_BONUS;
  }
  return b;
}
