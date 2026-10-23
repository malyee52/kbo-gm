// 리그 상태 → 엔진 월드.
// 자료가 있는 해(2026년까지)는 그 해 리그 평균·환경을 쓰고, 그 뒤는 마지막 5시즌 평균을 쓴다 (기획서 11장).
// 시작 연도의 월드는 worldForYear와 선수 순서·능력이 같아야 한다 (저장 호환, 같은 시드 같은 결과).

import { settingsOf, userTeamOf } from './difficulty';
import type { DataStore, Rates } from '../data/types';
import { fitRuleToTeams, scheduleRule } from '../data/schedule';
import {
  batValue, DEFAULT_PARAMS, leagueEnvFor, makeDefense, pickOpeningHosts, pctRankedFromSeason, pitValue, rankedFromSeason, traitsOf,
  type EngineParams, type SimPlayer, type SimTeam, type World,
} from '../engine';
import { shiftBat, shiftPit } from './growth';
import type { LeagueState } from './types';
import { activeLevel, MEDICAL_DAYS, MEDICAL_RATE } from './finance';
import { campInjury } from './camp';
import { homeIsDome, parkEventFactor, parkFactor, parkRunFactor } from './stadium';
import { homeOnlyUntil } from './careers';
import { divisionsFor } from './eras';

/** 리그 평균을 낼 때 쓰는 최근 시즌 수 */
const RECENT_SEASONS = 5;

type Store = Pick<DataStore, 'meta' | 'season' | 'traits'> & Partial<Pick<DataStore, 'players' | 'schedule'>>;

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
    sbPct: avg((s) => s.league.sbPct ?? 0) || null,
  }, params);
  const lastYear = years[years.length - 1];
  return { rates, env, games: last.games, rules: store.meta.rules[String(lastYear)] };
}

export interface WorldOptions {
  /** 슬럼프(그 시즌만의 기량 저하)를 반영한다. 기본 true. 오프시즌 가치 계산처럼 미래를 내다볼 때는 끈다 */
  form?: boolean;
  /** 퓨처스 구단(1군 진입 전 창단 구단)도 넣는다. 기본 false (시즌 월드에는 없다). 오프시즌 가치 계산(드래프트 등)에서 켠다 */
  includeFutures?: boolean;
}

/**
 * 그 시즌(year)에 퓨처스리그에만 있는 창단 구단인가 (2026-10-11 사용자 결정).
 * 실제 창단 구단은 1군 진입 2년 전에 창단해 첫 드래프트에 참가하고, 1년 동안 퓨처스리그에서 뛴 뒤 1군에 들어왔다
 * (NC: 2011 창단·2012 입단 드래프트, 2012 퓨처스, 2013 1군).
 */
export function isFuturesTeam(league: Pick<LeagueState, 'expansions'>, team: number, year: number): boolean {
  return (league.expansions ?? []).some((e) => e.team === team && year < e.firstYear);
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

  // 퓨처스 구단은 시즌 월드에서 뺀다. 창단 구단은 늘 구단 목록 끝에 붙으므로 빼도 다른 구단의 색인은 그대로다
  const futures = opts.includeFutures ? [] : league.teams.map((_, i) => i).filter((i) => isFuturesTeam(league, i, year));
  const kept = league.teams.length - futures.length;
  if (futures.some((i) => i < kept)) throw new Error('퓨처스 구단이 구단 목록 끝에 있지 않습니다');
  const teams: SimTeam[] = league.teams.slice(0, kept).map((t, idx) => {
    const med = activeLevel(league, idx, 'medical');
    // 세부 난이도의 부상 빈도는 플레이어 구단에만 (difficulty.ts)
    const inj = idx === userTeamOf(league) ? settingsOf(league).injury : 1;
    // 스프링캠프 (camp.ts): 체력 훈련·국내 캠프의 시즌 부상 배율
    const camp = campInjury(league, idx, year);
    const rate = (med ? MEDICAL_RATE[med] : 1) * inj * camp;
    // 구장 특성 (stadium.ts): 게임 안에서 지은 신구장만
    const park = parkFactor(league.stadiums?.[idx]);
    const run = parkRunFactor(store.meta.parkFactors, t.franchise, year, league.stadiums?.[idx]);
    const ev = run !== 1 ? parkEventFactor(store.meta.parkEvents, t.franchise, year, league.stadiums?.[idx]) : undefined;
    return { idx, name: t.name, franchise: t.franchise, org: [], ...(med || inj !== 1 || camp !== 1 ? { injuryRate: rate, injuryDays: med ? MEDICAL_DAYS[med] : 1 } : {}),
      ...(park.hr !== 1 || run !== 1 ? { park: { hr: park.hr, ...(run !== 1 ? { run } : {}), ...(ev ? { ev } : {}) } } : {}),
      ...(homeIsDome(league.stadiums?.[idx], t.franchise, year) ? { dome: true } : {}) };
  });
  const players: SimPlayer[] = [];
  for (const lp of league.players) {
    // 시즌 중 시장의 선수(market.ts)는 어느 명단에도 없이 월드에 들어온다 (teamIdx = -1, 시즌 중 영입하면 구단으로 옮긴다)
    const market = lp.team === -1 && (lp.market === year || lp.reserve === year);
    if ((lp.team < 0 && !market) || lp.team >= kept || lp.military?.state === 'serving') continue;
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
      ...(lp.penTrust ? { penTrust: lp.penTrust } : {}),
      // 예전 저장의 실존 투수는 underhand가 없어 선수 마스터로 채운다
      ...(lp.underhand || (lp.isPitcher && store.players?.get(lp.id)?.underhand) ? { underhand: true } : {}),
      value: lp.isPitcher ? pitValue(pit!, lg) : batValue(bat!, lg),
      debutEstimate: lp.estimated,
      real: lp.real,
      ...(lp.dev ? { dev: true } : {}),
      ...(lp.reserve === year && lp.team === -1 ? { reserve: true } : {}),
      ...(lp.startAbsent ? { startAbsent: lp.startAbsent } : {}),
      ...(lp.overuse ? { overuseStart: lp.overuse } : {}),
      ...(homeOnlyUntil(lp, year) ? { homeOnlyUntil: homeOnlyUntil(lp, year)! } : {}),
      // 이도류 (league/twoway.ts): 반대쪽 실제 능력치
      ...(lp.twoWay && (lp.alt?.bat || lp.alt?.pit) ? { alt: { ...(lp.alt.bat ? { bat: lp.alt.bat } : {}), ...(lp.alt.pit ? { pit: lp.alt.pit } : {}) } } : {}),
      ...(lp.birthYearEstimated ? { ageEstimated: true } : {}),
    };
    // 숨겨진 특수능력은 리그 상태(저장)에 두지 않고 데이터에서 매번 붙인다
    const traits = traitsOf(store.traits, lp.id);
    if (traits) p.traits = traits;
    players.push(p);
    if (!market) teams[lp.team].org.push(p);
  }
  // 일정 규칙과 개막 홈 구단: 지난 시즌을 게임에서 치렀으면 그 순위, 아니면(시작 연도) 시즌 자료의 순위 (worldForYear와 같다).
  // 자료 없는 해에 구단 수가 10이 아니면(가상 창단) 규칙을 구단 수에 맞추고 팀당 경기 수도 그것을 따른다
  const rule0 = store.schedule ? scheduleRule(store.schedule, year) : undefined;
  const rule = rule0 && fitRuleToTeams(rule0, kept);
  if (!data && rule) games = rule.games;
  const franchises = teams.map((t) => t.franchise);
  const last = league.lastSeason;
  const ranked = last && last.year === year - 1 ? last.standings.filter((i) => i < kept) : rankedFromSeason(store.season(year - 1), franchises);
  const hosts = pickOpeningHosts(year, ranked, franchises);
  // 양대 리그 나눔 (1999·2000): 결산의 구단 변화(쌍방울 → SK 승계) 뒤 새 해 자료로 다시 계산한다
  const divisions = divisionsFor(store, year, teams);
  // 동률 규칙 ③ 전년도 정규시즌 순위: 게임에서 치렀으면 그 통합 순위, 아니면 시즌 자료의 승률 순 (기획안 10.4)
  const prevStandings = divisions ? (last && last.year === year - 1 ? last.standings.filter((i) => i < kept) : pctRankedFromSeason(store.season(year - 1), franchises)) : null;
  return {
    year, gamesPerTeam: games, rules, league: lg, env, teams, players,
    ...(rule ? { schedule: rule } : {}), ...(hosts ? { openingHosts: hosts } : {}), ...(divisions ? { divisions, prevStandings: prevStandings! } : {}),
  };
}
