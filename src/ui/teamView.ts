// 다른 구단 보기 (2026-10-23 UI 2단계 공통 기능, 기획안 4장 1·결정 7): 계산만. 그리기는 screens/TeamView.tsx.
// 우리 구단 화면과 같은 틀(명단 표·기용·구단 현황)을 읽기 전용으로 채운다. 아무것도 바꾸지 않는다.
// 1군·예상 기용은 Season.refresh(엔트리 다시 짜기, 난수 없음)로 읽는다. 화면 조회를 끼워도 결과가 같다 (tests/game.test.ts).
// 능력은 우리 선수와 같은 스카우트 추측(화면의 useSeen)으로 보이고, 진짜 기여·AI 구단의 판단값(aiPotential)은 쓰지 않는다.
import { activeOf, type GameSession } from '../game/session';
import { assignSlots, isStarterSkill, LINEUP_SLOTS, type SimPlayer, type Slot } from '../engine';
import type { LeaguePlayer } from '../league/types';
import { capPayroll, faEligible, salaryCap } from '../league/salary';
import { ruleOf } from '../league/rules';
import { parsePick } from '../league/picks';
import { slotOf, tradeBlockReason } from './tradeDesk';

export interface TeamRow {
  id: string;
  /** 시즌 월드의 선수 (선수 상세를 열 수 있을 때). 오프시즌에 새로 들어온 선수는 없다 */
  p: SimPlayer | null;
  lp: LeaguePlayer | undefined;
  name: string;
  pitcher: boolean;
  slot: string;
  age: number | null;
  /** '1군' | '2군' | '육성' (오프시즌은 '계약') */
  where: string;
  status: string;
  /** 트레이드할 수 없는 이유 (시즌 중에만) */
  block: string | null;
}

/** 그 구단 선수 명단. 시즌 중엔 월드 소속(트레이드 반영), 오프시즌엔 리그 상태 소속(계약 기준) */
export function teamRows(s: GameSession, team: number): TeamRow[] {
  const year = s.world.year;
  if (s.phase === 'offseason') {
    const byId = new Map(s.world.players.map((p) => [p.id, p]));
    return s.league.players.filter((lp) => lp.team === team && lp.military?.state !== 'serving').map((lp) => {
      const age = lp.birthYear ? year + 1 - lp.birthYear : null;
      return {
        id: lp.id, p: byId.get(lp.id) ?? null, lp, name: lp.name, pitcher: lp.isPitcher,
        slot: lp.isPitcher ? (isStarterSkill(lp.pit) ? 'SP' : 'RP') : lp.pos ?? 'DH',
        age, where: lp.dev ? '육성' : '계약', status: '-', block: null,
      };
    });
  }
  const org = s.world.teams[team]?.org ?? [];
  const active = new Set(activeOf(s.season.refresh(team, s.currentDay)).map((p) => p.idx));
  return org.map((p) => {
    const back = s.returnDay(p);
    const status = back !== null ? `결장 · ${back >= s.season.schedule.length ? '시즌 아웃' : '복귀 예정'}` : '출전 가능';
    return {
      id: p.id, p, lp: s.leaguePlayer(p.id), name: p.name, pitcher: p.isPitcher, slot: slotOf(p), age: p.age,
      where: p.dev ? '육성' : active.has(p.idx) ? '1군' : '2군', status, block: team === s.teamIdx ? null : tradeBlockReason(s, p),
    };
  });
}

export interface TeamDepth {
  starters: { slot: Slot; p: SimPlayer | null }[];
  rotation: SimPlayer[];
  closer: SimPlayer | null;
  /** 마무리를 뺀 1군 구원 (좋은 순) */
  pen: SimPlayer[];
  /** 1군 야수 가운데 주전이 아닌 선수 */
  bench: SimPlayer[];
}

/** 예상 기용: 다음 경기일 기준 AI 감독의 1군과 자리 배치 (기용표가 있으면 우리 구단만 그것). 시즌 중에만 */
export function teamDepth(s: GameSession, team: number): TeamDepth | null {
  if (s.phase !== 'season') return null;
  const ts = s.season.refresh(team, s.currentDay);
  const plan = team === s.teamIdx ? s.effectivePlan() : null;
  const P = s.world.players;
  const assigned = plan
    ? LINEUP_SLOTS.map((slot) => ({ slot, p: plan.starters[slot] !== undefined ? P[plan.starters[slot]!] : null }))
    : (() => {
      const m = new Map(assignSlots(ts.hitters).map((x) => [x.slot, x.p]));
      return LINEUP_SLOTS.map((slot) => ({ slot, p: m.get(slot) ?? null }));
    })();
  const on = new Set(assigned.map((x) => x.p?.idx));
  const rotation = plan ? plan.rotation.map((i) => P[i]) : ts.rotation;
  const closer = plan ? (plan.closer !== null ? P[plan.closer] : ts.closer) : ts.closer;
  const pen = [...ts.rotation, ...ts.bullpen].filter((p) => !rotation.includes(p) && p !== closer);
  // 화면 순서는 C 1B 2B 3B SS LF CF RF DH (LINEUP_SLOTS는 배정 우선순위 순)
  const order: string[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  assigned.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
  return { starters: assigned, rotation, closer, pen, bench: ts.hitters.filter((p) => !on.has(p.idx)) };
}

export interface TeamMoney {
  /** 캡 대상 합 (리그 상태 기준: 시즌 중엔 개막 때 계약) */
  cap: number;
  limit: number | null;
  /** 연봉 총액 (외국인 제외, 만 원) */
  payroll: number;
  /** 그 시즌 뒤 FA 자격이 될 선수 (지금까지 쌓은 1군 연차 기준, 보류 선수 1년 계약은 세지 않는다) */
  faNext: number;
  foreign: number;
}

export function teamMoney(s: GameSession, team: number): TeamMoney {
  const L = s.league;
  const year = s.phase === 'offseason' ? s.year + 1 : s.year;
  const mine = L.players.filter((p) => p.team === team && p.military?.state !== 'serving');
  return {
    cap: capPayroll(L.players, team, ruleOf(L, 'capTopN')),
    limit: salaryCap(year, L),
    payroll: mine.filter((p) => !p.foreign).reduce((a, p) => a + p.contract.salary, 0),
    faNext: mine.filter((p) => faEligible(p, year)).length,
    foreign: mine.filter((p) => p.foreign).length,
  };
}

export interface DealLine { year: number; day: number; text: string; kind: 'trade' | 'market' }

/** 최근 거래: 그 구단이 낀 트레이드(AI끼리·우리와)와 시즌 중 방출·영입. 새것부터 n건 */
export function teamDeals(s: GameSession, team: number, n = 8): DealLine[] {
  const L = s.league;
  const name = new Map<string, string>([...L.players.map((p) => [p.id, p.name] as const), ...s.world.players.map((p) => [p.id, p.name] as const)]);
  const nm = (id: string) => name.get(id) ?? (L.retired ?? []).find((r) => r.id === id)?.name ?? '?';
  const tn = (t: number) => (t >= 0 ? s.teamInfo(t).name : '시장');
  const pk = (id: string) => s.pickLabel(parsePick(id));
  const out: DealLine[] = [];
  for (const t of L.aiTrades ?? []) {
    if (t.buyer !== team && t.seller !== team) continue;
    const other = t.buyer === team ? t.seller : t.buyer;
    const got = t.buyer === team ? t.got.map(nm) : [...t.gave.map(nm), ...(t.picks ?? []).map(pk)];
    const gave = t.buyer === team ? [...t.gave.map(nm), ...(t.picks ?? []).map(pk)] : t.got.map(nm);
    out.push({ year: t.year, day: t.day, kind: 'trade', text: `트레이드 ↔ ${tn(other)}: 받음 ${got.join(', ') || '-'} / 내줌 ${gave.join(', ') || '-'}` });
  }
  // 우리 구단과의 트레이드 (이번 시즌, 월드 선수 색인)
  const P = s.world.players;
  for (const t of s.trades) {
    if (t.team !== team && team !== s.teamIdx) continue;
    const ours = team === s.teamIdx;
    const got = (ours ? t.get : t.give).map((i) => P[i].name);
    const gave = (ours ? t.give : t.get).map((i) => P[i].name);
    out.push({ year: s.year, day: t.day, kind: 'trade', text: `트레이드 ↔ ${tn(ours ? t.team : s.teamIdx)}: 받음 ${got.join(', ') || '-'} / 내줌 ${gave.join(', ') || '-'}` });
  }
  for (const m of L.marketMoves ?? []) {
    if (m.from !== team && m.to !== team) continue;
    const what = m.kind === 'release' ? '방출' : m.kind === 'claim' ? `영입 (${tn(m.from)} 방출 선수)` : '영입 (자유계약)';
    out.push({ year: m.year, day: m.day, kind: 'market', text: `${what}: ${nm(m.id)}` });
  }
  return out.sort((a, b) => b.year - a.year || b.day - a.day).slice(0, n);
}
