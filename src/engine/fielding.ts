// 수비 판정 함수 (능력치 v2 16-3a, docs/능력치v2_기획안.md 12.2~12.4·13.1~13.2·14.1~14.2·15.2~15.3).
//
// 실제 수비 이닝(defense.json, 2001~)으로 주 포지션·익숙함·수비 가능·비상 포수·평판 무게를 정하는 순수 함수다.
// 아직 엔진·리그 생성에 잇지 않는다 (16-3에서 makeDefense·posExp에 잇는다). 그래서 게임 결과·저장 지문은 그대로다.
// 난수를 쓰지 않는다. 입력은 시작 연도 전 해들의 수비 경험(FieldYear)이고, 퓨처스(2군) 이닝은 1군 이닝과 따로 받아
// 무게 W_F를 곱해 더한다 (15.2, 게임 시작 뒤에만 생긴다).

import type { DataStore } from '../data/types';
import { FIELD_POS, type FieldPos } from './defense';

/** 한 해 수비 경험. 같은 해가 여러 개여도 된다 (합쳐서 센다) */
export interface FieldYear {
  year: number;
  /** 1군 자리별 수비 이닝 (대수비·교체 수비 포함) */
  inn?: Partial<Record<FieldPos, number>>;
  /** 1군 자리별 수비 선발 경기 (포수 선발 60경기 규칙에만 쓴다. 2군 선발은 모형에 없다) */
  gs?: Partial<Record<FieldPos, number>>;
  /** 퓨처스(2군) 자리별 수비 이닝 (게임 시작 뒤 모형이 정한 값, 15.2) */
  fut?: Partial<Record<FieldPos, number>>;
  /** 타석, 수비 없는 타석 (지명타자 판정) */
  pa?: number;
  noDefPa?: number;
  /** 수비 기록이 없는 해(2000년 이전)의 대리값: 그 해 시즌 자료의 주 포지션 (C…RF·IF·OF·DH). 이닝 대신 pa를 환산한다 (결정 30) */
  proxyPos?: string;
}

/** 판정에 함께 넘기는 값 */
export interface FieldOptions {
  /** 퓨처스 이닝 무게 W_F (기본 FUT_INN_WEIGHT) */
  futWeight?: number;
  /** 수비 기록이 하나도 없을 때의 본 자리 (자료집·지명 포지션, 신인·2군 선수. 13.2) */
  listed?: FieldPos;
  /** 자리별 수비 훈련 익힘 m 0~1 (9.10). 0.5면 다 찬다 */
  train?: Partial<Record<FieldPos, number>>;
}

/** 주 포지션 판정 결과 (12.2) */
export interface MainPosition {
  /** 화면 주 포지션. 수비 없는 타석 몫이 DH_SHARE 이상이거나 수비 본 자리가 없으면 DH */
  screen: FieldPos | 'DH';
  /** 수비 본 자리 (익숙함·자리 이동의 출발점). 수비 경험도 등록 포지션도 없으면 null */
  field: FieldPos | null;
  /** 정한 길: catcher 포수 규칙, window 직전 3시즌 최다, career 커리어(최근성), listed 등록 포지션, none 없음 */
  basis: 'catcher' | 'window' | 'career' | 'listed' | 'none';
  /** 직전 3시즌 수비 없는 타석 몫 (타석이 없으면 0) */
  noDefShare: number;
}

// ---- 조정값 (결정 = 사용자 결정, 측정 = 수비 이닝 자료로 잰 값, 나머지는 임시값)

/** 퓨처스 이닝 무게 W_F (15.3, 임시값). 1군 이닝과 같은 무게 */
export const FUT_INN_WEIGHT = 1.0;
/** 판정 창: 직전 3시즌 */
const WINDOW = 3;
/** 포수 주 포지션: 직전 3시즌 포수 500이닝 또는 포수 선발 60경기 (결정 "포수 주 포지션 기준") */
const CATCHER_MAIN_INN = 500;
const CATCHER_MAIN_GS = 60;
/** 직전 3시즌 수비 이닝 합이 이만큼 안 되면 커리어 이닝(최근성)으로 본 자리를 정한다 (12.2 규칙 2, 임시값) */
const WINDOW_MIN_INN = 500;
/** 화면 주 포지션 DH: 직전 3시즌 수비 없는 타석 몫 (12.2 규칙 3, 임시값) */
const DH_SHARE = 0.6;
/** 2000년 이전 해: 주 포지션 타석 → 그 자리 이닝 (측정 1.94), 포수 규칙용 타석 → 포수 이닝 (500이닝 ÷ 200타석, 결정 30에서 맞춘 값) */
const PA_TO_INN = 1.94;
const PROXY_C_INN_PER_PA = 2.5;
/** 그 자리를 "맡은 해"로 치는 최소 이닝 (한 경기분, 12.3 임시값) */
const LAST_MIN_INN = 9;
/** 최근성: 마지막으로 맡은 뒤 2시즌까지 그대로, 그 뒤 해마다 × 0.7 (결정 18) */
const RECENT_FULL = 2;
const RECENT_DECAY = 0.7;
/** 익숙함이 다 차는 경험 몫 (13.1): max(h, m) ÷ 0.5 */
const FULL_AT = 0.5;
/** N(p) = 400 × L(본 자리 → p) ÷ 24, 최소 50 (12.3 임시값). 포수는 N 1,800 = 900이닝에 다 참 (결정 20 고침, 14.1) */
const N_PER_L = 400 / 24;
const N_MIN = 50;
const N_CATCHER = 1800;
/** 비상 포수: 직전 3시즌 포수 150이닝 이상 (결정 20 고침, 14.2) */
const EMERGENCY_C_INN = 150;
/** 평판 거름 (12.4 ①): 그 시기 그 자리 300이닝, 시기 끝 + 3시즌까지 그대로, 시기 없는 평판은 누적 이닝 ÷ 2,300 */
const REP_MIN_INN = 300;
const REP_FULL_YEARS = 3;
const REP_NO_PERIOD_INN = 2300;

/** 자리 묶음 (9.11): 포수 / 1루 / 3루 / 키스톤 / 코너 외야 / 중견수 */
type Group = 'C' | '1B' | '3B' | 'K' | 'O' | 'CF';
const GROUP: Record<FieldPos, Group> = { C: 'C', '1B': '1B', '3B': '3B', '2B': 'K', SS: 'K', LF: 'O', RF: 'O', CF: 'CF' };
/** 본 묶음 → 갈 묶음 손해 (런, 9.11 표). 11.1이 × 1.5를 곱한다. 포수로 가는 손해는 24 (11.1, N에만 쓰고 포수는 N_CATCHER가 대신한다) */
const GROUP_LOSS: Record<Group, Record<Group, number>> = {
  C: { C: 0, '1B': 4, '3B': 10, K: 16, O: 10, CF: 16 },
  '1B': { C: 60, '1B': 0, '3B': 10, K: 16, O: 8, CF: 15 },
  '3B': { C: 60, '1B': 4, '3B': 0, K: 8, O: 6, CF: 12 },
  K: { C: 60, '1B': 4, '3B': 4, K: 0, O: 6, CF: 10 },
  O: { C: 60, '1B': 5, '3B': 14, K: 18, O: 0, CF: 6 },
  CF: { C: 60, '1B': 5, '3B': 14, K: 18, O: 2, CF: 0 },
};
/** 묶음 안 손해 (9.11): SS → 2B 3, 2B → SS 6, LF → RF 3, RF → LF 1 */
const INNER_LOSS: Partial<Record<FieldPos, Partial<Record<FieldPos, number>>>> = { SS: { '2B': 3 }, '2B': { SS: 6 }, LF: { RF: 3 }, RF: { LF: 1 } };
/** 유사 포지션 (결정 10·19): 2B ↔ SS, LF ↔ RF, CF → LF·RF (코너 → CF는 아님) */
const SIMILAR: Partial<Record<FieldPos, FieldPos[]>> = { '2B': ['SS'], SS: ['2B'], LF: ['RF'], RF: ['LF'], CF: ['LF', 'RF'] };
const IF_POS: FieldPos[] = ['1B', '2B', '3B', 'SS'];
const OF_POS: FieldPos[] = ['LF', 'CF', 'RF'];
/** 2000년 이전 'IF'는 기존 수비 추정과 같이 2B·3B·SS에 ⅓씩 (defense.ts) */
const PROXY_IF: FieldPos[] = ['2B', '3B', 'SS'];

/** 본 자리 → p의 자리 이동 손해 L (런, 11.1: 9.11 표 × 1.5, 포수로 가는 것은 24) */
export function moveLoss(from: FieldPos, to: FieldPos): number {
  if (from === to) return 0;
  if (to === 'C') return 24;
  const inner = INNER_LOSS[from]?.[to];
  return (inner ?? GROUP_LOSS[GROUP[from]][GROUP[to]]) * 1.5;
}

/** 익숙함이 다 차는 기준 N(p) (이닝). 경험 몫 h = min(1, E ÷ N) × 최근성이 0.5면 다 찬다 */
function fullScale(from: FieldPos | null, to: FieldPos): number {
  if (to === 'C') return N_CATCHER;
  return Math.max(N_MIN, N_PER_L * (from ? moveLoss(from, to) : 0));
}

const isPos = (p: string | undefined | null): p is FieldPos => !!p && (FIELD_POS as readonly string[]).includes(p);

/** 그 해 p 자리 이닝 (1군 + W_F × 퓨처스, 2000년 이전은 주 포지션 타석 × 1.94) */
function yearInn(y: FieldYear, p: FieldPos, wf: number): number {
  if (y.proxyPos !== undefined) {
    const pa = y.pa ?? 0;
    if (y.proxyPos === p) return pa * PA_TO_INN;
    if (y.proxyPos === 'IF' && PROXY_IF.includes(p)) return (pa * PA_TO_INN) / 3;
    if (y.proxyPos === 'OF' && OF_POS.includes(p)) return (pa * PA_TO_INN) / 3;
    return 0;
  }
  return (y.inn?.[p] ?? 0) + wf * (y.fut?.[p] ?? 0);
}

/** 포수 규칙에 쓰는 그 해 포수 이닝 (2000년 이전은 주 포지션 C 시즌 타석 × 2.5) */
function catcherInn(y: FieldYear, wf: number): number {
  if (y.proxyPos !== undefined) return y.proxyPos === 'C' ? (y.pa ?? 0) * PROXY_C_INN_PER_PA : 0;
  return yearInn(y, 'C', wf);
}

const before = (years: FieldYear[], start: number) => years.filter((y) => y.year < start);
const window3 = (years: FieldYear[], start: number) => years.filter((y) => y.year < start && y.year >= start - WINDOW);
const wfOf = (opts?: FieldOptions) => opts?.futWeight ?? FUT_INN_WEIGHT;

/** p 자리를 마지막으로 맡은 해 (그 해 LAST_MIN_INN 이상). 없으면 undefined */
function lastYear(years: FieldYear[], p: FieldPos, wf: number): number | undefined {
  let last: number | undefined;
  for (const y of years) if (yearInn(y, p, wf) >= LAST_MIN_INN && (last === undefined || y.year > last)) last = y.year;
  return last;
}

/** 최근성 w (결정 18): k = 시작 연도 − 마지막 해, k ≤ 2면 1, 그 뒤 0.7^(k − 2). 맡은 적이 없으면 0 */
function recency(start: number, last: number | undefined): number {
  if (last === undefined) return 0;
  const k = start - last;
  return k <= RECENT_FULL ? 1 : RECENT_DECAY ** (k - RECENT_FULL);
}

/**
 * 주 포지션 (12.2, 결정 30): 시작 연도 전 기록으로.
 * 1. 직전 3시즌 포수 500이닝 또는 포수 선발 60경기 → C.
 * 2. 아니면 직전 3시즌 수비 이닝이 가장 많은 자리 (C 제외). 3시즌 수비 이닝 합이 500 미만이면 커리어 이닝 × 최근성이 가장 큰 자리.
 *    C 말고 맡은 자리가 없으면 C (포수만 본 2번 포수, 13.2). 수비 이닝이 전혀 없으면 등록 포지션(opts.listed).
 * 3. 직전 3시즌 수비 없는 타석 몫이 0.6 이상이면 화면 주 포지션은 DH (2의 자리는 수비 본 자리로 남는다).
 */
export function mainPosition(years: FieldYear[], startYear: number, opts?: FieldOptions): MainPosition {
  const wf = wfOf(opts);
  const past = before(years, startYear);
  const w3 = window3(years, startYear);
  let pa = 0;
  let nd = 0;
  let cInn = 0;
  let cGs = 0;
  let total = 0;
  for (const y of w3) {
    pa += y.pa ?? 0;
    nd += y.proxyPos !== undefined ? (y.proxyPos === 'DH' ? y.pa ?? 0 : 0) : y.noDefPa ?? 0;
    cInn += catcherInn(y, wf);
    cGs += y.gs?.C ?? 0;
    for (const p of FIELD_POS) total += yearInn(y, p, wf);
  }
  const noDefShare = pa > 0 ? nd / pa : 0;
  let field: FieldPos | null = null;
  let basis: MainPosition['basis'];
  if (cInn >= CATCHER_MAIN_INN || cGs >= CATCHER_MAIN_GS) {
    field = 'C';
    basis = 'catcher';
  } else {
    basis = total >= WINDOW_MIN_INN ? 'window' : 'career';
    const score = (p: FieldPos) =>
      basis === 'window'
        ? w3.reduce((a, y) => a + yearInn(y, p, wf), 0)
        : past.reduce((a, y) => a + yearInn(y, p, wf), 0) * recency(startYear, lastYear(past, p, wf));
    let best = 0;
    for (const p of FIELD_POS) {
      if (p === 'C') continue;
      const s = score(p);
      if (s > best) {
        best = s;
        field = p;
      }
    }
    if (!field && score('C') > 0) field = 'C';
    if (!field) {
      field = opts?.listed ?? null;
      basis = field ? 'listed' : 'none';
    }
  }
  return { screen: noDefShare >= DH_SHARE || !field ? 'DH' : field, field, basis, noDefShare };
}

/** 본 자리가 그대로 다 찬 것으로 보이는가 (13.2). 예외: 화면 DH인데 본 자리를 3시즌 넘게 맡지 않았거나 수비 이닝이 전혀 없으면 일반 식 */
function homeIsFull(years: FieldYear[], startYear: number, main: MainPosition, wf: number): boolean {
  if (!main.field) return false;
  if (main.screen !== 'DH') return true;
  if (main.basis === 'listed') return false;
  const last = lastYear(before(years, startYear), main.field, wf);
  return last !== undefined && startYear - last < WINDOW;
}

/**
 * 익숙함 u(p) 0~1 (13.1·14.1): 1이면 그 자리를 프로 수준으로 맡을 수 있다 (등급의 익숙함 몫 20 + 20u).
 * 본 자리와 그 유사 포지션은 1 (13.2, 결정 19 — 유사 포지션의 재능 손해는 similarLoss).
 * 그 밖: h = min(1, E ÷ N) × 최근성, u = min(1, max(h, 훈련 m) ÷ 0.5). E = 시작 전 그 자리 이닝 합 (1군 + W_F × 퓨처스),
 * N = 400 × L(본 자리 → p) ÷ 24 (최소 50), 포수는 1,800 (900이닝에 다 참).
 */
export function familiarity(years: FieldYear[], startYear: number, pos: FieldPos, main: MainPosition, opts?: FieldOptions): number {
  const wf = wfOf(opts);
  const full = homeIsFull(years, startYear, main, wf);
  if (full && (pos === main.field || (main.field && SIMILAR[main.field]?.includes(pos)))) return 1;
  const past = before(years, startYear);
  const e = past.reduce((a, y) => a + yearInn(y, pos, wf), 0);
  const h = Math.min(1, e / fullScale(main.field, pos)) * recency(startYear, lastYear(past, pos, wf));
  return Math.min(1, Math.max(h, opts?.train?.[pos] ?? 0) / FULL_AT);
}

/** 수비 가능 자리 = 익숙함이 다 찬 자리 (결정 25, 13.2). 비상 포수는 따로 (emergencyCatcher) */
export function playable(years: FieldYear[], startYear: number, main: MainPosition, opts?: FieldOptions): FieldPos[] {
  return FIELD_POS.filter((p) => familiarity(years, startYear, p, main, opts) >= 1);
}

/**
 * 비상 포수 (14.2, 결정 20 고침): 포수가 수비 가능이 아니고 직전 3시즌 포수 이닝 합 150 이상 (최근성은 곱하지 않는다).
 * 2000년 이전 해는 주 포지션 C 시즌 타석 × 2.5만 센다 (주 포지션이 아닌 포수 경험은 잡히지 않는다).
 */
export function emergencyCatcher(years: FieldYear[], startYear: number, main: MainPosition, opts?: FieldOptions): boolean {
  if (familiarity(years, startYear, 'C', main, opts) >= 1) return false;
  const wf = wfOf(opts);
  return window3(years, startYear).reduce((a, y) => a + catcherInn(y, wf), 0) >= EMERGENCY_C_INN;
}

/** 유사 포지션 p의 재능 손해 (등급 단위, 13.2): 2 × L(본 자리 → p) × (1 − min(1, E(p) ÷ (0.5 × N(본 자리 → p)))) */
export function similarLoss(years: FieldYear[], startYear: number, pos: FieldPos, main: MainPosition, opts?: FieldOptions): number {
  if (!main.field || !SIMILAR[main.field]?.includes(pos)) return 0;
  const wf = wfOf(opts);
  const e = before(years, startYear).reduce((a, y) => a + yearInn(y, pos, wf), 0);
  return 2 * moveLoss(main.field, pos) * (1 - Math.min(1, e / (FULL_AT * fullScale(main.field, pos))));
}

/** 수비 평판 한 줄 (defense.json rep): 자리(C…RF·IF·OF·전반), 수준 −2~2, 시기 시작·끝 (null = 통산) */
export type Reputation = readonly [pos: string, level: number, from: number | null, to: number | null];

/**
 * 평판 무게 (12.4 ①, 결정 29): 자리 → 0~1. 빈 객체면 이 평판은 쓰지 않는다.
 * - 앞날 평판(시기 시작 ≥ 시작 연도)은 버린다 (시작 능력은 직전 기록에서. 뒤 시기 평판은 수비 잠재력, 12.10).
 * - 그 시기(시기가 없으면 시작 전 전체) 그 자리 수비 300이닝 이상일 때만. 좋음 이상인데 그 시기 수비 없는 타석 몫 0.6 이상이면 버린다.
 * - 시기 끝 + 3시즌까지 1, 그 뒤 해마다 × 0.7. 시기 없는 평판은 그 자리 누적 이닝 ÷ 2,300 (최대 1).
 * - 자리는 평판 자리와 그 유사 포지션 (같은 무게). IF·OF·전반은 그 시기에 300이닝 이상 맡은 해당 자리 모두.
 * - 수비 기록이 없는 시기(2000년 이전)는 그 자리가 주 포지션인 시즌이 하나라도 있으면 쓴다.
 */
export function reputationWeight(rep: Reputation, years: FieldYear[], startYear: number, opts?: FieldOptions): Partial<Record<FieldPos, number>> {
  const [pos, level, from, to] = rep;
  if (from !== null && from >= startYear) return {};
  const wf = wfOf(opts);
  const hi = Math.min(to ?? startYear - 1, startYear - 1);
  const span = years.filter((y) => y.year < startYear && (from === null || (y.year >= from && y.year <= hi)));
  if (level >= 1) {
    let pa = 0;
    let nd = 0;
    for (const y of span) {
      pa += y.pa ?? 0;
      nd += y.proxyPos !== undefined ? (y.proxyPos === 'DH' ? y.pa ?? 0 : 0) : y.noDefPa ?? 0;
    }
    if (pa > 0 && nd / pa >= DH_SHARE) return {};
  }
  const gap = from === null ? 0 : startYear - (to ?? startYear);
  const fade = gap <= REP_FULL_YEARS ? 1 : RECENT_DECAY ** (gap - REP_FULL_YEARS);
  const recorded = span.some((y) => y.proxyPos === undefined);
  const targets: FieldPos[] = pos === '전반' ? [...FIELD_POS] : pos === 'IF' ? IF_POS : pos === 'OF' ? OF_POS : isPos(pos) ? [pos] : [];
  const out: Partial<Record<FieldPos, number>> = {};
  for (const p of targets) {
    if (recorded) {
      const inn = span.reduce((a, y) => a + yearInn(y, p, wf), 0);
      if (inn < REP_MIN_INN) continue;
      out[p] = from === null ? Math.min(1, inn / REP_NO_PERIOD_INN) : fade;
    } else if (span.some((y) => yearInn(y, p, wf) > 0)) {
      out[p] = fade;
    }
  }
  if (isPos(pos) && out[pos] !== undefined) for (const q of SIMILAR[pos] ?? []) out[q] ??= out[pos];
  return out;
}

/**
 * 데이터에서 한 선수의 수비 경험을 모은다 (시작 연도 전 해만): defense.json의 해(2001~)는 이닝·선발·타석,
 * 그 전 해는 불러온 시즌 자료의 주 포지션·타석 (대리값, 시즌마다 한 줄). 퓨처스 이닝은 없다 (게임 시작 뒤 이력에서 더한다).
 */
export function fieldYears(store: Pick<DataStore, 'defense' | 'season' | 'meta'>, id: string, startYear: number): FieldYear[] {
  const def = store.defense;
  const out: FieldYear[] = [];
  const firstRecord = def?.from ?? Infinity;
  const gsAt = def ? def.fields.indexOf('gs') : -1;
  const outsAt = def ? def.fields.indexOf('outs') : -1;
  for (const [ys, d] of Object.entries(def?.players[id] ?? {})) {
    const year = Number(ys);
    if (year >= startYear) continue;
    const inn: Partial<Record<FieldPos, number>> = {};
    const gs: Partial<Record<FieldPos, number>> = {};
    for (const [p, v] of Object.entries(d.p ?? {})) {
      if (!isPos(p)) continue;
      inn[p] = v[outsAt] / 3;
      gs[p] = v[gsAt];
    }
    out.push({ year, inn, gs, pa: d.pa, noDefPa: d.nd });
  }
  for (const year of store.meta.years) {
    if (year >= Math.min(firstRecord, startYear)) continue;
    for (const b of store.season(year)?.bat ?? []) {
      if (b.id === id && b.pa > 0) out.push({ year, proxyPos: b.pos ?? '', pa: b.pa });
    }
  }
  return out.sort((a, b) => a.year - b.year);
}
