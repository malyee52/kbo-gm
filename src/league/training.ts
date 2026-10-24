// 훈련 탭 (능력치 v2 16-4c, 기획안 9.10·15.8, 모두 임시값).
//
// - 구단마다 "집중 훈련" 12명 (1군·2군 합). 선수마다 능력 훈련 하나(자라는 갈래 집중 또는 자라지 않는 능력)와 수비 자리 훈련 하나를 걸 수 있다.
// - 시즌 내내 걸어 두고 효과는 결산 성장 판정 때 한 번. 시즌 중에 걸거나 바꾸면 그 해는 기간 비례 (since = 건 날).
// - 자라는 갈래 집중: 그 갈래 성장 × 1.3, 나머지 × 0.9 (총량은 성장 판정 그대로, 천장 근처 감쇠는 branches.ts의 남은 거리 몫).
// - 자라지 않는 능력 (주루 판단·번트 수행·포수 블로킹·프레이밍·견제·퀵모션): 시즌당 등급 +1.5, 그 나이 평균 + 15까지 (runskills.ts가 월드 때 더함).
// - 수비 자리 훈련: 익힘 m (0~1, 자리 묶음별 한 시즌 몫 × 나이 배율), m ≥ 0.5면 익숙함이 다 참 (engine/fielding.ts familiarity의 train).
//   2군에서 뛰는 선수는 2군 출장 자리도 훈련 자리로 기간 몫만큼 옮긴다 (futures.ts futuresSlot).
// - AI 구단도 한다 (결정적, 난수 없음): 30세 이하 중 천장까지 남은 거리가 큰 12명, 남은 거리가 가장 큰 갈래. 수비 자리 훈련은 하지 않는다 (임시 단순화).
// 훈련 설정은 조작 기록(시즌 중 'train', 오프시즌 'train-off')에 남는다.

import type { FieldPos } from '../engine';
import { BAT_BRANCHES, PIT_BRANCHES } from './branches';
import type { LeaguePlayer, LeagueState } from './types';

/** 능력 훈련 꼴: 자라는 갈래 (타 so·bb·s1·hr·t3, 투 so·bb·hr) 또는 자라지 않는 능력 */
export type BatDrill = 'so' | 'bb' | 's1' | 'hr' | 't3' | 'runIQ' | 'bunting' | 'cBlock' | 'cFrame';
export type PitDrill = 'so' | 'bb' | 'hr' | 'hold' | 'quick';
export type DrillKnob = 'runIQ' | 'bunting' | 'cBlock' | 'cFrame' | 'hold' | 'quick';

export const BAT_DRILLS: readonly BatDrill[] = ['so', 'bb', 's1', 'hr', 't3', 'runIQ', 'bunting', 'cBlock', 'cFrame'];
export const PIT_DRILLS: readonly PitDrill[] = ['so', 'bb', 'hr', 'hold', 'quick'];
export const DRILL_KNOBS: readonly DrillKnob[] = ['runIQ', 'bunting', 'cBlock', 'cFrame', 'hold', 'quick'];

/** 화면 이름 */
export const DRILL_LABEL: Record<string, string> = {
  bat_so: '맞히기', bat_bb: '선구', bat_s1: '컨택', bat_hr: '파워', bat_t3: '주력',
  bat_runIQ: '주루 판단', bat_bunting: '번트·작전', bat_cBlock: '블로킹', bat_cFrame: '프레이밍',
  pit_so: '구위', pit_bb: '제구', pit_hr: '장타 억제', pit_hold: '견제', pit_quick: '퀵모션',
};
export const drillLabel = (isPitcher: boolean, d: string) => DRILL_LABEL[`${isPitcher ? 'pit' : 'bat'}_${d}`] ?? d;

export interface TrainingPlan {
  team: number;
  /** 능력 훈련 (없으면 "고르게") */
  drill?: BatDrill | PitDrill;
  /** 수비 자리 훈련 */
  pos?: FieldPos;
  /** 건 날 (그 시즌 경기일, 0 = 개막부터). 결산 때 0으로 되돌린다 */
  since: number;
}

/** 구단당 집중 훈련 인원 */
export const TRAIN_SLOTS = 12;
/** 집중 갈래 성장 배율 */
export const FOCUS_UP = 1.3;
export const FOCUS_DOWN = 0.9;
/** 자라지 않는 능력: 시즌당 등급, 상한 (그 나이 평균 위) */
export const KNOB_GAIN = 1.5;
export const KNOB_CAP = 15;

/** 옮겨 갈 자리의 한 시즌 익힘 m (9.10 표, 같은 묶음 다른 자리는 0.6) */
const POS_GAIN: Record<FieldPos, number> = { C: 0.15, '1B': 0.5, '2B': 0.25, SS: 0.25, '3B': 0.35, LF: 0.4, CF: 0.3, RF: 0.4 };
const SAME_GROUP: FieldPos[][] = [['2B', 'SS'], ['LF', 'RF']];

/** 한 시즌 익힘 m: 자리 묶음 × 나이 배율 (25세 이하 1.2 · 26~30 1 · 31~34 0.7 · 35+ 0.4) */
export function posGain(from: FieldPos | null, to: FieldPos, age: number): number {
  const same = from && SAME_GROUP.some((g) => g.includes(from) && g.includes(to));
  const base = same ? 0.6 : POS_GAIN[to];
  const mult = age <= 25 ? 1.2 : age <= 30 ? 1 : age <= 34 ? 0.7 : 0.4;
  return base * mult;
}

/** 훈련 기간 몫 (그 시즌 경기일 seasonDays 중 건 날부터) */
export function trainingFrac(plan: Pick<TrainingPlan, 'since'>, seasonDays: number): number {
  if (seasonDays <= 0) return 1;
  return Math.max(0, Math.min(1, (seasonDays - plan.since) / seasonDays));
}

export function drillsFor(isPitcher: boolean): readonly string[] {
  return isPitcher ? PIT_DRILLS : BAT_DRILLS;
}

export const isKnob = (d: string | undefined): d is DrillKnob => !!d && (DRILL_KNOBS as readonly string[]).includes(d);

/** 그 구단 훈련 명단 (지금 소속인 선수만) */
export function teamTraining(league: LeagueState, team: number): [LeaguePlayer, TrainingPlan][] {
  const out: [LeaguePlayer, TrainingPlan][] = [];
  for (const [id, plan] of Object.entries(league.training ?? {})) {
    if (plan.team !== team) continue;
    const p = league.players.find((x) => x.id === id);
    if (p && p.team === team) out.push([p, plan]);
  }
  return out;
}

/**
 * 훈련 걸기·바꾸기·풀기 (plan null). day: 시즌 중이면 그날 경기일, 오프시즌이면 0 (다음 시즌 개막부터).
 * 같은 선수의 꼴만 바꾸면 그날부터 새 꼴 (기간 비례도 새로 센다)
 */
export function setTraining(league: LeagueState, team: number, id: string, plan: { drill?: string; pos?: FieldPos } | null, day: number):
  { ok: boolean; message: string } {
  const p = league.players.find((x) => x.id === id);
  if (!p || p.team !== team) return { ok: false, message: '우리 구단 선수만 훈련을 걸 수 있습니다.' };
  const book = (league.training ??= {});
  if (!plan || (!plan.drill && !plan.pos)) {
    if (!book[id]) return { ok: false, message: '훈련 중인 선수가 아닙니다.' };
    delete book[id];
    return { ok: true, message: `${p.name}의 집중 훈련을 풀었습니다.` };
  }
  if (plan.drill && !drillsFor(p.isPitcher).includes(plan.drill)) return { ok: false, message: '이 선수에게 걸 수 없는 훈련입니다.' };
  if (plan.pos && p.isPitcher) return { ok: false, message: '투수는 수비 자리 훈련을 할 수 없습니다.' };
  if ((plan.drill === 'cBlock' || plan.drill === 'cFrame') && !(p.bat?.playable?.includes('C') || plan.pos === 'C')) {
    return { ok: false, message: '포수 훈련은 포수(또는 포수 자리 훈련 중인 선수)만 할 수 있습니다.' };
  }
  if (plan.pos && p.bat?.playable?.includes(plan.pos)) return { ok: false, message: `${plan.pos}는 이미 수비 가능한 자리입니다.` };
  if (!book[id] && teamTraining(league, team).length >= TRAIN_SLOTS) return { ok: false, message: `집중 훈련은 ${TRAIN_SLOTS}명까지입니다.` };
  book[id] = { team, ...(plan.drill ? { drill: plan.drill as BatDrill | PitDrill } : {}), ...(plan.pos ? { pos: plan.pos } : {}), since: day };
  return { ok: true, message: `${p.name}: ${[plan.drill ? drillLabel(p.isPitcher, plan.drill) : null, plan.pos ? `${plan.pos} 익히기` : null].filter(Boolean).join(' · ')} 훈련을 겁니다.` };
}

/**
 * AI 구단 훈련 (결정적): 30세 이하 중 갈래 천장까지 남은 거리(무게 합)가 큰 12명에게, 남은 거리가 가장 큰 자라는 갈래.
 * 갈래 천장이 아직 없는 선수(첫 결산 전 신인)는 뺀다
 */
export function aiTraining(league: LeagueState, team: number, year: number): Map<string, TrainingPlan> {
  const cands: { p: LeaguePlayer; room: number; drill: BatDrill | PitDrill }[] = [];
  for (const p of league.players) {
    if (p.team !== team || !p.ceil || !p.birthYear || year + 1 - p.birthYear > 30) continue;
    let best: { k: string; d: number } | null = null;
    let sum = 0;
    if (p.isPitcher && p.pit && p.ceil.pit) {
      for (const k of PIT_BRANCHES) {
        if (k === 'hit') continue;
        const d = Math.abs(Math.log(p.ceil.pit[k]) - Math.log(p.pit[k]));
        sum += d;
        if (!best || d > best.d) best = { k, d };
      }
    } else if (p.bat && p.ceil.bat) {
      for (const k of BAT_BRANCHES) {
        if (k === 'd2') continue;
        const d = Math.abs(Math.log(p.ceil.bat[k]) - Math.log(p.bat[k]));
        sum += d;
        if (!best || d > best.d) best = { k, d };
      }
    }
    if (best && sum > 1e-6) cands.push({ p, room: sum, drill: best.k as BatDrill | PitDrill });
  }
  cands.sort((a, b) => b.room - a.room || (a.p.id < b.p.id ? -1 : 1));
  return new Map(cands.slice(0, TRAIN_SLOTS).map((c) => [c.p.id, { team, drill: c.drill, since: 0 }]));
}

/** 결산 때 훈련 효과 중 자라지 않는 능력·수비 자리 몫을 쌓는다 (갈래 집중은 성장 판정에서 branches.ts focus). age: 다음 시즌 나이 */
export function applyDrill(p: LeaguePlayer, plan: TrainingPlan, frac: number, age: number, home: FieldPos | null): void {
  if (frac <= 0) return;
  if (isKnob(plan.drill)) {
    const book = (p.drill ??= {});
    book[plan.drill] = Math.round(Math.min(KNOB_CAP * 2, (book[plan.drill] ?? 0) + KNOB_GAIN * frac) * 100) / 100;
  }
  if (plan.pos && !p.isPitcher) {
    const book = (p.drillPos ??= {});
    book[plan.pos] = Math.round(Math.min(1, (book[plan.pos] ?? 0) + posGain(home, plan.pos, age) * frac) * 1000) / 1000;
  }
}

/** 갈래 집중 배율 (기간 몫만큼): 자라지 않는 능력 훈련이거나 고르게면 없음 */
export function focusOf(plan: TrainingPlan | undefined, frac: number): { branch: string; up: number; down: number } | undefined {
  if (!plan?.drill || isKnob(plan.drill) || frac <= 0) return undefined;
  return { branch: plan.drill, up: 1 + (FOCUS_UP - 1) * frac, down: 1 - (1 - FOCUS_DOWN) * frac };
}

/** 결산에 쓸 훈련 명단: 플레이어 구단은 걸어 둔 것, 다른 구단은 AI 규칙 */
export function trainingPlans(league: LeagueState, userTeam: number, year: number): Map<string, TrainingPlan> {
  const out = new Map<string, TrainingPlan>();
  league.teams.forEach((_, t) => {
    if (t === userTeam) for (const [p, plan] of teamTraining(league, t)) out.set(p.id, plan);
    else for (const [id, plan] of aiTraining(league, t, year)) out.set(id, plan);
  });
  return out;
}

/** 결산 뒤: 떠난 선수 훈련은 풀고, 남은 훈련은 다음 시즌 개막부터 다시 센다 */
export function rollTraining(league: LeagueState): void {
  for (const [id, plan] of Object.entries(league.training ?? {})) {
    const p = league.players.find((x) => x.id === id);
    if (!p || p.team !== plan.team) delete league.training![id];
    else plan.since = 0;
  }
}

/** 2군 출장 자리에 쓸 수비 자리 훈련 (futures.ts) */
export function futuresTrainSlots(league: LeagueState): Map<string, { pos: FieldPos; since: number }> {
  const out = new Map<string, { pos: FieldPos; since: number }>();
  for (const [id, plan] of Object.entries(league.training ?? {})) if (plan.pos) out.set(id, { pos: plan.pos, since: plan.since });
  return out;
}
