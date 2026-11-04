// 재정 (재정 상세형, docs/finance.md, 2026-10-11 사용자 결정).
//
// 구단 자금 = 장부(league.ledger)의 합. 보상금·제재금처럼 이미 장부에 남던 돈이 그대로 실제 돈이 된다.
// 시즌 중 수입·지출(관중 수입, 지급일(2~11월 10번, payPlan)의 연봉·운영비·투자비)은 경기 기록과 날짜에서 그때그때 계산하고(seasonFlows),
// 결산(settleSeason) 때 항목별로 장부에 적는다. 그래서 하루씩 진행하든 한 번에 진행하든 금액이 같다.
// 금액은 모두 2026년 돈(만 원). 화면에서만 그 해 물가(priceIndex)로 바꿔 보여 준다. 수치는 임시값.
// 2026년 뒤에는 연봉과 함께 수입(객단가·중계권·스폰서·모기업 지원·우승 배당)·운영비·투자비·기준 자금이 연봉 상승 지수(salary.ts wageIndex)만큼 오른다 (2026-10-22).

import { currentRuns, valueContext } from '../ai/value';
import { Rng, type Season, type World } from '../engine';
import { dateOf } from '../game/calendar';
import type { SeriesGame } from './postseason';
import { parentGrade, type ParentGrade } from './owner';
import type { LedgerEntry, LeaguePlayer, LeagueState } from './types';
import { isFuturesTeam } from './world';
import { fillBuff } from './events';
import { legendFill } from './history';
import { rivalFill } from './rivals';
import { coachPayroll } from './coaches';
import { managerPayroll } from './managers';
import { gmStyle } from './gm';
import { settingsOf, userTeamOf } from './difficulty';
import { wageIndex } from './salary';
import { faCapScale, type MeetingRecord } from './meeting';
import { dealsAt, dealsBase, dealsBonus, emptySlots, autoSignSponsors, bestOffer, makeOffers, MERCH_PER_FAN, type SponsorDeal, type SponsorOffers } from './sponsor';
import {
  ensureFans, ensureStadiums, fanFill, fanLevel, fansSeasonEnd, fanSponsor, installment, seatsAt, stadiumFill, stadiumYearEnd, ticketScale,
} from './stadium';

// ---- 수치 (임시값, docs/finance.md 2~4장)

/** 달러 → 만 원 (1달러 = 1,400원) */
export const WON_PER_USD = 0.14;
/**
 * 관중 1명당 객단가 (만 원). 2026-10-13 연고 시장을 실제 관중으로 맞춰 관중이 약 10% 늘어 1.6 → 1.46으로 낮춰 관중 수입 합을 그대로 뒀다
 * (2024 실제: 입장 수입 약 1,593억 원 ÷ 관중 1,088만 명 ≈ 1.46만 원, 보도 기준)
 */
export const TICKET = 1.46;
/** 가을야구 객단가 (만 원) */
export const POSTSEASON_TICKET = 3.0;
/** 중계권·리그 공동 수익 (구단마다 같은 몫, 만 원) */
export const BROADCAST = 1_000_000;
/** 스폰서·상품 기본액 (인기도 1일 때, 만 원). 2026-10-11 90억 → 75억 (사용자: 돈이 너무 넉넉하다) */
export const SPONSOR_BASE = 750_000;
/**
 * 운영비 (인건비·원정·구장·2군 운영, 한 해, 만 원). 2026-10-11 200억 → 220억 (재정 긴축).
 * 2026-10-21 220억 → 202억: 긴축 뒤에 들어온 코치 시스템(84c8083)이 감독·코치 연봉(첫 시즌 구단 평균 약 18억)을
 * 따로 떼어 내면서 운영비의 인건비를 줄이지 않아 두 번 냈다. 그 탓에 첫 시즌 결산 뒤 10구단 중 평균 4.8곳이 자금 0이 되어
 * FA 계약금을 못 내고 자기 FA도 잡지 못했다 (reports/first-season-balance.md). 긴축 때 맞춘 지출 합으로 되돌린다
 */
export const OPS_COST = 2_020_000;
/** 운영비 네 줄 (재정 2 F1a, docs/재정2_기획안.md 4.4) */
export type OpsKind = 'opsFront' | 'opsGame' | 'opsPark' | 'opsFutures';
export const OPS_KINDS: OpsKind[] = ['opsFront', 'opsGame', 'opsPark', 'opsFutures'];
/**
 * 운영비를 넷으로 나눈 기본 몫 (만 원, 합 = OPS_COST): 프런트 60억·원정·경기 운영 50억·구장 운영 45억·2군 운영 47억.
 * 임시값 (근거 없음, 재정 2 기획안 4.4). 퓨처스 구단은 합과 함께 각각 × FUTURES_OPS_SHARE
 */
export const OPS_SPLIT: Record<OpsKind, number> = { opsFront: 600_000, opsGame: 500_000, opsPark: 450_000, opsFutures: 470_000 };
/**
 * 운영비 한 번 지급액(total)을 네 줄로 나눈다. 반올림 나머지는 원정·경기 운영에 (합이 늘 total).
 * w는 네 줄 몫 (재정 2 F2: 프런트·2군은 그 구단 예산, opsWeights), 없으면 기본 몫
 */
export function splitOps(total: number, w: Record<OpsKind, number> = OPS_SPLIT): Record<OpsKind, number> {
  const all = OPS_KINDS.reduce((s, k) => s + w[k], 0);
  const front = Math.round((total * w.opsFront) / all);
  const park = Math.round((total * w.opsPark) / all);
  const futures = Math.round((total * w.opsFutures) / all);
  return { opsFront: front, opsGame: total - front - park - futures, opsPark: park, opsFutures: futures };
}
/** 모기업 지원금 기본액 (등급별, 한 해, 만 원) */
export const PARENT_BASE: Record<ParentGrade, number> = { A: 600_000, B: 450_000, C: 0 };
/**
 * 모기업 FA 계약금 지원의 한 해 한도 = 모기업 지원금 기본액(PARENT_BASE) × 이 비율 (2026-10-21 사용자 결정 "한도를 둔다", 비율은 임시값).
 * A 30억 · B 22.5억 · C(모기업 없는 히어로즈) 0. 한도 전 10시드 첫 오프시즌에 한 구단이 최대 43.7억, 히어로즈가 18억을 받았다
 */
export const FA_SUPPORT_SHARE = 0.5;
/** 구단 이름 스폰서 (모기업 없는 히어로즈, 한 해, 만 원) */
export const NAMING_SPONSOR: Record<string, number> = { 히어로즈: 500_000 };
/** 자금이 이만큼을 넘으면 모기업 지원금을 넘는 금액의 PARENT_CLAWBACK만큼 줄인다 (자금이 끝없이 쌓이지 않게) */
export const PARENT_RESERVE = 800_000;
export const PARENT_CLAWBACK = 0.5;
/** 결산 뒤 자금이 이만큼을 넘으면 넘는 금액의 DIVIDEND_SHARE를 모기업에 돌려준다 (실제 구단은 흑자를 쌓아 두지 않는다, 임시값) */
export const DIVIDEND_RESERVE = 1_000_000;
export const DIVIDEND_SHARE = 0.5;
/** 우승 보너스 (리그 배분, 만 원) */
export const CHAMPION_BONUS = 200_000;
/** 새 게임 시작 자금 (만 원) */
export const START_CASH = 500_000;
/** 창단 구단의 창단 자본금 (시작 자금에 더한다, 만 원, 임시값) */
export const EXPANSION_CAPITAL = 2_000_000;
/** 퓨처스 구단(1군 진입 전)의 운영비 비율 */
export const FUTURES_OPS_SHARE = 0.3;

/** 창단 구단 자본금을 장부에 넣는다 */
export function addExpansionCapital(league: LeagueState, team: number, year: number): void {
  league.ledger.push({ year, from: -1, to: team, amount: EXPANSION_CAPITAL, note: `${league.teams[team].name} 창단 자본금`, kind: 'start' });
}

/**
 * 구장 수용 인원과 연고 시장 보정 (구단 계보별, 대략의 공개 수치·임시값. 시대별 구장 변화는 다루지 않는다).
 * 연고 시장(팬덤 기본값에도 쓴다, stadium.ts)은 2026-10-13 실제 관중으로 맞췄다 (tools/attendance.ts, docs/temp-values.md):
 * 2024 구단별 평균 관중(한화는 새 구장 2025 전반기)에서 실제 승률 몫을 빼고 남은 몫. 쌍방울·현대계는 자료가 없어 그대로
 */
export const BALLPARK: Record<string, { capacity: number; market: number }> = {
  LG: { capacity: 23_750, market: 0.12 },
  두산: { capacity: 23_750, market: 0.12 },
  롯데: { capacity: 22_758, market: 0.1 },
  SSG: { capacity: 23_000, market: 0.02 },
  삼성: { capacity: 24_000, market: 0.09 },
  KIA: { capacity: 20_500, market: 0.1 },
  한화: { capacity: 17_000, market: 0.17 },
  NC: { capacity: 17_983, market: 0 },
  KT: { capacity: 18_700, market: -0.02 },
  히어로즈: { capacity: 16_000, market: 0.08 },
  쌍방울: { capacity: 12_000, market: -0.06 },
  현대계: { capacity: 15_000, market: -0.04 },
};
const DEFAULT_PARK = { capacity: 18_000, market: 0 };

/**
 * 투자 갈래. 스카우트는 셋으로 나뉜다 (능력치 v2 기획안 19.3, 사용자 2026-10-24 확정 Q12 ①): scout = 아마추어(드래프트·육성선수 보드),
 * scoutPro = 프로(다른 구단·시장 선수 추측), 해외 파견은 단계가 아니라 파견마다 낸다 (scoutfx.ts). 장부에는 '스카우트비' 한 줄 (scouting)
 */
export type InvestKind = 'scout' | 'scoutPro' | 'develop' | 'medical' | 'marketing';
export const INVEST_KINDS: InvestKind[] = ['scout', 'scoutPro', 'develop', 'medical', 'marketing'];
export const SCOUT_KINDS: InvestKind[] = ['scout', 'scoutPro'];
export const INVEST_LABEL: Record<InvestKind, string> = {
  scout: '스카우트 (아마추어)', scoutPro: '스카우트 (프로)', develop: '육성 (2군·코치)', medical: '의료·트레이닝', marketing: '마케팅·구장',
};
/**
 * 투자 단계별 연간 비용 (0~3단계, 만 원, 임시값). 2026-10-29 사용자 보고 "스카우트 팀이나 의료팀에 책정된 비용이 너무 과해 감당이 불가능한 수준임 3단계기준",
 * 이어서 "3333으로 하면 그냥 적자가 난다니까? 대체 세상 어느 구단이 시설팀 좀 확충했다고 적자가 나"로 크게 내렸다.
 * 전: 스카우트 아마추어·프로 각 0·5·12·20억, 육성 0·15·30·50억, 의료 0·10·20·35억, 마케팅 0·10·25·45억 (모두 3단계 연 170억).
 * 목표: 모두 3단계여도 B 등급 중위 구단이 투자 때문에 적자로 돌아서지 않고(투자는 연봉·FA보다 작은 몫), 높은 단계일수록 비싸게 (단계 사이 비율은 대략 그대로).
 * 측정은 tools/invest_cost.ts (reports/invest-cost-before.md → reports/invest-cost.md)
 * 재정 2 F2 (docs/재정2_기획안.md 4.2): 투자는 금액 예산이고 이 표는 화면 눈금(0·1·2·3단계 금액)이다. 체감 곡선 조건(1단계 ÷ 3단계 < 1/3) 때문에
 * 스카우트 둘의 3단계 눈금을 2.5 → 3.5억, 육성을 6 → 7억으로 올렸다
 */
export const INVEST_COST: Record<InvestKind, number[]> = {
  scout: [0, 10_000, 15_000, 35_000],
  scoutPro: [0, 10_000, 15_000, 35_000],
  develop: [0, 20_000, 35_000, 70_000],
  medical: [0, 10_000, 20_000, 40_000],
  marketing: [0, 50_000, 120_000, 200_000],
};

// ---- 예산 (재정 2 F2, docs/재정2_기획안.md 4.2~4.4)

/** 예산 줄: 투자 5갈래 + 프런트·2군 운영 (운영비 넷 중 조절하는 둘) */
export type BudgetKind = InvestKind | 'front' | 'futures';
export const BUDGET_KINDS: BudgetKind[] = ['scout', 'scoutPro', 'develop', 'medical', 'marketing', 'front', 'futures'];
export const BUDGET_LABEL: Record<BudgetKind, string> = { ...INVEST_LABEL, front: '프런트', futures: '2군 운영' };
/** 예산 금액 단위 (1천만 원 = 1,000만 원) */
export const BUDGET_UNIT = 1_000;
/** 투자 금액 상한 = 3단계 눈금 × 이 배율 (1천만 원 단위로 내림, 임시값: B 구단이 모두 상한이어도 3시즌 수지 ≥ 0, tools/invest_cost.ts) */
export const INVEST_CAP_SCALE = 1.5;
/** 프런트·2군 운영 범위 (만 원, 2026년 돈, 임시값). 기본값은 운영비 넷의 기본 몫 (OPS_SPLIT) */
export const OPS_BUDGET_RANGE: Record<'front' | 'futures', [number, number]> = { front: [450_000, 800_000], futures: [350_000, 650_000] };
/** 예산 줄 범위 [하한, 상한] (만 원, 2026년 돈) */
export function budgetRange(kind: BudgetKind): [number, number] {
  if (kind === 'front' || kind === 'futures') return OPS_BUDGET_RANGE[kind];
  return [0, Math.floor((INVEST_COST[kind][3] * INVEST_CAP_SCALE) / BUDGET_UNIT) * BUDGET_UNIT];
}
/**
 * 체감 곡선 상수 k (만 원): s(a) = 3 × (1 − e^(−a/k)) / (1 − e^(−A3/k)), s(1단계 눈금) = 1이 되게 이분법으로 정한 값 (tests/finance2.test.ts가 확인).
 * 1단계 ÷ 3단계 비가 같은 갈래는 k ÷ A3가 같다 (스카우트·육성 1/3.5, 의료·마케팅 1/4)
 */
export const INVEST_K: Record<InvestKind, number> = {
  scout: 77_155.576, scoutPro: 77_155.576, develop: 154_311.152, medical: 47_605.474, marketing: 238_027.372,
};
/** 곡선 그대로의 효과 단계 (눈금에서 딱 맞추기 전) */
export function investCurve(kind: InvestKind, amount: number): number {
  const k = INVEST_K[kind];
  const a3 = INVEST_COST[kind][3];
  return (3 * (1 - Math.exp(-Math.max(0, amount) / k))) / (1 - Math.exp(-a3 / k));
}
/**
 * 투자 금액 → 효과 단계 s (소수, 0~약 4). s(0) = 0, s(1단계 눈금) = 1, s(3단계 눈금) = 3은 정확히 (기본값 = 예전 효과), 그 사이는 오목 (1억당 효과가 줄어듦).
 * 3단계 위(상한까지)도 곡선대로 오른다
 */
export function investStep(kind: InvestKind, amount: number): number {
  if (amount <= 0) return 0;
  if (amount === INVEST_COST[kind][1]) return 1;
  if (amount === INVEST_COST[kind][3]) return 3;
  return investCurve(kind, amount);
}
/** 단계 표(0~3)를 효과 단계 s로 잇는다. 3단계 위는 마지막 구간 기울기의 절반으로 늘리고(임시값), floor/ceil로 막는다 */
export function stepAt(table: number[], s: number, limit?: number): number {
  const last = table.length - 1;
  const x = Math.max(0, s);
  if (x <= last) {
    const i = Math.min(last - 1, Math.floor(x));
    return table[i] + (table[i + 1] - table[i]) * (x - i);
  }
  const v = table[last] + ((table[last] - table[last - 1]) / 2) * (x - last);
  if (limit === undefined) return v;
  return table[last] < table[0] ? Math.max(limit, v) : Math.min(limit, v);
}
/** 3단계 위 효과의 막는 값 (임시값): 의료 부상 확률·결장 배율 0.7, 스카우트 추측 폭 배율 0.4 (천장 추측 폭은 같은 비율로 3.6등급) */
export const MEDICAL_FLOOR = 0.7;
export const SCOUT_FLOOR = 0.4;
export const CEIL_SIGMA_FLOOR = 3.6;
/** 운영 예산 효과 (임시값, 선형): 프런트 45억 0.95 · 60억 1 · 80억 1.05 → 스폰서·상품 배율, 2군 운영 35억 0.8 · 47억 1 · 65억 1.2 → 2군 성장 기회 배율 */
export const FRONT_SPONSOR: [number, number] = [0.95, 1.05];
export const FUTURES_GROWTH: [number, number] = [0.8, 1.2];
function opsScale(kind: 'front' | 'futures', amount: number, ends: [number, number]): number {
  const [lo, hi] = OPS_BUDGET_RANGE[kind];
  const base = kind === 'front' ? OPS_SPLIT.opsFront : OPS_SPLIT.opsFutures;
  const a = Math.max(lo, Math.min(hi, amount));
  if (a === base) return 1;
  return a < base ? 1 - ((1 - ends[0]) * (base - a)) / (base - lo) : 1 + ((ends[1] - 1) * (a - base)) / (hi - base);
}
export const frontScale = (amount: number) => opsScale('front', amount, FRONT_SPONSOR);
export const futuresScale = (amount: number) => opsScale('futures', amount, FUTURES_GROWTH);

/** 재무팀 추천안 (임시값, 2026년 돈 기준 금액, wageIndex를 곱하지 않는다). 균형 = 지금 1단계 + 운영비 기본값 */
export type BudgetPreset = 'balance' | 'winnow' | 'develop' | 'frugal';
export const BUDGET_PRESETS: BudgetPreset[] = ['balance', 'winnow', 'develop', 'frugal'];
export const PRESET_LABEL: Record<BudgetPreset, string> = { balance: '균형', winnow: '윈나우', develop: '육성', frugal: '긴축' };
export const PRESET_BUDGET: Record<BudgetPreset, Record<BudgetKind, number>> = {
  balance: { scout: 10_000, scoutPro: 10_000, develop: 20_000, medical: 10_000, marketing: 50_000, front: 600_000, futures: 470_000 },
  winnow: { scout: 10_000, scoutPro: 25_000, develop: 20_000, medical: 30_000, marketing: 120_000, front: 600_000, futures: 420_000 },
  develop: { scout: 25_000, scoutPro: 10_000, develop: 50_000, medical: 10_000, marketing: 50_000, front: 550_000, futures: 550_000 },
  frugal: { scout: 5_000, scoutPro: 5_000, develop: 10_000, medical: 5_000, marketing: 20_000, front: 500_000, futures: 400_000 },
};
const isInvestKind = (k: BudgetKind): k is InvestKind => k !== 'front' && k !== 'futures';
/** 금액에 가장 가까운 눈금 단계 (예전 invest·active 칸을 채운다. 효과에는 쓰지 않는다) */
export function nearestLevel(kind: InvestKind, amount: number): number {
  let best = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(INVEST_COST[kind][i] - amount) < Math.abs(INVEST_COST[kind][best] - amount)) best = i;
  return best;
}
/**
 * 예산 (만 원, 2026년 돈). planned = 다음 시즌 계획(budget), 아니면 이번 시즌 확정(activeBudget).
 * 칸이 없는 예전 저장은 투자 단계(invest·active) → 그 단계 눈금 금액, 프런트·2군은 기본값
 */
export function budgetOf(f: TeamFinance | undefined, planned: boolean): Record<BudgetKind, number> {
  const src = planned ? f?.budget : f?.activeBudget;
  const lv = planned ? f?.invest : f?.active ?? f?.invest;
  const out = {} as Record<BudgetKind, number>;
  for (const k of BUDGET_KINDS) {
    out[k] = src?.[k] ?? (isInvestKind(k) ? INVEST_COST[k][lv?.[k] ?? 0] ?? 0 : PRESET_BUDGET.balance[k]);
  }
  return out;
}
/** 고정한 줄 (자동 배분이 건드리지 않음). 칸이 없는 예전 저장은 1단계가 아닌 투자 갈래를 고정으로 본다 (플레이어가 고른 것) */
export function lockedOf(f: TeamFinance | undefined): BudgetKind[] {
  if (!f) return [];
  return f.locked ?? INVEST_KINDS.filter((k) => (f.invest?.[k] ?? 1) !== 1);
}
/** 예산 한 줄의 효과 설명 (화면용, 금액 → 효과 단계 s → 효과 표). 숨은 값은 쓰지 않는다 */
export function budgetEffect(kind: BudgetKind, amount: number): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (kind === 'front') return `스폰서·상품 수입 × ${frontScale(amount).toFixed(3)}`;
  if (kind === 'futures') return `2군 출전 성장 기회 × ${futuresScale(amount).toFixed(2)} (${FUTURES_GROWTH_AGE}세 이하)`;
  const s = investStep(kind, amount);
  const st = `효과 ${s.toFixed(2)}단계`;
  if (!s) return '효과 없음' + (kind === 'marketing' ? ' (쌓인 효과가 천천히 빠짐)' : '');
  switch (kind) {
    case 'scout': return `${st}: 신인 천장 추측 폭 ±${stepAt(CEIL_SIGMA, s, CEIL_SIGMA_FLOOR).toFixed(1)}등급, 신인 능력 추측 범위 −${pct(1 - stepAt(SCOUT_SCALE, s, SCOUT_FLOOR))}`;
    case 'scoutPro': return `${st}: 다른 구단·시장 선수 능력 추측 범위 −${pct(1 - stepAt(SCOUT_SCALE, s, SCOUT_FLOOR))}`;
    case 'develop': return `${st}: ${DEVELOP_AGE}세 이하 성장 폭 +${pct(stepAt(DEVELOP_BONUS, s))}, 2군 출전 몫 +${stepAt(DEVELOP_SHARE, s).toFixed(3)}`;
    case 'medical': { const m = medicalScale(s); return `${st}: 부상 확률 −${pct(1 - m.rate)}, 결장 기간 −${pct(1 - m.days)}`; }
    case 'marketing': return `${st}: 다 쌓이면 관중률 +${(stepAt(MARKETING_FILL, s) * 100).toFixed(1)}%p, 스폰서·상품 +${pct(stepAt(MARKETING_SPONSOR, s) - 1)} (개막마다 조금씩 쌓임)`;
  }
}
/** 2군 운영 예산 효과를 받는 나이 (offseason.ts FUTURES_AGE와 같음) */
const FUTURES_GROWTH_AGE = 25;

/** 예산 계획을 바꾸고 예전 칸(invest)을 가까운 눈금으로 맞춘다 */
function writeBudget(f: TeamFinance, b: Record<BudgetKind, number>): void {
  f.budget = { ...b };
  f.invest = { ...f.invest };
  for (const k of INVEST_KINDS) f.invest[k] = nearestLevel(k, b[k]);
}
/**
 * 마케팅 단계별 관중률 보정과 스폰서 배율 (다 쌓였을 때). 효과는 단계가 아니라 쌓인 효과(TeamFinance.mk, 단계 단위)로 내고 그 사이는 잇는다.
 * 2026-10-29 사용자: "무조건 수익이 나게하면 3단계를 안할 이유가 전혀 없잖아. 말 그대로 투자라고 투자. 점진적인 증가가 와야지".
 * 관중률은 0.03씩 → 0.04씩으로 조금 올렸고, 스폰서 배율은 인기도 상한(1.4) 밖에서 곱한다 (전에는 상한 안이라 인기 구단은 마케팅 스폰서 효과가 거의 없었다)
 */
export const MARKETING_FILL = [0, 0.04, 0.08, 0.12];
export const MARKETING_SPONSOR = [1, 1.05, 1.1, 1.15];
/**
 * 마케팅 쌓인 효과가 개막 때 고른 단계 쪽으로 다가가는 몫 (올릴 때 MARKETING_UP, 내릴 때 MARKETING_DOWN, 임시값).
 * 0 → 3단계: 1년차 0.9 · 3년차 1.97 · 5년차 2.5단계. 3 → 0단계로 끊으면 1년차 2.55 · 3년차 1.84 · 5년차 1.33단계로 천천히 빠진다
 */
export const MARKETING_UP = 0.3;
export const MARKETING_DOWN = 0.15;
/** 스카우트 단계(0~3)별 추측 폭 배율 (아마추어·프로 모두, 기획안 17.7 표, 임시값). scout.ts가 쓴다 */
export const SCOUT_SCALE = [1, 0.8, 0.65, 0.5];
/** 아마추어 스카우트 단계별 신인 천장 추측 폭 σ_천장 (등급, 19.2 확정 Q15 ①: 보드와 진짜 천장 상관 0.6 → 0.9) */
export const CEIL_SIGMA = [12, 9, 6.5, 4.5];
/** 육성: DEVELOP_AGE(30세) 이하 성장 폭 배율 가산, 2군 유망주 출전 몫 가산 */
export const DEVELOP_BONUS = [0, 0.06, 0.12, 0.2];
export const DEVELOP_SHARE = [0, 0.05, 0.1, 0.15];
/** 육성 투자 효과를 받는 나이 (이하). 2026-10-11 사용자 결정으로 25세 → 30세 */
export const DEVELOP_AGE = 30;
/** 의료·트레이닝: 부상 확률 배율, 결장 기간 배율 */
export const MEDICAL_RATE = [1, 0.92, 0.85, 0.78];
export const MEDICAL_DAYS = [1, 0.93, 0.87, 0.8];


// ---- 좌석 등급별 입장권 가격 (재정 2 F3, docs/재정2_기획안.md 4.5, 결정 Q3)

export type SeatGrade = 'general' | 'reserved' | 'premium';
export const SEAT_GRADES: SeatGrade[] = ['general', 'reserved', 'premium'];
export const SEAT_LABEL: Record<SeatGrade, string> = { general: '일반석', reserved: '지정석', premium: '프리미엄' };
export const SEAT_NOTE: Record<SeatGrade, string> = { general: '외야·응원석', reserved: '내야', premium: '테이블·스카이박스' };
/**
 * 좌석 비중, 기본 가격(만 원, 2026년 돈, 시설 배율 전), 가격 탄력성 (임시값, 시대별 좌석 구성 자료 없음 → 1982년부터 같은 세 등급).
 * 가중 평균 1.4625만 원 ≈ TICKET 1.46. 실제 셈은 기본 가격 ÷ 가중 평균(seatFactor)을 TICKET에 곱해 기본 가격이면 관중 수입이 예전과 같다
 */
/**
 * 가격 탄력성 (기본 가격에서, 임시값). 관중률 = min(1, 수요 × e^(탄력성 × (배율 − 1))) 꼴이라 값을 올릴수록 더 민감해지고
 * (배율 s에서 점 탄력성 = 탄력성 × s), 한 등급 수입은 배율 −1/탄력성에서 꼭대기 (일반 100%·지정 111%·프리미엄 125%).
 * 2026-11-03 사용자 "관중이 더 빠지게" (F3의 −0.8·−0.6·−0.3은 올릴수록 늘 이득이었다, reports/ticket-check.md)
 */
export const ELASTIC_GENERAL = -1.0;
export const ELASTIC_RESERVED = -0.9;
export const ELASTIC_PREMIUM = -0.8;
export const SEAT: Record<SeatGrade, { share: number; price: number; elastic: number }> = {
  general: { share: 0.55, price: 0.95, elastic: ELASTIC_GENERAL },
  reserved: { share: 0.35, price: 1.6, elastic: ELASTIC_RESERVED },
  premium: { share: 0.1, price: 3.8, elastic: ELASTIC_PREMIUM },
};
const SEAT_AVG = (['general', 'reserved', 'premium'] as SeatGrade[]).reduce((s, g) => s + SEAT[g].share * SEAT[g].price, 0);
/** 등급 가격 몫 (좌석 비중 가중 합 = 1) */
export const seatFactor = (g: SeatGrade) => SEAT[g].price / SEAT_AVG;
/** 가격 배율 범위와 칸 (70~150%, 5%) */
export const PRICE_RANGE: [number, number] = [0.7, 1.5];
export const PRICE_STEP = 0.05;
/** 결산 때 팬 만족도 −PRICE_FAN × (관중 가중 가격 지수 − 1) (임시값) */
export const PRICE_FAN = 10;
/** 재무팀 추천 가격: 지난 시즌 관중률 ≥ HIGH → 지정·프리미엄 110%, ≤ LOW → 일반 90%, 그 밖 100% (기획 4.5 [정함]) */
export const PRICE_REC_HIGH = 0.9;
export const PRICE_REC_LOW = 0.6;

export type SeatPrices = Record<SeatGrade, number>;
export const basePrices = (): SeatPrices => ({ general: 1, reserved: 1, premium: 1 });
export const isBasePrices = (p: SeatPrices) => SEAT_GRADES.every((g) => p[g] === 1);

/** 가격 배율. planned = 다음 시즌 계획(prices), 아니면 이번 시즌 확정(activePrices). 칸이 없으면 모두 1 (기본 가격) */
export function pricesOf(f: TeamFinance | undefined, planned: boolean): SeatPrices {
  const src = planned ? f?.prices : f?.activePrices;
  const out = basePrices();
  for (const g of SEAT_GRADES) if (src?.[g] !== undefined) out[g] = src[g]!;
  return out;
}
export const priceLockedOf = (f: TeamFinance | undefined): SeatGrade[] => f?.priceLocked ?? [];

/**
 * 한 등급 관중률: min(1, 수요 d × e^(탄력성 × (배율 − 1))). 수요 d는 좌석을 넘을 수 있다 (만원 구단의 넘친 수요, demandRate):
 * 넘친 만큼은 값을 올려도 관중이 빠지지 않아 만원 구단만 올려서 이득을 본다
 */
export function seatFill(d: number, g: SeatGrade, scale: number): number {
  if (scale === 1) return Math.min(1, d);
  return Math.min(1, d * Math.exp(SEAT[g].elastic * (scale - 1)));
}

/** 한 경기 관중 (좌석 cap, 수요 관중률 d(1 넘을 수 있음), 한 명 평균 객단가 ticket). 기본 가격이면 예전 셈 그대로 (반올림까지). seats = 등급별 관중 (소수) */
export function gameGate(cap: number, d: number, ticket: number, prices: SeatPrices): { fans: number; revenue: number; seats: SeatPrices } {
  const seats = basePrices();
  if (isBasePrices(prices)) {
    const f = Math.min(1, d);
    const fans = Math.round(cap * f);
    for (const g of SEAT_GRADES) seats[g] = cap * SEAT[g].share * f;
    return { fans, revenue: Math.round(fans * ticket), seats };
  }
  let n = 0;
  let r = 0;
  for (const g of SEAT_GRADES) {
    seats[g] = cap * SEAT[g].share * seatFill(d, g, prices[g]);
    n += seats[g];
    r += seats[g] * ticket * seatFactor(g) * prices[g];
  }
  return { fans: Math.round(n), revenue: Math.round(r), seats };
}

const roundSeats = (x: SeatPrices): SeatPrices => ({ general: Math.round(x.general), reserved: Math.round(x.reserved), premium: Math.round(x.premium) });

/** 관중 가중 가격 지수 P (1 = 기본): Σ 관중 × 기본 가격 × 배율 ÷ Σ 관중 × 기본 가격 */
export function priceIndexOf(seats: SeatPrices, prices: SeatPrices): number {
  let a = 0;
  let b = 0;
  for (const g of SEAT_GRADES) { a += seats[g] * seatFactor(g) * prices[g]; b += seats[g] * seatFactor(g); }
  return b > 0 ? a / b : 1;
}
/** 좌석 가중 가격 지수 (관중 반응 전). 이벤트 "입장권 가격 조정"의 결과에 곱한다 */
export const seatPriceIndex = (p: SeatPrices) => SEAT_GRADES.reduce((s, g) => s + SEAT[g].share * seatFactor(g) * p[g], 0);
/** 결산 때 가격에 따른 팬 만족도 변화 (0.1 단위로 반올림) */
export const priceFanDelta = (P: number) => Math.round(-PRICE_FAN * (P - 1) * 10) / 10;

/** 수요 관중률 분포 (FinanceYear.demand): 칸 i = 수요 i/20, 칸 31개 (0~1.5, 넘친 수요 포함). F3 첫 판(칸 21개, 1에서 잘림) 저장도 같은 눈금으로 읽는다 */
export const DEMAND_STEP = 20;
export const DEMAND_BINS = 31;
export const demandBin = (f: number) => Math.max(0, Math.min(DEMAND_BINS - 1, Math.round(f * DEMAND_STEP)));

/**
 * 수요 분포와 가격으로 한 경기 평균 등급별 예상 관중·관중 수입 (좌석 cap, 한 명 평균 객단가 ticket).
 * 분포가 없으면(예전 결산) 평균 관중률 하나로
 */
export function gatePredict(demand: number[] | undefined, meanFill: number, cap: number, ticket: number, prices: SeatPrices):
  { fans: number; revenue: number; seats: SeatPrices; gate: SeatPrices } {
  const bins: [number, number][] = demand && demand.some((c) => c > 0)
    ? demand.map((c, i) => [i / DEMAND_STEP, c] as [number, number]).filter(([, c]) => c > 0)
    : [[meanFill, 1]];
  const total = bins.reduce((s, [, c]) => s + c, 0) || 1;
  const seats = basePrices();
  const gate = basePrices();
  for (const g of SEAT_GRADES) {
    let s = 0;
    for (const [f, c] of bins) s += c * cap * SEAT[g].share * seatFill(f, g, prices[g]);
    seats[g] = s / total;
    gate[g] = seats[g] * ticket * seatFactor(g) * prices[g];
  }
  const sum = (x: SeatPrices) => SEAT_GRADES.reduce((s, g) => s + x[g], 0);
  return { fans: sum(seats), revenue: sum(gate), seats, gate };
}

/** 그 해 그 구단 한 등급 입장권 한 장 값 (만 원, 2026년 돈): 기본 가격 × 배율 × 시설 배율 × 연봉 지수 ÷ 시대 관중 배율 (화면용) */
export function seatTicket(league: LeagueState, team: number, year: number, grade: SeatGrade, scale: number): number {
  return (TICKET * seatFactor(grade) * scale * ticketScale(league.stadiums?.[team]) * wageIndex(year, league)) / eraFillScale(year);
}

/** 그 해 그 구단 좌석 수 */
export function capOf(league: LeagueState, team: number, year: number): number {
  const park = league.stadiums?.[team];
  return park ? seatsAt(park, year) : parkOf(league, team).capacity;
}

/**
 * 지난 시즌 수요 관중률 (가격 반응 전). 분포가 있으면 그 평균, 없으면 관중 ÷ (홈 경기 × 좌석).
 * 추천 가격은 이 값으로 정한다: 값을 올려 관중률이 떨어지면 다음 해 다시 내리는 널뛰기를 막는다 (기본 가격이면 기획의 "지난 시즌 관중률"과 같음)
 */
export function lastDemand(league: LeagueState, team: number): number | null {
  const h = league.finance?.[team]?.history.at(-1);
  if (!h) return null;
  if (h.demand?.some((c) => c > 0)) {
    let n = 0;
    let s = 0;
    h.demand.forEach((c, i) => { n += c; s += c * (i / DEMAND_STEP); });
    return s / n;
  }
  if (!h.homeGames || !h.attendance) return null;
  return h.attendance / (h.homeGames * capOf(league, team, h.year));
}

/** 재무팀 추천 가격 (자동). AI 구단도 같은 규칙 */
export function recommendPrices(league: LeagueState, team: number): SeatPrices {
  const p = basePrices();
  const f = lastDemand(league, team);
  if (f === null) return p;
  if (f >= PRICE_REC_HIGH) { p.reserved = 1.1; p.premium = 1.1; } else if (f <= PRICE_REC_LOW) p.general = 0.9;
  return p;
}

/** 해마다 결산 뒤 플레이어 구단 가격을 추천 가격으로 다시 채우고 고정한 등급만 남긴다 (예산 autoBudget과 같은 규칙) */
export function autoPrices(league: LeagueState, team: number): void {
  if (team < 0) return;
  ensureFinance(league);
  const f = league.finance![team];
  if (!f) return;
  const locked = priceLockedOf(f);
  const cur = pricesOf(f, true);
  const next = recommendPrices(league, team);
  for (const g of locked) next[g] = cur[g];
  f.prices = next;
}

const validScale = (x: number) => Number.isFinite(x) && x >= PRICE_RANGE[0] - 1e-9 && x <= PRICE_RANGE[1] + 1e-9 && Math.abs(x / PRICE_STEP - Math.round(x / PRICE_STEP)) < 1e-6;
const pctText = (x: number) => `${Math.round(x * 100)}%`;

/** 한 등급 가격 배율을 정한다 (오프시즌, 다음 시즌부터). 그 등급은 고정된다 */
export function setTicketPrice(league: LeagueState, team: number, grade: SeatGrade, scale: number): { ok: boolean; message: string } {
  if (!SEAT_GRADES.includes(grade)) return { ok: false, message: '없는 좌석 등급입니다.' };
  if (!validScale(scale)) return { ok: false, message: `가격 배율은 ${pctText(PRICE_RANGE[0])}~${pctText(PRICE_RANGE[1])}, 5% 단위입니다.` };
  ensureFinance(league);
  const f = league.finance![team];
  // 가격 칸이 없는 예전 저장은 처음 고칠 때 나머지(자동) 등급을 추천 가격으로 채운다 (자동 = 추천 가격)
  f.prices = { ...(f.prices ? pricesOf(f, true) : recommendPrices(league, team)), [grade]: Math.round(scale * 100) / 100 };
  f.priceLocked = SEAT_GRADES.filter((g) => g === grade || priceLockedOf(f).includes(g));
  return { ok: true, message: `${SEAT_LABEL[grade]} 가격 ${pctText(scale)} (다음 시즌부터, 고정)` };
}

/** 한 등급(없으면 모든 등급)을 재무팀 추천 가격(자동)으로 되돌린다 */
export function setTicketAuto(league: LeagueState, team: number, grade?: SeatGrade): { ok: boolean; message: string } {
  if (grade !== undefined && !SEAT_GRADES.includes(grade)) return { ok: false, message: '없는 좌석 등급입니다.' };
  ensureFinance(league);
  const f = league.finance![team];
  const rec = recommendPrices(league, team);
  const cur = pricesOf(f, true);
  const gs = grade ? [grade] : SEAT_GRADES;
  for (const g of gs) cur[g] = rec[g];
  f.prices = cur;
  f.priceLocked = priceLockedOf(f).filter((g) => !gs.includes(g));
  return { ok: true, message: `${grade ? SEAT_LABEL[grade] : '모든 좌석'} 가격을 재무팀 추천 가격(자동)으로 되돌렸습니다.` };
}

// ---- 구단 재정 상태

export interface TeamFinance {
  /** 다음 시즌 투자 계획 (단계 0~3). 오프시즌에 정하고 개막 때 active로 확정한다 */
  invest: Record<InvestKind, number>;
  /** 이번 시즌에 적용 중인 투자 단계. 비용(지급일)과 효과는 이것으로 (오프시즌에 올렸다 내리는 꼼수를 막는다) */
  active?: Record<InvestKind, number>;
  /**
   * 마케팅 쌓인 효과 (단계 단위 0~3, 소수). 개막 때 active.marketing 쪽으로 MARKETING_UP·MARKETING_DOWN만큼 다가간다.
   * 없으면(새 게임, 2026-10-29 전 저장) 지금 단계만큼 다 쌓인 것으로 본다
   */
  mk?: number;
  /** 다음 시즌 예산 계획 (만 원, 2026년 돈, 재정 2 F2). 없으면 invest 단계의 눈금 금액과 운영비 기본값 */
  budget?: Partial<Record<BudgetKind, number>>;
  /** 이번 시즌 확정 예산 (개막 때 budget에서). 없으면 active 단계의 눈금 금액 */
  activeBudget?: Partial<Record<BudgetKind, number>>;
  /** 고정한 줄 (해마다 결산 뒤 자동 배분이 남겨 둠, 플레이어 구단). 없으면 lockedOf가 invest에서 짐작 */
  locked?: BudgetKind[];
  /** 다음 시즌 좌석 등급별 입장권 가격 배율 (재정 2 F3, 1 = 기본 가격). 없으면 모두 1 */
  prices?: Partial<SeatPrices>;
  /** 이번 시즌 확정 가격 (개막 때 prices에서). 없으면 모두 1 */
  activePrices?: Partial<SeatPrices>;
  /** 고정한 좌석 등급 (해마다 결산 뒤 자동 추천 가격이 남겨 둠). 없으면 없음 (모두 자동) */
  priceLocked?: SeatGrade[];
  /** 스폰서 계약 (재정 2 F4a, 끝난 계약은 다음 계약 때 지움). 없으면 예전 공식 (첫 오프시즌에 자동 계약) */
  sponsors?: SponsorDeal[];
  /** 결산 때 만든 다음 시즌 빈 자리 제안 (개막 때 자동 계약 뒤 지움) */
  sponsorOffers?: SponsorOffers;
  /** 구단주 예산 회의 기록 (재정 2 F4b, 최근 몇 해만). AI 구단은 돈 요청만 */
  meetings?: MeetingRecord[];
  /**
   * 모기업 부채 (재정 2 F5, 기획안 4.9): 결산 긴급 지원의 절반. left[i] = i해 뒤 시즌 모기업 지원금에서 뺄 몫 (그 해 돈 그대로, 3년 ⅓씩).
   * 지원금이 모자라 덜 뺀 몫은 다음 해 몫에 붙는다. 없으면 예전 규칙 (전년 긴급 지원 절반을 한 해에)
   */
  debt?: { amount: number; left: number[] };
  /** 나중에 낼 돈 (재정 2 F5, 계약금 2번의 남은 절반): 그 해 개막일에 낸다 */
  due?: DuePayment[];
  /** 지난 결산들 */
  history: FinanceYear[];
}

/** 개막일에 낼 돈 (계약금의 남은 절반 등) */
export interface DuePayment {
  /** 내는 시즌 (그 시즌 개막일) */
  year: number;
  amount: number;
  note: string;
  kind: FinanceKind;
}

/** 한 해 결산 (만 원). 수입은 양수, 지출은 음수로 적는다 */
export interface FinanceYear {
  year: number;
  items: Partial<Record<FinanceKind, number>>;
  /** 이 해 수지 (모기업 긴급 지원 전) */
  net: number;
  /** 결산 뒤 자금 */
  cash: number;
  /** 모기업 긴급 지원 (적자 보전) */
  rescue: number;
  /** 모기업 환원 (결산 뒤 자금이 DIVIDEND_RESERVE를 넘은 몫의 일부, 수지에는 넣지 않는다) */
  dividend?: number;
  /** 결산 뒤 남은 모기업 부채 (재정 2 F5, 없으면 0) */
  debt?: number;
  /** 정규시즌 홈 관중 합과 홈 경기 수 (미래 규칙 변경의 흥행 신호, 2026-10-22. 예전 저장에는 없다) */
  attendance?: number;
  homeGames?: number;
  /** 정규시즌 등급별 홈 관중 합 (재정 2 F3, 예전 저장에는 없다) */
  seats?: SeatPrices;
  /** 정규시즌 홈 경기 수요 관중률(가격 반응 전) 분포, DEMAND_BINS칸 (추천 가격·예상 셈) */
  demand?: number[];
  /** 그 시즌 확정 가격 (기본 가격이면 적지 않는다) */
  prices?: SeatPrices;
}

export type FinanceKind =
  | 'start' | 'gate' | 'postseason' | 'broadcast' | 'sponsor' | 'merch' | 'parent' | 'parentExtra' | 'rescue' | 'faSupport' | 'champion'
  | 'payroll' | 'foreign' | 'ops' | 'invest' | 'scouting'
  | 'compensation' | 'fine' | 'signing' | 'transfer' | 'trade' | 'event' | 'dividend' | 'coach' | 'posting' | 'stadium' | 'release' | 'editor' | 'other'
  | 'interest' | 'debt'
  | OpsKind;

export const FINANCE_LABEL: Record<FinanceKind, string> = {
  start: '시작 자금', gate: '관중 수입', postseason: '가을야구 수입', broadcast: '중계권·리그 배분', sponsor: '스폰서', merch: '상품·식음',
  parent: '모기업 지원금', parentExtra: '모기업 추가 지원 (예산 회의)', rescue: '모기업 긴급 지원', faSupport: '모기업 지원 (FA 계약금)', champion: '우승 배당',
  payroll: '국내 선수 연봉', foreign: '외국인 연봉', ops: '운영비 (나누기 전·캠프)', invest: '투자', scouting: '스카우트비',
  compensation: 'FA 보상금', fine: '제재금', signing: 'FA 계약금', transfer: '외국인 이적료', trade: '현금 트레이드', event: '이벤트', dividend: '모기업 환원', coach: '감독·코치 연봉', posting: '포스팅 이적료', stadium: '구장 공사비', release: '시즌 중 방출·영입', editor: '에디터', other: '기타',
  opsFront: '프런트', opsGame: '원정·경기 운영', opsPark: '구장 운영', opsFutures: '2군 운영',
  interest: '단기 대여 이자', debt: '부채 상환 (자금에서)',
};

// ---- 적자·대여·부채 (재정 2 F5, 기획안 4.9, 결정 Q6)

/** 시즌 중 단기 대여 이자 (연, 임시값): 지급일 뒤 자금이 0 아래면 그 몫을 모기업에서 빌린 것으로 보고 다음 지급일까지 이자 */
export const LOAN_RATE = 0.04;
/** 결산 긴급 지원 가운데 부채로 남는 몫과 나눠 갚는 해 수 */
export const DEBT_SHARE = 0.5;
export const DEBT_YEARS = 3;
/** 계약금 2번 (규약 제81조 ③, 시점 임시값): 계약 때 이 몫, 남은 몫은 다음 개막일 */
export const BONUS_NOW_SHARE = 0.5;
/** 계약 때 낼 계약금 (나머지는 다음 개막일, dueBonus) */
export const bonusNow = (bonus: number) => Math.round(bonus * BONUS_NOW_SHARE);

/** 계약금을 두 번에: 지금 몫은 장부(그 장부 연도)로, 남은 몫은 그 해 개막일 지급(due)으로 적는다. 지금 낸 몫을 돌려준다 */
export function payBonus(league: LeagueState, team: number, year: number, bonus: number, note: string, kind: FinanceKind = 'signing'): number {
  const now = bonusNow(bonus);
  if (now) league.ledger.push({ year, from: team, to: -1, amount: now, note, kind });
  const rest = bonus - now;
  if (rest) {
    ensureFinance(league);
    const f = league.finance![team];
    f.due = [...(f.due ?? []), { year, amount: rest, note: `${note} (남은 절반, 개막일)`, kind }];
  }
  return now;
}

/** 그 해 개막일에 낼 돈 합 (만 원) */
export function dueOf(f: TeamFinance | undefined, year: number): number {
  return (f?.due ?? []).filter((d) => d.year === year).reduce((s, d) => s + d.amount, 0);
}

/** 남은 부채 (만 원) */
export const debtOf = (f: TeamFinance | undefined) => f?.debt?.amount ?? 0;

/** 다음 결산 시즌에 모기업 지원금에서 뺄 부채 몫 (예정, 지원금이 모자라면 덜 뺀다) */
export const debtDueOf = (f: TeamFinance | undefined) => f?.debt?.left[0] ?? 0;

/**
 * 부채를 일찍 갚는다 (조작 'repay-debt', 오프시즌, 자금에서). 앞 해 몫부터 줄인다. 장부 '부채 상환'(수지에는 넣지 않음, 빌린 돈 갚기)
 */
export function repayDebt(league: LeagueState, team: number, ledgerYear: number, amount: number, cash: number): { ok: boolean; message: string } {
  ensureFinance(league);
  const f = league.finance![team];
  const left = debtOf(f);
  if (left <= 0) return { ok: false, message: '갚을 부채가 없습니다.' };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: '갚을 금액을 정하세요.' };
  const pay = Math.round(Math.min(amount, left));
  if (pay > cash) return { ok: false, message: `자금(${eokShort(Math.max(0, cash))})이 모자랍니다.` };
  let rest = pay;
  const slots = [...f.debt!.left];
  for (let i = 0; i < slots.length && rest > 0; i++) {
    const v = Math.min(slots[i], rest);
    slots[i] -= v;
    rest -= v;
  }
  while (slots.length && slots[slots.length - 1] <= 0) slots.pop();
  f.debt = { amount: left - pay, left: slots.map((v) => Math.max(0, v)) };
  league.ledger.push({ year: ledgerYear, from: team, to: -1, amount: pay, note: `모기업 부채 상환 (일찍 갚음)`, kind: 'debt' });
  return { ok: true, message: `모기업 부채 ${eokShort(pay)}을 갚았습니다 (남은 부채 ${eokShort(f.debt.amount)}).` };
}

/**
 * 결산 때 부채: 이번 시즌 지원금에서 뺀 몫을 지우고, 지원금이 모자라 덜 뺀 몫은 결산 뒤 자금에서 낸다 (cashPay가 낸 만큼, 그래도 남으면 다음 해로).
 * 새 긴급 지원의 절반을 3년에 나눠 얹는다
 */
function settleDebt(f: TeamFinance, paid: number, rescue: number, cashPay: (short: number) => number): void {
  const d = f.debt ?? { amount: 0, left: [] };
  const slots = [...d.left];
  const due = slots.shift() ?? 0;
  const fromSupport = Math.min(paid, due);
  const fromCash = due - fromSupport > 0 ? cashPay(due - fromSupport) : 0;
  const short = Math.max(0, due - fromSupport - fromCash);
  if (short) slots[0] = (slots[0] ?? 0) + short;
  let amount = Math.max(0, d.amount - fromSupport - fromCash);
  const add = Math.round(rescue * DEBT_SHARE);
  if (add > 0) {
    const third = Math.floor(add / DEBT_YEARS);
    for (let i = 0; i < DEBT_YEARS; i++) slots[i] = (slots[i] ?? 0) + (i === DEBT_YEARS - 1 ? add - third * (DEBT_YEARS - 1) : third);
    amount += add;
  }
  f.debt = { amount, left: slots };
}

/** 새 게임의 투자 단계: 모든 구단 1단계 (임시값) */
const startInvest = (): Record<InvestKind, number> => ({ scout: 1, scoutPro: 1, develop: 1, medical: 1, marketing: 1 });

/** 이번 시즌 확정 예산에 가장 가까운 눈금 단계 (화면 눈금·예전 도구용. 효과는 activeStep) */
export function activeLevel(league: Pick<LeagueState, 'finance'>, team: number, kind: InvestKind): number {
  const f = league.finance?.[team];
  if (f?.activeBudget?.[kind] !== undefined) return nearestLevel(kind, f.activeBudget[kind]!);
  return (f?.active ?? f?.invest)?.[kind] ?? 0;
}

/** 이번 시즌 효과 단계 s (소수, 재정 2 F2): 확정 예산 금액을 체감 곡선으로 */
export function activeStep(league: Pick<LeagueState, 'finance'>, team: number, kind: InvestKind): number {
  return investStep(kind, budgetOf(league.finance?.[team], false)[kind]);
}

/** 이번 시즌 확정 예산 한 줄 (만 원, 2026년 돈) */
export function activeBudgetOf(league: Pick<LeagueState, 'finance'>, team: number, kind: BudgetKind): number {
  return budgetOf(league.finance?.[team], false)[kind];
}

/** 의료 효과 (부상 확률 배율, 결장 기간 배율) */
export function medicalScale(s: number): { rate: number; days: number } {
  return { rate: stepAt(MEDICAL_RATE, s, MEDICAL_FLOOR), days: stepAt(MEDICAL_DAYS, s, MEDICAL_FLOOR) };
}

/** 마케팅 쌓인 효과 (단계 단위, TeamFinance.mk) */
export function marketingStock(league: Pick<LeagueState, 'finance'>, team: number): number {
  const f = league.finance?.[team];
  return f?.mk ?? activeStep(league, team, 'marketing');
}

/** 단계별 표를 쌓인 효과(소수 단계)로 잇는다. 3단계 위는 마지막 구간 기울기의 절반 (stepAt) */
export function marketingAt(table: number[], stock: number): number {
  return stepAt(table, stock);
}

/** 개막 때 마케팅 쌓인 효과를 한 해만큼 옮긴다 (전 쌓인 효과 → 이번 시즌 효과 단계 s 쪽으로) */
export function stepMarketing(prev: number, level: number): number {
  const v = prev + (level - prev) * (level > prev ? MARKETING_UP : MARKETING_DOWN);
  return Math.round(v * 1000) / 1000;
}

/** 재정 상태가 없는 리그(새 게임, 예전 저장)에 시작 자금과 기본 투자를 채운다. 구장·팬덤(stadium.ts)도 함께 */
export function ensureFinance(league: LeagueState): TeamFinance[] {
  ensureStadiums(league, (t) => parkOf(league, t).capacity);
  ensureFans(league, (t) => parkOf(league, t).market);
  league.finance ??= [];
  for (let t = 0; t < league.teams.length; t++) {
    if (league.finance[t]) continue;
    league.finance[t] = { invest: startInvest(), active: startInvest(), history: [] };
    league.ledger.push({ year: league.year, from: -1, to: t, amount: START_CASH, note: '시작 자금', kind: 'start' });
  }
  return league.finance;
}

/** 장부에서 그 구단의 돈 이동. 받으면 +, 내면 − */
export function ledgerFlow(e: LedgerEntry, team: number): number {
  return (e.to === team ? e.amount : 0) - (e.from === team ? e.amount : 0);
}

/** 장부 항목의 구분. 예전 장부(구분 없음)는 메모로 짐작 */
export function ledgerKind(e: LedgerEntry): FinanceKind {
  if (e.kind) return e.kind as FinanceKind;
  if (e.note.includes('보상금')) return 'compensation';
  if (e.note.includes('제재금')) return 'fine';
  return 'other';
}

/** 지금 자금 (장부 합, 만 원). 진행 중인 시즌의 수입·지출은 seasonFlows로 더한다 */
export function cashOf(league: LeagueState, team: number): number {
  let s = 0;
  for (const e of league.ledger) s += ledgerFlow(e, team);
  return s;
}

/** 장부에서 그 해 항목별 합 (오프시즌에 생긴 보상금·계약금 등) */
export function ledgerItems(league: LeagueState, team: number, year: number): Partial<Record<FinanceKind, number>> {
  const out: Partial<Record<FinanceKind, number>> = {};
  for (const e of league.ledger) {
    if (e.year !== year) continue;
    const v = ledgerFlow(e, team);
    if (!v) continue;
    const k = ledgerKind(e);
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

// ---- 시즌 중 수입·지출

/** 시즌 중 우리 구단 트레이드 (선수 id). 리그 상태는 개막 때로 고정이라, 그 뒤 소속은 이 기록으로 따라간다 */
export interface TradeMove {
  day: number;
  /** 우리 구단 */
  from: number;
  /** 상대 구단 */
  to: number;
  give: string[];
  get: string[];
}

export interface SeasonInput {
  league: LeagueState;
  world: World;
  season: Season;
  trades?: TradeMove[];
  /** 가을야구 경기 (진행한 것까지) */
  postseason?: SeriesGame[];
  /** 결산 셈: 결산 지급(정규시즌 마지막 달 뒤 몫, payPlan 'settle')까지 넣는다 (settleSeason) */
  settle?: boolean;
}

export interface MonthPoint {
  /** 지급일 일정 색인 (결산은 정규시즌 마지막 날) */
  day: number;
  /** 경기 달 지급이면 그 달, 개막일·결산이면 낸 달 가운데 마지막 */
  month: number;
  /** 지급 때 (payPlan) */
  when: PayEntry['when'];
  /** 이번에 낸 달 */
  months: number[];
  /** 앞 지급일 뒤부터 이 지급일까지 수입·지출 합 (관중 수입 포함, 결산 칸에는 가을야구) */
  net: number;
}

export interface SeasonFlows {
  items: Partial<Record<FinanceKind, number>>;
  /** 홈 경기 관중 합 (가을야구 포함) */
  attendance: number;
  /** 정규시즌 홈 관중 합 */
  regular: number;
  /** 정규시즌 홈 경기 수 */
  homeGames: number;
  /** 정규시즌 등급별 홈 관중 합 (소수), 수요 관중률 분포 (재정 2 F3) */
  seats: SeatPrices;
  demand: number[];
  /** 이번 시즌 확정 가격 */
  prices: SeatPrices;
  months: MonthPoint[];
  /** 모기업 단기 대여 (재정 2 F5): 지금(마지막 지급일 뒤) 대여 잔액과 지금까지 쌓인 이자 (만 원). 이자는 결산 셈(settle)에서만 items.interest로 */
  loan: number;
  interest: number;
}

const parkOf = (league: LeagueState, team: number) => BALLPARK[league.teams[team].franchise] ?? DEFAULT_PARK;
/** 연고 시장 보정 (팬덤 기본값, stadium.ts) */
export const marketOf = (league: LeagueState, team: number) => parkOf(league, team).market;

/** 지급일에 나가는 연봉 (만 원, 한 해). 외국인은 달러를 환산하고, FA 계약금으로 미리 낸 몫은 뺀다 */
export function payOf(p: LeaguePlayer): number {
  if (p.foreign) return Math.round((p.contract.salary + (p.contract.bonus ?? 0)) * WON_PER_USD);
  return Math.max(0, p.contract.salary - (p.contract.prepaid ?? 0));
}

// ---- 새 지출 (docs/finance.md 5장)

/** FA 계약금: 계약 총액(연봉 × 기간)의 30%를 계약 때 낸다 (임시값) */
export const SIGNING_SHARE = 0.3;
export function signingBonus(salary: number, years: number): number {
  return Math.round(salary * years * SIGNING_SHARE);
}
/** 새 외국인 이적료: 연봉의 40% (달러, 1만 달러 단위, 임시값) */
export const TRANSFER_SHARE = 0.4;
export function transferFeeUsd(salaryUsd: number): number {
  return Math.round((salaryUsd * TRANSFER_SHARE) / 10_000) * 10_000;
}
/**
 * AI가 현금 1런을 몇 만 원으로 치는가 (임시값). 2026-10-12 사용자 "트레이드의 현금 값어치를 지금보다 상향" → 12,000에서 6,000으로:
 * FA 시장 단가(약 4,500만 원/런)와 이미 계약된 연봉 단가(9,000만 원/런, ai/trade.ts) 사이. 현금 1억 원 ≈ 1.7런 (≈ 0.17승)
 */
export const CASH_WON_PER_RUN = 6_000;

/** 정규시즌 일정 안의 각 달 마지막 날 (그달에 경기가 있는 달만). 지급 달력(payPlan)의 경기 달 지급일, 부상 대체 연봉 상한의 달 수 */
export function paydays(year: number, seasonDays: number): { day: number; month: number }[] {
  const out: { day: number; month: number }[] = [];
  for (let d = 0; d < seasonDays; d++) {
    const m = dateOf(year, d).month;
    const next = d + 1 < seasonDays ? dateOf(year, d + 1).month : -1;
    if (next !== m) out.push({ day: d, month: m });
  }
  return out;
}

/** 연봉·운영비 등을 나눠 내는 달 (참가활동기간 2~11월, 규약 제72조 ①: 10회 분할 매월 1회, 재정 2 기획안 4.8) */
export const PAY_MONTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const PAY_COUNT = PAY_MONTHS.length;

/** 지급 한 번: 개막일(open, 개막 달보다 앞선 달 몫), 경기 달의 마지막 날(day), 결산(settle, 정규시즌 마지막 달보다 뒤 달 몫) */
export interface PayEntry {
  when: 'open' | 'day' | 'settle';
  /** 일정 색인 (open = 0, settle = 정규시즌 마지막 날: 그날 소속으로 낸다) */
  day: number;
  /** 이번에 내는 달 (2~11월 가운데) */
  months: number[];
}

/**
 * 지급 달력 (재정 2 F1b, 기획안 4.8): 2~11월의 달마다 한 번 (연간액 ÷ 10).
 * 그 달에 정규시즌 경기일이 있으면 그 달 마지막 날, 개막 달보다 앞이면 개막일, 정규시즌 마지막 달보다 뒤면 결산.
 * 시즌 사이에 경기 없는 달이 끼면 그 몫은 다음 경기 달 지급일에. 1982년부터 모든 해 같은 10번 (도입 연도 미확인, 임시 단순화)
 */
export function payPlan(year: number, seasonDays: number): PayEntry[] {
  const ends = paydays(year, seasonDays);
  if (!ends.length) return [{ when: 'settle', day: Math.max(0, seasonDays - 1), months: [...PAY_MONTHS] }];
  const first = ends[0].month;
  const lastMonth = ends[ends.length - 1].month;
  const out: PayEntry[] = [];
  const open = PAY_MONTHS.filter((m) => m < first);
  if (open.length) out.push({ when: 'open', day: 0, months: open });
  let k = 0;
  for (const e of ends) {
    // 앞 지급일 뒤부터 이 달까지의 지급 달 (경기 없는 달이 끼면 함께)
    const months = PAY_MONTHS.filter((m) => m >= first && m <= e.month && m > k);
    k = e.month;
    if (months.length) out.push({ when: 'day', day: e.day, months });
  }
  const settle = PAY_MONTHS.filter((m) => m > lastMonth);
  if (settle.length) out.push({ when: 'settle', day: seasonDays - 1, months: settle });
  return out;
}

/** 그날(day) 그 구단 소속 선수 (복무 중 제외). 개막 소속에 그날까지의 트레이드를 반영한다 */
function rosterAt(league: LeagueState, team: number, day: number, trades: TradeMove[]): LeaguePlayer[] {
  const byId = new Map(league.players.map((p) => [p.id, p]));
  const team0 = new Map(league.players.map((p) => [p.id, p.team]));
  for (const t of trades) {
    if (t.day > day) continue;
    for (const id of t.give) team0.set(id, t.to);
    for (const id of t.get) team0.set(id, t.from);
  }
  const out: LeaguePlayer[] = [];
  for (const [id, t] of team0) {
    if (t !== team) continue;
    const p = byId.get(id)!;
    if (p.military?.state !== 'serving') out.push(p);
  }
  return out;
}

/** 운영비 네 줄 몫 (2026년 돈): 프런트·2군 운영은 그 구단 예산 (planned = 다음 시즌 계획), 원정·경기 운영·구장 운영은 기본 몫 */
export function opsWeights(f: TeamFinance | undefined, planned = false): Record<OpsKind, number> {
  const b = budgetOf(f, planned);
  return { opsFront: b.front, opsGame: OPS_SPLIT.opsGame, opsPark: OPS_SPLIT.opsPark, opsFutures: b.futures };
}

/** 그 해 운영비 연간 합 (네 줄 합, 퓨처스 구단은 × FUTURES_OPS_SHARE, 연봉 상승 지수 반영). 프런트·2군은 그 구단 예산 */
export function opsCost(league: LeagueState, team: number, year: number, planned = false): number {
  const w = opsWeights(league.finance?.[team], planned);
  const all = OPS_KINDS.reduce((s, k) => s + w[k], 0);
  return (isFuturesTeam(league, team, year) ? all * FUTURES_OPS_SHARE : all) * wageIndex(year, league);
}

/** 투자 연간 비용 합 (예산 금액 × 연봉 상승 지수). only를 주면 그 갈래만 (장부의 투자·스카우트비 나누기). budget을 주면 그 예산으로 */
export function investCost(f: TeamFinance | undefined, planned = false, wage = 1, only?: (k: InvestKind) => boolean, budget?: Record<BudgetKind, number>): number {
  if (!f && !budget) return 0;
  const b = budget ?? budgetOf(f, planned);
  return INVEST_KINDS.filter((k) => !only || only(k)).reduce((s, k) => s + budgetCostOf(b[k] ?? 0, wage), 0);
}
const isScoutKind = (k: InvestKind) => SCOUT_KINDS.includes(k);

/** 투자 한 항목의 그 해 연간 비용 (눈금 단계 금액 × 연봉 상승 지수, 10만 원 단위 아래는 반올림) */
export function investCostOf(kind: InvestKind, level: number, wage = 1): number {
  return budgetCostOf(INVEST_COST[kind][level], wage);
}
/** 예산 금액(2026년 돈)의 그 해 비용 (연봉 상승 지수, 10만 원 단위 아래는 반올림) */
export function budgetCostOf(amount: number, wage = 1): number {
  return Math.round((amount * wage) / 10) * 10;
}

/**
 * 개막 때 스타 보정 (리그 상위 30명 안의 선수 수 × 0.015, 최대 0.06). 소속은 리그 상태(시즌 중에는 개막 때 모습)를 따른다.
 * 예전에는 월드마다 처음 부른 때(시즌 첫 이벤트 등)의 월드 소속을 끝까지 써서, 불러온 게임(처음 부른 때가 다름)과
 * 결산 관중 수입이 달라졌다 (2026-10-23). 캐시는 쓴 소속이 같을 때만 다시 쓴다. tools/invest_cost.ts도 쓴다
 */
const starCache = new WeakMap<World, { key: string; out: number[] }>();
export function starBonus(world: World, league: Pick<LeagueState, 'players'>): number[] {
  const opening = new Map(league.players.map((p) => [p.id, p.team]));
  const teams = world.players.map((p) => opening.get(p.id) ?? p.teamIdx);
  const key = teams.join(',');
  const hit = starCache.get(world);
  if (hit?.key === key) return hit.out;
  const ctx = valueContext(world);
  const top = world.players.map((p, i) => ({ t: teams[i], r: currentRuns(p, ctx) })).sort((a, b) => b.r - a.r).slice(0, 30);
  const out = world.teams.map((_, t) => Math.min(0.06, 0.015 * top.filter((x) => x.t === t).length));
  starCache.set(world, { key, out });
  return out;
}

/**
 * 시대별 리그 경기당 평균 관중 (2026-10-13 사용자 선택 "시대별 관중 수준"). 보도된 해만 두고 그 사이는 잇는다:
 * 1982 143만 8,768명/240경기, 1995 540만 6,374명/504경기(역대 최다였던 해), 1998 263만 9,119명, 2004 233만 1,978명(침체기),
 * 2008 525만 6,332명, 2010 평균 1만 1,144명, 2012 평균 1만 3,451명, 2017 평균 약 1만 1,600명, 2023 약 810만/720경기,
 * 2024 평균 1만 5,122명, 2025 약 1,224만/716경기. 2016·2018·2019·2022는 총 관중으로 잰 대략값(임시값).
 * 2020·2021년 코로나 무관중·제한은 반영하지 않는다 (게임 경제가 무너져서). 연고 시장 보정은 2024년 기준이라 2024를 1로 본다
 */
const ERA_ATTENDANCE: [number, number][] = [
  [1982, 5995], [1995, 10727], [1998, 5236], [2004, 4383], [2008, 10429], [2010, 11144], [2012, 13451],
  [2016, 11583], [2017, 11668], [2018, 11214], [2019, 10119], [2022, 8439], [2023, 11250], [2024, 15122], [2025, 17103],
];
export function eraAttendance(year: number): number {
  const a = ERA_ATTENDANCE;
  if (year <= a[0][0]) return a[0][1];
  if (year >= a[a.length - 1][0]) return a[a.length - 1][1];
  for (let i = 1; i < a.length; i++) {
    if (year <= a[i][0]) {
      const [y0, v0] = a[i - 1];
      const [y1, v1] = a[i];
      return v0 + ((v1 - v0) * (year - y0)) / (y1 - y0);
    }
  }
  return a[a.length - 1][1];
}
/** 그 해 관중 배율 (2024 = 1). 관중률에 곱하고, 객단가는 거꾸로 나눠 관중 수입은 시대와 상관없이 같게 둔다 (게임 돈은 모두 2026년 물가) */
export const eraFillScale = (year: number) => eraAttendance(year) / eraAttendance(2024);

/** 한 경기 관중률 (0.05~1.0) = 수요를 좌석에서 자른 값 */
export function fillRate(league: LeagueState, team: number, winPct: number, star: number, day: number, year: number, opp?: number): number {
  return Math.min(1, demandRate(league, team, winPct, star, day, year, opp));
}

/** 한 경기 관중 수요 (좌석 대비, 0.05 이상, 1을 넘을 수 있다: 만원 구단의 넘친 수요, 입장권 가격 반응에 쓴다. 재정 2 F3 맞춤) */
export function demandRate(league: LeagueState, team: number, winPct: number, star: number, day: number, year: number, opp?: number): number {
  const wd = dateOf(year, day).weekday;
  const weekend = wd === 0 || wd === 6 ? 0.15 : wd === 5 ? 0.05 : 0;
  const mk = marketingAt(MARKETING_FILL, marketingStock(league, team));
  const noise = (new Rng(`${league.seed}/gate/${year}/${day}/${team}`).next() - 0.5) * 0.1;
  const v = 0.5 + 0.8 * (winPct - 0.5) + parkOf(league, team).market + star + weekend + mk + noise + fillBuff(league, team, year, day)
    + legendFill(league, league.teams[team].franchise) + rivalFill(league, team, opp)
    + stadiumFill(league.stadiums?.[team], year) + fanFill(fanLevel(league, team, year, day));
  // 시대별 관중 수준 (2000년대 초 침체기는 2024년의 약 0.3배)
  return Math.max(0.05, v * eraFillScale(year));
}

/**
 * 시즌 중 그 구단의 수입·지출 (upToDay 전날까지 치른 경기, 지난 지급일 지급, 개막일 지급은 개막 날부터, 결산 지급은 settle일 때만).
 * 관중 수입은 홈 경기마다, 연봉·운영비·투자비는 지급일마다 (연간액 × 낸 달 수 ÷ 10).
 */
export function seasonFlows(input: SeasonInput, team: number, upToDay: number): SeasonFlows {
  const { league, world, season } = input;
  const year = world.year;
  const items: Partial<Record<FinanceKind, number>> = {};
  const add = (k: FinanceKind, v: number) => { if (v) items[k] = (items[k] ?? 0) + v; };
  // 지급 달력 (재정 2 F1b): 관중 수입은 그날 뒤 첫 경기 달 지급일 칸에, 가을야구는 결산 칸에
  const pays = payPlan(year, season.schedule.length);
  const net = new Array<number>(pays.length).fill(0);
  const slotOf = (day: number) => {
    const i = pays.findIndex((p) => p.when === 'day' && p.day >= day);
    return i >= 0 ? i : pays.length - 1;
  };
  const addM = (day: number, v: number) => { net[slotOf(day)] += v; };
  let attendance = 0;
  let regular = 0;
  let homeGames = 0;
  const seats = { general: 0, reserved: 0, premium: 0 };
  const demand = new Array<number>(DEMAND_BINS).fill(0);
  const prices = pricesOf(league.finance?.[team], false);
  // 상품·식음 (재정 2 F4a): 스폰서 계약이 걸린 시즌만 관중 수에 따라 (아니면 예전 공식의 스폰서 안)
  const merch = sponsorModelOn(league, team, year) && team < world.teams.length ? merchPerFan(league, team, year, starBonus(world, league)[team] ?? 0) : 0;

  // 관중 수입: 경기 기록을 날짜 순으로 보며 그때까지의 승률로. 좌석 등급별 가격에 따라 등급마다 관중이 빠지거나 는다 (재정 2 F3)
  if (team < world.teams.length) {
    const star = starBonus(world, league)[team] ?? 0;
    const park = league.stadiums?.[team];
    const cap = park ? seatsAt(park, year) : parkOf(league, team).capacity;
    // 관중이 적은 시대는 객단가를 그만큼 올려 관중 수입 합을 시대와 상관없이 같게 (eraFillScale)
    const ticket = (TICKET * ticketScale(park) * wageIndex(year, league)) / eraFillScale(year);
    const w = new Array(world.teams.length).fill(0);
    const l = new Array(world.teams.length).fill(0);
    for (const g of season.log) {
      if (g.day >= upToDay) break;
      if (g.home === team) {
        const pct = w[team] + l[team] > 0 ? w[team] / (w[team] + l[team]) : 0.5;
        const f = demandRate(league, team, pct, star, g.day, year, g.away);
        const gg = gameGate(cap, f, ticket, prices);
        const fans = gg.fans;
        attendance += fans;
        regular += fans;
        homeGames++;
        for (const k of SEAT_GRADES) seats[k] += gg.seats[k];
        demand[demandBin(f)]++;
        const v = gg.revenue;
        add('gate', v);
        addM(g.day, v);
        if (merch) { const m = Math.round(fans * merch); add('merch', m); addM(g.day, m); }
      }
      if (g.homeRuns > g.awayRuns) { w[g.home]++; l[g.away]++; } else if (g.awayRuns > g.homeRuns) { w[g.away]++; l[g.home]++; }
    }
    // 가을야구 홈 경기: 만원에 가깝고 객단가가 높다
    for (const g of input.postseason ?? []) {
      if (g.day >= upToDay || g.home !== team) continue;
      const fans = Math.round(cap * 0.97);
      attendance += fans;
      const v = Math.round(fans * POSTSEASON_TICKET * ticketScale(park) * wageIndex(year, league));
      add('postseason', v);
      net[pays.length - 1] += v;
      if (merch) { const m = Math.round(fans * merch); add('merch', m); net[pays.length - 1] += m; }
    }
  }

  // 지급일 (payPlan, 2~11월 10번): 연봉(그날 소속)·감독·코치·운영비·투자비가 나가고, 개막 때 정한 중계권·모기업 지원금·스폰서 기본액이 들어온다
  // (예전에는 이 수입이 결산 때 한꺼번에 들어와 시즌 중 자금이 크게 마이너스였다, 2026-10-11).
  // 개막일 지급은 개막 날부터 보이고, 결산 지급은 결산 셈(settle)에서만 낸다 (정규시즌 마지막 날 소속)
  const fin = league.finance?.[team];
  const yearly = seasonIncome(league, world, team);
  const wage = wageIndex(year, league);
  const invest = investCost(fin, false, wage, (k) => !isScoutKind(k));
  const scouting = investCost(fin, false, wage, isScoutKind);
  const coach = coachPayroll(league, team) + managerPayroll(league, team);
  const ops = opsCost(league, team, year);
  const opsW = opsWeights(fin);
  pays.forEach((pd, i) => {
    if (pd.when === 'settle' ? !input.settle : pd.when === 'day' && pd.day >= upToDay) return;
    const roster = rosterAt(league, team, pd.day, input.trades ?? []);
    const dom = roster.filter((p) => !p.foreign).reduce((s, p) => s + payOf(p), 0);
    const fgn = roster.filter((p) => p.foreign).reduce((s, p) => s + payOf(p), 0);
    const share = (x: number) => Math.round((x * pd.months.length) / PAY_COUNT);
    const parts: [FinanceKind, number][] = [
      ['payroll', -share(dom)], ['foreign', -share(fgn)],
      ...(Object.entries(splitOps(-share(ops), opsW)) as [FinanceKind, number][]), ['invest', -share(invest)],
      ['scouting', -share(scouting)], ['coach', -share(coach)],
      ['broadcast', share(yearly.broadcast)], ['parent', share(yearly.parent)], ['sponsor', share(yearly.sponsor)],
    ];
    for (const [k, v] of parts) { add(k, v); net[i] += v; }
  });
  // 개막일에 낼 돈 (재정 2 F5: 계약금의 남은 절반). 개막 날부터 보인다
  for (const d of fin?.due ?? []) {
    if (d.year !== year || !d.amount) continue;
    add(d.kind, -d.amount);
    net[0] -= d.amount;
  }
  // 모기업 단기 대여 (재정 2 F5, 기획안 4.9): 지급일 뒤 자금(장부 + 그때까지 흐름)이 0 아래면 그 몫을 빌린 것으로 보고
  // 다음 지급일(지금 셈이면 upToDay)까지 연 LOAN_RATE 이자를 쌓는다. 장부의 시즌 중 항목(현금 트레이드 등)은 개막 때 있던 것으로 본다 (임시 단순화)
  let bal = cashOf(league, team);
  let loan = 0;
  let interest = 0;
  const upTo = Math.min(upToDay, season.schedule.length - 1);
  pays.forEach((pd, i) => {
    if (pd.when === 'settle' ? !input.settle : pd.when === 'day' && pd.day >= upToDay) return;
    bal += net[i];
    loan = Math.max(0, -bal);
    if (!loan) return;
    const next = pays[i + 1];
    const until = next && (next.when === 'settle' ? input.settle : next.day < upToDay) ? next.day : (pd.when === 'settle' ? pd.day : Math.max(pd.day, upTo));
    interest += (loan * LOAN_RATE * Math.max(0, until - pd.day)) / 365;
  });
  interest = Math.round(interest);
  if (input.settle && interest) add('interest', -interest);
  const months: MonthPoint[] = pays.map((pd, i) => ({ day: pd.day, month: pd.months[pd.months.length - 1], when: pd.when, months: pd.months, net: net[i] }));
  if (input.settle && interest) months[months.length - 1].net -= interest;
  return { items, attendance, regular, homeGames, seats, demand, prices, months, loan, interest };
}

/**
 * 개막 때 정하는 한 해 고정 수입: 중계권, 모기업 지원금(직전 결산 자금과 지금 신뢰도), 스폰서 기본액(보통 성적일 때).
 * 스폰서는 결산 때 실제 인기도로 다시 매겨 차액을 정산한다.
 */
export function seasonIncome(league: LeagueState, world: World, team: number): { broadcast: number; parent: number; sponsor: number } {
  const year = world.year;
  const futures = isFuturesTeam(league, team, year);
  const trust = league.owner?.team === team ? league.owner.trust : 50;
  const lastCash = league.finance?.[team]?.history.at(-1)?.cash ?? START_CASH;
  const star = team < world.teams.length ? starBonus(world, league)[team] ?? 0 : 0;
  return {
    broadcast: futures ? 0 : Math.round(BROADCAST * wageIndex(year, league)),
    parent: parentSupport(league, team, trust, lastCash, year),
    sponsor: sponsorModelOn(league, team, year) ? contractSponsor(league, team, year, 0) : sponsorAmount(league, team, futures, 0.5, 0, star, year),
  };
}

/** 그 시즌 스폰서를 계약 모델로 셈하는지 (계약이 걸려 있고 퓨처스 구단이 아님) */
export const sponsorModelOn = (league: LeagueState, team: number, year: number) => !isFuturesTeam(league, team, year) && dealsAt(league, team, year).length > 0;

/**
 * 계획용 스폰서 (그 해 돈, 보너스 없음): 걸린 계약 + 빈 자리는 그 시즌 제안 중 기대 연액이 가장 큰 것 (개막 때 자동 계약과 같은 규칙).
 * 계약도 제안도 없으면 null (예전 공식)
 */
export function plannedSponsor(league: LeagueState, team: number, year: number): number | null {
  if (isFuturesTeam(league, team, year)) return null;
  const deals = dealsAt(league, team, year);
  const offers = league.finance?.[team]?.sponsorOffers;
  const extra = offers?.year === year
    ? emptySlots(league, team, year).reduce((s, slot) => { const l = offers.slots[slot]; return s + (l?.length ? l[bestOffer(l)].amount : 0); }, 0) : 0;
  if (!deals.length && !extra) return null;
  return contractSponsor(league, team, year, extra);
}

/** 계약 스폰서 연액 (기본액 + 보너스, 그 해 돈) + 구단 이름 스폰서 */
function contractSponsor(league: LeagueState, team: number, year: number, bonus: number): number {
  const inc = team === userTeamOf(league) ? settingsOf(league).income : 1;
  const wage = wageIndex(year, league);
  return Math.round((dealsBase(dealsAt(league, team, year)) + bonus) * wage * inc) + Math.round((NAMING_SPONSOR[league.teams[team].franchise] ?? 0) * wage);
}

/** 상품·식음 관중 한 명당 (만 원, 그 해 돈): 1인 구매액 × 팬 배율 × (1 + 2 × 스타) × 마케팅 × 프런트 ÷ 시대 관중 배율 (재정 2 F4a, 임시값) */
export function merchPerFan(league: LeagueState, team: number, year: number, star: number, opt?: PopularityOpt): number {
  const inc = team === userTeamOf(league) ? settingsOf(league).income : 1;
  const fan = fanSponsor(fanLevel(league, team, year));
  const mk = marketingAt(MARKETING_SPONSOR, opt?.mk ?? marketingStock(league, team));
  const front = frontScale(opt?.front ?? activeBudgetOf(league, team, 'front'));
  return (MERCH_PER_FAN * wageIndex(year, league) * inc * fan * (1 + 2 * star) * mk * front) / eraFillScale(year);
}

/** 스폰서·상품 수입 (인기도 × 기본액 + 구단 이름 스폰서). opt: 계획 셈에서 쓸 마케팅 쌓인 효과·프런트 예산 */
export function sponsorAmount(league: LeagueState, team: number, futures: boolean, winPct: number, depth: number, star: number, year: number, opt?: PopularityOpt): number {
  const inc = team === userTeamOf(league) ? settingsOf(league).income : 1;
  const wage = wageIndex(year, league);
  return Math.round(SPONSOR_BASE * wage * inc * (futures ? 0.3 : popularity(league, team, winPct, depth, star, opt))) + Math.round((NAMING_SPONSOR[league.teams[team].franchise] ?? 0) * wage);
}

// ---- 예산안: 계획·지금까지·시즌 끝 예상 (재정 2 F1a, docs/재정2_기획안.md 4.3·6장)

/** 한 시즌 돈 계획 (항목별, 만 원). homeGames·perGame은 관중 수입 셈의 근거 */
export interface FinancePlan {
  year: number;
  items: Partial<Record<FinanceKind, number>>;
  /** 예상 홈 경기 수와 한 경기 예상 관중 수입 */
  homeGames: number;
  perGame: number;
  /** 가정한 승률 (지난 시즌, 없으면 0.5) */
  winPct: number;
  /** 좌석 등급별 예상 관중·관중 수입 (시즌 합), 가정한 가격 (재정 2 F3). 홈 경기가 없으면 관중 0 */
  seats: Record<SeatGrade, { fans: number; gate: number }>;
  prices: SeatPrices;
  /** 모기업 지원금에서 빼는 부채 몫 (재정 2 F5, 지원금 줄에 이미 빠져 있음) */
  debtPay: number;
}

/** 계획의 입력. season이 그 해 시즌이면 그 일정으로, 아니면(오프시즌에 다음 시즌) 지난 결산 관중으로 관중 수입을 잡는다 */
export interface PlanInput {
  league: LeagueState;
  world: World;
  season?: Season;
}

/**
 * 한 시즌 돈 계획 (읽기 전용 예산안). 관중·스폰서는 "지난 시즌 승률 그대로" 가정 (가을야구 없음),
 * 연봉은 지금(시즌 중이면 개막 때) 소속 선수 연봉 합, 운영비·투자·감독·코치·중계권·모기업은 그 해 금액,
 * 장부에 이미 적힌 그 해 항목(오프시즌 계약금·보상금 등)은 그대로 넣는다. 난수를 쓰지 않는다 (관중률 잡음은 날짜별 고정 시드)
 */
export function financePlan(input: PlanInput, team: number, year: number, budget?: Record<BudgetKind, number>, seatPrices?: SeatPrices): FinancePlan {
  const { league, world, season } = input;
  const items: Partial<Record<FinanceKind, number>> = {};
  const add = (k: FinanceKind, v: number) => { if (v) items[k] = (items[k] ?? 0) + Math.round(v); };
  const wage = wageIndex(year, league);
  const futures = isFuturesTeam(league, team, year);
  const fin = league.finance?.[team];
  const inSeason = !!season && world.year === year;
  const last = league.lastSeason?.teams?.[team];
  const winPct = last && last.w + last.l > 0 ? last.w / (last.w + last.l) : 0.5;
  const star = team < world.teams.length ? starBonus(world, league)[team] ?? 0 : 0;
  // 관중 수입 (좌석 등급별 가격, 재정 2 F3): 시즌 중이면 확정 가격, 오프시즌이면 다음 시즌 계획 가격
  let homeGames = 0;
  let perGame = 0;
  const prices = seatPrices ?? pricesOf(fin, !inSeason);
  const seats = Object.fromEntries(SEAT_GRADES.map((g) => [g, { fans: 0, gate: 0 }])) as Record<SeatGrade, { fans: number; gate: number }>;
  const park = league.stadiums?.[team];
  const ticketOf = (y: number) => (TICKET * ticketScale(park) * wageIndex(y, league)) / eraFillScale(y);
  if (inSeason && team < world.teams.length) {
    const ks = season!.knownSchedule(0);
    const cap = capOf(league, team, year);
    const ticket = ticketOf(year);
    let sum = 0;
    let n = 0;
    ks.days.forEach((games, day) => {
      for (const g of games) {
        if (g.home !== team) continue;
        const gg = gameGate(cap, demandRate(league, team, winPct, star, day, year, g.away), ticket, prices);
        sum += gg.revenue;
        n++;
        for (const k of SEAT_GRADES) { seats[k].fans += gg.seats[k]; seats[k].gate += gg.seats[k] * ticket * seatFactor(k) * prices[k]; }
      }
    });
    const pending = ks.pending.filter((g) => g.home === team).length;
    homeGames = n + pending;
    perGame = n ? sum / n : 0;
    if (n) for (const k of SEAT_GRADES) { seats[k].fans *= homeGames / n; seats[k].gate *= homeGames / n; }
    add('gate', sum + perGame * pending);
  } else {
    const h = fin?.history.at(-1);
    if (h?.homeGames && !futures) {
      homeGames = h.homeGames;
      perGame = ((h.items.gate ?? 0) / h.homeGames) * (wage / wageIndex(h.year, league));
      // 가격이 지난 시즌과 다르면 수요 분포로 잰 비율만큼 (지난 시즌 실제 관중 수입이 바탕)
      const meanFill = (h.attendance ?? 0) / (h.homeGames * capOf(league, team, h.year));
      const cap = capOf(league, team, year);
      const was = gatePredict(h.demand, meanFill, cap, ticketOf(year), { ...basePrices(), ...h.prices });
      const now = gatePredict(h.demand, meanFill, cap, ticketOf(year), prices);
      if (was.revenue > 0) perGame *= now.revenue / was.revenue;
      const fanScale = was.fans > 0 ? (h.attendance ?? 0) / h.homeGames / was.fans : 0;
      const gateScale = now.revenue > 0 ? perGame / now.revenue : 0;
      for (const k of SEAT_GRADES) seats[k] = { fans: now.seats[k] * fanScale * homeGames, gate: now.gate[k] * gateScale * homeGames };
      add('gate', perGame * homeGames);
    }
  }
  // 고정 수입
  if (inSeason) {
    const y = seasonIncome(league, world, team);
    add('broadcast', y.broadcast);
    add('parent', y.parent);
  } else {
    add('broadcast', futures ? 0 : BROADCAST * wage);
    const trust = league.owner?.team === team ? league.owner.trust : 50;
    add('parent', parentSupport(league, team, trust, cashOf(league, team), year));
  }
  // 다음 시즌 계획(오프시즌)은 계획 예산으로: 마케팅 쌓인 효과는 개막 때 한 해만큼 옮긴 값, 프런트는 계획 금액
  const b = budget ?? budgetOf(fin, !inSeason);
  const popOpt: PopularityOpt | undefined = inSeason && !budget ? undefined
    : { front: b.front, mk: inSeason ? undefined : stepMarketing(marketingStock(league, team), investStep('marketing', b.marketing)) };
  const planned = plannedSponsor(league, team, year);
  add('sponsor', planned ?? sponsorAmount(league, team, futures, winPct, 0, star, year, popOpt));
  // 상품·식음 (재정 2 F4a): 예상 관중 × 한 명당
  if (planned !== null) add('merch', SEAT_GRADES.reduce((s, k) => s + seats[k].fans, 0) * merchPerFan(league, team, year, star, popOpt));
  // 지출
  const roster = rosterAt(league, team, -1, []);
  add('payroll', -roster.filter((p) => !p.foreign).reduce((s, p) => s + payOf(p), 0));
  add('foreign', -roster.filter((p) => p.foreign).reduce((s, p) => s + payOf(p), 0));
  const opsW: Record<OpsKind, number> = { ...OPS_SPLIT, opsFront: b.front, opsFutures: b.futures };
  const opsAll = OPS_KINDS.reduce((s, k) => s + opsW[k], 0) * (futures ? FUTURES_OPS_SHARE : 1) * wage;
  for (const [k, v] of Object.entries(splitOps(-Math.round(opsAll), opsW)) as [FinanceKind, number][]) add(k, v);
  add('invest', -investCost(fin, !inSeason, wage, (k) => !isScoutKind(k), b));
  add('scouting', -investCost(fin, !inSeason, wage, isScoutKind, b));
  add('coach', -(coachPayroll(league, team) + managerPayroll(league, team)));
  const build = installment(league.stadiums?.[team], year);
  if (build) add('stadium', -build);
  // 장부에 이미 적힌 그 해 항목 (일찍 갚은 부채는 빌린 돈 갚기라 수지에 넣지 않는다), 개막일에 낼 계약금 남은 절반 (재정 2 F5)
  const booked = ledgerItems(league, team, year);
  for (const k of Object.keys(booked) as FinanceKind[]) if (k !== 'start' && k !== 'debt') add(k, booked[k] ?? 0);
  for (const d of fin?.due ?? []) if (d.year === year) add(d.kind, -d.amount);
  // 이번 시즌 모기업 지원금에서 빼는 부채 몫 (지원금 줄에 이미 빠져 있다, 화면 안내용)
  const trustNow = league.owner?.team === team ? league.owner.trust : 50;
  const debtPay = fin?.debt ? parentParts(league, team, trustNow, inSeason ? fin.history.at(-1)?.cash ?? START_CASH : cashOf(league, team), year).debt : 0;
  return { year, items, homeGames, perGame, winPct, seats, prices, debtPay };
}

/** 예산안 한 줄 */
export interface BudgetRow {
  kind: FinanceKind;
  plan: number;
  sofar: number;
  /** 시즌 끝 예상 */
  end: number;
}

/**
 * 재정 표 (계획 / 지금까지 / 시즌 끝 예상): 지금까지 = 시즌 중 흐름 + 그 해 장부, 시즌 끝 예상 = 지급 항목은 지금 소속으로 남은 지급까지,
 * 관중 수입은 지금까지 + 남은 홈 경기 × 계획의 한 경기 관중 수입, 스폰서는 지금 승률로 결산 셈, 가을야구는 지금까지
 */
export function budgetRows(input: SeasonInput, team: number, upToDay: number, plan: FinancePlan): BudgetRow[] {
  const { league, world, season } = input;
  const year = world.year;
  const now = seasonFlows(input, team, upToDay);
  const full = seasonFlows({ ...input, settle: true }, team, Number.MAX_SAFE_INTEGER);
  const booked = ledgerItems(league, team, year);
  const sofar: Partial<Record<FinanceKind, number>> = { ...now.items };
  const end: Partial<Record<FinanceKind, number>> = { ...full.items };
  for (const k of Object.keys(booked) as FinanceKind[]) {
    if (k === 'start') continue;
    sofar[k] = (sofar[k] ?? 0) + (booked[k] ?? 0);
    end[k] = (end[k] ?? 0) + (booked[k] ?? 0);
  }
  end.gate = (full.items.gate ?? 0) + Math.round(plan.perGame * Math.max(0, plan.homeGames - full.homeGames));
  const rec = team < world.teams.length ? season.teams[team] : null;
  const pct = rec && rec.w + rec.l > 0 ? rec.w / (rec.w + rec.l) : plan.winPct;
  const star = team < world.teams.length ? starBonus(world, league)[team] ?? 0 : 0;
  if (sponsorModelOn(league, team, year)) {
    // 계약 스폰서는 고정 (보너스는 결산 때), 상품·식음은 지금까지 + 남은 홈 경기 × 지금까지 경기당
    end.sponsor = contractSponsor(league, team, year, 0);
    const per = full.homeGames ? (full.items.merch ?? 0) / full.homeGames : 0;
    end.merch = (full.items.merch ?? 0) + Math.round(per * Math.max(0, plan.homeGames - full.homeGames));
  } else end.sponsor = sponsorAmount(league, team, isFuturesTeam(league, team, year), pct, 0, star, year);
  if (plan.items.stadium && !booked.stadium) end.stadium = plan.items.stadium;
  const kinds = new Set<FinanceKind>([...Object.keys(plan.items), ...Object.keys(sofar), ...Object.keys(end)] as FinanceKind[]);
  return [...kinds].map((kind) => ({ kind, plan: plan.items[kind] ?? 0, sofar: sofar[kind] ?? 0, end: end[kind] ?? 0 }))
    .filter((r) => r.plan || r.sofar || r.end);
}

// ---- 결산

/** 인기도 셈에 덮어쓸 값 (예산안 계획: 다음 시즌 마케팅 쌓인 효과·프런트 예산) */
export interface PopularityOpt { mk?: number; front?: number }

/**
 * 인기도: 성적·가을야구·연고·스타·팬 (0.6~1.4) × 마케팅 (쌓인 효과, 상한 밖에서 곱한다. 2026-10-29)
 * × 프런트 예산 배율 (재정 2 F2, 0.95~1.05, frontScale)
 */
export function popularity(league: LeagueState, team: number, winPct: number, postseasonRound: number, star: number, opt?: PopularityOpt): number {
  const fan = fanSponsor(fanLevel(league, team, league.year));
  const v = (1 + 1.2 * (winPct - 0.5) + 0.06 * postseasonRound + 2 * parkOf(league, team).market + 2 * star) * fan;
  const front = frontScale(opt?.front ?? activeBudgetOf(league, team, 'front'));
  return Math.max(0.6, Math.min(1.4, v)) * marketingAt(MARKETING_SPONSOR, opt?.mk ?? marketingStock(league, team)) * front;
}

/**
 * 모기업 지원금: 등급 기본액 × (0.85 + 0.003 × 신뢰도) − 쌓인 자금 회수분 − 부채 몫 (재정 2 F5: 긴급 지원 절반을 3년 ⅓씩).
 * 부채 칸이 없는 예전 저장은 예전 규칙 (전년 긴급 지원의 절반을 한 해에). cash: 지원금을 받기 직전 자금
 */
export function parentSupport(league: LeagueState, team: number, trust: number, cash: number, year = league.year): number {
  return parentParts(league, team, trust, cash, year).support;
}

/** 모기업 지원금 셈 나눠 보기: debt = 이번에 실제로 뺀 부채 몫 (지원금보다 크면 지원금만큼) */
export function parentParts(league: LeagueState, team: number, trust: number, cash: number, year = league.year): { support: number; debt: number; clawback: number } {
  const wage = wageIndex(year, league);
  const base = PARENT_BASE[parentGrade(league, team)] * wage;
  const f = league.finance?.[team];
  const clawback = Math.max(0, cash - PARENT_RESERVE * wage) * PARENT_CLAWBACK;
  const inc = team === userTeamOf(league) ? settingsOf(league).income : 1;
  const gross = base * inc * (0.85 + 0.003 * trust) - clawback;
  if (!f?.debt) {
    const prevRescue = f?.history.at(-1)?.rescue ?? 0;
    return { support: Math.max(0, Math.round(gross - prevRescue / 2)), debt: 0, clawback: Math.round(clawback) };
  }
  const debt = Math.min(debtDueOf(f), Math.max(0, Math.round(gross)));
  return { support: Math.max(0, Math.round(gross) - debt), debt, clawback: Math.round(clawback) };
}

export interface SettleInput extends SeasonInput {
  /** 정규시즌 순위 (구단 색인) */
  standings: number[];
  /** 가을야구에서 이긴 시리즈 수 (진출 못 하면 0, 진출만 1) */
  postseasonDepth: (team: number) => number;
  champion: number | null;
  /** 구단별 구단주 신뢰도 (플레이어 구단만 실제 값, AI는 50) */
  trust: (team: number) => number;
}

/**
 * 시즌 결산: 시즌 중 수입·지출과 결산 항목(중계권·스폰서·모기업 지원·우승 배당)을 장부에 적고,
 * 자금이 0보다 작으면 모기업이 0까지 메운다. 구단별 결산을 돌려준다 (league.finance[t].history에도 남긴다).
 */
export function settleSeason(input: SettleInput): FinanceYear[] {
  const { league, world, season } = input;
  const year = world.year;
  ensureFinance(league);
  const end = Number.MAX_SAFE_INTEGER;
  const out: FinanceYear[] = [];
  const stars = starBonus(world, league);
  const wage = wageIndex(year, league);
  const reserve = DIVIDEND_RESERVE * wage;
  for (let t = 0; t < league.teams.length; t++) {
    // 이번 시즌 모기업 지원금에서 실제로 뺀 부채 몫 (seasonIncome과 같은 입력, 지원금을 바꾸기 전에)
    const fin = league.finance![t];
    const debtPaid = fin.debt ? parentParts(league, t, league.owner?.team === t ? league.owner.trust : 50, fin.history.at(-1)?.cash ?? START_CASH, year).debt : 0;
    const flows = seasonFlows({ ...input, settle: true }, t, end);
    const items = { ...flows.items };
    const rec = t < world.teams.length ? season.teams[t] : null;
    const pct = rec && rec.w + rec.l > 0 ? rec.w / (rec.w + rec.l) : 0.5;
    const futures = isFuturesTeam(league, t, year);
    // 중계권·모기업 지원금은 지급일마다 받았다 (결산 몫은 방금 셈에 넣음). 스폰서는 실제 인기도로 다시 매겨 차액을 정산한다
    const perGame = flows.homeGames ? flows.regular / flows.homeGames : 0;
    items.sponsor = sponsorModelOn(league, t, year)
      ? contractSponsor(league, t, year, dealsBonus(dealsAt(league, t, year), input.postseasonDepth(t), input.champion === t, perGame))
      : sponsorAmount(league, t, futures, pct, input.postseasonDepth(t), stars[t] ?? 0, year);
    if (input.champion === t) items.champion = Math.round(CHAMPION_BONUS * wage);
    const build = installment(league.stadiums?.[t], year);
    if (build) items.stadium = -build;
    for (const [k, v] of Object.entries(items) as [FinanceKind, number][]) {
      if (!v) continue;
      league.ledger.push(v > 0
        ? { year, from: -1, to: t, amount: v, note: `${year} ${FINANCE_LABEL[k]}`, kind: k }
        : { year, from: t, to: -1, amount: -v, note: `${year} ${FINANCE_LABEL[k]}`, kind: k });
    }
    // 이 해 장부의 다른 항목(오프시즌 보상금·계약금·이적료, 시즌 중 현금 트레이드 등)도 결산에 넣는다
    const other = ledgerItems(league, t, year);
    for (const k of Object.keys(other) as FinanceKind[]) if (!(k in items) && k !== 'rescue' && k !== 'faSupport' && k !== 'start' && k !== 'dividend' && k !== 'debt') items[k] = other[k];
    // 구장: 장부에 이 해 착공금과 방금 적은 할부가 함께 있다. 계약금도 (오프시즌 계약 때 절반 + 개막일 절반, 재정 2 F5)
    if (other.stadium) items.stadium = other.stadium;
    if (other.signing) items.signing = other.signing;
    const net = Object.values(items).reduce((s, v) => s + (v ?? 0), 0);
    let cash = cashOf(league, t);
    let rescue = 0;
    if (cash < 0) {
      rescue = -cash;
      league.ledger.push({ year, from: -1, to: t, amount: rescue, note: `${year} 모기업 긴급 지원 (적자 보전)`, kind: 'rescue' });
      cash = 0;
    }
    // 부채 (재정 2 F5): 이번 시즌 뺀 몫을 지우고 긴급 지원의 절반을 3년에 나눠 얹는다. 개막일에 낸 돈(due)은 지운다
    settleDebt(fin, debtPaid, rescue, (short) => {
      const pay = Math.min(short, Math.max(0, cash));
      if (pay > 0) {
        league.ledger.push({ year, from: t, to: -1, amount: pay, note: `${year} 모기업 부채 상환 (지원금이 모자란 몫)`, kind: 'debt' });
        cash -= pay;
      }
      return pay;
    });
    if (fin.due?.some((d) => d.year <= year)) {
      fin.due = fin.due.filter((d) => d.year > year);
      if (!fin.due.length) delete fin.due;
    }
    let dividend = 0;
    if (cash > reserve) {
      dividend = Math.round((cash - reserve) * DIVIDEND_SHARE);
      league.ledger.push({ year, from: t, to: -1, amount: dividend, note: `${year} 모기업 환원 (쌓인 자금)`, kind: 'dividend' });
      cash -= dividend;
    }
    const base = isBasePrices(flows.prices);
    const y: FinanceYear = {
      year, items, net, cash, rescue, ...(dividend ? { dividend } : {}), ...(fin.debt?.amount ? { debt: fin.debt.amount } : {}), attendance: flows.regular, homeGames: flows.homeGames,
      ...(flows.homeGames ? { seats: roundSeats(flows.seats), demand: flows.demand } : {}), ...(base ? {} : { prices: flows.prices }),
    };
    league.finance![t].history.push(y);
    out.push(y);
    // 팬 만족도 결산 (stadium.ts): 스폰서를 매긴 뒤에. 입장권 가격 지수만큼 (재정 2 F3, 기본 가격이면 0)
    const fanPrice = base || !flows.homeGames ? 0 : priceFanDelta(priceIndexOf(flows.seats, flows.prices));
    fansSeasonEnd(league, t, year, pct, input.postseasonDepth(t), input.champion === t, parkOf(league, t).market,
      fanPrice ? [[fanPrice, `${year} 입장권 가격`]] : []);
    // 다음 시즌 스폰서 빈 자리 제안 (재정 2 F4a): 이 시즌 인기도(팬 결산 뒤)와 홈 경기당 관중으로
    if (!isFuturesTeam(league, t, year + 1)) {
      const pop = popularity(league, t, pct, input.postseasonDepth(t), stars[t] ?? 0);
      league.finance![t].sponsorOffers = makeOffers(league, t, year + 1, pop, perGame);
    }
  }
  // 구장: 낡고, 끝난 공사는 완공 (AI 리모델링 주문 포함)
  league.stadiumNews = stadiumYearEnd(league, year, (t) => cashOf(league, t), userTeamOf(league));
  return out;
}

/**
 * FA 계약금(계약 때 내는 몫, 재정 2 F5부터 절반) 중 자금이 모자란 몫을 모기업이 대 준다 (2026-10-21 사용자: "대줘"). AI 구단·플레이어 구단 모두.
 * 장부에 '모기업 지원 (FA 계약금)'으로 남기고 지원액을 돌려준다 (없으면 0).
 * 구단주 평가와는 잇지 않는다: 결산 수지(net)와 긴급 지원(rescue)에 넣지 않는다
 */
export function coverFaBonus(league: LeagueState, team: number, bonus: number, year: number, who: string): number {
  // 한도(faSupportLeft)는 제시할 때 검사한다. 같은 라운드에 여럿을 계약해 한도를 넘는 몫은 지원하지 않는다 (자금이 0 아래로 내려간다)
  const need = Math.min(Math.round(bonus - Math.max(0, cashOf(league, team))), faSupportLeft(league, team, year));
  if (need <= 0) return 0;
  league.ledger.push({ year, from: -1, to: team, amount: need, note: `${who} FA 계약금 모기업 지원`, kind: 'faSupport' });
  return need;
}

/** 그 해(장부 연도 = 계약한 오프시즌 다음 해) 모기업 FA 계약금 지원 한도 (만 원) */
export function faSupportCap(league: LeagueState, team: number, year = league.year): number {
  // 구단주 예산 회의에서 한도 상향을 받은 해는 1.5배 (재정 2 F4b, meeting.ts)
  return Math.round(PARENT_BASE[parentGrade(league, team)] * FA_SUPPORT_SHARE * wageIndex(year, league) * faCapScale(league, team, year));
}

/** 그 해 남은 모기업 FA 계약금 지원 (만 원) */
export function faSupportLeft(league: LeagueState, team: number, year: number): number {
  const used = league.ledger.reduce((s, e) => s + (e.kind === 'faSupport' && e.to === team && e.year === year ? e.amount : 0), 0);
  return Math.max(0, faSupportCap(league, team, year) - used);
}

/** 계약금 bonus의 계약 때 몫(bonusNow)을 지금 자금 + 남은 모기업 지원으로 낼 수 있나 */
export function canPayFaBonus(league: LeagueState, team: number, bonus: number, year: number): boolean {
  // 계약 때 내는 몫만 (재정 2 F5 계약금 2번: 남은 절반은 다음 개막일)
  return bonusNow(bonus) <= Math.max(0, cashOf(league, team)) + faSupportLeft(league, team, year);
}

/** 적자 보전에 따른 구단주 신뢰도 변화 (−(메운 금액 ÷ 20억), 최대 −15). 흑자면 +2 */
export function trustFromFinance(y: FinanceYear): number {
  if (y.rescue > 0) return -Math.min(15, Math.round(y.rescue / 200_000));
  return y.net > 0 ? 2 : 0;
}

// ---- 투자

const eokShort = (man: number) => `${Math.round(man / 1000) / 10}억 원`;

/** 투자 계획을 바꾼다 (예전 조작 'invest', 오프시즌, 다음 시즌부터). 재정 2 F2부터는 그 단계 눈금 금액의 예산(setBudget)으로 바꿔 적용한다 */
export function setInvest(league: LeagueState, team: number, kind: InvestKind, level: number): { ok: boolean; message: string } {
  if (!INVEST_KINDS.includes(kind) || !Number.isInteger(level) || level < 0 || level > 3) return { ok: false, message: '투자 단계는 0~3입니다.' };
  return setBudget(league, team, kind, INVEST_COST[kind][level]);
}

/** 예산 한 줄을 정한다 (오프시즌, 다음 시즌부터). 그 줄은 고정된다 (해마다 자동 배분이 남겨 둠) */
export function setBudget(league: LeagueState, team: number, kind: BudgetKind, amount: number): { ok: boolean; message: string } {
  if (!BUDGET_KINDS.includes(kind)) return { ok: false, message: '없는 예산 줄입니다.' };
  const [lo, hi] = budgetRange(kind);
  if (!Number.isFinite(amount) || amount % BUDGET_UNIT !== 0 || amount < lo || amount > hi) {
    return { ok: false, message: `${BUDGET_LABEL[kind]} 예산은 ${eokShort(lo)}~${eokShort(hi)}, 1천만 원 단위입니다.` };
  }
  ensureFinance(league);
  const f = league.finance![team];
  writeBudget(f, { ...budgetOf(f, true), [kind]: amount });
  f.locked = [...new Set([...lockedOf(f), kind])].sort((a, b) => BUDGET_KINDS.indexOf(a) - BUDGET_KINDS.indexOf(b));
  return { ok: true, message: `${BUDGET_LABEL[kind]} 예산 연 ${eokShort(budgetCostOf(amount, wageIndex(league.year + 1, league)))} (다음 시즌부터, 고정)` };
}

/** 추천안을 넣는다 (모든 줄의 고정이 풀린다) */
export function setBudgetPreset(league: LeagueState, team: number, preset: BudgetPreset): { ok: boolean; message: string } {
  if (!BUDGET_PRESETS.includes(preset)) return { ok: false, message: '없는 추천안입니다.' };
  ensureFinance(league);
  const f = league.finance![team];
  writeBudget(f, { ...PRESET_BUDGET[preset] });
  f.locked = [];
  return { ok: true, message: `예산을 '${PRESET_LABEL[preset]}' 추천안으로 정했습니다 (다음 시즌부터).` };
}

/** 한 줄을 자동(균형 추천안 값)으로 되돌린다 */
export function setBudgetAuto(league: LeagueState, team: number, kind: BudgetKind): { ok: boolean; message: string } {
  if (!BUDGET_KINDS.includes(kind)) return { ok: false, message: '없는 예산 줄입니다.' };
  ensureFinance(league);
  const f = league.finance![team];
  writeBudget(f, { ...budgetOf(f, true), [kind]: PRESET_BUDGET.balance[kind] });
  f.locked = lockedOf(f).filter((k) => k !== kind);
  return { ok: true, message: `${BUDGET_LABEL[kind]} 예산을 자동(균형)으로 되돌렸습니다.` };
}

/**
 * 해마다 결산 뒤(오프시즌 시작) 플레이어 구단 예산을 "균형" 추천안으로 다시 채운다. 고정한 줄은 남긴다 (재정 2 기획안 4.3, 결정 Q7).
 * 칸이 없는 예전 저장도 이때 칸을 만든다 (고정은 lockedOf의 짐작)
 */
export function autoBudget(league: LeagueState, team: number): void {
  if (team < 0) return;
  ensureFinance(league);
  const f = league.finance![team];
  if (!f) return;
  const locked = lockedOf(f);
  const cur = budgetOf(f, true);
  const next = { ...PRESET_BUDGET.balance };
  for (const k of locked) next[k] = cur[k];
  writeBudget(f, next);
  f.locked = locked;
}

/** 한 단계 아래 추천안 (자금이 모자랄 때): 윈나우·육성 → 균형 → 긴축 */
const PRESET_DOWN: Record<BudgetPreset, BudgetPreset | null> = { winnow: 'balance', develop: 'balance', balance: 'frugal', frugal: null };
/** AI 자금 규칙: 예상 수지 < −(자금 × 이 비율)이면 한 단계 아래 추천안 (임시값) */
export const AI_BUDGET_CASH = 0.5;

/** AI 구단이 고르는 추천안: 성향 윈나우 → 윈나우, 리빌딩 → 육성, 긴축 → 긴축, 그 밖은 지난 순위 상위 ⅓ 윈나우·하위 ⅓ 육성·가운데 균형 */
export function aiPreset(league: LeagueState, team: number): BudgetPreset {
  const style = gmStyle(league, team);
  if (style === 'winnow') return 'winnow';
  if (style === 'develop') return 'develop';
  if (style === 'frugal') return 'frugal';
  const st = league.lastSeason?.standings ?? [];
  const r = st.indexOf(team);
  const n = st.length || 1;
  if (r >= 0 && r < n / 3) return 'winnow';
  if (r >= 0 && r >= (2 * n) / 3) return 'develop';
  return 'balance';
}

/** 오프시즌 셈용 빈 월드 (스타 보정 없음) */
const NO_WORLD = { teams: [], year: -1 } as unknown as World;

/**
 * 개막 때 예산을 확정한다 (재정 2 F2, 예전 lockInvestments 자리). AI 구단은 추천안을 고르고(aiPreset),
 * 그 추천안의 예상 수지가 −(자금 × AI_BUDGET_CASH)보다 나쁘면 한 단계씩 아래 추천안으로 내린다. 마케팅 쌓인 효과는 확정 금액의 효과 단계 쪽으로
 */
export function lockBudgets(league: LeagueState, userTeam: number): void {
  ensureFinance(league);
  for (let t = 0; t < league.teams.length; t++) {
    const f = league.finance![t];
    if (t !== userTeam) {
      let preset = aiPreset(league, t);
      const cash = cashOf(league, t);
      for (let guard = 0; guard < 3; guard++) {
        const plan = financePlan({ league, world: NO_WORLD }, t, league.year, PRESET_BUDGET[preset]);
        const net = Object.values(plan.items).reduce((s, v) => s + (v ?? 0), 0);
        const down = PRESET_DOWN[preset];
        if (net >= -(Math.max(0, cash) * AI_BUDGET_CASH) || !down) break;
        preset = down;
      }
      writeBudget(f, { ...PRESET_BUDGET[preset] });
      // 입장권 가격: AI는 재무팀 추천 가격 (재정 2 F3, 플레이어와 같은 규칙)
      f.prices = recommendPrices(league, t);
    }
  }
  for (let t = 0; t < league.teams.length; t++) {
    const f = league.finance![t];
    // 스폰서 빈 자리 자동 계약 (재정 2 F4a, 플레이어 구단도 고르지 않은 자리는 같은 규칙)
    autoSignSponsors(league, t);
    const prices = pricesOf(f, true);
    if (f.prices || f.activePrices) f.activePrices = prices;
    const prevMk = marketingStock(league, t);
    const b = budgetOf(f, true);
    f.activeBudget = { ...b };
    f.active = { ...f.invest };
    f.mk = stepMarketing(prevMk, investStep('marketing', b.marketing));
  }
}
/** 예전 이름 (도구·시험) */
export const lockInvestments = lockBudgets;
