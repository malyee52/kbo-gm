// 팀 격차 재측정 (엔진 2 15단계, docs/경기엔진2_기획안.md 8장): 팀 승률 표준편차가 좁은 원인을 설정을 하나씩 바꿔 나눠 잰다.
//
// 사용법:  npx tsx tools/team_spread.ts [--years 2025,2019,2012] [--seasons 100] [--variants base,season,noInj,noRest,noChurn,usage] [--out reports/team-spread.md]
//
// 시드·환경 맞춤은 validate(tools/validate_engine.ts)와 같다 (`validate-{연도}-{i}`). 설정마다 맞춤을 새로 한다.
// - 승률 퍼짐 = 시즌마다 구단 승률 표준편차의 평균. 실제와 같은 잣대.
// - 실력 몫 = 운(144경기 동전 던지기, p(1−p)/경기)을 뺀 퍼짐: √(퍼짐² − 운²). 시뮬은 같은 구단을 여러 번 돌리므로
//   "구단별 평균 승률의 표준편차"(시즌 수만큼 운이 줄어든 값)로도 잰다.
// - 득점·실점 퍼짐 = 구단 경기당 득점·실점 표준편차. 피타고리안 어긋남 = 승률 − 득실 기대 승률(지수 1.83)의 표준편차.
// - 상관 = 시뮬 구단별 평균 득점·실점과 실제 구단 득점·실점의 상관.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import type { SeasonData } from '../src/data/types';
import { calibrate, DEFAULT_PARAMS, Rng, simulateSeason, winPct, worldForYear, type EngineParams, type World } from '../src/engine';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const years = (arg('years') ?? '2025,2019,2012').split(',').map(Number);
const nSeasons = Number(arg('seasons') ?? 100);
const outPath = arg('out');

interface Variant {
  key: string;
  label: string;
  params: EngineParams;
  /** 선수별 출전 가능 기간을 그 해 실제 출전량에 맞춘다 (validate --usage actual과 같은 식) */
  actualUsage?: boolean;
}

const D = DEFAULT_PARAMS;
const ALL: Variant[] = [
  { key: 'base', label: '지금 (예측 능력)', params: D },
  { key: 'season', label: '역사 재현 능력 (그 시즌 중심)', params: { ...D, ratingBasis: 'season' } },
  {
    key: 'noInj', label: '부상 없음',
    params: { ...D, injury: { ...D.injury, base: 0, eventChance: 0, inGame: { ...D.injury.inGame, perPitch: 0, perRun: 0, perField: 0 } } },
  },
  { key: 'noRest', label: '야수 휴식 없음', params: { ...D, restChance: 0, catcherRestChance: 0 } },
  { key: 'noChurn', label: '엔트리 순환 없음', params: { ...D, rosterChurn: 0 } },
  { key: 'usage', label: '출전 기간 = 실제 출전량', params: D, actualUsage: true },
];
const variants = (arg('variants') ?? ALL.map((v) => v.key).join(',')).split(',').map((k) => {
  const v = ALL.find((x) => x.key === k);
  if (!v) throw new Error(`설정 ${k} 없음 (${ALL.map((x) => x.key).join(', ')})`);
  return v;
});

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
function corr(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}
const pyth = (rs: number, ra: number) => rs ** 1.83 / (rs ** 1.83 + ra ** 1.83);
function topShare(values: number[], k: number): number {
  const s = [...values].sort((a, b) => b - a);
  const total = s.reduce((a, b) => a + b, 0);
  return total > 0 ? s.slice(0, k).reduce((a, b) => a + b, 0) / total : 0;
}

interface TeamLine { w: number; l: number; g: number; rs: number; ra: number }

interface Spread {
  sdW: number;
  /** 운을 뺀 실력 몫 (시즌 하나 잣대) */
  talent: number;
  sdRS: number;
  sdRA: number;
  /** 승률 − 득실 기대 승률의 표준편차 */
  pyth: number;
  /** 득실 기대 승률의 표준편차 */
  sdPyth: number;
  top9: number;
}

function spreadOf(teams: TeamLine[]): Omit<Spread, 'top9'> {
  const wp = teams.map((t) => t.w / (t.w + t.l));
  const sdW = sd(wp);
  const luck2 = mean(teams.map((t, i) => (wp[i] * (1 - wp[i])) / (t.w + t.l)));
  const py = teams.map((t) => pyth(t.rs, t.ra));
  return {
    sdW,
    talent: Math.sqrt(Math.max(0, sdW ** 2 - luck2)),
    sdRS: sd(teams.map((t) => t.rs / t.g)),
    sdRA: sd(teams.map((t) => t.ra / t.g)),
    pyth: sd(wp.map((w, i) => w - py[i])),
    sdPyth: sd(py),
  };
}

function actualTeams(s: SeasonData): { names: string[]; lines: TeamLine[] } {
  const rs = new Map<string, number>(), ra = new Map<string, number>();
  for (const r of s.bat) rs.set(r.team, (rs.get(r.team) ?? 0) + r.r);
  for (const r of s.pit) ra.set(r.team, (ra.get(r.team) ?? 0) + r.r);
  return {
    names: s.teams.map((t) => t.name),
    lines: s.teams.map((t) => ({ w: t.w, l: t.l, g: t.g, rs: rs.get(t.name) ?? 0, ra: ra.get(t.name) ?? 0 })),
  };
}

function actualTop9(s: SeasonData, pitcherIds: Set<string>): number {
  const by = new Map<string, number[]>();
  for (const r of s.bat) if (!pitcherIds.has(r.id)) (by.get(r.team) ?? by.set(r.team, []).get(r.team)!).push(r.pa);
  return mean([...by.values()].map((v) => topShare(v, 9)));
}

function applyActualUsage(world: World, season: SeasonData) {
  const bat = new Map(season.bat.map((r) => [r.id, r]));
  const pit = new Map(season.pit.map((r) => [r.id, r]));
  const G = world.gamesPerTeam;
  for (const p of world.players) {
    if (p.isPitcher) {
      const r = pit.get(p.id);
      const starts = r ? (r.gs ?? (r.g > 0 && r.outs / r.g >= 12 ? r.g : 0)) : 0;
      p.availability = Math.min(1, starts / (G / 5) + (r ? (r.g - starts) / (G * 0.42) : 0));
    } else {
      p.availability = Math.min(1, (bat.get(p.id)?.pa ?? 0) / (G * 3.9));
    }
  }
}

interface SimOut {
  spread: Spread;
  se: number;
  /** 구단별 평균 승률의 표준편차에서 시즌 수 몫의 운을 뺀 실력 퍼짐 */
  talentMeans: number;
  /** 구단 하나가 시즌마다 흔들리는 폭 (승률 표준편차의 평균) */
  within: number;
  corrRS: number;
  corrRA: number;
  /** 구단별 평균 득점·실점 표준편차 (운이 거의 빠진 값) */
  meanRS: number;
  meanRA: number;
  ms: number;
}

function simulate(year: number, season: SeasonData, v: Variant, real: { names: string[]; lines: TeamLine[] }): SimOut {
  const world = worldForYear(store, year, v.params);
  if (v.actualUsage) applyActualUsage(world, season);
  const seedBase = `validate-${year}`;
  const cal = calibrate(world, { ...v.params, pilotSeasons: 12 }, new Rng(`${seedBase}-cal`));
  const rows: Spread[] = [];
  const perTeam: { wp: number[]; rs: number[]; ra: number[] }[] = world.teams.map(() => ({ wp: [], rs: [], ra: [] }));
  const t0 = Date.now();
  for (let i = 0; i < nSeasons; i++) {
    const r = simulateSeason(world, v.params, `${seedBase}-${i}`, { cal });
    const lines = r.teams.map((t) => ({ w: t.w, l: t.l, g: t.g, rs: t.rs, ra: t.ra }));
    const paByTeam = world.teams.map((t) => t.org.filter((p) => !p.isPitcher).map((p) => r.bat[p.idx].pa));
    rows.push({ ...spreadOf(lines), top9: mean(paByTeam.map((x) => topShare(x, 9))) });
    r.teams.forEach((t, k) => {
      perTeam[k].wp.push(winPct(t));
      perTeam[k].rs.push(t.rs / t.g);
      perTeam[k].ra.push(t.ra / t.g);
    });
  }
  const spread = {} as Spread;
  for (const k of Object.keys(rows[0]) as (keyof Spread)[]) spread[k] = mean(rows.map((x) => x[k]));
  const teamMeanWp = perTeam.map((t) => mean(t.wp));
  const withinVar = mean(perTeam.map((t) => sd(t.wp) ** 2));
  const order = real.names.map((n) => world.teams.findIndex((t) => t.name === n));
  const ok = order.every((k) => k >= 0);
  const mRS = perTeam.map((t) => mean(t.rs)), mRA = perTeam.map((t) => mean(t.ra));
  return {
    spread,
    se: sd(rows.map((x) => x.sdW)) / Math.sqrt(rows.length),
    talentMeans: Math.sqrt(Math.max(0, sd(teamMeanWp) ** 2 - withinVar / nSeasons)),
    within: Math.sqrt(withinVar),
    corrRS: ok ? corr(order.map((k) => mRS[k]), real.lines.map((t) => t.rs / t.g)) : NaN,
    corrRA: ok ? corr(order.map((k) => mRA[k]), real.lines.map((t) => t.ra / t.g)) : NaN,
    meanRS: sd(mRS),
    meanRA: sd(mRA),
    ms: Date.now() - t0,
  };
}

const store = loadDataStore();
const pitcherIds = new Set([...store.players.values()].filter((p) => p.kind === 'P').map((p) => p.id));
const out: string[] = [];
const say = (s = '') => {
  console.log(s);
  out.push(s);
};
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');

say('# 팀 격차 재측정 (엔진 2 15단계)');
say();
say(`\`npx tsx tools/team_spread.ts --years ${years.join(',')} --seasons ${nSeasons} --variants ${variants.map((v) => v.key).join(',')}\` 결과. 시드는 validate와 같다.`);
say();
say('- 승률 퍼짐: 시즌마다 구단 승률 표준편차의 평균 (괄호는 표준오차). 실력 몫: 운(p(1−p)/경기)을 뺀 퍼짐.');
say('- 실력 (평균): 시뮬 구단별 평균 승률의 표준편차에서 시즌 수 몫의 운을 뺀 값. 실력 몫과 거의 같으면 시뮬 안의 운은 동전 던지기만큼이다.');
say('- 득점·실점 (평균): 시뮬 구단별 평균 득점·실점의 표준편차 (운이 거의 빠진 값). 실제 값은 운이 섞인 한 시즌 값.');
say('- 상관: 시뮬 구단별 평균 득점·실점과 그 해 실제 구단 득점·실점의 상관.');
say();
for (const year of years) {
  const season = store.season(year);
  if (!season) {
    say(`${year}: 데이터 없음`);
    continue;
  }
  const real = actualTeams(season);
  const a = spreadOf(real.lines);
  const G = Math.round(mean(real.lines.map((t) => t.g)));
  say(`## ${year}년 (${real.lines.length}구단, 팀당 ${G}경기, 운 ≈ ${f3(Math.sqrt(0.25 / G))})`);
  say();
  say('| 설정 | 승률 퍼짐 | 실력 몫 | 실력 (평균) | 한 구단 흔들림 | 득점 퍼짐 | 실점 퍼짐 | 득점 (평균) | 실점 (평균) | 득실 기대 승률 퍼짐 | 피타고리안 어긋남 | 상관 득점 / 실점 | 상위 9명 |');
  say('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  say(`| 실제 | ${f3(a.sdW)} | ${f3(a.talent)} | | | ${f2(a.sdRS)} | ${f2(a.sdRA)} | | | ${f3(a.sdPyth)} | ${f3(a.pyth)} | | ${f3(actualTop9(season, pitcherIds))} |`);
  for (const v of variants) {
    const s = simulate(year, season, v, real);
    const p = s.spread;
    say(`| ${v.label} | ${f3(p.sdW)} (${f3(s.se)}) | ${f3(p.talent)} | ${f3(s.talentMeans)} | ${f3(s.within)} | ${f2(p.sdRS)} | ${f2(p.sdRA)} | ${f2(s.meanRS)} | ${f2(s.meanRA)} | ${f3(p.sdPyth)} | ${f3(p.pyth)} | ${f2(s.corrRS)} / ${f2(s.corrRA)} | ${f3(p.top9)} |`);
    console.error(`[${year} ${v.key}] ${s.ms}ms`);
  }
  say();
}

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out.join('\n') + '\n');
}
