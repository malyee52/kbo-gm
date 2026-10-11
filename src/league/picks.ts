// 지명권 트레이드 (docs/roadmap.md 4장, 2026-10-11).
//
// 규정: KBO 이사회가 2019년 8월 트레이드에 신인 지명권을 넣을 수 있게 했다.
// 한 트레이드에 지명권 2장 이내, 선수와 함께. 넘겨받은 지명권으로 뽑은 선수는 입단 뒤 1년 동안 트레이드할 수 없다.
// 몇 년 뒤 지명권까지 되는지는 확인하지 못해 다음 두 드래프트까지로 둔다 (임시값).
//
// 지명권은 (입단 연도, 라운드, 원래 구단)으로 가리키고, 넘어간 것만 league.pickOwners에 남긴다.
// 순번은 드래프트 때 원래 구단의 순위로 정해지고, 그 자리를 주인이 쓴다 (offseason.ts enterDraft).

import type { Tendency } from '../ai/trade';
import type { LeagueState } from './types';

/** 지명권 트레이드가 되는 첫 시즌 (2019년 8월 규약 개정, 그해 트레이드 마감 뒤) */
export const PICK_TRADE_FROM = 2020;
/** 한 트레이드에 넣을 수 있는 지명권 (양쪽 합) */
export const MAX_PICKS_PER_TRADE = 2;
/** 몇 번째 드래프트까지 (1 = 이번 시즌 뒤 드래프트, 임시값) */
export const PICK_YEARS_AHEAD = 2;
/** 트레이드할 수 있는 라운드 (임시값) */
export const PICK_MAX_ROUND = 5;

export interface DraftPick {
  /** 입단 연도 (그 드래프트는 전해 오프시즌에 연다) */
  draft: number;
  round: number;
  /** 원래 구단 색인 */
  from: number;
}

export const pickId = (p: DraftPick): string => `${p.draft}:${p.round}:${p.from}`;
export function parsePick(id: string): DraftPick {
  const [draft, round, from] = id.split(':').map(Number);
  return { draft, round, from };
}

export function pickOwner(league: Pick<LeagueState, 'pickOwners'>, p: DraftPick): number {
  return league.pickOwners?.find((x) => x.draft === p.draft && x.round === p.round && x.from === p.from)?.owner ?? p.from;
}

export function transferPick(league: LeagueState, p: DraftPick, to: number): void {
  league.pickOwners = (league.pickOwners ?? []).filter((x) => !(x.draft === p.draft && x.round === p.round && x.from === p.from));
  if (to !== p.from) league.pickOwners.push({ ...p, owner: to });
}

/** 시즌 year 중에 그 구단이 가진 트레이드 가능한 지명권 (teams: 1군 구단 색인) */
export function ownedPicks(league: Pick<LeagueState, 'pickOwners'>, team: number, year: number, teams: number[]): DraftPick[] {
  const out: DraftPick[] = [];
  for (let draft = year + 1; draft <= year + PICK_YEARS_AHEAD; draft++) {
    for (let round = 1; round <= PICK_MAX_ROUND; round++) {
      for (const from of teams) {
        const p = { draft, round, from };
        if (pickOwner(league, p) === team) out.push(p);
      }
    }
  }
  return out;
}

/** 한 드래프트·라운드에서 그 구단의 지명권 상황 (오프시즌 화면 "우리 지명권") */
export interface PickLedgerRow {
  draft: number;
  round: number;
  /** 자기 지명권을 아직 가지고 있나 */
  own: boolean;
  /** 자기 지명권을 넘겨받은 구단 (own이 false일 때) */
  givenTo: number | null;
  /** 받아 온 다른 구단의 지명권 (원래 구단 색인) */
  extra: number[];
}

/** 그 구단의 라운드 지명권 장부 (트레이드 대상 라운드 1~PICK_MAX_ROUND) */
export function pickLedger(league: Pick<LeagueState, 'pickOwners'>, team: number, drafts: number[], teams: number[]): PickLedgerRow[] {
  const out: PickLedgerRow[] = [];
  for (const draft of drafts) {
    for (let round = 1; round <= PICK_MAX_ROUND; round++) {
      const owner = pickOwner(league, { draft, round, from: team });
      const extra = teams.filter((t) => t !== team && pickOwner(league, { draft, round, from: t }) === team);
      out.push({ draft, round, own: owner === team, givenTo: owner === team ? null : owner, extra });
    }
  }
  return out;
}

/** 트레이드 가능한 지명권인가 (시즌 year 중) */
export function tradablePick(p: DraftPick, year: number): boolean {
  return Number.isInteger(p.round) && p.round >= 1 && p.round <= PICK_MAX_ROUND && p.draft >= year + 1 && p.draft <= year + PICK_YEARS_AHEAD;
}

/** 드래프트 슬롯(지명 순 구단)을 지명권 주인으로 바꾼다. orig: 원래 구단 */
export function applyPickOwners(league: Pick<LeagueState, 'pickOwners'>, draft: number, slots: number[], kinds: number[]): { slots: number[]; orig: number[] } {
  return {
    slots: slots.map((t, i) => (kinds[i] >= 1 ? pickOwner(league, { draft, round: kinds[i], from: t }) : t)),
    orig: [...slots],
  };
}

// ---- AI의 지명권 가치

/** 드래프트 풀 크기 (가상 풀과 같은 값, offseason.ts DRAFT_POOL) */
const POOL = 150;
/** 성향별로 신인 잠재력(전성기 런)을 지금 가치로 치는 비율 (임시값). 리빌딩 구단이 더 높게 친다 */
export const PICK_SHARE: Record<Tendency, number> = { contend: 0.4, rebuild: 0.8 };
/** 두 번째 드래프트 지명권은 조금 덜 친다 */
const LATER_DRAFT = 0.85;

/** 전체 k번째 지명의 기대 잠재력 (런). 드래프트 잠재력 식(-10 + scale × E^1.2)의 순위별 값 */
export function expectedPotential(overall: number, scale: number): number {
  const k = Math.max(1, Math.min(POOL - 1, overall));
  return Math.max(0, -10 + scale * Math.log(POOL / k) ** 1.2);
}

/**
 * AI가 보는 지명권 가치 (런, 트레이드 이득과 같은 단위).
 * 순번은 이번 시즌 뒤 드래프트면 원래 구단의 지금 순위 역순, 그 뒤 드래프트면 가운데로 친다.
 */
export function pickValue(p: DraftPick, year: number, nTeams: number, rankOf: (t: number) => number, tendency: Tendency, scale: number): number {
  const pos = p.draft === year + 1 ? nTeams - rankOf(p.from) + 1 : (nTeams + 1) / 2;
  const overall = (p.round - 1) * nTeams + pos;
  return expectedPotential(overall, scale) * PICK_SHARE[tendency] * (p.draft === year + 1 ? 1 : LATER_DRAFT);
}
