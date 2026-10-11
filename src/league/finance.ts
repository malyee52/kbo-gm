// 재정 (재정 상세형, docs/finance.md, 2026-10-11 사용자 결정).
//
// 구단 자금 = 장부(league.ledger)의 합. 보상금·제재금처럼 이미 장부에 남던 돈이 그대로 실제 돈이 된다.
// 시즌 중 수입·지출(관중 수입, 월말 연봉·운영비·투자비)은 경기 기록과 날짜에서 그때그때 계산하고(seasonFlows),
// 결산(settleSeason) 때 항목별로 장부에 적는다. 그래서 하루씩 진행하든 한 번에 진행하든 금액이 같다.
// 금액은 모두 2026년 돈(만 원). 화면에서만 그 해 물가(priceIndex)로 바꿔 보여 준다. 수치는 임시값.

import { currentRuns, valueContext } from '../ai/value';
import { Rng, type Season, type World } from '../engine';
import { dateOf } from '../game/calendar';
import type { SeriesGame } from './postseason';
import { parentGrade, type ParentGrade } from './owner';
import type { LedgerEntry, LeaguePlayer, LeagueState } from './types';
import { isFuturesTeam } from './world';

// ---- 수치 (임시값, docs/finance.md 2~4장)

/** 달러 → 만 원 (1달러 = 1,400원) */
export const WON_PER_USD = 0.14;
/** 관중 1명당 객단가 (만 원) */
export const TICKET = 1.6;
/** 가을야구 객단가 (만 원) */
export const POSTSEASON_TICKET = 3.0;
/** 중계권·리그 공동 수익 (구단마다 같은 몫, 만 원) */
export const BROADCAST = 1_000_000;
/** 스폰서·상품 기본액 (인기도 1일 때, 만 원) */
export const SPONSOR_BASE = 900_000;
/** 운영비 (인건비·원정·구장·2군 운영, 한 해, 만 원) */
export const OPS_COST = 2_000_000;
/** 모기업 지원금 기본액 (등급별, 한 해, 만 원) */
export const PARENT_BASE: Record<ParentGrade, number> = { A: 600_000, B: 450_000, C: 0 };
/** 구단 이름 스폰서 (모기업 없는 히어로즈, 한 해, 만 원) */
export const NAMING_SPONSOR: Record<string, number> = { 히어로즈: 500_000 };
/** 자금이 이만큼을 넘으면 모기업 지원금을 넘는 금액의 PARENT_CLAWBACK만큼 줄인다 (자금이 끝없이 쌓이지 않게) */
export const PARENT_RESERVE = 1_500_000;
export const PARENT_CLAWBACK = 0.2;
/** 우승 보너스 (리그 배분, 만 원) */
export const CHAMPION_BONUS = 200_000;
/** 새 게임 시작 자금 (만 원) */
export const START_CASH = 500_000;
/** 창단 구단의 창단 자본금 (시작 자금에 더한다, 만 원, 임시값) */
export const EXPANSION_CAPITAL = 2_000_000;
/** 퓨처스 구단(1군 진입 전)의 운영비 비율 */
export const FUTURES_OPS_SHARE = 0.3;

/** 창단 구단 자본금을 장부에 넣는다 */
export function addExpansionCapital(league: LeagueState, team: number, year: number): void {
  league.ledger.push({ year, from: -1, to: team, amount: EXPANSION_CAPITAL, note: `${league.teams[team].name} 창단 자본금`, kind: 'start' });
}

/** 구장 수용 인원과 연고 시장 보정 (구단 계보별, 대략의 공개 수치·임시값. 시대별 구장 변화는 다루지 않는다) */
export const BALLPARK: Record<string, { capacity: number; market: number }> = {
  LG: { capacity: 23_750, market: 0.08 },
  두산: { capacity: 23_750, market: 0.07 },
  롯데: { capacity: 22_758, market: 0.08 },
  SSG: { capacity: 23_000, market: 0.03 },
  삼성: { capacity: 24_000, market: 0.03 },
  KIA: { capacity: 20_500, market: 0.06 },
  한화: { capacity: 17_000, market: 0.04 },
  NC: { capacity: 17_983, market: -0.04 },
  KT: { capacity: 18_700, market: -0.06 },
  히어로즈: { capacity: 16_000, market: -0.03 },
  쌍방울: { capacity: 12_000, market: -0.06 },
  현대계: { capacity: 15_000, market: -0.04 },
};
const DEFAULT_PARK = { capacity: 18_000, market: 0 };

export type InvestKind = 'scout' | 'develop' | 'medical' | 'marketing';
export const INVEST_KINDS: InvestKind[] = ['scout', 'develop', 'medical', 'marketing'];
export const INVEST_LABEL: Record<InvestKind, string> = { scout: '스카우트', develop: '육성 (2군·코치)', medical: '의료·트레이닝', marketing: '마케팅·구장' };
/** 투자 단계별 연간 비용 (0~3단계, 만 원) */
export const INVEST_COST: Record<InvestKind, number[]> = {
  scout: [0, 100_000, 200_000, 350_000],
  develop: [0, 150_000, 300_000, 500_000],
  medical: [0, 100_000, 200_000, 350_000],
  marketing: [0, 100_000, 250_000, 450_000],
};
/** 마케팅 단계별 관중률 보정과 스폰서 배율 */
export const MARKETING_FILL = [0, 0.03, 0.06, 0.09];
export const MARKETING_SPONSOR = [1, 1.05, 1.1, 1.15];
/** 스카우트: 우리 구단이 보는 후보 잠재력 평가 오차 (±런) */
export const SCOUT_NOISE = [8, 6, 4, 2];
/** 스카우트: AI 구단의 드래프트 판단 오차 배율 (난이도 오차에 곱한다) */
export const AI_SCOUT_SCALE = [1.2, 1, 0.75, 0.5];
/** 육성: 25세 이하 성장 폭 배율 가산, 2군 유망주 출전 몫 가산 */
export const DEVELOP_BONUS = [0, 0.06, 0.12, 0.2];
export const DEVELOP_SHARE = [0, 0.05, 0.1, 0.15];
export const DEVELOP_AGE = 25;
/** 의료·트레이닝: 부상 확률 배율, 결장 기간 배율 */
export const MEDICAL_RATE = [1, 0.92, 0.85, 0.78];
export const MEDICAL_DAYS = [1, 0.93, 0.87, 0.8];
/** 투자 효과 설명 (화면용) */
export const INVEST_EFFECT: Record<InvestKind, string[]> = {
  scout: SCOUT_NOISE.map((n, i) => `후보 잠재력 평가 오차 ±${n}${i ? '' : ' (기본)'}`),
  develop: DEVELOP_BONUS.map((b, i) => (i ? `25세 이하 성장 폭 +${Math.round(b * 100)}%, 2군 출전 몫 +${DEVELOP_SHARE[i]}` : '효과 없음')),
  medical: MEDICAL_RATE.map((r, i) => (i ? `부상 확률 −${Math.round((1 - r) * 100)}%, 결장 기간 −${Math.round((1 - MEDICAL_DAYS[i]) * 100)}%` : '효과 없음')),
  marketing: MARKETING_FILL.map((f, i) => (i ? `관중률 +${Math.round(f * 100)}%p, 스폰서·상품 +${Math.round((MARKETING_SPONSOR[i] - 1) * 100)}%` : '효과 없음')),
};

// ---- 구단 재정 상태

export interface TeamFinance {
  /** 다음 시즌 투자 계획 (단계 0~3). 오프시즌에 정하고 개막 때 active로 확정한다 */
  invest: Record<InvestKind, number>;
  /** 이번 시즌에 적용 중인 투자 단계. 비용(월말)과 효과는 이것으로 (오프시즌에 올렸다 내리는 꼼수를 막는다) */
  active?: Record<InvestKind, number>;
  /** 지난 결산들 */
  history: FinanceYear[];
}

/** 한 해 결산 (만 원). 수입은 양수, 지출은 음수로 적는다 */
export interface FinanceYear {
  year: number;
  items: Partial<Record<FinanceKind, number>>;
  /** 이 해 수지 (모기업 긴급 지원 전) */
  net: number;
  /** 결산 뒤 자금 */
  cash: number;
  /** 모기업 긴급 지원 (적자 보전) */
  rescue: number;
}

export type FinanceKind =
  | 'start' | 'gate' | 'postseason' | 'broadcast' | 'sponsor' | 'parent' | 'rescue' | 'champion'
  | 'payroll' | 'foreign' | 'ops' | 'invest'
  | 'compensation' | 'fine' | 'signing' | 'transfer' | 'trade' | 'other';

export const FINANCE_LABEL: Record<FinanceKind, string> = {
  start: '시작 자금', gate: '관중 수입', postseason: '가을야구 수입', broadcast: '중계권·리그 배분', sponsor: '스폰서·상품',
  parent: '모기업 지원금', rescue: '모기업 긴급 지원', champion: '우승 배당',
  payroll: '국내 선수 연봉', foreign: '외국인 연봉', ops: '운영비', invest: '투자',
  compensation: 'FA 보상금', fine: '제재금', signing: 'FA 계약금', transfer: '외국인 이적료', trade: '현금 트레이드', other: '기타',
};

/** 새 게임의 투자 단계: 모든 구단 1단계 (임시값) */
const startInvest = (): Record<InvestKind, number> => ({ scout: 1, develop: 1, medical: 1, marketing: 1 });

/** 이번 시즌에 적용 중인 투자 단계 */
export function activeLevel(league: Pick<LeagueState, 'finance'>, team: number, kind: InvestKind): number {
  const f = league.finance?.[team];
  return (f?.active ?? f?.invest)?.[kind] ?? 0;
}

/** 재정 상태가 없는 리그(새 게임, 예전 저장)에 시작 자금과 기본 투자를 채운다 */
export function ensureFinance(league: LeagueState): TeamFinance[] {
  league.finance ??= [];
  for (let t = 0; t < league.teams.length; t++) {
    if (league.finance[t]) continue;
    league.finance[t] = { invest: startInvest(), active: startInvest(), history: [] };
    league.ledger.push({ year: league.year, from: -1, to: t, amount: START_CASH, note: '시작 자금', kind: 'start' });
  }
  return league.finance;
}

/** 장부에서 그 구단의 돈 이동. 받으면 +, 내면 − */
export function ledgerFlow(e: LedgerEntry, team: number): number {
  return (e.to === team ? e.amount : 0) - (e.from === team ? e.amount : 0);
}

/** 장부 항목의 구분. 예전 장부(구분 없음)는 메모로 짐작 */
export function ledgerKind(e: LedgerEntry): FinanceKind {
  if (e.kind) return e.kind as FinanceKind;
  if (e.note.includes('보상금')) return 'compensation';
  if (e.note.includes('제재금')) return 'fine';
  return 'other';
}

/** 지금 자금 (장부 합, 만 원). 진행 중인 시즌의 수입·지출은 seasonFlows로 더한다 */
export function cashOf(league: LeagueState, team: number): number {
  let s = 0;
  for (const e of league.ledger) s += ledgerFlow(e, team);
  return s;
}

/** 장부에서 그 해 항목별 합 (오프시즌에 생긴 보상금·계약금 등) */
export function ledgerItems(league: LeagueState, team: number, year: number): Partial<Record<FinanceKind, number>> {
  const out: Partial<Record<FinanceKind, number>> = {};
  for (const e of league.ledger) {
    if (e.year !== year) continue;
    const v = ledgerFlow(e, team);
    if (!v) continue;
    const k = ledgerKind(e);
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

// ---- 시즌 중 수입·지출

/** 시즌 중 우리 구단 트레이드 (선수 id). 리그 상태는 개막 때로 고정이라, 그 뒤 소속은 이 기록으로 따라간다 */
export interface TradeMove {
  day: number;
  /** 우리 구단 */
  from: number;
  /** 상대 구단 */
  to: number;
  give: string[];
  get: string[];
}

export interface SeasonInput {
  league: LeagueState;
  world: World;
  season: Season;
  trades?: TradeMove[];
  /** 가을야구 경기 (진행한 것까지) */
  postseason?: SeriesGame[];
}

export interface MonthPoint {
  /** 월말 일정 색인 */
  day: number;
  month: number;
  /** 그달 수입·지출 합 */
  net: number;
}

export interface SeasonFlows {
  items: Partial<Record<FinanceKind, number>>;
  /** 홈 경기 관중 합 */
  attendance: number;
  homeGames: number;
  months: MonthPoint[];
}

const parkOf = (league: LeagueState, team: number) => BALLPARK[league.teams[team].franchise] ?? DEFAULT_PARK;

/** 월말에 나가는 연봉 (만 원, 한 해). 외국인은 달러를 환산하고, FA 계약금으로 미리 낸 몫은 뺀다 */
export function payOf(p: LeaguePlayer): number {
  if (p.foreign) return Math.round(p.contract.salary * WON_PER_USD);
  return Math.max(0, p.contract.salary - (p.contract.prepaid ?? 0));
}

// ---- 새 지출 (docs/finance.md 5장)

/** FA 계약금: 계약 총액(연봉 × 기간)의 30%를 계약 때 낸다 (임시값) */
export const SIGNING_SHARE = 0.3;
export function signingBonus(salary: number, years: number): number {
  return Math.round(salary * years * SIGNING_SHARE);
}
/** 새 외국인 이적료: 연봉의 40% (달러, 1만 달러 단위, 임시값) */
export const TRANSFER_SHARE = 0.4;
export function transferFeeUsd(salaryUsd: number): number {
  return Math.round((salaryUsd * TRANSFER_SHARE) / 10_000) * 10_000;
}
/** AI가 현금 1런을 몇 만 원으로 치는가: 시장 단가(연봉 기준 9,000만 원)보다 조금 높게 (현금보다 선수를 아낀다, 임시값) */
export const CASH_WON_PER_RUN = 12_000;

/** 월말 지급일: 정규시즌 일정 안의 각 달 마지막 날 (그달에 경기가 있는 달만) */
export function paydays(year: number, seasonDays: number): { day: number; month: number }[] {
  const out: { day: number; month: number }[] = [];
  for (let d = 0; d < seasonDays; d++) {
    const m = dateOf(year, d).month;
    const next = d + 1 < seasonDays ? dateOf(year, d + 1).month : -1;
    if (next !== m) out.push({ day: d, month: m });
  }
  return out;
}

/** 그날(day) 그 구단 소속 선수 (복무 중 제외). 개막 소속에 그날까지의 트레이드를 반영한다 */
function rosterAt(league: LeagueState, team: number, day: number, trades: TradeMove[]): LeaguePlayer[] {
  const byId = new Map(league.players.map((p) => [p.id, p]));
  const team0 = new Map(league.players.map((p) => [p.id, p.team]));
  for (const t of trades) {
    if (t.day > day) continue;
    for (const id of t.give) team0.set(id, t.to);
    for (const id of t.get) team0.set(id, t.from);
  }
  const out: LeaguePlayer[] = [];
  for (const [id, t] of team0) {
    if (t !== team) continue;
    const p = byId.get(id)!;
    if (p.military?.state !== 'serving') out.push(p);
  }
  return out;
}

/** 투자 연간 비용 합 */
export function investCost(f: TeamFinance | undefined, planned = false): number {
  if (!f) return 0;
  const lv = planned ? f.invest : f.active ?? f.invest;
  return INVEST_KINDS.reduce((s, k) => s + INVEST_COST[k][lv[k] ?? 0], 0);
}

/** 개막 때 스타 보정 (리그 상위 30명 안의 선수 수 × 0.015, 최대 0.06). 시즌마다 한 번 계산해 둔다 */
const starCache = new WeakMap<World, number[]>();
function starBonus(world: World): number[] {
  const hit = starCache.get(world);
  if (hit) return hit;
  const ctx = valueContext(world);
  const top = [...world.players].map((p) => ({ t: p.teamIdx, r: currentRuns(p, ctx) })).sort((a, b) => b.r - a.r).slice(0, 30);
  const out = world.teams.map((_, t) => Math.min(0.06, 0.015 * top.filter((x) => x.t === t).length));
  starCache.set(world, out);
  return out;
}

/** 한 경기 관중률 (0.15~1.0) */
export function fillRate(league: LeagueState, team: number, winPct: number, star: number, day: number, year: number): number {
  const wd = dateOf(year, day).weekday;
  const weekend = wd === 0 || wd === 6 ? 0.15 : wd === 5 ? 0.05 : 0;
  const mk = MARKETING_FILL[activeLevel(league, team, 'marketing')];
  const noise = (new Rng(`${league.seed}/gate/${year}/${day}/${team}`).next() - 0.5) * 0.1;
  const v = 0.5 + 0.8 * (winPct - 0.5) + parkOf(league, team).market + star + weekend + mk + noise;
  return Math.max(0.15, Math.min(1, v));
}

/**
 * 시즌 중 그 구단의 수입·지출 (upToDay 전날까지 치른 경기, 지난 월말 지급).
 * 관중 수입은 홈 경기마다, 연봉·운영비·투자비는 월말마다 (연간액 ÷ 지급 횟수).
 */
export function seasonFlows(input: SeasonInput, team: number, upToDay: number): SeasonFlows {
  const { league, world, season } = input;
  const year = world.year;
  const items: Partial<Record<FinanceKind, number>> = {};
  const add = (k: FinanceKind, v: number) => { if (v) items[k] = (items[k] ?? 0) + v; };
  const byMonth = new Map<number, number>();
  const addM = (day: number, v: number) => { const m = dateOf(year, day).month; byMonth.set(m, (byMonth.get(m) ?? 0) + v); };
  let attendance = 0;
  let homeGames = 0;

  // 관중 수입: 경기 기록을 날짜 순으로 보며 그때까지의 승률로
  if (team < world.teams.length) {
    const star = starBonus(world)[team] ?? 0;
    const cap = parkOf(league, team).capacity;
    const w = new Array(world.teams.length).fill(0);
    const l = new Array(world.teams.length).fill(0);
    for (const g of season.log) {
      if (g.day >= upToDay) break;
      if (g.home === team) {
        const pct = w[team] + l[team] > 0 ? w[team] / (w[team] + l[team]) : 0.5;
        const fans = Math.round(cap * fillRate(league, team, pct, star, g.day, year));
        attendance += fans;
        homeGames++;
        const v = Math.round(fans * TICKET);
        add('gate', v);
        addM(g.day, v);
      }
      if (g.homeRuns > g.awayRuns) { w[g.home]++; l[g.away]++; } else if (g.awayRuns > g.homeRuns) { w[g.away]++; l[g.home]++; }
    }
    // 가을야구 홈 경기: 만원에 가깝고 객단가가 높다
    for (const g of input.postseason ?? []) {
      if (g.day >= upToDay || g.home !== team) continue;
      const fans = Math.round(cap * 0.97);
      attendance += fans;
      const v = Math.round(fans * POSTSEASON_TICKET);
      add('postseason', v);
      addM(g.day, v);
    }
  }

  // 월말: 연봉(그날 소속)·운영비·투자비가 나가고, 개막 때 정한 중계권·모기업 지원금·스폰서 기본액이 들어온다
  // (예전에는 이 수입이 결산 때 한꺼번에 들어와 시즌 중 자금이 크게 마이너스였다, 2026-10-11)
  const pays = paydays(year, season.schedule.length);
  const fin = league.finance?.[team];
  const yearly = seasonIncome(league, world, team);
  for (const pd of pays) {
    if (pd.day >= upToDay) break;
    const roster = rosterAt(league, team, pd.day, input.trades ?? []);
    const dom = roster.filter((p) => !p.foreign).reduce((s, p) => s + payOf(p), 0);
    const fgn = roster.filter((p) => p.foreign).reduce((s, p) => s + payOf(p), 0);
    const n = pays.length;
    const parts: [FinanceKind, number][] = [
      ['payroll', -Math.round(dom / n)], ['foreign', -Math.round(fgn / n)],
      ['ops', -Math.round((isFuturesTeam(league, team, year) ? OPS_COST * FUTURES_OPS_SHARE : OPS_COST) / n)], ['invest', -Math.round(investCost(fin) / n)],
      ['broadcast', Math.round(yearly.broadcast / n)], ['parent', Math.round(yearly.parent / n)], ['sponsor', Math.round(yearly.sponsor / n)],
    ];
    for (const [k, v] of parts) { add(k, v); byMonth.set(pd.month, (byMonth.get(pd.month) ?? 0) + v); }
  }
  const months = pays.map((pd) => ({ day: pd.day, month: pd.month, net: byMonth.get(pd.month) ?? 0 }));
  return { items, attendance, homeGames, months };
}

/**
 * 개막 때 정하는 한 해 고정 수입: 중계권, 모기업 지원금(직전 결산 자금과 지금 신뢰도), 스폰서 기본액(보통 성적일 때).
 * 스폰서는 결산 때 실제 인기도로 다시 매겨 차액을 정산한다.
 */
export function seasonIncome(league: LeagueState, world: World, team: number): { broadcast: number; parent: number; sponsor: number } {
  const year = world.year;
  const futures = isFuturesTeam(league, team, year);
  const trust = league.owner?.team === team ? league.owner.trust : 50;
  const lastCash = league.finance?.[team]?.history.at(-1)?.cash ?? START_CASH;
  const star = team < world.teams.length ? starBonus(world)[team] ?? 0 : 0;
  return {
    broadcast: futures ? 0 : BROADCAST,
    parent: parentSupport(league, team, trust, lastCash),
    sponsor: sponsorAmount(league, team, futures, 0.5, 0, star),
  };
}

/** 스폰서·상품 수입 (인기도 × 기본액 + 구단 이름 스폰서) */
function sponsorAmount(league: LeagueState, team: number, futures: boolean, winPct: number, depth: number, star: number): number {
  return Math.round(SPONSOR_BASE * (futures ? 0.3 : popularity(league, team, winPct, depth, star))) + (NAMING_SPONSOR[league.teams[team].franchise] ?? 0);
}

// ---- 결산

/** 인기도 (0.6~1.4): 성적·가을야구·연고·스타·마케팅 */
export function popularity(league: LeagueState, team: number, winPct: number, postseasonRound: number, star: number): number {
  const mk = MARKETING_SPONSOR[activeLevel(league, team, 'marketing')];
  const v = (1 + 1.2 * (winPct - 0.5) + 0.06 * postseasonRound + 2 * parkOf(league, team).market + 2 * star) * mk;
  return Math.max(0.6, Math.min(1.4, v));
}

/**
 * 모기업 지원금: 등급 기본액 × (0.85 + 0.003 × 신뢰도) − 전년 긴급 지원의 절반 − 쌓인 자금 회수분.
 * cash: 지원금을 받기 직전 자금
 */
export function parentSupport(league: LeagueState, team: number, trust: number, cash: number): number {
  const base = PARENT_BASE[parentGrade(league, team)];
  const prevRescue = league.finance?.[team]?.history.at(-1)?.rescue ?? 0;
  const clawback = Math.max(0, cash - PARENT_RESERVE) * PARENT_CLAWBACK;
  return Math.max(0, Math.round(base * (0.85 + 0.003 * trust) - prevRescue / 2 - clawback));
}

export interface SettleInput extends SeasonInput {
  /** 정규시즌 순위 (구단 색인) */
  standings: number[];
  /** 가을야구에서 이긴 시리즈 수 (진출 못 하면 0, 진출만 1) */
  postseasonDepth: (team: number) => number;
  champion: number | null;
  /** 구단별 구단주 신뢰도 (플레이어 구단만 실제 값, AI는 50) */
  trust: (team: number) => number;
}

/**
 * 시즌 결산: 시즌 중 수입·지출과 결산 항목(중계권·스폰서·모기업 지원·우승 배당)을 장부에 적고,
 * 자금이 0보다 작으면 모기업이 0까지 메운다. 구단별 결산을 돌려준다 (league.finance[t].history에도 남긴다).
 */
export function settleSeason(input: SettleInput): FinanceYear[] {
  const { league, world, season } = input;
  const year = world.year;
  ensureFinance(league);
  const end = Number.MAX_SAFE_INTEGER;
  const out: FinanceYear[] = [];
  const stars = starBonus(world);
  for (let t = 0; t < league.teams.length; t++) {
    const flows = seasonFlows(input, t, end);
    const items = { ...flows.items };
    const rec = t < world.teams.length ? season.teams[t] : null;
    const pct = rec && rec.w + rec.l > 0 ? rec.w / (rec.w + rec.l) : 0.5;
    const futures = isFuturesTeam(league, t, year);
    // 중계권·모기업 지원금은 시즌 중 월말에 다 받았다. 스폰서는 실제 인기도로 다시 매겨 차액을 정산한다
    items.sponsor = sponsorAmount(league, t, futures, pct, input.postseasonDepth(t), stars[t] ?? 0);
    if (input.champion === t) items.champion = CHAMPION_BONUS;
    for (const [k, v] of Object.entries(items) as [FinanceKind, number][]) {
      if (!v) continue;
      league.ledger.push(v > 0
        ? { year, from: -1, to: t, amount: v, note: `${year} ${FINANCE_LABEL[k]}`, kind: k }
        : { year, from: t, to: -1, amount: -v, note: `${year} ${FINANCE_LABEL[k]}`, kind: k });
    }
    // 이 해 장부의 다른 항목(오프시즌 보상금·계약금·이적료, 시즌 중 현금 트레이드 등)도 결산에 넣는다
    const other = ledgerItems(league, t, year);
    for (const k of Object.keys(other) as FinanceKind[]) if (!(k in items) && k !== 'rescue' && k !== 'start') items[k] = other[k];
    const net = Object.values(items).reduce((s, v) => s + (v ?? 0), 0);
    let cash = cashOf(league, t);
    let rescue = 0;
    if (cash < 0) {
      rescue = -cash;
      league.ledger.push({ year, from: -1, to: t, amount: rescue, note: `${year} 모기업 긴급 지원 (적자 보전)`, kind: 'rescue' });
      cash = 0;
    }
    const y: FinanceYear = { year, items, net, cash, rescue };
    league.finance![t].history.push(y);
    out.push(y);
  }
  return out;
}

/** 적자 보전에 따른 구단주 신뢰도 변화 (−(메운 금액 ÷ 20억), 최대 −15). 흑자면 +2 */
export function trustFromFinance(y: FinanceYear): number {
  if (y.rescue > 0) return -Math.min(15, Math.round(y.rescue / 200_000));
  return y.net > 0 ? 2 : 0;
}

// ---- 투자

/** 투자 계획을 바꾼다 (오프시즌, 다음 시즌부터 적용) */
export function setInvest(league: LeagueState, team: number, kind: InvestKind, level: number): { ok: boolean; message: string } {
  if (!INVEST_KINDS.includes(kind) || !Number.isInteger(level) || level < 0 || level > 3) return { ok: false, message: '투자 단계는 0~3입니다.' };
  ensureFinance(league);
  league.finance![team].invest[kind] = level;
  return { ok: true, message: `${INVEST_LABEL[kind]} ${level}단계 (다음 시즌부터, 연 ${(INVEST_COST[kind][level] / 10000).toFixed(0)}억 원)` };
}

/**
 * 개막 때 투자를 확정한다. AI 구단은 지난 시즌 순위와 자금으로 계획을 정한다 (임시 규칙):
 * 상위 1/3은 의료·마케팅, 하위 1/3은 스카우트·육성을 2단계, 나머지는 1단계. 연간 비용이 자금의 60%를 넘으면 높은 것부터 낮춘다.
 */
export function lockInvestments(league: LeagueState, userTeam: number): void {
  ensureFinance(league);
  const st = league.lastSeason?.standings ?? [];
  for (let t = 0; t < league.teams.length; t++) {
    const f = league.finance![t];
    if (t !== userTeam) {
      const r = st.indexOf(t);
      const n = st.length || 1;
      const plan = startInvest();
      if (r >= 0 && r < n / 3) { plan.medical = 2; plan.marketing = 2; }
      else if (r >= 0 && r >= (2 * n) / 3) { plan.scout = 2; plan.develop = 2; }
      const room = Math.max(0, cashOf(league, t) * 0.6);
      const order: InvestKind[] = ['marketing', 'medical', 'scout', 'develop'];
      for (let guard = 0; guard < 12 && investCost({ invest: plan, history: [] }, true) > room; guard++) {
        const k = order.filter((x) => plan[x] > 0).sort((a, b) => plan[b] - plan[a])[0];
        if (!k) break;
        plan[k]--;
      }
      f.invest = plan;
    }
    f.active = { ...f.invest };
  }
}
