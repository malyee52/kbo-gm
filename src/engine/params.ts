// 엔진 조정값.
// - "임시값": 근거 자료 없이 정한 값.
// - 표시가 없는 주루·병살·희생플라이·도루·홈 이점·휴식·결장 값: 2012·2016·2019·2022·2024년 실제 리그 값에
//   tools/validate_engine.ts 결과를 맞춰 정한 값. 근거와 검증 결과는 docs/engine.md 참조.

import type { InjuryParams } from './injury';
import { DEFAULT_TRAIT_PARAMS, type TraitParams } from './traits';

export interface EngineParams {
  // ---- 능력 산출 (ratings.ts)
  /** 직전 1·2·3시즌 가중치 (기획서: 5:4:3) */
  seasonWeights: [number, number, number];
  /** 직전 기록이 전혀 없을 때 해당 시즌 기록에 주는 가중치. 잠재력 모델(M5) 도입 전 임시 처리 */
  debutSeasonWeight: number;
  /**
   * 시작 연도 능력의 기준 (2026-10-12 사용자 결정): 'season' = 역사 재현, 그 시즌 기록 중심(seasonBlend로 그 시즌·직전·전전 시즌을 섞는다),
   * 'prior' = 예측, 직전 3시즌(seasonWeights). 새 게임에서 고른다. 예전 저장·조작 기록에는 없으므로 없으면 'prior'
   */
  ratingBasis: 'season' | 'prior';
  /** 'season' 기준의 가중치: 그 시즌·직전·전전 시즌 (임시값). 실제 잠재력(커리어 고점)도 이 가중치로 시즌마다 뽑는다 */
  seasonBlend: [number, number, number];
  /** 타자 사건별 회귀 상수: 이만큼의 타석을 사전 평균으로 더한다. tools/fit_regression.py로 맞춘 값 */
  batRegress: { so: number; bb: number; hbp: number; hr: number; s1: number; d2: number; t3: number };
  /** 투수 사건별 회귀 상수: 상대 타자 수 기준. tools/fit_regression.py로 맞춘 값 */
  pitRegress: { so: number; bb: number; hbp: number; hr: number; hit: number };
  /**
   * 외국인(아시아쿼터 제외)의 사전 평균: KBO 첫 시즌을 보낸 외국인의 리그 대비 비율 (2012~2025, 타자 102명·투수 195명 합산).
   * 기록이 적은 외국인을 국내 저표본 선수 평균(meta.priors: 홈런 0.51배 등) 대신 이쪽으로 당긴다
   * (2026-10-12 사용자: "실제로 KBO에서 활약하는 외국인들은 대부분 리그 상위권 지표를 차지한다")
   */
  foreignPriors: {
    batter: { so: number; bb: number; hbp: number; hr: number; s1: number; d2: number; t3: number };
    pitcher: { so: number; bb: number; hbp: number; hr: number; hit: number };
  };

  // ---- 타석 보정 (game.ts)
  /** 좌우 상성 크기. 반대 손 대결에서 타자의 안타·홈런·볼넷이 이만큼 늘고 삼진이 준다 (임시값) */
  platoon: number;
  /** 홈 이점. 홈 타자의 안타·홈런·볼넷이 이만큼 늘고 원정은 그만큼 준다 */
  homeEdge: number;
  /** 투수가 체력 한계를 넘긴 뒤 타자 1명마다 나빠지는 정도 (임시값) */
  fatiguePerBatter: number;

  // ---- 인플레이 아웃 처리
  /** 실책 출루 확률 = 이 값 × 그 해 리그의 비자책 실점 비율. 실책 출루 기록이 없어 가정한 값 */
  roePerUnearnedShare: number;
  /** 득점이 비자책으로 기록될 확률 = 이 값 × 비자책 실점 비율. 송구 실책처럼 타자 출루가 아닌 실책 몫 (기록에만 영향) */
  unearnedRunScale: number;
  /** 폭투·보크 확률 = 이 값 × 그 해 리그의 타석당 폭투+보크 (주자가 있는 타석 기준. 포일 몫 포함) */
  wildPitchScale: number;
  /** 폭투·보크 기록이 없는 해(2000년 이전)에 쓰는 타석당 값 */
  wildPitchDefault: number;
  /** 희생번트 확률 = 이 값 × 그 해 리그의 타석당 희생번트 (무사에 주자가 1·2루에 있을 때) */
  sacBuntScale: number;
  /** 추가 진루를 시도한 주자가 아웃될 확률. 견제사 등 그 밖의 주루사 몫까지 여기에 담았다 */
  outOnAdvance: number;
  /** 인플레이 아웃 중 땅볼 비율 (임시값) */
  groundBallShare: number;
  /** 주자 1루, 2아웃 미만의 땅볼이 병살이 될 확률 */
  doublePlay: number;
  /** 2아웃 미만 뜬공에 3루 주자가 들어올 확률 */
  sacFly: number;
  /** 2아웃 미만 땅볼에 3루 주자가 들어올 확률 */
  groundOutScores: number;

  // ---- 주루
  /** 단타에 1루 주자가 3루까지 갈 확률 */
  firstToThirdOnSingle: number;
  /** 단타에 2루 주자가 득점할 확률 */
  secondToHomeOnSingle: number;
  /** 2루타에 1루 주자가 득점할 확률 */
  firstToHomeOnDouble: number;
  /** 2아웃일 때 위 확률에 더하는 값 (타구와 동시에 출발) */
  twoOutBonus: number;
  /** 도루 시도 배율: 선수의 "1루 출루당 시도율"을 타석 기회당 확률로 바꾸는 값 */
  stealScale: number;

  // ---- 선수 기용
  /** 주전 야수가 하루 쉴 확률 */
  restChance: number;
  /** 주전 포수가 하루 쉴 확률 */
  catcherRestChance: number;
  /** 부상과 이탈 이벤트 (injury.ts) */
  injury: InjuryParams;

  // ---- 수비 (defense.ts)
  /** 팀 수비 1런당 인플레이 안타·실책 출루 확률이 줄어드는 비율. 1런 ≈ 안타→아웃 0.75런, 팀 한 시즌 인플레이 안타 약 1,170개에서 1/880 (임시값) */
  defenseHitPerRun: number;
  /** 포수 수비 1런당 폭투·포일이 줄어드는 비율 (임시값) */
  catcherWildPitchPerRun: number;
  /** 포수 수비 1런당 상대 도루 성공률이 줄어드는 값 (임시값) */
  catcherStealPerRun: number;
  /** 선발 등판 사이 최소 간격 (일) */
  starterRestDays: number;

  // ---- 환경 맞춤
  /** 시즌 시작 전에 리그 비율을 목표값에 맞추려고 돌리는 예비 시즌 수 */
  pilotSeasons: number;

  // ---- 숨겨진 특수능력 (traits.ts). 모두 임시값
  traits: TraitParams;
}

/**
 * 기량 하락이 시작되는 나이 (다음 시즌 기준). 능력(ai/value.ts agingDelta·expectedGrowth), 성장 판정(league/growth.ts),
 * 수비(defense.ts ageDefense), 조기 노쇠(league/careers.ts)가 함께 쓴다.
 * 실제 기록 추정(tools/fit_aging.ts)은 31세였지만 2026-10-11 사용자 결정으로 33세, 같은 날 다시 35세로 늦췄다 (하락 곡선의 모양은 그대로, 4년 뒤로).
 * 2026-10-12 사용자 "기량 하락 나이는 낮추되 하락 폭을 둔화": 32세부터, 처음 몇 해는 실제 추정치의 절반쯤으로 천천히 (ai/value.ts DECLINE_BAT·DECLINE_PIT).
 * 35세 시작은 선수가 고점에 실제보다 훨씬 오래 머물러, 과거 연도에서 시작하면 리그 재능이 실제보다 크게 부풀었다 (2005 시작 → 2010 상위 270명 +28%)
 */
export const DECLINE_START_AGE = 32;

export const DEFAULT_PARAMS: EngineParams = {
  seasonWeights: [1.0, 0.8, 0.6],
  debutSeasonWeight: 0.4,
  ratingBasis: 'prior',
  seasonBlend: [1.0, 0.3, 0.1],
  batRegress: { so: 50, bb: 150, hbp: 300, hr: 100, s1: 150, d2: 300, t3: 600 },
  pitRegress: { so: 200, bb: 150, hbp: 300, hr: 600, hit: 400 },
  foreignPriors: {
    batter: { s1: 0.934, d2: 1.238, t3: 0.91, hr: 1.747, bb: 1.019, hbp: 0.883, so: 1.049 },
    pitcher: { hit: 0.99, hr: 0.885, bb: 0.87, hbp: 0.942, so: 1.075 },
  },

  platoon: 0.035,
  homeEdge: 0.013,
  fatiguePerBatter: 0.012,

  roePerUnearnedShare: 0.2,
  unearnedRunScale: 0.68,
  wildPitchScale: 2.6,
  wildPitchDefault: 0.012,
  sacBuntScale: 11.6,
  outOnAdvance: 0.11,
  groundBallShare: 0.5,
  doublePlay: 0.43,
  sacFly: 0.76,
  groundOutScores: 0.58,

  firstToThirdOnSingle: 0.4,
  secondToHomeOnSingle: 0.75,
  firstToHomeOnDouble: 0.58,
  twoOutBonus: 0.15,
  stealScale: 1.2,

  restChance: 0.2,
  catcherRestChance: 0.25,
  injury: {
    // 2026-10-12 사용자 "부상 빈도가 너무 잦다": 0.008에서 낮춤. 0.008이면 주축(100타석·30이닝+)이 구단당 시즌 28번 다쳤다
    // (실제 부상자 명단 첫해 2020년 최다 삼성이 8월 중순까지 28회). 낮춘 뒤 측정값은 docs/engine.md
    base: 0.0045,
    minor: { share: 0.7, days: [3, 14] },
    long: { share: 0.24, days: [15, 59] },
    major: { share: 0.06, days: [60, 240] },
    eventChance: 0.00005,
    specificShare: 0.5,
    offseasonDays: 150,
  },

  defenseHitPerRun: 1 / 880,
  catcherWildPitchPerRun: 0.02,
  catcherStealPerRun: 0.004,
  starterRestDays: 5,

  pilotSeasons: 3,

  traits: DEFAULT_TRAIT_PARAMS,
};
