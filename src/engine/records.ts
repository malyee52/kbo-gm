// 기록 규정 연표 (경기 엔진 2 14단계, docs/경기엔진2_기획안.md 3.10.1): 연장 이닝·무승부·승률의 무승부 처리.
// 값은 public/data/meta.json의 rules[연도] (tools/build_data.py rules_for). 시간제한(22:30, 4시간)은 엔진에 경기 시각이 없어 넣지 않는다.
import type { YearRules } from '../data/types';
import type { TeamRecord } from './types';

/** 승률의 무승부 처리 (YearRules.winPct) */
export type WinPctRule = 'wl' | 'half' | 'wins' | 'tieLoss';

/** 포스트시즌 최대 이닝 기본값 (rules에 값이 없을 때) */
export const POSTSEASON_INNINGS_DEFAULT = 15;

export function winPctRuleOf(rules?: Pick<YearRules, 'winPct'>): WinPctRule {
  const r = rules?.winPct;
  return r === 'half' || r === 'wins' || r === 'tieLoss' ? r : 'wl';
}

/** 승 ÷ (승+패). 경기가 없으면 0. 해마다 다른 무승부 처리는 winPctBy */
export function winPct(t: Pick<TeamRecord, 'w' | 'l'>): number {
  return t.w + t.l > 0 ? t.w / (t.w + t.l) : 0;
}

/**
 * 그 해 방식의 승률. 'wl'·'wins'는 승 ÷ (승+패), 'half'는 (승 + 0.5 × 무) ÷ (승+패+무), 'tieLoss'는 승 ÷ (승+패+무).
 * 경기가 없으면 0
 */
export function winPctBy(t: Pick<TeamRecord, 'w' | 'l' | 't'>, rule: WinPctRule): number {
  if (rule === 'half') return t.w + t.l + t.t > 0 ? (t.w + 0.5 * t.t) / (t.w + t.l + t.t) : 0;
  if (rule === 'tieLoss') return t.w + t.l + t.t > 0 ? t.w / (t.w + t.l + t.t) : 0;
  return winPct(t);
}

/** 순위 순 팀 색인. 다승제('wins')는 승수, 그다음 승률. 나머지는 승률, 그다음 승수. 모두 같으면 색인 순 */
export function rankTeams(teams: TeamRecord[], rule: WinPctRule = 'wl'): number[] {
  const pct = teams.map((t) => winPctBy(t, rule));
  return teams.map((_, i) => i).sort((x, y) => (rule === 'wins'
    ? teams[y].w - teams[x].w || pct[y] - pct[x]
    : pct[y] - pct[x] || teams[y].w - teams[x].w) || x - y);
}

/** 경기 날의 모습 (최대 이닝 판정용) */
export interface GameDayInfo {
  /** 월 × 100 + 일 */
  md: number;
  /** 0 = 일요일 */
  weekday: number;
  /** 더블헤더 경기 (지금 일정에는 없다. 일정 개편 브랜치에서 넘긴다) */
  doubleheader?: boolean;
}

/**
 * 그 경기의 정규시즌 최대 이닝. 0 = 무제한 (2008). 9회 규정: 2020 더블헤더·월요일 편성 경기, 2021 후반기(8월 10일~) 모든 경기.
 * 9회까지 동점이면 무승부 (연장 없음)
 */
export function regularMaxInnings(rules: Pick<YearRules, 'maxInnings' | 'nineInningsFrom' | 'nineInningsDhMonday'>, day?: GameDayInfo): number {
  if (day) {
    if (rules.nineInningsFrom && day.md >= rules.nineInningsFrom) return 9;
    if (rules.nineInningsDhMonday && (day.doubleheader || day.weekday === 1)) return 9;
  }
  return rules.maxInnings;
}

/** 그 해 포스트시즌 최대 이닝. 0 = 무제한 */
export function postseasonMaxInnings(rules?: Pick<YearRules, 'postseasonMaxInnings'>): number {
  return rules?.postseasonMaxInnings ?? POSTSEASON_INNINGS_DEFAULT;
}

/**
 * 일정 색인(0 = 개막일)의 달력 날짜. 개막일은 "3월 24일 이후 첫 화요일" (임시값, game/calendar.ts가 화면 날짜에 같은 함수를 쓴다).
 * 엔진 일정은 6일 경기 뒤 하루 휴식이라 휴식일이 월요일이다
 */
export function dateOfDay(year: number, day: number): { year: number; month: number; date: number; weekday: number } {
  const open = new Date(Date.UTC(year, 2, 24));
  const shift = (2 - open.getUTCDay() + 7) % 7; // 화요일 = 2
  const d = new Date(Date.UTC(year, 2, 24 + shift) + day * 86400000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate(), weekday: d.getUTCDay() };
}
