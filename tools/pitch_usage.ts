// 투수 기용 측정 (2026-10-13, 시즌 중 엔트리 순환): 구단마다 개막 때 소속 투수를 가치 순으로 셋으로 나눠
// 가치 하위 1/3이 던진 이닝 몫을 시뮬과 실제 기록에서 잰다. 팀 실점 퍼짐(docs/temp-values.md)의 남은 몫을 보려고 만들었다.
// 사용법:  npx tsx tools/pitch_usage.ts [--years 2005,2010,2015,2019,2023,2025] [--seeds a,b] [--params '{"..."}']
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const years = (arg('years') ?? '2005,2010,2015,2019,2023,2025').split(',').map(Number);
const seeds = (arg('seeds') ?? 'u1,u2').split(',');
const params = { ...DEFAULT_PARAMS, pilotSeasons: 1, ...(arg('params') ? JSON.parse(arg('params')!) : {}) };

const store = loadDataStore();
const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
console.log('| 해 | 하위 1/3 이닝 몫 실제 | 시뮬 | 중위 1/3 실제 | 시뮬 | 팀 실점 표준편차 실제 | 시뮬 |');
console.log('|---|---|---|---|---|---|---|');
for (const year of years) {
  const data = store.season(year)!;
  const real = new Map<string, number>();
  for (const r of data.pit) real.set(r.id, (real.get(r.id) ?? 0) + r.outs);
  let bot = { real: 0, sim: 0 };
  let mid = { real: 0, sim: 0 };
  const ra = { real: [] as number[], sim: [] as number[] };
  for (const seed of seeds) {
    const g = GameSession.create(store, { year, teamIdx: 0, seed }, params);
    const groups = g.world.teams.map((t) => {
      const ps = t.org.filter((p) => p.isPitcher && !p.dev).sort((a, b) => a.value - b.value);
      const n = Math.floor(ps.length / 3);
      return { mid: ps.slice(n, ps.length - n), bot: ps.slice(ps.length - n) };
    });
    g.advance(100000);
    const s = g.season;
    for (const [t, grp] of groups.entries()) {
      const all = g.world.teams[t].org.filter((p) => p.isPitcher);
      const simTot = s.pit.reduce((a, x, i) => a + (g.world.players[i].isPitcher && s.teams[t] && g.world.players[i].teamIdx === t ? x.outs : 0), 0) || 1;
      const realTot = all.reduce((a, p) => a + (real.get(p.id) ?? 0), 0) || 1;
      bot.sim += grp.bot.reduce((a, p) => a + s.pit[p.idx].outs, 0) / simTot / groups.length / seeds.length;
      bot.real += grp.bot.reduce((a, p) => a + (real.get(p.id) ?? 0), 0) / realTot / groups.length / seeds.length;
      mid.sim += grp.mid.reduce((a, p) => a + s.pit[p.idx].outs, 0) / simTot / groups.length / seeds.length;
      mid.real += grp.mid.reduce((a, p) => a + (real.get(p.id) ?? 0), 0) / realTot / groups.length / seeds.length;
      const rec = s.teams[t];
      ra.sim.push(rec.ra / Math.max(1, rec.g));
    }
    const byTeam = new Map<string, number>();
    for (const r of data.pit) byTeam.set(r.team, (byTeam.get(r.team) ?? 0) + r.r);
    ra.real = data.teams.map((x) => (byTeam.get(x.name) ?? 0) / x.g);
  }
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`| ${year} | ${pct(bot.real)} | ${pct(bot.sim)} | ${pct(mid.real)} | ${pct(mid.sim)} | ${sd(ra.real).toFixed(2)} | ${sd(ra.sim).toFixed(2)} |`);
}
