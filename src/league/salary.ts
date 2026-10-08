// 연봉, 샐러리캡, FA 자격·등급·보상금 (기획서 8장).
//
// 제도 값은 자료집 "제도연표"에서 "출처 확인"인 것만 확정값으로 쓰고, 나머지는 "임시값"으로 표시한다.
// 연봉 단위는 만 원 (외국인 선수만 달러).

import type { LeaguePlayer, School } from './types';

/** 최저 연봉: 2021년부터 3,000만 원 (출처 확인) */
export const MIN_SALARY = 3000;

/** 샐러리캡 (만 원). 2026~2028은 발표값(출처 확인), 이후는 매년 5% 상향 (기획서 4.1) */
const CAP: Record<number, number> = { 2023: 1142638, 2024: 1142638, 2025: 1371165, 2026: 1439723, 2027: 1511709, 2028: 1587294 };
export function salaryCap(year: number): number | null {
  if (year < 2023) return null;
  if (CAP[year]) return CAP[year];
  let v = CAP[2028];
  for (let y = 2029; y <= year; y++) v = Math.round(v * 1.05);
  return v;
}
/** 샐러리캡 대상: 외국인·신인을 뺀 구단별 연봉 상위 40명 합계 (출처 확인) */
export const CAP_TOP_N = 40;

export function capPayroll(players: LeaguePlayer[], team: number): number {
  return players
    .filter((p) => p.team === team && !p.foreign && p.contract.kind !== 'rookie')
    .map((p) => p.contract.salary)
    .sort((a, b) => b - a)
    .slice(0, CAP_TOP_N)
    .reduce((a, b) => a + b, 0);
}

/**
 * FA 시장 연봉 (연평균, 만 원): 계약 기간 평균 기여(런)에 따라 오른다 (임시값).
 * 기준점: 50런(리그 최정상급) 약 20억, 20런(주전) 약 6억, 8런(백업) 약 1.8억.
 */
export function marketSalary(runs: number): number {
  return Math.max(MIN_SALARY, Math.round(1200 * Math.max(0, runs) ** 1.31));
}

/** 시장 연봉식의 역함수: 이 연봉이면 시장에서 몇 런짜리 선수 값인가 */
export function runsForSalary(salary: number): number {
  return (Math.max(0, salary) / 1200) ** (1 / 1.31);
}

/** 보류 선수(FA 전) 연봉 목표: 연차에 따른 기본분 + 기여에 따른 몫 (임시값. 연도별 평균 연봉 자료 없음) */
export function reserveTarget(runs: number, service: number): number {
  const seniority = Math.min(1.2, 0.4 + 0.12 * service);
  return Math.round(MIN_SALARY + SENIORITY_PAY * Math.min(12, service) + RUN_PAY * Math.max(0, runs) ** 1.3 * seniority);
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

/** FA 자격 연한: 고졸 8년·대졸 7년 (2022년 시즌 뒤부터, 출처 확인) */
export function serviceNeeded(school: School | null, entryYear: number, birthYear: number | null): number {
  const s = school ?? (birthYear && entryYear - birthYear >= 22 ? 'UNIV' : 'HS');
  return s === 'UNIV' ? 7 : 8;
}

/** FA 재자격: 마지막 FA 계약 이후 1군 4시즌 (임시값, 실제 규정 미확인) */
export const FA_RE_ELIGIBLE = 4;

/** 1군 연차로 인정하는 한 시즌 1군 등록 비율 (임시값. 실제는 등록일수 기준이며 일수는 미확인) */
export const SERVICE_SHARE = 0.6;

/** year 시즌이 끝난 뒤 FA 자격이 있는가 */
export function faEligible(p: LeaguePlayer, year: number): boolean {
  if (p.foreign || p.team < 0) return false;
  if (p.contract.until > year) return false;
  const need = p.faCount === 0 ? serviceNeeded(p.school, p.entryYear, p.birthYear) : FA_RE_ELIGIBLE;
  return p.service >= need;
}

export type FaGrade = 'A' | 'B' | 'C';

/** 보상금 비율 (기획서 8장: 보상선수 없이 보상금만) */
export const COMPENSATION: Record<FaGrade, number> = { A: 3, B: 2, C: 1.5 };

/**
 * FA 등급 (2020년 시즌 뒤 등급제, 출처 확인): 구단 연봉 순위와 리그 전체 연봉 순위로 정한다.
 * A: 구단 3위 이내·전체 30위 이내, B: 구단 10위·전체 60위 이내, 나머지 C.
 * 만 35세 이상 신규 FA는 C, 두 번째 FA는 B 이하, 세 번째 이상은 C.
 * 순위는 외국인을 뺀 연봉 순. "이내"를 두 조건 모두로 읽었다 (해석).
 */
export function faGrade(p: LeaguePlayer, all: LeaguePlayer[], year: number): FaGrade {
  const domestic = all.filter((x) => !x.foreign && x.team >= 0);
  const rankIn = (list: LeaguePlayer[]) => 1 + list.filter((x) => x.contract.salary > p.contract.salary).length;
  const teamRank = rankIn(domestic.filter((x) => x.team === p.team));
  const leagueRank = rankIn(domestic);
  let g: FaGrade = teamRank <= 3 && leagueRank <= 30 ? 'A' : teamRank <= 10 && leagueRank <= 60 ? 'B' : 'C';
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
export function foreignSalary(runs: number, isNew: boolean, asia: boolean): number {
  if (asia) return Math.min(ASIA_NEW_CAP, Math.round((80_000 + 6_000 * Math.max(0, runs)) / 10_000) * 10_000);
  const v = Math.round((400_000 + 25_000 * Math.max(0, runs)) / 50_000) * 50_000;
  return isNew ? Math.min(FOREIGN_NEW_CAP, v) : Math.min(2_000_000, v);
}

/** 소속선수 정원 68명 (2026~, 출처 확인) */
export const ORG_LIMIT = 68;

/** 금액 표시: 만 원 → "3억 2,000만 원" */
export function wonText(man: number): string {
  const eok = Math.floor(man / 10000);
  const rest = Math.round(man % 10000);
  if (eok && rest) return `${eok}억 ${rest.toLocaleString('ko-KR')}만 원`;
  if (eok) return `${eok}억 원`;
  return `${rest.toLocaleString('ko-KR')}만 원`;
}

export function dollarText(usd: number): string {
  return `${Math.round(usd / 10_000).toLocaleString('ko-KR')}만 달러`;
}
