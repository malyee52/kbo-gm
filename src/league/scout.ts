// 스카우트 추측 (능력치 v2 기획안 17.7·17.8·19장, 사용자 2026-10-24 확정 Q1·Q5·Q12~Q17).
//
// - 플레이어와 AI 구단은 선수의 진짜 능력·천장을 모르고 "진짜 + z × σ"로 본다. z는 보는 쪽·선수·갈래마다 시드로 한 번 고정한 표준정규 근사라
//   (플레이어 `${시드}/scout/${ID}/${갈래}`, AI 구단 `${시드}/aiscout/${구단}/${ID}/${갈래}`) 같은 화면을 다시 열어도, 투자를 바꿨다 되돌려도
//   다른 숫자를 낚을 수 없고, σ가 줄면 추측이 진짜 쪽으로 미끄러진다. 추측 상태는 저장하지 않고 늘 다시 셈한다 (17.7 ④).
// - σ (등급) = 갈래 기본 폭 × 표본 배율 × 관계 배율 × 스카우트 배율. AI 구단은 여기에 난이도 배율 (17.8). 플레이어 쪽에는 난이도가 없다 (Q5 ①).
// - 신인 천장 추측 폭 σ_천장은 아마추어 스카우트 단계 표 (19.2). 숨은 성장 성향 d·실현률·시기 τ는 스카우트도 보지 않는다 (17.4 ②).
// - 스카우트 투자는 세 갈래 (19.3): 아마추어(드래프트·육성선수 보드), 프로(다른 구단·시장 선수 추측), 해외(파견, scoutfx.ts).
// 크기는 모두 임시값 (기획안 숫자 그대로).

import { Rng } from '../engine';
import { activeLevel, CEIL_SIGMA, SCOUT_SCALE } from './finance';

export { CEIL_SIGMA, SCOUT_SCALE };
import { gmStyle } from './gm';
import { settingsOf } from './difficulty';
import { runsGradeRaw, runsPerGrade } from './potential';
import type { LeaguePlayer, LeagueState } from './types';
import { FX_AGENT_SCALE, FX_WEEKS, fxEntry } from './scoutfx';

/** 갈래 기본 폭 (등급, 17.7 ①): 기록이 잘 드러내는 갈래 · 덜 드러내는 갈래 · 거의 안 드러내는 갈래 (임시값) */
export const BASE_SIGMA = { clear: 6, mid: 9, faint: 12 } as const;
export type GuessKind = keyof typeof BASE_SIGMA;
/** 표본 배율 = 1 + SAMPLE_EXTRA × (1 − min(1, 1군 표본 ÷ SAMPLE_FULL)), 기록이 없으면 2.5 (임시값) */
export const SAMPLE_FULL = 1500;
export const SAMPLE_EXTRA = 1.5;
/** 관계 배율: 우리 구단 소속 = 0.25 + 0.75 × 0.6^(우리 구단에서 보낸 시즌 수), 다른 구단 1 (임시값) */
export const RELATION_FLOOR = 0.25;
export const RELATION_DECAY = 0.6;
/** σ가 이보다 작으면 범위 대신 숫자 하나로 보인다 (17.7 ①) */
export const SINGLE_BELOW = 1.5;
/** 난이도 '보통'의 AI 평가 오차 (런, difficulty.ts scoutNoise) */
const NORMAL_NOISE = 6;

/** 보는 쪽: 플레이어(맡은 구단) 또는 AI 구단 */
export interface Observer { team: number; user: boolean }

/** 표준정규에 가까운 값 (균등 넷의 합) */
function gauss(rng: Rng): number {
  return (rng.next() + rng.next() + rng.next() + rng.next() - 2) * Math.sqrt(3);
}

/** 보는 쪽·선수·갈래마다 고정된 추측 어긋남 z */
export function scoutZ(seed: string, who: Observer, id: string, key: string): number {
  return gauss(new Rng(who.user ? `${seed}/scout/${id}/${key}` : `${seed}/aiscout/${who.team}/${id}/${key}`));
}

export function sampleScale(sample: number | null): number {
  if (sample === null || sample <= 0) return 1 + SAMPLE_EXTRA;
  return 1 + SAMPLE_EXTRA * (1 - Math.min(1, sample / SAMPLE_FULL));
}

/** 관계 배율. seasonsWithUs = null이면 다른 구단 선수 */
export function relationScale(seasonsWithUs: number | null): number {
  if (seasonsWithUs === null) return 1;
  return RELATION_FLOOR + (1 - RELATION_FLOOR) * RELATION_DECAY ** Math.max(0, seasonsWithUs);
}

/**
 * AI 구단 난이도 배율 (17.8: 쉬움 1.5 · 보통 1 · 어려움 0.5). 난이도 설정의 AI 평가 오차(scoutNoise, 런: 12·6·2, 자유 편집 가능)에서
 * 위쪽은 (n − 1) × 0.5, 아래쪽은 (1 − n) × 0.75만큼 기울여 세 난이도가 기획안 배율과 같게 한다 (n = scoutNoise ÷ 6)
 */
export function aiDifficultyScale(league: LeagueState): number {
  const n = settingsOf(league).scoutNoise / NORMAL_NOISE;
  return n >= 1 ? 1 + (n - 1) * 0.5 : Math.max(0.5, 1 - (1 - n) * 0.75);
}

/** 그 구단의 스카우트 단계 (amateur = 드래프트·육성, pro = 다른 구단·시장 선수) */
export function scoutLevel(league: LeagueState, team: number, kind: 'amateur' | 'pro'): number {
  return activeLevel(league, team, kind === 'amateur' ? 'scout' : 'scoutPro');
}

/** 갈래 추측 폭 σ (등급) */
export function branchSigma(
  league: LeagueState, who: Observer, kind: GuessKind, o: { sample: number | null; seasonsWithUs: number | null; scout: 'amateur' | 'pro' },
): number {
  const s = BASE_SIGMA[kind] * sampleScale(o.sample) * relationScale(o.seasonsWithUs) * SCOUT_SCALE[scoutLevel(league, who.team, o.scout)];
  return who.user ? s : s * aiDifficultyScale(league);
}

/** 신인 천장 추측 폭 σ_천장 (등급) */
export function ceilingSigma(league: LeagueState, who: Observer): number {
  const s = CEIL_SIGMA[scoutLevel(league, who.team, 'amateur')];
  return who.user ? s : s * aiDifficultyScale(league);
}

/** 화면 꼴: 등급 범위 (5단위 반올림, 20~80 안). σ가 SINGLE_BELOW 아래면 숫자 하나 */
export type GuessView = { kind: 'one'; v: number } | { kind: 'range'; lo: number; hi: number; mid: number };

export function guessView(trueGrade: number, sigma: number, z: number): GuessView {
  const clamp = (x: number) => Math.max(20, Math.min(80, x));
  const mid = clamp(trueGrade + z * sigma);
  if (sigma < SINGLE_BELOW) return { kind: 'one', v: Math.round(mid) };
  const lo = clamp(Math.round((mid - sigma) / 5) * 5);
  const hi = clamp(Math.round((mid + sigma) / 5) * 5);
  return lo === hi ? { kind: 'one', v: lo } : { kind: 'range', lo, hi, mid: Math.round(mid) };
}

export function guessText(v: GuessView): string {
  return v.kind === 'one' ? String(v.v) : `${v.lo}~${v.hi}`;
}

// ---- 스카우트 보고 문구 (17.7 ① 확정 Q1 ①): 천장 − 지금 격차(등급)를 4단계로. 격차는 추측값이라 틀릴 수 있다. 32세부터는 문구 없음

export const GAP_PHRASES: { upTo: number; text: string }[] = [
  { upTo: 3, text: '거의 다 자랐다는 평' },
  { upTo: 9, text: '조금 더 클 수 있다는 평' },
  { upTo: 17, text: '크게 자랄 수 있다는 평' },
  { upTo: Infinity, text: '리그 정상급으로 클 수 있다는 평' },
];
export const PHRASE_MAX_AGE = 31;

/** 문구의 단계 (정렬용): 문구 없음 −1, '거의 다 자랐다' 0 … '리그 정상급' 3 */
export function phraseRank(text: string | null | undefined): number {
  return text ? GAP_PHRASES.findIndex((r) => r.text === text) : -1;
}

export function gapPhrase(gapGrade: number, ageNext: number): string | null {
  if (ageNext > PHRASE_MAX_AGE) return null;
  return GAP_PHRASES.find((r) => Math.round(gapGrade) <= r.upTo)!.text;
}

// ---- 드래프트 보드 (19.2 확정 Q14 ①): 순위 + 묶음 꼬리표 + 한 줄 보고

/** 보드 가치에서 추측 격차에 주는 몫 (다음 시즌 나이별, ai/value.ts 미래 가치 꼴을 단순화, 임시값) */
export function boardGapShare(ageNext: number): number {
  return ageNext <= 20 ? 0.6 : ageNext <= 23 ? 0.5 : ageNext <= 25 ? 0.4 : 0.3;
}
/** AI 구단 성향 가중 (19.2, 임시값): 리빌딩은 격차 ×1.2, 윈나우는 지금 능력 ×1.2 */
export const STYLE_GAP = 1.2;
export const STYLE_NOW = 1.2;
/** 지금 쓸모 문구의 문턱 (추측 지금 등급, 임시값) */
const READY_STARTER = 50;
const READY_BENCH = 44;

/** 추측한 신인: 지금·천장(런), 격차(등급) */
export interface ProspectGuess { now: number; top: number; gapGrade: number; nowGrade: number }

/**
 * 신인(지명·육성 후보) 한 명의 추측. nowRuns는 진짜 지금 능력(런, 후보를 만들 때 잰 값), year는 등급 눈금의 해.
 * 지금 능력은 기록 없는 선수의 '잘 드러나는 갈래' 폭(표본 배율 최대) × 아마추어 배율, 천장은 σ_천장
 */
export function guessProspect(league: LeagueState, who: Observer, p: Pick<LeaguePlayer, 'id' | 'potential'>, nowRuns: number, year: number): ProspectGuess {
  const rpg = runsPerGrade(year);
  const sNow = branchSigma(league, who, 'clear', { sample: null, seasonsWithUs: null, scout: 'amateur' });
  const sCeil = ceilingSigma(league, who);
  const now = nowRuns + scoutZ(league.seed, who, p.id, 'now') * sNow * rpg;
  const top = Math.max(now, p.potential + scoutZ(league.seed, who, p.id, 'ceiling') * sCeil * rpg);
  const nowGrade = runsGradeRaw(now, year);
  return { now, top, nowGrade, gapGrade: runsGradeRaw(top, year) - nowGrade };
}

export interface BoardRow {
  id: string;
  /** 1부터 */
  rank: number;
  tier: string;
  /** 한 줄 보고 */
  note: string;
  /** 정렬에 쓴 스카우트 가치 (런, 추측값. 화면에는 숫자로 내지 않는다) */
  value: number;
}

export interface BoardOpts {
  /** 그 해 구단 수 (묶음 꼬리표) */
  teams: number;
  /** 그 해 지명권 수 (넘으면 '육성감') */
  slots: number;
  /** 다음 시즌 해 (나이·등급 눈금) */
  year: number;
  /** AI 구단: 포수가 모자라면 포수 후보에 더하는 런 (플레이어 보드는 0, 스카우트는 선수만 본다) */
  catcherBonus?: number;
}

export function boardTier(rank: number, teams: number, slots: number): string {
  if (rank <= teams) return '1라운드감';
  if (rank <= teams * 3) return '2~3라운드감';
  if (rank <= slots) return '하위 라운드감';
  return '육성감';
}

function readyText(p: Pick<LeaguePlayer, 'isPitcher'>, nowGrade: number): string | null {
  if (nowGrade >= READY_STARTER) return p.isPitcher ? '바로 1군 선발·필승조감' : '바로 1군 주전감';
  if (nowGrade >= READY_BENCH) return p.isPitcher ? '바로 1군 불펜감' : '바로 1군 백업감';
  return null;
}

/** 스카우트 보고 한 줄 (문구 + 지금 쓸모) */
export function prospectNote(p: Pick<LeaguePlayer, 'isPitcher'>, g: ProspectGuess, ageNext: number): string {
  return [gapPhrase(g.gapGrade, ageNext), readyText(p, g.nowGrade)].filter(Boolean).join(' · ');
}

/**
 * 구단 보드: 후보마다 스카우트 가치 = 추측 지금 + 추측 격차 × 나이 몫 (AI는 성향 가중·포수 필요). 같은 시드 = 같은 보드.
 * now: 후보 id → 진짜 지금 능력(런). 없으면 천장의 절반 아래로 본다 (예전 저장)
 */
export function draftBoard(
  league: LeagueState, who: Observer, pool: LeaguePlayer[], now: Record<string, number> | undefined, o: BoardOpts,
): BoardRow[] {
  const style = who.user ? 'balanced' : gmStyle(league, who.team);
  const rows = pool.map((p) => {
    const ageNext = p.birthYear ? o.year - p.birthYear : 22;
    const g = guessProspect(league, who, p, now?.[p.id] ?? p.potential - 10, o.year);
    const gap = Math.max(0, g.top - g.now) * boardGapShare(ageNext) * (style === 'develop' ? STYLE_GAP : 1);
    const value = g.now * (style === 'winnow' ? STYLE_NOW : 1) + gap
      + (o.catcherBonus && !p.isPitcher && p.pos === 'C' ? o.catcherBonus : 0);
    return { p, g, ageNext, value };
  });
  rows.sort((a, b) => b.value - a.value || a.p.id.localeCompare(b.p.id));
  return rows.map((r, i) => ({
    id: r.p.id, rank: i + 1, tier: boardTier(i + 1, o.teams, o.slots), note: prospectNote(r.p, r.g, r.ageNext), value: r.value,
  }));
}

// ---- 외국인 (19.4): 시장 평판 몸값, 관찰 폭

/** 외국인 몸값을 정하는 시장 평판의 오차 (등급, 모든 구단 공통, 19.4, 임시값). 시드 `${시드}/fx-rep/${ID}` */
export const FX_REP_SIGMA = 6;
/** 관찰 배율: 그 지역에 스카우트 팀이 나가 있던 4주마다 σ × 0.7 (19.4) */
export const FX_WATCH_DECAY = 0.7;

/**
 * 외국인 시장 평판 (런): 진짜 지금 능력 + 모든 구단이 같이 보는 오차. 요구 연봉은 이것으로 정한다 (예전에는 진짜 잠재라 "비싼 후보 = 좋은 후보"로 읽혔다)
 */
export function marketReputation(seed: string, id: string, trueRuns: number, year: number): number {
  return trueRuns + gauss(new Rng(`${seed}/fx-rep/${id}`)) * FX_REP_SIGMA * runsPerGrade(year);
}

/**
 * 외국인 후보의 지금 능력 추측 폭 σ (등급): 기록 없는 선수의 잘 드러나는 갈래 × 프로 스카우트 배율 × 관찰 배율 0.7^(지켜본 주 ÷ 4),
 * 에이전트 추천으로 붙은 후보는 × 1.5 (scoutfx.ts). 관찰 명단 밖의 외국인(KBO에서 뛰다 풀린 선수, 시작 연도 실존 시장 외국인)은 기록 표본으로
 */
export function foreignSigma(league: LeagueState, who: Observer, p: { id: string; sample: number | null }): number {
  const e = fxEntry(league, who.team, p.id);
  if (!e) return branchSigma(league, who, 'clear', { sample: p.sample, seasonsWithUs: null, scout: 'pro' });
  return branchSigma(league, who, 'clear', { sample: null, seasonsWithUs: null, scout: 'pro' })
    * FX_WATCH_DECAY ** (e.weeks / FX_WEEKS) * (e.agent ? FX_AGENT_SCALE : 1);
}

/** 추측 지금 능력 (런): 진짜 + z × σ (z는 그 선수의 'now' 줄기) */
export function guessRuns(league: LeagueState, who: Observer, id: string, trueRuns: number, sigma: number, year: number): number {
  return trueRuns + scoutZ(league.seed, who, id, 'now') * sigma * runsPerGrade(year);
}

// ---- 화면에 보이는 추측 (16-7, 기획안 17.6·17.7): 갈래 등급 범위와 스카우트 보고 문구

/** 화면 갈래 → 기본 폭 묶음 (17.7 ①: 기록이 잘 드러내는 갈래 · 덜 · 거의 안) */
export const GUESS_KIND: Record<string, GuessKind> = {
  contact: 'clear', power: 'clear', eye: 'clear', stuff: 'clear', control: 'clear',
  speed: 'mid', defense: 'mid', arm: 'mid', stamina: 'mid', reliefStamina: 'mid', catcher: 'mid',
  hrSuppression: 'faint',
};

/** 화면 목록의 갈래 추측 셋 (17.6): 타자 컨택·파워·선구, 투수 구위·제구·체력. 짧은 이름은 표 칸용 */
export const GUESS_SET = {
  bat: [{ key: 'contact', label: '컨택', short: '컨' }, { key: 'power', label: '파워', short: '파' }, { key: 'eye', label: '선구', short: '선' }],
  pit: [{ key: 'stuff', label: '구위', short: '구' }, { key: 'control', label: '제구', short: '제' }, { key: 'stamina', label: '체력', short: '체' }],
} as const;

export interface GuessItem { key: string; label: string; short: string; view: GuessView }
/** 갈래 추측 셋과 정렬값 (가운데값 평균) */
export interface GuessSet { pitcher: boolean; items: GuessItem[]; sort: number }

/** 갈래 추측 셋을 글 한 줄로 ("컨택 55~65 · 파워 60 · 선구 45~55"). LLM에 넘기는 글도 플레이어가 보는 이것만 쓴다 */
export function guessSetText(g: GuessSet | null): string {
  return g ? g.items.map((it) => `${it.label} ${guessText(it.view)}`).join(' · ') : '능력 추측 없음';
}

/** 추측 꼴의 가운데값 (정렬·거르기용) */
export function guessMid(v: GuessView): number {
  return v.kind === 'one' ? v.v : v.mid;
}

/** 보는 쪽이 보는 선수 (화면 추측에 필요한 것만) */
export interface Seen {
  id: string;
  /** 1군 표본 (타석·상대 타자, 능력 산출의 sample). 기록 없으면 0 */
  sample: number;
  /** 보는 구단에서 보낸 시즌 수 (우리 소속일 때, 다른 구단 선수면 null) */
  seasonsWithUs: number | null;
  /** 1군 기록이 없는 신인이면 아마추어 스카우트 배율로 */
  amateur?: boolean;
}

/** 그 선수 그 갈래의 추측 폭 σ (등급). 관찰 명단의 외국인 후보는 관찰 기간으로 (foreignSigma) */
export function seenSigma(league: LeagueState, who: Observer, p: Seen, kind: GuessKind): number {
  if (fxEntry(league, who.team, p.id)) return foreignSigma(league, who, { id: p.id, sample: null }) * BASE_SIGMA[kind] / BASE_SIGMA.clear;
  return branchSigma(league, who, kind, { sample: p.sample || null, seasonsWithUs: p.seasonsWithUs, scout: p.amateur ? 'amateur' : 'pro' });
}

/** 화면 갈래 등급의 추측 꼴 (key = 화면 갈래 이름, 진짜 등급은 computeGrades 값) */
export function seenGrade(league: LeagueState, who: Observer, p: Seen, key: string, trueGrade: number): GuessView {
  const kind = GUESS_KIND[key] ?? 'mid';
  return guessView(trueGrade, seenSigma(league, who, p, kind), scoutZ(league.seed, who, p.id, key));
}

/**
 * 스카우트 보고 문구 (천장 − 지금 격차 4단계, 17.7 ①). 격차는 진짜 격차 + z × σ(그 선수의 잘 드러나는 갈래 폭)라 틀릴 수 있다.
 * 신인(amateur)은 천장 추측 폭 σ_천장. 32세부터는 없음
 */
export function seenPhrase(league: LeagueState, who: Observer, p: Seen, nowRuns: number, potential: number, ageNext: number, year: number): string | null {
  const s = p.amateur ? ceilingSigma(league, who) : seenSigma(league, who, p, 'clear');
  const gap = runsGradeRaw(Math.max(nowRuns, potential), year) - runsGradeRaw(nowRuns, year) + scoutZ(league.seed, who, p.id, 'gap') * s;
  return gapPhrase(Math.max(0, gap), ageNext);
}
