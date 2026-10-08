// 새 게임의 리그 상태 만들기: 시작 연도 자료로 월드를 만들고, 잠재력·계약·연차를 붙인다.

import type { DataStore } from '../data/types';
import { DEFAULT_PARAMS, Rng, worldForYear, type EngineParams, type SimPlayer, type World } from '../engine';
import { currentRuns, valueContext } from '../ai/value';
import { initialMilitary } from './careers';
import { makeDraftee, takenNames } from './offseason';
import { careerIndex, potentialOf, realPeakRuns, type CareerIndex } from './growth';
import { foreignSalary, marketSalary, MIN_SALARY, reserveTarget } from './salary';
import type { Contract, LeaguePlayer, LeagueState } from './types';
import { worldFromLeague } from './world';

type Store = Pick<DataStore, 'meta' | 'players' | 'season' | 'contracts' | 'drafts'>;

/** 1군 연차로 치는 시즌: 100타석 또는 상대 타자 100명 이상 (임시값. 실제 등록일수 자료가 없다) */
function servedSeason(idx: CareerIndex, id: string, year: number): boolean {
  const b = idx.bat.get(id)?.find((x) => x.year === year);
  const p = idx.pit.get(id)?.find((x) => x.year === year);
  return (b?.row.pa ?? 0) >= 100 || (p?.row.tbf ?? 0) >= 100;
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

  const players: LeaguePlayer[] = startPlayers.map((p: SimPlayer) => {
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
      foreign: p.foreign, asia: p.foreign && (opening?.get(p.id) ?? m.asia ?? false), birthYear: m.birthYear ?? null, school: m.school ?? null, entryYear: m.entryYear,
      bat: p.bat, pit: p.pit, potential, estimated: p.debutEstimate, team: p.teamIdx, contract,
      service, faCount: faRows.length, lastFaYear, lastSaves: p.lastSaves, history: [],
      ...(p.foreign ? {} : { military: initialMilitary({ id: p.id, foreign: p.foreign, real: m.real, birthYear: m.birthYear ?? null }, idx, startYear) }),
    };
  });

  const league: LeagueState = {
    format: 1, seed, startYear, year: startYear,
    teams: recorded.teams.map((t) => ({ name: t.name, franchise: t.franchise })),
    players, lastSeason: null, ledger: [], nextVirtualId: 1,
  };
  const added = addUnrecordedRookies(league, store, ctx, startYear, seed, idx);
  const world = opening || added || special.size ? worldFromLeague(structuredClone(league), store, params) : recorded;
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
