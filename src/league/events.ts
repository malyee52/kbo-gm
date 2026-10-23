// 시즌 중 무작위 이벤트 (2026-10-11 사용자 요청).
//
// 정규시즌 하루마다 이벤트가 생길 확률이 있고, 생기지 않은 날이 이어질수록 확률이 오르며(EVENT_STEP), 생기면 처음 값(EVENT_BASE)으로 돌아간다.
// 이벤트는 선택지를 고르는 형식이다. 진행 화면은 이벤트가 생기면 그날 멈추고, 답하기 전에는 더 진행하지 않는다.
// 화면을 거치지 않는 진행(테스트·장기 진행)은 첫 번째 선택지(무난한 쪽)로 자동 처리한다.
// 난수는 리그 시드·연도·날짜에서 가르므로 같은 시드·같은 선택이면 같은 결과가 나온다. 수치는 임시값.
//
// 실존 선수가 나오는 이벤트는 사실 판단이 들어가지 않는 중립 문구만 쓴다 (부상·사생활·인물평 없음).

import { Rng } from '../engine';
import type { LeaguePlayer, LeagueState } from './types';
import { EXTRA_EVENTS } from './events-extra';

/** 하루 확률의 처음 값, 하루마다 오르는 폭, 최대 */
// 2026-10-12 이벤트를 127종으로 늘리며 조금 잦게 (한 시즌 무작위 이벤트 약 10 → 14번, 임시값)
export const EVENT_BASE = 0.015;
export const EVENT_STEP = 0.006;
export const EVENT_MAX = 0.35;

/** 며칠 동안 관중률을 바꾸는 효과 (finance.ts의 fillRate가 읽는다) */
export interface FillBuff {
  team: number;
  year: number;
  /** 이 날부터 (일정 색인) */
  from: number;
  /** 이 날 전까지 */
  until: number;
  fill: number;
  note: string;
}

export interface PendingEvent {
  id: string;
  year: number;
  day: number;
  /** 이벤트별 값 (금액 등). 만들 때 정해 둔다 */
  vars: Record<string, number | string>;
}

export interface EventLog {
  year: number;
  day: number;
  id: string;
  choice: number;
  result: string;
}

/**
 * 며칠 동안 경기력을 바꾸는 효과 (경기력). 타석마다 타자에게 유리한 정도(edge)에 더한다 (engine/game.ts).
 * 크기 비교: 홈 이점 0.013, 좌우 상성 0.035. 세션이 날마다 이 목록으로 선수별 값을 만든다 (formToday)
 */
export interface FormBuff {
  team: number;
  year: number;
  from: number;
  until: number;
  /** 한 선수만 (선수 id). 없으면 구단 전체 */
  player?: string;
  /** 구단 전체일 때: 타자만, 투수만, 모두 */
  side?: 'bat' | 'pit' | 'all';
  edge: number;
  note: string;
}

/**
 * 며칠 동안 선수 컨디션을 내리는 몸 상태 사건 (감기·몸살·배탈·컨디션 난조, 엔진 2 12단계, docs/컨디션_기획안.md 1.3).
 * 흐름(engine/condition.ts)에 더한다. 화면에는 "나쁨 · 감기"처럼 사유만 보이고 숫자는 없다. 실존 선수에게도 쓰는 허용 사건이다
 */
export interface CondBuff {
  team: number;
  year: number;
  from: number;
  until: number;
  /** 한 선수만 (선수 id). 없으면 구단 전체 */
  player?: string;
  /** 컨디션에 더하는 값 (음수, −1~0) */
  value: number;
  /** 화면 사유 (감기·몸살·배탈·컨디션 난조) */
  reason: string;
}

export interface EventState {
  /** 오늘 확률 */
  chance: number;
  pending: PendingEvent | null;
  log: EventLog[];
  buffs: FillBuff[];
  /** 경기력 효과 (2026-10-11 추가, 예전 저장에는 없다) */
  forms?: FormBuff[];
  /** 컨디션 사건 (엔진 2 12단계, 예전 저장에는 없다) */
  conds?: CondBuff[];
}

export function ensureEvents(league: LeagueState): EventState {
  league.events ??= { chance: EVENT_BASE, pending: null, log: [], buffs: [] };
  return league.events;
}

/** 이벤트 효과를 적용하는 데 쓰는 도구 (세션이 만든다) */
export interface EventContext {
  league: LeagueState;
  team: number;
  teamName: string;
  year: number;
  day: number;
  /** 정규시즌 일정 길이 */
  seasonDays: number;
  /** 지금 순위 (1부터)와 구단 수 */
  rank: number;
  teams: number;
  winPct: number;
  /** 지금 자금 (만 원) */
  cash: number;
  /** 우리 구단 선수 (개막 때 리그 상태 기준) */
  roster: LeaguePlayer[];
  addCash(amount: number, note: string): void;
  addTrust(delta: number): void;
  addFill(fill: number, days: number, note: string): void;
  // ---- 경기에 영향을 주는 도구 (2026-10-11 사용자 요청: 재정 이벤트만 있는 문제)
  /** 지금 우리 구단 선수 (트레이드 반영, 이번 시즌 기록) */
  players: EventPlayer[];
  /** 최근 10경기 승패, 지금 연승(+)·연패(−) */
  recent: { w: number; l: number };
  streak: number;
  month: number;
  /** 라이벌 구단이 있나 */
  hasRival: boolean;
  /** 트레이드 마감 전인가 */
  tradeOpen: boolean;
  /** 경기력 효과. delay일 뒤부터 days일 동안 */
  addForm(edge: number, days: number, note: string, opts?: { player?: string; side?: 'bat' | 'pit' | 'all'; delay?: number }): void;
  /** 컨디션 사건 (몸 상태 계열만). delay일 뒤부터 days일 동안 우리 선수단(또는 한 선수)의 컨디션에 value를 더한다 */
  addCond(value: number, days: number, reason: string, opts?: { player?: string; delay?: number }): void;
  /** 구원 투수(또는 투수 전체) 피로를 없앤다 */
  restPitchers(all?: boolean): void;
  /** 그 선수를 오늘부터 days일 쉬게 한다 (결장) */
  rest(id: string, days: number): void;
  /** AI 구단이 먼저 거는 트레이드 제안 (AI가 받아들일 조건). 없으면 null */
  tradeOffer(rng: Rng): { team: number; teamName: string; give: string; giveName: string; get: string; getName: string } | null;
  /** 제안된 트레이드를 실행한다 (조건이 바뀌었으면 하지 않는다). 결과 문구 */
  trade(team: number, give: string, get: string): string;
  /** 팬 만족도를 바꾼다 (stadium.ts, 2026-10-12 이벤트 확장) */
  addFans(delta: number, note: string): void;
  /** 우리 선수 잠재력을 바꾼다 (런) */
  addPotential(id: string, delta: number): void;
}

/** 이벤트가 보는 우리 선수 */
export interface EventPlayer {
  id: string;
  name: string;
  isPitcher: boolean;
  starter: boolean;
  age: number | null;
  foreign: boolean;
  /** 이번 시즌: 타석, OPS, 아웃 수, 평균자책, 오늘 피로 (engine/team.ts currentFatigue) */
  pa: number;
  ops: number;
  outs: number;
  era: number;
  fatigue: number;
}

export interface EventChoice {
  label: string;
  /** 고르기 전에 보여 주는 설명 */
  note: (c: EventContext, v: PendingEvent['vars']) => string;
  /** 효과를 적용하고 결과 문구를 돌려준다 */
  apply: (c: EventContext, v: PendingEvent['vars'], rng: Rng) => string;
}

export interface EventDef {
  id: string;
  title: string;
  weight: number;
  when?: (c: EventContext) => boolean;
  vars?: (c: EventContext, rng: Rng) => PendingEvent['vars'];
  text: (c: EventContext, v: PendingEvent['vars']) => string;
  /** 첫 번째가 무난한 기본 선택 (자동 처리 때 쓴다) */
  choices: EventChoice[];
  /** 무작위 이벤트로 굴리지 않고 따로 띄운다 (AI 트레이드 제안: session.ts tradeOfferDay) */
  manual?: boolean;
}

const eok = (man: number) => `${(man / 10000).toFixed(1)}억 원`;
const r3 = (x: number) => x.toFixed(3).replace(/^0/, '');

/** 부진한 주전 타자: 150타석 이상, OPS .650 미만 (가장 낮은 선수) */
function slumping(c: EventContext): EventPlayer | undefined {
  return c.players.filter((p) => !p.isPitcher && p.pa >= 150 && p.ops < 0.65).sort((a, b) => a.ops - b.ops || a.id.localeCompare(b.id))[0];
}
/** 많이 던진 선발 투수: 아웃 300(100이닝) 이상, 가장 많이 던진 선수 */
function workhorse(c: EventContext): EventPlayer | undefined {
  return c.players.filter((p) => p.isPitcher && p.starter && p.outs >= 300).sort((a, b) => b.outs - a.outs || a.id.localeCompare(b.id))[0];
}
/**
 * 지친 구원진: 구원 투수 피로(공 수, 하루 회복 뒤) 합이 125 이상. 2026 시즌 2시드에서 구단·날짜별 합의 백분위 90이 127
 * (엔진 2 4단계에서 피로 단위가 타자 수 → 공 수로 바뀌어 다시 잼, 2026-10-22)
 */
function bullpenTired(c: EventContext): boolean {
  return c.players.filter((p) => p.isPitcher && !p.starter).reduce((s, p) => s + p.fatigue, 0) >= 125;
}
const num = (v: PendingEvent['vars'], k: string) => Number(v[k]);

/** 2군 유망주 (24세 이하, 잠재력 높은 순) */
function prospects(c: EventContext): LeaguePlayer[] {
  return c.roster.filter((p) => !p.foreign && p.birthYear !== null && c.year - p.birthYear <= 24 && p.military?.state !== 'serving')
    .sort((a, b) => b.potential - a.potential || a.id.localeCompare(b.id));
}

export const EVENTS: EventDef[] = [
  {
    id: 'sponsor-patch', title: '유니폼 광고 제안', weight: 6,
    vars: (c, rng) => ({ amount: Math.round((40_000 + rng.range(0, 60_000)) * (c.winPct >= 0.55 ? 1.3 : 1)) }),
    text: (c, v) => `한 기업이 남은 시즌 동안 ${c.teamName} 유니폼 소매 광고를 하고 싶다며 ${eok(num(v, 'amount'))}을 제안했습니다. 구단주는 모기업과 업종이 겹친다며 달가워하지 않습니다.`,
    choices: [
      { label: '정중히 거절한다', note: () => '변화 없음', apply: () => '제안을 거절했습니다.' },
      { label: '받아들인다', note: (_c, v) => `자금 +${eok(num(v, 'amount'))}, 구단주 신뢰도 −2`,
        apply: (c, v) => { c.addCash(num(v, 'amount'), '유니폼 광고'); c.addTrust(-2); return `광고 계약으로 ${eok(num(v, 'amount'))}을 받았습니다. 구단주는 못마땅해합니다.`; } },
    ],
  },
  {
    id: 'parent-bonus', title: '모기업 격려금', weight: 4,
    when: (c) => c.rank <= 3,
    vars: (_c, rng) => ({ amount: Math.round(80_000 + rng.range(0, 70_000)) }),
    text: (c, v) => `${c.rank}위로 순항하자 모기업이 ${eok(num(v, 'amount'))}의 격려금을 보내겠다고 합니다. 받으면 구단주의 기대도 함께 높아집니다.`,
    choices: [
      { label: '감사히 받는다', note: (_c, v) => `자금 +${eok(num(v, 'amount'))}`, apply: (c, v) => { c.addCash(num(v, 'amount'), '모기업 격려금'); return '격려금을 받았습니다.'; } },
      { label: '성적으로 보답하겠다며 사양한다', note: () => '구단주 신뢰도 +3', apply: (c) => { c.addTrust(3); return '구단주가 단장의 태도를 높이 샀습니다.'; } },
    ],
  },
  {
    id: 'fan-festival', title: '팬 페스티벌 기획', weight: 5,
    vars: (_c, rng) => ({ cost: Math.round(20_000 + rng.range(0, 20_000)) }),
    text: (_c, v) => `마케팅팀이 홈 경기 주간에 팬 페스티벌을 열자고 합니다. 비용은 ${eok(num(v, 'cost'))}입니다.`,
    choices: [
      { label: '이번에는 넘어간다', note: () => '변화 없음', apply: () => '페스티벌은 열지 않았습니다.' },
      { label: '연다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 15일 동안 관중률 +6%p`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '팬 페스티벌'); c.addFill(0.06, 15, '팬 페스티벌'); return '페스티벌로 구장이 북적입니다.'; } },
    ],
  },
  {
    id: 'facility-repair', title: '구장 시설 고장', weight: 4,
    vars: (_c, rng) => ({ cost: Math.round(25_000 + rng.range(0, 35_000)) }),
    text: (_c, v) => `외야 전광판과 일부 좌석 시설이 고장 났습니다. 바로 고치면 ${eok(num(v, 'cost'))}이 들고, 미루면 한동안 관중이 줄 것 같습니다.`,
    choices: [
      { label: '바로 수리한다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}`, apply: (c, v) => { c.addCash(-num(v, 'cost'), '구장 시설 수리'); return '시설을 고쳤습니다.'; } },
      { label: '시즌 뒤로 미룬다', note: () => '30일 동안 관중률 −5%p', apply: (c) => { c.addFill(-0.05, 30, '구장 시설 고장'); return '수리를 미뤘습니다. 관중 불만이 나옵니다.'; } },
    ],
  },
  {
    id: 'winter-league', title: '유망주 해외 연수 제안', weight: 7,
    when: (c) => prospects(c).length > 0,
    vars: (c) => ({ id: prospects(c)[0].id, name: prospects(c)[0].name, cost: 20_000 }),
    text: (_c, v) => `해외 구단이 교류 연수를 제안했습니다. 육성 파트는 ${v.name} 선수를 추천합니다. 비용은 ${eok(num(v, 'cost'))}입니다.`,
    choices: [
      { label: '보내지 않는다', note: () => '변화 없음', apply: () => '연수 제안을 사양했습니다.' },
      { label: '보낸다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, ${v.name} 잠재력 +2~4`,
        apply: (c, v, rng) => {
          c.addCash(-num(v, 'cost'), '유망주 해외 연수');
          const p = c.league.players.find((x) => x.id === v.id);
          if (!p) return '선수를 찾을 수 없어 연수가 취소됐습니다.';
          const gain = 2 + Math.round(rng.range(0, 2));
          p.potential += gain;
          return `${p.name} 선수가 연수를 다녀왔습니다. 성장 여지가 커졌습니다.`;
        } },
    ],
  },
  {
    id: 'charity-game', title: '지역 자선 행사 요청', weight: 5,
    vars: () => ({ cost: 10_000 }),
    text: (_c, v) => `연고 지역 단체가 자선 행사에 선수단 참여와 ${eok(num(v, 'cost'))} 기부를 요청했습니다.`,
    choices: [
      { label: '정중히 사양한다', note: () => '변화 없음', apply: () => '이번 요청은 사양했습니다.' },
      { label: '참여한다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 구단주 신뢰도 +2, 10일 동안 관중률 +2%p`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '지역 자선 행사'); c.addTrust(2); c.addFill(0.02, 10, '자선 행사'); return '지역 사회의 반응이 좋습니다.'; } },
    ],
  },
  {
    id: 'parent-cut', title: '모기업 실적 악화', weight: 3,
    vars: (_c, rng) => ({ amount: Math.round(50_000 + rng.range(0, 50_000)) }),
    text: (_c, v) => `모기업 실적이 나빠져 올해 지원금 가운데 ${eok(num(v, 'amount'))}을 거둬들이겠다는 통보가 왔습니다.`,
    choices: [
      { label: '받아들인다', note: (_c, v) => `자금 −${eok(num(v, 'amount'))}`, apply: (c, v) => { c.addCash(-num(v, 'amount'), '모기업 지원금 회수'); return '지원금 일부를 돌려보냈습니다.'; } },
      { label: '구단 사정을 설명하며 버틴다', note: (_c, v) => `반반: 그대로 유지 / 자금 −${eok(num(v, 'amount') * 1.5)}·신뢰도 −3`,
        apply: (c, v, rng) => {
          if (rng.chance(0.5)) return '설득이 통했습니다. 지원금이 그대로 유지됩니다.';
          c.addCash(-Math.round(num(v, 'amount') * 1.5), '모기업 지원금 회수');
          c.addTrust(-3);
          return '설득이 통하지 않아 더 많은 금액이 회수됐고, 구단주도 불쾌해합니다.';
        } },
    ],
  },
  {
    id: 'media-criticism', title: '언론의 비판 기사', weight: 5,
    when: (c) => c.rank > Math.ceil(c.teams / 2),
    text: (c) => `${c.rank}위에 머문 ${c.teamName}의 운영을 비판하는 기사가 나왔습니다. 구단주도 기사를 읽었습니다.`,
    choices: [
      { label: '대응하지 않는다', note: () => '구단주 신뢰도 −1', apply: (c) => { c.addTrust(-1); return '조용히 넘어갔습니다.'; } },
      { label: '단장이 직접 인터뷰로 설명한다', note: () => '반반: 신뢰도 +3 / −4',
        apply: (c, _v, rng) => { if (rng.chance(0.5)) { c.addTrust(3); return '인터뷰가 좋은 반응을 얻었습니다.'; } c.addTrust(-4); return '인터뷰가 오히려 논란을 키웠습니다.'; } },
    ],
  },
  {
    id: 'win-streak-event', title: '연승 기념 이벤트', weight: 4,
    when: (c) => c.winPct >= 0.55,
    vars: () => ({ cost: 15_000 }),
    text: (_c, v) => `성적이 좋자 마케팅팀이 홈 경기 할인 이벤트를 열자고 합니다. 비용은 ${eok(num(v, 'cost'))}입니다.`,
    choices: [
      { label: '열지 않는다', note: () => '변화 없음', apply: () => '이벤트는 열지 않았습니다.' },
      { label: '연다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 20일 동안 관중률 +5%p`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '홈 경기 할인 이벤트'); c.addFill(0.05, 20, '할인 이벤트'); return '구장이 꽉 찼습니다.'; } },
    ],
  },
  {
    id: 'naming-offer', title: '응원 굿즈 협업 제안', weight: 4,
    vars: (_c, rng) => ({ amount: Math.round(15_000 + rng.range(0, 25_000)) }),
    text: (c, v) => `한 브랜드가 ${c.teamName}과 응원 굿즈 협업을 제안했습니다. 계약금은 ${eok(num(v, 'amount'))}입니다.`,
    choices: [
      { label: '계약한다', note: (_c, v) => `자금 +${eok(num(v, 'amount'))}`, apply: (c, v) => { c.addCash(num(v, 'amount'), '굿즈 협업'); return '협업 굿즈가 출시됩니다.'; } },
      { label: '구단 이미지와 맞지 않아 거절한다', note: () => '변화 없음', apply: () => '제안을 거절했습니다.' },
    ],
  },
  {
    id: 'ticket-price', title: '입장권 가격 조정 논의', weight: 4,
    text: () => '재무팀이 남은 시즌 입장권 가격을 올리자고 합니다. 관중은 조금 줄지만 수입은 늘 것이라고 합니다.',
    choices: [
      { label: '그대로 둔다', note: () => '변화 없음', apply: () => '가격을 그대로 두었습니다.' },
      { label: '올린다', note: () => '남은 시즌 관중률 −4%p, 대신 이번에 자금 +3억 원(선판매)',
        apply: (c) => { c.addCash(30_000, '입장권 가격 인상(선판매)'); c.addFill(-0.04, Math.max(1, c.seasonDays - c.day), '입장권 가격 인상'); return '가격을 올렸습니다. 일부 팬이 불만을 표했습니다.'; } },
    ],
  },
  {
    id: 'scout-tip', title: '스카우트 팀의 보고', weight: 6,
    when: (c) => prospects(c).length > 1,
    vars: (c) => { const p = prospects(c); const pick = p[Math.min(p.length - 1, 1)]; return { id: pick.id, name: pick.name, cost: 15_000 }; },
    text: (_c, v) => `스카우트 팀이 ${v.name} 선수에게 전담 코치를 붙이면 크게 성장할 수 있다고 보고했습니다. 비용은 ${eok(num(v, 'cost'))}입니다.`,
    choices: [
      { label: '지켜본다', note: () => '변화 없음', apply: () => '지금은 지켜보기로 했습니다.' },
      { label: '전담 코치를 붙인다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, ${v.name} 잠재력 +2`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '유망주 전담 코치'); const p = c.league.players.find((x) => x.id === v.id); if (p) p.potential += 2; return `${v.name} 선수에게 전담 코치를 붙였습니다.`; } },
    ],
  },

  // ---- 경기에 영향을 주는 이벤트 (경기력·휴식·트레이드). 2026-10-11 사용자 요청
  {
    id: 'team-meeting', title: '연패 탈출 대책', weight: 14,
    when: (c) => c.streak <= -3,
    text: (c) => `${c.teamName}이 ${-c.streak}연패에 빠졌습니다. 코칭스태프가 단장의 생각을 묻습니다.`,
    choices: [
      { label: '감독에게 맡긴다', note: () => '변화 없음', apply: () => '현장에 맡기기로 했습니다.' },
      { label: '단장이 선수단 미팅을 연다', note: () => '반반: 7일 동안 팀 경기력 +2.5 / −1.5 (단위: 타석당 %p)',
        apply: (c, _v, rng) => {
          if (rng.chance(0.55)) { c.addForm(0.025, 7, '선수단 미팅'); return '미팅 뒤 더그아웃 분위기가 살아났습니다.'; }
          c.addForm(-0.015, 7, '선수단 미팅 역효과'); return '미팅이 오히려 선수단을 위축시켰습니다.';
        } },
      { label: '특별 훈련을 지시한다', note: () => '5일 동안 팀 경기력 −1.5, 그 뒤 10일 동안 +2.5',
        apply: (c) => { c.addForm(-0.015, 5, '특별 훈련 피로'); c.addForm(0.025, 10, '특별 훈련 효과', { delay: 5 }); return '훈련량을 늘렸습니다. 당장은 지쳐 보입니다.'; } },
    ],
  },
  {
    id: 'momentum', title: '상승세 관리', weight: 10,
    when: (c) => c.streak >= 4,
    vars: () => ({ cost: 10_000 }),
    text: (c) => `${c.teamName}이 ${c.streak}연승을 달리고 있습니다. 선수단 사기를 더 끌어올릴 방법을 찾자는 의견이 나왔습니다.`,
    choices: [
      { label: '흐름을 그대로 둔다', note: () => '변화 없음', apply: () => '평소대로 갑니다.' },
      { label: '선수단 회식과 포상금', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 10일 동안 팀 경기력 +1.5`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '연승 포상금'); c.addForm(0.015, 10, '연승 포상'); return '선수단 사기가 하늘을 찌릅니다.'; } },
    ],
  },
  {
    id: 'bullpen-rest', title: '불펜 과부하', weight: 12,
    when: (c) => bullpenTired(c),
    text: () => '구원 투수들이 연투로 지쳤다는 보고가 올라왔습니다. 투수 코치는 휴식을 건의합니다.',
    choices: [
      { label: '지금처럼 운용한다', note: () => '7일 동안 투수진 경기력 −1.5 (피로 누적)',
        apply: (c) => { c.addForm(-0.015, 7, '불펜 피로 누적', { side: 'pit' }); return '지친 불펜으로 버팁니다.'; } },
      { label: '불펜 집중 관리 (2군 투수 활용)', note: () => '구원 투수 피로 회복, 5일 동안 투수진 경기력 −0.5',
        apply: (c) => { c.restPitchers(); c.addForm(-0.005, 5, '불펜 등판 조절', { side: 'pit' }); return '구원 투수들에게 휴식을 줬습니다.'; } },
    ],
  },
  {
    id: 'slump-hitter', title: '주전 타자 부진', weight: 12,
    when: (c) => !!slumping(c),
    vars: (c) => { const p = slumping(c)!; return { id: p.id, name: p.name, ops: p.ops, pa: p.pa, cost: 8_000 }; },
    text: (_c, v) => `${v.name} 선수의 시즌 OPS가 ${r3(num(v, 'ops'))}(${v.pa}타석)입니다. 타격 코치가 대책을 건의합니다.`,
    choices: [
      { label: '믿고 기다린다', note: () => '반반: 10일 동안 그 선수 +3.0 / 변화 없음',
        apply: (c, v, rng) => { if (rng.chance(0.5)) { c.addForm(0.03, 10, '믿음의 기용', { player: String(v.id) }); return `${v.name} 선수가 감을 찾기 시작했습니다.`; } return '아직은 반등 기미가 없습니다.'; } },
      { label: '전담 타격 훈련', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 3일 휴식 뒤 14일 동안 그 선수 +5.0`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '전담 타격 훈련'); c.rest(String(v.id), 3); c.addForm(0.05, 14, '전담 타격 훈련', { player: String(v.id), delay: 3 }); return `${v.name} 선수가 사흘 동안 타격 훈련에 집중합니다.`; } },
    ],
  },
  {
    id: 'ace-manage', title: '선발 투수 관리', weight: 10,
    when: (c) => !!workhorse(c),
    vars: (c) => { const p = workhorse(c)!; return { id: p.id, name: p.name, ip: Math.floor(p.outs / 3) }; },
    text: (_c, v) => `${v.name} 선수가 벌써 ${v.ip}이닝을 던졌습니다. 의료진은 한 차례 로테이션을 거르자고 합니다.`,
    choices: [
      { label: '로테이션을 그대로 돈다', note: () => '변화 없음', apply: () => '로테이션을 지킵니다.' },
      { label: '한 번 거른다', note: () => '7일 휴식, 그 뒤 21일 동안 그 선수 +4.0',
        apply: (c, v) => { c.rest(String(v.id), 7); c.addForm(0.04, 21, '휴식 뒤 재충전', { player: String(v.id), delay: 7 }); return `${v.name} 선수가 한 턴 쉬어 갑니다.`; } },
    ],
  },
  {
    id: 'hitting-coach', title: '타격 인스트럭터 초빙', weight: 9,
    vars: (_c, rng) => ({ cost: Math.round(15_000 + rng.range(0, 10_000)) }),
    text: (_c, v) => `이름난 타격 인스트럭터가 2주 동안 선수단을 지도할 수 있다고 합니다. 비용은 ${eok(num(v, 'cost'))}입니다.`,
    choices: [
      { label: '사양한다', note: () => '변화 없음', apply: () => '사양했습니다.' },
      { label: '초빙한다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 14일 동안 타자 경기력 +2.0`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '타격 인스트럭터'); c.addForm(0.02, 14, '타격 인스트럭터', { side: 'bat' }); return '타자들이 새 훈련법을 익히고 있습니다.'; } },
    ],
  },
  {
    id: 'pitching-coach', title: '투수 인스트럭터 초빙', weight: 9,
    vars: (_c, rng) => ({ cost: Math.round(15_000 + rng.range(0, 10_000)) }),
    text: (_c, v) => `해외 구단 출신 투수 인스트럭터가 2주 동안 투수진을 지도할 수 있다고 합니다. 비용은 ${eok(num(v, 'cost'))}입니다.`,
    choices: [
      { label: '사양한다', note: () => '변화 없음', apply: () => '사양했습니다.' },
      { label: '초빙한다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 14일 동안 투수 경기력 +2.0`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '투수 인스트럭터'); c.addForm(0.02, 14, '투수 인스트럭터', { side: 'pit' }); return '투수들이 새 그립과 루틴을 시험합니다.'; } },
    ],
  },
  {
    id: 'summer-heat', title: '한여름 체력 관리', weight: 10,
    when: (c) => c.month === 7 || c.month === 8,
    vars: () => ({ cost: 12_000 }),
    text: (_c, v) => `무더위가 이어지며 선수들이 지쳐 갑니다. 트레이닝 파트는 회복 장비와 영양 관리를 늘리자고 합니다 (${eok(num(v, 'cost'))}).`,
    choices: [
      { label: '평소대로 간다', note: () => '14일 동안 팀 경기력 −1.5', apply: (c) => { c.addForm(-0.015, 14, '무더위'); return '선수들이 더위에 지쳐 갑니다.'; } },
      { label: '회복 지원을 늘린다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 영향 없음`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '여름 회복 지원'); return '선수들이 더위를 잘 버티고 있습니다.'; } },
    ],
  },
  {
    id: 'rival-week', title: '라이벌전 총력전', weight: 8,
    when: (c) => c.hasRival,
    text: (c) => `${c.teamName}의 라이벌전이 다가옵니다. 팬들은 총력전을 기대합니다.`,
    choices: [
      { label: '평소대로 치른다', note: () => '변화 없음', apply: () => '평소 운용을 지킵니다.' },
      { label: '총력전을 선언한다', note: () => '7일 동안 팀 경기력 +2.5·관중률 +5%p, 그 뒤 7일 동안 −1.5 (반동)',
        apply: (c) => { c.addForm(0.025, 7, '총력전'); c.addFill(0.05, 7, '총력전'); c.addForm(-0.015, 7, '총력전 반동', { delay: 7 }); return '총력전을 선언했습니다. 구장이 뜨겁습니다.'; } },
    ],
  },
  {
    // 2026-10-12: 무작위 이벤트 가운데 하나로만 와서 한 시즌 0.4번도 안 됐다(사용자: "제안을 받아 본 적이 없다").
    // 이제 트레이드 마감 전까지 날마다 따로 굴린다 (session.ts tradeOfferDay). 여기는 화면 문구와 선택지만
    id: 'trade-offer', title: '트레이드 제안 접수', weight: 12, manual: true,
    when: (c) => c.tradeOpen,
    vars: (c, rng): PendingEvent['vars'] => {
      const o = c.tradeOffer(rng);
      return o ? { team: o.team, teamName: o.teamName, give: o.give, giveName: o.giveName, get: o.get, getName: o.getName } : { none: 1 };
    },
    text: (_c, v) => v.none
      ? '다른 구단 단장들과 통화했지만 마땅한 트레이드 제안은 없었습니다.'
      : `${v.teamName} 단장이 연락해 왔습니다. 우리 ${v.giveName} 선수를 원하고, 대신 ${v.getName} 선수를 주겠다고 합니다.`,
    choices: [
      { label: '거절한다', note: () => '변화 없음', apply: (_c, v) => (v.none ? '통화를 마쳤습니다.' : '제안을 거절했습니다.') },
      { label: '받아들인다', note: (_c, v) => (v.none ? '변화 없음' : `${v.giveName} ↔ ${v.getName} 1대1 트레이드 (받은 선수는 2군)`),
        apply: (c, v) => (v.none ? '통화를 마쳤습니다.' : c.trade(num(v, 'team'), String(v.give), String(v.get))) },
    ],
  },
  {
    id: 'veteran-mentor', title: '베테랑의 멘토링', weight: 7,
    when: (c) => prospects(c).length >= 2,
    vars: (c) => { const p = prospects(c).slice(0, 2); return { a: p[0].id, an: p[0].name, b: p[1].id, bn: p[1].name }; },
    text: (_c, v) => `코칭스태프가 베테랑 선수들과 ${v.an}·${v.bn} 선수를 묶어 멘토링 조를 짜자고 합니다. 베테랑들의 훈련 시간이 줄어듭니다.`,
    choices: [
      { label: '하지 않는다', note: () => '변화 없음', apply: () => '지금 체제를 유지합니다.' },
      { label: '멘토링 조를 짠다', note: (_c, v) => `${v.an}·${v.bn} 잠재력 +1, 10일 동안 팀 경기력 −0.5`,
        apply: (c, v) => {
          for (const id of [v.a, v.b]) { const p = c.league.players.find((x) => x.id === id); if (p) p.potential += 1; }
          c.addForm(-0.005, 10, '멘토링'); return '젊은 선수들이 베테랑에게서 많이 배우고 있습니다.';
        } },
    ],
  },
];

// 확장 이벤트 104종 (events-extra.ts, 2026-10-12)
EVENTS.push(...EXTRA_EVENTS);

const byId = new Map(EVENTS.map((e) => [e.id, e]));
export const eventDef = (id: string): EventDef | undefined => byId.get(id);

/**
 * 하루가 지난 뒤 이벤트를 굴린다. 생기면 pending을 채우고 확률을 처음 값으로, 아니면 확률을 올린다.
 * 이미 답을 기다리는 이벤트가 있으면 굴리지 않는다.
 */
export function rollEvent(state: EventState, c: EventContext): PendingEvent | null {
  if (state.pending) return null;
  const rng = new Rng(`${c.league.seed}/event/${c.year}/${c.day}`);
  if (!rng.chance(state.chance)) {
    state.chance = Math.min(EVENT_MAX, state.chance + EVENT_STEP);
    return null;
  }
  state.chance = EVENT_BASE;
  // 최근에 나온 이벤트는 피한다 (마지막 3개)
  const recent = new Set(state.log.slice(-3).map((l) => l.id));
  const cands = EVENTS.filter((e) => !e.manual && !recent.has(e.id) && (!e.when || e.when(c)));
  if (!cands.length) return null;
  const total = cands.reduce((s, e) => s + e.weight, 0);
  let u = rng.next() * total;
  let pick = cands[cands.length - 1];
  for (const e of cands) { u -= e.weight; if (u < 0) { pick = e; break; } }
  state.pending = { id: pick.id, year: c.year, day: c.day, vars: pick.vars ? pick.vars(c, rng) : {} };
  return state.pending;
}

/** 기다리는 이벤트에 답한다. 결과 문구를 돌려준다 */
export function resolveEvent(state: EventState, c: EventContext, choice: number): string {
  const ev = state.pending;
  if (!ev) throw new Error('답할 이벤트가 없습니다');
  const def = eventDef(ev.id)!;
  const ch = def.choices[choice];
  if (!ch) throw new Error('없는 선택지입니다');
  const result = ch.apply(c, ev.vars, new Rng(`${c.league.seed}/event/${ev.year}/${ev.day}/choice`));
  state.log.push({ year: ev.year, day: ev.day, id: ev.id, choice, result });
  state.pending = null;
  return result;
}

/** 그날(day) 그 구단의 관중률 효과 합 */
export function fillBuff(league: Pick<LeagueState, 'events'>, team: number, year: number, day: number): number {
  let s = 0;
  for (const b of league.events?.buffs ?? []) if (b.team === team && b.year === year && day >= b.from && day < b.until) s += b.fill;
  return s;
}

/** 그날(day) 선수별 경기력 값. 효과가 없으면 null (엔진이 아무것도 하지 않는다) */
export function formToday(league: Pick<LeagueState, 'events'>, year: number, day: number,
                          players: { idx: number; id: string; teamIdx: number; isPitcher: boolean }[]): Float64Array | null {
  const act = (league.events?.forms ?? []).filter((f) => f.year === year && day >= f.from && day < f.until);
  if (!act.length) return null;
  const out = new Float64Array(players.length);
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const f of act) {
    if (f.player) { const p = byId.get(f.player); if (p) out[p.idx] += f.edge; continue; }
    for (const p of players) {
      if (p.teamIdx !== f.team) continue;
      if (f.side === 'bat' && p.isPitcher) continue;
      if (f.side === 'pit' && !p.isPitcher) continue;
      out[p.idx] += f.edge;
    }
  }
  return out;
}

/** 그날(day) 선수별 컨디션 사건 값과 사유 (가장 크게 내리는 사건의 사유). 사건이 없으면 null */
export function condToday(league: Pick<LeagueState, 'events'>, year: number, day: number,
                          players: { idx: number; id: string; teamIdx: number }[]): { value: Float64Array; reason: Map<number, string> } | null {
  const act = (league.events?.conds ?? []).filter((f) => f.year === year && day >= f.from && day < f.until);
  if (!act.length) return null;
  const value = new Float64Array(players.length);
  const reason = new Map<number, string>();
  const worst = new Map<number, number>();
  const add = (idx: number, f: CondBuff) => {
    value[idx] += f.value;
    if (f.value < (worst.get(idx) ?? 0)) { worst.set(idx, f.value); reason.set(idx, f.reason); }
  };
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const f of act) {
    if (f.player) { const p = byId.get(f.player); if (p) add(p.idx, f); continue; }
    for (const p of players) if (p.teamIdx === f.team) add(p.idx, f);
  }
  return { value, reason };
}
