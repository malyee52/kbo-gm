// 경기에도 AI 연출 (2026-10-13 사용자 선택 "경기에도 AI 연출").
// 1) 후일담: 우리 경기가 끝난 뒤 중계 화면에서 AI가 중계석 후일담을 쓴다 (기사, 경기 key로 이어 둔다). 게임 수치는 바꾸지 않는다
// 2) 경기 전 미팅: 단장이 선수단에 한 말을 AI가 듣고 분위기를 판정해 선수단 컨디션(teamForm)을 1~3일 바꾼다. 하루 한 번.
//    크기는 판정 단계(leniency.ts NEGOTIATE_SCALE)에 따라: 기본 ±2%p, 판타지 리그 ±4%p
import type { GameSession, CastGame } from '../game/session';
import type { DataStore } from '../data/types';
import { formatDate } from '../game/calendar';
import { complete, extractJson, type LlmSettings } from './llm';
import { RULES } from './prompts';
import { leniencyOf, leniencyRule, NEGOTIATE_SCALE } from './leniency';
import { gameContextFor } from './ai';
import type { FantasyEntry } from './types';

type Store = Pick<DataStore, 'meta' | 'season' | 'players'> & Partial<Pick<DataStore, 'drafts'>>;

export const PREGAME_EDGE = 0.02;
export const PREGAME_WHO = '선수단 미팅';

/** 박스스코어·하이라이트를 글로 (AI 입력) */
export function gameSummary(g: GameSession, game: CastGame, moments: string[]): string {
  const name = (idx: number) => g.world.players[idx]?.name ?? '?';
  const team = (t: number) => g.league.teams[t]?.name ?? '?';
  const me = g.teamIdx;
  const lines = [
    `${formatDate(game.year, game.day, true)}${game.label ? ` ${game.label}` : ''}: ${team(game.away)} ${game.awayRuns} : ${game.homeRuns} ${team(game.home)} (${game.innings}회)`,
  ];
  if (game.box) {
    const ls = game.box.lineScore;
    lines.push(`이닝별: ${team(game.away)} ${ls.away.map((x) => (x < 0 ? 'X' : x)).join(' ')} / ${team(game.home)} ${ls.home.map((x) => (x < 0 ? 'X' : x)).join(' ')}`);
    for (const side of ['away', 'home'] as const) {
      const t = side === 'away' ? game.away : game.home;
      const b = game.box[side];
      const bat = b.batters.filter((x) => x.h > 0 || x.rbi > 0 || x.hr > 0).map((x) => `${name(x.idx)} ${x.ab}타수 ${x.h}안타${x.hr ? ` ${x.hr}홈런` : ''}${x.rbi ? ` ${x.rbi}타점` : ''}`);
      const pit = b.pitchers.map((x) => `${name(x.idx)} ${Math.floor(x.outs / 3)}${x.outs % 3 ? `.${x.outs % 3}` : ''}이닝 ${x.er}자책 ${x.so}삼진`);
      lines.push(`${team(t)}${t === me ? '(우리)' : ''} 타자: ${bat.join(', ') || '없음'}`);
      lines.push(`${team(t)}${t === me ? '(우리)' : ''} 투수: ${pit.join(', ')}`);
    }
  }
  if (moments.length) lines.push(`하이라이트: ${moments.join(' / ')}`);
  return lines.join('\n');
}

export const STORY_SYSTEM = `너는 KBO 단장 시뮬레이션의 중계 캐스터다. 방금 끝난 플레이어 구단 경기의 후일담을 쓴다.
- 주어진 경기 기록(점수, 이닝별 득점, 타자·투수 기록, 하이라이트)만 쓴다. 기록에 없는 숫자를 지어내지 않는다.
- 중계석 말투로 생생하게. 결정적 장면, 수훈 선수, 아쉬운 장면, 다음 경기 전망.
${RULES}

[형식] JSON 하나만: {"title": "한 줄 제목", "text": "후일담 4~7문장"}`;

/** 후일담 한 편 → 기사 (경기 key로 이어 둔다) */
export async function gameStory(g: GameSession, s: LlmSettings, game: CastGame, moments: string[]): Promise<Omit<FantasyEntry, 'year' | 'day'>> {
  const raw = await complete(s, {
    system: STORY_SYSTEM,
    messages: [{ role: 'user', content: `[경기 기록]\n${gameSummary(g, game, moments)}` }],
    maxTokens: 900,
    mockReply: JSON.stringify({ title: '(시험용) 오늘의 후일담', text: '치열한 경기였다.' }),
  });
  const j = extractJson<{ title?: string; text?: string }>(raw);
  const text = String(j?.text ?? raw).trim().slice(0, 2500);
  if (!text) throw new Error('AI 답이 비어 있습니다. 다시 시도하세요.');
  return { kind: 'article', who: '중계석', title: String(j?.title ?? '후일담').slice(0, 80), text, game: game.key };
}

export const storyOf = (g: GameSession, key: string): FantasyEntry | undefined => g.fantasy?.log.find((e) => e.game === key);

/** 경기 전 미팅을 할 수 없는 이유 (없으면 null) */
export function pregameBlock(g: GameSession): string | null {
  if (g.phase !== 'season' || g.done) return '시즌 중에만 합니다.';
  if (!g.nextGame()) return '남은 경기가 없습니다.';
  const done = g.fantasy?.log.some((e) => e.who === PREGAME_WHO && e.year === g.year && e.day === g.currentDay);
  return done ? '오늘은 이미 미팅을 했습니다.' : null;
}

export function pregameSystem(maxEdge: number, l: ReturnType<typeof leniencyOf>): string {
  return `너는 KBO 단장 시뮬레이션에서 선수단 분위기를 판정하는 이야기꾼이다. 단장이 경기 전 선수단(또는 감독·주장)에게 말을 했다.
그 말이 지금 상황(순위, 연승·연패, 다음 상대, 중요한 경기인지)에 맞는지, 진심인지, 압박이 지나친지 보고 선수단 반응과 분위기 변화를 판정한다.
- edge는 선수단 컨디션 변화 (−${maxEdge}~${maxEdge}, 소수). 좋은 말이면 +, 역효과면 −, 보통은 작게. days는 1~3일
- 반응은 선수단 전체·주장·감독의 분위기로 그린다.
${leniencyRule(l)}
${RULES}

[형식] JSON 하나만: {"title": "한 줄 제목", "text": "선수단 반응 (2~4문장)", "edge": 소수, "days": 정수}`;
}

/** 경기 전 미팅 → 대화 글 (효과: 선수단 컨디션) */
export async function pregameTalk(g: GameSession, store: Store, s: LlmSettings, speech: string): Promise<Omit<FantasyEntry, 'year' | 'day'>> {
  const l = leniencyOf(g.league);
  const maxEdge = Math.round(PREGAME_EDGE * NEGOTIATE_SCALE[l] * 1000) / 1000;
  const next = g.nextGame();
  const opp = next ? (next.home === g.teamIdx ? next.away : next.home) : -1;
  const st = g.season.standings();
  const oppInfo = opp >= 0 ? `다음 경기: ${g.league.teams[opp].name}전 (상대 ${st.indexOf(opp) + 1}위, 우리 ${st.indexOf(g.teamIdx) + 1}위)` : '';
  const raw = await complete(s, {
    system: pregameSystem(maxEdge, l),
    messages: [{ role: 'user', content: `[게임 상황]\n${gameContextFor(g, store)}\n${oppInfo}\n\n[단장의 말]\n${speech}` }],
    maxTokens: 600,
    mockReply: JSON.stringify({ title: '(시험용) 미팅', text: '선수단이 고개를 끄덕였다.', edge: 0.01, days: 2 }),
  });
  const j = extractJson<{ title?: string; text?: string; edge?: unknown; days?: unknown }>(raw);
  const text = String(j?.text ?? '').trim().slice(0, 1200);
  if (!text) throw new Error('AI가 형식에 맞지 않게 답했습니다. 다시 시도하세요.');
  const e = Number(j?.edge);
  const edge = Number.isFinite(e) ? Math.round(Math.max(-maxEdge, Math.min(maxEdge, e)) * 10000) / 10000 : 0;
  const days = Math.max(1, Math.min(3, Math.round(Number(j?.days) || 1)));
  return {
    kind: 'chat', who: PREGAME_WHO, title: String(j?.title ?? '경기 전 미팅').slice(0, 80), ask: speech.slice(0, 600), text,
    ...(edge ? { effects: [{ type: 'teamForm' as const, side: 'all' as const, edge, days }] } : {}),
  };
}
