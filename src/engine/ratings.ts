// 능력 산출: 3시즌 기록 → 타석 결과별 리그 대비 비율.
// params.ratingBasis 'prior'(예측) = 직전 3시즌, 'season'(역사 재현, 2026-10-12) = 그 시즌·직전·전전 시즌 (seasonBlend).
//
// 사건 e의 비율 = (Σ 가중치 × 그 시즌 횟수 ÷ 그 시즌 리그 비율  +  K × 사전 평균) ÷ (Σ 가중치 × 타석  +  K)
// "횟수 ÷ 리그 비율"은 그 횟수를 리그 평균 선수가 내려면 필요한 타석 수라서, 시대가 달라도 그대로 더할 수 있다.
// K가 클수록 표본이 적은 선수가 사전 평균(출전이 적은 선수들의 평균) 쪽으로 강하게 당겨진다.

import type { BatRow, Meta, PitRow, PlayerMaster, Rates, SeasonData } from '../data/types';
import { makeDefense } from './defense';
import type { EngineParams } from './params';
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
}

function batCounts(r: BatRow) {
  return { so: r.so, bb: r.bb, hbp: r.hbp, hr: r.hr, s1: r.h - r.d - r.t - r.hr, d2: r.d, t3: r.t };
}

export function batSkillFrom(rows: Weighted<BatRow>[], priors: Rates, p: EngineParams): BatSkill {
  const skill = { sbAtt: 0, sbPct: DEFAULT_SB_PCT, speed: 0.5, sample: 0 } as BatSkill;
  for (const e of BAT_EVENTS) {
    let num = 0;
    let den = 0;
    for (const { row, w, lg, aging } of rows) {
      const c = batCounts(row)[e];
      if (c === null || c === undefined || row.pa <= 0) continue; // 그 시즌에 이 항목 기록이 없으면 건너뜀
      num += (w * c * (aging?.[e] ?? 1)) / lg[e];
      den += w * row.pa;
    }
    const k = p.batRegress[e];
    skill[e] = (num + k * priors[e]) / (den + k);
  }
  skill.sample = rows.reduce((s, x) => s + x.w * x.row.pa, 0);

  // 도루: 1루 출루(단타+볼넷+사구)당 시도율. 도루 실패 기록이 없으면 성공률 70%로 시도 수를 추정
  let att = 0;
  let onFirst = 0;
  let sb = 0;
  let known = 0;
  for (const { row, w } of rows) {
    if (row.sb === null) continue;
    const times = row.h - row.d - row.t - row.hr + (row.bb ?? 0) + (row.hbp ?? 0);
    const a = row.cs !== null ? row.sb + row.cs : row.sb / DEFAULT_SB_PCT;
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
    for (const { row, w, lg, aging } of rows) {
      if (row.tbf <= 0) continue;
      const c = e === 'hit' ? row.h - row.hr : row[e];
      const lgRate = e === 'hit' ? lg.s1 + lg.d2 + lg.t3 : lg[e];
      num += (w * c * (aging?.[e] ?? 1)) / lgRate;
      den += w * row.tbf;
    }
    const k = p.pitRegress[e];
    skill[e] = (num + k * priors[e]) / (den + k);
  }
  skill.sample = rows.reduce((s, x) => s + x.w * x.row.tbf, 0);

  // 선발 비율과 체력. 선발 등판 수 기록이 없으면 경기당 아웃 수로 선발 여부를 가늠
  let g = 0;
  let gs = 0;
  let bfStart = 0;
  let gStart = 0;
  let bfRelief = 0;
  let gRelief = 0;
  for (const { row, w } of rows) {
    if (row.g <= 0) continue;
    const starts = row.gs !== null ? row.gs : row.outs / row.g >= 12 ? row.g : 0;
    g += w * row.g;
    gs += w * starts;
    if (starts / row.g >= 0.7) {
      bfStart += w * row.tbf;
      gStart += w * row.g;
    } else if (starts / row.g <= 0.2) {
      bfRelief += w * row.tbf;
      gRelief += w * row.g;
    } else if (row.gs !== null && starts > 0) {
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
}

/**
 * 시즌 시작 시점의 월드를 만든다.
 * 소속 팀은 current 시즌 기록의 팀, 능력은 history 시즌 기록에서 뽑는다.
 */
export function buildWorld(input: BuildWorldInput): World {
  const { year, current, history, players: master, meta, params } = input;
  const lg = current.league.rates;
  const histBat = history.map((s) => (s ? new Map(s.bat.map((r) => [r.id, r])) : undefined));
  const histPit = history.map((s) => (s ? new Map(s.pit.map((r) => [r.id, r])) : undefined));

  const teams: SimTeam[] = current.teams.map((t, idx) => ({ idx, name: t.name, franchise: t.franchise, org: [] }));
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

    if (isPitcher) {
      const rows: Weighted<PitRow>[] = [];
      rateSeasons.forEach((s, i) => {
        const r = ratePit[i]?.get(id);
        if (s && r && r.tbf > 0) rows.push({ row: r, w: rateW[i] ?? 0, lg: s.league.rates });
      });
      if (rows.length === 0 && pRow && pRow.tbf > 0) {
        rows.push({ row: pRow, w: params.debutSeasonWeight, lg });
        debutEstimate = true;
      }
      // 외국인(아시아쿼터 제외)은 외국인 첫 시즌 평균 쪽으로 당긴다 (params.foreignPriors)
      pit = pitSkillFrom(rows, m.foreign && !m.asia ? params.foreignPriors.pitcher : meta.priors.pitcher, rp);
      // 마무리 지정용 세이브: 예측은 직전 시즌, 역사 재현은 그 시즌 (그 해 실제 마무리)
      lastSaves = (seasonBasis ? pRow?.sv : histPit[0]?.get(id)?.sv) ?? (debutEstimate ? (pRow?.sv ?? 0) : 0);
    } else {
      const rows: Weighted<BatRow>[] = [];
      rateSeasons.forEach((s, i) => {
        const r = rateBat[i]?.get(id);
        if (s && r && r.pa > 0) rows.push({ row: r, w: rateW[i] ?? 0, lg: s.league.rates });
      });
      if (rows.length === 0 && bRow && bRow.pa > 0) {
        rows.push({ row: bRow, w: params.debutSeasonWeight, lg });
        debutEstimate = true;
      }
      bat = batSkillFrom(rows, m.foreign && !m.asia ? params.foreignPriors.batter : meta.priors.batter, rp);
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
      pos = recent ?? (m.pos && !['SP', 'RP', 'CL', 'P'].includes(m.pos) ? m.pos : null) ?? bRow?.pos ?? null;
      // 세부 포지션이 어디에도 없으면 직전 시즌의 내야·외야 구분이라도, 그것도 없으면 내야로 본다 (1980~90년대 자료. 빈 자료는 추정치, 2026-10-09 QA)
      const posHist = seasonBasis ? rateBat : histBat;
      if (!pos) pos = posHist.map((h) => h?.get(id)?.pos).find((q) => q === 'IF' || q === 'OF') ?? 'IF';
      // 수비: 직전 시즌들(역사 재현은 그 시즌부터)에 맡은 포지션(멀티 포지션 이력)과 주력·나이로 만든 추정값 (기록 없음)
      bat.def = makeDefense(id, pos, posHist.map((h) => h?.get(id)?.pos ?? null), bat.speed, m.birthYear ? year - m.birthYear : null,
        pos ? posPa.get(pos) ?? 0 : 0);
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
      value: bat ? batValue(bat, lg) : pitValue(pit!, lg),
      debutEstimate,
      real: m.real,
    };
    const traits = traitsOf(input.traits, id);
    if (traits) p.traits = traits;
    players.push(p);
    teams[team].org.push(p);
  }

  return {
    year,
    gamesPerTeam: current.games,
    rules: meta.rules[String(year)],
    league: { ...lg },
    env: leagueEnvFor(current.league, params),
    teams,
    players,
  };
}

/** 그 해 리그 합계에서 타석 결과 외의 환경 값 (실책·희생번트·폭투) */
export function leagueEnvFor(league: Pick<SeasonData['league'], 'unearnedShare' | 'sacPerPa' | 'wpbkPerPa'>, params: EngineParams): LeagueEnv {
  return {
    roe: params.roePerUnearnedShare * league.unearnedShare,
    sac: league.sacPerPa,
    unearnedRun: params.unearnedRunScale * league.unearnedShare,
    wildPitch: params.wildPitchScale * (league.wpbkPerPa ?? params.wildPitchDefault),
  };
}
