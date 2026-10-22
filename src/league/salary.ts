// 연봉, 샐러리캡, FA 자격·등급·보상금 (기획서 8장).
//
// 제도 값은 자료집 "제도연표"에서 "출처 확인"인 것만 확정값으로 쓰고, 나머지는 "임시값"으로 표시한다.
// 연봉 단위는 만 원 (외국인 선수만 달러).

import { faServiceNeeded } from './eras';
import type { LeagueState, LeaguePlayer, School } from './types';
import { ruleOf } from './rules';
import { seasonsWith } from './stadium';
import { futureValue } from './futureRules';

/** 최저 연봉: 2021년부터 3,000만 원 (출처 확인) */
export const MIN_SALARY = 3000;

/** 샐러리캡 (만 원). 2026~2028은 발표값(출처 확인), 이후는 매년 5% 상향 (기획서 4.1). 미래 규칙 변경 ②가 상향률을 바꿀 수 있다 */
const CAP: Record<number, number> = { 2023: 1142638, 2024: 1142638, 2025: 1371165, 2026: 1439723, 2027: 1511709, 2028: 1587294 };
export function salaryCap(year: number, league?: Pick<LeagueState, 'rules' | 'ruleShifts'>): number | null {
  if (year < 2023) return null;
  // 규정 변경 (league/rules.ts capScale, 0이면 폐지)
  const scale = ruleOf(league, 'capScale');
  if (scale <= 0) return null;
  const v = baseCap(year, league);
  return scale === 1 ? v : Math.round(v * scale);
}

/** 캡 배율·폐지와 상관없는 기본 캡 경로 (발표값, 2029년부터 미래 규칙의 상향률로 복리) */
function baseCap(year: number, league?: Pick<LeagueState, 'ruleShifts'>): number {
  if (CAP[year]) return CAP[year];
  if (year < 2023) return CAP[2023];
  let v = CAP[2028];
  for (let y = 2029; y <= year; y++) v = Math.round(v * (1 + futureValue(league, 'capGrowth', y)));
  return v;
}

/**
 * 연봉 상승 지수 (2026년 = 1, 2026년 이전도 1): 그 해 기본 캡 경로 ÷ 2026년 캡 (2027 +5%, 2028 +10.25%, 그 뒤 미래 규칙의 상향률).
 * 2026년 뒤 연봉은 이 지수만큼 오른다: 연봉 생성식(FA 요구·평가, 비FA 다년, 보류 연봉 협상, 신인)에 곱하고, 돈 → 런 쪽은 나눈다.
 * 재정(finance.ts 수입·운영비·투자비·기준 자금)도 같은 지수를 쓴다 (연봉만 오르면 수입이 못 따라가 시장이 얼어붙는다, 2026-10-22).
 * 캡이 없는 모드(자유 모드 capScale 0)도 같은 경로(5% 복리)다. 지수를 쓰는 곳은 "계약이 시작되는 해" 값을 넣는다.
 * 2026년 이전 시대는 내부 연봉이 2026년 물가로 고정(priceIndex는 화면용)이라 1로 둔다
 */
export function wageIndex(year: number, league?: Pick<LeagueState, 'ruleShifts'> | null): number {
  if (year <= 2026) return 1;
  return baseCap(year, league ?? undefined) / CAP[2026];
}

/** 신인 계약 연봉: 최저 연봉 × 연봉 상승 지수 (100만 원 단위 아래는 반올림) */
export function rookieSalary(year: number, league?: Pick<LeagueState, 'ruleShifts'> | null): number {
  return Math.round((MIN_SALARY * wageIndex(year, league)) / 100) * 100;
}
/** 샐러리캡 도입 전(2022년까지)의 구단 예산 기준: 2023년 캡 값을 그대로 쓴다 (임시값. 내부 연봉은 2026년 물가라 캡 값과 같은 단위다) */
export const PRE_CAP_BUDGET = 1142638;

/**
 * 시대별 물가 계수 (2026년 = 1). KBO 평균 연봉(신인·외국인 제외)의 대략적인 흐름을 따른 근사값으로, 자료집에서 확인하지 않았다 (임시값).
 * 내부 연봉은 모두 2026년 물가로 계산·비교하고(캡·예산·가치 함수), 화면에 보여 줄 때와 입력받을 때만 이 계수를 곱하고 나눈다 (기획서 8장 "시대별 물가 계수").
 */
const PRICE_ANCHORS: [number, number][] = [
  [1982, 0.08], [1985, 0.1], [1990, 0.14], [1995, 0.21], [2000, 0.3], [2005, 0.45], [2010, 0.56], [2015, 0.72], [2020, 0.93], [2023, 0.95], [2026, 1],
];
export function priceIndex(year: number): number {
  const a = PRICE_ANCHORS;
  if (year <= a[0][0]) return a[0][1];
  if (year >= a[a.length - 1][0]) return a[a.length - 1][1];
  for (let i = 1; i < a.length; i++) {
    if (year <= a[i][0]) {
      const [y0, v0] = a[i - 1];
      const [y1, v1] = a[i];
      return v0 + ((v1 - v0) * (year - y0)) / (y1 - y0);
    }
  }
  return 1;
}

/** 샐러리캡 대상: 외국인·신인을 뺀 구단별 연봉 상위 40명 합계 (출처 확인) */
export const CAP_TOP_N = 40;

/** 샐러리캡에 들어가는 선수: 소속 구단의 국내 선수 중 신인 계약·복무 중이 아닌 선수 */
function capCounted(p: LeaguePlayer, team: number): boolean {
  return p.team === team && !p.foreign && p.contract.kind !== 'rookie' && p.military?.state !== 'serving';
}

/** 구단의 캡 대상 연봉 합계. tagged = 프랜차이즈 예외 선수 id (연봉의 FRANCHISE_TAG_SHARE만 넣는다) */
export function capPayroll(players: LeaguePlayer[], team: number, topN = CAP_TOP_N, tagged?: string | null): number {
  return players
    .filter((p) => capCounted(p, team))
    .map((p) => (p.id === tagged ? Math.round(p.contract.salary * FRANCHISE_TAG_SHARE) : p.contract.salary))
    .sort((a, b) => b - a)
    .slice(0, topN)
    .reduce((a, b) => a + b, 0);
}

// ---- 2026 샐러리캡 제도 개편 (기획안 리그 규칙 변경 1-7, D23·D24. 값은 웹 조사값이고 자료집 제도연표로는 아직 확인하지 않았다)

/** 프랜차이즈 예외(구단당 1명)가 시작되는 해 (조사값) */
export const FRANCHISE_TAG_FROM = 2026;
/** 프랜차이즈 예외 자격: 같은 구단에서 뛴 시즌 수 (조사값) */
export const FRANCHISE_TAG_SEASONS = 7;
/** 프랜차이즈 예외 선수의 연봉 중 캡에 넣는 비율 (조사값) */
export const FRANCHISE_TAG_SHARE = 0.5;
/** 샐러리캡 하한이 시작되는 해와 그 해 값 (만 원, 조사값. 내부 연봉과 같은 2026년 물가 값) */
export const CAP_FLOOR_FROM = 2027;
export const CAP_FLOOR_2027 = 606538;

/** 프랜차이즈 예외 자격: 그 구단 소속 캡 대상 선수이고 그 구단에서 FRANCHISE_TAG_SEASONS시즌 이상 뛰었다 */
export function franchiseTagEligible(league: Pick<LeagueState, 'teams'>, p: LeaguePlayer, team: number): boolean {
  return capCounted(p, team) && seasonsWith(p, league, team) >= FRANCHISE_TAG_SEASONS;
}

/**
 * 그 해 캡 계산의 프랜차이즈 예외 선수 (없으면 null). 캡이 없거나 FRANCHISE_TAG_FROM 전이면 null.
 * 플레이어가 고른 선수(league.franchiseTags)가 아직 자격이 있으면 그 선수, 아니면 자격 선수 중 연봉 최고를 자동 지정한다
 * (AI 구단은 늘 자동 지정. 난수 없이 연봉 → id 순)
 */
export function franchiseTag(league: Pick<LeagueState, 'teams' | 'players' | 'rules' | 'franchiseTags'>, team: number, year: number): LeaguePlayer | null {
  if (year < FRANCHISE_TAG_FROM || salaryCap(year, league) === null) return null;
  const cands = league.players.filter((p) => franchiseTagEligible(league, p, team));
  const chosen = league.franchiseTags?.[team];
  if (chosen) {
    const c = cands.find((p) => p.id === chosen);
    if (c) return c;
  }
  let best: LeaguePlayer | null = null;
  for (const p of cands) if (!best || p.contract.salary > best.contract.salary || (p.contract.salary === best.contract.salary && p.id < best.id)) best = p;
  return best;
}

/** 그 해 규칙으로 센 구단의 캡 대상 연봉 합계 (계산 인원·프랜차이즈 예외 포함) */
export function teamCapPayroll(league: Pick<LeagueState, 'teams' | 'players' | 'rules' | 'franchiseTags'>, team: number, year: number): number {
  return capPayroll(league.players, team, ruleOf(league, 'capTopN'), franchiseTag(league, team, year)?.id);
}

/** 이 선수가 구단 캡 합계에 넣는 연봉 (예외 선수는 일부만, 캡 대상이 아니면 0). 재계약 검사에서 지금 몫을 뺄 때 쓴다 */
export function capShareOf(league: Pick<LeagueState, 'teams' | 'players' | 'rules' | 'franchiseTags'>, team: number, year: number, p: LeaguePlayer): number {
  if (p.team !== team) return 0;
  return franchiseTag(league, team, year)?.id === p.id ? Math.round(p.contract.salary * FRANCHISE_TAG_SHARE) : p.contract.salary;
}

/** 샐러리캡 하한의 연간 상향률 (조사값: 2027년 도입 뒤 매년 5%) */
export const CAP_FLOOR_GROWTH = 0.05;

/**
 * 샐러리캡 하한 (만 원). 2027년 발표값, 그 뒤 매년 5% 상향 (조사값). 캡이 없거나 2027년 전이면 null.
 * 자유 모드 캡 배율(capScale)은 하한에도 같이 곱한다. 미래 규칙 변경의 캡 상향률은 하한에 닿지 않는다
 */
export function salaryFloor(year: number, league?: Pick<LeagueState, 'rules'>): number | null {
  if (year < CAP_FLOOR_FROM) return null;
  if (salaryCap(year, league) === null) return null;
  let v = CAP_FLOOR_2027;
  for (let y = CAP_FLOOR_FROM + 1; y <= year; y++) v = Math.round(v * (1 + CAP_FLOOR_GROWTH));
  const scale = ruleOf(league, 'capScale');
  return scale === 1 ? v : Math.round(v * scale);
}

/**
 * FA 시장 연봉 (연평균, 만 원): 계약 기간 평균 기여(런)에 따라 오른다 (임시값).
 * 기준점 (2026년): 50런(리그 최정상급) 약 20억, 20런(주전) 약 6억, 8런(백업) 약 1.8억. wage = 계약 시작 해의 연봉 상승 지수(wageIndex)
 */
export function marketSalary(runs: number, wage = 1): number {
  return Math.max(MIN_SALARY, Math.round(1200 * wage * Math.max(0, runs) ** 1.31));
}

/** 시장 연봉식의 역함수: 이 연봉이면 시장에서 몇 런짜리 선수 값인가 */
export function runsForSalary(salary: number, wage = 1): number {
  return (Math.max(0, salary) / (1200 * wage)) ** (1 / 1.31);
}

/** 보류 선수(FA 전) 연봉 목표: 연차에 따른 기본분 + 기여에 따른 몫 (임시값. 연도별 평균 연봉 자료 없음). wage = 연봉 상승 지수 */
export function reserveTarget(runs: number, service: number, wage = 1): number {
  const seniority = Math.min(1.2, 0.4 + 0.12 * service);
  return Math.round((MIN_SALARY + SENIORITY_PAY * Math.min(12, service) + RUN_PAY * Math.max(0, runs) ** 1.3 * seniority) * wage);
}

const SENIORITY_PAY = 900;
const RUN_PAY = 220;

/** 보류 선수 다음 해 연봉: 목표값을 향하되 한 해 변동 폭을 제한한다 (삭감 25%, 인상 150%까지. 임시값, 실제 삭감 한도 규정 미확인) */
export function nextReserveSalary(prev: number, target: number): number {
  return Math.max(MIN_SALARY, Math.round(Math.min(prev * 2.5, Math.max(prev * 0.75, target))));
}

/** FA 계약 기간 (임시값): 나이가 많을수록 짧다 */
export function faYears(age: number): number {
  if (age <= 29) return 4;
  if (age <= 32) return 3;
  if (age <= 34) return 2;
  return 1;
}

/** 런을 돈으로 바꾸는 시장 단가 (만 원/런, 임시값). 시장 연봉식의 주전급 기울기 근처 */
export const WON_PER_RUN = 4500;

/** FA 자격 연한: 고졸 8년·대졸 7년 (2022년 시즌 뒤부터, 출처 확인). 그 전 시대는 eras.ts의 faServiceNeeded (임시값) */
export function serviceNeeded(school: School | null, entryYear: number, birthYear: number | null, year = 2022): number {
  const s = school ?? (birthYear && entryYear - birthYear >= 22 ? 'UNIV' : 'HS');
  return faServiceNeeded(year, s === 'UNIV');
}

/** FA 재자격: 마지막 FA 계약 이후 1군 4시즌 (임시값, 실제 규정 미확인) */
export const FA_RE_ELIGIBLE = 4;

/** 1군 연차로 인정하는 한 시즌 1군 등록 비율 (임시값. 실제는 등록일수 기준이며 일수는 미확인) */
export const SERVICE_SHARE = 0.6;

/** year 시즌이 끝난 뒤 FA 자격이 있는가 */
export function faEligible(p: LeaguePlayer, year: number): boolean {
  if (p.foreign || p.team < 0 || p.military?.state === 'serving') return false;
  if (p.contract.until > year) return false;
  const need = p.faCount === 0 ? serviceNeeded(p.school, p.entryYear, p.birthYear, year) : FA_RE_ELIGIBLE;
  return p.service >= need;
}

/** A·B·C: 등급제 (2020 시즌 뒤부터). P1·P2: 등급제 전 모든 FA에 같은 보상 (P1 1999~2010 시즌 뒤, P2 2011~2019 시즌 뒤) */
export type FaGrade = 'A' | 'B' | 'C' | 'P1' | 'P2';

/** 등급제가 시작된 시즌 (그 시즌 뒤 FA부터, 자료집 확인) */
export const FA_GRADE_FROM = 2020;

/**
 * FA 보상 (KBO 등급제, 2026-10-08 사용자 요청으로 보상선수 도입. 처음 기획서 8장은 보상금만이었다).
 * 원 소속 구단은 "직전 연봉 × withPlayer + 보호선수 밖 1명" 또는 "직전 연봉 × cashOnly"를 고른다. C등급은 보상선수 없이 150%.
 * protect: 영입 구단이 내는 보호선수 수 (외국인·군 보류·이번 FA 계약 선수는 자동 보호라 세지 않는다).
 * 등급제 전 (조사값, 웹 조사 2026-10-22, 자료집 제도연표 확인 전): 1999~2010 시즌 뒤 보호 18명 외 1명 + 300% 또는 450%,
 * 2011~2019 시즌 뒤 보호 20명 외 1명 + 200% 또는 300%.
 */
export const FA_COMP: Record<FaGrade, { cashOnly: number; withPlayer: number | null; protect: number | null }> = {
  A: { cashOnly: 3, withPlayer: 2, protect: 20 },
  B: { cashOnly: 2, withPlayer: 1, protect: 25 },
  C: { cashOnly: 1.5, withPlayer: null, protect: null },
  P1: { cashOnly: 4.5, withPlayer: 3, protect: 18 },
  P2: { cashOnly: 3, withPlayer: 2, protect: 20 },
};

/** 화면 표시: "A등급", 등급제 전은 "등급 없음 (1999~2010 보상)" */
export function faGradeLabel(g: FaGrade): string {
  if (g === 'P1') return '등급제 전 (1999~2010 보상)';
  if (g === 'P2') return '등급제 전 (2011~2019 보상)';
  return `${g}등급`;
}

/** 등급제 전 보상인가 (값이 조사값) */
export function isPreGrade(g: FaGrade): boolean {
  return g === 'P1' || g === 'P2';
}
/** AI가 FA 영입 비용을 셀 때 쓰는 보상 비율 (보상금만 고를 때 기준) */
export const COMPENSATION: Record<FaGrade, number> = {
  A: FA_COMP.A.cashOnly, B: FA_COMP.B.cashOnly, C: FA_COMP.C.cashOnly, P1: FA_COMP.P1.cashOnly, P2: FA_COMP.P2.cashOnly,
};

/**
 * FA 등급 (2020년 시즌 뒤 등급제, 출처 확인): 구단 연봉 순위와 리그 전체 연봉 순위로 정한다.
 * A: 구단 3위 이내·전체 30위 이내, B: 구단 10위·전체 60위 이내, 나머지 C.
 * 만 35세 이상 신규 FA는 C, 두 번째 FA는 B 이하, 세 번째 이상은 C.
 * 순위는 외국인을 뺀 연봉 순. "이내"를 두 조건 모두로 읽었다 (해석).
 */
export function faGrade(p: LeaguePlayer, all: LeaguePlayer[], year: number): FaGrade {
  // 등급제 전에는 모든 FA가 같은 보상 (year = 끝난 시즌)
  if (year < FA_GRADE_FROM) return year <= 2010 ? 'P1' : 'P2';
  return faRankGrade(p, all, year);
}

/** 등급제의 등급 계산 (등급제 전 시대에도 "정상급 FA" 판정에 쓴다: 해외 진출) */
export function faRankGrade(p: LeaguePlayer, all: LeaguePlayer[], year: number): 'A' | 'B' | 'C' {
  const domestic = all.filter((x) => !x.foreign && x.team >= 0);
  const rankIn = (list: LeaguePlayer[]) => 1 + list.filter((x) => x.contract.salary > p.contract.salary).length;
  const teamRank = rankIn(domestic.filter((x) => x.team === p.team));
  const leagueRank = rankIn(domestic);
  let g: 'A' | 'B' | 'C' = teamRank <= 3 && leagueRank <= 30 ? 'A' : teamRank <= 10 && leagueRank <= 60 ? 'B' : 'C';
  const age = p.birthYear ? year + 1 - p.birthYear : 30;
  if (p.faCount === 0 && age >= 35) g = 'C';
  if (p.faCount === 1 && g === 'A') g = 'B';
  if (p.faCount >= 2) g = 'C';
  return g;
}

// ---- 외국인 (달러)

/** 신규 외국인 총액 상한 100만 달러 (2019~, 출처 확인) */
export const FOREIGN_NEW_CAP = 1_000_000;
/** 외국인 3명 총액 상한 400만 달러 (2023~, 출처 확인) */
export const FOREIGN_TOTAL_CAP = 4_000_000;
/** 아시아쿼터 신규 상한 20만 달러 (2026~, 출처 확인) */
export const ASIA_NEW_CAP = 200_000;
/** 아시아쿼터를 뺀 외국인 보유 한도 3명, 아시아쿼터 1명 (2026~, 출처 확인) */
export const FOREIGN_REGULAR = 3;
export const FOREIGN_ASIA = 1;

/** 외국인 연봉 (달러, 임시값): 기여에 따라 */
export function foreignSalary(runs: number, isNew: boolean, asia: boolean, league?: Pick<LeagueState, 'rules'>): number {
  if (asia) return Math.min(ruleOf(league, 'asiaNewCap'), Math.round((80_000 + 6_000 * Math.max(0, runs)) / 10_000) * 10_000);
  // 신규는 상한(100만 달러) 아래에 퍼지게 낮은 기울기 (전에는 후보 대부분이 상한에 걸려 요구액이 모두 같았다, 2026-10-09 QA)
  const r = Math.max(0, runs);
  // 신규: 20런 약 51만, 33런 약 74만, 46런 약 98만 달러 (외국인 능력을 올린 뒤 다시 맞춤, 2026-10-12)
  const v = Math.round((isNew ? 150_000 + 18_000 * r : 400_000 + 25_000 * r) / 50_000) * 50_000;
  return isNew ? Math.min(ruleOf(league, 'foreignNewCap'), v) : Math.min(2_000_000, v);
}

/** 소속선수 정원 68명 (2026~, 출처 확인) */
export const ORG_LIMIT = 68;

/** 금액 표시: 만 원 → "3억 2,000만 원" */
/** 연봉 표기. year를 주면 그 해 물가(priceIndex)로 바꿔 보여 준다 */
export function wonText(man: number, year?: number): string {
  const v = year === undefined ? man : man * priceIndex(year);
  const eok = Math.floor(v / 10000);
  const rest = Math.round(v % 10000);
  if (eok && rest) return `${eok}억 ${rest.toLocaleString('ko-KR')}만 원`;
  if (eok) return `${eok}억 원`;
  return `${rest.toLocaleString('ko-KR')}만 원`;
}

export function dollarText(usd: number): string {
  return `${Math.round(usd / 10_000).toLocaleString('ko-KR')}만 달러`;
}
