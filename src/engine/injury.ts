// 부상과 이탈 이벤트 (M6, 기획서 6.4·7장. 경기 중 부상·부위·혹사는 엔진 2 11단계).
//
// - 경기 전 부상: 경기가 있는 날마다 선수별로 발생을 뽑는다. 야수는 나이, 투수는 이닝 페이스와 혹사지수가 확률을 올린다.
//   1군 선수는 경기 중 부상(game.ts)이 몫을 나눠 맡아 경기 전 확률이 inGame.preShare배다.
// - 경기 중 부상: 투구(던진 공), 주루(타격 뒤 달린 타석), 수비(맡은 인플레이 타구)에 붙어 그 경기 난수에서 뽑고, 그 자리에서 교체된다.
// - 정도는 경미·장기·큰 부상 세 가지, 부위는 투수·야수와 사건별 분포에서 뽑는다 (임시값). 큰 부상이 시즌 끝을 넘기면 시즌 아웃이고,
//   남은 기간은 다음 시즌으로 넘어간다.
// - 혹사지수 (기획안 4.6): 실제 한계 투구 수를 넘긴 공·연투·짧은 휴식으로 쌓이고, 등판하지 않은 날이 이어질수록 크게 빠진다.
//   높으면 투구 피로 회복이 느려지고 부상 확률이 오른다. 혹사로 더해진 몫에서 생긴 부상은 overuse로 따로 표시한다.
// - 부상 문구는 실존·가상 선수가 같은 규칙이다 (부위·정도, 2026-10-22 사용자 결정).
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
  /** 부상 부위 (엔진 2 11단계. 예전 저장의 부상에는 없다) */
  part?: InjuryPart;
  /** 경기 중 부상: 투구·주루·수비 (없으면 경기 전 부상) */
  cause?: InjuryCause;
  /** 혹사로 생긴 부상 (혹사지수로 더해진 몫, 실제 한계를 넘긴 공). 결장 비율 기준에서 뺀다 */
  overuse?: true;
}

export type InjuryCause = 'pitch' | 'run' | 'field';

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
  /** 경기 중 부상 (엔진 2 11단계, 임시값) */
  inGame: {
    /** 1군 선수(그날 1군 엔트리)의 경기 전 부상 확률 배율. 나머지 몫은 경기 중 사건이 맡는다. 2군 선수는 1 */
    preShare: number;
    /** 투수: 던진 공 하나당 */
    perPitch: number;
    /** 타자: 타격 뒤 1루로 달린 타석(인플레이·안타) 하나당 */
    perRun: number;
    /** 수비수: 맡은 인플레이 타구 하나당 */
    perField: number;
  };
  /** 혹사지수 (기획안 4.6, 임시값) */
  overuse: OveruseParams;
}

export interface OveruseParams {
  /** false면 혹사지수가 쌓이지 않고 실제 한계를 넘긴 공의 부상도 없다 */
  on: boolean;
  /** 실제 한계 투구 수 = 한계 투구 수(그날 몸 상태 뺀 값) × [1 − realSpread, 1 + realSpread] (리그 시드·선수 ID 해시) */
  realSpread: number;
  /** 실제 한계를 넘긴 공 하나당 쌓이는 혹사지수 */
  overPitch: number;
  /** 연투(전날도 던짐), 3연투 이상 한 번에 쌓이는 값 */
  b2b: number;
  b3b: number;
  /** 선발이 정해진 휴식일보다 하루 일찍 나올 때마다 */
  shortRest: number;
  /** 등판하지 않고 n일 지나면 exp(−(decay1·n + decay2·n²))만 남는다 (오래 쉴수록 하루 감소량이 커진다) */
  decay1: number;
  decay2: number;
  /** 오프시즌을 넘기며 남는 몫 */
  offseason: number;
  /** 투구 피로 하루 회복량 배율 = 1 ÷ (1 + recovery × 혹사지수) */
  recovery: number;
  /** 부상 확률(경기 전·경기 중 투구) 배율 = 1 + injury × 혹사지수. 더해진 몫에서 생긴 부상이 혹사 부상 */
  injury: number;
  /** 실제 한계를 넘긴 공 하나당 경기 중 부상 확률 (혹사 부상) */
  overInjury: number;
}

/** 혹사지수가 등판 없이 n일 지난 뒤 남는 몫 */
export function overuseDecay(n: number, o: OveruseParams): number {
  return n <= 0 ? 1 : Math.exp(-(o.decay1 * n + o.decay2 * n * n));
}

/** 숨은 능력 '부상 경향' 자리 (엔진 2 16단계에서 값이 붙는다. 지금은 모두 1.00) */
export function injuryProneness(p: Pick<SimPlayer, 'injuryProne'>): number {
  return p.injuryProne ?? 1;
}

/** 야수의 나이 배율: 29세 1, 한 살마다 5%씩. 0.75~1.6 (임시값) */
export function hitterAgeFactor(age: number | null): number {
  if (age === null) return 1;
  return Math.min(1.6, Math.max(0.75, 1 + 0.05 * (age - 29)));
}

/** 페이스 계산의 시즌 초 완충 (경기 수). 예전 달력 기준 15일 ≈ 13경기 (임시값) */
const PACE_RAMP_GAMES = 13;

/**
 * 투수의 혹사 배율: 지금까지의 이닝을 시즌 전체로 늘린 페이스가 기준(선발 160, 구원 75이닝)을 넘는 만큼 오른다.
 * 페이스는 팀 경기 수 기준이다 (치른 경기 ÷ 팀당 경기, 일정 개편 11단계): 달력은 올스타·국제대회 휴식과 잔여 경기로 해마다 길이가 다르다.
 * 나이도 조금 반영한다 (한 살마다 2%, 0.85~1.3). 모두 임시값.
 */
export function pitcherLoadFactor(p: SimPlayer, line: PitLine, played: number, perTeam: number): number {
  const starter = (p.pit?.startShare ?? 0) >= 0.5;
  const pace = (line.outs / 3) * (perTeam / (played + PACE_RAMP_GAMES));
  const over = starter ? Math.max(0, pace - 160) / 80 : Math.max(0, pace - 75) / 40;
  const age = p.age === null ? 1 : Math.min(1.3, Math.max(0.85, 1 + 0.02 * (p.age - 29)));
  return (1 + over) * age;
}

/** 경기 전 부상 확률. played = 그 구단이 치른 경기, perTeam = 팀당 경기 수 (투수 페이스) */
export function injuryChance(p: SimPlayer, line: PitLine, played: number, perTeam: number, ip: InjuryParams): number {
  return ip.base * (p.isPitcher ? pitcherLoadFactor(p, line, played, perTeam) : hitterAgeFactor(p.age));
}

/** 부상 부위 */
export const INJURY_PARTS = {
  hamstring: '햄스트링', thigh: '허벅지', calf: '종아리', ankle: '발목', knee: '무릎', back: '허리', oblique: '옆구리',
  shoulder: '어깨', elbow: '팔꿈치', wrist: '손목', finger: '손가락', hand: '손등', groin: '사타구니',
} as const;
export type InjuryPart = keyof typeof INJURY_PARTS;

/** 부위 분포 (임시값: 부위별 실제 부상 통계를 확인하지 못했다). 경기 전 부상은 투수·야수별, 경기 중 부상은 사건별 */
const PART_SHARES: Record<'pitcher' | 'hitter' | InjuryCause, [InjuryPart, number][]> = {
  pitcher: [['elbow', 24], ['shoulder', 20], ['oblique', 12], ['back', 11], ['finger', 8], ['hamstring', 6], ['knee', 5], ['ankle', 5], ['groin', 4], ['calf', 5]],
  hitter: [['hamstring', 17], ['back', 13], ['oblique', 10], ['ankle', 10], ['knee', 8], ['wrist', 8], ['finger', 7], ['shoulder', 7], ['calf', 6], ['thigh', 6], ['hand', 4], ['groin', 4]],
  pitch: [['elbow', 30], ['shoulder', 26], ['oblique', 16], ['back', 12], ['finger', 10], ['groin', 6]],
  run: [['hamstring', 34], ['thigh', 14], ['calf', 14], ['ankle', 14], ['groin', 10], ['finger', 8], ['knee', 6]],
  field: [['ankle', 20], ['knee', 16], ['shoulder', 16], ['finger', 16], ['wrist', 12], ['hamstring', 10], ['back', 10]],
};

function drawPart(rng: Rng, table: [InjuryPart, number][]): InjuryPart {
  let u = rng.next() * table.reduce((a, [, w]) => a + w, 0);
  for (const [part, w] of table) if ((u -= w) < 0) return part;
  return table[table.length - 1][0];
}

/**
 * 부상 정도·기간·부위를 뽑는다. 발생이 정해진 뒤에만 부르므로 평소의 난수 소비는 하루·선수당 한 번이다.
 * 부위는 cause(경기 중 사건)가 있으면 그 사건의 분포, 없으면 투수·야수별 분포
 */
export function drawInjury(rng: Rng, ip: InjuryParams, isPitcher = false, cause?: InjuryCause): { kind: Exclude<AbsenceKind, 'event'>; days: number; part: InjuryPart } {
  const u = rng.next();
  const pick = u < ip.minor.share ? 'minor' : u < ip.minor.share + ip.long.share ? 'long' : 'major';
  const [lo, hi] = ip[pick].days;
  const days = lo + rng.int(hi - lo + 1);
  return { kind: pick, days, part: drawPart(rng, PART_SHARES[cause ?? (isPitcher ? 'pitcher' : 'hitter')]) };
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

/** 부위가 없는 부상(예전 기록)의 결장 문구 */
export const ABSENCE_KIND_LABEL: Record<AbsenceKind, string> = {
  minor: '경미한 부상', long: '장기 부상', major: '큰 부상', event: '이탈',
};
/** 부상 정도 문구 (부위와 함께) */
export const SEVERITY_LABEL: Record<Exclude<AbsenceKind, 'event'>, string> = {
  minor: '경미', long: '중간 정도', major: '심각',
};

/**
 * 결장 문구. 부상은 실존·가상 선수 모두 같은 규칙으로 부위·정도를 쓴다 (엔진 2 11단계, 2026-10-22 사용자 결정. 예: "햄스트링 부상, 중간 정도").
 * 이탈 이벤트는 실존 선수에게 중립 문구만, 가상 선수에게는 구체적 사건까지 쓴다.
 */
export function absenceLabel(a: Pick<Absence, 'kind' | 'event' | 'part'>, p: Pick<SimPlayer, 'real'>, seasonOut = false): string {
  // 실존 선수에게는 중립 이벤트라도 사유('징계성', '갈등')를 적지 않는다: 잘못을 한 것처럼 읽힌다 (2026-10-12)
  if (a.kind === 'event' && !isVirtual(p)) return '1군 이탈';
  if (a.kind === 'event' && a.event) return eventLabel(a.event, p);
  const base = a.part && a.kind !== 'event' ? `${INJURY_PARTS[a.part]} 부상, ${SEVERITY_LABEL[a.kind]}` : ABSENCE_KIND_LABEL[a.kind];
  return seasonOut && a.kind !== 'minor' ? `${base} (시즌 아웃)` : base;
}
