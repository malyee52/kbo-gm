// AI 단장 성향과 AI 구단끼리 트레이드 (docs/roadmap.md 2장 4단계 "사람", 2026-10-11).
//
// 성향(구단마다 하나, 새 게임 때 시드로 정한다. 실존 단장 이름은 쓰지 않는다):
//  - 윈나우형: 진출권 3계단 밖까지 우승 도전으로 보고, FA에 더 적극적, 의료 투자를 늘린다
//  - 육성형: 상위 2위 안이 아니면 리빌딩, FA는 젊은 선수 위주, 육성·스카우트 투자를 늘린다
//  - 짠돌이형: 트레이드에서 연봉 부담을 두 배로 보고, FA에 소극적, 투자를 줄인다
//  - 균형형: 지금까지와 같다
// AI끼리 트레이드: 트레이드 마감 전 며칠마다 우승 도전 구단과 리빌딩 구단을 짝지어, 리빌딩 구단의 베테랑을
// 우승 도전 구단의 젊은 선수(필요하면 지명권)와 바꾼다. 양쪽 AI가 모두 자기 기준으로 이득일 때만 성사된다.

import { Rng } from '../engine';
import type { Tendency } from '../ai/trade';
import type { LeagueState } from './types';

export type GmStyle = 'winnow' | 'develop' | 'frugal' | 'balanced';
export const GM_STYLES: GmStyle[] = ['winnow', 'develop', 'frugal', 'balanced'];
export const GM_STYLE_LABEL: Record<GmStyle, string> = { winnow: '윈나우형', develop: '육성형', frugal: '짠돌이형', balanced: '균형형' };
export const GM_STYLE_NOTE: Record<GmStyle, string> = {
  winnow: '당장 성적: 순위가 조금 밀려도 우승을 노리고 베테랑·FA에 돈을 쓴다',
  develop: '미래: 상위권이 아니면 리빌딩, 젊은 선수와 지명권을 아낀다',
  frugal: '절약: 연봉 부담을 크게 보고 FA·투자에 소극적이다',
  balanced: '균형: 순위와 선수단 나이를 보고 판단한다',
};

/** FA 계약 비용을 얼마나 크게 보나 (1 = 지금까지, 작을수록 적극적, 임시값) */
export const GM_FA_COST: Record<GmStyle, number> = { winnow: 0.85, develop: 1.1, frugal: 1.3, balanced: 1 };
/** 육성형은 28세 이하 FA를 덜 비싸게 본다 */
export const GM_FA_YOUNG = 0.85;

/** 새 게임: 구단마다 성향 (플레이어 구단도 정해 두지만 쓰지 않는다). 이미 있으면 그대로 */
export function ensureGm(league: LeagueState): void {
  if (league.gm && league.gm.length >= league.teams.length) return;
  const rng = new Rng(`${league.seed}/gm-style`);
  const out = league.gm ? [...league.gm] : [];
  for (let t = out.length; t < league.teams.length; t++) out.push(GM_STYLES[rng.int(GM_STYLES.length)]);
  league.gm = out;
}

export function gmStyle(league: Pick<LeagueState, 'gm'>, team: number): GmStyle {
  return league.gm?.[team] ?? 'balanced';
}

/** 성향을 반영한 우승 도전·리빌딩 판단. base는 순위·나이로 낸 기본 판단 */
export function styledTendency(style: GmStyle | undefined, base: Tendency, rank: number, cut: number): Tendency {
  if (style === 'winnow') return rank <= cut + 3 ? 'contend' : base;
  if (style === 'develop') return rank <= 2 ? 'contend' : 'rebuild';
  return base;
}

/** AI끼리 트레이드를 볼 날 간격과 그날 시도할 확률 (임시값: 한 시즌 대략 5~10건) */
export const AI_TRADE_EVERY = 5;
export const AI_TRADE_CHANCE = 0.45;

export interface AiTradeRecord {
  year: number;
  day: number;
  /** 우승 도전 구단(베테랑을 받는다), 리빌딩 구단 */
  buyer: number;
  seller: number;
  /** 구매 구단이 받은 선수 id, 내준 선수 id, 내준 지명권 (picks.ts pickId) */
  got: string[];
  gave: string[];
  picks?: string[];
}
