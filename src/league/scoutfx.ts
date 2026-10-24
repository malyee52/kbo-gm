// 외국인 스카우트 파견과 관찰 명단 (능력치 v2 기획안 19.4, 사용자 2026-10-24 확정 Q16·Q17).
//
// - 후보는 지역별로 미리 만든다: 시즌 중 후보는 개막 때(openMarket, 시즌 월드는 시즌 중에 선수를 더할 수 없어서), 오프시즌 후보는 외국인 단계를 열 때.
//   후보마다 시장에 머무는 주(fx.from ~ fx.until, 8~20주)를 시드로 정한다. 그 안에 계약하지 않으면 "다른 리그와 계약" 소식과 함께 사라진다.
// - 구단은 후보를 직접 보지 못한다. 스카우트 팀을 지역에 보내면(4주, 3억, 동시에 2팀) 1주마다 확률로 그 지역 후보가 관찰 명단에 붙는다 (4주 평균 1.5명).
//   파견이 없어도 에이전트 추천으로 4주마다 1명 (추측 폭 1.5배). 명단은 8명까지.
// - 관찰: 명단 후보의 추측 폭 σ = 기록 없는 선수 폭 × 프로 스카우트 배율 × 0.7^(그 지역에 팀이 나가 있던 주 ÷ 4) (scout.ts foreignSigma).
// - 오프시즌은 날이 없어 외국인 단계에서 파견하면 4주를 바로 굴린다 (팀마다 두 번, 결산 ~ 외국인 단계 약 8주의 단순화).
// - 계약은 관찰 명단에 있는 후보만. KBO에서 뛰다 풀린 외국인과 시작 연도의 실존 시장 외국인(marketFrom, "시장 소식")은 모든 구단이 본다.
// - 같은 시드 = 같은 후보·같은 발견. 발견 난수는 `${시드}/scout-fx/${구단}/${해}/${주}/${지역}` (오프시즌 주는 off-n).
// 크기는 모두 임시값 (기획안 숫자 그대로, 지역 비율은 이 파일).

import { Rng } from '../engine';
import { josa } from './names';
import type { LeaguePlayer, LeagueState } from './types';

const nameOf = (league: LeagueState, id: string) => league.players.find((p) => p.id === id)?.name ?? '';

export type FxRegion = 'na' | 'latam' | 'japan' | 'pacific';

export interface FxRegionDef {
  id: FxRegion;
  name: string;
  /** 화면 설명 (실제 리그·구단 이름은 쓰지 않는다) */
  note: string;
}

export const FX_REGIONS: FxRegionDef[] = [
  { id: 'na', name: '북미', note: '일반 외국인. 타자와 선발 투수가 많다' },
  { id: 'latam', name: '중남미', note: '일반 외국인. 젊고 실력 폭이 넓다' },
  { id: 'japan', name: '일본', note: '아시아쿼터·일반. 제구형 투수가 많다' },
  { id: 'pacific', name: '대만·호주', note: '아시아쿼터. 싸고 실력 폭이 넓다' },
];

export function regionName(r: FxRegion): string {
  return FX_REGIONS.find((x) => x.id === r)!.name;
}

/** 파견 한 번: 4주, 3억 (만 원), 동시에 2팀 (확정 Q16 ①) */
export const FX_WEEKS = 4;
export const FX_COST = 30000;
export const FX_MAX_OUT = 2;
/** 1주에 후보를 찾을 확률 (4주 평균 1.5명, 확정 Q17 ①) */
export const FX_FIND_WEEK = 1.5 / FX_WEEKS;
/** 관찰 명단 크기 (확정 Q17 ①) */
export const FX_LIST_MAX = 8;
/** 후보가 시장에 머무는 기간 (주): FX_STAY_MIN + 0~FX_STAY_SPAN (8~20주, 확정 Q17 ①) */
export const FX_STAY_MIN = 8;
export const FX_STAY_SPAN = 12;
/** 에이전트 추천: 이 주마다 1명, 추측 폭 배율 (19.4, 임시값) */
export const FX_AGENT_EVERY = 4;
export const FX_AGENT_SCALE = 1.5;
/** 오프시즌 에이전트 추천 수 (결산 ~ 외국인 단계 약 두 달, 임시값) */
export const FX_AGENT_OFF = 2;
/** 오프시즌 파견 한도 (팀 2개 × 두 번, 임시값) */
export const FX_OFF_SENDS = 4;
/** AI 윈나우 성향은 시즌 중 이 주에 한 번 더 보낸다 (19.3, 임시값) */
export const FX_AI_WINNOW_WEEK = 8;

/** 후보가 시장에 머무는 주 (시즌 중: 개막부터 센 주, 오프시즌: 0 ~ FX_OFF_UNTIL) */
export interface FxWindow { region: FxRegion; from: number; until: number }
export const FX_OFF_UNTIL = 99;

export interface FxDispatch { region: FxRegion; left: number }

export interface FxEntry {
  id: string;
  /** 명단에 붙은 주 (오프시즌은 -1) */
  at: number;
  /** 그 지역에 팀이 나가 있던 주 (관찰) */
  weeks: number;
  /** 에이전트 추천으로 붙음 (추측 폭 × FX_AGENT_SCALE) */
  agent?: true;
}

export interface FxTeam {
  out: FxDispatch[];
  list: FxEntry[];
  /** 명단이 찼을 때 기다리는 새 후보 (플레이어 구단만, 한 명. 명단에서 빼면 들어온다) */
  wait?: FxEntry;
  /** 이번 시기에 보낸 파견 수 */
  sent: number;
}

export interface ScoutFxState {
  year: number;
  /** 오프시즌(그 해 결산 뒤 외국인 단계)이면 true */
  off: boolean;
  teams: FxTeam[];
}

/** 소식 한 줄 (구단별) */
export interface FxNews { team: number; text: string }

const emptyTeam = (): FxTeam => ({ out: [], list: [], sent: 0 });

/** 그 시기의 상태 (없거나 다른 시기면 새로) */
export function fxState(league: LeagueState, year: number, off: boolean): ScoutFxState {
  const s = league.scoutFx;
  if (s && s.year === year && s.off === off && s.teams.length >= league.teams.length) return s;
  league.scoutFx = { year, off, teams: league.teams.map(emptyTeam) };
  return league.scoutFx;
}

/** 지금 시기의 상태 (없으면 null, 만들지 않는다) */
export function fxCurrent(league: LeagueState): ScoutFxState | null {
  return league.scoutFx ?? null;
}

/** 파견 후보인 선수인가 (관찰 명단으로만 보이는 가상 외국인) */
export const isFxCandidate = (p: Pick<LeaguePlayer, 'fx'>): boolean => !!p.fx;

/** 그 구단 관찰 명단의 칸 (없으면 null) */
export function fxEntry(league: LeagueState, team: number, id: string): FxEntry | null {
  return league.scoutFx?.teams[team]?.list.find((e) => e.id === id) ?? null;
}

/** 그 구단이 이 선수를 보고 계약할 수 있는가: 파견 후보는 관찰 명단에 있어야 한다 */
export function fxVisible(league: LeagueState, team: number, p: Pick<LeaguePlayer, 'id' | 'fx'>): boolean {
  return !p.fx || !!fxEntry(league, team, p.id);
}

/** 후보 지역별 생성 규칙 (임시값): 나이, 투수 몫, 선발 몫, 지금 능력(런), 투구 모양(제구형) */
export interface FxSpec { age: number; isPitcher: boolean; starter: boolean; runs: number; asia: boolean; control?: boolean }

/**
 * 지역 후보 하나의 모양. season이면 시즌 중 후보(개막 전 시장보다 한 단계 아래).
 * 일반 외국인 능력은 예전 한꺼번에 만들던 후보(일반 20~46런, 시즌 중 16~38런)와 평균이 같게, 지역마다 폭·나이만 다르게
 */
export function fxSpec(rng: Rng, region: FxRegion, asia: boolean, season: boolean): FxSpec {
  const down = season ? 4 : 0;
  if (asia) {
    const wide = region === 'pacific';
    const isPitcher = rng.chance(region === 'japan' ? 0.7 : 0.6);
    return {
      age: 22 + rng.int(wide ? 8 : 9), isPitcher, starter: isPitcher && rng.chance(0.5), asia,
      runs: (season ? 2 : 4) + (wide ? rng.range(-6, 16) : rng.range(-4, 12)), control: region === 'japan' && isPitcher,
    };
  }
  switch (region) {
    case 'na': {
      const isPitcher = rng.chance(0.6);
      return { age: 26 + rng.int(8), isPitcher, starter: isPitcher && rng.chance(0.75), asia, runs: 30 - down + rng.range(-10, 16) };
    }
    case 'latam': {
      const isPitcher = rng.chance(0.5);
      return { age: 23 + rng.int(8), isPitcher, starter: isPitcher && rng.chance(0.55), asia, runs: 29 - down + rng.range(-15, 22) };
    }
    case 'japan': {
      const isPitcher = rng.chance(0.7);
      return { age: 27 + rng.int(7), isPitcher, starter: isPitcher && rng.chance(0.6), asia, runs: 30 - down + rng.range(-8, 12), control: isPitcher };
    }
    case 'pacific': {
      const isPitcher = rng.chance(0.55);
      return { age: 24 + rng.int(8), isPitcher, starter: isPitcher && rng.chance(0.5), asia, runs: 26 - down + rng.range(-14, 20) };
    }
  }
}

/** 지역별 후보 수 (임시값). asia = 아시아쿼터 제도가 있는 해. 일본은 반은 아시아쿼터, 대만·호주는 모두 아시아쿼터 (없는 해는 일반) */
export function fxPoolPlan(asia: boolean, season: boolean): { region: FxRegion; asia: boolean }[] {
  const n = season ? { na: 6, latam: 5, japan: 4, pacific: 3 } : { na: 10, latam: 8, japan: 6, pacific: 6 };
  const out: { region: FxRegion; asia: boolean }[] = [];
  for (let i = 0; i < n.na; i++) out.push({ region: 'na', asia: false });
  for (let i = 0; i < n.latam; i++) out.push({ region: 'latam', asia: false });
  for (let i = 0; i < n.japan; i++) out.push({ region: 'japan', asia: asia && i % 2 === 1 });
  for (let i = 0; i < n.pacific; i++) out.push({ region: 'pacific', asia });
  return out;
}

/** 시즌 중 후보가 시장에 머무는 주: 마감 주 전에 나와 8~20주 머문다 */
export function fxSeasonWindow(rng: Rng, region: FxRegion, lastWeek: number): FxWindow {
  const from = rng.int(Math.max(1, lastWeek - 3));
  return { region, from, until: from + FX_STAY_MIN + rng.int(FX_STAY_SPAN + 1) };
}

// ---- 발견

export interface FxCtx {
  league: LeagueState;
  year: number;
  /** 그 후보가 아직 어느 구단과도 계약하지 않았나 */
  free: (id: string) => boolean;
  /** 플레이어 구단 (-1이면 없음) */
  userTeam: number;
}

function candidates(ctx: FxCtx, region: FxRegion | null, week: number): LeaguePlayer[] {
  return ctx.league.players.filter((p) => p.fx && (region === null || p.fx.region === region)
    && p.fx.from <= week && week < p.fx.until && ctx.free(p.id));
}

/** 명단에 후보를 붙인다. 찼으면 플레이어 구단은 기다림 칸으로, AI 구단은 가장 오래된 후보를 뺀다 */
function attach(ctx: FxCtx, team: number, e: FxEntry, news: FxNews[]): void {
  const t = ctx.league.scoutFx!.teams[team];
  const name = ctx.league.players.find((p) => p.id === e.id)!.name;
  if (t.list.length < FX_LIST_MAX) {
    t.list.push(e);
    news.push({ team, text: `${e.agent ? '에이전트 추천' : '스카우트 보고'}: 외국인 후보 ${name}${josa(name, '을를')} 관찰 명단에 올렸습니다.` });
    return;
  }
  if (team === ctx.userTeam) {
    if (t.wait) news.push({ team, text: `관찰 명단이 차 있어 기다리던 후보 ${nameOf(ctx.league, t.wait.id)}${josa(nameOf(ctx.league, t.wait.id), '을를')} 놓쳤습니다.` });
    t.wait = e;
    news.push({ team, text: `관찰 명단(${FX_LIST_MAX}명)이 찼습니다. 새 후보 ${name}${josa(name, '은는')} 명단에서 한 명을 빼면 들어옵니다.` });
    return;
  }
  t.list.shift();
  t.list.push(e);
}

/** 한 지역에서 한 명을 찾는다 (명단·기다림에 없는 후보 가운데 고르게). 없으면 null */
function findOne(ctx: FxCtx, team: number, region: FxRegion | null, week: number, rng: Rng): string | null {
  const t = ctx.league.scoutFx!.teams[team];
  const known = new Set([...t.list.map((e) => e.id), ...(t.wait ? [t.wait.id] : [])]);
  const pool = candidates(ctx, region, week).filter((p) => !known.has(p.id));
  return pool.length ? pool[rng.int(pool.length)].id : null;
}

/** 파견 중인 지역의 한 주: 관찰 주를 더하고 확률로 후보를 찾는다 */
function dispatchWeek(ctx: FxCtx, team: number, d: FxDispatch, week: number, key: string, news: FxNews[]): void {
  const t = ctx.league.scoutFx!.teams[team];
  for (const e of t.list) if (ctx.league.players.find((p) => p.id === e.id)?.fx?.region === d.region) e.weeks++;
  const rng = new Rng(`${ctx.league.seed}/scout-fx/${team}/${ctx.year}/${key}/${d.region}`);
  if (!rng.chance(FX_FIND_WEEK)) return;
  const id = findOne(ctx, team, d.region, week, rng);
  if (id) attach(ctx, team, { id, at: week, weeks: 0 }, news);
}

/** 에이전트 추천 한 명 */
function agentPick(ctx: FxCtx, team: number, week: number, key: string, news: FxNews[]): void {
  const rng = new Rng(`${ctx.league.seed}/scout-fx/${team}/${ctx.year}/${key}/agent`);
  const id = findOne(ctx, team, null, week, rng);
  if (id) attach(ctx, team, { id, at: week, weeks: 0, agent: true }, news);
}

/** 계약했거나 떠난 후보를 명단에서 뺀다. signedBy: 계약한 구단 이름 (없으면 떠남) */
function sweep(ctx: FxCtx, week: number, signedBy: (id: string) => string | null, news: FxNews[]): void {
  const s = ctx.league.scoutFx!;
  const byId = new Map(ctx.league.players.map((p) => [p.id, p]));
  s.teams.forEach((t, team) => {
    const gone = (e: FxEntry): boolean => {
      const p = byId.get(e.id);
      if (!p) return true;
      if (!ctx.free(e.id)) {
        const by = signedBy(e.id);
        if (by && by !== ctx.league.teams[team]?.name && p.fx) news.push({ team, text: `관찰하던 외국인 후보 ${p.name}: ${by}${josa(by, '와과')} 계약해 명단에서 빠졌습니다.` });
        return true;
      }
      if (!p.fx) return true;
      if (week >= p.fx.until) {
        news.push({ team, text: `관찰하던 외국인 후보 ${p.name}: 다른 리그와 계약해 명단에서 빠졌습니다.` });
        return true;
      }
      return false;
    };
    t.list = t.list.filter((e) => !gone(e));
    if (t.wait && gone(t.wait)) delete t.wait;
    if (t.wait && t.list.length < FX_LIST_MAX) { t.list.push(t.wait); delete t.wait; }
  });
}

/**
 * 시즌 중 한 주가 끝날 때 (week = 개막부터 센 주, 0부터): 계약·떠난 후보 정리 → 파견마다 한 주 → 4주마다 에이전트 추천.
 * 끝난 파견은 빠진다. 소식을 돌려준다 (구단별, 화면은 플레이어 구단 것만)
 */
export function fxWeek(ctx: FxCtx, week: number, signedBy: (id: string) => string | null): FxNews[] {
  const s = fxState(ctx.league, ctx.year, false);
  const news: FxNews[] = [];
  sweep(ctx, week, signedBy, news);
  s.teams.forEach((t, team) => {
    for (const d of t.out) {
      dispatchWeek(ctx, team, d, week, String(week), news);
      d.left--;
      if (d.left <= 0) news.push({ team, text: `${regionName(d.region)} 스카우트 팀이 파견을 마치고 돌아왔습니다.` });
    }
    t.out = t.out.filter((d) => d.left > 0);
    if (week % FX_AGENT_EVERY === FX_AGENT_EVERY - 1) agentPick(ctx, team, week, String(week), news);
  });
  return news;
}

/** 파견할 수 없는 이유 (없으면 null) */
export function fxSendBlock(league: LeagueState, team: number, region: FxRegion, o: { off: boolean; asiaRule: boolean; open: boolean }): string | null {
  if (!o.open) return o.off ? '오프시즌 파견은 외국인 단계에서만 할 수 있습니다.' : '외국인 교체 마감이 지나 파견할 수 없습니다.';
  if (!FX_REGIONS.some((r) => r.id === region)) return '없는 지역입니다.';
  const s = league.scoutFx;
  const t = s?.teams[team];
  if (o.off) {
    if (t && t.sent >= FX_OFF_SENDS) return `이번 오프시즌 파견(${FX_OFF_SENDS}번)을 모두 썼습니다.`;
  } else if (t && t.out.length >= FX_MAX_OUT) return `스카우트 팀 ${FX_MAX_OUT}팀이 모두 나가 있습니다.`;
  return null;
}

/** 파견 비용을 장부에 남긴다 */
function payFx(league: LeagueState, team: number, region: FxRegion, year: number): void {
  league.ledger.push({ year, from: team, to: -1, amount: FX_COST, note: `외국인 스카우트 파견 (${regionName(region)})`, kind: 'scouting' });
}

/** 시즌 중 파견: 4주 동안 주마다 굴린다 (fxWeek) */
export function fxSendSeason(ctx: FxCtx, team: number, region: FxRegion): void {
  const t = fxState(ctx.league, ctx.year, false).teams[team];
  t.out.push({ region, left: FX_WEEKS });
  t.sent++;
  payFx(ctx.league, team, region, ctx.year);
}

/** 오프시즌 파견: 4주를 바로 굴린다. 장부는 다음 시즌 해 (ctx.year = 다음 시즌) */
export function fxSendOff(ctx: FxCtx, team: number, region: FxRegion): FxNews[] {
  const t = fxState(ctx.league, ctx.year, true).teams[team];
  const news: FxNews[] = [];
  const n = t.sent++;
  const d = { region, left: FX_WEEKS };
  for (let k = 0; k < FX_WEEKS; k++) dispatchWeek(ctx, team, d, 0, `off${n}-${k}`, news);
  payFx(ctx.league, team, region, ctx.year);
  return news;
}

/** 오프시즌 외국인 단계를 열 때: 모든 구단에 에이전트 추천 (두 달) */
export function fxOpenOff(ctx: FxCtx): FxNews[] {
  const s = fxState(ctx.league, ctx.year, true);
  const news: FxNews[] = [];
  s.teams.forEach((_, team) => {
    for (let k = 0; k < FX_AGENT_OFF; k++) agentPick(ctx, team, 0, `off-agent${k}`, news);
  });
  return news;
}

/** 관찰 명단에서 뺀다 (기다리는 후보가 있으면 들어온다) */
export function fxDrop(league: LeagueState, team: number, id: string): boolean {
  const t = league.scoutFx?.teams[team];
  if (!t) return false;
  if (t.wait?.id === id) { delete t.wait; return true; }
  const before = t.list.length;
  t.list = t.list.filter((e) => e.id !== id);
  if (t.list.length === before) return false;
  if (t.wait) { t.list.push(t.wait); delete t.wait; }
  return true;
}

/** 계약한 후보를 모든 명단에서 뺀다 (오프시즌, 계약 때 바로). 플레이어 구단 명단에서 빠지면 소식 */
export function fxSigned(league: LeagueState, id: string, team: number): FxNews[] {
  const s = league.scoutFx;
  if (!s) return [];
  const news: FxNews[] = [];
  const name = league.players.find((p) => p.id === id)?.name ?? '';
  s.teams.forEach((t, i) => {
    const had = t.list.some((e) => e.id === id) || t.wait?.id === id;
    t.list = t.list.filter((e) => e.id !== id);
    if (t.wait?.id === id) delete t.wait;
    if (t.wait && t.list.length < FX_LIST_MAX) { t.list.push(t.wait); delete t.wait; }
    if (had && i !== team) news.push({ team: i, text: `관찰하던 외국인 후보 ${name}: ${league.teams[team].name}${josa(league.teams[team].name, '와과')} 계약해 명단에서 빠졌습니다.` });
  });
  return news;
}

// ---- AI 구단

/** AI 구단이 보낼 지역: 아시아쿼터가 필요하면 일본·대만호주, 아니면 북미·중남미·북미·일본 차례 (보낸 수로 돌림, 결정적) */
export function aiFxRegion(n: number, needAsia: boolean): FxRegion {
  if (needAsia) return n % 2 === 0 ? 'japan' : 'pacific';
  return (['na', 'latam', 'na', 'japan'] as const)[n % 4];
}

/** 명단에서 그 구분(아시아쿼터 여부)의 후보 수 */
export function fxListCount(league: LeagueState, team: number, asia: boolean): number {
  const byId = new Map(league.players.map((p) => [p.id, p]));
  return (league.scoutFx?.teams[team]?.list ?? []).filter((e) => !!byId.get(e.id)?.asia === asia).length;
}
