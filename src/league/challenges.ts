// 도전 모드: 목표형 시작 (docs/roadmap.md 2장 "자유 진행 외에 목표형 도전 모드", 2026-10-11).
//
// 역사 시나리오와 같은 틀이지만 시작 연도를 고를 수 있고, 목표가 여러 시즌에 걸친다.
// 결산 때마다 판정하고, 기한이 지나거나 조건이 깨지면 실패. 성공·실패 뒤에도 그대로 이어서 할 수 있다.
// 2026-10-12: 사용자 기획안의 시즌 도전 30개·장기 캠페인 10개(campaigns.ts)를 kind 'plan'으로 더했다. 구단·시작 시즌이 정해져 있다.

import type { DataStore } from '../data/types';
import type { LeagueState } from './types';
import { lastYear, PLAN_CHALLENGES, STAGE_STATUS, stageStatus, type PlanChallenge, type SeasonMark, type StageStatus } from './campaigns';

export type ChallengeKind = 'title' | 'streak' | 'thrift' | 'first' | 'plan';

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
  /** 기획안 도전 (campaigns.ts): 구단·시작 시즌·단계 목표 */
  plan?: PlanChallenge;
}

/**
 * 예전 도전 모드 5개 (2026-10-12 사용자 요청으로 시작 화면에서 뺐다). 이 도전으로 시작한 예전 저장의 판정을 위해 정의는 남긴다
 */
export const LEGACY_CHALLENGE_IDS = ['underdog', 'last-to-first', 'quick', 'dynasty', 'thrift'];

export const CHALLENGES: Challenge[] = [
  { id: 'underdog', title: '꼴찌의 반란', intro: '직전 시즌 최하위 구단을 맡아 5시즌 안에 한국시리즈 우승.', kind: 'title', years: 5, team: 'last' },
  { id: 'last-to-first', title: '꼴찌에서 1위로', intro: '직전 시즌 최하위 구단으로 2시즌 안에 정규시즌 1위.', kind: 'first', years: 2, team: 'last' },
  { id: 'quick', title: '3년 안에 정상', intro: '고른 구단으로 3시즌 안에 한국시리즈 우승.', kind: 'title', years: 3 },
  { id: 'dynasty', title: '왕조를 세워라', intro: '고른 구단으로 10시즌 안에 한국시리즈 3년 연속 우승.', kind: 'streak', years: 10, target: 3 },
  { id: 'thrift', title: '적자 없는 강팀', intro: '고른 구단으로 5시즌 동안 모기업 긴급 지원 없이 가을야구 3번.', kind: 'thrift', years: 5, target: 3 },
];

// 기획안 도전: 소개 문구는 최종 목표
for (const p of PLAN_CHALLENGES) {
  CHALLENGES.push({ id: p.id, title: p.title, intro: p.stages.at(-1)!.label, kind: 'plan', years: lastYear(p) - p.year + 1, plan: p });
}

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
  // ---- 기획안 도전 (kind 'plan')
  /** 시즌마다 남긴 우리 구단 결과 */
  marks?: SeasonMark[];
  /** 단계별 상태 (0 진행, 1 달성, 2 실패). 마지막이 최종 조건 */
  stages?: StageStatus[];
  /** 자체 육성 후보: 시작 때 만 23세 이하 우리 선수 + 그 뒤 우리가 지명한 선수 (선수 ID) */
  homegrown?: string[];
  /** 모든 단계를 기한 안에 달성 (완전 클리어) */
  complete?: boolean;
}

export function newChallenge(c: Challenge, team: number, from: number, homegrown: string[] = []): ChallengeState {
  const base: ChallengeState = { id: c.id, team, from, until: from + c.years - 1, titles: 0, streak: 0, postseasons: 0, firsts: 0 };
  if (c.kind !== 'plan' || !c.plan) return base;
  return { ...base, marks: [], stages: c.plan.stages.map(() => 0 as StageStatus), homegrown: [...homegrown] };
}

/** 기획안 도전의 시작 구단 색인 (그 해 자료에서 계보로 찾는다) */
export function planTeam(store: Pick<DataStore, 'season'>, c: Challenge): number | null {
  if (!c.plan) return null;
  const t = store.season(c.plan.year)?.teams.findIndex((x) => x.franchise === c.plan!.franchise) ?? -1;
  return t >= 0 ? t : null;
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
  /** 기획안 도전: 이번 시즌 우리 구단 결과 */
  mark?: SeasonMark;
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
    case 'plan': {
      if (!o.mark || !s.stages || !def.plan) break;
      (s.marks ??= []).push(o.mark);
      const stages = def.plan.stages;
      stages.forEach((st, i) => { if (s.stages![i] === 0) s.stages![i] = stageStatus(st, s.marks!, year); });
      const fin = s.stages[stages.length - 1];
      if (fin === 1) { s.complete = s.stages.every((x) => x === 1); end('success'); }
      else if (fin === 2) end('fail', `최종 목표를 더는 이룰 수 없습니다 (${stages.at(-1)!.label})`);
      break;
    }
    case 'thrift':
      if (o.rescue > 0) { end('fail', '모기업 긴급 지원을 받았습니다'); break; }
      if (year >= s.until && s.postseasons >= (def.target ?? 3)) end('success');
      else if (s.postseasons + (s.until - year) < (def.target ?? 3)) end('fail', '남은 시즌으로는 가을야구 횟수를 채울 수 없습니다');
      break;
  }
  // 연속 우승은 남은 시즌으로 못 채우면 일찍 끝낸다
  if (!s.result && def.kind === 'streak' && s.streak + (s.until - year) < (def.target ?? 3)) end('fail', '남은 시즌으로는 연속 우승을 채울 수 없습니다');
  if (!s.result && year >= s.until && def.kind !== 'plan') end('fail', '기한이 지났습니다');
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
    case 'plan': {
      const st = def.plan?.stages ?? [];
      const parts = st.map((_, i) => `${i === st.length - 1 ? '최종' : `${i + 1}단계`} ${STAGE_STATUS[s.stages?.[i] ?? 0]}`);
      return `${parts.join(' · ')}${s.result === 'success' ? (s.complete ? ' · 완전 클리어' : ' · 클리어') : ''}${tail}`;
    }
  }
}

/** 기획안 도전의 연봉 상한 (만 원): 리그 평균 연봉(캡 계산 기준)의 비율. 해당 없으면 null */
export function challengeBudget(league: LeagueState, team: number, year: number, payrollOf: (t: number) => number): number | null {
  const s = league.challenge;
  const ratio = s && !s.result && s.team === team && year <= s.until ? challengeById(s.id)?.plan?.budget : undefined;
  if (!ratio) return null;
  const teams = league.teams.map((_, t) => t).filter((t) => payrollOf(t) > 0);
  const avg = teams.reduce((a, t) => a + payrollOf(t), 0) / Math.max(1, teams.length);
  return Math.round(avg * ratio);
}
