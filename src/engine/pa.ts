// 타석 결과 함수 (공통 규칙 계층): 타자·투수 능력과 그 순간의 보정으로 한 타석의 사건별 목표 확률을 낸다.
// 어떤 해결기(resolver.ts)든 이 확률을 받아 타석을 끝낸다. 난수를 쓰지 않는다.

import type { ParkRates, Rates } from '../data/types';
import type { GameContext } from './game';
import type { PitcherInGame } from './state';
import { fatigueScale, traitEdge, type Situation } from './traits';
import type { BatSkill, PitSkill, SimPlayer } from './types';
import { chainShapeFor, type BodyParams, type EngineParams } from './params';
import { currentBody } from './team';
import { conditionOf } from './condition';
import { expectedPitches, type SolvedChain } from './chain';
import { batBallSide, ballMix, clampRate, leagueBall, pitBallSide, thetaOf, type BallMix, type BallSide, type LeagueBall } from './angle';
import { addBat, addPit, leaguePlateFor, plateChain, shiftFor, solvedBatPlate, solvedPitPlate, ZERO_BAT, ZERO_PIT, type BatPlate, type LeaguePlate, type PitPlate } from './plate';

/** 지친 야수의 타석 손해 (타자 유리도에서 뺀다, 엔진 2 11단계, 임시값): 피로가 penaltyFrom을 넘은 1당 penaltyPer, 최대 penaltyMax */
export function tiredPenalty(body: number, bp: BodyParams): number {
  return body > bp.penaltyFrom ? Math.min(bp.penaltyMax, (body - bp.penaltyFrom) * bp.penaltyPer) : 0;
}

/** 타석 결과: 삼진, 볼넷, 사구, 홈런, 단타, 2루타, 3루타, 인플레이 아웃이 될 타구 */
export enum Ev { SO, BB, HBP, HR, S1, D2, T3, OUT }

/**
 * 한 타석의 사건별 확률. 값은 보정한 그대로이고, 일곱 사건 합이 0.93을 넘으면 scale(< 1)로 줄여 쓴다
 * (실제 확률 = 값 × scale, 나머지가 인플레이 아웃 OUT). 해결기 B0가 예전 엔진과 같은 순서·같은 산술로 뽑도록 나눠 둔다
 */
export interface PaRates {
  so: number;
  bb: number;
  hbp: number;
  hr: number;
  s1: number;
  d2: number;
  t3: number;
  scale: number;
  /** 볼카운트 사슬의 길이 손잡이 (타자 × 투수, 선수별 P/PA). 없으면 1. B0은 쓰지 않는다 (예전 길) */
  len?: number;
  /** 칸 함수로 만든 이 타석의 사슬 (능력치 v2 16-1). 있으면 해결기가 손잡이를 풀지 않고 이것으로 공 수를 뽑는다 */
  chain?: SolvedChain;
  /** 이 매치업의 타구각 구간 확률과 구간별 결과 확률 (능력치 v2 16-2, angle.ts). 타구 모형이 결과에 맞는 구간을 여기서 뽑는다 */
  ball?: BallMix;
}

/**
 * 시즌 하나의 사슬 능력 (Season이 만든다, 선수 색인). 결과 비율로 푼 값 + 실측 몫(plateRes).
 * 시즌 중 능력이 바뀌면(자유 모드 능력 바꾸기, 새 선수) 선수의 BatSkill·PitSkill 객체가 바뀌므로, 쓸 때 만든 객체와 다르면 다시 푼다
 */
export interface PlateContext {
  lp: LeaguePlate;
  league: Rates;
  params: EngineParams;
  bat: BatPlate[];
  pit: PitPlate[];
  /** bat·pit을 만든 능력 객체 */
  batSrc: (BatSkill | null)[];
  pitSrc: (PitSkill | null)[];
  /** 투수가 리그 평균 타자를 상대할 때 타석당 기대 투구 수 */
  pitPpa: number[];
  /** 타구 갈래 손잡이 (능력치 v2 16-2): 리그 각도·결과표와 그걸로 푼 선수별 값, 만든 능력 객체 */
  ball?: { lb: LeagueBall; bat: BallSide[]; pit: BallSide[]; batSrc: (BatSkill | null)[]; pitSrc: (PitSkill | null)[] };
}

/** 월드의 모든 선수 사슬 능력 (난수 없음). 시작 때는 실측 그대로, 성장으로 결과 비율이 바뀌면 푼 값이 따라간다 */
export function plateContext(players: readonly SimPlayer[], league: Rates, params: EngineParams, year: number): PlateContext {
  const lp = leaguePlateFor(chainShapeFor(params, year), league, params.plate);
  const pl: PlateContext = { lp, league, params, bat: [], pit: [], batSrc: [], pitSrc: [], pitPpa: [] };
  for (const p of players) {
    batPlateOf(pl, p);
    pitPlateOf(pl, p);
  }
  return pl;
}

/** 선수의 타자 사슬 능력 (능력 객체가 바뀌었으면 다시 푼다) */
export function batPlateOf(pl: PlateContext, p: SimPlayer): BatPlate {
  if (pl.batSrc[p.idx] !== p.bat || pl.bat[p.idx] === undefined) {
    pl.batSrc[p.idx] = p.bat;
    pl.bat[p.idx] = p.bat ? addBat(solvedBatPlate(p.bat, pl.league, pl.lp, pl.params.plate), p.bat.plateRes) : ZERO_BAT;
  }
  return pl.bat[p.idx];
}

/** 선수의 투수 사슬 능력 (능력 객체가 바뀌었으면 다시 풀고 기대 투구 수도 다시 낸다) */
export function pitPlateOf(pl: PlateContext, p: SimPlayer): PitPlate {
  if (pl.pitSrc[p.idx] !== p.pit || pl.pit[p.idx] === undefined) {
    pl.pitSrc[p.idx] = p.pit;
    pl.pit[p.idx] = p.pit ? addPit(solvedPitPlate(p.pit, pl.league, pl.lp), p.pit.plateRes) : ZERO_PIT;
    pl.pitPpa[p.idx] = p.pit ? expectedPitches(plateChain(pl.lp, ZERO_BAT, pl.pit[p.idx])) : pl.lp.ppa;
  }
  return pl.pit[p.idx];
}

/** 그 해 리그 타구각 표 (땅볼 승산 배율이 바뀌면 선수 손잡이를 다시 푼다) */
function ballOf(pl: PlateContext, gbOdds: number): NonNullable<PlateContext['ball']> {
  const lb = leagueBall(pl.league, pl.params, gbOdds);
  if (pl.ball?.lb !== lb) pl.ball = { lb, bat: [], pit: [], batSrc: [], pitSrc: [] };
  return pl.ball;
}

/** 선수의 타자 타구 갈래 손잡이 (능력 객체가 바뀌었으면 다시 푼다) */
export function batBallOf(pl: PlateContext, p: SimPlayer, gbOdds = 1): BallSide {
  const c = ballOf(pl, gbOdds);
  if (c.batSrc[p.idx] !== p.bat || c.bat[p.idx] === undefined) {
    c.batSrc[p.idx] = p.bat;
    c.bat[p.idx] = batBallSide(p.bat!, pl.league, c.lb, pl.params);
  }
  return c.bat[p.idx];
}

/** 선수의 투수 타구 갈래 손잡이 (능력 객체가 바뀌었으면 다시 푼다) */
export function pitBallOf(pl: PlateContext, p: SimPlayer, gbOdds = 1): BallSide {
  const c = ballOf(pl, gbOdds);
  if (c.pitSrc[p.idx] !== p.pit || c.pit[p.idx] === undefined) {
    c.pitSrc[p.idx] = p.pit;
    c.pit[p.idx] = pitBallSide(p.pit!, pl.league, c.lb, pl.params);
  }
  return c.pit[p.idx];
}

/** 주자·이닝·점수 상황 (숨겨진 특수능력 판정용) */
export type PaState = Pick<Situation, 'runnersOn' | 'scoring' | 'late'>;
export const NO_STATE: PaState = { runnersOn: false, scoring: false, late: false };

/** 홈 구장 사건별 배율. 치는 손별 표(L·R)가 있으면 그쪽 */
export type GamePark = ParkRates & { L?: ParkRates; R?: ParkRates };
export const NEUTRAL_PARK: GamePark = { s1: 1, d2: 1, t3: 1, hr: 1 };

/** 승산비 결합: 타자 비율과 투수 비율을 리그 평균 기준으로 합친다 */
export function combine(batRate: number, pitRate: number, lg: number): number {
  const b = clampRate(batRate);
  const p = clampRate(pitRate);
  const o = ((b / (1 - b)) * (p / (1 - p))) / (lg / (1 - lg));
  return o / (1 + o);
}

/** 좌우 상성. 크기는 리그 값 × 타자·투수 선수별 배율의 평균 (BatSkill·PitSkill.platoon, 자료가 없어 지금은 모두 1, 16-2 자리) */
function platoonEdge(b: SimPlayer, p: SimPlayer, size: number): number {
  if (!b.bats || !p.throws) return 0;
  const s = b.bat?.platoon === undefined && p.pit?.platoon === undefined ? size : (size * ((b.bat?.platoon ?? 1) + (p.pit?.platoon ?? 1))) / 2;
  if (b.bats === 'S') return s;
  return b.bats === p.throws ? -s : s;
}

/**
 * 선수 한 명의 사슬 길이 손잡이: 리그 평균 상대로 삼진·볼넷·사구가 K·W·H인 이 선수의 기대 투구 수가 (ppaRel × 리그 기대 투구 수)가 되는 값.
 * ppaRel이 없거나(자료 없음) 투구 수를 세지 않는 해결기면 1
 */
export function lengthOf(ctx: GameContext, ppaRel: number | undefined, K: number, W: number, H: number): number {
  const r = ctx.resolver;
  if (ppaRel === undefined || !r?.lengthFor || !r.pitchesPerPa) return 1;
  const lg = ctx.league;
  return r.lengthFor(K, W, H, ppaRel * r.pitchesPerPa(lg.so, lg.bb, lg.hbp));
}

/** 그날 선수 컨디션 = 흐름 + 몸 상태 사건 (condition.ts). 타석 edge에 params.cond.edge배로 들어간다 (타석 결과에만, 수비·주루에는 없다) */
export function condToday(ctx: Pick<GameContext, 'states' | 'condEvent'>, idx: number): number {
  return conditionOf(ctx.states.cond[idx], ctx.condEvent ? ctx.condEvent[idx] : 0);
}

/** 타석 결과 확률. 수비는 여기서 보지 않는다: 인플레이 타구를 맡은 수비수가 안타 ↔ 아웃을 바꾼다 (battedball.ts, 엔진 2 5단계) */
export function paRates(b: SimPlayer, pg: PitcherInGame, batIsHome: boolean, ctx: GameContext, state: PaState = NO_STATE, park = NEUTRAL_PARK): PaRates {
  const { league: lg, cal, params } = ctx;
  const bs = b.bat!;
  const ps = pg.skill;
  // 타자에게 유리한 정도: 좌우 상성 + 홈 이점 + 숨겨진 특수능력 (둘 다 없으면 0)
  const edge = platoonEdge(b, pg.p, params.platoon) + (batIsHome ? params.homeEdge : -params.homeEdge)
    + (b.traits || pg.p.traits ? traitEdge(b, pg.p, { ...state, postseason: !!ctx.postseason, home: batIsHome }, params.traits) : 0)
    + (ctx.form ? ctx.form[b.idx] - ctx.form[pg.p.idx] : 0)
    + (params.cond.edge ? params.cond.edge * (condToday(ctx, b.idx) - condToday(ctx, pg.p.idx)) : 0)
    - tiredPenalty(currentBody(ctx.states, b.idx, ctx.day, params.body), params.body);
  // 투수 피로: 한계 투구 수를 넘긴 공 수에 비례. 타석 하나를 한 번에 뽑으므로 타석 중간(기대 투구 수의 절반) 시점의 투구 수로 본다
  // (docs/경기엔진2_기획안.md 3.6.3). 에이스 체력(특수능력)은 피로 누적 배율 그대로 (임시, 다시 정의는 공개 스킬 때)
  const over = pg.pitches + pg.ppa / 2 - pg.limit;
  const fat = over > 0 ? Math.min(params.fatigueMax, over * params.fatiguePerPitch * fatigueScale(pg.p, params.traits)) : 0;
  const up = 1 + edge;
  const down = 1 - edge;
  const worse = 1 + fat;

  const so = combine(bs.so * cal.so * lg.so * down, ps.so * lg.so * (1 - fat), lg.so);
  const bb = combine(bs.bb * cal.bb * lg.bb * up, ps.bb * lg.bb * worse, lg.bb);
  const hbp = combine(bs.hbp * cal.hbp * lg.hbp, ps.hbp * lg.hbp, lg.hbp);
  // 홈 구장 효과 (실제 구장 계수 meta.parkFactors + 게임 안에서 지은 신구장의 홈런 배율, league/stadium.ts): 양 팀 타자 모두에게
  // 치는 손별 구장 표: 좌타 L, 우타 R, 양타는 상대 투수 손의 반대쪽, 모르면 전체
  const side = b.bats === 'S' ? (pg.p.throws === 'L' ? 'R' : pg.p.throws === 'R' ? 'L' : null) : b.bats === 'L' || b.bats === 'R' ? b.bats : null;
  const pk: ParkRates = (side && park[side]) || park;
  const gbOdds = ctx.env.gbOdds ?? 1;
  const pl = ctx.plate;
  if (!pl) {
    const hr = combine(bs.hr * cal.hr * lg.hr * up * pk.hr, ps.hr * lg.hr * worse, lg.hr);
    const hitP = ps.hit * worse;
    const s1 = combine(bs.s1 * cal.s1 * lg.s1 * up * pk.s1, hitP * lg.s1, lg.s1);
    const d2 = combine(bs.d2 * cal.d2 * lg.d2 * up * pk.d2, hitP * lg.d2, lg.d2);
    const t3 = combine(bs.t3 * cal.t3 * lg.t3 * up * pk.t3, hitP * lg.t3, lg.t3);
    const sum = so + bb + hbp + hr + s1 + d2 + t3;
    const scale = sum > 0.93 ? 0.93 / sum : 1;
    // 사슬 길이 손잡이: 타자(끈질김)와 투수(투구 효율)의 선수별 P/PA를 리그 평균 상대에서 맞춘 값을 곱한다 (D단계 가공값, 없으면 1)
    const len = lengthOf(ctx, bs.ppaRel, bs.so * cal.so * lg.so, bs.bb * cal.bb * lg.bb, bs.hbp * cal.hbp * lg.hbp)
      * lengthOf(ctx, ps.ppaRel, ps.so * lg.so, ps.bb * lg.bb, ps.hbp * lg.hbp);
    // 결과는 위 비율 그대로, 타구각 구간만 각도 성향으로 (선수 손잡이 0)
    const ball = ballMix(leagueBall(lg, params, gbOdds), thetaOf(bs.gb) + thetaOf(ps.gb), 1, null, null, null);
    if (bs.pull) ball.pull = bs.pull;
    return { so, bb, hbp, hr, s1, d2, t3, scale, len, ball };
  }
  // 능력치 v2 16-1: 삼진·볼넷·사구와 공 수는 칸 함수 사슬에서. 환경 맞춤·좌우·홈·특수능력·컨디션·피로는 삼진·볼넷 배율을 맞히기·선구 로짓으로 옮겨 더하고
  // (리그 평균 매치업에서 같은 배율이 되는 크기, 기획안 1.9 4·5), 사구는 배율로
  const mK = cal.so * down * (1 - fat);
  const mW = cal.bb * up * worse;
  const ch = plateChain(pl.lp, batPlateOf(pl, b), pitPlateOf(pl, pg.p), shiftFor(pl.lp, mK, mW, hbp / pl.lp.end[2]));
  const X = ch.e[3];
  // 능력치 v2 16-2: 맞힌 공 X 뒤 결과는 타구 갈래(angle.ts)에서. 각도 성향 θ = 타자 + 투수, 퍼짐은 타자 컨택, 구간별 결과 로짓에 양쪽 손잡이를 더한다.
  // 환경 맞춤·좌우·홈·특수능력·컨디션·구장·피로의 예전 배율은 결과 로짓에 로그로 더한다 (환경 맞춤은 시범 시즌으로 다시 맞춰진다)
  const bside = batBallOf(pl, b, gbOdds);
  const pside = pitBallOf(pl, pg.p, gbOdds);
  const m = up * worse;
  const mod = [0, Math.log(cal.s1 * m * pk.s1), Math.log(cal.d2 * m * pk.d2), Math.log(cal.t3 * m * pk.t3), Math.log(cal.hr * m * pk.hr)];
  const ball = ballMix(pl.ball!.lb, bside.theta + pside.theta, bside.k, bside.shift, pside.shift, mod);
  if (bs.pull) ball.pull = bs.pull;
  const q = ball.q;
  return { so: ch.e[0], bb: ch.e[1], hbp: ch.e[2], hr: X * q[4], s1: X * q[1], d2: X * q[2], t3: X * q[3], scale: 1, chain: ch, ball };
}
