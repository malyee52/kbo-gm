// 해외 진출과 복귀 (docs/roadmap.md 1장 E3, 2026-10-12 사용자 요청 "해외파 복귀").
//
// 1) 시작 때 해외에 있던 실존 선수: 시작 연도에 KBO 기록이 없고(군 복무 아님), 마지막 KBO 시즌에 주전이었던 선수.
//    - 시작 뒤 KBO 기록이 있으면 그 해(실제 복귀 해)에 돌아온다 (류현진 2024, 김광현 2022, ...)
//    - 자료 안에서 돌아오지 않았으면(예: 2026 시작의 김하성·이정후) 나이에 따라 해마다 확률로 돌아온다
// 2) 게임 안 해외 진출: 오프시즌마다 KBO 연차 7시즌 이상의 정상급 선수가 포스팅을 요청한다(AI 구단은 스스로 판단, 우리 구단은 플레이어가 결정,
//    보내면 포스팅 이적료). 정상급 FA 일부는 국내 FA 대신 해외로 간다.
// 복귀: 포스팅으로 나간 선수는 원 소속 구단으로(보류권), FA로 나간 선수는 FA 시장으로(보상 없음).
// 해외에 있는 동안 리그 명단에 남고(team = ABROAD) 나이·성장은 계속된다(출전 몫 1.0).
// 실존 선수의 해외 경력은 리그·구단 이름 없이 "해외"로만 쓴다 (사실 판단을 넣지 않는다).

import { Rng } from '../engine';
import type { LeaguePlayer, LeagueState } from './types';

/** 해외에 있는 선수의 team 값 */
export const ABROAD = -2;
/** 떠나기 전 KBO 연차가 이만큼이면 FA로 나간 것으로 본다 (실제 사례로 맞춘 임시 기준) */
export const FA_DEPARTURE_SEASONS = 9;
/** 포스팅을 요청할 수 있는 KBO 연차 (KBO 규정 7시즌) */
export const POSTING_SERVICE = 7;
/** 포스팅 이적료 (만 원): 현재 가치 런 × 단가, 30억~150억 (임시값) */
export const POSTING_FEE_PER_RUN = 40_000;
export const POSTING_FEE_MIN = 300_000;
export const POSTING_FEE_MAX = 1_500_000;
/**
 * 정상급 선수 한 명이 한 해에 포스팅을 요청할 확률. 2026-10-12 실제 자료로 맞춤: 2012~2026년 해외 진출 15명(한 해 약 1명, KNOWN_OVERSEAS).
 * 0.1이면 게임에서 한 해 0.55명, 0.25면 0.97명 (2026 시작 15시즌, 2시드)
 */
export const POSTING_CHANCE = 0.25;
/** 한 해 해외 진출 상한 (리그 전체, 임시값) */
export const DEPARTURES_PER_YEAR = 2;
/** 해외에서 이 나이(다음 시즌 나이)가 되면 은퇴로 본다 */
export const ABROAD_RETIRE_AGE = 39;

export interface AbroadState {
  /** 해외로 간 첫 시즌 */
  since: number;
  /** 원 소속 구단 (리그 색인, 없으면 −1) */
  origin: number;
  mode: 'posting' | 'fa';
  /** 실제 복귀 해 (자료로 아는 경우) */
  returnYear?: number;
}

export const isAbroad = (p: Pick<LeaguePlayer, 'team'>) => p.team === ABROAD;

/**
 * KBO에서 뛰다 해외 리그로 간 적이 있는 실존 선수 (이름, 출생 연도, 해외로 간 첫 시즌). 자료에는 해외 경력이 없어, 기록 공백이 해외 때문인지
 * 군 복무·부상 때문인지 가릴 수 없다. 그래서 명단만 두고, 떠난 해·돌아온 해·돌아온 구단은 모두 KBO 기록에서 읽는다 (create.ts).
 * 명단에 없거나 기록에서 찾지 못하면 그냥 건너뛴다 (2026-10-12, 널리 알려진 사례 위주. 빠진 선수는 추가하면 된다)
 */
export const KNOWN_OVERSEAS: [name: string, birthYear: number, leftFor: number][] = [
  ['이상훈', 1971, 1998], ['이종범', 1970, 1998], ['정민철', 1972, 2000], ['정민태', 1970, 2001], ['구대성', 1969, 2001],
  ['이승엽', 1976, 2004], ['이병규', 1974, 2007], ['임창용', 1976, 2008], ['이혜천', 1979, 2009], ['김태균', 1982, 2010],
  ['이대호', 1982, 2012], ['류현진', 1987, 2013], ['오승환', 1982, 2014], ['윤석민', 1986, 2014], ['강정호', 1987, 2015],
  ['박병호', 1986, 2016], ['김현수', 1988, 2016], ['황재균', 1987, 2017], ['김광현', 1988, 2020], ['양현종', 1988, 2021],
  ['김하성', 1995, 2021], ['이정후', 1998, 2024], ['고우석', 1998, 2024], ['김혜성', 1999, 2025], ['송성문', 1996, 2026],
];

export function postingFee(runs: number): number {
  return Math.round(Math.max(POSTING_FEE_MIN, Math.min(POSTING_FEE_MAX, runs * POSTING_FEE_PER_RUN)) / 1000) * 1000;
}

/** 해외로 보낸다 */
export function sendAbroad(p: LeaguePlayer, since: number, origin: number, mode: AbroadState['mode']): void {
  p.team = ABROAD;
  p.abroad = { since, origin, mode };
}

/**
 * 이 오프시즌(다음 시즌 year)에 돌아오나. 자료로 아는 복귀 해가 있으면 그대로, 아니면 다음 시즌 나이에 따라
 * (34세+ 45%, 31~33세 25%, 그 밖 8%, 떠난 지 2시즌이 안 됐으면 0). ABROAD_RETIRE_AGE면 'retire'
 */
export function returnDecision(league: Pick<LeagueState, 'seed'>, p: LeaguePlayer, year: number): 'return' | 'stay' | 'retire' {
  const a = p.abroad!;
  const age = p.birthYear ? year - p.birthYear : 30;
  if (a.returnYear !== undefined) return year >= a.returnYear ? 'return' : age >= ABROAD_RETIRE_AGE ? 'retire' : 'stay';
  if (age >= ABROAD_RETIRE_AGE) return 'retire';
  if (year - a.since < 2) return 'stay';
  const chance = age >= 34 ? 0.45 : age >= 31 ? 0.25 : 0.08;
  return new Rng(`${league.seed}/abroad-return/${year}/${p.id}`).chance(chance) ? 'return' : 'stay';
}
