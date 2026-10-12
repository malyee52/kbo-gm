// 약속·조건 장부 (자유 모드, 2026-10-13 사용자 선택 "약속·조건 장부").
// 게임 마스터 판정에서 생긴 약속("내년에 현금 20억 더", "우승하면 보너스", "롯데에 빚을 졌다")을 기한과 함께 남긴다.
// 기한이 되면 게임 마스터가 이행·배신을 판정하고(free.ts settlePromises) 그 결과의 조작을 낸다. 진행 중인 약속은 판정 맥락에 들어간다.
// 약속은 이야기 기록(FantasyEntry.promises·settles)으로 들어가므로 재현·불러오기 때 AI 없이 그대로 다시 쌓인다.
import { dateOf, formatDate } from '../game/calendar';
import type { FantasyState } from './types';

export type PromiseStatus = 'open' | 'kept' | 'broken' | 'void';

export interface FantasyPromise {
  id: string;
  /** 맺은 때 (오프시즌이면 day −1) */
  year: number;
  day: number;
  /** 상대 (구단·인물) */
  party: string;
  /** 약속 내용 (누가 무엇을, 조건) */
  text: string;
  /** 기한: 그 시즌의 날(일정 색인), −1이면 그 해 오프시즌 */
  dueYear: number;
  dueDay: number;
  status: PromiseStatus;
  /** 판정한 이야기 글 id */
  settledBy?: string;
}

/** 이야기 글에 실리는 새 약속 (기한은 이미 풀어 둔 값) */
export type PromiseDraft = Pick<FantasyPromise, 'party' | 'text' | 'dueYear' | 'dueDay'>;
export type PromiseSettle = { id: string; status: Exclude<PromiseStatus, 'open'> };

export const PROMISES_OPEN_MAX = 30;

/** 지금 때 (기한 판단용) */
export interface Now {
  phase: 'season' | 'offseason';
  /** 시즌 중이면 그 시즌, 오프시즌이면 막 끝난 시즌 */
  year: number;
  /** 시즌 중 오늘 (일정 색인) */
  day: number;
  /** 그 시즌 일정 길이 */
  seasonDays: number;
}

/**
 * AI가 쓴 기한을 푼다: "2026-08-15"·"8월 15일", "시즌 끝", "오프시즌", "다음 시즌"·"내년", "N일 뒤".
 * 모르면 이번(오프시즌이면 다음) 오프시즌
 */
export function parseDue(raw: unknown, now: Now): { dueYear: number; dueDay: number } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const off = { dueYear: now.phase === 'season' ? now.year : now.year + 1, dueDay: -1 };
  if (!s) return off;
  const inDays = /(\d+)\s*일\s*(뒤|후)/.exec(s);
  if (inDays && now.phase === 'season') return { dueYear: now.year, dueDay: Math.min(now.seasonDays - 1, now.day + Number(inDays[1])) };
  // 다음 시즌: 시즌 중이면 다음 시즌 개막, 오프시즌이면 다음 시즌 한 달쯤
  if (/다음\s*시즌|내년/.test(s)) return { dueYear: now.year + 1, dueDay: now.phase === 'season' ? 0 : 30 };
  if (/시즌\s*(끝|종료|마지막)/.test(s)) return now.phase === 'season' ? { dueYear: now.year, dueDay: now.seasonDays - 1 } : { dueYear: now.year + 1, dueDay: -1 };
  if (/오프\s*시즌|겨울|스토브/.test(s)) return off;
  const m = /(?:(\d{4})\s*[-./년]\s*)?(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(s);
  if (m) {
    const year = m[1] ? Number(m[1]) : now.phase === 'season' ? now.year : now.year + 1;
    const month = Number(m[2]);
    const date = Number(m[3]);
    // 그 날짜 이후 첫 경기일 (같은 시즌이면 일정 길이 안에서)
    const days = year === now.year ? now.seasonDays : 144;
    for (let d = 0; d < days; d++) {
      const dt = dateOf(year, d);
      if (dt.month > month || (dt.month === month && dt.date >= date)) return { dueYear: year, dueDay: d };
    }
    return { dueYear: year, dueDay: -1 };
  }
  return off;
}

/** 기한이 된 약속인가 */
export function isDue(p: FantasyPromise, now: Now): boolean {
  if (p.status !== 'open') return false;
  if (now.phase === 'season') return p.dueYear < now.year || (p.dueYear === now.year && p.dueDay >= 0 && p.dueDay <= now.day);
  return p.dueYear <= now.year;
}

export const duePromises = (state: FantasyState | null | undefined, now: Now): FantasyPromise[] => (state?.promises ?? []).filter((p) => isDue(p, now));

export function dueText(p: Pick<FantasyPromise, 'dueYear' | 'dueDay'>): string {
  return p.dueDay < 0 ? `${p.dueYear} 오프시즌` : formatDate(p.dueYear, p.dueDay, true);
}

/** 판정 맥락: 진행 중인 약속과 최근에 끝난 약속 */
export function promisesContext(state: FantasyState | null | undefined): string {
  const all = state?.promises ?? [];
  const open = all.filter((p) => p.status === 'open');
  const done = all.filter((p) => p.status !== 'open').slice(-5);
  if (!open.length && !done.length) return '';
  const label = { kept: '지킴', broken: '어김', void: '없던 일', open: '진행 중' } as const;
  return [
    '[약속 장부]',
    ...open.map((p) => `- ${p.id} (진행 중, 기한 ${dueText(p)}) 상대 ${p.party}: ${p.text}`),
    ...done.map((p) => `- ${p.id} (${label[p.status]}) 상대 ${p.party}: ${p.text}`),
  ].join('\n');
}

/** 이야기 글의 약속·판정을 장부에 반영 */
export function applyPromises(state: FantasyState, entryId: string, at: { year: number; day: number }, drafts?: PromiseDraft[], settles?: PromiseSettle[]): void {
  for (const s of settles ?? []) {
    const p = state.promises?.find((x) => x.id === s.id && x.status === 'open');
    if (p) { p.status = s.status; p.settledBy = entryId; }
  }
  for (const d of drafts ?? []) {
    if ((state.promises ?? []).filter((x) => x.status === 'open').length >= PROMISES_OPEN_MAX) break;
    state.pseq = (state.pseq ?? 0) + 1;
    (state.promises ??= []).push({ id: `p${state.pseq}`, year: at.year, day: at.day, party: d.party, text: d.text, dueYear: d.dueYear, dueDay: d.dueDay, status: 'open' });
  }
  // 끝난 약속은 최근 40개만
  const closed = (state.promises ?? []).filter((x) => x.status !== 'open');
  if (closed.length > 40) {
    const drop = new Set(closed.slice(0, closed.length - 40).map((x) => x.id));
    state.promises = state.promises!.filter((x) => !drop.has(x.id));
  }
}
