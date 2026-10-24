// 구장 효과 계산 (docs/구장효과_기획안.md 4·5장). 엔진(game.ts·ratings.ts buildWorld)·능력 산출(seasonPark)·리그(stadium.ts)·화면이
// 같은 함수로 실제 구장 배율을 읽는다.
//
// SimTeam.park = { hr, run?, ev? }: run = 실제 구장 득점 계수 f, ev = 사건별 배율(좌타 L·우타 R 포함), hr = 게임 안 신구장 홈런 배율.
// ev가 있으면 ev를 쓰고, 없으면 f를 지수(params.park hitExp·hrExp)로 나눈다. 신구장 hr은 홈런에 곱한다.
//
// 실제 구장 값 (realParkYear, 기획안 4.3 섞는 규칙):
//  ① 실측 해 (meta.parkFactors가 있는 해, 2015~2026): 그 해 f + 구성표 모양(meta.parkEvents). 단 그 구장-기간(펜스가 바뀌지 않고
//     이어진 제원 행)이 구성표 해(2022~2025)를 포함하지 않으면 구성표 모양 대신 지수 규칙 (사직 2015~2021, 결정 16)
//  ② 옛 해, 그 해 제원 행이 실측 기간 행까지 '리모델링' 없이 이어짐: 실측 기간 평균 × (그 해 제원 짐작 ÷ 실측 기간 행 제원 짐작)
//     (차이 방식, 결정 1·14. 제원이 같으면 비가 1이라 실측을 그대로 거꾸로 쓴다)
//  ③ 옛 해, 사이에 '리모델링' / ④ 실측 전에 사라진 구장: 그 해 제원 짐작 × 당김 w (결정 6·15)
//  ⑤ 제원이 비었음: 1 (중립)
//  ⑧ 그 구단 홈 경기에만 쓰는 제원 행(잠실 X-존, 계보 열): ②와 같은 차이 방식을 그 구단 값에만 (결정 13)
//  옛 해(②~⑤·⑧)는 해마다 사건별로 구단 평균이 1이 되게 나눈다 (리그 평균 득점은 그대로). 실측 해는 f가 이미 구단 평균 1이다.
//  마지막 실측 해 뒤(2027~)는 realParkLater (기획안 4.5, P7): 쓰던 구장의 실측 기간 평균, 확정 제원이 있는 실제 새 구장은 짐작 × 당김.
//  게임 안 펜스 공사(펜스 조정·가벽, 기획안 6.7·6.8)의 바탕은 fenceBaseOf (조정 전 값 = 실측 기간 평균).

import type { Meta, ParkData, ParkEvents, ParkRates, ParkSpec, Rates } from '../data/types';
import { NEUTRAL_PARK, type GamePark } from './pa';
import type { EngineParams } from './params';
import type { SimTeam } from './types';

type ParkParams = EngineParams['park'];

/** 경기에 쓰는 홈 구장 사건별 배율 (game.ts) */
export function gameParkOf(tp: SimTeam['park'] | undefined, p: ParkParams): GamePark {
  if (!tp) return NEUTRAL_PARK;
  const run = tp.run ?? 1;
  const withHr = (x: ParkRates | undefined): ParkRates | undefined => x && { s1: x.s1, d2: x.d2, t3: x.t3, hr: tp.hr * x.hr };
  if (tp.ev) return { ...withHr(tp.ev)!, L: withHr(tp.ev.L), R: withHr(tp.ev.R) };
  const hit = run ** p.hitExp;
  return { s1: hit, d2: hit, t3: hit, hr: tp.hr * run ** p.hrExp };
}

/**
 * 사건별 배율이 내는 득점 계수: 1 + Σ 득점 가치 × 리그 비율 × (배율 − 1) ÷ 타석당 득점 (build_data.py park_events와 같은 식).
 * rates는 그 해 리그 타석 결과 비율, rpa는 타석당 득점
 */
export function runFactorOf(m: ParkRates, rates: Pick<Rates, 's1' | 'd2' | 't3' | 'hr'>, rpa: number, p: ParkParams): number {
  if (!(rpa > 0)) return 1;
  const v = p.runValue;
  return 1 + (v.s1 * rates.s1 * (m.s1 - 1) + v.d2 * rates.d2 * (m.d2 - 1) + v.t3 * rates.t3 * (m.t3 - 1) + v.hr * rates.hr * (m.hr - 1)) / rpa;
}

/** 화면용 구장 지수 (배율, 1 = 리그 평균): 득점 계수와 사건별 배율, 좌타·우타 홈런 */
export interface ParkIndex {
  run: number;
  s1: number;
  d2: number;
  t3: number;
  hr: number;
  hrL: number;
  hrR: number;
}

export function parkIndexOf(tp: SimTeam['park'] | undefined, p: ParkParams, rates: Pick<Rates, 's1' | 'd2' | 't3' | 'hr'>, rpa: number): ParkIndex {
  const g = gameParkOf(tp, p);
  // 실제 구장 득점 계수가 있고 신구장 배율이 없으면 그 값 그대로 (사건별 배율의 수준을 그 값에 맞춰 두었다)
  const run = tp?.run !== undefined && tp.hr === 1 ? tp.run : runFactorOf(g, rates, rpa, p);
  return { run, s1: g.s1, d2: g.d2, t3: g.t3, hr: g.hr, hrL: g.L?.hr ?? g.hr, hrR: g.R?.hr ?? g.hr };
}

// ---- 실제 구장 값 (기획안 4.3)

/** 실제 구장 값의 근거: 실측 / 실측 기간 평균(마지막 실측 해 뒤) / 실측을 옛 해에 거꾸로(제원 같음) / 실측 × 펜스 차이(차이 방식) / 제원 짐작 */
export type RealParkBasis = 'measured' | 'mean' | 'back' | 'diff' | 'guess';

export interface RealParkValue {
  /** 득점 계수 f (실측 해는 하드힛 f, 옛 해는 사건별 배율로 센 값) */
  run: number;
  /** 사건별 배율. 실측 해에 구성표가 없으면 없다 (f를 지수로 나눈다) */
  ev?: ParkEvents;
  basis: RealParkBasis;
}

/** 구장 값을 만드는 자료: 실측 표(meta)와 구장 제원(parks.json). 제원이 없으면 옛 해는 모두 중립 (P5 전과 같다) */
export type ParkSource = Pick<Meta, 'parkFactors' | 'parkEvents'> & { parks?: ParkData };

/** 그 해 리그 비율과 타석당 득점 (옛 해 득점 계수를 셀 때) */
export interface ParkLeagueRates {
  rates: Pick<Rates, 's1' | 'd2' | 't3' | 'hr'>;
  rpa: number;
}

/** 구성표(하드힛 구장 구성 지수)가 묶은 해. 구장-기간이 이 사이 해를 포함해야 구성표 모양을 쓴다 (build_data.py park_events) */
export const PARK_COMPONENT_YEARS: [number, number] = [2022, 2025];

const EVENTS = ['s1', 'd2', 't3', 'hr'] as const;
const clampTo = (x: number, [lo, hi]: [number, number]) => Math.min(hi / 100, Math.max(lo / 100, x));
const covers = (r: ParkSpec, year: number) => r.from <= year && year <= (r.to ?? Infinity);

/** 그 해 그 계보의 주 구장 ID (parks.json 사용 행, 계획 행은 빼고) */
export function mainParkId(parks: ParkData, franchise: string, year: number): string | undefined {
  let best: ParkData['use'][number] | undefined;
  for (const u of parks.use) {
    if (u.kind === '주' && u.franchise === franchise && u.from <= year && year <= (u.to ?? Infinity) && (!best || u.from > best.from)) best = u;
  }
  return best?.park;
}

/** 한 구장의 공용 제원 행 (계보 행 = 가벽은 빼고), 시작 해 순 */
function parkRows(parks: ParkData, id: string): ParkSpec[] {
  return parks.specs.filter((r) => r.id === id && !r.franchise).sort((a, b) => a.from - b.from);
}

/** 펜스가 바뀌지 않고 이어진 구장-기간 ('없음'으로 이어진 행들)의 첫 해·끝 해 */
function fencePeriod(rows: ParkSpec[], i: number): [number, number] {
  let a = i;
  while (a > 0 && rows[a].change === '없음') a--;
  let b = i;
  while (b + 1 < rows.length && rows[b + 1].change === '없음') b++;
  return [rows[a].from, rows[b].to ?? Infinity];
}

export interface GuessLogs {
  hr: number;
  xb: number;
  hrL: number;
  hrR: number;
}

/** 제원 회귀 짐작 (당김 없음, 기획안 6.2): log 지수. 좌·중·우 펜스 거리 중 하나라도 비었으면 null */
export function guessLogs(sp: Pick<ParkSpec, 'fence' | 'height'>, p: ParkParams): GuessLogs | null {
  const { l, c, r } = sp.fence;
  if (l == null || c == null || r == null) return null;
  const fit = p.specFit;
  const avg = (l + c + r) / 3;
  const hs = [sp.height.lr, sp.height.c].filter((h): h is number => h != null);
  const dh = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length - fit.height.base : 0;
  const hr = fit.hr[0] + fit.hr[1] * avg + Math.log(1 + fit.height.hr) * dh;
  const xb = fit.xb[0] + fit.xb[1] * avg + Math.log(1 + fit.height.xb) * dh;
  // 좌타는 우측 펜스 쪽으로 당겨 친다: 우측이 짧으면(l > r) 좌타 홈런이 늘고 우타는 그만큼 준다
  const k = Math.max(-fit.asym.max, Math.min(fit.asym.max, fit.asym.perM * (l - r)));
  return { hr, xb, hrL: hr + Math.log(1 + k), hrR: hr + Math.log(1 - k) };
}

/** 지수 규칙: 득점 계수 f를 안타·홈런 배율로 나눈다 (구성표가 없는 실측 구장) */
function byExp(f: number, p: ParkParams): ParkEvents {
  const hit = f ** p.hitExp;
  return { s1: hit, d2: hit, t3: hit, hr: f ** p.hrExp };
}

/** 그 해 구장-기간이 구성표 해를 포함하는가 (제원 자료가 없으면 포함으로 본다 = P5 전과 같다) */
function componentsCover(parks: ParkData | undefined, franchise: string, year: number): boolean {
  if (!parks) return true;
  const id = mainParkId(parks, franchise, year);
  if (!id) return true;
  const rows = parkRows(parks, id);
  const i = rows.findIndex((r) => covers(r, year));
  if (i < 0) return true;
  const [a, b] = fencePeriod(rows, i);
  return a <= PARK_COMPONENT_YEARS[1] && b >= PARK_COMPONENT_YEARS[0];
}

/** ① 실측 해 값 (shape = 구성표 모양, 아니면 지수 규칙). 자료가 없으면 undefined */
function measuredAt(src: ParkSource, franchise: string, year: number, p: ParkParams): { f: number; ev: ParkEvents; shape: boolean } | undefined {
  const f = src.parkFactors?.[String(year)]?.[franchise];
  if (f === undefined) return undefined;
  const ev = src.parkEvents?.[String(year)]?.[franchise];
  if (ev && componentsCover(src.parks, franchise, year)) return { f, ev, shape: true };
  return { f, ev: byExp(f, p), shape: false };
}

/** 사건별 배율의 기하 평균 (좌타·우타는 모든 해에 있을 때만) */
function geoMean(list: ParkEvents[]): ParkEvents {
  const mean = (get: (e: ParkEvents) => ParkRates): ParkRates => {
    const out = { s1: 0, d2: 0, t3: 0, hr: 0 };
    for (const k of EVENTS) out[k] = Math.exp(list.reduce((a, e) => a + Math.log(get(e)[k]), 0) / list.length);
    return out;
  };
  const all = mean((e) => e);
  return list.every((e) => e.L && e.R) ? { ...all, L: mean((e) => e.L!), R: mean((e) => e.R!) } : all;
}

/** 그 계보가 그 구장을 주 구장으로 쓴 실측 해 */
function measuredYearsAt(src: ParkSource, parks: ParkData, franchise: string, id: string): number[] {
  return Object.keys(src.parkFactors ?? {}).map(Number)
    .filter((y) => src.parkFactors![String(y)][franchise] !== undefined && mainParkId(parks, franchise, y) === id);
}

/** ②⑧ 바탕: 실측 기간 행이 속한 구장-기간의 그 계보 실측 해 평균 (기획안 4.1 기간 평균) */
function measuredMean(src: ParkSource, years: number[], rows: ParkSpec[], j: number, franchise: string, p: ParkParams): ParkEvents | undefined {
  const [a, b] = fencePeriod(rows, j);
  const list = years.filter((y) => y >= a && y <= b).map((y) => measuredAt(src, franchise, y, p)!.ev);
  return list.length ? geoMean(list) : undefined;
}

/** 차이 방식: 바탕 실측 × (그 해 제원 짐작 ÷ 실측 기간 행 제원 짐작), 상·하한은 곱한 뒤 한 번 (기획안 4.3: 비에 당김 없음) */
export function applyDiff(base: ParkEvents, own: GuessLogs, ref: GuessLogs, p: ParkParams): ParkEvents {
  const c = p.specFit.clamp;
  const dxb = Math.exp(own.xb - ref.xb);
  const one = (x: ParkRates, dhr: number, hrClamp: [number, number]): ParkRates => ({
    s1: x.s1, d2: clampTo(x.d2 * dxb, c.xb), t3: clampTo(x.t3 * dxb, c.xb), hr: clampTo(x.hr * Math.exp(dhr), hrClamp),
  });
  const out: ParkEvents = one(base, own.hr - ref.hr, c.hr);
  if (base.L) out.L = one(base.L, own.hrL - ref.hrL, c.side);
  if (base.R) out.R = one(base.R, own.hrR - ref.hrR, c.side);
  return out;
}

/** ③④ 짐작 × 당김 w, 좌우 같음 (기획안 4.3) */
function guessed(g: GuessLogs, p: ParkParams): ParkEvents {
  const { w, clamp: c } = p.specFit;
  const xb = clampTo(Math.exp(w * g.xb), c.xb);
  return { s1: 1, d2: xb, t3: xb, hr: clampTo(Math.exp(w * g.hr), c.hr) };
}

/** 옛 해(실측 전) 한 계보의 값 (평균 1 맞춤 전). 중립이면 undefined */
function proxyOf(src: ParkSource, parks: ParkData, franchise: string, year: number, p: ParkParams,
                 noOwn = false): { ev: ParkEvents; basis: RealParkBasis } | undefined {
  const id = mainParkId(parks, franchise, year);
  if (!id) return undefined;
  const rows = parkRows(parks, id);
  const i = rows.findIndex((r) => covers(r, year));
  if (i < 0) return undefined;
  // 그 구단 홈 경기에만 쓰는 제원 행(⑧ 실제 역사의 가벽)이 있으면 그 행이 그 해 제원 (noOwn: 게임 안에서 가벽을 세우거나 걷은 구단은 따르지 않음)
  const own = (noOwn ? undefined : ownRow(parks, id, franchise, year)) ?? rows[i];
  // 실측 기간 행: 그 해 행부터 뒤로 '리모델링' 없이 이어진 행 가운데 그 계보 실측 해가 있는 첫 행
  const years = measuredYearsAt(src, parks, franchise, id);
  let j = -1;
  for (let k = i; k < rows.length; k++) {
    if (k > i && rows[k].change === '리모델링') break;
    if (years.some((y) => covers(rows[k], y))) { j = k; break; }
  }
  const g = guessLogs(own, p);
  if (j >= 0) {
    const base = measuredMean(src, years, rows, j, franchise, p);
    if (!base) return undefined;
    const ref = guessLogs(rows[j], p);
    const same = !g || !ref || (g.hr === ref.hr && g.xb === ref.xb && g.hrL === ref.hrL && g.hrR === ref.hrR);
    return same ? { ev: base, basis: 'back' } : { ev: applyDiff(base, g, ref, p), basis: 'diff' };
  }
  return g ? { ev: guessed(g, p), basis: 'guess' } : undefined;
}

/** 그 구단 홈 경기에만 쓰는 제원 행 (⑧ 실제 역사의 가벽, 잠실 X-존) */
function ownRow(parks: ParkData, id: string, franchise: string, year: number): ParkSpec | undefined {
  return parks.specs.find((r) => r.id === id && r.franchise === franchise && covers(r, year));
}

const yearCache = new WeakMap<object, Map<ParkData | null, Map<string, Map<string, RealParkValue>>>>();

/**
 * 그 해 실제 구장 값 (계보 → 값). franchises = 그 해 리그 구단 계보 (옛 해 평균 1 맞춤에 쓴다).
 * 중립(1)인 계보는 넣지 않는다. 마지막 실측 해 뒤는 비어 있다 (realParkLater).
 * 같은 자료·해·구단 목록·조정값이면 한 번만 센다 (능력 산출이 선수 시즌마다 부른다). 돌려준 Map은 고치지 않는다
 */
export function realParkYear(src: ParkSource, year: number, franchises: string[], lg: ParkLeagueRates, p: ParkParams): Map<string, RealParkValue> {
  if (!src.parkFactors) return new Map();
  const frs = [...new Set(franchises)].sort();
  const key = `${year}|${frs.join(',')}|${lg.rpa}|${JSON.stringify(p)}`;
  let byFactors = yearCache.get(src.parkFactors);
  if (!byFactors) yearCache.set(src.parkFactors, (byFactors = new Map()));
  let byParks = byFactors.get(src.parks ?? null);
  if (!byParks) byFactors.set(src.parks ?? null, (byParks = new Map()));
  let out = byParks.get(key);
  if (!out) byParks.set(key, (out = computeYear(src, year, frs, lg, p)));
  return out;
}

function computeYear(src: ParkSource, year: number, frs: string[], lg: ParkLeagueRates, p: ParkParams): Map<string, RealParkValue> {
  const out = new Map<string, RealParkValue>();
  if (src.parkFactors?.[String(year)]) {
    for (const fr of frs) {
      const m = measuredAt(src, fr, year, p);
      if (m) out.set(fr, { run: m.f, ...(m.shape ? { ev: m.ev } : {}), basis: 'measured' });
    }
    return out;
  }
  const raw = proxyYear(src, year, frs, p);
  if (!raw) return out;
  const mean = yearMean(raw);
  for (const [fr, v] of raw) out.set(fr, normalized(v, mean, lg, p));
  return out;
}

/** 옛 해 구단마다 값 (평균 1 맞춤 전). 옛 해가 아니거나 제원 자료가 없으면 undefined */
function proxyYear(src: ParkSource, year: number, frs: string[], p: ParkParams): Map<string, { ev: ParkEvents; basis: RealParkBasis }> | undefined {
  const parks = src.parks;
  const measuredYears = Object.keys(src.parkFactors ?? {}).map(Number);
  if (!parks || !measuredYears.length || year > Math.min(...measuredYears)) return undefined;
  const raw = new Map<string, { ev: ParkEvents; basis: RealParkBasis }>();
  for (const fr of frs) {
    const v = proxyOf(src, parks, fr, year, p);
    if (v) raw.set(fr, v);
  }
  return raw;
}

/** 해마다 사건별 구단 평균 1: 값이 있는 구단끼리 평균 1로 나눈다 (중립 구단은 1 그대로라 리그 전체 평균도 1) */
function yearMean(raw: Map<string, { ev: ParkEvents }>): ParkRates {
  const mean = { s1: 0, d2: 0, t3: 0, hr: 0 };
  for (const k of EVENTS) mean[k] = [...raw.values()].reduce((a, v) => a + v.ev[k], 0) / Math.max(1, raw.size);
  return mean;
}

function normalized(v: { ev: ParkEvents; basis: RealParkBasis }, mean: ParkRates, lg: ParkLeagueRates, p: ParkParams): RealParkValue {
  const norm = (x: ParkRates): ParkRates => ({ s1: x.s1 / mean.s1, d2: x.d2 / mean.d2, t3: x.t3 / mean.t3, hr: x.hr / mean.hr });
  const ev: ParkEvents = { ...norm(v.ev), ...(v.ev.L ? { L: norm(v.ev.L) } : {}), ...(v.ev.R ? { R: norm(v.ev.R) } : {}) };
  return { run: runFactorOf(ev, lg.rates, lg.rpa, p), ev, basis: v.basis };
}

/**
 * 그 구단 홈 경기에만 쓰는 실제 역사 제원 행(⑧ X-존)을 따르지 않는 그 해 값 (기획안 6.8.9: 게임 안에서 가벽을 세우거나 걷은 구단).
 * 평균 1 맞춤은 역사대로 센 그 해 평균을 그대로 쓴다 (다른 구단 값은 바뀌지 않는다). 그런 행이 없으면 realParkYear와 같다
 */
export function realParkNoOwn(src: ParkSource, year: number, franchise: string, franchises: string[], lg: ParkLeagueRates, p: ParkParams): RealParkValue | undefined {
  const same = realParkYear(src, year, franchises, lg, p).get(franchise);
  const parks = src.parks;
  const id = parks && mainParkId(parks, franchise, year);
  if (!parks || !id || !ownRow(parks, id, franchise, year)) return same;
  const raw = proxyYear(src, year, [...new Set(franchises)].sort(), p);
  const v = raw && proxyOf(src, parks, franchise, year, p, true);
  return raw && v ? normalized(v, yearMean(raw), lg, p) : undefined;
}

// ---- 마지막 실측 해 뒤 (기획안 4.5, 결정 8, P7)

/** 펜스 거리 셋이 다 있고 출처 확인된 제원 행 (실제 미래 구장이 '확정'인가) */
const confirmedSpec = (r: ParkSpec | undefined) => !!r && r.confirmed === '출처 확인' && r.fence.l != null && r.fence.c != null && r.fence.r != null;

/** 그 해 그 계보가 옮겨 가는 확정된 실제 계획 구장 (구장_사용.csv 구분 = 계획, 그 해 제원 행이 확정). 없으면 undefined */
export function confirmedPlannedPark(parks: ParkData, franchise: string, year: number): { id: string; from: number; row: ParkSpec } | undefined {
  let best: ParkData['use'][number] | undefined;
  for (const u of parks.use) {
    if (u.kind === '계획' && u.franchise === franchise && u.from <= year && year <= (u.to ?? Infinity) && (!best || u.from > best.from)) best = u;
  }
  if (!best) return undefined;
  const row = parkRows(parks, best.park).find((r) => covers(r, year));
  return row && confirmedSpec(row) ? { id: best.park, from: best.from, row } : undefined;
}

/** 그 해 경기에 쓰는 구장 ID: 확정된 계획 구장, 아니면 주 구장 (확정 전 계획 구장은 쓰던 구장 그대로, 결정 8) */
export function homeParkId(parks: ParkData, franchise: string, year: number): string | undefined {
  return confirmedPlannedPark(parks, franchise, year)?.id ?? mainParkId(parks, franchise, year);
}

/** 그 해 그 구단 홈 경기에만 쓰는 실제 역사의 가벽 행 (잠실 X-존 2009~2010 LG). 없으면 undefined */
export function historyWallAt(parks: ParkData, franchise: string, year: number): ParkSpec | undefined {
  const id = mainParkId(parks, franchise, year);
  return id ? ownRow(parks, id, franchise, year) : undefined;
}

/** 그 해를 덮는 공용 제원 행의 색인 (없으면 그 해 앞의 마지막 행, 그것도 없으면 −1) */
function rowAt(rows: ParkSpec[], year: number): number {
  const i = rows.findIndex((r) => covers(r, year));
  if (i >= 0) return i;
  let j = -1;
  rows.forEach((r, k) => { if (r.from <= year) j = k; });
  return j;
}

/** 그 계보가 쓴 구장-기간(행 i가 속한 펜스 기간)의 실측 해 기간 평균: 득점 계수 f의 기하 평균과 사건별 배율 (기획안 4.1) */
function periodMean(src: ParkSource, parks: ParkData, franchise: string, id: string, rows: ParkSpec[], i: number,
                    p: ParkParams): { f: number; ev: ParkEvents; shape: boolean } | undefined {
  const [a, b] = fencePeriod(rows, i);
  const list = measuredYearsAt(src, parks, franchise, id).filter((y) => y >= a && y <= b).map((y) => measuredAt(src, franchise, y, p)!);
  if (!list.length) return undefined;
  const f = Math.exp(list.reduce((s, m) => s + Math.log(m.f), 0) / list.length);
  return { f, ev: geoMean(list.map((m) => m.ev)), shape: list.some((m) => m.shape) };
}

/**
 * 마지막 실측 해 뒤 그 해 실제 구장 값 (기획안 4.5, P7). 쓰던 구장이면 그 구장-기간의 실측 기간 평균 (한 해의 운이 앞으로 계속 박히지 않게, 4.1).
 * 확정 제원이 있는 실제 새 구장이면 그 제원 짐작 × 당김 w (4.4). 확정 전 계획 구장(잠실 돔 2032)은 쓰던 구장 값 그대로 (결정 8).
 * 제원 자료가 없으면 마지막 실측 해 값. 중립이면 undefined
 */
export function realParkLater(src: ParkSource, franchise: string, year: number, lg: ParkLeagueRates, p: ParkParams): RealParkValue | undefined {
  const table = src.parkFactors ?? {};
  const last = Math.max(...Object.keys(table).map(Number));
  const parks = src.parks;
  if (!parks) {
    const f = table[String(last)]?.[franchise];
    const ev = src.parkEvents?.[String(last)]?.[franchise];
    return f === undefined ? undefined : { run: f, ...(ev ? { ev } : {}), basis: 'measured' };
  }
  const planned = confirmedPlannedPark(parks, franchise, year);
  if (planned) {
    const g = guessLogs(planned.row, p);
    if (!g) return undefined;
    const ev = guessed(g, p);
    return { run: runFactorOf(ev, lg.rates, lg.rpa, p), ev, basis: 'guess' };
  }
  const id = mainParkId(parks, franchise, year);
  if (!id) return undefined;
  const rows = parkRows(parks, id);
  const i = rowAt(rows, year);
  const m = i >= 0 ? periodMean(src, parks, franchise, id, rows, i, p) : undefined;
  return m ? { run: m.f, ...(m.shape ? { ev: m.ev } : {}), basis: 'mean' } : undefined;
}

// ---- 게임 안 펜스 공사의 바탕 (기획안 6.7.2·6.8.4, 결정 11)

/** 펜스 공사 바탕: 조정 뒤 값 = applyDiff(base, 새 제원 짐작, ref). row = 지금 펜스 제원 행 (없으면 중립 예시값 제원으로 본다) */
export interface FenceBase {
  base: ParkEvents;
  ref: GuessLogs;
  row?: ParkSpec;
}

/** 제원 행 → 펜스 (높이는 0.1m 단위 정수, 좌우·중앙 평균. 높이가 비면 회귀식 기준 높이). 거리가 비면 null */
export function fenceOfRow(row: Pick<ParkSpec, 'fence' | 'height'>, p: ParkParams): Fence | null {
  const { l, c, r } = row.fence;
  if (l == null || c == null || r == null) return null;
  const hs = [row.height.lr, row.height.c].filter((h): h is number => h != null);
  const h = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : p.specFit.height.base;
  return { l, c, r, h: Math.round(h * 10) };
}

/** 고른 펜스 → 짐작에 넣을 제원. 지금 행과 같은 칸은 행 값 그대로 (그대로 둔 칸은 차이 방식에서 정확히 지워진다) */
export function fenceSpecOf(f: Fence, row: Pick<ParkSpec, 'fence' | 'height'> | undefined, p: ParkParams): Pick<ParkSpec, 'fence' | 'height'> {
  const cur = row ? fenceOfRow(row, p) : null;
  if (!row || !cur) return { fence: { l: f.l, lc: null, c: f.c, rc: null, r: f.r }, height: { lr: f.h / 10, c: f.h / 10 } };
  return {
    fence: { ...row.fence, l: f.l === cur.l ? row.fence.l : f.l, c: f.c === cur.c ? row.fence.c : f.c, r: f.r === cur.r ? row.fence.r : f.r },
    height: f.h === cur.h ? row.height : { lr: f.h / 10, c: f.h / 10 },
  };
}

const ONES: ParkRates = { s1: 1, d2: 1, t3: 1, hr: 1 };

/**
 * 그 해 그 계보 실제 구장의 펜스 공사 바탕 (기획안 6.7.2): 조정 전 값 = 그 구장-기간의 실측 기간 평균(4.1), ref = 그 실측 기간 행 제원 짐작.
 * 실측이 닿지 않는 옛 구장은 그 해 제원 짐작 × 당김(③④)이 조정 전 값, ref = 그 제원 짐작. 제원이 없으면 1에서 중립 예시값(neutral) 제원.
 * 그 구단 홈 경기에만 쓰는 실제 역사 행(X-존)은 보지 않는다 (가벽은 원래 펜스 앞에 세운다)
 */
export function fenceBaseOf(src: ParkSource, franchise: string, year: number, neutral: Fence, p: ParkParams): FenceBase {
  const plain = (row?: ParkSpec): FenceBase => ({
    base: { ...ONES, L: { ...ONES }, R: { ...ONES } }, ref: guessLogs(fenceSpecOf(neutral, undefined, p), p)!, ...(row ? { row } : {}),
  });
  const parks = src.parks;
  const id = parks && homeParkId(parks, franchise, year);
  if (!parks || !id) return plain();
  const rows = parkRows(parks, id);
  const i = rowAt(rows, year);
  if (i < 0) return plain();
  const g = guessLogs(rows[i], p);
  if (!g) return plain(rows[i]);
  // 실측 기간 행: 그 해 행부터 뒤로 '리모델링' 없이 이어진 행 가운데 그 계보 실측 해가 있는 첫 행 (proxyOf와 같다)
  const years = measuredYearsAt(src, parks, franchise, id);
  for (let k = i; k < rows.length; k++) {
    if (k > i && rows[k].change === '리모델링') break;
    if (!years.some((y) => covers(rows[k], y))) continue;
    const m = periodMean(src, parks, franchise, id, rows, k, p);
    const ref = guessLogs(rows[k], p);
    if (m && ref) return { base: m.ev, ref, row: rows[i] };
    break;
  }
  return { base: guessed(g, p), ref: g, row: rows[i] };
}

// ---- 게임 안 신구장 (기획안 6장, 결정 7, 단순 규칙 6.3)

/** 신구장 펜스 제원: 좌·중·우 거리 (m 정수), 높이 (0.1m 단위 정수, 예 30 = 3.0m) */
export interface Fence {
  l: number;
  c: number;
  r: number;
  h: number;
}

/** 고를 수 있는 제원인가 (params.park.specFit.range, 거리 1m·높이 0.5m 단위) */
export function fenceValid(f: Fence, p: ParkParams): boolean {
  const { side, center, height } = p.specFit.range;
  const int = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
  return int(f.l) && int(f.c) && int(f.r) && int(f.h)
    && f.l >= side[0] && f.l <= side[1] && f.r >= side[0] && f.r <= side[1] && f.c >= center[0] && f.c <= center[1]
    && f.h >= Math.round(height[0] * 10) && f.h <= Math.round(height[1] * 10) && f.h % 5 === 0;
}

/**
 * 고른 제원 → 사건별 배율 (단타 1, 좌타·우타 포함). 평균 거리를 고르는 범위 끝의 지수(newPark)에 대고 log 직선,
 * 높이·좌우 비대칭 규칙(6.2)을 더한 뒤 상·하한. edge = 상·하한에 닿은 지수 (화면 "범위 끝")
 */
export function fenceParkEvents(f: Fence, p: ParkParams): { ev: ParkEvents; edge: { hr: boolean; xb: boolean } } {
  const fit = p.specFit;
  const lo = (fit.range.side[0] * 2 + fit.range.center[0]) / 3;
  const hi = (fit.range.side[1] * 2 + fit.range.center[1]) / 3;
  const t = ((f.l + f.c + f.r) / 3 - lo) / (hi - lo);
  const line = ([a, b]: [number, number]) => Math.log(a / 100) + (Math.log(b / 100) - Math.log(a / 100)) * t;
  const dh = f.h / 10 - fit.height.base;
  const hr = line(fit.newPark.hr) + Math.log(1 + fit.height.hr) * dh;
  const xb = line(fit.newPark.xb) + Math.log(1 + fit.height.xb) * dh;
  const k = Math.max(-fit.asym.max, Math.min(fit.asym.max, fit.asym.perM * (f.l - f.r)));
  const c = fit.clamp;
  const hrM = clampTo(Math.exp(hr), c.hr);
  const xbM = clampTo(Math.exp(xb), c.xb);
  const side = (dk: number): ParkRates => ({ s1: 1, d2: xbM, t3: xbM, hr: clampTo(hrM * (1 + dk), c.side) });
  const edge = { hr: hrM !== Math.exp(hr), xb: xbM !== Math.exp(xb) };
  return { ev: { s1: 1, d2: xbM, t3: xbM, hr: hrM, L: side(k), R: side(-k) }, edge };
}
