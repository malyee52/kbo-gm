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
import { aiFxRegion, FX_AI_WINNOW_WEEK, FX_MAX_OUT, fxSendSeason, fxSigned, fxState, fxVisible, fxWeek, type FxCtx, type FxNews, type FxRegion } from './scoutfx';
import { gmStyle } from './gm';
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

/**
 * 부상 대체 외국인 (2024~, KBO 2023-11 발표, 보도 기준. KBO 규약 원문은 확인 못 함):
 *   - 6주 이상 치료가 필요한 부상을 당한 외국인을 재활 선수 명단에 올리고(보유는 유지) 대체 외국인을 데려온다. 교체 횟수는 쓰지 않는다
 *   - 재활 명단 선수는 보유 한도에서 빠지고, 최소 6주 뒤 복귀할 수 있다 (게임: 영입 때 남은 결장이 6주 이상이어야 하므로 복귀는 늘 6주 뒤)
 *   - 복귀 때 구단이 둘 중 하나: 원래 선수 복귀(대체 선수는 웨이버) 또는 대체 선수를 남기고 원래 선수 방출(교체 1회로 셈)
 *   - 대체 선수 고용 비용은 한 달에 10만 달러까지
 * 임시 규칙: 대체 선수 남기기는 복귀 전에도 고를 수 있다. 복귀 선택은 마감일 뒤에도 된다. 그날 경기 전까지 고르지 않으면 원래 선수 복귀(rehabDay)
 */
export const INJURY_SWAP_FROM = 2024;
/** 부상 대체 외국인을 데려올 수 있는 남은 결장 (6주) */
export const INJURY_SWAP_DAYS = 42;
/** 대체 외국인 한 달 고용 비용 상한 (달러) */
export const INJURY_SWAP_MONTH_USD = 100_000;

/** 'rehab' = 부상 대체 영입 (교체 횟수에 안 셈), 'keep' = 복귀 때 대체 선수를 남김 (교체 1회로 셈, 이동 없음) */
export type MarketKind = 'release' | 'claim' | 'sign' | 'rehab' | 'keep';

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
  /** 'rehab'이면 재활 명단에 올린(다친) 외국인 id */
  rehab?: string;
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
  return movesOf(ctx.league, ctx.world.year).filter((m) => (m.kind === 'sign' || m.kind === 'keep') && m.to === team && foreign.has(m.id)).length;
}

/** 재활 명단 (부상 대체 외국인): 다친 선수와 대체 선수가 둘 다 아직 그 구단에 있는 것만 (복귀 선택을 하면 한쪽이 방출돼 끝난다) */
export interface Rehab {
  team: number;
  /** 재활 명단에 오른 선수 id */
  injured: string;
  /** 대체 선수 id */
  sub: string;
  /** 대체 영입한 날 */
  day: number;
}

export function rehabsOf(ctx: Pick<MarketCtx, 'league' | 'world'>, team?: number): Rehab[] {
  const at = new Map(ctx.world.players.map((p) => [p.id, p.teamIdx]));
  return movesOf(ctx.league, ctx.world.year)
    .filter((m) => m.kind === 'rehab' && m.rehab && (team === undefined || m.to === team) && at.get(m.id) === m.to && at.get(m.rehab) === m.to)
    .map((m) => ({ team: m.to, injured: m.rehab!, sub: m.id, day: m.day }));
}

/** 재활 명단에 있는 선수 id (보유 한도에서 빠진다) */
export function rehabListed(ctx: Pick<MarketCtx, 'league' | 'world'>, team?: number): Set<string> {
  return new Set(rehabsOf(ctx, team).map((r) => r.injured));
}

/** 구단 외국인 보유 (일반, 아시아쿼터). 복무·육성 구분 없이 명단 전체. league를 주면 재활 명단 선수는 빼고 센다 */
export function foreignHeld(world: World, team: number, lp: Map<string, LeaguePlayer>, league?: LeagueState): { regular: number; asia: number } {
  const rehab = league ? rehabListed({ league, world }, team) : new Set<string>();
  const list = world.teams[team].org.filter((p) => p.foreign && !rehab.has(p.id));
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

/**
 * 시장에서 데려올 수 있는 선수: 그 해 시장의 외국인 후보와 자유계약 선수 (원 소속 구단 것은 빼고).
 * 파견 후보(가상 외국인, scoutfx.ts)는 그 구단 관찰 명단에 있는 선수만
 */
export function marketPlayers(ctx: Pick<MarketCtx, 'world' | 'league'>, team: number): SimPlayer[] {
  const lp = new Map(ctx.league.players.map((x) => [x.id, x]));
  return ctx.world.players.filter((p) => p.teamIdx === -1 && p.formerTeam !== team && !p.reserve && (!lp.get(p.id) || fxVisible(ctx.league, team, lp.get(p.id)!)));
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
  const rehab = rehabsOf(ctx, team).find((r) => r.injured === p.id || r.sub === p.id);
  if (rehab) return p.id === rehab.injured ? '재활 명단에 있습니다. 복귀 선택(선수 시장)에서 정하세요.' : '부상 대체 선수입니다. 원래 선수 복귀 선택(선수 시장)에서 정하세요.';
  if (ctx.season.day > marketDeadlineDay(ctx.world.year, ctx.season.schedule.length, ctx.league)) return `방출·영입 마감(${ruleDate(ctx.league, 'marketDeadline').month}월 ${ruleDate(ctx.league, 'marketDeadline').date}일)이 지났습니다.`;
  const org = ctx.world.teams[team].org;
  const catchers = org.filter((x) => !x.isPitcher && x.pos === 'C').length;
  if (!p.isPitcher && p.pos === 'C' && catchers <= 2) return '포수가 2명뿐이라 방출할 수 없습니다.';
  const pitchers = org.filter((x) => x.isPitcher && !x.dev).length;
  const hitters = org.filter((x) => !x.isPitcher && !x.dev).length;
  if (p.isPitcher ? pitchers <= 18 : hitters <= 18) return `${p.isPitcher ? '투수' : '야수'}가 18명뿐이라 더 방출할 수 없습니다.`;
  return null;
}

/** 그 외국인을 재활 명단에 올리고 부상 대체 외국인을 데려올 수 없는 이유 (없으면 null) */
export function rehabBlock(ctx: Pick<MarketCtx, 'league' | 'world' | 'season'>, injured: SimPlayer, team: number): string | null {
  const year = ctx.world.year;
  if (year < INJURY_SWAP_FROM) return `부상 대체 외국인 제도는 ${INJURY_SWAP_FROM}년부터입니다.`;
  if (injured.teamIdx !== team || !injured.foreign) return '우리 구단 외국인 선수가 아닙니다.';
  if (rehabListed(ctx, team).has(injured.id)) return '이미 재활 명단에 있습니다.';
  if (rehabsOf(ctx, team).some((r) => r.sub === injured.id)) return '부상 대체 선수는 다시 재활 명단에 올릴 수 없습니다.';
  const left = ctx.season.states.absentUntil[injured.idx] - ctx.season.day;
  if (left < INJURY_SWAP_DAYS) return `6주(${INJURY_SWAP_DAYS}일) 넘게 빠지는 부상만 대상입니다 (${left > 0 ? `남은 결장 ${left}일` : '결장 중 아님'}).`;
  return null;
}

/**
 * 영입할 수 없는 이유 (없으면 null). rehab을 주면 그 선수를 재활 명단에 올리는 부상 대체 영입:
 * 재활 명단 선수는 보유 한도·구성 제한에서 빠지고 교체 횟수를 보지 않는다. 외국인 후보만
 */
export function signBlock(ctx: MarketCtx, p: SimPlayer, team: number, rehab?: SimPlayer): string | null {
  const lp = new Map(ctx.league.players.map((x) => [x.id, x]));
  const year = ctx.world.year;
  if (rehab) {
    const why = rehabBlock(ctx, rehab, team);
    if (why) return why;
    if (!isMarketForeign(p, lp.get(p.id), year)) return '부상 대체로는 외국인 후보만 데려올 수 있습니다.';
  }
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
    if (!fxVisible(ctx.league, team, lp.get(p.id) ?? { id: p.id })) return '관찰 명단에 없는 후보입니다. 스카우트 팀을 보내 찾으세요.';
    // 창단 특례 구단은 1명 더 (eras.ts teamForeignRule)
    const rule = teamForeignRule(foreignRule(ctx.meta, year, ctx.league), ctx.league, team, year);
    const held = foreignHeld(ctx.world, team, lp, ctx.league);
    const asia = !!lp.get(p.id)?.asia;
    const out = rehab && !!lp.get(rehab.id)?.asia === asia ? 1 : 0;
    const have = (asia ? held.asia : held.regular) - out;
    const limit = asia ? rule.asia : rule.regular;
    if (have >= limit) {
      const kindName = asia ? '아시아쿼터' : '외국인';
      // 한도를 넘게 데리고 시작한 구단(개막 명단 자료가 없는 해는 그 해 기록의 외국인이 모두 들어온다)은 한 명 방출로 자리가 나지 않는다
      if (!limit) return `${year}년에는 ${kindName} 선수를 보유할 수 없습니다.`;
      const need = have - limit + 1;
      return `${kindName} 보유 한도가 차 있습니다 (지금 ${have}명 / 한도 ${limit}명). ${kindName} 선수를 ${need}명 더 방출해야 자리가 납니다.`;
    }
    // 구성 제한 (2014~2019, eras.ts foreignMixOk): 보유 자리를 모두 투수 또는 모두 타자로 채울 수 없다
    const listed = rehabListed(ctx, team);
    if (rehab) listed.add(rehab.id);
    const same = ctx.world.teams[team].org.filter((x) => x.foreign && !listed.has(x.id) && !lp.get(x.id)?.asia && x.isPitcher === p.isPitcher).length;
    if (!asia && !foreignMixOk(year, rule.regular, same)) {
      return `${year}년에는 외국인 ${rule.regular}명을 모두 ${p.isPitcher ? '투수' : '타자'}로 채울 수 없습니다 (${p.isPitcher ? '투수' : '타자'}는 ${rule.regular - 1}명까지).`;
    }
    if (!rehab && foreignSwapsUsed(ctx, team) >= ruleOf(ctx.league, 'foreignSwaps')) return `외국인 교체는 한 시즌 ${ruleOf(ctx.league, 'foreignSwaps')}번까지입니다.`;
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
 * 자유계약 국내 선수는 최저 연봉의 남은 몫을 그때 낸다 (원 소속 계약은 방출 때 정산했다).
 * 파견 후보면 모든 관찰 명단에서 빼고 그 소식을 돌려준다 (scoutfx.ts)
 */
export function signPlayer(ctx: MarketCtx, p: SimPlayer, team: number, rehab?: SimPlayer): FxNews[] {
  const { league, world, season } = ctx;
  const year = world.year;
  const lp = league.players.find((x) => x.id === p.id)!;
  if (rehab) {
    // 부상 대체: 한 달 10만 달러 상한 (연봉은 지급일마다 고르게 나가므로 상한 × 지급 달 수, 계약금 없음)
    lp.contract = { ...lp.contract, salary: rehabSalary(lp, year, season.schedule.length) };
    delete lp.contract.bonus;
  } else if (!(p.foreign && lp.market === year)) {
    const cost = Math.round(minSalary(year, league) * remainingShare(year, season.schedule.length, season.day));
    if (cost > 0) league.ledger.push({ year, from: team, to: -1, amount: cost, note: `${p.name} 영입 연봉 (남은 기간)`, kind: 'release' });
  }
  season.transfer(p.idx, team);
  (league.marketMoves ??= []).push(rehab
    ? { year, day: season.day, id: p.id, kind: 'rehab', from: -1, to: team, rehab: rehab.id }
    : { year, day: season.day, id: p.id, kind: 'sign', from: -1, to: team });
  if (!lp.fx) return [];
  delete lp.fx;
  return fxSigned(league, p.id, team);
}

/** 부상 대체로 데려올 때의 연봉 (달러): 후보 요구액, 다만 한 달 INJURY_SWAP_MONTH_USD까지 */
export function rehabSalary(lp: LeaguePlayer, year: number, seasonDays: number): number {
  return Math.min(lp.contract.salary, INJURY_SWAP_MONTH_USD * Math.max(1, paydays(year, seasonDays).length));
}

/** 재활 명단 선수 복귀 선택을 할 수 없는 이유 (없으면 null). keep = 대체 선수를 남기고 원래 선수 방출 */
export function rehabEndBlock(ctx: Pick<MarketCtx, 'league' | 'world' | 'season'>, r: Rehab, keep: boolean): string | null {
  if (ctx.season.done) return '시즌이 끝났습니다.';
  if (keep) {
    if (foreignSwapsUsed(ctx, r.team) >= ruleOf(ctx.league, 'foreignSwaps')) return `외국인 교체 ${ruleOf(ctx.league, 'foreignSwaps')}번을 다 써서 대체 선수를 남길 수 없습니다.`;
    return null;
  }
  const p = ctx.world.players.find((x) => x.id === r.injured);
  const left = p ? ctx.season.states.absentUntil[p.idx] - ctx.season.day : 0;
  return left > 0 ? `아직 복귀 전입니다 (남은 결장 ${left}일).` : null;
}

/** 복귀 선택을 해야 하는 재활 명단 (다친 선수가 다 나았다) */
export function rehabsDue(ctx: Pick<MarketCtx, 'league' | 'world' | 'season'>, team?: number): Rehab[] {
  const idx = new Map(ctx.world.players.map((p) => [p.id, p.idx]));
  return rehabsOf(ctx, team).filter((r) => ctx.season.states.absentUntil[idx.get(r.injured)!] <= ctx.season.day);
}

/** 복귀 선택: keep이면 대체 선수를 남기고(교체 1회) 원래 선수를 방출, 아니면 원래 선수가 돌아오고 대체 선수를 방출. 둘 다 웨이버 (releasePlayer) */
export function endRehab(ctx: MarketCtx, r: Rehab, keep: boolean): void {
  const byId = new Map(ctx.world.players.map((p) => [p.id, p]));
  if (keep) (ctx.league.marketMoves ??= []).push({ year: ctx.world.year, day: ctx.season.day, id: r.sub, kind: 'keep', from: -1, to: r.team });
  releasePlayer(ctx, byId.get(keep ? r.injured : r.sub)!, r.team);
}

/**
 * 그날 경기 전 복귀 선택 (결정적). AI 구단은 대체 선수가 원래 선수보다 낫게 보이고(추측) 교체 횟수가 남았으면 남긴다.
 * 플레이어 구단은 그날 경기 전까지 고르지 않았으면 원래 선수 복귀 (조작 기록은 같은 날 경기 전에 들어가므로 재현과 같다)
 */
export function rehabDay(ctx: MarketCtx): { r: Rehab; keep: boolean }[] {
  if (ctx.season.done) return [];
  const out: { r: Rehab; keep: boolean }[] = [];
  const byId = new Map(ctx.world.players.map((p) => [p.id, p]));
  for (const r of rehabsDue(ctx)) {
    let keep = false;
    if (r.team !== ctx.userTeam && !rehabEndBlock(ctx, r, true)) {
      const sub = byId.get(r.sub)!;
      const who = { team: r.team, user: false };
      const seen = guessRuns(ctx.league, who, sub.id, currentRuns(sub, ctx.values),
        foreignSigma(ctx.league, who, { id: sub.id, sample: sub.bat?.sample ?? sub.pit?.sample ?? null }), ctx.world.year);
      keep = seen > currentRuns(byId.get(r.injured)!, ctx.values);
    }
    endRehab(ctx, r, keep);
    out.push({ r, keep });
  }
  return out;
}

/**
 * 재정용 이동 (finance.ts TradeMove 꼴): 웨이버 클레임은 계약이 넘어가고, 방출은 그날부터 연봉에서 빠지며(남은 몫은 장부로 냈다),
 * 시장 외국인 영입은 그날부터 연봉이 나간다. 자유계약 국내 선수 영입은 장부로 냈으므로 넣지 않는다
 */
export function financeMoves(league: LeagueState, year: number): { day: number; from: number; to: number; give: string[]; get: string[] }[] {
  const market = new Set(league.players.filter((p) => p.market === year && p.foreign).map((p) => p.id));
  return movesOf(league, year)
    .filter((m) => m.kind !== 'keep' && ((m.kind !== 'sign' && m.kind !== 'rehab') || market.has(m.id)))
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
  const listed = rehabListed(ctx, team);
  for (const p of world.teams[team].org) {
    if (!p.foreign || listed.has(p.id)) continue;
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
export function aiMarketDay(ctx: MarketCtx): { team: number; out: SimPlayer; in: SimPlayer; why: 'injury' | 'slump' | 'rehab'; fx: FxNews[] }[] {
  const { world, season } = ctx;
  const day = season.day;
  if (day < AI_SWAP_FROM_DAY || day % AI_SWAP_EVERY !== 0 || day > marketDeadlineDay(world.year, season.schedule.length, ctx.league) || season.done) return [];
  const lpById = new Map(ctx.league.players.map((p) => [p.id, p]));
  const out: { team: number; out: SimPlayer; in: SimPlayer; why: 'injury' | 'slump' | 'rehab'; fx: FxNews[] }[] = [];
  for (let t = 0; t < world.teams.length; t++) {
    if (t === ctx.userTeam || !ruleOf(ctx.league, 'foreignSwaps')) continue;
    const target = swapTarget(ctx, t);
    if (!target) continue;
    // 6주 넘게 다쳤으면 (2024~) 재활 명단에 올리고 부상 대체 (교체 횟수를 쓰지 않는다)
    const rehab = target.why === 'injury' && !rehabBlock(ctx, target.out, t);
    if (!rehab && foreignSwapsUsed(ctx, t) >= ruleOf(ctx.league, 'foreignSwaps')) continue;
    // 같은 쓰임(투수·타자)과 같은 구분(일반·아시아쿼터)의 후보
    const asia = !!lpById.get(target.out.id)?.asia;
    // 파견 후보는 그 구단 관찰 명단에 있는 선수만 (scoutfx.ts)
    const cands = world.players.filter((p) => p.teamIdx === -1 && p.foreign && isMarketForeign(p, lpById.get(p.id), world.year)
      && fxVisible(ctx.league, t, lpById.get(p.id)!) && !!lpById.get(p.id)?.asia === asia && p.isPitcher === target.out.isPitcher && availableDay(lpById.get(p.id), season.schedule.length) <= day);
    if (!cands.length) continue;
    // 후보는 그 구단의 추측으로 본다 (진짜 + z × σ, scout.ts, 기획안 19.4). 자기 외국인은 진짜 능력 (오래 지켜봄)
    const who = { team: t, user: false };
    const seen = (p: SimPlayer) => guessRuns(ctx.league, who, p.id, currentRuns(p, ctx.values),
      foreignSigma(ctx.league, who, { id: p.id, sample: p.bat?.sample ?? p.pit?.sample ?? null }), world.year);
    const pick = cands.reduce((a, b) => (seen(b) > seen(a) || (seen(b) === seen(a) && b.id < a.id) ? b : a));
    if (target.why === 'slump' && seen(pick) < currentRuns(target.out, ctx.values) + AI_SWAP_GAIN) continue;
    if (rehab) {
      if (signBlock(ctx, pick, t, target.out)) continue;
      out.push({ team: t, out: target.out, in: pick, why: 'rehab', fx: signPlayer(ctx, pick, t, target.out) });
      continue;
    }
    releasePlayer(ctx, target.out, t);
    const fx = signPlayer(ctx, pick, t);
    out.push({ team: t, out: target.out, in: pick, why: target.why, fx });
  }
  return out;
}

// ---- 외국인 스카우트 파견 (scoutfx.ts, 기획안 19.4)

function seasonFxCtx(ctx: MarketCtx): FxCtx {
  const owner = new Map(ctx.world.players.map((p) => [p.id, p.teamIdx]));
  return { league: ctx.league, year: ctx.world.year, userTeam: ctx.userTeam, free: (id) => (owner.get(id) ?? -1) === -1 };
}

/** 파견할 수 있는 때인가 (개막 ~ 외국인 교체 마감) */
export function fxSeasonOpen(ctx: Pick<MarketCtx, 'world' | 'season' | 'league'>): boolean {
  return !ctx.season.done && ctx.season.day <= marketDeadlineDay(ctx.world.year, ctx.season.schedule.length, ctx.league);
}

/** 시즌 중 파견 (플레이어 구단, 조작 'fx-send') */
export function fxSendInSeason(ctx: MarketCtx, team: number, region: FxRegion): void {
  fxSendSeason(seasonFxCtx(ctx), team, region);
}

/**
 * 하루 뒤 외국인 스카우트 진행 (결정적): 7일마다 지난 한 주를 굴리고(발견·떠남·에이전트 추천), AI 구단 파견을 정한다.
 * AI 파견: 둘째 주에 한 팀, 윈나우 성향은 FX_AI_WINNOW_WEEK에 한 팀 더 (19.3), 바꿀 외국인이 있는데 명단에 맞는 후보가 없으면 그 쓰임에 맞는 지역으로.
 * 소식을 돌려준다 (구단별)
 */
export function scoutFxDay(ctx: MarketCtx): FxNews[] {
  const { world, season, league } = ctx;
  const d = season.day;
  if (season.done || d === 0 || d % 7 !== 0) return [];
  const s = fxState(league, world.year, false);
  const fctx = seasonFxCtx(ctx);
  const names = new Map(world.players.map((p) => [p.id, p.teamIdx]));
  const news = fxWeek(fctx, d / 7 - 1, (id) => { const t = names.get(id) ?? -1; return t >= 0 ? world.teams[t].name : null; });
  if (!fxSeasonOpen(ctx) || !ruleOf(league, 'foreignSwaps')) return news;
  const week = d / 7;
  const lpById = new Map(league.players.map((p) => [p.id, p]));
  for (let t = 0; t < world.teams.length; t++) {
    if (t === ctx.userTeam) continue;
    const st = s.teams[t];
    if (st.out.length >= FX_MAX_OUT) continue;
    let region: FxRegion | null = null;
    if (week === 1 || (week === FX_AI_WINNOW_WEEK && gmStyle(league, t) === 'winnow')) region = aiFxRegion(st.sent, false);
    else if (!st.out.length && foreignSwapsUsed(ctx, t) < ruleOf(league, 'foreignSwaps')) {
      const target = swapTarget(ctx, t);
      if (target) {
        const asia = !!lpById.get(target.out.id)?.asia;
        const fits = st.list.some((e) => { const p = lpById.get(e.id); return p && !!p.asia === asia && p.isPitcher === target.out.isPitcher; });
        if (!fits) region = asia ? aiFxRegion(st.sent, true) : target.out.isPitcher ? (st.sent % 2 ? 'japan' : 'na') : (st.sent % 2 ? 'latam' : 'na');
      }
    }
    if (region) fxSendSeason(fctx, t, region);
  }
  return news;
}
