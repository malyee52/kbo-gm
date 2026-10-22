// 일정 색인(0, 1, 2, ...)을 달력 날짜로 바꾼다. 색인 0이 개막일이고 하루에 1씩 센다 (휴식일·올스타 휴식도 날짜로 센다).
// 개막일은 연도별 일정 규칙 표(schedule.json)에서 (data/schedule.ts openingOf). 엔진의 일정 생성기도 같은 개막일을 쓴다.

import { openingOf } from '../data/schedule';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export interface GameDate {
  year: number;
  month: number;
  date: number;
  /** 0 = 일요일 */
  weekday: number;
}

function openingDayUtc(year: number): number {
  const d = openingOf(year);
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

export function dateOf(year: number, day: number): GameDate {
  const d = new Date(openingDayUtc(year) + day * 86400000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate(), weekday: d.getUTCDay() };
}

/** 예: "4월 3일 (금)" */
export function formatDate(year: number, day: number, withYear = false): string {
  const d = dateOf(year, day);
  return `${withYear ? `${d.year}년 ` : ''}${d.month}월 ${d.date}일 (${WEEKDAYS[d.weekday]})`;
}

/** 예: "4/3" */
export function shortDate(year: number, day: number): string {
  const d = dateOf(year, day);
  return `${d.month}/${d.date}`;
}

export { WEEKDAYS };
