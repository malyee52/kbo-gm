// A 해결기(공 단위) ↔ B(타석 단위) 동등성 (docs/경기엔진2_기획안.md 3.6.4, 엔진 2 17단계).
// ① 매치업: 대표 매치업 50쌍(강타자·약타자·평균·삼진형·선구형 × 삼진형·제구형·땅볼형·장타 허용·평균 투수, 쉼·지침)마다 A·B 같은 수의 타석.
//    결과 8칸(삼진·볼넷·사구·홈런·단타·2루타·3루타·아웃)과 투구 수(1~11, 12 이상)를 두 표본 카이제곱으로 견준다 (기준 p > 0.001).
// ② 경기: 같은 해·같은 시드 묶음의 시즌을 A(양쪽 AI 감독)·B로 돌려 경기당 득점 평균·분산, 타율, 삼진·볼넷·홈런 비율, 경기당 투구 수,
//    선발 투구 수·아웃, 투수 교체 수, 병살, 도루의 평균 차이를 표본 오차와 견준다 (기준 3배 안).
//
// 사용법: npx tsx tools/engine_ab.ts [--year 2025] [--pairs 50] [--pa 200000] [--games 2000] [--out reports/engine-ab.md]
// (환경 맞춤 디스크 캐시를 쓴다, tools/calCache.ts)

import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng, Season, worldForYear, type SimPlayer } from '../src/engine';
import { End } from '../src/engine/chain';
import type { GameContext } from '../src/engine/game';
import { enterPitcher } from '../src/engine/manager';
import { Ev, NEUTRAL_PARK, NO_STATE, paRates } from '../src/engine/pa';
import { playOut } from '../src/engine/pitch';
import { drawInPlay, type PaResolver } from '../src/engine/resolver';
import { installCalCache } from './calCache';

installCalCache();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const year = Number(arg('year') ?? 2025);
const nPairs = Number(arg('pairs') ?? 50);
const nPa = Number(arg('pa') ?? 200_000);
const nGames = Number(arg('games') ?? 2000);
const out = arg('out') ?? 'reports/engine-ab.md';

// ---- 카이제곱 (두 표본) ----

/** 정규화한 아래 불완전 감마 P(a, x) (급수·연분수) */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const lnG = lgamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n < 500; n++) {
      del *= x / (a + n);
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnG);
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnG) * h;
}

function lgamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** 두 표본 카이제곱 p값 (빈 칸은 뺀다) */
function chi2p(a: number[], b: number[]): { chi2: number; df: number; p: number } {
  const na = a.reduce((s, x) => s + x, 0);
  const nb = b.reduce((s, x) => s + x, 0);
  let chi2 = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] + b[i] === 0) continue;
    k++;
    const ea = ((a[i] + b[i]) * na) / (na + nb);
    const eb = ((a[i] + b[i]) * nb) / (na + nb);
    chi2 += (a[i] - ea) ** 2 / ea + (b[i] - eb) ** 2 / eb;
  }
  const df = Math.max(1, k - 1);
  return { chi2, df, p: 1 - gammaP(df / 2, chi2 / 2) };
}

// ---- ① 매치업 ----

const store = loadDataStore();
const params = DEFAULT_PARAMS;
const world = worldForYear(store, year, params);
const t0 = performance.now();
const probe = Season.start(world, params, `ab-${year}`);
const ctx = (probe as unknown as { ctx: GameContext }).ctx;
const resolver = ctx.resolver as PaResolver;

const bats = world.players.filter((p) => !p.isPitcher && p.bat && p.bat.sample >= 300);
const pits = world.players.filter((p) => p.isPitcher && p.pit && p.pit.sample >= 200);
const by = <T>(xs: T[], f: (x: T) => number) => [...xs].sort((a, b) => f(a) - f(b));
const batKinds: [string, SimPlayer][] = [
  ['강타자', by(bats, (p) => -p.value)[0]],
  ['약타자', by(bats, (p) => p.value)[0]],
  ['평균 타자', by(bats, (p) => p.value)[bats.length >> 1]],
  ['삼진형 타자', by(bats, (p) => -p.bat!.so)[0]],
  ['선구형 타자', by(bats, (p) => -p.bat!.bb)[0]],
];
const pitKinds: [string, SimPlayer][] = [
  ['삼진형 투수', by(pits, (p) => -p.pit!.so)[0]],
  ['제구형 투수', by(pits, (p) => p.pit!.bb)[0]],
  ['땅볼형 투수', by(pits, (p) => -(p.pit!.gb ?? 1))[0]],
  ['장타 허용 투수', by(pits, (p) => -p.pit!.hr)[0]],
  ['평균 투수', by(pits, (p) => p.value)[pits.length >> 1]],
];
const EVS = [Ev.SO, Ev.BB, Ev.HBP, Ev.HR, Ev.S1, Ev.D2, Ev.T3, Ev.OUT];
const EV_NAME = ['삼진', '볼넷', '사구', '홈런', '단타', '2루타', '3루타', '아웃'];
const END_EV = { [End.K]: Ev.SO, [End.W]: Ev.BB, [End.H]: Ev.HBP } as Record<number, Ev>;

interface PairRow { name: string; evP: number; npP: number; ppaA: number; ppaB: number; kA: number; kB: number; hrA: number; hrB: number }
const pairs: PairRow[] = [];
for (const [bn, b] of batKinds) {
  for (const [pn, p] of pitKinds) {
    for (const tired of [false, true]) {
      if (pairs.length >= nPairs) break;
      const pg = enterPitcher(p, true, 0, ctx);
      if (tired) pg.pitches = pg.limit + 25;
      const rates = paRates(b, pg, false, ctx, NO_STATE, NEUTRAL_PARK);
      const chain = rates.chain ?? resolver.chainFor!(rates);
      const evA = new Array(8).fill(0);
      const evB = new Array(8).fill(0);
      const npA = new Array(12).fill(0);
      const npB = new Array(12).fill(0);
      const ra = new Rng(`ab-a-${pairs.length}`);
      const rb = new Rng(`ab-b-${pairs.length}`);
      let sumA = 0;
      let sumB = 0;
      for (let i = 0; i < nPa; i++) {
        const r = resolver.resolve(rates, rb);
        evB[EVS.indexOf(r.ev)]++;
        npB[Math.min(11, r.pitches - 1)]++;
        sumB += r.pitches;
        const a = playOut(chain, ra);
        const ev = a.end === End.X ? drawInPlay(rates, ra) : END_EV[a.end];
        evA[EVS.indexOf(ev)]++;
        npA[Math.min(11, a.pitches - 1)]++;
        sumA += a.pitches;
      }
      pairs.push({
        name: `${bn} ${b.name} × ${pn} ${p.name}${tired ? ' (지침)' : ''}`, evP: chi2p(evA, evB).p, npP: chi2p(npA, npB).p,
        ppaA: sumA / nPa, ppaB: sumB / nPa, kA: evA[0] / nPa, kB: evB[0] / nPa, hrA: evA[3] / nPa, hrB: evB[3] / nPa,
      });
    }
  }
}
const t1 = performance.now();

// ---- ② 경기 ----

interface GameStats { games: number; runs: number[]; ab: number; h: number; pa: number; so: number; bb: number; hr: number; pitches: number[]; spNp: number[]; spOuts: number[]; changes: number[]; gdp: number; sb: number }
function runSeasons(engine: 'A' | undefined): GameStats {
  const g: GameStats = { games: 0, runs: [], ab: 0, h: 0, pa: 0, so: 0, bb: 0, hr: 0, pitches: [], spNp: [], spOuts: [], changes: [], gdp: 0, sb: 0 };
  for (let k = 0; g.games < nGames; k++) {
    const s = Season.start(world, params, `ab-game-${year}-${k}`, { engine, boxTeams: world.teams.map((t) => t.idx) });
    while (!s.done && g.games < nGames) {
      const n0 = s.log.length;
      s.simulateDay();
      for (let i = n0; i < s.log.length && g.games < nGames; i++) {
        const l = s.log[i];
        const box = s.boxes.get(i);
        if (!box) continue;
        g.games++;
        g.runs.push(l.homeRuns + l.awayRuns);
        let np = 0;
        for (const side of [box.home, box.away]) {
          for (const x of side.pitchers) np += x.np;
          g.spNp.push(side.pitchers[0].np);
          g.spOuts.push(side.pitchers[0].outs);
          g.changes.push(side.pitchers.length - 1);
        }
        g.pitches.push(np);
      }
    }
    const t = s.totals;
    g.ab += t.ab; g.h += t.h; g.pa += t.pa; g.so += t.so; g.bb += t.bb; g.hr += t.hr; g.gdp += t.gdp; g.sb += t.sb;
  }
  return g;
}
const gB = runSeasons(undefined);
const t2 = performance.now();
const gA = runSeasons('A');
const t3 = performance.now();

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const vari = (x: number[]) => { const m = mean(x); return x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1); };
/** 평균 차이 ÷ 표본 오차 (두 표본) */
const zMean = (a: number[], b: number[]) => (mean(a) - mean(b)) / Math.sqrt(vari(a) / a.length + vari(b) / b.length);
/** 비율 차이 ÷ 표본 오차 */
const zRate = (xa: number, na: number, xb: number, nb: number) => {
  const pa = xa / na; const pb = xb / nb;
  return (pa - pb) / Math.sqrt((pa * (1 - pa)) / na + (pb * (1 - pb)) / nb);
};

const rows: [string, string, string, number][] = [
  ['경기당 득점 (두 팀)', mean(gA.runs).toFixed(3), mean(gB.runs).toFixed(3), zMean(gA.runs, gB.runs)],
  ['경기당 득점 분산', vari(gA.runs).toFixed(2), vari(gB.runs).toFixed(2),
    (vari(gA.runs) - vari(gB.runs)) / Math.sqrt((2 * vari(gA.runs) ** 2) / (gA.runs.length - 1) + (2 * vari(gB.runs) ** 2) / (gB.runs.length - 1))],
  ['타율', (gA.h / gA.ab).toFixed(4), (gB.h / gB.ab).toFixed(4), zRate(gA.h, gA.ab, gB.h, gB.ab)],
  ['타석당 삼진', (gA.so / gA.pa).toFixed(4), (gB.so / gB.pa).toFixed(4), zRate(gA.so, gA.pa, gB.so, gB.pa)],
  ['타석당 볼넷', (gA.bb / gA.pa).toFixed(4), (gB.bb / gB.pa).toFixed(4), zRate(gA.bb, gA.pa, gB.bb, gB.pa)],
  ['타석당 홈런', (gA.hr / gA.pa).toFixed(4), (gB.hr / gB.pa).toFixed(4), zRate(gA.hr, gA.pa, gB.hr, gB.pa)],
  ['경기당 투구 수 (두 팀)', mean(gA.pitches).toFixed(1), mean(gB.pitches).toFixed(1), zMean(gA.pitches, gB.pitches)],
  ['선발 투구 수', mean(gA.spNp).toFixed(1), mean(gB.spNp).toFixed(1), zMean(gA.spNp, gB.spNp)],
  ['선발 아웃', mean(gA.spOuts).toFixed(2), mean(gB.spOuts).toFixed(2), zMean(gA.spOuts, gB.spOuts)],
  ['팀당 투수 교체', mean(gA.changes).toFixed(3), mean(gB.changes).toFixed(3), zMean(gA.changes, gB.changes)],
  ['경기당 병살', (gA.gdp / gA.games).toFixed(3), (gB.gdp / gB.games).toFixed(3), zRate(gA.gdp, gA.pa, gB.gdp, gB.pa)],
  ['경기당 도루', (gA.sb / gA.games).toFixed(3), (gB.sb / gB.games).toFixed(3), zRate(gA.sb, gA.pa, gB.sb, gB.pa)],
];

const minEv = Math.min(...pairs.map((p) => p.evP));
const minNp = Math.min(...pairs.map((p) => p.npP));
const failPairs = pairs.filter((p) => p.evP <= 0.001 || p.npP <= 0.001).length;
const failGame = rows.filter((r) => Math.abs(r[3]) > 3).length;
const lines = [
  `# A ↔ B 동등성 (${year}년, 엔진 2 17단계)`,
  '',
  `만든 명령: \`npx tsx tools/engine_ab.ts --year ${year} --pairs ${nPairs} --pa ${nPa} --games ${nGames}\` (매치업 ${((t1 - t0) / 1000).toFixed(0)}초, 경기 B ${((t2 - t1) / 1000).toFixed(0)}초 · A ${((t3 - t2) / 1000).toFixed(0)}초)`,
  '',
  `## ① 매치업 ${pairs.length}쌍 × A·B 각 ${nPa.toLocaleString()}타석`,
  '',
  `기준: 결과 8칸·투구 수 12칸 두 표본 카이제곱 p > 0.001. **기준 밖 ${failPairs}쌍** (가장 작은 p: 결과 ${minEv.toExponential(2)}, 투구 수 ${minNp.toExponential(2)}).`,
  `${pairs.length * 2}번 검정이라 모두 같은 모형이어도 p ≤ 0.001이 0.1번쯤 나온다.`,
  '',
  '| 매치업 | 결과 p | 투구 수 p | 타석당 공 A | B | 삼진 A | B | 홈런 A | B |',
  '|---|---|---|---|---|---|---|---|---|',
  ...pairs.map((p) => `| ${p.name} | ${p.evP.toFixed(3)} | ${p.npP.toFixed(3)} | ${p.ppaA.toFixed(3)} | ${p.ppaB.toFixed(3)} | ${p.kA.toFixed(4)} | ${p.kB.toFixed(4)} | ${p.hrA.toFixed(4)} | ${p.hrB.toFixed(4)} |`),
  '',
  `## ② 경기 A ${gA.games}경기 · B ${gB.games}경기 (양쪽 AI 감독, 시즌을 처음부터)`,
  '',
  `기준: 평균 차이가 표본 오차 3배 안. **기준 밖 ${failGame}개**.`,
  '',
  '| 지표 | A | B | 차이 ÷ 표본 오차 |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |`),
  '',
  '- AI 감독 판단·주루(도루·견제·폭투)·피로는 두 엔진 모두 타석 경계에서 같은 코드로 한다 (A만 공 사이에 묻는 것은 플레이어 지휘뿐).',
  `- 이름: ${EV_NAME.join('·')} 순서의 결과 칸.`,
];
writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.slice(0, 8).join('\n'));
console.log(`매치업 기준 밖 ${failPairs}쌍, 경기 기준 밖 ${failGame}개 → ${out}`);
