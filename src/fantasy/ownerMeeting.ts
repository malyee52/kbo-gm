// 구단주와 정기 면담 (2026-10-13 사용자 선택 "구단주와 정기 면담"): 한 해 세 번 (시즌 전, 시즌 중반, 시즌 끝 = 오프시즌).
// 구단주 쪽(모기업 회장의 뜻을 전하는 비서실장, 가상 인물 cast.ts)이 안건(성적·예산·목표)을 꺼내고, 단장이 답·제안하면
// AI가 판정해 구단주 신뢰와 구단 자금(예산 증액·삭감)이 바뀐다. 크기는 판정 단계(leniency.ts)에 따라
import type { GameSession } from '../game/session';
import type { DataStore } from '../data/types';
import { completeJsonText, extractJson, preview, type LlmSettings } from './llm';
import { RULES } from './prompts';
import { leniencyOf, leniencyRule, NEGOTIATE_SCALE } from './leniency';
import { gameContextFor } from './ai';
import { castOf } from './cast';
import type { FantasyEffect } from './effects';
import type { FantasyEntry } from './types';

type Store = Pick<DataStore, 'meta' | 'season' | 'players'> & Partial<Pick<DataStore, 'drafts'>>;

export const OWNER_WHO = '구단주 면담';
export type MeetingSlot = 'pre' | 'mid' | 'end';
export const SLOT_LABEL: Record<MeetingSlot, string> = { pre: '시즌 전 면담', mid: '시즌 중반 면담', end: '시즌 결산 면담' };

/** 지금 열 수 있는 면담 (없으면 null): 시즌 전(개막 뒤 10일 안), 중반(일정 절반 무렵 ±15일), 결산(오프시즌). 해마다 한 번씩 */
export function meetingSlot(g: GameSession): MeetingSlot | null {
  if (!g.league.fantasy) return null;
  let slot: MeetingSlot | null = null;
  if (g.phase === 'offseason') slot = 'end';
  else if (!g.done) {
    const half = Math.floor(g.season.schedule.length / 2);
    if (g.currentDay < 10) slot = 'pre';
    else if (Math.abs(g.currentDay - half) <= 15) slot = 'mid';
  }
  if (!slot) return null;
  const done = (g.fantasy?.log ?? []).some((e) => e.who === OWNER_WHO && e.year === g.year && e.meeting === slot);
  return done ? null : slot;
}

/** 구단주 쪽 안건 (기록하지 않는다. 답과 함께 판정 글에 남는다) */
export async function meetingAgenda(g: GameSession, store: Store, s: LlmSettings, slot: MeetingSlot): Promise<{ speaker: string; agenda: string }> {
  const aide = castOf(g.league).find((c) => c.key === 'owner')!;
  const raw = await completeJsonText(s, {
    system: `너는 KBO 단장 시뮬레이션의 가상 인물 "${aide.name}" (${aide.role})이다. ${aide.persona}
지금은 ${SLOT_LABEL[slot]}이다. 모기업 회장(구단주)의 뜻을 전하며 단장에게 안건을 꺼낸다: 성적 평가, 예산·자금 사정, 목표, 우려나 기대.
구단주 신뢰도·자금·순위를 근거로 3~5문장. 단장이 답하거나 제안할 거리를 남긴다.
${RULES}

[형식] JSON 하나만: {"agenda": "안건 (3~5문장, 대사)"}`,
    messages: [{ role: 'user', content: `[게임 상황]\n${gameContextFor(g, store)}` }],
    mockReply: JSON.stringify({ agenda: '(시험용) 회장님께서 성적을 걱정하십니다. 계획을 말씀해 주시죠.' }),
  });
  const j = extractJson<{ agenda?: string }>(raw);
  const agenda = String(j?.agenda ?? '').trim();
  if (!agenda) throw new Error(`AI가 형식에 맞지 않게 답했습니다. 답 앞부분: ${preview(raw)}`);
  return { speaker: aide.name, agenda: agenda.slice(0, 1500) };
}

/** 단장의 답을 판정 (효과: 구단주 신뢰, 구단 자금) */
export async function meetingJudge(g: GameSession, store: Store, s: LlmSettings, slot: MeetingSlot, speaker: string, agenda: string, answer: string): Promise<Omit<FantasyEntry, 'year' | 'day'>> {
  const l = leniencyOf(g.league);
  const k = NEGOTIATE_SCALE[l];
  const maxTrust = Math.round(6 * k);
  const maxCash = Math.round(30 * k); // 억 원
  const raw = await completeJsonText(s, {
    system: `너는 KBO 단장 시뮬레이션에서 구단주 면담 결과를 판정하는 이야기꾼이다. 구단주 쪽이 안건을 꺼냈고 단장이 답했다.
답이 구단 사정에 맞는지, 설득력·책임감이 있는지, 요구가 무리한지 보고 구단주의 반응과 결정을 정한다.
- trust: 구단주 신뢰 변화 (−${maxTrust}~${maxTrust} 정수)
- cash: 예산 증액(+)·삭감(−) (억 원, −${maxCash}~${maxCash}). 단장이 투자·지원을 설득했으면 늘고, 성적·태도가 나쁘면 줄어든다. 그 밖에는 0
${leniencyRule(l)}
${RULES}

[형식] JSON 하나만: {"title": "면담 결과 한 줄", "text": "구단주의 반응과 결정 (3~5문장)", "trust": 정수, "cash": 억 원}`,
    messages: [{ role: 'user', content: `[게임 상황]\n${gameContextFor(g, store)}\n\n[${SLOT_LABEL[slot]} · ${speaker}의 안건]\n${agenda}\n\n[단장의 답]\n${answer}` }],
    mockReply: JSON.stringify({ title: '(시험용) 면담 결과', text: '회장님이 고개를 끄덕였다.', trust: 2, cash: 5 }),
  });
  const j = extractJson<{ title?: string; text?: string; trust?: unknown; cash?: unknown }>(raw);
  const text = String(j?.text ?? '').trim();
  if (!text) throw new Error(`AI가 형식에 맞지 않게 답했습니다. 답 앞부분: ${preview(raw)}`);
  const trust = Math.max(-maxTrust, Math.min(maxTrust, Math.round(Number(j?.trust) || 0)));
  const cash = Math.max(-maxCash, Math.min(maxCash, Number(j?.cash) || 0));
  const effects: FantasyEffect[] = [];
  if (trust) effects.push({ type: 'trust', delta: trust });
  if (Math.round(cash * 10000)) effects.push({ type: 'cash', amount: Math.round(cash * 10000) });
  return {
    kind: 'chat', who: OWNER_WHO, title: String(j?.title ?? SLOT_LABEL[slot]).slice(0, 80), text: text.slice(0, 2000), meeting: slot,
    ask: `${SLOT_LABEL[slot]} · ${speaker}: ${agenda} / 단장: ${answer}`.slice(0, 2000), ...(effects.length ? { effects } : {}),
  };
}
