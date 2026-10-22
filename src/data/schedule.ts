// 연도별 정규시즌 일정 규칙 (schedule.json) → 그 해 날짜가 정해진 규칙.
// 자료가 있는 해(1982~2026)는 그 해 줄을, 없는 해(2027~)는 자료 없는 해 줄의 요일 규칙으로 날짜를 계산한다 (일정 개편 기획안 2.3, 결정 8).
// 아직 엔진은 이 규칙을 쓰지 않는다 (기획안 8장 4단계에서 연결).
import type { MonthDay, PostponeRule, ScheduleData, ScheduleFrame, ScheduleRuleRow, WeekdayRule } from './types';

/** 'YYYY-MM-DD' */
export type IsoDate = string;

/** 한 해의 일정 규칙 (날짜는 모두 'YYYY-MM-DD') */
export interface YearScheduleRule {
  year: number;
  /** 구단 수 (자료 없는 해는 없음: 월드의 구단 수를 쓴다) */
  teams?: number;
  games: number;
  vs: number;
  vsOther?: number;
  frame: ScheduleFrame;
  opening: IsoDate;
  endRef?: IsoDate;
  endRef2?: IsoDate;
  /** 올스타 휴식 포함, 날짜 순 */
  breaks: { from: IsoDate; to: IsoDate; reason: string }[];
  /** 게임의 올스타전 날. 없는 해(2020·2021)는 null */
  allStar: IsoDate | null;
  allStarGamesReal: number;
  postseasonStart?: IsoDate;
  postpone: PostponeRule;
  dhBan: { from: IsoDate; to: IsoDate }[];
  unscheduled: number;
  remainingFrom?: IsoDate;
  twoGameFrom?: 'allStar';
  rainMid: string;
  status: string;
  /** 자료 없는 해 줄에서 계산한 규칙 */
  projected: boolean;
}

const DAY_MS = 86400000;

function utc(iso: IsoDate): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function iso(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 두 날짜 사이 날 수 (b − a) */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

/** 날짜 + n일 */
export function addDays(d: IsoDate, n: number): IsoDate {
  return iso(utc(d) + n * DAY_MS);
}

/** 0 = 일요일 (Date.getDay 순서) */
export function weekdayOf(d: IsoDate): number {
  return new Date(utc(d)).getUTCDay();
}

function at(year: number, md: MonthDay): IsoDate {
  return `${year}-${md}`;
}

/** from~to 구간에서 그 요일인 첫 날 */
function ruleDay(year: number, r: WeekdayRule): IsoDate {
  for (let d = at(year, r.from); d <= at(year, r.to); d = addDays(d, 1)) {
    if (weekdayOf(d) === r.weekday) return d;
  }
  throw new Error(`일정 규칙: ${year}년 ${r.from}~${r.to}에 요일 ${r.weekday}가 없음`);
}

function resolve(row: ScheduleRuleRow, year: number, projected: boolean): YearScheduleRule {
  const day = (x: MonthDay | WeekdayRule): IsoDate => (typeof x === 'string' ? at(year, x) : ruleDay(year, x));
  const allStar = row.allStar ? day(row.allStar) : null;
  const breaks = row.breaks.map((b) => ({ from: at(year, b.from), to: at(year, b.to), reason: b.reason }));
  if (allStar && row.allStarBreak) {
    breaks.push({ from: addDays(allStar, row.allStarBreak[0]), to: addDays(allStar, row.allStarBreak[1]), reason: '올스타' });
  }
  breaks.sort((a, b) => (a.from < b.from ? -1 : 1));
  const opt = (x?: MonthDay) => (x ? at(year, x) : undefined);
  return {
    year,
    ...(row.teams !== undefined ? { teams: row.teams } : {}),
    games: row.games,
    vs: row.vs,
    ...(row.vsOther !== undefined ? { vsOther: row.vsOther } : {}),
    frame: row.frame,
    opening: day(row.opening),
    ...(row.endRef ? { endRef: opt(row.endRef) } : {}),
    ...(row.endRef2 ? { endRef2: opt(row.endRef2) } : {}),
    breaks,
    allStar,
    allStarGamesReal: row.allStarGamesReal,
    ...(row.postseasonStart ? { postseasonStart: opt(row.postseasonStart) } : {}),
    postpone: row.postpone,
    dhBan: row.dhBan.map((b) => ({ from: at(year, b.from), to: at(year, b.to) })),
    unscheduled: row.unscheduled,
    ...(row.remainingFrom ? { remainingFrom: opt(row.remainingFrom) } : {}),
    ...(row.twoGameFrom ? { twoGameFrom: row.twoGameFrom } : {}),
    rainMid: row.rainMid,
    status: row.status,
    projected,
  };
}

/** 그 해 일정 규칙. 자료 줄이 있으면 그 줄, 없고 자료 없는 해 줄 범위면 그 줄로 계산, 그보다 이른 해(자료에 없는 과거)는 undefined */
export function scheduleRule(data: ScheduleData, year: number): YearScheduleRule | undefined {
  const row = data.years[String(year)];
  if (row) return resolve(row, year, false);
  const f = data.future;
  if (f && f.from !== undefined && year >= f.from) return resolve(f, year, true);
  return undefined;
}
