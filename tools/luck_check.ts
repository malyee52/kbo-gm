// 운의 폭 검증 (2026-10-22, docs/하드힛_현실감_기획안.md 2.4): 시뮬 한 시즌의 운의 퍼짐이 실제와 같은지 잰다.
// - 규정 타석 타자의 BABIP 표준편차, 규정 이닝 투수의 ERA-FIP·피BABIP 표준편차 (실제는 자료집 기록, 같은 식 game/saber.ts)
// - 블론 세이브 과다(reports/qs-blown-check.md)의 원인 후보: 구원 투입 시점(구원 등판·이닝 몫), 1~3점 리드 상황 빈도(세이브 기회),
//   구원 실점률(구원 전용 투수 대 선발 전용 투수의 9이닝당 실점). 실제 블론·세이브는 하드힛 가공값(pit_classic.csv)
// 엔진은 고치지 않는다. 결과를 보고 고칠 안만 적는다.
// 사용법:  npx tsx tools/luck_check.ts [--years 2015,2019,2023,2025] [--seeds a,b] [--out reports/luck-check.md]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyBatLine, emptyPitLine, type BatLine, type PitLine } from '../src/engine';
import { GameSession } from '../src/game/session';
import { babip, fip, leagueBase, pitBabip, realLeagueBase, type LeagueBase } from '../src/game/saber';
import { era } from '../src/game/stats';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const years = (arg('years') ?? '2015,2019,2023,2025').split(',').map(Number);
const seeds = (arg('seeds') ?? 'l1,l2').split(',');
const out = arg('out');
const params = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

// 하드힛 블론·세이브 (선수-시즌)
const realBsv = new Map<number, { sv: number; bsv: number }>();
{
  const lines = readFileSync('data-src/hardhit_derived/pit_classic.csv', 'utf-8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const y = Number(c[head.indexOf('연도')]);
    const t = realBsv.get(y) ?? { sv: 0, bsv: 0 };
    t.sv += Number(c[head.indexOf('세이브')] || 0);
    t.bsv += Number(c[head.indexOf('블론')] || 0);
    realBsv.set(y, t);
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

interface Measure {
  /** 규정 타석 타자 BABIP 표준편차, 사람 수 */
  babipSd: number; nBat: number;
  /** 규정 이닝 투수 ERA-FIP 표준편차, 피BABIP 표준편차, 사람 수 */
  eraFipSd: number; pBabipSd: number; nPit: number;
  /** 팀 경기당 구원 등판, 구원 이닝 몫, 구원 등판당 아웃 */
  reliefPerG: number; reliefShare: number; outsPerRelief: number;
  /** 팀당 세이브 기회 (세이브 + 블론, 144경기 환산), 블론 비율 */
  saveOpp: number; bsvRate: number;
  /** 9이닝당 실점: 구원 전용(선발 0) 투수, 선발 전용(구원 0) 투수 */
  raRelief: number; raStart: number;
}

function measure(bat: BatLine[], pit: PitLine[], lg: LeagueBase, teamGames: number, sv: number, bsv: number): Measure {
  const g = teamGames / 10; // 팀당 경기 (10구단 기준 근사, 규정 판정용)
  const qb = bat.filter((b) => b.pa >= 3.1 * g);
  const qp = pit.filter((p) => p.outs >= 3 * g);
  const relief = pit.reduce((a, p) => a + (p.g - p.gs), 0);
  const outsAll = pit.reduce((a, p) => a + p.outs, 0);
  const rp = pit.filter((p) => p.gs === 0 && p.g > 0);
  const sp = pit.filter((p) => p.gs > 0 && p.gs === p.g);
  const ra9 = (ps: PitLine[]) => (ps.reduce((a, p) => a + p.r, 0) * 27) / Math.max(1, ps.reduce((a, p) => a + p.outs, 0));
  return {
    babipSd: sd(qb.map(babip)), nBat: qb.length,
    eraFipSd: sd(qp.map((p) => era(p) - fip(p, lg))), pBabipSd: sd(qp.map(pitBabip)), nPit: qp.length,
    reliefPerG: relief / teamGames, reliefShare: rp.reduce((a, p) => a + p.outs, 0) / Math.max(1, outsAll),
    outsPerRelief: rp.reduce((a, p) => a + p.outs, 0) / Math.max(1, rp.reduce((a, p) => a + p.g, 0)),
    saveOpp: ((sv + bsv) / teamGames) * 144, bsvRate: bsv / Math.max(1, sv + bsv),
    raRelief: ra9(rp), raStart: ra9(sp),
  };
}

const store = loadDataStore();
const rows: string[] = [];
const emit = (s: string) => { rows.push(s); console.log(s); };
const f3 = (x: number) => x.toFixed(3);
const f2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

emit('## 운의 폭');
emit('');
emit('| 해 | 구분 | 타자 BABIP 표준편차 (명) | 투수 ERA-FIP 표준편차 | 투수 피BABIP 표준편차 (명) |');
emit('|---|---|---|---|---|');
const usage: string[] = ['## 블론 과다의 원인 후보', '',
  '| 해 | 구분 | 팀 경기당 구원 등판 | 구원 전용 투수 이닝 몫 | 구원 등판당 아웃 | 팀당 세이브 기회 (세이브+블론) | 블론 ÷ 기회 | 구원 전용 9이닝당 실점 | 선발 전용 9이닝당 실점 |',
  '|---|---|---|---|---|---|---|---|---|'];
const uline = (y: number, label: string, m: Measure) => usage.push(`| ${y} | ${label} | ${f2(m.reliefPerG)} | ${pct(m.reliefShare)} | ${f2(m.outsPerRelief)} | ${m.saveOpp.toFixed(1)} | ${pct(m.bsvRate)} | ${f2(m.raRelief)} | ${f2(m.raStart)} |`);

for (const year of years) {
  const data = store.season(year);
  if (!data) continue;
  // 실제: 선수-시즌 행을 선수별로 합친다 (시즌 중 이적)
  const bmap = new Map<string, BatLine>();
  for (const r of data.bat) {
    const b = bmap.get(r.id) ?? emptyBatLine();
    b.pa += r.pa; b.ab += r.ab; b.h += r.h; b.d += r.d; b.t += r.t; b.hr += r.hr; b.bb += r.bb ?? 0; b.hbp += r.hbp ?? 0; b.so += r.so ?? 0; b.sf += r.sf ?? 0;
    bmap.set(r.id, b);
  }
  const pmap = new Map<string, PitLine>();
  for (const r of data.pit) {
    const p = pmap.get(r.id) ?? emptyPitLine();
    p.g += r.g; p.gs += r.gs ?? 0; p.outs += r.outs; p.bf += r.tbf; p.h += r.h; p.hr += r.hr; p.bb += r.bb; p.hbp += r.hbp; p.so += r.so; p.r += r.r; p.er += r.er;
    pmap.set(r.id, p);
  }
  const tg = data.teams.reduce((a, t) => a + t.g, 0);
  const rb = realBsv.get(year) ?? { sv: data.pit.reduce((a, r) => a + r.sv, 0), bsv: 0 };
  const real = measure([...bmap.values()], [...pmap.values()], realLeagueBase(data.league), tg, rb.sv, rb.bsv);
  emit(`| ${year} | 실제 | ${f3(real.babipSd)} (${real.nBat}) | ${f2(real.eraFipSd)} | ${f3(real.pBabipSd)} (${real.nPit}) |`);
  uline(year, '실제', real);
  const sims: Measure[] = [];
  for (const seed of seeds) {
    const gs = GameSession.create(store, { year, teamIdx: 0, seed }, params);
    gs.advance(100000);
    const s = gs.season;
    const stg = s.teams.reduce((a, t) => a + t.g, 0);
    const sv = s.pit.reduce((a, p) => a + p.sv, 0);
    const bsv = s.pit.reduce((a, p) => a + p.bsv, 0);
    sims.push(measure(s.bat, s.pit, leagueBase(s.bat, s.pit), stg, sv, bsv));
  }
  const avg = Object.fromEntries((Object.keys(sims[0]) as (keyof Measure)[]).map((k) => [k, mean(sims.map((x) => x[k]))])) as unknown as Measure;
  emit(`| ${year} | 시뮬 (${seeds.length}시드) | ${f3(avg.babipSd)} (${Math.round(avg.nBat)}) | ${f2(avg.eraFipSd)} | ${f3(avg.pBabipSd)} (${Math.round(avg.nPit)}) |`);
  uline(year, `시뮬 (${seeds.length}시드)`, avg);
}
emit('');
for (const u of usage) emit(u);

if (out) {
  // 손으로 쓴 해석은 표시 줄 뒤에 두면 다시 돌려도 남는다
  const MARK = '<!-- 아래는 손으로 쓴 해석 (도구가 지우지 않는다) -->';
  const kept = existsSync(out) && readFileSync(out, 'utf-8').includes(MARK) ? readFileSync(out, 'utf-8').split(MARK)[1] : '\n';
  const head = [
    '# 운의 폭과 블론 과다 원인: 시뮬 대 실제',
    '',
    `\`npx tsx tools/luck_check.ts --years ${years.join(',')} --seeds ${seeds.join(',')}\` 결과. 실제는 자료집 기록(블론·세이브만 하드힛 가공값), 시뮬은 그 해 개막 월드로 정규시즌 한 번.`,
    '',
    '- 규정: 타석 = 팀 경기 × 3.1, 이닝 = 팀 경기 × 1. 실제 선수는 시즌 중 이적 행을 합친다. 지표 식은 game/saber.ts (리그 상수는 그 해 리그 기록).',
    '- 구원 전용 = 선발 등판 0, 선발 전용 = 모든 등판이 선발. 세이브 기회 = 세이브 + 블론 (144경기 환산).',
    '',
  ];
  writeFileSync(out, [...head, ...rows, '', MARK + kept].join('\n'));
}
