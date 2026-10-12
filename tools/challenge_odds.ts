// 도전 시나리오의 실제 난이도 재기 (2026-10-12 사용자: "각 팀을 난이도마다 나눌 게 아니라 진짜 난이도대로").
// 우리 구단도 AI에게 맡겨(라인업·오프시즌 모두) 시드 여러 개로 끝까지 돌리고, 클리어·완전 클리어 비율을 잰다.
// 플레이어가 직접 운영하면 성공률은 더 오르지만, 시나리오끼리의 난이도 순서를 보는 데 쓴다.
// 실행: npx tsx tools/challenge_odds.ts --kind season --tier 쉬움,중간,어려움 --seeds 8   (또는 --ids plan-s01,plan-c02, --kind long)
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { CHALLENGES, planTeam } from '../src/league/challenges';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const nSeeds = Number(arg('seeds', '8'));
const ids = arg('ids', '');
const tiers = arg('tier', '쉬움,중간,어려움').split(',');
const kind = arg('kind', 'season');
const store = loadDataStore();
const params = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const list = CHALLENGES.filter((c) => c.plan && (ids ? ids.split(',').includes(c.id) : !c.plan.legacy && c.plan.kind === kind && tiers.includes(c.plan.tier)));

for (const ch of list) {
  const p = ch.plan!;
  const t = planTeam(store, ch)!;
  let ok = 0, full = 0, rankSum = 0, seasons = 0, proj = 0;
  for (let s = 0; s < nSeeds; s++) {
    const g = GameSession.create(store, { year: p.year, teamIdx: t, seed: `odds-${ch.id}-${s}`, difficulty: 'normal', challenge: ch.id }, params);
    proj += g.owner.goal?.projectedRank ?? 0;
    for (let guard = 0; guard < 15 && !g.league.challenge?.result; guard++) {
      g.advance(100000);
      g.beginOffseason();
      for (const m of g.league.challenge?.marks?.filter((x) => x.year === g.year) ?? []) { rankSum += m.rank; seasons++; }
      if (g.league.challenge?.result) break;
      // 우리 구단 FA도 AI처럼 (FA 단계를 넘길 때만 userTeam을 비워 AI 규칙으로 영입·재계약하게 한다)
      let k = 0;
      while (g.offseason!.stage !== 'ready' && k++ < 40) {
        const st = g.offseason!.stage;
        if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
        g.offseason!.userTeam = st === 'fa' ? -1 : g.teamIdx;
        const r = g.nextStage();
        if (!r.ok && g.owner.offers?.length) g.acceptOffer(g.owner.offers[0]);
      }
      g.offseason!.userTeam = g.teamIdx;
      const o = g.openNextSeason();
      if (!o.ok) throw new Error(o.message);
    }
    const c = g.league.challenge!;
    if (c.result === 'success') ok++;
    if (c.complete) full++;
  }
  const pc = (x: number) => `${Math.round((x / nSeeds) * 100)}%`;
  console.log(`${ch.id}\t${p.tier}${p.level ? `(${p.level})` : ''}\t${p.year} ${p.franchise}\t${p.title}\t성공 ${pc(ok)}\t완전 ${pc(full)}\t평균순위 ${(rankSum / Math.max(1, seasons)).toFixed(1)}\t예상순위 ${(proj / nSeeds).toFixed(1)}\t${ch.intro}`);
}
