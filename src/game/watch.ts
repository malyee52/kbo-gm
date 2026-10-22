// 관심 명단 (2026-10-23 UI 2단계 공통 기능, 기획안 4장 3·결정 9).
// 선수 id 목록을 그 게임 저장 파일에 담는다 (저장마다 따로, 다른 게임에서 가져오기 없음). 조작 기록에는 넣지 않아 재현(replay)과 상관없다.
// 담은 선수가 어디에 있는지는 그때그때 리그 상태·시즌 월드·오프시즌 단계에서 읽는다:
// 은퇴 = "은퇴" 회색(사용자가 직접 뺀다), 방출 미계약·해외 = 상태 표시로 남김, 지명 안 된 신인 후보 = "지명 안 됨" 뒤 다음 개막 때 자동으로 뺀다
// (session.ts 'open'의 pruneUndrafted).
import { draftTotal, type OffseasonState } from '../league/offseason';
import type { LeagueState } from '../league/types';
import type { SimPlayer } from '../engine';

export interface WatchEntry {
  id: string;
  /** 담을 때 이름 (리그에서 사라진 뒤에도 보이게) */
  name: string;
  /** 담은 시즌 */
  year: number;
}

export type WatchKind = 'team' | 'serving' | 'abroad' | 'fa' | 'unsigned' | 'released' | 'market' | 'prospect' | 'undrafted' | 'retired' | 'gone';

export interface WatchStatus {
  kind: WatchKind;
  /** 상태 낱말 */
  text: string;
  /** 소속 구단 (없으면 -1) */
  team: number;
  /** 회색으로 (은퇴·리그를 떠남) */
  gray: boolean;
}

/** 상태를 읽는 데 필요한 것만 (시험에서 세션 없이 부를 수 있게) */
export interface WatchCtx {
  phase: 'season' | 'offseason';
  league: Pick<LeagueState, 'players' | 'retired' | 'archive' | 'teams'>;
  /** 시즌 월드의 선수 (시즌 중 소속은 이쪽이 최신: 트레이드·방출 반영) */
  worldPlayers: readonly SimPlayer[];
  offseason: OffseasonState | null;
}

export function watchStatus(c: WatchCtx, id: string): WatchStatus {
  const lp = c.league.players.find((p) => p.id === id);
  const team = (t: number): WatchStatus => ({ kind: 'team', text: c.league.teams[t]?.name ?? '-', team: t, gray: false });
  if (!lp) {
    if ((c.league.retired ?? []).some((r) => r.id === id) || (c.league.archive ?? []).some((a) => a.id === id && a.why === 'retired')) {
      return { kind: 'retired', text: '은퇴', team: -1, gray: true };
    }
    return { kind: 'gone', text: '리그를 떠남', team: -1, gray: true };
  }
  if (lp.abroad) return { kind: 'abroad', text: '해외 리그', team: -1, gray: false };
  const off = c.offseason;
  if (c.phase === 'offseason' && off) {
    // 신인 드래프트 후보: 지명 단계 중이면 후보, 지명이 끝났는데 남았으면 지명 안 됨 (육성선수로 데려가면 그 구단)
    if (off.draft?.pool.includes(id) && lp.team < 0) {
      const going = off.stage === 'draft' && off.draft.pick < draftTotal(off) && off.draft.pool.length > 0;
      return going ? { kind: 'prospect', text: '지명 후보', team: -1, gray: false } : { kind: 'undrafted', text: '지명 안 됨', team: -1, gray: false };
    }
    const fa = off.fa.entries.find((e) => e.id === id && e.status === 'open');
    if (fa) return { kind: 'fa', text: `FA 시장 (원 소속 ${c.league.teams[fa.from]?.name ?? '-'})`, team: -1, gray: false };
  }
  if (lp.military?.state === 'serving') return { kind: 'serving', text: `군 복무 (${c.league.teams[lp.team]?.name ?? '소속 없음'})`, team: lp.team, gray: false };
  if (c.phase === 'season') {
    const wp = c.worldPlayers.find((p) => p.id === id);
    if (wp) {
      if (wp.teamIdx >= 0) return team(wp.teamIdx);
      return wp.formerTeam !== undefined ? { kind: 'released', text: '방출 · 미계약', team: -1, gray: false } : { kind: 'market', text: '자유계약 (시장)', team: -1, gray: false };
    }
  }
  if (lp.team >= 0) return team(lp.team);
  if (lp.freeAgent) return { kind: 'unsigned', text: '미계약 FA', team: -1, gray: false };
  return { kind: 'released', text: '방출 · 미계약', team: -1, gray: false };
}

/**
 * 개막 때 지명 안 된 신인 후보를 뺀다: 오프시즌을 닫기 전 드래프트에 남은 후보 가운데, 닫은 뒤에도 소속이 없는 선수.
 * (육성선수로 계약한 선수는 남는다)
 */
export function pruneUndrafted(watch: WatchEntry[], undrafted: ReadonlySet<string>, league: Pick<LeagueState, 'players'>): WatchEntry[] {
  if (!undrafted.size) return watch;
  const teamOf = new Map(league.players.map((p) => [p.id, p.team]));
  return watch.filter((w) => !undrafted.has(w.id) || (teamOf.get(w.id) ?? -1) >= 0);
}
