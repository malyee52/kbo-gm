// 시대별 제도와 구단 변화 (M8, 기획서 4장).
//
// - 제도 스위치: FA(1999 시즌 뒤 도입), 외국인 한도(meta.rules의 연도별 값), 샐러리캡(salary.ts의 salaryCap). 출처 확인된 연도는 기획서 4.2.
// - 구단 변화: 다음 해 실제 시즌 자료의 구단 목록과 지금 리그의 구단을 계보(franchise)로 견줘 명칭 변경·승계·창단을 찾는다.
//   매각·명칭 변경은 이름만 바꾸고, 해체 구단은 후속 구단이 선수단을 승계하며(쌍방울→SK, 현대→히어로즈), 창단은 새 구단 자리를 만든다.
//   자료가 없는 해(2027년 이후)는 변화가 없다.

import type { DataStore, Meta } from '../data/types';
import type { LeagueTeam } from './types';
import { ruleOf } from './rules';
import { futureDelta } from './futureRules';
import type { LeagueState } from './types';

/** FA 제도가 있는 오프시즌인가 (1999 시즌 뒤부터, 기획서 4.2 출처 확인) */
export function faEnabled(offseasonYear: number): boolean {
  return offseasonYear >= 1999;
}

/**
 * FA 자격에 필요한 1군 연차: 도입 당시 10년, 2001~2010 시즌 뒤 9년 (대졸도 9년, 조사값), 2011 시즌 뒤부터 9년·대졸 8년
 * (자료집 "2012년 FA부터 대졸 8·고졸 9"), 2022년 시즌 뒤부터 8년·대졸 7년 (자료집 확인). 도입 당시 10년은 자료집 확인.
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
