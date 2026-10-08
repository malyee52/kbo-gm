// 부상과 이탈 이벤트 (M6, 기획서 6.4·7장).
//
// - 부상: 경기가 있는 날마다 선수별로 발생을 뽑는다. 야수는 나이, 투수는 이닝 페이스(혹사)가 확률을 올린다.
//   정도는 경미·장기·큰 부상 세 가지. 큰 부상이 시즌 끝을 넘기면 시즌 아웃이고, 남은 기간은 다음 시즌으로 넘어간다.
// - 이탈 이벤트: 부상과 별개의 난수 줄기에서 뽑는다.
//   실존 선수(real이 false가 아닌 선수)에게는 사유를 특정하지 않는 중립 이벤트만 붙는다. 구체적 사건은 가상 선수에게만.
//   이 규칙은 pickEvent와 eventLabel 두 곳에서 지킨다 (자동 검사: tests/multiyear.test.ts).

import type { Rng } from './rng';
import type { PitLine, SimPlayer } from './types';

export type AbsenceKind = 'minor' | 'long' | 'major' | 'event';

/** 시즌 중 결장 한 건 */
export interface Absence {
  /** 발생한 날 (일정 색인) */
  day: number;
  /** 선수 색인 */
  idx: number;
  /** 이 날짜 전까지 결장. 시즌 일정 길이보다 크면 시즌 아웃 */
  until: number;
  kind: AbsenceKind;
  /** 이탈 이벤트 종류 (kind가 event일 때) */
  event?: EventCode;
}

export interface InjuryParams {
  /** 기준 발생 확률 (경기일·선수당). 바꾸기 전 무작위 결장과 결장 비율이 같도록 맞춘 값 */
  base: number;
  /** 정도별 비율과 기간 [최소, 최대] 일 (임시값) */
  minor: { share: number; days: [number, number] };
  long: { share: number; days: [number, number] };
  major: { share: number; days: [number, number] };
  /** 이탈 이벤트 확률 (경기일·선수당, 임시값) */
  eventChance: number;
  /** 가상 선수의 이탈 이벤트 중 구체적 사건의 비율 (임시값) */
  specificShare: number;
  /** 오프시즌 동안 회복되는 일수. 이보다 긴 남은 기간은 다음 시즌 개막부터 결장 (임시값) */
  offseasonDays: number;
}

/** 야수의 나이 배율: 29세 1, 한 살마다 5%씩. 0.75~1.6 (임시값) */
export function hitterAgeFactor(age: number | null): number {
  if (age === null) return 1;
  return Math.min(1.6, Math.max(0.75, 1 + 0.05 * (age - 29)));
}

/**
 * 투수의 혹사 배율: 지금까지의 이닝을 시즌 전체로 늘린 페이스가 기준(선발 160, 구원 75이닝)을 넘는 만큼 오른다.
 * 나이도 조금 반영한다 (한 살마다 2%, 0.85~1.3). 모두 임시값.
 */
export function pitcherLoadFactor(p: SimPlayer, line: PitLine, day: number, seasonDays: number): number {
  const starter = (p.pit?.startShare ?? 0) >= 0.5;
  const pace = (line.outs / 3) * (seasonDays / (day + 15));
  const over = starter ? Math.max(0, pace - 160) / 80 : Math.max(0, pace - 75) / 40;
  const age = p.age === null ? 1 : Math.min(1.3, Math.max(0.85, 1 + 0.02 * (p.age - 29)));
  return (1 + over) * age;
}

export function injuryChance(p: SimPlayer, line: PitLine, day: number, seasonDays: number, ip: InjuryParams): number {
  return ip.base * (p.isPitcher ? pitcherLoadFactor(p, line, day, seasonDays) : hitterAgeFactor(p.age));
}

/** 부상 정도와 기간을 뽑는다. 발생이 정해진 뒤에만 부르므로 평소의 난수 소비는 하루·선수당 한 번이다 */
export function drawInjury(rng: Rng, ip: InjuryParams): { kind: Exclude<AbsenceKind, 'event'>; days: number } {
  const u = rng.next();
  const pick = u < ip.minor.share ? 'minor' : u < ip.minor.share + ip.long.share ? 'long' : 'major';
  const [lo, hi] = ip[pick].days;
  return { kind: pick, days: lo + rng.int(hi - lo + 1) };
}

// ---- 이탈 이벤트

/** 사유를 특정하지 않는 중립 이벤트 (실존 선수에게도 붙을 수 있다) */
export const NEUTRAL_EVENTS = {
  personal: { label: '개인 사정으로 이탈', days: [3, 15] },
  conflict: { label: '구단 내 갈등으로 이탈', days: [7, 30] },
  suspension: { label: '징계성 출전 정지', days: [5, 20] },
} as const;

/** 구체적 사건 (가상 선수에게만). 실제 있었던 사건을 특정 선수에게 재현하지 않는다 */
export const SPECIFIC_EVENTS = {
  drunkDriving: { label: '음주 운전 적발로 출전 정지', days: [40, 90] },
  gambling: { label: '불법 도박 연루로 출전 정지', days: [60, 120] },
  brawl: { label: '술자리 폭행 시비로 출전 정지', days: [20, 50] },
  sns: { label: 'SNS 부적절 발언으로 자숙', days: [5, 15] },
  curfew: { label: '원정 숙소 무단 외출로 2군행', days: [10, 25] },
} as const;

export type NeutralEvent = keyof typeof NEUTRAL_EVENTS;
export type SpecificEvent = keyof typeof SPECIFIC_EVENTS;
export type EventCode = NeutralEvent | SpecificEvent;

const NEUTRAL_CODES = Object.keys(NEUTRAL_EVENTS) as NeutralEvent[];
const SPECIFIC_CODES = Object.keys(SPECIFIC_EVENTS) as SpecificEvent[];

export function isSpecificEvent(code: EventCode): code is SpecificEvent {
  return code in SPECIFIC_EVENTS;
}

/** 가상 선수인가. real 값이 없으면 실존 선수로 본다 (안전한 쪽) */
export function isVirtual(p: Pick<SimPlayer, 'real'>): boolean {
  return p.real === false;
}

/** 이벤트 종류와 기간을 뽑는다. 구체적 사건은 가상 선수에게만 */
export function pickEvent(p: Pick<SimPlayer, 'real'>, rng: Rng, ip: InjuryParams): { event: EventCode; days: number } {
  const specific = isVirtual(p) && rng.chance(ip.specificShare);
  const codes: EventCode[] = specific ? SPECIFIC_CODES : NEUTRAL_CODES;
  const event = codes[rng.int(codes.length)];
  const [lo, hi] = (specific ? SPECIFIC_EVENTS[event as SpecificEvent] : NEUTRAL_EVENTS[event as NeutralEvent]).days;
  return { event, days: lo + rng.int(hi - lo + 1) };
}

/** 화면에 보일 이벤트 문구. 실존 선수에게 구체적 사건 문구를 만들려 하면 오류를 낸다 (마지막 방어선) */
export function eventLabel(code: EventCode, p: Pick<SimPlayer, 'real'>): string {
  if (isSpecificEvent(code)) {
    if (!isVirtual(p)) throw new Error('실존 선수에게 구체적 사건을 붙일 수 없습니다 (기획서 7장)');
    return SPECIFIC_EVENTS[code].label;
  }
  return NEUTRAL_EVENTS[code].label;
}

/** 가상 선수에게 쓰는 결장 문구 (부상 정도까지) */
export const ABSENCE_KIND_LABEL: Record<AbsenceKind, string> = {
  minor: '경미한 부상', long: '장기 부상', major: '큰 부상', event: '이탈',
};
/** 실존 선수에게 쓰는 결장 문구: 사유 없이 기간만 (M3부터의 규칙. 알림에 실존 선수의 결장 사유를 적지 않는다) */
const NEUTRAL_KIND_LABEL: Record<Exclude<AbsenceKind, 'event'>, string> = {
  minor: '단기 결장', long: '장기 결장', major: '장기 결장',
};

/**
 * 결장 문구. 실존 선수(real이 false가 아닌 선수)에게는 부상 여부·부위 같은 사유를 적지 않고 기간 구분만,
 * 이탈 이벤트는 중립 문구만 쓴다. 가상 선수에게는 부상 정도와 구체적 사건까지 쓴다.
 */
export function absenceLabel(a: Pick<Absence, 'kind' | 'event'>, p: Pick<SimPlayer, 'real'>, seasonOut = false): string {
  if (a.kind === 'event' && a.event) return eventLabel(a.event, p);
  const base = isVirtual(p) ? ABSENCE_KIND_LABEL[a.kind] : NEUTRAL_KIND_LABEL[a.kind as Exclude<AbsenceKind, 'event'>];
  return seasonOut && a.kind !== 'minor' ? `${base} (시즌 아웃)` : base;
}
