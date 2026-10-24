// 엔진 조정값.
// - "임시값": 근거 자료 없이 정한 값.
// - 표시가 없는 주루·병살·희생플라이·도루·홈 이점·휴식·결장 값: 2012·2016·2019·2022·2024년 실제 리그 값에
//   tools/validate_engine.ts 결과를 맞춰 정한 값. 근거와 검증 결과는 docs/engine.md 참조.

import type { ChainShape } from './chain';
import type { InjuryParams } from './injury';
import { DEFAULT_TRAIT_PARAMS, type TraitParams } from './traits';

/** 타구 모형 조정값 (battedball.ts). 자리 표는 구장 쪽 [좌익선 쪽, 가운데, 우익선 쪽] 순서 */
export interface BallParams {
  /** 인플레이 타구 방향 [당겨, 가운데, 밀어] (치는 손 기준) */
  dir: [number, number, number];
  /** 안타 종류별 타구 유형 [땅볼, 라인드라이브, 뜬공, 내야 뜬공] */
  type: { S1: [number, number, number, number]; D2: [number, number, number, number]; T3: [number, number, number, number] };
  /**
   * 아웃 타구의 유형: ld = 아웃 중 라인드라이브 몫, pu = 아웃 중 (뜬공 + 내야 뜬공)에서 내야 뜬공 몫.
   * 나머지(1 − ld)를 땅볼 : 뜬공 = groundBallShare : (1 − groundBallShare)로 나눈다 (엔진 2 6단계)
   */
  airOut: { ld: number; pu: number };
  /** 라인드라이브·뜬공이 내야 공중 구역(내야수가 맡음)으로 가는 몫 */
  infieldAir: { LD: number; FB: number };
  /** 깊이별·구장 쪽별 담당 자리 가중치 (ground 내야 땅볼, air 내야 공중, outfield 외야) */
  zones: Record<'ground' | 'air' | 'outfield', [ZoneFielders, ZoneFielders, ZoneFielders]>;
  /** 타구각 갈래 (angle.ts, 능력치 v2 16-2) */
  angle: AngleParams;
}

/**
 * 타구각 갈래 조정값 (angle.ts, docs/능력치v2_기획안.md 10.2·11.3). 위 type·airOut 표는 리그 구간별 결과표의 재료로 그대로 쓴다
 * (베이즈로 뒤집음). 덩어리 몫·공중 덩어리 가운데·퍼짐은 해마다 그 해 유형 비율에 맞춰 다시 풀고, 여기 값은 그 시작점이다
 */
export interface AngleParams {
  /** 구간 경계 (도): 땅볼 | 라인드라이브 | 홈런 각 | 높은 뜬공 | 내야 뜬공 */
  cuts: [number, number, number, number];
  /** 땅볼 덩어리 [가운데, 퍼짐] (고정) */
  ground: [number, number];
  /** 공중 덩어리 [가운데, 퍼짐] (풀기 시작점) */
  air: [number, number];
  /** 땅볼 덩어리 몫 (풀기 시작점) */
  groundShare: number;
  /** 퍼짐 배율 = 1 − contactSpread × 정타 z (정타 z = 정타 로짓 ÷ contactSd), spreadMin~spreadMax로 자른다 */
  contactSpread: number;
  contactSd: number;
  spreadMin: number;
  spreadMax: number;
  /** 각도 성향이 뚜렷하면(|θ| ≥ tendencyFull) 퍼짐을 1 − tendencyTighten배로 (그 사이는 선형) */
  tendencyTighten: number;
  tendencyFull: number;
  /** 땅볼 단타(내야안타) 로짓에 더하는 주력 효과: speedGb × (주력 − 0.5) × 2 */
  speedGb: number;
  /** 거리(파워) 로짓이 땅볼 밖 2루타·3루타 로짓에 들어가는 배율 (장타 몫) */
  powerXbh: number;
}
/**
 * 인플레이 처리 조정값 (rules.ts, 엔진 2 6단계). 자리 표는 타구를 맡은 수비수 자리별 값, 외야 표는 구장 쪽 [좌익, 중견, 우익].
 * "어깨" 능력이 없어 외야수의 수비 런을 어깨로도 쓴다 (armPerRun, 추정).
 */
export interface PlayParams {
  /** 병살 확률 배율: 땅볼을 받은 자리 */
  dpSlot: Partial<Record<'P' | 'C' | '1B' | '2B' | '3B' | 'SS', number>>;
  /** 병살 확률 × (1 − dpSpeed × (타자 주력 − 0.5) × 2): 주력 1이면 1 − dpSpeed배, 0이면 1 + dpSpeed배 */
  dpSpeed: number;
  /** 병살이 아닌 땅볼(1루 주자, 2아웃 미만)에서 선행 주자를 잡고 타자가 1루에 사는(포스·야수선택) 확률. 나머지는 타자 아웃·주자 진루 */
  forceLead: Partial<Record<'P' | 'C' | '1B' | '2B' | '3B' | 'SS', number>>;
  /** 땅볼 아웃 때 2루 주자가 3루로 가는 확률 (3루가 비고 포스가 아닐 때) */
  groundAdvance: Partial<Record<'P' | 'C' | '1B' | '2B' | '3B' | 'SS', number>>;
  /** 외야 뜬공 희생플라이 배율: 구장 쪽 [좌익, 중견, 우익] */
  sfSide: [number, number, number];
  /** 외야 라인드라이브 아웃의 희생플라이 배율 (얕고 빨라 3루 주자가 덜 들어온다) */
  sfLineDrive: number;
  /** 외야 뜬공 아웃에 2루 주자가 3루로 가는 확률: 구장 쪽 [좌익, 중견, 우익] */
  flyAdvance: [number, number, number];
  /** 단타에 1루 주자가 3루까지 가는 확률 배율: 공이 간 구장 쪽 [좌익, 중견, 우익] */
  firstToThirdSide: [number, number, number];
  /** 외야수 수비 1런당 주자 추가 진루(희생플라이, 단타 1→3·2→홈, 2루타 1→홈) 확률 감소 (어깨, 추정) */
  armPerRun: number;
}

/**
 * 실책 (rules.ts, 엔진 2 7단계). 타구를 맡은 수비수가 실책한다. 모두 임시값 (자료 없음: 리그 실책 수·자리별 실책·송구/포구 구분을 받지 않았다)
 */
export interface ErrorParams {
  /** 실책 출루가 그 자리 수비수에게 가는 몫 (합으로 나눠 쓴다). 아웃이 될 타구 하나의 실책 확률 = 리그 값 × norm × (몫 ÷ 그 자리 아웃 타구 몫) × 수비 런 보정 */
  share: ZoneFielders;
  /** 리그 실책 출루를 맞추는 배율 (2023~2025 engine2_baseline으로 맞춤) */
  norm: number;
  /** 땅볼 실책 중 송구 실책 몫 (자리별). 나머지는 포구 실책 */
  throwShare: ZoneFielders;
  /** 송구 실책 때 타자를 포함한 모든 주자가 한 베이스 더 가는 확률 */
  throwExtra: number;
  /** 외야 공중 타구 포구 실책 때 모든 주자가 한 베이스 더 가는 확률 */
  outfieldExtra: number;
  /** 외야 안타(단타·2루타) 하나에 외야수 실책(공 빠뜨림·송구)으로 모든 주자가 한 베이스 더 갈 확률 ÷ 그 해 실책 출루 값 (env.roe) */
  onHit: number;
  /** 폭투·포일·보크 진루 중 포일 몫. 포일로 들어온 3루 주자의 득점은 비자책 */
  passedBall: number;
}

export type ZoneFielders = Partial<Record<'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF', number>>;

/**
 * 주루·작전 (rules.ts, 엔진 2 8단계). 자료가 없어 모두 임시값 (도루 시도·성공은 선수 기록, 리그 도루·폭투·희생번트 수로만 맞춘다)
 */
export interface RunParams {
  /** 3루 도루: 2루 주자(3루 빔)의 시도 확률 = 그 주자의 도루 시도율 × stealScale × 이 값 */
  thirdShare: number;
  /** 3루 도루 성공률 보정 (2루 도루 성공률에 더한다) */
  thirdPct: number;
  /** 1·2루에서 3루 도루를 걸 때 1루 주자도 함께 뛰는 이중 도루 몫 */
  double: number;
  /** 좌투수: 1루 주자 도루 시도 배율, 성공률 보정 (주자를 보고 던진다, 견제·퀵모션의 몫). 우투수 성공률 보정은 리그 평균이 0 안팎이 되게 */
  leftyAttempt: number;
  leftyPct: number;
  rightyPct: number;
  /** 견제사: 도루할 수 있는 1루 주자가 있는 타석마다 = 이 값 × min(3, 주자 도루 시도율 ÷ 0.05) × (좌투수면 leftyPickoff) */
  pickoff: number;
  leftyPickoff: number;
  /** 폭투·보크 확률에 곱하는 투수 제구 = (투수 볼넷 배율)^이 값 (0.4~2.5배로 자름) */
  wildPitchControl: number;
  /** 피치아웃 (AI 감독, 타석 첫 공): 도루 시도율이 이 값 넘는 1루 주자(2루 빔, 2아웃 전)에게 거는 확률 pitchout */
  pitchoutThreat: number;
  pitchout: number;
  /** 피치아웃 공에 뛴 주자의 도루 성공률 보정 */
  pitchoutPct: number;
  /**
   * 히트앤드런 (AI 감독, 타석 첫 공): 1루 주자(2루 빔), 2아웃 전, 주자 주력 ≥ hnrSpeed, 타자 삼진 배율 ≤ hnrContact일 때 확률 hnr × 감독 도루 성향.
   * 타자는 첫 공에 반드시 휘두른다: 헛스윙·파울·인플레이 = hnrSwing (2025 투구 자료 0-0 카운트 스윙 결과 몫, count_pitch.csv).
   * 헛스윙이면 주자는 도루 (성공률 + hnrMissPct), 인플레이면 병살 없음·단타에 1루 주자 3루 + hnrExtra·뜬 라이너에 귀루 실패 hnrDoubledOff
   */
  hnr: number;
  hnrSpeed: number;
  hnrContact: number;
  hnrSwing: [miss: number, foul: number, inPlay: number];
  hnrMissPct: number;
  hnrExtra: number;
  hnrDoubledOff: number;
}

/**
 * 번트 (rules.ts, 엔진 2 8단계). 결과 몫은 임시값 (번트 결과 자료 없음), 투구 수는 HF 투구 자료
 */
export interface BuntParams {
  /** 희생번트 시도 결과 몫 (나머지 = 성공: 타자 아웃, 주자 한 베이스): 내야안타(× 타자 주력 ÷ 0.5), 선행 주자 포스아웃(타자 1루), 타자만 아웃(뜬공·스리번트), 병살 */
  hit: number;
  leadOut: number;
  popOut: number;
  dp: number;
  /** 스퀴즈 (AI 감독): 3루 주자, 2아웃 전, 7회 이후 1점 차 이내, 약한 타자일 때 확률 squeeze × 감독 번트 성향 */
  squeeze: number;
  /** 스퀴즈 결과 몫 (나머지 = 성공: 3루 주자 득점, 타자 아웃): 3루 주자 홈 아웃(타자 1루), 뜬공 병살(타자·3루 주자 아웃) */
  squeezeOut: number;
  squeezeDp: number;
  /** 번트 타석 투구 수 분포 1~5구 (HF 투구 자료 2023~2025 희생번트 타석, data-src/pbp_derived/bunt.csv, 평균 1.74구) */
  pitches: [number, number, number, number, number];
}

/** AI 감독 경기 중 교체 (엔진 2 9단계, subs.ts). 감독 성향 '대타·대주자 빈도'(tactics.sub)로 phGain·prGap을 나눈다. 모두 임시값 */
export interface SubParams {
  /** 대타: 이 회부터, 점수 차가 이만큼 이내 */
  phInning: number;
  phMaxDiff: number;
  /** 대타 기준: 남은 타석의 기대 득점 이득 − 남은 이닝 수비 손해가 이 값(런) 이상 */
  phGain: number;
  /** 대주자: 이 회부터, 점수 차가 이만큼 이내, 주력이 prSlow 이하인 주자를 prGap 이상 빠른 벤치 선수로 */
  prInning: number;
  prMaxDiff: number;
  prSlow: number;
  prGap: number;
  /** 대수비: 이 회부터 리드 중일 때, 그 자리 수비 런(한 시즌)이 이만큼 이상 나은 벤치 선수로 (반 이닝에 한 명) */
  defInning: number;
  defGain: number;
}

/** AI 감독 2 (엔진 2 10단계, manager.ts): 고의4구, 전진 수비, 좌우 원포인트. 모두 임시값 (고의4구 rate만 2023~2025 ibb.csv 세 해 평균에 맞춤: 10단계 0.3, 13단계 감독 성향 고의4구 빈도를 넣으며 0.26) */
export interface Manager2Params {
  /**
   * 고의4구: 1루가 비고 득점권 주자, 지금 타자가 팀 중간 이상이고 다음 타자보다 가치가 gap 이상 높을 때 확률 rate × 아웃별 배율(outs) × (후반 접전이 아니면 early).
   * minInning 전에는 후반 접전이 아니면 하지 않는다. wildShare: 수동 고의4구 공 하나의 폭투·포일 확률 = 보통 공 하나의 확률 × 이 값
   */
  ibb: { rate: number; gap: number; outs: [number, number, number]; early: number; minInning: number; wildShare: number };
  /**
   * 전진 수비: 3루 주자, 2아웃 전, inning회 이후 수비 팀 리드가 0~maxLead점일 때 확률 rate. 그 타석 동안 땅볼 아웃의 hit만큼이 내야를 빠진 단타,
   * 땅볼 아웃 때 3루 주자 득점 확률 × score
   */
  infieldIn: { inning: number; maxLead: number; rate: number; hit: number; score: number };
  /**
   * 좌우 원포인트: inning회 이후 점수 차 maxDiff 이내, 우투수가 마운드에 있고 좌타자(양타 제외)가 팀 중간 이상일 때, 필승조·마무리가 아닌 좌완 구원으로 확률 rate.
   * 그 타자를 상대한 뒤 다음 타자가 좌타가 아니면 바꾼다
   */
  onePoint: { inning: number; maxDiff: number; rate: number };
  /** 기용표로 역할을 정하지 않은 불펜에서 필승조로 보는 서열 수 (마무리 빼고) */
  setup: number;
}

/** 시대별 주루·병살·희생플라이·도루 배율 한 줄 (엔진 2 13단계). 현대 값(params의 기본값)에 곱한다 */
export interface EraRunning {
  /** 기준 해 (검증 도구로 맞춘 해) */
  year: number;
  /** 병살 기본 확률 배율 */
  dp: number;
  /** 희생플라이 기본 확률 배율 */
  sf: number;
  /** 도루 시도 배율 */
  steal: number;
  /** 주자 추가 진루(단타 1루→3루·2루→홈, 2루타 1루→홈) 확률 배율 */
  adv: number;
  /**
   * 실책 배율: 그 해 실책 출루 값(LeagueEnv.roe = roePerUnearnedShare × 비자책 비율)에 곱한다. 실책 출루와 모든 실책 확률이 roe를 따른다.
   * 2001~2026은 리그 경기당 실책이 비자책 비율에 비례해(약 15.6배) 1이고, 2000년 이전은 비자책 비율이 실책보다 높아 1보다 작다
   */
  err: number;
  /**
   * 경기 안 자책 판정(실책 출루 주자, 실책을 아웃으로 친 이닝 재구성, 실책·포일로 더 간 주자)이 만드는 비자책 실점 비율 (엔진 2 14단계).
   * 모자란 몫 채우기(unearnedRun)가 그 해 비자책 비율에서 이것을 뺀 만큼만 채운다. 없으면 unearnedInGame (한 값)
   */
  ue?: number;
}

/**
 * 구장 제원 회귀 (구장효과 기획안 4.2·6.1·6.2, P4 reports/park-specs-fit.md). log 지수 = a + b × 평균 거리(좌·중·우 평균, m) + 높이 규칙.
 * P5부터 옛 해 대리값(engine/park.ts: 차이 방식·짐작)이 쓴다. 신구장 펜스(P6)도 같은 값을 쓸 자리
 */
export interface ParkSpecFit {
  /** 홈런 log 지수 [a, b] */
  hr: [number, number];
  /** (2루타 + 3루타) log 지수 [a, b] */
  xb: [number, number];
  /** 실제 구장 짐작의 당김: 짐작 log 지수 × w (0 = 중립) */
  w: number;
  /** 상·하한: 홈런·(2루타 + 3루타) 지수(100 = 리그), 득점 계수 f, 좌타·우타 홈런 지수 */
  clamp: { hr: [number, number]; xb: [number, number]; f: [number, number]; side: [number, number] };
  /** 펜스 높이 규칙: 기준 높이(m)보다 1m 높을 때마다 홈런 지수 × (1 + hr), (2루타 + 3루타) × (1 + xb). 낮으면 반대 (log로 대칭) */
  height: { base: number; hr: number; xb: number };
  /** 좌우 비대칭: 좌·우 펜스 거리 차 1m당 짧은 쪽으로 당겨 치는 타자(좌타는 우측) 홈런 + perM, 상한 ±max. 반대 손은 같은 폭만큼 내린다 */
  asym: { perM: number; max: number };
  /** 신구장 고르기 범위 (m): 좌·우 펜스, 중앙 펜스, 높이 */
  range: { side: [number, number]; center: [number, number]; height: [number, number] };
  /**
   * 게임 안 신구장 단순 규칙 (기획안 6.3, 사용자 결정 2026-10-24 "B"): 고르는 범위의 가장 작은 구장(평균 거리 최소)과 가장 큰 구장의
   * 홈런·(2루타 + 3루타) 지수(100 = 리그). 그 사이 평균 거리는 log 직선으로 잇고 높이·좌우 규칙과 상·하한을 더한다 (당김 없음)
   */
  newPark: { hr: [number, number]; xb: [number, number] };
}

/** 사슬 능력 하나의 등급 눈금 (능력치 v2 1.7·11.2): 등급 = 50 + 10 × e⁻¹((값 − mid) ÷ half), 볼록 곡선 a(위)·b(아래) */
export interface PlateAbility {
  mid: number;
  half: number;
  a: number;
  b: number;
}

/** 볼카운트 사슬 능력 조정값 (능력치 v2 16-1, plate.ts·tools/fit_plate_estimate.ts) */
export interface PlateParams {
  /** 칸마다 [존 비율, 존 안 스윙, 존 밖 스윙, 존 안 맞힘(스윙 중), 존 밖 맞힘, 존 안 파울(맞힘 중), 존 밖 파울, 존 안 루킹 스트라이크(스윙 안 한 공 중), 존 밖 루킹 스트라이크] */
  split: number[][];
  /** 구위 1이 존 밖 스윙 로짓을 움직이는 크기 */
  alpha: number;
  /** 결과 기록으로 짐작하는 적극성 [상수, 삼진 로짓 차, 볼넷 로짓 차, 파워 차, 컨택 차] */
  aggFormula: number[];
  /** 능력별 짐작 쪽으로 당기는 공 수 (존 안·밖 스윙, 맞히기는 스윙, 2S 대처는 2스트라이크 스윙, 끈질김·투구 효율은 맞힘, 제구는 공, 구위는 상대 스윙) */
  regress: { swIn: number; swOut: number; con: number; two: number; tough: number; ctl: number; stuff: number; eff: number };
  /** 등급 눈금 */
  grades: Record<'agg' | 'eye' | 'con' | 'two' | 'tough' | 'ctl' | 'stuff' | 'eff', PlateAbility>;
}

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
  /** 좌우 상성 크기. 반대 손 대결에서 타자의 안타·홈런·볼넷이 이만큼 늘고 삼진이 준다 (D단계 4칸 OPS로 맞춤, tools/manager_check.ts) */
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
  park: {
    hitExp: number;
    hrExp: number;
    /** 사건별 득점 가치: 그 사건이 1개 더 날 때 느는 득점 (tools/park_run_value.ts). 사건별 배율이 내는 득점 계수를 셀 때만 쓴다 (park.ts runFactorOf) */
    runValue: { s1: number; d2: number; t3: number; hr: number };
    specFit: ParkSpecFit;
  };
  /** 투수가 한계 투구 수를 넘긴 뒤 공 1개마다 나빠지는 정도 (엔진 2 4단계) */
  fatiguePerPitch: number;
  /** 경기 안 피로의 최대 (삼진 배율 1 − 이 값, 볼넷·홈런·안타 배율 1 + 이 값) */
  fatigueMax: number;
  /** 선수별 P/PA(리그 대비 비율)를 1 쪽으로 당기는 가상 타석 수 */
  ppaRegress: number;
  /** 볼카운트 사슬 능력 (능력치 v2 16-1, plate.ts) */
  plate: PlateParams;
  /** AI 감독의 투구 수 기준 = 그 시즌 리그 평균 선발·구원의 한계 투구 수 × 이 배율 (manager.ts managerNorms) */
  planScale: { starter: number; relief: number; earlyRelief: number; spread: number };
  /** 볼카운트 사슬이 없는 해결기(B0)일 때 타석당 투구 수 (임시값, 2023~2025 리그 3.9구) */
  pitchesPerPaDefault: number;

  // ---- 인플레이 아웃 처리
  /** 실책 출루 확률 = 이 값 × 그 해 리그의 비자책 실점 비율. 실책 출루 기록이 없어 가정한 값 */
  roePerUnearnedShare: number;
  /**
   * 경기 안 자책 판정(실책 출루 주자, 실책을 아웃으로 친 이닝 재구성, 실책·포일로 더 간 주자)으로 못 잡는 나머지 비자책 몫의 배율.
   * 득점(경기 안 판정으로 자책인 것)이 비자책이 될 확률 = 이 값 × max(0, 비자책 실점 비율 − unearnedInGame) ÷ (1 − unearnedInGame).
   * 기록에만 영향 (엔진 2 7단계, 2026-10-22 2012년 +12.6%를 고치며 비율 배율 0.45 → 모자란 몫 채우기 1)
   */
  unearnedRunScale: number;
  /**
   * 경기 안 자책 판정이 만드는 비자책 실점 비율 (나머지 몫을 끄고 잰 값). 해마다 비자책 비율이 달라도 거의 같다
   * (validate 30시즌: 2012 0.053, 2019 0.061, 2025 0.056. 2026-10-22 엔진 2, 임시값)
   */
  unearnedInGame: number;
  /** 실책 (rules.ts, 엔진 2 7단계) */
  error: ErrorParams;
  /** 폭투·보크 확률 = 이 값 × 그 해 리그의 타석당 폭투+보크 (주자가 있는 타석 기준. 포일 몫 포함). 2026-10-22 8단계에서 타석당 폭투를 처음 재 보니 +24~31%라 2.6 → 2 */
  wildPitchScale: number;
  /** 폭투·보크 기록이 없는 해(2000년 이전)에 쓰는 타석당 값 */
  wildPitchDefault: number;
  /** 희생번트 시도 확률 = 이 값 × 그 해 리그의 타석당 희생번트 (무사에 주자가 1·2루에 있을 때). 실패가 생겨(8단계) 성공 몫으로 나눈 만큼 크다 */
  sacBuntScale: number;
  /** 주루·작전 (엔진 2 8단계, 임시값) */
  run: RunParams;
  /** 번트 (엔진 2 8단계) */
  bunt: BuntParams;
  /** AI 감독 경기 중 교체 (엔진 2 9단계, subs.ts, 모두 임시값) */
  sub: SubParams;
  mgr: Manager2Params;
  /** 추가 진루를 시도한 주자가 아웃될 확률. 견제사 등 그 밖의 주루사 몫까지 여기에 담았다 */
  outOnAdvance: number;
  /**
   * 인플레이 아웃 중 땅볼 ÷ (땅볼 + 뜬공 + 내야 뜬공) (라인드라이브 뺌, 엔진 2 6단계). 그 해 값(groundBallShareByYear)이 없는 해에 쓴다.
   * 선수별 성향(BatSkill.gb·PitSkill.gb)은 이 값의 승산에 곱한다
   */
  groundBallShare: number;
  /** 그 해 리그의 아웃 타구 땅볼 몫 (임시값, 출처 미확인: data-src/batted_ball_derived/batted_ball.csv gb_share_of_gb_fb) */
  groundBallShareByYear: Record<number, number>;
  /**
   * 도루 실패 기록이 없는 해(1982~2002, 자료집 선수 행에 cs가 비었다)의 리그 도루 성공률 (엔진 2 13단계).
   * 가공값: FM코리아 "KBO 타자 기록 DB (1982-2024)" 리그타자 시트의 도루 ÷ (도루 + 도루실패). 원본은 저장소에 두지 않는다.
   * 쓰는 곳: 그 시즌 선수 도루 시도 수 추정(시도 = 도루 ÷ 이 값, 없으면 0.7)과 그 해 리그 도루 환경(LeagueEnv.sbPct, 선수 기록에서 낼 수 없을 때)
   */
  sbPctByYear: Record<number, number>;
  /** 인플레이 아웃 처리 (rules.ts, 엔진 2 6단계): 병살·포스·진루·희생플라이를 타구 유형·자리·주력·어깨로 */
  play: PlayParams;
  /** 타구 모형 (battedball.ts, 엔진 2 5단계) */
  ball: BallParams;
  /**
   * 볼카운트 사슬의 리그 모양 (chain.ts): 칸(볼-스트라이크)별 다음 공이 볼·스트라이크·파울·맞힘·사구일 비율.
   * 매치업마다 손잡이를 풀어 끝 확률을 타석 결과 함수에 맞추므로, 이 모양은 투구 수와 카운트 분포만 정한다 (엔진 2 3단계)
   */
  chainShape: ChainShape;
  /** 그 해 투구 단위 자료가 있는 해의 사슬 모양 (없는 해는 chainShape) */
  chainShapeByYear: Record<number, ChainShape>;
  /** 주자 1루, 2아웃 미만의 땅볼이 병살이 될 기본 확률 (자리·주력 배율을 곱한다, play) */
  doublePlay: number;
  /** 2아웃 미만 외야 뜬공에 3루 주자가 들어올 기본 확률 (라인드라이브·구장 쪽·어깨·주력 보정, play) */
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
  /**
   * 시대별 주루·병살·희생플라이·도루 배율 (엔진 2 13단계, eras.ts withEraRunning). year 오름차순 기준 해의 값이고, 사이 해는 앞뒤 기준 해를
   * 선으로 잇고 처음보다 앞·끝보다 뒤는 그 끝 값을 쓴다. 비어 있으면 모두 1. 시즌을 열 때 doublePlay·sacFly·stealScale과 주자 추가 진루 확률(firstToThirdOnSingle·secondToHomeOnSingle·firstToHomeOnDouble)에 곱한다
   */
  eraRunning: EraRunning[];
  /**
   * 시간 제한 흉내 (엔진 2 14단계 물음 1, 2026-10-23 사용자 결정): 경기 시각이 없어 시간 제한(1982~2002 야간 경기 개시 4시간, 2004 4시간)을
   * 그대로 넣을 수 없어서, 그 해 정규시즌 경기는 from회 끝에 동점이면 이닝마다 확률 end로 끝나 무승부가 된다 (game.ts, 경기 난수의 'time' 줄기).
   * 연도 → 값. 없는 해는 시간 제한 없음. 포스트시즌은 timeLimitPostseason에 있는 해만 같은 값을 쓴다
   */
  timeLimit?: Record<number, { from: number; end: number }>;
  /**
   * 포스트시즌에도 시간 제한 흉내를 쓰는 해 (2026-10-24 사용자 결정: 원문으로 확인된 해만). 그 해 timeLimit 값(정규시즌과 같은 시작 회·확률)을 쓴다.
   * 없는 해의 포스트시즌은 시간 제한 없음
   */
  timeLimitPostseason?: number[];

  // ---- 선수 기용
  /**
   * 야수 휴식 (엔진 2 11단계): 경기 전 피로(body)가 body.restFrom을 넘은 만큼에 곱하는 휴식 확률 (피로 1당).
   * 0이면 쉬지 않는다 (가을야구·올스타전)
   */
  restChance: number;
  /** 포수의 휴식 확률 배율 (피로 1당, restChance와 같은 쓰임) */
  catcherRestChance: number;
  /** 야수 체력 (엔진 2 11단계, team.ts hitterFatigue). 모두 임시값 */
  body: BodyParams;
  /** 선수 컨디션 (엔진 2 12단계, condition.ts, docs/컨디션_기획안.md). 모두 임시값 */
  cond: CondParams;
  /** 부상과 이탈 이벤트 (injury.ts) */
  injury: InjuryParams;

  // ---- 수비 (defense.ts)
  /**
   * 하드힛 이력 선수의 주 포지션을 정하는 시작 연도 앞 1·2·3시즌 자리별 타석 가중치 (ratings.ts hardhitPositions, 포지션 2안 2026-10-22 사용자 결정).
   * 최근일수록 무겁게 (임시값)
   */
  positionWeights: [number, number, number];
  /**
   * 이력이 짧은 선수 (2026-10-22 사용자 "박석민은 3루 시작이 맞지"): 시작 앞 3시즌 하드힛 타석 합이 이보다 적으면 (0보다 크고)
   * 2안 대신 예전 규칙 (자료집 주 포지션 → 그 시즌 포지션). 임시값
   */
  shortHistoryPa: number;
  /**
   * 수비수 한 명의 수비 1런당 팀 인플레이 안타가 아웃으로 바뀌는 몫 (battedball.ts: 그 수비수에게 간 타구에서만 바꾼다).
   * 1런 ≈ 안타→아웃 0.75런, 팀 한 시즌 인플레이 안타 약 1,170개에서 1/880 (임시값). 엔진 1의 팀 수비 합(T5)과 같은 크기
   */
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

/** 야수 체력 (엔진 2 11단계, 단위는 '경기'). 모두 임시값 */
/** 선수 컨디션: 며칠 이어지는 흐름 (AR(1)) + 몸 상태 사건. 값은 [−1, +1], 0 = 평소 (docs/컨디션_기획안.md 1장) */
export interface CondParams {
  /** 흐름이 하루에 남는 비율 (1 − 0쪽으로 돌아가는 비율) */
  rho: number;
  /** 하루 흔들림의 표준편차. 오래 둔 흐름의 퍼짐 = sd ÷ √(1 − rho²) */
  sd: number;
  /** 타석 edge에 주는 크기: edge += edge × (타자 컨디션 − 투수 컨디션). 0이면 컨디션이 경기에 영향이 없다 */
  edge: number;
  /** 낱말 경계: 좋음 ≥ good, 나쁨 ≤ bad */
  good: number;
  bad: number;
  /** 흐름 사유 '컨디션 난조'로 바꾸는 값 (≤) */
  awful: number;
  /** false면 AI 감독이 컨디션 나쁜 선발을 미루지 않는다 (점검용 스위치, 엔진 2 13단계 0-4). 없으면 미룬다 */
  delayStarter?: boolean;
}

export interface BodyParams {
  /** 선발 출전 한 경기에 쌓이는 피로. 연장이면 이닝 ÷ 9배 */
  load: number;
  /** 포수 자리로 선발 출전한 경기의 배율 */
  catcher: number;
  /** 지명타자로 선발 출전한 경기의 배율 */
  dh: number;
  /** 교체로 나온 경기 (대타·대주자·대수비) */
  sub: number;
  /** 30세부터 한 살마다 쌓이는 피로에 더하는 몫 */
  agePer: number;
  /** 하루(경기 없는 날 포함)에 빠지는 피로 */
  recover: number;
  /** 피로 상한 */
  cap: number;
  /** 휴식을 생각하기 시작하는 피로 (restChance) */
  restFrom: number;
  /** 이 피로부터 타석이 조금 나빠진다: 넘은 1당 penaltyPer, 최대 penaltyMax (타자 유리도에서 뺀다, pa.ts) */
  penaltyFrom: number;
  penaltyPer: number;
  penaltyMax: number;
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

  // 2026-10-23 엔진 2 9단계: D단계 좌우 4칸 OPS(2023~2025 platoon4.csv)의 같은 손·반대 손 차(좌타 .035·우타 .024, 2025)에 맞춤 (0.035에서는 시뮬 차 약 .038)
  platoon: 0.028,
  homeEdge: 0.013,
  // 임시값: 홈런이 구장에 더 민감하다고 보고 정한 지수 (구장별 득점 비가 f를 따라가는지는 아직 재지 않았다)
  park: {
    hitExp: 0.4,
    hrExp: 1.2,
    // build_data.py PARK_RUN_VALUE와 같은 값 (tools/park_run_value.ts, 2017·2021·2025 × 16시드 합침, 2026-10-24 구장 개발 8:
    // s1 0.627±0.013 · d2 0.875±0.055 · t3 0.874±0.178 · hr 1.394±0.112). 3루타는 흔들림이 커서 2루타 값 (임시값, 잰 값과 거의 같다)
    runValue: { s1: 0.63, d2: 0.88, t3: 0.88, hr: 1.39 },
    // 자리값 (P4 reports/park-specs-fit.md, 하드힛 구성표 9곳): 평균 거리 식. 한 구장 빼고 맞히기 오차가 중립보다 커서
    // (홈런 log 0.350 대 0.255, (2루타 + 3루타) 0.132 대 0.088) 오차가 가장 작은 당김은 0 (= 중립)이지만, 사용자 결정 15
    // (2026-10-24, 기획안 4.3)로 옛 구장마다 다른 맛을 남기려고 C안 짐작을 그대로 쓴다: w 0.5 (임시값, w 0.5의 홈런 오차 0.302).
    // 범위는 표본 최소~최대 (높이는 0.5m 단위로 2.4 → 2.5)
    specFit: {
      hr: [3.2501, -0.0308],
      xb: [-0.5575, 0.0055],
      w: 0.5,
      // 좌우타 홈런 55~149: 하드힛 좌우 표 최소(잠실 좌타)~최대(라팍 우타) (기획안 4.2-5, P5)
      clamp: { hr: [70, 147], xb: [86, 122], f: [0.886, 1.126], side: [55, 149] },
      // 임시값 (기획안 6.2): 1m당 홈런 −4%·(2루타 + 3루타) +3%, 기준 3.4m = P4 높이가 있는 7곳 평균. P4 잰 값(−0.090/m·+0.062/m)은 사직 한 곳이 끌어 쓰지 않음
      height: { base: 3.4, hr: -0.04, xb: 0.03 },
      // 임시값 (기획안 6.2-3): 좌우 거리가 다른 구장이 하나뿐이라 잴 수 없었다. 좌타·우타 타석 비 대신 같은 폭으로 올리고 내린다
      asym: { perM: 0.02, max: 0.08 },
      range: { side: [95, 101], center: [120, 125], height: [2.5, 6] },
      // 임시값 (사용자 결정 2026-10-24, 기획안 10장 물음 1 = B): 실측 범위 끝(홈런 147·70, 2루타+3루타 86·122)을 고르는 범위 끝에 댄다
      newPark: { hr: [147, 70], xb: [86, 122] },
    },
  },
  // 한계 투구 수를 넘기면 능력이 확 꺾인다: 5구당 약 10% (사용자 결정 2026-10-22, 엔진 1은 타자 1명당 0.012 = 공 1개당 약 0.003)
  fatiguePerPitch: 0.02,
  // 임시값 (2026-10-22 사용자 승인): 30구 넘김에서 멈춘다 (엔진 1은 0.3)
  fatigueMax: 0.6,
  // 임시값: 0·50·150을 재 보아 차이가 표본 흔들림 안이었다 (2025 × 4시즌, 실제 300타자 이상 투수 ±0.10구 안 45~47%). 직전 시즌으로 그 해를 맞히는 한계가 더 크다
  ppaRegress: 50,
  // 볼카운트 사슬 능력 (능력치 v2 16-1): tools/fit_plate_estimate.ts가 2023~2025 투구 단위 자료(data-src/pbp_derived/count_zone·batter_plate·pitcher_plate)로 낸 측정값
  // (2026-10-24, 보고 reports/plate-estimate.md). split = 칸마다 리그 [존 비율, 존 안·밖 스윙, 존 안·밖 맞힘, 존 안·밖 파울, 존 안·밖 루킹 스트라이크],
  // alpha = 구위의 존 밖 유인 (투수 존 밖 스윙 로짓 차를 구위·제구로 회귀한 구위 계수), aggFormula = 2022년 이전 적극성 짐작 식 (R² 0.60),
  // regress = 해 사이 공분산으로 잰 당김 공 수, grades = 2023~2025 규정타석 타자·200타자 투수 한 시즌 값의 중앙·중간폭과 볼록 a/b (바닥 0.1, 결정 16·21)
  plate: {
    split: [
      [0.52605, 0.39567, 0.1292, 0.83503, 0.52621, 0.45995, 0.55149, 0.94095, 0.05244], // 0-0
      [0.45533, 0.70033, 0.25007, 0.85344, 0.56133, 0.46617, 0.55849, 0.88082, 0.03063], // 0-1
      [0.31143, 0.86343, 0.31708, 0.87116, 0.6274, 0.48404, 0.5583, 0.81792, 0.01159], // 0-2
      [0.55513, 0.56484, 0.20093, 0.8448, 0.55904, 0.46691, 0.59447, 0.9359, 0.05521], // 1-0
      [0.51361, 0.74698, 0.28159, 0.8484, 0.59138, 0.46527, 0.56235, 0.8921, 0.03605], // 1-1
      [0.39035, 0.90063, 0.40306, 0.87095, 0.64834, 0.47815, 0.56679, 0.80687, 0.01468], // 1-2
      [0.58905, 0.48387, 0.16717, 0.86545, 0.60685, 0.45289, 0.58727, 0.94932, 0.06366], // 2-0
      [0.56457, 0.77218, 0.2967, 0.86443, 0.64246, 0.4673, 0.57484, 0.90408, 0.04206], // 2-1
      [0.4859, 0.91816, 0.46637, 0.87714, 0.66865, 0.47078, 0.56716, 0.81903, 0.01609], // 2-2
      [0.59664, 0.06238, 0.01877, 0.87586, 0.62712, 0.42913, 0.56757, 0.96972, 0.08106], // 3-0
      [0.60046, 0.63811, 0.21884, 0.8908, 0.65989, 0.45027, 0.60433, 0.93127, 0.0567], // 3-1
      [0.56202, 0.91574, 0.45805, 0.88297, 0.69897, 0.45562, 0.5827, 0.83948, 0.02317], // 3-2
    ],
    alpha: 0.209,
    aggFormula: [-0.0297, 0.0122, -0.5357, 0.3956, 1.3251],
    regress: { swIn: 73, swOut: 75, con: 41, two: 742, tough: 215, ctl: 311, stuff: 235, eff: 367 },
    grades: {
      agg: { mid: -0.0168, half: 0.1948, a: 0, b: 0 },
      eye: { mid: 0.0416, half: 0.2787, a: 0.1, b: 0.1 },
      con: { mid: 0.2224, half: 0.3851, a: 0.3, b: 0.1 },
      two: { mid: 0.0143, half: 0.1279, a: 0.1, b: 0.1 },
      tough: { mid: -0.0389, half: 0.148, a: 0.1, b: 0.25 },
      ctl: { mid: 0.005, half: 0.1397, a: 0.1, b: 0.1 },
      stuff: { mid: 0.0005, half: 0.2074, a: 0.1, b: 0.25 },
      eff: { mid: -0.006, half: 0.1524, a: 0.1, b: 0.1 },
    },
  },
  pitchesPerPaDefault: 3.9,
  // starter·relief: 2025 선발 투구 수 86.1구·100구 이상 18.6%, 구원 등판당 16.8구에 맞춘 값. earlyRelief: 5회 이전에 나온 구원은
  // 기준 × 이 값까지 맡긴다 (임시값 (2026-10-22 사용자 승인), 롱릴리프). spread: 경기마다 감독 판단이 기준의 ±이 비율 안에서 흔들린다
  // (투수 능력과 무관, 경기 상황. 임시값: 2026-10-22 사용자 승인 ±12% → 2026-10-23 사용자 결정 ±14%, 2023·2024 선발 100구 이상이 모자라서)
  planScale: { starter: 0.92, relief: 0.9, earlyRelief: 1.6, spread: 0.14 },

  roePerUnearnedShare: 0.2,
  // 엔진 2 7단계: 경기 안 자책 판정을 넣고 0.68 → 0.45로 다시 맞춤 (2023~2025 engine2_baseline 비자책 비율)
  unearnedRunScale: 1,
  unearnedInGame: 0.056,
  // 모두 임시값 (자료 없음). share는 예전 수비진 실책 몫(SS 0.2·3B 0.17·2B 0.17·1B 0.12·외야 각 0.1·C 0.04)에 투수 0.04를 더했다
  error: {
    share: { SS: 0.2, '3B': 0.17, '2B': 0.17, '1B': 0.12, LF: 0.1, CF: 0.1, RF: 0.1, C: 0.04, P: 0.04 },
    norm: 1,
    throwShare: { '3B': 0.6, SS: 0.55, '2B': 0.4, '1B': 0.2, P: 0.5, C: 0.6 },
    throwExtra: 0.35,
    outfieldExtra: 0.3,
    onHit: 0.25,
    passedBall: 0.15,
  },
  wildPitchScale: 2,
  wildPitchDefault: 0.012,
  // 16 → 17.6 (엔진 2 13단계, 2026-10-23): 희생번트가 전 시대 −6~−15%였다 (2012 −15.3%, 2025 −7.3%, 1995 −13.8%)
  sacBuntScale: 17.6,
  run: {
    thirdShare: 0.15, thirdPct: 0, double: 0.5,
    leftyAttempt: 0.85, leftyPct: -0.03, rightyPct: 0.01, pickoff: 0.002, leftyPickoff: 1.5,
    wildPitchControl: 0.8,
    pitchoutThreat: 0.12, pitchout: 0.06, pitchoutPct: -0.3,
    hnr: 0.04, hnrSpeed: 0.45, hnrContact: 0.9, hnrSwing: [0.241, 0.359, 0.4], hnrMissPct: -0.05, hnrExtra: 0.3, hnrDoubledOff: 0.3,
  },
  bunt: { hit: 0.05, leadOut: 0.11, popOut: 0.07, dp: 0.02, squeeze: 0.05, squeezeOut: 0.2, squeezeDp: 0.05,
    pitches: [0.509, 0.301, 0.142, 0.038, 0.01] },
  sub: { phInning: 7, phMaxDiff: 3, phGain: 0.02, prInning: 8, prMaxDiff: 2, prSlow: 0.4, prGap: 0.25, defInning: 7, defGain: 8 },
  mgr: {
    ibb: { rate: 0.26, gap: 0.02, outs: [0.4, 1, 1], early: 0.4, minInning: 4, wildShare: 0.1 },
    infieldIn: { inning: 7, maxLead: 1, rate: 0.8, hit: 0.1, score: 0.4 },
    onePoint: { inning: 7, maxDiff: 2, rate: 0.12 },
    setup: 2,
  },
  outOnAdvance: 0.11,
  // 2010~2025 그 해 값(groundBallShareByYear)의 평균 (임시값, 출처 미확인). 2009년 이전·2027년 이후에 쓴다 (시대별 값은 13단계)
  groundBallShare: 0.52,
  sbPctByYear: {
    1982: 0.692, 1983: 0.587, 1984: 0.607, 1985: 0.603, 1986: 0.581, 1987: 0.615, 1988: 0.651, 1989: 0.644,
    1990: 0.619, 1991: 0.622, 1992: 0.654, 1993: 0.642, 1994: 0.653, 1995: 0.690, 1996: 0.632, 1997: 0.646,
    1998: 0.649, 1999: 0.687, 2000: 0.675, 2001: 0.663, 2002: 0.657,
  },
  groundBallShareByYear: {
    2010: 0.5489, 2011: 0.5304, 2012: 0.5402, 2013: 0.5329, 2014: 0.5222, 2015: 0.5362, 2016: 0.5233, 2017: 0.5214,
    2018: 0.5131, 2019: 0.5156, 2020: 0.5031, 2021: 0.5182, 2022: 0.5343, 2023: 0.5114, 2024: 0.4995, 2025: 0.5247, 2026: 0.5124,
  },
  // 모두 임시값 (자료 없음): 병살은 유격수·2루수 쪽 땅볼이 많고 1루수 쪽은 적다, 포스는 3루·유격 쪽 땅볼이면 선행 주자를 잡기 쉽다,
  // 2루 주자는 오른쪽 땅볼에 3루로 간다, 1루 주자는 우익 쪽 단타에 3루까지 간다. 배율은 리그 평균이 1 안팎이 되게 정했다
  play: {
    dpSlot: { SS: 1.15, '2B': 1.15, '3B': 0.95, P: 1, '1B': 0.5, C: 0.3 },
    dpSpeed: 0.3,
    forceLead: { '3B': 0.65, SS: 0.6, P: 0.65, C: 0.6, '2B': 0.4, '1B': 0.25 },
    groundAdvance: { '1B': 0.8, '2B': 0.75, P: 0.45, C: 0.3, SS: 0.4, '3B': 0.15 },
    sfSide: [0.95, 1.1, 0.95],
    sfLineDrive: 0.9,
    flyAdvance: [0.08, 0.22, 0.35],
    firstToThirdSide: [0.55, 1, 1.45],
    armPerRun: 0.008,
  },
  ball: {
    // 당겨:가운데:밀어 = 2023~2025 리그 49:20:31 (임시값, 출처 미확인: data-src/batted_ball_derived/, 엑셀 원 출처를 모른다)
    dir: [0.49, 0.2, 0.31],
    // 아래는 모두 임시값 (자료 없음. 라인드라이브·안타의 유형 분포는 자료에 없다, batted_ball_derived/README.md)
    type: { S1: [0.38, 0.44, 0.18, 0], D2: [0.06, 0.46, 0.48, 0], T3: [0, 0.3, 0.7, 0] },
    // pu·infieldAir.FB·play.sfLineDrive·sacFly는 2023~2025 희생플라이 리그 값에 맞췄다 (엔진 2 6단계, 내야 공중 아웃은 희생플라이가 안 된다)
    airOut: { ld: 0.1, pu: 0.08 },
    infieldAir: { LD: 0.25, FB: 0.05 },
    zones: {
      ground: [{ '3B': 0.5, SS: 0.5 }, { SS: 0.4, '2B': 0.4, P: 0.2 }, { '2B': 0.45, '1B': 0.55 }],
      air: [{ '3B': 0.45, SS: 0.35, C: 0.2 }, { SS: 0.35, '2B': 0.35, P: 0.1, C: 0.2 }, { '1B': 0.45, '2B': 0.35, C: 0.2 }],
      outfield: [{ LF: 0.75, CF: 0.25 }, { CF: 1 }, { RF: 0.75, CF: 0.25 }],
    },
    // 능력치 v2 16-2 타구각 (기획안 10.2·11.3 결정 14): 구간 경계·두 덩어리 38% N(−12°, 10°) + 62% N(29°, 12°)는 2025년 엔진 표에 맞춘 임시값.
    // 퍼짐·주력·장타 몫 크기는 모두 임시값 (contactSd 0.14는 2026 시작 월드 가중 타석 300 넘는 타자 131명의 정타 로짓 표준편차 0.138, 측정)
    angle: {
      cuts: [10, 25, 35, 50],
      ground: [-12, 10],
      air: [29, 12],
      groundShare: 0.38,
      contactSpread: 0.1,
      contactSd: 0.14,
      spreadMin: 0.8,
      spreadMax: 1.2,
      tendencyTighten: 0.1,
      tendencyFull: 0.8,
      speedGb: 0.4,
      powerXbh: 0.5,
    },
  },
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
  // 엔진 2 6단계에서 2023~2025 병살·희생플라이 리그 값(engine2_baseline)에 다시 맞춤 (0.43·0.76 → 0.478·0.95. 병살은 2012·2019가 낮고 2023~2025가 높아 다섯 해 가운데로)
  // 능력치 v2 16-2 타구각 갈래에서 validate 2025·2019·2012 × 100의 병살 +1.2%·희생플라이 −1.4%(세 해 평균 변화)만큼 되돌림 (0.478·0.95 → 0.472·0.964)
  doublePlay: 0.472,
  sacFly: 0.964,
  groundOutScores: 0.58,

  firstToThirdOnSingle: 0.4,
  secondToHomeOnSingle: 0.75,
  firstToHomeOnDouble: 0.58,
  twoOutBonus: 0.15,
  stealScale: 1.2,
  // 엔진 2 13단계 (2026-10-23, 모두 임시값): tools/validate_engine.ts 20~40시즌으로 1985·1990·1995 득점 ±5%, 병살·희생플라이(온전한 구단) ±10%,
  // 2012·2019 병살·희생플라이·도루를 맞춘 값. 실책(err)은 근거가 있다: 2001~2026은 사용자 수비 기록(리그 실책 합)이 비자책 비율에 비례하고,
  // 2000년 이전은 기사의 경기당 실책(1984 1.7개, 1990년대 1.5개대, OSEN 2023-04-18 등, docs/temp-values.md)이 그 비례식(1985 2.3개)보다 적다.
  // 추가 진루(adv) 1985 0.8은 근거 없이 득점을 맞춘 값이다
  // ue (엔진 2 14단계): 비자책 채우기를 끄고(unearnedRunScale 0) tools/validate_engine.ts 10시즌으로 잰 경기 안 비자책 몫 (측정값, 다른 조정값이 바뀌면 다시 잰다)
  eraRunning: [
    { year: 1985, dp: 0.84, sf: 0.86, steal: 1, adv: 0.8, err: 0.71, ue: 0.083 },
    { year: 1990, dp: 0.96, sf: 0.85, steal: 1, adv: 1, err: 0.79, ue: 0.071 },
    { year: 1995, dp: 0.92, sf: 1.02, steal: 1, adv: 1, err: 0.83, ue: 0.070 },
    { year: 2001, dp: 0.973, sf: 0.981, steal: 1, adv: 1, err: 1, ue: 0.058 },
    { year: 2012, dp: 1.07, sf: 0.91, steal: 1, adv: 1, err: 1, ue: 0.054 },
    { year: 2019, dp: 1.06, sf: 1, steal: 0.95, adv: 1, err: 1, ue: 0.062 },
    { year: 2023, dp: 1, sf: 1, steal: 1, adv: 1, err: 1, ue: 0.064 },
    { year: 2025, dp: 1, sf: 1, steal: 1, adv: 1, err: 1, ue: 0.057 },
  ],
  // 시간 제한 흉내 (모두 임시값): tools/time_limit_fit.ts --seasons 40으로 그 해 실제 무승부 비율에 맞춘 값 (2026-10-23).
  // 시작 회는 12회, 12회 끝 동점 비율이 실제 무승부보다 적으면 한 회씩 앞당겼다 (사용자 결정 전 임시). 1982는 실제 무승부 0이라 넣지 않는다
  timeLimit: {
    1983: { from: 12, end: 0.98 }, 1984: { from: 11, end: 0.35 }, 1985: { from: 12, end: 0.512 }, 1986: { from: 10, end: 0.392 },
    1987: { from: 10, end: 0.386 }, 1988: { from: 11, end: 0.459 }, 1989: { from: 10, end: 0.399 }, 1990: { from: 11, end: 0.845 },
    1991: { from: 11, end: 0.755 }, 1992: { from: 11, end: 0.572 }, 1993: { from: 10, end: 0.405 }, 1994: { from: 11, end: 0.369 },
    1995: { from: 10, end: 0.376 }, 1996: { from: 10, end: 0.377 }, 1997: { from: 11, end: 0.869 }, 1998: { from: 11, end: 0.434 },
    1999: { from: 10, end: 0.544 }, 2000: { from: 10, end: 0.366 }, 2001: { from: 10, end: 0.54 }, 2002: { from: 10, end: 0.396 },
    2004: { from: 10, end: 0.911 },
  },
  // 출처: 나무위키, 2004 포스트시즌 4시간 제한. 다른 해는 원문이 확인되면 더한다
  timeLimitPostseason: [2004],

  restChance: 0.6,
  catcherRestChance: 0.6,
  // 야수 체력 (엔진 2 11단계, 임시값): 2025 상위 9명 타석 비중 실제 0.708에 tools/injury_check.ts 6시즌으로 맞춤 (0.788 → 0.706)
  body: {
    load: 1, catcher: 1.3, dh: 0.6, sub: 0.3, agePer: 0.02, recover: 0.6, cap: 4, restFrom: 1, penaltyFrom: 2, penaltyPer: 0.01, penaltyMax: 0.02,
  },
  // 선수 컨디션 (엔진 2 12단계, docs/컨디션_기획안.md v1). rho·sd·경계·난조는 임시값, edge 0.04는 사용자 결정 크기 (2026-10-22, 근거 자료 없음이라 임시값)
  cond: { rho: 0.9, sd: 0.153, edge: 0.04, good: 0.4, bad: -0.4, awful: -0.7 },
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
    // 경기 중 부상 (엔진 2 11단계, 임시값): 1군 선수의 경기 전 부상을 preShare로 줄이고 나머지를 경기 중 사건이 맡는다.
    // 경기 전 + 경기 중 합한 리그 결장 비율·주축 부상 횟수가 바꾸기 전과 같도록 tools/injury_check.ts로 맞춘 값
    inGame: { preShare: 0.55, perPitch: 0.0002, perRun: 0.00045, perField: 0.00028 },
    // 혹사지수 (기획안 4.6, 임시값). 혹사 부상은 결장 비율 기준과 따로 정한다 (사용자 결정 2026-10-22)
    overuse: {
      on: true, realSpread: 0.15, overPitch: 0.05, b2b: 0.5, b3b: 1.5, shortRest: 1, decay1: 0.02, decay2: 0.002, offseason: 0.25,
      recovery: 0.1, injury: 0.3, overInjury: 0.0002,
    },
  },

  positionWeights: [1, 0.7, 0.5],
  shortHistoryPa: 100,
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
