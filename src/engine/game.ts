// 한 경기 시뮬레이션. 타석 단위로 결과를 뽑고 주자·아웃·득점을 진행한다.

import type { ParkRates, Rates } from '../data/types';
import type { EngineParams } from './params';
import type { Rng } from './rng';
import { defenseAt } from './defense';
import { assignSlots, currentFatigue, FATIGUE_AVAILABLE_BELOW, needsRest, type PlayerStates, type Slot, type TeamSeason } from './team';
import { fatigueScale, traitEdge, type Situation } from './traits';
import type { BatLine, LeagueEnv, PitLine, PitSkill, SimPlayer } from './types';

/** 시즌 전체 리그 합계 (검증용) */
export interface LeagueCounters {
  games: number;
  ties: number;
  extraInningGames: number;
  homeWins: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  hbp: number;
  so: number;
  r: number;
  er: number;
  outs: number;
  gdp: number;
  sf: number;
  sac: number;
  sb: number;
  cs: number;
  roe: number;
  outsOnBases: number;
  wildPitches: number;
}

export function emptyLeagueCounters(): LeagueCounters {
  return {
    games: 0, ties: 0, extraInningGames: 0, homeWins: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, hbp: 0, so: 0,
    r: 0, er: 0, outs: 0, gdp: 0, sf: 0, sac: 0, sb: 0, cs: 0, roe: 0, outsOnBases: 0, wildPitches: 0,
  };
}

export interface GameContext {
  league: Rates;
  env: LeagueEnv;
  /** 환경 맞춤 계수 (사건별). 타자 쪽 비율에 곱한다 */
  cal: Rates;
  params: EngineParams;
  maxInnings: number;
  day: number;
  rng: Rng;
  states: PlayerStates;
  bat: BatLine[];
  pit: PitLine[];
  totals: LeagueCounters;
  /** 포스트시즌 경기인가 (숨겨진 특수능력 '가을 사나이'용). 없으면 정규시즌 */
  postseason?: boolean;
  /** 선발 한계 배율 (시대별, eras.ts). 없으면 1 */
  startLimitScale?: number;
  /** 선수별 컨디션 (선수 색인, 무작위 이벤트 효과, league/events.ts). 타자는 +면 유리, 투수는 +면 투수가 유리. 없으면 0 */
  form?: Float64Array;
  /** 있으면 이 경기의 타석·주루·교체를 차례로 남긴다 (중계 화면). 난수를 더 쓰지 않아 결과는 같다 */
  plays?: Play[] | null;
  /** 직접 지휘 (경기 개입): 이 구단의 타석마다 지휘자에게 묻는다. 고른 것이 '자동'이면 AI 감독과 똑같이 진행한다 */
  command?: GameCommand | null;
  /** 수비수별 실책 수 (선수 색인). 없으면 남기지 않는다 */
  errors?: number[];
}

/** 직접 지휘하는 구단과 판단 함수 (game/session.ts가 조작 기록·미리보기로 채운다) */
export interface GameCommand {
  team: number;
  decide: (req: CommandRequest) => CommandChoice;
}

/** 지휘자에게 묻는 순간 (우리 공격 또는 우리 수비의 타석 직전) */
export interface CommandRequest {
  /** 이 경기에서 몇 번째 물음인가 (0부터) */
  n: number;
  side: 'bat' | 'field';
  /** run 주자 작전(투구 전: 대주자·도루), bat 타격 작전(도루 뒤: 대타·대주자·강공·번트), field 수비 */
  step: 'run' | 'bat' | 'field';
  inn: number;
  top: boolean;
  outs: number;
  bases: [number, number, number];
  away: number;
  home: number;
  batter: number;
  /** 다음 타자 (대타 판단용) */
  onDeck: number;
  pitcher: number;
  /** 지금 투수가 상대한 타자 수, 내준 점수 */
  pitcherBf: number;
  pitcherRuns: number;
  /** 우리 라인업 (타순) */
  lineup: number[];
  /** 우리 공격: 대타·대주자로 쓸 수 있는 선수 */
  bench: number[];
  /** 우리 수비: 지금 올릴 수 있는 구원 투수 */
  bullpen: number[];
  /** 지금까지의 중계 기록 */
  plays: Play[];
}

/**
 * 지휘 선택. 비우면 자동(AI 감독).
 * 주자 작전(run, 1루 주자가 있고 2루가 비었을 때만 묻는다): pr 대주자, steal go 도루 시도·hold 도루 안 함.
 * 타격 작전(bat, 도루가 끝난 뒤): ph 대타(지금 타자 대신), pr 대주자, tactic swing 강공(번트 없음)·bunt 희생번트.
 * 수비: pitcher 투수 교체, keep 지금 투수 유지(자동 교체 안 함), walk 고의4구.
 * (2026-10-12 사용자: 도루는 타석과 별개이고 도루 뒤에 번트도 할 수 있다 → 주자 작전과 타격 작전을 나눴다)
 */
export interface CommandChoice {
  ph?: number;
  pr?: { base: 0 | 1 | 2; idx: number };
  steal?: 'go' | 'hold';
  /** 'steal'은 예전 기록 호환 (도루 시도로 본다) */
  tactic?: 'swing' | 'steal' | 'bunt';
  pitcher?: number;
  keep?: boolean;
  walk?: boolean;
}

/** 지휘한 희생번트가 성공할 확률 (임시값) */
export const BUNT_SUCCESS = 0.85;

/**
 * 중계 기록 한 줄. SO 삼진, BB 볼넷, HBP 몸에 맞는 공, HR·3B·2B·1B 안타, E 실책 출루, GDP 병살, GO 땅볼 아웃, FO 뜬공 아웃,
 * SF 희생플라이, SAC 희생번트, SB 도루, CS 도루 실패, WP 폭투·포일·보크, PC 투수 교체, IBB 고의4구, BF 번트 실패, PH 대타, PR 대주자
 */
export type PlayKind = 'SO' | 'BB' | 'HBP' | 'HR' | '3B' | '2B' | '1B' | 'E' | 'GDP' | 'GO' | 'FO' | 'SF' | 'SAC' | 'SB' | 'CS' | 'WP' | 'PC' | 'IBB' | 'BF' | 'PH' | 'PR';

export interface Play {
  inn: number;
  /** 초(원정 공격) */
  top: boolean;
  kind: PlayKind;
  /** 타자 (도루는 주자, 투수 교체는 −1) */
  bat: number;
  /** 투수 (투수 교체는 새 투수) */
  pit: number;
  /** 플레이 뒤 아웃, 주자(1·2·3루 선수 색인, 없으면 −1), 점수 */
  outs: number;
  bases: [number, number, number];
  away: number;
  home: number;
  /** 이 플레이로 난 점수 */
  runs: number;
  /** 실책(E)을 한 수비수 (선수 색인) */
  fielder?: number;
}

interface PitcherInGame {
  p: SimPlayer;
  skill: PitSkill;
  line: PitLine;
  bf: number;
  runs: number;
  outs: number;
  limit: number;
  isStarter: boolean;
  /** 등판 시점의 점수 차 (자기 팀 기준) */
  enteredLead: number;
  /** 이 경기 자책점 (퀄리티 스타트 판정) */
  er: number;
  /** 이 등판에서 블론 세이브를 기록했나 */
  blown: boolean;
}

interface Runner {
  p: SimPlayer;
  resp: PitcherInGame;
  earned: boolean;
}

interface Side {
  ts: TeamSeason;
  lineup: SimPlayer[];
  spot: number;
  runs: number;
  pitcher: PitcherInGame;
  staff: PitcherInGame[];
  usedIdx: Set<number>;
  isHome: boolean;
  /** 라인업 가치의 중앙값 (희생번트를 누가 대는지 정할 때 쓴다) */
  medianValue: number;
  /** 수비 8명의 수비 런 합 (defense.ts) */
  def: number;
  /** 포수의 수비 런 */
  catcherDef: number;
  /** 실책 배율 (수비수별 실책률을 타구 몫으로 가중한 합, 평균 수비진 ≈ 1) */
  errMult: number;
  /** 실책이 났을 때 누가 했나 고르는 몫 (선수 색인, 타구 몫 × 실책률) */
  errBy: { idx: number; w: number }[];
  /** 교체로 빠진 선수 (다시 나올 수 없다) */
  removed: Set<number>;
  /** 지금 수비 위치 (선수 색인 → 자리). 대타·대주자는 바꾼 선수의 자리를 그대로 받는다 */
  slots: Map<number, Slot>;
  /** 경기 중 들어온 타자 (박스스코어: 타순 자리, 대타·대주자) */
  subs: GameSub[];
}

/** 경기 중 교체로 들어온 타자 (직접 지휘의 대타·대주자) */
export interface GameSub {
  idx: number;
  /** 타순 자리 (0~8) */
  order: number;
  kind: 'PH' | 'PR';
}

export interface GameResult {
  homeRuns: number;
  awayRuns: number;
  innings: number;
  /** 승리·패전·세이브 투수의 선수 색인 */
  win: number | null;
  loss: number | null;
  save: number | null;
  /** 이닝별 득점. 치르지 않은 말 공격은 -1 */
  lineScore: { away: number[]; home: number[] };
  /** 등판 순서대로 투수 색인 */
  homeStaff: number[];
  awayStaff: number[];
  /** 경기 중 들어온 대타·대주자 (들어온 순서) */
  homeSubs: GameSub[];
  awaySubs: GameSub[];
}

const enum Ev { SO, BB, HBP, HR, S1, D2, T3, OUT }

const clampRate = (x: number) => (x < 0.0005 ? 0.0005 : x > 0.6 ? 0.6 : x);

/** 승산비 결합: 타자 비율과 투수 비율을 리그 평균 기준으로 합친다 */
function combine(batRate: number, pitRate: number, lg: number): number {
  const b = clampRate(batRate);
  const p = clampRate(pitRate);
  const o = ((b / (1 - b)) * (p / (1 - p))) / (lg / (1 - lg));
  return o / (1 + o);
}

const STARTER_LIMIT_SCALE = 1.08;
/** 어제 던진 필승조를 오늘 아낄 확률 (임시값, 상위 구원 투수 시즌 등판 80경기 안팎에 맞춤) */
const SPARE_YESTERDAY = 0.4;

function enterPitcher(p: SimPlayer, isStarter: boolean, lead: number, ctx: GameContext): PitcherInGame {
  const skill = p.pit!;
  const line = ctx.pit[p.idx];
  line.g++;
  if (isStarter) line.gs++;
  // 선발 한계는 기록으로 추정한 체력보다 조금 길게 (체력 추정이 평균 쪽으로 당겨져 있어 실제 선발 타자 수 23.4명에 맞춤, 임시값)
  const base = isStarter ? skill.stamina * STARTER_LIMIT_SCALE * (ctx.startLimitScale ?? 1) : skill.reliefStint;
  return { p, skill, line, bf: 0, runs: 0, outs: 0, limit: base * ctx.rng.range(0.82, 1.18), isStarter, enteredLead: lead, er: 0, blown: false };
}

/** 직접 정한 롱릴리프가 이른 이닝에 나왔을 때 한계 타자 수 배율 (임시값) */
const LONG_RELIEF_STRETCH = 1.6;

/** 쓸 수 있는 구원 투수: 이번 경기에 안 나왔고, 쉴 만큼 쉬었고, 3연투가 아닌 투수 */
function availableRelievers(fld: Side, ctx: GameContext): SimPlayer[] {
  const st = ctx.states;
  return fld.ts.bullpen.filter((p) => !fld.usedIdx.has(p.idx)
    && currentFatigue(st, p.idx, ctx.day) < FATIGUE_AVAILABLE_BELOW && !needsRest(st, p.idx, ctx.day));
}

/**
 * 구원 투수 고르기 (2026-10-08 사용자 지적 "투수 교체가 비현실적"으로 다시 짬).
 * 역할: 마무리, 필승조(SU), 추격조(역할 없음), 롱릴리프(LR), 패전조(MOP).
 * 플레이어가 기용표에서 불펜 역할을 정했으면 그대로(2026-10-12), 아니면 불펜을 좋은 순으로 줄 세워
 * 좋은 순 1·2번째를 필승조(8회·7회 셋업), 나머지를 추격조로 본다 (롱릴리프는 그중 가장 길게 던지는 투수).
 * 역할 나누기와 점수 차 기준은 임시값.
 */
/**
 * 불펜 서열 (2026-10-22, docs/하드힛_현실감_기획안.md 2.1). 개막에는 지난 시즌 실제 쓰임 순(penTrust 큰 순, 쓰임을 모르는 투수는 그 뒤에 능력 순),
 * blendDays가 지나면 능력 순. 그 사이는 두 순위를 날짜 비율로 섞는다. 난수를 쓰지 않는다
 */
export function bullpenOrder(pen: SimPlayer[], day: number, blendDays: number): SimPlayer[] {
  const byValue = [...pen].sort((a, b) => a.value - b.value);
  const w = blendDays > 0 ? Math.min(1, Math.max(0, day / blendDays)) : 1;
  if (w >= 1 || !pen.some((p) => p.penTrust)) return byValue;
  const byTrust = [...byValue].sort((a, b) => (b.penTrust ?? 0) - (a.penTrust ?? 0));
  const key = new Map(pen.map((p) => [p, (1 - w) * byTrust.indexOf(p) + w * byValue.indexOf(p)]));
  return byValue.sort((a, b) => key.get(a)! - key.get(b)! || a.value - b.value);
}

function pickReliever(fld: Side, lead: number, inning: number, ctx: GameContext): SimPlayer | null {
  const { ts } = fld;
  const st = ctx.states;
  const pool = availableRelievers(fld, ctx);
  if (pool.length === 0) {
    // 쉴 만큼 쉰 투수가 없으면 덜 지친 투수부터 (3연투는 마지막까지 미룬다)
    const rest = ts.bullpen.filter((p) => !fld.usedIdx.has(p.idx));
    if (rest.length === 0) return null;
    const cost = (p: SimPlayer) => currentFatigue(st, p.idx, ctx.day) + (needsRest(st, p.idx, ctx.day) ? 100 : 0);
    return rest.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  }
  const closer = ts.closer;
  const closerOk = !!closer && pool.includes(closer);
  // 마무리: 9회 이후 3점 차 이내 리드, 또는 9회 이후 동점(홈은 끝내기를 기다리며, 원정은 연장)
  if (closerOk && inning >= 9 && lead >= 0 && lead <= 3) return closer;
  // 불펜 서열 (마무리는 빼고): 능력 순(value가 낮을수록 좋다)과 지난 시즌 실제 쓰임 순(penTrust)을 날짜에 따라 섞는다
  const order = bullpenOrder(ts.bullpen.filter((p) => p !== closer), ctx.day, ctx.params.penBlendDays);
  const avail = order.filter((p) => pool.includes(p));
  if (avail.length === 0) return closerOk ? closer : null;
  const rank = (p: SimPlayer) => order.indexOf(p);
  // 역할: 직접 정한 기용표에 있으면 그것. 역할을 하나라도 정했으면 나머지는 추격조, 아무것도 안 정했으면 서열 1·2번째가 필승조
  const pen = ts.manual && ts.plan?.pen && Object.keys(ts.plan.pen).length ? ts.plan.pen : null;
  const role = (p: SimPlayer): 'SU' | 'LR' | 'MOP' | 'MR' => (pen ? pen[p.idx] ?? 'MR' : rank(p) < 2 ? 'SU' : 'MR');
  const of = (...rs: string[]) => avail.filter((p) => rs.includes(role(p)));
  const close = lead >= -2 && lead <= 3; // 이기고 있거나 근소하게 지는 접전
  const late = inning >= 7;
  if (late && close && lead >= 0) {
    // 필승조: 8회 이후는 1번 셋업, 7회는 2번 셋업부터. 필승조가 다 지쳤으면 추격조 → 롱릴리프 → 패전조
    // 필승조 안의 순서는 지친 투수까지 포함한 서열 (7회에 1번 셋업이 지쳐 있어도 2번 셋업부터 쓰는 것은 같다)
    const suAll = order.filter((p) => role(p) === 'SU');
    const want = inning >= 8 ? 0 : 1;
    const su = of('SU');
    const main = [...su.filter((p) => suAll.indexOf(p) >= want), ...of('MR'), ...of('LR'), ...of('MOP')];
    const list = main.length ? main : su;
    // 어제 던졌으면 확률적으로 아끼고 다음 투수를 쓴다
    const pick = list.find((p) => st.fatigueDay[p.idx] !== ctx.day - 1 || !ctx.rng.chance(SPARE_YESTERDAY));
    return pick ?? list[0];
  }
  if (late && close) {
    // 근소하게 지는 후반: 필승조는 아끼고 추격조부터
    return of('MR')[0] ?? of('LR')[0] ?? of('MOP')[0] ?? avail[avail.length - 1];
  }
  if (inning <= 5) {
    // 이른 강판: 롱릴리프. 정하지 않았으면 필승조를 뺀 투수 중 가장 길게 던질 투수
    const lr = of('LR');
    const cands = lr.length ? lr : of('MR', 'MOP').length ? of('MR', 'MOP') : avail;
    return cands.reduce((a, b) => (b.pit!.reliefStint > a.pit!.reliefStint ? b : a));
  }
  // 점수 차가 큰 경기나 중반: 패전조. 정하지 않았으면 필승조를 빼고 아래쪽에서 고른다
  const mop = of('MOP');
  const cands = mop.length ? mop : of('MR', 'LR').length ? of('MR', 'LR') : avail;
  return cands[ctx.rng.int(cands.length)];
}

/**
 * 투수 교체 판단. 타석마다 부르지만, 감독처럼 이닝 시작에 바꾸는 것이 기본이다.
 * 이닝 중간에는 한계를 크게 넘었거나 이번 이닝에 무너질 때만 바꾼다. 기준값은 임시값 (실제 2025 KBO의 선발 이닝·구원 이닝에 맞춤).
 * start: 반 이닝의 첫 타석. halfRuns: 이번 반 이닝에 내준 점수
 */
function maybeChangePitcher(fld: Side, bat: Side, inning: number, basesEmpty: boolean, start: boolean, halfRuns: number, ctx: GameContext): void {
  const pg = fld.pitcher;
  const lead = fld.runs - bat.runs;
  const closer = fld.ts.closer;
  let pull = false;
  if (pg.isStarter) {
    if (start) {
      // 이닝 시작: 한 이닝을 더 못 버티거나, 이미 많이 내줬으면 내린다
      pull = pg.bf + 2 >= pg.limit || pg.runs >= 6 || (pg.runs >= 5 && inning <= 4);
    } else {
      pull = pg.bf >= pg.limit + 4 // 한계를 크게 넘김
        || (pg.bf >= pg.limit && !basesEmpty) // 한계를 넘긴 뒤 주자를 내보냄
        || pg.runs >= 7
        || (halfRuns >= 3 && !basesEmpty && (pg.runs >= 4 || pg.bf >= pg.limit - 3)) // 이번 이닝 무너짐
        || (pg.runs >= 5 && inning <= 3 && !basesEmpty); // 초반 대량 실점
    }
  } else if (pg.p === closer) {
    // 마무리는 경기를 끝내게 둔다. 크게 흔들릴 때만
    pull = !start && (pg.runs >= 3 || pg.bf >= pg.limit + 4);
  } else if (start) {
    // 구원: 다음 이닝(타자 약 4명)을 맡기에 모자라면 이닝 시작에 바꾼다
    pull = pg.bf + 3 >= pg.limit || pg.runs >= 3;
  } else {
    pull = pg.runs >= 3 || pg.bf >= pg.limit + 3 || (halfRuns >= 2 && !basesEmpty && Math.abs(lead) <= 2 && inning >= 7);
  }
  // 9회 세이브 상황에서 마무리가 쉬었으면 이닝 시작에 마무리로
  if (!pull && start && inning >= 9 && lead >= 1 && lead <= 3 && closer && pg.p !== closer && availableRelievers(fld, ctx).includes(closer)) pull = true;
  if (!pull) return;
  const next = pickReliever(fld, lead, inning, ctx);
  if (!next) return;
  fld.usedIdx.add(next.idx);
  fld.pitcher = enterPitcher(next, false, lead, ctx);
  // 직접 정한 롱릴리프가 이른 이닝에 나오면 평소보다 길게 맡긴다 (임시값). AI 감독 배치에는 쓰지 않는다
  if (inning <= 6 && fld.ts.manual && fld.ts.plan?.pen?.[next.idx] === 'LR') fld.pitcher.limit *= LONG_RELIEF_STRETCH;
  fld.staff.push(fld.pitcher);
}

function platoonEdge(b: SimPlayer, p: SimPlayer, size: number): number {
  if (!b.bats || !p.throws) return 0;
  if (b.bats === 'S') return size;
  return b.bats === p.throws ? -size : size;
}

/** 선발 라인업의 수비 위치 (선수 색인 → 자리) */
function fieldSlots(ts: TeamSeason, lineup: SimPlayer[]): Map<number, Slot> {
  const slots = ts.field && lineup.every((p) => ts.field!.has(p.idx))
    ? lineup.map((p) => ({ p, slot: ts.field!.get(p.idx)! }))
    : assignSlots(lineup);
  return new Map(slots.map(({ p, slot }) => [p.idx, slot]));
}

/**
 * 실책 날 타구가 그 자리로 가는 몫 (실책 출루 기준, 임시값): 내야 땅볼·송구가 대부분, 1루는 송구를 받는 쪽이라 적다.
 * 2026-10-13 사용자 "수비 능력치에 따른 실책 비율": 전에는 팀 수비 합으로만 실책 출루 확률을 줄였다
 */
const ERROR_SHARE: Partial<Record<Slot, number>> = { SS: 0.2, '3B': 0.17, '2B': 0.17, '1B': 0.12, C: 0.04, LF: 0.1, CF: 0.1, RF: 0.1 };
/** 수비 1런당 실책률 변화 (지수, 임시값): +10런이면 0.64배, −10런이면 1.57배 (실제 리그 정상급 유격수 한 해 실책 10개 안팎 ↔ 약한 수비 20개 넘음) */
const ERROR_PER_RUN = 0.045;
export const errorRateOf = (runs: number) => Math.min(2.5, Math.max(0.4, Math.exp(-ERROR_PER_RUN * runs)));
/** 리그 실책 수를 예전(팀 수비 합 방식)과 같게 맞추는 배율 (2025 두 시드로 잼: 수비수별로 바꾸니 약 8% 많았다) */
const ERROR_NORM = 0.93;

/** 수비 배치에서 팀 수비 런, 포수 수비 런, 실책 배율 */
function fieldDefense(lineup: SimPlayer[], slots: Map<number, Slot>): { def: number; catcherDef: number; errMult: number; errBy: { idx: number; w: number }[] } {
  let def = 0;
  let catcherDef = 0;
  let errMult = 0;
  const errBy: { idx: number; w: number }[] = [];
  for (const p of lineup) {
    const slot = slots.get(p.idx);
    if (!slot) continue;
    const r = defenseAt(p, slot);
    def += r;
    if (slot === 'C') catcherDef = r;
    const share = ERROR_SHARE[slot] ?? 0;
    if (share > 0) {
      const w = share * errorRateOf(r);
      errMult += w;
      errBy.push({ idx: p.idx, w });
    }
  }
  return { def, catcherDef, errMult: (errMult || 1) * ERROR_NORM, errBy };
}

/**
 * 대타·대주자: 타순 order 자리의 선수를 바꾼다. 들어온 선수는 나간 선수의 수비 자리를 맡고(포수 자리에 포수가 아니면 수비력이 떨어진다),
 * 다음 수비부터 팀 수비력에 반영된다 (2026-10-12 직접 지휘 마무리)
 */
function substitute(side: Side, order: number, inP: SimPlayer, kind: 'PH' | 'PR'): void {
  const outP = side.lineup[order];
  const slot = side.slots.get(outP.idx);
  side.lineup[order] = inP;
  side.removed.add(outP.idx);
  side.slots.delete(outP.idx);
  if (slot) side.slots.set(inP.idx, slot);
  Object.assign(side, fieldDefense(side.lineup, side.slots));
  side.subs.push({ idx: inP.idx, order, kind });
}

/** 주자·이닝·점수 상황 (숨겨진 특수능력 판정용) */
type PaState = Pick<Situation, 'runnersOn' | 'scoring' | 'late'>;
const NO_STATE: PaState = { runnersOn: false, scoring: false, late: false };

/** fieldDef: 수비하는 팀의 수비 런 합. 좋을수록 인플레이 안타가 아웃이 된다 */
type GamePark = ParkRates & { L?: ParkRates; R?: ParkRates };
const NEUTRAL_PARK: GamePark = { s1: 1, d2: 1, t3: 1, hr: 1 };

function samplePlateAppearance(b: SimPlayer, pg: PitcherInGame, batIsHome: boolean, ctx: GameContext, fieldDef = 0, state: PaState = NO_STATE, park = NEUTRAL_PARK): Ev {
  const { league: lg, cal, params } = ctx;
  const bs = b.bat!;
  const ps = pg.skill;
  // 타자에게 유리한 정도: 좌우 상성 + 홈 이점 + 숨겨진 특수능력 (둘 다 없으면 0)
  const edge = platoonEdge(b, pg.p, params.platoon) + (batIsHome ? params.homeEdge : -params.homeEdge)
    + (b.traits || pg.p.traits ? traitEdge(b, pg.p, { ...state, postseason: !!ctx.postseason, home: batIsHome }, params.traits) : 0)
    + (ctx.form ? ctx.form[b.idx] - ctx.form[pg.p.idx] : 0);
  // 투수 피로: 한계를 넘긴 타자 수에 비례
  const over = pg.bf - pg.limit;
  const fat = over > 0 ? Math.min(0.3, over * params.fatiguePerBatter * fatigueScale(pg.p, params.traits)) : 0;
  const up = 1 + edge;
  const down = 1 - edge;
  const worse = 1 + fat;

  const pSo = combine(bs.so * cal.so * lg.so * down, ps.so * lg.so * (1 - fat), lg.so);
  const pBb = combine(bs.bb * cal.bb * lg.bb * up, ps.bb * lg.bb * worse, lg.bb);
  const pHbp = combine(bs.hbp * cal.hbp * lg.hbp, ps.hbp * lg.hbp, lg.hbp);
  // 홈 구장 효과 (실제 구장 계수 meta.parkFactors + 게임 안에서 지은 신구장의 홈런 배율, league/stadium.ts): 양 팀 타자 모두에게
  // 치는 손별 구장 표: 좌타 L, 우타 R, 양타는 상대 투수 손의 반대쪽, 모르면 전체
  const side = b.bats === 'S' ? (pg.p.throws === 'L' ? 'R' : pg.p.throws === 'R' ? 'L' : null) : b.bats === 'L' || b.bats === 'R' ? b.bats : null;
  const pk: ParkRates = (side && park[side]) || park;
  const pHr = combine(bs.hr * cal.hr * lg.hr * up * pk.hr, ps.hr * lg.hr * worse, lg.hr);
  const hitP = ps.hit * worse * Math.max(0.5, 1 - fieldDef * params.defenseHitPerRun);
  const pS1 = combine(bs.s1 * cal.s1 * lg.s1 * up * pk.s1, hitP * lg.s1, lg.s1);
  const pD2 = combine(bs.d2 * cal.d2 * lg.d2 * up * pk.d2, hitP * lg.d2, lg.d2);
  const pT3 = combine(bs.t3 * cal.t3 * lg.t3 * up * pk.t3, hitP * lg.t3, lg.t3);

  const sum = pSo + pBb + pHbp + pHr + pS1 + pD2 + pT3;
  const scale = sum > 0.93 ? 0.93 / sum : 1;
  let u = ctx.rng.next() / scale;
  if ((u -= pSo) < 0) return Ev.SO;
  if ((u -= pBb) < 0) return Ev.BB;
  if ((u -= pHbp) < 0) return Ev.HBP;
  if ((u -= pHr) < 0) return Ev.HR;
  if ((u -= pS1) < 0) return Ev.S1;
  if ((u -= pD2) < 0) return Ev.D2;
  if ((u -= pT3) < 0) return Ev.T3;
  return Ev.OUT;
}

export function simulateGame(homeTs: TeamSeason, awayTs: TeamSeason, homeLineup: SimPlayer[], awayLineup: SimPlayer[],
                             homeStarter: SimPlayer, awayStarter: SimPlayer, ctx: GameContext): GameResult {
  const { params, rng, totals } = ctx;
  if (homeLineup.length !== 9 || awayLineup.length !== 9) {
    throw new Error(`라인업은 9명이어야 합니다 (홈 ${homeLineup.length}명, 원정 ${awayLineup.length}명)`);
  }
  const mkSide = (ts: TeamSeason, lineup: SimPlayer[], starter: SimPlayer, isHome: boolean): Side => {
    const pitcher = enterPitcher(starter, true, 0, ctx);
    // 감독 작전: 선발을 일찍(작으면)·늦게 바꾸는 정도 (league/managers.ts). 난수를 더 쓰지 않는다
    if (ts.tactics) pitcher.limit *= ts.tactics.hook;
    for (const p of lineup) ctx.bat[p.idx].g++;
    const vals = lineup.map((p) => p.value).sort((a, b) => a - b);
    const medianValue = vals[vals.length >> 1] ?? 0;
    const slots = fieldSlots(ts, lineup);
    const fd = fieldDefense(lineup, slots);
    return { ts, lineup: [...lineup], spot: 0, runs: 0, pitcher, staff: [pitcher], usedIdx: new Set([starter.idx]), isHome, medianValue, ...fd, removed: new Set(), slots, subs: [] };
  };
  const home = mkSide(homeTs, homeLineup, homeStarter, true);
  // 홈 구장 사건별 배율: 실제 구장 표가 있으면 그 배율(meta.parkEvents, 좌타·우타 포함), 없으면 득점 계수 f를 지수로 나눈다.
  // 게임 안에서 지은 신구장의 홈런 배율(hr)은 곱한다
  const tp = homeTs.team.park;
  const run = tp?.run ?? 1;
  const hit = run ** ctx.params.park.hitExp;
  const withHr = (x: ParkRates | undefined): ParkRates | undefined => x && { s1: x.s1, d2: x.d2, t3: x.t3, hr: tp!.hr * x.hr };
  const park: GamePark = !tp ? NEUTRAL_PARK
    : tp.ev ? { ...withHr(tp.ev)!, L: withHr(tp.ev.L), R: withHr(tp.ev.R) }
    : { s1: hit, d2: hit, t3: hit, hr: tp.hr * run ** ctx.params.park.hrExp };
  const away = mkSide(awayTs, awayLineup, awayStarter, false);

  // 승리·패전 후보: 리드를 잡은 시점의 투수와 그 점수를 내준 투수. 동점이 되면 지운다
  const rec: { win: PitcherInGame | null; loss: PitcherInGame | null; leader: Side | null } = { win: null, loss: null, leader: null };
  // 2아웃에서 실책이 나오면 그 이닝의 이후 실점은 비자책
  let halfUnearned = false;
  // 직접 지휘 물음 번호
  let cmdN = 0;

  const score = (bat: Side, fld: Side, runner: Runner, batterLine: BatLine | null) => {
    const before = bat.runs - fld.runs;
    bat.runs++;
    totals.r++;
    ctx.bat[runner.p.idx].r++;
    if (batterLine) batterLine.rbi++;
    runner.resp.runs++;
    runner.resp.line.r++;
    if (runner.earned && !halfUnearned && !rng.chance(ctx.env.unearnedRun)) {
      runner.resp.line.er++;
      runner.resp.er++;
      totals.er++;
    }
    const after = before + 1;
    // 블론 세이브: 세이브 상황(1~3점 리드)에 나온 구원 투수가 마운드에 있을 때 리드가 사라지면. 승리 투수가 될 수는 있다
    const cur = fld.pitcher;
    if (before === -1 && !cur.isStarter && !cur.blown && cur.enteredLead >= 1 && cur.enteredLead <= 3) {
      cur.blown = true;
      cur.line.bsv++;
    }
    if (before <= 0 && after > 0) {
      rec.win = bat.pitcher;
      rec.loss = runner.resp;
      rec.leader = bat;
    } else if (after === 0) {
      rec.win = null;
      rec.loss = null;
      rec.leader = null;
    }
  };

  /** 공격 반 이닝. 끝내기면 true */
  const playHalf = (bat: Side, fld: Side, inning: number): boolean => {
    let outs = 0;
    let first = true;
    const runsAtStart = bat.runs;
    halfUnearned = false;
    const bases: (Runner | null)[] = [null, null, null];
    const walkOff = () => bat.isHome && inning >= 9 && bat.runs > fld.runs;
    const out = (n: number) => {
      outs += n;
      fld.pitcher.outs += n;
      fld.pitcher.line.outs += n;
      totals.outs += n;
    };
    const plays = ctx.plays;
    let errFielder = -1;
    const note = (kind: PlayKind, who: number, pit: number, r0: number) => {
      plays?.push({
        inn: inning, top: !bat.isHome, kind, bat: who, pit, outs: Math.min(3, outs),
        bases: [bases[0]?.p.idx ?? -1, bases[1]?.p.idx ?? -1, bases[2]?.p.idx ?? -1], away: away.runs, home: home.runs, runs: bat.runs - r0,
        ...(kind === 'E' && errFielder >= 0 ? { fielder: errFielder } : {}),
      });
    };

    const cmd = ctx.command;
    const ask = (side: 'bat' | 'field', step: 'run' | 'bat' | 'field' = side): CommandChoice => cmd!.decide({
      n: cmdN++, side, step, inn: inning, top: !bat.isHome, outs, bases: [bases[0]?.p.idx ?? -1, bases[1]?.p.idx ?? -1, bases[2]?.p.idx ?? -1],
      away: away.runs, home: home.runs, batter: bat.lineup[bat.spot].idx, onDeck: bat.lineup[(bat.spot + 1) % 9].idx,
      pitcher: fld.pitcher.p.idx, pitcherBf: fld.pitcher.bf, pitcherRuns: fld.pitcher.runs,
      lineup: (side === 'bat' ? bat : fld).lineup.map((p) => p.idx),
      bench: side === 'bat' ? bat.ts.hitters.filter((p) => !bat.lineup.includes(p) && !bat.removed.has(p.idx)).map((p) => p.idx) : [],
      bullpen: side === 'field' ? availableRelievers(fld, ctx).map((p) => p.idx) : [],
      plays: plays ? plays.slice() : [],
    });

    while (outs < 3) {
      // 직접 지휘: 우리 수비면 투수 교체·유지·고의4구, 우리 공격이면 대타·대주자·작전
      const fc = cmd && fld.ts.team.idx === cmd.team ? ask('field') : null;
      const was = fld.pitcher;
      const next = fc?.pitcher !== undefined ? availableRelievers(fld, ctx).find((p) => p.idx === fc.pitcher) : undefined;
      if (next) {
        fld.usedIdx.add(next.idx);
        fld.pitcher = enterPitcher(next, false, fld.runs - bat.runs, ctx);
        fld.staff.push(fld.pitcher);
      } else if (!fc?.keep) {
        maybeChangePitcher(fld, bat, inning, !bases[0] && !bases[1] && !bases[2], first, bat.runs - runsAtStart, ctx);
      }
      if (plays && fld.pitcher !== was) note('PC', -1, fld.pitcher.p.idx, bat.runs);
      first = false;
      const pg = fld.pitcher;
      const ours = !!cmd && bat.ts.team.idx === cmd.team;
      const bench = (idx: number | undefined) => (idx === undefined ? undefined
        : bat.ts.hitters.find((p) => p.idx === idx && !bat.lineup.includes(p) && !bat.removed.has(p.idx)));
      const pinchRun = (c: CommandChoice | null) => {
        const runnerIn = bench(c?.pr?.idx);
        const old = c?.pr ? bases[c.pr.base] : null;
        if (!runnerIn || !old) return;
        const slot = bat.lineup.indexOf(old.p);
        if (slot >= 0) substitute(bat, slot, runnerIn, 'PR');
        else bat.removed.add(old.p.idx);
        bases[c!.pr!.base] = { p: runnerIn, resp: old.resp, earned: old.earned };
        ctx.bat[runnerIn.idx].g++;
        note('PR', runnerIn.idx, pg.p.idx, bat.runs);
      };

      // 주자 작전 (투구 전, 도루할 수 있을 때만): 대주자, 도루
      const rc = ours && bases[0] && !bases[1] ? ask('bat', 'run') : null;
      pinchRun(rc);
      const steal = rc?.steal ?? (rc?.tactic === 'steal' ? 'go' : undefined);

      // 도루: 1루 주자, 2루가 비었을 때 (지휘: go면 반드시, hold면 안 한다, 아니면 감독 판단)
      const r1 = bases[0];
      if (r1 && !bases[1] && (steal === 'go' || (steal === undefined && rng.chance(r1.p.bat!.sbAtt * params.stealScale * (bat.ts.tactics?.steal ?? 1))))) {
        const line = ctx.bat[r1.p.idx];
        if (rng.chance(r1.p.bat!.sbPct - fld.catcherDef * params.catcherStealPerRun)) {
          line.sb++;
          totals.sb++;
          bases[1] = r1;
          bases[0] = null;
          note('SB', r1.p.idx, pg.p.idx, bat.runs);
        } else {
          line.cs++;
          totals.cs++;
          bases[0] = null;
          out(1);
          note('CS', r1.p.idx, pg.p.idx, bat.runs);
          if (outs >= 3) break;
        }
      }

      // 폭투·포일·보크: 주자 전원 한 베이스씩
      if ((bases[0] || bases[1] || bases[2]) && rng.chance(ctx.env.wildPitch * Math.max(0.3, 1 - fld.catcherDef * params.catcherWildPitchPerRun))) {
        totals.wildPitches++;
        const r0 = bat.runs;
        if (bases[2]) { score(bat, fld, bases[2], null); bases[2] = null; }
        if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
        if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
        note('WP', -1, pg.p.idx, r0);
        if (walkOff()) return true;
      }

      // 타격 작전 (도루가 끝난 뒤): 대타, 대주자, 강공·번트
      const bc = ours ? ask('bat', 'bat') : null;
      pinchRun(bc);
      const hitter = bench(bc?.ph);
      if (hitter) {
        substitute(bat, bat.spot, hitter, 'PH');
        ctx.bat[hitter.idx].g++;
        note('PH', hitter.idx, pg.p.idx, bat.runs);
      }
      const tactic = bc?.tactic === 'steal' ? undefined : bc?.tactic;

      const batter = bat.lineup[bat.spot];
      bat.spot = (bat.spot + 1) % 9;
      const bl = ctx.bat[batter.idx];
      bl.pa++;
      totals.pa++;
      pg.bf++;
      pg.line.bf++;

      // 지휘한 희생번트: 2아웃 전, 주자가 있을 때. 실패하면 타자만 아웃
      if (tactic === 'bunt' && outs < 2 && (bases[0] || bases[1] || bases[2]) && !fc?.walk) {
        if (rng.chance(BUNT_SUCCESS)) {
          bl.sac++;
          totals.sac++;
          out(1);
          const r0 = bat.runs;
          if (bases[2] && outs < 3) { score(bat, fld, bases[2], bl); bases[2] = null; }
          if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
          if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
          note('SAC', batter.idx, pg.p.idx, r0);
          if (walkOff()) return true;
        } else {
          bl.ab++; totals.ab++;
          out(1);
          note('BF', batter.idx, pg.p.idx, bat.runs);
        }
        continue;
      }
      // 희생번트: 무사, 주자 1루 또는 2루, 3루는 비었을 때. 약한 타자가 주로 댄다
      if (!tactic && !fc?.walk && outs === 0 && !bases[2] && (bases[0] || bases[1]) && ctx.env.sac > 0) {
        const weak = batter.value < bat.medianValue ? 1.6 : 0.4;
        if (rng.chance(ctx.env.sac * params.sacBuntScale * weak * (bat.ts.tactics?.bunt ?? 1))) {
          bl.sac++;
          totals.sac++;
          out(1);
          if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
          if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
          note('SAC', batter.idx, pg.p.idx, bat.runs);
          continue;
        }
      }
      const ev = fc?.walk ? Ev.BB : samplePlateAppearance(batter, pg, bat.isHome, ctx, fld.def, {
        runnersOn: !!(bases[0] || bases[1] || bases[2]), scoring: !!(bases[1] || bases[2]), late: inning >= 7 && Math.abs(bat.runs - fld.runs) <= 2,
      }, park);
      const me: Runner = { p: batter, resp: pg, earned: true };
      const r0 = bat.runs;
      let kind: PlayKind = ev === Ev.SO ? 'SO' : ev === Ev.BB ? (fc?.walk ? 'IBB' : 'BB') : ev === Ev.HBP ? 'HBP' : ev === Ev.HR ? 'HR' : ev === Ev.T3 ? '3B' : ev === Ev.D2 ? '2B' : ev === Ev.S1 ? '1B' : 'GO';
      const speedAdj = (r: Runner) => (r.p.bat!.speed - 0.5) * 0.3;
      const twoOut = outs === 2 ? params.twoOutBonus : 0;
      /** 추가 진루 시도: 성공이면 true, 주루사면 아웃을 올리고 false */
      const tryAdvance = (): boolean => {
        if (!rng.chance(params.outOnAdvance)) return true;
        totals.outsOnBases++;
        out(1);
        return false;
      };

      switch (ev) {
        case Ev.SO:
          bl.ab++; bl.so++; pg.line.so++; totals.ab++; totals.so++;
          out(1);
          break;
        case Ev.BB:
        case Ev.HBP: {
          if (ev === Ev.BB) { bl.bb++; pg.line.bb++; totals.bb++; } else { bl.hbp++; pg.line.hbp++; totals.hbp++; }
          if (bases[0]) {
            if (bases[1]) {
              if (bases[2]) score(bat, fld, bases[2], bl);
              bases[2] = bases[1];
            }
            bases[1] = bases[0];
          }
          bases[0] = me;
          break;
        }
        case Ev.HR:
          bl.ab++; bl.h++; bl.hr++; pg.line.h++; pg.line.hr++; totals.ab++; totals.h++; totals.hr++;
          for (let i = 2; i >= 0; i--) {
            const r = bases[i];
            if (r) score(bat, fld, r, bl);
            bases[i] = null;
          }
          score(bat, fld, me, bl);
          break;
        case Ev.T3:
          bl.ab++; bl.h++; bl.t++; pg.line.h++; totals.ab++; totals.h++; totals.t++;
          for (let i = 2; i >= 0; i--) {
            const r = bases[i];
            if (r) score(bat, fld, r, bl);
            bases[i] = null;
          }
          bases[2] = me;
          break;
        case Ev.D2: {
          bl.ab++; bl.h++; bl.d++; pg.line.h++; totals.ab++; totals.h++; totals.d++;
          if (bases[2]) { score(bat, fld, bases[2], bl); bases[2] = null; }
          if (bases[1]) { score(bat, fld, bases[1], bl); bases[1] = null; }
          const f = bases[0];
          if (f) {
            bases[0] = null;
            if (rng.chance(params.firstToHomeOnDouble + twoOut + speedAdj(f))) {
              if (tryAdvance()) score(bat, fld, f, bl);
            } else bases[2] = f;
          }
          bases[1] = me;
          break;
        }
        case Ev.S1: {
          bl.ab++; bl.h++; pg.line.h++; totals.ab++; totals.h++;
          if (bases[2]) { score(bat, fld, bases[2], bl); bases[2] = null; }
          const s = bases[1];
          if (s) {
            bases[1] = null;
            if (rng.chance(params.secondToHomeOnSingle + twoOut + speedAdj(s))) {
              if (tryAdvance()) score(bat, fld, s, bl);
            } else bases[2] = s;
          }
          const f = bases[0];
          if (f) {
            bases[0] = null;
            if (!bases[2] && outs < 3 && rng.chance(params.firstToThirdOnSingle + twoOut * 0.5 + speedAdj(f))) {
              if (tryAdvance()) bases[2] = f;
            } else bases[1] = f;
          }
          bases[0] = me;
          break;
        }
        default: {
          // 인플레이 아웃이 될 타구
          bl.ab++; totals.ab++;
          if (rng.chance(ctx.env.roe * fld.errMult)) {
            // 실책 출루: 그 타구를 받은 수비수의 실책률로 (fieldDefense). 주자는 한 베이스씩, 타자 주자는 비자책
            totals.roe++;
            kind = 'E';
            let u = rng.next() * fld.errBy.reduce((s, x) => s + x.w, 0);
            errFielder = fld.errBy.find((x) => (u -= x.w) < 0)?.idx ?? fld.errBy.at(-1)?.idx ?? -1;
            if (errFielder >= 0 && ctx.errors) ctx.errors[errFielder] = (ctx.errors[errFielder] ?? 0) + 1;
            me.earned = false;
            if (outs === 2) halfUnearned = true;
            if (bases[2]) { score(bat, fld, bases[2], null); bases[2] = null; }
            if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
            if (bases[0]) { bases[1] = bases[0]; }
            bases[0] = me;
            break;
          }
          if (rng.chance(params.groundBallShare)) {
            // 땅볼
            if (bases[0] && outs < 2) {
              if (rng.chance(params.doublePlay)) {
                bl.gdp++; totals.gdp++;
                kind = 'GDP';
                out(2);
                bases[0] = null;
                if (outs < 3) {
                  if (bases[2]) { score(bat, fld, bases[2], null); bases[2] = null; }
                  if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
                }
              } else {
                out(1);
                if (bases[2] && rng.chance(params.groundOutScores)) { score(bat, fld, bases[2], bl); bases[2] = null; }
                if (bases[1] && !bases[2]) { bases[2] = bases[1]; bases[1] = null; }
                // 절반은 선행 주자 포스아웃(타자 1루), 절반은 타자 아웃(주자 2루)
                if (rng.chance(0.5)) bases[0] = me;
                else if (!bases[1]) { bases[1] = bases[0]; bases[0] = null; }
              }
            } else {
              out(1);
              if (outs < 3) {
                if (bases[2] && rng.chance(params.groundOutScores)) { score(bat, fld, bases[2], bl); bases[2] = null; }
                if (bases[1] && !bases[2] && rng.chance(0.55)) { bases[2] = bases[1]; bases[1] = null; }
              }
            }
          } else {
            // 뜬공
            kind = 'FO';
            out(1);
            if (outs < 3) {
              const t = bases[2];
              if (t && rng.chance(params.sacFly + speedAdj(t))) {
                score(bat, fld, t, bl);
                bases[2] = null;
                bl.ab--; totals.ab--; bl.sf++; totals.sf++;
                kind = 'SF';
              }
              if (bases[1] && !bases[2] && rng.chance(0.2)) { bases[2] = bases[1]; bases[1] = null; }
            }
          }
        }
      }
      note(kind, batter.idx, pg.p.idx, r0);
      if (walkOff()) return true;
    }
    return false;
  };

  let inning = 0;
  const lineScore = { away: [] as number[], home: [] as number[] };
  for (;;) {
    inning++;
    const a0 = away.runs;
    playHalf(away, home, inning);
    lineScore.away.push(away.runs - a0);
    if (inning >= 9 && home.runs > away.runs) {
      lineScore.home.push(-1);
      break;
    }
    const h0 = home.runs;
    const walkOff = playHalf(home, away, inning);
    lineScore.home.push(home.runs - h0);
    if (walkOff) break;
    if (inning >= 9 && home.runs !== away.runs) break;
    if (inning >= ctx.maxInnings) break;
  }

  // ---- 경기 뒤 처리
  totals.games++;
  if (inning > 9) totals.extraInningGames++;
  const st = ctx.states;
  for (const side of [home, away]) {
    for (const pg of side.staff) {
      const i = pg.p.idx;
      if (pg.isStarter) {
        st.lastStartDay[i] = ctx.day;
        if (pg.outs >= 18 && pg.er <= 3) pg.line.qs++;
      }
      st.fatigue[i] = currentFatigue(st, i, ctx.day) + pg.bf;
      st.streak[i] = st.fatigueDay[i] === ctx.day - 1 ? st.streak[i] + 1 : st.fatigueDay[i] === ctx.day ? Math.max(1, st.streak[i]) : 1;
      st.fatigueDay[i] = ctx.day;
    }
  }

  let win: number | null = null;
  let loss: number | null = null;
  let save: number | null = null;
  if (home.runs === away.runs) {
    totals.ties++;
  } else {
    const winner = home.runs > away.runs ? home : away;
    if (winner === home) totals.homeWins++;
    let wp: PitcherInGame | null = rec.leader === winner ? rec.win : null;
    // 선발은 5이닝을 채워야 승리. 못 채웠으면 첫 번째 구원에게
    if (!wp || (wp.isStarter && wp.outs < 15)) wp = winner.staff.find((x) => !x.isStarter) ?? winner.staff[0];
    wp.line.w++;
    win = wp.p.idx;
    const lp = rec.loss;
    if (lp) {
      lp.line.l++;
      loss = lp.p.idx;
    }
    const last = winner.staff[winner.staff.length - 1];
    if (last !== wp && !last.isStarter && ((last.enteredLead >= 1 && last.enteredLead <= 3 && last.outs >= 1) || last.outs >= 9)) {
      last.line.sv++;
      save = last.p.idx;
    }
  }
  // 홀드 (2026-10-12): 3점 차 이내 리드에서 나온 구원 투수가 아웃을 하나 이상 잡고 리드를 지킨 채 내려가면.
  // 경기를 끝낸 투수, 승리 투수, 블론 세이브를 한 투수는 받지 않는다. 진 팀 투수도 받을 수 있다 (리드는 뒤에 나온 투수가 잃었다). 리드 유지는 자기 실점으로 근사
  for (const side of [home, away]) {
    const fin = side.staff[side.staff.length - 1];
    for (const pg of side.staff) {
      if (pg.isStarter || pg === fin || pg.p.idx === win || pg.blown) continue;
      if (pg.enteredLead >= 1 && pg.enteredLead <= 3 && pg.outs >= 1 && pg.enteredLead - pg.runs > 0) pg.line.hld++;
    }
  }
  return {
    homeRuns: home.runs, awayRuns: away.runs, innings: inning, win, loss, save, lineScore,
    homeStaff: home.staff.map((x) => x.p.idx), awayStaff: away.staff.map((x) => x.p.idx),
    homeSubs: home.subs, awaySubs: away.subs,
  };
}
