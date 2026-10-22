// 기여(런)를 20~80 등급으로 (잠재력·종합 능력 표시용).
// 2026-10-12 기준표(tools/war.ts·tools/benchmark_peaks.ts)와 같은 눈금으로 바꿨다: 등급 = 40 + 5 × 승, 승 = 런 → 실제 시즌 WAR 직선 맞춤
// (타자 2,334시즌, tools/calibrate_value.ts: 승 = −0.49 + 0.108 × 런), 그리고 그 해 리그 수준(engine/eras.ts leagueQuality)을 곱한다.
// 2승(평균 주전, 약 23런) = 50, 4승(약 41런) = 60, 6승(약 60런) = 70, 8승(약 79런) 이상 = 80.
// 예전: 15런 = 50, 1런마다 0.45 (같은 날 등급 폭을 한 번 넓힌 값).
import { leagueQuality, Rng } from '../engine';

const WAR_PER_RUN = 0.108;
const WAR_AT_ZERO = -0.49;

/** 런을 승수(WAR 눈금)로. year를 주면 그 해 리그 수준을 곱한다 */
export function runsWar(runs: number, year?: number): number {
  return (WAR_AT_ZERO + WAR_PER_RUN * runs) * (year === undefined ? 1 : leagueQuality(year));
}

export function runsGrade(runs: number, year?: number): number {
  return Math.max(20, Math.min(80, Math.round(40 + 5 * runsWar(runs, year))));
}

// ---- 잠재 표시 (2026-10-23 UI 2단계 결정 5): 27세 이하는 범위 "55~65".
// 범위 가운데는 실제 잠재가 아니라 스카우트 짐작값이라, 실제 값이 범위 밖일 때도 있다 (정답 경계가 드러나지 않게).
// 짐작값: 신인처럼 스카우트 평가(scoutPotential)가 있으면 그 값, 없으면 실제 값에 스카우트 오차(SCOUT_NOISE, ±런)만큼
// 선수마다 정해진 어긋남을 더한다 (게임 시드 + 선수 id로 Rng를 만들어 같은 게임에서는 늘 같다).
// 범위 반폭 = 오차 × POT_RANGE_SCALE이라, 어긋남이 그보다 크면 실제 값이 밖에 있다 (균등 분포에서 약 25%).
// 28~30세는 숫자 하나, 31세 이상은 숨긴다 (오프시즌 화면 규칙과 같다).

export const POT_RANGE_AGE = 27;
/** 범위 반폭 = 스카우트 오차 × 이 값 (임시값) */
export const POT_RANGE_SCALE = 0.75;
export const POT_HIDE_AGE = 31;
/** 범위 최소 폭 (등급, 임시값). 스카우트 투자 최고 단계(오차 ±2런)에서도 숫자 하나로 줄지 않게 */
export const POT_MIN_SPAN = 2;

export type PotentialView = { kind: 'range'; lo: number; hi: number; guess: number } | { kind: 'one'; v: number } | null;

/** 스카우트가 보는 잠재(런): 스카우트 평가가 있으면 그 값, 없으면 실제 값 + 선수마다 정해진 어긋남 (±noise) */
export function scoutGuessRuns(p: { id: string; potential: number; scoutPotential?: number }, seed: string, noise: number): number {
  if (p.scoutPotential !== undefined) return p.scoutPotential;
  return p.potential + new Rng(`scout-range:${seed}:${p.id}`).range(-noise, noise);
}

export function potentialView(
  p: { id: string; potential: number; scoutPotential?: number }, age: number | null, opts: { seed: string; noise: number; year?: number },
): PotentialView {
  if (age !== null && age >= POT_HIDE_AGE) return null;
  if (age === null || age > POT_RANGE_AGE) return { kind: 'one', v: runsGrade(p.scoutPotential ?? p.potential, opts.year) };
  const guess = scoutGuessRuns(p, opts.seed, opts.noise);
  const w = opts.noise * POT_RANGE_SCALE;
  // 27세 이하는 늘 범위 꼴 (2026-10-23 클사장 결정): 20·80 끝에 걸려 숫자 하나로 줄면 28~30세처럼 읽히므로,
  // 끝을 넘은 만큼 범위를 눈금 안으로 밀어 폭(스카우트 오차, 최소 POT_MIN_SPAN)을 지킨다. 예: 23세 "80" → "75~80"
  const raw = (r: number) => Math.round(40 + 5 * runsWar(r, opts.year));
  let lo = raw(guess - w);
  let hi = raw(guess + w);
  const span = Math.min(60, Math.max(POT_MIN_SPAN, hi - lo));
  if (hi - lo < span) { lo = Math.floor((lo + hi - span) / 2); hi = lo + span; }
  if (hi > 80) { hi = 80; lo = Math.min(lo, 80 - span); }
  if (lo < 20) { lo = 20; hi = Math.max(hi, 20 + span); }
  lo = Math.max(20, lo);
  hi = Math.min(80, hi);
  return { kind: 'range', lo, hi, guess: Math.max(lo, Math.min(hi, runsGrade(guess, opts.year))) };
}

/** 잠재 표시 글자: "55~65" / "61" / null(숨김) */
export function potentialText(v: PotentialView): string | null {
  if (!v) return null;
  if (v.kind === 'one') return String(v.v);
  return `${v.lo}~${v.hi}`;
}
