// 세이브·15승·180이닝 투수가 실제보다 적은 원인 나눠 재기 (2026-11-12, 유명무실 그릴 Q40, 엔진은 고치지 않는다).
// reports/nominal-content.md 5장: 30세이브 투수 1.7 (실제 3.0), 최다 세이브 32.8 (36.0), 15승 1.9 (2.7), 180이닝 2.2 (2.7).
//
// 그 해 실제 개막 감독 성향을 건 시즌을 돌려(pen_check와 같은 방식) 다음을 잰다.
//   1) 리그 지표: 30·20세이브 투수, 최다 세이브, 15·10승 투수, 최다 승, 180·150이닝 투수, 경기당 득점 (실제는 자료집 그 해)
//   2) 마무리: 시즌 중 마무리(ts.closer)가 몇 명 바뀌나, 주 마무리가 맡은 날 몫, 팀 세이브 중 1위 몫, 세이브 기회(9회 이후 세이브 상황 등판) 중 마무리 몫,
//      마무리 아닌 투수가 세이브를 가져간 경기의 그날 마무리 상태 (없음·피로·3연투·이미 던짐·쉬었는데 안 씀)
//   3) 선발: 선발 투수(GS 15+, 구원 3 이하)의 GS·이닝/GS·승/GS, 5이닝(15아웃) 채운 선발 몫, 채웠는데 승 못 얻은 몫 (실제는 같은 기준의 자료집 값)
//   4) 실험 (params만, 엔진 코드 그대로): aceDays·starterDeal·planScale.starter·closerWarmup을 바꿔 1)의 지표와 득점 (환경 맞춤은 기본값 그대로 써서 득점 변화가 보인다)
// 사용법:  npx tsx tools/saves_wins.ts [--years 2025,2024,2023] [--seasons 6] [--exp all|none|이름,…] [--out reports/saves-wins.md]
import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, Rng, Season, worldForYear, type EngineParams } from '../src/engine';
import { CLOSER_AVAILABLE_EXTRA } from '../src/engine/params';
import { availableBelow, currentFatigue, needsRest } from '../src/engine/team';
import { infoOf, realOpening, tacticsOf } from '../src/league/managers';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const years = (arg('years') ?? '2025,2024,2023').split(',').map(Number);
const nSeasons = Number(arg('seasons') ?? 6);
const out = arg('out');
const store = loadDataStore();

type Over = { [K in keyof EngineParams]?: unknown };
/** 실험: 이름, 설명, params 덮어쓰기 (객체는 한 단계 합침) */
const EXPERIMENTS: { key: string; label: string; over: (p: EngineParams) => Over }[] = [
  { key: 'base', label: '기본값', over: () => ({}) },
  { key: 'ace2', label: 'mgr.aceDays 1 → 2 (앞 순번 선발을 더 자주)', over: () => ({ mgr: { aceDays: 2 } }) },
  { key: 'ace0', label: 'mgr.aceDays 1 → 0 (가장 오래 쉰 투수)', over: () => ({ mgr: { aceDays: 0 } }) },
  { key: 'deal', label: 'mgr.starterDeal.bonus 0.08 → 0.16 (잘 던지는 선발을 더 길게)', over: (p) => ({ mgr: { starterDeal: { ...p.mgr.starterDeal, bonus: 0.16 } } }) },
  { key: 'plan', label: 'planScale.starter 0.92 → 0.99 (선발 투구 수 기준 +7.6%)', over: (p) => ({ planScale: { ...p.planScale, starter: 0.99 } }) },
  { key: 'warm0', label: 'mgr.closerWarmup 끔 (몸 풀기 등판 없음)', over: (p) => ({ mgr: { closerWarmup: { ...p.mgr.closerWarmup, rest: 999 } } }) },
];
const expArg = arg('exp') ?? 'all';
const exps = expArg === 'all' ? EXPERIMENTS : expArg === 'none' ? EXPERIMENTS.slice(0, 1) : EXPERIMENTS.filter((e) => e.key === 'base' || expArg.split(',').includes(e.key));

function withOver(over: Over): EngineParams {
  const p = { ...DEFAULT_PARAMS } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    const d = (DEFAULT_PARAMS as unknown as Record<string, unknown>)[k];
    p[k] = d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' ? { ...(d as object), ...(v as object) } : v;
  }
  return p as unknown as EngineParams;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');

interface Leaders { sv30: number; sv20: number; svMax: number; w15: number; w10: number; wMax: number; ip180: number; ip150: number; ipMax: number; rpg: number }
function leaders(lines: { w: number; sv: number; outs: number }[], runs: number, games: number): Leaders {
  return {
    sv30: lines.filter((q) => q.sv >= 30).length, sv20: lines.filter((q) => q.sv >= 20).length, svMax: Math.max(0, ...lines.map((q) => q.sv)),
    w15: lines.filter((q) => q.w >= 15).length, w10: lines.filter((q) => q.w >= 10).length, wMax: Math.max(0, ...lines.map((q) => q.w)),
    ip180: lines.filter((q) => q.outs >= 540).length, ip150: lines.filter((q) => q.outs >= 450).length, ipMax: Math.max(0, ...lines.map((q) => q.outs)) / 3,
    rpg: runs / games,
  };
}
const avgLeaders = (xs: Leaders[]): Leaders => {
  const k = Object.keys(xs[0]) as (keyof Leaders)[];
  return Object.fromEntries(k.map((key) => [key, mean(xs.map((x) => x[key]))])) as unknown as Leaders;
};

/** 선발 투수 (GS 15 이상, 구원 등판 3 이하) 묶음 지표 */
interface StarterAgg { n: number; gs: number; ipgs: number; wgs: number; gsMax: number }
function starterAgg(lines: { g: number; gs: number; w: number; outs: number }[]): StarterAgg {
  const s = lines.filter((q) => q.gs >= 15 && q.g - q.gs <= 3);
  const gs = s.reduce((a, q) => a + q.gs, 0);
  return { n: s.length, gs: mean(s.map((q) => q.gs)), ipgs: s.reduce((a, q) => a + q.outs, 0) / 3 / gs, wgs: s.reduce((a, q) => a + q.w, 0) / gs, gsMax: Math.max(0, ...lines.map((q) => q.gs)) };
}

/** 실제 그 해 (자료집, 같은 선수 여러 구단 줄은 합침) */
function realYear(year: number) {
  const d = store.season(year)!;
  const by = new Map<string, { g: number; gs: number; w: number; sv: number; outs: number }>();
  const teamSv = new Map<string, number>();
  const teamTop = new Map<string, number>();
  for (const r of d.pit) {
    const q = by.get(r.id) ?? by.set(r.id, { g: 0, gs: 0, w: 0, sv: 0, outs: 0 }).get(r.id)!;
    q.g += r.g; q.gs += r.gs ?? 0; q.w += r.w; q.sv += r.sv; q.outs += r.outs;
    teamSv.set(r.team, (teamSv.get(r.team) ?? 0) + r.sv);
    teamTop.set(r.team, Math.max(teamTop.get(r.team) ?? 0, r.sv));
  }
  const lines = [...by.values()];
  const runs = d.league.r;
  const games = d.league.teamGames;
  const teamShare = [...teamSv.keys()].map((t) => teamTop.get(t)! / Math.max(1, teamSv.get(t)!));
  return { lead: leaders(lines, runs, games), st: starterAgg(lines), teamSv: mean([...teamSv.values()]) * (144 / (games / d.teams.length)), topShare: mean(teamShare) };
}

type Reason = 'none' | 'fatigue' | 'three' | 'used' | 'idle';
const REASON_LABEL: Record<Reason, string> = {
  none: '그날 마무리 없음 (결장·2군·아직 안 정함)', fatigue: '피로 기준에 걸림', three: '3연투 쉼', used: '같은 경기에 이미 던짐 (몸 풀기·동점 등판 등)', idle: '나올 수 있었는데 안 씀 (9회 전 세이브·3이닝 세이브 등)',
};

interface Diag {
  seasons: number; teamSeasons: number; closers: number[]; mainShare: number[]; topShare: number[]; teamSv: number[];
  svBy: { closer: number; other: number }; reasons: Record<Reason, number>;
  /** 선발 등판: 모두, 15아웃 이상, 15아웃 이상인데 팀 승리, 그중 선발 승 */
  starts: number; q5: number; q5TeamWin: number; q5Win: number; startWin: number;
}

function runSeason(world: ReturnType<typeof worldForYear>, params: EngineParams, cal: ReturnType<typeof calibrate>, seed: string, tac: ReturnType<typeof tacticsOf>[] | undefined, dg: Diag | null) {
  const s = Season.start(world, params, seed, { cal });
  if (tac) s.teamSeasons.forEach((ts, t) => { ts.tactics = tac[t]; });
  if (dg) for (let t = 0; t < world.teams.length; t++) s.boxTeams.add(t);
  const closerDays = world.teams.map(() => new Map<number, number>());
  while (!s.done) {
    const day = s.day;
    // 그날 경기 전 마무리 상태 (지난 엔트리 기준)
    const status = s.teamSeasons.map((ts) => {
      const c = ts.closer;
      if (!c || s.states.absentUntil[c.idx] > day) return { idx: -1, st: 'none' as Reason };
      const pen = ts.tactics?.pen ?? 1;
      if (needsRest(s.states, c.idx, day, pen)) return { idx: c.idx, st: 'three' as Reason };
      if (currentFatigue(s.states, c.idx, day) >= availableBelow(pen) + CLOSER_AVAILABLE_EXTRA) return { idx: c.idx, st: 'fatigue' as Reason };
      return { idx: c.idx, st: 'idle' as Reason };
    });
    const before = s.log.length;
    s.simulateDay();
    if (!dg) continue;
    s.teamSeasons.forEach((ts, t) => { if (ts.closer) closerDays[t].set(ts.closer.idx, (closerDays[t].get(ts.closer.idx) ?? 0) + 1); });
    for (let gi = before; gi < s.log.length; gi++) {
      const g = s.log[gi];
      const box = s.boxes.get(gi);
      if (!box) continue;
      for (const [side, team] of [[box.home, g.home], [box.away, g.away]] as const) {
        side.pitchers.forEach((p, k) => {
          const dw = g.win === p.idx ? 1 : 0;
          const dsv = g.save === p.idx ? 1 : 0;
          if (k === 0) {
            dg.starts++;
            if (dw > 0) dg.startWin++;
            if (p.outs >= 15) {
              dg.q5++;
              if (dw > 0) dg.q5Win++;
              const won = team === g.home ? g.homeRuns > g.awayRuns : g.awayRuns > g.homeRuns;
              if (won) dg.q5TeamWin++;
            }
          }
          if (dsv > 0) {
            const stt = status[team];
            if (p.idx === stt.idx) dg.svBy.closer++;
            else {
              dg.svBy.other++;
              const reason: Reason = stt.st === 'idle' && side.pitchers.some((q) => q.idx === stt.idx) ? 'used' : stt.st;
              dg.reasons[reason]++;
            }
          }
        });
      }
    }
  }
  if (dg) {
    dg.seasons++;
    for (let t = 0; t < world.teams.length; t++) {
      const m = closerDays[t];
      const tot = [...m.values()].reduce((a, b) => a + b, 0);
      dg.teamSeasons++;
      dg.closers.push(m.size);
      dg.mainShare.push(tot ? Math.max(...m.values()) / tot : 0);
      const team = world.teams[t];
      const svs = team.org.map((p) => s.pit[p.idx]?.sv ?? 0);
      const sum = svs.reduce((a, b) => a + b, 0);
      dg.teamSv.push(sum);
      dg.topShare.push(sum ? Math.max(...svs) / sum : 0);
    }
  }
  const lines = s.pit.filter((q) => q.g > 0);
  const runs = s.teams.reduce((a, t) => a + t.rs, 0);
  const games = s.teams.reduce((a, t) => a + t.w + t.l + t.t, 0);
  return { lead: leaders(lines, runs, games), st: starterAgg(lines) };
}

const md: string[] = [];
const log = (x = '') => { md.push(x); console.log(x); };
log(`# 세이브·15승·180이닝 원인 나눠 재기 (${nSeasons}시즌 × ${years.join('·')})`);
log();
log(`만든 날: ${new Date().toISOString().slice(0, 10)}. 도구: \`npx tsx tools/saves_wins.ts --years ${years.join(',')} --seasons ${nSeasons}\`. 그 해 실제 개막 감독 성향, 모든 구단 AI. 실험의 환경 맞춤은 기본값 맞춤 그대로라 득점 변화가 보인다.`);
log();

const expRows = new Map<string, Leaders[]>();
const expSt = new Map<string, StarterAgg[]>();
for (const year of years) {
  const base = withOver({});
  const world = worldForYear(store, year, base);
  const cal = calibrate(world, { ...base, pilotSeasons: 12 }, new Rng(`validate-${year}-cal`));
  const tac = world.teams.map((t) => {
    const name = realOpening(store, t.franchise, year);
    return name ? tacticsOf(infoOf(store, name), name, year) : undefined;
  }) as ReturnType<typeof tacticsOf>[];
  const real = realYear(year);
  const dg: Diag = {
    seasons: 0, teamSeasons: 0, closers: [], mainShare: [], topShare: [], teamSv: [], svBy: { closer: 0, other: 0 },
    reasons: { none: 0, fatigue: 0, three: 0, used: 0, idle: 0 }, starts: 0, q5: 0, q5TeamWin: 0, q5Win: 0, startWin: 0,
  };
  const t0 = Date.now();
  for (const e of exps) {
    const params = e.key === 'base' ? base : withOver(e.over(DEFAULT_PARAMS));
    const w = e.key === 'base' ? world : worldForYear(store, year, params);
    const res = [];
    for (let i = 0; i < nSeasons; i++) res.push(runSeason(w, params, cal, `sw-${year}-${i}`, tac, e.key === 'base' ? dg : null));
    const L = avgLeaders(res.map((r) => r.lead));
    (expRows.get(e.key) ?? expRows.set(e.key, []).get(e.key)!).push(L);
    const S = res.map((r) => r.st);
    (expSt.get(e.key) ?? expSt.set(e.key, []).get(e.key)!).push({ n: mean(S.map((x) => x.n)), gs: mean(S.map((x) => x.gs)), ipgs: mean(S.map((x) => x.ipgs)), wgs: mean(S.map((x) => x.wgs)), gsMax: mean(S.map((x) => x.gsMax)) });
    console.error(`[${year}] ${e.key} ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  }
  const L = expRows.get('base')!.at(-1)!;
  const S = expSt.get('base')!.at(-1)!;
  log(`## ${year}`);
  log();
  log('### 리그 지표 (시즌당)');
  log();
  log('| | 30세이브 | 20세이브 | 최다 세이브 | 15승 | 10승 | 최다 승 | 180이닝 | 150이닝 | 최다 이닝 | 경기당 득점(팀) |');
  log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  const row = (n: string, x: Leaders) => log(`| ${n} | ${f1(x.sv30)} | ${f1(x.sv20)} | ${f1(x.svMax)} | ${f1(x.w15)} | ${f1(x.w10)} | ${f1(x.wMax)} | ${f1(x.ip180)} | ${f1(x.ip150)} | ${f1(x.ipMax)} | ${f2(x.rpg)} |`);
  row('실제', real.lead);
  row('시뮬', L);
  log();
  log('### 마무리');
  log();
  const sv = dg.svBy.closer + dg.svBy.other;
  log(`- 팀 시즌 세이브: 시뮬 ${f1(mean(dg.teamSv))} (144경기 기준), 실제 ${f1(real.teamSv)}. 팀 세이브 중 1위 투수 몫: 시뮬 ${pct(mean(dg.topShare))}, 실제 ${pct(real.topShare)}`);
  log(`- 시즌 중 마무리(엔진 ts.closer)를 맡은 투수 수 (팀당): 평균 ${f2(mean(dg.closers))}, 1명뿐인 팀 ${pct(mean(dg.closers.map((c) => (c === 1 ? 1 : 0))))}, 주 마무리가 맡은 날 몫 ${pct(mean(dg.mainShare))}`);
  log(`- 세이브를 그날 마무리가 가져간 몫: ${pct(dg.svBy.closer / sv)} (${dg.svBy.closer} / ${sv})`);
  log(`- 마무리 아닌 투수의 세이브 (${dg.svBy.other}개, 팀 시즌당 ${f1(dg.svBy.other / dg.teamSeasons)}개)의 그날 마무리 상태:`);
  for (const r of Object.keys(REASON_LABEL) as Reason[]) log(`  - ${REASON_LABEL[r]}: ${pct(dg.reasons[r] / Math.max(1, dg.svBy.other))} (팀 시즌당 ${f1(dg.reasons[r] / dg.teamSeasons)}개)`);
  log();
  log('### 선발 (GS 15 이상·구원 3 이하 투수)');
  log();
  log('| | 투수 수 | 평균 GS | 최다 GS | 이닝/GS | 승/GS |');
  log('|---|---:|---:|---:|---:|---:|');
  log(`| 실제 | ${f1(real.st.n)} | ${f1(real.st.gs)} | ${f1(real.st.gsMax)} | ${f2(real.st.ipgs)} | ${f2(real.st.wgs)} |`);
  log(`| 시뮬 | ${f1(S.n)} | ${f1(S.gs)} | ${f1(S.gsMax)} | ${f2(S.ipgs)} | ${f2(S.wgs)} |`);
  log();
  log(`- 모든 선발 등판: 5이닝(15아웃) 이상 ${pct(dg.q5 / dg.starts)}, 선발 승 ${pct(dg.startWin / dg.starts)}. 5이닝 이상 던진 경기 중 팀 승 ${pct(dg.q5TeamWin / dg.q5)}, 그 팀 승 중 선발 승 ${pct(dg.q5Win / Math.max(1, dg.q5TeamWin))} (나머지는 선발이 내려갈 때 지거나 비기고 있었거나 불펜이 리드를 날린 뒤 다시 이김)`);
  log();
}

log('## 실험 (params만 바꿈, 엔진 코드 그대로)');
log();
log(`해마다 ${nSeasons}시즌, ${years.join('·')} 평균. 득점은 기본값 환경 맞춤 그대로 (맞춤을 다시 하면 리그 평균은 목표로 돌아가고 남는 것은 맞춤 계수 변화).`);
log();
log('| 실험 | 30세이브 | 최다 세이브 | 15승 | 최다 승 | 180이닝 | 최다 이닝 | 선발 이닝/GS | 선발 평균 GS | 경기당 득점 (기본 대비) |');
log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
const baseL = avgLeaders(expRows.get('base')!);
for (const e of exps) {
  const L = avgLeaders(expRows.get(e.key)!);
  const S = expSt.get(e.key)!;
  log(`| ${e.label} | ${f1(L.sv30)} | ${f1(L.svMax)} | ${f1(L.w15)} | ${f1(L.wMax)} | ${f1(L.ip180)} | ${f1(L.ipMax)} | ${f2(mean(S.map((x) => x.ipgs)))} | ${f1(mean(S.map((x) => x.gs)))} | ${f2(L.rpg)} (${e.key === 'base' ? '-' : `${L.rpg >= baseL.rpg ? '+' : ''}${(((L.rpg / baseL.rpg) - 1) * 100).toFixed(1)}%`}) |`);
}
if (out) writeFileSync(out, md.join('\n') + '\n');
