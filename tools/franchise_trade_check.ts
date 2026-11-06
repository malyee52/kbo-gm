// 프랜차이즈 스타 트레이드 점검 (2026-11-05, 기획안 docs/프랜차이즈_트레이드_기획안.md).
// 우리 구단도 AI에게 맡겨(challenge_odds.ts와 같은 방식) 여러 시즌을 돌리며, AI 구단이 자기 구단 오래된 선수를 내놓는 네 길을 센다:
//  ① AI끼리 트레이드(aiTradeDay)  ② 우리에게 오는 제안(aiTradeOffer)  ③ 선수 내놓기(shopOffers)  ④ 요구안(askPackageWhy)
// ①②는 시즌마다 전부, ③④는 --sample-every 해마다 개막 때 표본으로 묻는다. 시즌 진행을 바꾸지 않는다 (③④는 평가만 한다).
// 재직 시즌·구단 WAR·칭호를 함께 남겨, 정의·가산치를 나중에 JSON에서 바꿔 보며 잰다 (margin = gain − need: 이 값보다 큰 가산치면 그 거래가 막힌다).
//
// 실행: npx tsx tools/franchise_trade_check.ts --seasons 15 --seeds fr-a,fr-b [--year 2026] [--team LG] [--sample-every 5] [--ask-premia 60,80,120] --out <파일.json>

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluateTrade, FRANCHISE_PREMIUM } from '../src/ai/trade';
import { currentRuns, playerValue } from '../src/ai/value';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyBatLine, emptyPitLine, type SimPlayer } from '../src/engine';
import { GameSession } from '../src/game/session';
import { franchiseTier, titleKeysOf } from '../src/league/franchise';
import { faEligible } from '../src/league/salary';
import { seasonsWith } from '../src/league/stadium';
import { realTitleSeasons } from '../src/league/titles';
import type { LeaguePlayer, SeasonLine } from '../src/league/types';
import { batWarOf, pitWarOf } from '../src/league/war';
import { installCalCache } from './calCache';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const year0 = Number(arg('year', '2026'));
const nSeasons = Number(arg('seasons', '15'));
const seeds = arg('seeds', 'fr-a').split(',');
const teamName = arg('team', 'LG');
const every = Number(arg('sample-every', '5'));
const out = arg('out', 'reports/tmp/franchise-trade.json');
/** 요구안 표본을 다른 A 가산치로도 물어 본다 (쉼표, 런). 측정 안에서만 잠깐 바꾸고 되돌린다. 시즌 진행은 바뀌지 않는다 */
const askPremia = arg('ask-premia', '').split(',').filter(Boolean).map(Number);

installCalCache();
const store = loadDataStore();
const B = Object.keys(emptyBatLine());
const P = Object.keys(emptyPitLine());
const bi = (k: string) => B.indexOf(k);
const pi = (k: string) => P.indexOf(k);

/** 한 시즌 줄의 WAR (history.ts lineWar와 같은 셈) */
function lineWar(g: GameSession, s: SeasonLine, pos: string | null): number {
  const env = g.league.seasonEnv?.[String(s.year)];
  if (!env) return 0;
  let w = 0;
  if (s.bat) { const b = s.bat; w += batWarOf({ pa: b[bi('pa')], h: b[bi('h')], d: b[bi('d')], t: b[bi('t')], hr: b[bi('hr')], bb: b[bi('bb')], hbp: b[bi('hbp')] }, pos, env); }
  if (s.pit) { const q = s.pit; w += pitWarOf({ g: q[pi('g')], gs: q[pi('gs')], outs: q[pi('outs')], hr: q[pi('hr')], bb: q[pi('bb')], hbp: q[pi('hbp')], so: q[pi('so')], r: q[pi('r')] }, env); }
  return w;
}

interface Row {
  id: string; name: string; team: string; real: boolean; age: number | null; pitcher: boolean;
  /** 그 구단 재직 시즌, 그 구단에서 쌓은 WAR, 지금 한 시즌 기여(런), 구단 안 기여 순위(1부터) */
  T: number; W: number; runs: number; rank: number;
  /** 그 구단 프랜차이즈 스타 칭호, 원클럽맨, 레전드 칭호, 칭호 건수 */
  fstar: boolean; one: boolean; legend: boolean; titles: number;
  salary: number; until: number; faNext: boolean; tendency: string; style: string;
  /** 게임 코드의 프랜차이즈 등급 (0 없음, 1 B, 2 A, league/franchise.ts) */
  tier: number;
}

let keyMemo: { titles: unknown; keys: ReturnType<typeof titleKeysOf> } | null = null;
const keysOf = (g: GameSession) => {
  if (!keyMemo || keyMemo.titles !== g.league.titles) keyMemo = { titles: g.league.titles, keys: titleKeysOf(g.league) };
  return keyMemo.keys;
};

function rowOf(g: GameSession, sp: SimPlayer, team: number, rankOf: Map<number, number>): Row | null {
  const L = g.league;
  const lp: LeaguePlayer | undefined = L.players.find((p) => p.id === sp.id);
  if (!lp) return null;
  const t = L.teams[team];
  let W = 0;
  for (const h of lp.history) if (h.team === t.name) W += lineWar(g, h, lp.pos);
  for (const s of realTitleSeasons(store, L.startYear).get(sp.id) ?? []) if (s.fr === t.franchise) W += s.war;
  const recs = (L.titles ?? []).filter((r) => r.id === sp.id);
  return {
    id: sp.id, name: sp.name, team: t.name, real: lp.real, age: sp.age ?? null, pitcher: sp.isPitcher,
    T: seasonsWith(lp, L, team), W: Math.round(W * 10) / 10, runs: Math.round(currentRuns(sp, g.values) * 10) / 10, rank: rankOf.get(sp.idx) ?? 99,
    fstar: recs.some((r) => r.key === `fstar:${t.franchise}`), one: recs.some((r) => r.key === 'one15'), legend: recs.some((r) => r.key.startsWith('L:')), titles: recs.length,
    salary: lp.contract.salary, until: lp.contract.until, faNext: lp.contract.until <= g.year && faEligible(lp, g.year), tendency: g.tendency(team), style: L.gm?.[team] ?? 'balanced',
    tier: franchiseTier(lp, L, team, keysOf(g)),
  };
}

const rankMap = (g: GameSession, team: number) => new Map([...g.world.teams[team].org].sort((a, b) => currentRuns(b, g.values) - currentRuns(a, g.values) || a.idx - b.idx).map((p, i) => [p.idx, i + 1]));
const row = (g: GameSession, sp: SimPlayer, team: number) => rowOf(g, sp, team, rankMap(g, team));

interface Rec {
  seed: string; year: number; path: 'ai' | 'offer' | 'shop' | 'ask'; out: Row | null; other?: Row | null; margin?: number; found?: boolean; fromRank?: number;
  /** 요구안 조합: 선수마다 한 시즌 기여(런)·나이·우리 구단 기여 순위 */
  pkg?: { runs: number; age: number | null; rank: number }[];
  /** 요구안: 다른 A 가산치(런)에서도 값이 나오는가 */
  alt?: Record<string, boolean>;
}
const recs: Rec[] = [];
const census: (Row & { seed: string; year: number })[] = [];
const yearly: { seed: string; year: number; ai: number; offers: number; sd?: number; faFiled?: number; faMoved?: number }[] = [];

for (const seed of seeds) {
  const t0 = Date.now();
  const lg = store.season(year0)!.teams.findIndex((t) => t.name === teamName);
  const g = GameSession.create(store, { year: year0, teamIdx: lg, seed, difficulty: 'normal', ratingBasis: 'season' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
  const G = g as unknown as Record<string, (...a: unknown[]) => unknown>;
  // ② 우리에게 오는 제안: 나온 제안을 그대로 돌려주고 기록만 한다
  let offers = 0;
  const offer0 = G.aiTradeOffer.bind(g);
  G.aiTradeOffer = (rng: unknown) => {
    const o = offer0(rng) as { team: number; give: string; get: string } | null;
    if (o) {
      const get = g.world.players.find((p) => p.id === o.get)!;
      const give = g.world.players.find((p) => p.id === o.give)!;
      const ev = g.evaluateTrade(o.team, [give], [get]);
      recs.push({ seed, year: g.year, path: 'offer', out: row(g, get, o.team), other: row(g, give, g.teamIdx), margin: ev.detail.gain - ev.detail.need });
      offers++;
    }
    return o;
  };
  // ① AI끼리: 소속이 바뀌기 바로 앞에 fanStarLeaves(파는 구단, x) → (사는 구단, y) 순서로 불린다. 그때 파는 구단의 평가를 다시 낸다 (지명권은 뺀 값)
  let inAi = false;
  let pendX: { team: number; x: SimPlayer } | null = null;
  const day0 = G.aiTradeDay.bind(g);
  G.aiTradeDay = () => { inAi = true; day0(); inAi = false; pendX = null; };
  const fan0 = G.fanStarLeaves.bind(g);
  G.fanStarLeaves = (team: unknown, sp: unknown) => {
    if (inAi) {
      if (!pendX) pendX = { team: team as number, x: sp as SimPlayer };
      else {
        const { team: b, x } = pendX;
        const ev = evaluateTrade({ aiTeam: b, receive: [sp as SimPlayer], give: [x] }, g.world.teams[b].org, g.situation(b), g.values);
        recs.push({ seed, year: g.year, path: 'ai', out: row(g, x, b), other: row(g, sp as SimPlayer, team as number), margin: ev.detail.gain - ev.detail.need });
        pendX = null;
      }
    }
    fan0(team, sp);
  };

  for (let k = 0; k < nSeasons; k++) {
    const y = g.year;
    offers = 0;
    // 재직 3시즌 이상 전수 (정의 맞추기용)
    for (const t of g.world.teams) {
      const rm = rankMap(g, t.idx);
      for (const p of t.org) {
        if (p.foreign) continue;
        const r = rowOf(g, p, t.idx, rm);
        if (r && r.T >= 3) census.push({ ...r, seed, year: y });
      }
    }
    if (k % every === 0) {
      const v = (p: SimPlayer) => playerValue(p, g.values, [1, 0.6]);
      const mine = g.team.org.filter((p) => !p.foreign).sort((a, b) => v(b) - v(a) || a.idx - b.idx);
      // ③ 선수 내놓기: 우리 1·3·8위를 내놓으면 AI가 누구를 내주겠다고 하나
      for (const r of [0, 2, 7]) {
        if (!mine[r]) continue;
        for (const o of g.shopOffers([mine[r]], 0, 'players')) {
          const ev = g.evaluateTrade(o.team, [mine[r]], o.get);
          for (const p of o.get) recs.push({ seed, year: y, path: 'shop', out: row(g, p, o.team), margin: ev.detail.gain - ev.detail.need, fromRank: r + 1 });
        }
      }
      // ④ 요구안: 구단마다 재직 5시즌 이상 국내 선수 기여 상위 2명에게 값을 묻는다
      for (const t of g.world.teams) {
        if (t.idx === g.teamIdx) continue;
        const rm = rankMap(g, t.idx);
        const top = t.org.filter((p) => !p.foreign).map((p) => rowOf(g, p, t.idx, rm)).filter((r): r is Row => !!r && r.T >= 5).sort((a, b) => b.runs - a.runs).slice(0, 2);
        for (const r of top) {
          const sp = t.org.find((p) => p.id === r.id)!;
          const a = g.askPackageWhy(t.idx, [sp]);
          const ev = a.pkg ? g.evaluateTrade(t.idx, a.pkg, [sp]) : null;
          const myRank = rankMap(g, g.teamIdx);
          const pkg = a.pkg?.map((p) => ({ runs: Math.round(currentRuns(p, g.values) * 10) / 10, age: p.age ?? null, rank: myRank.get(p.idx) ?? 99 }));
          const alt: Record<string, boolean> = {};
          if (r.tier === 2) {
            const a0 = FRANCHISE_PREMIUM[2];
            for (const v of askPremia) { FRANCHISE_PREMIUM[2] = v; alt[v] = !!g.askPackageWhy(t.idx, [sp]).pkg; }
            FRANCHISE_PREMIUM[2] = a0;
          }
          recs.push({ seed, year: y, path: 'ask', out: r, found: !!a.pkg, ...(ev ? { margin: ev.detail.gain - ev.detail.need } : {}), ...(pkg ? { pkg } : {}), ...(askPremia.length ? { alt } : {}) });
        }
      }
    }
    g.advance(100000);
    // 구단 격차: 승률 표준편차 (longsim은 시즌 중 트레이드를 돌리지 않아 이 도구에서 잰다)
    const pct = g.season.teams.map((t) => t.w / Math.max(1, t.w + t.l));
    const mean = pct.reduce((a, b) => a + b, 0) / pct.length;
    const sd = Math.sqrt(pct.reduce((a, b) => a + (b - mean) ** 2, 0) / pct.length);
    yearly.push({ seed, year: y, ai: (g.league.aiTrades ?? []).filter((t) => t.year === y).length, offers, sd });
    console.log(`[${seed}] ${y} 끝: AI끼리 ${yearly.at(-1)!.ai}, 제안 ${offers}, ${Math.round((Date.now() - t0) / 1000)}초`);
    if (k === nSeasons - 1) break;
    g.beginOffseason();
    let n = 0;
    while (g.offseason!.stage !== 'ready' && n++ < 40) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft();
      if (st === 'comp') g.autoComp();
      if (st === 'release') g.autoRelease();
      g.offseason!.userTeam = st === 'fa' ? -1 : g.teamIdx;
      const r = g.nextStage();
      if (!r.ok && g.owner.offers?.length) g.acceptOffer(g.owner.offers[0]);
    }
    g.offseason!.userTeam = g.teamIdx;
    const faE = (g.offseason!.fa?.entries ?? []).filter((e) => !e.returnee);
    Object.assign(yearly.at(-1)!, { faFiled: faE.length, faMoved: faE.filter((e) => e.status === 'signed' && e.team !== undefined && e.team !== e.from).length });
    const o = g.openNextSeason();
    if (!o.ok) throw new Error(o.message);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ year0, nSeasons, seeds, every, recs, yearly, census }));
}

console.log(`끝: ${out} (기록 ${recs.length}, 전수 ${census.length})`);
