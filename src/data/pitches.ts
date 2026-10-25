// 구종 자료 가공 함수 (능력치 v2 16-1a·16-1b, docs/능력치v2_기획안.md 14.6 ②·15.4·15.5).
//
// pitches.json(visualbaseball 실측 + 위키 구종 목록)을 읽어 구종 등급(20~80)과 위키 투수의 구종 목록·사용률 짐작을 내는 순수 함수다.
// 아직 화면·등급 근거·스킬 어디에도 잇지 않는다 (16-7 화면, 16-1 짐작 식, 16-6 스킬에서 쓴다). 그래서 게임 결과·저장 지문은 그대로다.
// 원래 RV/100 숫자는 등급 계산에만 쓰고 밖으로 내지 않는다 (가공값 원칙). 위키 구종 낱말은 화면 이름으로 그대로 쓴다.

import type { PitchData, PitchPrior, WikiPitcher } from './types';

/** 구종 등급이 "표본 적음"이 되는 투구수 (15.5 ④ 가 6, 임시값) */
const SMALL_N = 30;
/** 등급을 다 믿는 투구수: w = min(1, n ÷ 300) (임시값) */
const FULL_N = 300;
/** 이 투구수 밑이면 직전 2시즌을 합친다 (14.6 ②) */
const MERGE_BELOW_N = 100;
/** 사용률 짐작: 이 몫 밑은 "가끔", 화면은 5% 단위 (15.5 ②) */
const OFTEN_MIN = 5;
/** 구종 수 6 이상: 5개 표에 6위부터 1%씩 (15.5 ②) */
const TAIL_SHARE = 1;
/** 주무기 표시가 이만큼 이상이면 주무기가 없는 것으로 본다 (15.5 ② 1.0, 임시 기준) */
const MAIN_MAX = 2;

/** 한 시즌 몫: 연도, RV/100, 투구수 */
export interface RvPart {
  year: number;
  rv: number;
  n: number;
}

/** 표준 정규분포 역함수 (Acklam 근사, 상대 오차 1e-9 안팎) */
export function invNorm(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -invNorm(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * 실측 구종 등급 (15.5 ④ 가): 20~80 정수, 투구수 30 미만이면 'small'(표본 적음), 표가 없는 구종(너클볼)이면 null.
 * parts는 한 시즌 또는 직전 2시즌 (RV와 그 해 중앙값 m 모두 투구수 무게 평균). c = RV − m의 구종별 표 안 분위 p
 * (같은 값은 가운데 순위, 양 끝은 0.5 ÷ 행 수로 막음), z = −Φ⁻¹(p) (음수 RV가 투수에게 좋으므로 뒤집음), g = 50 + 10·z·w, w = min(1, n ÷ 300).
 */
export function measuredGrade(prior: PitchPrior, type: string, parts: RvPart[]): number | 'small' | null {
  const n = parts.reduce((a, p) => a + p.n, 0);
  if (n < SMALL_N) return 'small';
  const rv = prior.rv;
  const table = rv.tables[type] ?? rv.tables[rv.borrow[type] ?? ''];
  if (!table) return null;
  const at = (y: number) => table.med[String(y)] ?? table.med.all;
  const c = parts.reduce((a, p) => a + (p.rv - at(p.year)) * p.n, 0) / n;
  const cs = table.c;
  const eps = 1e-9;
  let less = 0;
  let eq = 0;
  for (const x of cs) {
    if (x < c - eps) less++;
    else if (x <= c + eps) eq++;
  }
  const N = cs.length;
  const p = Math.min(Math.max((less + 0.5 * eq) / N, 0.5 / N), 1 - 0.5 / N);
  const g = 50 + 10 * -invNorm(p) * Math.min(1, n / FULL_N);
  return Math.max(20, Math.min(80, Math.round(g)));
}

/**
 * 시작 연도 전 실측 구종 (14.6 ②·15.4): 시작 연도 전 자료가 있는 가장 늦은 시즌의 구종 목록 (사용률 순).
 * 구종마다 그 시즌 투구수가 100 미만이면 그 앞 시즌(자료가 있는 해)을 투구수 무게로 합친다 (RV·구속 모두).
 * 자료가 없으면 null (위키 목록이나 "구종 자료 없음"으로 간다, 15.4).
 */
export function measuredArsenal(data: PitchData, id: string, startYear: number) {
  const ys = Object.keys(data.players[id] ?? {})
    .map(Number)
    .filter((y) => y < startYear)
    .sort((a, b) => b - a);
  if (!ys.length) return null;
  const f = data.fields;
  const [isp, iu, i_n, irv] = ['speed', 'usage', 'n', 'rv'].map((k) => f.indexOf(k));
  const at = (y: number) => data.players[id][String(y)];
  const last = at(ys[0]);
  const prev = ys.length > 1 ? at(ys[1]) : undefined;
  const out = Object.entries(last).map(([type, v]) => {
    const parts: RvPart[] = [];
    const speeds: [number, number][] = [];
    const take = (y: number, w: (number | null)[] | undefined) => {
      if (!w) return;
      if (w[irv] !== null && w[i_n] !== null) parts.push({ year: y, rv: w[irv]!, n: w[i_n]! });
      if (w[isp] !== null) speeds.push([w[isp]!, w[i_n] ?? 1]);
    };
    take(ys[0], v);
    if ((v[i_n] ?? 0) < MERGE_BELOW_N) take(ys[1], prev?.[type]);
    const sw = speeds.reduce((a, [, w]) => a + w, 0);
    return {
      type,
      year: ys[0],
      usage: v[iu],
      speed: sw > 0 ? speeds.reduce((a, [s, w]) => a + s * w, 0) / sw : null,
      n: parts.reduce((a, p) => a + p.n, 0),
      grade: parts.length ? measuredGrade(data.prior, type, parts) : null,
    };
  });
  return out.sort((a, b) => (b.usage ?? -1) - (a.usage ?? -1) || b.n - a.n);
}

/** 위키 목록 한 줄 (15.5 ①②) */
export interface WikiPitchLine {
  /** 화면 이름: 위키 낱말 그대로 (투심·싱커를 합친 줄은 "A·B"), 빠른 공을 더한 줄은 "빠른 공 (위키에 없음)" */
  name: string;
  /** 짐작 계산용 표준 구종 (위키 싱커는 투심으로, 15.6 1.0) */
  type: string;
  main: boolean;
  /** 위키에 없는 빠른 공을 짐작으로 더한 줄 */
  added: boolean;
  /** 사용률 짐작: 숫자는 % (5% 단위), 'rare'는 가끔 (5% 밑·너클볼·기타), 'mostly'는 주로 (구종 하나) */
  share: number | 'rare' | 'mostly';
}

const FASTBALL = ['포심', '투심'];
const ODD = ['너클볼', '기타'];

/**
 * 위키 투수의 구종 목록과 사용률 짐작 (15.5 ①②, 15.6 1.0):
 * 1. 시기가 적힌 구종은 시작 연도가 그 시기 안일 때만. 위키 싱커는 투심으로 보고, 같은 표준 구종이 둘이면 한 줄로 (앞 순서 자리, 주무기는 하나라도 있으면).
 * 2. 주무기 표시가 3개 이상이면 주무기가 없는 것으로 본다. 빠른 공(포심·투심)이 없으면 맨 앞에 "빠른 공 (위키에 없음)" (포심으로 계산).
 * 3. 순서: 빠른 공(포심, 없으면 투심) → 주무기(위키 순서) → 나머지(위키 순서) → 너클볼·기타 (사용률 "가끔").
 * 4. 사용률: 구종 수 k(너클볼·기타 빼고)의 실측 순위 몫 (k ≥ 6은 5개 표에 6위부터 1%씩, 나머지를 비례로 줄임),
 *    5% 밑은 "가끔", 나머지는 5% 단위로 반올림하고 합이 100이 되게 1위를 맞춘다. k = 1이면 "주로".
 */
export function wikiArsenal(w: WikiPitcher, names: string[], prior: Pick<PitchPrior, 'share'>, startYear: number): WikiPitchLine[] {
  const lines: { names: string[]; type: string; main: boolean; added: boolean }[] = [];
  for (const [std, ni, main, from, to] of w.p) {
    if ((from !== null && from > startYear) || (to !== null && to < startYear)) continue;
    const type = std === '싱커' ? '투심' : std;
    const same = lines.find((l) => l.type === type);
    if (same) {
      if (!same.names.includes(names[ni])) same.names.push(names[ni]);
      same.main ||= main === 1;
    } else lines.push({ names: [names[ni]], type, main: main === 1, added: false });
  }
  if (lines.filter((l) => l.main).length > MAIN_MAX) for (const l of lines) l.main = false;
  if (!lines.some((l) => FASTBALL.includes(l.type))) lines.unshift({ names: ['빠른 공 (위키에 없음)'], type: '포심', main: false, added: true });
  const fb = lines.find((l) => l.type === '포심') ?? lines.find((l) => l.type === '투심')!;
  const rest = lines.filter((l) => l !== fb && !ODD.includes(l.type));
  const ordered = [fb, ...rest.filter((l) => l.main), ...rest.filter((l) => !l.main)];
  const odd = lines.filter((l) => ODD.includes(l.type));
  const shares = rankShares(prior, ordered.length);
  return [
    ...ordered.map((l, i) => ({ name: l.names.join('·'), type: l.type, main: l.main, added: l.added, share: shares[i] })),
    ...odd.map((l) => ({ name: l.names.join('·'), type: l.type, main: l.main, added: false, share: 'rare' as const })),
  ];
}

/** 구종 수 k의 순위별 사용률 짐작 (5% 단위, 15.5 ②) */
export function rankShares(prior: Pick<PitchPrior, 'share'>, k: number): (number | 'rare' | 'mostly')[] {
  if (k <= 0) return [];
  if (k === 1) return ['mostly'];
  let raw: number[];
  if (k <= 5) raw = [...prior.share[String(k)].s];
  else {
    const five = prior.share['5'].s;
    const tail = (k - 5) * TAIL_SHARE;
    const sum5 = five.reduce((a, x) => a + x, 0);
    raw = [...five.map((x) => (x * (100 - tail)) / sum5), ...Array<number>(k - 5).fill(TAIL_SHARE)];
  }
  const out: (number | 'rare')[] = raw.map((x) => (x < OFTEN_MIN ? 'rare' : Math.round(x / 5) * 5));
  const others = out.slice(1).reduce<number>((a, x) => a + (typeof x === 'number' ? x : 0), 0);
  out[0] = 100 - others;
  return out;
}

/** 경기 엔진 구종 한 줄 (engine/arsenal.ts ArsenalPitch와 같은 꼴): 구종, 비율(%), 등급(20~80, 없으면 리그 평균) */
export interface ArsenalLine {
  type: string;
  share: number;
  grade?: number;
}

/** 엔진이 쓰는 표준 구종 (engine/arsenal.ts PITCH_TYPES) */
const ENGINE_TYPES = new Set(['포심', '투심', '커터', '슬라이더', '스위퍼', '커브', '체인지업', '포크', '너클볼']);
const engineType = (t: string) => (ENGINE_TYPES.has(t) ? t : t === '싱커' ? '투심' : t === '슬러브' ? '슬라이더' : null);
/** 엔진 구종에 넣는 가장 작은 사용률 (%, 임시값): 이보다 드문 실측 구종은 뺀다 */
const ENGINE_MIN_USAGE = 2;
/** 위키 사용률 "가끔"의 엔진 비율 (%, 임시값) */
const RARE_SHARE = 2;
/** 위키 주무기의 엔진 등급 (임시값) */
const MAIN_GRADE = 60;
/** 자료 없는 투수의 둘째 구종 뒤 후보와 무게 (리그 구종 몫, data-src/pbp_derived/pitch_types.csv 2023~2025 대략, 임시값) */
const DEFAULT_POOL: [string, number][] = [['슬라이더', 25], ['체인지업', 12], ['커브', 10], ['포크', 8], ['투심', 7], ['커터', 5]];

/** 선수 ID 해시 (자료 없는 투수 구종을 정하는 데만, 난수 아님) */
function idHash(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000003) / 1000003;
}

/**
 * 경기 엔진 구종 (엔진 2 20-1단계): 시작 연도 전 실측(사용률·등급) → 위키 목록(사용률 짐작, 주무기 등급 60) → 자료 없음(선수 ID로 정한 리그 평균 꼴 4구종).
 * 난수를 쓰지 않아 같은 선수·연도면 늘 같다. 저장하지 않는다 (월드를 만들 때마다 자료에서 다시 낸다)
 */
export function arsenalFor(data: PitchData | undefined, id: string, year: number): ArsenalLine[] {
  if (data) {
    const m = measuredArsenal(data, id, year);
    if (m) {
      const out: ArsenalLine[] = [];
      for (const x of m) {
        const t = engineType(x.type);
        if (!t || (x.usage ?? 0) < ENGINE_MIN_USAGE) continue;
        const same = out.find((l) => l.type === t);
        if (same) same.share += x.usage!;
        else out.push({ type: t, share: x.usage!, ...(typeof x.grade === 'number' ? { grade: x.grade } : {}) });
      }
      if (out.length) return out;
    }
    const w = data.wiki.players[id];
    if (w) {
      const out: ArsenalLine[] = [];
      for (const l of wikiArsenal(w, data.wiki.names, data.prior, year)) {
        const t = engineType(l.type);
        if (!t) continue;
        const share = l.share === 'mostly' ? 100 : l.share === 'rare' ? RARE_SHARE : l.share;
        const same = out.find((x) => x.type === t);
        if (same) same.share += share;
        else out.push({ type: t, share, ...(l.main ? { grade: MAIN_GRADE } : {}) });
      }
      if (out.length) return out;
    }
  }
  const shares = [54, 28, 13, 5];
  const pool = [...DEFAULT_POOL];
  const out: ArsenalLine[] = [{ type: '포심', share: shares[0] }];
  for (let k = 1; k < 4; k++) {
    let u = idHash(id, k) * pool.reduce((a, [, x]) => a + x, 0);
    let i = 0;
    while (i < pool.length - 1 && (u -= pool[i][1]) >= 0) i++;
    out.push({ type: pool[i][0], share: shares[k] });
    pool.splice(i, 1);
  }
  return out;
}

/** 월드의 투수 구종 (선수 ID → 구종, 투수와 투타 겸업만) */
export function arsenalsOf(players: readonly { id: string; pit?: unknown }[], data: PitchData | undefined, year: number): Record<string, ArsenalLine[]> {
  const out: Record<string, ArsenalLine[]> = {};
  for (const p of players) if (p.pit) out[p.id] = arsenalFor(data, p.id, year);
  return out;
}
