// 수비 판정 함수 (능력치 v2 16-3a, docs/능력치v2_기획안.md 12.2~12.4·13.1~13.2·14.1~14.2·15.2~15.3).
//
// 실제 수비 이닝(defense.json, 2001~)으로 주 포지션·익숙함·수비 가능·비상 포수·평판 무게를 정하는 순수 함수다.
// 16-3에서 등급(defenseV2·virtualDefense, 이 파일 끝)과 함께 월드 만들기(ratings.ts)·가상 선수(league/world.ts leagueDefense)에 이었다.
// 난수를 쓰지 않는다. 입력은 시작 연도 전 해들의 수비 경험(FieldYear)이고, 퓨처스(2군) 이닝은 1군 이닝과 따로 받아
// 무게 W_F를 곱해 더한다 (15.2, 게임 시작 뒤에만 생긴다). 퓨처스 이닝은 익숙함(u)과 비상 포수에만 쓰고, 주 포지션 판정과
// 평판 거름은 1군 기록만 센다 (2026-10-23 클사장 결정: 그 규칙들은 1군 KBO 기록으로 정해졌다).

import type { DataStore, DefenseAward, DefenseData } from '../data/types';
import { FIELD_POS, type Defense, type FieldPos } from './defense';
import { Rng } from './rng';

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
  /** 1군 자리별 수비 기록 [실책, 기회(PO + A + E), 도루 허용, 도루 저지] (실책 지표·포수 도루 저지, 12.4 ③. defense.json 해만) */
  rec?: Partial<Record<FieldPos, readonly [number, number, number, number]>>;
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
  /** 화면 주 포지션. 직전 3시즌 타석 DH_MIN_PA 이상에서 수비 없는 타석 몫이 DH_SHARE 이상이거나, 수비 본 자리가 없으면 DH */
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
/** 화면 주 포지션 DH: 직전 3시즌 수비 없는 타석 몫 (12.2 규칙 3, 임시값). 3시즌 타석이 DH_MIN_PA 미만이면 DH로 보지 않는다 (12.4 ②와 같은 하한, 2026-10-23 결정) */
const DH_SHARE = 0.6;
const DH_MIN_PA = 300;
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
 * 3. 직전 3시즌 타석 300 이상이고 수비 없는 타석 몫이 0.6 이상이면 화면 주 포지션은 DH (2의 자리는 수비 본 자리로 남는다).
 * 퓨처스 이닝은 세지 않는다 (1군 기록만, 2026-10-23 결정). opts에서는 등록 포지션(listed)만 쓴다.
 */
export function mainPosition(years: FieldYear[], startYear: number, opts?: FieldOptions): MainPosition {
  const wf = 0;
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
  return { screen: (pa >= DH_MIN_PA && noDefShare >= DH_SHARE) || !field ? 'DH' : field, field, basis, noDefShare };
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
 * 포수 이닝은 익숙함과 같은 합(1군 + W_F × 퓨처스, 15.2)을 본다.
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
 * - 이닝은 1군 기록만 센다 (퓨처스 이닝은 익숙함에만, 2026-10-23 결정).
 */
export function reputationWeight(rep: Reputation, years: FieldYear[], startYear: number): Partial<Record<FieldPos, number>> {
  const [pos, level, from, to] = rep;
  if (from !== null && from >= startYear) return {};
  const wf = 0;
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
  const [F_E, F_PO, F_A, F_SB, F_CS] = ['e', 'po', 'a', 'sb', 'cs'].map((k) => (def ? def.fields.indexOf(k) : -1));
  for (const [ys, d] of Object.entries(def?.players[id] ?? {})) {
    const year = Number(ys);
    if (year >= startYear) continue;
    const inn: Partial<Record<FieldPos, number>> = {};
    const gs: Partial<Record<FieldPos, number>> = {};
    const rec: Partial<Record<FieldPos, readonly [number, number, number, number]>> = {};
    for (const [p, v] of Object.entries(d.p ?? {})) {
      if (!isPos(p)) continue;
      inn[p] = v[outsAt] / 3;
      gs[p] = v[gsAt];
      const e = v[F_E];
      rec[p] = [e, v[F_PO] + v[F_A] + e, v[F_SB], v[F_CS]];
    }
    out.push({ year, inn, gs, pa: d.pa, noDefPa: d.nd, rec });
  }
  for (const year of store.meta.years) {
    if (year >= Math.min(firstRecord, startYear)) continue;
    for (const b of store.season(year)?.bat ?? []) {
      if (b.id === id && b.pa > 0) out.push({ year, proxyPos: b.pos ?? '', pa: b.pa });
    }
  }
  return out.sort((a, b) => a.year - b.year);
}

// ---- 수비 등급 (능력치 v2 16-3, 기획안 13.1~13.3·14.1~14.3·16.1~16.4)
//
// 그 자리 등급 = 20 + (20 + K) × u (20~80). u = 익숙함(familiarity), K = 근거 몫 B + 2 × (나이 + 주력 + 운) − 유사 손해.
// B = 평판 몫(무게 가중 평균) + 2 × (지명타자 몫 + 실책 지표), 수비상은 바닥 (B = max(B, 수상 몫)), −20 ~ +32로 자른다.
// 엔진 수비 런 = (등급 − m) ÷ 2, m = 시작 연도 리그 수비 이닝 가중 평균 등급 (13.6, LeagueEnv.defZero). 저장 칸 def는 등급을
// (등급 − 50) ÷ 2로 담아 화면 등급(defenseGrade)이 v2 등급과 같고, 엔진이 수비 합에서 (m − 50) ÷ 2를 뺀다 (state.ts fieldDefense).

/** 평판 수준 −2~2 → 몫 (결정 26, 14.3: 매우 좋음 70 … 매우 나쁨 30, 몫 = 수준 − 40) */
const repShareOf = (level: number) => 10 * level + 10;
/** 수비상 순위 몫 (13.3): 1위 +30 · 2위 +25 · 3위 +20. 여러 해는 가장 큰 해 + 나머지 합 × ¼, 상한 30 (16.2, ¼은 임시값) */
const AWARD_SHARE: Record<number, number> = { 1: 30, 2: 25, 3: 20 };
const AWARD_STACK = 0.25;
const AWARD_CAP = 30;
/** 근거 몫 B 자름 (13.3 임시값): 등급 20~72 */
const B_MIN = -20;
const B_MAX = 32;
/** 지명타자 몫 (12.4 ②·결정 27, 임시값): 수비 없는 타석 몫 D > 0.3이면 −6 × (D − 0.3) ÷ 0.7런, 3시즌 타석 900 미만이면 줄이고 300 미만이면 없음 */
const DH_FROM = 0.3;
const DH_RUNS = 6;
const DH_FULL_PA = 900;
/** 실책 지표 (12.4 ③·16.3, 임시값): (리그 실책률 × 기회 − 실책) ÷ 이닝 × 1,150 × 0.75런, 무게 이닝 ÷ (이닝 + 2,500), ±3런. 3루 값의 절반을 2B·SS에 */
const ERR_RUNS = 0.75;
const ERR_SHRINK = 2500;
const SEASON_INN = 1150;
const METRIC_CLIP = 3;
const ERR_POS: FieldPos[] = ['3B', 'LF', 'CF', 'RF'];
/** 포수 도루 저지 (12.4 ③·13.3, 임시값): (저지 − 리그 저지율 × 시도) ÷ 이닝 × 1,150 × 0.65런, 무게 이닝 ÷ (이닝 + 2,400), ±3런 */
const CS_RUNS = 0.65;
const CS_SHRINK = 2400;
/** 포수를 다 익히지 않은 선수가 포수 자리에 섰을 때의 도루 저지 바닥 (런, 임시값 = 자름 한도) */
export const CATCHER_ARM_FLOOR = -3;
/** 운 (12.4, 표준편차 약 1런): 세 난수 합 × 2 */
const LUCK_SCALE = 2;

/** 그 해·그 자리 리그 실책률 (E ÷ 기회)과 포수 도루 저지율 (CS ÷ 시도). defense.json 전체에서 한 번 잰다 */
export interface FieldLeague {
  err: Map<string, number>;
  cs: Map<number, number>;
}
const leagueCache = new WeakMap<DefenseData, FieldLeague>();
export function fieldLeague(def: DefenseData): FieldLeague {
  const hit = leagueCache.get(def);
  if (hit) return hit;
  const [E, PO, A, SB, CS] = ['e', 'po', 'a', 'sb', 'cs'].map((k) => def.fields.indexOf(k));
  const e = new Map<string, [number, number]>();
  const cs = new Map<number, [number, number]>();
  for (const years of Object.values(def.players)) {
    for (const [ys, d] of Object.entries(years)) {
      for (const [p, v] of Object.entries(d.p ?? {})) {
        const k = `${ys}/${p}`;
        const t = e.get(k) ?? [0, 0];
        t[0] += v[E];
        t[1] += v[E] + v[PO] + v[A];
        e.set(k, t);
        if (p === 'C') {
          const c = cs.get(Number(ys)) ?? [0, 0];
          c[0] += v[CS];
          c[1] += v[SB] + v[CS];
          cs.set(Number(ys), c);
        }
      }
    }
  }
  const out: FieldLeague = {
    err: new Map([...e].map(([k, [x, n]]) => [k, n > 0 ? x / n : 0])),
    cs: new Map([...cs].map(([k, [x, n]]) => [k, n > 0 ? x / n : 0])),
  };
  leagueCache.set(def, out);
  return out;
}

/** 표본 줄임 무게를 곱한 한 시즌(1,150이닝)당 런, ±3으로 자름 */
const perSeason = (sum: number, inn: number, runs: number, shrink: number) =>
  inn > 0 ? clip((sum / inn) * SEASON_INN * runs * (inn / (inn + shrink)), -METRIC_CLIP, METRIC_CLIP) : 0;

/** 실책 지표 (런, 3루·외야만. 16.3 한 시즌당) */
export function errorMetric(years: FieldYear[], startYear: number, pos: FieldPos, lg: FieldLeague): number {
  let sum = 0;
  let inn = 0;
  for (const y of before(years, startYear)) {
    const r = y.rec?.[pos];
    if (!r) continue;
    sum += (lg.err.get(`${y.year}/${pos}`) ?? 0) * r[1] - r[0];
    inn += y.inn?.[pos] ?? 0;
  }
  return perSeason(sum, inn, ERR_RUNS, ERR_SHRINK);
}

/** 포수 도루 저지 (런, 한 시즌당). 포수 기록이 없으면 0 */
export function catcherArm(years: FieldYear[], startYear: number, lg: FieldLeague): number {
  let sum = 0;
  let inn = 0;
  for (const y of before(years, startYear)) {
    const r = y.rec?.C;
    if (!r) continue;
    sum += r[3] - (lg.cs.get(y.year) ?? 0) * (r[2] + r[3]);
    inn += y.inn?.C ?? 0;
  }
  return perSeason(sum, inn, CS_RUNS, CS_SHRINK);
}

/** 지명타자 몫 (런, 모든 자리에 같게) */
function dhRuns(years: FieldYear[], startYear: number): number {
  let pa = 0;
  let nd = 0;
  for (const y of window3(years, startYear)) {
    pa += y.pa ?? 0;
    nd += y.proxyPos !== undefined ? (y.proxyPos === 'DH' ? y.pa ?? 0 : 0) : y.noDefPa ?? 0;
  }
  if (pa < DH_MIN_PA) return 0;
  const d = nd / pa;
  return d > DH_FROM ? ((-DH_RUNS * (d - DH_FROM)) / (1 - DH_FROM)) * Math.min(1, pa / DH_FULL_PA) : 0;
}

/** 평판 몫 (등급 단위, 16.1 무게 가중 평균): min(1, Σw) × Σ w·s ÷ Σw */
function reputationShare(reps: readonly Reputation[], years: FieldYear[], startYear: number): Partial<Record<FieldPos, number>> {
  const w: Partial<Record<FieldPos, number>> = {};
  const ws: Partial<Record<FieldPos, number>> = {};
  for (const r of reps) {
    for (const [p, x] of Object.entries(reputationWeight(r, years, startYear)) as [FieldPos, number][]) {
      if (!(x > 0)) continue;
      w[p] = (w[p] ?? 0) + x;
      ws[p] = (ws[p] ?? 0) + x * repShareOf(r[1]);
    }
  }
  const out: Partial<Record<FieldPos, number>> = {};
  for (const p of Object.keys(w) as FieldPos[]) out[p] = (Math.min(1, w[p]!) * ws[p]!) / w[p]!;
  return out;
}

/** 수비상 몫 (등급 단위, 16.2): 수상 자리와 그 유사 포지션, 수상 연도 + 3시즌까지 그대로·그 뒤 × 0.7, 여러 해 쌓기 */
function awardShare(awards: readonly DefenseAward[], startYear: number): Partial<Record<FieldPos, number>> {
  const by: Partial<Record<FieldPos, number[]>> = {};
  for (const a of awards) {
    if (a.year >= startYear || !isPos(a.pos)) continue;
    const gap = startYear - a.year;
    const v = (AWARD_SHARE[a.rank] ?? 0) * (gap <= REP_FULL_YEARS ? 1 : RECENT_DECAY ** (gap - REP_FULL_YEARS));
    for (const p of [a.pos, ...(SIMILAR[a.pos] ?? [])]) (by[p] ??= []).push(v);
  }
  const out: Partial<Record<FieldPos, number>> = {};
  for (const [p, vs] of Object.entries(by) as [FieldPos, number[]][]) {
    const top = Math.max(...vs);
    out[p] = Math.min(AWARD_CAP, top + AWARD_STACK * (vs.reduce((a, b) => a + b, 0) - top));
  }
  return out;
}

/** 나이 몫 (런, 12.4 지금 식 그대로): 30세 넘어 해마다 −0.5, 25세 아래 해마다 +0.3 */
const ageRuns = (age: number | null) => (age === null ? 0 : -Math.max(0, age - 30) * 0.5 + Math.max(0, 25 - age) * 0.3);
/** 주력 몫 (런): SS·2B·CF는 (주력 − 0.5) × 5, 그 밖 × 2 */
const speedRuns = (speed: number, p: FieldPos) => (speed - 0.5) * (p === 'SS' || p === '2B' || p === 'CF' ? 5 : 2);
/** 운 (런, 시드 defense/<id>) */
const luckOf = (rng: Rng) => (rng.next() + rng.next() + rng.next() - 1.5) * LUCK_SCALE;

const clip = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

/** 수비 v2 결과. def는 저장·엔진용 (등급 − 50) ÷ 2 */
export interface DefenseV2 {
  def: Defense;
  grade: Record<FieldPos, number>;
  /** 수비 가능 자리 (u = 1). 비상 포수는 여기에 넣지 않고 emergencyC로 */
  playable: FieldPos[];
  /** 익숙함이 다 차지 않은(u < 1) 자리의 재능 T = 20 + K (등급 단위). 결산 때 u가 바뀐 만큼 T × Δu로 등급을 옮긴다 (familiarityShift, 16-4) */
  talent: Partial<Record<FieldPos, number>>;
  emergencyC: boolean;
  main: MainPosition;
  /** 자리별 근거 몫 B (등급 단위, 수비상 바닥·자름 뒤) */
  base: Partial<Record<FieldPos, number>>;
  /** 포수 도루 저지 (런, 한 시즌당). u(C) = 0이면 없음, 다 익지 않았으면 u(C)로 바닥 쪽과 섞는다 (14.2 6) */
  cArm?: number;
  /** 바로 앞 해 자리별 수비 이닝 (영점 m 무게, 2000년 이전은 주 포지션 타석 × 1.94) */
  lastInn: Partial<Record<FieldPos, number>>;
}

export interface DefenseEvidence {
  id: string;
  years: FieldYear[];
  startYear: number;
  reps?: readonly Reputation[];
  awards?: readonly DefenseAward[];
  age: number | null;
  speed: number;
  /** 수비 기록이 없을 때의 본 자리 (자료집·지명 포지션) */
  listed?: FieldPos;
  league?: FieldLeague;
}

/** 등급 → 저장 칸 (등급 − 50) ÷ 2 */
const toDef = (grade: Record<FieldPos, number>): Defense => Object.fromEntries(FIELD_POS.map((p) => [p, round1((grade[p] - 50) / 2)]));

/** 실존 선수 수비 v2 (기록·평판·수상으로). 기록이 하나도 없으면 등록 포지션을 본 자리로, 근거는 있는 것만 (16.4 라) */
export function defenseV2(ev: DefenseEvidence): DefenseV2 {
  const { years, startYear } = ev;
  const opts: FieldOptions = { listed: ev.listed };
  const main = mainPosition(years, startYear, opts);
  const rep = reputationShare(ev.reps ?? [], years, startYear);
  const award = awardShare(ev.awards ?? [], startYear);
  const dh = dhRuns(years, startYear);
  const err: Partial<Record<FieldPos, number>> = {};
  if (ev.league) {
    for (const p of ERR_POS) err[p] = errorMetric(years, startYear, p, ev.league);
    err['2B'] = err.SS = (err['3B'] ?? 0) / 2;
  }
  const luck = luckOf(new Rng(`defense/${ev.id}`));
  const grade = {} as Record<FieldPos, number>;
  const base: Partial<Record<FieldPos, number>> = {};
  const playableList: FieldPos[] = [];
  const talent: Partial<Record<FieldPos, number>> = {};
  let uC = 0;
  for (const p of FIELD_POS) {
    const u = familiarity(years, startYear, p, main, opts);
    if (p === 'C') uC = u;
    let b = (rep[p] ?? 0) + 2 * (dh + (err[p] ?? 0));
    if (award[p] !== undefined) b = Math.max(b, award[p]!);
    b = clip(b, B_MIN, B_MAX);
    base[p] = round1(b);
    const k = b + 2 * (ageRuns(ev.age) + speedRuns(ev.speed, p) + luck) - similarLoss(years, startYear, p, main, opts);
    grade[p] = clip(round1(20 + (20 + k) * u), 20, 80);
    if (u >= 1) playableList.push(p);
    else talent[p] = round1(20 + k);
  }
  const emergencyC = emergencyCatcher(years, startYear, main, opts);
  const out: DefenseV2 = { def: toDef(grade), grade, playable: playableList, talent, emergencyC, main, base, lastInn: {} };
  if (ev.league && uC > 0) out.cArm = round1(uC * catcherArm(years, startYear, ev.league) + (1 - uC) * CATCHER_ARM_FLOOR);
  for (const y of years) {
    if (y.year !== startYear - 1) continue;
    for (const p of FIELD_POS) {
      const x = yearInn(y, p, 0);
      if (x > 0) out.lastInn[p] = (out.lastInn[p] ?? 0) + x;
    }
  }
  return out;
}

/**
 * 게임 안 시즌 이력 한 줄 → FieldYear (능력치 v2 16-3b, 15.2). inn: 1군 자리별 이닝(SeasonLine.def), fut: 퓨처스 이닝(SeasonLine.fdef).
 * 지명타자 판정(12.2)의 수비 없는 타석은 기록이 없어 타석 − 1군 수비 이닝 ÷ 1.94(타석당 수비 이닝)로 어림한다
 */
export function gameFieldYear(year: number, inn: readonly number[] | undefined, fut: readonly number[] | undefined, pa: number): FieldYear {
  const toPos = (xs: readonly number[] | undefined) => {
    const o: Partial<Record<FieldPos, number>> = {};
    FIELD_POS.forEach((p, k) => { if (xs?.[k]) o[p] = xs[k]; });
    return o;
  };
  const total = (inn ?? []).reduce((a, b) => a + b, 0);
  return { year, inn: toPos(inn), ...(fut ? { fut: toPos(fut) } : {}), pa, noDefPa: Math.max(0, Math.round(pa - total / PA_TO_INN)) };
}

/**
 * 결산 때 등급 오름·내림 (능력치 v2 16-4, 13.1): 등급 = 20 + T × u라, 익숙함 u가 바뀐 자리는 재능 T × Δu만큼 등급을 옮긴다.
 * years = 시작 전 수비 기록 + 게임 안 이력 (막 끝난 시즌 year까지), Δu = u(year + 1 기준) − u(year 기준).
 * talent에 있는 자리(시작 때 u < 1)만 옮기고, 본 자리 등 다 찬 자리와 나이 몫(ageDefense)은 그대로. 최근성으로 u가 줄면 내려간다. 등급은 20~80
 */
export function familiarityShift(years: FieldYear[], year: number, listed: FieldPos | undefined, talent: Partial<Record<FieldPos, number>>, def: Defense,
                                 trainBefore?: Partial<Record<FieldPos, number>>, trainAfter?: Partial<Record<FieldPos, number>>): Defense {
  // train: 수비 자리 훈련 익힘 m (16-4c, league/training.ts). 이번 결산 전·후
  const opts: FieldOptions = { listed, ...(trainBefore ? { train: trainBefore } : {}) };
  const optsAfter: FieldOptions = { listed, ...(trainAfter ? { train: trainAfter } : {}) };
  const mainBefore = mainPosition(years, year, opts);
  const mainAfter = mainPosition(years, year + 1, optsAfter);
  let out: Defense | null = null;
  for (const [p, t] of Object.entries(talent) as [FieldPos, number][]) {
    if (def[p] === undefined) continue;
    const du = familiarity(years, year + 1, p, mainAfter, optsAfter) - familiarity(years, year, p, mainBefore, opts);
    if (Math.abs(du) < 1e-9) continue;
    const grade = clip(50 + 2 * def[p]! + t * du, 20, 80);
    (out ??= { ...def })[p] = round1((grade - 50) / 2);
  }
  return out ?? def;
}

/**
 * 결산 때 수비 가능 자리와 비상 포수만 다시 본다 (16-3b, 클사장 결정: 등급 오름은 16-4). years = 시작 전 수비 기록 + 게임 안 이력,
 * startYear = 다음 시즌. 판정은 시작 때와 같은 식 (mainPosition·familiarity·emergencyCatcher)
 */
export function refreshPlayable(years: FieldYear[], startYear: number, listed?: FieldPos, train?: Partial<Record<FieldPos, number>>): { playable: FieldPos[]; emergencyC: boolean } {
  const opts: FieldOptions = { listed, ...(train ? { train } : {}) };
  const main = mainPosition(years, startYear, opts);
  return { playable: playable(years, startYear, main, opts), emergencyC: emergencyCatcher(years, startYear, main, opts) };
}

/** 등록 포지션 표기 → v2 본 자리. 묶음은 넓은 쪽 (16.4 나: IF → SS, OF → CF), DH·투수·모름은 없음 */
export function homeOf(pos: string | null | undefined): FieldPos | null {
  if (isPos(pos)) return pos;
  if (pos === 'IF') return 'SS';
  if (pos === 'OF') return 'CF';
  return null;
}

/**
 * 기록 없는 가상 선수의 수비 v2 (16.4 가·나: 가상 신인·창단 가상 선수·생성 외국인·자유 모드 선수).
 * 본 자리와 그 유사 포지션만 수비 가능 (이닝 0이라 유사 손해 전부), 나머지 20. 근거 몫 B는 그 시작 연도 실존 주전의 B 분포
 * (pool, 오름차순)에서 분위로 뽑는다 (시드 defense/<id>, 결정 22와 같은 방법). 나이·주력 몫은 이 선수 값으로. pool이 없으면 B = 0 (40 근처)
 */
export function virtualDefense(id: string, pos: string | null, speed: number, age: number | null, pool?: readonly number[]): Pick<DefenseV2, 'def' | 'grade' | 'playable' | 'talent'> {
  const home = homeOf(pos);
  const rng = new Rng(`defense/${id}`);
  const q = rng.next();
  const b = pool && pool.length ? pool[Math.min(pool.length - 1, Math.floor(q * pool.length))] : 0;
  const luck = luckOf(rng);
  const grade = {} as Record<FieldPos, number>;
  const playableList: FieldPos[] = [];
  const talent: Partial<Record<FieldPos, number>> = {};
  for (const p of FIELD_POS) {
    if (!home || (p !== home && !SIMILAR[home]?.includes(p))) {
      grade[p] = 20;
      // 해 보지 않은 자리의 재능 (실존 선수 defenseV2와 같은 K, 결산 때 익숙함이 늘면 오른다)
      talent[p] = round1(40 + b + 2 * (ageRuns(age) + speedRuns(speed, p) + luck));
      continue;
    }
    const loss = p === home ? 0 : 2 * moveLoss(home, p);
    grade[p] = clip(round1(40 + b + 2 * (ageRuns(age) + speedRuns(speed, p) + luck) - loss), 20, 80);
    playableList.push(p);
  }
  return { def: toDef(grade), grade, playable: playableList, talent };
}
