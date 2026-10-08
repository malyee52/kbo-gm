// 다년 진행 (M6): 부상 후유증, 조기 노쇠, 슬럼프, 은퇴, 병역.
// 모두 결산(beginOffseason) 때 리그 상태에 반영한다. 난수는 선수·연도별로 시드에서 갈라 쓴다.
//
// 실존 인물 규칙(기획서 7장)과의 관계: 여기서 다루는 일(부상, 은퇴, 병역, 기량 변화)은 사건이 아니라 누구에게나 생기는
// 중립적인 일이므로 실존·가상을 가리지 않는다. 구체적 사건은 engine/injury.ts의 이탈 이벤트에서만 생기고, 가상 선수에게만 붙는다.

import { Rng, type Absence, type SimPlayer, type World } from '../engine';
import { currentRuns, type ValueContext } from '../ai/value';
import { asSim, shiftForRuns, type CareerIndex } from './growth';
import type { LeaguePlayer, LeagueState, Military } from './types';

/** 복무 기간: 시즌이 끝나고 입대해 다음 시즌 전체를 빠지고, 그다음 시즌 이만큼(일정 일수) 뒤에 돌아온다 (상무 18개월 가정, 임시값) */
export const MILITARY_RETURN_DAY = 75;
/** 복귀 후 감각 저하 (런, 임시값). 잠재력은 그대로라 성장 판정에서 다시 회복한다 */
export const MILITARY_RUST = 3;
/** 이 나이(다음 시즌 기준)가 되면 반드시 입대한다 (임시값) */
export const MILITARY_LAST_AGE = 28;
/** 시작 때 이 나이 이상인 실존 국내 선수는 병역을 마친(또는 면제된) 것으로 본다 (임시 가정, 병역 자료 없음) */
export const MILITARY_ASSUME_DONE_AGE = 29;

const ageAt = (p: LeaguePlayer, year: number): number | null => (p.birthYear ? year - p.birthYear : null);

export function isServing(p: LeaguePlayer): boolean {
  return p.military?.state === 'serving';
}

/**
 * 시작 때의 병역 상태 (병역 자료가 없어 기록으로 가늠한다, 임시 가정):
 * - 외국인은 대상이 아니다.
 * - 가상 선수(신인)는 아직 복무하지 않았다.
 * - 실존 국내 선수는 29세 이상이면 마친 것으로, 그보다 어리면 19~28세에 1군 기록이 1~2시즌 비었다가 다시 나타난 적이 있으면
 *   그 공백을 복무로 보고 마친 것으로 본다. 그 밖에는 아직 복무하지 않은 것으로 본다.
 */
export function initialMilitary(p: Pick<LeaguePlayer, 'id' | 'foreign' | 'real' | 'birthYear'>, idx: CareerIndex | null, startYear: number): Military | undefined {
  if (p.foreign) return undefined;
  if (!p.real) return { state: 'pending' };
  const age = p.birthYear ? startYear - p.birthYear : null;
  if (age === null || age >= MILITARY_ASSUME_DONE_AGE) return { state: 'done' };
  if (idx) {
    const years = new Set<number>();
    for (const x of idx.bat.get(p.id) ?? []) if (x.year < startYear) years.add(x.year);
    for (const x of idx.pit.get(p.id) ?? []) if (x.year < startYear) years.add(x.year);
    const sorted = [...years].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1] - 1;
      const gapAge = sorted[i - 1] + 1 - p.birthYear!;
      if (gap >= 1 && gap <= 2 && gapAge >= 19 && gapAge <= 28) return { state: 'done' };
    }
  }
  return { state: 'pending' };
}

/** M5 저장처럼 병역 정보가 없는 리그: 국내 선수는 나이로만 정한다 (기록 공백은 보지 않는다) */
export function ensureMilitary(league: LeagueState): void {
  for (const p of league.players) if (!p.foreign && !p.military) p.military = initialMilitary(p, null, league.year);
}

// ---- 부상 후유증

export interface InjuryEffect {
  /** 잠재력 감소 (런) */
  potentialCut: number;
  /** 다음 시즌 능력 감소 (런) */
  runsDrop: number;
  /** 다음 시즌 개막부터 결장하는 일수 */
  carry: number;
}

/**
 * 한 시즌의 부상이 남기는 것 (임시값): 큰 부상은 잠재력 2~8런과 능력 1~4런, 장기 부상은 잠재력 0~2런을 깎는다.
 * 시즌이 끝난 뒤에도 남은 결장 기간이 오프시즌(offseasonDays)보다 길면 그만큼 다음 시즌 개막부터 결장한다.
 */
export function injuryEffect(list: Absence[], seasonDays: number, offseasonDays: number, rng: Rng): InjuryEffect {
  const e: InjuryEffect = { potentialCut: 0, runsDrop: 0, carry: 0 };
  for (const a of list) {
    if (a.kind === 'major') {
      e.potentialCut += rng.range(2, 8);
      e.runsDrop += rng.range(1, 4);
    } else if (a.kind === 'long') {
      e.potentialCut += rng.range(0, 2);
    }
    e.carry = Math.max(e.carry, a.until - seasonDays - offseasonDays);
  }
  return e;
}

// ---- 조기 노쇠와 슬럼프

/** 조기 노쇠: 27~32세(다음 시즌 기준)에 해마다 이 확률로 생긴다. 생기면 노화 판정 때 나이를 3살 더 먹은 것으로 본다 (임시값) */
export const EARLY_DECLINE_CHANCE = 0.02;
export const EARLY_DECLINE_YEARS = 3;
/** 슬럼프: 주전급(5런 이상) 선수가 다음 시즌 한 해 동안 4~10런 떨어질 확률 (임시값). 능력 자체(잠재력·성장)에는 남지 않는다 */
export const SLUMP_CHANCE = 0.05;
const SLUMP_MIN_RUNS = 5;

/** 결산 때 선수 한 명의 조기 노쇠·슬럼프 판정. 생긴 일을 돌려준다 */
export function rollForm(p: LeaguePlayer, nextRuns: number, ctx: ValueContext, nextYear: number, rng: Rng): { decline: boolean; slump: number } {
  const age = ageAt(p, nextYear);
  let decline = false;
  if (!p.decline && age !== null && age >= 27 && age <= 32 && rng.chance(EARLY_DECLINE_CHANCE)) {
    p.decline = EARLY_DECLINE_YEARS;
    p.potential = Math.min(p.potential, nextRuns);
    decline = true;
  }
  let slump = 0;
  // 난수 소비를 일정하게: 슬럼프 여부와 크기를 늘 뽑는다
  const hit = rng.chance(SLUMP_CHANCE);
  const size = rng.range(4, 10);
  if (hit && nextRuns >= SLUMP_MIN_RUNS) {
    p.slump = shiftForRuns(p, nextRuns - size, ctx, nextYear);
    slump = size;
  }
  return { decline, slump };
}

// ---- 은퇴

/**
 * 은퇴 확률 (임시값). 나이(다음 시즌 기준)가 기본이고, 기량이 좋으면 덜, 대체 선수 이하면 더 은퇴한다.
 * 다년 계약이 남은 선수는 덜 은퇴한다. 45세가 되면 모두 은퇴한다.
 */
export function retireChance(age: number | null, runs: number, contractLeft: number): number {
  if (age === null) age = 30;
  if (age >= 45) return 1;
  let p: number;
  if (age <= 32) p = age >= 30 && runs < -5 ? 0.15 : 0;
  else if (age <= 34) p = 0.08;
  else if (age <= 36) p = 0.18;
  else if (age <= 38) p = 0.35;
  else if (age <= 40) p = 0.55;
  else if (age <= 42) p = 0.75;
  else p = 0.9;
  if (runs >= 15) p *= 0.4;
  else if (runs >= 8) p *= 0.7;
  else if (runs < 0) p *= 1.8;
  if (contractLeft > 0) p *= 0.3;
  return Math.min(0.98, p);
}

// ---- 아시안게임 병역 면제

/** 아시안게임이 열리는 해 (4년마다). 2026년 대회 결과는 확인하지 못해 2030년부터 게임 안에서 치른다 */
export function isAsianGamesYear(year: number): boolean {
  return year >= 2030 && year % 4 === 2;
}
/** 금메달 확률 (임시값) */
export const ASIAN_GAMES_GOLD = 0.6;
/** 대표팀: 25세 이하 21명 + 나이 제한 없는 3명 (임시 규칙, 실제 선발 규정 미확인) */
const AG_YOUNG = 21;
const AG_WILDCARD = 3;
const AG_AGE_LIMIT = 25;

export interface CareerNews {
  team: number;
  text: string;
  /** 리그 전체에 알릴 만한 소식 */
  major: boolean;
}

/** 아시안게임 대표팀을 뽑고 결과를 정한다. 금메달이면 대표팀의 미필 선수가 면제된다 */
export function asianGames(league: LeagueState, year: number, runsOf: (p: LeaguePlayer) => number, rng: Rng): CareerNews[] {
  const pool = league.players.filter((p) => p.team >= 0 && !p.foreign && !isServing(p));
  const by = (a: LeaguePlayer, b: LeaguePlayer) => runsOf(b) - runsOf(a) || a.id.localeCompare(b.id);
  const young = pool.filter((p) => (ageAt(p, year) ?? 99) <= AG_AGE_LIMIT).sort(by).slice(0, AG_YOUNG);
  const ids = new Set(young.map((p) => p.id));
  const wild = pool.filter((p) => !ids.has(p.id)).sort(by).slice(0, AG_WILDCARD);
  const team = [...young, ...wild];
  const gold = rng.chance(ASIAN_GAMES_GOLD);
  const news: CareerNews[] = [{ team: -1, text: `${year} 아시안게임 야구 ${gold ? '금메달' : '금메달 실패'}. 대표팀 ${team.length}명`, major: true }];
  if (gold) {
    for (const p of team) {
      if (p.military?.state !== 'pending') continue;
      p.military = { state: 'exempt' };
      news.push({ team: p.team, text: `${p.name}: 아시안게임 금메달로 병역 면제`, major: false });
    }
  }
  return news;
}

// ---- 결산 단계

export interface CareerContext {
  league: LeagueState;
  /** 막 끝난 시즌 */
  year: number;
  /** 다음 시즌 기준 런 (성장 판정 뒤) */
  nextRuns: (p: LeaguePlayer) => number;
}

/** 은퇴 판정. 은퇴한 선수는 무소속이 되고 league.retired에 남는다 */
export function retirements(c: CareerContext): CareerNews[] {
  const { league, year } = c;
  const out: CareerNews[] = [];
  league.retired ??= [];
  for (const p of league.players) {
    if (p.team < 0 || p.foreign || isServing(p)) continue;
    const age = ageAt(p, year + 1);
    const runs = c.nextRuns(p);
    const chance = retireChance(age, runs, Math.max(0, p.contract.until - (year + 1)));
    const rng = new Rng(`${league.seed}/retire/${year}/${p.id}`);
    if (!rng.chance(chance)) continue;
    const team = p.team;
    league.retired.push({
      id: p.id, name: p.name, real: p.real, year, age: ageAt(p, year), team,
      reason: (age ?? 30) >= 33 ? 'age' : 'performance',
    });
    p.team = -1;
    out.push({ team, text: `${p.name} 은퇴 (${ageAt(p, year) ?? '?'}세, ${league.teams[team].name})`, major: runs >= 10 });
  }
  return out;
}

/** 병역: 복무를 마치는 선수의 복귀 준비, 새 입대 */
export function militaryStep(c: CareerContext, rust: (p: LeaguePlayer) => void): CareerNews[] {
  const { league, year } = c;
  const out: CareerNews[] = [];
  for (const p of league.players) {
    if (p.foreign || p.team < 0) continue;
    const m = p.military;
    if (!m) continue;
    if (m.state === 'serving') {
      if ((m.returnYear ?? 0) <= year + 1) {
        p.military = { state: 'done' };
        p.startAbsent = Math.max(p.startAbsent ?? 0, MILITARY_RETURN_DAY);
        p.startAbsentReason = 'military';
        rust(p);
        out.push({ team: p.team, text: `${p.name}: ${year + 1} 시즌 중 전역 예정 (개막 뒤 약 ${MILITARY_RETURN_DAY}일)`, major: false });
      }
      continue;
    }
    if (m.state !== 'pending') continue;
    const age = ageAt(p, year + 1);
    if (age === null) continue;
    let chance = 0;
    if (age >= MILITARY_LAST_AGE) chance = 1;
    else if (age >= 21) chance = 0.06 + (c.nextRuns(p) < 3 ? 0.15 : 0) + 0.05 * Math.max(0, age - 23);
    // 다년 계약 중인 선수는 마감 나이 전에는 미룬다
    if (chance < 1 && p.contract.until > year + 1) chance = 0;
    const rng = new Rng(`${league.seed}/military/${year}/${p.id}`);
    if (!rng.chance(chance)) continue;
    p.military = { state: 'serving', enlisted: year, returnYear: year + 2 };
    // 복무 중에는 계약이 끝나지 않게 (복귀 직전 오프시즌에 연봉 협상)
    p.contract = { ...p.contract, until: Math.max(p.contract.until, year + 1) };
    out.push({ team: p.team, text: `${p.name} 입대 (${age - 1}세, ${year + 2} 시즌 중 복귀 예정)`, major: false });
  }
  return out;
}

/** 복무 중인 선수의 SimPlayer (월드에 없으므로 가치 계산용으로 만든다) */
export function servingSim(p: LeaguePlayer, world: World): SimPlayer {
  return { ...asSim(p, world.league, world.year), name: p.name, teamIdx: p.team };
}

export function runsNow(p: LeaguePlayer, ctx: ValueContext, year: number): number {
  return currentRuns(asSim(p, ctx.world.league, year), ctx);
}
