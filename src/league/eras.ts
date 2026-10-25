// 시대별 제도와 구단 변화 (M8, 기획서 4장).
//
// - 제도 스위치: FA(1999 시즌 뒤 도입), 외국인 한도(meta.rules의 연도별 값), 샐러리캡(salary.ts의 salaryCap). 출처 확인된 연도는 기획서 4.2.
// - 구단 변화: 다음 해 실제 시즌 자료의 구단 목록과 지금 리그의 구단을 계보(franchise)로 견줘 명칭 변경·승계·창단을 찾는다.
//   매각·명칭 변경은 이름만 바꾸고, 해체 구단은 후속 구단이 선수단을 승계하며(쌍방울→SK, 현대→히어로즈), 창단은 새 구단 자리를 만든다.
//   자료가 없는 해(2027년 이후)는 변화가 없다.

import type { DataStore, Meta } from '../data/types';
import { divisionsOf, type Divisions } from '../data/schedule';
import type { LeagueTeam } from './types';
import { ruleOf } from './rules';
import { futureDelta } from './futureRules';
import type { LeagueState } from './types';

/** FA 제도가 있는 오프시즌인가 (1999 시즌 뒤부터, 기획서 4.2 출처 확인) */
export function faEnabled(offseasonYear: number): boolean {
  return offseasonYear >= 1999;
}

/**
 * FA 자격에 필요한 1군 연차.
 * - 1999 시즌 뒤 도입 때 10년, 대졸 구분 없음 (출처 확인: 나무위키 KBO FA 제도 각주 4 "FA 시행 첫 해인 1999년에는 10 정규시즌이었으나
 *   2001년부터 9 정규시즌으로 축소", 뉴시스 2020-01-16 "도입 초기 자격 취득 기간은 10시즌이었고, 2001년 9시즌으로 줄었다",
 *   data-src/제도연표_보정.csv 26). 자료집은 값 없이 "미확인"이다.
 *   경계: 다른 연도표는 "2012년 FA"(= 2011 시즌 뒤)처럼 다음 해 FA 이름으로 읽지만, 이 각주는 같은 문장에서 첫 FA(1999 시즌 뒤)를
 *   "1999년"이라 부르므로 시즌 연도로 쓴 것으로 보고 "2001년부터" = 2001 시즌 뒤로 읽는다. 그래서 2000 시즌 뒤까지 10년 (1차 자료 확인 필요)
 * - 2001~2010 시즌 뒤 9년 (대졸도 9년, 조사값. 리그 규칙 변경 1-4 D20)
 * - 2011 시즌 뒤부터 9년·대졸 8년 (자료집 "2012년 FA부터 대졸 8·고졸 9")
 * - 2022년 시즌 뒤부터 8년·대졸 7년 (출처 확인: 자료집)
 */
export function faServiceNeeded(offseasonYear: number, univ: boolean): number {
  if (offseasonYear <= 2000) return 10;
  if (offseasonYear <= 2010) return 9;
  if (offseasonYear <= 2021) return univ ? 8 : 9;
  return univ ? 7 : 8;
}

/**
 * 등급제 전 FA 신청 기준: 리그 국내 선수 가치 순위가 "1군 구단 수 × 이 값" 안인 선수만 신청한다 (null이면 기준 없음).
 * 임시값. 조사 표(1999~2019 시즌 뒤 신청 수)에 맞춘 값: 실제 1999~2008 시즌 뒤 신청 86명(자격 185명),
 * 2011~2019 시즌 뒤 152명(자격 201명). 보상이 무거웠던 시기(300%+1명 또는 450%)에는 주전급 아래 선수가 신청하지 않고 남았다.
 * 실제 2009·2010 시즌 뒤 신청이 적었던 것(12명/자격 45명)은 따로 맞추지 않았다.
 */
export function faFilingRankPerTeam(offseasonYear: number): number | null {
  if (offseasonYear <= 2010) return 17;
  if (offseasonYear <= 2019) return 21;
  return null;
}

export interface ForeignRule {
  /** 보유 한도 전체 (0이면 제도 없음) */
  total: number;
  /** 아시아쿼터 자리 (2026년부터 1) */
  asia: number;
  /** 아시아쿼터를 뺀 자리 */
  regular: number;
}

/** 다음 시즌(year)의 외국인 보유 한도. 자료가 없는 해는 마지막 해의 값 */
export function foreignRule(meta: Meta, year: number, league?: Pick<LeagueState, 'rules' | 'ruleShifts'>): ForeignRule {
  const years = meta.years;
  const y = Math.min(Math.max(year, years[0]), years[years.length - 1]);
  const total = meta.rules[String(y)]?.foreignLimit ?? 0;
  const asia0 = y >= 2026 && total > 0 ? 1 : 0;
  // 자료 없는 해는 미래 규칙 변경 ② (futureRules.ts)
  const future = year > years[years.length - 1] && total > 0 ? futureDelta(league, 'foreign', year) : 0;
  // 자유 모드 규정 변경 (league/rules.ts)
  const regular = ruleOf(league, 'foreignRegular') ?? Math.max(0, total - asia0 + future);
  const asia = ruleOf(league, 'foreignAsia') ?? asia0;
  return { total: regular + asia, asia, regular };
}

/**
 * 외국인 구성 제한 (리그 규칙 1-6, D17): 2014~2019 외국인 보유 자리(아시아쿼터 제외)를 모두 투수 또는 모두 타자로 채울 수 없다
 * (자료집 제도연표 "외국인 보유·출전 (2014~2019) … 투수만·타자만 3명 불가"). 보유 한도가 4명인 창단 특례 구단은 같은 쪽 3명까지
 * (NC 2014 투수 3·타자 1). 그 밖의 해는 제한 없음
 */
export const FOREIGN_MIX_YEARS: readonly [number, number] = [2014, 2019];

/** 이 외국인(투수/타자)을 더해도 구성 제한을 지키는가. sameSide: 이미 있는 같은 쪽 일반 외국인 수, regular: 구단의 일반 외국인 보유 한도 */
export function foreignMixOk(year: number, regular: number, sameSide: number): boolean {
  if (year < FOREIGN_MIX_YEARS[0] || year > FOREIGN_MIX_YEARS[1] || regular < 2) return true;
  return sameSide + 1 <= regular - 1;
}

/** 창단 특례가 있는 창단 구단: 1군 첫해가 이 해 이후 (NC 2013부터. 빙그레·쌍방울은 지명 특례만 있었다, 자료집 제도연표 42) */
export const EXPANSION_PERK_FROM = 2013;
/** 창단 특례 기간: 1군 첫해부터 몇 시즌 */
export const EXPANSION_PERK_SEASONS = 2;

/**
 * 창단 특례 (신생팀 지원, 2026-10-23 사용자 결정 "빈 자료 물음 4"): 1군 첫 두 시즌 동안 외국인 보유·1군 +1명, 1군 엔트리 +1명,
 * 그 두 시즌 앞 오프시즌의 외부 FA 영입은 보상선수 없이 보상금만 (offseason.ts faCompRule).
 * 출처: kt 2015~2016 (자료집 제도연표 41, 출처 확인), NC 2013~2014 (나무위키 NC 다이노스/창단 과정·2014년, 원문 확인 2026-10-23).
 * 게임 안 창단 구단도 같은 규칙. year: 시즌 (오프시즌 판정은 다음 시즌 = off.year + 1)
 */
export function expansionPerk(league: Pick<LeagueState, 'expansions'>, team: number, year: number): boolean {
  return (league.expansions ?? []).some((e) => e.team === team && e.firstYear >= EXPANSION_PERK_FROM
    && year >= e.firstYear && year < e.firstYear + EXPANSION_PERK_SEASONS);
}

/** 구단별 외국인 보유 한도: 리그 한도 + 창단 특례 1명 (아시아쿼터 아닌 자리, 외국인 제도가 있는 해만) */
export function teamForeignRule(rule: ForeignRule, league: Pick<LeagueState, 'expansions'>, team: number, year: number): ForeignRule {
  if (rule.total === 0 || !expansionPerk(league, team, year)) return rule;
  return { total: rule.total + 1, asia: rule.asia, regular: rule.regular + 1 };
}

export type TeamChange =
  | { kind: 'rename'; team: number; from: string; to: string }
  | { kind: 'succeed'; team: number; from: string; to: string; franchise: string }
  | { kind: 'expand'; name: string; franchise: string };

/** 다음 시즌(year)에 일어나는 구단 변화. 자료가 없는 해는 빈 목록 */
export function teamChangesFor(store: Pick<DataStore, 'meta' | 'season'>, teams: LeagueTeam[], year: number): TeamChange[] {
  const real = store.season(year);
  if (!real) return [];
  const out: TeamChange[] = [];
  const byFranchise = new Map(real.teams.map((t) => [t.franchise, t.name]));
  const have = new Set(teams.map((t) => t.franchise));
  teams.forEach((t, i) => {
    const name = byFranchise.get(t.franchise);
    if (name !== undefined) {
      if (name !== t.name) out.push({ kind: 'rename', team: i, from: t.name, to: name });
      return;
    }
    const next = store.meta.successors[t.franchise];
    const nextName = next ? byFranchise.get(next) : undefined;
    if (next && nextName !== undefined && !have.has(next)) {
      out.push({ kind: 'succeed', team: i, from: t.name, to: nextName, franchise: next });
      have.add(next);
    }
    // 후속 구단이 없는 해체는 자료에 없다. 있다면 구단을 그대로 둔다 (선수단 유지)
  });
  for (const t of real.teams) if (!have.has(t.franchise)) out.push({ kind: 'expand', name: t.name, franchise: t.franchise });
  return out;
}

export function changeText(c: TeamChange): string {
  if (c.kind === 'rename') return `${c.from} → ${c.to} 구단 명칭 변경`;
  if (c.kind === 'succeed') return `${c.from}의 선수단을 ${c.to}가 승계`;
  return `${c.name} 창단`;
}

/**
 * 그 해(year)의 양대 리그 나눔 (일정 개편 기획안 10.2): 시즌 자료의 `league` 칸이 두 가지인 해(1999·2000 드림·매직)만,
 * 게임 구단을 계보로 자료 구단과 맞춘다. 다른 해·계보가 하나라도 안 맞는 리그는 null (단일 리그).
 * 저장하지 않는다: 연도 + 구단 계보 + 자료로 언제든 같은 값이 나온다
 */
export function divisionsFor(store: Pick<DataStore, 'season'>, year: number, teams: Pick<LeagueTeam, 'franchise'>[]): Divisions | null {
  return divisionsOf(store.season(year), teams.map((t) => t.franchise));
}
