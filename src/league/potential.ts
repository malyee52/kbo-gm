// 잠재력 v2: 숨은 천장(종합 천장 PA, 런)과 숨은 성장 성향 d (능력치 v2 기획안 17·18장, 사용자 2026-10-24 확정).
//
// - 천장은 리그를 만들 때(새 게임, 신인 입단) 한 번 뽑고 바뀌지 않는다. 지금 능력은 천장을 넘지 않는다 (Q3).
//   뽑기는 Rng만, 시드 `${리그 시드}/pa/${선수 ID}`라 같은 리그 시드면 같은 천장, 다른 새 게임이면 다른 천장.
// - 실존 선수 (시작 연도 전 기록만 본다, 18.2): 한 시즌 가치 2승+ = 고정(보여 준 고점이 바닥, 폭은 나이 폭 ½),
//   8승+ = 극단(폭 0, d ¼), 나머지 = 범위(중심 = max(시작 전 고점, 지금 + 여유분, 나이 바닥, 지명 순위 바닥), 두 배 폭 × 표본 배율).
// - 시작 연도 뒤 지명 신인·시작 연도 국내 신인 (18.3): 지명 순위 표가 중심 + 실제 커리어 고점 쪽으로 ¼ (Q10 ②),
//   지금 능력은 중심에서 학력 시작 식(18.5)만큼 뺀다 (천장을 흘리지 않게).
// - 숨은 성장 성향 d ∈ [−1, 1] (17.4 ②): 모든 선수 판마다. 성장 속도와 천장 도달 몫에만 쓰고 화면·알림·AI 가치 어디에도 쓰지 않는다.
// 등급 = 40 + 5 × 승 (ui/grades.ts와 같은 눈금: 승 = −0.49 + 0.108 × 런, 그 해 리그 수준을 곱함).

import type { DataStore, DraftRow, PlayerMaster } from '../data/types';
import { DEFAULT_PARAMS, leagueQuality, Rng, type EngineParams, type SimPlayer } from '../engine';
import { batWarOf, pitWarOf, realEnvOf } from './war';
import type { CareerIndex } from './growth';

type PotParams = EngineParams['potential'];

export const WAR_PER_RUN = 0.108;
export const WAR_AT_ZERO = -0.49;

/** 런 → 승수 (WAR 눈금). year를 주면 그 해 리그 수준을 곱한다 */
export function runsWar(runs: number, year?: number): number {
  return (WAR_AT_ZERO + WAR_PER_RUN * runs) * (year === undefined ? 1 : leagueQuality(year));
}

/** 런 → 등급 (자르지 않은 값) */
export function runsGradeRaw(runs: number, year?: number): number {
  return 40 + 5 * runsWar(runs, year);
}

/** 등급 → 런 (runsGradeRaw의 거꾸로) */
export function gradeRuns(grade: number, year?: number): number {
  const q = year === undefined ? 1 : leagueQuality(year);
  return ((grade - 40) / 5 / q - WAR_AT_ZERO) / WAR_PER_RUN;
}

/** 런 단위 1등급 크기 (그 해 리그 수준) */
export function runsPerGrade(year?: number): number {
  return gradeRuns(41, year) - gradeRuns(40, year);
}

/** −1~+1 삼각 분포 (가운데가 가장 잦다) */
export function triangular(rng: Rng): number {
  return rng.next() + rng.next() - 1;
}

/** 다음 시즌 나이의 나이 폭 (등급) */
export function ageWidth(ageNext: number, pp: PotParams = DEFAULT_PARAMS.potential): number {
  const w = pp.width;
  return ageNext <= 21 ? w[0] : ageNext <= 24 ? w[1] : ageNext <= 27 ? w[2] : ageNext <= 31 ? w[3] : w[4];
}

/** 표본 배율: 기록이 적을수록 앞날을 모른다 (기록이 없으면 1 + extra) */
export function sampleScale(sample: number, pp: PotParams = DEFAULT_PARAMS.potential): number {
  return 1 + pp.sampleExtra * (1 - Math.min(1, Math.max(0, sample) / pp.sampleFull));
}

/** 범위 선수 나이 바닥 (등급, 28세부터 없음) */
export function ageFloorGrade(ageNext: number, pp: PotParams = DEFAULT_PARAMS.potential): number | null {
  const f = pp.ageFloor;
  return ageNext <= 21 ? f[0] : ageNext <= 24 ? f[1] : ageNext <= 27 ? f[2] : null;
}

// ---- 지명 순위 표 (18.3 ①, 2000~2016년 입단 지명자 992명의 커리어 최고 시즌 가치 실측. 중심 등급 고졸 / 대졸)

const RANK_TABLE: { upTo: number; hs: number; univ: number }[] = [
  { upTo: 4, hs: 51, univ: 45 },
  { upTo: 9, hs: 53, univ: 47 },
  { upTo: 19, hs: 51, univ: 50 },
  { upTo: 39, hs: 45, univ: 46 },
  { upTo: 79, hs: 45, univ: 44 },
  { upTo: Infinity, hs: 44, univ: 44 },
];

/** 지명 순위(0부터, 당시 평가 순)의 천장 중심 등급 */
export function rankCenterGrade(rank: number, univ: boolean): number {
  const row = RANK_TABLE.find((r) => rank <= r.upTo)!;
  return univ ? row.univ : row.hs;
}

/** 맨 앞 묶음 (1차·우선·고졸연고·특별·해외 특별): 라운드 지명보다 앞, 묶음 안은 묶음 가운데 순위 */
const FRONT_KINDS = new Set(['1차', '우선', '고졸연고', '특별', '해외']);

/**
 * 그 해 지명의 당시 평가 순위 (0부터). 자료 순서는 1차 지명이 라운드 지명 뒤에 섞인 해가 있어 다시 줄 세운다 (18.1).
 * 육성선수는 순위 표 맨 끝 줄로 본다. 원년 멤버는 순위가 없다 (null)
 */
export function draftRank(rows: DraftRow[], d: DraftRow): number | null {
  if (d.kind === '원년 멤버') return null;
  const front = rows.filter((r) => FRONT_KINDS.has(r.kind));
  const rounds = rows.filter((r) => r.kind === '라운드').sort((a, b) => (a.overall ?? 1e9) - (b.overall ?? 1e9) || (a.round ?? 99) - (b.round ?? 99));
  if (FRONT_KINDS.has(d.kind)) return (front.length - 1) / 2;
  if (d.kind === '라운드') return front.length + rounds.indexOf(d);
  return front.length + rounds.length;
}

export interface DraftInfo { rank: number; univ: boolean; entryYear: number; kind: string }

/**
 * 선수 ID → 지명 정보. 자료 단계에서 이은 pid를 먼저, 없으면 이름과 입단 연도 ±1이 하나뿐인 마스터로 맞춘다.
 * 같은 선수가 여러 번 지명됐으면(대학 진학 뒤 다시 지명 등) 입단한 해(가장 늦은 지명)를 쓴다
 */
export function draftIndex(store: Pick<DataStore, 'drafts' | 'players'>): Map<string, DraftInfo> {
  const out = new Map<string, DraftInfo>();
  const byName = new Map<string, PlayerMaster[]>();
  for (const m of store.players.values()) if (!m.foreign) (byName.get(m.name) ?? byName.set(m.name, []).get(m.name)!).push(m);
  const years = Object.keys(store.drafts ?? {}).map(Number).sort((a, b) => a - b);
  for (const y of years) {
    const rows = store.drafts![String(y)];
    for (const d of rows) {
      const rank = draftRank(rows, d);
      if (rank === null) continue;
      let id = d.pid;
      if (!id && d.games > 0) {
        const c = (byName.get(d.name) ?? []).filter((m) => Math.abs(m.entryYear - y) <= 1);
        if (c.length === 1) id = c[0].id;
      }
      if (id) out.set(id, { rank, univ: d.univ, entryYear: y, kind: d.kind });
    }
  }
  return out;
}

/** 지명 순위 표 중심 (런, 입단 해 리그 수준) */
export function rankCenterRuns(info: Pick<DraftInfo, 'rank' | 'univ' | 'entryYear'>): number {
  return gradeRuns(rankCenterGrade(info.rank, info.univ), info.entryYear);
}

// ---- 시작 연도 전 기록

/** 시작 연도 전 시즌마다 시즌 가치(승, 리그 수준 곱함)를 내 가장 큰 값. 기록이 없으면 null */
export function bestSeasonWar(p: Pick<SimPlayer, 'id' | 'isPitcher' | 'pos'>, idx: CareerIndex, store: Pick<DataStore, 'meta' | 'season'>, before: number): number | null {
  let best: number | null = null;
  const take = (w: number) => { if (best === null || w > best) best = w; };
  if (p.isPitcher) {
    for (const { year, row } of idx.pit.get(p.id) ?? []) if (year < before) take(pitWarOf(row, realEnvOf(store, year), leagueQuality(year)));
  } else {
    for (const { year, row } of idx.bat.get(p.id) ?? []) if (year < before) take(batWarOf(row, row.pos ?? p.pos, realEnvOf(store, year), leagueQuality(year)));
  }
  return best;
}

/** 직전 3시즌 1군 표본 (타자 타석, 투수 상대 타자) */
export function recentSample(p: Pick<SimPlayer, 'id' | 'isPitcher'>, idx: CareerIndex, before: number): number {
  let n = 0;
  if (p.isPitcher) { for (const { year, row } of idx.pit.get(p.id) ?? []) if (year < before && year >= before - 3) n += row.tbf; }
  else for (const { year, row } of idx.bat.get(p.id) ?? []) if (year < before && year >= before - 3) n += row.pa;
  return n;
}

// ---- 천장 뽑기

export type CeilingKind = 'extreme' | 'fixed' | 'range';

export interface RealCeilingInput {
  id: string;
  /** 지금 능력 (런) */
  now: number;
  /** 시작 연도 전 실제 고점 (realPeakRuns before) */
  peakBefore: number | null;
  /** 시작 연도 전 한 시즌 최고 가치 (승) */
  bestWar: number | null;
  /** 시작 시즌 나이 (모르면 null = 28세로 봄) */
  age: number | null;
  /** 직전 3시즌 표본 */
  sample: number;
  /** 시작 시즌 (등급 눈금 해) */
  year: number;
  /** 성장 여유분 가운데값 (런, growthRoom(시작 연도 나이)) */
  room: number;
  draft?: DraftInfo;
}

/**
 * 시작 연도 실존 선수의 천장 (18.2·18.4). 시작 연도 전 기록만 쓰므로 자료를 시작 연도에서 잘라도 같은 값이다.
 * 돌려주는 kind는 시험·보고용 (어디에도 보이지 않는다)
 */
export function realCeiling(x: RealCeilingInput, seed: string, pp: PotParams = DEFAULT_PARAMS.potential): { potential: number; kind: CeilingKind } {
  const ageNext = (x.age ?? 27) + 1;
  const z = triangular(new Rng(`${seed}/pa/${x.id}`));
  const g = runsPerGrade(x.year);
  const base = Math.max(x.peakBefore ?? -Infinity, x.now + x.room);
  const war = x.bestWar ?? -Infinity;
  if (war >= pp.extremeWar) return { potential: Math.max(x.now, base), kind: 'extreme' };
  if (war >= pp.fixWar) {
    const w = ageWidth(ageNext, pp) * pp.fixedWidth * g;
    return { potential: Math.max(x.now, x.peakBefore ?? -Infinity, base + w * z), kind: 'fixed' };
  }
  const floors: number[] = [];
  const af = ageFloorGrade(ageNext, pp);
  if (af !== null) floors.push(gradeRuns(af, x.year));
  if (x.draft) floors.push(rankCenterRuns({ ...x.draft, entryYear: x.year }) - pp.rankDecay * Math.max(0, x.year - x.draft.entryYear));
  const center = Math.max(base, ...floors);
  const w = ageWidth(ageNext, pp) * sampleScale(x.sample, pp) * g;
  return { potential: Math.max(x.now, center + w * z), kind: 'range' };
}

/**
 * 지명 신인의 천장 중심 (18.3 ①·②): 순위 표 중심 + k × (실제 커리어 고점 − 표 중심), 실제 고점이 낮으면 당기지 않는다.
 * realPeak는 그 선수의 자료 끝까지 커리어 고점 (미래 지명 신인은 미래 기록, k만큼만 쓴다)
 */
export function drafteeCenter(info: Pick<DraftInfo, 'rank' | 'univ' | 'entryYear'>, realPeak: number | null, pp: PotParams = DEFAULT_PARAMS.potential): number {
  const c = rankCenterRuns(info);
  return realPeak !== null && realPeak > c ? c + pp.rankPull * (realPeak - c) : c;
}

/** 입단 전 경로 */
export type EntryPath = 'hs' | 'univ' | 'abroad' | 'other';

/**
 * 입단 때 지금 능력이 천장 중심에서 얼마나 아래인가 (런, 18.5): 고졸 18세 격차 × (1 − 한 해 성장 몫)^(입단 전 해 수 × 경로 배율).
 * hsGap: 고졸 18세 여유분 가운데값 (growthRoom(18)). years: 입단 전 해 수 (고졸 0, 대졸 4)
 */
export function entryGap(hsGap: number, years: number, path: EntryPath, pp: PotParams = DEFAULT_PARAMS.potential): number {
  const c = path === 'univ' ? pp.eduPath.univ : path === 'abroad' ? pp.eduPath.abroad : path === 'other' ? pp.eduPath.other : 0;
  return hsGap * (1 - pp.eduRate) ** (Math.max(0, years) * c);
}

/**
 * 신인 천장: max(지금, 중심 + 입단 나이 폭 × 표본 배율(기록 없음) × z). 시드는 실존 선수와 같은 `pa` 줄기
 */
export function drafteeCeiling(id: string, center: number, start: number, ageNext: number, year: number, seed: string, pp: PotParams = DEFAULT_PARAMS.potential): number {
  const z = triangular(new Rng(`${seed}/pa/${id}`));
  return Math.max(start, center + ageWidth(ageNext, pp) * sampleScale(0, pp) * runsPerGrade(year) * z);
}

/** 숨은 성장 성향 d (17.4 ②). 극단 선수는 extremeDrive만큼 줄인다 */
export function driveOf(seed: string, id: string, extreme = false, pp: PotParams = DEFAULT_PARAMS.potential): number {
  const d = triangular(new Rng(`${seed}/drive/${id}`)) * (extreme ? pp.extremeDrive : 1);
  return Math.round(d * 1000) / 1000;
}

/** 성장 배율: 속도 × 천장 도달 몫 ρ (ρ ≤ 1, 17.2·17.4 ②). d가 없으면(가상 판정·AI) 0으로 본다 */
export function driveScale(d: number | undefined, pp: PotParams = DEFAULT_PARAMS.potential): number {
  const x = d ?? 0;
  return (1 + pp.driveSpeed * x) * Math.min(1, pp.reachBase + pp.reachDrive * x);
}

/**
 * 성장 뒤 능력을 천장에서 자른다 (Q3, 터지는 해·운·코치·육성 몫 포함): 천장 위로는 자라지 않는다.
 * 이미 천장보다 높으면(부상 후유증으로 천장이 깎인 선수 등) 오르지만 않게 둔다 (내려오는 것은 expectedGrowth의 몫)
 */
export function capAtCeiling(next: number, before: number, potential: number): number {
  if (next <= potential) return next;
  return Math.max(potential, Math.min(next, before));
}

/**
 * 입단 전 경로와 해 수 (18.5). hsAge: 고졸 입단 나이 (가상 신인 18, 실존 선수는 출생 연도 차라 19).
 * 학력 자료가 없으면 고졸 나이 + 4 이상이면 대졸 꼴로 본다
 */
export function entryPathOf(school: 'HS' | 'UNIV' | null | undefined, age: number, hsAge: number, abroad = false): { path: EntryPath; years: number } {
  const years = Math.max(0, age - hsAge);
  if (abroad) return { path: 'abroad', years };
  if (school === 'UNIV' || (!school && years >= 4)) return { path: 'univ', years };
  if (years <= 1) return { path: 'hs', years: 0 };
  return { path: 'other', years };
}
