// 연전 단위 정규시즌 일정 생성기 (일정 개편 기획안 3장). 순수 함수이고 난수는 Rng만 쓴다: 같은 시드 = 같은 일정.
// 아직 Season에 연결하지 않았다 (기획안 8장 4단계). 우천·순연(7단계)도 아직 없다.
//
// 만드는 순서 (기획안 3.2):
//  1. 달력 칸: 개막일부터 날짜를 놓고 쉬는 기간·월요일을 빼고, 연전 틀의 요일 규칙으로 날짜를 연전 칸(1~4일)으로 묶는다
//  2. 대진 돌림: 원형 대진의 라운드(모든 팀이 한 상대씩)를 칸마다 하나씩 쓴다. 라운드마다 상대별 경기 수가 같다
//  3. 상대별 맞추기: 라운드가 다 차면 본 일정이 끝나고, 모자란 경기는 잔여 경기로 본 일정 뒤에 놓는다
//  4. 홈·원정: 연전 하나는 한 구장. 상대별 홈 수(2.2)를 지키면서 같은 상대와 번갈아, 원정 연전은 3번 연속까지
//  5. 검사: 어긋나면 시드 꼬리를 바꿔(schedule/2, …) 다시 만든다
import type { YearScheduleRule } from '../data/schedule';
import { addDays, daysBetween, weekdayOf } from '../data/schedule';
import { Rng } from './rng';

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

const SUPPORTED_FRAMES = ['S33', 'S33F'];

interface Slot {
  day: number;
  len: number;
  /** 어린이날 월요일이 붙은 주말 칸 (금~월). 개막 2연전 라운드의 짝으로 쓰지 않는다 */
  holiday?: boolean;
}

const isMonday = (d: string) => weekdayOf(d) === 1;
const isChildrensDayMonday = (d: string) => d.slice(5) === '05-05' && isMonday(d);

/** 경기를 둘 수 있는 날: 월요일(어린이날 월요일 빼고)과 쉬는 기간이 아닌 날 */
function playable(rule: YearScheduleRule, d: string): boolean {
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

/** 상대별 남는 홈 경기를 더 받는 구단 (19차전 해 홈 67, 2023~ 홈 73). 기획안 2.2 */
export function homeHeavyTeams(rule: YearScheduleRule, n: number, franchises?: string[]): number[] {
  const need = Math.floor(n / 2);
  const all = Array.from({ length: n }, (_, i) => i);
  let picked: number[] = [];
  if (rule.frame === 'S33F' && franchises) {
    const names = rule.year % 2 === 1 ? HOME_HEAVY_ODD : HOME_HEAVY_EVEN;
    picked = all.filter((i) => names.includes(franchises[i])).slice(0, need);
  }
  // 그 밖(19차전 해, 모르는 계보만 남은 자리)은 연도 홀짝과 색인으로 (임시 규칙)
  const rest = all.filter((i) => !picked.includes(i)).sort((a, b) => ((a + rule.year) % 2) - ((b + rule.year) % 2) || a - b);
  for (const t of rest) if (picked.length < need) picked.push(t);
  return picked.sort((a, b) => a - b);
}

/**
 * 상대별 홈 경기 목표 home[a][b] (a가 b를 홈에서 맞는 경기 수). 기획안 2.2:
 * 짝수 차전은 반반, 홀수 차전(19)은 10·9, S33F(16 = 15 + 잔여 1)는 9·7. 더 받는 쪽은 많은 쪽 구단(heavy)이
 * 상대 절반 남짓에게서 받도록 원형으로 정한다 → heavy 구단 팀당 홈이 하나씩(S33F는 둘씩) 많다.
 */
function homeTargets(rule: YearScheduleRule, n: number, heavy: number[]): number[][] {
  const vs = rule.vs;
  const skew = rule.frame === 'S33F' ? 2 : vs % 2;
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
function assignRounds(slots: Slot[], rounds: number, cap0: number, rng: Rng, openingRound: number | null) {
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
    if (cap.every((c) => c < 3)) break;
    const slot = { ...s0 };
    let pick = -1;
    for (;;) {
      const cand = Array.from({ length: rounds }, (_, i) => i).filter((r) => cap[r] >= slot.len);
      if (cand.length) {
        const score = (r: number) => [
          out.length === 0 && openingRound !== null ? (r === openingRound ? 0 : 1) : 0,
          slot.len % 3 !== 0 && !slot.holiday && (cap[r] - slot.len) % 3 !== 0 ? 1 : 0,
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
  const rounds = roundRobin(ring);
  const slots = buildSlots(rule);
  const { placed, cap } = assignRounds(slots, rounds.length, perRound, rng, hosts.length ? 0 : null);
  if (cap.some((c) => c >= 3)) return '달력 칸이 모자람';

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
  const heavy = homeHeavyTeams(rule, n, input.franchises);
  const target = homeTargets(rule, n, heavy);
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
    opening: rule.opening, days, planned, cancels: [], remainingFrom,
    series: series.map(({ day, len, home, away }) => ({ day, len, home, away })), mainEnd, attempt,
  };
  const problems = planProblems(plan, input);
  return problems.length ? problems[0] : plan;
}

/** 5. 검사: 상대별 경기 수, 상대별 홈 목표, 하루 한 팀 한 경기, 월요일(어린이날 빼고)·쉬는 기간 경기 없음, 원정 연전 연속 한도.
 * 걸린 것을 문장으로 돌려준다 (없으면 빈 배열) */
export function planProblems(plan: SchedulePlan, input: ScheduleInput): string[] {
  const { rule, teams: n } = input;
  const out: string[] = [];
  const meet = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  plan.days.forEach((games, i) => {
    const d = addDays(rule.opening, i);
    if (games.length && !playable(rule, d)) out.push(`${d}: 경기 없는 날에 경기`);
    const seen = new Set<number>();
    for (const g of games) {
      if (seen.has(g.home) || seen.has(g.away)) out.push(`${d}: 한 팀이 두 경기`);
      seen.add(g.home);
      seen.add(g.away);
      meet[g.home][g.away]++;
    }
  });
  const heavy = homeHeavyTeams(rule, n, input.franchises);
  const target = homeTargets(rule, n, heavy);
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
  let why = '';
  for (let k = 1; k <= MAX_ATTEMPTS; k++) {
    const plan = tryBuild(input, input.rng.fork(k === 1 ? 'schedule' : `schedule/${k}`), k);
    if (typeof plan !== 'string') return plan;
    why = plan;
  }
  throw new Error(`일정 생성기: ${input.rule.year}년 일정을 ${MAX_ATTEMPTS}번 만들어도 검사를 통과하지 못함 (마지막: ${why})`);
}
