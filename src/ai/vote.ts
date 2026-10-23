// 구단 투표 (구단투표 기획안 v0.2 3장, 개발 V2): 규칙 안건에 대한 AI 구단의 찬반.
// 점수(t, a) = 명분(a) + 이해 배율 × Σ 가중_k × 이해_k(t, a) + 성향(t, a) − 현상유지(a), 0보다 크면 찬성 (0이면 반대).
// 난수가 없는 순수 함수다. 지표(VoteFacts)는 결산 직후 리그 상태에서 한 번 모아(league/ruleVote.ts) 표를 저장하므로
// 표결 단계에서 플레이어가 무엇을 해도 AI 표는 그대로다. 가중·명분·현상유지는 모두 임시값 (V5 longsim으로 맞춤).

import { FOREIGN_JUDGE, SHIFT_LIMITS, type FutureRuleKey } from '../league/futureRules';
import type { Tendency } from './trade';

/** 큰 안건 (결정 8): 지명타자 폐지, 포스트시즌 진출 팀 수, 경기 수, 구단 창단. V6에서 안건마다 개발한다. 지금은 자리만 */
export type BigRuleKey = 'noDh' | 'playoffTeams' | 'games' | 'expansion';
export type AgendaKey = FutureRuleKey | BigRuleKey;

export const BIG_RULE_LABEL: Record<BigRuleKey, string> = {
  noDh: '지명타자 제도', playoffTeams: '포스트시즌 진출 팀 수', games: '정규시즌 경기 수', expansion: '구단 창단',
};
/** 큰 안건을 발의하는가 (V6 전까지 꺼 둔다) */
export const BIG_AGENDAS_ON = false;
/** 큰 안건은 가결되면 한 해 미뤄 시행한다 (결정 2): 적용 해 = 결산 해 + 이 값 */
export const BIG_AGENDA_DELAY = 2;

/** 표결에 올라온 안건 하나. id = `${적용 연도}-${key}` */
export interface RuleAgenda {
  id: string;
  /** 가결되면 새 값이 적용되는 시즌 */
  year: number;
  key: AgendaKey;
  before: number;
  after: number;
  /** 발의 까닭 (게임 속 가상 결정임을 밝힌다) */
  reason: string;
  /** 판단에 쓴 신호 값 (futureRules.ts RuleShift.signal과 같다) */
  signal: number;
  big?: boolean;
}

/** 우리 구단의 표 (결정 4: 기권 없음, 안 내면 반대) */
export type VoteChoice = 'yes' | 'no';

/** 개표 결과 기록 (가결·부결 모두, league.ruleVotes) */
export interface RuleVoteRecord extends RuleAgenda {
  /** 구단별 표 (1 찬성 · 0 반대 · −1 표결권 없음). 플레이어 구단 칸은 실제로 센 표 */
  votes: number[];
  yes: number;
  no: number;
  need: number;
  passed: boolean;
  /** 플레이어 구단 색인과 낸 표 (없으면 반대로 셌다). 모든 구단 AI면 없다 */
  userTeam?: number;
  user?: VoteChoice;
}

/** 통과 문턱 비율 (결정 3: 2/3) */
export const VOTE_PASS_SHARE = 2 / 3;

/** 표결권이 있는 구단 수 n에서 가결에 필요한 찬성 수 */
export function votesNeeded(n: number): number {
  return Math.ceil(n * VOTE_PASS_SHARE - 1e-9);
}

/** 구단 하나의 지표 (결산 직후). 모두 구단 사이에서 표준화하므로 단위는 상관없다 */
export interface VoteFacts {
  team: number;
  /** 자금 (만 원) */
  cash: number;
  /** 다음 시즌 주전 기여 (타자 9 + 선발 5 + 구원 7, 런) */
  strength: number;
  /** 국내 선수 상위 25명 기여 합 */
  domestic: number;
  /** 구단 상위 25명 기여 중 외국인 몫 (0~1) */
  foreign: number;
  /** 캡 대상 연봉 합 ÷ 그 해 캡 (캡이 없으면 연봉 합 그대로) */
  capUse: number;
  /** 그 해 수지 (만 원, 적자면 음수) */
  net: number;
  /** 그 시즌 부상·이탈 결장 선수-일 */
  absence: number;
  /** 30번째 선수 기여 (선수층 깊이) */
  depth: number;
  /** 구원 상위 7명 기여 */
  bullpen: number;
  /** 투수 주전 기여 − 타자 주전 기여 (런) */
  pitchBat: number;
  /** 팀 홈런 ÷ 리그 평균 */
  hr: number;
  /** 타자 볼넷 ÷ 삼진 */
  eye: number;
  /** 투수 삼진 ÷ 상대 타자 */
  kPitch: number;
  tendency: Tendency;
}

type FactKey = Exclude<keyof VoteFacts, 'team' | 'tendency'>;

/**
 * 안건별 이해 지표와 가중 (기획안 3.2, 임시값). 값을 올리는 쪽(after > before) 기준이고, 내리는 안건은 부호를 뒤집는다.
 * + 는 찬성 쪽으로 민다. 가중 절댓값의 합은 안건마다 1
 */
export const INTEREST_WEIGHTS: Record<FutureRuleKey, Partial<Record<FactKey, number>>> = {
  // 한도 확대: 돈 있고 약한 구단, 외국인에 기대는 구단은 찬성. 국내 선수층이 두꺼운 구단은 우위가 줄어 반대
  foreign: { cash: 0.35, strength: -0.25, foreign: 0.15, domestic: -0.25 },
  // 상향률 인상: 캡에 닿은 구단은 숨통 (하한도 같은 비율로 올라 사용률이 낮은 구단은 부담), 자금 여유 +, 적자 −
  capGrowth: { capUse: 0.5, cash: 0.2, net: 0.3 },
  // 엔트리 확대: 결장이 많고 벤치가 깊은 구단이 득, 적자 구단은 인건비 부담
  roster: { absence: 0.4, depth: 0.4, net: 0.2 },
  // 연장 이닝 확대: 긴 연장은 불펜 싸움 (기획안의 불펜 피로 지표는 시즌 기록에 없어 불펜 하나로)
  extra: { bullpen: 1 },
  // 반발계수 기준 상향(홈런 ↑): 장타 구단은 찬성, 투수가 강한 구단은 반대
  ball: { hr: 0.5, pitchBat: -0.5 },
  // 존 확대(삼진 ↑·볼넷 ↓): 삼진형 투수 구단은 찬성, 선구가 좋은 타자 구단은 반대
  zone: { kPitch: 0.5, eye: -0.5 },
};

/** 점수 조정값 (임시값, V5 longsim 50시즌 × 시드 a·b로 맞춤. reports/longsim-vote-50.md) */
export const VOTE_PARAMS = {
  /** 명분 = base + span × (신호가 문턱을 넘은 정도, 0~1) */
  meritBase: 0.3,
  meritSpan: 0.5,
  /** 이해 항 배율 (표준화한 지표의 가중합에 곱한다) */
  interest: 1,
  /** 성향 가산: 전력을 키우는 안에 우승 도전, 비용을 줄이는 안에 리빌딩 */
  lean: 0.2,
  /** 현상 유지 (보통 안건, 큰 안건) */
  statusQuo: 0.3,
  statusQuoBig: 1.2,
};
export type VoteParams = typeof VOTE_PARAMS;

/** 표준화 값의 자르는 폭 */
const Z_CLIP = 2;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const dirOf = (a: Pick<RuleAgenda, 'before' | 'after'>): 1 | -1 => (a.after > a.before ? 1 : -1);

/**
 * 명분이 쓰는 "신호가 문턱을 넘은 정도" (0~1). 신호 값은 futureRules.ts가 남긴 값:
 * 공인구 장타 압력, 존 삼진 압력, 연장 무승부 비율, 엔트리 결장 비(기준 해 대비), 외국인 확대 관중 비율·축소 연봉 부담, 캡 확대 초과 구단·축소 사용률.
 * 넓이는 임시값. 큰 안건은 V6
 */
export function meritExcess(a: Pick<RuleAgenda, 'key' | 'before' | 'after' | 'signal'>): number {
  const L = SHIFT_LIMITS;
  const s = a.signal;
  const up = dirOf(a) > 0;
  switch (a.key) {
    case 'ball': return clamp01(up ? (L.ballLow - s) / 0.07 : (s - L.ballHigh) / 0.07);
    case 'zone': return clamp01(up ? (L.pressureLow - s) / 0.1 : (s - L.pressureHigh) / 0.1);
    case 'extra': return clamp01(up ? (s - L.drawHigh) / 0.02 : (L.drawLow - s) / L.drawLow);
    case 'roster': return clamp01(up ? (s - 1 - L.absence) / 0.2 : (1 - L.absence - s) / 0.2);
    case 'foreign': return clamp01(up ? (1 - FOREIGN_JUDGE.attendanceDrop - s) / FOREIGN_JUDGE.attendanceDrop : (s - FOREIGN_JUDGE.foreignShare) / 0.04);
    case 'capGrowth': return clamp01(up ? (s - L.capOverTeams) / 3 : (L.capUseLow - s) / 0.2);
    default: return 0;
  }
}

/** 구단마다 점수를 이루는 몫 (longsim이 값을 다시 맞출 때 쓴다) */
export interface VoteParts {
  team: number;
  /** 표준화 지표의 가중합 (배율 전) */
  interest: number;
  /** 성향 가산 방향 (+1 받음, 0 없음) */
  lean: number;
  score: number;
}

/** 표준화 (평균 0, 표준편차 1, ±Z_CLIP에서 자름). 모두 같으면 0 */
function zscores(xs: number[]): number[] {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / (n || 1);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n || 1));
  return xs.map((x) => (sd > 1e-12 ? Math.max(-Z_CLIP, Math.min(Z_CLIP, (x - mean) / sd)) : 0));
}

/** 성향 가산을 받는 성향: 전력을 키우는 안(외국인 확대·캡 상향·엔트리 확대)은 우승 도전, 비용을 줄이는 안(외국인 축소·캡 하향)은 리빌딩 */
function leanFor(a: Pick<RuleAgenda, 'key' | 'before' | 'after'>): Tendency | null {
  const up = dirOf(a) > 0;
  if (a.key === 'foreign' || a.key === 'capGrowth') return up ? 'contend' : 'rebuild';
  if (a.key === 'roster') return up ? 'contend' : null;
  return null;
}

/** 표결권이 있는 구단(facts)마다 점수와 몫. 순서는 facts 그대로 */
export function voteParts(a: RuleAgenda, facts: VoteFacts[], P: VoteParams = VOTE_PARAMS): VoteParts[] {
  const merit = P.meritBase + P.meritSpan * meritExcess(a);
  const quo = a.big ? P.statusQuoBig : P.statusQuo;
  const sign = dirOf(a);
  const weights = a.big ? {} : INTEREST_WEIGHTS[a.key as FutureRuleKey] ?? {};
  const interest = facts.map(() => 0);
  for (const [k, w] of Object.entries(weights) as [FactKey, number][]) {
    const z = zscores(facts.map((f) => f[k]));
    z.forEach((v, i) => { interest[i] += sign * w * v; });
  }
  const lean = leanFor(a);
  return facts.map((f, i) => {
    const l = lean && f.tendency === lean ? 1 : 0;
    return { team: f.team, interest: interest[i], lean: l, score: merit + P.interest * interest[i] + P.lean * l - quo };
  });
}

/**
 * AI 구단 표: 리그 구단 수 길이의 배열 (1 찬성 · 0 반대 · −1 표결권 없음). 점수가 0보다 커야 찬성 (같으면 반대 = 현상 유지).
 * 플레이어 구단 칸은 실무진 추천 (우리 구단이 AI라면 낼 표)
 */
export function aiVotes(a: RuleAgenda, facts: VoteFacts[], nTeams: number, P: VoteParams = VOTE_PARAMS): number[] {
  const out = Array.from({ length: nTeams }, () => -1);
  for (const p of voteParts(a, facts, P)) out[p.team] = p.score > 0 ? 1 : 0;
  return out;
}

/** 개표: 플레이어 구단 칸은 우리 표로 (없으면 반대, 결정 4). userTeam < 0이면 모두 AI 표 */
export function countVotes(ai: number[], userTeam: number, user?: VoteChoice): { votes: number[]; yes: number; no: number; need: number; passed: boolean } {
  const votes = ai.map((v, t) => (v < 0 ? -1 : t === userTeam ? (user === 'yes' ? 1 : 0) : v));
  const yes = votes.filter((v) => v === 1).length;
  const no = votes.filter((v) => v === 0).length;
  const need = votesNeeded(yes + no);
  return { votes, yes, no, need, passed: yes >= need };
}

/** 표결 전 여론 (결정 10: 정확한 수). AI 구단(우리 빼고)의 찬반과 우리 표가 결과를 가르는지 */
export interface VoteOutlook {
  yes: number;
  no: number;
  need: number;
  /** decisive: 우리 표에 달림, pass: 우리 표와 상관없이 가결, fail: 우리 표와 상관없이 부결 */
  swing: 'decisive' | 'pass' | 'fail';
  /** 실무진 추천 (우리 구단이 AI라면 낼 표). 모든 구단 AI면 없다 */
  advice?: VoteChoice;
}

export function voteOutlook(ai: number[], userTeam: number): VoteOutlook {
  const others = ai.filter((v, t) => v >= 0 && t !== userTeam);
  const yes = others.filter((v) => v === 1).length;
  const voters = ai.filter((v) => v >= 0).length;
  const need = votesNeeded(voters);
  const userVotes = userTeam >= 0 && ai[userTeam] >= 0;
  const swing = yes >= need ? 'pass' : userVotes && yes === need - 1 ? 'decisive' : 'fail';
  return { yes, no: others.length - yes, need, swing, ...(userVotes ? { advice: ai[userTeam] === 1 ? 'yes' as const : 'no' as const } : {}) };
}

export const SWING_LABEL: Record<VoteOutlook['swing'], string> = {
  decisive: '우리 표에 달림', pass: '우리 표와 상관없이 가결', fail: '우리 표와 상관없이 부결',
};

/** 큰 안건 발의 (결정 8, V6에서 안건마다 신호를 채운다). 지금은 늘 null */
export function bigAgendaSignal(_year: number): RuleAgenda | null {
  if (!BIG_AGENDAS_ON) return null;
  return null;
}
