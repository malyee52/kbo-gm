// 역사와 서사 1단계: 통산 기록과 연표 (docs/roadmap.md 3장, 2026-10-11).
//
// - 통산 = 게임 시작 전 실제 기록(시즌 자료) + 게임 안 기록. 실제 기록은 자료에서 매번 읽고 저장하지 않는다.
// - 게임 안 기록: 리그에 남은 선수는 시즌별 history, 떠난 선수(은퇴·방출·무적)는 오프시즌 끝에 합계만 보관한다(archive).
//   무소속 선수는 오프시즌마다 리그 명단에서 지워지므로(closeOffseason), 보관하지 않으면 통산 기록이 사라진다.
// - 연표: 게임 안 시즌은 결산 때 순위·우승을 기록하고(yearbook), 시작 전 시즌은 자료의 최종 순위로 만든다.

import type { DataStore } from '../data/types';
import type { LeaguePlayer, LeagueState, SeasonLine } from './types';

/** 게임 안 통산 (타격: BatLine 키 순서, 투구: PitLine 키 순서의 합) */
export interface ArchivedPlayer {
  id: string;
  name: string;
  real: boolean;
  isPitcher: boolean;
  birthYear: number | null;
  /** 게임 안 마지막 시즌 */
  lastYear: number;
  /** 게임 안에서 뛴 구단 (계보, 순서대로) */
  franchises: string[];
  /** 마지막 소속 구단 이름 */
  lastTeam: string;
  why: 'retired' | 'left';
  seasons: number;
  bat?: number[];
  pit?: number[];
}

export interface YearTeam {
  name: string;
  franchise: string;
  w: number;
  l: number;
  t: number;
}

export interface YearRecord {
  year: number;
  /** 정규시즌 순위 순 */
  teams: YearTeam[];
  champion: string | null;
  runnerUp: string | null;
  /** 게임 안에서 치른 시즌인가 (아니면 실제 기록) */
  inGame: boolean;
}

// BatLine: g, pa, ab, r, h, d, t, hr, rbi, bb, hbp, so, sb, cs, gdp, sf, sac
const B = { g: 0, pa: 1, ab: 2, r: 3, h: 4, d: 5, t: 6, hr: 7, rbi: 8, bb: 9, hbp: 10, so: 11, sb: 12, cs: 13 } as const;
// PitLine: g, gs, w, l, sv, outs, bf, h, hr, bb, hbp, so, r, er
const P = { g: 0, gs: 1, w: 2, l: 3, sv: 4, outs: 5, bf: 6, h: 7, hr: 8, bb: 9, hbp: 10, so: 11, r: 12, er: 13 } as const;

export interface CareerBat { g: number; pa: number; ab: number; r: number; h: number; d: number; t: number; hr: number; rbi: number; bb: number; so: number; sb: number }
export interface CareerPit { g: number; gs: number; w: number; l: number; sv: number; outs: number; so: number; er: number; bb: number; h: number }

export interface Career {
  id: string;
  name: string;
  real: boolean;
  isPitcher: boolean;
  firstYear: number;
  lastYear: number;
  /** 지금 리그 소속 (현역) */
  active: boolean;
  bat: CareerBat;
  pit: CareerPit;
  /** 시작 전 실제 기록이 들어 있나 */
  hasReal: boolean;
}

const emptyBat = (): CareerBat => ({ g: 0, pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0 });
const emptyPit = (): CareerPit => ({ g: 0, gs: 0, w: 0, l: 0, sv: 0, outs: 0, so: 0, er: 0, bb: 0, h: 0 });

function addBatLine(c: CareerBat, v: number[]): void {
  c.g += v[B.g]; c.pa += v[B.pa]; c.ab += v[B.ab]; c.r += v[B.r]; c.h += v[B.h]; c.d += v[B.d]; c.t += v[B.t];
  c.hr += v[B.hr]; c.rbi += v[B.rbi]; c.bb += v[B.bb]; c.so += v[B.so]; c.sb += v[B.sb];
}
function addPitLine(c: CareerPit, v: number[]): void {
  c.g += v[P.g]; c.gs += v[P.gs]; c.w += v[P.w]; c.l += v[P.l]; c.sv += v[P.sv]; c.outs += v[P.outs];
  c.so += v[P.so]; c.er += v[P.er]; c.bb += v[P.bb]; c.h += v[P.h];
}
const sumLines = (lines: (number[] | undefined)[]): number[] | undefined => {
  const xs = lines.filter((x): x is number[] => !!x);
  if (!xs.length) return undefined;
  return xs[0].map((_, i) => xs.reduce((s, x) => s + (x[i] ?? 0), 0));
};

/**
 * 오프시즌 끝에 리그 명단에서 빠지는 선수(무소속)의 게임 안 기록을 합계로 보관한다. closeOffseason이 명단을 지우기 전에 부른다.
 * 게임 안 1군 기록이 없는 선수(2군에만 있던 신인 등)는 보관하지 않는다.
 */
export function archiveDeparting(league: LeagueState, year: number): void {
  const retired = new Set((league.retired ?? []).filter((r) => r.year === year).map((r) => r.id));
  league.archive ??= [];
  for (const p of league.players) {
    if (p.team >= 0 || !p.history.some((h) => h.bat || h.pit)) continue; // 1군 기록이 하나도 없으면 남길 것이 없다
    league.archive.push(archiveOf(p, retired.has(p.id) ? 'retired' : 'left'));
  }
}

function archiveOf(p: LeaguePlayer, why: ArchivedPlayer['why']): ArchivedPlayer {
  const h = p.history;
  const franchises: string[] = [];
  for (const s of h) if (franchises[franchises.length - 1] !== s.team) franchises.push(s.team);
  return {
    id: p.id, name: p.name, real: p.real, isPitcher: p.isPitcher, birthYear: p.birthYear,
    lastYear: h[h.length - 1].year, franchises, lastTeam: h[h.length - 1].team, why, seasons: h.length,
    bat: sumLines(h.map((s) => s.bat)), pit: sumLines(h.map((s) => s.pit)),
  };
}

/** 양대 리그 시대(1999·2000)는 자료의 최종 순위에 리그별 1위가 둘이라 한국시리즈 결과를 따로 둔다 */
const TWO_LEAGUE_FINAL: Record<number, { champion: string; runnerUp: string }> = {
  1999: { champion: '한화', runnerUp: '롯데' },
  2000: { champion: '현대', runnerUp: '두산' },
};

/** 게임 안 시즌의 연표 한 줄을 남긴다 (결산 때). standings: 정규시즌 순위 (구단 색인) */
export function recordYear(league: LeagueState, year: number, teams: { name: string; franchise: string }[],
                           records: { w: number; l: number; t: number }[], standings: number[], champion: number | null, runnerUp: number | null): void {
  league.yearbook ??= [];
  league.yearbook = league.yearbook.filter((y) => y.year !== year);
  league.yearbook.push({
    year, inGame: true,
    teams: standings.map((t) => ({ name: teams[t].name, franchise: teams[t].franchise, w: records[t].w, l: records[t].l, t: records[t].t })),
    champion: champion === null ? null : teams[champion].name,
    runnerUp: runnerUp === null ? null : teams[runnerUp].name,
  });
}

type Store = Pick<DataStore, 'meta' | 'season' | 'players'>;

/** 시작 전 실제 시즌의 연표 (자료의 최종 순위. 정규시즌 순위는 승률 순) */
export function realYearbook(store: Store, before: number): YearRecord[] {
  const out: YearRecord[] = [];
  for (const y of store.meta.years) {
    if (y >= before) continue;
    const sd = store.season(y);
    if (!sd) continue;
    const order = [...sd.teams].sort((a, b) => b.pct - a.pct || a.rank - b.rank);
    const two = TWO_LEAGUE_FINAL[y];
    out.push({
      year: y, inGame: false,
      teams: order.map((t) => ({ name: t.name, franchise: t.franchise, w: t.w, l: t.l, t: t.t })),
      champion: two?.champion ?? sd.teams.find((t) => t.rank === 1)?.name ?? null,
      runnerUp: two?.runnerUp ?? sd.teams.find((t) => t.rank === 2)?.name ?? null,
    });
  }
  return out;
}

/** 연표 전체 (시작 전 실제 + 게임 안), 연도 순 */
export function yearbook(league: LeagueState, store: Store): YearRecord[] {
  return [...realYearbook(store, league.startYear), ...(league.yearbook ?? [])].sort((a, b) => a.year - b.year);
}

/** 시작 전 실제 통산 (선수 id → 합계). 같은 store·시작 연도면 한 번만 계산한다 */
const realCache = new WeakMap<object, Map<number, Map<string, Career>>>();
function realCareers(store: Store, before: number): Map<string, Career> {
  let byYear = realCache.get(store);
  if (!byYear) realCache.set(store, (byYear = new Map()));
  const hit = byYear.get(before);
  if (hit) return hit;
  const out = new Map<string, Career>();
  const get = (id: string, year: number): Career => {
    let c = out.get(id);
    if (!c) {
      const m = store.players.get(id);
      c = { id, name: m?.name ?? id, real: true, isPitcher: m ? m.kind === 'P' : false, firstYear: year, lastYear: year, active: false, bat: emptyBat(), pit: emptyPit(), hasReal: true };
      out.set(id, c);
    }
    c.firstYear = Math.min(c.firstYear, year);
    c.lastYear = Math.max(c.lastYear, year);
    return c;
  };
  for (const y of store.meta.years) {
    if (y >= before) continue;
    const sd = store.season(y);
    if (!sd) continue;
    for (const r of sd.bat) {
      const c = get(r.id, y).bat;
      c.g += r.g; c.pa += r.pa; c.ab += r.ab; c.r += r.r; c.h += r.h; c.d += r.d; c.t += r.t; c.hr += r.hr; c.rbi += r.rbi;
      c.bb += r.bb ?? 0; c.so += r.so ?? 0; c.sb += r.sb ?? 0;
    }
    for (const r of sd.pit) {
      const c = get(r.id, y).pit;
      c.g += r.g; c.gs += r.gs ?? 0; c.w += r.w; c.l += r.l; c.sv += r.sv; c.outs += r.outs; c.so += r.so; c.er += r.er; c.bb += r.bb; c.h += r.h;
    }
  }
  byYear.set(before, out);
  return out;
}

/**
 * 모든 선수의 통산 (시작 전 실제 + 게임 안). current: 진행 중인 시즌 기록을 더하고 싶을 때 (선수 id → 그 시즌 줄)
 */
export function careers(league: LeagueState, store: Store, current?: Map<string, SeasonLine>): Map<string, Career> {
  const out = new Map<string, Career>();
  for (const [id, c] of realCareers(store, league.startYear)) out.set(id, { ...c, bat: { ...c.bat }, pit: { ...c.pit } });
  const get = (id: string, name: string, real: boolean, isPitcher: boolean, year: number): Career => {
    let c = out.get(id);
    if (!c) {
      c = { id, name, real, isPitcher, firstYear: year, lastYear: year, active: false, bat: emptyBat(), pit: emptyPit(), hasReal: false };
      out.set(id, c);
    }
    c.name = name;
    c.isPitcher = isPitcher;
    c.firstYear = Math.min(c.firstYear, year);
    c.lastYear = Math.max(c.lastYear, year);
    return c;
  };
  for (const a of league.archive ?? []) {
    const c = get(a.id, a.name, a.real, a.isPitcher, a.lastYear);
    if (a.bat) addBatLine(c.bat, a.bat);
    if (a.pit) addPitLine(c.pit, a.pit);
  }
  for (const p of league.players) {
    const lines = [...p.history, ...(current?.get(p.id) ? [current.get(p.id)!] : [])];
    if (!lines.length && !out.has(p.id)) continue;
    const c = get(p.id, p.name, p.real, p.isPitcher, lines.at(-1)?.year ?? league.year);
    c.active = p.team >= 0;
    for (const s of lines) {
      if (s.bat) addBatLine(c.bat, s.bat);
      if (s.pit) addPitLine(c.pit, s.pit);
    }
  }
  return out;
}

/** 통산 순위 부문 */
export const CAREER_STATS: { key: string; label: string; pitcher: boolean; value: (c: Career) => number; fmt?: (v: number) => string; min?: (c: Career) => boolean }[] = [
  { key: 'hr', label: '홈런', pitcher: false, value: (c) => c.bat.hr },
  { key: 'h', label: '안타', pitcher: false, value: (c) => c.bat.h },
  { key: 'rbi', label: '타점', pitcher: false, value: (c) => c.bat.rbi },
  { key: 'r', label: '득점', pitcher: false, value: (c) => c.bat.r },
  { key: 'sb', label: '도루', pitcher: false, value: (c) => c.bat.sb },
  { key: 'g', label: '출장 (타자)', pitcher: false, value: (c) => c.bat.g },
  { key: 'avg', label: '타율 (3,000타수 이상)', pitcher: false, value: (c) => (c.bat.ab ? c.bat.h / c.bat.ab : 0), fmt: (v) => v.toFixed(3).replace(/^0/, ''), min: (c) => c.bat.ab >= 3000 },
  { key: 'w', label: '승', pitcher: true, value: (c) => c.pit.w },
  { key: 'sv', label: '세이브', pitcher: true, value: (c) => c.pit.sv },
  { key: 'pso', label: '탈삼진', pitcher: true, value: (c) => c.pit.so },
  { key: 'ip', label: '이닝', pitcher: true, value: (c) => c.pit.outs / 3, fmt: (v) => Math.floor(v).toLocaleString('ko-KR') },
  { key: 'era', label: '평균자책 (1,000이닝 이상)', pitcher: true, value: (c) => (c.pit.outs ? -(c.pit.er * 27) / c.pit.outs : -99), fmt: (v) => (-v).toFixed(2), min: (c) => c.pit.outs >= 3000 },
];

/** 통산 순위 */
export function careerLeaders(all: Map<string, Career>, key: string, n = 20): { c: Career; v: number }[] {
  const def = CAREER_STATS.find((s) => s.key === key)!;
  return [...all.values()]
    .filter((c) => (def.min ? def.min(c) : true))
    .map((c) => ({ c, v: def.value(c) }))
    .filter((x) => x.v > 0 || def.key === 'era')
    .sort((a, b) => b.v - a.v || a.c.id.localeCompare(b.c.id))
    .slice(0, n);
}
