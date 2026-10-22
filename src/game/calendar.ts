// 일정 색인(0, 1, 2, ...)을 달력 날짜로 바꾼다.
// 엔진 일정은 6일 경기 뒤 하루 휴식이라, 첫날을 화요일로 두면 휴식일이 월요일이 된다.
// 개막일은 "3월 24일 이후 첫 화요일"로 정했다 (임시값. 실제 개막일·올스타 휴식·우천 순연은 반영하지 않는다).

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export interface GameDate {
  year: number;
  month: number;
  date: number;
  /** 0 = 일요일 */
  weekday: number;
}

function openingDayUtc(year: number): number {
  const d = new Date(Date.UTC(year, 2, 24));
  const shift = (2 - d.getUTCDay() + 7) % 7; // 화요일 = 2
  return Date.UTC(year, 2, 24 + shift);
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
