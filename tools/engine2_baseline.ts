// 경기 엔진 2 0단계 기준값 (2026-10-22, docs/경기엔진2_기획안.md 6장): validate_engine.ts가 재지 않는 투수 운용·홈 원정 지표를
// 지금 엔진으로 재고, 2023~2025는 투구 단위 실제값(data-src/pbp_derived/)과 나란히 적는다. 엔진은 고치지 않는다.
// - 선발: 평균 이닝·상대 타자, 6이닝 이상 비율, QS%(6이닝 이상·3자책 이하)
// - 구원: 팀 경기당 등판, 등판당 아웃, 구원 아웃 몫(선발 아닌 등판의 아웃 ÷ 전체), 연투(전날 등판)·3연투 비율, 휴식일 분포
// - 홈·원정 경기당 득점, 홈 승률, 규정 타석 타자 BABIP 표준편차
// - 투구 수 (엔진 2 3단계): 타석당·결과별·선발·구원, 투수별 P/PA 퍼짐(상대 타자 100명 이상), 카운트 12칸의 공 결과 비율
// - 타구 (엔진 2 5단계): 인플레이 방향 당겨·가운데·밀어 (실제는 임시값, 출처 미확인: data-src/batted_ball_derived/), 수비로 바뀐 안타·아웃
// - 고의4구·좌우 분할은 아직 없어 "없음"으로 남긴다 (엔진 2에서 채울 자리)
// 경기별 기록은 모든 구단의 박스스코어를 켜서 얻는다 (박스스코어는 난수를 쓰지 않아 결과가 같다).
// 사용법:  npx tsx tools/engine2_baseline.ts [--years 2025,2019,2012] [--seasons 20] [--out reports/engine2-baseline-pitching.md]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, Rng, Season, winPct, worldForYear } from '../src/engine';
import { Ev } from '../src/engine/pa';
import { chainShapeFor } from '../src/engine/params';
import { chainResolver, type PaResolver } from '../src/engine/resolver';
import { emptyBallTally } from '../src/engine/battedball';
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
  pPa: number; spPitches: number; sp100: number; sp110: number; rpPitches: number; kPitches: number; bbPitches: number; ipPitches: number;
  pitP10: number; pitP90: number;
  /** 투수 ID → [상대 타자, 투구 수] (선수별 P/PA 대조용) */
  pitById: Map<string, [number, number]>;
  /** 칸 × [볼, 스트라이크, 파울, 맞힘, 사구] 공 수 */
  cells: number[][];
  /** 인플레이 방향 [당겨, 가운데, 밀어] 몫, 수비로 아웃이 된 안타·안타가 된 아웃 (팀 경기당) */
  pull: number; center: number; oppo: number; toOut: number; toHit: number;
  /** 인플레이 아웃의 땅볼 ÷ (땅볼 + 뜬공 + 내야 뜬공) (엔진 2 6단계), 타석당 병살·희생플라이·실책 출루, 비자책 실점 비율 */
  gbOut: number; dpPa: number; sfPa: number; roePa: number; unearned: number;
}

function measureSeason(world: ReturnType<typeof worldForYear>, cal: ReturnType<typeof calibrate>, seed: string): Measure {
  // 결과별 투구 수와 칸별 공 결과를 세는 해결기 (결과는 기본 해결기와 같다)
  const cells = Array.from({ length: 12 }, () => [0, 0, 0, 0, 0]);
  const byEv = { k: [0, 0], bb: [0, 0], ip: [0, 0] };
  const base = chainResolver(chainShapeFor(params, world.year), { observe: (c, kind) => { cells[c][kind]++; } });
  const resolver: PaResolver = {
    name: base.name, inPlayPitches: base.inPlayPitches,
    resolve(r, rng) {
      const o = base.resolve(r, rng);
      const b = o.ev === Ev.SO ? byEv.k : o.ev === Ev.BB ? byEv.bb : o.ev === Ev.HBP ? null : byEv.ip;
      if (b) { b[0]++; b[1] += o.pitches; }
      return o;
    },
  };
  const balls = emptyBallTally();
  const s = Season.start(world, params, seed, { cal, resolver, balls });
  for (let t = 0; t < world.teams.length; t++) s.boxTeams.add(t);
  s.runToEnd();
  const st = { outs: [] as number[], bf: [] as number[], qs: 0, np: [] as number[] };
  let rpNp = 0;
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
          st.outs.push(p.outs); st.bf.push(p.bf); st.np.push(p.np);
          if (p.outs >= 18 && p.er <= 3) st.qs++;
        } else {
          reliefApps++; reliefOuts += p.outs; rpNp += p.np; relief.push([p.idx, g.day]);
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
  const pitPpa = s.pit.filter((q) => q.bf >= 100).map((q) => q.np / q.bf).sort((a, b) => a - b);
  const pct = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? NaN;
  return {
    starterIp: mean(st.outs) / 3, starterBf: mean(st.bf), share6ip: mean(st.outs.map((o) => (o >= 18 ? 1 : 0))),
    qs: st.qs / st.outs.length, reliefPerTeamGame: reliefApps / teamGames, outsPerRelief: reliefOuts / Math.max(1, reliefApps),
    reliefOutShare: reliefOuts / allOuts, backToBack: b2b / Math.max(1, withPrev), threeStraight: three / Math.max(1, withPrev),
    homeRuns: hr / s.log.length, awayRuns: ar / s.log.length, homeWin: hw / (hw + aw),
    winSd: sd(s.teams.map(winPct)), babipSd: sd(qual.map(babip)), nQual: qual.length, rest,
    pPa: s.totals.pitches / s.totals.pa, spPitches: mean(st.np), sp100: mean(st.np.map((n) => (n >= 100 ? 1 : 0))), sp110: mean(st.np.map((n) => (n >= 110 ? 1 : 0))), rpPitches: rpNp / Math.max(1, reliefApps),
    kPitches: byEv.k[1] / byEv.k[0], bbPitches: byEv.bb[1] / byEv.bb[0], ipPitches: byEv.ip[1] / byEv.ip[0],
    pitP10: pct(pitPpa, 0.1), pitP90: pct(pitPpa, 0.9), cells,
    ...(() => { const n = balls.dir[0] + balls.dir[1] + balls.dir[2]; return { pull: balls.dir[0] / n, center: balls.dir[1] / n, oppo: balls.dir[2] / n }; })(),
    toOut: balls.toOut / teamGames, toHit: balls.toHit / teamGames,
    gbOut: balls.outType[0] / (balls.outType[0] + balls.outType[2] + balls.outType[3]),
    dpPa: s.totals.gdp / s.totals.pa, sfPa: s.totals.sf / s.totals.pa, roePa: s.totals.roe / s.totals.pa, unearned: 1 - s.totals.er / s.totals.r,
    pitById: new Map(s.pit.map((q, i): [string, [number, number]] => [world.players[i].id, [q.bf, q.np]]).filter(([, v]) => v[0] > 0)),
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
/** 하드힛 투수 classic 가공값의 해마다 QS 합 (퀄스는 2002~) */
const qsByYear = (() => {
  const ls = readFileSync('data-src/hardhit_derived/pit_classic.csv', 'utf-8').trim().split(/\r?\n/);
  const h = ls[0].split(',');
  const m = new Map<number, number>();
  for (const l of ls.slice(1)) {
    const c = l.split(',');
    const v = Number(c[h.indexOf('퀄스')] || 0);
    const y = Number(c[h.indexOf('연도')]);
    m.set(y, (m.get(y) ?? 0) + v);
  }
  return m;
})();
const paPitches = readCsv('pa_pitches.csv');
/** 리그 타구 방향 (임시값, 출처 미확인, data-src/batted_ball_derived/batted_ball.csv) */
const ballDir = (() => {
  const ls = readFileSync('data-src/batted_ball_derived/batted_ball.csv', 'utf-8').trim().split(/\r?\n/);
  const h = ls[0].split(',');
  return new Map(ls.slice(1).map((l) => { const c = l.split(','); return [Number(c[h.indexOf('year')]), ['pull_pct', 'center_pct', 'oppo_pct'].map((k) => Number(c[h.indexOf(k)]) / 100)]; }));
})();
/** 판정된 아웃 타구의 땅볼 ÷ (땅볼 + 뜬공) (임시값, 출처 미확인) */
const gbShare = (() => {
  const ls = readFileSync('data-src/batted_ball_derived/batted_ball.csv', 'utf-8').trim().split(/\r?\n/);
  const h = ls[0].split(',');
  return new Map(ls.slice(1).map((l) => { const c = l.split(','); return [Number(c[h.indexOf('year')]), Number(c[h.indexOf('gb_share_of_gb_fb')])]; }));
})();
const gbReal = (year: number) => (gbShare.has(year) ? { gbOut: gbShare.get(year)! } : {});
const countPitch = readCsv('count_pitch.csv');
/** 하드힛 월별 표 리그 P/PA (2015~, 고의4구 포함 정의, data-src/hardhit_derived/league_ppa.csv) */
const hardhitPpa = (() => {
  const ls = readFileSync('data-src/hardhit_derived/league_ppa.csv', 'utf-8').trim().split(/\r?\n/);
  const h = ls[0].split(',');
  return ls.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [h[i], v])));
})();
/** 실제 카운트 칸 공 결과 비율 [볼, 스트라이크, 파울, 맞힘, 사구] (사슬 모양과 같은 묶음) */
function realCells(year: number): number[][] | null {
  // 자료에 공 1개짜리 가짜 칸(2024 "1-3")이 있어 볼 0~3·스트라이크 0~2만 쓴다
  const rows = countPitch.filter((r) => Number(r.year) === year && Number(r.balls) <= 3 && Number(r.strikes) <= 2);
  if (!rows.length) return null;
  return Array.from({ length: 12 }, (_, c) => {
    const r = rows.find((x) => Number(x.balls) * 3 + Number(x.strikes) === c)!;
    const n = (k: string) => Number(r[`n_${k}`]);
    const two = Number(r.strikes) === 2;
    const v = [n('ball'), n('called_strike') + n('swinging_strike') + n('bunt_miss') + (two ? n('bunt_foul') : 0), n('foul') + (two ? 0 : n('bunt_foul')), n('in_play'), n('hbp')];
    const z = v.reduce((a, b) => a + b, 0);
    return v.map((x) => x / z);
  });
}

function realFor(year: number): (Partial<Omit<Measure, 'cells'>> & { ibb?: number; ppaHardhit?: number; hhP10?: number; hhP90?: number }) | null {
  const hh = hardhitPpa.find((r) => Number(r.year) === year);
  const hhPart = hh ? { ppaHardhit: Number(hh.ppa), hhP10: Number(hh.p10), hhP90: Number(hh.p90) } : {};
  const sm = Object.fromEntries(summary.filter((r) => Number(r.year) === year).map((r) => [r.metric, Number(r.value)]));
  if (!Object.keys(sm).length) return hh ? hhPart : null;
  const pp = (g: string) => Number(paPitches.find((r) => Number(r.year) === year && r.group === g)?.mean);
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
    kPitches: pp('K'), bbPitches: pp('BB'), ipPitches: pp('in_play'), ...hhPart,
    sp100: Number(sp.share_100plus), sp110: Number(sp.share_110plus), qs: (qsByYear.get(year) ?? NaN) / Number(sp.starts),
    ibb: Number(ibb.find((r) => Number(r.year) === year)!.per_team),
    dpPa: sm.dp_per_pa, sfPa: sm.sf_per_pa, roePa: sm.roe_per_pa, ...gbReal(year),
    unearned: JSON.parse(readFileSync(`public/data/seasons/${year}.json`, 'utf-8')).league.unearnedShare,
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
  type Num = keyof Omit<Measure, 'rest' | 'cells' | 'pitById'>;
  const avg = (k: Num) => mean(ms.map((m) => m[k]));
  // 선수별 P/PA (D단계 뒤 3단계 기준): 실제 상대 타자 300 이상 투수의 시뮬 P/PA(모든 시즌 합)가 실제 ±0.10구 안인 비율
  const actualPit = new Map<string, [number, number]>();
  const src = year >= 2023 ? 'data-src/pbp_derived/pitcher_ppa.csv' : 'data-src/hardhit_derived/pitcher_ppa.csv';
  if (existsSync(src)) {
    const [head, ...lines] = readFileSync(src, 'utf-8').trim().split(/\r?\n/);
    const col = Object.fromEntries(head.split(',').map((h, i) => [h, i]));
    for (const l of lines) {
      const c = l.split(',');
      if (Number(c[col.year]) !== year) continue;
      const a = actualPit.get(c[col.id]) ?? [0, 0];
      a[0] += Number(c[col.pa]);
      a[1] += year >= 2023 ? Number(c[col.pa]) * Number(c[col.ppa]) : Number(c[col.pitches]);
      actualPit.set(c[col.id], a);
    }
  }
  const simPit = new Map<string, [number, number]>();
  for (const m of ms) for (const [id, [bf, np]] of m.pitById) { const a = simPit.get(id) ?? [0, 0]; a[0] += bf; a[1] += np; simPit.set(id, a); }
  const pairs = [...actualPit].filter(([id, a]) => a[0] >= 300 && (simPit.get(id)?.[0] ?? 0) > 0).map(([id, a]) => [a[1] / a[0], simPit.get(id)![1] / simPit.get(id)![0]]);
  const within = pairs.filter(([a, b]) => Math.abs(a - b) <= 0.1).length;
  const se = (k: Num) => sd(ms.map((m) => m[k])) / Math.sqrt(ms.length);
  const real = realFor(year);
  emit(`### ${year}년 (${world.teams.length}구단, 팀당 ${world.gamesPerTeam}경기, ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  emit('');
  emit('| 지표 | 실제 (투구 단위) | 시뮬 | 표본 오차 | 차이 |');
  emit('|---|---:|---:|---:|---:|');
  const row = (label: string, k: Num, d: number, pct = false) => {
    const fmt = pct ? p : (x: number | undefined) => f(x, d);
    emit(`| ${label} | ${fmt(real?.[k] as number | undefined)} | ${fmt(avg(k))} | ${pct ? p(se(k)) : f(se(k), d + 1)} | ${diff(avg(k), real?.[k] as number | undefined)} |`);
  };
  row('선발 평균 이닝', 'starterIp', 2);
  row('선발 평균 상대 타자', 'starterBf', 1);
  row('선발 6이닝 이상 비율', 'share6ip', 3, true);
  row('QS% (6이닝·3자책 이하, 실제는 하드힛 퀄스 ÷ 선발)', 'qs', 3, true);
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
  row('타석당 투구 수 (번트 포함, 고의4구 없음)', 'pPa', 2);
  if (real?.ppaHardhit !== undefined) emit(`| 타석당 투구 수 (하드힛 월별 표, 고의4구 포함) | ${f(real.ppaHardhit, 2)} | ${f(avg('pPa'), 2)} | | ${diff(avg('pPa'), real.ppaHardhit)} |`);
  row('삼진 타석 투구 수', 'kPitches', 2);
  row('볼넷 타석 투구 수', 'bbPitches', 2);
  row('인플레이 타석 투구 수', 'ipPitches', 2);
  row('선발 평균 투구 수', 'spPitches', 1);
  row('선발 100구 이상 비율', 'sp100', 3, true);
  row('선발 110구 이상 비율', 'sp110', 3, true);
  row('구원 등판당 투구 수', 'rpPitches', 1);
  if (pairs.length) emit(`| 투수별 P/PA 실제 ±0.10구 안 (실제 상대 타자 300 이상 ${pairs.length}명) | 50% 이상 | ${f(100 * within / pairs.length, 1)}% | | 평균 절대 차 ${f(mean(pairs.map(([a, b]) => Math.abs(a - b))), 3)}구 |`);
  row('투수별 P/PA 백분위 10 (상대 타자 100명 이상)', 'pitP10', 2);
  row('투수별 P/PA 백분위 90', 'pitP90', 2);
  if (real?.hhP10 !== undefined) emit(`| 투수별 P/PA 백분위 10·90 (하드힛, 규정 기준 미상) | ${f(real.hhP10, 2)} · ${f(real.hhP90, 2)} | ${f(avg('pitP10'), 2)} · ${f(avg('pitP90'), 2)} | | |`);
  emit(`| 팀당 고의4구 | ${f(real?.ibb, 1)} | 0 (없음) | | |`);
  const bd = ballDir.get(year);
  emit(`| 인플레이 방향 당겨·가운데·밀어 (실제는 임시값, 출처 미확인) | ${bd ? bd.map((x) => p(x)).join(' · ') : '—'} | ${p(avg('pull'))} · ${p(avg('center'))} · ${p(avg('oppo'))} | | ${bd ? `최대 ${(Math.max(Math.abs(avg('pull') - bd[0]), Math.abs(avg('center') - bd[1]), Math.abs(avg('oppo') - bd[2])) * 100).toFixed(1)}%p` : ''} |`);
  emit(`| 수비로 아웃이 된 안타 · 안타가 된 아웃 (팀 경기당) | | ${f(avg('toOut'), 3)} · ${f(avg('toHit'), 3)} | | |`);
  row('인플레이 아웃 땅볼 ÷ (땅볼+뜬공) (실제는 임시값, 출처 미확인)', 'gbOut', 3);
  row('타석당 병살', 'dpPa', 4);
  row('타석당 희생플라이', 'sfPa', 4);
  row('타석당 실책 출루', 'roePa', 4);
  row('비자책 실점 비율 (실제는 시즌 자료)', 'unearned', 3, true);
  emit('');
  emit(`구원 등판 전 휴식일 분포 (앞 등판이 있는 구원 등판 중):`);
  emit('');
  emit(`| 휴식일 | ${REST.join(' | ')} |`);
  emit(`|---|${REST.map(() => '---:').join('|')}|`);
  if (real?.rest) emit(`| 실제 | ${REST.map((k) => p(real.rest![k])).join(' | ')} |`);
  emit(`| 시뮬 | ${REST.map((k) => p(mean(ms.map((m) => m.rest[k])))).join(' | ')} |`);
  emit('');
  // 카운트 칸의 공 결과 비율 (시뮬은 B1이 뽑은 공 경로)
  const rc = realCells(year);
  const tot = Array.from({ length: 12 }, (_, c) => [0, 1, 2, 3, 4].map((j) => ms.reduce((a, m) => a + m.cells[c][j], 0)));
  const simC = tot.map((v) => { const z = v.reduce((a, b) => a + b, 0); return v.map((x) => x / z); });
  emit(`카운트 칸별 공 결과 비율 (볼 · 스트라이크(루킹+헛스윙) · 파울 · 맞힘 · 사구)${rc ? ', 위 실제 / 아래 시뮬, 차이 최대 %p' : ''}:`);
  emit('');
  emit('| 카운트 | 볼 | 스트라이크 | 파울 | 맞힘 | 사구 | 최대 차이 |');
  emit('|---|---:|---:|---:|---:|---:|---:|');
  let worst = 0;
  for (let c = 0; c < 12; c++) {
    const name = `${Math.floor(c / 3)}-${c % 3}`;
    const dmax = rc ? Math.max(...simC[c].map((x, j) => Math.abs(x - rc[c][j]))) : NaN;
    if (rc) worst = Math.max(worst, dmax);
    if (rc) emit(`| ${name} 실제 | ${rc[c].map((x) => p(x)).join(' | ')} | |`);
    emit(`| ${name} 시뮬 | ${simC[c].map((x) => p(x)).join(' | ')} | ${rc ? `${(dmax * 100).toFixed(2)}%p` : ''} |`);
  }
  if (rc) emit(`\n칸 차이 최대 ${(worst * 100).toFixed(2)}%p`);
  emit('');
}
if (out) writeFileSync(out, lines.join('\n') + '\n', 'utf-8');
