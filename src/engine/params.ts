// 엔진 조정값.
// - "임시값": 근거 자료 없이 정한 값.
// - 표시가 없는 주루·병살·희생플라이·도루·홈 이점·휴식·결장 값: 2012·2016·2019·2022·2024년 실제 리그 값에
//   tools/validate_engine.ts 결과를 맞춰 정한 값. 근거와 검증 결과는 docs/engine.md 참조.

import type { ChainShape } from './chain';
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
  /**
   * 역사 재현(그 시즌 중심)과 잠재력 고점에 쓰는 회귀 배율: batRegress·pitRegress(다음 시즌 예측용으로 맞춘 값)에 곱한다.
   * 이미 있었던 시즌을 그리는 것이라 평균 쪽으로 덜 당긴다. 2026-10-12 기준표(tools/benchmark_peaks.ts)에 맞춘 값
   */
  seasonRegressScale: number;
  /**
   * 역사 재현의 그 시즌 능력치에서 투수만 따로 쓰는 회귀 배율 (없으면 seasonRegressScale). 잠재력 고점(growth.ts)에는 쓰지 않는다.
   * 2026-10-12 팀 실점 퍼짐 측정(실제의 약 60%)으로 따로 둔다 (docs/temp-values.md)
   */
  seasonPitRegressScale?: number;
  /**
   * 엔트리 순환 (team.ts churnedOut): 직접 정하지 않은 1군에서 10일마다 국내 투수가 2군에 내려갈 확률. 없으면 0.
   * 2026-10-13 tools/pitch_usage.ts로 맞춘 값 0.25 (모든 국내 투수). 2026-10-21 대상을 부진한 투수(churnSlump)로 좁히며 0.5로
   * 다시 맞췄다: 구단별 이닝 상위 5명 비중과 하위 1/3 이닝 몫을 함께 본 값 (docs/temp-values.md)
   */
  rosterChurn?: number;
  /**
   * 엔트리 순환 대상 = 그 시즌 부진한 투수만 (2026-10-21 사용자: "부진한 투수 한정으로 고쳐"). 없으면 모든 국내 투수가 대상 (예전 규칙).
   * 순환 주기(CHURN_DAYS)가 시작할 때의 시즌 기록으로 정한다: 아웃 minOuts 이상이고,
   * 평균자책을 리그 평균자책 priorOuts아웃만큼 섞어 당긴 값이 리그 평균자책 × eraRatio 이상이면 부진. 모두 임시값
   */
  churnSlump?: { minOuts: number; priorOuts: number; eraRatio: number };
  /** 엔트리 순환 중 불펜 고를 때 가치에 더하는 흔들림 폭 (런). 2군에서 "요즘 좋은" 투수가 올라오는 몫 */
  rosterJitter?: number;
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
  /**
   * 구장 효과 (홈 구장 득점 계수 f, meta.parkFactors): 그 구장 경기의 안타 확률 × f^hitExp, 홈런 확률 × f^hrExp.
   * 능력 산출은 같은 지수로 기록을 중립 구장 기준으로 되돌린다 (시즌 단위 계수 (1 + f) / 2로 나눔)
   * 2026-10-22 점검 (tools/park_check.ts, reports/park-check.md): 구단별 홈÷원정 득점 비가 f를 기울기 0.98(±0.08)로 따라가 그대로 둔다.
   * 안타·홈런 지수의 나눔 비(1 : 3)는 득점 계수만으로는 정할 수 없어 임시값이다.
   * 2026-10-22부터 하드힛 구장 표(2022~2025, 전체·좌타·우타)에 있는 구장은 사건별 배율(meta.parkEvents)을 쓰고, 이 지수는 표에 없는
   * 예전 구장과 배율의 수준 맞춤(build_data.py park_events)에만 쓴다
   */
  park: { hitExp: number; hrExp: number };
  /** 투수가 한계 투구 수를 넘긴 뒤 공 1개마다 나빠지는 정도 (임시값, 엔진 2 4단계) */
  fatiguePerPitch: number;
  /** 볼카운트 사슬이 없는 해결기(B0)일 때 타석당 투구 수 (임시값, 2023~2025 리그 3.9구) */
  pitchesPerPaDefault: number;

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
  /**
   * 볼카운트 사슬의 리그 모양 (chain.ts): 칸(볼-스트라이크)별 다음 공이 볼·스트라이크·파울·맞힘·사구일 비율.
   * 매치업마다 손잡이를 풀어 끝 확률을 타석 결과 함수에 맞추므로, 이 모양은 투구 수와 카운트 분포만 정한다 (엔진 2 3단계)
   */
  chainShape: ChainShape;
  /** 그 해 투구 단위 자료가 있는 해의 사슬 모양 (없는 해는 chainShape) */
  chainShapeByYear: Record<number, ChainShape>;
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
  /**
   * 불펜 서열 섞는 속도 (2026-10-22): 시즌 개막에는 지난 시즌 실제 쓰임(SimPlayer.penTrust) 순서, 경기일이 이만큼 지나면 능력 순.
   * 그 사이는 두 순위를 날짜 비율로 섞는다 (임시값)
   */
  penBlendDays: number;

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

/**
 * 선발 투수로 보는 선발 등판 비율 (2026-10-12). 예전에는 0.5였다: 1980년대 에이스는 선발과 구원을 겸해(선동열 1986 39경기 중 22선발,
 * 최동원 1984 51경기 중 20선발) 0.42~0.5에 걸려 구원으로 분류되고 마무리가 되어 시뮬에서 한 해 50~60이닝만 던졌다.
 * 로테이션은 이 기준을 넘는 투수 가운데 능력 순이라 선발·구원을 오간 스윙맨도 후보가 된다
 */
export const STARTER_SHARE = 0.4;

/**
 * 선발 등판 기록이 없는 시즌(2026 자료 전부, 그 밖의 해 일부 행)의 선발 비율 추정 (2026-10-21): 경기당 아웃이
 * GS_EST_RELIEF_OUTS 이하면 구원만, GS_EST_START_OUTS 이상이면 선발만, 그 사이는 선형으로.
 * 2019·2021~2025 선발 기록이 있는 1,342 시즌(5경기 이상)에 맞춘 값: 경기 가중 선발 비율 오차 0.051 → 0.018,
 * 선발·구원 구분 정확도 94.5% → 97.5%. 예전 규칙(경기당 12아웃 이상이면 모두 선발, 아니면 0)은 짧게 던진
 * 선발(2026 배제성 21경기 77이닝, 오원석 27경기 99이닝)을 구원으로 보아, 로테이션이 2군 신인으로 채워졌다
 */
export const GS_EST_RELIEF_OUTS = 3.5;
export const GS_EST_START_OUTS = 14;

/** 선발 등판 기록이 없을 때 경기당 아웃으로 가늠한 선발 등판 수 */
export function estimatedStarts(row: { g: number; outs: number }): number {
  if (row.g <= 0) return 0;
  const share = (row.outs / row.g - GS_EST_RELIEF_OUTS) / (GS_EST_START_OUTS - GS_EST_RELIEF_OUTS);
  return row.g * Math.min(1, Math.max(0, share));
}

/** 선발 투수인가 (STARTER_SHARE) */
export function isStarterSkill(pit: { startShare: number } | null | undefined): boolean {
  return !!pit && pit.startShare >= STARTER_SHARE;
}

export const DEFAULT_PARAMS: EngineParams = {
  seasonWeights: [1.0, 0.8, 0.6],
  debutSeasonWeight: 0.4,
  ratingBasis: 'prior',
  seasonBlend: [1.0, 0.3, 0.1],
  seasonRegressScale: 0.5,
  seasonPitRegressScale: 0.25,
  rosterChurn: 0.5,
  churnSlump: { minOuts: 15, priorOuts: 30, eraRatio: 1.15 },
  rosterJitter: 0.06,
  batRegress: { so: 50, bb: 150, hbp: 300, hr: 100, s1: 150, d2: 300, t3: 600 },
  pitRegress: { so: 200, bb: 150, hbp: 300, hr: 600, hit: 400 },
  foreignPriors: {
    batter: { s1: 0.934, d2: 1.238, t3: 0.91, hr: 1.747, bb: 1.019, hbp: 0.883, so: 1.049 },
    pitcher: { hit: 0.99, hr: 0.885, bb: 0.87, hbp: 0.942, so: 1.075 },
  },

  platoon: 0.035,
  homeEdge: 0.013,
  // 임시값: 홈런이 구장에 더 민감하다고 보고 정한 지수 (구장별 득점 비가 f를 따라가는지는 아직 재지 않았다)
  park: { hitExp: 0.4, hrExp: 1.2 },
  // 엔진 1의 타자 1명당 0.012를 2023~2025 리그 타석당 투구 수 3.9구로 나눈 값 (임시값)
  fatiguePerPitch: 0.012 / 3.9,
  pitchesPerPaDefault: 3.9,

  roePerUnearnedShare: 0.2,
  unearnedRunScale: 0.68,
  wildPitchScale: 2.6,
  wildPitchDefault: 0.012,
  sacBuntScale: 11.6,
  outOnAdvance: 0.11,
  groundBallShare: 0.5,
  // 아래 chainShapeByYear 세 해(2023~2025 맞춘 모양)를 칸마다 실제 공 수로 가중 평균. 스트라이크 = 루킹 + 헛스윙 + 번트 헛스윙
  // (+ 2스트라이크 번트 파울), 파울 = 파울 + 2스트라이크 전 번트 파울. 그 해 모양(chainShapeByYear)이 없는 해(2022년 이전, 2026년 이후)에 쓴다 (임시값: 그 시대 카운트 자료 없음.
  // 2015~2022 리그 P/PA는 하드힛 월별 표 3.80~3.94구와 비교만 한다, reports/engine2-step3.md)
  chainShape: [
    [0.39633, 0.39172, 0.10295, 0.10562, 0.00337], // 0-0
    [0.40354, 0.23894, 0.17574, 0.17845, 0.00333], // 0-1
    [0.46846, 0.15467, 0.19263, 0.18085, 0.00338], // 0-2
    [0.33765, 0.34723, 0.15558, 0.15616, 0.00338], // 1-0
    [0.33955, 0.24497, 0.20154, 0.21068, 0.00327], // 1-1
    [0.3563, 0.16826, 0.24034, 0.2305, 0.00461], // 1-2
    [0.32154, 0.39404, 0.13382, 0.14812, 0.00248], // 2-0
    [0.2917, 0.23812, 0.23021, 0.23676, 0.00321], // 2-1
    [0.26391, 0.17339, 0.27844, 0.27929, 0.00497], // 2-2
    [0.34802, 0.61377, 0.01564, 0.02002, 0.00255], // 3-0
    [0.2938, 0.30132, 0.19306, 0.20976, 0.00206], // 3-1
    [0.22445, 0.16905, 0.29409, 0.30814, 0.00426], // 3-2
  ],
  // 2023~2025: 그 해 count_pitch.csv(data-src/pbp_derived/) 칸 비율에 맞춘 모양 (묶음은 chainShape와 같다). count_chain.json 모양에서 시작해
  // tools/fit_chain_shape.ts로 칸·결과마다 (실제 ÷ 시뮬) 비를 곱하고 다시 정규화하기를 3번 (해마다 4시즌, 시드 fitshape-<해>-<번호>, 2026-10-22).
  // 매치업마다 손잡이가 달라 리그 모양 그대로면 리그 칸 비율이 2.0~3.5%p 어긋나던 것(매치업 섞임)을 0.6~0.9%p로 줄였다
  chainShapeByYear: {
    2023: [
      [0.39596, 0.39088, 0.10351, 0.10672, 0.00293], // 0-0
      [0.41951, 0.226, 0.17127, 0.17973, 0.0035], // 0-1
      [0.48859, 0.14475, 0.18309, 0.17939, 0.00417], // 0-2
      [0.32826, 0.34962, 0.15784, 0.16069, 0.00359], // 1-0
      [0.34246, 0.24217, 0.19901, 0.21341, 0.00294], // 1-1
      [0.36395, 0.16051, 0.23822, 0.23276, 0.00455], // 1-2
      [0.31111, 0.41571, 0.1293, 0.14112, 0.00275], // 2-0
      [0.29218, 0.2376, 0.23059, 0.23652, 0.0031], // 2-1
      [0.26461, 0.16674, 0.28065, 0.28265, 0.00535], // 2-2
      [0.34237, 0.61518, 0.02121, 0.01793, 0.00331], // 3-0
      [0.29175, 0.30564, 0.19274, 0.20796, 0.0019], // 3-1
      [0.21814, 0.16024, 0.29753, 0.31967, 0.00442], // 3-2
    ],
    2024: [
      [0.40071, 0.38807, 0.10284, 0.10493, 0.00345], // 0-0
      [0.39835, 0.24099, 0.17891, 0.1788, 0.00294], // 0-1
      [0.47219, 0.15287, 0.19285, 0.17917, 0.00292], // 0-2
      [0.34526, 0.34561, 0.15425, 0.15162, 0.00326], // 1-0
      [0.34711, 0.24722, 0.19998, 0.20201, 0.00368], // 1-1
      [0.35693, 0.17132, 0.24016, 0.22656, 0.00502], // 1-2
      [0.32839, 0.37516, 0.1368, 0.15706, 0.00259], // 2-0
      [0.29769, 0.24446, 0.22678, 0.22773, 0.00334], // 2-1
      [0.26298, 0.1764, 0.27649, 0.27975, 0.00439], // 2-2
      [0.34032, 0.61989, 0.01343, 0.02369, 0.00268], // 3-0
      [0.28852, 0.30176, 0.19798, 0.20974, 0.002], // 3-1
      [0.2366, 0.17452, 0.28498, 0.29989, 0.00401], // 3-2
    ],
    2025: [
      [0.39221, 0.39631, 0.10252, 0.10522, 0.00374], // 0-0
      [0.39292, 0.24971, 0.17698, 0.17683, 0.00356], // 0-1
      [0.44652, 0.16544, 0.20105, 0.18385, 0.00314], // 0-2
      [0.33932, 0.34646, 0.15467, 0.15625, 0.0033], // 1-0
      [0.3288, 0.24558, 0.20575, 0.21669, 0.00319], // 1-1
      [0.34804, 0.17283, 0.24262, 0.23225, 0.00426], // 1-2
      [0.32466, 0.39236, 0.13516, 0.14572, 0.0021], // 2-0
      [0.28498, 0.23208, 0.23337, 0.24637, 0.00319], // 2-1
      [0.26415, 0.17724, 0.27814, 0.27529, 0.00518], // 2-2
      [0.3612, 0.60616, 0.0127, 0.01822, 0.00172], // 3-0
      [0.30143, 0.2964, 0.18825, 0.21164, 0.00228], // 3-1
      [0.21864, 0.17276, 0.29984, 0.3044, 0.00436], // 3-2
    ],
  },
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
  penBlendDays: 100,

  pilotSeasons: 3,

  traits: DEFAULT_TRAIT_PARAMS,
};

/**
 * 불펜 피로 (엔진 2 4단계, 단위는 공). 경기 뒤 던진 공 수만큼 쌓이고 하루에 BULLPEN_RECOVERY_PER_DAY씩 빠진다.
 * 경기 전 피로가 BULLPEN_AVAILABLE_BELOW 미만이어야 등판할 수 있고(전날 15구 안팎까지는 연투 가능), 이틀 연속 던진 투수는 어제 경기 뒤
 * 피로가 BULLPEN_THIRD_DAY_BELOW 미만일 때만 사흘째 나온다 (3연투). 쓸 투수가 없으면 덜 지친 투수부터 쓴다 (manager.ts pickReliever).
 * 2025 투구 단위 자료의 구원 연투 22.0%·3연투 1.7%(data-src/pbp_derived/relief.csv)에 tools/engine2_baseline.ts 4시즌으로 맞춘 값
 * (임시값: 실제 감독의 연투 기준은 모른다). 숨은 능력 '회복력'(엔진 2 16단계)이 회복량에 곱해질 자리이고 지금은 모두 1.00
 */
export const BULLPEN_RECOVERY_PER_DAY = 12;
export const BULLPEN_AVAILABLE_BELOW = 3;
export const BULLPEN_THIRD_DAY_BELOW = 10;

/** 그 해의 볼카운트 사슬 모양 */
export function chainShapeFor(params: EngineParams, year: number): ChainShape {
  return params.chainShapeByYear[year] ?? params.chainShape;
}
