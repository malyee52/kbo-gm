// 경기 엔진 2 0단계 기준값 (2026-10-22, docs/경기엔진2_기획안.md 6장): validate_engine.ts가 재지 않는 투수 운용·홈 원정 지표를
// 지금 엔진으로 재고, 2023~2025는 투구 단위 실제값(data-src/pbp_derived/)과 나란히 적는다. 엔진은 고치지 않는다.
// - 선발: 평균 이닝·상대 타자, 6이닝 이상 비율, QS%(6이닝 이상·3자책 이하)
// - 구원: 팀 경기당 등판, 등판당 아웃, 구원 아웃 몫(선발 아닌 등판의 아웃 ÷ 전체), 연투(전날 등판)·3연투 비율, 휴식일 분포
// - 홈·원정 경기당 득점, 홈 승률, 규정 타석 타자 BABIP 표준편차
// - 투구 수·고의4구·좌우 분할은 지금 엔진에 없어 "없음"으로 남긴다 (엔진 2에서 채울 자리)
// 경기별 기록은 모든 구단의 박스스코어를 켜서 얻는다 (박스스코어는 난수를 쓰지 않아 결과가 같다).
// 사용법:  npx tsx tools/engine2_baseline.ts [--years 2025,2019,2012] [--seasons 20] [--out reports/engine2-baseline-pitching.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, Rng, Season, winPct, worldForYear } from '../src/engine';
import { babip } from '../src/game/saber';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const years = (arg('years') ?? '2025,2019,2012').split(',').map(Number);
const nSeasons = Number(arg('seasons') ?? 20);
const out = arg('out');
const params = { ...DEFAULT_PARAMS };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

/** 휴식일 구간 (data-src/pbp_derived/relief_rest.csv와 같은 이름) */
const REST = ['0 (연투)', '1', '2', '3', '4', '5~9', '10~'] as const;
const restBucket = (d: number) => (d <= 4 ? REST[d] : d <= 9 ? '5~9' : '10~');

interface Measure {
  starterIp: number; starterBf: number; share6ip: number; qs: number;
  reliefPerTeamGame: number; outsPerRelief: number; reliefOutShare: number;
  backToBack: number; threeStraight: number;
  homeRuns: number; awayRuns: number; homeWin: number;
  winSd: number; babipSd: number; nQual: number;
  rest: Record<string, number>;
}

function measureSeason(world: ReturnType<typeof worldForYear>, cal: ReturnType<typeof calibrate>, seed: string): Measure {
  const s = Season.start(world, params, seed, { cal });
  for (let t = 0; t < world.teams.length; t++) s.boxTeams.add(t);
  s.runToEnd();
  const st = { outs: [] as number[], bf: [] as number[], qs: 0 };
  let reliefApps = 0;
  let reliefOuts = 0;
  let allOuts = 0;
  let hr = 0;
  let ar = 0;
  let hw = 0;
  let aw = 0;
  /** 선수 → 등판한 날들 (오름차순) */
  const days = new Map<number, number[]>();
  /** 구원 등판 (선수, 날) */
  const relief: [number, number][] = [];
  for (const [i, box] of s.boxes) {
    const g = s.log[i];
    hr += g.homeRuns; ar += g.awayRuns;
    if (g.homeRuns > g.awayRuns) hw++; else if (g.homeRuns < g.awayRuns) aw++;
    for (const side of [box.home, box.away]) {
      side.pitchers.forEach((p, k) => {
        allOuts += p.outs;
        const ds = days.get(p.idx) ?? days.set(p.idx, []).get(p.idx)!;
        if (ds[ds.length - 1] !== g.day) ds.push(g.day);
        if (k === 0) {
          st.outs.push(p.outs); st.bf.push(p.bf);
          if (p.outs >= 18 && p.er <= 3) st.qs++;
        } else {
          reliefApps++; reliefOuts += p.outs; relief.push([p.idx, g.day]);
        }
      });
    }
  }
  let b2b = 0;
  let three = 0;
  let withPrev = 0;
  const rest: Record<string, number> = Object.fromEntries(REST.map((k) => [k, 0]));
  for (const [idx, day] of relief) {
    const ds = days.get(idx)!;
    const j = ds.indexOf(day);
    if (j <= 0) continue;
    withPrev++;
    const gap = day - ds[j - 1] - 1;
    rest[restBucket(gap)]++;
    if (gap === 0) {
      b2b++;
      if (j >= 2 && ds[j - 1] - ds[j - 2] === 1) three++;
    }
  }
  for (const k of REST) rest[k] /= Math.max(1, withPrev);
  const teamGames = s.log.length * 2;
  const qualPa = 3.1 * world.gamesPerTeam;
  const qual = s.bat.filter((b) => b.pa >= qualPa);
  return {
    starterIp: mean(st.outs) / 3, starterBf: mean(st.bf), share6ip: mean(st.outs.map((o) => (o >= 18 ? 1 : 0))),
    qs: st.qs / st.outs.length, reliefPerTeamGame: reliefApps / teamGames, outsPerRelief: reliefOuts / Math.max(1, reliefApps),
    reliefOutShare: reliefOuts / allOuts, backToBack: b2b / Math.max(1, withPrev), threeStraight: three / Math.max(1, withPrev),
    homeRuns: hr / s.log.length, awayRuns: ar / s.log.length, homeWin: hw / (hw + aw),
    winSd: sd(s.teams.map(winPct)), babipSd: sd(qual.map(babip)), nQual: qual.length, rest,
  };
}

/** 투구 단위 실제값 (data-src/pbp_derived/, tools/pbp_derive.py) */
function readCsv(name: string): Record<string, string>[] {
  const lines = readFileSync(`data-src/pbp_derived/${name}`, 'utf-8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
}
const summary = readCsv('league_summary.csv');
const starter = readCsv('starter_pitches.csv');
const reliefCsv = readCsv('relief.csv');
const restCsv = readCsv('relief_rest.csv');
const home = readCsv('home_away.csv');
const ibb = readCsv('ibb.csv');

function realFor(year: number): (Partial<Measure> & { pPa?: number; spPitches?: number; rpPitches?: number; ibb?: number }) | null {
  const sm = Object.fromEntries(summary.filter((r) => Number(r.year) === year).map((r) => [r.metric, Number(r.value)]));
  if (!Object.keys(sm).length) return null;
  const sp = starter.find((r) => Number(r.year) === year)!;
  const rp = reliefCsv.find((r) => Number(r.year) === year)!;
  const ha = home.find((r) => Number(r.year) === year)!;
  const rest = Object.fromEntries(REST.map((k) => [k, Number(restCsv.find((r) => Number(r.year) === year && r.rest_days === k)?.share ?? 0)]));
  // 실제 휴식일 분포에는 "같은 날"(더블헤더) 칸이 더 있다. 시뮬에는 더블헤더가 없다
  return {
    starterIp: Number(sp.mean_ip), starterBf: sm.starter_bf, share6ip: Number(sp.share_6ip_plus),
    reliefPerTeamGame: Number(rp.apps_per_team_game), outsPerRelief: Number(rp.mean_outs), reliefOutShare: Number(rp.relief_out_share),
    backToBack: Number(rp.back_to_back_rate), threeStraight: Number(rp.three_straight_rate),
    homeRuns: Number(ha.home_runs_per_game), awayRuns: Number(ha.away_runs_per_game), homeWin: Number(ha.home_win_pct),
    winSd: sm.team_win_pct_sd, babipSd: sm.qual_babip_sd, nQual: sm.qual_batters, rest,
    pPa: sm.pitches_per_pa, spPitches: Number(sp.mean), rpPitches: Number(rp.mean_pitches),
    ibb: Number(ibb.find((r) => Number(r.year) === year)!.per_team),
  };
}

const store = loadDataStore();
const lines: string[] = [];
const emit = (s = '') => { lines.push(s); console.log(s); };
const f = (x: number | undefined, d: number) => (x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d));
const p = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`);
const diff = (sim: number, real: number | undefined) => (real === undefined || !real ? '' : `${(((sim - real) / real) * 100).toFixed(1)}%`);

emit(`시즌 ${nSeasons}회 × 연도. 시뮬은 validate_engine.ts와 같은 방식(그 해 실제 로스터, 맞춤 12시즌)에 모든 구단 박스스코어를 켠 것. 실제는 투구 단위 자료(2023~2025, tools/pbp_derive.py) — 2023년 이전 해는 실제 칸이 비어 있다.`);
emit('');
for (const year of years) {
  const world = worldForYear(store, year, params);
  const cal = calibrate(world, { ...params, pilotSeasons: 12 }, new Rng(`validate-${year}-cal`));
  const t0 = Date.now();
  const ms: Measure[] = [];
  for (let i = 0; i < nSeasons; i++) ms.push(measureSeason(world, cal, `validate-${year}-${i}`));
  const avg = (k: keyof Omit<Measure, 'rest'>) => mean(ms.map((m) => m[k]));
  const se = (k: keyof Omit<Measure, 'rest'>) => sd(ms.map((m) => m[k])) / Math.sqrt(ms.length);
  const real = realFor(year);
  emit(`### ${year}년 (${world.teams.length}구단, 팀당 ${world.gamesPerTeam}경기, ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  emit('');
  emit('| 지표 | 실제 (투구 단위) | 시뮬 | 표본 오차 | 차이 |');
  emit('|---|---:|---:|---:|---:|');
  const row = (label: string, k: keyof Omit<Measure, 'rest'>, d: number, pct = false) => {
    const fmt = pct ? p : (x: number | undefined) => f(x, d);
    emit(`| ${label} | ${fmt(real?.[k] as number | undefined)} | ${fmt(avg(k))} | ${pct ? p(se(k)) : f(se(k), d + 1)} | ${diff(avg(k), real?.[k] as number | undefined)} |`);
  };
  row('선발 평균 이닝', 'starterIp', 2);
  row('선발 평균 상대 타자', 'starterBf', 1);
  row('선발 6이닝 이상 비율', 'share6ip', 3, true);
  row('QS% (6이닝·3자책 이하)', 'qs', 3, true);
  row('팀 경기당 구원 등판', 'reliefPerTeamGame', 2);
  row('구원 등판당 아웃', 'outsPerRelief', 2);
  row('구원 아웃 몫 (선발 아닌 등판)', 'reliefOutShare', 3, true);
  row('구원 연투 비율 (전날 등판)', 'backToBack', 3, true);
  row('구원 3연투 비율', 'threeStraight', 3, true);
  row('홈 경기당 득점', 'homeRuns', 2);
  row('원정 경기당 득점', 'awayRuns', 2);
  row('홈 승률', 'homeWin', 3);
  row('팀 승률 표준편차', 'winSd', 3);
  row('규정 타석 타자 BABIP 표준편차', 'babipSd', 3);
  row('규정 타석 타자 수', 'nQual', 1);
  emit(`| 타석당 투구 수 | ${f(real?.pPa, 2)} | 없음 | | |`);
  emit(`| 선발 평균 투구 수 | ${f(real?.spPitches, 1)} | 없음 | | |`);
  emit(`| 구원 등판당 투구 수 | ${f(real?.rpPitches, 1)} | 없음 | | |`);
  emit(`| 팀당 고의4구 | ${f(real?.ibb, 1)} | 0 (없음) | | |`);
  emit('');
  emit(`구원 등판 전 휴식일 분포 (앞 등판이 있는 구원 등판 중):`);
  emit('');
  emit(`| 휴식일 | ${REST.join(' | ')} |`);
  emit(`|---|${REST.map(() => '---:').join('|')}|`);
  if (real?.rest) emit(`| 실제 | ${REST.map((k) => p(real.rest![k])).join(' | ')} |`);
  emit(`| 시뮬 | ${REST.map((k) => p(mean(ms.map((m) => m.rest[k])))).join(' | ')} |`);
  emit('');
}
if (out) writeFileSync(out, lines.join('\n') + '\n', 'utf-8');
