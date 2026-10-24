// 수비 (M6 추가, 2026-10-08 사용자 요청): 포지션별 수비 능력과 경기 반영.
//
// 자료집에는 수비 기록이 없고 시즌별 주 포지션만 있다. 그래서 수비 능력은 기록에서 잰 값이 아니라
// 맡아 본 포지션(직전 3시즌), 주 포지션, 주력, 나이, 선수별로 고정된 운으로 만든 추정값이다 (모두 임시값).
//
// 단위: "그 포지션 평균 수비수 대비 한 시즌(주전 출전) 수비 런". +10이면 리그 정상급, -20이면 그 자리를 맡기 어렵다.
// 경기 반영: 그날 수비 8명의 합(팀 수비 런)만큼 인플레이 안타·실책 출루가 줄고, 포수 수비는 폭투·포일과 도루 저지에 쓴다.

import { DECLINE_START_AGE } from './params';
import { Rng } from './rng';
import type { BatSkill, SimPlayer } from './types';

export const FIELD_POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;
export type FieldPos = (typeof FIELD_POS)[number];
export type Defense = Partial<Record<FieldPos, number>>;

/** 수비 난이도 순서 (클수록 어렵다). 포수는 따로 다룬다 */
const SPECTRUM: Record<FieldPos, number> = { C: 3, SS: 4, '2B': 3, CF: 3, '3B': 2.5, RF: 1.5, LF: 1, '1B': 0 };
const INFIELD = new Set<FieldPos>(['1B', '2B', '3B', 'SS']);
const OUTFIELD = new Set<FieldPos>(['LF', 'CF', 'RF']);

/**
 * 포지션을 옮길 때의 수비 런 변화 (임시값). 해 본 포지션이면 손해가 1/4 (그 자리를 실제로 맡아 본 선수).
 * 2026-10-13 사용자 "수비 포지션 능력치가 실제와 다르게 작동": 전에는 쉬운 자리로 가면 최대 +5라 거의 모든 선수가 1루에서 가장 높게 나왔다.
 * 이제 해 본 쉬운 자리는 본 자리와 같고 안 해 본 쉬운 자리는 조금(−0.5) 낮다. 본 자리가 가장 높다
 */
export function moveRuns(from: FieldPos, to: FieldPos, played: boolean): number {
  if (from === to) return 0;
  let d: number;
  if (to === 'C') d = -60; // 포수는 해 본 선수만 (경험 없는 선수의 포수 기용은 사실상 불가)
  else if (from === 'C') d = to === '1B' ? 0 : to === '3B' ? -4 : -8 - SPECTRUM[to] * 2;
  else {
    const gap = SPECTRUM[to] - SPECTRUM[from];
    // 쉬운 자리: 해 본 자리면 본 자리와 같고, 안 해 본 자리는 조금(−0.5) 낯설다. 어려운 자리로 가면 크게 손해
    d = gap <= 0 ? (played ? 0 : -0.5) : -gap * 10;
    if (INFIELD.has(from) && OUTFIELD.has(to)) d -= 4;
    if (OUTFIELD.has(from) && INFIELD.has(to) && to !== '1B') d -= 12;
    if (OUTFIELD.has(from) && to === '1B') d -= 3;
  }
  return played && d < 0 ? d / 4 : d;
}

/** 자료의 포지션 표기 → 수비 포지션. IF·OF·DH·모름은 대표 자리로 */
export function fieldPosOf(pos: string | null | undefined): FieldPos {
  if (pos && (FIELD_POS as readonly string[]).includes(pos)) return pos as FieldPos;
  if (pos === 'IF') return '2B';
  if (pos === 'OF') return 'RF';
  return '1B';
}

/**
 * 수비 능력 만들기. played: 맡아 본 포지션 표기 목록 (직전 시즌들, IF·OF 포함 가능).
 * primaryPa: 직전 시즌들에 주 포지션으로 뛴 타석. 한 자리에서 오래 주전으로 뛰었다면 구단이 그 수비를 받아들였다는 근거라서,
 * 많이 뛸수록 운의 폭을 줄이고(최대 40%) 조금 더한다(최대 +3런). 1,500타석(주전 약 3시즌)에서 최대 (임시값).
 * 같은 선수 id면 늘 같은 값 (시드 난수 `defense/<id>`).
 */
export function makeDefense(id: string, pos: string | null, played: (string | null)[], speed: number, age: number | null, primaryPa = 0,
  opts: { awards?: { year: number; pos: string; rank: number }[]; year?: number; fieldPos?: string } = {}): Defense {
  const rng = new Rng(`defense/${id}`);
  // 지명타자는 커리어에 가장 많이 맡은 수비 자리를 본 자리로 (예전에는 1루로 보고 다른 자리는 못 맡았다)
  const primary = fieldPosOf(pos === 'DH' && opts.fieldPos ? opts.fieldPos : pos);
  // 가운데가 두꺼운 운 (표준편차 약 4런)
  const proven = Math.min(1, primaryPa / 1500);
  const talent = (rng.next() + rng.next() + rng.next() - 1.5) * 8 * (1 - 0.4 * proven) + 3 * proven;
  const agePart = age === null ? 0 : -Math.max(0, age - 30) * 0.5 + Math.max(0, 25 - age) * 0.3;
  const speedPart = ['SS', '2B', 'CF'].includes(primary) ? (speed - 0.5) * 5 : (speed - 0.5) * 2;
  const dhPenalty = pos === 'DH' ? -5 : 0;
  const base = talent + agePart + speedPart + dhPenalty;
  const exp = new Set<FieldPos>();
  for (const p of played) {
    if (!p) continue;
    if (p === 'IF') ['2B', '3B', 'SS'].forEach((x) => exp.add(x as FieldPos));
    else if (p === 'OF') ['LF', 'CF', 'RF'].forEach((x) => exp.add(x as FieldPos));
    else if ((FIELD_POS as readonly string[]).includes(p)) exp.add(p as FieldPos);
  }
  if (pos === 'IF') ['2B', '3B', 'SS'].forEach((x) => exp.add(x as FieldPos));
  if (pos === 'OF') ['LF', 'CF', 'RF'].forEach((x) => exp.add(x as FieldPos));
  for (const a of opts.awards ?? []) if ((FIELD_POS as readonly string[]).includes(a.pos)) exp.add(a.pos as FieldPos);
  const out: Defense = {};
  for (const q of FIELD_POS) out[q] = round1(base + moveRuns(primary, q, exp.has(q)));
  // KBO 수비상(2023~) 보정: 그 자리 수상 +10런, 2위 +7, 3위 +5까지 끌어올린다 (떨어진 해마다 1.5런씩 덜). 같은 만큼 모든 자리에 더한다 (수비 재능)
  let lift = 0;
  for (const a of opts.awards ?? []) {
    const q = a.pos as FieldPos;
    if (out[q] === undefined || opts.year === undefined) continue;
    const dy = Math.abs(opts.year - a.year);
    if (dy > 2) continue;
    const target = (AWARD_RUNS[a.rank] ?? 0) - 1.5 * dy;
    lift = Math.max(lift, target - out[q]!);
  }
  if (lift > 0) for (const q of FIELD_POS) out[q] = round1(out[q]! + lift);
  return out;
}

/** 수비상 순위 → 그 자리 수비 런 하한 (임시값: +10 = 리그 정상급) */
const AWARD_RUNS: Record<number, number> = { 1: 10, 2: 7, 3: 5 };

const round1 = (x: number) => Math.round(x * 10) / 10;

/** 그 자리 수비 런. 수비 정보가 없으면 주 포지션에서 옮긴 값으로 (평균 수비수 기준) */
export function defenseAt(p: Pick<SimPlayer, 'pos' | 'isPitcher'> & { bat: Pick<BatSkill, 'def'> | null }, slot: string): number {
  if (p.isPitcher || slot === 'DH') return 0;
  const q = slot as FieldPos;
  const d = p.bat?.def?.[q];
  if (d !== undefined) return d;
  return moveRuns(fieldPosOf(p.pos), q, false);
}

/** 수비 런 → 20~80 등급 (50 = 그 자리 평균, 5런 = 10점) */
export function defenseGrade(runs: number): number {
  return Math.max(20, Math.min(80, Math.round(50 + runs * 2)));
}

/**
 * 맡길 만한 포지션 (등급 높은 순). 능력치 v2(bat.playable 있음)는 수비 가능 = 익숙함이 다 찬 자리 (16-3, 비상 포수는 빼고).
 * 예전 수비는 등급 40 이상 (그 자리 평균보다 5런 넘게 나쁘지 않음)
 */
export function playablePositions(bat: Pick<BatSkill, 'def' | 'playable'> | null | undefined): FieldPos[] {
  const def = bat?.def;
  if (!def) return [];
  const list = bat.playable ?? FIELD_POS.filter((q) => (def[q] ?? -99) >= -5);
  return [...list].sort((a, b) => (def[b] ?? 0) - (def[a] ?? 0));
}

/** 라인업 배정 벌점 (런, 능력치 v2 16-3): 수비 가능이 아닌 자리 (그 자리를 맡을 선수가 없을 때만 등급 최고를 쓴다, 11.1 메모) */
export const UNFIT_RUNS = 1000;
/** 비상 포수 벌점 (런, 14.2 1): 수비 가능 포수가 하나도 없을 때만 포수로 (수비 가능이 아닌 선수보다는 먼저) */
export const EMERGENCY_C_RUNS = 500;

/** 그 자리 배정 벌점 (0 또는 음수). DH·예전 수비(playable 없음)는 0 */
export function fitPenalty(p: Pick<SimPlayer, 'isPitcher'> & { bat: Pick<BatSkill, 'playable' | 'emC'> | null }, slot: string): number {
  if (slot === 'DH' || p.isPitcher) return 0;
  const pl = p.bat?.playable;
  if (!pl || pl.includes(slot as FieldPos)) return 0;
  return slot === 'C' && p.bat!.emC ? -EMERGENCY_C_RUNS : -UNFIT_RUNS;
}

/** 수비 나이 변화 (오프시즌, 임시값): 25세 이하는 조금 늘고 기량 하락 나이(DECLINE_START_AGE, 32세)부터 해마다 0.4런씩 준다 (2026-10-12 하락 나이를 당기며 0.5 → 0.4) */
export function ageDefense(def: Defense, age: number): Defense {
  const d = age <= 25 ? 0.4 : age >= DECLINE_START_AGE ? -0.4 : 0;
  if (!d) return def;
  const out: Defense = {};
  for (const q of FIELD_POS) if (def[q] !== undefined) out[q] = round1(def[q]! + d);
  return out;
}
