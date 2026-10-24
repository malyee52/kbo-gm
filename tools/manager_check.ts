// 경기 엔진 2 9단계 AI 감독 1 점검 (2026-10-23, docs/경기엔진2_기획안.md 6장 9단계).
// 상위 9명 타석 비중(실제 0.708), 팀 경기당 대타·대주자·대수비, 좌타·우타 × 좌투·우투 4칸 OPS (실제: data-src/pbp_derived/platoon4.csv, 2023~2025).
// 상위 9명 타석 비중은 validate_engine.ts와 같은 정의 (팀별 시즌 타석 상위 9명의 몫).
// 사용법:  npx tsx tools/manager_check.ts [--years 2025,2019,2012] [--seasons 20] [--params '{"sub":{...}}']
import { existsSync, readFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, emptyRunTally, Rng, Season, worldForYear, type EngineParams } from '../src/engine';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const years = (arg('years') ?? '2025,2019,2012').split(',').map(Number);
const nSeasons = Number(arg('seasons') ?? 20);
const over = arg('params') ? (JSON.parse(arg('params')!) as Partial<EngineParams>) : {};
const params: EngineParams = { ...DEFAULT_PARAMS, ...over, sub: { ...DEFAULT_PARAMS.sub, ...(over.sub ?? {}) } };
const store = loadDataStore();

type Counts = Partial<Record<string, number>>;
/** 타석 결과 수 → 타율·출루율·장타율·OPS (번트 타석은 시뮬 집계에 없다) */
function slash(c: Counts) {
  const n = (k: string) => c[k] ?? 0;
  const h = n('1B') + n('2B') + n('3B') + n('HR');
  const bb = n('BB') + n('IBB');
  const pa = Object.values(c).reduce((a: number, x) => a + (x ?? 0), 0);
  const ab = pa - bb - n('HBP') - n('SF') - n('SAC');
  const avg = h / ab;
  const obp = (h + bb + n('HBP')) / (ab + bb + n('HBP') + n('SF'));
  const slg = (n('1B') + 2 * n('2B') + 3 * n('3B') + 4 * n('HR')) / ab;
  return { pa, avg, obp, slg, ops: obp + slg };
}

function realPlatoon(year: number): Map<string, number> | null {
  const f = 'data-src/pbp_derived/platoon4.csv';
  if (!existsSync(f)) return null;
  const [head, ...rows] = readFileSync(f, 'utf-8').trim().split(/\r?\n/).map((l) => l.split(','));
  const ix = (k: string) => head.indexOf(k);
  const out = new Map<string, number>();
  for (const r of rows) if (Number(r[ix('year')]) === year && r[ix('partial')] === '0') out.set(r[ix('stand')] + r[ix('throws')], Number(r[ix('ops')]));
  return out.size ? out : null;
}

const f3 = (x: number) => x.toFixed(3);
/** 실제 타석 상위 9명 비중 (reports/engine2-baseline.md) */
const REAL_TOP9: Record<number, number> = { 2025: 0.708, 2019: 0.756, 2012: 0.732 };
console.log(`# AI 감독 1 점검 (${nSeasons}시즌)\n`);
for (const year of years) {
  const world = worldForYear(store, year, params);
  const cal = calibrate(world, { ...params, pilotSeasons: 12 }, new Rng(`validate-${year}-cal`));
  const run = emptyRunTally();
  const splits: Record<string, Counts> = {};
  const top9: number[] = [];
  let games = 0;
  for (let i = 0; i < nSeasons; i++) {
    const s = Season.start(world, params, `manager-${year}-${i}`, { cal, running: run, splits });
    s.runToEnd();
    games += s.totals.games * 2;
    const byTeam = new Map<number, number[]>();
    world.players.forEach((p, idx) => {
      const pa = s.bat[idx].pa;
      if (pa > 0) (byTeam.get(p.teamIdx) ?? byTeam.set(p.teamIdx, []).get(p.teamIdx)!).push(pa);
    });
    for (const v of byTeam.values()) {
      const sorted = [...v].sort((a, b) => b - a);
      top9.push(sorted.slice(0, 9).reduce((a, b) => a + b, 0) / sorted.reduce((a, b) => a + b, 0));
    }
  }
  const share = top9.reduce((a, b) => a + b, 0) / top9.length;
  console.log(`## ${year}년\n`);
  console.log(`- 상위 9명 타석 비중 ${f3(share)} (실제 ${REAL_TOP9[year] ?? '-'}, 기획안 기준 2025 0.708 ±0.015)`);
  console.log(`- 팀 경기당 교체: 대타 ${f3(run.ph / games)}, 대주자 ${f3(run.pr / games)}, 대수비 ${f3(run.def / games)} (합 ${f3((run.ph + run.pr + run.def) / games)})\n`);
  const real = realPlatoon(year);
  console.log('| 타자·투수 | 시뮬 타석 몫 | 시뮬 OPS | 실제 OPS | 차이 |\n|---|---:|---:|---:|---:|');
  const total = Object.values(splits).reduce((a, c) => a + slash(c).pa, 0);
  for (const k of ['LL', 'LR', 'RL', 'RR']) {
    const sl = slash(splits[k] ?? {});
    const r = real?.get(k);
    console.log(`| ${k[0] === 'L' ? '좌타' : '우타'}·${k[1] === 'L' ? '좌투' : '우투'} | ${(sl.pa / total * 100).toFixed(1)}% | ${f3(sl.ops)} | ${r ? f3(r) : '-'} | ${r ? (sl.ops - r >= 0 ? '+' : '') + f3(sl.ops - r) : '-'} |`);
  }
  console.log('');
}
