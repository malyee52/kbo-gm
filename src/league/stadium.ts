// 구장과 팬덤 (docs/roadmap.md C1·C2, 2026-10-12 사용자: "도움말 빼고 다 해").
//
// 구장: 구단마다 수용 인원과 시설 수준(0~100). 시설은 해마다 조금씩 낡고, 오프시즌에 리모델링이나 신구장 건설을 주문할 수 있다.
//   공사비(구단 부담분)는 공사 기간 동안 결산 때 나눠 낸다. 리모델링 시즌에는 홈 관중석 일부를 못 쓴다.
//   시설은 관중률과 객단가를, 신구장은 첫 몇 해 관중률을 더 올린다. 시대별 실제 구장 변화는 다루지 않는다 (시작 때 BALLPARK).
// 팬덤: 구단마다 팬 만족도(0~100). 성적·가을야구·우승이 올리고, 프랜차이즈 스타를 트레이드·FA로 잃으면 떨어진다.
//   만족도는 관중률과 스폰서 수입을 움직인다. 시즌 중 변화는 날짜와 함께 남겨, 하루씩 진행하든 한 번에 진행하든 관중 수입이 같다.
// 수치는 모두 임시값.

import type { ParkEvents, ParkSpec } from '../data/types';
import {
  applyDiff, DEFAULT_PARAMS, fenceBaseOf, fenceOfRow, fenceParkEvents, fenceSpecOf, fenceValid, gameParkOf, guessLogs, historyWallAt, homeParkId,
  realParkNoOwn, realParkYear, Rng, type EngineParams, type Fence, type ParkLeagueRates, type ParkSource, type RealParkBasis, type SimTeam,
} from '../engine';
import { realParkAt, realParkOpening, realParkRename, realParkSpec } from './ballparks';
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
  /** 신구장 특성: 홈런 배율 (P6 전 주문만, 예전 저장), 돔 (2026-10-14) */
  hr?: number;
  dome?: boolean;
  /** 신구장 펜스 제원과 착공 때 계산한 사건별 배율 (구장효과 기획안 6.5, P6). 개장 때 StadiumState로 옮긴다 */
  fence?: Fence;
  park?: ParkEvents;
}

export interface StadiumWork {
  kind: 'remodel' | 'new' | 'fence' | 'wall' | 'wall-off';
  /** 공사가 끝나 쓰이기 시작한 시즌 */
  open: number;
  cost: number;
  fence?: Fence;
  park?: ParkEvents;
}

export interface StadiumState {
  capacity: number;
  /** 시설 수준 0~100 (50이 보통) */
  quality: number;
  /** 지금 구장 개장 연도 (신구장을 지은 경우만) */
  opened?: number;
  project?: StadiumProject;
  /**
   * 지난 공사 기록. 펜스 조정(fence)·가벽 설치(wall)·가벽 철거(wall-off)는 그 공사의 펜스와 배율도 남겨, 시즌마다 그 시즌에 쓰인 값을 찾는다
   * (구장효과 기획안 6.7.5·6.8.7). 신구장(new)도 펜스를 고른 것은 배율을 남긴다 (뒤에 펜스를 조정해도 개장 시즌 값이 남게)
   */
  done?: StadiumWork[];
  /**
   * 구장 특성 (2026-10-14): 홈런 배율과 돔. 게임 안에서 지은 신구장만 1이 아니다.
   * 원래 있던 실제 구장의 효과는 득점 계수(parkRunFactor, meta.parkFactors)로 따로 넣고, 능력 산출이 그만큼 기록에서 걷어 낸다 (2026-10-22)
   */
  hr?: number;
  dome?: boolean;
  /**
   * 게임 안에서 지은 신구장의 펜스 제원과 사건별 배율 (구장효과 기획안 6장, P6). 착공 때 한 번 계산해 저장한다
   * (회귀 계수·규칙이 바뀌어도 지은 구장의 효과는 그대로). 있으면 hr 대신 이것을 쓴다
   */
  fence?: Fence;
  park?: ParkEvents;
  /**
   * 펜스 조정 공사(6.7)를 한 실제 구장도 fence·park에 지금 펜스와 조정 뒤 배율을 둔다 (실제 구장은 조정 전에는 비어 있다 = 자료 제원).
   * fenceFrom = 새 펜스가 쓰인 첫 시즌 (펜스 조정·가벽 설치·제원 바꾸기·철거, 다음 공사까지 간격을 센다)
   */
  fenceFrom?: number;
  /** 서 있는 가벽 (함께 쓰는 구장, 6.8): 가벽 제원, 그 구단 홈 경기 배율, 첫 시즌. 원래 펜스(fence·자료 제원)와 따로 둔다 */
  wall?: { fence: Fence; park: ParkEvents; from: number };
  /** 구장 이름 (실제 구장 역사 ballparks.ts, 게임 안에서 지은 구장은 '새 구장') */
  name?: string;
  /** 실제 구장 자료가 확인되지 않은 값인가 (화면에 '확인 필요') */
  unchecked?: boolean;
  /** 명명권 계약 (naming.ts) */
  naming?: import('./naming').Naming;
}

/**
 * 신구장 펜스 예시값 셋 (구장효과 기획안 6.1, 임시값). 버튼을 누르면 칸이 채워진다. P6 전 조작 기록의 크기(size)도 이 제원으로 읽는다.
 * 높이는 0.1m 단위 정수 (30 = 3.0m). AI 신구장은 '중립'
 */
export type ParkSize = 'hitter' | 'neutral' | 'pitcher';
export const FENCE_PRESETS: Record<ParkSize, { label: string; fence: Fence }> = {
  hitter: { label: '타자 친화 (작은 구장)', fence: { l: 95, c: 120, r: 95, h: 25 } },
  neutral: { label: '중립', fence: { l: 98, c: 122, r: 98, h: 30 } },
  pitcher: { label: '투수 친화 (큰 구장)', fence: { l: 101, c: 125, r: 101, h: 35 } },
};

/** 펜스 제원 한 줄: "좌 96 · 중 121 · 우 99m, 높이 3m" */
export const fenceText = (f: Fence) => `좌 ${f.l} · 중 ${f.c} · 우 ${f.r}m, 높이 ${f.h / 10}m`;
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

/** 신구장 특성: 홈런 배율 (P6 전에 지은 신구장만, 펜스 제원이 있으면 1), 돔 */
export function parkFactor(s: StadiumState | undefined): { hr: number; dome: boolean } {
  return { hr: s?.park ? 1 : s?.hr ?? 1, dome: !!s?.dome };
}

/** 구장 화면에 보이는 근거: 실제 구장 값의 근거(park.ts) + 게임 안 신구장·펜스 조정·가벽, 중립 */
export type TeamParkBasis = RealParkBasis | 'built' | 'fence' | 'wall' | 'none';

/**
 * 그 해 그 구단 홈 구장의 경기 배율 (world.ts SimTeam.park, 구장 화면·세이버 보정이 같은 값을 읽는다).
 * 고르는 순서 (구장효과 기획안 6.8.4): 게임 안 가벽 → 펜스 조정 → 게임 안 신구장 → 실제 구장 값 (engine/park.ts: 2015~ 실측, 그 전은 차이 방식·짐작,
 * 마지막 실측 해 뒤는 실측 기간 평균·확정된 미래 구장 짐작, 해마다 평균 1) → 1. 게임 안 공사 값은 그 해 개막 전에 끝난 공사(done)에서 찾는다.
 * franchises·lg = 그 해 리그 구단 계보와 리그 비율 (옛 해 평균 1 맞춤과 득점 계수에 쓴다). 중립이면 park가 undefined
 */
export function teamParkInfo(src: ParkSource, franchise: string, year: number, s: StadiumState | undefined, franchises: string[],
                             lg: ParkLeagueRates, pp: EngineParams['park'] = DEFAULT_PARAMS.park): { park: SimTeam['park']; basis: TeamParkBasis } {
  const w = worksAt(src, franchise, year, s);
  if (w.wall) return { park: { hr: 1, ev: w.wall }, basis: 'wall' };
  if (w.fence) return { park: { hr: 1, ev: w.fence }, basis: 'fence' };
  if (w.built) return { park: w.built.park, basis: 'built' };
  const v = w.touched ? realParkNoOwn(src, year, franchise, franchises, lg, pp)
    : realParkYear(src, year, franchises, lg, pp).get(franchise);
  const hr = parkFactor(s).hr;
  const run = v?.run ?? 1;
  return { park: hr !== 1 || run !== 1 ? { hr, ...(run !== 1 ? { run } : {}), ...(v?.ev ? { ev: v.ev } : {}) } : undefined, basis: v ? v.basis : 'none' };
}

export function teamParkAt(src: ParkSource, franchise: string, year: number, s: StadiumState | undefined, franchises: string[],
                           lg: ParkLeagueRates, pp: EngineParams['park'] = DEFAULT_PARAMS.park): SimTeam['park'] {
  return teamParkInfo(src, franchise, year, s, franchises, lg, pp).park;
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
                      park?: { fence: Fence; dome: boolean }, delay = 0): void {
  league.stadiums![team].project = {
    kind, start: offYear + 1 + delay, open: offYear + 1 + delay + years, cost, capacity,
    ...(park ? { ...(park.dome ? { dome: true } : {}), fence: { ...park.fence }, park: fenceParkEvents(park.fence, DEFAULT_PARAMS.park).ev } : {}),
  };
  league.ledger.push({ year: offYear + 1, from: team, to: -1, amount: downPayment(cost), note: `${league.teams[team].name} 구장 ${kind === 'new' ? '신축' : '리모델링'} 착공금`, kind: 'stadium' });
}

export interface StadiumOption {
  id: string;
  kind: 'remodel' | 'new' | 'fence' | 'wall';
  label: string;
  cost: number;
  /** 공사 시즌 (펜스 조정·가벽은 0 = 오프시즌 안에 끝남) */
  years: number;
  capacity: (now: number) => number;
}

/**
 * 고를 수 있는 공사 (화면·주문 검사). at = 그 구단 펜스 공사 상황이면 화면에 보일 것만:
 * 혼자 쓰는 구장은 펜스 조정, 함께 쓰는 구장은 가벽 설치, 가벽이 서 있으면(실제 역사의 가벽 포함) 가벽 철거 (6.7.5·6.8.7). 빼면 모두
 */
export function stadiumOptions(at?: Pick<FenceWorkState, 'kind' | 'wall' | 'history'>): StadiumOption[] {
  const same = (now: number) => now;
  return [
    { id: 'remodel', kind: 'remodel', label: '리모델링', cost: REMODEL.cost, years: REMODEL.years, capacity: (now) => now + REMODEL.capacity },
    ...NEW_PARK.options.map((o, i) => ({
      id: `new-${i}`, kind: 'new' as const, label: `신구장 ${o.capacity.toLocaleString()}석`, cost: o.cost, years: NEW_PARK.years, capacity: () => o.capacity,
    })),
    ...(!at || at.kind === 'fence' ? [{ id: 'fence', kind: 'fence' as const, label: '펜스 조정', cost: FENCE_WORK.cost, years: 0, capacity: same }] : []),
    ...(!at || at.kind === 'wall' ? [{ id: 'wall', kind: 'wall' as const, label: at?.wall ? '가벽 제원 바꾸기' : '가벽 설치', cost: WALL.install, years: 0, capacity: same }] : []),
    ...(!at || at.wall || at.history ? [{ id: 'wall-off', kind: 'wall' as const, label: '가벽 철거', cost: 0, years: 0, capacity: same }] : []),
  ];
}

/**
 * 공사를 주문한다 (오프시즌, offYear 시즌이 끝난 뒤). 다음 시즌부터 공사한다. 착공금을 바로 낸다.
 * cash: 지금 자금. 착공금만큼은 있어야 한다
 */
export function orderStadium(league: LeagueState, team: number, offYear: number, id: string, cash: number,
                             park: { size?: ParkSize; fence?: Fence; dome?: boolean; deal?: StadiumDeal } = {}, src?: ParkSource): { ok: boolean; message: string } {
  const s = league.stadiums?.[team];
  const opt = stadiumOptions().find((o) => o.id === id);
  if (!s || !opt) return { ok: false, message: '없는 공사입니다.' };
  // 펜스 조정·가벽: 리모델링과 같은 오프시즌에도 할 수 있고, 신구장 공사가 잡혀 있으면 못 한다 (6.7.1)
  if (opt.kind === 'fence' || opt.kind === 'wall') return orderFenceWork(league, team, offYear, id, cash, park.fence, src);
  if (s.project && s.project.open > offYear + 1) return { ok: false, message: '이미 공사가 잡혀 있습니다.' };
  if (park.size !== undefined && !FENCE_PRESETS[park.size]) return { ok: false, message: '없는 구장 크기입니다.' };
  if (park.fence !== undefined && !fenceValid(park.fence, DEFAULT_PARAMS.park)) return { ok: false, message: '고를 수 없는 펜스 제원입니다.' };
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
  // 펜스 제원: 고른 값, 없으면 예시값 (P6 전 조작 기록의 크기 size도 예시값으로 읽는다)
  const fence = park.fence ?? FENCE_PRESETS[park.size ?? 'neutral'].fence;
  startProject(league, team, offYear, opt.kind, opt.years, cost, opt.capacity(s.capacity), isNew ? { fence, dome } : undefined, delay);
  const eok = (v: number) => `${(v / 10000).toFixed(0)}억 원`;
  const hrIdx = Math.round(fenceParkEvents(fence, DEFAULT_PARAMS.park).ev.hr * 100);
  const kind = isNew ? ` (${fenceText(fence)}, 예상 홈런 지수 ${hrIdx}${dome ? ', 돔' : ''})` : '';
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
        // 펜스를 고른 신구장(P6)은 착공 때 계산한 배율을 옮기고, 그 전 주문은 홈런 배율 하나
        if (p.park) {
          s.fence = p.fence;
          s.park = p.park;
          delete s.hr;
        } else {
          s.hr = p.hr ?? 1;
        }
        if (p.dome) s.dome = true; else delete s.dome;
        s.name = `${league.teams[t].name} 새 구장`;
        delete s.unchecked;
        // 옛 구장의 펜스 공사·가벽은 새 구장과 상관없다
        delete s.wall;
      } else {
        s.capacity = p.capacity;
        s.quality = Math.min(90, s.quality + REMODEL.quality);
      }
      (s.done ??= []).push({ kind: p.kind, open: p.open, cost: p.cost, ...(p.kind === 'new' && p.fence && p.park ? { fence: p.fence, park: p.park } : {}) });
      delete s.project;
      const spec = p.kind === 'new' && p.fence && p.park ? `, ${fenceText(p.fence)}, 홈런 지수 ${Math.round(p.park.hr * 100)}` : '';
      out.push(`${league.teams[t].name} ${p.kind === 'new' ? '신구장' : '리모델링한 구장'} ${year + 1} 시즌 개장 (${s.capacity.toLocaleString()}석${spec})`);
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
      // 실제로 다른 구장으로 옮기면 옛 구장의 펜스 조정·가벽은 걷히고 간격은 개장 해부터 다시 센다.
      // 제원이 확정되지 않은 계획 구장(잠실 돔)은 쓰던 구장 제원을 그대로 쓰므로 이어 간다 (6.7.2, 결정 8)
      const spec = realParkSpec(league.teams[t].franchise, year + 1);
      const confirmed = !!spec && spec.confirmed === '출처 확인' && spec.fence.l != null && spec.fence.c != null && spec.fence.r != null;
      if ((s.fence || s.wall) && (!real.planned || confirmed)) {
        delete s.fence;
        delete s.park;
        delete s.wall;
        s.fenceFrom = year + 1;
      }
    } else if (!(s.done ?? []).some((d) => d.kind === 'new')) {
      // 자료(parks.json)에서 구장이 바뀌었지만 옮기는 해가 아닌 경우: 이름·확인 표시만 (시설·좌석·돔은 그대로, ballparks.ts)
      const renamed = realParkRename(league.teams[t].franchise, year + 1);
      if (renamed && renamed.name !== s.name) {
        s.name = renamed.name;
        if (renamed.checked) delete s.unchecked; else s.unchecked = true;
      }
    }
    // 가벽이 서 있는 AI 구단 (플레이어가 떠난 구단): 다음 시즌부터 걷는다. AI 구장은 실측을 지킨다 (6.8.6)
    if (t !== userTeam && s.wall) {
      (s.done ??= []).push({ kind: 'wall-off', open: year + 1, cost: 0 });
      delete s.wall;
      out.push(`${league.teams[t].name}, ${s.name ?? '구장'} 가벽 철거 (${year + 1} 시즌부터 원래 펜스)`);
    }
    // AI 신구장: 오래되고 낡은 구장, 자금이 넉넉하면 (지자체 표준 분담, 중립 구장. 연고 시장이 크면 큰 구장)
    const age = year + 1 - (s.opened ?? realParkAt(league.teams[t].franchise, year)?.from ?? league.startYear);
    const bigMarket = (league.fans?.[t]?.level ?? 50) >= 60;
    const opt = NEW_PARK.options[bigMarket ? 1 : 0];
    if (t !== userTeam && !s.project && s.quality < AI_NEW_BELOW && age >= AI_NEW_AGE && cashOf(t) >= opt.cost * 1.5
        && !realParkOpening(league.teams[t].franchise, year + 1 + NEW_PARK.years)) {
      startProject(league, t, year, 'new', NEW_PARK.years, opt.cost, opt.capacity, { fence: FENCE_PRESETS.neutral.fence, dome: false });
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

// ---- 펜스 조정 공사·가벽 (구장효과 기획안 6.7·6.8, 결정 10~13, P6b·P6c)

/**
 * 펜스 조정: 구단 부담 30억 원 일시불, 오프시즌 안에 끝나 다음 시즌 개막부터 새 펜스. 새 펜스가 쓰인 첫 시즌부터 5시즌이 지나야 다시 (임시값, 6.7.1).
 * 가벽: 설치 10억 원 일시불 + 서 있는 시즌마다 조립·해체 4억 원 (5시즌이면 펜스 조정과 같은 30억, 임시값, 6.8.3)
 */
export const FENCE_WORK = { cost: 300_000, every: 5 };
export const WALL = { install: 100_000, yearly: 40_000 };

/** 그 해 실제로 쓰인 게임 안 구장 공사 (done에서 개막이 그 해 이전인 것, 기획안 6.8.4 값을 고르는 순서) */
interface WorksAt {
  /** 게임 안 신구장 값 (있으면 신구장) */
  built?: { park: SimTeam['park'] };
  fence?: ParkEvents;
  wall?: ParkEvents;
  /** 게임 안에서 펜스·가벽을 손댔다 → 실제 역사의 그 구단 가벽 행(X-존)을 따르지 않는다 (6.8.9) */
  touched: boolean;
}

function worksAt(src: ParkSource, franchise: string, year: number, s: StadiumState | undefined): WorksAt {
  const out: WorksAt = { touched: false };
  const done = s?.done ?? [];
  const built = done.some((d) => d.kind === 'new');
  // 실제 구장 공사는 그 구장에만: 그 뒤 실제로 다른 구장(확정 제원이 있는 계획 구장 포함)으로 옮기면 걷힌다 (6.7.2 마지막 줄)
  const home = !built && src.parks ? homeParkId(src.parks, franchise, year) : undefined;
  const samePark = (open: number) => built || !src.parks || homeParkId(src.parks, franchise, open) === home;
  for (const d of done) {
    if (d.open > year) continue;
    if (d.kind === 'new') {
      // 펜스를 고른 신구장(P6)은 착공 때 계산한 배율, 그 전에 지은 신구장은 홈런 배율 하나
      const park = d.park ?? s!.park;
      const hr = parkFactor(s).hr;
      out.built = { park: park ? { hr: 1, ev: park } : hr !== 1 ? { hr } : undefined };
      delete out.fence;
      delete out.wall;
    } else if (d.kind === 'fence' && samePark(d.open)) {
      out.fence = d.park;
      delete out.wall;
      out.touched = true;
    } else if (d.kind === 'wall' && samePark(d.open)) {
      out.wall = d.park;
      out.touched = true;
    } else if (d.kind === 'wall-off' && samePark(d.open)) {
      delete out.wall;
      out.touched = true;
    }
  }
  return out;
}

/** 그 해 같은 실제 구장을 주 구장으로 쓰는 다른 구단 (함께 쓰는 구장, 6.8.5). 게임 안에서 신구장을 지은 구단은 혼자 쓴다 */
export function sharedPartner(league: Pick<LeagueState, 'teams' | 'stadiums'>, team: number, year: number, src: ParkSource | undefined): number | undefined {
  const builtBy = (t: number) => (league.stadiums?.[t]?.done ?? []).some((d) => d.kind === 'new' && d.open <= year);
  if (!src?.parks || builtBy(team)) return undefined;
  const id = homeParkId(src.parks, league.teams[team].franchise, year);
  if (!id) return undefined;
  const t = league.teams.findIndex((x, i) => i !== team && !builtBy(i) && homeParkId(src.parks!, x.franchise, year) === id);
  return t >= 0 ? t : undefined;
}

/** 펜스 공사 상황 (화면·주문 검사). offYear 시즌이 끝난 오프시즌, 공사는 offYear + 1 시즌부터 */
export interface FenceWorkState {
  /** 할 수 있는 공사: 혼자 쓰면 펜스 조정, 함께 쓰면 가벽 */
  kind: 'fence' | 'wall';
  partner?: number;
  /** 지금 펜스 (펜스 조정 뒤 값 / 신구장 / 실제 제원, 제원이 없으면 중립 예시값) */
  now: Fence;
  /** 실제 구장 제원 행 (원래 펜스, 게임 안 신구장이면 없음) */
  row?: ParkSpec;
  /** 서 있는 게임 안 가벽 */
  wall?: Fence;
  /** 실제 역사의 가벽(X-존)이 다음 시즌에 선다 (게임 안에서 손대지 않았을 때) */
  history?: ParkSpec;
  /** 펜스를 다시 바꿀 수 있는 첫 시즌 (간격) */
  next?: number;
  /** 지금 못 하는 까닭 (신구장 공사 중, 간격) */
  block?: string;
}

export function fenceWorkState(league: Pick<LeagueState, 'teams' | 'stadiums'>, team: number, offYear: number, src: ParkSource | undefined,
                               pp: EngineParams['park'] = DEFAULT_PARAMS.park): FenceWorkState {
  const year = offYear + 1;
  const s = league.stadiums?.[team];
  const fr = league.teams[team].franchise;
  const built = (s?.done ?? []).some((d) => d.kind === 'new');
  const partner = sharedPartner(league, team, year, src);
  const base = built ? undefined : fenceBaseOf(src ?? {}, fr, year, FENCE_PRESETS.neutral.fence, pp);
  const real = base?.row ? fenceOfRow(base.row, pp) ?? undefined : undefined;
  const w = worksAt(src ?? {}, fr, year, s);
  const now = (built || w.fence) && s?.fence ? s.fence : real ?? FENCE_PRESETS.neutral.fence;
  const history = !built && !w.touched && src?.parks ? historyWallAt(src.parks, fr, year) : undefined;
  // 간격: 펜스가 바뀐 해(펜스 조정·가벽 설치·제원 바꾸기·철거, 게임 안 신구장 개장)부터 5시즌
  const since = Math.max(s?.fenceFrom ?? -Infinity, built ? s?.opened ?? -Infinity : -Infinity);
  const next = Number.isFinite(since) ? since + FENCE_WORK.every : undefined;
  const block = s?.project?.kind === 'new' && s.project.open > year ? '신구장 공사 중에는 지금 구장의 펜스를 바꿀 수 없습니다.'
    : next !== undefined && year < next ? `펜스는 ${FENCE_WORK.every}시즌마다 바꿀 수 있습니다. 다음은 ${next - 1} 시즌 뒤입니다.` : undefined;
  return {
    kind: partner !== undefined ? 'wall' : 'fence', ...(partner !== undefined ? { partner } : {}), now, ...(base?.row ? { row: base.row } : {}),
    ...(s?.wall ? { wall: s.wall.fence } : {}), ...(history ? { history } : {}), ...(next !== undefined ? { next } : {}), ...(block ? { block } : {}),
  };
}

const intIn = (x: number, [lo, hi]: [number, number]) => Number.isInteger(x) && x >= lo && x <= hi;

/**
 * 펜스 공사 계획 (주문 검사와 화면 미리 보기가 같은 함수): 거절이면 문구, 되면 새 배율과 비용.
 * 펜스 조정(id 'fence'): 칸마다 지금 값 그대로이거나 고르는 범위 안. 가벽('wall'): 거리는 원래 펜스 이하(하한은 범위), 높이는 범위 안.
 * 실제 구장은 차이 방식 = 조정 전 값(실측 기간 평균) × (새 제원 짐작 ÷ 원래 제원 짐작), 게임 안 신구장은 새 제원으로 다시 (6.7.2·6.8.4)
 */
export function planFenceWork(league: Pick<LeagueState, 'teams' | 'stadiums'>, team: number, offYear: number, id: 'fence' | 'wall', f: Fence | undefined,
                              cash: number, src: ParkSource | undefined, pp: EngineParams['park'] = DEFAULT_PARAMS.park):
  { ok: false; message: string } | { ok: true; park: ParkEvents; cost: number; fence: Fence; from: Fence } {
  const st = fenceWorkState(league, team, offYear, src, pp);
  if (id === 'fence' && st.kind === 'wall') return { ok: false, message: '함께 쓰는 구장은 펜스 대신 가벽을 세웁니다.' };
  if (id === 'wall' && st.kind === 'fence') return { ok: false, message: '혼자 쓰는 구장은 가벽 대신 펜스 조정을 합니다.' };
  if (st.block) return { ok: false, message: st.block };
  if (!f) return { ok: false, message: '고를 수 없는 펜스 제원입니다.' };
  const R = pp.specFit.range;
  const hRange: [number, number] = [Math.round(R.height[0] * 10), Math.round(R.height[1] * 10)];
  const hOk = (h: number) => intIn(h, hRange) && h % 5 === 0;
  const from = id === 'wall' ? st.wall ?? st.now : st.now;
  if (id === 'fence') {
    const ok = (k: 'l' | 'c' | 'r') => f[k] === st.now[k] || intIn(f[k], k === 'c' ? R.center : R.side);
    if (!ok('l') || !ok('c') || !ok('r') || !(f.h === st.now.h || hOk(f.h))) return { ok: false, message: '고를 수 없는 펜스 제원입니다.' };
    if (f.l === st.now.l && f.c === st.now.c && f.r === st.now.r && f.h === st.now.h) return { ok: false, message: '바뀌는 펜스가 없습니다.' };
  } else {
    // 가벽은 원래 펜스(실제 제원) 앞에 세운다
    if (f.l > st.now.l || f.c > st.now.c || f.r > st.now.r) return { ok: false, message: '가벽은 원래 펜스보다 안쪽에만 세울 수 있습니다.' };
    const ok = (k: 'l' | 'c' | 'r') => f[k] === st.now[k] || intIn(f[k], k === 'c' ? R.center : R.side);
    if (!ok('l') || !ok('c') || !ok('r') || !hOk(f.h)) return { ok: false, message: '고를 수 없는 펜스 제원입니다.' };
    if (f.l === st.now.l && f.c === st.now.c && f.r === st.now.r) return { ok: false, message: '줄어드는 펜스 거리가 없습니다.' };
    if (st.wall && f.l === st.wall.l && f.c === st.wall.c && f.r === st.wall.r && f.h === st.wall.h) return { ok: false, message: '바뀌는 펜스가 없습니다.' };
  }
  const cost = id === 'wall' ? WALL.install : FENCE_WORK.cost;
  if (cash < cost) return { ok: false, message: `자금이 모자랍니다. ${(cost / 10000).toFixed(0)}억 원은 있어야 합니다.` };
  const s = league.stadiums?.[team];
  let park: ParkEvents;
  if ((s?.done ?? []).some((d) => d.kind === 'new')) {
    park = fenceParkEvents(f, pp).ev;
  } else {
    const b = fenceBaseOf(src ?? {}, league.teams[team].franchise, offYear + 1, FENCE_PRESETS.neutral.fence, pp);
    park = applyDiff(b.base, guessLogs(fenceSpecOf(f, b.row, pp), pp)!, b.ref, pp);
  }
  return { ok: true, park, cost, fence: { ...f }, from };
}

/** 펜스 바뀐 칸: "좌 101 → 99m · 중 122 → 120m · 우 101m 그대로 · 높이 3.3m 그대로" */
export function fenceChangeText(from: Fence, to: Fence): string {
  const d = (label: string, a: number, b: number, unit = 'm') => (a === b ? `${label} ${a}${unit} 그대로` : `${label} ${a} → ${b}${unit}`);
  return [d('좌', from.l, to.l), d('중', from.c, to.c), d('우', from.r, to.r), d('높이', from.h / 10, to.h / 10)].join(' · ');
}

/** 그 해 홈런 배율 (소식의 "홈런 지수 전 → 후") */
function hrOf(park: SimTeam['park']): number {
  return gameParkOf(park, DEFAULT_PARAMS.park).hr;
}

/** 펜스 조정·가벽 주문 (orderStadium). 공사 시즌이 없어 StadiumProject를 쓰지 않고 바로 StadiumState를 고친다 (6.7.5) */
function orderFenceWork(league: LeagueState, team: number, offYear: number, id: string, cash: number, f: Fence | undefined,
                        src: ParkSource | undefined): { ok: boolean; message: string } {
  const s = league.stadiums![team];
  const year = offYear + 1;
  const name = league.teams[team].name;
  const parkName = s.name ?? '구장';
  const frs = league.teams.map((t) => t.franchise);
  const lg = { rates: { s1: 0, d2: 0, t3: 0, hr: 0 }, rpa: 0 };
  const hrNow = () => hrOf(teamParkInfo(src ?? {}, league.teams[team].franchise, year, s, frs, lg).park);
  if (id === 'wall-off') {
    const st = fenceWorkState(league, team, offYear, src);
    if (!s.wall && !st.history) return { ok: false, message: '철거할 가벽이 없습니다.' };
    const before = hrNow();
    const mine = !!s.wall;
    (s.done ??= []).push({ kind: 'wall-off', open: year, cost: 0 });
    delete s.wall;
    // 실제 역사의 가벽(X-존)은 플레이어가 고른 공사가 아니라 간격을 세지 않는다 (6.8.9)
    if (mine) s.fenceFrom = year;
    return { ok: true, message: `${name}, ${parkName} 가벽 철거 (${year} 시즌부터 원래 펜스, 홈런 지수 ${Math.round(before * 100)} → ${Math.round(hrNow() * 100)}).${mine ? '' : ' 실제 역사의 가벽을 더는 따르지 않습니다.'}` };
  }
  const plan = planFenceWork(league, team, offYear, id as 'fence' | 'wall', f, cash, src);
  if (!plan.ok) return plan;
  const before = hrNow();
  const built = (s.done ?? []).some((d) => d.kind === 'new');
  const done = (s.done ??= []);
  // 예전 저장의 신구장 기록에 배율이 없으면 지금 배율을 남긴다 (조정 전 시즌 값이 바뀌지 않게)
  for (const d of done) if (d.kind === 'new' && !d.park && s.park) Object.assign(d, { park: s.park, ...(s.fence ? { fence: s.fence } : {}) });
  done.push({ kind: id as 'fence' | 'wall', open: year, cost: plan.cost, fence: plan.fence, park: plan.park });
  s.fenceFrom = year;
  if (id === 'fence') {
    s.fence = plan.fence;
    s.park = plan.park;
    delete s.wall;
  } else {
    s.wall = { fence: plan.fence, park: plan.park, from: year };
  }
  const note = id === 'fence' ? '구장 펜스 조정' : '가벽 설치';
  league.ledger.push({ year, from: team, to: -1, amount: plan.cost, note: `${name} ${note}`, kind: 'stadium' });
  const after = Math.round(hrNow() * 100);
  const hr = `홈런 지수 ${Math.round(before * 100)} → ${after}`;
  if (id === 'fence') return { ok: true, message: `${name}, ${parkName} 펜스 조정 (${fenceChangeText(plan.from, plan.fence)}, ${hr}), ${year} 시즌부터. 구단 부담 ${(plan.cost / 10000).toFixed(0)}억 원.${built ? '' : ' 실측 구장 효과에 펜스가 바뀐 만큼의 짐작을 곱합니다.'}` };
  const partner = sharedPartner(league, team, year, src);
  return { ok: true, message: `${name}, ${parkName}에 가벽 설치 (${fenceChangeText(plan.from, plan.fence)}, ${name} 홈 경기 ${hr}), ${year} 시즌부터.${partner !== undefined ? ` ${league.teams[partner].name} 홈 경기는 그대로.` : ''} 설치 ${(WALL.install / 10000).toFixed(0)}억 원, 가벽이 서 있는 시즌마다 ${(WALL.yearly / 10000).toFixed(0)}억 원.` };
}

/** 개막 때 (league.year = 새 시즌): 가벽이 서 있는 구단의 조립·해체 비용을 장부에 (6.8.3). 우리 구단 소식 문장 */
export function openWalls(league: LeagueState, userTeam: number): string[] {
  const news: string[] = [];
  for (let t = 0; t < (league.stadiums?.length ?? 0); t++) {
    const w = league.stadiums![t].wall;
    if (!w || w.from > league.year) continue;
    league.ledger.push({ year: league.year, from: t, to: -1, amount: WALL.yearly, note: `${league.teams[t].name} 가벽 조립·해체`, kind: 'stadium' });
    if (t === userTeam) news.push(`가벽 조립·해체 비용 ${(WALL.yearly / 10000).toFixed(0)}억 원 (${league.year} 시즌)`);
  }
  return news;
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
