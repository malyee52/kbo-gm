// 엔진 조정값.
// - "임시값": 근거 자료 없이 정한 값.
// - 표시가 없는 주루·병살·희생플라이·도루·홈 이점·휴식·결장 값: 2012·2016·2019·2022·2024년 실제 리그 값에
//   tools/validate_engine.ts 결과를 맞춰 정한 값. 근거와 검증 결과는 docs/engine.md 참조.

export interface EngineParams {
  // ---- 능력 산출 (ratings.ts)
  /** 직전 1·2·3시즌 가중치 (기획서: 5:4:3) */
  seasonWeights: [number, number, number];
  /** 직전 기록이 전혀 없을 때 해당 시즌 기록에 주는 가중치. 잠재력 모델(M5) 도입 전 임시 처리 */
  debutSeasonWeight: number;
  /** 타자 사건별 회귀 상수: 이만큼의 타석을 사전 평균으로 더한다. tools/fit_regression.py로 맞춘 값 */
  batRegress: { so: number; bb: number; hbp: number; hr: number; s1: number; d2: number; t3: number };
  /** 투수 사건별 회귀 상수: 상대 타자 수 기준. tools/fit_regression.py로 맞춘 값 */
  pitRegress: { so: number; bb: number; hbp: number; hr: number; hit: number };

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
  /** 선수가 하루에 결장 기간(부상 등)에 들어갈 확률. 부상 모델(M6) 도입 전 임시 처리 */
  absenceChance: number;
  /** 결장 기간 최소·최대 일수 */
  absenceDays: [number, number];
  /** 선발 등판 사이 최소 간격 (일) */
  starterRestDays: number;

  // ---- 환경 맞춤
  /** 시즌 시작 전에 리그 비율을 목표값에 맞추려고 돌리는 예비 시즌 수 */
  pilotSeasons: number;
}

export const DEFAULT_PARAMS: EngineParams = {
  seasonWeights: [1.0, 0.8, 0.6],
  debutSeasonWeight: 0.4,
  batRegress: { so: 50, bb: 150, hbp: 300, hr: 100, s1: 150, d2: 300, t3: 600 },
  pitRegress: { so: 200, bb: 150, hbp: 300, hr: 600, hit: 400 },

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
  absenceChance: 0.006,
  absenceDays: [10, 40],
  starterRestDays: 5,

  pilotSeasons: 3,
};
