// 일정 개편 4단계 점검: 해마다 시즌 일정(planForWorld)의 개막일·본 일정 끝·마지막 경기일을 시드 여러 개로 본다 (우천 없음).
// "연전"은 연전 생성기, "하루씩"은 연전 틀을 아직 만들지 않은 해 (spreadPlan). 참고 종료는 규칙 표의 실제 종료일.
// npx tsx tools/schedule_end_dates.ts --seeds 10 [--from 1982 --to 2030]
import { loadDataStore } from '../src/data/loadNode';
import { addDays, scheduleRule } from '../src/data/schedule';
import { DEFAULT_PARAMS, planForWorld, Rng, worldForYear, type World } from '../src/engine';
import { framedRule } from '../src/engine/schedule';
import { projectedEnvironment } from '../src/league/world';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const seeds = Number(arg('seeds', '10'));
const from = Number(arg('from', '1982'));
const to = Number(arg('to', '2030'));
const store = loadDataStore();

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log('| 연도 | 틀 | 일정 | 개막 | 본 일정 끝 (중앙값) | 마지막 경기 (중앙값) | 마지막 경기 범위 | 참고 종료 |');
console.log('|---|---|---|---|---|---|---|---|');
let base: World | undefined;
const projectedGames = store.schedule ? projectedEnvironment(store).games : 144;
for (let y = from; y <= to; y++) {
  let world: Pick<World, 'year' | 'teams' | 'gamesPerTeam' | 'schedule' | 'openingHosts'>;
  if (store.season(y)) world = worldForYear(store, y, DEFAULT_PARAMS);
  else {
    base ??= worldForYear(store, store.meta.years[store.meta.years.length - 1], DEFAULT_PARAMS);
    world = { year: y, teams: base.teams, gamesPerTeam: projectedGames, schedule: scheduleRule(store.schedule!, y) };
  }
  const mains: number[] = [];
  const lasts: number[] = [];
  let opening = '';
  for (let k = 0; k < seeds; k++) {
    const p = planForWorld(world, new Rng(`end-${y}-${k}`));
    opening = p.opening;
    mains.push(p.mainEnd);
    let last = p.days.length - 1;
    while (last > 0 && !p.days[last].length) last--;
    lasts.push(last);
  }
  const rule = world.schedule;
  const kind = framedRule(world) ? '연전' : '하루씩';
  const d = (i: number) => addDays(opening, i).slice(5);
  console.log(`| ${y} | ${rule?.frame ?? '-'} | ${kind} | ${opening.slice(5)} | ${d(median(mains))} | ${d(median(lasts))} | ${d(Math.min(...lasts))}~${d(Math.max(...lasts))} | ${rule?.endRef?.slice(5) ?? '-'}${rule?.endRef2 ? `·${rule.endRef2.slice(5)}` : ''} |`);
}
