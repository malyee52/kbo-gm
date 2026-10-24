// 능력 산출: 3시즌 기록 → 타석 결과별 리그 대비 비율.
// params.ratingBasis 'prior'(예측) = 직전 3시즌, 'season'(역사 재현, 2026-10-12) = 그 시즌·직전·전전 시즌 (seasonBlend).
//
// 사건 e의 비율 = (Σ 가중치 × 그 시즌 횟수 ÷ 그 시즌 리그 비율  +  K × 사전 평균) ÷ (Σ 가중치 × 타석  +  K)
// "횟수 ÷ 리그 비율"은 그 횟수를 리그 평균 선수가 내려면 필요한 타석 수라서, 시대가 달라도 그대로 더할 수 있다.
// K가 클수록 표본이 적은 선수가 사전 평균(출전이 적은 선수들의 평균) 쪽으로 강하게 당겨진다.

import type { BatRow, Hand, Meta, ParkData, ParkRates, PitRow, PlayerMaster, Rates, SeasonData } from '../data/types';
import { realParkYear } from './park';
import { makeDefense } from './defense';
import type { DefenseAward, DefenseData, PlateData, PpaData, ScheduleData } from '../data/types';
import { divisionsOf, scheduleRule } from '../data/schedule';
import { defenseV2, fieldLeague, fieldYears, homeOf, type DefenseV2 } from './fielding';
import { pctRankedFromSeason, pickOpeningHosts, rankedFromSeason } from './schedule';
import { chainShapeFor, DEFAULT_PARAMS, estimatedStarts, type EngineParams } from './params';
import { addBat, addPit, leaguePlateFor, measuredBatPlate, measuredPitPlate, solvedBatPlate, solvedPitPlate, type LeaguePlate, type PlateSeason } from './plate';
import { traitsOf } from './traits';
import type { BatSkill, LeagueEnv, PitSkill, SimPlayer, SimTeam, World } from './types';

const BAT_EVENTS = ['so', 'bb', 'hbp', 'hr', 's1', 'd2', 't3'] as const;
const PIT_EVENTS = ['so', 'bb', 'hbp', 'hr', 'hit'] as const;

/** 선형 가중치 (타석 결과의 득점 가치). 공개된 세이버메트릭스 상수의 근사값 */
export const LINEAR_WEIGHTS = { bb: 0.69, hbp: 0.72, s1: 0.89, d2: 1.27, t3: 1.62, hr: 2.1 } as const;

const DEFAULT_SB_PCT = 0.7;
/** 선발·구원을 겸한 시즌에서 구원 한 번에 상대한 타자 수로 보는 값 (임시값) */
const MIXED_RELIEF_BF = 6;

export interface Weighted<T> {
  row: T;
  w: number;
  lg: Rates;
  /** 노화 보정: 사건별로 그 시즌 횟수에 곱하는 배율 (그 시즌 나이 → 목표 시즌 나이). 없으면 1 */
  aging?: Partial<Record<string, number>>;
  /** 그 시즌 소속 구단의 시즌 단위 구장 효과 (seasonPark). 없으면 중립 */
  park?: SeasonPark;
  /** 그 시즌 리그 도루 성공률 (도루 실패 기록이 없는 해만, params.sbPctByYear). 도루 시도 수 추정에 쓴다. 없으면 0.7 */
  sbPct?: number;
}

/** 시즌 단위 구장 효과: run = (1 + 홈 구장 계수) / 2, ev = 사건별 홈 구장 배율 (있으면 사건마다 (1 + 배율) / 2로 쓴다) */
export interface SeasonPark {
  run: number;
  ev?: ParkRates;
}

/**
 * 그 시즌 그 구단 기록에 들어 있는 구장 효과: 홈 경기 절반은 홈 구장, 원정은 리그 평균 구장으로 본다.
 * 경기와 같은 실제 구장 값 (park.ts realParkYear): 2015~ 실측, 그 전은 구장 제원(parks)이 있으면 차이 방식·짐작 (구장효과 기획안 4.3, P5)
 */
export function seasonPark(meta: Pick<Meta, 'parkFactors' | 'parkEvents'>, season: Pick<SeasonData, 'year' | 'teams' | 'league'>, team: string,
                           bats: Hand | null = null, parks?: ParkData, pp: EngineParams['park'] = DEFAULT_PARAMS.park): SeasonPark | undefined {
  const fr = season.teams.find((t) => t.name === team)?.franchise;
  if (!fr) return undefined;
  const v = realParkYear({ parkFactors: meta.parkFactors, parkEvents: meta.parkEvents, parks }, season.year, season.teams.map((t) => t.franchise),
    leagueRpa(season.league), pp).get(fr);
  if (!v) return undefined;
  // 사건별 배율: 좌타·우타는 그 손의 표, 양타·투수·모름은 전체 (양타는 좌우 타석이 섞인다)
  const ev = v.ev && (bats === 'L' || bats === 'R') ? v.ev[bats] ?? v.ev : v.ev;
  return { run: (1 + v.run) / 2, ...(ev ? { ev: { s1: ev.s1, d2: ev.d2, t3: ev.t3, hr: ev.hr } } : {}) };
}

/** 리그 합계 → 구장 계산에 쓰는 리그 비율·타석당 득점 */
export function leagueRpa(L: SeasonData['league']): { rates: Rates; rpa: number } {
  return { rates: L.rates, rpa: L.pa > 0 ? L.r / L.pa : 0 };
}

/** 구장 효과를 걷어 내는 배율. 사건별 배율이 있으면 그것, 없으면 득점 계수의 지수 (params.park). 투수의 'hit'은 단타·2루타·3루타를 리그 비율로 섞는다 */
function parkDivisor(park: SeasonPark | undefined, e: string, p: EngineParams, lg: Rates): number {
  if (!park) return 1;
  if (park.ev) {
    const half = (k: keyof ParkRates) => (1 + park.ev![k]) / 2;
    if (e === 's1' || e === 'd2' || e === 't3' || e === 'hr') return half(e);
    if (e === 'hit') return (lg.s1 * half('s1') + lg.d2 * half('d2') + lg.t3 * half('t3')) / (lg.s1 + lg.d2 + lg.t3);
    return 1;
  }
  if (park.run === 1) return 1;
  if (e === 'hr') return park.run ** p.park.hrExp;
  if (e === 's1' || e === 'd2' || e === 't3' || e === 'hit') return park.run ** p.park.hitExp;
  return 1;
}

function batCounts(r: BatRow) {
  return { so: r.so, bb: r.bb, hbp: r.hbp, hr: r.hr, s1: r.h - r.d - r.t - r.hr, d2: r.d, t3: r.t };
}

export function batSkillFrom(rows: Weighted<BatRow>[], priors: Rates, p: EngineParams): BatSkill {
  const skill = { sbAtt: 0, sbPct: DEFAULT_SB_PCT, speed: 0.5, sample: 0 } as BatSkill;
  for (const e of BAT_EVENTS) {
    let num = 0;
    let den = 0;
    for (const { row, w, lg, aging, park } of rows) {
      const c = batCounts(row)[e];
      if (c === null || c === undefined || row.pa <= 0) continue; // 그 시즌에 이 항목 기록이 없으면 건너뜀
      num += (w * c * (aging?.[e] ?? 1)) / lg[e] / parkDivisor(park, e, p, lg);
      den += w * row.pa;
    }
    const k = p.batRegress[e];
    skill[e] = (num + k * priors[e]) / (den + k);
  }
  skill.sample = rows.reduce((s, x) => s + x.w * x.row.pa, 0);

  // 도루: 1루 출루(단타+볼넷+사구)당 시도율. 도루 실패 기록이 없으면 그 해 리그 성공률(없으면 70%)로 시도 수를 추정
  let att = 0;
  let onFirst = 0;
  let sb = 0;
  let known = 0;
  for (const { row, w, sbPct } of rows) {
    if (row.sb === null) continue;
    const times = row.h - row.d - row.t - row.hr + (row.bb ?? 0) + (row.hbp ?? 0);
    const a = row.cs !== null ? row.sb + row.cs : row.sb / (sbPct ?? DEFAULT_SB_PCT);
    att += w * a;
    onFirst += w * times;
    if (row.cs !== null) {
      sb += w * row.sb;
      known += w * (row.sb + row.cs);
    }
  }
  const PRIOR_ATT = 0.05;
  skill.sbAtt = (att + 40 * PRIOR_ATT) / (onFirst + 40);
  skill.sbPct = (sb + 10 * DEFAULT_SB_PCT) / (known + 10);
  // 속도: 도루 시도율과 3루타 비율로 추정. 0.5가 평균
  const raw = 0.5 + 2.2 * (skill.sbAtt - PRIOR_ATT) + 0.08 * (skill.t3 - 1);
  skill.speed = Math.min(1, Math.max(0, raw));
  return skill;
}

export function pitSkillFrom(rows: Weighted<PitRow>[], priors: Meta['priors']['pitcher'], p: EngineParams): PitSkill {
  const skill = { stamina: 22, reliefStint: 5, startShare: 0, sample: 0 } as PitSkill;
  for (const e of PIT_EVENTS) {
    let num = 0;
    let den = 0;
    for (const { row, w, lg, aging, park } of rows) {
      if (row.tbf <= 0) continue;
      const c = e === 'hit' ? row.h - row.hr : row[e];
      const lgRate = e === 'hit' ? lg.s1 + lg.d2 + lg.t3 : lg[e];
      num += (w * c * (aging?.[e] ?? 1)) / lgRate / parkDivisor(park, e, p, lg);
      den += w * row.tbf;
    }
    const k = p.pitRegress[e];
    skill[e] = (num + k * priors[e]) / (den + k);
  }
  skill.sample = rows.reduce((s, x) => s + x.w * x.row.tbf, 0);

  // 선발 비율과 체력. 선발 등판 수 기록이 없으면 경기당 아웃 수로 선발 등판 수를 가늠한다 (params.ts estimatedStarts)
  let g = 0;
  let gs = 0;
  let bfStart = 0;
  let gStart = 0;
  let bfRelief = 0;
  let gRelief = 0;
  for (const { row, w } of rows) {
    if (row.g <= 0) continue;
    const starts = row.gs !== null ? row.gs : estimatedStarts(row);
    g += w * row.g;
    gs += w * starts;
    if (starts / row.g >= 0.7) {
      bfStart += w * row.tbf;
      gStart += w * row.g;
    } else if (starts / row.g <= 0.2) {
      bfRelief += w * row.tbf;
      gRelief += w * row.g;
    } else if (starts > 0) {
      // 선발과 구원을 겸한 시즌 (1980년대 에이스 등, 2026-10-12): 구원 등판은 한 번에 6명쯤 상대했다고 보고 나머지를 선발 몫으로
      const relief = row.g - starts;
      const perStart = Math.max(0, row.tbf - relief * MIXED_RELIEF_BF) / starts;
      if (perStart > 0) {
        bfStart += w * perStart * starts;
        gStart += w * starts;
      }
    }
  }
  skill.startShare = g > 0 ? gs / g : 0;
  skill.reliefStint = Math.min(9, Math.max(3, (bfRelief + 10 * 5) / (gRelief + 10)));
  // 선발 체력의 사전값: 구원으로 한 번에 길게 던지는 투수(롱릴리프)는 선발로도 더 길게 던진다고 본다.
  // 구원 평균(5명)이면 리그 기본 22명. 선발 기록이 쌓일수록 실제 기록 쪽으로 간다 (임시값, 2026-10-08)
  const staminaPrior = Math.min(26, Math.max(16, 12 + 2 * skill.reliefStint));
  skill.stamina = Math.min(29, Math.max(16, (bfStart + 5 * staminaPrior) / (gStart + 5)));
  return skill;
}

/** 땅볼 몫 배율(리그 대비)을 아웃 타구 땅볼 승산 배율로. 몫은 0.15~0.85 안에서 */
function gbOddsOf(shareRel: number, p: EngineParams): number {
  const odds = (x: number) => x / (1 - x);
  const s0 = p.groundBallShare;
  return odds(Math.min(0.85, Math.max(0.15, s0 * shareRel))) / odds(s0);
}

/** 땅볼 성향 추정에 쓰는 병살 회귀 상수 (병살 기회가 될 수 있는 인플레이 타구 수, 임시값) */
const GB_DP_REGRESS = 500;
/** 타자 땅볼 몫 배율의 범위 (임시값) */
const GB_BAT_RANGE: [number, number] = [0.7, 1.4];
/** 투수 땅볼 몫 배율 = 피홈런 배율 ^ (−이 값) (임시값: 땅볼 투수가 홈런을 덜 맞는다는 관계만 쓴다. 타구 자료가 없다) */
const GB_PIT_HR_EXP = 0.25;

/**
 * 타자 타구 성향 (엔진 2 6단계, 추정): 인플레이 타구(삼진·볼넷·사구·홈런·희생 뺌)당 병살을 리그 대비로 재고, 주력에 따른 병살 회피(play.dpSpeed)를 덜어
 * 땅볼 몫 배율로 본다. 병살 기회(앞 타자 출루)의 차이도 섞여 있어 크게 평균 쪽으로 당긴다. 병살 기록이 없으면 undefined
 */
export function batGbOf(rows: { row: BatRow; w: number; league: SeasonData['league'] }[], speed: number, p: EngineParams): number | undefined {
  let num = 0;
  let den = 0;
  for (const { row: r, w, league: L } of rows) {
    if (r.gdp === null) continue;
    const bip = r.pa - (r.so ?? 0) - (r.bb ?? 0) - (r.hbp ?? 0) - r.hr - (r.sac ?? 0) - (r.sf ?? 0);
    const lgBip = L.pa - L.so - L.bb - L.hbp - L.hr - L.sac - L.sf;
    if (bip <= 0 || lgBip <= 0 || L.gdp <= 0) continue;
    num += (w * r.gdp) / (L.gdp / lgBip);
    den += w * bip;
  }
  if (den <= 0) return undefined;
  const rel = (num + GB_DP_REGRESS) / (den + GB_DP_REGRESS) / (1 - p.play.dpSpeed * (speed - 0.5) * 2);
  return gbOddsOf(Math.min(GB_BAT_RANGE[1], Math.max(GB_BAT_RANGE[0], rel)), p);
}

/** 투수 땅볼 성향 (엔진 2 6단계, 추정): 피홈런 배율에서 */
export function pitGbOf(hr: number, p: EngineParams): number {
  return gbOddsOf(Math.max(0.01, hr) ** -GB_PIT_HR_EXP, p);
}

export function batValue(s: BatSkill, lg: Rates): number {
  const W = LINEAR_WEIGHTS;
  return (
    W.bb * s.bb * lg.bb + W.hbp * s.hbp * lg.hbp + W.s1 * s.s1 * lg.s1 + W.d2 * s.d2 * lg.d2 + W.t3 * s.t3 * lg.t3 + W.hr * s.hr * lg.hr
  );
}

export function pitValue(s: PitSkill, lg: Rates): number {
  const W = LINEAR_WEIGHTS;
  // 삼진은 인플레이 타구를 줄여 안타를 줄이는 효과로 반영
  const inPlayShift = 1 - (s.so - 1) * lg.so * 0.9;
  return (
    W.bb * s.bb * lg.bb +
    W.hbp * s.hbp * lg.hbp +
    (W.s1 * lg.s1 + W.d2 * lg.d2 + W.t3 * lg.t3) * s.hit * inPlayShift +
    W.hr * s.hr * lg.hr
  );
}

/** 역사 재현·고점용 회귀 상수: 예측용 값에 seasonRegressScale을 곱한다 */
export function seasonRegress(p: EngineParams, pitScale = p.seasonRegressScale): EngineParams {
  const k = p.seasonRegressScale;
  if (k === 1 && pitScale === 1) return p;
  const scale = <T extends Record<string, number>>(o: T, m: number): T => Object.fromEntries(Object.entries(o).map(([e, v]) => [e, v * m])) as T;
  return { ...p, batRegress: scale(p.batRegress, k), pitRegress: scale(p.pitRegress, pitScale) };
}

/**
 * 선수별 P/PA 비율을 능력과 같은 시즌·가중치로 섞고 regress 타석만큼 1 쪽으로 당긴다 (D단계 가공값, 사슬 길이 손잡이).
 * 자료가 있는 시즌이 하나도 없으면 undefined (사슬 값 그대로)
 */
export function ppaRelOf(rows: Record<string, [number, number]> | undefined, seasons: (SeasonData | undefined)[], w: readonly number[], regress: number): number | undefined {
  if (!rows) return undefined;
  let num = 0;
  let den = 0;
  seasons.forEach((s, i) => {
    const r = s && rows[String(s.year)];
    if (r && r[0] > 0) {
      num += (w[i] ?? 0) * r[0] * r[1];
      den += (w[i] ?? 0) * r[0];
    }
  });
  return den > 0 ? (num + regress) / (den + regress) : undefined;
}

/** 선수의 사슬 실측 시즌 (plate.json)을 능력과 같은 시즌·가중치로 */
function plateRows(rows: Record<string, number[]> | undefined, seasons: (SeasonData | undefined)[], w: readonly number[]): PlateSeason[] {
  if (!rows) return [];
  return seasons.flatMap((s, i) => {
    const c = s && rows[String(s.year)];
    return c ? [{ w: w[i] ?? 0, c }] : [];
  });
}

export interface BuildWorldInput {
  year: number;
  /** 로스터와 소속 팀을 정하는 시즌 (보통 year와 같다) */
  current: SeasonData;
  /** 직전 시즌들. 가까운 순서 [year-1, year-2, year-3]. 없는 해는 undefined */
  history: (SeasonData | undefined)[];
  players: Map<string, PlayerMaster>;
  meta: Meta;
  params: EngineParams;
  /** 숨겨진 특수능력 표 (traits.json의 traits). 없으면 아무도 능력이 없다 */
  traits?: Record<string, string[]>;
  /** 그 해 전 모든 시즌 (수비 포지션 이력용). 없으면 history만 */
  career?: SeasonData[];
  /** KBO 수비상 순위 (선수 ID → 수상). 없으면 보정하지 않는다 */
  defenseAwards?: Record<string, DefenseAward[]>;
  /** 선수별 타석당 투구 수 (ppa.json). 없으면 사슬 값 그대로 */
  ppa?: PpaData;
  /** 선수별 볼카운트 사슬 실측 (plate.json, 능력치 v2 16-1). 없으면 결과 기록으로 짐작한다 */
  plate?: PlateData;
  /** 1군 수비 이닝·평판 (defense.json). 있으면 수비를 능력치 v2 식(fielding.ts defenseV2)으로 만든다. 없으면 예전 추정 (defense.ts makeDefense) */
  defense?: DefenseData;
  /** 실제 구장 제원 (parks.json). 있으면 2015년 이전 구장 효과를 차이 방식·짐작으로 넣는다 (park.ts). 없으면 그 해들은 중립 */
  parks?: ParkData;
  /** 연도별 일정 규칙 (schedule.json). 그 해 줄이 World.schedule이 된다. 없으면 일정 규칙 없이 */
  schedule?: ScheduleData;
}

/**
 * 시즌 시작 시점의 월드를 만든다.
 * 소속 팀은 current 시즌 기록의 팀, 능력은 history 시즌 기록에서 뽑는다.
 */
/** 규정타석 = 그 해 팀 경기 수 × 3.1 */
const FIELD_POS = new Set(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']);
const QUAL_PA_PER_GAME = 3.1;

/**
 * 하드힛 주 포지션 이력(시즌 행 posSrc 'H', 2003~)으로 정하는 수비 가능 포지션과 주 포지션 (포지션 2안, 2026-10-22 사용자 결정 "1로 하고 문제 있으면 다시 보자").
 * - 주 포지션: 시작 연도 앞 최근 3시즌(year−1~year−3)의 자리별 타석을 최근일수록 무겁게(weights, 임시값) 더해 가장 많은 자리.
 *   지명타자는 가중 타석의 70%를 넘을 때만 (직전 시즌 창 규칙과 같다). 같으면 더 최근에 맡은 자리.
 *   그 3시즌에 하드힛 기록이 없으면(입대·부상 공백) 예전 규칙: 규정타석 시즌이 가장 많은 자리 → 시즌 수 → 타석 합 → 최근 순.
 * - 수비 가능 포지션: 그 자리로 규정타석(그 해 팀 경기 × 3.1, 여러 구단이면 가장 많은 팀 경기)을 채운 시즌이 있는 자리
 *   + 2시즌 이상 맡은 자리 + 주 포지션.
 * - 포수 예외 (2026-10-22 사용자 결정): 포수를 주 포지션으로 삼으려면 포수로 규정타석을 채운 시즌이 있어야 한다.
 *   하드힛 시즌 행의 타석은 지명타자 타석까지 합친 값이라, 포수 규정타석 시즌이 다른 자리 규정타석 시즌 합보다 적으면
 *   (강백호: 포수 1 · 1루 2 · 좌익 1 · 우익 1) 포수로 채운 시즌으로 보지 않는다 (해석, 보고에 적음).
 *   아니면 규정타석 시즌이 다음으로 많은 자리 (같으면 최근 가중 타석 → 최근) 가 주 포지션이고, 포수는 수비 가능으로 남는다. 다른 자리가 없으면 포수 그대로.
 * - 이력이 짧은 선수 (2026-10-22 사용자 결정): 그 3시즌 타석 합이 0보다 크고 shortPa보다 적으면 fallback(자료집 주 포지션 → 그 시즌 포지션)을 쓴다 (박석민 2005 → 3B).
 * 2009년·포지션 파일에 없는 타자의 추정값('E')은 쓰지 않는다. 하드힛 이력이 없는 선수는 맵에 없다 (기존 방식).
 * year를 주지 않으면 seasons의 가장 늦은 해 다음 해로 본다.
 */
export function hardhitPositions(seasons: readonly Pick<SeasonData, 'year' | 'teams' | 'bat'>[], year?: number,
  weights: readonly number[] = DEFAULT_PARAMS.positionWeights,
  opts: { shortPa?: number; fallback?: (id: string) => string | null | undefined } = {}): Map<string, { main: string; playable: string[] }> {
  type Acc = { n: number; pa: number; last: number; reg: number; regLast: number; recent: number; win: number };
  const start = year ?? Math.max(...seasons.map((s) => s.year)) + 1;
  const per = new Map<string, Map<string, Acc>>();
  for (const s of seasons) {
    const games = new Map(s.teams.map((t) => [t.name, t.g]));
    const seen = new Map<string, { pos: string; pa: number; g: number }>();
    for (const r of s.bat) {
      if (r.posSrc !== 'H' || !r.pos) continue;
      const x = seen.get(r.id) ?? { pos: r.pos, pa: 0, g: 0 };
      x.pa += r.pa;
      x.g = Math.max(x.g, games.get(r.team) ?? 0);
      seen.set(r.id, x);
    }
    const w = weights[start - 1 - s.year] ?? 0;
    for (const [id, x] of seen) {
      let m = per.get(id);
      if (!m) per.set(id, (m = new Map()));
      const a = m.get(x.pos) ?? { n: 0, pa: 0, last: 0, reg: 0, regLast: 0, recent: 0, win: 0 };
      a.n++;
      a.pa += x.pa;
      a.last = Math.max(a.last, s.year);
      a.recent += Math.max(1, x.pa) * w;
      if (w > 0) a.win += x.pa;
      if (x.g > 0 && x.pa >= QUAL_PA_PER_GAME * x.g) {
        a.reg++;
        a.regLast = Math.max(a.regLast, s.year);
      }
      m.set(x.pos, a);
    }
  }
  const out = new Map<string, { main: string; playable: string[] }>();
  for (const [id, m] of per) {
    const all = [...m.entries()];
    const total = all.reduce((t, [, a]) => t + a.recent, 0);
    let main: string;
    if (total > 0) {
      const field = all.filter(([q, a]) => q !== 'DH' && a.recent > 0).sort((p, q) => q[1].recent - p[1].recent || q[1].last - p[1].last)[0];
      main = (m.get('DH')?.recent ?? 0) > 0.7 * total || !field ? 'DH' : field[0];
    } else {
      main = [...all].sort((p, q) => q[1].reg - p[1].reg || q[1].regLast - p[1].regLast || q[1].n - p[1].n || q[1].pa - p[1].pa || q[1].last - p[1].last)[0][0];
    }
    if (main === 'C') {
      const cReg = m.get('C')!.reg;
      const otherReg = all.reduce((t, [q, a]) => t + (q === 'C' ? 0 : a.reg), 0);
      const next = all.filter(([q]) => q !== 'C' && q !== 'DH')
        .sort((p, q) => q[1].reg - p[1].reg || q[1].recent - p[1].recent || q[1].last - p[1].last)[0];
      if ((cReg === 0 || cReg < otherReg) && next) main = next[0];
    }
    const win = all.reduce((t, [, a]) => t + a.win, 0);
    const old = win > 0 && win < (opts.shortPa ?? DEFAULT_PARAMS.shortHistoryPa) ? opts.fallback?.(id) : undefined;
    if (old) main = old;
    const playable = all.filter(([q, a]) => q === main || a.reg > 0 || a.n >= 2)
      .sort((p, q) => Number(q[0] === main) - Number(p[0] === main) || q[1].reg - p[1].reg || q[1].n - p[1].n || q[1].last - p[1].last).map(([q]) => q);
    if (!m.has(main)) playable.unshift(main);
    out.set(id, { main, playable });
  }
  return out;
}

export function buildWorld(input: BuildWorldInput): World {
  const { year, current, history, players: master, meta, params } = input;
  const lg = current.league.rates;
  // 볼카운트 사슬 실측 몫 (능력치 v2 16-1): 그 해 리그 칸 상수. 시즌(Season)이 같은 식으로 다시 만들므로 시작 때 사슬 능력 = 실측
  let lpCache: LeaguePlate | undefined;
  const lpOf = () => (lpCache ??= leaguePlateFor(chainShapeFor(params, year), lg, params.plate));
  const histBat = history.map((s) => (s ? new Map(s.bat.map((r) => [r.id, r])) : undefined));
  const histPit = history.map((s) => (s ? new Map(s.pit.map((r) => [r.id, r])) : undefined));

  // 홈 구장 배율 (park.ts realParkYear): 2015~ 실측, 그 전은 구장 제원이 있으면 차이 방식·짐작
  const parks = realParkYear({ parkFactors: meta.parkFactors, parkEvents: meta.parkEvents, parks: input.parks }, year,
    current.teams.map((t) => t.franchise), leagueRpa(current.league), params.park);
  const teams: SimTeam[] = current.teams.map((t, idx) => {
    const v = parks.get(t.franchise);
    return { idx, name: t.name, franchise: t.franchise, org: [], ...(v && v.run !== 1 ? { park: { hr: 1, run: v.run, ...(v.ev ? { ev: v.ev } : {}) } } : {}) };
  });
  const teamIdx = new Map(teams.map((t) => [t.name, t.idx]));
  const players: SimPlayer[] = [];
  const curBat = new Map(current.bat.map((r) => [r.id, r]));
  const curPit = new Map(current.pit.map((r) => [r.id, r]));
  // 능력을 뽑는 시즌과 가중치. 역사 재현은 그 시즌을 맨 앞에 두고 직전 두 시즌을 덜 섞는다 (표본이 적은 해는 타석 수만큼만 반영되므로 자연히 앞 시즌 쪽으로 당겨진다)
  const seasonBasis = params.ratingBasis === 'season';
  const rateSeasons = seasonBasis ? [current, history[0], history[1]] : history;
  const rateW = seasonBasis ? params.seasonBlend : params.seasonWeights;
  const rateBat = seasonBasis ? [curBat, histBat[0], histBat[1]] : histBat;
  const ratePit = seasonBasis ? [curPit, histPit[0], histPit[1]] : histPit;
  const rp = seasonBasis ? seasonRegress(params, params.seasonPitRegressScale ?? params.seasonRegressScale) : params;
  const ids = new Set<string>([...curBat.keys(), ...curPit.keys()]);
  // 능력치 v2 수비 (16-3): 증거는 시작 연도 전 해들 (역사 재현은 그 시즌도 넣는다). 2000년 이전 해는 시즌 자료의 주 포지션으로 (결정 30)
  const defStart = seasonBasis ? year + 1 : year;
  const defSeasons = new Map([...(input.career ?? []), ...history.filter((s): s is SeasonData => !!s), current].map((s) => [s.year, s]));
  const defStore = input.defense ? { defense: input.defense, meta, season: (y: number) => defSeasons.get(y) } : undefined;
  const defSeen: { v2: DefenseV2; pa: number }[] = [];
  // 커리어 수비 포지션: 선수 → 포지션 → 타석(최근일수록 무겁게, 해마다 0.85배). 역사 재현은 그 시즌도 넣는다
  const careerPos = new Map<string, Map<string, number>>();
  const careerSeasons = [...(input.career ?? history.filter((s): s is SeasonData => !!s)), ...(seasonBasis ? [current] : [])];
  for (const s of careerSeasons) {
    const w = 0.85 ** Math.max(0, year - s.year);
    for (const r of s.bat) {
      if (!r.pos || r.pos === 'IF' || r.pos === 'OF') continue;
      let m = careerPos.get(r.id);
      if (!m) careerPos.set(r.id, (m = new Map()));
      m.set(r.pos, (m.get(r.pos) ?? 0) + Math.max(1, r.pa) * w);
    }
  }
  // 하드힛 이력이 있는 선수는 수비 가능 포지션·주 포지션을 규정타석 규칙으로 정하고 기존 추정의 다른 자리를 더하지 않는다 (2002년 이전·2009년만 있는 선수는 기존 방식)
  // 이력이 짧은 선수의 예전 규칙: 자료집 주 포지션 → 그 시즌 포지션. 투수·내야/외야 구분은 쓰지 않고,
  // 지명타자는 2안의 70% 규칙이 정하게 둔다 (몇십 타석 선수가 자료집 지명타자로 수비 자리를 잃지 않게)
  const fieldPos = (q: string | null | undefined) => (q && FIELD_POS.has(q) ? q : undefined);
  const hhPos = hardhitPositions(careerSeasons, seasonBasis ? year + 1 : year, params.positionWeights,
    { shortPa: params.shortHistoryPa, fallback: (id) => fieldPos(master.get(id)?.pos) ?? fieldPos(curBat.get(id)?.pos) });

  for (const id of ids) {
    const m = master.get(id);
    if (!m) continue;
    const bRow = curBat.get(id);
    const pRow = curPit.get(id);
    const isPitcher = m.kind === 'P' || (!!pRow && !bRow);
    const team = teamIdx.get((isPitcher ? pRow?.team : bRow?.team) ?? bRow?.team ?? pRow?.team ?? '');
    if (team === undefined) continue;

    let bat: BatSkill | null = null;
    let pit: PitSkill | null = null;
    let debutEstimate = false;
    let pos: string | null = null;
    let lastSaves = 0;
    let penTrust = 0;

    if (isPitcher) {
      const rows: Weighted<PitRow>[] = [];
      rateSeasons.forEach((s, i) => {
        const r = ratePit[i]?.get(id);
        if (s && r && r.tbf > 0) rows.push({ row: r, w: rateW[i] ?? 0, lg: s.league.rates, park: seasonPark(meta, s, r.team, null, input.parks, params.park) });
      });
      if (rows.length === 0 && pRow && pRow.tbf > 0) {
        rows.push({ row: pRow, w: params.debutSeasonWeight, lg, park: seasonPark(meta, current, pRow.team, null, input.parks, params.park) });
        debutEstimate = true;
      }
      // 외국인(아시아쿼터 제외)은 외국인 첫 시즌 평균 쪽으로 당긴다 (params.foreignPriors)
      pit = pitSkillFrom(rows, m.foreign && !m.asia ? params.foreignPriors.pitcher : meta.priors.pitcher, rp);
      if (rows.length) pit.gb = pitGbOf(pit.hr, params);
      const pitPpa = ppaRelOf(input.ppa?.pit[id], debutEstimate ? [current] : rateSeasons, debutEstimate ? [params.debutSeasonWeight] : rateW, params.ppaRegress);
      if (pitPpa !== undefined) pit.ppaRel = pitPpa;
      const pitPlate = plateRows(input.plate?.pit[id], debutEstimate ? [current] : rateSeasons, debutEstimate ? [params.debutSeasonWeight] : rateW);
      if (pitPlate.length) {
        const solved = solvedPitPlate(pit, lg, lpOf());
        pit.plateRes = addPit(measuredPitPlate(pitPlate, solved, params.plate), solved, -1);
      }
      // 마무리 지정용 세이브: 예측은 직전 시즌, 역사 재현은 그 시즌 (그 해 실제 마무리)
      lastSaves = (seasonBasis ? pRow?.sv : histPit[0]?.get(id)?.sv) ?? (debutEstimate ? (pRow?.sv ?? 0) : 0);
      // 시작 불펜 서열: 세이브와 같은 기준 시즌(예측은 직전, 역사 재현은 그 해)의 실제 쓰임
      const usage = seasonBasis || debutEstimate ? pRow : histPit[0]?.get(id);
      if (usage) penTrust = penTrustOf(usage.g - (usage.gs ?? 0), usage.sv, usage.hld ?? 0, usage.gmli ?? null);
    } else {
      const rows: Weighted<BatRow>[] = [];
      rateSeasons.forEach((s, i) => {
        const r = rateBat[i]?.get(id);
        if (s && r && r.pa > 0) rows.push({ row: r, w: rateW[i] ?? 0, lg: s.league.rates, park: seasonPark(meta, s, r.team, m.bats ?? null, input.parks, params.park), sbPct: params.sbPctByYear[s.year] });
      });
      if (rows.length === 0 && bRow && bRow.pa > 0) {
        rows.push({ row: bRow, w: params.debutSeasonWeight, lg, park: seasonPark(meta, current, bRow.team, m.bats ?? null, input.parks, params.park), sbPct: params.sbPctByYear[current.year] });
        debutEstimate = true;
      }
      bat = batSkillFrom(rows, m.foreign && !m.asia ? params.foreignPriors.batter : meta.priors.batter, rp);
      const gbSeasons = debutEstimate ? [{ s: current, r: bRow, w: params.debutSeasonWeight }]
        : rateSeasons.map((s, i) => ({ s, r: rateBat[i]?.get(id), w: rateW[i] ?? 0 }));
      const gb = batGbOf(gbSeasons.flatMap(({ s, r, w }) => (s && r && r.pa > 0 ? [{ row: r, w, league: s.league }] : [])), bat.speed, params);
      if (gb !== undefined) bat.gb = gb;
      const batPpa = ppaRelOf(input.ppa?.bat[id], debutEstimate ? [current] : rateSeasons, debutEstimate ? [params.debutSeasonWeight] : rateW, params.ppaRegress);
      if (batPpa !== undefined) bat.ppaRel = batPpa;
      const batPlate = plateRows(input.plate?.bat[id], debutEstimate ? [current] : rateSeasons, debutEstimate ? [params.debutSeasonWeight] : rateW);
      if (batPlate.length) {
        const solved = solvedBatPlate(bat, lg, lpOf(), params.plate);
        bat.plateRes = addBat(measuredBatPlate(batPlate, solved, params.plate), solved, -1);
      }
      // 포지션: 가장 최근 시즌에 기록된 세부 포지션 → 마스터의 주포지션 → 해당 시즌의 포지션 구분
      // 포지션: 직전 시즌들에 맡은 세부 포지션을 타석 수로 가중해 가장 많이 맡은 자리 (지명타자는 지명 타석이 70%를 넘을 때만).
      // 가장 최근 시즌만 보면 부상 등으로 한 해 지명타자를 한 3루수(예: 최정 2025년)를 지명타자로 잘못 본다
      const posPa = new Map<string, number>();
      for (const h of seasonBasis ? rateBat : histBat) {
        const r = h?.get(id);
        if (r?.pos && r.pos !== 'IF' && r.pos !== 'OF') posPa.set(r.pos, (posPa.get(r.pos) ?? 0) + Math.max(1, r.pa));
      }
      const totalPa = [...posPa.values()].reduce((a, b) => a + b, 0);
      const field = [...posPa.entries()].filter(([q]) => q !== 'DH').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      const recent = (posPa.get('DH') ?? 0) > 0.7 * totalPa ? 'DH' : field?.[0] ?? (posPa.has('DH') ? 'DH' : undefined);
      // 직전 시즌 포지션이 없는 신인·새 외국인은 그 해 하드힛 주 포지션을 마스터(내야수·외야수뿐인 경우가 많다)보다 먼저 쓴다 (2026-10-22)
      const curHh = bRow?.posSrc === 'H' && bRow.pos ? bRow.pos : null;
      pos = recent ?? curHh ?? (m.pos && !['SP', 'RP', 'CL', 'P'].includes(m.pos) ? m.pos : null) ?? bRow?.pos ?? null;
      // 세부 포지션이 어디에도 없으면 직전 시즌의 내야·외야 구분이라도, 그것도 없으면 내야로 본다 (1980~90년대 자료. 빈 자료는 추정치, 2026-10-09 QA)
      const posHist = seasonBasis ? rateBat : histBat;
      if (!pos) pos = posHist.map((h) => h?.get(id)?.pos).find((q) => q === 'IF' || q === 'OF') ?? 'IF';
      // 하드힛 이력이 없고 그 해만 하드힛에 나온 선수는 그 자리 하나만 (규정타석 시즌이 없을 때의 규칙과 같다)
      const hh = hhPos.get(id) ?? (curHh && !recent ? { main: curHh, playable: [curHh] } : undefined);
      if (hh) pos = hh.main;
      // 수비: 커리어에 맡은 포지션(멀티 포지션 이력, 2026-10-13), 주력·나이, KBO 수비상으로 만든 추정값 (수비 기록 없음).
      // 커리어 세부 포지션이 없을 때만 직전 시즌들의 내야·외야 구분을 쓴다
      const career = careerPos.get(id);
      const played = hh ? hh.playable : career && career.size ? [...career.keys()] : posHist.map((h) => h?.get(id)?.pos ?? null);
      const careerField = career ? [...career.entries()].filter(([q]) => q !== 'DH').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] : undefined;
      if (input.defense) {
        // 능력치 v2 수비 (16-3): 시작 연도 전 수비 이닝·평판·수상으로. 화면 주 포지션도 수비 이닝 규칙(12.2)을 따른다 (기록이 없으면 지금 포지션)
        const v2 = defenseV2({ id, years: fieldYears(defStore!, id, defStart), startYear: defStart, reps: input.defense.rep[id], awards: input.defenseAwards?.[id],
          age: m.birthYear ? year - m.birthYear : null, speed: bat.speed, listed: homeOf(pos) ?? undefined, league: fieldLeague(input.defense) });
        bat.def = v2.def;
        bat.playable = v2.playable;
        if (v2.emergencyC) bat.emC = true;
        if (v2.cArm !== undefined) bat.cArm = v2.cArm;
        if (v2.main.basis !== 'listed' && v2.main.basis !== 'none') pos = v2.main.screen;
        if (m.real !== false) defSeen.push({ v2, pa: rateBat[0]?.get(id)?.pa ?? 0 });
      } else bat.def = makeDefense(id, pos, played, bat.speed, m.birthYear ? year - m.birthYear : null,
        // 주전 출전 근거 타석: 하드힛 이력 선수는 수비 가능 자리 전체 (규정타석 시즌 수가 같아 최근 자리가 주 포지션이 된 선수가 오래 맡은 자리의 근거를 잃지 않게)
        hh ? hh.playable.reduce((a, q) => a + (posPa.get(q) ?? 0), 0) : pos ? posPa.get(pos) ?? 0 : 0, { awards: input.defenseAwards?.[id], year, fieldPos: pos === 'DH' ? careerField ?? (m.pos && m.pos !== 'DH' ? m.pos : undefined) : undefined });
    }

    const p: SimPlayer = {
      idx: players.length,
      id,
      name: m.name,
      teamIdx: team,
      isPitcher,
      pos,
      bats: m.bats ?? null,
      throws: m.throws ?? null,
      foreign: m.foreign === true,
      age: m.birthYear ? year - m.birthYear : null,
      bat,
      pit,
      lastSaves,
      ...(penTrust > 0 ? { penTrust } : {}),
      ...(isPitcher && m.underhand ? { underhand: true } : {}),
      value: bat ? batValue(bat, lg) : pitValue(pit!, lg),
      debutEstimate,
      real: m.real,
    };
    const traits = traitsOf(input.traits, id);
    if (traits) p.traits = traits;
    players.push(p);
    teams[team].org.push(p);
  }

  const env = leagueEnvFor(current.league, params, year);
  const defModel = defSeen.length ? defenseModel(defSeen) : undefined;
  if (defModel) env.defZero = defModel.zero;
  // 일정 규칙과 개막 홈 구단 (지난 시즌 자료의 순위, 일정 개편 기획안 2.2)
  const rule = input.schedule ? scheduleRule(input.schedule, year) : undefined;
  const franchises = teams.map((t) => t.franchise);
  const hosts = pickOpeningHosts(year, rankedFromSeason(history[0], franchises), franchises);
  // 양대 리그 나눔 (1999·2000, 그 해 시즌 자료의 league 칸)
  const divisions = divisionsOf(current, franchises);
  return {
    year,
    gamesPerTeam: current.games,
    rules: meta.rules[String(year)],
    league: { ...lg },
    env,
    teams,
    players,
    ...(defModel ? { defPool: defModel.pool } : {}),
    ...(rule ? { schedule: rule } : {}),
    ...(hosts ? { openingHosts: hosts } : {}),
    ...(divisions ? { divisions, prevStandings: pctRankedFromSeason(history[0], franchises) } : {}),
  };
}

/** 가상 선수 B를 뽑는 실존 주전: 직전 시즌 이만큼 타석 (16.4 가) */
const DEF_POOL_PA = 300;

/**
 * 수비 영점 m (13.6): 실존 선수의 바로 앞 해 자리별 수비 이닝으로 가중한 그 자리 등급 평균. 가상 선수 B 분포: 직전 시즌 300타석 이상 실존 주전의 본 자리 B (오름차순)
 */
function defenseModel(seen: { v2: DefenseV2; pa: number }[]): { zero: number; pool: number[] } {
  let w = 0;
  let s = 0;
  const pool: number[] = [];
  for (const { v2, pa } of seen) {
    for (const [q, inn] of Object.entries(v2.lastInn) as [keyof DefenseV2['grade'], number][]) {
      w += inn;
      s += inn * v2.grade[q];
    }
    const home = v2.main.field;
    if (pa >= DEF_POOL_PA && home && v2.base[home] !== undefined) pool.push(v2.base[home]!);
  }
  return { zero: w > 0 ? Math.round((s / w) * 10) / 10 : 50, pool: pool.sort((a, b) => a - b) };
}

/**
 * 경기 안 판정으로 자책인 득점이 비자책이 될 확률: 그 해 비자책 비율(share)에서 경기 안 판정 몫(inGame)을 뺀 나머지를 채운다.
 * 경기 안 몫은 해마다 다르다 (실책이 많은 옛 시대가 크다, eras.ts eraEnv가 시대 표의 ue로 다시 낸다)
 */
export function unearnedFill(params: EngineParams, share: number, inGame: number): number {
  return params.unearnedRunScale * Math.max(0, share - inGame) / (1 - inGame);
}

/** 그 해 리그 합계에서 타석 결과 외의 환경 값 (실책·희생번트·폭투) */
export function leagueEnvFor(league: Pick<SeasonData['league'], 'unearnedShare' | 'sacPerPa' | 'wpbkPerPa' | 'sbPct'>, params: EngineParams, year?: number): LeagueEnv {
  const odds = (x: number) => x / (1 - x);
  const gb = year !== undefined ? params.groundBallShareByYear[year] : undefined;
  return {
    roe: params.roePerUnearnedShare * league.unearnedShare,
    sac: league.sacPerPa,
    // 경기 안 판정 몫(해마다 거의 같다)을 뺀 모자란 몫만 확률로 채운다. 비율에 곱하면 비자책이 적은 해(2012 0.079)에 넘쳤다
    unearnedRun: unearnedFill(params, league.unearnedShare, params.unearnedInGame),
    unearnedShare: league.unearnedShare,
    wildPitch: params.wildPitchScale * (league.wpbkPerPa ?? params.wildPitchDefault),
    gbOdds: gb !== undefined ? odds(gb) / odds(params.groundBallShare) : 1,
    ...(league.sbPct ? { sbPct: league.sbPct } : {}),
  };
}

/**
 * 불펜 신뢰도 (2026-10-22, docs/하드힛_현실감_기획안.md 2.1): 감독이 지난 시즌 이 구원 투수를 얼마나 중요한 상황에 썼나. 클수록 앞 순번.
 * gmLI(등판 때 평균 레버리지, 하드힛 2010~)가 있으면 그 값, 없으면 1 + (세이브 + 홀드) ÷ 구원 등판 (마무리 약 1.5, 셋업 약 1.3, 추격조 1).
 * 구원 등판이 10번 미만이면 0 (쓰임을 알 수 없음 → 능력 순)
 */
export function penTrustOf(reliefGames: number, sv: number, hld: number, gmli: number | null): number {
  if (reliefGames < 10) return 0;
  if (gmli !== null && gmli > 0) return gmli;
  return 1 + (sv + hld) / reliefGames;
}
