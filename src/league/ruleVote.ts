// 구단 투표 단장 회의 (구단투표 기획안 v0.2, 개발 V2·V3): 결산 때 미래 규칙 변경 ②의 후보를 바로 넣지 않고 안건으로 올린다.
// 오프시즌 첫 단계('vote')에서 10개 구단이 표결하고(AI 표는 ai/vote.ts, 결산 직후 계산해 저장), 2/3가 찬성하면 다음 시즌에 바뀐다.
// 이 파일은 구단 지표 모으기와 문구. 단계 진행(열기·우리 표·개표)은 offseason.ts.

import type { Season, World } from '../engine';
import { aiVotes, BIG_RULE_LABEL, countVotes, SWING_LABEL, voteOutlook, type RuleAgenda, type RuleVoteRecord, type VoteChoice, type VoteFacts } from '../ai/vote';
import { tendencyOf } from '../ai/trade';
import { isServing } from './careers';
import { cashOf } from './finance';
import { FUTURE_RULE_LABEL, futureRulesOn, futureValueText, type FutureRuleKey, type RuleShift } from './futureRules';
import { gmStyle } from './gm';
import { isAbroad } from './overseas';
import { salaryCap, teamCapPayroll } from './salary';
import type { LeaguePlayer, LeagueState } from './types';
import { isFuturesTeam } from './world';

/** 미래 규칙 변경 ②를 표결로 정하는가 (구단 투표, 2026-10-23). 끄면 예전처럼 결산 때 바로 바뀐다 (테스트가 표결 전과 견줄 때 끈다) */
export const RULE_VOTE = { on: true };

export function ruleVoteOn(league: Pick<LeagueState, 'fantasy'>): boolean {
  return RULE_VOTE.on && futureRulesOn(league);
}

/** 오프시즌 상태에 담는 단장 회의 (OffseasonState.vote) */
export interface VoteStage {
  agendas: RuleAgenda[];
  /** 안건별 구단별 AI 표 (1 찬성 · 0 반대 · −1 표결권 없음). 플레이어 구단 칸은 실무진 추천 */
  ai: number[][];
  /** 안건 id → 우리 표 (없으면 반대, 결정 4) */
  user: Record<string, VoteChoice>;
  /** AI 표를 낼 때 쓴 구단 지표 (화면 "우리 구단에 닿는 것"이 같은 값을 보인다). 이 항목이 생기기 전 저장에는 없다 */
  facts?: VoteFacts[];
}

/** 규칙 변경 후보 → 안건 */
export function agendaOf(shift: RuleShift): RuleAgenda {
  return { id: `${shift.year}-${shift.key}`, year: shift.year, key: shift.key, before: shift.before, after: shift.after, reason: shift.reason, signal: shift.signal };
}

/** 표결권이 있는 구단: 그 시즌 1군 구단 (창단 뒤 퓨처스 구단은 뺀다) */
export function voters(league: LeagueState, year: number): number[] {
  return league.teams.map((_, t) => t).filter((t) => !isFuturesTeam(league, t, year));
}

/**
 * 구단 지표 (결산 직후, ai/vote.ts VoteFacts). runs(p) = 다음 시즌 나이로 본 선수 기여 (런).
 * 시즌 기록(결장·홈런·볼넷·삼진)은 시즌 끝 소속으로 센다
 */
export function voteFacts(league: LeagueState, world: World, season: Season, year: number, runs: (p: LeaguePlayer) => number): VoteFacts[] {
  const teams = voters(league, year);
  const n = league.teams.length;
  const days = season.schedule.length;
  const absence = new Array(n).fill(0);
  for (const a of season.absences) {
    const t = world.players[a.idx]?.teamIdx ?? -1;
    if (t >= 0 && t < n) absence[t] += Math.max(0, Math.min(a.until, days) - a.day);
  }
  const hr = new Array(n).fill(0);
  const bb = new Array(n).fill(0);
  const so = new Array(n).fill(0);
  const pso = new Array(n).fill(0);
  const pbf = new Array(n).fill(0);
  for (const sp of world.players) {
    const t = sp.teamIdx;
    if (t < 0 || t >= n) continue;
    const b = season.bat[sp.idx];
    const q = season.pit[sp.idx];
    hr[t] += b.hr;
    bb[t] += b.bb;
    so[t] += b.so;
    pso[t] += q.so;
    pbf[t] += q.bf;
  }
  const hrMean = teams.reduce((a, t) => a + hr[t], 0) / (teams.length || 1);
  const cap = salaryCap(year, league);
  const cut = world.rules.postseasonTeams;
  const sum = (xs: number[], k: number) => [...xs].sort((a, b) => b - a).slice(0, k).reduce((a, b) => a + b, 0);
  const base = teams.map((t) => {
    const org = league.players.filter((p) => p.team === t && !isServing(p) && !isAbroad(p)).map((p) => ({ p, r: runs(p) }));
    const hit = org.filter((x) => !x.p.isPitcher).map((x) => x.r);
    const sp = org.filter((x) => x.p.isPitcher && (x.p.pit?.startShare ?? 0) >= 0.5).map((x) => x.r);
    const rp = org.filter((x) => x.p.isPitcher && (x.p.pit?.startShare ?? 0) < 0.5).map((x) => x.r);
    const bat = sum(hit, 9);
    const pit = sum(sp, 5) + sum(rp, 7);
    const top = [...org].sort((a, b) => b.r - a.r || a.p.id.localeCompare(b.p.id));
    const top25 = top.slice(0, 25);
    const pos = (x: number) => Math.max(0, x);
    const all = top25.reduce((a, x) => a + pos(x.r), 0);
    const ages = top.slice(0, 14).map((x) => (x.p.birthYear ? year + 1 - x.p.birthYear : 28));
    const h = league.finance?.[t]?.history.find((y) => y.year === year);
    return {
      t, strength: bat + pit, bat, pit,
      domestic: sum(org.filter((x) => !x.p.foreign).map((x) => pos(x.r)), 25),
      foreign: all > 0 ? top25.filter((x) => x.p.foreign).reduce((a, x) => a + pos(x.r), 0) / all : 0,
      depth: top[29]?.r ?? 0,
      bullpen: sum(rp, 7),
      coreAge: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 28,
      net: h?.net ?? 0,
    };
  });
  return base.map((b) => {
    const rank = 1 + base.filter((x) => x.strength > b.strength || (x.strength === b.strength && x.t < b.t)).length;
    const pay = teamCapPayroll(league, b.t, year);
    return {
      team: b.t,
      cash: cashOf(league, b.t),
      strength: b.strength,
      domestic: b.domestic,
      foreign: b.foreign,
      capUse: cap ? pay / cap : pay,
      net: b.net,
      absence: absence[b.t],
      depth: b.depth,
      bullpen: b.bullpen,
      pitchBat: b.pit - b.bat,
      hr: hrMean > 0 ? hr[b.t] / hrMean : 1,
      eye: so[b.t] > 0 ? bb[b.t] / so[b.t] : 0,
      kPitch: pbf[b.t] > 0 ? pso[b.t] / pbf[b.t] : 0,
      tendency: tendencyOf({ teamIdx: b.t, rank, nTeams: teams.length, cut, coreAge: b.coreAge, remaining: 1, style: gmStyle(league, b.t) }),
    };
  });
}

/** 단장 회의를 연다: 안건마다 AI 표를 계산해 둔다 (이 뒤로 바뀌지 않는다) */
export function openVoteStage(league: LeagueState, agendas: RuleAgenda[], facts: VoteFacts[]): VoteStage {
  return { agendas, ai: agendas.map((a) => aiVotes(a, facts, league.teams.length)), user: {}, facts };
}

/** 안건 이름 */
export function agendaLabel(a: Pick<RuleAgenda, 'key' | 'big'>): string {
  return a.big ? BIG_RULE_LABEL[a.key as keyof typeof BIG_RULE_LABEL] : FUTURE_RULE_LABEL[a.key as FutureRuleKey];
}

/** 안건 전 → 후 문구 */
export function agendaChange(a: Pick<RuleAgenda, 'key' | 'big' | 'before' | 'after'>): string {
  return a.big ? `${a.before} → ${a.after}` : `${futureValueText(a.key as FutureRuleKey, a.before)} → ${futureValueText(a.key as FutureRuleKey, a.after)}`;
}

/** 단장 회의 안건 소식 (열 때): 전 → 후, 까닭, 문턱, 여론 (결정 10: 정확한 수) */
export function agendaText(a: RuleAgenda, ai: number[], userTeam: number): string {
  const o = voteOutlook(ai, userTeam);
  const voters = ai.filter((v) => v >= 0).length;
  const advice = o.advice ? ` 실무진 추천: ${o.advice === 'yes' ? '찬성' : '반대'}. 표를 내지 않으면 반대로 셉니다.` : '';
  return `단장 회의 안건 (게임 속 가상 결정): ${a.year} 시즌 ${agendaLabel(a)} ${agendaChange(a)}. 발의 까닭: ${a.reason}. `
    + `${voters}개 구단 중 ${o.need}곳이 찬성해야 통과. 여론: 찬성 ${o.yes} · 반대 ${o.no}${userTeam >= 0 ? ` · ${SWING_LABEL[o.swing]}` : ''}.${advice}`;
}

/** 개표: 기록 하나와 (가결이면) 규칙 변경 */
export function tallyAgenda(a: RuleAgenda, ai: number[], userTeam: number, user?: VoteChoice): { record: RuleVoteRecord; shift: RuleShift | null } {
  const c = countVotes(ai, userTeam, user);
  const record: RuleVoteRecord = { ...a, ...c, ...(userTeam >= 0 ? { userTeam, ...(user ? { user } : {}) } : {}) };
  const shift: RuleShift | null = c.passed && !a.big
    ? { year: a.year, key: a.key as FutureRuleKey, before: a.before, after: a.after, reason: a.reason, signal: a.signal,
      vote: { yes: c.yes, no: c.no, need: c.need, ...(userTeam >= 0 ? { user: user ?? 'no' } : {}) } }
    : null;
  return { record, shift };
}

/** 개표 결과 소식 */
export function tallyText(r: RuleVoteRecord, teamName: (t: number) => string): string {
  const side = (v: number) => r.votes.map((x, t) => (x === v ? t : -1)).filter((t) => t >= 0)
    .map((t) => (t === r.userTeam ? `(우리) ${teamName(t)}` : teamName(t))).join(' · ') || '없음';
  const ours = r.userTeam !== undefined ? ` 우리 구단: ${r.user === 'yes' ? '찬성' : r.user === 'no' ? '반대' : '반대 (표를 내지 않음)'}.` : '';
  const what = r.passed
    ? `${r.year} 시즌부터 ${agendaLabel(r)} ${agendaChange(r)}.`
    : `규칙은 그대로 (${r.big ? r.before : futureValueText(r.key as FutureRuleKey, r.before)}). 같은 안건은 2시즌 쉰다.`;
  return `단장 회의 ${r.passed ? '가결' : '부결'} (게임 속 가상 결정): ${agendaLabel(r)} 찬성 ${r.yes} : 반대 ${r.no} (문턱 ${r.need}).${ours} ${what} 찬성 ${side(1)} / 반대 ${side(0)}`;
}
