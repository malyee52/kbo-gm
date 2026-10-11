// 역사와 서사 1단계: 규칙으로 만드는 기사 (docs/roadmap.md 3.4, 2026-10-11).
// 실존 선수는 기록 사실만 쓴다 (인물평·사생활 없음). 기사는 리그 상태에 최근 ARTICLE_KEEP건까지 남는다.

import type { LeagueState } from './types';

export type ArticleKind = 'milestone' | 'record' | 'streak' | 'title' | 'award' | 'retire' | 'scenario' | 'trade' | 'overseas';
export const ARTICLE_LABEL: Record<ArticleKind, string> = {
  milestone: '통산 기록', record: '신기록', streak: '연승·연패', title: '우승', award: '시상', retire: '은퇴', scenario: '시나리오', trade: '트레이드', overseas: '해외',
};

export interface Article {
  year: number;
  /** 일정 색인 (시즌 밖이면 -1) */
  day: number;
  kind: ArticleKind;
  title: string;
  body: string;
  /** 관련 구단 계보 (우리 구단 거르기) */
  franchise?: string;
}

export const ARTICLE_KEEP = 400;

export function addArticle(league: LeagueState, a: Article): void {
  league.articles ??= [];
  league.articles.push(a);
  if (league.articles.length > ARTICLE_KEEP) league.articles.splice(0, league.articles.length - ARTICLE_KEEP);
}

/** 통산 마일스톤 (지난 값 < 기준 ≤ 지금 값이면 기사) */
export const MILESTONES: { key: 'h' | 'hr' | 'w' | 'sv' | 'so'; label: string; unit: string; every: number; from: number }[] = [
  { key: 'hr', label: '통산', unit: '홈런', every: 100, from: 100 },
  { key: 'h', label: '통산', unit: '안타', every: 500, from: 1000 },
  { key: 'w', label: '통산', unit: '승', every: 50, from: 100 },
  { key: 'sv', label: '통산', unit: '세이브', every: 100, from: 100 },
  { key: 'so', label: '통산', unit: '탈삼진', every: 500, from: 1000 },
];

/** prev → now 사이에 넘은 기준값들 */
export function crossed(prev: number, now: number, every: number, from: number): number[] {
  const out: number[] = [];
  for (let t = Math.max(from, Math.ceil((prev + 1) / every) * every); t <= now; t += every) out.push(t);
  return out;
}

/** 연승·연패 기사를 낼 길이 (이 값부터, 그 뒤 2경기마다) */
export const STREAK_FROM = 8;

/** 마지막 글자 받침 여부 (한글, 숫자, 영문 이름 끝 글자 읽기) */
function hasBatchim(word: string): boolean {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch); // 영·일·삼·육·칠·팔은 받침, 이·사·오·구는 없음
  return /[LMNRlmnr]/.test(ch); // 엘·엠·엔·알
}

/** 조사 붙이기: josa('LG', '이', '가') → 'LG가' */
export function josa(word: string, withB: string, withoutB: string): string {
  return word + (hasBatchim(word) ? withB : withoutB);
}
