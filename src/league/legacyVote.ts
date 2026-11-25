// 예전 구단 투표(단장 회의) 기록 읽기 (2026-10-23~11-11에만 있던 제도).
// 2026-11-12 사용자 결정으로 구단 투표를 뺐다: 미래 규칙 변경 ②는 결산 때 리그가 바로 정한다 (futureRules.ts judgeFutureRules).
// 이 파일은 예전 저장 호환만 맡는다:
//  - 리그 상태의 표결 기록(league.ruleVotes)과 규칙 변경의 표결 결과(RuleShift.vote)를 화면에 그대로 보이는 문구
//  - 단장 회의 단계(stage 'vote')에 멈춘 저장을 불러올 때, 저장된 AI 표와 우리 표(없으면 반대)로 개표하는 일 (offseason.ts settleLegacyVote)
// AI 표를 새로 계산하는 코드(옛 ai/vote.ts)와 큰 안건 자리는 지웠다.

import { FUTURE_RULE_LABEL, futureValueText, type FutureRuleKey, type RuleShift } from './futureRules';

/** 예전 저장의 우리 표 */
export type VoteChoice = 'yes' | 'no';

/** 예전 저장의 안건 하나. id = `${적용 연도}-${key}` (큰 안건은 꺼져 있어 생긴 적이 없다) */
export interface RuleAgenda {
  id: string;
  /** 가결되면 새 값이 적용되는 시즌 */
  year: number;
  key: FutureRuleKey;
  before: number;
  after: number;
  reason: string;
  signal: number;
}

/** 예전 개표 기록 (가결·부결 모두, league.ruleVotes) */
export interface RuleVoteRecord extends RuleAgenda {
  /** 구단별 표 (1 찬성 · 0 반대 · −1 표결권 없음) */
  votes: number[];
  yes: number;
  no: number;
  need: number;
  passed: boolean;
  /** 플레이어 구단 색인과 낸 표 (없으면 반대로 셌다). 모든 구단 AI면 없다 */
  userTeam?: number;
  user?: VoteChoice;
}

/** 단장 회의 단계에 멈춘 예전 저장의 오프시즌 칸 (OffseasonState.vote) */
export interface LegacyVoteStage {
  agendas: RuleAgenda[];
  /** 안건별 구단별 AI 표 (결산 직후 계산해 저장된 값) */
  ai: number[][];
  /** 안건 id → 우리 표 */
  user: Record<string, VoteChoice>;
  /** 예전 화면용 구단 지표 (읽지 않는다) */
  facts?: unknown;
}

/** 통과 문턱: 표결권 있는 구단의 2/3 (예전 결정 3) */
export function votesNeeded(n: number): number {
  return Math.ceil((n * 2) / 3 - 1e-9);
}

/** 개표: 플레이어 구단 칸은 우리 표로 (없으면 반대). userTeam < 0이면 모두 AI 표 */
export function countVotes(ai: number[], userTeam: number, user?: VoteChoice): { votes: number[]; yes: number; no: number; need: number; passed: boolean } {
  const votes = ai.map((v, t) => (v < 0 ? -1 : t === userTeam ? (user === 'yes' ? 1 : 0) : v));
  const yes = votes.filter((v) => v === 1).length;
  const no = votes.filter((v) => v === 0).length;
  const need = votesNeeded(yes + no);
  return { votes, yes, no, need, passed: yes >= need };
}

/** 안건 하나 개표: 기록과 (가결이면) 규칙 변경 */
export function tallyAgenda(a: RuleAgenda, ai: number[], userTeam: number, user?: VoteChoice): { record: RuleVoteRecord; shift: RuleShift | null } {
  const c = countVotes(ai, userTeam, user);
  const record: RuleVoteRecord = { ...a, ...c, ...(userTeam >= 0 ? { userTeam, ...(user ? { user } : {}) } : {}) };
  const shift: RuleShift | null = c.passed
    ? { year: a.year, key: a.key, before: a.before, after: a.after, reason: a.reason, signal: a.signal,
      vote: { yes: c.yes, no: c.no, need: c.need, ...(userTeam >= 0 ? { user: user ?? 'no' } : {}) } }
    : null;
  return { record, shift };
}

/** 안건 이름과 전 → 후: "샐러리캡 연간 상향률 연 5% → 연 7%" */
export function voteAgendaText(v: Pick<RuleAgenda, 'key' | 'before' | 'after'>): string {
  const k = v.key;
  return `${FUTURE_RULE_LABEL[k] ?? k} ${futureValueText(k, v.before)} → ${futureValueText(k, v.after)}`;
}

/** 표결 결과 한 줄: "단장 회의 찬성 7 : 반대 3 가결 (문턱 7, 우리 구단 반대)". user가 없으면 모든 구단 AI */
export function voteResultText(v: { yes: number; no: number; need: number; user?: VoteChoice; userTeam?: number }, passed: boolean): string {
  const mine = v.user ? `, 우리 구단 ${v.user === 'yes' ? '찬성' : '반대'}` : v.userTeam !== undefined ? ', 우리 구단 반대 (표를 내지 않음)' : '';
  return `단장 회의 찬성 ${v.yes} : 반대 ${v.no} ${passed ? '가결' : '부결'} (문턱 ${v.need}${mine})`;
}

/** 개표 소식 (예전 저장을 불러올 때 자동 개표) */
export function tallyText(r: RuleVoteRecord, teamName: (t: number) => string): string {
  const side = (v: number) => r.votes.map((x, t) => (x === v ? t : -1)).filter((t) => t >= 0)
    .map((t) => (t === r.userTeam ? `(우리) ${teamName(t)}` : teamName(t))).join(' · ') || '없음';
  const what = r.passed ? `${r.year} 시즌부터 ${voteAgendaText(r)}.` : `규칙은 그대로 (${futureValueText(r.key, r.before)}).`;
  return `지난 단장 회의 자동 개표 (구단 투표는 없어졌습니다, 게임 속 가상 결정): ${voteResultText(r, r.passed)}. ${what} 찬성 ${side(1)} / 반대 ${side(0)}`;
}
