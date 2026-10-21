// 구장과 팬덤 (docs/roadmap.md C1·C2, 2026-10-12 사용자: "도움말 빼고 다 해").
//
// 구장: 구단마다 수용 인원과 시설 수준(0~100). 시설은 해마다 조금씩 낡고, 오프시즌에 리모델링이나 신구장 건설을 주문할 수 있다.
//   공사비(구단 부담분)는 공사 기간 동안 결산 때 나눠 낸다. 리모델링 시즌에는 홈 관중석 일부를 못 쓴다.
//   시설은 관중률과 객단가를, 신구장은 첫 몇 해 관중률을 더 올린다. 시대별 실제 구장 변화는 다루지 않는다 (시작 때 BALLPARK).
// 팬덤: 구단마다 팬 만족도(0~100). 성적·가을야구·우승이 올리고, 프랜차이즈 스타를 트레이드·FA로 잃으면 떨어진다.
//   만족도는 관중률과 스폰서 수입을 움직인다. 시즌 중 변화는 날짜와 함께 남겨, 하루씩 진행하든 한 번에 진행하든 관중 수입이 같다.
// 수치는 모두 임시값.

import { Rng } from '../engine';
import { realParkAt, realParkOpening } from './ballparks';
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
  /** 신구장 특성: 홈런 배율, 돔 (2026-10-14) */
  hr?: number;
  dome?: boolean;
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
  /**
   * 구장 특성 (2026-10-14): 홈런 배율과 돔. 게임 안에서 지은 신구장만 1이 아니다.
   * 원래 있던 실제 구장의 효과는 득점 계수(parkRunFactor, meta.parkFactors)로 따로 넣고, 능력 산출이 그만큼 기록에서 걷어 낸다 (2026-10-22)
   */
  hr?: number;
  dome?: boolean;
  /** 구장 이름 (실제 구장 역사 ballparks.ts, 게임 안에서 지은 구장은 '새 구장') */
  name?: string;
  /** 실제 구장 자료가 확인되지 않은 값인가 (화면에 '확인 필요') */
  unchecked?: boolean;
  /** 명명권 계약 (naming.ts) */
  naming?: import('./naming').Naming;
}

/** 신구장 크기 (홈런 배율, 임시값). 작은 구장은 홈런이 늘고 큰 구장은 준다 */
export type ParkSize = 'hitter' | 'neutral' | 'pitcher';
export const PARK_SIZES: Record<ParkSize, { label: string; hr: number }> = {
  hitter: { label: '타자 친화 (작은 구장)', hr: 1.2 },
  neutral: { label: '중립', hr: 1 },
  pitcher: { label: '투수 친화 (큰 구장)', hr: 0.8 },
};
/** 돔: 공사비 배율, 관중률 가산 (날씨 걱정 없는 쾌적함, 임시값) */
export const DOME = { cost: 1.4, fill: 0.03 };

/**
 * 지자체 협상 (신구장, 2026-10-14): 표준 분담은 표의 구단 부담 그대로. 지원을 더 요구하면 성공할 때 구단 부담 ×SHARE,
 * 실패하면 협상이 길어져 착공이 한 시즌 늦어지고 팬 만족도가 조금 떨어진다. 성공 확률은 팬 만족도가 높을수록 (임시값)
 */
export const MUNICIPAL = { share: 0.7, base: 0.45, perFan: 0.004, min: 0.15, max: 0.8, fanLoss: -2 };
export type StadiumDeal = 'standard' | 'push';

export function municipalChance(league: Pick<LeagueState, 'fans'>, team: number, year: number): number {
  const fans = fanLevel(league, team, year);
  return Math.max(MUNICIPAL.min, Math.min(MUNICIPAL.max, MUNICIPAL.base + (fans - 50) * MUNICIPAL.perFan));
}

/** AI 신구장: 시설이 이 아래이고 구장이 AI_NEW_AGE년 넘게 됐고 자금이 공사비의 1.5배 이상이면 (임시값) */
export const AI_NEW_BELOW = 35;
export const AI_NEW_AGE = 25;

/** 경기에 쓰는 구장 특성 (world.ts SimTeam.park) */
/**
 * 실제 홈 구장의 득점 계수 (meta.parkFactors, 하드힛 파크팩터 2015~). 1 = 중립.
 * - 게임 안에서 지은 신구장(done에 'new')은 1: 크기별 홈런 배율(hr)만 쓴다.
 * - 자료가 있는 해는 그 값. 자료 뒤 해는 같은 실제 구장을 쓰는 동안 자료 마지막 해 값을 이어 쓰고, 실제 새 구장으로 옮겼으면 1 (임시값).
 * - 2015년 이전은 자료가 없어 1.
 */
export function parkRunFactor(parkFactors: Record<string, Record<string, number>> | undefined, franchise: string, year: number,
                              s: StadiumState | undefined): number {
  if (!parkFactors || (s?.done ?? []).some((d) => d.kind === 'new')) return 1;
  const known = parkFactors[String(year)];
  if (known) return known[franchise] ?? 1;
  const last = Math.max(...Object.keys(parkFactors).map(Number));
  if (year < last) return 1;
  const moved = (realParkAt(franchise, year)?.from ?? 0) > last;
  return moved ? 1 : (parkFactors[String(last)][franchise] ?? 1);
}

export function parkFactor(s: StadiumState | undefined): { hr: number; dome: boolean } {
  return { hr: s?.hr ?? 1, dome: !!s?.dome };
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
  for (let t = 0; t < league.teams.length; t++) {
    // 실제 구장 이름만 (수용 인원·시설·돔 관중 가산은 관중 모델이 맞춰 둔 값 그대로, ballparks.ts). 예전 저장에도 이름을 붙인다
    const real = realParkAt(league.teams[t].franchise, league.year);
    const named = real ? { name: real.name, ...(real.checked ? {} : { unchecked: true }) } : {};
    const cur = league.stadiums[t];
    if (!cur) league.stadiums[t] = { capacity: capacity(t), quality: QUALITY_START, ...named };
    else if (cur.name === undefined && cur.opened === undefined) Object.assign(cur, named);
  }
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
  return ((s.quality - 50) / 50) * QUALITY_FILL + honey + (s.dome ? DOME.fill : 0);
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
function startProject(league: LeagueState, team: number, offYear: number, kind: 'remodel' | 'new', years: number, cost: number, capacity: number,
                      park?: { hr: number; dome: boolean }, delay = 0): void {
  league.stadiums![team].project = { kind, start: offYear + 1 + delay, open: offYear + 1 + delay + years, cost, capacity, ...(park ? { hr: park.hr, ...(park.dome ? { dome: true } : {}) } : {}) };
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
export function orderStadium(league: LeagueState, team: number, offYear: number, id: string, cash: number,
                             park: { size?: ParkSize; dome?: boolean; deal?: StadiumDeal } = {}): { ok: boolean; message: string } {
  const s = league.stadiums?.[team];
  const opt = stadiumOptions().find((o) => o.id === id);
  if (!s || !opt) return { ok: false, message: '없는 공사입니다.' };
  if (s.project && s.project.open > offYear + 1) return { ok: false, message: '이미 공사가 잡혀 있습니다.' };
  if (park.size !== undefined && !PARK_SIZES[park.size]) return { ok: false, message: '없는 구장 크기입니다.' };
  const isNew = opt.kind === 'new';
  const dome = isNew && !!park.dome;
  let cost = Math.round(opt.cost * (dome ? DOME.cost : 1));
  if (cash < downPayment(cost)) return { ok: false, message: `자금이 모자랍니다. 착공금 ${(downPayment(cost) / 10000).toFixed(0)}억 원은 있어야 합니다.` };
  // 지자체 협상 (신구장만): 난수는 리그 시드·연도·구단으로 (재현·불러오기와 같다)
  let delay = 0;
  let dealNote = '';
  if (isNew && park.deal === 'push') {
    const chance = municipalChance(league, team, offYear);
    if (new Rng(`${league.seed}/municipal/${offYear}/${team}`).chance(chance)) {
      cost = Math.round(cost * MUNICIPAL.share);
      dealNote = ` 지자체 협상 성공: 구단 부담이 ${Math.round((1 - MUNICIPAL.share) * 100)}% 줄었습니다.`;
    } else {
      delay = 1;
      addFanEvent(league, team, offYear, -2, MUNICIPAL.fanLoss, '신구장 비용 분담 갈등');
      dealNote = ' 지자체 협상 결렬: 협상이 길어져 착공이 한 시즌 늦어지고, 팬들의 실망이 큽니다.';
    }
  }
  const down = downPayment(cost);
  const size = park.size ?? 'neutral';
  startProject(league, team, offYear, opt.kind, opt.years, cost, opt.capacity(s.capacity), isNew ? { hr: PARK_SIZES[size].hr, dome } : undefined, delay);
  const eok = (v: number) => `${(v / 10000).toFixed(0)}억 원`;
  const kind = isNew ? ` (${PARK_SIZES[size].label}${dome ? ', 돔' : ''})` : '';
  const start = offYear + 1 + delay;
  return { ok: true, message: `${opt.label}${kind} 주문: ${start}~${start + opt.years - 1} 시즌 공사, ${start + opt.years} 시즌 개장. 구단 부담 ${eok(cost)} (착공금 ${eok(down)} 지금, 나머지는 공사 기간 결산 때 해마다 ${eok(yearlyPayment(cost, opt.years))}).${dealNote}` };
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
        s.hr = p.hr ?? 1;
        if (p.dome) s.dome = true; else delete s.dome;
        s.name = `${league.teams[t].name} 새 구장`;
        delete s.unchecked;
      } else {
        s.capacity = p.capacity;
        s.quality = Math.min(90, s.quality + REMODEL.quality);
      }
      (s.done ??= []).push({ kind: p.kind, open: p.open, cost: p.cost });
      delete s.project;
      out.push(`${league.teams[t].name} ${p.kind === 'new' ? '신구장' : '리모델링한 구장'} ${year + 1} 시즌 개장 (${s.capacity.toLocaleString()}석)`);
    }
    // 실제 구장 역사: 다음 시즌에 실제로 새 구장으로 옮긴 구단 (게임 안에서 공사를 잡았거나 지은 구단은 빼고)
    const real = realParkOpening(league.teams[t].franchise, year + 1);
    if (real && !s.project && !(s.done ?? []).some((d) => d.kind === 'new')) {
      s.capacity = real.capacity;
      s.quality = NEW_PARK.quality;
      s.opened = year + 1;
      s.name = real.name;
      if (real.dome) s.dome = true; else delete s.dome;
      if (real.checked) delete s.unchecked; else s.unchecked = true;
      out.push(`${league.teams[t].name}, ${year + 1} 시즌부터 ${real.name}${real.planned ? ' (실제 계획)' : ''} 사용 (${real.capacity.toLocaleString()}석${real.dome ? ', 돔' : ''})`);
    }
    // AI 신구장: 오래되고 낡은 구장, 자금이 넉넉하면 (지자체 표준 분담, 중립 구장. 연고 시장이 크면 큰 구장)
    const age = year + 1 - (s.opened ?? realParkAt(league.teams[t].franchise, year)?.from ?? league.startYear);
    const bigMarket = (league.fans?.[t]?.level ?? 50) >= 60;
    const opt = NEW_PARK.options[bigMarket ? 1 : 0];
    if (t !== userTeam && !s.project && s.quality < AI_NEW_BELOW && age >= AI_NEW_AGE && cashOf(t) >= opt.cost * 1.5
        && !realParkOpening(league.teams[t].franchise, year + 1 + NEW_PARK.years)) {
      startProject(league, t, year, 'new', NEW_PARK.years, opt.cost, opt.capacity, { hr: 1, dome: false });
      out.push(`${league.teams[t].name}, 신구장 착공 (${year + 1 + NEW_PARK.years} 시즌 개장 예정, ${opt.capacity.toLocaleString()}석)`);
      continue;
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
