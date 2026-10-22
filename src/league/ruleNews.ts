// 개막 "올해 달라지는 규칙" 알림 (docs/리그규칙변경_기획안.md 2장).
//
// 표시 기능이다: (규칙 변경 자료 + 연도 + 게임 규칙 값)만으로 다시 계산하고, 난수를 쓰지 않으며, 저장 형식·조작 기록에 닿지 않는다.
// 리그 운영 항목(엔트리·외국인·FA 연한·캡·연장·포스트시즌)의 전·후 값은 자료에 따로 적지 않고 게임이 실제로 쓰는 값에서 읽는다
// (규칙 값을 고치면 알림도 같이 바뀌어 둘이 어긋나지 않게). 자료의 항목에 키가 없어도 게임 값이 바뀌면 줄을 만든다.

import type { BallYear, Meta, RuleCat, RuleChangeData, RuleChangeItem, RuleEffect, RuleStatus } from '../data/types';
import { dateOf } from '../game/calendar';
import { faEnabled, faServiceNeeded, foreignRule } from './eras';
import { salaryCap } from './salary';
import type { LeagueState } from './types';

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
  /** 시즌 자료가 있는 해: 구단 수·팀당 경기 수 */
  teams?: number;
  games?: number;
  /** 값의 확인 상태 (meta.rules의 *Source: confirmed = 자료집 확인, assumed = 미확인). 자료에 항목이 없을 때 쓴다 */
  sources: Partial<Record<RuleValueKey, RuleStatus>>;
}

/** 그 해 게임 규칙 값. 자료가 없는 해(2027~)는 마지막 해의 meta 값 */
export function ruleSnapshot(meta: Meta, year: number, league?: Pick<LeagueState, 'rules'>, season?: { teams: number; games: number }): RuleSnapshot {
  const ys = meta.years;
  const y = Math.min(Math.max(year, ys[0]), ys[ys.length - 1]);
  const r = meta.rules[String(y)];
  const f = foreignRule(meta, year, league);
  const src = (v?: string | number): RuleStatus => (v === 'confirmed' ? 'confirmed' : 'unknown');
  const cap = salaryCap(year, league);
  return {
    year,
    rosterSize: r?.rosterSize ?? 26,
    foreignTotal: f.total,
    foreignAsia: f.asia,
    maxInnings: r?.maxInnings ?? 12,
    postseasonTeams: r?.postseasonTeams ?? 4,
    faEnabled: faEnabled(year),
    faServiceHs: faServiceNeeded(year, false),
    faServiceUniv: faServiceNeeded(year, true),
    salaryCap: cap,
    ...(season ? { teams: season.teams, games: season.games } : {}),
    sources: {
      rosterSize: src(r?.rosterSizeSource), foreignLimit: src(r?.foreignLimitSource), maxInnings: src(r?.maxInningsSource),
      postseasonTeams: src(r?.postseasonTeamsSource),
      // 캡: 2023~2028은 발표값(자료집 확인), 그 뒤는 매년 5% 상향 (임시값)
      salaryCap: cap === null || year <= 2028 ? 'confirmed' : 'unknown',
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
}

/** 위 칸 분류 순서 (2.2): 공인구 → 경기 → 엔트리·외국인 → FA·드래프트·캡 → 리그 운영 */
const CAT_ORDER: RuleCat[] = ['ball', 'game', 'roster', 'foreign', 'fa', 'draft', 'cap', 'league'];
export const CAT_LABEL: Record<RuleCat, string> = {
  ball: '공인구', game: '경기 규칙', roster: '엔트리·선수단', foreign: '외국인 선수', fa: 'FA', draft: '드래프트', cap: '샐러리캡', league: '리그 운영',
};
export const EFFECT_LABEL: Record<RuleEffect, string> = {
  show: '표시만', 'show-env': '표시만 (게임은 그 해 리그 평균으로 반영)', league: '리그 운영에 반영', engine: '경기에 반영',
};
export const STATUS_LABEL: Record<RuleStatus, string> = { confirmed: '자료집 확인', research: '조사값', conflict: '출처 갈림', unknown: '미확인' };
export const STATUS_HELP: Record<RuleStatus, string> = {
  confirmed: '자료집 "제도연표"에서 출처를 확인한 값',
  research: '웹 조사 값, 자료집 제도연표 확인 전',
  conflict: '출처끼리 값이 갈린다',
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
    if (now.games !== undefined && prev.games !== undefined && now.games !== prev.games) {
      lines.push({ cat: 'league', title: '팀당 경기 수', before: `${prev.games}경기`, after: `${now.games}경기`, effect: 'league', status: 'confirmed', source: '시즌 자료' });
    }
    if (now.teams !== undefined && prev.teams !== undefined && now.teams !== prev.teams) {
      lines.push({ cat: 'league', title: '1군 구단 수', before: `${prev.teams}구단`, after: `${now.teams}구단`, effect: 'league', status: 'confirmed', source: '시즌 자료' });
    }
  }

  // 공인구 줄 (위 칸 맨 앞)
  const ball = ballLine(data, year, input.seasonDays, dated, closing, !!input.start);
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
  return { year, start: !!input.start, main, other, summary, dated, closing, headline, ...(lastSeason ? { lastSeason } : {}) };
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
