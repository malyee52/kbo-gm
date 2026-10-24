// 관심 명단 (2026-10-23 UI 2단계 공통 기능, 기획안 4장 3·결정 9).
// 선수 id 목록을 그 게임 저장 파일에 담는다 (저장마다 따로, 다른 게임에서 가져오기 없음). 조작 기록에는 넣지 않아 재현(replay)과 상관없다.
// 담은 선수가 어디에 있는지는 그때그때 리그 상태·시즌 월드·오프시즌 단계에서 읽는다:
// 은퇴 = "은퇴" 회색(사용자가 직접 뺀다), 방출 미계약·해외 = 상태 표시로 남김, 지명 안 된 신인 후보 = "지명 안 됨" 뒤 다음 개막 때 자동으로 뺀다
// (session.ts 'open'의 pruneUndrafted).
import { josa } from '../league/names';
import { draftTotal, type OffseasonState } from '../league/offseason';
import type { LeagueState } from '../league/types';
import type { SimPlayer } from '../engine';

export interface WatchEntry {
  id: string;
  /** 담을 때 이름 (리그에서 사라진 뒤에도 보이게) */
  name: string;
  /** 담은 시즌 */
  year: number;
  /** 이미 알린 일 (watchSignals의 열쇠). 담을 때의 상태는 알리지 않고 여기에 넣는다. 예전 저장에는 없다 (불러올 때 채움) */
  told?: string[];
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

// ---- 관심 선수 소식 (2026-10-23 사용자 결정 "관심 명단 알림": 소식함에 한 줄, 결정함에는 띄우지 않음)
// 그날 상태에서 "지금 참인 일"(열쇠)을 뽑고, 아직 알리지 않은 열쇠만 소식으로 낸다. 난수 없음, 조작 기록 밖.
// 알린 열쇠는 관심 명단 칸(WatchEntry.told)에 남아 저장 뒤 이어 해도 같은 일을 두 번 알리지 않는다.

export type WatchSignalKind = 'fa' | 'fa-sign' | 'release' | 'trade' | 'posting' | 'abroad' | 'draft' | 'retired';

export interface WatchSignal {
  /** 같은 일이면 같은 열쇠 (연도·구단을 담아 해가 바뀌면 다시 알린다) */
  key: string;
  kind: WatchSignalKind;
  /** 소식 한 줄 */
  text: string;
  /** 소속 구단 이름 (트레이드 가능 묶음용) */
  teamName?: string;
}

export interface WatchNewsCtx extends WatchCtx {
  /** 지금 시즌 연도 (오프시즌이면 막 끝난 시즌) */
  year: number;
  userTeam: number;
  /** 지금 트레이드할 수 있나 (시즌 중, 마감 전) */
  tradeOpen: boolean;
  /** 트레이드 마감 월일 */
  deadline: { month: number; date: number };
}

const subj = (name: string) => `관심 선수 ${name}${josa(name, '가이')}`;

/** 담은 선수에게 지금 참인 일 */
export function watchSignals(c: WatchNewsCtx, id: string, name: string): WatchSignal[] {
  const out: WatchSignal[] = [];
  const teamName = (t: number) => c.league.teams[t]?.name ?? '-';
  const lp = c.league.players.find((p) => p.id === id);
  if (!lp) {
    if (watchStatus(c, id).kind === 'retired') out.push({ key: 'retired', kind: 'retired', text: `${subj(name)} 은퇴했습니다.` });
    return out;
  }
  // 해외 이적 (포스팅·FA). since = 떠나서 뛰는 첫 시즌
  if (lp.abroad?.since !== undefined) {
    const how = lp.abroad.mode === 'posting' ? '포스팅으로 해외 구단에 입단했습니다' : '해외 리그로 떠났습니다';
    out.push({ key: `abroad:${lp.abroad.since}`, kind: 'abroad', text: `${subj(name)} ${how}.` });
  }
  const off = c.offseason;
  if (c.phase === 'offseason' && off) {
    const y = off.year;
    const fa = off.fa.entries.find((e) => e.id === id);
    if (fa) {
      const from = fa.returnee ? '해외에서 돌아와 ' : '';
      out.push({ key: `fa:${y}`, kind: 'fa', text: `${subj(name)} ${from}FA를 신청했습니다${fa.from >= 0 && !fa.returnee ? ` (원 소속 ${teamName(fa.from)})` : ''}.` });
      if (fa.status === 'signed' && lp.team >= 0) {
        const home = lp.team === fa.from;
        out.push({ key: `fa-sign:${y}`, kind: 'fa-sign', text: `${subj(name)} ${home ? '원 소속 ' : ''}${teamName(lp.team)}${josa(teamName(lp.team), '와과')} FA 계약했습니다.` });
      }
    }
    if (off.postings?.some((x) => x.id === id)) out.push({ key: `posting:${y}`, kind: 'posting', text: `${subj(name)} 해외 구단의 포스팅 요청을 받았습니다.` });
    const rel = off.released?.find((r) => r.id === id);
    if (rel && lp.team < 0) out.push({ key: `release:${y}:${rel.from}`, kind: 'release', text: `${subj(name)} ${teamName(rel.from)}에서 방출돼 방출 선수 시장에 나왔습니다.` });
    const pick = off.draft?.picks.find((x) => x.id === id);
    if (pick) out.push({ key: `draft:${y}`, kind: 'draft', text: `${subj(name)} ${teamName(pick.team)}에 지명됐습니다.` });
  }
  if (c.phase === 'season') {
    const wp = c.worldPlayers.find((p) => p.id === id);
    if (wp && wp.teamIdx < 0 && wp.formerTeam !== undefined) {
      // 시즌 중 방출: 오프시즌 방출 선수 시장에 다시 나와도 열쇠가 같아 한 번만 알린다
      out.push({ key: `release:${c.year}:${wp.formerTeam}`, kind: 'release', text: `${subj(name)} ${teamName(wp.formerTeam)}에서 방출돼 시장에 나왔습니다.` });
    }
    // 트레이드 가능: 시즌 중 마감 전, 다른 구단 국내 선수 (ui/tradeDesk.ts tradeBlockReason과 같은 조건)
    if (wp && c.tradeOpen && wp.teamIdx >= 0 && wp.teamIdx !== c.userTeam && !wp.foreign && lp.noTradeYear !== c.year) {
      const t = teamName(wp.teamIdx);
      out.push({ key: `trade:${c.year}:${wp.teamIdx}`, kind: 'trade', teamName: t,
        text: `관심 선수 ${name}${josa(name, '를을')} 트레이드로 데려올 수 있습니다 (${t}, 마감 ${c.deadline.month}월 ${c.deadline.date}일).` });
    }
  }
  return out;
}

/** 알린 열쇠 가운데 지난해보다 오래된 것은 지운다 (같은 일이 다시 참이 될 수 없는 해) */
function keepTold(keys: Iterable<string>, year: number): string[] {
  return [...keys].filter((k) => {
    const y = Number(k.split(':')[1]);
    return !Number.isFinite(y) || y >= year - 1;
  });
}

/** 담을 때·예전 저장을 불러올 때: 지금 참인 일은 알리지 않은 채 알린 것으로 둔다 */
export function markTold(c: WatchNewsCtx, w: WatchEntry): WatchEntry {
  return { ...w, told: keepTold(new Set([...(w.told ?? []), ...watchSignals(c, w.id, w.name).map((s) => s.key)]), c.year) };
}

/**
 * 새로 생긴 일을 소식 줄로 낸다. watch는 told를 고친 새 목록.
 * 같은 날 트레이드 가능이 여럿이면(개막 등) 한 줄로 묶는다.
 */
export function watchNews(c: WatchNewsCtx, watch: readonly WatchEntry[]): { watch: WatchEntry[]; lines: string[] } {
  const lines: string[] = [];
  const trades: { name: string; team: string; text: string }[] = [];
  let changed = false;
  const next = watch.map((w) => {
    const told = new Set(w.told ?? []);
    const fresh = watchSignals(c, w.id, w.name).filter((s) => !told.has(s.key));
    if (!fresh.length) return w;
    changed = true;
    for (const s of fresh) {
      told.add(s.key);
      if (s.kind === 'trade') trades.push({ name: w.name, team: s.teamName ?? '-', text: s.text });
      else lines.push(s.text);
    }
    return { ...w, told: keepTold(told, c.year) };
  });
  if (trades.length === 1) lines.push(trades[0].text);
  else if (trades.length > 1) lines.push(`관심 선수 ${trades.length}명을 트레이드로 데려올 수 있습니다 (마감 ${c.deadline.month}월 ${c.deadline.date}일): ${trades.map((t) => `${t.name}(${t.team})`).join(', ')}.`);
  return { watch: changed ? next : [...watch], lines };
}
