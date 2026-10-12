// 자유 모드 (AI 진행, 2026-10-13 사용자 결정): 플레이어가 무엇이든 글로 하겠다고 하면 AI 게임 마스터가 판정하고, 그 결과를 실제 게임 조작(FreeOp)으로 낸다.
// 사용자 결정: 바꿀 수 있는 범위는 거의 전부(트레이드·이동·방출·영입·가상 선수 만들기·모든 선수의 능력·잠재력·컨디션·계약·자금·구단주·팬, 다른 구단끼리도).
// 판단에 안전망은 두지 않는다 (AI가 정하면 그대로). 경기는 엔진이 시뮬레이션한다.
// 리그 밖 실존 인물(해외 리그 선수, 은퇴 선수 등)도 데려올 수 있다 (사용자: "자유 모드의 목적이 그거야"). 실존 선수 규칙은 지시문에서 뺐다 (prompts.ts)
// 조작은 이름 대신 id로 바꿔 이야기 기록(FantasyEntry.ops)에 남기고, 재현·불러오기 때는 AI 없이 그대로 다시 적용한다 (session.applyFreeOps).
import type { GameSession } from '../game/session';
import { leagueQuality } from '../engine';
import { foreignRule } from '../league/eras';
import type { LeaguePlayer } from '../league/types';
import { complete, extractJson, type LlmSettings } from './llm';
import { gameContext } from './context';
import { RULES } from './prompts';
import { leniencyOf, leniencyRule, type Leniency } from './leniency';
import { memoryContext } from './history';
import { sanitizeEffects, type FantasyEffect } from './effects';
import type { FantasyEntry } from './types';
import type { DataStore } from '../data/types';
import { currentRuns } from '../ai/value';
import { asSim } from '../league/growth';
import { changedRules, clampRule, foreignPostingOn, ruleDate, ruleOf, RULE_DEFS, type RuleKey } from '../league/rules';
import { ownedPicks, pickOwner, PICK_MAX_ROUND, PICK_YEARS_AHEAD } from '../league/picks';
import { capPayroll, salaryCap } from '../league/salary';
import { cashOf } from '../league/finance';
import { pickTradeAllowed } from '../league/difficulty';
import { STAGES, STAGE_LABEL } from '../league/offseason';
import { formatDate } from '../game/calendar';

type Store = Pick<DataStore, 'meta' | 'season' | 'players'> & Partial<Pick<DataStore, 'drafts'>>;

export type FreeOp =
  /** 선수를 그 구단으로 (−1이면 방출). 우리·다른 구단 모두 */
  | { op: 'move'; player: string; to: number }
  /** 선수를 만든다 (가상 인물, 또는 real이면 리그 밖에서 데려온 실존 인물). now·potential은 20~80 등급 */
  | { op: 'create'; name: string; team: number; pos: 'P' | 'C' | 'IF' | 'OF'; age: number; now: number; potential: number; real?: boolean }
  /** 능력(now)·잠재력(potential)을 20~80 등급으로 */
  | { op: 'ability'; player: string; now?: number; potential?: number }
  /** 계약: 연봉(만 원), 기간(이번 시즌부터 몇 해) */
  | { op: 'contract'; player: string; salary: number; years: number }
  /** 다른 구단 자금 (만 원) */
  | { op: 'teamCash'; team: number; amount: number }
  /** 판타지 효과 (신뢰·팬·자금·관중·컨디션·휴식 등, 상한 넉넉히) */
  | { op: 'effect'; effect: FantasyEffect }
  /** 지명권 주인을 바꾼다 (draft 입단 연도, round 라운드, from 원래 구단, to 새 주인) */
  | { op: 'pick'; draft: number; round: number; from: number; to: number }
  /** 리그 규정을 바꾼다 (league/rules.ts) */
  | { op: 'rule'; key: RuleKey; value: number | null };

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
- {"op":"create","name":"이름","team":"구단 이름","pos":"P|C|IF|OF","age":17~50,"now":20~80,"potential":20~80,"real":true|false} 선수를 그 구단에 넣는다. 리그 밖 실존 인물(해외 리그 선수, 은퇴 선수 등)을 데려오면 real true와 그 사람의 이름·나이, 지어낸 인물이면 real false
- {"op":"ability","player":"선수 이름","now":20~80,"potential":20~80} 능력·잠재력 등급을 바꾼다 (둘 중 하나만도 됨, 50 = 리그 주전 평균)
- {"op":"contract","player":"선수 이름","salary":억 원(소수),"years":1~10} 계약을 바꾼다
- {"op":"cash","amount":억 원} 우리 구단 자금 (+ 들어옴, − 나감)
- {"op":"teamCash","team":"구단 이름","amount":억 원} 다른 구단 자금
- {"op":"trust","delta":정수} 구단주 신뢰 (0~100 안에서)
- {"op":"fans","delta":정수} 우리 팬 만족도
- {"op":"teamForm","side":"bat|pit|all","edge":−0.05~0.05,"days":1~60} 우리 선수단 컨디션 (시즌 중)
- {"op":"playerForm","player":"우리 선수 이름","edge":−0.05~0.05,"days":1~60} (시즌 중)
- {"op":"rest","player":"우리 선수 이름","days":1~30} (시즌 중)
- {"op":"pick","draft":입단 연도,"round":라운드,"from":"원래 구단 이름","to":"새 주인 구단 이름"} 신인 지명권을 넘긴다 ([지명권]의 남은 지명권만)
- {"op":"rule","key":"규정 키","value":값} 리그 규정을 바꾼다 ([이 게임의 규정]의 키와 범위. 리그 전체에 적용된다)`;

export function freeSystem(regressor: boolean, l: Leniency = 3): string {
  return `너는 KBO 단장 시뮬레이션의 "자유 모드" 게임 마스터(TRPG 진행자)다. 플레이어는 한 구단의 단장이고, 무엇이든 하겠다고 말할 수 있다.
너는 그 행동이 이 세계에서 어떻게 되는지 판정하고(성공·실패·조건부·대가), 결과를 이야기로 들려주고, 실제 게임에 반영할 조작을 낸다.
- 판정은 네가 한다. 아래 판정 기준에 따라 명분·구단 사정·상대 입장·대가를 본다. 상대 구단·인물도 네가 연기한다.
- 트레이드·영입 같은 일은 상대가 받아들일 때만 조작을 낸다. 거절·보류면 조작 없이 이야기만.
- 플레이어가 말하지 않은 큰일을 멋대로 벌이지 않는다. 다만 판정의 대가·부작용(자금, 팬, 구단주 신뢰 등)은 붙일 수 있다.
- 경기 결과·기록은 바꾸지 않는다 (경기는 엔진이 치른다).
- 규정: [이 게임의 규정]이 이 세계의 규정 전부다. 네가 아는 실제 KBO 규약·관행과 다르면 이 게임의 규정을 따른다. 목록에 없는 규정을 지어내 거절 이유로 쓰지 않는다.
  규정은 리그 전체의 일이라, 바꾸려면 KBO 이사회·총재·다른 구단을 움직일 명분이 필요하다 (판정 기준에 따라). 바꾸면 rule 조작을 낸다.
- 리그 안 선수는 move·ability·contract로, 리그 밖 인물(해외 리그 선수, 은퇴 선수 등, [행동에 나온 이름]의 "리그에 없음"이나 네가 아는 사람)은 판정에 따라 create(real true)로 데려온다.
  리그 밖 인물을 데려올 때는 그 사람의 실제 나이와 지금 기량에 맞게 능력·잠재력을 정하고, 몸값·이적료·본인 의사 같은 명분과 대가를 판정한다.
  같은 이름의 선수가 리그 안에 따로 있으면 혼동하지 않는다: 리그 안 선수는 "이름@구단"으로 move, 리그 밖 사람은 create.
- 구단 운영과 관계없는 요청(야구 밖의 일)은 단장의 세계 안에서 짧게 이야기로만 다루고 조작은 내지 않는다.
${regressor ? '- 단장은 원래 역사를 기억하는 회귀자다 (다른 인물은 모른다).\n' : ''}
${leniencyRule(l)}

${RULES}

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
  return rows.map(({ p, runs }) => `${p.name}${p.outsider ? '(실존·리그 밖에서 옴)' : p.real === false ? '(가상)' : '(실존)'} ${p.isPitcher ? '투수' : p.pos ?? '야수'} ${p.birthYear ? year - p.birthYear : '?'}세 능력${gradeOfRuns(runs, year)} 잠재${gradeOfRuns(p.potential, year)} 연봉${p.foreign ? `${Math.round(p.contract.salary / 10000)}만 달러` : `${Math.round(p.contract.salary / 1000) / 10}억`}`).join('; ');
}

/** 지금 소속 (시즌 중에는 월드, 오프시즌에는 리그) */
export function teamOfNow(g: GameSession, p: LeaguePlayer): number {
  if (g.phase === 'season') {
    const sp = g.world.players.find((x) => x.id === p.id);
    return sp ? sp.teamIdx : p.team;
  }
  return p.team;
}

const won = (v: number) => `${Math.round(v / 1000) / 10}억 원`;
const dollar = (v: number) => `${Math.round(v / 10000).toLocaleString('ko-KR')}만 달러`;

/** 지금 이 게임의 규정 (AI가 실제 KBO 규약 대신 따르는 목록, 2026-10-13 사용자 요청 "우리 룰에 대해 프롬프트") */
export function rulesContext(g: GameSession, store: Store): string {
  const L = g.league;
  const season = g.phase === 'season';
  const year = season ? g.world.year : g.year + 1;
  const lines: string[] = [];
  if (season) {
    const tdl = ruleDate(L, 'tradeDeadline');
    const mdl = ruleDate(L, 'marketDeadline');
    lines.push(`- 지금: ${year} 시즌 중 ${formatDate(year, g.currentDay)}. 트레이드 ${g.tradeOpen ? `가능 (마감 ${tdl.month}월 ${tdl.date}일)` : `마감됨 (${tdl.month}월 ${tdl.date}일)`}, 시즌 중 방출·영입 마감 ${mdl.month}월 ${mdl.date}일`);
  } else {
    lines.push(`- 지금: ${g.year} 오프시즌 (${g.offseason ? STAGE_LABEL[g.offseason.stage] : ''} 단계). 다음 시즌 ${year}`);
  }
  const fr = foreignRuleFor(g, store, year);
  lines.push(`- 외국인: 보유 ${fr.regular}명${fr.asia ? ` + 아시아쿼터 ${fr.asia}명` : ''}, 신규 계약 상한 ${dollar(ruleOf(L, 'foreignNewCap'))}, 아시아쿼터 신규 상한 ${dollar(ruleOf(L, 'asiaNewCap'))}, 총액 상한 ${dollar(ruleOf(L, 'foreignTotalCap'))}, 시즌 중 교체 ${ruleOf(L, 'foreignSwaps')}번. 외국인 선수는 구단 간 트레이드 불가`);
  lines.push(`- 외국인 포스팅: ${foreignPostingOn(L) ? '켜짐 (KBO 외국인 선수도 해외 구단 요청으로 포스팅, 원소속 구단이 이적료를 받음)' : '꺼짐 (실제 KBO처럼 없음. 켜려면 rule foreignPosting 1)'}`);
  const cap = salaryCap(year, L);
  lines.push(`- 샐러리캡: ${cap === null ? (ruleOf(L, 'capScale') <= 0 ? '폐지됨' : '아직 없음 (2023년 도입)') : `${won(cap)} (연봉 상위 ${ruleOf(L, 'capTopN')}명, 외국인·신인 제외). 우리 구단 지금 ${won(capPayroll(L.players, g.teamIdx, ruleOf(L, 'capTopN')))}. 초과 제재금 배율 ${ruleOf(L, 'capFineScale')}, 3회 초과 때 1라운드 지명 ${ruleOf(L, 'capPickDrop')}자리 강등`}`);
  lines.push(`- 트레이드: 한쪽 ${ruleOf(L, 'maxPerSide')}명까지, 지명권 ${pickTradeAllowed(L, g.year, 2020) ? `한 번에 ${ruleOf(L, 'maxPicksPerTrade')}장까지 거래 가능 (다음 ${PICK_YEARS_AHEAD}번의 드래프트, ${PICK_MAX_ROUND}라운드까지)` : '거래 불가 (이 시대 규정)'}. 현금 트레이드 가능`);
  lines.push(`- FA: 오프시즌 외부 FA ${ruleOf(L, 'maxFaSignings')}명까지. 비FA 다년 계약 최대 ${ruleOf(L, 'extMaxYears')}년`);
  lines.push(`- 선수단: 소속 정원 ${ruleOf(L, 'orgLimit')}명, 육성선수 ${ruleOf(L, 'devLimit')}명 (${ruleOf(L, 'devMaxAge')}세 이하). 포스트시즌 연장 ${ruleOf(L, 'postseasonMaxInnings')}회까지`);
  lines.push(`- 우리 구단 자금: ${won(cashOf(L, g.teamIdx))}`);
  const ch = changedRules(L);
  if (ch.length) lines.push(`- 이 게임에서 바뀐 규정: ${ch.map((c) => `${c.label} ${c.from ?? '실제'} → ${c.to ?? '실제'}`).join(', ')}`);
  lines.push(`[규정 키와 범위 (rule 조작용)] ${RULE_DEFS.map((d) => `${d.key}: ${d.label} ${d.min}~${d.max}`).join('; ')}`);
  return `[이 게임의 규정]\n${lines.join('\n')}`;
}

function foreignRuleFor(g: GameSession, store: Store, year: number) {
  return foreignRule(store.meta, year, g.league);
}

/** 넘길 수 있는 지명권의 가장 이른 드래프트 (이번 드래프트가 이미 시작됐으면 그다음) */
export function firstOpenDraft(g: GameSession): number {
  if (g.phase === 'season') return g.world.year + 1;
  const st = g.offseason?.stage;
  return st && STAGES.indexOf(st) >= STAGES.indexOf('draft') ? g.year + 2 : g.year + 1;
}

function picksContext(g: GameSession): string {
  const L = g.league;
  const teams = L.teams.map((_, i) => i).filter((i) => g.phase !== 'season' || g.world.teams[i]);
  const first = firstOpenDraft(g);
  const base = first - 1;
  const mine = ownedPicks(L, g.teamIdx, base, teams).filter((p) => p.draft >= first);
  const fmt = (p: { draft: number; round: number; from: number }) => `${p.draft} ${p.round}라운드(${L.teams[p.from].name} 원래)`;
  // 다른 구단은 자기 지명권에서 달라진 것만 (넘겨준 것, 받아 온 것)
  const others = teams.filter((t) => t !== g.teamIdx).map((t) => {
    const ps = ownedPicks(L, t, base, teams).filter((p) => p.draft >= first);
    const extra = ps.filter((p) => p.from !== t);
    const gone: string[] = [];
    for (let d = first; d <= base + PICK_YEARS_AHEAD; d++) for (let r = 1; r <= PICK_MAX_ROUND; r++) {
      const o = pickOwner(L, { draft: d, round: r, from: t });
      if (o !== t) gone.push(`${d} ${r}라운드 → ${L.teams[o]?.name ?? '?'}`);
    }
    return gone.length || extra.length ? `${L.teams[t].name}: ${[...gone.map((x) => `넘김 ${x}`), ...extra.map((p) => `받음 ${fmt(p)}`)].join(', ')}` : '';
  }).filter(Boolean);
  return `[지명권] (넘길 수 있는 것: ${first}~${base + PICK_YEARS_AHEAD} 드래프트, 1~${PICK_MAX_ROUND}라운드. 각 구단은 따로 적지 않으면 자기 지명권을 모두 가지고 있다)\n우리: ${mine.map(fmt).join(', ') || '없음'}${others.length ? `\n다른 구단 변동: ${others.join('; ')}` : ''}`;
}

/** 행동에 나온 이름: 리그 안 선수(소속)와 리그에 없는 실존 인물을 구분해 AI에 알려 준다 (예: "MLB의 박찬호" ↔ 리그의 다른 박찬호) */
export function namesContext(g: GameSession, store: Store, action: string): string {
  const L = g.league;
  const year = g.phase === 'season' ? g.world.year : g.year + 1;
  const inLeague = new Map<string, LeaguePlayer[]>();
  for (const p of L.players) if (p.name.length >= 2 && action.includes(p.name)) inLeague.set(p.name, [...(inLeague.get(p.name) ?? []), p]);
  const seen = new Set(L.players.map((p) => p.id));
  const outside = new Map<string, string[]>();
  for (const m of store.players.values()) {
    if (m.name.length < 2 || seen.has(m.id) || !action.includes(m.name)) continue;
    outside.set(m.name, [...(outside.get(m.name) ?? []), `${m.birthYear ?? '?'}년생 ${m.kind === 'P' ? '투수' : '야수'}, KBO 기록 ${m.first}~${m.last}`]);
  }
  // 더 긴 이름의 일부로만 나온 이름은 뺀다 ("박찬호" 안의 "박찬")
  const all = [...inLeague.keys(), ...outside.keys()];
  const partOnly = (n: string) => all.some((m) => m !== n && m.includes(n)) && action.split(all.find((m) => m !== n && m.includes(n))!).join('').indexOf(n) < 0;
  for (const n of [...inLeague.keys()]) if (partOnly(n)) inLeague.delete(n);
  for (const n of [...outside.keys()]) if (partOnly(n)) outside.delete(n);
  const lines: string[] = [];
  for (const [name, ps] of inLeague) {
    for (const p of ps) {
      const t = teamOfNow(g, p);
      const where = t >= 0 ? L.teams[t].name : t === -2 ? '해외 (조작 불가)' : L.retired?.some((r) => r.id === p.id) ? '은퇴 (조작 불가)' : '무소속';
      lines.push(`- ${name}${t >= 0 ? `@${L.teams[t].name}` : ''}: 리그 안 (${where}, ${p.birthYear ? year - p.birthYear : '?'}세 ${p.isPitcher ? '투수' : '야수'})`);
    }
  }
  for (const [name, desc] of outside) lines.push(`- ${name}: 리그에 없음 (${desc.join(' / ')}). 데려오려면 create (real true)`);
  if (!lines.length) return '';
  return `[행동에 나온 이름]\n${lines.join('\n')}\n(행동이 말하는 사람이 리그 안 선수와 다른 사람이면 — 예를 들어 해외 리그 현역이나 은퇴한 같은 이름의 선수 — 리그 안 선수를 대신 옮기지 말고 create로 데려온다)`;
}

export function freeContext(g: GameSession, store: Store, action = ''): string {
  const parts = [gameContext(g), rulesContext(g, store), picksContext(g)];
  const names = namesContext(g, store, action);
  if (names) parts.push(names);
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
export function resolveOps(g: GameSession, raw: unknown, store?: Pick<DataStore, 'players'>): { ops: FreeOp[]; dropped: string[] } {
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
        // 리그 밖 실존 인물: AI가 real로 냈거나, 자료(KBO 기록)에는 있는데 지금 리그에 없는 이름
        const inLeague = new Set(g.league.players.map((p) => p.id));
        const real = e.real === true || (!!store && [...store.players.values()].some((m) => m.name === name && !inLeague.has(m.id)));
        const pos = e.pos === 'P' || e.pos === 'C' || e.pos === 'IF' || e.pos === 'OF' ? e.pos : 'IF';
        ops.push({ op: 'create', name, team, pos, age: Math.max(17, Math.min(real ? 50 : 40, Math.round(num(e.age) ?? 22))),
          now: Math.max(20, Math.min(80, Math.round(num(e.now) ?? 45))), potential: Math.max(20, Math.min(80, Math.round(num(e.potential) ?? 55))), ...(real ? { real: true } : {}) });
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
      case 'pick': {
        const from = teamByName(g, e.from);
        const to = teamByName(g, e.to);
        const draft = num(e.draft);
        const round = num(e.round);
        const first = firstOpenDraft(g);
        if (from === null || from < 0 || to === null || to < 0 || draft === null || round === null || draft < first || draft > first - 1 + PICK_YEARS_AHEAD
          || round < 1 || round > PICK_MAX_ROUND || pickOwner(g.league, { draft, round, from }) === to) {
          dropped.push(`pick: ${String(e.draft)} ${String(e.round)}라운드 (${String(e.from)} → ${String(e.to)})`);
          break;
        }
        ops.push({ op: 'pick', draft, round, from, to });
        break;
      }
      case 'rule': {
        const def = RULE_DEFS.find((d) => d.key === e.key);
        const v = e.value === null || e.value === '실제' ? null : num(e.value);
        if (!def || (v === null && def.key !== 'foreignRegular' && def.key !== 'foreignAsia')) { dropped.push(`rule: ${String(e.key)}`); break; }
        ops.push({ op: 'rule', key: def.key, value: v === null ? null : clampRule(def.key, v) });
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
    system: freeSystem(!!g.league.fantasy?.regressor, leniencyOf(g.league)),
    messages: [{ role: 'user', content: `[게임 상황]\n${freeContext(g, store, action)}\n\n[단장의 행동]\n${action}` }],
    maxTokens: 1500,
    mockReply: JSON.stringify({ title: '(시험용) 판정', narration: '단장의 뜻대로 일이 진행됐다.', ops: [{ op: 'fans', delta: 1 }] }),
  });
  const j = extractJson<{ title?: string; narration?: string; ops?: unknown }>(raw);
  if (!j?.narration) throw new Error('AI가 형식에 맞지 않게 답했습니다. 다시 시도하세요.');
  const { ops, dropped } = resolveOps(g, j.ops, store);
  return {
    entry: { kind: 'action', title: String(j.title ?? '행동').slice(0, 80), ask: action.slice(0, 1000), text: String(j.narration).slice(0, 3000), who: '게임 마스터', ...(ops.length ? { ops } : {}) },
    dropped,
  };
}
