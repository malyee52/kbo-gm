// 엔진 검증: 같은 해를 여러 번 시뮬레이션해 리그 평균을 실제 기록과 비교한다.
//
// 사용법:  npx tsx tools/validate_engine.ts [--years 2025,2015] [--seasons 300] [--params '{"doublePlay":0.5}'] [--out reports/x.md]
//
// 그 해의 실제 로스터(그 해 기록이 있는 선수 전원)에 직전 3시즌 기준 능력을 주고 돌린다.
// 타석 결과 비율(안타 종류, 홈런, 볼넷, 삼진)은 환경 맞춤 단계에서 목표에 맞추므로 일치하는 것이 당연하다.
// 엔진이 실제로 시험받는 값은 득점, 병살, 무승부, 홈 승률, 팀 승률 분포처럼 타석이 이어지면서 생기는 값이다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import type { SeasonData } from '../src/data/types';
import { calibrate, DEFAULT_PARAMS, Rng, simulateSeason, winPct, worldForYear, type EngineParams, type World } from '../src/engine';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const years = (arg('years') ?? '2025').split(',').map(Number);
const nSeasons = Number(arg('seasons') ?? 300);
const params: EngineParams = { ...DEFAULT_PARAMS, ...(arg('params') ? JSON.parse(arg('params')!) : {}) };
const outPath = arg('out');
/** actual이면 선수별 출전 가능 기간을 그 해 실제 출전량에 맞춘다 */
const usage = arg('usage') ?? 'random';

interface Metrics {
  avg: number;
  runs: number;
  era: number;
  unearned: number;
  s1: number;
  d2: number;
  t3: number;
  hr: number;
  bb: number;
  so: number;
  gdp: number;
  sf: number;
  sac: number;
  sb: number;
  tie: number;
  home: number;
  sd: number;
  top9: number;
  top5: number;
  paPerGame: number;
}

const LABELS: [keyof Metrics, string, number, 'emergent' | 'calibrated' | 'usage'][] = [
  ['runs', '팀 경기당 득점', 2, 'emergent'],
  ['era', '평균자책', 2, 'emergent'],
  ['unearned', '비자책 실점 비율', 3, 'emergent'],
  ['gdp', '타석당 병살', 4, 'emergent'],
  ['sf', '타석당 희생플라이', 4, 'emergent'],
  ['sac', '타석당 희생번트', 4, 'emergent'],
  ['sb', '팀 경기당 도루', 2, 'emergent'],
  ['tie', '무승부 비율', 3, 'emergent'],
  ['home', '홈 승률', 3, 'emergent'],
  ['sd', '팀 승률 표준편차', 3, 'emergent'],
  ['paPerGame', '팀 경기당 타석', 1, 'emergent'],
  ['top9', '타석 상위 9명 비중', 3, 'usage'],
  ['top5', '이닝 상위 5명 비중', 3, 'usage'],
  ['avg', '타율', 3, 'calibrated'],
  ['s1', '타석당 단타', 4, 'calibrated'],
  ['d2', '타석당 2루타', 4, 'calibrated'],
  ['t3', '타석당 3루타', 4, 'calibrated'],
  ['hr', '타석당 홈런', 4, 'calibrated'],
  ['bb', '타석당 볼넷', 4, 'calibrated'],
  ['so', '타석당 삼진', 4, 'calibrated'],
];

function sd(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

function topShare(values: number[], k: number): number {
  const s = [...values].sort((a, b) => b - a);
  const total = s.reduce((a, b) => a + b, 0);
  return total > 0 ? s.slice(0, k).reduce((a, b) => a + b, 0) / total : 0;
}

function actualMetrics(s: SeasonData, pitcherIds: Set<string>): Metrics {
  const L = s.league;
  let hw = 0;
  let hl = 0;
  for (const t of s.teams) {
    const [w, , l] = t.home.split('-').map(Number);
    hw += w;
    hl += l;
  }
  const byTeamPa = new Map<string, number[]>();
  for (const r of s.bat) if (!pitcherIds.has(r.id)) (byTeamPa.get(r.team) ?? byTeamPa.set(r.team, []).get(r.team)!).push(r.pa);
  const byTeamOuts = new Map<string, number[]>();
  for (const r of s.pit) (byTeamOuts.get(r.team) ?? byTeamOuts.set(r.team, []).get(r.team)!).push(r.outs);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    avg: L.avg, runs: L.runsPerTeamGame, era: L.era, unearned: 1 - L.er / L.runsAllowed,
    s1: L.rates.s1, d2: L.rates.d2, t3: L.rates.t3, hr: L.rates.hr, bb: L.rates.bb, so: L.rates.so,
    gdp: L.gdpPerPa, sf: L.sfPerPa, sac: L.sacPerPa, sb: L.sb / L.teamGames,
    tie: s.teams.reduce((a, t) => a + t.t, 0) / L.teamGames, home: hw / (hw + hl),
    sd: sd(s.teams.map((t) => t.w / (t.w + t.l))),
    top9: mean([...byTeamPa.values()].map((v) => topShare(v, 9))),
    top5: mean([...byTeamOuts.values()].map((v) => topShare(v, 5))),
    paPerGame: L.pa / L.teamGames,
  };
}

function simMetrics(world: World, n: number, seedBase: string): { mean: Metrics; se: Metrics; ms: number } {
  const cal = calibrate(world, { ...params, pilotSeasons: 12 }, new Rng(`${seedBase}-cal`));
  const rows: Metrics[] = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const r = simulateSeason(world, params, `${seedBase}-${i}`, { cal });
    const T = r.totals;
    const teamGames = T.games * 2;
    const decided = T.games - T.ties;
    const paByTeam = world.teams.map((t) => t.org.filter((p) => !p.isPitcher).map((p) => r.bat[p.idx].pa));
    const outsByTeam = world.teams.map((t) => t.org.filter((p) => p.isPitcher).map((p) => r.pit[p.idx].outs));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    rows.push({
      avg: T.h / T.ab, runs: T.r / teamGames, era: (T.er * 27) / T.outs, unearned: 1 - T.er / T.r,
      s1: (T.h - T.d - T.t - T.hr) / T.pa, d2: T.d / T.pa, t3: T.t / T.pa, hr: T.hr / T.pa, bb: T.bb / T.pa, so: T.so / T.pa,
      gdp: T.gdp / T.pa, sf: T.sf / T.pa, sac: T.sac / T.pa, sb: T.sb / teamGames, tie: T.ties / T.games, home: T.homeWins / decided,
      sd: sd(r.teams.map(winPct)), top9: mean(paByTeam.map((v) => topShare(v, 9))), top5: mean(outsByTeam.map((v) => topShare(v, 5))),
      paPerGame: T.pa / teamGames,
    });
  }
  const keys = Object.keys(rows[0]) as (keyof Metrics)[];
  const mean = {} as Metrics;
  const se = {} as Metrics;
  for (const k of keys) {
    const xs = rows.map((r) => r[k]);
    mean[k] = xs.reduce((a, b) => a + b, 0) / xs.length;
    se[k] = sd(xs) / Math.sqrt(xs.length);
  }
  return { mean, se, ms: Date.now() - t0 };
}

const store = loadDataStore();
const pitcherIds = new Set([...store.players.values()].filter((p) => p.kind === 'P').map((p) => p.id));
const out: string[] = [];
const say = (s = '') => {
  console.log(s);
  out.push(s);
};

say(`# 엔진 검증 결과`);
say();
say(`시즌당 ${nSeasons}회 반복. 차이는 (시뮬 − 실제) ÷ 실제.`);
say();
const summary: { year: number; diffs: Record<string, number> }[] = [];
for (const year of years) {
  const season = store.season(year);
  if (!season) {
    say(`${year}: 데이터 없음`);
    continue;
  }
  const world = worldForYear(store, year, params);
  if (usage === 'actual') {
    const bat = new Map(season.bat.map((r) => [r.id, r]));
    const pit = new Map(season.pit.map((r) => [r.id, r]));
    const G = world.gamesPerTeam;
    for (const p of world.players) {
      if (p.isPitcher) {
        const r = pit.get(p.id);
        const starts = r ? (r.gs ?? (r.g > 0 && r.outs / r.g >= 12 ? r.g : 0)) : 0;
        const asStarter = starts / (G / 5);
        const asReliever = r ? (r.g - starts) / (G * 0.42) : 0;
        p.availability = Math.min(1, asStarter + asReliever);
      } else {
        const r = bat.get(p.id);
        p.availability = Math.min(1, (r?.pa ?? 0) / (G * 3.9));
      }
    }
  }
  const actual = actualMetrics(season, pitcherIds);
  const { mean, ms } = simMetrics(world, nSeasons, `validate-${year}`);
  say(`## ${year}년 (${world.teams.length}구단, 팀당 ${world.gamesPerTeam}경기${season.complete ? '' : ', 진행 중 시즌'})`);
  say();
  say(`| 구분 | 지표 | 실제 | 시뮬 | 차이 |`);
  say(`|---|---|---:|---:|---:|`);
  const diffs: Record<string, number> = {};
  for (const [k, label, digits, kind] of LABELS) {
    const d = actual[k] !== 0 ? (mean[k] - actual[k]) / actual[k] : 0;
    diffs[k] = d;
    const kindLabel = kind === 'emergent' ? '결과' : kind === 'usage' ? '기용' : '맞춤';
    say(`| ${kindLabel} | ${label} | ${actual[k].toFixed(digits)} | ${mean[k].toFixed(digits)} | ${(d * 100).toFixed(1)}% |`);
  }
  say();
  say(`소요 ${(ms / 1000).toFixed(1)}초 (시즌당 ${(ms / nSeasons).toFixed(0)}ms)`);
  say();
  summary.push({ year, diffs });
}

if (summary.length > 1) {
  say(`## 연도별 차이 요약`);
  say();
  const cols: (keyof Metrics)[] = ['runs', 'era', 'unearned', 'gdp', 'sf', 'sac', 'sb', 'paPerGame', 'tie', 'home', 'sd', 'top9', 'top5', 'avg', 'hr', 'bb', 'so'];
  const name = Object.fromEntries(LABELS.map(([k, l]) => [k, l]));
  say(`| 연도 | ${cols.map((c) => name[c]).join(' | ')} |`);
  say(`|---|${cols.map(() => '---:').join('|')}|`);
  for (const s of summary) say(`| ${s.year} | ${cols.map((c) => `${(s.diffs[c] * 100).toFixed(1)}%`).join(' | ')} |`);
  say();
}

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out.join('\n') + '\n', 'utf-8');
  console.log(`저장: ${outPath}`);
}
