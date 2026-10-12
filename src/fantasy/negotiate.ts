// 판타지 협상 (2026-10-13 사용자 요청 "AI를 설득한다면 더 좋은 조건으로 트레이드가 되는 등 게임 시스템을 건드리는 것"):
// AI가 단장의 설득을 읽고 태도(stance, −3~+3)를 정하면, 그 값이 실제 게임 판단에 들어간다.
// - 트레이드: 상대 구단 호감(goodwill, 런) = 태도 × GOODWILL_PER. AI 트레이드 평가(ai/trade.ts)의 이득에 더해진다. 14일, 다시 협상하면 바뀐다(쌓이지 않음)
// - FA·비FA 다년 계약: 에이전트 설득으로 요구액 할인(최대 10%) 또는 할증(최대 6%)
// 실존 선수는 기록으로만 말한다. 협상 상대는 가상 인물(구단 운영팀장, 에이전트)이다. 같은 상대와는 쉬었다 다시 (쿨다운)
import { Rng } from '../engine';
import type { GameSession } from '../game/session';
import { koreanName } from '../league/names';
import type { LeaguePlayer, LeagueState } from '../league/types';
import { complete, extractJson, type LlmSettings } from './llm';
import { RULES } from './prompts';
import { castOf } from './cast';
import type { FantasyEntry } from './types';

export const GOODWILL_PER = 2;
export const GOODWILL_MAX = 6;
export const GOODWILL_DAYS = 14;
/** 같은 구단과 다시 협상하려면 (정규시즌 일정 날 수) */
export const TRADE_TALK_COOLDOWN = 3;
export const DISCOUNT_MAX = 0.1;
export const SURCHARGE_MAX = 0.06;

const negotiatorCache = new WeakMap<object, Map<string, string>>();

/** 그 구단의 협상 담당 (가상 인물, 게임 시드와 구단 계보로 정해진다) */
export function negotiatorOf(league: Pick<LeagueState, 'seed' | 'players' | 'teams'>, team: number): { name: string; role: string } {
  let m = negotiatorCache.get(league);
  if (!m) negotiatorCache.set(league, (m = new Map()));
  const franchise = league.teams[team]?.franchise ?? String(team);
  let name = m.get(franchise);
  if (!name) {
    const taken = new Set(league.players.map((p) => p.name));
    name = koreanName(new Rng(`${league.seed}/negotiator/${franchise}`), taken);
    m.set(franchise, name);
  }
  return { name, role: `${league.teams[team]?.name ?? ''} 운영팀장` };
}

export function stanceOf(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.max(-3, Math.min(3, Math.round(n))) : 0;
}

export const goodwillOf = (stance: number) => Math.max(-GOODWILL_MAX, Math.min(GOODWILL_MAX, stance * GOODWILL_PER));
export const discountOf = (stance: number) => (stance >= 0 ? Math.min(DISCOUNT_MAX, stance * 0.034) : Math.max(-SURCHARGE_MAX, stance * 0.02));

/** 그 구단과 지금 협상할 수 있나 (마지막 협상 뒤 쿨다운). 안 되면 이유 */
export function tradeTalkBlock(g: GameSession, team: number): string | null {
  if (g.phase !== 'season') return '트레이드 협상은 시즌 중에만 합니다.';
  const who = negotiatorOf(g.league, team).name;
  const last = [...(g.fantasy?.log ?? [])].reverse().find((e) => e.kind === 'chat' && e.who === who && e.year === g.world.year);
  if (last && g.currentDay - last.day < TRADE_TALK_COOLDOWN) return `${who} 팀장과는 ${TRADE_TALK_COOLDOWN}일 뒤에 다시 이야기할 수 있습니다.`;
  return null;
}

export interface TradeTalkInput {
  team: number;
  /** 제안 요약 (주는 선수·받는 선수·현금·지명권, 기록 포함) */
  proposal: string;
  /** 엔진 평가: 받아들일 만한가, 모자라면 얼마나 (런) */
  verdict: 'accept' | 'short' | 'far' | 'invalid';
  gap: number;
  tendency: string;
  argument: string;
}

export function tradeSystem(name: string, role: string): string {
  return `너는 KBO 단장 시뮬레이션 판타지 모드의 가상 인물 "${name}" (${role})이다. 상대 구단 단장(플레이어)이 트레이드를 제안하며 너를 설득하려 한다.
너는 우리 구단의 이익을 지키는 협상가다. 단장의 논리가 우리 구단 상황(성적·성향·약점)에 맞고 설득력이 있으면 마음이 기울고, 근거 없는 압박·과장·무례하면 기분이 상한다.
[게임 평가]는 우리 구단 실무진의 숫자 평가다. 숫자가 많이 모자란 제안은 말만으로는 넘어가지 않는다.

${RULES}

[답 형식] JSON 하나만:
{"reply": "너의 대답 (2~5문장, 대사)", "stance": -3에서 3 사이 정수 (설득된 정도. 3 매우 설득됨, 0 그대로, -3 기분 상함), "counter": "역제안이 있으면 한 줄, 없으면 빈 문자열"}`;
}

/** 트레이드 협상 한 번 → 이야기 글 (효과: 상대 구단 호감) */
export async function tradeTalk(g: GameSession, s: LlmSettings, input: TradeTalkInput): Promise<Omit<FantasyEntry, 'year' | 'day'>> {
  const { name, role } = negotiatorOf(g.league, input.team);
  const evalText = input.verdict === 'accept' ? '실무진 평가: 받아들일 만함'
    : input.verdict === 'short' ? `실무진 평가: 조금 모자람 (우리 기준으로 약 ${input.gap.toFixed(1)}런 모자람)`
      : input.verdict === 'far' ? `실무진 평가: 많이 모자람 (약 ${input.gap.toFixed(1)}런 모자람)` : '실무진 평가: 규정상 불가';
  const raw = await complete(s, {
    system: tradeSystem(name, role),
    messages: [{ role: 'user', content: `[우리 구단 성향] ${input.tendency}\n[제안]\n${input.proposal}\n[게임 평가] ${evalText}\n\n[단장의 말]\n${input.argument}` }],
    maxTokens: 600,
    mockReply: JSON.stringify({ reply: '(시험용) 말씀은 잘 들었습니다. 긍정적으로 검토해 보죠.', stance: 2, counter: '' }),
  });
  const j = extractJson<{ reply?: string; stance?: unknown; counter?: string }>(raw);
  const reply = String(j?.reply ?? raw).trim().slice(0, 1200);
  if (!reply) throw new Error('AI 답이 비어 있습니다. 다시 시도하세요.');
  const stance = stanceOf(j?.stance);
  const runs = goodwillOf(stance);
  const counter = j?.counter ? String(j.counter).trim().slice(0, 200) : '';
  return {
    kind: 'chat', who: name, title: `${role} ${name}와의 트레이드 협상`, ask: input.argument.slice(0, 600),
    text: counter ? `${reply}\n(역제안) ${counter}` : reply,
    effects: [{ type: 'tradeGoodwill', team: input.team, runs, days: GOODWILL_DAYS }],
  };
}

// ---- 에이전트 협상 (FA·비FA 다년 계약)

export function agentSystem(name: string): string {
  return `너는 KBO 단장 시뮬레이션 판타지 모드의 가상 인물 "${name}" (선수 에이전트)이다. 단장(플레이어)이 네가 맡은 선수의 계약 조건을 낮추려고 설득한다.
너는 선수의 이익을 지키지만, 구단의 진심·선수에게 맞는 역할·장기 계획·우승 가능성 같은 설득력 있는 이유에는 마음이 움직인다. 깎아 내리기·압박에는 오히려 요구를 올린다.

${RULES}

[답 형식] JSON 하나만:
{"reply": "너의 대답 (2~5문장, 대사)", "stance": -3에서 3 사이 정수 (3 크게 양보, 0 그대로, -3 요구를 올림)}`;
}

/** 에이전트 협상 한 번 → 이야기 글 (효과: 그 선수 요구액 할인·할증) */
export async function agentTalk(g: GameSession, s: LlmSettings, p: LeaguePlayer, situation: string, argument: string): Promise<Omit<FantasyEntry, 'year' | 'day'>> {
  const agent = castOf(g.league).find((c) => c.key === 'agent')!;
  const tag = p.real === false ? '(가상)' : '(실존)';
  const raw = await complete(s, {
    system: agentSystem(agent.name),
    messages: [{ role: 'user', content: `[선수] ${p.name}${tag}\n[상황] ${situation}\n\n[단장의 말]\n${argument}` }],
    maxTokens: 500,
    mockReply: JSON.stringify({ reply: '(시험용) 구단의 진심은 알겠습니다. 조금 양보하죠.', stance: 2 }),
  });
  const j = extractJson<{ reply?: string; stance?: unknown }>(raw);
  const reply = String(j?.reply ?? raw).trim().slice(0, 1000);
  if (!reply) throw new Error('AI 답이 비어 있습니다. 다시 시도하세요.');
  const pct = Math.round(discountOf(stanceOf(j?.stance)) * 1000) / 1000;
  return {
    kind: 'chat', who: agent.name, title: `에이전트 ${agent.name}와 ${p.name} 계약 협상`, ask: argument.slice(0, 600), text: reply,
    effects: [{ type: 'demandDiscount', player: p.id, pct }],
  };
}

/** 그 선수를 이번 오프시즌에 벌써 협상했나 */
export function agentTalkBlock(g: GameSession, p: LeaguePlayer): string | null {
  if (g.phase !== 'offseason') return '계약 협상은 오프시즌에 합니다.';
  const done = (g.fantasy?.log ?? []).some((e) => e.kind === 'chat' && e.year === g.year && e.day < 0 && e.effects?.some((x) => x.type === 'demandDiscount' && x.player === p.id));
  return done ? `${p.name}은(는) 이번 오프시즌에 이미 협상했습니다.` : null;
}
