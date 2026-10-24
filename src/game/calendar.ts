// 일정 색인(0, 1, 2, ...)을 달력 날짜로 바꾼다. 색인 0이 개막일이고 하루에 1씩 센다 (휴식일·올스타 휴식도 날짜로 센다).
// 개막일은 연도별 일정 규칙 표(schedule.json)에서 (data/schedule.ts openingOf). 엔진의 일정 생성기도 같은 개막일을 쓴다.
// 날짜 계산은 엔진의 dateOfDay(engine/records.ts)와 같다: 엔진도 2021 후반기 9회 규정 등을 날짜로 판정한다.

import { openingOf } from '../data/schedule';
import { dateOfDay } from '../engine/records';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export interface GameDate {
  year: number;
  month: number;
  date: number;
  /** 0 = 일요일 */
  weekday: number;
}

export function dateOf(year: number, day: number): GameDate {
  return dateOfDay(year, day, openingOf(year));
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

/**
 * 경기 시작 시각 (요일별, 0 = 일요일). 임시값: 2026-10-22 사용자 결정으로 평일 18:30, 토요일 17:00, 일요일 14:00.
 * 일정 자료에 시각이 없어 화면 표시에만 쓴다. 일정 개편 때 연도별 표로 바꾼다
 */
export const GAME_TIME_BY_WEEKDAY = ['14:00', '18:30', '18:30', '18:30', '18:30', '18:30', '17:00'];

/** 예: "18:30" */
export function gameTime(year: number, day: number): string {
  return GAME_TIME_BY_WEEKDAY[dateOf(year, day).weekday];
}

export { WEEKDAYS };
