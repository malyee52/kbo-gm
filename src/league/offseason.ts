// 오프시즌 (기획서 3장): 결산 → FA → 외국인 선수 → 신인 드래프트 → 연봉 협상 → 정원 정리 → 개막 준비.
//
// 상태(OffseasonState)는 JSON으로 그대로 저장할 수 있고, 리그 상태(LeagueState)를 직접 고친다.
// 플레이어 구단의 결정은 단계마다 함수로 받고, AI 구단은 같은 가치 함수(ai/value.ts)로 결정한다.
// 난수는 시드에서 갈라 쓰므로 같은 시드·같은 결정이면 같은 결과가 나온다.

import { applyPickOwners } from './picks';
import { seasonAwards } from './awards';
import { archiveDeparting } from './history';
import { envFrom } from './war';
import type { DataStore, DraftRow, PlayerMaster } from '../data/types';
import {
  ageDefense, agingScale, DEFAULT_PARAMS, emptyBatLine, emptyPitLine, isStarterSkill, makeDefense, Rng, traitsOf,
  type EngineParams, type Season, type SimPlayer, type World,
} from '../engine';
import { currentRuns, playerValue, teamStrength, valueContext, type ValueContext } from '../ai/value';
import { coreAge, horizonWeights, tendencyOf, type Tendency } from '../ai/trade';
import { asSim, careerIndex, growthRoom, growthRuns, realPeakRuns, skillForRuns, type CareerIndex } from './growth';
import {
  asianGames, ensureMilitary, injuryEffect, isAsianGamesYear, isServing, militaryStep, MILITARY_RUST, retirements, rollForm,
  type CareerNews,
} from './careers';
import { foreignName, josa, koreanName } from './names';
import {
  ASIA_NEW_CAP, capPayroll, COMPENSATION, faEligible, faGrade, faYears, FOREIGN_ASIA, FOREIGN_NEW_CAP, FOREIGN_REGULAR,
  FA_RE_ELIGIBLE, FOREIGN_TOTAL_CAP, foreignSalary, marketSalary, MIN_SALARY, serviceNeeded, nextReserveSalary, ORG_LIMIT, reserveTarget, runsForSalary, salaryCap,
  SERVICE_SHARE, WON_PER_RUN, FA_COMP, wonText, dollarText, type FaGrade,
} from './salary';
import { aiPotential, draftSlots, spendLimit } from './owner';
import type { Contract, LeaguePlayer, LeagueState } from './types';
import { GM_FA_COST, GM_FA_YOUNG, gmStyle } from './gm';
import { settingsOf } from './difficulty';
import { DEPARTURES_PER_YEAR, isAbroad, POSTING_CHANCE, POSTING_SERVICE, postingFee, returnDecision, sendAbroad } from './overseas';
import { addArticle } from './articles';
import { aiHireCoaches, COACH_ROLE_LABEL, COACH_ROLES, coachGrowth, coachMarket, coachOf, expireCoaches, fallbackCoach, hireCoach, type Coach } from './coaches';
import { isFuturesTeam, worldFromLeague } from './world';
import { starLeaves, starStays } from './stadium';
import { futuresExtras, futuresForm, registeredOf, futuresOpportunity, futuresRecord, futuresSeason, FUT_FORM_RUNS, FUTURES_WEIGHT } from './futures';
import {
  activeLevel, addExpansionCapital, AI_SCOUT_SCALE, cashOf, DEVELOP_AGE, DEVELOP_BONUS, DEVELOP_SHARE, ensureFinance, lockInvestments, SCOUT_NOISE,
  settleSeason, signingBonus, transferFeeUsd, WON_PER_USD,
} from './finance';
import { changeText, faEnabled, foreignRule, teamChangesFor, type TeamChange } from './eras';
import { estimatedBirthYear } from './create';

type Store = Pick<DataStore, 'meta' | 'season' | 'players' | 'drafts' | 'traits'>;

export type Stage = 'fa' | 'comp' | 'foreign' | 'draft' | 'salary' | 'release' | 'ready';
export const STAGES: Stage[] = ['fa', 'comp', 'foreign', 'draft', 'salary', 'release', 'ready'];
export const STAGE_LABEL: Record<Stage, string> = {
  fa: 'FA', comp: 'FA 보상선수', foreign: '외국인 선수', draft: '신인 드래프트', salary: '연봉 협상', release: '정원 정리', ready: '개막 준비',
};
/** 오프시즌 기록의 구분: 단계 + 결산(은퇴·병역 등) */
export type LogStage = Stage | 'settle';
export const LOG_LABEL: Record<LogStage, string> = { ...STAGE_LABEL, settle: '결산' };

/** FA 시장 라운드 수 (임시값) */
export const FA_ROUNDS = 3;
/** 라운드별로 선수가 받아들이는 최소 금액 (요구액 대비, 임시값) */
const FA_ACCEPT = [1.0, 0.93, 0.85];
/** 라운드별 AI 제시 기본액 (요구액 대비, 임시값) */
const FA_AI_OFFER = [1.0, 0.95, 0.9];
/**
 * 구단이 FA 계약을 받아들이는 기준: 전력 이득(런)이 계약 비용(런 환산)의 이만큼 이상이면 계약한다 (임시값).
 * 1보다 작은 까닭: 선수의 이득은 그 자리 기존 선수를 뺀 차이라 늘 시장가(선수 자신의 기여)보다 작은데,
 * 실제 구단은 경쟁·흥행처럼 런으로 잡히지 않는 가치까지 보고 시장가를 낸다.
 */
const FA_WILLINGNESS = 0.75;
/** 2군 선수의 성장 판정 출전 기회 (퓨처스리그, 임시값)와 그 대상 나이 (다음 시즌 기준). 퓨처스 기록이 자료에 없어 근거는 없다 */
const FUTURES_SHARE = 0.5;
const FUTURES_AGE = 25;
/** 한 구단이 한 오프시즌에 데려올 수 있는 외부 FA 수 (임시값, 실제 규정 미확인) */
export const MAX_FA_SIGNINGS = 2;
/** 드래프트 라운드 수 (기획서 5장: 11라운드로 통일) */
export const DRAFT_ROUNDS = 11;
/**
 * 가상 신인 잠재력 식의 배율: -10 + 배율 × (-ln u)^1.2. M6에서 실제 입단 동기의 전성기 분포에 맞춘 8은 장기 진행에서
 * 주전급 기여가 20년 동안 16~27% 줄었다 (실제 전성기는 한두 시즌의 좋은 기록이라 잠재력보다 높게 잡힌다).
 * 2026-10-11 tools/flow_longterm.ts 3시드 20시즌으로 다시 맞춘 값 (임시값). 기량 하락 나이 35세·육성 투자 30세 이하·재정 결산 기준 8.5
 * (2045년 상위 270명 기여 합이 시작 대비 +5~9%, 중간 정점 +25~30%). 33세일 때 9, 31세일 때 9.5.
 * 2026-10-12 하락 나이 32세·완만한 하락으로 바꾸며 9 (2026 시작 2시드 20시즌: 2045년 상위 270명 기여 합 시작 대비 -2.3%, 8.5면 -8.5%).
 * 2026-10-12 기준표 정렬(투수 가치 눈금·고점 회귀 완화·역사 재현 기본)로 시작 리그가 높게 잡혀 10.5
 * (역사 재현, 2시드 20시즌: 2045년 시작 대비 -1.9%·-0.4%, 9면 -20%).
 * 배율을 바꾸면 reports/flow-longterm.md처럼 다시 잰다. docs/longterm-plan.md 7장
 */
export const DRAFT_POTENTIAL_SCALE = 10.5;
/** 드래프트 풀 인원 (임시값) */
const DRAFT_POOL = 150;
/** 외국인 후보 인원 (임시값) */
const FOREIGN_POOL_REGULAR = 24;
const FOREIGN_POOL_ASIA = 8;
/** 외국인 재계약 기준 (런, 임시값) */
const FOREIGN_KEEP_RUNS = 12;
/** 3명 총액 상한 안에 이만큼도 남지 않으면 재계약하지 않는다 (달러, 임시값) */
const FOREIGN_MIN_DEAL = 300_000;

export interface FaOffer {
  team: number;
  /** 연봉 (만 원) */
  salary: number;
  years: number;
}

export interface FaEntry {
  id: string;
  /** 원 소속 구단 */
  from: number;
  grade: FaGrade;
  prevSalary: number;
  /** 요구 연봉 */
  ask: number;
  years: number;
  status: 'open' | 'signed' | 'left';
  /** 해외에서 돌아온 FA (보상 없음, overseas.ts). from은 원 소속 구단(없으면 −1) */
  returnee?: boolean;
  /** 계약한 구단 (원 소속 포함) */
  team?: number;
  salary?: number;
  signedYears?: number;
  round?: number;
}

export interface OffseasonState {
  format: 1;
  /** 막 끝난 시즌 */
  year: number;
  stage: Stage;
  userTeam: number;
  fa: {
    round: number;
    entries: FaEntry[];
    /** 플레이어 구단의 제시 (선수 id → 제시) */
    userOffers: Record<string, FaOffer>;
    /** 구단별 외부 FA 영입 수 */
    signings: number[];
  };
  foreign: {
    /** 지명 순서 (구단 색인). 직전 시즌 성적 역순 */
    order: number[];
    /** 순서상 다음에 고를 위치 */
    pointer: number;
    /** 후보 선수 id */
    pool: string[];
    /** 플레이어 구단 외국인의 재계약 여부 */
    keep: Record<string, boolean>;
    /** 다음 시즌 보유 한도 (M8, 시대별). 없으면 2026년 값 */
    regular?: number;
    asia?: number;
  } | null;
  /** 코치 후보 (coaches.ts). 2026-10-11 추가 */
  coachMarket?: Coach[];
  /** 해외에서 FA로 돌아온 선수 (FA 시장에 들어간다, overseas.ts) */
  returnees?: string[];
  /** 우리 구단 선수의 포스팅 요청 (보내면 이적료, overseas.ts). decided 없으면 붙잡은 것으로 본다 */
  postings?: { id: string; fee: number; decided?: 'accept' | 'decline' }[];
  /** 실제 육성선수 계약 신인 (드래프트 풀 밖, 정원 정리 때 육성선수로 데려온다). 2026-10-11 추가 */
  devExtra?: string[];
  draft: {
    order: number[];
    /** 전체 지명 순 구단 (샐러리캡 제재로 1라운드 순서가 바뀔 수 있다, M7). 없으면 order를 라운드마다 반복 */
    slots?: number[];
    /** 지명권마다 구분: 0 = 우선 지명, -1 = 특별 지명, n = n라운드 (2026-10-11 추가, 예전 저장에는 없다) */
    kinds?: number[];
    /** 지명권의 원래 구단 (지명권 트레이드, picks.ts). 없거나 slots와 같으면 자기 지명권 */
    orig?: number[];
    /** 다음 지명 번호 (0부터) */
    pick: number;
    pool: string[];
    picks: { team: number; id: string; round: number }[];
  } | null;
  salary: {
    /** 선수 id → 요구 연봉 */
    demands: Record<string, number>;
    /** 플레이어 구단의 제시 */
    offers: Record<string, number>;
  } | null;
  /** 이 오프시즌의 주요 사건 (알림용). major: 리그 전체에 알릴 만한 소식 */
  log: { stage: LogStage; text: string; mine: boolean; major?: boolean }[];
  /** 시즌 뒤 성장·하락 결과 (2026-10-08 추가, 예전 저장에는 없다) */
  growth?: GrowthEntry[];
  /** FA 보상선수 (A·B등급 이적 건마다 하나, 2026-10-08 추가) */
  comp?: CompCase[];
  /** 다음 시즌의 구단 변화 (M8: 명칭 변경·승계·창단). 개막 때 알림으로 보여 준다 */
  changes?: TeamChange[];
  /** 이번 정원 정리에서 방출된 선수 (방출 선수 시장 후보, 2026-10-11 추가). from = 방출한 구단 */
  released?: { id: string; from: number }[];
}

/** FA 보상 한 건: 영입 구단(to)이 보호선수 명단을 내고, 원 소속 구단(from)이 보상선수 또는 보상금만을 고른다 */
export interface CompCase {
  /** 이적한 FA 선수 id */
  fa: string;
  from: number;
  to: number;
  grade: FaGrade;
  prevSalary: number;
  /** 보호선수 (자동 보호 선수는 넣지 않는다) */
  protect: string[];
  /** 고른 보상선수 id, 'cash'(보상금만), 아직이면 null */
  pick: string | null;
}

/** 한 선수의 성장 판정 결과. before·after는 같은 기준(다음 시즌 나이 반영 전)의 한 시즌 기여(런) */
export interface GrowthEntry {
  id: string;
  team: number;
  /** 다음 시즌 나이 */
  age: number | null;
  before: number;
  after: number;
  /** 변화 원인 표시: 부상 후유증, 입대, 조기 노쇠(우리 구단만), 복무 중 */
  tags?: string[];
}

// ---- 리그 보기: 다음 시즌 기준의 가치 계산 도구

export interface LeagueView {
  year: number;
  ctx: ValueContext;
  sim: Map<string, SimPlayer>;
  orgs: SimPlayer[][];
}

/** 다음 시즌(league.year + 1) 기준으로 선수 가치를 잴 수 있게 SimPlayer를 만든다. 무소속 선수도 포함 */
export function leagueView(league: LeagueState, store: Store, params: EngineParams = DEFAULT_PARAMS): LeagueView {
  const next = { ...league, year: league.year + 1 };
  const world = worldFromLeague(next, store, params, { form: false, includeFutures: true });
  const ctx = valueContext(world);
  // AI 구단이 보는 잠재력 (난이도에 따른 오차, owner.ts)
  ctx.potential = new Map(league.players.map((p) => [p.id, aiPotential(league, p)]));
  const sim = new Map(world.players.map((p) => [p.id, p]));
  let k = 0;
  for (const lp of league.players) {
    if (sim.has(lp.id)) continue;
    sim.set(lp.id, { ...asSim(lp, world.league, next.year), idx: 1_000_000 + k++, name: lp.name, foreign: lp.foreign, teamIdx: lp.team });
  }
  return { year: next.year, ctx, sim, orgs: world.teams.map((t) => [...t.org]) };
}

const byId = (league: LeagueState) => new Map(league.players.map((p) => [p.id, p]));
const ageIn = (p: LeaguePlayer, year: number) => (p.birthYear ? year - p.birthYear : 28);

function tendencyFor(league: LeagueState, view: LeagueView, team: number): Tendency {
  const st = league.lastSeason?.standings ?? league.teams.map((_, i) => i);
  return tendencyOf({
    teamIdx: team, rank: (st.indexOf(team) < 0 ? st.length : st.indexOf(team)) + 1, nTeams: league.teams.length, cut: 5,
    coreAge: coreAge(view.orgs[team], view.ctx), remaining: 1, style: gmStyle(league, team),
  });
}

/**
 * 계약 비용을 런으로: 연봉은 시장 연봉식의 역함수로(그 연봉이면 몇 런짜리 선수를 살 수 있는지), 보상금은 시장 단가로 바꾼다.
 * 시장 연봉이 기여보다 가파르게 오르므로 단순 단가로 나누면 스타는 늘 비싸 보인다.
 */
function costRuns(salary: number, years: number, compensation: number): number {
  return runsForSalary(salary) * years + compensation / WON_PER_RUN;
}

/** 선수를 구단 전력에 넣었을 때의 시즌별 이득 합 (years 시즌, 성향 배율 적용) */
function signingGain(view: LeagueView, team: number, p: SimPlayer, years: number, tendency: Tendency, alreadyIn: boolean): number {
  const org = view.orgs[team];
  const without = alreadyIn ? org.filter((x) => x.id !== p.id) : org;
  const withP = alreadyIn ? org : [...org, p];
  let g = 0;
  for (let y = 0; y < years; y++) g += teamStrength(withP, view.ctx, y) - teamStrength(without, view.ctx, y);
  return g * (tendency === 'contend' ? 1.2 : 0.8);
}

function moveInView(view: LeagueView, p: SimPlayer, to: number): void {
  for (const org of view.orgs) {
    const i = org.findIndex((x) => x.id === p.id);
    if (i >= 0) org.splice(i, 1);
  }
  if (to >= 0) view.orgs[to].push(p);
}

function log(off: OffseasonState, stage: LogStage, text: string, mine: boolean, major?: boolean): void {
  off.log.push(major ? { stage, text, mine, major } : { stage, text, mine });
}

// ---- 결산

/**
 * 시즌 결산: 시즌 결과를 리그 상태에 반영하고(소속, 기록, 1군 연차), 성장 판정을 한 뒤 오프시즌을 연다.
 * world와 season은 막 끝난 시즌의 것이어야 한다.
 * userEnlist: 플레이어가 고른 우리 구단 입대 명단 (없으면 AI 규칙. careers.ts normalizeEnlist로 규칙에 맞춘다)
 */
export function beginOffseason(league: LeagueState, world: World, season: Season, store: Store, userTeam: number,
                               params: EngineParams = DEFAULT_PARAMS, userEnlist?: string[]): OffseasonState {
  const year = league.year;
  if (!season.done) throw new Error('시즌이 끝나지 않았습니다');
  const lp = byId(league);
  const ctxNow = valueContext(world);
  const batKeys = Object.keys(emptyBatLine()) as (keyof ReturnType<typeof emptyBatLine>)[];
  const pitKeys = Object.keys(emptyPitLine()) as (keyof ReturnType<typeof emptyPitLine>)[];
  const seasonDays = season.schedule.length;
  const absences = new Map<number, typeof season.absences>();
  for (const a of season.absences) (absences.get(a.idx) ?? absences.set(a.idx, []).get(a.idx)!).push(a);
  const runsAt = (p: LeaguePlayer, y: number) => currentRuns(asSim(p, world.league, y), ctxNow);
  ensureMilitary(league);
  // 재정 결산: 게임 세션은 가을야구·트레이드를 넣어 먼저 결산한다. 아직이면(장기 진행 도구 등) 기본값으로 (finance.ts)
  if (!league.finance?.some((f) => f.history.some((h) => h.year === year))) {
    const standings = season.standings();
    settleSeason({ league, world, season, standings, champion: null, postseasonDepth: () => 0, trust: () => 50 });
  }
  // 시상 (history에 이 시즌이 들어가기 전에: 신인 자격 판정)
  league.awards = [...(league.awards ?? []).filter((a) => a.year !== year), seasonAwards(world, season, league, store)];
  for (const p of league.players) {
    delete p.slump;
    delete p.startAbsent;
    delete p.startAbsentReason;
  }

  // 퓨처스리그 성적 (futures.ts): 2군 선수의 출전 기회와 활약을 성장 판정에 쓴다. 시즌 마지막 1군 명단 기준
  const extras = futuresExtras(league, store, world, params);
  const fut = futuresSeason(world, season, league.seed, (t) => registeredOf(season, t), extras);
  const futById = new Map<string, ReturnType<typeof fut.lines.get>>();
  for (const sp of world.players) futById.set(sp.id, fut.lines.get(sp.idx));
  for (const e of extras) for (const sp of e.org) futById.set(sp.id, fut.lines.get(sp.idx));
  league.lastFutures = { year, teams: fut.teams };
  // 시즌 가치(WAR)용 리그 환경 (war.ts, 명예의 전당). 시뮬 리그 합계로
  {
    const T = season.totals;
    (league.seasonEnv ??= {})[String(year)] = envFrom({ pa: T.pa, h: T.h, d: T.d, t: T.t, hr: T.hr, bb: T.bb, hbp: T.hbp, so: T.so,
      runsAllowed: T.r, outs: T.outs, teamGames: season.teams.reduce((a, t) => a + t.g, 0), runs: T.r });
  }
  // 창단 퓨처스 구단 선수는 1군 월드에 없어 아래 시즌 줄 만들기에서 빠진다: 퓨처스 성적만 따로 남긴다 (2026-10-12 퓨처스 기록 보관)
  for (const e of extras) {
    for (const sp of e.org) {
      const p = lp.get(sp.id);
      const rec = futuresRecord(fut.lines.get(sp.idx));
      if (p && (rec.fbat || rec.fpit)) p.history.push({ year, team: league.teams[e.team]?.name ?? '', ...rec });
    }
  }

  const growth = new Map<string, GrowthEntry>();
  const servingBefore = new Set(league.players.filter((p) => isServing(p)).map((p) => p.id));
  for (const sp of world.players) {
    const p = lp.get(sp.id)!;
    const b = season.bat[sp.idx];
    const pt = season.pit[sp.idx];
    p.team = sp.teamIdx;
    p.history.push({
      year, team: world.teams[sp.teamIdx].name,
      ...(b.pa > 0 ? { bat: batKeys.map((k) => b[k]) } : {}),
      ...(pt.bf > 0 ? { pit: pitKeys.map((k) => pt[k]) } : {}),
      ...futuresRecord(futById.get(sp.id)),
    });
    p.lastSaves = pt.sv;
    if (season.activeDays[sp.idx] >= SERVICE_SHARE * season.teams[sp.teamIdx].g) p.service++;

    // 부상 후유증 (careers.ts): 잠재력·능력 감소, 다음 시즌으로 넘어가는 결장
    const list = absences.get(sp.idx) ?? [];
    const eff = injuryEffect(list, seasonDays, params.injury.offseasonDays, new Rng(`${league.seed}/injury/${year}/${p.id}`));
    for (const a of list) {
      if (a.kind !== 'long' && a.kind !== 'major') continue;
      (p.injuries ??= []).push({ year, kind: a.kind, days: a.until - a.day, seasonOut: a.until >= seasonDays });
    }
    p.potential -= eff.potentialCut;
    if (eff.carry > 0) {
      p.startAbsent = Math.ceil(eff.carry);
      p.startAbsentReason = 'injury';
    }

    // 성장 판정: 잠재력과의 격차, 나이, 출전 기회, 소폭의 운 (기획서 6.3). 슬럼프는 그 시즌만의 일이라 원래 능력에서 판정한다
    const runs = runsAt(p, year);
    growth.set(p.id, { id: p.id, team: sp.teamIdx, age: p.birthYear ? year + 1 - p.birthYear : null, before: runs, after: runs,
      ...(eff.runsDrop > 0 || eff.potentialCut > 0 ? { tags: ['부상 후유증'] } : {}) });
    const firstTeam = sp.isPitcher
      ? pt.bf / ((isStarterSkill(sp.pit) ? 650 : 280))
      : b.pa / 550;
    // 2군 유망주는 퓨처스리그에서 뛴다 (2026-10-12부터 실제 퓨처스 출전량으로, 예전에는 모두 FUTURES_SHARE):
    // 퓨처스에서 꽉 채워 뛰면 1군 기회 FUTURES_WEIGHT만큼. 퓨처스 활약·부진은 성장에 ±FUT_FORM_RUNS (futures.ts)
    // 육성 투자: 2군 유망주 출전 몫과 30세 이하 성장 폭 (finance.ts)
    const dev = activeLevel(league, sp.teamIdx, 'develop');
    const young = ageIn(p, year + 1) <= FUTURES_AGE;
    const fl = futById.get(p.id);
    const futOpp = young ? futuresOpportunity(fl) : 0;
    const share = young && futOpp > 0 ? Math.max(firstTeam, firstTeam + FUTURES_WEIGHT * futOpp + DEVELOP_SHARE[dev]) : firstTeam;
    const form = young ? futuresForm(fl) : 0;
    const age = ageIn(p, year + 1) + (p.decline ?? 0);
    const grown = developed(ageIn(p, year + 1), runs, growthRuns(age, runs, p.potential, share, new Rng(`${league.seed}/growth/${year}/${p.id}`), p.isPitcher,
      agingScale(traitsOf(store.traits, p.id), params.traits)) + FUT_FORM_RUNS * form, dev);
    if (Math.abs(form) >= 0.5) {
      const g = growth.get(p.id)!;
      g.tags = [...(g.tags ?? []), form > 0 ? '퓨처스 활약' : '퓨처스 부진'];
    }
    // 코치 효과 (coaches.ts): 타격·투수 코치의 성장·하락 완화, 시즌을 주로 2군에서 보낸 선수는 2군 코치
    const next = coachGrowth(league, sp.teamIdx, sp.isPitcher, ageIn(p, year + 1), runs, grown, firstTeam < FUTURES_SHARE) - eff.runsDrop;
    Object.assign(p, skillForRuns({ ...p }, next, ctxNow, year));
    p.estimated = false;
    // 표본: 지난 시즌 출전 + 이전 표본의 60% (직전 3시즌 가중치 1.0·0.8·0.6과 비슷한 무게).
    // 등급(20~80)의 기준 집단이 "표본이 충분한 선수"라서, 가상 선수도 뛰면 기준 집단에 들어가야 한다
    if (p.bat) p.bat = { ...p.bat, sample: Math.round(b.pa + 0.6 * p.bat.sample) };
    if (p.pit) p.pit = { ...p.pit, sample: Math.round(pt.bf + 0.6 * p.pit.sample) };
    // 수비 나이 변화 (수비 정보가 없던 저장은 여기서 만든다)
    if (p.bat) {
      const def = p.bat.def ?? sp.bat?.def ?? makeDefense(p.id, p.pos, [], p.bat.speed, ageIn(p, year));
      p.bat = { ...p.bat, def: ageDefense(def, ageIn(p, year + 1)) };
    }
  }
  // 해외에 있는 선수: 해외 리그에서 주전으로 뛰는 것으로 보고 출전 기회 1.0으로 성장 판정 (overseas.ts)
  for (const p of league.players) {
    if (!isAbroad(p)) continue;
    const next = growthRuns(ageIn(p, year + 1) + (p.decline ?? 0), runsAt(p, year), p.potential, 1,
      new Rng(`${league.seed}/growth/${year}/${p.id}`), p.isPitcher, agingScale(traitsOf(store.traits, p.id), params.traits));
    Object.assign(p, skillForRuns({ ...p }, next, ctxNow, year));
  }
  // 복무 중인 선수: 퓨처스리그에서 뛰는 것으로 보고 출전 기회 40%로 성장 판정 (임시값)
  for (const p of league.players) {
    if (!isServing(p) || p.team < 0) continue;
    growth.set(p.id, { id: p.id, team: p.team, age: p.birthYear ? year + 1 - p.birthYear : null, before: runsAt(p, year), after: 0, tags: ['복무 중'] });
    const next = growthRuns(ageIn(p, year + 1) + (p.decline ?? 0), runsAt(p, year), p.potential, 0.4,
      new Rng(`${league.seed}/growth/${year}/${p.id}`), p.isPitcher, agingScale(traitsOf(store.traits, p.id), params.traits));
    Object.assign(p, skillForRuns({ ...p }, next, ctxNow, year));
  }
  // 퓨처스 구단(창단 뒤 1군 진입 전) 선수: 시즌 월드에 없어 퓨처스리그 성적(extras)으로 성장 판정. 나이와 상관없이 퓨처스가 주 무대다
  for (const p of league.players) {
    if (p.team < 0 || isServing(p) || !isFuturesTeam(league, p.team, year)) continue;
    const runs = runsAt(p, year);
    growth.set(p.id, { id: p.id, team: p.team, age: p.birthYear ? year + 1 - p.birthYear : null, before: runs, after: runs, tags: ['퓨처스'] });
    const dev = activeLevel(league, p.team, 'develop');
    const fl = futById.get(p.id);
    const share = fl ? FUTURES_WEIGHT * futuresOpportunity(fl) + DEVELOP_SHARE[dev] : FUTURES_SHARE + DEVELOP_SHARE[dev];
    const next = developed(ageIn(p, year + 1), runs, growthRuns(ageIn(p, year + 1) + (p.decline ?? 0), runs, p.potential, share,
      new Rng(`${league.seed}/growth/${year}/${p.id}`), p.isPitcher, agingScale(traitsOf(store.traits, p.id), params.traits)) + FUT_FORM_RUNS * futuresForm(fl), dev);
    Object.assign(p, skillForRuns({ ...p }, next, ctxNow, year));
  }
  league.lastSeason = { year, teams: season.teams.map((t) => ({ ...t })), standings: season.standings() };

  const off: OffseasonState = {
    format: 1, year, stage: 'fa', userTeam,
    fa: { round: 1, entries: [], userOffers: {}, signings: league.teams.map(() => 0) },
    foreign: null, draft: null, salary: null, log: [],
  };
  // 코치: 계약이 끝난 코치는 나가고, 올해 후보 시장이 열린다 (coaches.ts)
  expireCoaches(league, year);
  off.coachMarket = coachMarket(league, year);

  // 조기 노쇠·슬럼프, 은퇴, 병역, 아시안게임 (careers.ts)
  const nextRuns = (p: LeaguePlayer) => runsAt(p, year + 1);
  for (const sp of world.players) {
    const p = lp.get(sp.id)!;
    if (p.foreign) continue;
    const form = rollForm(p, nextRuns(p), ctxNow, year + 1, new Rng(`${league.seed}/form/${year}/${p.id}`));
    if (form.decline && p.team === userTeam) {
      log(off, 'settle', `${p.name}: 기량이 예상보다 빨리 떨어지기 시작했습니다 (조기 노쇠)`, true);
      const g = growth.get(p.id);
      if (g) g.tags = [...(g.tags ?? []), '조기 노쇠'];
    }
  }
  const news: CareerNews[] = [];
  const c = { league, year, nextRuns };
  news.push(...retirements(c));
  // 아시안게임(9월)이 입대(시즌 뒤)보다 먼저다: 금메달로 면제된 선수는 입대 후보에서 빠진다
  if (isAsianGamesYear(year, league.startYear)) news.push(...asianGames(league, year, nextRuns, new Rng(`${league.seed}/asiad/${year}`)));
  news.push(...militaryStep(c, (p) => Object.assign(p, skillForRuns({ ...p }, nextRuns(p) - MILITARY_RUST, ctxNow, year + 1)),
    userTeam >= 0 && userEnlist ? { team: userTeam, ids: userEnlist } : undefined));
  for (const n of news) log(off, 'settle', n.text, n.team === userTeam, n.major);

  // 성장·하락 결과: 은퇴한 선수는 빼고, 입대한 선수는 표시한다
  off.growth = [];
  for (const g of growth.values()) {
    const p = lp.get(g.id)!;
    if (p.team < 0) continue;
    g.after = runsAt(p, year);
    if (isServing(p) && !servingBefore.has(p.id)) g.tags = [...(g.tags ?? []), '입대'];
    off.growth.push(g);
  }

  applyTeamChanges(league, off, store, params);
  overseasOffseason(league, off, store, params);
  aiExtensions(league, off, leagueView(league, store, params));
  enterFa(league, off, store, params);
  return off;
}

// ---- 비FA 다년 계약 (2026-10-12 사용자 요청)

/** 계약 기간 (년) */
export const EXT_MIN_YEARS = 2;
export const EXT_MAX_YEARS = 6;
/** 계약금: 총액의 이 비율 (FA 30%보다 낮게, 임시값) */
export const EXT_BONUS_SHARE = 0.2;

/** FA까지 남은 1군 시즌 (이미 FA 계약을 한 적이 있으면 재자격 기준) */
export function seasonsToFa(p: LeaguePlayer, year: number): number {
  const need = p.faCount === 0 ? serviceNeeded(p.school, p.entryYear, p.birthYear, year) : FA_RE_ELIGIBLE;
  return Math.max(0, need - p.service);
}

/** 다년 계약을 맺을 수 있는 우리 선수: 국내, 보류·신인 계약, 육성선수·복무 중 아님, 이번 FA 시장에 나오지 않음 */
export function extensionCandidates(league: LeagueState, off: OffseasonState): LeaguePlayer[] {
  const fa = new Set(off.fa.entries.filter((e) => e.status === 'open').map((e) => e.id));
  return league.players.filter((p) => p.team === off.userTeam && !p.foreign && !p.dev && !isServing(p) && !fa.has(p.id)
    && (p.contract.kind === 'reserve' || p.contract.kind === 'rookie'));
}

/**
 * 선수가 요구하는 연봉 (만 원): 계약 기간 동안의 예상 기여로 낸 시장 연봉 × 할인.
 * FA가 가까우면(1시즌 이하) 할인 없음, 2~3시즌 10%, 그보다 멀면 20% (안정을 사는 값). 길수록 해마다 2% 더 할인. 지금 연봉보다 낮게는 받지 않는다
 */
export function extensionDemand(view: LeagueView, p: LeaguePlayer, year: number, years: number): number {
  const sp = view.sim.get(p.id);
  if (!sp) return Math.max(MIN_SALARY, p.contract.salary);
  let sum = 0;
  for (let y = 0; y < years; y++) sum += currentRuns(sp, view.ctx) + projectedShift(sp, y, view.ctx);
  const base = marketSalary(sum / years);
  const toFa = seasonsToFa(p, year);
  const factor = (toFa <= 1 ? 1 : toFa <= 3 ? 0.9 : 0.8) * (1 - 0.02 * (years - EXT_MIN_YEARS));
  return Math.max(MIN_SALARY, p.contract.salary, Math.round((base * factor) / 100) * 100);
}

function signExtension(league: LeagueState, off: OffseasonState, p: LeaguePlayer, salary: number, years: number): number {
  const bonus = Math.round(salary * years * EXT_BONUS_SHARE);
  p.contract = { kind: 'nonFA', salary, until: off.year + years, prepaid: Math.round(bonus / years) };
  if (bonus) league.ledger.push({ year: off.year + 1, from: p.team, to: -1, amount: bonus, note: `${p.name} 비FA 다년 계약금`, kind: 'signing' });
  if (off.salary) { delete off.salary.demands[p.id]; delete off.salary.offers[p.id]; }
  return bonus;
}

/** 우리 선수와 비FA 다년 계약 (요구 연봉 그대로, 정원 정리 단계까지) */
export function extendByUser(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams, id: string, years: number): OfferCheck {
  if (off.stage === 'ready') return { ok: false, message: '개막 준비 단계에서는 계약할 수 없습니다.' };
  if (!Number.isInteger(years) || years < EXT_MIN_YEARS || years > EXT_MAX_YEARS) return { ok: false, message: `계약 기간은 ${EXT_MIN_YEARS}~${EXT_MAX_YEARS}년입니다.` };
  const p = extensionCandidates(league, off).find((x) => x.id === id);
  if (!p) return { ok: false, message: '다년 계약을 맺을 수 없는 선수입니다 (국내 보류·신인 계약 선수, FA 시장에 나오지 않은 선수만).' };
  const view = leagueView(league, store, params);
  const salary = extensionDemand(view, p, off.year, years);
  const bonus = Math.round(salary * years * EXT_BONUS_SHARE);
  if (bonus > cashOf(league, off.userTeam)) return { ok: false, message: `계약금 ${(bonus / 10000).toFixed(1)}억 원(총액의 ${EXT_BONUS_SHARE * 100}%)을 낼 자금이 모자랍니다.` };
  const limit = spendLimit(league, off.userTeam, off.year + 1);
  if (limit !== null && capPayroll(league.players, off.userTeam) - p.contract.salary + salary > limit) return { ok: false, message: '이 계약을 하면 샐러리캡 상한을 넘습니다.' };
  signExtension(league, off, p, salary, years);
  log(off, 'salary', `${p.name}, 비FA 다년 계약 ${years}년 (연 ${(salary / 10000).toFixed(1)}억 원, 계약금 ${(bonus / 10000).toFixed(1)}억 원)`, true, true);
  return { ok: true, message: `${p.name}과(와) ${years}년 다년 계약을 맺었습니다.` };
}

/** AI 구단의 다년 계약: FA까지 1~2시즌 남은 30세 이하 주축(현재 10런 이상) 최대 2명, 단장 성향에 따른 확률로 4년 */
function aiExtensions(league: LeagueState, off: OffseasonState, view: LeagueView): void {
  const chance: Record<string, number> = { winnow: 0.5, develop: 0.5, balanced: 0.35, frugal: 0.15 };
  for (let t = 0; t < league.teams.length; t++) {
    if (t === off.userTeam || isFuturesTeam(league, t, off.year + 1)) continue;
    const cands = league.players
      .filter((p) => p.team === t && !p.foreign && !p.dev && !isServing(p) && p.contract.kind === 'reserve' && p.contract.until <= off.year + 1
        && ageIn(p, off.year + 1) <= 30 && [1, 2].includes(seasonsToFa(p, off.year)))
      .map((p) => ({ p, r: (() => { const sp = view.sim.get(p.id); return sp ? currentRuns(sp, view.ctx) : 0; })() }))
      .filter((x) => x.r >= 10)
      .sort((a, b) => b.r - a.r || a.p.id.localeCompare(b.p.id))
      .slice(0, 2);
    for (const { p } of cands) {
      if (!new Rng(`${league.seed}/extend/${off.year}/${p.id}`).chance(chance[gmStyle(league, t)] ?? 0.35)) continue;
      const salary = extensionDemand(view, p, off.year, 4);
      if (salary * 4 * EXT_BONUS_SHARE > cashOf(league, t)) continue;
      signExtension(league, off, p, salary, 4);
      log(off, 'salary', `${league.teams[t].name}, ${p.name}과(와) 비FA 다년 계약 4년 (연 ${(salary / 10000).toFixed(1)}억 원)`, false, true);
    }
  }
}

// ---- 해외 진출과 복귀 (overseas.ts)

/**
 * 오프시즌 시작 때: 해외 선수의 복귀·은퇴, 정상급 선수의 포스팅 요청.
 * 복귀: 포스팅으로 나간 선수는 원 소속 구단으로 (다년 계약), FA로 나간 선수는 FA 시장으로 (off.returnees → openFaMarket).
 * 포스팅 요청: KBO 연차 POSTING_SERVICE 이상, 23~31세, 국내 선수 가운데 현재 가치 상위 12명 안, 확률 POSTING_CHANCE(10%), 해외에서 돌아온 선수 제외, 한 해 DEPARTURES_PER_YEAR명까지.
 * AI 구단은 이적료를 받고 보내고, 우리 구단 선수는 off.postings에 올려 플레이어가 정한다 (정원 정리 단계 전까지)
 */
function overseasOffseason(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  const year = off.year;
  const view = leagueView(league, store, params);
  off.returnees = [];
  for (const p of league.players) {
    if (!isAbroad(p) || !p.abroad) continue;
    const d = returnDecision(league, p, year + 1);
    if (d === 'retire') {
      p.team = -1;
      (league.retired ??= []).push({ id: p.id, name: p.name, real: p.real, year, age: p.birthYear ? year - p.birthYear : null, team: p.abroad.origin, reason: 'age' });
      log(off, 'settle', `${p.name}, 해외에서 은퇴`, false, true);
      addArticle(league, { year, day: -1, kind: 'overseas', title: `${p.name}, 해외에서 은퇴`, body: `${p.name}이(가) 해외 무대에서 선수 생활을 마쳤다.` });
      continue;
    }
    if (d !== 'return') continue;
    const origin = p.abroad.origin;
    const away = year + 1 - p.abroad.since;
    const sp = view.sim.get(p.id);
    const runs = sp ? currentRuns(sp, view.ctx) : 0;
    if (p.abroad.mode === 'posting' && league.teams[origin] && !isFuturesTeam(league, origin, year + 1)) {
      // 보류권: 원 소속 구단으로 돌아온다 (다년 계약)
      const age = ageIn(p, year + 1);
      const yrs = age <= 32 ? 4 : 2;
      p.team = origin;
      p.contract = { kind: 'nonFA', salary: Math.max(MIN_SALARY, marketSalary(runs)), until: year + yrs };
      delete p.abroad;
      p.returnedFromAbroad = year + 1;
      log(off, 'settle', `${p.name}, ${away}년 만에 해외에서 돌아와 ${league.teams[origin].name} 복귀 (${yrs}년, 연 ${(p.contract.salary / 10000).toFixed(1)}억 원)`, origin === off.userTeam, true);
      addArticle(league, { year, day: -1, kind: 'overseas', franchise: league.teams[origin].franchise, title: `${p.name}, ${away}년 만에 KBO 복귀`,
        body: `해외에서 뛰던 ${p.name}이(가) 원 소속 ${league.teams[origin].name}로 돌아온다. ${yrs}년 계약.` });
    } else {
      p.team = -1;
      off.returnees.push(p.id);
      addArticle(league, { year, day: -1, kind: 'overseas', title: `${p.name}, ${away}년 만에 KBO 복귀 추진`, body: `해외에서 뛰던 ${p.name}이(가) FA로 KBO 복귀를 추진한다. 보상 없이 어느 구단과도 계약할 수 있다.` });
    }
  }
  // 포스팅 요청
  off.postings = [];
  if (year + 1 < 1999) return; // 한미 선수계약협정(포스팅) 전
  const domestic = league.players.filter((p) => p.team >= 0 && !p.foreign && !p.dev && !isServing(p) && !isFuturesTeam(league, p.team, year + 1));
  const now = (p: LeaguePlayer) => { const sp = view.sim.get(p.id); return sp ? currentRuns(sp, view.ctx) : 0; };
  const top = domestic.map((p) => ({ p, r: now(p) })).sort((a, b) => b.r - a.r || a.p.id.localeCompare(b.p.id)).slice(0, 12);
  let n = 0;
  for (const { p, r } of top) {
    if (n >= DEPARTURES_PER_YEAR) break;
    const age = ageIn(p, year + 1);
    if (age < 23 || age > 31 || p.service + (p.faCount ? 9 : 0) < POSTING_SERVICE || faEligible(p, year) || p.returnedFromAbroad) continue;
    if (!new Rng(`${league.seed}/posting/${year}/${p.id}`).chance(POSTING_CHANCE)) continue;
    const fee = postingFee(r);
    n++;
    if (p.team === off.userTeam) {
      off.postings.push({ id: p.id, fee });
      log(off, 'settle', `${p.name}이(가) 해외 진출(포스팅)을 요청했습니다. 보내면 이적료 약 ${(fee / 10000).toFixed(0)}억 원 (정원 정리 단계 전까지 결정)`, true, true);
      continue;
    }
    const from = p.team;
    league.ledger.push({ year: year + 1, from: -1, to: from, amount: fee, note: `${p.name} 포스팅 이적료`, kind: 'posting' });
    sendAbroad(p, year + 1, from, 'posting');
    log(off, 'settle', `${p.name}, 포스팅으로 해외 진출 (${league.teams[from].name}, 이적료 ${(fee / 10000).toFixed(0)}억 원)`, false, true);
    addArticle(league, { year, day: -1, kind: 'overseas', franchise: league.teams[from].franchise, title: `${p.name}, 해외 진출`,
      body: `${league.teams[from].name} ${p.name}이(가) 포스팅으로 해외 무대에 도전한다.` });
  }
}

/** 플레이어가 우리 선수의 포스팅 요청에 답한다 (보내면 이적료를 받고 해외로) */
export function answerPosting(league: LeagueState, off: OffseasonState, id: string, accept: boolean): OfferCheck {
  const req = off.postings?.find((x) => x.id === id);
  const p = league.players.find((x) => x.id === id);
  if (!req || !p || req.decided || p.team !== off.userTeam) return { ok: false, message: '답할 포스팅 요청이 없습니다.' };
  if (off.stage === 'release' || off.stage === 'ready') return { ok: false, message: '포스팅은 정원 정리 단계 전까지 정해야 합니다.' };
  req.decided = accept ? 'accept' : 'decline';
  if (!accept) {
    log(off, 'settle', `${p.name}의 포스팅 요청을 거절했습니다.`, true);
    return { ok: true, message: `${p.name}을(를) 붙잡았습니다.` };
  }
  league.ledger.push({ year: off.year + 1, from: -1, to: off.userTeam, amount: req.fee, note: `${p.name} 포스팅 이적료`, kind: 'posting' });
  sendAbroad(p, off.year + 1, off.userTeam, 'posting');
  log(off, 'settle', `${p.name}, 포스팅으로 해외 진출 (이적료 ${(req.fee / 10000).toFixed(0)}억 원)`, true, true);
  addArticle(league, { year: off.year, day: -1, kind: 'overseas', franchise: league.teams[off.userTeam].franchise, title: `${p.name}, 해외 진출`,
    body: `${league.teams[off.userTeam].name} ${p.name}이(가) 포스팅으로 해외 무대에 도전한다.` });
  return { ok: true, message: `${p.name}을(를) 해외로 보냈습니다 (이적료 ${(req.fee / 10000).toFixed(0)}억 원).` };
}

// ---- FA

/** 자격 있는 선수 중 FA를 신청하는 선수로 시장을 연다 */
function openFaMarket(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  const view = leagueView(league, store, params);
  const year = off.year;
  for (const p of league.players) {
    if (!faEligible(p, year)) continue;
    const sp = view.sim.get(p.id)!;
    const age = ageIn(p, year + 1);
    const years = faYears(age);
    let sum = 0;
    for (let y = 0; y < years; y++) sum += currentRuns(sp, view.ctx) + projectedShift(sp, y, view.ctx);
    const ask = marketSalary(sum / years);
    // 신청 여부 (임시 규칙): 대체 선수 이하면 신청하지 않고, 34세 이상은 지금 연봉보다 많이 받을 수 있을 때만
    if (currentRuns(sp, view.ctx) < 0) continue;
    if (age >= 34 && ask < p.contract.salary * 0.9) continue;
    off.fa.entries.push({ id: p.id, from: p.team, grade: faGrade(p, league.players, year), prevSalary: p.contract.salary, ask, years, status: 'open' });
  }
  // 해외에서 FA로 돌아온 선수 (보상 없음)
  for (const id of off.returnees ?? []) {
    const p = league.players.find((x) => x.id === id && x.team === -1);
    const sp = p && view.sim.get(p.id);
    if (!p || !sp) continue;
    const years = faYears(ageIn(p, year + 1));
    let sum = 0;
    for (let y = 0; y < years; y++) sum += currentRuns(sp, view.ctx) + projectedShift(sp, y, view.ctx);
    const ask = marketSalary(sum / years);
    off.fa.entries.push({ id, from: p.abroad?.origin ?? -1, grade: 'C', prevSalary: ask, ask, years, status: 'open', returnee: true });
  }
  off.fa.entries.sort((a, b) => b.ask - a.ask || a.id.localeCompare(b.id));
  // 정상급 FA 일부는 국내 FA 대신 해외로 간다 (overseas.ts): A등급, 31세 이하, 한 해 1명까지, 확률 20%
  const departing = new Set<string>();
  for (const e of off.fa.entries) {
    if (departing.size >= 1 || e.returnee || e.grade !== 'A') continue;
    const p = league.players.find((x) => x.id === e.id)!;
    if (p.foreign || ageIn(p, year + 1) > 31) continue;
    if (!new Rng(`${league.seed}/fa-abroad/${year}/${p.id}`).chance(0.2)) continue;
    e.status = 'left';
    sendAbroad(p, year + 1, e.from, 'fa');
    departing.add(p.id);
    log(off, 'fa', `${p.name}, FA로 해외 진출 (${league.teams[e.from].name})`, e.from === off.userTeam, true);
  }
  for (const e of off.fa.entries) {
    if (departing.has(e.id)) continue;
    const p = league.players.find((x) => x.id === e.id)!;
    log(off, 'fa', e.returnee ? `${p.name} 해외에서 복귀, FA 시장에 나옴 (보상 없음${league.teams[e.from] ? `, 원 소속 ${league.teams[e.from].name}` : ''})`
      : `${p.name} FA 신청 (${e.grade}등급, ${league.teams[e.from].name})`, e.from === off.userTeam || !!e.returnee);
  }
}

function projectedShift(p: SimPlayer, y: number, ctx: ValueContext): number {
  // playerValue([0..1 가중치])로 y시즌 뒤 값을 꺼낸다
  const w = new Array(y + 1).fill(0);
  w[y] = 1;
  return playerValue(p, ctx, w) - Math.max(-5, currentRuns(p, ctx));
}

export interface OfferCheck {
  ok: boolean;
  message: string;
}

/** 플레이어 구단의 FA 제시를 검사하고 등록한다 (라운드 마감 때 선수가 고른다) */
export function offerFa(league: LeagueState, off: OffseasonState, id: string, salary: number, years: number): OfferCheck {
  const e = off.fa.entries.find((x) => x.id === id);
  if (off.stage !== 'fa' || !e || e.status !== 'open') return { ok: false, message: '지금 제시할 수 없는 선수입니다.' };
  if (!Number.isFinite(salary) || salary < MIN_SALARY) return { ok: false, message: `연봉은 최저 연봉 ${(MIN_SALARY / 10000).toFixed(1)}억 원(${MIN_SALARY.toLocaleString('ko-KR')}만 원) 이상이어야 합니다.` };
  if (!Number.isInteger(years) || years < 1 || years > 6) return { ok: false, message: '계약 기간은 1~6년입니다.' };
  const t = off.userTeam;
  if (e.from !== t) {
    // 이미 계약한 수 + 이번 라운드에 낸 다른 외부 제시 수. 제시가 모두 받아들여져도 한도를 넘지 않게 한다
    const pending = Object.keys(off.fa.userOffers).filter((k) => k !== id && off.fa.entries.find((x) => x.id === k)?.from !== t).length;
    if (off.fa.signings[t] + pending >= MAX_FA_SIGNINGS) {
      const left = Math.max(0, MAX_FA_SIGNINGS - off.fa.signings[t]);
      return { ok: false, message: `외부 FA는 한 오프시즌에 ${MAX_FA_SIGNINGS}명까지 데려올 수 있습니다 (계약 ${off.fa.signings[t]}명, 이번 라운드 다른 외부 제시 ${pending}명${left ? `, 남은 자리 ${left}명` : ''}). 다른 제시를 거두면 제시할 수 있습니다.` };
    }
  }
  // 계약금: 이번 라운드 다른 제시의 계약금까지 합쳐 지금 자금으로 낼 수 있어야 한다 (finance.ts)
  const bonus = signingBonus(salary, years);
  const otherBonus = Object.entries(off.fa.userOffers).filter(([k]) => k !== id).reduce((s, [, o]) => s + signingBonus(o.salary, o.years), 0);
  const cash = cashOf(league, t);
  if (bonus + otherBonus > cash) {
    return { ok: false, message: `계약금 ${(bonus / 10000).toFixed(1)}억 원(총액의 30%)${otherBonus ? `과 다른 제시의 계약금 ${(otherBonus / 10000).toFixed(1)}억 원` : ''}을 낼 자금이 모자랍니다 (자금 ${(cash / 10000).toFixed(1)}억 원).` };
  }
  const limit = spendLimit(league, t, off.year + 1);
  if (limit !== null) {
    const p = league.players.find((x) => x.id === id)!;
    const others = Object.entries(off.fa.userOffers).filter(([k]) => k !== id).reduce((s, [, o]) => s + o.salary, 0);
    const base = capPayroll(league.players, t) - (p.team === t ? p.contract.salary : 0);
    if (base + others + salary > limit) {
      const cap = salaryCap(off.year + 1);
      const what = cap === null || limit < cap ? '구단 예산' : '샐러리캡';
      return { ok: false, message: `${what}(${Math.round(limit / 10000)}억 원)을 넘습니다. 지금 다른 제시를 포함한 합계로 검사합니다.` };
    }
  }
  off.fa.userOffers[id] = { team: t, salary: Math.round(salary), years };
  return { ok: true, message: '제시했습니다. 라운드가 끝나면 선수가 답합니다.' };
}

export function withdrawFa(off: OffseasonState, id: string): void {
  delete off.fa.userOffers[id];
}

/** FA 라운드를 마감한다: AI 구단이 제시하고, 선수가 가장 좋은 조건을 고른다. 마지막 라운드면 다음 단계로 */
export function resolveFaRound(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams = DEFAULT_PARAMS): void {
  if (off.stage !== 'fa') return;
  const view = leagueView(league, store, params);
  const players = byId(league);
  const round = off.fa.round;
  // 구단별 지출 상한: 샐러리캡과 모기업 예산 중 작은 쪽 (owner.ts)
  const limits = league.teams.map((_, t) => spendLimit(league, t, off.year + 1));
  const tendency = league.teams.map((_, t) => tendencyFor(league, view, t));

  for (const e of off.fa.entries) {
    if (e.status !== 'open') continue;
    const p = players.get(e.id)!;
    const sp = view.sim.get(e.id)!;
    const offers: FaOffer[] = [];
    const user = off.fa.userOffers[e.id];
    // 제시 때도 막지만, 마감 때 한 번 더 본다 (앞 선수와 계약해 한도가 찼으면 이 제시는 없던 것이 된다)
    if (user && (e.from === user.team || off.fa.signings[user.team] < MAX_FA_SIGNINGS)) offers.push(user);
    else if (user) log(off, 'fa', `${players.get(e.id)!.name}: 외부 FA 영입 한도(${MAX_FA_SIGNINGS}명)가 차서 우리 제시는 철회됐습니다.`, true);
    for (let t = 0; t < league.teams.length; t++) {
      if (t === off.userTeam || isFuturesTeam(league, t, off.year + 1)) continue;
      const home = t === e.from;
      if (!home && off.fa.signings[t] >= MAX_FA_SIGNINGS) continue;
      const base = e.ask * FA_AI_OFFER[round - 1];
      if (limits[t] !== null && capPayroll(league.players, t) - (home ? p.contract.salary : 0) + base > limits[t]!) continue;
      if (cashOf(league, t) < signingBonus(base * 1.15, e.years)) continue; // 계약금을 낼 자금
      const gain = signingGain(view, t, sp, e.years, tendency[t], home);
      const comp = home || e.returnee ? 0 : COMPENSATION[e.grade] * e.prevSalary;
      // 단장 성향 (gm.ts): 윈나우형은 적극적, 짠돌이형은 소극적, 육성형은 28세 이하만 적극적
      const style = gmStyle(league, t);
      const young = style === 'develop' && p.birthYear !== null && off.year + 1 - p.birthYear <= 28;
      const cost = costRuns(base, e.years, comp) * FA_WILLINGNESS * GM_FA_COST[style] * (young ? GM_FA_YOUNG : 1);
      if (gain < cost) continue;
      const eager = Math.min(2, Math.max(0, gain / cost - 1));
      offers.push({ team: t, salary: Math.round(Math.min(e.ask * 1.15, base * (1 + 0.05 * eager))), years: e.years });
    }
    const faDemand = settingsOf(league).faDemand;
    const ok = offers.filter((o) => o.salary >= e.ask * FA_ACCEPT[round - 1] * (o.team === off.userTeam ? faDemand : 1));
    const mine = offers.find((o) => o.team === off.userTeam);
    if (!ok.length) {
      if (mine) log(off, 'fa', `${p.name}: 우리 제시(연 ${wonText(mine.salary)})는 선수 요구에 못 미쳐 이번 라운드에 받아들여지지 않았습니다.`, true);
      continue;
    }
    const score = (o: FaOffer) => o.salary * (1 + 0.04 * (o.years - 1)) * (o.team === e.from ? 1.05 : 1);
    ok.sort((a, b) => score(b) - score(a) || (a.team === off.userTeam ? -1 : 1));
    if (mine && ok[0].team !== off.userTeam) {
      const why = ok.includes(mine) ? '다른 구단이 더 좋은 조건' : '우리 제시가 선수 요구에 못 미침';
      log(off, 'fa', `${p.name}: 우리 제시(연 ${wonText(mine.salary)})는 선택되지 않았습니다. 계약 구단: ${league.teams[ok[0].team].name} (${why})`, true);
    }
    signFa(league, off, e, ok[0], round, view);
  }

  // 플레이어 제시는 라운드마다 새로 한다 (받아들여지지 않은 제시는 사라진다)
  off.fa.userOffers = {};
  if (round < FA_ROUNDS) {
    off.fa.round++;
    return;
  }
  // 마지막 라운드 뒤 (임시 규칙): AI 구단마다 1년 계약으로 자기 평가액을 내고(원 소속이 아니면 보상금만큼 깎임),
  // 가장 높은 구단과 요구액의 80% 이내(최저 연봉 이상)에서 계약한다. 어느 구단에도 전력 이득이 없으면 무적 선수가 되어 리그를 떠난다.
  for (const e of off.fa.entries) {
    if (e.status !== 'open') continue;
    const p = players.get(e.id)!;
    const sp = view.sim.get(e.id)!;
    let best: FaOffer | null = null;
    for (let t = 0; t < league.teams.length; t++) {
      if (t === off.userTeam || isFuturesTeam(league, t, off.year + 1)) continue;
      const home = t === e.from;
      if (!home && off.fa.signings[t] >= MAX_FA_SIGNINGS) continue;
      const gain = signingGain(view, t, sp, 1, tendency[t], home);
      if (gain <= 0) continue;
      const worth = marketSalary(gain / FA_WILLINGNESS) - (home ? 0 : COMPENSATION[e.grade] * e.prevSalary);
      if (!home && worth < MIN_SALARY) continue;
      const salary = Math.max(MIN_SALARY, Math.round(Math.min(e.ask * 0.8, worth)));
      if (limits[t] !== null && capPayroll(league.players, t) - (home ? p.contract.salary : 0) + salary > limits[t]!) continue;
      if (cashOf(league, t) < signingBonus(salary, 1)) continue; // 계약금을 낼 자금
      if (!best || salary * (home ? 1.05 : 1) > best.salary * (best.team === e.from ? 1.05 : 1)) best = { team: t, salary, years: 1 };
    }
    if (best) {
      signFa(league, off, e, best, FA_ROUNDS + 1, view);
    } else {
      e.status = 'left';
      p.team = -1;
      moveInView(view, sp, -1);
      log(off, 'fa', `${p.name}: 계약하지 못하고 리그를 떠났습니다.`, e.from === off.userTeam);
    }
  }
  enterComp(league, off, store, params);
}

// ---- FA 보상선수

/** 보호선수 명단에 넣지 않아도 자동 보호되는 선수: 외국인, 군 보류(복무 중), 이번 오프시즌 FA 계약 선수 */
export function autoProtected(off: OffseasonState, p: LeaguePlayer): boolean {
  if (p.foreign || isServing(p)) return true;
  return off.fa.entries.some((e) => e.id === p.id && e.status === 'signed');
}

/** 보호선수 명단 대상 (영입 구단 소속 중 자동 보호가 아닌 선수) */
export function protectPool(league: LeagueState, off: OffseasonState, c: CompCase): LeaguePlayer[] {
  return league.players.filter((p) => p.team === c.to && !autoProtected(off, p));
}

/** AI가 매기는 선수 가치 (보호·지명 판단): 지금과 앞으로 몇 해의 기여 (런) */
function compValue(view: LeagueView, id: string): number {
  return playerValue(view.sim.get(id)!, view.ctx, horizonWeights('rebuild', 1));
}

/** 가치 높은 순으로 보호 인원만큼 (AI 구단의 명단, 플레이어 구단의 추천 명단) */
export function suggestProtect(league: LeagueState, off: OffseasonState, c: CompCase, view: LeagueView): string[] {
  return protectPool(league, off, c)
    .map((p) => ({ id: p.id, v: compValue(view, p.id) }))
    .sort((a, b) => b.v - a.v || a.id.localeCompare(b.id))
    .slice(0, FA_COMP[c.grade].protect!)
    .map((x) => x.id);
}

/** 보상선수 후보: 영입 구단 소속 중 자동 보호도 아니고 보호 명단에도 없는 선수 */
export function compCandidates(league: LeagueState, off: OffseasonState, c: CompCase): LeaguePlayer[] {
  const prot = new Set(c.protect);
  return protectPool(league, off, c).filter((p) => !prot.has(p.id));
}

function enterComp(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  const cases: CompCase[] = [];
  for (const e of off.fa.entries) {
    if (e.status !== 'signed' || e.team === undefined || e.team === e.from || e.returnee || FA_COMP[e.grade].withPlayer === null) continue;
    cases.push({ fa: e.id, from: e.from, to: e.team, grade: e.grade, prevSalary: e.prevSalary, protect: [], pick: null });
  }
  if (!cases.length) {
    log(off, 'comp', 'A·B등급 FA의 구단 이동이 없어 보상선수 단계를 건너뜁니다.', true);
    enterForeign(league, off, store, params);
    return;
  }
  off.stage = 'comp';
  off.comp = cases;
  const view = leagueView(league, store, params);
  // 영입 구단의 보호선수 명단 (플레이어 구단 것은 추천 명단으로 채워 두고 고칠 수 있다)
  for (const c of cases) c.protect = suggestProtect(league, off, c, view);
}

export function setProtectByUser(league: LeagueState, off: OffseasonState, fa: string, ids: string[]): OfferCheck {
  const c = off.comp?.find((x) => x.fa === fa);
  if (off.stage !== 'comp' || !c || c.to !== off.userTeam) return { ok: false, message: '우리 구단이 보호선수 명단을 낼 건이 아닙니다.' };
  const pool = new Set(protectPool(league, off, c).map((p) => p.id));
  const uniq = [...new Set(ids)];
  if (uniq.some((id) => !pool.has(id))) return { ok: false, message: '보호선수 명단에 넣을 수 없는 선수가 있습니다.' };
  const n = FA_COMP[c.grade].protect!;
  if (uniq.length > n) return { ok: false, message: `보호선수는 ${n}명까지입니다.` };
  c.protect = uniq;
  return { ok: true, message: `보호선수 ${uniq.length}명을 정했습니다.` };
}

export function pickCompByUser(league: LeagueState, off: OffseasonState, fa: string, pick: string): OfferCheck {
  const c = off.comp?.find((x) => x.fa === fa);
  if (off.stage !== 'comp' || !c || c.from !== off.userTeam) return { ok: false, message: '우리 구단이 보상을 고를 건이 아닙니다.' };
  if (pick !== 'cash' && !compCandidates(league, off, c).some((p) => p.id === pick)) {
    return { ok: false, message: '보상선수로 고를 수 없는 선수입니다 (보호선수이거나 자동 보호 대상).' };
  }
  c.pick = pick;
  const p = pick === 'cash' ? null : league.players.find((x) => x.id === pick)!;
  return { ok: true, message: p ? `보상선수로 ${p.name} 선수를 골랐습니다.` : '보상금만 받기로 했습니다.' };
}

/**
 * AI 기준의 보상 선택: 보호 밖에서 가치(앞으로 몇 해의 기여)가 가장 높은 선수. 후보가 아무도 없을 때만 보상금만.
 * 실제 KBO 구단은 A·B등급 보상에서 거의 늘 선수를 데려가고, 게임 안에서 보상금은 장부에만 남아 전력에 보탬이 없다.
 * (2026-10-08 수정 전에는 "선수 가치 > 추가 보상금(연봉 차액)"이라 보호 20~25명 밖의 선수는 늘 그보다 낮아 사실상 보상금만 골랐다)
 */
function aiCompPick(league: LeagueState, off: OffseasonState, c: CompCase, view: LeagueView): string {
  const best = compCandidates(league, off, c)
    .map((p) => ({ p, v: compValue(view, p.id) }))
    .sort((a, b) => b.v - a.v || a.p.id.localeCompare(b.p.id))[0];
  return best ? best.p.id : 'cash';
}

/** 플레이어 구단의 보상을 AI 기준으로 고른다 (자동 선택) */
export function autoCompUser(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams = DEFAULT_PARAMS): void {
  if (off.stage !== 'comp') return;
  const view = leagueView(league, store, params);
  for (const c of off.comp ?? []) if (c.from === off.userTeam && c.pick === null) c.pick = aiCompPick(league, off, c, view);
}

/** 단계를 마감한다: 고르지 않은 건은 AI가 고르고, 선수 이동과 보상금을 처리한다 */
function finishComp(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  const view = leagueView(league, store, params);
  const players = byId(league);
  for (const c of off.comp ?? []) {
    const rule = FA_COMP[c.grade];
    const faName = players.get(c.fa)!.name;
    const cands = compCandidates(league, off, c);
    // 앞선 건에서 이미 옮겨 간 선수는 고를 수 없다
    let pick = c.pick;
    if (pick !== null && pick !== 'cash' && !cands.some((p) => p.id === pick)) pick = null;
    if (pick === null) pick = aiCompPick(league, off, c, view);
    c.pick = pick;
    const mine = c.from === off.userTeam || c.to === off.userTeam;
    if (pick === 'cash') {
      const amount = Math.round(rule.cashOnly * c.prevSalary);
      league.ledger.push({ year: off.year + 1, from: c.to, to: c.from, amount, note: `${faName} FA 보상금 (${c.grade}등급, 보상선수 없이)` });
      log(off, 'comp', `${faName} 보상: ${league.teams[c.from].name}, 보상금만 ${(amount / 10000).toFixed(1)}억 원 (${c.grade}등급)`, mine);
    } else {
      const amount = Math.round(rule.withPlayer! * c.prevSalary);
      const p = players.get(pick)!;
      p.team = c.from;
      moveInView(view, view.sim.get(p.id)!, c.from);
      league.ledger.push({ year: off.year + 1, from: c.to, to: c.from, amount, note: `${faName} FA 보상금 (${c.grade}등급, 보상선수 ${p.name})` });
      log(off, 'comp', `${faName} 보상선수: ${p.name}, ${league.teams[c.to].name} → ${league.teams[c.from].name} (보상금 ${(amount / 10000).toFixed(1)}억 원)`, mine, true);
    }
  }
}


function signFa(league: LeagueState, off: OffseasonState, e: FaEntry, o: FaOffer, round: number, view: LeagueView): void {
  const p = league.players.find((x) => x.id === e.id)!;
  const year = off.year;
  e.status = 'signed';
  e.team = o.team;
  e.salary = o.salary;
  e.signedYears = o.years;
  e.round = round;
  // 팬덤 (stadium.ts): 프랜차이즈 스타가 FA로 떠나면 실망, 붙잡으면 반긴다
  if (!e.returnee && e.from >= 0) {
    const runs = currentRuns(view.sim.get(p.id)!, view.ctx);
    if (o.team === e.from) starStays(league, e.from, year, p, runs);
    else if (starLeaves(league, e.from, year, -2, p, runs, 'fa')) log(off, 'fa', `${league.teams[e.from].name} 팬들이 프랜차이즈 스타 ${p.name}의 이적에 실망했습니다`, e.from === off.userTeam, true);
  }
  p.team = o.team;
  const bonus = signingBonus(o.salary, o.years);
  p.contract = { kind: 'fa', salary: o.salary, until: year + o.years, prepaid: Math.round(bonus / o.years) };
  league.ledger.push({ year: year + 1, from: o.team, to: -1, amount: bonus, note: `${p.name} FA 계약금`, kind: 'signing' });
  p.faCount++;
  p.lastFaYear = year + 1;
  p.service = 0;
  moveInView(view, view.sim.get(p.id)!, o.team);
  const mine = o.team === off.userTeam || e.from === off.userTeam;
  const money = `${o.years}년, 연 ${(o.salary / 10000).toFixed(1)}억 원, 계약금 ${(bonus / 10000).toFixed(1)}억 원`;
  if (e.returnee) {
    delete p.abroad;
    p.returnedFromAbroad = year + 1;
    if (o.team !== e.from) off.fa.signings[o.team]++;
    log(off, 'fa', `${p.name}, 해외에서 돌아와 ${league.teams[o.team].name}와(과) 계약 (${money})`, mine, true);
  } else if (o.team === e.from) {
    log(off, 'fa', `${p.name}, ${league.teams[o.team].name} 잔류 (${money})`, mine);
  } else {
    off.fa.signings[o.team]++;
    if (FA_COMP[e.grade].withPlayer === null) {
      const comp = Math.round(FA_COMP[e.grade].cashOnly * e.prevSalary);
      league.ledger.push({ year: year + 1, from: o.team, to: e.from, amount: comp, note: `${p.name} FA 보상금 (${e.grade}등급)` });
      log(off, 'fa', `${p.name}, ${league.teams[e.from].name} → ${league.teams[o.team].name} (${money}). 보상금 ${(comp / 10000).toFixed(1)}억 원`, mine);
    } else {
      log(off, 'fa', `${p.name}, ${league.teams[e.from].name} → ${league.teams[o.team].name} (${money}). ${e.grade}등급: 보상은 보상선수 단계에서`, mine);
    }
  }
}

// ---- 시대 (M8): FA 도입 전, 구단 변화, 창단 수급

/** FA 단계 진입: 제도가 없던 시대(1999 시즌 뒤 도입)는 건너뛴다 */
function enterFa(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  if (faEnabled(off.year)) {
    openFaMarket(league, off, store, params);
    return;
  }
  log(off, 'fa', `${off.year} 시즌 뒤에는 FA 제도가 없어 FA 단계를 건너뜁니다 (1999 시즌 뒤 도입).`, true);
  enterComp(league, off, store, params);
}

/** 외국인·드래프트 지명 순서: 지난 시즌 순위 역순. 지난 시즌에 없던 구단(창단)은 맨 앞 */
/** 다음 드래프트 라운드 순서 (지난 시즌 역순, 순위가 없는 구단이 맨 앞). 캡 제재·창단 특례는 빼고 본 기본 순서 */
export function pickOrder(league: LeagueState): number[] {
  const st = league.lastSeason?.standings ?? league.teams.map((_, i) => i);
  const missing = league.teams.map((_, i) => i).filter((i) => !st.includes(i));
  return [...missing, ...[...st].reverse()];
}

/**
 * 창단 구단의 추가 지명 (2026-10-11 사용자 요청으로 실제대로). 우선·특별 지명은 KBO 공통 규칙이 아니라 창단 구단 특례였다 (지명 자료로 확인):
 * - 우선 지명: 쌍방울 1990·1991 입단 10명씩, NC 2012·2013 입단 2명씩, KT 2014·2015 입단 2명씩. 드래프트 라운드와 별도로 맨 먼저 고른다
 * - 특별 지명: NC 5명·3명(2라운드 뒤), KT 5명·3명(1라운드 뒤). 쌍방울·빙그레는 없다
 * - 라운드 지명은 다른 구단과 함께 하고, 첫 드래프트에서는 1라운드 맨 끝 (enterDraft의 순서)
 * 인원은 그 구단의 실제 첫 두 드래프트(1군 첫해 직전 해와 그해 입단) 지명 자료에서 읽는다 (expansionRule).
 * 창단 구단은 1군 진입 2년 전 오프시즌에 퓨처스 구단으로 들어와 이 두 드래프트에 참가한다 (applyTeamChanges).
 */
/** 특별 지명이 들어가는 라운드 (그 라운드 뒤). 구단 계보별, 없으면 2 (NC 방식) */
export const EXPANSION_SPECIAL_AFTER: Record<string, number> = { NC: 2, KT: 1 };
/** 자료에 창단 구단 특례가 없을 때(2027년 이후 가상의 창단 등) 쓰는 인원 (NC 방식) */
export const EXPANSION_DEFAULT = { priority: [2, 2], special: [5, 3] };
/** 예전 이름 (테스트 호환): 특별 지명 인원 */
export const EXPANSION_SPECIAL = EXPANSION_DEFAULT.special;

/** 창단 구단의 n번째(0부터) 드래프트 특례: 우선·특별 지명 인원과 특별 지명 위치. firstYear: 1군 첫 시즌 */
export function expansionRule(store: Pick<DataStore, 'drafts' | 'meta'>, franchise: string, firstYear: number, nth: number): { priority: number; special: number; after: number } {
  const after = EXPANSION_SPECIAL_AFTER[franchise] ?? 2;
  const names = new Set((store.meta.franchises[franchise] ?? []).map((x) => x.name).concat(franchise));
  const years = [firstYear - 1, firstYear];
  const known = years.some((y) => store.drafts?.[String(y)]);
  if (!known) return { priority: EXPANSION_DEFAULT.priority[nth] ?? 0, special: EXPANSION_DEFAULT.special[nth] ?? 0, after };
  const rows = (store.drafts?.[String(years[nth])] ?? []).filter((r) => names.has(r.team));
  return { priority: rows.filter((r) => r.kind === '우선').length, special: rows.filter((r) => r.kind === '특별').length, after };
}

/** 지명권 구분: 0 = 우선 지명, -1 = 특별 지명, n = n라운드 */
export const PICK_PRIORITY = 0;
export const PICK_SPECIAL = -1;
export function pickKindLabel(kind: number): string {
  return kind === PICK_PRIORITY ? '우선 지명' : kind === PICK_SPECIAL ? '특별 지명' : `${kind}라운드`;
}

type ExpansionPicks = { team: number; special: number; after?: number; priority?: number };
export function expansionSlots(slots: number[], nTeams: number, expanding: ExpansionPicks[]): number[] {
  return expansionDraft(slots, nTeams, expanding).slots;
}

/** 라운드 지명권(slots, 라운드마다 nTeams개)에 창단 구단의 우선·특별 지명을 넣는다. kinds는 지명권마다 구분 */
export function expansionDraft(slots: number[], nTeams: number, expanding: ExpansionPicks[]): { slots: number[]; kinds: number[] } {
  const out = slots.map((t, i) => ({ t, k: Math.floor(i / nTeams) + 1 }));
  // 뒤쪽부터 넣어야 앞쪽 위치가 밀리지 않는다
  for (const e of [...expanding].sort((a, b) => (b.after ?? 2) - (a.after ?? 2))) {
    if (!e.special) continue;
    const at = Math.min(out.length, nTeams * (e.after ?? 2));
    out.splice(at, 0, ...Array.from({ length: e.special }, () => ({ t: e.team, k: PICK_SPECIAL })));
  }
  for (const e of expanding) out.unshift(...Array.from({ length: e.priority ?? 2 }, () => ({ t: e.team, k: PICK_PRIORITY })));
  return { slots: out.map((x) => x.t), kinds: out.map((x) => x.k) };
}

/**
 * 그 해 드래프트가 지그재그였나: 실제 지명 자료에서 2라운드 순서가 1라운드를 뒤집은 것이면 지그재그.
 * 자료가 없는 해는 가장 가까운 앞의 해, 그것도 없으면 가까운 뒤의 해를 따른다 (2027년 이후는 2026년 방식).
 */
export function snakeDraftYear(store: Pick<DataStore, 'drafts'>, entryYear: number): boolean {
  const judge = (y: number): boolean | null => {
    const rows = store.drafts?.[String(y)];
    if (!rows) return null;
    const r = (n: number) => rows.filter((x) => x.kind === '라운드' && x.round === n && x.overall).sort((a, b) => a.overall! - b.overall!).map((x) => x.team);
    const r1 = r(1);
    const r2 = r(2);
    if (r1.length < 4 || r2.length < 4) return null;
    const rev = [...r1].reverse();
    const same = r2.filter((t, i) => t === r1[i]).length;
    const flipped = r2.filter((t, i) => t === rev[i]).length;
    return flipped > same;
  };
  for (let d = 0; d < 60; d++) {
    const a = judge(entryYear - d);
    if (a !== null) return a;
    const b = judge(entryYear + d);
    if (b !== null) return b;
  }
  return false;
}

/** 기존 구단이 특별 지명에서 보호하는 인원 (기획서 4.1: 보호선수 20명 외 1명씩) */
export const EXPANSION_PROTECT = 20;
/** 창단 구단의 최소 소속 인원. 모자라면 가상 창단 선수로 채운다 (임시값) */
export const EXPANSION_MIN = 45;

/**
 * 다음 시즌의 구단 변화를 리그에 반영한다 (기획서 4.1): 명칭 변경은 이름만, 해체는 후속 구단이 승계, 창단은 새 구단 자리와 선수 수급.
 * 자료가 있는 해(2026년까지)만. 사용자 구단이어도 같다.
 */
function applyTeamChanges(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  const changes = teamChangesFor(store, league.teams, off.year + 1);
  off.changes = changes.length ? changes : undefined;
  for (const c of changes) {
    if (c.kind === 'rename') league.teams[c.team].name = c.to;
    else if (c.kind === 'succeed') league.teams[c.team] = { name: c.to, franchise: c.franchise };
    else expandTeam(league, off, store, params, addTeam(league, c.name, c.franchise, off.year + 1));
    const mine = c.kind !== 'expand' && c.team === off.userTeam;
    log(off, 'settle', `${off.year + 1}년: ${changeText(c)}`, mine, true);
  }
  // 퓨처스 구단의 1군 진입: 기존 구단 특별 지명(보호 20명 외)과 창단 선수 보충
  for (const e of league.expansions ?? []) {
    if (e.firstYear !== off.year + 1 || !isFuturesTeam(league, e.team, off.year)) continue;
    log(off, 'settle', `${off.year + 1}년: ${league.teams[e.team].name} 1군 진입`, false, true);
    expandTeam(league, off, store, params, e.team);
  }
  // 1군 진입 2년 전 창단: 퓨처스 구단으로 들어와 이번 드래프트부터 참가한다 (2026-10-11 사용자 결정, 실제 NC·KT 일정)
  for (const c of teamChangesFor(store, league.teams, off.year + 2)) {
    if (c.kind !== 'expand') continue;
    addTeam(league, c.name, c.franchise, off.year + 2);
    log(off, 'settle', `${c.name} 창단: ${off.year + 1}년 퓨처스리그 참가, ${off.year + 2}년 1군 진입 예정. 이번 신인 드래프트부터 지명합니다.`, false, true);
  }
  off.fa.signings = league.teams.map(() => 0);
}

/** 창단 구단 자리를 만든다 (구단 목록 끝). firstYear: 1군 첫 시즌 */
function addTeam(league: LeagueState, name: string, franchise: string, firstYear: number): number {
  const t = league.teams.push({ name, franchise }) - 1;
  league.capStrikes?.push(0);
  league.draftPenalty?.push(null);
  (league.expansions ??= []).push({ team: t, firstYear });
  ensureFinance(league);
  addExpansionCapital(league, t, league.year);
  return t;
}

/** 1군 진입: 기존 구단마다 보호 20명 밖 최고 가치 1명을 특별 지명하고, 모자라는 인원은 가상 창단 선수로 채운다 */
function expandTeam(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams, t: number): void {
  const { name, franchise } = league.teams[t];
  const view = leagueView(league, store, params);
  while (view.orgs.length <= t) view.orgs.push([]);
  for (let o = 0; o < t; o++) {
    const cand = league.players
      .filter((p) => p.team === o && !p.foreign && !isServing(p))
      .map((p) => ({ p, v: compValue(view, p.id) }))
      .sort((a, b) => b.v - a.v || a.p.id.localeCompare(b.p.id))[EXPANSION_PROTECT];
    if (!cand) continue;
    cand.p.team = t;
    moveInView(view, view.sim.get(cand.p.id)!, t);
    log(off, 'settle', `${name} 특별 지명: ${cand.p.name} (${league.teams[o].name}, 보호 ${EXPANSION_PROTECT}명 외)`, o === off.userTeam, false);
  }
  const rng = new Rng(`${league.seed}/expansion/${off.year}/${franchise}`);
  const taken = takenNames(league, store);
  let n = league.players.filter((p) => p.team === t).length;
  let made = 0;
  for (; n < EXPANSION_MIN; n++, made++) {
    const mine = league.players.filter((p) => p.team === t);
    const pitchers = mine.filter((p) => p.isPitcher).length;
    const age = 21 + rng.int(9);
    const runs = -8 + rng.range(-4, 6);
    const p = makeVirtual(league, view, rng, taken, { foreign: false, asia: false, age, runs, potential: runs + rng.range(0, 10), isPitcher: pitchers * 2 <= mine.length }, off.year);
    p.team = t;
    p.contract = { kind: 'reserve', salary: MIN_SALARY, until: off.year + 1 };
    moveInView(view, view.sim.get(p.id)!, t);
  }
  if (made) log(off, 'settle', `${name}: 창단 선수 ${made}명 영입 (해외·독립 리그·퓨처스 출신, 가상 선수)`, false, false);
}

// ---- 외국인 선수

const isForeignOf = (p: LeaguePlayer, t: number) => p.team === t && p.foreign;

/**
 * 재계약하지 않은 외국인을 후보 풀로 보낸다: 무소속으로 두고 요구액을 신규 계약 기준으로 다시 매긴다.
 * (2026-10-09 전수조사 H3: 아시아쿼터 선수가 재계약 연봉 55만 달러를 들고 풀에 들어와 신규 상한 20만 달러에 걸려 아무도 계약하지 못했다)
 */
function toPool(view: LeagueView, p: LeaguePlayer): void {
  p.team = -1;
  p.contract = { ...p.contract, salary: foreignSalary(currentRuns(view.sim.get(p.id)!, view.ctx), true, p.asia) };
}
/** 계약 기간이 이번 오프시즌에 끝나는 외국인 */
const expiring = (p: LeaguePlayer, year: number) => p.foreign && p.contract.until <= year;

function foreignKeepAdvice(view: LeagueView, p: LeaguePlayer, year: number): boolean {
  return currentRuns(view.sim.get(p.id)!, view.ctx) >= FOREIGN_KEEP_RUNS && ageIn(p, year + 1) <= 36;
}

/** 재계약 연봉: 원래 받을 금액과 3명 총액 상한의 남은 몫 중 작은 쪽 (아시아쿼터는 상한 없음, 임시 규칙) */
function resignForeignSalary(view: LeagueView, p: LeaguePlayer, room: number): number {
  const want = foreignSalary(currentRuns(view.sim.get(p.id)!, view.ctx), false, p.asia);
  return p.asia ? want : Math.min(want, Math.max(0, room));
}

/** 이 선수를 뺀 같은 구단 외국인(아시아쿼터 제외)의 연봉 합. 아직 재계약 전인 선수는 빼고 센다 */
function otherRegularPay(league: LeagueState, p: LeaguePlayer, year: number): number {
  return league.players
    .filter((x) => x.team === p.team && x.foreign && !x.asia && x.id !== p.id && !(expiring(x, year) && x.contract.until <= year))
    .reduce((s, x) => s + x.contract.salary, 0);
}

function enterForeign(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  off.stage = 'foreign';
  const year = off.year;
  const rule = foreignRule(store.meta, year + 1);
  if (rule.total === 0) {
    // 외국인 선수 제도가 없던 시대 (1998년 도입, 기획서 4.2)
    log(off, 'foreign', `${year + 1}년에는 외국인 선수 제도가 없어 외국인 단계를 건너뜁니다.`, true);
    enterDraft(league, off, store, params);
    return;
  }
  const view = leagueView(league, store, params);
  const order = pickOrder(league).filter((t) => !isFuturesTeam(league, t, year + 1));
  const pool: string[] = [];

  // 재계약 판단: AI 구단은 바로, 플레이어 구단은 권고만 하고 단계를 넘길 때 정한다.
  // 자료에는 시즌 중 교체된 외국인까지 들어 있어 한 구단에 5명 넘게 있을 수 있으므로, 보유 한도 안에서 좋은 선수부터 남긴다
  const keep: Record<string, boolean> = {};
  const advised = new Set<string>();
  for (let t = 0; t < league.teams.length; t++) {
    const mine = league.players.filter((p) => p.team === t && p.foreign);
    const staying = mine.filter((p) => !expiring(p, year));
    let regular = staying.filter((p) => !p.asia).length;
    let asia = staying.length - regular;
    let pay = staying.filter((p) => !p.asia).reduce((sum, p) => sum + p.contract.salary, 0);
    const cands = mine.filter((p) => expiring(p, year) && foreignKeepAdvice(view, p, year))
      .sort((a, b) => currentRuns(view.sim.get(b.id)!, view.ctx) - currentRuns(view.sim.get(a.id)!, view.ctx) || a.id.localeCompare(b.id));
    for (const p of cands) {
      if (p.asia ? asia >= rule.asia : regular >= rule.regular) continue;
      if (!p.asia && FOREIGN_TOTAL_CAP - pay < FOREIGN_MIN_DEAL) continue;
      advised.add(p.id);
      if (p.asia) asia++;
      else {
        regular++;
        pay += resignForeignSalary(view, p, FOREIGN_TOTAL_CAP - pay);
      }
    }
  }
  for (const p of league.players) {
    if (p.team < 0 || !expiring(p, year)) continue;
    const advice = advised.has(p.id);
    if (p.team === off.userTeam) {
      keep[p.id] = advice;
      continue;
    }
    if (advice) {
      p.contract = { kind: 'foreign', salary: resignForeignSalary(view, p, FOREIGN_TOTAL_CAP - otherRegularPay(league, p, year)), until: year + 1 };
    } else {
      log(off, 'foreign', `${league.teams[p.team].name}, ${p.name}${josa(p.name, '와과')} 재계약하지 않음`, false);
      toPool(view, p);
      pool.push(p.id);
    }
  }

  // 새 외국인 후보 (가상 선수)
  const rng = new Rng(`${league.seed}/foreign/${year}`);
  const taken = takenNames(league, store);
  for (let i = 0; i < FOREIGN_POOL_REGULAR + (rule.asia > 0 ? FOREIGN_POOL_ASIA : 0); i++) {
    const asia = i >= FOREIGN_POOL_REGULAR;
    const p = makeVirtual(league, view, rng, taken, {
      foreign: true, asia, age: asia ? 22 + rng.int(9) : 26 + rng.int(8),
      // 능력: 실제 KBO 외국인 첫 시즌 수준 (2026-10-12 사용자 "외국인들이 너무 구리다"). 일반 20~46런(평균 33, 리그 상위 30~80위권),
      // 아시아쿼터 0~16런. 예전 값은 일반 6~36런(평균 21)이라 보통 주전에 그쳤다
      runs: asia ? 4 + rng.range(-4, 12) : 30 + rng.range(-10, 16),
    }, year);
    p.contract = { kind: 'foreign', salary: foreignSalary(p.potential, true, asia), until: year + 1 };
    p.scoutPotential = scoutView(league, p.potential, rng);
    p.transferFee = transferFeeUsd(p.contract.salary);
    pool.push(p.id);
  }
  off.foreign = { order, pointer: 0, pool, keep, regular: rule.regular, asia: rule.asia };
  runForeignUntilUser(league, off, store, params);
}

export interface ForeignSlots {
  regular: number;
  asia: number;
  /** 아시아쿼터를 뺀 외국인 연봉 합 (달러) */
  regularPay: number;
}

export function foreignSlots(league: LeagueState, team: number, off?: OffseasonState): ForeignSlots {
  const list = league.players.filter((p) => isForeignOf(p, team) && !(off?.foreign && off.foreign.keep[p.id] === false));
  const regular = list.filter((p) => !p.asia);
  return { regular: regular.length, asia: list.length - regular.length, regularPay: regular.reduce((s, p) => s + p.contract.salary, 0) };
}

/** 이번 오프시즌의 외국인 보유 한도 (M8 전 저장에는 없어 2026년 값) */
export function foreignLimits(off: OffseasonState): { regular: number; asia: number } {
  return { regular: off.foreign?.regular ?? FOREIGN_REGULAR, asia: off.foreign?.asia ?? FOREIGN_ASIA };
}

/** 이 외국인 후보와 계약할 수 있는가 (보유 한도와 금액 상한) */
export function canSignForeign(league: LeagueState, off: OffseasonState, team: number, p: LeaguePlayer): OfferCheck {
  if (!off.foreign?.pool.includes(p.id) || p.team !== -1) return { ok: false, message: '계약할 수 없는 선수입니다.' };
  const s = foreignSlots(league, team, off);
  const lim = foreignLimits(off);
  if (p.asia) {
    if (s.asia >= lim.asia) return { ok: false, message: lim.asia ? '아시아쿼터 자리가 찼습니다.' : '아시아쿼터 제도가 없는 시대입니다.' };
    if (p.contract.salary > ASIA_NEW_CAP) return { ok: false, message: '아시아쿼터 신규 계약 상한(20만 달러)을 넘습니다.' };
    return feeCheck(league, team, p);
  }
  if (s.regular >= lim.regular) return { ok: false, message: `외국인 선수는 ${lim.asia ? '아시아쿼터를 빼고 ' : ''}${lim.regular}명까지입니다.` };
  if (p.contract.salary > FOREIGN_NEW_CAP) return { ok: false, message: '신규 외국인 계약 상한(100만 달러)을 넘습니다.' };
  if (s.regularPay + p.contract.salary > FOREIGN_TOTAL_CAP) return { ok: false, message: '외국인 3명 총액 상한(400만 달러)을 넘습니다.' };
  return feeCheck(league, team, p);
}

/** 이적료를 낼 자금이 있는가 (finance.ts) */
function feeCheck(league: LeagueState, team: number, p: LeaguePlayer): OfferCheck {
  const fee = Math.round((p.transferFee ?? 0) * WON_PER_USD);
  const cash = cashOf(league, team);
  if (fee > cash) return { ok: false, message: `이적료 ${dollarText(p.transferFee!)}(${(fee / 10000).toFixed(1)}억 원)를 낼 자금이 모자랍니다 (자금 ${(cash / 10000).toFixed(1)}억 원).` };
  return { ok: true, message: '' };
}

function signForeign(league: LeagueState, off: OffseasonState, team: number, p: LeaguePlayer): void {
  p.team = team;
  p.contract = { ...p.contract, until: off.year + 1 };
  off.foreign!.pool = off.foreign!.pool.filter((x) => x !== p.id);
  const fee = p.transferFee ?? 0;
  if (fee) {
    league.ledger.push({ year: off.year + 1, from: team, to: -1, amount: Math.round(fee * WON_PER_USD), note: `${p.name} 외국인 이적료`, kind: 'transfer' });
    delete p.transferFee;
  }
  log(off, 'foreign', `${league.teams[team].name}, 외국인 ${p.name}${josa(p.name, '와과')} 계약 (${Math.round(p.contract.salary / 10000)}만 달러${fee ? `, 이적료 ${Math.round(fee / 10000)}만 달러` : ''}${p.asia ? ', 아시아쿼터' : ''})`, team === off.userTeam);
}

function aiForeignPicks(league: LeagueState, off: OffseasonState, team: number, view: LeagueView): void {
  const tendency = tendencyFor(league, view, team);
  for (let guard = 0; guard < 4; guard++) {
    let best: LeaguePlayer | null = null;
    let bestGain = 0;
    for (const id of off.foreign!.pool) {
      const p = league.players.find((x) => x.id === id)!;
      if (!canSignForeign(league, off, team, p).ok) continue;
      const gain = signingGain(view, team, view.sim.get(id)!, 2, tendency, false);
      if (gain > bestGain) {
        bestGain = gain;
        best = p;
      }
    }
    if (!best) return;
    signForeign(league, off, team, best);
    moveInView(view, view.sim.get(best.id)!, team);
  }
}

function runForeignUntilUser(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  const f = off.foreign!;
  const view = leagueView(league, store, params);
  while (f.pointer < f.order.length && f.order[f.pointer] !== off.userTeam) {
    aiForeignPicks(league, off, f.order[f.pointer], view);
    f.pointer++;
  }
}

/** 플레이어 구단 외국인의 재계약 여부를 정한다 (단계를 넘길 때 반영). 보유 한도를 넘게 남길 수는 없다 */
export function setForeignKeep(league: LeagueState, off: OffseasonState, id: string, keep: boolean): OfferCheck {
  if (off.stage !== 'foreign' || !off.foreign || !(id in off.foreign.keep)) return { ok: false, message: '재계약 대상이 아닙니다.' };
  const p = league.players.find((x) => x.id === id)!;
  if (keep && !off.foreign.keep[id]) {
    const s = foreignSlots(league, off.userTeam, off);
    const lim = foreignLimits(off);
    if (p.asia ? s.asia >= lim.asia : s.regular >= lim.regular) {
      return { ok: false, message: p.asia ? '아시아쿼터 자리가 찼습니다.' : `외국인 선수는 ${lim.regular}명까지입니다.` };
    }
  }
  off.foreign.keep[id] = keep;
  return { ok: true, message: '' };
}

export function signForeignByUser(league: LeagueState, off: OffseasonState, id: string): OfferCheck {
  if (off.stage !== 'foreign' || !off.foreign) return { ok: false, message: '지금은 외국인 계약 단계가 아닙니다.' };
  const p = league.players.find((x) => x.id === id);
  if (!p) return { ok: false, message: '선수를 찾을 수 없습니다.' };
  const check = canSignForeign(league, off, off.userTeam, p);
  if (check.ok) signForeign(league, off, off.userTeam, p);
  return check;
}

function finishForeign(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  const f = off.foreign!;
  const view0 = leagueView(league, store, params);
  for (const [id, keep] of Object.entries(f.keep)) {
    const p = league.players.find((x) => x.id === id)!;
    if (keep) {
      const room = FOREIGN_TOTAL_CAP - otherRegularPay(league, p, off.year);
      if (!p.asia && room < FOREIGN_MIN_DEAL) {
        toPool(view0, p);
        f.pool.push(id);
        log(off, 'foreign', `${p.name}: 외국인 총액 상한 때문에 재계약하지 못함`, true);
        continue;
      }
      p.contract = { kind: 'foreign', salary: resignForeignSalary(view0, p, room), until: off.year + 1 };
      log(off, 'foreign', `${p.name}${josa(p.name, '와과')} 재계약`, true);
    } else {
      toPool(view0, p);
      f.pool.push(id);
      log(off, 'foreign', `${p.name}${josa(p.name, '와과')} 재계약하지 않음`, true);
    }
  }
  f.keep = {};
  if (f.order[f.pointer] === off.userTeam) f.pointer++;
  const view = leagueView(league, store, params);
  while (f.pointer < f.order.length) {
    aiForeignPicks(league, off, f.order[f.pointer], view);
    f.pointer++;
  }
}

// ---- 신인 드래프트

function enterDraft(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  off.stage = 'draft';
  const year = off.year;
  const view = leagueView(league, store, params);
  const rng = new Rng(`${league.seed}/draft/${year}`);
  const taken = takenNames(league, store);
  const pool: string[] = [];
  // 실제 지명이 있는 해: 풀은 실제 지명 선수 (기획서 5장. 육성선수·원년 멤버는 지명이 아니라 뺀다). 지명은 게임 속 순위 역순으로 다시 한다
  const real = draftPool(store, year + 1);
  let ci: CareerIndex | null = null;
  real.forEach((d, i) => {
    const p = makeDraftee(league, view, rng, taken, d, i, year + 1, store, () => (ci ??= careerIndex(store)));
    pool.push(p.id);
  });
  // 실제 육성선수 계약 신인: 드래프트에는 안 나오고 정원 정리 때 육성선수로 데려올 수 있다 (devPool). 지명 난수와 따로 굴린다
  const devRows = (store.drafts?.[String(year + 1)] ?? []).filter((d) => d.kind === '육성선수');
  const devRng = new Rng(`${league.seed}/dev-rookies/${year}`);
  off.devExtra = devRows.map((d, i) => makeDraftee(league, view, devRng, taken, d, real.length + i, year + 1, store, () => (ci ??= careerIndex(store))).id);
  // 드래프트 미지명 입단 테스트 선수 (가상): 실제 육성 계약 자료가 모자란 만큼. 대부분 1군감이 아니지만 가끔 늦게 피는 선수가 있다 (임시값)
  for (let i = devRows.length; i < DEV_TRYOUTS; i++) {
    const univ = devRng.chance(0.5);
    const potential = -10 + DRAFT_POTENTIAL_SCALE * (-Math.log(1 - devRng.next()) * 0.55) ** 1.2;
    const age = univ ? 23 : 19;
    const runs = univ ? potential * 0.3 - 10 : potential * 0.1 - 15;
    const p = makeVirtual(league, view, devRng, taken, { foreign: false, asia: false, age, runs: runs + devRng.range(-2, 2), potential }, year);
    p.school = univ ? 'UNIV' : 'HS';
    p.scoutPotential = scoutView(league, potential, devRng);
    view.ctx.potential?.set(p.id, aiPotential(league, p));
    p.contract = { kind: 'reserve', salary: MIN_SALARY, until: year + 1 };
    off.devExtra.push(p.id);
  }
  for (let i = 0; i < (real?.length ? 0 : DRAFT_POOL); i++) {
    const univ = rng.chance(0.3);
    // 잠재력 분포: 실제 입단 동기(2012~2018년 입단)의 전성기 기여 순위에 맞춘 식 (M6).
    // 한 해 풀 150명 중 1위 약 45런, 10위 16런, 20위 6런, 40위 0런, 그 아래는 1군 주전감이 아니다.
    // M5의 2 + 58u^2.2는 10위가 52런이라, 장기 진행에서 가상 신인이 실존 선수를 몇 해 만에 모두 밀어냈다.
    const potential = -10 + DRAFT_POTENTIAL_SCALE * (-Math.log(1 - rng.next())) ** 1.2;
    const age = univ ? 22 : 18;
    const runs = univ ? potential * 0.35 - 8 : potential * 0.1 - 14;
    const p = makeVirtual(league, view, rng, taken, { foreign: false, asia: false, age, runs: runs + rng.range(-3, 3), potential }, year);
    p.school = univ ? 'UNIV' : 'HS';
    // 스카우트 평가: 실제 잠재력에 오차 (모든 구단이 같은 평가를 본다. 난이도별 오차는 M7)
    p.scoutPotential = scoutView(league, potential, rng);
    view.ctx.potential?.set(p.id, aiPotential(league, p));
    p.contract = { kind: 'rookie', salary: MIN_SALARY, until: year + 1 };
    pool.push(p.id);
  }
  const order = pickOrder(league);
  // 샐러리캡 2회 이상 연속 초과 구단은 1라운드 지명권이 9단계 밀린다 (owner.ts, 제도연표)
  const penalized = new Set(league.teams.map((_, t) => t).filter((t) => league.draftPenalty?.[t] === year));
  for (const t of penalized) log(off, 'draft', `${league.teams[t].name}: 샐러리캡 연속 초과로 1라운드 지명권 9단계 하락`, t === off.userTeam, true);
  // 창단 구단은 두 번째 드래프트까지 우선 지명 2명과 2라운드 뒤 특별 지명(첫해 5명, 둘째 해 3명)을 더 뽑는다 (실제 NC·KT 방식)
  // 창단 구단의 특례 드래프트는 1군 진입 전 두 번 (NC: 2011·2012 오프시즌 = 2012·2013 입단)
  const expansions = (league.expansions ?? []).filter((e) => year + 1 >= e.firstYear - 1 && year + 1 <= e.firstYear);
  const expanding = expansions.map((e) => ({ team: e.team, ...expansionRule(store, league.teams[e.team].franchise, e.firstYear, year + 1 - (e.firstYear - 1)) }));
  // 1군 순위가 없는 창단 구단은 지난 시즌 순위표에 없어 맨 앞에 서지만, 실제로는 라운드 지명에서 1라운드 맨 끝이었다 (NC 2012·2013 입단, KT 2014·2015 입단)
  const firstTimers = new Set(expansions.map((e) => e.team));
  const roundOrder = [...order.filter((t) => !firstTimers.has(t)), ...order.filter((t) => firstTimers.has(t))];
  const built = expansionDraft(draftSlots(roundOrder, DRAFT_ROUNDS, penalized, snakeDraftYear(store, year + 1)), roundOrder.length, expanding);
  const owned = applyPickOwners(league, year + 1, built.slots, built.kinds);
  for (let i = 0; i < owned.slots.length; i++) {
    const [t, o] = [owned.slots[i], owned.orig[i]];
    if (t !== o && (t === off.userTeam || o === off.userTeam)) log(off, 'draft', `${built.kinds[i]}라운드 ${league.teams[o].name} 지명권은 ${league.teams[t].name}이 씁니다 (트레이드)`, true);
  }
  off.draft = { order, slots: owned.slots, orig: owned.orig, kinds: built.kinds, pick: 0, pool, picks: [] };
  runDraftUntilUser(league, off);
}

/** 그 지명권의 구분 (0 = 우선, -1 = 특별, n = n라운드). 구분이 없는 예전 저장은 순서로 셈 */
export function pickKindAt(off: OffseasonState, pick: number): number {
  const d = off.draft!;
  return d.kinds?.[pick] ?? Math.floor(pick / d.order.length) + 1;
}

/** 같은 구분 안에서 몇 번째 지명인가 (n라운드 m순위의 m) */
export function pickNoAt(off: OffseasonState, pick: number): number {
  const k = pickKindAt(off, pick);
  let n = 0;
  for (let i = 0; i <= pick; i++) if (pickKindAt(off, i) === k) n++;
  return n;
}

export function draftTeamAt(off: OffseasonState, pick: number): number {
  const d = off.draft!;
  return d.slots ? d.slots[pick] : d.order[pick % d.order.length];
}

export function draftTotal(off: OffseasonState): number {
  if (!off.draft) return 0;
  return off.draft.slots ? off.draft.slots.length : off.draft.order.length * DRAFT_ROUNDS;
}

/**
 * 남은 후보 중 가장 좋아 보이는 선수. AI 구단은 난이도 오차가 들어간 잠재력(aiPotential)으로,
 * 플레이어의 자동 지명은 스카우트 평가로 고른다.
 */
function bestProspect(league: LeagueState, off: OffseasonState, forUser = false): LeaguePlayer {
  const ps = off.draft!.pool.map((id) => league.players.find((x) => x.id === id)!);
  // AI 구단은 포수가 MIN_CATCHERS보다 적으면 포수 후보를 더 쳐준다 (임시값)
  const team = draftTeamAt(off, off.draft!.pick);
  const needC = !forUser && league.players.filter((p) => p.team === team && !p.isPitcher && p.pos === 'C' && !isServing(p)).length < MIN_CATCHERS;
  // AI 구단은 난이도 오차가 든 평가를 보고, 스카우트 투자가 그 오차를 줄인다 (finance.ts)
  const aiScale = AI_SCOUT_SCALE[activeLevel(league, team, 'scout')];
  const score = (p: LeaguePlayer) =>
    (forUser ? p.scoutPotential ?? p.potential : p.potential + (aiPotential(league, p) - p.potential) * aiScale)
    + (needC && !p.isPitcher && p.pos === 'C' ? CATCHER_NEED_BONUS : 0);
  return ps.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}

function makePick(league: LeagueState, off: OffseasonState, p: LeaguePlayer): void {
  const d = off.draft!;
  const team = draftTeamAt(off, d.pick);
  const round = pickKindAt(off, d.pick);
  const no = pickNoAt(off, d.pick);
  const orig = d.orig?.[d.pick] ?? team;
  p.team = team;
  p.entryYear = off.year + 1;
  // 넘겨받은 지명권으로 뽑은 선수는 입단 첫해 트레이드할 수 없다 (2019년 규약)
  if (orig !== team) p.noTradeYear = off.year + 1;
  d.pool = d.pool.filter((x) => x !== p.id);
  d.picks.push({ team, id: p.id, round });
  // 기획안 도전의 자체 육성 후보: 도전 구단이 직접 지명한 선수 (challenges.ts)
  const ch = league.challenge;
  if (ch?.homegrown && !ch.result && ch.team === team) ch.homegrown.push(p.id);
  d.pick++;
  if (team === off.userTeam || orig === off.userTeam || round <= 1) {
    const where = round >= 1 ? `${round}라운드 ${no}순위` : pickKindLabel(round);
    const via = orig !== team ? ` (${league.teams[orig].name} 지명권)` : '';
    log(off, 'draft', `${where} ${league.teams[team].name}${via}: ${p.name} (${p.isPitcher ? '투수' : p.pos}, ${p.school === 'UNIV' ? '대졸' : '고졸'})`, team === off.userTeam);
  }
}

function runDraftUntilUser(league: LeagueState, off: OffseasonState): void {
  const d = off.draft!;
  while (d.pick < draftTotal(off) && draftTeamAt(off, d.pick) !== off.userTeam && d.pool.length) {
    makePick(league, off, bestProspect(league, off));
  }
}

export function draftByUser(league: LeagueState, off: OffseasonState, id: string | null): OfferCheck {
  const d = off.draft;
  if (off.stage !== 'draft' || !d) return { ok: false, message: '지금은 드래프트 단계가 아닙니다.' };
  if (d.pick >= draftTotal(off) || draftTeamAt(off, d.pick) !== off.userTeam) return { ok: false, message: '우리 차례가 아닙니다.' };
  const p = id ? league.players.find((x) => x.id === id && d.pool.includes(x.id)) : bestProspect(league, off, true);
  if (!p) return { ok: false, message: '지명할 수 없는 선수입니다.' };
  makePick(league, off, p);
  runDraftUntilUser(league, off);
  return { ok: true, message: `${p.name} 지명` };
}

/** 남은 우리 지명을 모두 자동으로 한다 */
export function autoDraftRest(league: LeagueState, off: OffseasonState): void {
  while (off.stage === 'draft' && off.draft && off.draft.pick < draftTotal(off) && off.draft.pool.length) {
    if (draftTeamAt(off, off.draft.pick) === off.userTeam) makePick(league, off, bestProspect(league, off, true));
    runDraftUntilUser(league, off);
  }
}

// ---- 연봉 협상

function enterSalary(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  off.stage = 'salary';
  const view = leagueView(league, store, params);
  const demands: Record<string, number> = {};
  for (const p of league.players) {
    if (p.team < 0 || p.foreign || p.contract.until > off.year) continue;
    const runs = currentRuns(view.sim.get(p.id)!, view.ctx);
    const target = p.faCount > 0 ? Math.max(reserveTarget(runs, p.service), Math.round(marketSalary(runs) * 0.7)) : reserveTarget(runs, p.service);
    demands[p.id] = nextReserveSalary(p.contract.salary, target);
  }
  const offers: Record<string, number> = {};
  for (const [id, v] of Object.entries(demands)) if (league.players.find((x) => x.id === id)!.team === off.userTeam) offers[id] = v;
  off.salary = { demands, offers };
}

export function setSalaryOffer(off: OffseasonState, id: string, amount: number): OfferCheck {
  if (off.stage !== 'salary' || !off.salary || !(id in off.salary.offers)) return { ok: false, message: '제시할 수 없는 선수입니다.' };
  if (!Number.isFinite(amount) || amount < MIN_SALARY) return { ok: false, message: `최저 연봉 ${(MIN_SALARY / 10000).toFixed(1)}억 원(${MIN_SALARY.toLocaleString('ko-KR')}만 원) 이상이어야 합니다.` };
  off.salary.offers[id] = Math.round(amount);
  return { ok: true, message: '' };
}

/** 제시액이 요구액보다 적으면 둘의 가운데로 정한다 (단순화한 연봉 조정) */
export function settledSalary(offer: number, demand: number): number {
  return offer >= demand ? offer : Math.round((offer + demand) / 2);
}

function finishSalary(league: LeagueState, off: OffseasonState): void {
  const s = off.salary!;
  for (const [id, demand] of Object.entries(s.demands)) {
    const p = league.players.find((x) => x.id === id)!;
    const mine = p.team === off.userTeam;
    const salary = mine ? settledSalary(s.offers[id] ?? demand, demand) : demand;
    if (mine && (s.offers[id] ?? demand) < demand) log(off, 'salary', `${p.name}: 제시액이 요구액보다 적어 조정 끝에 ${wonText(salary)}`, true);
    p.contract = { kind: 'reserve', salary, until: off.year + 1 };
  }
}

// ---- 정원 정리

/** 소속 인원 (정원 68명 대상). 복무 중인 선수(군 보류)는 세지 않는다 */
function orgSize(league: LeagueState, team: number): number {
  return league.players.filter((p) => p.team === team && !isServing(p) && !p.dev).length;
}

// ---- 육성선수 (2026-10-11, docs/roadmap.md 7.3)

/** 구단당 육성선수 상한 (임시값) */
export const DEV_LIMIT = 12;
/** 육성선수로 돌리거나 데려올 수 있는 나이 (다음 시즌 나이, 임시값) */
export const DEV_MAX_AGE = 25;
/** 해마다 육성선수 후보로 나오는 드래프트 미지명 선수 수 (실제 육성 계약 자료 포함, 임시값) */
const DEV_TRYOUTS = 30;
/** AI 구단이 한 오프시즌에 육성선수로 돌리는 최대 인원 (임시값) */
const AI_DEV_PER_YEAR = 3;
/** AI 구단이 채우는 육성선수 수 (임시값) */
const AI_DEV_TARGET = 6;
/** 자기 선수를 육성선수로 돌릴 만한 잠재력 (런, AI가 보는 값, 임시값) */
const DEV_MIN_POTENTIAL = 3;
/** 미지명·방출 선수를 육성선수로 데려올 만한 잠재력 (임시값) */
const DEV_SIGN_MIN_POTENTIAL = -3;

export function devCount(league: LeagueState, team: number): number {
  return league.players.filter((p) => p.team === team && p.dev).length;
}

function devContract(off: OffseasonState): Contract {
  return { kind: 'reserve', salary: MIN_SALARY, until: off.year + 1 };
}

/** 육성선수로 데려올 수 있는 선수: 드래프트에서 아무도 안 뽑은 신인, 이번에 방출된 어린 선수 (아직 아무도 안 데려감) */
export function devPool(league: LeagueState, off: OffseasonState): LeaguePlayer[] {
  const lp = byId(league);
  const ids = new Set([...(off.draft?.pool ?? []), ...(off.devExtra ?? []), ...(off.released ?? []).map((r) => r.id)]);
  return [...ids].map((id) => lp.get(id)).filter((p): p is LeaguePlayer => !!p && p.team === -1 && !p.foreign && ageIn(p, off.year + 1) <= DEV_MAX_AGE);
}

/** 정원 정리 단계: 우리 선수를 육성선수로 돌린다 (방출하지 않고 정원에서 뺀다) */
export function toDevByUser(league: LeagueState, off: OffseasonState, id: string): OfferCheck {
  if (off.stage !== 'release') return { ok: false, message: '정원 정리 단계에서만 할 수 있습니다.' };
  const p = league.players.find((x) => x.id === id && x.team === off.userTeam);
  if (!p || p.dev) return { ok: false, message: '육성선수로 돌릴 수 없는 선수입니다.' };
  if (p.foreign || ageIn(p, off.year + 1) > DEV_MAX_AGE) return { ok: false, message: `${DEV_MAX_AGE}세 이하 국내 선수만 육성선수로 돌릴 수 있습니다.` };
  if (p.contract.until > off.year + 1 && p.contract.kind === 'fa') return { ok: false, message: 'FA 계약 선수는 육성선수로 돌릴 수 없습니다.' };
  if (devCount(league, off.userTeam) >= DEV_LIMIT) return { ok: false, message: `육성선수는 ${DEV_LIMIT}명까지입니다.` };
  p.dev = true;
  p.contract = devContract(off);
  log(off, 'release', `${p.name}, 육성선수로 전환`, true);
  return { ok: true, message: `${p.name}을(를) 육성선수로 돌렸습니다.` };
}

/** 정원 정리 단계: 육성선수로 데려온다 (드래프트 미지명·방출 선수) */
export function signDevByUser(league: LeagueState, off: OffseasonState, id: string): OfferCheck {
  if (off.stage !== 'release') return { ok: false, message: '정원 정리 단계에서만 할 수 있습니다.' };
  const p = devPool(league, off).find((x) => x.id === id);
  if (!p) return { ok: false, message: '데려올 수 없는 선수입니다.' };
  if (devCount(league, off.userTeam) >= DEV_LIMIT) return { ok: false, message: `육성선수는 ${DEV_LIMIT}명까지입니다.` };
  p.team = off.userTeam;
  p.dev = true;
  p.entryYear ??= off.year + 1;
  p.contract = devContract(off);
  log(off, 'release', `육성선수 ${p.name} 영입 (최저 연봉)`, true);
  return { ok: true, message: `${p.name}을(를) 육성선수로 데려왔습니다.` };
}

/** 오프시즌에 육성선수를 정식 선수로 (정원 안일 때) */
export function promoteDevByUser(league: LeagueState, off: OffseasonState, id: string): OfferCheck {
  if (off.stage !== 'release') return { ok: false, message: '정원 정리 단계에서만 할 수 있습니다.' };
  const p = league.players.find((x) => x.id === id && x.team === off.userTeam && x.dev);
  if (!p) return { ok: false, message: '정식 등록할 육성선수가 아닙니다.' };
  if (orgSize(league, off.userTeam) >= ORG_LIMIT) return { ok: false, message: `정원(${ORG_LIMIT}명)이 차 있습니다.` };
  p.dev = false;
  log(off, 'release', `${p.name}, 정식 선수로 등록`, true);
  return { ok: true, message: `${p.name}을(를) 정식 선수로 등록했습니다.` };
}

/** AI 구단: 현재 가치 하위 40% 안의 25세 이하 국내 선수 가운데 잠재력이 높은 순으로 n명까지 육성선수로. 돌린 수 */
function aiToDev(league: LeagueState, off: OffseasonState, view: LeagueView, team: number, n: number): number {
  if (n <= 0) return 0;
  const roster = league.players.filter((p) => p.team === team && !isServing(p) && !p.dev);
  const now = (p: LeaguePlayer) => { const sp = view.sim.get(p.id); return sp ? playerValue(sp, view.ctx, [1]) : 0; };
  const byNow = [...roster].sort((a, b) => now(a) - now(b) || a.id.localeCompare(b.id));
  const low = new Set(byNow.slice(0, Math.floor(byNow.length * 0.4)).map((p) => p.id));
  const cands = roster
    .filter((p) => low.has(p.id) && !p.foreign && p.contract.kind !== 'fa' && p.contract.kind !== 'nonFA' && ageIn(p, off.year + 1) <= DEV_MAX_AGE && aiPotential(league, p) >= DEV_MIN_POTENTIAL)
    .sort((a, b) => aiPotential(league, b) - aiPotential(league, a) || a.id.localeCompare(b.id))
    .slice(0, n);
  for (const p of cands) {
    p.dev = true;
    p.contract = devContract(off);
  }
  return cands.length;
}

/**
 * 정원 정리를 마칠 때 AI 구단의 육성선수: 남는 자리가 있으면 가장 나은 육성선수를 정식으로 올리고,
 * 남은 미지명·방출 선수 가운데 잠재력이 높은 선수를 AI_DEV_TARGET명까지 육성선수로 데려간다 (구단을 돌아가며 하나씩).
 */
function aiDevMarket(league: LeagueState, off: OffseasonState): void {
  const ai = league.teams.map((_, t) => t).filter((t) => t !== off.userTeam && !isFuturesTeam(league, t, off.year + 1));
  const pot = (p: LeaguePlayer) => aiPotential(league, p);
  for (const t of ai) {
    const devs = league.players.filter((p) => p.team === t && p.dev).sort((a, b) => pot(b) - pot(a) || a.id.localeCompare(b.id));
    for (const p of devs) {
      if (orgSize(league, t) >= ORG_LIMIT) break;
      p.dev = false;
    }
  }
  // 미지명·방출 선수는 최저 연봉이라 기대치가 낮아도 데려간다 (DEV_SIGN_MIN_POTENTIAL)
  const pool = devPool(league, off).filter((p) => pot(p) >= DEV_SIGN_MIN_POTENTIAL).sort((a, b) => pot(b) - pot(a) || a.id.localeCompare(b.id));
  let i = 0;
  for (let round = 0; round < AI_DEV_TARGET && i < pool.length; round++) {
    for (const t of ai) {
      if (i >= pool.length) break;
      if (devCount(league, t) >= AI_DEV_TARGET) continue;
      const p = pool[i++];
      p.team = t;
      p.dev = true;
      p.entryYear ??= off.year + 1;
      p.contract = devContract(off);
    }
  }
}

/** 정원 정리 때 지키는 최소 인원 (복무 중 제외, 임시값): 포수 3명, 투수·야수 각 18명. 모자라면 그 선수는 방출 순서에서 건너뛴다 */
export const MIN_CATCHERS = 3;
export const MIN_PITCHERS = 18;
export const MIN_HITTERS = 18;
/**
 * 방출 판단의 시즌별 가중치: 앞으로 8시즌 (임시값). 트레이드처럼 4시즌만 보면 전성기가 7~9년 뒤인 18~20세 유망주가
 * 서른 살 백업과 같은 값이 되어 먼저 잘렸다 (docs/longterm-plan.md 원인 1).
 */
const RELEASE_WEIGHTS = [0.5, 0.8, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
/** 입단 뒤 이 시즌 수 안의 지명 선수는 방출 순서에서 뒤로 보낸다 (임시값. 실제로도 입단 1~2년 차 방출은 드물다) */
export const ROOKIE_GRACE = 2;
/** 포수가 모자란 AI 구단이 드래프트에서 포수 후보에 더하는 잠재력 (런, 임시값) */
const CATCHER_NEED_BONUS = 8;

/**
 * 방출 순서 (먼저 내보낼 선수부터). 외국인·복무 중·FA·다년 계약 선수는 빼고, 입단 ROOKIE_GRACE시즌 안의 신인은 뒤로,
 * 나머지는 앞으로 8시즌 가치가 낮은 순. 포지션 최소 인원 아래로 내려가게 하는 선수는 건너뛰어 맨 뒤에 둔다.
 */
export function releaseOrder(league: LeagueState, off: OffseasonState, view: LeagueView, team: number,
                             valueOf: (p: LeaguePlayer) => number = (p) => releaseValue(view, p)): LeaguePlayer[] {
  const { order, kept } = releaseSplit(league, off, view, team, valueOf);
  return [...order, ...kept];
}

/** releaseOrder를 둘로: order = 최소 인원을 지키며 차례로 내보낼 수 있는 선수, kept = 최소 인원 때문에 뒤로 미룬 선수 */
export function releaseSplit(league: LeagueState, off: OffseasonState, view: LeagueView, team: number,
                             valueOf: (p: LeaguePlayer) => number = (p) => releaseValue(view, p)): { order: LeaguePlayer[]; kept: LeaguePlayer[] } {
  // 육성선수는 정원에 들지 않으므로 방출 순서에서 뺀다
  const roster = league.players.filter((p) => p.team === team && !isServing(p) && !p.dev);
  const left = {
    C: roster.filter((p) => !p.isPitcher && p.pos === 'C').length,
    P: roster.filter((p) => p.isPitcher).length,
    H: roster.filter((p) => !p.isPitcher).length,
  };
  const fresh = (p: LeaguePlayer) => p.entryYear >= off.year + 2 - ROOKIE_GRACE;
  const cands = roster
    .filter((p) => !p.foreign && p.contract.kind !== 'fa' && p.contract.kind !== 'nonFA')
    .map((p) => ({ p, v: valueOf(p) }))
    .sort((a, b) => Number(fresh(a.p)) - Number(fresh(b.p)) || a.v - b.v || a.p.id.localeCompare(b.p.id));
  const order: LeaguePlayer[] = [];
  const kept: LeaguePlayer[] = [];
  for (const { p } of cands) {
    const catcher = !p.isPitcher && p.pos === 'C';
    if ((p.isPitcher ? left.P <= MIN_PITCHERS : left.H <= MIN_HITTERS) || (catcher && left.C <= MIN_CATCHERS)) {
      kept.push(p);
      continue;
    }
    order.push(p);
    if (p.isPitcher) left.P--;
    else left.H--;
    if (catcher) left.C--;
  }
  return { order, kept };
}

/** 방출 판단의 가치: 앞으로 8시즌 (RELEASE_WEIGHTS). AI가 보는 잠재력(view.ctx.potential)으로 성장을 내다본다 */
export function releaseValue(view: LeagueView, p: LeaguePlayer): number {
  return playerValue(view.sim.get(p.id)!, view.ctx, RELEASE_WEIGHTS);
}

function enterRelease(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  off.stage = 'release';
  off.released = [];
  const view = leagueView(league, store, params);
  for (let t = 0; t < league.teams.length; t++) {
    if (t === off.userTeam) continue;
    const over = orgSize(league, t) - ORG_LIMIT;
    if (over <= 0) continue;
    // 먼저 지금 쓰임이 적은(구단 안 현재 가치 하위 40%) 어린 유망주를 육성선수로 돌려 자리를 만든다 (실제 구단들의 육성선수 전환)
    // 한 해에 넘친 인원의 절반·AI_DEV_PER_YEAR명까지만 (나머지는 방출: 방출 선수 시장이 돌아가게)
    const devs = aiToDev(league, off, view, t, Math.min(Math.floor(over / 2), AI_DEV_PER_YEAR, AI_DEV_TARGET - devCount(league, t)));
    const rest = over - devs;
    const cands = rest > 0 ? releaseOrder(league, off, view, t).slice(0, rest) : [];
    for (const p of cands) {
      p.team = -1;
      off.released.push({ id: p.id, from: t });
    }
    log(off, 'release', `${league.teams[t].name}, ${cands.length}명 방출${devs ? `, ${devs}명 육성선수 전환` : ''}`, false);
  }
}

export function releaseByUser(league: LeagueState, off: OffseasonState, id: string): OfferCheck {
  const p = league.players.find((x) => x.id === id);
  if (off.stage !== 'release' || !p || p.team !== off.userTeam) return { ok: false, message: '방출할 수 없는 선수입니다.' };
  p.team = -1;
  (off.released ??= []).push({ id: p.id, from: off.userTeam });
  log(off, 'release', `${p.name} 방출`, true);
  return { ok: true, message: `${p.name} 방출` };
}

// ---- 방출 선수 시장 (2026-10-11): 방출된 선수를 다른 구단이 데려간다. 쓸 만한 선수가 정원 압박만으로 리그를 떠나지 않게

/** 방출 선수 계약: 최저 연봉 1년 (임시값) */
export const CLAIM_SALARY = MIN_SALARY;
/** AI 구단이 한 오프시즌에 데려오는 방출 선수 수 상한 (임시값) */
export const CLAIM_PER_TEAM = 3;
/** 자기 방출 1순위보다 이만큼(런, 8시즌 가치) 나아야 데려온다 (임시값) */
const CLAIM_MIN_GAIN = 2;

/** 지금 데려올 수 있는 방출 선수 (다른 구단이 이번 정원 정리에서 방출했고 아직 아무도 데려가지 않았다) */
export function claimablePlayers(league: LeagueState, off: OffseasonState, team: number): LeaguePlayer[] {
  const lp = byId(league);
  return (off.released ?? []).filter((r) => r.from !== team).map((r) => lp.get(r.id)!).filter((p) => p && p.team === -1);
}

function signClaim(league: LeagueState, off: OffseasonState, p: LeaguePlayer, team: number): void {
  const from = off.released!.find((r) => r.id === p.id)!.from;
  p.team = team;
  p.contract = { kind: 'reserve', salary: CLAIM_SALARY, until: off.year + 1 };
  log(off, 'release', `${league.teams[team].name}: 방출 선수 ${p.name} 영입 (${league.teams[from].name}에서 방출, 최저 연봉 1년)`,
    team === off.userTeam || from === off.userTeam);
}

/** 플레이어 구단이 방출 선수를 데려온다 (정원 정리 단계. 정원을 넘으면 다음 단계로 가기 전에 다시 방출해야 한다) */
export function claimByUser(league: LeagueState, off: OffseasonState, id: string): OfferCheck {
  if (off.stage !== 'release') return { ok: false, message: '정원 정리 단계에서만 데려올 수 있습니다.' };
  const p = claimablePlayers(league, off, off.userTeam).find((x) => x.id === id);
  if (!p) return { ok: false, message: '데려올 수 없는 선수입니다.' };
  signClaim(league, off, p, off.userTeam);
  return { ok: true, message: `${p.name} 영입` };
}

/**
 * 정원 정리를 마칠 때 AI 구단이 방출 선수를 데려간다: 가치가 높은 방출 선수부터, 그 선수가 자기 방출 1순위보다 가장 많이 나은 구단이
 * 데려가고 대신 방출 1순위를 내보낸다 (정원은 그대로). 플레이어 구단은 끼지 않는다 (claimByUser로 직접).
 */
function releaseMarket(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  if (!off.released?.length) return;
  const released = off.released;
  const view = leagueView(league, store, params);
  const cache = new Map<string, number>();
  const val = (p: LeaguePlayer) => {
    let v = cache.get(p.id);
    if (v === undefined) cache.set(p.id, (v = releaseValue(view, p)));
    return v;
  };
  const lp = byId(league);
  const pool = released.map((r) => lp.get(r.id)!).filter((p) => p.team === -1).sort((a, b) => val(b) - val(a) || a.id.localeCompare(b.id));
  const claims = league.teams.map(() => 0);
  for (const p of pool) {
    const from = released.find((r) => r.id === p.id)!.from;
    let best: { team: number; out: LeaguePlayer; gain: number } | null = null;
    for (let t = 0; t < league.teams.length; t++) {
      if (t === off.userTeam || t === from || claims[t] >= CLAIM_PER_TEAM) continue;
      const out = releaseOrder(league, off, view, t, val)[0];
      if (!out) continue;
      const gain = val(p) - val(out);
      if (gain >= CLAIM_MIN_GAIN && (!best || gain > best.gain)) best = { team: t, out, gain };
    }
    if (!best) continue;
    signClaim(league, off, p, best.team);
    best.out.team = -1;
    released.push({ id: best.out.id, from: best.team });
    claims[best.team]++;
  }
}

/** 플레이어 구단을 정원에 맞추도록 방출 순서(releaseOrder)대로 내보낸다 (AI 구단과 같은 기준) */
export function autoReleaseUser(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams = DEFAULT_PARAMS): void {
  if (off.stage !== 'release') return;
  const over = orgSize(league, off.userTeam) - ORG_LIMIT;
  if (over <= 0) return;
  releaseOrder(league, off, leagueView(league, store, params), off.userTeam).slice(0, over).forEach((p) => releaseByUser(league, off, p.id));
}

export function userOrgSize(league: LeagueState, off: OffseasonState): number {
  return orgSize(league, off.userTeam);
}

// ---- 단계 넘기기

/** 지금 단계에서 다음으로 넘어갈 수 있는가. 안 되면 이유 */
export function blockedReason(league: LeagueState, off: OffseasonState): string | null {
  if (off.stage === 'comp' && off.comp?.some((c) => c.from === off.userTeam && c.pick === null)) {
    return '우리 구단의 FA 보상을 고르세요 (보상선수 지명 또는 보상금만).';
  }
  if (off.stage === 'draft' && off.draft && off.draft.pick < draftTotal(off) && off.draft.pool.length) return '우리 지명 차례입니다. 선수를 지명하거나 자동 지명을 하세요.';
  if (off.stage === 'release' && off.userTeam >= 0 && orgSize(league, off.userTeam) > ORG_LIMIT) {
    return `소속 선수가 ${orgSize(league, off.userTeam)}명입니다. 정원 ${ORG_LIMIT}명에 맞게 방출하세요.`;
  }
  return null;
}

/**
 * 다음 단계로 간다. FA 단계에서는 라운드 하나를 마감한다 (마지막 라운드면 외국인 단계로).
 * 'ready'에서 부르면 아무것도 하지 않는다 (개막은 openNextSeason).
 */
export function advanceStage(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams = DEFAULT_PARAMS): void {
  if (blockedReason(league, off)) return;
  switch (off.stage) {
    case 'fa':
      resolveFaRound(league, off, store, params);
      return;
    case 'comp':
      finishComp(league, off, store, params);
      enterForeign(league, off, store, params);
      return;
    case 'foreign':
      finishForeign(league, off, store, params);
      enterDraft(league, off, store, params);
      return;
    case 'draft':
      enterSalary(league, off, store, params);
      return;
    case 'salary':
      finishSalary(league, off);
      enterRelease(league, off, store, params);
      return;
    case 'release':
      releaseMarket(league, off, store, params);
      aiDevMarket(league, off);
      off.stage = 'ready';
      return;
    case 'ready':
      return;
  }
}

/** 오프시즌을 끝내고 다음 시즌 리그 상태로 넘긴다: 연도를 올리고 무소속 선수를 정리한다 */
export function closeOffseason(league: LeagueState, off: OffseasonState): void {
  if (off.stage !== 'ready') throw new Error('오프시즌이 끝나지 않았습니다');
  league.year = off.year + 1;
  // 떠나는 선수의 게임 안 통산을 남긴다 (history.ts)
  // 포스팅 요청에 답하지 않았으면 붙잡은 것으로 본다
  archiveDeparting(league, off.year);
  league.players = league.players.filter((p) => p.team >= 0 || isAbroad(p));
  // 코치 빈자리: AI 구단은 자금에 맞춰, 플레이어 구단은 가장 싼 후보로 임시로 채운다 (coaches.ts)
  const left = aiHireCoaches(league, off.coachMarket ?? [], off.year, off.userTeam, (t) => cashOf(league, t));
  if (off.userTeam >= 0) {
    for (const role of COACH_ROLES) {
      if (coachOf(league, off.userTeam, role)) continue;
      const pick = left.filter((c) => c.role === role).sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id))[0]
        ?? fallbackCoach(league, role, off.year, off.userTeam);
      hireCoach(league, off.userTeam, pick, off.year);
      log(off, 'settle', `${COACH_ROLE_LABEL[role]} 빈자리를 ${pick.level}등급 코치로 채웠습니다`, true);
    }
  }
  // 투자 확정 (AI 구단은 이때 계획을 정한다, finance.ts)
  lockInvestments(league, off.userTeam);
}

/** 우리 구단이 보는 잠재력 (스카우트 투자 단계에 따른 오차) */
function scoutView(league: LeagueState, potential: number, rng: Rng): number {
  const n = SCOUT_NOISE[activeLevel(league, league.owner?.team ?? -1, 'scout')];
  return Math.round(potential + rng.range(-n, n));
}

/** 육성 투자: 25세 이하 선수가 오를 때 오름폭을 늘린다 */
function developed(age: number, runs: number, next: number, level: number): number {
  if (age > DEVELOP_AGE || next <= runs || !level) return next;
  return runs + (next - runs) * (1 + DEVELOP_BONUS[level]);
}

// ---- 실제 지명 신인

/** 그 해 입단 실제 지명 중 드래프트 풀에 들어갈 선수 (육성선수·원년 멤버 제외) */
export function draftPool(store: Pick<DataStore, 'drafts'>, entryYear: number): DraftRow[] {
  return (store.drafts?.[String(entryYear)] ?? []).filter((d) => d.kind !== '육성선수' && d.kind !== '원년 멤버');
}

const PITCHER_POS = ['SP', 'RP', 'CL', 'P'];

/**
 * 지명 선수를 선수 마스터(실제 기록이 있는 선수)와 맞춘다: 이름, 입단 연도 ±1 (마스터의 입단 연도는 추정값). 애매하면 null.
 * 지명 자료의 포지션은 후보가 여럿일 때 가르는 데만 쓴다. 이대호(2001년 투수 지명, 야수로 성공)·나성범(2012년 투수 지명)처럼
 * 지명 포지션과 실제 커리어가 다른 선수가 있어, 포지션이 다르다고 연결을 끊지 않는다 (2026-10-08 수정).
 */
export function matchDraftee(store: Pick<DataStore, 'players'>, d: DraftRow, entryYear: number, league: LeagueState): PlayerMaster | null {
  const inLeague = new Set(league.players.map((p) => p.id));
  // 자료 단계에서 이은 선수 (해외 진출·대학 진학으로 늦게 입단한 선수도 정확히, 2026-10-12)
  if (d.pid) {
    const m = store.players.get(d.pid);
    return m && !m.foreign && !inLeague.has(m.id) ? m : null;
  }
  // 마스터에는 1군 기록이 있는 선수만 있다. 지명 자료에서 1군 0경기인 선수를 맞추면 같은 이름의 다른 선수가 걸린다
  if (d.games === 0) return null;
  const cands = [...store.players.values()].filter((m) =>
    m.name === d.name && !m.foreign && Math.abs(m.entryYear - entryYear) <= 1 && m.first >= entryYear - 1 && !inLeague.has(m.id));
  const pick = (list: PlayerMaster[]): PlayerMaster | null => (list.length === 1 ? list[0] : null);
  if (cands.length <= 1) return pick(cands);
  const wantPitcher = d.pos === 'P';
  const sameRole = cands.filter((m) => m.kind === 'BP' || (m.kind === 'P') === wantPitcher);
  return pick(sameRole) ?? pick(sameRole.filter((m) => m.entryYear === entryYear)) ?? pick(cands.filter((m) => m.entryYear === entryYear));
}

/**
 * 실존 선수의 실제 커리어로 본 투수 여부: 주포지션이 있으면 그것, 없으면 구분(투타 둘 다 기록이 있으면 통산 상대 타자 수와 타석 수 비교).
 * 지명 자료의 포지션은 보지 않는다 (지명은 투수였지만 야수로 성공한 선수가 있다).
 */
export function masterIsPitcher(m: PlayerMaster, career: () => CareerIndex): boolean {
  if (m.pos) return PITCHER_POS.includes(m.pos);
  if (m.kind !== 'BP') return m.kind === 'P';
  const idx = career();
  const pa = (idx.bat.get(m.id) ?? []).reduce((s, x) => s + x.row.pa, 0);
  const tbf = (idx.pit.get(m.id) ?? []).reduce((s, x) => s + x.row.tbf, 0);
  return tbf > pa;
}

/** 1군에 끝내 오르지 못한 지명자의 잠재력 (기획서 6.3: 낮은 범위, 임시값) */
const NEVER_POTENTIAL: [number, number] = [-15, -3];

/**
 * 실제 지명 신인 한 명을 리그(무소속)에 넣는다 (기획서 6.3).
 * - 실제 기록이 있는 선수(마스터와 맞춰짐): 실존 선수와 같은 id·생년·투타를 쓰고, 잠재력은 실제 커리어의 전성기 기여(realPeakRuns).
 *   그래서 과거 연도에서 시작하면 류현진 같은 선수는 실제 커리어대로 높은 잠재력을 가진다.
 * - 과거 지명자인데 1군 기록이 없는 선수: 낮은 범위에서.
 * - 아직 커리어를 알 수 없는 최근 지명자 (자료 마지막 해 기준 2년 안, 예: 2027 입단): 지명 순번(index, 0부터)을 가상 신인과 같은
 *   순위 식에 넣고 운을 크게 더한다. 지명 순번과 실제 커리어의 관계는 약하다 (임시값).
 * 시작 능력은 잠재력에서 나이 여유분(growthRoom × 0.7~1.3)을 뺀 값 (-15런 아래로는 내리지 않는다).
 */
export function makeDraftee(league: LeagueState, view: LeagueView, rng: Rng, taken: Set<string>, d: DraftRow, index: number,
                            entryYear: number, store: Pick<DataStore, 'players' | 'meta' | 'season'>, career: () => CareerIndex): LeaguePlayer {
  const m = matchDraftee(store, d, entryYear, league);
  const isPitcher = m ? masterIsPitcher(m, career) : d.pos === 'P';
  const masterPos = m?.pos && !PITCHER_POS.includes(m.pos) ? m.pos : null;
  const pos = isPitcher ? null : masterPos ?? (d.pos === 'P' ? 'IF' : d.pos);
  const lastData = Math.max(...store.meta.years);
  let potential: number;
  if (m) {
    const probe = { id: m.id, isPitcher, pos, bat: null, pit: null, birthYear: null } as unknown as SimPlayer;
    potential = realPeakRuns(probe, career(), store, view.ctx) ?? rng.range(...NEVER_POTENTIAL);
  } else if (d.games === 0 && entryYear <= lastData - 2) {
    potential = rng.range(...NEVER_POTENTIAL);
  } else {
    const f = (index + 0.5) / DRAFT_POOL;
    potential = -10 + DRAFT_POTENTIAL_SCALE * (-Math.log(Math.min(1, f))) ** 1.2 + (rng.next() + rng.next() - 1) * 12;
  }
  const age = m ? entryYear - (m.birthYear ?? estimatedBirthYear(m)) : d.univ ? 22 : 18;
  const start = Math.max(-15, potential - growthRoom(age) * rng.range(0.7, 1.3));
  const p = makeVirtual(league, view, rng, taken, {
    foreign: false, asia: false, age, runs: start, potential,
    real: true, name: m?.name ?? d.name, isPitcher, pos, id: m?.id ?? `d${entryYear}-${index + 1}`,
    birthYear: m ? m.birthYear ?? estimatedBirthYear(m) : undefined, bats: m?.bats, throws: m?.throws,
    starter: m?.pos === 'SP' ? true : m?.pos === 'RP' || m?.pos === 'CL' ? false : undefined,
  }, entryYear - 1);
  p.school = m?.school ?? (d.univ ? 'UNIV' : 'HS');
  if (m && !m.birthYear) p.birthYearEstimated = true;
  p.scoutPotential = scoutView(league, potential, rng);
  view.ctx.potential?.set(p.id, aiPotential(league, p));
  p.contract = { kind: 'rookie', salary: MIN_SALARY, until: entryYear };
  // 해외 프로에서 뛰다 들어온 선수 (해외파 특별지명, 해외 진출 뒤 늦게 입단): 신인상 자격이 없고 다시 포스팅을 요청하지 않는다
  if (d.kind === '해외' || (d.drafted !== undefined && entryYear - d.drafted >= 3 && !d.univ)) p.returnedFromAbroad = entryYear;
  return p;
}

// ---- 가상 선수

/** 실존 선수 전원과 지금 리그 선수의 이름 (가상 선수 이름이 겹치지 않게) */
export function takenNames(league: LeagueState, store: Pick<DataStore, 'players'>): Set<string> {
  const s = new Set<string>();
  for (const m of store.players.values()) s.add(m.name);
  for (const p of league.players) s.add(p.name);
  return s;
}

const HIT_POS: [string, number][] = [['C', 12], ['SS', 14], ['2B', 12], ['3B', 10], ['CF', 12], ['LF', 10], ['RF', 10], ['1B', 10]];

interface VirtualSpec {
  foreign: boolean;
  asia: boolean;
  age: number;
  /** 지금 기여 (런) */
  runs: number;
  /** 잠재력 (없으면 지금 + 나이 여유분) */
  potential?: number;
  /** 실존 선수 (실제 지명 명단의 신인). 이름·투타 구분·포지션·id를 그대로 쓴다 */
  real?: boolean;
  name?: string;
  isPitcher?: boolean;
  pos?: string | null;
  id?: string;
  /** 실존 선수의 생년·투타·선발 여부 (없으면 나이와 난수로) */
  birthYear?: number | null;
  bats?: 'R' | 'L' | 'S';
  throws?: 'R' | 'L';
  starter?: boolean;
}

/** 가상 선수 한 명을 만들어 리그(무소속)에 넣는다. 능력은 리그 평균(모든 비율 1.00) 선수에서 목표 런에 맞게 옮긴다 */
function makeVirtual(league: LeagueState, view: LeagueView, rng: Rng, taken: Set<string>, spec: VirtualSpec, year: number): LeaguePlayer {
  const nextYear = year + 1;
  // 일련번호는 id를 따로 받는 선수(실제 지명 신인)도 하나씩 쓴다 (가치 계산용 색인이 겹치지 않게)
  const serial = league.nextVirtualId++;
  const isPitcher = spec.isPitcher ?? rng.chance(spec.foreign ? 0.6 : 0.5);
  let pos: string | null = spec.pos ?? null;
  if (!isPitcher && spec.pos === undefined) {
    const total = HIT_POS.reduce((s, [, w]) => s + w, 0);
    let u = rng.next() * total;
    for (const [p, w] of HIT_POS) if ((u -= w) < 0) { pos = p; break; }
    pos ??= '1B';
  }
  const starter = isPitcher && (spec.starter ?? rng.chance(0.6));
  const p: LeaguePlayer = {
    id: spec.id ?? `v${nextYear}-${serial}`,
    name: spec.name ?? (spec.foreign ? foreignName(rng, taken, spec.asia) : koreanName(rng, taken)),
    real: spec.real ?? false, isPitcher, pos,
    bats: spec.bats ?? (isPitcher ? (rng.chance(0.25) ? 'L' : 'R') : (['R', 'R', 'L', 'L', 'S'] as const)[rng.int(5)]),
    throws: spec.throws ?? (rng.chance(isPitcher ? 0.3 : 0.15) ? 'L' : 'R'),
    foreign: spec.foreign, asia: spec.asia, birthYear: spec.birthYear ?? nextYear - spec.age, school: null, entryYear: nextYear,
    bat: isPitcher ? null : {
      so: 1, bb: 1, hbp: 1, hr: 1, s1: 1, d2: 1, t3: 1,
      sbAtt: 0.02 + rng.next() * 0.1, sbPct: 0.6 + rng.next() * 0.2, speed: 0.25 + rng.next() * 0.5, sample: 0,
    },
    pit: !isPitcher ? null : {
      so: 1, bb: 1, hbp: 1, hr: 1, hit: 1,
      stamina: starter ? 20 + rng.next() * 6 : 22, reliefStint: starter ? 5 : 4 + rng.next() * 2,
      startShare: starter ? 0.85 : 0.05, sample: 0,
    },
    potential: 0, estimated: false, team: -1,
    contract: { kind: 'rookie', salary: MIN_SALARY, until: nextYear },
    service: 0, faCount: 0, lastFaYear: null, lastSaves: 0, history: [],
    ...(spec.foreign ? {} : { military: { state: 'pending' as const } }),
  };
  if (p.bat) p.bat.def = makeDefense(p.id, pos, [], p.bat.speed, spec.age);
  Object.assign(p, skillForRuns(p, spec.runs, view.ctx, nextYear));
  p.potential = Math.max(spec.runs, spec.potential ?? spec.runs + 4 * rng.next());
  league.players.push(p);
  const sim = { ...asSim(p, view.ctx.world.league, nextYear), idx: 2_000_000 + league.nextVirtualId, name: p.name, foreign: p.foreign, teamIdx: -1 };
  view.sim.set(p.id, sim);
  view.ctx.potential?.set(p.id, aiPotential(league, p));
  return p;
}
