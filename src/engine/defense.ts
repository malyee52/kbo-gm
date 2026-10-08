// 수비 (M6 추가, 2026-10-08 사용자 요청): 포지션별 수비 능력과 경기 반영.
//
// 자료집에는 수비 기록이 없고 시즌별 주 포지션만 있다. 그래서 수비 능력은 기록에서 잰 값이 아니라
// 맡아 본 포지션(직전 3시즌), 주 포지션, 주력, 나이, 선수별로 고정된 운으로 만든 추정값이다 (모두 임시값).
//
// 단위: "그 포지션 평균 수비수 대비 한 시즌(주전 출전) 수비 런". +10이면 리그 정상급, -20이면 그 자리를 맡기 어렵다.
// 경기 반영: 그날 수비 8명의 합(팀 수비 런)만큼 인플레이 안타·실책 출루가 줄고, 포수 수비는 폭투·포일과 도루 저지에 쓴다.

import { Rng } from './rng';
import type { BatSkill, SimPlayer } from './types';

export const FIELD_POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;
export type FieldPos = (typeof FIELD_POS)[number];
export type Defense = Partial<Record<FieldPos, number>>;

/** 수비 난이도 순서 (클수록 어렵다). 포수는 따로 다룬다 */
const SPECTRUM: Record<FieldPos, number> = { C: 3, SS: 4, '2B': 3, CF: 3, '3B': 2.5, RF: 1.5, LF: 1, '1B': 0 };
const INFIELD = new Set<FieldPos>(['1B', '2B', '3B', 'SS']);
const OUTFIELD = new Set<FieldPos>(['LF', 'CF', 'RF']);

/** 포지션을 옮길 때의 수비 런 변화 (임시값). 해 본 포지션이면 손해가 1/4 (그 자리를 실제로 맡아 본 선수) */
export function moveRuns(from: FieldPos, to: FieldPos, played: boolean): number {
  if (from === to) return 0;
  let d: number;
  if (to === 'C') d = -60; // 포수는 해 본 선수만 (경험 없는 선수의 포수 기용은 사실상 불가)
  else if (from === 'C') d = to === '1B' ? 0 : to === '3B' ? -4 : -8 - SPECTRUM[to] * 2;
  else {
    const gap = SPECTRUM[to] - SPECTRUM[from];
    // 쉬운 자리로 가면 그 자리 평균보다 조금 낫고(최대 +5), 어려운 자리로 가면 크게 손해
    d = gap <= 0 ? Math.min(5, -gap) : -gap * 10;
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
export function makeDefense(id: string, pos: string | null, played: (string | null)[], speed: number, age: number | null, primaryPa = 0): Defense {
  const rng = new Rng(`defense/${id}`);
  const primary = fieldPosOf(pos);
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
  const out: Defense = {};
  for (const q of FIELD_POS) out[q] = round1(base + moveRuns(primary, q, exp.has(q)));
  return out;
}

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

/** 맡길 만한 포지션: 등급 40 이상 (그 자리 평균보다 5런 넘게 나쁘지 않음) */
export function playablePositions(def: Defense | undefined): FieldPos[] {
  if (!def) return [];
  return FIELD_POS.filter((q) => (def[q] ?? -99) >= -5).sort((a, b) => (def[b] ?? 0) - (def[a] ?? 0));
}

/** 수비 나이 변화 (오프시즌, 임시값): 25세 이하는 조금 늘고 31세부터 해마다 0.5런씩 준다 */
export function ageDefense(def: Defense, age: number): Defense {
  const d = age <= 25 ? 0.4 : age >= 31 ? -0.5 : 0;
  if (!d) return def;
  const out: Defense = {};
  for (const q of FIELD_POS) if (def[q] !== undefined) out[q] = round1(def[q]! + d);
  return out;
}
