// 구장 계수 지수 맞추기 (2026-10-22, docs/하드힛_현실감_기획안.md, reports/hardhit-fill.md 파크팩터): 시뮬에서 구단별
// "홈 경기 경기당 득점 ÷ 원정 경기 경기당 득점"이 홈 구장 계수 f를 따라가는지 잰다. 원정 구장은 다른 구장의 평균이라
// 기대 비 = f ÷ (나머지 구단 f 평균). log(시뮬 비)를 log(기대 비)에 회귀한 기울기가 1이면 params.park 지수가 맞다.
// 기울기 s가 1이 아니면 두 지수를 s로 나눈 값이 다음 후보다 (안타·홈런 지수 비율은 그대로 둔다).
// 사용법:  npx tsx tools/park_check.ts [--years 2023,2025] [--seeds a,b,c,d] [--hit 0.4 --hr 1.2] [--out reports/park-check.md]
import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const years = (arg('years') ?? '2023,2025').split(',').map(Number);
const seeds = (arg('seeds') ?? 'p1,p2,p3,p4').split(',');
const park = { hitExp: Number(arg('hit') ?? DEFAULT_PARAMS.park.hitExp), hrExp: Number(arg('hr') ?? DEFAULT_PARAMS.park.hrExp) };
const out = arg('out');
const params = { ...DEFAULT_PARAMS, pilotSeasons: 1, park };

const store = loadDataStore();
const rows: string[] = [];
const emit = (s: string) => { rows.push(s); console.log(s); };
const pts: { x: number; y: number; w: number }[] = [];
let leagueRuns = 0;
let leagueGames = 0;

emit(`지수: 안타 ${park.hitExp}, 홈런 ${park.hrExp} · ${years.join(',')}년 × ${seeds.length}시드`);
emit('');
emit('| 해 | 구단 | 홈 계수 f | 기대 비 (f ÷ 원정 평균) | 시뮬 비 (홈 ÷ 원정 경기당 득점) | 홈 경기 |');
emit('|---|---|---|---|---|---|');
for (const year of years) {
  const acc = new Map<number, { home: number; hg: number; road: number; rg: number }>();
  let fs: number[] = [];
  let names: string[] = [];
  for (const seed of seeds) {
    const g = GameSession.create(store, { year, teamIdx: 0, seed }, params);
    g.advance(100000);
    fs = g.world.teams.map((t) => t.park?.run ?? 1);
    names = g.world.teams.map((t) => t.name);
    for (const x of g.season.log) {
      const r = x.homeRuns + x.awayRuns;
      leagueRuns += r;
      leagueGames++;
      for (const [t, home] of [[x.home, true], [x.away, false]] as const) {
        const a = acc.get(t) ?? { home: 0, hg: 0, road: 0, rg: 0 };
        if (home) { a.home += r; a.hg++; } else { a.road += r; a.rg++; }
        acc.set(t, a);
      }
    }
  }
  const n = fs.length;
  for (const [t, a] of [...acc.entries()].sort((p, q) => p[0] - q[0])) {
    const roadF = (fs.reduce((s, f) => s + f, 0) - fs[t]) / (n - 1);
    const expect = fs[t] / roadF;
    const sim = a.home / a.hg / (a.road / a.rg);
    pts.push({ x: Math.log(expect), y: Math.log(sim), w: a.hg });
    emit(`| ${year} | ${names[t]} | ${fs[t].toFixed(3)} | ${expect.toFixed(3)} | ${sim.toFixed(3)} | ${a.hg} |`);
  }
}
// 가중 최소제곱 기울기 (원점 지나지 않음: 홈 이점 몫은 절편이 받는다)
const W = pts.reduce((s, p) => s + p.w, 0);
const mx = pts.reduce((s, p) => s + p.w * p.x, 0) / W;
const my = pts.reduce((s, p) => s + p.w * p.y, 0) / W;
const sxy = pts.reduce((s, p) => s + p.w * (p.x - mx) * (p.y - my), 0);
const sxx = pts.reduce((s, p) => s + p.w * (p.x - mx) ** 2, 0);
const slope = sxy / sxx;
const resid = Math.sqrt(pts.reduce((s, p) => s + p.w * (p.y - my - slope * (p.x - mx)) ** 2, 0) / W);
emit('');
emit(`기울기 ${slope.toFixed(3)} (1이면 맞음), 절편 ${(my - slope * mx).toFixed(3)} (홈 이점 몫), 잔차 표준편차 ${resid.toFixed(3)}, 경기당 득점 ${(leagueRuns / leagueGames).toFixed(2)}`);
emit(`다음 후보 지수: 안타 ${(park.hitExp / slope).toFixed(2)}, 홈런 ${(park.hrExp / slope).toFixed(2)}`);
if (out) writeFileSync(out, ['# 구장 계수 지수 점검', '', `\`npx tsx tools/park_check.ts --years ${years.join(',')} --seeds ${seeds.join(',')} --hit ${park.hitExp} --hr ${park.hrExp}\``, '', ...rows, ''].join('\n'));
