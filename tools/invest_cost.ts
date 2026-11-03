// 투자 단계 비용 점검 (2026-10-29 사용자: "스카우트 팀이나 의료팀에 책정된 비용이 너무 과해 감당이 불가능한 수준임 3단계기준").
// 2026 시작, 모기업 등급 A·B·C 구단(기본 삼성·두산·히어로즈)의 투자를 시나리오대로 고정하고 몇 시즌 돌려 결산 자금을 본다.
// 나머지 운영(연봉·FA·캡·지명)은 AI에게 맡긴다 (first_season.ts와 같은 방식). 세 구단에 같은 시나리오를 함께 건다
// (구단 사이 영향은 FA 시장 정도라 작다고 본다). 시나리오 base는 아무것도 건드리지 않아 AI 자동 배분 단계를 보여 준다.
//
// 실행: npx tsx tools/invest_cost.ts [--seeds a,b] [--seasons 3] [--year 2026] [--teams 삼성,두산,히어로즈] [--out reports/invest-cost.md]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { ensureFinance, INVEST_COST, INVEST_KINDS, type InvestKind, investCost, MARKETING_DOWN, MARKETING_UP, marketingStock, marketOf, popularity, SPONSOR_BASE, starBonus, stepMarketing } from '../src/league/finance';
import { fanLevel, fanSponsor } from '../src/league/stadium';
import { settingsOf, userTeamOf } from '../src/league/difficulty';
import { parentGrade } from '../src/league/owner';
import { wageIndex } from '../src/league/salary';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const seeds = (arg('seeds', 'ic-a,ic-b') ?? '').split(',');
const seasons = Number(arg('seasons', '3'));
const year = Number(arg('year', '2026'));
const teamNames = (arg('teams', '삼성,두산,히어로즈') ?? '').split(',');
const out = arg('out', 'reports/invest-cost.md')!;

type Plan = Partial<Record<InvestKind, number>>;
const SCENARIOS: { key: string; label: string; plan: Plan | null }[] = [
  { key: 'base', label: 'AI 자동 배분 (손대지 않음)', plan: null },
  { key: 'one', label: '모두 1단계', plan: { scout: 1, scoutPro: 1, develop: 1, medical: 1, marketing: 1 } },
  { key: 'scout3', label: '스카우트 둘 3단계 (나머지 1)', plan: { scout: 3, scoutPro: 3, develop: 1, medical: 1, marketing: 1 } },
  { key: 'med3', label: '의료 3단계 (나머지 1)', plan: { scout: 1, scoutPro: 1, develop: 1, medical: 3, marketing: 1 } },
  { key: 'all3', label: '모두 3단계', plan: { scout: 3, scoutPro: 3, develop: 3, medical: 3, marketing: 3 } },
];
const only = arg('scenarios');
const runList = only ? SCENARIOS.filter((s) => only.split(',').includes(s.key)) : SCENARIOS;

interface YearRow { year: number; team: string; grade: string; cash: number; net: number; rescue: number; dividend: number; invest: number; payroll: number }
/**
 * 마케팅 쌓인 효과별 수입 (같은 시즌 경기 기록에 쌓인 효과 0·1·2·3단계만 바꿔 다시 셈): 정규시즌 관중 수입·스폰서 (만 원).
 * oldSponsor: 2026-10-29 전 셈 (스폰서 배율을 인기도 상한 1.4 안에서 곱함), clamp: 0단계 인기도가 이미 상한
 */
interface MkRow { year: number; team: string; grade: string; gate: number[]; sponsor: number[]; oldSponsor: number[]; clamp: boolean }
interface Run { scenario: string; seed: string; rows: YearRow[]; zero: number[]; aiLevels: Record<string, Record<InvestKind, number>[]>; mk: MkRow[] }

const store = loadDataStore();
/** 2026-10-29 전 마케팅 비용·효과 (전 → 후 표) */
const OLD_MK_COST = [0, 100_000, 250_000, 450_000];
const OLD_MK_FILL_RATIO = 0.75; // 전 관중률 보정 0.03씩 ÷ 지금 0.04씩 (관중률 한계에 걸리지 않으면 관중 수입 증가가 이 비율)
const OLD_MK_SPONSOR = [1, 1.05, 1.1, 1.15];

/** 시나리오 구단의 투자를 덮어쓴다. 마케팅 쌓인 효과는 개막 전 값(prev)에서 한 해만큼 옮긴다 (lockInvestments와 같은 셈) */
function setPlan(g: GameSession, teams: number[], plan: Plan, prev: number[]) {
  ensureFinance(g.league);
  for (const t of teams) {
    const f = g.league.finance![t];
    f.invest = { ...f.invest, ...plan };
    f.active = { ...f.invest };
    f.mk = stepMarketing(prev[t], f.active.marketing);
  }
}

function runOne(scenario: (typeof SCENARIOS)[number], seed: string): Run {
  const g0 = GameSession.create(store, { year, teamIdx: 0, seed, difficulty: 'normal', ratingBasis: 'season' }, DEFAULT_PARAMS);
  const teams = teamNames.map((n) => g0.league.teams.findIndex((t) => t.franchise === n || t.name === n));
  if (teams.some((t) => t < 0)) throw new Error(`구단을 찾지 못함: ${teamNames.join(',')}`);
  // 우리 구단 = 둘째(기본 B 등급). 구단주 신뢰도·수입 설정이 이 구단에 붙는다
  const g = GameSession.create(store, { year, teamIdx: teams[1], seed, difficulty: 'normal', ratingBasis: 'season' }, DEFAULT_PARAMS);
  const run: Run = { scenario: scenario.key, seed, rows: [], zero: [], aiLevels: {}, mk: [] };
  if (scenario.plan) setPlan(g, teams, scenario.plan, g.league.teams.map((_, t) => marketingStock(g.league, t)));
  for (let s = 0; s < seasons; s++) {
    const L0 = g.league;
    for (let t = 0; t < L0.teams.length; t++) (run.aiLevels[L0.teams[t].franchise] ??= []).push({ ...(L0.finance?.[t]?.active ?? L0.finance![t].invest) });
    g.advance(100000);
    // 마케팅 단계만 바꿔 정규시즌 관중 수입·스폰서를 다시 센다 (경기 결과는 마케팅과 상관없다).
    // 스폰서는 결산 셈(sponsorAmount)과 같이 기본액 × 수입 배율 × 인기도, 가을야구 깊이는 0으로 둔다 (결산 전이라 모름)
    const stars = starBonus(g.world, L0);
    const mkRows = L0.teams.map((_, t) => {
      const f = L0.finance![t];
      const cur = f.mk;
      const rec = g.season.teams[t];
      const pct = rec && rec.w + rec.l > 0 ? rec.w / (rec.w + rec.l) : 0.5;
      const wage0 = wageIndex(g.world.year, L0);
      const base = SPONSOR_BASE * wage0 * (t === userTeamOf(L0) ? settingsOf(L0).income : 1);
      const raw = (1 + 1.2 * (pct - 0.5) + 2 * marketOf(L0, t) + 2 * (stars[t] ?? 0)) * fanSponsor(fanLevel(L0, t, L0.year));
      const gate: number[] = [], sponsor: number[] = [], oldSponsor: number[] = [];
      for (const lv of [0, 1, 2, 3]) {
        f.mk = lv;
        gate.push(g.seasonFinance(t)?.items.gate ?? 0);
        sponsor.push(Math.round(base * popularity(L0, t, pct, 0, stars[t] ?? 0)));
        oldSponsor.push(Math.round(base * Math.max(0.6, Math.min(1.4, raw * OLD_MK_SPONSOR[lv]))));
      }
      if (cur === undefined) delete f.mk; else f.mk = cur;
      return { gate, sponsor, oldSponsor, clamp: raw >= 1.4 };
    });
    g.beginOffseason();
    const L = g.league;
    const y = g.world.year;
    const wage = wageIndex(y, L);
    for (let t = 0; t < L.teams.length; t++) {
      run.mk.push({ year: y, team: L.teams[t].franchise, grade: parentGrade(L, t), ...mkRows[t] });
    }
    run.zero.push(L.teams.filter((_, t) => (L.finance![t].history.at(-1)?.cash ?? 0) <= 0).length);
    for (let t = 0; t < L.teams.length; t++) {
      const h = L.finance![t].history.at(-1)!;
      run.rows.push({
        year: y, team: L.teams[t].franchise, grade: parentGrade(L, t), cash: h.cash, net: h.net, rescue: h.rescue, dividend: h.dividend ?? 0,
        invest: investCost(L.finance![t], false, wage), payroll: -((h.items.payroll ?? 0) + (h.items.foreign ?? 0)),
      });
    }
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
    const prevMk = g.league.teams.map((_, t) => marketingStock(g.league, t));
    const o = g.openNextSeason();
    if (!o.ok) throw new Error(o.message);
    // AI 구단은 개막 때 lockInvestments가 다시 정한다. 시나리오 구단은 덮어쓴다 (비용은 결산 때 active로 매긴다)
    if (scenario.plan) setPlan(g, teams, scenario.plan, prevMk);
  }
  return run;
}

const ok = (x: number) => (x / 1e4).toFixed(0);
const lines: string[] = [];
lines.push(`# 투자 단계 비용 점검 (${year} 시작, ${seasons}시즌, 시드 ${seeds.join(', ')})`, '');
lines.push('비용 표 (만 원 → 억 원, 0~3단계): ' + INVEST_KINDS.map((k) => `${k} ${INVEST_COST[k].map(ok).join('·')}`).join(' / '), '');
lines.push('시나리오 구단: ' + teamNames.join('·') + ' (등급 A·B·C). 값은 결산 직후(모기업 환원·긴급 지원 뒤) 자금, 억 원. 긴급 = 적자 보전(모기업 긴급 지원) 합', '');
const all: Run[] = [];
for (const sc of runList) {
  for (const seed of seeds) {
    const t0 = Date.now();
    const r = runOne(sc, seed);
    all.push(r);
    console.error(`${sc.key} ${seed} ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  }
}
for (const sc of runList) {
  const rs = all.filter((r) => r.scenario === sc.key);
  lines.push(`## ${sc.label}`, '', '| 구단 (등급) | ' + Array.from({ length: seasons }, (_, i) => `${year + i} 자금 / 수지 / 긴급`).join(' | ') + ' | 투자비 (마지막 해) |', '|---|' + '---|'.repeat(seasons + 1));
  for (const name of teamNames) {
    const cells: string[] = [];
    for (let i = 0; i < seasons; i++) {
      const v = rs.map((r) => r.rows.find((x) => x.team === name && x.year === year + i)!);
      const m = (f: (x: YearRow) => number) => v.reduce((a, x) => a + f(x), 0) / v.length;
      cells.push(`${ok(m((x) => x.cash))} / ${ok(m((x) => x.net))} / ${ok(m((x) => x.rescue))}`);
    }
    const last = rs.map((r) => r.rows.find((x) => x.team === name && x.year === year + seasons - 1)!);
    lines.push(`| ${name} (${last[0].grade}) | ${cells.join(' | ')} | ${ok(last.reduce((a, x) => a + x.invest, 0) / last.length)} |`);
  }
  lines.push('', `자금 0 구단 수 (해마다, 시드 평균): ${Array.from({ length: seasons }, (_, i) => (rs.reduce((a, r) => a + r.zero[i], 0) / rs.length).toFixed(1)).join(' → ')}`, '');
  if (sc.key === 'base') {
    lines.push('### AI 자동 배분 단계 (시즌별, 시드 첫 번째, 갈래 순서 scout·scoutPro·develop·medical·marketing)', '', '| 구단 | ' + Array.from({ length: seasons }, (_, i) => `${year + i}`).join(' | ') + ' |', '|---|' + '---|'.repeat(seasons));
    for (const [fr, lv] of Object.entries(rs[0].aiLevels)) lines.push(`| ${fr} | ${lv.map((x) => INVEST_KINDS.map((k) => x[k]).join('')).join(' | ')} |`);
    const allRows = rs.flatMap((r) => r.rows);
    lines.push('', '### 구단 등급별 평균 (모든 구단, 결산 직후)', '', '| 등급 | 자금 | 수지 | 긴급 | 연봉 | 투자비 |', '|---|---|---|---|---|---|');
    for (const gr of ['A', 'B', 'C']) {
      const v = allRows.filter((x) => x.grade === gr);
      if (!v.length) continue;
      const m = (f: (x: YearRow) => number) => ok(v.reduce((a, x) => a + f(x), 0) / v.length);
      lines.push(`| ${gr} | ${m((x) => x.cash)} | ${m((x) => x.net)} | ${m((x) => x.rescue)} | ${m((x) => x.payroll)} | ${m((x) => x.invest)} |`);
    }
    lines.push('');
  }
}
{
  // 마케팅 단계별 손익. 수입 증가는 같은 시즌 경기 기록에 쌓인 효과만 바꿔 다시 센 값의 평균 (2026 물가, 연봉 지수 1)
  const mk = all.flatMap((r) => r.mk);
  const capped = mk.filter((x) => x.clamp).length;
  const avg = (v: MkRow[], f: (x: MkRow) => number) => v.reduce((a, x) => a + f(x), 0) / (v.length || 1);
  const e = (x: number) => (x / 1e4).toFixed(1);
  lines.push('## 마케팅 단계별 손익 (억 원, 0단계에서 시작해 그 단계를 이어 갈 때)', '',
    `수입 증가는 같은 시즌 경기 기록에 마케팅만 바꿔 정규시즌 관중 수입·스폰서를 다시 센 값 (구단-해 ${mk.length}개 평균, 그중 ${capped}개는 마케팅 없이도 인기도가 상한 1.4).`,
    `전: 효과가 투자한 해에 바로 다 남 (관중률 0.03씩, 스폰서 배율은 인기도 상한 안). 전 관중 수입 증가는 지금 셈 × ${OLD_MK_FILL_RATIO}로 어림.`,
    `후: 쌓인 효과가 개막 때마다 고른 단계 쪽으로 올릴 때 ${MARKETING_UP}, 내릴 때 ${MARKETING_DOWN}만큼 다가감 (관중률 0.04씩, 스폰서 배율은 상한 밖). 가을야구 수입·팬 만족도로 넘어가는 효과는 넣지 않음`, '');
  for (const gr of ['전체', 'A', 'B', 'C']) {
    const v = gr === '전체' ? mk : mk.filter((x) => x.grade === gr);
    if (!v.length) continue;
    const gain = [0, 1, 2, 3].map((s2) => avg(v, (x) => x.gate[s2] - x.gate[0] + x.sponsor[s2] - x.sponsor[0]));
    const oldGain = [0, 1, 2, 3].map((s2) => avg(v, (x) => OLD_MK_FILL_RATIO * (x.gate[s2] - x.gate[0]) + x.oldSponsor[s2] - x.oldSponsor[0]));
    const at = (s2: number) => { const i = Math.min(2, Math.floor(s2)); return gain[i] + (gain[i + 1] - gain[i]) * (s2 - i); };
    lines.push(`### ${gr}`, '', '| 단계 | 전 비용 → 후 비용 | 전 수입 증가 (해마다) | 전 순수지 (해마다) | 후 수입 증가 (다 쌓임) | 후 1년차 순수지 | 후 3년차 | 후 5년차 | 후 다 쌓임 | 후 누적 본전 해 |', '|---|---|---|---|---|---|---|---|---|---|');
    for (let lv = 1; lv <= 3; lv++) {
      const cost = INVEST_COST.marketing[lv];
      let st = 0, cum = 0, pay = '-';
      const net: number[] = [];
      for (let n = 1; n <= 30; n++) {
        st = stepMarketing(st, lv);
        const yearNet = at(st) - cost;
        net.push(yearNet);
        cum += yearNet;
        if (pay === '-' && cum >= 0) pay = `${n}년차`;
      }
      lines.push(`| ${lv} | ${e(OLD_MK_COST[lv])} → ${e(cost)} | ${e(oldGain[lv])} | ${e(oldGain[lv] - OLD_MK_COST[lv])} | ${e(gain[lv])} | ${e(net[0])} | ${e(net[2])} | ${e(net[4])} | ${e(gain[lv] - cost)} | ${pay} |`);
    }
    lines.push('');
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.join('\n'));
