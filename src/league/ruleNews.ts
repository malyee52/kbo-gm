// 개막 "올해 달라지는 규칙" 알림 (docs/리그규칙변경_기획안.md 2장).
//
// 표시 기능이다: (규칙 변경 자료 + 연도 + 게임 규칙 값)만으로 다시 계산하고, 난수를 쓰지 않으며, 저장 형식·조작 기록에 닿지 않는다.
// 리그 운영 항목(엔트리·외국인·FA 연한·캡·연장·포스트시즌)의 전·후 값은 자료에 따로 적지 않고 게임이 실제로 쓰는 값에서 읽는다
// (규칙 값을 고치면 알림도 같이 바뀌어 둘이 어긋나지 않게). 자료의 항목에 키가 없어도 게임 값이 바뀌면 줄을 만든다.

import type { BallYear, Meta, RuleCat, RuleChangeData, RuleChangeItem, RuleEffect, RuleStatus } from '../data/types';
import { dateOf } from '../game/calendar';
import { faEnabled, faServiceNeeded, foreignRule } from './eras';
import { dollarText, foreignCap, MIN_SALARY_STEP_YEARS, minSalary, ruleStepYear, salaryCap } from './salary';
import type { LeagueState } from './types';
import { FUTURE_RULE_LABEL, futureDelta, futureValueText, type FutureRuleKey, type RuleShift } from './futureRules';
import { BIG_RULE_LABEL, type BigRuleKey, type RuleVoteRecord, type VoteChoice } from '../ai/vote';

/** 게임 규칙 값 키 (tools/build_data.py의 RULE_KEYS와 같아야 한다) */
export const RULE_KEYS = ['rosterSize', 'foreignLimit', 'maxInnings', 'postseasonTeams', 'faEnabled', 'faService', 'salaryCap'] as const;
export type RuleValueKey = (typeof RULE_KEYS)[number];

/** 한 해에 게임이 쓰는 규칙 값 */
export interface RuleSnapshot {
  year: number;
  rosterSize: number;
  foreignTotal: number;
  foreignAsia: number;
  /** 정규시즌 연장 최대 이닝 (0 = 무제한) */
  maxInnings: number;
  postseasonTeams: number;
  /** 그 해 시즌 뒤 FA 제도가 있나 */
  faEnabled: boolean;
  /** 그 해 시즌 뒤 FA 자격 연한 (고졸·대졸) */
  faServiceHs: number;
  faServiceUniv: number;
  /** 샐러리캡 (만 원, 2026년 물가). 없으면 null */
  salaryCap: number | null;
  /** 최저 연봉 (만 원, salary.ts minSalary). 2030년부터 몇 년마다 규정 인상 */
  minSalary?: number;
  /** 외국인 금액 상한 (달러, salary.ts foreignCap): 신규·아시아쿼터 신규·총액 */
  foreignCaps?: { new: number; asia: number; total: number };
  /** 시즌 자료가 있는 해: 구단 수·팀당 경기 수 */
  teams?: number;
  games?: number;
  /** 값의 확인 상태 (meta.rules의 *Source: confirmed = 자료집 확인, assumed = 미확인). 자료에 항목이 없을 때 쓴다 */
  sources: Partial<Record<RuleValueKey, RuleStatus>>;
}

/** 그 해 게임 규칙 값. 자료가 없는 해(2027~)는 마지막 해의 meta 값 */
export function ruleSnapshot(meta: Meta, year: number, league?: Pick<LeagueState, 'rules' | 'ruleShifts'>, season?: { teams: number; games: number }): RuleSnapshot {
  const ys = meta.years;
  const y = Math.min(Math.max(year, ys[0]), ys[ys.length - 1]);
  const r = meta.rules[String(y)];
  const f = foreignRule(meta, year, league);
  const src = (v?: string | number): RuleStatus => (v === 'confirmed' ? 'confirmed' : 'unknown');
  const cap = salaryCap(year, league);
  // 자료 없는 해는 미래 규칙 변경 ② (futureRules.ts)
  const future = year > ys[ys.length - 1];
  const d = (k: FutureRuleKey) => (future ? futureDelta(league, k, year) : 0);
  const capShifted = future && (league?.ruleShifts ?? []).some((s) => s.key === 'capGrowth' && s.year <= year);
  return {
    year,
    rosterSize: (r?.rosterSize ?? 26) + d('roster'),
    foreignTotal: f.total,
    foreignAsia: f.asia,
    maxInnings: (r?.maxInnings ?? 12) + d('extra'),
    postseasonTeams: r?.postseasonTeams ?? 4,
    faEnabled: faEnabled(year),
    faServiceHs: faServiceNeeded(year, false),
    faServiceUniv: faServiceNeeded(year, true),
    salaryCap: cap,
    minSalary: minSalary(year, league),
    foreignCaps: { new: foreignCap(league, 'foreignNewCap', year), asia: foreignCap(league, 'asiaNewCap', year), total: foreignCap(league, 'foreignTotalCap', year) },
    ...(season ? { teams: season.teams, games: season.games } : {}),
    sources: {
      rosterSize: d('roster') ? 'virtual' : src(r?.rosterSizeSource), foreignLimit: d('foreign') ? 'virtual' : src(r?.foreignLimitSource),
      maxInnings: d('extra') ? 'virtual' : src(r?.maxInningsSource),
      postseasonTeams: src(r?.postseasonTeamsSource),
      // 캡: 2023~2028은 발표값(자료집 확인), 그 뒤는 매년 5% 상향 (임시값). 미래 규칙 변경으로 상향률이 바뀐 뒤는 가상 결정
      salaryCap: cap === null || year <= 2028 ? 'confirmed' : capShifted ? 'virtual' : 'unknown',
    },
  };
}

/** 알림 한 줄 */
export interface RuleLine {
  cat: RuleCat;
  title: string;
  /** 전 → 후 (전이 없으면 후만) */
  before?: string;
  after?: string;
  effect: RuleEffect;
  status: RuleStatus;
  source?: string;
  /** 게임이 실제와 다르게 단순화한 내용 */
  simplified?: string;
  note?: string;
  /** 게임 값이 그대로일 때 실제 값 (키 항목) */
  real?: string;
  /** 공인구 줄의 덧붙임 (검사값 등) */
  detail?: string[];
  /** 규칙이 바뀐 것이 아니라 알려 주기만 하는 줄 (기준 그대로인 해의 공인구 검사값). 가짓수에 세지 않는다 */
  info?: boolean;
  key?: RuleValueKey;
  /** 단장 회의 표결 결과 (구단 투표로 정한 미래 규칙 변경) */
  vote?: string;
}

/** 시즌 중 날짜 소식 (개막 뒤 날짜의 규칙 변경, 공인구 2·3차 검사) */
export interface DatedRuleNews {
  /** 일정 색인 */
  day: number;
  text: string;
}

export interface RuleNews {
  year: number;
  /** 시작 연도 (요약을 함께 보인다) */
  start: boolean;
  /** 위 칸: 게임에 반영되는 규칙과 공인구 (분류 순) */
  main: RuleLine[];
  /** 그 밖의 변경: 표시만 하는 항목 전부 */
  other: RuleLine[];
  /** 시작 연도 규칙 요약 (2.4) */
  summary: string[];
  /** 시즌 중 날짜 소식 */
  dated: DatedRuleNews[];
  /** 결산 소식 (발표일을 모르거나 시즌이 끝난 뒤 발표된 공인구 검사) */
  closing: string[];
  /** 소식 한 줄 */
  headline: string;
  /** 지난 시즌 리그 한 줄 */
  lastSeason?: string;
  /** 이 해 적용을 두고 단장 회의에서 부결된 안건 (구단 투표). 가짓수에 세지 않는다 */
  rejected?: string[];
}

export interface RuleNewsInput {
  year: number;
  data?: RuleChangeData;
  /** 그 해와 지난해 게임 규칙 값 */
  now: RuleSnapshot;
  prev?: RuleSnapshot;
  /** 시작 연도면 요약을 붙인다 */
  start?: boolean;
  /** 정규시즌 일정 일수. 이 날 이후의 날짜 소식은 결산 소식으로 (없으면 날짜만 본다) */
  seasonDays?: number;
  /** 게임 안 지난 시즌 리그 기록 (미리 보기가 아니라 지난 결과) */
  lastSeason?: { year: number; runsPerGame: number; hrPerGame: number };
  /** 이 해에 적용되는 미래 규칙 변경 ② (게임 속 가상 결정, futureRules.ts shiftsFor) */
  shifts?: RuleShift[];
  /** 이 해 적용을 두고 단장 회의에서 부결된 안건 (league.ruleVotes 중 passed가 아닌 것) */
  rejected?: RuleVoteRecord[];
  /** 2027년부터 시즌마다 정하는 반발계수 (futureRules.ts seasonCor): 이 해·지난해 값, 기준 범위, 홈런 목표 배율 */
  cor?: { value: number; prev: number | null; range: [number, number]; hrMul: number };
}

/** 미래 규칙 변경 항목 → 알림 분류·반영·게임 규칙 키 */
const SHIFT_LINE: Record<FutureRuleKey, { cat: RuleCat; effect: RuleEffect; key?: RuleValueKey }> = {
  ball: { cat: 'ball', effect: 'engine' }, zone: { cat: 'game', effect: 'engine' }, extra: { cat: 'game', effect: 'engine', key: 'maxInnings' },
  roster: { cat: 'roster', effect: 'league', key: 'rosterSize' }, foreign: { cat: 'foreign', effect: 'league', key: 'foreignLimit' },
  capGrowth: { cat: 'cap', effect: 'league', key: 'salaryCap' },
};

/** 위 칸 분류 순서 (2.2): 공인구 → 경기 → 엔트리·외국인 → FA·드래프트·캡 → 리그 운영 */
const CAT_ORDER: RuleCat[] = ['ball', 'game', 'roster', 'foreign', 'fa', 'draft', 'cap', 'league'];
export const CAT_LABEL: Record<RuleCat, string> = {
  ball: '공인구', game: '경기 규칙', roster: '엔트리·선수단', foreign: '외국인 선수', fa: 'FA', draft: '드래프트', cap: '샐러리캡', league: '리그 운영',
};
export const EFFECT_LABEL: Record<RuleEffect, string> = {
  show: '표시만', 'show-env': '표시만 (게임은 그 해 리그 평균으로 반영)', league: '리그 운영에 반영', engine: '경기에 반영',
};
export const STATUS_LABEL: Record<RuleStatus, string> = { confirmed: '자료집 확인', research: '조사값', conflict: '출처 갈림', unknown: '미확인', virtual: '게임 속 가상 결정' };
export const STATUS_HELP: Record<RuleStatus, string> = {
  confirmed: '자료집 "제도연표"에서 출처를 확인한 값',
  research: '웹 조사 값, 자료집 제도연표 확인 전',
  conflict: '출처끼리 값이 갈린다',
  virtual: '게임이 리그 흐름을 보고 정한 가상 결정 (실제 KBO 결정이 아님)',
  unknown: '확인하지 못한 값',
};

/** 위 칸에 들어가나: 공인구, 리그 운영·경기 반영 항목 */
export function isMainLine(l: Pick<RuleLine, 'cat' | 'effect'>): boolean {
  return l.cat === 'ball' || l.effect === 'league' || l.effect === 'engine';
}

const KEY_CAT: Record<RuleValueKey, RuleCat> = {
  rosterSize: 'roster', foreignLimit: 'foreign', maxInnings: 'league', postseasonTeams: 'league', faEnabled: 'fa', faService: 'fa', salaryCap: 'cap',
};
const KEY_TITLE: Record<RuleValueKey, string> = {
  rosterSize: '1군 엔트리', foreignLimit: '외국인 보유 한도', maxInnings: '정규시즌 연장 최대 이닝', postseasonTeams: '포스트시즌 진출 구단',
  faEnabled: 'FA 제도 (시즌 뒤)', faService: 'FA 자격 연한 (시즌 뒤)', salaryCap: '샐러리캡',
};

/** 만 원 표기 (3,000만 원) */
const manText = (man: number) => `${man.toLocaleString('ko-KR')}만 원`;

/** 억 원 표기 (만 원 단위 값) */
function eokText(man: number): string {
  const eok = Math.floor(man / 10000);
  const rest = man % 10000;
  return rest ? `${eok}억 ${rest}만 원` : `${eok}억 원`;
}

/** 게임 값을 글로 (키마다 같은 모양) */
export function keyValueText(key: RuleValueKey, s: RuleSnapshot): string {
  switch (key) {
    case 'rosterSize': return `${s.rosterSize}명`;
    case 'foreignLimit': return s.foreignTotal === 0 ? '없음' : s.foreignAsia ? `${s.foreignTotal}명 (아시아쿼터 ${s.foreignAsia}명 포함)` : `${s.foreignTotal}명`;
    case 'maxInnings': return s.maxInnings === 0 ? '무제한 (무승부 없음)' : `${s.maxInnings}회`;
    case 'postseasonTeams': return `${s.postseasonTeams}팀`;
    case 'faEnabled': return s.faEnabled ? '있음' : '없음';
    case 'faService': return !s.faEnabled ? '없음' : s.faServiceHs === s.faServiceUniv ? `1군 ${s.faServiceHs}시즌` : `고졸 ${s.faServiceHs}·대졸 ${s.faServiceUniv}시즌`;
    case 'salaryCap': return s.salaryCap === null ? '없음' : eokText(s.salaryCap);
  }
}

/** 공인구: 그 해까지의 기준 범위·단일 여부 (바뀐 해의 값이 이어진다) */
export function ballState(data: RuleChangeData | undefined, year: number): { range?: [number, number]; single: boolean; status: RuleStatus } {
  let range: [number, number] | undefined;
  let single = false;
  let status: RuleStatus = 'unknown';
  for (const b of data?.ball ?? []) {
    if (b.year > year) break;
    if (b.range) { range = b.range; status = b.status; }
    if (b.single !== undefined) single = b.single;
  }
  return { range, single, status };
}

const rangeText = (r?: [number, number]) => (r ? `${r[0].toFixed(4)}~${r[1].toFixed(4)}` : '알 수 없음');
const mmdd = (s: string) => { const [m, d] = s.split('-').map(Number); return { m, d }; };
const mdText = (s: string) => { const { m, d } = mmdd(s); return `${m}월 ${d}일`; };

/** MM-DD 날짜의 일정 색인 (개막일 0). 개막 전이면 음수 */
export function dayOfDate(year: number, date: string): number {
  const o = dateOf(year, 0);
  const { m, d } = mmdd(date);
  return Math.round((Date.UTC(year, m - 1, d) - Date.UTC(o.year, o.month - 1, o.date)) / 86400000);
}

type Test = NonNullable<BallYear['tests']>[number];
const testText = (t: Test) => `${t.round}차 수시검사 ${t.avg !== undefined ? `평균 ${t.avg.toFixed(4)}` : '결과'}${t.note ? ` (${t.note})` : ''}`;

/** 그 해 알림 */
export function ruleNews(input: RuleNewsInput): RuleNews {
  const { year, data, now, prev } = input;
  const items = (data?.items ?? []).filter((it) => it.year === year);
  const lines: RuleLine[] = [];
  const dated: DatedRuleNews[] = [];
  const closing: string[] = [];
  const usedKeys = new Set<RuleValueKey>();

  const toLine = (it: RuleChangeItem): RuleLine => {
    const line: RuleLine = { cat: it.cat, title: it.title, effect: it.effect, status: it.status };
    if (it.source) line.source = it.source;
    if (it.simplified) line.simplified = it.simplified;
    if (it.note) line.note = it.note;
    const key = (RULE_KEYS as readonly string[]).includes(it.key ?? '') ? (it.key as RuleValueKey) : undefined;
    if (key) {
      line.key = key;
      usedKeys.add(key);
      const a = keyValueText(key, now);
      const b = prev ? keyValueText(key, prev) : undefined;
      if (b !== undefined && b !== a) { line.before = b; line.after = a; }
      else {
        // 게임 값은 그대로: 게임 값을 보이고 실제 바뀐 값은 따로
        line.after = `게임 ${a}`;
        if (it.after) line.real = it.before ? `${it.before} → ${it.after}` : it.after;
      }
    } else {
      if (it.before) line.before = it.before;
      if (it.after) line.after = it.after;
    }
    return line;
  };

  for (const it of items) {
    const line = toLine(it);
    if (it.date && dayOfDate(year, it.date) > 0) {
      const day = dayOfDate(year, it.date);
      const text = `[규칙] ${mdText(it.date)}부터 ${lineText(line)}`;
      if (input.seasonDays !== undefined && day >= input.seasonDays) closing.push(text);
      else dated.push({ day, text });
      continue;
    }
    lines.push(line);
  }

  // 미래 규칙 변경 ② (게임 속 가상 결정). 같은 게임 규칙 키의 자동 줄은 만들지 않는다
  for (const s of input.shifts ?? []) {
    const m = SHIFT_LINE[s.key];
    if (m.key) usedKeys.add(m.key);
    lines.push({
      cat: m.cat, title: `${FUTURE_RULE_LABEL[s.key]} (게임 속 가상 결정)`, before: futureValueText(s.key, s.before), after: futureValueText(s.key, s.after),
      effect: m.effect, status: 'virtual', note: s.reason, ...(m.key ? { key: m.key } : {}),
      ...(s.vote ? { vote: voteResultText(s.vote, true) } : {}),
    });
  }

  // 자료에 없는 게임 값 변화
  if (prev) {
    for (const key of RULE_KEYS) {
      if (usedKeys.has(key)) continue;
      const a = keyValueText(key, now);
      const b = keyValueText(key, prev);
      if (a === b) continue;
      const status = now.sources[key] ?? 'unknown';
      lines.push({
        cat: KEY_CAT[key], title: KEY_TITLE[key], before: b, after: a, effect: 'league', status, key,
        note: key === 'salaryCap' && status !== 'confirmed' ? '발표값 없음: 게임은 매년 5% 상향 (임시값)' : '게임 규칙 값의 변화',
      });
    }
    // 규정 인상 (최저 연봉·외국인 금액 상한, salary.ts ruleStepIndex): 게임 속 가상 결정
    // 인상 해에만 (자유 모드에서 규정을 직접 바꾼 것은 여기서 알리지 않는다)
    const stepped = ruleStepYear(year) === year;
    const stepNote = `${MIN_SALARY_STEP_YEARS}년마다 그동안 오른 연봉만큼 규정을 올린다 (게임 속 가상 결정, 임시값)`;
    if (stepped && now.minSalary !== undefined && prev.minSalary !== undefined && now.minSalary !== prev.minSalary) {
      lines.push({ cat: 'league', title: '최저 연봉 인상', before: manText(prev.minSalary), after: manText(now.minSalary), effect: 'league', status: 'virtual', note: stepNote });
    }
    const fc = (c: NonNullable<RuleSnapshot['foreignCaps']>) => `신규 ${dollarText(c.new)} · 아시아쿼터 신규 ${dollarText(c.asia)} · 총액 ${dollarText(c.total)}`;
    if (stepped && now.foreignCaps && prev.foreignCaps && fc(now.foreignCaps) !== fc(prev.foreignCaps)) {
      lines.push({ cat: 'foreign', title: '외국인 금액 상한 인상', before: fc(prev.foreignCaps), after: fc(now.foreignCaps), effect: 'league', status: 'virtual', note: stepNote });
    }
    if (now.games !== undefined && prev.games !== undefined && now.games !== prev.games) {
      lines.push({ cat: 'league', title: '팀당 경기 수', before: `${prev.games}경기`, after: `${now.games}경기`, effect: 'league', status: 'confirmed', source: '시즌 자료' });
    }
    if (now.teams !== undefined && prev.teams !== undefined && now.teams !== prev.teams) {
      lines.push({ cat: 'league', title: '1군 구단 수', before: `${prev.teams}구단`, after: `${now.teams}구단`, effect: 'league', status: 'confirmed', source: '시즌 자료' });
    }
  }

  // 공인구 줄 (위 칸 맨 앞). 2027년부터는 게임이 정한 그 해 반발계수
  const ball = input.cor ? corLine(withRealPrev(input.cor, data, year), year, input.seasonDays, dated) : ballLine(data, year, input.seasonDays, dated, closing, !!input.start);
  if (ball) lines.unshift(ball);

  const ordered = (ls: RuleLine[]) => ls.map((l, i) => ({ l, i })).sort((a, b) => CAT_ORDER.indexOf(a.l.cat) - CAT_ORDER.indexOf(b.l.cat) || a.i - b.i).map((x) => x.l);
  const main = ordered(lines.filter(isMainLine));
  const other = ordered(lines.filter((l) => !isMainLine(l)));
  dated.sort((a, b) => a.day - b.day);
  const summary = input.start ? ruleSummary(data, now) : [];
  const changes = [...main, ...other].filter((l) => !l.info);
  const total = changes.length;
  const headline = input.start
    ? `${year} 시즌 리그 규칙 (시작 연도 요약${total ? `, 이 해 바뀐 것 ${total}가지` : ''})`
    : total === 0
      ? `${year} 시즌: 지난해와 달라진 규칙이 없습니다.`
      : `${year} 시즌: 달라지는 규칙 ${total}가지 — ${changes[0].title}${total > 1 ? ' 외' : ''}`;
  const ls = input.lastSeason;
  const lastSeason = ls ? `지난 시즌(${ls.year}) 리그: 경기당 득점 ${ls.runsPerGame.toFixed(2)}점, 경기당 홈런 ${ls.hrPerGame.toFixed(2)}개` : undefined;
  const rejected = (input.rejected ?? []).filter((v) => !v.passed).map((v) => `${voteAgendaText(v)} · ${voteResultText(v, false)}`);
  return { year, start: !!input.start, main, other, summary, dated, closing, headline, ...(lastSeason ? { lastSeason } : {}), ...(rejected.length ? { rejected } : {}) };
}

/** 표결 결과 한 줄: "단장 회의 7 : 3 가결 (문턱 7, 우리 구단 반대)". user가 없으면 모든 구단 AI (우리 표 줄 없음) */
export function voteResultText(v: { yes: number; no: number; need: number; user?: VoteChoice; userTeam?: number }, passed: boolean): string {
  const mine = v.user ? `, 우리 구단 ${v.user === 'yes' ? '찬성' : '반대'}` : v.userTeam !== undefined ? ', 우리 구단 반대 (표를 내지 않음)' : '';
  return `단장 회의 찬성 ${v.yes} : 반대 ${v.no} ${passed ? '가결' : '부결'} (문턱 ${v.need}${mine})`;
}

/** 안건 이름과 전 → 후: "샐러리캡 연간 상향률 연 5% → 연 7%" */
export function voteAgendaText(v: Pick<RuleVoteRecord, 'key' | 'big' | 'before' | 'after'>): string {
  if (v.big) return `${BIG_RULE_LABEL[v.key as BigRuleKey]} ${v.before} → ${v.after}`;
  const k = v.key as FutureRuleKey;
  return `${FUTURE_RULE_LABEL[k]} ${futureValueText(k, v.before)} → ${futureValueText(k, v.after)}`;
}

/** 공인구 줄. 기준·단일 여부가 바뀌었거나 개막 전 발표 검사값이 있을 때 (시작 연도는 늘) */
function ballLine(data: RuleChangeData | undefined, year: number, seasonDays: number | undefined, dated: DatedRuleNews[], closing: string[], start: boolean): RuleLine | null {
  if (!data?.ball.length) return null;
  const cur = ballState(data, year);
  const last = ballState(data, year - 1);
  const by = data.ball.find((b) => b.year === year);
  const lastBy = data.ball.find((b) => b.year === year - 1);
  const detail: string[] = [];
  const rangeChanged = !!by?.range && year > data.ball[0].year;
  const singleChanged = by?.single !== undefined && year > data.ball[0].year && by.single !== last.single;
  if (by?.note && (rangeChanged || start)) detail.push(by.note);
  if (singleChanged) detail.push(`${last.single ? '단일' : '복수'} → ${cur.single ? '단일' : '복수'} 공인구`);
  // 검사값: 개막일 이전(같은 날 포함) 발표만 개막 때, 시즌 중은 그 날짜 소식, 날짜를 모르거나 시즌 뒤는 결산 소식
  const lastFirst = lastBy?.tests?.find((t) => t.round === 1 && t.avg !== undefined);
  for (const t of by?.tests ?? []) {
    const day = t.date ? dayOfDate(year, t.date) : undefined;
    if (day !== undefined && day <= 0) {
      detail.push(`${testText(t)}, ${mdText(t.date!)} 발표${t.round === 1 && lastFirst?.avg !== undefined ? ` (지난해 1차 ${lastFirst.avg.toFixed(4)})` : ''}`);
    } else if (day !== undefined && (seasonDays === undefined || day < seasonDays)) {
      dated.push({ day, text: `[공인구] ${year} ${testText(t)} 발표 (기준 ${rangeText(cur.range)}, 조사값)` });
    } else {
      closing.push(`[공인구] ${year} 시즌 ${testText(t)}${t.date ? ` (${mdText(t.date)} 발표)` : ' (발표일 모름)'}, 기준 ${rangeText(cur.range)} (조사값)`);
    }
  }
  if (!rangeChanged && !singleChanged && !detail.length && !start) return null;
  // 2018년까지는 공표된 검사가 드물다 (그 밖은 비공개)
  if (!by?.tests?.length && start && year < 2019 && !detail.some((d) => d.includes('공표 없음'))) detail.push('검사 결과 공표 없음');
  const dir = rangeChanged && last.range && cur.range ? (cur.range[1] < last.range[1] ? ' 하향' : cur.range[1] > last.range[1] ? ' 상향' : '') : '';
  const line: RuleLine = {
    cat: 'ball', title: `공인구 반발계수 기준${dir}`, effect: 'show-env', status: by?.status ?? cur.status, detail,
    after: `${rangeText(cur.range)}${cur.single ? ' (단일 공인구)' : ''}`,
  };
  if (rangeChanged) line.before = rangeText(last.range);
  if (!rangeChanged && !singleChanged) line.info = true;
  const src = by?.source ?? data.ball.find((b) => b.range)?.source;
  if (src) line.source = src;
  return line;
}

/**
 * 지난해 게임 값이 없으면(2027년: 2026년은 실제 자료의 해) 자료(data-src/공인구.csv → rule_changes.json)의 지난해 1차 수시검사 평균을 "전"으로.
 * 바뀌는 수치는 늘 전 → 후로 보인다 (2026-10-22 사용자 결정)
 */
function withRealPrev(c: NonNullable<RuleNewsInput['cor']>, data: RuleChangeData | undefined, year: number): NonNullable<RuleNewsInput['cor']> & { prevReal?: boolean } {
  if (c.prev !== null) return c;
  const avg = data?.ball.find((b) => b.year === year - 1)?.tests?.find((t) => t.round === 1 && t.avg !== undefined)?.avg;
  return avg === undefined ? c : { ...c, prev: avg, prevReal: true };
}

/** 2027년부터: 그 해 반발계수 줄 (개막)과 시즌 중 2차 수시검사 소식 (게임 속 가상 검사, 임시값) */
function corLine(c: NonNullable<RuleNewsInput['cor']> & { prevReal?: boolean }, year: number, seasonDays: number | undefined, dated: DatedRuleNews[]): RuleLine {
  const dir = c.prev === null ? '' : c.value > c.prev ? ' (상승)' : c.value < c.prev ? ' (하락)' : '';
  const feel = c.hrMul >= 1.15 ? '타구가 멀리 뻗는다' : c.hrMul <= 0.87 ? '타구가 담장 앞에서 잡힌다' : '예년 수준';
  const day = dayOfDate(year, '06-15');
  if (day > 0 && (seasonDays === undefined || day < seasonDays)) {
    dated.push({ day, text: `[공인구] ${year} 2차 수시검사 평균 ${c.value.toFixed(4)} (기준 ${rangeText(c.range)}, 홈런 기준 ×${c.hrMul.toFixed(2)}, 게임 속 가상 검사)` });
  }
  return {
    cat: 'ball', title: `반발계수 변경${dir}`, effect: 'engine', status: 'virtual',
    ...(c.prev !== null ? { before: c.prev.toFixed(4) } : {}),
    after: c.value.toFixed(4),
    detail: [
      `1차 수시검사 평균 ${c.value.toFixed(4)} (기준 ${rangeText(c.range)})${c.prevReal && c.prev !== null ? `, 지난해 ${year - 1} 실제 1차 ${c.prev.toFixed(4)} (조사값)` : ''}`,
      `리그 홈런 기준 ×${c.hrMul.toFixed(2)} — ${feel}`,
    ],
    note: '시즌마다 공 반발계수가 실제 검사값의 퍼짐(2018~2026년 0.406~0.425) 안에서 바뀐다 (게임 속 가상 검사)',
  };
}

/** 시작 연도 규칙 요약 (2.4): 게임 값 + 공인구. 게임이 실제와 다른 곳은 그 해 자료 항목의 단순화 문구로 밝힌다 */
export function ruleSummary(data: RuleChangeData | undefined, s: RuleSnapshot): string[] {
  const out: string[] = [];
  if (s.teams !== undefined && s.games !== undefined) out.push(`${s.teams}구단, 팀당 ${s.games}경기 (게임은 단일 시즌으로 진행)`);
  out.push(`1군 엔트리 ${keyValueText('rosterSize', s)}. 정규시즌 연장 ${keyValueText('maxInnings', s)}. 포스트시즌 ${keyValueText('postseasonTeams', s)}`);
  out.push(s.foreignTotal ? `외국인 선수 ${keyValueText('foreignLimit', s)}` : '외국인 선수 없음 (1998년 도입)');
  out.push(s.faEnabled ? `FA 자격 ${keyValueText('faService', s)}` : 'FA 없음 (1999년 시즌 뒤 도입)');
  out.push(s.salaryCap === null ? (s.year < 2023 ? '샐러리캡 없음 (2023년 도입)' : '샐러리캡 없음') : `샐러리캡 ${keyValueText('salaryCap', s)} (연봉 상위 40명)`);
  const b = ballState(data, s.year);
  if (b.range) out.push(`공인구: ${b.single ? '단일' : '복수'} 공인구, 반발계수 기준 ${rangeText(b.range)}${STATUS_LABEL[b.status] === '조사값' ? ' (조사값)' : ''}`);
  return out;
}

/** 줄 하나를 소식용 글로 */
export function lineText(l: RuleLine): string {
  const change = l.before ? `${l.before} → ${l.after ?? ''}` : l.after ?? '';
  return `${l.title}${change ? `: ${change}` : ''}${l.real ? ` (실제 ${l.real})` : ''}`;
}

/** 오프시즌 "개막 준비" 카드용: 다음 시즌 위 칸 중 오프시즌 결정에 닿는 것(FA·외국인·캡·엔트리)을 앞으로 */
export function previewOrder(news: RuleNews): RuleLine[] {
  const early: RuleCat[] = ['fa', 'foreign', 'cap', 'roster'];
  return [...news.main].sort((a, b) => Number(!early.includes(a.cat)) - Number(!early.includes(b.cat)));
}
