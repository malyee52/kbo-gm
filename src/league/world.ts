// 리그 상태 → 엔진 월드.
// 자료가 있는 해(2026년까지)는 그 해 리그 평균·환경을 쓰고, 그 뒤는 마지막 5시즌 평균을 쓴다 (기획서 11장).
// 시작 연도의 월드는 worldForYear와 선수 순서·능력이 같아야 한다 (저장 호환, 같은 시드 같은 결과).

import { KNOB_CAP } from './training';
import { settingsOf, userTeamOf } from './difficulty';
import type { DataStore, Rates } from '../data/types';
import { fitRuleToTeams, scheduleRule } from '../data/schedule';
import { arsenalsOf } from '../data/pitches';
import {
  batValue, DEFAULT_PARAMS, leagueEnvFor, leagueRpa, makeDefense, pickOpeningHosts, pctRankedFromSeason, pitValue, rankedFromSeason, traitsOf,
  type BatSkill, type EngineParams, type SimPlayer, type SimTeam, type World,
} from '../engine';
import { shiftBat, shiftPit } from './growth';
import type { LeagueState } from './types';
import { virtualDefense } from '../engine/fielding';
import { applyRunSkills } from '../engine/runskills';
import { activeLevel, MEDICAL_DAYS, MEDICAL_RATE } from './finance';
import { campInjury } from './camp';
import { homeIsDome, teamParkAt } from './stadium';
import { homeOnlyUntil } from './careers';
import { useParkData } from './ballparks';
import { divisionsFor, expansionPerk } from './eras';
import { ballD2, ballHrMul, futureDelta, futureValue, zoneBb } from './futureRules';

/** 리그 평균을 낼 때 쓰는 최근 시즌 수 */
const RECENT_SEASONS = 5;

type Store = Pick<DataStore, 'meta' | 'season' | 'traits'> & Partial<Pick<DataStore, 'players' | 'parks' | 'schedule' | 'pitches' | 'defense' | 'running'>>;

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
/** 리그 상태의 월드 선수에게 주루·작전·포수·투수 짝·어깨 손잡이를 다시 낸다 (월드를 만들 때, 그리고 시즌 중 자유 모드 조작 뒤 불러온 판과 같게) */
export function applyLeagueRunSkills(players: SimPlayer[], league: LeagueState, store: Store, params: EngineParams): void {
  const drill = new Map(league.players.filter((p) => p.drill).map((p) => [p.id, p.drill!]));
  applyRunSkills(players, params, { arm: store.defense?.arm, running: store.running, startYear: league.startYear, ...(drill.size ? { drill, drillCap: KNOB_CAP } : {}) });
}

export function worldFromLeague(league: LeagueState, store: Store, params: EngineParams = DEFAULT_PARAMS, opts: WorldOptions = {}): World {
  // 불러온 게임도 실제 구장 이름·좌석을 자료에서 (create.ts와 같다)
  if (store.parks) useParkData(store.parks);
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
    // 2027년 이후는 2026년 제도를 그대로 쓴다 (기획서 4.1). 미래 규칙 변경 ②(futureRules.ts)는 목표 비율에 배율만 얹고
    // 엔트리·연장·외국인 한도를 바꾼다 (변경이 없으면 배율 1, 값 그대로)
    const p = projectedEnvironment(store, params);
    const hr = ballHrMul(league, year);
    const so = futureValue(league, 'zone', year);
    lg = { ...p.rates, hr: p.rates.hr * hr, d2: p.rates.d2 * ballD2(hr), so: p.rates.so * so, bb: p.rates.bb * zoneBb(so) };
    env = p.env;
    games = p.games;
    rules = {
      ...p.rules,
      maxInnings: p.rules.maxInnings + futureDelta(league, 'extra', year),
      rosterSize: p.rules.rosterSize + futureDelta(league, 'roster', year),
      // 출장 인원은 등록 인원을 따라간다. 엔트리 확대는 9월 1일 +5 (2026년의 후반기 한시 엔트리·8월 25일 앞당김은 아시안게임 때문이라 잇지 않는다)
      ...(p.rules.activeSize !== undefined ? { activeSize: p.rules.activeSize + futureDelta(league, 'roster', year) } : {}),
      rosterExtra: '901:5',
      foreignLimit: p.rules.foreignLimit + futureDelta(league, 'foreign', year),
      // 한 경기 출전 외국인 (리그 규칙 1-6): 2026년은 보유와 같아서 보유 한도를 따라간다
      foreignActive: p.rules.foreignActive + futureDelta(league, 'foreign', year),
    };
  }

  // 퓨처스 구단은 시즌 월드에서 뺀다. 창단 구단은 늘 구단 목록 끝에 붙으므로 빼도 다른 구단의 색인은 그대로다
  const futures = opts.includeFutures ? [] : league.teams.map((_, i) => i).filter((i) => isFuturesTeam(league, i, year));
  const kept = league.teams.length - futures.length;
  if (futures.some((i) => i < kept)) throw new Error('퓨처스 구단이 구단 목록 끝에 있지 않습니다');
  // 구장 효과의 자료·그 해 리그 구단·리그 비율 (옛 해 평균 1 맞춤, park.ts)
  const parkSrc = { parkFactors: store.meta.parkFactors, parkEvents: store.meta.parkEvents, parks: store.parks };
  const parkFrs = league.teams.slice(0, kept).map((t) => t.franchise);
  const parkLg = data ? leagueRpa(data.league) : { rates: lg, rpa: 0 };
  const teams: SimTeam[] = league.teams.slice(0, kept).map((t, idx) => {
    const med = activeLevel(league, idx, 'medical');
    // 세부 난이도의 부상 빈도는 플레이어 구단에만 (difficulty.ts)
    const inj = idx === userTeamOf(league) ? settingsOf(league).injury : 1;
    // 스프링캠프 (camp.ts): 체력 훈련·국내 캠프의 시즌 부상 배율
    const camp = campInjury(league, idx, year);
    const rate = (med ? MEDICAL_RATE[med] : 1) * inj * camp;
    // 홈 구장 배율 (stadium.ts teamParkAt): 실제 구장 값 + 게임 안에서 지은 신구장
    const park = teamParkAt(parkSrc, t.franchise, year, league.stadiums?.[idx], parkFrs, parkLg, params.park);
    // 창단 특례 (eras.ts expansionPerk): 1군 첫 두 시즌 엔트리 +1, 외국인 +1 (외국인 제도가 있는 해만)
    const perk = expansionPerk(league, idx, year);
    return { idx, name: t.name, franchise: t.franchise, org: [], ...(med || inj !== 1 || camp !== 1 ? { injuryRate: rate, injuryDays: med ? MEDICAL_DAYS[med] : 1 } : {}),
      ...(park ? { park } : {}),
      ...(perk ? { rosterBonus: 1, ...(rules.foreignLimit > 0 ? { foreignBonus: 1 } : {}) } : {}),
      ...(homeIsDome(league.stadiums?.[idx], t.franchise, year) ? { dome: true } : {}) };
  });
  const players: SimPlayer[] = [];
  for (const lp of league.players) {
    // 시즌 중 시장의 선수(market.ts)는 어느 명단에도 없이 월드에 들어온다 (teamIdx = -1, 시즌 중 영입하면 구단으로 옮긴다)
    const market = lp.team === -1 && (lp.market === year || lp.reserve === year);
    if ((lp.team < 0 && !market) || lp.team >= kept || lp.military?.state === 'serving') continue;
    const slump = form && lp.slump ? lp.slump : 0;
    const base = lp.bat && !lp.bat.def ? { ...lp.bat, ...leagueDefense(league, lp.id, lp.pos, lp.bat.speed, lp.birthYear ? year - lp.birthYear : null) } : lp.bat;
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
  // 능력치 v2 16-3: 주루·작전·포수·투수 짝은 해마다 나이로 다시 낸다 (리그 영점, runskills.ts, 저장하지 않음).
  // 어깨 낱말·추가 진루·번트 실측은 게임 시작 연도 전 시기만 (시작 능력 근거, 결정 29. 뒤는 게임 안 성장 몫, 16-4)
  if (league.defPool) applyLeagueRunSkills(players, league, store, params);
  if (league.defZero !== undefined) env = { ...env, defZero: league.defZero };
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
    ...(league.defPool ? { defPool: league.defPool } : {}),
    // 투수 구종 (엔진 2 20-1단계): 그 해 전 실측 → 위키 → 선수 ID로 정한 리그 평균 꼴. 저장하지 않는다
    arsenals: arsenalsOf(players, store.pitches, year),
  };
}

/**
 * 수비 기록 없이 만드는 선수의 수비 (가상 선수·자유 모드 선수·수비 정보 없는 저장). v2 리그(defPool 있음)면 본 자리 + 유사 포지션만 수비 가능,
 * 근거 몫은 시작 연도 실존 주전 분포에서 뽑는다 (능력치 v2 16.4 가). 아니면 예전 추정 (makeDefense)
 */
export function leagueDefense(league: Pick<LeagueState, 'defPool'>, id: string, pos: string | null, speed: number, age: number | null): Partial<Pick<BatSkill, 'def' | 'playable' | 'defTalent'>> {
  if (!league.defPool) return { def: makeDefense(id, pos, [], speed, age) };
  const v = virtualDefense(id, pos, speed, age, league.defPool);
  return { def: v.def, playable: v.playable, ...(Object.keys(v.talent).length ? { defTalent: v.talent } : {}) };
}
