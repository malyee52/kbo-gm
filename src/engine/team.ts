// 선수 기용: 1군 엔트리, 선발 라인업, 타순, 선발 로테이션, 불펜.
// 경기 중 작전은 AI 감독이 처리한다는 기획에 따라 플레이어 구단도 같은 규칙을 쓴다.

import { BULLPEN_AVAILABLE_BELOW, BULLPEN_RECOVERY_PER_DAY, BULLPEN_THIRD_DAY_BELOW, isStarterSkill } from './params';
import type { Rates, YearRules } from '../data/types';
import { eraPitching } from './eras';
import type { BodyParams, EngineParams } from './params';
import { overuseDecay, type OveruseParams } from './injury';
import type { Rng } from './rng';
import { defenseAt, fitPenalty } from './defense';
import { batValue, pitValue } from './ratings';
import type { BatLine, PitLine, SimPlayer, SimTeam, World } from './types';

/** 시즌 중 바뀌는 선수 상태. 색인은 SimPlayer.idx */
export interface PlayerStates {
  /** 이 날짜 전까지 결장 */
  absentUntil: Int32Array;
  /** 불펜 피로도(공 수)와 그 값을 기록한 날짜. 하루에 BULLPEN_RECOVERY_PER_DAY씩 회복 (params.ts) */
  fatigue: Float32Array;
  fatigueDay: Int32Array;
  /** fatigueDay까지 연속으로 던진 날 수 (연투 관리) */
  streak: Int32Array;
  lastStartDay: Int32Array;
  /** 혹사지수 (투수, fatigueDay에 기록한 값. 기획안 4.6). 등판 없는 날이 이어지면 overuseDecay만큼 빠진다 */
  overuse: Float32Array;
  /** 투구 피로 하루 회복량 배율 (혹사지수로 정한다, 1 = 보통). 숨은 능력 '회복력'(16단계)이 곱해질 자리 */
  recoverMul: Float32Array;
  /** 야수 피로 (경기 단위, 엔진 2 11단계)와 그 값을 기록한 날짜. 하루에 params.body.recover씩 빠진다 */
  body: Float32Array;
  bodyDay: Int32Array;
  /** 컨디션의 흐름 (엔진 2 12단계, condition.ts). 시즌이 날마다 한 걸음씩 옮긴다 (Season.condDay). 사건 몫은 GameContext.condEvent */
  cond: Float32Array;
}

export function newPlayerStates(n: number): PlayerStates {
  return {
    absentUntil: new Int32Array(n),
    fatigue: new Float32Array(n),
    fatigueDay: new Int32Array(n),
    streak: new Int32Array(n),
    lastStartDay: new Int32Array(n).fill(-99),
    overuse: new Float32Array(n),
    recoverMul: new Float32Array(n).fill(1),
    body: new Float32Array(n),
    bodyDay: new Int32Array(n).fill(-99),
    cond: new Float32Array(n),
  };
}

/** 오늘 경기 전 야수 피로 */
export function currentBody(st: PlayerStates, idx: number, day: number, body: BodyParams): number {
  return Math.max(0, st.body[idx] - body.recover * (day - st.bodyDay[idx]));
}

/** 오늘 경기 전 혹사지수 (마지막 등판 뒤 쉰 날만큼 빠진 값) */
export function currentOveruse(st: PlayerStates, idx: number, day: number, o: OveruseParams): number {
  const v = st.overuse[idx];
  return v > 0 ? v * overuseDecay(day - st.fatigueDay[idx], o) : 0;
}

export { BULLPEN_AVAILABLE_BELOW as FATIGUE_AVAILABLE_BELOW, BULLPEN_RECOVERY_PER_DAY as FATIGUE_RECOVERY_PER_DAY } from './params';

/**
 * 어제까지 이틀 연속 던졌고 아직 덜 회복해 오늘 쉬어야 하는가 (3연투는 짧게 던진 날 뒤에만).
 * pen: 감독 성향 '불펜 연투 허용' (엔진 2 10단계, 1이면 기준 그대로, 클수록 3연투를 더 허용)
 */
export function needsRest(st: PlayerStates, idx: number, day: number, pen = 1): boolean {
  // 어제 경기 뒤 피로(오늘 회복 전)로 본다: 이틀 모두 짧게 던졌으면 사흘째도 나온다
  return st.fatigueDay[idx] === day - 1 && st.streak[idx] >= 2 && st.fatigue[idx] >= BULLPEN_THIRD_DAY_BELOW * pen;
}

/**
 * 등판할 수 있는 경기 전 피로 기준 (공). pen(감독 성향 '불펜 연투 허용')은 "전날 몇 구까지 던졌으면 오늘도 나오나"
 * (회복량 + 기준 = 15구)에 곱한다. 1이면 BULLPEN_AVAILABLE_BELOW 그대로
 */
export function availableBelow(pen = 1): number {
  return pen === 1 ? BULLPEN_AVAILABLE_BELOW : (BULLPEN_RECOVERY_PER_DAY + BULLPEN_AVAILABLE_BELOW) * pen - BULLPEN_RECOVERY_PER_DAY;
}

/** 오늘 경기 전 피로 (공 수). 하루 회복량에 혹사 배율(recoverMul)을 곱한다. 회복력(숨은 능력, 지금은 모두 1.00) 자리 */
export function currentFatigue(st: PlayerStates, idx: number, day: number): number {
  return Math.max(0, st.fatigue[idx] - BULLPEN_RECOVERY_PER_DAY * st.recoverMul[idx] * (day - st.fatigueDay[idx]));
}

export interface TeamSeason {
  team: SimTeam;
  /** 1군 야수 (가치 높은 순) */
  hitters: SimPlayer[];
  rotation: SimPlayer[];
  /** 1군 구원 투수 (좋은 순 = value 낮은 순) */
  bullpen: SimPlayer[];
  closer: SimPlayer | null;
  /** 엔트리를 다시 짜야 하는 가장 이른 날짜 (결장 선수 복귀일) */
  nextReturnDay: number;
  dirty: boolean;
  /**
   * 플레이어가 직접 정한 1군 명단 (선수 색인). 있으면 이 명단 안에서만 기용하고, 없으면 AI가 엔트리를 짠다.
   * 라인업·로테이션·투수 교체는 어느 쪽이든 AI 감독이 정한다.
   */
  manual?: Set<number> | null;
  /** 직접 정한 1군만으로 경기를 치를 수 없어 이번에 2군에서 임시로 올린 선수 */
  callUps?: SimPlayer[];
  /** 오늘 경기의 수비 배치 (선수 색인 → 자리). todaysLineup이 정한다 */
  field?: Map<number, Slot>;
  /** 배치 계산 결과 저장 (쉬는 선수 조합 → 배치). 1군을 다시 짜면 비운다. 난수를 쓰지 않으므로 결과에 영향이 없다 */
  lineupCache?: Map<string, { p: SimPlayer; slot: Slot }[]>;
  /** 플레이어가 정한 기용표 (주전 자리, 선발 로테이션, 마무리). 없으면 AI 감독이 정한다 */
  plan?: DepthPlan | null;
  /** 선발 등판 사이 최소 휴식일 (시대별, eras.ts). 없으면 params.starterRestDays */
  restDays?: number;
  /**
   * 감독 성향 배율 (league/managers.ts Tactics): 도루 시도, 희생번트, hook 투수 밀어붙이기(선발 투구 수 기준·여유), 없으면 모두 1.
   * sub = 대타·대주자 빈도 (엔진 2 9단계), pen = 불펜 연투 허용 (엔진 2 10단계). 없으면 1
   */
  /** cond: 컨디션 반영 (엔진 2 12단계), ibb: 고의4구 빈도 (엔진 2 13단계). 없으면 1 */
  tactics?: { steal: number; bunt: number; hook: number; sub?: number; pen?: number; cond?: number; ibb?: number };
  /** 오늘(마지막으로 엔트리를 짠 날) 원정 경기다. 방위병(homeOnlyUntil)이 빠진다 */
  away?: boolean;
  /** 마지막으로 엔트리를 짠 날의 엔트리 확대 인원 (YearRules.rosterExtra, Season.rosterExtraOn). 없으면 0 */
  rosterExtra?: number;
}

/**
 * 플레이어의 기용표 (2026-10-08 사용자 요청으로 추가). 선수 색인으로 적는다.
 * - starters: 자리별 주전. 쉬거나 결장한 날은 AI 감독이 나머지 1군 야수(서브) 중에서 그 자리를 채운다.
 * - rotation: 선발 로테이션. 뛸 수 있는 선발이 4명보다 적으면 AI가 채운다. 나머지 1군 투수는 중계.
 * - closer: 마무리. 없거나 못 나오면 AI가 정한다.
 * 타순과 경기 중 투수 교체는 그대로 AI 감독이 한다.
 */
/** 불펜 역할 (2026-10-12 사용자 요청): 필승조(접전 리드 7~8회), 롱릴리프(선발이 일찍 내려갈 때 길게), 패전조(점수 차 큰 경기) */
export type PenRole = 'SU' | 'LR' | 'MOP';

export interface DepthPlan {
  starters: Partial<Record<Slot, number>>;
  rotation: number[];
  closer: number | null;
  /** 불펜 역할 (투수 색인 → 역할). 정하지 않은 구원 투수는 AI 감독이 서열대로 나눈다 */
  pen?: Record<number, PenRole>;
  /** 타순 (1번부터 자리 순서). 그 자리에 나온 선수(결장 때는 서브)가 그 타순에 선다. 없으면 AI 감독이 정한다 (2026-10-11) */
  order?: Slot[];
}

/** 기용표 로테이션이 이보다 적게 남으면 AI가 채운다 */
export const MIN_PLAN_ROTATION = 4;

/** 직접 정한 1군에서 뛸 수 있는 선수가 이보다 적으면 2군에서 임시로 올린다 (임시값) */
export const MIN_ACTIVE_HITTERS = 10;
export const MIN_ACTIVE_PITCHERS = 9;

/** 주전 배치 순서 (희소한 자리부터). assignLineup 결과의 i번째 선수가 LINEUP_SLOTS[i]를 맡는다 */
export const LINEUP_SLOTS = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B', 'DH'] as const;
export type Slot = (typeof LINEUP_SLOTS)[number];

/** 타석 가치 1 = 한 시즌(600타석) 약 500런. 수비 런을 가치와 더할 때 쓴다 */
export const RUNS_PER_VALUE = 500;


/**
 * 최적 배정 (헝가리안 알고리즘): score[i][j]는 i번째 자리에 j번째 선수를 세운 점수. 점수 합이 가장 큰 배정을 찾는다.
 * 반환값[i] = i번째 자리에 세운 선수 번호 (선수가 모자라 비운 자리는 -1). 같은 입력이면 늘 같은 답.
 */
export function bestAssignment(score: number[][]): number[] {
  const nRows = score.length;
  const nCols = score[0]?.length ?? 0;
  const n = Math.max(nRows, nCols);
  if (n === 0) return [];
  // 정사각형으로 채우고 최소 비용 문제로 바꾼다 (빈 칸은 점수 0의 가짜 자리·선수)
  let maxScore = 0;
  for (const row of score) for (const v of row) if (v > maxScore) maxScore = v;
  const cost = (i: number, j: number) => (i < nRows && j < nCols ? maxScore - score[i][j] : maxScore);
  const INF = Number.POSITIVE_INFINITY;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(nRows).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] >= 1 && p[j] <= nRows && j <= nCols) out[p[j] - 1] = j - 1;
  return out;
}

/** 좌우 상성 (pa.ts platoonEdge와 같다): 같은 손이면 −1, 다른 손·양타면 +1, 모르면 0 */
export function platoonSign(bats: string | null, throws: string | null): number {
  if (!bats || !throws) return 0;
  if (bats === 'S') return 1;
  return bats === throws ? -1 : 1;
}

/** 상대 투수 손을 넣은 타자의 한 시즌 타격 런 (플래툰 라인업·대타 판단). 좌우 상성은 타석 보정(params.platoon)과 같은 비율 */
export function batRunsVs(p: SimPlayer, throws: string | null, platoon: number): number {
  return p.value * RUNS_PER_VALUE * (1 + platoonSign(p.bats, throws) * platoon);
}

/** 엔트리에서 수비 가능 2명을 맞추는 자리 (포수는 백업 포수 규칙이 따로) */
const BACKUP_SLOTS = ['SS', '2B', 'CF', '3B', '1B', 'LF', 'RF'] as const;

/** 자리 점수 → 한 시즌 런 단위: 타석 가치 × 500 + 그 자리 수비 런 + 수비 가능이 아닌 자리 벌점 */
export function slotRuns(p: SimPlayer, slot: Slot): number {
  return p.value * RUNS_PER_VALUE + defenseAt(p, slot) + fitPenalty(p, slot);
}

/**
 * 자리에 야수를 배정한다. 9개 자리 전체의 (타격 + 그 자리 수비) 합이 가장 큰 배정 (헝가리안 알고리즘).
 * fixed: 미리 정해진 자리 (플레이어가 정한 주전). 반환값의 i번째 선수가 LINEUP_SLOTS[i]를 맡는다 (못 채운 자리는 빠진다).
 */
export function assignLineup(avail: SimPlayer[], fixed?: Map<Slot, SimPlayer>): SimPlayer[] {
  return assignSlots(avail, fixed).map((x) => x.p);
}

export function assignSlots(avail: SimPlayer[], fixed?: Map<Slot, SimPlayer>, runsOf: (p: SimPlayer, slot: Slot) => number = slotRuns): { p: SimPlayer; slot: Slot }[] {
  const taken = new Set<number>();
  for (const p of fixed?.values() ?? []) taken.add(p.idx);
  const openSlots = LINEUP_SLOTS.filter((s) => !fixed?.has(s));
  const pool = avail.filter((p) => !taken.has(p.idx));
  // 점수가 음수가 되지 않게 옮긴다 (배정 결과는 같다)
  const raw = openSlots.map((slot) => pool.map((p) => runsOf(p, slot)));
  let min = 0;
  for (const row of raw) for (const x of row) if (x < min) min = x;
  const pick = bestAssignment(raw.map((row) => row.map((x) => x - min + 1)));
  const bySlot = new Map<Slot, SimPlayer>(fixed ?? []);
  openSlots.forEach((slot, i) => { if (pick[i] >= 0) bySlot.set(slot, pool[pick[i]]); });
  return LINEUP_SLOTS.filter((s) => bySlot.has(s)).map((slot) => ({ p: bySlot.get(slot)!, slot }));
}

function onBaseScore(p: SimPlayer, lg: Rates): number {
  const b = p.bat!;
  return b.s1 * lg.s1 + b.d2 * lg.d2 + b.t3 * lg.t3 + b.hr * lg.hr + b.bb * lg.bb + b.hbp * lg.hbp;
}

/** 타순: 1·2번은 출루, 3번은 최고 타자, 4번은 장타, 나머지는 가치 순 */
export function battingOrder(nine: SimPlayer[], lg: Rates): SimPlayer[] {
  const rest = [...nine];
  const take = (score: (p: SimPlayer) => number): SimPlayer => {
    let bi = 0;
    for (let i = 1; i < rest.length; i++) if (score(rest[i]) > score(rest[bi])) bi = i;
    return rest.splice(bi, 1)[0];
  };
  if (rest.length < 9) return rest;
  const third = take((p) => p.value);
  const fourth = take((p) => p.bat!.hr * lg.hr * 3 + p.value);
  const first = take((p) => onBaseScore(p, lg) + 0.05 * p.bat!.speed);
  const second = take((p) => onBaseScore(p, lg));
  rest.sort((a, b) => b.value - a.value);
  return [first, second, third, fourth, ...rest];
}

/**
 * 구단의 1군 엔트리·한 경기 출장 인원·외국인 1군 한도(보유)·한 경기 출전 외국인 한도: 리그 규칙 + 창단 특례 (SimTeam.rosterBonus·foreignBonus)
 * + 그날 엔트리 확대 (extra, Season.rosterExtraOn). 창단 특례는 보유·출전 모두 1명 더 (NC 2014 4보유·3출전, kt 2015~2016 4보유·3출전, 자료집 제도연표).
 * 엔트리 특례와 확대는 등록·출장 모두에 더한다
 */
export function teamRules(world: Pick<World, 'rules'>, team: Pick<SimTeam, 'rosterBonus' | 'foreignBonus'>, extra = 0): { rosterSize: number; activeSize: number; foreignLimit: number; foreignActive: number } {
  const bonus = team.foreignBonus ?? 0;
  const roster = (team.rosterBonus ?? 0) + extra;
  return {
    rosterSize: world.rules.rosterSize + roster,
    activeSize: (world.rules.activeSize ?? world.rules.rosterSize) + roster,
    foreignLimit: world.rules.foreignLimit + bonus,
    foreignActive: world.rules.foreignActive + bonus,
  };
}

/** 엔트리 확대 일정 (YearRules.rosterExtra '716:1;825:5') → [월일, 인원] (월일 순) */
export function rosterExtraSteps(rules: Pick<YearRules, 'rosterExtra'>): [number, number][] {
  if (!rules.rosterExtra) return [];
  return rules.rosterExtra.split(';').map((x) => x.split(':').map(Number) as [number, number]).sort((a, b) => a[0] - b[0]);
}

/** 그날(월×100 + 일) 엔트리 확대 인원 (마지막으로 시작한 칸) */
export function rosterExtraAt(rules: Pick<YearRules, 'rosterExtra'>, md: number): number {
  let n = 0;
  for (const [from, plus] of rosterExtraSteps(rules)) if (md >= from) n = plus;
  return n;
}

function pitcherCount(rosterSize: number): number {
  if (rosterSize >= 28) return 14;
  if (rosterSize === 27) return 13;
  return 12;
}

/** 외국인 보유 한도 안에서 쓸 외국인을 고른다. 투수 2명을 먼저, 그다음 타자 순으로 번갈아 채운다 */
function allowedForeigners(avail: SimPlayer[], limit: number): Set<number> {
  const fp = avail.filter((p) => p.foreign && p.isPitcher).sort((a, b) => a.value - b.value);
  const fh = avail.filter((p) => p.foreign && !p.isPitcher).sort((a, b) => b.value - a.value);
  const pattern = ['P', 'P', 'H', 'H', 'P', 'H'];
  const out = new Set<number>();
  let k = 0;
  while (out.size < limit && (fp.length || fh.length)) {
    const want = pattern[k++ % pattern.length];
    const src = want === 'P' ? (fp.length ? fp : fh) : fh.length ? fh : fp;
    out.add(src.shift()!.idx);
  }
  return out;
}

/** 엔트리 순환 주기 (일정 색인 일수) */
export const CHURN_DAYS = 10;

/**
 * 0~1 해시 (FNV-1a + murmur3 마무리 섞기). 엔트리 순환이 난수 흐름을 건드리지 않게.
 * 2026-10-21: 마무리 섞기 추가. FNV-1a만 쓰면 끝 글자(주기 번호)만 다른 문자열의 값이 서로 붙어 있어서,
 * 같은 투수가 시즌 내내 순환으로 빠지거나(2026 KT 배제성: 17주기 모두, 시드와 상관없이 0이닝) 한 번도 빠지지 않았다
 */
export function unitHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * 엔트리 순환 (2026-10-13, docs/temp-values.md 팀 실점 퍼짐의 남은 몫): 직접 정하지 않은 1군은 CHURN_DAYS일마다
 * 국내 투수 몇 명이 부진·피로·잔부상으로 2군에 내려가고 다음 투수가 올라온다 (확률 churn). 실제로는 약한 투수도 꽤 던진다.
 * 해시로 정해 난수 흐름과 저장·재현에 영향이 없다
 */
export function churnedOut(world: World, p: SimPlayer, day: number, churn: number, slump?: ArrayLike<number> | null, batChurn = 0): boolean {
  if (p.foreign) return false;
  if (!p.isPitcher) {
    // 야수는 부진한 타자만 (slumpingHitters, 첫 시즌 밸런스 3차). 부진 목록이 없으면 내려가지 않는다
    if (batChurn <= 0 || !slump || !slump[p.idx]) return false;
    return unitHash(`${world.year}/${p.id}/${Math.floor(day / CHURN_DAYS)}`) < batChurn;
  }
  if (churn <= 0) return false;
  // 부진한 투수만 (slumpingPitchers). 잘 던지는 투수는 에이스든 아니든 내려가지 않는다
  if (slump && !slump[p.idx]) return false;
  return unitHash(`${world.year}/${p.id}/${Math.floor(day / CHURN_DAYS)}`) < churn;
}

/** 이 시즌(또는 지난 시즌) 세이브가 이만큼 이상이면 마무리로 보고 부진 기준을 churnSlump.closerRatio배로 늦춘다 (임시값) */
const CLOSER_SLUMP_SAVES = 5;

/**
 * 엔트리 순환 대상인 부진한 투수 (선수 색인 → 1). 그 시즌 기록(pit)으로 정한다. 난수를 쓰지 않는다.
 * 평균자책을 리그 평균자책 쪽으로 rule.priorOuts아웃만큼 당긴 값이 리그 평균자책 × rule.eraRatio 이상이고 아웃이 rule.minOuts 이상이면 부진
 */
export function slumpingPitchers(world: World, pit: readonly PitLine[], rule: { minOuts: number; priorOuts: number; eraRatio: number; closerRatio?: number }): Uint8Array {
  const out = new Uint8Array(world.players.length);
  let er = 0, outs = 0;
  for (const q of pit) { er += q.er; outs += q.outs; }
  if (outs <= 0) return out;
  const lg = (er * 27) / outs;
  for (const p of world.players) {
    if (!p.isPitcher) continue;
    const q = pit[p.idx];
    if (!q || q.outs < rule.minOuts) continue;
    const era = (q.er * 27 + rule.priorOuts * lg) / (q.outs + rule.priorOuts);
    // 세이브를 쌓는 마무리는 웬만큼 부진해도 내리지 않는다 (closerRatio배, 첫 시즌 밸런스 3차)
    const ratio = q.sv >= CLOSER_SLUMP_SAVES || p.lastSaves >= CLOSER_SLUMP_SAVES ? rule.eraRatio * (rule.closerRatio ?? 1) : rule.eraRatio;
    if (era >= lg * ratio) out[p.idx] = 1;
  }
  return out;
}

/**
 * 엔트리 순환 대상인 부진한 타자를 out에 표시한다 (선수 색인 → 1, 첫 시즌 밸런스 3차). 그 시즌 기록(bat)으로 정한다. 난수를 쓰지 않는다.
 * OPS를 리그 OPS 쪽으로 rule.priorPa타석만큼 당긴 값이 리그 OPS × rule.opsRatio 이하이고 타석이 rule.minPa 이상이면 부진
 */
export function slumpingHitters(world: World, bat: readonly BatLine[], rule: { minPa: number; priorPa: number; opsRatio: number }, out: Uint8Array): void {
  const ops = (b: { h: number; d: number; t: number; hr: number; ab: number; bb: number; hbp: number; sf: number }) => {
    const obpDen = b.ab + b.bb + b.hbp + b.sf;
    return (obpDen > 0 ? (b.h + b.bb + b.hbp) / obpDen : 0) + (b.ab > 0 ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0);
  };
  const lg = { h: 0, d: 0, t: 0, hr: 0, ab: 0, bb: 0, hbp: 0, sf: 0, pa: 0 };
  for (const b of bat) for (const k of Object.keys(lg) as (keyof typeof lg)[]) lg[k] += b[k];
  if (lg.pa <= 0) return;
  const lgOps = ops(lg);
  for (const p of world.players) {
    if (p.isPitcher) continue;
    const b = bat[p.idx];
    if (!b || b.pa < rule.minPa) continue;
    const w = b.pa / (b.pa + rule.priorPa);
    if (w * ops(b) + (1 - w) * lgOps <= lgOps * rule.opsRatio) out[p.idx] = 1;
  }
}

/**
 * 그날 뛸 수 있는 선수로 1군 엔트리를 짠다. churn: 엔트리 순환 확률 (EngineParams.rosterChurn, 직접 정한 1군에는 쓰지 않는다).
 * slump: 순환 대상인 부진한 투수 (slumpingPitchers). 없으면 모든 국내 투수가 대상
 */
export function refreshActive(ts: TeamSeason, world: World, st: PlayerStates, day: number, churn = 0, jitter = 0, slump: ArrayLike<number> | null = null, extra = 0, batChurn = 0): void {
  const { rosterSize, foreignLimit: limit } = teamRules(world, ts.team, extra);
  ts.rosterExtra = extra;
  const manual = ts.manual ?? null;
  const rotating = !manual && (churn > 0 || batChurn > 0);
  // 육성선수는 1군에 못 나간다 (정식 등록 전)
  // 방위병(1982~1994)은 원정 경기에 못 나간다 (league/careers.ts)
  const ready = (p: SimPlayer) => st.absentUntil[p.idx] <= day && !p.dev && !(rotating && churnedOut(world, p, day, churn, slump, batChurn))
    && !(ts.away && p.homeOnlyUntil !== undefined && p.homeOnlyUntil > day);
  const availAll = ts.team.org.filter((p) => ready(p) && (!manual || manual.has(p.idx)));
  ts.callUps = [];
  if (manual) {
    // 직접 정한 1군만으로 모자라면 2군에서 가장 나은 선수를 임시로 올린다
    const callUp = (isPitcher: boolean, need: number) => {
      const have = availAll.filter((p) => p.isPitcher === isPitcher).length;
      if (have >= need) return;
      // 외국인은 보유 한도 안에서만 올린다: 한도를 넘는 외국인을 올리면 아래에서 다시 빠져 인원이 모자란다
      // (2026-10-12 버그: 2군 외국인 타자 둘을 올렸다가 빠져 라인업이 8명이 되어 경기가 멈췄다)
      const cand = ts.team.org
        .filter((p) => p.isPitcher === isPitcher && !manual.has(p.idx) && ready(p))
        .sort((a, b) => (isPitcher ? a.value - b.value : b.value - a.value));
      let foreign = availAll.filter((p) => p.foreign).length;
      for (const p of cand) {
        if (availAll.filter((x) => x.isPitcher === isPitcher).length >= need) break;
        if (p.foreign && foreign >= limit) continue;
        if (p.foreign) foreign++;
        availAll.push(p);
        ts.callUps!.push(p);
      }
    };
    callUp(false, MIN_ACTIVE_HITTERS);
    callUp(true, MIN_ACTIVE_PITCHERS);
  }
  // 뛸 수 있는 선수가 모자라면 결장 중인 선수라도 복귀가 가까운 순으로 채운다 (경기를 못 치르는 일은 없게)
  const fill = (isPitcher: boolean, need: number) => {
    const have = availAll.filter((p) => p.isPitcher === isPitcher).length;
    if (have >= need) return;
    const out = ts.team.org
      .filter((p) => p.isPitcher === isPitcher && st.absentUntil[p.idx] > day && !p.dev)
      .sort((a, b) => st.absentUntil[a.idx] - st.absentUntil[b.idx]);
    availAll.push(...out.slice(0, need - have));
  };
  fill(false, 11);
  fill(true, 9);
  const okForeign = allowedForeigners(availAll, limit);
  const avail = availAll.filter((p) => !p.foreign || okForeign.has(p.idx));
  // 외국인 한도로 빠진 뒤에도 야수 9명·투수 몇 명은 꼭 남긴다: 국내 선수로 채우고, 그래도 모자라면 결장 중인 국내 선수까지 (경기를 못 치르는 일은 없게)
  const topUp = (isPitcher: boolean, need: number) => {
    const have = avail.filter((p) => p.isPitcher === isPitcher).length;
    if (have >= need) return;
    const inAvail = new Set(avail.map((p) => p.idx));
    const pool = ts.team.org.filter((p) => p.isPitcher === isPitcher && !p.foreign && !p.dev && !inAvail.has(p.idx));
    const ok = pool.filter((p) => st.absentUntil[p.idx] <= day).sort((a, b) => b.value - a.value);
    const hurt = pool.filter((p) => st.absentUntil[p.idx] > day).sort((a, b) => st.absentUntil[a.idx] - st.absentUntil[b.idx]);
    const extra = [...ok, ...hurt].slice(0, need - have);
    avail.push(...extra);
    if (manual) ts.callUps!.push(...extra.filter((p) => st.absentUntil[p.idx] <= day));
  };
  topUp(false, 11);
  topUp(true, 9);

  // 이도류 (league/twoway.ts): 반대쪽 능력이 있는 선수는 반대쪽 자리 후보에도 넣는다. 같은 선수 색인을 쓰는 다른 얼굴이라
  // 기록·피로·부상은 한 선수로 이어진다. 투수 겸업은 등판한 날도 지명타자로 서고, 등판 다음 날은 타석에서 쉰다 (오타니식).
  // 반대쪽 얼굴은 엔트리 인원에 세지 않는다 (한 선수가 한 자리)
  const restedBat = (p: SimPlayer) => st.lastStartDay[p.idx] === day - 1;
  const batFaces: SimPlayer[] = [];
  const pitFaces: SimPlayer[] = [];
  for (const p of avail) {
    if (!p.alt) continue;
    if (p.isPitcher && p.alt.bat && !restedBat(p)) batFaces.push({ ...p, isPitcher: false, bat: p.alt.bat, pos: 'DH', value: batValue(p.alt.bat, world.league) });
    if (!p.isPitcher && p.alt.pit) pitFaces.push({ ...p, isPitcher: true, pit: p.alt.pit, value: pitValue(p.alt.pit, world.league) });
  }
  // 타자 겸업이 어제 선발로 던졌으면 오늘은 타석에서 쉰다
  const benchToday = new Set(avail.filter((p) => !p.isPitcher && p.alt?.pit && restedBat(p)).map((p) => p.idx));

  // 직접 정한 1군은 투수·야수 인원도 플레이어가 정한 그대로 쓴다
  // 엔트리 확대(9월 등) 때 AI는 늘어난 자리의 절반(내림)을 투수로 채운다 (임시값: 5명이면 투수 2·야수 3)
  const nPit = manual ? Number.MAX_SAFE_INTEGER : pitcherCount(rosterSize - extra) + Math.floor(extra / 2);
  const nHit = manual ? Number.MAX_SAFE_INTEGER : rosterSize - nPit;

  // 투수: 선발 로테이션(시대별 4~5명), 나머지 구원. 기용표가 있으면 그 로테이션부터
  const era = eraPitching(world.year);
  const nRot = era.rotation;
  ts.restDays = era.restDays;
  const pitchers = [...avail.filter((p) => p.isPitcher), ...pitFaces];
  const plan = manual ? ts.plan ?? null : null;
  const inAvail = new Set(pitchers.map((p) => p.idx));
  const planned = plan ? plan.rotation.filter((i) => inAvail.has(i)).map((i) => pitchers.find((p) => p.idx === i)!) : [];
  const starters = pitchers.filter((p) => isStarterSkill(p.pit) && !planned.includes(p) && p.idx !== plan?.closer).sort((a, b) => a.value - b.value);
  const rotation = plan && plan.rotation.length ? [...planned] : starters.slice(0, nRot);
  if (plan && plan.rotation.length && rotation.length < MIN_PLAN_ROTATION) rotation.push(...starters.slice(0, nRot - rotation.length));
  if (rotation.length < nRot) {
    const extra = pitchers
      .filter((p) => !rotation.includes(p))
      .sort((a, b) => b.pit!.startShare - a.pit!.startShare || a.value - b.value);
    rotation.push(...extra.slice(0, nRot - rotation.length));
  }
  // 엔트리 순환 중이면 불펜 끝자리는 2군에서 "요즘 좋은" 투수가 올라온다: 가치에 주기마다 바뀌는 흔들림(jitter 런)을 더해 고른다
  const callUpScore = (p: SimPlayer) => (rotating && jitter > 0 ? p.value + jitter * (unitHash(`${world.year}/${p.id}/${Math.floor(day / CHURN_DAYS)}/j`) - 0.5) : p.value);
  const bullpen = pitchers
    .filter((p) => !rotation.includes(p) && !pitFaces.includes(p))
    .sort((a, b) => callUpScore(a) - callUpScore(b))
    .slice(0, Math.max(0, nPit - rotation.length));
  let closer: SimPlayer | null = plan?.closer !== null && plan?.closer !== undefined ? bullpen.find((p) => p.idx === plan.closer) ?? null : null;
  if (!closer) for (const p of bullpen) if (p.lastSaves >= 5 && (!closer || p.lastSaves > closer.lastSaves)) closer = p;
  // 지난 시즌 마무리가 없으면 불펜에서 가장 좋은 투수 (흔들림 없이 가치로: 엔트리 순환 주기마다 마무리가 바뀌지 않게, 첫 시즌 밸런스 3차)
  if (!closer) for (const p of bullpen) if (!closer || p.value < closer.value) closer = p;

  // 야수: 주전 9명 → 백업 포수 → 가치 순 (이도류 투수의 타자 얼굴은 인원 밖에서 더한다)
  const hittersAll = [...avail.filter((p) => !p.isPitcher && !benchToday.has(p.idx)), ...batFaces].sort((a, b) => b.value - a.value);
  const chosen = assignLineup(hittersAll);
  const pick = new Set(chosen.map((p) => p.idx));
  // 백업 포수는 정규 포수만 센다 (능력치 v2 14.2 3: 비상 포수는 포수 몫이 아니다)
  const regularC = (p: SimPlayer) => (p.bat?.playable ? p.bat.playable.includes('C') : p.pos === 'C');
  const backupC = hittersAll.find((p) => regularC(p) && !pick.has(p.idx));
  if (backupC && chosen.length < nHit) {
    chosen.push(backupC);
    pick.add(backupC.idx);
  }
  // 자리마다 수비 가능 2명 (능력치 v2 16-3, 11.1 메모): 모자란 자리는 그 자리를 맡을 수 있는 선수 중 가치 높은 선수를 먼저 (인원 안에서)
  for (const slot of BACKUP_SLOTS) {
    const can = (p: SimPlayer) => !!p.bat?.playable?.includes(slot);
    if (chosen.length >= nHit || !hittersAll.some((p) => p.bat?.playable)) break;
    if (chosen.filter(can).length >= 2) continue;
    const add = hittersAll.find((p) => !pick.has(p.idx) && can(p));
    if (add) {
      chosen.push(add);
      pick.add(add.idx);
    }
  }
  for (const p of hittersAll) {
    if (chosen.length >= nHit + chosen.filter((x) => batFaces.includes(x)).length) break;
    if (!pick.has(p.idx)) {
      chosen.push(p);
      pick.add(p.idx);
    }
  }

  ts.hitters = chosen.sort((a, b) => b.value - a.value);
  ts.lineupCache = new Map();
  ts.rotation = rotation;
  ts.bullpen = bullpen;
  ts.closer = closer;
  ts.dirty = false;
  let next = Number.MAX_SAFE_INTEGER;
  for (const p of ts.team.org) if (st.absentUntil[p.idx] > day && st.absentUntil[p.idx] < next) next = st.absentUntil[p.idx];
  for (const p of ts.team.org) if (p.homeOnlyUntil !== undefined && p.homeOnlyUntil > day && p.homeOnlyUntil < next) next = p.homeOnlyUntil;
  if (rotating) next = Math.min(next, (Math.floor(day / CHURN_DAYS) + 1) * CHURN_DAYS);
  // 이도류 선수가 있으면 날마다 다시 짠다 (등판 다음 날 타석 휴식)
  if (ts.team.org.some((p) => p.alt)) next = Math.min(next, day + 1);
  ts.nextReturnDay = next;
}

/** 기용표의 주전 중 오늘 쓸 수 있는 선수 (pool 안에 있는 선수만) */
function planFixed(ts: TeamSeason, pool: SimPlayer[]): Map<Slot, SimPlayer> | undefined {
  if (!ts.plan || !ts.manual) return undefined;
  const byIdx = new Map(pool.map((p) => [p.idx, p]));
  const fixed = new Map<Slot, SimPlayer>();
  for (const slot of LINEUP_SLOTS) {
    const i = ts.plan.starters[slot];
    const p = i === undefined ? undefined : byIdx.get(i);
    if (p) fixed.set(slot, p);
  }
  return fixed;
}

/**
 * 오늘의 선발 라인업 (타순 포함). 지친 주전에게 휴식을 준다 (tired: 경기 전 야수 피로, 없으면 쉬지 않는다). 수비 배치는 ts.field에 남긴다.
 * 플래툰 (엔진 2 9단계): 상대 선발의 손(oppThrows)을 알면 좌우 상성을 넣은 타격 런으로 자리를 배정한다 (주전 휴식 순위는 그대로)
 * foreignCap: 라인업에 넣을 수 있는 외국인 타자 수 (lineupForeignCap, 출전 한도가 없으면 undefined). 넘치는 외국인은 가치 낮은 쪽부터 그 경기만 빠진다
 */
export function todaysLineup(ts: TeamSeason, lg: Rates, params: EngineParams, rng: Rng, oppThrows: string | null = null,
                             tired?: (p: SimPlayer) => number, cond?: (p: SimPlayer) => number, foreignCap?: number): SimPlayer[] {
  ts.lineupCache ??= new Map();
  const hand = oppThrows === 'L' || oppThrows === 'R' ? oppThrows : '';
  // 컨디션 (엔진 2 12단계, docs/컨디션_기획안.md 7.4): 타격 런 × (1 + 컨디션 반영 성향 × condEdge × 그날 컨디션). 좌우 상성과 같은 꼴.
  // 날마다 바뀌는 값이라 이때는 자리 배정을 캐시하지 않는다. 성향 0이거나 효과 0이면 예전과 같다
  const condMul = cond ? (ts.tactics?.cond ?? 1) * params.cond.edge : 0;
  const batRuns = (p: SimPlayer) => (hand ? batRunsVs(p, hand, params.platoon) : p.value * RUNS_PER_VALUE) * (condMul ? 1 + condMul * cond!(p) : 1);
  const runsOf = hand || condMul ? (p: SimPlayer, slot: Slot) => batRuns(p) + defenseAt(p, slot) + fitPenalty(p, slot) : slotRuns;
  let full = ts.lineupCache.get('');
  if (!full) ts.lineupCache.set('', (full = assignSlots(ts.hitters, planFixed(ts, ts.hitters))));
  const regulars = full.map((x) => x.p);
  const resting = new Set<number>();
  // 주전은 가치 순으로 줄 세워 휴식 배율을 정한다 (params.restRank: 스타는 덜 쉬고 약한 주전은 더 쉰다)
  const byValue = [...regulars].sort((a, b) => b.value - a.value);
  // 플레이어가 직접 정한 주전은 AI가 쉬게 하지 않는다 (2026-10-11 사용자: 직접 짠 라인업을 AI가 무단으로 바꾸지 않게). 결장 때만 서브가 채운다
  const planned = ts.plan && ts.manual ? new Set(Object.values(ts.plan.starters)) : null;
  // 휴식은 피로로 정한다 (엔진 2 11단계, 확률 휴식 대신): 경기 전 피로가 body.restFrom을 넘은 만큼 쉴 확률이 오른다.
  // 감독은 가치가 높은 주전을 지쳐도 더 내보내고 약한 주전은 일찍 쉬게 한다 (가치 순위별 배율 params.restRank, 상한 params.restMax)
  const rankMul = params.restRank;
  byValue.forEach((p, rank) => {
    if (planned?.has(p.idx)) return;
    const factor = rankMul[Math.min(rank, rankMul.length - 1)];
    const base = p.pos === 'C' ? params.catcherRestChance : params.restChance;
    const over = Math.max(0, (tired ? tired(p) : 0) - params.body.restFrom);
    if (rng.chance(Math.min(params.restMax, base * factor * over))) resting.add(p.idx);
  });
  // 외국인 출전 한도 (리그 규칙 1-6): 쉬지 않는 외국인 타자가 한도를 넘으면 가치 낮은 쪽부터 그 경기만 빠진다 (직접 정한 주전도)
  const sitOut = new Set<number>();
  if (foreignCap !== undefined) {
    const fh = ts.hitters.filter((p) => p.foreign && !resting.has(p.idx)).sort((a, b) => b.value - a.value);
    for (const p of fh.slice(Math.max(0, foreignCap))) sitOut.add(p.idx);
  }
  // 벤치가 모자라 9명을 못 채우면 가치 높은 주전부터 다시 내보낸다 (예전에는 모두 쉬지 않았다: 많이 지칠수록 오히려 덜 쉬었다).
  // 출전 한도가 있으면 외국인은 다시 내보내지 않는다 (한도를 넘을 수 있어서)
  for (const p of byValue) {
    if (ts.hitters.length - resting.size - sitOut.size >= 9) break;
    if (foreignCap !== undefined && p.foreign) continue;
    resting.delete(p.idx);
  }
  const off = sitOut.size ? new Set([...resting, ...sitOut]) : resting;
  const key = `${hand}:${[...off].sort((a, b) => a - b).join(',')}`;
  ts.lineupCache ??= new Map();
  let placed = condMul ? undefined : ts.lineupCache.get(key);
  if (!placed) {
    const avail = ts.hitters.filter((p) => !off.has(p.idx));
    const allowed = ts.hitters.filter((p) => !sitOut.has(p.idx));
    const pool = avail.length >= 9 ? avail : allowed.length >= 9 ? allowed : ts.hitters;
    placed = assignSlots(pool, planFixed(ts, pool), runsOf);
    if (!condMul) ts.lineupCache.set(key, placed);
  }
  ts.field = new Map(placed.map((x) => [x.p.idx, x.slot]));
  // 플레이어가 정한 타순: 자리 순서대로 (그 자리에 나온 선수가 그 타순)
  const order = ts.plan && ts.manual ? ts.plan.order : undefined;
  if (order && order.length === 9) {
    const bySlot = new Map(placed.map((x) => [x.slot, x.p]));
    const out = order.map((s) => bySlot.get(s)).filter((p): p is SimPlayer => !!p);
    if (out.length === placed.length) return out;
  }
  return battingOrder(placed.map((x) => x.p), lg);
}

/**
 * 외국인 출전 한도 (리그 규칙 1-6, D16): 오늘 라인업에 넣을 수 있는 외국인 타자 수. 1군 외국인이 출전 한도 안이면 undefined (제한 없음).
 * 그날 선발 투수가 먼저 한 자리를 쓴다 (선발 투수 → 야수 주전 → 나머지)
 */
export function lineupForeignCap(ts: TeamSeason, world: Pick<World, 'rules'>, starter: SimPlayer): number | undefined {
  const { foreignActive } = teamRules(world, ts.team);
  if (foreignOnRoster(ts) <= foreignActive) return undefined;
  return Math.max(0, foreignActive - (starter.foreign ? 1 : 0));
}

/** 1군(야수·로테이션·불펜)에 있는 외국인 수. 이도류 얼굴은 한 명으로 센다 */
function foreignOnRoster(ts: TeamSeason): number {
  const seen = new Set<number>();
  for (const p of [...ts.hitters, ...ts.rotation, ...ts.bullpen]) if (p.foreign) seen.add(p.idx);
  return seen.size;
}

/**
 * 외국인 출전 한도 (리그 규칙 1-6, D16): 이 경기에 쓰는 구단 쪽 명단. 선발 투수와 라인업의 외국인을 먼저 세고,
 * 남은 자리만큼 불펜(좋은 순) → 벤치 야수(가치 순)의 외국인을 넣는다. 넘치는 외국인은 그 경기만 결장 (대타·구원으로 못 나온다).
 * 난수를 쓰지 않는다. 한도 안이면 ts를 그대로 돌려준다
 */
export function gameSide(ts: TeamSeason, world: Pick<World, 'rules'>, starter: SimPlayer, lineup: SimPlayer[]): TeamSeason {
  return dressedSide(foreignSide(ts, world, starter, lineup), world, starter, lineup);
}

/** 구원 투수를 이 수까지는 출장 명단에 남긴다 (임시값). 그보다 줄여야 하면 벤치 야수부터 뺀다 */
const MIN_DRESSED_PEN = 6;

/**
 * 출장 인원 (규칙 실제화, YearRules.activeSize): 등록 인원 중 경기에 나오는 사람은 activeSize(+창단 특례·엔트리 확대)까지.
 * 경기에 쓰는 사람 = 선발 투수 + 라인업 + 불펜(마무리 포함) + 벤치 야수 (로테이션의 다른 선발은 원래 경기에 나오지 않아 세지 않는다).
 * 넘치면 가장 약한 구원 투수(MIN_DRESSED_PEN명까지) → 가장 약한 벤치 야수(마지막 남은 백업 포수는 남김) 순으로 그 경기만 뺀다.
 * 이도류 얼굴은 한 명으로 센다. 난수를 쓰지 않는다. 한도 안이면 그대로 돌려준다
 */
function dressedSide(ts: TeamSeason, world: Pick<World, 'rules'>, starter: SimPlayer, lineup: SimPlayer[]): TeamSeason {
  const { activeSize } = teamRules(world, ts.team, ts.rosterExtra ?? 0);
  const used = new Set<number>([starter.idx]);
  for (const p of [...lineup, ...ts.hitters, ...ts.bullpen]) used.add(p.idx);
  if (ts.closer) used.add(ts.closer.idx);
  let over = used.size - activeSize;
  if (over <= 0) return ts;
  const inLineup = new Set(lineup.map((p) => p.idx));
  const drop = new Set<number>();
  // 구원: 선발·마무리·라인업에 선 이도류 얼굴은 빼지 않는다 (투수 value는 작을수록 좋다)
  const pen = ts.bullpen.filter((p) => p.idx !== starter.idx && p.idx !== ts.closer?.idx && !inLineup.has(p.idx)).sort((a, b) => b.value - a.value);
  let penLeft = ts.bullpen.length;
  for (const p of pen) {
    if (over <= 0 || penLeft <= MIN_DRESSED_PEN) break;
    if (ts.hitters.some((h) => h.idx === p.idx)) continue;
    drop.add(p.idx); penLeft--; over--;
  }
  const bench = ts.hitters.filter((p) => !inLineup.has(p.idx) && p.idx !== starter.idx).sort((a, b) => a.value - b.value);
  let catchers = bench.filter((p) => p.pos === 'C').length;
  for (const p of bench) {
    if (over <= 0) break;
    if (p.pos === 'C' && catchers <= 1) continue;
    if (ts.bullpen.some((q) => q.idx === p.idx && !drop.has(q.idx))) continue;
    if (p.pos === 'C') catchers--;
    drop.add(p.idx); over--;
  }
  if (!drop.size) return ts;
  return { ...ts, hitters: ts.hitters.filter((p) => !drop.has(p.idx)), bullpen: ts.bullpen.filter((p) => !drop.has(p.idx)) };
}

/** 외국인 출전 한도로 이 경기에 쓰는 구단 쪽 명단 (gameSide 앞 단계) */
function foreignSide(ts: TeamSeason, world: Pick<World, 'rules'>, starter: SimPlayer, lineup: SimPlayer[]): TeamSeason {
  const { foreignActive } = teamRules(world, ts.team);
  if (foreignOnRoster(ts) <= foreignActive) return ts;
  const dressed = new Set<number>();
  if (starter.foreign) dressed.add(starter.idx);
  for (const p of lineup) if (p.foreign) dressed.add(p.idx);
  const inLineup = new Set(lineup.map((p) => p.idx));
  const rest = [
    ...ts.bullpen.filter((p) => p.foreign && p.idx !== starter.idx),
    ...ts.hitters.filter((p) => p.foreign && !inLineup.has(p.idx)).sort((a, b) => b.value - a.value),
  ];
  for (const p of rest) if (dressed.size < foreignActive) dressed.add(p.idx);
  const ok = (p: SimPlayer) => !p.foreign || dressed.has(p.idx);
  return {
    ...ts,
    hitters: ts.hitters.filter((p) => ok(p) || inLineup.has(p.idx)),
    bullpen: ts.bullpen.filter((p) => ok(p) || p.idx === starter.idx),
    closer: ts.closer && (ok(ts.closer) || ts.closer.idx === starter.idx) ? ts.closer : null,
  };
}

/**
 * 오늘의 선발 투수. 쉴 만큼 쉰 로테이션 투수 가운데 가장 오래 쉰 투수 (앞 순번은 params.mgr.aceDays만큼 앞당긴다), 없으면 불펜에서 길게 던질 수 있는 투수.
 * 컨디션 (엔진 2 12단계, cond가 있을 때): 차례인 투수의 (컨디션 반영 성향 × 컨디션)이 나쁨 경계(cond.bad) 이하이고
 * 다음으로 오래 쉰 투수가 등판할 수 있으면 하루 미룬다 (성향 0이면 미루지 않는다, 1.5면 컨디션 −0.27부터, 0.5면 −0.8부터)
 */
export function todaysStarter(ts: TeamSeason, st: PlayerStates, day: number, params: EngineParams, cond?: (p: SimPlayer) => number): SimPlayer {
  let best: SimPlayer | null = null;
  let next: SimPlayer | null = null;
  // 차례 점수 = 지난 선발 날 + 로테이션 순번 × aceDays (작을수록 먼저). 0이면 가장 오래 쉰 투수
  const k = params.mgr.aceDays;
  const key = new Map(ts.rotation.map((p, i) => [p, st.lastStartDay[p.idx] + k * i]));
  for (const p of ts.rotation) {
    if (day - st.lastStartDay[p.idx] < (ts.restDays ?? params.starterRestDays)) continue;
    if (!best || key.get(p)! < key.get(best)!) { next = best; best = p; }
    else if (!next || key.get(p)! < key.get(next)!) next = p;
  }
  const tac = ts.tactics?.cond ?? 1;
  if (best && next && cond && tac > 0 && params.cond.edge > 0 && params.cond.delayStarter !== false && tac * cond(best) <= params.cond.bad && cond(next) > cond(best)) return next;
  if (best) return best;
  let spot: SimPlayer | null = null;
  for (const p of ts.bullpen) {
    if (p === ts.closer || currentFatigue(st, p.idx, day) > 0) continue;
    if (!spot || p.pit!.reliefStint > spot.pit!.reliefStint) spot = p;
  }
  if (spot) return spot;
  // 모두 지쳤으면 로테이션 첫 투수. 다만 더블헤더 1차전에 이미 선발로 나왔으면 가장 오래 쉰 다른 로테이션 투수
  // (노게임 다시 편성으로 일정이 몰린 날 2차전에서 같은 선발이 또 나오던 것, 일정 개편 10단계)
  const first = ts.rotation[0];
  if (first && st.lastStartDay[first.idx] === day) {
    let other: SimPlayer | null = null;
    for (const p of ts.rotation) if (st.lastStartDay[p.idx] !== day && (!other || st.lastStartDay[p.idx] < st.lastStartDay[other.idx])) other = p;
    if (other) return other;
  }
  return first ?? ts.bullpen[0];
}
