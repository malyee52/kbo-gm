// 퓨처스리그 (2군) 간단 모델 (docs/roadmap.md 2장 3단계, 2026-10-11 사용자 결정: 경기를 한 타석씩 돌리지 않고 능력으로 성적을 만든다).
//
// 2군 경기 수 = (구단이 치른 1군 경기 − 그 선수가 1군에 있던 경기 − 결장한 경기) × FUT_GAME_RATIO.
// 출전 몫은 그 구단 2군 안의 순위로 (주전급 2군 야수는 매 경기 4타석, 2군 선발은 로테이션 5명 ...).
// 결과는 능력(리그 평균 대비 비율)을 2군 수준의 평균 상대와 맞붙인 기대값에, 선수마다 시즌 운(시드)을 곱한다.
// 필요할 때 계산하므로(재정 seasonFlows처럼) 저장할 것이 없고, 며칠씩 나눠 진행해도 결과가 같다.
// 창단 뒤 1군 진입 전 퓨처스 구단은 시즌 월드에 없어 따로 받는다 (extra: 모든 선수가 2군, 경기 수는 리그 평균).
// 오프시즌 성장 판정은 이 성적의 출전량(기회)과 시즌 운(활약·부진)을 쓴다 (futuresGrowth, 2026-10-12).

import { DEFAULT_PARAMS, isStarterSkill, Rng, type EngineParams, type Season, type SimPlayer, type World } from '../engine';
import type { DataStore } from '../data/types';
import type { LeagueState } from './types';
import { isFuturesTeam, worldFromLeague } from './world';

/** 1군 경기 수 대비 퓨처스리그 경기 수 (임시값: 1군 144경기, 퓨처스 약 115경기) */
export const FUT_GAME_RATIO = 0.8;

/**
 * 퓨처스리그 환경: 1군 리그 비율 대비 (임시값. 퓨처스리그는 타율 .270 안팎, 평균자책 4.8 안팎).
 * 2군 선수끼리 붙으므로 능력은 "2군 선수 평균 대비"로 다시 잰다 (모두 1군 평균보다 약해 그대로 쓰면 리그 전체가 낮게 나온다)
 */
const FUT_ENV = { so: 0.98, bb: 1.08, hbp: 1.1, hr: 0.8, s1: 1.05, d2: 1.0, t3: 1.2 };
/** 경기당 한 팀 타석 (득점·실점을 같은 양으로 맞출 때) */
const PA_PER_GAME = 38;

/** 2군 안 순위별 출전: 야수 경기당 타석, 투수 */
const HIT_PA = [4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 3.8, 2.0, 1.8, 1.5, 1.2, 1.0];
const HIT_PA_REST = 0.4;
const ROT = 5;
const RELIEF_APPS = 0.4;
const RELIEVERS = 8;
const PIT_REST_APPS = 0.08;

export interface FuturesBat { g: number; pa: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; so: number }
export interface FuturesPit { g: number; gs: number; outs: number; bf: number; h: number; hr: number; bb: number; so: number; r: number; er: number }
/** form: 시즌 운 (−1 부진 ~ +1 활약). 능력에서 기대한 만큼보다 잘했나 */
export interface FuturesLine { idx: number; teamIdx: number; bat?: FuturesBat; pit?: FuturesPit; form: number; starter?: boolean }
export interface FuturesTeam { team: number; g: number; w: number; l: number; rs: number; ra: number }

/** 시즌 기록(SeasonLine.fbat·fpit)에 남기는 퓨처스 성적의 키 순서 */
export const FUT_BAT_KEYS = ['g', 'pa', 'ab', 'h', 'd', 't', 'hr', 'bb', 'so'] as const;
export const FUT_PIT_KEYS = ['g', 'gs', 'outs', 'bf', 'h', 'hr', 'bb', 'so', 'r', 'er'] as const;

/** 퓨처스 줄을 시즌 기록용 배열로 (출전이 없으면 빈 객체). 소수점은 반올림해 정수로 남긴다 */
export function futuresRecord(l: FuturesLine | undefined): { fbat?: number[]; fpit?: number[] } {
  if (!l) return {};
  return {
    ...(l.bat && l.bat.pa > 0 ? { fbat: FUT_BAT_KEYS.map((k) => Math.round(l.bat![k])) } : {}),
    ...(l.pit && l.pit.bf > 0 ? { fpit: FUT_PIT_KEYS.map((k) => Math.round(l.pit![k])) } : {}),
  };
}

/** 시즌 기록의 배열을 다시 퓨처스 줄로 (화면 표시용) */
export function futuresFromRecord(fbat?: number[], fpit?: number[]): Pick<FuturesLine, 'bat' | 'pit'> {
  const dec = <K extends string>(keys: readonly K[], arr: number[]) => Object.fromEntries(keys.map((k, i) => [k, arr[i] ?? 0])) as Record<K, number>;
  return { ...(fbat ? { bat: dec(FUT_BAT_KEYS, fbat) } : {}), ...(fpit ? { pit: dec(FUT_PIT_KEYS, fpit) } : {}) };
}

/** 지금까지 그 선수가 결장한 날 수 (시즌 시작 결장 + 결장 기록) */
function absentDays(season: Season, p: SimPlayer, today: number): number {
  let d = Math.min(today, Math.max(0, p.startAbsent ?? 0));
  for (const a of season.absences) {
    if (a.idx !== p.idx) continue;
    d += Math.max(0, Math.min(a.until, today) - Math.max(a.day, p.startAbsent ?? 0));
  }
  return Math.min(today, d);
}

/** BaseRuns: 사건 수로 득점 추정 */
function baseRuns(h: number, d: number, t: number, hr: number, bb: number, ab: number): number {
  const tb = h + d + 2 * t + 3 * hr;
  const A = h + bb - hr;
  const B = (1.4 * tb - 0.6 * h - 3 * hr + 0.1 * bb) * 1.02;
  const C = ab - h;
  return B + C > 0 ? (A * B) / (B + C) + hr : hr;
}

/**
 * 지금까지(정규시즌 경과 날짜까지)의 퓨처스리그 성적: 선수별 줄과 구단 순위.
 * registered: 구단별 지금 1군 명단 (2군 안 순위를 정할 때 뺀다)
 */
type Store = Pick<DataStore, 'meta' | 'season' | 'traits'>;

/** 퓨처스 구단(1군 진입 전 창단 구단)의 선수. idx는 시즌 월드 선수 뒤로 붙인다 (시즌 기록 색인과 겹치지 않게) */
export interface FuturesExtra {
  team: number;
  org: SimPlayer[];
}

export function futuresSeason(world: World, season: Season, seed: string, registered: (team: number) => Set<number>,
                              extra: FuturesExtra[] = []): { lines: Map<number, FuturesLine>; teams: FuturesTeam[] } {
  const lg = world.league;
  const today = Math.min(season.day, season.schedule.length);
  const rng = (p: SimPlayer) => new Rng(`${seed}/futures/${world.year}/${p.id}`);
  const avgG = world.teams.length ? world.teams.reduce((x, t) => x + season.teams[t.idx].g, 0) / world.teams.length : 0;
  const units = [
    ...world.teams.map((t) => ({ team: t.idx, org: t.org, tg: season.teams[t.idx].g, extra: false })),
    ...extra.map((e) => ({ team: e.team, org: e.org, tg: Math.round(avgG), extra: true })),
  ];

  // 1) 출전량: 야수 타석, 투수 상대 타자 (구단 2군 안의 순위로)
  const batPA = new Map<number, { p: SimPlayer; pa: number; g: number }>();
  const pitBF = new Map<number, { p: SimPlayer; bf: number; apps: number; st: boolean }>();
  const futGames = new Map<number, number>();
  for (const team of units) {
    const tg = team.tg;
    futGames.set(team.team, Math.round(tg * FUT_GAME_RATIO));
    const reg = team.extra ? new Set<number>() : registered(team.team);
    const perDay = today > 0 ? tg / today : 0;
    const games = (p: SimPlayer) => (team.extra ? tg : Math.max(0, tg - season.activeDays[p.idx] - absentDays(season, p, today) * perDay)) * FUT_GAME_RATIO;
    const hitters = team.org.filter((p) => !p.isPitcher && p.bat && !reg.has(p.idx)).sort((a, b) => b.value - a.value || a.idx - b.idx);
    hitters.forEach((p, i) => {
      const n = games(p);
      const paPer = HIT_PA[i] ?? HIT_PA_REST;
      const pa = Math.round(n * paPer);
      if (pa >= 1) batPA.set(p.idx, { p, pa, g: Math.round(n * Math.min(1, paPer / 4)) });
    });
    const pitchers = team.org.filter((p) => p.isPitcher && p.pit && !reg.has(p.idx));
    const starters = pitchers.filter((p) => isStarterSkill(p.pit)).sort((a, b) => a.value - b.value || a.idx - b.idx).slice(0, ROT);
    const relievers = pitchers.filter((p) => !starters.includes(p)).sort((a, b) => a.value - b.value || a.idx - b.idx);
    for (const p of pitchers) {
      const n = games(p);
      const st = starters.includes(p);
      const ri = relievers.indexOf(p);
      const apps = st ? n / ROT : n * (ri >= 0 && ri < RELIEVERS ? RELIEF_APPS : PIT_REST_APPS);
      const bf = Math.round(apps * (st ? Math.min(26, p.pit!.stamina * 0.95) : Math.max(3, p.pit!.reliefStint)));
      if (bf >= 1) pitBF.set(p.idx, { p, bf, apps, st });
    }
  }

  // 2) 2군 선수 평균 능력 (출전량 가중)
  const KB = ['so', 'bb', 'hbp', 'hr', 's1', 'd2', 't3'] as const;
  const mb: Record<string, number> = {};
  const wb = [...batPA.values()].reduce((x, v) => x + v.pa, 0) || 1;
  for (const k of KB) mb[k] = [...batPA.values()].reduce((x, v) => x + v.p.bat![k] * v.pa, 0) / wb || 1;
  const KP = ['so', 'bb', 'hbp', 'hr', 'hit'] as const;
  const mp: Record<string, number> = {};
  const wp = [...pitBF.values()].reduce((x, v) => x + v.bf, 0) || 1;
  for (const k of KP) mp[k] = [...pitBF.values()].reduce((x, v) => x + v.p.pit![k] * v.bf, 0) / wp || 1;

  // 3) 결과
  const lines = new Map<number, FuturesLine>();
  const rs = new Map<number, { runs: number; pa: number }>();
  const ra = new Map<number, { runs: number; bf: number }>();
  for (const { p, pa, g } of batPA.values()) {
    const u = rng(p).next();
    const luck = Math.exp((u - 0.5) * 0.3); // 시즌 운 ±15% 안팎
    const rate = (k: (typeof KB)[number]) => lg[k] * FUT_ENV[k] * (p.bat![k] / mb[k]);
    const so = Math.round(pa * rate('so') / luck);
    const bb = Math.round(pa * rate('bb') * luck);
    const hbp = Math.round(pa * rate('hbp'));
    const hr = Math.round(pa * rate('hr') * luck);
    const d = Math.round(pa * rate('d2') * luck);
    const t = Math.round(pa * rate('t3'));
    const s1 = Math.round(pa * rate('s1') * luck);
    const h = s1 + d + t + hr;
    const ab = Math.max(h, pa - bb - hbp);
    lines.set(p.idx, { idx: p.idx, teamIdx: p.teamIdx, bat: { g, pa, ab, h, d, t, hr, bb: bb + hbp, so: Math.min(so, ab - h) }, form: (u - 0.5) * 2 });
    const r = rs.get(p.teamIdx) ?? { runs: 0, pa: 0 };
    r.runs += baseRuns(h, d, t, hr, bb + hbp, ab);
    r.pa += pa;
    rs.set(p.teamIdx, r);
  }
  for (const { p, bf, apps, st } of pitBF.values()) {
    const ps = p.pit!;
    const u = rng(p).next();
    const luck = Math.exp((u - 0.5) * 0.3);
    const rel = (k: (typeof KP)[number]) => ps[k] / mp[k];
    const so = Math.round(bf * lg.so * FUT_ENV.so * rel('so') * luck);
    const bb = Math.round(bf * (lg.bb * FUT_ENV.bb * rel('bb') + lg.hbp * FUT_ENV.hbp * rel('hbp')) / luck);
    const hr = Math.round(bf * lg.hr * FUT_ENV.hr * rel('hr') / luck);
    const hitRate = (lg.s1 * FUT_ENV.s1 + lg.d2 * FUT_ENV.d2 + lg.t3 * FUT_ENV.t3) * rel('hit') / luck;
    const h = Math.round(bf * hitRate) + hr;
    const d = Math.round(bf * lg.d2 * FUT_ENV.d2 * rel('hit') / luck);
    const ab = Math.max(h, bf - bb);
    const outs = Math.max(0, bf - h - bb);
    const runs = baseRuns(h, d, 0, hr, bb, ab);
    const rr = Math.round(runs);
    lines.set(p.idx, { idx: p.idx, teamIdx: p.teamIdx, pit: { g: Math.round(apps), gs: st ? Math.round(apps) : 0, outs, bf, h, hr, bb, so, r: rr, er: Math.round(rr * 0.92) }, form: (u - 0.5) * 2, starter: st });
    const x = ra.get(p.teamIdx) ?? { runs: 0, bf: 0 };
    x.runs += runs;
    x.bf += bf;
    ra.set(p.teamIdx, x);
  }

  // 4) 순위: 득점·실점을 타석당으로 바꿔 같은 양(경기 수 × PA_PER_GAME)으로 맞추고 피타고리안 승률
  const teams: FuturesTeam[] = units.map(({ team: idx }) => {
    const futG = futGames.get(idx) ?? 0;
    const vol = futG * PA_PER_GAME;
    const r = rs.get(idx);
    const a = ra.get(idx);
    const runsFor = r && r.pa ? (r.runs / r.pa) * vol : 0;
    const runsAg = a && a.bf ? (a.runs / a.bf) * vol : 0;
    const pct = runsFor + runsAg > 0 ? runsFor ** 1.83 / (runsFor ** 1.83 + runsAg ** 1.83) : 0.5;
    const w = Math.round(futG * pct);
    return { team: idx, g: futG, w, l: futG - w, rs: Math.round(runsFor), ra: Math.round(runsAg) };
  });
  return { lines, teams: teams.sort((a, b) => b.w / Math.max(1, b.g) - a.w / Math.max(1, a.g) || a.team - b.team) };
}

/** 퓨처스 구단(그 해 1군 진입 전 창단 구단)의 선수를 시즌 월드 선수 뒤 색인으로 만든다. 없으면 [] */
export function futuresExtras(league: LeagueState, store: Store, world: World, params: EngineParams = DEFAULT_PARAMS): FuturesExtra[] {
  const teams = league.teams.map((_, i) => i).filter((i) => isFuturesTeam(league, i, world.year));
  if (!teams.length) return [];
  const all = worldFromLeague(league, store, params, { includeFutures: true });
  let k = world.players.length;
  return teams.map((team) => ({ team, org: (all.teams[team]?.org ?? []).map((p) => ({ ...p, idx: k++ })) }));
}

/**
 * 구단의 지금 1군 명단 (직접 관리하면 그 명단, 아니면 AI 엔트리). 화면과 결산이 같은 기준을 쓴다.
 * AI 엔트리는 마지막으로 짠 명단을 읽지 않고 지금 날짜로 다시 짜 본다: 불러온 직후에는 명단이 비어 있고
 * 시즌이 끝난 뒤 화면 조회로 명단이 바뀔 수 있어, 저장을 끼운 결산이 끊김 없이 한 결산과 달라졌다 (2026-10-23)
 */
export function registeredOf(season: Season, team: number): Set<number> {
  const ts = season.teamSeasons[team];
  if (ts.manual) return new Set(ts.manual);
  const a = season.activeAt(team);
  return new Set([...a.hitters, ...a.rotation, ...a.bullpen].map((p) => p.idx));
}

// ---- 성장 판정 (offseason.ts beginOffseason)

/** 퓨처스 출전을 "한 시즌 다 뛴 것"으로 보는 양 (임시값): 야수 400타석, 선발 450타자, 구원 180타자 */
export const FUT_FULL = { bat: 400, sp: 450, rp: 180 };
/** 퓨처스에서 꽉 채워 뛴 시즌을 1군 출전 기회 몇으로 치나 (임시값. 예전에는 25세 이하 2군 선수 모두 0.5로 쳤다) */
export const FUTURES_WEIGHT = 0.7;
/** 퓨처스 활약·부진이 성장에 주는 폭 (런, 임시값). 시즌 운 ±1 × 표본 신뢰도 */
export const FUT_FORM_RUNS = 0.4;

/** 퓨처스 출전 기회 (0~1) */
export function futuresOpportunity(line: FuturesLine | undefined): number {
  if (!line) return 0;
  if (line.bat) return Math.min(1, line.bat.pa / FUT_FULL.bat);
  if (line.pit) return Math.min(1, line.pit.bf / (line.starter ? FUT_FULL.sp : FUT_FULL.rp));
  return 0;
}

/** 퓨처스 활약도 (−1~+1): 시즌 운 × 표본 신뢰도 (출전 기회) */
export function futuresForm(line: FuturesLine | undefined): number {
  return line ? line.form * futuresOpportunity(line) : 0;
}
