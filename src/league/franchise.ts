// 프랜차이즈 등급 (기획안 docs/프랜차이즈_트레이드_기획안.md, 2026-11-05): AI 구단이 자기 구단의 얼굴을 쉽게 내주지 않게 하는 트레이드 가산치의 재료.
// - 공개 기록만 읽는다: 그 구단 계보의 재직 시즌 T, 그 구단에서 쌓은 WAR W, 칭호(league.titles). 지금 능력·잠재·숨은 특수능력은 읽지 않는다
//   (거절 문구가 숨은 값을 흘리지 않게. 이 파일은 ratings·potential·traits·scout·value를 가져오지 않는다, tests/franchise.test.ts가 검사).
// - 칭호는 2026-11-05 사용자 결정으로 판정에 쓴다 (전에는 칭호를 AI 판단에 쓰지 않았다). 다른 AI 가치·엔진·연봉·관중은 그대로 칭호를 보지 않는다.
// - 팬덤의 프랜차이즈 스타(stadium.ts)와는 다른 기준이다 (사용자 결정 5: 팬덤 기준은 그대로).
// 문턱은 모두 임시값. 난수를 쓰지 않는다.

import { gameFranchise, lineWar } from './history';
import { faEligible } from './salary';
import { realTitleSeasons } from './titles';
import type { LeaguePlayer, LeagueState } from './types';

/** 0 없음, 1 B 프랜차이즈 스타, 2 A 구단의 얼굴 */
export type FranchiseTier = 0 | 1 | 2;

/** A 구단의 얼굴 문턱: 재직 시즌, 구단 WAR (임시값) */
export const TIER_A = { seasons: 10, war: 25 };
/** B 프랜차이즈 스타 문턱 (임시값) */
export const TIER_B = { seasons: 7, war: 15 };
/** 레전드 칭호·원클럽맨이 그 구단의 것으로 인정되는 재직 (임시값) */
export const TITLE_SEASONS = 7;

/** 선수 id → 가진 칭호 키. 한 번 만들어 여러 선수에 쓴다 */
export function titleKeysOf(league: Pick<LeagueState, 'titles'>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of league.titles ?? []) (out.get(r.id) ?? out.set(r.id, new Set()).get(r.id)!).add(r.key);
  return out;
}

/** 그 구단 계보의 재직 시즌 T와 구단 WAR W. 시작 전 실제 기록(tenure0) + 게임 안 1군 시즌. 이름이 바뀐 구단도 계보로 이어 센다 */
export function franchiseRecord(p: LeaguePlayer, league: LeagueState, team: number): { seasons: number; war: number } {
  const fr = league.teams[team]?.franchise;
  if (fr === undefined) return { seasons: 0, war: 0 };
  const years = new Set<number>();
  let war = 0;
  for (const h of p.history) {
    if (!(h.bat || h.pit) || gameFranchise(league, h.year, h.team) !== fr) continue;
    years.add(h.year);
    war += lineWar(league, null, h, p.pos);
  }
  const t0 = p.tenure0?.franchise === fr ? p.tenure0 : null;
  return { seasons: years.size + (t0?.seasons ?? 0), war: war + (t0?.war ?? 0) };
}

/**
 * 그 구단에서의 등급. 기록 문턱(TIER_A·TIER_B)에 칭호를 더한다 (임시값):
 * - 레전드 칭호 또는 원클럽맨 + 그 구단 재직 TITLE_SEASONS 이상 → A
 * - 그 구단의 프랜차이즈 스타 칭호 → W가 B 문턱 이상이면 A, 아니면 B
 */
export function franchiseTier(p: LeaguePlayer, league: LeagueState, team: number, keys: Map<string, Set<string>> = titleKeysOf(league)): FranchiseTier {
  const { seasons, war } = franchiseRecord(p, league, team);
  if (seasons >= TIER_A.seasons && war >= TIER_A.war) return 2;
  const mine = keys.get(p.id);
  if (mine && seasons >= TITLE_SEASONS && (mine.has('one15') || [...mine].some((k) => k.startsWith('L:')))) return 2;
  if (mine?.has(`fstar:${league.teams[team]?.franchise}`)) return war >= TIER_B.war ? 2 : 1;
  return seasons >= TIER_B.seasons && war >= TIER_B.war ? 1 : 0;
}

/** FA 임박: 계약이 올해 끝나고, 올해를 마치면 FA 자격이 생기는 선수 (시즌 중 service에는 올해 몫이 아직 없어 하나 더해 본다) */
export function faSoon(p: LeaguePlayer, year: number): boolean {
  return faEligible({ ...p, service: p.service + 1 }, year);
}

/** 시작 전 실제 기록의 구단 WAR를 tenure0에 채운다 (시작 때, 칸이 없는 예전 저장은 불러올 때). 칭호·명예의 전당과 같은 셈 */
export function ensureTenureWar(league: LeagueState, store: Parameters<typeof realTitleSeasons>[0]): void {
  if (!league.players.some((p) => p.tenure0 && p.tenure0.war === undefined)) return;
  const real = realTitleSeasons(store, league.startYear);
  for (const p of league.players) {
    if (!p.tenure0 || p.tenure0.war !== undefined) continue;
    const fr = p.tenure0.franchise;
    p.tenure0.war = Math.round((real.get(p.id) ?? []).reduce((s, x) => s + (x.fr === fr ? x.war : 0), 0) * 10) / 10;
  }
}
