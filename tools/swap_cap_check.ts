// 시즌 중 교체 외국인 금액 상한 점검 (2026-11-04, league/market.ts swapCap·swapContract).
// 시작 연도·시드마다 정규시즌을 끝까지 돌리고(우리 구단은 시장 조작 없음), AI 구단의 시즌 중 외국인 영입(보통 교체·부상 대체)을 센다.
// 금액은 이번 시즌 실제로 나갈 총액(연간 금액 × 남은 지급 몫)으로:
//   전 = 상한 앞 규칙 (보통 교체는 후보 요구액 그대로, 부상 대체는 min(요구액, 10만 × 시즌 지급 달 수), 계약금 없음)
//   후 = 지금 계약 (영입 때 swapContract로 정한 값)
// AI 교체 판단은 연봉을 보지 않아(aiMarketDay) 교체 수·고른 선수는 전·후가 같다. main에서 같은 도구로 수를 확인할 수 있다 (전 칸만 의미 있음).
//
// 실행: npx tsx tools/swap_cap_check.ts [--years 2026,2019,2015] [--seeds a,b] [--out reports/swap-cap.md]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { currentRuns } from '../src/ai/value';
import { GameSession } from '../src/game/session';
import { paydays, WON_PER_USD } from '../src/league/finance';
import { movesOf, remainingShare } from '../src/league/market';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const years = arg('years', '2026,2019,2015').split(',').map(Number);
const seeds = arg('seeds', 'sc-a,sc-b').split(',');
const out = arg('out', 'reports/swap-cap.md');

const store = loadDataStore();
const rows: string[] = [];
const sum = { n: 0, before: 0, after: 0 };
for (const year of years) {
  for (const seed of seeds) {
    const g = GameSession.create(store, { year, teamIdx: 0, seed }, DEFAULT_PARAMS);
    // 개막 때 후보 계약 (영입하면 바뀌므로 미리 적어 둔다)
    const ask = new Map(g.league.players.filter((p) => p.foreign && p.market === year).map((p) => [p.id, { s: p.contract.salary, b: p.contract.bonus ?? 0 }]));
    for (let i = 0; i < 400 && !g.done && g.phase === 'season'; i++) g.advance(1000);
    const days = g.season.schedule.length;
    const months = paydays(year, days).length;
    const lp = new Map(g.league.players.map((p) => [p.id, p]));
    const sim = new Map(g.world.players.map((p) => [p.id, p]));
    const moves = movesOf(g.league, year).filter((m) => (m.kind === 'sign' || m.kind === 'rehab') && ask.has(m.id) && m.to !== g.teamIdx);
    let before = 0, after = 0, runs = 0, capped = 0;
    const kinds = { sign: 0, rehab: 0 };
    for (const m of moves) {
      const a = ask.get(m.id)!;
      const share = remainingShare(year, days, m.day);
      const old = m.kind === 'rehab' ? Math.min(a.s, 100_000 * Math.max(1, months)) : a.s + a.b;
      const c = lp.get(m.id)!.contract;
      const now = c.salary + (c.bonus ?? 0);
      before += old * share;
      after += now * share;
      if (now < (m.kind === 'rehab' ? a.s : a.s + a.b)) capped++;
      runs += currentRuns(sim.get(m.id)!, g.marketCtx.values);
      kinds[m.kind as "sign" | "rehab"]++;
    }
    const n = moves.length;
    const teams = g.world.teams.length - 1;
    sum.n += n; sum.before += before; sum.after += after;
    const usd = (x: number) => `${(x / 10_000).toFixed(1)}만`;
    const eok = (x: number) => (x * WON_PER_USD / 10_000).toFixed(2);
    rows.push(`| ${year} | ${seed} | ${n} (교체 ${kinds.sign}·부상 대체 ${kinds.rehab}) | ${capped} | ${n ? (runs / n).toFixed(1) : '-'} | ${n ? usd(before / n) : '-'} → ${n ? usd(after / n) : '-'} | ${eok(before / teams)} → ${eok(after / teams)} |`);
    console.log(rows[rows.length - 1]);
  }
}
const md = [
  '# 시즌 중 교체 외국인 금액 상한 점검',
  '',
  `\`npx tsx tools/swap_cap_check.ts --years ${years.join(',')} --seeds ${seeds.join(',')}\`. AI 구단만 (우리 구단 0번은 시장 조작 없음), 정규시즌 끝까지.`,
  '금액은 이번 시즌 실제로 나가는 총액(연간 × 남은 지급 몫). 전 = 상한 앞 규칙, 후 = 상한 뒤. AI 교체 판단은 연봉을 보지 않아 수·능력은 전·후가 같다.',
  '',
  '| 시작 | 시드 | AI 시즌 중 영입 | 상한에 걸림 | 능력(런) 평균 | 한 명 총액 평균 (달러) 전 → 후 | 구단당 지출 (억 원) 전 → 후 |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `합계: ${sum.n}명, 총액 ${(sum.before / 10_000).toFixed(0)}만 → ${(sum.after / 10_000).toFixed(0)}만 달러.`,
  '',
];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, md.join('\n'));
console.log(`→ ${out}`);
