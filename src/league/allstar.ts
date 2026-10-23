// 올스타전 (2026-10-14): 시즌 중반 휴식일에 드림·나눔 올스타가 시범 경기와 홈런 더비를 치른다.
// - 날짜: 연도별 일정 규칙 표의 올스타 날 (일정 개편 11단계). 올스타가 없던 해(2020·2021)는 열지 않는다.
//   실제 올스타전이 여러 경기였던 해(1982~1985, 2000)도 게임은 1경기다 (일정 개편 결정 10, 개막 알림에 적는다).
//   휴식기는 일정 규칙 표의 쉬는 기간으로 일정에 비어 있고, 그날 모든 투수의 피로도 없앤다 (예전 동작 그대로).
//   규칙 표가 없는 월드(시험용)는 예전처럼 7월 14일에 가장 가까운 휴식일 (시즌의 35~75% 사이).
// - 선발: 팬 투표·감독 추천 대신 그날까지의 시즌 WAR + 지금 능력으로 자리별 1명, 후보 야수 5명, 선발 4명·구원 6명.
// - 경기: 엔진 시범 경기(Season.playExhibition, 시즌 기록·난수와 따로). MVP는 이긴 쪽에서 가장 잘한 선수.
// - 홈런 더비: 그날까지 홈런 상위 8명, 아웃 7개씩, 상위 2명 결승.
// 난수는 리그 시드·연도로 만든 따로 된 Rng만 쓴다 (시즌 결과를 바꾸지 않는다).
import { isStarterSkill, Rng, type ExhibitionSide, type Season, type SimPlayer, type World } from '../engine';
import { currentRuns, type ValueContext } from '../ai/value';
import { daysBetween, type YearScheduleRule } from '../data/schedule';
import { dateOf } from '../game/calendar';
import { seasonWar } from './awards';
import type { LeagueState } from './types';

/** 드림·나눔 구성 (2015년부터의 실제 구성을 계보로). 그 전 시대도 같은 이름·구성을 쓴다 (임시값: 옛 동군·서군 구성은 확인하지 못했다) */
const DREAM = ['두산', '롯데', '삼성', 'SSG', 'KT', '현대계'];
const NANUM = ['LG', 'KIA', '한화', '히어로즈', 'NC', '쌍방울'];
export const SIDE_NAMES: [string, string] = ['드림 올스타', '나눔 올스타'];
const FIELD_POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;
const BENCH = 5;
const SP_N = 4;
const RP_N = 6;
const DERBY_N = 8;
const DERBY_OUTS = 7;
/** 올스타 선발 때 팬 만족도 (선발 1명마다, MVP·더비 우승은 따로). 임시값 */
export const ALLSTAR_FAN = { perPlayer: 0.4, mvp: 1.5, derby: 1, max: 4 };

export interface AllStarPick { id: string; name: string; side: 0 | 1; team: number; pos: string; starter: boolean }
export interface AllStarRecord {
  year: number;
  day: number;
  /** 구단 색인 (드림, 나눔) */
  teams: [number[], number[]];
  /** 홈 쪽 (0 드림, 1 나눔) */
  home: 0 | 1;
  roster: AllStarPick[];
  game: {
    /** [드림, 나눔] 점수 */
    score: [number, number];
    innings: number;
    line: { away: number[]; home: number[] };
    mvp: string | null;
    /** [id, 타수, 안타, 홈런, 타점] */
    bat: [string, number, number, number, number][];
    /** [id, 아웃, 실점, 탈삼진] */
    pit: [string, number, number, number][];
  };
  derby: { round1: [string, number][]; final: [string, number][]; winner: string | null };
}

/**
 * 올스타전 날 (일정 색인). 일정 규칙(rule)이 있으면 그 표의 올스타 날 (없는 해는 -1). 그날 경기가 있으면(구단 수가 표와 달라
 * 일정을 따로 펼친 월드) 그 날짜에 가장 가까운 휴식일. 규칙이 없으면 7월 14일에 가장 가까운 휴식일, 시즌의 35~75% 사이. 없으면 -1
 */
export function allStarDay(schedule: readonly (readonly unknown[])[], year: number, rule?: Pick<YearScheduleRule, 'opening' | 'allStar'>): number {
  const n = schedule.length;
  if (rule) {
    if (!rule.allStar) return -1;
    const d = daysBetween(rule.opening, rule.allStar);
    if (d >= 0 && d < n && !schedule[d].length) return d;
  }
  const target = rule?.allStar ? Date.UTC(year, Number(rule.allStar.slice(5, 7)) - 1, Number(rule.allStar.slice(8, 10))) : Date.UTC(year, 6, 14);
  let best = -1;
  let bestGap = Infinity;
  for (let d = Math.ceil(n * 0.35); d <= Math.floor(n * 0.75) && d < n; d++) {
    if (schedule[d].length) continue;
    const dt = dateOf(year, d);
    const gap = Math.abs(Date.UTC(dt.year, dt.month - 1, dt.date) - target);
    if (gap < bestGap) { best = d; bestGap = gap; }
  }
  return best;
}

/** 구단을 드림(0)·나눔(1)으로. 계보를 모르는 구단(창단 등)은 적은 쪽으로 */
export function allStarSides(world: Pick<World, 'teams'>): [number[], number[]] {
  const out: [number[], number[]] = [[], []];
  const unknown: number[] = [];
  for (const t of world.teams) {
    if (DREAM.includes(t.franchise)) out[0].push(t.idx);
    else if (NANUM.includes(t.franchise)) out[1].push(t.idx);
    else unknown.push(t.idx);
  }
  for (const t of unknown) out[out[0].length <= out[1].length ? 0 : 1].push(t);
  // 한쪽이 두 구단 넘게 많으면 많은 쪽 마지막 구단을 옮긴다
  while (Math.abs(out[0].length - out[1].length) > 1) {
    const [big, small] = out[0].length > out[1].length ? [0, 1] : [1, 0];
    out[small].push(out[big].pop()!);
  }
  return out;
}

/** 자리별 선발 (그날 결장 선수 빼고). 점수 = 그날까지 시즌 WAR + 지금 능력(런)/10 */
export function pickAllStars(world: World, season: Season, ctx: ValueContext, sides: [number[], number[]], skip: (p: SimPlayer) => boolean = () => false): AllStarPick[] {
  const war = seasonWar(world, season);
  const day = season.day;
  const score = (p: SimPlayer) => (war.get(p.idx) ?? 0) + currentRuns(p, ctx) / 10;
  const out: AllStarPick[] = [];
  sides.forEach((teams, s) => {
    const side = s as 0 | 1;
    const pool = world.players
      .filter((p) => teams.includes(p.teamIdx) && season.states.absentUntil[p.idx] <= day && !skip(p))
      .sort((a, b) => score(b) - score(a) || a.idx - b.idx);
    const used = new Set<number>();
    const add = (p: SimPlayer, pos: string, starter: boolean) => { used.add(p.idx); out.push({ id: p.id, name: p.name, side, team: p.teamIdx, pos, starter }); };
    const hitters = pool.filter((p) => !p.isPitcher);
    for (const pos of FIELD_POS) {
      const p = hitters.find((h) => !used.has(h.idx) && h.pos === pos) ?? hitters.find((h) => !used.has(h.idx) && h.pos !== 'C' && pos !== 'C');
      if (p) add(p, pos, true);
    }
    const dh = hitters.find((h) => !used.has(h.idx));
    if (dh) add(dh, 'DH', true);
    // 후보: 포수 한 명은 꼭 (있으면)
    const backupC = hitters.find((h) => !used.has(h.idx) && h.pos === 'C');
    if (backupC) add(backupC, 'C', false);
    for (const h of hitters) { if (out.filter((x) => x.side === side && !x.starter && x.pos !== 'P').length >= BENCH) break; if (!used.has(h.idx)) add(h, h.pos ?? 'DH', false); }
    const pitchers = pool.filter((p) => p.isPitcher);
    const sp = pitchers.filter((p) => isStarterSkill(p.pit)).slice(0, SP_N);
    sp.forEach((p, i) => add(p, 'SP', i === 0));
    // 구원은 구원 투수부터, 모자라면 남은 선발로 (그 선발도 '선발'로 적는다)
    const need = RP_N + SP_N - sp.length;
    const rp = pitchers.filter((p) => !used.has(p.idx) && !isStarterSkill(p.pit)).slice(0, need);
    rp.forEach((p) => add(p, 'RP', false));
    pitchers.filter((p) => !used.has(p.idx)).slice(0, need - rp.length).forEach((p) => add(p, 'SP', false));
  });
  return out;
}

/** 홈런 더비 한 바퀴: 아웃 outs개가 될 때까지 친 홈런 수 */
function derbyRound(p: SimPlayer, rng: Rng, outs: number): number {
  const prob = Math.max(0.12, Math.min(0.55, 0.1 + 0.17 * (p.bat?.hr ?? 0.5)));
  let hr = 0;
  for (let o = 0; o < outs;) { if (rng.chance(prob)) hr++; else o++; }
  return hr;
}

export function homeRunDerby(season: Season, picks: SimPlayer[], rng: Rng): AllStarRecord['derby'] {
  const field = picks.filter((p) => !p.isPitcher)
    .sort((a, b) => season.bat[b.idx].hr - season.bat[a.idx].hr || (b.bat?.hr ?? 0) - (a.bat?.hr ?? 0) || a.idx - b.idx)
    .slice(0, DERBY_N);
  if (field.length < 2) return { round1: [], final: [], winner: null };
  const round1 = field.map((p) => [p, derbyRound(p, rng, DERBY_OUTS)] as const);
  const top = [...round1].sort((a, b) => b[1] - a[1] || (b[0].bat?.hr ?? 0) - (a[0].bat?.hr ?? 0) || a[0].idx - b[0].idx).slice(0, 2);
  const final = top.map(([p]) => [p, derbyRound(p, rng, DERBY_OUTS)] as [SimPlayer, number]);
  // 동점이면 아웃 3개씩 더 (열 번까지, 그래도 같으면 힘이 센 쪽)
  for (let k = 0; k < 10 && final[0][1] === final[1][1]; k++) for (const f of final) f[1] += derbyRound(f[0], rng, 3);
  const win = final[0][1] !== final[1][1] ? (final[0][1] > final[1][1] ? final[0][0] : final[1][0])
    : ((final[0][0].bat?.hr ?? 0) >= (final[1][0].bat?.hr ?? 0) ? final[0][0] : final[1][0]);
  return { round1: round1.map(([p, n]) => [p.id, n]), final: final.map(([p, n]) => [p.id, n]), winner: win.id };
}

/** 올스타전 하루: 선발 → 경기 → 홈런 더비. 리그 상태에 남기고 돌려준다 */
export function playAllStar(league: LeagueState, world: World, season: Season, ctx: ValueContext, day: number): AllStarRecord | null {
  const year = world.year;
  const sides = allStarSides(world);
  if (!sides[0].length || !sides[1].length) return null;
  const reserve = new Set(league.players.filter((p) => p.reserve !== undefined).map((p) => p.id));
  const roster = pickAllStars(world, season, ctx, sides, (p) => reserve.has(p.id));
  const byId = new Map(world.players.map((p) => [p.id, p]));
  const sideOf = (s: 0 | 1): ExhibitionSide | null => {
    const mine = roster.filter((r) => r.side === s);
    const starters = mine.filter((r) => r.starter && r.pos !== 'SP').map((r) => byId.get(r.id)!);
    const sp = mine.filter((r) => r.pos === 'SP').map((r) => byId.get(r.id)!);
    const rp = mine.filter((r) => r.pos === 'RP').map((r) => byId.get(r.id)!);
    if (starters.length < 9 || sp.length + rp.length < 2) return null;
    const pitchers = [...sp, ...rp];
    return { name: SIDE_NAMES[s], hitters: starters, pitchers, closer: rp[0] ?? null };
  };
  const dream = sideOf(0);
  const nanum = sideOf(1);
  if (!dream || !nanum) return null;
  const rng = new Rng(`${league.seed}/allstar/${year}`);
  const home: 0 | 1 = year % 2 === 0 ? 1 : 0;
  const g = season.playExhibition(home === 0 ? dream : nanum, home === 0 ? nanum : dream, rng);
  const r = g.result;
  const score: [number, number] = home === 0 ? [r.homeRuns, r.awayRuns] : [r.awayRuns, r.homeRuns];
  const played = [...g.home, ...g.away];
  const pitched = [...r.homeStaff, ...r.awayStaff].map((i) => world.players[i]);
  const bat = played.map((p) => { const b = g.bat[p.idx]; return [p.id, b.ab, b.h, b.hr, b.rbi] as [string, number, number, number, number]; });
  const pit = pitched.map((p) => { const x = g.pit[p.idx]; return [p.id, x.outs, x.r, x.so] as [string, number, number, number]; });
  // MVP: 이긴 쪽(비기면 양쪽)에서 안타 + 2×홈런 + 타점 (투수는 아웃/3 − 실점 + 탈삼진/3)
  const winSide: 0 | 1 | null = score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1;
  const sideById = new Map(roster.map((x) => [x.id, x.side]));
  const val = new Map<string, number>();
  for (const [id, , h, hr, rbi] of bat) val.set(id, h + 2 * hr + rbi);
  for (const [id, outs, runs, so] of pit) val.set(id, (val.get(id) ?? 0) + outs / 3 - runs + so / 3);
  let mvp: string | null = null;
  for (const [id, v] of val) {
    if (winSide !== null && sideById.get(id) !== winSide) continue;
    if (mvp === null || v > val.get(mvp)! || (v === val.get(mvp)! && byId.get(id)!.idx < byId.get(mvp)!.idx)) mvp = id;
  }
  const derby = homeRunDerby(season, roster.map((x) => byId.get(x.id)!), rng);
  const rec: AllStarRecord = { year, day, teams: sides, home, roster, game: { score, innings: r.innings, line: r.lineScore, mvp, bat, pit }, derby };
  league.allStars = [...(league.allStars ?? []).filter((x) => x.year !== year), rec];
  // 휴식기: 모든 투수의 피로를 없앤다
  for (const p of world.players) if (p.isPitcher) season.clearFatigue(p.idx);
  return rec;
}

/** 그 선수의 올스타 이력 (선발 횟수, MVP, 더비 우승) */
export function allStarHistory(league: Pick<LeagueState, 'allStars'>, id: string): { years: number[]; mvp: number[]; derby: number[] } {
  const out = { years: [] as number[], mvp: [] as number[], derby: [] as number[] };
  for (const r of league.allStars ?? []) {
    if (r.roster.some((x) => x.id === id)) out.years.push(r.year);
    if (r.game.mvp === id) out.mvp.push(r.year);
    if (r.derby.winner === id) out.derby.push(r.year);
  }
  return out;
}
