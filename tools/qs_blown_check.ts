// 퀄리티 스타트·블론 세이브·홀드 검증 (2026-10-22, docs/하드힛_현실감_기획안.md 2.3): 시뮬 한 시즌의 분포를
// 실제(하드힛 투수 classic 가공값 data-src/hardhit_derived/pit_classic.csv)와 견준다. 퀄스는 2002~, 블론은 2006~, 홀드는 2000~에만 실제 값이 있다.
// 사용법:  npx tsx tools/qs_blown_check.ts [--years 2010,2015,2019,2023,2025] [--seeds a,b] [--out reports/qs-blown-check.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const years = (arg('years') ?? '2010,2015,2019,2023,2025').split(',').map(Number);
const seeds = (arg('seeds') ?? 'q1,q2').split(',');
const out = arg('out');
const params = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

interface Usage { qs: number | null; hld: number | null; sv: number | null; bsv: number | null }
const real = new Map<number, Map<string, Usage>>();
{
  const lines = readFileSync('data-src/hardhit_derived/pit_classic.csv', 'utf-8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const col = (k: string) => head.indexOf(k);
  const n = (v: string) => (v === '' ? null : Number(v));
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const y = Number(c[col('연도')]);
    if (!real.has(y)) real.set(y, new Map());
    real.get(y)!.set(c[col('선수ID')], { qs: n(c[col('퀄스')]), hld: n(c[col('홀드')]), sv: n(c[col('세이브')]), bsv: n(c[col('블론')]) });
  }
}

const store = loadDataStore();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '-');

/** 한 리그-시즌의 지표. 팀 경기 수가 실제(144)와 시뮬이 다를 수 있어 팀 경기당·144경기 환산으로 맞춘다 */
interface Stat { qsPct: number; qsPctSd: number; qsTop: number; bsv144: number; bsvRate: number; bsvTop: number; hld144: number; sv144: number }
function stat(teams: { g: number; qs: number; hld: number; sv: number; bsv: number }[], qsTop: number, bsvTop: number): Stat {
  const g = teams.reduce((a, t) => a + t.g, 0);
  const sum = (k: 'qs' | 'hld' | 'sv' | 'bsv') => teams.reduce((a, t) => a + t[k], 0);
  return {
    qsPct: sum('qs') / g, qsPctSd: sd(teams.map((t) => t.qs / t.g)), qsTop,
    bsv144: (sum('bsv') / g) * 144, bsvRate: sum('bsv') / (sum('sv') + sum('bsv')), bsvTop,
    hld144: (sum('hld') / g) * 144, sv144: (sum('sv') / g) * 144,
  };
}

const rows: string[] = [];
const emit = (s: string) => { rows.push(s); console.log(s); };
emit('| 해 | 구분 | QS% (QS ÷ 선발) | 팀 QS% 표준편차 | QS 1위 | 팀당 블론 (144경기) | 블론 ÷ (세이브+블론) | 블론 1위 | 팀당 홀드 | 팀당 세이브 |');
emit('|---|---|---|---|---|---|---|---|---|---|');
for (const year of years) {
  const data = store.season(year);
  const ru = real.get(year);
  if (!data || !ru) { console.error(`${year}: 자료 없음`); continue; }
  // 실제: 선수의 첫 시즌 행 구단으로 팀을 묶는다 (시즌 중 이적은 근사)
  const teamOf = new Map<string, string>();
  for (const r of data.pit) if (!teamOf.has(r.id)) teamOf.set(r.id, r.team);
  const rt = new Map(data.teams.map((t) => [t.name, { g: t.g, qs: 0, hld: 0, sv: 0, bsv: 0 }]));
  let qsTop = 0;
  let bsvTop = 0;
  for (const [id, u] of ru) {
    const t = rt.get(teamOf.get(id) ?? '');
    if (!t) continue;
    t.qs += u.qs ?? 0; t.hld += u.hld ?? 0; t.sv += u.sv ?? 0; t.bsv += u.bsv ?? 0;
    qsTop = Math.max(qsTop, u.qs ?? 0);
    bsvTop = Math.max(bsvTop, u.bsv ?? 0);
  }
  const r = stat([...rt.values()], qsTop, bsvTop);
  const has = { qs: year >= 2002, bsv: year >= 2006, hld: year >= 2000 };
  const line = (label: string, s: Stat, h: typeof has) => emit(`| ${year} | ${label} | ${h.qs ? pct(s.qsPct) : '-'} | ${h.qs ? f3(s.qsPctSd) : '-'} | ${h.qs ? s.qsTop : '-'} | ${h.bsv ? f1(s.bsv144) : '-'} | ${h.bsv ? pct(s.bsvRate) : '-'} | ${h.bsv ? s.bsvTop : '-'} | ${h.hld ? f1(s.hld144) : '-'} | ${f1(s.sv144)} |`);
  line('실제', r, has);
  const sims: Stat[] = [];
  for (const seed of seeds) {
    const gs = GameSession.create(store, { year, teamIdx: 0, seed }, params);
    gs.advance(100000);
    const s = gs.season;
    const teams = gs.world.teams.map((t) => ({ g: s.teams[t.idx].g, qs: 0, hld: 0, sv: 0, bsv: 0 }));
    let top = { qs: 0, bsv: 0 };
    for (const p of gs.world.players) {
      const l = s.pit[p.idx];
      const t = teams[p.teamIdx >= 0 ? p.teamIdx : p.formerTeam ?? -1];
      if (!t || l.bf === 0) continue;
      t.qs += l.qs; t.hld += l.hld; t.sv += l.sv; t.bsv += l.bsv;
      top = { qs: Math.max(top.qs, l.qs), bsv: Math.max(top.bsv, l.bsv) };
    }
    sims.push(stat(teams, top.qs, top.bsv));
  }
  const avgStat = Object.fromEntries((Object.keys(sims[0]) as (keyof Stat)[]).map((k) => [k, mean(sims.map((x) => x[k]))])) as unknown as Stat;
  avgStat.qsTop = Math.round(avgStat.qsTop);
  avgStat.bsvTop = Math.round(avgStat.bsvTop);
  line(`시뮬 (${seeds.length}시드 평균)`, avgStat, { qs: true, bsv: true, hld: true });
}

if (out) {
  const head = [
    '# 퀄리티 스타트·블론 세이브·홀드: 시뮬 대 실제',
    '',
    `\`npx tsx tools/qs_blown_check.ts --years ${years.join(',')} --seeds ${seeds.join(',')}\` 결과. 실제는 하드힛 투수 classic 가공값(\`data-src/hardhit_derived/pit_classic.csv\`), 시뮬은 그 해 개막 월드로 정규시즌 한 번.`,
    '',
    '- QS: 선발 6이닝 이상·3자책 이하. 블론: 1~3점 리드에 나온 구원 투수가 동점·역전을 허용 (실제 규정의 "동점 주자가 대기 타석" 조건은 넣지 않았다).',
    '- 팀당 값은 144경기로 환산했다. 실제 팀 묶음은 선수의 첫 시즌 행 구단 (시즌 중 이적은 근사).',
    '',
  ];
  writeFileSync(out, [...head, ...rows, ''].join('\n'));
}
