// 구종·코스 (엔진 2 20단계, docs/경기엔진2_기획안.md 3.4.1·6장 20-1~20-4). A 해결기(공 단위)에서만 쓴다. B와 시즌 기록은 바뀌지 않는다.
//
// 20-1 구종 능력: 투수마다 구종 목록(arsenal: 구종·비율·등급). 칸마다 "구종 × 공 결과" 결합표를 만들되, 결과 쪽 합(구종을 섞은 값)이
//   그 칸의 사슬 확률(볼·루킹·헛스윙·파울·사구, 맞힘은 단타·2루타·3루타·홈런·아웃으로 펼침)과 정확히 같게 한다 (반복 비례 맞춤, Sinkhorn).
//   그래서 구종을 섞은 사슬 = 지금 사슬 그대로이고 (끝 확률이 같은 정도가 아니라 칸 확률이 같다), 구종은 "어느 결과가 어느 구종에서 났나"만 나눈다.
//   구종별 기울기는 리그 표(pitchTable.ts, 문자중계 2023~2025)의 구종별 결과 비율 ÷ 리그 비율, 그리고 그 투수의 구종 등급.
// 20-2 AI 포수 볼 배합: 지시 없는 공의 구종 비율 = 투수 구종 비율 × (그 카운트의 리그 구종 몫 ÷ 리그 전체 몫). 결합표의 구종 쪽 합이 이 비율이 된다.
//   지시 없는 공은 결과를 지금과 같은 난수로 먼저 뽑고(drawPitch·drawInPlay), 구종·코스는 따로 난수 줄기(GameState.pitchRng)에서
//   "이 결과가 났을 때의 구종" 조건부로 뽑는다. 그래서 지시 없는 경기의 결과는 구종을 넣기 전과 한 공까지 같다.
// 20-3 플레이어 지시: 고른 구종(없으면 AI 배합대로)의 결과 비율 × 고른 코스의 기울기(제구에 따라 겨눈 코스에 들어갈 몫만큼) × 예측 손해 (20-4).
// 20-4 예측 손해(노림수): 이 등판에서 지시한 공이 한 구종·코스로 쏠릴수록 타자가 노려서 루킹·헛스윙이 줄고 안타가 는다.
// 난수를 쓰지 않는다 (뽑기 함수는 받은 Rng만 쓴다).

import { COUNT_TYPE_COUNTS, ZONE_COUNTS, ZONE_KEYS } from './pitchTable';
import type { Rng } from './rng';

/** 엔진 표준 구종 (src/data/pitches.ts의 낱말과 같다. 싱커는 투심, 슬러브는 슬라이더) */
export const PITCH_TYPES = ['포심', '투심', '커터', '슬라이더', '스위퍼', '커브', '체인지업', '포크', '너클볼'] as const;

/** 코스 (리그 표의 구역): 가운데, 존 안 몸쪽·바깥쪽 × 높게·낮게, 존 밖 유인구 */
export type PitchZone = (typeof ZONE_KEYS)[number];
export const PITCH_ZONES: readonly PitchZone[] = ZONE_KEYS;
export const ZONE_TEXT: Record<PitchZone, string> = {
  mid: '가운데', in_high: '몸쪽 높게', in_low: '몸쪽 낮게', out_high: '바깥쪽 높게', out_low: '바깥쪽 낮게', chase: '유인구',
};

/**
 * 투수 구종 하나 (20-1): 구종, 사용 비율(합이 1이 아니어도 된다), 등급(20~80, 없으면 50 = 그 구종의 리그 평균).
 * 등급은 구종 사이에 결과를 나누는 데만 쓰고 투수 전체 능력은 바꾸지 않는다 (섞은 값 = 지금 능력)
 */
export interface ArsenalPitch {
  type: string;
  share: number;
  grade?: number;
}

/** 공 결과 칸: 볼, 루킹, 헛스윙, 파울, 사구, 맞힘 뒤 단타·2루타·3루타·홈런·아웃 (pitchTable.ts PITCH_OUTCOMES 순서) */
export const O = { B: 0, C: 1, S: 2, F: 3, H: 4, X1: 5, X2: 6, X3: 7, HR: 8, OUT: 9 } as const;
const NO = 10;
const HITS = [O.X1, O.X2, O.X3, O.HR] as const;

/** 조정값 (모두 임시값, docs/temp-values.md "경기 엔진 2" 20단계) */
export const ARSENAL_PARAMS = {
  /** 표가 작은 구종을 빌릴 구종 쪽으로 당기는 가짜 공 수 */
  priorN: 3000,
  /** 표가 작은 구종이 빌릴 구종 (스위퍼 → 슬라이더, 너클볼 → 체인지업) */
  borrow: { 스위퍼: '슬라이더', 너클볼: '체인지업' } as Record<string, string>,
  /** 코스 기울기를 그 구종 평균 쪽으로 당기는 가짜 공 수 */
  zonePriorN: 300,
  /** 등급 1σ(10점)당 로그 배율: 헛스윙 +, 루킹 +, 볼 −, 안타 −, 홈런 − (구종 사이 나눔에만) */
  grade: { s: 0.18, c: 0.06, b: -0.06, hit: -0.06, hr: -0.1 },
  /** 겨눈 코스에 실제로 들어가는 몫 (리그 평균 제구) */
  aimHit: 0.55,
  /** 제구 로짓 1당 겨눈 코스 몫 로짓 */
  aimCtl: 1,
  /** 예측 손해: 쏠림 1당 로그 배율 (루킹·헛스윙 −, 안타 +), 쏠림을 줄이는 가짜 공 수 (tools/pitch_balance.ts로 맞춤) */
  read: { lambda: 1.2, n0: 8 },
};

const PITCH_SET = new Set<string>(PITCH_TYPES);
/** 엔진이 모르는 구종 낱말은 가까운 표준 구종으로 (싱커 → 투심, 슬러브 → 슬라이더, 그 밖은 null) */
export function standardType(t: string): string | null {
  if (PITCH_SET.has(t)) return t;
  if (t === '싱커') return '투심';
  if (t === '슬러브') return '슬라이더';
  if (t === '스플리터') return '포크';
  return null;
}

interface League {
  /** 구종 → P(결과 | 구종) (코스를 합친 값) */
  out: Record<string, Float64Array>;
  /** 리그 전체 P(결과) */
  all: Float64Array;
  /** 구종 → 코스 → P(결과 | 구종, 코스) ÷ P(결과 | 구종) */
  zoneTilt: Record<string, Record<string, Float64Array>>;
  /** 구종 → 코스 → P(코스 | 구종) */
  zoneShare: Record<string, Float64Array>;
  /** 구종 → 결과 → 코스 분포 P(코스 | 구종, 결과) (지시 없는 공의 중계용) */
  zoneGiven: Record<string, Float64Array[]>;
  /** 구종 → 칸 → (그 칸의 구종 몫 ÷ 전체 몫) */
  countRatio: Record<string, Float64Array>;
}

let LEAGUE: League | null = null;

function sumRow(z: Record<string, readonly number[]>): Float64Array {
  const s = new Float64Array(NO);
  for (const k of ZONE_KEYS) z[k]?.forEach((x, i) => (s[i] += x));
  return s;
}
const norm = (a: Float64Array) => {
  const t = a.reduce((x, y) => x + y, 0);
  return t > 0 ? a.map((x) => x / t) : a;
};

/** 리그 표 (한 번만 만든다, 난수 없음) */
export function arsenalLeague(): League {
  if (LEAGUE) return LEAGUE;
  const P = ARSENAL_PARAMS;
  const raw: Record<string, Float64Array> = {};
  for (const t of PITCH_TYPES) raw[t] = sumRow(ZONE_COUNTS[t] ?? {});
  const all = new Float64Array(NO);
  for (const t of PITCH_TYPES) raw[t].forEach((x, i) => (all[i] += x));
  const out: Record<string, Float64Array> = {};
  const zoneTilt: League['zoneTilt'] = {};
  const zoneShare: League['zoneShare'] = {};
  const zoneGiven: League['zoneGiven'] = {};
  for (const t of PITCH_TYPES) {
    const b = P.borrow[t];
    const prior = norm(new Float64Array(b ? raw[b] : raw[t]));
    const n = raw[t].reduce((x, y) => x + y, 0);
    const k = b ? P.priorN : 0;
    const pt = raw[t].map((x, i) => (x + k * prior[i]) / (n + k));
    out[t] = pt;
    // 코스: 그 구종(작으면 빌릴 구종)의 코스 칸을 그 구종 평균 쪽으로 당긴다
    const src = b && n < P.priorN ? ZONE_COUNTS[b] : ZONE_COUNTS[t];
    const zs = new Float64Array(ZONE_KEYS.length);
    zoneTilt[t] = {};
    const given = Array.from({ length: NO }, () => new Float64Array(ZONE_KEYS.length));
    ZONE_KEYS.forEach((z, zi) => {
      const row = src?.[z] ?? [];
      const zn = row.reduce((x, y) => x + y, 0);
      zs[zi] = zn;
      const tilt = new Float64Array(NO);
      for (let o = 0; o < NO; o++) {
        const pz = ((row[o] ?? 0) + P.zonePriorN * pt[o]) / (zn + P.zonePriorN);
        tilt[o] = pt[o] > 0 ? pz / pt[o] : 1;
        given[o][zi] = (row[o] ?? 0) + 1e-3;
      }
      zoneTilt[t][z] = tilt;
    });
    zoneShare[t] = norm(zs);
    zoneGiven[t] = given.map(norm);
  }
  // 카운트별 리그 볼 배합 (20-2)
  const cellTot = new Float64Array(12);
  let tot = 0;
  for (const t of PITCH_TYPES) COUNT_TYPE_COUNTS[t]?.forEach((x, c) => { cellTot[c] += x; tot += x; });
  const countRatio: League['countRatio'] = {};
  for (const t of PITCH_TYPES) {
    const b = P.borrow[t];
    const row = COUNT_TYPE_COUNTS[t] ?? [];
    const n = row.reduce((x, y) => x + y, 0);
    const useRow = b && n < P.priorN ? COUNT_TYPE_COUNTS[b] : row;
    const un = useRow.reduce((x, y) => x + y, 0);
    countRatio[t] = Float64Array.from({ length: 12 }, (_, c) => (un > 0 && cellTot[c] > 0 ? (useRow[c] / cellTot[c]) / (un / tot) : 1));
  }
  LEAGUE = { out, all: norm(all), zoneTilt, zoneShare, zoneGiven, countRatio };
  return LEAGUE;
}

/** 쓸 수 있는 구종만 (표준 구종, 비율 > 0) */
function usable(arsenal: readonly ArsenalPitch[] | undefined): ArsenalPitch[] {
  const out: ArsenalPitch[] = [];
  for (const a of arsenal ?? []) {
    const t = standardType(a.type);
    if (!t || !(a.share > 0)) continue;
    const same = out.find((x) => x.type === t);
    if (same) same.share += a.share;
    else out.push({ type: t, share: a.share, ...(a.grade !== undefined ? { grade: a.grade } : {}) });
  }
  return out.length ? out : [{ type: '포심', share: 1 }];
}

/** 카운트 칸 c에서 AI 포수가 고르는 구종 비율 (20-2): 투수 비율 × 리그 카운트 몫 비 (합 1) */
export function typeMix(arsenal: readonly ArsenalPitch[], c: number): Float64Array {
  const lg = arsenalLeague();
  const w = Float64Array.from(arsenal, (a) => a.share * lg.countRatio[a.type][c]);
  return norm(w);
}

/** 구종 하나의 결과 기울기 (리그 구종 비율 ÷ 리그 비율) × 등급 */
function tiltOf(a: ArsenalPitch): Float64Array {
  const lg = arsenalLeague();
  const g = ARSENAL_PARAMS.grade;
  const z = ((a.grade ?? 50) - 50) / 10;
  const t = new Float64Array(NO);
  for (let o = 0; o < NO; o++) t[o] = lg.all[o] > 0 ? lg.out[a.type][o] / lg.all[o] : 1;
  t[O.S] *= Math.exp(g.s * z);
  t[O.C] *= Math.exp(g.c * z);
  t[O.B] *= Math.exp(g.b * z);
  for (const o of HITS) t[o] *= Math.exp((o === O.HR ? g.hr : g.hit) * z);
  return t;
}

/** 한 타석의 구종 결합표: 칸마다 구종 몫(합 1)과 구종 × 결과 결합 확률 */
export interface PitchJoint {
  arsenal: ArsenalPitch[];
  /** 칸 × 구종: 지시 없는 공의 구종 비율 */
  mix: Float64Array[];
  /** 칸 × (구종 × 10): 결합 확률. 구종 쪽 합 = 그 칸의 사슬 결과 확률 */
  m: Float64Array[];
  /** 칸 × 10: 그 칸의 사슬 결과 확률 (맞힘은 결과로 펼침) */
  base: Float64Array[];
}

/**
 * 사슬 칸(12 × [볼, 스트라이크, 파울, 맞힘, 사구])과 칸별 루킹 몫, 맞힘 뒤 결과 비율 [단타, 2루타, 3루타, 홈런, 아웃]으로 결합표를 만든다 (20-1·20-2).
 * 결과 쪽 합은 사슬 칸 그대로 (마지막을 결과 쪽 맞춤으로 끝내 1e-12 안), 구종 쪽 합은 AI 배합 비율에 1e-10 안까지 맞춘다
 */
export function pitchJoint(cells: Float64Array, called: Float64Array | undefined, inPlay: readonly number[], arsenalIn: readonly ArsenalPitch[] | undefined): PitchJoint {
  const arsenal = usable(arsenalIn);
  const nt = arsenal.length;
  const tilts = arsenal.map(tiltOf);
  const mix: Float64Array[] = [];
  const m: Float64Array[] = [];
  const base: Float64Array[] = [];
  for (let c = 0; c < 12; c++) {
    const o5 = c * 5;
    const cs = called ? called[c] : 0.5;
    const r = new Float64Array(NO);
    r[O.B] = cells[o5];
    r[O.C] = cells[o5 + 1] * cs;
    r[O.S] = cells[o5 + 1] * (1 - cs);
    r[O.F] = cells[o5 + 2];
    r[O.H] = cells[o5 + 4];
    for (let k = 0; k < 5; k++) r[O.X1 + k] = cells[o5 + 3] * inPlay[k];
    const w = typeMix(arsenal, c);
    const M = new Float64Array(nt * NO);
    for (let t = 0; t < nt; t++) for (let o = 0; o < NO; o++) M[t * NO + o] = w[t] * r[o] * tilts[t][o];
    for (let it = 0; it < 500; it++) {
      // 결과 쪽 맞춤
      for (let o = 0; o < NO; o++) {
        let s = 0;
        for (let t = 0; t < nt; t++) s += M[t * NO + o];
        const f = s > 0 ? r[o] / s : 0;
        for (let t = 0; t < nt; t++) M[t * NO + o] *= f;
      }
      // 구종 쪽 맞춤 (어긋남이 작으면 멈춘다: 늘 결과 쪽 맞춤으로 끝난다)
      const col = new Float64Array(nt);
      let err = 0;
      for (let t = 0; t < nt; t++) {
        for (let o = 0; o < NO; o++) col[t] += M[t * NO + o];
        err = Math.max(err, Math.abs(col[t] - w[t]));
      }
      if (err < 1e-11 || it === 499) break;
      for (let t = 0; t < nt; t++) if (col[t] > 0) for (let o = 0; o < NO; o++) M[t * NO + o] *= w[t] / col[t];
    }
    mix.push(w);
    m.push(M);
    base.push(r);
  }
  return { arsenal, mix, m, base };
}

const pick = (rng: Rng, w: ArrayLike<number>, n = w.length): number => {
  let tot = 0;
  for (let i = 0; i < n; i++) tot += w[i];
  let u = rng.next() * tot;
  for (let i = 0; i < n - 1; i++) if ((u -= w[i]) < 0) return i;
  return n - 1;
};

/**
 * 지시 없는 공의 구종·코스 (20-2, 중계용): 이미 뽑은 결과 o가 났을 때의 구종 조건부 P(구종 | 결과), 코스는 리그 P(코스 | 구종, 결과).
 * outs: 결과 칸 여럿(공 기호 'T'처럼 루킹·헛스윙을 가를 수 없을 때)이면 합쳐서 본다
 */
export function labelPitch(j: PitchJoint, c: number, outs: readonly number[], rng: Rng): { type: string; zone: PitchZone } {
  const M = j.m[c];
  const nt = j.arsenal.length;
  const w = new Float64Array(nt);
  for (let t = 0; t < nt; t++) for (const o of outs) w[t] += M[t * NO + o];
  const t = pick(rng, w);
  const type = j.arsenal[t].type;
  const zg = arsenalLeague().zoneGiven[type];
  const zw = new Float64Array(ZONE_KEYS.length);
  for (const o of outs) zg[o].forEach((x, i) => (zw[i] += x));
  return { type, zone: ZONE_KEYS[pick(rng, zw)] };
}

/** 지시 없는 공에서 구종만 AI 배합대로 (코스만 지시했을 때) */
export function aiType(j: PitchJoint, c: number, rng: Rng): string {
  return j.arsenal[pick(rng, j.mix[c])].type;
}

/** 이 등판에서 지시한 공 기록 (예측 손해, 20-4). 투수가 바뀌면 새로 */
export interface AimMemory {
  n: number;
  type: Record<string, number>;
  zone: Record<string, number>;
}
export const newAim = (): AimMemory => ({ n: 0, type: {}, zone: {} });

/**
 * 지시한 공 하나의 결과 확률 (20-3·20-4): 그 구종의 결과 비율 P(결과 | 구종, 칸) × 코스 기울기 × 예측 손해, 합 1.
 * 코스 기울기 = 겨눈 코스에 들어가는 몫 a × 그 코스 기울기 + (1 − a) (a는 투수 제구 로짓 ctl로 옮긴다).
 * 예측 손해 쏠림 f = 이 등판에서 앞서 지시한 공 가운데 이 구종(코스) 수가 자연 몫(투수 비율, 리그 코스 몫)을 넘는 만큼 ÷ (지시한 공 + n0), 구종·코스 중 큰 쪽
 */
export function aimedOutcome(j: PitchJoint, c: number, type: string, zone: PitchZone | undefined, ctl: number, mem: AimMemory | undefined): Float64Array {
  const P = ARSENAL_PARAMS;
  const lg = arsenalLeague();
  const ti = Math.max(0, j.arsenal.findIndex((a) => a.type === type));
  const t = j.arsenal[ti];
  const M = j.m[c];
  const q = new Float64Array(NO);
  for (let o = 0; o < NO; o++) q[o] = M[ti * NO + o];
  if (zone) {
    const a = 1 / (1 + Math.exp(-(Math.log(P.aimHit / (1 - P.aimHit)) + P.aimCtl * ctl)));
    const tilt = lg.zoneTilt[t.type][zone];
    for (let o = 0; o < NO; o++) q[o] *= a * tilt[o] + (1 - a);
  }
  if (mem) {
    const n = mem.n;
    const share = t.share / j.arsenal.reduce((s, x) => s + x.share, 0);
    let f = ((mem.type[t.type] ?? 0) - n * share) / (n + P.read.n0);
    if (zone) {
      const zs = lg.zoneShare[t.type][ZONE_KEYS.indexOf(zone)];
      f = Math.max(f, ((mem.zone[zone] ?? 0) - n * zs) / (n + P.read.n0));
    }
    f = Math.max(0, f);
    if (f > 0) {
      const down = Math.exp(-P.read.lambda * f);
      const up = Math.exp(P.read.lambda * f);
      q[O.C] *= down;
      q[O.S] *= down;
      for (const o of HITS) q[o] *= up;
    }
  }
  return norm(q);
}

/** 지시한 공 기록에 넣는다 */
export function rememberAim(mem: AimMemory, type: string, zone: PitchZone | undefined): void {
  mem.n++;
  mem.type[type] = (mem.type[type] ?? 0) + 1;
  if (zone) mem.zone[zone] = (mem.zone[zone] ?? 0) + 1;
}

/** 결과 확률에서 하나 (난수 한 번) */
export function drawOutcome(q: Float64Array, rng: Rng): number {
  return pick(rng, q);
}
