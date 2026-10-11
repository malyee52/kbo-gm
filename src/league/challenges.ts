// 도전 모드: 목표형 시작 (docs/roadmap.md 2장 "자유 진행 외에 목표형 도전 모드", 2026-10-11).
//
// 역사 시나리오와 같은 틀이지만 시작 연도를 고를 수 있고, 목표가 여러 시즌에 걸친다.
// 결산 때마다 판정하고, 기한이 지나거나 조건이 깨지면 실패. 성공·실패 뒤에도 그대로 이어서 할 수 있다.

import type { DataStore } from '../data/types';
import type { LeagueState } from './types';

export type ChallengeKind = 'title' | 'streak' | 'thrift' | 'first';

export interface Challenge {
  id: string;
  title: string;
  intro: string;
  kind: ChallengeKind;
  /** 기한 (시즌 수, 시작 시즌 포함) */
  years: number;
  /** 목표 수 (연속 우승 횟수, 가을야구 횟수) */
  target?: number;
  /** 'last' = 직전 시즌 꼴찌 구단으로 시작 */
  team?: 'last';
}

export const CHALLENGES: Challenge[] = [
  { id: 'underdog', title: '꼴찌의 반란', intro: '직전 시즌 최하위 구단을 맡아 5시즌 안에 한국시리즈 우승.', kind: 'title', years: 5, team: 'last' },
  { id: 'last-to-first', title: '꼴찌에서 1위로', intro: '직전 시즌 최하위 구단으로 2시즌 안에 정규시즌 1위.', kind: 'first', years: 2, team: 'last' },
  { id: 'quick', title: '3년 안에 정상', intro: '고른 구단으로 3시즌 안에 한국시리즈 우승.', kind: 'title', years: 3 },
  { id: 'dynasty', title: '왕조를 세워라', intro: '고른 구단으로 10시즌 안에 한국시리즈 3년 연속 우승.', kind: 'streak', years: 10, target: 3 },
  { id: 'thrift', title: '적자 없는 강팀', intro: '고른 구단으로 5시즌 동안 모기업 긴급 지원 없이 가을야구 3번.', kind: 'thrift', years: 5, target: 3 },
];

export const challengeById = (id: string): Challenge | undefined => CHALLENGES.find((c) => c.id === id);

/** 리그 상태에 남는 도전 진행 */
export interface ChallengeState {
  id: string;
  team: number;
  from: number;
  /** 마지막 시즌 (이 시즌 결산까지) */
  until: number;
  /** 지금까지: 우승, 지금 연속 우승, 가을야구, 정규시즌 1위 */
  titles: number;
  streak: number;
  postseasons: number;
  firsts: number;
  result?: 'success' | 'fail';
  /** 판정한 시즌 */
  doneYear?: number;
  /** 실패 까닭 */
  why?: string;
}

export function newChallenge(c: Challenge, team: number, from: number): ChallengeState {
  return { id: c.id, team, from, until: from + c.years - 1, titles: 0, streak: 0, postseasons: 0, firsts: 0 };
}

/** 직전 시즌 최하위 구단의 그 해 색인 (최종 순위 기준). 직전 시즌 자료가 없으면 null */
export function lastPlaceTeam(store: Pick<DataStore, 'season'>, year: number): number | null {
  const prev = store.season(year - 1);
  const cur = store.season(year);
  if (!prev || !cur) return null;
  const worst = [...prev.teams].sort((a, b) => b.rank - a.rank || a.pct - b.pct)[0];
  const t = cur.teams.findIndex((x) => x.franchise === worst.franchise);
  return t >= 0 ? t : null;
}

export interface SeasonOutcomeForChallenge {
  /** 지금 맡은 구단 (해고·이직하면 달라진다) */
  userTeam: number;
  champion: number | null;
  /** 정규시즌 1위 */
  first: number | null;
  /** 가을야구 진출 구단 */
  postseason: number[];
  /** 그 구단이 이번 결산에서 받은 모기업 긴급 지원 (만 원) */
  rescue: number;
}

/** 결산 때 판정한다. 이미 끝났으면 그대로 */
export function judgeChallenge(league: LeagueState, year: number, o: SeasonOutcomeForChallenge): ChallengeState | null {
  const s = league.challenge;
  if (!s || s.result || year < s.from) return s ?? null;
  const def = challengeById(s.id);
  if (!def) return s;
  const end = (result: 'success' | 'fail', why?: string) => { s.result = result; s.doneYear = year; if (why) s.why = why; };
  if (o.userTeam !== s.team) { end('fail', '도전 구단을 떠났습니다'); return s; }

  const won = o.champion === s.team;
  if (won) s.titles++;
  s.streak = won ? s.streak + 1 : 0;
  if (o.postseason.includes(s.team)) s.postseasons++;
  if (o.first === s.team) s.firsts++;

  switch (def.kind) {
    case 'title': if (won) end('success'); break;
    case 'first': if (o.first === s.team) end('success'); break;
    case 'streak': if (s.streak >= (def.target ?? 3)) end('success'); break;
    case 'thrift':
      if (o.rescue > 0) { end('fail', '모기업 긴급 지원을 받았습니다'); break; }
      if (year >= s.until && s.postseasons >= (def.target ?? 3)) end('success');
      else if (s.postseasons + (s.until - year) < (def.target ?? 3)) end('fail', '남은 시즌으로는 가을야구 횟수를 채울 수 없습니다');
      break;
  }
  // 연속 우승은 남은 시즌으로 못 채우면 일찍 끝낸다
  if (!s.result && def.kind === 'streak' && s.streak + (s.until - year) < (def.target ?? 3)) end('fail', '남은 시즌으로는 연속 우승을 채울 수 없습니다');
  if (!s.result && year >= s.until) end('fail', '기한이 지났습니다');
  return s;
}

/** 진행 한 줄 (화면용) */
export function challengeProgress(s: ChallengeState, year: number): string {
  const def = challengeById(s.id);
  if (!def) return '';
  const left = Math.max(0, s.until - year + 1);
  const tail = s.result ? '' : ` · 남은 시즌 ${left} (${s.until}년까지)`;
  switch (def.kind) {
    case 'title': return `우승 ${s.titles}회${tail}`;
    case 'first': return `정규시즌 1위 ${s.firsts}회${tail}`;
    case 'streak': return `지금 연속 우승 ${s.streak} / ${def.target}${tail}`;
    case 'thrift': return `가을야구 ${s.postseasons} / ${def.target}, 긴급 지원 없음${tail}`;
  }
}
