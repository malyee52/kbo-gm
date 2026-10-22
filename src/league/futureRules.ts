// 2028년 이후 미래의 규칙 변경 ② "리그 흐름에 따라 바뀜" (리그 규칙 변경 기획안 4장, 1차 묶음 1-8).
// 결산(beginOffseason) 때 그 시즌의 신호를 남기고, 같은 쪽으로 2시즌 이어서 벗어난 항목 중 하나를 다음 시즌에 바꾼다.
// 바뀐 기록(league.ruleShifts)은 리그 상태 선택 항목이라 예전 저장도 열린다 (없으면 빈 목록).
// 게임이 만든 가상 결정이다. 실제 KBO 결정이 아니며, 항목과 폭은 KBO 연표에 실제로 있었던 종류 안에서 정했다.
// 기본 모드만 (판타지·자유 모드는 league.rules로 규정을 바꾸는 장치가 따로 있어 끈다). 값은 모두 임시값.

import { Rng } from '../engine';
import type { LeagueState } from './types';

/** 미래 규칙 변경이 시작되는 시즌 (임시값). 2027년은 발표된 제도(캡 값·하한)로 간다 */
export const FUTURE_RULES_FROM = 2028;
/** 같은 쪽으로 이만큼 시즌 이어서 벗어나면 후보 (임시값) */
export const SHIFT_STREAK = 2;
/** 바뀐 항목은 이만큼 시즌 동안 다시 후보가 되지 않는다 (임시값) */
export const SHIFT_COOLDOWN = 3;

export type FutureRuleKey = 'ball' | 'zone' | 'extra' | 'roster' | 'foreign' | 'capGrowth';

export const FUTURE_RULE_LABEL: Record<FutureRuleKey, string> = {
  ball: '공인구 반발계수 기준', zone: '스트라이크존', extra: '정규시즌 연장 이닝', roster: '1군 엔트리', foreign: '외국인 보유 한도 (아시아쿼터 제외)', capGrowth: '샐러리캡 연간 상향률',
};

/**
 * 항목별 기준값(2026 제도), 한 번에 바꾸는 폭, 누적 범위 (모두 임시값, 기획안 4.3).
 * ball = 홈런 목표 배율, zone = 삼진 목표 배율 (볼넷은 zoneBb), extra = 최대 이닝, roster = 1군 등록 인원,
 * foreign = 정규 외국인 수, capGrowth = 2029년 이후 캡 연간 상향률
 */
export const FUTURE_RULE_SPEC: Record<FutureRuleKey, { base: number; step: number; min: number; max: number }> = {
  ball: { base: 1, step: 0.06, min: 0.75, max: 1.25 },
  zone: { base: 1, step: 0.03, min: 0.91, max: 1.09 },
  extra: { base: 11, step: 1, min: 10, max: 15 },
  roster: { base: 29, step: 1, min: 28, max: 32 },
  foreign: { base: 3, step: 1, min: 2, max: 4 },
  capGrowth: { base: 0.05, step: 0.02, min: 0.03, max: 0.09 },
};

/** 2루타 목표 배율: 홈런 배율 변화의 1/3 (홈런 ×0.94 → 2루타 ×0.98, 임시값) */
export function ballD2(hr: number): number {
  return 1 + (hr - 1) / 3;
}
/** 볼넷 목표 배율: 삼진 배율 변화의 -5/3 (존 축소 = 삼진 ×0.97·볼넷 ×1.05, 임시값). 삼진 범위 0.91~1.09 → 볼넷 0.85~1.15 */
export function zoneBb(so: number): number {
  return 1 + ((1 - so) * 5) / 3;
}

/** 판정 기준 (임시값, 기획안 4.3) */
export const SHIFT_LIMITS = {
  /** 장타 압력이 이보다 크면 반발계수를 낮추고, 1/이 값보다 작으면 높인다 */
  pressureHigh: 1.1,
  pressureLow: 0.9,
  /** 무승부 비율: 넘으면 연장 +1회, 밑돌면 -1회 */
  drawHigh: 0.04,
  drawLow: 0.01,
  /** 구단당 결장 선수-일: 기준 해(첫 신호 해)보다 이 비율 넘게 많으면 엔트리 +1, 적으면 -1 */
  absence: 0.2,
  /** 국내 선수층 지표: 기준 해보다 이 비율 넘게 낮으면 외국인 +1, 높으면 -1 */
  depth: 0.08,
  /** 캡 초과 구단이 2시즌 평균 이만큼 이상이면 상향률 +2%p */
  capOverTeams: 3,
  /**
   * 초과 구단 0이고 평균 사용률이 이보다 낮으면 -2%p. 2026-10-22 0.6 → 0.5 (임시값): 연봉이 캡을 따라 오르게 한 뒤(salary.ts wageIndex)
   * longsim 2026 시작 20시즌 × a,b의 구단 평균 사용률이 52~71%(2027~2029년 52~60%)라, 0.6이면 평소 흐름만으로 2028~2029년에 상향률이 3%로 내려갔다.
   * 0.5는 2027년 하한(캡의 약 40%)과 평소 범위 사이: 구단 대부분이 하한 근처로 내려앉았을 때만 내린다
   */
  capUseLow: 0.5,
};

/** 결산 때 남기는 그 시즌의 신호 */
export interface RuleSignal {
  year: number;
  /**
   * 선수층 압력 = 그 시즌 환경 맞춤 계수의 역수 (1보다 크면 선수들이 목표보다 그 사건을 더 낸다).
   * 기획안 4.2는 "× 그 해 목표 배율"이었지만, 재 보니 목표 배율을 0.94·1.12로 바꿔도 계수가 그대로였다
   * (계수는 목표 대비 비율이라 목표가 이미 들어 있다, 2026-10-22 2027 시즌 두 시드). 배율을 곱하면 신호가 배율을 따라 움직이므로 곱하지 않는다
   */
  hr: number;
  so: number;
  bb: number;
  /** 무승부 비율 */
  draw: number;
  /** 구단당 부상·이탈 결장 선수-일 */
  absence: number;
  /** 국내 선수층 지표: 국내 선수 상위 270명 기여 합 (런) */
  depth: number;
  /** 캡 초과 구단 수와 평균 사용률 (캡이 없으면 0) */
  capOver: number;
  capUse: number;
}

export interface RuleShift {
  /** 새 값이 적용되는 시즌 */
  year: number;
  key: FutureRuleKey;
  before: number;
  after: number;
  /** 화면·소식 문구 (게임 속 가상 결정임을 밝힌다) */
  reason: string;
  /** 판단에 쓴 신호 값 */
  signal: number;
}

/** 미래 규칙 변경을 쓰는 리그인가: 기본 모드만 (판타지·자유 모드는 끈다) */
export function futureRulesOn(league: Pick<LeagueState, 'fantasy'>): boolean {
  return !league.fantasy;
}

/** 그 해(year) 항목 값: 기준값에 year 이하 변경을 차례로 */
export function futureValue(league: Pick<LeagueState, 'ruleShifts'> | null | undefined, key: FutureRuleKey, year: number): number {
  let v = FUTURE_RULE_SPEC[key].base;
  for (const s of league?.ruleShifts ?? []) if (s.key === key && s.year <= year) v = s.after;
  return v;
}

/** 그 해 항목 값과 기준값(2026 제도)의 차이. 자료 값(meta.rules)에 더해 쓴다 */
export function futureDelta(league: Pick<LeagueState, 'ruleShifts'> | null | undefined, key: FutureRuleKey, year: number): number {
  return round(futureValue(league, key, year) - FUTURE_RULE_SPEC[key].base);
}

/** 그 해 바뀐 항목 (알림용) */
export function shiftsFor(league: Pick<LeagueState, 'ruleShifts'> | null | undefined, year: number): RuleShift[] {
  return (league?.ruleShifts ?? []).filter((s) => s.year === year);
}

const pct = (x: number) => `${Math.round(Math.abs(x - 1) * 100)}%`;
const round = (x: number) => Math.round(x * 1000) / 1000;

interface Candidate { key: FutureRuleKey; dir: 1 | -1; signal: number; why: string }

/** 두 시즌 연속 같은 쪽으로 벗어났나: side(s)가 1(위)·-1(아래)·0 */
function streak(signals: RuleSignal[], side: (s: RuleSignal) => number): 1 | -1 | 0 {
  if (signals.length < SHIFT_STREAK) return 0;
  const last = signals.slice(-SHIFT_STREAK).map(side);
  return last.every((x) => x === 1) ? 1 : last.every((x) => x === -1) ? -1 : 0;
}

/**
 * 결산 때 한 번: 그 시즌(signal.year)의 신호를 남기고 다음 시즌 규칙 변경을 정한다 (한 해 최대 1개).
 * 난수는 후보가 여럿일 때만 `${seed}/rules/${다음 해}` 갈래에서 하나 쓴다 (다른 진행의 난수를 건드리지 않는다).
 * 돌려주는 값은 새로 생긴 변경 (없으면 null)
 */
export function judgeFutureRules(league: LeagueState, signal: RuleSignal): RuleShift | null {
  if (!futureRulesOn(league)) return null;
  const next = signal.year + 1;
  // 신호는 자료 없는 해의 환경(2022~2026 평균 목표)으로 돈 2027 시즌부터 남긴다. 기준 해 = 처음 남긴 신호
  if (signal.year < FUTURE_RULES_FROM - 1) return null;
  league.ruleSignals ??= [];
  league.ruleSignals = league.ruleSignals.filter((s) => s.year !== signal.year);
  league.ruleSignals.push(signal);
  const sig = league.ruleSignals;
  const base = sig[0];
  const recent = sig.slice(-SHIFT_STREAK);
  const L = SHIFT_LIMITS;
  const cands: Candidate[] = [];
  const add = (key: FutureRuleKey, dir: 1 | -1 | 0, signalValue: number, why: string) => {
    if (dir === 0) return;
    const spec = FUTURE_RULE_SPEC[key];
    const cur = futureValue(league, key, signal.year);
    const after = round(cur + dir * spec.step);
    if (after < spec.min - 1e-9 || after > spec.max + 1e-9) return;
    const last = (league.ruleShifts ?? []).filter((s) => s.key === key).at(-1);
    if (last && next - last.year < SHIFT_COOLDOWN + 1) return;
    cands.push({ key, dir, signal: round(signalValue), why });
  };
  const avg = (f: (s: RuleSignal) => number) => recent.reduce((a, s) => a + f(s), 0) / recent.length;
  // 공인구: 장타 압력이 높으면 반발계수를 낮춰 홈런 목표를 줄인다
  const hrP = avg((s) => s.hr);
  add('ball', streak(sig, (s) => (s.hr > L.pressureHigh ? -1 : s.hr < L.pressureLow ? 1 : 0)), hrP,
    hrP > 1 ? `선수들의 장타력이 리그 기준보다 ${pct(hrP)} 높아 반발계수 기준을 낮춘다` : `선수들의 장타력이 리그 기준보다 ${pct(hrP)} 낮아 반발계수 기준을 높인다`);
  // 존: 삼진 압력이 높거나 볼넷 압력이 낮으면 존을 줄인다 (삼진 목표 ↓)
  const zoneSide = (s: RuleSignal) => (s.so > L.pressureHigh || s.bb < L.pressureLow ? -1 : s.so < L.pressureLow || s.bb > L.pressureHigh ? 1 : 0);
  const soP = avg((s) => s.so);
  add('zone', streak(sig, zoneSide), soP,
    zoneSide(signal) < 0 ? `투수들의 삼진 능력이 리그 기준보다 ${pct(soP)} ${soP >= 1 ? '높아' : '낮아'} 스트라이크존을 줄인다` : `타자들의 선구가 리그 기준보다 강해 스트라이크존을 넓힌다`);
  const draw = avg((s) => s.draw);
  add('extra', streak(sig, (s) => (s.draw > L.drawHigh ? 1 : s.draw < L.drawLow ? -1 : 0)), draw,
    draw > L.drawHigh ? `무승부가 ${(draw * 100).toFixed(1)}%로 많아 연장을 1회 늘린다` : `무승부가 ${(draw * 100).toFixed(1)}%로 적어 선수 보호를 위해 연장을 1회 줄인다`);
  const ab = base.absence > 0 ? avg((s) => s.absence) / base.absence : 1;
  add('roster', streak(sig, (s) => (base.absence <= 0 ? 0 : s.absence / base.absence > 1 + L.absence ? 1 : s.absence / base.absence < 1 - L.absence ? -1 : 0)), ab,
    ab > 1 ? `부상·이탈 결장이 ${base.year}년보다 ${pct(ab)} 늘어 선수 보호를 위해 1군 엔트리를 1명 늘린다` : `결장이 ${base.year}년보다 ${pct(ab)} 줄어 1군 엔트리를 1명 줄인다`);
  const dp = base.depth > 0 ? avg((s) => s.depth) / base.depth : 1;
  add('foreign', streak(sig, (s) => (base.depth <= 0 ? 0 : s.depth / base.depth < 1 - L.depth ? 1 : s.depth / base.depth > 1 + L.depth ? -1 : 0)), dp,
    dp < 1 ? `국내 선수층이 ${base.year}년보다 ${pct(dp)} 얇아져 외국인 보유 한도를 1명 늘린다` : `국내 선수층이 ${base.year}년보다 ${pct(dp)} 두꺼워져 외국인 보유 한도를 1명 줄인다`);
  const over = avg((s) => s.capOver);
  const use = avg((s) => s.capUse);
  const capDir: 1 | -1 | 0 = recent.length < SHIFT_STREAK || recent.some((s) => s.capUse <= 0) ? 0
    : over >= L.capOverTeams ? 1 : recent.every((s) => s.capOver === 0) && use < L.capUseLow ? -1 : 0;
  add('capGrowth', capDir, capDir > 0 ? over : use,
    capDir > 0 ? `샐러리캡 초과 구단이 2시즌 평균 ${over.toFixed(1)}곳이라 캡 상향률을 2%p 올린다` : `구단 평균 캡 사용률이 ${Math.round(use * 100)}%로 낮아 캡 상향률을 2%p 내린다`);
  if (!cands.length) return null;
  const pick = cands.length === 1 ? cands[0] : cands[new Rng(`${league.seed}/rules/${next}`).int(cands.length)];
  const spec = FUTURE_RULE_SPEC[pick.key];
  const before = futureValue(league, pick.key, signal.year);
  const shift: RuleShift = { year: next, key: pick.key, before, after: round(before + pick.dir * spec.step), reason: `${pick.why} (게임 속 가상 결정)`, signal: pick.signal };
  league.ruleShifts ??= [];
  league.ruleShifts.push(shift);
  return shift;
}

/** 값 문구 (알림 전·후) */
export function futureValueText(key: FutureRuleKey, v: number): string {
  switch (key) {
    case 'ball': return `홈런 기준 ×${v.toFixed(2)}`;
    case 'zone': return `삼진 기준 ×${v.toFixed(2)} · 볼넷 ×${zoneBb(v).toFixed(2)}`;
    case 'extra': return `${v}회`;
    case 'roster': return `${v}명`;
    case 'foreign': return `${v}명`;
    case 'capGrowth': return `연 ${Math.round(v * 100)}%`;
  }
}
