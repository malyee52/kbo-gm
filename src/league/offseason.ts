// 오프시즌 (기획서 3장): 결산 → FA → 외국인 선수 → 신인 드래프트 → 연봉 협상 → 정원 정리 → 개막 준비.
//
// 상태(OffseasonState)는 JSON으로 그대로 저장할 수 있고, 리그 상태(LeagueState)를 직접 고친다.
// 플레이어 구단의 결정은 단계마다 함수로 받고, AI 구단은 같은 가치 함수(ai/value.ts)로 결정한다.
// 난수는 시드에서 갈라 쓰므로 같은 시드·같은 결정이면 같은 결과가 나온다.

import { seasonAwards } from './awards';
import type { DataStore, DraftRow, PlayerMaster } from '../data/types';
import {
  ageDefense, agingScale, DEFAULT_PARAMS, emptyBatLine, emptyPitLine, makeDefense, Rng, traitsOf,
  type EngineParams, type Season, type SimPlayer, type World,
} from '../engine';
import { currentRuns, playerValue, teamStrength, valueContext, type ValueContext } from '../ai/value';
import { coreAge, horizonWeights, tendencyOf, type Tendency } from '../ai/trade';
import { asSim, careerIndex, growthRoom, growthRuns, realPeakRuns, skillForRuns, type CareerIndex } from './growth';
import {
  asianGames, ensureMilitary, injuryEffect, isAsianGamesYear, isServing, militaryStep, MILITARY_RUST, retirements, rollForm,
  type CareerNews,
} from './careers';
import { foreignName, koreanName } from './names';
import {
  ASIA_NEW_CAP, capPayroll, COMPENSATION, faEligible, faGrade, faYears, FOREIGN_ASIA, FOREIGN_NEW_CAP, FOREIGN_REGULAR,
  FOREIGN_TOTAL_CAP, foreignSalary, marketSalary, MIN_SALARY, nextReserveSalary, ORG_LIMIT, reserveTarget, runsForSalary, salaryCap,
  SERVICE_SHARE, WON_PER_RUN, FA_COMP, type FaGrade,
} from './salary';
import { aiPotential, draftSlots, spendLimit } from './owner';
import type { LeaguePlayer, LeagueState } from './types';
import { worldFromLeague } from './world';

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
/** 한 구단이 한 오프시즌에 데려올 수 있는 외부 FA 수 (임시값, 실제 규정 미확인) */
export const MAX_FA_SIGNINGS = 2;
/** 드래프트 라운드 수 (기획서 5장: 11라운드로 통일) */
export const DRAFT_ROUNDS = 11;
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
  } | null;
  draft: {
    order: number[];
    /** 전체 지명 순 구단 (샐러리캡 제재로 1라운드 순서가 바뀔 수 있다, M7). 없으면 order를 라운드마다 반복 */
    slots?: number[];
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
  const world = worldFromLeague(next, store, params, { form: false });
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
    teamIdx: team, rank: st.indexOf(team) + 1, nTeams: league.teams.length, cut: 5,
    coreAge: coreAge(view.orgs[team], view.ctx), remaining: 1,
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
 */
export function beginOffseason(league: LeagueState, world: World, season: Season, store: Store, userTeam: number,
                               params: EngineParams = DEFAULT_PARAMS): OffseasonState {
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
  // 시상 (history에 이 시즌이 들어가기 전에: 신인 자격 판정)
  league.awards = [...(league.awards ?? []).filter((a) => a.year !== year), seasonAwards(world, season, league, store)];
  for (const p of league.players) {
    delete p.slump;
    delete p.startAbsent;
    delete p.startAbsentReason;
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
    const share = sp.isPitcher
      ? pt.bf / ((sp.pit!.startShare >= 0.5 ? 650 : 280))
      : b.pa / 550;
    const age = ageIn(p, year + 1) + (p.decline ?? 0);
    const next = growthRuns(age, runs, p.potential, share, new Rng(`${league.seed}/growth/${year}/${p.id}`), p.isPitcher,
      agingScale(traitsOf(store.traits, p.id), params.traits)) - eff.runsDrop;
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
  // 복무 중인 선수: 퓨처스리그에서 뛰는 것으로 보고 출전 기회 40%로 성장 판정 (임시값)
  for (const p of league.players) {
    if (!isServing(p) || p.team < 0) continue;
    growth.set(p.id, { id: p.id, team: p.team, age: p.birthYear ? year + 1 - p.birthYear : null, before: runsAt(p, year), after: 0, tags: ['복무 중'] });
    const next = growthRuns(ageIn(p, year + 1) + (p.decline ?? 0), runsAt(p, year), p.potential, 0.4,
      new Rng(`${league.seed}/growth/${year}/${p.id}`), p.isPitcher, agingScale(traitsOf(store.traits, p.id), params.traits));
    Object.assign(p, skillForRuns({ ...p }, next, ctxNow, year));
  }
  league.lastSeason = { year, teams: season.teams.map((t) => ({ ...t })), standings: season.standings() };

  const off: OffseasonState = {
    format: 1, year, stage: 'fa', userTeam,
    fa: { round: 1, entries: [], userOffers: {}, signings: league.teams.map(() => 0) },
    foreign: null, draft: null, salary: null, log: [],
  };

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
  news.push(...militaryStep(c, (p) => Object.assign(p, skillForRuns({ ...p }, nextRuns(p) - MILITARY_RUST, ctxNow, year + 1))));
  if (isAsianGamesYear(year)) news.push(...asianGames(league, year, nextRuns, new Rng(`${league.seed}/asiad/${year}`)));
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

  openFaMarket(league, off, store, params);
  return off;
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
  off.fa.entries.sort((a, b) => b.ask - a.ask || a.id.localeCompare(b.id));
  for (const e of off.fa.entries) {
    const p = league.players.find((x) => x.id === e.id)!;
    log(off, 'fa', `${p.name} FA 신청 (${e.grade}등급, ${league.teams[e.from].name})`, e.from === off.userTeam);
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
  if (e.from !== t && off.fa.signings[t] >= MAX_FA_SIGNINGS) return { ok: false, message: `외부 FA는 한 오프시즌에 ${MAX_FA_SIGNINGS}명까지 데려올 수 있습니다.` };
  const limit = spendLimit(league, t, off.year + 1);
  if (limit !== null) {
    const p = league.players.find((x) => x.id === id)!;
    const others = Object.entries(off.fa.userOffers).filter(([k]) => k !== id).reduce((s, [, o]) => s + o.salary, 0);
    const base = capPayroll(league.players, t) - (p.team === t ? p.contract.salary : 0);
    if (base + others + salary > limit) {
      const cap = salaryCap(off.year + 1);
      const what = cap !== null && limit < cap ? '구단 예산' : '샐러리캡';
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
    if (user) offers.push(user);
    for (let t = 0; t < league.teams.length; t++) {
      if (t === off.userTeam) continue;
      const home = t === e.from;
      if (!home && off.fa.signings[t] >= MAX_FA_SIGNINGS) continue;
      const base = e.ask * FA_AI_OFFER[round - 1];
      if (limits[t] !== null && capPayroll(league.players, t) - (home ? p.contract.salary : 0) + base > limits[t]!) continue;
      const gain = signingGain(view, t, sp, e.years, tendency[t], home);
      const comp = home ? 0 : COMPENSATION[e.grade] * e.prevSalary;
      const cost = costRuns(base, e.years, comp) * FA_WILLINGNESS;
      if (gain < cost) continue;
      const eager = Math.min(2, Math.max(0, gain / cost - 1));
      offers.push({ team: t, salary: Math.round(Math.min(e.ask * 1.15, base * (1 + 0.05 * eager))), years: e.years });
    }
    const ok = offers.filter((o) => o.salary >= e.ask * FA_ACCEPT[round - 1]);
    if (!ok.length) continue;
    const score = (o: FaOffer) => o.salary * (1 + 0.04 * (o.years - 1)) * (o.team === e.from ? 1.05 : 1);
    ok.sort((a, b) => score(b) - score(a) || (a.team === off.userTeam ? -1 : 1));
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
      if (t === off.userTeam) continue;
      const home = t === e.from;
      if (!home && off.fa.signings[t] >= MAX_FA_SIGNINGS) continue;
      const gain = signingGain(view, t, sp, 1, tendency[t], home);
      if (gain <= 0) continue;
      const worth = marketSalary(gain / FA_WILLINGNESS) - (home ? 0 : COMPENSATION[e.grade] * e.prevSalary);
      if (!home && worth < MIN_SALARY) continue;
      const salary = Math.max(MIN_SALARY, Math.round(Math.min(e.ask * 0.8, worth)));
      if (limits[t] !== null && capPayroll(league.players, t) - (home ? p.contract.salary : 0) + salary > limits[t]!) continue;
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
    if (e.status !== 'signed' || e.team === undefined || e.team === e.from || FA_COMP[e.grade].withPlayer === null) continue;
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
  p.team = o.team;
  p.contract = { kind: 'fa', salary: o.salary, until: year + o.years };
  p.faCount++;
  p.lastFaYear = year + 1;
  p.service = 0;
  moveInView(view, view.sim.get(p.id)!, o.team);
  const mine = o.team === off.userTeam || e.from === off.userTeam;
  const money = `${o.years}년, 연 ${(o.salary / 10000).toFixed(1)}억 원`;
  if (o.team === e.from) {
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

// ---- 외국인 선수

const isForeignOf = (p: LeaguePlayer, t: number) => p.team === t && p.foreign;
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
  const view = leagueView(league, store, params);
  const order = [...(league.lastSeason?.standings ?? league.teams.map((_, i) => i))].reverse();
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
      if (p.asia ? asia >= FOREIGN_ASIA : regular >= FOREIGN_REGULAR) continue;
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
      log(off, 'foreign', `${league.teams[p.team].name}, ${p.name}와 재계약하지 않음`, false);
      p.team = -1;
      pool.push(p.id);
    }
  }

  // 새 외국인 후보 (가상 선수)
  const rng = new Rng(`${league.seed}/foreign/${year}`);
  const taken = takenNames(league, store);
  for (let i = 0; i < FOREIGN_POOL_REGULAR + FOREIGN_POOL_ASIA; i++) {
    const asia = i >= FOREIGN_POOL_REGULAR;
    const p = makeVirtual(league, view, rng, taken, {
      foreign: true, asia, age: asia ? 22 + rng.int(9) : 26 + rng.int(8),
      runs: asia ? 2 + rng.range(-4, 12) : 14 + rng.range(-8, 22),
    }, year);
    p.contract = { kind: 'foreign', salary: foreignSalary(p.potential, true, asia), until: year + 1 };
    pool.push(p.id);
  }
  off.foreign = { order, pointer: 0, pool, keep };
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

/** 이 외국인 후보와 계약할 수 있는가 (보유 한도와 금액 상한) */
export function canSignForeign(league: LeagueState, off: OffseasonState, team: number, p: LeaguePlayer): OfferCheck {
  if (!off.foreign?.pool.includes(p.id) || p.team !== -1) return { ok: false, message: '계약할 수 없는 선수입니다.' };
  const s = foreignSlots(league, team, off);
  if (p.asia) {
    if (s.asia >= FOREIGN_ASIA) return { ok: false, message: '아시아쿼터 자리가 찼습니다.' };
    if (p.contract.salary > ASIA_NEW_CAP) return { ok: false, message: '아시아쿼터 신규 계약 상한(20만 달러)을 넘습니다.' };
    return { ok: true, message: '' };
  }
  if (s.regular >= FOREIGN_REGULAR) return { ok: false, message: `외국인 선수는 아시아쿼터를 빼고 ${FOREIGN_REGULAR}명까지입니다.` };
  if (p.contract.salary > FOREIGN_NEW_CAP) return { ok: false, message: '신규 외국인 계약 상한(100만 달러)을 넘습니다.' };
  if (s.regularPay + p.contract.salary > FOREIGN_TOTAL_CAP) return { ok: false, message: '외국인 3명 총액 상한(400만 달러)을 넘습니다.' };
  return { ok: true, message: '' };
}

function signForeign(league: LeagueState, off: OffseasonState, team: number, p: LeaguePlayer): void {
  p.team = team;
  p.contract = { ...p.contract, until: off.year + 1 };
  off.foreign!.pool = off.foreign!.pool.filter((x) => x !== p.id);
  log(off, 'foreign', `${league.teams[team].name}, 외국인 ${p.name}와 계약 (${Math.round(p.contract.salary / 10000)}만 달러${p.asia ? ', 아시아쿼터' : ''})`, team === off.userTeam);
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
    if (p.asia ? s.asia >= FOREIGN_ASIA : s.regular >= FOREIGN_REGULAR) {
      return { ok: false, message: p.asia ? '아시아쿼터 자리가 찼습니다.' : `외국인 선수는 아시아쿼터를 빼고 ${FOREIGN_REGULAR}명까지입니다.` };
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
        p.team = -1;
        f.pool.push(id);
        log(off, 'foreign', `${p.name}: 외국인 총액 상한 때문에 재계약하지 못함`, true);
        continue;
      }
      p.contract = { kind: 'foreign', salary: resignForeignSalary(view0, p, room), until: off.year + 1 };
      log(off, 'foreign', `${p.name}와 재계약`, true);
    } else {
      p.team = -1;
      f.pool.push(id);
      log(off, 'foreign', `${p.name}와 재계약하지 않음`, true);
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
  for (let i = 0; i < (real?.length ? 0 : DRAFT_POOL); i++) {
    const univ = rng.chance(0.3);
    // 잠재력 분포: 실제 입단 동기(2012~2018년 입단)의 전성기 기여 순위에 맞춘 식 (M6).
    // 한 해 풀 150명 중 1위 약 45런, 10위 16런, 20위 6런, 40위 0런, 그 아래는 1군 주전감이 아니다.
    // M5의 2 + 58u^2.2는 10위가 52런이라, 장기 진행에서 가상 신인이 실존 선수를 몇 해 만에 모두 밀어냈다.
    const potential = -10 + 8 * (-Math.log(1 - rng.next())) ** 1.2;
    const age = univ ? 22 : 18;
    const runs = univ ? potential * 0.35 - 8 : potential * 0.1 - 14;
    const p = makeVirtual(league, view, rng, taken, { foreign: false, asia: false, age, runs: runs + rng.range(-3, 3), potential }, year);
    p.school = univ ? 'UNIV' : 'HS';
    // 스카우트 평가: 실제 잠재력에 오차 (모든 구단이 같은 평가를 본다. 난이도별 오차는 M7)
    p.scoutPotential = Math.round(potential + rng.range(-8, 8));
    view.ctx.potential?.set(p.id, aiPotential(league, p));
    p.contract = { kind: 'rookie', salary: MIN_SALARY, until: year + 1 };
    pool.push(p.id);
  }
  const order = [...(league.lastSeason?.standings ?? league.teams.map((_, i) => i))].reverse();
  // 샐러리캡 2회 이상 연속 초과 구단은 1라운드 지명권이 9단계 밀린다 (owner.ts, 제도연표)
  const penalized = new Set(league.teams.map((_, t) => t).filter((t) => league.draftPenalty?.[t] === year));
  for (const t of penalized) log(off, 'draft', `${league.teams[t].name}: 샐러리캡 연속 초과로 1라운드 지명권 9단계 하락`, t === off.userTeam, true);
  off.draft = { order, slots: draftSlots(order, DRAFT_ROUNDS, penalized), pick: 0, pool, picks: [] };
  runDraftUntilUser(league, off);
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
  const score = (p: LeaguePlayer) => (forUser ? p.scoutPotential ?? p.potential : aiPotential(league, p));
  return ps.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}

function makePick(league: LeagueState, off: OffseasonState, p: LeaguePlayer): void {
  const d = off.draft!;
  const team = draftTeamAt(off, d.pick);
  const round = Math.floor(d.pick / d.order.length) + 1;
  p.team = team;
  p.entryYear = off.year + 1;
  d.pool = d.pool.filter((x) => x !== p.id);
  d.picks.push({ team, id: p.id, round });
  d.pick++;
  if (team === off.userTeam || round === 1) {
    log(off, 'draft', `${round}라운드 ${d.picks.length - (round - 1) * d.order.length}순위 ${league.teams[team].name}: ${p.name} (${p.isPitcher ? '투수' : p.pos}, ${p.school === 'UNIV' ? '대졸' : '고졸'})`, team === off.userTeam);
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
    if (mine && (s.offers[id] ?? demand) < demand) log(off, 'salary', `${p.name}: 제시액이 요구액보다 적어 조정 끝에 ${salary.toLocaleString('ko-KR')}만 원`, true);
    p.contract = { kind: 'reserve', salary, until: off.year + 1 };
  }
}

// ---- 정원 정리

/** 소속 인원 (정원 68명 대상). 복무 중인 선수(군 보류)는 세지 않는다 */
function orgSize(league: LeagueState, team: number): number {
  return league.players.filter((p) => p.team === team && !isServing(p)).length;
}

function enterRelease(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams): void {
  off.stage = 'release';
  const view = leagueView(league, store, params);
  for (let t = 0; t < league.teams.length; t++) {
    if (t === off.userTeam) continue;
    const over = orgSize(league, t) - ORG_LIMIT;
    if (over <= 0) continue;
    const w = horizonWeights('rebuild', 1);
    const cands = league.players
      .filter((p) => p.team === t && !p.foreign && !isServing(p) && p.contract.kind !== 'fa' && p.contract.kind !== 'nonFA')
      .map((p) => ({ p, v: playerValue(view.sim.get(p.id)!, view.ctx, w) }))
      .sort((a, b) => a.v - b.v || a.p.id.localeCompare(b.p.id))
      .slice(0, over);
    for (const { p } of cands) p.team = -1;
    log(off, 'release', `${league.teams[t].name}, ${cands.length}명 방출`, false);
  }
}

export function releaseByUser(league: LeagueState, off: OffseasonState, id: string): OfferCheck {
  const p = league.players.find((x) => x.id === id);
  if (off.stage !== 'release' || !p || p.team !== off.userTeam) return { ok: false, message: '방출할 수 없는 선수입니다.' };
  p.team = -1;
  log(off, 'release', `${p.name} 방출`, true);
  return { ok: true, message: `${p.name} 방출` };
}

/** 플레이어 구단을 정원에 맞추도록 가치가 낮은 선수부터 방출한다 */
export function autoReleaseUser(league: LeagueState, off: OffseasonState, store: Store, params: EngineParams = DEFAULT_PARAMS): void {
  if (off.stage !== 'release') return;
  const view = leagueView(league, store, params);
  const w = horizonWeights('rebuild', 1);
  const over = orgSize(league, off.userTeam) - ORG_LIMIT;
  if (over <= 0) return;
  league.players
    .filter((p) => p.team === off.userTeam && !p.foreign && !isServing(p) && p.contract.kind !== 'fa' && p.contract.kind !== 'nonFA')
    .map((p) => ({ p, v: playerValue(view.sim.get(p.id)!, view.ctx, w) }))
    .sort((a, b) => a.v - b.v || a.p.id.localeCompare(b.p.id))
    .slice(0, over)
    .forEach(({ p }) => releaseByUser(league, off, p.id));
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
  league.players = league.players.filter((p) => p.team >= 0);
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
  // 마스터에는 1군 기록이 있는 선수만 있다. 지명 자료에서 1군 0경기인 선수를 맞추면 같은 이름의 다른 선수가 걸린다
  if (d.games === 0) return null;
  const inLeague = new Set(league.players.map((p) => p.id));
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
    potential = -10 + 8 * (-Math.log(Math.min(1, f))) ** 1.2 + (rng.next() + rng.next() - 1) * 12;
  }
  const age = m?.birthYear ? entryYear - m.birthYear : d.univ ? 22 : 18;
  const start = Math.max(-15, potential - growthRoom(age) * rng.range(0.7, 1.3));
  const p = makeVirtual(league, view, rng, taken, {
    foreign: false, asia: false, age, runs: start, potential,
    real: true, name: m?.name ?? d.name, isPitcher, pos, id: m?.id ?? `d${entryYear}-${index + 1}`,
    birthYear: m?.birthYear, bats: m?.bats, throws: m?.throws,
    starter: m?.pos === 'SP' ? true : m?.pos === 'RP' || m?.pos === 'CL' ? false : undefined,
  }, entryYear - 1);
  p.school = m?.school ?? (d.univ ? 'UNIV' : 'HS');
  p.scoutPotential = Math.round(potential + rng.range(-8, 8));
  view.ctx.potential?.set(p.id, aiPotential(league, p));
  p.contract = { kind: 'rookie', salary: MIN_SALARY, until: entryYear };
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
