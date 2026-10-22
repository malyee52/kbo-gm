// 날씨와 우천 순연 (일정 개편 기획안 4장, 8장 7단계). 순수 함수이고 난수는 Rng만 쓴다: 같은 시드 = 같은 취소.
// 개막 때 시즌 전체를 날짜 순으로 미리 굴려 경기 전 취소·순연·더블헤더·잔여 경기까지 담은 일정(days)을 한 번에 만든다 (4.4).
// 경기 결과를 보지 않으므로 플레이어 조작과 상관없이 일정이 같다.
//
// 날씨 (4.2, 임시값): 날마다 전국 비(월별 확률) + 구장별 비 두 단계. 구장 하루 날씨는 맑음 / 경기 전 취소 / 경기 중 비(멈추는 회).
// 난수 줄기는 시즌 뿌리의 'weather'에서 날짜·구장마다 따로 갈라 쓴다 (weather/<날짜 색인>/<구장 계보>, 더블헤더 2차전은 /2).
// 순연이 생겨 그 날 경기가 늘어도 그 날 그 구장 날씨는 같다. 돔 구장은 비가 오지 않는다.
//
// 경기 중 비는 rainInning(1~8)만 달아 둔다. 엔진은 아직 이 값을 무시하고 끝까지 치른다 (강우 콜드·노게임은 10단계).
// 그래서 노게임(1~4회)도 지금은 다시 편성하지 않는다 (편성하면 그 대진 경기 수가 늘어난다).
import type { YearScheduleRule } from '../data/schedule';
import { addDays, daysBetween, weekdayOf } from '../data/schedule';
import { Rng } from './rng';
import type { PlanGame, SchedulePlan } from './schedule';

/**
 * 월별 전국 비 날 확률 (1월 = 0번, 임시값). 3~4월 낮음, 6월 하순~7월 장마 높음, 8월 태풍 중간, 9월 중간, 10월 낮음 (기획안 4.2).
 * 기상청 평년값이 오면 이 표만 바꾸고 RAIN_SCALE을 tools/schedule_check.ts로 다시 맞춘다
 */
export const RAIN_WIDE_BY_MONTH = [0, 0, 0.05, 0.08, 0.09, 0.13, 0.22, 0.15, 0.09, 0.05, 0.04, 0];
/** 구장에 비가 올 확률: 전국 비 날 / 아닌 날 (국지성 비) (임시값) */
export const RAIN_PARK = { wide: 0.5, local: 0.025 };
/**
 * 전체 계수 (임시값): 2015~2025 시작 판에서 한 시즌 다시 치르는 경기(경기 전 취소 + 노게임)가 평균 65경기 (조사값, 720경기의 약 9%)에
 * 맞게 정한다 (tools/schedule_check.ts → reports/schedule-check.md). 2014년 이전도 경기당 같은 비율
 */
export const RAIN_SCALE = 1.17;
/** 구장에 비가 왔을 때 경기 중 비의 비율 (경기 전 취소 : 경기 중 비 = 5 : 1, 임시값). 멈추는 회는 1~8회 균등 */
export const RAIN_MID_SHARE = 1 / 6;
/** 2015년부터(R3~) 한 팀이 연달아 경기하는 날의 한도 (조사값 "9연전까지") */
export const MAX_STREAK = 9;

/** 구장 하루 날씨: 0 = 맑음, -1 = 경기 전 취소, 1~8 = 그 회를 마치고 멈추는 경기 중 비 */
export type ParkWeather = number;

/** 그 날 그 구장 날씨. second는 더블헤더 2차전 (1차전과 따로 뽑는다) */
export function parkWeather(root: Rng, day: number, date: string, park: string, second = false): ParkWeather {
  const month = Number(date.slice(5, 7)) - 1;
  const wide = root.fork(String(day)).next() < RAIN_WIDE_BY_MONTH[month];
  const r = root.fork(`${day}/${park}${second ? '/2' : ''}`);
  const p = Math.min(0.95, (wide ? RAIN_PARK.wide : RAIN_PARK.local) * RAIN_SCALE);
  if (r.next() >= p) return 0;
  return r.next() < RAIN_MID_SHARE ? 1 + r.int(8) : -1;
}

export interface WeatherInput {
  rule: Pick<YearScheduleRule, 'year' | 'opening' | 'breaks' | 'postpone' | 'dhBan' | 'remainingFrom'>;
  teams: number;
  /** 구장 날씨 줄기 이름 (구단 색인 순, 홈 구단 계보) */
  parks: string[];
  /** 홈 구장이 돔인 구단 (구단 색인 순) */
  domes?: boolean[];
  /** 시즌 뿌리 난수. 'weather'·'remaining' 줄기를 갈라 쓴다 */
  rng: Rng;
}

/** 잔여 경기 발표일: 규칙 표의 날짜와 본 일정 마지막 3주 전 중 늦은 날 (임시값, 기획안 3.2 6번. schedule.ts와 같은 값) */
const REMAINING_LEAD_DAYS = 21;

const isWeekend = (w: number) => w === 0 || w === 6;

/**
 * 기본 일정(우천 없음)에 날씨를 굴려 실제로 치르는 일정을 만든다 (기획안 4.3 순연 규칙).
 *  R1 (1982~2005): 다음 날 같은 대진이면 다음 날 더블헤더 → 그 주의 빈 날(다음 월요일까지 두 팀 모두 빈 날) → 시즌 끝 잔여 경기
 *  R2 (2006~2014): 주말(금~일) 취소는 바로 다음 월요일 (한 팀 월요일 경기 2주 연속 금지) → 시즌 끝 잔여 경기.
 *                  더블헤더는 2006~2007 없음, 2008~2009 일요일만, 2010~2014 시즌 끝 잔여 경기의 주말만
 *  R3 (2015~2023): 주말 취소는 다음 월요일 → 잔여 경기 발표일에 미편성분과 합쳐 다시 짠다. 더블헤더는 잔여 경기의 주말만
 *  R3c (2020): 다음 날 같은 대진이면 더블헤더(수·목·토·일) → 다음 월요일 → 잔여 경기
 *  R4·R5 (2024~): 금·토 취소는 다음 날 더블헤더 → 주말 취소는 다음 월요일 → 잔여 경기. 월요일 더블헤더 없음, R5는 한 팀 2주 연속 더블헤더 금지
 *  R3~R5는 한 팀 9연전까지, 월요일 경기 3주 연속 금지 (R3c는 9연전만). 더블헤더 금지 기간(dhBan)·쉬는 기간에는 넣지 않는다.
 * 2015년 전 규칙 해석(빈 날, 잔여 경기 더블헤더의 요일)과 "예비일 = 주말 취소 뒤 월요일"은 임시 해석이다
 */
export function applyWeather(base: SchedulePlan, input: WeatherInput): SchedulePlan {
  const { rule, teams: n } = input;
  const code = rule.postpone;
  const year = rule.year;
  const root = input.rng.fork('weather');
  const domes = input.domes ?? [];
  const dateAt = (e: number) => addDays(rule.opening, e);
  const inBreak = (e: number) => {
    const d = dateAt(e);
    return rule.breaks.some((b) => b.from <= d && d <= b.to);
  };
  const dhBanned = (e: number) => {
    const d = dateAt(e);
    return rule.dhBan.some((b) => b.from <= d && d <= b.to);
  };
  const days: PlanGame[][] = base.days.map((d) => d.map((g) => ({ home: g.home, away: g.away })));
  const mainEnd = base.mainEnd;

  // 잔여 경기 발표가 있는 해(R3~): 본 일정 뒤 미편성 경기는 발표일까지 들고 있다가 순연분과 함께 짠다
  const announce = rule.remainingFrom ? Math.max(daysBetween(rule.opening, rule.remainingFrom), mainEnd - REMAINING_LEAD_DAYS) : -1;
  const held: { g: PlanGame; cancel: number }[] = [];
  if (announce >= 0) {
    for (let e = mainEnd + 1; e < days.length; e++) for (const g of days[e]) held.push({ g, cancel: -1 });
    days.length = mainEnd + 1;
  }

  const day = (e: number) => {
    while (days.length <= e) days.push([]);
    return days[e];
  };
  const count = (e: number, t: number) => (days[e] ?? []).reduce((k, g) => k + (g.home === t || g.away === t ? 1 : 0), 0);
  const plays = (e: number, t: number) => e >= 0 && count(e, t) > 0;
  const limitStreak = code !== 'R1' && code !== 'R2';
  const streakOk = (e: number, t: number) => {
    if (!limitStreak) return true;
    let k = 1;
    for (let x = e - 1; plays(x, t); x--) k++;
    for (let x = e + 1; x < days.length && plays(x, t); x++) k++;
    return k <= MAX_STREAK;
  };
  // 월요일 경기 연속 한도: R2는 2주, R3·R4·R5는 3주 연속 금지 (한 팀 기준, 임시 해석)
  const mondayRun = code === 'R2' ? 2 : code === 'R3' || code === 'R4' || code === 'R5' ? 3 : 0;
  const mondayOk = (e: number, t: number) => {
    if (weekdayOf(dateAt(e)) !== 1 || !mondayRun) return true;
    const on = (k: number) => k === 0 || plays(e + 7 * k, t);
    for (let s = -(mondayRun - 1); s <= 0; s++) {
      let all = true;
      for (let k = s; k < s + mondayRun; k++) if (!on(k)) all = false;
      if (all) return false;
    }
    return true;
  };
  // R5: 한 팀이 더블헤더를 2주 연속 하지 않는다 (월요일 시작 주)
  const weekOf = (e: number) => Math.floor(daysBetween('1970-01-05', dateAt(e)) / 7);
  const dhWeeks = Array.from({ length: n }, () => new Set<number>());
  const dhOk = (e: number, h: number, a: number, phase: 'next' | 'tail'): boolean => {
    if (dhBanned(e) || inBreak(e)) return false;
    const w = weekdayOf(dateAt(e));
    switch (code) {
      case 'R1': return true;
      case 'R2':
        if (year <= 2007) return false;
        if (year <= 2009) return w === 0;
        return phase === 'tail' && isWeekend(w);
      case 'R3': return phase === 'tail' && isWeekend(w);
      case 'R3c': return w === 0 || w === 3 || w === 4 || w === 6;
      case 'R4': return isWeekend(w);
      case 'R5': {
        if (!isWeekend(w)) return false;
        const wk = weekOf(e);
        return ![h, a].some((t) => dhWeeks[t].has(wk - 1) || dhWeeks[t].has(wk + 1));
      }
    }
    return false;
  };

  /** e날 두 팀이 모두 비어 있고 한도 안이면 한 경기로 넣는다 */
  const single = (g: PlanGame, e: number): boolean => {
    if (inBreak(e) || count(e, g.home) || count(e, g.away)) return false;
    if (!mondayOk(e, g.home) || !mondayOk(e, g.away) || !streakOk(e, g.home) || !streakOk(e, g.away)) return false;
    day(e).push({ home: g.home, away: g.away });
    return true;
  };
  /** e날 같은 구장 같은 대진 한 경기가 있으면 더블헤더로 (순연 경기가 1차전) */
  const double = (g: PlanGame, e: number, phase: 'next' | 'tail'): boolean => {
    const list = days[e];
    if (!list || count(e, g.home) !== 1 || count(e, g.away) !== 1) return false;
    const other = list.find((x) => x.home === g.home && x.away === g.away);
    if (!other || !dhOk(e, g.home, g.away, phase)) return false;
    other.dh = 2;
    list.push({ home: g.home, away: g.away, dh: 1 });
    const wk = weekOf(e);
    dhWeeks[g.home].add(wk);
    dhWeeks[g.away].add(wk);
    return true;
  };
  /** 가장 이른 날부터 한 경기 또는 (그 시대가 허용하면) 더블헤더로 넣는다 */
  const greedy = (g: PlanGame, from: number): number => {
    for (let e = from; e < from + 400; e++) {
      if (single(g, e) || double(g, e, 'tail')) return e;
    }
    throw new Error(`우천 순연: ${year}년 ${g.home} 대 ${g.away} 경기를 놓을 날이 없음`);
  };
  /** 취소한 날 뒤 첫 월요일 */
  const nextMonday = (d: number) => {
    for (let e = d + 1; e <= d + 7; e++) if (weekdayOf(dateAt(e)) === 1) return e;
    return -1;
  };

  /** 취소된 경기를 다시 놓는다. 놓은 날 (발표일까지 들고 있으면 -1) */
  const reschedule = (g: PlanGame, d: number, cancelIdx: number): number => {
    const w = weekdayOf(dateAt(d));
    const weekend = w === 5 || w === 6 || w === 0; // 금~일 (주말 연전)
    const mon = nextMonday(d);
    // 예비일: 주말 연전 취소분을 바로 다음 월요일에 (임시 해석)
    const monday = () => mon > 0 && mon - d <= 3 && single(g, mon);
    // 잔여 경기 기간(R1·R2는 본 일정 뒤, R3~는 발표 뒤)에 또 취소되면 두 팀의 남은 경기 뒤로 민다 (기획안 4.3 "뒤로 민다")
    const pushBack = () => {
      let last = d;
      for (let e = days.length - 1; e > d; e--) if (count(e, g.home) || count(e, g.away)) { last = e; break; }
      return last + 1;
    };
    const tailFrom = d > mainEnd ? pushBack() : mainEnd + 1;
    switch (code) {
      case 'R1': {
        if (double(g, d + 1, 'next')) return d + 1;
        for (let e = d + 1; e <= mon; e++) if (single(g, e)) return e;
        return greedy(g, tailFrom);
      }
      case 'R2': {
        if (weekend) {
          if (monday()) return mon;
          if (w === 6 && double(g, d + 1, 'next')) return d + 1;
        }
        return greedy(g, tailFrom);
      }
      case 'R3c':
        if (double(g, d + 1, 'next')) return d + 1;
        if (mon > 0 && single(g, mon)) return mon;
        break;
      case 'R4':
      case 'R5':
        if ((w === 5 || w === 6) && double(g, d + 1, 'next')) return d + 1;
        if (weekend && monday()) return mon;
        break;
      default: // R3
        if (weekend && monday()) return mon;
    }
    if (announce >= 0 && d < announce) {
      held.push({ g: { home: g.home, away: g.away }, cancel: cancelIdx });
      return -1;
    }
    return greedy(g, pushBack());
  };

  const cancels: [number, number, number, number][] = [];
  const placeHeld = (from: number) => {
    const list = input.rng.fork('remaining').shuffle([...held]);
    held.length = 0;
    for (const { g, cancel } of list) {
      const e = greedy(g, from);
      if (cancel >= 0) cancels[cancel][3] = e;
    }
  };

  for (let d = 0; d < days.length || held.length; d++) {
    if (d === announce || (d >= days.length && held.length)) placeHeld(d + 1);
    if (d >= days.length) continue;
    const today = days[d];
    const date = dateAt(d);
    // 1차전 먼저 (같은 대진의 2차전은 1차전 뒤에). 2차전 날씨는 1차전이 취소돼도 2차전 줄기에서 뽑는다
    const order = [...today].sort((x, y) => (x.dh ?? 0) - (y.dh ?? 0) || x.home - y.home).map((g) => [g, g.dh === 2] as const);
    for (const [g, second] of order) {
      if (domes[g.home]) continue;
      const w = parkWeather(root, d, date, input.parks[g.home] ?? String(g.home), second);
      if (w === 0) continue;
      if (w > 0) {
        g.rainInning = w;
        continue;
      }
      today.splice(today.indexOf(g), 1);
      if (g.dh) {
        const partner = today.find((x) => x.home === g.home && x.away === g.away && x.dh);
        if (partner) delete partner.dh;
      }
      const idx = cancels.length;
      cancels.push([d, g.home, g.away, -1]);
      cancels[idx][3] = reschedule(g, d, idx);
    }
  }
  while (days.length && !days[days.length - 1].length) days.pop();
  for (const d of days) d.sort((x, y) => (x.dh === 2 ? 1 : 0) - (y.dh === 2 ? 1 : 0) || x.home - y.home);

  return {
    ...base, days, cancels,
    remainingFrom: base.remainingFrom >= 0 ? base.remainingFrom : announce,
  };
}
