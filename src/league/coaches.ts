// 코치 (docs/roadmap.md 7.4, 2026-10-11). 2군과 육성 단계의 마지막.
//
// 사용자 결정으로 감독·코치는 실존 인물 이름만 쓰는데, 코치 실명 자료가 없어 이름 없이 역할·등급·성향으로만 다룬다.
// 역할 4가지: 타격, 투수, 수비·주루, 2군(육성). 등급 1~5, 성향(유망주형·베테랑형·균형형). 연봉은 역할·등급에 따라 (FA 1승당 값, coachSalaryAt).
// 효과 (임시값):
//  - 시즌 중: 타격 코치는 우리 타자, 투수·수비 코치는 우리 투수의 경기력(타석 edge)에 (등급 − 3) × COACH_EDGE. 3등급이 리그 평균
//  - 결산 성장: 타격·투수 코치는 그 쪽 선수의 성장 폭을 늘리고(유망주형은 25세 이하에 더), 베테랑형은 31세 이상의 하락을 줄인다.
//    2군 코치는 2군에서 주로 뛴 선수의 성장 폭을 늘린다
// 오프시즌에 후보(시장)에서 고용한다. 계약이 끝나면 자리가 빈다. AI 구단은 자금에 맞춘 연봉 한도 안에서 가성비로 빈자리를 채우고,
// 플레이어 구단 빈자리는 개막 때 직원 추천(가성비, recommendCoach)으로 채운다.

import { Rng } from '../engine';
import type { LeagueState } from './types';
import { wageIndex } from './salary';

export type CoachRole = 'bat' | 'pit' | 'def' | 'dev';
export type CoachStyle = 'young' | 'veteran' | 'balanced';
export const COACH_ROLES: CoachRole[] = ['bat', 'pit', 'def', 'dev'];
export const COACH_ROLE_LABEL: Record<CoachRole, string> = { bat: '타격 코치', pit: '투수 코치', def: '수비·주루 코치', dev: '2군 감독·코치' };
export const COACH_STYLE_LABEL: Record<CoachStyle, string> = { young: '유망주형', veteran: '베테랑형', balanced: '균형형' };

export interface Coach {
  id: string;
  role: CoachRole;
  /** 등급 1~5 */
  level: number;
  style: CoachStyle;
  /** 연봉 (만 원) */
  salary: number;
  /** 계약 마지막 시즌 */
  until: number;
  /** 경력 한 줄 (이름 대신) */
  career: string;
}

/**
 * 코치 연봉 (2026-11-12 사용자 그릴 Q37): 등급이 하나 오를 때 늘어나는 연봉 = 그 역할 한 등급의 승수 × FA 시장 1승당 값.
 * 전에는 역할 구분 없이 1·2·3.5·5·7억이라 효과(성장이 해를 넘어 남는 몫 포함)에 비해 싸서 늘 최고 등급이 정답이었다
 * (reports/nominal-content.md 3장, reports/coach-rep.md).
 * FA_WIN_WON: 시장 단가 WON_PER_RUN 4,500만 원/런(salary.ts, 시장 연봉식의 주전급 기울기) × 득실 1승 11.0점(nominal-content.md 0장) ≈ 4.95억 → 5억 (임시값)
 */
export const FA_WIN_WON = 50_000;
/** 1등급 연봉 (만 원, 임시값. 예전 1등급 1억 그대로) */
export const COACH_BASE_SALARY = 10_000;
/**
 * 역할별 한 등급의 승수 (한 시즌 경기력 + 성장 몫, 임시값, 근거 reports/coach-rep.md 1장, 시드 cr-a 50시즌):
 * - 경기력: 타자 edge +0.01 = 1.51승, 투수 +0.01 = 1.36승 (nominal-content.md 0장) × COACH_EDGE → 타격 0.227·투수 0.204·수비 0.102승 (수비·주루는 투수 쪽 절반)
 * - 성장: 한 해 오른 몫(양수)마다 그 뒤 같은 구단 상위 25명으로 남은 해를 0.7^h로 줄여 센 '런·해'(타자 73.4·투수 64.6, 2군 유망주 84.8, 구단·해당)
 *   × COACH_GROWTH ÷ 득실 1승 11점 → 타격 0.267·투수 0.235·2군 0.308승.
 *   0.7은 잠재력 격차를 해마다 약 30%씩 메우는 성장 속도(ai/value.ts expectedGrowth, 23~25세 0.3)라 코치가 앞당긴 몫이 뒤에서 줄어드는 몫이다.
 *   성향(유망주형 1.5배·베테랑형 절반·하락 완화)은 넣지 않았다
 */
export const COACH_WIN_PER_LEVEL: Record<CoachRole, number> = { bat: 0.49, pit: 0.44, def: 0.10, dev: 0.31 };

/** 등급별 연봉 (만 원, 2026년 돈): 1등급 + (등급 − 1) × 한 등급 승수 × FA_WIN_WON */
export function coachSalaryAt(role: CoachRole, level: number): number {
  return Math.round((COACH_BASE_SALARY + Math.max(0, level - 1) * COACH_WIN_PER_LEVEL[role] * FA_WIN_WON) / 1000) * 1000;
}

/** 코치 한 사람의 기대 승수 (1등급 대비, 한 시즌 + 성장 지속 몫). 성향은 셈하지 않는다 */
export function coachWins(c: Pick<Coach, 'role' | 'level'>): number {
  return Math.max(0, c.level - 1) * COACH_WIN_PER_LEVEL[c.role];
}

/**
 * 가성비 (만 원): 1등급 대비 기대 승수를 FA 1승당 값으로 친 돈 − 1등급 대비 더 내는 연봉. 클수록 몸값보다 효과가 크다.
 * wage = 계약 해 연봉 상승 지수 (연봉은 지수가 곱해져 있다)
 */
export function coachSurplus(c: Pick<Coach, 'role' | 'level' | 'salary'>, wage: number): number {
  return coachWins(c) * FA_WIN_WON * wage - (c.salary - COACH_BASE_SALARY * wage);
}

/** 1등급 대비 1승당 연봉 (만 원, 화면). 1등급은 null */
export function coachCostPerWin(c: Pick<Coach, 'role' | 'level' | 'salary'>, wage: number): number | null {
  const w = coachWins(c);
  return w > 0 ? Math.max(0, c.salary - COACH_BASE_SALARY * wage) / w : null;
}

/**
 * 직원 추천 (2026-11-12 사용자 그릴 Q37: 플레이어 빈자리 기본값 '가장 싼 후보' → 가성비): 연봉이 maxSalary 안인 후보 가운데 가성비가 가장 큰 코치.
 * 같으면 등급이 높은 쪽, 그다음 싼 쪽
 */
export function recommendCoach(cands: Coach[], wage: number, maxSalary = Infinity): Coach | undefined {
  return cands.filter((c) => c.salary <= maxSalary)
    .sort((a, b) => coachSurplus(b, wage) - coachSurplus(a, wage) || b.level - a.level || a.salary - b.salary || a.id.localeCompare(b.id))[0];
}
/** 시즌 중 경기력: (등급 − 3) × 이 값 (홈 이점 0.013, 임시값) */
export const COACH_EDGE = 0.0015;
/** 성장 폭: (등급 − 3) × 이 값 (3등급 = 리그 평균 = 0, 장기 균형을 바꾸지 않게) */
export const COACH_GROWTH = 0.04;
/** 베테랑형의 하락 완화: (등급 − 3) × 이 값 (3등급 이하는 없음) */
export const COACH_DECLINE = 0.1;
/** 해마다 역할별 후보 수 */
const MARKET_PER_ROLE = 5;
/** 중간에 바꿀 때 남은 연봉 가운데 위약금 비율 */
export const COACH_BUYOUT = 0.5;

const CAREERS: Record<CoachRole, string[]> = {
  bat: ['전 1군 타격코치', '전 2군 타격코치', '타격 인스트럭터 출신', '전 국가대표 타격코치', '해외 리그 연수 출신'],
  pit: ['전 1군 투수코치', '전 불펜코치', '투수 인스트럭터 출신', '전 국가대표 투수코치', '해외 리그 연수 출신'],
  def: ['전 수비코치', '전 작전·주루코치', '전 배터리코치', '수비 인스트럭터 출신', '전 국가대표 수비코치'],
  dev: ['전 2군 감독', '전 잔류군 책임코치', '유소년 지도자 출신', '전 육성 총괄', '해외 리그 연수 출신'],
};

/** year = 계약 전 해 (계약은 year + 1 시즌부터). 연봉은 계약이 시작되는 해의 연봉 상승 지수(salary.ts wageIndex)만큼 (2026-10-22 사용자 결정) */
function makeCoach(rng: Rng, role: CoachRole, year: number, n: number, minLevel = 1, league?: Pick<LeagueState, 'ruleShifts'>): Coach {
  const u = rng.next();
  // 평균 3등급 (1: 10%, 2: 25%, 3: 30%, 4: 23%, 5: 12%) — 리그 평균이 기준(3등급)에 맞게
  const level = Math.max(minLevel, u < 0.1 ? 1 : u < 0.35 ? 2 : u < 0.65 ? 3 : u < 0.88 ? 4 : 5);
  const sv = rng.next();
  const style: CoachStyle = sv < 0.35 ? 'young' : sv < 0.65 ? 'veteran' : 'balanced';
  const salary = Math.round(coachSalaryAt(role, level) * (0.85 + rng.next() * 0.3) * wageIndex(year + 1, league) / 1000) * 1000;
  return { id: `coach-${year}-${role}-${n}`, role, level, style, salary, until: year + 1 + rng.int(3), career: CAREERS[role][rng.int(CAREERS[role].length)] };
}

/** 새 게임: 모든 구단에 코치 4명 (2~4등급 중심). 이미 있으면 그대로 */
export function ensureCoaches(league: LeagueState): void {
  if (league.coaches) return;
  league.coaches = league.teams.map((_, t) => {
    const rng = new Rng(`${league.seed}/coaches/${league.startYear}/${t}`);
    return COACH_ROLES.map((role, i) => ({ ...makeCoach(rng, role, league.year - 1, t * 10 + i, 2, league), id: `coach-start-${t}-${role}` }));
  });
}

export function coachOf(league: Pick<LeagueState, 'coaches'>, team: number, role: CoachRole): Coach | undefined {
  return league.coaches?.[team]?.find((c) => c.role === role);
}

/** 그 구단 코치 연봉 합 (한 해) */
export function coachPayroll(league: Pick<LeagueState, 'coaches'>, team: number): number {
  return (league.coaches?.[team] ?? []).reduce((s, c) => s + c.salary, 0);
}

/** 시즌 중 경기력 (타자 쪽, 투수 쪽). 빈자리는 0등급 */
export function coachEdge(league: Pick<LeagueState, 'coaches'>, team: number): { bat: number; pit: number } {
  const lv = (r: CoachRole) => coachOf(league, team, r)?.level ?? 0;
  return { bat: (lv('bat') - 3) * COACH_EDGE, pit: ((lv('pit') - 3) + (lv('def') - 3) * 0.5) * COACH_EDGE };
}

/**
 * 결산 성장에 코치 효과를 더한다. runs → next 변화를 받아 고친 next를 돌려준다.
 * mostlyFutures: 시즌을 주로 2군에서 보낸 선수 (2군 코치 효과)
 */
export function coachGrowth(league: Pick<LeagueState, 'coaches'>, team: number, isPitcher: boolean, age: number, runs: number, next: number, mostlyFutures: boolean): number {
  // 코치 자료가 없는 리그(예전 저장·도구가 만든 리그)는 효과 없음. 코치진이 있는데 자리가 비면 0등급
  if (!league.coaches?.[team]) return next;
  const c = coachOf(league, team, isPitcher ? 'pit' : 'bat');
  const dev = coachOf(league, team, 'dev');
  if (next > runs) {
    let bonus = (c ? c.level : 0) - 3;
    bonus *= COACH_GROWTH * (c?.style === 'young' && age <= 25 ? 1.5 : c?.style === 'veteran' ? 0.5 : 1);
    if (mostlyFutures) bonus += ((dev ? dev.level : 0) - 3) * COACH_GROWTH * (dev?.style === 'young' ? 1.25 : 1);
    return runs + (next - runs) * Math.max(0.6, 1 + bonus);
  }
  if (next < runs && age >= 31 && c?.style === 'veteran' && c.level > 3) return runs - (runs - next) * (1 - (c.level - 3) * COACH_DECLINE);
  return next;
}

/** 오프시즌 코치 시장 (역할마다 MARKET_PER_ROLE명) */
export function coachMarket(league: Pick<LeagueState, 'seed' | 'ruleShifts'>, year: number): Coach[] {
  const rng = new Rng(`${league.seed}/coach-market/${year}`);
  const out: Coach[] = [];
  for (const role of COACH_ROLES) for (let i = 0; i < MARKET_PER_ROLE; i++) out.push(makeCoach(rng, role, year, i, 1, league));
  return out;
}

/**
 * 시즌 중 코치 시장 (2026-10-14 사용자 "코치를 데려올 방법이 없어"): 오프시즌 시장과 따로 만든 역할마다 MARKET_PER_ROLE명 가운데
 * 지금 어느 구단에도 없는 코치. 계약은 이번 시즌부터
 */
export function coachMarketInSeason(league: Pick<LeagueState, 'seed' | 'coaches' | 'ruleShifts'>, year: number): Coach[] {
  const rng = new Rng(`${league.seed}/coach-market-in/${year}`);
  const employed = new Set((league.coaches ?? []).flat().map((c) => c.id));
  const out: Coach[] = [];
  for (const role of COACH_ROLES) for (let i = 0; i < MARKET_PER_ROLE; i++) out.push({ ...makeCoach(rng, role, year - 1, i, 1, league), id: `coach-in-${year}-${role}-${i}` });
  return out.filter((c) => !employed.has(c.id));
}

/** 계약이 끝난 코치를 내보낸다 (오프시즌 시작, year = 막 끝난 시즌) */
export function expireCoaches(league: LeagueState, year: number): void {
  if (!league.coaches) return;
  league.coaches = league.coaches.map((cs) => cs.filter((c) => c.until > year));
}

/** 코치를 고용한다 (같은 역할 코치가 있으면 위약금을 내고 바꾼다). 위약금 (만 원) */
export function hireCoach(league: LeagueState, team: number, c: Coach, year: number): number {
  league.coaches ??= league.teams.map(() => []);
  const cur = coachOf(league, team, c.role);
  let buyout = 0;
  if (cur) {
    buyout = Math.round(cur.salary * Math.max(0, cur.until - year) * COACH_BUYOUT);
    if (buyout > 0) league.ledger.push({ year, from: team, to: -1, amount: buyout, note: `${COACH_ROLE_LABEL[cur.role]} 계약 해지 위약금`, kind: 'coach' });
  }
  league.coaches[team] = [...(league.coaches[team] ?? []).filter((x) => x.role !== c.role), { ...c }];
  return buyout;
}

/** 후보가 다 떨어졌을 때 빈자리를 채우는 2등급 이상 코치 */
export function fallbackCoach(league: Pick<LeagueState, 'seed' | 'ruleShifts'>, role: CoachRole, year: number, team: number): Coach {
  return { ...makeCoach(new Rng(`${league.seed}/coach-fill/${year}/${team}/${role}`), role, year, 90 + team, 2, league), id: `coach-fill-${year}-${team}-${role}` };
}

/**
 * AI 구단 연봉 한도 (만 원, 2026년 돈 × 지수): 자금이 넉넉하면 제한 없음, 보통이면 4등급 몫, 모자라면 3등급 몫까지 (임시값).
 * 예전에는 등급으로 막았다 (80억 이상 5등급, 30억 이상 4등급, 그 밑 3등급)
 */
export function aiCoachBudget(role: CoachRole, cash: number, wage: number): number {
  if (cash >= 800_000 * wage) return Infinity;
  return coachSalaryAt(role, cash >= 300_000 * wage ? 4 : 3) * 1.15 * wage;
}

/**
 * AI 구단이 빈자리를 채운다 (오프시즌 끝). 자금에 맞춘 연봉 한도 안에서 가성비가 큰 코치 (2026-11-12, 예전에는 한도 안 최고 등급).
 * market에서 고른 코치는 빠진다. 후보가 없으면 2등급 코치를 만든다
 */
export function aiHireCoaches(league: LeagueState, market: Coach[], year: number, userTeam: number, cashOf: (t: number) => number): Coach[] {
  league.coaches ??= league.teams.map(() => []);
  const wage = wageIndex(year + 1, league);
  let left = [...market];
  for (let t = 0; t < league.teams.length; t++) {
    if (t === userTeam) continue;
    const cash = cashOf(t);
    for (const role of COACH_ROLES) {
      if (coachOf(league, t, role)) continue;
      const pick = recommendCoach(left.filter((c) => c.role === role), wage, aiCoachBudget(role, cash, wage)) ?? fallbackCoach(league, role, year, t);
      left = left.filter((c) => c.id !== pick.id);
      league.coaches[t] = [...(league.coaches[t] ?? []), { ...pick }];
    }
  }
  return left;
}

/**
 * 플레이어 구단 빈자리를 개막 때 채운다: 남은 후보 가운데 직원 추천(가성비, recommendCoach), 없으면 2등급 코치를 만든다
 * (2026-11-12 사용자 그릴 Q37. 예전에는 가장 싼 후보). wage = 계약 해 연봉 상승 지수. 채운 코치를 돌려준다
 */
export function fillUserCoaches(league: LeagueState, left: Coach[], year: number, team: number, wage: number): Coach[] {
  const out: Coach[] = [];
  for (const role of COACH_ROLES) {
    if (coachOf(league, team, role)) continue;
    const pick = recommendCoach(left.filter((c) => c.role === role), wage) ?? fallbackCoach(league, role, year, team);
    hireCoach(league, team, pick, year);
    out.push(pick);
  }
  return out;
}
