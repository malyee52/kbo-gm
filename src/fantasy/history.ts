// 회귀자 모드 (docs/fantasy-mode.md 2단계): 단장이 기억하는 "원래 역사" = 실제 자료의 시즌들. 기록 사실만 담는다.
// - 시즌별 최종 순위(1위 = 한국시리즈 우승, 진행 중인 해는 정규시즌 순위)와 주요 타이틀, 가치(WAR 비슷한 값) 상위 선수
// - 지금 리그 선수 가운데 앞으로 크게 터지는 선수 (실제 미래 기록)
// - 앞으로의 신인 드래프트에서 나중에 크게 된 선수
// - 게임 결과가 원래 역사와 갈라진 지점 (우승 구단)
import type { BatRow, DataStore, DraftRow, PitRow, SeasonData } from '../data/types';
import type { LeagueState } from '../league/types';
import { batWarOf, pitWarOf, realEnvOf } from '../league/war';

type Store = Pick<DataStore, 'meta' | 'season' | 'players'> & Partial<Pick<DataStore, 'drafts'>>;

export interface MemoryLeader { label: string; name: string; team: string; value: string }
export interface MemoryStar { id: string; name: string; team: string; war: number; line: string }
export interface SeasonMemory {
  year: number;
  /** 진행 중인 시즌 자료 (최종 순위가 아직 정규시즌 순위) */
  inProgress: boolean;
  standings: { team: string; rank: number; w: number; l: number; t: number }[];
  champion: string | null;
  leaders: MemoryLeader[];
  stars: MemoryStar[];
}

const nameOf = (store: Store, id: string) => store.players.get(id)?.name ?? id;
const rate3 = (x: number) => x.toFixed(3).replace(/^0/, '');
const ip = (outs: number) => `${Math.floor(outs / 3)}${outs % 3 ? ` ${outs % 3}/3` : ''}`;

function batLine(r: BatRow): string {
  const avg = r.ab ? r.h / r.ab : 0;
  return `타율 ${rate3(avg)} ${r.hr}홈런 ${r.rbi}타점`;
}
function pitLine(r: PitRow): string {
  const era = r.outs ? (r.er * 27) / r.outs : 0;
  return `${ip(r.outs)}이닝 ${r.w}승 ${r.l}패${r.sv ? ` ${r.sv}세이브` : ''} 평균자책 ${era.toFixed(2)}`;
}

/** 한 시즌의 원래 역사 */
export function seasonMemory(store: Store, year: number): SeasonMemory | null {
  const sd = store.season(year) as SeasonData | undefined;
  if (!sd) return null;
  const inProgress = store.meta.inProgress.includes(year);
  const standings = [...sd.teams].sort((a, b) => a.rank - b.rank).map((t) => ({ team: t.name, rank: t.rank, w: t.w, l: t.l, t: t.t }));
  const games = Math.max(...sd.teams.map((t) => t.g));
  const qualPa = Math.ceil(3.1 * games);
  const qualOuts = 3 * games;
  const top = <T>(rows: T[], val: (r: T) => number, low = false) => [...rows].sort((a, b) => (low ? val(a) - val(b) : val(b) - val(a)))[0];
  const leaders: MemoryLeader[] = [];
  const addBat = (label: string, rows: BatRow[], val: (r: BatRow) => number, fmt: (r: BatRow) => string) => {
    const r = rows.length ? top(rows, val) : undefined;
    if (r) leaders.push({ label, name: nameOf(store, r.id), team: r.team, value: fmt(r) });
  };
  const addPit = (label: string, rows: PitRow[], val: (r: PitRow) => number, fmt: (r: PitRow) => string, low = false) => {
    const r = rows.length ? top(rows, val, low) : undefined;
    if (r) leaders.push({ label, name: nameOf(store, r.id), team: r.team, value: fmt(r) });
  };
  const qual = sd.bat.filter((r) => r.pa >= qualPa);
  addBat('타율', qual, (r) => (r.ab ? r.h / r.ab : 0), (r) => rate3(r.ab ? r.h / r.ab : 0));
  addBat('홈런', sd.bat, (r) => r.hr, (r) => `${r.hr}개`);
  addBat('타점', sd.bat, (r) => r.rbi, (r) => `${r.rbi}개`);
  addBat('안타', sd.bat, (r) => r.h, (r) => `${r.h}개`);
  addPit('다승', sd.pit, (r) => r.w, (r) => `${r.w}승`);
  addPit('평균자책', sd.pit.filter((r) => r.outs >= qualOuts), (r) => (r.er * 27) / Math.max(1, r.outs), (r) => ((r.er * 27) / Math.max(1, r.outs)).toFixed(2), true);
  addPit('탈삼진', sd.pit, (r) => r.so, (r) => `${r.so}개`);
  addPit('세이브', sd.pit, (r) => r.sv, (r) => `${r.sv}개`);
  // 가치 상위 (투수의 타격은 빼고)
  const env = realEnvOf(store, year);
  const war = new Map<string, MemoryStar>();
  for (const r of sd.bat) {
    if (store.players.get(r.id)?.kind === 'P') continue;
    const w = batWarOf(r, r.pos, env);
    war.set(r.id, { id: r.id, name: nameOf(store, r.id), team: r.team, war: w, line: batLine(r) });
  }
  for (const r of sd.pit) {
    const w = pitWarOf(r, env);
    const cur = war.get(r.id);
    if (!cur || w > cur.war) war.set(r.id, { id: r.id, name: nameOf(store, r.id), team: r.team, war: w + (cur?.war ?? 0), line: pitLine(r) });
  }
  const stars = [...war.values()].sort((a, b) => b.war - a.war).slice(0, 8).map((s) => ({ ...s, war: Math.round(s.war * 10) / 10 }));
  return { year, inProgress, standings, champion: inProgress ? null : standings[0]?.team ?? null, leaders, stars };
}

/** 그 선수의 실제 시즌별 가치 (자료가 있는 해) */
function warByYear(store: Store, id: string, from: number): { year: number; war: number; team: string; line: string }[] {
  const out: { year: number; war: number; team: string; line: string }[] = [];
  for (const y of store.meta.years) {
    if (y < from) continue;
    const sd = store.season(y) as SeasonData | undefined;
    if (!sd) continue;
    const env = realEnvOf(store, y);
    const isP = store.players.get(id)?.kind === 'P';
    const b = isP ? undefined : sd.bat.find((r) => r.id === id);
    const p = sd.pit.find((r) => r.id === id);
    if (!b && !p) continue;
    const w = (b ? batWarOf(b, b.pos, env) : 0) + (p ? pitWarOf(p, env) : 0);
    out.push({ year: y, war: w, team: (b ?? p)!.team, line: p && (!b || pitWarOf(p, env) > batWarOf(b, b.pos, env)) ? pitLine(p) : batLine(b!) });
  }
  return out;
}

export interface Breakout { id: string; name: string; team: string; year: number; war: number; line: string; age: number | null }

/**
 * 지금 리그(실존 선수) 가운데 앞으로 크게 터지는 선수: from 해부터 자료 끝까지의 최고 시즌 가치가 큰 순.
 * 지금 이미 정상급인 선수(직전 해 가치 4 이상)는 뺀다 (모두가 아는 선수는 기억할 거리가 아니다)
 */
export function breakouts(store: Store, league: LeagueState, from: number, n = 15): Breakout[] {
  const out: Breakout[] = [];
  for (const p of league.players) {
    if (!p.real || p.foreign || p.team < 0) continue;
    const ys = warByYear(store, p.id, from - 1);
    const before = ys.find((x) => x.year === from - 1)?.war ?? 0;
    if (before >= 4) continue;
    const best = ys.filter((x) => x.year >= from).sort((a, b) => b.war - a.war)[0];
    if (!best || best.war < 3) continue;
    out.push({ id: p.id, name: p.name, team: league.teams[p.team]?.name ?? '', year: best.year, war: Math.round(best.war * 10) / 10, line: best.line, age: p.birthYear ? best.year - p.birthYear : null });
  }
  return out.sort((a, b) => b.war - a.war).slice(0, n);
}

export interface DraftGem { name: string; year: number; team: string; pick: string; peakYear: number; peakWar: number; career: number }

/** 그 해 입단 신인 지명(실제)에서 나중에 크게 된 선수 (자료가 있는 해까지의 통산 가치 순) */
export function draftGems(store: Store, entryYear: number, n = 8): DraftGem[] {
  const rows = (store.drafts?.[String(entryYear)] ?? []).filter((d: DraftRow) => d.kind !== '원년 멤버');
  const byName = new Map<string, string[]>();
  for (const [id, m] of store.players) (byName.get(m.name) ?? byName.set(m.name, []).get(m.name)!).push(id);
  const out: DraftGem[] = [];
  for (const d of rows) {
    const id = d.pid ?? (byName.get(d.name) ?? []).find((x) => Math.abs((store.players.get(x)?.entryYear ?? 0) - entryYear) <= 1);
    if (!id) continue;
    const ys = warByYear(store, id, entryYear);
    if (!ys.length) continue;
    const career = ys.reduce((s, x) => s + x.war, 0);
    const peak = [...ys].sort((a, b) => b.war - a.war)[0];
    if (career < 5) continue;
    out.push({ name: d.name, year: entryYear, team: d.team, pick: d.kind === '라운드' ? `${d.round}라운드${d.overall ? ` 전체 ${d.overall}순위` : ''}` : d.kind,
      peakYear: peak.year, peakWar: Math.round(peak.war * 10) / 10, career: Math.round(career * 10) / 10 });
  }
  return out.sort((a, b) => b.career - a.career).slice(0, n);
}

export interface Divergence { year: number; realChampion: string | null; gameChampion: string | null; same: boolean }

/** 게임에서 치른 시즌의 우승이 원래 역사와 같은가 */
export function divergences(store: Store, league: LeagueState): Divergence[] {
  const out: Divergence[] = [];
  for (const yr of league.yearbook ?? []) {
    if (!yr.inGame) continue;
    const mem = seasonMemory(store, yr.year);
    if (!mem) continue;
    const game = yr.champion;
    out.push({ year: yr.year, realChampion: mem.champion, gameChampion: game, same: !!game && game === mem.champion });
  }
  return out;
}

/** AI에게 줄 원래 역사 요약 (지금 시즌과 다음 두 해) */
export function memoryContext(store: Store, league: LeagueState, year: number): string {
  const out: string[] = ['[원래 역사: 단장(플레이어)만 기억하는 실제 기록. 게임은 이와 다르게 흘러갈 수 있다]'];
  for (const y of [year, year + 1, year + 2]) {
    const m = seasonMemory(store, y);
    if (!m) continue;
    out.push(`${y}: ${m.champion ? `우승 ${m.champion}` : '(시즌 진행 중 자료)'}, 순위 ${m.standings.map((s) => s.team).join('>')}`);
    out.push(`  타이틀: ${m.leaders.map((l) => `${l.label} ${l.name}(${l.team}) ${l.value}`).join(', ')}`);
  }
  const div = divergences(store, league).filter((d) => !d.same);
  if (div.length) out.push(`[역사가 바뀐 시즌] ${div.map((d) => `${d.year}: 원래 ${d.realChampion ?? '?'} 우승 → 이번에는 ${d.gameChampion ?? '?'}`).join('; ')}`);
  return out.join('\n');
}
