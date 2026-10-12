// 자유 모드 (AI 진행, 2026-10-13 사용자 결정): 플레이어가 무엇이든 글로 하겠다고 하면 AI 게임 마스터가 판정하고, 그 결과를 실제 게임 조작(FreeOp)으로 낸다.
// 사용자 결정: 바꿀 수 있는 범위는 거의 전부(트레이드·이동·방출·영입·가상 선수 만들기·모든 선수의 능력·잠재력·컨디션·계약·자금·구단주·팬, 다른 구단끼리도).
// 판단에 안전망은 두지 않는다 (AI가 정하면 그대로). 경기는 엔진이 시뮬레이션한다. 실존 선수 규칙(지어낸 발언·사생활·물의 금지)만 지킨다.
// 조작은 이름 대신 id로 바꿔 이야기 기록(FantasyEntry.ops)에 남기고, 재현·불러오기 때는 AI 없이 그대로 다시 적용한다 (session.applyFreeOps).
import type { GameSession } from '../game/session';
import { leagueQuality } from '../engine';
import type { LeaguePlayer } from '../league/types';
import { complete, extractJson, type LlmSettings } from './llm';
import { gameContext } from './context';
import { RULES } from './prompts';
import { memoryContext } from './history';
import { sanitizeEffects, type FantasyEffect } from './effects';
import type { FantasyEntry } from './types';
import type { DataStore } from '../data/types';
import { currentRuns } from '../ai/value';
import { asSim } from '../league/growth';

type Store = Pick<DataStore, 'meta' | 'season' | 'players'> & Partial<Pick<DataStore, 'drafts'>>;

export type FreeOp =
  /** 선수를 그 구단으로 (−1이면 방출). 우리·다른 구단 모두 */
  | { op: 'move'; player: string; to: number }
  /** 가상 선수를 만든다. now·potential은 20~80 등급 */
  | { op: 'create'; name: string; team: number; pos: 'P' | 'C' | 'IF' | 'OF'; age: number; now: number; potential: number }
  /** 능력(now)·잠재력(potential)을 20~80 등급으로 */
  | { op: 'ability'; player: string; now?: number; potential?: number }
  /** 계약: 연봉(만 원), 기간(이번 시즌부터 몇 해) */
  | { op: 'contract'; player: string; salary: number; years: number }
  /** 다른 구단 자금 (만 원) */
  | { op: 'teamCash'; team: number; amount: number }
  /** 판타지 효과 (신뢰·팬·자금·관중·컨디션·휴식 등, 상한 넉넉히) */
  | { op: 'effect'; effect: FantasyEffect };

// ---- 등급 ↔ 런 (ui/grades.ts runsGrade의 거꾸로: 40 + 5 × (−0.49 + 0.108 × 런) × 리그 수준)
export function runsForGrade(grade: number, year: number): number {
  const q = leagueQuality(year);
  return ((Math.max(20, Math.min(80, grade)) - 40) / (5 * q) + 0.49) / 0.108;
}
export function gradeOfRuns(runs: number, year: number): number {
  return Math.max(20, Math.min(80, Math.round(40 + 5 * (-0.49 + 0.108 * runs) * leagueQuality(year))));
}

/** 게임 마스터에게 주는 조작 목록 */
export const FREE_OPS_MENU = `[조작 목록] (선수·구단은 이름으로. 동명이인이면 "이름@구단")
- {"op":"move","player":"선수 이름","to":"구단 이름 또는 방출"} 선수를 그 구단으로 옮긴다 (우리 구단·다른 구단 모두, 트레이드는 move 여러 개로)
- {"op":"create","name":"지어낸 한국 이름","team":"구단 이름","pos":"P|C|IF|OF","age":17~40,"now":20~80,"potential":20~80} 가상 선수를 만들어 그 구단에 넣는다
- {"op":"ability","player":"선수 이름","now":20~80,"potential":20~80} 능력·잠재력 등급을 바꾼다 (둘 중 하나만도 됨, 50 = 리그 주전 평균)
- {"op":"contract","player":"선수 이름","salary":억 원(소수),"years":1~10} 계약을 바꾼다
- {"op":"cash","amount":억 원} 우리 구단 자금 (+ 들어옴, − 나감)
- {"op":"teamCash","team":"구단 이름","amount":억 원} 다른 구단 자금
- {"op":"trust","delta":정수} 구단주 신뢰 (0~100 안에서)
- {"op":"fans","delta":정수} 우리 팬 만족도
- {"op":"teamForm","side":"bat|pit|all","edge":−0.05~0.05,"days":1~60} 우리 선수단 컨디션 (시즌 중)
- {"op":"playerForm","player":"우리 선수 이름","edge":−0.05~0.05,"days":1~60} (시즌 중)
- {"op":"rest","player":"우리 선수 이름","days":1~30} (시즌 중)`;

export function freeSystem(regressor: boolean): string {
  return `너는 KBO 단장 시뮬레이션의 "자유 모드" 게임 마스터(TRPG 진행자)다. 플레이어는 한 구단의 단장이고, 무엇이든 하겠다고 말할 수 있다.
너는 그 행동이 이 세계에서 어떻게 되는지 판정하고(성공·실패·조건부·대가), 결과를 이야기로 들려주고, 실제 게임에 반영할 조작을 낸다.
- 판정은 네가 한다. 현실성·구단 사정·상대 입장·대가를 고려하되, 결정은 자유다. 상대 구단·인물도 네가 연기한다.
- 트레이드·영입 같은 일은 상대가 받아들일 때만 조작을 낸다. 거절·보류면 조작 없이 이야기만.
- 플레이어가 말하지 않은 큰일을 멋대로 벌이지 않는다. 다만 판정의 대가·부작용(자금, 팬, 구단주 신뢰 등)은 붙일 수 있다.
- 경기 결과·기록은 바꾸지 않는다 (경기는 엔진이 치른다).
${regressor ? '- 단장은 원래 역사를 기억하는 회귀자다 (다른 인물은 모른다).\n' : ''}
${RULES}
- 실존 선수의 능력·소속·계약을 바꾸는 조작은 해도 되지만, 실존 선수에게 발언·속마음·사생활·물의를 붙이지 않는다. 대화 상대는 가상 인물이다.

${FREE_OPS_MENU}

[답 형식] JSON 하나만:
{"title": "한 줄 제목", "narration": "판정과 결과 이야기 (3~8문장)", "ops": [ ... ]}`;
}

function rosterTable(g: GameSession, team: number, n: number): string {
  const year = g.phase === 'season' ? g.world.year : g.year + 1;
  const ctx = g.values;
  const lp = g.league.players.filter((p) => teamOfNow(g, p) === team);
  const rows = lp.map((p) => {
    const runs = currentRuns(asSim(p, ctx.world.league, year), ctx);
    return { p, runs };
  }).sort((a, b) => b.runs - a.runs).slice(0, n);
  return rows.map(({ p, runs }) => `${p.name}${p.real === false ? '(가상)' : '(실존)'} ${p.isPitcher ? '투수' : p.pos ?? '야수'} ${p.birthYear ? year - p.birthYear : '?'}세 능력${gradeOfRuns(runs, year)} 잠재${gradeOfRuns(p.potential, year)} 연봉${Math.round(p.contract.salary / 1000) / 10}억`).join('; ');
}

/** 지금 소속 (시즌 중에는 월드, 오프시즌에는 리그) */
export function teamOfNow(g: GameSession, p: LeaguePlayer): number {
  if (g.phase === 'season') {
    const sp = g.world.players.find((x) => x.id === p.id);
    return sp ? sp.teamIdx : p.team;
  }
  return p.team;
}

export function freeContext(g: GameSession, store: Store): string {
  const parts = [gameContext(g)];
  parts.push(`[우리 구단 ${g.league.teams[g.teamIdx].name} 선수 (능력 순)] ${rosterTable(g, g.teamIdx, 40)}`);
  const others = g.league.teams.map((t, i) => ({ t, i })).filter((x) => x.i !== g.teamIdx && (g.phase !== 'season' || g.world.teams[x.i]));
  parts.push('[다른 구단 주요 선수]', ...others.map(({ t, i }) => `${t.name}: ${rosterTable(g, i, 8)}`));
  const recent = (g.league.fantasy?.log ?? []).filter((e) => e.kind === 'action').slice(-6).map((e) => `- ${e.title}: ${e.text.slice(0, 120)}`);
  if (recent.length) parts.push('[지난 행동]', ...recent);
  if (g.league.fantasy?.regressor) parts.push(memoryContext(store, g.league, g.phase === 'season' ? g.world.year : g.year + 1));
  return parts.join('\n');
}

/** 이름 → 구단 색인 (방출은 −1). 못 찾으면 null */
function teamByName(g: GameSession, name: unknown): number | null {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  if (/^(방출|무소속|자유계약|release)$/i.test(n)) return -1;
  const i = g.league.teams.findIndex((t) => t.name === n || t.franchise === n);
  return i >= 0 ? i : null;
}

/** 이름(·구단) → 선수. 동명이인이면 "이름@구단"으로, 아니면 우리 구단 선수를 먼저 */
function playerByName(g: GameSession, raw: unknown): LeaguePlayer | null {
  if (typeof raw !== 'string') return null;
  const [name, teamName] = raw.split('@').map((x) => x.trim());
  const team = teamName ? teamByName(g, teamName) : null;
  const hits = g.league.players.filter((p) => p.name === name && (team === null || teamOfNow(g, p) === team) && p.team !== -2);
  if (hits.length === 1) return hits[0];
  const mine = hits.filter((p) => teamOfNow(g, p) === g.teamIdx);
  return mine.length === 1 ? mine[0] : null;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() && Number.isFinite(Number(x)) ? Number(x) : null);

/** AI가 낸 조작을 이름 → id로 바꾸고 범위를 다듬는다 (판단 상한은 없다, 값의 범위만) */
export function resolveOps(g: GameSession, raw: unknown): { ops: FreeOp[]; dropped: string[] } {
  const ops: FreeOp[] = [];
  const dropped: string[] = [];
  const rosterForEffects = g.league.players.filter((p) => teamOfNow(g, p) === g.teamIdx).map((p) => ({ id: p.id, name: p.name, real: p.real !== false }));
  for (const r of Array.isArray(raw) ? raw.slice(0, 20) : []) {
    const e = (r ?? {}) as Record<string, unknown>;
    switch (e.op) {
      case 'move': {
        const p = playerByName(g, e.player);
        const to = teamByName(g, e.to);
        if (!p || to === null) { dropped.push(`move: ${String(e.player)} → ${String(e.to)} 를 찾지 못함`); break; }
        if (p.foreign && to >= 0 && to !== teamOfNow(g, p)) { /* 외국인도 자유 모드에서는 옮긴다 */ }
        ops.push({ op: 'move', player: p.id, to });
        break;
      }
      case 'create': {
        const team = teamByName(g, e.team);
        const name = typeof e.name === 'string' ? e.name.trim().slice(0, 8) : '';
        if (team === null || team < 0 || !name) { dropped.push(`create: ${name || '이름 없음'} (구단 ${String(e.team)})`); break; }
        const pos = e.pos === 'P' || e.pos === 'C' || e.pos === 'IF' || e.pos === 'OF' ? e.pos : 'IF';
        ops.push({ op: 'create', name, team, pos, age: Math.max(17, Math.min(40, Math.round(num(e.age) ?? 22))),
          now: Math.max(20, Math.min(80, Math.round(num(e.now) ?? 45))), potential: Math.max(20, Math.min(80, Math.round(num(e.potential) ?? 55))) });
        break;
      }
      case 'ability': {
        const p = playerByName(g, e.player);
        const now = num(e.now);
        const pot = num(e.potential);
        if (!p || (now === null && pot === null)) { dropped.push(`ability: ${String(e.player)}`); break; }
        ops.push({ op: 'ability', player: p.id, ...(now !== null ? { now: Math.max(20, Math.min(80, Math.round(now))) } : {}), ...(pot !== null ? { potential: Math.max(20, Math.min(80, Math.round(pot))) } : {}) });
        break;
      }
      case 'contract': {
        const p = playerByName(g, e.player);
        const sal = num(e.salary);
        if (!p || sal === null) { dropped.push(`contract: ${String(e.player)}`); break; }
        ops.push({ op: 'contract', player: p.id, salary: Math.max(3000, Math.round(sal * 10000)), years: Math.max(1, Math.min(10, Math.round(num(e.years) ?? 1))) });
        break;
      }
      case 'teamCash': {
        const team = teamByName(g, e.team);
        const a = num(e.amount);
        if (team === null || team < 0 || a === null) { dropped.push(`teamCash: ${String(e.team)}`); break; }
        ops.push({ op: 'teamCash', team, amount: Math.round(Math.max(-10000, Math.min(10000, a)) * 10000) });
        break;
      }
      case 'cash': {
        const a = num(e.amount);
        if (a === null || a === 0) { dropped.push('cash: 값 없음'); break; }
        ops.push({ op: 'effect', effect: { type: 'cash', amount: Math.round(Math.max(-10000, Math.min(10000, a)) * 10000) } });
        break;
      }
      case 'trust': case 'fans': case 'teamForm': case 'playerForm': case 'rest': case 'fill': {
        // 판단 상한은 두지 않고 값의 범위만 (절정 상한의 몇 배)
        const { effects, dropped: d } = sanitizeEffects([{ ...e, type: e.op }], 'arc', rosterForEffects);
        const x = effects[0];
        if (!x) { dropped.push(...d); break; }
        const raw2 = e as Record<string, number>;
        if (x.type === 'trust' || x.type === 'fans') x.delta = Math.max(-100, Math.min(100, Math.round(raw2.delta ?? x.delta)));
        if (x.type === 'teamForm' || x.type === 'playerForm') { x.edge = Math.max(-0.05, Math.min(0.05, raw2.edge ?? x.edge)); x.days = Math.max(1, Math.min(60, Math.round(raw2.days ?? x.days))); }
        if (x.type === 'rest') x.days = Math.max(1, Math.min(30, Math.round(raw2.days ?? x.days)));
        ops.push({ op: 'effect', effect: x });
        break;
      }
      default:
        dropped.push(`알 수 없는 조작 ${String(e.op)}`);
    }
  }
  return { ops, dropped };
}

/** 행동 한 번: AI 판정 → 이야기 글 (ops는 기록될 때 적용된다) */
export async function freeAction(g: GameSession, store: Store, s: LlmSettings, action: string): Promise<{ entry: Omit<FantasyEntry, 'year' | 'day'>; dropped: string[] }> {
  const raw = await complete(s, {
    system: freeSystem(!!g.league.fantasy?.regressor),
    messages: [{ role: 'user', content: `[게임 상황]\n${freeContext(g, store)}\n\n[단장의 행동]\n${action}` }],
    maxTokens: 1500,
    mockReply: JSON.stringify({ title: '(시험용) 판정', narration: '단장의 뜻대로 일이 진행됐다.', ops: [{ op: 'fans', delta: 1 }] }),
  });
  const j = extractJson<{ title?: string; narration?: string; ops?: unknown }>(raw);
  if (!j?.narration) throw new Error('AI가 형식에 맞지 않게 답했습니다. 다시 시도하세요.');
  const { ops, dropped } = resolveOps(g, j.ops);
  return {
    entry: { kind: 'action', title: String(j.title ?? '행동').slice(0, 80), ask: action.slice(0, 1000), text: String(j.narration).slice(0, 3000), who: '게임 마스터', ...(ops.length ? { ops } : {}) },
    dropped,
  };
}
