// 에디터 고치기 조작 (docs/에디터_기획안.md 3.2·4.1, E2 선수 하나 고치기, 2026-11-03 사용자 Q4·Q5).
// EditOp = 자유 모드 FreeOp(move·ability·contract)를 그대로 다시 쓰고, 에디터 전용 조작(birth·heal·military)을 더한다.
// 값을 그대로 넣으므로 난수를 쓰지 않는다 (조작 기록으로 같은 날·같은 순서에 다시 적용 = 같은 결과).
// 규정(외국인 한도·트레이드 금지·정원·샐러리캡·최저 연봉)은 넘어설 수 있고 경고만 낸다 (Q5). 결과(캡 제재 등)는 평소대로.
// 실존 선수에게 부상·사건을 넣는 고치기는 없다 (부상은 낫게 하기만, CLAUDE.md 실존 선수 규칙).
import type { FreeOp } from '../fantasy/free';
import { MIN_JOIN_AGE } from '../fantasy/free';
import { foreignRule } from '../league/eras';
import { ruleOf } from '../league/rules';
import { minSalary, salaryCap, teamCapPayroll } from '../league/salary';
import type { LeaguePlayer } from '../league/types';
import type { BranchCeiling } from '../league/branches';
import type { GameSession } from './session';

/** 병역 고치기로 고를 수 있는 상태 (복무 중으로 넣거나 복무 중인 선수를 돌려놓는 것은 하지 않는다, 기획안 3.2) */
export type EditMilitary = 'pending' | 'done' | 'exempt';

export type EditOp =
  | Extract<FreeOp, { op: 'move' | 'ability' | 'contract' }>
  /** 생년 (나이 추정 표시는 지운다) */
  | { op: 'birth'; player: string; birthYear: number }
  /** 부상 낫게 하기 (오늘부터 출전 가능, 넘어온 부상 재활도). 부상을 넣는 조작은 없다 */
  | { op: 'heal'; player: string }
  /** 병역: 미필·마침·면제 */
  | { op: 'military'; player: string; state: EditMilitary }
  /**
   * 갈래 능력·갈래 천장 (E3). 화면은 갈래 등급(nowGrade·ceilGrade: 갈래 이름 → 20~80)으로 넣고, 미리보기(editorPreview)가
   * 능력 비율로 풀어 조작에 남긴다: now(바뀐 갈래의 비율), ceil(갈래 천장 전체), potential(종합 천장 런). 적용은 값을 그대로 넣는다
   */
  | { op: 'branch'; player: string; nowGrade?: Record<string, number>; ceilGrade?: Record<string, number>;
      now?: Record<string, number>; ceil?: BranchCeiling; potential?: number }
  /** 숨은 성장 성향 d(−1~1)·시기 τ(해) (E3) */
  | { op: 'grow'; player: string; drive?: number; timing?: number }
  /** 구단 자금 (E3, 만 원, 늘리면 +). 장부에 '에디터' 줄 */
  | { op: 'cash'; team: number; amount: number }
  /** 구단 팬 만족도 변화 (E3, 0~100 눈금의 차이) */
  | { op: 'fans'; team: number; delta: number }
  /** 구단주 신뢰 (E3, 우리 구단, 0~100 값 그대로) */
  | { op: 'trust'; value: number }
  /** 지명권 주인 (E3, 자유 모드 pick 그대로) */
  | Extract<FreeOp, { op: 'pick' }>;

/** 선수 고치기인가 (구단 고치기는 player가 없다) */
export function isPlayerOp(op: EditOp): op is Extract<EditOp, { player: string }> {
  return 'player' in op;
}

export const MILITARY_LABEL: Record<EditMilitary, string> = { pending: '미필', done: '마침', exempt: '면제' };

/** 고친 기록 한 줄 (조작 기록의 edit·edit-off에서) */
export interface EditRecord {
  year: number;
  /** 시즌 중이면 일정 색인, 오프시즌이면 -1 */
  day: number;
  /** 대상 선수 이름 (조작 때 이름) */
  names: string[];
  /** 전 → 후 문장 */
  lines: string[];
}

/** 그 고침이 쓰는 기준 시즌 (시즌 중 = 이 시즌, 오프시즌 = 다음 시즌) */
export function editYear(s: GameSession): number {
  return s.phase === 'season' ? s.world.year : s.year + 1;
}

function teamNow(s: GameSession, lp: LeaguePlayer): number {
  if (s.phase === 'season') {
    const sp = s.world.players.find((x) => x.id === lp.id);
    return sp ? sp.teamIdx : lp.team;
  }
  return lp.team;
}

/**
 * 고친 뒤 규정을 넘는 곳 (경고만, Q5). ops를 적용한 모습을 가늠해서 본다:
 * 외국인 구단 간 이동(트레이드 금지)·외국인 보유 한도·정식 선수 정원·샐러리캡·최저 연봉·입단 나이
 */
export function editWarnings(s: GameSession, ops: EditOp[]): string[] {
  const L = s.league;
  const year = editYear(s);
  const out: string[] = [];
  const team = new Map<string, number>();
  const contract = new Map<string, LeaguePlayer['contract']>();
  const lpOf = (id: string) => L.players.find((p) => p.id === id);
  for (const op of ops) {
    if (!isPlayerOp(op)) continue;
    const lp = lpOf(op.player);
    if (!lp) continue;
    if (op.op === 'move') {
      const from = teamNow(s, lp);
      if (lp.foreign && from >= 0 && op.to >= 0 && from !== op.to) out.push(`외국인 선수는 구단 사이에 옮길 수 없는 규정입니다 (에디터는 넘어섭니다).`);
      team.set(lp.id, op.to);
    } else if (op.op === 'contract') {
      contract.set(lp.id, { ...lp.contract, salary: op.salary, until: year + op.years - 1 });
      if (!lp.foreign && op.salary < minSalary(year, L)) out.push(`연봉이 그 해 최저 연봉(${(minSalary(year, L) / 10000).toFixed(2)}억 원, 2026년 물가)보다 적습니다.`);
    } else if (op.op === 'birth') {
      const age = year - op.birthYear;
      if (age < MIN_JOIN_AGE) out.push(`${year}년에 만 ${age}세로, 입단할 수 있는 나이(${MIN_JOIN_AGE}세)보다 어립니다.`);
      if (age > 50) out.push(`${year}년에 만 ${age}세입니다.`);
    }
  }
  // 바뀌는 구단마다 한도를 다시 본다 (옮겨 간 구단, 연봉이 바뀐 선수의 구단)
  const teams = new Set<number>();
  for (const [id, t] of team) { teams.add(t); const lp = lpOf(id); if (lp) teams.add(teamNow(s, lp)); }
  for (const id of contract.keys()) { const lp = lpOf(id); if (lp) teams.add(team.get(id) ?? teamNow(s, lp)); }
  teams.delete(-1);
  if (!teams.size) return [...new Set(out)];
  const after = L.players.map((p) => {
    const t = team.get(p.id) ?? teamNow(s, p);
    const c = contract.get(p.id);
    return t === p.team && !c ? p : { ...p, team: t, ...(c ? { contract: c } : {}) };
  });
  const fr = foreignRule(s.store.meta, year, L);
  const orgLimit = ruleOf(L, 'orgLimit');
  const cap = salaryCap(year, L);
  for (const t of [...teams].sort((a, b) => a - b)) {
    const name = s.teamInfo(t).name;
    const members = after.filter((p) => p.team === t && p.reserve === undefined);
    const moved = [...team.entries()].some(([id, to]) => to === t && teamNow(s, lpOf(id)!) !== t);
    if (moved) {
      const foreign = members.filter((p) => p.foreign).length;
      if (fr.total > 0 && foreign > fr.total) out.push(`${name}: 외국인 ${foreign}명으로 보유 한도 ${fr.total}명을 넘습니다.`);
      if (fr.total === 0 && foreign > 0) out.push(`${name}: 이 해는 외국인 선수 제도가 없습니다.`);
      const regular = members.filter((p) => !p.dev).length;
      if (regular > orgLimit) out.push(`${name}: 정식 선수 ${regular}명으로 정원 ${orgLimit}명을 넘습니다.`);
    }
    if (cap !== null) {
      const before = teamCapPayroll({ ...L, players: L.players.map((p) => ({ ...p, team: teamNow(s, p) })) }, t, year);
      const pay = teamCapPayroll({ ...L, players: after }, t, year);
      if (pay > cap && pay > before) out.push(`${name}: 캡 대상 연봉 ${(pay / 10000).toFixed(1)}억 원으로 샐러리캡 ${(cap / 10000).toFixed(1)}억 원을 넘습니다 (판정 때 제재는 평소대로).`);
    }
  }
  return [...new Set(out)];
}

/** 조작 기록에서 고친 기록 (최근 것 먼저) */
export function editRecords(s: GameSession): EditRecord[] {
  const out: EditRecord[] = [];
  for (const a of s.actions) {
    if (a.type !== 'edit' && a.type !== 'edit-off') continue;
    out.push({ year: a.year ?? s.league.startYear, day: a.type === 'edit' ? a.day : -1, names: a.names ?? [], lines: a.log ?? [] });
  }
  return out.reverse();
}
