// 연봉 진단: 계약 종류별 연봉 상위, 같은 가치 구간의 계약 종류별 평균 연봉, 시장 연봉 대비 비율 (리그 규칙 변경 2-2)
// 사용법: npx tsx tools/salary_diag.ts --seed a --at 0,10   (2026 시작 판의 0·10시즌 뒤, 10시즌에 약 2분)
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { currentRuns } from '../src/ai/value';
import { createLeague } from '../src/league/create';
import * as Off from '../src/league/offseason';
import { marketSalary, reserveTarget, salaryCap, teamCapPayroll, wageIndex } from '../src/league/salary';
import { runYear } from './longsim';
import type { LeagueState } from '../src/league/types';

const a = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const seed = a('seed') ?? 'a';
const at = (a('at') ?? '0,10').split(',').map(Number);
const store = loadDataStore();
const params = DEFAULT_PARAMS;
const { league } = createLeague(store, 2026, seed, params);

function kindOf(p: LeagueState['players'][number]): string {
  const k = p.contract.kind;
  if (k === 'reserve') return p.faCount > 0 ? 'reserve(FA후)' : 'reserve';
  return k;
}

function report(lg: LeagueState): void {
  const view = Off.leagueView(lg, store, params);
  const year = lg.year;
  const ps = lg.players.filter((p) => p.team >= 0 && !p.foreign && view.sim.get(p.id)).map((p) => ({ p, r: currentRuns(view.sim.get(p.id)!, view.ctx), k: kindOf(p) }));
  console.log(`\n### ${year} 시즌 계약 (시드 ${seed})`);
  const cap = salaryCap(year, lg);
  if (cap) {
    const pays = lg.teams.map((_, t) => teamCapPayroll(lg, t, year));
    console.log(`캡 ${cap}, 평균 사용률 ${(pays.reduce((x, y) => x + y, 0) / pays.length / cap * 100).toFixed(0)}%`);
  }
  console.log('| 순위 | 선수 | 나이 | 계약 | 연봉(억) | 지금 가치(런) | 만료 |');
  console.log('|---|---|---|---|---|---|---|');
  ps.sort((x, y) => y.p.contract.salary - x.p.contract.salary).slice(0, 25).forEach((x, i) =>
    console.log(`| ${i + 1} | ${x.p.name} | ${year - (x.p.birthYear ?? year)} | ${x.k} | ${(x.p.contract.salary / 10000).toFixed(1)} | ${x.r.toFixed(1)} | ${x.p.contract.until} |`));
  const kinds = ['fa', 'nonFA', 'reserve', 'reserve(FA후)', 'rookie'];
  const bands = [[0, 10], [10, 20], [20, 30], [30, 45], [45, 999]];
  console.log('\n| 가치 구간(런) | ' + kinds.join(' | ') + ' |');
  console.log('|---|' + kinds.map(() => '---').join('|') + '|');
  for (const [lo, hi] of bands) {
    const cells = kinds.map((k) => {
      const xs = ps.filter((x) => x.k === k && x.r >= lo && x.r < hi);
      return xs.length ? `${(xs.reduce((s, x) => s + x.p.contract.salary, 0) / xs.length / 10000).toFixed(1)}억 (${xs.length})` : '-';
    });
    console.log(`| ${lo}~${hi === 999 ? '' : hi} | ${cells.join(' | ')} |`);
  }
  // 원인 측정: 시장 연봉(지금 가치) 대비 비율, FA 다녀온 보류 선수 중 목표보다 높게 남은(삭감 한도·하한 맞추기) 비율
  const w = wageIndex(year, lg);
  const rows = ps.filter((x) => x.r >= 10);
  console.log('\n| 계약 (10런 이상) | 인원 | 연봉 ÷ 시장 연봉(지금 가치) 평균 | 목표보다 5% 넘게 높음 |');
  console.log('|---|---|---|---|');
  for (const k of ['fa', 'nonFA', 'reserve', 'reserve(FA후)']) {
    const xs = rows.filter((x) => x.k === k);
    if (!xs.length) continue;
    const ratio = xs.reduce((a, x) => a + x.p.contract.salary / marketSalary(x.r, w), 0) / xs.length;
    const tgt = (x: typeof xs[number]) => k === 'reserve(FA후)' ? Math.max(reserveTarget(x.r, x.p.service, w), marketSalary(x.r, w) * 0.5) : reserveTarget(x.r, x.p.service, w);
    const sticky = k.startsWith('reserve') ? `${xs.filter((x) => x.p.contract.salary > tgt(x) * 1.05).length}` : '-';
    console.log(`| ${k} | ${xs.length} | ${ratio.toFixed(2)} | ${sticky} |`);
  }
}

let done = 0;
const last = Math.max(...at);
for (let i = 0; i <= last; i++) {
  if (at.includes(i)) report(league);
  if (i === last) break;
  runYear(league, store, params);
  done++;
}
