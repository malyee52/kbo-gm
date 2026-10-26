// 선수 칭호 (칭호 기획안 docs/칭호_기획안.md, 2026-10-26): 기록·타이틀·수상·커리어로 붙는 효과 없는 명예 이름표.
// - 공개 기록만 읽는다: 시즌 기록, 부문 1위, 시상, 통산, 소속 구단, 나이, 우승. 능력·잠재·성장 성향·숨은 특수능력·스카우트 오차는 읽지 않는다
//   (이 파일은 ratings·potential·traits를 가져오지 않는다, tests/titles.test.ts가 검사).
// - 엔진·AI 가치·연봉·관중은 칭호를 보지 않는다. 난수를 쓰지 않는다 (같은 기록이면 같은 칭호).
// - 결산 때 판정해 league.titles에 쌓는다 (judgeTitles). 시작 때는 시작 해 전 실제 기록으로 채운다 (startTitles, 결정 7).
//   예전 저장에는 칸이 없어 불러올 때 한 번 채운다 (ensureTitles).
// 조건 숫자는 tools/title_dist.ts로 잰 값이다 (reports/title-dist*.md). 레전드 칭호 이름·주인·출처는 데이터 표(legend_titles.json)이고 조건은 여기 LEGEND_RULES.

import type { DataStore, LegendTitleRow, RealAward } from '../data/types';
import { emptyBatLine, emptyPitLine } from '../engine';
import { realYearbook } from './history';
import type { LeaguePlayer, LeagueState, SeasonLine } from './types';
import { batWarOf, pitWarOf, realEnv } from './war';

type Store = Pick<DataStore, 'meta' | 'season' | 'players' | 'realAwards' | 'legendTitles'>;

/** 얻은 칭호 한 건. 같은 칭호를 여러 해 얻으면 해마다 한 건 (횟수 = 건수) */
export interface TitleRecord {
  id: string;
  key: string;
  year: number;
}

// ---- 판정 재료: 한 선수의 한 시즌 (tools/title_dist.ts의 S와 같은 셈)

interface Bat { g: number; pa: number; ab: number; r: number; h: number; d: number; t: number; hr: number; rbi: number; bb: number; hbp: number; sf: number; so: number; sb: number }
interface Pit { g: number; gs: number; w: number; l: number; sv: number; hld: number; outs: number; so: number; er: number; bb: number; h: number }
const emptyBat = (): Bat => ({ g: 0, pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, hbp: 0, sf: 0, so: 0, sb: 0 });
const emptyPit = (): Pit => ({ g: 0, gs: 0, w: 0, l: 0, sv: 0, hld: 0, outs: 0, so: 0, er: 0, bb: 0, h: 0 });
function addTo<T extends object>(a: T, b: object): void {
  for (const k of Object.keys(a) as (keyof T)[]) (a as Record<keyof T, number>)[k] += Number((b as Record<string, unknown>)[k as string] ?? 0) || 0;
}

/** 한 선수의 한 시즌 */
export interface TitleSeason {
  id: string; year: number; pitcher: boolean;
  /** 만 나이 (생년을 모르거나 추정값이면 null: 나이 칭호를 주지 않는다) */
  age: number | null;
  /** 그 해 마지막 소속 구단 계보 */
  fr: string;
  /** 주 포지션 (실제는 선수 마스터, 게임은 리그 선수) */
  pos: string | null;
  throws: 'R' | 'L' | null; bats: string | null; foreign: boolean; underhand: boolean;
  bat: Bat; pit: Pit;
  /** 시즌 가치 (war.ts, 명예의 전당과 같은 셈) */
  war: number;
  qBat: boolean; qPit: boolean;
  /** 부문 1위 (공동 포함). 'ip'는 이닝 1위 (레전드 조건용, 시상 부문 아님) */
  lead: Set<string>;
  mvp: boolean; gg: string | null; rookie: boolean; champ: boolean; ksMvp: boolean; psMvp: boolean;
  /** 리그 평균자책 대비 (규정이닝) */
  eraRel: number | null;
}

const avg = (b: Bat) => (b.ab ? b.h / b.ab : 0);
const obp = (b: Bat) => { const d = b.ab + b.bb + b.hbp + b.sf; return d ? (b.h + b.bb + b.hbp) / d : 0; };
const slg = (b: Bat) => (b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0);
const ops = (b: Bat) => obp(b) + slg(b);
const era = (p: Pit) => (p.outs ? (p.er * 27) / p.outs : 99);

/** 타이틀 부문 (awards.ts 시상 부문과 같은 판정) */
export const LEAD_KEYS = ['avg', 'hr', 'rbi', 'r', 'h', 'sb', 'obp', 'slg', 'w', 'era', 'so', 'sv', 'hld', 'wpct'] as const;
export type LeadKey = typeof LEAD_KEYS[number];
export const LEAD_NAME: Record<LeadKey, string> = {
  avg: '타격왕', hr: '홈런왕', rbi: '타점왕', r: '득점왕', h: '최다안타왕', sb: '도루왕', obp: '출루왕', slg: '장타왕',
  w: '다승왕', era: '평균자책왕', so: '탈삼진왕', sv: '구원왕', hld: '홀드왕', wpct: '승률왕',
};
const LEAD_COND: Record<LeadKey, string> = {
  avg: '타율 1위 (규정타석)', hr: '홈런 1위', rbi: '타점 1위', r: '득점 1위', h: '안타 1위', sb: '도루 1위', obp: '출루율 1위 (규정타석)', slg: '장타율 1위 (규정타석)',
  w: '다승 1위', era: '평균자책점 1위 (규정이닝)', so: '탈삼진 1위', sv: '세이브 1위', hld: '홀드 1위 (2000년부터)', wpct: '승률 1위 (10승 이상)',
};

/** 한 해 선수들의 규정·부문 1위·리그 평균자책 대비를 채운다 (awards.ts seasonAwards의 타이틀과 같은 규칙) */
function markYear(xs: TitleSeason[], games: number): void {
  const qPa = Math.ceil(3.1 * games);
  const qOuts = 3 * games;
  for (const s of xs) { s.qBat = !s.pitcher && s.bat.pa >= qPa; s.qPit = s.pitcher && s.pit.outs >= qOuts; }
  const bats = xs.filter((s) => !s.pitcher);
  const qb = bats.filter((s) => s.qBat);
  const pits = xs.filter((s) => s.pitcher);
  const qp = pits.filter((s) => s.qPit);
  const year = xs[0]?.year ?? 0;
  const lead = (key: string, pool: TitleSeason[], v: (s: TitleSeason) => number, low = false) => {
    if (!pool.length) return;
    const best = pool.reduce((m, s) => (low ? Math.min(m, v(s)) : Math.max(m, v(s))), low ? Infinity : -Infinity);
    if (!Number.isFinite(best) || (!low && best <= 0)) return;
    for (const s of pool) if (Math.abs(v(s) - best) < 1e-9) s.lead.add(key);
  };
  lead('avg', qb, (s) => avg(s.bat)); lead('obp', qb, (s) => obp(s.bat)); lead('slg', qb, (s) => slg(s.bat));
  lead('hr', bats, (s) => s.bat.hr); lead('rbi', bats, (s) => s.bat.rbi); lead('r', bats, (s) => s.bat.r);
  lead('h', bats, (s) => s.bat.h); lead('sb', bats, (s) => s.bat.sb);
  lead('w', pits, (s) => s.pit.w); lead('era', qp, (s) => era(s.pit), true); lead('so', pits, (s) => s.pit.so);
  lead('sv', pits, (s) => s.pit.sv);
  if (year >= 2000) lead('hld', pits, (s) => s.pit.hld);
  lead('wpct', pits.filter((s) => s.pit.w >= 10), (s) => s.pit.w / (s.pit.w + s.pit.l));
  lead('ip', pits, (s) => s.pit.outs);
  let er = 0, outs = 0;
  for (const s of pits) { er += s.pit.er; outs += s.pit.outs; }
  const lgEra = outs ? (er * 27) / outs : 4.5;
  for (const s of qp) s.eraRel = era(s.pit) / lgEra;
}

// ---- 누적

interface Cum { bat: Bat; pit: Pit; war: number; seasons: number; lead: Record<string, number>; mvp: number; fr: Record<string, number>; hist: TitleSeason[] }
const emptyCum = (): Cum => ({ bat: emptyBat(), pit: emptyPit(), war: 0, seasons: 0, lead: {}, mvp: 0, fr: {}, hist: [] });
function addSeason(c: Cum, s: TitleSeason): void {
  addTo(c.bat, s.bat); addTo(c.pit, s.pit); c.war += s.war; c.seasons += 1;
  for (const k of s.lead) c.lead[k] = (c.lead[k] ?? 0) + 1;
  c.mvp += +s.mvp;
  if (s.fr) c.fr[s.fr] = (c.fr[s.fr] ?? 0) + 1;
  c.hist.push(s);
}
const leads = (c: Cum, ...ks: string[]) => ks.reduce((n, k) => n + (c.lead[k] ?? 0), 0);
const titleTotal = (c: Cum) => LEAD_KEYS.reduce((n, k) => n + (c.lead[k] ?? 0), 0);
const streak = (h: TitleSeason[], ok: (s: TitleSeason) => boolean) => {
  let best = 0, cur = 0, prev = -9;
  for (const s of h) { cur = ok(s) && s.year === prev + 1 ? cur + 1 : ok(s) ? 1 : 0; prev = s.year; best = Math.max(best, cur); }
  return best;
};
const countIf = (h: TitleSeason[], ok: (s: TitleSeason) => boolean) => h.filter(ok).length;
const ggAt = (c: Cum, pos: string) => countIf(c.hist, (s) => s.gg === pos);
const firstN = (c: Cum, n: number, f: (s: TitleSeason) => number) => c.hist.slice(0, n).reduce((a, s) => a + f(s), 0);

// ---- 칭호 표

/** 등급: 1~3 = 별 개수, 'L' = 레전드, 0 = 칩 없음 (이력에만, 우승 1·2회) */
export type TitleTier = 0 | 1 | 2 | 3 | 'L';
export type TitleGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'L';
export const GROUP_LABEL: Record<TitleGroup, string> = {
  A: '타이틀', B: '시즌 기록', C: '통산', D: '수상', E: '구단', F: '가을야구', G: '롱런', H: '다관왕', L: '레전드',
};

type Test = (s: TitleSeason, c: Cum) => boolean;
/** 표에 있는 칭호 하나 (A·D·F 일부·E 프랜차이즈 스타는 키가 갈려 아래 함수가 이름을 만든다) */
interface TitleDef { key: string; group: TitleGroup; tier: Exclude<TitleTier, 0 | 'L'>; name: string; cond: string; test: Test; once: boolean; stem?: string }

/** B 시즌 기록 (기획안 4.2). 같은 줄기(stem)는 한 시즌에 가장 높은 칸 하나만 남는다 */
const SEASON_DEFS: TitleDef[] = ([
  ['hr30', 'hr', 1, '서른 아치', '한 시즌 홈런 30개', (s) => s.bat.hr >= 30],
  ['hr40', 'hr', 2, '마흔 아치', '한 시즌 홈런 40개', (s) => s.bat.hr >= 40],
  ['hr50', 'hr', 3, '쉰 아치', '한 시즌 홈런 50개', (s) => s.bat.hr >= 50],
  ['avg330', 'avg', 1, '삼할삼푼', '한 시즌 타율 .330 (규정타석)', (s) => s.qBat && avg(s.bat) >= 0.33],
  ['avg350', 'avg', 2, '삼할오푼', '한 시즌 타율 .350 (규정타석)', (s) => s.qBat && avg(s.bat) >= 0.35],
  ['h200', 'h', 3, '이백 안타', '한 시즌 안타 200개', (s) => s.bat.h >= 200],
  ['rbi100', 'rbi', 1, '백 타점', '한 시즌 타점 100개', (s) => s.bat.rbi >= 100],
  ['rbi120', 'rbi', 2, '백이십 타점', '한 시즌 타점 120개', (s) => s.bat.rbi >= 120],
  ['sb40', 'sb', 2, '마흔 도루', '한 시즌 도루 40개', (s) => s.bat.sb >= 40],
  ['sb50', 'sb', 3, '쉰 도루', '한 시즌 도루 50개', (s) => s.bat.sb >= 50],
  ['ops1000', 'ops', 2, '천 OPS', '한 시즌 OPS 1.000 (규정타석)', (s) => s.qBat && ops(s.bat) >= 1],
  ['hs2020', 'hs', 2, '호타준족', '한 시즌 20홈런-20도루', (s) => s.bat.hr >= 20 && s.bat.sb >= 20],
  ['hs3030', 'hs', 3, '대형 호타준족', '한 시즌 30홈런-30도루', (s) => s.bat.hr >= 30 && s.bat.sb >= 30],
  ['triple', 'triple', 2, '삼박자', '한 시즌 타율 .300 (규정타석) + 30홈런 + 100타점', (s) => s.qBat && avg(s.bat) >= 0.3 && s.bat.hr >= 30 && s.bat.rbi >= 100],
  ['tc', 'tc', 3, '타격 삼관', '같은 해 타율·홈런·타점 1위', (s) => ['avg', 'hr', 'rbi'].every((k) => s.lead.has(k))],
  ['w15', 'w', 2, '열다섯 승', '한 시즌 15승', (s) => s.pit.w >= 15],
  ['w20', 'w', 3, '스무 승', '한 시즌 20승', (s) => s.pit.w >= 20],
  ['eraRel60', 'eraRel', 2, '마운드 압도', '평균자책이 리그 평균의 60% 이하 (규정이닝)', (s) => s.qPit && (s.eraRel ?? 9) <= 0.6],
  ['so200', 'so', 3, '이백 삼진', '한 시즌 탈삼진 200개', (s) => s.pit.so >= 200],
  ['ip180', 'ip', 2, '철완 시즌', '한 시즌 180이닝', (s) => s.pit.outs >= 540],
  ['sv30', 'sv', 2, '서른 세이브', '한 시즌 세이브 30개', (s) => s.pit.sv >= 30],
  ['sv40', 'sv', 3, '마흔 세이브', '한 시즌 세이브 40개', (s) => s.pit.sv >= 40],
  ['hld30', 'hld', 2, '서른 홀드', '한 시즌 홀드 30개', (s) => s.pit.hld >= 30],
  ['ptc', 'ptc', 3, '투수 삼관', '같은 해 다승·평균자책점·탈삼진 1위', (s) => ['w', 'era', 'so'].every((k) => s.lead.has(k))],
  ['war6', 'war', 1, '시즌의 기둥', '시즌 가치 6승', (s) => s.war >= 6],
  ['war8', 'war', 2, '압도적 시즌', '시즌 가치 8승', (s) => s.war >= 8],
] as [string, string, 1 | 2 | 3, string, string, Test][]).map(([key, stem, tier, name, cond, test]) => ({ key: `s:${key}`, group: 'B', tier, name, cond, test, once: false, stem: `s:${stem}` }));

/** C 통산 사다리·G 롱런·H 타이틀 수집가 (기획안 4.3·4.7). 한 번 얻으면 남는다. 같은 줄기는 화면에 가장 높은 칸만 */
const CAREER_DEFS: TitleDef[] = ([
  ['ch1000', 'h', 'C', 1, '천 안타', '통산 1,000안타', (_, c) => c.bat.h >= 1000],
  ['ch2000', 'h', 'C', 2, '이천 안타', '통산 2,000안타', (_, c) => c.bat.h >= 2000],
  ['ch2500', 'h', 'C', 3, '이천오백 안타', '통산 2,500안타', (_, c) => c.bat.h >= 2500],
  ['chr100', 'hr', 'C', 1, '백 홈런', '통산 100홈런', (_, c) => c.bat.hr >= 100],
  ['chr200', 'hr', 'C', 2, '이백 홈런', '통산 200홈런', (_, c) => c.bat.hr >= 200],
  ['chr300', 'hr', 'C', 3, '삼백 홈런', '통산 300홈런', (_, c) => c.bat.hr >= 300],
  ['chr400', 'hr', 'C', 3, '사백 홈런', '통산 400홈런', (_, c) => c.bat.hr >= 400],
  ['crbi1000', 'rbi', 'C', 2, '천 타점', '통산 1,000타점', (_, c) => c.bat.rbi >= 1000],
  ['csb300', 'sb', 'C', 2, '삼백 도루', '통산 300도루', (_, c) => c.bat.sb >= 300],
  ['cg2000', 'g', 'C', 2, '이천 경기', '통산 2,000경기 (타자)', (_, c) => c.bat.g >= 2000],
  ['cw100', 'w', 'C', 2, '백 승', '통산 100승', (_, c) => c.pit.w >= 100],
  ['cw150', 'w', 'C', 3, '백오십 승', '통산 150승', (_, c) => c.pit.w >= 150],
  ['csv100', 'sv', 'C', 2, '백 세이브', '통산 100세이브', (_, c) => c.pit.sv >= 100],
  ['csv200', 'sv', 'C', 3, '이백 세이브', '통산 200세이브', (_, c) => c.pit.sv >= 200],
  ['csv300', 'sv', 'C', 3, '삼백 세이브', '통산 300세이브', (_, c) => c.pit.sv >= 300],
  ['chld100', 'hld', 'C', 2, '백 홀드', '통산 100홀드', (_, c) => c.pit.hld >= 100],
  ['cso1000', 'so', 'C', 2, '천 삼진', '통산 1,000탈삼진', (_, c) => c.pit.so >= 1000],
  ['cso2000', 'so', 'C', 3, '이천 삼진', '통산 2,000탈삼진', (_, c) => c.pit.so >= 2000],
  ['cip2000', 'ip', 'C', 3, '이천 이닝', '통산 2,000이닝', (_, c) => c.pit.outs >= 6000],
  ['cwar45', 'war', 'C', 2, '전당급 커리어', '통산 가치 45승 (명예의 전당 선)', (_, c) => c.war >= 45],
  ['age40', 'age40', 'G', 2, '불혹', '만 40세 시즌에 1군 100타석 또는 30이닝', (s) => s.age !== null && s.age >= 40 && (s.bat.pa >= 100 || s.pit.outs >= 90)],
  ['seasons20', 'seasons20', 'G', 2, '스무 해', '1군 20시즌', (_, c) => c.seasons >= 20],
  ['t10', 't10', 'H', 3, '타이틀 수집가', '타이틀(부문 1위) 합계 10회', (_, c) => titleTotal(c) >= 10],
] as [string, string, TitleGroup, 1 | 2 | 3, string, string, Test][]).map(([key, stem, group, tier, name, cond, test]) => ({ key: `c:${key}`, group, tier, name, cond, test, once: true, stem: `c:${stem}` }));

const DEF_BY_KEY = new Map([...SEASON_DEFS, ...CAREER_DEFS].map((d) => [d.key, d]));

/** 원클럽맨 (E): 한 구단에서만 15시즌. 다른 구단에서 뛰면 다음 결산에 빠진다 */
const ONE_CLUB_SEASONS = 15;
/** 프랜차이즈 스타 (E): 은퇴식 기준(history.ts farewellWorthy)과 같은 꼴. 그 구단 10시즌 + 1,000안타·60승·100세이브 또는 큰 통산 기록 */
const FRANCHISE_STAR_SEASONS = 10;
const franchiseStar = (c: Cum, f: string) => (c.fr[f] ?? 0) >= FRANCHISE_STAR_SEASONS
  && (c.bat.h >= 1000 || c.pit.w >= 60 || c.pit.sv >= 100 || c.bat.hr >= 300 || c.bat.rbi >= 1200 || c.pit.so >= 2000);

/**
 * 레전드 칭호 조건 (기획안 7.2·7.3, KBO 레전드 40인 순위로 데이터 표와 잇는다). 실제 1982~2025에서 주인 포함 1~2명만 채우게 맞춘 값.
 * 기록의 문턱만 쓰고 특정 경기·연승·시리즈 같은 실제 사건은 쓰지 않는다. alt가 있으면 '원래 또는 대안' (시대에 묶인 조건, 결정 12).
 * 데이터 표에서 nick이 없는 레전드(정민태·김시진·이순철, 결정 13)는 조건만 남고 칭호를 켜지 않는다.
 */
export const LEGEND_RULES: Record<number, { cond: string; test: Test; alt?: { cond: string; test: Test } }> = {
  1: { cond: '평균자책점 1위 5회', test: (_, c) => leads(c, 'era') >= 5 },
  2: { cond: '한 시즌 280이닝 + 탈삼진 220', test: (s) => s.pit.outs >= 840 && s.pit.so >= 220,
    alt: { cond: '같은 해 다승·탈삼진·이닝 1위 + 탈삼진 220', test: (s) => ['w', 'so', 'ip'].every((k) => s.lead.has(k)) && s.pit.so >= 220 } },
  3: { cond: '한 시즌 타율 1위 + 도루 1위', test: (s) => s.lead.has('avg') && s.lead.has('sb') },
  4: { cond: '홈런 1위 5회 + MVP 3회', test: (_, c) => leads(c, 'hr') >= 5 && c.mvp >= 3 },
  5: { cond: '통산 200승', test: (_, c) => c.pit.w >= 200 },
  6: { cond: '타율 1위 4회 + 통산 타율 .330 (3,000타수)', test: (_, c) => leads(c, 'avg') >= 4 && c.bat.ab >= 3000 && c.bat.h / c.bat.ab >= 0.33 },
  7: { cond: '통산 타율 .315 (5,000타수) + 300홈런 + 1,200볼넷', test: (_, c) => c.bat.ab >= 5000 && c.bat.h / c.bat.ab >= 0.315 && c.bat.hr >= 300 && c.bat.bb >= 1200 },
  8: { cond: '좌투 통산 200세이브', test: (_, c) => c.hist[0].throws === 'L' && c.pit.sv >= 200 },
  9: { cond: '언더핸드로 10시즌 연속 10승', test: (_, c) => c.hist[0].underhand && streak(c.hist, (s) => s.pit.w >= 10) >= 10 },
  10: { cond: '같은 해 홈런·타점 1위 3시즌 연속 + 한 시즌 40홈런', test: (_, c) => streak(c.hist, (s) => s.lead.has('hr') && s.lead.has('rbi')) >= 3 && c.hist.some((s) => s.bat.hr >= 40) },
  11: { cond: '한 시즌 22승 + 4패 이하', test: (s) => s.pit.w >= 22 && s.pit.l <= 4 },
  12: { cond: '포수(C)로 홈런 1위 3회', test: (_, c) => countIf(c.hist, (s) => s.pos === 'C' && s.lead.has('hr')) >= 3 },
  13: { cond: '만 25세 시즌까지 통산 80승', test: (s, c) => s.age !== null && s.age <= 25 && c.pit.w >= 80 },
  14: { cond: '출루율 1위 4회 + 통산 2,000안타 + 300홈런', test: (_, c) => leads(c, 'obp') >= 4 && c.bat.h >= 2000 && c.bat.hr >= 300 },
  15: { cond: '10시즌 연속 타율 .300 (규정타석) + 통산 2,000안타', test: (_, c) => streak(c.hist, (s) => s.qBat && avg(s.bat) >= 0.3) >= 10 && c.bat.h >= 2000 },
  16: { cond: '한 구단에서만 통산 100승 + 200세이브', test: (_, c) => Object.keys(c.fr).length === 1 && c.pit.w >= 100 && c.pit.sv >= 200,
    alt: { cond: '만 38세 이상 시즌에 15승', test: (s) => s.age !== null && s.age >= 38 && s.pit.w >= 15 } },
  17: { cond: '30홈런-30도루 3회', test: (_, c) => countIf(c.hist, (s) => s.bat.hr >= 30 && s.bat.sb >= 30) >= 3 },
  18: { cond: '한 시즌 20승 + 다승 1위 3회', test: (_, c) => c.hist.some((s) => s.pit.w >= 20) && leads(c, 'w') >= 3 },
  19: { cond: '안타 1위 4회', test: (_, c) => leads(c, 'h') >= 4 },
  20: { cond: '1군 첫 6시즌 통산 100승', test: (_, c) => firstN(c, 6, (s) => s.pit.w) >= 100,
    alt: { cond: '1군 첫 6시즌 안에 다승 1위 2회 + 그 6시즌 95승', test: (_, c) => countIf(c.hist.slice(0, 6), (s) => s.lead.has('w')) >= 2 && firstN(c, 6, (s) => s.pit.w) >= 95 } },
  21: { cond: '세이브 1위 4회 + 통산 100승', test: (_, c) => leads(c, 'sv') >= 4 && c.pit.w >= 100 },
  22: { cond: '좌타로 홈런 1위 + 출루율 1위 2회', test: (_, c) => c.hist[0].bats === 'L' && leads(c, 'hr') >= 1 && leads(c, 'obp') >= 2 },
  23: { cond: '주 포지션 포수(C) + 통산 300홈런', test: (_, c) => c.hist[0].pos === 'C' && c.bat.hr >= 300 },
  24: { cond: '한 시즌 타율 .400 (규정타석)', test: (s) => s.qBat && avg(s.bat) >= 0.4 },
  25: { cond: '같은 시즌 투수 10승 + 타자 규정타석', test: (s) => s.pit.w >= 10 && s.qBat,
    alt: { cond: '같은 시즌 투수 5승 + 타자 10홈런', test: (s) => s.pit.w >= 5 && s.bat.hr >= 10 } },
  26: { cond: '다승 1위 2시즌 연속 + 평균자책점 1위 + 통산 120승', test: (_, c) => streak(c.hist, (s) => s.lead.has('w')) >= 2 && leads(c, 'era') >= 1 && c.pit.w >= 120 },
  27: { cond: '좌투로 한 시즌 20승 + 세이브 1위', test: (_, c) => c.hist[0].throws === 'L' && c.hist.some((s) => s.pit.w >= 20) && leads(c, 'sv') >= 1,
    alt: { cond: '좌투로 다승 1위 + 세이브 1위 (커리어 안에서 각 1회 이상)', test: (_, c) => c.hist[0].throws === 'L' && leads(c, 'w') >= 1 && leads(c, 'sv') >= 1 } },
  28: { cond: '3루수(3B) 골든글러브 5회 + 출루율 1위 2회', test: (_, c) => ggAt(c, '3B') >= 5 && leads(c, 'obp') >= 2 },
  29: { cond: '주 포지션 3루수(3B) + 통산 타율 .300·출루율 .400 + 250홈런', test: (_, c) => c.hist[0].pos === '3B' && c.bat.ab > 0 && c.bat.h / c.bat.ab >= 0.3 && obp(c.bat) >= 0.4 && c.bat.hr >= 250 },
  30: { cond: '한 시즌 홈런 50 + 출루율 .470 (규정타석)', test: (s) => s.qBat && s.bat.hr >= 50 && obp(s.bat) >= 0.47 },
  31: { cond: '유격수(SS) 골든글러브 4회 + 도루 1위', test: (_, c) => ggAt(c, 'SS') >= 4 && leads(c, 'sb') >= 1 },
  32: { cond: '2루수(2B) 골든글러브 5회', test: (_, c) => ggAt(c, '2B') >= 5 },
  33: { cond: '외국인 통산 100승 + 통산 승률 .600', test: (_, c) => c.hist[0].foreign && c.pit.w >= 100 && c.pit.w / (c.pit.w + c.pit.l) >= 0.6 },
  34: { cond: '통산 540도루', test: (_, c) => c.bat.sb >= 540 },
  35: { cond: '만 23세 이하 시즌에 다승·승률 1위 (같은 해) + 통산 130승', test: (_, c) => c.hist.some((s) => s.age !== null && s.age <= 23 && s.lead.has('w') && s.lead.has('wpct')) && c.pit.w >= 130 },
  36: { cond: '포수(C)·지명타자(DH) 골든글러브 각 1회 이상 + 통산 2,000안타', test: (_, c) => ggAt(c, 'C') >= 1 && ggAt(c, 'DH') >= 1 && c.bat.h >= 2000 },
  37: { cond: '신인왕 + 도루 1위 3회', test: (_, c) => c.hist.some((s) => s.rookie) && leads(c, 'sb') >= 3 },
  38: { cond: '2루수(2B) 골든글러브 3회 + 통산 350도루', test: (_, c) => ggAt(c, '2B') >= 3 && c.bat.sb >= 350 },
  39: { cond: '유격수(SS) 골든글러브 5회 + 통산 1,900경기', test: (_, c) => ggAt(c, 'SS') >= 5 && c.bat.g >= 1900 },
  40: { cond: '외국인으로 같은 해 홈런 1위 + MVP', test: (s) => s.foreign && s.lead.has('hr') && s.mvp },
};
/** 레전드 조건 문구 ('원래 또는 대안') */
export const legendCond = (rank: number): string => {
  const r = LEGEND_RULES[rank];
  return r ? (r.alt ? `${r.cond} (또는 ${r.alt.cond})` : r.cond) : '';
};
const legendTest = (rank: number): Test => {
  const r = LEGEND_RULES[rank];
  return r.alt ? (s, c) => r.test(s, c) || r.alt!.test(s, c) : r.test;
};

// ---- 한 시즌 판정

/**
 * 시즌 s(누적 c는 s까지 포함)에서 얻는 칭호 키. held: 그 전에 이미 가진 한 번짜리 칭호.
 * 해마다 얻는 칭호(A 타이틀·B 시즌 기록·D 수상·F 가을야구)는 조건을 채운 해마다 한 건이다
 */
function earned(s: TitleSeason, c: Cum, held: Set<string>, legends: LegendTitleRow[]): string[] {
  const out: string[] = [];
  for (const k of LEAD_KEYS) if (s.lead.has(k)) out.push(`lead:${k}`);
  const bestOf = new Map<string, TitleDef>();
  for (const d of SEASON_DEFS) if (d.test(s, c)) { const b = bestOf.get(d.stem!); if (!b || d.tier >= b.tier) bestOf.set(d.stem!, d); }
  for (const d of bestOf.values()) out.push(d.key);
  if (s.mvp) out.push('mvp');
  if (s.gg) out.push(`gg:${s.gg}`);
  if (s.rookie && !held.has('rookie')) out.push('rookie');
  if (s.champ) out.push('champ');
  if (s.ksMvp) out.push('ksmvp');
  if (s.psMvp) out.push('psmvp');
  for (const d of CAREER_DEFS) if (!held.has(d.key) && d.test(s, c)) out.push(d.key);
  const frs = Object.keys(c.fr);
  if (frs.length === 1 && c.seasons >= ONE_CLUB_SEASONS && !held.has('one15')) out.push('one15');
  for (const f of frs) if (!held.has(`fstar:${f}`) && franchiseStar(c, f)) out.push(`fstar:${f}`);
  for (const L of legends) {
    if (!L.nick || !LEGEND_RULES[L.rank]) continue;
    const key = `L:${L.rank}`;
    if (!held.has(key) && legendTest(L.rank)(s, c)) out.push(key);
  }
  return out;
}

/** 다른 구단에서 뛰었으면 원클럽맨을 뗀다 */
const lostOneClub = (c: Cum) => Object.keys(c.fr).length > 1;

// ---- 실제 기록 (시작 전)

const realCache = new WeakMap<object, Map<number, Map<string, TitleSeason[]>>>();

function newSeason(id: string, year: number): TitleSeason {
  return {
    id, year, pitcher: false, age: null, fr: '', pos: null, throws: null, bats: null, foreign: false, underhand: false,
    bat: emptyBat(), pit: emptyPit(), war: 0, qBat: false, qPit: false, lead: new Set(),
    mvp: false, gg: null, rookie: false, champ: false, ksMvp: false, psMvp: false, eraRel: null,
  };
}

/** 시작 해 전 실제 시즌 (선수 ID → 해 순). 실제 시상은 awards.json, 우승은 연표 (history.ts realYearbook) */
export function realTitleSeasons(store: Store, before: number): Map<string, TitleSeason[]> {
  let byBefore = realCache.get(store);
  if (!byBefore) realCache.set(store, (byBefore = new Map()));
  const hit = byBefore.get(before);
  if (hit) return hit;
  const aw = new Map<string, RealAward[]>();
  for (const a of store.realAwards ?? []) if (a.id) (aw.get(`${a.year}/${a.id}`) ?? aw.set(`${a.year}/${a.id}`, []).get(`${a.year}/${a.id}`)!).push(a);
  const champ = new Map(realYearbook(store, before).map((y) => [y.year, y.champion]));
  const out = new Map<string, TitleSeason[]>();
  for (const y of store.meta.years) {
    if (y >= before) continue;
    const sd = store.season(y);
    if (!sd) continue;
    const env = realEnv(sd);
    const fr = new Map(sd.teams.map((t) => [t.name, t.franchise]));
    const by = new Map<string, TitleSeason>();
    const get = (id: string, team: string): TitleSeason => {
      let s = by.get(id);
      if (!s) {
        const m = store.players.get(id);
        const a = aw.get(`${y}/${id}`) ?? [];
        s = newSeason(id, y);
        s.pitcher = m?.kind === 'P';
        s.age = m?.birthYear ? y - m.birthYear : null;
        s.pos = m?.pos ?? null;
        s.throws = m?.throws ?? null; s.bats = m?.bats ?? null; s.foreign = !!m?.foreign; s.underhand = !!m?.underhand;
        s.mvp = a.some((x) => x.award === 'MVP');
        s.gg = a.find((x) => x.award === '골든글러브')?.part ?? null;
        s.rookie = a.some((x) => x.award === '신인왕');
        s.ksMvp = a.some((x) => x.award === '한국시리즈 MVP');
        by.set(id, s);
      }
      s.fr = fr.get(team) ?? team;
      if (champ.get(y) === team) s.champ = true;
      return s;
    };
    for (const r of sd.bat) {
      const s = get(r.id, r.team);
      addTo(s.bat, { ...r, bb: r.bb ?? 0, hbp: r.hbp ?? 0, sf: r.sf ?? 0, so: r.so ?? 0, sb: r.sb ?? 0 });
      if (!s.pitcher) s.war += batWarOf(r, r.pos, env);
    }
    for (const r of sd.pit) {
      const s = get(r.id, r.team);
      addTo(s.pit, { ...r, gs: r.gs ?? 0, hld: r.hld ?? 0 });
      s.war += pitWarOf(r, env);
    }
    const xs = [...by.values()];
    markYear(xs, sd.games);
    for (const s of xs) (out.get(s.id) ?? out.set(s.id, []).get(s.id)!).push(s);
  }
  byBefore.set(before, out);
  return out;
}

/** 시즌 줄들을 처음부터 판정한다 (시작 전 실제 기록, 실제 기록 시험). keep: 그 선수의 기존 칭호 */
function judgeHistory(id: string, hist: TitleSeason[], legends: LegendTitleRow[], keep: TitleRecord[] = []): TitleRecord[] {
  const c = emptyCum();
  const held = new Set(keep.map((r) => r.key));
  const out: TitleRecord[] = [];
  for (const s of hist) {
    addSeason(c, s);
    for (const key of earned(s, c, held, legends)) { held.add(key); out.push({ id, key, year: s.year }); }
    if (held.has('one15') && lostOneClub(c)) {
      held.delete('one15');
      const i = out.findIndex((r) => r.key === 'one15');
      if (i >= 0) out.splice(i, 1);
    }
  }
  return out;
}

/** 실제 기록 1982~(before−1)로 모든 선수의 칭호 (실제 기록 시험·측정용) */
export function realTitles(store: Store, before: number): TitleRecord[] {
  const legends = store.legendTitles ?? [];
  return [...realTitleSeasons(store, before)].flatMap(([id, hist]) => judgeHistory(id, hist, legends));
}

/** 시작 때: 리그 선수의 시작 해 전 실제 기록으로 칭호를 붙인다 (결정 7). 얻은 해는 실제 연도 */
export function startTitles(league: LeagueState, store: Store): void {
  const real = realTitleSeasons(store, league.startYear);
  const legends = store.legendTitles ?? [];
  league.titles = league.players.flatMap((p) => (real.has(p.id) ? judgeHistory(p.id, real.get(p.id)!, legends) : []));
}

// ---- 게임 안 시즌

const BAT_KEYS = Object.keys(emptyBatLine());
const PIT_KEYS = Object.keys(emptyPitLine());
const lineObj = (keys: string[], v: number[]) => Object.fromEntries(keys.map((k, i) => [k, v[i] ?? 0])) as Record<string, number>;

function franchiseOf(league: LeagueState, year: number, team: string): string {
  return league.yearbook?.find((y) => y.year === year)?.teams.find((t) => t.name === team)?.franchise
    ?? league.teams.find((t) => t.name === team)?.franchise ?? team;
}

/** 그 해 팀당 경기 수 (규정타석·규정이닝). 연표가 없으면(결산 중) 1군 선수 줄에서 가장 많은 경기 */
function yearGames(league: LeagueState, year: number, lines: SeasonLine[]): number {
  const yb = league.yearbook?.find((y) => y.year === year);
  if (yb?.teams.length) return Math.max(...yb.teams.map((t) => t.w + t.l + t.t));
  return Math.max(1, ...lines.map((l) => l.bat?.[0] ?? 0), ...lines.map((l) => l.pit?.[0] ?? 0));
}

/** 리그 상태의 한 해 시즌 (게임 안). 그 해 1군 줄이 있는 리그 선수만 (리그를 떠난 선수는 줄이 없다) */
function gameYear(league: LeagueState, year: number, games?: number): Map<string, TitleSeason> {
  const env = league.seasonEnv?.[String(year)];
  const aw = league.awards?.find((a) => a.year === year);
  const champion = league.yearbook?.find((y) => y.year === year)?.champion ?? null;
  const xs: TitleSeason[] = [];
  const lines: SeasonLine[] = [];
  for (const p of league.players) {
    const l = p.history.find((h) => h.year === year && (h.bat || h.pit));
    if (!l) continue;
    lines.push(l);
    xs.push(gameSeason(league, p, l, env, champion));
  }
  markYear(xs, games ?? yearGames(league, year, lines));
  const by = new Map(xs.map((s) => [s.id, s]));
  // 부문 1위는 그 해 시상(awards.ts)의 타이틀을 그대로 쓴다 (리그를 떠난 선수가 1위였던 해도 같게)
  if (aw) {
    for (const s of xs) for (const k of LEAD_KEYS) s.lead.delete(k);
    for (const t of aw.titles) for (const w of t.winners) by.get(w.id)?.lead.add(t.key);
    if (aw.mvp) { const s = by.get(aw.mvp.id); if (s) s.mvp = true; }
    if (aw.rookie) { const s = by.get(aw.rookie.id); if (s) s.rookie = true; }
    for (const g of aw.goldenGlove) { const s = by.get(g.winner.id); if (s) s.gg = g.pos; }
    for (const m of aw.postseasonMvps ?? []) { const s = by.get(m.id); if (s) { if (m.round === 'ks') s.ksMvp = true; else s.psMvp = true; } }
  }
  return by;
}

function gameSeason(league: LeagueState, p: LeaguePlayer, l: SeasonLine, env: ReturnType<typeof realEnv> | undefined, champion: string | null): TitleSeason {
  const s = newSeason(p.id, l.year);
  s.pitcher = p.isPitcher;
  s.age = p.birthYear && !p.birthYearEstimated ? l.year - p.birthYear : null;
  s.fr = franchiseOf(league, l.year, l.team);
  s.pos = p.pos; s.throws = p.throws; s.bats = p.bats; s.foreign = p.foreign; s.underhand = !!p.underhand;
  if (l.bat) addTo(s.bat, lineObj(BAT_KEYS, l.bat));
  if (l.pit) addTo(s.pit, lineObj(PIT_KEYS, l.pit));
  if (env) {
    if (l.bat && !p.isPitcher) s.war += batWarOf(lineObj(BAT_KEYS, l.bat) as never, p.pos, env);
    if (l.pit) s.war += pitWarOf(lineObj(PIT_KEYS, l.pit) as never, env);
  }
  s.champ = champion !== null && champion === l.team;
  return s;
}

/**
 * 결산 때 한 해 판정 (시상 뒤, 그 해 시즌 줄이 history에 들어간 뒤). 같은 해를 다시 판정하면 그 해 칭호를 지우고 다시 낸다
 * (세션은 가을야구 우승·시리즈 MVP를 붙인 뒤 한 번 더 부른다). 시작 해 전 실제 기록 + 게임 안 시즌을 이어 누적한다
 */
export function judgeTitles(league: LeagueState, store: Store, year: number, games?: number): void {
  const prior = (league.titles ?? []).filter((r) => r.year !== year);
  const byId = new Map<string, TitleRecord[]>();
  for (const r of prior) (byId.get(r.id) ?? byId.set(r.id, []).get(r.id)!).push(r);
  const real = realTitleSeasons(store, league.startYear);
  const legends = store.legendTitles ?? [];
  const now = gameYear(league, year, games);
  const past = new Map<number, Map<string, TitleSeason>>();
  const pastYear = (y: number) => past.get(y) ?? past.set(y, gameYear(league, y)).get(y)!;
  const added: TitleRecord[] = [];
  const dropOneClub = new Set<string>();
  for (const p of league.players) {
    const s = now.get(p.id);
    if (!s) continue;
    const hist = [...(real.get(p.id) ?? [])];
    for (const l of p.history) if (l.year >= league.startYear && l.year < year && (l.bat || l.pit)) { const g = pastYear(l.year).get(p.id); if (g) hist.push(g); }
    hist.push(s);
    const c = emptyCum();
    for (const h of hist) addSeason(c, h);
    const held = new Set((byId.get(p.id) ?? []).map((r) => r.key));
    for (const key of earned(s, c, held, legends)) added.push({ id: p.id, key, year });
    if (held.has('one15') && lostOneClub(c)) dropOneClub.add(p.id);
  }
  league.titles = [...prior.filter((r) => !(r.key === 'one15' && dropOneClub.has(r.id))), ...added];
}

/** 예전 저장 (칭호 칸 없음): 시작 전 실제 기록과 남아 있는 게임 안 시즌으로 한 번 채운다. 리그를 떠난 선수는 빠진다 */
export function ensureTitles(league: LeagueState, store: Store, lastYear: number): void {
  if (league.titles) return;
  startTitles(league, store);
  for (let y = league.startYear; y <= lastYear; y++) if (league.awards?.some((a) => a.year === y)) judgeTitles(league, store, y);
}

// ---- 보여 주기

export interface TitleView {
  /** 줄기 (같은 줄기는 칩에 가장 높은 칸 하나) */
  stem: string;
  key: string;
  name: string;
  tier: TitleTier;
  group: TitleGroup;
  /** 얻은 해 (여러 번이면 모두, 오름차순) */
  years: number[];
  cond: string;
  /** 횟수로 등급이 오르는 칭호의 등급 규칙 */
  note?: string;
  /** 지금 타이틀 보유 ("현 홈런왕") */
  current: boolean;
  /** 모두 시작 전 실제 기록에서 얻음 */
  real: boolean;
  /** 레전드 칭호: 별명 주인 */
  owner?: string;
}

const countTier = (n: number, steps: [number, 1 | 2 | 3][]): 0 | 1 | 2 | 3 => steps.reduce<0 | 1 | 2 | 3>((t, [min, tier]) => (n >= min ? tier : t), 0);

interface Ctx { startYear: number; lastYear: number; legends: Map<string, LegendTitleRow>; teamName: (franchise: string) => string }

/** 한 줄기 기록들 → 칭호 (A·D·F는 횟수로 등급이 오른다). 그 해까지(upto)만 센다 */
function viewOf(key: string, recs: TitleRecord[], ctx: Ctx): TitleView | null {
  const years = recs.map((r) => r.year).sort((a, b) => a - b);
  const n = years.length;
  const last = years[n - 1];
  const base = { key, years, real: last < ctx.startYear };
  if (key.startsWith('lead:')) {
    const k = key.slice(5) as LeadKey;
    const current = last === ctx.lastYear;
    return { ...base, stem: key, group: n >= 3 ? 'H' : 'A', tier: countTier(n, [[1, 1], [3, 2], [5, 3]]), current,
      name: `${current ? '현 ' : ''}${LEAD_NAME[k]}${n > 1 ? ` ×${n}` : ''}`, cond: LEAD_COND[k], note: '3회 ★★, 5회 ★★★' };
  }
  if (key === 'mvp') return { ...base, stem: key, group: 'D', tier: n >= 2 ? 3 : 2, current: false, name: n > 1 ? `MVP ×${n}` : 'MVP', cond: '정규시즌 MVP', note: '2회부터 ★★★' };
  if (key === 'rookie') return { ...base, stem: key, group: 'D', tier: 1, current: false, name: '신인왕', cond: '신인상' };
  if (key === 'champ') {
    const tier = countTier(n, [[3, 1], [5, 2]]);
    return { ...base, stem: key, group: 'F', tier, current: false, name: n >= 5 ? `다섯 반지 (우승 ×${n})` : n >= 3 ? `왕조의 주역 (우승 ×${n})` : `우승 ×${n}`, cond: '한국시리즈 우승 (그 해 1군 기록이 있는 선수)', note: '3회 ★, 5회 ★★' };
  }
  if (key === 'ksmvp') return { ...base, stem: key, group: 'F', tier: 2, current: false, name: n > 1 ? `한국시리즈 MVP ×${n}` : '한국시리즈 MVP', cond: '한국시리즈 MVP' };
  if (key === 'psmvp') return { ...base, stem: key, group: 'F', tier: 1, current: false, name: n > 1 ? `시리즈 MVP ×${n}` : '시리즈 MVP', cond: '준플레이오프·플레이오프 MVP' };
  if (key === 'one15') return { ...base, stem: key, group: 'E', tier: 1, current: false, name: '원클럽맨', cond: `한 구단에서만 ${ONE_CLUB_SEASONS}시즌 (다른 구단에서 뛰면 빠진다)` };
  if (key.startsWith('fstar:')) {
    const f = key.slice(6);
    return { ...base, stem: key, group: 'E', tier: 2, current: false, name: `${ctx.teamName(f)} 프랜차이즈 스타`, cond: `그 구단 ${FRANCHISE_STAR_SEASONS}시즌 + 통산 1,000안타·60승·100세이브 또는 큰 통산 기록` };
  }
  if (key.startsWith('L:')) {
    const L = ctx.legends.get(key);
    if (!L?.nick) return null;
    return { ...base, stem: key, group: 'L', tier: 'L', current: false, name: L.nick, cond: legendCond(L.rank), owner: L.name };
  }
  const d = DEF_BY_KEY.get(key);
  if (!d) return null;
  return { ...base, stem: d.stem ?? key, group: d.group, tier: d.tier, current: false, name: n > 1 ? `${d.name} ×${n}` : d.name, cond: d.cond };
}

/** 골든글러브 (자리마다 기록, 칩은 합계 횟수로 등급: 1회 ★, 5회 ★★, 8회 ★★★) */
function ggView(recs: TitleRecord[], ctx: Ctx): TitleView {
  const pos = new Map<string, number>();
  for (const r of recs) pos.set(r.key.slice(3), (pos.get(r.key.slice(3)) ?? 0) + 1);
  const n = recs.length;
  const years = recs.map((r) => r.year).sort((a, b) => a - b);
  const posText = [...pos].sort((a, b) => b[1] - a[1]).map(([p]) => p).join('·');
  return { stem: 'gg', key: 'gg', group: 'D', tier: countTier(n, [[1, 1], [5, 2], [8, 3]]), years, real: years[n - 1] < ctx.startYear, current: false,
    name: `골든글러브 ${posText}${n > 1 ? ` ×${n}` : ''}`, cond: '골든글러브 수상', note: '자리는 영문 약자, 외야는 OF. 5회 ★★, 8회 ★★★' };
}

const TIER_ORDER = (t: TitleTier) => (t === 'L' ? 4 : t);

export interface TitleLookup { startYear: number; lastYear: number; legends?: LegendTitleRow[]; teamName?: (franchise: string) => string }

/** 한 선수의 칭호 (칩 순서: 레전드 → ★★★ → ★★ → ★, 같은 등급은 최근에 얻은 것부터). 등급 0(우승 1·2회)은 뒤에 */
export function titlesOf(records: TitleRecord[] | undefined, id: string, look: TitleLookup): TitleView[] {
  const mine = (records ?? []).filter((r) => r.id === id);
  if (!mine.length) return [];
  const ctx: Ctx = {
    startYear: look.startYear, lastYear: look.lastYear,
    legends: new Map((look.legends ?? []).map((L) => [`L:${L.rank}`, L])), teamName: look.teamName ?? ((f) => f),
  };
  const byKey = new Map<string, TitleRecord[]>();
  for (const r of mine) (byKey.get(r.key) ?? byKey.set(r.key, []).get(r.key)!).push(r);
  const out: TitleView[] = [];
  const gg: TitleRecord[] = [];
  for (const [key, recs] of byKey) {
    if (key.startsWith('gg:')) { gg.push(...recs); continue; }
    const v = viewOf(key, recs, ctx);
    if (v) out.push(v);
  }
  if (gg.length) out.push(ggView(gg, ctx));
  return out.sort((a, b) => TIER_ORDER(b.tier) - TIER_ORDER(a.tier) || b.years[b.years.length - 1] - a.years[a.years.length - 1] || a.name.localeCompare(b.name));
}

/** 머리 칩: 같은 줄기는 가장 높은 칸 하나, 등급 0은 빼고 (결정 9: 화면은 앞 3개 + "+N") */
export function titleChips(views: TitleView[]): TitleView[] {
  const seen = new Set<string>();
  const out: TitleView[] = [];
  for (const v of views) {
    if (v.tier === 0 || seen.has(v.stem)) continue;
    seen.add(v.stem);
    out.push(v);
  }
  return out;
}

export const tierText = (t: TitleTier): string => (t === 'L' ? '레전드' : t === 0 ? '—' : '★'.repeat(t));

// ---- 소식

export interface TitleEvent { id: string; key: string; year: number; view: TitleView }

/**
 * 그 해 새로 얻은 칭호 (소식·기사). 횟수로 오르는 칭호(타이틀·골든글러브·MVP·우승)는 등급이 오른 해만 알린다
 * (우승 1·2회, 4회는 알리지 않는다). 통산 사다리 칸은 마일스톤 기사와 겹쳐 기사에서 뺀다 (session.ts titleNews)
 */
export function titleEvents(records: TitleRecord[] | undefined, year: number, look: TitleLookup): TitleEvent[] {
  const all = records ?? [];
  const out: TitleEvent[] = [];
  const done = new Set<string>();
  for (const r of all) {
    if (r.year !== year) continue;
    const upto = all.filter((x) => x.id === r.id && x.year <= year);
    const viewKey = r.key.startsWith('gg:') ? 'gg' : r.key;
    if (done.has(`${r.id}/${viewKey}`)) continue;
    done.add(`${r.id}/${viewKey}`);
    const nowV = titlesOf(upto, r.id, look).find((v) => v.key === viewKey);
    if (!nowV || nowV.tier === 0) continue;
    const before = titlesOf(upto.filter((x) => x.year < year), r.id, look).find((v) => v.key === viewKey);
    const counted = viewKey === 'gg' || viewKey === 'mvp' || viewKey === 'champ' || viewKey.startsWith('lead:');
    if (counted && before && before.tier === nowV.tier) continue;
    out.push({ id: r.id, key: viewKey, year, view: nowV });
  }
  return out;
}
