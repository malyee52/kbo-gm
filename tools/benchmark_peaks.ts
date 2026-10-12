// 잠재력 기준표 (2026-10-12 사용자: "기준표를 만들고 거기에 선수를 대입시키는 방식").
// 실제 기록만으로 시즌 가치(tools/war.ts, 리그 수준 보정 포함)를 계산해 기준표 등급에 넣고, 게임의 잠재력(실제 고점)과 나란히 놓는다.
// 게임 쪽은 2026 리그 환경 기준 (고점은 리그 수준을 2026 기준으로 바꾼 값, 등급은 ui/grades.ts).
// 실행: npx tsx tools/benchmark_peaks.ts > reports/peak-benchmark.md
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, leagueQuality, worldForYear } from '../src/engine';
import { valueContext } from '../src/ai/value';
import { careerIndex, realPeakRuns } from '../src/league/growth';
import { runsGrade } from '../src/ui/grades';
import { batWar, leagueRefs, pitWar, tableGrade } from './war';

const store = loadDataStore();
const SRS = Number(process.argv[2] ?? DEFAULT_PARAMS.seasonRegressScale);
const P = { ...DEFAULT_PARAMS, seasonRegressScale: SRS };
const lgOf = leagueRefs(store);
const REF_YEAR = 2026;

const idx = careerIndex(store);
const ctx = valueContext(worldForYear(store, REF_YEAR, { ...P, ratingBasis: 'season' }));
const gamePeak = (id: string, isPitcher: boolean, pos: string | null): number | null => {
  const r = realPeakRuns({ id, isPitcher, pos, bat: null, pit: null, birthYear: null } as never, idx, store, ctx, P);
  return r === null ? null : runsGrade(r, REF_YEAR);
};

interface Best { id: string; name: string; war: number; year: number; team: string; line: string; pitcher: boolean; pos: string | null }
const best = new Map<string, Best>();
for (const y of store.meta.years) {
  const s = store.season(y)!;
  const lg = lgOf.get(y)!;
  const q = leagueQuality(y);
  for (const r of s.bat) {
    const m = store.players.get(r.id);
    if (!m || m.kind === 'P') continue;
    const w = batWar(r, lg, q);
    const b = best.get(r.id);
    if (!b || w > b.war) {
      const avg = r.ab ? r.h / r.ab : 0;
      best.set(r.id, { id: r.id, name: m.name, war: w, year: y, team: r.team, pitcher: false, pos: r.pos,
        line: `${r.pa}타석 타율 ${avg.toFixed(3)} ${r.hr}홈런 ${r.h}안타` });
    }
  }
  for (const r of s.pit) {
    const m = store.players.get(r.id);
    if (!m) continue;
    const w = pitWar(r, lg, q);
    const k = `${r.id}/P`;
    const b = best.get(k);
    if (!b || w > b.war) {
      best.set(k, { id: r.id, name: m.name, war: w, year: y, team: r.team, pitcher: true, pos: null,
        line: `${r.g}경기 ${Math.floor(r.outs / 3)}이닝 ${r.w}승${r.sv ? ` ${r.sv}세` : ''} 평균자책 ${((r.er * 27) / Math.max(1, r.outs)).toFixed(2)} 삼진 ${r.so}` });
    }
  }
}

const rows = [...best.values()].filter((b) => b.war > 0);
const corr = (a: number[], b: number[]) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db);
};

const out: string[] = ['# 잠재력 기준표 (실제 기록 → 시즌 가치 → 등급)', '',
  '등급 = 40 + 5 × 시즌 가치 (승, 스탯티즈 WAR 눈금 × 리그 수준, 8승 이상 = 80). 기준 잠재력 = 커리어 최고 시즌의 등급. 게임 = 게임 잠재력(실제 고점, 2026 리그 기준 등급). 차이 = 게임 − 기준.', ''];
for (const pitcher of [true, false]) {
  const list = rows.filter((b) => b.pitcher === pitcher).map((b) => ({ ...b, table: tableGrade(b.war), game: gamePeak(b.id, pitcher, b.pos) }))
    .filter((b) => b.game !== null).sort((a, b) => b.war - a.war);
  const top = list.slice(0, 300);
  out.push(`## ${pitcher ? '투수' : '타자'}`, '');
  out.push(`- 기준 상위 300명에서 기준 등급과 게임 잠재력의 상관: ${corr(top.map((x) => x.table), top.map((x) => x.game!)).toFixed(2)}`);
  const diffs = top.map((x) => x.game! - x.table);
  out.push(`- 차이 평균 ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(1)} (상위 30명 ${(diffs.slice(0, 30).reduce((a, b) => a + b, 0) / 30).toFixed(1)}), 절댓값 평균 ${(diffs.reduce((a, b) => a + Math.abs(b), 0) / diffs.length).toFixed(1)}`);
  const eras: [string, number, number][] = [['1982~1989', 1982, 1989], ['1990~1999', 1990, 1999], ['2000~2009', 2000, 2009], ['2010~2019', 2010, 2019], ['2020~2026', 2020, 2026]];
  out.push('- 시대별 차이 평균 (상위 300명): ' + eras.map(([l, a, b]) => {
    const xs = top.filter((x) => x.year >= a && x.year <= b);
    return `${l} ${xs.length ? (xs.reduce((s, x) => s + x.game! - x.table, 0) / xs.length).toFixed(1) : '-'} (${xs.length}명)`;
  }).join(', '), '');
  out.push('| 순위 | 선수 | 최고 시즌 | 기록 | 시즌 가치(승) | 기준 등급 | 게임 잠재력 | 차이 |', '|---|---|---|---|---|---|---|---|');
  top.slice(0, 60).forEach((x, i) => out.push(`| ${i + 1} | ${x.name} | ${x.year} ${x.team} | ${x.line} | ${x.war.toFixed(1)} | ${x.table} | ${x.game} | ${x.game! - x.table > 0 ? '+' : ''}${x.game! - x.table} |`));
  out.push('');
}
out.push('## 확인용 선수', '');
for (const name of ['김광현', '최동원', '선동열', '류현진', '황규봉', '최정', '최원준', '이승엽', '이종범']) {
  const xs = rows.filter((b) => b.name === name).map((b) => `${b.pitcher ? '투수' : '타자'} ${b.year} ${b.team} ${b.war.toFixed(1)}승 → 기준 ${tableGrade(b.war)} / 게임 ${gamePeak(b.id, b.pitcher, b.pos)}`);
  out.push(`- ${name}: ${xs.join('; ')} (같은 이름의 다른 선수가 섞일 수 있다)`);
}
console.log(out.join('\n'));
