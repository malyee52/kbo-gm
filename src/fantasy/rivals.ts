// 다른 구단 단장도 움직인다 (자유 모드, 2026-10-13 사용자 선택 "다른 구단 단장도 움직임").
// 시즌 중 RIVAL_EVERY일마다 한 구단 단장(가상 인물)이 움직인다:
//   - 우리에게 제안 (트레이드·현금·지명권·협력·견제): 선택지로 오고, 받을지는 우리가 정한다. RIVAL_OFFER_DAYS일이 지나면 만료
//   - 다른 구단끼리의 큰 움직임 (영입·트레이드·리그 밖 선수 영입 등): 바로 반영 (우리 선수·우리 구단 수치는 건드리지 않는다)
// 결과는 이야기 기록(조작은 선택지 ops 또는 글의 ops)으로 남아 재현된다.
import { Rng } from '../engine';
import type { GameSession } from '../game/session';
import { koreanName } from '../league/names';
import type { LeagueState } from '../league/types';
import { complete, extractJson, type LlmSettings } from './llm';
import { RULES } from './prompts';
import { FREE_OPS_MENU, freeContext, resolveOps, resolvePromises, teamOfNow, type FreeOp } from './free';
import type { FantasyChoice, FantasyEntry } from './types';
import type { DataStore } from '../data/types';

type Store = Pick<DataStore, 'meta' | 'season' | 'players'> & Partial<Pick<DataStore, 'drafts'>>;

export const RIVAL_EVERY = 7;
export const RIVAL_OFFER_DAYS = 7;

/** 그 구단의 단장 (가상 인물, 게임 시드와 구단 계보로 정해진다) */
export function rivalGmOf(league: Pick<LeagueState, 'seed' | 'teams' | 'players'>, team: number): string {
  const franchise = league.teams[team]?.franchise ?? String(team);
  const taken = new Set(league.players.map((p) => p.name));
  return koreanName(new Rng(`${league.seed}/rival-gm/${franchise}`), taken);
}

/** 이번에 움직일 구단과 종류 (시드로 정한다) */
export function rivalPick(g: GameSession): { team: number; kind: 'offer' | 'move' } {
  const teams = g.league.teams.map((_, i) => i).filter((i) => i !== g.teamIdx && g.world.teams[i]);
  const rng = new Rng(`${g.league.seed}/rival/${g.world.year}/${g.currentDay}`);
  return { team: teams[rng.int(teams.length)], kind: rng.chance(0.6) ? 'offer' : 'move' };
}

export function rivalDue(g: GameSession): boolean {
  const f = g.league.fantasy;
  if (!f?.free || g.phase !== 'season' || g.done || g.currentDay < 3) return false;
  const last = [...f.log].reverse().find((e) => e.rival !== undefined && e.year === g.world.year);
  return g.currentDay - (last ? last.day : -RIVAL_EVERY) >= RIVAL_EVERY;
}

/** 우리에게 온 제안이 만료됐나 */
export function offerExpired(g: Pick<GameSession, 'phase' | 'year' | 'currentDay'>, e: FantasyEntry): boolean {
  if (e.rival === undefined || !e.choices?.length) return false;
  if (g.phase !== 'season' || e.day < 0 || e.year !== g.year) return true;
  return g.currentDay - e.day > RIVAL_OFFER_DAYS;
}

export function rivalSystem(): string {
  return `너는 KBO 단장 시뮬레이션 "자유 모드"에서 다른 구단 단장들을 연기한다. 이번 주 리그에서 한 구단 단장이 움직인다.
- 구단 사정(순위, 약점, 자금, 성향)에 맞는 그럴듯한 움직임을 만든다. 공격적이어도 되고 교활해도 된다.
- kind "offer": 그 단장이 플레이어(우리 구단 단장)에게 제안·요청·견제를 해 온다 (트레이드, 현금 거래, 지명권, 선수 임대 같은 협력, 맞대응 경고 등).
  choices 2~3개 (받기·조건 바꿔 받기·거절 등). 각 선택지의 ops에 그 선택이 일으킬 실제 조작을 넣는다 (거절이면 빈 배열이나 관계 대가).
- kind "move": 그 구단이 다른 구단(우리 구단 제외)과 벌이는 큰 움직임 (트레이드, 영입, 리그 밖 선수 영입, 자금 투입). ops는 바로 반영된다. 우리 선수·우리 구단 수치는 건드리지 않는다.
- [이 게임의 규정]을 따른다. 규정 밖의 일은 명분을 붙인다.
${RULES}

${FREE_OPS_MENU}

[답 형식] JSON 하나만:
{"kind": "offer|move", "title": "한 줄 제목", "narration": "무슨 일이 있었나 (3~6문장, 그 단장의 말 포함 가능)", "ops": [ ... move일 때 ], "choices": [{"label": "선택지", "result": "고른 뒤 결과 한두 문장", "ops": [ ... ], "promises": [{"party": "상대", "text": "약속", "due": "기한"}]}]}`;
}

/** 한 구단 단장의 움직임 → 이야기 글 */
export async function rivalMove(g: GameSession, store: Store, s: LlmSettings): Promise<{ entry: Omit<FantasyEntry, 'year' | 'day'>; dropped: string[] }> {
  const { team, kind } = rivalPick(g);
  const gm = rivalGmOf(g.league, team);
  const teamName = g.league.teams[team].name;
  const raw = await complete(s, {
    system: rivalSystem(),
    messages: [{ role: 'user', content: `[게임 상황]\n${freeContext(g, store)}\n\n[이번 주 움직이는 단장] ${teamName} 단장 ${gm} (가상 인물). 종류: ${kind === 'offer' ? 'offer (우리에게 제안)' : 'move (다른 구단과의 움직임)'}` }],
    maxTokens: 1500,
    mockReply: JSON.stringify(kind === 'offer'
      ? { kind, title: `(시험용) ${teamName}의 제안`, narration: '현금 거래를 제안해 왔다.', choices: [{ label: '받는다', result: '거래가 성사됐다.', ops: [{ op: 'cash', amount: 1 }] }, { label: '거절한다', result: '정중히 거절했다.', ops: [] }] }
      : { kind, title: `(시험용) ${teamName}의 투자`, narration: '자금을 투입했다.', ops: [{ op: 'teamCash', team: teamName, amount: 5 }] }),
  });
  const j = extractJson<{ kind?: string; title?: string; narration?: string; ops?: unknown; choices?: unknown }>(raw);
  if (!j?.narration) throw new Error('AI가 형식에 맞지 않게 답했습니다.');
  const dropped: string[] = [];
  const base = { kind: 'action' as const, title: String(j.title ?? `${teamName} 단장의 움직임`).slice(0, 80), text: String(j.narration).slice(0, 2000), who: `${teamName} 단장 ${gm}`, rival: team };
  const rawChoices = Array.isArray(j.choices) ? j.choices.slice(0, 3) : [];
  if ((j.kind ?? kind) === 'offer' && rawChoices.length >= 2) {
    const choices: FantasyChoice[] = rawChoices.map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      const r = resolveOps(g, x.ops, store);
      dropped.push(...r.dropped);
      const promises = resolvePromises(g, x.promises);
      return { label: String(x.label ?? '고른다').slice(0, 60), result: String(x.result ?? '').slice(0, 300), effects: [], ...(r.ops.length ? { ops: r.ops } : {}), ...(promises.length ? { promises } : {}) };
    });
    return { entry: { ...base, choices }, dropped };
  }
  // 다른 구단끼리: 우리 선수·우리 구단 수치를 건드리는 조작은 뺀다
  const r = resolveOps(g, j.ops, store);
  const mineIds = new Set(g.league.players.filter((p) => teamOfNow(g, p) === g.teamIdx).map((p) => p.id));
  const ops = r.ops.filter((op: FreeOp) => {
    if (op.op === 'effect' || op.op === 'rule') return false;
    if ((op.op === 'move' || op.op === 'ability' || op.op === 'contract') && mineIds.has(op.player)) return false;
    if ((op.op === 'move' && op.to === g.teamIdx) || (op.op === 'create' && op.team === g.teamIdx) || (op.op === 'teamCash' && op.team === g.teamIdx)) return false;
    if (op.op === 'pick' && (op.to === g.teamIdx || op.from === g.teamIdx)) return false;
    return true;
  });
  return { entry: { ...base, ...(ops.length ? { ops } : {}) }, dropped: [...dropped, ...r.dropped] };
}
