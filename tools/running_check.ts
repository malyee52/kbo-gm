// 경기 엔진 2 8단계 주루·작전 점검 (2026-10-22, docs/경기엔진2_기획안.md 6장 8단계).
// 도루·도루 실패·폭투·희생번트 리그 값(실제 대비 ±10%), 번트 타석 평균 투구 수(HF 투구 자료 희생번트 타석, ±3% 임시 기준),
// 그리고 자료가 없어 재기만 하는 작전(3루·이중 도루, 견제사, 피치아웃, 히트앤드런, 스퀴즈, 번트 결과) 횟수를 낸다.
// 실제 도루 실패는 타자 행의 cs 합 (빈 행이 있으면 그 수를 함께 적는다), 폭투는 리그 폭투+보크 (보크 포함이라 조금 크다).
// 사용법:  npx tsx tools/running_check.ts [--years 2025,2019,2012] [--seasons 20] [--params '{"stealScale":1.3}']
import { existsSync, readFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, emptyRunTally, Rng, Season, worldForYear, type EngineParams } from '../src/engine';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const years = (arg('years') ?? '2025,2019,2012').split(',').map(Number);
const nSeasons = Number(arg('seasons') ?? 20);
const params: EngineParams = { ...DEFAULT_PARAMS, ...(arg('params') ? JSON.parse(arg('params')!) : {}) };
const store = loadDataStore();

/** HF 투구 자료 희생번트 타석 평균 투구 수 (2023~2025 온전한 해 평균, data-src/pbp_derived/bunt.csv) */
function realBuntPitches(): number | null {
  const f = 'data-src/pbp_derived/bunt.csv';
  if (!existsSync(f)) return null;
  const [head, ...rows] = readFileSync(f, 'utf8').trim().split(/\r?\n/).map((l) => l.split(','));
  const at = (k: string) => head.indexOf(k);
  const full = rows.filter((r) => r[at('partial')] === '0');
  const n = full.reduce((a, r) => a + Number(r[at('sac_bunt')]), 0);
  return full.reduce((a, r) => a + Number(r[at('sac_bunt')]) * Number(r[at('sac_pitches')]), 0) / n;
}

const pct = (sim: number, real: number) => `${((sim / real - 1) * 100).toFixed(1)}%`;
const f3 = (x: number) => x.toFixed(3);
console.log(`# 주루·작전 점검 (${nSeasons}시즌)\n`);
const bp = realBuntPitches();
for (const year of years) {
  const season = store.season(year)!;
  const L = season.league;
  const world = worldForYear(store, year, params);
  const cal = calibrate(world, { ...params, pilotSeasons: 12 }, new Rng(`validate-${year}-cal`));
  const run = emptyRunTally();
  const T = { pa: 0, sb: 0, cs: 0, wp: 0, sac: 0, games: 0, r: 0 };
  for (let i = 0; i < nSeasons; i++) {
    const s = Season.start(world, params, `running-${year}-${i}`, { cal, running: run });
    s.runToEnd();
    T.pa += s.totals.pa; T.sb += s.totals.sb; T.cs += s.totals.cs; T.wp += s.totals.wildPitches; T.sac += s.totals.sac;
    T.games += s.totals.games * 2; T.r += s.totals.r;
  }
  const csRows = season.bat.filter((r) => r.cs !== null && r.cs !== undefined);
  const realCs = csRows.reduce((a, r) => a + (r.cs ?? 0), 0);
  const csMissing = season.bat.length - csRows.length;
  const g = T.games;
  console.log(`## ${year}년\n`);
  console.log('| 지표 | 실제 | 시뮬 | 차이 |\n|---|---:|---:|---:|');
  console.log(`| 팀 경기당 득점 | ${L.runsPerTeamGame.toFixed(2)} | ${(T.r / g).toFixed(2)} | ${pct(T.r / g, L.runsPerTeamGame)} |`);
  console.log(`| 팀 경기당 도루 | ${f3(L.sb / L.teamGames)} | ${f3(T.sb / g)} | ${pct(T.sb / g, L.sb / L.teamGames)} |`);
  console.log(`| 팀 경기당 도루 실패${csMissing ? ` (빈 행 ${csMissing})` : ''} | ${f3(realCs / L.teamGames)} | ${f3(T.cs / g)} | ${pct(T.cs / g, realCs / L.teamGames)} |`);
  console.log(`| 도루 성공률 | ${f3(L.sb / (L.sb + realCs))} | ${f3(T.sb / (T.sb + T.cs))} | ${pct(T.sb / (T.sb + T.cs), L.sb / (L.sb + realCs))} |`);
  if (L.wpbkPerPa) console.log(`| 타석당 폭투(실제는 +보크) | ${L.wpbkPerPa.toFixed(4)} | ${(T.wp / T.pa).toFixed(4)} | ${pct(T.wp / T.pa, L.wpbkPerPa)} |`);
  console.log(`| 타석당 희생번트 | ${L.sacPerPa.toFixed(4)} | ${(T.sac / T.pa).toFixed(4)} | ${pct(T.sac / T.pa, L.sacPerPa)} |`);
  const simBp = run.buntPitches / Math.max(1, run.bunt);
  if (bp !== null) console.log(`| 번트 타석 평균 투구 수 (실제 HF 2023~2025) | ${bp.toFixed(3)} | ${simBp.toFixed(3)} | ${pct(simBp, bp)} |`);
  console.log('\n측정만 (자료 없음, 팀 경기당):\n');
  const per = (x: number) => (x / g).toFixed(3);
  console.log(`- 2루 도루 ${per(run.sb2)}·실패 ${per(run.cs2)}, 3루 도루 ${per(run.sb3)}·실패 ${per(run.cs3)}, 이중 도루 시도 ${per(run.double)}, 견제사 ${per(run.pickoff)}`);
  console.log(`- 피치아웃 ${per(run.pitchout)} (그 공에 뛴 주자 ${run.pitchoutRun}, 잡음 ${run.pitchoutCaught})`);
  console.log(`- 히트앤드런 ${per(run.hnr)} (헛스윙 ${run.hnrMiss}, 파울 ${run.hnrFoul}, 인플레이 ${run.hnrInPlay})`);
  console.log(`- 번트 ${per(run.bunt)}: 희생 성공 ${run.buntSac}, 내야안타 ${run.buntHit}, 선행 주자 아웃 ${run.buntLeadOut}, 타자 아웃 ${run.buntPop}, 병살 ${run.buntDp}; 스퀴즈 ${run.squeeze} (득점 ${run.squeezeRun})\n`);
}
