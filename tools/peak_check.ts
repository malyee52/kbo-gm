// 잠재력 점검 (2026-10-12 사용자: "실제로 높았던 선수들의 잠재력이 실제보다 낮다").
// 시작 연도의 젊은 선수 가운데 실제 커리어가 좋았던 선수들을 골라, 게임 잠재력과 실제 전성기를 견주고
// AI로 몇 시즌 돌려 게임 안에서 실제로 얼마나 컸는지 본다.
//
// 사용법:  npx tsx tools/peak_check.ts [--start 2007] [--seasons 8] [--seed peak] [--top 25] [--maxage 25]

import { loadDataStore } from '../src/data/loadNode';
import { computeGrades, DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { createLeague } from '../src/league/create';
import { careerIndex, realPeakRuns } from '../src/league/growth';
import { worldFromLeague } from '../src/league/world';
import { runYear } from './longsim';
import { runsGrade } from '../src/ui/grades';

function arg(name: string, d: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : d;
}

const start = Number(arg('start', '2007'));
const seasons = Number(arg('seasons', '8'));
const seed = arg('seed', 'peak');
const top = Number(arg('top', '25'));
const maxAge = Number(arg('maxage', '25'));
const params: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
// 회귀 없이 한 시즌 기록 그대로 (실제 그 시즌에 보여 준 수준)
const raw: EngineParams = {
  ...params,
  batRegress: Object.fromEntries(Object.keys(params.batRegress).map((k) => [k, 0])) as EngineParams['batRegress'],
  pitRegress: Object.fromEntries(Object.keys(params.pitRegress).map((k) => [k, 0])) as EngineParams['pitRegress'],
};

const store = loadDataStore();
const idx = careerIndex(store);
const { league, world } = createLeague(store, start, seed, params);
const ctx = valueContext(world);

const young = world.players.filter((p) => p.teamIdx >= 0 && p.age !== null && p.age <= maxAge && !p.foreign);
const rows = young.map((p) => {
  const lp = league.players.find((x) => x.id === p.id)!;
  return {
    p, lp, now: currentRuns(p, ctx), pot: lp.potential,
    peak: realPeakRuns(p, idx, store, ctx, params) ?? -99,
    rawPeak: realPeakRuns(p, idx, store, ctx, raw) ?? -99,
  };
}).sort((a, b) => b.peak - a.peak).slice(0, top);

const watch = new Map(rows.map((r) => [r.p.id, [] as number[]]));
// 모든 선수의 해마다 등급 변화 (ui/grades.ts)
const grade = runsGrade;
let prev = new Map(world.players.map((p) => [p.id, currentRuns(p, ctx)]));
const jumps: number[] = [];
// 세부 능력치(컨택·파워·선구안·주력 / 구위·제구·장타 억제) 가운데 가장 많이 오른 것
const parts = (g: ReturnType<typeof computeGrades>, id: string): number[] => {
  const b = g.batters.get(id);
  if (b) return [b.contact, b.power, b.eye, b.speed].map((x) => x ?? 0);
  const q = g.pitchers.get(id);
  return q ? [q.stuff, q.control, q.hrSuppression].map((x) => x ?? 0) : [];
};
let prevG = computeGrades(world);
const partJumps: number[] = [];
for (let k = 0; k < seasons; k++) {
  runYear(league, store, params);
  const w = worldFromLeague(structuredClone(league), store, params);
  const c = valueContext(w);
  const cur = new Map(w.players.map((p) => [p.id, currentRuns(p, c)]));
  const gNow = computeGrades(w);
  for (const p of w.players) {
    watch.get(p.id)?.push(cur.get(p.id)!);
    const b = prev.get(p.id);
    if (b !== undefined && p.age !== null && p.age <= 28) {
      jumps.push(grade(cur.get(p.id)!) - grade(b));
      const a0 = parts(prevG, p.id);
      const a1 = parts(gNow, p.id);
      if (a0.length && a0.length === a1.length) partJumps.push(Math.max(...a1.map((x, i) => x - a0[i])));
    }
  }
  prev = cur;
  prevG = gNow;
}
const share = (f: (d: number) => boolean) => ((jumps.filter(f).length / jumps.length) * 100).toFixed(1);
const shareP = (f: (d: number) => boolean) => ((partJumps.filter(f).length / partJumps.length) * 100).toFixed(1);
console.log(`28세 이하 세부 능력치 최대 상승 ${partJumps.length}건: +10 이상 ${shareP((d) => d >= 10)}%, +6~9 ${shareP((d) => d >= 6 && d < 10)}%, +1~5 ${shareP((d) => d >= 1 && d < 6)}%`);
console.log(`28세 이하 해마다 등급 변화 ${jumps.length}건: +10 이상 ${share((d) => d >= 10)}%, +6~9 ${share((d) => d >= 6 && d < 10)}%, +1~5 ${share((d) => d >= 1 && d < 6)}%, 0 이하 ${share((d) => d <= 0)}%`);

const f = (x: number) => (x <= -98 ? '   -' : x.toFixed(1).padStart(5));
console.log(`${start} 시작, ${seasons}시즌, 시드 ${seed}. 런 = 한 시즌 기여(대체 선수 대비)`);
console.log('이름        나이  지금  잠재력  실제전성(회귀)  실제전성(원기록)  게임 최고  게임 연도별');
for (const r of rows) {
  const g = watch.get(r.p.id) ?? [];
  const best = g.length ? Math.max(...g) : -99;
  console.log(`${r.p.name.padEnd(6, '　')} ${String(r.p.age).padStart(3)} ${f(r.now)} ${f(r.pot)}   ${f(r.peak)}         ${f(r.rawPeak)}        ${f(best)}   ${g.map((x) => x.toFixed(0)).join(' ')}`);
}
