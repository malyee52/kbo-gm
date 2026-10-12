// 게임 가치(런)와 기준표(tools/war.ts)의 관계 재기 (2026-10-12): 실제 선수-시즌마다
// 게임이 그 시즌을 역사 재현 기준으로 매긴 런(그 시즌 리그 환경)과 실제 기록의 WAR를 나란히 놓고, 타자·선발·구원별로 직선 맞춤.
// 실행: npx tsx tools/calibrate_value.ts
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { batWar, isStarterRow, leagueRefs, pitWar } from './war';

const store = loadDataStore();
const lgOf = leagueRefs(store);
type Pt = { war: number; runs: number; year: number };
const pts: Record<'H' | 'SP' | 'RP', Pt[]> = { H: [], SP: [], RP: [] };
for (const y of store.meta.years) {
  const w = worldForYear(store, y, { ...DEFAULT_PARAMS, ratingBasis: 'season' });
  const ctx = valueContext(w);
  const lg = lgOf.get(y)!;
  const s = store.season(y)!;
  const bat = new Map(s.bat.map((r) => [r.id, r]));
  const pit = new Map(s.pit.map((r) => [r.id, r]));
  for (const p of w.players) {
    if (p.isPitcher) {
      const r = pit.get(p.id);
      if (!r) continue;
      const sp = isStarterRow(r);
      if (r.outs < (sp ? 300 : 150)) continue;
      pts[sp ? 'SP' : 'RP'].push({ war: pitWar(r, lg), runs: currentRuns(p, ctx), year: y });
    } else {
      const r = bat.get(p.id);
      if (!r || r.pa < 350) continue;
      pts.H.push({ war: batWar(r, lg), runs: currentRuns(p, ctx), year: y });
    }
  }
}
const fit = (xs: Pt[]) => {
  const n = xs.length;
  const mx = xs.reduce((s, p) => s + p.runs, 0) / n, my = xs.reduce((s, p) => s + p.war, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of xs) { sxy += (p.runs - mx) * (p.war - my); sxx += (p.runs - mx) ** 2; syy += (p.war - my) ** 2; }
  const b = sxy / sxx;
  return { n, b, a: my - b * mx, r: sxy / Math.sqrt(sxx * syy), mx, my };
};
const eras: [string, number, number][] = [['1982~89', 1982, 1989], ['1990~99', 1990, 1999], ['2000~09', 2000, 2009], ['2010~19', 2010, 2019], ['2020~26', 2020, 2026]];
for (const k of ['H', 'SP', 'RP'] as const) {
  const f = fit(pts[k]);
  console.log(`${k}: ${f.n}건, WAR = ${f.a.toFixed(2)} + ${f.b.toFixed(4)} × 런 (상관 ${f.r.toFixed(2)}), 평균 런 ${f.mx.toFixed(1)} 평균 WAR ${f.my.toFixed(2)}, 1승당 런 ${(1 / f.b).toFixed(1)}`);
  console.log('   시대별: ' + eras.map(([l, a, b]) => {
    const g = fit(pts[k].filter((p) => p.year >= a && p.year <= b));
    return `${l} 1승당 ${(1 / g.b).toFixed(1)}런·절편 ${g.a.toFixed(2)}(평균 WAR ${g.my.toFixed(1)}/런 ${g.mx.toFixed(0)})`;
  }).join(' | '));
}
