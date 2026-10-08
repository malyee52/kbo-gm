// 새 게임의 리그 상태 만들기: 시작 연도 자료로 월드를 만들고, 잠재력·계약·연차를 붙인다.

import type { DataStore } from '../data/types';
import { DEFAULT_PARAMS, worldForYear, type EngineParams, type SimPlayer, type World } from '../engine';
import { currentRuns, valueContext } from '../ai/value';
import { careerIndex, potentialOf, realPeakRuns, type CareerIndex } from './growth';
import { foreignSalary, marketSalary, MIN_SALARY, reserveTarget } from './salary';
import type { Contract, LeaguePlayer, LeagueState } from './types';

type Store = Pick<DataStore, 'meta' | 'players' | 'season' | 'contracts'>;

/** 1군 연차로 치는 시즌: 100타석 또는 상대 타자 100명 이상 (임시값. 실제 등록일수 자료가 없다) */
function servedSeason(idx: CareerIndex, id: string, year: number): boolean {
  const b = idx.bat.get(id)?.find((x) => x.year === year);
  const p = idx.pit.get(id)?.find((x) => x.year === year);
  return (b?.row.pa ?? 0) >= 100 || (p?.row.tbf ?? 0) >= 100;
}

export interface CreatedLeague {
  league: LeagueState;
  /** 시작 연도 월드 (worldForYear와 같다) */
  world: World;
}

/**
 * 시작 연도 리그 상태. store에는 모든 시즌과 계약 기록이 불러와져 있어야 한다 (잠재력·연차 산출).
 * 같은 데이터·시드면 같은 결과가 나온다.
 */
export function createLeague(store: Store, startYear: number, seed: string, params: EngineParams = DEFAULT_PARAMS): CreatedLeague {
  const world = worldForYear(store, startYear, params);
  const ctx = valueContext(world);
  const idx = careerIndex(store);
  const contractsById = new Map<string, NonNullable<Store['contracts']>>();
  for (const c of store.contracts ?? []) (contractsById.get(c.id) ?? contractsById.set(c.id, []).get(c.id)!).push(c);

  const players: LeaguePlayer[] = world.players.map((p: SimPlayer) => {
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
      foreign: p.foreign, asia: false, birthYear: m.birthYear ?? null, school: m.school ?? null, entryYear: m.entryYear,
      bat: p.bat, pit: p.pit, potential, estimated: p.debutEstimate, team: p.teamIdx, contract,
      service, faCount: faRows.length, lastFaYear, lastSaves: p.lastSaves, history: [],
    };
  });

  return {
    league: {
      format: 1, seed, startYear, year: startYear,
      teams: world.teams.map((t) => ({ name: t.name, franchise: t.franchise })),
      players, lastSeason: null, ledger: [], nextVirtualId: 1,
    },
    world,
  };
}
