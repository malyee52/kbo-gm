// 포스트시즌(가을야구) (M7): 정규시즌 순위 상위 팀의 사다리식 시리즈. 정규시즌 기록에는 남기지 않는다.
//
// 2015년 이후 방식 (자료집 "시즌구조"·"제도연표", 출처 확인): 4위 대 5위 와일드카드 → 준플레이오프(3위) → 플레이오프(2위) → 한국시리즈(1위).
// 시리즈 길이와 와일드카드 1승 어드밴티지는 자료집에서 확인하지 못한 값이라 임시값이다.
// 연장 이닝은 해마다 meta.json rules[연도].postseasonMaxInnings (엔진 2 14단계 연표: 2003·2004 12회, 2008 무제한, 나머지 15회. 2003·2008은 출처 갈림).
// 한국시리즈 홈경기 2-3-2 방식은 자료집 2025년 비고에 있다 (출처 확인).
//
// 진행 상태(PostseasonState)는 JSON으로 저장할 수 있고 한 경기씩 진행한다 (플레이어가 가을야구를 직접 진행, 2026-10-08 사용자 요청).
// 난수 위치를 상태에 담으므로 저장했다 이어 해도 결과가 같다.
//
// 양대 리그 해(1999·2000)는 사다리 대신 대진(bracket)을 쓴다 (일정 개편 기획안 10.5): 조건부 준플레이오프, 교차 플레이오프 둘이
// 함께 열리고, 두 승자가 한국시리즈. 대진이 없는 해는 예전 사다리 그대로다.

import {
  emptyBatLine, emptyLeagueCounters, emptyPitLine, postseasonMaxInnings, rankWithTiebreak, Rng, winPct, type BoxBatter, type BoxPitcher, type BoxScore, type GameCommand, type Play, type DivisionTable, type Season, type SimPlayer, type TeamRecord, type World,
} from '../engine';
import { daysBetween } from '../data/schedule';
import { realParkAt } from './ballparks';
import { josa } from './names';

export type SeriesRound = 'wc' | 'semi' | 'po' | 'ks';

export const ROUND_LABEL: Record<SeriesRound, string> = {
  wc: '와일드카드 결정전', semi: '준플레이오프', po: '플레이오프', ks: '한국시리즈',
};

/** 경기 하나의 홈: true = 상위 팀 홈, false = 하위 팀 홈, 'n' = 중립 구장 (엔진에 중립 구장이 없어 상위 팀 홈으로 치고 표시만 중립, 임시 규칙) */
export type HomeSlot = boolean | 'n';

export interface RoundRule {
  /** 이기면 끝나는 승수 */
  need: number;
  /** 최대 경기 수 (무승부가 이어지면 여기서 멈추고 상위 팀이 올라간다) */
  maxGames: number;
  /** 상위 팀이 갖고 시작하는 승수 */
  highHeadStart: number;
  /** 경기별 홈 팀 (true = 상위 팀 홈). 칸이 모자라면 상위 팀 홈 */
  homePattern: HomeSlot[];
}

/** 시리즈 규칙 (임시값: 시리즈 길이·어드밴티지는 실제 규정 미확인. 한국시리즈 2-3-2는 출처 확인) */
export const RULES: Record<SeriesRound, RoundRule> = {
  wc: { need: 2, maxGames: 2, highHeadStart: 1, homePattern: [true, true] },
  semi: { need: 3, maxGames: 6, highHeadStart: 0, homePattern: [true, true, false, false, true, true] },
  po: { need: 3, maxGames: 6, highHeadStart: 0, homePattern: [true, true, false, false, true, true] },
  ks: { need: 4, maxGames: 9, highHeadStart: 0, homePattern: [true, true, false, false, false, true, true, true, true] },
};

/**
 * 양대 리그 해(1999·2000)의 시리즈 규칙 (양대 리그 조사값, 기획안 10.5). 무승부가 나면 더 치르는 칸(maxGames)은 임시값으로,
 * 지금 RULES처럼 3전 시리즈 1경기·7전 시리즈 2경기를 더 둔다. 더 치르는 경기는 상위 팀 홈(중립이 이어지는 규칙은 중립)
 */
export const TWO_LEAGUE_RULES = {
  /** 3전 2선승, 1차전 2위 팀 홈, 2차전 3위 팀 홈, 3차전 잠실 중립 */
  semi: { need: 2, maxGames: 4, highHeadStart: 0, homePattern: [true, false, 'n', 'n'] },
  /** 7전 4선승 2-3-2: 리그 1위 홈 1·2·6·7차전 */
  po: { need: 4, maxGames: 9, highHeadStart: 0, homePattern: [true, true, false, false, false, true, true, true, true] },
  /** 7전 4선승 2-2-3: 두 팀 모두 서울 구단이 아니면. 5·6·7차전 잠실 중립 */
  ks223: { need: 4, maxGames: 9, highHeadStart: 0, homePattern: [true, true, false, false, 'n', 'n', 'n', 'n', 'n'] },
  /** 7전 4선승 2-3-2: 서울 구단이 있으면 */
  ks232: { need: 4, maxGames: 9, highHeadStart: 0, homePattern: [true, true, false, false, false, true, true, true, true] },
} satisfies Record<string, RoundRule>;

/** 정규시즌이 끝나고 포스트시즌 첫 경기까지 쉬는 날 (임시값). 규칙 표에 가을야구 시작일이 있는 해(1988 올림픽)는 그날 (그보다 이르면 이 규칙) */
const REST_BEFORE = 3;

/** 가을야구 첫 경기 날짜 색인: 정규시즌 끝 + REST_BEFORE, 규칙 표의 시작일(`가을시작`)이 더 늦으면 그날 (일정 개편 기획안 2.3) */
export function postseasonStartDay(season: Pick<Season, 'schedule' | 'plan' | 'world'>): number {
  const day = season.schedule.length + REST_BEFORE;
  const fixed = season.world.schedule?.postseasonStart;
  return fixed ? Math.max(day, daysBetween(season.plan.opening, fixed)) : day;
}
/** 시리즈 사이에 쉬는 날 (임시값) */
const REST_BETWEEN = 2;

export interface SeriesGame {
  /** 일정 색인 (정규시즌 일정 뒤로 이어진다. 달력 날짜는 calendar.ts) */
  day: number;
  home: number;
  away: number;
  homeRuns: number;
  awayRuns: number;
  innings: number;
  box?: BoxScore;
  /** 중계 기록 (우리 구단 경기만, 저장하지 않는다) */
  plays?: Play[];
  /** 잠실 중립 경기 (계산은 home 팀 홈, 대진이 있는 해만) */
  neutral?: true;
}

export interface SeriesResult {
  round: SeriesRound;
  /** 상위 시드 팀 (구단 색인) */
  high: number;
  low: number;
  winsHigh: number;
  winsLow: number;
  /** 이긴 팀. 진행 중이면 -1 */
  winner: number;
  games: SeriesGame[];
  /** 시리즈 MVP (준플레이오프·플레이오프·한국시리즈, 끝난 시리즈. 2026-10-12부터) */
  mvp?: SeriesMvp;
  /** 대진(bracket)의 몇 번째 노드인가 (대진이 있는 해만) */
  node?: number;
  /** 이 시리즈의 규칙 (대진이 있는 해만. 없으면 RULES[round]) */
  rule?: RoundRule;
  /** 다음 경기 날짜 (대진이 있는 해만. 시리즈가 동시에 열린다) */
  nextDay?: number;
}

/** 대진의 자리: seeds의 몇 번째 구단, 또는 bracket 몇 번째 시리즈의 승자 */
export type Slot = { seed: number } | { winnerOf: number };

/** 대진의 시리즈 하나 (기획안 10.5). high가 상위 자리 */
export interface BracketNode {
  round: SeriesRound;
  high: Slot;
  low: Slot;
  rule: RoundRule;
  /** 두 팀 가운데 서울 구단(그 해 홈 구장이 잠실)이 있으면 이 규칙 (한국시리즈 2-3-2) */
  seoulRule?: RoundRule;
  /** 두 팀을 통합 순위(seeds 순서)로 상위·하위를 정한다 (한국시리즈) */
  byRank?: true;
}

/** 준플레이오프 판정 근거: 한 리그 3위와 다른 리그 2위 (대진 소식·화면용) */
export interface SemiCheck {
  third: number;
  second: number;
  pctThird: number;
  pctSecond: number;
  /** "드림 3위", "매직 2위" */
  thirdLabel: string;
  secondLabel: string;
  /** 3위가 앞서 준플레이오프를 연다 (승률이 같으면 동률 규칙) */
  open: boolean;
}

export interface SeriesMvp {
  id: string;
  name: string;
  team: number;
  /** 시리즈 기록 한 줄 */
  line: string;
}

export interface PostseasonResult {
  year: number;
  /** 진출 팀 (정규시즌 순위 순) */
  seeds: number[];
  /** 대진이 있는 해만: seeds마다 "드림 1위" 꼴 */
  seedLabels?: string[];
  bracket?: BracketNode[];
  series: SeriesResult[];
  champion: number;
  runnerUp: number;
}

/** 진행 중인 포스트시즌 (저장 가능) */
export interface PostseasonState {
  /** 2: 경기마다 따로 난수 줄기 (엔진 2, 2026-10-22). 1은 하나의 줄기를 이어 쓰던 예전 형식 */
  format: 2;
  /** 연장 이닝 제한 (리그 규정이 바뀌었을 때만, league/rules.ts) */
  maxInnings?: number;
  year: number;
  seed: string;
  seeds: number[];
  rounds: SeriesRound[];
  /** 끝났거나 진행 중인 시리즈 (마지막이 진행 중일 수 있다) */
  series: SeriesResult[];
  /** 다음 경기 날짜 (일정 색인). 대진이 있으면 열린 시리즈의 다음 경기 가운데 가장 이른 날 */
  day: number;
  done: boolean;
  /** 양대 리그 해의 대진 (기획안 10.5). 없으면 사다리 */
  bracket?: BracketNode[];
  /** 대진이 있는 해만: seeds마다 "드림 1위" 꼴 */
  seedLabels?: string[];
  /** 대진이 있는 해만: 준플레이오프 판정 근거 (두 리그 각각) */
  semiCheck?: SemiCheck[];
}

/** 진출 팀 수에 따른 라운드 순서 (낮은 라운드부터). 5팀이면 와일드카드부터 */
export function roundsFor(n: number): SeriesRound[] {
  if (n >= 5) return ['wc', 'semi', 'po', 'ks'];
  if (n === 4) return ['semi', 'po', 'ks'];
  if (n === 3) return ['po', 'ks'];
  return ['ks'];
}

/** 대진을 정한다 (아직 경기는 치르지 않는다). standings는 정규시즌 순위, n은 진출 팀 수 */
export function startPostseason(season: Season, standings: number[], n: number, seed: string): PostseasonState {
  const tables = season.divisionStandings();
  if (tables && tables.length === 2) {
    const b = bracketFor(standings, tables, season.teams, season.log, season.world.prevStandings);
    const st: PostseasonState = {
      format: 2, year: season.world.year, seed: `${seed}/postseason`, seeds: b.seeds, rounds: b.bracket.map((x) => x.round), series: [],
      day: postseasonStartDay(season), done: false, bracket: b.bracket, seedLabels: b.seedLabels, semiCheck: b.semiCheck,
    };
    openBracket(st, season.world, st.day);
    return st;
  }
  const seeds = standings.slice(0, Math.max(2, Math.min(n, standings.length)));
  const rounds = roundsFor(seeds.length);
  const rngSeed = `${seed}/postseason`;
  const st: PostseasonState = {
    format: 2, year: season.world.year, seed: rngSeed, seeds, rounds, series: [],
    day: postseasonStartDay(season), done: false,
  };
  openSeries(st, seeds[seeds.length - 1]);
  return st;
}

/** i번째 라운드 시리즈를 연다. 사다리: 가장 낮은 두 시드부터, 이긴 팀이 다음 상위 시드를 만난다 */
function openSeries(st: PostseasonState, challenger: number): void {
  const i = st.series.length;
  const round = st.rounds[i];
  const high = st.seeds[st.seeds.length - 2 - i];
  st.series.push({ round, high, low: challenger, winsHigh: RULES[round].highHeadStart, winsLow: 0, winner: -1, games: [] });
}

/**
 * 양대 리그 해의 대진 (기획안 10.5). tables는 리그별 순위(드림, 매직), order는 통합 순위.
 * 각 리그 1·2위가 나가고, 한 리그 3위가 다른 리그 2위보다 승률이 높으면(같으면 동률 규칙) 둘이 준플레이오프를 치러 이긴 팀이 2위 자리를 잇는다.
 * 플레이오프는 드림 1위 대 매직 2위, 매직 1위 대 드림 2위. 두 승자가 한국시리즈 (상위는 통합 순위). 난수를 쓰지 않는다
 */
export function bracketFor(order: number[], tables: DivisionTable[], teams: TeamRecord[], log: Season['log'], prev?: readonly number[]):
  { seeds: number[]; seedLabels: string[]; bracket: BracketNode[]; semiCheck: SemiCheck[] } {
  const semiCheck: SemiCheck[] = [];
  for (const [a, b] of [[0, 1], [1, 0]] as const) {
    const third = tables[a].teams[2];
    const second = tables[b].teams[1];
    if (third === undefined || second === undefined) continue;
    semiCheck.push({
      third, second, pctThird: winPct(teams[third]), pctSecond: winPct(teams[second]),
      thirdLabel: `${tables[a].name} 3위`, secondLabel: `${tables[b].name} 2위`,
      open: rankWithTiebreak([third, second], teams, log, prev)[0] === third,
    });
  }
  // 두 리그에서 동시에 조건이 채워질 수는 없다 (기획안 10.5). 그래도 첫 번째 하나만 쓴다
  const semi = semiCheck.find((c) => c.open);
  const qualifiers = [...tables.flatMap((d) => d.teams.slice(0, 2)), ...(semi ? [semi.third] : [])];
  const seeds = order.filter((t) => qualifiers.includes(t));
  const seedLabels = seeds.map((t) => {
    const d = tables.find((x) => x.teams.includes(t))!;
    return `${d.name} ${d.teams.indexOf(t) + 1}위`;
  });
  const seat = (t: number): Slot => ({ seed: seeds.indexOf(t) });
  const bracket: BracketNode[] = [];
  if (semi) bracket.push({ round: 'semi', high: seat(semi.second), low: seat(semi.third), rule: TWO_LEAGUE_RULES.semi });
  const base = bracket.length;
  for (const k of [0, 1]) {
    const second = tables[1 - k].teams[1];
    const low: Slot = semi && semi.second === second ? { winnerOf: 0 } : seat(second);
    bracket.push({ round: 'po', high: seat(tables[k].teams[0]), low, rule: TWO_LEAGUE_RULES.po });
  }
  bracket.push({ round: 'ks', high: { winnerOf: base }, low: { winnerOf: base + 1 }, rule: TWO_LEAGUE_RULES.ks223, seoulRule: TWO_LEAGUE_RULES.ks232, byRank: true });
  return { seeds, seedLabels, bracket, semiCheck };
}

/**
 * 그 해 홈 구장이 잠실인 구단 (실제 구장 역사, 기획안 10.5 서울 구단 판정). 구장 자료(parks.json)가 있으면 구장 ID로 본다
 * (자료의 이름은 "서울종합운동장 야구장"이라 이름에 '잠실'이 없다), 없으면 코드 안 표의 이름
 */
export function isSeoulTeam(world: Pick<World, 'teams' | 'year'>, team: number): boolean {
  const p = realParkAt(world.teams[team].franchise, world.year);
  return !!p && (p.parkId ? p.parkId.startsWith('jamsil') : p.name.includes('잠실'));
}

/** 대진에서 양쪽 자리가 정해졌고 아직 열지 않은 시리즈를 모두 연다. day: 앞 시리즈가 없는 노드의 첫 경기 날 */
export function openBracket(st: PostseasonState, world: Pick<World, 'teams' | 'year'>, day: number): void {
  const seriesOf = (i: number) => st.series.find((x) => x.node === i);
  const team = (s: Slot): number => ('seed' in s ? st.seeds[s.seed] : seriesOf(s.winnerOf)?.winner ?? -1);
  st.bracket!.forEach((node, i) => {
    if (seriesOf(i)) return;
    let high = team(node.high);
    let low = team(node.low);
    if (high < 0 || low < 0) return;
    if (node.byRank && st.seeds.indexOf(low) < st.seeds.indexOf(high)) [high, low] = [low, high];
    const rule = node.seoulRule && (isSeoulTeam(world, high) || isSeoulTeam(world, low)) ? node.seoulRule : node.rule;
    // 앞 시리즈가 있으면 그 시리즈들이 모두 끝난 다음 날부터 REST_BETWEEN을 쉬고 연다 (사다리와 같은 간격)
    const deps = [node.high, node.low].flatMap((s) => ('winnerOf' in s ? [seriesOf(s.winnerOf)!] : []));
    const first = deps.length ? Math.max(...deps.map((x) => x.games[x.games.length - 1].day)) + 1 + REST_BETWEEN : day;
    st.series.push({ round: node.round, high, low, winsHigh: rule.highHeadStart, winsLow: 0, winner: -1, games: [], node: i, rule, nextDay: first });
  });
}

/** 시리즈의 규칙 (대진이 있으면 그 노드의 규칙) */
export function seriesRule(x: SeriesResult): RoundRule {
  return x.rule ?? RULES[x.round];
}

/** 시리즈 game번째 경기(0부터)의 홈과 원정, 중립 여부 */
export function seriesHome(x: SeriesResult, game: number): { home: number; away: number; neutral: boolean } {
  const slot = seriesRule(x).homePattern[game] ?? true;
  const highHome = slot !== false;
  return { home: highHome ? x.high : x.low, away: highHome ? x.low : x.high, neutral: slot === 'n' };
}

/** 열려 있고 끝나지 않은 시리즈 (다음 경기 순: 날짜, 같으면 대진 순서). 사다리는 지금 시리즈 하나 */
export function openSeriesList(st: PostseasonState): SeriesResult[] {
  if (st.done) return [];
  if (!st.bracket) return [st.series[st.series.length - 1]];
  return st.series.filter((x) => x.winner < 0).sort((a, b) => a.nextDay! - b.nextDay! || a.node! - b.node!);
}

/** 지금 진행 중인 시리즈 = 다음 경기를 치를 시리즈 (끝났으면 null) */
export function currentSeries(st: PostseasonState): SeriesResult | null {
  if (!st.bracket) return st.done ? null : st.series[st.series.length - 1];
  return openSeriesList(st)[0] ?? null;
}

/** 다음 경기 날(st.day)에 경기가 있는 시리즈 (동시 시리즈면 둘일 수 있다) */
export function seriesToday(st: PostseasonState): SeriesResult[] {
  return openSeriesList(st).filter((x) => (x.nextDay ?? st.day) === st.day);
}

type BracketView = Pick<PostseasonState, 'seeds' | 'seedLabels' | 'bracket' | 'series'>;

/** 구단 이름 앞에 대진 자리 ("드림 1위 현대"). 대진이 없으면 이름만 */
export function seedName(st: Pick<PostseasonState, 'seeds' | 'seedLabels'>, t: number, name: (t: number) => string): string {
  const label = st.seedLabels?.[st.seeds.indexOf(t)];
  return label ? `${label} ${name(t)}` : name(t);
}

/** 대진 노드의 두 자리 ("드림 1위 현대", "준플레이오프 승자"). 이미 열린 시리즈면 실제 두 팀 */
export function nodeSides(st: BracketView, i: number, name: (t: number) => string): [string, string] {
  const node = st.bracket![i];
  const x = st.series.find((s) => s.node === i);
  if (x) return [seedName(st, x.high, name), seedName(st, x.low, name)];
  const side = (s: Slot) => ('seed' in s ? seedName(st, st.seeds[s.seed], name) : `${ROUND_LABEL[st.bracket![s.winnerOf].round]} 승자`);
  return [side(node.high), side(node.low)];
}

/** 대진 소식 한 줄: "준플레이오프 매직 2위 롯데 대 드림 3위 삼성, 플레이오프 드림 1위 현대 대 준플레이오프 승자 · 매직 1위 LG 대 드림 2위 두산" */
export function bracketText(st: BracketView, name: (t: number) => string): string {
  const parts: string[] = [];
  st.bracket!.forEach((node, i) => {
    if (node.round === 'ks') return;
    const [h, l] = nodeSides(st, i, name);
    const prev = st.bracket![i - 1];
    parts.push(`${prev?.round === node.round ? ' · ' : (parts.length ? ', ' : '') + ROUND_LABEL[node.round] + ' '}${h} 대 ${l}`);
  });
  return parts.join('');
}

/** 준플레이오프 판정 문장 (대진 소식·화면, 기획안 10.5) */
export function semiCheckText(st: Pick<PostseasonState, 'semiCheck'>, name: (t: number) => string): string {
  const checks = st.semiCheck ?? [];
  if (!checks.length) return '';
  const f = (p: number) => p.toFixed(3).replace(/^0/, '');
  const open = checks.find((c) => c.open);
  if (open) {
    const third = `${open.thirdLabel} ${name(open.third)}`;
    const second = `${open.secondLabel} ${name(open.second)}`;
    return open.pctThird === open.pctSecond
      ? `${third}${josa(third, '이가')} ${second}${josa(second, '와과')} 승률이 같고(${f(open.pctThird)}) 동률 규칙에서 앞서 준플레이오프를 치릅니다.`
      : `${third}(${f(open.pctThird)})${josa(third, '이가')} ${second}(${f(open.pctSecond)})보다 승률이 높아 준플레이오프를 치릅니다.`;
  }
  return `두 리그 3위 모두 다른 리그 2위보다 승률이 낮아 준플레이오프가 없습니다 (${checks.map((c) => `${c.thirdLabel} ${name(c.third)} ${f(c.pctThird)} < ${c.secondLabel} ${name(c.second)} ${f(c.pctSecond)}`).join(', ')}).`;
}

/** 아직 탈락하지 않은 팀인가 (진출하지 못한 팀은 false) */
export function stillAlive(st: PostseasonState, team: number): boolean {
  if (!st.seeds.includes(team)) return false;
  if (st.done) return false;
  for (const x of st.series) if (x.winner >= 0 && x.winner !== team && (x.high === team || x.low === team)) return false;
  return true;
}

/**
 * 경기마다 따로 난수 줄기: 라운드와 그 시리즈의 경기 번호 (docs/경기엔진2_기획안.md 3.7.1).
 * 대진이 있으면 같은 라운드에 시리즈가 둘이라 노드 번호를 넣는다 (기획안 10.5. 사다리 키는 그대로)
 */
export function seriesRngKey(x: Pick<SeriesResult, 'round' | 'node'>, game: number): string {
  return x.node !== undefined ? `ps/${x.round}.${x.node}/${game}` : `ps/${x.round}/${game}`;
}

/**
 * 다음 경기를 치른다. 끝났으면 null. 시리즈가 끝나면 다음 시리즈를 연다. command: 직접 지휘 (그 구단 경기일 때만 쓴다).
 * which: 대진이 있는 해에 같은 날 경기가 있는 다른 시리즈를 먼저 치를 때 (미리보기). 두 시리즈는 구단이 겹치지 않고 난수 줄기가 따로라 같은 날 안의 순서는 결과에 닿지 않는다
 */
export function playNextGame(st: PostseasonState, season: Season, command: GameCommand | null = null, which?: SeriesResult): SeriesGame | null {
  const x = which ?? currentSeries(st);
  if (!x || x.winner >= 0) return null;
  const rule = seriesRule(x);
  const { home, away, neutral } = seriesHome(x, x.games.length);
  const day = x.nextDay ?? st.day;
  const rng = new Rng(st.seed).fork(seriesRngKey(x, x.games.length));
  const n = season.world.players.length;
  const rec = { bat: Array.from({ length: n }, emptyBatLine), pit: Array.from({ length: n }, emptyPitLine), totals: emptyLeagueCounters() };
  const { result: r, home: hl, away: al, plays } = season.playExtraGame(home, away, day, rng, st.maxInnings ?? postseasonMaxInnings(season.world.rules), rec, command);
  const g: SeriesGame = {
    day, home, away, homeRuns: r.homeRuns, awayRuns: r.awayRuns, innings: r.innings,
    box: {
      lineScore: r.lineScore,
      home: { batters: boxBat(hl, rec.bat, r.homeSubs), pitchers: boxPit(r.homeStaff, rec.pit) },
      away: { batters: boxBat(al, rec.bat, r.awaySubs), pitchers: boxPit(r.awayStaff, rec.pit) },
    },
    ...(plays ? { plays } : {}),
    ...(neutral ? { neutral: true as const } : {}),
  };
  x.games.push(g);
  if (r.homeRuns !== r.awayRuns) {
    if ((home === x.high) === (r.homeRuns > r.awayRuns)) x.winsHigh++;
    else x.winsLow++;
  }
  if (st.bracket) {
    finishBracketGame(st, x, season);
    return g;
  }
  st.day++;
  if (x.winsHigh >= rule.need || x.winsLow >= rule.need || x.games.length >= rule.maxGames) {
    // 승수가 같거나 경기 수 한도에 걸리면 상위 팀이 올라간다 (임시 규칙)
    x.winner = x.winsLow >= rule.need || x.winsLow > x.winsHigh ? x.low : x.high;
    if (MVP_ROUNDS.includes(x.round)) {
      const mvp = seriesMvp(x, season.world.players);
      if (mvp) x.mvp = mvp;
    }
    if (st.series.length === st.rounds.length) st.done = true;
    else {
      st.day += REST_BETWEEN;
      openSeries(st, x.winner);
    }
  }
  return g;
}

/** 시리즈가 끝났나 보고 승자·MVP를 정한다 (사다리와 같은 규칙) */
function settleSeries(x: SeriesResult, players: SimPlayer[]): boolean {
  const rule = seriesRule(x);
  if (!(x.winsHigh >= rule.need || x.winsLow >= rule.need || x.games.length >= rule.maxGames)) return false;
  // 승수가 같거나 경기 수 한도에 걸리면 상위 팀이 올라간다 (임시 규칙)
  x.winner = x.winsLow >= rule.need || x.winsLow > x.winsHigh ? x.low : x.high;
  if (MVP_ROUNDS.includes(x.round)) {
    const mvp = seriesMvp(x, players);
    if (mvp) x.mvp = mvp;
  }
  return true;
}

/** 대진이 있는 해: 경기 하나 뒤 시리즈 마감, 다음 노드 열기, 다음 경기 날짜 */
function finishBracketGame(st: PostseasonState, x: SeriesResult, season: Season): void {
  const day = x.games[x.games.length - 1].day;
  x.nextDay = day + 1;
  if (settleSeries(x, season.world.players)) {
    delete x.nextDay;
    openBracket(st, season.world, day + 1);
    if (st.series.length === st.bracket!.length && st.series.every((s) => s.winner >= 0)) st.done = true;
  }
  const open = st.series.filter((s) => s.winner < 0).map((s) => s.nextDay!);
  st.day = open.length ? Math.min(...open) : Math.max(st.day, day + 1);
}

function boxBat(lineup: SimPlayer[], bat: ReturnType<typeof emptyBatLine>[], subs: { idx: number; order: number; kind: 'PH' | 'PR' | 'DEF' }[] = []): BoxBatter[] {
  const line = (idx: number): BoxBatter => {
    const b = bat[idx];
    return { idx, ab: b.ab, r: b.r, h: b.h, rbi: b.rbi, hr: b.hr, bb: b.bb, so: b.so, d: b.d, t: b.t, sb: b.sb };
  };
  // 타순대로, 교체로 들어온 타자는 그 타순의 선수 바로 아래에
  return lineup.flatMap((p, i) => [
    { ...line(p.idx), order: i + 1 },
    ...subs.filter((s) => s.order === i).map((s) => ({ ...line(s.idx), order: i + 1, sub: s.kind })),
  ]);
}

function boxPit(staff: number[], pit: ReturnType<typeof emptyPitLine>[]): BoxPitcher[] {
  return staff.map((idx) => {
    const q = pit[idx];
    return { idx, outs: q.outs, bf: q.bf, h: q.h, r: q.r, er: q.er, bb: q.bb, so: q.so, hr: q.hr, np: q.np, hld: q.hld, bsv: q.bsv };
  });
}

// ---- 가을야구 개인 기록과 시리즈 MVP (2026-10-12)

/** 시리즈 MVP를 주는 라운드 (KBO: 준플레이오프·플레이오프·한국시리즈. 와일드카드는 없다) */
export const MVP_ROUNDS: SeriesRound[] = ['semi', 'po', 'ks'];

export interface PsBat { g: number; ab: number; r: number; h: number; hr: number; rbi: number; bb: number; so: number }
export interface PsPit { g: number; outs: number; h: number; er: number; bb: number; so: number; hr: number }
/** 저장(SeasonLine.pbat·ppit)에 쓰는 키 순서 */
export const PS_BAT_KEYS: (keyof PsBat)[] = ['g', 'ab', 'r', 'h', 'hr', 'rbi', 'bb', 'so'];
export const PS_PIT_KEYS: (keyof PsPit)[] = ['g', 'outs', 'h', 'er', 'bb', 'so', 'hr'];

export interface PsLine { idx: number; team: number; bat: PsBat | null; pit: PsPit | null }

/** 경기들의 박스스코어로 선수별 합계 (박스스코어가 없는 경기는 빠진다: 결산 뒤 결과, 예전 저장) */
export function postseasonLines(games: SeriesGame[]): Map<number, PsLine> {
  const out = new Map<number, PsLine>();
  const get = (idx: number, team: number) => out.get(idx) ?? out.set(idx, { idx, team, bat: null, pit: null }).get(idx)!;
  for (const g of games) {
    if (!g.box) continue;
    for (const [side, team] of [[g.box.home, g.home], [g.box.away, g.away]] as const) {
      const seen = new Set<number>();
      for (const b of side.batters) {
        const l = get(b.idx, team);
        const t = (l.bat ??= { g: 0, ab: 0, r: 0, h: 0, hr: 0, rbi: 0, bb: 0, so: 0 });
        if (!seen.has(b.idx)) { t.g++; seen.add(b.idx); }
        t.ab += b.ab; t.r += b.r; t.h += b.h; t.hr += b.hr; t.rbi += b.rbi; t.bb += b.bb; t.so += b.so;
      }
      for (const q of side.pitchers) {
        const l = get(q.idx, team);
        const t = (l.pit ??= { g: 0, outs: 0, h: 0, er: 0, bb: 0, so: 0, hr: 0 });
        t.g++; t.outs += q.outs; t.h += q.h; t.er += q.er; t.bb += q.bb; t.so += q.so; t.hr += q.hr;
      }
    }
  }
  return out;
}

/** 저장한 줄(SeasonLine.pbat·ppit)을 기록으로 */
export function psFromRecord(idx: number, pbat?: number[], ppit?: number[]): PsLine {
  const bat = pbat ? Object.fromEntries(PS_BAT_KEYS.map((k, i) => [k, pbat[i] ?? 0])) as unknown as PsBat : null;
  const pit = ppit ? Object.fromEntries(PS_PIT_KEYS.map((k, i) => [k, ppit[i] ?? 0])) as unknown as PsPit : null;
  return { idx, team: -1, bat, pit };
}

const ip = (outs: number) => `${Math.floor(outs / 3)}${outs % 3 ? ` ${outs % 3}/3` : ''}`;

/** 가을야구 기록 한 줄 (타자는 타격, 투수는 투구) */
export function psLineText(l: PsLine, isPitcher: boolean): string {
  if (isPitcher && l.pit) {
    const p = l.pit;
    const era = p.outs ? ((p.er * 27) / p.outs).toFixed(2) : '-';
    return `${p.g}경기 ${ip(p.outs)}이닝 평균자책 ${era} ${p.so}탈삼진`;
  }
  const b = l.bat;
  if (!b) return '-';
  const avg = b.ab ? (b.h / b.ab).toFixed(3).replace(/^0/, '') : '-';
  return `타율 ${avg} (${b.ab}타수 ${b.h}안타)${b.hr ? ` ${b.hr}홈런` : ''} ${b.rbi}타점`;
}

/**
 * 시리즈 MVP: 이긴 팀 선수 가운데 시리즈 기여가 가장 큰 선수 (실제 시상도 거의 이긴 팀에서 나온다).
 * 타자 = 안타 + 2×홈런 + 0.8×타점 + 0.5×(볼넷 + 득점) − 0.3×범타, 투수 = 2×이닝 − 2×자책 + 0.3×탈삼진 (임시값. 실제 한국시리즈 MVP는 투수가 약 1/3이라 10시즌 측정으로 맞춤)
 */
export function seriesMvp(x: SeriesResult, players: SimPlayer[]): SeriesMvp | null {
  if (x.winner < 0) return null;
  const lines = postseasonLines(x.games);
  let best: { l: PsLine; score: number; pitcher: boolean } | null = null;
  for (const l of lines.values()) {
    if (l.team !== x.winner) continue;
    const p = players[l.idx];
    if (!p) continue;
    const bat = !p.isPitcher && l.bat ? l.bat.h + 2 * l.bat.hr + 0.8 * l.bat.rbi + 0.5 * (l.bat.bb + l.bat.r) - 0.3 * (l.bat.ab - l.bat.h) : -Infinity;
    const pit = p.isPitcher && l.pit ? 2 * (l.pit.outs / 3) - 2 * l.pit.er + 0.3 * l.pit.so : -Infinity;
    const score = Math.max(bat, pit);
    if (!best || score > best.score || (score === best.score && p.id < players[best.l.idx].id)) best = { l, score, pitcher: pit > bat };
  }
  if (!best || !Number.isFinite(best.score)) return null;
  const p = players[best.l.idx];
  return { id: p.id, name: p.name, team: best.l.team, line: psLineText(best.l, best.pitcher) };
}

/** 남은 경기를 모두 치른다 */
export function finishPostseason(st: PostseasonState, season: Season): void {
  while (!st.done) playNextGame(st, season);
}

/** 끝난 포스트시즌의 결과 (박스스코어는 빼고 가볍게) */
export function resultOf(st: PostseasonState): PostseasonResult {
  if (!st.done) throw new Error('포스트시즌이 끝나지 않았습니다');
  const last = st.series[st.series.length - 1];
  return {
    year: st.year, seeds: st.seeds,
    ...(st.bracket ? { seedLabels: st.seedLabels, bracket: st.bracket } : {}),
    series: st.series.map(({ nextDay: _n, ...x }) => ({ ...x, games: x.games.map(({ box: _box, plays: _plays, ...g }) => g) })),
    champion: last.winner, runnerUp: last.winner === last.high ? last.low : last.high,
  };
}

/** 포스트시즌을 한 번에 치른다 (같은 시즌·같은 seed면 한 경기씩 진행한 것과 결과가 같다) */
export function simulatePostseason(season: Season, standings: number[], n: number, seed: string): PostseasonResult {
  const st = startPostseason(season, standings, n, seed);
  finishPostseason(st, season);
  return resultOf(st);
}
