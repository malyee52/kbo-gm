// 경기 엔진 2 11단계 점검 (2026-10-23, docs/경기엔진2_기획안.md 6장 11단계·4.6): 야수 체력·경기 중 부상·혹사.
// - 리그 결장 비율 (경기일 × 선수, 경기 전 + 경기 중 부상·이탈 합. 혹사 부상은 따로 뺀 값도)
// - 주축(그 시즌 100타석 또는 30이닝 이상) 부상: 구단당 시즌 횟수, 장기(15일+) 횟수, 주축 1인당 결장일 (docs/engine.md 3.1)
// - 경기 중 부상 몫과 사건별(투구·주루·수비) 수, 혹사 부상 수
// - 혹사지수가 쌓인 투수의 다음 30일 부상률 (10일마다 표본) 대 투수 평균
// - 상위 9명 타석 비중 (validate_engine.ts와 같은 정의, 실제 2025 0.708)
// 사용법:  npx tsx tools/injury_check.ts [--years 2025] [--seasons 6] [--params '{"restChance":0.3}']
import { loadDataStore } from '../src/data/loadNode';
import * as E from '../src/engine';
import { calibrate, DEFAULT_PARAMS, Rng, Season, worldForYear, type EngineParams } from '../src/engine';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const years = (arg('years') ?? '2025').split(',').map(Number);
const nSeasons = Number(arg('seasons') ?? 6);
const over = arg('params') ? (JSON.parse(arg('params')!) as Record<string, unknown>) : {};
// 한 단계 안쪽까지 섞는다 (예: {"injury":{"inGame":{...}}}는 inGame을 통째로 바꾼다)
const merge = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? { ...(a[k] as object), ...(v as object) } : v;
  return out;
};
const params = merge(DEFAULT_PARAMS as unknown as Record<string, unknown>, over) as unknown as EngineParams;
const store = loadDataStore();
const f1 = (x: number) => x.toFixed(1);
const f3 = (x: number) => x.toFixed(3);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** 혹사지수 '쌓임' 기준 (임시값, 측정용) */
const HIGH = Number(arg('high') ?? 3);
// 이번 엔진에 혹사지수가 있으면 쓴다 (11단계 전 엔진에서도 돌게)
const overuseOf = (E as Record<string, unknown>).currentOveruse as ((st: unknown, i: number, d: number, o: unknown) => number) | undefined;

for (const year of years) {
  const world = worldForYear(store, year, params);
  const cal = calibrate(world, { ...params, pilotSeasons: 12 }, new Rng(`validate-${year}-cal`));
  let absent = 0, absentOver = 0, total = 0;
  let coreInj = 0, coreLong = 0, coreDays = 0, corePlayers = 0, teamSeasons = 0, coreOver = 0;
  const rankG = new Array(9).fill(0);
  let rankN = 0;
  let inj = 0, inGame = 0, overuse = 0;
  const cause: Record<string, number> = {};
  const parts: Record<string, number> = {};
  let hiN = 0, hiHurt = 0, allN = 0, allHurt = 0;
  const top9: number[] = [];
  const t0 = Date.now();
  for (let i = 0; i < nSeasons; i++) {
    const s = Season.start(world, params, `injury-${year}-${i}`, { cal });
    const len = s.schedule.length;
    const last = new Map<number, E.Absence>();
    let seen = 0;
    const samples: { idx: number; day: number; hi: boolean }[] = [];
    while (!s.done) {
      const d = s.day;
      // 혹사 표본: 10일마다, 결장 중이 아닌 1군 투수
      if (overuseOf && d % 10 === 0 && d + 30 < len) {
        for (const ts of s.teamSeasons) {
          for (const p of [...ts.rotation, ...ts.bullpen]) {
            if (s.states.absentUntil[p.idx] > d) continue;
            samples.push({ idx: p.idx, day: d, hi: overuseOf(s.states, p.idx, d, params.injury.overuse) >= HIGH });
          }
        }
      }
      s.simulateDay();
      for (; seen < s.absences.length; seen++) last.set(s.absences[seen].idx, s.absences[seen]);
      if (!s.schedule[d].length) continue;
      for (const p of world.players) {
        total++;
        if (s.states.absentUntil[p.idx] > d) {
          absent++;
          const a = last.get(p.idx);
          if (a && a.until > d && a.day <= d && (a as { overuse?: boolean }).overuse) absentOver++;
        }
      }
    }
    // 혹사 표본: 다음 30일 안에 부상(이탈 이벤트 빼고)
    const injDays = new Map<number, number[]>();
    for (const a of s.absences) if (a.kind !== 'event') (injDays.get(a.idx) ?? injDays.set(a.idx, []).get(a.idx)!).push(a.day);
    for (const smp of samples) {
      const hurt = (injDays.get(smp.idx) ?? []).some((d) => d >= smp.day && d < smp.day + 30) ? 1 : 0;
      allN++; allHurt += hurt;
      if (smp.hi) { hiN++; hiHurt += hurt; }
    }
    // 주축 부상
    const core = new Set(world.players.filter((p) => s.bat[p.idx].pa >= 100 || s.pit[p.idx].outs >= 90).map((p) => p.idx));
    corePlayers += core.size;
    teamSeasons += world.teams.length;
    for (const a of s.absences) {
      if (a.kind === 'event') continue;
      inj++;
      const x = a as { cause?: string; overuse?: boolean; part?: string };
      if (x.cause) { inGame++; cause[x.cause] = (cause[x.cause] ?? 0) + 1; }
      if (x.overuse) overuse++;
      if (x.part) parts[x.part] = (parts[x.part] ?? 0) + 1;
      if (!core.has(a.idx)) continue;
      coreInj++;
      if (x.overuse) coreOver++;
      if (a.kind !== 'minor') coreLong++;
      coreDays += Math.min(a.until, len) - a.day;
    }
    // 타석 순위별 출전 경기 몫 (팀 경기 대비)
    const gByTeam = new Map<number, { pa: number; g: number }[]>();
    world.players.forEach((p, idx) => {
      if (s.bat[idx].pa > 0) (gByTeam.get(p.teamIdx) ?? gByTeam.set(p.teamIdx, []).get(p.teamIdx)!).push({ pa: s.bat[idx].pa, g: s.bat[idx].g });
    });
    for (const [t, v] of gByTeam) v.sort((a, b) => b.pa - a.pa).slice(0, 9).forEach((x, r) => { rankG[r] += x.g / s.teams[t].g; });
    const byTeam = new Map<number, number[]>();
    world.players.forEach((p, idx) => {
      const pa = s.bat[idx].pa;
      if (pa > 0) (byTeam.get(p.teamIdx) ?? byTeam.set(p.teamIdx, []).get(p.teamIdx)!).push(pa);
    });
    for (const v of byTeam.values()) {
      const sorted = [...v].sort((a, b) => b - a);
      rankN++;
      top9.push(sorted.slice(0, 9).reduce((a, b) => a + b, 0) / sorted.reduce((a, b) => a + b, 0));
    }
  }
  console.log(`## ${year}년 (${nSeasons}시즌, ${((Date.now() - t0) / 1000 / nSeasons).toFixed(1)}초/시즌)\n`);
  console.log(`- 리그 결장 비율 ${pct(absent / total)}, 혹사 부상 뺀 값 ${pct((absent - absentOver) / total)}`);
  console.log(`- 주축 부상 구단당 시즌 ${f1(coreInj / teamSeasons)}번, 장기(15일+) ${f1(coreLong / teamSeasons)}번, 주축 1인당 결장일 ${f1(coreDays / corePlayers)}일 (주축 ${f1(corePlayers / teamSeasons)}명/구단)`);
  console.log(`  - 혹사 부상 뺀 주축 부상 ${f1((coreInj - coreOver) / teamSeasons)}번`);
  console.log(`- 부상 ${f1(inj / nSeasons)}건/시즌: 경기 중 ${pct(inGame / Math.max(1, inj))} (투구 ${cause.pitch ?? 0}·주루 ${cause.run ?? 0}·수비 ${cause.field ?? 0}), 혹사 부상 ${f1(overuse / nSeasons)}건/시즌`);
  if (overuseOf) console.log(`- 혹사지수 ${HIGH} 이상 투수의 다음 30일 부상률 ${pct(hiHurt / Math.max(1, hiN))} (표본 ${hiN}) 대 1군 투수 평균 ${pct(allHurt / Math.max(1, allN))} (표본 ${allN})`);
  console.log(`- 상위 9명 타석 비중 ${f3(top9.reduce((a, b) => a + b, 0) / top9.length)} (실제 2025 0.708 ±0.015)`);
  console.log(`- 타석 순위 1~9위의 출전 경기 몫: ${rankG.map((x) => (x / rankN).toFixed(2)).join(' · ')}`);
  const partList = Object.entries(parts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  if (partList) console.log(`- 부위: ${partList}`);
  console.log('');
}
