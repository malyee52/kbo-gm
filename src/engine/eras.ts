import type { EngineParams, EraRunning } from './params';
import { unearnedFill } from './ratings';
import type { LeagueEnv, World } from './types';

// 시대별 투수 기용 (M8). 2000년 이전 KBO는 선발 4인 로테이션에 에이스가 길게 던지고 구원도 겸했다.
// 5인 로테이션을 모든 시대에 쓰면 1985년 득점이 실제보다 11% 높고 상위 5명 투수의 이닝 비중이 0.56(실제 0.77)에 그친다.
// 값은 tools/validate_engine.ts로 1985·1990·1995년 득점과 이닝 집중도를 맞춘 임시값이다 (docs/engine.md 4장).

export interface EraPitching {
  /** 선발 로테이션 인원 */
  rotation: number;
  /** 선발 등판 사이 최소 휴식일 */
  restDays: number;
  /** 선발 한계 투구 수 배율 (엔진 1에서는 상대 타자 수 배율. 엔진 2 4단계부터 체력 × 타석당 기대 투구 수에 곱한다) */
  limitScale: number;
}

/**
 * 리그 수준 (2026-10-12 사용자 결정 "단계표"): 그 해 KBO의 수준을 2009년 이후 = 1로 둔 배율. 시즌 가치(대체 선수 대비 기여)에 곱해
 * 다른 시대끼리 비교한다. 원년(실업·아마추어 출신) → 해외파·대졸 유입 → 7·8구단 → 외국인 도입(1998) 순으로 올라간다고 본다.
 * 기록만으로는 리그 수준을 가려낼 수 없어(tools/league_quality.ts: 퍼짐·델타 방식 모두 뚜렷한 경향이 없었다) 역사로 정한 값이다.
 * 쓰는 곳: 잠재력의 실제 고점을 시작 연도 리그 기준으로 바꿀 때(league/growth.ts), 화면의 등급(ui/grades.ts), 기준표(tools/war.ts)
 */
export function leagueQuality(year: number): number {
  if (year <= 1982) return 0.8;
  if (year <= 1985) return 0.85;
  if (year <= 1990) return 0.9;
  if (year <= 1997) return 0.93;
  if (year <= 2008) return 0.96;
  return 1;
}

export function eraPitching(year: number): EraPitching {
  // 2026-10-12: 선발·구원을 겸한 에이스가 로테이션에 들어가며(engine/params.ts STARTER_SHARE) 이닝 상위 5명 비중이 실제보다 높아져 1.3 → 1.2, 1.1 → 1.0
  if (year <= 1989) return { rotation: 4, restDays: 4, limitScale: 1.2 };
  if (year <= 1994) return { rotation: 4, restDays: 4, limitScale: 1.0 };
  if (year <= 1999) return { rotation: 5, restDays: 5, limitScale: 1.05 };
  return { rotation: 5, restDays: 5, limitScale: 1 };
}

/** 자동 고의4구 (공 없이) 도입 해: 2018년 (조사값, docs/경기엔진2_기획안.md 3.10.1). 그 전은 공 4개를 실제로 던지는 수동 고의4구 */
export const AUTO_IBB_YEAR = 2018;

const NO_ERA_RUNNING: EraRunning = { year: 0, dp: 1, sf: 1, steal: 1, adv: 1, err: 1 };

/** 그 해의 주루·병살·희생플라이·도루 배율 (params.eraRunning 기준 해 사이는 선으로 잇는다, 비어 있으면 모두 1) */
export function eraRunningOf(params: EngineParams, year: number): EraRunning {
  const rows = params.eraRunning ?? [];
  if (rows.length === 0) return NO_ERA_RUNNING;
  if (year <= rows[0].year) return rows[0];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (year > b.year) continue;
    const w = (year - a.year) / (b.year - a.year);
    const mix = (k: 'dp' | 'sf' | 'steal' | 'adv' | 'err') => a[k] + (b[k] - a[k]) * w;
    const ue = a.ue !== undefined && b.ue !== undefined ? a.ue + (b.ue - a.ue) * w : undefined;
    return { year, dp: mix('dp'), sf: mix('sf'), steal: mix('steal'), adv: mix('adv'), err: mix('err'), ...(ue !== undefined ? { ue } : {}) };
  }
  return rows[rows.length - 1];
}

/**
 * 그 해의 시대 배율을 곱한 조정값 (엔진 2 13단계). 시즌을 열 때 한 번 부른다. 배율이 모두 1이면 받은 객체를 그대로 돌려준다.
 * 실책 배율(err)은 조정값이 아니라 리그 환경(env.roe)에 곱하므로 여기서 다루지 않는다 (Season 생성자)
 */
export function withEraRunning(params: EngineParams, year: number): EngineParams {
  const e = eraRunningOf(params, year);
  if (e.dp === 1 && e.sf === 1 && e.steal === 1 && e.adv === 1) return params;
  const adv = (v: number) => Math.min(1, v * e.adv);
  return {
    ...params,
    doublePlay: params.doublePlay * e.dp,
    sacFly: params.sacFly * e.sf,
    stealScale: params.stealScale * e.steal,
    firstToThirdOnSingle: adv(params.firstToThirdOnSingle),
    secondToHomeOnSingle: adv(params.secondToHomeOnSingle),
    firstToHomeOnDouble: adv(params.firstToHomeOnDouble),
  };
}

/**
 * 그 해의 실책 배율(err)을 곱한 리그 환경 (엔진 2 13단계). 시대 표에 경기 안 비자책 몫(ue)이 있으면 비자책 채우기(unearnedRun)도
 * 그 몫을 빼고 다시 낸다 (엔진 2 14단계: 한 값 unearnedInGame으로 빼면 실책이 많은 2000년 이전에 비자책을 두 번 세어 +11~17%).
 * 바꿀 것이 없으면 월드의 환경 그대로
 */
export function eraEnv(world: Pick<World, 'year' | 'env'>, params: EngineParams): LeagueEnv {
  const e = eraRunningOf(params, world.year);
  const refill = e.ue !== undefined && world.env.unearnedShare !== undefined;
  if (e.err === 1 && !refill) return world.env;
  return {
    ...world.env,
    roe: world.env.roe * e.err,
    ...(refill ? { unearnedRun: unearnedFill(params, world.env.unearnedShare!, e.ue!) } : {}),
  };
}
