// 현금만 트레이드·지명권 되팔기 악용 측정 (2026-11-25, 반증 확인 #1·#2, 카드 '트레이드 현금·픽 악용').
// 조사 직원의 재현 스크립트(probe_trade.mts)를 옮겼다. 게임 규칙·값은 바꾸지 않는다.
//
// 갈래 (--part):
//   cash   개막일(시작 연도 0일)에 우리 구단 자금 전부를 걸고, AI 구단 국내 선수 하나씩을 현금만으로 살 수 있는지 본다.
//          수락되면 최소 현금(1,000만 원 정밀)을 이분 탐색으로 찾는다. 가치(playerValue, AI 성향 가중치)와 문턱별 남는 인원.
//   picks  난이도마다 새 판에서: AI 구단이 가진 다음 드래프트 1·2라운드 지명권을 최저가로 사서(실제 실행),
//          다른 AI 구단 중 가장 비싸게 사 주는 곳에 되판다(실제 실행). 차익 합과 장마다 값.
//
// 실행 (heavy2.sh로):
//   npx tsx tools/trade_cash_probe.ts --part cash --team KT --seed probe [--thresholds 8,10,12,15]
//   npx tsx tools/trade_cash_probe.ts --part picks --team KT --seeds probe,a,b --difficulty easy,normal,hard [--rep 70]
//   --resale 1: 세부 난이도 '넘겨받은 지명권'을 허용으로 바꿔 격차만의 효과를 잰다
//   --rep: 단장 평판을 그 값으로 두고 잰다 (평판 호의 repGoodwill가 사고팔 때 두 번 붙는 경우)

import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { playerValue } from '../src/ai/value';
import { horizonWeights, tendencyOf } from '../src/ai/trade';
import type { Difficulty } from '../src/league/owner';
import { PRESETS } from '../src/league/difficulty';
import { installCalCache } from './calCache';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const part = arg('part', 'cash')!;
const teamName = arg('team', 'KT')!;
const year = Number(arg('year', '2026'));
installCalCache();
const store = loadDataStore();
const teamIdx = store.season(year)!.teams.findIndex((t) => t.name === teamName);
if (teamIdx < 0) throw new Error(`구단 없음: ${teamName}`);
const eok = (man: number) => (man / 1e4).toFixed(1);

if (part === 'cash') {
  const seed = arg('seed', 'probe')!;
  const difficulty = (arg('difficulty', 'normal') as Difficulty);
  const thresholds = arg('thresholds', '8,10,12,15,20')!.split(',').map(Number);
  const g = GameSession.create(store, { year, teamIdx, seed, difficulty }, DEFAULT_PARAMS);
  const myCash = g.cashNow();
  console.log(`# 현금만 트레이드 (${teamName}, 시드 ${seed}, ${difficulty}, ${year} 개막일, 자금 ${eok(myCash)}억)`);
  const rows: { team: string; name: string; age: number; val: number; cash: number; core: boolean }[] = [];
  for (const t of g.world.teams) {
    if (t.idx === teamIdx) continue;
    const w = horizonWeights(tendencyOf(g.situation(t.idx)), 1);
    // 주전급: 그 구단 가치(이번 시즌) 상위 14명 (ai/trade.ts coreAge와 같은 기준)
    const core = new Set([...t.org].sort((a, b) => playerValue(b, g.values, [1]) - playerValue(a, g.values, [1]) || a.idx - b.idx).slice(0, 14).map((p) => p.idx));
    for (const p of t.org) {
      if (p.foreign) continue;
      if (g.evaluateTrade(t.idx, [], [p], myCash).verdict !== 'accept') continue;
      let lo = 0, hi = myCash;
      while (hi - lo > 1000) { const m = Math.round((lo + hi) / 2); if (g.evaluateTrade(t.idx, [], [p], m).verdict === 'accept') hi = m; else lo = m; }
      rows.push({ team: t.name, name: p.name, age: p.age ?? 28, val: playerValue(p, g.values, w), cash: hi, core: core.has(p.idx) });
    }
  }
  rows.sort((a, b) => b.val - a.val);
  const young = (r: typeof rows[number]) => r.age <= 25 && r.val >= 15;
  console.log(`수락 ${rows.length}명 · 가치 20런 이상 ${rows.filter((r) => r.val >= 20).length} · 25세 이하·15런 이상 ${rows.filter(young).length} · 주전급(구단 상위 14) ${rows.filter((r) => r.core).length}`);
  console.log('\n| 문턱 (런) | 현금만으로 남는 인원 | 그중 주전급 | 25세 이하 10런 이상 | 남는 최고 가치 선수 |');
  console.log('|---|---|---|---|---|');
  for (const th of thresholds) {
    const left = rows.filter((r) => r.val < th);
    const top = left[0];
    console.log(`| ${th} | ${left.length} | ${left.filter((r) => r.core).length} | ${left.filter((r) => r.age <= 25 && r.val >= 10).length} | ${top ? `${top.team} ${top.name} ${top.age}세 ${top.val.toFixed(1)}런 ${eok(top.cash)}억` : '-'} |`);
  }
  console.log('\n상위 25명:');
  for (const r of rows.slice(0, 25)) console.log(`  ${r.team} ${r.name} ${r.age}세 가치 ${r.val.toFixed(1)}런${r.core ? ' (주전급)' : ''} 현금 ${eok(r.cash)}억`);
  // 선수를 끼우되 현금이 대부분인 제안: 우리 구단 가장 덜 아까운 선수 1명 + 현금으로 문턱 위 선수를 살 수 있나
  const cheap = [...g.team.org].filter((p) => !p.foreign).sort((a, b) => playerValue(a, g.values, [1]) - playerValue(b, g.values, [1]) || a.idx - b.idx)[0];
  let pass = 0, tried = 0;
  for (const r of rows.filter((x) => x.val >= thresholds[0]).slice(0, 40)) {
    const t = g.world.teams.find((x) => x.name === r.team)!;
    const p = t.org.find((x) => x.name === r.name)!;
    tried++;
    if (g.evaluateTrade(t.idx, [cheap], [p], myCash).verdict === 'accept') pass++;
  }
  console.log(`\n최하 가치 선수(${cheap.name}) 1명 + 자금 전부로 문턱(${thresholds[0]}런) 위 상위 40명 중 수락: ${pass}/${tried}`);
} else if (part === 'picks') {
  const seeds = arg('seeds', 'probe')!.split(',');
  const diffs = arg('difficulty', 'easy,normal,hard')!.split(',') as Difficulty[];
  const rep = arg('rep');
  console.log(`# 지명권 되팔기 (${teamName}, ${year} 개막일, 다음 드래프트 1·2라운드${rep ? `, 단장 평판 ${rep}` : ''})`);
  console.log('\n| 시드 | 난이도 | 산 장수 | 되판 장수 | 이득 난 장의 차익 합 (억) | 되판 장 모두의 차익 합 (억) | 장마다 차익 (억) | 자금 전 → 후 (억) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const seed of seeds) for (const difficulty of diffs) {
    const resale = arg('resale');
    const g = GameSession.create(store, { year, teamIdx, seed, difficulty, ...(resale ? { settings: { ...PRESETS[difficulty], pickResale: Number(resale) } } : {}) }, DEFAULT_PARAMS);
    if (rep) g.league.reputation = { value: Number(rep), log: [] };
    const start = g.cashNow();
    const teams = g.world.teams.map((t) => t.idx).filter((i) => i !== teamIdx);
    let bought = 0, sold = 0, profit = 0, plus = 0;
    const each: string[] = [];
    for (let round = 1; round <= 2; round++) {
      for (const seller of teams) {
        const pk = g.ownedPicks(seller).find((p) => p.draft === year + 1 && p.round === round);
        if (!pk) continue;
        const cap = Math.min(g.cashNow(), 300000);
        const buyOk = (c: number) => g.evaluateTrade(seller, [], [], c, { give: [], get: [pk] }).verdict === 'accept';
        if (cap <= 0 || !buyOk(cap)) continue;
        let lo = 0, hi = cap;
        while (hi - lo > 500) { const m = Math.round((lo + hi) / 2); if (buyOk(m)) hi = m; else lo = m; }
        if (g.proposeTrade(seller, [], [], hi, { give: [], get: [pk] }).verdict !== 'accept') continue;
        bought++;
        let best = { team: -1, cash: 0 };
        for (const buyer of teams) {
          if (buyer === seller) continue;
          const sellOk = (c: number) => g.evaluateTrade(buyer, [], [], -c, { give: [pk], get: [] }).verdict === 'accept';
          if (!sellOk(1000)) continue;
          let lo2 = 1000, hi2 = 400000;
          while (hi2 - lo2 > 500) { const m = Math.round((lo2 + hi2) / 2); if (sellOk(m)) lo2 = m; else hi2 = m; }
          if (lo2 > best.cash) best = { team: buyer, cash: lo2 };
        }
        const tag = `${round}R ${g.world.teams[seller].name}(${g.tendency(seller) === 'contend' ? '도전' : '리빌딩'})`;
        if (best.team < 0) { each.push(`${tag} 매입 ${eok(hi)} 되팔 곳 없음`); continue; }
        if (g.proposeTrade(best.team, [], [], -best.cash, { give: [pk], get: [] }).verdict !== 'accept') continue;
        sold++;
        profit += best.cash - hi;
        plus += Math.max(0, best.cash - hi);
        each.push(`${tag} ${eok(hi)} → ${g.world.teams[best.team].name}(${g.tendency(best.team) === 'contend' ? '도전' : '리빌딩'}) ${eok(best.cash)} = ${eok(best.cash - hi)}`);
      }
    }
    console.log(`| ${seed} | ${difficulty} | ${bought} | ${sold} | ${eok(plus)} | ${eok(profit)} | ${each.join('; ') || '-'} | ${eok(start)} → ${eok(g.cashNow())} |`);
  }
}
