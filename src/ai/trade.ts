// AI 구단의 트레이드 판단: 구단 성향, 제안 평가와 수락 규칙, 요구안 만들기.
//
// 수락 규칙 (기획서 10장): 받는 가치가 주는 가치보다 약간 커야 수락한다.
// 여기서 "가치"는 선수 가치의 단순 합이 아니라 트레이드 전후 구단 전력(teamValue)의 차이다.
// 그래서 주전 자리에 못 들어갈 선수를 여럿 묶어 주전 한 명과 바꾸는 제안은 전력이 줄어 거절되고,
// 비어 있는 자리를 채우는 선수는 그만큼 전력을 크게 올려 자연히 가산점을 받는다.

import type { SimPlayer } from '../engine';
import { HORIZON, playerValue, teamValue, type ValueContext } from './value';

export type Tendency = 'contend' | 'rebuild';

export const TENDENCY_LABEL: Record<Tendency, string> = { contend: '우승 도전', rebuild: '리빌딩' };

/** 성향별 시즌 가중치 [이번 시즌, 1년 뒤, 2년 뒤, 3년 뒤] (임시값) */
const HORIZON_WEIGHTS: Record<Tendency, number[]> = {
  contend: [1.0, 0.5, 0.3, 0.2],
  rebuild: [0.5, 0.8, 0.8, 0.7],
};

/** 수락에 필요한 최소 이득: max(MIN_GAIN, 내주는 선수 가치 × GAIN_SHARE) (런, 임시값) */
const MIN_GAIN = 2;
const GAIN_SHARE = 0.08;
/** 한쪽이 내줄 수 있는 최대 인원 (임시값) */
export const MAX_PER_SIDE = 4;
/** AI 구단이 트레이드 뒤에도 남겨야 하는 최소 인원 (임시값) */
const MIN_ORG_HITTERS = 18;
const MIN_ORG_PITCHERS = 18;
const MIN_ORG_CATCHERS = 2;

export interface TeamSituation {
  teamIdx: number;
  /** 지금 순위 (경기를 20경기 미만 치렀으면 전력 순위) */
  rank: number;
  nTeams: number;
  /** 포스트시즌 진출권 순위 */
  cut: number;
  /** 주전급 평균 나이 */
  coreAge: number;
  /** 남은 정규시즌 비율 (0~1) */
  remaining: number;
}

/**
 * 구단 성향: 진출권 안이면 우승 도전, 진출권 바로 밖(2계단 이내)이어도 주축이 30세 이상이면 지금을 노린다.
 * 그 밖은 리빌딩 (임시 규칙).
 */
export function tendencyOf(s: TeamSituation): Tendency {
  if (s.rank <= s.cut) return 'contend';
  if (s.rank <= s.cut + 2 && s.coreAge >= 30) return 'contend';
  return 'rebuild';
}

export function horizonWeights(t: Tendency, remaining: number): number[] {
  const w = [...HORIZON_WEIGHTS[t]];
  w[0] *= Math.max(0, Math.min(1, remaining));
  return w.slice(0, HORIZON);
}

/** 주전급(구단 가치 상위 14명) 평균 나이 */
export function coreAge(org: SimPlayer[], ctx: ValueContext): number {
  const top = [...org].sort((a, b) => playerValue(b, ctx, [1]) - playerValue(a, ctx, [1]) || a.idx - b.idx).slice(0, 14);
  const ages = top.map((p) => p.age ?? 28);
  return ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 28;
}

export interface TradeProposal {
  /** AI 구단 색인 */
  aiTeam: number;
  /** AI 구단이 받는 선수 (플레이어 구단 소속) */
  receive: SimPlayer[];
  /** AI 구단이 내주는 선수 */
  give: SimPlayer[];
}

export type TradeVerdict =
  | 'accept'
  | 'reject-value'
  | 'reject-roster'
  | 'reject-invalid';

export interface TradeEvaluation {
  verdict: TradeVerdict;
  /** 화면에 보여줄 AI 단장의 답 */
  message: string;
  /** 판정 근거 (테스트·디버그용. 화면에는 수치를 그대로 보여주지 않는다) */
  detail: { gain: number; need: number; before: number; after: number; tendency: Tendency };
}

/** 제안을 AI 구단 입장에서 평가한다. 실행은 하지 않는다 */
export function evaluateTrade(prop: TradeProposal, org: SimPlayer[], situation: TeamSituation, ctx: ValueContext): TradeEvaluation {
  const tendency = tendencyOf(situation);
  const weights = horizonWeights(tendency, situation.remaining);
  const base = { gain: 0, need: 0, before: 0, after: 0, tendency };
  const invalid = (message: string): TradeEvaluation => ({ verdict: 'reject-invalid', message, detail: base });

  if (prop.give.length === 0 && prop.receive.length === 0) return invalid('주고받을 선수를 고르세요.');
  if (prop.give.length > MAX_PER_SIDE || prop.receive.length > MAX_PER_SIDE) return invalid(`한쪽에서 ${MAX_PER_SIDE}명까지만 주고받을 수 있습니다.`);
  if (prop.give.some((p) => p.teamIdx !== prop.aiTeam)) return invalid('상대 구단 소속이 아닌 선수가 있습니다.');
  if (prop.receive.some((p) => p.teamIdx === prop.aiTeam)) return invalid('상대 구단 선수를 상대에게 줄 수는 없습니다.');
  if (new Set([...prop.give, ...prop.receive].map((p) => p.idx)).size !== prop.give.length + prop.receive.length) {
    return invalid('같은 선수가 두 번 들어 있습니다.');
  }

  const giveSet = new Set(prop.give.map((p) => p.idx));
  const after = [...org.filter((p) => !giveSet.has(p.idx)), ...prop.receive];
  const hit = after.filter((p) => !p.isPitcher);
  if (hit.length < MIN_ORG_HITTERS || after.filter((p) => p.isPitcher).length < MIN_ORG_PITCHERS) {
    return { verdict: 'reject-roster', message: '그렇게 하면 우리 선수단 인원이 모자랍니다.', detail: base };
  }
  if (hit.filter((p) => p.pos === 'C').length < MIN_ORG_CATCHERS) {
    return { verdict: 'reject-roster', message: '포수가 모자라게 되는 트레이드는 할 수 없습니다.', detail: base };
  }

  const before = teamValue(org, ctx, weights);
  const afterV = teamValue(after, ctx, weights);
  const gain = afterV - before;
  const outgoing = prop.give.reduce((s, p) => s + Math.max(0, playerValue(p, ctx, weights)), 0);
  const need = Math.max(MIN_GAIN, outgoing * GAIN_SHARE);
  const detail = { gain, need, before, after: afterV, tendency };
  if (gain >= need) return { verdict: 'accept', message: '좋습니다. 그 조건으로 하죠.', detail };

  // 거절 사유: 얼마나 모자란지, 성향 때문인지에 따라 말을 바꾼다
  const youngOut = prop.give.some((p) => (p.age ?? 28) <= 25 && playerValue(p, ctx, horizonWeights('rebuild', 1)) > 15);
  let message: string;
  if (gain < -need * 3) message = '우리 쪽 손해가 너무 큽니다. 검토할 수 없습니다.';
  else if (tendency === 'rebuild' && youngOut) message = '리빌딩 중이라 젊은 선수는 쉽게 내줄 수 없습니다.';
  else if (tendency === 'contend' && prop.receive.every((p) => (p.age ?? 28) <= 24)) message = '지금 당장 순위 싸움에 보탬이 되는 선수가 필요합니다.';
  else message = '조금 모자랍니다. 조건을 더 얹어 주시면 생각해 보겠습니다.';
  return { verdict: 'reject-value', message, detail };
}

/**
 * 요구안: 플레이어가 AI 구단의 선수(want)를 원할 때, 플레이어 구단(userOrg)에서 무엇을 받으면 수락할지 찾는다.
 * 한 명으로 되면 그중 가장 덜 아까운(가치가 낮은) 선수, 안 되면 두 명 조합을 찾는다. 없으면 null.
 */
export function suggestPackage(want: SimPlayer[], aiTeam: number, aiOrg: SimPlayer[], userOrg: SimPlayer[], situation: TeamSituation,
                               ctx: ValueContext, userWeights: number[]): SimPlayer[] | null {
  const pool = [...userOrg]
    .map((p) => ({ p, v: playerValue(p, ctx, userWeights) }))
    .sort((a, b) => a.v - b.v || a.p.idx - b.p.idx);
  const ok = (receive: SimPlayer[]) => evaluateTrade({ aiTeam, give: want, receive }, aiOrg, situation, ctx).verdict === 'accept';
  for (const { p } of pool) if (ok([p])) return [p];
  // 두 명 조합: 비교적 가치 있는 선수 25명 안에서, 덜 아까운 조합부터
  const top = pool.slice(-25);
  const pairs: { ps: SimPlayer[]; v: number }[] = [];
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) pairs.push({ ps: [top[i].p, top[j].p], v: top[i].v + top[j].v });
  pairs.sort((a, b) => a.v - b.v);
  for (const x of pairs) if (ok(x.ps)) return x.ps;
  return null;
}
