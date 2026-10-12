// 판타지 모드의 AI 요청과 답 해석 (3~5단계): 대화, 사건, 이야기 줄기.
// 답은 JSON으로 받고 효과는 effects.ts로 검사한다. 결과는 FantasyEntry로 돌려주고, 기록(조작 기록)은 부른 쪽(화면)이 session.addFantasy로 한다.
import type { GameSession } from '../game/session';
import { complete, extractJson, type LlmSettings } from './llm';
import { gameContext } from './context';
import { effectMenu, sanitizeEffects, type EffectPlayer, type EffectScale } from './effects';
import { RULES } from './prompts';
import { leniencyOf, leniencyRule, type Leniency } from './leniency';
import { memoryContext } from './history';
import type { CastMember } from './cast';
import type { ArcUpdate, FantasyChoice, FantasyEntry } from './types';
import type { DataStore } from '../data/types';

type Store = Pick<DataStore, 'meta' | 'season' | 'players'> & Partial<Pick<DataStore, 'drafts'>>;

/** 효과 대상이 될 수 있는 우리 선수 (이름으로 찾는다) */
export function effectRoster(g: GameSession): EffectPlayer[] {
  return g.league.players.filter((p) => p.team === g.teamIdx).map((p) => ({ id: p.id, name: p.name, real: p.real !== false }));
}

function rosterLine(g: GameSession): string {
  const v = g.league.players.filter((p) => p.team === g.teamIdx && p.real === false).slice(0, 15).map((p) => p.name);
  return v.length ? `[우리 구단 (가상) 선수 일부] ${v.join(', ')}` : '';
}

/** 지금 이야기 줄기와 지난 이야기 (5단계) */
function storyLine(g: GameSession): string {
  const f = g.league.fantasy;
  if (!f) return '';
  const out: string[] = [];
  if (f.arc) out.push(`[지금 이야기 줄기] "${f.arc.title}" (${f.arc.beats}번째 사건까지 진행${f.arc.climax ? ', 절정' : ''}): ${f.arc.summary}`);
  const past = (f.pastArcs ?? []).slice(-3).map((a) => `"${a.title}"`);
  if (past.length) out.push(`[끝난 이야기 줄기] ${past.join(', ')}`);
  const recent = f.log.slice(-6).map((e) => `- (${e.kind}) ${e.title}${e.chosen !== undefined && e.choices ? ` → ${e.choices[e.chosen].label}` : ''}`);
  if (recent.length) out.push('[최근 이야기]', ...recent);
  return out.join('\n');
}

/** 게임 상황 + 우리 선수 + 이야기 줄기 (+ 회귀자 기억). gameday.ts도 쓴다 */
export function gameContextFor(g: GameSession, store: Store): string {
  return fullContext(g, store);
}

function fullContext(g: GameSession, store: Store): string {
  const parts = [gameContext(g), rosterLine(g), storyLine(g)];
  if (g.league.fantasy?.regressor) parts.push(memoryContext(store, g.league, g.phase === 'season' ? g.world.year : g.year + 1));
  return parts.filter(Boolean).join('\n\n');
}

// ---- 대화 (3단계)

export function chatSystem(c: CastMember, regressor: boolean, l: Leniency = 3): string {
  return `너는 KBO 단장 시뮬레이션 판타지 모드의 가상 인물 "${c.name}" (${c.role})이다. 상대는 플레이어 구단의 단장이다.
성격·말투: ${c.persona}
${regressor ? '단장은 미래를 기억하는 회귀자지만 너는 그 사실을 모른다. [원래 역사]는 단장만 아는 것이니 네 입으로 미래를 말하지 않는다.\n' : ''}
${leniencyRule(l)}

${RULES}
- 너는 가상 인물이고, 실존 인물인 척하지 않는다.
- 대화로 구단에 작은 변화가 생길 만하면 effects에 제안한다 (단장이 받아들여야 적용된다). 대부분의 대화는 효과가 없다.

[효과]
${effectMenu('chat')}

[답 형식] JSON 하나만:
{"reply": "인물의 대답 (2~6문장, 대사만)", "offer": "제안 한 줄 (효과가 있을 때만, 없으면 빈 문자열)", "effects": [ ... ]}`;
}

export async function chatTurn(g: GameSession, store: Store, s: LlmSettings, c: CastMember, ask: string): Promise<Omit<FantasyEntry, 'year' | 'day'>> {
  const history = (g.league.fantasy?.log ?? []).filter((e) => e.kind === 'chat' && e.who === c.name).slice(-6);
  const messages = [
    { role: 'user' as const, content: `[게임 상황]\n${fullContext(g, store)}\n\n(대화가 이어진다. 앞의 대화가 있으면 이어서 답한다.)` },
    { role: 'assistant' as const, content: '{"reply": "네, 단장님. 말씀하세요.", "offer": "", "effects": []}' },
    ...history.flatMap((e) => [{ role: 'user' as const, content: e.ask ?? '' }, { role: 'assistant' as const, content: JSON.stringify({ reply: e.text, offer: '', effects: [] }) }]),
    { role: 'user' as const, content: ask },
  ];
  const raw = await complete(s, { system: chatSystem(c, !!g.league.fantasy?.regressor, leniencyOf(g.league)), messages, maxTokens: 700,
    mockReply: JSON.stringify({ reply: `${c.role}입니다. (시험용 답) 말씀하신 건 알아보겠습니다.`, offer: '', effects: [] }) });
  const j = extractJson<{ reply?: string; offer?: string; effects?: unknown }>(raw);
  const reply = (j?.reply ?? raw).toString().trim();
  if (!reply) throw new Error('AI 답이 비어 있습니다. 다시 시도하세요.');
  const { effects } = sanitizeEffects(j?.effects, 'chat', effectRoster(g));
  const choices: FantasyChoice[] | undefined = effects.length
    ? [{ label: `받아들인다${j?.offer ? `: ${j.offer}` : ''}`.slice(0, 80), result: '제안을 받아들였다.', effects }, { label: '넘긴다', result: '제안을 넘겼다.', effects: [] }]
    : undefined;
  return { kind: 'chat', title: `${c.role} ${c.name}와의 대화`, who: c.name, ask: ask.slice(0, 500), text: reply.slice(0, 1200), ...(choices ? { choices } : {}) };
}

// ---- 사건 (4단계)과 이야기 줄기 (5단계)

/** 큰 효과(arc)를 쓸 수 있나: 이야기 줄기가 세 번째 사건을 넘었을 때 */
export function arcReady(g: GameSession): boolean {
  const a = g.league.fantasy?.arc;
  return !!a && !a.done && a.beats >= 3;
}

export function eventSystem(scale: EffectScale, regressor: boolean): string {
  return `너는 KBO 단장 시뮬레이션 판타지 모드의 이야기꾼이다. 지금 게임 상황과 이야기 줄기를 읽고, 플레이어(단장)가 결정을 내려야 하는 사건 하나를 만든다.
사건은 구단 안팎의 일(선수단 분위기, 팬, 모기업, 언론, 스카우트, 지역 사회, 라이벌 구단, 경기장 등)이고, 선택지 2~3개는 서로 다른 대가와 보상이 있다.
${regressor ? '단장은 미래를 기억하는 회귀자다. [원래 역사]를 활용해 "원래라면 이렇게 됐을 일"이 흔들리는 사건을 만들어도 좋다 (기록 사실만).\n' : ''}
${RULES}

[이야기 줄기]
- 여러 주에 걸쳐 이어지는 큰 이야기 하나를 끌고 간다. 지금 줄기가 없으면 새로 시작하고, 있으면 이어 간다.
- 세 번째 사건쯤부터 절정(climax)으로 갈 수 있고, 절정에서 끝내면 done을 true로.
${scale === 'arc' ? '- 지금은 절정에서 큰 변화를 쓸 수 있다 (구단주 교체, 큰 투자, 전설적인 유망주 입단 같은).' : ''}

[효과]
${effectMenu(scale)}

[답 형식] JSON 하나만:
{"title": "사건 제목 (한 줄)", "text": "사건 글 (3~6문장)", "choices": [{"label": "선택지 (한 줄)", "result": "고른 뒤 결과 (1~2문장)", "effects": [ ... ]}, ...],
 "arc": {"title": "이야기 줄기 제목", "summary": "지금까지 줄거리 요약 (2~3문장)", "climax": false, "done": false}}`;
}

export async function makeEvent(g: GameSession, store: Store, s: LlmSettings): Promise<Omit<FantasyEntry, 'year' | 'day'>> {
  const scale: EffectScale = arcReady(g) ? 'arc' : 'event';
  const raw = await complete(s, {
    system: eventSystem(scale, !!g.league.fantasy?.regressor),
    messages: [{ role: 'user', content: `[게임 상황]\n${fullContext(g, store)}\n\n사건 하나를 만들어 줘.` }],
    maxTokens: 1400,
    mockReply: JSON.stringify({ title: '(시험용) 팬 사인회 요청', text: '지역 팬클럽이 사인회를 열어 달라고 요청해 왔다.',
      choices: [{ label: '연다', result: '팬들이 기뻐했다.', effects: [{ type: 'fans', delta: 2 }] }, { label: '정중히 거절', result: '시즌에 집중하기로 했다.', effects: [] }],
      arc: { title: '팬과 함께', summary: '팬들과 가까워지려는 시도가 시작됐다.' } }),
  });
  const j = extractJson<{ title?: string; text?: string; choices?: unknown[]; arc?: Partial<ArcUpdate> }>(raw);
  if (!j?.title || !j.text || !Array.isArray(j.choices) || j.choices.length < 2) throw new Error('AI가 사건 형식에 맞지 않게 답했습니다. 다시 시도하세요.');
  const roster = effectRoster(g);
  const choices: FantasyChoice[] = j.choices.slice(0, 3).map((c) => {
    const x = (c ?? {}) as { label?: unknown; result?: unknown; effects?: unknown };
    return { label: String(x.label ?? '선택').slice(0, 80), result: String(x.result ?? '').slice(0, 400), effects: sanitizeEffects(x.effects, scale, roster).effects };
  });
  const arc: ArcUpdate | undefined = j.arc && typeof j.arc.title === 'string' && j.arc.title.trim()
    ? { title: j.arc.title.trim().slice(0, 60), summary: String(j.arc.summary ?? '').slice(0, 400), ...(j.arc.climax ? { climax: true } : {}), ...(j.arc.done ? { done: true } : {}) }
    : undefined;
  return { kind: 'event', title: String(j.title).slice(0, 80), text: String(j.text).slice(0, 1500), who: '판타지 사건', choices, ...(arc ? { arc } : {}) };
}

/** 사건을 자동으로 만들 때인가 (정규시즌, 답을 기다리는 사건이 없고, 마지막 사건 뒤 n일) */
export const AUTO_EVENT_EVERY = 10;
export function autoEventDue(g: GameSession): boolean {
  const f = g.league.fantasy;
  if (!f || g.phase !== 'season' || g.done) return false;
  if (f.log.some((e) => e.choices?.length && e.chosen === undefined && e.kind === 'event')) return false;
  const last = [...f.log].reverse().find((e) => e.kind === 'event' && e.year === g.world.year);
  return g.currentDay - (last ? last.day : -AUTO_EVENT_EVERY) >= AUTO_EVENT_EVERY;
}
