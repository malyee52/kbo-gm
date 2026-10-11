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

/** 하루 확률의 처음 값, 하루마다 오르는 폭, 최대 */
export const EVENT_BASE = 0.01;
export const EVENT_STEP = 0.004;
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

export interface EventState {
  /** 오늘 확률 */
  chance: number;
  pending: PendingEvent | null;
  log: EventLog[];
  buffs: FillBuff[];
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
}

const eok = (man: number) => `${(man / 10000).toFixed(1)}억 원`;
const num = (v: PendingEvent['vars'], k: string) => Number(v[k]);

/** 2군 유망주 (24세 이하, 잠재력 높은 순) */
function prospects(c: EventContext): LeaguePlayer[] {
  return c.roster.filter((p) => !p.foreign && p.birthYear !== null && c.year - p.birthYear <= 24 && p.military?.state !== 'serving')
    .sort((a, b) => b.potential - a.potential || a.id.localeCompare(b.id));
}

export const EVENTS: EventDef[] = [
  {
    id: 'sponsor-patch', title: '유니폼 광고 제안', weight: 10,
    vars: (c, rng) => ({ amount: Math.round((40_000 + rng.range(0, 60_000)) * (c.winPct >= 0.55 ? 1.3 : 1)) }),
    text: (c, v) => `한 기업이 남은 시즌 동안 ${c.teamName} 유니폼 소매 광고를 하고 싶다며 ${eok(num(v, 'amount'))}을 제안했습니다. 구단주는 모기업과 업종이 겹친다며 달가워하지 않습니다.`,
    choices: [
      { label: '정중히 거절한다', note: () => '변화 없음', apply: () => '제안을 거절했습니다.' },
      { label: '받아들인다', note: (_c, v) => `자금 +${eok(num(v, 'amount'))}, 구단주 신뢰도 −2`,
        apply: (c, v) => { c.addCash(num(v, 'amount'), '유니폼 광고'); c.addTrust(-2); return `광고 계약으로 ${eok(num(v, 'amount'))}을 받았습니다. 구단주는 못마땅해합니다.`; } },
    ],
  },
  {
    id: 'parent-bonus', title: '모기업 격려금', weight: 6,
    when: (c) => c.rank <= 3,
    vars: (_c, rng) => ({ amount: Math.round(80_000 + rng.range(0, 70_000)) }),
    text: (c, v) => `${c.rank}위로 순항하자 모기업이 ${eok(num(v, 'amount'))}의 격려금을 보내겠다고 합니다. 받으면 구단주의 기대도 함께 높아집니다.`,
    choices: [
      { label: '감사히 받는다', note: (_c, v) => `자금 +${eok(num(v, 'amount'))}`, apply: (c, v) => { c.addCash(num(v, 'amount'), '모기업 격려금'); return '격려금을 받았습니다.'; } },
      { label: '성적으로 보답하겠다며 사양한다', note: () => '구단주 신뢰도 +3', apply: (c) => { c.addTrust(3); return '구단주가 단장의 태도를 높이 샀습니다.'; } },
    ],
  },
  {
    id: 'fan-festival', title: '팬 페스티벌 기획', weight: 9,
    vars: (_c, rng) => ({ cost: Math.round(20_000 + rng.range(0, 20_000)) }),
    text: (_c, v) => `마케팅팀이 홈 경기 주간에 팬 페스티벌을 열자고 합니다. 비용은 ${eok(num(v, 'cost'))}입니다.`,
    choices: [
      { label: '이번에는 넘어간다', note: () => '변화 없음', apply: () => '페스티벌은 열지 않았습니다.' },
      { label: '연다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 15일 동안 관중률 +6%p`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '팬 페스티벌'); c.addFill(0.06, 15, '팬 페스티벌'); return '페스티벌로 구장이 북적입니다.'; } },
    ],
  },
  {
    id: 'facility-repair', title: '구장 시설 고장', weight: 7,
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
    id: 'charity-game', title: '지역 자선 행사 요청', weight: 8,
    vars: () => ({ cost: 10_000 }),
    text: (_c, v) => `연고 지역 단체가 자선 행사에 선수단 참여와 ${eok(num(v, 'cost'))} 기부를 요청했습니다.`,
    choices: [
      { label: '정중히 사양한다', note: () => '변화 없음', apply: () => '이번 요청은 사양했습니다.' },
      { label: '참여한다', note: (_c, v) => `자금 −${eok(num(v, 'cost'))}, 구단주 신뢰도 +2, 10일 동안 관중률 +2%p`,
        apply: (c, v) => { c.addCash(-num(v, 'cost'), '지역 자선 행사'); c.addTrust(2); c.addFill(0.02, 10, '자선 행사'); return '지역 사회의 반응이 좋습니다.'; } },
    ],
  },
  {
    id: 'parent-cut', title: '모기업 실적 악화', weight: 5,
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
    id: 'media-criticism', title: '언론의 비판 기사', weight: 7,
    when: (c) => c.rank > Math.ceil(c.teams / 2),
    text: (c) => `${c.rank}위에 머문 ${c.teamName}의 운영을 비판하는 기사가 나왔습니다. 구단주도 기사를 읽었습니다.`,
    choices: [
      { label: '대응하지 않는다', note: () => '구단주 신뢰도 −1', apply: (c) => { c.addTrust(-1); return '조용히 넘어갔습니다.'; } },
      { label: '단장이 직접 인터뷰로 설명한다', note: () => '반반: 신뢰도 +3 / −4',
        apply: (c, _v, rng) => { if (rng.chance(0.5)) { c.addTrust(3); return '인터뷰가 좋은 반응을 얻었습니다.'; } c.addTrust(-4); return '인터뷰가 오히려 논란을 키웠습니다.'; } },
    ],
  },
  {
    id: 'win-streak-event', title: '연승 기념 이벤트', weight: 6,
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
    id: 'naming-offer', title: '응원 굿즈 협업 제안', weight: 8,
    vars: (_c, rng) => ({ amount: Math.round(15_000 + rng.range(0, 25_000)) }),
    text: (c, v) => `한 브랜드가 ${c.teamName}과 응원 굿즈 협업을 제안했습니다. 계약금은 ${eok(num(v, 'amount'))}입니다.`,
    choices: [
      { label: '계약한다', note: (_c, v) => `자금 +${eok(num(v, 'amount'))}`, apply: (c, v) => { c.addCash(num(v, 'amount'), '굿즈 협업'); return '협업 굿즈가 출시됩니다.'; } },
      { label: '구단 이미지와 맞지 않아 거절한다', note: () => '변화 없음', apply: () => '제안을 거절했습니다.' },
    ],
  },
  {
    id: 'ticket-price', title: '입장권 가격 조정 논의', weight: 6,
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
];

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
  const cands = EVENTS.filter((e) => !recent.has(e.id) && (!e.when || e.when(c)));
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
