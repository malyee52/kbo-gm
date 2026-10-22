// 경기 엔진 2 10단계 AI 감독 2 점검 (2026-10-23, docs/경기엔진2_기획안.md 6장 10단계).
// 그 해 실제 개막 감독의 성향(league/managers.ts tacticsOf, 그 해 값)을 걸고 시즌을 돌려 실제와 견준다.
// - 선발: 평균 투구 수, 100구 이상 비율, 팀 선발 평균 투구 수의 구단 사이 표준편차 (실제: data-src/pbp_derived/team_pitching.csv, 2023~)
// - 구원: 팀 경기당 등판, 등판당 아웃, 연투(전날 등판)·3연투 비율 (실제: relief.csv)
// - 세이브·홀드·블론 (144경기 환산 팀당), 블론 ÷ 기회(세이브 + 블론), 기회 (실제: 하드힛 투수 situation 가공값 hardhit_derived/clutch_pit.csv,
//   블론은 2006~), 블론 원인 나눔 (등판 회·역할·리드·누상 주자·전날 등판·동점 주자 책임)
// - 고의4구 팀당 (실제: ibb.csv 2023~), 수동 고의4구 공 수·폭투, 전진 수비, 좌우 원포인트
// 사용법:  npx tsx tools/pen_check.ts [--years 2025,2024,2023] [--seasons 10] [--neutral] [--params '{...}']
//   --neutral: 감독 성향을 걸지 않는다 (모두 보통)
import { existsSync, readFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, emptyPenTally, Rng, Season, worldForYear, type EngineParams } from '../src/engine';
import { infoOf, realOpening, tacticsOf } from '../src/league/managers';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const years = (arg('years') ?? '2025,2024,2023').split(',').map(Number);
const nSeasons = Number(arg('seasons') ?? 10);
const neutral = process.argv.includes('--neutral');
const over = arg('params') ? (JSON.parse(arg('params')!) as Partial<EngineParams>) : {};
const params: EngineParams = { ...DEFAULT_PARAMS, ...over } as EngineParams;
for (const k of Object.keys(over) as (keyof EngineParams)[]) {
  const d = DEFAULT_PARAMS[k];
  if (d && typeof d === 'object' && !Array.isArray(d)) (params as unknown as Record<string, unknown>)[k] = { ...d, ...(over[k] as object) };
}
const store = loadDataStore();

function csv(path: string): Record<string, string>[] {
  if (!existsSync(path)) return [];
  const [head, ...rows] = readFileSync(path, 'utf-8').trim().split(/\r?\n/).map((l) => l.split(','));
  return rows.map((r) => Object.fromEntries(r.map((v, i) => [head[i].replace(/^﻿/, ''), v])));
}
const teamCsv = csv('data-src/pbp_derived/team_pitching.csv');
const starterCsv = csv('data-src/pbp_derived/starter_pitches.csv');
const reliefCsv = csv('data-src/pbp_derived/relief.csv');
const ibbCsv = csv('data-src/pbp_derived/ibb.csv');
/** 세이브 상황 등판·블론 실제 나눔 (tools/pbp_saves.py, 2023~2025) */
const saveCsv = csv('data-src/pbp_derived/save_situations.csv');
/** 하드힛 투수 situation 가공값 해마다 홀드·세이브·블론 합 (블론은 2006~) */
const situ = new Map<number, { hld: number; sv: number; bsv: number }>();
for (const r of csv('data-src/hardhit_derived/clutch_pit.csv')) {
  const y = Number(r['연도']);
  const t = situ.get(y) ?? { hld: 0, sv: 0, bsv: 0 };
  t.hld += Number(r['홀드'] || 0); t.sv += Number(r['세이브'] || 0); t.bsv += Number(r['블론'] || 0);
  situ.set(y, t);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');

console.log(`# AI 감독 2 점검 (${nSeasons}시즌${neutral ? ', 감독 성향 없음' : ''})\n`);
const rows: string[] = [];
const ops: string[] = [];
const blownRows: string[] = [];
const teamRows: string[] = [];
/** 문자중계 팀 코드 → 계보 (tools/build_data.py PBP_TEAM) */
const PBP_TEAM: Record<string, string> = { HH: '한화', HT: 'KIA', KT: 'KT', LG: 'LG', LT: '롯데', NC: 'NC', OB: '두산', SK: 'SSG', SS: '삼성', WO: '히어로즈' };
for (const year of years) {
  const world = worldForYear(store, year, params);
  const cal = calibrate(world, { ...params, pilotSeasons: 12 }, new Rng(`validate-${year}-cal`));
  const tac = world.teams.map((t) => {
    const name = realOpening(store, t.franchise, year);
    return neutral || !name ? undefined : tacticsOf(infoOf(store, name), name, year);
  });
  const pen = emptyPenTally();
  const sp: number[] = [];
  const teamSp: number[] = [];
  const teamAll: number[][] = world.teams.map(() => []);
  let reliefApps = 0, reliefOuts = 0, b2b = 0, three = 0, withPrev = 0, teamGames = 0, sv = 0, hld = 0, bsv = 0;
  for (let i = 0; i < nSeasons; i++) {
    const s = Season.start(world, params, `pen-${year}-${i}`, { cal, pen });
    s.teamSeasons.forEach((ts, t) => { ts.tactics = tac[t]; });
    for (let t = 0; t < world.teams.length; t++) s.boxTeams.add(t);
    s.runToEnd();
    teamGames += s.log.length * 2;
    const days = new Map<number, number[]>();
    const relief: [number, number][] = [];
    const byTeam = world.teams.map(() => [] as number[]);
    for (const [gi, box] of s.boxes) {
      const g = s.log[gi];
      for (const [side, team] of [[box.home, g.home], [box.away, g.away]] as const) {
        side.pitchers.forEach((p, k) => {
          const ds = days.get(p.idx) ?? days.set(p.idx, []).get(p.idx)!;
          if (ds[ds.length - 1] !== g.day) ds.push(g.day);
          if (k === 0) { sp.push(p.np); byTeam[team].push(p.np); } else { reliefApps++; reliefOuts += p.outs; relief.push([p.idx, g.day]); }
        });
      }
    }
    teamSp.push(sd(byTeam.map(mean)));
    byTeam.forEach((xs, t) => teamAll[t].push(...xs));
    for (const [idx, day] of relief) {
      const ds = days.get(idx)!;
      const j = ds.indexOf(day);
      if (j <= 0) continue;
      withPrev++;
      if (day - ds[j - 1] === 1) { b2b++; if (j >= 2 && ds[j - 1] - ds[j - 2] === 1) three++; }
    }
    for (const q of s.pit) { sv += q.sv; hld += q.hld; bsv += q.bsv; }
  }
  const per = (n: number) => (n / teamGames) * 144;
  const tSd = mean(teamSp);
  const rs = starterCsv.find((r) => Number(r.year) === year && r.partial === '0');
  const rr = reliefCsv.find((r) => Number(r.year) === year && r.partial === '0');
  const rt = teamCsv.filter((r) => Number(r.year) === year && r.partial === '0');
  const ri = ibbCsv.find((r) => Number(r.year) === year && r.partial === '0');
  const rsitu = situ.get(year);
  const realGames = (store.season(year)?.teams ?? []).reduce((a, t) => a + t.g, 0) || 144 * world.teams.length;
  const rper = (n: number) => (n / realGames) * 144;
  rows.push(`| ${year} | 실제 | ${rs ? f1(Number(rs.mean)) : '-'} | ${rs ? pct(Number(rs.share_100plus)) : '-'} | ${rt.length ? f2(sd(rt.map((r) => Number(r.starter_mean)))) : '-'} | ${rr ? f2(Number(rr.apps_per_team_game)) : '-'} | ${rr ? f2(Number(rr.mean_outs)) : '-'} | ${rr ? pct(Number(rr.back_to_back_rate)) : '-'} | ${rr ? pct(Number(rr.three_straight_rate)) : '-'} |`);
  rows.push(`| ${year} | 시뮬 | ${f1(mean(sp))} | ${pct(mean(sp.map((n) => (n >= 100 ? 1 : 0))))} | ${f2(tSd)} | ${f2(reliefApps / teamGames)} | ${f2(reliefOuts / reliefApps)} | ${pct(b2b / withPrev)} | ${pct(three / withPrev)} |`);
  const realBlown = rsitu && rsitu.bsv > 0;
  ops.push(`| ${year} | 실제 | ${rsitu ? f1(rper(rsitu.sv)) : '-'} | ${rsitu ? f1(rper(rsitu.hld)) : '-'} | ${realBlown ? f1(rper(rsitu!.bsv)) : '-'} | ${realBlown ? f1(rper(rsitu!.sv + rsitu!.bsv)) : '-'} | ${realBlown ? pct(rsitu!.bsv / (rsitu!.sv + rsitu!.bsv)) : '-'} | ${ri ? f1(Number(ri.per_team)) : '-'} | - | - |`);
  ops.push(`| ${year} | 시뮬 | ${f1(per(sv))} | ${f1(per(hld))} | ${f1(per(bsv))} | ${f1(per(sv + bsv))} | ${pct(bsv / (sv + bsv))} | ${f1(per(pen.ibb))} (수동 ${f1(per(pen.ibbManual))}, 공 ${f2(pen.ibbPitches / Math.max(1, pen.ibbManual - pen.ibbCut))}, 폭투 ${pen.ibbWp}) | ${f1(per(pen.ifIn))} (땅볼 ${pen.ifInGb}, 안타 ${pen.ifInHit}, 득점 ${pen.ifInScored}, 묶임 ${pen.ifInHeld}) | ${f1(per(pen.loogy))} |`);
  // 구단별 선발 100구 이상 (시뮬 대 실제), 선발 투구 수 표준편차·90백분위
  teamRows.push(`| ${year} | ${world.teams.map((t, k) => {
    const real = rt.find((r) => PBP_TEAM[r.team] === t.franchise);
    return `${t.franchise} ×${f2(tac[k]?.hook ?? 1)} ${pct(mean(teamAll[k].map((n) => (n >= 100 ? 1 : 0))))}${real ? ` (${pct(Number(real.share_100plus))})` : ''}`;
  }).join(' · ')} |`);
  const sorted = [...sp].sort((a, b) => a - b);
  teamRows.push(`| ${year} | 선발 투구 수 표준편차 ${f1(sd(sp))}${rs ? ` (실제 ${rs.sd})` : ''}, 10·50·90백분위 ${[0.1, 0.5, 0.9].map((q) => sorted[Math.floor(q * sorted.length)]).join('·')}${rs ? ` (실제 ${rs.p10}·${rs.p50}·${rs.p90})` : ''} |`);
  // 블론 나눔
  const keys = Object.keys(pen.saveSit).sort();
  const sitN = Object.values(pen.saveSit).reduce((a, b) => a + b, 0);
  const blN = Object.values(pen.blown).reduce((a, b) => a + b, 0);
  blownRows.push(`### ${year} (리드를 잃은 세이브 상황 등판, 모든 회. 기록 블론은 7회 이후 등판분)`, '');
  // 실제 (투구 단위 자료, 같은 정의: 세이브 상황 등판 뒤 마운드에 있는 동안 리드를 잃음, 모든 회)
  const rsv = saveCsv.filter((r) => Number(r.year) === year);
  const realOf = (kind: string, key: string) => rsv.find((r) => r.kind === kind && r.key === key);
  const realCell = (kind: string, key: string) => {
    const r = realOf(kind, key);
    return r ? `${f1(rper(Number(r.n)))} · ${f1(rper(Number(r.blown)))} · ${pct(Number(r.blown) / Number(r.n))}` : '-';
  };
  const byInn = (inn: string) => keys.filter((k) => k.startsWith(`${inn}/`));
  const simCell = (ks: string[]) => {
    const n = ks.reduce((a, k) => a + pen.saveSit[k], 0);
    const b = ks.reduce((a, k) => a + (pen.blown[k] ?? 0), 0);
    return `${f1(per(n))} · ${f1(per(b))} · ${pct(b / n)}`;
  };
  blownRows.push('| 등판 회 | 실제 등판 · 블론 · 비율 (팀당) | 시뮬 등판 · 블론 · 비율 | 시뮬 역할별 (마무리 CL · 필승조 SU · 나머지 MR) 등판·블론 |', '|---|---|---|---|');
  for (const inn of ['~6', '7', '8', '9~']) {
    blownRows.push(`| ${inn} | ${realCell('entry_inning', inn)} | ${simCell(byInn(inn))} | ${byInn(inn).map((k) => `${k.split('/')[1]} ${f1(per(pen.saveSit[k]))}·${f1(per(pen.blown[k] ?? 0))}`).join(', ')} |`);
  }
  blownRows.push(`| 모두 | ${realCell('total', 'save_sit')} | ${simCell(keys)} | |`);
  const leadKeys = ['1', '2', '3', '4+'];
  blownRows.push('', `- 리드 1·2·3·4+점 블론 ÷ 등판: 시뮬 ${pen.leadSit.map((x, i) => pct(pen.leadBlown[i] / x)).join(' · ')}, 실제 ${leadKeys.map((k) => { const r = realOf('entry_lead', k); return r ? pct(Number(r.blown) / Number(r.n)) : '-'; }).join(' · ')}`);
  blownRows.push(`- 리드 1·2·3·4+점 등판 (팀당): 시뮬 ${pen.leadSit.map((x) => f1(per(x))).join(' · ')}, 실제 ${leadKeys.map((k) => { const r = realOf('entry_lead', k); return r ? f1(rper(Number(r.n))) : '-'; }).join(' · ')}`);
  blownRows.push(`- 누상 주자 0·1·2·3 블론 ÷ 등판: 시뮬 ${pen.runnerSit.map((x, i) => pct(pen.runnerBlown[i] / x)).join(' · ')}, 실제 ${['0', '1', '2', '3'].map((k) => { const r = realOf('entry_runners', k); return r ? pct(Number(r.blown) / Number(r.n)) : '-'; }).join(' · ')}`);
  const rLate = realOf('late_runs', 'half_innings');
  blownRows.push(`- 7회 이후 반 이닝당 득점: 시뮬 ${f2(pen.lateRuns / pen.lateHalf)}, 실제 ${rLate ? f2(Number(rLate.blown) / Number(rLate.n)) : '-'}`);
  const lk = ['-4', '-3', '-2', '-1', '0', '1', '2', '3', '4'];
  const rLead = lk.map((k) => Number(realOf('late_lead', k)?.n ?? 0));
  const rSum = rLead.reduce((a, b) => a + b, 0);
  blownRows.push(`- 7회 이후 반 이닝 시작 때 수비 팀 리드 −4↓·−3·−2·−1·0·+1·+2·+3·+4↑ 몫: 시뮬 ${pen.lateLead.map((x) => pct(x / pen.lateHalf)).join(' · ')}, 실제 ${rSum ? rLead.map((x) => pct(x / rSum)).join(' · ') : '-'}`);
  blownRows.push(`- 전날도 던진 투수: 등판 몫 ${pct(pen.saveSitTired / sitN)}, 블론 ÷ 등판 ${pct(pen.blownTired / pen.saveSitTired)} (나머지 ${pct((blN - pen.blownTired) / (sitN - pen.saveSitTired))})`);
  blownRows.push(`- 동점 주자가 앞 투수 책임 (승계 주자) 블론 몫 ${pct(pen.blownInherited / blN)}`, '');
}
console.log('## 선발·구원\n');
console.log('| 해 | 구분 | 선발 평균 투구 수 | 선발 100구 이상 | 팀 선발 투구 수 표준편차 | 팀 경기당 구원 등판 | 구원 등판당 아웃 | 구원 연투 | 3연투 |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) console.log(r);
console.log('\n구단별 선발 100구 이상: 구단 ×투수 밀어붙이기 시뮬 (실제)\n');
for (const r of teamRows) console.log(r);
console.log('\n## 세이브·블론·고의4구·전진 수비·원포인트 (팀당, 144경기 환산)\n');
console.log('| 해 | 구분 | 세이브 | 홀드 | 블론 | 세이브 기회 | 블론 ÷ 기회 | 고의4구 | 전진 수비 | 원포인트 |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of ops) console.log(r);
console.log('\n## 블론 나눔 (시뮬)\n');
for (const r of blownRows) console.log(r);
