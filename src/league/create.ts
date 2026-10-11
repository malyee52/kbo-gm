// 새 게임의 리그 상태 만들기: 시작 연도 자료로 월드를 만들고, 잠재력·계약·연차를 붙인다.

import type { DataStore } from '../data/types';
import { DEFAULT_PARAMS, Rng, worldForYear, type EngineParams, type SimPlayer, type World } from '../engine';
import { currentRuns, valueContext } from '../ai/value';
import { initialMilitary } from './careers';
import { makeDraftee, takenNames } from './offseason';
import { lateDebutDraftees, leagueTeamFor, makeLateDraftee, servingAt } from './missing';
import { careerIndex, potentialOf, realPeakRuns, type CareerIndex } from './growth';
import { foreignSalary, marketSalary, MIN_SALARY, ORG_LIMIT, reserveTarget } from './salary';
import type { Contract, LeaguePlayer, LeagueState } from './types';
import { worldFromLeague } from './world';
import { teamChangesFor } from './eras';
import { addExpansionCapital, ensureFinance } from './finance';

type Store = Pick<DataStore, 'meta' | 'players' | 'season' | 'contracts' | 'drafts' | 'military'>;

/** 1군 연차로 치는 시즌: 100타석 또는 상대 타자 100명 이상 (임시값. 실제 등록일수 자료가 없다) */
function servedSeason(idx: CareerIndex, id: string, year: number): boolean {
  const b = idx.bat.get(id)?.find((x) => x.year === year);
  const p = idx.pit.get(id)?.find((x) => x.year === year);
  return (b?.row.pa ?? 0) >= 100 || (p?.row.tbf ?? 0) >= 100;
}

/**
 * 생년이 없는 선수(1980~90년대 자료에 많다)의 생년 추정: 입단 때 대졸 22세, 1991년 이전 입단은 23세(실업·대학 출신이 많던 시대), 그 뒤는 19세 (임시값).
 * 2026-10-08 사용자 결정: 빈 자료는 추정치로 채운다. 화면에는 "약 N세"로 표시한다 (birthYearEstimated).
 */
export function estimatedBirthYear(m: { entryYear: number; school?: 'HS' | 'UNIV' }): number {
  const age = m.school === 'UNIV' ? 22 : m.entryYear < 1992 ? 23 : 19;
  return m.entryYear - age;
}

export interface CreatedLeague {
  league: LeagueState;
  /** 시작 연도 월드. 외국인 개막 명단이 있는 해는 명단에 없는 외국인이 빠진다 (그 밖에는 worldForYear와 같다) */
  world: World;
}

/** 시작 연도의 외국인 개막 명단 (선수 id → 아시아쿼터 여부). 명단이 없는 해는 null (기록에 있는 외국인을 모두 넣는다) */
export function openingForeigners(store: Pick<DataStore, 'meta'>, year: number): Map<string, boolean> | null {
  const teams = store.meta.foreignOpening?.[String(year)];
  if (!teams) return null;
  const m = new Map<string, boolean>();
  for (const list of Object.values(teams)) for (const x of list) m.set(x.id, x.asia);
  return m;
}

/**
 * 시작 연도 리그 상태. store에는 모든 시즌과 계약 기록이 불러와져 있어야 한다 (잠재력·연차 산출).
 * 같은 데이터·시드면 같은 결과가 나온다.
 */
export function createLeague(store: Store, startYear: number, seed: string, params: EngineParams = DEFAULT_PARAMS): CreatedLeague {
  const recorded = worldForYear(store, startYear, params);
  const ctx = valueContext(recorded);
  const opening = openingForeigners(store, startYear);
  // 외국인: 개막 명단이 있으면 그 명단의 선수만 (시즌 중 교체된 선수는 아직 오지 않은 선수다)
  // 특별 엔트리(은퇴식 등으로 하루 등록된 선수, 예: 2026 박병호)는 현역이 아니라서 뺀다
  const special = new Set(store.meta.specialEntries?.[String(startYear)] ?? []);
  const startPlayers = recorded.players.filter((p) => (!p.foreign || !opening || opening.has(p.id)) && !special.has(p.id));
  const idx = careerIndex(store);
  const contractsById = new Map<string, NonNullable<Store['contracts']>>();
  for (const c of store.contracts ?? []) (contractsById.get(c.id) ?? contractsById.set(c.id, []).get(c.id)!).push(c);

  const toLeague = (p: SimPlayer): LeaguePlayer => {
    const m = store.players.get(p.id)!;
    const now = currentRuns(p, ctx);
    const peak = realPeakRuns(p, idx, store, ctx, params);
    const potential = potentialOf(now, peak, p.age, seed, p.id);

    // 계약 기록: 시작 연도 이전에 시작한 것만 (그 뒤 계약은 미래 정보)
    const rows = (contractsById.get(p.id) ?? []).filter((c) => c.first <= startYear).sort((a, b) => a.first - b.first);
    const faRows = rows.filter((c) => c.kind === 'FA');
    const lastFaYear = faRows.length ? faRows[faRows.length - 1].first : null;
    const active = [...rows].reverse().find((c) => c.first + c.years - 1 >= startYear);

    let service = 0;
    for (let y = lastFaYear ?? m.entryYear; y < startYear; y++) if (servedSeason(idx, p.id, y)) service++;

    let contract: Contract;
    if (p.foreign) contract = { kind: 'foreign', salary: foreignSalary(now, false, false), until: startYear };
    else if (active) {
      contract = {
        kind: active.kind === 'FA' ? 'fa' : 'nonFA',
        salary: Math.max(MIN_SALARY, Math.round((active.guaranteed * 10000) / active.years)),
        until: active.first + active.years - 1,
      };
    } else if (m.entryYear >= startYear) contract = { kind: 'rookie', salary: MIN_SALARY, until: startYear };
    else if (faRows.length) contract = { kind: 'reserve', salary: Math.max(MIN_SALARY, Math.round(marketSalary(now) * 0.8)), until: startYear };
    else contract = { kind: 'reserve', salary: reserveTarget(now, service), until: startYear };

    return {
      id: p.id, name: p.name, real: m.real, isPitcher: p.isPitcher, pos: p.pos, bats: p.bats, throws: p.throws,
      foreign: p.foreign, asia: p.foreign && (opening?.get(p.id) ?? m.asia ?? false), birthYear: m.birthYear ?? estimatedBirthYear(m), school: m.school ?? null, entryYear: m.entryYear,
      ...(m.birthYear ? {} : { birthYearEstimated: true }),
      bat: p.bat, pit: p.pit, potential, estimated: p.debutEstimate, team: p.teamIdx, contract,
      service, faCount: faRows.length, lastFaYear, lastSaves: p.lastSaves, history: [],
      ...(p.foreign ? {} : { military: initialMilitary({ id: p.id, foreign: p.foreign, real: m.real, birthYear: m.birthYear ?? null }, idx, startYear, store.military?.[p.id]) }),
    };
  };
  const players: LeaguePlayer[] = startPlayers.map(toLeague);

  const league: LeagueState = {
    format: 1, seed, startYear, year: startYear,
    teams: recorded.teams.map((t) => ({ name: t.name, franchise: t.franchise })),
    players, lastSeason: null, ledger: [], nextVirtualId: 1,
  };
  // 시작 다음 해에 1군에 들어오는 창단 구단은 이미 창단해 퓨처스리그에서 뛰고 있다 (예: 2012 시작의 NC).
  // 시작 전 드래프트에서 지명한 선수(나성범 등)는 아래 보충에서 이 구단으로 들어간다
  const futures = addFuturesTeams(league, store, startYear);
  const recordedIds = new Set(league.players.map((p) => p.id));
  const added = addUnrecordedRookies(league, store, ctx, startYear, seed, idx)
    + addAbsentVeterans(league, store, startYear, params, special, toLeague)
    + addLateDebuts(league, store, ctx, startYear, idx);
  trimToOrgLimit(league, recordedIds);
  ensureFinance(league);
  for (const e of league.expansions ?? []) addExpansionCapital(league, e.team, startYear);
  const world = opening || added || special.size || futures ? worldFromLeague(structuredClone(league), store, params) : recorded;
  return { league, world };
}

/**
 * 시작 연도에 입단했지만 그 해 1군 기록이 없는 실제 신인(지명·육성선수)을 지명 구단에 넣는다.
 * 그 해 기록이 있는 선수만 월드에 들어오므로, 넣지 않으면 2군 신인이 통째로 빠진다.
 * 같은 이름이 같은 구단에 이미 있으면 넣지 않는다 (1군에 올라온 신인). 넣은 수를 돌려준다.
 */
function addUnrecordedRookies(league: LeagueState, store: Store, ctx: ReturnType<typeof valueContext>, startYear: number, seed: string,
                              idx: CareerIndex): number {
  const rows = (store.drafts?.[String(startYear)] ?? []).filter((d) => d.kind !== '원년 멤버' && d.games === 0);
  if (!rows.length) return 0;
  const teamIdx = new Map(league.teams.map((t, i) => [t.name, i]));
  const have = new Set(league.players.map((p) => `${p.team}/${p.name}`));
  const view = { year: startYear, ctx, sim: new Map<string, SimPlayer>(), orgs: [] as SimPlayer[][] };
  const rng = new Rng(`${seed}/rookies/${startYear}`);
  const taken = takenNames(league, store);
  const all = store.drafts![String(startYear)];
  let n = 0;
  for (const d of rows) {
    const t = teamIdx.get(d.team);
    if (t === undefined || have.has(`${t}/${d.name}`)) continue;
    const p = makeDraftee(league, view, rng, taken, d, all.indexOf(d), startYear, store, () => idx);
    p.team = t;
    p.military = { state: 'pending' };
    n++;
  }
  return n;
}

/** 군 복무가 아닌 공백(2군·부상)으로 보충할 때 앞뒤로 볼 햇수 (임시값) */
const GAP_YEARS = 2;
/** 복무 중 선수: 입대 전 마지막 1군 기록이 이 햇수 안에 있어야 한다 (임시값) */
const SERVICE_LOOKBACK = 3;

/**
 * 시작 연도에 1군 기록이 없지만 그 앞뒤로 1군에서 뛴 국내 선수를 마지막 1군 구단에 넣는다 (2026-10-11 사용자 요청).
 * - 군 복무 중 (military.json의 복무 기록, 전역 해가 시작 연도 이후): 복무 중 상태로 넣고 전역 다음 해에 복귀
 * - 2군·부상 공백 (앞뒤 GAP_YEARS 안에 1군 기록): 2군 선수로 넣는다
 * 능력은 마지막 1군 기록 해의 월드에서 가져온다. 해외 진출 같은 다른 이유의 공백도 섞이지만, 실제 역사를 따를 필요는 없다는 사용자 결정에 따라
 * 마지막 구단에 남은 것으로 본다. 넣은 수를 돌려준다.
 */
function addAbsentVeterans(league: LeagueState, store: Store, startYear: number, params: EngineParams, special: Set<string>,
                           toLeague: (p: SimPlayer) => LeaguePlayer): number {
  const have = new Set(league.players.map((p) => p.id));
  const worlds = new Map<number, World>();
  const worldAt = (y: number) => worlds.get(y) ?? worlds.set(y, worldForYear(store, y, params)).get(y)!;
  const recordYears = (id: string): number[] => {
    const ys: number[] = [];
    for (let y = startYear - SERVICE_LOOKBACK; y <= startYear + GAP_YEARS; y++) {
      const sd = store.season(y);
      if (sd && (sd.bat.some((r) => r.id === id) || sd.pit.some((r) => r.id === id))) ys.push(y);
    }
    return ys;
  };
  // 후보: 시작 연도 직전 몇 해 안에 1군 기록이 있는 국내 선수 (시작 연도 명단에 없는)
  const cand = new Set<string>();
  for (let y = startYear - SERVICE_LOOKBACK; y < startYear; y++) {
    const sd = store.season(y);
    if (!sd) continue;
    for (const r of [...sd.bat, ...sd.pit]) if (!have.has(r.id) && !special.has(r.id)) cand.add(r.id);
  }
  let n = 0;
  for (const id of [...cand].sort()) {
    const m = store.players.get(id);
    if (!m || m.foreign || !m.real || m.last < startYear) continue;
    const ys = recordYears(id);
    if (ys.includes(startYear)) continue;
    const last = Math.max(...ys.filter((y) => y < startYear));
    const after = ys.filter((y) => y > startYear);
    const serving = servingAt(store, id, startYear);
    if (!serving && !(last >= startYear - GAP_YEARS && after.length)) continue;
    const sp = worldAt(last).players.find((x) => x.id === id);
    if (!sp) continue;
    const sd = store.season(last)!;
    const teamName = (sd.bat.find((r) => r.id === id) ?? sd.pit.find((r) => r.id === id))!.team;
    const team = leagueTeamFor(league, store, teamName, last);
    if (team < 0) continue;
    const p = toLeague({ ...sp, teamIdx: team, age: m.birthYear ? startYear - m.birthYear : sp.age });
    p.team = team;
    if (serving) p.military = serving;
    league.players.push(p);
    have.add(id);
    n++;
  }
  return n;
}

/** 시작 전에 지명됐지만 시작 연도까지 1군 기록이 없는 선수를 지명 구단에 넣는다. 지명 구단이 아직 없으면 창단 때 넣는다 (missing.ts) */
function addLateDebuts(league: LeagueState, store: Store, ctx: ReturnType<typeof valueContext>, startYear: number, idx: CareerIndex): number {
  const list = lateDebutDraftees(store, league, startYear);
  if (!list.length) return 0;
  const view = { year: startYear, ctx, sim: new Map<string, SimPlayer>(), orgs: [] as SimPlayer[][] };
  const taken = takenNames(league, store);
  let n = 0;
  for (const x of list) {
    const team = leagueTeamFor(league, store, x.d.team, x.entry);
    if (team < 0) continue; // 아직 없는 구단 (창단 때 offseason.ts의 expandTeam이 넣는다)
    makeLateDraftee(league, view, x, team, startYear, store, () => idx, taken); // makeDraftee가 리그 명단에 넣는다
    n++;
  }
  return n;
}

/**
 * 보충한 선수로 정원(ORG_LIMIT, 복무 중 제외)을 넘은 구단은 보충 선수 중 잠재력이 낮은 선수부터 뺀다.
 * 시작 연도 기록이 있는 선수는 건드리지 않는다. 게임에는 육성선수 구분이 없어, 실제로 육성·2군에 있던 선수까지 모두 넣으면 정원을 크게 넘는다.
 */
function trimToOrgLimit(league: LeagueState, recordedIds: Set<string>): void {
  const counted = (p: LeaguePlayer) => p.military?.state !== 'serving';
  for (let t = 0; t < league.teams.length; t++) {
    const org = league.players.filter((p) => p.team === t && counted(p));
    const over = org.length - ORG_LIMIT;
    if (over <= 0) continue;
    const drop = new Set(org.filter((p) => !recordedIds.has(p.id))
      .sort((a, b) => a.potential - b.potential || a.id.localeCompare(b.id))
      .slice(0, over).map((p) => p.id));
    league.players = league.players.filter((p) => !drop.has(p.id));
  }
}

/** 시작 다음 해에 1군에 들어오는 창단 구단을 퓨처스 구단으로 넣는다. 넣은 수를 돌려준다 */
function addFuturesTeams(league: LeagueState, store: Store, startYear: number): number {
  let n = 0;
  for (const c of teamChangesFor(store, league.teams, startYear + 1)) {
    if (c.kind !== 'expand') continue;
    const t = league.teams.push({ name: c.name, franchise: c.franchise }) - 1;
    (league.expansions ??= []).push({ team: t, firstYear: startYear + 1 });
    n++;
  }
  return n;
}
