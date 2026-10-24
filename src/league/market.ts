// 시즌 중 방출·영입 (2026-10-12, 기획서 "시즌 중 방출·영입 (웨이버, 대체 외국인)").
//
// 실제 KBO 규칙을 따른다:
//   - 웨이버 공시: 시즌 중 선수를 방출하면 다른 구단이 데려갈 수 있다. 순서는 지금 순위의 역순(하위 구단 먼저).
//     데려가는 구단이 계약(연봉·남은 기간)을 그대로 넘겨받는다. 아무도 데려가지 않으면 자유계약 선수가 되고,
//     원 소속 구단은 남은 보장 연봉(이번 시즌 남은 몫 + 남은 계약 해)을 그때 한꺼번에 낸다
//   - 자유계약 선수는 원 소속 구단이 아닌 구단이 최저 연봉으로 데려갈 수 있다 (같은 시즌 원 소속 구단 복귀 불가)
//   - 외국인 교체: 시즌 중 새 외국인 계약은 구단당 FOREIGN_SWAPS번까지. 보유 한도(일반·아시아쿼터) 안에서만
//   - 마감: 8월 15일 (가을야구 출전 선수 등록 마감). 방출도 영입도 이날까지
// 시장의 외국인 후보: 시작 연도에는 그 해 실제로 시즌 중 교체돼 들어온 외국인(개막 명단에 없던 선수, create.ts),
// 그 밖의 해는 개막 때 만든 가상 후보(openMarket). 후보는 리그 상태에 team = -1, market = 그 해로 두고 시즌 월드에 소속 없이 들어온다 (world.ts).
// AI 구단: 오래 다친 외국인이나 크게 부진한 외국인을 더 나은 후보로 바꾼다 (aiMarketDay). 우리가 방출한 선수에 웨이버 클레임을 건다.
// 방출 비용(남은 보장 연봉)은 자금이 모자라도 낸다: 다른 지출처럼 적자는 결산 때 모기업이 메운다 (finance.ts). 자금 조건을 두면
// 결산 뒤 자금이 0 근처인 구단이 많아 다음 해부터 교체가 거의 없어졌다 (2026-10-12 측정: 0~2명)

import { currentRuns, type ValueContext } from '../ai/value';
import { foreignSigma, guessRuns } from './scout';
import type { Season, SimPlayer, World } from '../engine';
import type { Meta } from '../data/types';
import { dateOf } from '../game/calendar';
import { foreignMixOk, foreignRule, teamForeignRule } from './eras';
import { payOf, paydays } from './finance';
import { minSalary, wageIndex, WON_PER_RUN } from './salary';
import type { LeaguePlayer, LeagueState } from './types';
import { ruleDate, ruleOf } from './rules';

/** 시즌 중 외국인 교체(새 계약) 한도 (KBO 규정 2회) */
export const FOREIGN_SWAPS = 2;
/** 방출·영입 마감 (가을야구 출전 선수 등록 마감) */
export const MARKET_DEADLINE = { month: 8, date: 15 };
/** 웨이버 클레임: 한 시즌 가치가 이 런 이상이고 연봉의 CLAIM_PAY_SHARE배 값어치는 하는 선수만 (임시값) */
export const CLAIM_MIN_RUNS = 4;
export const CLAIM_PAY_SHARE = 0.8;
/** 개막 때 만드는 가상 외국인 후보 수 (일반, 아시아쿼터) */
export const MARKET_REGULAR = 8;
export const MARKET_ASIA = 2;
/** AI 외국인 교체: 이만큼(일) 넘게 남은 결장이면 교체를 검토 (KBO 부상 대체 기준 6주) */
export const AI_SWAP_INJURY_DAYS = 35;
/** AI 외국인 교체: 부진한 선수는 후보가 지금 선수 + 이만큼(런) 이상이면 바꾼다. 실제 구단은 능력보다 성적을 보고 바꾸므로 음수 (한 해 교체 수를 실제 5~13명에 맞춤) */
export const AI_SWAP_GAIN = -8;
/** AI 외국인 교체 부진 기준: 평균자책이 리그의 SLUMP_ERA배 넘게, OPS가 리그의 SLUMP_OPS배 아래 */
export const SLUMP_ERA = 1.2;
export const SLUMP_OPS = 0.9;
/** AI는 이 날짜 간격으로 검토한다 (개막 3주 뒤부터) */
export const AI_SWAP_EVERY = 7;
export const AI_SWAP_FROM_DAY = 21;

export type MarketKind = 'release' | 'claim' | 'sign';

/** 시즌 중 방출·영입 기록 (리그 상태에 남는다. 재정·결산·조작 기록 재실행에 쓴다) */
export interface MarketMove {
  year: number;
  day: number;
  id: string;
  kind: MarketKind;
  /** 'sign'이면 -1 (시장) */
  from: number;
  /** 'release'면 -1 */
  to: number;
}

export interface MarketCtx {
  league: LeagueState;
  world: World;
  season: Season;
  meta: Meta;
  values: ValueContext;
  userTeam: number;
}

/** 마감일 (일정 색인). 그날 경기 전까지 */
export function marketDeadlineDay(year: number, seasonDays: number, league?: Pick<LeagueState, 'rules'>): number {
  const MARKET_DEADLINE = ruleDate(league, 'marketDeadline');
  let last = -1;
  for (let d = 0; d < seasonDays; d++) {
    const dt = dateOf(year, d);
    if (dt.month < MARKET_DEADLINE.month || (dt.month === MARKET_DEADLINE.month && dt.date <= MARKET_DEADLINE.date)) last = d;
  }
  return last;
}

export function movesOf(league: LeagueState, year: number): MarketMove[] {
  return (league.marketMoves ?? []).filter((m) => m.year === year);
}

/** 그 구단이 이번 시즌 새로 계약한 외국인 수 (교체 횟수) */
export function foreignSwapsUsed(ctx: Pick<MarketCtx, 'league' | 'world'>, team: number): number {
  const foreign = new Set(ctx.world.players.filter((p) => p.foreign).map((p) => p.id));
  return movesOf(ctx.league, ctx.world.year).filter((m) => m.kind === 'sign' && m.to === team && foreign.has(m.id)).length;
}

/** 구단 외국인 보유 (일반, 아시아쿼터). 복무·육성 구분 없이 명단 전체 */
export function foreignHeld(world: World, team: number, lp: Map<string, LeaguePlayer>): { regular: number; asia: number } {
  const list = world.teams[team].org.filter((p) => p.foreign);
  const asia = list.filter((p) => lp.get(p.id)?.asia).length;
  return { regular: list.length - asia, asia };
}

const regularCount = (world: World, team: number) => world.teams[team].org.filter((p) => !p.dev).length;

/** 이번 시즌 남은 월급 몫 (0~1): 그날 뒤의 지급일 수 ÷ 전체 지급일 수 */
export function remainingShare(year: number, seasonDays: number, day: number): number {
  const pays = paydays(year, seasonDays);
  return pays.length ? pays.filter((pd) => pd.day >= day).length / pays.length : 0;
}

/**
 * 외국인 방출 때 남은 연봉 가운데 보장된 몫. 외국인 계약 총액은 보통 계약금(계약 때 이미 냄)·연봉·옵션(성적 조건, 보장 안 됨)으로 나뉘고
 * 방출하면 남은 연봉만 준다. 총액 100만 달러면 계약금 20만·연봉 60만·옵션 20만 꼴이 흔하다 (임시값 0.6)
 */
export const FOREIGN_GUARANTEED_SHARE = 0.6;

/** 방출(아무도 데려가지 않음) 때 원 소속 구단이 내는 남은 보장 연봉 (만 원): 이번 시즌 남은 몫 + 계약이 남은 해 */
export function releaseCost(lp: LeaguePlayer, year: number, seasonDays: number, day: number): number {
  const pay = payOf(lp) * (lp.foreign ? FOREIGN_GUARANTEED_SHARE : 1);
  const later = lp.foreign ? 0 : Math.max(0, lp.contract.until - year) * lp.contract.salary;
  return Math.round(pay * remainingShare(year, seasonDays, day) + later);
}

/** 시장에서 데려올 수 있는 선수: 그 해 시장의 외국인 후보와 자유계약 선수 (원 소속 구단 것은 빼고) */
export function marketPlayers(ctx: Pick<MarketCtx, 'world'>, team: number): SimPlayer[] {
  return ctx.world.players.filter((p) => p.teamIdx === -1 && p.formerTeam !== team && !p.reserve);
}

export function isMarketForeign(p: SimPlayer, lp: LeaguePlayer | undefined, year: number): boolean {
  return p.foreign && lp?.market === year;
}

/** 시장에 나오는 날 (일정 색인). 실제 시즌 중 교체 외국인은 실제로 들어온 무렵부터, 그 밖에는 개막부터 */
export function availableDay(lp: LeaguePlayer | undefined, seasonDays: number): number {
  return lp?.marketFrom ? Math.round(lp.marketFrom * seasonDays) : 0;
}

/** 방출할 수 없는 이유 (없으면 null) */
export function releaseBlock(ctx: MarketCtx, p: SimPlayer, team: number): string | null {
  if (p.teamIdx !== team) return '우리 구단 선수가 아닙니다.';
  if (ctx.season.done) return '시즌이 끝났습니다.';
  if (ctx.season.day > marketDeadlineDay(ctx.world.year, ctx.season.schedule.length, ctx.league)) return `방출·영입 마감(${ruleDate(ctx.league, 'marketDeadline').month}월 ${ruleDate(ctx.league, 'marketDeadline').date}일)이 지났습니다.`;
  const org = ctx.world.teams[team].org;
  const catchers = org.filter((x) => !x.isPitcher && x.pos === 'C').length;
  if (!p.isPitcher && p.pos === 'C' && catchers <= 2) return '포수가 2명뿐이라 방출할 수 없습니다.';
  const pitchers = org.filter((x) => x.isPitcher && !x.dev).length;
  const hitters = org.filter((x) => !x.isPitcher && !x.dev).length;
  if (p.isPitcher ? pitchers <= 18 : hitters <= 18) return `${p.isPitcher ? '투수' : '야수'}가 18명뿐이라 더 방출할 수 없습니다.`;
  return null;
}

/** 영입할 수 없는 이유 (없으면 null) */
export function signBlock(ctx: MarketCtx, p: SimPlayer, team: number): string | null {
  const lp = new Map(ctx.league.players.map((x) => [x.id, x]));
  const year = ctx.world.year;
  if (p.teamIdx !== -1) return '시장에 있는 선수가 아닙니다.';
  if (p.formerTeam === team) return '이번 시즌에 방출한 선수는 다시 데려올 수 없습니다.';
  if (ctx.season.done) return '시즌이 끝났습니다.';
  if (ctx.season.day > marketDeadlineDay(year, ctx.season.schedule.length, ctx.league)) return `방출·영입 마감(${ruleDate(ctx.league, 'marketDeadline').month}월 ${ruleDate(ctx.league, 'marketDeadline').date}일)이 지났습니다.`;
  const from = availableDay(lp.get(p.id), ctx.season.schedule.length);
  if (ctx.season.day < from) {
    const dt = dateOf(year, from);
    return `아직 시장에 나오지 않았습니다 (${dt.month}월 ${dt.date}일 무렵부터).`;
  }
  if (!p.dev && regularCount(ctx.world, team) >= ruleOf(ctx.league, 'orgLimit')) return `정식 선수 정원(${ruleOf(ctx.league, 'orgLimit')}명)이 차 있습니다. 먼저 방출하세요.`;
  if (p.foreign) {
    // 창단 특례 구단은 1명 더 (eras.ts teamForeignRule)
    const rule = teamForeignRule(foreignRule(ctx.meta, year, ctx.league), ctx.league, team, year);
    const held = foreignHeld(ctx.world, team, lp);
    const asia = !!lp.get(p.id)?.asia;
    if (asia ? held.asia >= rule.asia : held.regular >= rule.regular) {
      return `외국인 ${asia ? '아시아쿼터' : '선수'} 보유 한도(${asia ? rule.asia : rule.regular}명)가 차 있습니다. 먼저 외국인 선수를 방출하세요.`;
    }
    // 구성 제한 (2014~2019, eras.ts foreignMixOk): 보유 자리를 모두 투수 또는 모두 타자로 채울 수 없다
    const same = ctx.world.teams[team].org.filter((x) => x.foreign && !lp.get(x.id)?.asia && x.isPitcher === p.isPitcher).length;
    if (!asia && !foreignMixOk(year, rule.regular, same)) {
      return `${year}년에는 외국인 ${rule.regular}명을 모두 ${p.isPitcher ? '투수' : '타자'}로 채울 수 없습니다 (${p.isPitcher ? '투수' : '타자'}는 ${rule.regular - 1}명까지).`;
    }
    if (foreignSwapsUsed(ctx, team) >= ruleOf(ctx.league, 'foreignSwaps')) return `외국인 교체는 한 시즌 ${ruleOf(ctx.league, 'foreignSwaps')}번까지입니다.`;
  }
  return null;
}

/** 영입할 때의 계약 연봉 (외국인 후보는 후보의 요구액(달러), 자유계약 국내 선수는 그 해 최저 연봉) */
export function signSalary(p: SimPlayer, lp: LeaguePlayer | undefined, year: number, league?: Pick<LeagueState, 'ruleShifts'>): number {
  return p.foreign && lp ? lp.contract.salary : minSalary(year, league);
}

/**
 * 방출한다. 웨이버: 지금 순위 역순으로 AI 구단이 데려갈지 본다 (외국인은 데려가지 않는다).
 * 데려간 구단이 있으면 그 구단 색인, 없으면 -1 (자유계약, 남은 보장 연봉을 장부에 낸다)
 */
export function releasePlayer(ctx: MarketCtx, p: SimPlayer, team: number): number {
  const { league, world, season } = ctx;
  const year = world.year;
  const lp = league.players.find((x) => x.id === p.id)!;
  let claimer = -1;
  if (!p.foreign && !p.dev) {
    const runs = currentRuns(p, ctx.values);
    const worth = runs >= CLAIM_MIN_RUNS && runs * WON_PER_RUN * wageIndex(year, league) >= CLAIM_PAY_SHARE * lp.contract.salary;
    if (worth) {
      for (const t of [...season.standings()].reverse()) {
        if (t === team || t === ctx.userTeam || regularCount(world, t) >= ruleOf(ctx.league, 'orgLimit')) continue;
        claimer = t;
        break;
      }
    }
  }
  const moves = (league.marketMoves ??= []);
  if (claimer >= 0) {
    season.transfer(p.idx, claimer);
    moves.push({ year, day: season.day, id: p.id, kind: 'claim', from: team, to: claimer });
    return claimer;
  }
  const cost = releaseCost(lp, year, season.schedule.length, season.day);
  if (cost > 0) league.ledger.push({ year, from: team, to: -1, amount: cost, note: `${p.name} 방출 잔여 연봉`, kind: 'release' });
  season.transfer(p.idx, -1);
  moves.push({ year, day: season.day, id: p.id, kind: 'release', from: team, to: -1 });
  return -1;
}

/**
 * 시장의 선수를 영입한다. 외국인 후보는 후보 계약 그대로(연봉은 남은 달만큼 나간다),
 * 자유계약 국내 선수는 최저 연봉의 남은 몫을 그때 낸다 (원 소속 계약은 방출 때 정산했다)
 */
export function signPlayer(ctx: MarketCtx, p: SimPlayer, team: number): void {
  const { league, world, season } = ctx;
  const year = world.year;
  const lp = league.players.find((x) => x.id === p.id)!;
  if (!(p.foreign && lp.market === year)) {
    const cost = Math.round(minSalary(year, league) * remainingShare(year, season.schedule.length, season.day));
    if (cost > 0) league.ledger.push({ year, from: team, to: -1, amount: cost, note: `${p.name} 영입 연봉 (남은 기간)`, kind: 'release' });
  }
  season.transfer(p.idx, team);
  (league.marketMoves ??= []).push({ year, day: season.day, id: p.id, kind: 'sign', from: -1, to: team });
}

/**
 * 재정용 이동 (finance.ts TradeMove 꼴): 웨이버 클레임은 계약이 넘어가고, 방출은 그날부터 연봉에서 빠지며(남은 몫은 장부로 냈다),
 * 시장 외국인 영입은 그날부터 연봉이 나간다. 자유계약 국내 선수 영입은 장부로 냈으므로 넣지 않는다
 */
export function financeMoves(league: LeagueState, year: number): { day: number; from: number; to: number; give: string[]; get: string[] }[] {
  const market = new Set(league.players.filter((p) => p.market === year && p.foreign).map((p) => p.id));
  return movesOf(league, year)
    .filter((m) => m.kind !== 'sign' || market.has(m.id))
    .map((m) => ({ day: m.day, from: m.from, to: m.to, give: [m.id], get: [] }));
}

/** 이번 시즌 이동을 결산 전에 계약에 반영한다: 자유계약 국내 선수 영입은 최저 연봉 1년(이번 시즌까지) */
export function settleMarketContracts(league: LeagueState, year: number): void {
  const byId = new Map(league.players.map((p) => [p.id, p]));
  for (const m of movesOf(league, year)) {
    const p = byId.get(m.id);
    if (!p) continue;
    if (m.kind === 'sign' && !(p.foreign && p.market === year)) p.contract = { kind: 'reserve', salary: minSalary(year, league), until: year };
  }
}

/** AI 구단 외국인 교체 후보: 오래 다쳤거나, 크게 부진한 외국인 (가장 급한 한 명) */
function swapTarget(ctx: MarketCtx, team: number): { out: SimPlayer; why: 'injury' | 'slump' } | null {
  const { world, season } = ctx;
  const day = season.day;
  const lgBat = season.bat.reduce((a, b) => ({ pa: a.pa + b.pa, h: a.h + b.h, bb: a.bb + b.bb, hbp: a.hbp + b.hbp, ab: a.ab + b.ab, tb: a.tb + b.h + b.d + 2 * b.t + 3 * b.hr }),
    { pa: 0, h: 0, bb: 0, hbp: 0, ab: 0, tb: 0 });
  const opsOf = (x: { pa: number; h: number; bb: number; hbp: number; ab: number; tb: number }) =>
    (x.pa ? (x.h + x.bb + x.hbp) / x.pa : 0) + (x.ab ? x.tb / x.ab : 0);
  const lgOps = opsOf(lgBat);
  const lgEra = (() => { let er = 0, outs = 0; for (const l of season.pit) { er += l.er; outs += l.outs; } return outs ? (er * 27) / outs : 4.5; })();
  let best: { out: SimPlayer; why: 'injury' | 'slump'; score: number } | null = null;
  for (const p of world.teams[team].org) {
    if (!p.foreign) continue;
    const left = season.states.absentUntil[p.idx] - day;
    if (left >= AI_SWAP_INJURY_DAYS) {
      if (!best || left + 100 > best.score) best = { out: p, why: 'injury', score: left + 100 };
      continue;
    }
    if (p.isPitcher) {
      const l = season.pit[p.idx];
      if (l.outs < 60) continue;
      const era = (l.er * 27) / l.outs;
      if (era > lgEra * SLUMP_ERA && (!best || era / lgEra > best.score)) best = { out: p, why: 'slump', score: era / lgEra };
    } else {
      const l = season.bat[p.idx];
      if (l.pa < 100) continue;
      const ops = opsOf({ pa: l.pa, h: l.h, bb: l.bb, hbp: l.hbp, ab: l.ab, tb: l.h + l.d + 2 * l.t + 3 * l.hr });
      if (ops < lgOps * SLUMP_OPS && (!best || lgOps / Math.max(0.1, ops) > best.score)) best = { out: p, why: 'slump', score: lgOps / Math.max(0.1, ops) };
    }
  }
  return best ? { out: best.out, why: best.why } : null;
}

/**
 * 하루 시작 때 AI 구단의 외국인 교체 (결정적: 난수 없음). 바꾼 기록을 돌려준다 (소식용).
 * 같은 쓰임(투수·타자)·같은 구분(일반·아시아쿼터)의 시장 후보 가운데 가장 나은 선수로: 다쳤으면 그냥, 부진이면 후보가 지금 선수 + AI_SWAP_GAIN런 이상일 때
 */
export function aiMarketDay(ctx: MarketCtx): { team: number; out: SimPlayer; in: SimPlayer; why: 'injury' | 'slump' }[] {
  const { world, season } = ctx;
  const day = season.day;
  if (day < AI_SWAP_FROM_DAY || day % AI_SWAP_EVERY !== 0 || day > marketDeadlineDay(world.year, season.schedule.length, ctx.league) || season.done) return [];
  const lpById = new Map(ctx.league.players.map((p) => [p.id, p]));
  const out: { team: number; out: SimPlayer; in: SimPlayer; why: 'injury' | 'slump' }[] = [];
  for (let t = 0; t < world.teams.length; t++) {
    if (t === ctx.userTeam || foreignSwapsUsed(ctx, t) >= ruleOf(ctx.league, 'foreignSwaps')) continue;
    const target = swapTarget(ctx, t);
    if (!target) continue;
    // 같은 쓰임(투수·타자)과 같은 구분(일반·아시아쿼터)의 후보
    const asia = !!lpById.get(target.out.id)?.asia;
    const cands = world.players.filter((p) => p.teamIdx === -1 && p.foreign && isMarketForeign(p, lpById.get(p.id), world.year)
      && !!lpById.get(p.id)?.asia === asia && p.isPitcher === target.out.isPitcher && availableDay(lpById.get(p.id), season.schedule.length) <= day);
    if (!cands.length) continue;
    // 후보는 그 구단의 추측으로 본다 (진짜 + z × σ, scout.ts, 기획안 19.4). 자기 외국인은 진짜 능력 (오래 지켜봄)
    const who = { team: t, user: false };
    const sigma = foreignSigma(ctx.league, who);
    const seen = (p: SimPlayer) => guessRuns(ctx.league, who, p.id, currentRuns(p, ctx.values), sigma, world.year);
    const pick = cands.reduce((a, b) => (seen(b) > seen(a) || (seen(b) === seen(a) && b.id < a.id) ? b : a));
    if (target.why === 'slump' && seen(pick) < currentRuns(target.out, ctx.values) + AI_SWAP_GAIN) continue;
    releasePlayer(ctx, target.out, t);
    signPlayer(ctx, pick, t);
    out.push({ team: t, out: target.out, in: pick, why: target.why });
  }
  return out;
}
