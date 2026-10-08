// 리그 상태 → 엔진 월드.
// 자료가 있는 해(2026년까지)는 그 해 리그 평균·환경을 쓰고, 그 뒤는 마지막 5시즌 평균을 쓴다 (기획서 11장).
// 시작 연도의 월드는 worldForYear와 선수 순서·능력이 같아야 한다 (저장 호환, 같은 시드 같은 결과).

import type { DataStore, Rates } from '../data/types';
import {
  batValue, DEFAULT_PARAMS, leagueEnvFor, makeDefense, pitValue, traitsOf,
  type EngineParams, type SimPlayer, type SimTeam, type World,
} from '../engine';
import { shiftBat, shiftPit } from './growth';
import type { LeagueState } from './types';

/** 리그 평균을 낼 때 쓰는 최근 시즌 수 */
const RECENT_SEASONS = 5;

type Store = Pick<DataStore, 'meta' | 'season' | 'traits'>;

/** 자료가 없는 해의 리그 환경: 자료가 있는 마지막 5시즌의 평균 */
export function projectedEnvironment(store: Store, params: EngineParams = DEFAULT_PARAMS) {
  const years = store.meta.years.slice(-RECENT_SEASONS);
  const seasons = years.map((y) => store.season(y)).filter((s): s is NonNullable<typeof s> => !!s);
  if (!seasons.length) throw new Error('리그 평균을 낼 시즌 자료가 없습니다');
  const avg = (f: (s: (typeof seasons)[number]) => number) => seasons.reduce((a, s) => a + f(s), 0) / seasons.length;
  const keys: (keyof Rates)[] = ['s1', 'd2', 't3', 'hr', 'bb', 'hbp', 'so'];
  const rates = Object.fromEntries(keys.map((k) => [k, avg((s) => s.league.rates[k])])) as unknown as Rates;
  const last = seasons[seasons.length - 1];
  const env = leagueEnvFor({
    unearnedShare: avg((s) => s.league.unearnedShare),
    sacPerPa: avg((s) => s.league.sacPerPa),
    wpbkPerPa: avg((s) => s.league.wpbkPerPa ?? params.wildPitchDefault),
  }, params);
  const lastYear = years[years.length - 1];
  return { rates, env, games: last.games, rules: store.meta.rules[String(lastYear)] };
}

export interface WorldOptions {
  /** 슬럼프(그 시즌만의 기량 저하)를 반영한다. 기본 true. 오프시즌 가치 계산처럼 미래를 내다볼 때는 끈다 */
  form?: boolean;
}

/**
 * 리그 상태 → 그 해 월드. 무소속과 복무 중인 선수는 빠진다.
 * 슬럼프는 능력을 그 시즌만 옮기고, 넘어온 부상·병역 복귀는 개막부터의 결장(startAbsent)이 된다.
 */
export function worldFromLeague(league: LeagueState, store: Store, params: EngineParams = DEFAULT_PARAMS, opts: WorldOptions = {}): World {
  const form = opts.form ?? true;
  const year = league.year;
  const data = store.season(year);
  let lg: Rates;
  let env: World['env'];
  let games: number;
  let rules: World['rules'];
  if (data) {
    lg = { ...data.league.rates };
    env = leagueEnvFor(data.league, params);
    games = data.games;
    rules = store.meta.rules[String(year)];
  } else {
    // 2027년 이후는 2026년 제도를 그대로 쓴다 (기획서 4.1)
    const p = projectedEnvironment(store, params);
    lg = p.rates;
    env = p.env;
    games = p.games;
    rules = p.rules;
  }

  const teams: SimTeam[] = league.teams.map((t, idx) => ({ idx, name: t.name, franchise: t.franchise, org: [] }));
  const players: SimPlayer[] = [];
  for (const lp of league.players) {
    if (lp.team < 0 || lp.military?.state === 'serving') continue;
    const slump = form && lp.slump ? lp.slump : 0;
    const base = lp.bat && !lp.bat.def
      ? { ...lp.bat, def: makeDefense(lp.id, lp.pos, [], lp.bat.speed, lp.birthYear ? year - lp.birthYear : null) }
      : lp.bat;
    const bat = base && slump ? shiftBat(base, slump) : base;
    const pit = lp.pit && slump ? shiftPit(lp.pit, slump) : lp.pit;
    const p: SimPlayer = {
      idx: players.length,
      id: lp.id,
      name: lp.name,
      teamIdx: lp.team,
      isPitcher: lp.isPitcher,
      pos: lp.pos,
      bats: lp.bats,
      throws: lp.throws,
      foreign: lp.foreign,
      age: lp.birthYear ? year - lp.birthYear : null,
      bat,
      pit,
      lastSaves: lp.lastSaves,
      value: lp.isPitcher ? pitValue(pit!, lg) : batValue(bat!, lg),
      debutEstimate: lp.estimated,
      real: lp.real,
      ...(lp.startAbsent ? { startAbsent: lp.startAbsent } : {}),
    };
    // 숨겨진 특수능력은 리그 상태(저장)에 두지 않고 데이터에서 매번 붙인다
    const traits = traitsOf(store.traits, lp.id);
    if (traits) p.traits = traits;
    players.push(p);
    teams[lp.team].org.push(p);
  }
  return { year, gamesPerTeam: games, rules, league: lg, env, teams, players };
}
