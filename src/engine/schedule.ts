// 연전 단위 정규시즌 일정 생성기 (일정 개편 기획안 3장). 순수 함수이고 난수는 Rng만 쓴다: 같은 시드 = 같은 일정.
// Season은 planForWorld로 일정을 만든다 (기획안 8장 4단계). 우천 취소·순연은 그 뒤에 날씨를 굴려 붙인다 (weather.ts applyWeather, 7단계).
// 연전 틀: W82·W83(1982·1983)·T3W2(1984~1985)·S2(1986~1990)·S33(1991~2012)·S33-99(1999 양대 리그)·S33-9(2013~2014)·S33L2(2015~2022)·S33F(2023~)
// (3·5·6단계, S33L2는 2연전 시작일 결정 뒤). 규칙 표에 맞지 않는 월드(리그 나눔이 없는 1999 월드 포함)는
// 같은 달력(개막일·월요일·쉬는 기간) 위에 원형 대진을 하루 한 경기씩 편다 (spreadPlan, 연전 없음).
//
// 만드는 순서 (기획안 3.2):
//  1. 달력 칸: 개막일부터 날짜를 놓고 쉬는 기간·월요일을 빼고, 연전 틀의 요일 규칙으로 날짜를 연전 칸(1~4일)으로 묶는다
//  2. 대진 돌림: 원형 대진의 라운드(모든 팀이 한 상대씩)를 칸마다 하나씩 쓴다. 라운드마다 상대별 경기 수가 같다
//  3. 상대별 맞추기: 라운드가 다 차면 본 일정이 끝나고, 모자란 경기는 잔여 경기로 본 일정 뒤에 놓는다
//  4. 홈·원정: 연전 하나는 한 구장. 상대별 홈 수(2.2)를 지키면서 같은 상대와 번갈아, 원정 연전은 3번 연속까지
//  5. 검사: 어긋나면 시드 꼬리를 바꿔(schedule/2, …) 다시 만든다
import type { SeasonData } from '../data/types';
import type { YearScheduleRule } from '../data/schedule';
import { addDays, daysBetween, defaultOpening, weekdayOf } from '../data/schedule';
import { Rng } from './rng';
import type { World } from './types';
import { applyWeather } from './weather';

export interface PlanGame {
  home: number;
  away: number;
  /** 더블헤더 몇 차전 (7단계 우천 순연부터) */
  dh?: 1 | 2;
  /** 경기 중 비: 이 회를 마치고 멈춘다 (10단계) */
  rainInning?: number;
}

/** 연전 하나 (본 일정). day는 개막일부터 센 날짜 색인 */
export interface PlanSeries {
  day: number;
  len: number;
  home: number;
  away: number;
}

/** 기획안 3.4의 일정 자료 + 만들 때 쓴 연전 목록 */
export interface SchedulePlan {
  /** 'YYYY-MM-DD' 개막일 (날짜 색인 0) */
  opening: string;
  /** 실제로 치르는 일정 (날짜 색인 → 그날 경기). 빈 배열은 경기 없는 날 */
  days: PlanGame[][];
  /** 개막 때 발표한 일정 (잔여 경기 발표가 있는 해는 잔여 경기가 없다) */
  planned: PlanGame[][];
  /** 경기 전 우천 취소 [날짜, 홈, 원정, 옮긴 날짜] (7단계) */
  cancels: [number, number, number, number][];
  /** 잔여 경기 일정 발표 날짜 색인 (없으면 -1) */
  remainingFrom: number;
  /** 옮긴 날을 잔여 경기 일정 발표(remainingFrom) 때 알리는 취소 (cancels 색인). 그 전에는 "추후 편성" (8단계 knownSchedule) */
  held: number[];
  /** 본 일정의 연전 (잔여 경기는 들지 않는다) */
  series: PlanSeries[];
  /** 본 일정이 끝난 날짜 색인 (마지막 연전의 마지막 날) */
  mainEnd: number;
  /** 몇 번째 시도에서 검사를 통과했는지 (1 = schedule, 2 = schedule/2, …) */
  attempt: number;
}

export interface ScheduleInput {
  rule: YearScheduleRule;
  /** 구단 수 (월드) */
  teams: number;
  /** 구단 계보 (구단 색인 순). 2023~ 격년 홈 배분(2.2)에 쓴다. 없으면 색인으로 정한다 */
  franchises?: string[];
  /** 개막 연전 홈 구단 (2015~ 지난 시즌 상위 팀, 기획안 2.2). 없으면 시드로 */
  openingHosts?: number[];
  /** 양대 리그 나눔 (World.divisions의 teams, 1999·2000). S33-99는 이것으로 대진을 짜고, 19차전 해(2000)는 남는 홈을 리그마다 나눈다 */
  divisions?: [number[], number[]];
  /** 시즌 뿌리 난수. 여기서 'schedule', 'schedule/2', …를 갈라 쓴다 */
  rng: Rng;
}

/** 한 팀이 원정 연전을 연달아 하는 최대 횟수 (임시값, 기획안 3.2 4번) */
export const MAX_AWAY_RUN = 3;
/** 검사에 실패했을 때 다시 만드는 최대 횟수 (기획안 3.2 7번) */
const MAX_ATTEMPTS = 20;
/** 잔여 경기 발표일: 규칙 표의 날짜와 본 일정 마지막 3주 전 중 늦은 날 (임시값, 기획안 3.2 6번) */
const REMAINING_LEAD_DAYS = 21;

/** 2023~ 격년 홈 73경기 구단 (조사값, 기획안 2.2): 홀수 해 / 짝수 해. 계보 이름 */
const HOME_HEAVY_ODD = ['두산', '롯데', 'SSG', 'KT', '한화'];
const HOME_HEAVY_EVEN = ['LG', 'KIA', '삼성', 'NC', '히어로즈'];

/** 연전 생성기가 만드는 틀 */
const SUPPORTED_FRAMES = ['W82', 'W83', 'T3W2', 'S2', 'S33', 'S33-99', 'S33-9', 'S33L2', 'S33F'];
/**
 * W82·W83의 목요일(주중 셋째 날)을 열 때 맞추는 날: 참고 종료일보다 이만큼 앞에 본 일정이 끝나게 (임시값).
 * 남는 날은 우천 순연(7단계) 몫이다. 연전 해(S33)도 본 일정이 실제보다 2~4주 이르게 끝난다
 */
const EXTRA_DAY_MARGIN = 14;

interface Slot {
  day: number;
  len: number;
  /** 어린이날 월요일이 붙은 주말 칸 (금~월). 개막 2연전 라운드의 짝으로 쓰지 않는다 */
  holiday?: boolean;
}

const isMonday = (d: string) => weekdayOf(d) === 1;
const isChildrensDayMonday = (d: string) => d.slice(5) === '05-05' && isMonday(d);

/** 경기를 둘 수 있는 날: 월요일(어린이날 월요일 빼고)과 쉬는 기간이 아닌 날 */
function playable(rule: Pick<YearScheduleRule, 'breaks'>, d: string): boolean {
  if (isMonday(d) && !isChildrensDayMonday(d)) return false;
  return !rule.breaks.some((b) => b.from <= d && d <= b.to);
}

/**
 * 1. 달력 칸 (S33·S33F): 주중 화~목, 주말 금~일 칸. 어린이날 월요일은 앞 주말 칸에 붙는다.
 * 쉬는 기간에 잘린 조각은 이어진 조각끼리 따로 칸이 되고, 하루짜리 조각은 바로 붙은 칸과 합친다 (4일까지):
 * 올스타 휴식이 수요일에 끝나면 목요일 + 금~일 = 4연전 (S33F "올스타 뒤 목~일 4연전").
 * 개막이 토요일이면 첫 칸은 토·일 2연전, 금요일이면 금~일 3연전이 된다.
 */
export function buildSlots(rule: YearScheduleRule, horizon = 260): Slot[] {
  // 날짜마다 칸 묶음 번호: 화~목은 주중, 금~일(+어린이날 월요일)은 주말
  const segOf = (i: number): number => {
    const d = addDays(rule.opening, i);
    const w = weekdayOf(d);
    const week = Math.floor(daysBetween('1970-01-06', d) / 7); // 1970-01-06은 화요일: 화요일마다 새 주, 월요일은 지난 주말 묶음
    return w >= 2 && w <= 4 ? week * 2 : week * 2 + 1;
  };
  const pieces: Slot[] = [];
  let cur: Slot | null = null;
  let curSeg = -1;
  for (let i = 0; i < horizon; i++) {
    const d = addDays(rule.opening, i);
    if (!playable(rule, d)) {
      cur = null;
      continue;
    }
    const seg = segOf(i);
    if (cur && seg === curSeg && cur.day + cur.len === i) cur.len++;
    else {
      cur = { day: i, len: 1 };
      curSeg = seg;
      pieces.push(cur);
    }
  }
  // 하루짜리 조각을 바로 붙은 칸과 합친다 (뒤 칸이 먼저, 4일까지)
  const out: Slot[] = [];
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k];
    const next = pieces[k + 1];
    const prev = out[out.length - 1];
    if (p.len === 1 && next && next.day === p.day + 1 && next.len + 1 <= 4) {
      next.day = p.day;
      next.len++;
      continue;
    }
    if (p.len === 1 && prev && prev.day + prev.len === p.day && prev.len + 1 <= 4) {
      prev.len++;
      continue;
    }
    out.push({ ...p });
  }
  for (const s of out) {
    for (let i = 0; i < s.len; i++) if (isChildrensDayMonday(addDays(rule.opening, s.day + i))) s.holiday = true;
  }
  return out;
}

/** 화요일마다 새 주 (월요일은 지난 주 끝). 1970-01-06은 화요일 */
const weekOf = (d: string) => Math.floor(daysBetween('1970-01-06', d) / 7);

/**
 * 경기 둘 수 있는 날을 요일 묶음(part)끼리 이어 붙인 칸. part가 null인 요일은 경기가 없다.
 * 쉬는 기간에 잘린 조각은 그대로 짧은 칸이 된다 (S33처럼 이웃 칸과 합치지 않는다)
 */
function weekPieces(rule: YearScheduleRule, part: (d: string) => string | null, horizon = 260): Slot[] {
  const out: Slot[] = [];
  let cur: Slot | null = null;
  let curSeg = '';
  for (let i = 0; i < horizon; i++) {
    const d = addDays(rule.opening, i);
    const p = playable(rule, d) ? part(d) : null;
    if (p === null) {
      cur = null;
      continue;
    }
    const seg = `${weekOf(d)}/${p}`;
    if (cur && seg === curSeg && cur.day + cur.len === i) cur.len++;
    else {
      cur = { day: i, len: 1 };
      curSeg = seg;
      out.push(cur);
    }
  }
  return out;
}

/**
 * 틀의 달력 칸과 라운드 배정 방식 (기획안 2.1).
 * counts가 있으면 라운드(= 상대별 연전 구성)마다 칸 길이별 개수를 맞춘다 (T3W2 3×4 + 2×4, S2 2×9, S33-9 3×4 + 2×2).
 * 없으면 라운드마다 경기 수(상대별 경기)를 칸으로 채운다 (S33·S33F, 주중 길이가 섞이는 W82·W83).
 * unit: 경기 수 방식에서 남은 자리가 이 배수로 남는 라운드를 고른다 (S33 3연전, W83 2연전). minLen: 이보다 짧게 남은 자리는 잔여 경기로
 */
interface FrameShape {
  slots: Slot[];
  counts?: Map<number, number>;
  unit: number;
  minLen: number;
}

/** 라운드마다 3연전 4개 + 나머지 2연전 (T3W2 20·22차전, S33-9 16차전) */
function threeTwo(vs: number): Map<number, number> {
  if (vs < 12 || vs % 2 !== 0) throw new Error(`일정 생성기: 상대별 ${vs}경기는 3연전 4개 + 2연전으로 나눌 수 없음`);
  return new Map([[3, 4], [2, (vs - 12) / 2]]);
}

/** 칸 길이별 개수 방식: 칸을 날짜 순으로 쓸 때 본 일정이 끝나는 날 (다 채우지 못하면 Infinity). assignCounts의 합계판 */
function countsEnd(slots: Slot[], total: Map<number, number>): number {
  const left = new Map(total);
  let end = -1;
  for (const s of slots) {
    if ([...left.values()].every((v) => v <= 0)) break;
    const len = [...left.keys()].filter((l) => l <= s.len && left.get(l)! > 0).sort((a, b) => b - a)[0];
    if (len === undefined) continue;
    left.set(len, left.get(len)! - 1);
    end = s.day + len - 1;
  }
  return [...left.values()].every((v) => v <= 0) ? end : Infinity;
}

/**
 * W82·W83: 주중 셋째 날(목요일)은 기본으로 쉬고, 본 일정이 참고 종료일 − EXTRA_DAY_MARGIN 안에 끝나도록 모자란 만큼 앞에서부터 연다
 * (임시 규칙, 기획안 2.1·3.3). 6구단이라 경기일마다 모든 팀이 뛰므로 팀당 경기 수 = 경기일 수다.
 * even이면 연 목요일 수를 짝수로 (3연전이 라운드마다 짝으로 들어가 상대별 홈 반반이 되게)
 */
function openedThursdays(rule: YearScheduleRule, base: number[], horizon: number, even: boolean): Set<string> {
  const extras: string[] = [];
  let have = 0;
  const target = rule.endRef ? addDays(rule.endRef, -EXTRA_DAY_MARGIN) : null;
  for (let i = 0; i < horizon; i++) {
    const d = addDays(rule.opening, i);
    if (!playable(rule, d)) continue;
    const w = weekdayOf(d);
    if (base.includes(w) && (!target || d <= target)) have++;
    if (w === 4 && playable(rule, addDays(d, -1)) && i > 0) extras.push(d);
  }
  let k = target ? Math.max(0, rule.games - have) : 0;
  if (even && k % 2 === 1) k++;
  return new Set(extras.slice(0, k));
}

function frameShape(rule: YearScheduleRule, horizon = 260, rng?: Rng, total?: Map<number, number>): FrameShape {
  const w = (d: string) => weekdayOf(d);
  switch (rule.frame) {
    case 'W82': {
      // 수 단발(목이 열리면 수·목 2연전) + 토·일 2연전
      const open = openedThursdays(rule, [3, 6, 0], horizon, false);
      const slots = weekPieces(rule, (d) => (w(d) === 3 || (w(d) === 4 && open.has(d)) ? 'm' : w(d) === 6 || w(d) === 0 ? 'e' : null), horizon);
      return { slots, unit: 1, minLen: 1 };
    }
    case 'W83': {
      // 주중 화·수 2연전(목이 열리면 화~목 3연전) + 토·일 2연전. 금요일은 쉰다
      const open = openedThursdays(rule, [2, 3, 6, 0], horizon, true);
      const slots = weekPieces(rule, (d) => (w(d) === 2 || w(d) === 3 || (w(d) === 4 && open.has(d)) ? 'm' : w(d) === 6 || w(d) === 0 ? 'e' : null), horizon);
      return { slots, unit: 2, minLen: 1 };
    }
    case 'T3W2':
      // 화~목 3연전 + 토·일 2연전, 금요일 이동일
      return { slots: weekPieces(rule, (d) => (w(d) >= 2 && w(d) <= 4 ? 'm' : w(d) === 6 || w(d) === 0 ? 'e' : null), horizon), counts: threeTwo(rule.vs), unit: 1, minLen: 1 };
    case 'S2':
      // 화·수 / 목·금 / 토·일 2연전 (7구단이라 칸마다 한 팀이 쉰다)
      return { slots: weekPieces(rule, (d) => (w(d) === 2 || w(d) === 3 ? 'a' : w(d) === 4 || w(d) === 5 ? 'b' : 'c'), horizon), counts: new Map([[2, rule.vs / 2]]), unit: 1, minLen: 1 };
    case 'S33-9':
      return s339Shape(rule, horizon);
    case 'S33L2':
      return s33l2Shape(rule, horizon);
    case 'S33-99':
      return s3399Shape(rule, horizon, total!, rng!);
    default:
      return { slots: buildSlots(rule, horizon), unit: 3, minLen: 3 };
  }
}

/**
 * S33-9 (2013~2014, 9구단): 화~목 / 금~일 3연전에 2연전 주(화·수 / 목·금 / 토·일)를 섞는다. 상대별 3×4 + 2×2.
 * 2연전 주는 올스타 휴식 뒤 첫 온전한 주(화~일 모두 경기 가능)부터 이어서, 본 일정이 가장 일찍 끝나는 만큼만 (임시 규칙.
 * 조사값에 2연전 시기가 없다). 개막 토·일 2연전처럼 쉬는 기간에 잘린 2일 칸도 2연전으로 쓴다
 */
function s339Shape(rule: YearScheduleRule, horizon: number): FrameShape {
  const counts = threeTwo(rule.vs);
  const rounds = (rule.teams ?? 9) % 2 === 0 ? (rule.teams ?? 9) - 1 : rule.teams ?? 9;
  const total = new Map([...counts].map(([l, c]) => [l, c * rounds]));
  const fullWeeks = fullWeeksAfterAllStar(rule, horizon);
  const build = (two: Set<number>) => twoWeekPieces(rule, two, horizon);
  let best = { slots: build(new Set()), end: Infinity };
  best.end = countsEnd(best.slots, total);
  for (let c = 1; c <= fullWeeks.length; c++) {
    const slots = build(new Set(fullWeeks.slice(0, c)));
    const end = countsEnd(slots, total);
    if (end < best.end) best = { slots, end };
  }
  return { slots: best.slots, counts, unit: 1, minLen: 1 };
}

/**
 * S33L2 (2015~2022, 10구단): 2연전 시작일(규칙 표, 해마다 실제 날짜) 전은 3연전 주(화~목 / 금~일), 그날부터는 2연전 주
 * (화·수 / 목·금 / 토·일). 상대별 3×4 + 2×2 (사용자 결정: 상대별 구성을 지킨다).
 * 2연전기 끝: 규칙 표에 끝 날이 있으면(2020) 그날까지. 없으면 2연전 칸이 다 찬 날까지 — 3연전기에 3연전 칸이 모자란 해
 * (2015·2019·2021·2022: 개막 토·일 2연전, 쉬는 기간)는 그 뒤 남은 3연전을 다시 3연전 주에 놓는다 (임시 규칙. 2016·2021·2022
 * 실제 일정도 시즌 끝에 3일 연전이 섞인다). 3연전 칸이 모자라지 않으면 본 일정 끝까지 2연전.
 * 2연전이 토요일에 시작하는 해(2018·2019·2021·2022)는 앞 금요일이 하루짜리 칸이 되어 비운다 (2018·2019 실제 휴식·예비일과 같다).
 * 개막 토·일처럼 쉬는 기간에 잘린 2일 칸은 3연전기에도 2연전으로 쓴다
 */
function s33l2Shape(rule: YearScheduleRule, horizon: number): FrameShape {
  const from = rule.twoGameFrom;
  if (!from || from === 'allStar') throw new Error(`일정 생성기: ${rule.year}년 S33L2 규칙에 2연전 시작일이 없음`);
  const counts = threeTwo(rule.vs);
  const rounds = (rule.teams ?? 10) % 2 === 0 ? (rule.teams ?? 10) - 1 : rule.teams ?? 10;
  const need3 = counts.get(3)! * rounds;
  const need2 = counts.get(2)! * rounds;
  const build = (to?: string) => weekPieces(rule, (d) => {
    const wd = weekdayOf(d);
    if (from <= d && (!to || d <= to)) return wd === 2 || wd === 3 ? 'x' : wd === 4 || wd === 5 ? 'y' : 'z';
    return wd >= 2 && wd <= 4 ? 'a' : 'b';
  }, horizon);
  let slots = build(rule.twoGameTo);
  if (!rule.twoGameTo) {
    // 날짜 순으로 칸을 쓸 때 2연전 칸이 다 차는 날 (3연전기의 2일 칸도 2연전으로 센다)
    let three = 0;
    let two = 0;
    for (const s of slots) {
      const pre = addDays(rule.opening, s.day) < from;
      if (pre && s.len >= 3) three = Math.min(need3, three + 1);
      else if (s.len >= 2) two++;
      if (two >= need2) {
        if (three < need3) slots = build(addDays(rule.opening, s.day + s.len - 1));
        break;
      }
    }
  }
  return { slots, counts, unit: 1, minLen: 1 };
}

/** 3연전 주(화~목 / 금~일)에서 two의 주만 2연전 주(화·수 / 목·금 / 토·일)로 바꾼 달력 칸 (S33-9·S33-99) */
function twoWeekPieces(rule: YearScheduleRule, two: Set<number>, horizon: number): Slot[] {
  return weekPieces(rule, (d) => {
    const wd = weekdayOf(d);
    if (two.has(weekOf(d))) return wd === 2 || wd === 3 ? 'a' : wd === 4 || wd === 5 ? 'b' : 'c';
    return wd >= 2 && wd <= 4 ? 'a' : 'b';
  }, horizon);
}

/** 올스타 휴식 뒤의 온전한 주(화~일 모두 경기 가능): 2연전 주 후보 */
function fullWeeksAfterAllStar(rule: YearScheduleRule, horizon: number): number[] {
  const allStar = rule.breaks.find((b) => b.reason === '올스타');
  const out: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const d = addDays(rule.opening, i);
    if (weekdayOf(d) !== 2 || (allStar && d <= allStar.to)) continue;
    if (Array.from({ length: 6 }, (_, k) => addDays(d, k)).every((x) => playable(rule, x))) out.push(weekOf(d));
  }
  return out;
}

/** S33-99 2연전 주 수 (같은 리그 라운드 3개 × 2연전 4번 = 2연전 칸 12 = 4주, 기획안 10.3) */
const S3399_TWO_WEEKS = 4;

/**
 * S33-99 (1999 드림·매직 양대 리그, 기획안 10.3): 전반기(올스타 전)는 3연전 주(화~목 / 금~일)만, 개막 토·일은 같은 리그 2연전 라운드 하나.
 * 후반기에 2연전 주(화·수 / 목·금 / 토·일) 4주: 본 일정 마지막 14일에 걸치는 주는 모두 2연전 주로 이어 두고(조사값, 다른 리그 경기가
 * 약 2주 먼저 끝난다), 나머지는 그 앞 후반기 주 가운데 시드로 고른다 (임시 규칙). 3연전 칸이 모두 차는 가장 이른 주까지 쓴다.
 * 1999는 후반기 경기일(3연전 7칸 + 2연전 11칸 = 43일)이 6일짜리 주로 나뉘지 않아, 마지막 3연전 주의 금~일 칸이 2연전(금·토)으로 줄고
 * 본 일정이 마지막 주 화·수 2연전으로 끝난다 (개막 토·일 2연전을 같은 리그 라운드로 세므로 2연전 칸이 남는다)
 */
function s3399Shape(rule: YearScheduleRule, horizon: number, total: Map<number, number>, rng: Rng): FrameShape {
  const weeks = fullWeeksAfterAllStar(rule, horizon);
  // 라운드별 구성은 tryBuild가 assignCounts에 따로 준다 (divisionCounts). 여기 counts는 "칸 길이별 개수 방식"이라는 표시
  const counts = new Map(total);
  // 3연전 칸이 모자라지 않는 가장 적은 후반기 3연전 주 수 (2연전 주를 어디에 두든 칸 수와 끝나는 날은 같다)
  for (let c3 = 0; c3 + S3399_TWO_WEEKS <= weeks.length; c3++) {
    const used = weeks.slice(0, c3 + S3399_TWO_WEEKS);
    const lastSunday = daysBetween(rule.opening, addDays('1970-01-06', used[used.length - 1] * 7 + 5));
    const end = countsEnd(twoWeekPieces(rule, new Set(used.slice(-S3399_TWO_WEEKS)), horizon), total);
    if (end > lastSunday) continue;
    // 본 일정 끝에서 14일(마지막 2주)에 걸치는 주
    const from = weekOf(addDays(rule.opening, end - 13));
    const tail = used.filter((w) => w >= from).slice(-S3399_TWO_WEEKS);
    const head = used.filter((w) => !tail.includes(w));
    const mid = rng.shuffle([...head]).slice(0, Math.max(0, S3399_TWO_WEEKS - tail.length));
    return { slots: twoWeekPieces(rule, new Set([...mid, ...tail]), horizon), counts, unit: 1, minLen: 1 };
  }
  return { slots: twoWeekPieces(rule, new Set(), horizon), counts, unit: 1, minLen: 1 }; // 칸이 모자람 → tryBuild가 걸러 낸다
}

/**
 * 2. 칸 길이별 개수 방식: 칸을 날짜 순으로, 그 길이가 남은 라운드에 (덜 쓴 라운드부터, 바로 앞 칸과 다른 라운드로).
 * 그 길이가 남은 라운드가 없으면 더 짧은 길이로 줄여 쓰고(앞쪽 날만), 그것도 없으면 칸을 비운다
 */
function assignCounts(slots: Slot[], rounds: number, counts: Map<number, number> | Map<number, number>[], rng: Rng, openingRound: number | null) {
  // 라운드마다 같은 구성, 또는 라운드별 구성 (S33-99: 같은 리그 3×4 + 2×4, 다른 리그 3×6)
  const need = Array.from({ length: rounds }, (_, r) => new Map(Array.isArray(counts) ? counts[r] : counts));
  const used = new Array<number>(rounds).fill(0);
  const prio: number[][] = [];
  const prioOf = (c: number, r: number) => {
    while (prio.length <= c) prio.push(rng.shuffle(Array.from({ length: rounds }, (_, i) => i)));
    return prio[c].indexOf(r);
  };
  const lens = [...new Set(need.flatMap((m) => [...m.keys()]))].sort((a, b) => b - a);
  const out: { slot: Slot; round: number }[] = [];
  let prev = -1;
  for (const s0 of slots) {
    if (need.every((m) => [...m.values()].every((v) => v <= 0))) break;
    let pick = -1;
    let len = 0;
    for (const l of lens.filter((x) => x <= s0.len)) {
      const cand = Array.from({ length: rounds }, (_, i) => i).filter((r) => (need[r].get(l) ?? 0) > 0);
      if (!cand.length) continue;
      const score = (r: number) => [out.length === 0 && openingRound !== null ? (r === openingRound ? 0 : 1) : 0, r === prev ? 1 : 0, used[r], prioOf(used[r], r)];
      cand.sort((x, y) => {
        const a = score(x);
        const b = score(y);
        for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k];
        return 0;
      });
      pick = cand[0];
      len = l;
      break;
    }
    if (pick < 0) continue;
    need[pick].set(len, need[pick].get(len)! - 1);
    used[pick]++;
    prev = pick;
    out.push({ slot: { ...s0, len }, round: pick });
  }
  const cap = need.map((m) => [...m].reduce((a, [l, c]) => a + l * c, 0));
  return { placed: out, cap };
}

/** 원형 대진의 라운드 (구단 수가 홀수면 쉬는 팀이 있다). ring은 자리 → 구단 */
function roundRobin(ring: number[]): [number, number][][] {
  const r = [...ring];
  if (r.length % 2 === 1) r.push(-1);
  const m = r.length;
  const rounds: [number, number][][] = [];
  for (let k = 0; k < m - 1; k++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = r[i];
      const b = r[m - 1 - i];
      if (a >= 0 && b >= 0) pairs.push([a, b]);
    }
    rounds.push(pairs);
    r.splice(1, 0, r.pop()!);
  }
  return rounds;
}

/**
 * S33-99 라운드 (기획안 10.3): 같은 리그 라운드(두 리그가 같은 날 리그 안 원형 대진, 4팀이면 3라운드)와
 * 다른 리그 라운드(드림 × 매직 교차, 4라운드). 같은 리그 라운드가 앞, 다른 리그 라운드가 뒤
 */
function divisionRounds(divs: [number[], number[]], rng: Rng): { rounds: [number, number][][]; same: number } {
  const a = rng.shuffle([...divs[0]]);
  const b = rng.shuffle([...divs[1]]);
  const ra = roundRobin(a);
  const rb = roundRobin(b);
  const same = ra.map((r, k) => [...r, ...rb[k]]);
  const cross = b.map((_, k) => a.map((t, i) => [t, b[(i + k) % b.length]] as [number, number]));
  return { rounds: [...same, ...cross], same: same.length };
}

/** 두 리그의 구단 수가 같고 모든 구단을 한 번씩 담은 양대 리그 나눔인가 (S33-99가 쓸 수 있는 나눔) */
function evenDivisions(divs: [number[], number[]] | undefined, n: number): divs is [number[], number[]] {
  return !!divs && divs[0].length === divs[1].length && divs[0].length * 2 === n && new Set([...divs[0], ...divs[1]]).size === n;
}

/** S33-99 라운드 구성: 같은 리그 라운드는 3연전 4개 + 2연전 (20차전), 다른 리그 라운드는 3연전만 (18차전 = 3×6) */
function divisionCounts(rule: YearScheduleRule, same: number, rounds: number): Map<number, number>[] {
  const other = rule.vsOther ?? rule.vs;
  if (other % 3 !== 0) throw new Error(`일정 생성기: 다른 리그 상대별 ${other}경기는 3연전으로 나눌 수 없음`);
  return Array.from({ length: rounds }, (_, r) => (r < same ? threeTwo(rule.vs) : new Map([[3, other / 3]])));
}

/** 상대별 남는 홈 경기를 더 받는 구단 (19차전 해 홈 67, 2023~ 홈 73). 기획안 2.2 */
export function homeHeavyTeams(rule: YearScheduleRule, n: number, franchises?: string[], divisions?: [number[], number[]]): number[] {
  const need = Math.floor(n / 2);
  const all = Array.from({ length: n }, (_, i) => i);
  let picked: number[] = [];
  if (rule.frame === 'S33F' && franchises) {
    const names = rule.year % 2 === 1 ? HOME_HEAVY_ODD : HOME_HEAVY_EVEN;
    picked = all.filter((i) => names.includes(franchises[i])).slice(0, need);
  }
  // 그 밖(19차전 해, 모르는 계보만 남은 자리)은 연도 홀짝과 색인으로 (임시 규칙)
  const parity = (a: number, b: number) => ((a + rule.year) % 2) - ((b + rule.year) % 2) || a - b;
  const rest = all.filter((i) => !picked.includes(i)).sort(parity);
  for (const t of rest) if (picked.length < need) picked.push(t);
  // 양대 리그 해(2000)는 리그마다 절반이 더 받게: 홀짝 규칙이 리그마다 절반이 아니면 리그 안에서 같은 규칙으로 다시 고른다
  // (임시 규칙, 기획안 10.3. 실제 2000은 리그마다 두 팀이 홈 67)
  if (rule.frame !== 'S33F' && evenDivisions(divisions, n) && divisions.some((d) => d.filter((t) => picked.includes(t)).length !== d.length / 2)) {
    picked = divisions.flatMap((d) => [...d].sort(parity).slice(0, d.length / 2));
  }
  return picked.sort((a, b) => a - b);
}

/**
 * 상대별 홈 경기 목표 home[a][b] (a가 b를 홈에서 맞는 경기 수). 기획안 2.2:
 * 짝수 차전은 반반, 홀수 차전(19)은 10·9, S33F(16 = 15 + 잔여 1)는 9·7. 더 받는 쪽은 많은 쪽 구단(heavy)이
 * 상대 절반 남짓에게서 받도록 원형으로 정한다 → heavy 구단 팀당 홈이 하나씩(S33F는 둘씩) 많다.
 */
function homeTargets(rule: YearScheduleRule, n: number, heavy: number[], divisions?: [number[], number[]]): number[][] {
  const vs = rule.vs;
  if (rule.frame === 'S33-99' && evenDivisions(divisions, n)) {
    // 1999: 같은 리그 20차전 홈 10·10, 다른 리그 18차전 홈 9·9 (팀당 66·66, 시즌 자료와 같다)
    const lg = new Array<number>(n);
    divisions.forEach((d, k) => d.forEach((t) => { lg[t] = k; }));
    return Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => (a === b ? 0 : (lg[a] === lg[b] ? vs : rule.vsOther ?? vs) / 2)));
  }
  // S33F 짝수 차전은 9·7 (2 차이), 홀수 차전(구단 수가 바뀐 월드)은 1 차이. S2 2연전 홀수 개(18차전 = 2×9)는 2연전 하나 차이 = 10·8
  const skew = rule.frame === 'S33F' ? 2 - (vs % 2) : rule.frame === 'S2' ? ((vs / 2) % 2) * 2 : vs % 2;
  const t = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const light = Array.from({ length: n }, (_, i) => i).filter((i) => !heavy.includes(i));
  const ring = [...heavy, ...light];
  const half = n / 2;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = ring[i];
      const b = ring[j];
      const d = j - i;
      // 원형으로 앞 절반 상대에게 더 받고, 맞은편(n/2 차이)은 heavy 쪽이 받는다
      const aGets = skew === 0 ? false : (n % 2 === 0 && d === half ? true : d < half);
      const big = (vs + skew) / 2;
      const small = (vs - skew) / 2;
      t[a][b] = skew === 0 ? vs / 2 : aGets ? big : small;
      t[b][a] = vs - t[a][b];
    }
  }
  return t;
}

/**
 * 2. 라운드를 칸에 놓는다. 라운드마다 남은 자리(cap)를 넘지 않게, 덜 쓴 라운드부터 (바퀴), 바로 앞 칸과 다른 라운드로.
 * 3일이 아닌 칸(개막 2연전, 올스타 뒤 4연전)은 남은 자리가 3의 배수가 되는 라운드에: 개막 2연전 라운드가 4연전을 받아
 * 2 + 4 = 3연전 두 개 몫이 된다 (S33F). 어린이날 월요일이 붙은 4일 칸은 이 짝에서 빠진다 (올스타 뒤 4연전이 짝이 되게, 임시 규칙).
 */
function assignRounds(slots: Slot[], rounds: number, cap0: number, rng: Rng, openingRound: number | null, unit = 3, minLen = 3) {
  const cap = new Array<number>(rounds).fill(cap0);
  const used = new Array<number>(rounds).fill(0);
  const prio: number[][] = [];
  const prioOf = (c: number, r: number) => {
    while (prio.length <= c) prio.push(rng.shuffle(Array.from({ length: rounds }, (_, i) => i)));
    return prio[c].indexOf(r);
  };
  const out: { slot: Slot; round: number }[] = [];
  let prev = -1;
  for (const s0 of slots) {
    if (cap.every((c) => c < minLen)) break;
    const slot = { ...s0 };
    let pick = -1;
    for (;;) {
      const cand = Array.from({ length: rounds }, (_, i) => i).filter((r) => cap[r] >= slot.len);
      if (cand.length) {
        const score = (r: number) => [
          out.length === 0 && openingRound !== null ? (r === openingRound ? 0 : 1) : 0,
          slot.len % unit !== 0 && !slot.holiday && (cap[r] - slot.len) % unit !== 0 ? 1 : 0,
          r === prev ? 1 : 0,
          used[r],
          prioOf(used[r], r),
        ];
        cand.sort((x, y) => {
          const a = score(x);
          const b = score(y);
          for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k];
          return 0;
        });
        pick = cand[0];
        break;
      }
      if (slot.len <= 1) break;
      slot.len--; // 남은 자리보다 긴 칸은 앞쪽만 쓴다
    }
    if (pick < 0) continue;
    cap[pick] -= slot.len;
    used[pick]++;
    prev = pick;
    out.push({ slot, round: pick });
  }
  return { placed: out, cap };
}

/** 팀의 원정 연전이 MAX_AWAY_RUN을 넘는 몫의 합 */
function awayExcess(series: PlanSeries[], t: number): number {
  let run = 0;
  let over = 0;
  for (const s of series) {
    if (s.away === t) over += ++run > MAX_AWAY_RUN ? 1 : 0;
    else if (s.home === t) run = 0;
  }
  return over;
}

/**
 * 원정 연전 연속 한도 고치기: 같은 상대·같은 길이의 연전 두 개의 홈을 맞바꾼다 (상대별 홈 수는 그대로).
 * 넘는 몫이 줄어드는 맞바꿈만 받는다. fixedDay에 시작하는 연전(개막 홈 구단이 정해진 개막 연전)은 건드리지 않는다. 다 고치면 true
 */
function fixAwayRuns(series: PlanSeries[], n: number, rng: Rng, fixedDay: number): boolean {
  const over = Array.from({ length: n }, (_, t) => awayExcess(series, t));
  const byPair = new Map<number, number[]>();
  series.forEach((s, i) => {
    const k = Math.min(s.home, s.away) * n + Math.max(s.home, s.away);
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k)!.push(i);
  });
  for (let guard = 0; guard < 2000; guard++) {
    const bad = over.map((v, t) => (v > 0 ? t : -1)).filter((t) => t >= 0);
    if (!bad.length) return true;
    const t = bad[rng.int(bad.length)];
    let improved = false;
    // t가 원정인 연전과, 같은 상대에게 t가 홈인 같은 길이 연전을 맞바꾼다
    const mine = rng.shuffle(series.map((s, i) => (s.away === t ? i : -1)).filter((i) => i >= 0));
    for (const i of mine) {
      const o = series[i].home;
      const k = Math.min(t, o) * n + Math.max(t, o);
      for (const j of byPair.get(k)!) {
        if (j === i || series[j].home !== t || series[j].len !== series[i].len) continue;
        if (series[i].day === fixedDay || series[j].day === fixedDay) continue; // 개막 홈은 그대로
        const swap = () => {
          for (const x of [i, j]) [series[x].home, series[x].away] = [series[x].away, series[x].home];
        };
        swap();
        const nt = awayExcess(series, t);
        const no = awayExcess(series, o);
        if (nt + no < over[t] + over[o]) {
          over[t] = nt;
          over[o] = no;
          improved = true;
          break;
        }
        swap();
      }
      if (improved) break;
    }
    if (!improved) return false;
  }
  return false;
}

/** 일정 한 벌을 만든다. 검사에 걸리면 그 이유 (문자열) */
function tryBuild(input: ScheduleInput, rng: Rng, attempt: number): SchedulePlan | string {
  const { rule, teams: n } = input;
  const u = Math.round(rule.unscheduled / (n - 1)); // 상대별로 잔여 경기로 미루는 경기
  const perRound = rule.vs - u;

  // 대진 자리: 개막 홈 구단이 있으면 첫 라운드에서 홈 구단끼리 만나지 않게 앞 절반에 둔다
  const hosts = input.openingHosts ?? [];
  const others = rng.shuffle(Array.from({ length: n }, (_, i) => i).filter((i) => !hosts.includes(i)));
  const ring = [...rng.shuffle([...hosts]), ...others];
  // S33-99는 같은 리그·다른 리그 라운드 (라운드마다 연전 구성이 다르다)
  const div = rule.frame === 'S33-99' ? divisionRounds(input.divisions!, rng) : null;
  const rounds = div ? div.rounds : roundRobin(ring);
  const divCounts = div ? divisionCounts(rule, div.same, rounds.length) : null;
  const total = new Map<number, number>();
  for (const c of divCounts ?? []) for (const [l, k] of c) total.set(l, (total.get(l) ?? 0) + k);
  const shape = div ? frameShape(rule, 260, rng.fork('two-weeks'), total) : frameShape(rule);
  const { placed, cap } = shape.counts
    ? assignCounts(shape.slots, rounds.length, divCounts ?? shape.counts, rng, hosts.length ? 0 : null)
    : assignRounds(shape.slots, rounds.length, perRound, rng, hosts.length ? 0 : null, shape.unit, shape.minLen);
  if (cap.some((c) => c >= shape.minLen)) return '달력 칸이 모자람';

  // 상대별 연전 목록 (시간 순)
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const blocks = new Map<number, { idx: number; len: number }[]>();
  const series: (PlanSeries & { round: number })[] = [];
  placed.forEach(({ slot, round }) => {
    for (const [a, b] of rounds[round]) {
      const k = key(a, b);
      if (!blocks.has(k)) blocks.set(k, []);
      blocks.get(k)!.push({ idx: series.length, len: slot.len });
      series.push({ day: slot.day, len: slot.len, home: a, away: b, round });
    }
  });

  // 4. 홈·원정: 시간 순으로 연전마다 홈을 정한다. 상대별 홈 목표를 넘지 않고 남은 연전으로 목표를 채울 수 있어야 한다
  const heavy = homeHeavyTeams(rule, n, input.franchises, input.divisions);
  const target = homeTargets(rule, n, heavy, input.divisions);
  const homeSoFar = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const pos = new Map<number, number>(); // 상대별 몇 번째 연전까지 정했는지
  const lastHome = new Map<number, number>();
  const awayRun = new Array<number>(n).fill(0);
  const homeRun = new Array<number>(n).fill(0);
  // 남은 연전 길이들로 a·b 홈 몫을 각각 목표 안에 나눌 수 있는지 (부분합)
  const fits = (lens: number[], roomA: number, roomB: number) => {
    const total = lens.reduce((x, y) => x + y, 0);
    let reach = new Set<number>([0]);
    for (const l of lens) reach = new Set([...reach, ...[...reach].map((x) => x + l)]);
    for (const h of reach) if (h <= roomA && total - h <= roomB) return true;
    return false;
  };
  const byDay = new Map<number, number[]>();
  series.forEach((s, i) => {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day)!.push(i);
  });
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const today = rng.shuffle([...byDay.get(day)!]);
    for (const i of today) {
      const s = series[i];
      const [a, b] = [s.home, s.away];
      const k = key(a, b);
      const list = blocks.get(k)!;
      const p = pos.get(k) ?? 0;
      const rest = list.slice(p + 1).map((x) => x.len);
      const isOpening = s.day === series[0].day && hosts.length > 0;
      const options: [number, number][] = [[a, b], [b, a]];
      const ok = options.filter(([h, w]) =>
        homeSoFar[h][w] + s.len <= target[h][w] && fits(rest, target[a][b] - homeSoFar[a][b] - (h === a ? s.len : 0), target[b][a] - homeSoFar[b][a] - (h === b ? s.len : 0)));
      if (!ok.length) return `${a} 대 ${b}: 홈 목표를 맞출 수 없음`;
      const score = ([h, w]: [number, number]) => [
        isOpening ? (hosts.includes(h) ? 0 : 1) : 0,
        awayRun[w] >= MAX_AWAY_RUN ? 1 : 0, // 원정 4연속을 만들지 않는다
        awayRun[h] - homeRun[h] < awayRun[w] - homeRun[w] ? 1 : 0, // 원정이 길게 이어진 쪽을 홈으로
        lastHome.has(k) && lastHome.get(k) === h ? 1 : 0, // 같은 상대와 번갈아
      ];
      ok.sort((x, y) => {
        const sx = score(x);
        const sy = score(y);
        for (let q = 0; q < sx.length; q++) if (sx[q] !== sy[q]) return sx[q] - sy[q];
        return 0;
      });
      const [h, w] = ok[0];
      s.home = h;
      s.away = w;
      homeSoFar[h][w] += s.len;
      lastHome.set(k, h);
      pos.set(k, p + 1);
      awayRun[w]++;
      homeRun[w] = 0;
      homeRun[h]++;
      awayRun[h] = 0;
    }
  }

  if (!fixAwayRuns(series, n, rng, hosts.length ? series[0].day : -1)) return `원정 연전 ${MAX_AWAY_RUN + 1}연속을 고치지 못함`;

  // 날짜별 본 일정
  const mainEnd = Math.max(...series.map((s) => s.day + s.len - 1));
  const days: PlanGame[][] = Array.from({ length: mainEnd + 1 }, () => []);
  for (const s of series) for (let d = 0; d < s.len; d++) days[s.day + d].push({ home: s.home, away: s.away });

  // 3. 잔여 경기: 상대별로 모자란 경기를 홈 목표에 맞춰 만들고, 본 일정 뒤 경기 가능한 날에 가장 이르게 놓는다
  const remaining: PlanGame[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      for (let g = homeSoFar[a][b]; g < target[a][b]; g++) remaining.push({ home: a, away: b });
    }
  }
  rng.shuffle(remaining);
  const tail: PlanGame[][] = [];
  const busy: Set<number>[] = [];
  for (const g of remaining) {
    for (let i = 0; ; i++) {
      const di = mainEnd + 1 + i;
      if (di > mainEnd + 120) return '잔여 경기를 놓을 날이 없음';
      if (!playable(rule, addDays(rule.opening, di))) continue;
      tail[i] ??= [];
      busy[i] ??= new Set();
      if (busy[i].has(g.home) || busy[i].has(g.away)) continue;
      busy[i].add(g.home);
      busy[i].add(g.away);
      tail[i].push(g);
      break;
    }
  }
  for (let i = 0; i < tail.length; i++) days.push(tail[i] ?? []);
  for (const d of days) d.sort((x, y) => x.home - y.home);

  let remainingFrom = -1;
  const planned = days.map((d) => [...d]);
  if (rule.remainingFrom && remaining.length) {
    remainingFrom = Math.max(daysBetween(rule.opening, rule.remainingFrom), mainEnd - REMAINING_LEAD_DAYS);
    for (let i = mainEnd + 1; i < planned.length; i++) planned[i] = [];
    while (planned.length && planned[planned.length - 1].length === 0) planned.pop();
  }

  const plan: SchedulePlan = {
    opening: rule.opening, days, planned, cancels: [], remainingFrom, held: [],
    series: series.map(({ day, len, home, away }) => ({ day, len, home, away })), mainEnd, attempt,
  };
  const problems = planProblems(plan, input);
  return problems.length ? problems[0] : plan;
}

/** 5. 검사: 상대별 경기 수, 상대별 홈 목표, 하루 한 팀 한 경기, 월요일(어린이날 빼고)·쉬는 기간 경기 없음, 원정 연전 연속 한도.
 * rain이면 날씨를 굴린 일정(weather.ts): 월요일 경기(우천 순연·잔여 경기)와 같은 대진 더블헤더(1·2차전)를 허용한다.
 * 걸린 것을 문장으로 돌려준다 (없으면 빈 배열) */
export function planProblems(plan: SchedulePlan, input: ScheduleInput, opts: { rain?: boolean } = {}): string[] {
  const { rule, teams: n } = input;
  const out: string[] = [];
  const meet = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  plan.days.forEach((games, i) => {
    const d = addDays(rule.opening, i);
    if (games.length && !(opts.rain ? !rule.breaks.some((b) => b.from <= d && d <= b.to) : playable(rule, d))) out.push(`${d}: 경기 없는 날에 경기`);
    const seen = new Set<number>();
    for (const g of games) {
      const dh = opts.rain && g.dh === 2 && games.some((x) => x.dh === 1 && x.home === g.home && x.away === g.away);
      if (!dh && (seen.has(g.home) || seen.has(g.away))) out.push(`${d}: 한 팀이 두 경기`);
      seen.add(g.home);
      seen.add(g.away);
      meet[g.home][g.away]++;
    }
  });
  const heavy = homeHeavyTeams(rule, n, input.franchises, input.divisions);
  const target = homeTargets(rule, n, heavy, input.divisions);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a !== b && meet[a][b] !== target[a][b]) out.push(`${a} 대 ${b}: 홈 ${meet[a][b]}경기 (목표 ${target[a][b]})`);
    }
  }
  for (let t = 0; t < n; t++) {
    let run = 0;
    for (const s of plan.series) {
      if (s.away === t) {
        if (++run > MAX_AWAY_RUN) {
          out.push(`${t}: 원정 연전 ${run}연속 (${addDays(rule.opening, s.day)})`);
          break;
        }
      } else if (s.home === t) run = 0;
    }
  }
  return out;
}

/** 그 해 일정을 만든다. 검사를 통과할 때까지 시드 꼬리를 바꿔 최대 20번 */
export function generatePlan(input: ScheduleInput): SchedulePlan {
  if (!SUPPORTED_FRAMES.includes(input.rule.frame)) throw new Error(`일정 생성기: 아직 만들지 않은 연전 틀 ${input.rule.frame} (${input.rule.year})`);
  if (input.rule.teams !== undefined && input.rule.teams !== input.teams) {
    throw new Error(`일정 생성기: ${input.rule.year}년 규칙은 ${input.rule.teams}구단, 월드는 ${input.teams}구단`);
  }
  if (input.rule.frame === 'S33-99' && !evenDivisions(input.divisions, input.teams)) {
    throw new Error(`일정 생성기: ${input.rule.year}년 양대 리그 틀(S33-99)에 구단 수가 같은 두 리그 나눔이 없음`);
  }
  let why = '';
  for (let k = 1; k <= MAX_ATTEMPTS; k++) {
    const plan = tryBuild(input, input.rng.fork(k === 1 ? 'schedule' : `schedule/${k}`), k);
    if (typeof plan !== 'string') return plan;
    why = plan;
  }
  throw new Error(`일정 생성기: ${input.rule.year}년 일정을 ${MAX_ATTEMPTS}번 만들어도 검사를 통과하지 못함 (마지막: ${why})`);
}

/** 개막 연전 홈 구단을 지난 시즌 순위로 고르는 첫 해 (조사값, 기획안 2.2). 그 전은 시드 */
export const OPENING_HOSTS_FROM = 2015;
/** 잠실을 함께 쓰는 계보: 둘 다 개막 홈 순위 안이면 아래 순위 쪽 대신 다음 순위가 홈 (조사값) */
const JAMSIL = ['LG', '두산'];

/**
 * 개막 연전 홈 구단 (기획안 2.2): 지난 시즌 상위 5팀 (구단 수의 절반까지), 잠실 두 팀이 겹치면 6위가 대신.
 * ranked는 지난 시즌 순위 순 구단 색인 (그 해 월드 색인). 2015년 전이나 순위가 없으면 undefined (시드로 정한다)
 */
export function pickOpeningHosts(year: number, ranked: number[], franchises: string[]): number[] | undefined {
  if (year < OPENING_HOSTS_FROM || ranked.length < 2) return undefined;
  const need = Math.min(5, Math.floor(franchises.length / 2));
  const out: number[] = [];
  let jamsil = false;
  for (const t of ranked) {
    if (out.length >= need) break;
    if (t < 0 || t >= franchises.length || out.includes(t)) continue;
    if (JAMSIL.includes(franchises[t])) {
      if (jamsil) continue;
      jamsil = true;
    }
    out.push(t);
  }
  return out;
}

/** 시즌 자료의 최종 순위를 그 해 월드 구단 색인으로 (계보로 잇는다. 지난 시즌에 없던 구단은 빠진다) */
export function rankedFromSeason(prev: Pick<SeasonData, 'teams'> | undefined, franchises: string[]): number[] {
  if (!prev) return [];
  return [...prev.teams].sort((a, b) => a.rank - b.rank).map((t) => franchises.indexOf(t.franchise)).filter((i) => i >= 0);
}

/**
 * 연전 틀이 아직 없는 해·규칙 표에 맞지 않는 월드: 원형 대진 라운드를 섞어 경기 둘 수 있는 날마다 하나씩 놓는다 (하루 한 경기, 연전 없음).
 * 같은 상대와는 홈·원정을 번갈아. 팀당 경기 수는 games에서 멈춘다 (상대별 경기 수는 조금 어긋날 수 있다)
 */
export function spreadPlan(rule: Pick<YearScheduleRule, 'opening' | 'breaks'>, n: number, games: number, rng: Rng): SchedulePlan {
  const base = roundRobin(Array.from({ length: n }, (_, i) => i));
  const played = new Array<number>(n).fill(0);
  const flip = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const days: PlanGame[][] = [];
  let guard = 0;
  while (played.some((g) => g < games) && guard++ < 10000) {
    for (const pairs of rng.shuffle([...base])) {
      const day: PlanGame[] = [];
      for (const [a, b] of pairs) {
        if (played[a] >= games || played[b] >= games) continue;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const homeIsLo = !flip[lo][hi];
        flip[lo][hi] = homeIsLo;
        day.push(homeIsLo ? { home: lo, away: hi } : { home: hi, away: lo });
        played[a]++;
        played[b]++;
      }
      if (!day.length) continue;
      while (!playable(rule, addDays(rule.opening, days.length))) days.push([]);
      days.push(day.sort((x, y) => x.home - y.home));
    }
  }
  return {
    opening: rule.opening, days, planned: days.map((d) => [...d]), cancels: [], remainingFrom: -1, held: [], series: [], mainEnd: days.length - 1, attempt: 1,
  };
}

/**
 * 이 월드에 연전 생성기(generatePlan)를 쓸 수 있는가: 만든 연전 틀이고 구단 수·팀당 경기 수가 규칙 표와 같다.
 * S33-99(1999)는 구단 수가 같은 두 리그 나눔(World.divisions)이 있어야 한다 (팀당 = 같은 리그 상대 × 20 + 다른 리그 상대 × 18)
 */
export function framedRule(world: Pick<World, 'teams' | 'gamesPerTeam' | 'schedule' | 'divisions'>): YearScheduleRule | undefined {
  const rule = world.schedule;
  const n = world.teams.length;
  if (!rule || !SUPPORTED_FRAMES.includes(rule.frame)) return undefined;
  if ((rule.teams ?? n) !== n || rule.games !== world.gamesPerTeam) return undefined;
  if (rule.frame === 'S33-99') {
    const divs = world.divisions?.teams;
    if (!evenDivisions(divs, n)) return undefined;
    const k = divs[0].length;
    return rule.vs * (k - 1) + (rule.vsOther ?? rule.vs) * k === rule.games ? rule : undefined;
  }
  return rule.vs * (n - 1) === rule.games ? rule : undefined;
}

/**
 * 시즌 일정 (Season이 쓴다). rng는 시즌 뿌리 난수 ('schedule' 줄기를 갈라 쓴다).
 * 일정 규칙이 있는 월드는 날씨를 굴려 우천 취소·순연·더블헤더를 넣는다 ('weather'·'remaining' 줄기, weather.ts). 규칙이 없으면 비가 없다
 */
export function planForWorld(world: Pick<World, 'year' | 'teams' | 'gamesPerTeam' | 'schedule' | 'openingHosts' | 'divisions'>, rng: Rng): SchedulePlan {
  const rule = framedRule(world);
  const base = rule
    ? generatePlan({
      rule, teams: world.teams.length, franchises: world.teams.map((t) => t.franchise), openingHosts: world.openingHosts,
      ...(world.divisions ? { divisions: world.divisions.teams } : {}), rng,
    })
    : spreadPlan(world.schedule ?? { opening: defaultOpening(world.year), breaks: [] }, world.teams.length, world.gamesPerTeam, rng.fork('schedule'));
  if (!world.schedule) return base;
  return applyWeather(base, {
    rule: world.schedule, teams: world.teams.length, parks: world.teams.map((t) => t.franchise), domes: world.teams.map((t) => !!t.dome), rng,
  });
}
