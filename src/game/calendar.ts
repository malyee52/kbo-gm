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

export { WEEKDAYS };
