// 구장과 팬덤 (docs/roadmap.md C1·C2, 2026-10-12 사용자: "도움말 빼고 다 해").
//
// 구장: 구단마다 수용 인원과 시설 수준(0~100). 시설은 해마다 조금씩 낡고, 오프시즌에 리모델링이나 신구장 건설을 주문할 수 있다.
//   공사비(구단 부담분)는 공사 기간 동안 결산 때 나눠 낸다. 리모델링 시즌에는 홈 관중석 일부를 못 쓴다.
//   시설은 관중률과 객단가를, 신구장은 첫 몇 해 관중률을 더 올린다. 시대별 실제 구장 변화는 다루지 않는다 (시작 때 BALLPARK).
// 팬덤: 구단마다 팬 만족도(0~100). 성적·가을야구·우승이 올리고, 프랜차이즈 스타를 트레이드·FA로 잃으면 떨어진다.
//   만족도는 관중률과 스폰서 수입을 움직인다. 시즌 중 변화는 날짜와 함께 남겨, 하루씩 진행하든 한 번에 진행하든 관중 수입이 같다.
// 수치는 모두 임시값.

import type { LeaguePlayer, LeagueState } from './types';

// ---- 구장

export interface StadiumProject {
  kind: 'remodel' | 'new';
  /** 공사하는 첫 시즌 */
  start: number;
  /** 완공 뒤 첫 시즌 */
  open: number;
  /** 구단 부담 총액 (만 원) */
  cost: number;
  /** 완공 뒤 수용 인원 */
  capacity: number;
}

export interface StadiumState {
  capacity: number;
  /** 시설 수준 0~100 (50이 보통) */
  quality: number;
  /** 지금 구장 개장 연도 (신구장을 지은 경우만) */
  opened?: number;
  project?: StadiumProject;
  /** 지난 공사 기록 */
  done?: { kind: 'remodel' | 'new'; open: number; cost: number }[];
}

/** 리모델링: 구단 부담 250억, 한 시즌 공사(그 시즌 관중석 20% 못 씀), 시설 +30, 좌석 +1,000 (임시값) */
export const REMODEL = { cost: 2_500_000, years: 1, quality: 30, capacity: 1_000, closed: 0.2 };
/**
 * 신구장: 지자체와 나눠 짓고 구단은 일부만 낸다. 세 시즌 공사(옛 구장을 그대로 쓴다), 시설 100 (임시값).
 * 실제 구단 부담 사례: NC 창원 100억, KIA 광주 300억, 한화 대전 486억 (공개 보도 기준 대략값)
 */
export const NEW_PARK = {
  years: 3,
  quality: 100,
  options: [{ capacity: 22_000, cost: 4_000_000 }, { capacity: 25_000, cost: 5_500_000 }],
};
/** 주문할 때 바로 내는 착공금 비율. 나머지는 공사 기간 결산 때 나눠 낸다 (임시값) */
export const DOWN_SHARE = 0.2;
/** 시설 시작값, 해마다 낡는 폭, 바닥 */
export const QUALITY_START = 50;
export const QUALITY_DECAY = 1;
export const QUALITY_MIN = 20;
/** 시설 50 대비 ±50일 때 관중률 ±, 객단가 ± 비율 */
export const QUALITY_FILL = 0.06;
export const QUALITY_TICKET = 0.15;
/** 신구장 개장 첫해·둘째 해·셋째 해 관중률 가산 (새 구장 효과) */
export const HONEYMOON = [0.08, 0.05, 0.03];
/** AI 구단 리모델링: 시설이 이 아래이고 자금이 공사비의 1.5배 이상이면 (임시값) */
export const AI_REMODEL_BELOW = 35;

/** 구장 상태가 없는 리그(새 게임, 예전 저장)에 채운다. capacity: 구단 계보의 기본 수용 인원 */
export function ensureStadiums(league: LeagueState, capacity: (team: number) => number): StadiumState[] {
  league.stadiums ??= [];
  for (let t = 0; t < league.teams.length; t++) league.stadiums[t] ??= { capacity: capacity(t), quality: QUALITY_START };
  return league.stadiums;
}

/** 공사 중인 시즌인가 */
export function underConstruction(s: StadiumState | undefined, year: number): boolean {
  return !!s?.project && year >= s.project.start && year < s.project.open;
}

/** 그 시즌 홈 경기에 쓸 수 있는 좌석 (리모델링 시즌은 일부 막는다) */
export function seatsAt(s: StadiumState, year: number): number {
  return s.project?.kind === 'remodel' && underConstruction(s, year) ? Math.round(s.capacity * (1 - REMODEL.closed)) : s.capacity;
}

/** 시설·새 구장 효과로 더하는 관중률 */
export function stadiumFill(s: StadiumState | undefined, year: number): number {
  if (!s) return 0;
  const honey = s.opened !== undefined ? HONEYMOON[year - s.opened] ?? 0 : 0;
  return ((s.quality - 50) / 50) * QUALITY_FILL + honey;
}

/** 시설에 따른 객단가 배율 */
export function ticketScale(s: StadiumState | undefined): number {
  return s ? 1 + ((s.quality - 50) / 50) * QUALITY_TICKET : 1;
}

export const downPayment = (cost: number) => Math.round(cost * DOWN_SHARE);
/** 공사 기간 해마다 결산 때 내는 할부 (만 원, 양수) */
export const yearlyPayment = (cost: number, years: number) => Math.round((cost - downPayment(cost)) / years);

/** 그 시즌(결산) 공사비 할부 (만 원, 양수) */
export function installment(s: StadiumState | undefined, year: number): number {
  if (!s?.project || !underConstruction(s, year)) return 0;
  return yearlyPayment(s.project.cost, s.project.open - s.project.start);
}

/** 공사를 잡고 착공금을 장부에 적는다 (다음 시즌 장부) */
function startProject(league: LeagueState, team: number, offYear: number, kind: 'remodel' | 'new', years: number, cost: number, capacity: number): void {
  league.stadiums![team].project = { kind, start: offYear + 1, open: offYear + 1 + years, cost, capacity };
  league.ledger.push({ year: offYear + 1, from: team, to: -1, amount: downPayment(cost), note: `${league.teams[team].name} 구장 ${kind === 'new' ? '신축' : '리모델링'} 착공금`, kind: 'stadium' });
}

/** 고를 수 있는 공사 (화면·주문 검사) */
export function stadiumOptions(): { id: string; kind: 'remodel' | 'new'; label: string; cost: number; years: number; capacity: (now: number) => number }[] {
  return [
    { id: 'remodel', kind: 'remodel', label: '리모델링', cost: REMODEL.cost, years: REMODEL.years, capacity: (now) => now + REMODEL.capacity },
    ...NEW_PARK.options.map((o, i) => ({
      id: `new-${i}`, kind: 'new' as const, label: `신구장 ${o.capacity.toLocaleString()}석`, cost: o.cost, years: NEW_PARK.years, capacity: () => o.capacity,
    })),
  ];
}

/**
 * 공사를 주문한다 (오프시즌, offYear 시즌이 끝난 뒤). 다음 시즌부터 공사한다. 착공금을 바로 낸다.
 * cash: 지금 자금. 착공금만큼은 있어야 한다
 */
export function orderStadium(league: LeagueState, team: number, offYear: number, id: string, cash: number): { ok: boolean; message: string } {
  const s = league.stadiums?.[team];
  const opt = stadiumOptions().find((o) => o.id === id);
  if (!s || !opt) return { ok: false, message: '없는 공사입니다.' };
  if (s.project && s.project.open > offYear + 1) return { ok: false, message: '이미 공사가 잡혀 있습니다.' };
  const down = downPayment(opt.cost);
  if (cash < down) return { ok: false, message: `자금이 모자랍니다. 착공금 ${(down / 10000).toFixed(0)}억 원은 있어야 합니다.` };
  startProject(league, team, offYear, opt.kind, opt.years, opt.cost, opt.capacity(s.capacity));
  const eok = (v: number) => `${(v / 10000).toFixed(0)}억 원`;
  return { ok: true, message: `${opt.label} 주문: ${offYear + 1}~${offYear + opt.years} 시즌 공사, ${offYear + 1 + opt.years} 시즌 개장. 구단 부담 ${eok(opt.cost)} (착공금 ${eok(down)} 지금, 나머지는 해마다 결산 때 ${eok(yearlyPayment(opt.cost, opt.years))})` };
}

/**
 * 결산 뒤 구장 정리 (finance.ts settleSeason): 시설이 낡고, 다음 시즌에 끝나는 공사는 완공한다.
 * AI 구단은 시설이 많이 낡고 자금이 넉넉하면 리모델링한다. 바뀐 일을 문장으로 돌려준다
 */
export function stadiumYearEnd(league: LeagueState, year: number, cashOf: (team: number) => number, userTeam: number): string[] {
  const out: string[] = [];
  for (let t = 0; t < (league.stadiums?.length ?? 0); t++) {
    const s = league.stadiums![t];
    s.quality = Math.max(QUALITY_MIN, s.quality - QUALITY_DECAY);
    const p = s.project;
    if (p && p.open === year + 1) {
      if (p.kind === 'new') {
        s.capacity = p.capacity;
        s.quality = NEW_PARK.quality;
        s.opened = year + 1;
      } else {
        s.capacity = p.capacity;
        s.quality = Math.min(90, s.quality + REMODEL.quality);
      }
      (s.done ??= []).push({ kind: p.kind, open: p.open, cost: p.cost });
      delete s.project;
      out.push(`${league.teams[t].name} ${p.kind === 'new' ? '신구장' : '리모델링한 구장'} ${year + 1} 시즌 개장 (${s.capacity.toLocaleString()}석)`);
    }
    if (t !== userTeam && !s.project && s.quality < AI_REMODEL_BELOW && cashOf(t) >= REMODEL.cost * 1.5) {
      startProject(league, t, year, 'remodel', REMODEL.years, REMODEL.cost, s.capacity + REMODEL.capacity);
      out.push(`${league.teams[t].name}, ${year + 1} 시즌 구장 리모델링`);
    }
  }
  return out;
}

// ---- 팬덤

export interface FanEvent {
  year: number;
  /** 시즌 중이면 일정 색인, 결산은 −1, 오프시즌은 −2 */
  day: number;
  delta: number;
  reason: string;
}

export interface FanState {
  /** 시즌 시작(지난 결산·오프시즌 반영) 때 만족도 */
  level: number;
  log: FanEvent[];
}

/** 프랜차이즈 스타: 그 구단에서 FRANCHISE_SEASONS시즌 이상 뛰었고 지금 한 시즌 FRANCHISE_RUNS런 이상 (임시값) */
export const FRANCHISE_SEASONS = 5;
export const FRANCHISE_RUNS = 15;
/** 프랜차이즈 스타를 잃을 때·붙잡을 때 만족도 변화 (임시값) */
export const FAN_LOSS = { trade: -8, fa: -6, release: -5 };
export const FAN_KEEP = 2;
/** 결산: 승률 .500 대비 1푼당 0.6, 가을야구 시리즈 승리마다 +3, 진출 +2, 우승 +5, 연고 기본값으로 10%씩 돌아간다 (임시값) */
export const FAN_WIN = 60;
export const FAN_PS = 3;
export const FAN_PS_IN = 2;
export const FAN_TITLE = 5;
export const FAN_REVERT = 0.1;
/** 만족도 50 대비 ±50일 때 관중률 ±, 스폰서 ± 비율 */
export const FAN_FILL = 0.08;
export const FAN_SPONSOR = 0.1;
/** 한 구단 기록은 최근 이만큼만 남긴다 (저장 크기) */
const FAN_LOG_KEEP = 40;

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** 연고 시장으로 정하는 기본 만족도 (서울·부산 높고 신생 구단 낮게) */
export function fanBase(market: number): number {
  return Math.round(clamp(50 + market * 250));
}

export function ensureFans(league: LeagueState, market: (team: number) => number): FanState[] {
  league.fans ??= [];
  for (let t = 0; t < league.teams.length; t++) league.fans[t] ??= { level: fanBase(market(t)), log: [] };
  return league.fans;
}

/** 그날(day) 만족도: 시즌 시작 값 + 그 시즌 그날까지의 변화. day를 빼면 지금까지 전부 */
export function fanLevel(league: Pick<LeagueState, 'fans'>, team: number, year: number, day = Number.MAX_SAFE_INTEGER): number {
  const f = league.fans?.[team];
  if (!f) return 50;
  let v = f.level;
  for (const e of f.log) if (e.year === year && e.day >= 0 && e.day <= day) v += e.delta;
  return clamp(v);
}

export const fanFill = (level: number) => ((level - 50) / 50) * FAN_FILL;
export const fanSponsor = (level: number) => 1 + ((level - 50) / 50) * FAN_SPONSOR;

/** 만족도 변화를 남긴다. 시즌 중(day ≥ 0)은 기록만, 결산·오프시즌은 시작 값에 바로 더한다 */
export function addFanEvent(league: LeagueState, team: number, year: number, day: number, delta: number, reason: string): void {
  const f = league.fans?.[team];
  if (!f || !delta) return;
  if (day < 0) f.level = clamp(f.level + delta);
  f.log.push({ year, day, delta: Math.round(delta * 10) / 10, reason });
  if (f.log.length > FAN_LOG_KEEP) f.log.splice(0, f.log.length - FAN_LOG_KEEP);
}

/** 그 구단에서 뛴 시즌 수: 게임 안 기록(구단 이름이 지금 이름과 같은 해) + 게임 시작 전 실제 기록(같은 계보) */
export function seasonsWith(p: LeaguePlayer, league: Pick<LeagueState, 'teams'>, team: number): number {
  const t = league.teams[team];
  return p.history.filter((h) => h.team === t.name).length + (p.tenure0?.franchise === t.franchise ? p.tenure0.seasons : 0);
}

export function isFranchiseStar(p: LeaguePlayer, league: Pick<LeagueState, 'teams'>, team: number, runs: number): boolean {
  return runs >= FRANCHISE_RUNS && seasonsWith(p, league, team) >= FRANCHISE_SEASONS;
}

/** 프랜차이즈 스타가 떠난다 (트레이드·FA·방출) */
export function starLeaves(league: LeagueState, team: number, year: number, day: number, p: LeaguePlayer, runs: number, how: keyof typeof FAN_LOSS): boolean {
  if (!isFranchiseStar(p, league, team, runs)) return false;
  const label = how === 'trade' ? '트레이드' : how === 'fa' ? 'FA 이적' : '방출';
  addFanEvent(league, team, year, day, FAN_LOSS[how], `프랜차이즈 스타 ${p.name} ${label}`);
  return true;
}

/** 프랜차이즈 스타를 FA에서 붙잡았다 */
export function starStays(league: LeagueState, team: number, year: number, p: LeaguePlayer, runs: number): void {
  if (isFranchiseStar(p, league, team, runs)) addFanEvent(league, team, year, -2, FAN_KEEP, `프랜차이즈 스타 ${p.name} FA 잔류`);
}

/**
 * 결산 때 만족도 (finance.ts settleSeason): 시즌 중 변화를 시작 값에 합치고, 성적·가을야구·우승을 더한 뒤 연고 기본값 쪽으로 조금 돌아간다.
 * depth: 가을야구 (0 못 감, 1 진출, 2부터 시리즈를 이길 때마다 +1)
 */
export function fansSeasonEnd(league: LeagueState, team: number, year: number, winPct: number, depth: number, champion: boolean, market: number): void {
  const f = league.fans?.[team];
  if (!f) return;
  f.level = fanLevel(league, team, year);
  // 시즌 중 변화는 이제 시작 값에 들어갔다: 기록은 결산 표시(−3)로 바꿔 다시 더해지지 않게 한다
  for (const e of f.log) if (e.year === year && e.day >= 0) e.day = -3;
  const parts: [number, string][] = [[(winPct - 0.5) * FAN_WIN, `${year} 시즌 성적`]];
  if (depth >= 1) parts.push([FAN_PS_IN + FAN_PS * (depth - 1), `${year} 가을야구`]);
  if (champion) parts.push([FAN_TITLE, `${year} 우승`]);
  for (const [d, r] of parts) addFanEvent(league, team, year, -1, d, r);
  const base = fanBase(market);
  const back = (base - f.level) * FAN_REVERT;
  if (Math.abs(back) >= 0.1) addFanEvent(league, team, year, -1, back, '연고 기본값으로');
}
