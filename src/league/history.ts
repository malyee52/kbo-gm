// 역사와 서사 1단계: 통산 기록과 연표 (docs/roadmap.md 3장, 2026-10-11).
//
// - 통산 = 게임 시작 전 실제 기록(시즌 자료) + 게임 안 기록. 실제 기록은 자료에서 매번 읽고 저장하지 않는다.
// - 게임 안 기록: 리그에 남은 선수는 시즌별 history, 떠난 선수(은퇴·방출·무적)는 오프시즌 끝에 합계만 보관한다(archive).
//   무소속 선수는 오프시즌마다 리그 명단에서 지워지므로(closeOffseason), 보관하지 않으면 통산 기록이 사라진다.
// - 연표: 게임 안 시즌은 결산 때 순위·우승을 기록하고(yearbook), 시작 전 시즌은 자료의 최종 순위로 만든다.

import { batWarOf, pitWarOf, realEnv, realEnvOf, warSummary } from './war';
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
  /** 게임 안에서 뛴 구단 (이름, 순서대로) */
  franchises: string[];
  /** 게임 안에서 구단 계보별로 뛴 시즌 수 */
  franchiseSeasons?: Record<string, number>;
  /** 마지막 소속 구단 이름 */
  lastTeam: string;
  why: 'retired' | 'left';
  seasons: number;
  bat?: number[];
  pit?: number[];
  /** 게임 안 시즌별 가치 (war.ts, 2026-10-12부터. 예전 보관 선수에는 없다) */
  wars?: number[];
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
  /** 게임 안 가을야구 시리즈 (구단 계보). 실제 시즌은 없음 (rivals.ts) */
  series?: { a: string; b: string; winner: string; ks: boolean }[];
}

// BatLine: g, pa, ab, r, h, d, t, hr, rbi, bb, hbp, so, sb, cs, gdp, sf, sac
const B = { g: 0, pa: 1, ab: 2, r: 3, h: 4, d: 5, t: 6, hr: 7, rbi: 8, bb: 9, hbp: 10, so: 11, sb: 12, cs: 13 } as const;
// PitLine: g, gs, w, l, sv, outs, bf, h, hr, bb, hbp, so, r, er, hld, qs, bsv
const P = { g: 0, gs: 1, w: 2, l: 3, sv: 4, outs: 5, bf: 6, h: 7, hr: 8, bb: 9, hbp: 10, so: 11, r: 12, er: 13, hld: 14, qs: 15, bsv: 16 } as const;

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
  /** 구단 계보별로 뛴 시즌 수 (1군 기록이 있는 시즌) */
  franchiseSeasons: Record<string, number>;
  /** 마지막 소속 구단 이름 */
  lastTeam: string;
  /** 시즌별 가치 (승, war.ts). 실제 시즌과 게임 안 시즌 */
  wars: number[];
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
    if (p.team >= 0 || p.team === -2 || p.freeAgent || !p.history.some((h) => h.bat || h.pit)) continue; // 계약하지 못한 FA(freeAgent)는 시즌 중 자유계약으로 남는다 // 해외(−2)는 리그 명단에 남는다. 1군 기록이 하나도 없으면 남길 것이 없다
    league.archive.push(archiveOf(league, p, retired.has(p.id) ? 'retired' : 'left'));
  }
}

/** 게임 안 시즌 줄의 구단 이름 → 계보 (그 해 연표, 없으면 지금 구단 목록) */
function gameFranchise(league: LeagueState, year: number, name: string): string {
  return league.yearbook?.find((y) => y.year === year)?.teams.find((t) => t.name === name)?.franchise
    ?? league.teams.find((t) => t.name === name)?.franchise ?? name;
}

function archiveOf(league: LeagueState, p: LeaguePlayer, why: ArchivedPlayer['why']): ArchivedPlayer {
  const h = p.history;
  const franchises: string[] = [];
  const franchiseSeasons: Record<string, number> = {};
  for (const s of h) {
    if (franchises[franchises.length - 1] !== s.team) franchises.push(s.team);
    if (s.bat || s.pit) { const f = gameFranchise(league, s.year, s.team); franchiseSeasons[f] = (franchiseSeasons[f] ?? 0) + 1; }
  }
  return {
    id: p.id, name: p.name, real: p.real, isPitcher: p.isPitcher, birthYear: p.birthYear,
    lastYear: h[h.length - 1].year, franchises, franchiseSeasons, lastTeam: h[h.length - 1].team, why, seasons: h.length,
    bat: sumLines(h.map((s) => s.bat)), pit: sumLines(h.map((s) => s.pit)),
    ...(league.seasonEnv ? { wars: h.map((s) => lineWar(league, null, s, p.pos)) } : {}),
  };
}

/** 게임 안 시즌 줄의 가치 (war.ts). 그 해 시뮬 환경이 없으면(예전 저장) 실제 자료의 그 해(가까운 해) 환경, 그것도 없으면 0 */
function lineWar(league: LeagueState, store: Store | null, s: SeasonLine, pos: string | null | undefined): number {
  const env = league.seasonEnv?.[String(s.year)] ?? (store ? realEnvOf(store, s.year) : undefined);
  if (!env) return 0;
  let w = 0;
  if (s.bat) {
    const b = s.bat;
    w += batWarOf({ pa: b[B.pa], h: b[B.h], d: b[B.d], t: b[B.t], hr: b[B.hr], bb: b[B.bb], hbp: b[B.hbp] }, pos, env);
  }
  if (s.pit) {
    const q = s.pit;
    w += pitWarOf({ g: q[P.g], gs: q[P.gs], outs: q[P.outs], hr: q[P.hr], bb: q[P.bb], hbp: q[P.hbp], so: q[P.so], r: q[P.r] }, env);
  }
  return w;
}

/** 실제 자료의 구단 이름 → 계보 (그 해 이름) */
function realFranchise(store: Pick<DataStore, 'meta'>, name: string, year: number): string {
  const fr = store.meta.franchises;
  return Object.keys(fr).find((k) => fr[k].some((x) => x.name === name && x.from <= year && year <= x.to))
    ?? Object.keys(fr).find((k) => fr[k].some((x) => x.name === name)) ?? name;
}

/** 양대 리그 시대(1999·2000)는 자료의 최종 순위에 리그별 1위가 둘이라 한국시리즈 결과를 따로 둔다 */
const TWO_LEAGUE_FINAL: Record<number, { champion: string; runnerUp: string }> = {
  1999: { champion: '한화', runnerUp: '롯데' },
  2000: { champion: '현대', runnerUp: '두산' },
};

/** 게임 안 시즌의 연표 한 줄을 남긴다 (결산 때). standings: 정규시즌 순위 (구단 색인) */
export function recordYear(league: LeagueState, year: number, teams: { name: string; franchise: string }[],
                           records: { w: number; l: number; t: number }[], standings: number[], champion: number | null, runnerUp: number | null,
                           series: { high: number; low: number; winner: number; ks: boolean }[] = []): void {
  league.yearbook ??= [];
  league.yearbook = league.yearbook.filter((y) => y.year !== year);
  league.yearbook.push({
    year, inGame: true,
    teams: standings.map((t) => ({ name: teams[t].name, franchise: teams[t].franchise, w: records[t].w, l: records[t].l, t: records[t].t })),
    champion: champion === null ? null : teams[champion].name,
    runnerUp: runnerUp === null ? null : teams[runnerUp].name,
    series: series.filter((s) => s.winner >= 0).map((s) => ({ a: teams[s.high].franchise, b: teams[s.low].franchise, winner: teams[s.winner].franchise, ks: s.ks })),
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
      c = { id, name: m?.name ?? id, real: true, isPitcher: m ? m.kind === 'P' : false, firstYear: year, lastYear: year, active: false, bat: emptyBat(), pit: emptyPit(), hasReal: true, franchiseSeasons: {}, lastTeam: '', wars: [] };
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
    // 구단별 시즌 수: 그 해 뛴 구단마다 한 번 (타격·투구 중복 제외)
    const seen = new Set<string>();
    for (const r of [...sd.bat, ...sd.pit]) {
      const key = `${r.id}/${r.team}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = get(r.id, y);
      const f = realFranchise(store, r.team, y);
      c.franchiseSeasons[f] = (c.franchiseSeasons[f] ?? 0) + 1;
      if (y >= c.lastYear) c.lastTeam = r.team;
    }
    // 시즌 가치 (war.ts): 투수의 타격 기록은 빼고, 한 해에 한 값
    const env = realEnv(sd);
    const yearWar = new Map<string, number>();
    for (const r of sd.bat) if (store.players.get(r.id)?.kind !== 'P') yearWar.set(r.id, (yearWar.get(r.id) ?? 0) + batWarOf(r, r.pos, env));
    for (const r of sd.pit) yearWar.set(r.id, (yearWar.get(r.id) ?? 0) + pitWarOf(r, env));
    for (const [id, w] of yearWar) get(id, y).wars.push(w);
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
  for (const [id, c] of realCareers(store, league.startYear)) out.set(id, { ...c, bat: { ...c.bat }, pit: { ...c.pit }, franchiseSeasons: { ...c.franchiseSeasons }, wars: [...c.wars] });
  const get = (id: string, name: string, real: boolean, isPitcher: boolean, year: number): Career => {
    let c = out.get(id);
    if (!c) {
      c = { id, name, real, isPitcher, firstYear: year, lastYear: year, active: false, bat: emptyBat(), pit: emptyPit(), hasReal: false, franchiseSeasons: {}, lastTeam: '', wars: [] };
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
    if (a.wars) c.wars.push(...a.wars);
    for (const [f, n] of Object.entries(a.franchiseSeasons ?? {})) c.franchiseSeasons[f] = (c.franchiseSeasons[f] ?? 0) + n;
    c.lastTeam = a.lastTeam;
  }
  for (const p of league.players) {
    const lines = [...p.history, ...(current?.get(p.id) ? [current.get(p.id)!] : [])];
    if (!lines.length && !out.has(p.id)) continue;
    const c = get(p.id, p.name, p.real, p.isPitcher, lines.at(-1)?.year ?? league.year);
    c.active = p.team >= 0 || p.team === -2; // 해외(−2)에서 뛰는 선수도 현역 (명예의 전당·은퇴 판정)
    for (const s of lines) {
      if (s.bat) addBatLine(c.bat, s.bat);
      if (s.pit) addPitLine(c.pit, s.pit);
      if (s.bat || s.pit) { const f = gameFranchise(league, s.year, s.team); c.franchiseSeasons[f] = (c.franchiseSeasons[f] ?? 0) + 1; c.lastTeam = s.team; c.wars.push(lineWar(league, store, s, p.pos)); }
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

// ---- 단일 시즌 기록

export interface SeasonBest {
  id: string;
  name: string;
  team: string;
  year: number;
  value: number;
}

/** 단일 시즌 기록 부문. 비율 기록은 규정(타석 3.1×경기, 이닝 1×경기)을 채운 시즌만 */
export const SEASON_STATS: { key: string; label: string; pitcher: boolean; fmt?: (v: number) => string; low?: boolean }[] = [
  { key: 'hr', label: '홈런', pitcher: false },
  { key: 'h', label: '안타', pitcher: false },
  { key: 'rbi', label: '타점', pitcher: false },
  { key: 'sb', label: '도루', pitcher: false },
  { key: 'avg', label: '타율', pitcher: false, fmt: (v) => v.toFixed(3).replace(/^0/, '') },
  { key: 'w', label: '승', pitcher: true },
  { key: 'sv', label: '세이브', pitcher: true },
  { key: 'so', label: '탈삼진', pitcher: true },
  { key: 'era', label: '평균자책', pitcher: true, fmt: (v) => v.toFixed(2), low: true },
];
const BEST_KEEP = 20;

/** 한 시즌 줄(BatLine·PitLine 배열)에서 부문 값. 규정 미달이면 null */
function seasonValue(key: string, bat: number[] | undefined, pit: number[] | undefined, games: number): number | null {
  if (key === 'avg') return bat && bat[B.pa] >= games * 3.1 && bat[B.ab] ? bat[B.h] / bat[B.ab] : null;
  if (key === 'era') return pit && pit[P.outs] >= games * 3 ? (pit[P.er] * 27) / pit[P.outs] : null;
  const def = SEASON_STATS.find((s) => s.key === key)!;
  if (def.pitcher) return pit ? pit[key === 'so' ? P.so : key === 'w' ? P.w : P.sv] : null;
  return bat ? bat[key === 'hr' ? B.hr : key === 'h' ? B.h : key === 'rbi' ? B.rbi : B.sb] : null;
}

function pushBest(list: SeasonBest[], e: SeasonBest, low: boolean): SeasonBest[] {
  list.push(e);
  list.sort((a, b) => (low ? a.value - b.value : b.value - a.value) || a.year - b.year || a.id.localeCompare(b.id));
  return list.slice(0, BEST_KEEP);
}

/**
 * 게임 안 시즌 기록을 부문별 상위 목록에 넣는다 (결산 때). 떠난 선수는 시즌별 줄을 버리므로 여기서 남겨 둔다.
 * lines: 그 시즌 선수별 기록 (BatLine·PitLine 키 순서 배열), games: 팀당 경기 수
 */
export function recordSeasonBests(league: LeagueState, year: number, games: number,
                                  lines: { id: string; name: string; team: string; bat?: number[]; pit?: number[] }[]): void {
  league.seasonBests ??= {};
  for (const def of SEASON_STATS) {
    let list = (league.seasonBests[def.key] ?? []).filter((e) => e.year !== year);
    for (const l of lines) {
      const v = seasonValue(def.key, l.bat, l.pit, games);
      if (v === null || (!def.low && v <= 0)) continue;
      list = pushBest(list, { id: l.id, name: l.name, team: l.team, year, value: v }, !!def.low);
    }
    league.seasonBests[def.key] = list;
  }
}

/** 단일 시즌 기록 (시작 전 실제 + 게임 안) */
export function seasonBests(league: LeagueState, store: Store, key: string, n = 10): SeasonBest[] {
  const def = SEASON_STATS.find((s) => s.key === key)!;
  let list: SeasonBest[] = [...(league.seasonBests?.[key] ?? [])];
  for (const y of store.meta.years) {
    if (y >= league.startYear) continue;
    const sd = store.season(y);
    if (!sd) continue;
    const name = (id: string) => store.players.get(id)?.name ?? id;
    if (def.pitcher) {
      for (const r of sd.pit) {
        const pit = [r.g, r.gs ?? 0, r.w, r.l, r.sv, r.outs, r.tbf, r.h, r.hr, r.bb, r.hbp, r.so, r.r, r.er];
        const v = seasonValue(key, undefined, pit, sd.games);
        if (v !== null && (def.low || v > 0)) list = pushBest(list, { id: r.id, name: name(r.id), team: r.team, year: y, value: v }, !!def.low);
      }
    } else {
      for (const r of sd.bat) {
        const bat = [r.g, r.pa, r.ab, r.r, r.h, r.d, r.t, r.hr, r.rbi, r.bb ?? 0, r.hbp ?? 0, r.so ?? 0, r.sb ?? 0, r.cs ?? 0];
        const v = seasonValue(key, bat, undefined, sd.games);
        if (v !== null && (def.low || v > 0)) list = pushBest(list, { id: r.id, name: name(r.id), team: r.team, year: y, value: v }, !!def.low);
      }
    }
  }
  return list.slice(0, n);
}

// ---- 구단 역사

export interface FranchiseHistory {
  franchise: string;
  /** 지금 이름 */
  name: string;
  titles: number[];
  runnerUps: number[];
  postseasons: number;
  seasons: number;
  best: { year: number; name: string; w: number; l: number; t: number } | null;
  worst: { year: number; name: string; w: number; l: number; t: number } | null;
}

/** 구단 계보별 역사 (연표에서). 가을야구 진출은 그 해 규정의 진출 구단 수 안의 정규시즌 순위 */
export function franchiseHistory(league: LeagueState, store: Store): FranchiseHistory[] {
  const out = new Map<string, FranchiseHistory>();
  for (const y of yearbook(league, store)) {
    const cut = Number(store.meta.rules[String(y.year)]?.postseasonTeams ?? store.meta.rules[String(Math.max(...store.meta.years))].postseasonTeams);
    y.teams.forEach((t, i) => {
      let f = out.get(t.franchise);
      if (!f) out.set(t.franchise, (f = { franchise: t.franchise, name: t.name, titles: [], runnerUps: [], postseasons: 0, seasons: 0, best: null, worst: null }));
      f.name = t.name;
      f.seasons++;
      if (i < cut) f.postseasons++;
      if (y.champion === t.name) f.titles.push(y.year);
      if (y.runnerUp === t.name) f.runnerUps.push(y.year);
      const pct = t.w / Math.max(1, t.w + t.l);
      const pick = { year: y.year, name: t.name, w: t.w, l: t.l, t: t.t };
      if (!f.best || pct > f.best.w / Math.max(1, f.best.w + f.best.l)) f.best = pick;
      if (!f.worst || pct < f.worst.w / Math.max(1, f.worst.w + f.worst.l)) f.worst = pick;
    });
  }
  return [...out.values()].sort((a, b) => b.titles.length - a.titles.length || b.postseasons - a.postseasons);
}

// ---- 명예의 전당과 구단 레전드

/**
 * 헌액 기준 (2026-10-12, 실제 자료로 맞춤): 통산 가치(war.ts) HOF_WAR승 이상, 또는 최고 5시즌 합 HOF_PEAK5승 이상, 또는 게임 안 MVP 2회 이상.
 * 실제 커리어에 적용하면 2024년까지 은퇴한 선수 45명 (KBO 레전드 40인과 비슷한 규모, 선동열·최동원·이종범·장효조·이만수·김시진 포함).
 * 예전 기준(2,000안타·300홈런·150승 같은 누적 기록)은 144경기 시대의 오래 뛴 선수만 들어가 1980~90년대 스타가 빠졌다. 누적 기록은 헌액 사유로만 적는다
 */
export const HOF_WAR = 45;
export const HOF_PEAK5 = 30;
/** 헌액 사유로 함께 적는 누적 기록 */
export const HOF_RULES: { label: string; test: (c: Career) => boolean }[] = [
  { label: '2,000안타', test: (c) => c.bat.h >= 2000 },
  { label: '300홈런', test: (c) => c.bat.hr >= 300 },
  { label: '1,200타점', test: (c) => c.bat.rbi >= 1200 },
  { label: '150승', test: (c) => c.pit.w >= 150 },
  { label: '300세이브', test: (c) => c.pit.sv >= 300 },
  { label: '2,000탈삼진', test: (c) => c.pit.so >= 2000 },
];
export const HOF_MVP = 2;
/** 구단 레전드·은퇴식 대상: 그 구단에서 뛴 시즌 수 */
export const LEGEND_SEASONS = 8;
/** 구단 레전드 한 명당 관중률, 최대 */
export const LEGEND_FILL = 0.01;
export const LEGEND_FILL_MAX = 0.03;
/** 은퇴식 대상: 그 구단에서 FAREWELL_SEASONS 시즌 이상 뛰고 통산 기록이 뚜렷한 선수 (프랜차이즈 스타, 임시값) */
export const FAREWELL_SEASONS = 10;
export function farewellWorthy(c: Career, franchise: string): boolean {
  if ((c.franchiseSeasons[franchise] ?? 0) < FAREWELL_SEASONS) return false;
  return c.bat.h >= 1000 || c.pit.w >= 60 || c.pit.sv >= 100 || HOF_RULES.some((r) => r.test(c));
}
/** 은퇴식: 다음 시즌 개막 사흘 동안 관중률 */
export const FAREWELL_FILL = 0.15;
export const FAREWELL_DAYS = 3;

export interface HofEntry {
  c: Career;
  /** 헌액 연도 (은퇴 다음 해) */
  year: number;
  reasons: string[];
}

/** 명예의 전당: 은퇴(지금 리그에 없는) 선수 중 기준을 넘은 선수. 기록에서 바로 계산하므로 저장할 것이 없다 */
export function hallOfFame(league: LeagueState, all: Map<string, Career>): HofEntry[] {
  const mvps = new Map<string, number>();
  for (const a of league.awards ?? []) if (a.mvp) mvps.set(a.mvp.id, (mvps.get(a.mvp.id) ?? 0) + 1);
  const out: HofEntry[] = [];
  for (const c of all.values()) {
    if (c.active) continue;
    const { total, peak5 } = warSummary(c.wars);
    const mvp = mvps.get(c.id) ?? 0;
    if (total < HOF_WAR && peak5 < HOF_PEAK5 && mvp < HOF_MVP) continue;
    const reasons = [
      ...(total >= HOF_WAR ? [`통산 가치 ${total.toFixed(0)}승`] : []),
      ...(peak5 >= HOF_PEAK5 ? [`최고 5시즌 ${peak5.toFixed(0)}승`] : []),
      ...(mvp >= HOF_MVP ? [`MVP ${mvp}회`] : []),
      ...HOF_RULES.filter((r) => r.test(c)).map((r) => r.label),
    ];
    out.push({ c, year: c.lastYear + 1, reasons });
  }
  return out.sort((a, b) => b.year - a.year || b.reasons.length - a.reasons.length || a.c.name.localeCompare(b.c.name));
}

/** 그 구단의 레전드 후보: 은퇴했고 그 구단에서 LEGEND_SEASONS 시즌 이상 뛴 선수 */
export function legendCandidates(all: Map<string, Career>, franchise: string): Career[] {
  return [...all.values()].filter((c) => !c.active && (c.franchiseSeasons[franchise] ?? 0) >= LEGEND_SEASONS)
    .sort((a, b) => (b.franchiseSeasons[franchise] ?? 0) - (a.franchiseSeasons[franchise] ?? 0) || a.name.localeCompare(b.name));
}

/** 구단 레전드가 주는 관중률 보정 */
export function legendFill(league: Pick<LeagueState, 'legends'>, franchise: string): number {
  const n = (league.legends ?? []).filter((l) => l.franchise === franchise).length;
  return Math.min(LEGEND_FILL_MAX, n * LEGEND_FILL);
}
