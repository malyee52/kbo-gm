// 타석 결과 함수 (공통 규칙 계층): 타자·투수 능력과 그 순간의 보정으로 한 타석의 사건별 목표 확률을 낸다.
// 어떤 해결기(resolver.ts)든 이 확률을 받아 타석을 끝낸다. 난수를 쓰지 않는다.

import type { ParkRates } from '../data/types';
import type { GameContext } from './game';
import type { PitcherInGame } from './state';
import { fatigueScale, traitEdge, type Situation } from './traits';
import type { SimPlayer } from './types';
import type { BodyParams } from './params';
import { currentBody } from './team';
import { conditionOf } from './condition';

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
  /** 볼카운트 사슬의 길이 손잡이 (타자 × 투수, 선수별 P/PA). 없으면 1. B0은 쓰지 않는다 */
  len?: number;
}

/** 주자·이닝·점수 상황 (숨겨진 특수능력 판정용) */
export type PaState = Pick<Situation, 'runnersOn' | 'scoring' | 'late'>;
export const NO_STATE: PaState = { runnersOn: false, scoring: false, late: false };

/** 홈 구장 사건별 배율. 치는 손별 표(L·R)가 있으면 그쪽 */
export type GamePark = ParkRates & { L?: ParkRates; R?: ParkRates };
export const NEUTRAL_PARK: GamePark = { s1: 1, d2: 1, t3: 1, hr: 1 };

const clampRate = (x: number) => (x < 0.0005 ? 0.0005 : x > 0.6 ? 0.6 : x);

/** 승산비 결합: 타자 비율과 투수 비율을 리그 평균 기준으로 합친다 */
export function combine(batRate: number, pitRate: number, lg: number): number {
  const b = clampRate(batRate);
  const p = clampRate(pitRate);
  const o = ((b / (1 - b)) * (p / (1 - p))) / (lg / (1 - lg));
  return o / (1 + o);
}

function platoonEdge(b: SimPlayer, p: SimPlayer, size: number): number {
  if (!b.bats || !p.throws) return 0;
  if (b.bats === 'S') return size;
  return b.bats === p.throws ? -size : size;
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
  // 사슬 길이 손잡이: 타자(끈질김)와 투수(투구 효율)의 선수별 P/PA를 리그 평균 상대에서 맞춘 값을 곱한다 (D단계 가공값, 없으면 1)
  const len = lengthOf(ctx, bs.ppaRel, bs.so * cal.so * lg.so, bs.bb * cal.bb * lg.bb, bs.hbp * cal.hbp * lg.hbp)
    * lengthOf(ctx, ps.ppaRel, ps.so * lg.so, ps.bb * lg.bb, ps.hbp * lg.hbp);
  // 홈 구장 효과 (실제 구장 계수 meta.parkFactors + 게임 안에서 지은 신구장의 홈런 배율, league/stadium.ts): 양 팀 타자 모두에게
  // 치는 손별 구장 표: 좌타 L, 우타 R, 양타는 상대 투수 손의 반대쪽, 모르면 전체
  const side = b.bats === 'S' ? (pg.p.throws === 'L' ? 'R' : pg.p.throws === 'R' ? 'L' : null) : b.bats === 'L' || b.bats === 'R' ? b.bats : null;
  const pk: ParkRates = (side && park[side]) || park;
  const hr = combine(bs.hr * cal.hr * lg.hr * up * pk.hr, ps.hr * lg.hr * worse, lg.hr);
  const hitP = ps.hit * worse;
  const s1 = combine(bs.s1 * cal.s1 * lg.s1 * up * pk.s1, hitP * lg.s1, lg.s1);
  const d2 = combine(bs.d2 * cal.d2 * lg.d2 * up * pk.d2, hitP * lg.d2, lg.d2);
  const t3 = combine(bs.t3 * cal.t3 * lg.t3 * up * pk.t3, hitP * lg.t3, lg.t3);

  const sum = so + bb + hbp + hr + s1 + d2 + t3;
  return { so, bb, hbp, hr, s1, d2, t3, scale: sum > 0.93 ? 0.93 / sum : 1, len };
}
