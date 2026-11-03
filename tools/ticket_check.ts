// 재정 2 F3 입장권 좌석 등급 가격 점검 (docs/재정2_기획안.md 7장 F3): B 구단(기본 두산)을 플레이어 구단으로 두고
// 가격 배율 시나리오마다 몇 시즌 돌려 관중·관중 수입·팬 만족도·결산 자금을 본다. 나머지 운영은 AI에게 맡긴다 (invest_cost.ts와 같은 방식).
// "프리미엄 150%" 같은 한 손잡이 극단이 늘 이득이 아닌지 (관중 수입 ↑ 대 팬 만족도 ↓ → 다음 해 관중·스폰서 ↓) 본다.
//
// 실행: npx tsx tools/ticket_check.ts [--seeds tk-a,tk-b] [--seasons 3] [--year 2026] [--team 두산] [--scenarios base,all130] [--out reports/ticket-check.md]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { capOf, ensureFinance, pricesOf, SEAT_GRADES, SEAT_LABEL, type SeatPrices } from '../src/league/finance';
import { fanLevel } from '../src/league/stadium';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const seeds = (arg('seeds', 'tk-a,tk-b') ?? '').split(',');
const seasons = Number(arg('seasons', '3'));
const year = Number(arg('year', '2026'));
const teamName = arg('team', '두산')!;
const out = arg('out', 'reports/ticket-check.md')!;

const all = (x: number): SeatPrices => ({ general: x, reserved: x, premium: x });
/** 시나리오: null = 재무팀 추천 가격 자동 (손대지 않음) */
const SCENARIOS: { key: string; label: string; prices: SeatPrices | null }[] = [
  { key: 'base', label: '추천 가격 자동 (손대지 않음)', prices: null },
  { key: 'all70', label: '모두 70%', prices: all(0.7) },
  { key: 'all85', label: '모두 85%', prices: all(0.85) },
  { key: 'all100', label: '모두 100% (기본 가격 고정)', prices: all(1) },
  { key: 'all115', label: '모두 115%', prices: all(1.15) },
  { key: 'all130', label: '모두 130%', prices: all(1.3) },
  { key: 'all150', label: '모두 150%', prices: all(1.5) },
  { key: 'prem150', label: '프리미엄만 150%', prices: { general: 1, reserved: 1, premium: 1.5 } },
  { key: 'gen70', label: '일반석만 70%', prices: { general: 0.7, reserved: 1, premium: 1 } },
  { key: 'popular', label: '일반 100·지정 120·프리미엄 140%', prices: { general: 1, reserved: 1.2, premium: 1.4 } },
];
const only = arg('scenarios');
const runList = only ? SCENARIOS.filter((s) => only.split(',').includes(s.key)) : SCENARIOS;

interface YearRow { year: number; fill: number; attendance: number; gate: number; sponsor: number; fans: number; fanPrice: number; net: number; cash: number; prices: string }

const store = loadDataStore();

function setPrices(g: GameSession, team: number, p: SeatPrices, active: boolean) {
  ensureFinance(g.league);
  const f = g.league.finance![team];
  f.prices = { ...p };
  f.priceLocked = [...SEAT_GRADES];
  if (active) f.activePrices = { ...p };
}

function runOne(sc: (typeof SCENARIOS)[number], seed: string): YearRow[] {
  const g0 = GameSession.create(store, { year, teamIdx: 0, seed, difficulty: 'normal', ratingBasis: 'season' }, DEFAULT_PARAMS);
  const team = g0.league.teams.findIndex((t) => t.franchise === teamName || t.name === teamName);
  if (team < 0) throw new Error(`구단을 찾지 못함: ${teamName}`);
  const g = GameSession.create(store, { year, teamIdx: team, seed, difficulty: 'normal', ratingBasis: 'season' }, DEFAULT_PARAMS);
  if (sc.prices) setPrices(g, team, sc.prices, true);
  const rows: YearRow[] = [];
  for (let s = 0; s < seasons; s++) {
    const used = pricesOf(g.league.finance?.[team], false);
    g.advance(100000);
    g.advancePostseason(10_000);
    g.beginOffseason();
    const L = g.league;
    const y = g.world.year;
    const h = L.finance![team].history.at(-1)!;
    const fe = L.fans![team].log.find((e) => e.reason === `${y} 입장권 가격`);
    rows.push({
      year: y, fill: (h.attendance ?? 0) / Math.max(1, (h.homeGames ?? 0) * capOf(L, team, y)), attendance: h.attendance ?? 0, gate: h.items.gate ?? 0,
      sponsor: h.items.sponsor ?? 0, fans: fanLevel(L, team, y + 1), fanPrice: fe?.delta ?? 0, net: h.net, cash: h.cash,
      prices: SEAT_GRADES.map((k) => Math.round(used[k] * 100)).join('/'),
    });
    if (s === seasons - 1) break;
    const off = g.offseason!;
    let k = 0;
    while (off.stage !== 'ready' && k++ < 40) {
      const st = off.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      off.userTeam = st === 'fa' ? -1 : g.teamIdx;
      const r = g.nextStage();
      if (!r.ok && g.owner.offers?.length) g.acceptOffer(g.owner.offers[0]);
    }
    off.userTeam = g.teamIdx;
    if (sc.prices) setPrices(g, team, sc.prices, false);
    const o = g.openNextSeason();
    if (!o.ok) throw new Error(o.message);
  }
  return rows;
}

const eok = (x: number) => (x / 1e4).toFixed(1);
const res = new Map<string, YearRow[][]>();
for (const sc of runList) {
  for (const seed of seeds) {
    const t0 = Date.now();
    (res.get(sc.key) ?? res.set(sc.key, []).get(sc.key)!).push(runOne(sc, seed));
    console.error(`${sc.key} ${seed} ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  }
}
const mean = (rs: YearRow[][], i: number, f: (r: YearRow) => number) => rs.reduce((s, r) => s + f(r[i]), 0) / rs.length;
const lines: string[] = [];
lines.push(`# 입장권 좌석 등급 가격 점검 (${teamName}, ${year} 시작, ${seasons}시즌, 시드 ${seeds.join(', ')})`, '');
lines.push(`좌석 등급: ${SEAT_GRADES.map((k) => SEAT_LABEL[k]).join('·')} (가격 열 = 그 시즌 확정 배율 %, 일반/지정/프리미엄). 금액은 억 원(2026년 돈), 시드 평균.`, '');
lines.push('관중률 = 정규시즌 홈 관중 ÷ (홈 경기 × 좌석). 팬 = 결산 뒤 팬 만족도, 가격 = 그 결산의 "입장권 가격" 만족도 변화. 수지 = 그 해 수지 (긴급 지원 전).', '');
lines.push('| 시나리오 | ' + Array.from({ length: seasons }, (_, i) => `${year + i} 관중률 / 관중 수입 / 스폰서 / 팬 (가격)`).join(' | ') + ` | ${seasons}시즌 관중 수입 합 | ${seasons}시즌 수지 합 | 마지막 자금 |`);
lines.push('|---|' + '---|'.repeat(seasons + 3));
const base = res.get('base');
for (const sc of runList) {
  const rs = res.get(sc.key)!;
  const cells = Array.from({ length: seasons }, (_, i) =>
    `${(mean(rs, i, (r) => r.fill) * 100).toFixed(1)}% / ${eok(mean(rs, i, (r) => r.gate))} / ${eok(mean(rs, i, (r) => r.sponsor))} / ${mean(rs, i, (r) => r.fans).toFixed(1)} (${mean(rs, i, (r) => r.fanPrice).toFixed(1)})`);
  const sum = (f: (r: YearRow) => number) => rs.reduce((s, r) => s + r.reduce((a, x) => a + f(x), 0), 0) / rs.length;
  const d = (v: number, f: (r: YearRow) => number) => (base && sc.key !== 'base' ? ` (${v - (base.reduce((s, r) => s + r.reduce((a, x) => a + f(x), 0), 0) / base.length) >= 0 ? '+' : '−'}${eok(Math.abs(v - base.reduce((s, r) => s + r.reduce((a, x) => a + f(x), 0), 0) / base.length))})` : '');
  const g = sum((r) => r.gate);
  const n = sum((r) => r.net);
  lines.push(`| ${sc.label} | ${cells.join(' | ')} | ${eok(g)}${d(g, (r) => r.gate)} | ${eok(n)}${d(n, (r) => r.net)} | ${eok(mean(rs, seasons - 1, (r) => r.cash))} |`);
}
lines.push('', '추천 가격 자동의 시즌별 확정 배율 (시드별): ' + (base ? base.map((r, i) => `${seeds[i]} ${r.map((x) => x.prices).join(' → ')}`).join(' · ') : '-'), '');
lines.push('괄호 안은 "추천 가격 자동" 대비 차이. 경기 결과는 돈이 AI 판단(FA·트레이드)을 바꾸기 전까지 같아, 시나리오 사이 차이는 주로 가격 몫이다.', '');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n'));
console.log(lines.join('\n'));
