// 역사와 서사 1단계 D4: 라이벌과 왕조 (docs/roadmap.md 3.5, 2026-10-11).
// 연표(history.ts yearbook)에서 계산한다. 실제 시즌은 한국시리즈 맞대결만, 게임 안 시즌은 가을야구 시리즈 전부를 본다.

import type { YearRecord } from './history';
import type { LeagueState } from './types';

/** 라이벌 판정 기간 (최근 시즌 수) */
export const RIVAL_YEARS = 10;
/** 점수: 한국시리즈 맞대결, 다른 가을야구 시리즈, 정규시즌 1·2위 접전(RIVAL_RACE_GB 경기 차 이내) */
export const RIVAL_KS = 3;
export const RIVAL_SERIES = 2;
export const RIVAL_RACE = 1;
export const RIVAL_RACE_GB = 3;
/** 이 점수 이상이고 서로 다른 RIVAL_SEASONS 시즌 이상에 걸쳐 있으면 라이벌 */
export const RIVAL_MIN = 4;
export const RIVAL_SEASONS = 2;
/** 라이벌전 홈 관중률 */
export const RIVAL_FILL = 0.08;

export interface RivalPair {
  /** 구단 계보 (사전 순) */
  a: string;
  b: string;
  score: number;
  /** 근거 (연도 순) */
  notes: string[];
  /** 근거가 있는 시즌 */
  years: number[];
}

const key = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

function franchiseOf(y: YearRecord, name: string | null): string | null {
  return name === null ? null : y.teams.find((t) => t.name === name)?.franchise ?? null;
}

/** year 직전 RIVAL_YEARS 시즌으로 라이벌 쌍 (점수 높은 순) */
export function computeRivals(yb: YearRecord[], year: number): RivalPair[] {
  const pairs = new Map<string, RivalPair>();
  const add = (x: string, y: string, pts: number, note: string, year: number) => {
    if (x === y) return;
    const [a, b] = key(x, y);
    const k = `${a}/${b}`;
    let p = pairs.get(k);
    if (!p) pairs.set(k, (p = { a, b, score: 0, notes: [], years: [] }));
    p.score += pts;
    p.notes.push(note);
    if (!p.years.includes(year)) p.years.push(year);
  };
  for (const y of yb) {
    if (y.year >= year || y.year < year - RIVAL_YEARS) continue;
    const c = franchiseOf(y, y.champion);
    const r = franchiseOf(y, y.runnerUp);
    if (y.series?.length) {
      for (const s of y.series) add(s.a, s.b, s.ks ? RIVAL_KS : RIVAL_SERIES, `${y.year} ${s.ks ? '한국시리즈' : '가을야구'}`, y.year);
    } else if (c && r) {
      add(c, r, RIVAL_KS, `${y.year} 한국시리즈`, y.year);
    }
    const [t1, t2] = y.teams;
    if (t1 && t2 && ((t1.w - t1.l) - (t2.w - t2.l)) / 2 <= RIVAL_RACE_GB) add(t1.franchise, t2.franchise, RIVAL_RACE, `${y.year} 1위 다툼`, y.year);
  }
  return [...pairs.values()].filter((p) => p.score >= RIVAL_MIN && p.years.length >= RIVAL_SEASONS)
    .sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

/** 그 구단의 라이벌 계보들 */
export function rivalsOf(league: Pick<LeagueState, 'rivals'>, franchise: string): RivalPair[] {
  return (league.rivals?.pairs ?? []).filter((p) => p.a === franchise || p.b === franchise);
}

export function isRivalry(league: Pick<LeagueState, 'rivals' | 'teams'>, team: number, opp: number): boolean {
  const a = league.teams[team]?.franchise;
  const b = league.teams[opp]?.franchise;
  if (!a || !b) return false;
  const [x, y] = key(a, b);
  return (league.rivals?.pairs ?? []).some((p) => p.a === x && p.b === y);
}

export function rivalFill(league: Pick<LeagueState, 'rivals' | 'teams'>, team: number, opp: number | undefined): number {
  return opp !== undefined && isRivalry(league, team, opp) ? RIVAL_FILL : 0;
}

// ---- 왕조

export interface Dynasty {
  franchise: string;
  /** 마지막 우승 때 이름 */
  name: string;
  from: number;
  to: number;
  titles: number[];
  /** 가장 긴 연속 우승 */
  streak: number;
}

/** 왕조: 우승 사이 간격이 DYNASTY_GAP 시즌 이내로 이어지며 DYNASTY_TITLES회 이상 우승한 기간 */
export const DYNASTY_TITLES = 3;
export const DYNASTY_GAP = 2;

/** 구단별 우승 연도 (계보, 연도 순) */
function titlesByFranchise(yb: YearRecord[]): Map<string, { year: number; name: string }[]> {
  const out = new Map<string, { year: number; name: string }[]>();
  for (const y of [...yb].sort((a, b) => a.year - b.year)) {
    const f = franchiseOf(y, y.champion);
    if (!f) continue;
    if (!out.has(f)) out.set(f, []);
    out.get(f)!.push({ year: y.year, name: y.champion! });
  }
  return out;
}

export function dynasties(yb: YearRecord[]): Dynasty[] {
  const out: Dynasty[] = [];
  for (const [franchise, ts] of titlesByFranchise(yb)) {
    let run: { year: number; name: string }[] = [];
    const flush = () => {
      if (run.length >= DYNASTY_TITLES) {
        let streak = 1;
        let best = 1;
        for (let i = 1; i < run.length; i++) { streak = run[i].year === run[i - 1].year + 1 ? streak + 1 : 1; best = Math.max(best, streak); }
        out.push({ franchise, name: run[run.length - 1].name, from: run[0].year, to: run[run.length - 1].year, titles: run.map((r) => r.year), streak: best });
      }
      run = [];
    };
    for (const t of ts) {
      if (run.length && t.year - run[run.length - 1].year > DYNASTY_GAP) flush();
      run.push(t);
    }
    flush();
  }
  return out.sort((a, b) => b.titles.length - a.titles.length || b.streak - a.streak || a.from - b.from);
}

/** year 우승 구단의 연속 우승 횟수 (그 해 포함, 연표에 그 해가 들어간 뒤) */
export function titleStreak(yb: YearRecord[], year: number): number {
  const byYear = new Map(yb.map((y) => [y.year, y]));
  const f = (y: number) => { const r = byYear.get(y); return r ? franchiseOf(r, r.champion) : null; };
  const me = f(year);
  if (!me) return 0;
  let n = 1;
  while (f(year - n) === me) n++;
  return n;
}
