// 트레이드 작업대 (2026-10-23 UI 2단계 U2-5, 기획안 2.4): 화면 상태와 계산. 그리기는 screens/Trade.tsx.
//
// 다섯 단계: 후보 → 비교 → 제안 → 협상 → 최종 검토 (7장 결정 4: 합의 → 확정).
// 협상의 "보내기"는 평가(session.evaluateTrade)만 하고, 상대가 받아들이면 "합의"가 된다.
// 최종 검토에서 "확정"을 눌러야 session.proposeTrade(다시 평가 + 성사)가 돈다. 엔진·AI 판단·조작 기록·재현은 그대로다.
// 화면 상태(비교 칸·제안판·합의·보낸 안)는 세션마다 메모리에만 두고 저장하지 않는다. 선수 상세의 "트레이드에 넣기"·"비교에 넣기"가
// 같은 상태를 쓴다 (비교 칸 공유).
import { useSyncExternalStore } from 'react';
import { MIN_ORG_CATCHERS, MIN_ORG_HITTERS, MIN_ORG_PITCHERS, type TradeEvaluation, type TradeVerdict } from '../ai/trade';
import { currentRuns } from '../ai/value';
import { FIELD_POS, isStarterSkill, type SimPlayer } from '../engine';
import type { GameSession, PickSwap } from '../game/session';
import { parsePick, type DraftPick } from '../league/picks';
import { ruleOf } from '../league/rules';
import { salaryCap } from '../league/salary';
import { runsGrade } from './grades';

export type Step = 'cands' | 'compare' | 'offer' | 'talk' | 'review';
export const STEPS: { key: Step; label: string }[] = [
  { key: 'cands', label: '후보' }, { key: 'compare', label: '비교' }, { key: 'offer', label: '제안' }, { key: 'talk', label: '협상' }, { key: 'review', label: '검토' },
];
/** 비교 칸 수 (기획안 2.4.3) */
export const COMPARE_MAX = 3;

/** 제안판: 상대 구단, 내줄·받을 선수(선수 색인), 현금(만 원, 우리가 주면 +), 지명권(pickId) */
export interface TradeDraft { team: number; give: number[]; get: number[]; cash: number; gp: string[]; rp: string[] }

/** 상대가 받아들인 안 (그때 날짜). 확정 전에는 아무것도 바뀌지 않는다 */
export interface Agreement { draft: TradeDraft; key: string; year: number; day: number }

/** 이 상대에게 보낸 안 한 줄 (화면 상태, 저장하지 않음) */
export interface SentRow { n: number; team: number; year: number; day: number; key: string; verdict: TradeVerdict; message: string; text: string }

export interface DeskState {
  mode: 'deal' | 'shop';
  step: Step;
  compare: number[];
  draft: TradeDraft;
  agreed: Agreement | null;
  sent: SentRow[];
  /** 성사 뒤 결과 한 줄 */
  done: string | null;
  /** 짧은 알림 (요구안 채움, 인원 넘침 등) */
  note: string | null;
}

// ---- 거절 이유 (엔진이 주는 구분만, 기획안 2.4.5. 가치 차이 숫자는 보이지 않는다)

export const VERDICT_SHORT: Record<TradeVerdict, string> = {
  accept: '합의', 'reject-value': '거절 (가치)', 'reject-roster': '거절 (선수단 규칙)', 'reject-invalid': '안 됨 (잘못된 제안)',
};
export const REASON_TEXT: Record<Exclude<TradeVerdict, 'accept'>, string> = {
  'reject-value': '가치가 모자람',
  'reject-roster': '선수단 규칙 (상대의 최소 인원·포수)',
  'reject-invalid': '잘못된 제안 (규정·마감·자금)',
};

// ---- 제안판

export function emptyDraft(team: number): TradeDraft {
  return { team, give: [], get: [], cash: 0, gp: [], rp: [] };
}

/** 같은 안인지 견주는 열쇠 (순서와 상관없이) */
export function draftKey(d: TradeDraft): string {
  const s = <T>(a: T[]) => [...a].sort();
  return JSON.stringify([d.team, s(d.give), s(d.get), d.cash, s(d.gp), s(d.rp)]);
}

export function isEmptyDraft(d: TradeDraft): boolean {
  return !d.give.length && !d.get.length && !d.cash && !d.gp.length && !d.rp.length;
}

/** 소속이 바뀐 선수를 판에서 뺀다 (트레이드·방출 뒤) */
export function pruneDraft(s: GameSession, d: TradeDraft): TradeDraft {
  const P = s.world.players;
  const give = d.give.filter((i) => P[i]?.teamIdx === s.teamIdx);
  const get = d.get.filter((i) => P[i]?.teamIdx === d.team);
  return give.length === d.give.length && get.length === d.get.length ? d : { ...d, give, get };
}

export function draftParts(s: GameSession, d: TradeDraft): { give: SimPlayer[]; get: SimPlayer[]; picks: PickSwap } {
  const P = s.world.players;
  return { give: d.give.map((i) => P[i]), get: d.get.map((i) => P[i]), picks: { give: d.gp.map(parsePick), get: d.rp.map(parsePick) } };
}

export function evaluateDraft(s: GameSession, d: TradeDraft): TradeEvaluation {
  const x = draftParts(s, d);
  return s.evaluateTrade(d.team, x.give, x.get, d.cash, x.picks);
}

/** 이 선수를 지금 트레이드할 수 없는 이유 (없으면 null) */
export function tradeBlockReason(s: GameSession, p: SimPlayer): string | null {
  if (p.foreign) return '외국인 선수는 트레이드할 수 없습니다';
  if (s.phase !== 'season') return '오프시즌 중에는 트레이드할 수 없습니다';
  if (!s.tradeOpen) return s.done ? '시즌이 끝나 트레이드할 수 없습니다' : `트레이드 마감(${s.tradeDl.month}월 ${s.tradeDl.date}일)이 지났습니다`;
  if (p.teamIdx < 0) return '소속 구단이 없는 선수입니다';
  if (s.leaguePlayer(p.id)?.noTradeYear === s.year) return '넘겨받은 지명권으로 입단한 선수는 입단 첫해 트레이드할 수 없습니다';
  return null;
}

// ---- 합의와 확정

/** 협상에 보낸다: 평가만 하고, 받아들이면 합의 */
export function sendDraft(s: GameSession, d: TradeDraft): { ev: TradeEvaluation; agreement: Agreement | null } {
  const ev = evaluateDraft(s, d);
  return { ev, agreement: ev.verdict === 'accept' ? { draft: d, key: draftKey(d), year: s.year, day: s.currentDay } : null };
}

/**
 * 합의가 아직 그대로인가. 판을 고쳤으면 'edited', 다시 평가해서 받아들이지 않으면 'changed'(상대가 생각을 바꿈),
 * 날짜가 지났지만 그대로 받아들이면 'later', 아니면 'ok'
 */
export function agreementStatus(s: GameSession, a: Agreement, current: TradeDraft): 'ok' | 'later' | 'edited' | 'changed' {
  if (draftKey(current) !== a.key) return 'edited';
  if (evaluateDraft(s, a.draft).verdict !== 'accept') return 'changed';
  return a.year !== s.year || a.day !== s.currentDay ? 'later' : 'ok';
}

/** 확정: proposeTrade가 다시 평가하고 받아들이면 성사시킨다 (바로 제안한 것과 같은 결과·조작 기록) */
export function confirmAgreement(s: GameSession, a: Agreement): TradeEvaluation {
  const x = draftParts(s, a.draft);
  return s.proposeTrade(a.draft.team, x.give, x.get, a.draft.cash, x.picks);
}

// ---- 자리 깊이와 바뀌는 것 (보이는 종합 등급만 쓴다)

/** 선수의 자리 열쇠: 야수는 주 포지션(C 1B … DH), 투수는 SP/RP */
export function slotOf(p: SimPlayer): string {
  if (p.isPitcher) return isStarterSkill(p.pit) ? 'SP' : 'RP';
  return p.pos ?? 'DH';
}
export const SLOTS = [...FIELD_POS, 'DH', 'SP', 'RP'] as const;
/** 투수 자리 등급은 상위 몇 명의 평균인가 (임시값) */
const PIT_DEPTH_N = 5;

export function overall(s: GameSession, p: SimPlayer): number {
  return runsGrade(currentRuns(p, s.values), s.world.year);
}

/** 자리 등급: 야수는 그 자리 최고 종합, SP/RP는 상위 5명 평균. 그 자리 선수가 없으면 null */
export function slotGrade(s: GameSession, org: SimPlayer[], slot: string): number | null {
  const gs = org.filter((p) => slotOf(p) === slot).map((p) => overall(s, p)).sort((a, b) => b - a);
  if (!gs.length) return null;
  if (slot !== 'SP' && slot !== 'RP') return gs[0];
  const top = gs.slice(0, PIT_DEPTH_N);
  return Math.round(top.reduce((a, b) => a + b, 0) / top.length);
}

/** 우리 구단 자리 가운데 등급이 낮은 셋 (후보 보드 "우리 약한 자리만") */
export function weakSlots(s: GameSession, n = 3): string[] {
  const org = s.team.org;
  return SLOTS.map((slot) => ({ slot, g: slotGrade(s, org, slot) ?? 0 }))
    .sort((a, b) => a.g - b.g || SLOTS.indexOf(a.slot as typeof SLOTS[number]) - SLOTS.indexOf(b.slot as typeof SLOTS[number]))
    .slice(0, n).map((x) => x.slot);
}

/** 우리 같은 자리 주전 (비교 칸 오른쪽 끝). 야수는 그 자리 최고 종합, 투수도 같은 역할 최고 */
export function ourStarter(s: GameSession, slot: string): SimPlayer | null {
  return s.team.org.filter((p) => slotOf(p) === slot)
    .sort((a, b) => overall(s, b) - overall(s, a) || a.idx - b.idx)[0] ?? null;
}

export type Pair = [number, number];
export interface DepthRow { slot: string; before: number | null; after: number | null }
export interface TradeImpact {
  /** 1군 (받은 선수는 2군으로 들어온다) */
  active: Pair;
  activeLimit: number;
  /** 정식 선수 (육성 제외) / 정원 */
  org: Pair;
  orgLimit: number;
  /** 캡 대상 연봉 합 (지금 소속 기준, 외국인·신인 계약 제외 상위 N명). 캡이 없는 해는 null */
  cap: { before: number; after: number; limit: number } | null;
  /** 구단 자금 (현금을 주고받으면) */
  cash: Pair | null;
  /** 움직이는 선수의 자리 등급 */
  depth: DepthRow[];
  mine: { hit: Pair; pit: Pair; c: Pair };
  other: { hit: Pair; pit: Pair; c: Pair };
  /** 미리 알리는 것: 상대 최소 인원(엔진이 reject-roster로 거절할 일), 우리 정원·포수 */
  warn: string[];
}

function counts(org: SimPlayer[]): { hit: number; pit: number; c: number } {
  const hit = org.filter((p) => !p.isPitcher);
  return { hit: hit.length, pit: org.length - hit.length, c: hit.filter((p) => p.pos === 'C').length };
}

function capOf(s: GameSession, org: SimPlayer[]): number {
  const n = ruleOf(s.league, 'capTopN');
  return org.map((p) => s.leaguePlayer(p.id))
    .filter((lp) => lp && !lp.foreign && lp.contract.kind !== 'rookie' && lp.military?.state !== 'serving')
    .map((lp) => lp!.contract.salary).sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
}

/** 트레이드 뒤 바뀌는 것 (기획안 2.4.4 "전 → 후"). 계산만 하고 아무것도 바꾸지 않는다 */
export function tradeImpact(s: GameSession, d: TradeDraft): TradeImpact {
  const { give, get } = draftParts(s, d);
  const giveSet = new Set(d.give);
  const getSet = new Set(d.get);
  const mineB = s.team.org;
  const mineA = [...mineB.filter((p) => !giveSet.has(p.idx)), ...get];
  const otherB = s.world.teams[d.team]?.org ?? [];
  const otherA = [...otherB.filter((p) => !getSet.has(p.idx)), ...give];
  const reg = new Set(s.registered().map((p) => p.idx));
  const activeB = reg.size;
  const regular = (ps: SimPlayer[]) => ps.filter((p) => !p.dev).length;
  const year = s.world.year;
  const limit = salaryCap(year, s.league);
  const cashNow = s.cashNow();
  const slots = [...new Set([...give, ...get].map(slotOf))].sort((a, b) => SLOTS.indexOf(a as typeof SLOTS[number]) - SLOTS.indexOf(b as typeof SLOTS[number]));
  const cm = counts(mineB), ca = counts(mineA), om = counts(otherB), oa = counts(otherA);
  const orgLimit = ruleOf(s.league, 'orgLimit');
  const out: TradeImpact = {
    active: [activeB, activeB - give.filter((p) => reg.has(p.idx)).length],
    activeLimit: s.world.rules.rosterSize,
    org: [regular(mineB), regular(mineA)],
    orgLimit,
    cap: limit === null ? null : { before: capOf(s, mineB), after: capOf(s, mineA), limit },
    cash: d.cash ? [cashNow, cashNow - d.cash] : null,
    depth: slots.map((slot) => ({ slot, before: slotGrade(s, mineB, slot), after: slotGrade(s, mineA, slot) })),
    mine: { hit: [cm.hit, ca.hit], pit: [cm.pit, ca.pit], c: [cm.c, ca.c] },
    other: { hit: [om.hit, oa.hit], pit: [om.pit, oa.pit], c: [om.c, oa.c] },
    warn: [],
  };
  const name = s.world.teams[d.team]?.name ?? '상대';
  // AI 최소 인원 (ai/trade.ts): 이대로 보내면 엔진이 선수단 규칙으로 거절한다
  if (oa.hit < MIN_ORG_HITTERS && oa.hit < om.hit) out.warn.push(`상대 ${name} 야수 ${om.hit}명 → ${oa.hit}명 (${MIN_ORG_HITTERS}명 아래라 거절됩니다)`);
  if (oa.pit < MIN_ORG_PITCHERS && oa.pit < om.pit) out.warn.push(`상대 ${name} 투수 ${om.pit}명 → ${oa.pit}명 (${MIN_ORG_PITCHERS}명 아래라 거절됩니다)`);
  if (oa.c < MIN_ORG_CATCHERS && oa.c < om.c) out.warn.push(`상대 ${name} 포수 ${om.c}명 → ${oa.c}명 (${MIN_ORG_CATCHERS}명 아래라 거절됩니다)`);
  if (ca.c < 2 && ca.c < cm.c) out.warn.push(`우리 포수가 ${cm.c}명 → ${ca.c}명이 됩니다`);
  if (out.org[1] > orgLimit && out.org[1] > out.org[0]) out.warn.push(`우리 정식 선수가 정원(${orgLimit}명)을 넘습니다 (${out.org[0]} → ${out.org[1]}명, 오프시즌에 정리)`);
  return out;
}

// ---- 화면 상태 (세션마다, 저장하지 않음)

const desks = new WeakMap<GameSession, DeskState>();
const listeners = new Set<() => void>();

function initial(s: GameSession): DeskState {
  const first = s.world.teams.find((t) => t.idx !== s.teamIdx)?.idx ?? 0;
  return { mode: 'deal', step: 'cands', compare: [], draft: emptyDraft(first), agreed: null, sent: [], done: null, note: null };
}

export function deskOf(s: GameSession): DeskState {
  let d = desks.get(s);
  if (!d) {
    d = initial(s);
    desks.set(s, d);
  }
  return d;
}

export function updateDesk(s: GameSession, f: (d: DeskState) => Partial<DeskState>): void {
  const cur = deskOf(s);
  desks.set(s, { ...cur, ...f(cur) });
  for (const l of listeners) l();
}

export function useDesk(s: GameSession): DeskState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => deskOf(s));
}

/** 제안판을 고친다: 합의는 풀리고(다른 안이 되므로) 결과 줄은 지운다 */
export function editDraft(s: GameSession, f: (d: TradeDraft) => TradeDraft, note: string | null = null): void {
  updateDesk(s, (d) => {
    const draft = f(d.draft);
    return { draft, agreed: d.agreed && d.agreed.key === draftKey(draft) ? d.agreed : null, done: null, note };
  });
}

/** 비교 칸에 넣기 (선수 상세·후보 보드). 넣지 못하면 이유 */
export function addToCompare(s: GameSession, idx: number): string | null {
  const d = deskOf(s);
  if (d.compare.includes(idx)) return '이미 비교 칸에 있습니다.';
  if (d.compare.length >= COMPARE_MAX) return `비교 칸은 ${COMPARE_MAX}칸입니다. 하나를 빼고 넣으세요.`;
  updateDesk(s, (x) => ({ compare: [...x.compare, idx] }));
  return null;
}

export function removeFromCompare(s: GameSession, idx: number): void {
  updateDesk(s, (x) => ({ compare: x.compare.filter((i) => i !== idx) }));
}

/** 받을 선수로 넣기 (선수 상세·후보·비교). 다른 구단 선수면 상대가 바뀌고 받을 칸이 비워진다. 넣지 못하면 이유 */
export function addToDraft(s: GameSession, p: SimPlayer): string | null {
  const block = tradeBlockReason(s, p);
  if (block) return `${block}.`;
  if (p.teamIdx === s.teamIdx) {
    const d = deskOf(s).draft;
    if (d.give.includes(p.idx)) return null;
    if (d.give.length >= ruleOf(s.league, 'maxPerSide')) return `한쪽에서 ${ruleOf(s.league, 'maxPerSide')}명까지 고를 수 있습니다.`;
    editDraft(s, (x) => ({ ...x, give: [...x.give, p.idx] }));
    return null;
  }
  const d = deskOf(s).draft;
  const same = d.team === p.teamIdx;
  if (same && d.get.includes(p.idx)) return null;
  if (same && d.get.length >= ruleOf(s.league, 'maxPerSide')) return `한쪽에서 ${ruleOf(s.league, 'maxPerSide')}명까지 고를 수 있습니다.`;
  editDraft(s, (x) => (same ? { ...x, get: [...x.get, p.idx] } : { ...x, team: p.teamIdx, get: [p.idx], rp: [] }),
    same ? null : `상대를 ${s.world.teams[p.teamIdx].name}(으)로 바꿨습니다. 받을 칸을 새로 채웁니다.`);
  return null;
}

/** 보낸 안 한 줄 글 ("이OO + 2028 2R ↔ 박OO") */
export function draftText(s: GameSession, d: TradeDraft, won: (man: number) => string): string {
  const P = s.world.players;
  const pick = (id: string) => { const k: DraftPick = parsePick(id); return `${k.draft} ${k.round}R`; };
  const side = (ps: number[], ks: string[], cash: number) => [...ps.map((i) => P[i].name), ...ks.map(pick), ...(cash > 0 ? [`현금 ${won(cash)}`] : [])].join(' + ') || '없음';
  return `${side(d.give, d.gp, d.cash)} ↔ ${side(d.get, d.rp, -d.cash)}`;
}
