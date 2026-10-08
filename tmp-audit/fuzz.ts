// 감사용 무작위 조작 퍼저: 시즌·오프시즌 조작을 무작위로 하고
// (1) 조작 기록 재현(replay) (2) 중간 저장 → 불러오기 → 같은 조작 계속 이 끊김 없는 게임과 같은지, (3) 불변식을 본다.
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng, LINEUP_SLOTS } from '../src/engine';
import { GameSession, type GameSave } from '../src/game/session';
import { ORG_LIMIT } from '../src/league/salary';
const store = loadDataStore();
const P = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const seeds = (process.argv[2] ?? 'f1').split(',');
const years = Number(process.argv[3] ?? 1);
const strip = (s: GameSave) => JSON.stringify(s);

type Step = (g: GameSession) => void;
function plan(rng: Rng): Step[] {
  // 미리 정한 조작 목록이 아니라 g 상태를 보고 rng로 고르는 함수열 (두 게임에 같은 rng 순서를 쓰면 같은 조작)
  return [];
}
function act(g: GameSession, r: Rng, issues: string[]): void {
  if (g.phase === 'season') {
    const k = r.chance(0.35) ? r.int(5) : 5 + r.int(5);
    if (g.postseasonRunning && k < 3) { g.advancePostseason(1 + r.int(3)); return; }
    if (g.done && !g.postseasonRunning) { g.beginOffseason(); return; }
    if (k <= 4 || !g.canManage) { if (!g.done) g.advance(1 + r.int(3)); else g.advancePostseason(1); return; }
    const org = g.team.org;
    if (k === 5) { const p = org[r.int(org.length)]; const reg = new Set(g.registered().map((x) => x.idx)); g.move(p, !reg.has(p.idx)); return; }
    if (k === 6) {
      if (!g.manualEntry) return;
      const hitters = g.registered().filter((p) => !p.isPitcher);
      if (!hitters.length) return;
      const p = hitters[r.int(hitters.length)];
      g.setHitterSlot(p, r.chance(0.2) ? null : LINEUP_SLOTS[r.int(LINEUP_SLOTS.length)]); return;
    }
    if (k === 7) {
      const ps = g.registered().filter((p) => p.isPitcher);
      if (!ps.length) return;
      g.setPitcherRole(ps[r.int(ps.length)], (['SP', 'RP', 'CL'] as const)[r.int(3)]); return;
    }
    if (k === 8 && g.tradeOpen) {
      const other = (g.teamIdx + 1 + r.int(g.world.teams.length - 1)) % g.world.teams.length;
      const want = g.world.teams[other].org.filter((p) => !p.foreign);
      const w = [want[r.int(want.length)]];
      const pkg = g.askPackage(other, w);
      if (pkg && r.chance(0.7)) {
        const ev = g.proposeTrade(other, pkg, w);
        if (ev.verdict !== 'accept') issues.push(`요구안 그대로 제안했는데 거절: ${ev.verdict} ${ev.message}`);
      }
      return;
    }
    if (k === 9) { g.setEntry(r.chance(0.5) ? null : g.registered().map((p) => p.idx)); return; }
    return;
  }
  const off = g.offseason!;
  const k = r.int(6);
  if (off.stage === 'ready') { if (k < 4) { const res = g.openNextSeason(); if (!res.ok) issues.push('개막 실패 ' + res.message); } return; }
  if (g.owner.offers?.length) { g.acceptOffer(g.owner.offers[r.int(g.owner.offers.length)]); return; }
  if (k === 0) {
    if (off.stage === 'fa') { const open = off.fa.entries.filter((e) => e.status === 'open'); if (open.length) { const e = open[r.int(open.length)]; g.offerFa(e.id, Math.round(e.ask * r.range(0.7, 1.4)), 1 + r.int(4)); } }
    if (off.stage === 'foreign' && off.foreign) { const ids = Object.keys(off.foreign.keep); if (ids.length) g.setForeignKeep(ids[r.int(ids.length)], r.chance(0.5)); else if (off.foreign.pool.length) g.signForeign(off.foreign.pool[r.int(off.foreign.pool.length)]); }
    if (off.stage === 'draft' && off.draft) { if (off.draft.pool.length) g.draft(r.chance(0.5) ? null : off.draft.pool[r.int(off.draft.pool.length)]); }
    if (off.stage === 'salary' && off.salary) { const ids = Object.keys(off.salary.offers); if (ids.length) { const id = ids[r.int(ids.length)]; g.setSalaryOffer(id, Math.round(off.salary.demands[id] * r.range(0.6, 1.3))); } }
    if (off.stage === 'comp') { const c = off.comp?.find((x) => x.from === g.teamIdx && x.pick === null); if (c) g.autoComp(); }
    if (off.stage === 'release') { const mine = g.league.players.filter((p) => p.team === g.teamIdx); if (r.chance(0.3)) g.release(mine[r.int(mine.length)].id); }
    return;
  }
  if (off.stage === 'draft') g.autoDraft();
  if (off.stage === 'comp') g.autoComp();
  if (off.stage === 'release') g.autoRelease();
  const res = g.nextStage();
  if (!res.ok) issues.push(`단계 진행 막힘 (${off.stage}): ${res.message}`);
}

function invariants(g: GameSession, issues: string[], tag: string) {
  if (g.phase === 'offseason' && g.offseason!.stage === 'ready') {
    for (let t = 0; t < g.league.teams.length; t++) {
      const n = g.league.players.filter((p) => p.team === t && p.military?.state !== 'serving').length;
      if (n > ORG_LIMIT) issues.push(`${tag} ${g.league.teams[t].name} ${n}명 > 정원`);
    }
  }
  if (g.phase === 'season') {
    const reg = g.registered();
    if (g.manualEntry && reg.length > g.world.rules.rosterSize) issues.push(`${tag} 1군 ${reg.length}명`);
    const ids = new Set(g.world.players.map((p) => p.id));
    if (ids.size !== g.world.players.length) issues.push(`${tag} 월드 선수 id 중복`);
  }
}

for (const seed of seeds) {
  const t0 = Date.now();
  const issues: string[] = [];
  const opts = { year: 2026, teamIdx: new Rng(seed).int(10), seed };
  const a = GameSession.create(store, opts, P);
  const r = new Rng('fuzz/' + seed);
  let steps = 0, mid: GameSave | null = null, midRng = 0, midSteps = 0;
  const target = 2026 + years;
  while (a.year < target && steps < 20000) {
    act(a, r, issues); steps++;
    invariants(a, issues, `[${a.year} ${a.phase}]`);
    if (!mid && steps === 120) { mid = JSON.parse(JSON.stringify(a.toSave())); midSteps = steps; }
  }
  const finalA = strip(a.toSave());
  // 재현
  const b = GameSession.replay(store, opts, a.actions, undefined, P);
  if (b.phase !== a.phase || b.year !== a.year) issues.push(`재현: 단계/연도 다름 ${b.phase} ${b.year} vs ${a.phase} ${a.year}`);
  else {
    // 재현은 마지막 조작 지점까지만 간다. 같은 지점의 저장을 비교
    const sa = a.toSave(), sb = b.toSave();
    const same = (k: keyof typeof sa) => JSON.stringify(sa[k]) === JSON.stringify(sb[k]);
    for (const k of ['league', 'offseason', 'postseason', 'actions'] as const) if (!same(k)) issues.push(`재현: ${k} 다름`);
    if (JSON.stringify(sa.season) !== JSON.stringify(sb.season)) issues.push(`재현: season 다름 (day ${a.day} vs ${b.day})`);
  }
  // 저장 → 불러오기 뒤 같은 무작위 조작을 이어 가면 끊지 않은 게임과 같아야 한다
  const c = GameSession.load(store, JSON.parse(JSON.stringify(a.toSave())), P);
  const r1 = new Rng('tail/' + seed), r2 = new Rng('tail/' + seed);
  const i1: string[] = [], i2: string[] = [];
  for (let i = 0; i < 150; i++) { act(a, r1, i1); act(c, r2, i2); }
  for (const k of ['league', 'offseason', 'postseason', 'actions', 'season', 'news'] as const) {
    if (JSON.stringify(a.toSave()[k]) !== JSON.stringify(c.toSave()[k])) issues.push(`저장·불러오기 뒤 진행: ${k} 다름`);
  }
  const dist: Record<string, number> = {}; for (const x of a.actions) dist[x.type] = (dist[x.type] ?? 0) + 1;
  console.log(JSON.stringify(dist));
  console.log(`${seed}: team ${opts.teamIdx} steps ${steps} year ${a.year} phase ${a.phase} actions ${a.actions.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const x of [...new Set(issues)].slice(0, 30)) console.log('  -', x, `(x${issues.filter((y) => y === x).length})`);
}
// 분포 확인용
