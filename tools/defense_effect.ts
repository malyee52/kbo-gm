// 팀 수비 런 → 팀 실점 효과의 크기 (엔진 2 5단계 기준: 예전 팀 수비 합(T5)과 같은 자릿수인지).
// 한 구단의 모든 선수 수비 런에 +runs(모든 자리)를 더한 월드와 그대로인 월드를 같은 시드·같은 환경 맞춤으로 돌려
// 그 구단의 경기당 실점 차이를 잰다. 자리별(--slots 1B,SS 등)로 더할 수도 있다.
// 사용법:  npx tsx tools/defense_effect.ts [--year 2025] [--team 0] [--runs 10] [--seasons 10] [--slots C,1B,2B,3B,SS,LF,CF,RF]
import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, FIELD_POS, Rng, Season, worldForYear, type FieldPos } from '../src/engine';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const year = Number(arg('year') ?? 2025);
const team = Number(arg('team') ?? 0);
const runs = Number(arg('runs') ?? 10);
const nSeasons = Number(arg('seasons') ?? 10);
const slots = (arg('slots')?.split(',') ?? [...FIELD_POS]) as FieldPos[];
const params = { ...DEFAULT_PARAMS };
const store = loadDataStore();

const base = worldForYear(store, year, params);
const cal = calibrate(base, { ...params, pilotSeasons: 6 }, new Rng(`defense-${year}-cal`));

function runsAllowed(boost: number): { ra: number[]; games: number } {
  const world = worldForYear(store, year, params);
  if (boost) {
    for (const p of world.players) {
      if (p.teamIdx !== team || !p.bat?.def) continue;
      const def = { ...p.bat.def };
      for (const q of slots) if (def[q] !== undefined) def[q] = def[q]! + boost;
      p.bat = { ...p.bat, def };
    }
  }
  const ra: number[] = [];
  let games = 0;
  for (let i = 0; i < nSeasons; i++) {
    const s = Season.start(world, params, `defense-${year}-${i}`, { cal });
    s.runToEnd();
    const t = s.teams[team];
    ra.push(t.ra);
    games += t.g;
  }
  return { ra, games };
}

const a = runsAllowed(0);
const b = runsAllowed(runs);
const d = a.ra.map((x, i) => b.ra[i] - x);
const mean = d.reduce((s, x) => s + x, 0) / d.length;
const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, d.length - 1));
const perSeasonGames = a.games / nSeasons;
console.log(`${year}년 ${base.teams[team].name}: 자리 ${slots.join('·')}에 수비 ${runs > 0 ? '+' : ''}${runs}런 (자리 수 × 런 = ${slots.length * runs}런)`);
console.log(`시즌 실점 차이 ${mean.toFixed(1)}점 (시즌별 표준편차 ${sd.toFixed(1)}, 표본 오차 ${(sd / Math.sqrt(d.length)).toFixed(1)}, ${nSeasons}시즌), 경기당 ${(mean / perSeasonGames).toFixed(3)}점`);
console.log(`수비 1런당 실점 ${(mean / (slots.length * runs)).toFixed(2)}점`);
