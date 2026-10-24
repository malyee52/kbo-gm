// 일정 개편 7단계 점검 (기획안 7장): 날씨·우천 순연을 넣은 시즌 일정을 해마다 시드 여러 개로 본다.
//  - 다시 치르는 경기 = 경기 전 취소 + 노게임(경기 중 비 1~4회). 2015~2025 평균 60~70, 시드별 범위 대략 40~90이 목표
//    (조사값: 2015~2025 평균 65경기, 42~85). 노게임도 경기 전 취소와 같은 순연 규칙으로 다시 편성한다 (10단계) → 종료일에 들어 있다
//  - 종료일 = 마지막 경기 날. 중앙값이 참고 종료일 ±10일 (출처 갈림 해는 두 값 사이도 맞음)
// 월드는 시작 판과 같은 모양 (worldForYear + 그 해 실제 구장의 돔). 2027~는 2026 구단으로 계산한 자료 없는 해 규칙.
// npx tsx tools/schedule_check.ts --seeds 50 [--from 1982 --to 2027] [--out reports/schedule-check.md]
import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { addDays, daysBetween, scheduleRule } from '../src/data/schedule';
import { DEFAULT_PARAMS, planForWorld, Rng, worldForYear, type World } from '../src/engine';
import { framedRule } from '../src/engine/schedule';
import { isNoGame, RAIN_SCALE } from '../src/engine/weather';
import { homeIsDome } from '../src/league/stadium';
import { projectedEnvironment } from '../src/league/world';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const seeds = Number(arg('seeds', '50'));
const from = Number(arg('from', '1982'));
const to = Number(arg('to', '2027'));
const out = arg('out', '');
const store = loadDataStore();

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f1 = (x: number) => x.toFixed(1);

type W = Pick<World, 'year' | 'teams' | 'gamesPerTeam' | 'schedule' | 'openingHosts' | 'divisions'>;
let base: World | undefined;
const projectedGames = store.schedule ? projectedEnvironment(store).games : 144;

const rows: string[] = [];
const offYears: string[] = [];
const replay1525: number[] = [];
const perGame1525: number[] = [];
let ms = 0;
let plans = 0;
for (let y = from; y <= to; y++) {
  let world: W;
  if (store.season(y)) world = worldForYear(store, y, DEFAULT_PARAMS);
  else {
    base ??= worldForYear(store, store.meta.years[store.meta.years.length - 1], DEFAULT_PARAMS);
    world = { year: y, teams: base.teams, gamesPerTeam: projectedGames, schedule: scheduleRule(store.schedule!, y) };
  }
  world = { ...world, teams: world.teams.map((t) => ({ ...t, ...(homeIsDome(undefined, t.franchise, y) ? { dome: true } : {}) })) };
  const rule = world.schedule!;
  const n = world.teams.length;
  const replays: number[] = [];
  const cancels: number[] = [];
  const colds: number[] = [];
  const dhs: number[] = [];
  const lasts: number[] = [];
  const mondays: number[] = [];
  let opening = '';
  for (let k = 0; k < seeds; k++) {
    const t0 = performance.now();
    const p = planForWorld(world, new Rng(`check-${y}-${k}`));
    ms += performance.now() - t0;
    plans++;
    opening = p.opening;
    let nogame = 0;
    let cold = 0;
    let dh = 0;
    let mon = 0;
    p.days.forEach((d, i) => {
      const monday = new Date(`${addDays(p.opening, i)}T00:00:00Z`).getUTCDay() === 1;
      for (const g of d) {
        if (isNoGame(g.rainInning)) nogame++;
        else if (g.rainInning) cold++;
        if (g.dh === 2) dh++;
        if (monday) mon++;
      }
    });
    // cancels에는 경기 전 취소와 노게임(다섯째 값 1)이 함께 있다 (10단계부터 노게임도 다시 편성)
    const pre = p.cancels.filter((c) => !c[4]).length;
    if (pre + nogame !== p.cancels.length) throw new Error(`${y}/${k}: 노게임 ${nogame}경기와 다시 편성한 노게임 ${p.cancels.length - pre}건이 다름`);
    cancels.push(pre);
    replays.push(p.cancels.length);
    colds.push(cold);
    dhs.push(dh);
    mondays.push(mon);
    lasts.push(p.days.length - 1);
  }
  const games = (n * world.gamesPerTeam) / 2;
  if (y >= 2015 && y <= 2025) {
    replay1525.push(...replays);
    perGame1525.push(mean(replays) / games);
  }
  const d = (i: number) => addDays(opening, i).slice(5);
  const endMed = median(lasts);
  let verdict = '-';
  if (rule.endRef) {
    const endDay = addDays(opening, endMed);
    const lo = addDays(rule.endRef, -10);
    const hi = addDays(rule.endRef2 && rule.endRef2 > rule.endRef ? rule.endRef2 : rule.endRef, 10);
    const gap = daysBetween(rule.endRef, endDay);
    verdict = endDay >= lo && endDay <= hi ? `맞음 (${gap >= 0 ? '+' : ''}${gap})` : `**벗어남 (${gap >= 0 ? '+' : ''}${gap})**`;
    if (!(endDay >= lo && endDay <= hi)) offYears.push(`${y} (${rule.frame}·${rule.postpone}, 중앙값 ${endDay.slice(5)}, 참고 ${rule.endRef.slice(5)}${rule.endRef2 ? `·${rule.endRef2.slice(5)}` : ''}, ${gap >= 0 ? '+' : ''}${gap}일)`);
  }
  rows.push(`| ${y} | ${rule.frame}${framedRule(world) ? '' : ' (하루씩)'} | ${rule.postpone} | ${games} | ${f1(mean(replays))} | ${Math.min(...replays)}~${Math.max(...replays)} | ${f1(mean(cancels))} | ${f1(mean(colds))} | ${f1(mean(dhs))} | ${f1(mean(mondays))} | ${d(endMed)} | ${d(Math.min(...lasts))}~${d(Math.max(...lasts))} | ${rule.endRef?.slice(5) ?? '-'}${rule.endRef2 ? `·${rule.endRef2.slice(5)}` : ''} | ${verdict} |`);
  console.error(`${y} 끝`);
}

const lines = [
  '# 일정 점검: 날씨·우천 순연 (일정 개편 7단계)',
  '',
  `\`npx tsx tools/schedule_check.ts --seeds ${seeds} --from ${from} --to ${to}\`. 시드 ${seeds}개, 월드는 시작 판 모양 (그 해 실제 구장 돔). 날씨 전체 계수 RAIN_SCALE = ${RAIN_SCALE} (engine/weather.ts, 임시값).`,
  '',
  '- 다시 치르는 경기 = 경기 전 취소 + 노게임 (경기 중 비 1~4회). 노게임도 같은 순연 규칙으로 다시 편성한다 (10단계) → 종료일에 들어 있다.',
  '- 강우 콜드 = 경기 중 비 5~8회 (경기는 그대로 성립). 더블헤더는 2차전 수. 월요일 경기는 우천 순연·잔여 경기·어린이날.',
  '- 종료 판정: 마지막 경기 날 중앙값이 참고 종료일 ±10일 (출처 갈림 해는 두 값 사이 포함).',
  '',
];
if (replay1525.length) {
  lines.push(
    '## 2015~2025 요약',
    '',
    '| 항목 | 목표 | 결과 |',
    '|---|---|---|',
    `| 한 시즌 다시 치르는 경기 평균 | 60~70 (조사값 65) | ${f1(mean(replay1525))} |`,
    `| 시드별 범위 | 대략 40~90 (조사값 42~85) | ${Math.min(...replay1525)}~${Math.max(...replay1525)} (5~95%: ${pct(replay1525, 0.05)}~${pct(replay1525, 0.95)}) |`,
    `| 경기당 비율 | 약 9% | ${(mean(perGame1525) * 100).toFixed(1)}% |`,
    '',
  );
}
lines.push(
  '## 해마다',
  '',
  '| 연도 | 틀 | 순연 | 경기 | 다시 치름 평균 | 범위 | 경기 전 취소 | 강우 콜드 | 더블헤더 | 월요일 경기 | 종료 중앙값 | 종료 범위 | 참고 종료 | 판정 |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  '## 종료일이 참고 ±10일을 벗어나는 해',
  '',
  ...(offYears.length ? offYears.map((x) => `- ${x}`) : ['- 없음']),
  '',
  `일정 생성(날씨 포함) 평균 ${f1(ms / plans)}ms (${plans}벌).`,
  '',
);
const text = lines.join('\n');
if (out) writeFileSync(out, text);
else console.log(text);
