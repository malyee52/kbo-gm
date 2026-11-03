// 구단주 예산 회의 (재정 2 F4b, docs/재정2_기획안.md 4.7, 결정 Q5): 오프시즌 마지막 단계 'meeting' (개막 준비 앞).
// 규칙 기반 (LLM 아님, 난수 없음). 요청 하나 → 판정 점수 → 수락·조건부(목표 한 단계 상향이면)·거절.
// 목표는 개막 때 정하는 목표 위에 goalShift로 얹고, 신뢰도 변화는 시즌 평가 때 더한다.
// 판타지 면담(OwnerMeeting.tsx, LLM)은 따로: 그 효과는 판타지 효과 목록으로만 남고 이 회의 돈과 겹치지 않는다.
// 수치는 모두 임시값.
import type { World } from '../engine';
import { cashOf, ensureFinance, financePlan, PARENT_BASE } from './finance';
import { gmStyle } from './gm';
import { parentGrade, type GoalKind } from './owner';
import { wageIndex } from './salary';
import type { LeagueState } from './types';

export type OwnerAsk = 'none' | 'money' | 'faCap' | 'lowerGoal' | 'raiseGoal';
export const OWNER_ASKS: OwnerAsk[] = ['none', 'money', 'faCap', 'lowerGoal', 'raiseGoal'];
export const ASK_LABEL: Record<OwnerAsk, string> = {
  none: '요청 없음', money: '운영 자금 증액', faCap: 'FA 계약금 지원 한도 상향', lowerGoal: '목표 낮추기', raiseGoal: '목표 높이기 약속',
};
export const ASK_NOTE: Record<OwnerAsk, string> = {
  none: '신뢰도 +1 (검소한 단장)',
  money: '이번 시즌 모기업 추가 지원 (판정)',
  faCap: '다음 FA 때 모기업 계약금 지원 한도 1.5배 (판정)',
  lowerGoal: '이번 시즌 목표 한 단계 아래, 신뢰도 −4, 달성해도 신뢰도 증가 절반',
  raiseGoal: '운영 자금 증액과 같은 돈, 판정 없이 수락. 이번 시즌 목표 한 단계 위',
};

/** 판정 문턱 (점수 ≥ ACCEPT 수락, ≥ CONDITIONAL 조건부, 아래는 거절) */
export const MEETING_ACCEPT = 60;
export const MEETING_CONDITIONAL = 45;
/** 점수 가감: 지난 시즌 목표 달성 ±10, 모기업 등급 A +10·C −10, 부채 −15, 3년 안 같은 요청 −10 */
export const SCORE_GOAL = 10;
export const SCORE_GRADE = { A: 10, B: 0, C: -10 } as const;
export const SCORE_DEBT = 15;
export const SCORE_REPEAT = 10;
export const REPEAT_YEARS = 3;
/** 운영 자금 증액: 등급 기본액 × 25%, C 등급은 15억 원 고정 (2026년 돈) */
export const MONEY_SHARE = 0.25;
export const MONEY_C = 150_000;
/** FA 계약금 지원 한도 배율 */
export const FA_CAP_SCALE = 1.5;
/** 신뢰도: 요청 없음 +1, 거절 −2, 목표 낮추기 −4, 예산 초과를 그대로 넘김 −3 */
export const TRUST_NONE = 1;
export const TRUST_REJECT = -2;
export const TRUST_LOWER = -4;
export const TRUST_BUDGET = -3;
/** 모기업 한도: 예상 수지가 −(자금 × 이 값)보다 나쁘면 구단주가 "줄여 오라" */
export const BUDGET_CASH_SHARE = 0.3;
/** AI 판정에 쓰는 신뢰도 (AI 구단은 신뢰도가 없다) */
export const AI_TRUST = 50;

export type MeetingResult = 'none' | 'accepted' | 'conditional' | 'accepted-cond' | 'declined' | 'rejected' | 'promised' | 'lowered';
export const RESULT_LABEL: Record<MeetingResult, string> = {
  none: '요청 없음', accepted: '수락', conditional: '조건부 (답 기다림)', 'accepted-cond': '조건부 수락 (목표 상향)', declined: '조건 거절',
  rejected: '거절', promised: '목표 상향 약속', lowered: '목표 낮춤',
};

export interface MeetingRecord {
  /** 회의 결과가 걸리는 시즌 (오프시즌 연도 + 1) */
  year: number;
  ask: OwnerAsk;
  result: MeetingResult;
  /** 판정 점수 (돈 요청 둘만) */
  score?: number;
  /** 이번 시즌 목표 이동 (−1·0·+1) */
  goalShift: -1 | 0 | 1;
  /** 시즌 평가 때 더할 신뢰도 */
  trust: number;
  /** 모기업 추가 지원 (그 해 돈, 장부 parentExtra) */
  money?: number;
  /** FA 계약금 지원 한도 배율이 걸리는 장부 연도 (다음 오프시즌 FA) */
  faCapYear?: number;
  /** 목표를 낮춰 달성해도 신뢰도 증가 절반 */
  halfGain?: true;
  /** 예산 초과를 그대로 넘겨 신뢰도 −3 */
  overBudget?: true;
  /** 구단주가 말한 이유 한 줄 */
  reason: string;
}

export interface MeetingInput {
  trust: number;
  /** 지난 시즌 목표 달성 (true·false), 모름(AI·첫 시즌) null */
  achieved: boolean | null;
}

/** 그 시즌 회의 기록 */
export function meetingOf(league: Pick<LeagueState, 'finance'>, team: number, year: number): MeetingRecord | undefined {
  return league.finance?.[team]?.meetings?.find((m) => m.year === year);
}

/** 부채가 있나 (재정 2 F5에서 채움. 지금은 칸이 없으면 없음) */
const hasDebt = (league: LeagueState, team: number) => {
  const d = (league.finance?.[team] as { debt?: { amount?: number } } | undefined)?.debt;
  return !!d && (d.amount ?? 0) > 0;
};

/** 판정 점수와 이유. ask는 돈 요청(money·faCap) */
export function askScore(league: LeagueState, team: number, year: number, ask: OwnerAsk, input: MeetingInput): { score: number; parts: [string, number][] } {
  const parts: [string, number][] = [['신뢰도', input.trust]];
  if (input.achieved !== null) parts.push([input.achieved ? '지난 시즌 목표 달성' : '지난 시즌 목표 미달', input.achieved ? SCORE_GOAL : -SCORE_GOAL]);
  const g = parentGrade(league, team);
  if (SCORE_GRADE[g]) parts.push([`모기업 ${g}등급`, SCORE_GRADE[g]]);
  if (hasDebt(league, team)) parts.push(['부채 남음', -SCORE_DEBT]);
  if ((league.finance?.[team]?.meetings ?? []).some((m) => m.ask === ask && m.year < year && m.year >= year - REPEAT_YEARS)) parts.push([`${REPEAT_YEARS}년 안 같은 요청`, -SCORE_REPEAT]);
  return { score: parts.reduce((s, [, v]) => s + v, 0), parts };
}

export type Verdict = 'accept' | 'conditional' | 'reject';
export const verdictOf = (score: number): Verdict => (score >= MEETING_ACCEPT ? 'accept' : score >= MEETING_CONDITIONAL ? 'conditional' : 'reject');

/** 운영 자금 증액 금액 (그 해 돈) */
export function askMoney(league: LeagueState, team: number, year: number): number {
  const g = parentGrade(league, team);
  return Math.round((g === 'C' ? MONEY_C : PARENT_BASE[g] * MONEY_SHARE) * wageIndex(year, league));
}

const NO_WORLD = { teams: [], year: -1 } as unknown as World;

/** 다음 시즌 예상 수지와 모기업 한도 (예산 보고) */
export function budgetCheck(league: LeagueState, team: number, year: number): { net: number; limit: number; over: boolean } {
  const plan = financePlan({ league, world: NO_WORLD }, team, year);
  const net = Object.values(plan.items).reduce((s, v) => s + (v ?? 0), 0);
  const limit = -Math.round(Math.max(0, cashOf(league, team)) * BUDGET_CASH_SHARE);
  return { net, limit, over: net < limit };
}

const eok = (man: number) => `${Math.round(man / 1000) / 10}억 원`;

function pushMoney(league: LeagueState, team: number, year: number, money: number, why: string): void {
  league.ledger.push({ year, from: -1, to: team, amount: money, note: `${year} 모기업 추가 지원 (${why})`, kind: 'parentExtra' });
}

/** 판정 이유 한 줄 (가장 크게 깎인 몫, 없으면 가장 크게 더한 몫) */
function reasonOf(parts: [string, number][], verdict: Verdict): string {
  const rest = parts.slice(1);
  const worst = [...rest].sort((a, b) => a[1] - b[1])[0];
  const best = [...rest].sort((a, b) => b[1] - a[1])[0];
  if (verdict === 'accept') return best && best[1] > 0 ? `${best[0]}을(를) 보아 들어주겠다.` : '믿고 맡기겠다.';
  if (worst && worst[1] < 0) return `${worst[0]}(이)라 ${verdict === 'reject' ? '이번에는 어렵다' : '그냥은 어렵다. 목표를 한 단계 올리면 주겠다'}.`;
  return verdict === 'reject' ? '아직 믿음이 부족해 이번에는 어렵다.' : '목표를 한 단계 올리면 주겠다.';
}

/**
 * 요청 하나 (오프시즌 offYear, 결과는 offYear + 1 시즌). accept는 조건부 판정에 대한 답 (두 번째 조작).
 * 한 해에 한 번만. 돈은 바로 장부(parentExtra, 다음 시즌)에 들어온다
 */
export function holdMeeting(league: LeagueState, team: number, offYear: number, ask: OwnerAsk, input: MeetingInput, accept?: boolean): { ok: boolean; message: string; record?: MeetingRecord } {
  if (!OWNER_ASKS.includes(ask)) return { ok: false, message: '없는 요청입니다.' };
  ensureFinance(league);
  const f = league.finance![team];
  const year = offYear + 1;
  const prev = meetingOf(league, team, year);
  if (accept !== undefined) {
    if (!prev || prev.result !== 'conditional' || prev.ask !== ask) return { ok: false, message: '답할 조건부 제안이 없습니다.' };
    if (accept) {
      prev.result = 'accepted-cond';
      prev.goalShift = 1;
      if (ask === 'money') { prev.money = askMoney(league, team, year); pushMoney(league, team, year, prev.money, ASK_LABEL.money); } else prev.faCapYear = year + 1;
      return { ok: true, message: `조건을 받아들였습니다: 이번 시즌 목표 한 단계 위, ${ask === 'money' ? `모기업 추가 지원 ${eok(prev.money!)}` : '다음 FA 때 모기업 계약금 지원 한도 1.5배'}.`, record: prev };
    }
    prev.result = 'declined';
    return { ok: true, message: '조건을 거절했습니다. 이번 시즌 요청은 없던 일이 됩니다.', record: prev };
  }
  if (prev) return { ok: false, message: '이번 오프시즌 구단주 회의는 이미 끝났습니다.' };
  const rec: MeetingRecord = { year, ask, result: 'none', goalShift: 0, trust: 0, reason: '' };
  if (ask === 'none') {
    rec.trust = TRUST_NONE;
    rec.reason = '알뜰하게 꾸려 가겠다니 고맙다.';
  } else if (ask === 'lowerGoal') {
    rec.result = 'lowered'; rec.goalShift = -1; rec.trust = TRUST_LOWER; rec.halfGain = true;
    rec.reason = '목표는 낮춰 주겠지만 실망스럽다.';
  } else if (ask === 'raiseGoal') {
    rec.result = 'promised'; rec.goalShift = 1; rec.money = askMoney(league, team, year);
    rec.reason = '좋다. 그 약속을 믿고 지원하겠다.';
    pushMoney(league, team, year, rec.money, ASK_LABEL.raiseGoal);
  } else {
    const { score, parts } = askScore(league, team, year, ask, input);
    const v = verdictOf(score);
    rec.score = score;
    rec.reason = reasonOf(parts, v);
    if (v === 'accept') {
      rec.result = 'accepted';
      if (ask === 'money') { rec.money = askMoney(league, team, year); pushMoney(league, team, year, rec.money, ASK_LABEL.money); } else rec.faCapYear = year + 1;
    } else if (v === 'conditional') rec.result = 'conditional';
    else { rec.result = 'rejected'; rec.trust = TRUST_REJECT; }
  }
  f.meetings = [...(f.meetings ?? []).filter((m) => m.year >= year - REPEAT_YEARS), rec];
  const tail = rec.result === 'conditional' ? ' 목표를 한 단계 올리면 주겠다고 합니다. 받을지 답하세요.' : '';
  return { ok: true, message: `구단주 회의: ${ASK_LABEL[ask]} → ${RESULT_LABEL[rec.result]}. "${rec.reason}"${tail}`, record: rec };
}

/**
 * 회의 단계를 마칠 때 (플레이어 구단): 요청을 안 했으면 '요청 없음', 답하지 않은 조건부는 거절로.
 * 예상 수지가 모기업 한도보다 나쁘면 신뢰도 −3
 */
export function closeMeeting(league: LeagueState, team: number, offYear: number, input: MeetingInput): MeetingRecord {
  const year = offYear + 1;
  if (!meetingOf(league, team, year)) holdMeeting(league, team, offYear, 'none', input);
  const rec = meetingOf(league, team, year)!;
  if (rec.result === 'conditional') rec.result = 'declined';
  if (budgetCheck(league, team, year).over && !rec.overBudget) { rec.overBudget = true; rec.trust += TRUST_BUDGET; }
  return rec;
}

/** AI 구단 회의 (규칙): 성향 윈나우이고 자금이 리그 평균 아래면 운영 자금 증액 (신뢰도 50으로 판정, 조건부면 받음), 그 밖은 요청 없음 (기록 없음) */
export function aiMeetings(league: LeagueState, offYear: number, userTeam: number): void {
  ensureFinance(league);
  const n = league.teams.length;
  const cash = Array.from({ length: n }, (_, t) => cashOf(league, t));
  const avg = cash.reduce((s, v) => s + v, 0) / Math.max(1, n);
  for (let t = 0; t < n; t++) {
    if (t === userTeam || gmStyle(league, t) !== 'winnow' || cash[t] >= avg) continue;
    const r = holdMeeting(league, t, offYear, 'money', { trust: AI_TRUST, achieved: null });
    if (r.record?.result === 'conditional') holdMeeting(league, t, offYear, 'money', { trust: AI_TRUST, achieved: null }, true);
  }
}

/** 목표를 회의 결과만큼 옮긴다 (우승보다 위·탈꼴찌보다 아래로는 안 감) */
export function shiftGoal(kind: GoalKind, shift: number): GoalKind {
  const order: GoalKind[] = ['notLast', 'postseason', 'champion'];
  const i = Math.max(0, Math.min(order.length - 1, order.indexOf(kind) + shift));
  return order[i];
}

/** 그 장부 연도의 FA 계약금 지원 한도 배율 */
export function faCapScale(league: Pick<LeagueState, 'finance'>, team: number, ledgerYear: number): number {
  return (league.finance?.[team]?.meetings ?? []).some((m) => m.faCapYear === ledgerYear) ? FA_CAP_SCALE : 1;
}

/** 플레이어 구단 판정 입력: 구단주 신뢰도와 지난 시즌(offYear) 목표 달성 */
export function ownerInput(league: LeagueState, team: number, offYear: number): MeetingInput {
  const o = league.owner;
  if (!o || o.team !== team) return { trust: AI_TRUST, achieved: null };
  const h = o.history.at(-1);
  return { trust: o.trust, achieved: h && h.year === offYear && h.team === team ? h.achieved : null };
}
