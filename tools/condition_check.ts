// 선수 컨디션 측정 (경기 엔진 2 12단계, docs/컨디션_기획안.md 7.2의 4 + 경기 엔진 2 기획안 6장 12단계 확인 칸). 맞춤이 아니라 측정만 한다.
// - 낱말 비율 (기대 12.7 / 74.7 / 12.7%), 선수 한 명이 한 시즌에 낱말이 바뀌는 횟수
// - 좋음·보통·나쁨 날의 타자 출루율·장타율, 투수 피출루율·피홈런
// - 출전 타자·등판 투수의 평균 컨디션 (AI 감독 선택 치우침, 12-5 전에는 0 둘레)
// - 효과 0 대 효과(params.cond.edge)의 득점·타율 차이 (2차 치우침, 7.1), 팀 승률 표준편차
// - 연도별 홈 승률 (실제 자료집 홈 성적과 나란히), 이동 거리 구간별 원정 승률 (homes.json 직선 거리)
// - 타자의 연속 출전 경기 사이 상관 (컨디션이 만드는 이어짐, 3.2. 실제 자료 쪽은 아직 재지 않았다)
//
// 사용법:  npx tsx tools/condition_check.ts [--years 2025,2019,2012] [--seasons 6] [--seed cond] [--out reports/condition-check.md]

import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { condWord, DEFAULT_PARAMS, Season, worldForYear, type CondWord, type EngineParams } from '../src/engine';
import { distanceTable } from '../src/league/distance';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const years = (arg('years') ?? '2025,2019,2012').split(',').map(Number);
const seasons = Number(arg('seasons') ?? 6);
const seed = arg('seed') ?? 'cond';
const out = arg('out') ?? 'reports/condition-check.md';
const store = loadDataStore();
const WORDS: CondWord[] = ['좋음', '보통', '나쁨'];
const BUCKETS = [[0, 100], [100, 250], [250, 1000]] as const;
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '−');
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

interface Acc { pa: number; ab: number; h: number; tb: number; ob: number; hr: number; so: number }
const acc = (): Acc => ({ pa: 0, ab: 0, h: 0, tb: 0, ob: 0, hr: 0, so: 0 });

function runYear(year: number, params: EngineParams, detail: boolean) {
  const words = { 좋음: 0, 보통: 0, 나쁨: 0 } as Record<CondWord, number>;
  const bat = { 좋음: acc(), 보통: acc(), 나쁨: acc() } as Record<CondWord, Acc>;
  const pit = { 좋음: acc(), 보통: acc(), 나쁨: acc() } as Record<CondWord, Acc>;
  let changes = 0, playerSeasons = 0, runs = 0, games = 0, h = 0, ab = 0;
  let starterCond = 0, starters = 0, hitterCond = 0, hitterGames = 0;
  let homeW = 0, homeL = 0;
  const far = BUCKETS.map(() => ({ w: 0, l: 0, g: 0 }));
  const sds: number[] = [];
  let xy = 0, xx = 0, yy = 0, sx = 0, sy = 0, np = 0;
  for (let i = 0; i < seasons; i++) {
    const world = worldForYear(store, year, params);
    const s = Season.start(world, params, `${seed}-${year}-${i}`);
    const n = world.players.length;
    const dist = store.homes ? distanceTable(store.homes, world.teams.map((t) => t.franchise), year) : null;
    const lastWord: (CondWord | null)[] = new Array(n).fill(null);
    const lastGame = new Float64Array(n).fill(NaN);
    while (!s.done) {
      const day = s.day;
      const before = detail ? world.players.map((p) => ({ ...s.bat[p.idx] })) : null;
      const pBefore = detail ? world.players.map((p) => ({ ...s.pit[p.idx] })) : null;
      const logFrom = s.log.length;
      s.simulateDay();
      if (!detail) continue;
      const w = world.players.map((p) => condWord(s.condition(p.idx, day), params.cond));
      for (const p of world.players) {
        if (p.teamIdx < 0) continue;
        const wd = w[p.idx];
        words[wd]++;
        if (lastWord[p.idx] && lastWord[p.idx] !== wd) changes++;
        lastWord[p.idx] = wd;
        const b = s.bat[p.idx], a = before![p.idx];
        const dpa = b.pa - a.pa;
        if (dpa > 0) {
          const x = bat[wd];
          const dh = b.h - a.h, d2 = b.d - a.d, d3 = b.t - a.t, dhr = b.hr - a.hr;
          x.pa += dpa; x.ab += b.ab - a.ab; x.h += dh; x.hr += dhr; x.so += b.so - a.so;
          x.tb += dh + d2 + 2 * d3 + 3 * dhr; x.ob += dh + b.bb - a.bb + b.hbp - a.hbp;
          if (dpa >= 3) {
            hitterCond += s.condition(p.idx, day); hitterGames++;
            const v = (dh + b.bb - a.bb + b.hbp - a.hbp) / dpa;
            if (!Number.isNaN(lastGame[p.idx])) { const u = lastGame[p.idx]; xy += u * v; xx += u * u; yy += v * v; sx += u; sy += v; np++; }
            lastGame[p.idx] = v;
          }
        }
        const q = s.pit[p.idx], r = pBefore![p.idx];
        const dbf = q.bf - r.bf;
        if (dbf > 0) {
          const x = pit[wd];
          x.pa += dbf; x.h += q.h - r.h; x.hr += q.hr - r.hr; x.so += q.so - r.so; x.ob += q.h - r.h + q.bb - r.bb + q.hbp - r.hbp;
          if (q.gs > r.gs) { starterCond += s.condition(p.idx, day); starters++; }
        }
      }
      for (let k = logFrom; k < s.log.length; k++) {
        const g = s.log[k];
        if (g.homeRuns === g.awayRuns) continue;
        const km = dist?.[world.teams[g.away].franchise]?.[world.teams[g.home].franchise];
        if (km === undefined) continue;
        const bi = BUCKETS.findIndex(([lo, hi]) => km >= lo && km < hi);
        far[bi].g++;
        if (g.awayRuns > g.homeRuns) far[bi].w++; else far[bi].l++;
      }
    }
    playerSeasons += world.players.filter((p) => p.teamIdx >= 0).length;
    for (const t of s.teams) { runs += t.rs; games += t.g; homeW += t.homeW; homeL += t.homeL; }
    for (const p of world.players) { h += s.bat[p.idx].h; ab += s.bat[p.idx].ab; }
    const wp = s.teams.map((t) => t.w / Math.max(1, t.w + t.l));
    const m = wp.reduce((a, b) => a + b, 0) / wp.length;
    sds.push(Math.sqrt(wp.reduce((a, b) => a + (b - m) ** 2, 0) / wp.length));
  }
  const corr = np > 1 ? (xy / np - (sx / np) * (sy / np)) / Math.sqrt((xx / np - (sx / np) ** 2) * (yy / np - (sy / np) ** 2)) : NaN;
  return {
    words, bat, pit, changes: changes / Math.max(1, playerSeasons), runs: runs / games, avg: h / ab, home: homeW / (homeW + homeL),
    far, sd: sds.reduce((a, b) => a + b, 0) / sds.length, starterCond: starterCond / Math.max(1, starters), hitterCond: hitterCond / Math.max(1, hitterGames), corr,
  };
}

const actualHome = (year: number) => {
  let w = 0, l = 0;
  for (const t of store.season(year)!.teams) { const [a, , b] = t.home.split('-').map(Number); w += a; l += b; }
  return w / (w + l);
};

const lines: string[] = [
  '# 선수 컨디션 측정 (경기 엔진 2 12단계)', '',
  `\`npx tsx tools/condition_check.ts --years ${years.join(',')} --seasons ${seasons} --seed ${seed}\` · 효과 ${DEFAULT_PARAMS.cond.edge} (params.cond.edge) · 측정만 (맞춤 아님, docs/컨디션_기획안.md 7.2의 4)`, '',
];
const zeroP: EngineParams = { ...DEFAULT_PARAMS, cond: { ...DEFAULT_PARAMS.cond, edge: 0 } };
const rows: string[] = [];
const homeRows: string[] = [];
for (const year of years) {
  const t0 = performance.now();
  const on = runYear(year, DEFAULT_PARAMS, true);
  const off = runYear(year, zeroP, true);
  console.error(`${year} ${((performance.now() - t0) / 1000).toFixed(1)}초`);
  const tot = WORDS.reduce((a, w) => a + on.words[w], 0);
  lines.push(`## ${year}`, '');
  lines.push(`- 낱말 비율 (1군·2군 선수-날): 좋음 ${pct(on.words.좋음 / tot)} · 보통 ${pct(on.words.보통 / tot)} · 나쁨 ${pct(on.words.나쁨 / tot)} (기대 12.7 / 74.7 / 12.7%)`);
  lines.push(`- 선수 한 명이 한 시즌에 낱말이 바뀌는 횟수: ${on.changes.toFixed(1)}번`);
  lines.push(`- 출전 타자(3타석+)의 평균 컨디션 ${on.hitterCond.toFixed(3)}, 선발 투수 ${on.starterCond.toFixed(3)} (AI 감독이 컨디션을 보지 않으면 0 둘레)`);
  lines.push(`- 타자 연속 출전 경기 사이 출루 상관: 효과 0 ${f3(off.corr)} → 효과 ${DEFAULT_PARAMS.cond.edge} ${f3(on.corr)} (실제 자료 쪽은 아직 재지 않았다)`, '');
  lines.push('| 낱말 | 타자 타석 | 출루율 | 장타율 | 삼진 ÷ 타석 | 투수 상대 타자 | 피출루율 | 피홈런 ÷ 타자 |', '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const w of WORDS) {
    const b = on.bat[w], p = on.pit[w];
    lines.push(`| ${w} | ${b.pa} | ${f3(b.ob / b.pa)} | ${f3(b.tb / b.ab)} | ${f3(b.so / b.pa)} | ${p.pa} | ${f3(p.ob / p.pa)} | ${(p.hr / p.pa).toFixed(4)} |`);
  }
  lines.push('');
  rows.push(`| ${year} | ${off.runs.toFixed(3)} → ${on.runs.toFixed(3)} (${((on.runs / off.runs - 1) * 100).toFixed(2)}%) | ${f3(off.avg)} → ${f3(on.avg)} | ${off.sd.toFixed(4)} → ${on.sd.toFixed(4)} | ${f3(off.home)} → ${f3(on.home)} |`);
  homeRows.push(`| ${year} | ${f3(actualHome(year))} | ${f3(on.home)} | ${on.far.map((x) => `${f3(x.w / (x.w + x.l))} (${x.g})`).join(' | ')} |`);
}
lines.push('## 효과 0 대 효과 (2차 치우침·팀 격차, 같은 시드)', '', '| 해 | 팀 경기당 득점 | 타율 | 팀 승률 표준편차 | 홈 승률 |', '|---|---|---|---|---|', ...rows, '');
lines.push('## 홈 승률과 이동 거리별 원정 승률', '',
  '고정 홈 이점 0.013은 그대로 (사용자 결정 2026-10-22). 거리는 연고지 직선 거리 (homes.json, 임시값). 원정 승률은 무승부를 뺀 값, 괄호는 경기 수.', '',
  `| 해 | 실제 홈 승률 | 시뮬 홈 승률 | 원정 ${BUCKETS.map(([a, b]) => `${a}~${b}km`).join(' | 원정 ')} |`, `|---|---:|---:|${BUCKETS.map(() => '---:').join('|')}|`, ...homeRows, '');
writeFileSync(out, lines.join('\n'));
console.log(lines.join('\n'));
