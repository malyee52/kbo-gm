// 기자회견·인터뷰 (2026-10-13 사용자 선택 "기자회견·인터뷰"): 담당 기자(가상 인물, cast.ts)가 요즘 성적·트레이드·사건으로 질문하고
// 단장이 답하면 AI가 반응을 판정해 기사로 쓰고, 팬 만족도·구단주 신뢰·선수단 분위기(컨디션)가 바뀐다.
// 시즌 중 7일에 한 번, 오프시즌에 한 번. 크기는 판정 단계(leniency.ts)에 따라
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

export const PRESS_WHO = '기자회견';
export const PRESS_EVERY = 7;

/** 기자회견을 열 수 없는 이유 (없으면 null) */
export function pressBlock(g: GameSession): string | null {
  const log = g.fantasy?.log ?? [];
  const last = [...log].reverse().find((e) => e.who === PRESS_WHO);
  if (!last) return null;
  if (g.phase === 'season') {
    if (last.year === g.year && last.day >= 0 && g.currentDay - last.day < PRESS_EVERY) return `다음 기자회견은 ${PRESS_EVERY - (g.currentDay - last.day)}일 뒤에 열 수 있습니다.`;
    return null;
  }
  return last.year === g.year && last.day < 0 ? '이번 오프시즌에는 이미 기자회견을 했습니다.' : null;
}

/** 질문 (기록하지 않는다. 답과 함께 판정 글에 남는다) */
export async function pressQuestions(g: GameSession, store: Store, s: LlmSettings): Promise<{ reporter: string; questions: string[] }> {
  const rep = castOf(g.league).find((c) => c.key === 'reporter')!;
  const raw = await completeJsonText(s, {
    system: `너는 KBO 단장 시뮬레이션의 가상 인물 "${rep.name}" (${rep.role})이다. ${rep.persona}
지금 구단 상황(성적, 연승·연패, 최근 트레이드·영입·사건, 단장 노트)에서 가장 기삿거리가 되는 질문 2~3개를 단장에게 던진다. 날카롭되 무례하지 않게.
${RULES}

[형식] JSON 하나만: {"questions": ["질문1", "질문2", "질문3"]}`,
    messages: [{ role: 'user', content: `[게임 상황]\n${gameContextFor(g, store)}` }],
    mockReply: JSON.stringify({ questions: ['(시험용) 요즘 성적을 어떻게 보십니까?', '(시험용) 다음 계획은요?'] }),
  });
  const j = extractJson<{ questions?: unknown }>(raw);
  const questions = (Array.isArray(j?.questions) ? j!.questions : []).filter((q): q is string => typeof q === 'string' && !!q.trim()).slice(0, 3).map((q) => q.trim().slice(0, 300));
  if (!questions.length) throw new Error(`AI가 형식에 맞지 않게 답했습니다. 답 앞부분: ${preview(raw)}`);
  return { reporter: rep.name, questions };
}

/** 답을 판정해 기사로 (효과: 팬·구단주 신뢰·선수단 컨디션) */
export async function pressJudge(g: GameSession, store: Store, s: LlmSettings, reporter: string, questions: string[], answer: string): Promise<Omit<FantasyEntry, 'year' | 'day'>> {
  const l = leniencyOf(g.league);
  const k = NEGOTIATE_SCALE[l];
  const max = { fans: Math.round(5 * k), trust: Math.round(4 * k), edge: Math.round(0.015 * k * 1000) / 1000 };
  const raw = await completeJsonText(s, {
    system: `너는 KBO 단장 시뮬레이션에서 기자회견 반응을 판정하는 이야기꾼이다. 단장이 기자 질문에 답했다.
답이 상황에 맞는지, 솔직한지, 팬·구단주·선수단이 어떻게 받아들일지 판정하고, 다음 날 나갈 기사로 쓴다.
- fans: 팬 만족도 변화 (−${max.fans}~${max.fans} 정수), trust: 구단주 신뢰 변화 (−${max.trust}~${max.trust} 정수),
  morale: 선수단 분위기(컨디션) 변화 (−${max.edge}~${max.edge} 소수, 3~7일). 대부분은 작게, 실언·명언이면 크게
${leniencyRule(l)}
${RULES}

[형식] JSON 하나만: {"title": "기사 제목", "text": "기사 본문 3~5문장 (단장의 말 인용 가능)", "fans": 정수, "trust": 정수, "morale": 소수}`,
    messages: [{ role: 'user', content: `[게임 상황]\n${gameContextFor(g, store)}\n\n[기자 ${reporter}의 질문]\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n[단장의 답]\n${answer}` }],
    mockReply: JSON.stringify({ title: '(시험용) 단장 "끝까지 간다"', text: '단장이 담담하게 답했다.', fans: 2, trust: 1, morale: 0.01 }),
  });
  const j = extractJson<{ title?: string; text?: string; fans?: unknown; trust?: unknown; morale?: unknown }>(raw);
  const text = String(j?.text ?? '').trim();
  if (!text) throw new Error(`AI가 형식에 맞지 않게 답했습니다. 답 앞부분: ${preview(raw)}`);
  const clampInt = (v: unknown, m: number) => Math.max(-m, Math.min(m, Math.round(Number(v) || 0)));
  const fans = clampInt(j?.fans, max.fans);
  const trust = clampInt(j?.trust, max.trust);
  const edge = Math.max(-max.edge, Math.min(max.edge, Number(j?.morale) || 0));
  const effects: FantasyEffect[] = [];
  if (fans) effects.push({ type: 'fans', delta: fans });
  if (trust) effects.push({ type: 'trust', delta: trust });
  if (edge && g.phase === 'season') effects.push({ type: 'teamForm', side: 'all', edge: Math.round(edge * 10000) / 10000, days: 5 });
  return {
    kind: 'article', who: PRESS_WHO, title: String(j?.title ?? '기자회견').slice(0, 80), text: text.slice(0, 2000),
    ask: `${questions.map((q, i) => `Q${i + 1}. ${q}`).join(' ')} / 단장: ${answer}`.slice(0, 1500), ...(effects.length ? { effects } : {}),
  };
}
