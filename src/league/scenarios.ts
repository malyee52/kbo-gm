// 역사 시나리오: 구단별 "아픈 손가락" (2026-10-11 사용자 요청).
//
// 실제로 우승 문턱에서 멈춘 시즌의 개막에서, 그 구단 단장으로 시작한다. 목표는 그 해 한국시리즈 우승.
// 실제 결과는 시즌 자료의 최종 순위(우승 1위, 준우승 2위)로 확인한 것만 쓴다. 인물평·사건 묘사는 넣지 않는다.
// 시나리오가 끝나면(결산) 성공·실패를 알리고, 그대로 이어서 할 수 있다.

import type { LeagueState } from './types';

export interface Scenario {
  id: string;
  year: number;
  /** 그 해 구단 이름 (시즌 자료) */
  team: string;
  title: string;
  /** 시작 소개 */
  intro: string;
  /** 실제로는 어떻게 됐나 */
  real: string;
  /** 목표: 그 해 한국시리즈 우승 */
  goal: 'champion';
}

export const SCENARIOS: Scenario[] = [
  { id: 'sk-2009', year: 2009, team: 'SK', title: '3연패에 도전하라',
    intro: '2007·2008년 한국시리즈를 연달아 제패한 SK. 세 번째 우승에 도전한다.',
    real: '실제 2009년: 정규시즌 80승 47패 6무, 한국시리즈 준우승 (우승 KIA).', goal: 'champion' },
  { id: 'doosan-2018', year: 2018, team: '두산', title: '완벽을 증명하라',
    intro: '93승을 거둔 두산. 정규시즌의 압도적인 성적을 한국시리즈 우승으로 마무리한다.',
    real: '실제 2018년: 정규시즌 93승 51패, 한국시리즈 준우승 (우승 SK).', goal: 'champion' },
  { id: 'nexen-2014', year: 2014, team: '넥센', title: '넥벤져스, 마지막 퍼즐',
    intro: '"넥벤져스"라 불린 강타선의 넥센. 꽃을 피울 마무리는 우승뿐이다.',
    real: '실제 2014년: 정규시즌 78승 48패 2무, 한국시리즈 준우승 (우승 삼성, 4년 연속).', goal: 'champion' },
  { id: 'lg-2002', year: 2002, team: 'LG', title: '신바람을 다시',
    intro: '1994년 이후 우승이 없는 LG. 다시 한국시리즈 정상에 선다.',
    real: '실제 2002년: 한국시리즈 준우승 (우승 삼성).', goal: 'champion' },
  { id: 'hanwha-2006', year: 2006, team: '한화', title: '두 번째 별을 향해',
    intro: '1999년 첫 우승 뒤 두 번째 우승에 도전하는 한화.',
    real: '실제 2006년: 정규시즌 67승 57패 2무, 한국시리즈 준우승 (우승 삼성).', goal: 'champion' },
  { id: 'lotte-1999', year: 1999, team: '롯데', title: '세 번째 우승',
    intro: '드림리그 1위의 롯데. 1984·1992년에 이어 세 번째 우승을 노린다.',
    real: '실제 1999년: 드림리그 1위 (75승 52패 5무), 한국시리즈 준우승 (우승 한화).', goal: 'champion' },
  { id: 'samsung-2015', year: 2015, team: '삼성', title: '5년 연속 우승',
    intro: '2011년부터 4년 연속 우승한 삼성. 다섯 번째 연속 우승에 도전한다.',
    real: '실제 2015년: 정규시즌 88승 56패, 한국시리즈 준우승 (우승 두산).', goal: 'champion' },
  { id: 'nc-2016', year: 2016, team: 'NC', title: '첫 우승을 향해',
    intro: '1군 4년째의 NC. 창단 첫 한국시리즈 우승에 도전한다.',
    real: '실제 2016년: 정규시즌 83승 58패 3무, 한국시리즈 준우승 (우승 두산).', goal: 'champion' },
  { id: 'kt-2023', year: 2023, team: 'KT', title: '다시 정상으로',
    intro: '2021년 첫 우승 뒤 두 번째 우승에 도전하는 KT.',
    real: '실제 2023년: 정규시즌 79승 62패 3무, 한국시리즈 준우승 (우승 LG).', goal: 'champion' },
  { id: 'kia-2025', year: 2025, team: 'KIA', title: '리핏에 도전하라',
    intro: '2024년 87승으로 통합 우승을 차지한 KIA. 2연패에 도전한다.',
    real: '실제 2025년: 65승 75패 4무, 최종 8위 (우승 LG).', goal: 'champion' },
];

export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id);

/** 리그 상태에 남는 시나리오 진행 */
export interface ScenarioState {
  id: string;
  year: number;
  team: number;
  result?: 'success' | 'fail';
}

/** 결산 때 판정한다. 이미 판정했으면 그대로 */
export function judgeScenario(league: LeagueState, year: number, champion: number | null): ScenarioState | null {
  const s = league.scenario;
  if (!s || s.result || s.year !== year) return s ?? null;
  s.result = champion === s.team ? 'success' : 'fail';
  return s;
}
